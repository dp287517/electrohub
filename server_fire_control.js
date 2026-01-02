// ==============================
// server_fire_control.js — Fire Control Interlocking Tests microservice (ESM)
// Port: 3018
// ✅ VERSION 2.0 - Architecture ZONE-CENTRIC (pas détecteur-centric)
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
import PDFDocument from "pdfkit";
import { createAuditTrail, AUDIT_ACTIONS } from "./lib/audit-trail.js";
import { extractTenantFromRequest, getTenantFilter } from "./lib/tenant-filter.js";
import { notifyEquipmentCreated, notifyMaintenanceCompleted, notifyStatusChanged, notifyNonConformity, notify } from "./lib/push-notify.js";

// PDF parsing
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
function resolvePdfWorker() {
  try {
    return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    return require.resolve("pdfjs-dist/build/pdf.worker.mjs");
  }
}
pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorker();

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------
// App & Config
// ------------------------------
const app = express();
app.set("trust proxy", 1);

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
        "connect-src": ["'self'", "*"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-User-Email", "X-User-Name", "X-Site", "Authorization"],
    exposedHeaders: [],
  })
);

app.use(express.json({ limit: "50mb" }));

const PORT = Number(process.env.FIRE_CONTROL_PORT || 3018);
const HOST = process.env.FIRE_CONTROL_HOST || "0.0.0.0";

// Storage layout
const DATA_ROOT = path.join(process.cwd(), "uploads", "fire-control");
const FILES_DIR = path.join(DATA_ROOT, "files");
const MATRICES_DIR = path.join(DATA_ROOT, "matrices");
const PLANS_DIR = path.join(DATA_ROOT, "plans");
const REPORTS_DIR = path.join(DATA_ROOT, "reports");
await fsp.mkdir(FILES_DIR, { recursive: true });
await fsp.mkdir(MATRICES_DIR, { recursive: true });
await fsp.mkdir(PLANS_DIR, { recursive: true });
await fsp.mkdir(REPORTS_DIR, { recursive: true });

// Multer configs
const uploadFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const uploadMatrix = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MATRICES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const uploadPlan = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PLANS_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ------------------------------
// DB
// ------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

const audit = createAuditTrail(pool, "fire_control");

async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // 1. Campagnes de contrôle (annuelles)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      year INT NOT NULL,
      start_date DATE,
      end_date DATE,
      status TEXT DEFAULT 'planned',
      notes TEXT,
      company_id INT,
      site_id INT,
      created_by_email TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_campaigns_year ON fc_campaigns(year);`);

  // 2. Matrices d'asservissement (PDFs uploadés)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_matrices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID REFERENCES fc_campaigns(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      filename TEXT,
      file_path TEXT,
      content BYTEA,
      version TEXT,
      upload_date TIMESTAMPTZ DEFAULT now(),
      is_active BOOLEAN DEFAULT true,
      parsed_data JSONB,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 3. Plans de bâtiments (PDFs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_building_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      building TEXT NOT NULL,
      floor TEXT,
      name TEXT NOT NULL,
      filename TEXT,
      file_path TEXT,
      content BYTEA,
      version TEXT,
      page_count INT DEFAULT 1,
      is_active BOOLEAN DEFAULT true,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 4. ZONES DE DÉTECTION (nouveau modèle - groupes de détecteurs)
  // Une zone = un groupe de détecteurs qui déclenchent les mêmes asservissements
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      building TEXT,
      floor TEXT,
      access_point TEXT,
      station INT,
      detector_numbers TEXT,
      detector_type TEXT DEFAULT 'smoke',
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE SET NULL,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(code, company_id, site_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_zones_building ON fc_zones(building, floor);`);

  // 5. ÉQUIPEMENTS / INTERLOCKS (asservissements)
  // Avec liens vers systèmes externes (Doors, Switchboard, DataHub)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_equipment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      equipment_type TEXT NOT NULL,
      category TEXT,
      building TEXT,
      floor TEXT,
      location TEXT,
      fdcio_module TEXT,
      fdcio_output TEXT,
      external_system TEXT,
      external_id TEXT,
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE SET NULL,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(code, company_id, site_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_equipment_type ON fc_equipment(equipment_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_equipment_external ON fc_equipment(external_system, external_id);`);

  // 6. ZONE <-> EQUIPMENT mapping (quel équipement est activé par quelle zone)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_zone_equipment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID REFERENCES fc_zones(id) ON DELETE CASCADE,
      equipment_id UUID REFERENCES fc_equipment(id) ON DELETE CASCADE,
      alarm_level INT NOT NULL DEFAULT 1,
      action_type TEXT DEFAULT 'activate',
      notes TEXT,
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(zone_id, equipment_id, alarm_level)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_zone_equipment_zone ON fc_zone_equipment(zone_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_zone_equipment_alarm ON fc_zone_equipment(alarm_level);`);

  // 7. CONTRÔLES PAR ZONE (pas par détecteur!)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_zone_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID REFERENCES fc_campaigns(id) ON DELETE CASCADE,
      zone_id UUID REFERENCES fc_zones(id) ON DELETE CASCADE,
      check_date TIMESTAMPTZ,
      status TEXT DEFAULT 'pending',
      alarm1_triggered BOOLEAN,
      alarm2_triggered BOOLEAN,
      detector_used TEXT,
      notes TEXT,
      checked_by_email TEXT,
      checked_by_name TEXT,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(campaign_id, zone_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_zone_checks_campaign ON fc_zone_checks(campaign_id);`);

  // 8. RÉSULTATS PAR ÉQUIPEMENT (pour chaque contrôle de zone)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_equipment_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_check_id UUID REFERENCES fc_zone_checks(id) ON DELETE CASCADE,
      equipment_id UUID REFERENCES fc_equipment(id) ON DELETE CASCADE,
      alarm_level INT NOT NULL,
      result TEXT DEFAULT 'pending',
      response_time_ms INT,
      notes TEXT,
      checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(zone_check_id, equipment_id, alarm_level)
    );
  `);

  // 9. Photos et fichiers attachés aux contrôles
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_check_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_check_id UUID REFERENCES fc_zone_checks(id) ON DELETE CASCADE,
      equipment_result_id UUID REFERENCES fc_equipment_results(id) ON DELETE SET NULL,
      filename TEXT,
      file_path TEXT,
      content BYTEA,
      mime TEXT,
      file_type TEXT,
      uploaded_by_email TEXT,
      uploaded_by_name TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 10. Positions des zones/équipements sur les plans
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_map_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id UUID NOT NULL,
      plan_id UUID REFERENCES fc_building_plans(id) ON DELETE CASCADE,
      page_index INT DEFAULT 0,
      x_frac NUMERIC,
      y_frac NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_type, entity_id, plan_id, page_index)
    );
  `);

  // 11. Rapports générés
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID REFERENCES fc_campaigns(id) ON DELETE CASCADE,
      report_type TEXT DEFAULT 'control',
      filename TEXT,
      file_path TEXT,
      content BYTEA,
      generated_by_email TEXT,
      generated_by_name TEXT,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 12. Calendrier de suivi
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_schedule (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      building TEXT,
      scheduled_date DATE NOT NULL,
      campaign_id UUID REFERENCES fc_campaigns(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'scheduled',
      assigned_to TEXT,
      notes TEXT,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_schedule_date ON fc_schedule(scheduled_date);`);

  // Legacy tables for migration (keep fc_detectors, fc_checks for now)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_detectors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      detector_number TEXT NOT NULL,
      detector_type TEXT DEFAULT 'smoke',
      building TEXT,
      floor TEXT,
      zone TEXT,
      access_point TEXT,
      location_description TEXT,
      station INT,
      zone_id UUID REFERENCES fc_zones(id) ON DELETE SET NULL,
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE SET NULL,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await audit.ensureTable();
  console.log("[FireControl] Schema v2.0 ensured (zone-centric)");
}

// ------------------------------
// Helpers
// ------------------------------
function getIdentityFromReq(req) {
  return {
    email: req.headers["x-user-email"] || req.body?.user_email || null,
    name: req.headers["x-user-name"] || req.body?.user_name || null,
  };
}

// Equipment types
const EQUIPMENT_TYPES = {
  PCF: 'pcf',           // Porte Coupe-Feu
  RIDEAU_CF: 'rideau',  // Rideau coupe-feu
  HVAC: 'hvac',         // Ventilation/Climatisation
  ASCENSEUR: 'elevator',
  MONTE_CHARGE: 'lift',
  EVACUATION: 'evacuation',
  FLASH: 'flash',       // Feu flash
  SIRENE: 'siren',
  CLAPET: 'damper',     // Clapet CF
  INTERLOCK: 'interlock',
  OTHER: 'other'
};

// Status helpers
const CHECK_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  PASSED: "passed",
  FAILED: "failed",
  PARTIAL: "partial",
};

const RESULT_STATUS = {
  PENDING: "pending",
  OK: "ok",
  NOK: "nok",
  NA: "na",  // Not applicable
};

// Parse detector ranges like "20001-20005,20009" into array
function parseDetectorRange(rangeStr) {
  if (!rangeStr) return [];
  const detectors = [];
  const parts = rangeStr.split(",").map(s => s.trim());
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          detectors.push(String(i));
        }
      }
    } else {
      const num = part.trim();
      if (num) detectors.push(num);
    }
  }
  return detectors;
}

// Calculate zone check status based on equipment results
function calculateZoneCheckStatus(results) {
  if (!results || results.length === 0) return CHECK_STATUS.PENDING;

  const pending = results.filter(r => r.result === RESULT_STATUS.PENDING).length;
  const ok = results.filter(r => r.result === RESULT_STATUS.OK).length;
  const nok = results.filter(r => r.result === RESULT_STATUS.NOK).length;
  const na = results.filter(r => r.result === RESULT_STATUS.NA).length;

  const relevant = results.length - na;

  if (pending === results.length) return CHECK_STATUS.PENDING;
  if (pending > 0) return CHECK_STATUS.IN_PROGRESS;
  if (nok === 0 && ok === relevant) return CHECK_STATUS.PASSED;
  if (ok === 0) return CHECK_STATUS.FAILED;
  return CHECK_STATUS.PARTIAL;
}

// ------------------------------
// ROUTES: Campaigns
// ------------------------------

app.get("/api/fire-control/campaigns", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { year, status } = req.query;

    let sql = `SELECT * FROM fc_campaigns WHERE ${filter.where}`;
    const params = [...filter.params];

    if (year) {
      params.push(Number(year));
      sql += ` AND year = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ` ORDER BY year DESC, created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET campaigns error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/campaigns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM fc_campaigns WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Campaign not found" });

    // Get zone check stats
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) as total_zones,
        COUNT(*) FILTER (WHERE status = 'passed') as passed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'partial') as partial,
        COUNT(*) FILTER (WHERE status = 'pending') as pending
      FROM fc_zone_checks WHERE campaign_id = $1
    `, [id]);

    res.json({ ...rows[0], stats: statsRes.rows[0] });
  } catch (err) {
    console.error("[FireControl] GET campaign error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/fire-control/campaigns", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { email, name } = getIdentityFromReq(req);
    const { name: campName, year, start_date, end_date, notes } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_campaigns (name, year, start_date, end_date, notes, company_id, site_id, created_by_email, created_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [campName, year || new Date().getFullYear(), start_date, end_date, notes, tenant.companyId, tenant.siteId, email, name]);

    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: "campaign",
      entityId: rows[0].id,
      details: { name: campName, year },
    });

    notifyEquipmentCreated('fire_campaign', { id: rows[0].id, name: campName, code: campName }, email)
      .catch(err => console.log('[FireControl] Push notify error:', err.message));

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST campaign error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/fire-control/campaigns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, year, start_date, end_date, status, notes } = req.body;

    const { rows } = await pool.query(`
      UPDATE fc_campaigns
      SET name = COALESCE($1, name),
          year = COALESCE($2, year),
          start_date = COALESCE($3, start_date),
          end_date = COALESCE($4, end_date),
          status = COALESCE($5, status),
          notes = COALESCE($6, notes),
          updated_at = now()
      WHERE id = $7
      RETURNING *
    `, [name, year, start_date, end_date, status, notes, id]);

    if (!rows.length) return res.status(404).json({ error: "Campaign not found" });

    const { email } = getIdentityFromReq(req);
    await audit.log(req, AUDIT_ACTIONS.UPDATED, { entityType: "campaign", entityId: id });

    if (status) {
      notifyStatusChanged('fire_campaign', { id: rows[0].id, name: rows[0].name, code: rows[0].name }, status, email)
        .catch(err => console.log('[FireControl] Push notify error:', err.message));
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] PUT campaign error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/fire-control/campaigns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM fc_campaigns WHERE id = $1`, [id]);
    await audit.log(req, AUDIT_ACTIONS.DELETED, { entityType: "campaign", entityId: id });
    res.json({ success: true });
  } catch (err) {
    console.error("[FireControl] DELETE campaign error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Zones
// ------------------------------

// List zones
app.get("/api/fire-control/zones", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { building, floor, station } = req.query;

    let sql = `
      SELECT z.*,
        (SELECT COUNT(*) FROM fc_zone_equipment ze WHERE ze.zone_id = z.id AND ze.alarm_level = 1) as equipment_count_al1,
        (SELECT COUNT(*) FROM fc_zone_equipment ze WHERE ze.zone_id = z.id AND ze.alarm_level = 2) as equipment_count_al2
      FROM fc_zones z
      WHERE ${filter.where.replace(/company_id/g, 'z.company_id').replace(/site_id/g, 'z.site_id')}
    `;
    const params = [...filter.params];

    if (building) {
      params.push(building);
      sql += ` AND z.building = $${params.length}`;
    }
    if (floor) {
      params.push(floor);
      sql += ` AND z.floor = $${params.length}`;
    }
    if (station) {
      params.push(Number(station));
      sql += ` AND z.station = $${params.length}`;
    }

    sql += ` ORDER BY z.building, z.floor, z.code`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET zones error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get zone with all equipment
app.get("/api/fire-control/zones/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM fc_zones WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Zone not found" });

    // Get linked equipment grouped by alarm level
    const { rows: equipmentAL1 } = await pool.query(`
      SELECT e.*, ze.action_type, ze.notes as link_notes
      FROM fc_equipment e
      JOIN fc_zone_equipment ze ON ze.equipment_id = e.id
      WHERE ze.zone_id = $1 AND ze.alarm_level = 1
      ORDER BY e.equipment_type, e.name
    `, [id]);

    const { rows: equipmentAL2 } = await pool.query(`
      SELECT e.*, ze.action_type, ze.notes as link_notes
      FROM fc_equipment e
      JOIN fc_zone_equipment ze ON ze.equipment_id = e.id
      WHERE ze.zone_id = $1 AND ze.alarm_level = 2
      ORDER BY e.equipment_type, e.name
    `, [id]);

    res.json({
      ...rows[0],
      equipment_alarm1: equipmentAL1,
      equipment_alarm2: equipmentAL2,
    });
  } catch (err) {
    console.error("[FireControl] GET zone error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create zone
app.post("/api/fire-control/zones", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { code, name, description, building, floor, access_point, station, detector_numbers, detector_type } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_zones (code, name, description, building, floor, access_point, station, detector_numbers, detector_type, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (code, company_id, site_id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        building = EXCLUDED.building,
        floor = EXCLUDED.floor,
        access_point = EXCLUDED.access_point,
        station = EXCLUDED.station,
        detector_numbers = EXCLUDED.detector_numbers,
        detector_type = EXCLUDED.detector_type,
        updated_at = now()
      RETURNING *
    `, [code, name, description, building, floor, access_point, station, detector_numbers, detector_type || 'smoke', tenant.companyId, tenant.siteId]);

    await audit.log(req, AUDIT_ACTIONS.CREATED, { entityType: "zone", entityId: rows[0].id });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST zone error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update zone
app.put("/api/fire-control/zones/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, description, building, floor, access_point, station, detector_numbers, detector_type } = req.body;

    const { rows } = await pool.query(`
      UPDATE fc_zones SET
        code = COALESCE($1, code),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        building = COALESCE($4, building),
        floor = COALESCE($5, floor),
        access_point = COALESCE($6, access_point),
        station = COALESCE($7, station),
        detector_numbers = COALESCE($8, detector_numbers),
        detector_type = COALESCE($9, detector_type),
        updated_at = now()
      WHERE id = $10
      RETURNING *
    `, [code, name, description, building, floor, access_point, station, detector_numbers, detector_type, id]);

    if (!rows.length) return res.status(404).json({ error: "Zone not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] PUT zone error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete zone
app.delete("/api/fire-control/zones/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM fc_zones WHERE id = $1`, [id]);
    await audit.log(req, AUDIT_ACTIONS.DELETED, { entityType: "zone", entityId: id });
    res.json({ success: true });
  } catch (err) {
    console.error("[FireControl] DELETE zone error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Equipment
// ------------------------------

// List equipment
app.get("/api/fire-control/equipment", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { type, building, external_system } = req.query;

    let sql = `SELECT * FROM fc_equipment WHERE ${filter.where}`;
    const params = [...filter.params];

    if (type) {
      params.push(type);
      sql += ` AND equipment_type = $${params.length}`;
    }
    if (building) {
      params.push(building);
      sql += ` AND building = $${params.length}`;
    }
    if (external_system) {
      params.push(external_system);
      sql += ` AND external_system = $${params.length}`;
    }

    sql += ` ORDER BY equipment_type, building, name`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET equipment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get equipment types list
app.get("/api/fire-control/equipment-types", (req, res) => {
  res.json(EQUIPMENT_TYPES);
});

// Get single equipment with zones it's linked to
app.get("/api/fire-control/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM fc_equipment WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Equipment not found" });

    // Get zones that trigger this equipment
    const { rows: zones } = await pool.query(`
      SELECT z.*, ze.alarm_level, ze.action_type
      FROM fc_zones z
      JOIN fc_zone_equipment ze ON ze.zone_id = z.id
      WHERE ze.equipment_id = $1
      ORDER BY ze.alarm_level, z.building, z.code
    `, [id]);

    res.json({ ...rows[0], triggered_by_zones: zones });
  } catch (err) {
    console.error("[FireControl] GET equipment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create equipment
app.post("/api/fire-control/equipment", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { code, name, equipment_type, category, building, floor, location, fdcio_module, fdcio_output, external_system, external_id } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_equipment (code, name, equipment_type, category, building, floor, location, fdcio_module, fdcio_output, external_system, external_id, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (code, company_id, site_id) DO UPDATE SET
        name = EXCLUDED.name,
        equipment_type = EXCLUDED.equipment_type,
        category = EXCLUDED.category,
        building = EXCLUDED.building,
        floor = EXCLUDED.floor,
        location = EXCLUDED.location,
        fdcio_module = EXCLUDED.fdcio_module,
        fdcio_output = EXCLUDED.fdcio_output,
        external_system = EXCLUDED.external_system,
        external_id = EXCLUDED.external_id,
        updated_at = now()
      RETURNING *
    `, [code, name, equipment_type, category, building, floor, location, fdcio_module, fdcio_output, external_system, external_id, tenant.companyId, tenant.siteId]);

    await audit.log(req, AUDIT_ACTIONS.CREATED, { entityType: "equipment", entityId: rows[0].id });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST equipment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Link equipment to zone
app.post("/api/fire-control/zone-equipment", async (req, res) => {
  try {
    const { zone_id, equipment_id, alarm_level, action_type, notes } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_zone_equipment (zone_id, equipment_id, alarm_level, action_type, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (zone_id, equipment_id, alarm_level) DO UPDATE SET
        action_type = EXCLUDED.action_type,
        notes = EXCLUDED.notes
      RETURNING *
    `, [zone_id, equipment_id, alarm_level || 1, action_type || 'activate', notes]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST zone-equipment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Remove equipment from zone
app.delete("/api/fire-control/zone-equipment/:zone_id/:equipment_id/:alarm_level", async (req, res) => {
  try {
    const { zone_id, equipment_id, alarm_level } = req.params;
    await pool.query(`DELETE FROM fc_zone_equipment WHERE zone_id = $1 AND equipment_id = $2 AND alarm_level = $3`, [zone_id, equipment_id, alarm_level]);
    res.json({ success: true });
  } catch (err) {
    console.error("[FireControl] DELETE zone-equipment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Zone Checks
// ------------------------------

// List zone checks for a campaign
app.get("/api/fire-control/zone-checks", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { campaign_id, status, building } = req.query;

    let sql = `
      SELECT zc.*, z.code as zone_code, z.name as zone_name, z.building, z.floor, z.access_point, z.detector_numbers,
        (SELECT COUNT(*) FROM fc_equipment_results er WHERE er.zone_check_id = zc.id AND er.alarm_level = 1) as equipment_count_al1,
        (SELECT COUNT(*) FROM fc_equipment_results er WHERE er.zone_check_id = zc.id AND er.alarm_level = 2) as equipment_count_al2,
        (SELECT COUNT(*) FROM fc_equipment_results er WHERE er.zone_check_id = zc.id AND er.result = 'ok') as ok_count,
        (SELECT COUNT(*) FROM fc_equipment_results er WHERE er.zone_check_id = zc.id AND er.result = 'nok') as nok_count
      FROM fc_zone_checks zc
      JOIN fc_zones z ON z.id = zc.zone_id
      WHERE ${filter.where.replace(/company_id/g, 'zc.company_id').replace(/site_id/g, 'zc.site_id')}
    `;
    const params = [...filter.params];

    if (campaign_id) {
      params.push(campaign_id);
      sql += ` AND zc.campaign_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND zc.status = $${params.length}`;
    }
    if (building) {
      params.push(building);
      sql += ` AND z.building = $${params.length}`;
    }

    sql += ` ORDER BY z.building, z.floor, z.code`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET zone-checks error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get single zone check with all equipment results
app.get("/api/fire-control/zone-checks/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      SELECT zc.*, z.code as zone_code, z.name as zone_name, z.building, z.floor, z.access_point, z.detector_numbers, z.station
      FROM fc_zone_checks zc
      JOIN fc_zones z ON z.id = zc.zone_id
      WHERE zc.id = $1
    `, [id]);

    if (!rows.length) return res.status(404).json({ error: "Zone check not found" });

    // Get equipment results for Alarm 1
    const { rows: resultsAL1 } = await pool.query(`
      SELECT er.*, e.code as equipment_code, e.name as equipment_name, e.equipment_type, e.location, e.external_system, e.external_id
      FROM fc_equipment_results er
      JOIN fc_equipment e ON e.id = er.equipment_id
      WHERE er.zone_check_id = $1 AND er.alarm_level = 1
      ORDER BY e.equipment_type, e.name
    `, [id]);

    // Get equipment results for Alarm 2
    const { rows: resultsAL2 } = await pool.query(`
      SELECT er.*, e.code as equipment_code, e.name as equipment_name, e.equipment_type, e.location, e.external_system, e.external_id
      FROM fc_equipment_results er
      JOIN fc_equipment e ON e.id = er.equipment_id
      WHERE er.zone_check_id = $1 AND er.alarm_level = 2
      ORDER BY e.equipment_type, e.name
    `, [id]);

    // Get attached files
    const { rows: files } = await pool.query(`
      SELECT * FROM fc_check_files WHERE zone_check_id = $1 ORDER BY uploaded_at DESC
    `, [id]);

    res.json({
      ...rows[0],
      equipment_results_alarm1: resultsAL1,
      equipment_results_alarm2: resultsAL2,
      files,
    });
  } catch (err) {
    console.error("[FireControl] GET zone-check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Generate zone checks for a campaign (creates checks for all zones)
app.post("/api/fire-control/campaigns/:id/generate-checks", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = extractTenantFromRequest(req);
    const { building } = req.body;
    const { email } = getIdentityFromReq(req);

    // Get all zones
    let sql = `SELECT id FROM fc_zones WHERE company_id = $1 AND site_id = $2`;
    const params = [tenant.companyId, tenant.siteId];

    if (building) {
      params.push(building);
      sql += ` AND building = $${params.length}`;
    }

    const { rows: zones } = await pool.query(sql, params);

    let created = 0;
    for (const zone of zones) {
      // Check if already exists
      const { rows: existing } = await pool.query(
        `SELECT id FROM fc_zone_checks WHERE campaign_id = $1 AND zone_id = $2`,
        [id, zone.id]
      );

      if (!existing.length) {
        // Create zone check
        const { rows: checkRows } = await pool.query(`
          INSERT INTO fc_zone_checks (campaign_id, zone_id, company_id, site_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [id, zone.id, tenant.companyId, tenant.siteId]);

        const zoneCheckId = checkRows[0].id;

        // Create equipment results for all linked equipment
        await pool.query(`
          INSERT INTO fc_equipment_results (zone_check_id, equipment_id, alarm_level)
          SELECT $1, ze.equipment_id, ze.alarm_level
          FROM fc_zone_equipment ze
          WHERE ze.zone_id = $2
        `, [zoneCheckId, zone.id]);

        created++;
      }
    }

    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: "zone_checks_batch",
      entityId: id,
      details: { created_count: created, building },
    });

    if (created > 0) {
      notify(`🔥 Contrôles générés`, `${created} zone(s) à contrôler`, {
        type: 'fire_control_checks_generated',
        excludeUserId: email,
      }).catch(() => {});
    }

    res.json({ success: true, created_count: created, total_zones: zones.length });
  } catch (err) {
    console.error("[FireControl] Generate zone checks error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Start zone check (mark as in progress)
app.post("/api/fire-control/zone-checks/:id/start", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name } = getIdentityFromReq(req);
    const { detector_used } = req.body;

    const { rows } = await pool.query(`
      UPDATE fc_zone_checks SET
        status = 'in_progress',
        detector_used = $1,
        checked_by_email = $2,
        checked_by_name = $3,
        check_date = now(),
        updated_at = now()
      WHERE id = $4
      RETURNING *
    `, [detector_used, email, name, id]);

    if (!rows.length) return res.status(404).json({ error: "Zone check not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST zone-check start error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update equipment result
app.put("/api/fire-control/equipment-results/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { result, response_time_ms, notes } = req.body;

    const { rows } = await pool.query(`
      UPDATE fc_equipment_results SET
        result = COALESCE($1, result),
        response_time_ms = COALESCE($2, response_time_ms),
        notes = COALESCE($3, notes),
        checked_at = CASE WHEN $1 IS NOT NULL AND $1 != 'pending' THEN now() ELSE checked_at END
      WHERE id = $4
      RETURNING *
    `, [result, response_time_ms, notes, id]);

    if (!rows.length) return res.status(404).json({ error: "Equipment result not found" });

    // Recalculate zone check status
    const zoneCheckId = rows[0].zone_check_id;
    const { rows: allResults } = await pool.query(
      `SELECT result FROM fc_equipment_results WHERE zone_check_id = $1`,
      [zoneCheckId]
    );

    const newStatus = calculateZoneCheckStatus(allResults);
    await pool.query(`UPDATE fc_zone_checks SET status = $1, updated_at = now() WHERE id = $2`, [newStatus, zoneCheckId]);

    res.json({ ...rows[0], zone_check_status: newStatus });
  } catch (err) {
    console.error("[FireControl] PUT equipment-result error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Batch update equipment results for a zone check
app.put("/api/fire-control/zone-checks/:id/results", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name } = getIdentityFromReq(req);
    const { alarm1_triggered, alarm2_triggered, notes, results } = req.body;

    // Update zone check
    await pool.query(`
      UPDATE fc_zone_checks SET
        alarm1_triggered = COALESCE($1, alarm1_triggered),
        alarm2_triggered = COALESCE($2, alarm2_triggered),
        notes = COALESCE($3, notes),
        checked_by_email = $4,
        checked_by_name = $5,
        check_date = now(),
        updated_at = now()
      WHERE id = $6
    `, [alarm1_triggered, alarm2_triggered, notes, email, name, id]);

    // Update individual equipment results
    if (results && Array.isArray(results)) {
      for (const r of results) {
        await pool.query(`
          UPDATE fc_equipment_results SET
            result = $1,
            response_time_ms = $2,
            notes = $3,
            checked_at = CASE WHEN $1 != 'pending' THEN now() ELSE checked_at END
          WHERE id = $4
        `, [r.result, r.response_time_ms, r.notes, r.id]);
      }
    }

    // Recalculate status
    const { rows: allResults } = await pool.query(
      `SELECT result FROM fc_equipment_results WHERE zone_check_id = $1`,
      [id]
    );

    const newStatus = calculateZoneCheckStatus(allResults);
    const { rows } = await pool.query(
      `UPDATE fc_zone_checks SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [newStatus, id]
    );

    await audit.log(req, AUDIT_ACTIONS.CHECK_COMPLETED, {
      entityType: "zone_check",
      entityId: id,
      details: { status: newStatus, alarm1_triggered, alarm2_triggered },
    });

    // Send notification
    if (newStatus === 'passed') {
      notifyMaintenanceCompleted('fire_control', { id, name: `Zone check ${id}` }, { status: newStatus }, email).catch(() => {});
    } else if (newStatus === 'failed' || newStatus === 'partial') {
      notifyNonConformity('fire_control', { id, name: `Zone check ${id}` }, `Status: ${newStatus}`).catch(() => {});
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] PUT zone-check results error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Upload file for zone check
app.post("/api/fire-control/zone-checks/:id/files", uploadFile.single("file"), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name } = getIdentityFromReq(req);
    const { file_type, equipment_result_id } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const fileContent = await fsp.readFile(filePath);

    const { rows } = await pool.query(`
      INSERT INTO fc_check_files (zone_check_id, equipment_result_id, filename, file_path, content, mime, file_type, uploaded_by_email, uploaded_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [id, equipment_result_id, req.file.originalname, filePath, fileContent, req.file.mimetype, file_type || 'photo', email, name]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] Upload zone-check file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Matrices
// ------------------------------

app.post("/api/fire-control/matrices/upload", uploadMatrix.single("file"), async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { campaign_id, matrix_name, version } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const fileContent = await fsp.readFile(filePath);

    if (matrix_name) {
      await pool.query(`
        UPDATE fc_matrices SET is_active = false
        WHERE name = $1 AND company_id = $2 AND site_id = $3
      `, [matrix_name, tenant.companyId, tenant.siteId]);
    }

    const { rows } = await pool.query(`
      INSERT INTO fc_matrices (campaign_id, name, filename, file_path, content, version, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [campaign_id, matrix_name || req.file.originalname, req.file.filename, filePath, fileContent, version || "1.0", tenant.companyId, tenant.siteId]);

    await audit.log(req, AUDIT_ACTIONS.FILE_UPLOADED, { entityType: "matrix", entityId: rows[0].id });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] Upload matrix error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/matrices", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { active_only } = req.query;

    let sql = `SELECT id, campaign_id, name, filename, version, upload_date, is_active, created_at FROM fc_matrices WHERE ${filter.where}`;
    if (active_only === "true") sql += ` AND is_active = true`;
    sql += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(sql, filter.params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET matrices error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/matrices/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path FROM fc_matrices WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "Matrix not found" });

    let buffer = rows[0].content;
    if (!buffer && rows[0].file_path) {
      try { buffer = await fsp.readFile(rows[0].file_path); } catch {}
    }
    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${rows[0].filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET matrix file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Parse matrix and create zones + equipment
app.post("/api/fire-control/matrices/:id/parse", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = extractTenantFromRequest(req);
    const { zones, equipment, zone_equipment_links } = req.body;

    await pool.query(`UPDATE fc_matrices SET parsed_data = $1 WHERE id = $2`, [JSON.stringify(req.body), id]);

    let zonesCreated = 0;
    let equipmentCreated = 0;
    let linksCreated = 0;

    // Create zones
    if (zones && Array.isArray(zones)) {
      for (const z of zones) {
        const { rows } = await pool.query(`
          INSERT INTO fc_zones (code, name, description, building, floor, access_point, station, detector_numbers, detector_type, matrix_id, company_id, site_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (code, company_id, site_id) DO UPDATE SET
            name = EXCLUDED.name, description = EXCLUDED.description, building = EXCLUDED.building,
            floor = EXCLUDED.floor, access_point = EXCLUDED.access_point, station = EXCLUDED.station,
            detector_numbers = EXCLUDED.detector_numbers, matrix_id = EXCLUDED.matrix_id, updated_at = now()
          RETURNING id
        `, [z.code, z.name, z.description, z.building, z.floor, z.access_point, z.station, z.detector_numbers, z.detector_type || 'smoke', id, tenant.companyId, tenant.siteId]);
        if (rows.length) zonesCreated++;
      }
    }

    // Create equipment
    if (equipment && Array.isArray(equipment)) {
      for (const e of equipment) {
        const { rows } = await pool.query(`
          INSERT INTO fc_equipment (code, name, equipment_type, category, building, floor, location, fdcio_module, fdcio_output, matrix_id, company_id, site_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (code, company_id, site_id) DO UPDATE SET
            name = EXCLUDED.name, equipment_type = EXCLUDED.equipment_type, category = EXCLUDED.category,
            building = EXCLUDED.building, location = EXCLUDED.location, fdcio_module = EXCLUDED.fdcio_module,
            fdcio_output = EXCLUDED.fdcio_output, matrix_id = EXCLUDED.matrix_id, updated_at = now()
          RETURNING id
        `, [e.code, e.name, e.equipment_type, e.category, e.building, e.floor, e.location, e.fdcio_module, e.fdcio_output, id, tenant.companyId, tenant.siteId]);
        if (rows.length) equipmentCreated++;
      }
    }

    // Create zone-equipment links
    if (zone_equipment_links && Array.isArray(zone_equipment_links)) {
      for (const link of zone_equipment_links) {
        // Get zone and equipment IDs by code
        const { rows: zoneRows } = await pool.query(`SELECT id FROM fc_zones WHERE code = $1 AND company_id = $2 AND site_id = $3`, [link.zone_code, tenant.companyId, tenant.siteId]);
        const { rows: equipRows } = await pool.query(`SELECT id FROM fc_equipment WHERE code = $1 AND company_id = $2 AND site_id = $3`, [link.equipment_code, tenant.companyId, tenant.siteId]);

        if (zoneRows.length && equipRows.length) {
          await pool.query(`
            INSERT INTO fc_zone_equipment (zone_id, equipment_id, alarm_level, action_type, matrix_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (zone_id, equipment_id, alarm_level) DO NOTHING
          `, [zoneRows[0].id, equipRows[0].id, link.alarm_level || 1, link.action_type || 'activate', id]);
          linksCreated++;
        }
      }
    }

    await audit.log(req, AUDIT_ACTIONS.UPDATED, {
      entityType: "matrix",
      entityId: id,
      details: { action: "parsed", zones: zonesCreated, equipment: equipmentCreated, links: linksCreated },
    });

    res.json({ success: true, zones_created: zonesCreated, equipment_created: equipmentCreated, links_created: linksCreated });
  } catch (err) {
    console.error("[FireControl] Parse matrix error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Building Plans
// ------------------------------

app.post("/api/fire-control/plans/upload", uploadPlan.single("file"), async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { building, floor, plan_name, version } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const fileContent = await fsp.readFile(filePath);

    let pageCount = 1;
    try {
      const pdfDoc = await pdfjsLib.getDocument({ data: fileContent }).promise;
      pageCount = pdfDoc.numPages;
    } catch {}

    if (building) {
      await pool.query(`
        UPDATE fc_building_plans SET is_active = false
        WHERE building = $1 AND floor = $2 AND company_id = $3 AND site_id = $4
      `, [building, floor || '', tenant.companyId, tenant.siteId]);
    }

    const { rows } = await pool.query(`
      INSERT INTO fc_building_plans (building, floor, name, filename, file_path, content, version, page_count, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [building, floor, plan_name || req.file.originalname, req.file.filename, filePath, fileContent, version || "1.0", pageCount, tenant.companyId, tenant.siteId]);

    await audit.log(req, AUDIT_ACTIONS.FILE_UPLOADED, { entityType: "building_plan", entityId: rows[0].id });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] Upload plan error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/plans", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { building, active_only } = req.query;

    let sql = `SELECT id, building, floor, name, filename, version, page_count, is_active, created_at FROM fc_building_plans WHERE ${filter.where}`;
    const params = [...filter.params];

    if (active_only === "true") sql += ` AND is_active = true`;
    if (building) {
      params.push(building);
      sql += ` AND building = $${params.length}`;
    }
    sql += ` ORDER BY building, floor, created_at DESC`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET plans error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/plans/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path FROM fc_building_plans WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "Plan not found" });

    let buffer = rows[0].content;
    if (!buffer && rows[0].file_path) {
      try { buffer = await fsp.readFile(rows[0].file_path); } catch {}
    }
    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${rows[0].filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET plan file error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/buildings", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);

    const { rows } = await pool.query(`
      SELECT DISTINCT building, array_agg(DISTINCT floor) as floors
      FROM fc_building_plans
      WHERE ${filter.where} AND is_active = true
      GROUP BY building
      ORDER BY building
    `, filter.params);

    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET buildings error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Dashboard
// ------------------------------

app.get("/api/fire-control/dashboard", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const year = req.query.year || new Date().getFullYear();

    // Campaign stats
    const campaignStats = await pool.query(`
      SELECT COUNT(*) as total_campaigns,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress
      FROM fc_campaigns
      WHERE ${filter.where} AND year = $${filter.params.length + 1}
    `, [...filter.params, year]);

    // Zone check stats
    const checkStats = await pool.query(`
      SELECT COUNT(*) as total_checks,
        COUNT(*) FILTER (WHERE zc.status = 'passed') as passed,
        COUNT(*) FILTER (WHERE zc.status = 'failed') as failed,
        COUNT(*) FILTER (WHERE zc.status = 'partial') as partial,
        COUNT(*) FILTER (WHERE zc.status = 'pending') as pending
      FROM fc_zone_checks zc
      JOIN fc_campaigns camp ON camp.id = zc.campaign_id
      WHERE ${filter.where.replace(/company_id/g, 'zc.company_id').replace(/site_id/g, 'zc.site_id')} AND camp.year = $${filter.params.length + 1}
    `, [...filter.params, year]);

    // Building summary
    const buildingStats = await pool.query(`
      SELECT z.building,
        COUNT(DISTINCT z.id) as zone_count,
        COUNT(DISTINCT zc.id) as check_count,
        COUNT(*) FILTER (WHERE zc.status = 'passed') as passed,
        COUNT(*) FILTER (WHERE zc.status = 'failed') as failed
      FROM fc_zones z
      LEFT JOIN fc_zone_checks zc ON zc.zone_id = z.id
      LEFT JOIN fc_campaigns camp ON camp.id = zc.campaign_id AND camp.year = $${filter.params.length + 1}
      WHERE ${filter.where.replace(/company_id/g, 'z.company_id').replace(/site_id/g, 'z.site_id')}
      GROUP BY z.building
      ORDER BY z.building
    `, [...filter.params, year]);

    // Equipment summary by type
    const equipmentStats = await pool.query(`
      SELECT equipment_type, COUNT(*) as count
      FROM fc_equipment
      WHERE ${filter.where}
      GROUP BY equipment_type
      ORDER BY count DESC
    `, filter.params);

    // Upcoming schedule
    const upcoming = await pool.query(`
      SELECT s.*, c.name as campaign_name
      FROM fc_schedule s
      LEFT JOIN fc_campaigns c ON c.id = s.campaign_id
      WHERE ${filter.where.replace(/company_id/g, 's.company_id').replace(/site_id/g, 's.site_id')}
        AND s.scheduled_date >= CURRENT_DATE AND s.status != 'completed'
      ORDER BY s.scheduled_date LIMIT 10
    `, filter.params);

    res.json({
      year: Number(year),
      campaigns: campaignStats.rows[0],
      checks: checkStats.rows[0],
      buildings: buildingStats.rows,
      equipment_by_type: equipmentStats.rows,
      upcoming_schedule: upcoming.rows,
    });
  } catch (err) {
    console.error("[FireControl] GET dashboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Schedule
// ------------------------------

app.get("/api/fire-control/schedule", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { year, building } = req.query;

    let sql = `SELECT s.*, c.name as campaign_name FROM fc_schedule s LEFT JOIN fc_campaigns c ON c.id = s.campaign_id WHERE ${filter.where.replace(/company_id/g, 's.company_id').replace(/site_id/g, 's.site_id')}`;
    const params = [...filter.params];

    if (year) {
      params.push(Number(year));
      sql += ` AND EXTRACT(YEAR FROM s.scheduled_date) = $${params.length}`;
    }
    if (building) {
      params.push(building);
      sql += ` AND s.building = $${params.length}`;
    }
    sql += ` ORDER BY s.scheduled_date`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET schedule error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/fire-control/schedule", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { building, scheduled_date, campaign_id, assigned_to, notes } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_schedule (building, scheduled_date, campaign_id, assigned_to, notes, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [building, scheduled_date, campaign_id, assigned_to, notes, tenant.companyId, tenant.siteId]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST schedule error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/fire-control/schedule/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduled_date, status, assigned_to, notes } = req.body;

    const { rows } = await pool.query(`
      UPDATE fc_schedule SET
        scheduled_date = COALESCE($1, scheduled_date),
        status = COALESCE($2, status),
        assigned_to = COALESCE($3, assigned_to),
        notes = COALESCE($4, notes),
        updated_at = now()
      WHERE id = $5 RETURNING *
    `, [scheduled_date, status, assigned_to, notes, id]);

    if (!rows.length) return res.status(404).json({ error: "Schedule entry not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] PUT schedule error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Reports
// ------------------------------

app.post("/api/fire-control/campaigns/:id/report", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = extractTenantFromRequest(req);
    const { email, name } = getIdentityFromReq(req);

    const { rows: campRows } = await pool.query(`SELECT * FROM fc_campaigns WHERE id = $1`, [id]);
    if (!campRows.length) return res.status(404).json({ error: "Campaign not found" });
    const campaign = campRows[0];

    // Get all zone checks with results
    const { rows: zoneChecks } = await pool.query(`
      SELECT zc.*, z.code as zone_code, z.name as zone_name, z.building, z.floor
      FROM fc_zone_checks zc
      JOIN fc_zones z ON z.id = zc.zone_id
      WHERE zc.campaign_id = $1
      ORDER BY z.building, z.floor, z.code
    `, [id]);

    // Generate PDF
    const doc = new PDFDocument({ margin: 50 });
    const filename = `fire_control_report_${campaign.year}_${Date.now()}.pdf`;
    const filePath = path.join(REPORTS_DIR, filename);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    doc.fontSize(20).text("Rapport de Contrôle des Asservissements Incendie", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Campagne: ${campaign.name}`, { align: "center" });
    doc.fontSize(12).text(`Année: ${campaign.year}`, { align: "center" });
    doc.text(`Date du rapport: ${new Date().toLocaleDateString("fr-FR")}`, { align: "center" });
    doc.moveDown(2);

    const passed = zoneChecks.filter(c => c.status === "passed").length;
    const failed = zoneChecks.filter(c => c.status === "failed").length;
    const partial = zoneChecks.filter(c => c.status === "partial").length;
    const pending = zoneChecks.filter(c => c.status === "pending").length;

    doc.fontSize(14).text("Résumé", { underline: true });
    doc.fontSize(11);
    doc.text(`Total des zones: ${zoneChecks.length}`);
    doc.text(`Conformes: ${passed}`);
    doc.text(`Non-conformes: ${failed}`);
    doc.text(`Partiels: ${partial}`);
    doc.text(`En attente: ${pending}`);
    doc.moveDown(2);

    // Group by building
    const byBuilding = {};
    for (const check of zoneChecks) {
      const bld = check.building || "Non défini";
      if (!byBuilding[bld]) byBuilding[bld] = [];
      byBuilding[bld].push(check);
    }

    for (const [building, buildingChecks] of Object.entries(byBuilding)) {
      doc.fontSize(13).text(`Bâtiment: ${building}`, { underline: true });
      doc.moveDown(0.5);

      for (const check of buildingChecks) {
        const statusIcon = check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : check.status === "partial" ? "◐" : "○";
        doc.fontSize(10).text(`${statusIcon} Zone ${check.zone_code} - ${check.zone_name} - AL1: ${check.alarm1_triggered ? "OK" : "-"} | AL2: ${check.alarm2_triggered ? "OK" : "-"}`);
        if (check.notes) doc.fontSize(9).text(`   Notes: ${check.notes}`, { indent: 20 });
      }
      doc.moveDown();
    }

    doc.moveDown(2);
    doc.fontSize(9).text(`Généré par: ${name || email || "Système"}`, { align: "right" });
    doc.end();

    await new Promise((resolve) => writeStream.on("finish", resolve));

    const fileContent = await fsp.readFile(filePath);
    const { rows: reportRows } = await pool.query(`
      INSERT INTO fc_reports (campaign_id, report_type, filename, file_path, content, generated_by_email, generated_by_name, company_id, site_id)
      VALUES ($1, 'control', $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [id, filename, filePath, fileContent, email, name, tenant.companyId, tenant.siteId]);

    await audit.log(req, AUDIT_ACTIONS.EXPORTED, { entityType: "report", entityId: reportRows[0].id });
    res.json({ success: true, report_id: reportRows[0].id, filename });
  } catch (err) {
    console.error("[FireControl] Generate report error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/reports/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path FROM fc_reports WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "Report not found" });

    let buffer = rows[0].content;
    if (!buffer && rows[0].file_path) {
      try { buffer = await fsp.readFile(rows[0].file_path); } catch {}
    }
    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${rows[0].filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET report file error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/reports", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { campaign_id } = req.query;

    let sql = `SELECT id, campaign_id, report_type, filename, generated_by_name, created_at FROM fc_reports WHERE ${filter.where}`;
    const params = [...filter.params];

    if (campaign_id) {
      params.push(campaign_id);
      sql += ` AND campaign_id = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET reports error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: External System Links
// ------------------------------

// Link equipment to external system (Doors, Switchboard, etc.)
app.post("/api/fire-control/equipment/:id/link-external", async (req, res) => {
  try {
    const { id } = req.params;
    const { external_system, external_id } = req.body;

    const { rows } = await pool.query(`
      UPDATE fc_equipment SET
        external_system = $1,
        external_id = $2,
        updated_at = now()
      WHERE id = $3
      RETURNING *
    `, [external_system, external_id, id]);

    if (!rows.length) return res.status(404).json({ error: "Equipment not found" });

    await audit.log(req, AUDIT_ACTIONS.UPDATED, {
      entityType: "equipment",
      entityId: id,
      details: { external_system, external_id },
    });

    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] Link external error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get equipment linked to a specific external system/id
app.get("/api/fire-control/equipment/by-external", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { system, id: externalId } = req.query;

    let sql = `SELECT * FROM fc_equipment WHERE ${filter.where}`;
    const params = [...filter.params];

    if (system) {
      params.push(system);
      sql += ` AND external_system = $${params.length}`;
    }
    if (externalId) {
      params.push(externalId);
      sql += ` AND external_id = $${params.length}`;
    }

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET equipment by external error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Maps
// ------------------------------

app.get("/api/fire-control/maps/listPlans", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);

    const { rows } = await pool.query(`
      SELECT id, building, floor, name, filename, version, page_count, is_active, created_at
      FROM fc_building_plans WHERE ${filter.where} AND is_active = true
      ORDER BY building, floor
    `, filter.params);

    const plans = rows.map(p => ({
      ...p,
      logical_name: `${p.building}_${p.floor || 'all'}`.replace(/\s+/g, '_'),
      display_name: `${p.building} - ${p.floor || 'Tous niveaux'}`,
    }));

    res.json({ plans });
  } catch (err) {
    console.error("[FireControl] GET maps/listPlans error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/maps/planFile", async (req, res) => {
  try {
    const { id } = req.query;

    const { rows } = await pool.query(`SELECT filename, content, file_path FROM fc_building_plans WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "Plan not found" });

    let buffer = rows[0].content;
    if (!buffer && rows[0].file_path) {
      try { buffer = await fsp.readFile(rows[0].file_path); } catch {}
    }
    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${rows[0].filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET maps/planFile error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fire-control/maps/positions", async (req, res) => {
  try {
    const { plan_id, page_index = 0 } = req.query;
    if (!plan_id) return res.json({ positions: [] });

    const { rows } = await pool.query(`
      SELECT mp.*,
        CASE mp.entity_type WHEN 'zone' THEN z.code WHEN 'equipment' THEN e.code END as entity_code,
        CASE mp.entity_type WHEN 'zone' THEN z.name WHEN 'equipment' THEN e.name END as entity_name
      FROM fc_map_positions mp
      LEFT JOIN fc_zones z ON mp.entity_type = 'zone' AND mp.entity_id = z.id
      LEFT JOIN fc_equipment e ON mp.entity_type = 'equipment' AND mp.entity_id = e.id
      WHERE mp.plan_id = $1 AND mp.page_index = $2
    `, [plan_id, Number(page_index)]);

    res.json({ positions: rows });
  } catch (err) {
    console.error("[FireControl] GET maps/positions error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/fire-control/maps/setPosition", async (req, res) => {
  try {
    const { entity_type, entity_id, plan_id, page_index = 0, x_frac, y_frac } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_map_positions (entity_type, entity_id, plan_id, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (entity_type, entity_id, plan_id, page_index)
      DO UPDATE SET x_frac = $5, y_frac = $6, updated_at = now()
      RETURNING *
    `, [entity_type, entity_id, plan_id, page_index, x_frac, y_frac]);

    await audit.log(req, AUDIT_ACTIONS.POSITION_SET, { entityType: "map_position", entityId: rows[0].id });
    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST maps/setPosition error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/fire-control/maps/positions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM fc_map_positions WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("[FireControl] DELETE position error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Files
// ------------------------------

app.get("/api/fire-control/files/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path, mime FROM fc_check_files WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "File not found" });

    let buffer = rows[0].content;
    if (!buffer && rows[0].file_path) {
      try { buffer = await fsp.readFile(rows[0].file_path); } catch {}
    }
    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", rows[0].mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${rows[0].filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Alerts
// ------------------------------

app.get("/api/fire-control/alerts", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);

    const overdueSchedule = await pool.query(`
      SELECT s.*, c.name as campaign_name
      FROM fc_schedule s
      LEFT JOIN fc_campaigns c ON c.id = s.campaign_id
      WHERE ${filter.where.replace(/company_id/g, 's.company_id').replace(/site_id/g, 's.site_id')}
        AND s.scheduled_date < CURRENT_DATE AND s.status NOT IN ('completed', 'cancelled')
      ORDER BY s.scheduled_date
    `, filter.params);

    const overdueChecks = await pool.query(`
      SELECT c.id as campaign_id, c.name as campaign_name, c.end_date,
        COUNT(*) FILTER (WHERE zc.status = 'pending') as pending_count,
        COUNT(*) as total_checks
      FROM fc_campaigns c
      LEFT JOIN fc_zone_checks zc ON zc.campaign_id = c.id
      WHERE ${filter.where.replace(/company_id/g, 'c.company_id').replace(/site_id/g, 'c.site_id')}
        AND c.end_date < CURRENT_DATE AND c.status = 'in_progress'
      GROUP BY c.id, c.name, c.end_date
      HAVING COUNT(*) FILTER (WHERE zc.status = 'pending') > 0
    `, filter.params);

    const upcomingSchedule = await pool.query(`
      SELECT s.*, c.name as campaign_name
      FROM fc_schedule s
      LEFT JOIN fc_campaigns c ON c.id = s.campaign_id
      WHERE ${filter.where.replace(/company_id/g, 's.company_id').replace(/site_id/g, 's.site_id')}
        AND s.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        AND s.status = 'scheduled'
      ORDER BY s.scheduled_date
    `, filter.params);

    res.json({
      overdue_schedule: overdueSchedule.rows,
      overdue_campaigns: overdueChecks.rows,
      upcoming: upcomingSchedule.rows,
      summary: {
        overdue_count: overdueSchedule.rows.length + overdueChecks.rows.length,
        upcoming_count: upcomingSchedule.rows.length,
      }
    });
  } catch (err) {
    console.error("[FireControl] GET alerts error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Cross-System Equipment (from Doors, Switchboard, etc.)
// ------------------------------

// Get all fire-interlock linked equipment from external systems with positions
app.get("/api/fire-control/cross-system-equipment", async (req, res) => {
  try {
    const { plan_logical_name, page_index = 0, zone_check_id } = req.query;
    const allEquipment = [];

    // 1. Fetch doors with fire_interlock=true
    const doorsQuery = await pool.query(`
      SELECT
        d.id, d.code, d.name, d.building, d.floor, d.location,
        d.fire_interlock_zone_id, d.fire_interlock_alarm_level,
        'doors' as source_system, 'pcf' as equipment_type,
        pos.id as position_id, pos.plan_logical_name, pos.page_index, pos.x_frac, pos.y_frac
      FROM fd_doors d
      LEFT JOIN fd_door_positions pos ON pos.door_id = d.id
      WHERE d.fire_interlock = true
        ${plan_logical_name ? `AND pos.plan_logical_name = $1` : ''}
        ${plan_logical_name ? `AND pos.page_index = $2` : ''}
    `, plan_logical_name ? [plan_logical_name, Number(page_index)] : []);

    for (const door of doorsQuery.rows) {
      allEquipment.push({
        id: door.id,
        code: door.code || door.name,
        name: door.name,
        building: door.building,
        floor: door.floor,
        location: door.location,
        equipment_type: door.equipment_type,
        source_system: door.source_system,
        zone_id: door.fire_interlock_zone_id,
        alarm_level: door.fire_interlock_alarm_level || 1,
        position_id: door.position_id,
        plan_logical_name: door.plan_logical_name,
        page_index: door.page_index,
        x_frac: door.x_frac,
        y_frac: door.y_frac,
        check_status: null, // Will be filled if zone_check_id provided
      });
    }

    // 2. If zone_check_id provided, fetch equipment results to get check status
    if (zone_check_id) {
      const resultsQuery = await pool.query(`
        SELECT er.*, e.external_system, e.external_id
        FROM fc_equipment_results er
        JOIN fc_equipment e ON e.id = er.equipment_id
        WHERE er.zone_check_id = $1
      `, [zone_check_id]);

      const resultsMap = new Map();
      for (const r of resultsQuery.rows) {
        if (r.external_system && r.external_id) {
          resultsMap.set(`${r.external_system}:${r.external_id}`, r.result);
        }
      }

      // Update equipment with check status
      for (const eq of allEquipment) {
        const key = `${eq.source_system}:${eq.id}`;
        if (resultsMap.has(key)) {
          eq.check_status = resultsMap.get(key);
        }
      }
    }

    // TODO: Add switchboard equipment when needed
    // const switchQuery = await pool.query(...)

    res.json({
      equipment: allEquipment,
      sources: ['doors'], // Add more as we implement
      count: allEquipment.length,
    });
  } catch (err) {
    console.error("[FireControl] GET cross-system-equipment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get plans from doors system (shared plans)
app.get("/api/fire-control/shared-plans", async (req, res) => {
  try {
    // Get plans from fd_plans (doors system)
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name, p.page_count)
        p.id, p.logical_name, p.version, p.filename, p.page_count, p.created_at,
        pn.display_name
      FROM fd_plans p
      LEFT JOIN fd_plan_names pn ON pn.logical_name = p.logical_name
      ORDER BY p.logical_name, p.page_count, p.created_at DESC
    `);

    const plans = rows.map(p => ({
      id: p.id,
      logical_name: p.logical_name,
      display_name: p.display_name || p.logical_name,
      version: p.version,
      filename: p.filename,
      page_count: p.page_count || 1,
      created_at: p.created_at,
      source: 'doors',
    }));

    res.json({ plans });
  } catch (err) {
    console.error("[FireControl] GET shared-plans error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get plan file from doors system
app.get("/api/fire-control/shared-plans/:logicalName/file", async (req, res) => {
  try {
    const { logicalName } = req.params;
    const { page } = req.query;

    const { rows } = await pool.query(`
      SELECT filename, content, file_path
      FROM fd_plans
      WHERE logical_name = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [logicalName]);

    if (!rows.length) return res.status(404).json({ error: "Plan not found" });

    let buffer = rows[0].content;
    if (!buffer && rows[0].file_path) {
      try { buffer = await fsp.readFile(rows[0].file_path); } catch {}
    }
    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${rows[0].filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET shared-plan file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get equipment positions for a zone check (with blinking status)
app.get("/api/fire-control/zone-checks/:id/equipment-map", async (req, res) => {
  try {
    const { id } = req.params;

    // Get zone check with zone info
    const { rows: checkRows } = await pool.query(`
      SELECT zc.*, z.code as zone_code, z.name as zone_name, z.building, z.floor
      FROM fc_zone_checks zc
      JOIN fc_zones z ON z.id = zc.zone_id
      WHERE zc.id = $1
    `, [id]);

    if (!checkRows.length) return res.status(404).json({ error: "Zone check not found" });
    const zoneCheck = checkRows[0];

    // Get equipment results for this check
    const { rows: resultRows } = await pool.query(`
      SELECT er.*, e.code, e.name, e.equipment_type, e.building, e.location,
        e.external_system, e.external_id
      FROM fc_equipment_results er
      JOIN fc_equipment e ON e.id = er.equipment_id
      WHERE er.zone_check_id = $1
    `, [id]);

    // Get cross-system equipment positions
    const crossSystemEquipment = [];

    for (const result of resultRows) {
      if (result.external_system === 'doors' && result.external_id) {
        const { rows: doorPos } = await pool.query(`
          SELECT pos.*, d.name, d.code, d.building, d.floor
          FROM fd_door_positions pos
          JOIN fd_doors d ON d.id = pos.door_id
          WHERE d.id = $1
        `, [result.external_id]);

        if (doorPos.length) {
          crossSystemEquipment.push({
            result_id: result.id,
            equipment_id: result.equipment_id,
            code: result.code,
            name: result.name,
            equipment_type: result.equipment_type,
            alarm_level: result.alarm_level,
            result: result.result,
            source_system: 'doors',
            external_id: result.external_id,
            plan_logical_name: doorPos[0].plan_logical_name,
            page_index: doorPos[0].page_index,
            x_frac: doorPos[0].x_frac,
            y_frac: doorPos[0].y_frac,
            building: doorPos[0].building,
            floor: doorPos[0].floor,
          });
        }
      }
    }

    res.json({
      zone_check: zoneCheck,
      equipment_positions: crossSystemEquipment,
      summary: {
        total: crossSystemEquipment.length,
        pending: crossSystemEquipment.filter(e => e.result === 'pending').length,
        ok: crossSystemEquipment.filter(e => e.result === 'ok').length,
        nok: crossSystemEquipment.filter(e => e.result === 'nok').length,
        na: crossSystemEquipment.filter(e => e.result === 'na').length,
      }
    });
  } catch (err) {
    console.error("[FireControl] GET zone-check equipment-map error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// Health check
// ------------------------------
app.get("/api/fire-control/health", (req, res) => {
  res.json({ status: "ok", service: "fire-control-v2", timestamp: new Date().toISOString() });
});

// ------------------------------
// Start
// ------------------------------
async function start() {
  try {
    await ensureSchema();
    app.listen(PORT, HOST, () => {
      console.log(`[FireControl v2.0] Server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error("[FireControl] Failed to start:", err);
    process.exit(1);
  }
}

start();
