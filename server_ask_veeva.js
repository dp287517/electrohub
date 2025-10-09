// server_ask_veeva.js — Ask Veeva backend (S3 multipart + ingestion streaming + Excel/Media + queue)
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
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const require = createRequire(import.meta.url);

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.ASK_VEEVA_PORT || 3015);

// Dossiers locaux
const DATA_ROOT  = process.env.ASK_VEEVA_DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
const CORPUS_DIR = path.join(DATA_ROOT, 'corpus');
await fsp.mkdir(DATA_ROOT, { recursive: true });
await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(CORPUS_DIR, { recursive: true });

// PDF.js assets
const PDFJS_PKG_PATH = require.resolve('pdfjs-dist/package.json');
const PDFJS_DIR = path.dirname(PDFJS_PKG_PATH);
const PDFJS_STANDARD_FONTS = path.join(PDFJS_DIR, 'standard_fonts');
const PDFJS_WORKER = path.join(PDFJS_DIR, 'legacy', 'build', 'pdf.worker.mjs');

// Multer (limite « petits fichiers » only — pour forcer le flux S3 au-delà)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 Mo max ici → le reste via S3 multipart
});

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modèles/limites
const EMBEDDING_MODEL   = process.env.ASK_VEEVA_EMBEDDINGS || 'text-embedding-3-small'; // 1536 dims
const ANSWER_MODEL      = process.env.ASK_VEEVA_MODEL      || 'gpt-4.1-mini';
const TRANSCRIBE_MODEL  = process.env.ASK_VEEVA_TRANSCRIBE_MODEL || 'whisper-1';
const EMBEDDING_DIMS    = 1536;
const EMBED_BATCH       = Math.max(1, Number(process.env.ASK_VEEVA_EMBED_BATCH || 16));
const MAX_TRANSCRIBE_MB = Number(process.env.ASK_VEEVA_MAX_TRANSCRIBE_MB || 200);
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ASK_VEEVA_MAX_CONCURRENT_JOBS || 1));
const PDF_CHUNK_SIZE    = Math.max(400, Number(process.env.ASK_VEEVA_PDF_CHUNK_SIZE || 1200));
const PDF_CHUNK_OVERLAP = Math.max(0, Number(process.env.ASK_VEEVA_PDF_CHUNK_OVERLAP || 200));

// S3
const S3 = new S3Client({ region: process.env.AWS_REGION });
const S3_BUCKET = process.env.ASK_VEEVA_S3_BUCKET;
const S3_PREFIX = (process.env.ASK_VEEVA_S3_PREFIX || '').replace(/^\/+|\/+$/g, ''); // sans leading/trailing "/"

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
}
await ensureSchema();

// --- Helpers ---
function sha256FileSync(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}
function chunkPush(buffer, newText, outChunks, chunkSize, overlap) {
  let buf = buffer + newText;
  while (buf.length >= chunkSize) {
    outChunks.push(buf.slice(0, chunkSize));
    buf = buf.slice(chunkSize - overlap);
  }
  return buf;
}
async function embedBatch(texts) {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return res.data.map(d => d.embedding);
}
async function insertEmbeddings(client, docId, startIndex, chunks) {
  let idx = startIndex;
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embs = await embedBatch(batch);
    const values = [];
    const params = [];
    let p = 1;
    for (let j = 0; j < batch.length; j++) {
      const vectorLiteral = `[${embs[j].join(',')}]`;
      values.push(`($${p++}, $${p++}, $${p++}, ${`'${vectorLiteral}'`}::vector)`);
      params.push(docId, idx, batch[j]);
      idx++;
    }
    await pool.query(`INSERT INTO askv_chunks (doc_id, chunk_index, text, embedding) VALUES ${values.join(',')}`, params);
    if (global.gc) try { global.gc(); } catch {}
  }
  return idx;
}

// --- PDF indexation streaming + robustesse page ---
async function indexPdfStreaming(client, absPath, relPath, filename, sizeBytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Filtre les warnings TT (facultatif)
  const origWarn = console.warn;
  console.warn = (...args) => {
    const msg = (args && args[0] && String(args[0])) || '';
    if (msg.startsWith('Warning: TT: undefined function:')) return;
    origWarn(...args);
  };

  try {
    if (pdfjs.GlobalWorkerOptions && PDFJS_WORKER) {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
  } catch {}

  const url = `file://${absPath}`;
  const loadingTask = pdfjs.getDocument({
    url,
    standardFontDataUrl: PDFJS_STANDARD_FONTS.endsWith(path.sep) ? PDFJS_STANDARD_FONTS : PDFJS_STANDARD_FONTS + path.sep,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  const docId = crypto.randomUUID();
  const sha256 = sha256FileSync(absPath);
  await client.query(
    `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [docId, filename, 'application/pdf', sizeBytes, sha256, relPath, numPages]
  );

  let chunkBuffer = '';
  let toInsert = [];
  let chunkIndex = 0;

  for (let p = 1; p <= numPages; p++) {
    let pageText = '';
    try {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map(it => ('str' in it ? it.str : (it?.unicode || '')));
      pageText = strings.join(' ') + '\n';
    } catch (e) {
      console.warn(`[pdf] page ${p} ignorée (${filename}) :`, e?.message || e);
      pageText = '';
    }

    chunkBuffer = chunkPush(chunkBuffer, pageText, toInsert, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);

    if (toInsert.length >= EMBED_BATCH * 2) {
      chunkIndex = await insertEmbeddings(client, docId, chunkIndex, toInsert);
      toInsert = [];
    }
    await new Promise(r => setTimeout(r, 1));
  }
  await doc.destroy?.();
  console.warn = origWarn;

  if (chunkBuffer.trim().length) toInsert.push(chunkBuffer);
  if (toInsert.length) {
    await insertEmbeddings(client, docId, chunkIndex, toInsert);
    chunkIndex += toInsert.length;
  }
  return { docId, chunks: chunkIndex, bytes: sizeBytes };
}

// DOCX / Excel / Media (identiques à ta version précédente)
async function extractDocxText(absPath) {
  const buf = await fsp.readFile(absPath);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value || '';
}
function extractExcelLikeToText(absPath) {
  const wb = XLSX.readFile(absPath, { cellDates: true, cellNF: false, cellText: false });
  const lines = [];
  for (const name of wb.SheetNames || []) {
    const ws = wb.Sheets[name]; if (!ws) continue;
    lines.push(`### SHEET: ${name}`);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    for (const row of rows) {
      lines.push((row || []).map(v => v==null?'':String(v)).join('\t'));
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
  try {
    const stream = fs.createReadStream(absPath);
    const resp = await openai.audio.transcriptions.create({ file: stream, model: TRANSCRIBE_MODEL });
    return { text: resp?.text || '', contentType: contentTypeGuess || 'video/mp4' };
  } catch (e) {
    console.error('[transcribeMedia]', e);
    return { text: null, note: `Transcription failed: ${e?.message || e}`, contentType: contentTypeGuess || 'video/mp4' };
  }
}

// Ingestion d’un fichier local (garde tout)
async function ingestSingleFile(client, absSrc, subdir = '') {
  const baseName = path.basename(absSrc);
  const relPath = path.join(subdir, baseName);
  const destAbs = path.join(CORPUS_DIR, relPath);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await fsp.copyFile(absSrc, destAbs);

  const stat = await fsp.stat(destAbs);
  const ext = path.extname(destAbs).toLowerCase();

  if (ext === '.pdf') return await indexPdfStreaming(client, destAbs, relPath, baseName, stat.size);

  if (ext === '.docx') {
    const text = await extractDocxText(destAbs);
    const id = crypto.randomUUID();
    const sha = sha256FileSync(destAbs);
    await pool.query(`INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, baseName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', stat.size, sha, relPath, null]);
    if (text && text.trim()) {
      let buf = '', idx = 0, toIns = [];
      buf = chunkPush(buf, text, toIns, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
      if (buf.trim().length) { toIns.push(buf); buf=''; }
      if (toIns.length) idx = await insertEmbeddings(client, id, idx, toIns);
      return { docId: id, chunks: idx, bytes: stat.size };
    }
    return { docId: id, chunks: 0, bytes: stat.size };
  }

  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const text = extractExcelLikeToText(destAbs);
    const id = crypto.randomUUID();
    const sha = sha256FileSync(destAbs);
    await pool.query(`INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, baseName, 'application/vnd.ms-excel', stat.size, sha, relPath, null]);
    if (text && text.trim()) {
      let buf = '', idx = 0, toIns = [];
      buf = chunkPush(buf, text, toIns, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
      if (buf.trim().length) { toIns.push(buf); buf=''; }
      if (toIns.length) idx = await insertEmbeddings(client, id, idx, toIns);
      return { docId: id, chunks: idx, bytes: stat.size };
    }
    return { docId: id, chunks: 0, bytes: stat.size };
  }

  const MEDIA_EXTS = new Set(['.mp4','.mp3','.m4a','.wav','.webm','.mpeg','.mpga','.ogg']);
  if (MEDIA_EXTS.has(ext)) {
    const { text, note, contentType } = await transcribeMedia(destAbs, null);
    const id = crypto.randomUUID();
    const sha = sha256FileSync(destAbs);
    await pool.query(`INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, baseName, contentType, stat.size, sha, relPath, null]);
    if (!text || !text.trim()) { if (note) console.warn(`[media note] ${baseName}: ${note}`); return { docId: id, chunks: 0, bytes: stat.size }; }
    let buf = '', idx = 0, toIns = [];
    buf = chunkPush(buf, text, toIns, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
    if (buf.trim().length) { toIns.push(buf); buf=''; }
    if (toIns.length) idx = await insertEmbeddings(client, id, idx, toIns);
    return { docId: id, chunks: idx, bytes: stat.size };
  }

  const id = crypto.randomUUID();
  const sha = sha256FileSync(destAbs);
  await pool.query(`INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, baseName, 'application/octet-stream', stat.size, sha, relPath, null]);
  return { docId: id, chunks: 0, bytes: stat.size };
}

// Utils
async function walkFiles(dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkFiles(full));
    else out.push(full);
  }
  return out;
}
async function extractZipTo(zipAbsPath, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  const fd = await fsp.open(zipAbsPath, 'r');
  try {
    const sig = Buffer.alloc(4); await fd.read(sig, 0, 4, 0);
    if (!(sig[0]===0x50 && sig[1]===0x4b)) throw new Error('Fichier non-ZIP ou corrompu (signature invalide)');
  } finally { await fd.close(); }
  const zip = new StreamZip.async({ file: zipAbsPath, storeEntries: true });
  try {
    const entries = await zip.entries();
    const names = Object.keys(entries || {}); if (!names.length) throw new Error('Archive vide');
    for (const name of names) {
      const dest = path.join(outDir, name);
      if (name.endsWith('/')) { await fsp.mkdir(dest, { recursive: true }); continue; }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await zip.extract(name, dest);
    }
  } finally { await zip.close(); }
}

// Jobs + queue
async function createJob(kind, totalFiles = 0) {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO askv_jobs (id, kind, status, total_files, processed_files) VALUES ($1,$2,'queued',$3,0)`, [id, kind, totalFiles]);
  return id;
}
async function updateJob(id, fields = {}) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const set = keys.map((k,i)=>`${k}=$${i+1}`).join(', ')+`, updated_at=now()`;
  const vals = keys.map(k=>fields[k]);
  await pool.query(`UPDATE askv_jobs SET ${set} WHERE id=$${keys.length+1}`, [...vals, id]);
}
async function jobById(id) {
  const { rows } = await pool.query(`SELECT * FROM askv_jobs WHERE id=$1`, [id]);
  return rows[0] || null;
}
const queue = []; let running = 0;
function enqueue(fn){ return new Promise((resolve,reject)=>{ queue.push({fn,resolve,reject}); drain(); });}
async function drain(){ if(running>=MAX_CONCURRENT_JOBS) return; const item=queue.shift(); if(!item) return; running++; try{ const res=await item.fn(); item.resolve(res);}catch(e){ item.reject(e);} finally{ running--; setImmediate(drain);}}

// Runners (local ZIP & files)
async function runIngestZip(jobId, zipAbsPath) {
  await updateJob(jobId, { status: 'running' });
  const workDir = path.join(UPLOAD_DIR, `unz_${path.basename(zipAbsPath, '.zip')}_${Date.now()}`);
  try {
    await extractZipTo(zipAbsPath, workDir);
    const files = await walkFiles(workDir);
    await updateJob(jobId, { total_files: files.length });
    const client = await pool.connect();
    try {
      let processed=0;
      for (const file of files) {
        const subdir = path.relative(workDir, path.dirname(file));
        await ingestSingleFile(client, file, subdir);
        processed++;
        if (processed % 3 === 0 || processed === files.length) await updateJob(jobId, { processed_files: processed });
        await new Promise(r=>setTimeout(r,1));
      }
      await updateJob(jobId, { status:'done', processed_files: files.length });
    } finally { client.release(); }
  } catch(e) {
    console.error('[ingestZip]', e);
    await updateJob(jobId, { status:'error', error:String(e?.message||e) });
  }
}
async function runIngestFiles(jobId, fileAbsPaths) {
  await updateJob(jobId, { status: 'running', total_files: fileAbsPaths.length });
  const client = await pool.connect();
  try {
    let processed=0;
    for (const file of fileAbsPaths) {
      await ingestSingleFile(client, file, '');
      processed++;
      if (processed % 3 === 0 || processed === fileAbsPaths.length) await updateJob(jobId, { processed_files: processed });
      await new Promise(r=>setTimeout(r,1));
    }
    await updateJob(jobId, { status:'done', processed_files: fileAbsPaths.length });
  } catch(e) {
    console.error('[runIngestFiles]', e);
    await updateJob(jobId, { status:'error', error:String(e?.message||e) });
  } finally { client.release(); }
}

// Runner S3 ZIP: télécharge → ingère (streaming disque)
async function runIngestS3Zip(jobId, key) {
  await updateJob(jobId, { status:'running' });
  const tmpZip = path.join(UPLOAD_DIR, `s3_${Date.now()}_${path.basename(key)}`);
  try {
    const obj = await S3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    await new Promise((resolve, reject)=>{
      const ws = fs.createWriteStream(tmpZip);
      obj.Body.pipe(ws);
      obj.Body.on('error', reject);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });
    await runIngestZip(jobId, tmpZip); // réutilise le runner ZIP local
  } catch(e) {
    console.error('[runIngestS3Zip]', e);
    await updateJob(jobId, { status:'error', error:String(e?.message||e) });
  } finally {
    fsp.rm(tmpZip, { force:true }).catch(()=>{});
  }
}

// --- API ---
app.get('/api/ask-veeva/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok:true, service:'ask-veeva', model:ANSWER_MODEL, embeddings:EMBEDDING_MODEL, dims:EMBEDDING_DIMS,
      limits:{ EMBED_BATCH, MAX_CONCURRENT_JOBS, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP, MAX_TRANSCRIBE_MB }});
  } catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

// 1) Petits uploads (<=100 Mo) — conseillés seulement pour tests / petits fichiers
app.post('/api/ask-veeva/uploadZip', upload.single('zip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error:'Aucun fichier reçu (zip)' });
    const jobId = await createJob('zip', 0);
    enqueue(() => runIngestZip(jobId, req.file.path)).catch(e=>console.error('bg ingestZip failed', e));
    res.json({ ok:true, job_id:jobId, queued:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});
app.post('/api/ask-veeva/uploadFiles', upload.array('files', 100), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error:'Aucun fichier reçu' });
    const jobId = await createJob('files', files.length);
    enqueue(() => runIngestFiles(jobId, files.map(f=>f.path))).catch(e=>console.error('bg ingestFiles failed', e));
    res.json({ ok:true, job_id:jobId, queued:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// 2) S3 Multipart — à utiliser pour gros ZIP (pas de 502)
/** Init upload multipart */
app.post('/api/ask-veeva/multipart/create', async (req, res) => {
  try {
    const { filename, contentType } = req.body || {};
    if (!S3_BUCKET) return res.status(400).json({ error:'S3 non configuré' });
    if (!filename) return res.status(400).json({ error:'filename manquant' });
    const key = (S3_PREFIX ? `${S3_PREFIX}/` : '') + `zips/${Date.now()}_${filename.replace(/[^\w.\-]+/g,'_')}`;
    const cmd = new CreateMultipartUploadCommand({ Bucket:S3_BUCKET, Key:key, ContentType: contentType || 'application/zip' });
    const out = await S3.send(cmd);
    res.json({ ok:true, uploadId: out.UploadId, key });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

/** Signer une part (pre-signed URL) */
app.post('/api/ask-veeva/multipart/sign', async (req, res) => {
  try {
    const { key, uploadId, partNumber } = req.body || {};
    if (!key || !uploadId || !partNumber) return res.status(400).json({ error:'key/uploadId/partNumber requis' });
    const cmd = new UploadPartCommand({ Bucket:S3_BUCKET, Key:key, UploadId:uploadId, PartNumber: Number(partNumber) });
    const url = await getSignedUrl(S3, cmd, { expiresIn: 3600 });
    res.json({ ok:true, url });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

/** Compléter l’upload */
app.post('/api/ask-veeva/multipart/complete', async (req, res) => {
  try {
    const { key, uploadId, parts } = req.body || {};
    if (!key || !uploadId || !parts?.length) return res.status(400).json({ error:'key/uploadId/parts requis' });
    const cmd = new CompleteMultipartUploadCommand({
      Bucket:S3_BUCKET, Key:key, UploadId:uploadId,
      MultipartUpload: { Parts: parts.map(p=>({ ETag:p.ETag, PartNumber:Number(p.PartNumber) })) }
    });
    await S3.send(cmd);

    // crée un job d’ingestion depuis S3
    const jobId = await createJob('zip-s3', 0);
    enqueue(() => runIngestS3Zip(jobId, key)).catch(e=>console.error('bg ingestS3Zip failed', e));
    res.json({ ok:true, job_id:jobId, queued:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

/** Annuler (en cas d’échec client) */
app.post('/api/ask-veeva/multipart/abort', async (req, res) => {
  try {
    const { key, uploadId } = req.body || {};
    if (!key || !uploadId) return res.status(400).json({ error:'key/uploadId requis' });
    const cmd = new AbortMultipartUploadCommand({ Bucket:S3_BUCKET, Key:key, UploadId:uploadId });
    await S3.send(cmd);
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// Jobs / Search / Ask (identiques)
app.get('/api/ask-veeva/jobs/:id', async (req, res) => {
  try {
    const j = await jobById(req.params.id);
    if (!j) return res.status(404).json({ error:'job introuvable' });
    res.setHeader('Cache-Control','no-store');
    res.json(j);
  } catch(e){ res.status(500).json({ error:e.message }); }
});
app.post('/api/ask-veeva/search', async (req, res) => {
  try {
    const { query, k=5 } = req.body || {};
    if (!query) return res.status(400).json({ error:'query manquant' });
    const qvec = (await openai.embeddings.create({ model:EMBEDDING_MODEL, input:[query] })).data[0].embedding;
    const vectorLiteral = `[${qvec.join(',')}]`;
    const { rows } = await pool.query(`
      SELECT c.id, c.doc_id, c.chunk_index, c.text,
             d.filename, d.storage_path, d.pages,
             1 - (c.embedding <=> '${vectorLiteral}'::vector) AS score
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ORDER BY c.embedding <-> '${vectorLiteral}'::vector
      LIMIT $1`, [k]);
    res.json({ matches: rows.map(r=>({
      chunk_id:r.id, doc_id:r.doc_id, chunk_index:r.chunk_index,
      snippet:r.text.slice(0,600),
      meta:{ filename:r.filename, storage_path:r.storage_path, pages:r.pages },
      score:Number(r.score)
    }))});
  } catch(e){ res.status(500).json({ error:e.message }); }
});
app.post('/api/ask-veeva/ask', async (req, res) => {
  try {
    const { question, k=6 } = req.body || {};
    if (!question) return res.status(400).json({ error:'question manquante' });
    const qvec = (await openai.embeddings.create({ model:EMBEDDING_MODEL, input:[question] })).data[0].embedding;
    const vectorLiteral = `[${qvec.join(',')}]`;
    const { rows } = await pool.query(`
      SELECT c.id, c.doc_id, c.chunk_index, c.text,
             d.filename, d.storage_path, d.pages
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ORDER BY c.embedding <-> '${vectorLiteral}'::vector
      LIMIT $1`, [k]);

    const context = rows.map((r,i)=>`SOURCE ${i+1} (fichier: ${r.filename})\n${r.text}`).join('\n\n');
    const system = `Tu es Ask Veeva, un assistant de recherche documentaire.
- Réponds en français de façon concise et sourcée.
- Si l’information n’est pas dans le contexte, dis-le.
- Appuie ta réponse sur les extraits fournis et liste les fichiers utilisés en fin de réponse.`;
    const user = `Question:\n${question}\n\nContexte:\n${context}`;

    const resp = await openai.chat.completions.create({
      model: ANSWER_MODEL, temperature: 0.2,
      messages:[{role:'system',content:system},{role:'user',content:user}],
    });
    res.json({ text: resp.choices?.[0]?.message?.content?.trim() || "",
               citations: rows.map(r=>({ filename:r.filename })) });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// Start
app.listen(PORT, () => console.log(`[ask-veeva] service listening on :${PORT}`));
