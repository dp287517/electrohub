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

// --- OpenAI (IA photos / sécurité / infos équipements)
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
// IA — ANALYSE PHOTOS / INFOS ÉQUIPEMENTS / SÉCURITÉ
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
// ROUTE: GET /hierarchy/tree
// Retourne l'arborescence complète avec indicateur "positioned"
// ============================================================================
router.get("/hierarchy/tree", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
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
        const { rows: hvTasks } = await client.query(
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

        // Devices HV
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

          const { rows: devTasks } = await client.query(
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

          devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: dvPosCheck[0]?.positioned || false,
            entity_type: "hvdevice",
            tasks: devTasks.map((t) => ({
              ...t,
              status: computeStatus(t.next_control),
            })),
          });
        }

        building.hv.push({
          id: hv.id,
          label: hv.name,
          positioned: hvPositioned,
          entity_type: "hvequipment",
          building_code: bRow.code,
          tasks: hvTasks.map((t) => ({
            ...t,
            status: computeStatus(t.next_control),
          })),
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

        const { rows: swTasks } = await client.query(
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

        const swObj = {
          id: sw.id,
          label: sw.name,
          positioned: swPosCheck[0]?.positioned || false,
          entity_type: "switchboard",
          building_code: bRow.code,
          tasks: swTasks.map((t) => ({
            ...t,
            status: computeStatus(t.next_control),
          })),
          devices: [],
        };

        // Devices (héritent de la position du switchboard)
        const { rows: devRows } = await client.query(
          `SELECT * FROM devices WHERE switchboard_id = $1 AND site = $2`,
          [sw.id, site]
        );

        for (const d of devRows) {
          const { rows: devTasks } = await client.query(
            `SELECT * FROM controls_tasks 
             WHERE entity_id = $1 AND entity_type = 'device'`,
            [d.id]
          );

          swObj.devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: swObj.positioned,
            entity_type: "device",
            tasks: devTasks.map((t) => ({
              ...t,
              status: computeStatus(t.next_control),
              positioned: swObj.positioned,
            })),
          });
        }

        building.switchboards.push(swObj);
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
  const { checklist, observations, comment /*, files*/ } = req.body;

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
        site
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        now,
        JSON.stringify(checklist || []),
        comment || null,
        "Done",
        task.site,
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
// ROUTE: GET /bootstrap/auto-link
// Crée automatiquement les tâches pour tous les équipements
// ============================================================================
router.get("/bootstrap/auto-link", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    let createdCount = 0;

    for (const cat of tsdLibrary.categories) {
      if (!cat.db_table) continue;
      const tableName = cat.db_table;

      // Table existante ?
      const { rows: tableCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [tableName]
      );

      if (!tableCheck[0].exists) {
        console.warn(
          `[Controls] Table ${tableName} not found for category ${cat.key}, skipping...`
        );
        continue;
      }

      // Colonne 'site' ?
      const { rows: colCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = $1 AND column_name = 'site'
        )`,
        [tableName]
      );

      const hasSiteCol = colCheck[0].exists;

      const { rows: entities } = await client.query(
        hasSiteCol
          ? `SELECT id, name FROM ${tableName} WHERE site = $1`
          : `SELECT id, name FROM ${tableName}`,
        hasSiteCol ? [site] : []
      );

      const entityType = entityTypeFromCategory(cat);

      for (const ent of entities) {
        for (const ctrl of cat.controls || []) {
          const taskCode = ctrl.type.toLowerCase().replace(/\s+/g, "_");

          const { rows: existing } = await client.query(
            `SELECT id FROM controls_tasks 
             WHERE entity_id = $1 
               AND task_code = $2 
               AND entity_type = $3 
               AND site = $4`,
            [ent.id, taskCode, entityType, site]
          );

          if (existing.length) continue;

          const initialDate = generateInitialDate(ctrl.frequency);

          await client.query(
            `INSERT INTO controls_tasks (
              site,
              entity_id,
              entity_type,
              task_name,
              task_code,
              status,
              next_control,
              frequency_months
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              site,
              ent.id,
              entityType,
              ctrl.type,
              taskCode,
              "Planned",
              initialDate,
              ctrl.frequency?.interval || null,
            ]
          );

          createdCount++;
        }
      }
    }

    console.log(`[Controls] Auto-link completed, created=${createdCount}`);
    res.json({ success: true, created: createdCount });
  } catch (e) {
    console.error("[Controls] auto-link error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTE: GET /missing-equipment
// Logique améliorée : table absente OU 0 équipements = "non intégré"
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

      if (!hasTable) {
        missing.push({
          category: cat.label,
          db_table: tableName,
          reason: "table_absente",
          count_controls: (cat.controls || []).length,
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
          category: cat.label,
          db_table: tableName,
          reason: "aucun_equipement",
          count_controls: (cat.controls || []).length,
        });
      } else {
        existing.push({
          category: cat.label,
          db_table: tableName,
          count,
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
