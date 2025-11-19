// ==============================
// server_vsd.js — VSD (Variateurs de Fréquence) CMMS microservice (ESM)
// Port par défaut: 3020
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
      
      -- NOUVEAUX CHAMPS D'EXPLOITATION/UI (Ajoutés pour persistance)
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
    
    -- AJOUT DES COLONNES MANQUANTES (pour les DB existantes après ALTER TABLE)
    DO $$ BEGIN
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
        ))),
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
    const { rows } = await pool.query(`
      SELECT e.*,
             (SELECT result FROM vsd_checks c
              WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
              ORDER BY c.date DESC NULLS LAST
              LIMIT 1) AS last_result
        FROM vsd_equipments e
       ORDER BY e.name
    `);
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
         name, building, zone, equipment, sub_equipment, type,
         manufacturer, manufacturer_ref, power_kw, voltage, 
         current_nominal, ip_rating, comment,
         installed_at, next_check_date,
         tag, model, serial_number, ip_address, protocol, floor, panel, location, criticality, ui_status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [
        name, building, zone, equipment, sub_equipment, type,
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
         ON CONFLICT(logical_name) DO UPDATE SET display_name=$2`, // Fix: ensure display name updates
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
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[vsd] listening on ${HOST}:${PORT}`);
});
