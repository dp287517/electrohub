// ==============================
// server_atex.jsx — ATEX CMMS microservice (ESM)
// Port: 3001
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
import crypto from "crypto";
import archiver from "archiver";
import StreamZip from "node-stream-zip"; // ⬅️ remplace AdmZip
import PDFDocument from "pdfkit";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// --- OpenAI (extraction & conformité)
const { OpenAI } = await import("openai");

// ------------------------------
// Boot & dirs
// ------------------------------
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.ATEX_PORT || 3001);
const HOST = process.env.ATEX_HOST || "0.0.0.0";

const DATA_DIR = process.env.ATEX_DATA_DIR || path.resolve(__dirname, "./_data_atex");
const FILES_DIR = path.join(DATA_DIR, "files");
const MAPS_INCOMING_DIR = path.join(DATA_DIR, "maps_incoming");
const MAPS_DIR = path.join(DATA_DIR, "maps");

for (const d of [DATA_DIR, FILES_DIR, MAPS_DIR, MAPS_INCOMING_DIR]) {
  await fsp.mkdir(d, { recursive: true });
}

// ------------------------------
// Express
// ------------------------------
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
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

// X-User-* (comme Doors) → identify
function getUser(req) {
  const name = req.header("X-User-Name") || null;
  const email = req.header("X-User-Email") || null;
  return { name, email };
}

// ------------------------------
// Uploads
// ------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const uploadZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_INCOMING_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

// ------------------------------
// DB
// ------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.ATEX_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres",
  max: 10,
});

// ------------------------------
// Schema
// ------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Equipements ATEX
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      equipment TEXT DEFAULT '',          -- niveau "equipement Becomix"
      sub_equipment TEXT DEFAULT '',      -- niveau sous-équipement (tracé)
      type TEXT DEFAULT '',               -- interrupteur, luminaire, etc.
      manufacturer TEXT DEFAULT '',
      manufacturer_ref TEXT DEFAULT '',
      atex_mark_gas TEXT DEFAULT NULL,    -- ex. II 2G Ex db IIB T4 Gb ...
      atex_mark_dust TEXT DEFAULT NULL,   -- ex. II 2D Ex tb IIIC T85°C Db ...
      comment TEXT DEFAULT '',
      status TEXT DEFAULT 'a_faire',      -- a_faire / en_cours_30 / en_retard / fait
      installed_at TIMESTAMP NULL,
      next_check_date DATE NULL,
      photo_path TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_eq_next ON atex_equipments(next_check_date);
  `);

  // Checklists (historique)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'a_faire',
      date TIMESTAMP DEFAULT now(),
      items JSONB DEFAULT '[]'::jsonb,
      result TEXT DEFAULT NULL,           -- conforme / non_conforme / null
      user_name TEXT DEFAULT '',
      user_email TEXT DEFAULT '',
      files JSONB DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_atex_checks_eq ON atex_checks(equipment_id);
  `);

  // Fichiers liés
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      uploaded_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_files_eq ON atex_files(equipment_id);
  `);

  // Plans (mêmes structures que Doors)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL
    );
    CREATE INDEX IF NOT EXISTS idx_atex_plans_logical ON atex_plans(logical_name);

    CREATE TABLE IF NOT EXISTS atex_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `);

  // Positions (markers équipements sur plans)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      UNIQUE (equipment_id, logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_atex_positions_lookup ON atex_positions(logical_name, page_index);
  `);

  // Sous-zones (dessin)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_subareas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,                 -- rect | circle | poly
      x1 NUMERIC NULL, y1 NUMERIC NULL,
      x2 NUMERIC NULL, y2 NUMERIC NULL,
      cx NUMERIC NULL, cy NUMERIC NULL, r NUMERIC NULL,
      points JSONB NULL,                  -- [[x,y],...]
      name TEXT DEFAULT '',
      zoning_gas INTEGER NULL,            -- 0 / 1 / 2
      zoning_dust INTEGER NULL,           -- 20 / 21 / 22
      created_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_atex_subareas_lookup ON atex_subareas(logical_name, page_index);
  `);

  // Paramètres (fréquence contrôle…)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT '36_mois',     -- 36 mois
      checklist_template JSONB NOT NULL DEFAULT '[
        "Plaque de marquage ATEX lisible et complète ?",
        "Environnement libre de dépôts/obstructions (poussières) ?",
        "Câblage et presse-étoupes adaptés au zonage ?",
        "Étanchéité / boîtier intact (chocs/corrosion) ?",
        "Documentation disponible (certificats/conformité) ?"
      ]'::jsonb
    );
    INSERT INTO atex_settings(id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);
}

// ------------------------------
// Helpers
// ------------------------------
function eqStatusFromDue(due) {
  if (!due) return "a_faire";
  const d = new Date(due);
  const now = new Date();
  const diff = (d - now) / (1000 * 3600 * 24);
  if (diff < 0) return "en_retard";
  if (diff <= 30) return "en_cours_30";
  return "a_faire";
}
function addMonths(date, m) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + m);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fileUrlFromPath(p) {
  return `/api/atex/file?path=${encodeURIComponent(p)}`;
}

// ------------------------------
// Static file read endpoint (download/inline)
// ------------------------------
app.get("/api/atex/file", async (req, res) => {
  try {
    const p = String(req.query.path || "");
    const abs = path.resolve(p);
    if (!abs.startsWith(DATA_DIR)) return res.status(403).json({ ok: false });
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false });
    res.sendFile(abs);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// 🔹 ATEX — CRUD équipements
// ========================================================================
app.get("/api/atex/equipments", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const { rows } = await pool.query(
      `
      SELECT e.*, 
             COALESCE((SELECT MAX(date) FROM atex_checks c WHERE c.equipment_id=e.id), NULL) AS last_check_date
      FROM atex_equipments e
      ORDER BY e.created_at DESC
      `
    );
    const items = rows
      .filter((r) => {
        if (!q) return true;
        const hay = [r.name, r.building, r.zone, r.equipment, r.sub_equipment, r.type]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .map((r) => ({
        ...r,
        status: eqStatusFromDue(r.next_check_date),
        photo_url: r.photo_path ? fileUrlFromPath(r.photo_path) : null,
      }));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
    const eq = rows?.[0] || null;
    if (!eq) return res.status(404).json({ ok: false, error: "not found" });
    eq.photo_url = eq.photo_path ? fileUrlFromPath(eq.photo_path) : null;
    res.json({ equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/atex/equipments", async (req, res) => {
  try {
    const {
      name = "",
      building = "",
      zone = "",
      equipment = "",
      sub_equipment = "",
      type = "",
      manufacturer = "",
      manufacturer_ref = "",
      atex_mark_gas = null,
      atex_mark_dust = null,
      comment = "",
      installed_at = null,
    } = req.body || {};

    // Règles: demande d’inspection dans les 90 jours après installation (ou, si pas fourni, dès maintenant+90j)
    const installDate = installed_at ? new Date(installed_at) : new Date();
    const firstDue = addDays(installDate, 90);
    const { rows } = await pool.query(
      `
      INSERT INTO atex_equipments 
        (name, building, zone, equipment, sub_equipment, type, manufacturer, manufacturer_ref, atex_mark_gas, atex_mark_dust, comment, installed_at, next_check_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
      `,
      [
        name || "Équipement ATEX",
        building,
        zone,
        equipment,
        sub_equipment,
        type,
        manufacturer,
        manufacturer_ref,
        atex_mark_gas,
        atex_mark_dust,
        comment,
        installDate,
        firstDue,
      ]
    );
    const eq = rows[0];
    eq.photo_url = null;
    res.json({ equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const fields = [
      "name",
      "building",
      "zone",
      "equipment",
      "sub_equipment",
      "type",
      "manufacturer",
      "manufacturer_ref",
      "atex_mark_gas",
      "atex_mark_dust",
      "comment",
      "installed_at",
      "next_check_date",
      "status",
    ];
    const set = [];
    const values = [];
    let i = 1;
    for (const k of fields) {
      if (k in req.body) {
        set.push(`${k}=$${i++}`);
        values.push(req.body[k]);
      }
    }
    if (!set.length) return res.json({ ok: true });
    values.push(id);
    await pool.query(`UPDATE atex_equipments SET ${set.join(", ")}, updated_at=now() WHERE id=$${i}`, values);
    const { rows } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
    const eq = rows?.[0] || null;
    if (eq) eq.photo_url = eq.photo_path ? fileUrlFromPath(eq.photo_path) : null;
    res.json({ equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/atex/equipments/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    await pool.query(`DELETE FROM atex_equipments WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Photo principale
app.post("/api/atex/equipments/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "no file" });
    await pool.query(`UPDATE atex_equipments SET photo_path=$1, updated_at=now() WHERE id=$2`, [file.path, id]);
    res.json({ ok: true, url: fileUrlFromPath(file.path) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/atex/equipments/:id/photo", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(`SELECT photo_path FROM atex_equipments WHERE id=$1`, [id]);
    const p = rows?.[0]?.photo_path || null;
    if (!p) return res.status(404).end();
    res.sendFile(path.resolve(p));
  } catch {
    res.status(404).end();
  }
});

// Fichiers liés
app.get("/api/atex/equipments/:id/files", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM atex_files WHERE equipment_id=$1 ORDER BY uploaded_at DESC`, [id]);
    const files = rows.map((r) => ({
      id: r.id,
      original_name: r.original_name,
      mime: r.mime,
      download_url: fileUrlFromPath(r.file_path),
      inline_url: fileUrlFromPath(r.file_path),
    }));
    res.json({ files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.post("/api/atex/equipments/:id/files", upload.array("files"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const files = req.files || [];
    for (const f of files) {
      await pool.query(
        `INSERT INTO atex_files (equipment_id, original_name, mime, file_path) VALUES ($1,$2,$3,$4)`,
        [id, f.originalname, f.mimetype, f.path]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.delete("/api/atex/files/:fileId", async (req, res) => {
  try {
    const id = String(req.params.fileId);
    const { rows } = await pool.query(`DELETE FROM atex_files WHERE id=$1 RETURNING file_path`, [id]);
    const fp = rows?.[0]?.file_path;
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// 🔹 Checklists & calendrier
// ========================================================================
app.get("/api/atex/settings", async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM atex_settings WHERE id=1`);
    res.json(rows?.[0] || {});
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.put("/api/atex/settings", async (req, res) => {
  try {
    const { frequency, checklist_template } = req.body || {};
    await pool.query(
      `UPDATE atex_settings SET frequency=COALESCE($1, frequency), checklist_template=COALESCE($2, checklist_template) WHERE id=1`,
      [frequency || null, Array.isArray(checklist_template) ? JSON.stringify(checklist_template) : null]
    );
    const { rows } = await pool.query(`SELECT * FROM atex_settings WHERE id=1`);
    res.json(rows?.[0] || {});
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// démarre un contrôle (crée un check courant)
app.post("/api/atex/equipments/:id/checks", async (req, res) => {
  try {
    const id = String(req.params.id);
    const u = getUser(req);
    const { rows } = await pool.query(
      `INSERT INTO atex_checks(equipment_id, status, user_name, user_email) VALUES($1,'a_faire',$2,$3) RETURNING *`,
      [id, u.name || "", u.email || ""]
    );
    res.json({ check: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// met à jour les points, close si demandé
app.put("/api/atex/equipments/:id/checks/:checkId", upload.array("files"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const checkId = String(req.params.checkId);

    let items = [];
    let close = false;
    if (req.is("multipart/form-data")) {
      items = JSON.parse(req.body.items || "[]");
      close = String(req.body.close || "false") === "true";
    } else {
      items = req.body.items || [];
      close = !!req.body.close;
    }

    let filesArr = [];
    const files = req.files || [];
    for (const f of files) {
      filesArr.push({ name: f.originalname, mime: f.mimetype, path: f.path, url: fileUrlFromPath(f.path) });
    }

    let result = null;
    const values = [JSON.stringify(items), JSON.stringify(filesArr), checkId];
    await pool.query(`UPDATE atex_checks SET items=$1, files=$2 WHERE id=$3`, values);

    if (close) {
      // compute result: conforme si aucune "non_conforme" parmi 5 points
      const values2 = await pool.query(`SELECT items FROM atex_checks WHERE id=$1`, [checkId]);
      const its = values2?.rows?.[0]?.items || [];
      const vals = (its || []).slice(0, 5).map((i) => i?.value).filter(Boolean);
      const hasNC = vals.includes("non_conforme");
      result = hasNC ? "non_conforme" : vals.length ? "conforme" : null;

      // 36 mois plus tard, alerte 90j avant
      const { rows: eqRows } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
      const eq = eqRows?.[0];
      const nextDate = addMonths(new Date(), 36);
      await pool.query(`UPDATE atex_equipments SET next_check_date=$1, updated_at=now() WHERE id=$2`, [nextDate, id]);

      await pool.query(`UPDATE atex_checks SET status='fait', result=$1, date=now() WHERE id=$2`, [result, checkId]);
    }

    const { rows: eqR } = await pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [id]);
    const equipment = eqR?.[0] || null;
    if (equipment) equipment.photo_url = equipment.photo_path ? fileUrlFromPath(equipment.photo_path) : null;

    res.json({ ok: true, equipment, notice: close ? "Contrôle clôturé." : null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/atex/equipments/:id/history", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM atex_checks WHERE equipment_id=$1 ORDER BY date DESC`, [id]);
    res.json({ checks: rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// calendrier (prochains contrôles)
app.get("/api/atex/calendar", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id as equipment_id, name as equipment_name, next_check_date as date
      FROM atex_equipments
      WHERE next_check_date IS NOT NULL
      ORDER BY next_check_date ASC
    `);
  const events = (rows || []).map((r) => ({
      date: r.date,
      equipment_id: r.equipment_id,
      equipment_name: r.equipment_name,
      status: eqStatusFromDue(r.date),
    }));
    res.json({ events });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// 🔹 MAPS — Upload ZIP + list + rename + file URL
// ========================================================================
app.post("/api/atex/maps/uploadZip", uploadZip.single("zip"), async (req, res) => {
  try {
    const zipPath = req.file?.path;
    if (!zipPath) return res.status(400).json({ ok: false, error: "zip missing" });

    // ⬇️ Remplacement AdmZip → node-stream-zip (async)
    const zip = new StreamZip.async({ file: zipPath });
    const imported = [];
    try {
      const entries = await zip.entries();
      for (const [entryName, entry] of Object.entries(entries)) {
        if (entry.isDirectory) continue;
        if (!entryName.toLowerCase().endsWith(".pdf")) continue;

        const base = path.basename(entryName, ".pdf");
        const logical = base.replace(/[^\w.-]+/g, "_").toLowerCase();
        const version = Number(Date.now()); // version horodatée (même logique que l’actuel)

        const dest = path.join(MAPS_DIR, `${logical}__${version}.pdf`);
        const buf = await zip.entryData(entry);
        await fsp.writeFile(dest, buf);

        let page_count = 1; // (inchangé : lazy 1)
        await pool.query(
          `INSERT INTO atex_plans (logical_name, version, filename, file_path, page_count)
           VALUES ($1,$2,$3,$4,$5)`,
          [logical, version, path.basename(dest), dest, page_count]
        );

        await pool.query(
          `INSERT INTO atex_plan_names (logical_name, display_name) VALUES ($1,$2)
           ON CONFLICT (logical_name) DO NOTHING`,
          [logical, base]
        );

        imported.push({ logical_name: logical, version, page_count });
      }
    } finally {
      await zip.close().catch(() => {});
      // (on ne change rien d’autre : pas de suppression forcée du zip si tu ne l’avais pas)
    }

    res.json({ ok: true, imported });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/atex/maps/listPlans", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.logical_name, MAX(a.version) AS version,
             MIN(a.page_count) AS page_count,
             (SELECT display_name FROM atex_plan_names n WHERE n.logical_name=a.logical_name LIMIT 1) AS display_name
      FROM atex_plans a
      GROUP BY a.logical_name
      ORDER BY a.logical_name ASC
    `);
    const plans = rows.map((r) => ({
      logical_name: r.logical_name,
      id: r.logical_name,
      version: Number(r.version || 1),
      page_count: Number(r.page_count || 1),
      display_name: r.display_name || r.logical_name,
    }));
    res.json({ plans });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/atex/maps/renamePlan", async (req, res) => {
  try {
    const { logical_name, display_name } = req.body || {};
    if (!logical_name) return res.status(400).json({ ok: false, error: "logical_name required" });
    await pool.query(
      `INSERT INTO atex_plan_names (logical_name, display_name)
         VALUES ($1,$2)
       ON CONFLICT (logical_name) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [logical_name, String(display_name || "").trim() || logical_name]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/atex/maps/planFile", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    if (!logical) return res.status(400).json({ ok: false, error: "logical_name required" });
    const { rows } = await pool.query(
      `SELECT file_path FROM atex_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
      [logical]
    );
    const fp = rows?.[0]?.file_path || null;
    if (!fp) return res.status(404).json({ ok: false, error: "file not found" });
    res.sendFile(path.resolve(fp));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// 🔹 MAPS — Positions (markers équipements)
// ========================================================================
app.get("/api/atex/maps/positions", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.status(400).json({ ok: false, error: "logical_name required" });

    const { rows } = await pool.query(
      `
      SELECT p.equipment_id, p.x_frac, p.y_frac,
             e.name, e.building, e.zone, e.status
      FROM atex_positions p
      JOIN atex_equipments e ON e.id=p.equipment_id
      WHERE p.logical_name=$1 AND p.page_index=$2
      `,
      [logical, pageIndex]
    );
    const items = rows.map((r) => ({
      equipment_id: r.equipment_id,
      name: r.name,
      x_frac: Number(r.x_frac),
      y_frac: Number(r.y_frac),
      status: r.status,
      building: r.building,
      zone: r.zone,
    }));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/atex/maps/setPosition", async (req, res) => {
  try {
    const { equipment_id, logical_name, plan_id = null, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipment_id || !logical_name || x_frac == null || y_frac == null)
      return res.status(400).json({ ok: false, error: "missing params" });

    await pool.query(
      `
      INSERT INTO atex_positions (equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (equipment_id, logical_name, page_index)
      DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac
      `,
      [equipment_id, logical_name, plan_id, page_index, x_frac, y_frac]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// 🔹 MAPS — Sous-zones (dessin)
// ========================================================================
app.get("/api/atex/maps/subareas", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);
    const { rows } = await pool.query(
      `SELECT * FROM atex_subareas WHERE logical_name=$1 AND page_index=$2 ORDER BY created_at ASC`,
      [logical, pageIndex]
    );
    res.json({ items: rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/atex/maps/subareas", async (req, res) => {
  try {
    const {
      kind,
      x1 = null,
      y1 = null,
      x2 = null,
      y2 = null,
      cx = null,
      cy = null,
      r = null,
      points = null,
      name = "",
      zoning_gas = null,
      zoning_dust = null,
      logical_name,
      plan_id = null,
      page_index = 0,
    } = req.body || {};

    if (!logical_name || !kind) return res.status(400).json({ ok: false, error: "missing params" });

    const { rows } = await pool.query(
      `
      INSERT INTO atex_subareas
        (logical_name, plan_id, page_index, kind, x1,y1,x2,y2,cx,cy,r,points,name,zoning_gas,zoning_dust)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
      `,
      [
        logical_name,
        plan_id,
        page_index,
        kind,
        x1,
        y1,
        x2,
        y2,
        cx,
        cy,
        r,
        points ? JSON.stringify(points) : null,
        name,
        zoning_gas,
        zoning_dust,
      ]
    );
    res.json({ subarea: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/atex/maps/subareas/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const { name = null, zoning_gas = null, zoning_dust = null } = req.body || {};
    await pool.query(
      `UPDATE atex_subareas SET name=COALESCE($1,name), zoning_gas=$2, zoning_dust=$3 WHERE id=$4`,
      [name, zoning_gas, zoning_dust, id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/atex/maps/subareas/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    await pool.query(`DELETE FROM atex_subareas WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// 🔹 IA — extraction (photos) & conformité
// ========================================================================
function openaiClient() {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ATEX || process.env.OPENAI_API_KEY_DOORS;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// POST /api/atex/extract  (multipart: files[])
// -> { manufacturer, manufacturer_ref, atex_mark_gas?, atex_mark_dust?, type? }
app.post("/api/atex/extract", upload.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    if (!client) return res.status(501).json({ ok: false, error: "OPENAI_API_KEY missing" });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "no files" });

    // On envoie plusieurs images (base64) → extraction robuste
    const images = await Promise.all(
      files.map(async (f) => ({
        name: f.originalname,
        mime: f.mimetype,
        data: (await fsp.readFile(f.path)).toString("base64"),
      }))
    );

    const sys = `Tu es un assistant d'inspection ATEX. Extrait des photos:
- le fabricant (manufacturer)
- la référence fabricant (manufacturer_ref)
- le marquage ATEX gaz (atex_mark_gas) s'il existe
- le marquage ATEX poussière (atex_mark_dust) s'il existe
- le type d'élément (type): interrupteur, luminaire, boîtier, moteur, presse-étoupe, etc.
Ne devine pas: renvoie "" si inconnu. Réponds en JSON strict.`;

    const content = [
      { role: "system", content: sys },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyse ces photos et renvoie uniquement un JSON." },
          ...images.map((im) => ({
            type: "input_image",
            image_url: `data:${im.mime};base64,${im.data}`,
          })),
        ],
      },
    ];

    // gpt-4o-mini ou équivalent multimodal
    const resp = await client.chat.completions.create({
      model: process.env.ATEX_OPENAI_MODEL || "gpt-4o-mini",
      messages: content,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    let data = {};
    try {
      data = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    } catch {
      data = {};
    }
    res.json({
      ok: true,
      extracted: {
        manufacturer: String(data.manufacturer || ""),
        manufacturer_ref: String(data.manufacturer_ref || ""),
        atex_mark_gas: String(data.atex_mark_gas || ""),
        atex_mark_dust: String(data.atex_mark_dust || ""),
        type: String(data.type || ""),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/atex/assess
// body: { atex_mark_gas, atex_mark_dust, target_gas (0|1|2|null), target_dust (20|21|22|null) }
// -> { decision: "conforme"|"non_conforme"|"indetermine", rationale }
app.post("/api/atex/assess", async (req, res) => {
  try {
    const client = openaiClient();
    if (!client) return res.status(501).json({ ok: false, error: "OPENAI_API_KEY missing" });

    const { atex_mark_gas = "", atex_mark_dust = "", target_gas = null, target_dust = null } = req.body || {};

    const sys = `Tu es expert ATEX. On te donne des marquages ATEX équipements (gaz et/ou poussière) et un zonage cible gaz/poussière. 
Décide si l'équipement est conforme au zonage: 
- "conforme" si le marquage couvre au moins la sévérité de la zone (ex: 1G couvre zone 1 et 2, etc.)
- "non_conforme" si le marquage n'est pas suffisant
- "indetermine" si le marquage est absent/illisible.
Donne une justification concise. Réponds en JSON strict { "decision": "...", "rationale": "..." }.`;

    const messages = [
      { role: "system", content: sys },
      {
        role: "user",
        content: `Marquage gaz: ${atex_mark_gas || "(aucun)"}\nMarquage poussière: ${atex_mark_dust || "(aucun)"}\nZonage cible gaz: ${target_gas}\nZonage cible poussière: ${target_dust}`,
      },
    ];

    const resp = await client.chat.completions.create({
      model: process.env.ATEX_OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    let data = {};
    try {
      data = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    } catch {
      data = {};
    }
    res.json({
      ok: true,
      ...data,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========================================================================
// Boot
// ========================================================================
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[atex] listening on ${HOST}:${PORT}`);
});
