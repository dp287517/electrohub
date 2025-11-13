// ============================================================================
// server_controls.js — Backend unifié TSD avec gestion plans
// ============================================================================

import express from "express";
import { Pool } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import multer from "multer";
import unzipper from "unzipper";
import path from "path";
import fs from "fs/promises";

dayjs.extend(utc);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
const router = express.Router();
app.use(express.json({ limit: "30mb" }));

// Upload multer
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// IMPORT TSD LIBRARY
// ============================================================================
let tsdLibrary;
try {
  const mod = await import("./tsd_library.js");
  tsdLibrary = mod.tsdLibrary || mod.default;
  console.log(`[Controls] TSD library loaded (${tsdLibrary.categories.length} categories)`);
} catch (e) {
  console.error("[Controls] Failed to load TSD library:", e);
  process.exit(1);
}

// ============================================================================
// HELPERS
// ============================================================================

function siteOf(req) {
  return req.header("X-Site") || req.query.site || "Default";
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
    const unit = frequency.unit === "months" ? "month" : frequency.unit === "years" ? "year" : "week";
    return base.add(frequency.interval, unit).format("YYYY-MM-DD");
  }
  
  return null;
}

// Génération date initiale 2026 avec offset aléatoire
function generateInitialDate(frequency) {
  const baseDate = dayjs("2026-01-01");
  const offsetDays = Math.floor(Math.random() * 365);
  return baseDate.add(offsetDays, "day").format("YYYY-MM-DD");
}

// Trouver le contrôle TSD par task_code
function findTSDControl(taskCode) {
  for (const cat of tsdLibrary.categories) {
    const ctrl = (cat.controls || []).find(c => 
      c.type.toLowerCase().replace(/\s+/g, "_") === taskCode.toLowerCase()
    );
    if (ctrl) return { category: cat, control: ctrl };
  }
  return null;
}

// ============================================================================
// ROUTE: GET /hierarchy/tree
// Retourne l'arborescence complète avec indicateur "positioned"
// ============================================================================
router.get("/hierarchy/tree", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const buildings = [];

    // Récupérer tous les buildings
    const { rows: buildingRows } = await client.query(`
      SELECT DISTINCT building_code AS code FROM (
        SELECT building_code FROM switchboards WHERE building_code IS NOT NULL AND site = $1
        UNION
        SELECT building_code FROM hv_equipments WHERE building_code IS NOT NULL AND site = $1
      ) q
      ORDER BY building_code
    `, [site]);

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
            AND ct.entity_type = 'hv_equipment'
          ) as positioned`,
          [hv.id]
        );
        const hvPositioned = hvPosCheck[0]?.positioned || false;

        // Tâches HV avec statut calculé
        const { rows: hvTasks } = await client.query(
          `SELECT ct.*, 
           EXISTS(
             SELECT 1 FROM controls_task_positions ctp 
             WHERE ctp.task_id = ct.id
           ) as positioned
           FROM controls_tasks ct
           WHERE ct.entity_id = $1 AND ct.entity_type = 'hv_equipment'`,
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
              AND ct.entity_type = 'hv_device'
            ) as positioned`,
            [d.id]
          );
          
          const { rows: devTasks } = await client.query(
            `SELECT ct.*,
             EXISTS(SELECT 1 FROM controls_task_positions ctp WHERE ctp.task_id = ct.id) as positioned
             FROM controls_tasks ct
             WHERE ct.entity_id = $1 AND ct.entity_type = 'hv_device'`,
            [d.id]
          );

          devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: dvPosCheck[0]?.positioned || false,
            entity_type: 'hv_device',
            tasks: devTasks.map(t => ({
              ...t,
              status: computeStatus(t.next_control)
            })),
          });
        }

        building.hv.push({
          id: hv.id,
          label: hv.name,
          positioned: hvPositioned,
          entity_type: 'hv_equipment',
          building_code: bRow.code,
          tasks: hvTasks.map(t => ({
            ...t,
            status: computeStatus(t.next_control)
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
           EXISTS(SELECT 1 FROM controls_task_positions ctp WHERE ctp.task_id = ct.id) as positioned
           FROM controls_tasks ct
           WHERE ct.entity_id = $1 AND ct.entity_type = 'switchboard'`,
          [sw.id]
        );

        const swObj = {
          id: sw.id,
          label: sw.name,
          positioned: swPosCheck[0]?.positioned || false,
          entity_type: 'switchboard',
          building_code: bRow.code,
          tasks: swTasks.map(t => ({
            ...t,
            status: computeStatus(t.next_control)
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
            `SELECT * FROM controls_tasks WHERE entity_id = $1 AND entity_type = 'device'`,
            [d.id]
          );

          swObj.devices.push({
            id: d.id,
            label: d.name || d.device_type,
            positioned: swObj.positioned, // Hérite de switchboard
            entity_type: 'device',
            tasks: devTasks.map(t => ({
              ...t,
              status: computeStatus(t.next_control),
              positioned: swObj.positioned
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
        notes: "Aucun schéma TSD trouvé" 
      });
    }
    
    const { category, control } = tsd;
    
    const schema = {
      category_key: category.key,
      checklist: (control.checklist || []).map((q, i) => ({ 
        key: `${category.key}_${i}`, 
        label: typeof q === 'string' ? q : q.label || q
      })),
      observations: (control.observations || []).map((o, i) => ({ 
        key: `${category.key}_obs_${i}`, 
        label: typeof o === 'string' ? o : o.label || o
      })),
      notes: control.notes || control.description || "",
      frequency: control.frequency,
    };
    
    res.json(schema);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ROUTE: PATCH /tasks/:id/close
// ============================================================================
router.patch("/tasks/:id/close", async (req, res) => {
  const { id } = req.params;
  const { checklist, observations, comment, files } = req.body;
  
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
    
    // Insérer dans l'historique
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
        task.site
      ]
    );
    
    // Mettre à jour la tâche
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
      next_control: nextControl 
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
      
      const { rows: tableCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [cat.db_table]
      );
      
      if (!tableCheck[0].exists) {
        console.warn(`[Controls] Table ${cat.db_table} not found, skipping...`);
        continue;
      }
      
      const { rows: entities } = await client.query(
        `SELECT id, name FROM ${cat.db_table} WHERE site = $1`,
        [site]
      );
      
      for (const ent of entities) {
        for (const ctrl of cat.controls || []) {
          const taskCode = ctrl.type.toLowerCase().replace(/\s+/g, "_");
          
          const { rows: existing } = await client.query(
            `SELECT id FROM controls_tasks 
             WHERE entity_id = $1 AND task_code = $2 AND entity_type = $3 AND site = $4`,
            [ent.id, taskCode, cat.db_table.replace(/_/g, ''), site]
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
              cat.db_table.replace(/_/g, ''),
              ctrl.type,
              taskCode,
              "Planned",
              initialDate,
              ctrl.frequency?.interval || null
            ]
          );
          
          createdCount++;
        }
      }
    }
    
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
// ============================================================================
router.get("/missing-equipment", async (req, res) => {
  const client = await pool.connect();
  try {
    const site = siteOf(req);
    const missing = [];
    const existing = [];
    
    for (const cat of tsdLibrary.categories) {
      const tableName = cat.db_table;
      
      const { rows: tableCheck } = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [tableName]
      );
      
      if (!tableCheck[0].exists) {
        missing.push({
          category: cat.label,
          db_table: tableName,
          count_in_tsd: (cat.controls || []).length,
        });
      } else {
        const { rows: countRows } = await client.query(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE site = $1`,
          [site]
        );
        
        existing.push({
          category: cat.label,
          db_table: tableName,
          count: parseInt(countRows[0].count),
        });
      }
    }
    
    res.json({ missing, existing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROUTES GESTION DES PLANS
// ============================================================================

router.post("/maps/uploadZip", upload.single("zip"), async (req, res) => {
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

      const { rows: existing } = await client.query(
        `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
        [logicalName, site]
      );

      if (existing.length) {
        await client.query(
          `UPDATE controls_plans SET content = $1, updated_at = NOW() WHERE id = $2`,
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
    
    res.json({ plans: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    res.status(500).json({ error: e.message });
  }
});

router.get("/maps/planFile", async (req, res) => {
  const { logical_name, id } = req.query;
  const site = siteOf(req);
  
  try {
    let query, params;
    
    if (id) {
      query = `SELECT content FROM controls_plans WHERE id = $1 AND site = $2`;
      params = [id, site];
    } else {
      query = `SELECT content FROM controls_plans WHERE logical_name = $1 AND site = $2`;
      params = [logical_name, site];
    }
    
    const { rows } = await pool.query(query, params);
    
    if (!rows.length) {
      return res.status(404).json({ error: "Plan not found" });
    }
    
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(rows[0].content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/maps/positions", async (req, res) => {
  const { logical_name, building, id, page_index = 0 } = req.query;
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
      if (!rows.length) return res.json({ items: [] });
      planId = rows[0].id;
    } else if (building) {
      const { rows } = await pool.query(
        `SELECT id FROM controls_plans WHERE display_name ILIKE $1 AND site = $2 LIMIT 1`,
        [`%${building}%`, site]
      );
      if (!rows.length) return res.json({ items: [] });
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
       WHERE ctp.plan_id = $1 AND ctp.page_index = $2`,
      [planId, page_index]
    );
    
    res.json({ 
      items: positions.map(p => ({
        task_id: p.task_id,
        entity_id: p.entity_id,
        entity_type: p.entity_type,
        task_name: p.task_name,
        x_frac: Number(p.x_frac),
        y_frac: Number(p.y_frac),
        status: computeStatus(p.next_control),
      }))
    });
  } catch (e) {
    console.error("[Controls] positions error:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/maps/setPosition", async (req, res) => {
  const { task_id, entity_id, entity_type, logical_name, building, page_index = 0, x_frac, y_frac } = req.body;
  const site = siteOf(req);
  
  const client = await pool.connect();
  try {
    // Récupérer le plan_id
    let planId;
    if (logical_name) {
      const { rows } = await client.query(
        `SELECT id FROM controls_plans WHERE logical_name = $1 AND site = $2`,
        [logical_name, site]
      );
      if (!rows.length) return res.status(404).json({ error: "Plan not found" });
      planId = rows[0].id;
    } else if (building) {
      const { rows } = await client.query(
        `SELECT id FROM controls_plans WHERE display_name ILIKE $1 AND site = $2 LIMIT 1`,
        [`%${building}%`, site]
      );
      if (!rows.length) return res.status(404).json({ error: "Plan not found" });
      planId = rows[0].id;
    } else {
      return res.status(400).json({ error: "Missing plan identifier" });
    }
    
    // Si entity_id fourni, marquer TOUTES les tâches de cet équipement
    let taskIds = [];
    if (entity_id && entity_type) {
      const { rows: taskRows } = await client.query(
        `SELECT id FROM controls_tasks WHERE entity_id = $1 AND entity_type = $2 AND site = $3`,
        [entity_id, entity_type, site]
      );
      taskIds = taskRows.map(r => r.id);
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

const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => {
  console.log(`[Controls] Server running on :${port} (BASE_PATH=${BASE_PATH})`);
});

export default app;
