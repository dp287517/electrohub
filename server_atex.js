// ==============================
// server_atex.js — ATEX CMMS microservice (ESM)
// Port par défaut: 3001
// ==============================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import StreamZip from "node-stream-zip";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// --- OpenAI (extraction & conformité)
const { OpenAI } = await import("openai");

// ------------------------------
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.ATEX_PORT || 3001);
const HOST = process.env.ATEX_HOST || "0.0.0.0";

const DATA_DIR = process.env.ATEX_DATA_DIR || path.resolve(__dirname, "./_data_atex");
const FILES_DIR = path.join(DATA_DIR, "files");
const MAPS_INCOMING_DIR = path.join(DATA_DIR, "maps_incoming");
const MAPS_DIR = path.join(DATA_DIR, "maps");

// ----------------------------------------------------------------------------------
// FS bootstrap
// ----------------------------------------------------------------------------------
for (const d of [DATA_DIR, FILES_DIR, MAPS_DIR, MAPS_INCOMING_DIR]) {
  await fsp.mkdir(d, { recursive: true });
  if (!fs.existsSync(d)) {
    console.error("[boot][fs] unable to create dir", { dir: d });
    process.exit(2);
  }
}
console.log("[boot] data directories ready", { DATA_DIR, FILES_DIR, MAPS_DIR, MAPS_INCOMING_DIR });

// ----------------------------------------------------------------------------------
// App / Middlewares
// ----------------------------------------------------------------------------------
const app = express();

// --- request id + timing
app.use((req, res, next) => {
  const rid = (Math.random().toString(36).slice(2, 10) + Date.now().toString(36)).toUpperCase();
  const t0 = process.hrtime.bigint();
  req._rid = rid;

  res.on("finish", () => {
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    const len = Number(res.getHeader("content-length") || 0);
    console.log(`[http][${rid}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${len}B ${ms.toFixed(1)}ms`);
  });
  next();
});

// --- compact body logs helper (on-demand)
const DEBUG_HTTP_BODY = process.env.DEBUG_HTTP_BODY === "1";

// --- parsers
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- cors/helmet
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-User-Email",
      "X-User-Name",
      "Authorization",
      "X-Site",
      "X-Confirm",
    ],
    exposedHeaders: ["Content-Disposition"],
  })
);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "object-src": ["'self'", "blob:"],
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'", "blob:"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "connect-src": ["*"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// --- basic request logger (headers subset)
app.use((req, _res, next) => {
  const user = getUser(req);
  const info = {
    rid: req._rid,
    ip: req.ip,
    ua: req.headers["user-agent"],
    path: req.originalUrl,
    method: req.method,
    "x-user": user,
  };
  if (DEBUG_HTTP_BODY && (req.method !== "GET")) info.body = sanitizeBody(req.body);
  console.log("[http:req]", info);
  next();
});

function sanitizeBody(obj, limit = 1200) {
  try {
    const s = JSON.stringify(obj);
    return s.length > limit ? s.slice(0, limit) + "…(truncated)" : s;
  } catch { return obj; }
}

function getUser(req) {
  const name = req.header("X-User-Name") || null;
  const email = req.header("X-User-Email") || null;
  return { name, email };
}

// ----------------------------------------------------------------------------------
// Multer Configuration
// ----------------------------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      console.log("[upload] destination", { dir: FILES_DIR });
      if (!fs.existsSync(FILES_DIR)) {
        console.error("[upload] directory does not exist", { dir: FILES_DIR });
        return cb(new Error(`Directory ${FILES_DIR} does not exist`));
      }
      cb(null, FILES_DIR);
    },
    filename: (_req, file, cb) => {
      const filename = `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`;
      console.log("[upload] filename", { original: file.originalname, saved: filename });
      cb(null, filename);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const uploadZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      console.log("[uploadZip] destination", { dir: MAPS_INCOMING_DIR });
      if (!fs.existsSync(MAPS_INCOMING_DIR)) {
        console.error("[uploadZip] directory does not exist", { dir: MAPS_INCOMING_DIR });
        return cb(new Error(`Directory ${MAPS_INCOMING_DIR} does not exist`));
      }
      cb(null, MAPS_INCOMING_DIR);
    },
    filename: (_req, file, cb) => {
      const filename = `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`;
      console.log("[uploadZip] filename", { original: file.originalname, saved: filename });
      cb(null, filename);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
});

// ----------------------------------------------------------------------------------
// PG pool + tiny wrapper to log queries
// ----------------------------------------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.ATEX_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

async function q(sql, params = [], ctx = "sql") {
  const t0 = process.hrtime.bigint();
  const res = await pool.query(sql, params);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`[db][${ctx}]`, { rows: res.rowCount, ms: ms.toFixed(1) });
  return res;
}

// ----------------------------------------------------------------------------------
// Schema
// ----------------------------------------------------------------------------------
async function ensureSchema() {
  await q(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await q(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  await q(`
    CREATE TABLE IF NOT EXISTS atex_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      equipment TEXT DEFAULT '',
      sub_equipment TEXT DEFAULT '',
      type TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      manufacturer_ref TEXT DEFAULT '',
      atex_mark_gas TEXT DEFAULT NULL,
      atex_mark_dust TEXT DEFAULT NULL,
      zoning_gas INTEGER NULL,
      zoning_dust INTEGER NULL,
      comment TEXT DEFAULT '',
      status TEXT DEFAULT 'a_faire',
      installed_at TIMESTAMP NULL,
      next_check_date DATE NULL,
      photo_path TEXT DEFAULT NULL,
      photo_content BYTEA NULL,
      photo_mime TEXT NULL,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `, [], "schema.equipments");
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_eq_next ON atex_equipments(next_check_date);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_eq_status ON atex_equipments(status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_eq_building ON atex_equipments(lower(building));`);
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_eq_zone ON atex_equipments(lower(zone));`);
  await q(`ALTER TABLE atex_equipments ADD COLUMN IF NOT EXISTS photo_mime TEXT;`);

  await q(`
    CREATE TABLE IF NOT EXISTS atex_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'a_faire',
      date TIMESTAMP DEFAULT now(),
      items JSONB DEFAULT '[]'::jsonb,
      result TEXT DEFAULT NULL,
      user_name TEXT DEFAULT '',
      user_email TEXT DEFAULT '',
      files JSONB DEFAULT '[]'::jsonb
    );
  `, [], "schema.checks");
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_checks_eq ON atex_checks(equipment_id);`);

  await q(`
    CREATE TABLE IF NOT EXISTS atex_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_content BYTEA NULL,
      uploaded_at TIMESTAMP DEFAULT now()
    );
  `, [], "schema.files");
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_files_eq ON atex_files(equipment_id);`);

  await q(`
    CREATE TABLE IF NOT EXISTS atex_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL
    );
  `, [], "schema.plans");
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_plans_logical ON atex_plans(logical_name);`);
  await q(`ALTER TABLE atex_plans ADD COLUMN IF NOT EXISTS content BYTEA;`);

  await q(`
    CREATE TABLE IF NOT EXISTS atex_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `, [], "schema.plan_names");

  await q(`
    CREATE TABLE IF NOT EXISTS atex_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      UNIQUE (equipment_id, logical_name, page_index)
    );
  `, [], "schema.positions");
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_positions_lookup ON atex_positions(logical_name, page_index);`);

  await q(`
    CREATE TABLE IF NOT EXISTS atex_subareas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      x1 NUMERIC NULL, y1 NUMERIC NULL,
      x2 NUMERIC NULL, y2 NUMERIC NULL,
      cx NUMERIC NULL, cy NUMERIC NULL, r NUMERIC NULL,
      points JSONB NULL,
      name TEXT DEFAULT '',
      zoning_gas INTEGER NULL,
      zoning_dust INTEGER NULL,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `, [], "schema.subareas");
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_subareas_lookup ON atex_subareas(logical_name, page_index);`);

  await q(`
    CREATE TABLE IF NOT EXISTS atex_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT '36_mois',
      checklist_template JSONB NOT NULL DEFAULT '[
        "Plaque de marquage ATEX lisible et complète ?",
        "Environnement libre de dépôts/obstructions (poussières) ?",
        "Câblage et presse-étoupes adaptés au zonage ?",
        "Étanchéité / boîtier intact (chocs/corrosion) ?",
        "Documentation disponible (certificats/conformité) ?"
      ]'::jsonb
    );
    INSERT INTO atex_settings(id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `, [], "schema.settings");

  // 🔹 Journaux
  await q(`
    CREATE TABLE IF NOT EXISTS atex_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMP DEFAULT now(),
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
  `, [], "schema.events");
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_events_action ON atex_events(action);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_atex_events_time ON atex_events(ts DESC);`);

  console.log("[schema] ensured");
}

// ----------------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------------
function eqStatusFromDue(due) {
  if (!due) return "a_faire";
  const d = new Date(due);
  const now = new Date();
  const diff = (d - now) / (1000 * 3600 * 24);
  if (diff < 0) return "en_retard";
  if (diff <= 90) return "en_cours_30";
  return "a_faire";
}
function addMonths(date, m) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + m);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fileUrlFromPath(p) {
  return `/api/atex/file?path=${encodeURIComponent(p)}`;
}
function isUuid(s = "") {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}
async function logEvent(req, action, details = {}) {
  const u = getUser(req);
  try {
    await q(
      `INSERT INTO atex_events(actor_name, actor_email, action, details) VALUES($1,$2,$3,$4)`,
      [u.name || null, u.email || null, action, JSON.stringify(details || {})],
      "events.insert"
    );
  } catch (e) {
    console.warn("[events] failed to log", action, e.message);
  }
  console.log(`[atex.event][${req._rid}] ${action}`, { by: u.email || u.name || "anon", ...details });
}
function safeResolveInside(baseDir, targetPath) {
  const abs = path.resolve(targetPath);
  const normBase = path.resolve(baseDir) + path.sep;
  if (!abs.startsWith(normBase)) return null;
  return abs;
}

// ----------------------------------------------------------------------------------
// Health + static file proxy (secured within DATA_DIR)
// ----------------------------------------------------------------------------------
app.get("/api/atex/health", async (_req, res) => {
  try {
    const { rows } = await q(`SELECT COUNT(*)::int AS n FROM atex_equipments`, [], "health.count");
    res.json({ ok: true, equipments: rows?.[0]?.n ?? 0, port: PORT });
  } catch (e) {
    console.error("[health] error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/atex/file", async (req, res) => {
  try {
    const p = String(req.query.path || "");
    const abs = safeResolveInside(DATA_DIR, p);
    if (!abs) {
      console.warn("[file] forbidden path escape", { p });
      return res.status(403).json({ ok: false });
    }
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false });
    console.log("[file] serve", { abs });
    res.sendFile(abs);
  } catch (e) {
    console.error("[file] error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// ÉQUIPEMENTS
// ========================================================================
app.get("/api/atex/equipments", async (req, res) => {
  try {
    const qstr = (req.query.q || "").toString().trim().toLowerCase();
    const status = (req.query.status || "").toString().trim(); // a_faire|en_cours_30|en_retard|fait
    const building = (req.query.building || "").toString().trim().toLowerCase();
    const zone = (req.query.zone || "").toString().trim().toLowerCase();
    const compliance = (req.query.compliance || "").toString().trim(); // conforme|non_conforme|na

    const { rows } = await q(`
      SELECT e.*,
             lc.result AS last_check_result,
             lc.date   AS last_check_date
      FROM atex_equipments e
      LEFT JOIN LATERAL (
        SELECT c.result, c.date
        FROM atex_checks c
        WHERE c.equipment_id = e.id
        ORDER BY c.date DESC
        LIMIT 1
      ) lc ON TRUE
      ORDER BY e.created_at DESC
    `, [], "equipments.list");

    const items = rows
      .map((r) => {
        const compliance_state =
          r.last_check_result === "conforme" ? "conforme" :
          r.last_check_result === "non_conforme" ? "non_conforme" : "na";
        return {
          ...r,
          compliance_state,
          status: eqStatusFromDue(r.next_check_date),
          photo_url:
            (r.photo_content && r.photo_content.length) || r.photo_path
              ? `/api/atex/equipments/${r.id}/photo`
              : null,
        };
      })
      .filter((r) => {
        if (qstr) {
          const hay = [
            r.name, r.building, r.zone, r.equipment, r.sub_equipment, r.type,
            r.manufacturer, r.manufacturer_ref, r.atex_mark_gas, r.atex_mark_dust
          ].filter(Boolean).join(" ").toLowerCase();
          if (!hay.includes(qstr)) return false;
        }
        if (building && !(r.building || "").toLowerCase().includes(building)) return false;
        if (zone && !(r.zone || "").toLowerCase().includes(zone)) return false;
        if (status && r.status !== status) return false;
        if (compliance && r.compliance_state !== compliance) return false;
        return true;
      });

    console.log("[equipments] list", { n: items.length });
    res.json({ items });
  } catch (e) {
    console.error("[equipments] list error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await q(`SELECT * FROM atex_equipments WHERE id=$1`, [id], "equipments.get");
    const eq = rows?.[0] || null;
    if (!eq) return res.status(404).json({ ok: false, error: "not found" });
    eq.photo_url =
      (eq.photo_content && eq.photo_content.length) || eq.photo_path
        ? `/api/atex/equipments/${id}/photo`
        : null;
    res.json({ equipment: eq });
  } catch (e) {
    console.error("[equipments] get error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/atex/equipments", async (req, res) => {
  try {
    const {
      name = "",
      building = "",
      zone = "",
      equipment = "",
      sub_equipment = "",
      type = "",
      manufacturer = "",
      manufacturer_ref = "",
      atex_mark_gas = null,
      atex_mark_dust = null,
      comment = "",
      installed_at = null,
    } = req.body || {};
    console.log("[equipments] create", { name, building, zone });

    const installDate = installed_at ? new Date(installed_at) : new Date();
    const firstDue = addDays(installDate, 90);

    const { rows } = await q(
      `
      INSERT INTO atex_equipments 
        (name, building, zone, equipment, sub_equipment, type,
         manufacturer, manufacturer_ref, atex_mark_gas, atex_mark_dust,
         comment, installed_at, next_check_date, zoning_gas, zoning_dust)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL)
      RETURNING *
      `,
      [
        name || "Équipement ATEX",
        building,
        zone,
        equipment,
        sub_equipment,
        type,
        manufacturer,
        manufacturer_ref,
        atex_mark_gas || null,
        atex_mark_dust || null,
        comment,
        installDate,
        firstDue,
      ],
      "equipments.create"
    );
    const eq = rows[0];
    eq.photo_url = null;
    await logEvent(req, "equipment.create", { id: eq.id, name: eq.name });
    res.json({ equipment: eq });
  } catch (e) {
    console.error("[equipments] create error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const fields = [
      "name","building","zone","equipment","sub_equipment","type",
      "manufacturer","manufacturer_ref","atex_mark_gas","atex_mark_dust",
      "comment","installed_at","next_check_date","status",
      "zoning_gas","zoning_dust"
    ];
    const set = [];
    const values = [];
    let i = 1;
    for (const k of fields) {
      if (k in req.body) {
        set.push(`${k}=$${i++}`);
        values.push(req.body[k]);
      }
    }
    if (!set.length) return res.json({ ok: true });
    values.push(id);
    await q(`UPDATE atex_equipments SET ${set.join(", ")}, updated_at=now() WHERE id=$${i}`, values, "equipments.update");
    const { rows } = await q(`SELECT * FROM atex_equipments WHERE id=$1`, [id], "equipments.reload");
    const eq = rows?.[0] || null;
    if (eq) {
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
    }
    await logEvent(req, "equipment.update", { id });
    res.json({ equipment: eq });
  } catch (e) {
    console.error("[equipments] update error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    await q(`DELETE FROM atex_equipments WHERE id=$1`, [id], "equipments.delete");
    await logEvent(req, "equipment.delete", { id });
    res.json({ ok: true });
  } catch (e) {
    console.error("[equipments] delete error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Photos / Files
app.post("/api/atex/equipments/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const file = req.file;
    if (!file) return res.status(400).json({ ok:false, error:"no file" });

    let buf = null;
    try { buf = await fsp.readFile(file.path); } catch {}

    await q(
      `UPDATE atex_equipments
         SET photo_path=$1,
             photo_content=COALESCE($2, photo_content),
             photo_mime=$3,
             updated_at=now()
       WHERE id=$4`,
      [file.path, buf, file.mimetype || null, id],
      "equipments.photo.upd"
    );
    await logEvent(req, "equipment.photo.upload", { id, size: file.size, mime: file.mimetype });
    res.json({ ok:true, url:`/api/atex/equipments/${id}/photo` });
  } catch (e) { 
    console.error("[equipments] photo error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

app.get("/api/atex/equipments/:id/photo", async (req,res)=>{ 
  try {
    const id = String(req.params.id);
    const { rows } = await q(
      `SELECT photo_path, photo_content, photo_mime FROM atex_equipments WHERE id=$1`,
      [id],
      "equipments.photo.get"
    );
    const row = rows?.[0] || null; 
    if(!row) return res.status(404).end();

    if (row.photo_content && row.photo_content.length) {
      res.type(row.photo_mime || "image/jpeg");
      return res.end(row.photo_content, "binary");
    }
    const p = row.photo_path || null; 
    if(!p) return res.status(404).end();
    if (!fs.existsSync(p)) return res.status(404).end();
    if (row.photo_mime) res.type(row.photo_mime);
    return res.sendFile(path.resolve(p));
  } catch (e) { 
    console.error("[equipments] photo get error", e);
    res.status(404).end(); 
  }
});

app.get("/api/atex/equipments/:id/files", async (req,res)=>{ 
  try {
    const id = String(req.params.id);
    const { rows } = await q(
      `SELECT * FROM atex_files WHERE equipment_id=$1 ORDER BY uploaded_at DESC`,
      [id],
      "files.byEq"
    );
    const files = rows.map((r)=>({
      id:r.id,
      original_name:r.original_name,
      mime:r.mime,
      download_url:`/api/atex/files/${r.id}/download`,
      inline_url:`/api/atex/files/${r.id}/download`,
    }));
    res.json({ files });
  } catch(e){ 
    console.error("[files] list error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

app.post("/api/atex/equipments/:id/files", upload.array("files"), async (req,res)=>{ 
  try {
    const id = String(req.params.id);
    for (const f of (req.files||[])) {
      let buf = null;
      try { buf = await fsp.readFile(f.path); } catch {}
      await q(
        `INSERT INTO atex_files (equipment_id, original_name, mime, file_path, file_content)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, f.originalname, f.mimetype, f.path, buf],
        "files.create"
      );
      console.log("[files] stored", { id, original: f.originalname, size: f.size, mime: f.mimetype });
    }
    await logEvent(req, "files.upload", { equipment_id: id, count: (req.files||[]).length });
    res.json({ ok:true });
  } catch(e){ 
    console.error("[files] upload error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

app.get("/api/atex/files/:fileId/download", async (req, res) => {
  try {
    const id = String(req.params.fileId);
    const { rows } = await q(
      `SELECT original_name, mime, file_path, file_content FROM atex_files WHERE id=$1`,
      [id],
      "files.get"
    );
    const r = rows?.[0];
    if (!r) return res.status(404).end();

    const filename = r.original_name || "file";
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    if (r.file_content && r.file_content.length) {
      if (r.mime) res.type(r.mime);
      return res.end(r.file_content, "binary");
    }
    if (r.file_path && fs.existsSync(r.file_path)) {
      if (r.mime) res.type(r.mime);
      return res.sendFile(path.resolve(r.file_path));
    }
    return res.status(404).end();
  } catch (e) { 
    console.error("[files] download error", e);
    res.status(500).json({ ok:false }); 
  }
});

app.delete("/api/atex/files/:fileId", async (req,res)=>{ 
  try {
    const id = String(req.params.fileId);
    const { rows } = await q(`DELETE FROM atex_files WHERE id=$1 RETURNING file_path`, [id], "files.delete");
    const fp = rows?.[0]?.file_path; 
    if (fp && fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch {}
    }
    await logEvent(req, "file.delete", { id });
    res.json({ ok:true });
  } catch(e){ 
    console.error("[files] delete error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// ========================================================================
// Settings / Checks / Calendar
// ========================================================================
app.get("/api/atex/settings", async (_req, res) => {
  try { 
    const { rows } = await q(`SELECT * FROM atex_settings WHERE id=1`, [], "settings.get"); 
    res.json(rows?.[0] || {}); 
  }
  catch(e){ 
    console.error("[settings] get error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});
app.put("/api/atex/settings", async (req, res) => {
  try {
    const { frequency, checklist_template } = req.body || {};
    await q(
      `UPDATE atex_settings SET frequency=COALESCE($1, frequency), checklist_template=COALESCE($2, checklist_template) WHERE id=1`,
      [frequency || null, Array.isArray(checklist_template) ? JSON.stringify(checklist_template) : null],
      "settings.update"
    );
    const { rows } = await q(`SELECT * FROM atex_settings WHERE id=1`, [], "settings.reload");
    await logEvent(req, "settings.update", { frequency: rows?.[0]?.frequency });
    res.json(rows?.[0] || {});
  } catch (e) { 
    console.error("[settings] update error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

app.post("/api/atex/equipments/:id/checks", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows } = await q(
      `INSERT INTO atex_checks(equipment_id, status, user_name, user_email) VALUES($1,'a_faire',$2,$3) RETURNING *`,
      [id, u.name || "", u.email || ""],
      "checks.create"
    );
    await logEvent(req, "check.create", { equipment_id: id, check_id: rows[0].id });
    res.json({ check: rows[0] });
  } catch (e) { 
    console.error("[checks] create error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

app.put("/api/atex/equipments/:id/checks/:checkId", upload.array("files"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const checkId = String(req.params.checkId);
    let items = [], close = false;
    if (req.is("multipart/form-data")) {
      items = JSON.parse(req.body.items || "[]");
      close = String(req.body.close || "false") === "true";
    } else {
      items = req.body.items || [];
      close = !!req.body.close;
    }

    const filesArr = (req.files || []).map(f => ({
      name: f.originalname,
      mime: f.mimetype,
      path: f.path,
      url: fileUrlFromPath(f.path),
      size: f.size,
    }));

    await q(
      `UPDATE atex_checks SET items=$1, files=$2 WHERE id=$3`,
      [JSON.stringify(items), JSON.stringify(filesArr), checkId],
      "checks.update"
    );

    if (close) {
      const values2 = await q(`SELECT items FROM atex_checks WHERE id=$1`, [checkId], "checks.items.get");
      const its = values2?.rows?.[0]?.items || [];
      const vals = (its || []).map((i) => i?.value).filter(Boolean);
      const result = vals.includes("non_conforme") ? "non_conforme" : "conforme";

      await q(
        `UPDATE atex_checks SET result=$1, status=$2, updated_at=now() WHERE id=$3`,
        [result, result === "conforme" ? "fait" : "non_conforme", checkId],
        "checks.close"
      );

      await q(
        `UPDATE atex_equipments SET status=$1, updated_at=now() WHERE id=$2`,
        [result === "conforme" ? "fait" : "en_retard", id],
        "equipments.status.fromCheck"
      );

      await logEvent(req, "check.close", { equipment_id: id, check_id: checkId, result });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[checks] update error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// MAPS — planFile (fichier PDF, par logical_name ou id, BLOB prioritaire)
// ========================================================================
app.get("/api/atex/maps/planFile", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString();
    const id = (req.query.id || "").toString();

    console.log("[maps] planFile request", { logical, id });

    // 1) par id (UUID dans atex_plans.id)
    if (id && isUuid(id)) {
      const { rows } = await q(
        `SELECT file_path, content FROM atex_plans WHERE id=$1 ORDER BY version DESC LIMIT 1`,
        [id],
        "maps.plan.byId"
      );
      const row = rows?.[0] || null;
      if (row?.content?.length) {
        res.type("application/pdf");
        return res.end(row.content, "binary");
      }
      const fp = row?.file_path;
      if (fp && fs.existsSync(fp)) return res.type("application/pdf").sendFile(path.resolve(fp));
      return res.status(404).send("not_found");
    }

    if (!logical) return res.status(400).json({ ok: false, error: "logical_name required" });

    // 2) lookup exact puis caseless
    let rows = (
      await q(
        `SELECT file_path, content FROM atex_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
        [logical],
        "maps.plan.byName"
      )
    ).rows;
    if (!rows?.length) {
      rows = (
        await q(
          `SELECT file_path, content FROM atex_plans WHERE lower(logical_name)=lower($1) ORDER BY version DESC LIMIT 1`,
          [logical],
          "maps.plan.byNameCI"
        )
      ).rows;
    }

    // 3) servir BLOB ou fallback FS
    let row = rows?.[0] || null;
    if (row?.content?.length) {
      res.type("application/pdf");
      return res.end(row.content, "binary");
    }
    let fp = row?.file_path || null;
    if (!fp) {
      const norm = logical.toLowerCase();
      const files = await fsp.readdir(MAPS_DIR);
      const candidate = files.find((f) =>
        f.toLowerCase().startsWith(`${norm}__`) && f.toLowerCase().endsWith(".pdf")
      );
      if (candidate) fp = path.join(MAPS_DIR, candidate);
    }

    if (!fp || !fs.existsSync(fp)) return res.status(404).send("not_found");
    res.type("application/pdf").sendFile(path.resolve(fp));
  } catch (e) {
    console.error("[maps] planFile error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- ALIAS compat
app.get("/api/atex/maps/plan/:logical/file", async (req, res) => {
  req.query.logical_name = req.params.logical;
  req.url = "/api/atex/maps/planFile" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  return app._router.handle(req, res);
});
app.get("/api/atex/maps/plan-id/:id/file", async (req, res) => {
  req.query.id = req.params.id;
  req.url = "/api/atex/maps/planFile" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  return app._router.handle(req, res);
});
app.get("/api/doors/maps/plan/:logical/file", async (req, res) => {
  req.query.logical_name = req.params.logical;
  req.url = "/api/atex/maps/planFile" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  return app._router.handle(req, res);
});
app.get("/api/doors/maps/plan-id/:id/file", async (req, res) => {
  req.query.id = req.params.id;
  req.url = "/api/atex/maps/planFile" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  return app._router.handle(req, res);
});

// ========================================================================
// MAPS — Backfill BLOB content (maintenance)
// ========================================================================
app.post("/api/atex/maps/backfillContent", async (_req, res) => {
  try {
    const { rows } = await q(
      `SELECT id, file_path FROM atex_plans WHERE content IS NULL AND file_path IS NOT NULL`,
      [],
      "maps.backfill.scan"
    );
    let updated = 0, missing_files = 0, errors = 0;
    for (const r of rows) {
      try {
        if (!r.file_path || !fs.existsSync(r.file_path)) { missing_files++; continue; }
        const buf = await fsp.readFile(r.file_path);
        await q(`UPDATE atex_plans SET content=$1 WHERE id=$2`, [buf, r.id], "maps.backfill.update");
        updated++;
      } catch (e) {
        console.warn("[maps] backfill error", e.message);
        errors++;
      }
    }
    console.log("[maps] backfill done", { updated, missing_files, errors });
    res.json({ ok: true, updated, missing_files, errors });
  } catch (e) {
    console.error("[maps] backfill fatal", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// MAPS — Upload zip (nouveau) -> ingère PDF(s) dans atex_plans
//   - ZIP attendu: fichiers PDF nommés: <logical_name>__v<version>.pdf  (ex: siteA__v3.pdf)
//   - si version absente, on calcule next version pour ce logical_name
// ========================================================================
app.post("/api/atex/maps/uploadZip", uploadZip.single("zip"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok:false, error:"no file=zip" });
    console.log("[maps] uploadZip received", { path: file.path, size: file.size });

    const zip = new StreamZip.async({ file: file.path });
    const entries = await zip.entries();
    let imported = 0, skipped = 0, errors = 0;

    for (const name of Object.keys(entries)) {
      const ent = entries[name];
      if (ent.isDirectory) { skipped++; continue; }
      if (!name.toLowerCase().endsWith(".pdf")) { skipped++; continue; }

      // parse logical + version
      const base = path.basename(name);
      let logical = base.replace(/\.pdf$/i, "");
      let version = null;
      const m = logical.match(/^(.*)__v(\d+)$/i);
      if (m) { logical = m[1]; version = Number(m[2]); }

      const safeLogical = logical.replace(/[^\w\-]+/g, "_").toLowerCase();
      const target = path.join(MAPS_DIR, `${safeLogical}__v${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);

      try {
        const data = await zip.entryData(name);
        await fsp.writeFile(target, data);
        console.log("[maps] extracted", { base, logical: safeLogical, target });

        if (version == null) {
          const { rows } = await q(
            `SELECT COALESCE(MAX(version),0)::int AS v FROM atex_plans WHERE lower(logical_name)=lower($1)`,
            [safeLogical],
            "maps.uploadZip.maxv"
          );
        version = (rows?.[0]?.v || 0) + 1;
        }

        await q(
          `INSERT INTO atex_plans(logical_name, version, filename, file_path, content)
           VALUES($1,$2,$3,$4,$5)`,
          [safeLogical, version, base, target, await fsp.readFile(target)],
          "maps.uploadZip.insert"
        );
        imported++;
      } catch (e) {
        console.error("[maps] import error", { name, error: e.message });
        errors++;
      }
    }
    await zip.close();
    await logEvent(req, "maps.uploadZip", { imported, skipped, errors, file: file.filename });
    res.json({ ok:true, imported, skipped, errors });
  } catch (e) {
    console.error("[maps] uploadZip fatal", e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ========================================================================
// MAPS — Positions + affectation des zones
// ========================================================================
function pointInRect(px, py, x1, y1, x2, y2) {
  const minx = Math.min(Number(x1), Number(x2));
  const maxx = Math.max(Number(x1), Number(x2));
  const miny = Math.min(Number(y1), Number(y2));
  const maxy = Math.max(Number(y1), Number(y2));
  return px >= minx && px <= maxx && py >= miny && py <= maxy;
}
function pointInCircle(px, py, cx, cy, r) {
  const dx = px - Number(cx), dy = py - Number(cy);
  return dx*dx + dy*dy <= Number(r)*Number(r);
}
function pointInPoly(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = Number(points[i][0]), yi = Number(points[i][1]);
    const xj = Number(points[j][0]), yj = Number(points[j][1]);
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
async function detectZonesForPoint(logical_name, page_index, x_frac, y_frac) {
  console.log("[zones] detect", { logical_name, page_index, x_frac, y_frac });
  const { rows } = await q(
    `SELECT id, kind, x1,y1,x2,y2,cx,cy,r,points,zoning_gas,zoning_dust
     FROM atex_subareas WHERE logical_name=$1 AND page_index=$2
     ORDER BY created_at ASC`,
    [logical_name, page_index],
    "zones.query"
  );
  for (const z of rows) {
    if (z.kind === "rect" && pointInRect(x_frac, y_frac, z.x1, z.y1, z.x2, z.y2)) {
      console.log("[zones] match rect", { id: z.id, gas: z.zoning_gas, dust: z.zoning_dust });
      return { zoning_gas: z.zoning_gas, zoning_dust: z.zoning_dust, subarea_id: z.id };
    }
    if (z.kind === "circle" && pointInCircle(x_frac, y_frac, z.cx, z.cy, z.r)) {
      console.log("[zones] match circle", { id: z.id, gas: z.zoning_gas, dust: z.zoning_dust });
      return { zoning_gas: z.zoning_gas, zoning_dust: z.zoning_dust, subarea_id: z.id };
    }
    if (z.kind === "poly" && Array.isArray(z.points)) {
      const pts = z.points;
      if (pts?.length && pointInPoly(x_frac, y_frac, pts)) {
        console.log("[zones] match poly", { id: z.id, gas: z.zoning_gas, dust: z.zoning_dust });
        return { zoning_gas: z.zoning_gas, zoning_dust: z.zoning_dust, subarea_id: z.id };
      }
    }
  }
  console.log("[zones] no match");
  return { zoning_gas: null, zoning_dust: null, subarea_id: null };
}

// route “canonique” initiale (PUT)
app.put("/api/atex/maps/setPosition", async (req, res) => {
  try {
    const { equipment_id, logical_name, plan_id = null, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null)
      return res.status(400).json({ ok: false, error: "missing params" });

    console.log("[positions] setPosition", { equipment_id, logical_name, page_index, x_frac, y_frac });

    await q(
      `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (equipment_id, logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac`,
      [equipment_id, logical_name, isUuid(plan_id) ? plan_id : null, page_index, x_frac, y_frac],
      "positions.upsert"
    );

    const zones = await detectZonesForPoint(logical_name, page_index, Number(x_frac), Number(y_frac));
    await q(
      `UPDATE atex_equipments SET zoning_gas=$1, zoning_dust=$2, updated_at=now() WHERE id=$3`,
      [zones.zoning_gas, zones.zoning_dust, equipment_id],
      "equipments.zones.sync"
    );

    await logEvent(req, "position.set", { equipment_id, logical_name, page_index, x_frac, y_frac, zones });
    res.json({ ok: true, zones });
  } catch (e) { 
    console.error("[positions] setPosition error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// alias pour compat front : POST /api/atex/maps/setPosition
app.post("/api/atex/maps/setPosition", async (req, res) => {
  req.method = "PUT";
  return app._router.handle(req, res);
});

// alias pour compat lib: PUT /api/atex/maps/positions/:equipmentId
app.put("/api/atex/maps/positions/:equipmentId", async (req, res) => {
  try {
    const equipment_id = String(req.params.equipmentId);
    const { logical_name, plan_id = null, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null)
      return res.status(400).json({ ok: false, error: "missing params" });

    console.log("[positions] upsert (alt)", { equipment_id, logical_name, page_index, x_frac, y_frac });

    await q(
      `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (equipment_id, logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac`,
      [equipment_id, logical_name, isUuid(plan_id) ? plan_id : null, page_index, x_frac, y_frac],
      "positions.upsert.alt"
    );

    const zones = await detectZonesForPoint(logical_name, page_index, Number(x_frac), Number(y_frac));
    await q(
      `UPDATE atex_equipments SET zoning_gas=$1, zoning_dust=$2, updated_at=now() WHERE id=$3`,
      [zones.zoning_gas, zones.zoning_dust, equipment_id],
      "equipments.zones.sync.alt"
    );

    await logEvent(req, "position.set", { equipment_id, logical_name, page_index, x_frac, y_frac, zones });
    res.json({ ok: true, zones });
  } catch (e) { 
    console.error("[positions] alt error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// ✅ alias pratique pour le front: positionsAuto (retour identique à /positions)
app.get("/api/atex/maps/positionsAuto", (req, res) => {
  req.url = "/api/atex/maps/positions" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  return app._router.handle(req, res);
});

// Recalculer les zonages de tous les équipements d’un plan/page
app.post("/api/atex/maps/reindexZones", async (req, res) => {
  try {
    const { logical_name, page_index = 0 } = req.body || {};
    if (!logical_name) return res.status(400).json({ ok:false, error:"logical_name required" });

    const { rows: pos } = await q(
      `SELECT equipment_id, x_frac, y_frac FROM atex_positions WHERE logical_name=$1 AND page_index=$2`,
      [logical_name, Number(page_index)],
      "positions.list.forReindex"
    );
    let updated = 0;
    for (const p of pos) {
      const z = await detectZonesForPoint(logical_name, Number(page_index), Number(p.x_frac), Number(p.y_frac));
      await q(
        `UPDATE atex_equipments SET zoning_gas=$1, zoning_dust=$2, updated_at=now() WHERE id=$3`,
        [z.zoning_gas, z.zoning_dust, p.equipment_id],
        "equipments.zones.apply"
      );
      updated++;
    }
    await logEvent(req, "zones.reindex", { logical_name, page_index, updated });
    res.json({ ok:true, updated });
  } catch (e) { 
    console.error("[zones] reindex error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// ========================================================================
// MAPS — Positions (lecture)
// ========================================================================
app.get("/api/atex/maps/positions", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.status(400).json({ ok: false, error: "logical_name required" });

    const { rows } = await q(
      `
      SELECT p.equipment_id, p.x_frac, p.y_frac,
             e.name, e.building, e.zone, e.status, e.zoning_gas, e.zoning_dust
      FROM atex_positions p
      JOIN atex_equipments e ON e.id=p.equipment_id
      WHERE p.logical_name=$1 AND p.page_index=$2
      `,
      [logical, pageIndex],
      "positions.list"
    );
    const items = rows.map((r) => ({
      equipment_id: r.equipment_id,
      name: r.name,
      x_frac: Number(r.x_frac),
      y_frac: Number(r.y_frac),
      status: r.status,
      building: r.building,
      zone: r.zone,
      zoning_gas: r.zoning_gas,
      zoning_dust: r.zoning_dust,
    }));
    console.log("[positions] list", { logical, pageIndex, n: items.length });
    res.json({ items });
  } catch (e) { 
    console.error("[positions] list error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// ========================================================================
// MAPS — Subareas (dessin) + améliorations (edit geometry / stats / purge)
// ========================================================================
app.get("/api/atex/maps/subareas", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);
    const { rows } = await q(
      `SELECT * FROM atex_subareas WHERE logical_name=$1 AND page_index=$2 ORDER BY created_at ASC`,
      [logical, pageIndex],
      "subareas.list"
    );
    res.json({ items: rows || [] });
  } catch (e) { 
    console.error("[subareas] list error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// stats: savoir s’il y a des zones et combien
app.get("/api/atex/maps/subareas/stats", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name required" });
    const { rows } = await q(
      `SELECT COUNT(*)::int AS n FROM atex_subareas WHERE logical_name=$1 AND page_index=$2`,
      [logical, pageIndex],
      "subareas.stats"
    );
    res.json({ ok:true, count: rows?.[0]?.n ?? 0 });
  } catch (e) { 
    console.error("[subareas] stats error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

app.post("/api/atex/maps/subareas", async (req, res) => {
  try {
    const {
      kind,
      x1 = null, y1 = null, x2 = null, y2 = null,
      cx = null, cy = null, r = null,
      points = null,
      name = "",
      zoning_gas = null, zoning_dust = null,
      logical_name, plan_id = null, page_index = 0,
    } = req.body || {};

    if (!logical_name || !kind) return res.status(400).json({ ok: false, error: "missing params" });
    if (!["rect","circle","poly"].includes(kind)) return res.status(400).json({ ok:false, error:"invalid kind" });

    const planIdSafe = isUuid(plan_id) ? plan_id : null;

    const { rows } = await q(
      `INSERT INTO atex_subareas
        (logical_name, plan_id, page_index, kind, x1,y1,x2,y2,cx,cy,r,points,name,zoning_gas,zoning_dust)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        logical_name, planIdSafe, page_index, kind,
        x1, y1, x2, y2, cx, cy, r,
        points ? JSON.stringify(points) : null,
        name, zoning_gas, zoning_dust,
      ],
      "subareas.create"
    );
    const created = rows[0];
    await q(`UPDATE atex_subareas SET updated_at=now() WHERE id=$1`, [created.id], "subareas.touch");
    await logEvent(req, "subarea.create", { id: created.id, logical_name, page_index, kind, name, zoning_gas, zoning_dust });
    res.json({ ok:true, subarea: created, created: true });
  } catch (e) { 
    console.error("[subareas] create error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// éditer meta (nom, zonage) + (compat) géométrie si fournie
app.put("/api/atex/maps/subareas/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body || {};
    const set = [];
    const vals = [];
    let i = 1;

    if (body.name !== undefined) { set.push(`name=$${i++}`); vals.push(body.name); }
    if (body.zoning_gas !== undefined) { set.push(`zoning_gas=$${i++}`); vals.push(body.zoning_gas); }
    if (body.zoning_dust !== undefined) { set.push(`zoning_dust=$${i++}`); vals.push(body.zoning_dust); }

    if (body.kind) {
      if (!["rect","circle","poly"].includes(body.kind)) return res.status(400).json({ ok:false, error:"invalid kind" });
      set.push(`kind=$${i++}`); vals.push(body.kind);
    }
    const geoKeys = ["x1","y1","x2","y2","cx","cy","r"];
    for (const k of geoKeys) {
      if (body[k] !== undefined) { set.push(`${k}=$${i++}`); vals.push(body[k]); }
    }
    if (body.points !== undefined) {
      set.push(`points=$${i++}`); vals.push(body.points ? JSON.stringify(body.points) : null);
    }

    if (!set.length) return res.json({ ok: true });

    set.push(`updated_at=now()`);
    vals.push(id);

    await q(`UPDATE atex_subareas SET ${set.join(", ")} WHERE id=$${i}`, vals, "subareas.update");
    await logEvent(req, "subarea.update", {
      id,
      hasGeometry: !!(body.kind || body.points || geoKeys.some(k => body[k] !== undefined)),
    });
    res.json({ ok: true });
  } catch (e) { 
    console.error("[subareas] update error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// géométrie dédiée
app.put("/api/atex/maps/subareas/:id/geometry", async (req, res) => {
  try {
    const id = String(req.params.id);
    const {
      kind = null,
      x1 = null, y1 = null, x2 = null, y2 = null,
      cx = null, cy = null, r = null,
      points = null,
    } = req.body || {};

    if (kind && !["rect","circle","poly"].includes(kind))
      return res.status(400).json({ ok:false, error:"invalid kind" });

    const set = [];
    const vals = [];
    let i = 1;

    if (kind) { set.push(`kind=$${i++}`); vals.push(kind); }
    for (const [k, v] of Object.entries({ x1,y1,x2,y2,cx,cy,r })) {
      if (v !== undefined) { set.push(`${k}=$${i++}`); vals.push(v); }
    }
    if (points !== undefined) {
      set.push(`points=$${i++}`); vals.push(points ? JSON.stringify(points) : null);
    }
    set.push(`updated_at=now()`);

    vals.push(id);
    await q(`UPDATE atex_subareas SET ${set.join(", ")} WHERE id=$${i}`, vals, "subareas.update.geometry");
    await logEvent(req, "subarea.update.geometry", { id, kind, hasPoints: Array.isArray(points) ? points.length : null });
    res.json({ ok:true });
  } catch (e) { 
    console.error("[subareas] update geometry error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// supprimer 1 zone
app.delete("/api/atex/maps/subareas/:id", async (req, res) => {
  try { 
    const id = String(req.params.id);
    await q(`DELETE FROM atex_subareas WHERE id=$1`, [id], "subareas.delete");
    await logEvent(req, "subarea.delete", { id });
    res.json({ ok:true });
  } catch (e) { 
    console.error("[subareas] delete error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// purge toutes les zones d’un plan/page (garde-fou)
app.delete("/api/atex/maps/subareas/purge", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name required" });
    if ((req.header("X-Confirm") || "").toLowerCase() !== "purge")
      return res.status(412).json({ ok:false, error:"missing confirmation header X-Confirm: purge" });

    const { rows } = await q(
      `DELETE FROM atex_subareas WHERE logical_name=$1 AND page_index=$2 RETURNING id`,
      [logical, pageIndex],
      "subareas.purge"
    );
    await logEvent(req, "subarea.purge", { logical_name: logical, page_index: pageIndex, deleted: rows.length });
    res.json({ ok:true, deleted: rows.length });
  } catch (e) { 
    console.error("[subareas] purge error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// ========================================================================
// Logs — lecture simple (debug)
// ========================================================================
app.get("/api/atex/logs", async (req, res) => {
  try {
    const action = (req.query.action || "").toString().trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    let rows;
    if (action) {
      ({ rows } = await q(
        `SELECT * FROM atex_events WHERE action=$1 ORDER BY ts DESC LIMIT $2`,
        [action, limit],
        "logs.byAction"
      ));
    } else {
      ({ rows } = await q(`SELECT * FROM atex_events ORDER BY ts DESC LIMIT $1`, [limit], "logs.latest"));
    }
    res.json({ items: rows || [] });
  } catch (e) { 
    console.error("[logs] read error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// ========================================================================
// IA
// ========================================================================
function openaiClient() {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ATEX || process.env.OPENAI_API_KEY_DOORS;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

app.post("/api/atex/extract", upload.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    if (!client) return res.status(501).json({ ok: false, error: "OPENAI_API_KEY missing" });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "no files" });

    const images = await Promise.all(
      files.map(async (f) => ({
        name: f.originalname,
        mime: f.mimetype,
        data: (await fsp.readFile(f.path)).toString("base64"),
        size: f.size,
      }))
    );

    console.log("[ai.extract] images", images.map(i => ({ name: i.name, mime: i.mime, size: i.size })));

    const sys = `Tu es un assistant d'inspection ATEX. Extrait des photos:
- manufacturer
- manufacturer_ref
- atex_mark_gas
- atex_mark_dust
- type
Réponds en JSON strict.`;

    const content = [
      { role: "system", content: sys },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyse ces photos et renvoie uniquement un JSON." },
          ...images.map((im) => ({
            type: "image_url",
            image_url: { url: `data:${im.mime};base64,${im.data}` },
          })),
        ],
      },
    ];

    const resp = await client.chat.completions.create({
      model: process.env.ATEX_OPENAI_MODEL || "gpt-4o-mini",
      messages: content,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
    console.log("[ai.extract] tokens?", { id: resp.id });

    let data = {};
    try { data = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { data = {}; }
    res.json({ ok: true, extracted: {
      manufacturer: String(data.manufacturer || ""),
      manufacturer_ref: String(data.manufacturer_ref || ""),
      atex_mark_gas: String(data.atex_mark_gas || ""),
      atex_mark_dust: String(data.atex_mark_dust || ""),
      type: String(data.type || ""),
    }});
  } catch (e) { 
    console.error("[ai.extract] error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

app.post("/api/atex/assess", async (req, res) => {
  try {
    const client = openaiClient();
    if (!client) return res.status(501).json({ ok: false, error: "OPENAI_API_KEY missing" });

    const { atex_mark_gas = "", atex_mark_dust = "", target_gas = null, target_dust = null } = req.body || {};

    const sys = `Tu es expert ATEX. Retourne {"decision":"conforme|non_conforme|indetermine","rationale":"..."} en JSON strict.`;
    const messages = [
      { role: "system", content: sys },
      { role: "user", content:
        `Marquage gaz: ${atex_mark_gas||"(aucun)"}\nMarquage poussière: ${atex_mark_dust||"(aucun)"}\nZonage cible gaz: ${target_gas}\nZonage cible poussière: ${target_dust}`
      },
    ];

    const resp = await client.chat.completions.create({
      model: process.env.ATEX_OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    console.log("[ai.assess] resp", { id: resp.id });

    let data = {};
    try { data = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { data = {}; }
    res.json({ ok:true, ...data });
  } catch (e) { 
    console.error("[ai.assess] error", e);
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// 🔸 Alias legacy
app.post("/api/atex/analyzePhotoBatch", (req, res) => {
  req.url = "/api/atex/extract";
  return app._router.handle(req, res);
});
app.post("/api/atex/aiAnalyze", (req, res) => {
  req.url = "/api/atex/assess";
  return app._router.handle(req, res);
});

// ----------------------------------------------------------------------------------
// Fatal handlers
// ----------------------------------------------------------------------------------
process.on("unhandledRejection", (err) => {
  console.error("[fatal] unhandledRejection", err);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException", err);
});

// ----------------------------------------------------------------------------------
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[atex] listening on ${HOST}:${PORT}`);
});
