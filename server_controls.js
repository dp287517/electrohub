// server_controls.js — Controls backend complet (production-ready)
// Features : Sync (Switchboard/HV/ATEX) → Entities → Tasks depuis TSD, Attachments (multi),
// AI analyze/assistant, Catalog/Not-Present/History/Records, Filters, Health.
// IMPORTANT : écoute UNIQUEMENT sur CONTROLS_PORT (ou 3011). Ne jamais utiliser PORT ici.

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

// CORS permissif (si besoin multi-origines)
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

// ---------------------------------------------------------------------------
// UTILS
// ---------------------------------------------------------------------------
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addMonths(dateStr, months) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setMonth(d.getMonth() + (months || 0));
  return d.toISOString().slice(0, 10);
}
function isDue(last, freqMonths) {
  if (!freqMonths || freqMonths <= 0) return true;
  if (!last) return true;
  const next = addMonths(last, freqMonths);
  return new Date(next) <= new Date();
}
function log(...args) { if (process.env.CONTROLS_LOG !== "0") console.log("[controls]", ...args); }

// ---------------------------------------------------------------------------
// SCHEMA — 7 tables + migrations rétro-compatibles
// ---------------------------------------------------------------------------
async function ensureSchema() {
  // === CREATE (si pas encore là) ===
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_entities (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      building TEXT,
      equipment_type TEXT,
      name TEXT,
      code TEXT,
      done JSONB DEFAULT '{}'::jsonb,   -- { "<task_code>": "YYYY-MM-DD", ... }
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
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
      frequency_months INTEGER,
      last_control DATE,
      next_control DATE,
      status TEXT DEFAULT 'Planned',  -- Planned | Completed | Overdue
      value_type TEXT DEFAULT 'checklist',
      result_schema JSONB,            -- { field, type, unit, comparator, threshold }
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE CASCADE,
      filename TEXT,
      size INTEGER,
      mimetype TEXT,
      data BYTEA,
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

  // === ALTER (rendre compatible les anciennes bases) ===
  // controls_history : ajouter la colonne "site" si manquante
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'Default';`);
  await pool.query(`ALTER TABLE controls_history ALTER COLUMN site SET DEFAULT 'Default';`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ DEFAULT NOW();`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS meta JSONB;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS task_name TEXT;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS user_name TEXT;`);
  await pool.query(`ALTER TABLE controls_history ADD COLUMN IF NOT EXISTS action TEXT;`);

  // controls_tasks : colonnes parfois manquantes dans d’anciennes versions
  await pool.query(`ALTER TABLE controls_tasks ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'Default';`);
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

  // controls_entities : colonne "done" ou "updated_at" parfois absentes
  await pool.query(`ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS done JSONB DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);

  // controls_records : colonne "site" si manquante
  await pool.query(`ALTER TABLE controls_records ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'Default';`);

  // controls_not_present : colonne "site" si manquante
  await pool.query(`ALTER TABLE controls_not_present ADD COLUMN IF NOT EXISTS site TEXT DEFAULT 'Default';`);

  // Index idempotents
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_tasks_site ON controls_tasks(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_tasks_next ON controls_tasks(next_control);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_entities_site ON controls_entities(site);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controls_history_site_date ON controls_history(site, date DESC);`);

  log("[controls] schema ensured (create + alter ok)");
}
await ensureSchema().catch(e => { console.error("[schema] init error:", e); process.exit(1); });

// Marquer Overdue auto
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
// SYNC (Switchboard/HV/ATEX) → Entities → Tasks (TSD)
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

async function loadSwitchboards(site="Default") {
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
    out.push({
      site, building: d.building || d.building_code || "B00",
      equipment_type: "LV_DEVICE",
      name: d.name || `Device-${d.id}`,
      code: d.code || `DEV-${d.id}`
    });
  }
  return out;
}

async function loadHV(site="Default") {
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

async function loadATEX(site="Default") {
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

async function regenerateTasks(site="Default") {
  const { rows: entities } = await pool.query("SELECT * FROM controls_entities WHERE site=$1", [site]);
  let created = 0;
  for (const e of entities) {
    const items = TSD_LIBRARY[e.equipment_type] || [];
    const done = e.done || {};
    for (const it of items) {
      const last = done[it.id] || null;
      if (isDue(last, it.frequency_months)) {
        const { rows: exists } = await pool.query(
          `SELECT id FROM controls_tasks
           WHERE site=$1 AND entity_id=$2 AND task_code=$3 AND status IN ('Planned','Overdue') LIMIT 1`,
          [site, e.id, it.id]
        );
        if (exists.length === 0) {
          await pool.query(
            `INSERT INTO controls_tasks (
              site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status,
              value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Planned',$8,$9,$10,$11,$12,$13,$14)`,
            [
              site, e.id, `${e.name} • ${it.label}`, it.id, it.frequency_months,
              null, todayISO(),
              'checklist',
              JSON.stringify({ field: it.field, type: it.type, unit: it.unit, comparator: it.comparator, threshold: it.threshold }),
              it.procedure_md || '', it.hazards_md || '', it.ppe_md || '', it.tools_md || '',
              'system'
            ]
          );
          created++;
        }
      }
    }
  }
  await ensureOverdueFlags();
  return created;
}

app.post("/api/controls/sync", async (req, res) => {
  try {
    const site = req.body?.site || req.headers["x-site"] || "Default";
    const incoming = [
      ...(await loadSwitchboards(site)),
      ...(await loadHV(site)),
      ...(await loadATEX(site)),
    ];

    let added = 0, updated = 0, flaggedNotPresent = 0;
    for (const inc of incoming) {
      if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) {
        await pool.query(
          "INSERT INTO controls_not_present (site, building, equipment_type, declared_by, note) VALUES ($1,$2,$3,$4,$5)",
          [site, inc.building || null, inc.equipment_type, "system", "Type non couvert par la TSD"]
        );
        flaggedNotPresent++;
        continue;
      }
      const { rows: exist } = await pool.query(
        "SELECT * FROM controls_entities WHERE site=$1 AND code=$2",
        [site, inc.code || null]
      );
      if (exist.length === 0) {
        await pool.query(
          "INSERT INTO controls_entities (site, building, equipment_type, name, code) VALUES ($1,$2,$3,$4,$5)",
          [site, inc.building || null, inc.equipment_type, inc.name, inc.code || null]
        );
        added++;
      } else {
        const prev = exist[0];
        if (prev.name !== inc.name || prev.building !== inc.building) {
          await pool.query(
            "UPDATE controls_entities SET building=$1, name=$2, updated_at=NOW() WHERE id=$3",
            [inc.building || null, inc.name, prev.id]
          );
          updated++;
        }
      }
    }

    const created = await regenerateTasks(site);
    res.json({ synced: incoming.length, added, updated, not_present_flagged: flaggedNotPresent, tasks_created: created });
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
  const { site="Default", building, equipment_type, name, code } = req.body || {};
  if (!equipment_type || !name) return res.status(400).json({ error: "Champs requis manquants" });
  const { rows: exist } = await pool.query(
    "SELECT id FROM controls_entities WHERE site=$1 AND code=$2",
    [site, code]
  );
  if (exist.length) return res.status(200).json({ id: exist[0].id, created: false });
  const { rows } = await pool.query(
    "INSERT INTO controls_entities (site,building,equipment_type,name,code) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [site, building || null, equipment_type, name, code || null]
  );
  res.status(201).json(rows[0]);
});

app.delete("/api/controls/catalog/:id", async (req, res) => {
  await pool.query("DELETE FROM controls_entities WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// TASKS — list, details (+tsd_item), complete
// ---------------------------------------------------------------------------
app.get("/api/controls/tasks", async (req, res) => {
  try {
    const site = req.headers["x-site"] || req.query.site || "Default";
    const { building, type, status, q, page = 1, pageSize = 200 } = req.query;
    await ensureOverdueFlags();

    let query = `
      SELECT ct.*, ce.equipment_type, ce.building, ce.name AS entity_name
      FROM controls_tasks ct
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id
      WHERE ct.site = $1`;
    const values = [site]; let i = 2;

    if (building) { query += ` AND ce.building = $${i++}`; values.push(building); }
    if (type) { query += ` AND ce.equipment_type = $${i++}`; values.push(type); }
    if (status) { query += ` AND ct.status = $${i++}`; values.push(status); }
    if (q) { query += ` AND (ct.task_name ILIKE $${i} OR ct.task_code ILIKE $${i})`; values.push(`%${q}%`); i++; }

    query += ` ORDER BY ct.next_control ASC NULLS LAST, ct.id DESC LIMIT $${i} OFFSET $${i+1}`;
    values.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

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

  // joindre l’item TSD correspondant
  let tsd_item = null;
  const { rows: ent } = await pool.query("SELECT equipment_type FROM controls_entities WHERE id=$1", [t.entity_id]);
  const eqType = ent[0]?.equipment_type;
  if (eqType && TSD_LIBRARY[eqType]) {
    tsd_item = (TSD_LIBRARY[eqType] || []).find(it => it.id === t.task_code) || null;
  }
  if (!tsd_item) {
    tsd_item = Object.values(TSD_LIBRARY).flat().find(it => it.id === t.task_code) || null;
  }

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

    // Historique + Record + marquer "fait" sur l'entité
    await pool.query(
      "INSERT INTO controls_history (site, task_id, task_name, user_name, action, meta) VALUES ($1,$2,$3,$4,$5,$6)",
      [t.site || "Default", id, t.task_name, user, "Completed", JSON.stringify({ ai_risk_score, results })]
    );
    await pool.query(
      "INSERT INTO controls_records (site, entity_id, task_code, results, created_by) VALUES ($1,$2,$3,$4,$5)",
      [t.site || "Default", t.entity_id, t.task_code, JSON.stringify(results || {}), user]
    );
    await pool.query(
      "UPDATE controls_entities SET done = done || jsonb_build_object($1, $2) WHERE id=$3",
      [t.task_code, todayISO(), t.entity_id]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erreur completion", details: e.message });
  }
});

// ---------------------------------------------------------------------------
// ATTACHMENTS — upload multi, list, get, delete
// ---------------------------------------------------------------------------
app.post("/api/controls/tasks/:id/upload", upload.array("files", 20), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const files = req.files || [];
    for (const f of files) {
      await pool.query(
        "INSERT INTO controls_attachments (task_id, filename, size, mimetype, data) VALUES ($1,$2,$3,$4,$5)",
        [id, f.originalname, f.size, f.mimetype, f.buffer]
      );
    }
    res.json({ uploaded: files.length });
  } catch (e) {
    res.status(500).json({ error: "Erreur upload", details: e.message });
  }
});

app.get("/api/controls/tasks/:id/attachments", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    "SELECT id, filename, size, mimetype, uploaded_at FROM controls_attachments WHERE task_id=$1 ORDER BY uploaded_at DESC",
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
    "INSERT INTO controls_history (site, task_id, task_name, user_name, action, meta) VALUES ($1,$2,$3,$4,$5,$6)",
    [req.headers["x-site"] || "Default", null, `not-present#${id}`, user, action, JSON.stringify(meta)]
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
// GENERATE (recrée les tâches "due" à partir de la TSD pour le site)
// ---------------------------------------------------------------------------
app.post("/api/controls/generate", async (req, res) => {
  const site = req.body?.site || req.headers["x-site"] || "Default";
  const created = await regenerateTasks(site);
  res.json({ created });
});

// ---------------------------------------------------------------------------
// AI — Analyze (lit toutes les PJ image/doc et produit extraction + conseils)
// ---------------------------------------------------------------------------
app.post("/api/controls/tasks/:id/analyze", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: trows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [id]);
    if (!trows.length) return res.status(404).json({ error: "Task not found" });
    const t = trows[0];

    const { rows: atts } = await pool.query("SELECT * FROM controls_attachments WHERE task_id=$1 ORDER BY uploaded_at ASC", [id]);
    if (!atts.length) return res.status(400).json({ error: "No attachments" });

    const messages = [
      {
        role: "system",
        content:
          "Tu es un assistant de contrôle électrique. À partir des images et documents fournis, " +
          "1) extrais les valeurs techniques utiles (ex: ΔT IR, densité SF6, tan δ, résistance d’isolement...), " +
          "2) détecte anomalies/écarts par rapport à la TSD, " +
          "3) propose des actions de prévention des risques (safety) et 4) indique la démarche de test (pas à pas) si demandé.",
      },
      { role: "user", content: `Tâche: ${t.task_name} — Code: ${t.task_code}. Site: ${t.site || "Default"}.` },
    ];

    for (const att of atts) {
      if (att.mimetype?.startsWith("image/")) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: `Analyse l'image suivante (${att.filename}) et extrais les valeurs/lectures visibles.` },
            { type: "image_url", image_url: `data:${att.mimetype};base64,${att.data.toString("base64")}` }
          ]
        });
      } else {
        messages.push({
          role: "user",
          content: `Document joint: ${att.filename} (${att.mimetype}, ${Math.round(att.size/1024)} kB). Si lisible, indique les mesures clés à relever.`
        });
      }
    }

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.2
    });
    const reply = completion.choices?.[0]?.message?.content || "Analyse indisponible";

    await pool.query(
      "UPDATE controls_tasks SET ai_notes = ai_notes || $1::jsonb WHERE id=$2",
      [JSON.stringify([{ ts: new Date().toISOString(), note: reply }]), id]
    );
    await pool.query(
      "INSERT INTO controls_history (site, task_id, task_name, user_name, action, meta) VALUES ($1,$2,$3,$4,$5,$6)",
      [t.site || "Default", id, t.task_name, "ai", "Analyzed", JSON.stringify({ notes: reply })]
    );

    res.json({ analysis: reply });
  } catch (e) {
    res.status(500).json({ error: "Analyze error", details: e.message });
  }
});

// ---------------------------------------------------------------------------
// AI — Assistant (Q&A guidé sur la tâche/la TSD)
// ---------------------------------------------------------------------------
app.post("/api/controls/tasks/:id/assistant", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const question = (req.body?.question || "").slice(0, 4000);
    const { rows: trows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [id]);
    if (!trows.length) return res.status(404).json({ error: "Task not found" });
    const t = trows[0];

    const { rows: ent } = await pool.query("SELECT equipment_type,name FROM controls_entities WHERE id=$1", [t.entity_id]);
    const eqType = ent[0]?.equipment_type, eqName = ent[0]?.name;
    let tsd_item = null;
    if (eqType && TSD_LIBRARY[eqType]) {
      tsd_item = (TSD_LIBRARY[eqType] || []).find(i => i.id === t.task_code) || null;
    }
    if (!tsd_item) {
      tsd_item = Object.values(TSD_LIBRARY).flat().find(i => i.id === t.task_code) || null;
    }

    const messages = [
      { role: "system", content: "Tu es un expert en maintenance/inspection électrique. Donne des réponses pratiques, structurées, basées sur la TSD jointe, sans valider automatiquement le contrôle." },
      { role: "user", content: `Equipement: ${eqName || "Entity#"+t.entity_id} (${eqType}). Tâche: ${t.task_name} (${t.task_code}).\nTSD: ${tsd_item ? JSON.stringify(tsd_item) : "Non trouvé"}.\nQuestion: ${question || "Comment réaliser le test ?"}\nRéponds en français, avec étapes claires et avertissements safety.` }
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.2
    });
    const answer = completion.choices?.[0]?.message?.content || "Pas de réponse";

    await pool.query(
      "INSERT INTO controls_history (site, task_id, task_name, user_name, action, meta) VALUES ($1,$2,$3,$4,$5,$6)",
      [t.site || "Default", id, t.task_name, "ai", "Assistant", JSON.stringify({ q: question, a: answer })]
    );

    res.json({ answer });
  } catch (e) {
    res.status(500).json({ error: "Assistant error", details: e.message });
  }
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
