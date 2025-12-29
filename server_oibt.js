// server_oibt.js (ESM)
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import pg from "pg";
import multer from "multer";
import { getSiteFilter } from "./lib/tenant-filter.js";
import { createAuditTrail, AUDIT_ACTIONS } from "./lib/audit-trail.js";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// 📝 AUDIT TRAIL - Initialize for OIBT module
const audit = createAuditTrail(pool, 'oibt');

const app = express();
app.use(helmet());
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

// CORS (utile en local ; derrière proxy en prod)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Site");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Site par défaut si X-Site manquant (évite listes vides au refresh)
const DEFAULT_SITE = process.env.OIBT_DEFAULT_SITE || "Nyon";
function siteOf(req) {
  return (
    (req.header("X-Site") || req.query.site || req.body?.site || "").toString() ||
    DEFAULT_SITE
  );
}

// Upload en mémoire (stockage DB BYTEA)
const upload = multer({ storage: multer.memoryStorage() });

/* ------------------------------------------------------------------ */
/*                               SCHEMA                               */
/* ------------------------------------------------------------------ */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oibt_projects (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      status JSONB DEFAULT '[]'::jsonb,
      year INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_projects_site ON oibt_projects(site);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oibt_periodics (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      building TEXT NOT NULL,

      -- compat ancien champ URL
      report_url TEXT,

      -- fichiers "dernier" pour compat
      report_file BYTEA,
      report_filename TEXT,
      report_mime TEXT,

      defect_file BYTEA,
      defect_filename TEXT,
      defect_mime TEXT,

      confirmation_file BYTEA,
      confirmation_filename TEXT,
      confirmation_mime TEXT,

      -- flags
      report_received BOOLEAN DEFAULT FALSE,
      defect_report_received BOOLEAN DEFAULT FALSE,
      confirmation_received BOOLEAN DEFAULT FALSE,

      -- horodatages utiles pour les alertes
      report_received_at TIMESTAMPTZ,
      defect_report_received_at TIMESTAMPTZ,
      confirmation_received_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      year INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_periodics_site ON oibt_periodics(site);
    CREATE INDEX IF NOT EXISTS idx_oibt_periodics_building ON oibt_periodics(building);
  `);

  // Pièces jointes PROJETS (multi-fichiers + 'sporadic')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oibt_project_files (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES oibt_projects(id) ON DELETE CASCADE,
      action_key TEXT NOT NULL,
      file BYTEA,
      filename TEXT,
      mime TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_projfiles_site ON oibt_project_files(site);
    CREATE INDEX IF NOT EXISTS idx_oibt_projfiles_proj ON oibt_project_files(project_id);
  `);

  // Migrations douces
  await pool.query(`ALTER TABLE oibt_project_files ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ DEFAULT NOW();`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oibt_project_files_project_id_action_key_key') THEN
        ALTER TABLE oibt_project_files DROP CONSTRAINT oibt_project_files_project_id_action_key_key;
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oibt_project_files_action_key_check') THEN
        ALTER TABLE oibt_project_files DROP CONSTRAINT oibt_project_files_action_key_check;
      END IF;
    END$$;
  `);
  await pool.query(`
    ALTER TABLE oibt_project_files
      ADD CONSTRAINT oibt_project_files_action_key_check
      CHECK (action_key IN ('avis','protocole','rapport','reception','sporadic'));
  `);

  // Périodiques : table d'historique multi-fichiers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oibt_periodic_files (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      periodic_id INTEGER NOT NULL REFERENCES oibt_periodics(id) ON DELETE CASCADE,
      file_type TEXT NOT NULL CHECK (file_type IN ('report','defect','confirmation')),
      file BYTEA,
      filename TEXT,
      mime TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_oibt_perfiles_site ON oibt_periodic_files(site);
    CREATE INDEX IF NOT EXISTS idx_oibt_perfiles_per ON oibt_periodic_files(periodic_id);
  `);

  // Backfill YEAR si manquant
  await pool.query(`UPDATE oibt_projects  SET year = EXTRACT(YEAR FROM created_at)::int WHERE year IS NULL;`);
  await pool.query(`UPDATE oibt_periodics SET year = EXTRACT(YEAR FROM created_at)::int WHERE year IS NULL;`);
}
ensureSchema().catch(e => console.error("[OIBT SCHEMA]", e));

/* ------------------------------------------------------------------ */
/*                         HELPERS ATTACHMENTS                        */
/* ------------------------------------------------------------------ */
async function projectAttachmentsMap(site, projectId) {
  const filesQ = await pool.query(
    `SELECT action_key, COUNT(*)>0 AS has_file
     FROM oibt_project_files
     WHERE site=$1 AND project_id=$2
     GROUP BY action_key`,
    [site, projectId]
  );
  const att = { avis: false, protocole: false, rapport: false, reception: false, sporadic: false };
  for (const row of filesQ.rows) {
    if (row.action_key in att) att[row.action_key] = row.has_file === true || row.has_file === "t";
  }
  return att;
}

/* ------------------------------------------------------------------ */
/*                               HEALTH                               */
/* ------------------------------------------------------------------ */
app.get("/api/oibt/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ------------------------------------------------------------------ */
/*                               PROJECTS                             */
/* ------------------------------------------------------------------ */
// LIST (+ attachments + last_uploads)
app.get("/api/oibt/projects", async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req);
    const site = siteName || siteOf(req);
    if (role === 'site' && !site) return res.status(400).json({ error: 'Missing site' });

    const q = String(req.query.q || "").trim().toLowerCase();
    const baseWhere = role === 'site' ? 'site=$1' : '1=1';
    const baseParams = role === 'site' ? [site] : [];

    const rows = (
      await pool.query(
        q
          ? `SELECT * FROM oibt_projects WHERE ${baseWhere} AND LOWER(title) LIKE $${baseParams.length + 1} ORDER BY created_at DESC`
          : `SELECT * FROM oibt_projects WHERE ${baseWhere} ORDER BY created_at DESC`,
        q ? [...baseParams, `%${q}%`] : baseParams
      )
    ).rows;

    if (!rows.length) return res.json({ data: [] });

    const ids = rows.map(r => r.id);

    // attachments flags
    const files = (
      await pool.query(
        `SELECT project_id, action_key, COUNT(*)>0 AS has_file
         FROM oibt_project_files
         WHERE site=$1 AND project_id = ANY($2)
         GROUP BY project_id, action_key`,
        [site, ids]
      )
    ).rows;
    const byProject = {};
    for (const f of files) {
      byProject[f.project_id] = byProject[f.project_id] || {};
      byProject[f.project_id][f.action_key] = f.has_file === true || f.has_file === "t";
    }

    // last_uploads (MAX(uploaded_at) par action)
    const lastQ = await pool.query(
      `SELECT project_id, action_key, MAX(uploaded_at) AS last_at
       FROM oibt_project_files
       WHERE site=$1 AND project_id = ANY($2)
       GROUP BY project_id, action_key`,
      [site, ids]
    );
    const lastByProject = {};
    for (const r of lastQ.rows) {
      lastByProject[r.project_id] = lastByProject[r.project_id] || {};
      const ts = r.last_at instanceof Date ? r.last_at.toISOString() : r.last_at;
      lastByProject[r.project_id][r.action_key] = ts;
    }

    const data = rows.map(r => ({
      ...r,
      attachments: {
        avis: !!byProject[r.id]?.avis,
        protocole: !!byProject[r.id]?.protocole,
        rapport: !!byProject[r.id]?.rapport,
        reception: !!byProject[r.id]?.reception,
        sporadic: !!byProject[r.id]?.sporadic,
      },
      last_uploads: lastByProject[r.id] || null,
    }));

    res.json({ data });
  } catch (e) {
    console.error("[OIBT PROJECTS LIST]", e);
    res.status(500).json({ error: "List failed" });
  }
});

// CREATE (4 étapes visibles d’emblée) + YEAR
app.post("/api/oibt/projects", async (req, res) => {
  try {
    const site = siteOf(req);
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Missing title" });

    const baseActions = [
      { key: "avis",       name: "Avis d'installation",  done: false },
      { key: "protocole",  name: "Protocole de mesure",  done: false },
      { key: "rapport",    name: "Rapport de sécurité",  done: false },
      { key: "reception",  name: "Contrôle de réception", done: false, due: null },
    ];

    const year = req.body?.year ?? new Date().getFullYear();

    const r = await pool.query(
      `INSERT INTO oibt_projects (site, title, status, year) VALUES ($1,$2,$3,$4) RETURNING *`,
      [site, title, JSON.stringify(baseActions), year]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("[OIBT PROJECT CREATE]", e);
    res.status(500).json({ error: "Create failed" });
  }
});

// UPDATE (+6 mois quand “Rapport de sécurité” passe à done) + YEAR
// + renvoie les attachments
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

    const prevRapport = (prev.status || []).find(a => (a.key === "rapport") || a.name === "Rapport de sécurité");
    const nextRapport = next.find(a => (a.key === "rapport") || a.name === "Rapport de sécurité");
    const receptionIdx = next.findIndex(a => (a.key === "reception") || a.name === "Contrôle de réception");

    if (prevRapport && nextRapport && !prevRapport.done && nextRapport.done) {
      if (receptionIdx >= 0) {
        const current = next[receptionIdx] || {};
        if (!current.due) {
          const due = new Date();
          due.setMonth(due.getMonth() + 6);
          next[receptionIdx] = { ...current, due: due.toLocaleDateString("fr-FR") };
        }
      } else {
        const due = new Date();
        due.setMonth(due.getMonth() + 6);
        next.push({
          key: "reception",
          name: "Contrôle de réception",
          done: false,
          due: due.toLocaleDateString("fr-FR"),
        });
      }
    }

    const newYear = req.body?.year ?? null;

    const r = await pool.query(
      `UPDATE oibt_projects SET status=$1, year=COALESCE($4, year) WHERE id=$2 AND site=$3 RETURNING *`,
      [JSON.stringify(next), id, site, newYear]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    const updated = r.rows[0];

    const attachments = await projectAttachmentsMap(site, id);

    res.json({ ...updated, attachments });
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

// UPLOAD fichier d'action de PROJET (avis|protocole|rapport|reception|sporadic)
app.post("/api/oibt/projects/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const action = String(req.query.action || "").toLowerCase();
    if (!["avis", "protocole", "rapport", "reception", "sporadic"].includes(action)) {
      return res.status(400).json({ error: "Bad action" });
    }
    if (!req.file) return res.status(400).json({ error: "No file" });

    // 1) Historiser un NOUVEAU fichier (multi-docs)
    await pool.query(
      `INSERT INTO oibt_project_files (site, project_id, action_key, file, filename, mime, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [site, id, action, req.file.buffer, req.file.originalname, req.file.mimetype]
    );

    // 2) Récupérer le projet et cocher l’étape
    const prevQ = await pool.query(`SELECT * FROM oibt_projects WHERE id=$1 AND site=$2`, [id, site]);
    if (!prevQ.rows.length) return res.status(404).json({ error: "Project not found" });
    const prev = prevQ.rows[0];
    const next = Array.isArray(prev.status) ? [...prev.status] : [];
    const idx = next.findIndex(a =>
      (a.key && a.key.toLowerCase() === action) ||
      (!a.key && a.name && a.name.toLowerCase().includes(action))
    );
    if (idx >= 0) next[idx] = { ...next[idx], done: true };
    else if (action === "sporadic") next.push({ key: "sporadic", name: "Contrôle sporadique", done: true });

    // 3) Si action = rapport => due réception +6 mois si absente
    const recIdx = next.findIndex(a => (a.key === "reception") || a.name === "Contrôle de réception");
    if (action === "rapport") {
      if (recIdx >= 0) {
        const current = next[recIdx] || {};
        if (!current.due) {
          const due = new Date();
          due.setMonth(due.getMonth() + 6);
          next[recIdx] = { ...current, due: due.toLocaleDateString("fr-FR") };
        }
      } else {
        const due = new Date();
        due.setMonth(due.getMonth() + 6);
        next.push({ key: "reception", name: "Contrôle de réception", done: false, due: due.toLocaleDateString("fr-FR") });
      }
    }

    // 4) Persister
    const upQ = await pool.query(
      `UPDATE oibt_projects SET status=$1 WHERE id=$2 AND site=$3 RETURNING *`,
      [JSON.stringify(next), id, site]
    );
    const updated = upQ.rows[0];
    const attachments = await projectAttachmentsMap(site, id);

    res.json({ ...updated, attachments });
  } catch (e) {
    console.error("[OIBT PROJECT UPLOAD]", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// DOWNLOAD dernier fichier d'action de PROJET
app.get("/api/oibt/projects/:id/download", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const action = String(req.query.action || "").toLowerCase();
    const q = await pool.query(
      `SELECT file, filename, mime FROM oibt_project_files
       WHERE site=$1 AND project_id=$2 AND action_key=$3
       ORDER BY uploaded_at DESC
       LIMIT 1`,
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

// LISTE de TOUS les fichiers d'une action de PROJET
app.get("/api/oibt/projects/:id/files", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const action = String(req.query.action || "").toLowerCase();
    if (!["avis", "protocole", "rapport", "reception", "sporadic"].includes(action)) {
      return res.status(400).json({ error: "Bad action" });
    }
    const q = await pool.query(
      `SELECT id, filename AS original_name, mime, uploaded_at, OCTET_LENGTH(file) AS size
       FROM oibt_project_files
       WHERE site=$1 AND project_id=$2 AND action_key=$3
       ORDER BY uploaded_at DESC`,
      [site, id, action]
    );
    res.json({ files: q.rows });
  } catch (e) {
    console.error("[OIBT PROJECT FILES LIST]", e);
    res.status(500).json({ error: "Files list failed" });
  }
});

// DOWNLOAD par file_id (PROJET)
app.get("/api/oibt/projects/download-file", async (req, res) => {
  try {
    const site = siteOf(req);
    const fileId = Number(req.query.file_id);
    if (!fileId) return res.status(400).send("Missing file_id");
    const q = await pool.query(
      `SELECT file, filename, mime FROM oibt_project_files WHERE id=$1 AND site=$2`,
      [fileId, site]
    );
    if (!q.rows.length || !q.rows[0].file) return res.status(404).send("File not found");
    const name = q.rows[0].filename || "fichier";
    const mime = q.rows[0].mime || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(q.rows[0].file);
  } catch (e) {
    console.error("[OIBT PROJECT DOWNLOAD BY ID]", e);
    res.status(500).send("Download failed");
  }
});

/* ------------------------------------------------------------------ */
/*                              PERIODICS                             */
/* ------------------------------------------------------------------ */
// LIST (flags + timestamps + YEAR)
app.get("/api/oibt/periodics", async (req, res) => {
  try {
    const { siteName, role } = getSiteFilter(req);
    const site = siteName || siteOf(req);
    if (role === 'site' && !site) return res.status(400).json({ error: 'Missing site' });

    const q = String(req.query.q || "").trim().toLowerCase();
    const baseWhere = role === 'site' ? 'site=$1' : '1=1';
    const baseParams = role === 'site' ? [site] : [];

    const { rows } = await pool.query(
      q
        ? `SELECT id, site, building, year,
                 report_received, defect_report_received, confirmation_received,
                 report_received_at, defect_report_received_at, confirmation_received_at,
                 created_at, updated_at,
                 (report_filename IS NOT NULL OR report_url IS NOT NULL) AS has_report,
                 (defect_filename IS NOT NULL) AS has_defect,
                 (confirmation_filename IS NOT NULL) AS has_confirmation
           FROM oibt_periodics
           WHERE ${baseWhere} AND LOWER(building) LIKE $${baseParams.length + 1}
           ORDER BY created_at DESC`
        : `SELECT id, site, building, year,
                 report_received, defect_report_received, confirmation_received,
                 report_received_at, defect_report_received_at, confirmation_received_at,
                 created_at, updated_at,
                 (report_filename IS NOT NULL OR report_url IS NOT NULL) AS has_report,
                 (defect_filename IS NOT NULL) AS has_defect,
                 (confirmation_filename IS NOT NULL) AS has_confirmation
           FROM oibt_periodics
           WHERE ${baseWhere}
           ORDER BY created_at DESC`,
      q ? [...baseParams, `%${q}%`] : baseParams
    );

    res.json({ data: rows });
  } catch (e) {
    console.error("[OIBT PERIODICS LIST]", e);
    res.status(500).json({ error: "List failed" });
  }
});

// CREATE + YEAR
app.post("/api/oibt/periodics", async (req, res) => {
  try {
    const site = siteOf(req);
    const building = String(req.body?.building || "").trim();
    if (!building) return res.status(400).json({ error: "Missing building" });

    const year = req.body?.year ?? new Date().getFullYear();

    const { rows } = await pool.query(
      `INSERT INTO oibt_periodics (site, building, year) VALUES ($1,$2,$3) RETURNING
        id, site, building, year,
        report_received, defect_report_received, confirmation_received,
        report_received_at, defect_report_received_at, confirmation_received_at,
        created_at, updated_at,
        false AS has_report, false AS has_defect, false AS has_confirmation`,
      [site, building, year]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("[OIBT PERIODIC CREATE]", e);
    res.status(500).json({ error: "Create failed" });
  }
});

// UPDATE (report/defect/confirmation flags + timestamps intelligents) + YEAR
app.put("/api/oibt/periodics/:id", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const { report_received, defect_report_received, confirmation_received } = req.body;
    const newYear = req.body?.year ?? null;

    const { rows } = await pool.query(
      `UPDATE oibt_periodics
       SET
         report_received = COALESCE($1, report_received),
         report_received_at = CASE WHEN $1 IS TRUE AND (report_received IS DISTINCT FROM TRUE) THEN NOW() ELSE report_received_at END,
         defect_report_received = COALESCE($2, defect_report_received),
         defect_report_received_at = CASE WHEN $2 IS TRUE AND (defect_report_received IS DISTINCT FROM TRUE) THEN NOW() ELSE defect_report_received_at END,
         confirmation_received = COALESCE($3, confirmation_received),
         confirmation_received_at = CASE WHEN $3 IS TRUE AND (confirmation_received IS DISTINCT FROM TRUE) THEN NOW() ELSE confirmation_received_at END,
         year = COALESCE($4, year),
         updated_at = NOW()
       WHERE id=$5 AND site=$6
       RETURNING id, site, building, year,
         report_received, defect_report_received, confirmation_received,
         report_received_at, defect_report_received_at, confirmation_received_at,
         created_at, updated_at,
         (report_filename IS NOT NULL OR report_url IS NOT NULL) AS has_report,
         (defect_filename IS NOT NULL) AS has_defect,
         (confirmation_filename IS NOT NULL) AS has_confirmation`,
      [report_received, defect_report_received, confirmation_received, newYear, id, site]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("[OIBT PERIODIC UPDATE]", e);
    res.status(500).json({ error: "Update failed" });
  }
});

// DELETE
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

// UPLOAD (report|defect|confirmation) : multi-fichiers + timestamps + compat
app.post("/api/oibt/periodics/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const type = String(req.query.type || "").toLowerCase();
    if (!["report", "defect", "confirmation"].includes(type)) {
      return res.status(400).json({ error: "Bad type" });
    }
    if (!req.file) return res.status(400).json({ error: "No file" });

    // Historiser CHAQUE fichier
    await pool.query(
      `INSERT INTO oibt_periodic_files (site, periodic_id, file_type, file, filename, mime, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [site, id, type, req.file.buffer, req.file.originalname, req.file.mimetype]
    );

    // Conserver aussi le "dernier" pour compat UI
    const setCols = {
      report: "report_file=$1, report_filename=$2, report_mime=$3, report_received=TRUE, report_received_at=COALESCE(report_received_at, NOW())",
      defect: "defect_file=$1, defect_filename=$2, defect_mime=$3, defect_report_received=TRUE, defect_report_received_at=COALESCE(defect_report_received_at, NOW())",
      confirmation: "confirmation_file=$1, confirmation_filename=$2, confirmation_mime=$3, confirmation_received=TRUE, confirmation_received_at=COALESCE(confirmation_received_at, NOW())",
    }[type];

    const { rows } = await pool.query(
      `UPDATE oibt_periodics
       SET ${setCols}, updated_at=NOW()
       WHERE id=$4 AND site=$5
       RETURNING id, site, building, year,
         report_received, defect_report_received, confirmation_received,
         report_received_at, defect_report_received_at, confirmation_received_at,
         created_at, updated_at,
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

// DOWNLOAD (dernier fichier) pour compat
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

    if (type === "report" && q.rows[0].report_url && !q.rows[0].report_file) {
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

// LISTE de TOUS les fichiers d’un périodique (par type)
app.get("/api/oibt/periodics/:id/files", async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const type = String(req.query.type || "").toLowerCase();
    if (!["report", "defect", "confirmation"].includes(type)) {
      return res.status(400).json({ error: "Bad type" });
    }
    const q = await pool.query(
      `SELECT id, filename AS original_name, mime, uploaded_at, OCTET_LENGTH(file) AS size
       FROM oibt_periodic_files
       WHERE site=$1 AND periodic_id=$2 AND file_type=$3
       ORDER BY uploaded_at DESC`,
      [site, id, type]
    );
    res.json({ files: q.rows });
  } catch (e) {
    console.error("[OIBT PERIODIC FILES LIST]", e);
    res.status(500).json({ error: "Files list failed" });
  }
});

// DOWNLOAD par file_id (PÉRIODIQUE)
app.get("/api/oibt/periodics/download-file", async (req, res) => {
  try {
    const site = siteOf(req);
    const fileId = Number(req.query.file_id);
    if (!fileId) return res.status(400).send("Missing file_id");
    const q = await pool.query(
      `SELECT file, filename, mime FROM oibt_periodic_files WHERE id=$1 AND site=$2`,
      [fileId, site]
    );
    if (!q.rows.length || !q.rows[0].file) return res.status(404).send("File not found");
    const name = q.rows[0].filename || "fichier";
    const mime = q.rows[0].mime || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(q.rows[0].file);
  } catch (e) {
    console.error("[OIBT PERIODIC DOWNLOAD BY ID]", e);
    res.status(500).send("Download failed");
  }
});

// ------------------------------------------------------------------
// CONTRÔLES À VENIR
// ------------------------------------------------------------------
app.get("/api/oibt/periodics/upcoming", async (req, res) => {
  try {
    const site = siteOf(req);
    const currentYear = new Date().getFullYear();

    const { rows } = await pool.query(
      `SELECT id, site, building, year, created_at, updated_at
       FROM oibt_periodics
       WHERE site=$1
       ORDER BY building, year DESC`,
      [site]
    );

    // Regrouper par bâtiment et calculer la prochaine échéance
    const byBuilding = {};
    for (const r of rows) {
      byBuilding[r.building] = byBuilding[r.building] || [];
      byBuilding[r.building].push(r);
    }

    const upcoming = Object.entries(byBuilding).map(([building, history]) => {
      history.sort((a, b) => b.year - a.year);
      const last = history[0];
      const interval = building.toLowerCase().includes("atex") ? 3 : 5;
      const nextYear = (last?.year || currentYear) + interval;
      return {
        building,
        last_id: last?.id || null,
        last_year: last?.year || null,
        next_due_year: nextYear,
        next_due_in: nextYear - currentYear,
        history,
      };
    });

    res.json({ data: upcoming });
  } catch (e) {
    console.error("[OIBT UPCOMING]", e);
    res.status(500).json({ error: "Upcoming failed" });
  }
});

// ------------------------------------------------------------------
// VUE PAR BÂTIMENT : années + avancement + prochain contrôle
// ------------------------------------------------------------------
app.get("/api/oibt/periodics/buildings", async (req, res) => {
  try {
    const site = siteOf(req);
    const currentYear = new Date().getFullYear();

    // Récupérer tous les périodiques du site
    const { rows } = await pool.query(
      `SELECT id, building, year,
              report_received, defect_report_received, confirmation_received,
              report_received_at, defect_report_received_at, confirmation_received_at,
              created_at
       FROM oibt_periodics
       WHERE site=$1
       ORDER BY building, year DESC`,
      [site]
    );

    if (!rows.length) return res.json({ data: [] });

    // Regrouper par bâtiment
    const byBuilding = {};
    for (const r of rows) {
      byBuilding[r.building] = byBuilding[r.building] || [];
      byBuilding[r.building].push(r);
    }

    // Calcul du % d’avancement et de la prochaine échéance
    const result = Object.entries(byBuilding).map(([building, history]) => {
      history.sort((a, b) => b.year - a.year);
      const last = history[0];
      const interval = building.toLowerCase().includes("atex") ? 3 : 5;
      const nextDueYear = (last?.year || currentYear) + interval;

      const years = history.map(h => {
        const total = 3;
        const done = [h.report_received, h.defect_report_received, h.confirmation_received].filter(Boolean).length;
        const progress = Math.round((done / total) * 100);
        return {
          id: h.id,
          year: h.year,
          progress,
          report_received: h.report_received,
          defect_report_received: h.defect_report_received,
          confirmation_received: h.confirmation_received,
          report_received_at: h.report_received_at,
          defect_report_received_at: h.defect_report_received_at,
          confirmation_received_at: h.confirmation_received_at,
          created_at: h.created_at
        };
      });

      return {
        building,
        next_due_year: nextDueYear,
        years
      };
    });

    res.json({ data: result });
  } catch (e) {
    console.error("[OIBT BUILDINGS VIEW]", e);
    res.status(500).json({ error: "Buildings view failed" });
  }
});

/* ------------------------------------------------------------------ */
/*                                START                               */
/* ------------------------------------------------------------------ */
const port = process.env.OIBT_PORT || 3012;
app.listen(port, () => console.log(`OIBT service running on :${port}`));
