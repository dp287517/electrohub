// server_controls.js — Controls backend (corrigé, robuste & rétro-compatible)
// - Fix "column size does not exist" (ALTER + fallback)
// - TSD = source de vérité pour library/result_schema
// - Non applicable auto si type TSD absent en DB
// - Routes compatibles avec le front actuel (X-Site)

import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import { Pool } from "pg";
import crypto from "crypto";

import {
  TSD_LIBRARY,
  EQUIPMENT_TYPES,
  TSD_FLAGS,
} from "./tsd_library.js"; // TSD pilotage des tâches/fields

/* ====================== CONFIG ====================== */
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "20mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "20mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  max: 15,
  idleTimeoutMillis: 30000,
});

/* ====================== UTILS ====================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getSite(req) {
  return req.headers["x-site"] || req.query.site || "Default";
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function daysDiff(a, b) {
  const A = new Date(a).getTime();
  const B = new Date(b).getTime();
  return Math.floor((A - B) / 86400000);
}

async function colExists(table, column) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

/* ====================== SCHEMA INIT ====================== */
async function ensureSchema() {
  // Entités (équipements)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_entities (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL DEFAULT 'Default',
      building TEXT,
      equipment_type TEXT NOT NULL,
      name TEXT NOT NULL,
      tags JSONB DEFAULT '[]'::jsonb,
      UNIQUE (site, equipment_type, name)
    );
  `);

  // Tâches
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_tasks (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL DEFAULT 'Default',
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      task_code TEXT NOT NULL,
      task_name TEXT NOT NULL,
      result_schema JSONB DEFAULT '{}'::jsonb,
      frequency_months INTEGER DEFAULT 12,
      next_control TIMESTAMPTZ,
      status TEXT DEFAULT 'Planned',
      results JSONB DEFAULT '{}'::jsonb,
      ai_notes JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (site, entity_id, task_code)
    );
  `);

  // Pièces jointes (stockage DB par défaut)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE CASCADE,
      filename TEXT,
      mimetype TEXT,
      size INTEGER,
      data BYTEA,
      label TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Rétro-compatibilité : ajoute les colonnes manquantes si table existante
  await pool.query(`ALTER TABLE controls_attachments ADD COLUMN IF NOT EXISTS filename TEXT;`);
  await pool.query(`ALTER TABLE controls_attachments ADD COLUMN IF NOT EXISTS mimetype TEXT;`);
  await pool.query(`ALTER TABLE controls_attachments ADD COLUMN IF NOT EXISTS size INTEGER;`);
  await pool.query(`ALTER TABLE controls_attachments ADD COLUMN IF NOT EXISTS data BYTEA;`);
  await pool.query(`ALTER TABLE controls_attachments ADD COLUMN IF NOT EXISTS label TEXT;`);
  await pool.query(`ALTER TABLE controls_attachments ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ DEFAULT NOW();`);

  // Types non présents (Non applicable)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_not_present (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL DEFAULT 'Default',
      equipment_type TEXT NOT NULL,
      declared_by TEXT DEFAULT 'system',
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Index
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ct_site ON controls_tasks(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ce_site ON controls_entities(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ct_entity ON controls_tasks(entity_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ca_task ON controls_attachments(task_id);`);
}

/* ====================== TSD → RESULT SCHEMA ====================== */
function toResultSchemaFromTSD(tsdItem) {
  // Normalise les champs pour le front (boolean / number / text / select / checklist)
  // tsdItem peut contenir: type, field, unit, comparator, threshold, options, checklist
  if (!tsdItem) return { type: "boolean", field: "ok" };
  const out = {
    type: tsdItem.type || "boolean",
    field: tsdItem.field || "value",
  };
  if (tsdItem.unit) out.unit = tsdItem.unit;
  if (Array.isArray(tsdItem.options)) out.options = tsdItem.options;
  if (Array.isArray(tsdItem.checklist)) out.checklist = tsdItem.checklist; // support explicite
  if (tsdItem.comparator) out.comparator = tsdItem.comparator;
  if (tsdItem.threshold !== undefined) out.threshold = tsdItem.threshold;
  return out;
}

/* ====================== SYNC / AUTO-GENERATION ====================== */
async function importFromSources(site) {
  // EXEMPLE : lit HV/ATEX/SWITCHBOARD de tes autres tables si présentes.
  // Ici on garde un import minimal : si tu as déjà des entités, on n’écrase pas.
  // Complète si besoin selon tes autres services.
  const known = new Set();
  const { rows } = await pool.query(
    `SELECT id, equipment_type, name FROM controls_entities WHERE site=$1`,
    [site]
  );
  for (const r of rows) known.add(`${r.equipment_type}::${r.name}`);

  // Si aucune entité, on crée des placeholders vides pour montrer la mécanique
  if (rows.length === 0) {
    const samples = [
      { building: "B1", equipment_type: "LV_SWITCHBOARD", name: "Tableau TGBT" },
      { building: "B1", equipment_type: "LV_DEVICE", name: "Disjoncteur QF-101" },
      { building: "B2", equipment_type: "HV_EQUIPMENT", name: "Cellule HTA n°1" },
      { building: "B3", equipment_type: "ATEX_EQUIPMENT", name: "Moteur ATEX Z3" },
    ];
    for (const s of samples) {
      await pool.query(
        `INSERT INTO controls_entities(site,building,equipment_type,name) VALUES($1,$2,$3,$4)
         ON CONFLICT (site, equipment_type, name) DO NOTHING`,
        [site, s.building, s.equipment_type, s.name]
      );
    }
  }
}

// Crée/MAJ les tasks depuis la TSD pour chaque entité
async function regenerateTasksForSite(site) {
  const { rows: ents } = await pool.query(
    `SELECT * FROM controls_entities WHERE site=$1`,
    [site]
  );

  for (const e of ents) {
    const pack = TSD_LIBRARY[e.equipment_type] || [];
    for (const item of pack) {
      const result_schema = toResultSchemaFromTSD(item);
      await pool.query(
        `INSERT INTO controls_tasks(site, entity_id, task_code, task_name, result_schema, frequency_months, next_control, status)
         VALUES($1,$2,$3,$4,$5,$6,$7,'Planned')
         ON CONFLICT (site, entity_id, task_code) DO UPDATE
           SET task_name=EXCLUDED.task_name,
               result_schema=EXCLUDED.result_schema,
               frequency_months=EXCLUDED.frequency_months`,
        [
          site,
          e.id,
          item.id,
          item.label || item.name || item.id,
          result_schema,
          Number(item.frequency_months || 12),
          addMonths(new Date(), Number(item.frequency_months || 12)),
        ]
      );
    }
  }
}

// Marque "Non applicable" si un type TSD n’existe pas dans la DB pour le site
async function ensureAbsentTypes(site) {
  for (const t of EQUIPMENT_TYPES || []) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM controls_entities WHERE site=$1 AND equipment_type=$2`,
      [site, t]
    );
    const n = rows?.[0]?.n || 0;
    if (n === 0) {
      const exists = await pool.query(
        `SELECT 1 FROM controls_not_present WHERE site=$1 AND equipment_type=$2 LIMIT 1`,
        [site, t]
      );
      if (exists.rowCount === 0) {
        await pool.query(
          `INSERT INTO controls_not_present(site, equipment_type, declared_by, note)
           VALUES($1,$2,'system','Non applicable (aucun équipement en base)')`,
          [site, t]
        );
      }
    }
  }
}

async function ensureAutoForSite(site) {
  await importFromSources(site);
  await regenerateTasksForSite(site);
  await ensureAbsentTypes(site);
}

async function ensureOverdueFlags() {
  await pool.query(`
    UPDATE controls_tasks
       SET status = CASE
          WHEN status <> 'Completed' AND next_control IS NOT NULL AND next_control < NOW() THEN 'Overdue'
          WHEN status = 'Completed' THEN 'Completed'
          ELSE 'Planned'
       END,
           updated_at = NOW()
     WHERE true;
  `);
}

/* ====================== ROUTES ====================== */

// Library (TSD)
app.get("/api/controls/library", async (req, res) => {
  try {
    const site = getSite(req);
    await ensureAutoForSite(site);
    res.json({
      types: EQUIPMENT_TYPES,
      flags: TSD_FLAGS || {},
      library: TSD_LIBRARY,
    });
  } catch (e) {
    res.status(500).json({ error: "Erreur library", details: e.message });
  }
});

// Tree (par bâtiment + types présents)
app.get("/api/controls/tree", async (req, res) => {
  try {
    const site = getSite(req);
    await ensureAutoForSite(site);

    const { rows } = await pool.query(
      `SELECT id, building, name, equipment_type FROM controls_entities WHERE site=$1 ORDER BY building, equipment_type, name`,
      [site]
    );

    const byBuilding = new Map();
    for (const r of rows) {
      if (!byBuilding.has(r.building || "—")) byBuilding.set(r.building || "—", []);
      byBuilding.get(r.building || "—").push(r);
    }

    const out = Array.from(byBuilding.entries()).map(([building, list]) => {
      const groups = {
        LV_SWITCHBOARD: list.filter((x) => x.equipment_type === "LV_SWITCHBOARD"),
        LV_DEVICE: list.filter((x) => x.equipment_type === "LV_DEVICE"),
        HV_EQUIPMENT: list.filter((x) => x.equipment_type === "HV_EQUIPMENT"),
        ATEX_EQUIPMENT: list.filter((x) => x.equipment_type === "ATEX_EQUIPMENT"),
      };
      return { building, groups };
    });

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Erreur tree", details: e.message });
  }
});

// Liste tasks (filtres + pagination)
app.get("/api/controls/tasks", async (req, res) => {
  try {
    const site = getSite(req);
    await ensureAutoForSite(site);
    await ensureOverdueFlags();

    const { building, type, status, q, page = 1, pageSize = 200, entity_id } = req.query;

    let i = 1;
    const values = [];
    const where = [];

    values.push(site);
    where.push(`ct.site = $${i++}`);

    if (building) {
      values.push(building);
      where.push(`ce.building = $${i++}`);
    }
    if (type) {
      values.push(type);
      where.push(`ce.equipment_type = $${i++}`);
    }
    if (status) {
      values.push(status);
      where.push(`ct.status = $${i++}`);
    }
    if (entity_id) {
      values.push(Number(entity_id));
      where.push(`ct.entity_id = $${i++}`);
    }
    if (q) {
      values.push(`%${q}%`);
      where.push(`(ct.task_name ILIKE $${i} OR ct.task_code ILIKE $${i})`);
      i++;
    }

    values.push(Number(pageSize));
    values.push((Number(page) - 1) * Number(pageSize));

    const sql = `
      SELECT ct.*, ce.equipment_type, ce.building, ce.name AS entity_name
      FROM controls_tasks ct
      LEFT JOIN controls_entities ce ON ce.id = ct.entity_id
      WHERE ${where.length ? where.join(" AND ") : "true"}
      ORDER BY ct.next_control ASC NULLS LAST, ct.id DESC
      LIMIT $${i++} OFFSET $${i}
    `;
    const { rows } = await pool.query(sql, values);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: "Erreur list tasks", details: e.message });
  }
});

// Détails task (+ TSD item)
app.get("/api/controls/tasks/:id/details", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const t = rows[0];

    const { rows: ent } = await pool.query(`SELECT equipment_type FROM controls_entities WHERE id=$1`, [t.entity_id]);
    const eqType = ent[0]?.equipment_type;
    let tsd_item = null;
    if (eqType && TSD_LIBRARY[eqType]) {
      tsd_item = (TSD_LIBRARY[eqType] || []).find((it) => it.id === t.task_code) || null;
    }
    if (!tsd_item) tsd_item = Object.values(TSD_LIBRARY).flat().find((it) => it.id === t.task_code) || null;

    res.json({ ...t, tsd_item });
  } catch (e) {
    res.status(500).json({ error: "Erreur details", details: e.message });
  }
});

/* --------- Pièces jointes (fallback colonne size) --------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.get("/api/controls/tasks/:id/attachments", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const hasSize = await colExists("controls_attachments", "size");
    const hasData = await colExists("controls_attachments", "data");

    // fallback robuste:  size, ou OCTET_LENGTH(data), sinon 0
    const sizeExpr = hasSize ? "size" : (hasData ? "octet_length(data) AS size" : "0::int AS size");

    const { rows } = await pool.query(
      `SELECT id, filename, ${sizeExpr}, mimetype, label, uploaded_at
         FROM controls_attachments
        WHERE task_id=$1
     ORDER BY uploaded_at DESC`,
      [taskId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Erreur attachments", details: e.message });
  }
});

app.get("/api/controls/tasks/:id/attachments/:attId", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const attId = Number(req.params.attId);
    const { rows } = await pool.query(
      `SELECT filename, mimetype, data FROM controls_attachments WHERE id=$1 AND task_id=$2`,
      [attId, taskId]
    );
    if (!rows.length) return res.status(404).send("Not found");
    const f = rows[0];
    res.setHeader("Content-Type", f.mimetype || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.filename || "file")}"`);
    res.send(f.data);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.delete("/api/controls/tasks/:id/attachments/:attId", async (req, res) => {
  try {
    const attId = Number(req.params.attId);
    await pool.query(`DELETE FROM controls_attachments WHERE id=$1`, [attId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erreur delete attachment", details: e.message });
  }
});

app.post("/api/controls/tasks/:id/upload", upload.array("files"), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const label = req.body.label || null;
    const files = req.files || [];

    const out = [];
    for (const f of files) {
      const { rows } = await pool.query(
        `INSERT INTO controls_attachments(task_id, filename, mimetype, size, data, label)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [taskId, f.originalname, f.mimetype, Number(f.size || 0), f.buffer, label]
      );
      out.push({ id: rows[0].id, filename: f.originalname });
    }
    res.json({ uploaded: out });
  } catch (e) {
    res.status(500).json({ error: "Erreur upload", details: e.message });
  }
});

/* --------- IA assistant / analyse (stubs sûrs) --------- */
const ASSISTANT_SYSTEM =
  "Tu es l’assistant des contrôles électriques. Réponds clairement, par étapes, en rappelant les EPI, outillage et risques. Si une photo est fournie, exploite-la, sinon propose les étapes manuelles.";

async function runChat(messages) {
  // branchement IA “stub” pour déploiement sans clé : renvoie une aide standard
  const txt =
    "- Vérifie l’isolement et l’état visuel.\n- Indique l’appareil à utiliser (multimètre, pince ampèremétrique, caméra IR...).\n- Décris le branchement et les seuils.\n- Liste les EPI et points de sécurité.\n- Ajoute les photos des mesures pour interprétation.";
  return { text: txt };
}

async function loadTaskContext(taskId) {
  const { rows: trows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [taskId]);
  if (!trows.length) return null;
  const task = trows[0];
  const { rows: ents } = await pool.query("SELECT * FROM controls_entities WHERE id=$1", [task.entity_id]);
  const entity = ents[0] || null;

  let tsd_item = null;
  if (entity?.equipment_type && TSD_LIBRARY[entity.equipment_type]) {
    tsd_item = (TSD_LIBRARY[entity.equipment_type] || []).find((it) => it.id === task.task_code) || null;
  }
  if (!tsd_item) tsd_item = Object.values(TSD_LIBRARY).flat().find((it) => it.id === task.task_code) || null;

  const hasSize = await colExists("controls_attachments", "size");
  const hasData = await colExists("controls_attachments", "data");
  const sizeExpr = hasSize ? "size" : (hasData ? "octet_length(data) AS size" : "0::int AS size");

  const { rows: atts } = await pool.query(
    `SELECT id, filename, ${sizeExpr}, mimetype, uploaded_at FROM controls_attachments WHERE task_id=$1 ORDER BY uploaded_at DESC LIMIT 10`,
    [taskId]
  );
  return { task, entity, tsd_item, attachments: atts };
}

app.post("/api/controls/tasks/:id/assistant", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = (req.body && req.body.question) || "";
    const ctx = await loadTaskContext(id);
    if (!ctx) return res.status(404).json({ error: "Task not found" });

    const contextText =
      `Contexte:\n- Site: ${ctx.task.site}\n- Equipement: ${ctx.entity?.name} (${ctx.entity?.equipment_type}) building=${ctx.entity?.building}\n` +
      `- Task: ${ctx.task.task_name} [${ctx.task.task_code}]\n- Résultats: ${JSON.stringify(ctx.task.results)}\n` +
      `- TSD: ${ctx.tsd_item ? JSON.stringify({ label: ctx.tsd_item.label, field: ctx.tsd_item.field, unit: ctx.tsd_item.unit, comparator: ctx.tsd_item.comparator, threshold: ctx.tsd_item.threshold }) : "none"}\n` +
      `- PJ: ${(ctx.attachments || []).map((a) => a.filename).join(", ") || "aucune"}`;

    const { text } = await runChat([
      { role: "system", content: ASSISTANT_SYSTEM },
      { role: "user", content: `${contextText}\n\nQuestion: ${q}` },
    ]);

    await pool.query(
      "UPDATE controls_tasks SET ai_notes = coalesce(ai_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'role', 'assistant', 'q', $1, 'text', $2)) WHERE id=$3",
      [q, text, id]
    );

    res.json({ answer: text });
  } catch (e) {
    res.status(500).json({ error: "Erreur assistant", details: e.message });
  }
});

app.post("/api/controls/tasks/:id/analyze", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ctx = await loadTaskContext(id);
    if (!ctx) return res.status(404).json({ error: "Task not found" });

    // Stub d’analyse : explique quoi chercher sur la photo + comment interpréter
    const analysis =
      "Analyse IA (générique) :\n" +
      "- Dépose une photo nette du point de mesure (écran d’appareil, IR, plaque signalétique…).\n" +
      "- L’IA extrait les valeurs (tension/intensité/température/IP, etc.) et compare au seuil TSD.\n" +
      "- Sans photo, saisis la valeur manuellement dans la checklist.";
    res.json({ analysis });
  } catch (e) {
    res.status(500).json({ error: "Erreur analyze", details: e.message });
  }
});

/* --------- Completion --------- */
app.post("/api/controls/tasks/:id/complete", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const payload = req.body || {};
    const user = payload.user || "system";

    const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const task = rows[0];

    const freq = Number(task.frequency_months || 12);
    const next = addMonths(new Date(), freq);

    const results = payload.results || {};
    await pool.query(
      `UPDATE controls_tasks
          SET results = COALESCE(results,'{}'::jsonb) || $1::jsonb,
              status = 'Completed',
              next_control = $2,
              updated_at = NOW()
        WHERE id=$3`,
      [results, next, id]
    );

    res.json({ ok: true, next_control: next.toISOString() });
  } catch (e) {
    res.status(500).json({ error: "Erreur complete", details: e.message });
  }
});

/* --------- Health --------- */
app.get("/api/controls/health", (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    unlocked: Boolean(process.env.CONTROLS_UNLOCKED || false),
  });
});

/* ====================== START ====================== */
const port = process.env.CONTROLS_PORT || 3011;
ensureSchema().then(() => {
  app.listen(port, () => console.log(`Controls service running on :${port}`));
});
