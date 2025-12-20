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

    // Upsert position
    const { rows } = await pool.query(`
      INSERT INTO glo_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (equipment_id, logical_name, page_index)
      DO UPDATE SET x_frac = $5, y_frac = $6, plan_id = $3
      RETURNING *
    `, [equipment_id, finalLogicalName, plan_id || null, page_index, x_frac, y_frac]);

    await logEvent("glo_position_set", { equipment_id, logical_name: finalLogicalName, page_index }, u);
    res.json({ ok: true, position: rows[0] });
  } catch (e) {
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
// REPORT PDF GENERATION
// -------------------------------------------------
app.get("/api/glo/report", async (req, res) => {
  try {
    const site = req.headers["x-site"] || "Default";
    const { building, floor, type, search, from_date, to_date } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (building) { where += ` AND e.building = $${idx++}`; params.push(building); }
    if (floor) { where += ` AND e.floor = $${idx++}`; params.push(floor); }
    if (type) { where += ` AND e.type = $${idx++}`; params.push(type); }
    if (search) { where += ` AND (e.name ILIKE $${idx} OR e.code ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (from_date) { where += ` AND e.created_at >= $${idx++}`; params.push(from_date); }
    if (to_date) { where += ` AND e.created_at <= $${idx++}`; params.push(to_date); }

    const { rows: equipments } = await pool.query(`
      SELECT e.*
        FROM glo_equipments e
        ${where}
       ORDER BY e.type, e.building, e.floor, e.name
    `, params);

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport_glo_${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#1e40af').text('RAPPORT GLO', 50, 50, { align: 'center' });
    doc.fontSize(12).fillColor('#6b7280').text('UPS, Batteries de compensation, Éclairage de sécurité', { align: 'center' });
    doc.fontSize(10).text(`Généré le ${new Date().toLocaleDateString('fr-FR')} - Site: ${site}`, { align: 'center' });

    // Stats by type
    const byType = { ups: 0, battery: 0, lighting: 0 };
    equipments.forEach(e => { if (byType[e.type] !== undefined) byType[e.type]++; });

    let y = 120;
    doc.rect(50, y, 495, 50).fill('#f3f4f6');
    doc.fontSize(11).fillColor('#374151');
    doc.text(`Total: ${equipments.length}`, 60, y + 12);
    doc.text(`UPS: ${byType.ups}`, 180, y + 12);
    doc.text(`Batteries: ${byType.battery}`, 300, y + 12);
    doc.text(`Éclairage: ${byType.lighting}`, 420, y + 12);

    y += 70;
    doc.fontSize(14).fillColor('#1e40af').text('Liste des équipements', 50, y);
    y += 25;

    doc.rect(50, y, 495, 20).fill('#e5e7eb');
    doc.fontSize(9).fillColor('#374151');
    doc.text('Type', 55, y + 6);
    doc.text('Nom', 120, y + 6);
    doc.text('Bâtiment', 280, y + 6);
    doc.text('Étage', 380, y + 6);
    doc.text('Statut', 440, y + 6);
    y += 20;

    const typeLabels = { ups: 'UPS', battery: 'Batterie', lighting: 'Éclairage' };
    for (const eq of equipments) {
      if (y > 750) { doc.addPage(); y = 50; }
      const bgColor = equipments.indexOf(eq) % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(50, y, 495, 18).fill(bgColor);
      doc.fontSize(8).fillColor('#374151');
      doc.text(typeLabels[eq.type] || eq.type || '-', 55, y + 5, { width: 60 });
      doc.text((eq.name || '-').substring(0, 35), 120, y + 5, { width: 155 });
      doc.text((eq.building || '-').substring(0, 15), 280, y + 5, { width: 95 });
      doc.text(eq.floor || '-', 380, y + 5, { width: 55 });
      doc.text(eq.status || '-', 440, y + 5);
      y += 18;
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#9ca3af').text(`Page ${i + 1} / ${pages.count}`, 50, 800, { align: 'center', width: 495 });
    }
    doc.end();
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
