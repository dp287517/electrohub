/**
 * server_controls.js — Controls (TSD) API (ESM)
 * - Hiérarchie dynamique qui autodétecte les colonnes (building/building_code, name/label/code, etc.)
 * - Bootstrap: auto-link des équipements -> controls_entities puis seed des tâches TSD
 * - Endpoints existants (tasks, schema, close, ai, attachments) conservés
 *
 * Monté sous: /api/controls
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

const app = express();
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
const router = express.Router();

function colorForCategory(catKey, taskCode = "") {
  const k = String(catKey || "").toUpperCase();
  if (k.includes("HV")) return "#ef4444";
  if (k.includes("ATEX")) return "#f59e0b";
  if (k.includes("SWITCH")) return "#3b82f6";
  if (taskCode.toLowerCase().includes("thermo")) return "#22c55e";
  return "#6366f1";
}

function addMonths(baseISO, months) {
  return dayjs.utc(baseISO).add(Number(months), "month").toISOString();
}
function addByFreq(baseISO, frequency) {
  if (!frequency) return null;
  const { interval, unit, min } = frequency;
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

async function getColumnsMeta(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name
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
  if (meta.id && isUuidColumn(meta.id) && !v.id) v.id = uuidv4();
  const pruned = pruneValuesByExistingColumns(v, meta);
  const { sql, params } = buildInsertSQL(table, pruned);
  const { rows } = await client.query(sql, params);
  return rows[0];
}
async function safeQuery(client, sql, params = []) {
  try { return await client.query(sql, params); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Helpers: détection dynamique des colonnes
// ---------------------------------------------------------------------------
const CANDIDATE = {
  building: ["building_code", "building", "site", "site_id"],
  name: ["name", "label", "title", "designation"],
  code: ["code", "ref", "reference"],
  sw_id: ["switchboard_id", "switchboard", "parent_switchboard_id", "panel_id"],
  zone: ["zone", "atex_zone", "area"],
};

function pickCol(meta, candidates) {
  for (const c of candidates) if (meta[c]) return c;
  return null;
}

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

function labelExpr(shape, alias = "label") {
  const parts = [];
  if (shape?.name) parts.push(shape.name);
  if (shape?.code) parts.push(shape.code);
  // COALESCE(name, code, 'TBL-'||id)
  const coalesce = [
    ...(shape?.name ? [`${shape.name}`] : []),
    ...(shape?.code ? [`${shape.code}`] : []),
    ...(shape?.id ? [`('${shape.table.slice(0,3).toUpperCase()}-'||${shape.id})`] : [`'${shape.table.toUpperCase()}'`]),
  ].join(", ");
  return `COALESCE(${coalesce}) AS ${alias}`;
}

function buildingExpr(shape, alias = "bld") {
  if (shape?.building) return `${shape.building}::text AS ${alias}`;
  // fallback: “Default”
  return `'Default'::text AS ${alias}`;
}

function zoneExpr(shape, alias = "zone") {
  if (shape?.zone) return `${shape.zone}::text AS ${alias}`;
  return `'Z?'::text AS ${alias}`;
}

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

// ---------------------------------------------------------------------------
// DEBUG — voir ce que le backend détecte
// ---------------------------------------------------------------------------
router.get("/hierarchy/debug", async (_req, res) => {
  const client = await pool.connect();
  try {
    const shapes = {};
    for (const tbl of ["hv_equipments", "hv_devices", "switchboards", "devices", "atex_equipments"]) {
      shapes[tbl] = await detectShape(client, tbl);
    }
    res.json({ shapes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Hierarchy/tree — dynamique & robuste
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  const client = await pool.connect();
  try {
    const sh = {};
    for (const tbl of ["hv_equipments", "hv_devices", "switchboards", "devices", "atex_equipments"]) {
      sh[tbl] = await detectShape(client, tbl);
    }

    // 1) Bâtiments: union des colonnes building/building_code…
    async function distinctBuildings(shape) {
      if (!shape) return [];
      const sql = `SELECT DISTINCT ${buildingExpr(shape, "b")} FROM ${shape.table} WHERE ${buildingExpr(shape, "b").split(" AS ")[0]} IS NOT NULL`;
      const rs = await safeQuery(client, sql);
      return (rs?.rows || []).map(r => String(r.b));
    }

    const allB = new Set();
    for (const tbl of ["switchboards", "devices", "hv_equipments", "hv_devices", "atex_equipments"]) {
      const arr = await distinctBuildings(sh[tbl]);
      arr.forEach(b => b && allB.add(b));
    }
    if (allB.size === 0) {
      const se = await safeQuery(client, `SELECT DISTINCT site::text AS b FROM controls_entities WHERE site IS NOT NULL`);
      (se?.rows || []).forEach(r => allB.add(String(r.b)));
    }
    if (allB.size === 0) allB.add("Default");

    // 2) Charger équipements par table (sélection dynamique)
    async function loadRows(shape) {
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
      const rs = await safeQuery(client, sql);
      return rs?.rows || [];
    }

    const hvEquip = await loadRows(sh["hv_equipments"]);
    const hvDev = await loadRows(sh["hv_devices"]);
    const sw = await loadRows(sh["switchboards"]);
    const dev = await loadRows(sh["devices"]);
    const atex = await loadRows(sh["atex_equipments"]);

    // Index
    const swByBuilding = new Map();
    for (const r of sw) {
      const b = String(r.building ?? "Default");
      if (!swByBuilding.has(b)) swByBuilding.set(b, []);
      swByBuilding.get(b).push({ id: r.id, label: r.label, code: r.code, devices: [], tasks: [] });
    }

    const devBySwitch = new Map();
    for (const r of dev) {
      const key = String(r.switchboard_id ?? "");
      if (!devBySwitch.has(key)) devBySwitch.set(key, []);
      devBySwitch.get(key).push({ id: r.id, label: r.label, code: r.code, tasks: [] });
    }

    const hvByBuilding = new Map();
    for (const r of [...hvEquip, ...hvDev]) {
      const b = String(r.building ?? "Default");
      if (!hvByBuilding.has(b)) hvByBuilding.set(b, []);
      hvByBuilding.get(b).push({ id: r.id, label: r.label, code: r.code, tasks: [] });
    }

    const atexByB = new Map(); // building -> Map(zone -> [equip])
    for (const r of atex) {
      const b = String(r.building ?? "Default");
      if (!atexByB.has(b)) atexByB.set(b, new Map());
      const byZone = atexByB.get(b);
      const zKey = String(r.zone ?? "Z?");
      if (!byZone.has(zKey)) byZone.set(zKey, []);
      byZone.get(zKey).push({ id: r.id, label: r.label, code: r.code, tasks: [] });
    }

    // Rattacher devices aux switchboards
    for (const [b, list] of swByBuilding.entries()) {
      for (const sb of list) {
        sb.devices = devBySwitch.get(String(sb.id)) || [];
      }
    }

    // 3) Nœuds de site
    const siteNodes = Array.from(allB.values())
      .sort((a,b)=>String(a).localeCompare(String(b)))
      .map(b => ({
        id: b,
        label: b,
        hv: hvByBuilding.get(b) || [],
        switchboards: swByBuilding.get(b) || [],
        atex: Array.from((atexByB.get(b) || new Map()).entries()).map(([zone, eqs]) => ({
          zone, equipments: eqs, tasks: []
        })),
        tasks: [],
      }));

    // 4) Lier tâches existantes par controls_entities
    const entMeta = await getColumnsMeta(client, "controls_entities");
    const has = (c) => !!entMeta[c];
    const entQ = await client.query(
      `SELECT id, site,
              ${has("equipment_table") ? "equipment_table" : "NULL AS equipment_table"},
              ${has("equipment_id") ? "equipment_id" : "NULL AS equipment_id"},
              ${has("switchboard_id") ? "switchboard_id" : "NULL AS switchboard_id"},
              ${has("hv_id") ? "hv_id" : "NULL AS hv_id"},
              ${has("atex_id") ? "atex_id" : "NULL AS atex_id"}
       FROM controls_entities`
    );
    const entMap = new Map(entQ.rows.map(r => [String(r.id), r]));

    const tasksQ = await client.query(
      `SELECT id, task_name, task_code, status, next_control, entity_id, site
       FROM controls_tasks
       ORDER BY next_control ASC NULLS LAST`
    );

    const siteById = new Map(siteNodes.map(s => [String(s.id), s]));

    function attachTaskToNodeByEntity(task, ent) {
      const siteKey = String(ent?.site || task.site || "Default");
      const siteNode = siteById.get(siteKey) || siteNodes.find(s => String(s.id) === siteKey) || siteNodes[0];
      const tObj = {
        id: task.id,
        label: task.task_name,
        code: task.task_code,
        status: task.status,
        due_date: task.next_control,
        color: colorForCategory(resolveTsdForTask(task).category?.key, task.task_code),
      };

      const eqTable = String(ent?.equipment_table || "").toLowerCase();
      const eqId = String(ent?.equipment_id || "");

      if (eqTable.includes("hv")) {
        const list = siteNode.hv || [];
        const found = list.find(h => String(h.id) === eqId);
        if (found) found.tasks.push(tObj);
        else if (list.length) list[0].tasks.push(tObj);
        else siteNode.hv = [{ id:"hv", label:"High voltage", tasks:[tObj] }];
        return;
      }
      if (eqTable.includes("switchboard")) {
        const list = siteNode.switchboards || [];
        const found = list.find(s => String(s.id) === eqId);
        if (found) found.tasks.push(tObj);
        else if (list.length) list[0].tasks.push(tObj);
        else siteNode.switchboards = [{ id:"sw", label:"Switchboards", devices:[], tasks:[tObj] }];
        return;
      }
      if (eqTable.includes("device")) {
        const list = siteNode.switchboards || [];
        let placed = false;
        if (ent?.switchboard_id) {
          const sb = list.find(s => String(s.id) === String(ent.switchboard_id));
          if (sb) {
            const dv = (sb.devices || []).find(d => String(d.id) === eqId);
            if (dv) { dv.tasks.push(tObj); placed = true; }
          }
        }
        if (!placed) {
          if (list.length && list[0].devices?.length) list[0].devices[0].tasks.push(tObj);
          else {
            if (!siteNode.switchboards?.length)
              siteNode.switchboards = [{ id:"sw", label:"Switchboards", devices:[], tasks:[] }];
            siteNode.switchboards[0].devices = siteNode.switchboards[0].devices || [];
            if (!siteNode.switchboards[0].devices.length)
              siteNode.switchboards[0].devices.push({ id:"dev", label:"Devices", tasks:[] });
            siteNode.switchboards[0].devices[0].tasks.push(tObj);
          }
        }
        return;
      }
      if (eqTable.includes("atex")) {
        const zones = siteNode.atex || [];
        let done = false;
        for (const z of zones) {
          const eq = (z.equipments || []).find(e => String(e.id) === eqId);
          if (eq) { eq.tasks.push(tObj); done = true; break; }
        }
        if (!done) {
          let z = zones.find(z => String(z.zone) === "Z?");
          if (!z) { z = { zone: "Z?", equipments: [], tasks: [] }; zones.push(z); }
          z.tasks.push(tObj);
        }
        return;
      }
      (siteNode.tasks = siteNode.tasks || []).push(tObj);
    }

    for (const t of tasksQ.rows) {
      const ent = entMap.get(String(t.entity_id));
      if (!ent) continue; // on ignore les tâches orphelines
      attachTaskToNodeByEntity(t, ent);
    }

    res.json(siteNodes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Bootstrap: auto-link des équipements -> entities + seed TSD
// ---------------------------------------------------------------------------
router.get("/bootstrap/auto-link", async (req, res) => {
  const doCreate = String(req.query.create || "1") === "1";
  const doSeed = String(req.query.seed || "0") === "1";
  try {
    const out = await withTx(async (client) => {
      const actions = [];

      // Détection tables
      const sh = {};
      for (const tbl of ["hv_equipments", "hv_devices", "switchboards", "devices", "atex_equipments"]) {
        sh[tbl] = await detectShape(client, tbl);
      }

      // Charger toutes les lignes (shape-aware)
      async function loadRows(shape) {
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
        const rs = await safeQuery(client, sql);
        return rs?.rows || [];
      }
      const hvEquip = await loadRows(sh["hv_equipments"]);
      const hvDev = await loadRows(sh["hv_devices"]);
      const sw = await loadRows(sh["switchboards"]);
      const dev = await loadRows(sh["devices"]);
      const atex = await loadRows(sh["atex_equipments"]);

      // Map db_table -> catégorie TSD
      const catsByDbTable = new Map();
      for (const c of tsdLibrary.categories || []) {
        if (c.db_table) catsByDbTable.set(String(c.db_table).toLowerCase(), c);
      }
      const catHV = findCategoryByKeyOrLabel("hv_switchgear") || catsByDbTable.get("hv") || catsByDbTable.get("hv_equipments");
      const catSW = catsByDbTable.get("switchboards");
      const catDEV = catsByDbTable.get("devices");
      const catATEX = catsByDbTable.get("atex_equipments");

      async function ensureEntity(equipment_table, row) {
        const exists = await client.query(
          `SELECT id FROM controls_entities WHERE equipment_table=$1 AND equipment_id=$2 LIMIT 1`,
          [equipment_table, row.id]
        );
        if (exists.rowCount) return { id: exists.rows[0].id, created: false };

        if (!doCreate) return { id: null, created: false };

        const now = new Date().toISOString();
        const ent = await insertRow(client, "controls_entities", {
          site: String(row.building ?? "Default"),
          name: row.label,
          equipment_type: equipment_table,
          equipment_ref: row.code || null,
          related_type: equipment_table,
          related_id: row.id,
          // colonnes souples :
          equipment_table,
          equipment_id: row.id,
          switchboard_id: equipment_table === "devices" ? row.switchboard_id ?? null : null,
          atex_id: equipment_table === "atex_equipments" ? row.id : null,
          hv_id: equipment_table.startsWith("hv") ? row.id : null,
          code: row.code || null,
          created_at: now,
          updated_at: now,
        });
        actions.push({ action: "entity_created", equipment_table, equipment_id: row.id, entity_id: ent.id });
        return { id: ent.id, created: true };
      }

      async function seedTasks(entity_id, site, cat) {
        if (!doSeed || !cat) return;
        for (const ctrl of cat.controls || []) {
          const ex = await client.query(
            `SELECT 1 FROM controls_tasks
             WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
            [entity_id, ctrl.type]
          );
          if (ex.rowCount) { actions.push({ action:"seed_exists", entity_id, task_code: ctrl.type }); continue; }

          const months = monthsFromFreq(ctrl.frequency);
          const nextCtrl = (months
            ? addMonths(new Date().toISOString(), months)
            : addByFreq(new Date().toISOString(), ctrl.frequency)) || dayjs.utc().add(30,"day").toISOString();

          await insertRow(client, "controls_tasks", {
            site,
            entity_id,
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
          actions.push({ action:"task_seeded", entity_id, task_code: ctrl.type });
        }
      }

      // HV
      for (const r of [...hvEquip, ...hvDev]) {
        const ent = await ensureEntity("hv", r);
        if (ent.id) await seedTasks(ent.id, String(r.building ?? "Default"), catHV);
      }
      // Switchboards
      for (const r of sw) {
        const ent = await ensureEntity("switchboards", r);
        if (ent.id) await seedTasks(ent.id, String(r.building ?? "Default"), catSW);
      }
      // Devices
      for (const r of dev) {
        const ent = await ensureEntity("devices", r);
        if (ent.id) await seedTasks(ent.id, String(r.building ?? "Default"), catDEV);
      }
      // ATEX
      for (const r of atex) {
        const ent = await ensureEntity("atex_equipments", r);
        if (ent.id) await seedTasks(ent.id, String(r.building ?? "Default"), catATEX);
      }

      return { actions };
    });

    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// TASKS (liste + schema + attachments + close) — identique
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q, status, site, entity_id,
    due_from, due_to,
    page = 1, page_size = 50, order = "due_date.asc",
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
      tools_md: control?.tools_md || task.tools_md || "",
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

// ---------------------------------------------------------------------------
// Mount + Boot
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
