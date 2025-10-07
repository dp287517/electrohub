/**
 * server_controls.js — ESM (type: module)
 * Routes montées sous /api/controls
 * Aligne strictement les colonnes sur ton schéma Postgres.
 *
 * Prérequis:
 *   npm i express pg multer dayjs uuid
 *
 * Variables d'env:
 *   DATABASE_URL=postgres://...
 *   CONTROLS_BASE_PATH=/api/controls  (optionnel, défaut /api/controls)
 *   CONTROLS_PORT=3011                (optionnel, défaut 3011)
 */

import express from "express";
import multer from "multer";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { v4 as uuidv4 } from "uuid";

dayjs.extend(utc);

// ---------------------------------------------------------------------------
// DB Pool (Neon / Postgres)
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------------
// Charger la librairie TSD (ESM)
//   - Supporte export nommé { tsdLibrary } ou export default { tsdLibrary: ... }
//   - Ou export default directement l'objet library
// ---------------------------------------------------------------------------
let tsdLibrary;
{
  const mod = await import("./tsd_library.js");
  tsdLibrary =
    mod.tsdLibrary ??
    mod.default?.tsdLibrary ??
    mod.default ??
    mod;

  if (!tsdLibrary || !Array.isArray(tsdLibrary.categories)) {
    throw new Error(
      "tsd_library.js n'expose pas un objet valide (attendu: { tsdLibrary: { categories: [...] } })."
    );
  }
}
const RESULT_OPTIONS =
  tsdLibrary?.meta?.result_options ?? [
    "Conforme",
    "Non conforme",
    "Non applicable",
  ];

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

function addFrequencyFromMonths(baseISO, months = null) {
  if (!months || isNaN(Number(months))) return null;
  return dayjs.utc(baseISO).add(Number(months), "month").toISOString();
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

function frequencyMonthsFromLib(control) {
  if (!control?.frequency) return null;
  const u = String(control.frequency.unit || "").toLowerCase();
  if (u === "month" || u === "months") return Number(control.frequency.interval || 0);
  if (u === "year" || u === "years") return Number(control.frequency.interval || 0) * 12;
  if (u === "week" || u === "weeks") return Math.round(Number(control.frequency.interval || 0) / 4);
  if (u === "day" || u === "days") return Math.round(Number(control.frequency.interval || 0) / 30);
  return null;
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

// ---------------------------------------------------------------------------
// App + Router (monté sous /api/controls)
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const router = express.Router();

// Statuts dans ta base : text libre; défaut 'Planned'. On mappe:
// - frontend "open"   -> ('Planned','Pending','Overdue')
// - frontend "closed" -> 'Done'
// - frontend "overdue"-> 'Overdue'
const OPEN_STATUSES = ["Planned", "Pending", "Overdue"];

// Petit helper pour s'assurer que la tâche référence toujours une entité existante
const EXISTS_ENTITY_SQL =
  "EXISTS (SELECT 1 FROM controls_entities ce WHERE ce.id = t.entity_id)";

// ---------------------------------------------------------------------------
// Health + TSD
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Entities (helper simple)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// TASKS - Liste / Création / Clôture / Historique
//  -> IMPORTANT: on SELECT t.task_name AS label, t.next_control AS due_date
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q,
    status,
    site,
    category,       // n'est pas stocké dans la table, mais on laisse le param pour futures évolutions
    control,
    due_from,
    due_to,
    entity_id,
    page = 1,
    page_size = 50,
    order = "due_date.asc", // alias sur next_control
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  where.push(EXISTS_ENTITY_SQL);

  if (q) {
    where.push(`(t.task_name ILIKE $${i} OR t.task_code ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }

  if (status) {
    if (status === "open") {
      where.push(`t.status = ANY ($${i})`);
      params.push(OPEN_STATUSES);
      i++;
    } else if (status === "closed") {
      where.push(`t.status = 'Done'`);
    } else if (status === "overdue") {
      where.push(`t.status = 'Overdue'`);
    } else {
      // statut brut si besoin
      where.push(`t.status = $${i}`);
      params.push(status);
      i++;
    }
  }

  if (site) {
    where.push(`t.site = $${i}`);
    params.push(site);
    i++;
  }

  if (control) {
    where.push(`LOWER(t.task_code) = LOWER($${i})`);
    params.push(control);
    i++;
  }

  if (entity_id) {
    where.push(`t.entity_id = $${i}`);
    params.push(entity_id);
    i++;
  }

  if (due_from) {
    where.push(`t.next_control >= $${i}`);
    params.push(due_from);
    i++;
  }
  if (due_to) {
    where.push(`t.next_control <= $${i}`);
    params.push(due_to);
    i++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [col, dir] = String(order).split(".");
  // protège l'ORDER BY
  const orderCol =
    col === "due_date" ? "next_control" :
    ["task_name", "task_code", "status", "next_control", "created_at", "updated_at"].includes(col)
      ? col
      : "next_control";
  const sortSQL = `ORDER BY t.${orderCol} ${dir?.toUpperCase() === "DESC" ? "DESC" : "ASC"}`;
  const limit = Math.max(1, Math.min(500, Number(page_size)));
  const offset = (Math.max(1, Number(page)) - 1) * limit;

  try {
    const { rows } = await pool.query(
      `SELECT
         t.id,
         t.site,
         t.entity_id,
         t.task_name AS label,
         t.task_code,
         t.status,
         t.next_control AS due_date,
         t.frequency_months,
         t.frequency_months_min,
         t.frequency_months_max,
         t.last_control,
         t.value_type,
         t.result_schema,
         t.procedure_md,
         t.hazards_md,
         t.ppe_md,
         t.tools_md,
         t.created_by,
         t.created_at,
         t.updated_at
       FROM controls_tasks t
       ${whereSQL}
       ${sortSQL}
       LIMIT ${limit} OFFSET ${offset}`,
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
    site = null,           // si null, on va le déduire de l'entité
    category_key,
    category_label,
    control_type,          // = task_code
    due_date,              // alias voulu -> sera stocké en next_control
    payload = {},          // ignoré en DB (pas de colonne dédiée), conservé pour futures évolutions
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

  const freqMonths = frequencyMonthsFromLib(control);
  const value_type = control.value_type || "checklist";

  try {
    const created = await withTx(async (client) => {
      // Vérifie que l'entité existe
      const entQ = await client.query(
        `SELECT id, site FROM controls_entities WHERE id = $1`,
        [entity_id]
      );
      if (!entQ.rowCount) {
        return {
          warning:
            category.fallback_note_if_missing ||
            tsdLibrary.meta?.missing_equipment_note ||
            "Equipement en attente d'intégration au système Electrohub.",
        };
      }
      const entSite = site || entQ.rows[0].site || "Default";

      const nextCtrl =
        due_date ||
        (freqMonths ? addFrequencyFromMonths(new Date().toISOString(), freqMonths) : null) ||
        dayjs.utc().add(30, "day").toISOString();

      // Prépare les textes (procédure / hazards / ppe / tools) d’après la lib si présents
      const procedure_md = control.procedure_md || "";
      const hazards_md   = control.hazards_md   || "";
      const ppe_md       = control.ppe_md       || "";
      const tools_md     = control.tools_md     || "";

      const task_name = `${category.label} – ${control.type}`;
      const id = uuidv4();

      const { rows } = await client.query(
        `INSERT INTO controls_tasks
          (id, site, entity_id, task_name, task_code, frequency_months,
           last_control, next_control, status, value_type, result_schema,
           procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,
           $7,$8,'Planned',$9,$10,
           $11,$12,$13,$14,$15,NOW(),NOW())
         RETURNING *`,
        [
          id,
          entSite,
          entity_id,
          task_name,
          control.type,
          freqMonths,
          null,
          nextCtrl,
          value_type,
          null,           // result_schema (optionnel)
          procedure_md,
          hazards_md,
          ppe_md,
          tools_md,
          "system",
        ]
      );

      // Historique minimal
      await client.query(
        `INSERT INTO controls_history (id, task_id, user, action, site, date, task_name)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6)`,
        [uuidv4(), id, "system", "task_created", entSite, task_name]
      );

      return rows[0];
    });

    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const {
    record_status = "done",
    checklist = [],              // si tu veux, on pourra mapper vers checklist_result
    observations = {},           // sera stocké dans results/comments
    attachments = [],            // [{ filename, mime/mimetype, bytes, data(base64)? }]
    actor_id = null,
    closed_at = new Date().toISOString(),
    comment = "",                // commentaire libre
  } = req.body;

  try {
    const outcome = await withTx(async (client) => {
      // 1) Récupère la tâche + entité (pour site)
      const { rows: taskRows } = await client.query(
        `SELECT t.*, e.site AS entity_site
         FROM controls_tasks t
         LEFT JOIN controls_entities e ON e.id = t.entity_id
         WHERE t.id = $1`,
        [id]
      );
      if (!taskRows.length) throw new Error("Tâche introuvable");
      const task = taskRows[0];
      const site = task.site || task.entity_site || "Default";

      // 2) Enregistre un record (adapter aux colonnes de controls_records)
      const recordId = uuidv4();
      await client.query(
        `INSERT INTO controls_records
          (id, site, task_id, entity_id, performed_at, performed_by, result_status,
           text_value, checklist_result, results, comments, created_at, created_by, task_code, lang)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,
           $8,$9,$10,$11,NOW(),$12,$13,$14)`,
        [
          recordId,
          site,
          task.id,
          task.entity_id,
          closed_at,
          actor_id || "system",
          record_status,
          null,                    // text_value
          JSON.stringify(checklist || []),  // checklist_result
          JSON.stringify(observations || {}), // results (jsonb)
          comment || "",
          actor_id || "system",
          task.task_code,
          "fr",
        ]
      );

      // 3) Pièces jointes (métadonnées + data optionnelle)
      for (const a of attachments) {
        const attId = uuidv4();
        const filename = a.filename || a.name || `file-${attId}`;
        const mimetype = a.mimetype || a.mime || "application/octet-stream";
        const size = a.bytes || a.size || null;
        const dataBuf =
          a.data && typeof a.data === "string"
            ? Buffer.from(a.data, "base64")
            : null;

        await client.query(
          `INSERT INTO controls_attachments
            (id, site, record_id, task_id, entity_id,
             filename, mimetype, size, data, uploaded_at, created_at)
           VALUES
            ($1,$2,$3,$4,$5,
             $6,$7,$8,$9,NOW(),NOW())`,
          [attId, site, recordId, task.id, task.entity_id, filename, mimetype, size, dataBuf]
        );
      }

      // 4) Clôture de la tâche (status -> Done, last_control, updated_at)
      await client.query(
        `UPDATE controls_tasks
           SET status='Done',
               last_control = $2,
               updated_at = NOW()
         WHERE id = $1`,
        [task.id, closed_at]
      );

      await client.query(
        `INSERT INTO controls_history (id, task_id, user, action, site, date, task_name, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          uuidv4(),
          task.id,
          actor_id || "system",
          "task_closed",
          site,
          closed_at,
          task.task_name,
          JSON.stringify({ record_id: recordId }),
        ]
      );

      // 5) Auto-rééchelonnement
      //    d’abord: priorité aux mois stockés (frequency_months), sinon depuis la lib
      let nextDue = null;
      if (task.frequency_months) {
        nextDue = addFrequencyFromMonths(closed_at, task.frequency_months);
      } else {
        // essai via librairie
        // (on n'a pas category_key/label en base, on essaie via task_code uniquement)
        let libNext = null;
        for (const cat of tsdLibrary.categories || []) {
          const ctrl = findControlInCategory(cat, task.task_code);
          if (ctrl) {
            libNext = addFrequency(closed_at, ctrl.frequency || null);
            break;
          }
        }
        nextDue = libNext;
      }

      let nextTask = null;
      if (nextDue) {
        // Respect de la contrainte unique ux_controls_tasks_active:
        // on crée une nouvelle tâche 'Planned' avec le même (site, entity_id, task_code)
        const nextId = uuidv4();
        const { rows: ins } = await client.query(
          `INSERT INTO controls_tasks
            (id, site, entity_id, task_name, task_code, frequency_months,
             last_control, next_control, status, value_type, result_schema,
             procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,
             $7,$8,'Planned',$9,$10,
             $11,$12,$13,$14,$15,NOW(),NOW())
           RETURNING *`,
          [
            nextId,
            site,
            task.entity_id,
            task.task_name,
            task.task_code,
            task.frequency_months,
            closed_at,
            nextDue,
            task.value_type,
            task.result_schema,
            task.procedure_md,
            task.hazards_md,
            task.ppe_md,
            task.tools_md,
            actor_id || "system",
          ]
        );

        await client.query(
          `INSERT INTO controls_history (id, task_id, user, action, site, date, task_name, meta)
           VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7)`,
          [
            uuidv4(),
            nextId,
            "system",
            "task_created",
            site,
            task.task_name,
            JSON.stringify({ reason: "auto_reschedule", from_task_id: task.id }),
          ]
        );

        nextTask = ins[0];
      }

      return {
        task_closed: task.id,
        record_id: recordId,
        next_task: nextTask
          ? {
              id: nextTask.id,
              label: nextTask.task_name,
              due_date: nextTask.next_control,
              status: nextTask.status,
            }
          : null,
      };
    });

    res.json(outcome);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Historique par tâche (colonne/ordre conformes)
router.get("/tasks/:id/history", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM controls_history WHERE task_id = $1 ORDER BY date DESC, id DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Attachments (upload binaire -> columns réelles filename/mimetype/size/data)
// ---------------------------------------------------------------------------
router.post(
  "/tasks/:id/attachments",
  upload.single("file"),
  async (req, res) => {
    const { id } = req.params;
    const { originalname, mimetype, size, buffer } = req.file || {};
    if (!buffer) return res.status(400).json({ error: "Aucun fichier reçu" });

    try {
      const { rows: t } = await pool.query(
        `SELECT id, entity_id, site FROM controls_tasks WHERE id = $1`,
        [id]
      );
      if (!t.length) return res.status(404).json({ error: "Tâche introuvable" });
      const site = t[0].site || "Default";

      await pool.query(
        `INSERT INTO controls_attachments
          (id, site, record_id, task_id, entity_id,
           filename, mimetype, size, data, uploaded_at, created_at)
         VALUES
          ($1,$2,$3,$4,$5,
           $6,$7,$8,$9,NOW(),NOW())`,
        [uuidv4(), site, null, id, t[0].entity_id, originalname, mimetype, size, buffer]
      );

      res.json({ ok: true, filename: originalname, mimetype, size });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ---------------------------------------------------------------------------
// Calendar (groupé par jour) — alias next_control -> due_date
// ---------------------------------------------------------------------------
router.get("/calendar", async (req, res) => {
  const { from, to, site, control } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  where.push(EXISTS_ENTITY_SQL);

  if (from) {
    where.push(`t.next_control >= $${i}`);
    params.push(from);
    i++;
  }
  if (to) {
    where.push(`t.next_control <= $${i}`);
    params.push(to);
    i++;
  }
  if (site) {
    where.push(`t.site = $${i}`);
    params.push(site);
    i++;
  }
  if (control) {
    where.push(`LOWER(t.task_code) = LOWER($${i})`);
    params.push(control);
    i++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT
         t.id,
         t.task_name AS label,
         t.status,
         t.next_control AS due_date,
         t.task_code,
         t.entity_id,
         t.site
       FROM controls_tasks t
       ${whereSQL}
       ORDER BY t.next_control ASC NULLS LAST`,
      params
    );

    const groups = rows.reduce((acc, r) => {
      if (!r.due_date) return acc;
      const k = dayjs.utc(r.due_date).format("YYYY-MM-DD");
      (acc[k] = acc[k] || []).push(r);
      return acc;
    }, {});

    res.json(groups);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// IA (stubs) — remplace ces endpoints si besoin
// ---------------------------------------------------------------------------
router.post("/ai/analyze-before", async (req, res) => {
  const { image_url, hints = [] } = req.body || {};
  if (!image_url) return res.status(400).json({ error: "image_url requis" });
  res.json({
    ok: true,
    findings: [
      { type: "safety", message: "Vérifier EPI: gants, visière, balisage", confidence: 0.82 },
      { type: "housekeeping", message: "Objets combustibles à proximité du TGBT", confidence: 0.74 },
    ],
    hints,
  });
});

// ---------------------------------------------------------------------------
// Mount sous /api/controls (ou CONTROLS_BASE_PATH si défini)
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

// ---------------------------------------------------------------------------
// Boot — LIGNES DEMANDÉES (NE PAS MODIFIER)
// ---------------------------------------------------------------------------
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
