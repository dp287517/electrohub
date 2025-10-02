// server_oibt.js
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import pg from "pg";
import multer from "multer";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// CORS basique (derrière proxy de server.js)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Site");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---- Helpers
function siteOf(req) {
  return (req.header("X-Site") || req.query.site || "").toString();
}

// Upload en mémoire (on stocke en base en BYTEA)
const upload = multer({ storage: multer.memoryStorage() });

// ---- Schema
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oibt_projects (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      status JSONB DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_projects_site ON oibt_projects(site);

    CREATE TABLE IF NOT EXISTS oibt_periodics (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      building TEXT NOT NULL,
      -- fichiers (PDF, …)
      report_file BYTEA,
      report_filename TEXT,
      report_mime TEXT,
      defect_file BYTEA,
      defect_filename TEXT,
      defect_mime TEXT,
      confirmation_file BYTEA,
      confirmation_filename TEXT,
      confirmation_mime TEXT,
      -- flags de suivi
      defect_report_received BOOLEAN DEFAULT FALSE,
      confirmation_received BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_periodics_site ON oibt_periodics(site);
    CREATE INDEX IF NOT EXISTS idx_oibt_periodics_building ON oibt_periodics(building);
  `);
}
ensureSchema().catch(e => console.error("[OIBT SCHEMA]", e));

// ---- Health
app.get("/api/oibt/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ============================================================================
// Projects (Avis d'installation, Protocole, Rapport sécurité => +6 mois réception)
// ============================================================================
app.get("/api/oibt/projects", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const q = String(req.query.q || "").trim().toLowerCase();

    const { rows } = await pool.query(
      q
        ? `SELECT * FROM oibt_projects WHERE site=$1 AND LOWER(title) LIKE $2 ORDER BY created_at DESC`
        : `SELECT * FROM oibt_projects WHERE site=$1 ORDER BY created_at DESC`,
      q ? [site, `%${q}%`] : [site]
    );
    res.json({ data: rows });
  } catch (e) {
    console.error("[OIBT PROJECTS LIST]", e);
    res.status(500).json({ error: "List failed" });
  }
});

app.post("/api/oibt/projects", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Missing title" });

    const baseActions = [
      { name: "Avis d'installation", done: false },
      { name: "Protocole de mesure", done: false },
      { name: "Rapport de sécurité", done: false },
    ];

    const r = await pool.query(
      `INSERT INTO oibt_projects (site, title, status) VALUES ($1,$2,$3) RETURNING *`,
      [site, title, JSON.stringify(baseActions)]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("[OIBT PROJECT CREATE]", e);
    res.status(500).json({ error: "Create failed" });
  }
});

app.put("/api/oibt/projects/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const id = Number(req.params.id);

    // On récupère l'état avant mise à jour
    const prevQ = await pool.query(
      `SELECT * FROM oibt_projects WHERE id=$1 AND site=$2`,
      [id, site]
    );
    if (!prevQ.rows.length) return res.status(404).json({ error: "Not found" });
    const prev = prevQ.rows[0];

    // Nouveau status
    const nextStatus = Array.isArray(req.body?.status) ? req.body.status : [];

    // Détection du passage à "done" du Rapport de sécurité
    const prevRS = (prev.status || []).find(a => a.name === "Rapport de sécurité");
    const nextRS = nextStatus.find(a => a.name === "Rapport de sécurité");
    const hadReception = nextStatus.some(a => a.name.startsWith("Contrôle de réception"));

    if (prevRS && nextRS && !prevRS.done && nextRS.done && !hadReception) {
      // Ajout auto d'une action "Contrôle de réception" + 6 mois
      const due = new Date();
      due.setMonth(due.getMonth() + 6);
      const fr = due.toLocaleDateString("fr-FR");
      nextStatus.push({
        name: "Contrôle de réception",
        done: false,
        due: fr,
      });
    }

    const r = await pool.query(
      `UPDATE oibt_projects SET status=$1 WHERE id=$2 AND site=$3 RETURNING *`,
      [JSON.stringify(nextStatus), id, site]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error("[OIBT PROJECT UPDATE]", e);
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/api/oibt/projects/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const id = Number(req.params.id);
    const r = await pool.query(
      `DELETE FROM oibt_projects WHERE id=$1 AND site=$2`,
      [id, site]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error("[OIBT PROJECT DELETE]", e);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ============================================================================
// Periodics (bâtiments + fichiers + flags)
// ============================================================================
app.get("/api/oibt/periodics", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const q = String(req.query.q || "").trim().toLowerCase();

    const { rows } = await pool.query(
      q
        ? `SELECT id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
                 (report_filename IS NOT NULL) AS has_report,
                 (defect_filename IS NOT NULL) AS has_defect,
                 (confirmation_filename IS NOT NULL) AS has_confirmation
           FROM oibt_periodics
           WHERE site=$1 AND LOWER(building) LIKE $2
           ORDER BY created_at DESC`
        : `SELECT id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
                 (report_filename IS NOT NULL) AS has_report,
                 (defect_filename IS NOT NULL) AS has_defect,
                 (confirmation_filename IS NOT NULL) AS has_confirmation
           FROM oibt_periodics
           WHERE site=$1
           ORDER BY created_at DESC`,
      q ? [site, `%${q}%`] : [site]
    );
    res.json({ data: rows });
  } catch (e) {
    console.error("[OIBT PERIODICS LIST]", e);
    res.status(500).json({ error: "List failed" });
  }
});

app.post("/api/oibt/periodics", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const building = String(req.body?.building || "").trim();
    if (!building) return res.status(400).json({ error: "Missing building" });

    const { rows } = await pool.query(
      `INSERT INTO oibt_periodics (site, building) VALUES ($1,$2) RETURNING
        id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
        false AS has_report, false AS has_defect, false AS has_confirmation`,
      [site, building]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("[OIBT PERIODIC CREATE]", e);
    res.status(500).json({ error: "Create failed" });
  }
});

app.put("/api/oibt/periodics/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const id = Number(req.params.id);
    const { defect_report_received, confirmation_received } = req.body;

    const { rows } = await pool.query(
      `UPDATE oibt_periodics
       SET defect_report_received = COALESCE($1, defect_report_received),
           confirmation_received = COALESCE($2, confirmation_received),
           updated_at = NOW()
       WHERE id=$3 AND site=$4
       RETURNING id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
         (report_filename IS NOT NULL) AS has_report,
         (defect_filename IS NOT NULL) AS has_defect,
         (confirmation_filename IS NOT NULL) AS has_confirmation`,
      [defect_report_received, confirmation_received, id, site]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("[OIBT PERIODIC UPDATE]", e);
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/api/oibt/periodics/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const id = Number(req.params.id);
    const r = await pool.query(
      `DELETE FROM oibt_periodics WHERE id=$1 AND site=$2`,
      [id, site]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error("[OIBT PERIODIC DELETE]", e);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Upload fichier (report | defect | confirmation)
app.post("/api/oibt/periodics/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: "Missing site" });
    const id = Number(req.params.id);
    const type = String(req.query.type || "").toLowerCase(); // report|defect|confirmation
    if (!["report", "defect", "confirmation"].includes(type)) {
      return res.status(400).json({ error: "Bad type" });
    }
    if (!req.file) return res.status(400).json({ error: "No file" });

    const buffer = req.file.buffer;
    const mime = req.file.mimetype;
    const fname = req.file.originalname;

    const setCols = {
      report: "report_file=$1, report_filename=$2, report_mime=$3",
      defect: "defect_file=$1, defect_filename=$2, defect_mime=$3, defect_report_received=TRUE",
      confirmation: "confirmation_file=$1, confirmation_filename=$2, confirmation_mime=$3, confirmation_received=TRUE",
    }[type];

    const { rows } = await pool.query(
      `UPDATE oibt_periodics
       SET ${setCols}, updated_at=NOW()
       WHERE id=$4 AND site=$5
       RETURNING id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
         (report_filename IS NOT NULL) AS has_report,
         (defect_filename IS NOT NULL) AS has_defect,
         (confirmation_filename IS NOT NULL) AS has_confirmation`,
      [buffer, fname, mime, id, site]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("[OIBT UPLOAD]", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Download fichier
app.get("/api/oibt/periodics/:id/download", async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).send("Missing site");
    const id = Number(req.params.id);
    const type = String(req.query.type || "").toLowerCase();

    const cols = {
      report: ["report_file", "report_filename", "report_mime"],
      defect: ["defect_file", "defect_filename", "defect_mime"],
      confirmation: ["confirmation_file", "confirmation_filename", "confirmation_mime"],
    }[type];
    if (!cols) return res.status(400).send("Bad type");

    const q = await pool.query(
      `SELECT ${cols.join(", ")} FROM oibt_periodics WHERE id=$1 AND site=$2`,
      [id, site]
    );
    if (!q.rows.length || !q.rows[0][cols[0]]) return res.status(404).send("File not found");

    const file = q.rows[0][cols[0]];
    const name = q.rows[0][cols[1]] || "fichier";
    const mime = q.rows[0][cols[2]] || "application/octet-stream";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(file);
  } catch (e) {
    console.error("[OIBT DOWNLOAD]", e);
    res.status(500).send("Download failed");
  }
});

const port = process.env.OIBT_PORT || 3012;
app.listen(port, () => console.log(`OIBT service running on :${port}`));
