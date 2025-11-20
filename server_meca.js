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
// --- OpenAI (extraction & conformité)
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

// -------------------------------------------------
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-User-Email", "X-User-Name", "Authorization", "X-Site", "X-Confirm"],
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

function getUser(req) {
  return {
    name: req.header("X-User-Name") || null,
    email: req.header("X-User-Email") || null,
  };
}

// -------------------------------------------------
const multerFiles = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const multerZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_INCOMING_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.MECA_DATABASE_URL || process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  
  // TABLE EQUIPEMENTS MECA
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      location TEXT DEFAULT '',
      
      -- Champs mécaniques spécifiques
      device_type TEXT DEFAULT '',    -- ex: Pompe, Ventilateur, Compresseur
      fluid_type TEXT DEFAULT '',     -- ex: Eau glacée, Air, Huile
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      tag TEXT DEFAULT '',
      year_of_manufacture TEXT DEFAULT '',
      
      power_kw NUMERIC DEFAULT NULL,  -- Puissance moteur souvent utile en méca
      
      comment TEXT DEFAULT '',
      criticality TEXT DEFAULT '',    -- critique, important, standard
      ui_status TEXT DEFAULT '',      -- en_service, hors_service, spare
      
      status TEXT DEFAULT 'a_faire',
      installed_at TIMESTAMP NULL,
      next_check_date DATE NULL,
      
      photo_path TEXT DEFAULT NULL,
      photo_content BYTEA NULL,
      
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_meca_eq_next ON meca_equipments(next_check_date);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES meca_equipments(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'a_faire',
      date TIMESTAMP DEFAULT now(),
      items JSONB DEFAULT '[]'::jsonb,
      result TEXT DEFAULT NULL,
      user_name TEXT DEFAULT '',
      user_email TEXT DEFAULT '',
      files JSONB DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_meca_checks_eq ON meca_checks(equipment_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES meca_equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_content BYTEA NULL,
      uploaded_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_meca_files_eq ON meca_files(equipment_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meca_plans_logical ON meca_plans(logical_name);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES meca_equipments(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      UNIQUE (equipment_id, logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_meca_positions_lookup ON meca_positions(logical_name, page_index);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT '12_mois',
      checklist_template JSONB NOT NULL DEFAULT '[
        "État général et propreté ?",
        "Absence de fuites (fluides, graisses) ?",
        "Bruit et vibrations anormaux ?",
        "Température de fonctionnement normale ?",
        "État des courroies / accouplements ?",
        "Niveau d''huile / Graissage effectué ?",
        "Fixations et supports serrés ?"
      ]'::jsonb
    );
    INSERT INTO meca_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMP DEFAULT now(),
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_meca_events_ts ON meca_events(ts DESC);
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
      `INSERT INTO meca_events(action, details, actor_name, actor_email) VALUES($1,$2,$3,$4)`,
      [action, details, user.name || null, user.email || null]
    );
  } catch {}
}

// --- IA Extraction pour Mécanique
async function mecaExtractFromFiles(client, files) {
  if (!client) throw new Error("OPENAI_API_KEY missing");
  if (!files?.length) throw new Error("no files");

  const images = await Promise.all(
    files.map(async (f) => ({
      name: f.originalname,
      mime: f.mimetype,
      data: (await fsp.readFile(f.path)).toString("base64"),
    }))
  );

  const sys = `Tu es un expert en maintenance mécanique. Analyse ces photos d'équipements (Pompe, Ventilateur, Moteur, Compresseur, etc.) et extrais :
- manufacturer (fabricant)
- model (modèle)
- serial_number (numéro de série)
- device_type (ex: "Pompe centrifuge", "Ventilateur de reprise", "Compresseur")
- year (année de fabrication)
- power_kw (puissance en kW si visible)
- fluid_type (ex: "Eau", "Huile", "Air")

Réponds en JSON strict uniquement.`;

  const content = [
    { role: "system", content: sys },
    {
      role: "user",
      content: [
        { type: "text", text: "Analyse ces photos d'équipement mécanique." },
        ...images.map((im) => ({
          type: "image_url",
          image_url: { url: `data:${im.mime};base64,${im.data}` },
        })),
      ],
    },
  ];

  const resp = await client.chat.completions.create({
    model: process.env.MECA_OPENAI_MODEL || "gpt-4o-mini",
    messages: content,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  let data = {};
  try { data = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { data = {}; }

  return {
    manufacturer: String(data.manufacturer || ""),
    model: String(data.model || ""),
    serial_number: String(data.serial_number || ""),
    device_type: String(data.device_type || ""),
    year_of_manufacture: String(data.year || ""),
    power_kw: data.power_kw != null ? Number(data.power_kw) : null,
    fluid_type: String(data.fluid_type || ""),
  };
}

// -------------------------------------------------
// API ROUTES
// -------------------------------------------------

// GET EQUIPMENTS
app.get("/api/meca/equipments", async (req, res) => {
  try {
    const { q, building, floor, zone } = req.query;
    let sql = `
      SELECT e.*,
             (SELECT result FROM meca_checks c
              WHERE c.equipment_id=e.id AND c.status='fait' AND c.result IS NOT NULL
              ORDER BY c.date DESC NULLS LAST LIMIT 1) AS last_result
        FROM meca_equipments e
       WHERE 1=1
    `;
    const vals = [];
    let idx = 1;

    if (building) { sql += ` AND e.building ILIKE $${idx++}`; vals.push(`%${building}%`); }
    if (floor) { sql += ` AND e.floor ILIKE $${idx++}`; vals.push(`%${floor}%`); }
    if (zone) { sql += ` AND e.zone ILIKE $${idx++}`; vals.push(`%${zone}%`); }
    if (q) {
      sql += ` AND (e.name ILIKE $${idx} OR e.tag ILIKE $${idx} OR e.manufacturer ILIKE $${idx})`;
      vals.push(`%${q}%`);
      idx++;
    }
    sql += ` ORDER BY e.name`;

    const { rows } = await pool.query(sql, vals);
    for (const r of rows) {
      r.photo_url = (r.photo_content || r.photo_path) ? `/api/meca/equipments/${r.id}/photo` : null;
      r.status = eqStatusFromDue(r.next_check_date);
      r.compliance_state = r.last_result === "conforme" ? "conforme" : r.last_result === "non_conforme" ? "non_conforme" : "na";
      delete r.photo_content;
    }
    res.json({ ok: true, equipments: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET SINGLE EQUIPMENT
app.get("/api/meca/equipments/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM meca_equipments WHERE id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ ok: false });
    const eq = rows[0];
    eq.photo_url = (eq.photo_content || eq.photo_path) ? `/api/meca/equipments/${eq.id}/photo` : null;
    eq.status = eqStatusFromDue(eq.next_check_date);
    delete eq.photo_content;
    res.json({ ok: true, equipment: eq });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// CREATE EQUIPMENT
app.post("/api/meca/equipments", async (req, res) => {
  try {
    const u = getUser(req);
    const b = req.body || {};
    const { rows } = await pool.query(`
      INSERT INTO meca_equipments(
        name, building, zone, floor, location,
        device_type, fluid_type, manufacturer, model, serial_number, tag, year_of_manufacture, power_kw,
        comment, criticality, ui_status, next_check_date
      ) VALUES($1,$2,$3,$4,$5, $6,$7,$8,$9,$10,$11,$12,$13, $14,$15,$16,$17)
      RETURNING *
    `, [
      b.name, b.building, b.zone, b.floor, b.location,
      b.device_type, b.fluid_type, b.manufacturer, b.model, b.serial_number, b.tag, b.year_of_manufacture, b.power_kw,
      b.comment, b.criticality, b.ui_status, b.next_check_date || null
    ]);
    await logEvent("meca_created", { id: rows[0].id, name: rows[0].name }, u);
    res.json({ ok: true, equipment: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// UPDATE EQUIPMENT
app.put("/api/meca/equipments/:id", async (req, res) => {
  try {
    const u = getUser(req);
    const id = req.params.id;
    const b = req.body || {};
    
    // Construction dynamique de l'update
    const fields = [];
    const vals = [];
    let idx = 1;
    
    const map = {
      name: b.name, building: b.building, zone: b.zone, floor: b.floor, location: b.location,
      device_type: b.device_type, fluid_type: b.fluid_type, manufacturer: b.manufacturer,
      model: b.model, serial_number: b.serial_number, tag: b.tag,
      year_of_manufacture: b.year_of_manufacture, power_kw: b.power_kw,
      comment: b.comment, criticality: b.criticality, ui_status: b.ui_status,
      next_check_date: b.next_check_date
    };

    for(const [k,v] of Object.entries(map)) {
      if(v !== undefined) {
        fields.push(`${k}=$${idx++}`);
        vals.push(v);
      }
    }
    fields.push(`updated_at=now()`);
    vals.push(id);

    await pool.query(`UPDATE meca_equipments SET ${fields.join(", ")} WHERE id=$${idx}`, vals);
    await logEvent("meca_updated", { id }, u);
    
    const { rows } = await pool.query(`SELECT * FROM meca_equipments WHERE id=$1`, [id]);
    res.json({ ok: true, equipment: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE EQUIPMENT
app.delete("/api/meca/equipments/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM meca_equipments WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PHOTO & FILES
app.get("/api/meca/equipments/:id/photo", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT photo_content, photo_path FROM meca_equipments WHERE id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).send();
    if (rows[0].photo_content) {
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(rows[0].photo_content);
    }
    if (rows[0].photo_path && fs.existsSync(rows[0].photo_path)) return res.sendFile(path.resolve(rows[0].photo_path));
    res.status(404).send();
  } catch (e) { res.status(500).send(); }
});

app.post("/api/meca/equipments/:id/photo", multerFiles.single("photo"), async (req, res) => {
  try {
    if(!req.file) return res.status(400).json({error: "No file"});
    const buf = await fsp.readFile(req.file.path);
    await pool.query(`UPDATE meca_equipments SET photo_content=$1, photo_path=$2 WHERE id=$3`, [buf, req.file.path, req.params.id]);
    res.json({ ok: true, photo_url: `/api/meca/equipments/${req.params.id}/photo` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/meca/files", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, original_name, mime, uploaded_at FROM meca_files WHERE equipment_id=$1 ORDER BY uploaded_at DESC`, [req.query.equipment_id]);
    const files = rows.map(r => ({ ...r, url: `/api/meca/files/${r.id}` }));
    res.json({ ok: true, files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/meca/files", multerFiles.array("files"), async (req, res) => {
  try {
    const eqId = req.body.equipment_id;
    for (const f of req.files || []) {
      const buf = await fsp.readFile(f.path);
      await pool.query(`INSERT INTO meca_files(equipment_id, original_name, mime, file_path, file_content) VALUES($1,$2,$3,$4,$5)`,
        [eqId, f.originalname, f.mimetype, f.path, buf]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/meca/files/:id", async(req, res) => {
    await pool.query(`DELETE FROM meca_files WHERE id=$1`, [req.params.id]);
    res.json({ok:true});
});

app.get("/api/meca/files/:id", async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM meca_files WHERE id=$1`, [req.params.id]);
    if(!rows[0]) return res.status(404).send();
    res.set("Content-Type", rows[0].mime || "application/octet-stream");
    res.send(rows[0].file_content);
});

// PLANS & MAPS
app.post("/api/meca/maps/uploadZip", multerZip.single("zip"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No zip" });
    const zip = new StreamZip.async({ file: req.file.path });
    const entries = await zip.entries();
    const pdfs = Object.values(entries).filter(e => e.name.toLowerCase().endsWith(".pdf"));
    
    for (const e of pdfs) {
      const buf = await zip.entryData(e);
      const base = path.basename(e.name, ".pdf");
      const logical = base.replace(/[^\w-]+/g, "_");
      const dest = path.join(MAPS_DIR, `${Date.now()}_${base}.pdf`);
      await fsp.writeFile(dest, buf);
      
      const { rows: ex } = await pool.query(`SELECT version FROM meca_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`, [logical]);
      const ver = ex[0] ? ex[0].version + 1 : 1;
      
      await pool.query(`INSERT INTO meca_plans(logical_name, version, filename, file_path, content) VALUES($1,$2,$3,$4,$5)`, 
        [logical, ver, e.name, dest, buf]);
      await pool.query(`INSERT INTO meca_plan_names(logical_name, display_name) VALUES($1,$2) ON CONFLICT(logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
        [logical, base]);
    }
    await zip.close();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/meca/maps/listPlans", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name) p.id, p.logical_name, COALESCE(pn.display_name, p.logical_name) as display_name 
      FROM meca_plans p LEFT JOIN meca_plan_names pn ON pn.logical_name=p.logical_name
      ORDER BY p.logical_name, p.version DESC
    `);
    res.json({ ok: true, plans: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/meca/maps/planFile", async (req, res) => {
    const { id, logical_name } = req.query;
    let q = `SELECT content FROM meca_plans WHERE `;
    let p = [];
    if(id) { q += `id=$1`; p=[id]; }
    else { q += `logical_name=$1 ORDER BY version DESC LIMIT 1`; p=[logical_name]; }
    
    const { rows } = await pool.query(q, p);
    if(rows[0]?.content) {
        res.set("Content-Type", "application/pdf");
        res.send(rows[0].content);
    } else {
        res.status(404).send();
    }
});

app.get("/api/meca/maps/positions", async(req, res) => {
    const { logical_name, id } = req.query;
    let key = logical_name;
    if(id) {
        const {rows} = await pool.query(`SELECT logical_name FROM meca_plans WHERE id=$1`, [id]);
        if(rows[0]) key = rows[0].logical_name;
    }
    const { rows } = await pool.query(`
        SELECT p.equipment_id, p.x_frac, p.y_frac, e.name, e.building, e.floor, e.zone
        FROM meca_positions p JOIN meca_equipments e ON e.id=p.equipment_id
        WHERE p.logical_name=$1
    `, [key]);
    res.json({ ok: true, positions: rows });
});

app.post("/api/meca/maps/setPosition", async(req, res) => {
    const { equipment_id, logical_name, plan_id, x_frac, y_frac } = req.body;
    await pool.query(`
        INSERT INTO meca_positions(equipment_id, logical_name, plan_id, x_frac, y_frac)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(equipment_id, logical_name, page_index) DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac
    `, [equipment_id, logical_name, plan_id, x_frac, y_frac]);
    res.json({ok:true});
});

app.put("/api/meca/maps/renamePlan", async(req, res) => {
    await pool.query(`INSERT INTO meca_plan_names(logical_name, display_name) VALUES($1,$2) ON CONFLICT(logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
        [req.body.logical_name, req.body.display_name]);
    res.json({ok:true});
});

// IA
app.post("/api/meca/analyzePhotoBatch", multerFiles.array("files"), async (req, res) => {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_MECA });
    const extracted = await mecaExtractFromFiles(client, req.files || []);
    res.json({ ok: true, extracted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// INIT & START
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[meca] listening on ${HOST}:${PORT}`);
});
