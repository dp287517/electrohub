
// == server_controls.js (ESM) ===============================================
// See previous cell for a full description. This is the same content, re-written.

import express from "express";
import multer from "multer";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

// DB -------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Load TSD -------------------------------------------------------------------
let tsdLibrary;
{
  const mod = await import("./tsd_library.js");
  tsdLibrary = mod.tsdLibrary ?? mod.default?.tsdLibrary ?? mod.default ?? mod;
  if (!tsdLibrary || !Array.isArray(tsdLibrary.categories)) {
    throw new Error("tsd_library.js invalide: attendu { tsdLibrary: { categories:[...] } }");
  }
}
const RESULT_OPTIONS = tsdLibrary?.meta?.result_options ?? [
  "Conforme","Non conforme","Non applicable"
];

// Utils ----------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

async function q(client, sql, params=[]) { return client.query(sql, params); }
async function safeQ(client, sql, params=[]) { try { return await client.query(sql, params); } catch { return null; } }
async function withTx(fn) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const res = await fn(c); await c.query("COMMIT"); return res; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}
async function getCols(client, table) {
  const { rows } = await q(client, `SELECT column_name, data_type, udt_name
                                    FROM information_schema.columns
                                    WHERE table_schema='public' AND table_name=$1`, [table]);
  const m = {}; rows.forEach(r => m[r.column_name] = r); return m;
}
function hasCol(cols, name) { return !!cols[name]; }
function val(row, ...c) { for (const k of c) { if (row[k] !== undefined && row[k] !== null) return row[k]; } return null; }
function colorFor(catKey, taskCode="") {
  const k = String(catKey||"").toUpperCase();
  if (k.includes("HV")) return "#ef4444";
  if (k.includes("ATEX")) return "#f59e0b";
  if (k.includes("SWITCH")) return "#3b82f6";
  if (taskCode.toLowerCase().includes("thermo")) return "#22c55e";
  return "#6366f1";
}
function unitToMonths(interval, unit) {
  const u = String(unit || "").toLowerCase(); const n = Number(interval);
  if (u.startsWith("year")) return n*12;
  if (u.startsWith("month")) return n;
  if (u.startsWith("week")) return Math.max(1, Math.round(n/4));
  if (u.startsWith("day")) return Math.max(1, Math.round(n/30));
  return null;
}
function monthsFromFreq(freq) {
  if (!freq) return null;
  if (freq.min && freq.min.interval && freq.min.unit) return unitToMonths(freq.min.interval, freq.min.unit);
  if (freq.interval && freq.unit) return unitToMonths(freq.interval, freq.unit);
  return null;
}
function addMonthsISO(baseISO, months) { return dayjs.utc(baseISO).add(Number(months), "month").toISOString(); }
function addByFreqISO(baseISO, freq) { const m = monthsFromFreq(freq); return m ? addMonthsISO(baseISO, m) : null; }
function findCategoryByKeyOrLabel(keyOrLabel) {
  if (!keyOrLabel) return null;
  const low = String(keyOrLabel).toLowerCase();
  return (tsdLibrary.categories || []).find(
    (c) => (c.key && String(c.key).toLowerCase() === low) ||
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

// App ------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
const router = express.Router();

// Health + TSD ---------------------------------------------------------------
router.get("/health", async (_req, res) => {
  try { const { rows } = await pool.query(`SELECT NOW() AS now`);
    res.json({ ok:true, db:true, now: rows?.[0]?.now || null, tsd_loaded: !!tsdLibrary, categories: (tsdLibrary.categories||[]).length });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
router.get("/tsd", (_req, res) => {
  res.json({
    meta: tsdLibrary.meta || {},
    categories: (tsdLibrary.categories || []).map(c => ({ key:c.key, label:c.label, db_table:c.db_table, expected:(c.controls||[]).map(t=>t.type) })),
  });
});

// Entities sync --------------------------------------------------------------
function normalizeEquipRow(row, source) {
  const building = val(row, "building", "building_code", "site", "site_code", "site_name");
  const site = val(row, "site", "site_code", "site_name", "building", "building_code");
  const name = val(row, "label", "name", "title", "code") || `${source} ${row.id}`;
  const code = val(row, "code", "ref", "reference", "name");
  const zone = val(row, "zone", "atex_zone", "zone_code");
  const switchboard_id = val(row, "switchboard_id", "parent_switchboard_id");
  let equipment_type = source;
  if (source === "hv_equipments" || source === "hv_devices") equipment_type = "high_voltage";
  if (source === "devices") equipment_type = "device";
  if (source === "switchboards") equipment_type = "switchboard";
  if (source === "atex_equipments") equipment_type = "atex";
  return {
    site: site || "Default",
    building: building || site || "Default",
    name,
    equipment_type,
    code: code || null,
    related_type: source,
    related_id: row.id,
    atex_zone: zone || null,
    parent_switchboard_id: switchboard_id || null,
    device_id: source === "devices" ? row.id : null,
    switchboard_id: source === "switchboards" ? row.id : (switchboard_id || null),
    hv_id: (source === "hv_equipments" || source === "hv_devices") ? row.id : null,
    atex_id: source === "atex_equipments" ? row.id : null,
  };
}
async function upsertEntity(client, norm) {
  const ex = await q(client, `SELECT id FROM controls_entities WHERE related_type=$1 AND related_id=$2 LIMIT 1`, [norm.related_type, norm.related_id]);
  if (ex.rowCount) {
    const id = ex.rows[0].id;
    await q(client, `UPDATE controls_entities
                        SET site=$2, building=$3, name=$4, equipment_type=$5, code=$6,
                            atex_zone=$7, parent_switchboard_id=$8, device_id=$9, switchboard_id=$10, hv_id=$11, atex_id=$12,
                            updated_at=NOW()
                      WHERE id=$1`,
      [id, norm.site, norm.building, norm.name, norm.equipment_type, norm.code,
       norm.atex_zone, norm.parent_switchboard_id, norm.device_id, norm.switchboard_id, norm.hv_id, norm.atex_id]);
    return { id, action:"updated" };
  } else {
    const { rows } = await q(client, `INSERT INTO controls_entities
        (site, building, name, equipment_type, code, related_type, related_id,
         atex_zone, parent_switchboard_id, device_id, switchboard_id, hv_id, atex_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
       RETURNING id`,
      [norm.site, norm.building, norm.name, norm.equipment_type, norm.code, norm.related_type, norm.related_id,
       norm.atex_zone, norm.parent_switchboard_id, norm.device_id, norm.switchboard_id, norm.hv_id, norm.atex_id]);
    return { id: rows[0].id, action:"created" };
  }
}
router.get("/bootstrap/sync-entities", async (req, res) => {
  const dry = String(req.query.dry_run || "1") === "1";
  try {
    const report = await withTx(async (client) => {
      const out = { created:[], updated:[], errors:[] };
      const tables = ["switchboards","devices","hv_equipments","hv_devices","atex_equipments"];
      const present = [];
      for (const t of tables) { const ok = await safeQ(client, `SELECT 1 FROM ${t} LIMIT 1`); if (ok) present.push(t); }
      for (const t of present) {
        const cols = await getCols(client, t);
        const sel = [
          "id",
          hasCol(cols,"label") ? "label" : (hasCol(cols,"name") ? "name" : "null as label"),
          hasCol(cols,"name") ? "name" : "null as name",
          hasCol(cols,"code") ? "code" : "null as code",
          hasCol(cols,"building") ? "building" : (hasCol(cols,"building_code") ? "building_code as building" : "null as building"),
          hasCol(cols,"site") ? "site" : (hasCol(cols,"site_id") ? "site_id as site" : "null as site"),
          hasCol(cols,"zone") ? "zone" : (hasCol(cols,"atex_zone") ? "atex_zone as zone" : "null as zone"),
          hasCol(cols,"switchboard_id") ? "switchboard_id" : (hasCol(cols,"parent_switchboard_id") ? "parent_switchboard_id as switchboard_id" : "null as switchboard_id"),
        ].join(",");
        const { rows } = await q(client, `SELECT ${sel} FROM ${t}`);
        for (const r of rows) {
          try {
            const norm = normalizeEquipRow(r, t);
            if (dry) out.created.push({ table:t, related_id:r.id, dry:true });
            else {
              const resUp = await upsertEntity(client, norm);
              out[resUp.action === "created" ? "created" : "updated"].push({ table:t, id: resUp.id, related_id:r.id });
            }
          } catch (e) { out.errors.push({ table:t, related_id:r?.id, error:e.message }); }
        }
      }
      return { present_tables:present, total_created: out.created.length, total_updated: out.updated.length, details: out };
    });
    res.json(report);
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Seed tasks -----------------------------------------------------------------
router.get("/bootstrap/seed", async (req, res) => {
  const dry = String(req.query.dry_run || "1") === "1";
  const categoryParam = req.query.category || "ALL";
  const siteFilter = req.query.site || null;
  try {
    const report = await withTx(async (client) => {
      const ents = await q(client, siteFilter ? `SELECT * FROM controls_entities WHERE site=$1` : `SELECT * FROM controls_entities`, siteFilter ? [siteFilter] : []);
      const categories = (categoryParam && categoryParam !== "ALL")
        ? [findCategoryByKeyOrLabel(categoryParam)].filter(Boolean)
        : (tsdLibrary.categories || []);
      const actions = [];
      for (const e of ents.rows) {
        for (const cat of categories) {
          if (!cat) continue;
          if (cat.db_table) {
            const want = String(cat.db_table).toLowerCase();
            const got = String(e.related_type || e.equipment_type || "").toLowerCase();
            if (!got.includes(want) && !(want.includes("switch") && got.includes("switch"))) continue;
          }
          for (const ctrl of (cat.controls || [])) {
            const exists = await q(client,
              `SELECT 1 FROM controls_tasks WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
              [e.id, ctrl.type]
            );
            if (exists.rowCount) { actions.push({ entity_id:e.id, cat:cat.key||cat.label, task_code:ctrl.type, action:"skipped_exists" }); continue; }
            const months = monthsFromFreq(ctrl.frequency);
            const nextCtrl = (months ? addMonthsISO(new Date().toISOString(), months) : addByFreqISO(new Date().toISOString(), ctrl.frequency)) || dayjs.utc().add(30,"day").toISOString();
            actions.push({ entity_id:e.id, cat:cat.key||cat.label, task_code:ctrl.type, action: dry?"would_create":"created" });
            if (!dry) {
              await q(client,
                `INSERT INTO controls_tasks
                   (site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status, value_type,
                    result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,NULL,$6,'Planned',$7,
                         NULL,$8,$9,$10,$11,'seed',NOW(),NOW())`,
                [ e.site || "Default", e.id, `${cat.label} – ${ctrl.type}`, ctrl.type,
                  months || null, nextCtrl, ctrl.value_type || "checklist",
                  ctrl.procedure_md || "", ctrl.hazards_md || "", ctrl.ppe_md || "", ctrl.tools_md || "" ]
              );
            }
          }
        }
      }
      return { entities: ents.rowCount, actions };
    });
    res.json({ ok:true, dry_run: dry, ...report });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Hierarchy (strict) ---------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const entCols = await getCols(client, "controls_entities");
      const entSel = [
        "id","site","building","name","equipment_type","code","related_type","related_id",
        hasCol(entCols,"switchboard_id") ? "switchboard_id" : "NULL AS switchboard_id",
        hasCol(entCols,"device_id") ? "device_id" : "NULL AS device_id",
        hasCol(entCols,"hv_id") ? "hv_id" : "NULL AS hv_id",
        hasCol(entCols,"atex_id") ? "atex_id" : "NULL AS atex_id",
        hasCol(entCols,"atex_zone") ? "atex_zone" : "NULL AS atex_zone",
        hasCol(entCols,"parent_switchboard_id") ? "parent_switchboard_id" : "NULL AS parent_switchboard_id"
      ].join(",");
      const ents = await q(client, `SELECT ${entSel} FROM controls_entities`);
      const tasks = await q(client,
        `SELECT id, entity_id, task_name, task_code, status, next_control
         FROM controls_tasks
         WHERE entity_id IS NOT NULL
         ORDER BY next_control ASC NULLS LAST`
      );
      const tasksByEnt = new Map();
      for (const t of tasks.rows) {
        const arr = tasksByEnt.get(t.entity_id) || [];
        arr.push(t); tasksByEnt.set(t.entity_id, arr);
      }
      const siteTable = await safeQ(client, `SELECT id, name, label FROM sites`);
      const buildings = [];
      if (siteTable && siteTable.rows.length) {
        for (const s of siteTable.rows) buildings.push({ key:String(s.id ?? s.name ?? s.label), label: s.label || s.name || `Site ${s.id}` });
      } else {
        const uniq = new Set(); for (const e of ents.rows) uniq.add(e.building || e.site || "Default");
        for (const b of uniq) buildings.push({ key:String(b), label:String(b) });
      }
      const out = buildings.map(b => ({ id: b.key, label: b.label, hv: [], switchboards: [], atex: [], tasks: [] }));
      const byBuilding = new Map(out.map(o => [String(o.label), o])); const byId = new Map(out.map(o => [String(o.id), o]));
      function pickBuildingNode(e) { return byId.get(String(e.site)) || byBuilding.get(String(e.building)) || byBuilding.get(String(e.site)) || out[0]; }
      const swMap = new Map(); const atexByBuildingZone = new Map();
      for (const e of ents.rows) {
        const bNode = pickBuildingNode(e);
        const entTasks = (tasksByEnt.get(e.id) || []).map(t => ({
          id: t.id, label: t.task_name, code: t.task_code, status: t.status, due_date: t.next_control,
          color: colorFor(resolveTsdForTask(t).category?.key, t.task_code),
        }));
        const type = String(e.equipment_type || e.related_type || "").toLowerCase();
        if (type.includes("hv")) { bNode.hv.push({ id:e.id, label:e.name || `HV ${e.related_id || e.hv_id}`, tasks: entTasks }); continue; }
        if (type.includes("switch")) {
          const key = `${bNode.id || bNode.label}::${e.related_id || e.switchboard_id || e.id}`;
          if (!swMap.has(key)) { const swNode = { id:e.id, label:e.name || `SW ${e.related_id || e.switchboard_id}`, devices: [], tasks: entTasks }; bNode.switchboards.push(swNode); swMap.set(key, swNode); }
          else { const swNode = swMap.get(key); swNode.tasks.push(...entTasks); }
          continue;
        }
        if (type.includes("device")) {
          const swId = e.parent_switchboard_id || e.switchboard_id;
          const key = `${bNode.id || bNode.label}::${swId || "no-sw"}`;
          let swNode = swMap.get(key);
          if (!swNode) { swNode = { id: swId || `sw-${key}`, label: swId ? `SW ${swId}` : "Switchboard (inconnu)", devices: [], tasks: [] }; bNode.switchboards.push(swNode); swMap.set(key, swNode); }
          swNode.devices.push({ id:e.id, label:e.name || `Device ${e.related_id || e.device_id}`, tasks: entTasks });
          continue;
        }
        if (type.includes("atex")) {
          const zone = e.atex_zone || "Z?";
          const bkey = String(bNode.id || bNode.label);
          if (!atexByBuildingZone.has(bkey)) atexByBuildingZone.set(bkey, new Map());
          const zoneMap = atexByBuildingZone.get(bkey);
          if (!zoneMap.has(zone)) { const zNode = { zone, equipments: [], tasks: [] }; bNode.atex.push(zNode); zoneMap.set(zone, zNode); }
          const zNode = zoneMap.get(zone);
          zNode.equipments.push({ id:e.id, label:e.name || `ATEX ${e.related_id || e.atex_id}`, tasks: entTasks });
          continue;
        }
        bNode.tasks.push(...entTasks);
      }
      function addMissingForNode(node, catKeyGuess) {
        const missing = []; const active = new Set(); (node.tasks||[]).forEach(t => active.add(String(t.code).toLowerCase()));
        let cat = catKeyGuess ? findCategoryByKeyOrLabel(catKeyGuess) : null;
        if (!cat) { const label = String(node.label||"").toLowerCase();
          cat = (tsdLibrary.categories||[]).find(c => {
            const key = String(c.key||"").toLowerCase(); const lab = String(c.label||"").toLowerCase();
            return label.includes(key) || label.includes(lab);
          }) || null;
        }
        if (cat) { for (const ctrl of (cat.controls||[])) {
          const code = String(ctrl.type).toLowerCase(); if (!active.has(code)) missing.push(ctrl.type);
        }}
        if (missing.length) node.missing_controls = missing;
      }
      for (const b of out) {
        for (const h of b.hv) addMissingForNode(h, "hv");
        for (const s of b.switchboards) { addMissingForNode(s, "switchboard"); for (const d of (s.devices||[])) addMissingForNode(d, "device"); }
        for (const z of b.atex) { addMissingForNode(z, "atex"); for (const e of (z.equipments||[])) addMissingForNode(e, "atex"); }
      }
      res.json(out);
    } finally { client.release(); }
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// Tasks: schema/history/attachments/close -----------------------------------
router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Tâche introuvable" });
    const task = rows[0];
    const { category, control } = resolveTsdForTask(task);
    const checklist = (control?.checklist || []).map((it, idx) => ({
      key: it.key ?? it.id ?? `i_${idx}`,
      label: it.label || it.text || `Item ${idx+1}`,
      options: Array.isArray(it.options) && it.options.length ? it.options : RESULT_OPTIONS
    }));
    res.json({
      task_id: task.id, label: task.task_name, task_code: task.task_code,
      frequency: control?.frequency || null,
      checklist,
      observations: (control?.observations || []).map((o,i)=>({ key:o.key||`o_${i}`, label:o.label||o })),
      procedure_md: control?.procedure_md || task.procedure_md || "",
      hazards_md: control?.hazards_md || task.hazards_md || "",
      ppe_md: control?.ppe_md || task.ppe_md || "",
      tools_md: control?.tools_md || task.tools_md || "",
      tsd_category: category ? { key: category.key, label: category.label } : null,
      ui: { category_key: category?.key || null, color: colorFor(category?.key, task.task_code) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/tasks/:id/history", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM controls_history WHERE task_id=$1 ORDER BY date DESC, id DESC`, [id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/tasks/:id/attachments", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, mimetype, size, uploaded_at, created_at
       FROM controls_attachments WHERE task_id=$1 ORDER BY uploaded_at DESC NULLS LAST, created_at DESC`, [id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/attachments/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT filename, mimetype, data FROM controls_attachments WHERE id=$1`, [id]);
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
    const { rows: t } = await pool.query(`SELECT id, entity_id, site FROM controls_tasks WHERE id=$1`, [id]);
    if (!t.length) return res.status(404).json({ error: "Tâche introuvable" });
    const site = t[0].site || "Default";
    await pool.query(
      `INSERT INTO controls_attachments (site, record_id, task_id, entity_id, filename, mimetype, size, data, uploaded_at, created_at)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
      [site, id, t[0].entity_id, originalname, mimetype, size, buffer]
    );
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const { record_status = "done", checklist = [], observations = {}, attachments = [], actor_id = null, closed_at = new Date().toISOString(), comment = "" } = req.body || {};
  try {
    const out = await withTx(async (client) => {
      const { rows: taskRows } = await q(client,
        `SELECT t.*, e.site AS entity_site
         FROM controls_tasks t
         LEFT JOIN controls_entities e ON e.id = t.entity_id
         WHERE t.id = $1`, [id]);
      if (!taskRows.length) throw new Error("Tâche introuvable");
      const task = taskRows[0]; const site = task.site || task.entity_site || "Default";
      await q(client,
        `INSERT INTO controls_records
           (site, task_id, entity_id, performed_at, performed_by, lang, result_status,
            numeric_value, text_value, checklist_result, ai_result, comments, task_code, created_at, created_by, results)
         VALUES ($1,$2,$3,$4,$5,'fr',$6,NULL,NULL,$7,NULL,$8,$9,NOW(),$5,$10)`,
        [site, task.id, task.entity_id, closed_at, (actor_id||"system"), record_status, JSON.stringify(checklist||[]), comment||"", task.task_code, JSON.stringify(observations||{})]
      );
      for (const a of attachments) {
        const filename = a.filename || a.name || `file-${Date.now()}`;
        const mimetype = a.mimetype || a.mime || "application/octet-stream";
        const size = a.bytes || a.size || null;
        const dataBuf = a.data && typeof a.data === "string" ? Buffer.from(a.data, "base64") : null;
        await q(client,
          `INSERT INTO controls_attachments
             (site, record_id, task_id, entity_id, filename, mimetype, size, data, uploaded_at, created_at)
           VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
          [site, task.id, task.entity_id, filename, mimetype, size, dataBuf]
        );
      }
      await q(client, `UPDATE controls_tasks SET status='Done', last_control=$2, updated_at=NOW() WHERE id=$1`, [task.id, closed_at]);
      // replan
      const { control } = resolveTsdForTask(task);
      const months = (task.frequency_months && Number(task.frequency_months)) || monthsFromFreq(control?.frequency) || null;
      const nextDue = (months ? addMonthsISO(closed_at, months) : addByFreqISO(closed_at, control?.frequency)) || dayjs.utc(closed_at).add(6,"month").toISOString();
      const { rows: nxt } = await q(client,
        `INSERT INTO controls_tasks
           (site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status,
            value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Planned',$8,NULL,$9,$10,$11,$12,$13,NOW(),NOW())
         RETURNING id, next_control, status`,
        [site, task.entity_id, task.task_name, task.task_code, months || null, closed_at, nextDue,
         task.value_type || "checklist", task.procedure_md, task.hazards_md, task.ppe_md, task.tools_md, (actor_id||"system")]
      );
      return { closed: task.id, next_task: { id: nxt[0].id, due_date: nxt[0].next_control, status: nxt[0].status } };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Filters & Calendar ---------------------------------------------------------
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/calendar", async (req, res) => {
  const { from, to, site } = req.query;
  const where = []; const params = []; let i = 1;
  if (from) { where.push(`t.next_control >= $${i}`); params.push(from); i++; }
  if (to) { where.push(`t.next_control <= $${i}`); params.push(to); i++; }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }
  where.push(`t.entity_id IS NOT NULL`);
  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.task_name, t.task_code, t.status, t.next_control, t.entity_id
       FROM controls_tasks t
       ${whereSQL}
       ORDER BY t.next_control ASC NULLS LAST`,
      params
    );
    const groups = rows.reduce((acc, r) => {
      const due = r.next_control; if (!due) return acc;
      const k = dayjs.utc(due).format("YYYY-MM-DD");
      const { category } = resolveTsdForTask(r);
      (acc[k] = acc[k] || []).push({
        id: r.id, label: r.task_name, status: r.status, due_date: r.next_control, task_code: r.task_code,
        color: colorFor(category?.key, r.task_code),
      });
      return acc;
    }, {});
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mount + Boot ---------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
