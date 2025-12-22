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

  // Files attached to items
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dh_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID REFERENCES dh_items(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mimetype TEXT,
      size_bytes INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

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
ensureSchema();

// Create audit trail helper
const audit = createAuditTrail(pool, "datahub");

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

    await audit.log(req, AUDIT_ACTIONS.CREATE, 'category', rows[0].id, { name });
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

    await audit.log(req, AUDIT_ACTIONS.UPDATE, 'category', id, { name });
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

    await audit.log(req, AUDIT_ACTIONS.DELETE, 'category', id, {});
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

    await audit.log(req, AUDIT_ACTIONS.CREATE, 'item', rows[0].id, { name });
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

    await audit.log(req, AUDIT_ACTIONS.UPDATE, 'item', id, { name });
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

    await audit.log(req, AUDIT_ACTIONS.DELETE, 'item', id, {});
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

    // Update item photo path
    await pool.query(`UPDATE dh_items SET photo_path = $1, updated_at = now() WHERE id = $2`, [req.file.path, id]);

    await audit.log(req, AUDIT_ACTIONS.UPDATE, 'item', id, { action: 'photo_upload' });
    res.json({ ok: true, photo_path: req.file.path });
  } catch (e) {
    console.error("[Datahub] Photo upload error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get photo
app.get("/api/datahub/items/:id/photo", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT photo_path FROM dh_items WHERE id = $1`, [id]);

    if (rows.length === 0 || !rows[0].photo_path) {
      return res.status(404).json({ ok: false, error: "No photo" });
    }

    res.sendFile(rows[0].photo_path, { root: "/" });
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
      SELECT * FROM dh_files WHERE item_id = $1 ORDER BY created_at DESC
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

    const { rows } = await pool.query(`
      INSERT INTO dh_files (item_id, filename, filepath, mimetype, size_bytes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size]);

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error("[Datahub] Upload file error:", e);
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
app.put("/api/datahub/maps/positions/:item_id", async (req, res) => {
  try {
    const { item_id } = req.params;
    const { logical_name, page_index = 0, x_frac, y_frac } = req.body;

    if (!logical_name || x_frac === undefined || y_frac === undefined) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // Upsert position
    const { rows } = await pool.query(`
      INSERT INTO dh_positions (item_id, logical_name, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (item_id, logical_name, page_index)
      DO UPDATE SET x_frac = $4, y_frac = $5, updated_at = now()
      RETURNING *
    `, [item_id, logical_name, parseInt(page_index), x_frac, y_frac]);

    await audit.log(req, AUDIT_ACTIONS.UPDATE, 'position', item_id, { logical_name, x_frac, y_frac });
    res.json({ ok: true, position: rows[0] });
  } catch (e) {
    console.error("[Datahub] Set position error:", e);
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

    await audit.log(req, AUDIT_ACTIONS.UPDATE, 'bulk', null, { field, from, to, count: rowCount });
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
// REPORT PDF GENERATION
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
      SELECT i.*, c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM dh_items i
        LEFT JOIN dh_categories c ON c.id = i.category_id
        ${where}
       ORDER BY c.name, i.building, i.floor, i.name
    `, params);

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport_datahub_${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).fillColor('#3B82F6').text('RAPPORT DATAHUB', 50, 50, { align: 'center' });
    doc.fontSize(10).fillColor('#6b7280').text(`Généré le ${new Date().toLocaleDateString('fr-FR')} - Site: ${site}`, { align: 'center' });

    // Stats by category
    const byCategory = {};
    items.forEach(i => {
      const cat = i.category_name || 'Sans catégorie';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    let y = 100;
    doc.rect(50, y, 495, 40).fill('#f3f4f6');
    doc.fontSize(11).fillColor('#374151');
    doc.text(`Total: ${items.length} éléments`, 60, y + 12);

    const categories = Object.keys(byCategory);
    if (categories.length > 0) {
      let catX = 200;
      for (const cat of categories.slice(0, 3)) {
        doc.text(`${cat}: ${byCategory[cat]}`, catX, y + 12);
        catX += 100;
      }
    }

    y += 60;
    doc.fontSize(14).fillColor('#3B82F6').text('Liste des éléments', 50, y);
    y += 25;

    // Table header
    doc.rect(50, y, 495, 20).fill('#e5e7eb');
    doc.fontSize(9).fillColor('#374151');
    doc.text('Nom', 55, y + 6);
    doc.text('Code', 180, y + 6);
    doc.text('Catégorie', 260, y + 6);
    doc.text('Bâtiment', 370, y + 6);
    doc.text('Étage', 450, y + 6);
    y += 20;

    // Table rows
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (y > 750) { doc.addPage(); y = 50; }

      const bgColor = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(50, y, 495, 18).fill(bgColor);
      doc.fontSize(8).fillColor('#374151');
      doc.text((item.name || '-').substring(0, 30), 55, y + 5, { width: 120 });
      doc.text((item.code || '-').substring(0, 15), 180, y + 5, { width: 75 });
      doc.text((item.category_name || '-').substring(0, 20), 260, y + 5, { width: 105 });
      doc.text((item.building || '-').substring(0, 15), 370, y + 5, { width: 75 });
      doc.text(item.floor || '-', 450, y + 5, { width: 45 });
      y += 18;
    }

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#9ca3af').text(`Page ${i + 1} / ${pages.count}`, 50, 800, { align: 'center', width: 495 });
    }

    doc.end();
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
