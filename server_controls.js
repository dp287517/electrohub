/**
 * server_controls.js — ESM (type: module)
 * Routes sous /api/controls
 * - Seed multi-catégories (ALL par défaut)
 * - Replanif fiable sur fréquence TSD (borne min si range)
 * - Endpoints checklist/schema & IA (analyse avant / lecture valeur)
 * - Support UUID ou INTEGER pour id/entity_id (introspection schema)
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
  // si range (min/max), on prend min par défaut (safe)
  if (min && min.interval && min.unit)
    return dayjs.utc(baseISO).add(min.interval, min.unit).toISOString();
  if (interval && unit)
    return dayjs.utc(baseISO).add(interval, unit).toISOString();
  return null;
}
function monthsFromFreq(freq) {
  if (!freq) return null;
  if (freq.min && freq.min.interval && freq.min.unit) {
    return unitToMonths(freq.min.interval, freq.min.unit);
  }
  if (freq.interval && freq.unit) {
    return unitToMonths(freq.interval, freq.unit);
  }
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
/** essaie de retrouver la définition TSD d’une tâche (par code puis par libellé) */
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
    sql: `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders.join(
      ","
    )}) RETURNING *`,
    params: cols.map((c) => values[c]),
  };
}

// insert générique (respect id UUID/int)
async function insertRow(client, table, values) {
  const meta = await getColumnsMeta(client, table);
  const v = { ...values };
  if (meta.id && isUuidColumn(meta.id)) v.id = v.id || uuidv4();
  // si colonne id est integer avec DEFAULT, ne rien fournir
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
router.post("/bootstrap/create-entity", async (req, res) => {
  const body = req.body || {};
  try {
    const created = await withTx(async (client) => {
      const now = new Date().toISOString();
      const ent = await insertRow(client, "controls_entities", {
        site: body.site ?? "Default",
        name: body.name ?? body.label ?? "Generic Entity",
        label: body.label ?? body.name ?? "Generic Entity",
        category_key: body.category_key ?? null,
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
// TASKS
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  const {
    q,
    status,
    site,
    control,
    due_from,
    due_to,
    entity_id,
    page = 1,
    page_size = 50,
    order = "due_date.asc",
    skip_entity_check = "0",
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (String(skip_entity_check) !== "1") where.push(EXISTS_ENTITY_SQL);
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
    } else if (status === "closed") where.push(`t.status = 'Done'`);
    else if (status === "overdue") where.push(`t.status = 'Overdue'`);
    else {
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
  const orderCol =
    col === "due_date"
      ? "next_control"
      : ["task_name", "task_code", "status", "next_control", "created_at", "updated_at"].includes(col)
      ? col
      : "next_control";
  const sortSQL = `ORDER BY t.${orderCol} ${
    dir?.toUpperCase() === "DESC" ? "DESC" : "ASC"
  }`;
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** enrichit une tâche avec la définition TSD (checklist / observations / docs) */
router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM controls_tasks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Tâche introuvable" });
    const task = rows[0];
    const { category, control } = resolveTsdForTask(task);

    res.json({
      task_id: task.id,
      label: task.task_name,
      task_code: task.task_code,
      frequency: control?.frequency || null,
      checklist: control?.checklist || [],
      observations: control?.observations || [],
      procedure_md: control?.procedure_md || task.procedure_md || "",
      hazards_md: control?.hazards_md || task.hazards_md || "",
      ppe_md: control?.ppe_md || task.ppe_md || "",
      tools_md: control?.tools_md || task.tools_md || "",
      tsd_category: category ? { key: category.key, label: category.label } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// création tâche unitaire
router.post("/tasks", async (req, res) => {
  const { entity_id, site = null, category_key, category_label, control_type, due_date } = req.body;
  if (!entity_id || !(category_key || category_label) || !control_type) {
    return res.status(400).json({ error: "entity_id, category_key|category_label et control_type sont requis" });
  }
  const category = findCategoryByKeyOrLabel(category_key || category_label);
  if (!category) return res.status(422).json({ error: "Catégorie TSD inconnue" });
  const control = findControlInCategory(category, control_type);
  if (!control) return res.status(422).json({ error: "Type de contrôle inconnu" });

  try {
    const created = await withTx(async (client) => {
      // assurer entité
      const entQ = await client.query(`SELECT * FROM controls_entities WHERE id = $1`, [entity_id]);
      let ent = entQ.rows[0];
      if (!ent) {
        const ensured = await ensureAtLeastOneEntity(client);
        ent = ensured.entity;
      }

      const now = new Date().toISOString();
      const months = monthsFromFreq(control.frequency);
      const nextCtrl =
        due_date ||
        (months ? addMonths(now, months) : addByFreq(now, control.frequency) || dayjs.utc(now).add(30, "day").toISOString());

      const task = await insertRow(client, "controls_tasks", {
        site: site || ent.site || "Default",
        entity_id: ent.id,
        task_name: `${category.label} – ${control.type}`,
        task_code: control.type,
        frequency_months: months || null,
        last_control: null,
        next_control: nextCtrl,
        status: "Planned",
        value_type: control.value_type || "checklist",
        result_schema: null,
        procedure_md: control.procedure_md || "",
        hazards_md: control.hazards_md || "",
        ppe_md: control.ppe_md || "",
        tools_md: control.tools_md || "",
        created_by: "system",
        created_at: now,
        updated_at: now,
      });

      await insertRow(client, "controls_history", {
        task_id: task.id,
        user: "system",
        action: "task_created",
        site: task.site || "Default",
        date: now,
        task_name: task.task_name,
      });

      return task;
    });

    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// clôture + replanif
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

      // enregistrer le record
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

      // attachements (si envoyés en base64)
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

      // --- Replanif solide ---
      const { control } = resolveTsdForTask(task);
      const months =
        (task.frequency_months && Number(task.frequency_months)) ||
        monthsFromFreq(control?.frequency) ||
        null;

      let nextDue =
        (months ? addMonths(closed_at, months) : addByFreq(closed_at, control?.frequency)) ||
        // fallback très safe : +6 mois
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

// historique
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

// upload d’un attachment “brut”
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
    await insertRow(pool, "controls_attachments", {
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
    res.json({ ok: true, filename: originalname, mimetype, size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// SEED (multi-catégories par défaut)
// ---------------------------------------------------------------------------
router.get("/bootstrap/seed", async (req, res) => {
  const dry = String(req.query.dry_run || "1") === "1";
  const categoryParam = req.query.category || "ALL";
  const siteFilter = req.query.site || null;

  try {
    const report = await withTx(async (client) => {
      const ensured = await ensureAtLeastOneEntity(client);

      const ents = await client.query(
        siteFilter
          ? `SELECT * FROM controls_entities WHERE site = $1`
          : `SELECT * FROM controls_entities`,
        siteFilter ? [siteFilter] : []
      );

      // Quelles catégories ?
      const categories =
        categoryParam && categoryParam !== "ALL"
          ? [findCategoryByKeyOrLabel(categoryParam)].filter(Boolean)
          : (tsdLibrary.categories || []);

      const actions = [];
      for (const e of ents.rows) {
        for (const cat of categories) {
          if (!cat) continue;

          for (const ctrl of cat.controls || []) {
            // existe déjà ?
            const exists = await client.query(
              `SELECT 1 FROM controls_tasks
               WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
              [e.id, ctrl.type]
            );
            if (exists.rowCount) {
              actions.push({
                entity_id: e.id,
                category: cat.key || cat.label,
                task_code: ctrl.type,
                action: "skipped_exists",
              });
              continue;
            }

            const months = monthsFromFreq(ctrl.frequency);
            const nextCtrl =
              (months ? addMonths(new Date().toISOString(), months)
                      : addByFreq(new Date().toISOString(), ctrl.frequency)) ||
              dayjs.utc().add(30, "day").toISOString();

            actions.push({
              entity_id: e.id,
              category: cat.key || cat.label,
              task_code: ctrl.type,
              action: dry ? "would_create" : "created",
            });

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

router.post("/bootstrap/seed-one", async (req, res) => {
  const { entity_id, category_key, category_label, control_type, due_date } = req.body || {};
  if (!entity_id || !(category_key || category_label) || !control_type) {
    return res.status(400).json({
      error: "entity_id, category_key|category_label et control_type sont requis",
    });
  }
  try {
    const created = await withTx(async (client) => {
      const entQ = await client.query(`SELECT * FROM controls_entities WHERE id=$1`, [entity_id]);
      if (!entQ.rowCount) throw new Error("Entité introuvable");
      const ent = entQ.rows[0];

      const category = findCategoryByKeyOrLabel(category_key || category_label);
      if (!category) throw new Error("Catégorie TSD inconnue");
      const ctrl = findControlInCategory(category, control_type);
      if (!ctrl) throw new Error("Type de contrôle inconnu");

      const activeExists = await client.query(
        `SELECT 1 FROM controls_tasks WHERE entity_id=$1 AND task_code=$2 AND status IN ('Planned','Pending','Overdue') LIMIT 1`,
        [ent.id, ctrl.type]
      );
      if (activeExists.rowCount) return { skipped: true, reason: "already_exists" };

      const months = monthsFromFreq(ctrl.frequency);
      const nextCtrl =
        due_date ||
        (months ? addMonths(new Date().toISOString(), months)
                : addByFreq(new Date().toISOString(), ctrl.frequency)) ||
        dayjs.utc().add(30, "day").toISOString();

      const task = await insertRow(client, "controls_tasks", {
        site: ent.site || "Default",
        entity_id: ent.id,
        task_name: `${category.label} – ${ctrl.type}`,
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
        created_by: "seed-one",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return { created: true, id: task.id };
    });

    res.json({ ok: true, ...created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Calendar (groupé par jour)
// ---------------------------------------------------------------------------
router.get("/calendar", async (req, res) => {
  const { from, to, site, control, skip_entity_check = "0" } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (String(skip_entity_check) !== "1") where.push(EXISTS_ENTITY_SQL);
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
         t.id, t.task_name AS label, t.status, t.next_control AS due_date,
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// IA (upload facultatif, logiques guidées par TSD)
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

    // Optionnel : attacher l’image à la tâche
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

    // Réponse structurée exploitable côté front
    res.json({
      ok: true,
      // guidage sécurité et actionnable (dérivé de la TSD si dispo)
      safety: {
        ppe: control?.ppe_md || tsdLibrary?.meta?.defaults?.ppe_md || "Gants isolants, visière, tenue ignifugée, balisage.",
        hazards: control?.hazards_md || "Risque d’arc, surfaces chaudes, parties nues sous tension.",
      },
      procedure: {
        steps: (control?.procedure_steps || []).map((s, i) => ({ step: i + 1, text: s })) || [
          { step: 1, text: "Vérifier l’environnement : propreté, humidité, obstacles." },
          { step: 2, text: "Se positionner côté amont, ouvrir le capot d’inspection." },
          { step: 3, text: "Configurer l’appareil : mode adéquat (ex: thermographie, IR)." },
          { step: 4, text: "Réaliser la mesure selon le point indiqué, consigner la valeur." },
        ],
        camera_hints: control?.camera_hints || [
          "Prendre un plan large pour contexte et dégagements.",
          "Zoomer sur la zone de connexion/borniers.",
          "Photo nette du cadran de l’appareil au moment de la mesure.",
        ],
      },
      hints,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** IA lecture valeur (placeholder propre pour intégration OCR ultérieure) */
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

    // Ici, on renvoie une structure prête pour parse OCR / règles
    res.json({
      ok: true,
      meter_type,
      unit_hint,
      value_detected: null,           // à remplir par OCR plus tard
      confidence: 0.0,
      suggestions: [
        "Recadrer plus près du cadran / afficheur.",
        "Éviter les reflets ; stabiliser l’appareil.",
        `Assurer que l'échelle correspond à l'unité attendue (${unit_hint}).`,
      ],
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
