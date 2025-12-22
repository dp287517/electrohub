// ==============================
// server_glo.js — Global Electrical Equipments (UPS, Compensation Batteries, Emergency Lighting)
// VERSION 1.0 - MULTI-TENANT (Company + Site)
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
import { extractTenantFromRequest, getTenantFilter, enrichTenantWithSiteId } from "./lib/tenant-filter.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------ Config service ------------------
const PORT = Number(process.env.GLO_PORT || 3023);
const HOST = process.env.GLO_HOST || "0.0.0.0";

// Dossiers data
const DATA_DIR =
  process.env.GLO_DATA_DIR || path.resolve(__dirname, "./_data_glo");
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
        "connect-src": ["*"],
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
// Multer (fichiers & ZIP de plans)
// -------------------------------------------------
import multerLib from "multer";
const multerFiles = multerLib({
  storage: multerLib.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`
      ),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const multerZip = multerLib({
  storage: multerLib.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_INCOMING_DIR),
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`
      ),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

// -------------------------------------------------
// Postgres
// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.GLO_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -------------------------------------------------
// Schema BDD
// -------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Global Electrical Equipments table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Identification
      name TEXT NOT NULL,
      tag TEXT DEFAULT '',
      equipment_type TEXT DEFAULT '',
      function TEXT DEFAULT '',

      -- Localisation
      building TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      panel TEXT DEFAULT '',

      -- Electrical Data (common)
      power_kva NUMERIC DEFAULT NULL,
      power_kw NUMERIC DEFAULT NULL,
      voltage_input TEXT DEFAULT '',
      voltage_output TEXT DEFAULT '',
      current_a NUMERIC DEFAULT NULL,
      frequency_hz NUMERIC DEFAULT NULL,
      phases TEXT DEFAULT '',
      ip_rating TEXT DEFAULT '',

      -- UPS specific fields
      ups_type TEXT DEFAULT '',
      ups_topology TEXT DEFAULT '',
      battery_type TEXT DEFAULT '',
      battery_count INTEGER DEFAULT NULL,
      autonomy_minutes NUMERIC DEFAULT NULL,
      efficiency_percent NUMERIC DEFAULT NULL,

      -- Compensation Battery specific fields
      reactive_power_kvar NUMERIC DEFAULT NULL,
      capacitor_type TEXT DEFAULT '',
      steps INTEGER DEFAULT NULL,
      automatic_regulation BOOLEAN DEFAULT FALSE,
      thd_filter BOOLEAN DEFAULT FALSE,

      -- Emergency Lighting specific fields
      lighting_type TEXT DEFAULT '',
      lamp_type TEXT DEFAULT '',
      lumen_output NUMERIC DEFAULT NULL,
      autonomy_hours NUMERIC DEFAULT NULL,
      test_button BOOLEAN DEFAULT FALSE,
      self_test BOOLEAN DEFAULT FALSE,

      -- Manufacturer
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      year TEXT DEFAULT '',

      -- Management
      status TEXT DEFAULT '',
      criticality TEXT DEFAULT '',
      last_test_date DATE DEFAULT NULL,
      next_test_date DATE DEFAULT NULL,
      comments TEXT DEFAULT '',

      -- Photo
      photo_path TEXT DEFAULT NULL,
      photo_content BYTEA NULL,

      -- Multi-tenant
      company_id INTEGER,
      site_id INTEGER,

      -- Category reference
      category_id UUID,
      subcategory_id UUID,

      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_eq_name ON glo_equipments(name);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_eq_company ON glo_equipments(company_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_eq_site ON glo_equipments(site_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_eq_category ON glo_equipments(category_id);`);

  // Migration: Populate company_id/site_id for existing equipments (NULL)
  try {
    const defaultSiteRes = await pool.query(`SELECT id, company_id FROM sites ORDER BY id LIMIT 1`);
    if (defaultSiteRes.rows[0]) {
      const defaultSite = defaultSiteRes.rows[0];
      const updateRes = await pool.query(`
        UPDATE glo_equipments
        SET company_id = $1, site_id = $2
        WHERE company_id IS NULL OR site_id IS NULL
      `, [defaultSite.company_id, defaultSite.id]);
      if (updateRes.rowCount > 0) {
        console.log(`[GLO] Migration: ${updateRes.rowCount} equipments updated with company_id=${defaultSite.company_id}, site_id=${defaultSite.id}`);
      }
    }
  } catch (migrationErr) {
    console.warn(`[GLO] Migration tenant warning:`, migrationErr.message);
  }

  // Attached files
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES glo_equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_content BYTEA NULL,
      uploaded_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_files_eq ON glo_files(equipment_id);`);

  // PDF Plans
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_plans_logical ON glo_plans(logical_name);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `);

  // Positions on plans
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES glo_equipments(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      UNIQUE (equipment_id, logical_name, page_index)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_positions_lookup ON glo_positions(logical_name, page_index);`);

  // Audit log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMP DEFAULT now(),
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_events_ts ON glo_events(ts DESC);`);

  // ========== EQUIPMENT CATEGORIES & SUBCATEGORIES ==========

  // Categories (UPS, Batteries de Compensation, Eclairages de Secours)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_equipment_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '#10b981',
      display_order INTEGER DEFAULT 0,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_cat_company ON glo_equipment_categories(company_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_cat_site ON glo_equipment_categories(site_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_cat_order ON glo_equipment_categories(display_order);`);

  // Subcategories
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glo_equipment_subcategories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID NOT NULL REFERENCES glo_equipment_categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_subcat_category ON glo_equipment_subcategories(category_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_glo_subcat_order ON glo_equipment_subcategories(display_order);`);

  // Add foreign keys to equipments if not exists
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE glo_equipments ADD CONSTRAINT fk_glo_eq_category
        FOREIGN KEY (category_id) REFERENCES glo_equipment_categories(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE glo_equipments ADD CONSTRAINT fk_glo_eq_subcategory
        FOREIGN KEY (subcategory_id) REFERENCES glo_equipment_subcategories(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  // Insert default categories if not exist
  await insertDefaultCategories();
}

// Insert default categories and subcategories
async function insertDefaultCategories() {
  const categories = [
    {
      name: 'UPS (Onduleurs)',
      description: 'Alimentations sans interruption',
      icon: '🔋',
      color: '#10b981',
      display_order: 1,
      subcategories: [
        { name: 'Online (Double conversion)', display_order: 1 },
        { name: 'Line-Interactive', display_order: 2 },
        { name: 'Offline (Standby)', display_order: 3 },
        { name: 'Modulaire', display_order: 4 },
      ]
    },
    {
      name: 'Batteries de Compensation',
      description: 'Compensation de puissance réactive',
      icon: '⚡',
      color: '#f59e0b',
      display_order: 2,
      subcategories: [
        { name: 'Fixe', display_order: 1 },
        { name: 'Automatique', display_order: 2 },
        { name: 'Avec filtrage harmonique', display_order: 3 },
        { name: 'Modulaire', display_order: 4 },
      ]
    },
    {
      name: 'Eclairages de Secours',
      description: 'Systèmes d\'éclairage de sécurité',
      icon: '💡',
      color: '#ef4444',
      display_order: 3,
      subcategories: [
        { name: 'BAES (Bloc Autonome)', display_order: 1 },
        { name: 'BAEH (Habitation)', display_order: 2 },
        { name: 'Source Centralisée', display_order: 3 },
        { name: 'Projecteur de secours', display_order: 4 },
      ]
    },
  ];

  for (const cat of categories) {
    // Check if category exists
    const { rows: existing } = await pool.query(
      `SELECT id FROM glo_equipment_categories WHERE name = $1 LIMIT 1`,
      [cat.name]
    );

    let categoryId;
    if (existing.length === 0) {
      // Insert category
      const { rows } = await pool.query(`
        INSERT INTO glo_equipment_categories (name, description, icon, color, display_order)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [cat.name, cat.description, cat.icon, cat.color, cat.display_order]);
      categoryId = rows[0].id;
      console.log(`[GLO] Created category: ${cat.name}`);

      // Insert subcategories
      for (const sub of cat.subcategories) {
        await pool.query(`
          INSERT INTO glo_equipment_subcategories (category_id, name, display_order)
          VALUES ($1, $2, $3)
        `, [categoryId, sub.name, sub.display_order]);
      }
      console.log(`[GLO] Created ${cat.subcategories.length} subcategories for ${cat.name}`);
    }
  }
}

// -------------------------------------------------
// Helpers
// -------------------------------------------------
async function logEvent(action, details = {}, user = {}) {
  try {
    await pool.query(
      `INSERT INTO glo_events(action, details, actor_name, actor_email)
       VALUES($1,$2,$3,$4)`,
      [action, details, user.name || null, user.email || null]
    );
  } catch {
    // Never block app for a log
  }
}

// -------------------------------------------------
// API EQUIPMENTS
// -------------------------------------------------

// GET /api/glo/equipments
app.get("/api/glo/equipments", async (req, res) => {
  try {
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);
    const tenantFilter = getTenantFilter(tenant, { tableAlias: 'e' });

    const { rows } = await pool.query(`
      SELECT e.*,
             c.name as category_name,
             c.icon as category_icon,
             c.color as category_color,
             s.name as subcategory_name
        FROM glo_equipments e
        LEFT JOIN glo_equipment_categories c ON e.category_id = c.id
        LEFT JOIN glo_equipment_subcategories s ON e.subcategory_id = s.id
       WHERE ${tenantFilter.where}
       ORDER BY e.building, e.zone, e.name
    `, tenantFilter.params);

    for (const r of rows) {
      r.photo_url =
        (r.photo_content && r.photo_content.length) || r.photo_path
          ? `/api/glo/equipments/${r.id}/photo`
          : null;
    }

    res.json({ ok: true, equipments: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/glo/equipments/:id
app.get("/api/glo/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT e.*,
              c.name as category_name,
              c.icon as category_icon,
              c.color as category_color,
              s.name as subcategory_name
         FROM glo_equipments e
         LEFT JOIN glo_equipment_categories c ON e.category_id = c.id
         LEFT JOIN glo_equipment_subcategories s ON e.subcategory_id = s.id
        WHERE e.id=$1`,
      [id]
    );
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "Not found" });
    const eq = rows[0];
    eq.photo_url =
      (eq.photo_content && eq.photo_content.length) || eq.photo_path
        ? `/api/glo/equipments/${id}/photo`
        : null;
    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/glo/equipments
app.post("/api/glo/equipments", async (req, res) => {
  try {
    const u = getUser(req);
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);

    const {
      name = "",
      tag = "",
      equipment_type = "",
      function: func = "",
      building = "",
      floor = "",
      zone = "",
      location = "",
      panel = "",
      power_kva = null,
      power_kw = null,
      voltage_input = "",
      voltage_output = "",
      current_a = null,
      frequency_hz = null,
      phases = "",
      ip_rating = "",
      // UPS specific
      ups_type = "",
      ups_topology = "",
      battery_type = "",
      battery_count = null,
      autonomy_minutes = null,
      efficiency_percent = null,
      // Compensation Battery specific
      reactive_power_kvar = null,
      capacitor_type = "",
      steps = null,
      automatic_regulation = false,
      thd_filter = false,
      // Emergency Lighting specific
      lighting_type = "",
      lamp_type = "",
      lumen_output = null,
      autonomy_hours = null,
      test_button = false,
      self_test = false,
      // Manufacturer
      manufacturer = "",
      model = "",
      serial_number = "",
      year = "",
      // Management
      status = "",
      criticality = "",
      last_test_date = null,
      next_test_date = null,
      comments = "",
      // Category
      category_id = null,
      subcategory_id = null,
    } = req.body || {};

    const { rows } = await pool.query(
      `INSERT INTO glo_equipments(
         company_id, site_id,
         name, tag, equipment_type, function,
         building, floor, zone, location, panel,
         power_kva, power_kw, voltage_input, voltage_output, current_a, frequency_hz, phases, ip_rating,
         ups_type, ups_topology, battery_type, battery_count, autonomy_minutes, efficiency_percent,
         reactive_power_kvar, capacitor_type, steps, automatic_regulation, thd_filter,
         lighting_type, lamp_type, lumen_output, autonomy_hours, test_button, self_test,
         manufacturer, model, serial_number, year,
         status, criticality, last_test_date, next_test_date, comments,
         category_id, subcategory_id
       )
       VALUES(
         $1,$2,
         $3,$4,$5,$6,
         $7,$8,$9,$10,$11,
         $12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29,$30,
         $31,$32,$33,$34,$35,$36,
         $37,$38,$39,$40,
         $41,$42,$43,$44,$45,
         $46,$47
       )
       RETURNING *`,
      [
        tenant.companyId, tenant.siteId,
        name, tag, equipment_type, func,
        building, floor, zone, location, panel,
        power_kva, power_kw, voltage_input, voltage_output, current_a, frequency_hz, phases, ip_rating,
        ups_type, ups_topology, battery_type, battery_count, autonomy_minutes, efficiency_percent,
        reactive_power_kvar, capacitor_type, steps, automatic_regulation, thd_filter,
        lighting_type, lamp_type, lumen_output, autonomy_hours, test_button, self_test,
        manufacturer, model, serial_number, year,
        status, criticality, last_test_date, next_test_date, comments,
        category_id || null, subcategory_id || null,
      ]
    );

    const eq = rows[0];
    eq.photo_url = null;

    await logEvent("glo_equipment_created", { id: eq.id, name: eq.name }, u);
    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/glo/equipments/:id
app.put("/api/glo/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);

    const fields = [];
    const vals = [];
    let idx = 1;

    const pushField = (col, val) => {
      fields.push(`${col}=$${idx++}`);
      vals.push(val);
    };

    const body = req.body || {};

    // All updateable fields
    const fieldMap = {
      name: 'name', tag: 'tag', equipment_type: 'equipment_type',
      building: 'building', floor: 'floor', zone: 'zone', location: 'location', panel: 'panel',
      power_kva: 'power_kva', power_kw: 'power_kw', voltage_input: 'voltage_input', voltage_output: 'voltage_output',
      current_a: 'current_a', frequency_hz: 'frequency_hz', phases: 'phases', ip_rating: 'ip_rating',
      ups_type: 'ups_type', ups_topology: 'ups_topology', battery_type: 'battery_type',
      battery_count: 'battery_count', autonomy_minutes: 'autonomy_minutes', efficiency_percent: 'efficiency_percent',
      reactive_power_kvar: 'reactive_power_kvar', capacitor_type: 'capacitor_type', steps: 'steps',
      automatic_regulation: 'automatic_regulation', thd_filter: 'thd_filter',
      lighting_type: 'lighting_type', lamp_type: 'lamp_type', lumen_output: 'lumen_output',
      autonomy_hours: 'autonomy_hours', test_button: 'test_button', self_test: 'self_test',
      manufacturer: 'manufacturer', model: 'model', serial_number: 'serial_number', year: 'year',
      status: 'status', criticality: 'criticality', last_test_date: 'last_test_date',
      next_test_date: 'next_test_date', comments: 'comments',
      category_id: 'category_id', subcategory_id: 'subcategory_id',
    };

    // Handle function separately (reserved word)
    if (body.function !== undefined) pushField("function", body.function);

    for (const [key, col] of Object.entries(fieldMap)) {
      if (body[key] !== undefined) {
        // Handle null for UUID fields
        if ((key === 'category_id' || key === 'subcategory_id') && !body[key]) {
          pushField(col, null);
        } else {
          pushField(col, body[key]);
        }
      }
    }

    fields.push("updated_at=now()");
    vals.push(id);

    await pool.query(
      `UPDATE glo_equipments SET ${fields.join(", ")} WHERE id=$${idx}`,
      vals
    );

    const { rows } = await pool.query(
      `SELECT e.*,
              c.name as category_name,
              c.icon as category_icon,
              c.color as category_color,
              s.name as subcategory_name
         FROM glo_equipments e
         LEFT JOIN glo_equipment_categories c ON e.category_id = c.id
         LEFT JOIN glo_equipment_subcategories s ON e.subcategory_id = s.id
        WHERE e.id=$1`,
      [id]
    );
    const eq = rows[0];
    if (eq) {
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/glo/equipments/${id}/photo`
          : null;
    }

    await logEvent("glo_equipment_updated", { id, fields: Object.keys(body) }, u);
    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/glo/equipments/:id
app.delete("/api/glo/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows: old } = await pool.query(
      `SELECT name FROM glo_equipments WHERE id=$1`,
      [id]
    );
    await pool.query(`DELETE FROM glo_equipments WHERE id=$1`, [id]);
    await logEvent("glo_equipment_deleted", { id, name: old[0]?.name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// Photo principale
// -------------------------------------------------

// GET /api/glo/equipments/:id/photo
app.get("/api/glo/equipments/:id/photo", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT photo_content, photo_path FROM glo_equipments WHERE id=$1`,
      [id]
    );
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "Not found" });
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

// POST /api/glo/equipments/:id/photo
app.post(
  "/api/glo/equipments/:id/photo",
  multerFiles.single("photo"),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const u = getUser(req);
      if (!req.file)
        return res.status(400).json({ ok: false, error: "No file" });
      const buf = await fsp.readFile(req.file.path);
      await pool.query(
        `UPDATE glo_equipments
           SET photo_content=$1, photo_path=$2, updated_at=now()
         WHERE id=$3`,
        [buf, req.file.path, id]
      );
      await logEvent("glo_equipment_photo_updated", { id }, u);
      res.json({ ok: true, photo_url: `/api/glo/equipments/${id}/photo` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// -------------------------------------------------
// ATTACHED FILES
// -------------------------------------------------

// GET /api/glo/files?equipment_id=...
app.get("/api/glo/files", async (req, res) => {
  try {
    const eqId = req.query.equipment_id;
    if (!eqId)
      return res.status(400).json({ ok: false, error: "equipment_id required" });

    const { rows } = await pool.query(
      `SELECT id, equipment_id, original_name, mime, uploaded_at
         FROM glo_files
        WHERE equipment_id=$1
        ORDER BY uploaded_at DESC`,
      [String(eqId)]
    );

    for (const f of rows) {
      f.url = `/api/glo/files/${f.id}`;
    }

    res.json({ ok: true, files: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/glo/files
app.post(
  "/api/glo/files",
  multerFiles.array("files"),
  async (req, res) => {
    try {
      const u = getUser(req);
      const eqId = req.body.equipment_id;
      if (!eqId)
        return res.status(400).json({ ok: false, error: "equipment_id required" });

      const inserted = [];
      for (const f of req.files || []) {
        const buf = await fsp.readFile(f.path);
        const { rows } = await pool.query(
          `INSERT INTO glo_files(equipment_id, original_name, mime, file_path, file_content)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [eqId, f.originalname, f.mimetype, f.path, buf]
        );
        inserted.push({ ...rows[0], url: `/api/glo/files/${rows[0].id}` });
      }

      await logEvent("glo_files_uploaded", { equipment_id: eqId, count: inserted.length }, u);
      res.json({ ok: true, files: inserted });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// GET /api/glo/files/:id
app.get("/api/glo/files/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT original_name, mime, file_content, file_path
         FROM glo_files
        WHERE id=$1`,
      [id]
    );
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "Not found" });

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

// DELETE /api/glo/files/:id
app.delete("/api/glo/files/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    await pool.query(`DELETE FROM glo_files WHERE id=$1`, [id]);
    await logEvent("glo_file_deleted", { file_id: id }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// MAPS (PDF Plans + positions)
// -------------------------------------------------

// POST /api/glo/maps/uploadZip - Uploads into VSD plans for symbiosis (shared plans)
app.post(
  "/api/glo/maps/uploadZip",
  multerZip.single("zip"),
  async (req, res) => {
    try {
      const u = getUser(req);
      if (!req.file)
        return res.status(400).json({ ok: false, error: "No zip file" });

      const zipPath = req.file.path;
      const zip = new StreamZip.async({ file: zipPath });
      const entries = await zip.entries();
      const pdfs = Object.values(entries).filter(
        (e) => !e.isDirectory && e.name.toLowerCase().endsWith(".pdf")
      );

      const imported = [];
      for (const e of pdfs) {
        const buf = await zip.entryData(e);
        const base = path.basename(e.name, ".pdf");
        const logical = base.replace(/[^\w-]+/g, "_");
        const dest = path.join(MAPS_DIR, `${Date.now()}_${base}.pdf`);
        await fsp.writeFile(dest, buf);

        // Use VSD plans for symbiosis with all modules (VSD, Switchboard, Mobile, GLO)
        const { rows: existing } = await pool.query(
          `SELECT id, version FROM vsd_plans
            WHERE logical_name=$1
            ORDER BY version DESC
            LIMIT 1`,
          [logical]
        );
        const nextVer = existing[0] ? existing[0].version + 1 : 1;

        const { rows } = await pool.query(
          `INSERT INTO vsd_plans(logical_name, version, filename, file_path, content, page_count)
           VALUES($1,$2,$3,$4,$5,1)
           RETURNING *`,
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
      await logEvent("glo_maps_zip_uploaded", { count: imported.length }, u);
      res.json({ ok: true, imported });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// GET /api/glo/maps/listPlans - Uses VSD plans for symbiosis (shared plans across modules)
app.get("/api/glo/maps/listPlans", async (_req, res) => {
  try {
    // Use VSD plans (vsd_plans, vsd_plan_names) for symbiosis with VSD/Switchboard/Mobile modules
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id,
             p.logical_name,
             p.version,
             p.filename,
             p.page_count,
             COALESCE(pn.display_name, p.logical_name) AS display_name
        FROM vsd_plans p
        LEFT JOIN vsd_plan_names pn ON pn.logical_name = p.logical_name
       ORDER BY p.logical_name, p.version DESC
    `);
    res.json({ ok: true, plans: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/glo/maps/planFile?logical_name=... or ?id=... - Uses VSD plans for symbiosis
app.get("/api/glo/maps/planFile", async (req, res) => {
  try {
    const { logical_name, id } = req.query;
    // Use VSD plans for symbiosis
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
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "Plan not found" });

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

// PUT /api/glo/maps/renamePlan
app.put("/api/glo/maps/renamePlan", async (req, res) => {
  try {
    const u = getUser(req);
    const { logical_name, display_name } = req.body || {};
    if (!logical_name)
      return res.status(400).json({ ok: false, error: "logical_name required" });

    await pool.query(
      `INSERT INTO glo_plan_names(logical_name, display_name)
       VALUES($1,$2)
       ON CONFLICT(logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [logical_name, display_name || ""]
    );

    await logEvent("glo_plan_renamed", { logical_name, display_name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/glo/maps/positions?logical_name=...&page_index=...
app.get("/api/glo/maps/positions", async (req, res) => {
  try {
    const { logical_name, id, page_index = 0 } = req.query;

    let whereClause;
    let params;

    if (id) {
      // Get logical_name from plan id first (using VSD plans for symbiosis)
      const { rows: planRows } = await pool.query(
        `SELECT logical_name FROM vsd_plans WHERE id = $1`,
        [id]
      );
      if (!planRows[0]) {
        return res.json({ ok: true, positions: [] });
      }
      whereClause = `p.logical_name = $1 AND p.page_index = $2`;
      params = [planRows[0].logical_name, Number(page_index)];
    } else if (logical_name) {
      whereClause = `p.logical_name = $1 AND p.page_index = $2`;
      params = [logical_name, Number(page_index)];
    } else {
      return res.status(400).json({ ok: false, error: "logical_name or id required" });
    }

    const { rows } = await pool.query(`
      SELECT p.id,
             p.equipment_id,
             p.logical_name,
             p.page_index,
             p.x_frac,
             p.y_frac,
             e.name,
             e.tag,
             e.building,
             e.equipment_type,
             e.category_id,
             c.name as category_name,
             c.icon as category_icon,
             c.color as category_color
        FROM glo_positions p
        JOIN glo_equipments e ON e.id = p.equipment_id
        LEFT JOIN glo_equipment_categories c ON e.category_id = c.id
       WHERE ${whereClause}
    `, params);

    res.json({ ok: true, positions: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/glo/maps/setPosition
// This ensures equipment is only on ONE plan at a time (deletes ALL old positions first)
app.post("/api/glo/maps/setPosition", async (req, res) => {
  try {
    const u = getUser(req);
    const { equipment_id, logical_name, plan_id, page_index = 0, x_frac, y_frac } = req.body || {};

    if (!equipment_id || (!logical_name && !plan_id))
      return res.status(400).json({ ok: false, error: "equipment_id and logical_name/plan_id required" });

    // Get logical_name from plan_id if needed (using VSD plans for symbiosis)
    let finalLogicalName = logical_name;
    if (!finalLogicalName && plan_id) {
      const { rows } = await pool.query(`SELECT logical_name FROM vsd_plans WHERE id = $1`, [plan_id]);
      if (rows[0]) finalLogicalName = rows[0].logical_name;
    }

    if (!finalLogicalName)
      return res.status(400).json({ ok: false, error: "Could not determine logical_name" });

    // CRITICAL: Delete ALL existing positions for this equipment
    // This ensures the equipment is NEVER on multiple plans
    const deleteResult = await pool.query(
      `DELETE FROM glo_positions WHERE equipment_id = $1`,
      [equipment_id]
    );
    console.log(`[GLO MAPS] Deleted ${deleteResult.rowCount} old positions for equipment ${equipment_id}`);

    // Then insert the new position
    const { rows } = await pool.query(`
      INSERT INTO glo_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [equipment_id, finalLogicalName, plan_id || null, page_index, x_frac, y_frac]);

    console.log(`[GLO MAPS] Created new position for equipment ${equipment_id} on plan ${finalLogicalName}`);
    await logEvent("glo_position_set", { equipment_id, logical_name: finalLogicalName, page_index }, u);
    res.json({ ok: true, position: rows[0] });
  } catch (e) {
    console.error("[GLO MAPS] Set position error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cleanup duplicate positions
app.post("/api/glo/maps/cleanup-duplicates", async (req, res) => {
  try {
    const { rows: duplicates } = await pool.query(`
      SELECT equipment_id, COUNT(*) as count
      FROM glo_positions
      GROUP BY equipment_id
      HAVING COUNT(*) > 1
    `);

    console.log(`[GLO MAPS] Found ${duplicates.length} equipments with duplicate positions`);

    let totalRemoved = 0;
    for (const dup of duplicates) {
      const result = await pool.query(`
        DELETE FROM glo_positions
        WHERE equipment_id = $1
        AND id NOT IN (
          SELECT id FROM glo_positions
          WHERE equipment_id = $1
          ORDER BY id DESC
          LIMIT 1
        )
      `, [dup.equipment_id]);
      totalRemoved += result.rowCount;
    }

    res.json({ ok: true, duplicates_found: duplicates.length, positions_removed: totalRemoved });
  } catch (e) {
    console.error("[GLO MAPS] Cleanup error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/glo/maps/positions/:id
app.delete("/api/glo/maps/positions/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    await pool.query(`DELETE FROM glo_positions WHERE id = $1`, [id]);
    await logEvent("glo_position_deleted", { position_id: id }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/glo/maps/placed-ids
app.get("/api/glo/maps/placed-ids", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT equipment_id, logical_name, page_index
        FROM glo_positions
    `);

    const placed_ids = [...new Set(rows.map(r => r.equipment_id))];
    const placed_details = {};
    for (const r of rows) {
      placed_details[r.equipment_id] = {
        logical_name: r.logical_name,
        page_index: r.page_index,
      };
    }

    res.json({ ok: true, placed_ids, placed_details });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// CATEGORIES API
// -------------------------------------------------

// GET /api/glo/categories
app.get("/api/glo/categories", async (req, res) => {
  try {
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);

    // Get categories (global + site-specific)
    const { rows: categories } = await pool.query(`
      SELECT c.*,
             COALESCE(
               (SELECT json_agg(s ORDER BY s.display_order, s.name)
                FROM glo_equipment_subcategories s
                WHERE s.category_id = c.id),
               '[]'::json
             ) as subcategories
        FROM glo_equipment_categories c
       WHERE c.site_id IS NULL
          OR c.site_id = $1
       ORDER BY c.display_order, c.name
    `, [tenant.siteId || 0]);

    res.json({ ok: true, categories });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/glo/categories/:id
app.get("/api/glo/categories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(`
      SELECT c.*,
             COALESCE(
               (SELECT json_agg(s ORDER BY s.display_order, s.name)
                FROM glo_equipment_subcategories s
                WHERE s.category_id = c.id),
               '[]'::json
             ) as subcategories
        FROM glo_equipment_categories c
       WHERE c.id = $1
    `, [id]);

    if (!rows[0])
      return res.status(404).json({ ok: false, error: "Category not found" });

    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/glo/categories
app.post("/api/glo/categories", async (req, res) => {
  try {
    const u = getUser(req);
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);

    const { name, description = '', icon = '', color = '#10b981', display_order = 0 } = req.body || {};

    if (!name)
      return res.status(400).json({ ok: false, error: "name required" });

    const { rows } = await pool.query(`
      INSERT INTO glo_equipment_categories (name, description, icon, color, display_order, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [name, description, icon, color, display_order, tenant.companyId, tenant.siteId]);

    await logEvent("glo_category_created", { id: rows[0].id, name }, u);
    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/glo/categories/:id
app.put("/api/glo/categories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);

    const { name, description, icon, color, display_order } = req.body || {};

    const fields = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name=$${idx++}`); vals.push(name); }
    if (description !== undefined) { fields.push(`description=$${idx++}`); vals.push(description); }
    if (icon !== undefined) { fields.push(`icon=$${idx++}`); vals.push(icon); }
    if (color !== undefined) { fields.push(`color=$${idx++}`); vals.push(color); }
    if (display_order !== undefined) { fields.push(`display_order=$${idx++}`); vals.push(display_order); }

    fields.push("updated_at=now()");
    vals.push(id);

    await pool.query(
      `UPDATE glo_equipment_categories SET ${fields.join(", ")} WHERE id=$${idx}`,
      vals
    );

    const { rows } = await pool.query(`SELECT * FROM glo_equipment_categories WHERE id=$1`, [id]);
    await logEvent("glo_category_updated", { id, fields: Object.keys(req.body || {}) }, u);
    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/glo/categories/:id
app.delete("/api/glo/categories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);

    const { rows: old } = await pool.query(`SELECT name FROM glo_equipment_categories WHERE id=$1`, [id]);
    await pool.query(`DELETE FROM glo_equipment_categories WHERE id=$1`, [id]);
    await logEvent("glo_category_deleted", { id, name: old[0]?.name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// SUBCATEGORIES API
// -------------------------------------------------

// GET /api/glo/subcategories?category_id=...
app.get("/api/glo/subcategories", async (req, res) => {
  try {
    const { category_id } = req.query;

    let query = `SELECT * FROM glo_equipment_subcategories`;
    let params = [];

    if (category_id) {
      query += ` WHERE category_id = $1`;
      params = [category_id];
    }

    query += ` ORDER BY display_order, name`;

    const { rows } = await pool.query(query, params);
    res.json({ ok: true, subcategories: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/glo/subcategories
app.post("/api/glo/subcategories", async (req, res) => {
  try {
    const u = getUser(req);
    const { category_id, name, description = '', display_order = 0 } = req.body || {};

    if (!category_id || !name)
      return res.status(400).json({ ok: false, error: "category_id and name required" });

    const { rows } = await pool.query(`
      INSERT INTO glo_equipment_subcategories (category_id, name, description, display_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [category_id, name, description, display_order]);

    await logEvent("glo_subcategory_created", { id: rows[0].id, name, category_id }, u);
    res.json({ ok: true, subcategory: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/glo/subcategories/:id
app.put("/api/glo/subcategories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);

    const { name, description, display_order } = req.body || {};

    const fields = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name=$${idx++}`); vals.push(name); }
    if (description !== undefined) { fields.push(`description=$${idx++}`); vals.push(description); }
    if (display_order !== undefined) { fields.push(`display_order=$${idx++}`); vals.push(display_order); }

    fields.push("updated_at=now()");
    vals.push(id);

    await pool.query(
      `UPDATE glo_equipment_subcategories SET ${fields.join(", ")} WHERE id=$${idx}`,
      vals
    );

    const { rows } = await pool.query(`SELECT * FROM glo_equipment_subcategories WHERE id=$1`, [id]);
    await logEvent("glo_subcategory_updated", { id, fields: Object.keys(req.body || {}) }, u);
    res.json({ ok: true, subcategory: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/glo/subcategories/:id
app.delete("/api/glo/subcategories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);

    const { rows: old } = await pool.query(`SELECT name FROM glo_equipment_subcategories WHERE id=$1`, [id]);
    await pool.query(`DELETE FROM glo_equipment_subcategories WHERE id=$1`, [id]);
    await logEvent("glo_subcategory_deleted", { id, name: old[0]?.name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// Health check
// -------------------------------------------------
app.get("/api/glo/health", (_req, res) => {
  res.json({ ok: true, service: "glo", timestamp: new Date().toISOString() });
});

// -------------------------------------------------
// REPORT PDF GENERATION - VERSION PROFESSIONNELLE
// -------------------------------------------------
app.get("/api/glo/report", async (req, res) => {
  try {
    const site = req.headers["x-site"] || "Default";
    const { building, floor, type, search, from_date, to_date } = req.query;

    // Couleurs professionnelles (bleu électrique)
    const colors = {
      primary: '#1e40af',
      secondary: '#3b82f6',
      success: '#059669',
      danger: '#dc2626',
      warning: '#d97706',
      text: '#111827',
      muted: '#6b7280',
      light: '#f3f4f6',
    };

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (building) { where += ` AND e.building = $${idx++}`; params.push(building); }
    if (floor) { where += ` AND e.floor = $${idx++}`; params.push(floor); }
    if (type) { where += ` AND e.equipment_type = $${idx++}`; params.push(type); }
    if (search) { where += ` AND (e.name ILIKE $${idx} OR e.tag ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (from_date) { where += ` AND e.created_at >= $${idx++}`; params.push(from_date); }
    if (to_date) { where += ` AND e.created_at <= $${idx++}`; params.push(to_date); }

    const { rows: equipments } = await pool.query(`
      SELECT e.*, c.name as category_name
        FROM glo_equipments e
        LEFT JOIN glo_equipment_categories c ON c.id = e.category_id
        ${where}
       ORDER BY e.equipment_type, e.building, e.floor, e.name
    `, params);

    // Get site settings
    let siteInfo = { company_name: site, site_name: site };
    try {
      const { rows } = await pool.query(`SELECT company_name, company_address FROM site_settings WHERE site = $1`, [site]);
      if (rows[0]) siteInfo = { ...siteInfo, ...rows[0] };
    } catch (e) { /* ignore */ }

    // Stats by type
    const byType = { ups: 0, battery: 0, lighting: 0 };
    equipments.forEach(e => { if (byType[e.equipment_type] !== undefined) byType[e.equipment_type]++; });

    // Group by building
    const byBuilding = {};
    equipments.forEach(e => {
      const bldg = e.building || 'Non renseigne';
      if (!byBuilding[bldg]) byBuilding[bldg] = [];
      byBuilding[bldg].push(e);
    });

    // Stats
    const criticalCount = equipments.filter(e => e.criticality === 'critical').length;
    const needsTestCount = equipments.filter(e => {
      if (!e.next_test_date) return false;
      return new Date(e.next_test_date) < new Date();
    }).length;

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: {
      Title: 'Rapport Equipements Electriques Globaux',
      Author: siteInfo.company_name,
      Subject: 'UPS, Batteries de compensation, Eclairage de securite'
    }});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Rapport_GLO_${site.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // ========== PAGE DE GARDE ==========
    doc.rect(0, 0, 595, 842).fill('#eff6ff');
    doc.rect(0, 0, 595, 120).fill(colors.primary);

    doc.fontSize(26).font('Helvetica-Bold').fillColor('#fff')
       .text('Rapport Equipements Electriques', 50, 35, { width: 495, align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#fff')
       .text('UPS - Batteries de compensation - Eclairage de securite', 50, 75, { width: 495, align: 'center' });

    doc.fontSize(22).font('Helvetica-Bold').fillColor(colors.primary)
       .text(siteInfo.company_name || 'Entreprise', 50, 160, { align: 'center', width: 495 });
    doc.fontSize(14).font('Helvetica').fillColor(colors.text)
       .text(`Site: ${site}`, 50, 195, { align: 'center', width: 495 });

    doc.fontSize(10).fillColor(colors.muted)
       .text(`Document genere le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`, 50, 230, { align: 'center', width: 495 });

    // Stats box
    const statsY = 280;
    doc.rect(100, statsY, 395, 220).fillAndStroke('#fff', colors.primary);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary)
       .text('Synthese', 120, statsY + 15, { width: 355, align: 'center' });

    const statsItems = [
      { label: 'Equipements total', value: equipments.length, color: colors.primary },
      { label: 'UPS / Onduleurs', value: byType.ups, color: colors.secondary },
      { label: 'Batteries de compensation', value: byType.battery, color: colors.secondary },
      { label: 'Eclairage de securite', value: byType.lighting, color: colors.secondary },
      { label: 'Equipements critiques', value: criticalCount, color: colors.danger },
      { label: 'Tests en retard', value: needsTestCount, color: needsTestCount > 0 ? colors.danger : colors.success },
    ];

    let statY = statsY + 50;
    statsItems.forEach(item => {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(item.label, 130, statY);
      doc.font('Helvetica-Bold').fillColor(item.color).text(String(item.value), 400, statY, { width: 70, align: 'right' });
      statY += 26;
    });

    // ========== SOMMAIRE ==========
    doc.addPage();
    doc.fontSize(24).font('Helvetica-Bold').fillColor(colors.primary).text('Sommaire', 50, 50);
    doc.moveTo(50, 85).lineTo(545, 85).strokeColor(colors.primary).lineWidth(2).stroke();

    const sommaire = [
      { num: '1', title: 'Reglementation applicable' },
      { num: '2', title: 'Presentation de l\'etablissement' },
      { num: '3', title: 'Inventaire par batiment' },
      { num: '4', title: 'Planification des tests' },
      { num: '5', title: 'Fiches equipements' },
    ];

    let somY = 110;
    sommaire.forEach(item => {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.text).text(item.num, 50, somY);
      doc.font('Helvetica').text(item.title, 80, somY);
      somY += 30;
    });

    // ========== 1. RÉGLEMENTATION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('1. Reglementation applicable', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let regY = 100;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(colors.text).text('Eclairage de securite (AEAI / SIA)', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('L\'eclairage de securite doit assurer l\'evacuation des personnes en cas de defaillance de l\'eclairage normal. Tests mensuels et annuels obligatoires.', 50, regY, { width: 495, align: 'justify' });
    regY += 50;

    doc.font('Helvetica-Bold').text('Alimentations sans interruption (UPS)', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('Les onduleurs doivent etre controles regulierement pour garantir leur fonctionnement en cas de coupure. Batterie a remplacer selon specifications fabricant.', 50, regY, { width: 495, align: 'justify' });
    regY += 50;

    doc.font('Helvetica-Bold').text('Batteries de compensation', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('La compensation de l\'energie reactive permet de reduire les pertes et d\'optimiser la facturation. Controle thermographique recommande annuellement.', 50, regY, { width: 495, align: 'justify' });

    // ========== 2. PRÉSENTATION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('2. Presentation de l\'etablissement', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let presY = 100;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary).text(siteInfo.company_name || 'Entreprise', 50, presY);
    presY += 25;
    if (siteInfo.company_address) {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(`Adresse: ${siteInfo.company_address}`, 50, presY);
      presY += 18;
    }
    doc.text(`Site: ${site}`, 50, presY);
    presY += 40;

    doc.fontSize(12).font('Helvetica-Bold').text('Synthese de l\'installation', 50, presY);
    presY += 25;

    [['Equipements GLO', equipments.length], ['Batiments', Object.keys(byBuilding).length], ['Types d\'equipements', Object.values(byType).filter(v => v > 0).length]].forEach(([label, value]) => {
      doc.rect(50, presY, 240, 35).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(10).font('Helvetica').fillColor(colors.muted).text(label, 60, presY + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(colors.primary).text(String(value), 220, presY + 8, { align: 'right', width: 50 });
      presY += 40;
    });

    // ========== 3. INVENTAIRE PAR BÂTIMENT ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('3. Inventaire par batiment', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let invY = 100;
    const invHeaders = ['Nom', 'Type', 'Etage', 'Puissance', 'Criticite', 'Statut'];
    const invColW = [130, 80, 50, 70, 70, 70];
    const typeLabels = { ups: 'UPS', battery: 'Batterie', lighting: 'Eclairage' };

    Object.entries(byBuilding).forEach(([bldg, bldgEquips]) => {
      if (invY > 700) { doc.addPage(); invY = 50; }

      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.primary).text(`Batiment: ${bldg}`, 50, invY);
      invY += 25;

      let x = 50;
      invHeaders.forEach((h, i) => {
        doc.rect(x, invY, invColW[i], 18).fillAndStroke(colors.primary, colors.primary);
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#fff').text(h, x + 3, invY + 5, { width: invColW[i] - 6 });
        x += invColW[i];
      });
      invY += 18;

      bldgEquips.forEach((eq, idx) => {
        if (invY > 750) { doc.addPage(); invY = 50; }
        const row = [
          (eq.name || '-').substring(0, 25),
          typeLabels[eq.equipment_type] || eq.equipment_type || '-',
          eq.floor || '-',
          eq.power_kw ? `${eq.power_kw} kW` : (eq.power_kva ? `${eq.power_kva} kVA` : '-'),
          eq.criticality || '-',
          eq.status || '-'
        ];

        x = 50;
        const bgColor = idx % 2 === 0 ? '#fff' : colors.light;
        row.forEach((cell, i) => {
          doc.rect(x, invY, invColW[i], 16).fillAndStroke(bgColor, '#e5e7eb');
          let txtColor = colors.text;
          if (i === 4 && cell === 'critical') txtColor = colors.danger;
          if (i === 5 && cell === 'ok') txtColor = colors.success;
          doc.fontSize(6).font('Helvetica').fillColor(txtColor).text(String(cell), x + 3, invY + 4, { width: invColW[i] - 6 });
          x += invColW[i];
        });
        invY += 16;
      });
      invY += 15;
    });

    // ========== 4. PLANIFICATION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('4. Planification des tests', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let planY = 100;
    const upcoming = equipments.filter(e => e.next_test_date).sort((a, b) => new Date(a.next_test_date) - new Date(b.next_test_date));

    if (upcoming.length > 0) {
      doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(`${upcoming.length} equipement(s) avec test planifie.`, 50, planY);
      planY += 25;

      const planHeaders = ['Equipement', 'Type', 'Batiment', 'Date test', 'Statut'];
      const planColW = [170, 80, 100, 80, 65];
      let x = 50;
      planHeaders.forEach((h, i) => {
        doc.rect(x, planY, planColW[i], 18).fillAndStroke(colors.primary, colors.primary);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff').text(h, x + 4, planY + 5);
        x += planColW[i];
      });
      planY += 18;

      upcoming.slice(0, 30).forEach((eq, idx) => {
        if (planY > 750) { doc.addPage(); planY = 50; }
        const nextDate = new Date(eq.next_test_date);
        const isLate = nextDate < new Date();
        const isClose = !isLate && (nextDate - new Date()) / (1000 * 60 * 60 * 24) < 30;
        const statusText = isLate ? 'RETARD' : (isClose ? 'PROCHE' : 'OK');
        const statusColor = isLate ? colors.danger : (isClose ? colors.warning : colors.success);

        const row = [(eq.name || '-').substring(0, 32), typeLabels[eq.equipment_type] || '-', (eq.building || '-').substring(0, 18), nextDate.toLocaleDateString('fr-FR'), statusText];
        x = 50;
        const bgColor = idx % 2 === 0 ? '#fff' : colors.light;
        row.forEach((cell, i) => {
          doc.rect(x, planY, planColW[i], 16).fillAndStroke(bgColor, '#e5e7eb');
          const col = i === 4 ? statusColor : colors.text;
          doc.fontSize(7).font('Helvetica').fillColor(col).text(String(cell), x + 4, planY + 4);
          x += planColW[i];
        });
        planY += 16;
      });
    } else {
      doc.fontSize(11).font('Helvetica').fillColor(colors.muted).text('Aucun test planifie.', 50, planY);
    }

    // ========== 5. FICHES ÉQUIPEMENTS ==========
    if (equipments.length > 0) {
      doc.addPage();
      doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('5. Fiches equipements', 50, 50);
      doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

      let ficheY = 100;
      doc.fontSize(11).font('Helvetica').fillColor(colors.muted).text(`${equipments.length} equipement(s)`, 50, ficheY);
      ficheY += 30;

      for (let i = 0; i < equipments.length; i++) {
        const eq = equipments[i];
        const cardHeight = 200;

        if (ficheY + cardHeight > 750) {
          doc.addPage();
          ficheY = 50;
        }

        doc.rect(50, ficheY, 495, cardHeight).stroke(colors.light);
        doc.rect(50, ficheY, 495, 28).fill(colors.primary);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#fff')
           .text(`${eq.name || 'Equipement sans nom'}`, 60, ficheY + 8, { width: 380 });

        const typeLabel = typeLabels[eq.equipment_type] || eq.equipment_type || '-';
        doc.fontSize(8).font('Helvetica').fillColor('#fff').text(typeLabel, 450, ficheY + 10, { width: 80, align: 'right' });

        let infoY = ficheY + 38;
        const leftCol = 60;
        const rightCol = 300;

        // Left column
        const leftInfo = [
          ['Tag', eq.tag || '-'],
          ['Batiment', eq.building || '-'],
          ['Etage', eq.floor || '-'],
          ['Zone', eq.zone || '-'],
          ['Fabricant', eq.manufacturer || '-'],
          ['Modele', eq.model || '-'],
        ];
        leftInfo.forEach(([label, value]) => {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(colors.text).text(label + ':', leftCol, infoY);
          doc.font('Helvetica').fillColor(colors.muted).text(value.substring(0, 25), leftCol + 60, infoY);
          infoY += 14;
        });

        // Right column
        infoY = ficheY + 38;
        const rightInfo = [
          ['Puissance', eq.power_kw ? `${eq.power_kw} kW` : (eq.power_kva ? `${eq.power_kva} kVA` : '-')],
          ['Tension', eq.voltage_input ? `${eq.voltage_input}V` : '-'],
          ['Criticite', eq.criticality || '-'],
          ['Statut', eq.status || '-'],
          ['Dernier test', eq.last_test_date ? new Date(eq.last_test_date).toLocaleDateString('fr-FR') : '-'],
          ['Prochain test', eq.next_test_date ? new Date(eq.next_test_date).toLocaleDateString('fr-FR') : '-'],
        ];
        rightInfo.forEach(([label, value]) => {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(colors.text).text(label + ':', rightCol, infoY);
          let valColor = colors.muted;
          if (label === 'Criticite' && value === 'critical') valColor = colors.danger;
          if (label === 'Statut' && value === 'ok') valColor = colors.success;
          doc.font('Helvetica').fillColor(valColor).text(value, rightCol + 70, infoY);
          infoY += 14;
        });

        // Photo placeholder
        const photoX = 430;
        const photoY = ficheY + 38;
        if (eq.photo_content && eq.photo_content.length > 0) {
          try {
            doc.image(eq.photo_content, photoX, photoY, { fit: [100, 80] });
            doc.rect(photoX, photoY, 100, 80).stroke('#e5e7eb');
          } catch (e) {
            doc.rect(photoX, photoY, 100, 80).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Photo N/A', photoX + 25, photoY + 35);
          }
        } else {
          doc.rect(photoX, photoY, 100, 80).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Pas de photo', photoX + 20, photoY + 35);
        }

        // Type-specific info box
        let specY = ficheY + 130;
        doc.rect(60, specY, 425, 60).fillAndStroke(colors.light, '#e5e7eb');
        doc.fontSize(8).font('Helvetica-Bold').fillColor(colors.primary).text('Caracteristiques specifiques:', 70, specY + 8);

        if (eq.equipment_type === 'ups') {
          doc.fontSize(7).font('Helvetica').fillColor(colors.text)
             .text(`Topologie: ${eq.ups_topology || '-'} | Autonomie: ${eq.autonomy_minutes ? eq.autonomy_minutes + ' min' : '-'} | Batteries: ${eq.battery_count || '-'} | Rendement: ${eq.efficiency_percent ? eq.efficiency_percent + '%' : '-'}`, 70, specY + 25, { width: 405 });
        } else if (eq.equipment_type === 'battery') {
          doc.fontSize(7).font('Helvetica').fillColor(colors.text)
             .text(`Puissance reactive: ${eq.reactive_power_kvar ? eq.reactive_power_kvar + ' kVAr' : '-'} | Type: ${eq.capacitor_type || '-'} | Etapes: ${eq.steps || '-'} | Filtre THD: ${eq.thd_filter ? 'Oui' : 'Non'}`, 70, specY + 25, { width: 405 });
        } else if (eq.equipment_type === 'lighting') {
          doc.fontSize(7).font('Helvetica').fillColor(colors.text)
             .text(`Type eclairage: ${eq.lighting_type || '-'} | Lampe: ${eq.lamp_type || '-'} | Flux: ${eq.lumen_output ? eq.lumen_output + ' lm' : '-'} | Autonomie: ${eq.autonomy_hours ? eq.autonomy_hours + 'h' : '-'} | Auto-test: ${eq.self_test ? 'Oui' : 'Non'}`, 70, specY + 25, { width: 405 });
        } else {
          doc.fontSize(7).font('Helvetica').fillColor(colors.muted).text('Aucune caracteristique specifique', 70, specY + 25);
        }

        ficheY += cardHeight + 10;
      }
    }

    // ========== PAGINATION ==========
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Rapport GLO - ${site} - Page ${i + 1}/${range.count}`, 50, 810, { align: 'center', width: 495, lineBreak: false });
    }

    doc.end();
    console.log(`[GLO] Generated professional report: ${equipments.length} equipments`);

  } catch (e) {
    console.error('[GLO] Report error:', e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// Start
// -------------------------------------------------
async function start() {
  await ensureSchema();
  app.listen(PORT, HOST, () => {
    console.log(`[GLO] Global Electrical Equipments service running on http://${HOST}:${PORT}`);
  });
}

start().catch((e) => {
  console.error("[GLO] Fatal:", e);
  process.exit(1);
});

export default app;
