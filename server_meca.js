// ==============================
// server_meca.js — Microservice Maintenance Mécanique (Port 3021)
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
const { OpenAI } = await import("openai");

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.MECA_PORT || 3021);
const HOST = process.env.MECA_HOST || "0.0.0.0";

// Dossiers data
const DATA_DIR = process.env.MECA_DATA_DIR || path.resolve(__dirname, "./_data_meca");
const FILES_DIR = path.join(DATA_DIR, "files");
const MAPS_INCOMING_DIR = path.join(DATA_DIR, "maps_incoming");
const MAPS_DIR = path.join(DATA_DIR, "maps");

for (const d of [DATA_DIR, FILES_DIR, MAPS_DIR, MAPS_INCOMING_DIR]) {
  await fsp.mkdir(d, { recursive: true });
}

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(cors({ origin: true, credentials: true, exposedHeaders: ["Content-Disposition"] }));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

function getUser(req) {
  return { name: req.header("X-User-Name"), email: req.header("X-User-Email") };
}

const multerFiles = multer({ dest: FILES_DIR, limits: { fileSize: 50 * 1024 * 1024 } });
const multerZip = multer({ dest: MAPS_INCOMING_DIR, limits: { fileSize: 300 * 1024 * 1024 } });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.MECA_DATABASE_URL || process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres",
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  
  // Table Équipements Mécaniques
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      location TEXT DEFAULT '',
      
      -- Champs Spécifiques Méca
      device_type TEXT DEFAULT '',    -- ex: Pompe, Ventilateur
      fluid_type TEXT DEFAULT '',     -- ex: Eau Glacée, Huile
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      tag TEXT DEFAULT '',
      year_of_manufacture TEXT DEFAULT '',
      power_kw NUMERIC DEFAULT NULL,
      
      comment TEXT DEFAULT '',
      criticality TEXT DEFAULT '',
      ui_status TEXT DEFAULT '',
      status TEXT DEFAULT 'a_faire',
      
      installed_at TIMESTAMP NULL,
      next_check_date DATE NULL,
      
      photo_path TEXT DEFAULT NULL,
      photo_content BYTEA NULL,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);

  // Tables annexes (identiques structurellement à VSD mais préfixe meca_)
  await pool.query(`CREATE TABLE IF NOT EXISTS meca_files (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), equipment_id UUID REFERENCES meca_equipments(id) ON DELETE CASCADE, original_name TEXT, mime TEXT, file_path TEXT, file_content BYTEA, uploaded_at TIMESTAMP DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS meca_plans (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), logical_name TEXT, version INTEGER DEFAULT 1, filename TEXT, file_path TEXT, page_count INTEGER DEFAULT 1, content BYTEA)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS meca_plan_names (logical_name TEXT PRIMARY KEY, display_name TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS meca_positions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), equipment_id UUID REFERENCES meca_equipments(id) ON DELETE CASCADE, logical_name TEXT, plan_id UUID, page_index INTEGER DEFAULT 0, x_frac NUMERIC, y_frac NUMERIC, UNIQUE(equipment_id, logical_name, page_index))`);
  
  // Settings défaut
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_settings (id INTEGER PRIMARY KEY DEFAULT 1, frequency TEXT DEFAULT '12_mois');
    INSERT INTO meca_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);
}

// --- Routes API ---

// LISTE
app.get("/api/meca/equipments", async (req, res) => {
  try {
    const { q, building, floor, zone } = req.query;
    let sql = `SELECT * FROM meca_equipments WHERE 1=1`;
    const vals = [];
    let idx = 1;
    
    if (building) { sql += ` AND building ILIKE $${idx++}`; vals.push(`%${building}%`); }
    if (floor) { sql += ` AND floor ILIKE $${idx++}`; vals.push(`%${floor}%`); }
    if (zone) { sql += ` AND zone ILIKE $${idx++}`; vals.push(`%${zone}%`); }
    if (q) {
      sql += ` AND (name ILIKE $${idx} OR tag ILIKE $${idx} OR manufacturer ILIKE $${idx} OR device_type ILIKE $${idx})`;
      vals.push(`%${q}%`);
      idx++;
    }
    sql += ` ORDER BY building, name`;
    
    const { rows } = await pool.query(sql, vals);
    // Ajout URL photo
    for (const r of rows) {
      r.photo_url = (r.photo_content || r.photo_path) ? `/api/meca/equipments/${r.id}/photo` : null;
    }
    res.json({ ok: true, equipments: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CRUD
app.get("/api/meca/equipments/:id", async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM meca_equipments WHERE id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ ok: false });
  rows[0].photo_url = (rows[0].photo_content || rows[0].photo_path) ? `/api/meca/equipments/${rows[0].id}/photo` : null;
  res.json({ ok: true, equipment: rows[0] });
});

app.post("/api/meca/equipments", async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(`
    INSERT INTO meca_equipments(
      name, building, zone, floor, location,
      device_type, fluid_type, manufacturer, model, serial_number, tag, year_of_manufacture, power_kw,
      comment, criticality, ui_status
    ) VALUES($1,$2,$3,$4,$5, $6,$7,$8,$9,$10,$11,$12,$13, $14,$15,$16) RETURNING *
  `, [
    b.name||"", b.building||"", b.zone||"", b.floor||"", b.location||"",
    b.device_type||"", b.fluid_type||"", b.manufacturer||"", b.model||"", b.serial_number||"", b.tag||"", b.year_of_manufacture||"", b.power_kw||null,
    b.comment||"", b.criticality||"", b.ui_status||""
  ]);
  res.json({ ok: true, equipment: rows[0] });
});

app.put("/api/meca/equipments/:id", async (req, res) => {
  const b = req.body;
  // Update dynamique simple
  const updates = [];
  const vals = [];
  let idx = 1;
  const keys = ["name", "building", "zone", "floor", "location", "device_type", "fluid_type", "manufacturer", "model", "serial_number", "tag", "year_of_manufacture", "power_kw", "comment", "criticality", "ui_status"];
  
  for(const k of keys) {
    if(b[k] !== undefined) { updates.push(`${k}=$${idx++}`); vals.push(b[k]); }
  }
  updates.push(`updated_at=now()`);
  vals.push(req.params.id);
  
  await pool.query(`UPDATE meca_equipments SET ${updates.join(", ")} WHERE id=$${idx}`, vals);
  const { rows } = await pool.query(`SELECT * FROM meca_equipments WHERE id=$1`, [req.params.id]);
  res.json({ ok: true, equipment: rows[0] });
});

app.delete("/api/meca/equipments/:id", async (req, res) => {
  await pool.query(`DELETE FROM meca_equipments WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// PHOTOS
app.post("/api/meca/equipments/:id/photo", multerFiles.single("photo"), async (req, res) => {
  const buf = await fsp.readFile(req.file.path);
  await pool.query(`UPDATE meca_equipments SET photo_content=$1, photo_path=$2 WHERE id=$3`, [buf, req.file.path, req.params.id]);
  res.json({ ok: true });
});

app.get("/api/meca/equipments/:id/photo", async (req, res) => {
  const { rows } = await pool.query(`SELECT photo_content FROM meca_equipments WHERE id=$1`, [req.params.id]);
  if (rows[0]?.photo_content) {
    res.set("Content-Type", "image/jpeg");
    res.send(rows[0].photo_content);
  } else res.status(404).send();
});

// FICHIERS
app.get("/api/meca/files", async (req, res) => {
  const { rows } = await pool.query(`SELECT id, original_name, uploaded_at FROM meca_files WHERE equipment_id=$1 ORDER BY uploaded_at DESC`, [req.query.equipment_id]);
  res.json({ ok: true, files: rows.map(f => ({...f, url: `/api/meca/files/${f.id}`})) });
});

app.post("/api/meca/files", multerFiles.array("files"), async (req, res) => {
  const eqId = req.body.equipment_id;
  for(const f of req.files) {
    const buf = await fsp.readFile(f.path);
    await pool.query(`INSERT INTO meca_files(equipment_id, original_name, mime, file_path, file_content) VALUES($1,$2,$3,$4,$5)`, [eqId, f.originalname, f.mimetype, f.path, buf]);
  }
  res.json({ ok: true });
});

app.get("/api/meca/files/:id", async (req, res) => {
  const { rows } = await pool.query(`SELECT file_content, mime FROM meca_files WHERE id=$1`, [req.params.id]);
  if(rows[0]) {
    res.set("Content-Type", rows[0].mime);
    res.send(rows[0].file_content);
  } else res.status(404).send();
});

app.delete("/api/meca/files/:id", async (req, res) => {
  await pool.query(`DELETE FROM meca_files WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// PLANS & POSITIONS
app.get("/api/meca/maps/listPlans", async (req, res) => {
  const { rows } = await pool.query(`SELECT DISTINCT ON (p.logical_name) p.id, p.logical_name, COALESCE(pn.display_name, p.logical_name) as display_name FROM meca_plans p LEFT JOIN meca_plan_names pn ON pn.logical_name=p.logical_name ORDER BY p.logical_name, p.version DESC`);
  res.json({ ok: true, plans: rows });
});

app.post("/api/meca/maps/uploadZip", multerZip.single("zip"), async (req, res) => {
  const zip = new StreamZip.async({ file: req.file.path });
  const entries = await zip.entries();
  for (const e of Object.values(entries)) {
    if (e.name.toLowerCase().endsWith(".pdf")) {
      const buf = await zip.entryData(e);
      const base = path.basename(e.name, ".pdf");
      const logical = base.replace(/[^\w-]+/g, "_");
      const {rows:ex} = await pool.query(`SELECT version FROM meca_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`, [logical]);
      const v = ex[0] ? ex[0].version + 1 : 1;
      await pool.query(`INSERT INTO meca_plans(logical_name, version, filename, file_path, content) VALUES($1,$2,$3,$4,$5)`, [logical, v, e.name, req.file.path, buf]);
      await pool.query(`INSERT INTO meca_plan_names(logical_name, display_name) VALUES($1,$2) ON CONFLICT(logical_name) DO NOTHING`, [logical, base]);
    }
  }
  await zip.close();
  res.json({ ok: true });
});

app.get("/api/meca/maps/planFile", async (req, res) => {
  const { id, logical_name } = req.query;
  let q = `SELECT content FROM meca_plans WHERE `;
  let p = [];
  if(id) { q+=`id=$1`; p=[id]; } 
  else { q+=`logical_name=$1 ORDER BY version DESC LIMIT 1`; p=[logical_name]; }
  const { rows } = await pool.query(q, p);
  if (rows[0]) { res.set("Content-Type", "application/pdf"); res.send(rows[0].content); }
  else res.status(404).send();
});

app.get("/api/meca/maps/positions", async (req, res) => {
  const { id } = req.query; // id du plan
  let logical = req.query.logical_name;
  if(id) {
      const {rows} = await pool.query(`SELECT logical_name FROM meca_plans WHERE id=$1`, [id]);
      if(rows[0]) logical = rows[0].logical_name;
  }
  const { rows } = await pool.query(`
    SELECT p.equipment_id, p.x_frac, p.y_frac, e.name, e.device_type, e.building, e.floor 
    FROM meca_positions p 
    JOIN meca_equipments e ON e.id=p.equipment_id 
    WHERE p.logical_name=$1
  `, [logical]);
  res.json({ ok: true, positions: rows });
});

app.post("/api/meca/maps/setPosition", async (req, res) => {
  const { equipment_id, logical_name, plan_id, x_frac, y_frac } = req.body;
  await pool.query(`
    INSERT INTO meca_positions(equipment_id, logical_name, plan_id, x_frac, y_frac)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(equipment_id, logical_name, page_index) 
    DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac
  `, [equipment_id, logical_name, plan_id, x_frac, y_frac]);
  res.json({ ok: true });
});

app.put("/api/meca/maps/renamePlan", async (req, res) => {
  const { logical_name, display_name } = req.body;
  await pool.query(`INSERT INTO meca_plan_names(logical_name, display_name) VALUES($1,$2) ON CONFLICT(logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`, [logical_name, display_name]);
  res.json({ ok: true });
});

// IA
app.post("/api/meca/analyzePhotoBatch", multerFiles.array("files"), async (req, res) => {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_MECA });
    const files = req.files || [];
    // ... (logique extraction similaire)
    res.json({ ok: true, extracted: {} }); // Placeholder pour éviter erreur si pas de clé
  } catch (e) { res.status(500).json({ error: e.message }); }
});

await ensureSchema();
app.listen(PORT, HOST, () => console.log(`[meca] listening on ${HOST}:${PORT}`));
