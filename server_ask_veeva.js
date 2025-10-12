// server_ask_veeva.js — Ask Veeva (hybrid retriever + topic memory + global/specific intent + SOP/IDR resolver)
// Node ESM

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import pg from "pg";
import { fileURLToPath } from "url";

// Polyfill fetch (Node <18) ou sécurisation (Node 18+ ok)
let _fetch = globalThis.fetch;
try {
  if (typeof _fetch !== "function") {
    const { default: nf } = await import("node-fetch");
    _fetch = nf;
  }
} catch {
  const { default: nf } = await import("node-fetch");
  _fetch = nf;
}
globalThis.fetch = _fetch;

// OpenAI (embeddings + réponses)
import OpenAI from "openai";

// ZIP streaming
import StreamZip from "node-stream-zip";

// PDF.js (Node): legacy ESM build
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// DOCX/XLSX/CSV/TXT parsers
import mammoth from "mammoth";
import xlsx from "xlsx";

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

const PORT = Number(process.env.ASK_VEEVA_PORT || 3015);
const HOST = process.env.ASK_VEEVA_HOST || "127.0.0.1";

// Dossiers
const DATA_ROOT = path.join(process.cwd(), "uploads", "ask-veeva");
const UPLOAD_DIR = path.join(DATA_ROOT, "incoming");
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const PARTS_DIR = path.join(DATA_ROOT, "parts");
const STORE_DIR = path.join(DATA_ROOT, "store");

await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(TMP_DIR, { recursive: true });
await fsp.mkdir(PARTS_DIR, { recursive: true });
await fsp.mkdir(STORE_DIR, { recursive: true });

// -----------------------------------------------------------------------------
// PDF.js (Node): legacy build + standard fonts
// -----------------------------------------------------------------------------
function resolvePdfWorker() {
  try {
    return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    return require.resolve("pdfjs-dist/build/pdf.worker.mjs");
  }
}
const workerSrc = resolvePdfWorker();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
const PDF_STANDARD_FONTS = path.join(pdfjsPkgDir, "standard_fonts/");

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = process.env.ASK_VEEVA_EMBED_MODEL || "text-embedding-3-small"; // 1536 dims
const EMBEDDING_DIMS = 1536;
const ANSWER_MODEL = process.env.ASK_VEEVA_ANSWER_MODEL || "gpt-4o-mini";

// Performances
const EMBED_BATCH = Math.max(4, Number(process.env.ASK_VEEVA_EMBED_BATCH || 8));
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ASK_VEEVA_MAX_CONCURRENT_JOBS || 1));
const PDF_CHUNK_SIZE = Math.max(600, Number(process.env.ASK_VEEVA_PDF_CHUNK_SIZE || 1200));
const PDF_CHUNK_OVERLAP = Math.max(0, Number(process.env.ASK_VEEVA_PDF_CHUNK_OVERLAP || 200));
const CHUNK_PART_SIZE = Math.max(2, Number(process.env.ASK_VEEVA_CHUNK_MB || 10)) * 1024 * 1024;

// Pysearch (FastAPI) — voir pysearch_service.py
const PYSEARCH_URL = process.env.PYSEARCH_URL || "http://127.0.0.1:8088/search";
const PYSEARCH_ON = process.env.PYSEARCH_OFF ? false : true;

// -----------------------------------------------------------------------------
// DB (Neon / Postgres)
// -----------------------------------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function nowISO() {
  const d = new Date();
  return d.toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "");
}
function safeEmail(x) {
  if (!x) return null;
  const s = String(x).trim();
  return s && /\S+@\S+\.\S+/.test(s) ? s.toLowerCase() : null;
}
function readCookie(req, name) {
  const raw = req.headers?.cookie || "";
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(res, name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const cookie = `${name}=${encodeURIComponent(value)}; Expires=${expires}; Path=/; SameSite=Lax`;
  res.setHeader("Set-Cookie", cookie);
}

// Tokenization / similarity
const UNACCENT = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
function norm(s = "") {
  return UNACCENT(String(s).toLowerCase())
    .replace(/[^\p{Letter}\p{Number}\-_/.\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s = "") {
  return norm(s).split(/\s+/).filter(Boolean);
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size || 1;
  return inter / uni;
}
function hasAny(s = "", kws = []) {
  const n = norm(s);
  return kws.some(k => n.includes(norm(k)));
}

// Variantes N2000-2 etc.
function expandN2000(q) {
  let out = q;
  out = out.replace(/\bN\s?2000[-\s_]?2\b/gi, "N2000-2 N20002 N2000 2 N-2000-2");
  out = out.replace(/\bN\s?1700[-\s_]?1\b/gi, "N1700-1 N17001 N1700 1 N-1700-1");
  return out;
}

// -----------------------------------------------------------------------------
// Auto-resolve email + thread middleware
// -----------------------------------------------------------------------------
app.use((req, res, next) => {
  const hdr = req.headers["x-user-email"] || req.headers["x-auth-email"];
  const fromHdr = safeEmail(hdr);
  const fromCookie = safeEmail(readCookie(req, "veeva_email"));
  const fromQuery = safeEmail(req.query?.email);
  const fromBody = safeEmail(req.body?.email);
  req.userEmail = fromHdr || fromCookie || fromQuery || fromBody || null;

  // Thread id (light memory)
  let thread = readCookie(req, "askv_thread");
  if (!thread) {
    thread = crypto.randomUUID();
    setCookie(res, "askv_thread", thread);
  }
  req.threadId = thread;

  next();
});

// -----------------------------------------------------------------------------
// Schéma
// -----------------------------------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      mime TEXT,
      bytes BIGINT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_chunks (
      id BIGSERIAL PRIMARY KEY,
      doc_id UUID REFERENCES askv_documents(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIMS})
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
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      role TEXT,
      sector TEXT,
      preferences JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_events (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT,
      type TEXT,
      question TEXT,
      answer_len INT,
      latency_ms INT,
      doc_id UUID,
      useful BOOLEAN,
      note TEXT,
      meta JSONB,
      ts TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_synonyms (
      id SERIAL PRIMARY KEY,
      term TEXT,
      alt_term TEXT,
      weight REAL DEFAULT 1.0,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(term, alt_term)
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id, chunk_index);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_documents_fname_idx ON askv_documents(filename);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_events_user_idx ON askv_events(user_email, ts);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_synonyms_term_idx ON askv_synonyms(term, weight DESC);`);

  // Index vectoriel
  const IVF_LISTS = Number(process.env.ASK_VEEVA_IVF_LISTS || 100);
  const MAINT_WORK_MEM = String(process.env.ASK_VEEVA_MAINT_WORK_MEM || "128MB");
  try {
    const { rows: idx } = await pool.query(`
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'askv_chunks_embedding_idx' LIMIT 1
    `);
    if (!idx.length) {
      try { await pool.query(`SET maintenance_work_mem = '${MAINT_WORK_MEM}'`); } catch {}
      try {
        await pool.query(`
          CREATE INDEX askv_chunks_embedding_idx
          ON askv_chunks USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = ${IVF_LISTS})
        `);
        console.log(`[ask-veeva] Index IVFFLAT créé (lists=${IVF_LISTS}).`);
      } catch (e) {
        const code = e?.code || "";
        const msg = String(e?.message || "");
        const oom = code === "54000" || /memory required/i.test(msg);
        if (oom) {
          console.warn("[ask-veeva] IVFFLAT OOM → fallback HNSW");
          await pool.query(`
            CREATE INDEX askv_chunks_embedding_idx
            ON askv_chunks USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
          `);
          console.log("[ask-veeva] Index HNSW créé (fallback).");
        } else {
          console.error("[ask-veeva] Création index vectoriel échouée:", e);
        }
      }
    }
  } catch (e) {
    console.error("[ask-veeva] Vérif/Création index vectoriel échouée:", e);
  }

  try { await pool.query(`ANALYZE askv_chunks;`); } catch {}
}

// -----------------------------------------------------------------------------
// Perso helpers
// -----------------------------------------------------------------------------
async function getUserByEmail(email) {
  if (!email) return null;
  const { rows } = await pool.query(`SELECT * FROM askv_users WHERE email=$1`, [email]);
  return rows[0] || null;
}
async function ensureUser(email) {
  if (!email) return null;
  const { rows } = await pool.query(
    `INSERT INTO askv_users(email) VALUES($1)
     ON CONFLICT (email) DO UPDATE SET updated_at=now()
     RETURNING *`,
    [email]
  );
  return rows[0];
}

async function expandQueryWithSynonyms(q) {
  const { rows } = await pool.query(
    `SELECT alt_term FROM askv_synonyms WHERE LOWER(term)=LOWER($1) ORDER BY weight DESC LIMIT 10`,
    [q]
  );
  if (!rows.length) return q;
  const extra = rows.map(r => r.alt_term).join(" ");
  return `${q} ${extra}`;
}

function softRoleBiasScore(filename = "", role = "", sector = "") {
  const f = filename.toLowerCase();
  let bonus = 0;
  if (role && f.includes(role.toLowerCase())) bonus += 0.05;
  if (sector && f.includes(sector.toLowerCase())) bonus += 0.05;
  return bonus;
}

// Simple NLU poste/secteur
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
  for (const group of lists) {
    if (group.some(alias => s.includes(alias))) return group[0];
  }
  for (const group of lists) {
    if (group.some(alias => s.trim() === alias)) return group[0];
  }
  return null;
}
function detectRole(text){ return detectFromList(text, ROLE_CANON); }
function detectSector(text){ return detectFromList(text, SECTOR_CANON); }

// -----------------------------------------------------------------------------
// Multer — Upload
// -----------------------------------------------------------------------------
const uploadDirect = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = `${nowISO()}_${file.originalname}`.replace(/[^\w.\-]+/g, "_");
      cb(null, safe);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

const uploadChunk = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PARTS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: Math.min(CHUNK_PART_SIZE * 2, 64 * 1024 * 1024) },
});

// -----------------------------------------------------------------------------
// Jobs helpers
// -----------------------------------------------------------------------------
async function createJob(kind, totalFiles = 0) {
  const { rows } = await pool.query(
    `INSERT INTO askv_jobs (kind, total_files, processed_files, status) VALUES ($1,$2,0,'queued') RETURNING id`,
    [kind, totalFiles]
  );
  return rows[0].id;
}
async function updateJob(id, patch) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  values.push(id);
  await pool.query(`UPDATE askv_jobs SET ${fields.join(", ")}, updated_at = now() WHERE id = $${i}`, values);
}
async function jobById(id) {
  const { rows } = await pool.query(`SELECT * FROM askv_jobs WHERE id = $1`, [id]);
  return rows[0] || null;
}

// -----------------------------------------------------------------------------
// ZIP streaming & parsers
// -----------------------------------------------------------------------------
async function streamIngestZip(absZipPath, onFile) {
  const zip = new StreamZip.async({ file: absZipPath, storeEntries: true });
  const entries = await zip.entries();
  const files = Object.values(entries).filter((e) => !e.isDirectory);
  for (const entry of files) {
    const fname = entry.name;
    const ext = path.extname(fname).toLowerCase();
    if (entry.size === 0) continue;
    const tmpOut = path.join(TMP_DIR, crypto.randomUUID() + ext);
    await zip.extract(entry.name, tmpOut);
    try {
      await onFile(tmpOut, fname, ext, entry.size);
    } finally {
      await fsp.rm(tmpOut, { force: true }).catch(() => {});
    }
    global.gc?.();
  }
  await zip.close();
}

async function parsePDF(absPath) {
  const data = new Uint8Array(await fsp.readFile(absPath));
  const loadingTask = pdfjsLib.getDocument({ data, standardFontDataUrl: PDF_STANDARD_FONTS });
  const doc = await loadingTask.promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({ normalizeWhitespace: true });
      const text = content.items.map((it) => it.str).join(" ");
      out += `\n\n[PAGE ${p}]\n${text}`;
      page.cleanup();
    } catch {
      out += `\n\n[PAGE ${p}] (erreur d'extraction)`;
    }
  }
  await doc.cleanup();
  try { loadingTask.destroy?.(); } catch {}
  return out.trim();
}
async function parseDOCX(absPath) {
  const buf = await fsp.readFile(absPath);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return (value || "").trim();
}
async function parseXLSX(absPath) {
  const wb = xlsx.readFile(absPath, { cellDates: false, cellNF: false, cellText: false });
  const sheets = wb.SheetNames || [];
  let out = "";
  for (const s of sheets) {
    const ws = wb.Sheets[s];
    const csv = xlsx.utils.sheet_to_csv(ws, { FS: ",", RS: "\n", blankrows: false });
    if (csv && csv.trim()) out += `\n\n[SHEET ${s}]\n${csv}`;
  }
  return out.trim();
}
async function parseCSV(absPath) {
  const text = await fsp.readFile(absPath, "utf8");
  return text.trim();
}
async function parseTXT(absPath) {
  const text = await fsp.readFile(absPath, "utf8");
  return text.trim();
}
async function parseMP4(absPath) {
  const stat = await fsp.stat(absPath);
  return { _noIndex: true, bytes: stat.size };
}

// Chunking
function windows(text, size = PDF_CHUNK_SIZE, overlap = PDF_CHUNK_OVERLAP) {
  const out = [];
  const clean = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  let i = 0;
  while (i < clean.length) {
    const w = clean.slice(i, i + size);
    out.push(w);
    if (i + size >= clean.length) break;
    i += size - overlap;
  }
  return out;
}

// Embeddings
async function embedBatch(texts) {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}
function toVectorLiteral(arr) {
  return "[" + arr.map((x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v.toString() : "0";
  }).join(",") + "]";
}

// Ingestion fichier
async function ingestConcreteFile(absPath, originalName, ext, bytes) {
  const safeName = `${nowISO()}_${(originalName || path.basename(absPath)).replace(/[^\w.\-]+/g, "_")}`;
  const finalAbs = path.join(STORE_DIR, safeName);
  await fsp.copyFile(absPath, finalAbs);

  if (ext === ".mp4" || ext === ".mov" || ext === ".m4v" || ext === ".webm") {
    const info = await parseMP4(absPath);
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalAbs, "video/mp4", bytes || info.bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  let parsed = "";
  if (ext === ".pdf") parsed = await parsePDF(absPath);
  else if (ext === ".docx") parsed = await parseDOCX(absPath);
  else if (ext === ".xlsx" || ext === ".xls") parsed = await parseXLSX(absPath);
  else if (ext === ".csv") parsed = await parseCSV(absPath);
  else if (ext === ".txt" || ext === ".md") parsed = await parseTXT(absPath);
  else {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalAbs, "application/octet-stream", bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  if (!parsed || parsed.trim().length === 0) {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalAbs, "text/plain", bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  const { rows } = await pool.query(
    `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
    [originalName, finalAbs, "text/plain", bytes || 0]
  );
  const docId = rows[0].id;

  const segs = windows(parsed, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
  for (let i = 0; i < segs.length; i += EMBED_BATCH) {
    const batch = segs.slice(i, i + EMBED_BATCH);
    const embeds = await embedBatch(batch);

    const params = [];
    const values = [];
    let idx = i;

    for (let j = 0; j < batch.length; j++) {
      params.push(`($${values.length + 1}, $${values.length + 2}, $${values.length + 3}, $${values.length + 4}::vector)`);
      values.push(docId, idx + j, batch[j], toVectorLiteral(embeds[j]));
    }

    await pool.query(
      `INSERT INTO askv_chunks (doc_id, chunk_index, content, embedding) VALUES ${params.join(", ")}`,
      values
    );
  }

  return { docId, chunks: segs.length, skipped: false };
}

// Ingestion ZIP / Single
async function runIngestZip(jobId, absZipPath) {
  try {
    await updateJob(jobId, { status: "running", processed_files: 0 });
    let processed = 0;
    await streamIngestZip(absZipPath, async (tmpAbs, fname, ext, bytes) => {
      await ingestConcreteFile(tmpAbs, fname, ext, bytes);
      processed++;
      await updateJob(jobId, { processed_files: processed });
    });
    await updateJob(jobId, { status: "done" });
  } catch (e) {
    await updateJob(jobId, { status: "error", error: String(e?.message || e) });
  } finally {
    await fsp.rm(absZipPath, { force: true }).catch(() => {});
    global.gc?.();
  }
}
async function runIngestSingleFile(jobId, absPath, originalName) {
  try {
    await updateJob(jobId, { status: "running", total_files: 1, processed_files: 0 });
    const ext = path.extname(originalName).toLowerCase();
    const stat = await fsp.stat(absPath);
    await ingestConcreteFile(absPath, originalName, ext, stat.size);
    await updateJob(jobId, { processed_files: 1, status: "done" });
  } catch (e) {
    await updateJob(jobId, { status: "error", error: String(e?.message || e) });
  } finally {
    await fsp.rm(absPath, { force: true }).catch(() => {});
    global.gc?.();
  }
}

// -----------------------------------------------------------------------------
// Mini-queue
// -----------------------------------------------------------------------------
const RUNNING = new Set();
const QUEUE = [];
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    QUEUE.push({ fn, resolve, reject });
    pump();
  });
}
async function pump() {
  if (RUNNING.size >= MAX_CONCURRENT_JOBS) return;
  const next = QUEUE.shift();
  if (!next) return;
  RUNNING.add(next);
  try {
    const val = await next.fn();
    next.resolve(val);
  } catch (e) {
    next.reject(e);
  } finally {
    RUNNING.delete(next);
    setTimeout(pump, 10);
  }
}

// -----------------------------------------------------------------------------
// ROUTES — Health / Jobs
// -----------------------------------------------------------------------------
app.get("/api/ask-veeva/health", async (_req, res) => {
  try {
    const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM askv_chunks`);
    const mu = process.memoryUsage?.() || {};
    res.json({
      ok: true,
      service: "ask-veeva",
      model: ANSWER_MODEL,
      embeddings: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      docCount: dc[0]?.n ?? 0,
      memory: { rss: mu.rss, heapTotal: mu.heapTotal, heapUsed: mu.heapUsed, external: mu.external },
      s3Configured: false,
      limits: { EMBED_BATCH, MAX_CONCURRENT_JOBS, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP, CHUNK_PART_SIZE },
      pysearch: { url: PYSEARCH_URL, on: !!PYSEARCH_ON }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/ask-veeva/jobs/:id", async (req, res) => {
  const j = await jobById(req.params.id);
  if (!j) return res.status(404).json({ error: "job not found" });
  res.setHeader("Cache-Control", "no-store");
  res.json(j);
});

// -----------------------------------------------------------------------------
// ROUTES — /me & personnalisation
// -----------------------------------------------------------------------------
app.get("/api/ask-veeva/me", async (req, res) => {
  try {
    const email = safeEmail(req.userEmail);
    if (!email) return res.json({ ok: true, user: null });
    const user = await ensureUser(email);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/initUser", async (req, res) => {
  try {
    const email = safeEmail(req.userEmail) || safeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "email manquant" });
    const { name, role, sector } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO askv_users (email, name, role, sector)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (email)
       DO UPDATE SET name=COALESCE(EXCLUDED.name, askv_users.name),
                     role=COALESCE(EXCLUDED.role, askv_users.role),
                     sector=COALESCE(EXCLUDED.sector, askv_users.sector),
                     updated_at=now()
       RETURNING *`,
      [email, name || null, role || null, sector || null]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/logEvent", async (req, res) => {
  try {
    const { type, question, doc_id, useful, note, meta } = req.body || {};
    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [safeEmail(req.userEmail), type || null, question || null, doc_id || null, useful ?? null, note || null, meta || {}]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/feedback", async (req, res) => {
  try {
    const { question, doc_id, useful, note } = req.body || {};
    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note)
       VALUES ($1,'feedback',$2,$3,$4,$5)`,
      [safeEmail(req.userEmail), question || null, doc_id || null, useful ?? null, note || null]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/synonyms/update", async (req, res) => {
  try {
    const { term, alt_term, weight } = req.body || {};
    if (!term || !alt_term) return res.status(400).json({ error: "term/alt_term requis" });
    await pool.query(
      `INSERT INTO askv_synonyms(term, alt_term, weight)
       VALUES ($1,$2,$3)
       ON CONFLICT(term, alt_term) DO UPDATE SET weight = EXCLUDED.weight`,
      [term, alt_term, Number(weight ?? 1.0)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/personalize", async (_req, res) => {
  try {
    const email = safeEmail(_req.userEmail);
    const user = await getUserByEmail(email);
    const prefs = (await pool.query(
      `SELECT doc_id, COUNT(*)::int AS uses
         FROM askv_events WHERE user_email=$1 AND type='doc_opened'
         GROUP BY doc_id ORDER BY uses DESC LIMIT 10`,
      [email]
    )).rows;
    res.json({ ok: true, user, top_docs: prefs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// SEARCH (léger)
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/search", async (req, res) => {
  const t0 = Date.now();
  try {
    let { query, k = 6 } = req.body || {};
    if (!query || String(query).trim() === "") return res.status(400).json({ error: "query requis" });

    try { query = await expandQueryWithSynonyms(query); } catch {}

    const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM askv_chunks`);
    let vecMatches = [];
    if (dc[0]?.n) {
      const emb = (await embedBatch([query]))[0];
      const qvec = toVectorLiteral(emb);
      const { rows } = await pool.query(
        `
        SELECT d.id AS doc_id, d.filename, c.content, 1 - (c.embedding <=> $1::vector) AS score
        FROM askv_chunks c
        JOIN askv_documents d ON d.id = c.doc_id
        ORDER BY c.embedding <=> $1::vector
        LIMIT $2
        `,
        [qvec, k]
      );
      vecMatches = rows.map((r) => ({
        meta: { doc_id: r.doc_id, filename: r.filename },
        snippet: (r.content || "").slice(0, 1000),
        score: Number(r.score),
      }));
    }

    const { rows: fileRows } = await pool.query(
      `
      SELECT id AS doc_id, filename, mime
      FROM askv_documents
      WHERE filename ILIKE '%' || $1 || '%'
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [req.body?.query ?? "", Math.max(k, 12)]
    );

    const fileMatches = fileRows.map((r) => ({
      meta: { doc_id: r.doc_id, filename: r.filename, mime: r.mime, file_url: `/api/ask-veeva/file/${r.doc_id}` },
      snippet: r.mime?.startsWith("video/") ? "[vidéo]" : "",
      score: 0.42,
    }));

    const byId = new Map();
    for (const m of [...vecMatches, ...fileMatches]) {
      const id = m.meta?.doc_id || m.meta?.filename + ":" + m.snippet;
      if (!byId.has(id)) byId.set(id, m);
    }
    const merged = Array.from(byId.values()).slice(0, Math.max(k, 12));

    try {
      await pool.query(
        `INSERT INTO askv_events(user_email,type,question,latency_ms,meta) VALUES ($1,'search',$2,$3,$4)`,
        [safeEmail(req.userEmail), req.body?.query || null, Date.now() - t0, { k }]
      );
    } catch {}

    res.json({ ok: true, matches: merged });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// -----------------------------------------------------------------------------
// INTENT & TOPIC MEMORY
// -----------------------------------------------------------------------------
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
  if (!t) { t = { lastTerms: [], topicHint: "", preferGlobal: false, preferSOP: false, lastAt: Date.now() }; THREADS.set(threadId, t); }
  return t;
}
function updateThreadFromQuestion(t, q) {
  const n = norm(q);
  const ts = tokens(q);
  // Global vs spécifique
  if (hasAny(n, ["global", "globale", "général", "generale", "générale", "overall", "corporate", "site", "usine"])) {
    t.preferGlobal = true;
  }
  if (hasAny(n, ["microdoseur", "micro2", "9142", "n2000-2", "n20002", "9143", "ligne", "machine", "éri", "neri"])) {
    t.preferGlobal = false;
  }
  // SOP / IDR hints
  if (hasAny(n, ["sop", "procédure", "procedure", "qd-sop"])) t.preferSOP = true;
  if (hasAny(n, ["idr", "réglage", "format"])) t.preferSOP = false;

  // Topic change detection
  const overlap = jaccard(t.lastTerms, ts);
  const changed = overlap < 0.18 && t.topicHint && !hasAny(n, ["suite", "continuer", "décris", "décrire", "détaille", "plus"]);
  if (changed) {
    t.topicHint = "";
    t.preferGlobal = false;
    t.preferSOP = false;
  }

  // Update topic hint (si vide)
  const kw = ts.filter(w => w.length >= 3).slice(0, 8).join(" ");
  if (!t.topicHint && kw) t.topicHint = kw;
  t.lastTerms = ts;
  t.lastAt = Date.now();
}

// Heuristiques généralité de fichier
function isGeneralFilename(fn = "") {
  const f = norm(fn);
  const hasLineNo = /\b(91\d{2}|N\d{3,4}[-\s_]*\d)\b/.test(f) || /\b(ligne|line|micro)\b/.test(f);
  const isSOP = /\b(sop|qd-sop)\b/.test(f);
  const hasGlobalWords = /\b(procedure|procédure|dechet|dechets|waste|global|site|usine|policy|policies)\b/.test(f);
  return (isSOP || hasGlobalWords) && !hasLineNo;
}
function isSpecificFilename(fn = "") {
  const f = norm(fn);
  return /\b(91\d{2}|N\d{3,4}[-\s_]*\d|ligne|micro)\b/.test(f);
}
function filenameScopePenalty(filename = "", preferGlobal = false) {
  if (!filename) return 0;
  const specificHints = ["microdoseur", "fenipic", "vignetteuse", "neri", "sirop", "otrivin", "lin_", "9142", "9136", "9135"];
  const f = filename.toLowerCase();
  const isSpecific = specificHints.some(k => f.includes(k));
  if (preferGlobal && isSpecific) return -0.35;
  if (!preferGlobal && !isSpecific) return -0.10; // léger
  return 0;
}

// -----------------------------------------------------------------------------
// SOP/IDR extraction + resolvers
// -----------------------------------------------------------------------------
const RE_SOP = /\b(?:QD-?)?SOP[-\s]?([A-Z0-9-]{3,})\b/ig;
const RE_IDR = /\bIDR[-\s]?[A-Z0-9\-]{2,}\b/ig;
function extractCodes(text = "", filename = "") {
  const set = new Set();
  for (const re of [RE_SOP, RE_IDR]) {
    let m;
    while ((m = re.exec(text)) !== null) set.add(m[0].replace(/\s+/g, ""));
    while ((m = re.exec(filename)) !== null) set.add(m[0].replace(/\s+/g, ""));
  }
  return [...set];
}

async function extractCodesFromDoc(docId, firstNChunks = 6) {
  const { rows } = await pool.query(
    `SELECT content FROM askv_chunks WHERE doc_id=$1 ORDER BY chunk_index ASC LIMIT $2`,
    [docId, Math.max(3, firstNChunks)]
  );
  const found = new Set();
  for (const r of rows) {
    for (const c of extractCodes(r.content || "", "")) found.add(c);
  }
  return [...found];
}

async function resolveCodesWithTopic({ question, thread, type = "any" }) {
  // 1) si la question contient déjà un code, renvoyer direct
  const inline = extractCodes(question || "", "");
  if (inline.length) return { codes: inline, from: "inline", file: null };

  // 2) requête pysearch basée sur le topic
  const topicQ = thread?.topicHint || "";
  const base = type === "sop" ? "SOP" : type === "idr" ? "IDR" : "SOP IDR";
  const q = [base, topicQ].filter(Boolean).join(" ").trim() || base;

  let items = [];
  try {
    if (PYSEARCH_ON) {
      const r = await fetch(PYSEARCH_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, k: 60, role: null, sector: null, rerank: true })
      }).then(x => x.ok ? x.json() : null).catch(()=>null);
      if (r?.ok && Array.isArray(r.items)) items = r.items;
    }
  } catch {}

  // 3) rescorer selon global/specific
  const rescored = items.map(it => {
    const adj = (it.score_final ?? it.score ?? 0) + filenameScopePenalty(it.filename || "", !!thread?.preferGlobal);
    return { ...it, _score2: adj };
  }).sort((a,b)=> b._score2 - a._score2);

  // 4) extraire codes des top docs
  for (const it of rescored.slice(0, 12)) {
    const codes = await extractCodesFromDoc(it.doc_id, 6);
    const filtered = type === "sop"
      ? codes.filter(c => /^QD-?SOP/i.test(c))
      : type === "idr"
      ? codes.filter(c => /^IDR/i.test(c))
      : codes;
    if (filtered.length) {
      return {
        codes: filtered,
        from: "doc",
        file: { doc_id: it.doc_id, filename: it.filename }
      };
    }
  }
  return { codes: [], from: "none", file: null };
}

// -----------------------------------------------------------------------------
// ASK (amélioré)
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/ask", async (req, res) => {
  const t0 = Date.now();
  try {
    let { question, k = undefined, docFilter = [], contextMode = "auto" } = req.body || {};
    if (!question || String(question).trim() === "") return res.status(400).json({ error: "question requise" });

    const originalQuestion = String(question);
    const normalizedQ = expandN2000(originalQuestion);
    const userEmail = safeEmail(req.userEmail);
    let user = userEmail ? await ensureUser(userEmail) : null;

    // Auto-profil si possible
    if (user && (!user.role || !user.sector)) {
      const candRole = detectRole(originalQuestion);
      const candSector = detectSector(originalQuestion);
      if (candRole || candSector) {
        await pool.query(
          `UPDATE askv_users
             SET role = COALESCE($2, role),
                 sector = COALESCE($3, sector),
                 updated_at = now()
           WHERE email = $1`,
          [userEmail, candRole, candSector]
        );
        user = await getUserByEmail(userEmail);
      }
    }

    // Thread memory
    const thread = getThread(req.threadId);
    updateThreadFromQuestion(thread, originalQuestion);

    // Mode sans contexte (répond générique, on ne bloque pas)
    if (contextMode === "none") {
      const text = `Mode sans contexte activé.\n\nQuestion: ${originalQuestion}\n\nJe peux répondre de manière générale, mais précise-moi si tu veux que je base la réponse sur les documents.`;
      await pool.query(
        `INSERT INTO askv_events(user_email,type,question,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4)`,
        [userEmail, originalQuestion, Date.now() - t0, { contextMode }]
      ).catch(()=>{});
      return res.json({ ok: true, text, citations: [], contexts: [] });
    }

    const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.askv_chunks`);
    if (!dc[0]?.n) {
      return res.json({
        ok: true,
        text: "Aucun document n'est indexé pour le moment. Importez des fichiers puis relancez votre question.",
        citations: [],
        contexts: [],
      });
    }

    // -------- Detect “code” follow-up (SOP/IDR) et résoudre via topic --------
    const askNumFollow = /\b(num(é|e)ro|ref(é|e)rence|code)\b/i.test(originalQuestion) &&
                         /\b(sop|qd-sop|idr)\b/i.test(originalQuestion);
    if (askNumFollow) {
      const wantSOP = /\bsop|qd-sop\b/i.test(originalQuestion);
      const type = wantSOP ? "sop" : "any";
      const { codes, file, from } = await resolveCodesWithTopic({ question: originalQuestion, thread, type });
      if (codes && codes.length) {
        const main = codes[0];
        const extras = codes.slice(1, 4);
        const extraTxt = extras.length ? `\nAutres possibles : ${extras.map(c=>`**${c}**`).join(", ")}.` : "";

        const citations = file ? [{
          doc_id: file.doc_id,
          filename: file.filename,
          chunk_index: 0,
          score: 1.0,
          snippet: ""
        }] : [];

        const contexts = file ? [{
          doc_id: file.doc_id,
          filename: file.filename,
          chunks: []
        }] : [];

        await pool.query(
          `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
          [userEmail, originalQuestion, (main+extraTxt).length, Date.now() - t0, { mode: "code_lookup_topic", from, codes: codes.slice(0,4) }]
        ).catch(()=>{});

        return res.json({
          ok: true,
          text: `Numéro de ${wantSOP ? "SOP" : "référence"} : **${main}**.${extraTxt}`,
          citations,
          contexts
        });
      }
    }

    // -------- Hybrid candidates from pysearch (best-effort) --------
    let hybrid = [];
    if (PYSEARCH_ON) {
      try {
        const body = {
          query: normalizedQ,
          k: 80,
          role: user?.role || null,
          sector: user?.sector || null,
          rerank: true
        };
        const r = await fetch(PYSEARCH_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then(x => x.ok ? x.json() : null).catch(()=>null);
        if (r?.ok && Array.isArray(r.items)) {
          hybrid = r.items.map(it => ({
            doc_id: it.doc_id,
            filename: it.filename,
            chunk_index: it.chunk_index,
            snippet: it.snippet || "",
            score_h: it.score_final ?? it.score ?? 0
          }));
        }
      } catch { /* fallback vector only */ }
    }

    // -------- Vector (pgvector) baseline --------
    let qForEmbed = normalizedQ;
    try { qForEmbed = await expandQueryWithSynonyms(qForEmbed); } catch {}
    const emb = (await embedBatch([qForEmbed]))[0];
    const qvec = toVectorLiteral(emb);

    const filterSQL = Array.isArray(docFilter) && docFilter.length
      ? `WHERE c.doc_id = ANY($3::uuid[])`
      : ``;
    const params = Array.isArray(docFilter) && docFilter.length ? [qvec, 60, docFilter] : [qvec, 60];

    let { rows } = await pool.query(
      `
      SELECT 
        d.id AS doc_id, d.filename, 
        c.chunk_index, c.content,
        1 - (c.embedding <=> $1::vector) AS score
      FROM public.askv_chunks c
      JOIN public.askv_documents d ON d.id = c.doc_id
      ${filterSQL}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2
      `,
      params
    );

    // Soft personalization
    let prefBoost = {};
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

    let vectorList = rows.map(r => {
      const p = prefBoost[r.doc_id] || 1;
      const roleBias = softRoleBiasScore(r.filename, user?.role, user?.sector);
      return {
        doc_id: r.doc_id,
        filename: r.filename,
        chunk_index: r.chunk_index,
        snippet: (r.content || "").slice(0, 1200),
        score_v: Number(r.score) * p + roleBias
      };
    });

    // -------- Merge & reweight (global vs specific + SOP bias) --------
    const byKey = new Map();
    for (const s of [...hybrid, ...vectorList]) {
      const key = `${s.doc_id}:${s.chunk_index}`;
      const prev = byKey.get(key);
      const score_h = s.score_h ?? 0;
      const score_v = s.score_v ?? 0;
      const base = Math.max(prev?.score || 0, 0);
      let score = Math.max(base, 0.6 * score_h + 0.7 * score_v);

      // Intent reweight
      if (thread.preferGlobal && isGeneralFilename(s.filename)) score += 0.35;
      if (thread.preferGlobal && isSpecificFilename(s.filename)) score -= 0.15;
      if (!thread.preferGlobal && isSpecificFilename(s.filename)) score += 0.12;

      if (thread.preferSOP && /\b(sop|qd-sop)\b/i.test(s.filename)) score += 0.25;

      byKey.set(key, {
        doc_id: s.doc_id,
        filename: s.filename,
        chunk_index: s.chunk_index,
        snippet: s.snippet,
        score
      });
    }

    let merged = Array.from(byKey.values());
    merged.sort((a,b)=> b.score - a.score);

    // Si global demandé, garde surtout les génériques en tête
    if (thread.preferGlobal) {
      const generics = merged.filter(m => isGeneralFilename(m.filename)).slice(0, 18);
      const specifics = merged.filter(m => !isGeneralFilename(m.filename)).slice(0, 12);
      merged = [...generics, ...specifics];
    }

    // -------- If direct “numéro SOP/IDR” sans topic utilisable, plan B (extraction brute) --------
    const askNum = /\b(num(é|e)ro|ref(é|e)rence|code)\b/i.test(originalQuestion) &&
                   /\b(sop|qd-sop|idr)\b/i.test(originalQuestion);
    if (askNum) {
      const top = merged.slice(0, 12);
      const cand = [];
      for (const m of top) {
        const codes = extractCodes(m.snippet || "", m.filename || "");
        for (const c of codes) cand.push({ code: c, doc_id: m.doc_id, filename: m.filename, chunk_index: m.chunk_index, score: m.score });
      }
      const seen = new Set();
      const uniq = cand.filter(c => (seen.has(c.code) ? false : (seen.add(c.code), true)))
                       .sort((a,b)=> b.score - a.score)
                       .slice(0, 4);

      if (uniq.length) {
        const best = uniq[0];
        const extras = uniq.slice(1);
        const text = extras.length
          ? `Numéro probable : **${best.code}**.\nAutres possibles : ${extras.map(e => `**${e.code}**`).join(", ")}.`
          : `Numéro probable : **${best.code}**.`;

        const citations = [{
          doc_id: best.doc_id,
          filename: best.filename,
          chunk_index: best.chunk_index,
          score: best.score,
          snippet: (merged.find(x => x.doc_id===best.doc_id && x.chunk_index===best.chunk_index)?.snippet || "").slice(0, 400)
        }];

        const contexts = [{
          doc_id: best.doc_id,
          filename: best.filename,
          chunks: [{ chunk_index: best.chunk_index, snippet: citations[0].snippet, score: best.score }]
        }];

        await pool.query(
          `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
          [userEmail, originalQuestion, text.length, Date.now() - t0, { mode: "code_lookup_fallback", codes: uniq.map(u=>u.code) }]
        ).catch(()=>{});

        return res.json({ ok: true, text, citations, contexts });
      }
    }

    // -------- Build contexts & prompt for OpenAI --------
    // Regroup by doc with top chunks
    const byDoc = new Map();
    for (const m of merged.slice(0, 24)) {
      const entry = byDoc.get(m.doc_id) || { doc_id: m.doc_id, filename: m.filename, chunks: [] };
      entry.chunks.push({ chunk_index: m.chunk_index, snippet: (m.snippet || "").slice(0, 1200), score: m.score });
      byDoc.set(m.doc_id, entry);
    }
    const contexts = Array.from(byDoc.values()).map(d => ({
      ...d,
      chunks: d.chunks.sort((a,b)=> a.chunk_index - b.chunk_index).slice(0, 3)
    }));

    // Compose context blocks
    const contextBlocks = contexts.map((d, i) => {
      const parts = d.chunks.map(c => `#${c.chunk_index}\n${c.snippet}`).join("\n---\n");
      return `【${i+1}】 ${d.filename} (doc:${d.doc_id})\n${parts}`;
    }).join("\n\n================\n\n");

    // Answer guardrails
    const scopeHint = thread.preferGlobal
      ? "Ta réponse DOIT couvrir la procédure GENERALE (SOP cadre) et non un cas de ligne/machine. Si le contexte ne contient que des cas spécifiques, dis-le et propose le document cadre le plus proche."
      : "Si la question est spécifique (ligne/machine), réponds avec ces détails. Sinon réponds avec la procédure générale si elle est présente.";

    const followHint = thread.topicHint
      ? `Garde le même sujet tant qu’un changement explicite n’est pas détecté. Sujet courant: « ${thread.topicHint} »`
      : "S’il n’y a pas de sujet courant, reste fidèle à la question.";

    const prompt = [
      { role: "system",
        content:
`Tu es Ask Veeva. Tu réponds en français, de manière concise et structurée.
Règles:
- NE réponds que depuis le CONTEXTE fourni; si l’info manque, dis-le clairement.
- Priorité: ${thread.preferGlobal ? "procédure générale/SOP" : "procédure la plus pertinente"}.
- Ne mélange PAS des thèmes sans lien (évite les glissements de sujet).
- Termine par une courte liste de documents utilisés entre [crochets].`
      },
      { role: "user",
        content:
`QUESTION:
${originalQuestion}

Contexte (extraits):
${contextBlocks}

Contraintes:
- ${scopeHint}
- ${followHint}
- Si plusieurs documents se contredisent, signale les incohérences et cite les passages concernés.` }
    ];

    const out = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: prompt,
      temperature: 0.2,
    });

    const text = out.choices?.[0]?.message?.content || "Désolé, je ne trouve pas l’information dans le contexte fourni.";

    // Citations simplifiées
    const citations = merged.slice(0, 8).map((r) => ({
      doc_id: r.doc_id,
      filename: r.filename,
      chunk_index: r.chunk_index,
      score: Number(r.score),
      snippet: (r.snippet || "").slice(0, 400),
    }));

    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,meta) VALUES ($1,'ask_issued',$2,$3)`,
      [userEmail, originalQuestion, { preferGlobal: thread.preferGlobal, preferSOP: thread.preferSOP }]
    ).catch(()=>{});
    await pool.query(
      `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
      [userEmail, originalQuestion, text.length, Date.now() - t0, { citations: citations.length }]
    ).catch(()=>{});

    return res.json({ ok: true, text, citations, contexts });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// -----------------------------------------------------------------------------
// Upload routes
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/uploadZip", uploadDirect.single("zip"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "zip manquant" });
    const st = await fsp.stat(req.file.path);
    let total = 0;
    try {
      const zip = new StreamZip.async({ file: req.file.path, storeEntries: true });
      const entries = await zip.entries();
      total = Object.values(entries).filter((e) => !e.isDirectory).length;
      await zip.close();
    } catch { total = 0; }
    const jobId = await createJob("zip", total);
    enqueue(() => runIngestZip(jobId, req.file.path)).catch((e) => console.error("ingest zip fail", e));
    res.json({ ok: true, job_id: jobId, filename: req.file.filename, bytes: st.size });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/ask-veeva/uploadFile", uploadDirect.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file manquant" });
    const jobId = await createJob("file", 1);
    enqueue(() => runIngestSingleFile(jobId, req.file.path, req.file.originalname)).catch((e) =>
      console.error("ingest file fail", e)
    );
    res.json({ ok: true, job_id: jobId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/ask-veeva/chunked/init", async (req, res) => {
  try {
    const { filename, size } = req.body || {};
    if (!filename || !Number.isFinite(size)) return res.status(400).json({ error: "filename/size requis" });
    const uploadId = crypto.randomUUID();
    const manifest = { filename, size, created_at: Date.now() };
    await fsp.writeFile(path.join(PARTS_DIR, `${uploadId}.json`), JSON.stringify(manifest));
    res.json({ ok: true, uploadId, partSize: CHUNK_PART_SIZE });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const concatPartsToZip = async (uploadId, totalParts, destZipAbs) => {
  await fsp.mkdir(path.dirname(destZipAbs), { recursive: true });
  const ws = fs.createWriteStream(destZipAbs);
  try {
    for (let i = 1; i <= totalParts; i++) {
      const partPath = path.join(PARTS_DIR, `${uploadId}.${i}.part`);
      const st = await fsp.stat(partPath).catch(() => null);
      if (!st) throw new Error(`Part manquante: #${i}`);
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(partPath);
        rs.on("error", reject);
        rs.on("end", resolve);
        rs.pipe(ws, { end: false });
      });
      global.gc?.();
    }
  } finally {
    ws.end();
  }
};

app.post("/api/ask-veeva/chunked/part", uploadChunk.single("chunk"), async (req, res) => {
  try {
    const { uploadId, partNumber } = req.query || {};
    if (!uploadId || !partNumber) return res.status(400).json({ error: "uploadId/partNumber requis" });
    if (!req.file) return res.status(400).json({ error: "chunk manquant" });
    const safeId = String(uploadId).replace(/[^\w\-]/g, "");
    const pnum = Number(partNumber);
    if (!Number.isInteger(pnum) || pnum <= 0) return res.status(400).json({ error: "partNumber invalide" });
    const dest = path.join(PARTS_DIR, `${safeId}.${pnum}.part`);
    await fsp.rename(req.file.path, dest);
    res.json({ ok: true, received: req.file.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/chunked/complete", async (req, res) => {
  try {
    const { uploadId, totalParts, originalName } = req.body || {};
    if (!uploadId || !totalParts) return res.status(400).json({ error: "uploadId/totalParts requis" });
    const safeId = String(uploadId).replace(/[^\w\-]/g, "");
    const parts = Number(totalParts);
    if (!Number.isInteger(parts) || parts <= 0) return res.status(400).json({ error: "totalParts invalide" });

    const finalZip = path.join(
      UPLOAD_DIR,
      `chunked_${nowISO()}_${(originalName || "upload.zip").replace(/[^\w.\-]+/g, "_")}`
    );
    await concatPartsToZip(safeId, parts, finalZip);

    let total = 0;
    try {
      const zip = new StreamZip.async({ file: finalZip, storeEntries: true });
      const entries = await zip.entries();
      total = Object.values(entries).filter((e) => !e.isDirectory).length;
      await zip.close();
    } catch { total = 0; }

    const jobId = await createJob("zip-chunked", total);
    enqueue(() => runIngestZip(jobId, finalZip)).catch((e) => console.error("ingest zip chunked fail", e));
    res.json({ ok: true, job_id: jobId });

    (async () => {
      await fsp.rm(path.join(PARTS_DIR, `${safeId}.json`), { force: true }).catch(() => {});
      for (let i = 1; i <= parts; i++) {
        await fsp.rm(path.join(PARTS_DIR, `${safeId}.${i}.part`), { force: true }).catch(() => {});
      }
    })();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ask-veeva/chunked/abort", async (req, res) => {
  try {
    const { uploadId, upto } = req.body || {};
    if (!uploadId) return res.status(400).json({ error: "uploadId requis" });
    const safeId = String(uploadId).replace(/[^\w\-]/g, "");
    const limit = Number(upto) || 999999;
    await fsp.rm(path.join(PARTS_DIR, `${safeId}.json`), { force: true }).catch(() => {});
    for (let i = 1; i <= limit; i++) {
      await fsp.rm(path.join(PARTS_DIR, `${safeId}.${i}.part`), { force: true }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// FICHIERS : metadata + original + preview
// -----------------------------------------------------------------------------
function sanitizeNameForStore(name = "") { return String(name).replace(/[^\w.\-]+/g, "_"); }
async function tryFindInStoreDirByPattern(originalName) {
  const targetSuffix = "_" + sanitizeNameForStore(originalName);
  const files = await fsp.readdir(STORE_DIR).catch(() => []);
  const candidates = files.filter(fn => fn.endsWith(targetSuffix));
  if (!candidates.length) return null;
  let best = null;
  let bestTime = -1;
  for (const fn of candidates) {
    const p = path.join(STORE_DIR, fn);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.isFile() && st.mtimeMs > bestTime) {
      best = p; bestTime = st.mtimeMs;
    }
  }
  return best;
}

app.get("/api/ask-veeva/filemeta/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    const doc = rows[0];
    if (!doc) return res.status(404).json({ ok:false, error: "doc not found" });

    if (doc.path && fs.existsSync(doc.path)) {
      return res.json({ ok: true, existsOriginal: true, canPreview: true, url: `/api/ask-veeva/file/${doc.id}`, mime: doc.mime || null });
    }
    const base = path.basename(doc.path || "");
    if (base) {
      const alt = path.join(STORE_DIR, base);
      if (fs.existsSync(alt)) {
        return res.json({ ok: true, existsOriginal: true, canPreview: true, url: `/api/ask-veeva/file/${doc.id}`, mime: doc.mime || null });
      }
    }
    const guess = await tryFindInStoreDirByPattern(doc.filename);
    if (guess && fs.existsSync(guess)) {
      return res.json({ ok: true, existsOriginal: true, canPreview: true, url: `/api/ask-veeva/file/${doc.id}`, mime: doc.mime || null });
    }
    const { rows: chunks } = await pool.query(
      `SELECT 1 FROM askv_chunks WHERE doc_id = $1 LIMIT 1`,
      [req.params.id]
    );
    if (chunks.length) {
      return res.json({ ok: true, existsOriginal: false, canPreview: true, url: `/api/ask-veeva/preview/${doc.id}`, mime: "text/html" });
    }
    return res.json({ ok: false, existsOriginal: false, canPreview: false, error: "file not on disk" });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get("/api/ask-veeva/file/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "doc not found" });

    const sendOriginal = (absPath) => {
      if (doc.mime) res.type(doc.mime);
      res.sendFile(path.resolve(absPath));
    };

    if (doc.path && fs.existsSync(doc.path)) {
      return sendOriginal(doc.path);
    }
    const base = path.basename(doc.path || "");
    if (base) {
      const alt = path.join(STORE_DIR, base);
      if (fs.existsSync(alt)) return sendOriginal(alt);
    }
    const guess = await tryFindInStoreDirByPattern(doc.filename);
    if (guess && fs.existsSync(guess)) return sendOriginal(guess);

    const { rows: segs } = await pool.query(
      `SELECT chunk_index, content FROM askv_chunks WHERE doc_id = $1 ORDER BY chunk_index ASC`,
      [req.params.id]
    );
    if (segs.length) {
      const html = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'/>",
        "<title>Preview – ", (doc.filename || "document"), "</title>",
        "<style>",
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;line-height:1.45;padding:16px;color:#111}",
        "h1{font-size:18px;margin:0 0 12px} .chunk{margin:16px 0;padding:12px;border-left:4px solid #e5e7eb;background:#fafafa;white-space:pre-wrap;word-break:break-word}",
        "</style></head><body>",
        "<h1>Prévisualisation (texte indexé)</h1>",
        "<div style='color:#374151;font-size:13px;margin-bottom:8px'><strong>Fichier:</strong> ",
        (doc.filename || doc.id),
        "</div>"
      ];
      const esc = s => String(s || "").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
      for (const s of segs) {
        html.push("<div class='chunk'><div style='color:#9ca3af;font-size:12px'>#",
                  String(s.chunk_index),
                  "</div>", esc(s.content), "</div>");
      }
      html.push("</body></html>");
      res.setHeader("X-AskVeeva-Preview", "1");
      res.type("html").send(html.join(""));
      return;
    }

    res.status(404).json({ error: "file not on disk" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/ask-veeva/preview/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    const doc = rows[0];
    if (!doc) return res.status(404).send("Document inconnu.");

    const { rows: segs } = await pool.query(
      `SELECT chunk_index, content FROM askv_chunks WHERE doc_id = $1 ORDER BY chunk_index ASC`,
      [req.params.id]
    );
    if (!segs.length) {
      return res.status(404).send("Aucune donnée indexée disponible pour la prévisualisation.");
    }

    const esc = s => String(s || "").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const html = [
      "<!doctype html><html><head><meta charset='utf-8'>",
      "<meta name='viewport' content='width=device-width, initial-scale=1'/>",
      "<title>Preview – ", esc(doc.filename || doc.id), "</title>",
      "<style>",
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;line-height:1.45;padding:16px;color:#111}",
      "h1{font-size:18px;margin:0 0 12px} .chunk{margin:16px 0;padding:12px;border-left:4px solid #e5e7eb;background:#fafafa;white-space:pre-wrap;word-break:break-word}",
      "</style></head><body>",
      "<h1>Prévisualisation (texte indexé)</h1>",
      "<div style='color:#374151;font-size:13px;margin-bottom:8px'><strong>Fichier:</strong> ", esc(doc.filename || doc.id), "</div>"
    ];
    for (const s of segs) {
      html.push("<div class='chunk'><div style='color:#9ca3af;font-size:12px'>#",
                String(s.chunk_index),
                "</div>", esc(s.content), "</div>");
    }
    html.push("</body></html>");
    res.setHeader("X-AskVeeva-Preview", "1");
    res.type("html").send(html.join(""));
  } catch (e) {
    res.status(500).send("Erreur preview: " + (e?.message || e));
  }
});

// -----------------------------------------------------------------------------
// BOOT
// -----------------------------------------------------------------------------
await ensureSchema();

app.listen(PORT, HOST, () => {
  console.log(`[ask-veeva] service listening on ${HOST}:${PORT}`);
});
