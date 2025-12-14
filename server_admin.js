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
// COMPANIES / SITES / DEPARTMENTS
// ============================================================

// GET /api/admin/companies - Liste les entreprises
router.get("/companies", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name ILIKE '%compan%' OR table_name ILIKE '%enterprise%' OR table_name ILIKE '%org%')
    `);

    const companiesData = [];
    for (const row of result.rows) {
      const data = await pool.query(`SELECT * FROM "${row.table_name}" LIMIT 100`);
      companiesData.push({
        table: row.table_name,
        count: data.rows.length,
        data: data.rows
      });
    }

    res.json({ companyTables: companiesData });
  } catch (err) {
    console.error("Error getting companies:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/sites - Liste les sites
router.get("/sites", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name ILIKE '%site%' OR table_name ILIKE '%location%' OR table_name ILIKE '%building%')
    `);

    const sitesData = [];
    for (const row of result.rows) {
      const data = await pool.query(`SELECT * FROM "${row.table_name}" LIMIT 100`);
      sitesData.push({
        table: row.table_name,
        count: data.rows.length,
        data: data.rows
      });
    }

    res.json({ siteTables: sitesData });
  } catch (err) {
    console.error("Error getting sites:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/departments - Liste les départements
router.get("/departments", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND (table_name ILIKE '%depart%' OR table_name ILIKE '%team%' OR table_name ILIKE '%service%')
    `);

    const deptData = [];
    for (const row of result.rows) {
      const data = await pool.query(`SELECT * FROM "${row.table_name}" LIMIT 100`);
      deptData.push({
        table: row.table_name,
        count: data.rows.length,
        data: data.rows
      });
    }

    res.json({ departmentTables: deptData });
  } catch (err) {
    console.error("Error getting departments:", err);
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
