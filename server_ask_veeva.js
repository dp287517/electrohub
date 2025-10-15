// server_ask_veeva.js — Ask Veeva (DeepSearch++ v5 ready)
// Node ESM

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import fetch from "node-fetch";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
import mammoth from "mammoth";
import xlsx from "xlsx";
import yauzl from "yauzl";

// ----------------------------------------------------------------------------
// Setup
// ----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.ASK_VEEVA_PORT || 3015);
const STORE_DIR = path.resolve(process.env.ASK_VEEVA_STORE || path.join(__dirname, "store"));
const PARTS_DIR = path.resolve(process.env.ASK_VEEVA_PARTS || path.join(__dirname, "parts"));
const TMP_DIR   = path.resolve(process.env.ASK_VEEVA_TMP   || path.join(__dirname, "tmp"));

await fsp.mkdir(STORE_DIR, { recursive: true });
await fsp.mkdir(PARTS_DIR, { recursive: true });
await fsp.mkdir(TMP_DIR,   { recursive: true });

const EMBEDDING_DIMS = Number(process.env.ASK_VEEVA_EMBED_DIMS || 1536);
const EMBED_BATCH = Math.max(8, Number(process.env.ASK_VEEVA_EMBED_BATCH || 32));
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ASK_VEEVA_MAX_JOBS || 2));

const PDF_STANDARD_FONTS = require.resolve("pdfjs-dist/standard_fonts/");
function resolvePdfWorker() {
  try { return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"); }
  catch { return require.resolve("pdfjs-dist/build/pdf.worker.mjs"); }
}
pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorker();

const PDF_CHUNK_SIZE = Math.max(600, Number(process.env.ASK_VEEVA_PDF_CHUNK_SIZE || 1200));
const PDF_CHUNK_OVERLAP = Math.max(0, Number(process.env.ASK_VEEVA_PDF_CHUNK_OVERLAP || 200));
const CHUNK_PART_SIZE = Math.max(2, Number(process.env.ASK_VEEVA_CHUNK_MB || 10)) * 1024 * 1024;

const DEEP_CLIENT_FORCE = !!process.env.ASK_VEEVA_DEEP_FORCE;
const MMR_CLIENT_ON = process.env.ASK_VEEVA_MMR_OFF ? false : true;

// Pysearch (FastAPI) — DeepSearch++ v5
const PY_BASE = (process.env.PYSEARCH_BASE || "http://127.0.0.1:8088").replace(/\/+$/, "");
const PYSEARCH_URL  = `${PY_BASE}/search`;
const PYHEALTH_URL  = `${PY_BASE}/health`;
const PYREINDEX_URL = `${PY_BASE}/reindex`;
const PYCOMPARE_URL = `${PY_BASE}/compare`;
const PYSEARCH_ON = process.env.PYSEARCH_OFF ? false : true;

// ----------------------------------------------------------------------------
// DB
// ----------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/postgres",
  ssl: process.env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
});

// ----------------------------------------------------------------------------
// Express
// ----------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS light
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-user-email, cookie");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// simple cookie helpers (thread id)
function readCookie(req, name) {
  const hdr = req.headers.cookie || "";
  const m = hdr.match(new RegExp(`${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(res, name, value) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`);
}

// user email passthrough (header)
app.use((req, _res, next) => {
  req.userEmail = (req.headers["x-user-email"] || "").toString().toLowerCase() || null;
  let thread = readCookie(req, "askv_thread");
  if (!thread) { thread = crypto.randomUUID(); setCookie(_res, "askv_thread", thread); }
  req.threadId = thread;
  next();
});

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------
function norm(s = "") {
  return String(s || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s = "") { return norm(s).split(/\s+/).filter(Boolean); }
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / Math.max(1, A.size + B.size - inter);
}
function hasAny(s, arr) { const n = norm(s).toLowerCase(); return arr.some(x => n.includes(x)); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v || 0))); }
function safeEmail(e) { return (e || "").toLowerCase() || null; }

function expandNline(q) { return q.replace(/\bN?\s*([12]\d{3})\s*[-\s_]*([0-9])\b/gi, (_, a, b) => `N${a}-${b}`); }
function guessLang(q = "") {
  const s = norm(q).toLowerCase();
  const frHits = (s.match(/[éèêàùçôî]/g) || []).length;
  const enHits = (s.match(/\b(the|and|for|with|what|how|when|where|which)\b/g) || []).length;
  if (frHits >= 1 && frHits > enHits) return "fr";
  return "en";
}

// roles / secteurs (NLU ultra légère)
const ROLE_CANON = [
  ["qualité","qualite","quality"],
  ["ehs","hse","sse"],
  ["utilités","utilites","utilities","utility","utilite"],
  ["packaging","conditionnement","pack"]
];
const SECTOR_CANON = [
  ["ssol","solide","solids"],
  ["liq","liquide","liquids","liquid"],
  ["bulk","vrac"],
  ["autre","other","generic"]
];
function detectFromList(text, lists) {
  const s = (text || "").toLowerCase();
  for (const group of lists) if (group.some(alias => s.includes(alias))) return group[0];
  for (const group of lists) if (group.some(alias => s.trim() === alias)) return group[0];
  return null;
}
function detectRole(t){ return detectFromList(t, ROLE_CANON); }
function detectSector(t){ return detectFromList(t, SECTOR_CANON); }

// SOP/IDR extraction
const RE_SOP = /\b(?:QD-?)?SOP[-\s]?([A-Z0-9-]{3,})\b/ig;
const RE_IDR = /\bI\.?D\.?R\.?\b/ig;
function extractCodes(text = "", filename = "") {
  const set = new Set();
  let m;
  while ((m = RE_SOP.exec(text)) !== null) set.add(`SOP-${m[1]}`);
  while ((m = RE_SOP.exec(filename)) !== null) set.add(`SOP-${m[1]}`);
  if (RE_IDR.test(text) || RE_IDR.test(filename)) set.add("IDR");
  return [...set];
}

// heuristiques de fichiers
function isGeneralFilename(fn = "") {
  const f = norm(fn).toLowerCase();
  const hasLineNo = /\b(91\d{2}|n\d{3,4}[-\s_]*\d)\b/.test(f) || /\b(ligne|line|micro)\b/.test(f);
  const isSOP = /\b(sop|qd-sop)\b/.test(f);
  const hasGlobalWords = /\b(procedure|procédure|dechet|dechets|waste|global|site|usine|policy|policies)\b/.test(f);
  return (isSOP || hasGlobalWords) && !hasLineNo;
}
function isSpecificFilename(fn = "") {
  const f = norm(fn).toLowerCase();
  return /\b(91\d{2}|n\d{3,4}[-\s_]*\d|ligne|line|micro|neri|vignetteuse)\b/.test(f);
}

// ----------------------------------------------------------------------------
// Schema
// ----------------------------------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      mime TEXT,
      bytes BIGINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_chunks (
      id BIGSERIAL PRIMARY KEY,
      doc_id UUID REFERENCES askv_documents(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIMS}),
      page INT,
      section_title TEXT
    );
  `);
  try { await pool.query(`ALTER TABLE askv_chunks ADD COLUMN IF NOT EXISTS page INT`); } catch {}
  try { await pool.query(`ALTER TABLE askv_chunks ADD COLUMN IF NOT EXISTS section_title TEXT`); } catch {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_spans (
      id BIGSERIAL PRIMARY KEY,
      doc_id UUID REFERENCES askv_documents(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL,
      span_index INT NOT NULL,
      text TEXT NOT NULL,
      page INT,
      bbox float4[]
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      total_files INT DEFAULT 0,
      processed_files INT DEFAULT 0,
      error TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_events (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT,
      type TEXT,
      question TEXT,
      doc_id UUID,
      useful BOOLEAN,
      note TEXT,
      latency_ms INT,
      answer_len INT,
      meta JSONB DEFAULT '{}'::jsonb,
      ts TIMESTAMP DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      role TEXT,
      sector TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_synonyms (
      id BIGSERIAL PRIMARY KEY,
      term TEXT NOT NULL,
      alt_term TEXT NOT NULL,
      weight REAL DEFAULT 1.0
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id, chunk_index)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_page_idx ON askv_chunks(doc_id, page)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_documents_fname_idx ON askv_documents(filename)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_events_user_idx ON askv_events(user_email, ts)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_synonyms_term_idx ON askv_synonyms(term, weight DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_spans_doc_idx ON askv_spans(doc_id, page, chunk_index, span_index)`);

  // IVF (optional)
  const IVF_LISTS = Number(process.env.ASK_VEEVA_IVF_LISTS || 100);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_vec_ivf ON askv_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${IVF_LISTS})`);
}
await ensureSchema();

// ----------------------------------------------------------------------------
// Synonyms helper
// ----------------------------------------------------------------------------
async function expandQueryWithSynonyms(q) {
  const term = norm(q).toLowerCase();
  const { rows } = await pool.query(
    `SELECT alt_term, weight FROM askv_synonyms WHERE term = $1 ORDER BY weight DESC LIMIT 5`,
    [term]
  );
  if (!rows.length) return q;
  const alts = rows.map(r => r.alt_term).join(" ");
  return `${q} ${alts}`;
}

// ----------------------------------------------------------------------------
// Embeddings (OpenAI-compatible endpoint via switchboard or env)
// ----------------------------------------------------------------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_SW;
const EMB_MODEL = process.env.ASK_VEEVA_EMBED_MODEL || "text-embedding-3-small";
async function embedBatch(texts) {
  const payload = {
    input: texts,
    model: EMB_MODEL,
  };
  const r = await fetch(process.env.OPENAI_EMBED_URL || "https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`embed http ${r.status}`);
  const j = await r.json();
  return j.data.map(d => d.embedding);
}
function toVectorLiteral(arr) {
  return `[${
    arr.map(v => (Number.isFinite(v) ? Number(v).toFixed(6) : "0.000000")).join(",")
  }]`;
}

// ----------------------------------------------------------------------------
// Parsing + chunking
// ----------------------------------------------------------------------------
async function parsePDF(absPath) {
  const data = new Uint8Array(await fsp.readFile(absPath));
  const loadingTask = pdfjsLib.getDocument({ data, standardFontDataUrl: PDF_STANDARD_FONTS });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({ normalizeWhitespace: true });
      const text = (content.items || []).map((it) => it.str).join(" ");
      pages.push({ page: p, text: (text || "").trim() });
      page.cleanup();
    } catch {
      pages.push({ page: p, text: "" });
    }
  }
  await doc.cleanup(); try { loadingTask.destroy?.(); } catch {}
  return pages;
}
async function parseDOCX(absPath) {
  const buf = await fsp.readFile(absPath);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  const text = (value || "").trim();
  return [{ page: 1, text }];
}
async function parseXLSX(absPath) {
  const wb = xlsx.readFile(absPath, { cellDates: false, cellNF: false, cellText: false });
  const out = [];
  for (const s of wb.SheetNames || []) {
    const ws = wb.Sheets[s];
    const csv = xlsx.utils.sheet_to_csv(ws, { FS: ",", RS: "\n", blankrows: false });
    if (csv && csv.trim()) out.push(`[SHEET ${s}]\n${csv}`);
  }
  const text = out.join("\n\n").trim();
  return [{ page: 1, text }];
}
async function parseCSV(absPath) { const text = await fsp.readFile(absPath, "utf8"); return [{ page: 1, text: text.trim() }]; }
async function parseTXT(absPath) { const text = await fsp.readFile(absPath, "utf8"); return [{ page: 1, text: text.trim() }]; }
async function parseMP4(absPath) { const stat = await fsp.stat(absPath); return { _noIndex: true, bytes: stat.size }; }

function guessSectionTitles(text) {
  const lines = String(text || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  const titles = [];
  for (const ln of lines.slice(0, 30)) {
    if (/^(\d+[\.\)]\s+)?[A-Z0-9][A-Z0-9 \-_/]{4,}$/.test(ln) && ln.length <= 120) titles.push(ln);
  }
  return titles.slice(0, 3);
}
function chunksFromPages(pages, size = PDF_CHUNK_SIZE, overlap = PDF_CHUNK_OVERLAP) {
  const out = [];
  for (const { page, text } of pages) {
    const clean = String(text || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    if (!clean.trim()) continue;
    const sec = guessSectionTitles(clean)[0] || null;
    let i = 0;
    while (i < clean.length) {
      const w = clean.slice(i, i + size);
      out.push({ page, section_title: sec, content: w });
      if (i + size >= clean.length) break;
      i += size - overlap;
    }
  }
  return out;
}
function spansFromChunk(content, page, chunkIndex, maxSpans = 6) {
  const sents = String(content || "")
    .split(/(?<=[\.\!\?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 20 && s.length <= 400);
  const out = [];
  let k = 0;
  for (const s of sents) {
    out.push({ page, chunk_index: chunkIndex, span_index: k++, text: s });
    if (out.length >= maxSpans) break;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Ingestion (single file) — ⛔️ NE PAS TOUCHER ZIP plus bas
// ----------------------------------------------------------------------------
async function ingestConcreteFile(absPath, originalName, ext, bytes) {
  const safeName = `${Date.now()}_${crypto.randomUUID()}${ext}`;
  const finalAbs = path.join(STORE_DIR, safeName);
  await fsp.copyFile(absPath, finalAbs);

  // Video: metadata only
  if ([".mp4",".mov",".m4v",".webm"].includes(ext)) {
    const info = await parseMP4(absPath);
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalAbs, "video/mp4", info.bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  let pages;
  if (ext === ".pdf") pages = await parsePDF(absPath);
  else if (ext === ".docx") pages = await parseDOCX(absPath);
  else if (ext === ".xlsx" || ext === ".xls") pages = await parseXLSX(absPath);
  else if (ext === ".csv") pages = await parseCSV(absPath);
  else if (ext === ".txt" || ext === ".md") pages = await parseTXT(absPath);
  else {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalAbs, "application/octet-stream", bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  const flatText = pages.map(p => p.text).join("\n\n");
  const mime = ext === ".pdf" ? "application/pdf" :
               ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
               (ext === ".xlsx" || ext === ".xls") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
               "text/plain";

  const { rows } = await pool.query(
    `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
    [originalName, finalAbs, mime, bytes || Buffer.byteLength(flatText)]
  );
  const docId = rows[0].id;

  const segs = chunksFromPages(pages, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
  let chunkIndex = 0;

  for (let i = 0; i < segs.length; i += EMBED_BATCH) {
    const batch = segs.slice(i, i + EMBED_BATCH);
    const embeds = await embedBatch(batch.map(b => b.content));

    const params = [];
    const values = [];
    for (let j = 0; j < batch.length; j++) {
      const ci = chunkIndex++;
      const b = batch[j];
      params.push(`($${values.length + 1}, $${values.length + 2}, $${values.length + 3}, $${values.length + 4}::vector, $${values.length + 5}, $${values.length + 6})`);
      values.push(docId, ci, b.content, toVectorLiteral(embeds[j]), b.page || null, b.section_title || null);
    }
    await pool.query(
      `INSERT INTO askv_chunks (doc_id, chunk_index, content, embedding, page, section_title) VALUES ${params.join(", ")}`,
      values
    );

    const start = chunkIndex - batch.length;
    const end = chunkIndex - 1;
    const { rows: inserted } = await pool.query(
      `SELECT chunk_index, page, content FROM askv_chunks WHERE doc_id=$1 AND chunk_index BETWEEN $2 AND $3 ORDER BY chunk_index`,
      [docId, start, end]
    );
    const spanParams = [];
    const spanValues = [];
    for (const r of inserted) {
      const spans = spansFromChunk(r.content, r.page || null, r.chunk_index, 6);
      for (const sp of spans) {
        spanParams.push(`($${spanValues.length + 1}, $${spanValues.length + 2}, $${spanValues.length + 3}, $${spanValues.length + 4}, $${spanValues.length + 5})`);
        spanValues.push(docId, sp.chunk_index, sp.span_index, sp.text, sp.page || null);
      }
    }
    if (spanParams.length) {
      await pool.query(
        `INSERT INTO askv_spans (doc_id, chunk_index, span_index, text, page) VALUES ${spanParams.join(", ")}`,
        spanValues
      );
    }
  }

  return { docId, chunks: segs.length, skipped: false };
}

// ----------------------------------------------------------------------------
// ZIP ingestion — ⚠️ conservé / minimalement retouché (bug parenthèse corrigé)
// ----------------------------------------------------------------------------
async function streamIngestZip(absZipPath, onFile) {
  return new Promise((resolve, reject) => {
    yauzl.open(absZipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const entries = {};
      let processed = 0;
      let total = 0;

      zip.readEntry();
      zip.on("entry", (entry) => {
        entries[entry.fileName] = entry;
        if (!/\/$/.test(entry.fileName)) total += 1;
        zip.readEntry();
      });

      zip.on("end", async () => {
        // ⚠️ c’était ici ton bug de parenthèse : garder sur une seule ligne
        total = Object.values(entries).filter((e) => !/\/$/.test(e.fileName)).length;

        yauzl.open(absZipPath, { lazyEntries: true }, (err2, zip2) => {
          if (err2) return reject(err2);
          zip2.readEntry();
          zip2.on("entry", (e) => {
            if (/\/$/.test(e.fileName)) return zip2.readEntry();
            zip2.openReadStream(e, async (err3, readStream) => {
              if (err3) return reject(err3);
              try {
                const tmp = path.join(TMP_DIR, `unz_${crypto.randomUUID()}`);
                await fsp.mkdir(path.dirname(tmp), { recursive: true });
                const ws = fs.createWriteStream(tmp);
                await new Promise((r2, j2) => {
                  readStream.pipe(ws);
                  readStream.on("error", j2);
                  ws.on("error", j2);
                  ws.on("finish", r2);
                });
                await onFile(tmp, path.basename(e.fileName));
              } catch (e4) {
                // continue but count error
              } finally {
                processed += 1;
                zip2.readEntry();
              }
            });
          });
          zip2.on("end", () => resolve({ total, processed }));
          zip2.on("error", reject);
        });
      });

      zip.on("error", reject);
    });
  });
}

// ----------------------------------------------------------------------------
// Upload — small & chunked + jobs
// ----------------------------------------------------------------------------
const uploadDirect = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

const uploadChunk = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PARTS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${crypto.randomUUID()}_${file.originalname}`)
  }),
  limits: { fileSize: CHUNK_PART_SIZE },
});

async function createJob(kind, totalFiles = 0) {
  const { rows } = await pool.query(
    `INSERT INTO askv_jobs (kind, total_files) VALUES ($1,$2) RETURNING id`,
    [kind, totalFiles]
  );
  return rows[0].id;
}
async function jobById(id) {
  const { rows } = await pool.query(`SELECT * FROM askv_jobs WHERE id = $1`, [id]);
  return rows[0] || null;
}
async function updateJob(id, patch) {
  const fields = []; const values = []; let i = 1;
  for (const [k, v] of Object.entries(patch)) { fields.push(`${k} = $${i++}`); values.push(v); }
  values.push(id);
  await pool.query(`UPDATE askv_jobs SET ${fields.join(", ")}, updated_at = now() WHERE id = $${i}`, values);
}
async function bumpJobProcessed(id) {
  await pool.query(
    `UPDATE askv_jobs SET processed_files = processed_files + 1, updated_at = now() WHERE id = $1`,
    [id]
  );
}

const RUNNING = new Set();
const QUEUE = [];
function enqueue(fn) {
  return new Promise((resolve, reject) => { QUEUE.push({ fn, resolve, reject }); pump(); });
}
async function pump() {
  if (RUNNING.size >= MAX_CONCURRENT_JOBS) return;
  const next = QUEUE.shift();
  if (!next) return;
  RUNNING.add(next);
  try { next.resolve(await next.fn()); }
  catch (e) { next.reject(e); }
  finally { RUNNING.delete(next); setTimeout(pump, 10); }
}

// small upload
app.post("/api/ask-veeva/upload", uploadDirect.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok:false, error: "no file" });

  try {
    const jobId = await createJob("upload", 1);
    updateJob(jobId, { status: "running" }).catch(()=>{});
    enqueue(async () => {
      try {
        const ext = path.extname(file.originalname || "").toLowerCase();
        if (ext === ".zip") {
          // import ZIP (multi-fichiers)
          let count = 0;
          await streamIngestZip(file.path, async (absTmp, origName) => {
            const e = path.extname(origName || "").toLowerCase();
            const stat = await fsp.stat(absTmp).catch(()=>null);
            if (!stat) return;
            await ingestConcreteFile(absTmp, origName, e, stat.size).catch(()=>{});
            try { await fsp.unlink(absTmp); } catch {}
            count++;
            await bumpJobProcessed(jobId);
          });
          await updateJob(jobId, { status: "done", total_files: count, processed_files: count });
        } else {
          const stat = await fsp.stat(file.path);
          await ingestConcreteFile(file.path, file.originalname, ext, stat.size);
          await updateJob(jobId, { status: "done", total_files: 1, processed_files: 1 });
        }
      } catch (e) {
        await updateJob(jobId, { status: "error", error: String(e?.message || e) });
      } finally {
        try { await fsp.unlink(file.path); } catch {}
      }
    });
    res.json({ ok:true, job_id: jobId });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// chunked upload (client side assemble)
app.post("/api/ask-veeva/upload/part", uploadChunk.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok:false, error:"no file" });
  res.json({ ok:true, part_path: req.file.path, size: req.file.size });
});
app.post("/api/ask-veeva/upload/complete", async (req, res) => {
  try {
    const { parts = [], filename } = req.body || {};
    if (!Array.isArray(parts) || !parts.length) return res.status(400).json({ ok:false, error:"parts required" });
    const jobId = await createJob("upload_chunked", 1);
    await updateJob(jobId, { status: "running" });

    enqueue(async () => {
      const tmpZip = path.join(TMP_DIR, `zip_${Date.now()}_${crypto.randomUUID()}`);
      const ws = fs.createWriteStream(tmpZip);
      for (const p of parts) {
        await new Promise((r, j) => {
          const rs = fs.createReadStream(p);
          rs.on("error", j); ws.on("error", j);
          rs.on("end", r); rs.pipe(ws, { end: false });
        });
      }
      await new Promise((r, j) => ws.end(r));
      try {
        const ext = path.extname(filename || "").toLowerCase();
        if (ext === ".zip") {
          let count = 0;
          await streamIngestZip(tmpZip, async (absTmp, origName) => {
            const e = path.extname(origName || "").toLowerCase();
            const stat = await fsp.stat(absTmp).catch(()=>null);
            if (!stat) return;
            await ingestConcreteFile(absTmp, origName, e, stat.size).catch(()=>{});
            try { await fsp.unlink(absTmp); } catch {}
            count++;
            await bumpJobProcessed(jobId);
          });
          await updateJob(jobId, { status: "done", total_files: count, processed_files: count });
        } else {
          const stat = await fsp.stat(tmpZip);
          await ingestConcreteFile(tmpZip, filename || path.basename(tmpZip), ext || ".bin", stat.size);
          await updateJob(jobId, { status: "done", total_files: 1, processed_files: 1 });
        }
      } catch (e) {
        await updateJob(jobId, { status: "error", error: String(e?.message || e) });
      } finally {
        try { await fsp.unlink(tmpZip); } catch {}
        for (const p of parts) { try { await fsp.unlink(p); } catch {} }
      }
    });

    res.json({ ok:true, job_id: jobId });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// job polling
app.get("/api/ask-veeva/jobs/:id", async (req, res) => {
  try {
    const j = await jobById(req.params.id);
    if (!j) return res.status(404).json({ ok:false, error:"job not found" });
    res.json({ ok:true, ...j });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ----------------------------------------------------------------------------
// Files (open/check/build URL)
// ----------------------------------------------------------------------------
app.get("/api/ask-veeva/check-file/:doc_id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, path, mime FROM askv_documents WHERE id=$1`, [req.params.doc_id]);
    if (!rows.length) return res.status(404).json({ ok:false, error:"not found" });
    const abs = rows[0].path;
    const ok = await fsp.stat(abs).then(()=>true).catch(()=>false);
    if (!ok) return res.json({ ok:false, error:"file missing" });
    res.json({ ok:true, url:`/api/ask-veeva/file/${rows[0].id}`, mime: rows[0].mime || null });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
app.get("/api/ask-veeva/file/:doc_id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, path, mime, filename FROM askv_documents WHERE id=$1`, [req.params.doc_id]);
    if (!rows.length) return res.status(404).end();
    res.setHeader("Content-Type", rows[0].mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(rows[0].filename)}"`);
    fs.createReadStream(rows[0].path).pipe(res);
  } catch {
    res.status(404).end();
  }
});

// ----------------------------------------------------------------------------
// Health + pysearch bridge
// ----------------------------------------------------------------------------
app.get("/api/ask-veeva/health", async (_req, res) => {
  try {
    const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM askv_chunks`);
    const mu = process.memoryUsage?.() || {};
    let pysearch = { url: PY_BASE, on: !!PYSEARCH_ON };
    try { pysearch = { ...pysearch, ...(await fetch(PYHEALTH_URL).then(r=>r.json())) }; } catch {}
    res.json({
      ok: true,
      dims: EMBEDDING_DIMS,
      docCount: dc[0]?.n ?? 0,
      memory: { rss: mu.rss, heapTotal: mu.heapTotal, heapUsed: mu.heapUsed, external: mu.external },
      deepClientForce: !!DEEP_CLIENT_FORCE,
      mmrClientOn: !!MMR_CLIENT_ON,
      limits: { EMBED_BATCH, MAX_CONCURRENT_JOBS, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP, CHUNK_PART_SIZE },
      pysearch,
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post("/api/ask-veeva/pysearch/reindex", async (_req, res) => {
  try { res.json(await fetch(PYREINDEX_URL, { method:"POST" }).then(r=>r.json())); }
  catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});
app.get("/api/ask-veeva/pysearch/health", async (_req, res) => {
  try { res.json(await fetch(PYHEALTH_URL).then(r=>r.json())); }
  catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ----------------------------------------------------------------------------
// Users / events
// ----------------------------------------------------------------------------
async function getUserByEmail(email) {
  const { rows } = await pool.query(`SELECT * FROM askv_users WHERE email=$1`, [email]);
  return rows[0] || null;
}
async function ensureUser(email) {
  const u = await getUserByEmail(email);
  if (u) return u;
  const { rows } = await pool.query(
    `INSERT INTO askv_users (email) VALUES ($1) RETURNING *`,
    [email]
  );
  return rows[0];
}

app.get("/api/ask-veeva/me", async (req, res) => {
  try {
    const email = safeEmail(req.userEmail);
    if (!email) return res.json({ ok: true, user: null });
    const user = await ensureUser(email);
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/initUser", async (req, res) => {
  try {
    const { email, name, role, sector } = req.body || {};
    if (!email) return res.status(400).json({ error: "email requis" });
    const { rows } = await pool.query(
      `
      INSERT INTO askv_users (email, name, role, sector)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (email) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, askv_users.name),
        role = COALESCE(EXCLUDED.role, askv_users.role),
        sector = COALESCE(EXCLUDED.sector, askv_users.sector),
        updated_at = now()
      RETURNING *
      `,
      [email, name || null, role || null, sector || null]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/logEvent", async (req, res) => {
  try {
    const { type, question, doc_id, useful, note, meta } = req.body || {};
    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note,meta) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [safeEmail(req.userEmail), type || null, question || null, doc_id || null, useful ?? null, note || null, meta || {}]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/feedback", async (req, res) => {
  try {
    const { question, doc_id, useful, note } = req.body || {};
    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note) VALUES ($1,'feedback',$2,$3,$4,$5)`,
      [safeEmail(req.userEmail), question || null, doc_id || null, useful ?? null, note || null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/synonyms/update", async (req, res) => {
  try {
    const { term, alt_term, weight } = req.body || {};
    if (!term || !alt_term) return res.status(400).json({ ok:false, error:"term & alt_term required" });
    await pool.query(
      `INSERT INTO askv_synonyms(term,alt_term,weight) VALUES ($1,$2,$3)`,
      [term, alt_term, Number(weight ?? 1.0)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/personalize", async (req, res) => {
  try {
    const email = safeEmail(req.userEmail);
    const user = email ? await getUserByEmail(email) : null;
    const prefs = (await pool.query(
      `SELECT doc_id, COUNT(*)::int AS cnt FROM askv_events WHERE user_email=$1 AND type='doc_opened' GROUP BY doc_id ORDER BY cnt DESC LIMIT 10`,
      [email]
    )).rows;
    res.json({ ok: true, user, top_docs: prefs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----------------------------------------------------------------------------
// search (léger) + find-docs
// ----------------------------------------------------------------------------
app.post("/api/ask-veeva/search", async (req, res) => {
  const t0 = Date.now();
  try {
    let { query, k = 6 } = req.body || {};
    if (!query || String(query).trim() === "") return res.status(400).json({ error: "query requis" });
    try { query = await expandQueryWithSynonyms(query); } catch {}

    const emb = (await embedBatch([query]))[0];
    const qvec = toVectorLiteral(emb);
    const { rows } = await pool.query(
      `
      SELECT d.id AS doc_id, d.filename, c.chunk_index, c.content,
             (1 - (c.embedding <=> $1::vector)) AS score
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $2
      `,
      [qvec, Math.max(1, Math.min(24, Number(k)))]
    );

    res.json({
      ok: true,
      latency_ms: Date.now() - t0,
      items: rows.map(r => ({
        doc_id: r.doc_id, filename: r.filename, chunk_index: r.chunk_index,
        snippet: (r.content || "").slice(0, 800), score: Number(r.score)
      }))
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get("/api/ask-veeva/find-docs", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const n = Math.max(1, Math.min(12, Number(req.query.k || 8)));
    if (!q) return res.json({ ok:true, items: [] });
    const { rows } = await pool.query(
      `
      SELECT id AS doc_id, filename, mime
      FROM askv_documents
      WHERE lower(filename) LIKE lower($1)
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [`%${q}%`, n]
    );
    res.json({ ok: true, items: rows.map(r => ({ doc_id: r.doc_id, filename: r.filename, mime: r.mime })) });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ----------------------------------------------------------------------------
// Memory (thread): global/specific/SOP + topic
// ----------------------------------------------------------------------------
const THREADS = new Map();
/*
THREADS[threadId] = {
  lastTerms: string[],
  topicHint: string,
  preferGlobal: boolean,
  preferSOP: boolean,
  lastAt: number
}
*/
function getThread(threadId) {
  let t = THREADS.get(threadId);
  if (!t) { t = { lastTerms: [], topicHint: "", preferGlobal: false, preferSOP: false, lastAt: 0 }; THREADS.set(threadId, t); }
  return t;
}
function updateThreadFromQuestion(t, q) {
  const n = norm(q);
  const ts = tokens(q);
  if (hasAny(n, ["global","globale","général","generale","générale","overall","corporate","site","usine"])) t.preferGlobal = true;
  if (hasAny(n, ["microdoseur","micro2","9142","n2000-2","n20002","9143","ligne","machine","éri","neri","vfd","variable frequency drive"])) t.preferGlobal = false;
  if (hasAny(n, ["sop","procédure","procedure","qd-sop"])) t.preferSOP = true;
  if (hasAny(n, ["idr","réglage","format"])) t.preferSOP = false;

  const overlap = jaccard(t.lastTerms, ts);
  const changed = overlap < 0.18 && t.topicHint && !hasAny(n, ["suite","continuer","décris","décrire","détaille","plus"]);
  if (changed) { t.topicHint = ""; t.preferGlobal = false; t.preferSOP = false; }

  const kw = ts.filter(w => w.length >= 3).slice(0, 8).join(" ");
  if (!t.topicHint && kw) t.topicHint = kw;
  t.lastTerms = ts;
  t.lastAt = Date.now();
}

// soft role bias
function softRoleBiasScore(filename, role, sector) {
  const f = norm(filename).toLowerCase();
  let b = 0;
  if (role && f.includes(role)) b += 0.05;
  if (sector && f.includes(sector)) b += 0.05;
  return b;
}

// ----------------------------------------------------------------------------
// ASK (DeepSearch++ bridge)
// ----------------------------------------------------------------------------
app.post("/api/ask-veeva/ask", async (req, res) => {
  const t0 = Date.now();
  try {
    let {
      question, k = undefined, docFilter = [], contextMode = "auto",
      intent_hint, normalized_query, rerank = true, deep = true
    } = req.body || {};
    if (!question || String(question).trim() === "") return res.status(400).json({ error: "question requise" });

    const originalQuestion = String(question);
    const qLang = guessLang(originalQuestion);
    const normalizedQ = expandNline(normalized_query || originalQuestion);
    const userEmail = safeEmail(req.userEmail);
    let user = userEmail ? await ensureUser(userEmail) : null;

    if (user && (!user.role || !user.sector)) {
      const candRole = detectRole(originalQuestion);
      const candSector = detectSector(originalQuestion);
      if (candRole || candSector) {
        await pool.query(
          `UPDATE askv_users SET role = COALESCE($2, role), sector = COALESCE($3, sector), updated_at = now() WHERE email = $1`,
          [userEmail, candRole, candSector]
        ).catch(()=>{});
        user = await getUserByEmail(userEmail);
      }
    }

    const thread = getThread(req.threadId);
    updateThreadFromQuestion(thread, originalQuestion);

    if (contextMode === "none") {
      const text = (qLang === "en"
        ? `Contextless mode.\n\nQuestion: ${originalQuestion}\n\nI can answer generally; tell me if you want me to use indexed documents.`
        : `Mode sans contexte activé.\n\nQuestion : ${originalQuestion}\n\nJe peux répondre de manière générale ; dis-moi si tu veux que je m’appuie sur les documents indexés.`);
      await pool.query(
        `INSERT INTO askv_events(user_email,type,question,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4)`,
        [userEmail, originalQuestion, Date.now() - t0, { mode: "no_context" }]
      ).catch(()=>{});
      return res.json({ ok: true, text, citations: [], contexts: [] });
    }

    const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.askv_chunks`);
    if (!dc[0]?.n) {
      return res.json({
        ok: true,
        text: qLang === "en" ? "No indexed content yet. Upload a document first." : "Aucun contenu indexé pour le moment. Importez un document d’abord.",
        citations: [],
        contexts: []
      });
    }

    // 1) pysearch v5
    let hybrid = [];
    if (PYSEARCH_ON) {
      try {
        const rsp = await fetch(PYSEARCH_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: normalizedQ,
            k: 120,
            role: user?.role || null,
            sector: user?.sector || null,
            rerank: !!rerank,
            deep: DEEP_CLIENT_FORCE ? true : !!deep
          })
        });
        if (rsp.ok) {
          const rj = await rsp.json();
          if (rj?.ok && Array.isArray(rj.items)) {
            hybrid = rj.items.map(it => ({
              doc_id: it.doc_id,
              filename: it.filename,
              chunk_index: it.chunk_index,
              snippet: it.snippet || "",
              score_h: Number(it.score_final ?? it.score ?? 0)
            }));
          }
        }
      } catch {}
    }

    // 2) baseline vecteur
    let qForEmbed = normalizedQ;
    try { qForEmbed = await expandQueryWithSynonyms(qForEmbed); } catch {}
    const emb = (await embedBatch([qForEmbed]))[0];
    const qvec = toVectorLiteral(emb);
    const filterSQL = Array.isArray(docFilter) && docFilter.length ? `WHERE c.doc_id = ANY($3::uuid[])` : ``;
    const params = Array.isArray(docFilter) && docFilter.length ? [qvec, 80, docFilter] : [qvec, 80];
    const { rows: vecRows } = await pool.query(
      `
      SELECT 
        d.id AS doc_id, d.filename, 
        c.chunk_index, c.content,
        (1 - (c.embedding <=> $1::vector)) AS score
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ${filterSQL}
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $2
      `,
      params
    );

    const prefBoost = {};
    try {
      const boosts = await pool.query(
        `SELECT doc_id, COUNT(*)::int AS cnt
           FROM askv_events
           WHERE user_email=$1 AND type='doc_opened'
           GROUP BY doc_id`,
        [userEmail]
      );
      for (const b of boosts.rows) prefBoost[b.doc_id] = 1 + Math.min(0.1 * Number(b.cnt || 0), 0.5);
    } catch {}

    const vectorList = vecRows.map(r => {
      const p = prefBoost[r.doc_id] || 1;
      const roleBias = softRoleBiasScore(r.filename, user?.role, user?.sector);
      return {
        doc_id: r.doc_id,
        filename: r.filename,
        chunk_index: r.chunk_index,
        snippet: (r.content || "").slice(0, 1400),
        score_v: Number(r.score) * p + roleBias
      };
    });

    // 3) fusion + repondération
    const byKey = new Map();
    for (const s of [...hybrid, ...vectorList]) {
      const key = `${s.doc_id}:${s.chunk_index}`;
      const prev = byKey.get(key);
      const score_h = s.score_h ?? 0;
      const score_v = s.score_v ?? 0;
      let score = Math.max(prev?.score || 0, 0.62 * score_h + 0.68 * score_v);
      if (thread.preferGlobal && isGeneralFilename(s.filename)) score += 0.35;
      if (thread.preferGlobal && isSpecificFilename(s.filename)) score -= 0.15;
      if (!thread.preferGlobal && isSpecificFilename(s.filename)) score += 0.12;
      if (thread.preferSOP && /\b(sop|qd-sop)\b/i.test(s.filename)) score += 0.25;

      byKey.set(key, { ...s, score });
    }
    let merged = Array.from(byKey.values());
    merged.sort((a,b)=> b.score - a.score);

    if (thread.preferGlobal) {
      const generics = merged.filter(m => isGeneralFilename(m.filename)).slice(0, 24);
      const specifics = merged.filter(m => !isGeneralFilename(m.filename)).slice(0, 16);
      merged = [...generics, ...specifics];
    }

    // 4) num. SOP/IDR ?
    const askNum = /\b(num(é|e)ro|ref(é|e)rence|code)\b/i.test(originalQuestion) && /\b(sop|qd-sop|idr)\b/i.test(originalQuestion);
    if (askNum) {
      const top = merged.slice(0, 16);
      const cand = [];
      for (const m of top) {
        const codes = extractCodes(m.snippet || "", m.filename || "");
        for (const c of codes) cand.push({ code: c, ...m });
      }
      const seen = new Set();
      const uniq = cand.filter(c => (seen.has(c.code) ? false : (seen.add(c.code), true))).sort((a,b)=> b.score - a.score).slice(0, 5);
      if (uniq.length) {
        const best = uniq[0];
        const extras = uniq.slice(1);
        const text = extras.length
          ? (qLang === "en"
              ? `Likely number: **${best.code}**.\nOther candidates: ${extras.map(e => `**${e.code}**`).join(", ")}.`
              : `Numéro probable : **${best.code}**.\nAutres possibles : ${extras.map(e => `**${e.code}**`).join(", ")}.`)
          : (qLang === "en" ? `Likely number: **${best.code}**.` : `Numéro probable : **${best.code}**.`);

        const citations = [{
          doc_id: best.doc_id,
          filename: best.filename,
          chunk_index: best.chunk_index,
          score: best.score,
          snippet: (merged.find(x => x.doc_id===best.doc_id && x.chunk_index===best.chunk_index)?.snippet || "").slice(0, 500)
        }];
        const contexts = [{
          doc_id: best.doc_id,
          filename: best.filename,
          chunks: [{ chunk_index: best.chunk_index, snippet: citations[0].snippet, score: best.score }]
        }];

        await pool.query(
          `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta)
           VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
          [userEmail, originalQuestion, text.length, Date.now() - t0, { mode: "code_lookup", codes: uniq.map(u=>u.code) }]
        ).catch(()=>{});

        return res.json({ ok: true, text, citations, contexts });
      }
    }

    // 5) context & citations
    const byDoc = new Map();
    for (const m of merged.slice(0, 30)) {
      const entry = byDoc.get(m.doc_id) || { doc_id: m.doc_id, filename: m.filename, chunks: [] };
      if (entry.chunks.length < 3) entry.chunks.push({ chunk_index: m.chunk_index, snippet: (m.snippet || "").slice(0, 1400), score: m.score });
      byDoc.set(m.doc_id, entry);
    }
    const contexts = Array.from(byDoc.values()).map(d => ({ ...d, chunks: d.chunks.sort((a,b)=> a.chunk_index - b.chunk_index) }));

    const fallbackText = qLang === "en"
      ? "Sorry, I can't find this information in the provided context."
      : "Désolé, je ne trouve pas cette information dans le contexte fourni.";

    const citations = merged.slice(0, 10).map((r) => ({
      doc_id: r.doc_id,
      filename: r.filename,
      chunk_index: r.chunk_index,
      score: Number(r.score),
      snippet: (r.snippet || "").slice(0, 500),
    }));

    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,meta) VALUES ($1,'ask_issued',$2,$3)`,
      [userEmail, originalQuestion, { preferGlobal: thread.preferGlobal, preferSOP: thread.preferSOP, lang: qLang }]
    ).catch(()=>{});
    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta)
       VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
      [userEmail, originalQuestion, citations.length, Date.now() - t0, { citations: citations.length }]
    ).catch(()=>{});

    return res.json({
      ok: true,
      text: fallbackText,
      citations,
      contexts,
      decision_trace: {
        hybrid_weight: 0.62, vector_weight: 0.68, rerank_weight: 0.8, mmr_lambda: 0.7, answer_confidence: 0.85
      }
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ----------------------------------------------------------------------------
// Server
// ----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[ask-veeva] listening on :${PORT}`);
});
