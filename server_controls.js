/**
 * server_controls.js — backend Controls (Electrohub)
 * - Routes montées sous /api/controls
 * - Auto-rééchelonnement à la clôture selon tsd_library.js
 *
 * Prérequis:
 *   npm i express pg multer dayjs uuid
 *
 * Variables d'env utiles:
 *   DATABASE_URL=postgres://... (Neon)
 *   CONTROLS_BASE_PATH=/api/controls   (optionnel; par défaut /api/controls)
 *   CONTROLS_PORT=3011                 (optionnel; par défaut 3011)
 */

const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const { v4: uuidv4 } = require("uuid");

dayjs.extend(utc);

// ----------------------------------------------------------------------------
// DB Pool (Neon / Postgres)
// ----------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ----------------------------------------------------------------------------
/** Chargement de la librairie TSD (fréquences, checklist, etc.) */
// ----------------------------------------------------------------------------
function loadTsdLibrary() {
  // Supporte exports CommonJS et ESM
  // Attendu: module.exports = { tsdLibrary } OU export const tsdLibrary = ...
  // Si jamais le module exporte directement l'objet, on accepte aussi.
  // IMPORTANT: tsd_library.js doit être à la racine du repo.
  let mod;
  try {
    mod = require("./tsd_library.js");
  } catch (e) {
    throw new Error(
      "Impossible de charger tsd_library.js à la racine. Erreur: " + e.message
    );
  }
  const tsdLibrary =
    mod.tsdLibrary || (mod.default && mod.default.tsdLibrary) || mod.tsdLibrary || mod;
  if (!tsdLibrary || !tsdLibrary.categories) {
    throw new Error(
      "tsd_library.js ne contient pas un objet { tsdLibrary } valide."
    );
  }
  return tsdLibrary;
}

const tsdLibrary = loadTsdLibrary();
const RESULT_OPTIONS =
  (tsdLibrary.meta && tsdLibrary.meta.result_options) || [
    "Conforme",
    "Non conforme",
    "Non applicable",
  ];

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

function addFrequency(dateISO, frequency) {
  if (!frequency) return null;
  const { interval, unit } = frequency;
  if (!interval || !unit) return null;
  return dayjs.utc(dateISO).add(interval, unit).toISOString();
}

function findCategoryByKeyOrLabel(keyOrLabel) {
  if (!keyOrLabel) return null;
  const low = String(keyOrLabel).toLowerCase();
  return (tsdLibrary.categories || []).find(
    (c) =>
      (c.key && String(c.key).toLowerCase() === low) ||
      (c.label && String(c.label).toLowerCase() === low)
  );
}

function findControlInCategory(category, controlType) {
  if (!category) return null;
  const low = String(controlType || "").toLowerCase();
  return (category.controls || []).find(
    (t) => t.type && String(t.type).toLowerCase() === low
  );
}

function nextDueDateFromLibrary(categoryKeyOrLabel, controlType, closedAtISO) {
  const category = findCategoryByKeyOrLabel(categoryKeyOrLabel);
  const control = findControlInCategory(category, controlType);
  const freq = control && control.frequency;
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

// ----------------------------------------------------------------------------
// App + Router (monté sous /api/controls)
// ----------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const router = express.Router();

const EXISTS_ENTITY_SQL =
  "EXISTS (SELECT 1 FROM controls_entities ce WHERE ce.id = t.entity_id)";

// ----------------------------------------------------------------------------
// Health + TSD
// ----------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    tsd_loaded: !!tsdLibrary,
    categories: (tsdLibrary.categories || []).length,
  });
});

router.get("/tsd", (_req, res) => {
  res.json({
    meta: tsdLibrary.meta || {},
    categories: (tsdLibrary.categories || []).map((c) => ({
      key: c.key,
      label: c.label,
      db_table: c.db_table,
    })),
  });
});

router.get("/tsd/category/:key", (req, res) => {
  const cat = findCategoryByKeyOrLabel(req.params.key);
  if (!cat) return res.status(404).json({ error: "Catégorie introuvable" });
  res.json(cat);
});

// ----------------------------------------------------------------------------
// Entities (helper simple)
// ----------------------------------------------------------------------------
router.get("/entities/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      "SELECT * FROM controls_entities WHERE id = $1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Entité introuvable" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------------------------------
// TASKS - Liste / Création / Clôture / Historique
// ----------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q,
    status,
    site,
    category,
    control,
    due_from,
    due_to,
    entity_id,
    page = 1,
    page_size = 50,
    order = "due_date.asc",
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  // Ne montrer que les tâches dont l'entité existe encore
  where.push(EXISTS_ENTITY_SQL);

  if (q) {
    where.push(`(t.label ILIKE $${i} OR t.control_type ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }
  if (status) {
    if (status === "overdue") where.push(`t.status = 'open' AND t.due_date < NOW()`);
    else {
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
    where.push(
      `(LOWER(t.category_key) = LOWER($${i}) OR LOWER(t.category_label) = LOWER($${i}))`
    );
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
  const sortSQL = `ORDER BY t.${col || "due_date"} ${
    dir?.toUpperCase() === "DESC" ? "DESC" : "ASC"
  }`;
  const limit = Math.max(1, Math.min(500, Number(page_size)));
  const offset = (Math.max(1, Number(page)) - 1) * limit;

  try {
    const { rows } = await pool.query(
      `SELECT t.* FROM controls_tasks t ${whereSQL} ${sortSQL} LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json({ items: rows, page: Number(page), page_size: limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/tasks", async (req, res) => {
  const {
    entity_id,
    site_id = null,
    category_key,
    category_label,
    control_type,
    due_date,
    payload = {},
  } = req.body;

  if (!entity_id || !(category_key || category_label) || !control_type) {
    return res
      .status(400)
      .json({ error: "entity_id, category_key|category_label et control_type sont requis" });
  }

  const category = findCategoryByKeyOrLabel(category_key || category_label);
  if (!category) return res.status(422).json({ error: "Catégorie TSD inconnue" });

  const control = findControlInCategory(category, control_type);
  if (!control)
    return res
      .status(422)
      .json({ error: "Type de contrôle inconnu pour cette catégorie" });

  const frequency = control.frequency || null;
  const due =
    due_date ||
    addFrequency(new Date().toISOString(), frequency) ||
    dayjs.utc().add(30, "days").toISOString();

  try {
    const result = await withTx(async (client) => {
      // Vérifie que l'entité existe (sinon message générique)
      const ent = await client.query(
        `SELECT id FROM controls_entities WHERE id = $1`,
        [entity_id]
      );
      if (!ent.rowCount) {
        return {
          warning:
            category.fallback_note_if_missing ||
            (tsdLibrary.meta && tsdLibrary.meta.missing_equipment_note) ||
            "Equipement en attente d'intégration au système Electrohub.",
        };
      }

      const id = uuidv4();
      const { rows } = await client.query(
        `INSERT INTO controls_tasks
          (id, entity_id, site_id, category_key, category_label, control_type, label, status, due_date,
           frequency_interval, frequency_unit, payload, created_at, updated_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11,NOW(),NOW())
         RETURNING *`,
        [
          id,
          entity_id,
          site_id,
          category.key,
          category.label,
          control.type,
          `${category.label} – ${control.type}`,
          due,
          (control.frequency && control.frequency.interval) || null,
          (control.frequency && control.frequency.unit) || null,
          payload,
        ]
      );

      await client.query(
        `INSERT INTO controls_history (id, task_id, action, payload, created_at)
         VALUES ($1,$2,$3,$4,NOW())`,
        [uuidv4(), id, "task_created", { by: "system", reason: "manual_create" }]
      );

      return rows[0];
    });

    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const {
    record_status = "done",
    checklist = [],
    observations = {},
    attachments = [],
    actor_id = null,
    closed_at = new Date().toISOString(),
  } = req.body;

  try {
    const outcome = await withTx(async (client) => {
      // 1) Récupère la tâche
      const { rows: taskRows } = await client.query(
        `SELECT * FROM controls_tasks t WHERE t.id = $1`,
        [id]
      );
      if (!taskRows.length) throw new Error("Tâche introuvable");
      const task = taskRows[0];

      // 2) Enregistre un record
      const recordId = uuidv4();
      await client.query(
        `INSERT INTO controls_records
          (id, task_id, entity_id, status, checklist, observations, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [recordId, task.id, task.entity_id, record_status, checklist, observations]
      );

      // 3) Pièces jointes
      for (const a of attachments) {
        await client.query(
          `INSERT INTO controls_attachments
            (id, task_id, record_id, entity_id, url, filename, mime, bytes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [
            uuidv4(),
            task.id,
            recordId,
            task.entity_id,
            a.url,
            a.filename,
            a.mime,
            a.bytes || null,
          ]
        );
      }

      // 4) Clôture de la tâche
      await client.query(
        `UPDATE controls_tasks SET status='closed', closed_at=$2, updated_at=NOW() WHERE id=$1`,
        [task.id, closed_at]
      );

      await client.query(
        `INSERT INTO controls_history (id, task_id, action, payload, created_at)
         VALUES ($1,$2,$3,$4,NOW())`,
        [uuidv4(), task.id, "task_closed", { by: actor_id, record_id: recordId }]
      );

      // 5) Auto-rééchelonnement selon la fréquence TSD
      const nextDue = nextDueDateFromLibrary(
        task.category_key || task.category_label,
        task.control_type,
        closed_at
      );

      let nextTask = null;
      if (nextDue) {
        const nextId = uuidv4();
        await client.query(
          `INSERT INTO controls_tasks
            (id, entity_id, site_id, category_key, category_label, control_type, label, status, due_date,
             frequency_interval, frequency_unit, payload, created_at, updated_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11,NOW(),NOW())`,
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
          `INSERT INTO controls_history (id, task_id, action, payload, created_at)
           VALUES ($1,$2,$3,$4,NOW())`,
          [
            uuidv4(),
            nextId,
            "task_created",
            { by: "system", reason: "auto_reschedule", from_task_id: task.id },
          ]
        );

        const { rows } = await client.query(
          `SELECT * FROM controls_tasks WHERE id = $1`,
          [nextId]
        );
        nextTask = rows[0];
      }

      return { task_closed: task.id, record_id: recordId, next_task: nextTask };
    });

    res.json(outcome);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/tasks/:id/history", async (req, res) => {
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

// ----------------------------------------------------------------------------
// Attachments (stockage metadata - à adapter si tu veux uploader réellement)
// ----------------------------------------------------------------------------
router.post(
  "/tasks/:id/attachments",
  upload.single("file"),
  async (req, res) => {
    const { id } = req.params;
    const { originalname, mimetype, size, buffer } = req.file || {};
    if (!buffer) return res.status(400).json({ error: "Aucun fichier reçu" });

    try {
      const { rows: t } = await pool.query(
        `SELECT id, entity_id FROM controls_tasks WHERE id = $1`,
        [id]
      );
      if (!t.length) return res.status(404).json({ error: "Tâche introuvable" });

      // Stub: stocke uniquement des métadonnées avec une URL factice.
      const url = `attachment://${uuidv4()}/${originalname}`;
      await pool.query(
        `INSERT INTO controls_attachments
          (id, task_id, entity_id, url, filename, mime, bytes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [uuidv4(), id, t[0].entity_id, url, originalname, mimetype, size]
      );

      res.json({
        ok: true,
        url,
        filename: originalname,
        mime: mimetype,
        bytes: size,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ----------------------------------------------------------------------------
// Calendar (groupé par jour)
// ----------------------------------------------------------------------------
router.get("/calendar", async (req, res) => {
  const { from, to, site_id, category } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  where.push(EXISTS_ENTITY_SQL);
  if (from) {
    where.push(`t.due_date >= $${i}`);
    params.push(from);
    i++;
  }
  if (to) {
    where.push(`t.due_date <= $${i}`);
    params.push(to);
    i++;
  }
  if (site_id) {
    where.push(`t.site_id = $${i}`);
    params.push(site_id);
    i++;
  }
  if (category) {
    where.push(
      `(LOWER(t.category_key) = LOWER($${i}) OR LOWER(t.category_label) = LOWER($${i}))`
    );
    params.push(category);
    i++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT
         t.id, t.label, t.status, t.due_date, t.category_label,
         t.control_type, t.entity_id, t.site_id
       FROM controls_tasks t
       ${whereSQL}
       ORDER BY t.due_date ASC`,
      params
    );

    const groups = rows.reduce((acc, r) => {
      const k = dayjs.utc(r.due_date).format("YYYY-MM-DD");
      (acc[k] = acc[k] || []).push(r);
      return acc;
    }, {});

    res.json(groups);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------------------------------
// IA (stubs) — à remplacer par tes vrais endpoints IA
// ----------------------------------------------------------------------------
router.post("/ai/analyze-before", async (req, res) => {
  const { image_url, hints = [] } = req.body || {};
  if (!image_url) return res.status(400).json({ error: "image_url requis" });
  res.json({
    ok: true,
    findings: [
      {
        type: "safety",
        message: "Vérifier EPI: gants, visière, balisage",
        confidence: 0.82,
      },
      {
        type: "housekeeping",
        message: "Objets combustibles à proximité du TGBT",
        confidence: 0.74,
      },
    ],
    hints,
  });
});

// ----------------------------------------------------------------------------
// Mount sous /api/controls (ou CONTROLS_BASE_PATH si défini)
// ----------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

// ----------------------------------------------------------------------------
// Boot — Lignes demandées (NE PAS MODIFIER)
// ----------------------------------------------------------------------------
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
