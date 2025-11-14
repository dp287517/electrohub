// ============================================================================
// server_controls.js — Backend TSD + Plans + IA (électrique / sécurité)
// ============================================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import unzipper from "unzipper";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { fileURLToPath } from "url";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import pg from "pg";

dayjs.extend(utc);
dotenv.config();

// --- OpenAI (IA photos / sécurité / infos équipements / assistant tâches)
const { OpenAI } = await import("openai");

// ============================================================================
// CONSTANTES & INIT
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.CONTROLS_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
const router = express.Router();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

// ============================================================================
// IMPORT TSD LIBRARY
// ============================================================================
let tsdLibrary;
try {
  const mod = await import("./tsd_library.js");
  tsdLibrary = mod.tsdLibrary || mod.default;
  console.log(
    `[Controls] TSD library loaded (${tsdLibrary.categories.length} categories)`
  );
} catch (e) {
  console.error("[Controls] Failed to load TSD library:", e);
  process.exit(1);
}

// ============================================================================
// HELPERS GÉNÉRAUX
// ============================================================================

function siteOf(req) {
  return req.header("X-Site") || req.query.site || "Default";
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

function isNumericId(s) {
  return (
    (typeof s === "string" && /^\d+$/.test(s)) ||
    (typeof s === "number" && Number.isInteger(s))
  );
}

// Calcul du statut selon date d'échéance
function computeStatus(next_control) {
  if (!next_control) return "Planned";
  const now = dayjs();
  const next = dayjs(next_control);
  const diffDays = next.diff(now, "day");

  if (diffDays < 0) return "Overdue";
  if (diffDays <= 30) return "Pending";
  return "Planned";
}

// Ajout de fréquence à une date
function addFrequency(dateStr, frequency) {
  if (!frequency) return null;
  const base = dayjs(dateStr);

  if (frequency.interval && frequency.unit) {
    const unit =
      frequency.unit === "months"
        ? "month"
        : frequency.unit === "years"
        ? "year"
        : "week";
    return base.add(frequency.interval, unit).format("YYYY-MM-DD");
  }

  return null;
}

// Génération date initiale 2026 avec offset aléatoire
function generateInitialDate(_frequency) {
  const baseDate = dayjs("2026-01-01");
  const offsetDays = Math.floor(Math.random() * 365);
  return baseDate.add(offsetDays, "day").format("YYYY-MM-DD");
}

// Trouver le contrôle TSD par task_code
function findTSDControl(taskCode) {
  if (!taskCode) return null;
  const canon = String(taskCode).toLowerCase();
  for (const cat of tsdLibrary.categories) {
    for (const c of cat.controls || []) {
      const code = c.type.toLowerCase().replace(/\s+/g, "_");
      if (code === canon) {
        return { category: cat, control: c };
      }
    }
  }
  return null;
}

// Mapping propre db_table → entity_type (pour cohérence avec l'arborescence)
function entityTypeFromCategory(cat) {
  const t = cat.db_table;
  switch (t) {
    case "hv_equipments":
      return "hvequipment";
    case "hv_devices":
      return "hvdevice";
    case "switchboards":
      return "switchboard";
    case "devices":
      return "device";
    case "sites":
      return "site";
    default:
      return t.replace(/_/g, "");
  }
}

// Mapping inverse : entity_type -> table DB (pour IA sur les tâches)
function tableFromEntityType(entityType) {
  switch (entityType) {
    case "hvequipment":
      return "hv_equipments";
    case "hvdevice":
      return "hv_devices";
    case "switchboard":
      return "switchboards";
    case "device":
      return "devices";
    case "site":
      return "sites";
    default:
      return null;
  }
}

// ============================================================================
// MULTER / UPLOADS
// ============================================================================

// ZIP de plans (PDF) en mémoire
const uploadZip = multer({ storage: multer.memoryStorage() });

// Dossiers data pour IA (photos, etc.)
const DATA_DIR =
  process.env.CONTROLS_DATA_DIR ||
  path.resolve(__dirname, "./_data_controls");
const FILES_DIR = path.join(DATA_DIR, "files");
for (const d of [DATA_DIR, FILES_DIR]) {
  await fsp.mkdir(d, { recursive: true });
}

// Upload fichiers images pour IA (stockage disque)
const multerFiles = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`
      ),
  }),
  limits: { fileSize: 40 * 1024 * 1024 }, // 40 MB par fichier
});

// ============================================================================
// IA — CLIENT OPENAI
// ============================================================================

function openaiClient() {
  const key =
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY_CONTROLS ||
    process.env.OPENAI_API_KEY_ATEX ||
    process.env.OPENAI_API_KEY_DOORS;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// ============================================================================
// IA — ANALYSE PHOTOS / INFOS ÉQUIPEMENTS / SÉCURITÉ
// ============================================================================

/**
 * Analyse des photos d'équipements électriques / sûreté
 * Retourne un JSON structuré (nom, type, fabricant, ref, sécurité, etc.)
 */
async function controlsExtractFromFiles(client, files) {
  if (!client) throw new Error("OPENAI_API_KEY missing");
  if (!files?.length) throw new Error("no files");

  const images = await Promise.all(
    files.map(async (f) => ({
      name: f.originalname,
      mime: f.mimetype,
      data: (await fsp.readFile(f.path)).toString("base64"),
    }))
  );

  const sys = `Tu es un assistant d'inspection pour les installations électriques et de sécurité (HT, TGBT, transformateurs, UPS, éclairage de sécurité, etc.).
À partir de plusieurs photos d'équipements, tu dois extraire des informations utiles pour un outil de maintenance / contrôle (CMMS).

Renvoyer STRICTEMENT un JSON de la forme :
{
  "equipment_name": "nom lisible si visible, sinon chaîne vide",
  "equipment_type": "type ou famille (ex: HV switchgear, LV switchboard, UPS, Transformer, Motor, Lighting, etc.)",
  "manufacturer": "marque si visible",
  "reference": "référence constructeur si visible",
  "serial_number": "numéro de série éventuel",
  "location_hint": "indices de localisation visibles (bâtiment, zone, étiquette...)",
  "safety_notes": "texte court avec remarques sécurité (EPI, signalisation, étiquette danger, IP rating, etc.)",
  "keywords": ["mot-clé1", "mot-clé2", ...]
}

Contraintes :
- Si une info n'est pas visible, mets simplement une chaîne vide ou []. 
- NE RENVOIE AUCUN TEXTE EN DEHORS DU JSON.`;

  const messages = [
    { role: "system", content: sys },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Analyse ces photos et renvoie uniquement un JSON valide.",
        },
        ...images.map((im) => ({
          type: "image_url",
          image_url: {
            url: `data:${im.mime};base64,${im.data}`,
          },
        })),
      ],
    },
  ];

  const resp = await client.chat.completions.create({
    model:
      process.env.CONTROLS_OPENAI_MODEL ||
      process.env.ATEX_OPENAI_MODEL ||
      "gpt-4o-mini",
    messages,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  let data = {};
  try {
    data = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
  } catch {
    data = {};
  }

  return {
    equipment_name: String(data.equipment_name || ""),
    equipment_type: String(data.equipment_type || ""),
    manufacturer: String(data.manufacturer || ""),
    reference: String(data.reference || ""),
    serial_number: String(data.serial_number || ""),
    location_hint: String(data.location_hint || ""),
    safety_notes: String(data.safety_notes || ""),
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
  };
}

// Routes IA (mêmes principes que ATEX, mais pour Controls)
router.post(
  "/ai/analyzePhotoBatch",
  multerFiles.array("files"),
  async (req, res) => {
    try {
      const client = openaiClient();
      if (!client) {
        throw new Error("OPENAI_API_KEY missing for Controls AI");
      }
      const extracted = await controlsExtractFromFiles(
        client,
        req.files || []
      );

      // Nettoyage des fichiers temporaires
      await Promise.all(
        (req.files || []).map((f) => fsp.unlink(f.path).catch(() => {}))
      );

      res.json({ ok: true, extracted });
    } catch (e) {
      console.error("[Controls][AI] analyzePhotoBatch error:", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// Alias plus générique
router.post("/ai/extract", multerFiles.array("files"), async (req, res) => {
  try {
    const client = openaiClient();
    if (!client) {
      throw new Error("OPENAI_API_KEY missing for Controls AI");
    }
    const extracted = await controlsExtractFromFiles(client, req.files || []);

    await Promise.all(
      (req.files || []).map((f) => fsp.unlink(f.path).catch(() => {}))
    );

    res.json({ ok: true, extracted });
  } catch (e) {
    console.error("[Controls][AI] extract error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// IA — ANALYSE & ASSISTANT SUR UNE TÂCHE (pour Controls.jsx / TaskDetails)
// ============================================================================

// Construit un "contexte compact" pour l'IA à partir d'une tâche
async function buildTaskContext(taskId) {
  const { rows: taskRows } = await pool.query(
    `SELECT * FROM controls_tasks WHERE id = $1`,
    [taskId]
  );
  if (!taskRows.length) return null;
  const task = taskRows[0];

  const tsd = findTSDControl(task.task_code);

  const { rows: records } = await pool.query(
    `SELECT * FROM controls_records 
     WHERE task_id = $1 
     ORDER BY performed_at DESC 
     LIMIT 10`,
    [taskId]
  );

  let equipment = null;
  const table = tableFromEntityType(task.entity_type);
  if (table) {
    try {
      const { rows: eqRows } = await pool.query(
        `SELECT * FROM ${table} WHERE id = $1`,
        [task.entity_id]
      );
      equipment = eqRows[0] || null;
    } catch (e) {
      console.warn(
        `[Controls][AI] Failed to load equipment for entity_type=${task.entity_type}, table=${table}:`,
        e.message
      );
    }
  }

  return {
    task: {
      id: task.id,
      site: task.site,
      entity_id: task.entity_id,
      entity_type: task.entity_type,
      task_name: task.task_name,
      task_code: task.task_code,
      status: task.status,
      next_control: task.next_control,
      last_control: task.last_control,
      frequency_months: task.frequency_months,
    },
    tsd: tsd
      ? {
          category_key: tsd.category.key,
          category_label: tsd.category.label,
          control_type: tsd.control.type,
          frequency: tsd.control.frequency || null,
          notes: tsd.control.notes || "",
          checklist: tsd.control.checklist || [],
          observations: tsd.control.observations || [],
        }
      : null,
    equipment,
    records: records.map((r) => ({
      id: r.id,
      performed_at: r.performed_at,
      result_status: r.result_status,
      comments: r.comments,
    })),
  };
}

// Analyse automatique d'une tâche
router.post("/tasks/:id/analyze", async (req, res) => {
  const { id } = req.params;
  try {
    const client = openaiClient();
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY missing for Controls AI",
      });
    }

    const ctx = await buildTaskContext(id);
    if (!ctx) {
      return res.status(404).json({ ok: false, error: "Task not found" });
    }

    const sys = `Tu es un expert en maintenance, inspection et essais d'installations électriques (HT, TGBT, protections, batteries, UPS, éclairage de sécurité...).
Tu aides un responsable maintenance à analyser un contrôle périodique issu d'une TSD (G2.1). 
Ton objectif : fournir un avis opérationnel exploitable immédiatement pour la sûreté / conformité du site.`;

    const user = `Contexte JSON (task_context) :
${JSON.stringify(ctx, null, 2)}

Produit une ANALYSE STRUCTURÉE en français, avec les sections numérotées :

1. Synthèse rapide (2-3 phrases maximum)
2. État du contrôle (à jour / en retard / bientôt dû) + dates clés
3. Principaux risques techniques & sécurité pour ce type d'équipement
4. Recommandations concrètes (actions à lancer, priorités)
5. Suggestions de checks supplémentaires (si pertinents)
6. Commentaires sur la fréquence actuelle (ok / à renforcer / à questionner)

Tu t'adresses à un technicien / responsable maintenance.
Pas de JSON, uniquement du texte clair et lisible.`;

    const resp = await client.chat.completions.create({
      model:
        process.env.CONTROLS_OPENAI_MODEL ||
        process.env.ATEX_OPENAI_MODEL ||
        "gpt-4o-mini",
      temperature: 0.25,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ ok: true, answer });
  } catch (e) {
    console.error("[Controls][AI] tasks/:id/analyze error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Assistant IA interactif sur une tâche
router.post("/tasks/:id/assistant", async (req, res) => {
  const { id } = req.params;
  const { question = "" } = req.body || {};

  try {
    const client = openaiClient();
    if (!client) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY missing for Controls AI",
      });
    }

    const ctx = await buildTaskContext(id);
    if (!ctx) {
      return res.status(404).json({ ok: false, error: "Task not found" });
    }

    const sys = `Tu es un assistant IA spécialisé en maintenance électrique industrielle, conformité TSD et sûreté (HT, TGBT, protections, EPI, etc.).
Tu réponds de manière précise, actionnable et orientée terrain.`;

    const user = `Voici le contexte de la tâche (JSON compact) :
${JSON.stringify(ctx, null, 2)}

Question de l'utilisateur :
"${question}"

Consignes :
- Réponds en français.
- Donne une réponse structurée, opérationnelle (utilisable directement sur le terrain ou pour un plan d'actions).
- Si une information manque dans le contexte, dis-le simplement et propose des hypothèses réalistes.`;

    const resp = await client.chat.completions.create({
      model:
        process.env.CONTROLS_OPENAI_MODEL ||
        process.env.ATEX_OPENAI_MODEL ||
        "gpt-4o-mini",
      temperature: 0.35,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ ok: true, answer });
  } catch (e) {
    console.error("[Controls][AI] tasks/:id/assistant error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// ROUTE: GET /hierarchy/tree
// Retourne l'arborescence complète avec indicateur "positioned"
// + héritage de position pour les cellules HT comme pour les devices TGBT
// + filtre status=open|done|all (utilisé par Controls.jsx)
// ============================================================================
router.get("/hierarchy/tree", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const statusFilter = String(req.query.status || "open").toLowerCase();

    const filterTasks = (tasks) => {
      if (!Array.isArray(tasks)) return [];
      return tasks
        .map((t) => ({
          ...t,
          status: computeStatus(t.next_control),
        }))
        .filter((t) => {
          if (statusFilter === "all") return true;
          if (statusFilter === "done") {
            // Pour l'instant "terminées" = celles avec last_control non nul
            return !!t.last_control;
          }
          // "open" = contrôles à venir / en retard
          return ["Planned", "Pending", "Overdue"].includes(t.status);
        });
    };

    const buildings = [];

    // Récupérer tous les buildings pertinents
    const { rows: buildingRows } = await client.query(
      `
      SELECT DISTINCT building_code AS code FROM (
        SELECT building_code FROM switchboards WHERE building_code IS NOT NULL AND site = $1
        UNION
        SELECT building_code FROM hv_equipments WHERE building_code IS NOT NULL AND site = $1
      ) q
      ORDER BY building_code
    `,
      [site]
    );

    for (const bRow of buildingRows) {
      const building = { label: bRow.code, hv: [], switchboards: [] };

      // ========== HIGH VOLTAGE ==========
      const { rows: hvEquips } = await client.query(
        `SELECT * FROM hv_equipments WHERE building_code = $1 AND site = $2`,
        [bRow.code, site]
      );

      for (const hv of hvEquips) {
        // Vérifier si HV est positionné
        const { rows: hvPosCheck } = await client.query(
          `SELECT EXISTS(
            SELECT 1 FROM controls_task_positions ctp
            JOIN controls_tasks ct ON ctp.task_id = ct.id
            WHERE ct.entity_id = $1 
              AND ct.entity_type = 'hvequipment'
          ) as positioned`,
          [hv.id]
        );
        const hvPositioned = hvPosCheck[0]?.positioned || false;

        // Tâches HV
        const { rows: hvTasksRaw } = await client.query(
          `SELECT ct.*,
             EXISTS(
               SELECT 1 FROM controls_task_positions ctp
               WHERE ctp.task_id = ct.id
             ) as positioned
           FROM controls_tasks ct
           WHERE ct.entity_id = $1 
             AND ct.entity_type = 'hvequipment'`,
          [hv.id]
        );
        const hvTasks = filterTasks(hvTasksRaw);

        // Devices HV (cellules, etc.)
        const { rows: hvDevices } = await client.query(
          `SELECT * FROM hv_devices WHERE hv_equipment_id = $1 AND site = $2`,
          [hv.id, site]
        );

        const devices = [];
        for (const d of hvDevices) {
          const { rows: dvPosCheck } = await client.query(
            `SELECT EXISTS(
              SELECT 1 FROM controls_task_positions ctp
              JOIN controls_tasks ct ON ctp.task_id = ct.id
              WHERE ct.entity_id = $1
                AND ct.entity_type = 'hvdevice'
            ) as positioned`,
            [d.id]
          );

          const { rows: devTasksRaw } = await client.query(
            `SELECT ct.*,
               EXISTS(
                 SELECT 1 FROM controls_task_positions ctp
                 WHERE ctp.task_id = ct.id
               ) as positioned
             FROM controls_tasks ct
             WHERE ct.entity_id = $1 
               AND ct.entity_type = 'hvdevice'`,
            [d.id]
          );
          const devTasks = filterTasks(devTasksRaw);

          // 👉 NOTE IMPORTANTE :
          // - positioned : true si la cellule est explicitement positionnée
          //   OU si l'équipement HV parent est positionné.
          //   => permet d'afficher "(hérite position)" côté front.
          const devicePositioned = (dvPosCheck[0]?.positioned || false) || hvPositioned;

          devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: devicePositioned,
            entity_type: "hvdevice",
            tasks: devTasks,
          });
        }

        building.hv.push({
          id: hv.id,
          label: hv.name,
          positioned: hvPositioned,
          entity_type: "hvequipment",
          building_code: bRow.code,
          tasks: hvTasks,
          devices,
        });
      }

      // ========== SWITCHBOARDS ==========
      const { rows: swRows } = await client.query(
        `SELECT * FROM switchboards WHERE building_code = $1 AND site = $2`,
        [bRow.code, site]
      );

      for (const sw of swRows) {
        // Vérifier si Switchboard est positionné
        const { rows: swPosCheck } = await client.query(
          `SELECT EXISTS(
            SELECT 1 FROM controls_task_positions ctp
            JOIN controls_tasks ct ON ctp.task_id = ct.id
            WHERE ct.entity_id = $1
              AND ct.entity_type = 'switchboard'
          ) as positioned`,
          [sw.id]
        );

        const { rows: swTasksRaw } = await client.query(
          `SELECT ct.*,
             EXISTS(
               SELECT 1 FROM controls_task_positions ctp
               WHERE ctp.task_id = ct.id
             ) as positioned
           FROM controls_tasks ct
           WHERE ct.entity_id = $1 
             AND ct.entity_type = 'switchboard'`,
          [sw.id]
        );
        const swTasks = filterTasks(swTasksRaw);

        const swPositioned = swPosCheck[0]?.positioned || false;

        const swObj = {
          id: sw.id,
          label: sw.name,
          positioned: swPositioned,
          entity_type: "switchboard",
          building_code: bRow.code,
          tasks: swTasks,
          devices: [],
        };

        // Devices (héritent de la position du switchboard)
        const { rows: devRows } = await client.query(
          `SELECT * FROM devices WHERE switchboard_id = $1 AND site = $2`,
          [sw.id, site]
        );

        for (const d of devRows) {
          const { rows: devTasksRaw } = await client.query(
            `SELECT * FROM controls_tasks 
             WHERE entity_id = $1 AND entity_type = 'device'`,
            [d.id]
          );
          const devTasks = filterTasks(devTasksRaw).map((t) => ({
            ...t,
            positioned: swPositioned,
          }));

          swObj.devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: swPositioned,
            entity_type: "device",
            tasks: devTasks,
          });
        }

        // On garde le switchboard même si pour l’instant il n’a que des tasks à venir filtrées
        if (swObj.tasks.length || swObj.devices.length) {
          building.switchboards.push(swObj);
        }
      }

      // Ne garder que les bâtiments qui ont du contenu
      if (building.hv.length > 0 || building.switchboards.length > 0) {
        buildings.push(building);
      }
    }

    res.json({ buildings });
  } catch (e) {
    console.error("[Controls] hierarchy/tree error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: GET /tasks/:id/schema
// ============================================================================
router.get("/tasks/:id/schema", async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM controls_tasks WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Task not found" });
    }

    const task = rows[0];
    const tsd = findTSDControl(task.task_code);

    if (!tsd) {
      return res.json({
        checklist: [],
        observations: [],
        notes: "Aucun schéma TSD trouvé",
      });
    }

    const { category, control } = tsd;

    const schema = {
      category_key: category.key,
      checklist: (control.checklist || []).map((q, i) => ({
        key: `${category.key}_${i}`,
        label: typeof q === "string" ? q : q.label || q,
      })),
      observations: (control.observations || []).map((o, i) => ({
        key: `${category.key}_obs_${i}`,
        label: typeof o === "string" ? o : o.label || o,
      })),
      notes: control.notes || control.description || "",
      frequency: control.frequency,
    };

    res.json(schema);
  } catch (e) {
    console.error("[Controls] tasks/:id/schema error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ROUTE: PATCH /tasks/:id/close
// ============================================================================
router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;

  // Harmonisation du payload (front envoie items/obs)
  const body = req.body || {};
  const checklist = body.checklist || body.items || [];
  const observations = body.observations || body.obs || {};
  const comment = body.comment ?? body.comments ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT * FROM controls_tasks WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Task not found" });
    }

    const task = rows[0];
    const tsd = findTSDControl(task.task_code);
    const frequency = tsd?.control?.frequency;

    const now = dayjs().format("YYYY-MM-DD");
    const nextControl = frequency ? addFrequency(now, frequency) : null;

    await client.query(
      `INSERT INTO controls_records (
        task_id,
        performed_at,
        checklist_result,
        comments,
        result_status,
        site,
        observations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        now,
        JSON.stringify(checklist || []),
        comment || null,
        "Done",
        task.site,
        JSON.stringify(observations || {}),
      ]
    );

    await client.query(
      `UPDATE controls_tasks
       SET last_control = $1,
           next_control = $2,
           status = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [now, nextControl, "Planned", id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      next_control: nextControl,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[Controls] close task error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: POST /tasks/:id/analyze
// Analyse IA d'une tâche de contrôle (résumé, risques, priorités...)
// ============================================================================

router.post("/tasks/:id/analyze", async (req, res) => {
  const { id } = req.params;
  const db = await pool.connect();
  try {
    const { rows } = await db.query(
      `SELECT * FROM controls_tasks WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Task not found" });
    }
    const task = rows[0];

    // Récupérer l'équipement lié
    let equipment = null;
    if (task.entity_type === "hvequipment") {
      equipment = (
        await db.query(
          `SELECT * FROM hv_equipments WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    } else if (task.entity_type === "hvdevice") {
      equipment = (
        await db.query(
          `SELECT * FROM hv_devices WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    } else if (task.entity_type === "switchboard") {
      equipment = (
        await db.query(
          `SELECT * FROM switchboards WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    } else if (task.entity_type === "device") {
      equipment = (
        await db.query(
          `SELECT * FROM devices WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    }

    // TSD associé
    const tsd = findTSDControl(task.task_code);

    // Derniers enregistrements de contrôle
    const { rows: records } = await db.query(
      `SELECT * FROM controls_records 
       WHERE task_id = $1 
       ORDER BY performed_at DESC 
       LIMIT 5`,
      [id]
    );

    const client = openaiClient();
    if (!client) {
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY missing for Controls" });
    }

    const sys = `
Tu es un assistant expert en maintenance et sécurité des installations électriques (HTA/HTB, TGBT, tableaux, transformateurs, etc.).
Tu aides à analyser une tâche de contrôle issue d'une librairie TSD (Testing & Inspection).

Objectif :
- Résumer la situation
- Identifier les risques principaux (techniques et sécurité)
- Suggérer des actions prioritaires
- Donner une vision synthétique compréhensible par un responsable maintenance/énergie

Réponds en français, formaté en sections claires.
`;

    const ctx = {
      task: {
        id: task.id,
        name: task.task_name,
        code: task.task_code,
        status: task.status,
        next_control: task.next_control,
        last_control: task.last_control,
      },
      equipment: equipment
        ? {
            id: equipment.id,
            name: equipment.name || equipment.device_type || equipment.switchboard_name,
            building_code: equipment.building_code || equipment.building || null,
          }
        : null,
      tsd_control: tsd
        ? {
            category_key: tsd.category.key,
            category_label: tsd.category.label,
            type: tsd.control.type,
            description: tsd.control.description || "",
            frequency: tsd.control.frequency || null,
          }
        : null,
      recent_records: records.map((r) => ({
        performed_at: r.performed_at,
        result_status: r.result_status,
        comments: r.comments,
      })),
    };

    const userPrompt = `
Voici le contexte JSON de la tâche de contrôle :

\`\`\`json
${JSON.stringify(ctx, null, 2)}
\`\`\`

Analyse cette tâche en respectant le rôle défini.
`;

    const resp = await client.chat.completions.create({
      model:
        process.env.CONTROLS_OPENAI_MODEL ||
        process.env.ATEX_OPENAI_MODEL ||
        "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ ok: true, answer });
  } catch (e) {
    console.error("[Controls] /tasks/:id/analyze error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    db.release();
  }
});


// ============================================================================
// ROUTE: POST /tasks/:id/assistant
// Assistant IA Q&A sur une tâche de contrôle
// ============================================================================

router.post("/tasks/:id/assistant", async (req, res) => {
  const { id } = req.params;
  const { question = "" } = req.body || {};
  const db = await pool.connect();
  try {
    const { rows } = await db.query(
      `SELECT * FROM controls_tasks WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Task not found" });
    }
    const task = rows[0];

    let equipment = null;
    if (task.entity_type === "hvequipment") {
      equipment = (
        await db.query(
          `SELECT * FROM hv_equipments WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    } else if (task.entity_type === "hvdevice") {
      equipment = (
        await db.query(
          `SELECT * FROM hv_devices WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    } else if (task.entity_type === "switchboard") {
      equipment = (
        await db.query(
          `SELECT * FROM switchboards WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    } else if (task.entity_type === "device") {
      equipment = (
        await db.query(
          `SELECT * FROM devices WHERE id = $1`,
          [task.entity_id]
        )
      ).rows[0];
    }

    const tsd = findTSDControl(task.task_code);

    const { rows: records } = await db.query(
      `SELECT * FROM controls_records 
       WHERE task_id = $1 
       ORDER BY performed_at DESC 
       LIMIT 5`,
      [id]
    );

    const client = openaiClient();
    if (!client) {
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY missing for Controls" });
    }

    const sys = `
Tu es un assistant IA spécialisé en contrôle d'installations électriques.
Tu réponds aux questions de l'utilisateur sur UNE tâche de contrôle précise, en t'appuyant sur le contexte fourni.
Tes réponses doivent être:
- précises
- orientées sécurité et maintenance
- en français
`;

    const ctx = {
      task: {
        id: task.id,
        name: task.task_name,
        code: task.task_code,
        status: task.status,
        next_control: task.next_control,
        last_control: task.last_control,
      },
      equipment: equipment
        ? {
            id: equipment.id,
            name: equipment.name || equipment.device_type || equipment.switchboard_name,
            building_code: equipment.building_code || equipment.building || null,
          }
        : null,
      tsd_control: tsd
        ? {
            category_key: tsd.category.key,
            category_label: tsd.category.label,
            type: tsd.control.type,
            description: tsd.control.description || "",
            frequency: tsd.control.frequency || null,
          }
        : null,
      recent_records: records.map((r) => ({
        performed_at: r.performed_at,
        result_status: r.result_status,
        comments: r.comments,
      })),
    };

    const userPrompt = `
Contexte de la tâche (JSON) :

\`\`\`json
${JSON.stringify(ctx, null, 2)}
\`\`\`

Question de l'utilisateur :
"${question}"
`;

    const resp = await client.chat.completions.create({
      model:
        process.env.CONTROLS_OPENAI_MODEL ||
        process.env.ATEX_OPENAI_MODEL ||
        "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.25,
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "";
    res.json({ ok: true, answer });
  } catch (e) {
    console.error("[Controls] /tasks/:id/assistant error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    db.release();
  }
});

// ============================================================================
// ROUTE: GET /bootstrap/auto-link
// Bootstrap / resync complet TSD → controls_tasks pour un site
// - Efface toutes les tâches de ce site dans controls_tasks
// - Recrée toutes les tâches à partir de tsdLibrary + tables HV/TGBT/devices
// ============================================================================
router.get("/bootstrap/auto-link", async (req, res) => {
  const site = siteOf(req);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1) On purge TOUTES les tâches de ce site (simple et clair)
    await client.query(
      `DELETE FROM controls_tasks WHERE site = $1`,
      [site]
    );

    let created = 0;

    // 2) Pour chaque catégorie TSD, on regarde si la table existe et contient des équipements pour ce site
    for (const cat of tsdLibrary.categories || []) {
      const tableName = cat.db_table;
      if (!tableName) continue;

      const controls = cat.controls || [];
      if (!controls.length) continue;

      // On récupère les équipements pour ce site
      let entities = [];
      try {
        const { rows } = await client.query(
          `SELECT id, name, device_type, switchboard_name, building_code 
           FROM ${tableName}
           WHERE site = $1`,
          [site]
        );
        entities = rows;
      } catch (e) {
        // Si la table n'existe pas vraiment dans ta base, on ignore cette catégorie
        console.warn(`[Controls][auto-link] Table manquante ou invalide: ${tableName}`, e.message);
        continue;
      }

      if (!entities.length) continue;

      const entityType = entityTypeFromCategory(cat);

      for (const ent of entities) {
        const label =
          ent.name ||
          ent.device_type ||
          ent.switchboard_name ||
          `${tableName} #${ent.id}`;

        for (const ctrl of controls) {
          const taskCode = ctrl.type.toLowerCase().replace(/\s+/g, "_");

          // Date initiale pseudo-aléatoire en 2026 + prochaine échéance
          const firstDate = generateInitialDate(ctrl.frequency || null);
          const nextDate = addFrequency(firstDate, ctrl.frequency || null);

          // On convertit la fréquence en mois si possible (pour info / stats)
          let freqMonths = null;
          if (ctrl.frequency?.interval && ctrl.frequency?.unit) {
            const { interval, unit } = ctrl.frequency;
            if (unit === "months") freqMonths = interval;
            else if (unit === "years") freqMonths = interval * 12;
            else if (unit === "weeks") freqMonths = Math.round((interval * 7) / 30);
          }

          await client.query(
            `INSERT INTO controls_tasks
               (site, entity_id, entity_type, task_name, task_code,
                status, first_control, next_control, frequency_months)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              site,
              ent.id,
              entityType,
              `${cat.label} – ${ctrl.type}`, // nom plus explicite
              taskCode,
              "Planned",
              firstDate,
              nextDate,
              freqMonths,
            ]
          );

          created++;
        }
      }
    }

    await client.query("COMMIT");

    const msg = `Synchronisation OK – ${created} tâches créées pour le site "${site}"`;
    console.log("[Controls][auto-link]", msg);
    res.json({ ok: true, created, message: msg });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[Controls][auto-link] ERROR:", e);
    res.status(500).json({
      ok: false,
      error: e.message || "Erreur interne auto-link",
    });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: GET /missing-equipment
// Logique améliorée : table absente OU 0 équipements = "non intégré"
// + champs compatibles avec Controls.jsx (count_in_tsd)
// ============================================================================
router.get("/missing-equipment", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const missing = [];
    const existing = [];

    for (const cat of tsdLibrary.categories) {
      const tableName = cat.db_table;
      if (!tableName) continue;

      // Table présente ?
      const { rows: tableCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [tableName]
      );

      const hasTable = tableCheck[0].exists;
      const countControls = (cat.controls || []).length;

      if (!hasTable) {
        missing.push({
          category_key: cat.key,
          category: cat.label,
          db_table: tableName,
          reason: "table_absente",
          count_controls: countControls,
          count_in_tsd: countControls,
        });
        continue;
      }

      // Colonne site ?
      const { rows: colCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = $1 AND column_name = 'site'
        )`,
        [tableName]
      );
      const hasSiteCol = colCheck[0].exists;

      const { rows: countRows } = await client.query(
        hasSiteCol
          ? `SELECT COUNT(*) as count FROM ${tableName} WHERE site = $1`
          : `SELECT COUNT(*) as count FROM ${tableName}`,
        hasSiteCol ? [site] : []
      );

      const count = parseInt(countRows[0].count, 10) || 0;

      if (count === 0) {
        missing.push({
          category_key: cat.key,
          category: cat.label,
          db_table: tableName,
          reason: "aucun_equipement",
          count_controls: countControls,
          count_in_tsd: countControls,
        });
      } else {
        existing.push({
          category_key: cat.key,
          category: cat.label,
          db_table: tableName,
          count,
          count_controls: countControls,
          count_in_tsd: countControls,
        });
      }
    }

    res.json({ missing, existing });
  } catch (e) {
    console.error("[Controls] missing-equipment error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: GET /tsd  — expose la tsd_library brute (catalogue)
// ============================================================================
router.get("/tsd", async (_req, res) => {
  try {
    res.json(tsdLibrary);
  } catch (e) {
    console.error("[Controls] /tsd error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ROUTES GESTION DES PLANS (alignées avec ATEX, mais pour Controls)
// ============================================================================

// Upload ZIP de plans (PDF) vers table controls_plans
router.post("/maps/uploadZip", uploadZip.single("zip"), async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const zipBuffer = req.file?.buffer;

    if (!zipBuffer) {
      return res.status(400).json({ error: "No ZIP file" });
    }

    const directory = await unzipper.Open.buffer(zipBuffer);
    let uploadedCount = 0;

    for (const file of directory.files) {
      if (file.type === "Directory") continue;
      if (!file.path.toLowerCase().endsWith(".pdf")) continue;

      const fileName = path.basename(file.path);
      const logicalName = fileName.replace(/\.pdf$/i, "");
      const content = await file.buffer();

      // Un plan = logical_name + site
      const { rows: existing } = await client.query(
        `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
        [logicalName, site]
      );

      if (existing.length) {
        await client.query(
          `UPDATE controls_plans 
           SET content = $1, updated_at = NOW()
           WHERE id = $2`,
          [content, existing[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO controls_plans (site, logical_name, display_name, content, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [site, logicalName, logicalName, content]
        );
      }

      uploadedCount++;
    }

    res.json({ success: true, uploaded: uploadedCount });
  } catch (e) {
    console.error("[Controls] uploadZip error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Liste des plans
router.get("/maps/listPlans", async (req, res) => {
  try {
    const site = siteOf(req);

    const { rows } = await pool.query(
      `SELECT id, logical_name, display_name, created_at 
       FROM controls_plans 
       WHERE site = $1 
       ORDER BY display_name`,
      [site]
    );

    // Compat : plans + items
    res.json({ plans: rows, items: rows });
  } catch (e) {
    console.error("[Controls] listPlans error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Renommer un plan
router.put("/maps/renamePlan", async (req, res) => {
  const { logical_name, display_name } = req.body;
  const site = siteOf(req);

  try {
    await pool.query(
      `UPDATE controls_plans 
       SET display_name = $1 
       WHERE logical_name = $2 AND site = $3`,
      [display_name, logical_name, site]
    );

    res.json({ success: true });
  } catch (e) {
    console.error("[Controls] renamePlan error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Récupération d'un PDF de plan
router.get("/maps/planFile", async (req, res) => {
  const { logical_name, id } = req.query;
  const site = siteOf(req);

  try {
    let query, params;

    if (id) {
      // On accepte UUID ou numérique, on laisse Postgres caster
      query = `SELECT content FROM controls_plans WHERE id = $1 AND site = $2`;
      params = [id, site];
    } else if (logical_name) {
      query = `SELECT content FROM controls_plans WHERE logical_name = $1 AND site = $2`;
      params = [logical_name, site];
    } else {
      return res.status(400).json({ error: "logical_name or id required" });
    }

    const { rows } = await pool.query(query, params);

    if (!rows.length) {
      console.log(
        `[Controls] Plan not found: id=${id}, logical_name=${logical_name}, site=${site}`
      );
      return res.status(404).json({ error: "Plan not found" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(rows[0].content);
  } catch (e) {
    console.error("[Controls] planFile error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Positions des contrôles sur plan
router.get("/maps/positions", async (req, res) => {
  let { logical_name, building, id, page_index = 0 } = req.query;
  const site = siteOf(req);

  try {
    let planId;

    if (id) {
      planId = id;
    } else if (logical_name) {
      const { rows } = await pool.query(
        `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
        [logical_name, site]
      );
      if (!rows.length) {
        console.log(
          `[Controls] Plan not found for positions: logical_name=${logical_name}`
        );
        return res.json({ items: [] });
      }
      planId = rows[0].id;
    } else if (building) {
      const { rows } = await pool.query(
        `SELECT id FROM controls_plans 
         WHERE display_name ILIKE $1 AND site = $2 
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${building}%`, site]
      );
      if (!rows.length) {
        console.log(
          `[Controls] No plan found for building in positions: ${building}`
        );
        return res.json({ items: [] });
      }
      planId = rows[0].id;
    } else {
      return res.json({ items: [] });
    }

    const { rows: positions } = await pool.query(
      `SELECT 
         ctp.task_id,
         ctp.x_frac,
         ctp.y_frac,
         ct.task_name,
         ct.status,
         ct.next_control,
         ct.entity_id,
         ct.entity_type
       FROM controls_task_positions ctp
       JOIN controls_tasks ct ON ctp.task_id = ct.id
       WHERE ctp.plan_id = $1 
         AND ctp.page_index = $2`,
      [planId, page_index]
    );

    res.json({
      items: positions.map((p) => ({
        task_id: p.task_id,
        entity_id: p.entity_id,
        entity_type: p.entity_type,
        task_name: p.task_name,
        x_frac: Number(p.x_frac),
        y_frac: Number(p.y_frac),
        status: computeStatus(p.next_control),
      })),
    });
  } catch (e) {
    console.error("[Controls] positions error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Définir / mettre à jour la position d'une tâche (ou d'un équipement complet)
router.post("/maps/setPosition", async (req, res) => {
  const {
    task_id,
    entity_id,
    entity_type,
    logical_name,
    building,
    page_index = 0,
    x_frac,
    y_frac,
  } = req.body;
  const site = siteOf(req);

  const client = await pool.connect();
  try {
    let planId;

    if (logical_name) {
      const { rows } = await client.query(
        `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
        [logical_name, site]
      );
      if (!rows.length)
        return res.status(404).json({ error: "Plan not found" });
      planId = rows[0].id;
    } else if (building) {
      const { rows } = await client.query(
        `SELECT id FROM controls_plans 
         WHERE display_name ILIKE $1 AND site = $2 
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${building}%`, site]
      );
      if (!rows.length)
        return res.status(404).json({ error: "Plan not found" });
      planId = rows[0].id;
    } else {
      return res.status(400).json({ error: "Missing plan identifier" });
    }

    let taskIds = [];

    if (entity_id && entity_type) {
      const { rows: taskRows } = await client.query(
        `SELECT id FROM controls_tasks 
         WHERE entity_id = $1 AND entity_type = $2 AND site = $3`,
        [entity_id, entity_type, site]
      );
      taskIds = taskRows.map((r) => r.id);
    } else if (task_id) {
      taskIds = [task_id];
    }

    for (const tid of taskIds) {
      const { rows: existing } = await client.query(
        `SELECT id FROM controls_task_positions 
         WHERE task_id = $1 AND plan_id = $2 AND page_index = $3`,
        [tid, planId, page_index]
      );

      if (existing.length) {
        await client.query(
          `UPDATE controls_task_positions 
           SET x_frac = $1, y_frac = $2, updated_at = NOW()
           WHERE id = $3`,
          [x_frac, y_frac, existing[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO controls_task_positions 
           (task_id, plan_id, page_index, x_frac, y_frac, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [tid, planId, page_index, x_frac, y_frac]
        );
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[Controls] setPosition error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// MOUNT & BOOT
// ============================================================================
const BASE_PATH = process.env.CONTROLS_BASE_PATH || "/api/controls";
app.use(BASE_PATH, router);

const PORT = Number(process.env.CONTROLS_PORT || 3011);
const HOST = process.env.CONTROLS_HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(
    `[Controls] Server running on ${HOST}:${PORT} (BASE_PATH=${BASE_PATH})`
  );
});

export default app;
