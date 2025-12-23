// ==============================
// server_meca.js — Équipements électromécaniques (ESM)
// ✅ VERSION 2.0 - MULTI-TENANT (Company + Site)
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
import { createCanvas } from "canvas";
import { extractTenantFromRequest, getTenantFilter, enrichTenantWithSiteId } from "./lib/tenant-filter.js";
import { notifyEquipmentCreated, notifyEquipmentDeleted, notifyMaintenanceCompleted } from "./lib/push-notify.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------ Config service ------------------
const PORT = Number(process.env.MECA_PORT || 3021);
const HOST = process.env.MECA_HOST || "0.0.0.0";

// Dossiers data
const DATA_DIR =
  process.env.MECA_DATA_DIR || path.resolve(__dirname, "./_data_meca");
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
    process.env.MECA_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -------------------------------------------------
// Schéma BDD
// -------------------------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Équipements électromécaniques
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Identification
      name TEXT NOT NULL,
      tag TEXT DEFAULT '',
      equipment_type TEXT DEFAULT '',   -- pompe, moteur, ventilateur, porte, barrière...
      category TEXT DEFAULT '',         -- ex: "pompage", "ventilation", "accès"
      function TEXT DEFAULT '',         -- service rendu (refoulement, extraction, etc.)

      -- Localisation
      building TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      panel TEXT DEFAULT '',            -- tableau / départ électrique

      -- Données électriques
      power_kw NUMERIC DEFAULT NULL,
      voltage TEXT DEFAULT '',
      current_a NUMERIC DEFAULT NULL,
      speed_rpm NUMERIC DEFAULT NULL,
      ip_rating TEXT DEFAULT '',        -- IP55, IP65...

      -- Données mécaniques / process
      drive_type TEXT DEFAULT '',       -- direct, courroie, accouplement...
      coupling TEXT DEFAULT '',         -- type d'accouplement
      mounting TEXT DEFAULT '',         -- montage (horizontal, vertical, plafond...)
      fluid TEXT DEFAULT '',            -- eau, air, boues...
      flow_m3h NUMERIC DEFAULT NULL,
      pressure_bar NUMERIC DEFAULT NULL,

      -- Fabricant
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      year TEXT DEFAULT '',             -- année de fabrication ou mise en service

      -- Gestion
      status TEXT DEFAULT '',           -- en service / à l'arrêt / en panne...
      criticality TEXT DEFAULT '',      -- faible / moyenne / haute
      comments TEXT DEFAULT '',

      -- Photo
      photo_path TEXT DEFAULT NULL,
      photo_content BYTEA NULL,

      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);

  // Add multi-tenant columns if they don't exist (for existing databases)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE meca_equipments ADD COLUMN IF NOT EXISTS company_id INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE meca_equipments ADD COLUMN IF NOT EXISTS site_id INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_meca_eq_name ON meca_equipments(name);
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meca_eq_company ON meca_equipments(company_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meca_eq_site ON meca_equipments(site_id);`);

  // 🔥 MIGRATION: Peupler company_id/site_id pour les équipements existants (NULL)
  try {
    const defaultSiteRes = await pool.query(`SELECT id, company_id FROM sites ORDER BY id LIMIT 1`);
    if (defaultSiteRes.rows[0]) {
      const defaultSite = defaultSiteRes.rows[0];
      const updateRes = await pool.query(`
        UPDATE meca_equipments
        SET company_id = $1, site_id = $2
        WHERE company_id IS NULL OR site_id IS NULL
      `, [defaultSite.company_id, defaultSite.id]);
      if (updateRes.rowCount > 0) {
        console.log(`[MECA] Migration: ${updateRes.rowCount} équipements mis à jour avec company_id=${defaultSite.company_id}, site_id=${defaultSite.id}`);
      }
    }
  } catch (migrationErr) {
    console.warn(`[MECA] Migration tenant warning:`, migrationErr.message);
  }

  // Fichiers attachés
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
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_meca_files_eq ON meca_files(equipment_id);
  `);

  // Plans PDF
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
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_meca_plans_logical ON meca_plans(logical_name);
  `);

  // Migration: add thumbnail column for pre-generated plan thumbnails
  await pool.query(`ALTER TABLE meca_plans ADD COLUMN IF NOT EXISTS thumbnail BYTEA NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `);

  // Positions sur plans
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
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_meca_positions_lookup ON meca_positions(logical_name, page_index);
  `);

  // Audit simple
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMP DEFAULT now(),
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_meca_events_ts ON meca_events(ts DESC);
  `);

  // ========== EQUIPMENT CATEGORIES & SUBCATEGORIES ==========

  // Catégories d'équipements (ex: Porte Automatique, Ascenseur, CVC...)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_equipment_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '#f97316',
      display_order INTEGER DEFAULT 0,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meca_cat_company ON meca_equipment_categories(company_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meca_cat_site ON meca_equipment_categories(site_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meca_cat_order ON meca_equipment_categories(display_order);`);

  // Sous-catégories d'équipements (ex: Moteur, Capteur, Carte électronique...)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meca_equipment_subcategories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID NOT NULL REFERENCES meca_equipment_categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meca_subcat_category ON meca_equipment_subcategories(category_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meca_subcat_order ON meca_equipment_subcategories(display_order);`);

  // Add subcategory_id to equipments table if not exists
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE meca_equipments ADD COLUMN IF NOT EXISTS subcategory_id UUID REFERENCES meca_equipment_subcategories(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE meca_equipments ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES meca_equipment_categories(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;
  `);
}

// -------------------------------------------------
// Helpers
// -------------------------------------------------
async function logEvent(action, details = {}, user = {}) {
  try {
    await pool.query(
      `INSERT INTO meca_events(action, details, actor_name, actor_email)
       VALUES($1,$2,$3,$4)`,
      [action, details, user.name || null, user.email || null]
    );
  } catch {
    // on ne bloque jamais l'appli pour un log
  }
}

// -------------------------------------------------
// API ÉQUIPEMENTS
// -------------------------------------------------

// GET /api/meca/equipments
app.get("/api/meca/equipments", async (req, res) => {
  try {
    // 🏢 MULTI-TENANT: Extraire les infos tenant
    // 🔥 Enrichir avec site_id depuis X-Site si manquant (pour utilisateurs externes)
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);
    const tenantFilter = getTenantFilter(tenant, { tableAlias: 'e' });

    const { rows } = await pool.query(`
      SELECT e.*
        FROM meca_equipments e
       WHERE ${tenantFilter.where}
       ORDER BY e.building, e.zone, e.name
    `, tenantFilter.params);

    for (const r of rows) {
      r.photo_url =
        (r.photo_content && r.photo_content.length) || r.photo_path
          ? `/api/meca/equipments/${r.id}/photo`
          : null;
    }

    res.json({ ok: true, equipments: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/meca/equipments/:id
app.get("/api/meca/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT * FROM meca_equipments WHERE id=$1`,
      [id]
    );
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "Not found" });
    const eq = rows[0];
    eq.photo_url =
      (eq.photo_content && eq.photo_content.length) || eq.photo_path
        ? `/api/meca/equipments/${id}/photo`
        : null;
    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/meca/equipments
app.post("/api/meca/equipments", async (req, res) => {
  try {
    const u = getUser(req);
    // 🏢 MULTI-TENANT: Extraire les infos tenant
    // 🔥 Enrichir avec site_id depuis X-Site si manquant (pour utilisateurs externes)
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);

    const {
      name = "",
      tag = "",
      equipment_type = "",
      category = "",
      category_id = null,
      subcategory_id = null,
      function: func = "",

      building = "",
      floor = "",
      zone = "",
      location = "",
      panel = "",

      power_kw = null,
      voltage = "",
      current_a = null,
      speed_rpm = null,
      ip_rating = "",

      drive_type = "",
      coupling = "",
      mounting = "",
      fluid = "",
      flow_m3h = null,
      pressure_bar = null,

      manufacturer = "",
      model = "",
      serial_number = "",
      year = "",

      status = "",
      criticality = "",
      comments = "",
    } = req.body || {};

    const { rows } = await pool.query(
      `INSERT INTO meca_equipments(
         company_id, site_id,
         name, tag, equipment_type, category, category_id, subcategory_id, function,
         building, floor, zone, location, panel,
         power_kw, voltage, current_a, speed_rpm, ip_rating,
         drive_type, coupling, mounting, fluid, flow_m3h, pressure_bar,
         manufacturer, model, serial_number, year,
         status, criticality, comments
       )
       VALUES(
         $1,$2,
         $3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,
         $20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29,
         $30,$31,$32
       )
       RETURNING *`,
      [
        tenant.companyId,
        tenant.siteId,
        name,
        tag,
        equipment_type,
        category,
        category_id || null,
        subcategory_id || null,
        func,
        building,
        floor,
        zone,
        location,
        panel,
        power_kw,
        voltage,
        current_a,
        speed_rpm,
        ip_rating,
        drive_type,
        coupling,
        mounting,
        fluid,
        flow_m3h,
        pressure_bar,
        manufacturer,
        model,
        serial_number,
        year,
        status,
        criticality,
        comments,
      ]
    );

    const eq = rows[0];
    eq.photo_url = null;

    await logEvent("meca_equipment_created", { id: eq.id, name: eq.name }, u);

    // 🔔 Push notification for new equipment
    notifyEquipmentCreated('meca', eq, u?.email || u?.id).catch(err => console.log('[MECA] Push notify error:', err.message));

    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/meca/equipments/:id
app.put("/api/meca/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);

    const {
      name,
      tag,
      equipment_type,
      category,
      category_id,
      subcategory_id,
      function: func,
      building,
      floor,
      zone,
      location,
      panel,
      power_kw,
      voltage,
      current_a,
      speed_rpm,
      ip_rating,
      drive_type,
      coupling,
      mounting,
      fluid,
      flow_m3h,
      pressure_bar,
      manufacturer,
      model,
      serial_number,
      year,
      status,
      criticality,
      comments,
    } = req.body || {};

    const fields = [];
    const vals = [];
    let idx = 1;

    const pushField = (col, val) => {
      fields.push(`${col}=$${idx++}`);
      vals.push(val);
    };

    if (name !== undefined) pushField("name", name);
    if (tag !== undefined) pushField("tag", tag);
    if (equipment_type !== undefined) pushField("equipment_type", equipment_type);
    if (category !== undefined) pushField("category", category);
    if (category_id !== undefined) pushField("category_id", category_id || null);
    if (subcategory_id !== undefined) pushField("subcategory_id", subcategory_id || null);
    if (func !== undefined) pushField("function", func);

    if (building !== undefined) pushField("building", building);
    if (floor !== undefined) pushField("floor", floor);
    if (zone !== undefined) pushField("zone", zone);
    if (location !== undefined) pushField("location", location);
    if (panel !== undefined) pushField("panel", panel);

    if (power_kw !== undefined) pushField("power_kw", power_kw);
    if (voltage !== undefined) pushField("voltage", voltage);
    if (current_a !== undefined) pushField("current_a", current_a);
    if (speed_rpm !== undefined) pushField("speed_rpm", speed_rpm);
    if (ip_rating !== undefined) pushField("ip_rating", ip_rating);

    if (drive_type !== undefined) pushField("drive_type", drive_type);
    if (coupling !== undefined) pushField("coupling", coupling);
    if (mounting !== undefined) pushField("mounting", mounting);
    if (fluid !== undefined) pushField("fluid", fluid);
    if (flow_m3h !== undefined) pushField("flow_m3h", flow_m3h);
    if (pressure_bar !== undefined) pushField("pressure_bar", pressure_bar);

    if (manufacturer !== undefined) pushField("manufacturer", manufacturer);
    if (model !== undefined) pushField("model", model);
    if (serial_number !== undefined) pushField("serial_number", serial_number);
    if (year !== undefined) pushField("year", year);

    if (status !== undefined) pushField("status", status);
    if (criticality !== undefined) pushField("criticality", criticality);
    if (comments !== undefined) pushField("comments", comments);

    fields.push("updated_at=now()");

    vals.push(id);

    await pool.query(
      `UPDATE meca_equipments SET ${fields.join(", ")} WHERE id=$${idx}`,
      vals
    );

    const { rows } = await pool.query(
      `SELECT * FROM meca_equipments WHERE id=$1`,
      [id]
    );
    const eq = rows[0];
    if (eq) {
      eq.photo_url =
        (eq.photo_content && eq.photo_content.length) || eq.photo_path
          ? `/api/meca/equipments/${id}/photo`
          : null;
    }

    await logEvent(
      "meca_equipment_updated",
      { id, fields: Object.keys(req.body || {}) },
      u
    );

    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/meca/equipments/:id
app.delete("/api/meca/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows: old } = await pool.query(
      `SELECT id, name FROM meca_equipments WHERE id=$1`,
      [id]
    );
    await pool.query(`DELETE FROM meca_equipments WHERE id=$1`, [id]);
    await logEvent(
      "meca_equipment_deleted",
      { id, name: old[0]?.name },
      u
    );

    // 🔔 Push notification for deleted equipment
    if (old[0]) {
      notifyEquipmentDeleted('meca', old[0], u?.email || u?.id).catch(err => console.log('[MECA] Push notify error:', err.message));
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// Photo principale
// -------------------------------------------------

// GET /api/meca/equipments/:id/photo
app.get("/api/meca/equipments/:id/photo", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT photo_content, photo_path FROM meca_equipments WHERE id=$1`,
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

// POST /api/meca/equipments/:id/photo
app.post(
  "/api/meca/equipments/:id/photo",
  multerFiles.single("photo"),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const u = getUser(req);
      if (!req.file)
        return res.status(400).json({ ok: false, error: "No file" });
      const buf = await fsp.readFile(req.file.path);
      await pool.query(
        `UPDATE meca_equipments
           SET photo_content=$1, photo_path=$2, updated_at=now()
         WHERE id=$3`,
        [buf, req.file.path, id]
      );
      await logEvent("meca_equipment_photo_updated", { id }, u);
      res.json({ ok: true, photo_url: `/api/meca/equipments/${id}/photo` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// -------------------------------------------------
// FICHIERS ATTACHÉS
// -------------------------------------------------

// GET /api/meca/files?equipment_id=...
app.get("/api/meca/files", async (req, res) => {
  try {
    const eqId = req.query.equipment_id;
    if (!eqId)
      return res
        .status(400)
        .json({ ok: false, error: "equipment_id required" });

    const { rows } = await pool.query(
      `SELECT id, equipment_id, original_name, mime, uploaded_at
         FROM meca_files
        WHERE equipment_id=$1
        ORDER BY uploaded_at DESC`,
      [String(eqId)]
    );

    for (const f of rows) {
      f.url = `/api/meca/files/${f.id}`;
    }

    res.json({ ok: true, files: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/meca/files
app.post(
  "/api/meca/files",
  multerFiles.array("files"),
  async (req, res) => {
    try {
      const u = getUser(req);
      const eqId = req.body.equipment_id;
      if (!eqId)
        return res
          .status(400)
          .json({ ok: false, error: "equipment_id required" });

      const inserted = [];
      for (const f of req.files || []) {
        const buf = await fsp.readFile(f.path);
        const { rows } = await pool.query(
          `INSERT INTO meca_files(equipment_id, original_name, mime, file_path, file_content)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [eqId, f.originalname, f.mimetype, f.path, buf]
        );
        inserted.push({ ...rows[0], url: `/api/meca/files/${rows[0].id}` });
      }

      await logEvent(
        "meca_files_uploaded",
        { equipment_id: eqId, count: inserted.length },
        u
      );

      res.json({ ok: true, files: inserted });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// GET /api/meca/files/:id
app.get("/api/meca/files/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT original_name, mime, file_content, file_path
         FROM meca_files
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

// DELETE /api/meca/files/:id
app.delete("/api/meca/files/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    await pool.query(`DELETE FROM meca_files WHERE id=$1`, [id]);
    await logEvent("meca_file_deleted", { file_id: id }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// MAPS (Plans PDF + positions)
// -------------------------------------------------

// POST /api/meca/maps/uploadZip - Uses VSD plans for symbiosis (shared plans across modules)
app.post(
  "/api/meca/maps/uploadZip",
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

        // Use VSD plans for symbiosis with all modules
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
      await logEvent(
        "meca_maps_zip_uploaded",
        { count: imported.length },
        u
      );
      res.json({ ok: true, imported });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// GET /api/meca/maps/listPlans - Uses VSD plans for symbiosis (shared plans across modules)
app.get("/api/meca/maps/listPlans", async (_req, res) => {
  try {
    // Use VSD plans (vsd_plans, vsd_plan_names) for symbiosis with all modules
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

// GET /api/meca/maps/planFile?logical_name=... or ?id=... - Uses VSD plans for symbiosis
app.get("/api/meca/maps/planFile", async (req, res) => {
  try {
    const { logical_name, id } = req.query;
    // Use VSD plans for symbiosis with all modules
    let q = `SELECT file_path, content, filename FROM vsd_plans WHERE `;
    let val;

    if (id) {
      q += `id=$1`;
      val = String(id);
    } else if (logical_name) {
      q += `logical_name=$1 ORDER BY version DESC LIMIT 1`;
      val = String(logical_name);
    } else {
      return res
        .status(400)
        .json({ ok: false, error: "id or logical_name required" });
    }

    const { rows } = await pool.query(q, [val]);
    if (!rows[0])
      return res.status(404).json({ ok: false, error: "Plan not found" });

    const { content, file_path, filename } = rows[0];

    if (content && content.length) {
      res.set("Content-Type", "application/pdf");
      res.set(
        "Content-Disposition",
        `inline; filename="${filename || "plan.pdf"}"`
      );
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(content);
    }

    if (file_path && fs.existsSync(file_path)) {
      res.set("Content-Type", "application/pdf");
      res.set(
        "Content-Disposition",
        `inline; filename="${filename || "plan.pdf"}"`
      );
      res.set("Cache-Control", "public, max-age=3600");
      return res.sendFile(path.resolve(file_path));
    }

    res.status(404).json({ ok: false, error: "No file" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/meca/maps/renamePlan
app.put("/api/meca/maps/renamePlan", async (req, res) => {
  try {
    const u = getUser(req);
    const { logical_name, display_name } = req.body || {};
    if (!logical_name)
      return res
        .status(400)
        .json({ ok: false, error: "logical_name required" });

    await pool.query(
      `INSERT INTO meca_plan_names(logical_name, display_name)
       VALUES($1,$2)
       ON CONFLICT(logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [logical_name, display_name || ""]
    );

    await logEvent(
      "meca_plan_renamed",
      { logical_name, display_name },
      u
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/meca/maps/placed-ids - Get all equipment IDs that have placements
app.get("/api/meca/maps/placed-ids", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT pos.equipment_id,
             array_agg(DISTINCT pos.logical_name) as plans
        FROM meca_positions pos
        JOIN meca_equipments e ON e.id = pos.equipment_id
       GROUP BY pos.equipment_id
    `);

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

// GET /api/meca/maps/positions
app.get("/api/meca/maps/positions", async (req, res) => {
  try {
    const { logical_name, id, page_index = 0 } = req.query;
    if (!logical_name && !id)
      return res
        .status(400)
        .json({ ok: false, error: "logical_name or id required" });

    let planKey = logical_name;
    if (id) {
      // Use VSD plans for symbiosis
      const { rows: pRows } = await pool.query(
        `SELECT logical_name FROM vsd_plans WHERE id=$1`,
        [String(id)]
      );
      if (pRows[0]) planKey = pRows[0].logical_name;
    }

    const { rows } = await pool.query(
      `SELECT pos.equipment_id,
              pos.x_frac,
              pos.y_frac,
              e.name,
              e.status,
              e.building,
              e.zone,
              e.floor,
              e.location
         FROM meca_positions pos
         JOIN meca_equipments e ON e.id = pos.equipment_id
        WHERE pos.logical_name=$1
          AND pos.page_index=$2`,
      [planKey, Number(page_index)]
    );

    res.json({ ok: true, positions: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/meca/maps/setPosition
// This ensures equipment is only on ONE plan at a time (deletes ALL old positions first)
app.post("/api/meca/maps/setPosition", async (req, res) => {
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
      return res
        .status(400)
        .json({ ok: false, error: "Missing fields" });
    }

    // CRITICAL: Delete ALL existing positions for this equipment
    // This ensures the equipment is NEVER on multiple plans
    const deleteResult = await pool.query(
      `DELETE FROM meca_positions WHERE equipment_id = $1`,
      [equipment_id]
    );
    console.log(`[MECA MAPS] Deleted ${deleteResult.rowCount} old positions for equipment ${equipment_id}`);

    // Then insert the new position
    await pool.query(
      `INSERT INTO meca_positions(
         equipment_id, logical_name, plan_id, page_index, x_frac, y_frac
       )
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        equipment_id,
        logical_name,
        plan_id,
        Number(page_index),
        Number(x_frac),
        Number(y_frac),
      ]
    );

    console.log(`[MECA MAPS] Created new position for equipment ${equipment_id} on plan ${logical_name}`);
    await logEvent(
      "meca_position_set",
      { equipment_id, logical_name, page_index },
      u
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("[MECA MAPS] Set position error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cleanup duplicate positions
app.post("/api/meca/maps/cleanup-duplicates", async (req, res) => {
  try {
    const { rows: duplicates } = await pool.query(`
      SELECT equipment_id, COUNT(*) as count
      FROM meca_positions
      GROUP BY equipment_id
      HAVING COUNT(*) > 1
    `);

    console.log(`[MECA MAPS] Found ${duplicates.length} equipments with duplicate positions`);

    let totalRemoved = 0;
    for (const dup of duplicates) {
      const result = await pool.query(`
        DELETE FROM meca_positions
        WHERE equipment_id = $1
        AND id NOT IN (
          SELECT id FROM meca_positions
          WHERE equipment_id = $1
          ORDER BY id DESC
          LIMIT 1
        )
      `, [dup.equipment_id]);
      totalRemoved += result.rowCount;
    }

    res.json({ ok: true, duplicates_found: duplicates.length, positions_removed: totalRemoved });
  } catch (e) {
    console.error("[MECA MAPS] Cleanup error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// API EQUIPMENT CATEGORIES
// -------------------------------------------------

// GET /api/meca/categories - List all categories with their subcategories
app.get("/api/meca/categories", async (req, res) => {
  try {
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);
    let tenantFilter = getTenantFilter(tenant, { tableAlias: 'c' });

    // Debug logging
    console.log('[MECA] GET categories - tenant:', JSON.stringify({
      companyId: tenant.companyId,
      siteId: tenant.siteId,
      siteName: tenant.siteName,
      role: tenant.role,
      email: tenant.email
    }));
    console.log('[MECA] GET categories - filter:', tenantFilter.where, tenantFilter.params);

    // If filter would block all results (1=0), try a more permissive approach
    // This handles cases where tenant info might be missing but we still want to show categories
    if (tenantFilter.where === '1=0') {
      console.log('[MECA] Tenant filter would block all - using site_id from enrichment if available');
      // Try just filtering by site_id if we have it from enrichment
      if (tenant.siteId) {
        tenantFilter = {
          where: 'c.site_id = $1',
          params: [tenant.siteId]
        };
      } else if (tenant.companyId) {
        tenantFilter = {
          where: 'c.company_id = $1',
          params: [tenant.companyId]
        };
      } else {
        // Last resort: show all categories (for development/testing)
        console.log('[MECA] No tenant info - showing all categories');
        tenantFilter = { where: '1=1', params: [] };
      }
    }

    const { rows: categories } = await pool.query(`
      SELECT c.*
        FROM meca_equipment_categories c
       WHERE ${tenantFilter.where}
       ORDER BY c.display_order, c.name
    `, tenantFilter.params);

    console.log('[MECA] GET categories - found:', categories.length);

    // Get subcategories for each category
    for (const cat of categories) {
      const { rows: subcats } = await pool.query(`
        SELECT * FROM meca_equipment_subcategories
         WHERE category_id = $1
         ORDER BY display_order, name
      `, [cat.id]);
      cat.subcategories = subcats;
    }

    res.json({ ok: true, categories });
  } catch (e) {
    console.error('[MECA] GET categories error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/meca/categories/:id - Get single category with subcategories
app.get("/api/meca/categories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(
      `SELECT * FROM meca_equipment_categories WHERE id=$1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Category not found" });

    const category = rows[0];
    const { rows: subcats } = await pool.query(`
      SELECT * FROM meca_equipment_subcategories
       WHERE category_id = $1
       ORDER BY display_order, name
    `, [id]);
    category.subcategories = subcats;

    res.json({ ok: true, category });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/meca/categories - Create category
app.post("/api/meca/categories", async (req, res) => {
  try {
    const u = getUser(req);
    const baseTenant = extractTenantFromRequest(req);
    const tenant = await enrichTenantWithSiteId(baseTenant, req, pool);

    const { name = "", description = "", icon = "", color = "#f97316", display_order = 0 } = req.body || {};

    if (!name.trim()) {
      return res.status(400).json({ ok: false, error: "Name is required" });
    }

    const { rows } = await pool.query(`
      INSERT INTO meca_equipment_categories(company_id, site_id, name, description, icon, color, display_order)
      VALUES($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [tenant.companyId, tenant.siteId, name.trim(), description, icon, color, display_order]);

    const category = rows[0];
    category.subcategories = [];

    await logEvent("meca_category_created", { id: category.id, name: category.name }, u);
    res.json({ ok: true, category });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/meca/categories/:id - Update category
app.put("/api/meca/categories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { name, description, icon, color, display_order } = req.body || {};

    const fields = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name=$${idx++}`); vals.push(name.trim()); }
    if (description !== undefined) { fields.push(`description=$${idx++}`); vals.push(description); }
    if (icon !== undefined) { fields.push(`icon=$${idx++}`); vals.push(icon); }
    if (color !== undefined) { fields.push(`color=$${idx++}`); vals.push(color); }
    if (display_order !== undefined) { fields.push(`display_order=$${idx++}`); vals.push(display_order); }

    fields.push("updated_at=now()");
    vals.push(id);

    await pool.query(
      `UPDATE meca_equipment_categories SET ${fields.join(", ")} WHERE id=$${idx}`,
      vals
    );

    const { rows } = await pool.query(`SELECT * FROM meca_equipment_categories WHERE id=$1`, [id]);
    const category = rows[0];
    if (category) {
      const { rows: subcats } = await pool.query(`
        SELECT * FROM meca_equipment_subcategories WHERE category_id = $1 ORDER BY display_order, name
      `, [id]);
      category.subcategories = subcats;
    }

    await logEvent("meca_category_updated", { id, fields: Object.keys(req.body || {}) }, u);
    res.json({ ok: true, category });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/meca/categories/:id - Delete category
app.delete("/api/meca/categories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows: old } = await pool.query(`SELECT name FROM meca_equipment_categories WHERE id=$1`, [id]);
    await pool.query(`DELETE FROM meca_equipment_categories WHERE id=$1`, [id]);
    await logEvent("meca_category_deleted", { id, name: old[0]?.name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// API EQUIPMENT SUBCATEGORIES
// -------------------------------------------------

// GET /api/meca/subcategories?category_id=... - List subcategories for a category
app.get("/api/meca/subcategories", async (req, res) => {
  try {
    const categoryId = req.query.category_id;
    let query = `SELECT * FROM meca_equipment_subcategories`;
    let params = [];

    if (categoryId) {
      query += ` WHERE category_id = $1`;
      params.push(categoryId);
    }
    query += ` ORDER BY display_order, name`;

    const { rows } = await pool.query(query, params);
    res.json({ ok: true, subcategories: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/meca/subcategories - Create subcategory
app.post("/api/meca/subcategories", async (req, res) => {
  try {
    const u = getUser(req);
    const { category_id, name = "", description = "", display_order = 0 } = req.body || {};

    if (!category_id) {
      return res.status(400).json({ ok: false, error: "category_id is required" });
    }
    if (!name.trim()) {
      return res.status(400).json({ ok: false, error: "Name is required" });
    }

    const { rows } = await pool.query(`
      INSERT INTO meca_equipment_subcategories(category_id, name, description, display_order)
      VALUES($1, $2, $3, $4)
      RETURNING *
    `, [category_id, name.trim(), description, display_order]);

    await logEvent("meca_subcategory_created", { id: rows[0].id, name: rows[0].name, category_id }, u);
    res.json({ ok: true, subcategory: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/meca/subcategories/:id - Update subcategory
app.put("/api/meca/subcategories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { name, description, display_order, category_id } = req.body || {};

    const fields = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name=$${idx++}`); vals.push(name.trim()); }
    if (description !== undefined) { fields.push(`description=$${idx++}`); vals.push(description); }
    if (display_order !== undefined) { fields.push(`display_order=$${idx++}`); vals.push(display_order); }
    if (category_id !== undefined) { fields.push(`category_id=$${idx++}`); vals.push(category_id); }

    fields.push("updated_at=now()");
    vals.push(id);

    await pool.query(
      `UPDATE meca_equipment_subcategories SET ${fields.join(", ")} WHERE id=$${idx}`,
      vals
    );

    const { rows } = await pool.query(`SELECT * FROM meca_equipment_subcategories WHERE id=$1`, [id]);
    await logEvent("meca_subcategory_updated", { id, fields: Object.keys(req.body || {}) }, u);
    res.json({ ok: true, subcategory: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/meca/subcategories/:id - Delete subcategory
app.delete("/api/meca/subcategories/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows: old } = await pool.query(`SELECT name FROM meca_equipment_subcategories WHERE id=$1`, [id]);
    await pool.query(`DELETE FROM meca_equipment_subcategories WHERE id=$1`, [id]);
    await logEvent("meca_subcategory_deleted", { id, name: old[0]?.name }, u);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// REPORT PDF GENERATION - VERSION PROFESSIONNELLE
// -------------------------------------------------
app.get("/api/meca/report", async (req, res) => {
  try {
    const site = req.headers["x-site"] || "Default";
    const { building, floor, category_id, search, from_date, to_date } = req.query;

    const colors = {
      primary: '#059669',    // Emerald (mécanique)
      secondary: '#10b981',
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
    if (category_id) { where += ` AND e.category_id = $${idx++}`; params.push(category_id); }
    if (search) { where += ` AND (e.name ILIKE $${idx} OR e.tag ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (from_date) { where += ` AND e.created_at >= $${idx++}`; params.push(from_date); }
    if (to_date) { where += ` AND e.created_at <= $${idx++}`; params.push(to_date); }

    const { rows: equipments } = await pool.query(`
      SELECT e.*, c.name as category_name, s.name as subcategory_name
        FROM meca_equipments e
        LEFT JOIN meca_equipment_categories c ON c.id = e.category_id
        LEFT JOIN meca_equipment_subcategories s ON s.id = e.subcategory_id
        ${where}
       ORDER BY e.building, e.floor, e.name
    `, params);

    let siteInfo = { company_name: site, site_name: site };
    try {
      const { rows } = await pool.query(`SELECT company_name, company_address FROM site_settings WHERE site = $1`, [site]);
      if (rows[0]) siteInfo = { ...siteInfo, ...rows[0] };
    } catch (e) { /* ignore */ }

    // Stats
    const byCategory = {};
    equipments.forEach(e => {
      const cat = e.category_name || 'Autres';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    const byBuilding = {};
    equipments.forEach(e => {
      const bldg = e.building || 'Non renseigne';
      if (!byBuilding[bldg]) byBuilding[bldg] = [];
      byBuilding[bldg].push(e);
    });
    const criticalCount = equipments.filter(e => e.criticality === 'critical').length;

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: {
      Title: 'Rapport Equipements Mecaniques',
      Author: siteInfo.company_name,
      Subject: 'Pompes, moteurs, ventilateurs, equipements mecaniques'
    }});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Rapport_MECA_${site.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // ========== PAGE DE GARDE ==========
    doc.rect(0, 0, 595, 842).fill('#ecfdf5');
    doc.rect(0, 0, 595, 120).fill(colors.primary);

    doc.fontSize(26).font('Helvetica-Bold').fillColor('#fff')
       .text('Rapport Equipements Mecaniques', 50, 35, { width: 495, align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#fff')
       .text('Pompes - Moteurs - Ventilateurs - Equipements mecaniques', 50, 75, { width: 495, align: 'center' });

    doc.fontSize(22).font('Helvetica-Bold').fillColor(colors.primary)
       .text(siteInfo.company_name || 'Entreprise', 50, 160, { align: 'center', width: 495 });
    doc.fontSize(14).font('Helvetica').fillColor(colors.text)
       .text(`Site: ${site}`, 50, 195, { align: 'center', width: 495 });
    doc.fontSize(10).fillColor(colors.muted)
       .text(`Document genere le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`, 50, 230, { align: 'center', width: 495 });

    const statsY = 280;
    doc.rect(100, statsY, 395, 180).fillAndStroke('#fff', colors.primary);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary)
       .text('Synthese', 120, statsY + 15, { width: 355, align: 'center' });

    const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const statsItems = [
      { label: 'Equipements mecaniques', value: equipments.length, color: colors.primary },
      { label: 'Batiments', value: Object.keys(byBuilding).length, color: colors.secondary },
      { label: 'Categories', value: Object.keys(byCategory).length, color: colors.secondary },
      { label: 'Equipements critiques', value: criticalCount, color: criticalCount > 0 ? colors.danger : colors.success },
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
      { num: '1', title: 'Reglementation et maintenance' },
      { num: '2', title: 'Presentation de l\'etablissement' },
      { num: '3', title: 'Inventaire par batiment' },
      { num: '4', title: 'Fiches equipements' },
    ];

    let somY = 110;
    sommaire.forEach(item => {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.text).text(item.num, 50, somY);
      doc.font('Helvetica').text(item.title, 80, somY);
      somY += 30;
    });

    // ========== 1. RÉGLEMENTATION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('1. Reglementation et maintenance', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let regY = 100;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(colors.text).text('Maintenance preventive', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('Les equipements mecaniques doivent faire l\'objet d\'une maintenance preventive reguliere selon les recommandations fabricant et les normes en vigueur.', 50, regY, { width: 495, align: 'justify' });
    regY += 50;

    doc.font('Helvetica-Bold').text('Controle des moteurs electriques', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('Les moteurs electriques doivent etre controles periodiquement (vibrations, temperature, isolation) pour prevenir les pannes.', 50, regY, { width: 495, align: 'justify' });
    regY += 50;

    doc.font('Helvetica-Bold').text('Pompes et ventilateurs', 50, regY);
    regY += 20;
    doc.font('Helvetica').text('Les pompes et ventilateurs necessitent un suivi des performances (debit, pression) et de l\'usure des pieces mecaniques.', 50, regY, { width: 495 });

    // ========== 2. PRÉSENTATION ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('2. Presentation de l\'etablissement', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let presY = 100;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary).text(siteInfo.company_name || 'Entreprise', 50, presY);
    presY += 25;
    doc.fontSize(11).font('Helvetica').fillColor(colors.text).text(`Site: ${site}`, 50, presY);
    presY += 40;

    doc.fontSize(12).font('Helvetica-Bold').text('Repartition par categorie', 50, presY);
    presY += 25;

    topCategories.forEach(([cat, count]) => {
      doc.rect(50, presY, 240, 30).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(10).font('Helvetica').fillColor(colors.muted).text(cat, 60, presY + 8);
      doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.primary).text(String(count), 220, presY + 6, { align: 'right', width: 50 });
      presY += 35;
    });

    // ========== 3. INVENTAIRE ==========
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('3. Inventaire par batiment', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let invY = 100;
    const invHeaders = ['Nom', 'Categorie', 'Etage', 'Puissance', 'Criticite'];
    const invColW = [140, 120, 60, 80, 70];

    Object.entries(byBuilding).forEach(([bldg, bldgEquips]) => {
      if (invY > 700) { doc.addPage(); invY = 50; }

      doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.primary).text(`Batiment: ${bldg}`, 50, invY);
      invY += 25;

      let x = 50;
      invHeaders.forEach((h, i) => {
        doc.rect(x, invY, invColW[i], 18).fillAndStroke(colors.primary, colors.primary);
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#fff').text(h, x + 3, invY + 5);
        x += invColW[i];
      });
      invY += 18;

      bldgEquips.forEach((eq, idx) => {
        if (invY > 750) { doc.addPage(); invY = 50; }
        const row = [(eq.name || '-').substring(0, 28), (eq.category_name || '-').substring(0, 22), eq.floor || '-', eq.power_kw ? `${eq.power_kw} kW` : '-', eq.criticality || '-'];
        x = 50;
        const bgColor = idx % 2 === 0 ? '#fff' : colors.light;
        row.forEach((cell, i) => {
          doc.rect(x, invY, invColW[i], 16).fillAndStroke(bgColor, '#e5e7eb');
          let txtColor = colors.text;
          if (i === 4 && cell === 'critical') txtColor = colors.danger;
          doc.fontSize(6).font('Helvetica').fillColor(txtColor).text(String(cell), x + 3, invY + 4);
          x += invColW[i];
        });
        invY += 16;
      });
      invY += 15;
    });

    // ========== 4. FICHES ÉQUIPEMENTS ==========
    if (equipments.length > 0) {
      doc.addPage();
      doc.fontSize(20).font('Helvetica-Bold').fillColor(colors.primary).text('4. Fiches equipements', 50, 50);
      doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

      let ficheY = 100;
      doc.fontSize(11).font('Helvetica').fillColor(colors.muted).text(`${equipments.length} equipement(s)`, 50, ficheY);
      ficheY += 30;

      for (let i = 0; i < equipments.length; i++) {
        const eq = equipments[i];
        const cardHeight = 160;

        if (ficheY + cardHeight > 750) { doc.addPage(); ficheY = 50; }

        doc.rect(50, ficheY, 495, cardHeight).stroke(colors.light);
        doc.rect(50, ficheY, 495, 25).fill(colors.primary);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#fff')
           .text(`${eq.name || 'Equipement'}`, 60, ficheY + 7, { width: 350 });
        doc.fontSize(8).font('Helvetica').fillColor('#fff')
           .text(eq.category_name || '-', 420, ficheY + 8, { width: 110, align: 'right' });

        let infoY = ficheY + 35;
        const col1 = 60, col2 = 200, col3 = 340;

        const info = [
          [['Tag', eq.tag || '-'], ['Batiment', eq.building || '-'], ['Etage', eq.floor || '-']],
          [['Type', eq.equipment_type || '-'], ['Fabricant', eq.manufacturer || '-'], ['Modele', eq.model || '-']],
          [['Puissance', eq.power_kw ? `${eq.power_kw} kW` : '-'], ['Tension', eq.voltage ? `${eq.voltage}V` : '-'], ['Vitesse', eq.speed_rpm ? `${eq.speed_rpm} rpm` : '-']],
          [['Criticite', eq.criticality || '-'], ['Statut', eq.status || '-'], ['IP', eq.ip_rating || '-']],
        ];

        info.forEach(row => {
          [col1, col2, col3].forEach((cx, ci) => {
            if (row[ci]) {
              doc.fontSize(7).font('Helvetica-Bold').fillColor(colors.text).text(row[ci][0] + ':', cx, infoY);
              let valColor = colors.muted;
              if (row[ci][0] === 'Criticite' && row[ci][1] === 'critical') valColor = colors.danger;
              doc.font('Helvetica').fillColor(valColor).text(String(row[ci][1]).substring(0, 18), cx + 50, infoY);
            }
          });
          infoY += 14;
        });

        // Photo
        const photoX = 430, photoY = ficheY + 35;
        if (eq.photo_content && eq.photo_content.length > 0) {
          try {
            doc.image(eq.photo_content, photoX, photoY, { fit: [90, 70] });
            doc.rect(photoX, photoY, 90, 70).stroke('#e5e7eb');
          } catch (e) {
            doc.rect(photoX, photoY, 90, 70).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Photo N/A', photoX + 20, photoY + 30);
          }
        } else {
          doc.rect(photoX, photoY, 90, 70).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Pas de photo', photoX + 15, photoY + 30);
        }

        ficheY += cardHeight + 10;
      }
    }

    // ========== PAGINATION ==========
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Rapport MECA - ${site} - Page ${i + 1}/${range.count}`, 50, 810, { align: 'center', width: 495, lineBreak: false });
    }

    doc.end();
    console.log(`[MECA] Generated professional report: ${equipments.length} equipments`);

  } catch (e) {
    console.error('[MECA] Report error:', e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// MANAGEMENT MONITORING REPORT (avec mini plans)
// -------------------------------------------------
app.get("/api/meca/management-monitoring", async (req, res) => {
  try {
    const siteName = req.query.site || req.headers["x-site"] || "Default";
    const filterBuilding = req.query.building || null;
    const filterFloor = req.query.floor || null;
    const filterCategory = req.query.category_id || null;

    // Récupérer les informations du site
    let siteInfo = { company_name: "Entreprise", site_name: siteName, logo: null, logo_mime: null };
    try {
      const siteRes = await pool.query(
        `SELECT company_name, company_address, company_phone, company_email, logo, logo_mime
         FROM site_settings WHERE site = $1`,
        [siteName]
      );
      if (siteRes.rows[0]) {
        siteInfo = { ...siteInfo, ...siteRes.rows[0], site_name: siteName };
      }
    } catch (e) { console.warn('[MECA-MM] No site settings:', e.message); }

    // Récupérer les équipements avec filtres
    let equipmentQuery = `
      SELECT e.*, c.name as category_name, s.name as subcategory_name
      FROM meca_equipments e
      LEFT JOIN meca_equipment_categories c ON c.id = e.category_id
      LEFT JOIN meca_equipment_subcategories s ON s.id = e.subcategory_id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (filterBuilding) { equipmentQuery += ` AND e.building = $${paramIdx++}`; params.push(filterBuilding); }
    if (filterFloor) { equipmentQuery += ` AND e.floor = $${paramIdx++}`; params.push(filterFloor); }
    if (filterCategory) { equipmentQuery += ` AND e.category_id = $${paramIdx++}`; params.push(filterCategory); }

    equipmentQuery += ` ORDER BY e.building, e.floor, e.name`;

    const { rows: equipments } = await pool.query(equipmentQuery, params);
    console.log(`[MECA-MM] Found ${equipments.length} equipments`);

    // Récupérer les positions des équipements sur les plans
    const equipmentIds = equipments.map(e => e.id);
    let positionsMap = new Map();
    if (equipmentIds.length > 0) {
      const { rows: positions } = await pool.query(`
        SELECT pos.equipment_id, pos.logical_name, pos.plan_id, pos.x_frac, pos.y_frac,
               COALESCE(p_by_logical.thumbnail, p_by_id.thumbnail) AS plan_thumbnail,
               COALESCE(p_by_logical.content, p_by_id.content) AS plan_content,
               COALESCE(pn.display_name, pos.logical_name, 'Plan') AS plan_display_name
        FROM meca_positions pos
        LEFT JOIN (
          SELECT DISTINCT ON (logical_name) id, logical_name, content, thumbnail
          FROM meca_plans
          ORDER BY logical_name, version DESC
        ) p_by_logical ON p_by_logical.logical_name = pos.logical_name
        LEFT JOIN meca_plans p_by_id ON p_by_id.id = pos.plan_id
        LEFT JOIN meca_plan_names pn ON pn.logical_name = COALESCE(pos.logical_name, p_by_id.logical_name)
        WHERE pos.equipment_id = ANY($1)
      `, [equipmentIds]);

      for (const pos of positions) {
        if (!positionsMap.has(pos.equipment_id)) {
          positionsMap.set(pos.equipment_id, pos);
        }
      }
      console.log(`[MECA-MM] Found ${positions.length} equipment positions on plans`);
    }

    // Créer le PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      info: {
        Title: 'Management Monitoring - Équipements Mécaniques',
        Author: siteInfo.company_name,
        Subject: 'Rapport de suivi des équipements mécaniques'
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Management_Monitoring_Meca_${siteName.replace(/[^a-zA-Z0-9-_]/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // Couleurs
    const colors = {
      primary: '#3b82f6',    // Blue
      secondary: '#1e40af',
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#ef4444',
      text: '#1f2937',
      muted: '#6b7280',
      light: '#e5e7eb'
    };

    // En-tête avec logo
    if (siteInfo.logo && siteInfo.logo_mime) {
      try {
        const logoBuffer = Buffer.isBuffer(siteInfo.logo) ? siteInfo.logo : Buffer.from(siteInfo.logo);
        doc.image(logoBuffer, 50, 30, { fit: [100, 50] });
      } catch (e) { console.warn('[MECA-MM] Logo error:', e.message); }
    }

    doc.fontSize(20).fillColor(colors.primary)
       .text('Management Monitoring', 200, 35, { width: 350, align: 'right' });
    doc.fontSize(12).fillColor(colors.muted)
       .text('Équipements Mécaniques', 200, 60, { width: 350, align: 'right' });
    doc.fontSize(10)
       .text(`${siteInfo.company_name} - ${siteInfo.site_name}`, 200, 78, { width: 350, align: 'right' })
       .text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 200, 92, { width: 350, align: 'right' });

    // Statistiques
    let y = 130;
    doc.rect(50, y, 495, 50).fill('#f3f4f6');
    doc.fontSize(11).fillColor(colors.text);
    doc.text(`Total équipements: ${equipments.length}`, 60, y + 12);

    const byBuilding = {};
    equipments.forEach(e => { byBuilding[e.building || 'N/A'] = (byBuilding[e.building || 'N/A'] || 0) + 1; });
    const buildingCount = Object.keys(byBuilding).length;
    doc.text(`Bâtiments: ${buildingCount}`, 200, y + 12);

    const withPosition = equipments.filter(e => positionsMap.has(e.id)).length;
    doc.text(`Positionnés sur plan: ${withPosition}`, 340, y + 12);

    // Fiches par équipement (2 par page)
    y = 200;
    let ficheY = y;
    let ficheCount = 0;

    for (const eq of equipments) {
      if (ficheCount > 0 && ficheCount % 2 === 0) {
        doc.addPage();
        ficheY = 50;
      }

      // Cadre de la fiche
      doc.rect(50, ficheY, 495, 320).stroke(colors.light);

      // En-tête de fiche
      doc.rect(50, ficheY, 495, 30).fill(colors.primary);
      doc.fontSize(12).fillColor('#ffffff')
         .text(eq.name || `Équipement #${eq.id}`, 60, ficheY + 9, { width: 475, lineBreak: false });

      // Contenu de la fiche
      const infoX = 60;
      let infoY = ficheY + 45;
      const infoWidth = 240;
      const rightColX = 310;
      const imgWidth = 110;
      const imgHeight = 130;
      const rightY = ficheY + 45;

      // Position sur le plan
      const position = positionsMap.get(eq.id);

      // Photo de l'équipement (à droite)
      if (eq.photo_content && eq.photo_content.length) {
        try {
          const photoBuffer = Buffer.isBuffer(eq.photo_content) ? eq.photo_content : Buffer.from(eq.photo_content);
          doc.image(photoBuffer, rightColX, rightY, { fit: [imgWidth, imgHeight], align: 'center' });
          doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.primary);
        } catch (e) {
          doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Photo N/A', rightColX + 35, rightY + 60, { lineBreak: false });
        }
      } else {
        doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.light);
        doc.fontSize(7).fillColor(colors.muted).text('Pas de photo', rightColX + 30, rightY + 60, { lineBreak: false });
      }

      // Mini plan avec localisation (à côté de la photo)
      const planX = rightColX + imgWidth + 10;
      if (position && (position.plan_thumbnail || position.plan_content)) {
        try {
          const planDisplayName = position.plan_display_name || 'Plan';
          let planThumbnail = null;

          // Priorité 1: Utiliser le thumbnail pré-généré (PNG)
          if (position.plan_thumbnail && position.plan_thumbnail.length > 0) {
            const { loadImage } = await import('canvas');
            const thumbnailBuffer = Buffer.isBuffer(position.plan_thumbnail)
              ? position.plan_thumbnail
              : Buffer.from(position.plan_thumbnail);

            const img = await loadImage(thumbnailBuffer);
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // Dessiner le marqueur de position
            if (position.x_frac !== null && position.y_frac !== null &&
                !isNaN(position.x_frac) && !isNaN(position.y_frac)) {
              const markerX = position.x_frac * img.width;
              const markerY = position.y_frac * img.height;
              const markerRadius = Math.max(12, img.width / 25);

              // Cercle extérieur bleu
              ctx.beginPath();
              ctx.arc(markerX, markerY, markerRadius, 0, 2 * Math.PI);
              ctx.fillStyle = colors.primary;
              ctx.fill();
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 3;
              ctx.stroke();

              // Point central blanc
              ctx.beginPath();
              ctx.arc(markerX, markerY, markerRadius / 3, 0, 2 * Math.PI);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
            }

            planThumbnail = canvas.toBuffer('image/png');
          }

          if (planThumbnail) {
            doc.image(planThumbnail, planX, rightY, { fit: [imgWidth, imgHeight], align: 'center' });
            doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.primary);
            doc.fontSize(6).fillColor(colors.muted)
               .text(planDisplayName, planX, rightY + imgHeight + 2, { width: imgWidth, align: 'center', lineBreak: false });
          } else {
            doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Plan N/A', planX + 35, rightY + 60, { lineBreak: false });
          }
        } catch (planErr) {
          console.warn(`[MECA-MM] Plan thumbnail error for ${eq.name}:`, planErr.message);
          doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Plan N/A', planX + 35, rightY + 60, { lineBreak: false });
        }
      } else {
        doc.rect(planX, rightY, imgWidth, imgHeight).stroke(colors.light);
        doc.fontSize(7).fillColor(colors.muted).text('Non positionné', planX + 25, rightY + 60, { lineBreak: false });
      }

      // Informations de l'équipement (colonne gauche)
      const infoItems = [
        ['Code', eq.code || '-'],
        ['Catégorie', eq.category_name || '-'],
        ['Sous-catégorie', eq.subcategory_name || '-'],
        ['Bâtiment', eq.building || '-'],
        ['Étage', eq.floor || '-'],
        ['Localisation', eq.location || '-'],
        ['Fabricant', eq.manufacturer || '-'],
        ['Modèle', eq.model || '-'],
        ['N° série', eq.serial_number || '-'],
        ['Statut', eq.status || '-'],
        ['Créé le', eq.created_at ? new Date(eq.created_at).toLocaleDateString('fr-FR') : '-'],
      ];

      infoItems.forEach(([label, value]) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(colors.text).text(label + ':', infoX, infoY, { width: 85 });
        doc.font('Helvetica').fillColor(colors.muted).text(String(value).substring(0, 40), infoX + 88, infoY, { width: infoWidth - 88, lineBreak: false });
        infoY += 16;
      });

      // Notes si présentes
      if (eq.notes) {
        infoY += 5;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(colors.text).text('Notes:', infoX, infoY);
        infoY += 12;
        doc.font('Helvetica').fillColor(colors.muted).text(eq.notes.substring(0, 200), infoX, infoY, { width: 230, height: 40 });
      }

      // Légendes des images
      doc.fontSize(7).fillColor(colors.muted)
         .text('Photo équipement', rightColX, rightY + imgHeight + 2, { width: imgWidth, align: 'center', lineBreak: false });

      ficheY += 330;
      ficheCount++;
    }

    // Numérotation des pages
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = range.start; i < range.start + totalPages; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Management Monitoring - ${siteInfo.company_name || 'Document'} - Page ${i + 1}/${totalPages}`, 50, 810, { align: 'center', width: 495, lineBreak: false });
    }

    doc.end();
    console.log(`[MECA-MM] Generated PDF with ${equipments.length} equipments`);

  } catch (e) {
    console.error('[MECA-MM] Error:', e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
});

// -------------------------------------------------
// BOOT
// -------------------------------------------------
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[meca] listening on ${HOST}:${PORT}`);
});
