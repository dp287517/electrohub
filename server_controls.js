/**
 * server_controls.js — Controls (TSD) API (ESM, Render-friendly)
 * Robust entity<->task linking (integer/uuid), bootstrap + seed, diagnostics.
 * Monté sous: /api/controls
 */
import express from "express";
import multer from "multer";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { v4 as uuidv4 } from "uuid";

dayjs.extend(utc);

// ------------------------------- DB -----------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ------------------------------- TSD ----------------------------------------
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

// ------------------------------ Utils ---------------------------------------
const upload = multer({ storage: multer.memoryStorage() });
const OPEN_STATUSES = ["Planned", "Pending", "Overdue"];

const app = express();
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
const router = express.Router();

const TABLES = ["hv_equipments","hv_devices","switchboards","devices","atex_equipments"];
const KIND_BY_TABLE = {
  hv_equipments: "hv", hv_devices: "hv",
  switchboards: "switchboards",
  devices: "devices",
  atex_equipments: "atex_equipments",
};

function colorForCategory(catKey, taskCode = "") {
  const k = String(catKey || "").toUpperCase();
  if (k.includes("HV")) return "#ef4444";
  if (k.includes("ATEX")) return "#f59e0b";
  if (k.includes("SWITCH")) return "#3b82f6";
  if (taskCode.toLowerCase().includes("thermo")) return "#22c55e";
  return "#6366f1";
}
function addMonths(baseISO, months) { return dayjs.utc(baseISO).add(Number(months), "month").toISOString(); }
function addByFreq(baseISO, frequency) {
  if (!frequency) return null;
  const { interval, unit, min } = frequency;
  if (min?.interval && min?.unit) return dayjs.utc(baseISO).add(min.interval, min.unit).toISOString();
  if (interval && unit) return dayjs.utc(baseISO).add(interval, unit).toISOString();
  return null;
}
function monthsFromFreq(freq) {
  if (!freq) return null;
  if (freq.min?.interval && freq.min?.unit) return unitToMonths(freq.min.interval, freq.min.unit);
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
  try { await client.query("BEGIN"); const r = await fn(client); await client.query("COMMIT"); return r; }
  catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

async function getColumnsMeta(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const meta = {}; for (const r of rows) meta[r.column_name] = r; return meta;
}
function isUuidColumn(colMeta) {
  return colMeta && (colMeta.udt_name === "uuid" || colMeta.data_type === "uuid");
}
function pruneValuesByExistingColumns(values, columnsMeta) {
  const out = {};
  for (const k of Object.keys(values)) if (columnsMeta[k] !== undefined) out[k] = values[k];
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
  if (meta.id && isUuidColumn(meta.id) && !v.id) v.id = uuidv4();
  const pruned = pruneValuesByExistingColumns(v, meta);
  const { sql, params } = buildInsertSQL(table, pruned);
  const { rows } = await client.query(sql, params);
  return rows[0];
}

// ----------------------- Robust entity matching ------------------------------
async function detectEntityIdColumns(client){
  const m = await getColumnsMeta(client, "controls_entities");
  return { has: m };
}
function entityWhereClause(kind, entMeta){
  // Compare nativement ET en cast texte pour absorber int/uuid
  const wh = [];
  const map = { switchboards:"switchboard_id", devices:"device_id", atex_equipments:"atex_id", hv:"hv_id" };
  const col = map[kind];
  if (col && entMeta.has[col]) {
    wh.push(`${col} = $1`);
    wh.push(`CAST(${col} AS text) = CAST($1 AS text)`);
  }
  // fallback related_*
  if (entMeta.has.related_type && entMeta.has.related_id){
    wh.push(`(related_type = $2 AND related_id = $1)`);
    wh.push(`(related_type = $2 AND CAST(related_id AS text) = CAST($1 AS text))`);
  }
  // fallback code si dispo ($3)
  if (entMeta.has.code) wh.push(`(code = $3)`);
  return `(${wh.join(" OR ")})`;
}
async function findEntityIdFor(client, kind, equipId, equipCode=null){
  const entMeta = await detectEntityIdColumns(client);
  const where = entityWhereClause(kind, entMeta);
  const { rows } = await client.query(
    `SELECT id FROM controls_entities WHERE ${where} LIMIT 1`,
    [equipId, kind, equipCode]
  );
  return rows?.[0]?.id || null;
}

// ---------------------------------------------------------------------------
// Hierarchy/debug
// ---------------------------------------------------------------------------
const CANDIDATE = {
  building: ["building_code","building","site","site_id"],
  name: ["name","label","title","designation"],
  code: ["code","ref","reference"],
  sw_id: ["switchboard_id","switchboard","parent_switchboard_id","panel_id"],
  zone: ["zone","atex_zone","area"],
};
function pickCol(meta, candidates) { for (const c of candidates) if (meta[c]) return c; return null; }
async function detectShape(client, table) {
  const meta = await getColumnsMeta(client, table);
  if (!Object.keys(meta).length) return null;
  const id = meta["id"] ? "id" : null;
  const building = pickCol(meta, CANDIDATE.building);
  const name = pickCol(meta, CANDIDATE.name);
  const code = pickCol(meta, CANDIDATE.code);
  const sw_id = pickCol(meta, CANDIDATE.sw_id);
  const zone = pickCol(meta, CANDIDATE.zone);
  return { table, meta, id, building, name, code, sw_id, zone };
}
function buildingExpr(shape, alias = "bld") {
  if (shape?.building) return `${shape.building}::text AS ${alias}`;
  return `'Default'::text AS ${alias}`;
}
function labelExpr(shape, alias = "label") {
  const fields = [];
  if (shape?.name) fields.push(shape.name);
  if (shape?.code) fields.push(shape.code);
  if (shape?.id) fields.push(`('${shape.table.slice(0,3).toUpperCase()}-'||${shape.id})`);
  if (!fields.length) fields.push(`'${shape?.table?.toUpperCase() || "EQUIPMENT"}'`);
  return `COALESCE(${fields.join(", ")}) AS ${alias}`;
}

router.get("/hierarchy/debug", async (_req, res) => {
  const client = await pool.connect();
  try {
    const shapes = {};
    for (const tbl of TABLES) shapes[tbl] = await detectShape(client, tbl);
    const entCols = await getColumnsMeta(client, "controls_entities");
    res.json({ shapes, ent_has: Object.keys(entCols) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Hierarchy/tree — équipe chaque nœud avec entity_id et tâches
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  const client = await pool.connect();
  try {
    const sh = {}; for (const tbl of TABLES) sh[tbl] = await detectShape(client, tbl);

    async function loadRowsWithEntity(shape, kind) {
      if (!shape || !shape.id) return [];
      const fields = [
        `${shape.id} AS id`,
        labelExpr(shape, "label"),
        shape.code ? `${shape.code} AS code` : `NULL::text AS code`,
        buildingExpr(shape, "building"),
      ];
      if (shape.sw_id) fields.push(`${shape.sw_id} AS switchboard_id`);
      if (shape.zone) fields.push(`${shape.zone} AS zone`);
      const sql = `SELECT ${fields.join(", ")} FROM ${shape.table}`;
      const rs = await client.query(sql);
      const rows = rs.rows;
      for (const r of rows) r.entity_id = await findEntityIdFor(client, kind, r.id, r.code || null);
      return rows;
    }

    const hvEquip = await loadRowsWithEntity(sh["hv_equipments"], "hv");
    const hvDev   = await loadRowsWithEntity(sh["hv_devices"], "hv");
    const sw      = await loadRowsWithEntity(sh["switchboards"], "switchboards");
    const dev     = await loadRowsWithEntity(sh["devices"], "devices");
    const atex    = await loadRowsWithEntity(sh["atex_equipments"], "atex_equipments");

    // Index
    const swByBuilding = new Map();
    for (const r of sw) {
      const b = String(r.building ?? "Default");
      if (!swByBuilding.has(b)) swByBuilding.set(b, []);
      swByBuilding.get(b).push({ id: r.id, label: r.label, code: r.code, entity_id: r.entity_id, devices: [], tasks: [] });
    }
    const devBySwitch = new Map();
    for (const r of dev) {
      const key = String(r.switchboard_id ?? "");
      if (!devBySwitch.has(key)) devBySwitch.set(key, []);
      devBySwitch.get(key).push({ id: r.id, label: r.label, code: r.code, entity_id: r.entity_id, tasks: [] });
    }
    for (const [b, list] of swByBuilding.entries())
      for (const sb of list) sb.devices = devBySwitch.get(String(sb.id)) || [];

    const hvByBuilding = new Map();
    for (const r of [...hvEquip, ...hvDev]) {
      const b = String(r.building ?? "Default");
      if (!hvByBuilding.has(b)) hvByBuilding.set(b, []);
      hvByBuilding.get(b).push({ id: r.id, label: r.label, code: r.code, entity_id: r.entity_id, tasks: [] });
    }
    const atexByB = new Map(); // b -> Map(zone -> [equip])
    for (const r of atex) {
      const b = String(r.building ?? "Default");
      if (!atexByB.has(b)) atexByB.set(b, new Map());
      const byZone = atexByB.get(b);
      const zKey = String(r.zone ?? "Z?");
      if (!byZone.has(zKey)) byZone.set(zKey, []);
      byZone.get(zKey).push({ id: r.id, label: r.label, code: r.code, entity_id: r.entity_id, tasks: [] });
    }

    // 3) Attacher TÂCHES (par entity_id)
    const tasksQ = await client.query(
      `SELECT id, task_name, task_code, status, next_control, entity_id
       FROM controls_tasks
       ORDER BY next_control ASC NULLS LAST`
    );
    const tasksByEntity = new Map();
    for (const t of tasksQ.rows) {
      if (!t.entity_id) continue;
      const k = String(t.entity_id);
      if (!tasksByEntity.has(k)) tasksByEntity.set(k, []);
      tasksByEntity.get(k).push({
        id: t.id,
        label: t.task_name,
        code: t.task_code,
        status: t.status,
        due_date: t.next_control,
        color: colorForCategory(resolveTsdForTask(t).category?.key, t.task_code),
      });
    }
    function attachTasks(e) {
      const arr = tasksByEntity.get(String(e.entity_id)) || [];
      if (arr.length) e.tasks = arr;
    }

    const sites = new Set();
    for (const list of [sw,hvEquip,hvDev,dev,atex])
      for (const r of list) if (r?.building) sites.add(String(r.building));
    if (!sites.size) sites.add("Default");

    const tree = Array.from(sites.values())
      .sort((a,b)=>String(a).localeCompare(String(b)))
      .map(b => ({
        id: b,
        label: b,
        hv: (hvByBuilding.get(b) || []).map(x => { attachTasks(x); return x; }),
        switchboards: (swByBuilding.get(b) || []).map(sb => {
          attachTasks(sb);
          sb.devices = (sb.devices || []).map(d => { attachTasks(d); return d; });
          return sb;
        }),
        atex: Array.from((atexByB.get(b) || new Map()).entries()).map(([zone, eqs]) => ({
          zone, equipments: eqs.map(e => { attachTasks(e); return e; })
        })),
        tasks: [],
      }));

    res.json(tree);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Bootstrap: crée entités manquantes + seed tâches TSD (idempotent)
// ---------------------------------------------------------------------------
function catMapByTable(){
  const m = new Map();
  for (const c of tsdLibrary.categories || []) if (c.db_table) m.set(String(c.db_table).toLowerCase(), c);
  return m;
}
function catForKind(kind, byTable){
  if (kind==="hv") return byTable.get("hv") || byTable.get("hv_equipments");
  if (kind==="switchboards") return byTable.get("switchboards");
  if (kind==="devices") return byTable.get("devices");
  if (kind==="atex_equipments") return byTable.get("atex_equipments");
  return null;
}
router.get("/bootstrap/auto-link", async (req, res) => {
  const doCreate = String(req.query.create || "1") === "1";
  const doSeed   = String(req.query.seed || "1") === "1";
  try {
    const out = await withTx(async (client) => {
      const actions = [];
      const shapes = {}; for (const t of TABLES) shapes[t] = await detectShape(client, t);

      async function rowsOf(shape){
        if (!shape?.id) return [];
        const f = [
          `${shape.id} AS id`, labelExpr(shape,"label"),
          shape.code ? `${shape.code} AS code` : `NULL::text AS code`,
          buildingExpr(shape,"building")
        ];
        const { rows } = await client.query(`SELECT ${f.join(", ")} FROM ${shape.table}`);
        return rows;
      }
      const data = {}; for (const t of TABLES) data[t] = await rowsOf(shapes[t]);

      const byTable = catMapByTable();

      async function ensureEntity(kind, row){
        const existing = await findEntityIdFor(client, kind, row.id, row.code || null);
        if (existing) return { id: existing, created:false };
        if (!doCreate) return { id:null, created:false };

        const entMeta = await getColumnsMeta(client, "controls_entities");
        const payload = {
          site: String(row.building || "Default"),
          building: String(row.building || "Default"),
          name: row.label,
          code: row.code || null,
          equipment_type: kind,
          equipment_ref: row.code || null,
          related_type: kind,
          related_id: row.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (entMeta.switchboard_id && kind==="switchboards") payload.switchboard_id = row.id;
        if (entMeta.device_id && kind==="devices") payload.device_id = row.id;
        if (entMeta.atex_id && kind==="atex_equipments") payload.atex_id = row.id;
        if (entMeta.hv_id && kind==="hv") payload.hv_id = row.id;

        const cols = Object.keys(payload);
        const placeholders = cols.map((_,i)=>`$${i+1}`).join(",");
        const { rows } = await client.query(
          `INSERT INTO controls_entities (${cols.join(",")}) VALUES (${placeholders}) RETURNING id`,
          cols.map(c => payload[c])
        );
        actions.push({ action:"entity_created", kind, equip_id: row.id, entity_id: rows[0].id });
        return { id: rows[0].id, created:true };
      }

      async function seedTasks(entity_id, site, cat){
        if (!doSeed || !cat) return;
        for (const ctrl of (cat.controls || [])) {
          const ex = await client.query(
            `SELECT 1 FROM controls_tasks
             WHERE entity_id=$1 AND task_code=$2 AND status = ANY($3) LIMIT 1`,
            [entity_id, ctrl.type, OPEN_STATUSES]
          );
          if (ex.rowCount) { actions.push({ action:"seed_exists", entity_id, task_code: ctrl.type }); continue; }

          const months = monthsFromFreq(ctrl.frequency);
          const nextCtrl = (months
            ? addMonths(new Date().toISOString(), months)
            : addByFreq(new Date().toISOString(), ctrl.frequency)) || dayjs.utc().add(30,"day").toISOString();

          await client.query(
            `INSERT INTO controls_tasks
             (site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status, value_type, created_by, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              site, entity_id, `${cat.label} – ${ctrl.type}`, ctrl.type,
              months || null, null, nextCtrl, "Planned",
              ctrl.value_type || "checklist",
              "seed", new Date().toISOString(), new Date().toISOString()
            ]
          );
          actions.push({ action:"task_seeded", entity_id, task_code: ctrl.type });
        }
      }

      // Créer entités + seed
      for (const t of TABLES) {
        const kind = KIND_BY_TABLE[t];
        const cat  = catForKind(kind, byTable);
        for (const r of data[t]) {
          const ent = await ensureEntity(kind, r);
          if (ent.id) await seedTasks(ent.id, String(r.building || "Default"), cat);
        }
      }

      return { actions };
    });

    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// TASKS (liste + schema + close + attachments)
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q, status, site, entity_id,
    due_from, due_to, page = 1, page_size = 50, order = "due_date.asc",
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (q) { where.push(`(t.task_name ILIKE $${i} OR t.task_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
  if (status) {
    if (status === "open") { where.push(`t.status = ANY ($${i})`); params.push(OPEN_STATUSES); i++; }
    else if (status === "done" || status === "closed") where.push(`t.status = 'Done'`);
    else if (status === "overdue") where.push(`t.status = 'Overdue'`);
    else { where.push(`t.status = $${i}`); params.push(status); i++; }
  }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }
  if (entity_id) { where.push(`t.entity_id = $${i}`); params.push(entity_id); i++; }
  if (due_from) { where.push(`t.next_control >= $${i}`); params.push(due_from); i++; }
  if (due_to) { where.push(`t.next_control <= $${i}`); params.push(due_to); i++; }

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
         t.frequency_months, t.last_control, t.value_type,
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

router.get("/tasks/by-entity/:entity_id", async (req, res) => {
  const { entity_id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, task_name, task_code, status, next_control
       FROM controls_tasks WHERE entity_id=$1 ORDER BY next_control ASC NULLS LAST`, [entity_id]
    );
    res.json(rows);
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
      const options = Array.isArray(it.options) && it.options.length ? it.options : RESULT_OPTIONS;
      return { ...it, key, label, options };
    });

    res.json({
      task_id: task.id,
      label: task.task_name,
      task_code: task.task_code,
      frequency: control?.frequency || null,
      checklist,
      observations: (control?.observations || []).map((o, i) => ({
        key: o.key || `o_${i}`,
        label: o.label || o.text || `Observation ${i+1}`
      })),
      procedure_md: control?.procedure_md || task.procedure_md || "",
      hazards_md: control?.hazards_md || task.hazards_md || "",
      ppe_md: control?.ppe_md || task.ppe_md || "",
      tools_md: control?.tools_md || "",
      tsd_category: category ? { key: category.key, label: category.label } : null,
      ui: { category_key: category?.key || null, color: colorForCategory(category?.key, task.task_code) },
    });
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

      await client.query(
        `INSERT INTO controls_records
           (site, task_id, entity_id, performed_at, performed_by, result_status,
            text_value, checklist_result, results, comments, created_at, created_by, task_code, lang)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          site, task.id, task.entity_id, closed_at, (actor_id || "system"),
          record_status, null, JSON.stringify(checklist || []), JSON.stringify(observations || {}),
          comment || "", new Date().toISOString(), (actor_id || "system"), task.task_code, "fr"
        ]
      );

      for (const a of attachments) {
        const filename = a.filename || a.name || `file-${Date.now()}`;
        const mimetype = a.mimetype || a.mime || "application/octet-stream";
        const size = a.bytes || a.size || null;
        const dataBuf = a.data && typeof a.data === "string" ? Buffer.from(a.data, "base64") : null;
        await insertRow(client, "controls_attachments", {
          site,
          record_id: null,
          task_id: task.id,
          entity_id: task.entity_id,
          filename, mimetype, size, data: dataBuf,
          uploaded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      }

      await client.query(
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

      const { rows: nxt } = await client.query(
        `INSERT INTO controls_tasks
           (site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status,
            value_type, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Planned',$8,$9,$10,$11)
         RETURNING id, next_control, status`,
        [
          site, task.entity_id, task.task_name, task.task_code, months,
          closed_at, nextDue, task.value_type, (actor_id || "system"),
          new Date().toISOString(), new Date().toISOString()
        ]
      );

      return {
        task_closed: task.id,
        next_task: { id: nxt[0].id, label: task.task_name, due_date: nxt[0].next_control, status: nxt[0].status },
      };
    });

    res.json(outcome);
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
app.listen(port, () => {
  console.log(`[controls] listening on :${port} (BASE_PATH=${BASE_PATH})`);
});

export default app;
