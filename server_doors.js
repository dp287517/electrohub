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
app.use(express.json({ limit: "16mb" }));

const PORT = Number(process.env.FIRE_DOORS_PORT || 3016);
const HOST = process.env.FIRE_DOORS_HOST || "127.0.0.1";

// Storage layout
const DATA_ROOT = path.join(process.cwd(), "uploads", "fire-doors");
const FILES_DIR = path.join(DATA_ROOT, "files");
const QRCODES_DIR = path.join(DATA_ROOT, "qrcodes");
await fsp.mkdir(FILES_DIR, { recursive: true });
await fsp.mkdir(QRCODES_DIR, { recursive: true });

// Multer (fichiers & photos partagent le même répertoire)
const uploadAny = multer({
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
    CREATE TABLE IF NOT EXISTS fd_settings (
      id INT PRIMARY KEY DEFAULT 1,
      checklist_template JSONB NOT NULL DEFAULT '[]'::jsonb,
      frequency TEXT NOT NULL DEFAULT '1_an', -- 1_an, 1_mois, 2_an, 3_mois, 2_ans
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_doors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      building TEXT,
      floor TEXT,
      location TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      door_id UUID REFERENCES fd_doors(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      due_date DATE NOT NULL,
      -- items pour le contrôle en cours ou snapshot pour l'historique
      items JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{index,label,value("conforme"|"non_conforme"|"na")}]
      status TEXT,                                    -- "ok" | "nc"
      result_counts JSONB DEFAULT '{}'::jsonb,        -- {conforme, nc, na}
      pdf_nc_path TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      door_id UUID REFERENCES fd_doors(id) ON DELETE CASCADE,
      filename TEXT,
      path TEXT,
      mime TEXT,
      size_bytes BIGINT,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Indexes utiles
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fd_checks_door_due ON fd_checks(door_id, due_date) WHERE closed_at IS NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fd_files_door ON fd_files(door_id);`);
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
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function computeDoorStatus(due_date, hasStarted) {
  // hasStarted === true ⇒ considéré "en cours", mais on garde les couleurs des 30j via due_date
  if (!due_date) return STATUS.A_FAIRE;
  const today = new Date(todayISO());
  const due = new Date(due_date);
  const days = Math.ceil((due - today) / 86400000);
  if (days < 0) return STATUS.EN_RETARD;
  if (days <= 30) return STATUS.EN_COURS;
  return STATUS.A_FAIRE;
}

async function getSettings() {
  const { rows } = await pool.query(`SELECT checklist_template, frequency FROM fd_settings WHERE id=1`);
  if (!rows[0]) {
    return { checklist_template: [], frequency: "1_an" };
  }
  return rows[0];
}

async function ensureNextPendingCheck(door_id) {
  // S'il n'existe aucun check "pending" (closed_at NULL), en créer un avec la bonne due_date
  const { rows: pend } = await pool.query(
    `SELECT id FROM fd_checks WHERE door_id=$1 AND closed_at IS NULL ORDER BY due_date ASC LIMIT 1`,
    [door_id]
  );
  if (pend[0]) return pend[0];

  const s = await getSettings();
  const months = FREQ_TO_MONTHS[s.frequency] || 12;
  const due = addMonthsISO(todayISO(), months);
  const r = await pool.query(
    `INSERT INTO fd_checks(door_id, due_date) VALUES($1,$2) RETURNING id`,
    [door_id, due]
  );
  return r.rows[0];
}

async function ensureDoorQRCode(doorId, name, size = 512) {
  const file = path.join(QRCODES_DIR, `${doorId}_${size}.png`);
  if (!fs.existsSync(file)) {
    // Lien “publique” à scanner : vers la fiche SPA (frontend) — adapte PUBLIC_BASE si besoin
    const base = process.env.PUBLIC_BASE || "";
    const url = `${base}/#/app/doors?door=${doorId}`;
    await QRCode.toFile(file, url, { width: size, margin: 1 });
  }
  return file;
}

async function createNcPdf(outPath, door, check) {
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
    doc.moveDown();

    const nc = (check.items || []).filter((it) => it.value === "non_conforme");
    if (!nc.length) {
      doc.fontSize(12).text("Aucune non-conformité.");
    } else {
      nc.forEach((it, i) => {
        doc.fontSize(14).text(`${i + 1}. ${it.label}`);
        if (it.comment) doc.moveDown(0.25).fontSize(11).fillColor("#333").text(`Commentaire : ${it.comment}`).fillColor("black");
        doc.moveDown(0.5);
      });
    }
    doc.end();
  });
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
// Settings (GET/PUT)  • /api/doors/settings
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
    const tpl = Array.isArray(checklist_template) ? checklist_template.map((x) => String(x || "").trim()).filter(Boolean) : undefined;
    const freq = frequency && FREQ_TO_MONTHS[frequency] ? frequency : undefined;

    if (tpl === undefined && freq === undefined) return res.status(400).json({ ok: false, error: "no_change" });

    const fields = [];
    const values = [];
    let i = 1;
    if (tpl !== undefined) { fields.push(`checklist_template=$${i++}`); values.push(JSON.stringify(tpl)); }
    if (freq !== undefined) { fields.push(`frequency=$${i++}`); values.push(freq); }
    await pool.query(`UPDATE fd_settings SET ${fields.join(", ")}, updated_at=now() WHERE id=1`);
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
    const { q = "", status = "", building = "", floor = "" } = req.query || {};

    // On renvoie next_check_date + status calculé (a_faire / en_cours_30 / en_retard)
    const { rows } = await pool.query(`
      SELECT d.id, d.name, d.building, d.floor, d.location,
             (SELECT started_at IS NOT NULL AND closed_at IS NULL FROM fd_checks c WHERE c.door_id=d.id ORDER BY due_date ASC LIMIT 1) AS has_started,
             (SELECT due_date FROM fd_checks c WHERE c.door_id=d.id AND c.closed_at IS NULL ORDER BY due_date ASC LIMIT 1) AS next_due
      FROM fd_doors d
      WHERE ($1 = '' OR d.name ILIKE '%'||$1||'%' OR d.location ILIKE '%'||$1||'%' OR d.building ILIKE '%'||$1||'%' OR d.floor ILIKE '%'||$1||'%')
        AND ($2 = '' OR d.building ILIKE '%'||$2||'%')
        AND ($3 = '' OR d.floor ILIKE '%'||$3||'%')
      ORDER BY d.name ASC
    `, [q, building, floor]);

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

    // Planifie un premier contrôle "pending"
    await ensureNextPendingCheck(door.id);

    res.json({ ok: true, door });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/doors/doors/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM fd_doors WHERE id=$1`, [req.params.id]);
    const door = rows[0];
    if (!door) return res.status(404).json({ ok: false, error: "not_found" });

    const { rows: cur } = await pool.query(
      `SELECT id, started_at, closed_at, due_date, items FROM fd_checks WHERE door_id=$1 AND closed_at IS NULL ORDER BY due_date ASC LIMIT 1`,
      [door.id]
    );
    const check = cur[0] || null;
    const hasStarted = !!(check && check.started_at && !check.closed_at);
    const status = computeDoorStatus(check?.due_date || null, hasStarted);

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
        current_check: check ? { id: check.id, items: check.items, itemsView: (await getSettings()).checklist_template } : null,
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
    if (name !== undefined) { fields.push(`name=$${i++}`); values.push(name); }
    if (building !== undefined) { fields.push(`building=$${i++}`); values.push(building); }
    if (floor !== undefined) { fields.push(`floor=$${i++}`); values.push(floor); }
    if (location !== undefined) { fields.push(`location=$${i++}`); values.push(location); }
    values.push(req.params.id);
    await pool.query(`UPDATE fd_doors SET ${fields.join(", ")}, updated_at=now() WHERE id=$${i}`, values);
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
// Checks workflow  • /api/doors/doors/:id/checks
// ------------------------------
app.post("/api/doors/doors/:id/checks", async (req, res) => {
  try {
    const door_id = req.params.id;

    // S'assure qu'un "pending" existe
    const pend = await ensureNextPendingCheck(door_id);

    // Démarre si pas encore démarré
    await pool.query(
      `UPDATE fd_checks SET started_at = COALESCE(started_at, now()), updated_at=now() WHERE id=$1`,
      [pend.id]
    );

    // Injecte le template courant si items vides
    const { rows: checkR } = await pool.query(`SELECT * FROM fd_checks WHERE id=$1`, [pend.id]);
    let check = checkR[0];
    if ((check.items || []).length === 0) {
      const s = await getSettings();
      const items = (s.checklist_template || []).slice(0, 5).map((label, i) => ({ index: i, label, value: null }));
      const { rows: upd } = await pool.query(
        `UPDATE fd_checks SET items=$1, updated_at=now() WHERE id=$2 RETURNING *`,
        [JSON.stringify(items), check.id]
      );
      check = upd[0];
    }

    res.json({ ok: true, check: { id: check.id, due_date: check.due_date, items: check.items } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Sauvegarde items + clôture éventuelle
app.put("/api/doors/doors/:id/checks/:checkId", async (req, res) => {
  try {
    const { items = [], close = false } = req.body || {};

    // merge items
    const { rows: curR } = await pool.query(`SELECT * FROM fd_checks WHERE id=$1 AND door_id=$2`, [req.params.checkId, req.params.id]);
    const current = curR[0];
    if (!current) return res.status(404).json({ ok: false, error: "check_not_found" });

    // merge by index
    const map = new Map((current.items || []).map((it) => [Number(it.index), it]));
    (items || []).forEach((it) => {
      const idx = Number(it.index);
      const prev = map.get(idx) || { index: idx, label: it.label || (map.get(idx)?.label ?? "") };
      map.set(idx, { ...prev, value: it.value ?? prev.value, comment: it.comment ?? prev.comment, label: prev.label || it.label || "" });
    });
    const merged = Array.from(map.values()).sort((a, b) => a.index - b.index);

    let closedRow = null;

    if (close) {
      // Comptes
      const counts = { conforme: 0, nc: 0, na: 0 };
      for (const it of merged) {
        if (it.value === "conforme") counts.conforme++;
        else if (it.value === "non_conforme") counts.nc++;
        else counts.na++;
      }

      // Statut & PDF si NC
      let pdfPath = null;
      let status = counts.nc > 0 ? "nc" : "ok";

      if (counts.nc > 0) {
        const { rows: doorR } = await pool.query(`SELECT id, name, building, floor, location FROM fd_doors WHERE id=$1`, [req.params.id]);
        const door = doorR[0];
        const out = path.join(DATA_ROOT, `NC_${door.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`);
        await createNcPdf(out, door, { items: merged });
        pdfPath = out;
      }

      const { rows: upd } = await pool.query(
        `UPDATE fd_checks
           SET items=$1, closed_at=now(), status=$2, result_counts=$3, pdf_nc_path=$4, updated_at=now()
         WHERE id=$5
         RETURNING *`,
        [JSON.stringify(merged), status, counts, pdfPath, req.params.checkId]
      );
      closedRow = upd[0];

      // Planifie le prochain contrôle (dès clôture)
      const s = await getSettings();
      const months = FREQ_TO_MONTHS[s.frequency] || 12;
      const nextDue = addMonthsISO(todayISO(), months);
      await pool.query(`INSERT INTO fd_checks(door_id, due_date) VALUES($1,$2)`, [req.params.id, nextDue]);
    } else {
      await pool.query(`UPDATE fd_checks SET items=$1, updated_at=now() WHERE id=$2`, [JSON.stringify(merged), req.params.checkId]);
    }

    // Renvoie la fiche porte mise à jour (comme attendu par le front)
    const { rows: dR } = await pool.query(`SELECT * FROM fd_doors WHERE id=$1`, [req.params.id]);
    const door = dR[0];

    const { rows: pend } = await pool.query(
      `SELECT id, started_at, closed_at, due_date, items FROM fd_checks WHERE door_id=$1 AND closed_at IS NULL ORDER BY due_date ASC LIMIT 1`,
      [door.id]
    );
    const c = pend[0] || null;
    const hasStarted = !!(c && c.started_at && !c.closed_at);
    const statusDoor = computeDoorStatus(c?.due_date || null, hasStarted);

    res.json({
      ok: true,
      door: {
        id: door.id,
        name: door.name,
        building: door.building,
        floor: door.floor,
        location: door.location,
        status: statusDoor,
        next_check_date: c?.due_date || null,
        current_check: c ? { id: c.id, items: c.items, itemsView: (await getSettings()).checklist_template } : null,
      },
      closed: !!closedRow,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Historique (checks clos)
app.get("/api/doors/doors/:id/history", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, closed_at, status, result_counts
         FROM fd_checks
        WHERE door_id=$1 AND closed_at IS NOT NULL
        ORDER BY closed_at DESC`,
      [req.params.id]
    );
    const checks = rows.map((r) => ({
      id: r.id,
      date: r.closed_at,
      // pour l'historique, vert "fait" si ok ; rouge "en_retard" si nc
      status: r.status === "ok" ? STATUS.FAIT : STATUS.EN_RETARD,
      user: "-", // pas de user stocké ici (peut être ajouté si auth réelle)
      comment: r.status === "ok" ? "Tous points conformes" : "Non-conformités détectées",
    }));
    res.json({ ok: true, checks });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------
// Files  • /api/doors/doors/:id/files
// ------------------------------
app.get("/api/doors/doors/:id/files", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, path, mime, size_bytes AS size_bytes FROM fd_files WHERE door_id=$1 ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    const files = rows.map((f) => ({
      id: f.id,
      original_name: f.filename,
      mime: f.mime || "application/octet-stream",
      size_bytes: Number(f.size_bytes || 0),
      url: `/api/doors/files/${f.id}/download`,
      download_url: `/api/doors/files/${f.id}/download`,
      inline_url: `/api/doors/files/${f.id}/download`,
    }));
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/doors/doors/:id/files", uploadAny.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file requis" });
    await pool.query(
      `INSERT INTO fd_files(door_id, filename, path, mime, size_bytes) VALUES($1,$2,$3,$4,$5)`,
      [req.params.id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/doors/files/:fileId/download", async (req, res) => {
  const { rows } = await pool.query(`SELECT path, filename, mime FROM fd_files WHERE id=$1`, [req.params.fileId]);
  const f = rows[0];
  if (!f || !fs.existsSync(f.path)) return res.status(404).send("file");
  res.setHeader("Content-Type", f.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.filename)}"`);
  res.sendFile(path.resolve(f.path));
});

app.delete("/api/doors/files/:fileId", async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM fd_files WHERE id=$1 RETURNING path`, [req.params.fileId]);
    const p = rows[0]?.path;
    if (p && fs.existsSync(p)) fs.unlink(p, () => {});
    res.json({ ok: true });
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
    const { rows } = await pool.query(`SELECT id, name FROM fd_doors WHERE id=$1`, [req.params.id]);
    const d = rows[0];
    if (!d) return res.status(404).send("door");
    const file = await ensureDoorQRCode(d.id, d.name, size);
    res.setHeader("Content-Type", "image/png");
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
      // Génère à la volée un PDF vide de NC (utile pour archivage)
      const tmp = path.join(DATA_ROOT, `NC_${row.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`);
      await createNcPdf(tmp, row, { items: [] });
      res.setHeader("Content-Type", "application/pdf");
      return res.sendFile(path.resolve(tmp));
    }

    if (row.pdf_nc_path && fs.existsSync(row.pdf_nc_path)) {
      res.setHeader("Content-Type", "application/pdf");
      return res.sendFile(path.resolve(row.pdf_nc_path));
    }

    // Si le chemin n'existe plus, régénère à partir des items stockés
    const regen = path.join(DATA_ROOT, `NC_${row.name.replace(/[^\w.-]+/g, "_")}_${Date.now()}.pdf`);
    await createNcPdf(regen, row, { items: row.items || [] });
    res.setHeader("Content-Type", "application/pdf");
    res.sendFile(path.resolve(regen));
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
      return {
        date: r.due_date,
        door_id: r.door_id,
        door_name: r.door_name,
        status: st,
      };
    });

    res.json({ ok: true, events });
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
});
