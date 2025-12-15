// server_admin.js — API pour l'administration et gestion des utilisateurs
// VERSION 2.0 - MULTI-TENANT (Company + Site)
import express from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { extractTenantFromRequest, getTenantFilter, requireTenant } from "./lib/tenant-filter.js";

dotenv.config();

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
    const bcrypt = await import('bcryptjs');
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
      const bcrypt = await import('bcryptjs');
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
               h.created_at, h.updated_at, s.name as site_name, d.name as department_name,
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
          AND (u.password_hash IS NULL OR u.password_hash = '')
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
router.post("/users/haleon", adminOnly, express.json(), async (req, res) => {
  try {
    const { email, name, site_id, department_id, allowed_apps } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const result = await pool.query(`
      INSERT INTO haleon_users (email, name, site_id, department_id, allowed_apps)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, haleon_users.name),
        site_id = COALESCE(EXCLUDED.site_id, haleon_users.site_id),
        department_id = COALESCE(EXCLUDED.department_id, haleon_users.department_id),
        allowed_apps = COALESCE(EXCLUDED.allowed_apps, haleon_users.allowed_apps),
        updated_at = NOW()
      RETURNING *
    `, [email, name, site_id || 1, department_id, allowed_apps]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/haleon/:id - Modifier un utilisateur Haleon
router.put("/users/haleon/:id", adminOnly, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, site_id, department_id, allowed_apps, is_active } = req.body;

    const result = await pool.query(`
      UPDATE haleon_users
      SET name = COALESCE($1, name),
          site_id = COALESCE($2, site_id),
          department_id = COALESCE($3, department_id),
          allowed_apps = COALESCE($4, allowed_apps),
          is_active = COALESCE($5, is_active),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [name, site_id, department_id, allowed_apps, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(result.rows[0]);
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
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logs.push('Table haleon_users créée/vérifiée');

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
          INSERT INTO haleon_users (email, site_id)
          VALUES ($1, $2)
          ON CONFLICT (email) DO NOTHING
        `, [user.email, nyonId]);
        migratedCount++;
      }
      logs.push(`${migratedCount} utilisateurs migrés depuis askv_users`);
    }

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

export default router;
