// server_ask_veeva.js — microservice Ask Veeva (port 3015)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// sécurité minimale + CORS (utilisé derrière proxy, mais utile en dev direct)
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Upload mémoire (on réécrit ensuite sur disque)
const upload = multer({ storage: multer.memoryStorage() });

// Dossiers data
const DATA_DIR   = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CORPUS_DIR = path.join(DATA_DIR, 'corpus');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

await fsp.mkdir(DATA_DIR, { recursive: true });
await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(CORPUS_DIR, { recursive: true });

/** OpenAI */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = process.env.ASK_VEEVA_EMBEDDINGS || 'text-embedding-3-large';
const ANSWER_MODEL    = process.env.ASK_VEEVA_MODEL      || 'gpt-4.1-mini';

/** Utils */
function cosine(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (na * nb + 1e-10);
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
async function embed(texts) {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}

async function extractZipTo(zipBuffer, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const tmpPath = path.join(UPLOAD_DIR, `${Date.now()}_${Math.random().toString(36).slice(2)}.zip`);
  await fsp.writeFile(tmpPath, zipBuffer);
  await fs.createReadStream(tmpPath).pipe(unzipper.Extract({ path: destDir })).promise();
  await fsp.unlink(tmpPath);
}

async function loadTextFromFile(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (ext === '.pdf') {
    const buf = await fsp.readFile(fullPath);
    const parsed = await pdfParse(buf);
    return { text: parsed.text || '', pages: parsed.numpages || undefined };
  }
  if (ext === '.docx') {
    const buf = await fsp.readFile(fullPath);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: value || '' };
  }
  if (ext === '.txt' || ext === '.md') {
    const txt = await fsp.readFile(fullPath, 'utf8');
    return { text: txt };
  }
  // autres extensions ignorées
  return null;
}

async function buildIndexFromCorpus() {
  const files = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(CORPUS_DIR);

  const docs = [];
  for (const f of files) {
    const loaded = await loadTextFromFile(f);
    if (!loaded || !loaded.text?.trim()) continue;
    const rel = path.relative(CORPUS_DIR, f);
    const chunks = chunkText(loaded.text);
    for (let i = 0; i < chunks.length; i++) {
      const id = crypto.createHash('md5').update(rel + '#' + i).digest('hex');
      docs.push({ id, text: chunks[i], meta: { filename: rel } });
    }
  }

  if (docs.length === 0) {
    await fsp.writeFile(INDEX_PATH, JSON.stringify({ vectors: [], dims: 0 }));
    return { files: 0, chunks: 0 };
  }

  const embeddings = await embed(docs.map((d) => d.text));
  const dims = embeddings[0]?.length || 0;
  const vectors = docs.map((d, i) => ({ id: d.id, embedding: embeddings[i], meta: d.meta, text: d.text }));

  await fsp.writeFile(INDEX_PATH, JSON.stringify({ vectors, dims }));
  return { files: new Set(vectors.map(v => v.meta.filename)).size, chunks: vectors.length };
}

async function ensureIndexExists() {
  try { await fsp.access(INDEX_PATH); }
  catch { await fsp.writeFile(INDEX_PATH, JSON.stringify({ vectors: [], dims: 0 })); }
}

async function searchIndex(query, k = 5) {
  await ensureIndexExists();
  const raw = JSON.parse(await fsp.readFile(INDEX_PATH, 'utf8'));
  if (!raw.vectors?.length) return [];
  const [qvec] = await embed([query]);
  const scored = raw.vectors.map(v => ({ ...v, score: cosine(qvec, v.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(v => ({ snippet: v.text.slice(0, 600), meta: v.meta, score: v.score }));
}

/** Routes */
app.get('/api/ask-veeva/health', (_req, res) => {
  res.json({ ok: true, service: 'ask-veeva', model: ANSWER_MODEL, embeddings: EMBEDDING_MODEL });
});

app.post('/api/ask-veeva/upload', upload.single('zip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier .zip reçu' });
    // 1) Purge corpus
    await fsp.rm(CORPUS_DIR, { recursive: true, force: true });
    await fsp.mkdir(CORPUS_DIR, { recursive: true });
    // 2) Extraction
    await extractZipTo(req.file.buffer, CORPUS_DIR);
    // 3) Indexation
    const stats = await buildIndexFromCorpus();
    res.json({ ok: true, stats });
  } catch (e) {
    console.error('[upload]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ask-veeva/search', async (req, res) => {
  try {
    const { query, k = 5 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query manquant' });
    const matches = await searchIndex(query, k);
    res.json({ matches });
  } catch (e) {
    console.error('[search]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ask-veeva/ask', async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question manquante' });

    const matches = await searchIndex(question, 6);
    const contextBlocks = matches.map((m, i) => `SOURCE ${i + 1} (fichier: ${m.meta.filename})\n${m.snippet}`).join('\n\n');
    const citations = matches.map((m) => ({ filename: m.meta.filename }));

    const system = `Tu es Ask Veeva, un assistant de recherche documentaire.
- Réponds en français.
- Si l’information n’est pas dans le contexte, dis-le clairement.
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

// -------- Start (port 3015) -----------
const PORT = Number(process.env.PORT || 3015);
app.listen(PORT, () => console.log(`Ask Veeva service listening on :${PORT}`));
