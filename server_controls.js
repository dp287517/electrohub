/**
 * server_controls.js — ESM (type: module)
 * API Controls (TSD) — Hiérarchie équipements stricte + Checklist + IA + Gantt
 *
 * Monté sous: /api/controls  (configurable via CONTROLS_BASE_PATH)
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
function addMonthsISO(baseISO, months) {
  return dayjs.utc(baseISO).add(Number(months), "month").toISOString();
}
function addByFreq(baseISO, frequency) {
  if (!frequency) return null;
  const { interval, unit, min } = frequency;
  if (min?.interval && min?.unit) return dayjs.utc(baseISO).add(min.interval, min.unit).toISOString();
  if (interval && unit) return dayjs.utc(baseISO).add(interval, unit).toISOString();
  return null;
}
function colorForCategory(catKey, taskCode = "") {
  const k = String(catKey || "").toUpperCase();
  if (k.includes("HV")) return "#ef4444";           // rouge
  if (k.includes("ATEX")) return "#f59e0b";         // amber
  if (k.includes("SWITCH")) return "#3b82f6";       // blue
  if (taskCode.toLowerCase().includes("thermo")) return "#22c55e"; // vert
  return "#6366f1"; // indigo default
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
async function safeQuery(client, sql, params = []) {
  try { return await client.query(sql, params); } catch { return null; }
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
// Health / TSD minimal
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
// TASK SCHEMA — checklist lisible (labels TSD)
// ---------------------------------------------------------------------------
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
      return { key, label, options };
    });

    res.json({
      task_id: task.id,
      label: task.task_name,
      task_code: task.task_code,
      frequency: control?.frequency || null,
      checklist,
      observations: (control?.observations || []).map((o, i) => ({
        key: o.key ?? `obs_${i}`,
        label: o.label ?? o,
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

// ---------------------------------------------------------------------------
// ATTACHMENTS
// ---------------------------------------------------------------------------
// liste
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
// download
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
// upload
router.post("/tasks/:id/attachments", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const { originalname, mimetype, size, buffer } = req.file || {};
  if (!buffer) return res.status(400).json({ error: "Aucun fichier reçu" });
  try {
    const { rows: t } = await pool.query(`SELECT id, entity_id, site FROM controls_tasks WHERE id = $1`, [id]);
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
// CLOSE & RESCHEDULE
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

      // éventuels fichiers inline en base64 (rare, mais supporté)
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

      // historique
      await insertRow(client, "controls_history", {
        task_id: task.id,
        user: actor_id || "system",
        action: "task_closed",
        site,
        date: closed_at,
        task_name: task.task_name,
        meta: JSON.stringify({ checklist_count: (checklist||[]).length }),
      });

      // replanif
      const { control } = resolveTsdForTask(task);
      const months =
        (task.frequency_months && Number(task.frequency_months)) ||
        monthsFromFreq(control?.frequency) ||
        null;

      const nextDue =
        (months ? addMonthsISO(closed_at, months) : addByFreq(closed_at, control?.frequency)) ||
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

// ---------------------------------------------------------------------------
// HIERARCHY/TREE — robuste aux schémas (label optionnel)
//   Bâtiment → HV / Switchboards → Devices / ATEX
//   Aucune tâche “orpheline” : uniquement celles liées via controls_entities.*_id
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      // petit helper: fabrique une clause SELECT avec "NULL AS alias" si la colonne n'existe pas
      const getColsMeta = (table) => getColumnsMeta(client, table);
      const sel = (meta, col, alias = col) =>
        (meta[col] ? `${col}` : `NULL`) + (alias && alias !== col ? ` AS ${alias}` : "");

      // --- Métas
      const metaSW  = await getColsMeta("switchboards");
      const metaDEV = await getColsMeta("devices");
      const metaHVE = await getColsMeta("hv_equipments");
      const metaHVD = await getColsMeta("hv_devices");
      const metaATX = await getColsMeta("atex_equipments");

      // --- Queries sûres (sans référence directe à une colonne manquante)
      const qSW  = `
        SELECT
          ${sel(metaSW, "id")},
          ${sel(metaSW, "name")},
          ${sel(metaSW, "label")},
          ${sel(metaSW, "code")},
          ${sel(metaSW, "building_code")}
        FROM switchboards
        ORDER BY ${metaSW.building_code ? "building_code" : "id"} NULLS LAST, ${metaSW.name ? "name" : "id"} NULLS LAST, id ASC
      `;

      const qDEV = `
        SELECT
          ${sel(metaDEV, "id")},
          ${sel(metaDEV, "name")},
          ${sel(metaDEV, "label")},
          ${sel(metaDEV, "code")},
          ${sel(metaDEV, "building_code")},
          ${sel(metaDEV, "switchboard_id")},
          ${sel(metaDEV, "switchboard_code")}
        FROM devices
        ORDER BY ${metaDEV.building_code ? "building_code" : "id"} NULLS LAST, ${metaDEV.switchboard_id ? "switchboard_id" : "id"} NULLS LAST, ${metaDEV.name ? "name" : "id"} NULLS LAST, id ASC
      `;

      const qHVE = `
        SELECT
          ${sel(metaHVE, "id")},
          ${sel(metaHVE, "name")},
          ${sel(metaHVE, "label")},
          ${sel(metaHVE, "code")},
          ${sel(metaHVE, "building_code")}
        FROM hv_equipments
        ORDER BY ${metaHVE.building_code ? "building_code" : "id"} NULLS LAST, ${metaHVE.name ? "name" : "id"} NULLS LAST, id ASC
      `;

      const qHVD = `
        SELECT
          ${sel(metaHVD, "id")},
          ${sel(metaHVD, "name")},
          ${sel(metaHVD, "label")},
          ${sel(metaHVD, "code")},
          ${sel(metaHVD, "building_code")},
          ${sel(metaHVD, "equipment_code")},
          ${sel(metaHVD, "hv_equipment_id")}
        FROM hv_devices
        ORDER BY ${metaHVD.building_code ? "building_code" : "id"} NULLS LAST, ${metaHVD.name ? "name" : "id"} NULLS LAST, id ASC
      `;

      // ⚠️ ATEX : 'building' (pas building_code)
      const qATX = `
        SELECT
          ${sel(metaATX, "id")},
          ${sel(metaATX, "name")},
          ${sel(metaATX, "label")},
          ${sel(metaATX, "code")},
          ${sel(metaATX, "building")},
          ${sel(metaATX, "zone")}
        FROM atex_equipments
        ORDER BY ${metaATX.building ? "building" : "id"} NULLS LAST, ${metaATX.zone ? "zone" : "id"} NULLS LAST, ${metaATX.name ? "name" : "id"} NULLS LAST, id ASC
      `;

      // --- Exécution
      const [sw, dev, hve, hvd, aeq] = await Promise.all([
        client.query(qSW),
        client.query(qDEV),
        client.query(qHVE),
        client.query(qHVD),
        client.query(qATX),
      ]);

      // --- Builders
      const siteMap = new Map(); // key = building label (string)
      const siteGet = (label) => {
        const k = label || "Default";
        if (!siteMap.has(k)) siteMap.set(k, { id: k, label: k, hv: [], switchboards: [], atex: [] });
        return siteMap.get(k);
      };
      const labelize = (row, fallbackPrefix) =>
        row.label || row.name || row.code || `${fallbackPrefix} ${row.id}`;

      // Switchboards par building_code
      const sbById = new Map();
      const sbByCode = new Map();
      for (const s of sw.rows) {
        const site = siteGet(s.building_code);
        const node = {
          id: s.id,
          label: labelize(s, "SW"),
          code: s.code,
          tasks: [],
          devices: [],
        };
        site.switchboards.push(node);
        if (s.id != null) sbById.set(String(s.id), node);
        if (s.code) sbByCode.set(String(s.code), node);
      }

      // Devices sous leurs switchboards
      const devById = new Map();
      for (const d of dev.rows) {
        let parent = null;
        if (d.switchboard_id && sbById.has(String(d.switchboard_id))) {
          parent = sbById.get(String(d.switchboard_id));
        } else if (d.switchboard_code && sbByCode.has(String(d.switchboard_code))) {
          parent = sbByCode.get(String(d.switchboard_code));
        }
        const node = { id: d.id, label: labelize(d, "Device"), tasks: [] };
        devById.set(String(d.id), node);
        if (parent) parent.devices.push(node);
        else {
          // fallback: groupe sans TGBT mais dans le même building_code
          const site = siteGet(d.building_code);
          site.switchboards.push({ id: `sw-${d.id}`, label: "(Sans TGBT)", tasks: [], devices: [node] });
        }
      }

      // HV : équipements + devices (à plat sous HV du site)
      const hvListBySite = new Map(); // building_code -> array
      const pushHV = (b, node) => {
        const arr = hvListBySite.get(b) || [];
        arr.push(node);
        hvListBySite.set(b, arr);
      };
      for (const h of hve.rows) pushHV(h.building_code, { id: h.id, label: labelize(h, "HV"), tasks: [] });
      for (const h of hvd.rows) pushHV(h.building_code, { id: h.id, label: labelize(h, "HV"), tasks: [] });
      for (const [b, arr] of hvListBySite.entries()) siteGet(b).hv.push(...arr);

      // ATEX : building (pas building_code), groupé par zone
      const atexZoneBySite = new Map(); // building -> Map(zone -> { zone, equipments:[], tasks:[] })
      for (const a of aeq.rows) {
        const sKey = a.building || "Default";
        if (!atexZoneBySite.has(sKey)) atexZoneBySite.set(sKey, new Map());
        const mapZone = atexZoneBySite.get(sKey);
        const zKey = String(a.zone ?? "Z?");
        if (!mapZone.has(zKey)) mapZone.set(zKey, { zone: zKey, equipments: [], tasks: [] });
        mapZone.get(zKey).equipments.push({ id: a.id, label: labelize(a, "ATEX"), tasks: [] });
      }
      for (const [sKey, zones] of atexZoneBySite.entries()) {
        const site = siteGet(sKey);
        for (const z of zones.values()) site.atex.push(z);
      }

      // Lire tâches + entités — on attache UNIQUEMENT si reliées à un équipement
      const tasksQ = await client.query(
        `SELECT t.id, t.task_name, t.task_code, t.status, t.next_control, t.entity_id, t.site
           FROM controls_tasks t
          WHERE t.entity_id IS NOT NULL
          ORDER BY t.next_control ASC NULLS LAST`
      );

      const entCols = await getColumnsMeta(client, "controls_entities");
      const has = (c) => !!entCols[c];
      const ents = await client.query(
        `SELECT id, site, 
                ${has("switchboard_id") ? "switchboard_id" : "NULL AS switchboard_id"},
                ${has("device_id") ? "device_id" : "NULL AS device_id"},
                ${has("hv_id") ? "hv_id" : "NULL AS hv_id"},
                ${has("atex_id") ? "atex_id" : "NULL AS atex_id"}
           FROM controls_entities`
      );
      const entMap = new Map(ents.rows.map(r => [String(r.id), r]));

      const pushTask = (arr, t) => {
        const { category } = resolveTsdForTask(t);
        arr.push({
          id: t.id,
          label: t.task_name,
          code: t.task_code,
          status: t.status,
          due_date: t.next_control,
          color: colorForCategory(category?.key, t.task_code),
        });
      };

      // Dispatcher les tâches selon le lien d'entité
      for (const t of tasksQ.rows) {
        const e = entMap.get(String(t.entity_id));
        if (!e) continue;

        if (e.switchboard_id && sbById.has(String(e.switchboard_id))) {
          pushTask(sbById.get(String(e.switchboard_id)).tasks, t);
          continue;
        }
        if (e.device_id && devById.has(String(e.device_id))) {
          pushTask(devById.get(String(e.device_id)).tasks, t);
          continue;
        }
        if (e.hv_id) {
          // retrouver dans hvListBySite
          let placed = false;
          for (const arr of hvListBySite.values()) {
            const target = arr.find(h => String(h.id) === String(e.hv_id));
            if (target) { pushTask(target.tasks, t); placed = true; break; }
          }
          if (placed) continue;
        }
        if (e.atex_id) {
          // retrouver dans atexZoneBySite
          let placed = false;
          for (const zones of atexZoneBySite.values()) {
            for (const z of zones.values()) {
              const found = (z.equipments || []).find(eq => String(eq.id) === String(e.atex_id));
              if (found) { pushTask(found.tasks, t); placed = true; break; }
            }
            if (placed) break;
          }
          if (placed) continue;
        }
        // sinon : pas de fallback → on ignore (zéro tâche orpheline)
      }

      const tree = Array.from(siteMap.values()).sort((a, b) => String(a.label).localeCompare(String(b.label)));
      res.json(tree);
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GANTT / Calendar (toutes tâches rattachées à une entité existante)
// ---------------------------------------------------------------------------
router.get("/calendar", async (req, res) => {
  const { from, to, site } = req.query;

  const where = ["t.entity_id IS NOT NULL"];
  const params = [];
  let i = 1;

  if (from) { where.push(`t.next_control >= $${i}`); params.push(from); i++; }
  if (to)   { where.push(`t.next_control <= $${i}`); params.push(to); i++; }
  if (site) { where.push(`t.site = $${i}`); params.push(site); i++; }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.task_name, t.task_code, t.status, t.next_control
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
// IA — Analyse avant intervention (OpenAI derrière ton backend existant)
//   Reçoit facultativement un fichier image. Stockage si attach=1.
// ---------------------------------------------------------------------------
router.post("/ai/analyze-before", upload.single("file"), async (req, res) => {
  const { task_id, hints = "[]", attach = "0" } = req.body || {};
  const file = req.file || null;

  try {
    let task = null;
    if (task_id) {
      const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [task_id]);
      task = rows[0] || null;
    }
    const hintsArr = Array.isArray(hints) ? hints : JSON.parse(hints || "[]");

    // Option: stocker la photo sur la tâche
    if (file && task && String(attach) === "1") {
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

    // DÉLÉGUER à ton service OpenAI existant si tu as une route dédiée:
    // Ici on répond déjà avec les champs attendus par le front.
    // Tu peux remplacer ce bloc par un appel à ton orchestrateur OpenAI interne.
    const { control } = task ? resolveTsdForTask(task) : { control: null };
    res.json({
      ok: true,
      safety: {
        ppe: control?.ppe_md || tsdLibrary?.meta?.defaults?.ppe_md || "Gants isolants, visière, tenue ignifugée, balisage.",
        hazards: control?.hazards_md || "Risque d’arc, surfaces chaudes, parties nues sous tension.",
      },
      procedure: {
        steps: (control?.procedure_steps || []).map((s, i) => ({ step: i + 1, text: s })) || [
          { step: 1, text: "Vérifier l’environnement (propreté, humidité, obstacles)." },
          { step: 2, text: "Se positionner côté amont, ouvrir capot d’inspection." },
          { step: 3, text: "Configurer l’appareil (mode adéquat)." },
          { step: 4, text: "Effectuer la mesure et consigner la valeur." },
        ],
      },
      used_hints: hintsArr,
    });
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
