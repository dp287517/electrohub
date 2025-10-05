// server_controls.js — Controls backend (vNext)
// - Première occurrence: statut "Pending" (non planifiée, next_control = NULL)
// - À la complétion: crée une NOUVELLE tâche pour la prochaine échéance (au lieu d’écraser)
// - Regroupement par "cluster" si défini dans la TSD -> une seule carte / inspection
// - Endpoints: /assistant (IA), /calendar, /tree amélioré, /details enrichis
// - Compat schéma: colonne legacy "user" dans controls_history, size dans attachments, etc.
// - Index/contraintes: unique partiel sur tâches actives pour éviter doublons
// - Démarre sur CONTROLS_PORT (ou 3011)

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

// ---------------------------------------------------------------------------
// ENV & APP
// ---------------------------------------------------------------------------
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// CORS permissif
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Site,User");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Upload (multi-fichiers)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addMonths(dateStr, months) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setMonth(d.getMonth() + (months || 0));
  return d.toISOString().slice(0, 10);
}
function isDue(dateStr) {
  if (!dateStr) return true;
  return new Date(dateStr) <= new Date();
}
function log(...args) { if (process.env.CONTROLS_LOG !== "0") console.log("[controls]", ...args); }

function comparatorText(comp, thr, unit) {
  const U = unit ? ` ${unit}` : "";
  switch (comp) {
    case "==": return `Doit être égal à ${thr}${U}`;
    case "!=": return `Doit être différent de ${thr}${U}`;
    case "<=": return `Doit être ≤ ${thr}${U}`;
    case ">=": return `Doit être ≥ ${thr}${U}`;
    case "<":  return `Doit être < ${thr}${U}`;
    case ">":  return `Doit être > ${thr}${U}`;
    default:   return `Seuil: ${comp} ${thr}${U}`;
  }
}

// ---------------------------------------------------------------------------
// SCHEMA (création + migrations rétro-compatibles)
// ---------------------------------------------------------------------------
async function ensureSchema() {
  // CREATE
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_equipments (
      id SERIAL PRIMARY KEY,
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      manufacturer TEXT,
      model TEXT,
      serial_number TEXT,
      specs JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_tasks (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      task_name TEXT,
      task_code TEXT,
      cluster TEXT,                       -- regroupement (si défini par TSD)
      frequency_months INTEGER,
      last_control DATE,
      next_control DATE,
      status TEXT DEFAULT 'Planned',      -- Pending | Planned | Overdue | Completed | Canceled
      value_type TEXT DEFAULT 'checklist',
      result_schema JSONB,
      procedure_md TEXT,
      hazards_md TEXT,
      ppe_md TEXT,
      tools_md TEXT,
      threshold_text TEXT,                -- lisible pour l’UI ("≤ 20 °C", etc.)
      results JSONB,
      ai_notes JSONB DEFAULT '[]'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_history (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE SET NULL,
      task_name TEXT,
      user_name TEXT,
      "user" TEXT,                        -- compat legacy
      action TEXT,
      meta JSONB,
      date TIMESTAMPTZ DEFAULT NOW()
    );
  `);

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

  // ALTER compat
  await pool.query(`ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS code TEXT;`);
  await pool.query(`ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS done JSONB DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);
  await pool.query(`ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS parent_code TEXT;`);

  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'Default';`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS cluster TEXT;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS value_type TEXT DEFAULT 'checklist';`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS result_schema JSONB;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS procedure_md TEXT;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS hazards_md TEXT;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS ppe_md TEXT;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS tools_md TEXT;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS results JSONB;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS ai_notes JSONB DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS created_by TEXT;`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Planned';`);
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS threshold_text TEXT;`);

  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'Default';`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS user_name TEXT;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS "user" TEXT;`);
  await pool.query(`ALTER TABLE controls_history ALTER COLUMN "user" DROP NOT NULL;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS task_name TEXT;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS action TEXT;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS meta JSONB;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ DEFAULT NOW();`);

  await pool.query(`ALTER TABLE controls_attachments ADD COLUMN IF NOT EXISTS label TEXT;`);

  // Indexes (dont unique partiel pour éviter doublons de tâches actives)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_tasks_site ON controls_tasks(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_tasks_next ON controls_tasks(next_control);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_entities_site ON controls_entities(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_history_site_date ON controls_history(site, date DESC);`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_controls_tasks_active
    ON controls_tasks(site, entity_id, COALESCE(cluster, task_code))
    WHERE status IN ('Planned','Overdue','Pending');
  `);

  log("schema ensured");
}
await ensureSchema().catch(e => { console.error("[schema] init error:", e); process.exit(1); });

async function ensureOverdueFlags() {
  await pool.query(`UPDATE controls_tasks SET status='Overdue' WHERE status='Planned' AND next_control < CURRENT_DATE`);
}

// ---------------------------------------------------------------------------
// LIBRARY
// ---------------------------------------------------------------------------
app.get("/api/controls/library", (_req, res) => {
  res.json({ types: EQUIPMENT_TYPES, library: TSD_LIBRARY });
});

// ---------------------------------------------------------------------------
// SOURCES — HTTP (legacy) + DB (recommandé)
// ---------------------------------------------------------------------------
async function safeFetchJson(url) {
  try {
    const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    log("fetch error", url, e.message);
    return null;
  }
}

// HTTP (compat)
async function loadSwitchboardsHTTP(site="Default") {
  const url = process.env.SWITCHBOARD_URL || process.env.SWITCHBOARD_BASE_URL || "";
  if (!url) return [];
  const boards  = await safeFetchJson(`${url}/api/switchboard/boards?site=${encodeURIComponent(site)}`);
  const devices = await safeFetchJson(`${url}/api/switchboard/devices?site=${encodeURIComponent(site)}`);
  const out = [];
  for (const sb of (boards?.data || [])) {
    out.push({
      site, building: sb.building || sb.building_code || "B00",
      equipment_type: "LV_SWITCHBOARD",
      name: sb.name || `Board-${sb.id}`,
      code: sb.code || `SB-${sb.id}`
    });
  }
  for (const d of (devices?.data || [])) {
    const parent_code = d.switchboard_code || d.board_code || d.parent_code || d.parent || null;
    out.push({
      site, building: d.building || d.building_code || "B00",
      equipment_type: "LV_DEVICE",
      name: d.name || `Device-${d.id}`,
      code: d.code || d.reference || d.position_number || `DEV-${d.id}`,
      parent_code
    });
  }
  return out;
}
async function loadHVHTTP(site="Default") {
  const url = process.env.HV_URL || process.env.HV_BASE_URL || "";
  if (!url) return [];
  const data = await safeFetchJson(`${url}/api/hv/equipments?site=${encodeURIComponent(site)}`);
  return (data?.data || []).map(h => ({
    site, building: h.building || h.building_code || "B00",
    equipment_type: "HV_EQUIPMENT",
    name: h.name || `HV-${h.id}`,
    code: h.code || `HV-${h.id}`
  }));
}
async function loadATEXHTTP(site="Default") {
  const url = process.env.ATEX_URL || process.env.ATEX_BASE_URL || "";
  if (!url) return [];
  const data = await safeFetchJson(`${url}/api/atex/equipments?site=${encodeURIComponent(site)}`);
  return (data?.data || []).map(ax => ({
    site, building: ax.building || "B00",
    equipment_type: "ATEX_EQUIPMENT",
    name: ax.component_type || `ATEX-${ax.id}`,
    code: ax.manufacturer_ref || `ATEX-${ax.id}`
  }));
}

// DB (recommandé)
async function loadFromDB(site="Default") {
  // Switchboards
  const { rows: sbs } = await pool.query(`
    SELECT
      COALESCE(NULLIF(s.site,''),'Default') AS site,
      COALESCE(NULLIF(s.building_code,''),'B00') AS building,
      s.name::text AS name,
      s.code::text AS code
    FROM public.switchboards s
    WHERE COALESCE(NULLIF(s.site,''),'Default') = $1
  `, [site]);

  // Devices (+ parent switchboard_code)
  const { rows: devs } = await pool.query(`
    SELECT
      COALESCE(NULLIF(d.site,''),'Default') AS site,
      COALESCE(NULLIF(sb.building_code,''),'B00') AS building,
      COALESCE(NULLIF(d.name,''), d.device_type, ('Device-'||d.id))::text AS name,
      COALESCE(NULLIF(d.reference,''), NULLIF(d.position_number,''), ('DEV-'||d.id))::text AS code,
      sb.code::text AS parent_code
    FROM public.devices d
    LEFT JOIN public.switchboards sb ON sb.id = d.switchboard_id
    WHERE COALESCE(NULLIF(d.site,''),'Default') = $1
  `, [site]);

  // HV
  const { rows: hvs } = await pool.query(`
    SELECT
      COALESCE(NULLIF(hv.site,''),'Default') AS site,
      COALESCE(NULLIF(hv.building_code,''),'B00') AS building,
      hv.name::text AS name,
      hv.code::text AS code
    FROM public.hv_equipments hv
    WHERE COALESCE(NULLIF(hv.site,''),'Default') = $1
  `, [site]);

  // ATEX
  const { rows: atex } = await pool.query(`
    SELECT
      COALESCE(NULLIF(a.site,''),'Default') AS site,
      COALESCE(NULLIF(a.building,''),'B00') AS building,
      a.component_type::text AS name,
      COALESCE(NULLIF(a.manufacturer_ref,''), ('ATEX-'||a.id))::text AS code
    FROM public.atex_equipments a
    WHERE COALESCE(NULLIF(a.site,''),'Default') = $1
  `, [site]);

  const out = [];
  for (const sb of sbs) out.push({ ...sb, equipment_type: "LV_SWITCHBOARD", parent_code: null });
  for (const d of devs) out.push({ ...d, equipment_type: "LV_DEVICE" });
  for (const hv of hvs) out.push({ ...hv, equipment_type: "HV_EQUIPMENT", parent_code: null });
  for (const ax of atex) out.push({ ...ax, equipment_type: "ATEX_EQUIPMENT", parent_code: null });
  return out;
}

// ---------------------------------------------------------------------------
// TSD helpers: regrouper par cluster si présent
// ---------------------------------------------------------------------------
function clusterize(items = []) {
  const map = new Map();
  for (const it of items) {
    const key = it.cluster || it.id; // si pas de cluster => unitaire
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return Array.from(map.entries()).map(([cluster, arr]) => ({ cluster, items: arr }));
}

function buildSchemaForCluster(clusterGroup) {
  // Un schéma "items[]" pour checklists/mesures multiples
  const first = clusterGroup.items[0] || {};
  const freq = first.frequency_months || 12;

  const items = clusterGroup.items.map(it => ({
    id: it.id,
    field: it.field,
    label: it.label,
    type: it.type,               // "check" | "number" | "text" | "checklist"
    unit: it.unit || null,
    comparator: it.comparator || null,
    threshold: it.threshold ?? null,
    options: it.options || (it.type === "checklist"
      ? [{value:"conforme", label:"Conforme"}, {value:"non_conforme", label:"Non conforme"}, {value:"na", label:"Non applicable"}]
      : null),
    threshold_text: comparatorText(it.comparator, it.threshold, it.unit)
  }));

  const procedure_md = clusterGroup.items.map(it => it.procedure_md).filter(Boolean).join("\n\n");
  const hazards_md   = clusterGroup.items.map(it => it.hazards_md).filter(Boolean).join("\n\n");
  const ppe_md       = clusterGroup.items.map(it => it.ppe_md).filter(Boolean).join("\n\n");
  const tools_md     = clusterGroup.items.map(it => it.tools_md).filter(Boolean).join("\n\n");

  return {
    frequency_months: freq,
    value_type: "group",
    result_schema: { items },
    threshold_text: items.map(x => `${x.label}: ${x.threshold_text}`).join(" • "),
    procedure_md, hazards_md, ppe_md, tools_md
  };
}

// ---------------------------------------------------------------------------
// Génération TSD (Pending pour 1ère occurrence, Planned après)
// ---------------------------------------------------------------------------
async function ensureActiveTaskForEntity(site, entity) {
  const items = TSD_LIBRARY[entity.equipment_type] || [];
  if (items.length === 0) return 0;

  const clusters = clusterize(items);
  let created = 0;

  for (const cg of clusters) {
    const task_code = cg.cluster; // cluster id ou item id
    const last = entity.done?.[task_code] || null;

    // Existe-t-il déjà une tâche active (Pending/Planned/Overdue) ?
    const { rows: exist } = await pool.query(
      `SELECT id FROM controls_tasks
       WHERE site=$1 AND entity_id=$2 AND COALESCE(cluster, task_code)=$3
       AND status IN ('Pending','Planned','Overdue') LIMIT 1`,
      [site, entity.id, task_code]
    );
    if (exist.length) continue;

    const schema = buildSchemaForCluster(cg);

    if (!last) {
      // 1ère occurrence => Pending + non planifiée
      await pool.query(
        `INSERT INTO controls_tasks (
          site, entity_id, task_name, task_code, cluster, frequency_months,
          last_control, next_control, status, value_type, result_schema,
          procedure_md, hazards_md, ppe_md, tools_md, threshold_text, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,'Pending',$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          site, entity.id, `${entity.name} • ${cg.items[0].label}`,
          task_code, cg.cluster, schema.frequency_months,
          schema.value_type, JSON.stringify(schema.result_schema),
          schema.procedure_md, schema.hazards_md, schema.ppe_md, schema.tools_md,
          schema.threshold_text, 'system'
        ]
      );
      created++;
    } else {
      // Planifier à la prochaine date seulement
      const next = addMonths(last, schema.frequency_months);
      if (isDue(next)) {
        await pool.query(
          `INSERT INTO controls_tasks (
            site, entity_id, task_name, task_code, cluster, frequency_months,
            last_control, next_control, status, value_type, result_schema,
            procedure_md, hazards_md, ppe_md, tools_md, threshold_text, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Planned',$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            site, entity.id, `${entity.name} • ${cg.items[0].label}`,
            task_code, cg.cluster, schema.frequency_months,
            last, next,
            schema.value_type, JSON.stringify(schema.result_schema),
            schema.procedure_md, schema.hazards_md, schema.ppe_md, schema.tools_md,
            schema.threshold_text, 'system'
          ]
        );
        created++;
      }
    }
  }
  return created;
}

async function regenerateTasks(site="Default") {
  const { rows: entities } = await pool.query("SELECT * FROM controls_entities WHERE site=$1", [site]);
  let created = 0;
  for (const e of entities) {
    created += await ensureActiveTaskForEntity(site, e);
  }
  await ensureOverdueFlags();
  return created;
}

// ---------------------------------------------------------------------------
// SYNC
// ---------------------------------------------------------------------------
app.post("/api/controls/sync", async (req, res) => {
  try {
    const site = req.body?.site || req.headers["x-site"] || "Default";
    const source = (req.query.source || process.env.CONTROLS_SOURCE || "auto").toLowerCase();

    let incoming = [];
    if (source === "db") {
      incoming = await loadFromDB(site);
    } else if (source === "http") {
      incoming = [
        ...(await loadSwitchboardsHTTP(site)),
        ...(await loadHVHTTP(site)),
        ...(await loadATEXHTTP(site)),
      ];
    } else {
      try { incoming = await loadFromDB(site); } catch { incoming = []; }
      if (incoming.length === 0) {
        incoming = [
          ...(await loadSwitchboardsHTTP(site)),
          ...(await loadHVHTTP(site)),
          ...(await loadATEXHTTP(site)),
        ];
      }
    }

    // déduplication par (equipment_type + code)
    const map = new Map();
    for (const x of incoming) {
      if (!x.code) continue;
      const key = `${x.equipment_type}:${x.code}`;
      if (!map.has(key)) map.set(key, x);
    }
    const items = Array.from(map.values());

    let added = 0, updated = 0, flaggedNotPresent = 0;
    for (const inc of items) {
      if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) {
        await pool.query(
          "INSERT INTO controls_not_present (site, building, equipment_type, declared_by, note) VALUES ($1,$2,$3,$4,$5)",
          [site, inc.building || null, inc.equipment_type, "system", "Type non couvert par la TSD"]
        );
        flaggedNotPresent++;
        continue;
      }
      const { rows: exist } = await pool.query(
        "SELECT id, building, name, parent_code FROM controls_entities WHERE site=$1 AND code=$2",
        [site, inc.code]
      );
      if (exist.length === 0) {
        await pool.query(
          "INSERT INTO controls_entities (site, building, equipment_type, name, code, parent_code) VALUES ($1,$2,$3,$4,$5,$6)",
          [site, inc.building || null, inc.equipment_type, inc.name, inc.code, inc.parent_code || null]
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

    const created = await regenerateTasks(site);
    res.json({ source: source || "auto", synced: items.length, added, updated, not_present_flagged: flaggedNotPresent, tasks_created: created });
  } catch (e) {
    log("sync error:", e);
    res.status(500).json({ error: "Erreur sync", details: e.message });
  }
});

// ---------------------------------------------------------------------------
// CATALOG
// ---------------------------------------------------------------------------
app.get("/api/controls/catalog", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  const { rows } = await pool.query(
    "SELECT * FROM controls_entities WHERE site=$1 ORDER BY id DESC",
    [site]
  );
  res.json({ data: rows });
});

app.post("/api/controls/catalog", async (req, res) => {
  const { site="Default", building, equipment_type, name, code, parent_code=null } = req.body || {};
  if (!equipment_type || !name) return res.status(400).json({ error: "Champs requis manquants" });
  const { rows: exist } = await pool.query(
    "SELECT id FROM controls_entities WHERE site=$1 AND code=$2",
    [site, code]
  );
  if (exist.length) return res.status(200).json({ id: exist[0].id, created: false });
  const { rows } = await pool.query(
    "INSERT INTO controls_entities (site,building,equipment_type,name,code,parent_code) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [site, building || null, equipment_type, name, code || null, parent_code]
  );
  res.status(201).json(rows[0]);
});

app.delete("/api/controls/catalog/:id", async (req, res) => {
  await pool.query("DELETE FROM controls_entities WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// TASKS — list, details (+tsd cluster), complete -> create next
// ---------------------------------------------------------------------------
app.get("/api/controls/tasks", async (req, res) => {
  try {
    const site = req.headers["x-site"] || req.query.site || "Default";
    const { building, type, status, q, page = 1, pageSize = 200, entity_id } = req.query;
    await ensureOverdueFlags();

    let query = `
      SELECT ct.*, ce.equipment_type, ce.building, ce.name AS entity_name, ce.code AS entity_code
      FROM controls_tasks ct
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id
      WHERE ct.site = $1`;
    const values = [site]; let i = 2;

    if (building) { query += ` AND ce.building = $${i++}`; values.push(building); }
    if (type) { query += ` AND ce.equipment_type = $${i++}`; values.push(type); }
    if (status) { query += ` AND ct.status = $${i++}`; values.push(status); }
    if (entity_id) { query += ` AND ct.entity_id = $${i++}`; values.push(Number(entity_id)); }
    if (q) { query += ` AND (ct.task_name ILIKE $${i} OR ct.task_code ILIKE $${i})`; values.push(`%${q}%`); i++; }

    query += ` ORDER BY 
      CASE WHEN ct.status='Overdue' THEN 0 WHEN ct.status='Planned' THEN 1 WHEN ct.status='Pending' THEN 2 ELSE 3 END ASC,
      ct.next_control ASC NULLS LAST, ct.id DESC
      LIMIT $${i} OFFSET $${i+1}`;
    values.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

    const { rows } = await pool.query(query, values);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: "Erreur list tasks", details: e.message });
  }
});

app.get("/api/controls/tasks/:id/details", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT ct.*, ce.equipment_type, ce.name AS entity_name, ce.code AS entity_code, ce.building
     FROM controls_tasks ct
     LEFT JOIN controls_entities ce ON ce.id = ct.entity_id
     WHERE ct.id=$1`, [id]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const t = rows[0];

  // joindre le cluster TSD correspondant
  const tsdItems = (TSD_LIBRARY[t.equipment_type] || []);
  const clusterItems = t.cluster
    ? tsdItems.filter(it => (it.cluster || it.id) === t.cluster)
    : tsdItems.filter(it => it.id === t.task_code);

  res.json({ ...t, tsd_cluster_items: clusterItems });
});

// Completer une tâche -> crée la prochaine
app.post("/api/controls/tasks/:id/complete", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { user = "tech", results = {}, ai_risk_score = null, notes = "" } = req.body || {};
    const { rows: trows } = await pool.query(
      `SELECT ct.*, ce.equipment_type, ce.name AS entity_name
       FROM controls_tasks ct LEFT JOIN controls_entities ce ON ce.id = ct.entity_id
       WHERE ct.id=$1`, [id]);
    if (!trows.length) return res.status(404).json({ error: "Not found" });
    const t = trows[0];

    // Clôturer l'actuelle
    const today = todayISO();
    await pool.query(
      `UPDATE controls_tasks
       SET status='Completed', results=$1, last_control=$2, updated_at=NOW()
       WHERE id=$3`,
      [JSON.stringify(results || {}), today, id]
    );

    // Historique + Record + marquer "fait" sur l’entité (clé = cluster ou code)
    const doneKey = t.cluster || t.task_code;
    await pool.query(
      "INSERT INTO controls_history (site, task_id, task_name, user_name, \"user\", action, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [t.site || "Default", id, t.task_name, user, user, "Completed", JSON.stringify({ ai_risk_score, results, notes })]
    );
    await pool.query(
      "INSERT INTO controls_records (site, entity_id, task_code, results, created_by) VALUES ($1,$2,$3,$4,$5)",
      [t.site || "Default", t.entity_id, doneKey, JSON.stringify(results || {}), user]
    );
    await pool.query(
      "UPDATE controls_entities SET done = done || jsonb_build_object($1, $2) WHERE id=$3",
      [doneKey, today, t.entity_id]
    );

    // Détection non-conformités pour déclencher WO (historique)
    let ncFound = false;
    const flatVals = typeof results === "object" ? JSON.stringify(results).toLowerCase() : "";
    if (flatVals.includes("non_conforme") || flatVals.includes("\"ko\"") || flatVals.includes("reject")) {
      ncFound = true;
    }
    if (ncFound) {
      await pool.query(
        "INSERT INTO controls_history (site, task_id, task_name, user_name, \"user\", action, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [t.site || "Default", id, t.task_name, user, user, "NC", JSON.stringify({ reason: "Checklist non conforme", results })]
      );
    }

    // Créer la prochaine tâche (planned)
    const freq = t.frequency_months || 12;
    const next = addMonths(today, freq);

    // Récupérer schéma et textes existants (on garde le même cluster / code)
    const { rows: current } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [id]);
    const cur = current[0];

    const { rows: newTask } = await pool.query(
      `INSERT INTO controls_tasks (
          site, entity_id, task_name, task_code, cluster, frequency_months,
          last_control, next_control, status, value_type, result_schema,
          procedure_md, hazards_md, ppe_md, tools_md, threshold_text, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Planned',$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING id`,
      [
        cur.site, cur.entity_id, cur.task_name, cur.task_code, cur.cluster, cur.frequency_months,
        today, next, cur.value_type, cur.result_schema,
        cur.procedure_md, cur.hazards_md, cur.ppe_md, cur.tools_md, cur.threshold_text, user || 'system'
      ]
    );

    res.json({ ok: true, next_task_id: newTask[0].id, next_control: next, non_conformity: ncFound });
  } catch (e) {
    res.status(500).json({ error: "Erreur completion", details: e.message });
  }
});

// ---------------------------------------------------------------------------
// ASSISTANT IA — consignes, lecture photos "pré-intervention", aide mesure
// ---------------------------------------------------------------------------
app.post("/api/controls/tasks/:id/assistant", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { question = "", use_pre_images = true, attachment_ids = [] } = req.body || {};

    const { rows: trows } = await pool.query(
      `SELECT ct.*, ce.equipment_type, ce.name AS entity_name, ce.code AS entity_code, ce.building
       FROM controls_tasks ct
       LEFT JOIN controls_entities ce ON ce.id = ct.entity_id
       WHERE ct.id=$1`, [id]);
    if (!trows.length) return res.status(404).json({ error: "Not found" });
    const t = trows[0];

    // Contexte TSD
    const tsdItems = (TSD_LIBRARY[t.equipment_type] || []);
    const items = t.cluster
      ? tsdItems.filter(it => (it.cluster || it.id) === t.cluster)
      : tsdItems.filter(it => it.id === t.task_code);

    // Pièces jointes "pré" (ou ids spécifiques)
    let images = [];
    if (use_pre_images || (attachment_ids && attachment_ids.length)) {
      const { rows: atts } = attachment_ids.length
        ? await pool.query(`SELECT * FROM controls_attachments WHERE task_id=$1 AND id = ANY($2::int[]) ORDER BY uploaded_at DESC`, [id, attachment_ids])
        : await pool.query(`SELECT * FROM controls_attachments WHERE task_id=$1 AND (label ILIKE 'pre%' OR label IS NULL) ORDER BY uploaded_at DESC LIMIT 4`, [id]);

      images = atts.map(a => ({
        type: "input_image",
        image_url: {
          url: `data:${a.mimetype};base64,${Buffer.from(a.data).toString("base64")}`
        }
      }));
    }

    const system = `Tu es l'assistant sécurité & qualité pour des contrôles électriques. 
Rédige des consignes claires pour: EPI, zones à observer, points de mesure, appareil requis, interprétation des mesures, et alertes.
Réponds en français, en listes courtes et actions concrètes.`;

    const content = [
      { type: "text", text:
        `Équipement: ${t.equipment_type} • ${t.entity_name} (${t.entity_code}) • Bâtiment ${t.building || "?"}
Tâche: ${t.task_name}
Fréquence: ${t.frequency_months || 12} mois
Seuils: ${t.threshold_text || "(voir items)"}
Points: ${items.map(it => `- ${it.label}`).join("\n")}
Question: ${question || "(guidage pré-intervention)"}`
      },
      ...images
    ];

    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        ok: true,
        message: `Conseils IA (mode local): 
- EPI: gants isolants adaptés, lunettes, casque.
- Avant d'ouvrir: consignation si besoin, balisage zone.
- Photos claires des bornes/écrans. Mesure avec l’appareil indiqué dans la procédure.
- Compare la valeur aux seuils: ${t.threshold_text || "cf. items"}.`
      });
    }

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content }
      ],
      temperature: 0.2
    });

    const text = chat.choices?.[0]?.message?.content || "—";
    res.json({ ok: true, message: text });
  } catch (e) {
    res.status(500).json({ error: "Erreur assistant", details: e.message });
  }
});

// ---------------------------------------------------------------------------
// ATTACHMENTS — upload multi, list, get, delete
// ---------------------------------------------------------------------------
app.post("/api/controls/tasks/:id/upload", upload.array("files", 20), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const files = req.files || [];
    const label = req.body?.label || null; // même label pour le lot
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
  const { rows } = await pool.query(
    "SELECT * FROM controls_attachments WHERE id=$1 AND task_id=$2",
    [attId, taskId]
  );
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

// ---------------------------------------------------------------------------
// NOT PRESENT
// ---------------------------------------------------------------------------
app.get("/api/controls/not-present", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  const { rows } = await pool.query(
    "SELECT * FROM controls_not_present WHERE site=$1 ORDER BY id DESC",
    [site]
  );
  res.json(rows);
});

app.post("/api/controls/not-present", async (req, res) => {
  const { site="Default", building, equipment_type, declared_by="user", note="" } = req.body || {};
  const { rows } = await pool.query(
    "INSERT INTO controls_not_present (site,building,equipment_type,declared_by,note) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [site, building || null, equipment_type, declared_by, note]
  );
  res.status(201).json(rows[0]);
});

app.post("/api/controls/not-present/:id/assess", async (req, res) => {
  const id = Number(req.params.id);
  const { action="Assessed", user="system", meta={} } = req.body || {};
  await pool.query(
    "INSERT INTO controls_history (site, task_id, task_name, user_name, \"user\", action, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [req.headers["x-site"] || "Default", null, `not-present#${id}`, user, user, action, JSON.stringify(meta)]
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// HISTORY & RECORDS
// ---------------------------------------------------------------------------
app.get("/api/controls/history", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  const { rows } = await pool.query(
    "SELECT * FROM controls_history WHERE site=$1 ORDER BY date DESC LIMIT 200",
    [site]
  );
  res.json(rows);
});

app.get("/api/controls/records", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  const { rows } = await pool.query(
    "SELECT * FROM controls_records WHERE site=$1 ORDER BY created_at DESC LIMIT 200",
    [site]
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// TREE (building -> groups -> entities (+devices sous switchboard))
// ---------------------------------------------------------------------------
app.get("/api/controls/tree", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";

  const { rows: ents } = await pool.query(
    "SELECT id, site, building, equipment_type, name, code, parent_code FROM controls_entities WHERE site=$1 ORDER BY building, equipment_type, name",
    [site]
  );

  const { rows: counts } = await pool.query(`
    SELECT entity_id,
      SUM((status='Planned')::int) AS planned,
      SUM((status='Overdue')::int) AS overdue,
      SUM((status='Pending')::int) AS pending,
      SUM((status='Completed')::int) AS completed,
      MIN(next_control) AS next_due
    FROM controls_tasks
    WHERE site=$1
    GROUP BY entity_id
  `, [site]);

  const cMap = new Map(counts.map(r => [r.entity_id, r]));

  // group by building
  const buildings = {};
  for (const e of ents) {
    const b = e.building || "B00";
    buildings[b] ||= { building: b, groups: { LV_SWITCHBOARD: [], LV_DEVICE: [], HV_EQUIPMENT: [], ATEX_EQUIPMENT: [] }, boardsByCode: {} };

    // pré-indexer switchboards
    if (e.equipment_type === "LV_SWITCHBOARD") {
      const node = {
        id: e.id, code: e.code, name: e.name, type: e.equipment_type,
        counts: cMap.get(e.id) || { planned: 0, overdue: 0, pending: 0, completed: 0, next_due: null },
        children: [] // devices
      };
      buildings[b].groups.LV_SWITCHBOARD.push(node);
      if (e.code) buildings[b].boardsByCode[e.code] = node;
    }
  }

  // ranger Devices sous leur parent si connu
  for (const e of ents) {
    const b = e.building || "B00";
    if (e.equipment_type === "LV_DEVICE" && e.parent_code && buildings[b]?.boardsByCode[e.parent_code]) {
      buildings[b].boardsByCode[e.parent_code].children.push({
        id: e.id, code: e.code, name: e.name, type: e.equipment_type,
        counts: cMap.get(e.id) || { planned: 0, overdue: 0, pending: 0, completed: 0, next_due: null }
      });
    }
  }

  // entités restantes
  for (const e of ents) {
    const b = e.building || "B00";
    const bucket = buildings[b].groups;
    const counts = cMap.get(e.id) || { planned: 0, overdue: 0, pending: 0, completed: 0, next_due: null };

    if (e.equipment_type === "LV_DEVICE" && e.parent_code && buildings[b].boardsByCode[e.parent_code]) continue;
    if (e.equipment_type === "LV_DEVICE") bucket.LV_DEVICE.push({ id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts });
    if (e.equipment_type === "HV_EQUIPMENT") bucket.HV_EQUIPMENT.push({ id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts });
    if (e.equipment_type === "ATEX_EQUIPMENT") bucket.ATEX_EQUIPMENT.push({ id: e.id, code: e.code, name: e.name, type: e.equipment_type, counts });
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

// ---------------------------------------------------------------------------
// CALENDAR — vue globale des futures échéances
// ---------------------------------------------------------------------------
app.get("/api/controls/calendar", async (req, res) => {
  const site = req.headers["x-site"] || req.query.site || "Default";
  const { from, to } = req.query;
  const q = `
    SELECT ct.id, ct.next_control, ct.status, ct.task_name, ce.name AS entity_name, ce.code AS entity_code, ce.equipment_type, ce.building
    FROM controls_tasks ct
    LEFT JOIN controls_entities ce ON ce.id = ct.entity_id
    WHERE ct.site=$1
      AND ct.next_control IS NOT NULL
      AND ct.status IN ('Planned','Overdue')
      AND ($2::date IS NULL OR ct.next_control >= $2::date)
      AND ($3::date IS NULL OR ct.next_control <= $3::date)
    ORDER BY ct.next_control ASC, ct.id DESC
    LIMIT 1000`;
  const { rows } = await pool.query(q, [site, from || null, to || null]);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// HEALTH
// ---------------------------------------------------------------------------
app.get("/api/controls/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------------
// START — garde EXACTEMENT ce snippet (pas de PORT)
// ---------------------------------------------------------------------------
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
