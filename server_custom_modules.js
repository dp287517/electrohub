// ==============================
// server_custom_modules.js — Dynamic Custom Modules microservice (ESM)
// Port: 3200
// VERSION 1.0 - Dynamic module creation system
// Allows admins to create new equipment pages without code changes
// ==============================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import crypto from "crypto";

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

const PORT = Number(process.env.CUSTOM_MODULES_PORT || 3200);
const HOST = process.env.CUSTOM_MODULES_HOST || "0.0.0.0";

// ------------------------------
// Database
// ------------------------------
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Get site from request
function getSite(req) {
  return req.headers["x-site"] || req.query.site || "Nyon";
}

// Admin emails authorized to delete any item
const ADMIN_EMAILS = ['daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com'];

// Check if user is admin
function isAdmin(email) {
  if (!email) return false;
  return ADMIN_EMAILS.some(adminEmail => adminEmail.toLowerCase() === email.toLowerCase());
}

// Generate slug from name
function generateSlug(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ------------------------------
// Ensure Tables
// ------------------------------
async function ensureTables() {
  // Modules table - defines each custom module
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cm_modules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site TEXT NOT NULL DEFAULT 'Nyon',
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'box',
      color TEXT DEFAULT '#8b5cf6',
      description TEXT,
      agent_name TEXT,
      agent_emoji TEXT DEFAULT '📦',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(site, slug)
    )
  `);

  // Categories for each module
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cm_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_id UUID REFERENCES cm_modules(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'folder',
      color TEXT DEFAULT '#6366f1',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Items - the actual equipment/data entries
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cm_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_id UUID REFERENCES cm_modules(id) ON DELETE CASCADE,
      category_id UUID REFERENCES cm_categories(id) ON DELETE SET NULL,
      site TEXT NOT NULL DEFAULT 'Nyon',
      name TEXT NOT NULL,
      code TEXT,
      description TEXT,
      building TEXT,
      floor TEXT,
      location TEXT,
      status TEXT DEFAULT 'active',
      photo BYTEA,
      photo_mime TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT,
      updated_by TEXT
    )
  `);

  // Files attached to items
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cm_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID REFERENCES cm_items(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      data BYTEA,
      uploaded_at TIMESTAMPTZ DEFAULT NOW(),
      uploaded_by TEXT
    )
  `);

  // Positions on VSD plans
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cm_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID REFERENCES cm_items(id) ON DELETE CASCADE,
      module_id UUID REFERENCES cm_modules(id) ON DELETE CASCADE,
      plan_id UUID,
      logical_name TEXT,
      page_index INTEGER DEFAULT 0,
      x_frac DOUBLE PRECISION,
      y_frac DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Create indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cm_items_module ON cm_items(module_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cm_items_site ON cm_items(site)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cm_positions_item ON cm_positions(item_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cm_positions_plan ON cm_positions(logical_name, page_index)`);

  console.log("[CUSTOM_MODULES] Tables ensured");
}

// Initialize tables on startup
ensureTables().catch(console.error);

// ------------------------------
// Multer for file uploads
// ------------------------------
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================================
// MODULES ENDPOINTS
// ============================================================

// GET /api/custom-modules/modules - List all modules
app.get("/api/custom-modules/modules", async (req, res) => {
  const site = getSite(req);
  try {
    const result = await pool.query(
      `SELECT m.*,
        (SELECT COUNT(*) FROM cm_items WHERE module_id = m.id) as item_count,
        (SELECT COUNT(*) FROM cm_categories WHERE module_id = m.id) as category_count
       FROM cm_modules m
       WHERE m.site = $1 AND m.is_active = true
       ORDER BY m.name`,
      [site]
    );
    res.json({ modules: result.rows });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error listing modules:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/modules/all - List all modules (including inactive, for admin)
app.get("/api/custom-modules/modules/all", async (req, res) => {
  const site = getSite(req);
  try {
    const result = await pool.query(
      `SELECT m.*,
        (SELECT COUNT(*) FROM cm_items WHERE module_id = m.id) as item_count,
        (SELECT COUNT(*) FROM cm_categories WHERE module_id = m.id) as category_count
       FROM cm_modules m
       WHERE m.site = $1
       ORDER BY m.name`,
      [site]
    );
    res.json({ modules: result.rows });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error listing all modules:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/custom-modules/modules - Create a new module
app.post("/api/custom-modules/modules", async (req, res) => {
  const site = getSite(req);
  const { name, icon = "box", color = "#8b5cf6", description = "", agent_name, agent_emoji = "📦" } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  const slug = generateSlug(name);

  try {
    // Check if slug already exists
    const existing = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "A module with this name already exists" });
    }

    const result = await pool.query(
      `INSERT INTO cm_modules (site, slug, name, icon, color, description, agent_name, agent_emoji)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [site, slug, name, icon, color, description, agent_name || name, agent_emoji]
    );

    console.log(`[CUSTOM_MODULES] Created module: ${name} (${slug})`);
    res.status(201).json({ module: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error creating module:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/modules/:slug - Get module by slug
app.get("/api/custom-modules/modules/:slug", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;

  try {
    const result = await pool.query(
      `SELECT m.*,
        (SELECT COUNT(*) FROM cm_items WHERE module_id = m.id) as item_count
       FROM cm_modules m
       WHERE m.site = $1 AND m.slug = $2`,
      [site, slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    res.json({ module: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error getting module:", e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/custom-modules/modules/:slug - Update module
app.put("/api/custom-modules/modules/:slug", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;
  const { name, icon, color, description, agent_name, agent_emoji, is_active } = req.body;

  try {
    const updates = [];
    const values = [site, slug];
    let idx = 3;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (icon !== undefined) { updates.push(`icon = $${idx++}`); values.push(icon); }
    if (color !== undefined) { updates.push(`color = $${idx++}`); values.push(color); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (agent_name !== undefined) { updates.push(`agent_name = $${idx++}`); values.push(agent_name); }
    if (agent_emoji !== undefined) { updates.push(`agent_emoji = $${idx++}`); values.push(agent_emoji); }
    if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(is_active); }
    updates.push("updated_at = NOW()");

    if (updates.length === 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const result = await pool.query(
      `UPDATE cm_modules SET ${updates.join(", ")} WHERE site = $1 AND slug = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    res.json({ module: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error updating module:", e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/custom-modules/modules/:slug - Delete module
app.delete("/api/custom-modules/modules/:slug", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM cm_modules WHERE site = $1 AND slug = $2 RETURNING id, name",
      [site, slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    console.log(`[CUSTOM_MODULES] Deleted module: ${result.rows[0].name}`);
    res.json({ success: true, deleted: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error deleting module:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CATEGORIES ENDPOINTS
// ============================================================

// GET /api/custom-modules/:slug/categories
app.get("/api/custom-modules/:slug/categories", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;

  try {
    const moduleRes = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    const result = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM cm_items WHERE category_id = c.id) as item_count
       FROM cm_categories c
       WHERE c.module_id = $1
       ORDER BY c.sort_order, c.name`,
      [moduleRes.rows[0].id]
    );

    res.json({ categories: result.rows });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error listing categories:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/custom-modules/:slug/categories
app.post("/api/custom-modules/:slug/categories", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;
  const { name, icon = "folder", color = "#6366f1", sort_order = 0 } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  try {
    const moduleRes = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    const result = await pool.query(
      `INSERT INTO cm_categories (module_id, name, icon, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [moduleRes.rows[0].id, name, icon, color, sort_order]
    );

    res.status(201).json({ category: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error creating category:", e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/custom-modules/categories/:id
app.put("/api/custom-modules/categories/:id", async (req, res) => {
  const { id } = req.params;
  const { name, icon, color, sort_order } = req.body;

  try {
    const updates = [];
    const values = [id];
    let idx = 2;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (icon !== undefined) { updates.push(`icon = $${idx++}`); values.push(icon); }
    if (color !== undefined) { updates.push(`color = $${idx++}`); values.push(color); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(sort_order); }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const result = await pool.query(
      `UPDATE cm_categories SET ${updates.join(", ")} WHERE id = $1 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json({ category: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error updating category:", e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/custom-modules/categories/:id
app.delete("/api/custom-modules/categories/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM cm_categories WHERE id = $1 RETURNING id, name",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error deleting category:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ITEMS ENDPOINTS
// ============================================================

// GET /api/custom-modules/:slug/items
app.get("/api/custom-modules/:slug/items", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;

  try {
    const moduleRes = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    const result = await pool.query(
      `SELECT i.id, i.category_id, i.name, i.code, i.description, i.building, i.floor,
              i.location, i.status, i.metadata, i.created_at, i.updated_at, i.created_by,
              i.photo IS NOT NULL as has_photo,
              c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM cm_items i
       LEFT JOIN cm_categories c ON c.id = i.category_id
       WHERE i.module_id = $1 AND i.site = $2
       ORDER BY i.name`,
      [moduleRes.rows[0].id, site]
    );

    res.json({ items: result.rows });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error listing items:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/:slug/items/:id
app.get("/api/custom-modules/:slug/items/:id", async (req, res) => {
  const site = getSite(req);
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT i.id, i.module_id, i.category_id, i.site, i.name, i.code, i.description,
              i.building, i.floor, i.location, i.status, i.metadata, i.created_at,
              i.updated_at, i.created_by, i.updated_by, i.photo_mime,
              i.photo IS NOT NULL as has_photo,
              c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM cm_items i
       LEFT JOIN cm_categories c ON c.id = i.category_id
       WHERE i.id = $1 AND i.site = $2`,
      [id, site]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    // Don't send photo binary in regular response
    const item = result.rows[0];
    delete item.photo;

    res.json({ item });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error getting item:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/custom-modules/:slug/items
app.post("/api/custom-modules/:slug/items", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;
  const userEmail = req.headers["x-user-email"] || "unknown";
  const { category_id, name, code, description, building, floor, location, status = "active", metadata = {} } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  try {
    const moduleRes = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    const result = await pool.query(
      `INSERT INTO cm_items (module_id, site, category_id, name, code, description, building, floor, location, status, metadata, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       RETURNING *`,
      [moduleRes.rows[0].id, site, category_id || null, name, code, description, building, floor, location, status, JSON.stringify(metadata), userEmail]
    );

    res.status(201).json({ item: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error creating item:", e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/custom-modules/:slug/items/:id
app.put("/api/custom-modules/:slug/items/:id", async (req, res) => {
  const site = getSite(req);
  const { id } = req.params;
  const userEmail = req.headers["x-user-email"] || "unknown";
  const { category_id, name, code, description, building, floor, location, status, metadata } = req.body;

  try {
    const updates = ["updated_at = NOW()", "updated_by = $3"];
    const values = [id, site, userEmail];
    let idx = 4;

    if (category_id !== undefined) { updates.push(`category_id = $${idx++}`); values.push(category_id || null); }
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (code !== undefined) { updates.push(`code = $${idx++}`); values.push(code); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (building !== undefined) { updates.push(`building = $${idx++}`); values.push(building); }
    if (floor !== undefined) { updates.push(`floor = $${idx++}`); values.push(floor); }
    if (location !== undefined) { updates.push(`location = $${idx++}`); values.push(location); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }
    if (metadata !== undefined) { updates.push(`metadata = $${idx++}`); values.push(JSON.stringify(metadata)); }

    const result = await pool.query(
      `UPDATE cm_items SET ${updates.join(", ")} WHERE id = $1 AND site = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ item: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error updating item:", e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/custom-modules/:slug/items/:id
// Only the creator or an admin can delete
app.delete("/api/custom-modules/:slug/items/:id", async (req, res) => {
  const site = getSite(req);
  const { id } = req.params;
  const userEmail = req.headers["x-user-email"] || "";

  try {
    // Get item to check ownership
    const itemRes = await pool.query(
      "SELECT id, name, created_by FROM cm_items WHERE id = $1 AND site = $2",
      [id, site]
    );

    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    const item = itemRes.rows[0];
    const isCreator = item.created_by &&
                      item.created_by.toLowerCase() === userEmail.toLowerCase();
    const isUserAdmin = isAdmin(userEmail);

    // Check permissions - allow if creator or admin only
    if (!isCreator && !isUserAdmin) {
      console.log(`[CUSTOM_MODULES] Delete denied - user: ${userEmail}, creator: ${item.created_by}`);
      return res.status(403).json({
        error: 'Vous n\'êtes pas autorisé à supprimer cet élément. Seul le créateur ou un administrateur peut le supprimer.',
        canDelete: false
      });
    }

    await pool.query(
      "DELETE FROM cm_items WHERE id = $1 AND site = $2",
      [id, site]
    );

    console.log(`[CUSTOM_MODULES] Item ${id} deleted by ${userEmail} (admin: ${isUserAdmin}, creator: ${isCreator})`);
    res.json({ success: true, deleted: { id: item.id, name: item.name } });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error deleting item:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// PHOTO ENDPOINTS
// ============================================================

// POST /api/custom-modules/:slug/items/:id/photo
app.post("/api/custom-modules/:slug/items/:id/photo", upload.single("photo"), async (req, res) => {
  const site = getSite(req);
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: "No photo uploaded" });
  }

  try {
    const result = await pool.query(
      `UPDATE cm_items SET photo = $1, photo_mime = $2, updated_at = NOW()
       WHERE id = $3 AND site = $4 RETURNING id`,
      [req.file.buffer, req.file.mimetype, id, site]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error uploading photo:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/:slug/items/:id/photo
app.get("/api/custom-modules/:slug/items/:id/photo", async (req, res) => {
  const site = getSite(req);
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT photo, photo_mime FROM cm_items WHERE id = $1 AND site = $2",
      [id, site]
    );

    if (result.rows.length === 0 || !result.rows[0].photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    res.set("Content-Type", result.rows[0].photo_mime || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(result.rows[0].photo);
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error getting photo:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// FILES ENDPOINTS
// ============================================================

// GET /api/custom-modules/:slug/items/:id/files
app.get("/api/custom-modules/:slug/items/:id/files", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, filename, mime_type, size_bytes, uploaded_at, uploaded_by
       FROM cm_files WHERE item_id = $1 ORDER BY uploaded_at DESC`,
      [id]
    );
    res.json({ files: result.rows });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error listing files:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/custom-modules/:slug/items/:id/files
app.post("/api/custom-modules/:slug/items/:id/files", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const userEmail = req.headers["x-user-email"] || "unknown";

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO cm_files (item_id, filename, mime_type, size_bytes, data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename, mime_type, size_bytes, uploaded_at`,
      [id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, userEmail]
    );
    res.status(201).json({ file: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error uploading file:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/files/:fileId/download
app.get("/api/custom-modules/files/:fileId/download", async (req, res) => {
  const { fileId } = req.params;

  try {
    const result = await pool.query(
      "SELECT filename, mime_type, data FROM cm_files WHERE id = $1",
      [fileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    const { filename, mime_type, data } = result.rows[0];
    res.set("Content-Type", mime_type || "application/octet-stream");
    res.set("Content-Disposition", `inline; filename="${filename}"`);
    res.send(data);
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error downloading file:", e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/custom-modules/files/:fileId
app.delete("/api/custom-modules/files/:fileId", async (req, res) => {
  const { fileId } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM cm_files WHERE id = $1 RETURNING id, filename",
      [fileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error deleting file:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// MAP POSITIONS ENDPOINTS
// ============================================================

// GET /api/custom-modules/:slug/maps/plans - Get VSD plans (reuse from VSD)
app.get("/api/custom-modules/:slug/maps/plans", async (req, res) => {
  const site = getSite(req);

  try {
    const result = await pool.query(
      `SELECT id, logical_name, display_name, file_size, total_pages, created_at
       FROM vsd_plans WHERE site = $1 ORDER BY logical_name`,
      [site]
    );
    res.json({ plans: result.rows });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error listing plans:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/:slug/maps/plan/:key/file - Get plan PDF file
app.get("/api/custom-modules/:slug/maps/plan/:key/file", async (req, res) => {
  const site = getSite(req);
  const { key } = req.params;

  try {
    const result = await pool.query(
      `SELECT file_data, mime_type FROM vsd_plans
       WHERE site = $1 AND (id::text = $2 OR logical_name = $2)`,
      [site, key]
    );

    if (result.rows.length === 0 || !result.rows[0].file_data) {
      return res.status(404).json({ error: "Plan not found" });
    }

    res.set("Content-Type", result.rows[0].mime_type || "application/pdf");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(result.rows[0].file_data);
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error getting plan file:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/:slug/maps/positions - Get positions for a plan
app.get("/api/custom-modules/:slug/maps/positions", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;
  const { logical_name, id: planId, page_index = 0 } = req.query;

  try {
    const moduleRes = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    let planCondition = "";
    const values = [moduleRes.rows[0].id, Number(page_index)];

    if (logical_name) {
      planCondition = "AND p.logical_name = $3";
      values.push(logical_name);
    } else if (planId) {
      planCondition = "AND p.plan_id = $3";
      values.push(planId);
    }

    const result = await pool.query(
      `SELECT p.id as position_id, p.item_id, p.x_frac, p.y_frac, p.page_index,
              p.logical_name, p.plan_id,
              i.name, i.code, i.category_id, i.created_by,
              c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM cm_positions p
       JOIN cm_items i ON i.id = p.item_id
       LEFT JOIN cm_categories c ON c.id = i.category_id
       WHERE p.module_id = $1 AND p.page_index = $2 ${planCondition}`,
      values
    );

    res.json({ positions: result.rows });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error getting positions:", e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/custom-modules/:slug/maps/positions/:itemId - Set item position
app.put("/api/custom-modules/:slug/maps/positions/:itemId", async (req, res) => {
  const site = getSite(req);
  const { slug, itemId } = req.params;
  const { logical_name, plan_id, page_index = 0, x_frac, y_frac } = req.body;

  try {
    const moduleRes = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    // Upsert position
    const result = await pool.query(
      `INSERT INTO cm_positions (item_id, module_id, logical_name, plan_id, page_index, x_frac, y_frac)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (item_id) WHERE item_id IS NOT NULL
       DO UPDATE SET logical_name = $3, plan_id = $4, page_index = $5, x_frac = $6, y_frac = $7
       RETURNING *`,
      [itemId, moduleRes.rows[0].id, logical_name, plan_id, page_index, x_frac, y_frac]
    );

    // If no conflict, might need to delete old and insert new
    if (result.rows.length === 0) {
      await pool.query("DELETE FROM cm_positions WHERE item_id = $1", [itemId]);
      const insertRes = await pool.query(
        `INSERT INTO cm_positions (item_id, module_id, logical_name, plan_id, page_index, x_frac, y_frac)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [itemId, moduleRes.rows[0].id, logical_name, plan_id, page_index, x_frac, y_frac]
      );
      return res.json({ position: insertRes.rows[0] });
    }

    res.json({ position: result.rows[0] });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error setting position:", e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/custom-modules/:slug/maps/positions/:positionId
app.delete("/api/custom-modules/:slug/maps/positions/:positionId", async (req, res) => {
  const { positionId } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM cm_positions WHERE id = $1 RETURNING id",
      [positionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Position not found" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error deleting position:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custom-modules/:slug/maps/placed-ids - Get all placed item IDs
app.get("/api/custom-modules/:slug/maps/placed-ids", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;

  try {
    const moduleRes = await pool.query(
      "SELECT id FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    const result = await pool.query(
      `SELECT DISTINCT item_id, logical_name, page_index
       FROM cm_positions WHERE module_id = $1`,
      [moduleRes.rows[0].id]
    );

    const placed_ids = result.rows.map(r => String(r.item_id));
    const placed_details = {};
    result.rows.forEach(r => {
      placed_details[String(r.item_id)] = {
        plans: [r.logical_name],
        page_index: r.page_index
      };
    });

    res.json({ placed_ids, placed_details });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error getting placed IDs:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// STATS ENDPOINT
// ============================================================

app.get("/api/custom-modules/:slug/stats", async (req, res) => {
  const site = getSite(req);
  const { slug } = req.params;

  try {
    const moduleRes = await pool.query(
      "SELECT id, name FROM cm_modules WHERE site = $1 AND slug = $2",
      [site, slug]
    );
    if (moduleRes.rows.length === 0) {
      return res.status(404).json({ error: "Module not found" });
    }

    const moduleId = moduleRes.rows[0].id;

    const [itemsRes, categoriesRes, placedRes] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM cm_items WHERE module_id = $1", [moduleId]),
      pool.query("SELECT COUNT(*) FROM cm_categories WHERE module_id = $1", [moduleId]),
      pool.query("SELECT COUNT(DISTINCT item_id) FROM cm_positions WHERE module_id = $1", [moduleId])
    ]);

    res.json({
      module_name: moduleRes.rows[0].name,
      total_items: parseInt(itemsRes.rows[0].count),
      total_categories: parseInt(categoriesRes.rows[0].count),
      placed_items: parseInt(placedRes.rows[0].count)
    });
  } catch (e) {
    console.error("[CUSTOM_MODULES] Error getting stats:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/custom-modules/health", (req, res) => {
  res.json({ status: "ok", service: "custom-modules", port: PORT });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, HOST, () => {
  console.log(`[CUSTOM_MODULES] Custom Modules service running on http://${HOST}:${PORT}`);
});
