// ==============================
// server_ddors.js — Fire Doors CMMS microservice (ESM)
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
import crypto from "crypto";
import { fileURLToPath } from "url";
import pg from "pg";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------
// App & Config
// ------------------------------
const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

const PORT = Number(process.env.FIRE_DOORS_PORT || 3016);
const HOST = process.env.FIRE_DOORS_HOST || "127.0.0.1";

// Storage layout
const DATA_ROOT = path.join(process.cwd(), "uploads", "fire-doors");
const PHOTOS_DIR = path.join(DATA_ROOT, "photos");
const FILES_DIR = path.join(DATA_ROOT, "files");
const QRCODES_DIR = path.join(DATA_ROOT, "qrcodes");
await fsp.mkdir(PHOTOS_DIR, { recursive: true });
await fsp.mkdir(FILES_DIR, { recursive: true });
await fsp.mkdir(QRCODES_DIR, { recursive: true });

// Multer
const uploadPhoto = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const uploadFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_doors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      location TEXT,
      status TEXT DEFAULT 'OK',               -- OK / NC / N/A / RETIRED
      photo_path TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      retired_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_checklist_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{id,label,order}]
      months_interval INT NOT NULL DEFAULT 12,   -- 12=1x/an ; 6=2x/an ; 1=mensuel ; 3=trimestriel ; 24=biennal
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_inspections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      door_id UUID REFERENCES fd_doors(id) ON DELETE CASCADE,
      template_id UUID REFERENCES fd_checklist_templates(id),
      due_date DATE NOT NULL,
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      result_counts JSONB DEFAULT '{}'::jsonb,   -- {conforme, nc, na}
      status TEXT DEFAULT 'pending',            -- pending / ok / nc / overdue
      pdf_nc_path TEXT,
      audit JSONB DEFAULT '{}'::jsonb,          -- arbitrary meta
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_inspection_items (
      id BIGSERIAL PRIMARY KEY,
      inspection_id UUID REFERENCES fd_inspections(id) ON DELETE CASCADE,
      item_id TEXT,
      label TEXT,
      status TEXT,                 -- conforme | non_conforme | na
      comment TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      door_id UUID REFERENCES fd_doors(id) ON DELETE CASCADE,
      inspection_id UUID REFERENCES fd_inspections(id) ON DELETE SET NULL,
      kind TEXT,                   -- photo | file
      filename TEXT,
      path TEXT,
      mime TEXT,
      bytes BIGINT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_audit (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT,
      action TEXT,
      door_id UUID,
      inspection_id UUID,
      meta JSONB,
      ts TIMESTAMPTZ DEFAULT now()
    );
  `);
}

// ------------------------------
// Helpers
// ------------------------------
function safeEmail(x) {
  if (!x) return null;
  const s = String(x).trim();
  return /\S+@\S+\.\S+/.test(s) ? s.toLowerCase() : null;
}
function readCookie(req, name) {
  const raw = req.headers?.cookie || "";
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function actor(req) {
  return (
    safeEmail(req.headers["x-user-email"] || req.headers["x-auth-email"]) ||
    safeEmail(readCookie(req, "email")) ||
    null
  );
}
function monthsFromNow(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
}
function asDateISO(d) {
  return new Date(d).toISOString().slice(0, 10);
}
async function logAudit(req, action, meta = {}) {
  try {
    await pool.query(
      `INSERT INTO fd_audit(user_email, action, door_id, inspection_id, meta)
       VALUES($1,$2,$3,$4,$5)`,
      [actor(req), action, meta.door_id || null, meta.inspection_id || null, meta || {}]
    );
  } catch {}
}
function tally(items) {
  const r = { conforme: 0, nc: 0, na: 0 };
  for (const it of items || []) {
    if (it.status === "conforme") r.conforme++;
    else if (it.status === "non_conforme") r.nc++;
    else r.na++;
  }
  return r;
}

// ------------------------------
// QR Code generation (PNG) + batch PDF for sizes
// ------------------------------
async function ensureDoorQRCode(door) {
  const file = path.join(QRCODES_DIR, `${door.id}.png`);
  if (!fs.existsSync(file)) {
    const url = `${process.env.PUBLIC_BASE || "https://example.local"}/doors/${door.id}`;
    await QRCode.toFile(file, url, { width: 512, margin: 1 });
  }
  return file;
}
async function pdfQRCodes(res, door, sizes = [80, 120, 200]) {
  const pngPath = await ensureDoorQRCode(door);
  const doc = new PDFDocument({ size: "A4", margin: 24 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="qrcodes_${door.name}.pdf"`
  );
  doc.pipe(res);
  doc.fontSize(16).text(`QR Codes — ${door.name}`, { align: "left" });
  let y = 60;
  for (const s of sizes) {
    if (y + s + 40 > doc.page.height) {
      doc.addPage();
      y = 40;
    }
    doc.fontSize(12).text(`${s}×${s}px`, 24, y - 16);
    doc.image(pngPath, 24, y, { width: s, height: s });
    y += s + 32;
  }
  doc.end();
}

// ------------------------------
// Routes: Health
// ------------------------------
app.get("/api/doors/health", async (_req, res) => {
  try {
    const { rows: d } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM fd_doors`
    );
    res.json({ ok: true, doors: d[0]?.n ?? 0, port: PORT });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Doors CRUD
// ------------------------------
app.get("/api/doors", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, location, status, photo_path,
           (SELECT due_date FROM fd_inspections i WHERE i.door_id=fd_doors.id AND i.completed_at IS NULL ORDER BY due_date ASC LIMIT 1) AS next_due
    FROM fd_doors ORDER BY name ASC`);
  res.json({ ok: true, items: rows });
});

app.post("/api/doors", async (req, res) => {
  try {
    const { name, location } = req.body || {};
    if (!name) return res.status(400).json({ error: "name requis" });
    const { rows } = await pool.query(
      `INSERT INTO fd_doors(name, location) VALUES($1,$2) RETURNING *`,
      [name, location || null]
    );
    const door = rows[0];

    // Create first inspection due based on latest active template (default 12 months)
    const { rows: tpl } = await pool.query(
      `SELECT id, months_interval FROM fd_checklist_templates WHERE active=true ORDER BY updated_at DESC LIMIT 1`
    );
    const months = tpl[0]?.months_interval ?? 12;
    await pool.query(
      `INSERT INTO fd_inspections(door_id, template_id, due_date, status) VALUES($1,$2,$3,'pending')`,
      [door.id, tpl[0]?.id || null, asDateISO(monthsFromNow(months))]
    );

    await logAudit(req, "door_created", { door_id: door.id, name });
    res.json({ ok: true, door });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/doors/:id/photo", uploadPhoto.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "photo requise" });
    const { rows } = await pool.query(
      `UPDATE fd_doors SET photo_path=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [req.file.path, req.params.id]
    );
    await pool.query(
      `INSERT INTO fd_attachments(door_id, kind, filename, path, mime, bytes, uploaded_by)
       VALUES($1,'photo',$2,$3,$4,$5,$6)`,
      [
        req.params.id,
        req.file.originalname,
        req.file.path,
        req.file.mimetype,
        req.file.size,
        actor(req),
      ]
    );
    await logAudit(req, "door_photo_uploaded", { door_id: req.params.id });
    res.json({ ok: true, door: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/doors/:id/upload", uploadFile.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "fichier requis" });
    await pool.query(
      `INSERT INTO fd_attachments(door_id, kind, filename, path, mime, bytes, uploaded_by)
       VALUES($1,'file',$2,$3,$4,$5,$6)`,
      [
        req.params.id,
        req.file.originalname,
        req.file.path,
        req.file.mimetype,
        req.file.size,
        actor(req),
      ]
    );
    await logAudit(req, "door_file_uploaded", { door_id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Hard delete with robust confirmation
app.delete("/api/doors/:id", async (req, res) => {
  try {
    const { confirm } = req.query; // expect: DELETE <door name>
    const { rows } = await pool.query(
      `SELECT name FROM fd_doors WHERE id=$1`,
      [req.params.id]
    );
    const name = rows[0]?.name || "";
    if (confirm !== `DELETE ${name}`)
      return res
        .status(400)
        .json({ error: `confirmation invalide, tapez: DELETE ${name}` });
    await pool.query(`DELETE FROM fd_doors WHERE id=$1`, [req.params.id]);
    await logAudit(req, "door_deleted", { door_id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Templates (Checklist)
// ------------------------------
app.get("/api/doors/templates", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM fd_checklist_templates WHERE active=true ORDER BY updated_at DESC`
  );
  res.json({ ok: true, items: rows });
});

app.post("/api/doors/templates", async (req, res) => {
  try {
    const { name, items = [], months_interval = 12, active = true } =
      req.body || {};
    if (!name) return res.status(400).json({ error: "name requis" });
    const ordered = items.map((it, idx) => ({
      id: it.id || String(idx + 1),
      label: it.label || `Item ${idx + 1}`,
      order: idx + 1,
    }));
    const { rows } = await pool.query(
      `INSERT INTO fd_checklist_templates(name, items, months_interval, active)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [name, JSON.stringify(ordered), months_interval, !!active]
    );
    await logAudit(req, "template_created", { template_id: rows[0].id });
    res.json({ ok: true, template: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch("/api/doors/templates/:id", async (req, res) => {
  try {
    const { name, items, months_interval, active } = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;
    if (name !== undefined) {
      fields.push(`name=$${i++}`);
      values.push(name);
    }
    if (items !== undefined) {
      fields.push(`items=$${i++}`);
      values.push(JSON.stringify(items));
    }
    if (months_interval !== undefined) {
      fields.push(`months_interval=$${i++}`);
      values.push(Number(months_interval));
    }
    if (active !== undefined) {
      fields.push(`active=$${i++}`);
      values.push(!!active);
    }
    values.push(req.params.id);
    await pool.query(
      `UPDATE fd_checklist_templates SET ${fields.join(
        ", "
      )}, updated_at=now() WHERE id=$${i}`,
      [...values]
    );
    await logAudit(req, "template_updated", { template_id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Inspections lifecycle
// ------------------------------
app.get("/api/doors/:id/next", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM fd_inspections WHERE door_id=$1 AND completed_at IS NULL ORDER BY due_date ASC LIMIT 1`,
    [req.params.id]
  );
  res.json({ ok: true, inspection: rows[0] || null });
});

app.post("/api/doors/:id/start", async (req, res) => {
  // Ensure pending inspection exists
  const { rows: next } = await pool.query(
    `SELECT * FROM fd_inspections WHERE door_id=$1 AND completed_at IS NULL ORDER BY due_date ASC LIMIT 1`,
    [req.params.id]
  );
  let insp = next[0] || null;
  if (!insp) {
    const { rows: tpl } = await pool.query(
      `SELECT id, months_interval, items FROM fd_checklist_templates WHERE active=true ORDER BY updated_at DESC LIMIT 1`
    );
    const due = asDateISO(tpl[0]?.months_interval ? monthsFromNow(tpl[0].months_interval) : monthsFromNow(12));
    const r = await pool.query(
      `INSERT INTO fd_inspections(door_id, template_id, due_date, status) VALUES($1,$2,$3,'pending') RETURNING *`,
      [req.params.id, tpl[0]?.id || null, due]
    );
    insp = r.rows[0];
  }
  // Return template items to fill
  const { rows: tpl2 } = await pool.query(
    `SELECT items FROM fd_checklist_templates WHERE id=$1`,
    [insp.template_id]
  );
  res.json({ ok: true, inspection: insp, items: tpl2[0]?.items || [] });
});

app.post("/api/doors/:id/complete", async (req, res) => {
  try {
    const { inspection_id, results = [] } = req.body || {}; // results = [{item_id,label,status,comment}]
    if (!inspection_id)
      return res.status(400).json({ error: "inspection_id requis" });
    const counts = tally(results);

    // Save items
    if (results.length) {
      const params = [];
      const values = [];
      for (const r of results) {
        params.push(
          `($${values.length + 1},$${values.length + 2},$${values.length + 3},$${values.length + 4},$${values.length + 5})`
        );
        values.push(
          inspection_id,
          r.item_id || null,
          r.label || null,
          r.status || null,
          r.comment || null
        );
      }
      await pool.query(
        `INSERT INTO fd_inspection_items(inspection_id,item_id,label,status,comment) VALUES ${params.join(
          ","
        )}`,
        values
      );
    }

    // If NC → build PDF for SAP
    let pdfPath = null;
    if (counts.nc > 0) {
      const { rows: doorRows } = await pool.query(
        `SELECT d.name, d.location
         FROM fd_doors d JOIN fd_inspections i ON i.door_id=d.id
         WHERE i.id=$1`,
        [inspection_id]
      );
      const door = doorRows[0] || { name: "Door", location: "" };
      const out = path.join(
        DATA_ROOT,
        `NC_${door.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`
      );
      await createNcPdf(
        out,
        door,
        results.filter((r) => r.status === "non_conforme"),
        actor({ headers: {} })
      );
      pdfPath = out;
    }

    // Mark inspection complete
    const comp = await pool.query(
      `UPDATE fd_inspections
         SET completed_at=now(),
             completed_by=$1,
             result_counts=$2,
             status=$3,
             pdf_nc_path=$4,
             updated_at=now()
       WHERE id=$5 RETURNING *`,
      [actor(req), counts, counts.nc > 0 ? "nc" : "ok", pdfPath, inspection_id]
    );

    // Update door status
    await pool.query(
      `UPDATE fd_doors SET status=$1, updated_at=now()
       WHERE id=(SELECT door_id FROM fd_inspections WHERE id=$2)`,
      [counts.nc > 0 ? "NC" : "OK", inspection_id]
    );

    // Auto-schedule next inspection
    const { rows: nextInfo } = await pool.query(
      `SELECT door_id, template_id FROM fd_inspections WHERE id=$1`,
      [inspection_id]
    );
    const meta = nextInfo[0];
    const { rows: tpl } = await pool.query(
      `SELECT months_interval FROM fd_checklist_templates WHERE id=$1`,
      [meta.template_id]
    );
    const due = asDateISO(monthsFromNow(tpl[0]?.months_interval ?? 12));
    await pool.query(
      `INSERT INTO fd_inspections(door_id, template_id, due_date, status)
       VALUES($1,$2,$3,'pending')`,
      [meta.door_id, meta.template_id, due]
    );

    await logAudit(req, "inspection_completed", {
      inspection_id,
      door_id: meta.door_id,
      counts,
    });
    res.json({ ok: true, inspection: comp.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Build NC PDF
async function createNcPdf(outPath, door, ncItems, user) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const ws = fs.createWriteStream(outPath);
    ws.on("finish", resolve);
    ws.on("error", reject);
    doc.pipe(ws);
    doc.fontSize(18).text("Rapport de non-conformités — Porte coupe-feu", {
      align: "left",
    });
    doc.moveDown(0.5).fontSize(12).text(`Porte: ${door.name}`);
    doc.text(`Localisation: ${door.location || "-"}`);
    doc.text(`Date: ${new Date().toLocaleString()}`);
    doc.text(`Inspecteur: ${user || "-"}`);
    doc.moveDown();
    ncItems.forEach((it, idx) => {
      doc.fontSize(14).text(`${idx + 1}. ${it.label}`);
      if (it.comment)
        doc.fontSize(11).fillColor("#333").text(`Commentaire: ${it.comment}`).fillColor("black");
      doc.moveDown(0.5);
    });
    doc.end();
  });
}

// Download NC PDF for an inspection
app.get("/api/doors/inspections/:id/nc.pdf", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pdf_nc_path FROM fd_inspections WHERE id=$1`,
    [req.params.id]
  );
  const p = rows[0]?.pdf_nc_path;
  if (!p || !fs.existsSync(p)) return res.status(404).send("NC PDF indisponible");
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(path.resolve(p));
});

// QR code (single PNG) or multi-size PDF
app.get("/api/doors/:id/qrcode.png", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name FROM fd_doors WHERE id=$1`,
    [req.params.id]
  );
  const door = rows[0];
  if (!door) return res.status(404).send("door");
  const file = await ensureDoorQRCode(door);
  res.setHeader("Content-Type", "image/png");
  res.sendFile(path.resolve(file));
});
app.get("/api/doors/:id/qrcodes.pdf", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name FROM fd_doors WHERE id=$1`,
    [req.params.id]
  );
  const door = rows[0];
  if (!door) return res.status(404).send("door");
  const sizes = String(req.query.sizes || "80,120,200")
    .split(",")
    .map((s) => Math.max(48, Math.min(512, Number(s) || 0)));
  await pdfQRCodes(res, door, sizes);
});

// ------------------------------
// Follow-up stub (SAP integration placeholder)
// ------------------------------
app.post("/api/doors/:id/followup", async (req, res) => {
  // You can bridge to SAP here; for now, log audit + return a token
  const token = crypto.randomUUID();
  await logAudit(req, "sap_followup_created", {
    door_id: req.params.id,
    token,
    note: req.body?.note || null,
  });
  res.json({ ok: true, followup_id: token });
});

// ------------------------------
// Calendar & Alerts
// ------------------------------
app.get("/api/doors/calendar", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT i.id, i.due_date, d.id as door_id, d.name
     FROM fd_inspections i JOIN fd_doors d ON d.id=i.door_id
     WHERE i.completed_at IS NULL
     ORDER BY i.due_date ASC`
  );
  const events = rows.map((r) => ({
    id: r.id,
    title: `Contrôle — ${r.name}`,
    date: r.due_date,
    door_id: r.door_id,
  }));
  res.json({ ok: true, events });
});

app.get("/api/doors/alerts", async (_req, res) => {
  const today = new Date();
  const { rows } = await pool.query(
    `SELECT i.id, i.due_date, d.id as door_id, d.name
     FROM fd_inspections i JOIN fd_doors d ON d.id=i.door_id
     WHERE i.completed_at IS NULL`
  );
  const alerts = rows
    .map((r) => {
      const due = new Date(r.due_date);
      const days = Math.ceil((due - today) / 86400000);
      let level = null;
      if (days < 0) level = "overdue";
      else if (days === 0) level = "today";
      else if (days <= 7) level = "7d";
      else if (days <= 30) level = "30d";
      return { inspection_id: r.id, door_id: r.door_id, name: r.name, due: r.due_date, days, level };
    })
    .filter((a) => a.level);
  res.json({ ok: true, alerts });
});

// ------------------------------
// Boot
// ------------------------------
await ensureSchema();
app.listen(PORT, HOST, () => {
  console.log(`[fire-doors] listening on ${HOST}:${PORT}`);
});
