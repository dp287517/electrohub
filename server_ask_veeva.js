// server_ask_veeva.js — Ask Veeva (DeepSearch ready, hybrid retriever + topic memory + global/specific intent)
// server_ask_veeva.js — Ask Veeva (DeepSearch++ v5 ready)
// Node ESM

import express from "express";
@@ -74,11 +74,8 @@ await fsp.mkdir(STORE_DIR, { recursive: true });
// PDF.js (Node): legacy build + standard fonts
// -----------------------------------------------------------------------------
function resolvePdfWorker() {
  try {
    return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    return require.resolve("pdfjs-dist/build/pdf.worker.mjs");
  }
  try { return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"); }
  catch { return require.resolve("pdfjs-dist/build/pdf.worker.mjs"); }
}
const workerSrc = resolvePdfWorker();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
@@ -99,8 +96,12 @@ const PDF_CHUNK_SIZE = Math.max(600, Number(process.env.ASK_VEEVA_PDF_CHUNK_SIZE
const PDF_CHUNK_OVERLAP = Math.max(0, Number(process.env.ASK_VEEVA_PDF_CHUNK_OVERLAP || 200));
const CHUNK_PART_SIZE = Math.max(2, Number(process.env.ASK_VEEVA_CHUNK_MB || 10)) * 1024 * 1024;

// Pysearch (FastAPI) — DeepSearch v4
const PYSEARCH_URL = process.env.PYSEARCH_URL || "http://127.0.0.1:8088/search";
// Pysearch (FastAPI) — DeepSearch++ v5
const PY_BASE = (process.env.PYSEARCH_BASE || "http://127.0.0.1:8088").replace(/\/+$/,"");
const PYSEARCH_URL = `${PY_BASE}/search`;
const PYHEALTH_URL = `${PY_BASE}/health`;
const PYREINDEX_URL = `${PY_BASE}/reindex`;
const PYCOMPARE_URL = `${PY_BASE}/compare`;
const PYSEARCH_ON = process.env.PYSEARCH_OFF ? false : true;

// Deep toggles and prompt behavior
@@ -147,9 +148,7 @@ function norm(s = "") {
.replace(/\s+/g, " ")
.trim();
}
function tokens(s = "") {
  return norm(s).split(/\s+/).filter(Boolean);
}
function tokens(s = "") { return norm(s).split(/\s+/).filter(Boolean); }
function jaccard(a, b) {
const A = new Set(a), B = new Set(b);
const inter = [...A].filter(x => B.has(x)).length;
@@ -175,8 +174,32 @@ function guessLang(q) {

// Variantes N####-#
function expandNline(q) {
  return q
    .replace(/\bN?\s*([12]\d{3})\s*[-\s_]*([0-9])\b/gi, (_, a, b) => `N${a}-${b}`);
  return q.replace(/\bN?\s*([12]\d{3})\s*[-\s_]*([0-9])\b/gi, (_, a, b) => `N${a}-${b}`);
}

// SOP/IDR extraction helpers
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

// Heuristique généralité de fichier
function isGeneralFilename(fn = "") {
  const f = norm(fn);
  const hasLineNo = /\b(91\d{2}|N\d{3,4}[-\s_]*\d)\b/.test(f) || /\b(ligne|line|micro)\b/.test(f);
  const isSOP = /\b(sop|qd-sop)\b/.test(f);
  const hasGlobalWords = /\b(procedure|procédure|dechet|dechets|waste|global|site|usine|policy|policies)\b/.test(f);
  return (isSOP || hasGlobalWords) && !hasLineNo;
}
function isSpecificFilename(fn = "") {
  const f = norm(fn);
  return /\b(91\d{2}|N\d{3,4}[-\s_]*\d|ligne|line|micro|neri|vignetteuse)\b/.test(f);
}

// -----------------------------------------------------------------------------
@@ -192,17 +215,14 @@ app.use((req, res, next) => {

// Thread id (light memory)
let thread = readCookie(req, "askv_thread");
  if (!thread) {
    thread = crypto.randomUUID();
    setCookie(res, "askv_thread", thread);
  }
  if (!thread) { thread = crypto.randomUUID(); setCookie(res, "askv_thread", thread); }
req.threadId = thread;

next();
});

// -----------------------------------------------------------------------------
// Schéma
// Schéma (v5) — idempotent
// -----------------------------------------------------------------------------
async function ensureSchema() {
await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
@@ -219,15 +239,21 @@ async function ensureSchema() {
   );
 `);

  // Chunks v5: + page + section_title
await pool.query(`
   CREATE TABLE IF NOT EXISTS askv_chunks (
     id BIGSERIAL PRIMARY KEY,
     doc_id UUID REFERENCES askv_documents(id) ON DELETE CASCADE,
     chunk_index INT NOT NULL,
     content TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIMS})
      embedding vector(${EMBEDDING_DIMS}),
      page INT,
      section_title TEXT
   );
 `);
  // Backfill columns if table existed
  try { await pool.query(`ALTER TABLE askv_chunks ADD COLUMN IF NOT EXISTS page INT`); } catch {}
  try { await pool.query(`ALTER TABLE askv_chunks ADD COLUMN IF NOT EXISTS section_title TEXT`); } catch {}

await pool.query(`
   CREATE TABLE IF NOT EXISTS askv_jobs (
@@ -282,10 +308,25 @@ async function ensureSchema() {
   );
 `);

  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id, chunk_index);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_documents_fname_idx ON askv_documents(filename);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_events_user_idx ON askv_events(user_email, ts);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_synonyms_term_idx ON askv_synonyms(term, weight DESC);`);
  // NEW: spans table (optionnel mais exploité par pysearch v5)
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
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_spans_doc_idx ON askv_spans(doc_id, page, chunk_index, span_index)`);

  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_doc_idx ON askv_chunks(doc_id, chunk_index)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_chunks_page_idx ON askv_chunks(doc_id, page)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_documents_fname_idx ON askv_documents(filename)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_events_user_idx ON askv_events(user_email, ts)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS askv_synonyms_term_idx ON askv_synonyms(term, weight DESC)`);

// Index vectoriel
const IVF_LISTS = Number(process.env.ASK_VEEVA_IVF_LISTS || 100);
@@ -380,12 +421,8 @@ const SECTOR_CANON = [
];
function detectFromList(text, lists) {
const s = (text || "").toLowerCase();
  for (const group of lists) {
    if (group.some(alias => s.includes(alias))) return group[0];
  }
  for (const group of lists) {
    if (group.some(alias => s.trim() === alias)) return group[0];
  }
  for (const group of lists) if (group.some(alias => s.includes(alias))) return group[0];
  for (const group of lists) if (group.some(alias => s.trim() === alias)) return group[0];
return null;
}
function detectRole(text){ return detectFromList(text, ROLE_CANON); }
@@ -404,7 +441,6 @@ const uploadDirect = multer({
}),
limits: { fileSize: 300 * 1024 * 1024 },
});

const uploadChunk = multer({
storage: multer.diskStorage({
destination: (_req, _file, cb) => cb(null, PARTS_DIR),
@@ -424,13 +460,8 @@ async function createJob(kind, totalFiles = 0) {
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
  const fields = []; const values = []; let i = 1;
  for (const [k, v] of Object.entries(patch)) { fields.push(`${k} = $${i++}`); values.push(v); }
values.push(id);
await pool.query(`UPDATE askv_jobs SET ${fields.join(", ")}, updated_at = now() WHERE id = $${i}`, values);
}
@@ -462,65 +493,100 @@ async function streamIngestZip(absZipPath, onFile) {
await zip.close();
}

// PDF → pages[] ({page,text})
async function parsePDF(absPath) {
const data = new Uint8Array(await fsp.readFile(absPath));
const loadingTask = pdfjsLib.getDocument({ data, standardFontDataUrl: PDF_STANDARD_FONTS });
const doc = await loadingTask.promise;
  let out = "";
  const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
try {
const page = await doc.getPage(p);
const content = await page.getTextContent({ normalizeWhitespace: true });
      const text = content.items.map((it) => it.str).join(" ");
      out += `\n\n[PAGE ${p}]\n${text}`;
      const text = (content.items || []).map((it) => it.str).join(" ");
      pages.push({ page: p, text: (text || "").trim() });
page.cleanup();
} catch {
      out += `\n\n[PAGE ${p}] (erreur d'extraction)`;
      pages.push({ page: p, text: "" });
}
}
  await doc.cleanup();
  try { loadingTask.destroy?.(); } catch {}
  return out.trim();
  await doc.cleanup(); try { loadingTask.destroy?.(); } catch {}
  return pages;
}

async function parseDOCX(absPath) {
const buf = await fsp.readFile(absPath);
const { value } = await mammoth.extractRawText({ buffer: buf });
  return (value || "").trim();
  const text = (value || "").trim();
  // emulate pages (unknown) as 1 page
  return [{ page: 1, text }];
}
async function parseXLSX(absPath) {
const wb = xlsx.readFile(absPath, { cellDates: false, cellNF: false, cellText: false });
const sheets = wb.SheetNames || [];
  let out = "";
  const out = [];
for (const s of sheets) {
const ws = wb.Sheets[s];
const csv = xlsx.utils.sheet_to_csv(ws, { FS: ",", RS: "\n", blankrows: false });
    if (csv && csv.trim()) out += `\n\n[SHEET ${s}]\n${csv}`;
    if (csv && csv.trim()) out.push(`[SHEET ${s}]\n${csv}`);
}
  return out.trim();
  const text = out.join("\n\n").trim();
  return [{ page: 1, text }];
}
async function parseCSV(absPath) {
const text = await fsp.readFile(absPath, "utf8");
  return text.trim();
  return [{ page: 1, text: text.trim() }];
}
async function parseTXT(absPath) {
const text = await fsp.readFile(absPath, "utf8");
  return text.trim();
  return [{ page: 1, text: text.trim() }];
}
async function parseMP4(absPath) {
const stat = await fsp.stat(absPath);
return { _noIndex: true, bytes: stat.size };
}

// Chunking
function windows(text, size = PDF_CHUNK_SIZE, overlap = PDF_CHUNK_OVERLAP) {
// Section guess (very light): first line in ALL CAPS or numbered headings
function guessSectionTitles(text) {
  const lines = String(text || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  const titles = [];
  for (const ln of lines.slice(0, 30)) {
    if (/^(\d+[\.\)]\s+)?[A-Z0-9][A-Z0-9 \-_/]{4,}$/.test(ln) && ln.length <= 120) {
      titles.push(ln);
    }
  }
  return titles.slice(0, 3);
}

// Chunking by page, preserving page number and a section title if present
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

// Spans (phrase-level) from chunks: simple sentence windows
function spansFromChunk(content, page, chunkIndex, maxSpans = 6) {
  const sents = String(content || "")
    .split(/(?<=[\.\!\?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 20 && s.length <= 400);
const out = [];
  const clean = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  let i = 0;
  while (i < clean.length) {
    const w = clean.slice(i, i + size);
    out.push(w);
    if (i + size >= clean.length) break;
    i += size - overlap;
  let k = 0;
  for (const s of sents) {
    out.push({ page, chunk_index: chunkIndex, span_index: k++, text: s });
    if (out.length >= maxSpans) break;
}
return out;
}
@@ -543,6 +609,7 @@ async function ingestConcreteFile(absPath, originalName, ext, bytes) {
const finalAbs = path.join(STORE_DIR, safeName);
await fsp.copyFile(absPath, finalAbs);

  // Videos: index metadata only
if (ext === ".mp4" || ext === ".mov" || ext === ".m4v" || ext === ".webm") {
const info = await parseMP4(absPath);
const { rows } = await pool.query(
@@ -552,12 +619,12 @@ async function ingestConcreteFile(absPath, originalName, ext, bytes) {
return { docId: rows[0].id, chunks: 0, skipped: true };
}

  let parsed = "";
  if (ext === ".pdf") parsed = await parsePDF(absPath);
  else if (ext === ".docx") parsed = await parseDOCX(absPath);
  else if (ext === ".xlsx" || ext === ".xls") parsed = await parseXLSX(absPath);
  else if (ext === ".csv") parsed = await parseCSV(absPath);
  else if (ext === ".txt" || ext === ".md") parsed = await parseTXT(absPath);
  let pages;
  if (ext === ".pdf") pages = await parsePDF(absPath);
  else if (ext === ".docx") pages = await parseDOCX(absPath);
  else if (ext === ".xlsx" || ext === ".xls") pages = await parseXLSX(absPath);
  else if (ext === ".csv") pages = await parseCSV(absPath);
  else if (ext === ".txt" || ext === ".md") pages = await parseTXT(absPath);
else {
const { rows } = await pool.query(
`INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
@@ -566,38 +633,66 @@ async function ingestConcreteFile(absPath, originalName, ext, bytes) {
return { docId: rows[0].id, chunks: 0, skipped: true };
}

  if (!parsed || parsed.trim().length === 0) {
    const { rows } = await pool.query(
      `INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [originalName, finalAbs, "text/plain", bytes || 0]
    );
    return { docId: rows[0].id, chunks: 0, skipped: false };
  }
  const flatText = pages.map(p => p.text).join("\n\n");
  const mime = ext === ".pdf" ? "application/pdf" :
               ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
               ext === ".xlsx" || ext === ".xls" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
               "text/plain";

const { rows } = await pool.query(
`INSERT INTO askv_documents (filename, path, mime, bytes) VALUES ($1,$2,$3,$4) RETURNING id`,
    [originalName, finalAbs, "text/plain", bytes || 0]
    [originalName, finalAbs, mime, bytes || Buffer.byteLength(flatText)]
);
const docId = rows[0].id;

  const segs = windows(parsed, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
  // Build chunks (page-aware) + section title
  const segs = chunksFromPages(pages, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP);
  let chunkIndex = 0;

for (let i = 0; i < segs.length; i += EMBED_BATCH) {
const batch = segs.slice(i, i + EMBED_BATCH);
    const embeds = await embedBatch(batch);
    const embeds = await embedBatch(batch.map(b => b.content));

const params = [];
const values = [];
    let idx = i;

for (let j = 0; j < batch.length; j++) {
      params.push(`($${values.length + 1}, $${values.length + 2}, $${values.length + 3}, $${values.length + 4}::vector)`);
      values.push(docId, idx + j, batch[j], toVectorLiteral(embeds[j]));
      const ci = chunkIndex++;
      const b = batch[j];
      params.push(`($${values.length + 1}, $${values.length + 2}, $${values.length + 3}, $${values.length + 4}::vector, $${values.length + 5}, $${values.length + 6})`);
      values.push(docId, ci, b.content, toVectorLiteral(embeds[j]), b.page || null, b.section_title || null);
}

await pool.query(
      `INSERT INTO askv_chunks (doc_id, chunk_index, content, embedding) VALUES ${params.join(", ")}`,
      `INSERT INTO askv_chunks (doc_id, chunk_index, content, embedding, page, section_title) VALUES ${params.join(", ")}`,
values
);

    // spans (light) for each chunk of this batch
    const spanParams = [];
    const spanValues = [];
    for (let j = 0; j < batch.length; j++) {
      const ci = (i + j); // not used directly (we need db chunk_index we assigned)
    }
    // Fetch back the chunk_index range we just inserted
    const start = chunkIndex - batch.length;
    const end = chunkIndex - 1;
    const { rows: inserted } = await pool.query(
      `SELECT chunk_index, page, content FROM askv_chunks WHERE doc_id=$1 AND chunk_index BETWEEN $2 AND $3 ORDER BY chunk_index`,
      [docId, start, end]
    );
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
@@ -642,38 +737,28 @@ async function runIngestSingleFile(jobId, absPath, originalName) {
const RUNNING = new Set();
const QUEUE = [];
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    QUEUE.push({ fn, resolve, reject });
    pump();
  });
  return new Promise((resolve, reject) => { QUEUE.push({ fn, resolve, reject }); pump(); });
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
  try { next.resolve(await next.fn()); }
  catch (e) { next.reject(e); }
  finally { RUNNING.delete(next); setTimeout(pump, 10); }
}

// -----------------------------------------------------------------------------
// ROUTES — Health / Jobs
// ROUTES — Health / Jobs + pysearch bridge
// -----------------------------------------------------------------------------
app.get("/api/ask-veeva/health", async (_req, res) => {
try {
const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM askv_chunks`);
const mu = process.memoryUsage?.() || {};
    // pysearch health (best-effort)
    let pysearch = { url: PYSEARCH_URL, on: !!PYSEARCH_ON };
    let pysearch = { url: PY_BASE, on: !!PYSEARCH_ON };
try {
      const h = await fetch(PYSEARCH_URL.replace("/search","/health")).then(r=>r.json());
      const h = await fetch(PYHEALTH_URL).then(r=>r.json());
pysearch = { ...pysearch, ...h };
} catch {}
res.json({
@@ -684,7 +769,6 @@ app.get("/api/ask-veeva/health", async (_req, res) => {
dims: EMBEDDING_DIMS,
docCount: dc[0]?.n ?? 0,
memory: { rss: mu.rss, heapTotal: mu.heapTotal, heapUsed: mu.heapUsed, external: mu.external },
      s3Configured: false,
deepClientForce: !!DEEP_CLIENT_FORCE,
mmrClientOn: !!MMR_CLIENT_ON,
limits: { EMBED_BATCH, MAX_CONCURRENT_JOBS, PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP, CHUNK_PART_SIZE },
@@ -694,6 +778,22 @@ app.get("/api/ask-veeva/health", async (_req, res) => {
res.status(500).json({ ok: false, error: e.message });
}
});
app.post("/api/ask-veeva/pysearch/reindex", async (_req, res) => {
  try {
    const r = await fetch(PYREINDEX_URL, { method:"POST" }).then(r=>r.json());
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});
app.get("/api/ask-veeva/pysearch/health", async (_req, res) => {
  try { res.json(await fetch(PYHEALTH_URL).then(r=>r.json())); }
  catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// -----------------------------------------------------------------------------
// ROUTES — Jobs
// -----------------------------------------------------------------------------
app.get("/api/ask-veeva/jobs/:id", async (req, res) => {
const j = await jobById(req.params.id);
if (!j) return res.status(404).json({ error: "job not found" });
@@ -710,9 +810,7 @@ app.get("/api/ask-veeva/me", async (req, res) => {
if (!email) return res.json({ ok: true, user: null });
const user = await ensureUser(email);
res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/initUser", async (req, res) => {
@@ -732,37 +830,29 @@ app.post("/api/ask-veeva/initUser", async (req, res) => {
[email, name || null, role || null, sector || null]
);
res.json({ ok: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/logEvent", async (req, res) => {
try {
const { type, question, doc_id, useful, note, meta } = req.body || {};
await pool.query(
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note,meta) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
[safeEmail(req.userEmail), type || null, question || null, doc_id || null, useful ?? null, note || null, meta || {}]
);
res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/feedback", async (req, res) => {
try {
const { question, doc_id, useful, note } = req.body || {};
await pool.query(
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note)
       VALUES ($1,'feedback',$2,$3,$4,$5)`,
      `INSERT INTO askv_events(user_email,type,question,doc_id,useful,note) VALUES ($1,'feedback',$2,$3,$4,$5)`,
[safeEmail(req.userEmail), question || null, doc_id || null, useful ?? null, note || null]
);
res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/synonyms/update", async (req, res) => {
@@ -776,9 +866,7 @@ app.post("/api/ask-veeva/synonyms/update", async (req, res) => {
[term, alt_term, Number(weight ?? 1.0)]
);
res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ask-veeva/personalize", async (_req, res) => {
@@ -792,20 +880,17 @@ app.post("/api/ask-veeva/personalize", async (_req, res) => {
[email]
)).rows;
res.json({ ok: true, user, top_docs: prefs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------------
// SEARCH (léger) — inchangé (titre + vec), utile pour autocomplete/fallback
// SEARCH léger (autocomplete/fallback)
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/search", async (req, res) => {
const t0 = Date.now();
try {
let { query, k = 6 } = req.body || {};
if (!query || String(query).trim() === "") return res.status(400).json({ error: "query requis" });

try { query = await expandQueryWithSynonyms(query); } catch {}

const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM askv_chunks`);
@@ -868,7 +953,7 @@ app.post("/api/ask-veeva/search", async (req, res) => {
});

// -----------------------------------------------------------------------------
// FIND-DOCS (nouveau) — “Vouliez-vous dire … ?” par filename/fuzzy
// FIND-DOCS (fuzzy filename)
// -----------------------------------------------------------------------------
app.get("/api/ask-veeva/find-docs", async (req, res) => {
try {
@@ -882,21 +967,19 @@ app.get("/api/ask-veeva/find-docs", async (req, res) => {
[n]
);
res.json({ ok: true, items: rows.map(r => ({ doc_id: r.doc_id, filename: r.filename, mime: r.mime })) });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// -----------------------------------------------------------------------------
// INTENT & TOPIC MEMORY
// INTENT & TOPIC MEMORY (thread)
// -----------------------------------------------------------------------------
const THREADS = new Map();
/*
 THREADS[threadId] = {
   lastTerms: string[],
    topicHint: string,           // e.g., "elimination des déchets"
    preferGlobal: boolean,       // true => SOP/procédure cadre
    preferSOP: boolean,          // true => SOP before WI/IDR
    topicHint: string,
    preferGlobal: boolean,
    preferSOP: boolean,
   lastAt: number
 }
*/
@@ -908,75 +991,49 @@ function getThread(threadId) {
function updateThreadFromQuestion(t, q) {
const n = norm(q);
const ts = tokens(q);
  // Global vs spécifique
  if (hasAny(n, ["global", "globale", "général", "generale", "générale", "overall", "corporate", "site", "usine"])) {
    t.preferGlobal = true;
  }
  if (hasAny(n, ["microdoseur", "micro2", "9142", "n2000-2", "n20002", "9143", "ligne", "machine", "éri", "neri", "vfd", "variable frequency drive"])) {
    t.preferGlobal = false;
  }
  // SOP / IDR hints
  if (hasAny(n, ["sop", "procédure", "procedure", "qd-sop"])) t.preferSOP = true;
  if (hasAny(n, ["idr", "réglage", "format"])) t.preferSOP = false;
  if (hasAny(n, ["global","globale","général","generale","générale","overall","corporate","site","usine"])) t.preferGlobal = true;
  if (hasAny(n, ["microdoseur","micro2","9142","n2000-2","n20002","9143","ligne","machine","éri","neri","vfd","variable frequency drive"])) t.preferGlobal = false;
  if (hasAny(n, ["sop","procédure","procedure","qd-sop"])) t.preferSOP = true;
  if (hasAny(n, ["idr","réglage","format"])) t.preferSOP = false;

  // Topic change detection
const overlap = jaccard(t.lastTerms, ts);
  const changed = overlap < 0.18 && t.topicHint && !hasAny(n, ["suite", "continuer", "décris", "décrire", "détaille", "plus"]);
  if (changed) {
    t.topicHint = "";
    t.preferGlobal = false;
    t.preferSOP = false;
  }
  const changed = overlap < 0.18 && t.topicHint && !hasAny(n, ["suite","continuer","décris","décrire","détaille","plus"]);
  if (changed) { t.topicHint = ""; t.preferGlobal = false; t.preferSOP = false; }

  // Update hints
const kw = ts.filter(w => w.length >= 3).slice(0, 8).join(" ");
if (!t.topicHint && kw) t.topicHint = kw;
t.lastTerms = ts;
t.lastAt = Date.now();
}

// Heuristique généralité de fichier
function isGeneralFilename(fn = "") {
  const f = norm(fn);
  const hasLineNo = /\b(91\d{2}|N\d{3,4}[-\s_]*\d)\b/.test(f) || /\b(ligne|line|micro)\b/.test(f);
  const isSOP = /\b(sop|qd-sop)\b/.test(f);
  const hasGlobalWords = /\b(procedure|procédure|dechet|dechets|waste|global|site|usine|policy|policies)\b/.test(f);
  return (isSOP || hasGlobalWords) && !hasLineNo;
}
function isSpecificFilename(fn = "") {
  const f = norm(fn);
  return /\b(91\d{2}|N\d{3,4}[-\s_]*\d|ligne|line|micro)\b/.test(f);
}

// SOP/IDR extraction helpers
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

// -----------------------------------------------------------------------------
// ASK (DeepSearch integration + language bridging)
// ASK (DeepSearch++ bridge) — full symbiose avec pysearch v5
// -----------------------------------------------------------------------------
app.post("/api/ask-veeva/ask", async (req, res) => {
const t0 = Date.now();
try {
    let { question, k = undefined, docFilter = [], contextMode = "auto", intent_hint, normalized_query } = req.body || {};
    if (!question || String(question).trim() === "") return res.status(400).json({ error: "question requise" });
    let {
      question,
      k = undefined,
      docFilter = [],
      contextMode = "auto",
      intent_hint,
      normalized_query,
      rerank = true,
      deep = true
    } = req.body || {};

    if (!question || String(question).trim() === "") {
      return res.status(400).json({ error: "question requise" });
    }

const originalQuestion = String(question);
const qLang = guessLang(originalQuestion);
const normalizedQ = expandNline(normalized_query || originalQuestion);
const userEmail = safeEmail(req.userEmail);
let user = userEmail ? await ensureUser(userEmail) : null;

    // Auto-profil si possible
    // Auto-profil opportuniste (déduction légère rôle/secteur)
if (user && (!user.role || !user.sector)) {
const candRole = detectRole(originalQuestion);
const candSector = detectSector(originalQuestion);
@@ -988,20 +1045,20 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
                updated_at = now()
          WHERE email = $1`,
[userEmail, candRole, candSector]
        );
        ).catch(()=>{});
user = await getUserByEmail(userEmail);
}
}

    // Thread memory
    // Mémoire de thread (global/specific/SOP + topic)
const thread = getThread(req.threadId);
updateThreadFromQuestion(thread, originalQuestion);

    // Mode sans contexte => réponse générique courte
    // Mode sans contexte : réponse générique (guardrail)
if (contextMode === "none") {
      const text = (qLang === "en" ? 
        `Contextless mode.\n\nQuestion: ${originalQuestion}\n\nI can answer generally; tell me if you want me to use indexed documents.` :
        `Mode sans contexte activé.\n\nQuestion : ${originalQuestion}\n\nJe peux répondre de manière générale ; dis-moi si tu veux que je m’appuie sur les documents indexés.`
      const text = (qLang === "en"
        ? `Contextless mode.\n\nQuestion: ${originalQuestion}\n\nI can answer generally; tell me if you want me to use indexed documents.`
        : `Mode sans contexte activé.\n\nQuestion : ${originalQuestion}\n\nJe peux répondre de manière générale ; dis-moi si tu veux que je m’appuie sur les documents indexés.`
);
await pool.query(
`INSERT INTO askv_events(user_email,type,question,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4)`,
@@ -1010,6 +1067,7 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
return res.json({ ok: true, text, citations: [], contexts: [] });
}

    // Vérif index
const { rows: dc } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.askv_chunks`);
if (!dc[0]?.n) {
return res.json({
@@ -1022,36 +1080,45 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
});
}

    // -------- Hybrid candidates from pysearch (DeepSearch v4) --------
    // -------------------------------------------------------------------------
    // 1) DeepSearch (pysearch v5) — hybrid BM25/TF-IDF + codes + MMR + CE
    // -------------------------------------------------------------------------
let hybrid = [];
if (PYSEARCH_ON) {
try {
const body = {
query: normalizedQ,
          k: 80,
          k: 120,
role: user?.role || null,
sector: user?.sector || null,
          rerank: true,
          deep: DEEP_CLIENT_FORCE, // force deep pass from server unless client overrides
          rerank: !!rerank,
          deep: DEEP_CLIENT_FORCE ? true : !!deep
};
        const r = await fetch(PYSEARCH_URL, {
        const rsp = await fetch(PYSEARCH_URL, {
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
      } catch { /* fallback vector below */ }
      } catch {
        // silence → fallback vector below
      }
}

    // -------- Vector (pgvector) baseline --------
    // -------------------------------------------------------------------------
    // 2) Baseline vecteur (pgvector) — robuste & filtrable
    // -------------------------------------------------------------------------
let qForEmbed = normalizedQ;
try { qForEmbed = await expandQueryWithSynonyms(qForEmbed); } catch {}
const emb = (await embedBatch([qForEmbed]))[0];
@@ -1060,9 +1127,9 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
const filterSQL = Array.isArray(docFilter) && docFilter.length
? `WHERE c.doc_id = ANY($3::uuid[])`
: ``;
    const params = Array.isArray(docFilter) && docFilter.length ? [qvec, 60, docFilter] : [qvec, 60];
    const params = Array.isArray(docFilter) && docFilter.length ? [qvec, 80, docFilter] : [qvec, 80];

    let { rows } = await pool.query(
    const { rows: vecRows } = await pool.query(
`
     SELECT 
       d.id AS doc_id, d.filename, 
@@ -1077,46 +1144,45 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
params
);

    // Soft personalization
    let prefBoost = {};
    // Soft personnalisation (doc_opened → boost)
    const prefBoost = {};
try {
const boosts = await pool.query(
`SELECT doc_id, COUNT(*)::int AS cnt
         FROM askv_events
         WHERE user_email=$1 AND type='doc_opened'
         GROUP BY doc_id`,
           FROM askv_events
           WHERE user_email=$1 AND type='doc_opened'
           GROUP BY doc_id`,
[userEmail]
);
for (const b of boosts.rows) prefBoost[b.doc_id] = 1 + Math.min(0.1 * Number(b.cnt || 0), 0.5);
} catch {}

    let vectorList = rows.map(r => {
    const vectorList = vecRows.map(r => {
const p = prefBoost[r.doc_id] || 1;
const roleBias = softRoleBiasScore(r.filename, user?.role, user?.sector);
return {
doc_id: r.doc_id,
filename: r.filename,
chunk_index: r.chunk_index,
        snippet: (r.content || "").slice(0, 1200),
        snippet: (r.content || "").slice(0, 1400),
score_v: Number(r.score) * p + roleBias
};
});

    // -------- Merge & reweight (global vs specific + SOP bias) --------
    // -------------------------------------------------------------------------
    // 3) Fusion & repondération (intent global/specific + SOP + thread state)
    // -------------------------------------------------------------------------
const byKey = new Map();
for (const s of [...hybrid, ...vectorList]) {
const key = `${s.doc_id}:${s.chunk_index}`;
const prev = byKey.get(key);
const score_h = s.score_h ?? 0;
const score_v = s.score_v ?? 0;
      const base = Math.max(prev?.score || 0, 0);
      let score = Math.max(base, 0.6 * score_h + 0.7 * score_v);
      let score = Math.max(prev?.score || 0, 0.62 * score_h + 0.68 * score_v);

      // Intent reweight
if (thread.preferGlobal && isGeneralFilename(s.filename)) score += 0.35;
if (thread.preferGlobal && isSpecificFilename(s.filename)) score -= 0.15;
if (!thread.preferGlobal && isSpecificFilename(s.filename)) score += 0.12;

if (thread.preferSOP && /\b(sop|qd-sop)\b/i.test(s.filename)) score += 0.25;

byKey.set(key, {
@@ -1131,28 +1197,29 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
let merged = Array.from(byKey.values());
merged.sort((a,b)=> b.score - a.score);

    // Si global demandé, garde surtout les génériques en tête
    // Si global demandé, prioriser les génériques visiblement
if (thread.preferGlobal) {
      const generics = merged.filter(m => isGeneralFilename(m.filename)).slice(0, 18);
      const specifics = merged.filter(m => !isGeneralFilename(m.filename)).slice(0, 12);
      const generics = merged.filter(m => isGeneralFilename(m.filename)).slice(0, 24);
      const specifics = merged.filter(m => !isGeneralFilename(m.filename)).slice(0, 16);
merged = [...generics, ...specifics];
}

    // -------- If question is about "numero SOP / IDR", answer with code(s) --------
    // -------------------------------------------------------------------------
    // 4) Demande du numéro (SOP/IDR) → renvoyer code(s) directement
    // -------------------------------------------------------------------------
const askNum = /\b(num(é|e)ro|ref(é|e)rence|code)\b/i.test(originalQuestion) &&
/\b(sop|qd-sop|idr)\b/i.test(originalQuestion);
if (askNum) {
      const top = merged.slice(0, 12);
      const top = merged.slice(0, 16);
const cand = [];
for (const m of top) {
const codes = extractCodes(m.snippet || "", m.filename || "");
        for (const c of codes) cand.push({ code: c, doc_id: m.doc_id, filename: m.filename, chunk_index: m.chunk_index, score: m.score });
        for (const c of codes) cand.push({ code: c, ...m });
}
      // distinct by code
const seen = new Set();
const uniq = cand.filter(c => (seen.has(c.code) ? false : (seen.add(c.code), true)))
.sort((a,b)=> b.score - a.score)
                       .slice(0, 4);
                       .slice(0, 5);

if (uniq.length) {
const best = uniq[0];
@@ -1161,16 +1228,14 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
? (qLang === "en"
? `Likely number: **${best.code}**.\nOther candidates: ${extras.map(e => `**${e.code}**`).join(", ")}.`
: `Numéro probable : **${best.code}**.\nAutres possibles : ${extras.map(e => `**${e.code}**`).join(", ")}.`)
          : (qLang === "en"
              ? `Likely number: **${best.code}**.`
              : `Numéro probable : **${best.code}**.`);
          : (qLang === "en" ? `Likely number: **${best.code}**.` : `Numéro probable : **${best.code}**.`);

const citations = [{
doc_id: best.doc_id,
filename: best.filename,
chunk_index: best.chunk_index,
score: best.score,
          snippet: (merged.find(x => x.doc_id===best.doc_id && x.chunk_index===best.chunk_index)?.snippet || "").slice(0, 400)
          snippet: (merged.find(x => x.doc_id===best.doc_id && x.chunk_index===best.chunk_index)?.snippet || "").slice(0, 500)
}];

const contexts = [{
@@ -1180,27 +1245,31 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
}];

await pool.query(
          `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
          `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta)
           VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
[userEmail, originalQuestion, text.length, Date.now() - t0, { mode: "code_lookup", codes: uniq.map(u=>u.code) }]
).catch(()=>{});

return res.json({ ok: true, text, citations, contexts });
}
}

    // -------- Build contexts & prompt --------
    // -------------------------------------------------------------------------
    // 5) Contexte final → blocage par doc (<=3 chunks/doc) & construction prompt
    // -------------------------------------------------------------------------
const byDoc = new Map();
    for (const m of merged.slice(0, 24)) {
    for (const m of merged.slice(0, 30)) {
const entry = byDoc.get(m.doc_id) || { doc_id: m.doc_id, filename: m.filename, chunks: [] };
      entry.chunks.push({ chunk_index: m.chunk_index, snippet: (m.snippet || "").slice(0, 1200), score: m.score });
      if (entry.chunks.length < 3) {
        entry.chunks.push({ chunk_index: m.chunk_index, snippet: (m.snippet || "").slice(0, 1400), score: m.score });
      }
byDoc.set(m.doc_id, entry);
}
const contexts = Array.from(byDoc.values()).map(d => ({
...d,
      chunks: d.chunks.sort((a,b)=> a.chunk_index - b.chunk_index).slice(0, 3)
      chunks: d.chunks.sort((a,b)=> a.chunk_index - b.chunk_index)
}));

    // Compose context blocks
const contextBlocks = contexts.map((d, i) => {
const parts = d.chunks.map(c => `#${c.chunk_index}\n${c.snippet}`).join("\n---\n");
return `【${i+1}】 ${d.filename} (doc:${d.doc_id})\n${parts}`;
@@ -1247,21 +1316,21 @@ app.post("/api/ask-veeva/ask", async (req, res) => {
? "Sorry, I can't find this information in the provided context."
: "Désolé, je ne trouve pas cette information dans le contexte fourni.");

    // Citations simplifiées
    const citations = merged.slice(0, 8).map((r) => ({
    const citations = merged.slice(0, 10).map((r) => ({
doc_id: r.doc_id,
filename: r.filename,
chunk_index: r.chunk_index,
score: Number(r.score),
      snippet: (r.snippet || "").slice(0, 400),
      snippet: (r.snippet || "").slice(0, 500),
}));

await pool.query(
`INSERT INTO askv_events(user_email,type,question,meta) VALUES ($1,'ask_issued',$2,$3)`,
[userEmail, originalQuestion, { preferGlobal: thread.preferGlobal, preferSOP: thread.preferSOP, lang: qLang }]
).catch(()=>{});
await pool.query(
      `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta) VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
      `INSERT INTO askv_events(user_email,type,question,answer_len,latency_ms,meta)
       VALUES ($1,'ask_answered',$2,$3,$4,$5)`,
[userEmail, originalQuestion, text.length, Date.now() - t0, { citations: citations.length }]
).catch(()=>{});
