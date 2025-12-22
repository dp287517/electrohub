// ==============================
// server_vsd.js — VSD (Variateurs de Fréquence) CMMS microservice (ESM)
// ✅ VERSION 2.0 - MULTI-TENANT (Site)
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
import PDFDocument from "pdfkit";
import { createRequire } from "module";
import { getSiteFilter } from "./lib/tenant-filter.js";
const require = createRequire(import.meta.url);
// --- OpenAI (extraction & conformité)
const { OpenAI } = await import("openai");
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.VSD_PORT || 3020);
const HOST = process.env.VSD_HOST || "0.0.0.0";
// Dossiers data
const DATA_DIR = process.env.VSD_DATA_DIR || path.resolve(__dirname, "./_data_vsd");
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
    process.env.VSD_DATABASE_URL ||
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
    CREATE TABLE IF NOT EXISTS vsd_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site TEXT DEFAULT 'Nyon',
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      equipment TEXT DEFAULT '',
      sub_equipment TEXT DEFAULT '',
      type TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      manufacturer_ref TEXT DEFAULT '',
      power_kw NUMERIC DEFAULT NULL,
      voltage TEXT DEFAULT '',
      current_nominal NUMERIC DEFAULT NULL,
      ip_rating TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      status TEXT DEFAULT 'a_faire',
      installed_at TIMESTAMP NULL,
      next_check_date DATE NULL,
      photo_path TEXT DEFAULT NULL,
      photo_content BYTEA NULL,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),

      -- NOUVEAUX CHAMPS D'EXPLOITATION/UI
      tag TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      protocol TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      panel TEXT DEFAULT '',
      location TEXT DEFAULT '',
      criticality TEXT DEFAULT '',
      ui_status TEXT DEFAULT ''
    );
    
    -- AJOUT DES COLONNES MANQUANTES (pour les DB existantes)
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='site') THEN
        ALTER TABLE vsd_equipments ADD COLUMN site TEXT DEFAULT 'Nyon';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='tag') THEN
        ALTER TABLE vsd_equipments ADD COLUMN tag TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='model') THEN
        ALTER TABLE vsd_equipments ADD COLUMN model TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='serial_number') THEN
        ALTER TABLE vsd_equipments ADD COLUMN serial_number TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='ip_address') THEN
        ALTER TABLE vsd_equipments ADD COLUMN ip_address TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='protocol') THEN
        ALTER TABLE vsd_equipments ADD COLUMN protocol TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='floor') THEN
        ALTER TABLE vsd_equipments ADD COLUMN floor TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='panel') THEN
        ALTER TABLE vsd_equipments ADD COLUMN panel TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='location') THEN
        ALTER TABLE vsd_equipments ADD COLUMN location TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='criticality') THEN
        ALTER TABLE vsd_equipments ADD COLUMN criticality TEXT DEFAULT '';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vsd_equipments' AND column_name='ui_status') THEN
        ALTER TABLE vsd_equipments ADD COLUMN ui_status TEXT DEFAULT '';
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_vsd_eq_next ON vsd_equipments(next_check_date);
    CREATE INDEX IF NOT EXISTS idx_vsd_eq_site ON vsd_equipments(site);
  `);
  // ... (Autres tables non modifiées)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES vsd_equipments(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'a_faire',
      date TIMESTAMP DEFAULT now(),
      items JSONB DEFAULT '[]'::jsonb,
      result TEXT DEFAULT NULL,
      user_name TEXT DEFAULT '',
      user_email TEXT DEFAULT '',
      files JSONB DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_vsd_checks_eq ON vsd_checks(equipment_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES vsd_equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_content BYTEA NULL,
      uploaded_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_vsd_files_eq ON vsd_files(equipment_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vsd_plans_logical ON vsd_plans(logical_name);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES vsd_equipments(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      UNIQUE (equipment_id, logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_vsd_positions_lookup ON vsd_positions(logical_name, page_index);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT '12_mois',
      checklist_template JSONB NOT NULL DEFAULT '[
        "État général du variateur (propreté, absence de poussière) ?",
        "Ventilateurs de refroidissement fonctionnels ?",
        "Affichage et voyants opérationnels ?",
        "Connexions électriques serrées et en bon état ?",
        "Absence de bruits ou vibrations anormaux ?",
        "Paramètres de configuration conformes ?",
        "Test de fonctionnement (démarrage/arrêt) ?",
        "Relevé des alarmes et historique d''erreurs ?"
      ]'::jsonb
    );
    INSERT INTO vsd_settings(id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMP DEFAULT now(),
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_vsd_events_ts ON vsd_events(ts DESC);
  `);
}
// -------------------------------------------------
// Helpers
function eqStatusFromDue(due) {
  if (!due) return "a_faire";
  const d = new Date(due);
  const now = new Date();
  const diff = d - now;
  const days = Math.floor(diff / 86400000);
  if (days < 0) return "en_retard";
  if (days <= 90) return "en_cours_30";
  return "a_faire";
}
function frequencyMonths(f) {
  if (f === "6_mois") return 6;
  if (f === "12_mois") return 12;
  if (f === "24_mois") return 24;
  if (f === "36_mois") return 36;
  return 12;
}
function nextCheckFrom(base, freq) {
  const m = frequencyMonths(freq);
  const d = base ? new Date(base) : new Date();
  d.setMonth(d.getMonth() + m);
  return d.toISOString().slice(0, 10);
}
async function logEvent(action, details = {}, user = {}) {
  try {
    await pool.query(
      `INSERT INTO vsd_events(action, details, actor_name, actor_email) VALUES($1,$2,$3,$4)`,
      [action, details, user.name || null, user.email || null]
    );
  } catch {}
}

async function vsdExtractFromFiles(client, files) {
  if (!client) throw new Error("OPENAI_API_KEY missing");
  if (!files?.length) throw new Error("no files");

  const images = await Promise.all(
    files.map(async (f) => ({
      name: f.originalname,
      mime: f.mimetype,
      data: (await fsp.readFile(f.path)).toString("base64"),
    }))
  );

  const sys = `Tu es un assistant d'inspection de variateurs de fréquence (VSD). Extrait des photos:
- manufacturer (fabricant)
- model (modèle)
- reference (référence commerciale)
- serial_number (numéro de série)
- power_kw (puissance en kW, nombre décimal)
- current_a (courant nominal en A, nombre décimal)
- voltage (tension, ex: "400V")
- protocol (protocole de communication: Modbus, Profibus, Ethernet/IP, etc.)
- ip_rating (indice de protection IP)

Réponds en JSON strict avec ces champs uniquement.`;

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
    model: process.env.VSD_OPENAI_MODEL || "gpt-4o-mini",
    messages: content,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  let data = {};
  try {
    data = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
  } catch {
    data = {};
  }

  return {
    manufacturer: String(data.manufacturer || ""),
    model: String(data.model || ""),
    reference: String(data.reference || ""),
    serial_number: String(data.serial_number || ""),
    power_kw: data.power_kw != null ? Number(data.power_kw) : null,
    current_a: data.current_a != null ? Number(data.current_a) : null,
    voltage: String(data.voltage || ""),
    protocol: String(data.protocol || ""),
    ip_rating: String(data.ip_rating || ""),
  };
}

// -------------------------------------------------
// GET /api/vsd/equipments
app.get("/api/vsd/equipments", async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req, { tableAlias: 'e' });
    if (role === 'site' && !siteName) return res.status(400).json({ ok: false, error: 'Missing site (X-Site header)' });

    const { rows } = await pool.query(`
      SELECT e.*,
             (SELECT result FROM vsd_checks c
              WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
              ORDER BY c.date DESC NULLS LAST
              LIMIT 1) AS last_result
        FROM vsd_equipments e
       WHERE ${siteWhere}
       ORDER BY e.name
    `, siteParams);
    console.log(`[VSD] Loaded ${rows.length} equipments for role=${role}, site=${siteName || 'all'}`);
    for (const r of rows) {
      r.photo_url =
        (r.photo_content && r.photo_content.length) || r.photo_path
          ? `/api/vsd/equipments/${r.id}/photo`
          : null;
      r.status = eqStatusFromDue(r.next_check_date);
      r.compliance_state =
        r.last_result === "conforme"
          ? "conforme"
          : r.last_result === "non_conforme"
          ? "non_conforme"
          : "na";
    }
    res.json({ ok: true, equipments: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/equipments/:id
app.get("/api/vsd/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT e.*,
              (SELECT result FROM vsd_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
         FROM vsd_equipments e WHERE e.id=$1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Not found" });
    const eq = rows[0];
    eq.photo_url =
      (eq.photo_content && eq.photo_content.length) || eq.photo_path
        ? `/api/vsd/equipments/${id}/photo`
        : null;
    eq.status = eqStatusFromDue(eq.next_check_date);
    eq.compliance_state =
      eq.last_result === "conforme"
        ? "conforme"
        : eq.last_result === "non_conforme"
        ? "non_conforme"
        : "na";
    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// POST /api/vsd/equipments
app.post("/api/vsd/equipments", async (req, res) => {
  try {
    const u = getUser(req);
    const site = req.header("X-Site") || req.body?.site || "Nyon";
    const {
      name = "",
      building = "",
      zone = "",
      equipment = "",
      sub_equipment = "",
      type = "",
      manufacturer = "",
      manufacturer_ref = "",
      power_kw = null,
      voltage = "",
      current_nominal = null,
      ip_rating = "",
      comment = "",
      installed_at = null,
      next_check_date = null,
      // NOUVEAUX CHAMPS
      tag = "",
      model = "",
      serial_number = "",
      ip_address = "",
      protocol = "",
      floor = "",
      panel = "",
      location = "",
      criticality = "",
      ui_status = "",
    } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO vsd_equipments(
         site, name, building, zone, equipment, sub_equipment, type,
         manufacturer, manufacturer_ref, power_kw, voltage,
         current_nominal, ip_rating, comment,
         installed_at, next_check_date,
         tag, model, serial_number, ip_address, protocol, floor, panel, location, criticality, ui_status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING *`,
      [
        site, name, building, zone, equipment, sub_equipment, type,
        manufacturer, manufacturer_ref, power_kw, voltage,
        current_nominal, ip_rating, comment,
        installed_at || null,
        next_check_date || null,
        tag, model, serial_number, ip_address, protocol, floor, panel, location, criticality, ui_status
      ]
    );
    const eq = rows[0];
    eq.photo_url = null;
    eq.status = eqStatusFromDue(eq.next_check_date);
    eq.compliance_state = "na";
    await logEvent("vsd_equipment_created", { id: eq.id, name: eq.name }, u);
    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// PUT /api/vsd/equipments/:id
app.put("/api/vsd/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const {
      name, building, zone, equipment, sub_equipment, type,
      manufacturer, manufacturer_ref, power_kw, voltage,
      current_nominal, ip_rating, comment,
      installed_at, next_check_date,
      // NOUVEAUX CHAMPS
      tag, model, serial_number, ip_address, protocol, floor, panel, location, criticality, ui_status,
    } = req.body || {};
    const fields = [];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name=$${idx++}`); vals.push(name); }
    if (building !== undefined) { fields.push(`building=$${idx++}`); vals.push(building); }
    if (zone !== undefined) { fields.push(`zone=$${idx++}`); vals.push(zone); }
    if (equipment !== undefined) { fields.push(`equipment=$${idx++}`); vals.push(equipment); }
    if (sub_equipment !== undefined) { fields.push(`sub_equipment=$${idx++}`); vals.push(sub_equipment); }
    if (type !== undefined) { fields.push(`type=$${idx++}`); vals.push(type); }
    if (manufacturer !== undefined) { fields.push(`manufacturer=$${idx++}`); vals.push(manufacturer); }
    if (manufacturer_ref !== undefined) { fields.push(`manufacturer_ref=$${idx++}`); vals.push(manufacturer_ref); }
    if (power_kw !== undefined) { fields.push(`power_kw=$${idx++}`); vals.push(power_kw); }
    if (voltage !== undefined) { fields.push(`voltage=$${idx++}`); vals.push(voltage); }
    if (current_nominal !== undefined) { fields.push(`current_nominal=$${idx++}`); vals.push(current_nominal); }
    if (ip_rating !== undefined) { fields.push(`ip_rating=$${idx++}`); vals.push(ip_rating); }
    if (comment !== undefined) { fields.push(`comment=$${idx++}`); vals.push(comment); }
    if (installed_at !== undefined) { fields.push(`installed_at=$${idx++}`); vals.push(installed_at || null); }
    if (next_check_date !== undefined) { fields.push(`next_check_date=$${idx++}`); vals.push(next_check_date || null); }
    // NOUVEAUX CHAMPS
    if (tag !== undefined) { fields.push(`tag=$${idx++}`); vals.push(tag); }
    if (model !== undefined) { fields.push(`model=$${idx++}`); vals.push(model); }
    if (serial_number !== undefined) { fields.push(`serial_number=$${idx++}`); vals.push(serial_number); }
    if (ip_address !== undefined) { fields.push(`ip_address=$${idx++}`); vals.push(ip_address); }
    if (protocol !== undefined) { fields.push(`protocol=$${idx++}`); vals.push(protocol); }
    if (floor !== undefined) { fields.push(`floor=$${idx++}`); vals.push(floor); }
    if (panel !== undefined) { fields.push(`panel=$${idx++}`); vals.push(panel); }
    if (location !== undefined) { fields.push(`location=$${idx++}`); vals.push(location); }
    if (criticality !== undefined) { fields.push(`criticality=$${idx++}`); vals.push(criticality); }
    if (ui_status !== undefined) { fields.push(`ui_status=$${idx++}`); vals.push(ui_status); }

    fields.push(`updated_at=now()`);
    vals.push(id);
    await pool.query(
      `UPDATE vsd_equipments SET ${fields.join(", ")} WHERE id=$${idx}`,
      vals
    );
    const { rows } = await pool.query(
      `SELECT e.*,
              (SELECT result FROM vsd_checks c
               WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
               ORDER BY c.date DESC NULLS LAST
               LIMIT 1) AS last_result
         FROM vsd_equipments e WHERE e.id=$1`,
      [id]
    );
    const eq = rows[0];
    if (eq) {
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/vsd/equipments/${id}/photo`
          : null;
      eq.status = eqStatusFromDue(eq.next_check_date);
      eq.compliance_state =
        eq.last_result === "conforme"
          ? "conforme"
          : eq.last_result === "non_conforme"
          ? "non_conforme"
          : "na";
    }
    await logEvent("vsd_equipment_updated", { id, fields: Object.keys(req.body) }, u);
    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// DELETE /api/vsd/equipments/:id
app.delete("/api/vsd/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows: old } = await pool.query(`SELECT name FROM vsd_equipments WHERE id=$1`, [id]);
    await pool.query(`DELETE FROM vsd_equipments WHERE id=$1`, [id]);
    await logEvent("vsd_equipment_deleted", { id, name: old[0]?.name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/equipments/:id/photo
app.get("/api/vsd/equipments/:id/photo", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT photo_content, photo_path FROM vsd_equipments WHERE id=$1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Not found" });
    const { photo_content, photo_path } = rows[0];
    if (photo_content && photo_content.length) {
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(photo_content);
    }
    if (photo_path && fs.existsSync(photo_path)) {
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=3600");
      return res.sendFile(path.resolve(photo_path));
    }
    res.status(404).json({ ok: false, error: "No photo" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// POST /api/vsd/equipments/:id/photo
app.post("/api/vsd/equipments/:id/photo", multerFiles.single("photo"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    if (!req.file) return res.status(400).json({ ok: false, error: "No file" });
    const buf = await fsp.readFile(req.file.path);
    await pool.query(
      `UPDATE vsd_equipments SET photo_content=$1, photo_path=$2, updated_at=now() WHERE id=$3`,
      [buf, req.file.path, id]
    );
    await logEvent("vsd_equipment_photo_updated", { id }, u);
    res.json({ ok: true, photo_url: `/api/vsd/equipments/${id}/photo` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/checks
app.get("/api/vsd/checks", async (req, res) => {
  try {
    const eqId = req.query.equipment_id;
    let q = `SELECT * FROM vsd_checks`;
    const vals = [];
    if (eqId) {
      q += ` WHERE equipment_id=$1`;
      vals.push(String(eqId));
    }
    q += ` ORDER BY date DESC`;
    const { rows } = await pool.query(q, vals);
    res.json({ ok: true, checks: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/equipments/:id/history
app.get("/api/vsd/equipments/:id/history", async (req, res) => {
  try {
    const eqId = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT * FROM vsd_checks
       WHERE equipment_id = $1
       ORDER BY date DESC`,
      [eqId]
    );
    res.json({ ok: true, checks: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// POST /api/vsd/checks
app.post("/api/vsd/checks", async (req, res) => {
  try {
    const u = getUser(req);
    const {
      equipment_id,
      status = "fait",
      items = [],
      result = null,
      date = new Date().toISOString(),
    } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO vsd_checks(equipment_id, status, date, items, result, user_name, user_email)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [equipment_id, status, date, JSON.stringify(items), result, u.name || "", u.email || ""]
    );
    const check = rows[0];
    if (status === "fait" && equipment_id) {
      const { rows: setRows } = await pool.query(`SELECT frequency FROM vsd_settings WHERE id=1`);
      const freq = setRows[0]?.frequency || "12_mois";
      const next = nextCheckFrom(date, freq);
      await pool.query(
        `UPDATE vsd_equipments SET next_check_date=$1, updated_at=now() WHERE id=$2`,
        [next, equipment_id]
      );
    }
    await logEvent("vsd_check_created", { check_id: check.id, equipment_id, result }, u);
    res.json({ ok: true, check });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/calendar
app.get("/api/vsd/calendar", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, next_check_date AS date FROM vsd_equipments
       WHERE next_check_date IS NOT NULL
       ORDER BY next_check_date
    `);
    const events = rows.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
    }));
    res.json({ ok: true, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/settings
app.get("/api/vsd/settings", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM vsd_settings WHERE id=1`);
    res.json({ ok: true, settings: rows[0] || { frequency: "12_mois", checklist_template: [] } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// PUT /api/vsd/settings
app.put("/api/vsd/settings", async (req, res) => {
  try {
    const u = getUser(req);
    const { frequency, checklist_template } = req.body || {};
    const fields = [];
    const vals = [];
    let idx = 1;
    if (frequency) { fields.push(`frequency=$${idx++}`); vals.push(frequency); }
    if (checklist_template) { fields.push(`checklist_template=$${idx++}`); vals.push(JSON.stringify(checklist_template)); }
    if (fields.length) {
      await pool.query(`UPDATE vsd_settings SET ${fields.join(", ")} WHERE id=1`, vals);
    }
    const { rows } = await pool.query(`SELECT * FROM vsd_settings WHERE id=1`);
    await logEvent("vsd_settings_updated", { frequency, checklist_template }, u);
    res.json({ ok: true, settings: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// FILES
// GET /api/vsd/files
app.get("/api/vsd/files", async (req, res) => {
  try {
    const eqId = req.query.equipment_id;
    if (!eqId) return res.status(400).json({ ok: false, error: "equipment_id required" });
    const { rows } = await pool.query(
      `SELECT id, equipment_id, original_name, mime, uploaded_at FROM vsd_files WHERE equipment_id=$1 ORDER BY uploaded_at DESC`,
      [String(eqId)]
    );
    for (const f of rows) {
      f.url = `/api/vsd/files/${f.id}`;
    }
    res.json({ ok: true, files: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// POST /api/vsd/files
app.post("/api/vsd/files", multerFiles.array("files"), async (req, res) => {
  try {
    const u = getUser(req);
    const eqId = req.body.equipment_id;
    if (!eqId) return res.status(400).json({ ok: false, error: "equipment_id required" });
    const inserted = [];
    for (const f of req.files || []) {
      const buf = await fsp.readFile(f.path);
      const { rows } = await pool.query(
        `INSERT INTO vsd_files(equipment_id, original_name, mime, file_path, file_content)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [eqId, f.originalname, f.mimetype, f.path, buf]
      );
      inserted.push({ ...rows[0], url: `/api/vsd/files/${rows[0].id}` });
    }
    await logEvent("vsd_files_uploaded", { equipment_id: eqId, count: inserted.length }, u);
    res.json({ ok: true, files: inserted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/files/:id
app.get("/api/vsd/files/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT original_name, mime, file_content, file_path FROM vsd_files WHERE id=$1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Not found" });
    const { original_name, mime, file_content, file_path } = rows[0];
    if (file_content && file_content.length) {
      res.set("Content-Type", mime || "application/octet-stream");
      res.set("Content-Disposition", `inline; filename="${original_name}"`);
      return res.send(file_content);
    }
    if (file_path && fs.existsSync(file_path)) {
      res.set("Content-Type", mime || "application/octet-stream");
      res.set("Content-Disposition", `inline; filename="${original_name}"`);
      return res.sendFile(path.resolve(file_path));
    }
    res.status(404).json({ ok: false, error: "No file" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// DELETE /api/vsd/files/:id
app.delete("/api/vsd/files/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    await pool.query(`DELETE FROM vsd_files WHERE id=$1`, [id]);
    await logEvent("vsd_file_deleted", { file_id: id }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// -------------------------------------------------
// MAPS (Plans PDF)
// -------------------------------------------------
// POST /api/vsd/maps/uploadZip
app.post("/api/vsd/maps/uploadZip", multerZip.single("zip"), async (req, res) => {
  try {
    const u = getUser(req);
    if (!req.file) return res.status(400).json({ ok: false, error: "No zip file" });
    const zipPath = req.file.path;
    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();
    const pdfs = Object.values(entries).filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith(".pdf"));
    const imported = [];
    for (const e of pdfs) {
      const buf = await zip.entryData(e);
      const base = path.basename(e.name, ".pdf");
      const logical = base.replace(/[^\w-]+/g, "_");
      const dest = path.join(MAPS_DIR, `${Date.now()}_${base}.pdf`);
      await fsp.writeFile(dest, buf);
      const { rows: existing } = await pool.query(
        `SELECT id, version FROM vsd_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
        [logical]
      );
      const nextVer = existing[0] ? existing[0].version + 1 : 1;
      const { rows } = await pool.query(
        `INSERT INTO vsd_plans(logical_name, version, filename, file_path, content, page_count)
         VALUES($1,$2,$3,$4,$5,1) RETURNING *`,
        [logical, nextVer, e.name, dest, buf]
      );
      await pool.query(
        `INSERT INTO vsd_plan_names(logical_name, display_name)
         VALUES($1,$2)
         ON CONFLICT(logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
        [logical, base]
      );
      imported.push(rows[0]);
    }
    await zip.close();
    await logEvent("vsd_maps_zip_uploaded", { count: imported.length }, u);
    res.json({ ok: true, imported });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/maps/listPlans
app.get("/api/vsd/maps/listPlans", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id, p.logical_name, p.version, p.filename, p.page_count,
             COALESCE(pn.display_name, p.logical_name) AS display_name
        FROM vsd_plans p
        LEFT JOIN vsd_plan_names pn ON pn.logical_name=p.logical_name
       ORDER BY p.logical_name, p.version DESC
    `);
    res.json({ ok: true, plans: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/maps/planFile
app.get("/api/vsd/maps/planFile", async (req, res) => {
  try {
    const { logical_name, id } = req.query;
    let q = `SELECT file_path, content, filename FROM vsd_plans WHERE `;
    let val;
    if (id) {
      q += `id=$1`;
      val = String(id);
    } else if (logical_name) {
      q += `logical_name=$1 ORDER BY version DESC LIMIT 1`;
      val = String(logical_name);
    } else {
      return res.status(400).json({ ok: false, error: "id or logical_name required" });
    }
    const { rows } = await pool.query(q, [val]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Plan not found" });
    const { content, file_path, filename } = rows[0];
    if (content && content.length) {
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `inline; filename="${filename || "plan.pdf"}"`);
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(content);
    }
    if (file_path && fs.existsSync(file_path)) {
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `inline; filename="${filename || "plan.pdf"}"`);
      res.set("Cache-Control", "public, max-age=3600");
      return res.sendFile(path.resolve(file_path));
    }
    res.status(404).json({ ok: false, error: "No file" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// PUT /api/vsd/maps/renamePlan
app.put("/api/vsd/maps/renamePlan", async (req, res) => {
  try {
    const u = getUser(req);
    const { logical_name, display_name } = req.body || {};
    if (!logical_name) return res.status(400).json({ ok: false, error: "logical_name required" });
    await pool.query(
      `INSERT INTO vsd_plan_names(logical_name, display_name)
       VALUES($1,$2)
       ON CONFLICT(logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [logical_name, display_name || ""]
    );
    await logEvent("vsd_plan_renamed", { logical_name, display_name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// GET /api/vsd/maps/positions
app.get("/api/vsd/maps/positions", async (req, res) => {
  try {
    const { logical_name, id, page_index = 0 } = req.query;
    if (!logical_name && !id) return res.status(400).json({ ok: false, error: "logical_name or id required" });
    let planKey = logical_name;
    if (id) {
      const { rows: pRows } = await pool.query(`SELECT logical_name FROM vsd_plans WHERE id=$1`, [String(id)]);
      if (pRows[0]) planKey = pRows[0].logical_name;
    }
    const { rows } = await pool.query(
      `SELECT pos.equipment_id, pos.x_frac, pos.y_frac,
              e.name, e.status, e.next_check_date, e.building, e.zone, e.floor, e.location
         FROM vsd_positions pos
         JOIN vsd_equipments e ON e.id=pos.equipment_id
        WHERE pos.logical_name=$1 AND pos.page_index=$2`,
      [planKey, Number(page_index)]
    );
    for (const r of rows) {
      r.status = eqStatusFromDue(r.next_check_date);
    }
    res.json({ ok: true, positions: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// POST /api/vsd/maps/setPosition
app.post("/api/vsd/maps/setPosition", async (req, res) => {
  try {
    const u = getUser(req);
    const {
      equipment_id,
      logical_name,
      plan_id = null,
      page_index = 0,
      x_frac,
      y_frac,
    } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }
    await pool.query(
      `INSERT INTO vsd_positions(equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(equipment_id, logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac, plan_id=EXCLUDED.plan_id`,
      [equipment_id, logical_name, plan_id, Number(page_index), Number(x_frac), Number(y_frac)]
    );
    await pool.query(
      `UPDATE vsd_equipments SET equipment=$1 WHERE id=$2`,
      [logical_name, equipment_id]
    );
    await logEvent("vsd_position_set", { equipment_id, logical_name, page_index }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/vsd/maps/placed-ids - Get all equipment IDs that have placements
app.get("/api/vsd/maps/placed-ids", async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req, { tableAlias: 'e' });
    if (role === 'site' && !siteName) return res.status(400).json({ ok: false, error: 'Missing site (X-Site header)' });

    const { rows } = await pool.query(`
      SELECT DISTINCT pos.equipment_id,
             array_agg(DISTINCT pos.logical_name) as plans
        FROM vsd_positions pos
        JOIN vsd_equipments e ON e.id = pos.equipment_id
       ${siteWhere ? `WHERE ${siteWhere}` : ''}
       GROUP BY pos.equipment_id
    `, siteParams);

    const placed_ids = rows.map(r => r.equipment_id);
    const placed_details = {};
    rows.forEach(r => {
      placed_details[r.equipment_id] = { plans: r.plans || [] };
    });

    res.json({ ok: true, placed_ids, placed_details });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// IA (OpenAI)
// -------------------------------------------------
function openaiClient() {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_VSD;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// POST /api/vsd/analyzePhotoBatch
app.post("/api/vsd/analyzePhotoBatch", multerFiles.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    const extracted = await vsdExtractFromFiles(client, req.files || []);
    res.json({ ok: true, extracted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// POST /api/vsd/extract
app.post("/api/vsd/extract", multerFiles.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    const extracted = await vsdExtractFromFiles(client, req.files || []);
    res.json({ ok: true, extracted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// -------------------------------------------------
// REPORT PDF GENERATION - Professional VSD Report
// -------------------------------------------------
app.get("/report", async (req, res) => {
  try {
    const site = req.headers["x-site"] || "Default";
    const { building, floor, search, from_date, to_date } = req.query;

    // Build query with filters
    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (building) { where += ` AND e.building = $${idx++}`; params.push(building); }
    if (floor) { where += ` AND e.floor = $${idx++}`; params.push(floor); }
    if (search) { where += ` AND (e.name ILIKE $${idx} OR e.manufacturer_ref ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (from_date) { where += ` AND e.created_at >= $${idx++}`; params.push(from_date); }
    if (to_date) { where += ` AND e.created_at <= $${idx++}`; params.push(to_date); }

    // Get equipments with checks and last result
    const { rows: equipments } = await pool.query(`
      SELECT e.*,
             (SELECT COUNT(*) FROM vsd_checks c WHERE c.equipment_id = e.id) as check_count,
             (SELECT MAX(c.date) FROM vsd_checks c WHERE c.equipment_id = e.id) as last_check,
             (SELECT c.result FROM vsd_checks c WHERE c.equipment_id = e.id AND c.status = 'fait' ORDER BY c.date DESC LIMIT 1) as last_result
        FROM vsd_equipments e
        ${where}
       ORDER BY e.building, e.floor, e.name
    `, params);

    // Get positions for equipment cards
    const { rows: positions } = await pool.query(`
      SELECT p.*, pn.display_name as plan_display_name
        FROM vsd_positions p
        LEFT JOIN vsd_plan_names pn ON pn.logical_name = p.logical_name
    `);
    const positionsMap = new Map();
    positions.forEach(p => positionsMap.set(p.equipment_id, p));

    // Get plans list
    const { rows: plans } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name) p.*, pn.display_name
        FROM vsd_plans p
        LEFT JOIN vsd_plan_names pn ON pn.logical_name = p.logical_name
       ORDER BY p.logical_name, p.version DESC
    `);

    // Statistics
    const totalCount = equipments.length;
    const withChecks = equipments.filter(e => e.check_count > 0).length;
    const conformeCount = equipments.filter(e => e.last_result === 'conforme').length;
    const nonConformeCount = equipments.filter(e => e.last_result === 'non_conforme').length;
    const naCount = totalCount - conformeCount - nonConformeCount;
    const now = new Date();
    const retardCount = equipments.filter(e => e.next_check_date && new Date(e.next_check_date) < now).length;

    // Group by building
    const byBuilding = {};
    equipments.forEach(eq => {
      const b = eq.building || 'Non defini';
      if (!byBuilding[b]) byBuilding[b] = [];
      byBuilding[b].push(eq);
    });

    // Colors
    const colors = {
      primary: '#7c3aed',    // Purple for VSD
      success: '#059669',
      danger: '#dc2626',
      warning: '#d97706',
      muted: '#6b7280',
      text: '#374151',
      light: '#f3f4f6'
    };

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport_vsd_${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // ========== PAGE DE COUVERTURE ==========
    doc.rect(0, 0, 595, 842).fill('#faf5ff');
    doc.rect(0, 0, 595, 180).fill(colors.primary);

    doc.fontSize(32).fillColor('#fff').text('RAPPORT VSD', 50, 70, { align: 'center', width: 495 });
    doc.fontSize(14).text('Variateurs de Frequence', 50, 115, { align: 'center', width: 495 });

    doc.fontSize(16).fillColor(colors.text).text(site, 50, 220, { align: 'center', width: 495 });
    doc.fontSize(11).fillColor(colors.muted).text(`Genere le ${new Date().toLocaleDateString('fr-FR')}`, 50, 250, { align: 'center', width: 495 });

    // Synthèse sur la couverture
    let coverY = 320;
    doc.fontSize(14).fillColor(colors.primary).text('Synthese', 50, coverY);
    coverY += 30;

    const coverStats = [
      { label: 'Total equipements VSD', value: totalCount },
      { label: 'Equipements controles', value: withChecks },
      { label: 'Conformes', value: conformeCount, color: colors.success },
      { label: 'Non conformes', value: nonConformeCount, color: colors.danger },
      { label: 'En retard de verification', value: retardCount, color: colors.warning },
    ];

    coverStats.forEach(stat => {
      doc.rect(50, coverY, 495, 35).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(11).fillColor(colors.text).text(stat.label, 70, coverY + 10);
      doc.fontSize(14).fillColor(stat.color || colors.primary).text(String(stat.value), 480, coverY + 10, { align: 'right', width: 50 });
      coverY += 40;
    });

    // ========== SOMMAIRE ==========
    doc.addPage();
    doc.rect(0, 0, 595, 842).fill('#fff');
    doc.fontSize(24).fillColor(colors.primary).text('Sommaire', 50, 50);
    doc.moveTo(50, 85).lineTo(545, 85).strokeColor(colors.primary).lineWidth(2).stroke();

    const sommaire = [
      { num: '1', title: 'Cadre reglementaire', page: 3 },
      { num: '2', title: 'Presentation du site', page: 3 },
      { num: '3', title: 'Liste des plans', page: 4 },
      { num: '4', title: 'Inventaire des variateurs', page: 4 },
      { num: '5', title: 'Etat de conformite', page: 5 },
      { num: '6', title: 'Planification des controles', page: 6 },
      { num: '7', title: 'Recommandations techniques', page: 7 },
      { num: '8', title: 'Fiches equipements', page: 8 },
    ];

    let somY = 110;
    sommaire.forEach(item => {
      doc.fontSize(12).fillColor(colors.text).text(`${item.num}. ${item.title}`, 70, somY);
      doc.fillColor(colors.muted).text(`.....................................................`, 280, somY, { width: 200 });
      doc.fillColor(colors.primary).text(String(item.page), 500, somY, { align: 'right', width: 30 });
      somY += 28;
    });

    // ========== 1. CADRE RÉGLEMENTAIRE ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('1. Cadre reglementaire', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let regY = 100;
    doc.fontSize(11).fillColor(colors.text)
       .text('La maintenance des variateurs de frequence est encadree par les normes et reglementations suisses suivantes:', 50, regY, { width: 495 });
    regY += 40;

    const reglements = [
      { title: 'NIBT (Norme d\'installation basse tension)', desc: 'Regles relatives a l\'installation et la maintenance des equipements electriques basse tension.' },
      { title: 'OIBT (Ordonnance installations basse tension)', desc: 'Prescriptions legales pour les installations electriques a basse tension en Suisse.' },
      { title: 'IEC 61800', desc: 'Norme internationale pour les entrainements electriques de puissance a vitesse variable - Exigences de securite.' },
      { title: 'EN 61000 (CEM)', desc: 'Compatibilite electromagnetique - Limites d\'emission et immunite des variateurs.' },
      { title: 'Directive Machines 2006/42/CE', desc: 'Exigences de securite pour les machines integrant des variateurs de frequence.' },
    ];

    reglements.forEach(reg => {
      if (regY > 700) { doc.addPage(); regY = 50; }
      doc.rect(50, regY, 495, 50).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(11).fillColor(colors.primary).text(reg.title, 60, regY + 8, { width: 475 });
      doc.fontSize(9).fillColor(colors.muted).text(reg.desc, 60, regY + 26, { width: 475 });
      regY += 55;
    });

    // ========== 2. PRÉSENTATION DU SITE ==========
    regY += 20;
    if (regY > 600) { doc.addPage(); regY = 50; }
    doc.fontSize(20).fillColor(colors.primary).text('2. Presentation du site', 50, regY);
    doc.moveTo(50, regY + 30).lineTo(545, regY + 30).strokeColor(colors.primary).lineWidth(1).stroke();
    regY += 50;

    doc.fontSize(11).fillColor(colors.text)
       .text(`Site: ${site}`, 50, regY);
    regY += 20;
    doc.text(`Nombre de batiments avec VSD: ${Object.keys(byBuilding).length}`, 50, regY);
    regY += 20;
    doc.text(`Total variateurs: ${totalCount}`, 50, regY);
    regY += 20;
    doc.text(`Plans de localisation: ${plans.length}`, 50, regY);

    // ========== 3. LISTE DES PLANS ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('3. Liste des plans VSD', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let planListY = 100;
    if (plans.length === 0) {
      doc.fontSize(11).fillColor(colors.muted).text('Aucun plan disponible.', 50, planListY);
    } else {
      doc.fontSize(9).fillColor(colors.muted)
         .text('Les plans avec localisation des variateurs sont affiches dans les fiches equipements (section 8).', 50, planListY);
      planListY += 25;

      plans.forEach((p, idx) => {
        if (planListY > 750) { doc.addPage(); planListY = 50; }
        doc.rect(50, planListY, 495, 25).fillAndStroke(idx % 2 === 0 ? colors.light : '#fff', '#e5e7eb');
        doc.fontSize(9).fillColor(colors.text)
           .text(`${idx + 1}. ${p.display_name || p.logical_name}`, 60, planListY + 7);
        planListY += 25;
      });
    }

    // ========== 4. INVENTAIRE DES VARIATEURS ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('4. Inventaire des variateurs', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let invY = 100;
    doc.fontSize(11).fillColor(colors.text)
       .text(`${totalCount} variateur(s) inventorie(s).`, 50, invY);
    invY += 35;

    // Table by building
    const invHeaders = ['Batiment', 'Etage', 'Nb VSD', 'Conformes', 'Non conf.'];
    const invColW = [140, 100, 80, 90, 85];
    let x = 50;
    invHeaders.forEach((h, i) => {
      doc.rect(x, invY, invColW[i], 22).fillAndStroke(colors.primary, colors.primary);
      doc.fontSize(9).fillColor('#fff').text(h, x + 5, invY + 6, { width: invColW[i] - 10 });
      x += invColW[i];
    });
    invY += 22;

    Object.entries(byBuilding).forEach(([bat, eqs]) => {
      // Group by floor within building
      const byFloor = {};
      eqs.forEach(eq => {
        const f = eq.floor || '-';
        if (!byFloor[f]) byFloor[f] = [];
        byFloor[f].push(eq);
      });

      Object.entries(byFloor).forEach(([flr, flrEqs]) => {
        if (invY > 750) {
          doc.addPage();
          invY = 50;
          x = 50;
          invHeaders.forEach((h, i) => {
            doc.rect(x, invY, invColW[i], 22).fillAndStroke(colors.primary, colors.primary);
            doc.fontSize(9).fillColor('#fff').text(h, x + 5, invY + 6, { width: invColW[i] - 10 });
            x += invColW[i];
          });
          invY += 22;
        }
        const conf = flrEqs.filter(e => e.last_result === 'conforme').length;
        const nonConf = flrEqs.filter(e => e.last_result === 'non_conforme').length;
        const row = [bat.substring(0, 28), flr.substring(0, 18), flrEqs.length, conf, nonConf];
        x = 50;
        row.forEach((cell, i) => {
          doc.rect(x, invY, invColW[i], 20).fillAndStroke('#fff', '#e5e7eb');
          let txtCol = colors.text;
          if (i === 4 && cell > 0) txtCol = colors.danger;
          if (i === 3 && cell > 0) txtCol = colors.success;
          doc.fontSize(8).fillColor(txtCol).text(String(cell), x + 5, invY + 5, { width: invColW[i] - 10 });
          x += invColW[i];
        });
        invY += 20;
      });
    });

    // ========== 5. ÉTAT DE CONFORMITÉ ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('5. Etat de conformite', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let confY = 100;
    const confStats = [
      { label: 'Conformes', count: conformeCount, color: colors.success, pct: totalCount ? Math.round(conformeCount / totalCount * 100) : 0 },
      { label: 'Non conformes', count: nonConformeCount, color: colors.danger, pct: totalCount ? Math.round(nonConformeCount / totalCount * 100) : 0 },
      { label: 'Non verifies', count: naCount, color: colors.muted, pct: totalCount ? Math.round(naCount / totalCount * 100) : 0 },
      { label: 'Verification en retard', count: retardCount, color: colors.warning, pct: totalCount ? Math.round(retardCount / totalCount * 100) : 0 },
    ];

    confStats.forEach(stat => {
      doc.rect(50, confY, 495, 40).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(11).fillColor(stat.color).text(stat.label, 60, confY + 8);
      doc.fontSize(9).fillColor(colors.muted).text(`${stat.count} equipement(s)`, 60, confY + 23);
      doc.rect(300, confY + 15, 180, 12).fillAndStroke(colors.light, '#d1d5db');
      if (stat.pct > 0) {
        doc.rect(300, confY + 15, Math.max(5, 180 * stat.pct / 100), 12).fill(stat.color);
      }
      doc.fontSize(10).fillColor(stat.color).text(`${stat.pct}%`, 490, confY + 13, { align: 'right', width: 40 });
      confY += 45;
    });

    // Non conformes list
    confY += 20;
    const nonConformes = equipments.filter(e => e.last_result === 'non_conforme');
    if (nonConformes.length > 0) {
      doc.fontSize(12).fillColor(colors.danger).text('/!\\ Variateurs non conformes', 50, confY);
      confY += 25;

      nonConformes.forEach(eq => {
        if (confY > 750) { doc.addPage(); confY = 50; }
        doc.rect(50, confY, 495, 30).fillAndStroke('#fef2f2', '#fca5a5');
        doc.fontSize(9).fillColor(colors.danger).text(eq.name || 'Variateur sans nom', 60, confY + 6);
        doc.fontSize(8).fillColor(colors.muted)
           .text(`${eq.building || '-'} | ${eq.floor || '-'} | ${eq.manufacturer || '-'} ${eq.manufacturer_ref || ''}`, 60, confY + 17);
        confY += 35;
      });
    }

    // ========== 6. PLANIFICATION ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('6. Planification des controles', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let planY = 100;
    doc.fontSize(11).fillColor(colors.text)
       .text('Les variateurs font l\'objet de controles periodiques conformement aux normes IEC 61800 et aux recommandations constructeurs.', 50, planY, { width: 495 });
    planY += 40;

    const upcoming = equipments
      .filter(e => e.next_check_date)
      .sort((a, b) => new Date(a.next_check_date) - new Date(b.next_check_date));

    if (upcoming.length > 0) {
      doc.fontSize(12).fillColor(colors.primary).text('Prochains controles', 50, planY);
      planY += 25;

      const planHeaders = ['Variateur', 'Batiment', 'Etage', 'Date ctrl', 'Statut'];
      const planColW = [180, 100, 70, 85, 60];
      x = 50;
      planHeaders.forEach((h, i) => {
        doc.rect(x, planY, planColW[i], 20).fillAndStroke(colors.primary, colors.primary);
        doc.fontSize(8).fillColor('#fff').text(h, x + 4, planY + 5, { width: planColW[i] - 8 });
        x += planColW[i];
      });
      planY += 20;

      upcoming.slice(0, 30).forEach(eq => {
        if (planY > 750) {
          doc.addPage();
          planY = 50;
          x = 50;
          planHeaders.forEach((h, i) => {
            doc.rect(x, planY, planColW[i], 20).fillAndStroke(colors.primary, colors.primary);
            doc.fontSize(8).fillColor('#fff').text(h, x + 4, planY + 5, { width: planColW[i] - 8 });
            x += planColW[i];
          });
          planY += 20;
        }
        const nextDate = new Date(eq.next_check_date);
        const isLate = nextDate < now;
        const isClose = !isLate && (nextDate - now) / (1000 * 60 * 60 * 24) < 90;
        const statusColor = isLate ? colors.danger : (isClose ? colors.warning : colors.success);
        const statusText = isLate ? 'RETARD' : (isClose ? 'PROCHE' : 'OK');

        const row = [
          (eq.name || '-').substring(0, 35),
          (eq.building || '-').substring(0, 18),
          (eq.floor || '-').substring(0, 12),
          nextDate.toLocaleDateString('fr-FR'),
          statusText
        ];
        x = 50;
        row.forEach((cell, i) => {
          doc.rect(x, planY, planColW[i], 18).fillAndStroke('#fff', '#e5e7eb');
          const col = i === 4 ? statusColor : colors.text;
          doc.fontSize(7).fillColor(col).text(String(cell), x + 4, planY + 5, { width: planColW[i] - 8 });
          x += planColW[i];
        });
        planY += 18;
      });
    }

    // ========== 7. RECOMMANDATIONS TECHNIQUES ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('7. Recommandations techniques', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let recY = 100;
    const recommandations = [
      { title: 'Maintenance preventive', items: [
        'Nettoyage regulier des filtres et ventilateurs',
        'Verification des connexions electriques (serrage)',
        'Controle de la temperature ambiante et du variateur',
        'Surveillance des alarmes et codes d\'erreur',
      ]},
      { title: 'Controles periodiques', items: [
        'Test de fonctionnement demarrage/arret',
        'Verification des parametres de configuration',
        'Mesure des courants et tensions',
        'Controle de l\'isolation electrique',
      ]},
      { title: 'Bonnes pratiques', items: [
        'Conserver les documents techniques et manuels',
        'Former le personnel a l\'utilisation des variateurs',
        'Maintenir un stock de pieces de rechange critiques',
        'Documenter les interventions et modifications',
      ]},
    ];

    recommandations.forEach(section => {
      if (recY > 650) { doc.addPage(); recY = 50; }
      doc.fontSize(12).fillColor(colors.primary).text(section.title, 50, recY);
      recY += 22;
      section.items.forEach(item => {
        doc.fontSize(10).fillColor(colors.text).text(`- ${item}`, 70, recY, { width: 475 });
        recY += 18;
      });
      recY += 15;
    });

    // ========== 8. FICHES ÉQUIPEMENTS ==========
    if (equipments.length > 0) {
      doc.addPage();
      doc.fontSize(20).fillColor(colors.primary).text('8. Fiches equipements', 50, 50);
      doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

      let ficheY = 100;
      doc.fontSize(11).fillColor(colors.muted).text(`${equipments.length} variateur(s) VSD`, 50, ficheY);
      ficheY += 30;

      for (let i = 0; i < equipments.length; i++) {
        const eq = equipments[i];
        const position = positionsMap.get(eq.id);

        if (ficheY > 500) {
          doc.addPage();
          ficheY = 50;
        }

        // Card frame
        doc.rect(50, ficheY, 495, 280).stroke(colors.light);

        // Header with name
        doc.rect(50, ficheY, 495, 35).fill(colors.primary);
        doc.fontSize(12).fillColor('#fff')
           .text(eq.name || 'Variateur sans nom', 60, ficheY + 10, { width: 380 });

        // Status badge
        const statusLabel = eq.last_result === 'conforme' ? 'CONFORME' : (eq.last_result === 'non_conforme' ? 'NON CONFORME' : 'A VERIFIER');
        const statusBg = eq.last_result === 'conforme' ? colors.success : (eq.last_result === 'non_conforme' ? colors.danger : colors.warning);
        doc.fontSize(8).fillColor(statusBg)
           .text(statusLabel, 450, ficheY + 13, { width: 80, align: 'right' });

        let infoY = ficheY + 45;
        const infoX = 60;
        const rightColX = 310;
        const imgWidth = 100;
        const imgHeight = 100;

        // Photo on right
        if (eq.photo_content && eq.photo_content.length > 0) {
          try {
            doc.image(eq.photo_content, rightColX, infoY, { fit: [imgWidth, imgHeight], align: 'center' });
            doc.rect(rightColX, infoY, imgWidth, imgHeight).stroke('#e5e7eb');
          } catch {
            doc.rect(rightColX, infoY, imgWidth, imgHeight).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Photo N/A', rightColX + 30, infoY + 45);
          }
        } else {
          doc.rect(rightColX, infoY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Pas de photo', rightColX + 25, infoY + 45);
        }

        // Plan thumbnail placeholder
        const planX = rightColX + imgWidth + 10;
        if (position) {
          doc.rect(planX, infoY, imgWidth, imgHeight).stroke(colors.primary);
          doc.fontSize(7).fillColor(colors.muted)
             .text(position.plan_display_name || 'Plan', planX + 10, infoY + 45, { width: imgWidth - 20, align: 'center' });
        } else {
          doc.rect(planX, infoY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Non positionne', planX + 20, infoY + 45);
        }

        // Equipment info fields
        const vsdInfo = [
          ['Tag', eq.tag || '-'],
          ['Fabricant', eq.manufacturer || '-'],
          ['Modele', eq.model || '-'],
          ['Reference', eq.manufacturer_ref || '-'],
          ['N° Serie', eq.serial_number || '-'],
          ['Puissance', eq.power_kw ? `${eq.power_kw} kW` : '-'],
          ['Tension', eq.voltage || '-'],
          ['Courant', eq.current_nominal ? `${eq.current_nominal} A` : '-'],
          ['IP', eq.ip_rating || '-'],
          ['Protocole', eq.protocol || '-'],
          ['Batiment', eq.building || '-'],
          ['Etage', eq.floor || '-'],
          ['Panneau', eq.panel || '-'],
          ['Criticite', eq.criticality || '-'],
          ['Dernier ctrl', eq.last_check ? new Date(eq.last_check).toLocaleDateString('fr-FR') : '-'],
          ['Prochain ctrl', eq.next_check_date ? new Date(eq.next_check_date).toLocaleDateString('fr-FR') : '-'],
        ];

        vsdInfo.forEach(([label, value]) => {
          doc.fontSize(8).fillColor(colors.text).text(label + ':', infoX, infoY, { width: 70 });
          doc.fillColor(colors.muted).text(value, infoX + 72, infoY, { width: 165 });
          infoY += 14;
        });

        // Legend
        doc.fontSize(6).fillColor(colors.muted)
           .text('Photo equipement', rightColX, infoY - 10, { width: imgWidth, align: 'center' });

        ficheY += 290;
      }
    }

    // ========== PAGE NUMBERING ==========
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Rapport VSD - ${site} - Page ${i + 1}/${range.count}`, 50, 810, { align: 'center', width: 495 });
    }

    doc.end();
    console.log(`[VSD] Generated professional PDF with ${totalCount} equipments`);

  } catch (e) {
    console.error('[VSD] Report error:', e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[vsd] listening on ${HOST}:${PORT}`);
});
