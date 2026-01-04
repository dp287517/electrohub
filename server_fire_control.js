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
import { extractTenantFromRequest, getTenantFilter, enrichTenantWithSiteId } from "./lib/tenant-filter.js";
import { notifyEquipmentCreated, notifyMaintenanceCompleted, notifyStatusChanged, notifyNonConformity, notify } from "./lib/push-notify.js";
import OpenAI from "openai";

// OpenAI client for AI analysis (optional - only if API key is configured)
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("[FireControl] OpenAI client initialized");
  } else {
    console.warn("[FireControl] OPENAI_API_KEY not set - AI parsing disabled");
  }
} catch (e) {
  console.warn("[FireControl] OpenAI init error:", e.message);
}

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

  // Migration: Add missing columns to fc_check_files (for tables created before these columns were added)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fc_check_files' AND column_name = 'zone_check_id') THEN
        ALTER TABLE fc_check_files ADD COLUMN zone_check_id UUID REFERENCES fc_zone_checks(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fc_check_files' AND column_name = 'equipment_result_id') THEN
        ALTER TABLE fc_check_files ADD COLUMN equipment_result_id UUID REFERENCES fc_equipment_results(id) ON DELETE SET NULL;
      END IF;
    END $$;
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

  // 13. Matrix Parse Jobs (background AI analysis)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_matrix_parse_jobs (
      id TEXT PRIMARY KEY,
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE CASCADE,
      site TEXT NOT NULL,
      user_email TEXT,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      message TEXT,
      result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      notified BOOLEAN DEFAULT FALSE,
      company_id INT,
      site_id INT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_matrix_parse_jobs_status ON fc_matrix_parse_jobs(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_matrix_parse_jobs_matrix ON fc_matrix_parse_jobs(matrix_id);`);

  await audit.ensureTable();
  console.log("[FireControl] Schema v2.0 ensured (zone-centric)");
}

// In-memory cache for matrix parse jobs
const matrixParseJobs = new Map();

// Save job to database
async function saveMatrixParseJob(job) {
  try {
    await pool.query(`
      INSERT INTO fc_matrix_parse_jobs (id, matrix_id, site, user_email, status, progress, message, result, error, created_at, completed_at, notified, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10::double precision / 1000), $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        status = $5,
        progress = $6,
        message = $7,
        result = $8,
        error = $9,
        completed_at = $11,
        notified = $12
    `, [
      job.id,
      job.matrix_id,
      job.site,
      job.user_email,
      job.status,
      job.progress,
      job.message,
      job.result ? JSON.stringify(job.result) : null,
      job.error || null,
      job.created_at,
      job.completed_at ? new Date(job.completed_at) : null,
      job.notified || false,
      job.company_id,
      job.site_id
    ]);
  } catch (e) {
    console.warn(`[FireControl] Failed to save parse job: ${e.message}`);
  }
}

// Get job from memory or database
async function getMatrixParseJob(jobId) {
  let job = matrixParseJobs.get(jobId);
  if (job) return job;

  try {
    const { rows } = await pool.query(`
      SELECT id, matrix_id, site, user_email, status, progress, message, result, error,
             EXTRACT(EPOCH FROM created_at) * 1000 as created_at,
             EXTRACT(EPOCH FROM completed_at) * 1000 as completed_at,
             notified, company_id, site_id
      FROM fc_matrix_parse_jobs WHERE id = $1
    `, [jobId]);

    if (rows.length > 0) {
      job = {
        ...rows[0],
        created_at: parseInt(rows[0].created_at),
        completed_at: rows[0].completed_at ? parseInt(rows[0].completed_at) : null
      };
      matrixParseJobs.set(jobId, job);
      return job;
    }
  } catch (e) {
    console.warn(`[FireControl] Failed to load parse job: ${e.message}`);
  }
  return null;
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

    // Get equipment results for Alarm 1 with source system positions
    const { rows: resultsAL1 } = await pool.query(`
      SELECT er.*, e.code as equipment_code, e.name as equipment_name, e.equipment_type, e.location,
             e.external_system, e.external_id, e.fdcio_module, e.fdcio_output
      FROM fc_equipment_results er
      JOIN fc_equipment e ON e.id = er.equipment_id
      WHERE er.zone_check_id = $1 AND er.alarm_level = 1
      ORDER BY e.equipment_type, e.name
    `, [id]);

    // Get equipment results for Alarm 2 with source system positions
    const { rows: resultsAL2 } = await pool.query(`
      SELECT er.*, e.code as equipment_code, e.name as equipment_name, e.equipment_type, e.location,
             e.external_system, e.external_id, e.fdcio_module, e.fdcio_output
      FROM fc_equipment_results er
      JOIN fc_equipment e ON e.id = er.equipment_id
      WHERE er.zone_check_id = $1 AND er.alarm_level = 2
      ORDER BY e.equipment_type, e.name
    `, [id]);

    // Enrich equipment results with positions from source systems
    const enrichWithPositions = async (results) => {
      for (const eq of results) {
        if (eq.external_system && eq.external_id) {
          try {
            if (eq.external_system === 'doors') {
              const { rows } = await pool.query(`
                SELECT pos.plan_logical_name, pos.page_index, pos.x_frac, pos.y_frac
                FROM fd_door_positions pos WHERE pos.door_id = $1 LIMIT 1
              `, [eq.external_id]);
              if (rows.length) {
                eq.position = rows[0];
              }
            } else if (eq.external_system === 'switchboard') {
              const { rows } = await pool.query(`
                SELECT pos.logical_name as plan_logical_name, pos.page_index, pos.x_frac, pos.y_frac
                FROM switchboard_positions pos WHERE pos.switchboard_id = $1 LIMIT 1
              `, [eq.external_id]);
              if (rows.length) {
                eq.position = rows[0];
              }
            } else if (eq.external_system === 'datahub') {
              const { rows } = await pool.query(`
                SELECT pos.logical_name as plan_logical_name, pos.page_index, pos.x_frac, pos.y_frac
                FROM dh_positions pos WHERE pos.item_id = $1 LIMIT 1
              `, [eq.external_id]);
              if (rows.length) {
                eq.position = rows[0];
              }
            }
          } catch (e) { /* ignore position fetch errors */ }
        }
      }
      return results;
    };

    await Promise.all([
      enrichWithPositions(resultsAL1),
      enrichWithPositions(resultsAL2)
    ]);


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
    const filter = getTenantFilter(tenant);
    const { building } = req.body;
    const { email } = getIdentityFromReq(req);

    // Get all zones using proper tenant filter
    let sql = `SELECT id FROM fc_zones WHERE ${filter.where}`;
    const params = [...filter.params];

    if (building) {
      params.push(building);
      sql += ` AND building = $${params.length}`;
    }

    const { rows: zones } = await pool.query(sql, params);
    console.log(`[FireControl] generate-checks: found ${zones.length} zones for campaign ${id}`);

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
    let tenant = extractTenantFromRequest(req);
    tenant = await enrichTenantWithSiteId(tenant, req, pool);
    console.log(`[FireControl] Matrix upload - tenant: companyId=${tenant.companyId}, siteId=${tenant.siteId}`);
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

// Delete a matrix
app.delete("/api/fire-control/matrices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);

    // Check if matrix exists (using same tenant filter as listing)
    const { rows } = await pool.query(
      `SELECT id, name, file_path FROM fc_matrices WHERE id = $1 AND ${filter.where}`,
      [id, ...filter.params]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Matrix not found" });
    }

    // Delete file if exists
    if (rows[0].file_path) {
      try { await fsp.unlink(rows[0].file_path); } catch {}
    }

    // Delete from database (cascades to fc_matrix_parse_jobs)
    await pool.query(`DELETE FROM fc_matrices WHERE id = $1`, [id]);

    await audit.log(req, AUDIT_ACTIONS.FILE_DELETED, { entityType: "matrix", entityId: id, name: rows[0].name });
    res.json({ success: true, message: "Matrix deleted" });
  } catch (err) {
    console.error("[FireControl] DELETE matrix error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Parse matrix and create zones + equipment
app.post("/api/fire-control/matrices/:id/parse", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
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
        // Get zone and equipment IDs by code (use tenant filter for proper NULL handling)
        const { rows: zoneRows } = await pool.query(`SELECT id FROM fc_zones WHERE code = $1 AND ${filter.where}`, [link.zone_code, ...filter.params]);
        const { rows: equipRows } = await pool.query(`SELECT id FROM fc_equipment WHERE code = $1 AND ${filter.where}`, [link.equipment_code, ...filter.params]);

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

// Get equipment from a matrix (for auto-matching)
app.get("/api/fire-control/matrices/:id/equipment", async (req, res) => {
  try {
    const { id } = req.params;
    let tenant = extractTenantFromRequest(req);
    tenant = await enrichTenantWithSiteId(tenant, req, pool);

    // Get equipment associated with this matrix
    const { rows: equipment } = await pool.query(`
      SELECT
        e.id, e.code, e.name, e.equipment_type, e.category, e.building, e.floor, e.location,
        e.external_system, e.external_id, e.fdcio_module, e.fdcio_output,
        ARRAY_AGG(DISTINCT ze.alarm_level) FILTER (WHERE ze.alarm_level IS NOT NULL) as alarm_levels,
        ARRAY_AGG(DISTINCT z.code) FILTER (WHERE z.code IS NOT NULL) as zone_codes
      FROM fc_equipment e
      LEFT JOIN fc_zone_equipment ze ON ze.equipment_id = e.id
      LEFT JOIN fc_zones z ON z.id = ze.zone_id
      WHERE e.matrix_id = $1 AND e.company_id = $2 AND e.site_id = $3
      GROUP BY e.id
      ORDER BY e.code
    `, [id, tenant.companyId, tenant.siteId]);

    res.json({ equipment });
  } catch (err) {
    console.error("[FireControl] Get matrix equipment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MATRIX PARSING - Siemens FC2060 Fire Control Matrix
// ============================================================================
// Structure of the matrix:
// - ZONES (columns at top): Detection lines with detector numbers
//   - Format: "Location accès N: detector_numbers"
//   - With "DM" = Manual trigger (déclencheur manuel)
//   - Without "DM" = Smoke detector (détecteur de fumée)
// - EQUIPMENT (rows): In the "Action" column (NOT "Type, emplacement de montage")
//   - Names like: "PCF B21.015", "HVAC tabl. 20-2-02-TC", "Coupure tableau Becomix"
// - LINKS: Black dots (■/l) in the matrix = zone triggers equipment
// ============================================================================

// Helper: Generate unique equipment code from action name
function generateEquipmentCode(equipment, index) {
  const name = (equipment.name || '').toUpperCase();

  // Try to extract existing code patterns from the action name
  const patterns = [
    /\b(PCF[- ]?B?\d+[.\d]*[- ]?[A-Z]*)/i,      // PCF B21.015, PCF Bât. 20
    /\b(HVAC[- ]?(?:tabl\.?)?[- ]?\d+[.\-\d]+[- ]?[A-Z]*)/i, // HVAC tabl. 20-2-02-TC
    /\b(Interlock[- ]?i\d+)/i,                   // Interlock i22
    /\b(Porte[- ]?(?:Interlock)?[- ]?i\d+)/i,   // Porte Interlock i21
    /\b(Rideau[- ]?coupe[- ]?feu[- ]?CW\d+)/i,  // Rideau coupe feu CW1
    /\b(Porte[- ]?coupe[- ]?feu[- ]?B\d+[.\d]+)/i, // Porte coupe feu B24.006
    /\b(Clapet[- ]?C\.?F\.?)/i,                  // Clapet C.F
    /\b(Feu[- ]?flash[- ]?\w+)/i,               // Feu flash Prangins
    /\b(Alarme[- ]?I+)/i,                        // Alarme I, Alarme II
    /\b(Monte[- ]?charge)/i,                     // Monte charge
    /\b(Ascenseur)/i,                            // Ascenseur
    /\b(Ventil[.\w]*[- ]?\d*[.\-\d]*)/i,        // Ventilation, Ventil. vest.
    /\b(Climatisation[- ]?\w*)/i,                // Climatisation
    /\b(Coupure[- ]?\w+)/i,                      // Coupure tableau
    /\b(Flux[- ]?lami[.\w]*)/i,                  // Flux laminaire
    /\b(Roll[- ]?up)/i,                          // Roll up
    /\b(Cde[- ]?[eé]vacuation)/i,               // Cde évacuation
    /\b(Commande[- ]?[EÉ]vacuation)/i,          // Commande Evacuation
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      return match[1].replace(/\s+/g, '-').replace(/[.]+/g, '.').toUpperCase();
    }
  }

  // Fallback: generate from type + index
  const type = (equipment.type || 'EQ').substring(0, 3).toUpperCase();
  return `${type}-${String(index + 1).padStart(3, '0')}`;
}

// Helper: Determine equipment type from action name
function determineEquipmentType(actionName) {
  const name = (actionName || '').toLowerCase();

  if (name.includes('pcf') || name.includes('p.c.f') || name.includes('porte coupe feu')) return 'pcf';
  if (name.includes('hvac') || name.includes('climatisation')) return 'hvac';
  if (name.includes('ventil')) return 'ventilation';
  if (name.includes('clapet')) return 'clapet';
  if (name.includes('ascenseur')) return 'ascenseur';
  if (name.includes('monte') && name.includes('charge')) return 'monte_charge';
  if (name.includes('alarme')) return 'alarme';
  if (name.includes('sirene') || name.includes('sirène')) return 'sirene';
  if (name.includes('flash') || name.includes('feu flash')) return 'flash';
  if (name.includes('evacuation') || name.includes('évacuation')) return 'evacuation';
  if (name.includes('interlock') || name.includes('porte interlock')) return 'interlock';
  if (name.includes('roll') && name.includes('up')) return 'roll_up';
  if (name.includes('rideau')) return 'rideau_cf';
  if (name.includes('flux') || name.includes('lami')) return 'flux_laminaire';
  if (name.includes('coupure')) return 'coupure';
  if (name.includes('contrôle') && name.includes('accès')) return 'controle_acces';

  return 'autre';
}

// Helper: Extract building from name
function extractBuilding(text) {
  const match = (text || '').match(/b[âa]t\.?\s*(\d+)|B(\d+)\.|bâtiment\s*(\d+)/i);
  if (match) return `B${match[1] || match[2] || match[3]}`;
  return '';
}

// Helper: Parse zones from matrix text
// Zones are the detection lines at the top of the matrix
function parseZonesFromText(text) {
  const zones = [];
  const seen = new Set();

  // Pattern for zones: "Location accès N: detector_numbers" or similar
  // Also match: "Rez de chaussée: 24001-24017", "1er étage: 22100-22108"
  const zonePatterns = [
    /([^:\n]{3,50}?(?:accès|acces)\s*\d+[^:]{0,30}?):\s*([\d\-,]+)/gi,
    /([^:\n]{3,30}?(?:étage|etage)[^:]{0,20}?):\s*([\d\-,]+)/gi,
    /(Rez[- ]?de[- ]?chauss[ée]e[^:]{0,30}?):\s*([\d\-,]+)/gi,
    /(Sous-sol[^:]{0,30}?):\s*([\d\-,]+)/gi,
    /(Toiture[^:]{0,30}?):\s*([\d\-,]+)/gi,
    /(Attique[^:]{0,30}?):\s*([\d\-,]+)/gi,
    /(Escalier[^:]{0,30}?):\s*([\d\-,]+)/gi,
    /(S-sol[^:]{0,30}?):\s*([\d\-,]+)/gi,
    /(\d+(?:er|ème|e)\s*(?:étage)?[^:]{0,30}?):\s*([\d\-,]+)/gi,
  ];

  for (const pattern of zonePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      const detectors = match[2].trim();

      // Skip if already seen (dedup)
      const key = `${name.toLowerCase()}:${detectors}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip evacuation lines (not real zones)
      if (name.toLowerCase().includes('evacuation')) continue;

      // Determine if this is a manual trigger (DM) or smoke detector
      const isDM = /,?\s*DM\s*$/i.test(name) || name.includes('DM:');
      const isFxPlafond = name.toLowerCase().includes('fx-plafond') || name.toLowerCase().includes('faux plafond');

      // Extract access number for code
      const accessMatch = name.match(/acc[eè]s\s*(\d+)/i);
      const accessNum = accessMatch ? accessMatch[1].padStart(2, '0') : '';

      // Determine building/floor from name
      const nameLower = name.toLowerCase();
      let floor = '';
      if (nameLower.includes('sous-sol') || nameLower.includes('s-sol')) floor = 'Sous-sol';
      else if (nameLower.includes('rez')) floor = 'Rez';
      else if (nameLower.includes('1er') || nameLower.includes('1 er')) floor = '1er étage';
      else if (nameLower.includes('2') && nameLower.includes('me')) floor = '2ème étage';
      else if (nameLower.includes('toiture') || nameLower.includes('attique')) floor = 'Toiture';
      else if (nameLower.includes('mezzanine')) floor = 'Mezzanine';

      const building = extractBuilding(name);

      // Generate zone code
      let code;
      if (accessNum) {
        code = `Z${accessNum}${isDM ? '-DM' : ''}${isFxPlafond ? '-FX' : ''}`;
      } else {
        code = `Z${String(zones.length + 1).padStart(3, '0')}${isDM ? '-DM' : ''}`;
      }

      zones.push({
        code,
        name: name.replace(/,?\s*DM\s*$/i, '').trim(), // Clean up name
        detector_numbers: detectors,
        building,
        floor,
        detector_type: isDM ? 'manual' : (isFxPlafond ? 'fx-plafond' : 'smoke'),
        is_manual_trigger: isDM,
      });
    }
  }

  return zones;
}

// Helper: Parse equipment from the "Action" column of the matrix
// These are the commands/equipment that get activated when a zone triggers
function parseEquipmentFromText(text) {
  const equipment = [];
  const seen = new Set();

  // Equipment patterns - these are the ACTION names (what gets activated)
  // NOT the FDCIO module locations
  const equipmentPatterns = [
    // PCF - Portes Coupe Feu
    /\b(PCF\s+[A-Za-z0-9.\-\s]+?)(?:\s*$|\s+\d|\s+\()/gim,
    /\b(P\.C\.F\.?\s+[A-Za-z0-9.\-\s]+?)(?:\s*$|\s+\d|\s+\()/gim,
    /\b(Porte\s+coupe\s+feu\s+B\d+[.\d]+[.\d]*)/gi,

    // HVAC / Ventilation / Climatisation - include accented chars
    /\b(HVAC\s+(?:tabl\.?\s*)?[\d.\-]+[A-Z\-]*)/gi,
    /\b(Climatisation\s+[\wÀ-ÿ.\-\s]+?)(?:\s*$|\s*\()/gim,
    /\b(Air\s+neuf\s+[\wÀ-ÿ.\-\s]+)/gi,

    // Interlock / Portes
    /\b(Interlock\s+i\d+\s*[A-Za-z0-9.\-\s]*)/gi,
    /\b(Porte\s+Interlock\s+i\d+\s*[A-Za-z0-9.\-]*)/gi,
    /\b(Porte\s+coulissante\s+B\d+[.\d]+)/gi,

    // Rideau coupe feu / Roll up
    /\b(Rideau\s+coupe\s+feu\s+CW\d+\s*[A-Za-z0-9.\-]*)/gi,
    /\b(Roll\s+up\s+B\d+[.\s\d\/]+)/gi,

    // Ascenseur / Monte-charge - include accented chars for "bâtiment"
    /\b(Ascenseur\s+[\wÀ-ÿ\s\d]+)/gi,
    /\b(Monte[\s-]?charge\s*[\wÀ-ÿ\s\d.]*)/gi,

    // Alarmes
    /\b(Alarme\s+I+,?\s*[\wÀ-ÿ\s]+?)(?:\s*\(|\s*$)/gim,

    // Evacuation - include accented chars for "bâtiment", "évacuation"
    /\b(Cde\s+[eé]vacuation\s+[\wÀ-ÿ\s\d]+?)(?:\s*\(|\s*$)/gim,
    /\b(Commande\s+[EÉeé]vacuation\s+[\wÀ-ÿ\s\d]+)/gi,
    /\b(Arr[êe]t\s+[eé]vacuation\s+[\wÀ-ÿ\s\d]+)/gi,

    // Feu flash / Signalisation
    /\b(Feu\s+flash\s+[\wÀ-ÿ\s]+?)(?:\s*\(|\s*$)/gim,

    // Coupure / Autres
    /\b(Coupure\s+tableau\s+[\wÀ-ÿ\s\d]+)/gi,
    /\b(Clapet\s+C\.?F\.?\s*[\wÀ-ÿ\s]*)/gi,
    /\b(Flux\s+lami[.\w]*\s*[\wÀ-ÿ.\-\s]*)/gi,

    // Contrôle d'accès
    /\b(Contr[oô]le\s+d['']acc[eè]s\s+[\wÀ-ÿ.\s\d]+)/gi,
    /\b(Cellule\s+compensatrice\s+\d+)/gi,

    // Sas
    /\b(Sas\s+[\wÀ-ÿ\s\d]+)/gi,

    // Ventilation - more complete capture
    /\b(Ventil[.\w]*\s+[\wÀ-ÿ.\-\s\d]+?)(?:\s*\(|\s*$)/gim,
    /\b(Ventilation\s+[\wÀ-ÿ.\-\s\d]+?)(?:\s*\(|\s*$)/gim,
  ];

  for (const pattern of equipmentPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let name = match[1].trim();

      // Clean up the name
      name = name.replace(/\s+/g, ' ').trim();
      name = name.replace(/\s*\(Nr\.\d+\)\s*$/, ''); // Remove (Nr.01) suffixes
      name = name.replace(/\s*\(\d+\)\s*$/, ''); // Remove (1) suffixes

      // Skip if too short or already seen
      if (name.length < 5) continue;
      const key = name.toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip FDCIO lines (these are locations, not equipment names)
      if (name.includes('FDCIO') || name.includes('DC1154')) continue;

      // Skip reserve entries
      if (name.toLowerCase().includes('reserve') || name.toLowerCase().includes('réserve')) continue;

      const type = determineEquipmentType(name);
      const building = extractBuilding(name);

      const eq = {
        name,
        type,
        building,
        floor: '',
        location: '', // We don't use FDCIO location anymore
      };

      eq.code = generateEquipmentCode(eq, equipment.length);
      equipment.push(eq);
    }
  }

  return equipment;
}

// Helper: Determine alarm level from context in the matrix line
// In the matrix, "Alarme locale (Alarme I)" = level 1, "Alarme globale (Alarme II)" = level 2
function determineAlarmLevel(lineText) {
  // Default to level 1 (Alarme I / locale)
  // The matrix has columns for Alarme I and Alarme II
  // When there's a "l" in the Alarme II column, it's level 2

  // Check if this line has indicators for alarm level
  const lowerText = lineText.toLowerCase();

  // If the line explicitly mentions Alarme II or global
  if (lowerText.includes('alarme ii') || lowerText.includes('alarme globale') ||
      lowerText.includes('(nr.02)') || lowerText.includes('niveau 2')) {
    return 2;
  }

  // Check for "l l" pattern which often indicates both alarm levels
  // Or check position indicators

  // Default to level 1
  return 1;
}

// Helper: Parse links between zones and equipment from the matrix
// The "l" characters in the matrix indicate which zones trigger which equipment
function parseLinksFromAI(aiLinks, zones, equipment) {
  const links = [];
  const zoneMap = new Map(zones.map(z => [z.code.toLowerCase(), z]));
  const equipMap = new Map(equipment.map(e => [e.code.toLowerCase(), e]));

  for (const link of aiLinks) {
    const zoneCode = (link.zone_code || '').toLowerCase();
    const equipCode = (link.equipment_code || '').toLowerCase();

    if (zoneMap.has(zoneCode) && equipMap.has(equipCode)) {
      links.push({
        zone_code: zoneMap.get(zoneCode).code,
        equipment_code: equipMap.get(equipCode).code,
        alarm_level: link.alarm_level || 1,
      });
    }
  }

  return links;
}

// Background worker for matrix parsing
async function processMatrixParse(jobId, matrixId, tenant, userEmail) {
  const job = matrixParseJobs.get(jobId);
  if (!job) return;

  if (job.status === 'completed' || job.status === 'failed') {
    console.log(`[FireControl] Job ${jobId}: Already ${job.status}, skipping`);
    return;
  }

  // Use paramOffset: 1 because queries use $1 for code/other params
  const filter = getTenantFilter(tenant, { paramOffset: 1 });

  const saveProgress = async () => {
    try { await saveMatrixParseJob(job); } catch (e) { console.warn(`[FireControl] Save job error: ${e.message}`); }
  };

  try {
    job.status = 'analyzing';
    job.progress = 5;
    job.message = 'Lecture du PDF...';
    await saveProgress();

    // Get matrix
    const { rows: matrixRows } = await pool.query(
      `SELECT file_path, content, name FROM fc_matrices WHERE id = $1`,
      [matrixId]
    );

    if (!matrixRows.length) {
      throw new Error("Matrix not found");
    }

    const matrix = matrixRows[0];
    let pdfBuffer;

    if (matrix.content) {
      pdfBuffer = Buffer.isBuffer(matrix.content) ? matrix.content : Buffer.from(matrix.content);
    } else if (matrix.file_path) {
      pdfBuffer = await fsp.readFile(matrix.file_path);
    } else {
      throw new Error("No PDF content available");
    }

    job.progress = 10;
    job.message = 'Extraction du texte...';
    await saveProgress();

    // Extract text from ALL pages (pdfjs-dist requires Uint8Array, not Buffer)
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
    const numPages = pdfDoc.numPages;
    console.log(`[FireControl] Job ${jobId}: PDF has ${numPages} pages`);

    // Store text per page for better processing
    const pageTexts = [];
    let fullText = "";

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        pageTexts.push({ pageNum, text: pageText });
        fullText += `\n--- Page ${pageNum} ---\n${pageText}`;
      } catch (e) {
        console.warn(`[FireControl] Job ${jobId}: Page ${pageNum} error: ${e.message}`);
        pageTexts.push({ pageNum, text: "" });
      }
      job.progress = 10 + Math.round((pageNum / numPages) * 15);
      await saveProgress();
    }

    if (fullText.trim().length < 50) {
      throw new Error("Le PDF ne contient pas de texte extractible (image scannée?)");
    }

    console.log(`[FireControl] Job ${jobId}: Extracted ${fullText.length} chars from ${numPages} pages`);

    job.progress = 30;
    job.message = 'Extraction des zones et équipements...';
    await saveProgress();

    // === NEW: Hybrid approach - local parsing + AI for verification ===
    // Step 1: Extract zones and equipment locally using regex patterns
    const localZones = parseZonesFromText(fullText);
    const localEquipment = parseEquipmentFromText(fullText);

    console.log(`[FireControl] Job ${jobId}: Local parsing found ${localZones.length} zones, ${localEquipment.length} equipment`);

    job.progress = 45;
    job.message = 'Analyse IA pour enrichissement...';
    await saveProgress();

    // Step 2: Use AI to enhance/verify data if OpenAI is available
    let allZones = localZones;
    let allEquipment = localEquipment;
    let allLinks = [];

    if (openai && fullText.length > 100) {
      try {
        // Process PDF in chunks if needed (for very long PDFs)
        const chunkSize = 28000; // Slightly under 30K to leave room for prompt
        const textChunks = [];

        for (let i = 0; i < fullText.length; i += chunkSize) {
          textChunks.push(fullText.substring(i, Math.min(i + chunkSize, fullText.length)));
        }

        console.log(`[FireControl] Job ${jobId}: Processing ${textChunks.length} chunk(s) with AI`);

        // Process each chunk and merge results
        const aiZones = [];
        const aiEquipment = [];
        const aiLinks = [];

        for (let chunkIdx = 0; chunkIdx < textChunks.length; chunkIdx++) {
          const chunk = textChunks[chunkIdx];
          job.progress = 45 + Math.round((chunkIdx / textChunks.length) * 20);
          job.message = `Analyse IA ${chunkIdx + 1}/${textChunks.length}...`;
          await saveProgress();

          const aiResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: `Tu es un expert en systèmes de sécurité incendie Siemens FC2060.
Extrais les données d'une matrice d'asservissement incendie. Retourne UNIQUEMENT du JSON valide:

{
  "zones": [
    {"code": "Z00", "name": "Sous-sol accès 0", "detector_numbers": "20900-20905,20908-20912", "building": "", "floor": "Sous-sol", "is_manual_trigger": false}
  ],
  "equipment": [
    {"code": "HVAC-20-2-02-TC", "name": "HVAC tabl. 20-2-02-TC", "type": "hvac", "building": "B20"}
  ],
  "links": [
    {"zone_code": "Z00", "equipment_code": "HVAC-20-2-02-TC", "alarm_level": 1}
  ]
}

=== STRUCTURE DE LA MATRICE ===

ZONES (EN HAUT, colonnes verticales):
- Format: "Location accès N: numéros_détecteurs"
- Exemples: "Sous-sol accès 0: 20900-20905", "1er étage accès 52: 20471-20492"
- Avec "DM" = Déclencheur Manuel (is_manual_trigger: true)
- Sans "DM" = Détecteur de fumée (is_manual_trigger: false)
- Code zone = Z + numéro accès (ex: accès 0 -> Z00, accès 52 -> Z52)

ÉQUIPEMENTS (colonne "Action" à droite - PAS la colonne "Type, emplacement de montage"):
- Ce sont les COMMANDES/ACTIONS, pas les modules FDCIO!
- Exemples: "PCF B21.015 JURA", "HVAC tabl. 20-2-02-TC", "Coupure tableau Becomix"
- IGNORE la colonne "FDCIO222, Local électrique..." (c'est juste l'emplacement)

NIVEAUX D'ALARME (colonnes "Évènement"):
- "Alarme locale (Alarme I)" = alarm_level: 1
- "Alarme globale (Alarme II)" = alarm_level: 2
- Les "l" dans ces colonnes indiquent quel niveau déclenche l'équipement

LIENS (TRÈS IMPORTANT - EXTRAIS TOUS LES LIENS!):
- La matrice est un tableau où les ZONES sont en colonnes et les ÉQUIPEMENTS en lignes
- Les points noirs "●", "l", "■", "X" dans les cellules = liens zone→équipement
- Pour CHAQUE équipement, regarde CHAQUE colonne de zone
- Si une cellule est marquée (non vide) sous une zone pour un équipement = créer un lien
- Créer un lien POUR CHAQUE intersection marquée dans la matrice
- Un équipement peut être lié à PLUSIEURS zones (souvent 5-20 zones par équipement)
- Les liens sous "Alarme I" = alarm_level: 1
- Les liens sous "Alarme II" = alarm_level: 2

=== TYPES ÉQUIPEMENT ===
pcf, hvac, ventilation, clapet, ascenseur, monte_charge, alarme, flash, evacuation, interlock, roll_up, rideau_cf, coupure, controle_acces, autre

=== CODES ÉQUIPEMENT ===
Extrais le code technique du nom: "PCF-B21.015", "HVAC-20-2-02-TC", "INTERLOCK-I22", "PORTE-INTERLOCK-I21"

IMPORTANT - LIENS:
- Il y a généralement BEAUCOUP de liens dans une matrice (centaines voire milliers)
- Pour chaque ligne équipement, regarde TOUTES les colonnes zones pour trouver les marqueurs
- Créer un objet link pour CHAQUE intersection marquée, même si cela fait beaucoup de liens
- NE PAS résumer ou regrouper les liens - liste chaque lien individuellement
- Utilise EXACTEMENT les mêmes codes zone_code et equipment_code que tu as définis plus haut

IMPORTANT - GÉNÉRAL:
- Extrais les équipements de la colonne "Action" (Commande), PAS de "Type, emplacement"
- Distingue les zones DM (déclencheur manuel) des détecteurs de fumée
- alarm_level = 1 pour Alarme I (locale), 2 pour Alarme II (globale)`
              },
              {
                role: "user",
                content: `Extrait les zones, équipements et liens de cette partie de la matrice (partie ${chunkIdx + 1}/${textChunks.length}):\n\n${chunk}`
              }
            ],
            max_tokens: 16384,
            temperature: 0.1
          });

          const content = aiResponse.choices[0]?.message?.content || "";
          console.log(`[FireControl] Job ${jobId}: AI chunk ${chunkIdx + 1} response length: ${content.length}`);

          try {
            let jsonStr = content;
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) jsonStr = jsonMatch[1].trim();

            // Try to fix common JSON issues
            jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

            const parsed = JSON.parse(jsonStr);
            if (parsed.zones) aiZones.push(...parsed.zones);
            if (parsed.equipment) aiEquipment.push(...parsed.equipment);
            if (parsed.links) aiLinks.push(...parsed.links);
          } catch (parseErr) {
            console.warn(`[FireControl] Job ${jobId}: AI chunk ${chunkIdx + 1} parse error: ${parseErr.message}`);
          }
        }

        // Merge AI results with local parsing (prefer AI if available, dedupe)
        if (aiZones.length > 0 || aiEquipment.length > 0) {
          // Deduplicate zones by code
          const zoneMap = new Map();
          for (const z of localZones) zoneMap.set(z.code, z);
          for (const z of aiZones) {
            if (!zoneMap.has(z.code) || (z.name && z.detector_numbers)) {
              zoneMap.set(z.code, z);
            }
          }
          allZones = Array.from(zoneMap.values());

          // Deduplicate equipment by code or fdcio+output
          const eqMap = new Map();
          for (const e of localEquipment) {
            const key = e.code || `${e.fdcio_module}-${e.fdcio_output}`;
            eqMap.set(key, e);
          }
          for (const e of aiEquipment) {
            const key = e.code || `${e.fdcio_module}-${e.fdcio_output}`;
            if (!eqMap.has(key) || (e.name && e.type !== 'autre')) {
              eqMap.set(key, e);
            }
          }
          allEquipment = Array.from(eqMap.values());

          allLinks = aiLinks;
        }

        console.log(`[FireControl] Job ${jobId}: After AI merge: ${allZones.length} zones, ${allEquipment.length} equipment, ${allLinks.length} links`);

      } catch (aiErr) {
        console.warn(`[FireControl] Job ${jobId}: AI enrichment failed, using local parsing: ${aiErr.message}`);
        // Fall back to local parsing results
      }
    }

    job.progress = 70;
    job.message = 'Traitement des résultats...';
    await saveProgress();

    console.log(`[FireControl] Job ${jobId}: Final count - ${allZones.length} zones, ${allEquipment.length} equipment, ${allLinks.length} links`);

    job.progress = 80;
    job.message = 'Enregistrement en base...';
    await saveProgress();

    // Save to database
    let zonesCreated = 0, equipmentCreated = 0, linksCreated = 0;

    // Track code -> ID mappings for link creation
    const zoneCodeToId = new Map();
    const equipCodeToId = new Map();

    for (const z of allZones) {
      try {
        const result = await pool.query(`
          INSERT INTO fc_zones (code, name, description, building, floor, detector_numbers, detector_type, matrix_id, company_id, site_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (code, company_id, site_id) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), fc_zones.name),
            detector_numbers = COALESCE(NULLIF(EXCLUDED.detector_numbers, ''), fc_zones.detector_numbers),
            building = COALESCE(NULLIF(EXCLUDED.building, ''), fc_zones.building),
            floor = COALESCE(NULLIF(EXCLUDED.floor, ''), fc_zones.floor),
            matrix_id = EXCLUDED.matrix_id,
            updated_at = now()
          RETURNING id
        `, [z.code, z.name, z.description || '', z.building || '', z.floor || '', z.detector_numbers || '', z.detector_type || 'smoke', matrixId, tenant.companyId, tenant.siteId]);
        if (result.rows.length) {
          zoneCodeToId.set(z.code, result.rows[0].id);
          // Also map normalized versions (Z00 -> Z0, Z01 -> Z1, etc.)
          const normalized = z.code.replace(/^Z0+(\d)$/, 'Z$1');
          zoneCodeToId.set(normalized, result.rows[0].id);
        }
        zonesCreated++;
      } catch (e) { console.warn(`[FireControl] Zone error: ${e.message}`); }
    }

    for (const e of allEquipment) {
      try {
        // Ensure we have a valid code
        const code = e.code || generateEquipmentCode(e, equipmentCreated);
        const result = await pool.query(`
          INSERT INTO fc_equipment (code, name, equipment_type, building, floor, location, fdcio_module, fdcio_output, matrix_id, company_id, site_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (code, company_id, site_id) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), fc_equipment.name),
            equipment_type = CASE WHEN EXCLUDED.equipment_type != 'autre' THEN EXCLUDED.equipment_type ELSE fc_equipment.equipment_type END,
            building = COALESCE(NULLIF(EXCLUDED.building, ''), fc_equipment.building),
            location = COALESCE(NULLIF(EXCLUDED.location, ''), fc_equipment.location),
            fdcio_module = COALESCE(NULLIF(EXCLUDED.fdcio_module, ''), fc_equipment.fdcio_module),
            fdcio_output = COALESCE(NULLIF(EXCLUDED.fdcio_output, ''), fc_equipment.fdcio_output),
            matrix_id = EXCLUDED.matrix_id,
            updated_at = now()
          RETURNING id
        `, [code, e.name || '', e.type || 'autre', e.building || '', e.floor || '', e.location || '', e.fdcio_module || '', e.fdcio_output || '', matrixId, tenant.companyId, tenant.siteId]);
        if (result.rows.length) {
          equipCodeToId.set(code, result.rows[0].id);
          // Also map original AI code if different
          if (e.code && e.code !== code) {
            equipCodeToId.set(e.code, result.rows[0].id);
          }
          // Map normalized version (remove spaces/dashes)
          const normalized = code.replace(/[\s\-]+/g, '').toUpperCase();
          equipCodeToId.set(normalized, result.rows[0].id);
        }
        equipmentCreated++;
      } catch (err) { console.warn(`[FireControl] Equipment error: ${err.message}`); }
    }

    console.log(`[FireControl] Job ${jobId}: Zone map size: ${zoneCodeToId.size}, Equipment map size: ${equipCodeToId.size}, Links to process: ${allLinks.length}`);

    for (const link of allLinks) {
      try {
        // Try direct lookup from maps first
        let zoneId = zoneCodeToId.get(link.zone_code);
        let equipId = equipCodeToId.get(link.equipment_code);

        // Try normalized versions if direct lookup failed
        if (!zoneId) {
          const normalizedZone = link.zone_code.replace(/^Z0+(\d)$/, 'Z$1');
          zoneId = zoneCodeToId.get(normalizedZone);
        }
        if (!equipId) {
          const normalizedEquip = (link.equipment_code || '').replace(/[\s\-]+/g, '').toUpperCase();
          equipId = equipCodeToId.get(normalizedEquip);
        }

        // Fallback to database lookup if maps don't have it
        if (!zoneId) {
          const { rows: zoneRows } = await pool.query(`SELECT id FROM fc_zones WHERE code = $1 AND ${filter.where}`, [link.zone_code, ...filter.params]);
          if (zoneRows.length) zoneId = zoneRows[0].id;
        }
        if (!equipId) {
          const { rows: equipRows } = await pool.query(`SELECT id FROM fc_equipment WHERE code = $1 AND ${filter.where}`, [link.equipment_code, ...filter.params]);
          if (equipRows.length) equipId = equipRows[0].id;
        }

        if (zoneId && equipId) {
          await pool.query(`INSERT INTO fc_zone_equipment (zone_id, equipment_id, alarm_level, action_type, matrix_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [zoneId, equipId, link.alarm_level || 1, link.action || 'activate', matrixId]);
          linksCreated++;
        } else {
          console.log(`[FireControl] Job ${jobId}: Link skipped - zone=${link.zone_code} (${zoneId ? 'found' : 'NOT FOUND'}), equip=${link.equipment_code} (${equipId ? 'found' : 'NOT FOUND'})`);
        }
      } catch (err) { console.warn(`[FireControl] Link error: ${err.message}`); }
    }

    // Store parsed data
    await pool.query(`UPDATE fc_matrices SET parsed_data = $1 WHERE id = $2`,
      [JSON.stringify({
        zones: allZones,
        equipment: allEquipment,
        links: allLinks,
        parsed_at: new Date().toISOString(),
        stats: { pages: numPages, total_chars: fullText.length }
      }), matrixId]);

    job.status = 'completed';
    job.progress = 100;
    job.message = 'Analyse terminée';
    job.completed_at = Date.now();
    job.result = { zones_created: zonesCreated, equipment_created: equipmentCreated, links_created: linksCreated };
    await saveProgress();

    console.log(`[FireControl] Job ${jobId}: Completed - ${zonesCreated} zones, ${equipmentCreated} equipment, ${linksCreated} links`);

    // Send push notification
    try {
      await notify({
        tag: `matrix-parse-${jobId}`,
        title: '✅ Analyse matrice terminée',
        body: `${zonesCreated} zones, ${equipmentCreated} équipements extraits de "${matrix.name}"`,
        data: { type: 'matrix_parse_complete', job_id: jobId, matrix_id: matrixId },
        userEmail: userEmail
      });
    } catch (notifErr) {
      console.warn(`[FireControl] Notification error: ${notifErr.message}`);
    }

  } catch (err) {
    console.error(`[FireControl] Job ${jobId} failed:`, err.message);
    job.status = 'failed';
    job.error = err.message;
    job.completed_at = Date.now();
    await saveProgress();

    try {
      await notify({
        tag: `matrix-parse-${jobId}`,
        title: '❌ Analyse matrice échouée',
        body: err.message.substring(0, 100),
        data: { type: 'matrix_parse_failed', job_id: jobId },
        userEmail: userEmail
      });
    } catch (e) {}
  }
}

// Start AI matrix parsing (background job)
app.post("/api/fire-control/matrices/:id/ai-parse", async (req, res) => {
  const startTime = Date.now();
  console.log(`[FireControl] AI parse request received at ${new Date().toISOString()}`);

  try {
    const { id } = req.params;
    let tenant = extractTenantFromRequest(req);
    // Enrich tenant with site_id/company_id from database if needed
    tenant = await enrichTenantWithSiteId(tenant, req, pool);
    const userEmail = req.headers['x-user-email'] || tenant.email || 'unknown';
    console.log(`[FireControl] AI parse - tenant extracted: ${Date.now() - startTime}ms, companyId=${tenant.companyId}, siteId=${tenant.siteId}`);

    // Check if OpenAI is available
    if (!openai) {
      console.log(`[FireControl] AI parse - OpenAI not available, returning 503`);
      return res.status(503).json({ error: "Service IA non disponible. Vérifiez la configuration OPENAI_API_KEY." });
    }
    console.log(`[FireControl] AI parse - OpenAI check passed: ${Date.now() - startTime}ms`);

    // Check if matrix exists (using same tenant filter as listing)
    const filter = getTenantFilter(tenant, { paramOffset: 1 }); // offset because $1 is used for matrix id
    console.log(`[FireControl] AI parse - checking matrix exists...`);
    const { rows } = await pool.query(
      `SELECT id, name FROM fc_matrices WHERE id = $1 AND ${filter.where}`,
      [id, ...filter.params]
    );
    console.log(`[FireControl] AI parse - matrix query done: ${Date.now() - startTime}ms, found: ${rows.length}`);

    if (!rows.length) {
      console.log(`[FireControl] AI parse - matrix not found, returning 404`);
      return res.status(404).json({ error: "Matrix not found" });
    }

    // Check for existing active job
    for (const [existingJobId, existingJob] of matrixParseJobs) {
      if (existingJob.matrix_id === id && (existingJob.status === 'pending' || existingJob.status === 'analyzing')) {
        console.log(`[FireControl] AI parse - reusing existing job ${existingJobId}: ${Date.now() - startTime}ms`);
        return res.json({
          job_id: existingJobId,
          status: existingJob.status,
          progress: existingJob.progress,
          message: existingJob.message,
          poll_url: `/api/fire-control/matrix-parse-job/${existingJobId}`,
          reused: true
        });
      }
    }

    // Create job
    const jobId = `mp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job = {
      id: jobId,
      matrix_id: id,
      site: req.headers['x-site'] || 'default',
      user_email: userEmail,
      status: 'pending',
      progress: 0,
      message: 'En file d\'attente...',
      created_at: Date.now(),
      company_id: tenant.companyId,
      site_id: tenant.siteId
    };
    matrixParseJobs.set(jobId, job);
    console.log(`[FireControl] AI parse - job created in memory: ${Date.now() - startTime}ms`);

    // Save to DB (non-blocking - don't await)
    saveMatrixParseJob(job).catch(e => console.warn(`[FireControl] Failed to save initial job: ${e.message}`));
    console.log(`[FireControl] AI parse - job save initiated (non-blocking): ${Date.now() - startTime}ms`);

    // Return immediately BEFORE any heavy processing
    console.log(`[FireControl] AI parse - sending response NOW: ${Date.now() - startTime}ms`);
    res.json({
      job_id: jobId,
      status: 'pending',
      message: 'Analyse démarrée en arrière-plan',
      poll_url: `/api/fire-control/matrix-parse-job/${jobId}`
    });
    console.log(`[FireControl] AI parse - response sent: ${Date.now() - startTime}ms`);

    // Start background processing AFTER response is sent
    setImmediate(async () => {
      console.log(`[FireControl] AI parse - starting background processing for ${jobId}`);
      try {
        await processMatrixParse(jobId, id, tenant, userEmail);
      } catch (bgError) {
        console.error(`[FireControl] Background error for ${jobId}:`, bgError.message);
        const failedJob = matrixParseJobs.get(jobId);
        if (failedJob) {
          failedJob.status = 'failed';
          failedJob.error = bgError.message;
          failedJob.completed_at = Date.now();
          await saveMatrixParseJob(failedJob);
        }
      }
    });

  } catch (err) {
    console.error("[FireControl] AI parse start error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get matrix parse job status
app.get("/api/fire-control/matrix-parse-job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await getMatrixParseJob(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      result: job.result,
      error: job.error,
      created_at: job.created_at,
      completed_at: job.completed_at
    });
  } catch (err) {
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

    // 2. Fetch switchboards with fire_interlock=true
    try {
      const switchQuery = await pool.query(`
        SELECT
          s.id, s.code, s.name, s.building_code as building, s.floor, s.room as location,
          s.fire_interlock_zone_id, s.fire_interlock_alarm_level, s.fire_interlock_code,
          'switchboard' as source_system, 'interlock' as equipment_type,
          pos.id as position_id, pos.logical_name as plan_logical_name, pos.page_index, pos.x_frac, pos.y_frac
        FROM switchboards s
        LEFT JOIN switchboard_positions pos ON pos.switchboard_id = s.id
        WHERE s.fire_interlock = true
          ${plan_logical_name ? `AND pos.logical_name = $1 AND pos.page_index = $2` : ''}
      `, plan_logical_name ? [plan_logical_name, Number(page_index)] : []);

      for (const sw of switchQuery.rows) {
        allEquipment.push({
          id: sw.id,
          code: sw.fire_interlock_code || sw.code || sw.name,
          name: sw.name,
          building: sw.building,
          floor: sw.floor,
          location: sw.location,
          equipment_type: sw.equipment_type,
          source_system: sw.source_system,
          zone_id: sw.fire_interlock_zone_id,
          alarm_level: sw.fire_interlock_alarm_level || 1,
          position_id: sw.position_id,
          plan_logical_name: sw.plan_logical_name,
          page_index: sw.page_index,
          x_frac: sw.x_frac,
          y_frac: sw.y_frac,
          check_status: null,
        });
      }
    } catch (e) { console.warn("[FireControl] Switchboard query failed:", e.message); }

    // 3. Fetch datahub items with fire_interlock=true
    try {
      const datahubQuery = await pool.query(`
        SELECT
          i.id, i.code, i.name, i.building, i.floor, i.location,
          i.fire_interlock_zone_id, i.fire_interlock_alarm_level, i.fire_interlock_code,
          c.name as category_name, c.color as category_color, c.icon as category_icon,
          'datahub' as source_system,
          pos.id as position_id, pos.logical_name as plan_logical_name, pos.page_index, pos.x_frac, pos.y_frac
        FROM dh_items i
        LEFT JOIN dh_categories c ON c.id = i.category_id
        LEFT JOIN dh_positions pos ON pos.item_id = i.id
        WHERE i.fire_interlock = true
          ${plan_logical_name ? `AND pos.logical_name = $1 AND pos.page_index = $2` : ''}
      `, plan_logical_name ? [plan_logical_name, Number(page_index)] : []);

      for (const dh of datahubQuery.rows) {
        allEquipment.push({
          id: dh.id,
          code: dh.fire_interlock_code || dh.code || dh.name,
          name: dh.name,
          building: dh.building,
          floor: dh.floor,
          location: dh.location,
          equipment_type: dh.category_name || 'datahub',
          category_color: dh.category_color,
          category_icon: dh.category_icon,
          source_system: dh.source_system,
          zone_id: dh.fire_interlock_zone_id,
          alarm_level: dh.fire_interlock_alarm_level || 1,
          position_id: dh.position_id,
          plan_logical_name: dh.plan_logical_name,
          page_index: dh.page_index,
          x_frac: dh.x_frac,
          y_frac: dh.y_frac,
          check_status: null,
        });
      }
    } catch (e) { console.warn("[FireControl] Datahub query failed:", e.message); }

    // 4. If zone_check_id provided, fetch equipment results to get check status
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

    res.json({
      equipment: allEquipment,
      sources: ['doors', 'switchboard', 'datahub'],
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
// ROUTES: Intelligent Equipment Auto-Matching
// ------------------------------

// Calculate similarity score between two strings (Levenshtein-based)
function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  s1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  s2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  // Simple Levenshtein
  const len1 = s1.length, len2 = s2.length;
  const matrix = [];
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i-1] === s2[j-1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i-1][j] + 1, matrix[i][j-1] + 1, matrix[i-1][j-1] + cost);
    }
  }
  const maxLen = Math.max(len1, len2);
  return 1 - (matrix[len1][len2] / maxLen);
}

// Extract key identifiers from equipment name/code for matching
function extractEquipmentIdentifiers(text) {
  if (!text) return { patterns: [], building: null, room: null };

  const upper = text.toUpperCase();
  const patterns = [];

  // Extract building reference (B20, B21, Bâtiment 20, etc.)
  const buildingMatch = upper.match(/B[ÂAÂA]?T?\.?\s*(\d+)|B(\d+)\./i);
  const building = buildingMatch ? `B${buildingMatch[1] || buildingMatch[2]}` : null;

  // Extract room/location codes (B21.015, 21.915, etc.)
  const roomMatches = upper.match(/\b(\d{2})[.-](\d{3})\b/g) || [];
  for (const rm of roomMatches) {
    patterns.push(rm.replace(/[.-]/g, '.'));
  }

  // Extract PCF codes
  const pcfMatch = upper.match(/PCF[- ]?([A-Z]?\d+[.\-]?\d*)/i);
  if (pcfMatch) patterns.push(`PCF-${pcfMatch[1].replace(/[.\-\s]/g, '')}`);

  // Extract interlock codes (i22, I17, etc.)
  const interlockMatch = upper.match(/(?:INTERLOCK\s*)?I(\d+)/i);
  if (interlockMatch) patterns.push(`I${interlockMatch[1]}`);

  // Extract HVAC/TC codes (20-2-02-TC, 21-1-09-TC)
  const hvacMatches = upper.match(/(\d+[.-]\d+[.-]\d+[.-]?(?:TC|TS|SA)?)/gi) || [];
  for (const hv of hvacMatches) {
    patterns.push(hv.replace(/[.-]/g, '-'));
  }

  // Extract "Gr." group references
  const grMatch = upper.match(/GR\.?\s*(\d+)/i);
  if (grMatch) patterns.push(`GR${grMatch[1]}`);

  return { patterns, building, room: roomMatches[0] || null };
}

// Enhanced matching using extracted identifiers
function calculateEnhancedMatchScore(matrixEq, candidate) {
  let score = 0;
  let bonuses = [];

  // Extract identifiers
  const matrixIds = extractEquipmentIdentifiers((matrixEq.code || '') + ' ' + (matrixEq.name || '') + ' ' + (matrixEq.location || ''));
  const candIds = extractEquipmentIdentifiers((candidate.code || '') + ' ' + (candidate.name || '') + ' ' + (candidate.location || ''));

  // Direct pattern matches (high confidence)
  for (const mp of matrixIds.patterns) {
    for (const cp of candIds.patterns) {
      if (mp === cp) {
        score += 0.35;
        bonuses.push(`pattern:${mp}`);
      } else if (mp.includes(cp) || cp.includes(mp)) {
        score += 0.2;
        bonuses.push(`partial:${mp}~${cp}`);
      }
    }
  }

  // Building match
  if (matrixIds.building && candIds.building && matrixIds.building === candIds.building) {
    score += 0.15;
    bonuses.push(`building:${matrixIds.building}`);
  }

  // Name similarity (lower weight, more prone to false positives)
  const nameScore = stringSimilarity(matrixEq.name, candidate.name) * 0.2;
  score += nameScore;

  // Code similarity
  const codeScore = stringSimilarity(matrixEq.code, candidate.code) * 0.25;
  score += codeScore;

  // Location/room match bonus
  if (matrixEq.location && candidate.location) {
    const locScore = stringSimilarity(matrixEq.location, candidate.location) * 0.1;
    score += locScore;
  }

  // Floor match bonus
  if (matrixEq.floor && candidate.floor) {
    const floorLower = (matrixEq.floor || '').toLowerCase();
    const candFloorLower = (candidate.floor || '').toLowerCase();
    if (floorLower === candFloorLower) {
      score += 0.05;
      bonuses.push('floor');
    } else if (
      (floorLower.includes('sous') && candFloorLower.includes('sous')) ||
      (floorLower.includes('rez') && candFloorLower.includes('rez')) ||
      (floorLower.includes('1er') && candFloorLower.includes('1')) ||
      (floorLower.includes('toiture') && candFloorLower.includes('toit'))
    ) {
      score += 0.03;
    }
  }

  // Equipment type similarity
  const typeMatches = {
    pcf: ['pcf', 'porte', 'door', 'coupe-feu'],
    hvac: ['hvac', 'ventil', 'clim', 'air'],
    interlock: ['interlock', 'verrouill', 'sas'],
    ventilation: ['ventil', 'hvac', 'air', 'extract'],
    ascenseur: ['ascenseur', 'elevator', 'lift'],
    monte_charge: ['monte', 'charge', 'freight'],
  };

  const matrixType = (matrixEq.type || '').toLowerCase();
  const candType = (candidate.eq_type || '').toLowerCase();
  const candName = (candidate.name || '').toLowerCase();

  for (const [type, keywords] of Object.entries(typeMatches)) {
    if (matrixType === type || matrixType.includes(type)) {
      for (const kw of keywords) {
        if (candType.includes(kw) || candName.includes(kw)) {
          score += 0.08;
          bonuses.push(`type:${type}`);
          break;
        }
      }
      break;
    }
  }

  return { score: Math.min(score, 1.0), bonuses };
}

// Auto-match matrix equipment to existing equipment
app.post("/api/fire-control/auto-match-equipment", async (req, res) => {
  try {
    const { matrix_equipment } = req.body;
    // matrix_equipment: array of { code, name, type, building, floor, location }

    if (!Array.isArray(matrix_equipment)) {
      return res.status(400).json({ error: "matrix_equipment array required" });
    }

    // Fetch all potential matches from all systems
    const allCandidates = [];

    // 1. Doors
    try {
      const { rows: doors } = await pool.query(`
        SELECT id, code, name, building, floor, location, 'doors' as source, 'pcf' as eq_type,
          fire_interlock, fire_interlock_zone_id
        FROM fd_doors
      `);
      allCandidates.push(...doors);
    } catch (e) {}

    // 2. Switchboards
    try {
      const { rows: switches } = await pool.query(`
        SELECT id::text, code, name, building_code as building, floor, room as location,
          'switchboard' as source, 'interlock' as eq_type,
          fire_interlock, fire_interlock_zone_id
        FROM switchboards
      `);
      allCandidates.push(...switches);
    } catch (e) {}

    // 3. Datahub items
    try {
      const { rows: items } = await pool.query(`
        SELECT i.id::text, i.code, i.name, i.building, i.floor, i.location,
          'datahub' as source, c.name as eq_type,
          i.fire_interlock, i.fire_interlock_zone_id
        FROM dh_items i
        LEFT JOIN dh_categories c ON c.id = i.category_id
      `);
      allCandidates.push(...items);
    } catch (e) {}

    const results = [];
    const CONFIDENT_THRESHOLD = 0.75; // Lowered to allow pattern-based matches
    const UNCERTAIN_THRESHOLD = 0.35; // Lowered to catch more potential matches

    for (const matrixEq of matrix_equipment) {
      const matches = [];

      for (const candidate of allCandidates) {
        // Use enhanced matching with pattern extraction
        const { score: enhancedScore, bonuses } = calculateEnhancedMatchScore(matrixEq, candidate);

        if (enhancedScore >= UNCERTAIN_THRESHOLD) {
          matches.push({
            candidate_id: candidate.id,
            candidate_code: candidate.code,
            candidate_name: candidate.name,
            candidate_building: candidate.building,
            candidate_floor: candidate.floor,
            candidate_location: candidate.location,
            source_system: candidate.source,
            equipment_type: candidate.eq_type,
            already_linked: candidate.fire_interlock || false,
            linked_zone_id: candidate.fire_interlock_zone_id,
            score: Math.round(enhancedScore * 100),
            match_reasons: bonuses, // Include why this matched
          });
        }
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score);

      const topMatch = matches[0];
      const isConfident = topMatch && topMatch.score >= CONFIDENT_THRESHOLD * 100;
      const hasMultipleGoodMatches = matches.filter(m => m.score >= 60).length > 1; // Multiple matches above 60%

      results.push({
        // Nested object for frontend compatibility
        matrix_equipment: {
          code: matrixEq.code,
          name: matrixEq.name,
          type: matrixEq.type,
          building: matrixEq.building,
          floor: matrixEq.floor,
        },
        // Keep flat fields for backward compatibility
        matrix_code: matrixEq.code,
        matrix_name: matrixEq.name,
        matrix_type: matrixEq.type,
        matrix_building: matrixEq.building,
        matrix_floor: matrixEq.floor,
        status: isConfident && !hasMultipleGoodMatches ? 'confident' :
                matches.length > 0 ? 'uncertain' : 'no_match',
        best_match: topMatch || null,
        alternatives: matches.slice(1, 5), // Max 4 alternatives
        needs_confirmation: !isConfident || hasMultipleGoodMatches,
        question: !isConfident && matches.length > 0 ?
          `L'équipement "${matrixEq.code}" de la matrice correspond-il à "${topMatch?.candidate_code}" (${topMatch?.source_system}) ?` : null,
      });
    }

    const stats = {
      total: results.length,
      confident: results.filter(r => r.status === 'confident').length,
      uncertain: results.filter(r => r.status === 'uncertain').length,
      no_match: results.filter(r => r.status === 'no_match').length,
    };

    res.json({ matches: results, stats });
  } catch (err) {
    console.error("[FireControl] Auto-match error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get controls (zone checks) for a specific external equipment
app.get("/api/fire-control-maps/equipment-controls/:sourceSystem/:equipmentId", async (req, res) => {
  try {
    const { sourceSystem, equipmentId } = req.params;

    // Find the fc_equipment that matches this external equipment
    let fcEquipment = null;
    const equipQuery = await pool.query(`
      SELECT id, code, name, external_system, external_id
      FROM fc_equipment
      WHERE external_system = $1 AND external_id = $2
    `, [sourceSystem, equipmentId]);

    if (equipQuery.rows.length > 0) {
      fcEquipment = equipQuery.rows[0];
    }

    // Get active/pending zone checks where this equipment is involved
    const controlsQuery = await pool.query(`
      SELECT
        zc.id as zone_check_id,
        zc.zone_id,
        z.code as zone_code,
        z.name as zone_name,
        c.id as campaign_id,
        c.name as campaign_name,
        c.status as campaign_status,
        er.id as result_id,
        er.alarm_level,
        er.result,
        er.checked_at,
        er.checked_by,
        er.notes as result_notes
      FROM fc_equipment_results er
      JOIN fc_zone_checks zc ON zc.id = er.zone_check_id
      JOIN fc_zones z ON z.id = zc.zone_id
      LEFT JOIN fc_campaigns c ON c.id = zc.campaign_id
      WHERE er.equipment_id = $1
        AND (c.status IS NULL OR c.status IN ('active', 'planning'))
      ORDER BY
        CASE WHEN er.result IS NULL THEN 0 ELSE 1 END,
        c.name, z.code, er.alarm_level
    `, [fcEquipment?.id || '00000000-0000-0000-0000-000000000000']);

    // Group by zone check
    const controls = [];
    for (const row of controlsQuery.rows) {
      controls.push({
        zone_check_id: row.zone_check_id,
        zone_code: row.zone_code,
        zone_name: row.zone_name,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        campaign_status: row.campaign_status,
        alarm_level: row.alarm_level,
        result: row.result,
        checked_at: row.checked_at,
        checked_by: row.checked_by,
        is_pending: !row.result,
      });
    }

    // Also get linked zones (fc_zone_equipment) for this equipment even if no active campaign
    let linkedZones = [];
    if (fcEquipment?.id) {
      const zonesQuery = await pool.query(`
        SELECT z.id, z.code, z.name, ze.alarm_level, ze.action_type
        FROM fc_zone_equipment ze
        JOIN fc_zones z ON z.id = ze.zone_id
        WHERE ze.equipment_id = $1
        ORDER BY z.code, ze.alarm_level
      `, [fcEquipment.id]);
      linkedZones = zonesQuery.rows;
    }

    res.json({
      equipment: fcEquipment,
      controls,
      linked_zones: linkedZones,
      pending_count: controls.filter(c => c.is_pending).length,
      completed_count: controls.filter(c => !c.is_pending).length,
    });
  } catch (err) {
    console.error("[FireControl] Get equipment controls error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm equipment match and link to fire control
app.post("/api/fire-control/confirm-equipment-match", async (req, res) => {
  try {
    const { source_system, equipment_id, zone_id, alarm_level = 1, fire_interlock_code } = req.body;

    if (!source_system || !equipment_id) {
      return res.status(400).json({ error: "source_system and equipment_id required" });
    }

    let updated = false;

    if (source_system === 'doors') {
      await pool.query(`
        UPDATE fd_doors SET
          fire_interlock = true,
          fire_interlock_zone_id = $1,
          fire_interlock_alarm_level = $2,
          code = COALESCE(code, $3)
        WHERE id = $4
      `, [zone_id, alarm_level, fire_interlock_code, equipment_id]);
      updated = true;
    } else if (source_system === 'switchboard') {
      await pool.query(`
        UPDATE switchboards SET
          fire_interlock = true,
          fire_interlock_zone_id = $1,
          fire_interlock_alarm_level = $2,
          fire_interlock_code = $3
        WHERE id = $4
      `, [zone_id, alarm_level, fire_interlock_code, equipment_id]);
      updated = true;
    } else if (source_system === 'datahub') {
      await pool.query(`
        UPDATE dh_items SET
          fire_interlock = true,
          fire_interlock_zone_id = $1,
          fire_interlock_alarm_level = $2,
          fire_interlock_code = $3
        WHERE id = $4
      `, [zone_id, alarm_level, fire_interlock_code, equipment_id]);
      updated = true;
    }

    if (!updated) {
      return res.status(400).json({ error: "Unknown source_system" });
    }

    // Update existing fc_equipment with external_system and external_id if code matches
    // Or create a new one if it doesn't exist
    let fcEquipment = null;

    if (fire_interlock_code) {
      // First try to update existing equipment by code
      const { rows: updateRows } = await pool.query(`
        UPDATE fc_equipment SET
          external_system = $1,
          external_id = $2,
          updated_at = now()
        WHERE code = $3 AND (external_system IS NULL OR external_system = $1)
        RETURNING *
      `, [source_system, equipment_id, fire_interlock_code]);

      if (updateRows.length) {
        fcEquipment = updateRows[0];
      }
    }

    // If no existing equipment was updated, check if one exists by external_system/external_id
    if (!fcEquipment) {
      const { rows: existingRows } = await pool.query(`
        SELECT * FROM fc_equipment WHERE external_system = $1 AND external_id = $2
      `, [source_system, equipment_id]);

      if (existingRows.length) {
        fcEquipment = existingRows[0];
      } else {
        // Create new fc_equipment entry
        const { rows: insertRows } = await pool.query(`
          INSERT INTO fc_equipment (code, name, equipment_type, external_system, external_id)
          VALUES ($1, $1, $2, $3, $4)
          RETURNING *
        `, [fire_interlock_code || equipment_id, source_system, source_system, equipment_id]);
        fcEquipment = insertRows[0];
      }
    }

    res.json({ success: true, updated, fc_equipment: fcEquipment });
  } catch (err) {
    console.error("[FireControl] Confirm match error:", err);
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
