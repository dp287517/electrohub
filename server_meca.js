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
import { extractTenantFromRequest, getTenantFilter } from "./lib/tenant-filter.js";

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
    const tenant = extractTenantFromRequest(req);
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
    const tenant = extractTenantFromRequest(req);

    const {
      name = "",
      tag = "",
      equipment_type = "",
      category = "",
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
         name, tag, equipment_type, category, function,
         building, floor, zone, location, panel,
         power_kw, voltage, current_a, speed_rpm, ip_rating,
         drive_type, coupling, mounting, fluid, flow_m3h, pressure_bar,
         manufacturer, model, serial_number, year,
         status, criticality, comments
       )
       VALUES(
         $1,$2,
         $3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,$23,
         $24,$25,$26,$27,
         $28,$29,$30
       )
       RETURNING *`,
      [
        tenant.companyId,
        tenant.siteId,
        name,
        tag,
        equipment_type,
        category,
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
      `SELECT name FROM meca_equipments WHERE id=$1`,
      [id]
    );
    await pool.query(`DELETE FROM meca_equipments WHERE id=$1`, [id]);
    await logEvent(
      "meca_equipment_deleted",
      { id, name: old[0]?.name },
      u
    );
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

// POST /api/meca/maps/uploadZip
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

        const { rows: existing } = await pool.query(
          `SELECT id, version FROM meca_plans
            WHERE logical_name=$1
            ORDER BY version DESC
            LIMIT 1`,
          [logical]
        );
        const nextVer = existing[0] ? existing[0].version + 1 : 1;

        const { rows } = await pool.query(
          `INSERT INTO meca_plans(logical_name, version, filename, file_path, content, page_count)
           VALUES($1,$2,$3,$4,$5,1)
           RETURNING *`,
          [logical, nextVer, e.name, dest, buf]
        );

        await pool.query(
          `INSERT INTO meca_plan_names(logical_name, display_name)
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

// GET /api/meca/maps/listPlans
app.get("/api/meca/maps/listPlans", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id,
             p.logical_name,
             p.version,
             p.filename,
             p.page_count,
             COALESCE(pn.display_name, p.logical_name) AS display_name
        FROM meca_plans p
        LEFT JOIN meca_plan_names pn ON pn.logical_name = p.logical_name
       ORDER BY p.logical_name, p.version DESC
    `);
    res.json({ ok: true, plans: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/meca/maps/planFile?logical_name=... or ?id=...
app.get("/api/meca/maps/planFile", async (req, res) => {
  try {
    const { logical_name, id } = req.query;
    let q = `SELECT file_path, content, filename FROM meca_plans WHERE `;
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
      const { rows: pRows } = await pool.query(
        `SELECT logical_name FROM meca_plans WHERE id=$1`,
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

    await pool.query(
      `INSERT INTO meca_positions(
         equipment_id, logical_name, plan_id, page_index, x_frac, y_frac
       )
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(equipment_id, logical_name, page_index)
       DO UPDATE SET
         x_frac=EXCLUDED.x_frac,
         y_frac=EXCLUDED.y_frac,
         plan_id=EXCLUDED.plan_id`,
      [
        equipment_id,
        logical_name,
        plan_id,
        Number(page_index),
        Number(x_frac),
        Number(y_frac),
      ]
    );

    // Option : mettre le logical_name dans "location" ou "panel" si tu veux,
    // ici on ne touche pas à l'équipement pour rester neutre.

    await logEvent(
      "meca_position_set",
      { equipment_id, logical_name, page_index },
      u
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------
// BOOT
// -------------------------------------------------
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[meca] listening on ${HOST}:${PORT}`);
});
