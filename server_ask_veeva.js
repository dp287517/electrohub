// server_ask_veeva.js — Ask Veeva backend (scalable ingestion, streaming-like PDF, queue, Excel, media)
// Requis: OPENAI_API_KEY, NEON_DATABASE_URL
// Ports: fixe 3015 (ou ASK_VEEVA_PORT)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import StreamZip from 'node-stream-zip';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { OpenAI } from 'openai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- App config ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.ASK_VEEVA_PORT || 3015);

// Répertoires
const DATA_ROOT  = process.env.ASK_VEEVA_DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
const CORPUS_DIR = path.join(DATA_ROOT, 'corpus');
await fsp.mkdir(DATA_ROOT, { recursive: true });
await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(CORPUS_DIR, { recursive: true });

// PDF.js assets (fonts + worker)
const PDFJS_PKG_PATH = require.resolve('pdfjs-dist/package.json');
const PDFJS_DIR = path.dirname(PDFJS_PKG_PATH);
const PDFJS_STANDARD_FONTS = path.join(PDFJS_DIR, 'standard_fonts');
const PDFJS_WORKER = path.join(PDFJS_DIR, 'legacy', 'build', 'pdf.worker.mjs');

// Multer disque (gros fichiers OK)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modèles & limites
const EMBEDDING_MODEL   = process.env.ASK_VEEVA_EMBEDDINGS || 'text-embedding-3-small'; // 1536 dims
const ANSWER_MODEL      = process.env.ASK_VEEVA_MODEL      || 'gpt-4.1-mini';
const TRANSCRIBE_MODEL  = process.env.ASK_VEEVA_TRANSCRIBE_MODEL || 'whisper-1';
const EMBEDDING_DIMS    = 1536;
const EMBED_BATCH       = Math.max(1, Number(process.env.ASK_VEEVA_EMBED_BATCH || 16)); // petits lots
const MAX_TRANSCRIBE_MB = Number(process.env.ASK_VEEVA_MAX_TRANSCRIBE_MB || 200);
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ASK_VEEVA_MAX_CONCURRENT_JOBS || 1)); // back-pressure
const PDF_CHUNK_SIZE    = Math.max(400, Number(process.env.ASK_VEEVA_PDF_CHUNK_SIZE || 1200));
const PDF_CHUNK_OVERLAP = Math.max(0, Number(process.env.ASK_VEEVA_PDF_CHUNK_OVERLAP || 200));

// --- DB bootstrap ---
async function ensureSchema() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS askv_documents (
      id UUID PRIMARY KEY,
      filename TEXT NOT NULL,
      content_type TEXT,
      size_bytes BIGINT,
      sha256 TEXT,
      storage_path TEXT NOT NULL,
      pages INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS askv_chunks (
      id BIGSERIAL PRIMARY KEY,
      doc_id UUID REFERENCES askv_documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIMS})
    );
  `);

  try { await pool.query(`ALTER TABLE askv_chunks ALTER COLUMN embedding TYPE vector(${EMBEDDING_DIMS})`); } catch {}

  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'askv_chunks_vec_idx') THEN
        EXECUTE 'CREATE INDEX askv_chunks_vec_idx ON askv_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
      END IF;
    END$$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_jobs (
      id UUID PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      total_files INTEGER DEFAULT 0,
      processed_files INTEGER DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}
await ensureSchema();

// --- Helpers ---
function sha256FileSync(filePath) {
  const h = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  h.update(data);
  return h.digest('hex');
}

function chunkPush(buffer, newText, outChunks, chunkSize, overlap) {
  // concatène et découpe en morceaux: évite de garder un giga-string
  let buf = buffer + newText;
  while (buf.length >= chunkSize) {
    const slice = buf.slice(0, chunkSize);
    outChunks.push(slice);
    buf = buf.slice(chunkSize - overlap);
  }
  return buf;
}

async function embedBatch(texts) {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return res.data.map(d => d.embedding);
}

async function insertEmbeddings(client, docId, startIndex, chunks) {
  // en petits lots (EMBED_BATCH)
  let idx = startIndex;
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embs = await embedBatch(batch);
    const values = [];
    const params = [];
    let p = 1;
    for (let j = 0; j < batch.length; j++) {
      const text = batch[j];
      const emb = embs[j];
      const vectorLiteral = `[${emb.join(',')}]`;
      values.push(`($${p++}, $${p++}, $${p++}, ${`'${vectorLiteral}'`}::vector)`);
      params.push(docId, idx, text);
      idx++;
    }
    const sql = `INSERT INTO askv_chunks (doc_id, chunk_index, text, embedding) VALUES ${values.join(',')}`;
    await client.query(sql, params);
  }
  return idx; // nouveau startIndex
}

// --- Parsers ---
// PDF streaming-like: on n'utilise pas readFile(data), on laisse pdfjs lire le path (file://)
async function indexPdfStreaming(client, absPath, relPath, filename, sizeBytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try { if (pdfjs.GlobalWorkerOptions && PDFJS_WORKER) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch {}

  const url = `file://${absPath}`;
  const loadingTask = pdfjs.getDocument({
    url,
    standardFontDataUrl: PDFJS_STANDARD_FONTS.endsWith(path.sep) ? PDFJS_STANDARD_FONTS : PDFJS_STANDARD_FONTS + path.sep,
    isEvalSupported: false,
    disableFontFace: true,    // réduit un peu la RAM en Node
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  // Enregistre le document d'abord
  const docId = crypto.randomUUID();
  const sha256 = sha256FileSync(absPath);
  await client.query(
    `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [docId, filename, 'application/pdf', sizeBytes, sha256, relPath, numPages]
  );

  // Buffer de chunking
  let chunkBuffer = '';
  let toInsert = [];
  let chunkIndex = 0;

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(it => ('str' in it ? it.str : (it?.unicode || '')));
    const pageText = strings.join(' ') + '\n';

    // pousse pageText dans le découpeur
    chunkBuffer = chunkPush(chunkBuffer, pageText, toInsert, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);

    // si on a accumulé suffisamment de morceaux, flush embeddings → DB
    if (toInsert.length >= EMBED_BATCH * 2) {
      chunkIndex = await insertEmbeddings(client, docId, chunkIndex, toInsert);
      toInsert = [];
      // libère mémoire
      if (global.gc) try { global.gc(); } catch {}
    }
  }
  await doc.destroy?.();

  // reste à insérer
  if (chunkBuffer.trim().length) {
    toInsert.push(chunkBuffer);
    chunkBuffer = '';
  }
  if (toInsert.length) {
    await insertEmbeddings(client, docId, chunkIndex, toInsert);
  }

  return { docId, chunks: chunkIndex + toInsert.length, bytes: sizeBytes };
}

async function extractDocxText(absPath) {
  const buf = await fsp.readFile(absPath);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value || '';
}

function extractExcelLikeToText(absPath) {
  const wb = XLSX.readFile(absPath, { cellDates: true, cellNF: false, cellText: false });
  const sheetNames = wb.SheetNames || [];
  const lines = [];
  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    lines.push(`### SHEET: ${name}`);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    for (const row of rows) {
      const cells = (row || []).map(v => (v === null || v === undefined) ? '' : String(v));
      lines.push(cells.join('\t'));
      if (lines.join('\n').length > 2_000_000) { lines.push('...[truncated]'); break; }
    }
  }
  return lines.join('\n');
}

async function transcribeMedia(absPath, contentTypeGuess) {
  const stat = await fsp.stat(absPath);
  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB > MAX_TRANSCRIBE_MB) {
    return { text: null, note: `Media too large for transcription (${sizeMB.toFixed(1)} MB > ${MAX_TRANSCRIBE_MB} MB)`, contentType: contentTypeGuess || 'video/mp4' };
  }
  const stream = fs.createReadStream(absPath);
  try {
    const resp = await openai.audio.transcriptions.create({ file: stream, model: TRANSCRIBE_MODEL });
    return { text: resp?.text || '', contentType: contentTypeGuess || 'video/mp4' };
  } catch (e) {
    console.error('[transcribeMedia]', e);
    return { text: null, note: `Transcription failed: ${e?.message || e}`, contentType: contentTypeGuess || 'video/mp4' };
  }
}

// --- Ingestion d'un fichier (format-aware, mémoire bornée) ---
async function ingestSingleFile(client, absSrc, subdir = '') {
  const baseName = path.basename(absSrc);
  const relPath = path.join(subdir, baseName);
  const destAbs = path.join(CORPUS_DIR, relPath);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await fsp.copyFile(absSrc, destAbs);

  const stat = await fsp.stat(destAbs);
  const ext = path.extname(destAbs).toLowerCase();

  // PDF → indexation page-par-page
  if (ext === '.pdf') {
    return await indexPdfStreaming(client, destAbs, relPath, baseName, stat.size);
  }

  // DOCX
  if (ext === '.docx') {
    const text = await extractDocxText(destAbs);
    const id = crypto.randomUUID();
    const sha256 = sha256FileSync(destAbs);
    await client.query(
      `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, baseName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', stat.size, sha256, relPath, null]
    );
    if (text && text.trim()) {
      // chunk & insert petit à petit
      let buf = '';
      let idx = 0;
      const toInsert = [];
      const push = (t) => { buf = chunkPush(buf, t, toInsert, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP); };
      push(text);
      if (buf.trim().length) { toInsert.push(buf); buf = ''; }
      if (toInsert.length) idx = await insertEmbeddings(client, id, idx, toInsert);
      return { docId: id, chunks: idx, bytes: stat.size };
    }
    return { docId: id, chunks: 0, bytes: stat.size };
  }

  // Excel / CSV
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const text = extractExcelLikeToText(destAbs);
    const id = crypto.randomUUID();
    const sha256 = sha256FileSync(destAbs);
    await client.query(
      `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, baseName, 'application/vnd.ms-excel', stat.size, sha256, relPath, null]
    );
    if (text && text.trim()) {
      let buf = '';
      let idx = 0;
      const toInsert = [];
      buf = chunkPush(buf, text, toInsert, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
      if (buf.trim().length) { toInsert.push(buf); buf = ''; }
      if (toInsert.length) idx = await insertEmbeddings(client, id, idx, toInsert);
      return { docId: id, chunks: idx, bytes: stat.size };
    }
    return { docId: id, chunks: 0, bytes: stat.size };
  }

  // Media (mp4/mp3/...)
  const MEDIA_EXTS = new Set(['.mp4', '.mp3', '.m4a', '.wav', '.webm', '.mpeg', '.mpga', '.ogg']);
  if (MEDIA_EXTS.has(ext)) {
    const { text, note, contentType } = await transcribeMedia(destAbs, null);
    const id = crypto.randomUUID();
    const sha256 = sha256FileSync(destAbs);
    await client.query(
      `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, baseName, contentType, stat.size, sha256, relPath, null]
    );
    if (!text || !text.trim()) {
      if (note) console.warn(`[media note] ${baseName}: ${note}`);
      return { docId: id, chunks: 0, bytes: stat.size };
    }
    let buf = '';
    let idx = 0;
    const toInsert = [];
    buf = chunkPush(buf, text, toInsert, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
    if (buf.trim().length) { toInsert.push(buf); buf = ''; }
    if (toInsert.length) idx = await insertEmbeddings(client, id, idx, toInsert);
    return { docId: id, chunks: idx, bytes: stat.size };
  }

  // Texte brut/MD
  if (ext === '.txt' || ext === '.md') {
    const text = await fsp.readFile(destAbs, 'utf8');
    const id = crypto.randomUUID();
    const sha256 = sha256FileSync(destAbs);
    await client.query(
      `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, baseName, 'text/plain', stat.size, sha256, relPath, null]
    );
    if (text && text.trim()) {
      let buf = '';
      let idx = 0;
      const toInsert = [];
      buf = chunkPush(buf, text, toInsert, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
      if (buf.trim().length) { toInsert.push(buf); buf = ''; }
      if (toInsert.length) idx = await insertEmbeddings(client, id, idx, toInsert);
      return { docId: id, chunks: idx, bytes: stat.size };
    }
    return { docId: id, chunks: 0, bytes: stat.size };
  }

  // Unknown/binaire → on stocke, mais sans chunks
  const id = crypto.randomUUID();
  const sha256 = sha256FileSync(destAbs);
  await client.query(
    `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, baseName, 'application/octet-stream', stat.size, sha256, relPath, null]
  );
  return { docId: id, chunks: 0, bytes: stat.size };
}

// Walk files
async function walkFiles(dir) {
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkFiles(full));
    else out.push(full);
  }
  return out;
}

// ZIP extraction robuste (zip64)
async function extractZipTo(zipAbsPath, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  const fd = await fsp.open(zipAbsPath, 'r');
  try {
    const sig = Buffer.alloc(4);
    await fd.read(sig, 0, 4, 0);
    if (!(sig[0] === 0x50 && sig[1] === 0x4b)) throw new Error('Fichier non-ZIP ou corrompu (signature invalide)');
  } finally { await fd.close(); }

  const zip = new StreamZip.async({ file: zipAbsPath, storeEntries: true });
  try {
    const entries = await zip.entries();
    const names = Object.keys(entries || {});
    if (!names.length) throw new Error('Archive vide ou table centrale illisible (ZIP corrompu)');
    for (const name of names) {
      const dest = path.join(outDir, name);
      if (name.endsWith('/')) { await fsp.mkdir(dest, { recursive: true }); continue; }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await zip.extract(name, dest);
    }
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes('unexpected end of file')) throw new Error('ZIP incomplet/tronqué (unexpected end of file)');
    throw e;
  } finally { await zip.close(); }
}

// --- Jobs (queue + état) ---
async function createJob(kind, totalFiles = 0) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO askv_jobs (id, kind, status, total_files, processed_files)
     VALUES ($1,$2,'queued',$3,0)`,
    [id, kind, totalFiles]
  );
  return id;
}
async function updateJob(id, fields = {}) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ') + `, updated_at = now()`;
  const vals = keys.map(k => fields[k]);
  await pool.query(`UPDATE askv_jobs SET ${set} WHERE id = $${keys.length + 1}`, [...vals, id]);
}
async function jobById(id) {
  const { rows } = await pool.query(`SELECT * FROM askv_jobs WHERE id = $1`, [id]);
  return rows[0] || null;
}

// File d’attente simple en mémoire (1 ingestion à la fois par défaut)
const queue = [];
let running = 0;
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drain();
  });
}
async function drain() {
  if (running >= MAX_CONCURRENT_JOBS) return;
  const item = queue.shift();
  if (!item) return;
  running++;
  try { const res = await item.fn(); item.resolve(res); }
  catch (e) { item.reject(e); }
  finally { running--; setImmediate(drain); }
}

// Runners
async function runIngestZip(jobId, zipAbsPath) {
  await updateJob(jobId, { status: 'running' });
  const workDir = path.join(UPLOAD_DIR, `unz_${path.basename(zipAbsPath, '.zip')}_${Date.now()}`);
  try {
    await extractZipTo(zipAbsPath, workDir);
    const files = await walkFiles(workDir);
    await updateJob(jobId, { total_files: files.length });

    const client = await pool.connect();
    try {
      let processed = 0;
      for (const file of files) {
        const subdir = path.relative(workDir, path.dirname(file));
        await ingestSingleFile(client, file, subdir);
        processed++;
        if (processed % 3 === 0 || processed === files.length) { await updateJob(jobId, { processed_files: processed }); }
        // micro-pause pour laisser respirer l'event loop
        await new Promise(r => setTimeout(r, 5));
        if (global.gc) try { global.gc(); } catch {}
      }
      await updateJob(jobId, { status: 'done', processed_files: files.length });
    } finally { client.release(); }
  } catch (e) {
    console.error('[ingestZip]', e);
    await updateJob(jobId, { status: 'error', error: String(e?.message || e) });
  } finally {
    // cleanup optionnel
    // await fsp.rm(workDir, { recursive: true, force: true });
    // await fsp.rm(zipAbsPath, { force: true });
  }
}

async function runIngestFiles(jobId, fileAbsPaths) {
  await updateJob(jobId, { status: 'running', total_files: fileAbsPaths.length });
  const client = await pool.connect();
  try {
    let processed = 0;
    for (const file of fileAbsPaths) {
      await ingestSingleFile(client, file, '');
      processed++;
      if (processed % 3 === 0 || processed === fileAbsPaths.length) { await updateJob(jobId, { processed_files: processed }); }
      await new Promise(r => setTimeout(r, 5));
      if (global.gc) try { global.gc(); } catch {}
    }
    await updateJob(jobId, { status: 'done', processed_files: fileAbsPaths.length });
  } catch (e) {
    console.error('[runIngestFiles]', e);
    await updateJob(jobId, { status: 'error', error: String(e?.message || e) });
  } finally { client.release(); }
}

// --- API ---
app.get('/api/ask-veeva/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      service: 'ask-veeva',
      model: ANSWER_MODEL,
      embeddings: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      limits: {
        EMBED_BATCH,
        MAX_CONCURRENT_JOBS,
        PDF_CHUNK_SIZE,
        PDF_CHUNK_OVERLAP,
        MAX_TRANSCRIBE_MB
      }
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/ask-veeva/uploadZip', upload.single('zip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu (zip)' });
    const stat = await fsp.stat(req.file.path).catch(() => null);
    console.log('[ask-veeva] ZIP reçu:', req.file.originalname, 'size=', stat?.size);

    const jobId = await createJob('zip', 0);
    enqueue(() => runIngestZip(jobId, req.file.path)).catch(e => console.error('bg ingestZip failed', e));
    res.json({ ok: true, job_id: jobId, queued: true });
  } catch (e) { console.error('[uploadZip]', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/ask-veeva/uploadFiles', upload.array('files', 2000), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const jobId = await createJob('files', files.length);
    enqueue(() => runIngestFiles(jobId, files.map(f => f.path))).catch(e => console.error('bg ingestFiles failed', e));
    res.json({ ok: true, job_id: jobId, queued: true });
  } catch (e) { console.error('[uploadFiles]', e); res.status(500).json({ error: e.message }); }
});

app.get('/api/ask-veeva/jobs/:id', async (req, res) => {
  try {
    const j = await jobById(req.params.id);
    if (!j) return res.status(404).json({ error: 'job introuvable' });
    res.setHeader('Cache-Control', 'no-store'); // évite mismatch 304/proxy
    res.json(j);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ask-veeva/search', async (req, res) => {
  try {
    const { query, k = 5 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query manquant' });

    const qvec = (await openai.embeddings.create({ model: EMBEDDING_MODEL, input: [query] })).data[0].embedding;
    const vectorLiteral = `[${qvec.join(',')}]`;
    const { rows } = await pool.query(
      `
      SELECT c.id, c.doc_id, c.chunk_index, c.text,
             d.filename, d.storage_path, d.pages,
             1 - (c.embedding <=> ${`'${vectorLiteral}'`}::vector) AS score
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ORDER BY c.embedding <-> ${`'${vectorLiteral}'`}::vector
      LIMIT $1
      `,
      [k]
    );
    const matches = rows.map(r => ({
      chunk_id: r.id, doc_id: r.doc_id, chunk_index: r.chunk_index,
      snippet: r.text.slice(0, 600),
      meta: { filename: r.filename, storage_path: r.storage_path, pages: r.pages },
      score: Number(r.score)
    }));
    res.json({ matches });
  } catch (e) { console.error('[search]', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/ask-veeva/ask', async (req, res) => {
  try {
    const { question, k = 6 } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question manquante' });

    const qvec = (await openai.embeddings.create({ model: EMBEDDING_MODEL, input: [question] })).data[0].embedding;
    const vectorLiteral = `[${qvec.join(',')}]`;
    const { rows } = await pool.query(
      `
      SELECT c.id, c.doc_id, c.chunk_index, c.text,
             d.filename, d.storage_path, d.pages
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ORDER BY c.embedding <-> ${`'${vectorLiteral}'`}::vector
      LIMIT $1
      `,
      [k]
    );

    const contextBlocks = rows.map((r, i) => `SOURCE ${i + 1} (fichier: ${r.filename})\n${r.text}`).join('\n\n');
    const citations = rows.map(r => ({ filename: r.filename }));

    const system = `Tu es Ask Veeva, un assistant de recherche documentaire.
- Réponds en français de façon concise et sourcée.
- Si l’information n’est pas dans le contexte, dis-le.
- Appuie ta réponse sur les extraits fournis et liste les fichiers utilisés en fin de réponse.`;

    const user = `Question:\n${question}\n\nContexte:\n${contextBlocks}`;

    const resp = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      temperature: 0.2,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ text, citations });
  } catch (e) { console.error('[ask]', e); res.status(500).json({ error: e.message }); }
});

// Start
app.listen(PORT, () => console.log(`[ask-veeva] service listening on :${PORT}`));
