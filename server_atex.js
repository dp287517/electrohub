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
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.ATEX_PORT || 3001);
const HOST = process.env.ATEX_HOST || "0.0.0.0";
// Dossiers data
const DATA_DIR = process.env.ATEX_DATA_DIR || path.resolve(__dirname, "./_data_atex");
const FILES_DIR = path.join(DATA_DIR, "files");
const MAPS_INCOMING_DIR = path.join(DATA_DIR, "maps_incoming");
const MAPS_DIR = path.join(DATA_DIR, "maps");
for (const d of [DATA_DIR, FILES_DIR, MAPS_DIR, MAPS_INCOMING_DIR]) {
  await fsp.mkdir(d, { recursive: true });
}
// -------------------------------------------------
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
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
        "connect-src": ["*"], // API cross-origin ok
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
function getUser(req) {
  const name = req.header("X-User-Name") || null;
  const email = req.header("X-User-Email") || null;
  return { name, email };
}
// -------------------------------------------------
const multerFiles = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const multerZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_INCOMING_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});
// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.ATEX_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});
// -------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      equipment TEXT DEFAULT '', -- "Équipement (macro)" (nom du plan)
      sub_equipment TEXT DEFAULT '', -- "Sous-Équipement" (nom de la forme)
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
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_eq_next ON atex_equipments(next_check_date);
  `);
  await pool.query(`
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
    CREATE INDEX IF NOT EXISTS idx_atex_checks_eq ON atex_checks(equipment_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_content BYTEA NULL,
      uploaded_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_files_eq ON atex_files(equipment_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL
    );
    CREATE INDEX IF NOT EXISTS idx_atex_plans_logical ON atex_plans(logical_name);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `);
  await pool.query(`
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
    CREATE INDEX IF NOT EXISTS idx_atex_positions_lookup ON atex_positions(logical_name, page_index);
  `);
  await pool.query(`
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
    CREATE INDEX IF NOT EXISTS idx_atex_subareas_lookup ON atex_subareas(logical_name, page_index);
  `);
  await pool.query(`
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
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMP DEFAULT now(),
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_atex_events_action ON atex_events(action);
    CREATE INDEX IF NOT EXISTS idx_atex_events_time ON atex_events(ts DESC);
  `);
}
// -------------------------------------------------
// Utils
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
    await pool.query(
      `INSERT INTO atex_events(actor_name, actor_email, action, details) VALUES($1,$2,$3,$4)`,
      [u.name || null, u.email || null, action, JSON.stringify(details || {})]
    );
  } catch (e) {
    console.warn("[events] failed to log", action, e.message);
  }
  console.log(`[atex][${action}]`, { by: u.email || u.name || "anon", ...details });
}
// Helpers pour contexte plan/sous-zone → fiche équipement
async function getPlanDisplayName(logical_name) {
  const { rows } = await pool.query(
    `SELECT display_name FROM atex_plan_names WHERE logical_name=$1 LIMIT 1`,
    [logical_name]
  );
  return rows?.[0]?.display_name || logical_name;
}
async function getSubareaNameById(id) {
  if (!id) return null;
  const { rows } = await pool.query(`SELECT name FROM atex_subareas WHERE id=$1`, [id]);
  const nm = (rows?.[0]?.name || "").trim();
  return nm || null;
}
// -------------------------------------------------
// Health / File
app.get("/api/atex/health", async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM atex_equipments`);
    res.json({ ok: true, equipments: rows?.[0]?.n ?? 0, port: PORT });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/atex/file", async (req, res) => {
  try {
    const p = String(req.query.path || "");
    const abs = path.resolve(p);
    if (!abs.startsWith(DATA_DIR)) return res.status(403).json({ ok: false });
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false });
    res.sendFile(abs);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// -------------------------------------------------
/** EQUIPEMENTS **/
app.get("/api/atex/equipments", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const statusFilter = (req.query.status || "").toString().trim();
    const building = (req.query.building || "").toString().trim().toLowerCase();
    const zone = (req.query.zone || "").toString().trim().toLowerCase();
    const compliance = (req.query.compliance || "").toString().trim(); // "conforme" | "non_conforme" | "na" | ""
    const { rows } = await pool.query(
      `
      SELECT e.*,
             (SELECT MAX(date) FROM atex_checks c WHERE c.equipment_id=e.id) AS last_check_date,
             (SELECT result FROM atex_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
      FROM atex_equipments e
      ORDER BY e.created_at DESC
      `
    );
    let items = rows.map((r) => {
      const computed_status = eqStatusFromDue(r.next_check_date);
      const compliance_state =
        r.last_result === "conforme"
          ? "conforme"
          : r.last_result === "non_conforme"
          ? "non_conforme"
          : "na";
      const hay = [
        r.name,
        r.building,
        r.zone,
        r.equipment,
        r.sub_equipment,
        r.type,
        r.manufacturer,
        r.manufacturer_ref,
        r.atex_mark_gas,
        r.atex_mark_dust,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return {
        ...r,
        status: computed_status,
        compliance_state,
        photo_url:
          (r.photo_content && r.photo_content.length) || r.photo_path
            ? `/api/atex/equipments/${r.id}/photo`
            : null,
        __hay: hay,
      };
    });
    if (q) items = items.filter((it) => it.__hay.includes(q));
    if (building) items = items.filter((it) => (it.building || "").toLowerCase().includes(building));
    if (zone) items = items.filter((it) => (it.zone || "").toLowerCase().includes(zone));
    if (statusFilter) items = items.filter((it) => it.status === statusFilter);
    if (compliance === "conforme") items = items.filter((it) => it.compliance_state === "conforme");
    if (compliance === "non_conforme") items = items.filter((it) => it.compliance_state === "non_conforme");
    if (compliance === "na") items = items.filter((it) => it.compliance_state === "na");
    items = items.map(({ __hay, ...x }) => x);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `
      SELECT e.*,
             (SELECT MAX(date) FROM atex_checks c WHERE c.equipment_id=e.id) AS last_check_date,
             (SELECT result FROM atex_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
      FROM atex_equipments e WHERE e.id=$1
      `,
      [id]
    );
    const eq = rows?.[0] || null;
    if (!eq) return res.status(404).json({ ok: false, error: "not found" });
    // ✅ alignement avec la liste: status dynamique + compliance_state + photo_url
    eq.status = eqStatusFromDue(eq.next_check_date);
    eq.compliance_state =
      eq.last_result === "conforme"
        ? "conforme"
        : eq.last_result === "non_conforme"
        ? "non_conforme"
        : "na";
    eq.photo_url =
      (eq.photo_content && eq.photo_content.length) || eq.photo_path
        ? `/api/atex/equipments/${id}/photo`
        : null;
    res.json({ equipment: eq });
  } catch (e) {
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
    // 36 mois après l'installation (ou maintenant si non fourni)
    const installDate = installed_at ? new Date(installed_at) : new Date();
    const firstDue = addMonths(installDate, 36);
    const { rows } = await pool.query(
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
      ]
    );
    const eq = rows[0];
    eq.photo_url = null;
    res.json({ equipment: eq });
  } catch (e) {
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
    await pool.query(`UPDATE atex_equipments SET ${set.join(", ")}, updated_at=now() WHERE id=$${i}`, values);
    const { rows } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
    const eq = rows?.[0] || null;
    if (eq) {
      eq.status = eqStatusFromDue(eq.next_check_date);
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
    }
    res.json({ equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.delete("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    await pool.query(`DELETE FROM atex_equipments WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Photos / Files
app.post("/api/atex/equipments/:id/photo", multerFiles.single("photo"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const file = req.file;
    if (!file) return res.status(400).json({ ok:false, error:"no file" });
    let buf = null;
    try { buf = await fsp.readFile(file.path); } catch {}
    await pool.query(
      `UPDATE atex_equipments
         SET photo_path=$1,
             photo_content=COALESCE($2, photo_content),
             updated_at=now()
       WHERE id=$3`,
      [file.path, buf, id]
    );
    res.json({ ok:true, url:`/api/atex/equipments/${id}/photo` });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.get("/api/atex/equipments/:id/photo", async (req,res)=>{ try{
  const id = String(req.params.id);
  const { rows } = await pool.query(`SELECT photo_path, photo_content FROM atex_equipments WHERE id=$1`, [id]);
  const row = rows?.[0] || null; if(!row) return res.status(404).end();
  if (row.photo_content && row.photo_content.length) {
    res.type("image/jpeg");
    return res.end(row.photo_content, "binary");
  }
  const p = row.photo_path || null; if(!p) return res.status(404).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(path.resolve(p));
} catch { res.status(404).end(); }});
app.get("/api/atex/equipments/:id/files", async (req,res)=>{ try{
  const id = String(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM atex_files WHERE equipment_id=$1 ORDER BY uploaded_at DESC`, [id]);
  const files = rows.map((r)=>({
    id:r.id,
    original_name:r.original_name,
    mime:r.mime,
    download_url:`/api/atex/files/${r.id}/download`,
    inline_url:`/api/atex/files/${r.id}/download`,
  }));
  res.json({ files });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
app.post("/api/atex/equipments/:id/files", multerFiles.array("files"), async (req,res)=>{ try{
  const id = String(req.params.id);
  for (const f of (req.files||[])) {
    let buf = null;
    try { buf = await fsp.readFile(f.path); } catch {}
    await pool.query(
      `INSERT INTO atex_files (equipment_id, original_name, mime, file_path, file_content)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, f.originalname, f.mimetype, f.path, buf]
    );
  }
  res.json({ ok:true });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
app.get("/api/atex/files/:fileId/download", async (req, res) => {
  try {
    const id = String(req.params.fileId);
    const { rows } = await pool.query(
      `SELECT original_name, mime, file_path, file_content FROM atex_files WHERE id=$1`,
      [id]
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
  } catch { res.status(500).json({ ok:false }); }
});
app.delete("/api/atex/files/:fileId", async (req,res)=>{ try{
  const id = String(req.params.fileId);
  const { rows } = await pool.query(`DELETE FROM atex_files WHERE id=$1 RETURNING file_path`, [id]);
  const fp = rows?.[0]?.file_path; if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok:true });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
// -------------------------------------------------
// Settings / Checks / Calendar
app.get("/api/atex/settings", async (_req, res) => {
  try { const { rows } = await pool.query(`SELECT * FROM atex_settings WHERE id=1`); res.json(rows?.[0] || {}); }
  catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.put("/api/atex/settings", async (req, res) => {
  try {
    const { frequency, checklist_template } = req.body || {};
    await pool.query(
      `UPDATE atex_settings SET frequency=COALESCE($1, frequency), checklist_template=COALESCE($2, checklist_template) WHERE id=1`,
      [frequency || null, Array.isArray(checklist_template) ? JSON.stringify(checklist_template) : null]
    );
    const { rows } = await pool.query(`SELECT * FROM atex_settings WHERE id=1`);
    res.json(rows?.[0] || {});
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post("/api/atex/equipments/:id/checks", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows } = await pool.query(
      `INSERT INTO atex_checks(equipment_id, status, user_name, user_email) VALUES($1,'a_faire',$2,$3) RETURNING *`,
      [id, u.name || "", u.email || ""]
    );
    res.json({ check: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.put("/api/atex/equipments/:id/checks/:checkId", multerFiles.array("files"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const checkId = String(req.params.checkId);
    let items = [], close = false;
    if (req.is("multipart/form-data")) { items = JSON.parse(req.body.items || "[]"); close = String(req.body.close || "false")==="true"; }
    else { items = req.body.items || []; close = !!req.body.close; }
    const filesArr = (req.files||[]).map(f=>({ name:f.originalname, mime:f.mimetype, path:f.path, url:fileUrlFromPath(f.path) }));
    await pool.query(`UPDATE atex_checks SET items=$1, files=$2 WHERE id=$3`, [JSON.stringify(items), JSON.stringify(filesArr), checkId]);
    if (close) {
      const values2 = await pool.query(`SELECT items FROM atex_checks WHERE id=$1`, [checkId]);
      const its = values2?.rows?.[0]?.items || [];
      const vals = (its || []).slice(0, 5).map((i) => i?.value).filter(Boolean);
      const result = vals.includes("non_conforme") ? "non_conforme" : (vals.length ? "conforme" : null);
      const nextDate = addMonths(new Date(), 36);
      await pool.query(`UPDATE atex_equipments SET next_check_date=$1, updated_at=now() WHERE id=$2`, [nextDate, id]);
      await pool.query(`UPDATE atex_checks SET status='fait', result=$1, date=now() WHERE id=$2`, [result, checkId]);
    }
    const { rows: eqR } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
    const equipment = eqR?.[0] || null;
    if (equipment) {
      equipment.photo_url =
        (equipment.photo_content && equipment.photo_content.length) || equipment.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
      equipment.status = eqStatusFromDue(equipment.next_check_date);
    }
    res.json({ ok:true, equipment });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.get("/api/atex/equipments/:id/history", async (req,res)=>{ try{
  const id = String(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM atex_checks WHERE equipment_id=$1 ORDER BY date DESC`, [id]);
  res.json({ checks: rows || [] });
} catch(e){ res.status(500).json({ ok:false, error:e.message }); }});
app.get("/api/atex/calendar", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id as equipment_id, name as equipment_name, next_check_date as date
      FROM atex_equipments
      WHERE next_check_date IS NOT NULL
      ORDER BY next_check_date ASC
    `);
    const events = (rows || []).map((r) => ({
      date: r.date,
      equipment_id: r.equipment_id,
      equipment_name: r.equipment_name,
      status: eqStatusFromDue(r.date),
    }));
    res.json({ events });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// -------------------------------------------------
// MAPS — Upload ZIP + list + rename + file URL
app.post("/api/atex/maps/uploadZip", multerZip.single("zip"), async (req, res) => {
  try {
    const zipPath = req.file?.path;
    if (!zipPath) return res.status(400).json({ ok: false, error: "zip missing" });
    const zip = new StreamZip.async({ file: zipPath, storeEntries: true });
    const imported = [];
    try {
      const entries = await zip.entries();
      const files = Object.values(entries).filter(
        (e) => !e.isDirectory && /\.pdf$/i.test(e.name)
      );
      for (const entry of files) {
        const rawName = entry.name.split("/").pop();
        const { name: baseName } = path.parse(rawName || entry.name);
        const base = baseName || "plan";
        const logical = base.replace(/[^\w.-]+/g, "_").toLowerCase();
        const version = Math.floor(Date.now() / 1000);
        const dest = path.join(MAPS_DIR, `${logical}__${version}.pdf`);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await zip.extract(entry.name, dest);
        let buf = null;
        try { buf = await fsp.readFile(dest); } catch { buf = null; }
        const page_count = 1;
        if (buf) {
          await pool.query(
            `INSERT INTO atex_plans (logical_name, version, filename, file_path, page_count, content)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [logical, version, path.basename(dest), dest, page_count, buf]
          );
        } else {
          await pool.query(
            `INSERT INTO atex_plans (logical_name, version, filename, file_path, page_count)
             VALUES ($1,$2,$3,$4,$5)`,
            [logical, version, path.basename(dest), dest, page_count]
          );
        }
        await pool.query(
          `INSERT INTO atex_plan_names (logical_name, display_name) VALUES ($1,$2)
           ON CONFLICT (logical_name) DO NOTHING`,
          [logical, base]
        );
        imported.push({ logical_name: logical, version, page_count });
      }
    } finally {
      await zip.close().catch(()=>{});
      fs.rmSync(zipPath, { force: true });
    }
    res.json({ ok: true, imported });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// ⚙️ listPlans => id = UUID de la dernière version
app.get("/api/atex/maps/listPlans", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id, p.logical_name, p.version, COALESCE(p.page_count,1) AS page_count,
             (SELECT display_name FROM atex_plan_names n WHERE n.logical_name=p.logical_name LIMIT 1) AS display_name
      FROM atex_plans p
      ORDER BY p.logical_name, p.version DESC
    `);
    const plans = rows.map((r) => ({
      id: r.id, // UUID
      logical_name: r.logical_name,
      version: Number(r.version || 1),
      page_count: Number(r.page_count || 1),
      display_name: r.display_name || r.logical_name,
    }));
    res.json({ plans, items: plans });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Alias compat (si l’ancien front appelle encore /plans)
app.get("/api/atex/maps/plans", (req, res) =>
  app._router.handle(Object.assign(req, { url: "/api/atex/maps/listPlans" }), res)
);
app.put("/api/atex/maps/renamePlan", async (req, res) => {
  try {
    const { logical_name, display_name } = req.body || {};
    if (!logical_name) return res.status(400).json({ ok: false, error: "logical_name required" });
    await pool.query(
      `INSERT INTO atex_plan_names (logical_name, display_name)
         VALUES ($1,$2)
       ON CONFLICT (logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [logical_name, String(display_name || "").trim() || logical_name]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// 🔹 Fichier du plan
app.get("/api/atex/maps/planFile", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString();
    const id = (req.query.id || "").toString();
    if (id && isUuid(id)) {
      const { rows } = await pool.query(
        `SELECT file_path, content FROM atex_plans WHERE id=$1 ORDER BY version DESC LIMIT 1`,
        [id]
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
    let rows = (
      await pool.query(
        `SELECT file_path, content FROM atex_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
        [logical]
      )
    ).rows;
    if (!rows?.length) {
      rows = (
        await pool.query(
          `SELECT file_path, content FROM atex_plans WHERE lower(logical_name)=lower($1) ORDER BY version DESC LIMIT 1`,
          [logical]
        )
      ).rows;
    }
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
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Aliases compat pour planFile
app.get("/api/atex/maps/plan/:logical/file", async (req, res) => {
  req.query.logical_name = req.params.logical;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
app.get("/api/atex/maps/plan-id/:id/file", async (req, res) => {
  req.query.id = req.params.id;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
app.get("/api/doors/maps/plan/:logical/file", async (req, res) => {
  req.query.logical_name = req.params.logical;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
app.get("/api/doors/maps/plan-id/:id/file", async (req, res) => {
  req.query.id = req.params.id;
  req.url = "/api/atex/maps/planFile";
  return app._router.handle(req, res);
});
// -------------------------------------------------
// MAPS — Positions & Subareas (avec auto MAJ fiche équipement)
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
  // Priorité à la DERNIÈRE forme créée (DESC)
  const { rows } = await pool.query(
    `SELECT id, kind, x1,y1,x2,y2,cx,cy,r,points,zoning_gas,zoning_dust,name
     FROM atex_subareas WHERE logical_name=$1 AND page_index=$2
     ORDER BY created_at DESC`,
    [logical_name, page_index]
  );
  for (const z of rows) {
    if (z.kind === "rect" && pointInRect(x_frac, y_frac, z.x1, z.y1, z.x2, z.y2)) {
      return { zoning_gas: z.zoning_gas, zoning_dust: z.zoning_dust, subarea_id: z.id, subarea_name: (z.name||"").trim()||null };
    }
    if (z.kind === "circle" && pointInCircle(x_frac, y_frac, z.cx, z.cy, z.r)) {
      return { zoning_gas: z.zoning_gas, zoning_dust: z.zoning_dust, subarea_id: z.id, subarea_name: (z.name||"").trim()||null };
    }
    if (z.kind === "poly" && Array.isArray(z.points)) {
      const pts = z.points;
      if (pts?.length && pointInPoly(x_frac, y_frac, pts)) {
        return { zoning_gas: z.zoning_gas, zoning_dust: z.zoning_dust, subarea_id: z.id, subarea_name: (z.name||"").trim()||null };
      }
    }
  }
  return { zoning_gas: null, zoning_dust: null, subarea_id: null, subarea_name: null };
}
async function updateEquipmentContext({ equipment_id, logical_name, zoning_gas, zoning_dust, subarea_id, subarea_name_hint }) {
  const planDisplay = await getPlanDisplayName(logical_name);
  const subName = subarea_name_hint || (await getSubareaNameById(subarea_id));
  // MAJ zonage + nom du plan (equipment) + nom de sous-zone (sub_equipment)
  await pool.query(
    `UPDATE atex_equipments
       SET zoning_gas=$1,
           zoning_dust=$2,
           equipment=$3,
           sub_equipment=COALESCE($4, sub_equipment),
           updated_at=now()
     WHERE id=$5`,
    [zoning_gas, zoning_dust, planDisplay, subName || null, equipment_id]
  );
  return { plan_display_name: planDisplay, subarea_name: subName || null };
}
app.put("/api/atex/maps/setPosition", async (req, res) => {
  try {
    const { equipment_id, logical_name, plan_id = null, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null)
      return res.status(400).json({ ok: false, error: "missing params" });
    await pool.query(
      `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (equipment_id, logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac`,
      [equipment_id, logical_name, isUuid(plan_id) ? plan_id : null, page_index, x_frac, y_frac]
    );
    const zones = await detectZonesForPoint(logical_name, page_index, Number(x_frac), Number(y_frac));
    const ctx = await updateEquipmentContext({
      equipment_id,
      logical_name,
      zoning_gas: zones.zoning_gas,
      zoning_dust: zones.zoning_dust,
      subarea_id: zones.subarea_id,
      subarea_name_hint: zones.subarea_name || null,
    });
    res.json({ ok: true, zones, ...ctx });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post("/api/atex/maps/setPosition", async (req, res) => {
  req.method = "PUT";
  return app._router.handle(req, res);
});
app.put("/api/atex/maps/positions/:equipmentId", async (req, res) => {
  try {
    const equipment_id = String(req.params.equipmentId);
    const { logical_name, plan_id = null, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null)
      return res.status(400).json({ ok: false, error: "missing params" });
    await pool.query(
      `INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (equipment_id, logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac`,
      [equipment_id, logical_name, isUuid(plan_id) ? plan_id : null, page_index, x_frac, y_frac]
    );
    const zones = await detectZonesForPoint(logical_name, page_index, Number(x_frac), Number(y_frac));
    const ctx = await updateEquipmentContext({
      equipment_id,
      logical_name,
      zoning_gas: zones.zoning_gas,
      zoning_dust: zones.zoning_dust,
      subarea_id: zones.subarea_id,
      subarea_name_hint: zones.subarea_name || null,
    });
    res.json({ ok: true, zones, ...ctx });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// 🔧 Reindex (front l'appelle après modif des sous-zones)
app.post("/api/atex/maps/reindexZones", async (req, res) => {
  try {
    const { logical_name, page_index = 0 } = req.body || {};
    if (!logical_name) return res.status(400).json({ ok:false, error:"logical_name required" });
    const { rows: pos } = await pool.query(
      `SELECT equipment_id, x_frac, y_frac FROM atex_positions WHERE logical_name=$1 AND page_index=$2`,
      [logical_name, Number(page_index)]
    );
    let updated = 0;
    for (const p of pos) {
      const z = await detectZonesForPoint(logical_name, Number(page_index), Number(p.x_frac), Number(p.y_frac));
      await updateEquipmentContext({
        equipment_id: p.equipment_id,
        logical_name,
        zoning_gas: z.zoning_gas,
        zoning_dust: z.zoning_dust,
        subarea_id: z.subarea_id,
        subarea_name_hint: z.subarea_name || null,
      });
      updated++;
    }
    await logEvent(req, "zones.reindex", { logical_name, page_index, updated });
    res.json({ ok:true, updated });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// ✅ Positions — accepte id (UUID) OU logical_name
app.get("/api/atex/maps/positions", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        // si "id" n'est pas un UUID, on le traite comme logical_name (compat)
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok: false, error: "logical_name or id required" });
    const { rows } = await pool.query(
      `
      SELECT p.equipment_id, p.x_frac, p.y_frac,
             e.name, e.building, e.zone, e.status, e.zoning_gas, e.zoning_dust, e.equipment, e.sub_equipment
      FROM atex_positions p
      JOIN atex_equipments e ON e.id=p.equipment_id
      WHERE p.logical_name=$1 AND p.page_index=$2
      `,
      [logical, pageIndex]
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
      equipment_macro: r.equipment || null,
      sub_equipment: r.sub_equipment || null,
    }));
    res.json({ items });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// ✅ Subareas — accepte id (UUID) OU logical_name
app.get("/api/atex/maps/subareas", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name or id required" });
    // ASC pour affichage; priorité de sélection gérée en DESC dans detectZonesForPoint
    const { rows } = await pool.query(
      `SELECT * FROM atex_subareas WHERE logical_name=$1 AND page_index=$2 ORDER BY created_at ASC`,
      [logical, pageIndex]
    );
    res.json({ items: rows || [] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.get("/api/atex/maps/subareas/stats", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name or id required" });
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM atex_subareas WHERE logical_name=$1 AND page_index=$2`,
      [logical, pageIndex]
    );
    res.json({ ok:true, count: rows?.[0]?.n ?? 0 });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
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
    const { rows } = await pool.query(
      `INSERT INTO atex_subareas
        (logical_name, plan_id, page_index, kind, x1,y1,x2,y2,cx,cy,r,points,name,zoning_gas,zoning_dust)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        logical_name, planIdSafe, page_index, kind,
        x1, y1, x2, y2, cx, cy, r,
        points ? JSON.stringify(points) : null,
        name, zoning_gas, zoning_dust,
      ]
    );
    const created = rows[0];
    await pool.query(`UPDATE atex_subareas SET updated_at=now() WHERE id=$1`, [created.id]);
    await logEvent(req, "subarea.create", { id: created.id, logical_name, page_index, kind, name, zoning_gas, zoning_dust });
    res.json({ ok:true, subarea: created, created: true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
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
    await pool.query(`UPDATE atex_subareas SET ${set.join(", ")} WHERE id=$${i}`, vals);
    await logEvent(req, "subarea.update", {
      id,
      hasGeometry: !!(body.kind || body.points || geoKeys.some(k => body[k] !== undefined)),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
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
    await pool.query(`UPDATE atex_subareas SET ${set.join(", ")} WHERE id=$${i}`, vals);
    await logEvent(req, "subarea.update.geometry", { id, kind, hasPoints: Array.isArray(points) ? points.length : null });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.delete("/api/atex/maps/subareas/:id", async (req, res) => {
  try { const id = String(req.params.id);
    await pool.query(`DELETE FROM atex_subareas WHERE id=$1`, [id]);
    await logEvent(req, "subarea.delete", { id });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// ✅ purge — accepte id OU logical_name
app.delete("/api/atex/maps/subareas/purge", async (req, res) => {
  try {
    let logical = (req.query.logical_name || "").toString().trim();
    const id = (req.query.id || "").toString().trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical && id) {
      if (isUuid(id)) {
        const { rows } = await pool.query(`SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1`, [id]);
        logical = rows?.[0]?.logical_name || "";
      } else {
        logical = id;
      }
    }
    if (!logical) return res.status(400).json({ ok:false, error:"logical_name or id required" });
    if ((req.header("X-Confirm") || "").toLowerCase() !== "purge")
      return res.status(412).json({ ok:false, error:"missing confirmation header X-Confirm: purge" });
    const { rows } = await pool.query(
      `DELETE FROM atex_subareas WHERE logical_name=$1 AND page_index=$2 RETURNING id`,
      [logical, pageIndex]
    );
    await logEvent(req, "subarea.purge", { logical_name: logical, page_index: pageIndex, deleted: rows.length });
    res.json({ ok:true, deleted: rows.length });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// -------------------------------------------------
// Logs
app.get("/api/atex/logs", async (req, res) => {
  try {
    const action = (req.query.action || "").toString().trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    let rows;
    if (action) {
      ({ rows } = await pool.query(
        `SELECT * FROM atex_events WHERE action=$1 ORDER BY ts DESC LIMIT $2`,
        [action, limit]
      ));
    } else {
      ({ rows } = await pool.query(`SELECT * FROM atex_events ORDER BY ts DESC LIMIT $1`, [limit]));
    }
    res.json({ items: rows || [] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// -------------------------------------------------
// IA
function openaiClient() {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ATEX || process.env.OPENAI_API_KEY_DOORS;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}
app.post("/api/atex/extract", multerFiles.array("files"), async (req, res) => {
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
      }))
    );
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
    let data = {};
    try { data = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { data = {}; }
    res.json({ ok: true, extracted: {
      manufacturer: String(data.manufacturer || ""),
      manufacturer_ref: String(data.manufacturer_ref || ""),
      atex_mark_gas: String(data.atex_mark_gas || ""),
      atex_mark_dust: String(data.atex_mark_dust || ""),
      type: String(data.type || ""),
    }});
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
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
    let data = {};
    try { data = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { data = {}; }
    res.json({ ok:true, ...data });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); } // <- fix .json
});
// ✅ Endpoint dédié pour "appliquer" la conformité IA à une fiche (sans toucher à l'échéance)
app.post("/api/atex/equipments/:id/compliance", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { decision = null, rationale = "" } = req.body || {};
    if (!["conforme", "non_conforme", "indetermine", null].includes(decision))
      return res.status(400).json({ ok:false, error:"invalid decision" });
    const u = getUser(req);
    const { rows } = await pool.query(
      `INSERT INTO atex_checks(equipment_id, status, date, items, result, user_name, user_email, files)
       VALUES($1,'fait',now(),$2,$3,$4,$5,'[]'::jsonb)
       RETURNING *`,
      [
        id,
        JSON.stringify([{ label: "Vérification IA", value: decision, rationale }]),
        decision === "indetermine" ? null : decision,
        u.name || "",
        u.email || "",
      ]
    );
    // Retourner la fiche avec état de conformité recalculé
    const { rows: eqR } = await pool.query(
      `
      SELECT e.*,
             (SELECT result FROM atex_checks c
              WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
              ORDER BY c.date DESC NULLS LAST
              LIMIT 1) AS last_result
      FROM atex_equipments e WHERE e.id=$1
      `,
      [id]
    );
    const eq = eqR?.[0] || null;
    if (eq) {
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/atex/equipments/${id}/photo`
          : null;
      eq.status = eqStatusFromDue(eq.next_check_date);
      eq.compliance_state =
        eq.last_result === "conforme" ? "conforme" :
        eq.last_result === "non_conforme" ? "non_conforme" : "na";
    }
    res.json({ ok:true, check: rows[0], equipment: eq });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Legacy aliases (compat)
app.post("/api/atex/analyzePhotoBatch", (req, res) => {
  req.url = "/api/atex/extract";
  return app._router.handle(req, res);
});
app.post("/api/atex/aiAnalyze", (req, res) => {
  req.url = "/api/atex/assess";
  return app._router.handle(req, res);
});

// -------------------------------------------------
// Utilitaire pour sécuriser les chaînes (prévention injection SQL / null)
// -------------------------------------------------
function safeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/* -------------------------------------------------------------------------- */
/*           🔹 META bâtiment / zone persistés directement dans atex_plans     */
/* -------------------------------------------------------------------------- */

app.get("/api/atex/maps/meta", async (req, res) => {
  try {
    const plan_key = safeStr(req.query.plan_key);
    if (!plan_key) return res.status(400).json({ error: "plan_key manquant" });

    const rows = await pool.query(
      `SELECT logical_name AS plan_key, building, zone 
         FROM atex_plans 
        WHERE logical_name = $1 
           OR id::text = $1 
        LIMIT 1`,
      [plan_key]
    );

    if (!rows.length)
      return res.json({ plan_key, building: "", zone: "" });

    res.json(rows[0]);
  } catch (e) {
    console.error("[GET /maps/meta]", e);
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/atex/maps/meta", async (req, res) => {
  try {
    const { plan_key, building, zone } = req.body;
    if (!plan_key) return res.status(400).json({ error: "plan_key requis" });

    // détecter si c’est un ID numérique
    const plan = await db.get(
      `SELECT * FROM atex_plans WHERE id = ? OR logical_name = ? LIMIT 1`,
      [Number(plan_key), plan_key]
    );

    if (!plan) return res.status(404).json({ error: "Plan introuvable" });

    await db.run(
      `UPDATE atex_plans SET building = ?, zone = ? WHERE id = ?`,
      [building || null, zone || null, plan.id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("setMeta error", e);
    res.status(500).json({ error: String(e) });
  }
});
// -------------------------------------------------
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[atex] listening on ${HOST}:${PORT}`);
});
