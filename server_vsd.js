// ==============================
// server_vsd.js — VSD database microservice (ESM)
// Port par défaut: 3020
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

// 🔹 MAPS / Plans
import crypto from "crypto";
import StreamZip from "node-stream-zip";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// pdf.js (legacy) pour compter les pages PDF, comme Doors 
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

// 🔐 Helmet — CSP calquée sur Doors pour compatibilité pdf.js / Leaflet :contentReference[oaicite:2]{index=2}
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

// CORS élargi (headers identité) – même logique que Doors :contentReference[oaicite:3]{index=3}
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

const PORT = Number(process.env.VSD_PORT || 3020);
const HOST = process.env.VSD_HOST || "0.0.0.0";

// ------------------------------
// Storage layout
// ------------------------------
// ➜ On garde la même arborescence qu’avec Doors, mais isolée dans /uploads/vsd
const DATA_ROOT = path.join(process.cwd(), "uploads", "vsd");
const FILES_DIR = path.join(DATA_ROOT, "files");
await fsp.mkdir(FILES_DIR, { recursive: true });

// 🔹 MAPS — arborescence pour les plans des variateurs
const MAPS_ROOT = path.join(DATA_ROOT, "maps");
const MAPS_INCOMING_DIR = path.join(MAPS_ROOT, "incoming");
const MAPS_STORE_DIR = path.join(MAPS_ROOT, "plans");
await fsp.mkdir(MAPS_INCOMING_DIR, { recursive: true });
await fsp.mkdir(MAPS_STORE_DIR, { recursive: true });

// Multer fichiers standards (pièces jointes / photos)
const uploadAny = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// 🔹 MAPS — Upload ZIP (jusqu’à 300MB) comme pour Doors :contentReference[oaicite:4]{index=4}
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

// ------------------------------
// Schema VSD
// ------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // 💾 Table principale des variateurs de fréquence
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_equipment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Identification
      name TEXT NOT NULL,           -- Nom lisible (VSD AHU-01, etc.)
      tag TEXT,                     -- Tag technique / code interne
      manufacturer TEXT,
      model TEXT,
      reference TEXT,
      serial_number TEXT,
      -- Caractéristiques électriques
      power_kw NUMERIC,
      current_a NUMERIC,
      voltage TEXT,
      ip_address TEXT,
      protocol TEXT,                -- Modbus, Profibus, Ethernet/IP, ...
      -- Localisation
      building TEXT,
      floor TEXT,
      zone TEXT,
      location TEXT,                -- Local électrique / machine
      panel TEXT,                   -- Tableau / coffret
      -- Statut & méta
      status TEXT,                  -- en_service, hors_service, spare...
      criticality TEXT,             -- critique, important, standard...
      comments TEXT,
      -- Photo principale du variateur
      photo_path TEXT,
      photo_file_id UUID,
      -- Métadonnées d'analyse IA (extraites depuis les photos)
      ai_metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsd_equipment_building ON vsd_equipment(building);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsd_equipment_tree ON vsd_equipment(building, floor, zone);`);

  // 📎 Fichiers attachés (fiches techniques, schémas, rapports…)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES vsd_equipment(id) ON DELETE CASCADE,
      kind TEXT,            -- 'photo', 'doc', 'plan', ...
      filename TEXT,
      path TEXT,
      mime TEXT,
      size_bytes BIGINT,
      content BYTEA,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsd_files_equipment ON vsd_files(equipment_id);`);

  // 🕒 Historique des événements sur l’équipement
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES vsd_equipment(id) ON DELETE CASCADE,
      event_at TIMESTAMPTZ DEFAULT now(),
      event_type TEXT,      -- 'creation', 'modification', 'maintenance', 'commentaire', ...
      message TEXT,
      user_email TEXT,
      user_name TEXT,
      details JSONB
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vsd_history_equipment ON vsd_history(equipment_id);`);

  // 🔹 MAPS — tables plans, noms, positions (copie simplifiée de Doors) :contentReference[oaicite:5]{index=5}
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version TEXT NOT NULL,
      filename TEXT,
      file_path TEXT,
      page_count INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE vsd_plans ADD COLUMN IF NOT EXISTS content BYTEA;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS vsd_plans_logical_idx ON vsd_plans(logical_name);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS vsd_plans_created_idx ON vsd_plans(created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT
    );
  `);

  // Positions des VSD sur les plans PDF
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vsd_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES vsd_equipment(id) ON DELETE CASCADE,
      plan_logical_name TEXT NOT NULL,
      page_index INT NOT NULL DEFAULT 0,
      page_label TEXT,
      x_frac NUMERIC,
      y_frac NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Un VSD = 1 position par plan/page (écrasement si on le déplace)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vsd_positions_uniq'
      ) THEN
        ALTER TABLE vsd_positions
        ADD CONSTRAINT vsd_positions_uniq UNIQUE (equipment_id, plan_logical_name, page_index);
      END IF;
    END $$;
  `);
}

// ------------------------------
// Helpers
// ------------------------------
function safeEmail(s) {
  if (!s) return null;
  const x = String(s).trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(x) ? x : null;
}

// Lecture cookie (copie de Doors) :contentReference[oaicite:6]{index=6}
function readCookie(req, name) {
  const raw = req.headers?.cookie || "";
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Identité utilisateur pour historiser les actions
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

  // Pas de lookup DB ici, on reste simple côté VSD
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

// MAPS helpers (copie de Doors) :contentReference[oaicite:7]{index=7}
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
  const doc = await pdfjsLib.getDocument({
    data,
    standardFontDataUrl: PDF_STANDARD_FONTS,
  }).promise;
  const n = doc.numPages || 1;
  await doc.cleanup();
  return n;
}

function fileRowToClient(f) {
  return {
    id: f.id,
    original_name: f.filename,
    mime: f.mime || "application/octet-stream",
    size_bytes: Number(f.size_bytes || 0),
    url: `/api/vsd/files/${f.id}/download`,
    download_url: `/api/vsd/files/${f.id}/download`,
    inline_url: `/api/vsd/files/${f.id}/download`,
  };
}

// Stub IA analyse photo VSD
// 👉 Ici tu pourras plugger plus tard un service d’IA (OpenAI Vision, OCR local, etc.)
// qui renverra un objet partiel { manufacturer, model, power_kw, voltage, ... } à injecter dans la DB.
async function analyzeVsdPhoto(_buffer) {
  // TODO: implémenter l’analyse réelle (OCR/vision) des plaques signalétiques de variateur
  return {};
}

// ------------------------------
// API: Healthcheck
// ------------------------------
app.get("/api/vsd/health", (_req, res) => {
  res.json({ ok: true, service: "vsd", ts: new Date().toISOString() });
});

// ------------------------------
// API: VSD — CRUD équipements
// ------------------------------

// Liste des variateurs avec filtres (pour l’onglet "VSD" + arbo par bâtiment)
app.get("/api/vsd/equipments", async (req, res) => {
  try {
    const { q, building, floor, zone, status } = req.query || {};
    const where = [];
    const values = [];
    let i = 1;

    if (q) {
      where.push(
        `(name ILIKE $${i} OR tag ILIKE $${i} OR manufacturer ILIKE $${i} OR model ILIKE $${i} OR reference ILIKE $${i})`
      );
      values.push(`%${q}%`);
      i++;
    }
    if (building) {
      where.push(`building = $${i++}`);
      values.push(building);
    }
    if (floor) {
      where.push(`floor = $${i++}`);
      values.push(floor);
    }
    if (zone) {
      where.push(`zone = $${i++}`);
      values.push(zone);
    }
    if (status) {
      where.push(`status = $${i++}`);
      values.push(status);
    }

    const sql = `
      SELECT id, name, tag,
             building, floor, zone, location, panel,
             manufacturer, model, status, criticality,
             created_at, updated_at
        FROM vsd_equipment
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY building NULLS LAST, floor NULLS LAST, zone NULLS LAST, name ASC
    `;
    const { rows } = await pool.query(sql, values);
    res.json({ ok: true, items: rows, equipments: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Création d’un variateur
app.post("/api/vsd/equipments", async (req, res) => {
  try {
    const {
      name,
      tag,
      manufacturer,
      model,
      reference,
      serial_number,
      power_kw,
      current_a,
      voltage,
      ip_address,
      protocol,
      building,
      floor,
      zone,
      location,
      panel,
      status,
      criticality,
      comments,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: "name_required" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO vsd_equipment(
        name, tag,
        manufacturer, model, reference, serial_number,
        power_kw, current_a, voltage, ip_address, protocol,
        building, floor, zone, location, panel,
        status, criticality, comments
      ) VALUES(
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17,$18,$19
      )
      RETURNING *
    `,
      [
        name,
        tag,
        manufacturer,
        model,
        reference,
        serial_number,
        power_kw,
        current_a,
        voltage,
        ip_address,
        protocol,
        building,
        floor,
        zone,
        location,
        panel,
        status,
        criticality,
        comments,
      ]
    );

    const eq = rows[0];

    // Historique: création
    const user = await currentUser(req);
    await pool.query(
      `INSERT INTO vsd_history(equipment_id, event_type, message, user_email, user_name, details)
       VALUES($1,'creation',$2,$3,$4,$5)`,
      [
        eq.id,
        `Création du variateur "${eq.name}"`,
        user.email,
        user.name,
        { payload: req.body },
      ]
    );

    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Détail d’un variateur
app.get("/api/vsd/equipments/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
         FROM vsd_equipment
        WHERE id = $1`,
      [req.params.id]
    );
    const eq = rows[0];
    if (!eq) return res.status(404).json({ ok: false, error: "not_found" });

    // Photo URL générée côté serveur pour simplifier le front
    const photo_url = eq.photo_path ? `/api/vsd/equipments/${eq.id}/photo` : null;

    res.json({
      ok: true,
      equipment: {
        ...eq,
        photo_url,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Mise à jour d’un variateur
app.put("/api/vsd/equipments/:id", async (req, res) => {
  try {
    const allowedFields = [
      "name",
      "tag",
      "manufacturer",
      "model",
      "reference",
      "serial_number",
      "power_kw",
      "current_a",
      "voltage",
      "ip_address",
      "protocol",
      "building",
      "floor",
      "zone",
      "location",
      "panel",
      "status",
      "criticality",
      "comments",
      "ai_metadata",
    ];
    const fields = [];
    const values = [];
    let i = 1;

    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        fields.push(`${key}=$${i++}`);
        values.push(req.body[key]);
      }
    }

    if (!fields.length) {
      return res.json({ ok: true }); // rien à faire
    }

    values.push(req.params.id);

    await pool.query(
      `UPDATE vsd_equipment SET ${fields.join(", ")}, updated_at=now() WHERE id=$${i}`,
      values
    );

    const { rows } = await pool.query(`SELECT * FROM vsd_equipment WHERE id=$1`, [
      req.params.id,
    ]);
    const eq = rows[0];

    const user = await currentUser(req);
    await pool.query(
      `INSERT INTO vsd_history(equipment_id, event_type, message, user_email, user_name, details)
       VALUES($1,'modification',$2,$3,$4,$5)`,
      [
        eq.id,
        `Mise à jour du variateur "${eq.name}"`,
        user.email,
        user.name,
        { payload: req.body },
      ]
    );

    res.json({ ok: true, equipment: eq });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Suppression d’un variateur
app.delete("/api/vsd/equipments/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM vsd_equipment WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// API: Photo principale + IA
// ------------------------------

// Upload de la photo du variateur (pour analyse / vignette)
app.post(
  "/api/vsd/equipments/:id/photo",
  uploadAny.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: "photo_required" });
      const buf = await fsp.readFile(req.file.path);

      // Stockage de la photo dans vsd_files (comme fd_files) :contentReference[oaicite:8]{index=8}
      const { rows: ins } = await pool.query(
        `INSERT INTO vsd_files(equipment_id, kind, filename, path, mime, size_bytes, content)
         VALUES($1,'photo',$2,$3,$4,$5,$6)
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

      // MAJ équipement
      await pool.query(
        `UPDATE vsd_equipment
            SET photo_path=$1, photo_file_id=$2, updated_at=now()
          WHERE id=$3`,
        [req.file.path, fileId, req.params.id]
      );

      // 🔍 Tentative d'analyse automatique (stub pour l’instant)
      let aiPatch = {};
      try {
        aiPatch = (await analyzeVsdPhoto(buf)) || {};
      } catch (e) {
        console.warn("analyzeVsdPhoto error:", e);
      }

      if (aiPatch && Object.keys(aiPatch).length) {
        // Fusion des métadonnées IA dans la colonne JSONB
        await pool.query(
          `UPDATE vsd_equipment
              SET ai_metadata = COALESCE(ai_metadata, '{}'::jsonb) || $1::jsonb,
                  updated_at = now()
            WHERE id=$2`,
          [aiPatch, req.params.id]
        );
      }

      const user = await currentUser(req);
      await pool.query(
        `INSERT INTO vsd_history(equipment_id, event_type, message, user_email, user_name, details)
         VALUES($1,'photo',$2,$3,$4,$5)`,
        [
          req.params.id,
          "Photo de variateur mise à jour",
          user.email,
          user.name,
          { file_id: fileId, filename: req.file.originalname },
        ]
      );

      res.json({ ok: true, analyzed: !!(aiPatch && Object.keys(aiPatch).length), aiPatch });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// Lecture de la photo principale
app.get("/api/vsd/equipments/:id/photo", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT photo_path, photo_file_id FROM vsd_equipment WHERE id=$1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).send("no_equipment");

    // 1) DB (BLOB) en priorité
    if (row.photo_file_id) {
      const { rows: frows } = await pool.query(
        `SELECT mime, content FROM vsd_files WHERE id=$1`,
        [row.photo_file_id]
      );
      const f = frows[0];
      if (f?.content) {
        res.setHeader("Content-Type", f.mime || "image/*");
        return res.end(f.content, "binary");
      }
    }

    // 2) Fichier disque
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
// API: Pièces jointes
// ------------------------------
app.post(
  "/api/vsd/equipments/:id/files",
  uploadAny.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: "file_required" });
      const buf = await fsp.readFile(req.file.path);
      await pool.query(
        `INSERT INTO vsd_files(equipment_id, kind, filename, path, mime, size_bytes, content)
         VALUES($1,'doc',$2,$3,$4,$5,$6)`,
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

app.get("/api/vsd/equipments/:id/files", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime, size_bytes
         FROM vsd_files
        WHERE equipment_id=$1
        ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    const files = rows.map(fileRowToClient);
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/vsd/files/:fileId/download", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT path, filename, mime, content FROM vsd_files WHERE id=$1`,
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

app.delete("/api/vsd/files/:fileId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM vsd_files WHERE id=$1 RETURNING path`,
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
// API: Historique
// ------------------------------
app.get("/api/vsd/equipments/:id/history", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, event_at, event_type, message, user_email, user_name, details
         FROM vsd_history
        WHERE equipment_id=$1
        ORDER BY event_at DESC`,
      [req.params.id]
    );
    res.json({ ok: true, history: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Ajout manuel d’un événement d’historique (commentaire, maintenance, etc.)
app.post("/api/vsd/equipments/:id/history", async (req, res) => {
  try {
    const { event_type, message, details } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });

    const user = await currentUser(req);
    await pool.query(
      `INSERT INTO vsd_history(equipment_id, event_type, message, user_email, user_name, details)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [req.params.id, event_type || "commentaire", message, user.email, user.name, details || {}]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// API MAPS VSD — /api/vsd/maps/*
// ------------------------------

// Upload ZIP de plans (PDF)
app.post("/api/vsd/maps/uploadZip", uploadZip.single("zip"), async (req, res) => {
  const zipPath = req.file?.path;
  if (!zipPath) return res.status(400).json({ ok: false, error: "zip_manquant" });

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
      const dest = path.join(
        MAPS_STORE_DIR,
        `${logical}__${version}_${crypto.randomUUID()}.pdf`
      );
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
          `INSERT INTO vsd_plans (logical_name, version, filename, file_path, page_count, content)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [logical, version, entry.name, dest, page_count, buf]
        );
      } else {
        await pool.query(
          `INSERT INTO vsd_plans (logical_name, version, filename, file_path, page_count)
           VALUES ($1,$2,$3,$4,$5)`,
          [logical, version, entry.name, dest, page_count]
        );
      }

      await pool.query(
        `INSERT INTO vsd_plan_names (logical_name, display_name)
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

// Liste des plans (dernier par logical_name) + nb de VSD positionnés
app.get("/api/vsd/maps/plans", async (_req, res) => {
  try {
    const q = `
      WITH latest AS (
        SELECT DISTINCT ON (logical_name) id, logical_name, version, page_count, created_at
          FROM vsd_plans
         ORDER BY logical_name, created_at DESC
      ),
      names AS (
        SELECT logical_name, COALESCE(display_name, logical_name) AS display_name
          FROM vsd_plan_names
      ),
      counts AS (
        SELECT plan_logical_name AS logical_name,
               COUNT(DISTINCT equipment_id)::int AS equipments
          FROM vsd_positions
         GROUP BY plan_logical_name
      )
      SELECT l.id, l.logical_name, n.display_name, l.version, l.page_count,
             COALESCE(c.equipments,0) AS equipments
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

// Stream du PDF par logical_name
app.get("/api/vsd/maps/plan/:logical/file", async (req, res) => {
  try {
    const logical = String(req.params.logical || "");
    if (!logical) return res.status(400).send("logical_name_required");
    const { rows } = await pool.query(
      `SELECT file_path, content
         FROM vsd_plans
        WHERE logical_name=$1
        ORDER BY created_at DESC
        LIMIT 1`,
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

// Stream du PDF par id (compat)
app.get("/api/vsd/maps/plan-id/:id/file", async (req, res) => {
  try {
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
});

// Renommage du display_name d’un logical_name
app.put("/api/vsd/maps/plan/:logical/rename", async (req, res) => {
  try {
    const logical = String(req.params.logical || "");
    const { display_name } = req.body || {};
    if (!logical || !display_name) {
      return res.status(400).json({ ok: false, error: "display_name_required" });
    }
    await pool.query(
      `INSERT INTO vsd_plan_names(logical_name, display_name)
       VALUES ($1,$2)
       ON CONFLICT (logical_name) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [logical, String(display_name).trim()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Liste des positions pour un plan/page (renvoie les VSD + localisation)
app.get("/api/vsd/maps/positions", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    const logicalParam = String(req.query.logical_name || "");
    const pageIndex = Number(req.query.page_index || 0);

    let logical = logicalParam;
    if (!logical && /^[0-9a-fA-F-]{36}$/.test(id)) {
      const { rows } = await pool.query(
        `SELECT logical_name FROM vsd_plans WHERE id=$1 LIMIT 1`,
        [id]
      );
      logical = rows?.[0]?.logical_name || "";
    }
    if (!logical) {
      return res
        .status(400)
        .json({ ok: false, error: "logical_name ou id requis" });
    }

    const { rows } = await pool.query(
      `
      SELECT p.equipment_id,
             e.name,
             e.building,
             e.floor,
             e.zone,
             e.location,
             p.x_frac,
             p.y_frac
        FROM vsd_positions p
        JOIN vsd_equipment e ON e.id = p.equipment_id
       WHERE p.plan_logical_name=$1
         AND p.page_index=$2
       ORDER BY e.building NULLS LAST, e.floor NULLS LAST, e.name ASC
      `,
      [logical, pageIndex]
    );

    const positions = rows.map((r) => ({
      equipment_id: r.equipment_id,
      name: r.name,
      building: r.building,
      floor: r.floor,
      zone: r.zone,
      location: r.location,
      x_frac: Number(r.x_frac),
      y_frac: Number(r.y_frac),
    }));

    res.json({ ok: true, positions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Enregistre / met à jour la position d’un VSD sur un plan/page
app.put("/api/vsd/maps/positions/:equipmentId", async (req, res) => {
  try {
    const equipmentId = req.params.equipmentId;
    let {
      logical_name,
      plan_id, // UUID → résolu en logical_name si fourni
      page_index = 0,
      page_label = null,
      x_frac,
      y_frac,
      x,
      y,
    } = req.body || {};

    if ((!logical_name || String(logical_name).trim() === "") && plan_id &&
        /^[0-9a-fA-F-]{36}$/.test(String(plan_id))) {
      const { rows } = await pool.query(
        `SELECT logical_name FROM vsd_plans WHERE id=$1 LIMIT 1`,
        [plan_id]
      );
      logical_name = rows?.[0]?.logical_name || null;
    }

    const xf = x_frac != null ? x_frac : x;
    const yf = y_frac != null ? y_frac : y;

    if (!logical_name || xf == null || yf == null) {
      return res
        .status(400)
        .json({ ok: false, error: "coords/logical_required" });
    }

    await pool.query(
      `INSERT INTO vsd_positions(equipment_id, plan_logical_name, page_index, page_label, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (equipment_id, plan_logical_name, page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac, page_label=EXCLUDED.page_label, updated_at=now()`,
      [
        equipmentId,
        String(logical_name),
        Number(page_index || 0),
        page_label,
        Number(xf),
        Number(yf),
      ]
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
  console.log(`[vsd] listening on ${HOST}:${PORT}`);
});
