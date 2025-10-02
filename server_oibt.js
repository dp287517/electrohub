// server_oibt.js
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Helper
function siteOf(req) {
  return (req.header("X-Site") || req.query.site || "").toString();
}

// Ensure schema
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oibt_projects (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      status JSONB DEFAULT '[]'::jsonb
    );
    CREATE TABLE IF NOT EXISTS oibt_periodics (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      building TEXT NOT NULL,
      report_url TEXT,
      defect_report_received BOOLEAN DEFAULT FALSE,
      confirmation_received BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_projects_site ON oibt_projects(site);
    CREATE INDEX IF NOT EXISTS idx_oibt_periodics_site ON oibt_periodics(site);
  `);
}
ensureSchema();

// Create project
app.post("/api/oibt/projects", async (req, res) => {
  const site = siteOf(req);
  if (!site) return res.status(400).json({ error: "Missing site" });
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "Missing title" });

  // Actions de base
  const actions = [
    { name: "Avis d'installation", done: false },
    { name: "Protocole de mesure", done: false },
    { name: "Rapport de sécurité", done: false },
  ];

  const r = await pool.query(
    `INSERT INTO oibt_projects (site, title, status)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [site, title, JSON.stringify(actions)]
  );
  res.json(r.rows[0]);
});

// Update project actions
app.put("/api/oibt/projects/:id", async (req, res) => {
  const site = siteOf(req);
  const id = Number(req.params.id);
  const { status } = req.body;
  const r = await pool.query(
    `UPDATE oibt_projects SET status=$1 WHERE id=$2 AND site=$3 RETURNING *`,
    [JSON.stringify(status), id, site]
  );
  res.json(r.rows[0]);
});

// Periodic controls
app.post("/api/oibt/periodics", async (req, res) => {
  const site = siteOf(req);
  const { building, report_url } = req.body;
  const r = await pool.query(
    `INSERT INTO oibt_periodics (site, building, report_url)
     VALUES ($1,$2,$3) RETURNING *`,
    [site, building, report_url]
  );
  res.json(r.rows[0]);
});

app.put("/api/oibt/periodics/:id", async (req, res) => {
  const site = siteOf(req);
  const id = Number(req.params.id);
  const { defect_report_received, confirmation_received } = req.body;
  const r = await pool.query(
    `UPDATE oibt_periodics 
     SET defect_report_received=$1, confirmation_received=$2 
     WHERE id=$3 AND site=$4 RETURNING *`,
    [defect_report_received, confirmation_received, id, site]
  );
  res.json(r.rows[0]);
});

const port = process.env.OIBT_PORT || 3012;
app.listen(port, () => console.log(`OIBT service running on :${port}`));
