// ==============================
// server_doors.js — Fire Doors CMMS microservice (ESM)
// Port: 3016
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

// 🔹 MAPS
import crypto from "crypto";
import StreamZip from "node-stream-zip";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// pdf.js (legacy) pour compter les pages PDF
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

// 🔐 Helmet — CSP assouplie pour pdf.js (CDN) & worker
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "object-src": ["'self'", "blob:"],
        "img-src": ["'self'", "data:", "blob:"],
        // autorise pdf.worker chargé depuis CDN
        "worker-src": ["'self'", "blob:", "https://esm.sh"],
        // autorise pdfjs-dist@esm.sh
        "script-src": ["'self'", "'unsafe-inline'", "https://esm.sh"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "connect-src": ["'self'", "*"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS élargi (headers identité)
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

const PORT = Number(process.env.FIRE_DOORS_PORT || 3016);
const HOST = process.env.FIRE_DOORS_HOST || "0.0.0.0";

// Storage layout
const DATA_ROOT = path.join(process.cwd(), "uploads", "fire-doors");
const FILES_DIR = path.join(DATA_ROOT, "files");
const QRCODES_DIR = path.join(DATA_ROOT, "qrcodes");
await fsp.mkdir(FILES_DIR, { recursive: true });
await fsp.mkdir(QRCODES_DIR, { recursive: true });

// 🔹 MAPS — arborescence
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

// 🔹 MAPS — Multer ZIP (300MB)
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

  // Settings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_settings (
      id INT PRIMARY KEY DEFAULT 1,
      checklist_template JSONB NOT NULL DEFAULT '[]'::jsonb,
      frequency TEXT NOT NULL DEFAULT '1_an',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    INSERT INTO fd_settings (id, checklist_template, frequency)
    VALUES (1, '[
      "La porte est-elle en parfait état (fermeture correcte, non voilée) ?",
      "Joint de porte en bon état (propre, non abîmé) ?",
      "Aucune modification non tracée (perçages, changement nécessitant vérification) ?",
      "Plaquette d’identification (portes ≥ 2005) visible ?",
      "Porte à double battant bien synchronisée (un battant après l’autre, fermeture OK) ?"
    ]'::jsonb, '1_an')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Doors
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_doors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT,
      floor TEXT,
      location TEXT,
      photo_path TEXT,
      photo_file_id UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE fd_doors ADD COLUMN IF NOT EXISTS photo_path TEXT;`);
  await pool.query(`ALTER TABLE fd_doors ADD COLUMN IF NOT EXISTS photo_file_id UUID;`);

  // Checks
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      door_id UUID REFERENCES fd_doors(id) ON DELETE CASCADE,
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
  await pool.query(`ALTER TABLE fd_checks ADD COLUMN IF NOT EXISTS closed_by_email TEXT;`);
  await pool.query(`ALTER TABLE fd_checks ADD COLUMN IF NOT EXISTS closed_by_name TEXT;`);

  // Files
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      door_id UUID REFERENCES fd_doors(id) ON DELETE CASCADE,
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
  await pool.query(`ALTER TABLE fd_files ADD COLUMN IF NOT EXISTS inspection_id UUID;`);
  await pool.query(`ALTER TABLE fd_files ADD COLUMN IF NOT EXISTS kind TEXT;`);
  await pool.query(`ALTER TABLE fd_files ADD COLUMN IF NOT EXISTS content BYTEA;`);

  // 🔹 MAPS — tables plans, noms, positions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version TEXT NOT NULL,
      filename TEXT,
      file_path TEXT,
      page_count INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS fd_plans_logical_idx ON fd_plans(logical_name);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS fd_plans_created_idx ON fd_plans(created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_door_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      door_id UUID REFERENCES fd_doors(id) ON DELETE CASCADE,
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
        SELECT 1 FROM pg_constraint WHERE conname = 'fd_door_positions_uniq'
      ) THEN
        ALTER TABLE fd_door_positions
        ADD CONSTRAINT fd_door_positions_uniq UNIQUE (door_id, plan_logical_name, page_index);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fd_checks_door_due
      ON fd_checks(door_id, due_date) WHERE closed_at IS NULL;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fd_files_door ON fd_files(door_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fd_files_insp ON fd_files(inspection_id);`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fd_checks_door_closed
      ON fd_checks(door_id, closed_at DESC) WHERE closed_at IS NOT NULL;
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
  "1_an": 12,
  "1_mois": 1,
  "2_an": 6,
  "3_mois": 3,
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

function computeDoorStatus(due_date, hasStarted) {
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
    `SELECT checklist_template, frequency FROM fd_settings WHERE id=1`
  );
  return rows[0] || { checklist_template: [], frequency: "1_an" };
}

// URL publique (Render / proxy)
function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0] || "https";
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0];
  if (!host) return "https://autonomix-elec.onrender.com";
  return `${proto}://${host}`;
}
const DEFAULT_APP_PATH = process.env.FIRE_DOORS_QR_APP_PATH || "/app/doors";
function qrDeepLink(req, doorId) {
  const envBase = process.env.PUBLIC_BASE;
  if (envBase) {
    try {
      const u = new URL(envBase);
      let base = u.href.replace(/\/+$/, "");
      if (base.endsWith("/app/doors")) {
        return `${base}?door=${doorId}`;
      }
      return `${base}${DEFAULT_APP_PATH}?door=${doorId}`;
    } catch {}
  }
  const origin = publicOrigin(req);
  return `${origin}${DEFAULT_APP_PATH}?door=${doorId}`;
}

// Lecture cookie
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

// ==== Identité
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

  let bodyEmail = null,
    bodyName = null;
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

// Planifie un "pending" si aucun : J+30 la toute première fois, sinon +fréquence
async function ensureNextPendingCheck(door_id) {
  const { rows: pend } = await pool.query(
    `SELECT id FROM fd_checks WHERE door_id=$1 AND closed_at IS NULL ORDER BY due_date ASC LIMIT 1`,
    [door_id]
  );
  if (pend[0]) return pend[0];

  const { rows: any } = await pool.query(
    `SELECT 1 FROM fd_checks WHERE door_id=$1 LIMIT 1`,
    [door_id]
  );

  const s = await getSettings();
  const due = any[0]
    ? addMonthsISO(todayISO(), FREQ_TO_MONTHS[s.frequency] || 12)
    : addDaysISO(todayISO(), 30);

  const r = await pool.query(
    `INSERT INTO fd_checks(door_id, due_date) VALUES($1,$2) RETURNING id`,
    [door_id, due]
  );
  return r.rows[0];
}

// QRCode — cache par base publique
async function ensureDoorQRCode(req, doorId, name, size = 512, force = false) {
  const targetUrl = qrDeepLink(req, doorId);
  let baseKey = "default";
  try {
    baseKey = Buffer.from(new URL(targetUrl).origin).toString("hex").slice(0, 8);
  } catch {}
  const file = path.join(QRCODES_DIR, `${doorId}_${size}_${baseKey}.png`);
  if (force || !fs.existsSync(file)) {
    await QRCode.toFile(file, targetUrl, { width: size, margin: 1 });
  }
  return file;
}

async function createNcPdf(outPath, door, check, inspectorName = null) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const ws = fs.createWriteStream(outPath);
    ws.on("finish", resolve);
    ws.on("error", reject);
    doc.pipe(ws);

    doc.fontSize(18).text("Rapport de non-conformités — Porte coupe-feu");
    doc.moveDown(0.5).fontSize(12).text(`Porte : ${door.name}`);
    const loc = [door.building, door.floor, door.location].filter(Boolean).join(" • ");
    doc.text(`Localisation : ${loc || "-"}`);
    doc.text(`Date : ${new Date().toLocaleDateString()}`);
    if (inspectorName) doc.text(`Inspecteur : ${inspectorName}`);
    doc.moveDown();

    const nc = (check.items || []).filter((it) => it.value === "non_conforme");
    if (!nc.length) {
      doc.fontSize(12).text("Aucune non-conformité.");
    } else {
      nc.forEach((it, i) => {
        doc.fontSize(14).text(`${i + 1}. ${it.label || "-"}`);
        doc.moveDown(0.25).fontSize(11).fillColor("#333").text(`Résultat : Non conforme`);
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
    url: `/api/doors/files/${f.id}/download`,
    download_url: `/api/doors/files/${f.id}/download`,
    inline_url: `/api/doors/files/${f.id}/download`,
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

// 🔹 MAPS — helpers
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
app.get("/api/doors/health", async (_req, res) => {
  try {
    const { rows: d } = await pool.query(`SELECT COUNT(*)::int AS n FROM fd_doors`);
    res.json({ ok: true, doors: d[0]?.n ?? 0, port: PORT });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Debug identité
// ------------------------------
app.get("/api/doors/_debug_identity", (req, res) => {
  res.json({
    headers: {
      "x-user-email": req.headers["x-user-email"] || null,
      "x-user-name": req.headers["x-user-name"] || null,
      cookie: req.headers["cookie"] || null,
    },
    body: req.body || null,
  });
});
app.get("/api/doors/_whoami", async (req, res) => {
  const u = await currentUser(req);
  res.json({ ok: true, resolved: u });
});

// ------------------------------
// Settings (GET/PUT)
// ------------------------------
app.get("/api/doors/settings", async (_req, res) => {
  try {
    const s = await getSettings();
    res.json({ ok: true, ...s });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put("/api/doors/settings", async (req, res) => {
  try {
    const { checklist_template, frequency } = req.body || {};
    const tpl =
      Array.isArray(checklist_template)
        ? checklist_template.map((x) => String(x || "").trim()).filter(Boolean)
        : undefined;
    const freq = frequency && FREQ_TO_MONTHS[frequency] ? frequency : undefined;

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
      fields.push(`frequency=$${i++}`);
      values.push(freq);
    }
    await pool.query(
      `UPDATE fd_settings SET ${fields.join(", ")}, updated_at=now() WHERE id=1`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Doors CRUD  • /api/doors/doors
// ------------------------------
app.get("/api/doors/doors", async (req, res) => {
  try {
    const { q = "", status = "", building = "", floor = "", door_state = "" } = req.query || {};

    const { rows } = await pool.query(
      `
      WITH last_closed AS (
        SELECT DISTINCT ON (door_id)
               door_id, status
          FROM fd_checks
         WHERE closed_at IS NOT NULL
         ORDER BY door_id, closed_at DESC
      )
      SELECT d.id, d.name, d.building, d.floor, d.location, d.photo_path,
             (SELECT started_at IS NOT NULL AND closed_at IS NULL FROM fd_checks c WHERE c.door_id=d.id ORDER BY due_date ASC LIMIT 1) AS has_started,
             (SELECT due_date FROM fd_checks c WHERE c.door_id=d.id AND c.closed_at IS NULL ORDER BY due_date ASC LIMIT 1) AS next_due,
             CASE WHEN lc.status = 'nc' THEN 'non_conforme'
                  WHEN lc.status = 'ok' THEN 'conforme'
                  ELSE NULL END AS door_state
      FROM fd_doors d
      LEFT JOIN last_closed lc ON lc.door_id = d.id
      WHERE ($1 = '' OR d.name ILIKE '%'||$1||'%' OR d.location ILIKE '%'||$1||'%' OR d.building ILIKE '%'||$1||'%' OR d.floor ILIKE '%'||$1||'%')
        AND ($2 = '' OR d.building ILIKE '%'||$2||'%')
        AND ($3 = '' OR d.floor ILIKE '%'||$3||'%')
        AND ($4 = '' OR (CASE WHEN lc.status='nc' THEN 'non_conforme' WHEN lc.status='ok' THEN 'conforme' ELSE '' END) = $4)
      ORDER BY d.name ASC
    `,
      [q, building, floor, door_state]
    );

    const items = rows
      .map((r) => {
        const st = computeDoorStatus(r.next_due, r.has_started);
        return {
          id: r.id,
          name: r.name,
          building: r.building,
          floor: r.floor,
          location: r.location,
          status: st,
          next_check_date: r.next_due || null,
          photo_url: r.photo_path ? `/api/doors/doors/${r.id}/photo` : null,
          door_state: r.door_state,
        };
      })
      .filter((it) => !status || it.status === status);

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/doors/doors", async (req, res) => {
  try {
    const { name, building = "", floor = "", location = "" } = req.body || {};
    if (!name) return res.status(400).json({ error: "name requis" });

    const { rows } = await pool.query(
      `INSERT INTO fd_doors(name, building, floor, location) VALUES($1,$2,$3,$4) RETURNING *`,
      [name, building, floor, location]
    );
    const door = rows[0];

    // Premier contrôle "pending" à J+30
    const due = addDaysISO(todayISO(), 30);
    await pool.query(`INSERT INTO fd_checks(door_id, due_date) VALUES($1,$2)`, [
      door.id,
      due,
    ]);

    res.json({
      ok: true,
      door: { ...door, next_check_date: due, photo_url: null, door_state: null },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/doors/doors/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM fd_doors WHERE id=$1`, [
      req.params.id,
    ]);
    const door = rows[0];
    if (!door) return res.status(404).json({ ok: false, error: "not_found" });

    const { rows: cur } = await pool.query(
      `SELECT id, started_at, closed_at, due_date, items
         FROM fd_checks
        WHERE door_id=$1 AND closed_at IS NULL
        ORDER BY due_date ASC LIMIT 1`,
      [door.id]
    );
    const check = cur[0] || null;
    const hasStarted = !!(check && check.started_at && !check.closed_at);
    const status = computeDoorStatus(check?.due_date || null, hasStarted);

    const { rows: last } = await pool.query(
      `SELECT status FROM fd_checks WHERE door_id=$1 AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`,
      [door.id]
    );
    const door_state =
      last[0]?.status === "ok"
        ? "conforme"
        : last[0]?.status === "nc"
        ? "non_conforme"
        : null;

    res.json({
      ok: true,
      door: {
        id: door.id,
        name: door.name,
        building: door.building,
        floor: door.floor,
        location: door.location,
        status,
        next_check_date: check?.due_date || null,
        photo_url: door.photo_path ? `/api/doors/doors/${door.id}/photo` : null,
        door_state,
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

app.put("/api/doors/doors/:id", async (req, res) => {
  try {
    const { name, building, floor, location } = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;
    if (name !== undefined) {
      fields.push(`name=$${i++}`);
      values.push(name);
    }
    if (building !== undefined) {
      fields.push(`building=$${i++}`);
      values.push(building);
    }
    if (floor !== undefined) {
      fields.push(`floor=$${i++}`);
      values.push(floor);
    }
    if (location !== undefined) {
      fields.push(`location=$${i++}`);
      values.push(location);
    }
    values.push(req.params.id);
    await pool.query(
      `UPDATE fd_doors SET ${fields.join(", ")}, updated_at=now() WHERE id=$${i}`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/doors/doors/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM fd_doors WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Photo (vignette)
// ------------------------------
app.post(
  "/api/doors/doors/:id/photo",
  uploadAny.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "photo requise" });
      const buf = await fsp.readFile(req.file.path);

      const { rows: ins } = await pool.query(
        `INSERT INTO fd_files(door_id, inspection_id, kind, filename, path, mime, size_bytes, content)
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
        `UPDATE fd_doors SET photo_path=$1, photo_file_id=$2, updated_at=now() WHERE id=$3`,
        [req.file.path, fileId, req.params.id]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

app.get("/api/doors/doors/:id/photo", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT photo_path, photo_file_id FROM fd_doors WHERE id=$1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).send("no_door");

    // 1) DB d'abord
    if (row.photo_file_id) {
      const { rows: frows } = await pool.query(
        `SELECT mime, content FROM fd_files WHERE id=$1`,
        [row.photo_file_id]
      );
      const f = frows[0];
      if (f?.content) {
        res.setHeader("Content-Type", f.mime || "image/*");
        return res.end(f.content, "binary");
      }
    }
    // 2) disque
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
// Files  • /api/doors/doors/:id/files
// ------------------------------
app.post(
  "/api/doors/doors/:id/files",
  uploadAny.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: "file_required" });
      const buf = await fsp.readFile(req.file.path);
      await pool.query(
        `INSERT INTO fd_files(door_id, inspection_id, kind, filename, path, mime, size_bytes, content)
         VALUES($1, NULL, 'door', $2, $3, $4, $5, $6)`,
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

app.get("/api/doors/doors/:id/files", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime, size_bytes
         FROM fd_files
        WHERE door_id=$1 AND (inspection_id IS NULL OR kind='door')
        ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    const files = rows.map(fileRowToClient);
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/doors/files/:fileId/download", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT path, filename, mime, content FROM fd_files WHERE id=$1`,
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

app.delete("/api/doors/files/:fileId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM fd_files WHERE id=$1 RETURNING path`,
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
// Checks workflow  • /api/doors/doors/:id/checks
// ------------------------------
app.post("/api/doors/doors/:id/checks", async (req, res) => {
  try {
    const door_id = req.params.id;

    const pend = await ensureNextPendingCheck(door_id);
    await pool.query(
      `UPDATE fd_checks SET started_at = COALESCE(started_at, now()), updated_at=now() WHERE id=$1`,
      [pend.id]
    );

    const { rows: checkR } = await pool.query(`SELECT * FROM fd_checks WHERE id=$1`, [
      pend.id,
    ]);
    let check = checkR[0];
    if ((check.items || []).length === 0) {
      const s = await getSettings();
      const items = (s.checklist_template || [])
        .slice(0, 5)
        .map((label, i) => ({ index: i, label, value: null }));
      const { rows: upd } = await pool.query(
        `UPDATE fd_checks SET items=$1, updated_at=now() WHERE id=$2 RETURNING *`,
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

// PUT (JSON ou multipart) — fichiers avec copie DB
app.put(
  "/api/doors/doors/:id/checks/:checkId",
  uploadAny.array("files", 20),
  async (req, res) => {
    try {
      const doorId = req.params.id;
      const checkId = req.params.checkId;

      const { rows: curR } = await pool.query(
        `SELECT * FROM fd_checks WHERE id=$1 AND door_id=$2`,
        [checkId, doorId]
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

      // fichiers liés au contrôle (copie DB)
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
            doorId,
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
          `INSERT INTO fd_files(door_id, inspection_id, kind, filename, path, mime, size_bytes, content)
           VALUES ${params.join(",")}`,
          vals
        );
      }

      const wantsCloseRaw = req.body && req.body.close;
      const bodyClose =
        typeof wantsCloseRaw === "string"
          ? ["1", "true", "yes", "on"].includes(wantsCloseRaw.toLowerCase())
          : !!wantsCloseRaw;
      const close = bodyClose || allFiveFilled(merged);

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
          const { rows: doorR } = await pool.query(
            `SELECT id, name, building, floor, location FROM fd_doors WHERE id=$1`,
            [doorId]
          );
          const door = doorR[0];
          const out = path.join(
            DATA_ROOT,
            `NC_${door.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`
          );
          await createNcPdf(out, door, { items: merged }, userName || userEmail || undefined);
          pdfPath = out;
        }

        const { rows: upd } = await pool.query(
          `UPDATE fd_checks
             SET items=$1, closed_at=now(), status=$2, result_counts=$3, pdf_nc_path=$4,
                 closed_by_email=$5, closed_by_name=$6, updated_at=now()
           WHERE id=$7
           RETURNING *`,
          [JSON.stringify(merged), status, counts, pdfPath, userEmail, userName, checkId]
        );
        closedRow = upd[0];

        const months = FREQ_TO_MONTHS[settings.frequency] || 12;
        const nextDue = addMonthsISO(todayISO(), months);
        await pool.query(`INSERT INTO fd_checks(door_id, due_date) VALUES($1,$2)`, [
          doorId,
          nextDue,
        ]);

        notice = `Contrôle enregistré dans l’historique. Prochain contrôle le ${new Date(
          nextDue + "T00:00:00Z"
        ).toLocaleDateString()}.`;
      } else {
        await pool.query(
          `UPDATE fd_checks SET items=$1, updated_at=now() WHERE id=$2`,
          [JSON.stringify(merged), checkId]
        );
      }

      const { rows: dR } = await pool.query(`SELECT * FROM fd_doors WHERE id=$1`, [
        doorId,
      ]);
      const door = dR[0];

      const { rows: pend } = await pool.query(
        `SELECT id, started_at, closed_at, due_date, items
           FROM fd_checks
          WHERE door_id=$1 AND closed_at IS NULL
          ORDER BY due_date ASC LIMIT 1`,
        [doorId]
      );
      const c = pend[0] || null;
      const hasStarted = !!(c && c.started_at && !c.closed_at);
      const statusDoor = computeDoorStatus(c?.due_date || null, hasStarted);

      const { rows: last } = await pool.query(
        `SELECT status FROM fd_checks WHERE door_id=$1 AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`,
        [doorId]
      );
      const door_state =
        last[0]?.status === "ok"
          ? "conforme"
          : last[0]?.status === "nc"
          ? "non_conforme"
          : null;

      res.json({
        ok: true,
        notice,
        door: {
          id: door.id,
          name: door.name,
          building: door.building,
          floor: door.floor,
          location: door.location,
          status: statusDoor,
          next_check_date: c?.due_date || null,
          photo_url: door.photo_path ? `/api/doors/doors/${door.id}/photo` : null,
          door_state,
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

// Historique (checks clos)
app.get("/api/doors/doors/:id/history", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.closed_at, c.status, c.result_counts, c.items, c.pdf_nc_path, c.closed_by_email, c.closed_by_name
         FROM fd_checks c
        WHERE c.door_id=$1 AND c.closed_at IS NOT NULL
        ORDER BY c.closed_at DESC`,
      [req.params.id]
    );

    const { rows: files } = await pool.query(
      `SELECT id, filename, inspection_id
         FROM fd_files
        WHERE door_id=$1 AND inspection_id IS NOT NULL
        ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    const filesByCheck = files.reduce((acc, f) => {
      (acc[f.inspection_id] ||= []).push({
        id: f.id,
        name: f.filename,
        url: `/api/doors/files/${f.id}/download`,
      });
      return acc;
    }, {});

    const settings = await getSettings();
    const checks = rows.map((r) => {
      const items = normalizeItemsWithLabels(r.items || [], settings.checklist_template);
      const username = r.closed_by_name || r.closed_by_email || "—";
      const result = r.status === "ok" ? "conforme" : "non_conforme";
      const statusHist = STATUS.FAIT;
      const ncPdf =
        r.status === "nc" && r.pdf_nc_path
          ? `/api/doors/doors/${req.params.id}/nonconformities.pdf`
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
// QR & PDF NC (dernière clôture)
// ------------------------------
app.get("/api/doors/doors/:id/qrcode", async (req, res) => {
  try {
    const size = Math.max(64, Math.min(1024, Number(req.query.size || 256)));
    const force = String(req.query.force || "") === "1";
    const { rows } = await pool.query(
      `SELECT id, name FROM fd_doors WHERE id=$1`,
      [req.params.id]
    );
    const d = rows[0];
    if (!d) return res.status(404).send("door");
    const file = await ensureDoorQRCode(req, d.id, d.name, size, force);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.sendFile(path.resolve(file));
  } catch (e) {
    res.status(500).send("err");
  }
});

// PDF des non-conformités du DERNIER contrôle clos
app.get("/api/doors/doors/:id/nonconformities.pdf", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.pdf_nc_path, c.items, c.status,
              d.name, d.building, d.floor, d.location
         FROM fd_checks c
         JOIN fd_doors d ON d.id=c.door_id
        WHERE c.door_id=$1 AND c.closed_at IS NOT NULL
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
   💡 PDF QR avec cadre blanc + texte à gauche (auto-fit)
   GET /api/doors/doors/:id/qrcodes.pdf?sizes=120,200&force=0
   ======================================================================== */
app.get("/api/doors/doors/:id/qrcodes.pdf", async (req, res) => {
  try {
    const sizes = String(req.query.sizes || "120")
      .split(",")
      .map((s) => Math.max(64, Math.min(1024, Number(s) || 120)));
    const force = String(req.query.force || "") === "1";

    const { rows } = await pool.query(
      `SELECT id, name, building, floor, location FROM fd_doors WHERE id=$1`,
      [req.params.id]
    );
    const door = rows[0];
    if (!door) return res.status(404).send("door_not_found");

    const brand = "HALEON";
    const doorLabel =
      (door.name || "").trim() ||
      [door.building, door.floor, door.location].filter(Boolean).join(" • ") ||
      `Porte ${door.id}`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="door-${door.id}-qrcodes.pdf"`
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
        const wName = doc.widthOfString(doorLabel);

        doc.font("Helvetica-Bold").fontSize(sizeBrand);
        const hBrand = doc.heightOfString(brand, { width: boxW, align: "left" });
        doc.font("Helvetica").fontSize(sizeName);
        const hName = doc.heightOfString(doorLabel, { width: boxW, align: "left" });

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

      const qrPath = await ensureDoorQRCode(req, door.id, door.name, qrSize, force);
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
      const hName = doc.heightOfString(doorLabel, { width: textBoxW });

      const totalH = hBrand + gap + hName;
      const startY = margin + Math.max(0, (textBoxH - totalH) / 2);
      const textX = margin;

      doc.font("Helvetica-Bold").fontSize(sizeBrand).fillColor("#000");
      doc.text("HALEON", textX, startY, { width: textBoxW, align: "left" });

      doc.font("Helvetica").fontSize(sizeName).fillColor("#111");
      doc.text(doorLabel, textX, startY + hBrand + gap, {
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
// Calendar  • /api/doors/calendar
// ------------------------------
app.get("/api/doors/calendar", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.id AS door_id, d.name AS door_name,
             c.due_date, c.started_at, c.closed_at
        FROM fd_doors d
        JOIN fd_checks c ON c.door_id=d.id
       WHERE c.closed_at IS NULL
       ORDER BY c.due_date ASC
    `);

    const events = rows.map((r) => {
      const st = computeDoorStatus(r.due_date, !!(r.started_at && !r.closed_at));
      return { date: r.due_date, door_id: r.door_id, door_name: r.door_name, status: st };
    });

    res.json({ ok: true, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Alerts banner  • /api/doors/alerts
// ------------------------------
app.get("/api/doors/alerts", async (_req, res) => {
  try {
    const today = todayISO();

    const { rows: agg } = await pool.query(
      `
      WITH pending AS (
        SELECT door_id, due_date
          FROM fd_checks
         WHERE closed_at IS NULL
      ),
      last_closed AS (
        SELECT DISTINCT ON (door_id) door_id, status
          FROM fd_checks
         WHERE closed_at IS NOT NULL
         ORDER BY door_id, closed_at DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE p.due_date < $1)                      AS overdue,
        COUNT(*) FILTER (WHERE p.due_date >= $1 AND p.due_date <= $2) AS due_30,
        COUNT(*)                                                      AS pending,
        COUNT(*) FILTER (WHERE lc.status = 'nc')                      AS last_nc
      FROM pending p
      LEFT JOIN last_closed lc ON lc.door_id = p.door_id
      `,
      [today, addDaysISO(today, 30)]
    );

    const c = agg[0] || { overdue: 0, due_30: 0, pending: 0, last_nc: 0 };
    let level = "ok";
    if (Number(c.overdue) > 0) level = "danger";
    else if (Number(c.due_30) > 0) level = "warn";

    let message = "Aucune alerte.";
    if (level === "warn") message = `Contrôles à planifier (<30j) : ${c.due_30}.`;
    if (level === "danger") message = `Contrôles en retard : ${c.overdue}.`;

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
   🔹 MAPS — API /api/doors/maps/*
   ======================================================================== */

/** Upload ZIP de plans */
app.post("/api/doors/maps/uploadZip", uploadZip.single("zip"), async (req, res) => {
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

      await pool.query(
        `INSERT INTO fd_plans (logical_name, version, filename, file_path, page_count)
         VALUES ($1,$2,$3,$4,$5)`,
        [logical, version, entry.name, dest, page_count]
      );
      await pool.query(
        `INSERT INTO fd_plan_names (logical_name, display_name)
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

/** Liste des plans (dernier par logical_name) + compte actions (overdue / next 30j) */
app.get("/api/doors/maps/plans", async (_req, res) => {
  try {
    const q = `
      WITH latest AS (
        SELECT DISTINCT ON (logical_name) id, logical_name, version, page_count, created_at
        FROM fd_plans
        ORDER BY logical_name, created_at DESC
      ),
      names AS (
        SELECT logical_name, COALESCE(display_name, logical_name) AS display_name
        FROM fd_plan_names
      ),
      pending AS (
        SELECT c.door_id, c.due_date
          FROM fd_checks c
         WHERE c.closed_at IS NULL
      ),
      pos AS (
        SELECT p.plan_logical_name AS logical_name, p.door_id
          FROM fd_door_positions p
          GROUP BY p.plan_logical_name, p.door_id
      ),
      counts AS (
        SELECT pos.logical_name,
               SUM(CASE WHEN pending.due_date < CURRENT_DATE THEN 1 ELSE 0 END) AS overdue,
               SUM(CASE WHEN pending.due_date >= CURRENT_DATE
                           AND pending.due_date <= CURRENT_DATE + INTERVAL '30 day'
                        THEN 1 ELSE 0 END) AS actions_next_30
          FROM pos
          JOIN pending ON pending.door_id = pos.door_id
         GROUP BY pos.logical_name
      )
      SELECT l.id, l.logical_name, n.display_name, l.version, l.page_count,
             COALESCE(c.actions_next_30,0)::int AS actions_next_30,
             COALESCE(c.overdue,0)::int AS overdue
        FROM latest l
   LEFT JOIN names n USING (logical_name)
   LEFT JOIN counts c ON c.logical_name = l.logical_name
    ORDER BY n.display_name ASC;
    `;
    const { rows } = await pool.query(q);
    res.json({ ok: true, plans: rows, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** NEW: Stream d’un plan PDF par ID (UUID) — colle à l’URL du front */
app.get(
  "/api/doors/maps/plan/:id([0-9a-fA-F\\-]{36})/file",
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT file_path FROM fd_plans WHERE id=$1`,
        [req.params.id]
      );
      const p = rows[0]?.file_path;
      if (!p || !fs.existsSync(p)) return res.status(404).send("not_found");
      res.type("application/pdf").sendFile(path.resolve(p));
    } catch (e) {
      res.status(500).send("err");
    }
  }
);

/** Stream d’un plan PDF — par logical_name (compat) */
app.get("/api/doors/maps/plan/:logical/file", async (req, res) => {
  try {
    const logical = String(req.params.logical || "");
    if (!logical) return res.status(400).send("logical");
    const { rows } = await pool.query(
      `SELECT file_path FROM fd_plans WHERE logical_name=$1 ORDER BY created_at DESC LIMIT 1`,
      [logical]
    );
    const p = rows[0]?.file_path;
    if (!p || !fs.existsSync(p)) return res.status(404).send("not_found");
    res.type("application/pdf").sendFile(path.resolve(p));
  } catch (e) {
    res.status(500).send("err");
  }
});

/** (Compat ancien front) Stream par id via /plan-id/:id/file */
app.get("/api/doors/maps/plan-id/:id/file", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT file_path FROM fd_plans WHERE id=$1`,
      [req.params.id]
    );
    const p = rows[0]?.file_path;
    if (!p || !fs.existsSync(p)) return res.status(404).send("not_found");
    res.type("application/pdf").sendFile(path.resolve(p));
  } catch (e) {
    res.status(500).send("err");
  }
});

/** Renommage du display_name d’un logical_name */
app.put("/api/doors/maps/plan/:logical/rename", async (req, res) => {
  try {
    const logical = String(req.params.logical || "");
    const { display_name } = req.body || {};
    if (!logical || !display_name)
      return res
        .status(400)
        .json({ ok: false, error: "display_name requis" });
    await pool.query(
      `INSERT INTO fd_plan_names(logical_name, display_name)
       VALUES ($1,$2)
       ON CONFLICT (logical_name) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [logical, String(display_name).trim()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Liste des positions pour un plan/page */
app.get("/api/doors/maps/positions", async (req, res) => {
  try {
    const logical = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical)
      return res
        .status(400)
        .json({ ok: false, error: "logical_name requis" });

    const q = `
      WITH pend AS (
        SELECT door_id, due_date
          FROM fd_checks
         WHERE closed_at IS NULL
      )
      SELECT p.door_id, d.name, p.x_frac, p.y_frac,
             CASE
               WHEN pend.due_date < CURRENT_DATE THEN 'en_retard'
               WHEN pend.due_date <= CURRENT_DATE + INTERVAL '30 day' THEN 'en_cours_30'
               ELSE 'a_faire'
             END AS status
        FROM fd_door_positions p
        JOIN fd_doors d ON d.id = p.door_id
   LEFT JOIN pend ON pend.door_id = p.door_id
       WHERE p.plan_logical_name=$1 AND p.page_index=$2
    `;
    const { rows } = await pool.query(q, [logical, pageIndex]);

    // Compat: items + points (x/y au lieu de x_frac/y_frac)
    const points = rows.map((r) => ({
      door_id: r.door_id,
      door_name: r.name,
      x: Number(r.x_frac ?? 0),
      y: Number(r.y_frac ?? 0),
      status: r.status,
    }));

    res.json({ ok: true, items: rows, points });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Enregistre/Met à jour la position d’une porte sur un plan/page */
app.put("/api/doors/maps/positions/:doorId", async (req, res) => {
  try {
    const doorId = req.params.doorId;
    const {
      logical_name,
      page_index = 0,
      page_label = null,
      x_frac,
      y_frac,
      x,
      y,
    } = req.body || {};
    const xf = x_frac != null ? x_frac : x;
    const yf = y_frac != null ? y_frac : y;
    if (!logical_name || xf == null || yf == null) {
      return res
        .status(400)
        .json({ ok: false, error: "coords/logical requis" });
    }

    await pool.query(
      `INSERT INTO fd_door_positions (door_id, plan_logical_name, page_index, page_label, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (door_id, plan_logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac, page_label=EXCLUDED.page_label, updated_at=now()`,
      [doorId, logical_name, Number(page_index || 0), page_label, Number(xf), Number(yf)]
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
app.listen(PORT, HOST, () => {
  console.log(`[fire-doors] listening on ${HOST}:${PORT}`);
  console.log(
    `QR base default: ${process.env.PUBLIC_BASE || "(dynamic from host)"} + ${DEFAULT_APP_PATH}`
  );
});
