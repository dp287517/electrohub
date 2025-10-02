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
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

// CORS (proxifié par server.js, mais utile en local)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Site");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const DEFAULT_SITE = process.env.OIBT_DEFAULT_SITE || "Nyon";
function siteOf(req) {
  return (
    (req.header("X-Site") || req.query.site || req.body?.site || "").toString() ||
    DEFAULT_SITE
  );
}

const upload = multer({ storage: multer.memoryStorage() });

/* ------------------------------------------------------------------ */
/*                             SCHEMA                                 */
/* ------------------------------------------------------------------ */
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
      -- anciens champs compat
      report_url TEXT,
      -- nouveaux champs fichiers
      report_file BYTEA,
      report_filename TEXT,
      report_mime TEXT,
      defect_file BYTEA,
      defect_filename TEXT,
      defect_mime TEXT,
      confirmation_file BYTEA,
      confirmation_filename TEXT,
      confirmation_mime TEXT,
      defect_report_received BOOLEAN DEFAULT FALSE,
      confirmation_received BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_periodics_site ON oibt_periodics(site);
    CREATE INDEX IF NOT EXISTS idx_oibt_periodics_building ON oibt_periodics(building);
  `);

  // Table fichiers par action de projet (avis, protocole, rapport, reception)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oibt_project_files (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES oibt_projects(id) ON DELETE CASCADE,
      action_key TEXT NOT NULL CHECK (action_key IN ('avis','protocole','rapport','reception')),
      file BYTEA,
      filename TEXT,
      mime TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (project_id, action_key)
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_projfiles_site ON oibt_project_files(site);
  `);

  // Sécurise l'existence des colonnes pour compatibilité (si table déjà créée avant)
  await pool.query(`
    ALTER TABLE oibt_periodics
      ADD COLUMN IF NOT EXISTS report_url TEXT,
      ADD COLUMN IF NOT EXISTS report_file BYTEA,
      ADD COLUMN IF NOT EXISTS report_filename TEXT,
      ADD COLUMN IF NOT EXISTS report_mime TEXT,
      ADD COLUMN IF NOT EXISTS defect_file BYTEA,
      ADD COLUMN IF NOT EXISTS defect_filename TEXT,
      ADD COLUMN IF NOT EXISTS defect_mime TEXT,
      ADD COLUMN IF NOT EXISTS confirmation_file BYTEA,
      ADD COLUMN IF NOT EXISTS confirmation_filename TEXT,
      ADD COLUMN IF NOT EXISTS confirmation_mime TEXT,
      ADD COLUMN IF NOT EXISTS defect_report_received BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS confirmation_received BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
  `);
}
ensureSchema().catch(e => console.error("[OIBT SCHEMA]", e));

/* ------------------------------------------------------------------ */
/*                             HEALTH                                  */
/* ------------------------------------------------------------------ */
app.get("/api/oibt/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ------------------------------------------------------------------ */
/*                             PROJECTS                                */
/* ------------------------------------------------------------------ */
// LIST
app.get("/api/oibt/projects", async (req, res) => {
  try {
    const site = siteOf(req);
    const q = String(req.query.q || "").trim().toLowerCase();
    const rows = (
      await pool.query(
        q
          ? `SELECT * FROM oibt_projects WHERE site=$1 AND LOWER(title) LIKE $2 ORDER BY created_at DESC`
          : `SELECT * FROM oibt_projects WHERE site=$1 ORDER BY created_at DESC`,
        q ? [site, `%${q}%`] : [site]
      )
    ).rows;

    if (!rows.length) return res.json({ data: [] });

    const ids = rows.map(r => r.id);
    const files = (
      await pool.query(
        `SELECT project_id, action_key, (filename IS NOT NULL) AS has_file
         FROM oibt_project_files
         WHERE site=$1 AND project_id = ANY($2)`,
        [site, ids]
      )
    ).rows;

    const byProject = {};
    for (const f of files) {
      byProject[f.project_id] = byProject[f.project_id] || {};
      byProject[f.project_id][f.action_key] = !!f.has_file;
    }

    // assemble flags
    const data = rows.map(r => ({
      ...r,
      attachments: {
        avis: !!byProject[r.id]?.avis,
        protocole: !!byProject[r.id]?.protocole,
        rapport: !!byProject[r.id]?.rapport,
        reception: !!byProject[r.id]?.reception,
      },
    }));
    res.json({ data });
  } catch (e) {
    console.error("[OIBT PROJECTS LIST]", e);
    res.status(500).json({ error: "List failed" });
  }
});

// CREATE
app.post("/api/oibt/projects", async (req, res) => {
  try {
    const site = siteOf(req);
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Missing title" });

    const baseActions = [
      { key: "avis", name: "Avis d'installation", done: false },
      { key: "protocole", name: "Protocole de mesure", done: false },
      { key: "rapport", name: "Rapport de sécurité", done: false },
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

// UPDATE (ajout auto réception J+180 quand "rapport" passe à done)
app.put("/api/oibt/projects/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);

    const prevQ = await pool.query(
      `SELECT * FROM oibt_projects WHERE id=$1 AND site=$2`,
      [id, site]
    );
    if (!prevQ.rows.length) return res.status(404).json({ error: "Not found" });
    const prev = prevQ.rows[0];
    const next = Array.isArray(req.body?.status) ? req.body.status : [];

    const prevRapport = (prev.status || []).find(a => a.key === "rapport" || a.name === "Rapport de sécurité");
    const nextRapport = next.find(a => a.key === "rapport" || a.name === "Rapport de sécurité");
    const hasReception = next.some(a => (a.key === "reception") || a.name?.startsWith("Contrôle de réception"));

    if (prevRapport && nextRapport && !prevRapport.done && nextRapport.done && !hasReception) {
      const due = new Date();
      due.setMonth(due.getMonth() + 6);
      const fr = due.toLocaleDateString("fr-FR");
      next.push({ key: "reception", name: "Contrôle de réception", done: false, due: fr });
    }

    const r = await pool.query(
      `UPDATE oibt_projects SET status=$1 WHERE id=$2 AND site=$3 RETURNING *`,
      [JSON.stringify(next), id, site]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error("[OIBT PROJECT UPDATE]", e);
    res.status(500).json({ error: "Update failed" });
  }
});

// DELETE
app.delete("/api/oibt/projects/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const r = await pool.query(`DELETE FROM oibt_projects WHERE id=$1 AND site=$2`, [id, site]);
    if (!r.rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[OIBT PROJECT DELETE]", e);
    res.status(500).json({ error: "Delete failed" });
  }
});

// UPLOAD fichier d'action (avis|protocole|rapport|reception)
app.post("/api/oibt/projects/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const action = String(req.query.action || "").toLowerCase();
    if (!["avis", "protocole", "rapport", "reception"].includes(action)) {
      return res.status(400).json({ error: "Bad action" });
    }
    if (!req.file) return res.status(400).json({ error: "No file" });

    await pool.query(
      `INSERT INTO oibt_project_files (site, project_id, action_key, file, filename, mime)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, action_key) DO UPDATE SET
         file=EXCLUDED.file, filename=EXCLUDED.filename, mime=EXCLUDED.mime, uploaded_at=NOW()`,
      [site, id, action, req.file.buffer, req.file.originalname, req.file.mimetype]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[OIBT PROJECT UPLOAD]", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// DOWNLOAD fichier d'action
app.get("/api/oibt/projects/:id/download", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const action = String(req.query.action || "").toLowerCase();
    const q = await pool.query(
      `SELECT file, filename, mime FROM oibt_project_files
       WHERE site=$1 AND project_id=$2 AND action_key=$3`,
      [site, id, action]
    );
    if (!q.rows.length || !q.rows[0].file) return res.status(404).send("File not found");
    res.setHeader("Content-Type", q.rows[0].mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(q.rows[0].filename || "file")}"`);
    res.send(q.rows[0].file);
  } catch (e) {
    console.error("[OIBT PROJECT DOWNLOAD]", e);
    res.status(500).send("Download failed");
  }
});

/* ------------------------------------------------------------------ */
/*                           PERIODICS                                 */
/* ------------------------------------------------------------------ */
// LIST (tolérant anciens & nouveaux champs)
app.get("/api/oibt/periodics", async (req, res) => {
  try {
    const site = siteOf(req);
    const q = String(req.query.q || "").trim().toLowerCase();

    const { rows } = await pool.query(
      q
        ? `SELECT id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
                 (report_filename IS NOT NULL OR report_url IS NOT NULL) AS has_report,
                 (defect_filename IS NOT NULL) AS has_defect,
                 (confirmation_filename IS NOT NULL) AS has_confirmation
           FROM oibt_periodics
           WHERE site=$1 AND LOWER(building) LIKE $2
           ORDER BY created_at DESC`
        : `SELECT id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
                 (report_filename IS NOT NULL OR report_url IS NOT NULL) AS has_report,
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
    const id = Number(req.params.id);
    const { defect_report_received, confirmation_received } = req.body;

    const { rows } = await pool.query(
      `UPDATE oibt_periodics
       SET defect_report_received = COALESCE($1, defect_report_received),
           confirmation_received = COALESCE($2, confirmation_received),
           updated_at = NOW()
       WHERE id=$3 AND site=$4
       RETURNING id, site, building, defect_report_received, confirmation_received, created_at, updated_at,
         (report_filename IS NOT NULL OR report_url IS NOT NULL) AS has_report,
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
    const id = Number(req.params.id);
    const r = await pool.query(`DELETE FROM oibt_periodics WHERE id=$1 AND site=$2`, [id, site]);
    if (!r.rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[OIBT PERIODIC DELETE]", e);
    res.status(500).json({ error: "Delete failed" });
  }
});

app.post("/api/oibt/periodics/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const type = String(req.query.type || "").toLowerCase(); // report|defect|confirmation
    if (!["report", "defect", "confirmation"].includes(type)) {
      return res.status(400).json({ error: "Bad type" });
    }
    if (!req.file) return res.status(400).json({ error: "No file" });

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
         (report_filename IS NOT NULL OR report_url IS NOT NULL) AS has_report,
         (defect_filename IS NOT NULL) AS has_defect,
         (confirmation_filename IS NOT NULL) AS has_confirmation`,
      [req.file.buffer, req.file.originalname, req.file.mimetype, id, site]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("[OIBT UPLOAD]", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/api/oibt/periodics/:id/download", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const type = String(req.query.type || "").toLowerCase();

    const cols = {
      report: ["report_file", "report_filename", "report_mime", "report_url"],
      defect: ["defect_file", "defect_filename", "defect_mime"],
      confirmation: ["confirmation_file", "confirmation_filename", "confirmation_mime"],
    }[type];
    if (!cols) return res.status(400).send("Bad type");

    const q = await pool.query(
      `SELECT ${cols.join(", ")} FROM oibt_periodics WHERE id=$1 AND site=$2`,
      [id, site]
    );
    if (!q.rows.length) return res.status(404).send("Not found");

    // si ancien champ report_url existe et pas de fichier binaire
    if (type === "report" && q.rows[0].report_url) {
      return res.redirect(q.rows[0].report_url);
    }

    const file = q.rows[0][cols[0]];
    if (!file) return res.status(404).send("File not found");
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
