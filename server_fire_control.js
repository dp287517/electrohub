// ==============================
// server_fire_control.js — Fire Control Interlocking Tests microservice (ESM)
// Port: 3018
// ✅ VERSION 1.0 - Contrôle des asservissements incendie
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
import { notifyEquipmentCreated, notifyEquipmentDeleted, notifyMaintenanceCompleted, notifyStatusChanged, notifyNonConformity, notifyUser, notify } from "./lib/push-notify.js";

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
    allowedHeaders: [
      "Content-Type",
      "X-User-Email",
      "X-User-Name",
      "X-Site",
      "Authorization",
    ],
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

// Audit trail
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_campaigns_company ON fc_campaigns(company_id);`);

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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_matrices_campaign ON fc_matrices(campaign_id);`);

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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_plans_building ON fc_building_plans(building);`);

  // 4. Détecteurs (extraits des matrices ou créés manuellement)
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
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE SET NULL,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_detectors_building ON fc_detectors(building, floor);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_detectors_number ON fc_detectors(detector_number);`);

  // 5. Asservissements (actions déclenchées par les détecteurs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_interlocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      interlock_type TEXT,
      command TEXT,
      action TEXT,
      location TEXT,
      fdcio_info TEXT,
      station INT,
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE SET NULL,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 6. Liens détecteur <-> asservissement (matrice)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_detector_interlocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      detector_id UUID REFERENCES fc_detectors(id) ON DELETE CASCADE,
      interlock_id UUID REFERENCES fc_interlocks(id) ON DELETE CASCADE,
      alarm_type TEXT,
      matrix_id UUID REFERENCES fc_matrices(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(detector_id, interlock_id, alarm_type)
    );
  `);

  // 7. Contrôles (checklist items)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID REFERENCES fc_campaigns(id) ON DELETE CASCADE,
      detector_id UUID REFERENCES fc_detectors(id) ON DELETE CASCADE,
      check_date TIMESTAMPTZ,
      status TEXT DEFAULT 'pending',
      alarm1_ok BOOLEAN,
      alarm2_ok BOOLEAN,
      interlocks_checked JSONB DEFAULT '[]'::jsonb,
      notes TEXT,
      checked_by_email TEXT,
      checked_by_name TEXT,
      company_id INT,
      site_id INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_checks_campaign ON fc_checks(campaign_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fc_checks_detector ON fc_checks(detector_id);`);

  // 8. Photos et fichiers attachés aux contrôles
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_check_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      check_id UUID REFERENCES fc_checks(id) ON DELETE CASCADE,
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

  // 9. Positions des détecteurs sur les plans
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fc_detector_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      detector_id UUID REFERENCES fc_detectors(id) ON DELETE CASCADE,
      plan_id UUID REFERENCES fc_building_plans(id) ON DELETE CASCADE,
      page_index INT DEFAULT 0,
      x_frac NUMERIC,
      y_frac NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(detector_id, plan_id, page_index)
    );
  `);

  // 10. Rapports générés
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

  // 11. Calendrier de suivi
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

  // Ensure audit table
  await audit.ensureTable();

  console.log("[FireControl] Schema ensured");
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

// Parse detector ranges like "20001-20005,20009" into individual numbers
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

// Status helpers
const CAMPAIGN_STATUS = {
  PLANNED: "planned",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const CHECK_STATUS = {
  PENDING: "pending",
  PASSED: "passed",
  FAILED: "failed",
  PARTIAL: "partial",
};

// ------------------------------
// ROUTES: Campaigns
// ------------------------------

// List campaigns
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

// Get campaign by ID with stats
app.get("/api/fire-control/campaigns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM fc_campaigns WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Campaign not found" });

    // Get check stats
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) as total_checks,
        COUNT(*) FILTER (WHERE status = 'passed') as passed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending
      FROM fc_checks WHERE campaign_id = $1
    `, [id]);

    res.json({ ...rows[0], stats: statsRes.rows[0] });
  } catch (err) {
    console.error("[FireControl] GET campaign error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create campaign
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

    // Send push notification
    notifyEquipmentCreated('fire_campaign', { id: rows[0].id, name: campName, code: campName }, email)
      .catch(err => console.log('[FireControl] Push notify error:', err.message));

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST campaign error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update campaign
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
    await audit.log(req, AUDIT_ACTIONS.UPDATED, {
      entityType: "campaign",
      entityId: id,
      details: { name, status },
    });

    // Notify status change if status was updated
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

// Delete campaign
app.delete("/api/fire-control/campaigns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM fc_campaigns WHERE id = $1`, [id]);

    await audit.log(req, AUDIT_ACTIONS.DELETED, {
      entityType: "campaign",
      entityId: id,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[FireControl] DELETE campaign error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Matrices
// ------------------------------

// Upload matrix PDF
app.post("/api/fire-control/matrices/upload", uploadMatrix.single("file"), async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { email, name } = getIdentityFromReq(req);
    const { campaign_id, matrix_name, version } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const fileContent = await fsp.readFile(filePath);

    // Deactivate previous matrices with same name
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

    await audit.log(req, AUDIT_ACTIONS.FILE_UPLOADED, {
      entityType: "matrix",
      entityId: rows[0].id,
      details: { filename: req.file.originalname },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] Upload matrix error:", err);
    res.status(500).json({ error: err.message });
  }
});

// List matrices
app.get("/api/fire-control/matrices", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { active_only, campaign_id } = req.query;

    let sql = `SELECT id, campaign_id, name, filename, version, upload_date, is_active, created_at
               FROM fc_matrices WHERE ${filter.where}`;
    const params = [...filter.params];

    if (active_only === "true") {
      sql += ` AND is_active = true`;
    }
    if (campaign_id) {
      params.push(campaign_id);
      sql += ` AND campaign_id = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET matrices error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get matrix file
app.get("/api/fire-control/matrices/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path FROM fc_matrices WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "Matrix not found" });

    const matrix = rows[0];
    let buffer = matrix.content;

    if (!buffer && matrix.file_path) {
      try {
        buffer = await fsp.readFile(matrix.file_path);
      } catch {}
    }

    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${matrix.filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET matrix file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Parse matrix and extract detectors/interlocks
app.post("/api/fire-control/matrices/:id/parse", async (req, res) => {
  try {
    const { id } = req.params;
    const { parsed_data } = req.body;

    // Store parsed data
    await pool.query(`UPDATE fc_matrices SET parsed_data = $1 WHERE id = $2`, [JSON.stringify(parsed_data), id]);

    // Get matrix info for tenant
    const { rows: matrixRows } = await pool.query(`SELECT company_id, site_id FROM fc_matrices WHERE id = $1`, [id]);
    if (!matrixRows.length) return res.status(404).json({ error: "Matrix not found" });

    const { company_id, site_id } = matrixRows[0];

    // Insert detectors from parsed data
    if (parsed_data.detectors && Array.isArray(parsed_data.detectors)) {
      for (const det of parsed_data.detectors) {
        const detectorNumbers = parseDetectorRange(det.numbers);
        for (const num of detectorNumbers) {
          await pool.query(`
            INSERT INTO fc_detectors (detector_number, detector_type, building, floor, zone, access_point, location_description, station, matrix_id, company_id, site_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT DO NOTHING
          `, [num, det.type || 'smoke', det.building, det.floor, det.zone, det.access_point, det.location, det.station, id, company_id, site_id]);
        }
      }
    }

    // Insert interlocks
    if (parsed_data.interlocks && Array.isArray(parsed_data.interlocks)) {
      for (const intl of parsed_data.interlocks) {
        await pool.query(`
          INSERT INTO fc_interlocks (name, interlock_type, command, action, location, fdcio_info, station, matrix_id, company_id, site_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT DO NOTHING
        `, [intl.name, intl.type, intl.command, intl.action, intl.location, intl.fdcio_info, intl.station, id, company_id, site_id]);
      }
    }

    await audit.log(req, AUDIT_ACTIONS.UPDATED, {
      entityType: "matrix",
      entityId: id,
      details: { action: "parsed" },
    });

    res.json({ success: true, detectors_count: parsed_data.detectors?.length || 0, interlocks_count: parsed_data.interlocks?.length || 0 });
  } catch (err) {
    console.error("[FireControl] Parse matrix error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Building Plans
// ------------------------------

// Upload building plan
app.post("/api/fire-control/plans/upload", uploadPlan.single("file"), async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { building, floor, plan_name, version } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const fileContent = await fsp.readFile(filePath);

    // Count PDF pages
    let pageCount = 1;
    try {
      const pdfDoc = await pdfjsLib.getDocument({ data: fileContent }).promise;
      pageCount = pdfDoc.numPages;
    } catch {}

    // Deactivate previous plans for same building/floor
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

    await audit.log(req, AUDIT_ACTIONS.FILE_UPLOADED, {
      entityType: "building_plan",
      entityId: rows[0].id,
      details: { building, floor, filename: req.file.originalname },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] Upload plan error:", err);
    res.status(500).json({ error: err.message });
  }
});

// List building plans
app.get("/api/fire-control/plans", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { building, active_only } = req.query;

    let sql = `SELECT id, building, floor, name, filename, version, page_count, is_active, created_at
               FROM fc_building_plans WHERE ${filter.where}`;
    const params = [...filter.params];

    if (active_only === "true") {
      sql += ` AND is_active = true`;
    }
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

// Get plan file
app.get("/api/fire-control/plans/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path FROM fc_building_plans WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "Plan not found" });

    const plan = rows[0];
    let buffer = plan.content;

    if (!buffer && plan.file_path) {
      try {
        buffer = await fsp.readFile(plan.file_path);
      } catch {}
    }

    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${plan.filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET plan file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get list of buildings
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
// ROUTES: Detectors
// ------------------------------

// List detectors
app.get("/api/fire-control/detectors", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { building, floor, station } = req.query;

    let sql = `SELECT * FROM fc_detectors WHERE ${filter.where}`;
    const params = [...filter.params];

    if (building) {
      params.push(building);
      sql += ` AND building = $${params.length}`;
    }
    if (floor) {
      params.push(floor);
      sql += ` AND floor = $${params.length}`;
    }
    if (station) {
      params.push(Number(station));
      sql += ` AND station = $${params.length}`;
    }

    sql += ` ORDER BY building, floor, detector_number`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET detectors error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get detector with interlocks
app.get("/api/fire-control/detectors/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM fc_detectors WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Detector not found" });

    // Get linked interlocks
    const { rows: interlocks } = await pool.query(`
      SELECT i.*, di.alarm_type
      FROM fc_interlocks i
      JOIN fc_detector_interlocks di ON di.interlock_id = i.id
      WHERE di.detector_id = $1
    `, [id]);

    res.json({ ...rows[0], interlocks });
  } catch (err) {
    console.error("[FireControl] GET detector error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create detector manually
app.post("/api/fire-control/detectors", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { detector_number, detector_type, building, floor, zone, access_point, location_description, station } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_detectors (detector_number, detector_type, building, floor, zone, access_point, location_description, station, company_id, site_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [detector_number, detector_type || 'smoke', building, floor, zone, access_point, location_description, station, tenant.companyId, tenant.siteId]);

    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: "detector",
      entityId: rows[0].id,
      details: { detector_number, building, floor },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST detector error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update detector position on plan
app.post("/api/fire-control/detectors/:id/position", async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_id, page_index, x_frac, y_frac } = req.body;

    await pool.query(`
      INSERT INTO fc_detector_positions (detector_id, plan_id, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (detector_id, plan_id, page_index)
      DO UPDATE SET x_frac = $4, y_frac = $5, updated_at = now()
    `, [id, plan_id, page_index || 0, x_frac, y_frac]);

    res.json({ success: true });
  } catch (err) {
    console.error("[FireControl] POST detector position error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get detector positions for a plan
app.get("/api/fire-control/plans/:id/positions", async (req, res) => {
  try {
    const { id } = req.params;
    const { page_index } = req.query;

    let sql = `
      SELECT dp.*, d.detector_number, d.detector_type, d.building, d.floor, d.zone
      FROM fc_detector_positions dp
      JOIN fc_detectors d ON d.id = dp.detector_id
      WHERE dp.plan_id = $1
    `;
    const params = [id];

    if (page_index !== undefined) {
      params.push(Number(page_index));
      sql += ` AND dp.page_index = $${params.length}`;
    }

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET plan positions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Checks (Controls)
// ------------------------------

// List checks for a campaign
app.get("/api/fire-control/checks", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { campaign_id, status, building, floor } = req.query;

    let sql = `
      SELECT c.*, d.detector_number, d.building, d.floor, d.zone, d.access_point
      FROM fc_checks c
      JOIN fc_detectors d ON d.id = c.detector_id
      WHERE ${filter.where.replace(/company_id/g, 'c.company_id').replace(/site_id/g, 'c.site_id')}
    `;
    const params = [...filter.params];

    if (campaign_id) {
      params.push(campaign_id);
      sql += ` AND c.campaign_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND c.status = $${params.length}`;
    }
    if (building) {
      params.push(building);
      sql += ` AND d.building = $${params.length}`;
    }
    if (floor) {
      params.push(floor);
      sql += ` AND d.floor = $${params.length}`;
    }

    sql += ` ORDER BY d.building, d.floor, d.detector_number`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET checks error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create check for detector
app.post("/api/fire-control/checks", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { campaign_id, detector_id } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO fc_checks (campaign_id, detector_id, company_id, site_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [campaign_id, detector_id, tenant.companyId, tenant.siteId]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Generate checks for all detectors in a campaign
app.post("/api/fire-control/campaigns/:id/generate-checks", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = extractTenantFromRequest(req);
    const { building, floor } = req.body;

    // Get all detectors matching filter
    let sql = `SELECT id FROM fc_detectors WHERE company_id = $1 AND site_id = $2`;
    const params = [tenant.companyId, tenant.siteId];

    if (building) {
      params.push(building);
      sql += ` AND building = $${params.length}`;
    }
    if (floor) {
      params.push(floor);
      sql += ` AND floor = $${params.length}`;
    }

    const { rows: detectors } = await pool.query(sql, params);

    // Create check for each detector
    let created = 0;
    for (const det of detectors) {
      // Check if already exists
      const { rows: existing } = await pool.query(
        `SELECT id FROM fc_checks WHERE campaign_id = $1 AND detector_id = $2`,
        [id, det.id]
      );

      if (!existing.length) {
        await pool.query(`
          INSERT INTO fc_checks (campaign_id, detector_id, company_id, site_id)
          VALUES ($1, $2, $3, $4)
        `, [id, det.id, tenant.companyId, tenant.siteId]);
        created++;
      }
    }

    const { email } = getIdentityFromReq(req);
    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: "checks_batch",
      entityId: id,
      details: { created_count: created, building, floor },
    });

    // Notify user that checks were generated
    if (created > 0) {
      notify(`🔥 Contrôles générés`, `${created} contrôle(s) créé(s) pour la campagne`, {
        type: 'fire_control_checks_generated',
        excludeUserId: email,
        data: { campaignId: id, url: `/app/fire-control?tab=controls&campaign=${id}` }
      }).catch(err => console.log('[FireControl] Push notify error:', err.message));
    }

    res.json({ success: true, created_count: created, total_detectors: detectors.length });
  } catch (err) {
    console.error("[FireControl] Generate checks error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update check (record test result)
app.put("/api/fire-control/checks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name } = getIdentityFromReq(req);
    const { alarm1_ok, alarm2_ok, interlocks_checked, notes, status } = req.body;

    // Determine status based on results
    let finalStatus = status;
    if (!finalStatus && (alarm1_ok !== undefined || alarm2_ok !== undefined)) {
      if (alarm1_ok && alarm2_ok) {
        finalStatus = CHECK_STATUS.PASSED;
      } else if (!alarm1_ok && !alarm2_ok) {
        finalStatus = CHECK_STATUS.FAILED;
      } else {
        finalStatus = CHECK_STATUS.PARTIAL;
      }
    }

    const { rows } = await pool.query(`
      UPDATE fc_checks
      SET alarm1_ok = COALESCE($1, alarm1_ok),
          alarm2_ok = COALESCE($2, alarm2_ok),
          interlocks_checked = COALESCE($3, interlocks_checked),
          notes = COALESCE($4, notes),
          status = COALESCE($5, status),
          check_date = CASE WHEN $5 IS NOT NULL AND $5 != 'pending' THEN now() ELSE check_date END,
          checked_by_email = CASE WHEN $5 IS NOT NULL AND $5 != 'pending' THEN $6 ELSE checked_by_email END,
          checked_by_name = CASE WHEN $5 IS NOT NULL AND $5 != 'pending' THEN $7 ELSE checked_by_name END,
          updated_at = now()
      WHERE id = $8
      RETURNING *
    `, [alarm1_ok, alarm2_ok, JSON.stringify(interlocks_checked), notes, finalStatus, email, name, id]);

    if (!rows.length) return res.status(404).json({ error: "Check not found" });

    await audit.log(req, AUDIT_ACTIONS.CHECK_COMPLETED, {
      entityType: "check",
      entityId: id,
      details: { alarm1_ok, alarm2_ok, status: finalStatus },
    });

    // Send notification for completed check
    if (finalStatus && finalStatus !== 'pending') {
      // Get detector info for notification
      const detResult = await pool.query(`SELECT code, name, building, floor FROM fc_detectors WHERE id = $1`, [rows[0].detector_id]);
      const detector = detResult.rows[0] || {};
      const detectorName = detector.code || detector.name || `Détecteur #${rows[0].detector_id}`;

      if (finalStatus === 'failed' || finalStatus === 'partial') {
        // Non-conformity detected
        notifyNonConformity('fire_detector',
          { id: rows[0].detector_id, name: detectorName, code: detectorName },
          `Alarme 1: ${alarm1_ok ? 'OK' : 'KO'}, Alarme 2: ${alarm2_ok ? 'OK' : 'KO'}`
        ).catch(err => console.log('[FireControl] Push notify error:', err.message));
      } else {
        // Maintenance completed successfully
        notifyMaintenanceCompleted('fire_detector',
          { id: rows[0].detector_id, name: detectorName, code: detectorName },
          { id: rows[0].id, status: finalStatus },
          email
        ).catch(err => console.log('[FireControl] Push notify error:', err.message));
      }
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] PUT check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Upload photo/file for a check
app.post("/api/fire-control/checks/:id/files", uploadFile.single("file"), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name } = getIdentityFromReq(req);
    const { file_type } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const fileContent = await fsp.readFile(filePath);

    const { rows } = await pool.query(`
      INSERT INTO fc_check_files (check_id, filename, file_path, content, mime, file_type, uploaded_by_email, uploaded_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [id, req.file.originalname, filePath, fileContent, req.file.mimetype, file_type || 'photo', email, name]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[FireControl] Upload check file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get files for a check
app.get("/api/fire-control/checks/:id/files", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT id, filename, mime, file_type, uploaded_by_name, uploaded_at
      FROM fc_check_files WHERE check_id = $1
      ORDER BY uploaded_at DESC
    `, [id]);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET check files error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get file content
app.get("/api/fire-control/files/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path, mime FROM fc_check_files WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "File not found" });

    const file = rows[0];
    let buffer = file.content;

    if (!buffer && file.file_path) {
      try {
        buffer = await fsp.readFile(file.file_path);
      } catch {}
    }

    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Schedule
// ------------------------------

// Get schedule
app.get("/api/fire-control/schedule", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { year, month, building } = req.query;

    let sql = `SELECT s.*, c.name as campaign_name
               FROM fc_schedule s
               LEFT JOIN fc_campaigns c ON c.id = s.campaign_id
               WHERE ${filter.where.replace(/company_id/g, 's.company_id').replace(/site_id/g, 's.site_id')}`;
    const params = [...filter.params];

    if (year) {
      params.push(Number(year));
      sql += ` AND EXTRACT(YEAR FROM s.scheduled_date) = $${params.length}`;
    }
    if (month) {
      params.push(Number(month));
      sql += ` AND EXTRACT(MONTH FROM s.scheduled_date) = $${params.length}`;
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

// Create schedule entry
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

// Update schedule entry
app.put("/api/fire-control/schedule/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduled_date, status, assigned_to, notes } = req.body;

    const { rows } = await pool.query(`
      UPDATE fc_schedule
      SET scheduled_date = COALESCE($1, scheduled_date),
          status = COALESCE($2, status),
          assigned_to = COALESCE($3, assigned_to),
          notes = COALESCE($4, notes),
          updated_at = now()
      WHERE id = $5
      RETURNING *
    `, [scheduled_date, status, assigned_to, notes, id]);

    if (!rows.length) return res.status(404).json({ error: "Schedule entry not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] PUT schedule error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Dashboard / Stats
// ------------------------------

app.get("/api/fire-control/dashboard", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const year = req.query.year || new Date().getFullYear();

    // Get current year campaign stats
    const campaignStats = await pool.query(`
      SELECT
        COUNT(*) as total_campaigns,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress
      FROM fc_campaigns
      WHERE ${filter.where} AND year = $${filter.params.length + 1}
    `, [...filter.params, year]);

    // Get check stats
    const checkStats = await pool.query(`
      SELECT
        COUNT(*) as total_checks,
        COUNT(*) FILTER (WHERE c.status = 'passed') as passed,
        COUNT(*) FILTER (WHERE c.status = 'failed') as failed,
        COUNT(*) FILTER (WHERE c.status = 'pending') as pending
      FROM fc_checks c
      JOIN fc_campaigns camp ON camp.id = c.campaign_id
      WHERE ${filter.where.replace(/company_id/g, 'c.company_id').replace(/site_id/g, 'c.site_id')}
        AND camp.year = $${filter.params.length + 1}
    `, [...filter.params, year]);

    // Get building summary
    const buildingStats = await pool.query(`
      SELECT
        d.building,
        COUNT(DISTINCT d.id) as detector_count,
        COUNT(DISTINCT c.id) as check_count,
        COUNT(*) FILTER (WHERE c.status = 'passed') as passed,
        COUNT(*) FILTER (WHERE c.status = 'failed') as failed
      FROM fc_detectors d
      LEFT JOIN fc_checks c ON c.detector_id = d.id
      LEFT JOIN fc_campaigns camp ON camp.id = c.campaign_id AND camp.year = $${filter.params.length + 1}
      WHERE ${filter.where.replace(/company_id/g, 'd.company_id').replace(/site_id/g, 'd.site_id')}
      GROUP BY d.building
      ORDER BY d.building
    `, [...filter.params, year]);

    // Get upcoming schedule
    const upcoming = await pool.query(`
      SELECT s.*, c.name as campaign_name
      FROM fc_schedule s
      LEFT JOIN fc_campaigns c ON c.id = s.campaign_id
      WHERE ${filter.where.replace(/company_id/g, 's.company_id').replace(/site_id/g, 's.site_id')}
        AND s.scheduled_date >= CURRENT_DATE
        AND s.status != 'completed'
      ORDER BY s.scheduled_date
      LIMIT 10
    `, filter.params);

    res.json({
      year: Number(year),
      campaigns: campaignStats.rows[0],
      checks: checkStats.rows[0],
      buildings: buildingStats.rows,
      upcoming_schedule: upcoming.rows,
    });
  } catch (err) {
    console.error("[FireControl] GET dashboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Report Generation
// ------------------------------

app.post("/api/fire-control/campaigns/:id/report", async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = extractTenantFromRequest(req);
    const { email, name } = getIdentityFromReq(req);

    // Get campaign
    const { rows: campRows } = await pool.query(`SELECT * FROM fc_campaigns WHERE id = $1`, [id]);
    if (!campRows.length) return res.status(404).json({ error: "Campaign not found" });
    const campaign = campRows[0];

    // Get all checks with details
    const { rows: checks } = await pool.query(`
      SELECT c.*, d.detector_number, d.building, d.floor, d.zone, d.access_point, d.location_description
      FROM fc_checks c
      JOIN fc_detectors d ON d.id = c.detector_id
      WHERE c.campaign_id = $1
      ORDER BY d.building, d.floor, d.detector_number
    `, [id]);

    // Generate PDF
    const doc = new PDFDocument({ margin: 50 });
    const filename = `fire_control_report_${campaign.year}_${Date.now()}.pdf`;
    const filePath = path.join(REPORTS_DIR, filename);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Header
    doc.fontSize(20).text("Rapport de Contrôle des Asservissements Incendie", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Campagne: ${campaign.name}`, { align: "center" });
    doc.fontSize(12).text(`Année: ${campaign.year}`, { align: "center" });
    doc.text(`Date du rapport: ${new Date().toLocaleDateString("fr-FR")}`, { align: "center" });
    doc.moveDown(2);

    // Summary
    const passed = checks.filter(c => c.status === "passed").length;
    const failed = checks.filter(c => c.status === "failed").length;
    const pending = checks.filter(c => c.status === "pending").length;

    doc.fontSize(14).text("Résumé", { underline: true });
    doc.fontSize(11);
    doc.text(`Total des contrôles: ${checks.length}`);
    doc.text(`Conformes: ${passed}`, { continued: false });
    doc.text(`Non-conformes: ${failed}`);
    doc.text(`En attente: ${pending}`);
    doc.moveDown(2);

    // Details by building
    const byBuilding = {};
    for (const check of checks) {
      const bld = check.building || "Non défini";
      if (!byBuilding[bld]) byBuilding[bld] = [];
      byBuilding[bld].push(check);
    }

    for (const [building, buildingChecks] of Object.entries(byBuilding)) {
      doc.fontSize(13).text(`Bâtiment: ${building}`, { underline: true });
      doc.moveDown(0.5);

      for (const check of buildingChecks) {
        const statusIcon = check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "○";
        doc.fontSize(10).text(
          `${statusIcon} Détecteur ${check.detector_number} - ${check.floor || ""} ${check.zone || ""} - Alarme 1: ${check.alarm1_ok ? "OK" : "NOK"} | Alarme 2: ${check.alarm2_ok ? "OK" : "NOK"}`
        );
        if (check.notes) {
          doc.fontSize(9).text(`   Notes: ${check.notes}`, { indent: 20 });
        }
      }
      doc.moveDown();
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(9).text(`Généré par: ${name || email || "Système"}`, { align: "right" });

    doc.end();

    await new Promise((resolve) => writeStream.on("finish", resolve));

    // Store report reference
    const fileContent = await fsp.readFile(filePath);
    const { rows: reportRows } = await pool.query(`
      INSERT INTO fc_reports (campaign_id, report_type, filename, file_path, content, generated_by_email, generated_by_name, company_id, site_id)
      VALUES ($1, 'control', $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [id, filename, filePath, fileContent, email, name, tenant.companyId, tenant.siteId]);

    await audit.log(req, AUDIT_ACTIONS.EXPORTED, {
      entityType: "report",
      entityId: reportRows[0].id,
      details: { campaign_id: id, filename },
    });

    res.json({ success: true, report_id: reportRows[0].id, filename });
  } catch (err) {
    console.error("[FireControl] Generate report error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get report file
app.get("/api/fire-control/reports/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, content, file_path FROM fc_reports WHERE id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: "Report not found" });

    const report = rows[0];
    let buffer = report.content;

    if (!buffer && report.file_path) {
      try {
        buffer = await fsp.readFile(report.file_path);
      } catch {}
    }

    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET report file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// List reports
app.get("/api/fire-control/reports", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { campaign_id } = req.query;

    let sql = `SELECT id, campaign_id, report_type, filename, generated_by_name, created_at
               FROM fc_reports WHERE ${filter.where}`;
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
// ROUTES: Interlocks
// ------------------------------

// List interlocks
app.get("/api/fire-control/interlocks", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);
    const { station, type } = req.query;

    let sql = `SELECT * FROM fc_interlocks WHERE ${filter.where}`;
    const params = [...filter.params];

    if (station) {
      params.push(Number(station));
      sql += ` AND station = $${params.length}`;
    }
    if (type) {
      params.push(type);
      sql += ` AND interlock_type = $${params.length}`;
    }

    sql += ` ORDER BY station, name`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[FireControl] GET interlocks error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// ROUTES: Alerts (retards de contrôle)
// ------------------------------

app.get("/api/fire-control/alerts", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);

    // Get overdue scheduled controls (date passed, not completed)
    const overdueSchedule = await pool.query(`
      SELECT s.*, c.name as campaign_name
      FROM fc_schedule s
      LEFT JOIN fc_campaigns c ON c.id = s.campaign_id
      WHERE ${filter.where.replace(/company_id/g, 's.company_id').replace(/site_id/g, 's.site_id')}
        AND s.scheduled_date < CURRENT_DATE
        AND s.status NOT IN ('completed', 'cancelled')
      ORDER BY s.scheduled_date
    `, filter.params);

    // Get pending checks from active campaigns that should be done (campaign end_date passed)
    const overdueChecks = await pool.query(`
      SELECT
        c.id as campaign_id,
        c.name as campaign_name,
        c.end_date,
        COUNT(*) FILTER (WHERE ch.status = 'pending') as pending_count,
        COUNT(*) as total_checks
      FROM fc_campaigns c
      LEFT JOIN fc_checks ch ON ch.campaign_id = c.id
      WHERE ${filter.where.replace(/company_id/g, 'c.company_id').replace(/site_id/g, 'c.site_id')}
        AND c.end_date < CURRENT_DATE
        AND c.status = 'in_progress'
      GROUP BY c.id, c.name, c.end_date
      HAVING COUNT(*) FILTER (WHERE ch.status = 'pending') > 0
    `, filter.params);

    // Get upcoming controls (next 30 days)
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
// ROUTES: Maps (for Leaflet visualization)
// ------------------------------

// List plans for maps
app.get("/api/fire-control/maps/listPlans", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);

    const { rows } = await pool.query(`
      SELECT id, building, floor, name, filename, version, page_count, is_active, created_at
      FROM fc_building_plans
      WHERE ${filter.where} AND is_active = true
      ORDER BY building, floor
    `, filter.params);

    // Format for compatibility with other map views
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

// Get plan file for map display
app.get("/api/fire-control/maps/planFile", async (req, res) => {
  try {
    const { id, logical_name } = req.query;

    let rows;
    if (id) {
      ({ rows } = await pool.query(`SELECT filename, content, file_path FROM fc_building_plans WHERE id = $1`, [id]));
    } else if (logical_name) {
      // Parse logical_name to get building and floor
      const parts = logical_name.split('_');
      const building = parts[0];
      const floor = parts.slice(1).join('_').replace(/_/g, ' ') || null;

      ({ rows } = await pool.query(`
        SELECT filename, content, file_path FROM fc_building_plans
        WHERE building = $1 AND (floor = $2 OR ($2 IS NULL AND floor IS NULL)) AND is_active = true
        ORDER BY created_at DESC LIMIT 1
      `, [building, floor === 'all' ? null : floor]));
    }

    if (!rows || !rows.length) return res.status(404).json({ error: "Plan not found" });

    const plan = rows[0];
    let buffer = plan.content;

    if (!buffer && plan.file_path) {
      try {
        buffer = await fsp.readFile(plan.file_path);
      } catch {}
    }

    if (!buffer) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${plan.filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[FireControl] GET maps/planFile error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get positions for a plan (for map markers)
app.get("/api/fire-control/maps/positions", async (req, res) => {
  try {
    const { id, logical_name, page_index = 0 } = req.query;

    let planId = id;

    // If logical_name provided, find the plan ID
    if (!planId && logical_name) {
      const parts = logical_name.split('_');
      const building = parts[0];
      const floor = parts.slice(1).join('_').replace(/_/g, ' ') || null;

      const { rows: planRows } = await pool.query(`
        SELECT id FROM fc_building_plans
        WHERE building = $1 AND (floor = $2 OR ($2 IS NULL AND floor IS NULL)) AND is_active = true
        ORDER BY created_at DESC LIMIT 1
      `, [building, floor === 'all' ? null : floor]);

      if (planRows.length) planId = planRows[0].id;
    }

    if (!planId) return res.json({ positions: [] });

    const { rows } = await pool.query(`
      SELECT
        dp.id as position_id,
        dp.detector_id,
        dp.x_frac,
        dp.y_frac,
        dp.page_index,
        d.detector_number,
        d.detector_type,
        d.building,
        d.floor,
        d.zone,
        d.access_point,
        d.location_description
      FROM fc_detector_positions dp
      JOIN fc_detectors d ON d.id = dp.detector_id
      WHERE dp.plan_id = $1 AND dp.page_index = $2
    `, [planId, Number(page_index)]);

    res.json({ positions: rows });
  } catch (err) {
    console.error("[FireControl] GET maps/positions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Set position for a detector on a plan
app.post("/api/fire-control/maps/setPosition", async (req, res) => {
  try {
    const { detector_id, plan_id, logical_name, page_index = 0, x_frac, y_frac } = req.body;
    const { email, name } = getIdentityFromReq(req);

    let finalPlanId = plan_id;

    // If logical_name provided, find the plan ID
    if (!finalPlanId && logical_name) {
      const parts = logical_name.split('_');
      const building = parts[0];
      const floor = parts.slice(1).join('_').replace(/_/g, ' ') || null;

      const { rows: planRows } = await pool.query(`
        SELECT id FROM fc_building_plans
        WHERE building = $1 AND (floor = $2 OR ($2 IS NULL AND floor IS NULL)) AND is_active = true
        ORDER BY created_at DESC LIMIT 1
      `, [building, floor === 'all' ? null : floor]);

      if (planRows.length) finalPlanId = planRows[0].id;
    }

    if (!finalPlanId) return res.status(400).json({ error: "Plan not found" });

    const { rows } = await pool.query(`
      INSERT INTO fc_detector_positions (detector_id, plan_id, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (detector_id, plan_id, page_index)
      DO UPDATE SET x_frac = $4, y_frac = $5, updated_at = now()
      RETURNING *
    `, [detector_id, finalPlanId, page_index, x_frac, y_frac]);

    await audit.log(req, AUDIT_ACTIONS.POSITION_SET, {
      entityType: "detector_position",
      entityId: rows[0].id,
      details: { detector_id, plan_id: finalPlanId, x_frac, y_frac },
    });

    res.json(rows[0]);
  } catch (err) {
    console.error("[FireControl] POST maps/setPosition error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete position
app.delete("/api/fire-control/maps/positions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM fc_detector_positions WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("[FireControl] DELETE position error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get placed detector IDs (for map highlighting)
app.get("/api/fire-control/maps/placed-ids", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant);

    const { rows } = await pool.query(`
      SELECT DISTINCT dp.detector_id
      FROM fc_detector_positions dp
      JOIN fc_detectors d ON d.id = dp.detector_id
      WHERE ${filter.where.replace(/company_id/g, 'd.company_id').replace(/site_id/g, 'd.site_id')}
    `, filter.params);

    res.json({ placed_ids: rows.map(r => r.detector_id) });
  } catch (err) {
    console.error("[FireControl] GET placed-ids error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// Health check
// ------------------------------
app.get("/api/fire-control/health", (req, res) => {
  res.json({ status: "ok", service: "fire-control", timestamp: new Date().toISOString() });
});

// ------------------------------
// Start
// ------------------------------
async function start() {
  try {
    await ensureSchema();
    app.listen(PORT, HOST, () => {
      console.log(`[FireControl] Server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error("[FireControl] Failed to start:", err);
    process.exit(1);
  }
}

start();
