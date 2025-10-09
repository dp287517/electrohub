// server_ask_veeva.js — Ask Veeva (sans S3, upload fractionné, RAG) — version PDF.js .mjs robust
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
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

const PORT = Number(process.env.ASK_VEEVA_PORT || 3015);
const HOST = process.env.ASK_VEEVA_HOST || "127.0.0.1";

const DATA_ROOT = path.join(process.cwd(), "uploads", "ask-veeva");
const UPLOAD_DIR = path.join(DATA_ROOT, "incoming");
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const PARTS_DIR = path.join(DATA_ROOT, "parts");
await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(TMP_DIR, { recursive: true });
await fsp.mkdir(PARTS_DIR, { recursive: true });

// -----------------------------------------------------------------------------
// PDF.js (Node): legacy build + standard fonts
//  - Certaines versions ne publient que *.mjs (pas *.js).
//  - On résout le worker en legacy (si présent) sinon fallback vers build standard.
// -----------------------------------------------------------------------------
function resolvePdfWorker() {
  try {
    // priorité: legacy .mjs
    return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    // fallback: build standard .mjs
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
      kind TEXT NOT NULL,  -- 'zip','zip-chunked','file'
      status TEXT NOT NULL DEFAULT 'queued', -- queued|running|done|error
      total_files INT DEFAULT 0,
      processed_files INT DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Index vector (IVFFLAT) – ok car dims=1536 (< 2000)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='askv_chunks_embedding_ivf'
      ) THEN
        CREATE INDEX askv_chunks_embedding_ivf
        ON askv_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      END IF;
    END $$;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id, chunk_index);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_documents_fname_idx ON askv_documents(filename);`);
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
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 Mo max pour l’upload direct
});

// Multer — Upload des parts (chunked)
const uploadChunk = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PARTS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: Math.min(CHUNK_PART_SIZE * 2, 64 * 1024 * 1024) }, // sécurité
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
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ normalizeWhitespace: true });
    const text = content.items.map((it) => it.str).join(" ");
    out += `\n\n[PAGE ${p}]\n${text}`;
    page.cleanup();
  }
  await doc.cleanup();
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
  return { _noIndex: true, bytes: stat.size }; // pas d’ASR local ici
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
// Embeddings
// -----------------------------------------------------------------------------
async function embedBatch(texts) {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

// -----------------------------------------------------------------------------
// Ingestion d’un fichier concret
// -----------------------------------------------------------------------------
async function ingestConcreteFile(absPath, originalName, ext, bytes) {
  let parsed = "";
  if (ext === ".pdf") {
    parsed = await parsePDF(absPath);
  } else if (ext === ".docx") {
    parsed = await parseDOCX(absPath);
  } else if (ext === ".xlsx" || ext === ".xls") {
    parsed = await parseXLSX(absPath);
  } else if (ext === ".csv") {
    parsed = await parseCSV(absPath);
  } else if (ext === ".txt" || ext === ".md") {
    parsed = await parseTXT(absPath);
  } else if (ext === ".mp4" || ext === ".mov" || ext === ".m4v") {
    const info = await parseMP4(absPath);
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, absPath, "video/mp4", bytes || info.bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  } else {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, absPath, "application/octet-stream", bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  if (!parsed || parsed.trim().length === 0) {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, absPath, "text/plain", bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: true };
  }

  const { rows } = await pool.query(
    `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
    [originalName, absPath, "text/plain", bytes || 0]
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
      params.push(`($${values.length + 1}, $${values.length + 2}, $${values.length + 3}, $${values.length + 4})`);
      values.push(docId, idx + j, batch[j], embeds[j]);
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
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      service: "ask-veeva",
      model: ANSWER_MODEL,
      embeddings: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      s3Configured: false,
      limits: {
        EMBED_BATCH,
        MAX_CONCURRENT_JOBS,
        PDF_CHUNK_SIZE,
        PDF_CHUNK_OVERLAP,
        CHUNK_PART_SIZE,
      },
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
    // estimation du nombre d’entrées
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

    // nettoyage des parts en arrière-plan
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
// SEARCH + ASK
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/search", async (req, res) => {
  try {
    const { query, k = 6 } = req.body || {};
    if (!query || String(query).trim() === "") return res.status(400).json({ error: "query requis" });

    const emb = (await embedBatch([query]))[0];
    const { rows } = await pool.query(
      `
      SELECT d.filename, c.content, 1 - (c.embedding <=> $1::vector) AS score
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2
      `,
      [emb, k]
    );
    const matches = rows.map((r) => ({
      meta: { filename: r.filename },
      snippet: r.content.slice(0, 1000),
      score: Number(r.score),
    }));
    res.json({ ok: true, matches });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/ask-veeva/ask", async (req, res) => {
  try {
    const { question, k = 6 } = req.body || {};
    if (!question || String(question).trim() === "") return res.status(400).json({ error: "question requise" });

    const emb = (await embedBatch([question]))[0];
    const { rows } = await pool.query(
      `
      SELECT d.filename, c.content, 1 - (c.embedding <=> $1::vector) AS score
      FROM askv_chunks c
      JOIN askv_documents d ON d.id = c.doc_id
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2
      `,
      [emb, k]
    );

    const context = rows
      .map((r, i) => `#${i + 1} — ${r.filename}\n${(r.content || "").slice(0, 2000)}`)
      .join("\n\n---\n\n");

    const prompt = [
      {
        role: "system",
        content:
          "Tu es Ask Veeva. Réponds de façon concise en français. Si l'information n'est pas dans le contexte, dis-le.",
      },
      {
        role: "user",
        content:
          `QUESTION:\n${question}\n\nCONTEXTE (extraits):\n${context}\n\nConsigne: cite les fichiers pertinents en fin de réponse.`,
      },
    ];

    const out = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: prompt,
      temperature: 0.2,
    });

    const text = out.choices?.[0]?.message?.content || "";
    const citations = rows.map((r) => ({ filename: r.filename, score: Number(r.score) }));
    res.json({ ok: true, text, citations });
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
