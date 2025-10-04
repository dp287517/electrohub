// server_controls.js — FULL AUTO (no manual sync), OpenAI enabled, Render-style port
// - Auto-imports from DB tables (switchboards, devices, hv_equipments, atex_equipments) on-demand
// - Rebuilds/refreshes catalog & tasks automatically when empty or stale (TTL)
// - Adds OpenAI analyze & assistant with pragmatic prompts
// - Listens on CONTROLS_PORT || 3011 (same convention as your other services)

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import multer from "multer";
import pg from "pg";
import OpenAI from "openai";
import fetchPkg from "node-fetch";
import { TSD_LIBRARY, EQUIPMENT_TYPES } from "./tsd_library.js";

const fetch = (globalThis.fetch || fetchPkg);
dotenv.config();

/* ------------------------------------------------------------------ */
/*                               DB POOL                               */
/* ------------------------------------------------------------------ */
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

/* ------------------------------------------------------------------ */
/*                            APP & MIDDLEWARE                         */
/* ------------------------------------------------------------------ */
const app = express();
app.use(helmet());
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// CORS permissive by default
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Site,User");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 20 } });

/* ------------------------------------------------------------------ */
/*                            OPENAI CLIENT                            */
/* ------------------------------------------------------------------ */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ANALYZE_SYSTEM = `Tu es un expert maintenance électrique & HSE.\nProduis une analyse opérationnelle concise et actionnable pour la tâche de contrôle suivante.\nStructure attendue (Markdown court):\n1) Constat (données, écarts vs seuils)\n2) Risques & causes probables\n3) Actions immédiates (≤5)\n4) Prévention / périodicité conseillée`;

const ASSISTANT_SYSTEM = `Tu es l'assistant de contrôle maintenance.\nRéponds de façon pragmatique, en te basant sur la TSD (si fournie), l'historique des résultats et le contexte d'équipement.\nSi une valeur seuil manque, explique comment la mesurer ou où la trouver. Reste bref.`;

async function runChat(messages, { model = process.env.OPENAI_MODEL || "gpt-4o", temperature = 0.2 } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return { text: "(IA désactivée) Définis OPENAI_API_KEY pour activer l'analyse et l'assistant.", usage: null };
  }
  const resp = await openai.chat.completions.create({ model, temperature, messages });
  const text = resp.choices?.[0]?.message?.content?.trim() || "";
  return { text, usage: resp.usage || null };
}

/* ------------------------------------------------------------------ */
/*                              UTILITIES                              */
/* ------------------------------------------------------------------ */
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addMonths(dateStr, months) { const d = dateStr ? new Date(dateStr) : new Date(); d.setMonth(d.getMonth() + (months || 0)); return d.toISOString().slice(0, 10); }
function isDue(last, months) { if (!months || months <= 0) return true; if (!last) return true; const next = addMonths(last, months); return new Date(next) <= new Date(); }
function log(...args) { if (process.env.CONTROLS_LOG !== "0") console.log("[controls]", ...args); }
const siteFilterSQL = (alias = "") => `($1 = '*' OR ${alias ? alias + '.' : ''}site = $1)`;

/* ------------------------------------------------------------------ */
/*                               SCHEMA                                */
/* ------------------------------------------------------------------ */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_entities (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      building TEXT,
      equipment_type TEXT,
      name TEXT,
      code TEXT,
      done JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      parent_code TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_entities_site ON controls_entities(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_entities_code ON controls_entities(code);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_tasks (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      task_name TEXT,
      task_code TEXT,
      frequency_months INTEGER,
      last_control DATE,
      next_control DATE,
      status TEXT DEFAULT 'Planned',
      value_type TEXT DEFAULT 'checklist',
      result_schema JSONB,
      procedure_md TEXT,
      hazards_md TEXT,
      ppe_md TEXT,
      tools_md TEXT,
      results JSONB,
      ai_notes JSONB DEFAULT '[]'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_tasks_site ON controls_tasks(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_tasks_next ON controls_tasks(next_control);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_history (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE SET NULL,
      task_name TEXT,
      user_name TEXT,
      action TEXT,
      meta JSONB,
      date TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_history_site_date ON controls_history(site, date DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE CASCADE,
      filename TEXT,
      size INTEGER,
      mimetype TEXT,
      data BYTEA,
      label TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_not_present (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      building TEXT,
      equipment_type TEXT,
      declared_by TEXT,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_records (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE SET NULL,
      task_code TEXT,
      results JSONB,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // simple KV state to track last auto-refresh
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_state (
      site TEXT PRIMARY KEY,
      last_refresh TIMESTAMPTZ
    );
  `);
}
await ensureSchema().catch(e => { console.error("[schema] init error:", e); process.exit(1); });

async function ensureOverdueFlags() {
  await pool.query(`UPDATE controls_tasks SET status='Overdue' WHERE status='Planned' AND next_control < CURRENT_DATE`);
}

/* ------------------------------------------------------------------ */
/*                        SOURCE LOADERS (DB)                          */
/* ------------------------------------------------------------------ */
async function colExists(table, col) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     ) AS ok`, [table, col]);
  return rows[0]?.ok === true;
}

async function loadSwitchboardsDB(readSite = 'Default') {
  const { rows } = await pool.query(`
    SELECT COALESCE(NULLIF(s.site::text,''),'Default') AS site,
           COALESCE(NULLIF(s.building_code::text,''),'B00') AS building,
           s.name::text AS name, s.code::text AS code
    FROM public.switchboards s
    WHERE ($1 = '*' OR COALESCE(NULLIF(s.site::text,''),'Default') = $1)`, [readSite]);
  return rows.map(sb => ({ ...sb, equipment_type: 'LV_SWITCHBOARD', parent_code: null }));
}

async function loadDevicesDB(readSite = 'Default') {
  const hasSwitchboardId    = await colExists('devices', 'switchboard_id');
  const hasParentSwitchCode = await colExists('devices', 'parent_switchboard');
  if (hasSwitchboardId) {
    const { rows } = await pool.query(`
      SELECT COALESCE(NULLIF(d.site::text,''),'Default') AS site,
             COALESCE(NULLIF(sb.building_code::text,''),'B00') AS building,
             COALESCE(NULLIF(d.name::text,''), d.device_type::text, ('Device-'||d.id)::text) AS name,
             COALESCE(NULLIF(d.reference::text,''), NULLIF(d.position_number::text,''), ('DEV-'||d.id)::text) AS code,
             sb.code::text AS parent_code
      FROM public.devices d
      LEFT JOIN public.switchboards sb ON sb.id = d.switchboard_id
      WHERE ($1 = '*' OR COALESCE(NULLIF(d.site::text,''),'Default') = $1)`, [readSite]);
    return rows.map(d => ({ ...d, equipment_type: 'LV_DEVICE' }));
  }
  if (hasParentSwitchCode) {
    const { rows } = await pool.query(`
      SELECT COALESCE(NULLIF(d.site::text,''),'Default') AS site,
             COALESCE(NULLIF(sb.building_code::text,''),'B00') AS building,
             COALESCE(NULLIF(d.name::text,''), d.device_type::text, ('Device-'||d.id)::text) AS name,
             COALESCE(NULLIF(d.reference::text,''), NULLIF(d.position_number::text,''), ('DEV-'||d.id)::text) AS code,
             sb.code::text AS parent_code
      FROM public.devices d
      LEFT JOIN public.switchboards sb ON sb.code = d.parent_switchboard
      WHERE ($1 = '*' OR COALESCE(NULLIF(d.site::text,''),'Default') = $1)`, [readSite]);
    return rows.map(d => ({ ...d, equipment_type: 'LV_DEVICE' }));
  }
  // fallback sans parentage
  const { rows } = await pool.query(`
    SELECT COALESCE(NULLIF(d.site::text,''),'Default') AS site,
           'B00' AS building,
           COALESCE(NULLIF(d.name::text,''), d.device_type::text, ('Device-'||d.id)::text) AS name,
           COALESCE(NULLIF(d.reference::text,''), NULLIF(d.position_number::text,''), ('DEV-'||d.id)::text) AS code,
           NULL::text AS parent_code
    FROM public.devices d
    WHERE ($1 = '*' OR COALESCE(NULLIF(d.site::text,''),'Default') = $1)`, [readSite]);
  return rows.map(d => ({ ...d, equipment_type: 'LV_DEVICE' }));
}

async function loadHVsDB(readSite = 'Default') {
  const { rows } = await pool.query(`
    SELECT COALESCE(NULLIF(hv.site::text,''),'Default') AS site,
           COALESCE(NULLIF(hv.building_code::text,''),'B00') AS building,
           hv.name::text AS name, hv.code::text AS code
    FROM public.hv_equipments hv
    WHERE ($1 = '*' OR COALESCE(NULLIF(hv.site::text,''),'Default') = $1)`, [readSite]);
  return rows.map(h => ({ ...h, equipment_type: 'HV_EQUIPMENT', parent_code: null }));
}

async function loadATEXDB(readSite = 'Default') {
  const { rows } = await pool.query(`
    SELECT COALESCE(NULLIF(a.site::text,''),'Default') AS site,
           COALESCE(NULLIF(a.building::text,''),'B00') AS building,
           a.component_type::text AS name,
           COALESCE(NULLIF(a.manufacturer_ref::text,''), ('ATEX-'||a.id)::text) AS code
    FROM public.atex_equipments a
    WHERE ($1 = '*' OR COALESCE(NULLIF(a.site::text,''),'Default') = $1)`, [readSite]);
  return rows.map(ax => ({ ...ax, equipment_type: 'ATEX_EQUIPMENT', parent_code: null }));
}

async function fetchAllFromDB(readSite = '*') {
  const [sbs, devs, hvs, atex] = await Promise.all([
    loadSwitchboardsDB(readSite),
    loadDevicesDB(readSite),
    loadHVsDB(readSite),
    loadATEXDB(readSite),
  ]);
  const map = new Map();
  for (const x of [...sbs, ...devs, ...hvs, ...atex]) {
    if (!x.code) continue;
    const key = `${x.equipment_type}:${x.code}`;
    if (!map.has(key)) map.set(key, x);
  }
  return Array.from(map.values());
}

/* ------------------------------------------------------------------ */
/*                   AUTO-IMPORT & AUTO-TASKS (NO SYNC)                */
/* ------------------------------------------------------------------ */
const TTL_MINUTES = Number(process.env.CONTROLS_TTL_MINUTES || 10);

async function getLastRefresh(site) {
  const { rows } = await pool.query(`SELECT last_refresh FROM controls_state WHERE site=$1`, [site]);
  return rows[0]?.last_refresh || null;
}
async function setLastRefresh(site) {
  await pool.query(`INSERT INTO controls_state(site,last_refresh) VALUES ($1,NOW())
    ON CONFLICT (site) DO UPDATE SET last_refresh=NOW()`, [site]);
}

async function ensureAutoForSite(site) {
  // If empty → import now. If stale → refresh.
  const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM controls_entities WHERE site=$1`, [site]);
  const n = cnt[0]?.n || 0;
  let stale = false;
  const last = await getLastRefresh(site);
  if (!last) stale = true; else {
    const ageMin = (Date.now() - new Date(last).getTime()) / 60000;
    stale = ageMin >= TTL_MINUTES;
  }
  if (n === 0 || stale) {
    await importFromSources(site);
    await regenerateTasks(site);
    await ensureOverdueFlags();
    await setLastRefresh(site);
  }
}

async function importFromSources(insertSite = 'Default') {
  const incoming = await fetchAllFromDB('*'); // read across sites as requested
  let added = 0, updated = 0, flaggedNotPresent = 0;
  for (const inc of incoming) {
    if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) {
      await pool.query(
        "INSERT INTO controls_not_present (site, building, equipment_type, declared_by, note) VALUES ($1,$2,$3,$4,$5)",
        [insertSite, inc.building || null, inc.equipment_type, "system", "Type non couvert par la TSD"]
      );
      flaggedNotPresent++;
      continue;
    }
    const { rows: exist } = await pool.query(
      "SELECT id, building, name, parent_code FROM controls_entities WHERE site=$1 AND code=$2",
      [insertSite, inc.code]
    );
    if (exist.length === 0) {
      await pool.query(
        "INSERT INTO controls_entities (site, building, equipment_type, name, code, parent_code) VALUES ($1,$2,$3,$4,$5,$6)",
        [insertSite, inc.building || null, inc.equipment_type, inc.name, inc.code, inc.parent_code || null]
      );
      added++;
    } else {
      const prev = exist[0];
      if (prev.name !== inc.name || prev.building !== inc.building || prev.parent_code !== (inc.parent_code || null)) {
        await pool.query(
          "UPDATE controls_entities SET building=$1, name=$2, parent_code=$3, updated_at=NOW() WHERE id=$4",
          [inc.building || null, inc.name, inc.parent_code || null, prev.id]
        );
        updated++;
      }
    }
  }
  log(`[auto] import done → site=${insertSite} added=${added} updated=${updated} not_covered=${flaggedNotPresent}`);
}

async function regenerateTasks(site = 'Default') {
  const { rows: entities } = await pool.query("SELECT * FROM controls_entities WHERE site=$1", [site]);
  for (const e of entities) {
    const items = TSD_LIBRARY[e.equipment_type] || [];
    const done = e.done || {};
    for (const it of items) {
      // compute last & next
      let last = done[it.id] || null;
      // also check most recent Completed task for this pair
      const { rows: lastRows } = await pool.query(
        `SELECT last_control FROM controls_tasks WHERE site=$1 AND entity_id=$2 AND task_code=$3 AND status='Completed' ORDER BY last_control DESC NULLS LAST LIMIT 1`,
        [site, e.id, it.id]
      );
      if (!last && lastRows[0]?.last_control) last = lastRows[0].last_control;
      const next = last ? addMonths(last, it.frequency_months || 12) : todayISO();
      const status = new Date(next) < new Date(todayISO()) ? 'Overdue' : 'Planned';

      // ensure one active task exists (Planned/Overdue)
      const { rows: act } = await pool.query(
        `SELECT id FROM controls_tasks WHERE site=$1 AND entity_id=$2 AND task_code=$3 AND status IN ('Planned','Overdue') LIMIT 1`,
        [site, e.id, it.id]
      );
      if (act.length === 0) {
        await pool.query(
          `INSERT INTO controls_tasks (
            site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status,
            value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            site, e.id, `${e.name} • ${it.label}`, it.id, it.frequency_months,
            last, next, status,
            'checklist',
            JSON.stringify({ field: it.field, type: it.type, unit: it.unit, comparator: it.comparator, threshold: it.threshold, options: it.options || null }),
            it.procedure_md || '', it.hazards_md || '', it.ppe_md || '', it.tools_md || '',
            'system'
          ]
        );
      } else {
        await pool.query(
          `UPDATE controls_tasks SET last_control=$1, next_control=$2, status=$3, updated_at=NOW()
           WHERE id=$4`,
          [last, next, status, act[0].id]
        );
      }
    }
  }
  await ensureOverdueFlags();
}

/* ------------------------------------------------------------------ */
/*                               ROUTES                                */
/* ------------------------------------------------------------------ */

// Library (TSD)
app.get("/api/controls/library", (_req, res) => {
  res.json({ types: EQUIPMENT_TYPES, library: TSD_LIBRARY });
});

// Catalog (auto ensure)
app.get("/api/controls/catalog", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  await ensureAutoForSite(site);
  const { rows } = await pool.query(`SELECT * FROM controls_entities WHERE ${siteFilterSQL()} ORDER BY id DESC`, [site]);
  res.json({ data: rows });
});

// Tree (auto ensure)
app.get("/api/controls/tree", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  await ensureAutoForSite(site);

  const { rows: ents } = await pool.query(
    `SELECT id, site, building, equipment_type, name, code, parent_code
     FROM controls_entities
     WHERE ${siteFilterSQL()}
     ORDER BY building, equipment_type, name`, [site]);

  const { rows: counts } = await pool.query(`
    SELECT entity_id,
      SUM((status='Planned')::int) AS planned,
      SUM((status='Overdue')::int) AS overdue,
      SUM((status='Completed')::int) AS completed,
      MIN(next_control) AS next_due
    FROM controls_tasks ct
    WHERE ${siteFilterSQL('ct')}
    GROUP BY entity_id`, [site]);

  const cMap = new Map(counts.map(r => [r.entity_id, r]));
  const buildings = {};
  for (const e of ents) {
    const b = e.building || "B00";
    buildings[b] ||= { building: b, groups: { LV_SWITCHBOARD: [], LV_DEVICE: [], HV_EQUIPMENT: [], ATEX_EQUIPMENT: [] }, boardsByCode: {} };
    if (e.equipment_type === "LV_SWITCHBOARD") {
      const node = { id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts: cMap.get(e.id) || { planned: 0, overdue: 0, completed: 0, next_due: null }, children: [] };
      buildings[b].groups.LV_SWITCHBOARD.push(node);
      if (e.code) buildings[b].boardsByCode[e.code] = node;
    }
  }
  for (const e of ents) {
    const b = e.building || "B00";
    if (e.equipment_type === "LV_DEVICE" && e.parent_code && buildings[b]?.boardsByCode[e.parent_code]) {
      buildings[b].boardsByCode[e.parent_code].children.push({ id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts: cMap.get(e.id) || { planned: 0, overdue: 0, completed: 0, next_due: null } });
    }
  }
  for (const e of ents) {
    const b = e.building || "B00";
    const bucket = buildings[b].groups;
    const countsFor = cMap.get(e.id) || { planned: 0, overdue: 0, completed: 0, next_due: null };
    if (e.equipment_type === "LV_DEVICE" && e.parent_code && buildings[b].boardsByCode[e.parent_code]) continue;
    if (e.equipment_type === "LV_DEVICE") bucket.LV_DEVICE.push({ id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts: countsFor });
    if (e.equipment_type === "HV_EQUIPMENT") bucket.HV_EQUIPMENT.push({ id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts: countsFor });
    if (e.equipment_type === "ATEX_EQUIPMENT") bucket.ATEX_EQUIPMENT.push({ id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts: countsFor });
  }
  const out = Object.values(buildings).map(b => ({
    building: b.building,
    groups: [
      { label: "Switchboards", type: "LV_SWITCHBOARD", entities: b.groups.LV_SWITCHBOARD },
      { label: "Devices",      type: "LV_DEVICE",      entities: b.groups.LV_DEVICE },
      { label: "High Voltage", type: "HV_EQUIPMENT",   entities: b.groups.HV_EQUIPMENT },
      { label: "ATEX",         type: "ATEX_EQUIPMENT", entities: b.groups.ATEX_EQUIPMENT },
    ]
  }));
  res.json(out);
});

// Tasks (auto ensure)
app.get("/api/controls/tasks", async (req, res) => {
  try {
    const site = req.headers["x-site"] || req.query.site || "Default";
    await ensureAutoForSite(site);
    const { building, type, status, q, page = 1, pageSize = 200, entity_id } = req.query;
    await ensureOverdueFlags();

    let i = 1; const values = []; const where = [];
    values.push(site); where.push(`${siteFilterSQL('ct')}`.replace('$1', `$${i++}`));
    if (building) { values.push(building); where.push(`ce.building = $${i++}`); }
    if (type)     { values.push(type);     where.push(`ce.equipment_type = $${i++}`); }
    if (status)   { values.push(status);   where.push(`ct.status = $${i++}`); }
    if (entity_id){ values.push(Number(entity_id)); where.push(`ct.entity_id = $${i++}`); }
    if (q)        { values.push(`%${q}%`); where.push(`(ct.task_name ILIKE $${i} OR ct.task_code ILIKE $${i})`); i++; }
    values.push(Number(pageSize)); values.push((Number(page) - 1) * Number(pageSize));

    const query = `
      SELECT ct.*, ce.equipment_type, ce.building, ce.name AS entity_name
      FROM controls_tasks ct
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id
      WHERE ${where.length ? where.join(' AND ') : 'true'}
      ORDER BY ct.next_control ASC NULLS LAST, ct.id DESC
      LIMIT $${i++} OFFSET $${i}
    `;
    const { rows } = await pool.query(query, values);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: "Erreur list tasks", details: e.message });
  }
});

app.get("/api/controls/tasks/:id/details", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [id]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const t = rows[0];

  let tsd_item = null;
  const { rows: ent } = await pool.query("SELECT equipment_type FROM controls_entities WHERE id=$1", [t.entity_id]);
  const eqType = ent[0]?.equipment_type;
  if (eqType && TSD_LIBRARY[eqType]) tsd_item = (TSD_LIBRARY[eqType] || []).find(it => it.id === t.task_code) || null;
  if (!tsd_item) tsd_item = Object.values(TSD_LIBRARY).flat().find(it => it.id === t.task_code) || null;

  res.json({ ...t, tsd_item });
});

app.post("/api/controls/tasks/:id/complete", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { user = "tech", results = {}, ai_risk_score = null } = req.body || {};
    const { rows: trows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [id]);
    if (!trows.length) return res.status(404).json({ error: "Not found" });
    const t = trows[0];

    await pool.query(
      `UPDATE controls_tasks
       SET status='Completed', results=$1, last_control=$2, next_control=$3, updated_at=NOW()
       WHERE id=$4`,
      [JSON.stringify(results || {}), todayISO(), addMonths(todayISO(), t.frequency_months || 12), id]
    );

    await pool.query("INSERT INTO controls_history (site, task_id, task_name, user_name, action, meta) VALUES ($1,$2,$3,$4,$5,$6)",
      [t.site || "Default", id, t.task_name, user, "Completed", JSON.stringify({ ai_risk_score, results })]);
    await pool.query("INSERT INTO controls_records (site, entity_id, task_code, results, created_by) VALUES ($1,$2,$3,$4,$5)",
      [t.site || "Default", t.entity_id, t.task_code, JSON.stringify(results || {}), user]);
    await pool.query("UPDATE controls_entities SET done = done || jsonb_build_object($1, $2) WHERE id=$3",
      [t.task_code, todayISO(), t.entity_id]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erreur completion", details: e.message });
  }
});

// Attachments
app.post("/api/controls/tasks/:id/upload", upload.array("files", 20), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const files = req.files || [];
    const label = req.body?.label || null;
    for (const f of files) {
      await pool.query(
        "INSERT INTO controls_attachments (task_id, filename, size, mimetype, data, label) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, f.originalname, f.size, f.mimetype, f.buffer, label]
      );
    }
    res.json({ uploaded: files.length, label });
  } catch (e) {
    res.status(500).json({ error: "Erreur upload", details: e.message });
  }
});
app.get("/api/controls/tasks/:id/attachments", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    "SELECT id, filename, size, mimetype, label, uploaded_at FROM controls_attachments WHERE task_id=$1 ORDER BY uploaded_at DESC",
    [id]
  );
  res.json(rows);
});
app.get("/api/controls/tasks/:id/attachments/:attId", async (req, res) => {
  const taskId = Number(req.params.id);
  const attId = Number(req.params.attId);
  const { rows } = await pool.query("SELECT * FROM controls_attachments WHERE id=$1 AND task_id=$2", [attId, taskId]);
  if (!rows.length) return res.status(404).json({ error: "Pièce jointe non trouvée" });
  const att = rows[0];
  res.setHeader("Content-Type", att.mimetype);
  res.setHeader("Content-Disposition", `attachment; filename="${att.filename}"`);
  res.send(att.data);
});
app.delete("/api/controls/tasks/:id/attachments/:attId", async (req, res) => {
  await pool.query("DELETE FROM controls_attachments WHERE id=$1 AND task_id=$2", [req.params.attId, req.params.id]);
  res.json({ ok: true });
});

// Not present / history / records
app.get("/api/controls/not-present", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  await ensureAutoForSite(site);
  const { rows } = await pool.query(`SELECT * FROM controls_not_present WHERE ${siteFilterSQL()} ORDER BY id DESC`, [site]);
  res.json(rows);
});
app.post("/api/controls/not-present", async (req, res) => {
  const { site = "Default", building, equipment_type, declared_by = "user", note = "" } = req.body || {};
  const { rows } = await pool.query(
    "INSERT INTO controls_not_present (site,building,equipment_type,declared_by,note) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [site, building || null, equipment_type, declared_by, note]
  );
  res.status(201).json(rows[0]);
});
app.get("/api/controls/history", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  await ensureAutoForSite(site);
  const { rows } = await pool.query(`SELECT * FROM controls_history WHERE ${siteFilterSQL()} ORDER BY date DESC LIMIT 200`, [site]);
  res.json(rows);
});
app.get("/api/controls/records", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  await ensureAutoForSite(site);
  const { rows } = await pool.query(`SELECT * FROM controls_records WHERE ${siteFilterSQL()} ORDER BY created_at DESC LIMIT 200`, [site]);
  res.json(rows);
});

// OpenAI endpoints
app.post("/api/controls/tasks/:id/analyze", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ctx = await loadTaskContext(id);
    if (!ctx) return res.status(404).json({ error: "Task not found" });

    const userMsg = {
      role: "user",
      content: [
        { type: "text", text: `Site: ${ctx.task.site}\nEquipement: ${ctx.entity?.name || '-'} (${ctx.entity?.equipment_type})\nBuilding: ${ctx.entity?.building}\nTask: ${ctx.task.task_name} [code=${ctx.task.task_code}]\nResult_schema: ${JSON.stringify(ctx.task.result_schema)}\nDernier résultat: ${JSON.stringify(ctx.task.results)}\nTSD item: ${ctx.tsd_item ? JSON.stringify({ label: ctx.tsd_item.label, field: ctx.tsd_item.field, type: ctx.tsd_item.type, unit: ctx.tsd_item.unit, comparator: ctx.tsd_item.comparator, threshold: ctx.tsd_item.threshold }) : 'none'}\nPJ récentes: ${(ctx.attachments||[]).map(a=>a.filename).join(', ') || 'aucune'}` }
      ]
    };

    const { text } = await runChat([
      { role: "system", content: ANALYZE_SYSTEM },
      userMsg,
    ]);

    await pool.query(
      "UPDATE controls_tasks SET ai_notes = coalesce(ai_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'role', 'analysis', 'text', $1)) WHERE id=$2",
      [text, id]
    );

    res.json({ analysis: text });
  } catch (e) {
    res.status(500).json({ error: "Erreur analyze", details: e.message });
  }
});

app.post("/api/controls/tasks/:id/assistant", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = (req.body && req.body.question) || "";
    const ctx = await loadTaskContext(id);
    if (!ctx) return res.status(404).json({ error: "Task not found" });

    const contextText = `Contexte:\n- Site: ${ctx.task.site}\n- Equipement: ${ctx.entity?.name} (${ctx.entity?.equipment_type}) building=${ctx.entity?.building}\n- Task: ${ctx.task.task_name} [${ctx.task.task_code}]\n- Résultats: ${JSON.stringify(ctx.task.results)}\n- TSD: ${ctx.tsd_item ? JSON.stringify({ label: ctx.tsd_item.label, field: ctx.tsd_item.field, unit: ctx.tsd_item.unit, comparator: ctx.tsd_item.comparator, threshold: ctx.tsd_item.threshold }) : 'none'}\n- PJ: ${(ctx.attachments||[]).map(a=>a.filename).join(', ') || 'aucune'}`;

    const { text } = await runChat([
      { role: "system", content: ASSISTANT_SYSTEM },
      { role: "user", content: `${contextText}\n\nQuestion: ${q}` }
    ], { temperature: 0.3 });

    await pool.query(
      "UPDATE controls_tasks SET ai_notes = coalesce(ai_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'role', 'assistant', 'q', $1, 'text', $2)) WHERE id=$3",
      [q, text, id]
    );

    res.json({ answer: text });
  } catch (e) {
    res.status(500).json({ error: "Erreur assistant", details: e.message });
  }
});

async function loadTaskContext(taskId) {
  const { rows: trows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [taskId]);
  if (!trows.length) return null;
  const task = trows[0];
  const { rows: ents } = await pool.query("SELECT * FROM controls_entities WHERE id=$1", [task.entity_id]);
  const entity = ents[0] || null;
  let tsd_item = null;
  if (entity?.equipment_type && TSD_LIBRARY[entity.equipment_type]) {
    tsd_item = (TSD_LIBRARY[entity.equipment_type] || []).find(it => it.id === task.task_code) || null;
  }
  if (!tsd_item) tsd_item = Object.values(TSD_LIBRARY).flat().find(it => it.id === task.task_code) || null;
  const { rows: atts } = await pool.query(
    "SELECT id, filename, size, mimetype, uploaded_at FROM controls_attachments WHERE task_id=$1 ORDER BY uploaded_at DESC LIMIT 10",
    [taskId]
  );
  return { task, entity, tsd_item, attachments: atts };
}

// Health
app.get("/api/controls/health", (_req, res) => res.json({ ok: true, ts: Date.now(), ttl_minutes: TTL_MINUTES }));

/* ------------------------------------------------------------------ */
/*                                 START                               */
/* ------------------------------------------------------------------ */
const port = process.env.CONTROLS_PORT || 3011; // match your other services (no $PORT)
app.listen(port, () => console.log(`Controls service running on :${port}`));
