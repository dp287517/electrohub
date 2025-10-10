// server_ask_veeva.js — Ask Veeva (sans S3, upload fractionné, RAG)
// + Personalization + Auto-profile (poste/secteur) + /me
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

// IMPORTANT : garde un répertoire stable (monte un volume dessus en prod)
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

// Pas de S3
const S3_BUCKET = null;

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

// Auto-resolve email middleware
app.use((req, _res, next) => {
  const hdr = req.headers["x-user-email"] || req.headers["x-auth-email"];
  const fromHdr = safeEmail(hdr);
  const fromCookie = safeEmail(readCookie(req, "veeva_email"));
  const fromQuery = safeEmail(req.query?.email);
  const fromBody = safeEmail(req.body?.email);
  req.userEmail = fromHdr || fromCookie || fromQuery || fromBody || null;
  next();
});

// -----------------------------------------------------------------------------
// Schéma (incluant Perso/Feedback/Synonymes)
// -----------------------------------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS askv_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename TEXT NOT NULL,
      path TEXT NOT NULL,           -- chemin absolu actuel (gardé pour compat)
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
      role TEXT,        -- Qualité / EHS / Utilités / Packaging
      sector TEXT,      -- SSOL / LIQ / Bulk / Autre
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

  // -------------------- PATCHWORK INDEX PGVECTOR (robuste & non bloquant) --------------------
  // - lists configurable (ASK_VEEVA_IVF_LISTS, défaut 100)
  // - tentative d'augmenter maintenance_work_mem (ASK_VEEVA_MAINT_WORK_MEM, défaut 128MB) si autorisé
  // - fallback auto vers HNSW si IVFFLAT échoue par manque mémoire (code 54000)
  // - en cas d'échec, on loggue mais on ne bloque pas le démarrage
  const IVF_LISTS = Number(process.env.ASK_VEEVA_IVF_LISTS || 100);
  const MAINT_WORK_MEM = String(process.env.ASK_VEEVA_MAINT_WORK_MEM || "128MB");

  try {
    // index déjà présent ?
    const { rows: idx } = await pool.query(`
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'askv_chunks_embedding_idx'
      LIMIT 1
    `);
    if (!idx.length) {
      // Optionnel : essaye d'augmenter la mémoire de maintenance pour la session
      try {
        await pool.query(`SET maintenance_work_mem = '${MAINT_WORK_MEM}'`);
      } catch (e) {
        console.warn(`[ask-veeva] SET maintenance_work_mem='${MAINT_WORK_MEM}' refusé (${e?.message || e}). On continue.`);
      }

      // Tentative IVFFLAT
      try {
        await pool.query(`
          CREATE INDEX askv_chunks_embedding_idx
          ON askv_chunks USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = ${IVF_LISTS})
        `);
        console.log(`[ask-veeva] Index pgvector IVFFLAT créé (lists=${IVF_LISTS}).`);
      } catch (e) {
        const msg = String(e?.message || "");
        const code = e?.code || "";
        const oom = code === "54000" || /memory required/i.test(msg);

        if (oom) {
          console.warn("[ask-veeva] IVFFLAT manque de mémoire → fallback HNSW...");
          await pool.query(`
            CREATE INDEX askv_chunks_embedding_idx
            ON askv_chunks USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
          `);
          console.log("[ask-veeva] Index pgvector HNSW créé (fallback).");
        } else {
          // autre erreur : on loggue mais on ne bloque pas le boot
          console.error("[ask-veeva] Création d'index vectoriel échouée (non bloquant) :", e);
        }
      }
    }
  } catch (e) {
    console.error("[ask-veeva] Vérification/création d'index vectoriel échouée (non bloquant) :", e);
  }
  // ------------------------------------------------------------------------------------------

  try {
    await pool.query(`ANALYZE askv_chunks;`);
  } catch (e) {
    console.warn("[ask-veeva] ANALYZE askv_chunks a échoué (non bloquant) :", e?.message || e);
  }
}

// -----------------------------------------------------------------------------
// Utilities Perso
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

// NLU ultra légère pour poste/secteur
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
    if (group.some(alias => s.includes(alias))) return group[0]; // canon
  }
  // Accept reply like "Packaging" exact-ish
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
// ZIP streaming
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

// -----------------------------------------------------------------------------
// Chunking
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
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}
function toVectorLiteral(arr) {
  return "[" + arr.map((x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v.toString() : "0";
  }).join(",") + "]";
}

// -----------------------------------------------------------------------------
// Ingestion fichier
// -----------------------------------------------------------------------------
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

  // ⚠️ si un PDF scanné => parsed vide. TODO: OCR fallback ici.
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
// ROUTES — /me (profil courant) & personnalisation
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
    console.error("initUser:", e);
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
    console.error("logEvent:", e);
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
    console.error("feedback:", e);
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
// SEARCH + ASK
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

// --------- Helpers Lookup strict (SOP & co) ---------------------------------
const SOP_LOOKUP_INTENT = /(?:\bnum(é|e)ro\b|\br(é|e)f(é|e)rence\b|\bcode\b).*?\bSOP\b|\bSOP\b.*?(?:num(é|e)ro|r(é|e)f(é|e)rence|code)/i;
const GENERIC_SOP_TOKEN = /\bSOP\b/i;
// capture formats : QD-SOP-017006, SOP-017006, SOP 17006, etc.
const SOP_CODE_REGEXES = [
  /\bQD-?SOP[-\s]?(\d{5,7})\b/ig,
  /\bSOP[-\s]?(\d{5,7})\b/ig,
  /\bSOP[-\s]?([A-Z0-9][A-Z0-9-]{2,})\b/ig
];

function extractSOPCodesFromText(text = "") {
  const found = [];
  for (const re of SOP_CODE_REGEXES) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const full = m[0].replace(/\s+/g, "");
      if (!found.includes(full)) found.push(full);
    }
  }
  return found;
}

function dedupBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (!seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
}

// -----------------------------------------------------------------------------
// ASK
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/ask", async (req, res) => {
  const t0 = Date.now();
  try {
    let { question, k = 6, docFilter = [], contextMode = "auto" } = req.body || {};
    if (!question || String(question).trim() === "") return res.status(400).json({ error: "question requise" });

    const originalQuestion = String(question);
    const userEmail = safeEmail(req.userEmail);
    let user = userEmail ? await ensureUser(userEmail) : null;

    // Auto-profil : si poste/secteur manquants, essaye de déduire depuis la question
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
      if (!user.role || !user.sector) {
        const missing = !user.role && !user.sector
          ? "ton poste (Qualité, EHS, Utilités, Packaging) puis ton secteur (SSOL, LIQ, Bulk, Autre)"
          : (!user.role ? "ton poste (Qualité, EHS, Utilités, Packaging)" : "ton secteur (SSOL, LIQ, Bulk, Autre)");
        return res.json({
          ok: false,
          needProfile: true,
          question: `Avant de continuer, indique ${missing}. Tu peux répondre par exemple : « Packaging » puis « SSOL ».`
        });
      }
    }

    if (contextMode === "none") {
      await pool.query(
        `INSERT INTO askv_events(user_email,type,question,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4)`,
        [userEmail, originalQuestion, Date.now() - t0, { contextMode }]
      );
      return res.json({
        ok: true,
        text: `Mode sans contexte activé. Je peux répondre de manière générale, mais pour des infos précises, active le contexte.\n\nQuestion: ${originalQuestion}`,
        citations: [],
        contexts: [],
      });
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

    try { question = await expandQueryWithSynonyms(originalQuestion); } catch {}

    const isSOPLookup = SOP_LOOKUP_INTENT.test(originalQuestion) || GENERIC_SOP_TOKEN.test(originalQuestion);
    // Pour les lookups, on garde un K raisonnable (<=6) pour éviter le bruit
    const kForQuery = isSOPLookup ? Math.min(k ?? 6, 6) : k;

    const emb = (await embedBatch([question]))[0];
    const qvec = toVectorLiteral(emb);

    const filterSQL = Array.isArray(docFilter) && docFilter.length
      ? `WHERE c.doc_id = ANY($3::uuid[])`
      : ``;
    const params = Array.isArray(docFilter) && docFilter.length ? [qvec, kForQuery, docFilter] : [qvec, kForQuery];

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

    // Boost perso (docs déjà ouverts par l'utilisateur)
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

    rows = rows.map(r => {
      const p = prefBoost[r.doc_id] || 1;
      const roleBias = softRoleBiasScore(r.filename, user?.role, user?.sector);
      return { ...r, score: r.score * p + roleBias };
    }).sort((a,b)=> b.score - a.score);

    // ------------------ BRANCHE LOOKUP STRICT (SOP) -------------------------
    if (isSOPLookup) {
      const candidates = [];
      for (const r of rows.slice(0, Math.max(3, Math.min(10, kForQuery)))) {
        const fromContent = extractSOPCodesFromText(r.content || "");
        const fromFilename = extractSOPCodesFromText(r.filename || "");
        const all = [...fromContent, ...fromFilename];
        for (const code of all) {
          candidates.push({
            code,
            doc_id: r.doc_id,
            filename: r.filename,
            chunk_index: r.chunk_index,
            score: Number(r.score)
          });
        }
      }

      const uniq = dedupBy(candidates, x => x.code).sort((a,b)=> b.score - a.score);
      if (uniq.length === 0) {
        // Pas de code trouvé → réponse courte + 1–2 docs pertinents
        const shortDocs = dedupBy(rows, x => x.doc_id).slice(0, 2);
        const text = `Je n’ai pas trouvé de numéro de SOP explicite dans le contexte le plus pertinent.
Vous pouvez ouvrir ${shortDocs.map(d => `[${d.filename}]`).join(" et ")} pour vérifier.`;
        const citations = shortDocs.map(d => ({
          doc_id: d.doc_id,
          filename: d.filename,
          chunk_index: d.chunk_index,
          score: Number(d.score),
          snippet: (d.content || "").slice(0, 400),
        }));
        const contexts = dedupBy(shortDocs, d => d.doc_id).map(d => ({
          doc_id: d.doc_id,
          filename: d.filename,
          chunks: [{ chunk_index: d.chunk_index, snippet: (d.content || "").slice(0, 400), score: Number(d.score) }]
        }));

        try {
          await pool.query(
            `INSERT INTO askv_events(user_email,type,question,meta) VALUES ($1,'ask_issued',$2,$3)`,
            [userEmail, originalQuestion, { k: kForQuery, docFilter, contextMode, intent: "lookup_sop", found: 0 }]
          );
          await pool.query(
            `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
            [userEmail, originalQuestion, text.length, Date.now() - t0, { citations: citations.length, intent: "lookup_sop" }]
          );
        } catch {}

        return res.json({ ok: true, text, citations, contexts });
      }

      const best = uniq[0];
      const extras = uniq.slice(1, 3);
      const text = extras.length
        ? `Le numéro de la SOP est **${best.code}**.
Autres possibles (à vérifier) : ${extras.map(e => `**${e.code}**`).join(", ")}.`
        : `Le numéro de la SOP est **${best.code}**.`;

      // 1 seule citation principale
      const mainRow = rows.find(r => r.doc_id === best.doc_id) || {};
      const citations = [{
        doc_id: best.doc_id,
        filename: best.filename,
        chunk_index: mainRow.chunk_index ?? best.chunk_index,
        score: Number(best.score),
        snippet: (mainRow.content || "").slice(0, 400)
      }];

      const contexts = [{
        doc_id: best.doc_id,
        filename: best.filename,
        chunks: [{
          chunk_index: citations[0].chunk_index,
          snippet: citations[0].snippet,
          score: citations[0].score
        }]
      }];

      try {
        await pool.query(
          `INSERT INTO askv_events(user_email,type,question,meta) VALUES ($1,'ask_issued',$2,$3)`,
          [userEmail, originalQuestion, { k: kForQuery, docFilter, contextMode, intent: "lookup_sop", found: uniq.length }]
        );
        await pool.query(
          `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
          [userEmail, originalQuestion, text.length, Date.now() - t0, { citations: citations.length, intent: "lookup_sop" }]
        );
      } catch {}

      return res.json({ ok: true, text, citations, contexts });
    }
    // ------------------ FIN BRANCHE LOOKUP STRICT ---------------------------

    // Chemin RAG “explicatif” standard
    const contextBlocks = rows.map((r, i) => {
      const snippet = (r.content || "").slice(0, 2000);
      return `#${i + 1} — ${r.filename} (doc:${r.doc_id}, chunk:${r.chunk_index})\n${snippet}`;
    }).join("\n\n---\n\n");

    const prompt = [
      { role: "system",
        content:
          "Tu es Ask Veeva. Réponds de façon concise en français. Si l'info n'est pas dans le contexte, dis-le clairement. Structure si utile (listes courtes)." },
      { role: "user",
        content:
          `QUESTION:\n${originalQuestion}\n\nCONTEXTE (extraits):\n${contextBlocks}\n\nConsignes:\n- Réponds uniquement avec les informations du contexte.\n- Cite les fichiers pertinents en fin de réponse sous la forme: [NomFichier.pdf].` },
    ];

    const out = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: prompt,
      temperature: 0.2,
    });

    const text = out.choices?.[0]?.message?.content || "";

    const citations = rows.map((r) => ({
      doc_id: r.doc_id,
      filename: r.filename,
      chunk_index: r.chunk_index,
      score: Number(r.score),
      snippet: (r.content || "").slice(0, 400),
    }));

    const byDoc = new Map();
    for (const c of citations) {
      const list = byDoc.get(c.doc_id) || { doc_id: c.doc_id, filename: c.filename, chunks: [] };
      list.chunks.push({ chunk_index: c.chunk_index, snippet: c.snippet, score: c.score });
      byDoc.set(c.doc_id, list);
    }
    const contexts = Array.from(byDoc.values());

    try {
      await pool.query(
        `INSERT INTO askv_events(user_email,type,question,meta) VALUES ($1,'ask_issued',$2,$3)`,
        [userEmail, originalQuestion, { k: kForQuery, docFilter, contextMode }]
      );
      await pool.query(
        `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
        [userEmail, originalQuestion, text.length, Date.now() - t0, { citations: citations.length }]
      );
    } catch {}

    res.json({ ok: true, text, citations, contexts });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// -----------------------------------------------------------------------------
// ROUTES — Upload direct / chunked
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
// ROUTE : servir le fichier original (avec fallback STORE_DIR)
// -----------------------------------------------------------------------------
app.get("/api/ask-veeva/file/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, filename, path, mime FROM askv_documents WHERE id = $1`, [req.params.id]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "doc not found" });

    let abs = doc.path;
    const exists = abs && fs.existsSync(abs);
    if (!exists) {
      // 🔁 Fallback si le chemin absolu stocké est obsolète (changement de racine)
      const alt = path.join(STORE_DIR, path.basename(doc.path || doc.filename || ""));
      if (alt && fs.existsSync(alt)) {
        abs = alt;
      } else {
        return res.status(404).json({ error: "file not on disk" });
      }
    }

    if (doc.mime) res.type(doc.mime);
    res.sendFile(path.resolve(abs));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// BOOT
// -----------------------------------------------------------------------------
await ensureSchema();

app.listen(PORT, HOST, () => {
  console.log(`[ask-veeva] service listening on ${HOST}:${PORT}`);
});
