/**
 * server_controls.js — ESM (type: module)
 * API Controls (TSD) — Hiérarchie équipements + filtres + pièces jointes + Gantt coloré
 *
 * Monté sous: /api/controls
 *
 * Nouveaux endpoints clés:
 *   GET  /api/controls/hierarchy/tree
 *   GET  /api/controls/filters
 *   GET  /api/controls/tasks/:id/schema        (labels checklist propres depuis TSD)
 *   GET  /api/controls/tasks/:id/attachments   (liste)
 *   GET  /api/controls/attachments/:id         (download binaire)
 *   POST /api/controls/tasks/:id/attachments   (upload, inchangé)
 *
 * Déjà existants (inchangés, mais enrichis selon besoins):
 *   GET  /api/controls/tasks?…   (filtres étendus)
 *   GET  /api/controls/calendar  (ajoute color)
 *   PATCH /api/controls/tasks/:id/close (replanif TSD)
 *   GET  /api/controls/bootstrap/seed?category=ALL (toutes catégories)
 *
 * Prérequis:
 *   npm i express pg multer dayjs uuid
 *
 * ENV:
 *   DATABASE_URL=postgres://...
 *   CONTROLS_BASE_PATH=/api/controls
 *   CONTROLS_PORT=3011
 */

import express from "express";
import multer from "multer";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { v4 as uuidv4 } from "uuid";

dayjs.extend(utc);

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------------
// Charger TSD
// ---------------------------------------------------------------------------
let tsdLibrary;
{
  const mod = await import("./tsd_library.js");
  tsdLibrary = mod.tsdLibrary ?? mod.default?.tsdLibrary ?? mod.default ?? mod;
  if (!tsdLibrary || !Array.isArray(tsdLibrary.categories)) {
    throw new Error("tsd_library.js invalide: attendu { tsdLibrary: { categories:[...] } }");
  }
}
const RESULT_OPTIONS = tsdLibrary?.meta?.result_options ?? [
  "Conforme",
  "Non conforme",
  "Non applicable",
];

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });
const OPEN_STATUSES = ["Planned", "Pending", "Overdue"];
const EXISTS_ENTITY_SQL =
  "EXISTS (SELECT 1 FROM controls_entities ce WHERE ce.id = t.entity_id)";

function addMonths(baseISO, months) {
  return dayjs.utc(baseISO).add(Number(months), "month").toISOString();
}
function addByFreq(baseISO, frequency) {
  if (!frequency) return null;
  const { interval, unit, min, max } = frequency;
  if (min && min.interval && min.unit) return dayjs.utc(baseISO).add(min.interval, min.unit).toISOString();
  if (interval && unit) return dayjs.utc(baseISO).add(interval, unit).toISOString();
  return null;
}
function monthsFromFreq(freq) {
  if (!freq) return null;
  if (freq.min && freq.min.interval && freq.min.unit) return unitToMonths(freq.min.interval, freq.min.unit);
  if (freq.interval && freq.unit) return unitToMonths(freq.interval, freq.unit);
  return null;
}
function unitToMonths(interval, unit) {
  const u = String(unit || "").toLowerCase();
  if (u.startsWith("year")) return Number(interval) * 12;
  if (u.startsWith("month")) return Number(interval);
  if (u.startsWith("week")) return Math.round(Number(interval) / 4);
  if (u.startsWith("day")) return Math.round(Number(interval) / 30);
  return null;
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
function findControlInCategory(category, controlTypeOrCode) {
  if (!category) return null;
  const low = String(controlTypeOrCode || "").toLowerCase();
  return (category.controls || []).find(
    (t) => t.type && String(t.type).toLowerCase() === low
  );
}
/** Essaie de retrouver la définition TSD d’une tâche (par code puis par libellé) */
function resolveTsdForTask(task) {
  const codeLow = String(task.task_code || "").toLowerCase();
  const nameLow = String(task.task_name || "").toLowerCase();
  for (const cat of tsdLibrary.categories || []) {
    for (const ctrl of cat.controls || []) {
      const ctrlLow = String(ctrl.type || "").toLowerCase();
      if (ctrlLow === codeLow || nameLow.includes(ctrlLow)) {
        return { category: cat, control: ctrl };
      }
    }
  }
  return { category: null, control: null };
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

// ---------- introspection colonnes ----------
async function getColumnsMeta(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name, column_default
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const meta = {};
  for (const r of rows) meta[r.column_name] = r;
  return meta;
}
function isUuidColumn(colMeta) {
  return colMeta && (colMeta.udt_name === "uuid" || colMeta.data_type === "uuid");
}
function pruneValuesByExistingColumns(values, columnsMeta) {
  const out = {};
  for (const k of Object.keys(values)) {
    if (columnsMeta[k] !== undefined) out[k] = values[k];
  }
  return out;
}
function buildInsertSQL(table, values) {
  const cols = Object.keys(values);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  return {
    sql: `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`,
    params: cols.map((c) => values[c]),
  };
}
async function insertRow(client, table, values) {
  const meta = await getColumnsMeta(client, table);
  const v = { ...values };
  if (meta.id && isUuidColumn(meta.id)) v.id = v.id || uuidv4();
  const pruned = pruneValuesByExistingColumns(v, meta);
  const { sql, params } = buildInsertSQL(table, pruned);
  const { rows } = await client.query(sql, params);
  return rows[0];
}

// ---------------------------------------------------------------------------
// App + Router
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
const router = express.Router();

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
// Entities + bootstrap minimum
// ---------------------------------------------------------------------------
async function ensureAtLeastOneEntity(client) {
  const cur = await client.query(`SELECT * FROM controls_entities LIMIT 1`);
  if (cur.rowCount) return { ensured: false, entity: cur.rows[0] };
  const now = new Date().toISOString();
  const ent = await insertRow(client, "controls_entities", {
    site: "Default",
    name: "Generic Entity",
    label: "Generic Entity",
    created_at: now,
    updated_at: now,
    active: true,
  });
  return { ensured: true, entity: ent };
}
router.get("/bootstrap/ensure-entity", async (_req, res) => {
  try {
    const out = await withTx(async (client) => ensureAtLeastOneEntity(client));
    res.json({ ok: true, ensured: out.ensured, entity_id: out.entity.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post("/bootstrap/create-entity", async (req, res) => {
  const body = req.body || {};
  try {
    const created = await withTx(async (client) => {
      const now = new Date().toISOString();
      const ent = await insertRow(client, "controls_entities", {
        site: body.site ?? "Default",
        name: body.name ?? body.label ?? "Generic Entity",
        label: body.label ?? body.name ?? "Generic Entity",
        // facultatifs si colonnes présentes (pour lier à l'équipement d'origine)
        equipment_table: body.equipment_table ?? null,
        equipment_id: body.equipment_id ?? null,
        atex_zone: body.atex_zone ?? null,
        parent_switchboard_id: body.parent_switchboard_id ?? null,
        site_id: body.site_id ?? null,
        created_at: now,
        updated_at: now,
        active: true,
      });
      return ent;
    });
    res.status(201).json({ ok: true, id: created.id, row: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// TASKS: liste étendue (filtres), schéma, pièces jointes
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q,
    status,
    site,
    building,        // (string | id) -> mappe sur table sites si dispo
    category_key,    // filtre catégorie TSD
    control,         // task_code exact
    atex_zone,       // filtre zone ATEX
    entity_id,
    due_from,
    due_to,
    page = 1,
    page_size = 50,
    order = "due_date.asc",
    skip_entity_check = "0",
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (String(skip_entity_check) !== "1") where.push(EXISTS_ENTITY_SQL);
  if (q) { where.push(`(t.task_name ILIKE $${i} OR t.task_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
  if (status) {
    if (status === "open") { where.push(`t.status = ANY ($${i})`); params.push(OPEN_STATUSES); i++; }
    else if (status === "closed") where.push(`t.status = 'Done'`);
    else if (status === "overdue") where.push(`t.status = 'Overdue'`);
    else { where.push(`t.status = $${i}`); params.push(status); i++; }
  }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }
  if (entity_id) { where.push(`t.entity_id = $${i}`); params.push(entity_id); i++; }
  if (control) { where.push(`LOWER(t.task_code) = LOWER($${i})`); params.push(control); i++; }
  if (due_from) { where.push(`t.next_control >= $${i}`); params.push(due_from); i++; }
  if (due_to) { where.push(`t.next_control <= $${i}`); params.push(due_to); i++; }

  // filtres “hiérarchie” via controls_entities si colonnes existent
  if (building) {
    where.push(`t.entity_id IN (SELECT id FROM controls_entities WHERE site = $${i} OR site_id::text = $${i} OR label ILIKE $${i})`);
    params.push(String(building));
    i++;
  }
  if (atex_zone) {
    where.push(`t.entity_id IN (SELECT id FROM controls_entities WHERE atex_zone::text = $${i})`);
    params.push(String(atex_zone));
    i++;
  }
  if (category_key) {
    // on filtre par nom de catégorie TSD dans le libellé de la tâche
    where.push(`t.task_name ILIKE $${i}`);
    params.push(`%${category_key.replace(/_/g," ").split("-").join(" ")}%`);
    i++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [col, dir] = String(order).split(".");
  const orderCol =
    col === "due_date"
      ? "next_control"
      : ["task_name","task_code","status","next_control","created_at","updated_at"].includes(col) ? col : "next_control";
  const sortSQL = `ORDER BY t.${orderCol} ${dir?.toUpperCase() === "DESC" ? "DESC" : "ASC"}`;
  const limit = Math.max(1, Math.min(1000, Number(page_size)));
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** schéma riche (labels checklist “propres”) */
router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Tâche introuvable" });
    const task = rows[0];
    const { category, control } = resolveTsdForTask(task);

    // nettoyer checklist: toujours essayer de fournir un "label" lisible
    const checklist = (control?.checklist || []).map((it, idx) => {
      const key = it.key ?? it.id ?? `i_${idx}`;
      const label = it.label || it.text || (typeof key === "string" ? key.replace(/^i_/, "Item ") : `Item ${idx+1}`);
      return { ...it, key, label };
    });

    res.json({
      task_id: task.id,
      label: task.task_name,
      task_code: task.task_code,
      frequency: control?.frequency || null,
      checklist,
      observations: control?.observations || [],
      procedure_md: control?.procedure_md || task.procedure_md || "",
      hazards_md: control?.hazards_md || task.hazards_md || "",
      ppe_md: control?.ppe_md || task.ppe_md || "",
      tools_md: control?.tools_md || task.tools_md || "",
      tsd_category: category ? { key: category.key, label: category.label } : null,
      // tags pour le Gantt/couleurs, utiles côté front
      ui: {
        category_key: category?.key || null,
        color: colorForCategory(category?.key, task.task_code),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// pièces jointes — LISTE
router.get("/tasks/:id/attachments", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, mimetype, size, uploaded_at, created_at
       FROM controls_attachments
       WHERE task_id = $1
       ORDER BY uploaded_at DESC NULLS LAST, created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// téléchargement binaire
router.get("/attachments/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT filename, mimetype, data FROM controls_attachments WHERE id=$1`,
      [id]
    );
    if (!rows.length) return res.status(404).send("Not found");
    const a = rows[0];
    res.setHeader("Content-Type", a.mimetype || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${a.filename || "file"}"`);
    res.send(a.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// upload (inchangé)
router.post("/tasks/:id/attachments", upload.single("file"), async (req, res) => {
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
    const row = await insertRow(pool, "controls_attachments", {
      site,
      record_id: null,
      task_id: id,
      entity_id: t[0].entity_id,
      filename: originalname,
      mimetype,
      size,
      data: buffer,
      uploaded_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    res.json({ ok: true, id: row.id, filename: originalname, mimetype, size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Clôture + replanif (inchangé dans l'esprit : applique fréquence TSD à closed_at)
// ---------------------------------------------------------------------------
router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const {
    record_status = "done",
    checklist = [],
    observations = {},
    attachments = [],
    actor_id = null,
    closed_at = new Date().toISOString(),
    comment = "",
  } = req.body;

  try {
    const outcome = await withTx(async (client) => {
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

      // record
      await insertRow(client, "controls_records", {
        site,
        task_id: task.id,
        entity_id: task.entity_id,
        performed_at: closed_at,
        performed_by: actor_id || "system",
        result_status: record_status,
        text_value: null,
        checklist_result: JSON.stringify(checklist || []),
        results: JSON.stringify(observations || {}),
        comments: comment || "",
        created_at: new Date().toISOString(),
        created_by: actor_id || "system",
        task_code: task.task_code,
        lang: "fr",
      });

      for (const a of attachments) {
        const filename = a.filename || a.name || `file-${Date.now()}`;
        const mimetype = a.mimetype || a.mime || "application/octet-stream";
        const size = a.bytes || a.size || null;
        const dataBuf =
          a.data && typeof a.data === "string" ? Buffer.from(a.data, "base64") : null;
        await insertRow(client, "controls_attachments", {
          site,
          record_id: null,
          task_id: task.id,
          entity_id: task.entity_id,
          filename,
          mimetype,
          size,
          data: dataBuf,
          uploaded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      }

      await pool.query(
        `UPDATE controls_tasks
           SET status='Done', last_control=$2, updated_at=NOW()
         WHERE id=$1`,
        [task.id, closed_at]
      );

      await insertRow(client, "controls_history", {
        task_id: task.id,
        user: actor_id || "system",
        action: "task_closed",
        site,
        date: closed_at,
        task_name: task.task_name,
        meta: JSON.stringify({}),
      });

      // Replanif solide
      const { control } = resolveTsdForTask(task);
      const months =
        (task.frequency_months && Number(task.frequency_months)) ||
        monthsFromFreq(control?.frequency) ||
        null;

      const nextDue =
        (months ? addMonths(closed_at, months) : addByFreq(closed_at, control?.frequency)) ||
        dayjs.utc(closed_at).add(6, "month").toISOString();

      const nextTask = await insertRow(client, "controls_tasks", {
        site,
        entity_id: task.entity_id,
        task_name: task.task_name,
        task_code: task.task_code,
        frequency_months: months,
        last_control: closed_at,
        next_control: nextDue,
        status: "Planned",
        value_type: task.value_type,
        result_schema: task.result_schema,
        procedure_md: task.procedure_md,
        hazards_md: task.hazards_md,
        ppe_md: task.ppe_md,
        tools_md: task.tools_md,
        created_by: actor_id || "system",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await insertRow(client, "controls_history", {
        task_id: nextTask.id,
        user: "system",
        action: "task_created",
        site,
        date: new Date().toISOString(),
        task_name: task.task_name,
        meta: JSON.stringify({ reason: "auto_reschedule", from_task_id: task.id }),
      });

      return {
        task_closed: task.id,
        next_task: {
          id: nextTask.id,
          label: nextTask.task_name,
          due_date: nextTask.next_control,
          status: nextTask.status,
        },
      };
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
      `SELECT * FROM controls_history WHERE task_id = $1 ORDER BY date DESC, task_id DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Calendar Gantt (avec couleur)
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
      `SELECT t.*
       FROM controls_tasks t
       ${whereSQL}
       ORDER BY t.next_control ASC NULLS LAST`,
      params
    );
    const groups = rows.reduce((acc, r) => {
      const due = r.next_control;
      if (!due) return acc;
      const k = dayjs.utc(due).format("YYYY-MM-DD");
      const { category } = resolveTsdForTask(r);
      (acc[k] = acc[k] || []).push({
        id: r.id,
        label: r.task_name,
        status: r.status,
        due_date: r.next_control,
        task_code: r.task_code,
        entity_id: r.entity_id,
        site: r.site,
        color: colorForCategory(category?.key, r.task_code),
      });
      return acc;
    }, {});
    res.json(groups);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Filtres disponibles (valeurs distinctes calculées)
// ---------------------------------------------------------------------------
router.get("/filters", async (_req, res) => {
  try {
    const [sites, codes, statuses, zones] = await Promise.all([
      pool.query(`SELECT DISTINCT site FROM controls_tasks WHERE site IS NOT NULL ORDER BY site ASC`),
      pool.query(`SELECT DISTINCT task_code FROM controls_tasks WHERE task_code IS NOT NULL ORDER BY task_code ASC`),
      pool.query(`SELECT DISTINCT status FROM controls_tasks WHERE status IS NOT NULL ORDER BY status ASC`),
      // ATEX zones si présente sur entities
      pool.query(`SELECT DISTINCT atex_zone FROM controls_entities WHERE atex_zone IS NOT NULL ORDER BY atex_zone ASC`).catch(()=>({ rows: [] })),
    ]);

    // catégories TSD (pour filtres)
    const categories = (tsdLibrary.categories || []).map(c => ({ key: c.key, label: c.label }));

    res.json({
      sites: sites.rows.map(r => r.site),
      task_codes: codes.rows.map(r => r.task_code),
      statuses: statuses.rows.map(r => r.status),
      atex_zones: zones.rows.map(r => r.atex_zone).filter(Boolean),
      categories,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Hiérarchie — Bâtiment → HV → Switchboards → Devices → ATEX
//   Heuristique: on utilise controls_entities si des colonnes existent (site_id, atex_zone, parent_switchboard_id, equipment_table, equipment_id)
//   + tables de base si elles existent: sites, hv_devices/hv_equipments, switchboards, devices, atex_equipments
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      // Sites (bâtiments)
      const sites = await safeQuery(client, `SELECT id, name, label FROM sites`);
      const siteNodes = (sites?.rows || []).map(s => ({
        id: s.id ?? s.name ?? s.label,
        label: s.label || s.name || `Site ${s.id}`,
        type: "building",
        hv: [],
        switchboards: [],
        atex: [],
      }));

      // fallback si pas de table 'sites' → on fabrique depuis controls_entities.site
      if (!siteNodes.length) {
        const se = await client.query(`SELECT DISTINCT site FROM controls_entities WHERE site IS NOT NULL ORDER BY site ASC`);
        for (const r of se.rows) {
          siteNodes.push({ id: r.site, label: r.site, type: "building", hv: [], switchboards: [], atex: [] });
        }
        if (!siteNodes.length) {
          // encore rien → un conteneur générique
          siteNodes.push({ id: "Default", label: "Default", type: "building", hv: [], switchboards: [], atex: [] });
        }
      }

      // Switchboards
      const sw = await safeQuery(client, `SELECT id, name, label, site_id FROM switchboards`);
      const swMapBySite = new Map();
      for (const row of sw?.rows || []) {
        const key = String(row.site_id ?? "");
        if (!swMapBySite.has(key)) swMapBySite.set(key, []);
        swMapBySite.get(key).push({ id: row.id, label: row.label || row.name || `SW ${row.id}`, devices: [] });
      }

      // Devices (LT)
      const dev = await safeQuery(client, `SELECT id, name, label, switchboard_id FROM devices`);
      const devBySw = new Map();
      for (const row of dev?.rows || []) {
        const key = String(row.switchboard_id ?? "");
        if (!devBySw.has(key)) devBySw.set(key, []);
        devBySw.get(key).push({ id: row.id, label: row.label || row.name || `Device ${row.id}` });
      }

      // Haute Tension
      const hvd = await safeQuery(client, `SELECT id, name, label, site_id FROM hv_devices`);
      const hve = await safeQuery(client, `SELECT id, name, label, site_id FROM hv_equipments`);
      const hvBySite = new Map();
      for (const row of (hvd?.rows || []).concat(hve?.rows || [])) {
        const key = String(row.site_id ?? "");
        if (!hvBySite.has(key)) hvBySite.set(key, []);
        hvBySite.get(key).push({ id: row.id, label: row.label || row.name || `HV ${row.id}` });
      }

      // ATEX — zones et équipements
      const aeq = await safeQuery(client, `SELECT id, name, label, zone, site_id FROM atex_equipments`);
      const atexBySiteZone = new Map(); // { site_id -> { zone -> [equip] } }
      for (const row of aeq?.rows || []) {
        const sKey = String(row.site_id ?? "");
        const zKey = String(row.zone ?? "Z?");
        if (!atexBySiteZone.has(sKey)) atexBySiteZone.set(sKey, new Map());
        const byZone = atexBySiteZone.get(sKey);
        if (!byZone.has(zKey)) byZone.set(zKey, []);
        byZone.get(zKey).push({ id: row.id, label: row.label || row.name || `ATEX ${row.id}` });
      }

      // Assembler l’arbre
      for (const siteNode of siteNodes) {
        // clé site pour lier
        const key = String(siteNode.id);
        // HV
        for (const hv of hvBySite.get(key) || []) siteNode.hv.push({ ...hv, tasks: [] });
        // Switchboards + devices
        const swList = swMapBySite.get(key) || [];
        for (const swNode of swList) {
          const devs = devBySw.get(String(swNode.id)) || [];
          swNode.devices = devs.map(d => ({ ...d, tasks: [] }));
          swNode.tasks = [];
          siteNode.switchboards.push(swNode);
        }
        // ATEX zones
        const zones = atexBySiteZone.get(key) || new Map();
        for (const [zone, eqs] of zones.entries()) {
          siteNode.atex.push({
            zone,
            equipments: eqs.map(e => ({ ...e, tasks: [] })),
            tasks: [],
          });
        }
      }

      // Lier les tâches aux nœuds (via controls_entities si possible)
      const tasksQ = await client.query(
        `SELECT t.id, t.task_name, t.task_code, t.status, t.next_control, t.entity_id, t.site
         FROM controls_tasks t
         ORDER BY t.next_control ASC NULLS LAST`
      );
      // lecture des entités pour récupérer liaison vers équipement/source si colonnes présentes
      const entCols = await getColumnsMeta(client, "controls_entities");
      const has = (c) => !!entCols[c];
      const entQ = await client.query(
        `SELECT id, site, label,
                ${has("equipment_table") ? "equipment_table" : "NULL AS equipment_table"},
                ${has("equipment_id") ? "equipment_id" : "NULL AS equipment_id"},
                ${has("parent_switchboard_id") ? "parent_switchboard_id" : "NULL AS parent_switchboard_id"},
                ${has("site_id") ? "site_id" : "NULL AS site_id"},
                ${has("atex_zone") ? "atex_zone" : "NULL AS atex_zone"}
         FROM controls_entities`
      );
      const entMap = new Map(entQ.rows.map(r => [String(r.id), r]));

      // helpers de placement
      const bySiteLabel = new Map(siteNodes.map(s => [String(s.label), s]));
      const bySiteId = new Map(siteNodes.map(s => [String(s.id), s]));
      const findSiteNode = (site, site_id) => bySiteId.get(String(site_id)) || bySiteLabel.get(String(site)) || bySiteId.get(String(site)) || siteNodes[0];

      for (const t of tasksQ.rows) {
        const ent = entMap.get(String(t.entity_id));
        const due = t.next_control;
        const siteNode = findSiteNode(ent?.site ?? t.site, ent?.site_id);

        const taskObj = {
          id: t.id,
          label: t.task_name,
          code: t.task_code,
          status: t.status,
          due_date: due,
          color: colorForCategory(resolveTsdForTask(t).category?.key, t.task_code),
        };

        // dispatch par heuristique:
        const eqTable = ent?.equipment_table?.toLowerCase?.() || "";
        if (eqTable.includes("hv")) {
          // HV
          if (siteNode.hv.length) siteNode.hv[0].tasks.push(taskObj); // simple: première HV du site
          else siteNode.hv.push({ id: "hv", label: "High voltage", tasks: [taskObj] });
        } else if (eqTable.includes("switchboard")) {
          // TGBT
          if (siteNode.switchboards.length) siteNode.switchboards[0].tasks.push(taskObj);
          else siteNode.switchboards.push({ id: "sw", label: "Switchboards", devices: [], tasks: [taskObj] });
        } else if (eqTable.includes("device")) {
          // Appareil aval
          if (siteNode.switchboards.length && siteNode.switchboards[0].devices.length)
            siteNode.switchboards[0].devices[0].tasks.push(taskObj);
          else {
            // fallback: créer un groupe générique
            if (!siteNode.switchboards.length) siteNode.switchboards.push({ id:"sw", label:"Switchboards", devices:[], tasks:[] });
            siteNode.switchboards[0].devices.push({ id:"dev", label:"Devices", tasks:[taskObj] });
          }
        } else if (eqTable.includes("atex")) {
          // ATEX
          const zone = ent?.atex_zone || "Z?";
          let z = siteNode.atex.find(a => String(a.zone) === String(zone));
          if (!z) { z = { zone, equipments: [], tasks: [] }; siteNode.atex.push(z); }
          z.tasks.push(taskObj);
        } else {
          // fallback: poser au niveau site
          (siteNode.tasks = siteNode.tasks || []).push(taskObj);
        }
      }

      res.json(siteNodes);
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function safeQuery(client, sql) {
  try { return await client.query(sql); } catch { return null; }
}

// ---------------------------------------------------------------------------
// IA (inchangé: endpoints prêts pour le front)
// ---------------------------------------------------------------------------
router.post("/ai/analyze-before", upload.single("file"), async (req, res) => {
  const { task_id, hints = [], attach = "0" } = req.body || {};
  const file = req.file || null;

  try {
    let task = null;
    if (task_id) {
      const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [task_id]);
      task = rows[0] || null;
    }
    const { control } = task ? resolveTsdForTask(task) : { control: null };

    if (file && task && attach === "1") {
      await insertRow(pool, "controls_attachments", {
        site: task.site || "Default",
        record_id: null,
        task_id: task.id,
        entity_id: task.entity_id,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        data: file.buffer,
        uploaded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }

    res.json({
      ok: true,
      safety: {
        ppe: control?.ppe_md || tsdLibrary?.meta?.defaults?.ppe_md || "Gants isolants, visière, tenue ignifugée, balisage.",
        hazards: control?.hazards_md || "Risque d’arc, surfaces chaudes, parties nues sous tension.",
      },
      procedure: {
        steps: (control?.procedure_steps || []).map((s, i) => ({ step: i + 1, text: s })) || [
          { step: 1, text: "Vérifier l’environnement : propreté, humidité, obstacles." },
          { step: 2, text: "Se positionner côté amont, ouvrir capot d’inspection." },
          { step: 3, text: "Configurer l’appareil (mode adéquat)." },
          { step: 4, text: "Effectuer la mesure et consigner la valeur." },
        ],
        camera_hints: control?.camera_hints || [
          "Plan large pour contexte et dégagements.",
          "Zoom sur borniers / points de mesure.",
          "Photo nette du cadran au moment du relevé.",
        ],
      },
      hints,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post("/ai/read-value", upload.single("file"), async (req, res) => {
  const { task_id, meter_type = "multimeter_voltage", unit_hint = "V", attach = "0" } = req.body || {};
  const file = req.file || null;

  try {
    let task = null;
    if (task_id) {
      const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [task_id]);
      task = rows[0] || null;
    }
    if (file && task && attach === "1") {
      await insertRow(pool, "controls_attachments", {
        site: task?.site || "Default",
        record_id: null,
        task_id: task?.id || null,
        entity_id: task?.entity_id || null,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        data: file.buffer,
        uploaded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }
    res.json({
      ok: true,
      meter_type,
      unit_hint,
      value_detected: null,
      confidence: 0.0,
      suggestions: [
        "Recadrer plus près de l’afficheur.",
        "Limiter les reflets; stabiliser l’appareil.",
        `Vérifier l’échelle et l’unité (${unit_hint}).`,
      ],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Calendar color helper
// ---------------------------------------------------------------------------
function colorForCategory(catKey, taskCode = "") {
  const k = String(catKey || "").toUpperCase();
  if (k.includes("HV")) return "#ef4444";           // rouge
  if (k.includes("ATEX")) return "#f59e0b";         // amber
  if (k.includes("SWITCH")) return "#3b82f6";       // blue
  if (taskCode.toLowerCase().includes("thermo")) return "#22c55e"; // vert
  return "#6366f1"; // indigo default
}

// ---------------------------------------------------------------------------
// Seed (ALL catégories) — inchangé côté principe, marche avec entités existantes
// ---------------------------------------------------------------------------
router.get("/bootstrap/seed", async (req, res) => {
  const dry = String(req.query.dry_run || "1") === "1";
  const categoryParam = req.query.category || "ALL";
  const siteFilter = req.query.site || null;

  try {
    const report = await withTx(async (client) => {
      const ensured = await ensureAtLeastOneEntity(client);
      const ents = await client.query(
        siteFilter ? `SELECT * FROM controls_entities WHERE site = $1` : `SELECT * FROM controls_entities`,
        siteFilter ? [siteFilter] : []
      );
      const categories =
        categoryParam && categoryParam !== "ALL"
          ? [findCategoryByKeyOrLabel(categoryParam)].filter(Boolean)
          : (tsdLibrary.categories || []);

      const actions = [];
      for (const e of ents.rows) {
        for (const cat of categories) {
          if (!cat) continue;
          for (const ctrl of cat.controls || []) {
            const exists = await client.query(
              `SELECT 1 FROM controls_tasks
               WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
              [e.id, ctrl.type]
            );
            if (exists.rowCount) {
              actions.push({ entity_id: e.id, category: cat.key || cat.label, task_code: ctrl.type, action: "skipped_exists" });
              continue;
            }
            const months = monthsFromFreq(ctrl.frequency);
            const nextCtrl =
              (months ? addMonths(new Date().toISOString(), months)
                      : addByFreq(new Date().toISOString(), ctrl.frequency)) ||
              dayjs.utc().add(30, "day").toISOString();

            actions.push({ entity_id: e.id, category: cat.key || cat.label, task_code: ctrl.type, action: dry ? "would_create" : "created" });

            if (!dry) {
              await insertRow(client, "controls_tasks", {
                site: e.site || "Default",
                entity_id: e.id,
                task_name: `${cat.label} – ${ctrl.type}`,
                task_code: ctrl.type,
                frequency_months: months || null,
                last_control: null,
                next_control: nextCtrl,
                status: "Planned",
                value_type: ctrl.value_type || "checklist",
                result_schema: null,
                procedure_md: ctrl.procedure_md || "",
                hazards_md: ctrl.hazards_md || "",
                ppe_md: ctrl.ppe_md || "",
                tools_md: ctrl.tools_md || "",
                created_by: "seed",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            }
          }
        }
      }
      return { count_entities: ents.rowCount, ensured_entity: ensured, actions };
    });

    res.json({ ok: true, dry_run: dry, ...report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Mount + Boot
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
