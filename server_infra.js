// ==============================
// server_infra.js — Infrastructure Module microservice (ESM)
// Port par défaut: 3023
// Gestion des plans d'infrastructure, zones et éléments
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
import { extractTenantFromRequest, getTenantFilter, addTenantToData } from "./lib/tenant-filter.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.INFRA_PORT || 3023);
const HOST = process.env.INFRA_HOST || "0.0.0.0";

// Dossiers data
const DATA_DIR = process.env.INFRA_DATA_DIR || path.resolve(__dirname, "./_data_infra");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Multer pour upload
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DATA_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
});
const upload = multer({ storage: multerStorage, limits: { fileSize: 100 * 1024 * 1024 } });

// DB
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Helper UUID
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ============================================================
// INITIALISATION DES TABLES
// ============================================================
async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS infrastructure_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      display_name TEXT,
      building_name TEXT,
      filename TEXT,
      file_path TEXT,
      page_count INTEGER DEFAULT 1,
      content BYTEA,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS infrastructure_zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_id UUID REFERENCES infrastructure_plans(id) ON DELETE CASCADE,
      page_index INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      kind TEXT DEFAULT 'rect',
      x1 NUMERIC, y1 NUMERIC, x2 NUMERIC, y2 NUMERIC,
      cx NUMERIC, cy NUMERIC, r NUMERIC,
      points JSONB,
      color TEXT DEFAULT '#3b82f6',
      linked_atex_plans JSONB DEFAULT '[]',
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS infrastructure_elements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_id UUID REFERENCES infrastructure_plans(id) ON DELETE CASCADE,
      zone_id UUID REFERENCES infrastructure_zones(id) ON DELETE SET NULL,
      page_index INTEGER DEFAULT 0,
      element_type TEXT NOT NULL,
      name TEXT,
      reference TEXT,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      status TEXT DEFAULT 'ok',
      comment TEXT,
      company_id INTEGER,
      site_id INTEGER,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )
  `);

  // Index pour performance
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_infra_plans_site ON infrastructure_plans(site_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_infra_zones_plan ON infrastructure_zones(plan_id, page_index)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_infra_elements_plan ON infrastructure_elements(plan_id, page_index)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_infra_elements_zone ON infrastructure_elements(zone_id)`);

  console.log("[Infrastructure] Tables initialized");
}

initTables().catch(console.error);

// ============================================================
// HELPERS
// ============================================================

// Détection automatique de la zone contenant un point
async function detectZoneForPoint(plan_id, page_index, x_frac, y_frac) {
  const { rows: zones } = await pool.query(
    `SELECT * FROM infrastructure_zones WHERE plan_id = $1 AND page_index = $2`,
    [plan_id, page_index]
  );

  for (const z of zones) {
    let inside = false;

    if (z.kind === "rect" && z.x1 != null && z.y1 != null && z.x2 != null && z.y2 != null) {
      const minX = Math.min(Number(z.x1), Number(z.x2));
      const maxX = Math.max(Number(z.x1), Number(z.x2));
      const minY = Math.min(Number(z.y1), Number(z.y2));
      const maxY = Math.max(Number(z.y1), Number(z.y2));
      inside = x_frac >= minX && x_frac <= maxX && y_frac >= minY && y_frac <= maxY;
    } else if (z.kind === "circle" && z.cx != null && z.cy != null && z.r != null) {
      const dist = Math.sqrt(Math.pow(x_frac - Number(z.cx), 2) + Math.pow(y_frac - Number(z.cy), 2));
      inside = dist <= Number(z.r);
    } else if (z.kind === "poly" && z.points) {
      const pts = typeof z.points === "string" ? JSON.parse(z.points) : z.points;
      inside = pointInPolygon(x_frac, y_frac, pts);
    }

    if (inside) {
      return { zone_id: z.id, zone_name: z.name, zone_color: z.color };
    }
  }

  return null;
}

// Point dans polygone (ray casting)
function pointInPolygon(x, y, pts) {
  if (!pts || pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x ?? pts[i][0];
    const yi = pts[i].y ?? pts[i][1];
    const xj = pts[j].x ?? pts[j][0];
    const yj = pts[j].y ?? pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ============================================================
// PLANS
// ============================================================

// Liste des plans
app.get("/api/infra/plans", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant, "infrastructure_plans");

    const { rows } = await pool.query(
      `SELECT id, logical_name, display_name, building_name, filename, page_count, created_at, updated_at
       FROM infrastructure_plans
       WHERE ${filter.where}
       ORDER BY building_name, display_name`,
      filter.params
    );
    res.json({ plans: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Upload d'un plan PDF
app.post("/api/infra/plans/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "No file" });

    const { building_name, display_name, page_count = 1 } = req.body;
    const tenant = extractTenantFromRequest(req);

    // Lire le contenu du fichier
    let content = null;
    try {
      content = await fsp.readFile(file.path);
    } catch {}

    const logical_name = `infra_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const { rows } = await pool.query(
      `INSERT INTO infrastructure_plans
       (logical_name, display_name, building_name, filename, file_path, page_count, content, company_id, site_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [logical_name, display_name || file.originalname, building_name || "", file.originalname, file.path, page_count, content, tenant.company_id, tenant.site_id]
    );

    res.json({ ok: true, plan: rows[0] });
  } catch (e) {
    console.error("[Infra] Upload error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Récupérer le fichier PDF d'un plan
app.get("/api/infra/plans/file", async (req, res) => {
  try {
    const { id, logical_name } = req.query;
    let row;

    if (id && isUuid(id)) {
      const { rows } = await pool.query(
        `SELECT file_path, content, filename FROM infrastructure_plans WHERE id = $1`,
        [id]
      );
      row = rows[0];
    } else if (logical_name) {
      const { rows } = await pool.query(
        `SELECT file_path, content, filename FROM infrastructure_plans WHERE logical_name = $1`,
        [logical_name]
      );
      row = rows[0];
    }

    if (!row) return res.status(404).json({ ok: false, error: "Plan not found" });

    // Priorité au contenu binaire
    if (row.content && row.content.length) {
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `inline; filename="${row.filename || "plan.pdf"}"`);
      return res.send(row.content);
    }

    // Sinon fichier sur disque
    if (row.file_path && fs.existsSync(row.file_path)) {
      return res.sendFile(path.resolve(row.file_path));
    }

    res.status(404).json({ ok: false, error: "File not found" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Mettre à jour un plan
app.put("/api/infra/plans/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { display_name, building_name, page_count } = req.body;

    await pool.query(
      `UPDATE infrastructure_plans
       SET display_name = COALESCE($1, display_name),
           building_name = COALESCE($2, building_name),
           page_count = COALESCE($3, page_count),
           updated_at = now()
       WHERE id = $4`,
      [display_name, building_name, page_count, id]
    );

    const { rows } = await pool.query(`SELECT * FROM infrastructure_plans WHERE id = $1`, [id]);
    res.json({ ok: true, plan: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Supprimer un plan
app.delete("/api/infra/plans/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query(`DELETE FROM infrastructure_plans WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// ZONES
// ============================================================

// Liste des zones d'un plan
app.get("/api/infra/zones", async (req, res) => {
  try {
    const { plan_id, page_index = 0 } = req.query;
    if (!plan_id) return res.status(400).json({ ok: false, error: "plan_id required" });

    const { rows } = await pool.query(
      `SELECT * FROM infrastructure_zones
       WHERE plan_id = $1 AND page_index = $2
       ORDER BY name`,
      [plan_id, page_index]
    );
    res.json({ zones: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Créer une zone
app.post("/api/infra/zones", async (req, res) => {
  try {
    const { plan_id, page_index = 0, name, kind = "rect", geometry = {}, color = "#3b82f6", linked_atex_plans = [] } = req.body;
    const tenant = extractTenantFromRequest(req);

    const { rows } = await pool.query(
      `INSERT INTO infrastructure_zones
       (plan_id, page_index, name, kind, x1, y1, x2, y2, cx, cy, r, points, color, linked_atex_plans, company_id, site_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        plan_id, page_index, name, kind,
        geometry.x1, geometry.y1, geometry.x2, geometry.y2,
        geometry.cx, geometry.cy, geometry.r,
        geometry.points ? JSON.stringify(geometry.points) : null,
        color, JSON.stringify(linked_atex_plans),
        tenant.company_id, tenant.site_id
      ]
    );
    res.json({ ok: true, zone: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Mettre à jour une zone
app.put("/api/infra/zones/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { name, color, geometry, linked_atex_plans } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (color !== undefined) { updates.push(`color = $${idx++}`); values.push(color); }
    if (linked_atex_plans !== undefined) { updates.push(`linked_atex_plans = $${idx++}`); values.push(JSON.stringify(linked_atex_plans)); }
    if (geometry) {
      if (geometry.x1 !== undefined) { updates.push(`x1 = $${idx++}`); values.push(geometry.x1); }
      if (geometry.y1 !== undefined) { updates.push(`y1 = $${idx++}`); values.push(geometry.y1); }
      if (geometry.x2 !== undefined) { updates.push(`x2 = $${idx++}`); values.push(geometry.x2); }
      if (geometry.y2 !== undefined) { updates.push(`y2 = $${idx++}`); values.push(geometry.y2); }
      if (geometry.cx !== undefined) { updates.push(`cx = $${idx++}`); values.push(geometry.cx); }
      if (geometry.cy !== undefined) { updates.push(`cy = $${idx++}`); values.push(geometry.cy); }
      if (geometry.r !== undefined) { updates.push(`r = $${idx++}`); values.push(geometry.r); }
      if (geometry.points !== undefined) { updates.push(`points = $${idx++}`); values.push(JSON.stringify(geometry.points)); }
    }

    if (updates.length === 0) return res.json({ ok: true });

    values.push(id);
    await pool.query(`UPDATE infrastructure_zones SET ${updates.join(", ")} WHERE id = $${idx}`, values);

    const { rows } = await pool.query(`SELECT * FROM infrastructure_zones WHERE id = $1`, [id]);
    res.json({ ok: true, zone: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Supprimer une zone
app.delete("/api/infra/zones/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query(`DELETE FROM infrastructure_zones WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// ELEMENTS
// ============================================================

// Liste des éléments d'un plan/zone
app.get("/api/infra/elements", async (req, res) => {
  try {
    const { plan_id, zone_id, page_index, element_type } = req.query;

    let query = `SELECT e.*, z.name as zone_name, z.color as zone_color
                 FROM infrastructure_elements e
                 LEFT JOIN infrastructure_zones z ON e.zone_id = z.id
                 WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (plan_id) {
      query += ` AND e.plan_id = $${idx++}`;
      params.push(plan_id);
    }
    if (zone_id) {
      query += ` AND e.zone_id = $${idx++}`;
      params.push(zone_id);
    }
    if (page_index !== undefined && page_index !== "") {
      query += ` AND e.page_index = $${idx++}`;
      params.push(page_index);
    }
    if (element_type) {
      query += ` AND e.element_type = $${idx++}`;
      params.push(element_type);
    }

    query += ` ORDER BY e.element_type, e.name`;

    const { rows } = await pool.query(query, params);
    res.json({ elements: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Créer un élément
app.post("/api/infra/elements", async (req, res) => {
  try {
    const { plan_id, page_index = 0, element_type, name, reference, x_frac, y_frac, comment } = req.body;
    const tenant = extractTenantFromRequest(req);

    if (!plan_id || !element_type || x_frac === undefined || y_frac === undefined) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // Auto-détection de la zone
    const zoneResult = await detectZoneForPoint(plan_id, page_index, Number(x_frac), Number(y_frac));

    const { rows } = await pool.query(
      `INSERT INTO infrastructure_elements
       (plan_id, zone_id, page_index, element_type, name, reference, x_frac, y_frac, comment, company_id, site_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [plan_id, zoneResult?.zone_id || null, page_index, element_type, name || "", reference || "", x_frac, y_frac, comment || "", tenant.company_id, tenant.site_id]
    );

    const element = rows[0];
    if (zoneResult) {
      element.zone_name = zoneResult.zone_name;
      element.zone_color = zoneResult.zone_color;
    }

    res.json({ ok: true, element });
  } catch (e) {
    console.error("[Infra] Create element error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Mettre à jour la position d'un élément
app.put("/api/infra/elements/:id/position", async (req, res) => {
  try {
    const id = req.params.id;
    const { x_frac, y_frac } = req.body;

    if (x_frac === undefined || y_frac === undefined) {
      return res.status(400).json({ ok: false, error: "x_frac and y_frac required" });
    }

    // Récupérer plan_id et page_index pour détecter la zone
    const { rows: elemRows } = await pool.query(`SELECT plan_id, page_index FROM infrastructure_elements WHERE id = $1`, [id]);
    if (!elemRows[0]) return res.status(404).json({ ok: false, error: "Element not found" });

    const el = elemRows[0];
    const zoneResult = await detectZoneForPoint(el.plan_id, el.page_index, Number(x_frac), Number(y_frac));

    await pool.query(
      `UPDATE infrastructure_elements SET x_frac = $1, y_frac = $2, zone_id = $3, updated_at = now() WHERE id = $4`,
      [x_frac, y_frac, zoneResult?.zone_id || null, id]
    );

    const { rows } = await pool.query(
      `SELECT e.*, z.name as zone_name, z.color as zone_color
       FROM infrastructure_elements e
       LEFT JOIN infrastructure_zones z ON e.zone_id = z.id
       WHERE e.id = $1`,
      [id]
    );
    res.json({ ok: true, element: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Mettre à jour un élément (infos)
app.put("/api/infra/elements/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { element_type, name, reference, status, comment } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (element_type !== undefined) { updates.push(`element_type = $${idx++}`); values.push(element_type); }
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (reference !== undefined) { updates.push(`reference = $${idx++}`); values.push(reference); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }
    if (comment !== undefined) { updates.push(`comment = $${idx++}`); values.push(comment); }

    if (updates.length === 0) return res.json({ ok: true });

    updates.push(`updated_at = now()`);
    values.push(id);
    await pool.query(`UPDATE infrastructure_elements SET ${updates.join(", ")} WHERE id = $${idx}`, values);

    const { rows } = await pool.query(
      `SELECT e.*, z.name as zone_name, z.color as zone_color
       FROM infrastructure_elements e
       LEFT JOIN infrastructure_zones z ON e.zone_id = z.id
       WHERE e.id = $1`,
      [id]
    );
    res.json({ ok: true, element: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Supprimer un élément
app.delete("/api/infra/elements/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query(`DELETE FROM infrastructure_elements WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// STATISTIQUES
// ============================================================

app.get("/api/infra/stats", async (req, res) => {
  try {
    const { plan_id } = req.query;
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant, "e");

    let planFilter = "";
    const params = [...filter.params];

    if (plan_id) {
      planFilter = ` AND e.plan_id = $${params.length + 1}`;
      params.push(plan_id);
    }

    const { rows } = await pool.query(
      `SELECT
         e.element_type,
         COUNT(*) as count,
         z.name as zone_name
       FROM infrastructure_elements e
       LEFT JOIN infrastructure_zones z ON e.zone_id = z.id
       WHERE ${filter.where}
       ${planFilter}
       GROUP BY e.element_type, z.name
       ORDER BY e.element_type, z.name`,
      params
    );

    res.json({ stats: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// LISTE DES TYPES D'ELEMENTS (pour autocomplete)
// ============================================================

app.get("/api/infra/element-types", async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const filter = getTenantFilter(tenant, "infrastructure_elements");

    const { rows } = await pool.query(
      `SELECT DISTINCT element_type FROM infrastructure_elements WHERE ${filter.where} ORDER BY element_type`,
      filter.params
    );

    // Types suggérés par défaut
    const defaultTypes = [
      "Prise 16A",
      "Prise 32A",
      "Prise triphasée",
      "Éclairage",
      "Éclairage ATEX",
      "Coffret",
      "Boîte de dérivation",
      "Bouton arrêt urgence",
      "Bouton marche",
      "Interrupteur",
      "Ventilation",
      "Détecteur"
    ];

    const existingTypes = rows.map(r => r.element_type);
    const allTypes = [...new Set([...defaultTypes, ...existingTypes])].sort();

    res.json({ types: allTypes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, HOST, () => {
  console.log(`[Infrastructure] Server running on http://${HOST}:${PORT}`);
});

export default app;
