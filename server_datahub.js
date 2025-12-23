// ==============================
// server_datahub.js — Datahub microservice (ESM)
// Port: 3024
// VERSION 1.0 - AUDIT TRAIL + MULTI-TENANT
// Similar to Mobile Equipment but with custom category markers, no controls
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
import { createAuditTrail, AUDIT_ACTIONS } from "./lib/audit-trail.js";
import { extractTenantFromRequest, getTenantFilter } from "./lib/tenant-filter.js";

// MAPS - PDF handling (reuse VSD plans)
import crypto from "crypto";
import PDFDocument from "pdfkit";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------
// App & Config
// ------------------------------
const app = express();
app.set("trust proxy", 1);

// Helmet — CSP
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

// CORS
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

app.use(express.json({ limit: "16mb" }));

const PORT = Number(process.env.DATAHUB_PORT || 3024);
const HOST = process.env.DATAHUB_HOST || "0.0.0.0";

// Storage layout
const DATA_ROOT = path.join(process.cwd(), "uploads", "datahub");
const FILES_DIR = path.join(DATA_ROOT, "files");
await fsp.mkdir(FILES_DIR, { recursive: true });

// Multer
const uploadAny = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ------------------------------
// DB
// ------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
  max: 10,
});

async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Settings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dh_settings (
      id INT PRIMARY KEY DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    INSERT INTO dh_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);

  // Categories with custom colors and icons for markers (up to 50)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dh_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#3B82F6',
      icon TEXT NOT NULL DEFAULT 'circle',
      marker_size INT NOT NULL DEFAULT 32,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Add missing columns
  try { await pool.query(`ALTER TABLE dh_categories ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;`); } catch {}
  try { await pool.query(`ALTER TABLE dh_categories ADD COLUMN IF NOT EXISTS marker_size INT NOT NULL DEFAULT 32;`); } catch {}

  // Items (similar to equipments but simpler)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dh_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT,
      category_id UUID REFERENCES dh_categories(id) ON DELETE SET NULL,
      building TEXT,
      floor TEXT,
      location TEXT,
      description TEXT,
      notes TEXT,
      photo_path TEXT,
      data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE dh_items ADD COLUMN IF NOT EXISTS code TEXT;`);
  await pool.query(`ALTER TABLE dh_items ADD COLUMN IF NOT EXISTS description TEXT;`);
  await pool.query(`ALTER TABLE dh_items ADD COLUMN IF NOT EXISTS notes TEXT;`);
  await pool.query(`ALTER TABLE dh_items ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE dh_items ADD COLUMN IF NOT EXISTS photo_file_id UUID;`);

  // Files attached to items
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dh_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID REFERENCES dh_items(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT,
      mimetype TEXT,
      size_bytes INT,
      content BYTEA,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE dh_files ADD COLUMN IF NOT EXISTS content BYTEA;`);
  await pool.query(`ALTER TABLE dh_files ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'file';`);
  try { await pool.query(`ALTER TABLE dh_files ALTER COLUMN filepath DROP NOT NULL;`); } catch {}

  // Positions on VSD maps (uses VSD plans - same as mobile equipment)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dh_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID REFERENCES dh_items(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      page_index INT NOT NULL DEFAULT 0,
      x_frac DOUBLE PRECISION NOT NULL,
      y_frac DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(item_id, logical_name, page_index)
    );
  `);

  // VSD Plans tables (fallback creation - normally created by server_vsd.js)
  // This ensures datahub can work even if VSD microservice hasn't run yet
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

  console.log("[Datahub] Schema ready (including VSD plans tables)");
}

// Create audit trail helper
const audit = createAuditTrail(pool, "datahub");

async function initSchema() {
  await ensureSchema();
  await audit.ensureTable();
}
initSchema();

// Tenant extraction
function getTenant(req) {
  return extractTenantFromRequest(req);
}

// User info
function userInfo(req) {
  return {
    email: req.headers["x-user-email"] || req.user?.email || "unknown",
    name: req.headers["x-user-name"] || req.user?.name || "Unknown",
  };
}

// ====================
// HEALTH CHECK
// ====================
app.get("/api/datahub/health", (_req, res) => res.json({ ok: true, service: "datahub" }));

// ====================
// CATEGORIES CRUD
// ====================

// List categories
app.get("/api/datahub/categories", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
             (SELECT COUNT(*) FROM dh_items i WHERE i.category_id = c.id) as item_count
        FROM dh_categories c
       ORDER BY c.sort_order, c.name
    `);
    res.json({ ok: true, categories: rows });
  } catch (e) {
    console.error("[Datahub] List categories error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Create category
app.post("/api/datahub/categories", async (req, res) => {
  try {
    const { name, description, color, icon, marker_size, sort_order } = req.body;
    if (!name?.trim()) return res.status(400).json({ ok: false, error: "Name required" });

    const { rows } = await pool.query(`
      INSERT INTO dh_categories (name, description, color, icon, marker_size, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name.trim(), description || null, color || '#3B82F6', icon || 'circle', marker_size || 32, sort_order || 0]);

    await audit.log(req, AUDIT_ACTIONS.CREATED, { entityType: 'category', entityId: rows[0].id, details: { name } });
    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    console.error("[Datahub] Create category error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Update category
app.put("/api/datahub/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon, marker_size, sort_order } = req.body;

    const { rows } = await pool.query(`
      UPDATE dh_categories
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             color = COALESCE($3, color),
             icon = COALESCE($4, icon),
             marker_size = COALESCE($5, marker_size),
             sort_order = COALESCE($6, sort_order)
       WHERE id = $7
       RETURNING *
    `, [name, description, color, icon, marker_size, sort_order, id]);

    if (rows.length === 0) return res.status(404).json({ ok: false, error: "Category not found" });

    await audit.log(req, AUDIT_ACTIONS.UPDATED, { entityType: 'category', entityId: id, details: { name } });
    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    console.error("[Datahub] Update category error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Delete category
app.delete("/api/datahub/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(`DELETE FROM dh_categories WHERE id = $1`, [id]);

    if (rowCount === 0) return res.status(404).json({ ok: false, error: "Category not found" });

    await audit.log(req, AUDIT_ACTIONS.DELETED, { entityType: 'category', entityId: id });
    res.json({ ok: true });
  } catch (e) {
    console.error("[Datahub] Delete category error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// ITEMS CRUD
// ====================

// List items
app.get("/api/datahub/items", async (req, res) => {
  try {
    const { category_id, building, floor, search, limit = 500, offset = 0 } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (category_id) {
      where += ` AND i.category_id = $${idx++}`;
      params.push(category_id);
    }
    if (building) {
      where += ` AND i.building = $${idx++}`;
      params.push(building);
    }
    if (floor) {
      where += ` AND i.floor = $${idx++}`;
      params.push(floor);
    }
    if (search) {
      where += ` AND (i.name ILIKE $${idx} OR i.code ILIKE $${idx} OR i.description ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const { rows } = await pool.query(`
      SELECT i.*, c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM dh_items i
        LEFT JOIN dh_categories c ON c.id = i.category_id
        ${where}
       ORDER BY i.building, i.floor, i.name
       LIMIT $${idx++} OFFSET $${idx}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("[Datahub] List items error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get single item
app.get("/api/datahub/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT i.*, c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM dh_items i
        LEFT JOIN dh_categories c ON c.id = i.category_id
       WHERE i.id = $1
    `, [id]);

    if (rows.length === 0) return res.status(404).json({ ok: false, error: "Item not found" });
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("[Datahub] Get item error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Create item
app.post("/api/datahub/items", async (req, res) => {
  try {
    const { name, code, category_id, building, floor, location, description, notes, data } = req.body;
    if (!name?.trim()) return res.status(400).json({ ok: false, error: "Name required" });

    const { rows } = await pool.query(`
      INSERT INTO dh_items (name, code, category_id, building, floor, location, description, notes, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [name.trim(), code, category_id || null, building, floor, location, description, notes, data || {}]);

    await audit.log(req, AUDIT_ACTIONS.CREATED, { entityType: 'item', entityId: rows[0].id, details: { name } });
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("[Datahub] Create item error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Update item
app.put("/api/datahub/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, category_id, building, floor, location, description, notes, data } = req.body;

    const { rows } = await pool.query(`
      UPDATE dh_items
         SET name = COALESCE($1, name),
             code = COALESCE($2, code),
             category_id = $3,
             building = COALESCE($4, building),
             floor = COALESCE($5, floor),
             location = COALESCE($6, location),
             description = COALESCE($7, description),
             notes = COALESCE($8, notes),
             data = COALESCE($9, data),
             updated_at = now()
       WHERE id = $10
       RETURNING *
    `, [name, code, category_id, building, floor, location, description, notes, data, id]);

    if (rows.length === 0) return res.status(404).json({ ok: false, error: "Item not found" });

    await audit.log(req, AUDIT_ACTIONS.UPDATED, { entityType: 'item', entityId: id, details: { name } });
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("[Datahub] Update item error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Delete item
app.delete("/api/datahub/items/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Delete associated files from disk
    const { rows: files } = await pool.query(`SELECT filepath FROM dh_files WHERE item_id = $1`, [id]);
    for (const f of files) {
      try { await fsp.unlink(f.filepath); } catch {}
    }

    const { rowCount } = await pool.query(`DELETE FROM dh_items WHERE id = $1`, [id]);
    if (rowCount === 0) return res.status(404).json({ ok: false, error: "Item not found" });

    await audit.log(req, AUDIT_ACTIONS.DELETED, { entityType: 'item', entityId: id });
    res.json({ ok: true });
  } catch (e) {
    console.error("[Datahub] Delete item error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// PHOTO UPLOAD
// ====================
app.post("/api/datahub/items/:id/photo", uploadAny.single("photo"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ ok: false, error: "No file" });

    // Read file content into buffer
    const buf = await fsp.readFile(req.file.path);

    // Insert into dh_files with content (kind = 'photo')
    const { rows: ins } = await pool.query(`
      INSERT INTO dh_files (item_id, filename, filepath, mimetype, size_bytes, content, kind)
      VALUES ($1, $2, $3, $4, $5, $6, 'photo')
      RETURNING id
    `, [id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, buf]);

    const fileId = ins[0].id;

    // Update item with photo reference
    await pool.query(`UPDATE dh_items SET photo_path = $1, photo_file_id = $2, updated_at = now() WHERE id = $3`,
      [req.file.path, fileId, id]);

    // Clean up temp file (optional, DB has the content now)
    try { await fsp.unlink(req.file.path); } catch {}

    await audit.log(req, AUDIT_ACTIONS.PHOTO_UPDATED, { entityType: 'item', entityId: id });
    res.json({ ok: true, photo_file_id: fileId });
  } catch (e) {
    console.error("[Datahub] Photo upload error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get photo
app.get("/api/datahub/items/:id/photo", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT photo_path, photo_file_id FROM dh_items WHERE id = $1`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Item not found" });
    }

    const row = rows[0];

    // Try DB first (photo_file_id)
    if (row.photo_file_id) {
      const { rows: frows } = await pool.query(
        `SELECT mimetype, content FROM dh_files WHERE id = $1`,
        [row.photo_file_id]
      );
      const f = frows[0];
      if (f?.content) {
        res.setHeader("Content-Type", f.mimetype || "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.end(f.content, "binary");
      }
    }

    // Fallback to disk
    if (row.photo_path && fs.existsSync(row.photo_path)) {
      res.setHeader("Content-Type", "image/jpeg");
      return res.sendFile(row.photo_path, { root: "/" });
    }

    return res.status(404).json({ ok: false, error: "No photo" });
  } catch (e) {
    console.error("[Datahub] Get photo error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// FILES
// ====================
app.get("/api/datahub/items/:id/files", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT id, item_id, filename, filepath, mimetype, size_bytes, created_at
      FROM dh_files WHERE item_id = $1 AND (kind IS NULL OR kind = 'file')
      ORDER BY created_at DESC
    `, [id]);
    res.json({ ok: true, files: rows });
  } catch (e) {
    console.error("[Datahub] List files error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/datahub/items/:id/files", uploadAny.single("file"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ ok: false, error: "No file" });

    // Read file content into buffer
    const buf = await fsp.readFile(req.file.path);

    const { rows } = await pool.query(`
      INSERT INTO dh_files (item_id, filename, filepath, mimetype, size_bytes, content)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, item_id, filename, filepath, mimetype, size_bytes, created_at
    `, [id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, buf]);

    // Clean up temp file
    try { await fsp.unlink(req.file.path); } catch {}

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error("[Datahub] Upload file error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Download file
app.get("/api/datahub/files/:id/download", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT filename, filepath, mimetype, content FROM dh_files WHERE id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "File not found" });

    const file = rows[0];
    res.setHeader("Content-Type", file.mimetype || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);

    // Try DB content first
    if (file.content) {
      return res.end(file.content, "binary");
    }

    // Fallback to disk
    if (file.filepath && fs.existsSync(file.filepath)) {
      return res.sendFile(file.filepath, { root: "/" });
    }

    return res.status(404).json({ ok: false, error: "File content not found" });
  } catch (e) {
    console.error("[Datahub] Download file error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/datahub/files/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`DELETE FROM dh_files WHERE id = $1 RETURNING filepath`, [id]);

    if (rows.length > 0 && rows[0].filepath) {
      try { await fsp.unlink(rows[0].filepath); } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[Datahub] Delete file error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// MAPS - Use VSD plans (GET positions, SET position)
// ====================

// Get plans from VSD tables directly (same as GLO - symbiosis pattern)
app.get("/api/datahub/maps/plans", async (_req, res) => {
  try {
    // Query VSD plans directly from shared database (vsd_plans, vsd_plan_names)
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
    console.error("[Datahub] List plans error:", e);
    res.json({ ok: true, plans: [] });
  }
});

// Get plan file from VSD tables directly (same as GLO - symbiosis pattern)
app.get("/api/datahub/maps/plan/:id/file", async (req, res) => {
  try {
    const { id } = req.params;

    // Try by id first, then by logical_name - direct query to vsd_plans table
    let q = `SELECT file_path, content, filename FROM vsd_plans WHERE `;
    let val;

    // Check if id looks like a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (isUuid) {
      q += `id=$1`;
      val = id;
    } else {
      q += `logical_name=$1 ORDER BY version DESC LIMIT 1`;
      val = id;
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
      return res.sendFile(file_path);
    }

    res.status(404).json({ ok: false, error: "Plan file not found" });
  } catch (e) {
    console.error("[Datahub] Get plan file error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get positions for a plan
app.get("/api/datahub/maps/positions", async (req, res) => {
  try {
    const { logical_name, id, page_index = 0 } = req.query;
    const planKey = logical_name || id;
    if (!planKey) return res.status(400).json({ ok: false, error: "logical_name or id required" });

    const { rows } = await pool.query(`
      SELECT p.*, i.name as item_name, i.code as item_code,
             c.name as category_name, c.color as category_color, c.icon as category_icon, c.marker_size
        FROM dh_positions p
        JOIN dh_items i ON i.id = p.item_id
        LEFT JOIN dh_categories c ON c.id = i.category_id
       WHERE p.logical_name = $1 AND p.page_index = $2
    `, [planKey, parseInt(page_index)]);

    res.json({ ok: true, positions: rows });
  } catch (e) {
    console.error("[Datahub] Get positions error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Set/update position
// This ensures item is only on ONE plan at a time (deletes ALL old positions first)
app.put("/api/datahub/maps/positions/:item_id", async (req, res) => {
  try {
    const { item_id } = req.params;
    const { logical_name, page_index = 0, x_frac, y_frac } = req.body;

    if (!logical_name || x_frac === undefined || y_frac === undefined) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // CRITICAL: Delete ALL existing positions for this item
    // This ensures the item is NEVER on multiple plans
    const deleteResult = await pool.query(
      `DELETE FROM dh_positions WHERE item_id = $1`,
      [item_id]
    );
    console.log(`[Datahub] Deleted ${deleteResult.rowCount} old positions for item ${item_id}`);

    // Then insert the new position
    const { rows } = await pool.query(`
      INSERT INTO dh_positions (item_id, logical_name, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [item_id, logical_name, parseInt(page_index), x_frac, y_frac]);

    console.log(`[Datahub] Created new position for item ${item_id} on plan ${logical_name}`);
    await audit.log(req, AUDIT_ACTIONS.POSITION_SET, { entityType: 'position', entityId: item_id, details: { logical_name, x_frac, y_frac } });
    res.json({ ok: true, position: rows[0] });
  } catch (e) {
    console.error("[Datahub] Set position error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cleanup duplicate positions
app.post("/api/datahub/maps/cleanup-duplicates", async (req, res) => {
  try {
    const { rows: duplicates } = await pool.query(`
      SELECT item_id, COUNT(*) as count
      FROM dh_positions
      GROUP BY item_id
      HAVING COUNT(*) > 1
    `);

    console.log(`[Datahub] Found ${duplicates.length} items with duplicate positions`);

    let totalRemoved = 0;
    for (const dup of duplicates) {
      const result = await pool.query(`
        DELETE FROM dh_positions
        WHERE item_id = $1
        AND id NOT IN (
          SELECT id FROM dh_positions
          WHERE item_id = $1
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        )
      `, [dup.item_id]);
      totalRemoved += result.rowCount;
    }

    res.json({ ok: true, duplicates_found: duplicates.length, positions_removed: totalRemoved });
  } catch (e) {
    console.error("[Datahub] Cleanup error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Delete position
app.delete("/api/datahub/maps/positions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM dh_positions WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[Datahub] Delete position error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get all placed item IDs
app.get("/api/datahub/maps/placed-ids", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT p.item_id,
             array_agg(DISTINCT p.logical_name) as plans
        FROM dh_positions p
        JOIN dh_items i ON i.id = p.item_id
       GROUP BY p.item_id
    `);

    const placed_ids = rows.map(r => r.item_id);
    const placed_details = {};
    rows.forEach(r => {
      placed_details[r.item_id] = { plans: r.plans || [] };
    });

    res.json({ ok: true, placed_ids, placed_details });
  } catch (e) {
    console.error("[Datahub] Get placed IDs error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// EXTERNAL EQUIPMENT POSITIONS - Aggregate all equipment types on the same plan
// ====================

// Get all external equipment positions for a given plan
// This allows Datahub to display VSD, HV, MECA, GLO, Mobile Equipment, Switchboards markers
app.get("/api/datahub/maps/external-positions", async (req, res) => {
  try {
    const { logical_name, page_index = 0 } = req.query;
    if (!logical_name) return res.status(400).json({ ok: false, error: "logical_name required" });

    const pageIdx = parseInt(page_index);
    const result = {
      vsd: [],
      hv: [],
      meca: [],
      glo: [],
      mobile: [],
      switchboards: []
    };

    // VSD Equipments
    try {
      const { rows } = await pool.query(`
        SELECT p.id, p.equipment_id, p.x_frac, p.y_frac, p.page_index,
               e.name, e.tag, e.building, e.floor, e.manufacturer, e.model, e.power_kw
          FROM vsd_positions p
          JOIN vsd_equipments e ON e.id = p.equipment_id
         WHERE p.logical_name = $1 AND p.page_index = $2
      `, [logical_name, pageIdx]);
      result.vsd = rows.map(r => ({
        id: r.id,
        equipment_id: r.equipment_id,
        x_frac: parseFloat(r.x_frac),
        y_frac: parseFloat(r.y_frac),
        name: r.name || r.tag || 'VSD',
        building: r.building,
        floor: r.floor,
        details: `${r.manufacturer || ''} ${r.model || ''} ${r.power_kw ? r.power_kw + 'kW' : ''}`.trim()
      }));
    } catch (e) { console.log('[Datahub] VSD positions not available:', e.message); }

    // HV Equipments (integer equipment_id)
    try {
      const { rows } = await pool.query(`
        SELECT p.id, p.equipment_id, p.x_frac, p.y_frac, p.page_index,
               e.name, e.code, e.building_code, e.floor
          FROM hv_positions p
          JOIN hv_equipments e ON e.id = p.equipment_id
         WHERE p.logical_name = $1 AND p.page_index = $2
      `, [logical_name, pageIdx]);
      result.hv = rows.map(r => ({
        id: r.id,
        equipment_id: r.equipment_id,
        x_frac: parseFloat(r.x_frac),
        y_frac: parseFloat(r.y_frac),
        name: r.name || r.code || 'HV',
        building: r.building_code,
        floor: r.floor,
        details: r.code || ''
      }));
    } catch (e) { console.log('[Datahub] HV positions not available:', e.message); }

    // MECA Equipments
    try {
      const { rows } = await pool.query(`
        SELECT p.id, p.equipment_id, p.x_frac, p.y_frac, p.page_index,
               e.name, e.tag, e.building, e.floor, e.equipment_type, e.power_kw
          FROM meca_positions p
          JOIN meca_equipments e ON e.id = p.equipment_id
         WHERE p.logical_name = $1 AND p.page_index = $2
      `, [logical_name, pageIdx]);
      result.meca = rows.map(r => ({
        id: r.id,
        equipment_id: r.equipment_id,
        x_frac: parseFloat(r.x_frac),
        y_frac: parseFloat(r.y_frac),
        name: r.name || r.tag || 'MECA',
        building: r.building,
        floor: r.floor,
        details: `${r.equipment_type || ''} ${r.power_kw ? r.power_kw + 'kW' : ''}`.trim()
      }));
    } catch (e) { console.log('[Datahub] MECA positions not available:', e.message); }

    // GLO Equipments
    try {
      const { rows } = await pool.query(`
        SELECT p.id, p.equipment_id, p.x_frac, p.y_frac, p.page_index,
               e.name, e.tag, e.building, e.floor, e.equipment_type, e.power_kva
          FROM glo_positions p
          JOIN glo_equipments e ON e.id = p.equipment_id
         WHERE p.logical_name = $1 AND p.page_index = $2
      `, [logical_name, pageIdx]);
      result.glo = rows.map(r => ({
        id: r.id,
        equipment_id: r.equipment_id,
        x_frac: parseFloat(r.x_frac),
        y_frac: parseFloat(r.y_frac),
        name: r.name || r.tag || 'GLO',
        building: r.building,
        floor: r.floor,
        details: `${r.equipment_type || ''} ${r.power_kva ? r.power_kva + 'kVA' : ''}`.trim()
      }));
    } catch (e) { console.log('[Datahub] GLO positions not available:', e.message); }

    // Mobile Equipment (uses code instead of tag, brand/model for details)
    try {
      const { rows } = await pool.query(`
        SELECT p.id, p.equipment_id, p.x_frac, p.y_frac, p.page_index,
               e.name, e.code, e.building, e.floor, e.brand, e.model
          FROM me_equipment_positions p
          JOIN me_equipments e ON e.id = p.equipment_id
         WHERE p.plan_logical_name = $1 AND p.page_index = $2
      `, [logical_name, pageIdx]);
      result.mobile = rows.map(r => ({
        id: r.id,
        equipment_id: r.equipment_id,
        x_frac: parseFloat(r.x_frac),
        y_frac: parseFloat(r.y_frac),
        name: r.name || r.code || 'Mobile',
        building: r.building,
        floor: r.floor,
        details: `${r.brand || ''} ${r.model || ''}`.trim()
      }));
    } catch (e) { console.log('[Datahub] Mobile positions not available:', e.message); }

    // Switchboards (uses code instead of tag, building_code for building)
    try {
      const { rows } = await pool.query(`
        SELECT p.id, p.switchboard_id as equipment_id, p.x_frac, p.y_frac, p.page_index,
               s.name, s.code, s.building_code, s.floor, s.regime_neutral
          FROM switchboard_positions p
          JOIN switchboards s ON s.id = p.switchboard_id
         WHERE p.logical_name = $1 AND p.page_index = $2
      `, [logical_name, pageIdx]);
      result.switchboards = rows.map(r => ({
        id: r.id,
        equipment_id: r.equipment_id,
        x_frac: parseFloat(r.x_frac),
        y_frac: parseFloat(r.y_frac),
        name: r.name || r.code || 'Switchboard',
        building: r.building_code,
        floor: r.floor || '',
        details: r.regime_neutral || ''
      }));
    } catch (e) { console.log('[Datahub] Switchboard positions not available:', e.message); }

    // Count totals
    const totals = {
      vsd: result.vsd.length,
      hv: result.hv.length,
      meca: result.meca.length,
      glo: result.glo.length,
      mobile: result.mobile.length,
      switchboards: result.switchboards.length
    };

    res.json({ ok: true, positions: result, totals });
  } catch (e) {
    console.error("[Datahub] Get external positions error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// BULK OPERATIONS
// ====================
app.post("/api/datahub/bulk/rename", async (req, res) => {
  try {
    const { field, from, to } = req.body;
    if (!["building", "floor"].includes(field)) {
      return res.status(400).json({ ok: false, error: "Invalid field" });
    }

    const { rowCount } = await pool.query(
      `UPDATE dh_items SET ${field} = $1, updated_at = now() WHERE ${field} = $2`,
      [to, from]
    );

    await audit.log(req, AUDIT_ACTIONS.UPDATED, { entityType: 'bulk', details: { field, from, to, count: rowCount } });
    res.json({ ok: true, updated: rowCount });
  } catch (e) {
    console.error("[Datahub] Bulk rename error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// STATS
// ====================
app.get("/api/datahub/stats", async (_req, res) => {
  try {
    const { rows: totals } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM dh_items) as total_items,
        (SELECT COUNT(*) FROM dh_categories) as total_categories,
        (SELECT COUNT(DISTINCT item_id) FROM dh_positions) as placed_items
    `);

    const { rows: byCategory } = await pool.query(`
      SELECT c.id, c.name, c.color, c.icon, COUNT(i.id) as item_count
        FROM dh_categories c
        LEFT JOIN dh_items i ON i.category_id = c.id
       GROUP BY c.id, c.name, c.color, c.icon
       ORDER BY c.sort_order, c.name
    `);

    res.json({
      ok: true,
      stats: {
        ...totals[0],
        by_category: byCategory
      }
    });
  } catch (e) {
    console.error("[Datahub] Stats error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// REPORT PDF GENERATION - Professional DataHub Report
// ====================
app.get("/api/datahub/report", async (req, res) => {
  try {
    const site = req.headers["x-site"] || "Default";
    const { building, floor, category_id, search } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (building) { where += ` AND i.building = $${idx++}`; params.push(building); }
    if (floor) { where += ` AND i.floor = $${idx++}`; params.push(floor); }
    if (category_id) { where += ` AND i.category_id = $${idx++}`; params.push(category_id); }
    if (search) { where += ` AND (i.name ILIKE $${idx} OR i.code ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const { rows: items } = await pool.query(`
      SELECT i.*, c.name as category_name, c.color as category_color, c.icon as category_icon, c.marker_size
        FROM dh_items i
        LEFT JOIN dh_categories c ON c.id = i.category_id
        ${where}
       ORDER BY c.name, i.building, i.floor, i.name
    `, params);

    // Get positions for items
    const { rows: positions } = await pool.query(`
      SELECT p.*, pn.display_name as plan_display_name
        FROM dh_positions p
        LEFT JOIN vsd_plan_names pn ON pn.logical_name = p.logical_name
    `);
    const positionsMap = new Map();
    positions.forEach(p => positionsMap.set(p.item_id, p));

    // Get plans list (using VSD plans)
    const { rows: plans } = await pool.query(`
      SELECT DISTINCT ON (p.logical_name) p.*, pn.display_name
        FROM vsd_plans p
        LEFT JOIN vsd_plan_names pn ON pn.logical_name = p.logical_name
       ORDER BY p.logical_name, p.version DESC
    `);

    // Get categories
    const { rows: categories } = await pool.query(`SELECT * FROM dh_categories ORDER BY sort_order, name`);

    // Statistics
    const totalCount = items.length;

    // Group by building
    const byBuilding = {};
    items.forEach(item => {
      const b = item.building || 'Non defini';
      if (!byBuilding[b]) byBuilding[b] = [];
      byBuilding[b].push(item);
    });

    // Group by category
    const byCategory = {};
    items.forEach(item => {
      const cat = item.category_name || 'Sans categorie';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    });

    // Colors
    const colors = {
      primary: '#3B82F6',    // Blue for DataHub
      success: '#059669',
      danger: '#dc2626',
      warning: '#d97706',
      muted: '#6b7280',
      text: '#374151',
      light: '#f3f4f6'
    };

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport_datahub_${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // ========== PAGE DE COUVERTURE ==========
    doc.rect(0, 0, 595, 842).fill('#eff6ff');
    doc.rect(0, 0, 595, 180).fill(colors.primary);

    doc.fontSize(32).fillColor('#fff').text('RAPPORT DATAHUB', 50, 70, { align: 'center', width: 495 });
    doc.fontSize(14).text('Inventaire et Gestion des Donnees', 50, 115, { align: 'center', width: 495 });

    doc.fontSize(16).fillColor(colors.text).text(site, 50, 220, { align: 'center', width: 495 });
    doc.fontSize(11).fillColor(colors.muted).text(`Genere le ${new Date().toLocaleDateString('fr-FR')}`, 50, 250, { align: 'center', width: 495 });

    // Synthèse sur la couverture
    let coverY = 320;
    doc.fontSize(14).fillColor(colors.primary).text('Synthese', 50, coverY);
    coverY += 30;

    const coverStats = [
      { label: 'Total elements', value: totalCount },
      { label: 'Batiments', value: Object.keys(byBuilding).length },
      { label: 'Categories', value: categories.length },
      { label: 'Plans disponibles', value: plans.length },
      { label: 'Elements positionnes', value: positions.length },
    ];

    coverStats.forEach(stat => {
      doc.rect(50, coverY, 495, 35).fillAndStroke('#fff', '#e5e7eb');
      doc.fontSize(11).fillColor(colors.text).text(stat.label, 70, coverY + 10);
      doc.fontSize(14).fillColor(colors.primary).text(String(stat.value), 480, coverY + 10, { align: 'right', width: 50 });
      coverY += 40;
    });

    // ========== SOMMAIRE ==========
    doc.addPage();
    doc.rect(0, 0, 595, 842).fill('#fff');
    doc.fontSize(24).fillColor(colors.primary).text('Sommaire', 50, 50);
    doc.moveTo(50, 85).lineTo(545, 85).strokeColor(colors.primary).lineWidth(2).stroke();

    const sommaire = [
      { num: '1', title: 'Presentation du DataHub', page: 3 },
      { num: '2', title: 'Presentation du site', page: 3 },
      { num: '3', title: 'Categories d\'elements', page: 4 },
      { num: '4', title: 'Liste des plans', page: 4 },
      { num: '5', title: 'Inventaire par batiment', page: 5 },
      { num: '6', title: 'Inventaire par categorie', page: 6 },
      { num: '7', title: 'Fiches elements', page: 7 },
    ];

    let somY = 110;
    sommaire.forEach(item => {
      doc.fontSize(12).fillColor(colors.text).text(`${item.num}. ${item.title}`, 70, somY);
      doc.fillColor(colors.muted).text(`.....................................................`, 280, somY, { width: 200 });
      doc.fillColor(colors.primary).text(String(item.page), 500, somY, { align: 'right', width: 30 });
      somY += 28;
    });

    // ========== 1. PRÉSENTATION DU DATAHUB ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('1. Presentation du DataHub', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let presY = 100;
    doc.fontSize(11).fillColor(colors.text)
       .text('Le DataHub est un systeme centralise de gestion des donnees techniques permettant:', 50, presY, { width: 495 });
    presY += 35;

    const features = [
      'Inventorier tous les elements techniques du site',
      'Categoriser les elements avec des marqueurs personnalises',
      'Localiser les elements sur les plans du site',
      'Gerer les informations et documents associes',
      'Faciliter la recherche et le suivi des donnees',
    ];

    features.forEach(feat => {
      doc.fontSize(10).fillColor(colors.text).text(`- ${feat}`, 70, presY, { width: 475 });
      presY += 18;
    });

    // ========== 2. PRÉSENTATION DU SITE ==========
    presY += 30;
    doc.fontSize(20).fillColor(colors.primary).text('2. Presentation du site', 50, presY);
    doc.moveTo(50, presY + 30).lineTo(545, presY + 30).strokeColor(colors.primary).lineWidth(1).stroke();
    presY += 50;

    doc.fontSize(11).fillColor(colors.text).text(`Site: ${site}`, 50, presY);
    presY += 20;
    doc.text(`Nombre de batiments: ${Object.keys(byBuilding).length}`, 50, presY);
    presY += 20;
    doc.text(`Total elements: ${totalCount}`, 50, presY);
    presY += 20;
    doc.text(`Categories definies: ${categories.length}`, 50, presY);
    presY += 20;
    doc.text(`Plans disponibles: ${plans.length}`, 50, presY);

    // ========== 3. CATÉGORIES D'ÉLÉMENTS ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('3. Categories d\'elements', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let catY = 100;
    if (categories.length === 0) {
      doc.fontSize(11).fillColor(colors.muted).text('Aucune categorie definie.', 50, catY);
    } else {
      doc.fontSize(11).fillColor(colors.text).text(`${categories.length} categorie(s) definies pour organiser les elements.`, 50, catY);
      catY += 30;

      const catHeaders = ['Categorie', 'Description', 'Couleur', 'Nb Elements'];
      const catColW = [140, 220, 70, 65];
      let x = 50;
      catHeaders.forEach((h, i) => {
        doc.rect(x, catY, catColW[i], 22).fillAndStroke(colors.primary, colors.primary);
        doc.fontSize(9).fillColor('#fff').text(h, x + 5, catY + 6, { width: catColW[i] - 10 });
        x += catColW[i];
      });
      catY += 22;

      categories.forEach(cat => {
        if (catY > 750) { doc.addPage(); catY = 50; }
        const count = byCategory[cat.name]?.length || 0;
        x = 50;
        doc.rect(x, catY, catColW[0], 20).fillAndStroke('#fff', '#e5e7eb');
        doc.fontSize(8).fillColor(colors.text).text((cat.name || '-').substring(0, 28), x + 5, catY + 5, { width: catColW[0] - 10 });
        x += catColW[0];

        doc.rect(x, catY, catColW[1], 20).fillAndStroke('#fff', '#e5e7eb');
        doc.fontSize(8).fillColor(colors.text).text((cat.description || '-').substring(0, 45), x + 5, catY + 5, { width: catColW[1] - 10 });
        x += catColW[1];

        // Color swatch
        doc.rect(x, catY, catColW[2], 20).fillAndStroke('#fff', '#e5e7eb');
        doc.rect(x + 20, catY + 4, 30, 12).fill(cat.color || colors.primary);
        x += catColW[2];

        doc.rect(x, catY, catColW[3], 20).fillAndStroke('#fff', '#e5e7eb');
        doc.fontSize(8).fillColor(colors.text).text(String(count), x + 5, catY + 5, { width: catColW[3] - 10, align: 'center' });
        catY += 20;
      });
    }

    // ========== 4. LISTE DES PLANS ==========
    catY += 30;
    if (catY > 600) { doc.addPage(); catY = 50; }
    doc.fontSize(20).fillColor(colors.primary).text('4. Liste des plans', 50, catY);
    doc.moveTo(50, catY + 30).lineTo(545, catY + 30).strokeColor(colors.primary).lineWidth(1).stroke();
    catY += 50;

    if (plans.length === 0) {
      doc.fontSize(11).fillColor(colors.muted).text('Aucun plan disponible. Les plans VSD peuvent etre utilises pour positionner les elements.', 50, catY, { width: 495 });
    } else {
      doc.fontSize(9).fillColor(colors.muted)
         .text('Les plans utilises sont ceux du module VSD. Les elements peuvent etre positionnes sur ces plans.', 50, catY, { width: 495 });
      catY += 25;

      plans.forEach((p, idx) => {
        if (catY > 750) { doc.addPage(); catY = 50; }
        doc.rect(50, catY, 495, 25).fillAndStroke(idx % 2 === 0 ? colors.light : '#fff', '#e5e7eb');
        doc.fontSize(9).fillColor(colors.text)
           .text(`${idx + 1}. ${p.display_name || p.logical_name}`, 60, catY + 7);
        catY += 25;
      });
    }

    // ========== 5. INVENTAIRE PAR BÂTIMENT ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('5. Inventaire par batiment', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let invY = 100;
    doc.fontSize(11).fillColor(colors.text).text(`${totalCount} element(s) inventorie(s) sur ${Object.keys(byBuilding).length} batiment(s).`, 50, invY);
    invY += 35;

    const invHeaders = ['Batiment', 'Etage', 'Nb Elements', 'Positionnes'];
    const invColW = [170, 120, 100, 105];
    let x = 50;
    invHeaders.forEach((h, i) => {
      doc.rect(x, invY, invColW[i], 22).fillAndStroke(colors.primary, colors.primary);
      doc.fontSize(9).fillColor('#fff').text(h, x + 5, invY + 6, { width: invColW[i] - 10 });
      x += invColW[i];
    });
    invY += 22;

    Object.entries(byBuilding).forEach(([bat, batItems]) => {
      const byFloor = {};
      batItems.forEach(item => {
        const f = item.floor || '-';
        if (!byFloor[f]) byFloor[f] = [];
        byFloor[f].push(item);
      });

      Object.entries(byFloor).forEach(([flr, flrItems]) => {
        if (invY > 750) {
          doc.addPage();
          invY = 50;
          x = 50;
          invHeaders.forEach((h, i) => {
            doc.rect(x, invY, invColW[i], 22).fillAndStroke(colors.primary, colors.primary);
            doc.fontSize(9).fillColor('#fff').text(h, x + 5, invY + 6, { width: invColW[i] - 10 });
            x += invColW[i];
          });
          invY += 22;
        }
        const positioned = flrItems.filter(it => positionsMap.has(it.id)).length;
        const row = [bat.substring(0, 30), flr.substring(0, 20), flrItems.length, positioned];
        x = 50;
        row.forEach((cell, i) => {
          doc.rect(x, invY, invColW[i], 20).fillAndStroke('#fff', '#e5e7eb');
          doc.fontSize(8).fillColor(colors.text).text(String(cell), x + 5, invY + 5, { width: invColW[i] - 10 });
          x += invColW[i];
        });
        invY += 20;
      });
    });

    // ========== 6. INVENTAIRE PAR CATÉGORIE ==========
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text('6. Inventaire par categorie', 50, 50);
    doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

    let catInvY = 100;

    Object.entries(byCategory).forEach(([catName, catItems]) => {
      if (catInvY > 650) { doc.addPage(); catInvY = 50; }

      // Category header
      const catInfo = categories.find(c => c.name === catName);
      const catColor = catInfo?.color || colors.primary;

      doc.rect(50, catInvY, 495, 30).fillAndStroke(catColor, catColor);
      doc.fontSize(12).fillColor('#fff').text(catName, 60, catInvY + 8);
      doc.fontSize(10).text(`${catItems.length} element(s)`, 450, catInvY + 10, { align: 'right', width: 80 });
      catInvY += 35;

      // List items in this category (max 10 per category to avoid too long report)
      const displayItems = catItems.slice(0, 10);
      displayItems.forEach((item, idx) => {
        if (catInvY > 750) { doc.addPage(); catInvY = 50; }
        doc.rect(50, catInvY, 495, 20).fillAndStroke(idx % 2 === 0 ? colors.light : '#fff', '#e5e7eb');
        doc.fontSize(8).fillColor(colors.text)
           .text(`${item.name || '-'}`, 60, catInvY + 5, { width: 200 });
        doc.fillColor(colors.muted)
           .text(`${item.code || '-'}`, 270, catInvY + 5, { width: 100 })
           .text(`${item.building || '-'} / ${item.floor || '-'}`, 380, catInvY + 5, { width: 150 });
        catInvY += 20;
      });

      if (catItems.length > 10) {
        doc.fontSize(8).fillColor(colors.muted).text(`... et ${catItems.length - 10} autres elements`, 60, catInvY + 5);
        catInvY += 20;
      }

      catInvY += 15;
    });

    // ========== 7. FICHES ÉLÉMENTS ==========
    if (items.length > 0) {
      doc.addPage();
      doc.fontSize(20).fillColor(colors.primary).text('7. Fiches elements', 50, 50);
      doc.moveTo(50, 80).lineTo(545, 80).strokeColor(colors.primary).lineWidth(1).stroke();

      let ficheY = 100;
      doc.fontSize(11).fillColor(colors.muted).text(`${items.length} element(s) DataHub`, 50, ficheY);
      ficheY += 30;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const position = positionsMap.get(item.id);
        const catInfo = categories.find(c => c.name === item.category_name);
        const itemColor = catInfo?.color || colors.primary;

        if (ficheY > 580) {
          doc.addPage();
          ficheY = 50;
        }

        // Card frame
        doc.rect(50, ficheY, 495, 200).stroke(colors.light);

        // Header with name
        doc.rect(50, ficheY, 495, 35).fill(itemColor);
        doc.fontSize(12).fillColor('#fff')
           .text(item.name || 'Element sans nom', 60, ficheY + 10, { width: 420 });

        let infoY = ficheY + 45;
        const infoX = 60;
        const rightColX = 330;
        const imgWidth = 90;
        const imgHeight = 90;

        // Photo placeholder on right
        doc.rect(rightColX, infoY, imgWidth, imgHeight).stroke(colors.light);
        doc.fontSize(7).fillColor(colors.muted).text('Photo element', rightColX + 18, infoY + 38);

        // Plan placeholder
        const planX = rightColX + imgWidth + 10;
        if (position) {
          doc.rect(planX, infoY, imgWidth, imgHeight).stroke(itemColor);
          doc.fontSize(7).fillColor(colors.muted)
             .text(position.plan_display_name || 'Plan', planX + 10, infoY + 38, { width: imgWidth - 20, align: 'center' });
        } else {
          doc.rect(planX, infoY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Non positionne', planX + 15, infoY + 38);
        }

        // Item info fields
        const dhInfo = [
          ['Code', item.code || '-'],
          ['Categorie', item.category_name || '-'],
          ['Batiment', item.building || '-'],
          ['Etage', item.floor || '-'],
          ['Localisation', item.location || '-'],
          ['Description', (item.description || '-').substring(0, 50)],
          ['Notes', (item.notes || '-').substring(0, 50)],
          ['Cree le', item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : '-'],
          ['Modifie le', item.updated_at ? new Date(item.updated_at).toLocaleDateString('fr-FR') : '-'],
        ];

        dhInfo.forEach(([label, value]) => {
          doc.fontSize(8).fillColor(colors.text).text(label + ':', infoX, infoY, { width: 75 });
          doc.fillColor(colors.muted).text(String(value), infoX + 77, infoY, { width: 185 });
          infoY += 14;
        });

        // Show custom data if any
        if (item.data && Object.keys(item.data).length > 0) {
          infoY += 5;
          doc.fontSize(7).fillColor(colors.primary).text('Donnees personnalisees:', infoX, infoY);
          infoY += 12;
          Object.entries(item.data).slice(0, 3).forEach(([key, val]) => {
            doc.fontSize(7).fillColor(colors.muted).text(`${key}: ${String(val).substring(0, 40)}`, infoX + 10, infoY);
            infoY += 10;
          });
        }

        ficheY += 210;
      }
    }

    // ========== PAGE NUMBERING ==========
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Rapport DataHub - ${site} - Page ${i + 1}/${range.count}`, 50, 810, { align: 'center', width: 495 });
    }

    doc.end();
    console.log(`[Datahub] Generated professional PDF with ${totalCount} items`);

  } catch (e) {
    console.error('[Datahub] Report error:', e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================
// START SERVER
// ====================
app.listen(PORT, HOST, () => {
  console.log(`[Datahub] Server running on http://${HOST}:${PORT}`);
});

export default app;
