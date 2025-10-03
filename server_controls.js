// server_controls.js
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import multer from "multer";
import pg from "pg";
import OpenAI from "openai";
import fetch from "node-fetch";
import { TSD_LIBRARY, EQUIPMENT_TYPES } from "./tsd_library.js";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });
const app = express();
app.use(helmet());
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =====================================================================================
// UTILS
// =====================================================================================
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addMonths(dateStr, months) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function isDue(last, freqMonths) {
  if (!last) return true;
  const next = addMonths(last, freqMonths);
  return new Date(next) <= new Date();
}
function log(...args) {
  if (process.env.CONTROLS_LOG !== "0") console.log("[controls]", ...args);
}

// =====================================================================================
// SCHEMA
// =====================================================================================
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
      updated_at TIMESTAMPTZ DEFAULT NOW()
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
}
await ensureSchema();

// =====================================================================================
// LIBRARY
// =====================================================================================
app.get("/api/controls/library", (_req, res) => {
  res.json({ types: EQUIPMENT_TYPES, library: TSD_LIBRARY });
});

// =====================================================================================
// SYNC
// =====================================================================================
async function safeFetchJson(url) {
  try {
    const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    log("fetch error:", url, e.message);
    return null;
  }
}
async function loadSwitchboards(site = "Default") {
  const url = process.env.SWITCHBOARD_URL;
  if (!url) return [];
  const data = await safeFetchJson(`${url}/api/switchboard/boards?site=${site}`);
  const devices = await safeFetchJson(`${url}/api/switchboard/devices?site=${site}`);
  return [
    ...(data?.data || []).map(sb => ({
      site, building: sb.building, equipment_type: "LV_SWITCHBOARD",
      name: sb.name, code: sb.code
    })),
    ...(devices?.data || []).map(d => ({
      site, building: d.building, equipment_type: "LV_DEVICE",
      name: d.name, code: d.code
    }))
  ];
}
async function loadHV(site="Default") {
  const url = process.env.HV_URL;
  if (!url) return [];
  const data = await safeFetchJson(`${url}/api/hv/equipments?site=${site}`);
  return (data?.data||[]).map(h => ({
    site, building: h.building, equipment_type: "HV_EQUIPMENT",
    name: h.name, code: h.code
  }));
}
async function loadATEX(site="Default") {
  const url = process.env.ATEX_URL;
  if (!url) return [];
  const data = await safeFetchJson(`${url}/api/atex/equipments?site=${site}`);
  return (data?.data||[]).map(ax => ({
    site, building: ax.building, equipment_type: "ATEX_EQUIPMENT",
    name: ax.component_type, code: ax.manufacturer_ref
  }));
}

async function regenerateTasks(site="Default") {
  const { rows: entities } = await pool.query("SELECT * FROM controls_entities WHERE site=$1", [site]);
  let created=0;
  for (const e of entities) {
    const items = TSD_LIBRARY[e.equipment_type] || [];
    const done = e.done || {};
    for (const it of items) {
      const last = done[it.id] || null;
      if (isDue(last, it.frequency_months)) {
        const { rows: exists } = await pool.query(
          "SELECT id FROM controls_tasks WHERE site=$1 AND entity_id=$2 AND task_code=$3 AND status IN ('Planned','Overdue') LIMIT 1",
          [site, e.id, it.id]
        );
        if (exists.length===0) {
          await pool.query(
            `INSERT INTO controls_tasks (site,entity_id,task_name,task_code,frequency_months,next_control,status,result_schema,procedure_md,hazards_md,ppe_md,tools_md,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'Planned',$7,$8,$9,$10,$11,$12)`,
            [site,e.id,`${e.name} • ${it.label}`,it.id,it.frequency_months,todayISO(),
             JSON.stringify({ field: it.field, type: it.type, unit: it.unit }),
             it.procedure_md||"",it.hazards_md||"",it.ppe_md||"",it.tools_md||"","system"]
          );
          created++;
        }
      }
    }
  }
  return created;
}

app.post("/api/controls/sync", async (req,res)=>{
  try {
    const site = req.body?.site || "Default";
    const incoming = [
      ...(await loadSwitchboards(site)),
      ...(await loadHV(site)),
      ...(await loadATEX(site))
    ];
    for (const inc of incoming) {
      if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) {
        await pool.query(
          "INSERT INTO controls_not_present (site,building,equipment_type,declared_by,note) VALUES ($1,$2,$3,$4,$5)",
          [site,inc.building,inc.equipment_type,"system","Non couvert dans la TSD"]
        );
        continue;
      }
      const { rows: exist } = await pool.query(
        "SELECT id FROM controls_entities WHERE site=$1 AND code=$2",
        [site,inc.code]
      );
      if (exist.length===0) {
        await pool.query(
          "INSERT INTO controls_entities (site,building,equipment_type,name,code) VALUES ($1,$2,$3,$4,$5)",
          [site,inc.building,inc.equipment_type,inc.name,inc.code]
        );
      }
    }
    const created = await regenerateTasks(site);
    res.json({ synced: incoming.length, tasks_created: created });
  } catch(e) {
    log("sync error",e.message);
    res.status(500).json({ error:e.message });
  }
});

// =====================================================================================
// TASKS + ATTACHMENTS
// =====================================================================================
app.get("/api/controls/tasks", async (_req,res)=>{
  const { rows } = await pool.query("SELECT * FROM controls_tasks ORDER BY id DESC LIMIT 200");
  res.json({ data: rows });
});
app.get("/api/controls/tasks/:id/details", async (req,res)=>{
  const id=Number(req.params.id);
  const { rows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1",[id]);
  if (!rows.length) return res.status(404).json({error:"Not found"});
  res.json(rows[0]);
});
app.post("/api/controls/tasks/:id/upload", upload.array("files",20), async (req,res)=>{
  const id=Number(req.params.id);
  for (const f of req.files||[]) {
    await pool.query(
      "INSERT INTO controls_attachments (task_id,filename,size,mimetype,data) VALUES ($1,$2,$3,$4,$5)",
      [id,f.originalname,f.size,f.mimetype,f.buffer]
    );
  }
  res.json({ uploaded:(req.files||[]).length });
});
app.get("/api/controls/tasks/:id/attachments", async (req,res)=>{
  const id=Number(req.params.id);
  const { rows } = await pool.query(
    "SELECT id,filename,size,mimetype,uploaded_at FROM controls_attachments WHERE task_id=$1",
    [id]
  );
  res.json(rows);
});
app.get("/api/controls/tasks/:id/attachments/:attId", async (req,res)=>{
  const { rows } = await pool.query("SELECT * FROM controls_attachments WHERE id=$1",[req.params.attId]);
  if (!rows.length) return res.status(404).json({error:"not found"});
  const a=rows[0];
  res.setHeader("Content-Type",a.mimetype);
  res.setHeader("Content-Disposition",`attachment; filename="${a.filename}"`);
  res.send(a.data);
});

// =====================================================================================
// AI ENDPOINTS
// =====================================================================================
app.post("/api/controls/tasks/:id/analyze", async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const { rows: atts } = await pool.query("SELECT * FROM controls_attachments WHERE task_id=$1",[id]);
    if (!atts.length) return res.status(400).json({error:"No attachments"});
    const messages=[{ role:"system", content:"Tu es un assistant de contrôle électrique. Analyse les images et documents pour extraire les valeurs mesurées, identifier anomalies et proposer des actions de prévention." }];
    for (const att of atts) {
      if (att.mimetype.startsWith("image/")) {
        messages.push({ role:"user", content:[{ type:"image_url", image_url:`data:${att.mimetype};base64,${att.data.toString("base64")}`}]});
      } else {
        messages.push({ role:"user", content:`Fichier ${att.filename}, contenu non image.` });
      }
    }
    const completion=await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages
    });
    const reply=completion.choices[0].message.content;
    await pool.query("UPDATE controls_tasks SET ai_notes = ai_notes || $1::jsonb WHERE id=$2",
      [JSON.stringify([{ts:new Date().toISOString(),note:reply}]),id]);
    res.json({analysis:reply});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.post("/api/controls/tasks/:id/assistant", async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const question=req.body?.question||"";
    const { rows: task } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1",[id]);
    if (!task.length) return res.status(404).json({error:"Not found"});
    const t=task[0];
    const messages=[
      { role:"system", content:"Tu es un expert de la maintenance électrique. Réponds de façon pratique et précise."},
      { role:"user", content:`Equipement: ${t.task_name}. Question: ${question}`}
    ];
    const completion=await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages
    });
    res.json({answer:completion.choices[0].message.content});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

// =====================================================================================
// START
// =====================================================================================
app.get("/api/controls/health", (_req,res)=>res.json({ok:true,ts:Date.now()}));
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, ()=>console.log(`[controls] serveur démarré sur :${port}`));
