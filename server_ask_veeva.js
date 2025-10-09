// server_ask_veeva.js — Ask Veeva (Neon + pgvector + ingestion ZIP/fichiers)
// Démarrage : node server_ask_veeva.js
// Requis: OPENAI_API_KEY, NEON_DATABASE_URL
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
// ⛔️ pdf-parse supprimé
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { OpenAI } from 'openai';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 3015);
const DATA_DIR   = process.env.ASK_VEEVA_DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CORPUS_DIR = path.join(DATA_DIR, 'corpus'); // stockage fichiers extraits
await fsp.mkdir(DATA_DIR, { recursive: true });
await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(CORPUS_DIR, { recursive: true });

// Multer (stockage disque, pour stream & gros fichiers)
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
const EMBEDDING_MODEL = process.env.ASK_VEEVA_EMBEDDINGS || 'text-embedding-3-large'; // 3072 dims
const ANSWER_MODEL    = process.env.ASK_VEEVA_MODEL      || 'gpt-4.1-mini';
const EMBEDDING_DIMS  = 3072;

// --- DB bootstrap (pgvector + tables) ---
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
    CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id);
    CREATE INDEX IF NOT EXISTS askv_chunks_vec_idx ON askv_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    CREATE TABLE IF NOT EXISTS askv_jobs (
      id UUID PRIMARY KEY,
      kind TEXT NOT NULL,              -- 'zip' | 'files'
      status TEXT NOT NULL,            -- 'queued' | 'running' | 'done' | 'error'
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

function chunkText(text, { chunkSize = 1200, overlap = 200 } = {}) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkSize);
    const slice = text.slice(i, end);
    chunks.push(slice);
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

async function embedBatch(texts) {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts
  });
  return res.data.map(d => d.embedding);
}

async function embedQuery(text) {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: [text]
  });
  return res.data[0].embedding;
}

/** Extraction texte PDF via pdfjs-dist (robuste en ESM/Node 22) */
async function extractPdfWithPdfjs(filePath) {
  // import dynamique pour éviter les soucis de chemins en build
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = await fsp.readFile(filePath);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  let fullText = '';
  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(it => ('str' in it ? it.str : (it?.unicode || '')));
    fullText += strings.join(' ') + '\n';
  }
  await doc.destroy?.();
  return { text: fullText, pages: numPages, contentType: 'application/pdf' };
}

async function parseFileToText(fullPath, contentTypeGuess) {
  const ext = path.extname(fullPath).toLowerCase();
  if (ext === '.pdf') {
    try {
      return await extractPdfWithPdfjs(fullPath);
    } catch (e) {
      // fallback: renvoyer vide mais garder la fiche document
      console.error('[PDF parse error]', fullPath, e);
      return { text: '', pages: null, contentType: 'application/pdf' };
    }
  }
  if (ext === '.docx') {
    const buf = await fsp.readFile(fullPath);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: value || '', pages: null, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (ext === '.txt' || ext === '.md' || contentTypeGuess?.startsWith('text/')) {
    const txt = await fsp.readFile(fullPath, 'utf8');
    return { text: txt, pages: null, contentType: contentTypeGuess || 'text/plain' };
  }
  return { text: null, pages: null, contentType: contentTypeGuess || 'application/octet-stream' };
}

async function registerDocument(client, absPath, relPath, filename, contentType, sizeBytes, pages) {
  const id = crypto.randomUUID();
  const sha256 = sha256FileSync(absPath);
  await client.query(
    `INSERT INTO askv_documents (id, filename, content_type, size_bytes, sha256, storage_path, pages)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, filename, contentType, sizeBytes, sha256, relPath, pages]
  );
  return id;
}

async function insertChunksWithEmbeddings(client, docId, chunks) {
  const BATCH = 64;
  let idx = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embeddings = await embedBatch(batch);
    const values = [];
    const params = [];
    let p = 1;
    for (let j = 0; j < batch.length; j++) {
      const text = batch[j];
      const emb = embeddings[j];
      const vectorLiteral = `[${emb.join(',')}]`;
      values.push(`($${p++}, $${p++}, $${p++}, ${`'${vectorLiteral}'`}::vector)`);
      params.push(docId, idx, text);
      idx++;
    }
    const sql = `INSERT INTO askv_chunks (doc_id, chunk_index, text, embedding) VALUES ${values.join(',')}`;
    await client.query(sql, params);
  }
}

async function ingestSingleFile(client, absSrc, subdir = '') {
  const baseName = path.basename(absSrc);
  const relPath = path.join(subdir, baseName);
  const destAbs = path.join(CORPUS_DIR, relPath);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await fsp.copyFile(absSrc, destAbs);

  const stat = await fsp.stat(destAbs);
  const { text, pages, contentType } = await parseFileToText(destAbs, null);

  if (!text || !text.trim()) {
    const docId = await registerDocument(client, destAbs, relPath, baseName, contentType, stat.size, pages);
    return { docId, chunks: 0, bytes: stat.size };
  }

  const docId = await registerDocument(client, destAbs, relPath, baseName, contentType, stat.size, pages);
  const chunks = chunkText(text, { chunkSize: 1200, overlap: 200 });
  await insertChunksWithEmbeddings(client, docId, chunks);
  return { docId, chunks: chunks.length, bytes: stat.size };
}

async function extractZipTo(zipAbsPath, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  await fs.createReadStream(zipAbsPath).pipe(unzipper.Extract({ path: outDir })).promise();
}

async function walkFiles(dir) {
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await walkFiles(full);
      out.push(...sub);
    } else {
      out.push(full);
    }
  }
  return out;
}

// --- Jobs ---
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

// --- Ingestion runners ---
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
        if (processed % 5 === 0 || processed === files.length) {
          await updateJob(jobId, { processed_files: processed });
        }
      }
      await updateJob(jobId, { status: 'done', processed_files: files.length });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[ingestZip]', e);
    await updateJob(jobId, { status: 'error', error: String(e?.message || e) });
  } finally {
    // Nettoyage optionnel
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
      if (processed % 5 === 0 || processed === fileAbsPaths.length) {
        await updateJob(jobId, { processed_files: processed });
      }
    }
    await updateJob(jobId, { status: 'done', processed_files: fileAbsPaths.length });
  } catch (e) {
    console.error('[runIngestFiles]', e);
    await updateJob(jobId, { status: 'error', error: String(e?.message || e) });
  } finally {
    client.release();
  }
}

// --- API ---
app.get('/api/ask-veeva/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'ask-veeva', model: ANSWER_MODEL, embeddings: EMBEDDING_MODEL });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** ZIP -> job async (champ "zip") */
app.post('/api/ask-veeva/uploadZip', upload.single('zip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu (zip)' });
    const jobId = await createJob('zip', 0);
    runIngestZip(jobId, req.file.path).catch(e => console.error('bg ingestZip failed', e));
    res.json({ ok: true, job_id: jobId });
  } catch (e) {
    console.error('[uploadZip]', e);
    res.status(500).json({ error: e.message });
  }
});

/** Multi-fichiers -> job async (champ "files") */
app.post('/api/ask-veeva/uploadFiles', upload.array('files', 2000), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const jobId = await createJob('files', files.length);
    runIngestFiles(jobId, files.map(f => f.path)).catch(e => console.error('bg ingestFiles failed', e));
    res.json({ ok: true, job_id: jobId });
  } catch (e) {
    console.error('[uploadFiles]', e);
    res.status(500).json({ error: e.message });
  }
});

/** Statut job */
app.get('/api/ask-veeva/jobs/:id', async (req, res) => {
  try {
    const j = await jobById(req.params.id);
    if (!j) return res.status(404).json({ error: 'job introuvable' });
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Recherche sémantique */
app.post('/api/ask-veeva/search', async (req, res) => {
  try {
    const { query, k = 5 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query manquant' });

    const qvec = await embedQuery(query);
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
      chunk_id: r.id,
      doc_id: r.doc_id,
      chunk_index: r.chunk_index,
      snippet: r.text.slice(0, 600),
      meta: { filename: r.filename, storage_path: r.storage_path, pages: r.pages },
      score: Number(r.score)
    }));
    res.json({ matches });
  } catch (e) {
    console.error('[search]', e);
    res.status(500).json({ error: e.message });
  }
});

/** Q/R */
app.post('/api/ask-veeva/ask', async (req, res) => {
  try {
    const { question, k = 6 } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question manquante' });

    const qvec = await embedQuery(question);
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

    const contextBlocks = rows.map((r, i) => `SOURCE ${i + 1} (fichier: ${r.filename})
${r.text}`).join('\n\n');
    const citations = rows.map(r => ({ filename: r.filename }));

    const system = `Tu es Ask Veeva, un assistant de recherche documentaire.
- Réponds en français de façon concise et sourcée.
- Si l’information n’est pas dans le contexte, dis-le.
- Appuie ta réponse sur les extraits fournis et liste les fichiers utilisés en fin de réponse.`;

    const user = `Question:
${question}

Contexte:
${contextBlocks}`;

    const resp = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ text, citations });
  } catch (e) {
    console.error('[ask]', e);
    res.status(500).json({ error: e.message });
  }
});

// -------- Start -----------
app.listen(PORT, () => console.log(`Ask Veeva service listening on :${PORT}`));
