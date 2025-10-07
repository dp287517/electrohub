/**
 * server_controls.js — ESM (type: module)
 * Routes montées sous /api/controls
 * Aligne strictement les colonnes sur ton schéma Postgres + OPTION CONFORT (seed)
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
// ---------------------------------------------------------------------------
let tsdLibrary;
{
  const mod = await import("./tsd_library.js");
  tsdLibrary = mod.tsdLibrary ?? mod.default?.tsdLibrary ?? mod.default ?? mod;
  if (!tsdLibrary || !Array.isArray(tsdLibrary.categories)) {
    throw new Error("tsd_library.js invalide (attendu: { tsdLibrary: { categories: [...] } }).");
  }
}
const RESULT_OPTIONS =
  tsdLibrary?.meta?.result_options ?? ["Conforme", "Non conforme", "Non applicable"];

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

// Statuts “ouverts” utilisés par l’UI
const OPEN_STATUSES = ["Planned", "Pending", "Overdue"];
const EXISTS_ENTITY_SQL = "EXISTS (SELECT 1 FROM controls_entities ce WHERE ce.id = t.entity_id)";

// ---------------------------------------------------------------------------
// Health + TSD
// ---------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.json({ ok: true, tsd_loaded: !!tsdLibrary, categories: (tsdLibrary.categories || []).length });
});
router.get("/tsd", (_req, res) => {
  res.json({
    meta: tsdLibrary.meta || {},
    categories: (tsdLibrary.categories || []).map((c) => ({ key: c.key, label: c.label, db_table: c.db_table })),
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
    const { rows } = await pool.query("SELECT * FROM controls_entities WHERE id = $1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Entité introuvable" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// TASKS - Liste / Création / Clôture / Historique
//  -> IMPORTANT: SELECT alias: task_name AS label, next_control AS due_date
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q, status, site, category, control, due_from, due_to, entity_id,
    page = 1, page_size = 50, order = "due_date.asc", skip_entity_check = "0"
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (String(skip_entity_check) !== "1") where.push(EXISTS_ENTITY_SQL);

  if (q) { where.push(`(t.task_name ILIKE $${i} OR t.task_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
  if (status) {
    if (status === "open") { where.push(`t.status = ANY ($${i})`); params.push(OPEN_STATUSES); i++; }
    else if (status === "closed") { where.push(`t.status = 'Done'`); }
    else if (status === "overdue") { where.push(`t.status = 'Overdue'`); }
    else { where.push(`t.status = $${i}`); params.push(status); i++; }
  }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }
  if (control) { where.push(`LOWER(t.task_code) = LOWER($${i})`); params.push(control); i++; }
  if (entity_id) { where.push(`t.entity_id = $${i}`); params.push(entity_id); i++; }
  if (due_from) { where.push(`t.next_control >= $${i}`); params.push(due_from); i++; }
  if (due_to) { where.push(`t.next_control <= $${i}`); params.push(due_to); i++; }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [col, dir] = String(order).split(".");
  const orderCol = col === "due_date" ? "next_control" :
    ["task_name","task_code","status","next_control","created_at","updated_at"].includes(col) ? col : "next_control";
  const sortSQL = `ORDER BY t.${orderCol} ${dir?.toUpperCase() === "DESC" ? "DESC" : "ASC"}`;
  const limit = Math.max(1, Math.min(500, Number(page_size)));
  const offset = (Math.max(1, Number(page)) - 1) * limit;

  try {
    const { rows } = await pool.query(
      `SELECT
         t.id, t.site, t.entity_id,
         t.task_name AS label, t.task_code, t.status,
         t.next_control AS due_date,
         t.frequency_months, t.frequency_months_min, t.frequency_months_max,
         t.last_control, t.value_type, t.result_schema,
         t.procedure_md, t.hazards_md, t.ppe_md, t.tools_md,
         t.created_by, t.created_at, t.updated_at
       FROM controls_tasks t
       ${whereSQL}
       ${sortSQL}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json({ items: rows, page: Number(page), page_size: limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/tasks", async (req, res) => {
  const { entity_id, site = null, category_key, category_label, control_type, due_date, payload = {} } = req.body;
  if (!entity_id || !(category_key || category_label) || !control_type) {
    return res.status(400).json({ error: "entity_id, category_key|category_label et control_type sont requis" });
  }
  const category = findCategoryByKeyOrLabel(category_key || category_label);
  if (!category) return res.status(422).json({ error: "Catégorie TSD inconnue" });
  const control = findControlInCategory(category, control_type);
  if (!control) return res.status(422).json({ error: "Type de contrôle inconnu pour cette catégorie" });

  const freqMonths = frequencyMonthsFromLib(control);
  const value_type = control.value_type || "checklist";

  try {
    const created = await withTx(async (client) => {
      const entQ = await client.query(`SELECT id, site FROM controls_entities WHERE id = $1`, [entity_id]);
      if (!entQ.rowCount) {
        return { warning: tsdLibrary.meta?.missing_equipment_note || "Equipement en attente d'intégration au système Electrohub." };
      }
      const entSite = site || entQ.rows[0].site || "Default";
      const nextCtrl = due_date || (freqMonths ? addFrequencyFromMonths(new Date().toISOString(), freqMonths) : null) || dayjs.utc().add(30, "day").toISOString();
      const procedure_md = control.procedure_md || "";
      const hazards_md   = control.hazards_md   || "";
      const ppe_md       = control.ppe_md       || "";
      const tools_md     = control.tools_md     || "";
      const task_name    = `${category.label} – ${control.type}`;
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
        [ id, entSite, entity_id, task_name, control.type, freqMonths, null, nextCtrl,
          value_type, null, procedure_md, hazards_md, ppe_md, tools_md, "system" ]
      );

      await client.query(
        `INSERT INTO controls_history (id, task_id, user, action, site, date, task_name)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6)`,
        [uuidv4(), id, "system", "task_created", entSite, task_name]
      );

      return rows[0];
    });

    res.status(201).json(created);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const { record_status = "done", checklist = [], observations = {}, attachments = [], actor_id = null, closed_at = new Date().toISOString(), comment = "" } = req.body;

  try {
    const outcome = await withTx(async (client) => {
      const { rows: taskRows } = await client.query(
        `SELECT t.*, e.site AS entity_site
         FROM controls_tasks t
         LEFT JOIN controls_entities e ON e.id = t.entity_id
         WHERE t.id = $1`, [id]
      );
      if (!taskRows.length) throw new Error("Tâche introuvable");
      const task = taskRows[0];
      const site = task.site || task.entity_site || "Default";

      const recordId = uuidv4();
      await client.query(
        `INSERT INTO controls_records
          (id, site, task_id, entity_id, performed_at, performed_by, result_status,
           text_value, checklist_result, results, comments, created_at, created_by, task_code, lang)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12,$13,$14)`,
        [ recordId, site, task.id, task.entity_id, closed_at, actor_id || "system", record_status,
          null, JSON.stringify(checklist||[]), JSON.stringify(observations||{}), comment||"",
          actor_id || "system", task.task_code, "fr" ]
      );

      for (const a of attachments) {
        const attId = uuidv4();
        const filename = a.filename || a.name || `file-${attId}`;
        const mimetype = a.mimetype || a.mime || "application/octet-stream";
        const size = a.bytes || a.size || null;
        const dataBuf = a.data && typeof a.data === "string" ? Buffer.from(a.data, "base64") : null;
        await client.query(
          `INSERT INTO controls_attachments
            (id, site, record_id, task_id, entity_id,
             filename, mimetype, size, data, uploaded_at, created_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
          [attId, site, recordId, task.id, task.entity_id, filename, mimetype, size, dataBuf]
        );
      }

      await client.query(
        `UPDATE controls_tasks
           SET status='Done', last_control=$2, updated_at=NOW()
         WHERE id=$1`,
        [task.id, closed_at]
      );

      await client.query(
        `INSERT INTO controls_history (id, task_id, user, action, site, date, task_name, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uuidv4(), task.id, actor_id || "system", "task_closed", site, closed_at, task.task_name, JSON.stringify({ record_id: recordId })]
      );

      let nextDue = null;
      if (task.frequency_months) nextDue = addFrequencyFromMonths(closed_at, task.frequency_months);
      else {
        for (const cat of tsdLibrary.categories || []) {
          const ctrl = findControlInCategory(cat, task.task_code);
          if (ctrl) { nextDue = addFrequency(closed_at, ctrl.frequency || null); break; }
        }
      }

      let nextTask = null;
      if (nextDue) {
        const nextId = uuidv4();
        const { rows: ins } = await client.query(
          `INSERT INTO controls_tasks
            (id, site, entity_id, task_name, task_code, frequency_months,
             last_control, next_control, status, value_type, result_schema,
             procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,'Planned',$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
           RETURNING *`,
          [ nextId, site, task.entity_id, task.task_name, task.task_code, task.frequency_months,
            closed_at, nextDue, task.value_type, task.result_schema, task.procedure_md, task.hazards_md, task.ppe_md, task.tools_md, actor_id || "system" ]
        );

        await client.query(
          `INSERT INTO controls_history (id, task_id, user, action, site, date, task_name, meta)
           VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7)`,
          [uuidv4(), nextId, "system", "task_created", site, task.task_name, JSON.stringify({ reason: "auto_reschedule", from_task_id: task.id })]
        );
        nextTask = ins[0];
      }

      return { task_closed: task.id, record_id: recordId, next_task: nextTask ? { id: nextTask.id, label: nextTask.task_name, due_date: nextTask.next_control, status: nextTask.status } : null };
    });

    res.json(outcome);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/tasks/:id/history", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM controls_history WHERE task_id = $1 ORDER BY date DESC, id DESC`, [id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/tasks/:id/attachments", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const { originalname, mimetype, size, buffer } = req.file || {};
  if (!buffer) return res.status(400).json({ error: "Aucun fichier reçu" });
  try {
    const { rows: t } = await pool.query(`SELECT id, entity_id, site FROM controls_tasks WHERE id = $1`, [id]);
    if (!t.length) return res.status(404).json({ error: "Tâche introuvable" });
    const site = t[0].site || "Default";
    await pool.query(
      `INSERT INTO controls_attachments
        (id, site, record_id, task_id, entity_id,
         filename, mimetype, size, data, uploaded_at, created_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
      [uuidv4(), site, null, id, t[0].entity_id, originalname, mimetype, size, buffer]
    );
    res.json({ ok: true, filename: originalname, mimetype, size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// OPTION DE CONFORT : SEED
// - GET  /bootstrap/seed?dry_run=1&category=LV_SWITCHBOARD&site=MySite
//   -> crée (ou présente en dry_run) des tâches “Planned” pour chaque entité valide,
//      en utilisant toutes les controls de la catégorie choisie (par défaut LV_SWITCHBOARD).
// - POST /bootstrap/seed-one { entity_id, category_key|label, control_type, due_date? }
// ---------------------------------------------------------------------------
async function pickCategoryForEntity(entityRow, explicitCategoryKeyOrLabel) {
  if (explicitCategoryKeyOrLabel) return findCategoryByKeyOrLabel(explicitCategoryKeyOrLabel);
  // Heuristique douce: si l'entité a un champ type/categorie/equipment, essaie de matcher
  const candidates = ["category_key","category","equipment_type","type","kind","class"];
  for (const c of candidates) {
    if (entityRow && entityRow[c]) {
      const cat = findCategoryByKeyOrLabel(String(entityRow[c]));
      if (cat) return cat;
    }
  }
  // défaut très safe : LV_SWITCHBOARD si existant, sinon première catégorie
  return findCategoryByKeyOrLabel("LV_SWITCHBOARD") || tsdLibrary.categories[0];
}

router.get("/bootstrap/seed", async (req, res) => {
  const dry = String(req.query.dry_run || "1") === "1";
  const categoryParam = req.query.category || null;
  const siteFilter = req.query.site || null;

  try {
    const report = await withTx(async (client) => {
      const ents = await client.query(
        siteFilter ? `SELECT * FROM controls_entities WHERE site = $1` : `SELECT * FROM controls_entities`,
        siteFilter ? [siteFilter] : []
      );

      const actions = [];
      for (const e of ents.rows) {
        const category = await pickCategoryForEntity(e, categoryParam);
        if (!category) continue;

        for (const ctrl of category.controls || []) {
          // Existe-t-il déjà une tâche active (Planned/Pending/Overdue) pour (site, entity_id, task_code) ?
          const exists = await client.query(
            `SELECT 1 FROM controls_tasks
             WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
            [e.id, ctrl.type]
          );
          if (exists.rowCount) {
            actions.push({ entity_id: e.id, task_code: ctrl.type, action: "skipped_exists" });
            continue;
          }

          const freqMonths = frequencyMonthsFromLib(ctrl);
          const nextCtrl =
            (freqMonths ? addFrequencyFromMonths(new Date().toISOString(), freqMonths) : null) ||
            dayjs.utc().add(30, "day").toISOString();

          const task_name = `${category.label} – ${ctrl.type}`;
          const payload = {
            site: e.site || "Default",
            entity_id: e.id,
            task_name,
            task_code: ctrl.type,
            frequency_months: freqMonths,
            next_control: nextCtrl,
            value_type: ctrl.value_type || "checklist",
            procedure_md: ctrl.procedure_md || "",
            hazards_md: ctrl.hazards_md || "",
            ppe_md: ctrl.ppe_md || "",
            tools_md: ctrl.tools_md || "",
          };

          actions.push({ entity_id: e.id, task_code: ctrl.type, action: dry ? "would_create" : "created" });

          if (!dry) {
            await client.query(
              `INSERT INTO controls_tasks
                (id, site, entity_id, task_name, task_code, frequency_months,
                 last_control, next_control, status, value_type, result_schema,
                 procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
               VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,'Planned',$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
              [
                uuidv4(), payload.site, payload.entity_id, payload.task_name, payload.task_code,
                payload.frequency_months, null, payload.next_control,
                payload.value_type, null, payload.procedure_md, payload.hazards_md,
                payload.ppe_md, payload.tools_md, "seed"
              ]
            );
          }
        }
      }
      return { count_entities: ents.rowCount, actions };
    });

    res.json({ ok: true, dry_run: dry, ...report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/bootstrap/seed-one", async (req, res) => {
  const { entity_id, category_key, category_label, control_type, due_date } = req.body || {};
  if (!entity_id || !(category_key || category_label) || !control_type) {
    return res.status(400).json({ error: "entity_id, category_key|category_label et control_type sont requis" });
  }
  try {
    const created = await withTx(async (client) => {
      const entQ = await client.query(`SELECT id, site FROM controls_entities WHERE id=$1`, [entity_id]);
      if (!entQ.rowCount) throw new Error("Entité introuvable");
      const site = entQ.rows[0].site || "Default";

      const category = findCategoryByKeyOrLabel(category_key || category_label);
      if (!category) throw new Error("Catégorie TSD inconnue");
      const ctrl = findControlInCategory(category, control_type);
      if (!ctrl) throw new Error("Type de contrôle inconnu");

      const activeExists = await client.query(
        `SELECT 1 FROM controls_tasks WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
        [entity_id, ctrl.type]
      );
      if (activeExists.rowCount) return { skipped: true, reason: "already_exists" };

      const nextCtrl = due_date ||
        (frequencyMonthsFromLib(ctrl) ? addFrequencyFromMonths(new Date().toISOString(), frequencyMonthsFromLib(ctrl)) : null) ||
        dayjs.utc().add(30, "day").toISOString();

      const id = uuidv4();
      await client.query(
        `INSERT INTO controls_tasks
          (id, site, entity_id, task_name, task_code, frequency_months,
           last_control, next_control, status, value_type, result_schema,
           procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,'Planned',$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
        [
          id, site, entity_id,
          `${category.label} – ${ctrl.type}`, ctrl.type, frequencyMonthsFromLib(ctrl),
          null, nextCtrl, ctrl.value_type || "checklist", null,
          ctrl.procedure_md || "", ctrl.hazards_md || "", ctrl.ppe_md || "", ctrl.tools_md || "",
          "seed-one"
        ]
      );
      return { created: true, id };
    });

    res.json({ ok: true, ...created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Calendar (groupé par jour) — alias next_control -> due_date
// ---------------------------------------------------------------------------
router.get("/calendar", async (req, res) => {
  const { from, to, site, control, skip_entity_check = "0" } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (String(skip_entity_check) !== "1") where.push(EXISTS_ENTITY_SQL);
  if (from) { where.push(`t.next_control >= $${i}`); params.push(from); i++; }
  if (to)   { where.push(`t.next_control <= $${i}`); params.push(to); i++; }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }
  if (control) { where.push(`LOWER(t.task_code) = LOWER($${i})`); params.push(control); i++; }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.task_name AS label, t.status, t.next_control AS due_date,
              t.task_code, t.entity_id, t.site
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// IA (stub)
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
// Mount + Boot
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
