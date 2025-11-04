// ============================================================================
// server_controls.js — v2 (refonte complète mais rétrocompatible Neon / frontend)
// ============================================================================
// Auteur : ChatGPT (refonte 2025)
// Objectif : unifier HV / Switchboards / Devices / Atex via tsd_library.js
// avec support IA, Gantt, intégrité Neon, et conservation totale des routes existantes
// ============================================================================

import express from "express";
import multer from "multer";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

dayjs.extend(utc);

// ---------------------------------------------------------------------------
// Connexion Neon (Postgres)
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------------
// Express app + middlewares
// ---------------------------------------------------------------------------
const app = express();
const router = express.Router();
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

// ---------------------------------------------------------------------------
// Fichier de référence TSD
// ---------------------------------------------------------------------------
let tsdLibrary;
try {
  const tsdPath = path.resolve("./tsd_library.js");
  const mod = await import(tsdPath);
  tsdLibrary = mod.tsdLibrary ?? mod.default?.tsdLibrary ?? mod.default ?? mod;
  if (!tsdLibrary?.categories) {
    throw new Error("Invalid tsd_library.js structure");
  }
  console.log(`[controls] TSD library chargée (${tsdLibrary.categories.length} catégories).`);
} catch (e) {
  console.error("[controls] Erreur chargement tsd_library.js :", e);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utils génériques
// ---------------------------------------------------------------------------
const OPEN_STATUSES = ["Planned", "Pending", "Overdue"];
const CLOSED_STATUSES = ["Done", "Closed"];

function colorFor(catKey) {
  const k = String(catKey || "").toLowerCase();
  if (k.includes("hv")) return "#ef4444";
  if (k.includes("switch")) return "#3b82f6";
  if (k.includes("atex")) return "#f59e0b";
  if (k.includes("device")) return "#22c55e";
  return "#6366f1";
}
function addByFreq(iso, freq) {
  if (!freq) return null;
  const base = dayjs.utc(iso || new Date());
  if (freq.interval && freq.unit) return base.add(freq.interval, freq.unit).toISOString();
  if (freq.min?.interval && freq.min?.unit) return base.add(freq.min.interval, freq.min.unit).toISOString();
  return null;
}

// ---------------------------------------------------------------------------
// IA OpenAI (fail-soft)
// ---------------------------------------------------------------------------
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ---------------------------------------------------------------------------
// Route TSD: /tsd/full et /tsd/missing
// ---------------------------------------------------------------------------
router.get("/tsd/full", (req, res) => {
  res.json(tsdLibrary);
});

router.get("/tsd/missing", async (req, res) => {
  const client = await pool.connect();
  try {
    const wanted = new Set(
      tsdLibrary.categories.map(c => (c.db_table || "").toLowerCase()).filter(Boolean)
    );
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const present = new Set(rows.map(r => r.table_name.toLowerCase()));

    const missing = [...wanted].filter(t => !present.has(t));
    const extra = [...present].filter(t => !wanted.has(t) && !t.startsWith("_"));

    const sqlTemplates = missing.map(t => ({
      table: t,
      sql: `CREATE TABLE IF NOT EXISTS ${t} (
  id SERIAL PRIMARY KEY,
  site TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  building_code TEXT,
  floor TEXT,
  room TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`
    }));
    res.json({ missing, extra, sqlTemplates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Route Gantt: /timeline
// ---------------------------------------------------------------------------
router.get("/timeline", async (req, res) => {
  const { site, status = "open" } = req.query;
  const where = [];
  const params = [];
  let i = 1;

  if (site) {
    where.push(`t.site = $${i++}`);
    params.push(site);
  }
  if (status === "open") {
    where.push(`t.status = ANY($${i++})`);
    params.push(OPEN_STATUSES);
  } else if (status === "closed") {
    where.push(`t.status = ANY($${i++})`);
    params.push(CLOSED_STATUSES);
  }

  const sql = `
    SELECT t.id, t.task_name, t.task_code, t.status,
           t.last_control, t.next_control, t.entity_id
    FROM controls_tasks t
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY t.next_control ASC NULLS LAST
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const items = rows.map(r => {
      const cat = tsdLibrary.categories.find(c =>
        (c.controls || []).some(ctrl =>
          String(ctrl.type || "").toLowerCase() === String(r.task_code || "").toLowerCase()
        )
      );
      const catKey = cat?.key || "generic";
      return {
        id: r.id,
        label: r.task_name,
        start: r.last_control || r.next_control || new Date().toISOString(),
        end: r.next_control,
        status: r.status,
        color: colorFor(catKey),
        category_key: catKey,
        entity_id: r.entity_id
      };
    });
    res.json({ items });
  } catch (e) {
    console.error("[controls] timeline error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Route IA: /tasks/:id/ai/analyze-before
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

router.post("/tasks/:id/ai/analyze-before", upload.single("file"), async (req, res) => {
  if (!openai) {
    return res.json({
      safety: {
        ppe: "Casque, gants isolants, lunettes, chaussures de sécurité",
        hazards: "Risque électrique, arc, parties mobiles"
      },
      procedure: {
        steps: [
          { step: 1, text: "Vérifier la consignation" },
          { step: 2, text: "Mettre les EPI et baliser la zone" }
        ]
      }
    });
  }
  try {
    const imageInput = req.file
      ? [{
          type: "image_url",
          image_url: { url: `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` }
        }]
      : [];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: "Tu es un assistant sécurité. Retourne un JSON { safety:{ppe, hazards}, procedure:{steps:[{step,text}]}}."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyse la scène avant intervention." },
            ...imageInput
          ]
        }
      ]
    });

    const json = JSON.parse(completion.choices[0].message.content);
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Route /tasks — liste des tâches (rétrocompatibilité totale)
// ---------------------------------------------------------------------------
router.get("/tasks", async (req, res) => {
  try {
    const { entity_id } = req.query;
    let sql = "SELECT * FROM controls_tasks";
    const params = [];
    if (entity_id) {
      sql += " WHERE entity_id = $1";
      params.push(entity_id);
    }
    sql += " ORDER BY next_control ASC NULLS LAST";
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Route /tasks/:id/schema — schéma issu de tsd_library
// ---------------------------------------------------------------------------
router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM controls_tasks WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Task not found" });
    const task = rows[0];
    const type = String(task.task_code || "").toLowerCase();

    let schema = null;
    for (const cat of tsdLibrary.categories) {
      const ctrl = (cat.controls || []).find(c => String(c.type || "").toLowerCase() === type);
      if (ctrl) {
        schema = {
          category_key: cat.key,
          checklist: ctrl.checklist.map((q, i) => ({ key: `${cat.key}_${i}`, label: q })),
          observations: ctrl.observations.map((o, i) => ({ key: `${cat.key}_obs_${i}`, label: o })),
          notes: ctrl.notes,
          frequency: ctrl.frequency
        };
        break;
      }
    }
    if (!schema) {
      schema = { checklist: [], observations: [], notes: "Aucun schéma trouvé dans TSD" };
    }
    res.json(schema);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Route /tasks/:id/close — clôture et replanification automatique
// ---------------------------------------------------------------------------
router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const { checklist, observations, comment } = req.body;
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT * FROM controls_tasks WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Task not found" });
    const task = rows[0];

    // Récupération de la fréquence TSD
    const type = String(task.task_code || "").toLowerCase();
    let freq = null;
    for (const cat of tsdLibrary.categories) {
      const ctrl = (cat.controls || []).find(c => String(c.type || "").toLowerCase() === type);
      if (ctrl) { freq = ctrl.frequency; break; }
    }

    const now = dayjs.utc();
    const nextControl = addByFreq(now, freq);
    const closedAt = now.toISOString();

    await client.query(
      `UPDATE controls_tasks
       SET status=$1, last_control=$2, next_control=$3, closed_at=$2
       WHERE id=$4`,
      ["Done", closedAt, nextControl, id]
    );

    // Insertion du log
    await client.query(
      `INSERT INTO controls_records (task_id, recorded_at, checklist, observations, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, closedAt, JSON.stringify(checklist || []), JSON.stringify(observations || {}), comment || null]
    );

    res.json({ success: true, next_control: nextControl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Route /hierarchy/tree — arborescence Buildings → HV / Switchboards / Devices
// ---------------------------------------------------------------------------
router.get("/hierarchy/tree", async (req, res) => {
  try {
    const buildings = [];

    // --- 1. Buildings existants
    const { rows: bRows } = await pool.query("SELECT DISTINCT building_code AS code FROM switchboards WHERE building_code IS NOT NULL");
    for (const b of bRows) {
      const building = { label: b.code, switchboards: [], hv: [] };

      // --- 2. HV
      const { rows: hvRows } = await pool.query("SELECT * FROM high_voltage WHERE building_code=$1", [b.code]);
      for (const hv of hvRows) {
        const { rows: hvTasks } = await pool.query("SELECT * FROM controls_tasks WHERE entity_id=$1", [hv.id]);
        building.hv.push({ id: hv.id, label: hv.name, tasks: hvTasks });
      }

      // --- 3. Switchboards + Devices
      const { rows: swRows } = await pool.query("SELECT * FROM switchboards WHERE building_code=$1", [b.code]);
      for (const sw of swRows) {
        const { rows: swTasks } = await pool.query("SELECT * FROM controls_tasks WHERE entity_id=$1", [sw.id]);
        const swObj = { id: sw.id, label: sw.name, tasks: swTasks, devices: [] };

        const { rows: devRows } = await pool.query("SELECT * FROM devices WHERE switchboard_id=$1", [sw.id]);
        for (const d of devRows) {
          const { rows: devTasks } = await pool.query("SELECT * FROM controls_tasks WHERE entity_id=$1", [d.id]);
          swObj.devices.push({ id: d.id, label: d.name, tasks: devTasks });
        }
        building.switchboards.push(swObj);
      }

      buildings.push(building);
    }

    res.json(buildings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Route /bootstrap/auto-link — rattache les entités et crée les tâches manquantes
// ---------------------------------------------------------------------------
router.get("/bootstrap/auto-link", async (req, res) => {
  const client = await pool.connect();
  try {
    let createdCount = 0;
    for (const cat of tsdLibrary.categories) {
      if (!cat.db_table) continue;
      const { rows: entities } = await client.query(`SELECT id, name FROM ${cat.db_table}`);
      for (const ent of entities) {
        for (const ctrl of cat.controls || []) {
          const { rows: exist } = await client.query(
            `SELECT id FROM controls_tasks WHERE entity_id=$1 AND task_code=$2`,
            [ent.id, ctrl.type]
          );
          if (exist.length) continue;
          await client.query(
            `INSERT INTO controls_tasks (entity_id, task_name, task_code, status, next_control)
             VALUES ($1,$2,$3,$4,$5)`,
            [ent.id, ctrl.type, ctrl.type, "Planned", addByFreq(new Date(), ctrl.frequency)]
          );
          createdCount++;
        }
      }
    }
    res.json({ success: true, created: createdCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Fallback / default
// ---------------------------------------------------------------------------
router.get("/", (req, res) => {
  res.json({ status: "ok", tsd_categories: tsdLibrary.categories.length });
});

// ---------------------------------------------------------------------------
// Mount + Boot
// ---------------------------------------------------------------------------
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, async () => {
  console.log(`[controls] serveur démarré sur :${port} (BASE_PATH=${BASE_PATH})`);
});

export default app;
