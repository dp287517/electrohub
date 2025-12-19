// ==============================
// server_mobile_equipment.js — Mobile Equipment Electrical Control microservice (ESM)
// Port: 3022
// VERSION 1.0 - AUDIT TRAIL + MULTI-TENANT
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
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import { createAuditTrail, AUDIT_ACTIONS } from "./lib/audit-trail.js";
import { extractTenantFromRequest, getTenantFilter } from "./lib/tenant-filter.js";

// MAPS - PDF handling
import crypto from "crypto";
import StreamZip from "node-stream-zip";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
function resolvePdfWorker() {
  try {
    return require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    return require.resolve("pdfjs-dist/build/pdf.worker.mjs");
  }
}
pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorker();
const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
const PDF_STANDARD_FONTS = path.join(pdfjsPkgDir, "standard_fonts/");

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------
// App & Config
// ------------------------------
const app = express();
app.set("trust proxy", 1);

// Helmet — CSP
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

// CORS
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-User-Email",
      "X-User-Name",
      "X-Site",
      "Authorization",
    ],
    exposedHeaders: [],
  })
);

app.use(express.json({ limit: "16mb" }));

const PORT = Number(process.env.MOBILE_EQUIPMENT_PORT || 3022);
const HOST = process.env.MOBILE_EQUIPMENT_HOST || "0.0.0.0";

// Storage layout
const DATA_ROOT = path.join(process.cwd(), "uploads", "mobile-equipment");
const FILES_DIR = path.join(DATA_ROOT, "files");
const QRCODES_DIR = path.join(DATA_ROOT, "qrcodes");
await fsp.mkdir(FILES_DIR, { recursive: true });
await fsp.mkdir(QRCODES_DIR, { recursive: true });

// MAPS
const MAPS_ROOT = path.join(DATA_ROOT, "maps");
const MAPS_INCOMING_DIR = path.join(MAPS_ROOT, "incoming");
const MAPS_STORE_DIR = path.join(MAPS_ROOT, "plans");
await fsp.mkdir(MAPS_INCOMING_DIR, { recursive: true });
await fsp.mkdir(MAPS_STORE_DIR, { recursive: true });

// Multer
const uploadAny = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// MAPS — Multer ZIP (300MB)
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
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Settings - with equipment-specific frequencies
  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_settings (
      id INT PRIMARY KEY DEFAULT 1,
      checklist_template JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_frequency TEXT NOT NULL DEFAULT '6_mois',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    INSERT INTO me_settings (id, checklist_template, default_frequency)
    VALUES (1, '[
      "L''appareil est-il propre et en bon état général ?",
      "Les connexions électriques sont-elles correctes ?",
      "Le câble d''alimentation est-il en bon état ?",
      "Les dispositifs de sécurité fonctionnent-ils ?",
      "L''étiquetage est-il conforme et lisible ?"
    ]'::jsonb, '6_mois')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Equipment categories with specific frequencies
  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      frequency TEXT NOT NULL DEFAULT '6_mois',
      checklist_template JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Equipments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_equipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT,
      category_id UUID REFERENCES me_categories(id),
      building TEXT,
      floor TEXT,
      location TEXT,
      serial_number TEXT,
      brand TEXT,
      model TEXT,
      power_rating TEXT,
      photo_path TEXT,
      photo_file_id UUID,
      frequency TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS photo_path TEXT;`);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS photo_file_id UUID;`);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS code TEXT;`);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS serial_number TEXT;`);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS brand TEXT;`);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS model TEXT;`);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS power_rating TEXT;`);
  await pool.query(`ALTER TABLE me_equipments ADD COLUMN IF NOT EXISTS frequency TEXT;`);

  // Checks
  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES me_equipments(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      due_date DATE NOT NULL,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT,
      result_counts JSONB DEFAULT '{}'::jsonb,
      pdf_nc_path TEXT,
      closed_by_email TEXT,
      closed_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE me_checks ADD COLUMN IF NOT EXISTS closed_by_email TEXT;`);
  await pool.query(`ALTER TABLE me_checks ADD COLUMN IF NOT EXISTS closed_by_name TEXT;`);

  // Files
  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES me_equipments(id) ON DELETE CASCADE,
      inspection_id UUID,
      kind TEXT,
      filename TEXT,
      path TEXT,
      mime TEXT,
      size_bytes BIGINT,
      content BYTEA,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE me_files ADD COLUMN IF NOT EXISTS inspection_id UUID;`);
  await pool.query(`ALTER TABLE me_files ADD COLUMN IF NOT EXISTS kind TEXT;`);
  await pool.query(`ALTER TABLE me_files ADD COLUMN IF NOT EXISTS content BYTEA;`);

  // MAPS — plans, names, positions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version TEXT NOT NULL,
      filename TEXT,
      file_path TEXT,
      page_count INT,
      content BYTEA,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE me_plans ADD COLUMN IF NOT EXISTS content BYTEA;`);

  await pool.query(`CREATE INDEX IF NOT EXISTS me_plans_logical_idx ON me_plans(logical_name);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS me_plans_created_idx ON me_plans(created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS me_equipment_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES me_equipments(id) ON DELETE CASCADE,
      plan_logical_name TEXT NOT NULL,
      page_index INT NOT NULL DEFAULT 0,
      page_label TEXT,
      x_frac NUMERIC,
      y_frac NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'me_equipment_positions_uniq'
      ) THEN
        ALTER TABLE me_equipment_positions
        ADD CONSTRAINT me_equipment_positions_uniq UNIQUE (equipment_id, plan_logical_name, page_index);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_me_checks_equipment_due
      ON me_checks(equipment_id, due_date) WHERE closed_at IS NULL;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_me_files_equipment ON me_files(equipment_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_me_files_insp ON me_files(inspection_id);`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_me_checks_equipment_closed
      ON me_checks(equipment_id, closed_at DESC) WHERE closed_at IS NOT NULL;
  `);
}

// ------------------------------
// Helpers
// ------------------------------
const STATUS = {
  A_FAIRE: "a_faire",
  EN_COURS: "en_cours_30",
  EN_RETARD: "en_retard",
  FAIT: "fait",
};

const FREQ_TO_MONTHS = {
  "1_mois": 1,
  "3_mois": 3,
  "6_mois": 6,
  "1_an": 12,
  "2_ans": 24,
};

function addMonthsISO(d, months) {
  const dt = new Date(d);
  dt.setMonth(dt.getMonth() + months);
  return dt.toISOString().slice(0, 10);
}
function addDaysISO(d, days) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function computeEquipmentStatus(due_date, hasStarted) {
  if (!due_date) return STATUS.A_FAIRE;
  const today = new Date(todayISO());
  const due = new Date(due_date);
  const days = Math.ceil((due - today) / 86400000);
  if (days < 0) return STATUS.EN_RETARD;
  if (days <= 30) return STATUS.EN_COURS;
  return STATUS.A_FAIRE;
}

async function getSettings() {
  const { rows } = await pool.query(
    `SELECT checklist_template, default_frequency FROM me_settings WHERE id=1`
  );
  return rows[0] || { checklist_template: [], default_frequency: "6_mois" };
}

async function getEquipmentFrequency(equipment_id) {
  // First check equipment-specific frequency
  const { rows: eqRows } = await pool.query(
    `SELECT e.frequency, c.frequency as cat_frequency
     FROM me_equipments e
     LEFT JOIN me_categories c ON c.id = e.category_id
     WHERE e.id = $1`,
    [equipment_id]
  );
  if (eqRows[0]?.frequency) return eqRows[0].frequency;
  if (eqRows[0]?.cat_frequency) return eqRows[0].cat_frequency;

  const settings = await getSettings();
  return settings.default_frequency || "6_mois";
}

// URL publique
function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0] || "https";
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0];
  if (!host) return "https://autonomix-elec.onrender.com";
  return `${proto}://${host}`;
}
const DEFAULT_APP_PATH = process.env.MOBILE_EQUIPMENT_QR_APP_PATH || "/app/mobile-equipments";
function qrDeepLink(req, equipmentId) {
  const envBase = process.env.PUBLIC_BASE;
  if (envBase) {
    try {
      const u = new URL(envBase);
      let base = u.href.replace(/\/+$/, "");
      if (base.endsWith("/app/mobile-equipments")) {
        return `${base}?equipment=${equipmentId}`;
      }
      return `${base}${DEFAULT_APP_PATH}?equipment=${equipmentId}`;
    } catch {}
  }
  const origin = publicOrigin(req);
  return `${origin}${DEFAULT_APP_PATH}?equipment=${equipmentId}`;
}

// Cookie reading
function readCookie(req, name) {
  const raw = req.headers?.cookie || "";
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function safeEmail(s) {
  if (!s) return null;
  const x = String(s).trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(x) ? x : null;
}

// Identity
async function currentUser(req) {
  const rawEmail =
    req.headers["x-user-email"] ||
    req.headers["x-auth-email"] ||
    req.headers["x-forwarded-user"] ||
    readCookie(req, "email") ||
    null;

  const rawName =
    req.headers["x-user-name"] ||
    req.headers["x-auth-name"] ||
    req.headers["x-forwarded-user"] ||
    readCookie(req, "name") ||
    null;

  let bodyEmail = null, bodyName = null;
  try {
    if (req.body) {
      if (req.body._user && typeof req.body._user === "object") {
        bodyEmail = (req.body._user.email || "").trim();
        bodyName = (req.body._user.name || "").trim();
      }
      if (req.body.user_email) bodyEmail = String(req.body.user_email || "").trim();
      if (req.body.user_name) bodyName = String(req.body.user_name || "").trim();
    }
  } catch {}

  const email = safeEmail(rawEmail || bodyEmail);
  let name = (rawName || bodyName) ? String(rawName || bodyName).trim() : null;

  if (!name && email) {
    try {
      const { rows } = await pool.query(
        `SELECT name FROM users WHERE lower(email)=lower($1) LIMIT 1`,
        [email]
      );
      name = rows?.[0]?.name || null;
    } catch {}
  }
  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    if (base) {
      name = base
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    }
  }
  return { email, name };
}

// Schedule next pending check
async function ensureNextPendingCheck(equipment_id) {
  const { rows: pend } = await pool.query(
    `SELECT id FROM me_checks WHERE equipment_id=$1 AND closed_at IS NULL ORDER BY due_date ASC LIMIT 1`,
    [equipment_id]
  );
  if (pend[0]) return pend[0];

  const { rows: any } = await pool.query(
    `SELECT 1 FROM me_checks WHERE equipment_id=$1 LIMIT 1`,
    [equipment_id]
  );

  const freq = await getEquipmentFrequency(equipment_id);
  const due = any[0]
    ? addMonthsISO(todayISO(), FREQ_TO_MONTHS[freq] || 6)
    : addDaysISO(todayISO(), 30);

  const r = await pool.query(
    `INSERT INTO me_checks(equipment_id, due_date) VALUES($1,$2) RETURNING id`,
    [equipment_id, due]
  );
  return r.rows[0];
}

// QRCode
async function ensureEquipmentQRCode(req, equipmentId, name, size = 512, force = false) {
  const targetUrl = qrDeepLink(req, equipmentId);
  let baseKey = "default";
  try {
    baseKey = Buffer.from(new URL(targetUrl).origin).toString("hex").slice(0, 8);
  } catch {}
  const file = path.join(QRCODES_DIR, `${equipmentId}_${size}_${baseKey}.png`);
  if (force || !fs.existsSync(file)) {
    await QRCode.toFile(file, targetUrl, { width: size, margin: 1 });
  }
  return file;
}

async function createNcPdf(outPath, equipment, check, inspectorName = null) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const ws = fs.createWriteStream(outPath);
    ws.on("finish", resolve);
    ws.on("error", reject);
    doc.pipe(ws);

    doc.fontSize(18).text("Rapport de non-conformites - Appareil Mobile");
    doc.moveDown(0.5).fontSize(12).text(`Equipement : ${equipment.name}`);
    if (equipment.code) doc.text(`Code : ${equipment.code}`);
    const loc = [equipment.building, equipment.floor, equipment.location].filter(Boolean).join(" - ");
    doc.text(`Localisation : ${loc || "-"}`);
    doc.text(`Date : ${new Date().toLocaleDateString()}`);
    if (inspectorName) doc.text(`Controleur : ${inspectorName}`);
    doc.moveDown();

    const nc = (check.items || []).filter((it) => it.value === "non_conforme");
    if (!nc.length) {
      doc.fontSize(12).text("Aucune non-conformite.");
    } else {
      nc.forEach((it, i) => {
        doc.fontSize(14).text(`${i + 1}. ${it.label || "-"}`);
        doc.moveDown(0.25).fontSize(11).fillColor("#333").text(`Resultat : Non conforme`);
        if (it.comment) {
          doc.moveDown(0.15).text(`Commentaire : ${it.comment}`);
        }
        doc.fillColor("black").moveDown(0.6);
      });
    }
    doc.end();
  });
}

function fileRowToClient(f) {
  return {
    id: f.id,
    original_name: f.filename,
    mime: f.mime || "application/octet-stream",
    size_bytes: Number(f.size_bytes || 0),
    url: `/api/mobile-equipment/files/${f.id}/download`,
    download_url: `/api/mobile-equipment/files/${f.id}/download`,
    inline_url: `/api/mobile-equipment/files/${f.id}/download`,
  };
}

function normalizeItemsWithLabels(items, template) {
  const tpl = Array.isArray(template) ? template : [];
  const map = new Map((items || []).map((it) => [Number(it.index), it]));
  for (let i = 0; i < 5; i++) {
    const prev = map.get(i) || { index: i };
    const label = prev.label || tpl[i] || `Point ${i + 1}`;
    map.set(i, { ...prev, label });
  }
  const merged = Array.from(map.values()).sort((a, b) => a.index - b.index);
  return merged.map((it) => ({
    index: Number(it.index),
    label: String(it.label || ""),
    value: it.value ?? null,
    comment: it.comment ?? undefined,
  }));
}
function allFiveFilled(items) {
  const vals = (items || []).slice(0, 5).map((i) => i?.value);
  if (vals.length < 5) return false;
  return vals.every((v) => v === "conforme" || v === "non_conforme" || v === "na");
}

// MAPS helpers
function nowISOStamp() {
  const d = new Date();
  return d.toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "");
}
function parsePlanName(fn = "") {
  const base = path.basename(fn).replace(/\.pdf$/i, "");
  const m = base.split("__");
  return { logical: m[0], version: m[1] || nowISOStamp() };
}
async function pdfPageCount(abs) {
  const data = new Uint8Array(await fsp.readFile(abs));
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: PDF_STANDARD_FONTS }).promise;
  const n = doc.numPages || 1;
  await doc.cleanup();
  return n;
}

// ------------------------------
// Health
// ------------------------------
app.get("/api/mobile-equipment/health", async (_req, res) => {
  try {
    const { rows: d } = await pool.query(`SELECT COUNT(*)::int AS n FROM me_equipments`);
    res.json({ ok: true, equipments: d[0]?.n ?? 0, port: PORT });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Debug identity
// ------------------------------
app.get("/api/mobile-equipment/_debug_identity", (req, res) => {
  res.json({
    headers: {
      "x-user-email": req.headers["x-user-email"] || null,
      "x-user-name": req.headers["x-user-name"] || null,
      cookie: req.headers["cookie"] || null,
    },
    body: req.body || null,
  });
});
app.get("/api/mobile-equipment/_whoami", async (req, res) => {
  const u = await currentUser(req);
  res.json({ ok: true, resolved: u });
});

// ------------------------------
// Settings (GET/PUT)
// ------------------------------
app.get("/api/mobile-equipment/settings", async (_req, res) => {
  try {
    const s = await getSettings();
    res.json({ ok: true, ...s });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/mobile-equipment/settings", async (req, res) => {
  try {
    const { checklist_template, default_frequency } = req.body || {};
    const tpl =
      Array.isArray(checklist_template)
        ? checklist_template.map((x) => String(x || "").trim()).filter(Boolean)
        : undefined;
    const freq = default_frequency && FREQ_TO_MONTHS[default_frequency] ? default_frequency : undefined;

    if (tpl === undefined && freq === undefined)
      return res.status(400).json({ ok: false, error: "no_change" });

    const fields = [];
    const values = [];
    let i = 1;
    if (tpl !== undefined) {
      fields.push(`checklist_template=$${i++}`);
      values.push(JSON.stringify(tpl));
    }
    if (freq !== undefined) {
      fields.push(`default_frequency=$${i++}`);
      values.push(freq);
    }
    await pool.query(
      `UPDATE me_settings SET ${fields.join(", ")}, updated_at=now() WHERE id=1`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Categories CRUD
// ------------------------------
app.get("/api/mobile-equipment/categories", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM me_categories ORDER BY name ASC`
    );
    res.json({ ok: true, categories: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/mobile-equipment/categories", async (req, res) => {
  try {
    const { name, description = "", frequency = "6_mois", checklist_template = [] } = req.body || {};
    if (!name) return res.status(400).json({ error: "name requis" });

    const { rows } = await pool.query(
      `INSERT INTO me_categories(name, description, frequency, checklist_template)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [name, description, frequency, JSON.stringify(checklist_template)]
    );
    res.json({ ok: true, category: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/mobile-equipment/categories/:id", async (req, res) => {
  try {
    const { name, description, frequency, checklist_template } = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { fields.push(`name=$${i++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description=$${i++}`); values.push(description); }
    if (frequency !== undefined) { fields.push(`frequency=$${i++}`); values.push(frequency); }
    if (checklist_template !== undefined) {
      fields.push(`checklist_template=$${i++}`);
      values.push(JSON.stringify(checklist_template));
    }
    values.push(req.params.id);
    await pool.query(
      `UPDATE me_categories SET ${fields.join(", ")} WHERE id=$${i}`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/mobile-equipment/categories/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM me_categories WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Equipments CRUD • /api/mobile-equipment/equipments
// ------------------------------
app.get("/api/mobile-equipment/equipments", async (req, res) => {
  try {
    const { q = "", status = "", building = "", floor = "", category = "", equipment_state = "" } = req.query || {};

    const { rows } = await pool.query(
      `
      WITH last_closed AS (
        SELECT DISTINCT ON (equipment_id)
               equipment_id, status
          FROM me_checks
         WHERE closed_at IS NOT NULL
         ORDER BY equipment_id, closed_at DESC
      )
      SELECT e.id, e.name, e.code, e.building, e.floor, e.location, e.photo_path,
             e.serial_number, e.brand, e.model, e.power_rating, e.category_id,
             c.name as category_name,
             (SELECT started_at IS NOT NULL AND closed_at IS NULL FROM me_checks ch WHERE ch.equipment_id=e.id ORDER BY due_date ASC LIMIT 1) AS has_started,
             (SELECT due_date FROM me_checks ch WHERE ch.equipment_id=e.id AND ch.closed_at IS NULL ORDER BY due_date ASC LIMIT 1) AS next_due,
             CASE WHEN lc.status = 'nc' THEN 'non_conforme'
                  WHEN lc.status = 'ok' THEN 'conforme'
                  ELSE NULL END AS equipment_state
      FROM me_equipments e
      LEFT JOIN me_categories c ON c.id = e.category_id
      LEFT JOIN last_closed lc ON lc.equipment_id = e.id
      WHERE ($1 = '' OR e.name ILIKE '%'||$1||'%' OR e.code ILIKE '%'||$1||'%' OR e.location ILIKE '%'||$1||'%' OR e.building ILIKE '%'||$1||'%' OR e.floor ILIKE '%'||$1||'%')
        AND ($2 = '' OR e.building ILIKE '%'||$2||'%')
        AND ($3 = '' OR e.floor ILIKE '%'||$3||'%')
        AND ($4 = '' OR e.category_id::text = $4)
        AND ($5 = '' OR (CASE WHEN lc.status='nc' THEN 'non_conforme' WHEN lc.status='ok' THEN 'conforme' ELSE '' END) = $5)
      ORDER BY e.name ASC
    `,
      [q, building, floor, category, equipment_state]
    );

    const items = rows
      .map((r) => {
        const st = computeEquipmentStatus(r.next_due, r.has_started);
        return {
          id: r.id,
          name: r.name,
          code: r.code,
          building: r.building,
          floor: r.floor,
          location: r.location,
          category_id: r.category_id,
          category_name: r.category_name,
          serial_number: r.serial_number,
          brand: r.brand,
          model: r.model,
          power_rating: r.power_rating,
          status: st,
          next_check_date: r.next_due || null,
          photo_url: r.photo_path ? `/api/mobile-equipment/equipments/${r.id}/photo` : null,
          equipment_state: r.equipment_state,
        };
      })
      .filter((it) => !status || it.status === status);

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/mobile-equipment/equipments", async (req, res) => {
  try {
    const {
      name, code = "", building = "", floor = "", location = "",
      category_id = null, serial_number = "", brand = "", model = "",
      power_rating = "", frequency = null
    } = req.body || {};
    if (!name) return res.status(400).json({ error: "name requis" });

    const { rows } = await pool.query(
      `INSERT INTO me_equipments(name, code, building, floor, location, category_id, serial_number, brand, model, power_rating, frequency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, code, building, floor, location, category_id, serial_number, brand, model, power_rating, frequency]
    );
    const equipment = rows[0];

    // First pending check at J+30
    const due = addDaysISO(todayISO(), 30);
    await pool.query(`INSERT INTO me_checks(equipment_id, due_date) VALUES($1,$2)`, [
      equipment.id,
      due,
    ]);

    // AUDIT: Log creation
    await audit.log(req, AUDIT_ACTIONS.CREATED, {
      entityType: 'equipment',
      entityId: equipment.id,
      details: { name, code, building, floor, location }
    });

    res.json({
      ok: true,
      equipment: { ...equipment, next_check_date: due, photo_url: null, equipment_state: null },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/mobile-equipment/equipments/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, c.name as category_name, c.frequency as category_frequency
       FROM me_equipments e
       LEFT JOIN me_categories c ON c.id = e.category_id
       WHERE e.id=$1`,
      [req.params.id]
    );
    const equipment = rows[0];
    if (!equipment) return res.status(404).json({ ok: false, error: "not_found" });

    const { rows: cur } = await pool.query(
      `SELECT id, started_at, closed_at, due_date, items
         FROM me_checks
        WHERE equipment_id=$1 AND closed_at IS NULL
        ORDER BY due_date ASC LIMIT 1`,
      [equipment.id]
    );
    const check = cur[0] || null;
    const hasStarted = !!(check && check.started_at && !check.closed_at);
    const status = computeEquipmentStatus(check?.due_date || null, hasStarted);

    const { rows: last } = await pool.query(
      `SELECT status FROM me_checks WHERE equipment_id=$1 AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`,
      [equipment.id]
    );
    const equipment_state =
      last[0]?.status === "ok"
        ? "conforme"
        : last[0]?.status === "nc"
        ? "non_conforme"
        : null;

    res.json({
      ok: true,
      equipment: {
        id: equipment.id,
        name: equipment.name,
        code: equipment.code,
        building: equipment.building,
        floor: equipment.floor,
        location: equipment.location,
        category_id: equipment.category_id,
        category_name: equipment.category_name,
        serial_number: equipment.serial_number,
        brand: equipment.brand,
        model: equipment.model,
        power_rating: equipment.power_rating,
        frequency: equipment.frequency || equipment.category_frequency,
        status,
        next_check_date: check?.due_date || null,
        photo_url: equipment.photo_path ? `/api/mobile-equipment/equipments/${equipment.id}/photo` : null,
        equipment_state,
        current_check: check
          ? {
              id: check.id,
              items: check.items,
              itemsView: (await getSettings()).checklist_template,
            }
          : null,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/mobile-equipment/equipments/:id", async (req, res) => {
  try {
    const { name, code, building, floor, location, category_id, serial_number, brand, model, power_rating, frequency } = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { fields.push(`name=$${i++}`); values.push(name); }
    if (code !== undefined) { fields.push(`code=$${i++}`); values.push(code); }
    if (building !== undefined) { fields.push(`building=$${i++}`); values.push(building); }
    if (floor !== undefined) { fields.push(`floor=$${i++}`); values.push(floor); }
    if (location !== undefined) { fields.push(`location=$${i++}`); values.push(location); }
    if (category_id !== undefined) { fields.push(`category_id=$${i++}`); values.push(category_id); }
    if (serial_number !== undefined) { fields.push(`serial_number=$${i++}`); values.push(serial_number); }
    if (brand !== undefined) { fields.push(`brand=$${i++}`); values.push(brand); }
    if (model !== undefined) { fields.push(`model=$${i++}`); values.push(model); }
    if (power_rating !== undefined) { fields.push(`power_rating=$${i++}`); values.push(power_rating); }
    if (frequency !== undefined) { fields.push(`frequency=$${i++}`); values.push(frequency); }
    values.push(req.params.id);
    await pool.query(
      `UPDATE me_equipments SET ${fields.join(", ")}, updated_at=now() WHERE id=$${i}`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/mobile-equipment/equipments/:id", async (req, res) => {
  try {
    const equipmentId = req.params.id;

    // Get equipment info before delete (for audit)
    const { rows: equipInfo } = await pool.query(
      `SELECT name, code, building, floor, location FROM me_equipments WHERE id=$1`,
      [equipmentId]
    );

    await pool.query(`DELETE FROM me_equipments WHERE id=$1`, [equipmentId]);

    // AUDIT: Log deletion
    const eq = equipInfo[0];
    await audit.log(req, AUDIT_ACTIONS.DELETED, {
      entityType: 'equipment',
      entityId: equipmentId,
      details: { name: eq?.name, code: eq?.code, building: eq?.building, floor: eq?.floor, location: eq?.location }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Photo (thumbnail)
// ------------------------------
app.post(
  "/api/mobile-equipment/equipments/:id/photo",
  uploadAny.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "photo requise" });
      const buf = await fsp.readFile(req.file.path);

      const { rows: ins } = await pool.query(
        `INSERT INTO me_files(equipment_id, inspection_id, kind, filename, path, mime, size_bytes, content)
         VALUES($1, NULL, 'photo', $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          req.params.id,
          req.file.originalname,
          req.file.path,
          req.file.mimetype,
          req.file.size,
          buf,
        ]
      );
      const fileId = ins[0].id;

      await pool.query(
        `UPDATE me_equipments SET photo_path=$1, photo_file_id=$2, updated_at=now() WHERE id=$3`,
        [req.file.path, fileId, req.params.id]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

app.get("/api/mobile-equipment/equipments/:id/photo", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT photo_path, photo_file_id FROM me_equipments WHERE id=$1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).send("no_equipment");

    // DB first
    if (row.photo_file_id) {
      const { rows: frows } = await pool.query(
        `SELECT mime, content FROM me_files WHERE id=$1`,
        [row.photo_file_id]
      );
      const f = frows[0];
      if (f?.content) {
        res.setHeader("Content-Type", f.mime || "image/*");
        return res.end(f.content, "binary");
      }
    }
    // disk
    if (row.photo_path && fs.existsSync(row.photo_path)) {
      res.setHeader("Content-Type", "image/*");
      return res.sendFile(path.resolve(row.photo_path));
    }

    return res.status(404).send("no_photo");
  } catch (e) {
    res.status(500).send("err");
  }
});

// ------------------------------
// Files • /api/mobile-equipment/equipments/:id/files
// ------------------------------
app.post(
  "/api/mobile-equipment/equipments/:id/files",
  uploadAny.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: "file_required" });
      const buf = await fsp.readFile(req.file.path);
      await pool.query(
        `INSERT INTO me_files(equipment_id, inspection_id, kind, filename, path, mime, size_bytes, content)
         VALUES($1, NULL, 'equipment', $2, $3, $4, $5, $6)`,
        [
          req.params.id,
          req.file.originalname,
          req.file.path,
          req.file.mimetype,
          req.file.size,
          buf,
        ]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

app.get("/api/mobile-equipment/equipments/:id/files", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime, size_bytes
         FROM me_files
        WHERE equipment_id=$1 AND (inspection_id IS NULL OR kind='equipment')
        ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    const files = rows.map(fileRowToClient);
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/mobile-equipment/files/:fileId/download", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT path, filename, mime, content FROM me_files WHERE id=$1`,
      [req.params.fileId]
    );
    const f = rows[0];
    if (!f) return res.status(404).send("file");

    if (f.content) {
      res.setHeader("Content-Type", f.mime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(f.filename)}"`
      );
      return res.end(f.content, "binary");
    }
    if (f.path && fs.existsSync(f.path)) {
      res.setHeader("Content-Type", f.mime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(f.filename)}"`
      );
      return res.sendFile(path.resolve(f.path));
    }
    return res.status(404).send("file");
  } catch (e) {
    res.status(500).send("err");
  }
});

app.delete("/api/mobile-equipment/files/:fileId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM me_files WHERE id=$1 RETURNING path`,
      [req.params.fileId]
    );
    const p = rows[0]?.path;
    if (p && fs.existsSync(p)) fs.unlink(p, () => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Checks workflow • /api/mobile-equipment/equipments/:id/checks
// ------------------------------
app.post("/api/mobile-equipment/equipments/:id/checks", async (req, res) => {
  try {
    const equipment_id = req.params.id;

    const pend = await ensureNextPendingCheck(equipment_id);
    await pool.query(
      `UPDATE me_checks SET started_at = COALESCE(started_at, now()), updated_at=now() WHERE id=$1`,
      [pend.id]
    );

    const { rows: checkR } = await pool.query(`SELECT * FROM me_checks WHERE id=$1`, [
      pend.id,
    ]);
    let check = checkR[0];
    if ((check.items || []).length === 0) {
      const s = await getSettings();
      const items = (s.checklist_template || [])
        .slice(0, 5)
        .map((label, i) => ({ index: i, label, value: null }));
      const { rows: upd } = await pool.query(
        `UPDATE me_checks SET items=$1, updated_at=now() WHERE id=$2 RETURNING *`,
        [JSON.stringify(items), check.id]
      );
      check = upd[0];
    }

    res.json({
      ok: true,
      check: { id: check.id, due_date: check.due_date, items: check.items },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT (JSON or multipart) — files with DB copy
app.put(
  "/api/mobile-equipment/equipments/:id/checks/:checkId",
  uploadAny.array("files", 20),
  async (req, res) => {
    try {
      const equipmentId = req.params.id;
      const checkId = req.params.checkId;

      const { rows: curR } = await pool.query(
        `SELECT * FROM me_checks WHERE id=$1 AND equipment_id=$2`,
        [checkId, equipmentId]
      );
      const current = curR[0];
      if (!current)
        return res.status(404).json({ ok: false, error: "check_not_found" });

      const settings = await getSettings();

      // items (merge)
      let incomingItems = [];
      if (req.is("multipart/form-data")) {
        if (req.body?.items) {
          try {
            incomingItems = JSON.parse(req.body.items);
          } catch {
            incomingItems = [];
          }
        }
      } else {
        incomingItems = Array.isArray(req.body?.items) ? req.body.items : [];
      }
      const map = new Map((current.items || []).map((it) => [Number(it.index), it]));
      (incomingItems || []).forEach((it) => {
        const idx = Number(it.index);
        const prev = map.get(idx) || { index: idx };
        map.set(idx, {
          index: idx,
          label:
            prev.label ||
            it.label ||
            settings.checklist_template?.[idx] ||
            `Point ${idx + 1}`,
          value: it.value ?? prev.value ?? null,
          comment: it.comment ?? prev.comment ?? undefined,
        });
      });
      let merged = Array.from(map.values()).sort((a, b) => a.index - b.index);
      merged = normalizeItemsWithLabels(merged, settings.checklist_template);

      // files linked to check (DB copy)
      const files = req.files || [];
      if (files.length) {
        const params = [];
        const vals = [];
        let i = 1;
        for (const f of files) {
          const buf = await fsp.readFile(f.path);
          params.push(
            `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
          );
          vals.push(
            equipmentId,
            checkId,
            "check",
            f.originalname,
            f.path,
            f.mimetype,
            f.size,
            buf
          );
        }
        await pool.query(
          `INSERT INTO me_files(equipment_id, inspection_id, kind, filename, path, mime, size_bytes, content)
           VALUES ${params.join(",")}`,
          vals
        );
      }

      const wantsCloseRaw = req.body && req.body.close;
      const bodyClose =
        typeof wantsCloseRaw === "string"
          ? ["1", "true", "yes", "on"].includes(wantsCloseRaw.toLowerCase())
          : !!wantsCloseRaw;

      const close = bodyClose;

      const { email: userEmail, name: userName } = await currentUser(req);

      let closedRow = null;
      let notice = null;

      if (close) {
        const counts = { conforme: 0, nc: 0, na: 0 };
        for (const it of merged.slice(0, 5)) {
          if (it.value === "conforme") counts.conforme++;
          else if (it.value === "non_conforme") counts.nc++;
          else counts.na++;
        }

        let pdfPath = null;
        const status = counts.nc > 0 ? "nc" : "ok";

        if (counts.nc > 0) {
          const { rows: eqR } = await pool.query(
            `SELECT id, name, code, building, floor, location FROM me_equipments WHERE id=$1`,
            [equipmentId]
          );
          const equipment = eqR[0];
          const out = path.join(
            DATA_ROOT,
            `NC_${equipment.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`
          );
          await createNcPdf(out, equipment, { items: merged }, userName || userEmail || undefined);
          pdfPath = out;
        }

        const { rows: upd } = await pool.query(
          `UPDATE me_checks
             SET items=$1, closed_at=now(), status=$2, result_counts=$3, pdf_nc_path=$4,
                 closed_by_email=$5, closed_by_name=$6, updated_at=now()
           WHERE id=$7
           RETURNING *`,
          [JSON.stringify(merged), status, counts, pdfPath, userEmail, userName, checkId]
        );
        closedRow = upd[0];

        const freq = await getEquipmentFrequency(equipmentId);
        const months = FREQ_TO_MONTHS[freq] || 6;
        const nextDue = addMonthsISO(todayISO(), months);
        await pool.query(`INSERT INTO me_checks(equipment_id, due_date) VALUES($1,$2)`, [
          equipmentId,
          nextDue,
        ]);

        notice = `Controle enregistre dans l'historique. Prochain controle le ${new Date(
          nextDue + "T00:00:00Z"
        ).toLocaleDateString()}.`;
      } else {
        await pool.query(
          `UPDATE me_checks SET items=$1, updated_at=now() WHERE id=$2`,
          [JSON.stringify(merged), checkId]
        );
      }

      const { rows: eR } = await pool.query(`SELECT * FROM me_equipments WHERE id=$1`, [
        equipmentId,
      ]);
      const equipment = eR[0];

      const { rows: pend } = await pool.query(
        `SELECT id, started_at, closed_at, due_date, items
           FROM me_checks
          WHERE equipment_id=$1 AND closed_at IS NULL
          ORDER BY due_date ASC LIMIT 1`,
        [equipmentId]
      );
      const c = pend[0] || null;
      const hasStarted = !!(c && c.started_at && !c.closed_at);
      const statusEq = computeEquipmentStatus(c?.due_date || null, hasStarted);

      const { rows: last } = await pool.query(
        `SELECT status FROM me_checks WHERE equipment_id=$1 AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`,
        [equipmentId]
      );
      const equipment_state =
        last[0]?.status === "ok"
          ? "conforme"
          : last[0]?.status === "nc"
          ? "non_conforme"
          : null;

      res.json({
        ok: true,
        notice,
        equipment: {
          id: equipment.id,
          name: equipment.name,
          code: equipment.code,
          building: equipment.building,
          floor: equipment.floor,
          location: equipment.location,
          status: statusEq,
          next_check_date: c?.due_date || null,
          photo_url: equipment.photo_path ? `/api/mobile-equipment/equipments/${equipment.id}/photo` : null,
          equipment_state,
          current_check: c
            ? { id: c.id, items: c.items, itemsView: settings.checklist_template }
            : null,
        },
        closed: !!closedRow,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// History (closed checks)
app.get("/api/mobile-equipment/equipments/:id/history", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.closed_at, c.status, c.result_counts, c.items, c.pdf_nc_path, c.closed_by_email, c.closed_by_name
         FROM me_checks c
        WHERE c.equipment_id=$1 AND c.closed_at IS NOT NULL
        ORDER BY c.closed_at DESC`,
      [req.params.id]
    );

    const { rows: files } = await pool.query(
      `SELECT id, filename, inspection_id
         FROM me_files
        WHERE equipment_id=$1 AND inspection_id IS NOT NULL
        ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    const filesByCheck = files.reduce((acc, f) => {
      (acc[f.inspection_id] ||= []).push({
        id: f.id,
        name: f.filename,
        url: `/api/mobile-equipment/files/${f.id}/download`,
      });
      return acc;
    }, {});

    const settings = await getSettings();
    const checks = rows.map((r) => {
      const items = normalizeItemsWithLabels(r.items || [], settings.checklist_template);
      const username =
        r.closed_by_name && r.closed_by_email
          ? `${r.closed_by_name} (${r.closed_by_email})`
          : r.closed_by_name || r.closed_by_email || "-";
      const result = r.status === "ok" ? "conforme" : "non_conforme";
      const statusHist = STATUS.FAIT;
      const ncPdf =
        r.status === "nc" && r.pdf_nc_path
          ? `/api/mobile-equipment/equipments/${req.params.id}/nonconformities.pdf`
          : null;

      return {
        id: r.id,
        date: r.closed_at,
        status: statusHist,
        result,
        counts: r.result_counts || {},
        items,
        files: filesByCheck[r.id] || [],
        nc_pdf_url: ncPdf,
        user: username,
      };
    });

    res.json({ ok: true, checks });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// QR & PDF NC
// ------------------------------
app.get("/api/mobile-equipment/equipments/:id/qrcode", async (req, res) => {
  try {
    const size = Math.max(64, Math.min(1024, Number(req.query.size || 256)));
    const force = String(req.query.force || "") === "1";
    const { rows } = await pool.query(
      `SELECT id, name FROM me_equipments WHERE id=$1`,
      [req.params.id]
    );
    const e = rows[0];
    if (!e) return res.status(404).send("equipment");
    const file = await ensureEquipmentQRCode(req, e.id, e.name, size, force);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.sendFile(path.resolve(file));
  } catch (e) {
    res.status(500).send("err");
  }
});

// PDF of NC from LAST closed check
app.get("/api/mobile-equipment/equipments/:id/nonconformities.pdf", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.pdf_nc_path, c.items, c.status,
              e.name, e.code, e.building, e.floor, e.location
         FROM me_checks c
         JOIN me_equipments e ON e.id=c.equipment_id
        WHERE c.equipment_id=$1 AND c.closed_at IS NOT NULL
        ORDER BY c.closed_at DESC LIMIT 1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).send("no_history");

    if (row.status === "ok") {
      const tmp = path.join(
        DATA_ROOT,
        `NC_${row.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`
      );
      await createNcPdf(tmp, row, { items: [] });
      res.setHeader("Content-Type", "application/pdf");
      return res.sendFile(path.resolve(tmp));
    }

    if (row.pdf_nc_path && fs.existsSync(row.pdf_nc_path)) {
      res.setHeader("Content-Type", "application/pdf");
      return res.sendFile(path.resolve(row.pdf_nc_path));
    }

    const regen = path.join(
      DATA_ROOT,
      `NC_${row.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`
    );
    await createNcPdf(regen, row, { items: row.items || [] });
    res.setHeader("Content-Type", "application/pdf");
    res.sendFile(path.resolve(regen));
  } catch (e) {
    res.status(500).send("err");
  }
});

/* ========================================================================
   PDF QR with white frame + text on left (auto-fit) - Equipment name above QR
   GET /api/mobile-equipment/equipments/:id/qrcodes.pdf?sizes=120,200&force=0
   ======================================================================== */
app.get("/api/mobile-equipment/equipments/:id/qrcodes.pdf", async (req, res) => {
  try {
    const sizes = String(req.query.sizes || "120")
      .split(",")
      .map((s) => Math.max(64, Math.min(1024, Number(s) || 120)));
    const force = String(req.query.force || "") === "1";

    const { rows } = await pool.query(
      `SELECT id, name, code, building, floor, location FROM me_equipments WHERE id=$1`,
      [req.params.id]
    );
    const equipment = rows[0];
    if (!equipment) return res.status(404).send("equipment_not_found");

    const brand = "HALEON";
    const equipmentLabel =
      (equipment.name || "").trim() ||
      [equipment.building, equipment.floor, equipment.location].filter(Boolean).join(" - ") ||
      `Equipement ${equipment.id}`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="equipment-${equipment.id}-qrcodes.pdf"`
    );
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.pipe(res);

    function fitLabelSizes({ boxW, boxH }) {
      let sizeBrand = Math.min(32, Math.max(14, Math.floor(boxH * 0.22)));
      let sizeName = Math.min(18, Math.max(10, Math.floor(boxH * 0.16)));
      const gap = Math.max(6, Math.floor(boxH * 0.08));

      for (let i = 0; i < 60; i++) {
        doc.font("Helvetica-Bold").fontSize(sizeBrand);
        const wBrand = doc.widthOfString(brand);
        doc.font("Helvetica").fontSize(sizeName);
        const wName = doc.widthOfString(equipmentLabel);

        doc.font("Helvetica-Bold").fontSize(sizeBrand);
        const hBrand = doc.heightOfString(brand, { width: boxW, align: "left" });
        doc.font("Helvetica").fontSize(sizeName);
        const hName = doc.heightOfString(equipmentLabel, { width: boxW, align: "left" });

        const totalH = hBrand + gap + hName;

        const okWidth = wBrand <= boxW && wName <= boxW * 1.15;
        const okHeight = totalH <= boxH;

        if (okWidth && okHeight) {
          return { sizeBrand, sizeName, gap };
        }
        if (!okHeight && sizeBrand > 12) sizeBrand -= 1;
        if (!okHeight && sizeName > 9) sizeName -= 1;
        if (!okWidth && sizeBrand > 12 && wBrand > boxW) sizeBrand -= 1;
        if (!okWidth && sizeName > 9 && wName > boxW) sizeName -= 1;
      }
      return {
        sizeBrand: Math.max(12, sizeBrand),
        sizeName: Math.max(9, sizeName),
        gap: Math.max(6, gap),
      };
    }

    for (const qrSize of sizes) {
      const margin = 36;
      const colGap = 24;

      const cardPad = Math.max(10, Math.floor(qrSize * 0.1));
      const cardW = qrSize + cardPad * 2;
      const cardH = qrSize + cardPad * 2;

      const textBoxW = Math.max(140, Math.min(420, qrSize));
      const textBoxH = cardH;

      const pageW = margin * 2 + textBoxW + colGap + cardW;
      const pageH = margin * 2 + Math.max(cardH, textBoxH);

      doc.addPage({
        size: [pageW, pageH],
        margins: { left: margin, right: margin, top: margin, bottom: margin },
      });

      const cardX = margin + textBoxW + colGap;
      const cardY = margin;

      doc.save();
      doc.rect(cardX, cardY, cardW, cardH).fillAndStroke("#FFFFFF", "#E5E7EB");
      doc.restore();

      const qrPath = await ensureEquipmentQRCode(req, equipment.id, equipment.name, qrSize, force);
      const qrX = cardX + cardPad;
      const qrY = cardY + cardPad;
      doc.image(qrPath, qrX, qrY, { width: qrSize, height: qrSize });

      const { sizeBrand, sizeName, gap } = fitLabelSizes({
        boxW: textBoxW,
        boxH: textBoxH,
      });

      doc.font("Helvetica-Bold").fontSize(sizeBrand).fillColor("#000");
      const hBrand = doc.heightOfString("HALEON", { width: textBoxW });

      doc.font("Helvetica").fontSize(sizeName).fillColor("#111");
      const hName = doc.heightOfString(equipmentLabel, { width: textBoxW });

      const totalH = hBrand + gap + hName;
      const startY = margin + Math.max(0, (textBoxH - totalH) / 2);
      const textX = margin;

      doc.font("Helvetica-Bold").fontSize(sizeBrand).fillColor("#000");
      doc.text("HALEON", textX, startY, { width: textBoxW, align: "left" });

      doc.font("Helvetica").fontSize(sizeName).fillColor("#111");
      doc.text(equipmentLabel, textX, startY + hBrand + gap, {
        width: textBoxW,
        align: "left",
      });
    }

    doc.end();
  } catch (e) {
    res.status(500).send("err");
  }
});

// ------------------------------
// Calendar • /api/mobile-equipment/calendar
// ------------------------------
app.get("/api/mobile-equipment/calendar", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.id AS equipment_id, e.name AS equipment_name,
             c.due_date, c.started_at, c.closed_at
        FROM me_equipments e
        JOIN me_checks c ON c.equipment_id=e.id
       WHERE c.closed_at IS NULL
       ORDER BY c.due_date ASC
    `);

    const events = rows.map((r) => {
      const st = computeEquipmentStatus(r.due_date, !!(r.started_at && !r.closed_at));
      return { date: r.due_date, equipment_id: r.equipment_id, equipment_name: r.equipment_name, status: st };
    });

    res.json({ ok: true, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Alerts banner • /api/mobile-equipment/alerts
// ------------------------------
app.get("/api/mobile-equipment/alerts", async (_req, res) => {
  try {
    const today = todayISO();

    const { rows: agg } = await pool.query(
      `
      WITH pending AS (
        SELECT equipment_id, due_date
          FROM me_checks
         WHERE closed_at IS NULL
      ),
      last_closed AS (
        SELECT DISTINCT ON (equipment_id) equipment_id, status
          FROM me_checks
         WHERE closed_at IS NOT NULL
         ORDER BY equipment_id, closed_at DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE p.due_date < $1)                      AS overdue,
        COUNT(*) FILTER (WHERE p.due_date >= $1 AND p.due_date <= $2) AS due_30,
        COUNT(*)                                                      AS pending,
        COUNT(*) FILTER (WHERE lc.status = 'nc')                      AS last_nc
      FROM pending p
      LEFT JOIN last_closed lc ON lc.equipment_id = p.equipment_id
      `,
      [today, addDaysISO(today, 30)]
    );

    const c = agg[0] || { overdue: 0, due_30: 0, pending: 0, last_nc: 0 };
    let level = "ok";
    if (Number(c.overdue) > 0) level = "danger";
    else if (Number(c.due_30) > 0) level = "warn";

    let message = "Aucune alerte.";
    if (level === "warn") message = `Controles a planifier (<30j) : ${c.due_30}.`;
    if (level === "danger") message = `Controles en retard : ${c.overdue}.`;

    res.json({
      ok: true,
      level,
      message,
      counts: {
        overdue: Number(c.overdue || 0),
        due_30: Number(c.due_30 || 0),
        pending: Number(c.pending || 0),
        last_nc: Number(c.last_nc || 0),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========================================================================
   MAPS — API /api/mobile-equipment/maps/*
   ======================================================================== */

/** Upload ZIP of plans */
app.post("/api/mobile-equipment/maps/uploadZip", uploadZip.single("zip"), async (req, res) => {
  const zipPath = req.file?.path;
  if (!zipPath) return res.status(400).json({ ok: false, error: "zip manquant" });

  const zip = new StreamZip.async({ file: zipPath, storeEntries: true });
  const imported = [];
  try {
    const entries = await zip.entries();
    const files = Object.values(entries).filter(
      (e) => !e.isDirectory && /\.pdf$/i.test(e.name)
    );

    for (const entry of files) {
      const tmpOut = path.join(MAPS_INCOMING_DIR, crypto.randomUUID() + ".pdf");
      await zip.extract(entry.name, tmpOut);

      const { logical, version } = parsePlanName(entry.name);

      const safeRel = entry.name.replace(/[^\w.\-\/]+/g, "_");
      const dest = path.join(MAPS_STORE_DIR, `${Date.now()}_${safeRel}`);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(tmpOut, dest);

      const page_count = await pdfPageCount(dest).catch(() => 1);
      let buf = null;
      try {
        buf = await fsp.readFile(dest);
      } catch {
        buf = null;
      }

      if (buf) {
        await pool.query(
          `INSERT INTO me_plans (logical_name, version, filename, file_path, page_count, content)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [logical, version, entry.name, dest, page_count, buf]
        );
      } else {
        await pool.query(
          `INSERT INTO me_plans (logical_name, version, filename, file_path, page_count)
           VALUES ($1,$2,$3,$4,$5)`,
          [logical, version, entry.name, dest, page_count]
        );
      }

      await pool.query(
        `INSERT INTO me_plan_names (logical_name, display_name)
         VALUES ($1,$2) ON CONFLICT (logical_name) DO NOTHING`,
        [logical, logical]
      );

      imported.push({ logical_name: logical, version, page_count });
    }

    res.json({ ok: true, imported });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    await zip.close().catch(() => {});
    fs.rmSync(zipPath, { force: true });
  }
});

/** List plans - USES VSD PLANS for symbiosis (shared plans across modules) */
app.get("/api/mobile-equipment/maps/plans", async (_req, res) => {
  try {
    // Use VSD plans (vsd_plans, vsd_plan_names) for symbiosis with VSD module
    // Note: vsd_plans doesn't have created_at, use version for ordering
    const q = `
      WITH latest AS (
        SELECT DISTINCT ON (logical_name) id, logical_name, version, page_count
        FROM vsd_plans
        ORDER BY logical_name, version DESC
      ),
      names AS (
        SELECT logical_name, COALESCE(display_name, logical_name) AS display_name
        FROM vsd_plan_names
      ),
      pos AS (
        SELECT p.plan_logical_name AS logical_name, p.equipment_id
          FROM me_equipment_positions p
          GROUP BY p.plan_logical_name, p.equipment_id
      ),
      -- Count mobile equipments placed on each plan
      equip_counts AS (
        SELECT pos.logical_name, COUNT(DISTINCT pos.equipment_id) AS equipment_count
        FROM pos
        GROUP BY pos.logical_name
      )
      SELECT l.id, l.logical_name, n.display_name, l.version, l.page_count,
             COALESCE(ec.equipment_count, 0)::int AS equipment_count,
             0 AS actions_next_30,
             0 AS overdue
        FROM latest l
   LEFT JOIN names n USING (logical_name)
   LEFT JOIN equip_counts ec ON ec.logical_name = l.logical_name
    ORDER BY n.display_name ASC;
    `;
    const { rows } = await pool.query(q);
    res.json({ ok: true, plans: rows, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Stream plan PDF by ID (UUID) - USES VSD PLANS */
app.get(
  "/api/mobile-equipment/maps/plan/:id([0-9a-fA-F\\-]{36})/file",
  async (req, res) => {
    try {
      // Use VSD plans for symbiosis
      const { rows } = await pool.query(
        `SELECT file_path, content FROM vsd_plans WHERE id=$1`,
        [req.params.id]
      );
      const row = rows[0];
      const p = row?.file_path;
      const buf = row?.content;

      if (buf && buf.length) {
        res.type("application/pdf");
        return res.end(buf, "binary");
      }
      if (p && fs.existsSync(p)) {
        return res.type("application/pdf").sendFile(path.resolve(p));
      }
      return res.status(404).send("not_found");
    } catch (e) {
      res.status(500).send("err");
    }
  }
);

/** Stream plan PDF by logical_name - USES VSD PLANS */
app.get("/api/mobile-equipment/maps/plan/:logical/file", async (req, res) => {
  try {
    const logical = String(req.params.logical || "");
    if (!logical) return res.status(400).send("logical");
    // Use VSD plans for symbiosis
    const { rows } = await pool.query(
      `SELECT file_path, content FROM vsd_plans WHERE logical_name=$1 ORDER BY version DESC LIMIT 1`,
      [logical]
    );
    const row = rows[0];
    const p = row?.file_path;
    const buf = row?.content;

    if (buf && buf.length) {
      res.type("application/pdf");
      return res.end(buf, "binary");
    }
    if (p && fs.existsSync(p)) {
      return res.type("application/pdf").sendFile(path.resolve(p));
    }
    return res.status(404).send("not_found");
  } catch (e) {
    res.status(500).send("err");
  }
});

/** Rename display_name of a logical_name */
app.put("/api/mobile-equipment/maps/plan/:logical/rename", async (req, res) => {
  try {
    const logical = String(req.params.logical || "");
    const { display_name } = req.body || {};
    if (!logical || !display_name)
      return res
        .status(400)
        .json({ ok: false, error: "display_name requis" });
    await pool.query(
      `INSERT INTO me_plan_names(logical_name, display_name)
       VALUES ($1,$2)
       ON CONFLICT (logical_name) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [logical, String(display_name).trim()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** List positions for a plan/page */
app.get("/api/mobile-equipment/maps/positions", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    const logicalParam = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);

    let logical = logicalParam;
    if (!logical && /^[0-9a-fA-F-]{36}$/.test(id)) {
      // Use VSD plans for symbiosis
      const { rows } = await pool.query(
        `SELECT logical_name FROM vsd_plans WHERE id=$1 LIMIT 1`,
        [id]
      );
      logical = rows?.[0]?.logical_name || "";
    }
    if (!logical)
      return res.status(400).json({ ok: false, error: "logical_name ou id requis" });

    const q = `
      WITH pend AS (
        SELECT equipment_id, due_date
          FROM me_checks
         WHERE closed_at IS NULL
      ),
      last_closed AS (
        SELECT DISTINCT ON (equipment_id)
               equipment_id, status
          FROM me_checks
         WHERE closed_at IS NOT NULL
         ORDER BY equipment_id, closed_at DESC
      )
      SELECT p.equipment_id,
             e.name,
             e.building,
             e.floor,
             p.x_frac, p.y_frac,
             CASE
               WHEN pend.due_date < CURRENT_DATE THEN 'en_retard'
               WHEN pend.due_date <= CURRENT_DATE + INTERVAL '30 day' THEN 'en_cours_30'
               ELSE 'a_faire'
             END AS status,
             CASE WHEN lc.status = 'nc' THEN 'non_conforme'
                  WHEN lc.status = 'ok' THEN 'conforme'
                  ELSE NULL END AS equipment_state
        FROM me_equipment_positions p
        JOIN me_equipments e ON e.id = p.equipment_id
   LEFT JOIN pend ON pend.equipment_id = p.equipment_id
   LEFT JOIN last_closed lc ON lc.equipment_id = p.equipment_id
       WHERE p.plan_logical_name=$1 AND p.page_index=$2
       ORDER BY e.name ASC
    `;
    const { rows } = await pool.query(q, [logical, pageIndex]);

    // Format positions with proper field names expected by frontend
    const positions = rows.map((r) => ({
      equipment_id: r.equipment_id,
      name: r.name,
      building: r.building,
      floor: r.floor,
      equipment_state: r.equipment_state,
      x_frac: Number(r.x_frac ?? 0),
      y_frac: Number(r.y_frac ?? 0),
      status: r.status,
    }));

    res.json({ ok: true, positions, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Equipments NOT positioned for a plan/page */
app.get("/api/mobile-equipment/maps/pending-positions", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);

    if (!logical) {
      return res.status(400).json({ ok: false, error: "logical_name requis" });
    }

    const q = `
      WITH pend AS (
        SELECT equipment_id, due_date
          FROM me_checks
         WHERE closed_at IS NULL
      ),
      last_closed AS (
        SELECT DISTINCT ON (equipment_id)
               equipment_id, status
          FROM me_checks
         WHERE closed_at IS NOT NULL
         ORDER BY equipment_id, closed_at DESC
      )
      SELECT e.id   AS equipment_id,
             e.name AS equipment_name,
             e.building,
             e.floor,
             CASE
               WHEN pend.due_date < CURRENT_DATE THEN 'en_retard'
               WHEN pend.due_date <= CURRENT_DATE + INTERVAL '30 day' THEN 'en_cours_30'
               ELSE 'a_faire'
             END AS status,
             CASE WHEN lc.status = 'nc' THEN 'non_conforme'
                  WHEN lc.status = 'ok' THEN 'conforme'
                  ELSE NULL END AS equipment_state
        FROM me_equipments e
        LEFT JOIN me_equipment_positions p
          ON p.equipment_id = e.id
         AND p.plan_logical_name = $1
         AND p.page_index = $2
   LEFT JOIN pend ON pend.equipment_id = e.id
   LEFT JOIN last_closed lc ON lc.equipment_id = e.id
       WHERE p.equipment_id IS NULL
       ORDER BY e.name ASC;
    `;
    const { rows } = await pool.query(q, [logical, pageIndex]);

    const pending = rows.map((r) => ({
      equipment_id: r.equipment_id,
      equipment_name: r.equipment_name,
      building: r.building,
      floor: r.floor,
      equipment_state: r.equipment_state,
      status: r.status,
    }));

    res.json({ ok: true, pending });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Save/Update position of equipment on a plan/page */
app.put("/api/mobile-equipment/maps/positions/:equipmentId", async (req, res) => {
  try {
    const equipmentId = req.params.equipmentId;
    let {
      logical_name,
      plan_id,
      page_index = 0,
      page_label = null,
      x_frac,
      y_frac,
      x,
      y,
    } = req.body || {};

    // if plan_id provided and logical_name missing -> resolve from VSD plans (symbiosis)
    if ((!logical_name || String(logical_name).trim() === "") && plan_id && /^[0-9a-fA-F-]{36}$/.test(String(plan_id))) {
      const { rows } = await pool.query(
        `SELECT logical_name FROM vsd_plans WHERE id=$1 LIMIT 1`,
        [plan_id]
      );
      logical_name = rows?.[0]?.logical_name || null;
    }

    const xf = x_frac != null ? x_frac : x;
    const yf = y_frac != null ? y_frac : y;

    if (!logical_name || xf == null || yf == null) {
      return res.status(400).json({ ok: false, error: "coords/logical requis" });
    }

    await pool.query(
      `INSERT INTO me_equipment_positions (equipment_id, plan_logical_name, page_index, page_label, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (equipment_id, plan_logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac, page_label=EXCLUDED.page_label, updated_at=now()`,
      [equipmentId, String(logical_name), Number(page_index || 0), page_label, Number(xf), Number(yf)]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Boot
// ------------------------------
await ensureSchema();

// ============================================================
// AUDIT TRAIL
// ============================================================
const audit = createAuditTrail(pool, 'mobile_equipment');
await audit.ensureTable();
console.log('[mobile-equipment] Audit trail initialized');

// ============================================================
// AUDIT API ENDPOINTS
// ============================================================

// GET /audit/history
app.get('/api/mobile-equipment/audit/history', async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { action, entityType, limit = 100, offset = 0 } = req.query;

    const events = await audit.getRecentEvents(tenant, {
      action: action || null,
      entityType: entityType || null,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({ events });
  } catch (e) {
    console.error('[mobile-equipment] Audit history error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /audit/entity/:type/:id
app.get('/api/mobile-equipment/audit/entity/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const events = await audit.getHistory(type, id, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({ events });
  } catch (e) {
    console.error('[mobile-equipment] Audit entity history error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /audit/stats
app.get('/api/mobile-equipment/audit/stats', async (req, res) => {
  try {
    const tenant = extractTenantFromRequest(req);
    const { days = 30 } = req.query;

    const stats = await audit.getStats(tenant, { days: parseInt(days) });

    res.json({ stats });
  } catch (e) {
    console.error('[mobile-equipment] Audit stats error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[mobile-equipment] listening on ${HOST}:${PORT}`);
  console.log(
    `QR base default: ${process.env.PUBLIC_BASE || "(dynamic from host)"} + ${DEFAULT_APP_PATH}`
  );
});
