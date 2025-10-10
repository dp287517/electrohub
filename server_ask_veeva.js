// server_ask_veeva.js — Ask Veeva (persist file store, fuzzy find, richer ASK, video streaming)
// ESM + Node

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

// OpenAI (embeddings + réponses)
import OpenAI from "openai";

// ZIP streaming
import StreamZip from "node-stream-zip";

// PDF.js (Node): utiliser le build legacy en ESM (.mjs)
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "module";
const require = createRequire(import.meta.url); // pour require.resolve en ESM

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

// --- Helmet CSP assouplie pour l'aperçu PDF/vidéo dans <embed>/<iframe> ---
const SELF = "'self'";
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": [SELF],
        "script-src": [SELF],
        "style-src": [SELF, "'unsafe-inline'"], // tailwind inlined ok
        "img-src": [SELF, "data:", "blob:"],
        "font-src": [SELF, "data:"],
        "connect-src": [SELF],
        "frame-src": [SELF, "blob:", "data:"],
        "media-src": [SELF, "blob:"],
        "object-src": [SELF, "blob:", "data:"], // ← autoriser PDF plugin
        "base-uri": [SELF],
        "form-action": [SELF],
        "frame-ancestors": [SELF],
      },
    },
    crossOriginEmbedderPolicy: false, // pour vieux lecteurs PDF
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "8mb" }));

const PORT = Number(process.env.ASK_VEEVA_PORT || 3015);
const HOST = process.env.ASK_VEEVA_HOST || "127.0.0.1";

const DATA_ROOT = path.join(process.cwd(), "uploads", "ask-veeva");
const UPLOAD_DIR = path.join(DATA_ROOT, "incoming");
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const PARTS_DIR = path.join(DATA_ROOT, "parts");
const STORE_DIR = path.join(DATA_ROOT, "store"); // ← stockage persistant
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

// standard fonts pour éviter UnknownErrorException / TT: undefined function: 32
const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
const PDF_STANDARD_FONTS = path.join(pdfjsPkgDir, "standard_fonts/");

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = process.env.ASK_VEEVA_EMBED_MODEL || "text-embedding-3-small"; // 1536 dims
const EMBEDDING_DIMS = 1536;
const ANSWER_MODEL = process.env.ASK_VEEVA_ANSWER_MODEL || "gpt-4o-mini";

// Performances (tunables)
const EMBED_BATCH = Math.max(4, Number(process.env.ASK_VEEVA_EMBED_BATCH || 8));
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.ASK_VEEVA_MAX_CONCURRENT_JOBS || 1));
const PDF_CHUNK_SIZE = Math.max(600, Number(process.env.ASK_VEEVA_PDF_CHUNK_SIZE || 1200));
const PDF_CHUNK_OVERLAP = Math.max(0, Number(process.env.ASK_VEEVA_PDF_CHUNK_OVERLAP || 200));
const CHUNK_PART_SIZE = Math.max(2, Number(process.env.ASK_VEEVA_CHUNK_MB || 10)) * 1024 * 1024; // 10 Mo par défaut
const SAFE_WIDE_LIMIT = Math.max(50, Number(process.env.ASK_VEEVA_SAFE_WIDE_LIMIT || 200)); // large mais borné

// MIME helpers
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const PDF_EXTS = new Set([".pdf"]);
const TEXTLIKE_EXTS = new Set([".txt", ".md", ".csv"]);
const OFFICE_EXTS = new Set([".docx", ".xlsx", ".xls"]);

// Pas de S3 dans cette version
const S3_BUCKET = null;

// -----------------------------------------------------------------------------
// DB (Neon / Postgres)
// -----------------------------------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`); // pour gen_random_uuid()
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`); // fuzzy

  // Schéma
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

  // Mémoire légère
  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_interactions (
      id BIGSERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      suggested_doc_ids UUID[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Index
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id, chunk_index);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_documents_fname_idx ON askv_documents(filename);`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS askv_documents_fname_trgm ON askv_documents USING gin (lower(filename) gin_trgm_ops);`
  );

  await pool.query(`ANALYZE askv_chunks;`);
}

function nowISO() {
  const d = new Date();
  return d.toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "");
}

// -----------------------------------------------------------------------------
// Multer — Upload direct (petits ZIP/fichiers)
// -----------------------------------------------------------------------------
const uploadDirect = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = `${nowISO()}_${file.originalname}`.replace(/[^\w.\-]+/g, "_");
      cb(null, safe);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 Mo
});

// Multer — Upload des parts (chunked)
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
// Utils — persistance fichiers & parsers
// -----------------------------------------------------------------------------
function guessMimeFromExt(ext) {
  const e = (ext || "").toLowerCase();
  if (VIDEO_EXTS.has(e)) return "video/mp4";
  if (PDF_EXTS.has(e)) return "application/pdf";
  if (TEXTLIKE_EXTS.has(e)) return "text/plain";
  if (e === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (e === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === ".xls") return "application/vnd.ms-excel";
  return "application/octet-stream";
}

async function persistOriginal(absPath, originalName) {
  const safeBase = `${nowISO()}_${originalName}`.replace(/[^\w.\-]+/g, "_");
  const finalPath = path.join(STORE_DIR, safeBase);
  await fsp.copyFile(absPath, finalPath);
  const stat = await fsp.stat(finalPath);
  const ext = path.extname(originalName).toLowerCase();
  const mime = guessMimeFromExt(ext);
  return { finalPath, bytes: stat.size, mime };
}

// -----------------------------------------------------------------------------
// ZIP streaming → onFile(tmpAbs, fname, ext, bytes)
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

// -----------------------------------------------------------------------------
// Parsers
// -----------------------------------------------------------------------------
async function parsePDF(absPath) {
  const data = new Uint8Array(await fsp.readFile(absPath));
  const loadingTask = pdfjsLib.getDocument({
    data,
    standardFontDataUrl: PDF_STANDARD_FONTS,
  });
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
  try {
    loadingTask.destroy?.();
  } catch {}
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
    if (csv && csv.trim()) {
      out += `\n\n[SHEET ${s}]\n${csv}`;
    }
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

// -----------------------------------------------------------------------------
// Chunking texte → fenêtres
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Embeddings + util pgvector
// -----------------------------------------------------------------------------
async function embedBatch(texts) {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
function toVectorLiteral(arr) {
  return (
    "[" +
    arr
      .map((x) => {
        const v = Number(x);
        return Number.isFinite(v) ? v.toString() : "0";
      })
      .join(",") +
    "]"
  );
}

// Normalisation pour fuzzy (N2000-2 → n20002)
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// -----------------------------------------------------------------------------
// Ingestion d’un fichier concret (stocke PERSISTANT + indexe)
// -----------------------------------------------------------------------------
async function ingestConcreteFile(absPath, originalName, ext, bytes) {
  // 1) Persister l'original
  const { finalPath, bytes: realBytes, mime } = await persistOriginal(absPath, originalName);
  const effectiveBytes = bytes || realBytes;

  // 2) Indexation selon le type
  if (VIDEO_EXTS.has(ext)) {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalPath, mime, effectiveBytes]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true, isVideo: true };
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
      [originalName, finalPath, mime, effectiveBytes]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  if (!parsed || parsed.trim().length === 0) {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalPath, "text/plain", effectiveBytes]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  const { rows } = await pool.query(
    `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
    [originalName, finalPath, "text/plain", effectiveBytes]
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
      params.push(
        `($${values.length + 1}, $${values.length + 2}, $${values.length + 3}, $${values.length + 4}::vector)`
      );
      values.push(docId, idx + j, batch[j], toVectorLiteral(embeds[j]));
    }

    await pool.query(
      `INSERT INTO askv_chunks (doc_id, chunk_index, content, embedding) VALUES ${params.join(", ")}`,
      values
    );
  }

  return { docId, chunks: segs.length, skipped: false };
}

// -----------------------------------------------------------------------------
// Ingestion ZIP / Fichier
// -----------------------------------------------------------------------------
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
// Mini-queue (1 worker concurrent configurable)
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
      limits: { EMBED_BATCH, MAX_CONCURRENT_JOBS, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP, CHUNK_PART_SIZE, SAFE_WIDE_LIMIT },
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
// ROUTES — Upload direct (petits ZIP/fichiers)
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
    } catch {
      total = 0;
    }
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

// -----------------------------------------------------------------------------
// ROUTES — Upload fractionné (chunked) pour gros ZIP
// -----------------------------------------------------------------------------
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
async function concatPartsToZip(uploadId, totalParts, destZipAbs) {
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
}
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
    } catch {
      total = 0;
    }

    const jobId = await createJob("zip-chunked", total);
    enqueue(() => runIngestZip(jobId, finalZip)).catch((e) => console.error("ingest zip chunked fail", e));
    res.json({ ok: true, job_id: jobId });

    // nettoyage des parts
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
// VIEW/STREAM ROUTES — fichiers & vidéos
// -----------------------------------------------------------------------------
app.get("/api/ask-veeva/doc/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime, bytes, created_at FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "doc not found" });
    res.json({ ok: true, doc: rows[0] });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/ask-veeva/file/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime, bytes FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "doc not found" });
    const { id, filename, path: abs, mime } = rows[0];

    // auto-heal minimal
    let st = await fsp.stat(abs).catch(() => null);
    if (!st) {
      const safeName = filename.replace(/[^\w.\-]+/g, "_");
      const cand = (await fsp.readdir(STORE_DIR)).find((n) => n.endsWith(`_${safeName}`));
      if (cand) {
        const healed = path.join(STORE_DIR, cand);
        await pool.query(`UPDATE askv_documents SET path = $1 WHERE id = $2`, [healed, id]).catch(() => {});
        st = await fsp.stat(healed).catch(() => null);
        if (st) {
          res.set({
            "Content-Type": mime || "application/octet-stream",
            "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
          });
          return fs.createReadStream(healed).pipe(res);
        }
      }
      return res.status(404).json({ error: "file not on disk" });
    }

    res.set({
      "Content-Type": mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/ask-veeva/stream/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT filename, path, mime, bytes FROM askv_documents WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "doc not found" });
    const { filename, path: abs, mime } = rows[0];
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) return res.status(404).json({ error: "file not on disk" });

    const range = req.headers.range;
    if (!range) {
      res.setHeader("Content-Type", mime || "video/mp4");
      res.setHeader("Content-Length", st.size);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Accept-Ranges", "bytes");
      return fs.createReadStream(abs).pipe(res);
    }
    const CHUNK = 1 * 1024 * 1024;
    const start = Number(range.replace(/\D/g, "")) || 0;
    const end = Math.min(start + CHUNK, st.size - 1);
    const contentLength = end - start + 1;

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${st.size}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Type", mime || "video/mp4");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(abs, { start, end }).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// -----------------------------------------------------------------------------
// SEARCH + FIND + ASK
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/search", async (req, res) => {
  try {
    const { query, k = 10 } = req.body || {};
    if (!query || String(query).trim() === "") return res.status(400).json({ error: "query requis" });

    const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM askv_chunks`);
    if (!dc[0]?.n) return res.json({ ok: true, matches: [] });

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
      [qvec, Math.max(1, k)]
    );
    const matches = rows.map((r) => ({
      meta: { filename: r.filename, doc_id: r.doc_id },
      snippet: (r.content || "").slice(0, 1000),
      score: Number(r.score),
    }));
    res.json({ ok: true, matches });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Fuzzy doc finder (GET — compat ancien)
app.get("/api/ask-veeva/find-docs", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ ok: true, items: [] });

    const qNorm = norm(q);
    const like = `%${q.replace(/[%_]/g, "").toLowerCase()}%`;

    const { rows } = await pool.query(
      `
      SELECT id, filename, mime, bytes
      FROM askv_documents
      WHERE lower(filename) LIKE $1
         OR similarity(lower(filename), $2) > 0.25
         OR replace(regexp_replace(lower(filename), '[^a-z0-9]+', '', 'g'), '-', '') LIKE $3
      ORDER BY GREATEST(
        similarity(lower(filename), $2),
        CASE WHEN lower(filename) LIKE $1 THEN 0.9 ELSE 0 END
      ) DESC
      LIMIT 50
      `,
      [like, q.toLowerCase(), `%${qNorm}%`]
    );

    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        mime: r.mime,
        bytes: Number(r.bytes || 0),
        isVideo: (r.mime || "").startsWith("video/"),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Fuzzy doc finder (POST — aligné avec l'UI)
app.post("/api/ask-veeva/find", async (req, res) => {
  try {
    const { query, limit = 120 } = req.body || {};
    const q = String(query || "").trim();
    if (!q) return res.json({ ok: true, items: [], suggestions: [] });

    const qNorm = norm(q);
    const like = `%${q.replace(/[%_]/g, "").toLowerCase()}%`;

    const { rows } = await pool.query(
      `
      SELECT id, filename, mime, bytes
      FROM askv_documents
      WHERE lower(filename) LIKE $1
         OR similarity(lower(filename), $2) > 0.25
         OR replace(regexp_replace(lower(filename), '[^a-z0-9]+', '', 'g'), '-', '') LIKE $3
      ORDER BY GREATEST(
        similarity(lower(filename), $2),
        CASE WHEN lower(filename) LIKE $1 THEN 0.9 ELSE 0 END
      ) DESC
      LIMIT $4
      `,
      [like, q.toLowerCase(), `%${qNorm}%`, Math.max(1, Math.min(500, limit))]
    );

    const suggestions = [];
    if (/\bn\s?(\d{3,5})(-?\d+)?\b/i.test(q)) {
      const canon = q.toLowerCase().replace(/[\s\-]/g, "");
      suggestions.push(`Essayer "${canon}"`);
    }
    if (q.length >= 3) suggestions.push(q.toUpperCase(), q.toLowerCase());

    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        mime: r.mime,
        bytes: Number(r.bytes || 0),
        isVideo: (r.mime || "").startsWith("video/"),
      })),
      suggestions,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// -----------------------------------------------------------------------------
// ASK — no-context friendly (auto fuzzy → liste de docs), RAG si dispo
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/ask", async (req, res) => {
  try {
    const {
      question,
      k = 0,
      docFilter = [],
      history = [],
      wantVideos: wantVideosRaw = false,
    } = req.body || {};
    const q = String(question || "").trim();
    if (!q) return res.status(400).json({ error: "question requise" });

    // Heuristiques simples : vidéos / tutos / idr
    const qLow = q.toLowerCase();
    const wantVideos =
      wantVideosRaw ||
      /\b(video|vidéo|tuto|tutorial|mp4|webm)\b/.test(qLow);

    // Normalisation agressive pour capturer N2000-2, N20002, "idr 20002", etc.
    const canon = qLow.replace(/[\s\-_/]+/g, "");
    const isDocBrowsingIntent =
      /\b(idr|doc|document|fichier|pdf|manuel|procedure|procédure|workinstr|wi)\b/.test(qLow) ||
      /\d/.test(qLow); // présence de chiffres => souvent une réf machine/dossier

    // 0) Compter les chunks
    const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.askv_chunks`);
    const hasChunks = !!(dc[0]?.n);

    // Helper — Fuzzy find sur filenames
    async function fuzzyFindOnFilenames(limit = 120) {
      const like = `%${qLow.replace(/[%_]/g, "")}%`;
      const canonLike = `%${canon}%`;
      const { rows } = await pool.query(
        `
        SELECT id, filename, mime, bytes
        FROM askv_documents
        WHERE lower(filename) LIKE $1
           OR similarity(lower(filename), $2) > 0.25
           OR replace(regexp_replace(lower(filename), '[^a-z0-9]+', '', 'g'), '-', '') LIKE $3
        ORDER BY GREATEST(
          similarity(lower(filename), $2),
          CASE WHEN lower(filename) LIKE $1 THEN 0.9 ELSE 0 END
        ) DESC
        LIMIT $4
        `,
        [like, qLow, canonLike, Math.max(1, Math.min(500, limit))]
      );
      let items = rows.map(r => ({
        id: r.id,
        filename: r.filename,
        mime: r.mime,
        isVideo: (r.mime || "").startsWith("video/"),
      }));
      if (wantVideos) {
        items = items.sort((a, b) => (b.isVideo ? 1 : 0) - (a.isVideo ? 1 : 0));
      }
      return items;
    }

    // 1) Si l’intention est clairement “je veux voir des docs” → FAST PATH fuzzy,
    //    sans même tenter un RAG (plus rapide et plus proche de l’intention).
    if (isDocBrowsingIntent) {
      const items = await fuzzyFindOnFilenames(150);
      if (items.length > 0) {
        // Réponse directe, sans LLM — on renvoie du concret (liste cliquable côté UI).
        const textLines = [
          `J’ai trouvé ${items.length} fichier(s) correspondant(s) :`,
          ...items.slice(0, 20).map(it => `- [${it.filename}] (doc:${it.id})${it.isVideo ? " — (vidéo)" : ""}`),
          ...(items.length > 20 ? [`… et ${items.length - 20} autre(s).` ] : []),
        ];
        return res.json({
          ok: true,
          text: textLines.join("\n"),
          citations: [],      // pas de chunks
          contexts: [],       // pas de regroupement chunk
          suggestions: items, // UI : affiche en galerie de fichiers + bouton “Ouvrir”
        });
      }
      // Pas d’items… on continue sur RAG pour tenter des proximités sémantiques.
    }

    if (!hasChunks) {
      // Base vide → tenter fuzzy encore (au cas où) sinon message clair
      const items = await fuzzyFindOnFilenames(150);
      if (items.length > 0) {
        const textLines = [
          `Index texte indisponible, mais j’ai trouvé ${items.length} fichier(s) par nom :`,
          ...items.slice(0, 20).map(it => `- [${it.filename}] (doc:${it.id})${it.isVideo ? " — (vidéo)" : ""}`),
          ...(items.length > 20 ? [`… et ${items.length - 20} autre(s).` ] : []),
        ];
        return res.json({ ok: true, text: textLines.join("\n"), citations: [], contexts: [], suggestions: items });
      }
      return res.json({
        ok: true,
        text: "Aucun document n'est indexé pour le moment et aucun fichier n'a été trouvé par nom.",
        citations: [],
        contexts: [],
        suggestions: [],
      });
    }

    // 2) RAG normal (vector search), mais on ne “bloque” plus la réponse s’il n’y a pas d’extraits :
    //    on propose alors des fichiers par fuzzy.
    const emb = (await embedBatch([q]))[0];
    const qvec = toVectorLiteral(emb);
    const limit = (k && k > 0) ? k : Math.max(100, SAFE_WIDE_LIMIT); // élargir un peu par défaut

    const filterSQL = Array.isArray(docFilter) && docFilter.length ? `AND c.doc_id = ANY($3::uuid[])` : ``;
    const params = Array.isArray(docFilter) && docFilter.length ? [qvec, limit, docFilter] : [qvec, limit];

    let { rows } = await pool.query(
      `
      SELECT 
        d.id AS doc_id, d.filename, d.mime,
        c.chunk_index, c.content,
        1 - (c.embedding <=> $1::vector) AS score
      FROM public.askv_chunks c
      JOIN public.askv_documents d ON d.id = c.doc_id
      WHERE true ${filterSQL}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2
      `,
      params
    );

    if (wantVideos) {
      rows = rows.sort((a, b) => {
        const va = (a.mime || "").startsWith("video/") ? 1 : 0;
        const vb = (b.mime || "").startsWith("video/") ? 1 : 0;
        return vb - va || b.score - a.score;
      });
    }

    // Fallback fuzzy si très peu (ou zéro) d’extraits
    let suggestions = [];
    if (rows.length < 3) {
      suggestions = await fuzzyFindOnFilenames(150);
      if (rows.length === 0 && suggestions.length > 0) {
        // Réponse directe, sans LLM : on ne bloque plus “faute de contexte”
        const lines = [
          `Je n’ai pas d’extrait texte pertinent, mais j’ai trouvé ${suggestions.length} fichier(s) par nom :`,
          ...suggestions.slice(0, 20).map(it => `- [${it.filename}] (doc:${it.id})${it.isVideo ? " — (vidéo)" : ""}`),
          ...(suggestions.length > 20 ? [`… et ${suggestions.length - 20} autre(s).`] : []),
          `Dites-moi lequel vous voulez ouvrir 👆 (ou précisez la machine / réf).`
        ];
        return res.json({
          ok: true,
          text: lines.join("\n"),
          citations: [],
          contexts: [],
          suggestions,
        });
      }
    }

    // Construire le contexte (si on a au moins quelques extraits)
    const historyBlock = Array.isArray(history) && history.length
      ? `\n\nHISTORIQUE:\n${history.map(h => `- ${h.role.toUpperCase()}: ${h.text}`).join("\n")}`
      : "";

    const contextBlocks = rows.map((r, i) => {
      const snippet = (r.content || "").slice(0, 2000);
      return `#${i + 1} — ${r.filename} (doc:${r.doc_id}, chunk:${r.chunk_index})\n${snippet}`;
    }).join("\n\n---\n\n");

    // Prompt : on n’impose plus “uniquement” le contexte. On autorise
    // la proposition de documents si le contexte manque.
    const prompt = [
      {
        role: "system",
        content:
          "Tu es Ask Veeva. Réponds en français, de façon utile et actionnable. " +
          "Si le contexte texte est insuffisant, propose des fichiers correspondants (noms) et des pistes de recherche ('Vouliez-vous dire ...'). " +
          "Si l'utilisateur cherche des vidéos, mets en avant les fichiers vidéo."
      },
      {
        role: "user",
        content:
          `QUESTION:\n${q}${historyBlock}\n\n` +
          (contextBlocks
            ? `CONTEXTE (extraits):\n${contextBlocks}\n\nConsignes:\n- Utilise le contexte si pertinent.\n- En fin de réponse, cite les fichiers utiles: [NomFichier].`
            : `Pas d'extraits texte pertinents trouvés. Propose des documents susceptibles d'aider (par nom / répertoire) et oriente l'utilisateur.`),
      },
    ];

    // LLM seulement si on a au moins un peu de contexte (sinon c’est inutile)
    let text = "";
    if (contextBlocks) {
      const out = await openai.chat.completions.create({
        model: ANSWER_MODEL,
        messages: prompt,
        temperature: 0.2,
      });
      text = out.choices?.[0]?.message?.content || "";
    } else {
      // File listing fallback (cas rare ici, mais on garde par sécurité)
      const items = await fuzzyFindOnFilenames(150);
      text = items.length
        ? `Je n’ai pas d’extrait texte, mais voici des fichiers qui peuvent vous aider:\n` +
          items.slice(0,20).map(it => `- [${it.filename}] (doc:${it.id})${it.isVideo ? " — (vidéo)" : ""}`).join("\n")
        : `Aucun document pertinent trouvé. Essayez une autre écriture (ex: “N2000-2”, “N20002”, “IDR 20002”).`;
      suggestions = items;
    }

    // Citations enrichies + contexts groupés
    const citations = rows.map((r) => ({
      doc_id: r.doc_id,
      filename: r.filename,
      chunk_index: r.chunk_index,
      score: Number(r.score),
      snippet: (r.content || "").slice(0, 400),
      mime: r.mime,
    }));

    const byDoc = new Map();
    for (const c of citations) {
      const list = byDoc.get(c.doc_id) || { doc_id: c.doc_id, filename: c.filename, chunks: [], mime: c.mime };
      list.chunks.push({ chunk_index: c.chunk_index, snippet: c.snippet, score: c.score });
      byDoc.set(c.doc_id, list);
    }
    const contexts = Array.from(byDoc.values());

    // Mémoire légère
    const suggestedIds = [...new Set([
      ...contexts.map((c) => c.doc_id),
      ...suggestions.map((s) => s.id),
    ])];
    try {
      await pool.query(
        `INSERT INTO askv_interactions (question, suggested_doc_ids) VALUES ($1,$2)`,
        [q, suggestedIds]
      );
    } catch {}

    res.json({ ok: true, text, citations, contexts, suggestions });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// -----------------------------------------------------------------------------
// BOOT
// -----------------------------------------------------------------------------
await ensureSchema();

app.listen(PORT, HOST, () => {
  console.log(`[ask-veeva] service listening on :${PORT}`);
});
