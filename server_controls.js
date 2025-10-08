/**
 * server_controls.js — ESM (type: module)
 * API Controls (TSD) — Hiérarchie équipements + filtres + pièces jointes + Gantt + Seed
 *
 * Monté sous: /api/controls
 *
 * Principaux endpoints:
 *   GET  /api/controls/health
 *   GET  /api/controls/tsd
 *   GET  /api/controls/tsd/category/:key
 *   GET  /api/controls/tasks?…
 *   GET  /api/controls/tasks/:id/schema
 *   GET  /api/controls/tasks/:id/history
 *   PATCH /api/controls/tasks/:id/close
 *   GET  /api/controls/tasks/:id/attachments
 *   POST /api/controls/tasks/:id/attachments
 *   GET  /api/controls/attachments/:id
 *   GET  /api/controls/calendar
 *   GET  /api/controls/filters
 *   GET  /api/controls/hierarchy/tree
 *   GET  /api/controls/bootstrap/sync-entities?dry_run=1|0
 *   GET  /api/controls/bootstrap/seed?category=ALL&dry_run=0
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
  const { interval, unit, min } = frequency;
  if (min && min.interval && min.unit)
    return dayjs.utc(baseISO).add(min.interval, min.unit).toISOString();
  if (interval && unit) return dayjs.utc(baseISO).add(interval, unit).toISOString();
  return null;
}
function monthsFromFreq(freq) {
  if (!freq) return null;
  if (freq.min && freq.min.interval && freq.min.unit)
    return unitToMonths(freq.min.interval, freq.min.unit);
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
async function insertRow(clientOrPool, table, values) {
  const meta = await getColumnsMeta(pool, table);
  const v = { ...values };
  if (meta.id && isUuidColumn(meta.id)) v.id = v.id || uuidv4();
  const pruned = pruneValuesByExistingColumns(v, meta);
  const { sql, params } = buildInsertSQL(table, pruned);
  const { rows } = await pool.query(sql, params);
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
// Entities minimal
// ---------------------------------------------------------------------------
async function ensureAtLeastOneEntity(client) {
  const cur = await client.query(`SELECT * FROM controls_entities LIMIT 1`);
  if (cur.rowCount) return { ensured: false, entity: cur.rows[0] };
  const now = new Date().toISOString();
  const ent = await insertRow(client, "controls_entities", {
    site: "Default",
    name: "Generic Entity",
    code: "GEN-001",
    created_at: now,
    updated_at: now,
  });
  return { ensured: true, entity: ent };
}

// ---------------------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q, status, site, building, category_key, control, atex_zone, entity_id,
    due_from, due_to, page = 1, page_size = 50, order = "due_date.asc",
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
  if (building) {
    where.push(`t.entity_id IN (SELECT id FROM controls_entities WHERE building::text = $${i} OR site::text = $${i})`);
    params.push(String(building));
    i++;
  }
  if (atex_zone) {
    where.push(`t.entity_id IN (SELECT id FROM controls_entities WHERE atex_zone::text = $${i})`);
    params.push(String(atex_zone));
    i++;
  }
  if (category_key) {
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

router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Tâche introuvable" });
    const task = rows[0];
    const { category, control } = resolveTsdForTask(task);

    const checklist = (control?.checklist || []).map((it, idx) => {
      const key = it.key ?? it.id ?? `i_${idx}`;
      const label = it.label || it.text || (typeof key === "string" ? key.replace(/^i_/, "Item ") : `Item ${idx+1}`);
      const options = it.options || RESULT_OPTIONS;
      return { ...it, key, label, options };
    });

    res.json({
      task_id: task.id,
      label: task.task_name,
      task_code: task.task_code,
      frequency: control?.frequency || null,
      checklist,
      observations: (control?.observations || []).map((o, i) => ({
        key: o.key ?? `obs_${i}`,
        label: o.label ?? String(o),
      })),
      procedure_md: control?.procedure_md || task.procedure_md || "",
      hazards_md: control?.hazards_md || task.hazards_md || "",
      ppe_md: control?.ppe_md || task.ppe_md || "",
      tools_md: control?.tools_md || task.tools_md || "",
      tsd_category: category ? { key: category.key, label: category.label } : null,
      ui: {
        category_key: category?.key || null,
        color: colorForCategory(category?.key, task.task_code),
      },
    });
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
// Close + reschedule
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
// Calendar
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
// Filtres
// ---------------------------------------------------------------------------
router.get("/filters", async (_req, res) => {
  try {
    const [sites, codes, statuses, zones] = await Promise.all([
      pool.query(`SELECT DISTINCT site FROM controls_tasks WHERE site IS NOT NULL ORDER BY site ASC`),
      pool.query(`SELECT DISTINCT task_code FROM controls_tasks WHERE task_code IS NOT NULL ORDER BY task_code ASC`),
      pool.query(`SELECT DISTINCT status FROM controls_tasks WHERE status IS NOT NULL ORDER BY status ASC`),
      pool.query(`SELECT DISTINCT atex_zone FROM controls_entities WHERE atex_zone IS NOT NULL ORDER BY atex_zone ASC`).catch(()=>({ rows: [] })),
    ]);

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
// Helpers colonnes dynamiques
// ---------------------------------------------------------------------------
async function getColSet(client, table) {
  const q = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`, [table]
  );
  const s = new Set(q.rows.map(r => r.column_name));
  const has = (c) => s.has(c);
  return { has, all: s };
}
function pickCol(has, ...candidates) {
  for (const c of candidates) if (c && has(c)) return c;
  return null;
}
function selectWithAliases(table, has, extra = {}) {
  const id = pickCol(has, 'id');
  const name = pickCol(has, 'label', 'name');
  const code = pickCol(has, 'code', 'ref', 'equipment_ref');
  const building = pickCol(has, 'building', 'building_code', 'site_name');
  const site = pickCol(has, 'site');
  const site_id = pickCol(has, 'site_id', 'siteid');
  const switchboard_id = pickCol(has, 'switchboard_id', 'sw_id', 'parent_id');

  const cols = [];
  cols.push(id ? `${id} AS id` : `NULL AS id`);
  cols.push(name ? `${name} AS label` : `NULL AS label`);
  cols.push(code ? `${code} AS code` : `NULL AS code`);
  cols.push(building ? `${building} AS building` : `NULL AS building`);
  cols.push(site ? `${site} AS site` : `NULL AS site`);
  cols.push(site_id ? `${site_id} AS site_id` : `NULL AS site_id`);
  cols.push(switchboard_id ? `${switchboard_id} AS switchboard_id` : `NULL AS switchboard_id`);

  Object.entries(extra).forEach(([alias, colOrNull]) => {
    if (!colOrNull) cols.push(`NULL AS ${alias}`);
    else cols.push(`${colOrNull} AS ${alias}`);
  });

  return { sql: `SELECT ${cols.join(', ')} FROM ${table}`, map: { id, label: name, code, building, site, site_id, switchboard_id } };
}
async function tableExists(client, tbl) {
  const q = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tbl]
  );
  return !!q.rowCount;
}

// ---------------------------------------------------------------------------
// /hierarchy/tree
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      // BUILDINGS
      const buildings = [];
      if (await tableExists(client, "sites")) {
        const cs = await getColSet(client, "sites");
        const sel = selectWithAliases("sites", (c)=>cs.has(c));
        const q = await client.query(sel.sql);
        for (const r of q.rows) {
          buildings.push({
            id: String(r.id ?? r.site_id ?? r.site ?? r.building ?? 'Default'),
            label: r.label || r.site || r.building || `Site ${r.id ?? ''}`.trim(),
            type: "building",
            switchboards: [],
            atex: [],
            hv: [],
            tasks: [],
          });
        }
      } else {
        const be = await client.query(
          `SELECT DISTINCT COALESCE(building, site, 'Default') AS b
           FROM controls_entities ORDER BY b ASC`
        );
        for (const r of be.rows) {
          buildings.push({ id: r.b, label: r.b, type:"building", switchboards:[], atex:[], hv:[], tasks:[] });
        }
        if (!buildings.length) {
          buildings.push({ id:"Default", label:"Default", type:"building", switchboards:[], atex:[], hv:[], tasks:[] });
        }
      }
      const byBuilding = new Map(buildings.map(b => [String(b.id), b]));
      const ensureBuilding = (b) =>
        byBuilding.get(String(b)) || byBuilding.get("Default") || buildings[0];

      // SWITCHBOARDS
      const swMap = new Map();
      if (await tableExists(client, "switchboards")) {
        const cs = await getColSet(client, "switchboards");
        const sel = selectWithAliases("switchboards", (c)=>cs.has(c));
        const q = await client.query(sel.sql);
        for (const s of q.rows) {
          const bKey = String(s.building || s.site_id || s.site || "Default");
          const b = ensureBuilding(bKey);
          const node = {
            id: s.id,
            label: s.label || `SW ${s.id}`,
            code: s.code || null,
            devices: [],
            tasks: [],
          };
          b.switchboards.push(node);
          swMap.set(String(s.id), node);
        }
      }

      // DEVICES
      const devMap = new Map();
      if (await tableExists(client, "devices")) {
        const cs = await getColSet(client, "devices");
        const sel = selectWithAliases("devices", (c)=>cs.has(c));
        const q = await client.query(sel.sql);
        for (const d of q.rows) {
          const node = { id: d.id, label: d.label || `Device ${d.id}`, code: d.code || null, tasks: [] };
          devMap.set(String(d.id), node);
          const parent = d.switchboard_id ? swMap.get(String(d.switchboard_id)) : null;
          if (parent) parent.devices.push(node);
        }
      }

      // ATEX
      const atexZonesByB = new Map();
      if (await tableExists(client, "atex_equipments")) {
        const cs = await getColSet(client, "atex_equipments");
        const zoneCol = pickCol(cs.has, 'zone', 'atex_zone');
        const sel = selectWithAliases("atex_equipments", (c)=>cs.has(c), { zone: zoneCol });
        const q = await client.query(sel.sql);
        for (const a of q.rows) {
          const bKey = String(a.building || a.site_id || a.site || "Default");
          const zKey = String(a.zone ?? "Z?");
          if (!atexZonesByB.has(bKey)) atexZonesByB.set(bKey, new Map());
          const zMap = atexZonesByB.get(bKey);
          if (!zMap.has(zKey)) zMap.set(zKey, []);
          zMap.get(zKey).push({ id:a.id, label:a.label || `ATEX ${a.id}`, code:a.code || null, tasks: [] });
        }
        for (const [bKey, zMap] of atexZonesByB.entries()) {
          const b = ensureBuilding(bKey);
          for (const [zone, list] of zMap.entries()) b.atex.push({ zone, equipments: list, tasks: [] });
        }
      }

      // HV
      const hvListByB = new Map();
      for (const tbl of ["hv_equipments", "hv_devices"]) {
        if (await tableExists(client, tbl)) {
          const cs = await getColSet(client, tbl);
          const sel = selectWithAliases(tbl, (c)=>cs.has(c));
          const q = await client.query(sel.sql);
          for (const r of q.rows) {
            const bKey = String(r.building || r.site_id || r.site || "Default");
            if (!hvListByB.has(bKey)) hvListByB.set(bKey, []);
            hvListByB.get(bKey).push({ id:r.id, label:r.label || `HV ${r.id}`, code:r.code || null, tasks: [] });
          }
        }
      }
      for (const [bKey, list] of hvListByB.entries()) {
        const b = ensureBuilding(bKey);
        for (const item of list) b.hv.push(item);
      }

      // Lier tâches via controls_entities
      const entCols = await getColumnsMeta(client, "controls_entities").catch(()=>({}));
      const has = (c) => !!entCols[c];
      const entQ = await client.query(
        `SELECT id,
                ${has("building") ? "building" : "NULL AS building"},
                ${has("device_id") ? "device_id" : "NULL AS device_id"},
                ${has("switchboard_id") ? "switchboard_id" : "NULL AS switchboard_id"},
                ${has("atex_id") ? "atex_id" : "NULL AS atex_id"},
                ${has("hv_id") ? "hv_id" : "NULL AS hv_id"}
         FROM controls_entities`
      );
      const entMap = new Map(entQ.rows.map(e => [String(e.id), e]));

      const tQ = await client.query(
        `SELECT id, task_name, task_code, status, next_control, entity_id
         FROM controls_tasks
         ORDER BY next_control ASC NULLS LAST`
      );
      for (const t of tQ.rows) {
        const ent = entMap.get(String(t.entity_id));
        const tNode = { id: t.id, label: t.task_name, code: t.task_code, status: t.status, due_date: t.next_control };

        if (ent?.device_id && devMap.get(String(ent.device_id))) {
          devMap.get(String(ent.device_id)).tasks.push(tNode);
          continue;
        }
        if (ent?.switchboard_id && swMap.get(String(ent.switchboard_id))) {
          swMap.get(String(ent.switchboard_id)).tasks.push(tNode);
          continue;
        }
        if (ent?.atex_id) {
          const b = ensureBuilding(ent.building || "Default");
          if (b.atex.length) b.atex[0].tasks.push(tNode);
          else b.atex.push({ zone:"Z?", equipments:[], tasks:[tNode] });
          continue;
        }
        if (ent?.hv_id) {
          const b = ensureBuilding(ent.building || "Default");
          if (b.hv.length) b.hv[0].tasks.push(tNode);
          else b.hv.push({ id:"hv", label:"High voltage", code:null, tasks:[tNode] });
          continue;
        }
        const b = ensureBuilding(ent?.building || "Default");
        b.tasks.push(tNode);
      }

      res.json(buildings);
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// /bootstrap/sync-entities — upsert depuis équipements
// ---------------------------------------------------------------------------
async function upsertEntity(client, payload) {
  const keys = ["device_id","switchboard_id","atex_id","hv_id","code"];
  let found = null;
  for (const k of keys) {
    if (payload[k]) {
      const q = await client.query(`SELECT id FROM controls_entities WHERE ${k}=$1 LIMIT 1`, [payload[k]]);
      if (q.rowCount) { found = q.rows[0].id; break; }
    }
  }
  const now = new Date().toISOString();
  if (found) {
    const meta = await getColumnsMeta(client, "controls_entities");
    const fields = ["site","building","name","code","switchboard_id","device_id","atex_id","hv_id"];
    const sets = [];
    const vals = [];
    fields.forEach((f, idx) => {
      if (payload[f] !== undefined && meta[f]) {
        sets.push(`${f} = COALESCE($${idx+1}, ${f})`);
        vals.push(payload[f]);
      }
    });
    if (meta.updated_at) { sets.push(`updated_at = NOW()`); }
    await client.query(`UPDATE controls_entities SET ${sets.join(", ")} WHERE id=$${vals.length+1}`, [...vals, found]);
    return { action:"updated", id: found };
  } else {
    const row = await insertRow(client, "controls_entities", {
      site: payload.site || "Default",
      building: payload.building || null,
      name: payload.name || payload.code || "Equipment",
      code: payload.code || null,
      switchboard_id: payload.switchboard_id || null,
      device_id: payload.device_id || null,
      atex_id: payload.atex_id || null,
      hv_id: payload.hv_id || null,
      created_at: now,
      updated_at: now,
    });
    return { action:"created", id: row.id };
  }
}

router.get("/bootstrap/sync-entities", async (req, res) => {
  const dry = String(req.query.dry_run || "1") === "1";
  try {
    const out = await withTx(async (client) => {
      const summary = { switchboards:[], devices:[], atex:[], hv:[], total_created:0, total_updated:0 };

      // SWITCHBOARDS
      if (await tableExists(client, "switchboards")) {
        const cs = await getColSet(client, "switchboards");
        const sel = selectWithAliases("switchboards", (c)=>cs.has(c));
        const q = await client.query(sel.sql);
        for (const r of q.rows) {
          const name = r.label || `SW ${r.id}`;
          const site = r.site || (r.site_id ? String(r.site_id) : 'Default');
          const building = r.building || site;
          if (dry) { summary.switchboards.push({ would:"upsert", id:r.id, name, building }); continue; }
          const resu = await upsertEntity(client, {
            site, building, name, code:r.code || null, switchboard_id:r.id
          });
          summary.switchboards.push({ ...resu, src_id:r.id, name, building });
          summary[ resu.action === "created" ? "total_created" : "total_updated" ]++;
        }
      }

      // DEVICES
      if (await tableExists(client, "devices")) {
        const csD = await getColSet(client, "devices");
        const selD = selectWithAliases("devices", (c)=>csD.has(c));
        const qD = await client.query(selD.sql);

        let swById = new Map();
        if (await tableExists(client, "switchboards")) {
          const csS = await getColSet(client, "switchboards");
          const selS = selectWithAliases("switchboards", (c)=>csS.has(c));
          const qS = await client.query(selS.sql);
          swById = new Map(qS.rows.map(s => [String(s.id), s]));
        }

        for (const r of qD.rows) {
          const name = r.label || `Device ${r.id}`;
          const sw = r.switchboard_id ? swById.get(String(r.switchboard_id)) : null;
          const site = r.site || sw?.site || (sw?.site_id ? String(sw.site_id) : 'Default');
          const building = r.building || sw?.building || site;
          if (dry) { summary.devices.push({ would:"upsert", id:r.id, name, building, switchboard_id:r.switchboard_id }); continue; }
          const resu = await upsertEntity(client, {
            site, building, name, code:r.code || null, device_id:r.id, switchboard_id:r.switchboard_id || null
          });
          summary.devices.push({ ...resu, src_id:r.id, name, building });
          summary[ resu.action === "created" ? "total_created" : "total_updated" ]++;
        }
      }

      // ATEX
      if (await tableExists(client, "atex_equipments")) {
        const cs = await getColSet(client, "atex_equipments");
        const sel = selectWithAliases("atex_equipments", (c)=>cs.has(c), { zone: pickCol(cs.has, 'zone','atex_zone') });
        const q = await client.query(sel.sql);
        for (const r of q.rows) {
          const name = r.label || `ATEX ${r.id}`;
          const site = r.site || (r.site_id ? String(r.site_id) : 'Default');
          const building = r.building || site;
          if (dry) { summary.atex.push({ would:"upsert", id:r.id, name, building, zone:r.zone }); continue; }
          const resu = await upsertEntity(client, {
            site, building, name, code:r.code || null, atex_id:r.id
          });
          summary.atex.push({ ...resu, src_id:r.id, name, building });
          summary[ resu.action === "created" ? "total_created" : "total_updated" ]++;
        }
      }

      // HV
      for (const tbl of ["hv_equipments","hv_devices"]) {
        if (await tableExists(client, tbl)) {
          const cs = await getColSet(client, tbl);
          const sel = selectWithAliases(tbl, (c)=>cs.has(c));
          const q = await client.query(sel.sql);
          for (const r of q.rows) {
            const name = r.label || `HV ${r.id}`;
            const site = r.site || (r.site_id ? String(r.site_id) : 'Default');
            const building = r.building || site;
            if (dry) { summary.hv.push({ would:"upsert", tbl, id:r.id, name, building }); continue; }
            const resu = await upsertEntity(client, {
              site, building, name, code:r.code || null, hv_id:r.id
            });
            summary.hv.push({ ...resu, tbl, src_id:r.id, name, building });
            summary[ resu.action === "created" ? "total_created" : "total_updated" ]++;
          }
        }
      }

      return summary;
    });

    res.json({ ok:true, dry_run: dry, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Seed
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
// IA placeholders
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
// Mount + Boot
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
