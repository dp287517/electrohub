// server_dcf.js — Assistant DCF SAP v8.0.1
// REFONTE COMPLÈTE basée sur documentation métier
// FIX: CSP pour blob URLs + meilleure gestion erreurs
//
// Nouveautés v8:
// - Upload images SAP dès l'étape 1 (analyse préliminaire)
// - Logique métier stricte (TL/PM/EQPT combinaisons)
// - Mapping colonnes précis par type de DCF
// - Référentiel Task List intégré
// - Édition des valeurs step 3
// - Validation scope-aware améliorée

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

// -----------------------------------------------------------------------------
// 0. CONFIG
// -----------------------------------------------------------------------------

const HOST = process.env.DCF_HOST || "127.0.0.1";
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
const MAX_CONTEXT_CHARS = 15000;
const MAX_ATTACHMENT_TEXT = 8000;
const MAX_MEMORY_HINTS = 50;

// -----------------------------------------------------------------------------
// 1. EXPRESS SETUP avec CSP corrigé pour blob: URLs
// -----------------------------------------------------------------------------

const app = express();

// Configuration Helmet avec CSP permissive pour blob:
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://api.openai.com", "https://*.openai.com"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "30mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

// -----------------------------------------------------------------------------
// 2. BUSINESS LOGIC - RÈGLES MÉTIER DCF
// -----------------------------------------------------------------------------

/**
 * LOGIQUE MÉTIER STRICTE basée sur la documentation
 * 
 * | Cas d'usage                          | DCF requis           |
 * |--------------------------------------|----------------------|
 * | Modifier opération existante (IP18)  | TL (Change)          |
 * | Ajouter opération sur plan existant  | TL (Create)          |
 * | Ajouter équipement dans plan existant| PM (Change) + EQPT   |
 * | Modifier équipement seul             | EQPT (Change)        |
 * | Créer nouveau plan complet           | TL + PM (Create)     |
 * | Affecter équipement à plan existant  | PM (Change) + TL     |
 * | Supprimer opération                  | TL (Delete)          |
 * | Supprimer plan                       | PM (Delete) + TL     |
 */

const BUSINESS_RULES = {
  // Colonnes obligatoires par type de DCF et action
  TASK_LIST: {
    MODIFY_OPERATION: {
      action: "Change",
      columns: {
        I: { code: "ACTION", value: "Change", mandatory: true },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true },
        P: { code: "PLNAL", label: "Counter (1, 2, 3...)", mandatory: true },
        Q: { code: "KTEXT", label: "Nom du plan", mandatory: false },
        AG: { code: "VORNR", label: "N° Opération (10, 20, 30...)", mandatory: true },
        AJ: { code: "LTXA1", label: "Short Text (40 chars max)", mandatory: false },
        AK: { code: "LTXA2", label: "Long Text", mandatory: false },
        AL: { code: "DAESSION", label: "Temps passé", mandatory: false },
        AN: { code: "ARBPL", label: "Nb personnes", mandatory: false },
        X: { code: "SYSTC", label: "Intrusive/Non-intrusive", mandatory: false }
      }
    },
    CREATE_OPERATION: {
      action: "Create",
      columns: {
        I: { code: "ACTION", value: "Create", mandatory: true },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true },
        P: { code: "PLNAL", label: "Counter", mandatory: true },
        Q: { code: "KTEXT", label: "Nom du plan", mandatory: true },
        T: { code: "ARBPL", label: "Work Center", mandatory: true },
        X: { code: "SYSTC", label: "System Condition", mandatory: true },
        AG: { code: "VORNR", label: "N° Opération", mandatory: true },
        AJ: { code: "LTXA1", label: "Short Text (40 max)", mandatory: true },
        AK: { code: "LTXA2", label: "Long Text", mandatory: false },
        AL: { code: "DAESSION", label: "Durée", mandatory: true },
        AN: { code: "ANZMA", label: "Nb personnes", mandatory: true },
        AV: { code: "SYSTC2", label: "System Condition", mandatory: false }
      }
    },
    DELETE_OPERATION: {
      action: "Delete",
      columns: {
        I: { code: "ACTION", value: "Delete", mandatory: true },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true },
        P: { code: "PLNAL", label: "Counter", mandatory: true },
        AG: { code: "VORNR", label: "N° Opération", mandatory: true }
      }
    }
  },

  MAINTENANCE_PLAN: {
    CHANGE_PLAN: {
      action: "Change",
      columns: {
        I: { code: "ACTION", value: "Change", mandatory: true },
        J: { code: "WARPL", label: "N° Plan maintenance", mandatory: true },
        W: { code: "ACTION_ITEM", label: "Action Item", mandatory: false }
      }
    },
    CREATE_PLAN: {
      action: "Create",
      columns: {
        I: { code: "ACTION", value: "Create", mandatory: true },
        Q: { code: "WPTXT", label: "Nom du plan", mandatory: true },
        S: { code: "ZYKL1", label: "Cycle (1=année, 12=mois)", mandatory: true },
        U: { code: "ZYTXT", label: "Texte cycle", mandatory: false },
        AA: { code: "TPLNR_EQUNR", label: "FL ou Equipment", mandatory: true },
        AE: { code: "AUART", label: "Type maintenance", mandatory: true },
        AF: { code: "GEWRK", label: "Main Work Center", mandatory: true },
        AH: { code: "INGRP", label: "Maint Plan Group", mandatory: true },
        AI: { code: "ILART", label: "Maint Activity Type", mandatory: true },
        AJ: { code: "PLNNR", label: "Task List Group ref", mandatory: true },
        BC: { code: "GSTRP", label: "Start Date", mandatory: true }
      }
    },
    ADD_EQUIPMENT_TO_PLAN: {
      action: "Change",
      columns: {
        I: { code: "ACTION", value: "Change", mandatory: true },
        J: { code: "WARPL", label: "N° Plan maintenance", mandatory: true },
        W: { code: "ACTION_ITEM", value: "Create", mandatory: true }
        // + colonnes pour identifier l'équipement
      }
    }
  },

  EQUIPMENT: {
    CREATE: {
      action: "Create",
      columns: {
        I: { code: "ACTION", value: "Create", mandatory: true },
        O: { code: "EQTYP", label: "Object Type/Criticité", mandatory: true },
        P: { code: "SSTAT", label: "Status (ISER)", value: "ISER", mandatory: true },
        Y: { code: "HERST", label: "Manufacturer", mandatory: true },
        AA: { code: "TYPBZ", label: "Model Number", mandatory: true },
        AD: { code: "SERGE", label: "Serial Number", mandatory: true },
        AH: { code: "BEESSION", label: "Plant Section", mandatory: true },
        AJ: { code: "ABESSION", label: "ABC Indicator", mandatory: true },
        AM: { code: "KOSTL", label: "Cost Center", mandatory: true },
        AP: { code: "INGRP", label: "Planner Group", mandatory: true },
        AQ: { code: "GEWRK", label: "Main Work Center", mandatory: true },
        AR: { code: "TPLNR", label: "Functional Location", mandatory: true },
        AT: { code: "BAESSION", label: "Construction Type", value: "Next", mandatory: false },
        AW: { code: "MAESSION", label: "Grouping Key", value: "PRT6", mandatory: false },
        BD: { code: "KLESSION", label: "Class", mandatory: true }
      }
    },
    CHANGE: {
      action: "Change",
      columns: {
        I: { code: "ACTION", value: "Change", mandatory: true },
        J: { code: "EQUNR", label: "N° Equipment", mandatory: true }
        // Seules les colonnes modifiées sont requises
      }
    }
  }
};

// Mapping USE CASE -> DCF requis
const USE_CASE_MAPPING = {
  "modify_operation": {
    description: "Modifier une opération existante (IP18)",
    dcf_required: ["TASK_LIST"],
    rules: ["TASK_LIST.MODIFY_OPERATION"]
  },
  "create_operation": {
    description: "Ajouter une opération sur un plan existant",
    dcf_required: ["TASK_LIST"],
    rules: ["TASK_LIST.CREATE_OPERATION"]
  },
  "add_equipment_to_plan": {
    description: "Ajouter un équipement dans un plan existant",
    dcf_required: ["MAINTENANCE_PLAN", "EQUIPMENT"],
    rules: ["MAINTENANCE_PLAN.ADD_EQUIPMENT_TO_PLAN", "EQUIPMENT.CREATE"]
  },
  "modify_equipment": {
    description: "Modifier un équipement uniquement",
    dcf_required: ["EQUIPMENT"],
    rules: ["EQUIPMENT.CHANGE"]
  },
  "create_plan": {
    description: "Créer un nouveau plan de maintenance complet",
    dcf_required: ["TASK_LIST", "MAINTENANCE_PLAN"],
    rules: ["TASK_LIST.CREATE_OPERATION", "MAINTENANCE_PLAN.CREATE_PLAN"]
  },
  "assign_equipment_existing_plan": {
    description: "Affecter un équipement à un plan existant",
    dcf_required: ["TASK_LIST", "MAINTENANCE_PLAN"],
    rules: ["TASK_LIST.MODIFY_OPERATION", "MAINTENANCE_PLAN.CHANGE_PLAN"]
  },
  "delete_operation": {
    description: "Supprimer une opération",
    dcf_required: ["TASK_LIST"],
    rules: ["TASK_LIST.DELETE_OPERATION"]
  },
  "delete_plan": {
    description: "Supprimer un plan de maintenance",
    dcf_required: ["TASK_LIST", "MAINTENANCE_PLAN"],
    rules: ["TASK_LIST.DELETE_OPERATION", "MAINTENANCE_PLAN.CHANGE_PLAN"]
  }
};

// -----------------------------------------------------------------------------
// 3. HELPERS
// -----------------------------------------------------------------------------

function cleanJSON(text = "") {
  try {
    const cleaned = text.trim().replace(/```json/gi, "").replace(/```/g, "");
    return JSON.parse(cleaned);
  } catch {
    return { error: "Invalid JSON", raw: text };
  }
}

function sanitizeName(name = "") {
  return String(name).replace(/[^\w.\-]+/g, "_");
}

function clampStr(s, n) {
  return String(s ?? "").slice(0, n);
}

function columnIndexToLetter(idx) {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = ((n - 1) % 26) + 65;
    s = String.fromCharCode(r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function letterToIndex(letter) {
  let n = 0;
  const s = String(letter || "").toUpperCase().trim();
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) - 64;
    if (c < 1 || c > 26) continue;
    n = n * 26 + c;
  }
  return n - 1;
}

// Détection du use case depuis le texte
function detectUseCase(text = "") {
  const m = String(text).toLowerCase();

  // Suppression
  if (/(supprimer|delete|retirer|désactiver).*(plan|opération|operation)/.test(m)) {
    if (/plan/.test(m)) return "delete_plan";
    return "delete_operation";
  }

  // Création plan complet
  if (/(créer|creer|nouveau|nouvelle).*(plan|maintenance plan)/.test(m) && !/(existant|exist)/.test(m)) {
    return "create_plan";
  }

  // Ajout opération sur plan existant
  if (/(ajout|ajouter|rajouter|créer|creer|insert).*(opération|operation|contrôle|controle|inspection|check|vérif)/.test(m)) {
    if (/(plan|existant|exist|ip18)/.test(m)) return "create_operation";
  }

  // Modification opération
  if (/(modif|modifier|changer|update).*(opération|operation|contrôle|controle)/.test(m)) {
    return "modify_operation";
  }

  // Ajout équipement dans plan
  if (/(ajout|ajouter).*(équipement|equipement).*(plan)/.test(m)) {
    return "add_equipment_to_plan";
  }

  // Modification équipement seul
  if (/(modif|modifier|changer).*(équipement|equipement)/.test(m)) {
    return "modify_equipment";
  }

  // Affectation équipement à plan existant
  if (/(affecter|rattacher|associer).*(équipement|equipement).*(plan)/.test(m)) {
    return "assign_equipment_existing_plan";
  }

  return "unknown";
}

// -----------------------------------------------------------------------------
// 4. VISION - EXTRACTION SAP (avec gestion d'erreurs améliorée)
// -----------------------------------------------------------------------------

async function extractSAPDataFromImages(images = []) {
  if (!images.length) return { extracted: [], raw_texts: [] };

  // Vérifier la clé API OpenAI
  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️ OPENAI_API_KEY manquante - Vision désactivée");
    return { extracted: [], raw_texts: [], warning: "Vision API non configurée" };
  }

  const results = [];
  const rawTexts = [];

  for (const img of images) {
    try {
      // Gérer les différents formats d'image
      let b64, mime;
      
      if (img.buffer) {
        // Fichier uploadé via multer
        b64 = img.buffer.toString("base64");
        mime = img.mimetype || "image/png";
      } else if (typeof img === "string") {
        // Déjà en base64
        b64 = img;
        mime = "image/png";
      } else {
        console.warn("Format d'image non supporté:", typeof img);
        continue;
      }

      const completion = await openai.chat.completions.create({
        model: VISION_MODEL,
        messages: [
          {
            role: "system",
            content: `Tu es un expert SAP. Extrais TOUS les codes et valeurs visibles dans cette capture SAP.

CHERCHE SPÉCIFIQUEMENT:
- Numéros de plan (WARPL): 8 chiffres ex: 40052643
- Numéros Task List Group (PLNNR): ex: 20036344, CH940XXX
- Counter Group: 1, 2, 3...
- N° Opération: 10, 20, 30...
- N° Equipment: 10XXXXXXX
- Functional Location: CH94-XXXX
- Short Text / Description
- Work Center: FMXXXXXX, INXXXXX
- Dates, durées, nombres de personnes
- Criticité, Status

Réponds en JSON:
{
  "extracted_fields": [
    {"code": "WARPL", "value": "40052643", "confidence": "high"},
    {"code": "PLNNR", "value": "20036344", "confidence": "high"}
  ],
  "raw_text": "texte brut visible"
}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrais toutes les données SAP de cette capture." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
            ]
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.0,
        max_tokens: 1000
      });

      const parsed = cleanJSON(completion.choices[0].message.content);
      if (parsed.extracted_fields) {
        results.push(...parsed.extracted_fields);
      }
      if (parsed.raw_text) {
        rawTexts.push(parsed.raw_text);
      }
    } catch (e) {
      console.error("Vision error:", e.message);
      // Continuer avec les autres images
    }
  }

  return { extracted: results, raw_texts: rawTexts };
}

// -----------------------------------------------------------------------------
// 5. TASK LIST REFERENCE
// -----------------------------------------------------------------------------

let TASKLIST_REF = null;

function loadTaskListReference() {
  try {
    if (!fs.existsSync(TASKLIST_REF_PATH)) {
      console.warn("⚠️ Référentiel Task List introuvable:", TASKLIST_REF_PATH);
      return;
    }

    const wb = xlsx.read(fs.readFileSync(TASKLIST_REF_PATH), { type: "buffer" });
    TASKLIST_REF = {
      maintenance_plans: [],
      task_list_groups: []
    };

    // Sheet "Maintenance Plant Actif"
    if (wb.SheetNames.includes("Maintenance Plant Actif")) {
      const ws = wb.Sheets["Maintenance Plant Actif"];
      const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row && row[3]) { // Colonne D = Maintenance Plan
          TASKLIST_REF.maintenance_plans.push({
            pu: row[0],
            value_stream: row[1],
            equipment: row[2],
            plan_number: String(row[3]),
            description: row[4],
            task_list_group: String(row[5] || ""),
            counter_group: row[6],
            maintenance_item: row[7]
          });
        }
      }
    }

    // Sheet "Group TL Dispo"
    if (wb.SheetNames.includes("Group TL Dispo")) {
      const ws = wb.Sheets["Group TL Dispo"];
      const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row && row[1]) { // Colonne B = N° GROUP
          TASKLIST_REF.task_list_groups.push({
            owner: row[0],
            group_number: String(row[1]),
            counter: row[2],
            description: row[3],
            comments: row[4]
          });
        }
      }
    }

    console.log(`✅ Référentiel Task List chargé: ${TASKLIST_REF.maintenance_plans.length} plans, ${TASKLIST_REF.task_list_groups.length} TL groups`);
  } catch (e) {
    console.warn("⚠️ Référentiel Task List non chargé:", e.message);
  }
}

loadTaskListReference();

function findPlanInfo(planNumber) {
  if (!TASKLIST_REF || !planNumber) return null;
  return TASKLIST_REF.maintenance_plans.find(p => p.plan_number === String(planNumber));
}

function findTaskListGroup(groupNumber) {
  if (!TASKLIST_REF || !groupNumber) return null;
  return TASKLIST_REF.task_list_groups.filter(t => t.group_number === String(groupNumber));
}

// -----------------------------------------------------------------------------
// 6. DROPDOWN LISTS
// -----------------------------------------------------------------------------

let DROPDOWN_INDEX = null;

function loadDropdownCSV() {
  try {
    if (!fs.existsSync(DROPDOWN_CSV_PATH)) {
      console.warn("⚠️ Dropdown CSV introuvable:", DROPDOWN_CSV_PATH);
      return;
    }

    const raw = fs.readFileSync(DROPDOWN_CSV_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    const header = lines.shift();
    if (!header) return;

    const delim = (header.match(/;/g) || []).length > (header.match(/,/g) || []).length ? ";" : ",";
    const idx = new Map();

    for (const line of lines) {
      const parts = line.split(delim).map(p => p.trim().replace(/^"|"$/g, ""));
      if (parts.length < 6) continue;

      const fichier = parts[0].toLowerCase().replace(/\.(xlsx|xlsm|xls)$/i, "").replace(/[^a-z0-9]+/g, " ").trim();
      const listName = parts[3];
      const values = parts.slice(5).join(delim).split(/[,;]/).map(v => v.trim()).filter(Boolean);

      if (!idx.has(fichier)) idx.set(fichier, []);
      idx.get(fichier).push({ listName, cellules: parts[2], values });
    }

    DROPDOWN_INDEX = idx;
    console.log(`✅ Dropdown CSV chargé: ${idx.size} fichiers`);
  } catch (e) {
    console.warn("⚠️ Dropdown CSV non chargé:", e.message);
  }
}

loadDropdownCSV();

function getDropdownsForTemplate(filename = "") {
  if (!DROPDOWN_INDEX) return [];
  const key = String(filename).toLowerCase().replace(/\.(xlsx|xlsm|xls)$/i, "").replace(/[^a-z0-9]+/g, " ").trim();
  
  for (const [k, arr] of DROPDOWN_INDEX.entries()) {
    if (key.includes(k) || k.includes(key)) return arr;
  }
  return [];
}

// -----------------------------------------------------------------------------
// 7. EXCEL ANALYSIS
// -----------------------------------------------------------------------------

function buildDeepExcelAnalysis(buffer, originalName = "") {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: false });
  const analysis = {
    filename: originalName,
    sheetNames: wb.SheetNames || [],
    sheets: [],
    ai_context: "",
    extracted_values: [],
    rows_index: {}
  };

  let globalContext = "";

  for (const sheetName of analysis.sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!raw.length) continue;

    // Trouver la ligne header (cherche "code" ou "field")
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(raw.length, 20); r++) {
      const row = raw[r].map(c => String(c).toLowerCase());
      if (row.some(c => c.includes("code") || c.includes("field"))) {
        headerRowIdx = r;
        break;
      }
    }

    const row0 = raw[headerRowIdx] || [];
    const row1 = raw[headerRowIdx + 1] || [];

    // Déterminer quelle ligne contient les codes
    const row0IsCodes = row0.filter(c => /^[A-Z0-9_]{2,}$/.test(String(c).trim())).length > row0.length * 0.3;
    const row1IsCodes = row1.filter(c => /^[A-Z0-9_]{2,}$/.test(String(c).trim())).length > row1.length * 0.3;

    const codesRow = row1IsCodes ? row1 : row0;
    const labelsRow = row1IsCodes ? row0 : row1;

    // Extraire colonnes
    const columns = [];
    codesRow.forEach((code, idx) => {
      const c = String(code).trim();
      if (c.length > 1 && /[A-Za-z0-9]/.test(c)) {
        columns.push({
          idx,
          col: columnIndexToLetter(idx),
          code: c,
          label: String(labelsRow[idx] || "").trim()
        });
      }
    });

    // Filtrer colonnes avant H pour les templates SAP
    const filteredColumns = columns.filter(c => c.idx >= 7); // H = index 7

    // Data start
    const dataStartIdx = headerRowIdx + 2;
    const dataRows = raw.slice(dataStartIdx);

    // Extraire valeurs
    dataRows.forEach((rowArr, ridx) => {
      const rowNumber = dataStartIdx + ridx + 1;
      const rowKey = `${sheetName}::${rowNumber}`;

      for (const colDef of filteredColumns) {
        const val = String(rowArr[colDef.idx] ?? "").trim();
        if (val) {
          analysis.extracted_values.push({
            sheet: sheetName,
            row: rowNumber,
            col: colDef.col,
            field: colDef.code,
            label: colDef.label,
            value: val
          });

          if (!analysis.rows_index[rowKey]) analysis.rows_index[rowKey] = {};
          analysis.rows_index[rowKey][colDef.code] = val;
        }
      }
    });

    // Contexte pour IA
    const columnsStr = filteredColumns.map(c => `${c.col}=${c.code}`).join(", ");
    globalContext += `SHEET "${sheetName}": Colonnes: ${columnsStr}\n`;

    analysis.sheets.push({
      name: sheetName,
      headerRowIdx: headerRowIdx + 1,
      dataStartRow: dataStartIdx + 1,
      columns: filteredColumns
    });
  }

  analysis.ai_context = globalContext.trim();
  return analysis;
}

// -----------------------------------------------------------------------------
// 8. DB SETUP
// -----------------------------------------------------------------------------

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
        use_case TEXT,
        sap_data JSONB DEFAULT '{}'::jsonb,
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
        mime TEXT,
        bytes INT,
        file_data BYTEA,
        extracted_text TEXT,
        extracted_fields JSONB DEFAULT '[]'::jsonb,
        uploaded_at TIMESTAMP DEFAULT now()
      );
    `);
    
    console.log("✅ Tables DCF créées/vérifiées");
  } catch (e) {
    console.error("❌ Erreur création tables:", e.message);
  }
}

ensureMemoryTables();

// -----------------------------------------------------------------------------
// 9. ROUTES - WIZARD v8
// -----------------------------------------------------------------------------

// POST /api/dcf/startSession
app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const { title = "Session DCF v8" } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO dcf_sessions (title) VALUES ($1) RETURNING id`,
      [title]
    );
    res.json({ ok: true, sessionId: rows[0].id });
  } catch (e) {
    console.error("startSession error:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dcf/sessions
app.get("/api/dcf/sessions", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM dcf_sessions ORDER BY created_at DESC LIMIT 20`);
    res.json({ ok: true, sessions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dcf/wizard/analyze - ÉTAPE 1 avec images SAP
app.post("/api/dcf/wizard/analyze", upload.array("screenshots"), async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const screenshots = req.files || [];

    console.log(`[analyze] Message: "${(message || "").substring(0, 100)}...", Screenshots: ${screenshots.length}`);

    // 1. Extraire données des images SAP si présentes
    let sapData = { extracted: [], raw_texts: [] };
    if (screenshots.length > 0) {
      try {
        sapData = await extractSAPDataFromImages(screenshots);
        console.log(`[analyze] Extracted ${sapData.extracted.length} SAP fields`);
      } catch (visionErr) {
        console.error("[analyze] Vision error:", visionErr.message);
        // Continue sans les données vision
      }

      // Sauvegarder les attachments si sessionId
      if (sessionId) {
        for (const file of screenshots) {
          try {
            await pool.query(
              `INSERT INTO dcf_attachments (session_id, filename, mime, bytes, file_data, extracted_fields)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [sessionId, file.originalname, file.mimetype, file.size, file.buffer, JSON.stringify(sapData.extracted)]
            );
          } catch (dbErr) {
            console.warn("[analyze] Attachment save error:", dbErr.message);
          }
        }
      }
    }

    // 2. Détecter le use case
    const useCase = detectUseCase(message || "");
    const useCaseInfo = USE_CASE_MAPPING[useCase] || { description: "Cas non reconnu", dcf_required: [] };

    console.log(`[analyze] Use case: ${useCase}`);

    // 3. Enrichir avec les données du référentiel
    let refInfo = "";
    const planNumbers = sapData.extracted.filter(e => e.code === "WARPL").map(e => e.value);
    for (const pn of planNumbers) {
      const planInfo = findPlanInfo(pn);
      if (planInfo) {
        refInfo += `\nPlan ${pn}: TL Group=${planInfo.task_list_group}, Counter=${planInfo.counter_group}, Desc="${planInfo.description}"`;
      }
    }

    // 4. Récupérer les templates disponibles
    let recentFiles = [];
    try {
      const { rows } = await pool.query(
        `SELECT id, filename FROM dcf_files WHERE file_data IS NOT NULL ORDER BY uploaded_at DESC LIMIT ${MAX_FILES_LIBRARY}`
      );
      recentFiles = rows;
    } catch (dbErr) {
      console.warn("[analyze] DB query error:", dbErr.message);
    }

    // 5. Mapper DCF requis aux fichiers
    const required_files = [];
    for (const dcfType of useCaseInfo.dcf_required) {
      const matchingFile = recentFiles.find(f => {
        const fn = f.filename.toLowerCase();
        if (dcfType === "TASK_LIST") return fn.includes("task list") || fn.includes("tasklist") || fn.includes("task_list");
        if (dcfType === "MAINTENANCE_PLAN") return fn.includes("maintenance plan") || fn.includes("maintenanceplan") || fn.includes("maintenance_plan");
        if (dcfType === "EQUIPMENT") return fn.includes("equipment") || fn.includes("eqpt");
        return false;
      });

      if (matchingFile) {
        required_files.push({
          type: dcfType,
          template_filename: matchingFile.filename,
          file_id: matchingFile.id,
          rules: useCaseInfo.rules.filter(r => r.startsWith(dcfType))
        });
      }
    }

    // 6. Update session avec use case et SAP data
    if (sessionId) {
      try {
        await pool.query(
          `UPDATE dcf_sessions SET use_case = $1, sap_data = $2 WHERE id = $3`,
          [useCase, JSON.stringify(sapData), sessionId]
        );
      } catch (dbErr) {
        console.warn("[analyze] Session update error:", dbErr.message);
      }
    }

    const response = {
      action: useCase,
      description: useCaseInfo.description,
      is_manual: false,
      reasoning: `Cas détecté: ${useCaseInfo.description}. ${refInfo}`,
      required_files,
      sap_extracted: sapData.extracted,
      reference_info: refInfo,
      questions: []
    };

    // Ajouter questions de clarification si données manquantes
    if (useCase === "create_operation" && !sapData.extracted.find(e => e.code === "PLNNR")) {
      response.questions.push("Quel est le numéro du groupe Task List (PLNNR) ?");
    }
    if (useCase === "modify_operation" && !sapData.extracted.find(e => e.code === "VORNR")) {
      response.questions.push("Quel est le numéro de l'opération à modifier (10, 20, 30...) ?");
    }

    console.log(`[analyze] Response: ${required_files.length} files, ${sapData.extracted.length} SAP fields`);
    res.json(response);
  } catch (e) {
    console.error("[analyze] Error:", e);
    res.status(500).json({ error: e.message, stack: process.env.NODE_ENV === "development" ? e.stack : undefined });
  }
});

// POST /api/dcf/wizard/instructions - ÉTAPE 3
app.post("/api/dcf/wizard/instructions", upload.array("screenshots"), async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename, attachmentIds = [] } = req.body;
    const newScreenshots = req.files || [];

    // 1. Récupérer le template
    const { rows } = await pool.query(
      `SELECT id, filename, analysis, file_data FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Template introuvable." });
    }

    const file = rows[0];
    const analysis = file.file_data ? buildDeepExcelAnalysis(file.file_data, file.filename) : null;

    // 2. Récupérer session data
    let sessionData = { sap_data: { extracted: [] } };
    if (sessionId) {
      const { rows: sessRows } = await pool.query(`SELECT * FROM dcf_sessions WHERE id = $1`, [sessionId]);
      if (sessRows.length) sessionData = sessRows[0];
    }

    // 3. Extraire données des nouvelles images
    let newSapData = { extracted: [], raw_texts: [] };
    if (newScreenshots.length > 0) {
      newSapData = await extractSAPDataFromImages(newScreenshots);

      // Sauvegarder
      for (const file of newScreenshots) {
        await pool.query(
          `INSERT INTO dcf_attachments (session_id, filename, mime, bytes, file_data, extracted_fields)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sessionId, file.originalname, file.mimetype, file.size, file.buffer, JSON.stringify(newSapData.extracted)]
        );
      }
    }

    // 4. Récupérer attachments existants
    let existingExtracted = [];
    const parsedAttachmentIds = typeof attachmentIds === 'string' ? JSON.parse(attachmentIds) : attachmentIds;
    if (parsedAttachmentIds.length) {
      const { rows: attRows } = await pool.query(
        `SELECT extracted_fields FROM dcf_attachments WHERE id = ANY($1::int[])`,
        [parsedAttachmentIds]
      );
      for (const att of attRows) {
        if (att.extracted_fields) {
          existingExtracted.push(...(Array.isArray(att.extracted_fields) ? att.extracted_fields : []));
        }
      }
    }

    // 5. Fusionner toutes les données SAP extraites
    const allSapData = [
      ...(sessionData.sap_data?.extracted || []),
      ...existingExtracted,
      ...newSapData.extracted
    ];

    // 6. Déterminer le type de DCF et les règles
    const useCase = sessionData.use_case || detectUseCase(requestText);
    const useCaseInfo = USE_CASE_MAPPING[useCase] || {};

    // Déterminer le type de template
    let templateType = "TASK_LIST";
    const fnLower = templateFilename.toLowerCase();
    if (fnLower.includes("equipment") || fnLower.includes("eqpt")) templateType = "EQUIPMENT";
    else if (fnLower.includes("maintenance plan") || fnLower.includes("maintenanceplan")) templateType = "MAINTENANCE_PLAN";

    // 7. Construire les règles de colonnes
    const applicableRules = useCaseInfo.rules?.filter(r => r.startsWith(templateType)) || [];
    let columnsToFill = {};
    
    for (const rulePath of applicableRules) {
      const [type, action] = rulePath.split(".");
      if (BUSINESS_RULES[type]?.[action]?.columns) {
        columnsToFill = { ...columnsToFill, ...BUSINESS_RULES[type][action].columns };
      }
    }

    // 8. Dropdowns
    const dropdowns = getDropdownsForTemplate(templateFilename);
    const dropdownBlock = dropdowns.map(d => `- ${d.listName}: ${d.values.slice(0, 50).join(", ")}`).join("\n");

    // 9. Référentiel info
    let refInfo = "";
    const planNumber = allSapData.find(e => e.code === "WARPL")?.value;
    if (planNumber) {
      const planInfo = findPlanInfo(planNumber);
      if (planInfo) {
        refInfo = `\nPlan ${planNumber}: TL Group=${planInfo.task_list_group}, Counter=${planInfo.counter_group}`;
      }
    }

    // 10. Prompt IA
    const sapDataStr = allSapData.map(e => `${e.code}=${e.value}`).join(", ");

    const prompt = `
Tu es un Expert SAP DCF. Tu dois générer les instructions de remplissage pour un fichier DCF.

DEMANDE: "${requestText}"

CAS D'USAGE DÉTECTÉ: ${useCase} - ${useCaseInfo.description || ""}

TEMPLATE: ${templateFilename} (Type: ${templateType})

STRUCTURE TEMPLATE:
${analysis?.ai_context || "N/A"}

DONNÉES SAP EXTRAITES DES CAPTURES:
${sapDataStr || "Aucune donnée extraite"}

RÉFÉRENTIEL TASK LIST:
${refInfo || "N/A"}

COLONNES OBLIGATOIRES POUR CE CAS:
${Object.entries(columnsToFill).map(([col, info]) => `${col}: ${info.code} - ${info.label || ""} ${info.mandatory ? "(OBLIGATOIRE)" : "(optionnel)"} ${info.value ? `= "${info.value}"` : ""}`).join("\n")}

LISTES DÉROULANTES:
${dropdownBlock || "N/A"}

RÈGLES IMPORTANTES:
- Short Text (LTXA1, KTEXT): max 40 caractères
- Long Text (LTXA2): pas de limite
- N° Opération (VORNR): 10, 20, 30... (incréments de 10)
- Counter (PLNAL): 1, 2, 3...
- ACTION: Create, Change, Delete uniquement
- System Condition: I = Intrusive, N = Non-intrusive

GÉNÈRE les instructions ligne par ligne en JSON:
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
    }
  ],
  "missing_data": ["Liste des données manquantes à demander"]
}
`;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Expert SAP DCF v8. Génère des instructions précises." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const out = cleanJSON(completion.choices[0].message.content);
    const steps = Array.isArray(out.steps) ? out.steps : [];

    // 11. Post-traitement: marquer les champs éditables
    const processedSteps = steps.map(s => ({
      ...s,
      editable: !s.value || s.mandatory === false
    }));

    res.json({
      steps: processedSteps,
      missing_data: out.missing_data || [],
      sap_extracted: allSapData,
      template_type: templateType,
      use_case: useCase
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dcf/wizard/autofill - Générer le fichier rempli
app.post("/api/dcf/wizard/autofill", async (req, res) => {
  try {
    const { templateFilename, instructions } = req.body;

    const { rows } = await pool.query(
      `SELECT filename, mime, file_data FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Template introuvable." });
    }

    const tpl = rows[0];
    const wb = xlsx.read(tpl.file_data, { type: "buffer" });
    const steps = Array.isArray(instructions) ? instructions : [];

    for (const inst of steps) {
      const sheetName = inst.sheet && wb.Sheets[inst.sheet] ? inst.sheet : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const cellAddress = `${inst.col}${inst.row}`;
      ws[cellAddress] = { t: "s", v: String(inst.value ?? "") };
    }

    const isXlsm = String(tpl.filename).toLowerCase().endsWith(".xlsm");
    const outBuffer = xlsx.write(wb, { type: "buffer", bookType: isXlsm ? "xlsm" : "xlsx" });

    res.setHeader("Content-Type", isXlsm ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="FILLED_${sanitizeName(tpl.filename)}"`);
    res.send(outBuffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dcf/wizard/validate
app.post("/api/dcf/wizard/validate", async (req, res) => {
  try {
    const { fileIds, useCase = null } = req.body;

    if (!Array.isArray(fileIds) || !fileIds.length) {
      return res.status(400).json({ error: "fileIds manquant." });
    }

    const { rows: files } = await pool.query(
      `SELECT id, filename, file_data FROM dcf_files WHERE id = ANY($1::int[])`,
      [fileIds]
    );

    if (!files.length) {
      return res.status(404).json({ error: "Aucun fichier trouvé." });
    }

    // Analyser chaque fichier
    const analyses = files.map(f => {
      const analysis = f.file_data ? buildDeepExcelAnalysis(f.file_data, f.filename) : null;
      return { id: f.id, filename: f.filename, analysis };
    });

    // Extraire les lignes avec ACTION
    const activeRows = [];
    for (const a of analyses) {
      if (!a.analysis) continue;
      for (const [key, row] of Object.entries(a.analysis.rows_index)) {
        const action = row.ACTION || row.ACTION_01 || row.ACTION_02;
        if (action && ["create", "change", "delete"].includes(String(action).toLowerCase())) {
          activeRows.push({ file: a.filename, key, action, row });
        }
      }
    }

    if (!activeRows.length) {
      return res.json({
        report: "Aucune ligne avec ACTION SAP détectée (Create/Change/Delete).",
        critical: [],
        warnings: ["Vérifiez que la colonne ACTION est remplie."],
        suggestions: []
      });
    }

    // Validation basée sur les règles métier
    const critical = [];
    const warnings = [];
    const suggestions = [];

    for (const ar of activeRows) {
      const row = ar.row;
      const action = String(ar.action).toLowerCase();

      // Task List validations
      if (ar.file.toLowerCase().includes("task")) {
        if (action === "create") {
          if (!row.PLNNR && !row.N) critical.push(`[${ar.key}] PLNNR (N° Groupe TL) manquant pour Create`);
          if (!row.PLNAL && !row.P) warnings.push(`[${ar.key}] PLNAL (Counter) non renseigné`);
          if (!row.VORNR && !row.AG) warnings.push(`[${ar.key}] VORNR (N° Opération) non renseigné`);
          if (!row.LTXA1 && !row.AJ) critical.push(`[${ar.key}] LTXA1 (Short Text) obligatoire pour Create`);
        }
        if (action === "change") {
          if (!row.PLNNR && !row.N) critical.push(`[${ar.key}] PLNNR requis pour Change`);
          if (!row.VORNR && !row.AG) critical.push(`[${ar.key}] VORNR requis pour identifier l'opération`);
        }
      }

      // Maintenance Plan validations
      if (ar.file.toLowerCase().includes("maintenance") || ar.file.toLowerCase().includes("plan")) {
        if (action === "create") {
          if (!row.WPTXT && !row.Q) critical.push(`[${ar.key}] WPTXT (Nom plan) obligatoire`);
          if (!row.PLNNR && !row.AJ) critical.push(`[${ar.key}] Référence Task List (PLNNR) obligatoire`);
        }
        if (action === "change") {
          if (!row.WARPL && !row.J) critical.push(`[${ar.key}] WARPL (N° Plan) requis pour Change`);
        }
      }

      // Equipment validations
      if (ar.file.toLowerCase().includes("equipment") || ar.file.toLowerCase().includes("eqpt")) {
        if (action === "create") {
          if (!row.EQTYP && !row.O) warnings.push(`[${ar.key}] Object Type/Criticité recommandé`);
          if (!row.TPLNR && !row.AR) critical.push(`[${ar.key}] Functional Location obligatoire`);
        }
      }
    }

    res.json({
      report: `Validation de ${activeRows.length} ligne(s) avec ACTION.`,
      critical,
      warnings,
      suggestions: suggestions.length ? suggestions : ["Vérifiez les valeurs avant import SAP."]
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dcf/attachments/upload - Upload screenshots seul
app.post("/api/dcf/attachments/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files || [];
    const sessionId = req.body?.sessionId || null;

    if (!files.length) {
      return res.status(400).json({ error: "Aucun fichier." });
    }

    const items = [];
    for (const f of files) {
      const sapData = await extractSAPDataFromImages([f]);

      const { rows } = await pool.query(
        `INSERT INTO dcf_attachments (session_id, filename, mime, bytes, file_data, extracted_fields)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename`,
        [sessionId, f.originalname, f.mimetype, f.size, f.buffer, JSON.stringify(sapData.extracted)]
      );

      items.push({
        id: rows[0].id,
        filename: rows[0].filename,
        extracted: sapData.extracted
      });
    }

    res.json({ ok: true, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// 10. FILE MANAGEMENT ROUTES
// -----------------------------------------------------------------------------

app.post("/api/dcf/uploadExcel", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier." });

    const analysis = buildDeepExcelAnalysis(req.file.buffer, req.file.originalname);
    const storedName = `${Date.now()}_${sanitizeName(req.file.originalname)}`;

    const { rows } = await pool.query(
      `INSERT INTO dcf_files (filename, stored_name, mime, bytes, sheet_names, analysis, file_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, filename, uploaded_at`,
      [req.file.originalname, storedName, req.file.mimetype, req.file.size, analysis.sheetNames, { ai_context: analysis.ai_context, sheets: analysis.sheets }, req.file.buffer]
    );

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/dcf/uploadExcelMulti", upload.array("files"), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Aucun fichier." });

    const out = [];
    for (const f of files) {
      const analysis = buildDeepExcelAnalysis(f.buffer, f.originalname);
      const storedName = `${Date.now()}_${sanitizeName(f.originalname)}`;

      const { rows } = await pool.query(
        `INSERT INTO dcf_files (filename, stored_name, mime, bytes, sheet_names, analysis, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, filename, uploaded_at`,
        [f.originalname, storedName, f.mimetype, f.size, analysis.sheetNames, { ai_context: analysis.ai_context, sheets: analysis.sheets }, f.buffer]
      );

      out.push(rows[0]);
    }

    res.json({ ok: true, files: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dcf/files", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, uploaded_at FROM dcf_files WHERE file_data IS NOT NULL ORDER BY uploaded_at DESC LIMIT 50`
    );
    res.json({ ok: true, files: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dcf/files/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

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

app.get("/api/dcf/files/:id/debug", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query("SELECT filename, file_data FROM dcf_files WHERE id=$1", [id]);

    if (!rows.length) return res.status(404).json({ error: "File not found" });

    const file = rows[0];
    const analysis = buildDeepExcelAnalysis(file.file_data, file.filename);

    res.json({
      filename: file.filename,
      sheets: analysis.sheets,
      ai_context: analysis.ai_context,
      sample_values: analysis.extracted_values.slice(0, 50)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Référentiel Task List
app.get("/api/dcf/reference/tasklists", (req, res) => {
  res.json({
    ok: true,
    maintenance_plans: TASKLIST_REF?.maintenance_plans || [],
    task_list_groups: TASKLIST_REF?.task_list_groups || []
  });
});

app.get("/api/dcf/reference/plan/:planNumber", (req, res) => {
  const info = findPlanInfo(req.params.planNumber);
  if (!info) return res.status(404).json({ error: "Plan non trouvé dans le référentiel" });
  res.json({ ok: true, plan: info });
});

// Chat générique
app.post("/api/dcf/chat", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Assistant SAP DCF expert." },
        { role: "user", content: req.body.message }
      ]
    });
    res.json({ ok: true, answer: completion.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dcf/health", (req, res) => {
  res.json({
    status: "ok",
    version: "8.0.1",
    features: ["vision_step1", "business_rules", "tasklist_reference", "editable_values", "csp_blob_fix"]
  });
});

// -----------------------------------------------------------------------------
// 11. START
// -----------------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v8.0.1] Backend démarré sur http://${HOST}:${PORT}`);
});
