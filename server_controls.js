/**
 * server_controls.js — ESM (type: module)
 * API Controls (TSD) — Hiérarchie + checklists TSD + Gantt + seed + pièces jointes
 *
 * Mount: /api/controls (changeable via CONTROLS_BASE_PATH)
 */

import express from "express";
import multer from "multer";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------------
// Charger la TSD (structure: { categories: [ { key,label,db_table,controls:[{type,frequency,checklist,observations,...}]} ] })
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

const OPEN_STATUSES = ["Planned", "Pending", "Overdue"];

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

const toDateStr = (d) => dayjs.utc(d).format("YYYY-MM-DD");
const addMonthsDateStr = (baseDateStr, months) =>
  toDateStr(dayjs.utc(baseDateStr).add(Number(months || 0), "month"));

function unitToMonths(interval, unit) {
  const u = String(unit || "").toLowerCase();
  if (u.startsWith("year")) return Number(interval) * 12;
  if (u.startsWith("month")) return Number(interval);
  if (u.startsWith("week")) return Math.round(Number(interval) / 4);
  if (u.startsWith("day")) return Math.round(Number(interval) / 30);
  return null;
}
function monthsFromFreq(freq) {
  if (!freq) return null;
  if (freq.min?.interval && freq.min?.unit) return unitToMonths(freq.min.interval, freq.min.unit);
  if (freq.interval && freq.unit) return unitToMonths(freq.interval, freq.unit);
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
function buildResultSchemaFromControl(ctrl) {
  const checklist = (ctrl?.checklist || []).map((label, i) => ({
    key: `item_${i + 1}`,
    label: String(label),
    options: RESULT_OPTIONS,
    type: "enum",
  }));
  const observations = (ctrl?.observations || []).map((label, i) => ({
    key: `obs_${i + 1}`,
    label: String(label),
    type: "text",
  }));
  return {
    value_type: ctrl?.value_type || "checklist",
    checklist,
    observations: observations.length ? observations : [{ key: "notes", label: "Observations", type: "text" }],
  };
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
// LISTE DES TÂCHES (filtres de base)
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q,
    status,
    site,
    entity_id,
    control, // task_code
    due_from,
    due_to,
    page = 1,
    page_size = 50,
    order = "due_date.asc",
    include_closed = "0",
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (q) { where.push(`(t.task_name ILIKE $${i} OR t.task_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
  if (status) {
    if (status === "open") { where.push(`t.status = ANY ($${i})`); params.push(OPEN_STATUSES); i++; }
    else if (status === "closed") where.push(`t.status = 'Done'`);
    else if (status === "overdue") where.push(`t.status = 'Overdue'`);
    else { where.push(`t.status = $${i}`); params.push(status); i++; }
  } else if (include_closed !== "1") {
    where.push(`t.status = ANY ($${i})`); params.push(OPEN_STATUSES); i++;
  }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }
  if (entity_id) { where.push(`t.entity_id = $${i}`); params.push(entity_id); i++; }
  if (control) { where.push(`LOWER(t.task_code) = LOWER($${i})`); params.push(control); i++; }
  if (due_from) { where.push(`t.next_control >= $${i}`); params.push(due_from); i++; }
  if (due_to) { where.push(`t.next_control <= $${i}`); params.push(due_to); i++; }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [col, dir] = String(order).split(".");
  const orderCol =
    col === "due_date" ? "next_control"
      : ["task_name","task_code","status","next_control","created_at","updated_at"].includes(col) ? col
      : "next_control";
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// SCHÉMA “RICHE” D’UNE TÂCHE — CHECKLIST & OBSERVATIONS DE LA TSD
// ---------------------------------------------------------------------------
router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Tâche introuvable" });
    const task = rows[0];

    // priorité à result_schema s'il est déjà stocké
    if (task.result_schema) {
      const schema = typeof task.result_schema === "object" ? task.result_schema : JSON.parse(task.result_schema);
      return res.json({
        task_id: task.id,
        label: task.task_name,
        task_code: task.task_code,
        ...schema,
      });
    }

    // sinon reconstruire depuis TSD
    const { category, control } = resolveTsdForTask(task);
    const schema = buildResultSchemaFromControl(control || {});
    res.json({
      task_id: task.id,
      label: task.task_name,
      task_code: task.task_code,
      ...schema,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// HISTORIQUE
// ---------------------------------------------------------------------------
router.get("/tasks/:id/history", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM controls_history WHERE task_id = $1 ORDER BY date DESC, task_id DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// PIÈCES JOINTES (LISTE / DOWNLOAD / UPLOAD) — colonnes mimetype & data
// ---------------------------------------------------------------------------
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      `INSERT INTO controls_attachments (site, record_id, task_id, entity_id, filename, mimetype, size, data, uploaded_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [site, null, id, t[0].entity_id, originalname, mimetype, size, buffer, new Date().toISOString(), new Date().toISOString()]
    );
    res.json({ ok: true, filename: originalname, mimetype, size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// CLÔTURE + REPLANIFICATION (dates: colonnes DATE)
// ---------------------------------------------------------------------------
router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const {
    record_status = "done",
    checklist = [],
    observations = {},
    attachments = [],
    actor_id = null,
    closed_at = dayjs.utc().format("YYYY-MM-DD"),
    comment = "",
  } = req.body || {};

  try {
    const outcome = await withTx(async (client) => {
      const { rows: taskRows } = await client.query(
        `SELECT t.*, e.site AS entity_site, e.building
         FROM controls_tasks t
         LEFT JOIN controls_entities e ON e.id = t.entity_id
         WHERE t.id = $1`,
        [id]
      );
      if (!taskRows.length) throw new Error("Tâche introuvable");
      const task = taskRows[0];
      const site = task.site || task.entity_site || "Default";

      // Enregistrer le record
      await client.query(
        `INSERT INTO controls_records
         (site, task_id, performed_at, performed_by, lang, result_status, numeric_value, text_value, checklist_result, ai_result, comments, entity_id, task_code, created_at, results, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          site, task.id, closed_at, actor_id || "system", "fr", record_status,
          null, null, JSON.stringify(checklist || []), null, comment || "",
          task.entity_id, task.task_code, new Date().toISOString(), JSON.stringify(observations || {}), actor_id || "system"
        ]
      );

      // Pièces jointes associées à la clôture (optionnel)
      for (const a of attachments || []) {
        const filename = a.filename || a.name || `file-${Date.now()}`;
        const mimetype = a.mimetype || "application/octet-stream";
        const size = a.size || null;
        const dataBuf = a.data && typeof a.data === "string" ? Buffer.from(a.data, "base64") : null;
        await client.query(
          `INSERT INTO controls_attachments
           (site, record_id, task_id, entity_id, filename, mimetype, size, data, uploaded_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [site, null, task.id, task.entity_id, filename, mimetype, size, dataBuf, new Date().toISOString(), new Date().toISOString()]
        );
      }

      // Fermer
      await client.query(
        `UPDATE controls_tasks
           SET status='Done', last_control=$2, updated_at=NOW()
         WHERE id=$1`,
        [task.id, closed_at]
      );

      // Historique
      await client.query(
        `INSERT INTO controls_history (task_id, user, date, site, meta, task_name, user_name, action)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [task.id, actor_id || "system", new Date().toISOString(), site, JSON.stringify({}), task.task_name, null, "task_closed"]
      );

      // Replanif avec TSD
      const { control } = resolveTsdForTask(task);
      const months = (task.frequency_months && Number(task.frequency_months)) || monthsFromFreq(control?.frequency) || null;
      const nextDue = months ? addMonthsDateStr(closed_at, months) : toDateStr(dayjs.utc(closed_at).add(6, "month"));

      const { rows: nextIns } = await client.query(
        `INSERT INTO controls_tasks
         (site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status, value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Planned',$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, task_name, next_control, status`,
        [
          site, task.entity_id, task.task_name, task.task_code, months,
          closed_at, nextDue,
          task.value_type || (control?.value_type || "checklist"),
          task.result_schema || JSON.stringify(buildResultSchemaFromControl(control || {})),
          task.procedure_md || control?.procedure_md || "",
          task.hazards_md   || control?.hazards_md   || "",
          task.ppe_md       || control?.ppe_md       || "",
          task.tools_md     || control?.tools_md     || "",
          actor_id || "system", new Date().toISOString(), new Date().toISOString()
        ]
      );
      const nextTask = nextIns[0];

      await client.query(
        `INSERT INTO controls_history (task_id, user, date, site, meta, task_name, user_name, action)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [nextTask.id, "system", new Date().toISOString(), site, JSON.stringify({ reason:"auto_reschedule", from: task.id }), task.task_name, null, "task_created"]
      );

      return {
        task_closed: task.id,
        next_task: { id: nextTask.id, label: nextTask.task_name, due_date: nextTask.next_control, status: nextTask.status }
      };
    });

    res.json(outcome);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// CALENDAR (Gantt) — open only par défaut; include_closed=1 pour inclure les Done
// ---------------------------------------------------------------------------
router.get("/calendar", async (req, res) => {
  const { from, to, site, control, include_closed = "0" } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (from) { where.push(`t.next_control >= $${i}`); params.push(from); i++; }
  if (to)   { where.push(`t.next_control <= $${i}`); params.push(to); i++; }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }
  if (control) { where.push(`LOWER(t.task_code) = LOWER($${i})`); params.push(control); i++; }
  if (include_closed !== "1") {
    where.push(`t.status = ANY ($${i})`); params.push(OPEN_STATUSES); i++;
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.task_name, t.task_code, t.status, t.next_control, t.entity_id, t.site
       FROM controls_tasks t
       ${whereSQL}
       ORDER BY t.next_control ASC NULLS LAST`,
      params
    );
    const groups = rows.reduce((acc, r) => {
      const due = r.next_control;
      if (!due) return acc;
      const k = dayjs.utc(due).format("YYYY-MM-DD");
      (acc[k] = acc[k] || []).push({
        id: r.id,
        label: r.task_name,
        status: r.status,
        due_date: r.next_control,
        task_code: r.task_code,
        entity_id: r.entity_id,
        site: r.site,
      });
      return acc;
    }, {});
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// HIÉRARCHIE — Building → (Switchboards → Devices) + ATEX (zones) + High Voltage
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      // 1) Buildings
      const buildings = [];
      const sitesTable = await safeQuery(client, `SELECT id, name, label FROM sites`);
      if (sitesTable?.rowCount) {
        for (const s of sitesTable.rows) {
          buildings.push({ id: String(s.id ?? s.name ?? s.label), label: s.label || s.name || `Site ${s.id}`, type: "building", switchboards: [], atex: [], hv: [], tasks: [] });
        }
      } else {
        const be = await client.query(`SELECT DISTINCT COALESCE(building, site, 'Default') AS b FROM controls_entities ORDER BY b ASC`);
        for (const r of be.rows) buildings.push({ id: r.b, label: r.b, type: "building", switchboards: [], atex: [], hv: [], tasks: [] });
        if (!buildings.length) buildings.push({ id: "Default", label: "Default", type: "building", switchboards: [], atex: [], hv: [], tasks: [] });
      }
      const byBuilding = new Map(buildings.map(b => [String(b.id), b]));
      const findBuildingNode = (bName) => byBuilding.get(String(bName)) || byBuilding.get("Default") || buildings[0];

      // 2) Switchboards (avec devices)
      const sw = await safeQuery(client, `SELECT id, name, code, label, site_id, building FROM switchboards`);
      const swMap = new Map(); // sw_id -> node
      if (sw?.rowCount) {
        for (const s of sw.rows) {
          const b = findBuildingNode(s.building || s.site_id || "Default");
          const node = { id: s.id, label: s.label || s.name || `SW ${s.id}`, code: s.code || null, devices: [], tasks: [] };
          b.switchboards.push(node);
          swMap.set(String(s.id), node);
        }
      }

      // devices
      const dev = await safeQuery(client, `SELECT id, name, code, label, switchboard_id FROM devices`);
      const devMap = new Map(); // dev_id -> node
      if (dev?.rowCount) {
        for (const d of dev.rows) {
          const swNode = swMap.get(String(d.switchboard_id));
          const node = { id: d.id, label: d.label || d.name || `Device ${d.id}`, code: d.code || null, tasks: [] };
          if (swNode) swNode.devices.push(node);
          devMap.set(String(d.id), node);
        }
      }

      // 3) ATEX (zones -> équipements)
      const atexEqs = await safeQuery(client, `SELECT id, name, label, code, zone, site_id, building FROM atex_equipments`);
      const atexGroup = new Map(); // building -> zone -> list
      if (atexEqs?.rowCount) {
        for (const a of atexEqs.rows) {
          const bKey = String(a.building || a.site_id || "Default");
          if (!atexGroup.has(bKey)) atexGroup.set(bKey, new Map());
          const zMap = atexGroup.get(bKey);
          const zKey = String(a.zone ?? "Z?");
          if (!zMap.has(zKey)) zMap.set(zKey, []);
          zMap.get(zKey).push({ id: a.id, label: a.label || a.name || `ATEX ${a.id}`, code: a.code || null, tasks: [] });
        }
        for (const [bKey, zMap] of atexGroup.entries()) {
          const b = findBuildingNode(bKey);
          for (const [zone, list] of zMap.entries()) {
            b.atex.push({ zone, equipments: list, tasks: [] });
          }
        }
      }

      // 4) HV
      const hve = await safeQuery(client, `SELECT id, name, label, code, site_id, building FROM hv_equipments`);
      const hvd = await safeQuery(client, `SELECT id, name, label, code, site_id, building FROM hv_devices`);
      const hvByBuilding = new Map();
      for (const r of (hve?.rows || []).concat(hvd?.rows || [])) {
        const bKey = String(r.building || r.site_id || "Default");
        if (!hvByBuilding.has(bKey)) hvByBuilding.set(bKey, []);
        hvByBuilding.get(bKey).push({ id: r.id, label: r.label || r.name || `HV ${r.id}`, code: r.code || null, tasks: [] });
      }
      for (const [bKey, list] of hvByBuilding.entries()) {
        const b = findBuildingNode(bKey);
        for (const item of list) b.hv.push(item);
      }

      // 5) Lier les tâches via controls_entities (switchboard_id/device_id/atex_id/hv_id)
      const ents = await client.query(
        `SELECT id, building, name, code, switchboard_id, device_id, atex_id, hv_id
         FROM controls_entities`
      );
      const entMap = new Map(ents.rows.map(e => [String(e.id), e]));

      const tasks = await client.query(
        `SELECT id, task_name, task_code, status, next_control, entity_id
         FROM controls_tasks
         ORDER BY next_control ASC NULLS LAST`
      );

      for (const t of tasks.rows) {
        const ent = entMap.get(String(t.entity_id));
        const taskNode = { id: t.id, label: t.task_name, code: t.task_code, status: t.status, due_date: t.next_control };

        if (ent) {
          // device prioritaire → device sous switchboard
          if (ent.device_id && devMap.get(String(ent.device_id))) {
            devMap.get(String(ent.device_id)).tasks.push(taskNode);
            continue;
          }
          // switchboard
          if (ent.switchboard_id && swMap.get(String(ent.switchboard_id))) {
            swMap.get(String(ent.switchboard_id)).tasks.push(taskNode);
            continue;
          }
          // atex
          if (ent.atex_id && atexGroup.size) {
            // placer au groupe ATEX du building de l'entité, dans n'importe quelle zone si inconnue
            const b = findBuildingNode(ent.building || "Default");
            if (b.atex.length) b.atex[0].tasks.push(taskNode);
            else b.atex.push({ zone: "Z?", equipments: [], tasks: [taskNode] });
            continue;
          }
          // hv
          if (ent.hv_id && hvByBuilding.size) {
            const b = findBuildingNode(ent.building || "Default");
            if (b.hv.length) b.hv[0].tasks.push(taskNode);
            else b.hv.push({ id: "hv", label: "High voltage", code: null, tasks: [taskNode] });
            continue;
          }
          // fallback: building
          const b = findBuildingNode(ent.building || "Default");
          b.tasks.push(taskNode);
        } else {
          // entité inconnue → regroupement "Default"
          const b = findBuildingNode("Default");
          b.tasks.push(taskNode);
        }
      }

      res.json(buildings);
    } finally { client.release(); }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function safeQuery(client, sql) {
  try { return await client.query(sql); } catch { return null; }
}

// ---------------------------------------------------------------------------
// SEED — crée des tâches pour chaque entité selon la TSD (résultat “propre”)
// ---------------------------------------------------------------------------
router.get("/bootstrap/seed", async (req, res) => {
  const dry = String(req.query.dry_run || "1") === "1";
  const categoryParam = req.query.category || "ALL";

  try {
    const report = await withTx(async (client) => {
      const ents = await client.query(`SELECT id, site, building, name FROM controls_entities`);
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
            const nextCtrl = toDateStr(
              months ? dayjs.utc().add(months, "month") : dayjs.utc().add(30, "day")
            );
            const schema = buildResultSchemaFromControl(ctrl);

            actions.push({ entity_id: e.id, category: cat.key || cat.label, task_code: ctrl.type, action: dry ? "would_create" : "created" });

            if (!dry) {
              await client.query(
                `INSERT INTO controls_tasks
                 (site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status, value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'Planned',$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                [
                  e.site || "Default", e.id, `${cat.label} – ${ctrl.type}`, ctrl.type,
                  months, null, nextCtrl,
                  schema.value_type, JSON.stringify(schema),
                  ctrl.procedure_md || "", ctrl.hazards_md || "", ctrl.ppe_md || "", ctrl.tools_md || "",
                  "seed", new Date().toISOString(), new Date().toISOString()
                ]
              );
            }
          }
        }
      }
      return { count_entities: ents.rowCount, actions };
    });

    res.json({ ok: true, dry_run: dry, ...report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Mount + Boot
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));