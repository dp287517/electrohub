// server_dcf.js — Assistant DCF SAP v9.1.0 - CORRECTIONS MAJEURES
// =============================================================================
// CORRECTIONS v9.1:
// - Fix mapping colonnes DCF (VORNR → AG, ARBPL → T, etc.)
// - Réutilisation correcte des données Vision extraites
// - Calcul automatique N° opération basé sur opérations existantes
// - Meilleure détection Work Center et Type de travail
// =============================================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import pg from "pg";
import OpenAI from "openai";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";

dotenv.config();

// =============================================================================
// 0. CONFIGURATION
// =============================================================================

const HOST = process.env.DCF_HOST || "0.0.0.0";
const PORT = Number(process.env.DCF_PORT || 3030);

const DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) console.error("❌ NEON_DATABASE_URL / DATABASE_URL manquante");

const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ANSWER_MODEL = process.env.DCF_ANSWER_MODEL || "gpt-4o-mini";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o-mini";

// Paths
const DROPDOWN_CSV_PATH = process.env.DCF_DROPDOWN_CSV_PATH || path.join(process.cwd(), "Listes_deroulantes__data_validation_.csv");
const TASKLIST_REF_PATH = process.env.DCF_TASKLIST_REF_PATH || path.join(process.cwd(), "Suivi_Task_List.xlsx");

// Limites
const MAX_FILES_LIBRARY = 50;

// =============================================================================
// 1. EXPRESS APP SETUP
// =============================================================================

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://api.openai.com"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "30mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// =============================================================================
// 2. MAPPING COLONNES DCF PAR TYPE (CORRIGÉ)
// =============================================================================

const DCF_COLUMNS = {
  // -------------------------------------------------------------------------
  // DCF TASK LIST - COLONNES RÉELLES du fichier Excel
  // -------------------------------------------------------------------------
  TASK_LIST: {
    // Créer une nouvelle opération
    CREATE_OPERATION: {
      action: "Create",
      description: "Ajouter une nouvelle opération sur un plan existant",
      columns: {
        I: { code: "ACTION", value: "Create", label: "Action SAP", mandatory: true, editable: false },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true, editable: true },
        P: { code: "PLNAL", label: "Counter (1, 2, 3...)", mandatory: true, editable: true },
        Q: { code: "KTEXT", label: "Nom du plan de maintenance", mandatory: false, editable: true },
        T: { code: "ARBPL", label: "Work Center / Groupe", mandatory: true, editable: true },
        X: { code: "SYSTC", label: "Intrusive (I) / Non-intrusive (N)", mandatory: true, editable: true },
        AG: { code: "VORNR", label: "N° Opération (0010, 0020, 0030...)", mandatory: true, editable: true },
        AJ: { code: "LTXA1", label: "Short Text (40 chars max)", mandatory: true, editable: true },
        AK: { code: "LTXA2", label: "Long text opération", mandatory: false, editable: true },
        AL: { code: "DAESSION", label: "Temps passé / Durée", mandatory: false, editable: true },
        AN: { code: "ANZMA", label: "Nombre de personnes", mandatory: false, editable: true }
      }
    },
    
    // Modifier une opération existante
    CHANGE_OPERATION: {
      action: "Change",
      description: "Modifier une opération existante",
      columns: {
        I: { code: "ACTION", value: "Change", label: "Action SAP", mandatory: true, editable: false },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true, editable: false },
        P: { code: "PLNAL", label: "Counter", mandatory: true, editable: false },
        T: { code: "ARBPL", label: "Work Center / Groupe", mandatory: false, editable: true },
        AG: { code: "VORNR", label: "N° Opération à modifier", mandatory: true, editable: false },
        AJ: { code: "LTXA1", label: "Short Text (40 chars max)", mandatory: false, editable: true },
        AK: { code: "LTXA2", label: "Long text opération", mandatory: false, editable: true },
        AL: { code: "DAESSION", label: "Temps passé / Durée", mandatory: false, editable: true },
        AN: { code: "ANZMA", label: "Nombre de personnes", mandatory: false, editable: true }
      }
    },
    
    // Supprimer une opération
    DELETE_OPERATION: {
      action: "Delete",
      description: "Supprimer une opération",
      columns: {
        I: { code: "ACTION", value: "Delete", label: "Action SAP", mandatory: true, editable: false },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true, editable: false },
        P: { code: "PLNAL", label: "Counter", mandatory: true, editable: false },
        AG: { code: "VORNR", label: "N° Opération à supprimer", mandatory: true, editable: false }
      }
    }
  },

  // -------------------------------------------------------------------------
  // DCF MAINTENANCE PLAN
  // -------------------------------------------------------------------------
  MAINTENANCE_PLAN: {
    CHANGE_PLAN: {
      action: "Change",
      description: "Modifier un plan de maintenance existant",
      columns: {
        I: { code: "ACTION", value: "Change", label: "Action SAP", mandatory: true, editable: false },
        J: { code: "WARPL", label: "N° Plan de maintenance", mandatory: true, editable: false },
        W: { code: "ACTION_ITEM", value: "Create", label: "Action Item (Create pour nouvel équipement)", mandatory: false, editable: false }
      }
    },
    
    CREATE_PLAN: {
      action: "Create",
      description: "Créer un nouveau plan de maintenance",
      columns: {
        I: { code: "ACTION", value: "Create", label: "Action SAP", mandatory: true, editable: false },
        Q: { code: "WPTXT", label: "Nom du plan", mandatory: true, editable: true },
        S: { code: "ZYKL1", label: "Cycle (1=année, 12=mois)", mandatory: true, editable: true },
        AA: { code: "TPLNR", label: "Functional Location ou Equipment", mandatory: true, editable: true },
        AE: { code: "INGRP", label: "Type de maintenance", mandatory: false, editable: true },
        AJ: { code: "PLNNR_REF", label: "N° Task List associée", mandatory: true, editable: true }
      }
    }
  },

  // -------------------------------------------------------------------------
  // DCF EQUIPMENT
  // -------------------------------------------------------------------------
  EQUIPMENT: {
    CREATE_EQUIPMENT: {
      action: "Create",
      description: "Créer un nouvel équipement",
      columns: {
        I: { code: "ACTION", value: "Create", label: "Action SAP", mandatory: true, editable: false },
        O: { code: "KRIT", label: "Criticité", mandatory: true, editable: true },
        P: { code: "USTATUS", value: "ISER", label: "Statut (ISER = en service)", mandatory: true, editable: false },
        Y: { code: "HERST", label: "Manufacturer", mandatory: false, editable: true },
        AA: { code: "TYPBZ", label: "Model number", mandatory: false, editable: true },
        AD: { code: "SERGE", label: "Serial Number", mandatory: false, editable: true },
        AH: { code: "EQART", label: "Plan section", mandatory: true, editable: true },
        AJ: { code: "ABCKZ", label: "ABC Indicator", mandatory: true, editable: true },
        AM: { code: "KOSTL", label: "Cost center", mandatory: true, editable: true },
        AP: { code: "INGRP", label: "Service", mandatory: true, editable: true },
        AQ: { code: "SWERK", label: "Site", mandatory: true, editable: true },
        AR: { code: "TPLNR", label: "Functional Location", mandatory: true, editable: true }
      }
    }
  }
};

// =============================================================================
// 3. LOGIQUE MÉTIER: CAS D'USAGE → DCF REQUIS
// =============================================================================

const USE_CASES = {
  // Opérations sur Task List
  change_operation: {
    description: "Modifier une opération existante",
    dcf_required: ["TASK_LIST"],
    dcf_actions: { TASK_LIST: "CHANGE_OPERATION" }
  },
  create_operation: {
    description: "Ajouter une nouvelle opération sur un plan existant",
    dcf_required: ["TASK_LIST"],
    dcf_actions: { TASK_LIST: "CREATE_OPERATION" }
  },
  delete_operation: {
    description: "Supprimer une opération",
    dcf_required: ["TASK_LIST"],
    dcf_actions: { TASK_LIST: "DELETE_OPERATION" }
  },
  
  // Plans de maintenance
  create_plan: {
    description: "Créer un nouveau plan de maintenance complet",
    dcf_required: ["TASK_LIST", "MAINTENANCE_PLAN"],
    dcf_actions: { TASK_LIST: "CREATE_OPERATION", MAINTENANCE_PLAN: "CREATE_PLAN" }
  },
  change_plan: {
    description: "Modifier un plan de maintenance",
    dcf_required: ["MAINTENANCE_PLAN"],
    dcf_actions: { MAINTENANCE_PLAN: "CHANGE_PLAN" }
  },
  
  // Équipements
  add_equipment_to_plan: {
    description: "Ajouter un équipement dans un plan existant",
    dcf_required: ["MAINTENANCE_PLAN", "EQUIPMENT"],
    dcf_actions: { MAINTENANCE_PLAN: "CHANGE_PLAN", EQUIPMENT: "CREATE_EQUIPMENT" }
  },
  
  // Fallback
  unknown: {
    description: "Action non reconnue",
    dcf_required: [],
    dcf_actions: {}
  }
};

// =============================================================================
// 4. DÉTECTION DU CAS D'USAGE
// =============================================================================

function detectUseCase(message) {
  const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Création d'opération (prioritaire)
  if (/(ajouter|creer|créer|nouvelle|nouveau|add|create).*(operation|opération)/.test(m)) {
    return "create_operation";
  }
  
  // Modification
  if (/(modifier|changer|change|update|modif).*(operation|opération)/.test(m)) {
    return "change_operation";
  }
  
  // Suppression
  if (/(supprimer|delete|retirer|enlever).*(operation|opération)/.test(m)) {
    return "delete_operation";
  }
  
  // Plans
  if (/(creer|créer|nouveau|nouvelle|create).*(plan).*(maintenance|complet)/.test(m)) {
    return "create_plan";
  }
  if (/(modifier|changer|change).*(plan)/.test(m)) {
    return "change_plan";
  }
  
  // Équipements
  if (/(ajouter|affecter|rattacher|associer).*(equipement|équipement).*(plan)/.test(m)) {
    return "add_equipment_to_plan";
  }
  
  return "unknown";
}

// =============================================================================
// 5. EXTRACTION VISION SAP AMÉLIORÉE
// =============================================================================

const VISION_PROMPT = `Tu es un expert SAP PM. Extrais TOUTES les données visibles dans cette capture SAP.

EXTRAIS SPÉCIFIQUEMENT:

1. IDENTIFIANTS:
- N° Plan de maintenance (WARPL): 8 chiffres ex: 30482333
- N° Groupe Task List (PLNNR): ex: CH940104, 20036344
- Counter (PLNAL): 1, 2, 3...
- N° Ordre (AUFNR): ex: 4097131
- N° Equipment (EQUNR): 10 chiffres
- Functional Location (TPLNR): ex: CH94-UIN-EAUIND

2. OPÉRATIONS EXISTANTES (CRITIQUE):
Si tu vois un tableau d'opérations, extrais CHAQUE ligne:
- N° Opération (Opé.): 0010, 0020, 0030...
- Work Center: FMEXUTIL, FMMANAGE...
- Description de l'opération
- Type de travail (P1, P2, P3...)

3. DONNÉES DE PLANIFICATION:
- Type d'ordre: ZM02, ZM01...
- Division: CH94
- PosteTravPrinc (Work Center principal): FMMANAGE, FMEXUTIL...
- Type de travail (P2, P3...): cherche "Type de travail" ou "VAGR"
- Priorité: 4-bas, 3, 2, 1-haut

4. DESCRIPTIONS:
- Nom/Description du plan
- Short Text / Long Text des opérations

Réponds UNIQUEMENT en JSON valide:
{
  "extracted_fields": [
    {"code": "WARPL", "value": "30482333", "label": "N° Plan", "confidence": "high"},
    {"code": "PLNNR", "value": "CH940104", "label": "N° Groupe TL", "confidence": "high"},
    {"code": "MAIN_WORK_CENTER", "value": "FMMANAGE", "label": "Work Center principal", "confidence": "high"},
    {"code": "WORK_TYPE", "value": "P2", "label": "Type de travail", "confidence": "high"}
  ],
  "existing_operations": [
    {"number": "0010", "work_center": "FMEXUTIL", "description": "VIDANGER LES FOSSES A GRAISSES"},
    {"number": "0020", "work_center": "FMMANAGE", "description": "Envoi des bons"}
  ],
  "plan_name": "Nettoyage EI B20-B23",
  "raw_text": "texte brut si pertinent"
}`;

async function extractSAPDataFromImages(images = []) {
  if (!images.length) {
    return { extracted: [], existing_operations: [], raw_texts: [] };
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️ OPENAI_API_KEY manquante");
    return { extracted: [], existing_operations: [], raw_texts: [], warning: "Vision API non configurée" };
  }

  const allExtracted = [];
  const allOperations = [];
  const rawTexts = [];
  let planName = null;

  for (const img of images) {
    try {
      let b64, mime;
      
      if (img.buffer) {
        b64 = img.buffer.toString("base64");
        mime = img.mimetype || "image/png";
      } else if (typeof img === "string") {
        if (img.startsWith("data:")) {
          const match = img.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            mime = match[1];
            b64 = match[2];
          } else {
            continue;
          }
        } else {
          b64 = img;
          mime = "image/png";
        }
      } else {
        console.warn("Format d'image non supporté:", typeof img);
        continue;
      }

      console.log(`[Vision] Analyse image (${mime})...`);

      const completion = await openai.chat.completions.create({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrais toutes les données SAP. Fais attention aux opérations existantes et au Work Center principal." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
            ]
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.0,
        max_tokens: 2000
      });

      const content = completion.choices[0].message.content;
      console.log(`[Vision] Réponse: ${content.substring(0, 200)}...`);
      
      const parsed = cleanJSON(content);
      
      if (parsed.extracted_fields && Array.isArray(parsed.extracted_fields)) {
        allExtracted.push(...parsed.extracted_fields);
      }
      if (parsed.existing_operations && Array.isArray(parsed.existing_operations)) {
        allOperations.push(...parsed.existing_operations);
      }
      if (parsed.plan_name) {
        planName = parsed.plan_name;
      }
      if (parsed.raw_text) {
        rawTexts.push(parsed.raw_text);
      }
    } catch (e) {
      console.error("[Vision] Erreur:", e.message);
    }
  }

  // Déduplication
  const uniqueExtracted = [];
  const seenCodes = new Set();
  
  for (const field of allExtracted) {
    if (field.code && !seenCodes.has(field.code)) {
      seenCodes.add(field.code);
      uniqueExtracted.push(field);
    }
  }

  // Déduplication opérations
  const uniqueOps = [];
  const seenOps = new Set();
  for (const op of allOperations) {
    const key = op.number || op.vornr;
    if (key && !seenOps.has(key)) {
      seenOps.add(key);
      uniqueOps.push(op);
    }
  }

  // Tri par numéro
  uniqueOps.sort((a, b) => {
    const numA = parseInt(a.number || a.vornr || "0", 10);
    const numB = parseInt(b.number || b.vornr || "0", 10);
    return numA - numB;
  });

  console.log(`[Vision] ${uniqueExtracted.length} champs, ${uniqueOps.length} opérations`);

  return { 
    extracted: uniqueExtracted,
    existing_operations: uniqueOps,
    plan_name: planName,
    raw_texts: rawTexts 
  };
}

// =============================================================================
// 6. FONCTIONS UTILITAIRES
// =============================================================================

function calculateNextOperationNumber(existingOperations = []) {
  if (!existingOperations || !existingOperations.length) return "0010";
  
  const numbers = existingOperations
    .map(op => {
      const num = op.number || op.vornr || "0";
      return parseInt(String(num).replace(/^0+/, ""), 10);
    })
    .filter(n => !isNaN(n) && n > 0);
  
  if (!numbers.length) return "0010";
  
  const maxOp = Math.max(...numbers);
  const nextOp = maxOp + 10;
  
  // Format avec zéros: 10 → 0010, 30 → 0030
  return String(nextOp).padStart(4, '0');
}

function determineWorkCenter(sapData) {
  // Priorité 1: Work Center principal
  const mainWC = sapData.extracted?.find(e => 
    e.code === "MAIN_WORK_CENTER" || e.code === "ARBPL_MAIN" || e.code === "PosteTravPrinc"
  );
  if (mainWC?.value) return mainWC.value;
  
  // Priorité 2: Le plus fréquent dans les opérations
  const ops = sapData.existing_operations || [];
  if (ops.length) {
    const wcCounts = {};
    ops.forEach(op => {
      const wc = op.work_center || op.arbpl;
      if (wc) {
        wcCounts[wc] = (wcCounts[wc] || 0) + 1;
      }
    });
    const sorted = Object.entries(wcCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length) return sorted[0][0];
  }
  
  // Priorité 3: Champ ARBPL générique
  const arbpl = sapData.extracted?.find(e => e.code === "ARBPL");
  if (arbpl?.value) return arbpl.value;
  
  return null;
}

function determineWorkType(sapData) {
  const workType = sapData.extracted?.find(e => 
    e.code === "WORK_TYPE" || e.code === "VAGR" || e.code === "Type de travail"
  );
  if (workType?.value) return workType.value;
  
  return null;
}

function getSapValue(sapData, ...codes) {
  for (const code of codes) {
    const field = sapData.extracted?.find(e => e.code === code);
    if (field?.value) return field.value;
  }
  return null;
}

function buildInstructionContext(sapData, useCase, requestText) {
  const context = {
    nextOperationNumber: calculateNextOperationNumber(sapData.existing_operations),
    existingOperationsCount: sapData.existing_operations?.length || 0,
    workCenter: determineWorkCenter(sapData),
    workType: determineWorkType(sapData),
    planNumber: null,
    taskListGroup: null,
    counter: null,
    planName: sapData.plan_name || null,
    division: null
  };
  
  context.planNumber = getSapValue(sapData, "WARPL", "Plan de maintenance");
  context.taskListGroup = getSapValue(sapData, "PLNNR", "Groupe Task List", "Groupe gamme");
  context.counter = getSapValue(sapData, "PLNAL", "Counter") || "1";
  context.division = getSapValue(sapData, "WERKS", "Division", "Div. planif.") || "CH94";
  
  // Chercher dans le texte
  const planMatch = requestText.match(/plan[s]?\s*(?:de maintenance)?\s*(\d{7,8})/i);
  if (planMatch && !context.planNumber) {
    context.planNumber = planMatch[1];
  }
  
  return context;
}

function cleanJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    const cleaned = str
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return {};
    }
  }
}

function sanitizeName(n) {
  return n.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

// =============================================================================
// 7. CHARGEMENT RÉFÉRENTIELS
// =============================================================================

let TASKLIST_REF = null;
let DROPDOWNS = {};

function loadTaskListReference() {
  try {
    if (fs.existsSync(TASKLIST_REF_PATH)) {
      const wb = xlsx.readFile(TASKLIST_REF_PATH);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(ws);
      
      TASKLIST_REF = {
        maintenance_plans: [],
        task_list_groups: []
      };
      
      for (const row of data) {
        if (row["N° Plan"] || row["WARPL"]) {
          TASKLIST_REF.maintenance_plans.push({
            warpl: row["N° Plan"] || row["WARPL"],
            plnnr: row["N° Groupe"] || row["PLNNR"],
            description: row["Description"] || row["Nom"],
            counter: row["Counter"] || row["PLNAL"] || "1"
          });
        }
      }
      
      console.log(`✅ Référentiel Task List: ${TASKLIST_REF.maintenance_plans.length} plans`);
    }
  } catch (e) {
    console.error("❌ Erreur référentiel:", e.message);
  }
}

function loadDropdowns() {
  try {
    if (fs.existsSync(DROPDOWN_CSV_PATH)) {
      const content = fs.readFileSync(DROPDOWN_CSV_PATH, "utf-8");
      const lines = content.split("\n").filter(l => l.trim());
      
      for (const line of lines.slice(1)) {
        const parts = line.split(";");
        if (parts.length >= 2) {
          const col = parts[0].trim();
          const values = parts.slice(1).map(v => v.trim()).filter(v => v);
          if (values.length) {
            DROPDOWNS[col] = values;
          }
        }
      }
      
      console.log(`✅ Listes déroulantes: ${Object.keys(DROPDOWNS).length} colonnes`);
    }
  } catch (e) {
    console.error("❌ Erreur dropdowns:", e.message);
  }
}

function findPlanInfo(planNumber) {
  if (!TASKLIST_REF) return null;
  return TASKLIST_REF.maintenance_plans.find(p => 
    String(p.warpl) === String(planNumber) || 
    String(p.plnnr) === String(planNumber)
  );
}

loadTaskListReference();
loadDropdowns();

// =============================================================================
// 8. ANALYSE EXCEL
// =============================================================================

function buildDeepExcelAnalysis(buffer, filename) {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const analysis = {
    filename,
    sheetNames: wb.SheetNames,
    sheets: [],
    extracted_values: [],
    rows_index: {},
    ai_context: ""
  };

  let globalContext = `Fichier: ${filename}\n`;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws["!ref"]) continue;

    const range = xlsx.utils.decode_range(ws["!ref"]);
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (row.some(cell => /^(ACTION|DCFACTION|PLNNR|WARPL|EQUNR)/i.test(String(cell)))) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 4;

    const headers = rows[headerRowIdx] || [];
    const dataStartIdx = headerRowIdx + 1;

    const columns = [];
    headers.forEach((h, idx) => {
      const colLetter = xlsx.utils.encode_col(idx);
      const headerStr = String(h || "").trim();
      if (headerStr) {
        columns.push({
          col: colLetter,
          index: idx,
          code: headerStr,
          label: headerStr
        });
      }
    });

    const sampleRows = rows.slice(dataStartIdx, dataStartIdx + 5);
    sampleRows.forEach((row, rowOffset) => {
      const rowNumber = dataStartIdx + rowOffset + 1;
      
      columns.forEach(col => {
        const val = String(row[col.index] || "").trim();
        if (val) {
          analysis.extracted_values.push({
            sheet: sheetName,
            row: rowNumber,
            col: col.col,
            field: col.code,
            value: val
          });
        }
      });
    });

    const columnsStr = columns.slice(0, 30).map(c => `${c.col}=${c.code}`).join(", ");
    globalContext += `FEUILLE "${sheetName}": ${columnsStr}\n`;

    analysis.sheets.push({
      name: sheetName,
      headerRowIdx: headerRowIdx + 1,
      dataStartRow: dataStartIdx + 1,
      columns
    });
  }

  analysis.ai_context = globalContext.trim();
  return analysis;
}

// =============================================================================
// 9. DATABASE SETUP
// =============================================================================

async function ensureMemoryTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dcf_files (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        stored_name TEXT,
        mime TEXT,
        bytes INT,
        sheet_names JSONB DEFAULT '[]'::jsonb,
        analysis JSONB DEFAULT '{}'::jsonb,
        file_data BYTEA,
        uploaded_at TIMESTAMP DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS dcf_sessions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        created_by TEXT,
        use_case VARCHAR(100),
        sap_data JSONB DEFAULT '{}'::jsonb,
        template_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS dcf_messages (
        id SERIAL PRIMARY KEY,
        session_id INT REFERENCES dcf_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS dcf_attachments (
        id SERIAL PRIMARY KEY,
        session_id INT REFERENCES dcf_sessions(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        stored_name TEXT,
        mime TEXT,
        bytes INT,
        file_data BYTEA,
        extracted_text TEXT,
        extracted_fields JSONB DEFAULT '[]'::jsonb,
        uploaded_at TIMESTAMP DEFAULT now()
      );
    `);
    
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dcf_sessions' AND column_name = 'use_case') THEN
          ALTER TABLE dcf_sessions ADD COLUMN use_case VARCHAR(100);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dcf_sessions' AND column_name = 'sap_data') THEN
          ALTER TABLE dcf_sessions ADD COLUMN sap_data JSONB DEFAULT '{}'::jsonb;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dcf_attachments' AND column_name = 'extracted_fields') THEN
          ALTER TABLE dcf_attachments ADD COLUMN extracted_fields JSONB DEFAULT '[]'::jsonb;
        END IF;
      END $$;
    `);
    
    console.log("✅ Tables DCF créées");
  } catch (e) {
    console.error("❌ Erreur tables:", e.message);
  }
}

ensureMemoryTables();

// =============================================================================
// 10. ROUTES API - FICHIERS
// =============================================================================

app.post("/api/dcf/upload", upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Aucun fichier" });

    const out = [];
    for (const f of files) {
      const analysis = buildDeepExcelAnalysis(f.buffer, f.originalname);
      const storedName = `${Date.now()}_${sanitizeName(f.originalname)}`;

      const { rows } = await pool.query(
        `INSERT INTO dcf_files (filename, stored_name, mime, bytes, sheet_names, analysis, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, filename, uploaded_at`,
        [f.originalname, storedName, f.mimetype, f.size, analysis.sheetNames, 
         { ai_context: analysis.ai_context, sheets: analysis.sheets }, f.buffer]
      );

      out.push(rows[0]);
    }

    res.json({ ok: true, files: out });
  } catch (e) {
    console.error("[upload]", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/dcf/uploadExcelMulti", upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Aucun fichier" });

    const out = [];
    for (const f of files) {
      const analysis = buildDeepExcelAnalysis(f.buffer, f.originalname);
      const storedName = `${Date.now()}_${sanitizeName(f.originalname)}`;

      const { rows } = await pool.query(
        `INSERT INTO dcf_files (filename, stored_name, mime, bytes, sheet_names, analysis, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, filename, uploaded_at`,
        [f.originalname, storedName, f.mimetype, f.size, analysis.sheetNames, 
         { ai_context: analysis.ai_context, sheets: analysis.sheets }, f.buffer]
      );

      out.push(rows[0]);
    }

    res.json({ ok: true, files: out });
  } catch (e) {
    console.error("[uploadExcelMulti]", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dcf/files", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, uploaded_at FROM dcf_files WHERE file_data IS NOT NULL ORDER BY uploaded_at DESC LIMIT ${MAX_FILES_LIBRARY}`
    );
    res.json({ ok: true, files: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dcf/files/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query("SELECT filename, mime, file_data FROM dcf_files WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).send("Not found");

    const f = rows[0];
    res.setHeader("Content-Type", f.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(f.filename)}"`);
    res.send(f.file_data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// 11. ROUTES API - WIZARD
// =============================================================================

app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const { title } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO dcf_sessions (title) VALUES ($1) RETURNING id, title, created_at`,
      [title || "Session DCF"]
    );
    res.json({ ok: true, session: rows[0], sessionId: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 2: Analyse demande + screenshots
app.post("/api/dcf/wizard/analyze", upload.array("screenshots", 10), async (req, res) => {
  try {
    const { sessionId, requestText, message } = req.body;
    const textToAnalyze = requestText || message || "";
    const screenshots = req.files || [];

    console.log(`[analyze] Message: "${textToAnalyze.substring(0, 100)}...", Screenshots: ${screenshots.length}`);

    // 1. Extraire données SAP
    const sapData = await extractSAPDataFromImages(screenshots);
    console.log(`[analyze] Extracted ${sapData.extracted?.length || 0} SAP fields, ${sapData.existing_operations?.length || 0} operations`);

    // 2. Sauvegarder screenshots
    for (const ss of screenshots) {
      try {
        const storedName = `${Date.now()}_${sanitizeName(ss.originalname)}`;
        
        await pool.query(
          `INSERT INTO dcf_attachments (session_id, filename, stored_name, mime, bytes, file_data, extracted_fields)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [sessionId, ss.originalname, storedName, ss.mimetype, ss.size, ss.buffer, JSON.stringify(sapData.extracted || [])]
        );
      } catch (dbErr) {
        console.log(`[analyze] Attachment save error: ${dbErr.message}`);
      }
    }

    // 3. Détection cas d'usage
    const useCase = detectUseCase(textToAnalyze);
    const useCaseInfo = USE_CASES[useCase] || USE_CASES.unknown;
    console.log(`[analyze] Use case: ${useCase}`);

    // 4. Référentiel
    let refInfo = "";
    const planNumber = getSapValue(sapData, "WARPL") || textToAnalyze.match(/(\d{7,8})/)?.[1];
    if (planNumber) {
      const planInfo = findPlanInfo(planNumber);
      if (planInfo) {
        refInfo = `Plan ${planNumber}: TL=${planInfo.plnnr}, Counter=${planInfo.counter}`;
      }
    }

    // 5. Mapper DCF requis
    const { rows: recentFiles } = await pool.query(
      `SELECT id, filename FROM dcf_files WHERE file_data IS NOT NULL ORDER BY uploaded_at DESC LIMIT ${MAX_FILES_LIBRARY}`
    );

    const required_files = [];
    for (const dcfType of useCaseInfo.dcf_required) {
      const matchingFile = recentFiles.find(f => {
        const fn = f.filename.toLowerCase();
        if (dcfType === "TASK_LIST") return fn.includes("task") || fn.includes("tl");
        if (dcfType === "MAINTENANCE_PLAN") return fn.includes("pm") || fn.includes("plan");
        if (dcfType === "EQUIPMENT") return fn.includes("eqpt") || fn.includes("equipment");
        return false;
      });

      required_files.push({
        type: dcfType,
        action: useCaseInfo.dcf_actions[dcfType],
        template_filename: matchingFile?.filename || null,
        file_id: matchingFile?.id || null
      });
    }

    // 6. Update session
    if (sessionId) {
      try {
        await pool.query(
          `UPDATE dcf_sessions SET use_case = $1, sap_data = $2 WHERE id = $3`,
          [useCase, JSON.stringify(sapData), sessionId]
        );
      } catch (dbErr) {
        console.log(`[analyze] Session update error: ${dbErr.message}`);
      }
    }

    // 7. Contexte
    const context = buildInstructionContext(sapData, useCase, textToAnalyze);

    const response = {
      action: useCase,
      description: useCaseInfo.description,
      is_manual: useCase === "unknown",
      reasoning: `Cas: ${useCaseInfo.description}. ${refInfo}`,
      required_files,
      sap_extracted: sapData.extracted || [],
      existing_operations: sapData.existing_operations || [],
      context: {
        nextOperationNumber: context.nextOperationNumber,
        workCenter: context.workCenter,
        workType: context.workType,
        planName: context.planName,
        planNumber: context.planNumber,
        taskListGroup: context.taskListGroup
      },
      reference_info: refInfo,
      questions: []
    };

    // Questions si données manquantes
    if (useCase === "create_operation" && !context.taskListGroup) {
      response.questions.push("Quel est le N° Groupe Task List (PLNNR) ?");
    }
    if (!context.workCenter) {
      response.questions.push("Quel est le Work Center (ARBPL) ?");
    }

    console.log(`[analyze] Response: ${required_files.length} files, ${sapData.extracted?.length || 0} fields`);
    res.json(response);
  } catch (e) {
    console.error("[analyze]", e);
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 3: Génération instructions
app.post("/api/dcf/wizard/instructions", upload.array("screenshots", 10), async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename, attachmentIds = [] } = req.body;
    const newScreenshots = req.files || [];

    console.log(`[instructions] Template: ${templateFilename}, New screenshots: ${newScreenshots.length}`);

    // 1. Template
    const { rows } = await pool.query(
      `SELECT id, filename, analysis, file_data FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `Template "${templateFilename}" introuvable` });
    }

    const file = rows[0];
    const analysis = file.file_data ? buildDeepExcelAnalysis(file.file_data, file.filename) : null;

    // 2. Données SAP session
    let sessionSapData = { extracted: [], existing_operations: [] };
    if (sessionId) {
      const { rows: sessionRows } = await pool.query(
        `SELECT sap_data, use_case FROM dcf_sessions WHERE id = $1`,
        [sessionId]
      );
      if (sessionRows.length && sessionRows[0].sap_data) {
        sessionSapData = sessionRows[0].sap_data;
      }
    }

    // 3. Nouveaux screenshots
    let newSapData = { extracted: [], existing_operations: [] };
    if (newScreenshots.length) {
      newSapData = await extractSAPDataFromImages(newScreenshots);
    }

    // 4. Fusion
    const allSapData = {
      extracted: [...(sessionSapData.extracted || []), ...(newSapData.extracted || [])],
      existing_operations: [...(sessionSapData.existing_operations || []), ...(newSapData.existing_operations || [])],
      plan_name: sessionSapData.plan_name || newSapData.plan_name
    };

    // 5. Type template
    const fn = templateFilename.toLowerCase();
    let templateType = "TASK_LIST";
    if (fn.includes("pm") || fn.includes("plan")) {
      templateType = "MAINTENANCE_PLAN";
    } else if (fn.includes("eqpt") || fn.includes("equipment")) {
      templateType = "EQUIPMENT";
    }

    // 6. Cas d'usage
    const useCase = detectUseCase(requestText || "");
    const useCaseInfo = USE_CASES[useCase] || USE_CASES.unknown;
    const dcfAction = useCaseInfo.dcf_actions[templateType];

    // 7. Mapping colonnes
    let columnsToFill = {};
    if (DCF_COLUMNS[templateType] && dcfAction && DCF_COLUMNS[templateType][dcfAction]) {
      columnsToFill = DCF_COLUMNS[templateType][dcfAction].columns;
    }

    // 8. Contexte
    const context = buildInstructionContext(allSapData, useCase, requestText || "");

    console.log(`[instructions] Context: nextOp=${context.nextOperationNumber}, WC=${context.workCenter}, type=${context.workType}`);

    // 9. Prompt IA
    const sapDataStr = JSON.stringify({
      extracted: allSapData.extracted,
      existing_operations: allSapData.existing_operations,
      plan_name: allSapData.plan_name
    }, null, 2);

    const prompt = `Tu dois générer les instructions PRÉCISES pour remplir un fichier DCF SAP.

DEMANDE: "${requestText}"

CAS D'USAGE: ${useCase} - ${useCaseInfo.description}

TEMPLATE: ${templateFilename} (Type: ${templateType}, Action: ${dcfAction || "N/A"})

DONNÉES SAP EXTRAITES:
${sapDataStr}

CONTEXTE CALCULÉ (UTILISE CES VALEURS):
- Prochain N° Opération: ${context.nextOperationNumber} (basé sur ${context.existingOperationsCount} ops: ${allSapData.existing_operations?.map(o => o.number).join(", ") || "aucune"})
- Work Center: ${context.workCenter || "NON TROUVÉ"}
- Type de travail: ${context.workType || "NON TROUVÉ"}
- N° Plan: ${context.planNumber || "NON TROUVÉ"}
- N° Groupe TL: ${context.taskListGroup || "NON TROUVÉ"}
- Counter: ${context.counter || "1"}
- Nom plan: ${context.planName || "NON TROUVÉ"}

COLONNES OBLIGATOIRES (${dcfAction || "N/A"}):
${Object.entries(columnsToFill).map(([col, info]) => 
  `${col}: ${info.code} - ${info.label || ""} ${info.mandatory ? "(OBLIGATOIRE)" : ""} ${info.value ? `= "${info.value}"` : ""}`
).join("\n")}

RÈGLES CRITIQUES:
1. N° Opération (col AG): Utilise ${context.nextOperationNumber}, PAS 0010 par défaut!
2. Work Center (col T): Utilise ${context.workCenter || "la valeur extraite"}, PAS FMEXMAINT!
3. Type travail: Utilise ${context.workType || "la valeur extraite"}
4. Short Text (col AJ): max 40 caractères
5. Counter (col P): ${context.counter}
6. ACTION (col I): ${dcfAction === "CREATE_OPERATION" ? "Create" : dcfAction === "CHANGE_OPERATION" ? "Change" : "Delete"}
7. System Condition (col X): I = Intrusive, N = Non-intrusive

GÉNÈRE en JSON:
{
  "steps": [
    {
      "row": "6",
      "col": "I",
      "code": "ACTION",
      "label": "Action SAP",
      "value": "Create",
      "reason": "Nouvelle opération",
      "mandatory": true,
      "sheet": "DCF",
      "editable": false
    },
    {
      "row": "6",
      "col": "AG",
      "code": "VORNR",
      "label": "N° Opération",
      "value": "${context.nextOperationNumber}",
      "reason": "Après opérations ${allSapData.existing_operations?.map(o => o.number).join(", ") || ""}",
      "mandatory": true,
      "sheet": "DCF",
      "editable": true
    }
  ],
  "missing_data": ["Liste données manquantes"]
}

IMPORTANT:
- Utilise les VRAIES valeurs du contexte!
- Si valeur non trouvée, mets null dans missing_data
- Génère TOUTES les colonnes obligatoires`;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Expert SAP DCF. Génère instructions PRÉCISES basées sur données extraites. N'invente JAMAIS - utilise uniquement le contexte fourni." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 3000
    });

    const out = cleanJSON(completion.choices[0].message.content);
    const steps = Array.isArray(out.steps) ? out.steps : [];

    const processedSteps = steps.map((s, idx) => ({
      index: idx,
      row: String(s.row || "6"),
      col: String(s.col || ""),
      code: String(s.code || ""),
      label: String(s.label || ""),
      value: s.value || "",
      reason: s.reason || "",
      mandatory: Boolean(s.mandatory),
      sheet: s.sheet || "DCF",
      editable: s.editable !== false && Boolean(s.value !== "Create" && s.value !== "Change" && s.value !== "Delete")
    }));

    const missingData = out.missing_data || [];
    if (!context.workCenter && useCase.includes("operation")) {
      missingData.push("Work Center (ARBPL) non trouvé");
    }
    if (!context.taskListGroup && templateType === "TASK_LIST") {
      missingData.push("N° Groupe Task List (PLNNR) non trouvé");
    }

    console.log(`[instructions] ${processedSteps.length} steps, ${missingData.length} missing`);

    res.json({
      steps: processedSteps,
      missing_data: missingData,
      sap_extracted: allSapData.extracted,
      existing_operations: allSapData.existing_operations,
      context,
      template_type: templateType,
      use_case: useCase
    });
  } catch (e) {
    console.error("[instructions]", e);
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 4: Générer fichier rempli
app.post("/api/dcf/wizard/autofill", async (req, res) => {
  try {
    const { templateFilename, instructions } = req.body;

    const { rows } = await pool.query(
      `SELECT filename, mime, file_data FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Template introuvable" });
    }

    const tpl = rows[0];
    const wb = xlsx.read(tpl.file_data, { type: "buffer" });
    const steps = Array.isArray(instructions) ? instructions : [];

    for (const inst of steps) {
      if (!inst.value || inst.value === "null" || inst.value === null) continue;
      
      const sheetName = inst.sheet && wb.Sheets[inst.sheet] ? inst.sheet : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const row = parseInt(inst.row, 10);
      const col = inst.col;
      if (!row || !col) continue;

      const cellRef = `${col}${row}`;
      ws[cellRef] = { t: "s", v: String(inst.value) };

      if (!ws["!ref"]) {
        ws["!ref"] = `A1:${cellRef}`;
      } else {
        const currentRange = xlsx.utils.decode_range(ws["!ref"]);
        const colNum = xlsx.utils.decode_col(col);
        if (colNum > currentRange.e.c) currentRange.e.c = colNum;
        if (row - 1 > currentRange.e.r) currentRange.e.r = row - 1;
        ws["!ref"] = xlsx.utils.encode_range(currentRange);
      }
    }

    const outBuffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    const outName = tpl.filename.replace(/\.xlsx?$/i, "_FILLED.xlsx");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(outName)}"`);
    res.send(outBuffer);
  } catch (e) {
    console.error("[autofill]", e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// 12. ROUTES API - VALIDATION & HEALTH
// =============================================================================

app.get("/api/dcf/health", (req, res) => {
  res.json({
    status: "ok",
    version: "9.1.0",
    features: [
      "vision_extraction_v2",
      "auto_operation_numbering",
      "work_center_detection",
      "column_mapping_fixed",
      "context_reuse_fixed"
    ],
    config: {
      vision_model: VISION_MODEL,
      answer_model: ANSWER_MODEL,
      has_tasklist_ref: !!TASKLIST_REF,
      dropdowns_count: Object.keys(DROPDOWNS).length
    }
  });
});

// =============================================================================
// 13. DÉMARRAGE
// =============================================================================

app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           DCF SAP Assistant v9.1.0 - CORRECTIONS              ║
╠═══════════════════════════════════════════════════════════════╣
║  URL: http://${HOST}:${PORT}                                  
║                                                               ║
║  Corrections v9.1:                                            ║
║  ✅ Fix mapping colonnes (VORNR → AG, ARBPL → T)              ║
║  ✅ Calcul automatique N° opération (0010→0020→0030)          ║
║  ✅ Réutilisation données Vision extraites                    ║
║  ✅ Détection correcte Work Center depuis screenshots         ║
╚═══════════════════════════════════════════════════════════════╝
`);
});
