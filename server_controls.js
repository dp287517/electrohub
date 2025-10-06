// server_controls.js
// Backend Controls – Electrohub
// Prérequis: Node 18+, Express, pg
// npm i express pg multer dayjs uuid

import express from "express";
import multer from "multer";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { v4 as uuidv4 } from "uuid";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

dayjs.extend(utc);

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// --- DB --------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Load TSD Library (ESM export) ----------------------------------------
async function loadTsdLibrary() {
  // Chargement robuste de tsd_library.js (ESM)
  const tsdPath = path.resolve(process.cwd(), "tsd_library.js");
  if (!fs.existsSync(tsdPath)) {
    throw new Error("tsd_library.js introuvable à la racine.");
  }
  const mod = await import(pathToFileURL(tsdPath).href);
  if (!mod || !mod.tsdLibrary) throw new Error("tsd_library.js ne contient pas tsdLibrary.");
  return mod.tsdLibrary;
}
const tsdLibrary = await loadTsdLibrary();
const RESULT_OPTIONS = tsdLibrary?.meta?.result_options ?? ["Conforme", "Non conforme", "Non applicable"];

// --- Utils -----------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

function toPgInterval({ interval, unit }) {
  if (!interval || !unit) return null;
  switch (unit) {
    case "months":
      return `${interval} months`;
    case "years":
      return `${interval} years`;
    case "weeks":
      return `${interval} weeks`;
    case "days":
      return `${interval} days`;
    default:
      return null;
  }
}

function addFrequency(dateISO, frequency) {
  if (!frequency) return null;
  const { interval, unit } = frequency;
  if (!interval || !unit) return null;
  return dayjs.utc(dateISO).add(interval, unit).toISOString();
}

function findCategoryByKeyOrLabel(keyOrLabel) {
  if (!keyOrLabel) return null;
  const low = String(keyOrLabel).toLowerCase();
  return tsdLibrary.categories.find(
    (c) => c.key?.toLowerCase() === low || c.label?.toLowerCase() === low
  );
}

function findControlInCategory(category, controlType) {
  if (!category) return null;
  const low = String(controlType || "").toLowerCase();
  return category.controls.find((t) => t.type?.toLowerCase() === low);
}

function nextDueDateFromLibrary(categoryKeyOrLabel, controlType, closedAtISO) {
  const category = findCategoryByKeyOrLabel(categoryKeyOrLabel);
  const control = findControlInCategory(category, controlType);
  const freq = control?.frequency;
  if (!freq) return null;
  return addFrequency(closedAtISO, freq);
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Filtrage “vivant” : masque les tâches dont l’entité n’existe plus.
const EXISTS_ENTITY_SQL = `
  EXISTS (
    SELECT 1 FROM controls_entities ce WHERE ce.id = t.entity_id
  )
`;

// --- Health ----------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, tsd_loaded: !!tsdLibrary, categories: tsdLibrary?.categories?.length || 0 });
});

// --- TSD exposure (lecture seule) -----------------------------------------
app.get("/tsd", (_req, res) => {
  res.json({ meta: tsdLibrary.meta, categories: tsdLibrary.categories.map(c => ({ key: c.key, label: c.label, db_table: c.db_table })) });
});

app.get("/tsd/category/:key", (req, res) => {
  const cat = findCategoryByKeyOrLabel(req.params.key);
  if (!cat) return res.status(404).json({ error: "Catégorie introuvable" });
  res.json(cat);
});

// --- Entities helper -------------------------------------------------------
app.get("/entities/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM controls_entities WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Entité introuvable" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- TASKS: listing with filters ------------------------------------------
app.get("/tasks", async (req, res) => {
  const {
    q,
    status, // open|closed|overdue
    site,
    category, // category key or label
    control,  // control type
    due_from,
    due_to,
    entity_id,
    page = 1,
    page_size = 50,
    order = "due_date.asc", // e.g. "due_date.asc" | "due_date.desc" | "created_at.desc"
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  where.push(EXISTS_ENTITY_SQL);

  if (q) {
    where.push(`(t.label ILIKE $${i} OR t.control_type ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }
  if (status) {
    if (status === "overdue") {
      where.push(`t.status = 'open' AND t.due_date < NOW()`);
    } else {
      where.push(`t.status = $${i}`);
      params.push(status);
      i++;
    }
  }
  if (site) {
    where.push(`t.site_id = $${i}`);
    params.push(site);
    i++;
  }
  if (category) {
    where.push(`(LOWER(t.category_key) = LOWER($${i}) OR LOWER(t.category_label) = LOWER($${i}))`);
    params.push(category);
    i++;
  }
  if (control) {
    where.push(`LOWER(t.control_type) = LOWER($${i})`);
    params.push(control);
    i++;
  }
  if (entity_id) {
    where.push(`t.entity_id = $${i}`);
    params.push(entity_id);
    i++;
  }
  if (due_from) {
    where.push(`t.due_date >= $${i}`);
    params.push(due_from);
    i++;
  }
  if (due_to) {
    where.push(`t.due_date <= $${i}`);
    params.push(due_to);
    i++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [col, dir] = String(order).split(".");
  const sortSQL = `ORDER BY t.${col || "due_date"} ${dir?.toUpperCase() === "DESC" ? "DESC" : "ASC"}`;
  const limit = Math.max(1, Math.min(500, Number(page_size)));
  const offset = (Math.max(1, Number(page)) - 1) * limit;

  try {
    const { rows } = await pool.query(
      `
      SELECT t.*
      FROM controls_tasks t
      ${whereSQL}
      ${sortSQL}
      LIMIT ${limit} OFFSET ${offset}
      `
      , params
    );
    res.json({ items: rows, page: Number(page), page_size: limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- TASKS: create ---------------------------------------------------------
app.post("/tasks", async (req, res) => {
  const {
    entity_id,
    site_id = null,
    category_key,       // ex: "lv_switchgear"
    category_label,     // ex: "Low voltage switchgear (<1000 V ac)" (optionnel si key fourni)
    control_type,       // ex: "Thermography"
    due_date,           // ISO; si absent on calcule via TSD à partir de now
    payload = {},       // metadata libre
  } = req.body;

  if (!entity_id || !(category_key || category_label) || !control_type) {
    return res.status(400).json({ error: "entity_id, category_key|category_label et control_type sont requis" });
  }

  const category = findCategoryByKeyOrLabel(category_key || category_label);
  if (!category) return res.status(422).json({ error: "Catégorie TSD inconnue" });

  const control = findControlInCategory(category, control_type);
  if (!control) return res.status(422).json({ error: "Type de contrôle inconnu pour cette catégorie" });

  const frequency = control.frequency || null;
  const due = due_date || addFrequency(new Date().toISOString(), frequency) || dayjs.utc().add(30, "days").toISOString();

  try {
    const result = await withTx(async (client) => {
      // Vérifier existence de l’entité
      const ent = await client.query(`SELECT id FROM controls_entities WHERE id = $1`, [entity_id]);
      if (!ent.rowCount) {
        return {
          warning: category.fallback_note_if_missing || tsdLibrary.meta?.missing_equipment_note || "Equipment pending integration into Electrohub system.",
        };
      }

      const id = uuidv4();
      const { rows } = await client.query(
        `
        INSERT INTO controls_tasks
          (id, entity_id, site_id, category_key, category_label, control_type, label, status, due_date, frequency_interval, frequency_unit, payload, created_at, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11, NOW(), NOW())
        RETURNING *
        `,
        [
          id,
          entity_id,
          site_id,
          category.key,
          category.label,
          control.type,
          `${category.label} – ${control.type}`,
          due,
          control.frequency?.interval || null,
          control.frequency?.unit || null,
          payload,
        ]
      );

      // Historique
      await client.query(
        `INSERT INTO controls_history (id, task_id, action, payload, created_at) VALUES ($1,$2,$3,$4,NOW())`,
        [uuidv4(), id, "task_created", { by: "system", reason: "manual_create" }]
      );

      return rows[0];
    });

    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- TASKS: close (auto-create next) --------------------------------------
app.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const {
    record_status = "done", // done/failed/na
    checklist = [],         // [{item, result, note}], result in RESULT_OPTIONS
    observations = {},      // { key: value }
    attachments = [],       // [{filename, url, mime, bytes}]
    actor_id = null,        // user id
    closed_at = new Date().toISOString(),
  } = req.body;

  try {
    const outcome = await withTx(async (client) => {
      // Lire la tâche
      const { rows: taskRows } = await client.query(
        `SELECT * FROM controls_tasks t WHERE t.id = $1`,
        [id]
      );
      if (!taskRows.length) throw new Error("Tâche introuvable");
      const task = taskRows[0];

      // Enregistrer le record de contrôle
      const recordId = uuidv4();
      await client.query(
        `
        INSERT INTO controls_records
          (id, task_id, entity_id, status, checklist, observations, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        `,
        [
          recordId,
          task.id,
          task.entity_id,
          record_status,
          checklist,
          observations,
        ]
      );

      // Attacher les pièces jointes au record (et à la tâche)
      for (const a of attachments) {
        await client.query(
          `
          INSERT INTO controls_attachments
            (id, task_id, record_id, entity_id, url, filename, mime, bytes, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
          `,
          [uuidv4(), task.id, recordId, task.entity_id, a.url, a.filename, a.mime, a.bytes || null]
        );
      }

      // Clôturer la tâche
      await client.query(
        `UPDATE controls_tasks SET status='closed', closed_at=$2, updated_at=NOW() WHERE id=$1`,
        [task.id, closed_at]
      );

      // Historique
      await client.query(
        `INSERT INTO controls_history (id, task_id, action, payload, created_at) VALUES ($1,$2,$3,$4,NOW())`,
        [uuidv4(), task.id, "task_closed", { by: actor_id, record_id: recordId }]
      );

      // Créer la prochaine tâche selon la fréquence du TSD
      const nextDue = nextDueDateFromLibrary(task.category_key || task.category_label, task.control_type, closed_at);
      let nextTask = null;

      if (nextDue) {
        const nextId = uuidv4();
        await client.query(
          `
          INSERT INTO controls_tasks
            (id, entity_id, site_id, category_key, category_label, control_type, label, status, due_date, frequency_interval, frequency_unit, payload, created_at, updated_at)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11,NOW(),NOW())
          `,
          [
            nextId,
            task.entity_id,
            task.site_id,
            task.category_key,
            task.category_label,
            task.control_type,
            task.label,
            nextDue,
            task.frequency_interval,
            task.frequency_unit,
            task.payload,
          ]
        );
        await client.query(
          `INSERT INTO controls_history (id, task_id, action, payload, created_at) VALUES ($1,$2,$3,$4,NOW())`,
          [uuidv4(), nextId, "task_created", { by: "system", reason: "auto_reschedule", from_task_id: task.id }]
        );

        const { rows } = await client.query(`SELECT * FROM controls_tasks WHERE id = $1`, [nextId]);
        nextTask = rows[0];
      }

      return { task_closed: task.id, record_id: recordId, next_task: nextTask };
    });

    res.json(outcome);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- TASKS: history --------------------------------------------------------
app.get("/tasks/:id/history", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM controls_history WHERE task_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ATTACHMENTS: upload stub (metadata only) ------------------------------
app.post("/tasks/:id/attachments", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const { originalname, mimetype, size, buffer } = req.file || {};
  if (!buffer) return res.status(400).json({ error: "Aucun fichier reçu" });

  try {
    const { rows: t } = await pool.query(`SELECT id, entity_id FROM controls_tasks WHERE id = $1`, [id]);
    if (!t.length) return res.status(404).json({ error: "Tâche introuvable" });

    // ICI: stocke le fichier ailleurs (S3, MinIO, etc.) et récupère une URL publique.
    // Pour l’instant, on stocke uniquement les métadonnées et une fausse URL locale.
    const url = `attachment://${uuidv4()}/${originalname}`;

    await pool.query(
      `
      INSERT INTO controls_attachments (id, task_id, entity_id, url, filename, mime, bytes, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      `,
      [uuidv4(), id, t[0].entity_id, url, originalname, mimetype, size]
    );

    res.json({ ok: true, url, filename: originalname, mime: mimetype, bytes: size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- CALENDAR view ---------------------------------------------------------
app.get("/calendar", async (req, res) => {
  const { from, to, site_id, category } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  where.push(EXISTS_ENTITY_SQL);

  if (from) {
    where.push(`t.due_date >= $${i}`); params.push(from); i++;
  }
  if (to) {
    where.push(`t.due_date <= $${i}`); params.push(to); i++;
  }
  if (site_id) {
    where.push(`t.site_id = $${i}`); params.push(site_id); i++;
  }
  if (category) {
    where.push(`(LOWER(t.category_key) = LOWER($${i}) OR LOWER(t.category_label) = LOWER($${i}))`);
    params.push(category); i++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `
      SELECT t.id, t.label, t.status, t.due_date, t.category_label, t.control_type, t.entity_id, t.site_id
      FROM controls_tasks t
      ${whereSQL}
      ORDER BY t.due_date ASC
      `,
      params
    );

    // Group by day
    const groups = rows.reduce((acc, r) => {
      const k = dayjs.utc(r.due_date).format("YYYY-MM-DD");
      acc[k] = acc[k] || [];
      acc[k].push(r);
      return acc;
    }, {});
    res.json(groups);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- AI STUBS --------------------------------------------------------------
// Analyse photo "avant intervention"
app.post("/ai/analyze-before", async (req, res) => {
  const { image_url, hints = [] } = req.body;
  if (!image_url) return res.status(400).json({ error: "image_url requis" });

  // Stub — à brancher vers ton moteur IA préféré
  res.json({
    ok: true,
    findings: [
      { type: "safety", message: "Vérifier EPI: gants, visière, balisage", confidence: 0.82 },
      { type: "housekeeping", message: "Objets combustibles à proximité du TGBT", confidence: 0.74 },
    ],
    hints,
  });
});

// Analyse photo "pendant intervention" (reconnaissance valeur appareil)
app.post("/ai/analyze-during", async (req, res) => {
  const { image_url, expected_metric = "Voltage (V)" } = req.body;
  if (!image_url) return res.status(400).json({ error: "image_url requis" });

  // Stub — OCR/vision à brancher
  res.json({
    ok: true,
    readings: [
      { metric: expected_metric, value: "400", unit: "V", confidence: 0.77 },
    ],
  });
});

// --- PROTECTIONS -----------------------------------------------------------
// Aucune suppression de tâche autorisée
app.delete("/tasks/:id", (_req, res) => {
  res.status(405).json({ error: "Suppression de tâche interdite" });
});

// Si un équipement (entité) est supprimé côté DB, les tâches disparaissent de la vue
// grâce au WHERE EXISTS sur controls_entities. Pour durcir côté DB, utiliser FK
// ON DELETE CASCADE (t.entity_id -> controls_entities.id).

// --- SERVER BOOT -----------------------------------------------------------
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
