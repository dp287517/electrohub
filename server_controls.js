/**
 * server_controls.js — Controls (TSD) API
 * ESM, compatible "type":"module"
 *
 * Monté sous: /api/controls
 * Ports: CONTROLS_PORT (défaut 3011)
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
function findControlInCategory(category, controlTypeOrCode) {
  if (!category) return null;
  const low = String(controlTypeOrCode || "").toLowerCase();
  return (category.controls || []).find(
    (t) => t.type && String(t.type).toLowerCase() === low
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
  if (meta.id && isUuidColumn(meta.id) && !v.id) v.id = uuidv4();
  const pruned = pruneValuesByExistingColumns(v, meta);
  const { sql, params } = buildInsertSQL(table, pruned);
  const { rows } = await client.query(sql, params);
  return rows[0];
}
async function safeQuery(client, sql, params = []) {
  try { return await client.query(sql, params); } catch { return null; }
}
function colorForCategory(catKey, taskCode = "") {
  const k = String(catKey || "").toUpperCase();
  if (k.includes("HV")) return "#ef4444";
  if (k.includes("ATEX")) return "#f59e0b";
  if (k.includes("SWITCH")) return "#3b82f6";
  if (taskCode.toLowerCase().includes("thermo")) return "#22c55e";
  return "#6366f1";
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

// ---------------------------------------------------------------------------
// BOOTSTRAP — crée des entities depuis les équipements + seed TSD (optionnel)
// ---------------------------------------------------------------------------
/**
 * GET /api/controls/bootstrap/auto-link?create=1&seed=1
 * - Scanne hv_equipments/hv_devices, switchboards, devices, atex_equipments
 * - Crée controls_entities si manquants avec equipment_table/equipment_id/site
 * - Si ?seed=1 : crée les tâches depuis tsd_library (par catégorie db_table)
 */
router.get("/bootstrap/auto-link", async (req, res) => {
  const doCreate = String(req.query.create || "1") === "1";
  const doSeed = String(req.query.seed || "0") === "1";
  try {
    const report = await withTx(async (client) => {
      const actions = [];
      const eqLists = {};

      // Charger équipements
      const hvE = await safeQuery(client,
        `SELECT id, COALESCE(name, code, 'HV-'||id) AS label, code, building_code FROM hv_equipments`);
      const hvD = await safeQuery(client,
        `SELECT id, COALESCE(name, code, 'HV-'||id) AS label, code, building_code FROM hv_devices`);
      const swb = await safeQuery(client,
        `SELECT id, COALESCE(name, code, 'SW-'||id) AS label, code, building_code FROM switchboards`);
      const dev = await safeQuery(client,
        `SELECT id, COALESCE(name, code, 'DEV-'||id) AS label, code, building_code, switchboard_id FROM devices`);
      const atex = await safeQuery(client,
        `SELECT id, COALESCE(name, code, 'ATEX-'||id) AS label, code, building, zone FROM atex_equipments`);

      eqLists.hv = (hvE?.rows || []).concat(hvD?.rows || []).map(r => ({ ...r, equipment_table: "hv" }));
      eqLists.switchboards = (swb?.rows || []).map(r => ({ ...r, equipment_table: "switchboards" }));
      eqLists.devices = (dev?.rows || []).map(r => ({ ...r, equipment_table: "devices" }));
      eqLists.atex = (atex?.rows || []).map(r => ({ ...r, equipment_table: "atex_equipments" }));

      // Helper pour créer l'entity si manquante
      async function ensureEntity(e) {
        const siteVal = e.building_code ?? e.building ?? "Default";
        const exists = await client.query(
          `SELECT id FROM controls_entities WHERE equipment_table = $1 AND equipment_id = $2 LIMIT 1`,
          [e.equipment_table, e.id]
        );
        if (exists.rowCount) return { id: exists.rows[0].id, created: false };

        if (!doCreate) return { id: null, created: false };

        const now = new Date().toISOString();
        const entity = await insertRow(client, "controls_entities", {
          site: String(siteVal),
          name: e.label,
          equipment_type: e.equipment_table,
          equipment_ref: e.code || null,
          related_type: e.equipment_table,
          related_id: e.id,
          // colonnes souples si présentes :
          equipment_table: e.equipment_table,
          equipment_id: e.id,
          switchboard_id: e.switchboard_id ?? null,
          atex_id: e.equipment_table === "atex_equipments" ? e.id : null,
          hv_id: e.equipment_table === "hv" ? e.id : null,
          code: e.code || null,
          parent_code: null,
          created_at: now,
          updated_at: now,
        });
        actions.push({ action: "entity_created", equipment_table: e.equipment_table, equipment_id: e.id, entity_id: entity.id });
        return { id: entity.id, created: true };
      }

      // Map table->catégorie TSD (via db_table)
      const catsByDbTable = new Map();
      for (const c of tsdLibrary.categories || []) {
        if (c.db_table) catsByDbTable.set(String(c.db_table).toLowerCase(), c);
      }

      // Pour chaque équipement -> entity (+ seed)
      for (const table of ["hv", "switchboards", "devices", "atex_equipments"]) {
        const list = table === "hv" ? eqLists.hv : table === "atex_equipments" ? eqLists.atex : eqLists[table] || [];
        for (const e of list) {
          const entity = await ensureEntity(e);
          if (!entity.id) continue;

          if (doSeed) {
            const cat =
              table === "hv"
                ? (findCategoryByKeyOrLabel("hv_switchgear") || catsByDbTable.get("hv_equipments"))
                : catsByDbTable.get(table);

            if (!cat) {
              actions.push({ action: "seed_skipped_no_category", equipment_table: table, equipment_id: e.id });
              continue;
            }
            for (const ctrl of cat.controls || []) {
              const exists = await client.query(
                `SELECT 1 FROM controls_tasks WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
                [entity.id, ctrl.type]
              );
              if (exists.rowCount) {
                actions.push({ action: "seed_exists", entity_id: entity.id, task_code: ctrl.type });
                continue;
              }
              const months = monthsFromFreq(ctrl.frequency);
              const nextCtrl =
                (months
                  ? addMonths(new Date().toISOString(), months)
                  : addByFreq(new Date().toISOString(), ctrl.frequency)) ||
                dayjs.utc().add(30, "day").toISOString();

              await insertRow(client, "controls_tasks", {
                site: String(e.building_code ?? e.building ?? "Default"),
                entity_id: entity.id,
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
              actions.push({ action: "task_seeded", entity_id: entity.id, task_code: ctrl.type });
            }
          }
        }
      }

      return { actions };
    });

    res.json({ ok: true, ...report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// TASKS (liste + schema + attachments + close) — inchangé vs logique précédente
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
// IA (analyse avant) — identique logique précédente (intégré à ton front)
// ---------------------------------------------------------------------------
router.post("/ai/analyze-before", upload.single("file"), async (req, res) => {
  const { task_id, attach = "0" } = req.body || {};
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
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// HIERARCHY/TREE — **corrigé pour building_code vs building**
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (_req, res) => {
  const client = await pool.connect();
  try {
    // 1) Construire la liste des bâtiments depuis les équipements (union)
    const b1 = await safeQuery(client, `SELECT DISTINCT building_code::text AS b FROM switchboards WHERE building_code IS NOT NULL`);
    const b2 = await safeQuery(client, `SELECT DISTINCT building_code::text AS b FROM devices WHERE building_code IS NOT NULL`);
    const b3 = await safeQuery(client, `SELECT DISTINCT building_code::text AS b FROM hv_equipments WHERE building_code IS NOT NULL`);
    const b4 = await safeQuery(client, `SELECT DISTINCT building_code::text AS b FROM hv_devices WHERE building_code IS NOT NULL`);
    const b5 = await safeQuery(client, `SELECT DISTINCT building::text AS b FROM atex_equipments WHERE building IS NOT NULL`);

    const allB = new Set();
    for (const rs of [b1,b2,b3,b4,b5]) (rs?.rows || []).forEach(r => allB.add(String(r.b)));

    if (allB.size === 0) {
      // fallback: entities.site
      const se = await safeQuery(client, `SELECT DISTINCT site::text AS b FROM controls_entities WHERE site IS NOT NULL`);
      (se?.rows || []).forEach(r => allB.add(String(r.b)));
    }
    if (allB.size === 0) allB.add("Default");

    // 2) Charger équipements avec bons libellés/colonnes
    const hvEquip = await safeQuery(client,
      `SELECT id, COALESCE(name, code, 'HV-'||id) AS label, code, building_code FROM hv_equipments`);
    const hvDev = await safeQuery(client,
      `SELECT id, COALESCE(name, code, 'HV-'||id) AS label, code, building_code FROM hv_devices`);
    const sw = await safeQuery(client,
      `SELECT id, COALESCE(name, code, 'SW-'||id) AS label, code, building_code FROM switchboards`);
    const dev = await safeQuery(client,
      `SELECT id, COALESCE(name, code, 'DEV-'||id) AS label, code, building_code, switchboard_id FROM devices`);
    const atex = await safeQuery(client,
      `SELECT id, COALESCE(name, code, 'ATEX-'||id) AS label, code, building, zone FROM atex_equipments`);

    // Index auxiliaires
    const swByBuilding = new Map();
    for (const r of sw?.rows || []) {
      const b = String(r.building_code ?? "Default");
      if (!swByBuilding.has(b)) swByBuilding.set(b, []);
      swByBuilding.get(b).push({ id: r.id, label: r.label, code: r.code, devices: [], tasks: [] });
    }

    const devBySwitch = new Map();
    for (const r of dev?.rows || []) {
      const key = String(r.switchboard_id ?? "");
      if (!devBySwitch.has(key)) devBySwitch.set(key, []);
      devBySwitch.get(key).push({ id: r.id, label: r.label, code: r.code, tasks: [] });
    }

    const hvByBuilding = new Map();
    for (const r of (hvEquip?.rows || []).concat(hvDev?.rows || [])) {
      const b = String(r.building_code ?? "Default");
      if (!hvByBuilding.has(b)) hvByBuilding.set(b, []);
      hvByBuilding.get(b).push({ id: r.id, label: r.label, code: r.code, tasks: [] });
    }

    const atexByB = new Map(); // building -> Map(zone -> [equip])
    for (const r of atex?.rows || []) {
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

    // 3) Construire nœuds site
    const siteNodes = Array.from(allB.values()).sort((a,b)=>String(a).localeCompare(String(b))).map(b => ({
      id: b,
      label: b,
      hv: hvByBuilding.get(b) || [],
      switchboards: swByBuilding.get(b) || [],
      atex: Array.from((atexByB.get(b) || new Map()).entries()).map(([zone, eqs]) => ({
        zone, equipments: eqs, tasks: []
      })),
      tasks: [],
    }));

    // 4) Lier les tâches existantes sur l’équipement via controls_entities
    const entCols = await getColumnsMeta(client, "controls_entities");
    const has = (c) => !!entCols[c];
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

    // Accès rapides
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
        // Cherche dans HV du site
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
        // trouver d’abord le switchboard parent si présent sur l’entity
        const list = siteNode.switchboards || [];
        let placed = false;
        if (ent?.switchboard_id) {
          const sb = list.find(s => String(s.id) === String(ent.switchboard_id));
          if (sb) {
            const dev = (sb.devices || []).find(d => String(d.id) === eqId);
            if (dev) { dev.tasks.push(tObj); placed = true; }
          }
        }
        if (!placed) {
          // fallback: premier device du premier switchboard
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
        // tenter de le trouver dans n’importe quelle zone (eq id unique)
        let done = false;
        for (const z of zones) {
          const eq = (z.equipments || []).find(e => String(e.id) === eqId);
          if (eq) { eq.tasks.push(tObj); done = true; break; }
        }
        if (!done) {
          // fallback: créer zone Z?
          let z = zones.find(z => String(z.zone) === "Z?");
          if (!z) { z = { zone: "Z?", equipments: [], tasks: [] }; zones.push(z); }
          z.tasks.push(tObj);
        }
        return;
      }
      // dernier recours: au niveau site
      (siteNode.tasks = siteNode.tasks || []).push(tObj);
    }

    for (const t of tasksQ.rows) {
      const ent = entMap.get(String(t.entity_id));
      if (!ent) continue; // tâche orpheline -> on ignore pour ne pas polluer la vue
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
// Mount + Boot
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
