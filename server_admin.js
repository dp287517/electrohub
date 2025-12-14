// server_admin.js — API pour l'administration et gestion des utilisateurs
import express from "express";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// Middleware pour vérifier si l'utilisateur est admin
const ADMIN_EMAILS = ['daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com'];

function isAdmin(req) {
  const email = req.user?.email;
  return ADMIN_EMAILS.includes(email?.toLowerCase());
}

function adminOnly(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

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

// GET /api/admin/sites - Liste les sites
router.get("/sites", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM sites ORDER BY name ASC`);
    res.json({ sites: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/sites - Créer un site
router.post("/sites", adminOnly, express.json(), async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: "Code and name required" });

    const result = await pool.query(`
      INSERT INTO sites (code, name) VALUES ($1, $2) RETURNING *
    `, [code, name]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DEPARTMENTS ---

// GET /api/admin/departments - Liste les départements
router.get("/departments", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM departments ORDER BY name ASC`);
    res.json({ departments: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/departments - Créer un département
router.post("/departments", adminOnly, express.json(), async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: "Code and name required" });

    const result = await pool.query(`
      INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING *
    `, [code, name]);

    res.status(201).json(result.rows[0]);
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
    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.site_id, u.department_id,
             u.company_id, u.allowed_apps, u.is_admin, u.origin,
             u.created_at, u.updated_at,
             s.name as site_name, d.name as department_name,
             c.name as company_name
      FROM users u
      LEFT JOIN sites s ON u.site_id = s.id
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN companies c ON u.company_id = c.id
      ORDER BY u.name ASC
    `);
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/external - Créer un utilisateur externe
router.post("/users/external", adminOnly, express.json(), async (req, res) => {
  try {
    const { email, name, password, site_id, department_id, company_id, allowed_apps } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: "Email, name and password required" });
    }

    // Hash password (bcrypt)
    const bcrypt = await import('bcryptjs');
    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (email, name, password_hash, site_id, department_id, company_id, allowed_apps, origin)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'external')
      RETURNING id, email, name, site_id, department_id, company_id, allowed_apps, origin, created_at
    `, [email, name, password_hash, site_id || 1, department_id || 1, company_id, allowed_apps]);

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
    const { name, site_id, department_id, company_id, allowed_apps, is_admin, password } = req.body;

    let query = `
      UPDATE users
      SET name = COALESCE($1, name),
          site_id = COALESCE($2, site_id),
          department_id = COALESCE($3, department_id),
          company_id = COALESCE($4, company_id),
          allowed_apps = COALESCE($5, allowed_apps),
          is_admin = COALESCE($6, is_admin),
          updated_at = NOW()
      WHERE id = $7
      RETURNING id, email, name, site_id, department_id, company_id, allowed_apps, is_admin, origin
    `;
    let params = [name, site_id, department_id, company_id, allowed_apps, is_admin, id];

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
            password_hash = $7,
            updated_at = NOW()
        WHERE id = $8
        RETURNING id, email, name, site_id, department_id, company_id, allowed_apps, is_admin, origin
      `;
      params = [name, site_id, department_id, company_id, allowed_apps, is_admin, password_hash, id];
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

// GET /api/admin/users/haleon - Liste les utilisateurs Haleon
router.get("/users/haleon", adminOnly, async (req, res) => {
  try {
    // D'abord essayer la table haleon_users
    try {
      const result = await pool.query(`
        SELECT h.*, s.name as site_name, d.name as department_name
        FROM haleon_users h
        LEFT JOIN sites s ON h.site_id = s.id
        LEFT JOIN departments d ON h.department_id = d.id
        ORDER BY h.email ASC
      `);
      return res.json({ users: result.rows, source: 'haleon_users' });
    } catch (e) {
      // Table n'existe pas, fallback sur askv_users
      const result = await pool.query(`
        SELECT DISTINCT email, name, role, sector, created_at
        FROM askv_users
        WHERE email LIKE '%@haleon.com'
        ORDER BY email ASC
      `);
      return res.json({ users: result.rows, source: 'askv_users' });
    }
  } catch (err) {
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

// POST /api/admin/migrate - Exécuter les migrations
router.post("/migrate", adminOnly, async (req, res) => {
  try {
    // Créer la table companies si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL DEFAULT 'Switzerland',
        city TEXT,
        is_internal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Insérer Haleon
    await pool.query(`
      INSERT INTO companies (name, country, city, is_internal)
      VALUES ('Haleon', 'Switzerland', 'Nyon', TRUE)
      ON CONFLICT (name) DO NOTHING
    `);

    // Créer haleon_users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        site_id INTEGER REFERENCES sites(id),
        department_id INTEGER REFERENCES departments(id),
        allowed_apps TEXT[] DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Ajouter colonnes à users si nécessaire
    const columns = ['company_id', 'allowed_apps', 'is_admin', 'origin'];
    for (const col of columns) {
      try {
        if (col === 'company_id') {
          await pool.query(`ALTER TABLE users ADD COLUMN ${col} INTEGER REFERENCES companies(id)`);
        } else if (col === 'allowed_apps') {
          await pool.query(`ALTER TABLE users ADD COLUMN ${col} TEXT[] DEFAULT NULL`);
        } else if (col === 'is_admin') {
          await pool.query(`ALTER TABLE users ADD COLUMN ${col} BOOLEAN DEFAULT FALSE`);
        } else if (col === 'origin') {
          await pool.query(`ALTER TABLE users ADD COLUMN ${col} TEXT DEFAULT 'manual'`);
        }
      } catch (e) {
        // Colonne existe déjà
      }
    }

    // Migrer les utilisateurs Haleon depuis askv_users
    const askvUsers = await pool.query(`
      SELECT DISTINCT email FROM askv_users WHERE email LIKE '%@haleon.com'
    `);

    for (const user of askvUsers.rows) {
      await pool.query(`
        INSERT INTO haleon_users (email, site_id)
        VALUES ($1, 1)
        ON CONFLICT (email) DO NOTHING
      `, [user.email]);
    }

    res.json({ ok: true, message: "Migration completed", migratedUsers: askvUsers.rows.length });
  } catch (err) {
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
