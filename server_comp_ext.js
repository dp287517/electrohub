// server_comp_ext.js
// API "Prestataires externes" — Postgres/Neon + Upload multi-fichiers (multer)
// - Création auto des tables (vendors, visits, files)
// - CRUD, calendar (dates ISO), stats
// - Uploads multiples par vendor + listing + download + delete
//
// ENV :
//   DATABASE_URL ou NEON_DATABASE_URL (sslmode=require sur Neon recommandé)
//   COMP_EXT_PORT=3014
//   CORS_ORIGIN=http://localhost:3000 (ou ton domaine)
//   COMP_EXT_UPLOAD_DIR=./uploads/comp-ext
//
// Lancer : node server_comp_ext.js

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { Pool } from "pg";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import mime from "mime-types";
import { fileURLToPath } from "url";

dotenv.config();

// ---------- DB ----------
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[comp-ext] DATABASE_URL/NEON_DATABASE_URL manquant(e).");
  process.exit(1);
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- Helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_BASE = path.resolve(process.env.COMP_EXT_UPLOAD_DIR || path.join(__dirname, "uploads", "comp-ext"));

const toISODate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);  // YYYY-MM-DD
const toISODateTime = (v) => (v ? new Date(v).toISOString() : null);
const nint = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
function sanitizeFilename(name) {
  return (name || "")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 140);
}
async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }
function isValidISODate(s) {
  if (!s) return false;
  // accept YYYY-MM-DD only
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

// ---------- Schema ----------
async function ensureSchema() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_vendors (
        id               BIGSERIAL PRIMARY KEY,
        name             TEXT NOT NULL,
        offer_status     TEXT NOT NULL DEFAULT 'en_attente' CHECK (offer_status IN ('en_attente','reçue','recue','po_faite')),
        jsa_status       TEXT NOT NULL DEFAULT 'transmis'    CHECK (jsa_status IN ('transmis','receptionne','signe')),
        pp_applicable    BOOLEAN NOT NULL DEFAULT FALSE,
        pp_link          TEXT,
        access_status    TEXT NOT NULL DEFAULT 'a_faire'     CHECK (access_status IN ('a_faire','fait')),
        sap_wo           TEXT,
        owner            TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_visits (
        id         BIGSERIAL PRIMARY KEY,
        vendor_id  BIGINT NOT NULL REFERENCES comp_ext_vendors(id) ON DELETE CASCADE,
        vindex     INT NOT NULL,
        start_date DATE NOT NULL,
        end_date   DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_visits_vendor_id ON comp_ext_visits(vendor_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_visits_dates ON comp_ext_visits(start_date, end_date);`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_files (
        id             BIGSERIAL PRIMARY KEY,
        vendor_id      BIGINT NOT NULL REFERENCES comp_ext_vendors(id) ON DELETE CASCADE,
        category       TEXT,
        original_name  TEXT NOT NULL,
        stored_name    TEXT NOT NULL,
        mime           TEXT,
        size_bytes     BIGINT,
        disk_path      TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_files_vendor ON comp_ext_files(vendor_id);`);

    await c.query("COMMIT");
    console.log("[comp-ext] Schéma OK");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("[comp-ext] ensureSchema error", e);
    throw e;
  } finally {
    c.release();
  }
}

// ---------- App ----------
const app = express();
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Site");
  if (req.method === "OPTIONS") return res.end();
  next();
});

// ---------- Multer ----------
await ensureDir(UPLOAD_BASE);
const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const dir = path.join(UPLOAD_BASE, String(req.params.id || "misc"));
      await ensureDir(dir);
      cb(null, dir);
    } catch (e) { cb(e, UPLOAD_BASE); }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || `.${mime.extension(file.mimetype) || "bin"}`;
    const base = sanitizeFilename(path.basename(file.originalname, path.extname(file.originalname)));
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${base}${ext}`);
  },
});
const upload = multer({ storage });

// ---------- Vendors ----------
app.get("/api/comp-ext/vendors", async (req, res) => {
  const q = (req.query.q || "").trim();
  try {
    const params = [];
    let where = "";
    if (q) { params.push(`%${q.toLowerCase()}%`); where = `WHERE LOWER(name) LIKE $${params.length}`; }

    const rows = (await pool.query(
      `SELECT id, name, offer_status, jsa_status, pp_applicable, pp_link, access_status, sap_wo, owner, created_at, updated_at
       FROM comp_ext_vendors ${where} ORDER BY id DESC`,
      params
    )).rows;

    const ids = rows.map(r => r.id);
    let visitsBy = {}, filesCountBy = {};
    if (ids.length) {
      const vist = (await pool.query(
        `SELECT vendor_id, vindex, start_date, end_date
         FROM comp_ext_visits WHERE vendor_id = ANY($1::bigint[]) ORDER BY vendor_id, vindex`, [ids]
      )).rows;
      visitsBy = vist.reduce((acc, r) => {
        (acc[r.vendor_id] ||= []).push({ index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date) });
        return acc;
      }, {});
      const fct = (await pool.query(
        `SELECT vendor_id, COUNT(*) AS n FROM comp_ext_files WHERE vendor_id = ANY($1::bigint[]) GROUP BY vendor_id`, [ids]
      )).rows;
      filesCountBy = fct.reduce((acc, r) => ((acc[r.vendor_id] = Number(r.n || 0)), acc), {});
    }

    res.json({ items: rows.map(r => ({ ...r, visits: visitsBy[r.id] || [], files_count: filesCountBy[r.id] || 0 })) });
  } catch (e) {
    console.error("[comp-ext] vendors list", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/comp-ext/vendors", async (req, res) => {
  const {
    name = "", offer_status = "en_attente", jsa_status = "transmis",
    pp_applicable = false, pp_link = "", access_status = "a_faire",
    sap_wo = "", visits = [], owner = "",
  } = req.body || {};

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const ins = await c.query(
      `INSERT INTO comp_ext_vendors (name, offer_status, jsa_status, pp_applicable, pp_link, access_status, sap_wo, owner)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, name, offer_status, jsa_status, pp_applicable, pp_link, access_status, sap_wo, owner, created_at, updated_at`,
      [String(name).trim(), offer_status, jsa_status, !!pp_applicable, pp_link || null, access_status, sap_wo || null, owner || null]
    );
    const v = ins.rows[0];

    if (Array.isArray(visits)) {
      for (let i=0;i<visits.length;i++){
        const x = visits[i] || {};
        const s = toISODate(x.start); if (!isValidISODate(s)) continue;
        const e = toISODate(x.end) || s;
        await c.query(`INSERT INTO comp_ext_visits (vendor_id, vindex, start_date, end_date) VALUES ($1,$2,$3,$4)`,
          [v.id, nint(x.index, i+1), s, e]);
      }
    }

    await c.query("COMMIT");
    const vrows = (await pool.query(`SELECT vindex, start_date, end_date FROM comp_ext_visits WHERE vendor_id=$1 ORDER BY vindex`, [v.id])).rows;
    res.status(201).json({
      ...v,
      visits: vrows.map(r => ({ index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date) })),
      files_count: 0,
    });
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("[comp-ext] create vendor", e);
    res.status(500).json({ error: "server_error" });
  } finally { c.release(); }
});

app.put("/api/comp-ext/vendors/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, offer_status, jsa_status, pp_applicable, pp_link, access_status, sap_wo, visits, owner } = req.body || {};

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const ex = await c.query(`SELECT id FROM comp_ext_vendors WHERE id=$1`, [id]);
    if (!ex.rowCount) { await c.query("ROLLBACK"); return res.status(404).json({ error: "not_found" }); }

    const set = [], params = [];
    const push = (col, val) => { params.push(val); set.push(`${col}=$${params.length}`); };
    if (typeof name !== "undefined")          push("name", String(name).trim());
    if (typeof offer_status !== "undefined")  push("offer_status", offer_status);
    if (typeof jsa_status !== "undefined")    push("jsa_status", jsa_status);
    if (typeof pp_applicable !== "undefined") push("pp_applicable", !!pp_applicable);
    if (typeof pp_link !== "undefined")       push("pp_link", pp_link || null);
    if (typeof access_status !== "undefined") push("access_status", access_status);
    if (typeof sap_wo !== "undefined")        push("sap_wo", sap_wo || null);
    if (typeof owner !== "undefined")         push("owner", owner || null);
    push("updated_at", new Date());

    if (set.length) {
      await c.query(`UPDATE comp_ext_vendors SET ${set.join(", ")} WHERE id=$${params.length+1}`, [...params, id]);
    }

    if (Array.isArray(visits)) {
      await c.query(`DELETE FROM comp_ext_visits WHERE vendor_id=$1`, [id]);
      for (let i=0;i<visits.length;i++){
        const x = visits[i] || {};
        const s = toISODate(x.start); if (!isValidISODate(s)) continue;
        const e = toISODate(x.end) || s;
        await c.query(`INSERT INTO comp_ext_visits (vendor_id, vindex, start_date, end_date) VALUES ($1,$2,$3,$4)`,
          [id, nint(x.index, i+1), s, e]);
      }
    }

    await c.query("COMMIT");

    const vrow = (await pool.query(
      `SELECT id, name, offer_status, jsa_status, pp_applicable, pp_link, access_status, sap_wo, owner, created_at, updated_at FROM comp_ext_vendors WHERE id=$1`,
      [id]
    )).rows[0];
    const vrows = (await pool.query(
      `SELECT vindex, start_date, end_date FROM comp_ext_visits WHERE vendor_id=$1 ORDER BY vindex`, [id]
    )).rows;
    const fcount = (await pool.query(`SELECT COUNT(*) AS n FROM comp_ext_files WHERE vendor_id=$1`, [id])).rows[0];

    res.json({
      ...vrow,
      visits: vrows.map(r => ({ index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date) })),
      files_count: Number(fcount.n || 0),
    });
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("[comp-ext] update vendor", e);
    res.status(500).json({ error: "server_error" });
  } finally { c.release(); }
});

app.delete("/api/comp-ext/vendors/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await pool.query(`DELETE FROM comp_ext_vendors WHERE id=$1`, [id]);
    // delete vendor folder
    const dir = path.join(UPLOAD_BASE, String(id));
    if (fs.existsSync(dir)) await fsp.rm(dir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e) {
    console.error("[comp-ext] delete vendor", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Calendar (ISO strings) ----------
app.get("/api/comp-ext/calendar", async (_req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT v.id AS vendor_id, v.name, vi.vindex, vi.start_date, vi.end_date
       FROM comp_ext_visits vi JOIN comp_ext_vendors v ON v.id=vi.vendor_id
       ORDER BY v.id, vi.vindex`
    )).rows;

    const tasks = [];
    const events = [];
    for (const r of rows) {
      const s = toISODate(r.start_date);
      const e = toISODate(r.end_date || r.start_date);
      tasks.push({
        id: `${r.vendor_id}-${r.vindex}`,
        name: `${r.name} • Visite ${r.vindex}`,
        start: s,   // ISO string; FRONT reconvertit en Date
        end: e
      });
      // split per day
      const ds = new Date(s), de = new Date(e);
      for (let d = new Date(ds); d <= de; d.setDate(d.getDate()+1)) {
        events.push({ date: toISODate(d), label: `${r.name} (Visite ${r.vindex})` });
      }
    }
    res.json({ tasks, events });
  } catch (e) {
    console.error("[comp-ext] calendar", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Stats ----------
app.get("/api/comp-ext/stats", async (_req, res) => {
  try {
    const offer = (await pool.query(
      `SELECT
         SUM(CASE WHEN offer_status IN ('reçue','recue') THEN 1 ELSE 0 END) AS recue,
         SUM(CASE WHEN offer_status = 'po_faite' THEN 1 ELSE 0 END)          AS po_faite,
         SUM(CASE WHEN offer_status NOT IN ('reçue','recue','po_faite') THEN 1 ELSE 0 END) AS en_attente
       FROM comp_ext_vendors`
    )).rows[0];

    const jsa = (await pool.query(
      `SELECT
         SUM(CASE WHEN jsa_status = 'receptionne' THEN 1 ELSE 0 END) AS receptionne,
         SUM(CASE WHEN jsa_status = 'signe' THEN 1 ELSE 0 END)       AS signe,
         SUM(CASE WHEN jsa_status NOT IN ('receptionne','signe') THEN 1 ELSE 0 END) AS transmis
       FROM comp_ext_vendors`
    )).rows[0];

    const access = (await pool.query(
      `SELECT
         SUM(CASE WHEN access_status = 'fait' THEN 1 ELSE 0 END) AS fait,
         SUM(CASE WHEN access_status <> 'fait' THEN 1 ELSE 0 END) AS a_faire
       FROM comp_ext_vendors`
    )).rows[0];

    const count = (await pool.query(`SELECT COUNT(*) AS n FROM comp_ext_vendors`)).rows[0];

    res.json({
      counts: {
        offer: { en_attente: Number(offer.en_attente || 0), recue: Number(offer.recue || 0), po_faite: Number(offer.po_faite || 0) },
        jsa:   { transmis: Number(jsa.transmis || 0), receptionne: Number(jsa.receptionne || 0), signe: Number(jsa.signe || 0) },
        access:{ a_faire: Number(access.a_faire || 0), fait: Number(access.fait || 0) },
      },
      total: Number(count.n || 0),
    });
  } catch (e) {
    console.error("[comp-ext] stats", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Files ----------
await ensureDir(UPLOAD_BASE);

app.post("/api/comp-ext/vendors/:id/upload", upload.array("files", 20), async (req, res) => {
  const vendorId = Number(req.params.id);
  const category = String(req.query.category || "general").slice(0, 60);
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "no_files" });

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = [];
    for (const f of files) {
      const ins = await c.query(
        `INSERT INTO comp_ext_files (vendor_id, category, original_name, stored_name, mime, size_bytes, disk_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, vendor_id, category, original_name, stored_name, mime, size_bytes, disk_path, created_at`,
        [vendorId, category, f.originalname, path.basename(f.filename), f.mimetype, Number(f.size || 0), f.path]
      );
      out.push(ins.rows[0]);
    }
    await c.query("COMMIT");
    res.status(201).json({ files: out.map(r => ({ ...r, url: `/api/comp-ext/download?file_id=${r.id}` })) });
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("[comp-ext] upload", e);
    res.status(500).json({ error: "server_error" });
  } finally { c.release(); }
});

app.get("/api/comp-ext/vendors/:id/files", async (req, res) => {
  const vendorId = Number(req.params.id);
  const category = req.query.category ? String(req.query.category) : null;
  try {
    const params = [vendorId];
    let where = `WHERE vendor_id=$1`;
    if (category) { params.push(category); where += ` AND category=$2`; }
    const rows = (await pool.query(
      `SELECT id, vendor_id, category, original_name, stored_name, mime, size_bytes, disk_path, created_at
       FROM comp_ext_files ${where} ORDER BY created_at DESC`, params
    )).rows;
    res.json({ files: rows.map(r => ({ ...r, url: `/api/comp-ext/download?file_id=${r.id}` })) });
  } catch (e) {
    console.error("[comp-ext] list files", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/comp-ext/download", async (req, res) => {
  const id = Number(req.query.file_id);
  if (!id) return res.status(400).json({ error: "missing_file_id" });
  try {
    const row = (await pool.query(`SELECT original_name, mime, disk_path FROM comp_ext_files WHERE id=$1`, [id])).rows[0];
    if (!row) return res.status(404).json({ error: "not_found" });
    if (!fs.existsSync(row.disk_path)) return res.status(410).json({ error: "gone" });
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.original_name)}"`);
    fs.createReadStream(row.disk_path).pipe(res);
  } catch (e) {
    console.error("[comp-ext] download", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/api/comp-ext/files/:file_id", async (req, res) => {
  const id = Number(req.params.file_id);
  try {
    const row = (await pool.query(`DELETE FROM comp_ext_files WHERE id=$1 RETURNING disk_path`, [id])).rows[0];
    if (!row) return res.status(404).json({ error: "not_found" });
    try { if (row.disk_path && fs.existsSync(row.disk_path)) await fsp.unlink(row.disk_path); } catch {}
    res.json({ success: true });
  } catch (e) {
    console.error("[comp-ext] delete file", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Boot ----------
const port = Number(process.env.COMP_EXT_PORT || 3014);
await ensureSchema();
app.listen(port, () => console.log(`[comp-ext] API prête sur :${port} — uploads: ${UPLOAD_BASE}`));
