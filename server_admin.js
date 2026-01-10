// server_admin.js — API pour l'administration et gestion des utilisateurs
// VERSION 2.0 - MULTI-TENANT (Company + Site)
import express from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import multer from "multer";
import { extractTenantFromRequest, getTenantFilter, requireTenant } from "./lib/tenant-filter.js";

dotenv.config();

// Multer config pour upload d'images (stockage en mémoire)
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'), false);
    }
  }
});

// Multer config pour upload de vidéos (stockage en mémoire)
const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const validTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    if (validTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files allowed (MP4, WebM, OGG)'), false);
    }
  }
});

const router = express.Router();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// Middleware pour vérifier si l'utilisateur est admin
const ADMIN_EMAILS = ['daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com'];

// Middleware pour extraire l'utilisateur du JWT (cookie ou header Authorization)
function extractUser(req, _res, next) {
  console.log('\n========== ADMIN AUTH DEBUG ==========');
  console.log('📍 Path:', req.path);
  console.log('📍 Method:', req.method);

  // Log all cookies
  console.log('🍪 All cookies:', req.cookies);
  console.log('🍪 Cookie token exists:', !!req.cookies?.token);

  // Log Authorization header
  const authHeader = req.headers.authorization;
  console.log('🔑 Auth header exists:', !!authHeader);
  console.log('🔑 Auth header value:', authHeader ? authHeader.substring(0, 80) : 'none');

  // Si déjà défini par le middleware principal, on garde
  if (req.user) {
    console.log('✅ User already set by main middleware:', req.user.email);
    return next();
  }

  // Essayer le cookie
  let token = req.cookies?.token;
  let tokenSource = 'cookie';

  // Sinon essayer le header Authorization: Bearer <token>
  if (!token) {
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
      tokenSource = 'header';
    }
  }

  console.log('🎫 Token found:', !!token);
  console.log('🎫 Token source:', token ? tokenSource : 'none');
  console.log('🎫 Token preview:', token ? token.substring(0, 50) + '...' : 'none');

  if (token) {
    try {
      const secret = process.env.JWT_SECRET || "devsecret";
      console.log('🔐 JWT_SECRET exists:', !!process.env.JWT_SECRET);
      req.user = jwt.verify(token, secret);
      console.log('✅ Token verified! User:', req.user.email);
    } catch (e) {
      console.log('❌ Token verification failed:', e.message);
    }
  } else {
    console.log('❌ No token found in cookie or header');
  }

  console.log('👤 Final req.user:', req.user ? req.user.email : 'none');
  console.log('========================================\n');
  next();
}

// Appliquer l'extraction d'utilisateur à toutes les routes admin
router.use(extractUser);

function isAdmin(req) {
  const email = req.user?.email;
  return ADMIN_EMAILS.includes(email?.toLowerCase());
}

function adminOnly(req, res, next) {
  console.log('🛡️ adminOnly check - email:', req.user?.email, 'isAdmin:', isAdmin(req));
  if (!isAdmin(req)) {
    console.log('🚫 ACCESS DENIED - user not admin');
    return res.status(403).json({ error: "Admin access required", userEmail: req.user?.email || "none" });
  }
  console.log('✅ ACCESS GRANTED');
  next();
}

// ============================================================
// DEBUG ENDPOINT (PUBLIC - pour troubleshoot auth)
// ============================================================
router.get("/debug-auth", (req, res) => {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.token;

  res.json({
    hasAuthHeader: !!authHeader,
    authHeaderPreview: authHeader ? authHeader.substring(0, 50) + "..." : null,
    hasCookieToken: !!cookieToken,
    userFromMiddleware: req.user || null,
    adminEmails: ADMIN_EMAILS,
    isAdmin: isAdmin(req)
  });
});

// ============================================================
// DATABASE EXPLORATION (PUBLIC - pour debug temporaire)
// ============================================================

// GET /api/admin/explore/tables - Liste des tables uniquement (léger)
router.get("/explore/tables", async (req, res) => {
  try {
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = [];
    for (const row of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) FROM "${row.table_name}"`);
        tables.push({
          name: row.table_name,
          rows: parseInt(countResult.rows[0].count)
        });
      } catch (e) {
        tables.push({ name: row.table_name, rows: -1 });
      }
    }

    res.json({
      totalTables: tables.length,
      tables: tables.sort((a, b) => b.rows - a.rows)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/explore/:table - Données d'une table spécifique
router.get("/explore/:table", async (req, res) => {
  try {
    const { table } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    // Vérifier que la table existe
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    `, [table]);

    if (tableCheck.rows.length === 0) {
      return res.status(404).json({ error: "Table not found" });
    }

    // Colonnes
    const colsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);

    // Count
    const countResult = await pool.query(`SELECT COUNT(*) FROM "${table}"`);

    // Données
    const dataResult = await pool.query(`SELECT * FROM "${table}" LIMIT $1`, [limit]);

    res.json({
      table,
      rowCount: parseInt(countResult.rows[0].count),
      columns: colsResult.rows,
      data: dataResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/explore - Vue complète publique (TEMPORAIRE)
router.get("/explore", async (req, res) => {
  try {
    // Liste toutes les tables avec leur nombre de lignes
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = [];
    for (const row of tablesResult.rows) {
      try {
        // Count rows
        const countResult = await pool.query(`SELECT COUNT(*) FROM "${row.table_name}"`);
        const rowCount = parseInt(countResult.rows[0].count);

        // Get columns
        const colsResult = await pool.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position
        `, [row.table_name]);

        // Get sample data (3 rows)
        let sampleData = [];
        if (rowCount > 0) {
          const sampleResult = await pool.query(`SELECT * FROM "${row.table_name}" LIMIT 3`);
          sampleData = sampleResult.rows;
        }

        tables.push({
          name: row.table_name,
          rowCount,
          columns: colsResult.rows,
          sample: sampleData
        });
      } catch (e) {
        tables.push({ name: row.table_name, error: e.message });
      }
    }

    res.json({
      totalTables: tables.length,
      tables: tables.sort((a, b) => (b.rowCount || 0) - (a.rowCount || 0))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DATABASE EXPLORATION (PROTECTED)
// ============================================================

// GET /api/admin/tables - Liste toutes les tables
router.get("/tables", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    res.json({ tables: result.rows });
  } catch (err) {
    console.error("Error listing tables:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/table/:name - Détails d'une table (colonnes)
router.get("/table/:name", adminOnly, async (req, res) => {
  try {
    const { name } = req.params;
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [name]);
    res.json({ table: name, columns: result.rows });
  } catch (err) {
    console.error("Error getting table details:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/table/:name/data - Données d'une table (limite 100)
router.get("/table/:name/data", adminOnly, async (req, res) => {
  try {
    const { name } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    // Sécurité: vérifier que la table existe
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    `, [name]);

    if (tableCheck.rows.length === 0) {
      return res.status(404).json({ error: "Table not found" });
    }

    // Compter le total
    const countResult = await pool.query(`SELECT COUNT(*) FROM "${name}"`);
    const total = parseInt(countResult.rows[0].count);

    // Récupérer les données
    const result = await pool.query(`SELECT * FROM "${name}" LIMIT $1 OFFSET $2`, [limit, offset]);

    res.json({
      table: name,
      total,
      limit,
      offset,
      data: result.rows
    });
  } catch (err) {
    console.error("Error getting table data:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// USERS MANAGEMENT
// ============================================================

// GET /api/admin/users - Liste tous les utilisateurs
router.get("/users", adminOnly, async (req, res) => {
  try {
    // Essayer de trouver une table users
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name ILIKE '%user%' OR table_name ILIKE '%account%' OR table_name ILIKE '%member%')
    `);

    if (result.rows.length === 0) {
      return res.json({
        message: "No user table found",
        suggestedTables: [],
        users: []
      });
    }

    // Pour chaque table trouvée, récupérer les données
    const usersData = [];
    for (const row of result.rows) {
      const tableName = row.table_name;
      const data = await pool.query(`SELECT * FROM "${tableName}" LIMIT 100`);
      usersData.push({
        table: tableName,
        count: data.rows.length,
        data: data.rows
      });
    }

    res.json({ userTables: usersData });
  } catch (err) {
    console.error("Error getting users:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// COMPANIES / SITES / DEPARTMENTS - CRUD OPERATIONS
// ============================================================

// Liste des apps disponibles
const ALL_APPS = [
  'switchboards', 'obsolescence', 'selectivity', 'fault-level', 'arc-flash',
  'loopcalc', 'hv', 'diagram', 'projects', 'vsd', 'meca', 'oibt',
  'atex', 'comp-ext', 'ask-veeva', 'doors', 'dcf', 'learn_ex'
];

// --- COMPANIES ---

// GET /api/admin/companies - Liste les entreprises
router.get("/companies", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM companies ORDER BY is_internal DESC, name ASC
    `);
    res.json({ companies: result.rows });
  } catch (err) {
    // Table might not exist yet
    res.json({ companies: [], error: "Table companies not found - run migration" });
  }
});

// POST /api/admin/companies - Créer une entreprise
router.post("/companies", adminOnly, express.json(), async (req, res) => {
  try {
    const { name, country, city, is_internal } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });

    const result = await pool.query(`
      INSERT INTO companies (name, country, city, is_internal)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, country || 'Switzerland', city, is_internal || false]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/companies/:id - Modifier une entreprise
router.put("/companies/:id", adminOnly, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, country, city, is_internal } = req.body;

    const result = await pool.query(`
      UPDATE companies
      SET name = COALESCE($1, name),
          country = COALESCE($2, country),
          city = COALESCE($3, city),
          is_internal = COALESCE($4, is_internal),
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [name, country, city, is_internal, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/companies/:id - Supprimer une entreprise
router.delete("/companies/:id", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM companies WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ensure logo columns exist in companies table (auto-migration)
let logoColumnsChecked = false;
async function ensureLogoColumns() {
  if (logoColumnsChecked) return;
  try {
    const check = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'companies' AND column_name = 'logo'
    `);
    if (check.rows.length === 0) {
      console.log('[Admin] Adding logo columns to companies table...');
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo BYTEA`);
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_mime TEXT DEFAULT 'image/png'`);
      console.log('[Admin] ✅ Logo columns added successfully');
    }
    logoColumnsChecked = true;
  } catch (err) {
    console.warn('[Admin] Logo migration warning:', err.message);
  }
}

// POST /api/admin/companies/:id/logo - Upload company logo
router.post("/companies/:id/logo", adminOnly, uploadMemory.single('logo'), async (req, res) => {
  try {
    // Ensure columns exist before updating
    await ensureLogoColumns();

    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    let { buffer, mimetype } = req.file;

    // Convert image to sRGB color space to fix color rendering issues
    // Some logos have Adobe RGB or other profiles that render black as gray
    try {
      const sharp = (await import('sharp')).default;
      const processedBuffer = await sharp(buffer)
        .toColorspace('srgb')  // Convert to sRGB
        .png({ quality: 100 }) // Keep high quality as PNG
        .toBuffer();
      buffer = processedBuffer;
      mimetype = 'image/png';
      console.log('[Admin] Logo converted to sRGB PNG');
    } catch (sharpErr) {
      console.warn('[Admin] Could not process logo with sharp, using original:', sharpErr.message);
      // Continue with original buffer if sharp fails
    }

    const result = await pool.query(`
      UPDATE companies
      SET logo = $1,
          logo_mime = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING id, name
    `, [buffer, mimetype, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json({ ok: true, message: "Logo uploaded successfully", company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/companies/:id/logo - Remove company logo
router.delete("/companies/:id/logo", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE companies
      SET logo = NULL,
          logo_mime = NULL,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, name
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json({ ok: true, message: "Logo removed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SITES ---

// GET /api/admin/sites - Liste les sites (avec company info)
router.get("/sites", adminOnly, async (req, res) => {
  try {
    const { company_id } = req.query;
    let query = `
      SELECT s.*, c.name as company_name
      FROM sites s
      LEFT JOIN companies c ON s.company_id = c.id
    `;
    const params = [];

    if (company_id) {
      query += ` WHERE s.company_id = $1`;
      params.push(company_id);
    }
    query += ` ORDER BY c.name ASC, s.name ASC`;

    const result = await pool.query(query, params);
    res.json({ sites: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/sites - Créer un site
router.post("/sites", adminOnly, express.json(), async (req, res) => {
  try {
    const { code, name, company_id, city, country, address } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });
    if (!company_id) return res.status(400).json({ error: "Company ID required" });

    const result = await pool.query(`
      INSERT INTO sites (code, name, company_id, city, country, address)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [code, name, company_id, city, country || 'Switzerland', address]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: "Site already exists for this company" });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/sites/:id - Modifier un site
router.put("/sites/:id", adminOnly, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, company_id, city, country, address, is_active } = req.body;

    const result = await pool.query(`
      UPDATE sites
      SET code = COALESCE($1, code),
          name = COALESCE($2, name),
          company_id = COALESCE($3, company_id),
          city = COALESCE($4, city),
          country = COALESCE($5, country),
          address = COALESCE($6, address),
          is_active = COALESCE($7, is_active),
          updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [code, name, company_id, city, country, address, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/sites/:id - Supprimer un site
router.delete("/sites/:id", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM sites WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DEPARTMENTS ---

// GET /api/admin/departments - Liste les départements
router.get("/departments", adminOnly, async (req, res) => {
  try {
    const { company_id, site_id } = req.query;
    let query = `
      SELECT d.*, c.name as company_name, s.name as site_name
      FROM departments d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN sites s ON d.site_id = s.id
    `;
    const conditions = [];
    const params = [];

    if (company_id) {
      params.push(company_id);
      conditions.push(`d.company_id = $${params.length}`);
    }
    if (site_id) {
      params.push(site_id);
      conditions.push(`d.site_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY d.name ASC`;

    const result = await pool.query(query, params);
    res.json({ departments: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/departments - Créer un département
router.post("/departments", adminOnly, express.json(), async (req, res) => {
  try {
    const { code, name, company_id, site_id } = req.body;
    if (!code || !name) return res.status(400).json({ error: "Code and name required" });

    const result = await pool.query(`
      INSERT INTO departments (code, name, company_id, site_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [code, name, company_id, site_id]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/departments/:id - Modifier un département
router.put("/departments/:id", adminOnly, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, company_id, site_id } = req.body;

    const result = await pool.query(`
      UPDATE departments
      SET code = COALESCE($1, code),
          name = COALESCE($2, name),
          company_id = COALESCE($3, company_id),
          site_id = COALESCE($4, site_id)
      WHERE id = $5
      RETURNING *
    `, [code, name, company_id, site_id, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Department not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/departments/:id - Supprimer un département
router.delete("/departments/:id", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM departments WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// USERS MANAGEMENT - External Users (with password)
// ============================================================

// GET /api/admin/users/external - Liste les utilisateurs externes
router.get("/users/external", adminOnly, async (req, res) => {
  try {
    const { company_id } = req.query;
    let query = `
      SELECT u.id, u.email, u.name, u.site_id, u.department_id,
             u.company_id, u.allowed_apps, u.is_admin, u.role, u.origin,
             u.is_active, u.created_at, u.updated_at,
             s.name as site_name, d.name as department_name,
             c.name as company_name
      FROM users u
      LEFT JOIN sites s ON u.site_id = s.id
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN companies c ON u.company_id = c.id
    `;
    const params = [];
    if (company_id) {
      query += ` WHERE u.company_id = $1`;
      params.push(company_id);
    }
    query += ` ORDER BY u.name ASC`;

    const result = await pool.query(query, params);
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/external - Créer un utilisateur externe
router.post("/users/external", adminOnly, express.json(), async (req, res) => {
  try {
    const { email, name, password, site_id, department_id, company_id, allowed_apps, role } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: "Email, name and password required" });
    }
    if (!company_id) {
      return res.status(400).json({ error: "Company ID required" });
    }

    // Validate role
    const validRoles = ['site', 'global', 'admin', 'superadmin'];
    const userRole = validRoles.includes(role) ? role : 'site';

    // Hash password (bcrypt)
    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default || bcryptModule;
    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (email, name, password_hash, site_id, department_id, company_id, allowed_apps, role, origin)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'external')
      RETURNING id, email, name, site_id, department_id, company_id, allowed_apps, role, origin, created_at
    `, [email, name, password_hash, site_id, department_id, company_id, allowed_apps, userRole]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: "Email already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/external/:id - Modifier un utilisateur externe
router.put("/users/external/:id", adminOnly, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, site_id, department_id, company_id, allowed_apps, is_admin, role, is_active, password } = req.body;

    // Validate role if provided
    const validRoles = ['site', 'global', 'admin', 'superadmin'];
    const userRole = role && validRoles.includes(role) ? role : null;

    let query = `
      UPDATE users
      SET name = COALESCE($1, name),
          site_id = COALESCE($2, site_id),
          department_id = COALESCE($3, department_id),
          company_id = COALESCE($4, company_id),
          allowed_apps = COALESCE($5, allowed_apps),
          is_admin = COALESCE($6, is_admin),
          role = COALESCE($7, role),
          is_active = COALESCE($8, is_active),
          updated_at = NOW()
      WHERE id = $9
      RETURNING id, email, name, site_id, department_id, company_id, allowed_apps, is_admin, role, is_active, origin
    `;
    let params = [name, site_id, department_id, company_id, allowed_apps, is_admin, userRole, is_active, id];

    // Si nouveau mot de passe fourni
    if (password) {
      const bcryptModule = await import('bcryptjs');
      const bcrypt = bcryptModule.default || bcryptModule;
      const password_hash = await bcrypt.hash(password, 10);
      query = `
        UPDATE users
        SET name = COALESCE($1, name),
            site_id = COALESCE($2, site_id),
            department_id = COALESCE($3, department_id),
            company_id = COALESCE($4, company_id),
            allowed_apps = COALESCE($5, allowed_apps),
            is_admin = COALESCE($6, is_admin),
            role = COALESCE($7, role),
            is_active = COALESCE($8, is_active),
            password_hash = $9,
            updated_at = NOW()
        WHERE id = $10
        RETURNING id, email, name, site_id, department_id, company_id, allowed_apps, is_admin, role, is_active, origin
      `;
      params = [name, site_id, department_id, company_id, allowed_apps, is_admin, userRole, is_active, password_hash, id];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/external/:id - Supprimer un utilisateur externe
router.delete("/users/external/:id", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HALEON USERS - Bubble/Internal Users
// ============================================================

// GET /api/admin/users/haleon - Liste les utilisateurs Haleon (combine TOUTES les sources)
router.get("/users/haleon", adminOnly, async (req, res) => {
  try {
    const allUsers = new Map(); // Utilise Map pour dédupliquer par email
    const logs = [];
    const errors = [];

    // 1. Chercher dans haleon_users
    try {
      const haleonResult = await pool.query(`
        SELECT h.id, h.email, h.name, h.department_id, h.site_id, h.allowed_apps,
               h.is_active, h.created_at, h.updated_at,
               s.name as site_name, d.name as department_name,
               'haleon_users' as source
        FROM haleon_users h
        LEFT JOIN sites s ON h.site_id = s.id
        LEFT JOIN departments d ON h.department_id = d.id
      `);
      haleonResult.rows.forEach(u => {
        if (u.email) allUsers.set(u.email.toLowerCase(), u);
      });
      logs.push(`haleon_users: ${haleonResult.rows.length} utilisateurs`);
      console.log(`[ADMIN] haleon_users: ${haleonResult.rows.length} utilisateurs`);
    } catch (e) {
      errors.push(`haleon_users: ${e.message}`);
      console.log(`[ADMIN] haleon_users ERROR: ${e.message}`);
    }

    // 2. Chercher dans askv_users (utilisateurs Ask Veeva)
    try {
      const askvResult = await pool.query(`
        SELECT DISTINCT ON (LOWER(email))
               id, email, name, role as askv_role, sector, created_at,
               'askv_users' as source
        FROM askv_users
        WHERE email LIKE '%@haleon.com'
        ORDER BY LOWER(email), created_at DESC
      `);
      askvResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, u);
          }
        }
      });
      logs.push(`askv_users: ${askvResult.rows.length} utilisateurs`);
      console.log(`[ADMIN] askv_users: ${askvResult.rows.length} utilisateurs @haleon.com`);
    } catch (e) {
      errors.push(`askv_users: ${e.message}`);
      console.log(`[ADMIN] askv_users ERROR: ${e.message}`);
    }

    // 3. Chercher dans users (utilisateurs principaux @haleon.com - SANS password = via SSO/Bubble)
    // On exclut les utilisateurs avec password_hash car ce sont des "external users" avec login propre
    try {
      const usersResult = await pool.query(`
        SELECT u.id, u.email, u.name, u.department_id, u.site_id, u.company_id,
               u.allowed_apps, u.role, u.is_active, u.created_at, u.updated_at,
               s.name as site_name, d.name as department_name,
               'users' as source
        FROM users u
        LEFT JOIN sites s ON u.site_id = s.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.email LIKE '%@haleon.com'
          AND (u.password_hash IS NULL OR u.password_hash = '' OR u.password_hash = 'SSO_USER_NO_PASSWORD')
      `);
      usersResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, u);
          }
        }
      });
      logs.push(`users: ${usersResult.rows.length} utilisateurs @haleon.com`);
      console.log(`[ADMIN] users: ${usersResult.rows.length} utilisateurs @haleon.com`);
    } catch (e) {
      errors.push(`users: ${e.message}`);
      console.log(`[ADMIN] users ERROR: ${e.message}`);
    }

    // 4. Chercher dans askv_events (utilisateurs qui ont utilisé Ask Veeva)
    try {
      const eventsResult = await pool.query(`
        SELECT DISTINCT user_email as email, 'askv_events' as source
        FROM askv_events
        WHERE user_email LIKE '%@haleon.com'
      `);
      let newFromEvents = 0;
      eventsResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, { email: u.email, source: 'askv_events', name: null });
            newFromEvents++;
          }
        }
      });
      logs.push(`askv_events: ${eventsResult.rows.length} emails, ${newFromEvents} nouveaux`);
      console.log(`[ADMIN] askv_events: ${eventsResult.rows.length} emails uniques, ${newFromEvents} nouveaux`);
    } catch (e) {
      errors.push(`askv_events: ${e.message}`);
      console.log(`[ADMIN] askv_events ERROR: ${e.message}`);
    }

    // 5. Chercher dans atex_checks (utilisateurs qui ont fait des contrôles ATEX)
    try {
      const atexResult = await pool.query(`
        SELECT DISTINCT user_email as email, user_name as name, 'atex_checks' as source
        FROM atex_checks
        WHERE user_email LIKE '%@haleon.com'
      `);
      let newFromAtex = 0;
      atexResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, { email: u.email, name: u.name, source: 'atex_checks' });
            newFromAtex++;
          }
        }
      });
      logs.push(`atex_checks: ${atexResult.rows.length} emails, ${newFromAtex} nouveaux`);
      console.log(`[ADMIN] atex_checks: ${atexResult.rows.length} emails, ${newFromAtex} nouveaux`);
    } catch (e) {
      errors.push(`atex_checks: ${e.message}`);
      console.log(`[ADMIN] atex_checks ERROR: ${e.message}`);
    }

    // 6. Chercher dans vsd_checks (utilisateurs qui ont fait des contrôles VSD)
    try {
      const vsdResult = await pool.query(`
        SELECT DISTINCT user_email as email, user_name as name, 'vsd_checks' as source
        FROM vsd_checks
        WHERE user_email LIKE '%@haleon.com'
      `);
      let newFromVsd = 0;
      vsdResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, { email: u.email, name: u.name, source: 'vsd_checks' });
            newFromVsd++;
          }
        }
      });
      logs.push(`vsd_checks: ${vsdResult.rows.length} emails, ${newFromVsd} nouveaux`);
      console.log(`[ADMIN] vsd_checks: ${vsdResult.rows.length} emails, ${newFromVsd} nouveaux`);
    } catch (e) {
      errors.push(`vsd_checks: ${e.message}`);
      console.log(`[ADMIN] vsd_checks ERROR: ${e.message}`);
    }

    // 7. Chercher dans learn_ex_sessions (utilisateurs Learn EX)
    try {
      const learnResult = await pool.query(`
        SELECT DISTINCT user_email as email, user_name as name, 'learn_ex' as source
        FROM learn_ex_sessions
        WHERE user_email LIKE '%@haleon.com'
      `);
      let newFromLearn = 0;
      learnResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, { email: u.email, name: u.name, source: 'learn_ex' });
            newFromLearn++;
          }
        }
      });
      logs.push(`learn_ex_sessions: ${learnResult.rows.length} emails, ${newFromLearn} nouveaux`);
      console.log(`[ADMIN] learn_ex_sessions: ${learnResult.rows.length} emails, ${newFromLearn} nouveaux`);
    } catch (e) {
      errors.push(`learn_ex_sessions: ${e.message}`);
      console.log(`[ADMIN] learn_ex_sessions ERROR: ${e.message}`);
    }

    // 8. Chercher dans control_records (utilisateurs OIBT)
    try {
      const oibtResult = await pool.query(`
        SELECT DISTINCT performed_by_email as email, performed_by as name, 'oibt' as source
        FROM control_records
        WHERE performed_by_email LIKE '%@haleon.com'
      `);
      let newFromOibt = 0;
      oibtResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, { email: u.email, name: u.name, source: 'oibt' });
            newFromOibt++;
          }
        }
      });
      logs.push(`control_records (OIBT): ${oibtResult.rows.length} emails, ${newFromOibt} nouveaux`);
      console.log(`[ADMIN] control_records: ${oibtResult.rows.length} emails, ${newFromOibt} nouveaux`);
    } catch (e) {
      errors.push(`control_records: ${e.message}`);
      console.log(`[ADMIN] control_records ERROR: ${e.message}`);
    }

    // 9. Chercher dans fd_checks (Fire Doors - utilisateurs)
    try {
      const fdResult = await pool.query(`
        SELECT DISTINCT closed_by_email as email, closed_by_name as name, 'fire_doors' as source
        FROM fd_checks
        WHERE closed_by_email LIKE '%@haleon.com'
      `);
      let newFromFd = 0;
      fdResult.rows.forEach(u => {
        if (u.email) {
          const key = u.email.toLowerCase();
          if (!allUsers.has(key)) {
            allUsers.set(key, { email: u.email, name: u.name, source: 'fire_doors' });
            newFromFd++;
          }
        }
      });
      logs.push(`fd_checks (Fire Doors): ${fdResult.rows.length} emails, ${newFromFd} nouveaux`);
      console.log(`[ADMIN] fd_checks: ${fdResult.rows.length} emails, ${newFromFd} nouveaux`);
    } catch (e) {
      errors.push(`fd_checks: ${e.message}`);
      console.log(`[ADMIN] fd_checks ERROR: ${e.message}`);
    }

    const users = Array.from(allUsers.values()).sort((a, b) =>
      (a.email || '').localeCompare(b.email || '')
    );

    console.log(`[ADMIN] TOTAL: ${users.length} utilisateurs Haleon uniques`);
    console.log(`[ADMIN] Sources: ${logs.join(' | ')}`);
    if (errors.length > 0) {
      console.log(`[ADMIN] Errors: ${errors.join(' | ')}`);
    }

    res.json({ users, source: 'combined', logs, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[ADMIN] /users/haleon FATAL ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/haleon - Ajouter un utilisateur Haleon
// Les utilisateurs créés manuellement par l'admin sont automatiquement validés
router.post("/users/haleon", adminOnly, express.json(), async (req, res) => {
  try {
    const { email, name, site_id, department_id, allowed_apps } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const result = await pool.query(`
      INSERT INTO haleon_users (email, name, site_id, department_id, allowed_apps, is_validated)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      ON CONFLICT (email) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, haleon_users.name),
        site_id = COALESCE(EXCLUDED.site_id, haleon_users.site_id),
        department_id = COALESCE(EXCLUDED.department_id, haleon_users.department_id),
        allowed_apps = COALESCE(EXCLUDED.allowed_apps, haleon_users.allowed_apps),
        is_validated = TRUE,
        updated_at = NOW()
      RETURNING *
    `, [email, name, site_id || 1, department_id, allowed_apps]);

    console.log(`[ADMIN] ✅ Haleon user created/updated and validated: ${email}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/haleon/by-email - Modifier un utilisateur Haleon par EMAIL
// IMPORTANT: Cette route doit être AVANT /:id pour éviter que "by-email" soit interprété comme un ID
// Plus fiable car l'email est unique à travers toutes les tables
router.put("/users/haleon/by-email", adminOnly, express.json(), async (req, res) => {
  try {
    const { email, name, site_id, department_id, allowed_apps, is_active } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const emailLower = email.toLowerCase();
    console.log(`[ADMIN] Updating Haleon user by email: ${emailLower}`);

    let updated = false;

    // 1. Try to update users table first (validated users are here)
    try {
      const usersResult = await pool.query(`
        UPDATE users
        SET name = COALESCE($1, name),
            site_id = COALESCE($2, site_id),
            department_id = COALESCE($3, department_id),
            allowed_apps = $4,
            is_active = COALESCE($5, is_active),
            updated_at = NOW()
        WHERE LOWER(email) = $6
        RETURNING *
      `, [name, site_id, department_id, allowed_apps, is_active, emailLower]);

      if (usersResult.rows.length > 0) {
        console.log(`[ADMIN] ✅ Updated users table for ${emailLower}`);
        updated = true;
      }
    } catch (usersErr) {
      console.log(`[ADMIN] ⚠️ users table update failed: ${usersErr.message}`);
    }

    // 2. Also try to update haleon_users table
    try {
      const haleonResult = await pool.query(`
        UPDATE haleon_users
        SET name = COALESCE($1, name),
            site_id = COALESCE($2, site_id),
            department_id = COALESCE($3, department_id),
            allowed_apps = COALESCE($4, allowed_apps),
            is_active = COALESCE($5, is_active),
            updated_at = NOW()
        WHERE LOWER(email) = $6
        RETURNING *
      `, [name, site_id, department_id, allowed_apps, is_active, emailLower]);

      if (haleonResult.rows.length > 0) {
        console.log(`[ADMIN] ✅ Updated haleon_users table for ${emailLower}`);
        updated = true;
      }
    } catch (haleonErr) {
      console.log(`[ADMIN] ⚠️ haleon_users table update failed: ${haleonErr.message}`);
    }

    if (!updated) {
      return res.status(404).json({ error: "User not found in any table" });
    }

    res.json({ success: true, email: emailLower });
  } catch (err) {
    console.error(`[ADMIN] Error updating user by email:`, err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/haleon/:id - Modifier un utilisateur Haleon
// IMPORTANT: Met à jour haleon_users ET users (si l'utilisateur a été validé)
router.put("/users/haleon/:id", adminOnly, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, site_id, department_id, allowed_apps, is_active, is_validated } = req.body;

    // 1. Update haleon_users
    const result = await pool.query(`
      UPDATE haleon_users
      SET name = COALESCE($1, name),
          site_id = COALESCE($2, site_id),
          department_id = COALESCE($3, department_id),
          allowed_apps = COALESCE($4, allowed_apps),
          is_active = COALESCE($5, is_active),
          is_validated = COALESCE($6, is_validated),
          updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [name, site_id, department_id, allowed_apps, is_active, is_validated, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const haleonUser = result.rows[0];

    // 2. ALSO update users table if user exists there (validated users)
    // This ensures permissions are synced between both tables
    if (haleonUser.email) {
      try {
        const usersUpdate = await pool.query(`
          UPDATE users
          SET name = COALESCE($1, name),
              site_id = COALESCE($2, site_id),
              department_id = COALESCE($3, department_id),
              allowed_apps = $4,
              is_active = COALESCE($5, is_active),
              updated_at = NOW()
          WHERE LOWER(email) = LOWER($6)
          RETURNING id
        `, [name, site_id, department_id, allowed_apps, is_active, haleonUser.email]);

        if (usersUpdate.rows.length > 0) {
          console.log(`[ADMIN] ✅ Also updated users table for ${haleonUser.email}`);
        }
      } catch (usersErr) {
        console.log(`[ADMIN] ⚠️ Could not update users table: ${usersErr.message}`);
        // Non-blocking - haleon_users was already updated
      }
    }

    res.json(haleonUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PENDING USERS MANAGEMENT - Users awaiting validation
// ============================================================

// GET /api/admin/users/pending - Liste les utilisateurs en attente de validation
// SOURCE FIABLE: Utilise auth_audit_log pour trouver les LOGIN_PENDING
router.get("/users/pending", adminOnly, async (req, res) => {
  try {
    const logs = [];

    // APPROCHE DIRECTE: Chercher dans auth_audit_log les utilisateurs avec LOGIN_PENDING
    // qui n'ont PAS eu de LOGIN (validé) après leur dernier LOGIN_PENDING
    // ET qui ne sont pas déjà validés dans la table users (is_active = TRUE)
    const result = await pool.query(`
      WITH latest_pending AS (
        -- Dernier LOGIN_PENDING pour chaque email
        SELECT DISTINCT ON (LOWER(email))
               email, user_name as name, ts as created_at, site_id, company_id
        FROM auth_audit_log
        WHERE action = 'LOGIN_PENDING'
          AND email IS NOT NULL
        ORDER BY LOWER(email), ts DESC
      ),
      validated_after AS (
        -- Utilisateurs qui ont eu un LOGIN (validé) après leur dernier LOGIN_PENDING
        SELECT DISTINCT LOWER(lp.email) as email
        FROM latest_pending lp
        JOIN auth_audit_log a ON LOWER(a.email) = LOWER(lp.email)
        WHERE a.action = 'LOGIN'
          AND a.success = true
          AND a.ts > lp.created_at
      ),
      already_validated_in_users AS (
        -- Utilisateurs déjà validés dans la table users
        SELECT LOWER(email) as email
        FROM users
        WHERE is_active = TRUE
      )
      SELECT lp.email, lp.name, lp.created_at, lp.site_id, lp.company_id,
             s.name as site_name, c.name as company_name,
             'auth_audit_log' as source
      FROM latest_pending lp
      LEFT JOIN sites s ON lp.site_id = s.id
      LEFT JOIN companies c ON lp.company_id = c.id
      WHERE LOWER(lp.email) NOT IN (SELECT email FROM validated_after)
        AND LOWER(lp.email) NOT IN (SELECT email FROM already_validated_in_users)
      ORDER BY lp.created_at DESC
    `);

    const users = result.rows.map(u => ({
      id: null,
      email: u.email,
      name: u.name,
      source: 'auth_audit_log (LOGIN_PENDING)',
      created_at: u.created_at,
      site_id: u.site_id,
      site_name: u.site_name,
      company_id: u.company_id,
      company_name: u.company_name,
      is_validated: false
    }));

    logs.push(`auth_audit_log: ${users.length} pending users`);

    console.log(`[ADMIN] Pending users: ${users.length} found | ${logs.join(' | ')}`);
    res.json({ users, count: users.length, sources: logs });
  } catch (err) {
    console.error(`[ADMIN] /users/pending ERROR:`, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users/debug/:email - Debug pourquoi un utilisateur n'apparaît pas en pending
router.get("/users/debug/:email", adminOnly, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    console.log(`[ADMIN] Debug user: ${email}`);

    const debug = {
      email,
      timestamp: new Date().toISOString(),
      findings: [],
      recommendation: null
    };

    // 1. Vérifier dans auth_audit_log
    const auditResult = await pool.query(`
      SELECT action, ts, success, site_id, company_id, details
      FROM auth_audit_log
      WHERE LOWER(email) = $1
      ORDER BY ts DESC
      LIMIT 20
    `, [email]);
    debug.auth_audit_log = auditResult.rows;

    if (auditResult.rows.length === 0) {
      debug.findings.push("❌ Aucune entrée dans auth_audit_log - l'utilisateur ne s'est peut-être jamais connecté via Haleon");
    } else {
      debug.findings.push(`✓ ${auditResult.rows.length} entrées trouvées dans auth_audit_log`);

      // Vérifier s'il y a un LOGIN_PENDING
      const hasLoginPending = auditResult.rows.some(r => r.action === 'LOGIN_PENDING');
      const hasNewUserPending = auditResult.rows.some(r => r.action === 'NEW_USER_PENDING');
      const hasSuccessfulLogin = auditResult.rows.some(r => r.action === 'LOGIN' && r.success === true);

      if (!hasLoginPending && !hasNewUserPending) {
        debug.findings.push("❌ Aucun événement LOGIN_PENDING ou NEW_USER_PENDING - l'utilisateur était peut-être déjà validé lors de sa connexion");
      }
      if (hasLoginPending) {
        debug.findings.push("✓ L'utilisateur a un événement LOGIN_PENDING");
      }
      if (hasSuccessfulLogin) {
        // Vérifier si LOGIN est après LOGIN_PENDING
        const lastPending = auditResult.rows.find(r => r.action === 'LOGIN_PENDING');
        const lastLogin = auditResult.rows.find(r => r.action === 'LOGIN' && r.success === true);
        if (lastPending && lastLogin && new Date(lastLogin.ts) > new Date(lastPending.ts)) {
          debug.findings.push("⚠️ L'utilisateur a eu un LOGIN réussi APRÈS son dernier LOGIN_PENDING - il est considéré comme validé");
        }
      }
    }

    // 2. Vérifier dans users table
    const usersResult = await pool.query(`
      SELECT id, email, name, is_active, site_id, department_id, company_id, role, created_at
      FROM users
      WHERE LOWER(email) = $1
    `, [email]);
    debug.users_table = usersResult.rows[0] || null;

    if (usersResult.rows.length > 0) {
      const user = usersResult.rows[0];
      if (user.is_active === true) {
        debug.findings.push(`❌ L'utilisateur existe dans la table 'users' avec is_active=TRUE - il est EXCLU de la liste pending car déjà validé`);
        debug.recommendation = "L'utilisateur est déjà validé. Si vous voulez le remettre en pending, désactivez-le (is_active=FALSE) dans la table users.";
      } else {
        debug.findings.push(`✓ L'utilisateur existe dans 'users' mais is_active=FALSE`);
      }
    } else {
      debug.findings.push("✓ L'utilisateur n'existe PAS dans la table 'users'");
    }

    // 3. Vérifier dans haleon_users table
    const haleonResult = await pool.query(`
      SELECT id, email, name, is_validated, site_id, department_id, created_at
      FROM haleon_users
      WHERE LOWER(email) = $1
    `, [email]);
    debug.haleon_users_table = haleonResult.rows[0] || null;

    if (haleonResult.rows.length > 0) {
      const hu = haleonResult.rows[0];
      debug.findings.push(`✓ L'utilisateur existe dans haleon_users (is_validated=${hu.is_validated})`);
    } else {
      debug.findings.push("⚠️ L'utilisateur n'existe PAS dans haleon_users");
    }

    // 4. Conclusion
    const shouldBeInPending =
      auditResult.rows.some(r => r.action === 'LOGIN_PENDING') &&
      (!usersResult.rows[0]?.is_active);

    debug.should_appear_in_pending = shouldBeInPending;

    if (!debug.recommendation) {
      if (shouldBeInPending) {
        debug.recommendation = "L'utilisateur DEVRAIT apparaître dans la liste pending. S'il n'apparaît pas, il y a peut-être un bug.";
      } else if (!auditResult.rows.some(r => r.action === 'LOGIN_PENDING')) {
        debug.recommendation = "L'utilisateur n'a jamais eu d'événement LOGIN_PENDING. Vérifiez qu'il s'est bien connecté via haleon-tool.io";
      }
    }

    res.json(debug);
  } catch (err) {
    console.error(`[ADMIN] /users/debug ERROR:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/validate/by-email - Valider un utilisateur par EMAIL
// IMPORTANT: Cette route doit être AVANT validate/:id pour éviter que "by-email" soit interprété comme un ID
// STRATÉGIE: Crée l'utilisateur dans la table "users" avec is_active=TRUE
// Le code de login vérifie: is_validated = haleonUser?.is_validated === true || mainUser?.is_active === true
// Donc en créant dans "users" avec is_active=TRUE, l'utilisateur sera validé!
router.post("/users/validate/by-email", adminOnly, express.json(), async (req, res) => {
  try {
    const { email, allowed_apps, site_id, department_id } = req.body;
    let { name } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const emailLower = email.toLowerCase();
    const isHaleon = emailLower.endsWith('@haleon.com');
    console.log(`[ADMIN] Validating user by email: ${email}`);

    // Si pas de nom fourni, essayer de le récupérer depuis haleon_users ou générer depuis l'email
    if (!name) {
      try {
        const haleonResult = await pool.query(
          `SELECT name FROM haleon_users WHERE LOWER(email) = $1`,
          [emailLower]
        );
        if (haleonResult.rows[0]?.name) {
          name = haleonResult.rows[0].name;
          console.log(`[ADMIN] Got name from haleon_users: ${name}`);
        }
      } catch (e) {
        // Ignorer l'erreur
      }
    }

    // Si toujours pas de nom, générer depuis l'email (florian.x.pacarizi@haleon.com -> Florian X Pacarizi)
    if (!name) {
      const emailPart = emailLower.split('@')[0];
      name = emailPart
        .replace(/[._]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      console.log(`[ADMIN] Generated name from email: ${name}`);
    }

    // STRATÉGIE 1: Créer/mettre à jour dans la table "users" avec is_active=TRUE
    // C'est la méthode la plus fiable car le login vérifie mainUser?.is_active === true
    // Note: password_hash et department_id sont NOT NULL donc on met des valeurs par défaut
    const result = await pool.query(`
      INSERT INTO users (email, name, site_id, department_id, company_id, allowed_apps, is_active, role, origin, password_hash, created_at, updated_at)
      VALUES ($1, $2, COALESCE($3, 1), COALESCE($4, 1), COALESCE($5, 1), $6, TRUE, 'site', 'admin_validated', 'SSO_USER_NO_PASSWORD', NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        is_active = TRUE,
        name = COALESCE(EXCLUDED.name, users.name),
        site_id = COALESCE(EXCLUDED.site_id, users.site_id),
        department_id = COALESCE(EXCLUDED.department_id, users.department_id),
        allowed_apps = COALESCE(EXCLUDED.allowed_apps, users.allowed_apps),
        updated_at = NOW()
      RETURNING *
    `, [emailLower, name, site_id, department_id, isHaleon ? 1 : null, allowed_apps]);

    // STRATÉGIE 2: Aussi essayer de mettre à jour haleon_users si la colonne is_validated existe
    try {
      await pool.query(`
        UPDATE haleon_users SET is_validated = TRUE, updated_at = NOW()
        WHERE LOWER(email) = $1
      `, [emailLower]);
    } catch (e) {
      // Ignorer si la colonne n'existe pas
      console.log(`[ADMIN] haleon_users update skipped (column may not exist): ${e.message}`);
    }

    console.log(`[ADMIN] ✅ User validated by email: ${email} (created in users table with is_active=TRUE)`);
    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error(`[ADMIN] Error validating user by email:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/validate/:id - Valider un utilisateur par ID
router.post("/users/validate/:id", adminOnly, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { allowed_apps, site_id, department_id } = req.body;

    // Try to update with is_validated, fallback if column doesn't exist
    let result;
    try {
      result = await pool.query(`
        UPDATE haleon_users
        SET is_validated = TRUE,
            allowed_apps = COALESCE($1, allowed_apps),
            site_id = COALESCE($2, site_id),
            department_id = COALESCE($3, department_id),
            updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `, [allowed_apps, site_id, department_id, id]);
    } catch (e) {
      // Fallback: update without is_validated
      result = await pool.query(`
        UPDATE haleon_users
        SET allowed_apps = COALESCE($1, allowed_apps),
            site_id = COALESCE($2, site_id),
            department_id = COALESCE($3, department_id),
            updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `, [allowed_apps, site_id, department_id, id]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log(`[ADMIN] ✅ User validated: ${result.rows[0].email} by admin`);
    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/reject/by-email - Rejeter un utilisateur par EMAIL
// IMPORTANT: Cette route doit être AVANT reject/:id
// Pour les utilisateurs découverts dans les tables d'activité
router.post("/users/reject/by-email", adminOnly, express.json(), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    console.log(`[ADMIN] Rejecting user by email: ${email}`);

    // For users from activity tables, we don't delete them from those tables
    // Instead, we create a haleon_users entry marked as rejected (is_validated = FALSE, is_active = FALSE)
    // This prevents them from appearing in pending again
    try {
      await pool.query(`
        INSERT INTO haleon_users (email, is_validated, is_active, created_at, updated_at)
        VALUES ($1, FALSE, FALSE, NOW(), NOW())
        ON CONFLICT (email) DO UPDATE SET
          is_validated = FALSE,
          is_active = FALSE,
          updated_at = NOW()
      `, [email.toLowerCase()]);
    } catch (e) {
      // Fallback if columns don't exist
      console.log(`[ADMIN] Column error, trying simple insert: ${e.message}`);
      await pool.query(`
        INSERT INTO haleon_users (email, is_active, created_at, updated_at)
        VALUES ($1, FALSE, NOW(), NOW())
        ON CONFLICT (email) DO UPDATE SET
          is_active = FALSE,
          updated_at = NOW()
      `, [email.toLowerCase()]);
    }

    console.log(`[ADMIN] ❌ User rejected by email: ${email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] Error rejecting user by email:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/reject/:id - Rejeter un utilisateur par ID (supprimer)
router.post("/users/reject/:id", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    // Get user info before deletion for logging
    const userResult = await pool.query(`SELECT email FROM haleon_users WHERE id = $1`, [id]);
    const email = userResult.rows[0]?.email;

    await pool.query(`DELETE FROM haleon_users WHERE id = $1`, [id]);

    console.log(`[ADMIN] ❌ User rejected and deleted: ${email}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/haleon/:id - Supprimer un utilisateur Haleon
router.delete("/users/haleon/:id", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM haleon_users WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// USER PERMISSIONS - Get permissions for current user
// ============================================================

// GET /api/admin/permissions/:email - Obtenir les permissions d'un utilisateur
router.get("/permissions/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const emailLower = email.toLowerCase();

    // Vérifier si admin
    if (ADMIN_EMAILS.includes(emailLower)) {
      return res.json({
        email: emailLower,
        isAdmin: true,
        apps: ALL_APPS
      });
    }

    // Chercher dans haleon_users
    try {
      const haleonResult = await pool.query(`
        SELECT * FROM haleon_users WHERE LOWER(email) = $1
      `, [emailLower]);

      if (haleonResult.rows.length > 0) {
        const user = haleonResult.rows[0];
        return res.json({
          email: emailLower,
          isAdmin: false,
          isHaleon: true,
          apps: user.allowed_apps || ALL_APPS,
          user
        });
      }
    } catch (e) {
      // Table n'existe pas encore
    }

    // Chercher dans users (externes)
    const userResult = await pool.query(`
      SELECT * FROM users WHERE LOWER(email) = $1
    `, [emailLower]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      return res.json({
        email: emailLower,
        isAdmin: user.is_admin || false,
        isExternal: true,
        apps: user.allowed_apps || ALL_APPS,
        user
      });
    }

    // Utilisateur inconnu - accès par défaut (tous les apps pour Haleon)
    if (emailLower.includes('@haleon.com')) {
      return res.json({
        email: emailLower,
        isAdmin: false,
        isHaleon: true,
        isNew: true,
        apps: ALL_APPS
      });
    }

    // Utilisateur externe inconnu - pas d'accès
    res.json({
      email: emailLower,
      isAdmin: false,
      isExternal: true,
      isNew: true,
      apps: []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MIGRATION - Run migration endpoint
// ============================================================

// Helper pour ajouter une colonne si elle n'existe pas
async function addColumnIfNotExists(tableName, columnName, columnDef) {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    );
  `, [tableName, columnName]);

  if (!result.rows[0].exists) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
    return true;
  }
  return false;
}

// Helper pour vérifier si une table existe
async function tableExists(tableName) {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    );
  `, [tableName]);
  return result.rows[0].exists;
}

// POST /api/admin/migrate - Exécuter les migrations de base
router.post("/migrate", adminOnly, async (req, res) => {
  try {
    const logs = [];

    // 1. Créer la table companies
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL DEFAULT 'Switzerland',
        city TEXT,
        logo BYTEA,
        logo_mime TEXT DEFAULT 'image/png',
        is_internal BOOLEAN DEFAULT FALSE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add columns if they don't exist (for existing databases)
    await addColumnIfNotExists('companies', 'code', 'TEXT UNIQUE');
    await addColumnIfNotExists('companies', 'is_internal', 'BOOLEAN DEFAULT FALSE');
    await addColumnIfNotExists('companies', 'settings', "JSONB DEFAULT '{}'::jsonb");
    await addColumnIfNotExists('companies', 'logo', 'BYTEA');
    await addColumnIfNotExists('companies', 'logo_mime', "TEXT DEFAULT 'image/png'");
    logs.push('Table companies créée/vérifiée');

    // 2. Insérer Haleon
    const haleonResult = await pool.query(`
      INSERT INTO companies (name, code, country, city, is_internal)
      VALUES ('Haleon', 'HAL', 'Switzerland', 'Nyon', TRUE)
      ON CONFLICT (name) DO UPDATE SET code = 'HAL', is_internal = TRUE
      RETURNING id
    `);
    const haleonId = haleonResult.rows[0].id;
    logs.push(`Entreprise Haleon créée (id=${haleonId})`);

    // 3. Créer la table sites avec company_id
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        code TEXT,
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Switzerland',
        timezone TEXT DEFAULT 'Europe/Zurich',
        is_active BOOLEAN DEFAULT TRUE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists('sites', 'company_id', 'INTEGER REFERENCES companies(id) ON DELETE CASCADE');
    await addColumnIfNotExists('sites', 'code', 'TEXT');
    await addColumnIfNotExists('sites', 'settings', "JSONB DEFAULT '{}'::jsonb");
    logs.push('Table sites mise à jour');

    // 4. Créer le site Nyon
    const nyonResult = await pool.query(`
      INSERT INTO sites (company_id, name, code, city, country)
      VALUES ($1, 'Nyon', 'NYN', 'Nyon', 'Switzerland')
      ON CONFLICT ON CONSTRAINT sites_company_id_name_key DO UPDATE SET code = 'NYN'
      RETURNING id
    `, [haleonId]).catch(async () => {
      // Contrainte n'existe peut-être pas, essayer autrement
      const existing = await pool.query(`SELECT id FROM sites WHERE name = 'Nyon' LIMIT 1`);
      if (existing.rows.length > 0) {
        await pool.query(`UPDATE sites SET company_id = $1, code = 'NYN' WHERE id = $2`, [haleonId, existing.rows[0].id]);
        return { rows: existing.rows };
      }
      return pool.query(`INSERT INTO sites (company_id, name, code, city) VALUES ($1, 'Nyon', 'NYN', 'Nyon') RETURNING id`, [haleonId]);
    });
    const nyonId = nyonResult.rows[0]?.id || 1;
    logs.push(`Site Nyon créé/mis à jour (id=${nyonId})`);

    // 5. Créer la table users avec tous les champs multi-tenant
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        name TEXT,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
        department_id INTEGER,
        role TEXT DEFAULT 'site',
        allowed_apps TEXT[] DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        is_admin BOOLEAN DEFAULT FALSE,
        origin TEXT DEFAULT 'manual',
        preferences JSONB DEFAULT '{}'::jsonb,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists('users', 'company_id', 'INTEGER REFERENCES companies(id) ON DELETE SET NULL');
    await addColumnIfNotExists('users', 'site_id', 'INTEGER REFERENCES sites(id) ON DELETE SET NULL');
    await addColumnIfNotExists('users', 'role', "TEXT DEFAULT 'site'");
    await addColumnIfNotExists('users', 'allowed_apps', 'TEXT[] DEFAULT NULL');
    await addColumnIfNotExists('users', 'is_admin', 'BOOLEAN DEFAULT FALSE');
    await addColumnIfNotExists('users', 'is_active', 'BOOLEAN DEFAULT TRUE');
    await addColumnIfNotExists('users', 'origin', "TEXT DEFAULT 'manual'");
    await addColumnIfNotExists('users', 'preferences', "JSONB DEFAULT '{}'::jsonb");
    await addColumnIfNotExists('users', 'last_login', 'TIMESTAMPTZ');
    logs.push('Table users mise à jour');

    // 6. Créer haleon_users (pour compat)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        site_id INTEGER REFERENCES sites(id),
        department_id INTEGER,
        allowed_apps TEXT[] DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        is_validated BOOLEAN DEFAULT FALSE,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // SECURITY: Ajouter colonne is_validated si elle n'existe pas
    await addColumnIfNotExists('haleon_users', 'is_validated', 'BOOLEAN DEFAULT FALSE');
    logs.push('Table haleon_users créée/vérifiée (avec is_validated)');

    // 6b. Créer la table departments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
        code TEXT,
        name TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists('departments', 'company_id', 'INTEGER REFERENCES companies(id) ON DELETE CASCADE');
    await addColumnIfNotExists('departments', 'site_id', 'INTEGER REFERENCES sites(id) ON DELETE SET NULL');
    await addColumnIfNotExists('departments', 'code', 'TEXT');
    await addColumnIfNotExists('departments', 'description', 'TEXT');
    await addColumnIfNotExists('departments', 'is_active', 'BOOLEAN DEFAULT TRUE');
    logs.push('Table departments créée/vérifiée');

    // 6c. Créer quelques départements par défaut pour Haleon/Nyon
    const defaultDepts = ['Maintenance', 'Engineering', 'Operations', 'Quality', 'Safety', 'IT'];
    for (const deptName of defaultDepts) {
      await pool.query(`
        INSERT INTO departments (company_id, site_id, code, name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [haleonId, nyonId, deptName.substring(0, 4).toUpperCase(), deptName]).catch(() => {});
    }
    logs.push('Départements par défaut créés');

    // 7. Créer index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sites_company ON sites(company_id);
      CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
      CREATE INDEX IF NOT EXISTS idx_users_site ON users(site_id);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id);
      CREATE INDEX IF NOT EXISTS idx_departments_site ON departments(site_id);
    `);
    logs.push('Index créés');

    // 8. Migrer utilisateurs Haleon existants
    const askvExists = await tableExists('askv_users');
    let migratedCount = 0;
    if (askvExists) {
      const askvUsers = await pool.query(`
        SELECT DISTINCT email FROM askv_users WHERE email LIKE '%@haleon.com'
      `);
      for (const user of askvUsers.rows) {
        await pool.query(`
          INSERT INTO haleon_users (email, site_id, is_validated)
          VALUES ($1, $2, TRUE)
          ON CONFLICT (email) DO NOTHING
        `, [user.email, nyonId]);
        migratedCount++;
      }
      logs.push(`${migratedCount} utilisateurs migrés depuis askv_users`);
    }

    // 9. SECURITY: Valider tous les utilisateurs existants qui ont été créés avant le système de validation
    // Ceci garantit que les utilisateurs qui utilisaient déjà l'app ne sont pas bloqués
    await pool.query(`
      UPDATE haleon_users
      SET is_validated = TRUE
      WHERE is_validated IS NULL OR is_validated = FALSE
        AND created_at < NOW() - INTERVAL '1 hour'
    `).catch(() => {});
    logs.push('Utilisateurs existants validés automatiquement');

    res.json({
      ok: true,
      message: "Migration de base terminée",
      haleonId,
      nyonId,
      migratedUsers: migratedCount,
      logs
    });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/migrate-multi-tenant - Migration complète multi-tenant
router.post("/migrate-multi-tenant", adminOnly, async (req, res) => {
  try {
    const logs = [];
    const stats = { tablesUpdated: 0, recordsMigrated: 0 };

    // Récupérer les IDs Haleon/Nyon
    const haleonResult = await pool.query(`SELECT id FROM companies WHERE name = 'Haleon'`);
    if (haleonResult.rows.length === 0) {
      return res.status(400).json({ error: "Run /migrate first to create Haleon company" });
    }
    const haleonId = haleonResult.rows[0].id;

    const nyonResult = await pool.query(`SELECT id FROM sites WHERE name = 'Nyon' LIMIT 1`);
    if (nyonResult.rows.length === 0) {
      return res.status(400).json({ error: "Run /migrate first to create Nyon site" });
    }
    const nyonId = nyonResult.rows[0].id;

    // Tables avec site TEXT existant
    const tablesWithSite = [
      'switchboards', 'devices', 'site_settings', 'scanned_products',
      'control_templates', 'control_schedules', 'control_records', 'control_attachments',
      'hv_switchboards', 'hv_equipment', 'hv_cells', 'hv_tests', 'hv_maintenance',
      'arcflash_studies', 'arcflash_switchboards', 'arcflash_equipment', 'arcflash_results',
      'projects', 'project_tasks', 'selectivity_studies', 'selectivity_devices',
      'fla_studies', 'fla_calculations', 'obsolescence_items'
    ];

    // Tables sans site
    const tablesWithoutSite = [
      'atex_equipments', 'atex_checks', 'atex_files', 'atex_plans', 'atex_positions', 'atex_subareas', 'atex_events',
      'meca_equipments', 'meca_checks', 'meca_files', 'meca_plans', 'meca_positions', 'meca_subareas', 'meca_events',
      'vsd_units', 'vsd_parameters', 'vsd_maintenance', 'vsd_alarms', 'vsd_files',
      'fire_doors', 'fire_door_checks', 'fire_door_files',
      'compext_contractors', 'compext_interventions', 'compext_evaluations',
      'askv_documents', 'askv_questions', 'askv_answers',
      'dcf_documents', 'dcf_categories',
      'learnex_incidents', 'learnex_lessons', 'learnex_actions',
      'loopcalc_studies', 'loopcalc_results',
      'oibt_inspections', 'oibt_findings', 'oibt_reports'
    ];

    // Ajouter company_id aux tables avec site TEXT
    for (const tableName of tablesWithSite) {
      const exists = await tableExists(tableName);
      if (!exists) continue;

      const added = await addColumnIfNotExists(tableName, 'company_id', 'INTEGER');
      await addColumnIfNotExists(tableName, 'site_id', 'INTEGER');

      if (added) {
        const updateResult = await pool.query(`
          UPDATE ${tableName} SET company_id = $1, site_id = $2 WHERE company_id IS NULL
        `, [haleonId, nyonId]);
        stats.tablesUpdated++;
        stats.recordsMigrated += updateResult.rowCount;
        logs.push(`${tableName}: ${updateResult.rowCount} enregistrements migrés`);
      }
    }

    // Ajouter company_id ET site_id aux tables sans site
    for (const tableName of tablesWithoutSite) {
      const exists = await tableExists(tableName);
      if (!exists) continue;

      const addedCompany = await addColumnIfNotExists(tableName, 'company_id', 'INTEGER');
      await addColumnIfNotExists(tableName, 'site_id', 'INTEGER');

      if (addedCompany) {
        const updateResult = await pool.query(`
          UPDATE ${tableName} SET company_id = $1, site_id = $2 WHERE company_id IS NULL
        `, [haleonId, nyonId]);
        stats.tablesUpdated++;
        stats.recordsMigrated += updateResult.rowCount;
        logs.push(`${tableName}: ${updateResult.rowCount} enregistrements migrés`);
      }
    }

    // Migrer les utilisateurs Haleon vers users
    const userMigration = await pool.query(`
      UPDATE users
      SET company_id = $1, site_id = $2, role = COALESCE(role, 'site')
      WHERE email LIKE '%@haleon.com' AND company_id IS NULL
    `, [haleonId, nyonId]);
    logs.push(`${userMigration.rowCount} utilisateurs Haleon migrés`);

    res.json({
      ok: true,
      message: "Migration multi-tenant terminée",
      haleonId,
      nyonId,
      stats,
      logs
    });
  } catch (err) {
    console.error('Multi-tenant migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DATABASE OVERVIEW (all tables with row counts)
// ============================================================

// GET /api/admin/overview - Vue d'ensemble de la DB
router.get("/overview", adminOnly, async (req, res) => {
  try {
    // Liste toutes les tables avec leur nombre de lignes
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const overview = [];
    for (const row of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) FROM "${row.table_name}"`);
        overview.push({
          table: row.table_name,
          rowCount: parseInt(countResult.rows[0].count)
        });
      } catch (e) {
        overview.push({
          table: row.table_name,
          rowCount: -1,
          error: e.message
        });
      }
    }

    res.json({
      totalTables: overview.length,
      tables: overview.sort((a, b) => b.rowCount - a.rowCount)
    });
  } catch (err) {
    console.error("Error getting overview:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RAW SQL (pour debug - à utiliser avec précaution)
// ============================================================

// POST /api/admin/query - Exécute une requête SQL (SELECT uniquement)
router.post("/query", adminOnly, express.json(), async (req, res) => {
  try {
    const { sql } = req.body;

    // Sécurité: n'autoriser que les SELECT
    const trimmedSql = sql?.trim().toUpperCase();
    if (!trimmedSql?.startsWith("SELECT")) {
      return res.status(400).json({ error: "Only SELECT queries are allowed" });
    }

    const result = await pool.query(sql);
    res.json({
      rowCount: result.rowCount,
      fields: result.fields?.map(f => f.name),
      rows: result.rows
    });
  } catch (err) {
    console.error("Error executing query:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AUTH AUDIT LOG - Historique des connexions/déconnexions
// ============================================================

// GET /api/admin/auth-audit - Liste les événements d'authentification
router.get("/auth-audit", adminOnly, async (req, res) => {
  try {
    const { page = '1', pageSize = '50', action, email, success, from, to } = req.query;
    const limit = Math.min(parseInt(pageSize) || 50, 200);
    const offset = ((parseInt(page) || 1) - 1) * limit;

    // Build WHERE clause
    const where = [];
    const params = [];
    let i = 1;

    if (action) {
      where.push(`action = $${i}`);
      params.push(action);
      i++;
    }
    if (email) {
      where.push(`email ILIKE $${i}`);
      params.push(`%${email}%`);
      i++;
    }
    if (success !== undefined && success !== '') {
      where.push(`success = $${i}`);
      params.push(success === 'true' || success === true);
      i++;
    }
    if (from) {
      where.push(`ts >= $${i}`);
      params.push(from);
      i++;
    }
    if (to) {
      where.push(`ts <= $${i}`);
      params.push(to);
      i++;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM auth_audit_log ${whereClause}`,
      params
    );

    // Get data
    const result = await pool.query(`
      SELECT a.*, c.name as company_name, s.name as site_name
      FROM auth_audit_log a
      LEFT JOIN companies c ON a.company_id = c.id
      LEFT JOIN sites s ON a.site_id = s.id
      ${whereClause}
      ORDER BY a.ts DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]);

    res.json({
      data: result.rows,
      total: countResult.rows[0].total,
      page: parseInt(page) || 1,
      pageSize: limit,
      totalPages: Math.ceil(countResult.rows[0].total / limit)
    });
  } catch (err) {
    console.error("[auth-audit] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/auth-audit/stats - Statistiques des connexions
router.get("/auth-audit/stats", adminOnly, async (req, res) => {
  try {
    const { days = '7' } = req.query;
    const daysInt = Math.min(parseInt(days) || 7, 90);

    // Global stats
    const globalStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE action = 'LOGIN' AND success = true)::int AS total_logins,
        COUNT(*) FILTER (WHERE action = 'LOGIN_FAILED')::int AS failed_logins,
        COUNT(*) FILTER (WHERE action = 'LOGOUT')::int AS total_logouts,
        COUNT(DISTINCT email)::int AS unique_users
      FROM auth_audit_log
      WHERE ts > NOW() - INTERVAL '${daysInt} days'
    `);

    // Daily breakdown
    const dailyStats = await pool.query(`
      SELECT
        DATE(ts) AS date,
        COUNT(*) FILTER (WHERE action = 'LOGIN' AND success = true)::int AS logins,
        COUNT(*) FILTER (WHERE action = 'LOGIN_FAILED')::int AS failed
      FROM auth_audit_log
      WHERE ts > NOW() - INTERVAL '${daysInt} days'
      GROUP BY DATE(ts)
      ORDER BY DATE(ts) DESC
    `);

    // Top users
    const topUsers = await pool.query(`
      SELECT email, COUNT(*)::int AS login_count
      FROM auth_audit_log
      WHERE action = 'LOGIN' AND success = true
        AND ts > NOW() - INTERVAL '${daysInt} days'
      GROUP BY email
      ORDER BY login_count DESC
      LIMIT 10
    `);

    // Recent failed attempts
    const recentFailed = await pool.query(`
      SELECT email, ip_address, ts, error_message
      FROM auth_audit_log
      WHERE action = 'LOGIN_FAILED'
        AND ts > NOW() - INTERVAL '24 hours'
      ORDER BY ts DESC
      LIMIT 20
    `);

    res.json({
      period: `${daysInt} days`,
      global: globalStats.rows[0],
      daily: dailyStats.rows,
      topUsers: topUsers.rows,
      recentFailed: recentFailed.rows
    });
  } catch (err) {
    console.error("[auth-audit/stats] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// APP SETTINGS - Global application settings (AI Icon, etc.)
// ============================================================

// Ensure app_settings table exists with all required columns
async function ensureAppSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB,
      text_value TEXT,
      binary_data BYTEA,
      mime_type TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add text_value column if it doesn't exist (for existing tables)
  await pool.query(`
    ALTER TABLE app_settings
    ADD COLUMN IF NOT EXISTS text_value TEXT
  `);
}

// GET /api/admin/settings/ai-icon - Get AI icon (public, no auth required for display)
router.get("/settings/ai-icon", async (req, res) => {
  try {
    await ensureAppSettingsTable();
    const result = await pool.query(
      `SELECT binary_data, mime_type FROM app_settings WHERE key = 'ai_icon'`
    );

    if (result.rows.length === 0 || !result.rows[0].binary_data) {
      return res.status(404).json({ error: "No custom AI icon set" });
    }

    const { binary_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type || 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(binary_data);
  } catch (err) {
    console.error("[settings/ai-icon GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/settings/ai-icon/info - Get AI icon metadata
router.get("/settings/ai-icon/info", async (req, res) => {
  try {
    await ensureAppSettingsTable();
    const result = await pool.query(
      `SELECT mime_type, updated_at, LENGTH(binary_data) as size FROM app_settings WHERE key = 'ai_icon'`
    );

    if (result.rows.length === 0 || !result.rows[0].size) {
      return res.json({ hasCustomIcon: false });
    }

    res.json({
      hasCustomIcon: true,
      mimeType: result.rows[0].mime_type,
      size: result.rows[0].size,
      updatedAt: result.rows[0].updated_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/ai-icon - Upload AI icon (admin only)
router.post("/settings/ai-icon", adminOnly, uploadMemory.single('icon'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    await ensureAppSettingsTable();

    const { buffer, mimetype } = req.file;

    await pool.query(`
      INSERT INTO app_settings (key, binary_data, mime_type, updated_at)
      VALUES ('ai_icon', $1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET
        binary_data = EXCLUDED.binary_data,
        mime_type = EXCLUDED.mime_type,
        updated_at = NOW()
    `, [buffer, mimetype]);

    res.json({ ok: true, message: "AI icon uploaded successfully" });
  } catch (err) {
    console.error("[settings/ai-icon POST] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/settings/ai-icon - Remove custom AI icon (admin only)
router.delete("/settings/ai-icon", adminOnly, async (req, res) => {
  try {
    await ensureAppSettingsTable();
    await pool.query(`DELETE FROM app_settings WHERE key = 'ai_icon'`);
    res.json({ ok: true, message: "AI icon removed" });
  } catch (err) {
    console.error("[settings/ai-icon DELETE] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AI VIDEO AVATAR ENDPOINTS
// ============================================================================

// GET /api/admin/settings/ai-video/info - Get AI video metadata
router.get("/settings/ai-video/info", async (req, res) => {
  try {
    await ensureAppSettingsTable();
    const result = await pool.query(`
      SELECT key, mime_type, updated_at, LENGTH(binary_data) as size
      FROM app_settings
      WHERE key IN ('ai_video_idle', 'ai_video_speaking')
    `);

    const videos = {};
    result.rows.forEach(row => {
      if (row.key === 'ai_video_idle') {
        videos.hasIdleVideo = true;
        videos.idleMimeType = row.mime_type;
        videos.idleSize = row.size;
      } else if (row.key === 'ai_video_speaking') {
        videos.hasSpeakingVideo = true;
        videos.speakingMimeType = row.mime_type;
        videos.speakingSize = row.size;
      }
    });

    res.json({
      hasIdleVideo: videos.hasIdleVideo || false,
      hasSpeakingVideo: videos.hasSpeakingVideo || false,
      ...videos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/settings/ai-video/idle - Get idle video
router.get("/settings/ai-video/idle", async (req, res) => {
  try {
    await ensureAppSettingsTable();
    const result = await pool.query(
      `SELECT binary_data, mime_type FROM app_settings WHERE key = 'ai_video_idle'`
    );

    if (result.rows.length === 0 || !result.rows[0].binary_data) {
      return res.status(404).json({ error: "No idle video found" });
    }

    const { binary_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type || 'video/mp4');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(binary_data);
  } catch (err) {
    console.error("[settings/ai-video/idle GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/settings/ai-video/speaking - Get speaking video
router.get("/settings/ai-video/speaking", async (req, res) => {
  try {
    await ensureAppSettingsTable();
    const result = await pool.query(
      `SELECT binary_data, mime_type FROM app_settings WHERE key = 'ai_video_speaking'`
    );

    if (result.rows.length === 0 || !result.rows[0].binary_data) {
      return res.status(404).json({ error: "No speaking video found" });
    }

    const { binary_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type || 'video/mp4');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(binary_data);
  } catch (err) {
    console.error("[settings/ai-video/speaking GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/ai-video/idle - Upload idle video (admin only)
router.post("/settings/ai-video/idle", adminOnly, uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!validTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Invalid video format. Use MP4, WebM or OGG." });
    }

    // Limit file size (10MB)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Video too large. Maximum 10MB." });
    }

    await ensureAppSettingsTable();

    const { buffer, mimetype } = req.file;

    await pool.query(`
      INSERT INTO app_settings (key, binary_data, mime_type, updated_at)
      VALUES ('ai_video_idle', $1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET
        binary_data = EXCLUDED.binary_data,
        mime_type = EXCLUDED.mime_type,
        updated_at = NOW()
    `, [buffer, mimetype]);

    res.json({ ok: true, message: "Idle video uploaded successfully" });
  } catch (err) {
    console.error("[settings/ai-video/idle POST] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/ai-video/speaking - Upload speaking video (admin only)
router.post("/settings/ai-video/speaking", adminOnly, uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!validTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Invalid video format. Use MP4, WebM or OGG." });
    }

    // Limit file size (10MB)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Video too large. Maximum 10MB." });
    }

    await ensureAppSettingsTable();

    const { buffer, mimetype } = req.file;

    await pool.query(`
      INSERT INTO app_settings (key, binary_data, mime_type, updated_at)
      VALUES ('ai_video_speaking', $1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET
        binary_data = EXCLUDED.binary_data,
        mime_type = EXCLUDED.mime_type,
        updated_at = NOW()
    `, [buffer, mimetype]);

    res.json({ ok: true, message: "Speaking video uploaded successfully" });
  } catch (err) {
    console.error("[settings/ai-video/speaking POST] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/settings/ai-video - Remove all custom AI videos (admin only)
router.delete("/settings/ai-video", adminOnly, async (req, res) => {
  try {
    await ensureAppSettingsTable();
    await pool.query(`DELETE FROM app_settings WHERE key IN ('ai_video_idle', 'ai_video_speaking')`);
    res.json({ ok: true, message: "AI videos removed" });
  } catch (err) {
    console.error("[settings/ai-video DELETE] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MULTI-AGENT VIDEO AVATAR ENDPOINTS
// Support for equipment-specific AI agents (vsd, meca, glo, hv, mobile, atex, switchboard, doors, datahub)
// ============================================================================

// Valid agent types for video avatars
const VALID_AGENT_TYPES = ['main', 'vsd', 'meca', 'glo', 'hv', 'mobile', 'atex', 'switchboard', 'doors', 'datahub', 'firecontrol', 'infrastructure'];

// Agent display names
const AGENT_NAMES = {
  main: 'Electro (Assistant Principal)',
  vsd: 'Shakira (Variateurs)',
  meca: 'Titan (Équipements Mécaniques)',
  glo: 'Lumina (Éclairage de Sécurité)',
  hv: 'Voltaire (Haute Tension)',
  mobile: 'Nomad (Équipements Mobiles)',
  atex: 'Phoenix (Zones ATEX)',
  switchboard: 'Matrix (Tableaux Électriques)',
  doors: 'Portal (Portes)',
  datahub: 'Nexus (Datahub)',
  firecontrol: 'Blaze (Sécurité Incendie)',
  infrastructure: 'Atlas (Infrastructure)'
};

// GET /api/admin/settings/ai-agents/list - Get all agent types and their video/image status
router.get("/settings/ai-agents/list", async (req, res) => {
  try {
    await ensureAppSettingsTable();

    // Get all agent videos AND images from database
    const result = await pool.query(`
      SELECT key, mime_type, updated_at, LENGTH(binary_data) as size
      FROM app_settings
      WHERE key LIKE 'ai_video_%' OR key LIKE 'ai_image_%'
    `);

    // Build agent list with video and image status
    const agents = VALID_AGENT_TYPES.map(agentType => {
      const idleKey = agentType === 'main' ? 'ai_video_idle' : `ai_video_${agentType}_idle`;
      const speakingKey = agentType === 'main' ? 'ai_video_speaking' : `ai_video_${agentType}_speaking`;
      const imageKey = `ai_image_${agentType}`;

      const idleRow = result.rows.find(r => r.key === idleKey);
      const speakingRow = result.rows.find(r => r.key === speakingKey);
      const imageRow = result.rows.find(r => r.key === imageKey);

      return {
        type: agentType,
        name: AGENT_NAMES[agentType],
        hasIdleVideo: !!idleRow,
        hasSpeakingVideo: !!speakingRow,
        hasImage: !!imageRow,
        idleSize: idleRow?.size || 0,
        speakingSize: speakingRow?.size || 0,
        imageSize: imageRow?.size || 0,
        imageMimeType: imageRow?.mime_type || null,
        updatedAt: imageRow?.updated_at || idleRow?.updated_at || speakingRow?.updated_at || null
      };
    });

    res.json({ agents });
  } catch (err) {
    console.error("[settings/ai-agents/list GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/settings/ai-agents/:agentType/info - Get video and image info for specific agent
router.get("/settings/ai-agents/:agentType/info", async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: `Invalid agent type. Valid types: ${VALID_AGENT_TYPES.join(', ')}` });
    }

    await ensureAppSettingsTable();

    const idleKey = agentType === 'main' ? 'ai_video_idle' : `ai_video_${agentType}_idle`;
    const speakingKey = agentType === 'main' ? 'ai_video_speaking' : `ai_video_${agentType}_speaking`;
    const imageKey = `ai_image_${agentType}`;

    const result = await pool.query(`
      SELECT key, mime_type, updated_at, LENGTH(binary_data) as size
      FROM app_settings
      WHERE key IN ($1, $2, $3)
    `, [idleKey, speakingKey, imageKey]);

    const media = {};
    result.rows.forEach(row => {
      if (row.key === idleKey) {
        media.hasIdleVideo = true;
        media.idleMimeType = row.mime_type;
        media.idleSize = row.size;
      } else if (row.key === speakingKey) {
        media.hasSpeakingVideo = true;
        media.speakingMimeType = row.mime_type;
        media.speakingSize = row.size;
      } else if (row.key === imageKey) {
        media.hasImage = true;
        media.imageMimeType = row.mime_type;
        media.imageSize = row.size;
        media.imageUpdatedAt = row.updated_at;
      }
    });

    res.json({
      agentType,
      name: AGENT_NAMES[agentType],
      hasIdleVideo: media.hasIdleVideo || false,
      hasSpeakingVideo: media.hasSpeakingVideo || false,
      hasImage: media.hasImage || false,
      ...media
    });
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/info GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/settings/ai-agents/:agentType/idle - Get idle video for agent
router.get("/settings/ai-agents/:agentType/idle", async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    await ensureAppSettingsTable();

    const key = agentType === 'main' ? 'ai_video_idle' : `ai_video_${agentType}_idle`;

    const result = await pool.query(
      `SELECT binary_data, mime_type FROM app_settings WHERE key = $1`,
      [key]
    );

    if (result.rows.length === 0 || !result.rows[0].binary_data) {
      return res.status(404).json({ error: "No idle video found for this agent" });
    }

    const { binary_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type || 'video/mp4');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(binary_data);
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/idle GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/settings/ai-agents/:agentType/speaking - Get speaking video for agent
router.get("/settings/ai-agents/:agentType/speaking", async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    await ensureAppSettingsTable();

    const key = agentType === 'main' ? 'ai_video_speaking' : `ai_video_${agentType}_speaking`;

    const result = await pool.query(
      `SELECT binary_data, mime_type FROM app_settings WHERE key = $1`,
      [key]
    );

    if (result.rows.length === 0 || !result.rows[0].binary_data) {
      return res.status(404).json({ error: "No speaking video found for this agent" });
    }

    const { binary_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type || 'video/mp4');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(binary_data);
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/speaking GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/ai-agents/:agentType/idle - Upload idle video for agent
router.post("/settings/ai-agents/:agentType/idle", adminOnly, uploadVideo.single('video'), async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    const validTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!validTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Invalid video format. Use MP4, WebM or OGG." });
    }

    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Video too large. Maximum 10MB." });
    }

    await ensureAppSettingsTable();

    const key = agentType === 'main' ? 'ai_video_idle' : `ai_video_${agentType}_idle`;
    const { buffer, mimetype } = req.file;

    await pool.query(`
      INSERT INTO app_settings (key, binary_data, mime_type, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) DO UPDATE SET
        binary_data = EXCLUDED.binary_data,
        mime_type = EXCLUDED.mime_type,
        updated_at = NOW()
    `, [key, buffer, mimetype]);

    res.json({ ok: true, message: `Idle video uploaded for ${AGENT_NAMES[agentType]}` });
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/idle POST] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/ai-agents/:agentType/speaking - Upload speaking video for agent
router.post("/settings/ai-agents/:agentType/speaking", adminOnly, uploadVideo.single('video'), async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    const validTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!validTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Invalid video format. Use MP4, WebM or OGG." });
    }

    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Video too large. Maximum 10MB." });
    }

    await ensureAppSettingsTable();

    const key = agentType === 'main' ? 'ai_video_speaking' : `ai_video_${agentType}_speaking`;
    const { buffer, mimetype } = req.file;

    await pool.query(`
      INSERT INTO app_settings (key, binary_data, mime_type, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) DO UPDATE SET
        binary_data = EXCLUDED.binary_data,
        mime_type = EXCLUDED.mime_type,
        updated_at = NOW()
    `, [key, buffer, mimetype]);

    res.json({ ok: true, message: `Speaking video uploaded for ${AGENT_NAMES[agentType]}` });
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/speaking POST] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/settings/ai-agents/:agentType - Remove videos for specific agent
router.delete("/settings/ai-agents/:agentType", adminOnly, async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    await ensureAppSettingsTable();

    const idleKey = agentType === 'main' ? 'ai_video_idle' : `ai_video_${agentType}_idle`;
    const speakingKey = agentType === 'main' ? 'ai_video_speaking' : `ai_video_${agentType}_speaking`;

    await pool.query(`DELETE FROM app_settings WHERE key IN ($1, $2)`, [idleKey, speakingKey]);

    res.json({ ok: true, message: `Videos removed for ${AGENT_NAMES[agentType]}` });
  } catch (err) {
    console.error("[settings/ai-agents/:agentType DELETE] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AGENT IMAGE ENDPOINTS (for email reports)
// ============================================================================

// GET /api/admin/settings/ai-agents/:agentType/image - Get image for agent
router.get("/settings/ai-agents/:agentType/image", async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    await ensureAppSettingsTable();

    const key = `ai_image_${agentType}`;

    const result = await pool.query(
      `SELECT binary_data, mime_type FROM app_settings WHERE key = $1`,
      [key]
    );

    if (result.rows.length === 0 || !result.rows[0].binary_data) {
      return res.status(404).json({ error: "No image found for this agent" });
    }

    const { binary_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type || 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(binary_data);
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/image GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/ai-agents/:agentType/image - Upload image for agent
router.post("/settings/ai-agents/:agentType/image", adminOnly, uploadMemory.single('image'), async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!validTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Invalid image format. Use PNG, JPG, GIF or WebP." });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "Image too large. Maximum 5MB." });
    }

    await ensureAppSettingsTable();

    const key = `ai_image_${agentType}`;
    const { buffer, mimetype } = req.file;

    await pool.query(`
      INSERT INTO app_settings (key, binary_data, mime_type, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) DO UPDATE SET
        binary_data = EXCLUDED.binary_data,
        mime_type = EXCLUDED.mime_type,
        updated_at = NOW()
    `, [key, buffer, mimetype]);

    res.json({ ok: true, message: `Image uploaded for ${AGENT_NAMES[agentType]}` });
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/image POST] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/settings/ai-agents/:agentType/image - Remove image for specific agent
router.delete("/settings/ai-agents/:agentType/image", adminOnly, async (req, res) => {
  try {
    const { agentType } = req.params;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    await ensureAppSettingsTable();

    const key = `ai_image_${agentType}`;

    await pool.query(`DELETE FROM app_settings WHERE key = $1`, [key]);

    res.json({ ok: true, message: `Image removed for ${AGENT_NAMES[agentType]}` });
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/image DELETE] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AGENT NAMES CUSTOMIZATION
// ============================================================================

// Default agent names (fallback)
const DEFAULT_AGENT_NAMES = {
  main: 'Electro',
  vsd: 'Shakira',
  meca: 'Titan',
  glo: 'Lumina',
  hv: 'Voltaire',
  mobile: 'Nomad',
  atex: 'Phoenix',
  switchboard: 'Matrix',
  doors: 'Portal',
  datahub: 'Nexus',
  firecontrol: 'Blaze',
  infrastructure: 'Atlas'
};

// GET /api/admin/settings/ai-agents/names - Get all custom agent names
router.get("/settings/ai-agents/names", async (req, res) => {
  try {
    await ensureAppSettingsTable();

    const result = await pool.query(
      `SELECT key, text_value FROM app_settings WHERE key LIKE 'ai_agent_name_%'`
    );

    // Build names object with defaults
    const names = { ...DEFAULT_AGENT_NAMES };
    result.rows.forEach(row => {
      const agentType = row.key.replace('ai_agent_name_', '');
      if (row.text_value && VALID_AGENT_TYPES.includes(agentType)) {
        names[agentType] = row.text_value;
      }
    });

    res.json({ names, defaults: DEFAULT_AGENT_NAMES });
  } catch (err) {
    console.error("[settings/ai-agents/names GET] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/settings/ai-agents/names - Update agent names
router.put("/settings/ai-agents/names", adminOnly, async (req, res) => {
  try {
    const { names } = req.body;

    if (!names || typeof names !== 'object') {
      return res.status(400).json({ error: "Invalid names object" });
    }

    await ensureAppSettingsTable();

    // Update each agent name
    for (const [agentType, name] of Object.entries(names)) {
      if (!VALID_AGENT_TYPES.includes(agentType)) continue;
      if (!name || typeof name !== 'string') continue;

      const key = `ai_agent_name_${agentType}`;
      const trimmedName = name.trim().substring(0, 50); // Max 50 chars

      if (trimmedName === DEFAULT_AGENT_NAMES[agentType]) {
        // If it's the default, remove custom entry
        await pool.query(`DELETE FROM app_settings WHERE key = $1`, [key]);
      } else {
        await pool.query(`
          INSERT INTO app_settings (key, text_value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE SET
            text_value = EXCLUDED.text_value,
            updated_at = NOW()
        `, [key, trimmedName]);
      }
    }

    res.json({ ok: true, message: "Agent names updated" });
  } catch (err) {
    console.error("[settings/ai-agents/names PUT] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/settings/ai-agents/:agentType/name - Update single agent name
router.put("/settings/ai-agents/:agentType/name", adminOnly, async (req, res) => {
  try {
    const { agentType } = req.params;
    const { name } = req.body;

    if (!VALID_AGENT_TYPES.includes(agentType)) {
      return res.status(400).json({ error: "Invalid agent type" });
    }

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: "Invalid name" });
    }

    await ensureAppSettingsTable();

    const key = `ai_agent_name_${agentType}`;
    const trimmedName = name.trim().substring(0, 50);

    if (trimmedName === DEFAULT_AGENT_NAMES[agentType]) {
      await pool.query(`DELETE FROM app_settings WHERE key = $1`, [key]);
    } else {
      await pool.query(`
        INSERT INTO app_settings (key, text_value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET
          text_value = EXCLUDED.text_value,
          updated_at = NOW()
      `, [key, trimmedName]);
    }

    res.json({ ok: true, name: trimmedName });
  } catch (err) {
    console.error("[settings/ai-agents/:agentType/name PUT] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
