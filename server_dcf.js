// server_dcf.js — Assistant DCF SAP v9.0.0
// =============================================================================
// REFONTE COMPLÈTE avec corrections:
// - Fix colonnes DB manquantes (extracted_fields, use_case)
// - Extraction Vision améliorée (opérations existantes, work center, type travail)
// - Calcul automatique prochain N° opération
// - Mapping colonnes précis par type DCF (basé sur documentation Word)
// - Logique métier stricte TL/PM/EQPT
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
const MAX_CONTEXT_CHARS = 15000;

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
// 2. MAPPING COLONNES DCF PAR TYPE (basé sur documentation Word)
// =============================================================================

const DCF_COLUMNS = {
  // -------------------------------------------------------------------------
  // DCF TASK LIST
  // -------------------------------------------------------------------------
  TASK_LIST: {
    // Modifier une opération existante (IP18)
    CHANGE_OPERATION: {
      action: "Change",
      description: "Modifier une opération existante sur un plan (IP18)",
      columns: {
        I: { code: "ACTION", value: "Change", label: "Action SAP", mandatory: true },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true },
        P: { code: "PLNAL", label: "Counter (1, 2, 3...)", mandatory: true },
        Q: { code: "KTEXT", label: "Nom du plan de maintenance", mandatory: false },
        R: { code: "LTXA2", label: "Long text", mandatory: false },
        T: { code: "ARBPL", label: "Work Center / Groupe", mandatory: true },
        X: { code: "SYSTC", label: "Intrusive (I) / Non-intrusive (N)", mandatory: false },
        AG: { code: "VORNR", label: "N° Opération (10, 20, 30...)", mandatory: true },
        AJ: { code: "LTXA1", label: "Short Text (40 chars max)", mandatory: false },
        AK: { code: "LTXA2_OP", label: "Long text opération", mandatory: false },
        AL: { code: "DAESSION", label: "Temps passé / Durée", mandatory: false },
        AN: { code: "ANZMA", label: "Nombre de personnes", mandatory: false }
      }
    },
    
    // Créer une nouvelle opération sur plan existant
    CREATE_OPERATION: {
      action: "Create",
      description: "Ajouter une nouvelle opération sur un plan existant (IP18)",
      columns: {
        I: { code: "ACTION", value: "Create", label: "Action SAP", mandatory: true },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true },
        P: { code: "PLNAL", label: "Counter (1, 2, 3...)", mandatory: true },
        Q: { code: "KTEXT", label: "Nom du plan de maintenance", mandatory: true },
        R: { code: "LTXA2", label: "Long text", mandatory: false },
        T: { code: "ARBPL", label: "Work Center / Groupe", mandatory: true },
        X: { code: "SYSTC", label: "Intrusive (I) / Non-intrusive (N)", mandatory: true },
        AG: { code: "VORNR", label: "N° Opération (10, 20, 30...)", mandatory: true },
        AJ: { code: "LTXA1", label: "Short Text (40 chars max)", mandatory: true },
        AK: { code: "LTXA2_OP", label: "Long text opération", mandatory: false },
        AL: { code: "DAESSION", label: "Temps passé / Durée", mandatory: true },
        AN: { code: "ANZMA", label: "Nombre de personnes", mandatory: false },
        AV: { code: "SYSTC2", label: "Intrusive (I) / Non-intrusive (N)", mandatory: false }
      }
    },
    
    // Supprimer une opération
    DELETE_OPERATION: {
      action: "Delete",
      description: "Supprimer une opération",
      columns: {
        I: { code: "ACTION", value: "Delete", label: "Action SAP", mandatory: true },
        N: { code: "PLNNR", label: "N° Groupe Task List", mandatory: true },
        P: { code: "PLNAL", label: "Counter", mandatory: true },
        AG: { code: "VORNR", label: "N° Opération à supprimer", mandatory: true }
      }
    }
  },

  // -------------------------------------------------------------------------
  // DCF MAINTENANCE PLAN (PM)
  // -------------------------------------------------------------------------
  MAINTENANCE_PLAN: {
    // Modifier un plan existant (pour ajouter équipement)
    CHANGE_PLAN: {
      action: "Change",
      description: "Modifier un plan de maintenance existant",
      columns: {
        I: { code: "ACTION", value: "Change", label: "Action SAP", mandatory: true },
        J: { code: "WARPL", label: "N° Plan de maintenance", mandatory: true },
        W: { code: "ACTION_ITEM", label: "Action Item (Create pour nouvel équipement)", mandatory: false }
      }
    },
    
    // Créer un nouveau plan
    CREATE_PLAN: {
      action: "Create",
      description: "Créer un nouveau plan de maintenance",
      columns: {
        I: { code: "ACTION", value: "Create", label: "Action SAP", mandatory: true },
        E: { code: "STRAT", label: "Stratégie", mandatory: false },
        Q: { code: "WPTXT", label: "Nom du plan", mandatory: true },
        S: { code: "ZYKL1", label: "Cycle (1=année, 12=mois)", mandatory: true },
        U: { code: "ZYKLTEXT", label: "Texte cycle (ex: tous les 2 ans)", mandatory: false },
        AA: { code: "TPLNR", label: "Functional Location ou Equipment", mandatory: true },
        AE: { code: "INGRP", label: "Type de maintenance", mandatory: false },
        AJ: { code: "PLNNR_REF", label: "Nom Task List associée", mandatory: true },
        BC: { code: "NESSION", label: "Date premier WO (date - cycle)", mandatory: false }
      }
    },
    
    // Supprimer un plan
    DELETE_PLAN: {
      action: "Delete",
      description: "Supprimer un plan de maintenance",
      columns: {
        I: { code: "ACTION", value: "Delete", label: "Action SAP", mandatory: true },
        J: { code: "WARPL", label: "N° Plan à supprimer", mandatory: true }
      }
    }
  },

  // -------------------------------------------------------------------------
  // DCF EQUIPMENT (EQPT)
  // -------------------------------------------------------------------------
  EQUIPMENT: {
    // Créer un nouvel équipement
    CREATE_EQUIPMENT: {
      action: "Create",
      description: "Créer un nouvel équipement",
      columns: {
        I: { code: "ACTION", value: "Create", label: "Action SAP", mandatory: true },
        O: { code: "KRIT", label: "Criticité (toujours la plus haute)", mandatory: true },
        P: { code: "USTATUS", label: "Statut (ISER = en service)", mandatory: true, value: "ISER" },
        Y: { code: "HERST", label: "Manufacturer", mandatory: false },
        AA: { code: "TYPBZ", label: "Model number", mandatory: false },
        AD: { code: "SERGE", label: "Serial Number", mandatory: false },
        AH: { code: "EQART", label: "Plan section", mandatory: true },
        AJ: { code: "ABCKZ", label: "ABC Indicator", mandatory: true },
        AM: { code: "KOSTL", label: "Cost center", mandatory: true },
        AP: { code: "INGRP", label: "Service", mandatory: true },
        AQ: { code: "SWERK", label: "Site", mandatory: true },
        AR: { code: "TPLNR", label: "Functional Location", mandatory: true },
        AT: { code: "SUBMESSION", label: "Mettre Next", mandatory: false, value: "Next" },
        AW: { code: "GRESSION", label: "Grouping key (PRT6 = General equipment)", mandatory: true, value: "PRT6" },
        BD: { code: "EQTYP", label: "Type d'équipement", mandatory: false }
      }
    },
    
    // Modifier un équipement
    CHANGE_EQUIPMENT: {
      action: "Change",
      description: "Modifier un équipement existant",
      columns: {
        I: { code: "ACTION", value: "Change", label: "Action SAP", mandatory: true },
        J: { code: "EQUNR", label: "N° Équipement", mandatory: true }
        // + colonnes à modifier selon besoin
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
    description: "Modifier une opération existante (IP18)",
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
  delete_plan: {
    description: "Supprimer un plan de maintenance",
    dcf_required: ["MAINTENANCE_PLAN"],
    dcf_actions: { MAINTENANCE_PLAN: "DELETE_PLAN" }
  },
  
  // Équipements
  add_equipment_to_plan: {
    description: "Ajouter un équipement dans un plan existant",
    dcf_required: ["MAINTENANCE_PLAN", "EQUIPMENT"],
    dcf_actions: { MAINTENANCE_PLAN: "CHANGE_PLAN", EQUIPMENT: "CREATE_EQUIPMENT" }
  },
  create_equipment: {
    description: "Créer un nouvel équipement",
    dcf_required: ["EQUIPMENT"],
    dcf_actions: { EQUIPMENT: "CREATE_EQUIPMENT" }
  },
  change_equipment: {
    description: "Modifier un équipement existant",
    dcf_required: ["EQUIPMENT"],
    dcf_actions: { EQUIPMENT: "CHANGE_EQUIPMENT" }
  },
  
  // Fallback
  unknown: {
    description: "Action non reconnue - assistance manuelle",
    dcf_required: [],
    dcf_actions: {}
  }
};

// =============================================================================
// 4. DÉTECTION DU CAS D'USAGE
// =============================================================================

function detectUseCase(message) {
  const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Suppression
  if (/(supprimer|delete|retirer|enlever).*(operation|opération)/.test(m)) {
    return "delete_operation";
  }
  if (/(supprimer|delete|retirer|enlever).*(plan|maintenance)/.test(m)) {
    return "delete_plan";
  }
  
  // Création opération sur plan existant
  if (/(ajouter|creer|créer|nouvelle|nouveau|add|create).*(operation|opération).*(plan|maintenance|existant)/.test(m)) {
    return "create_operation";
  }
  if (/(ajouter|creer|créer|nouvelle|nouveau).*(operation|opération)/.test(m)) {
    return "create_operation";
  }
  
  // Modification opération
  if (/(modifier|changer|change|update|modif).*(operation|opération)/.test(m)) {
    return "change_operation";
  }
  
  // Création plan complet
  if (/(creer|créer|nouveau|nouvelle|create).*(plan).*(maintenance|complet)/.test(m)) {
    return "create_plan";
  }
  if (/(creer|créer|nouveau|nouvelle).*(plan)/.test(m)) {
    return "create_plan";
  }
  
  // Modification plan
  if (/(modifier|changer|change).*(plan)/.test(m)) {
    return "change_plan";
  }
  
  // Équipements
  if (/(ajouter|affecter|rattacher|associer).*(equipement|équipement).*(plan)/.test(m)) {
    return "add_equipment_to_plan";
  }
  if (/(creer|créer|nouveau|nouvelle|create).*(equipement|équipement)/.test(m)) {
    return "create_equipment";
  }
  if (/(modifier|changer|change).*(equipement|équipement)/.test(m)) {
    return "change_equipment";
  }
  
  return "unknown";
}

// =============================================================================
// 5. EXTRACTION VISION SAP AMÉLIORÉE
// =============================================================================

const VISION_PROMPT = `Tu es un expert SAP PM/PM. Extrais TOUTES les données visibles dans cette capture SAP.

EXTRAIS SPÉCIFIQUEMENT:

1. IDENTIFIANTS PRINCIPAUX:
- N° Plan de maintenance (WARPL): 8 chiffres, ex: 30482333, 40052643
- N° Groupe Task List (PLNNR): ex: CH940104, 20036344
- N° Ordre (AUFNR): ex: 4097131
- N° Equipment (EQUNR): 10 chiffres, ex: 1000012345
- Functional Location (TPLNR): ex: CH94-UIN-EAUIND

2. LISTE DES OPÉRATIONS EXISTANTES (CRITIQUE):
Si tu vois un tableau d'opérations, extrais CHAQUE ligne avec:
- N° Opération (Opé.): 0010, 0020, 0030...
- Position travail / Work Center: FMEXUTIL, FMMANAGE, FMEXMAINT...
- Description de l'opération
- Division (CH94, etc.)

3. DONNÉES DE PLANIFICATION:
- Type d'ordre: ZM02, ZM01...
- Division planification (Div. planif.): CH94
- PosteTravPrinc (Work Center principal): FMMANAGE, etc.
- Type de travail (VAGR): P1, P2, P3...
- Groupe gamme (Groupe gamme): CH940104
- Counter: 1, 2, 3...
- Priorité: 1-haut, 2, 3, 4-bas

4. AUTRES DONNÉES:
- Nom/Description du plan
- Short Text / Long Text
- Durées, temps
- Nombres de personnes
- Intrusive (I) / Non-intrusive (N)
- Statuts système

Réponds UNIQUEMENT en JSON valide:
{
  "extracted_fields": [
    {"code": "WARPL", "value": "30482333", "label": "N° Plan maintenance", "confidence": "high"},
    {"code": "PLNNR", "value": "CH940104", "label": "N° Groupe Task List", "confidence": "high"},
    {"code": "AUFNR", "value": "4097131", "label": "N° Ordre", "confidence": "high"},
    {"code": "MAIN_WORK_CENTER", "value": "FMMANAGE", "label": "Work Center principal", "confidence": "high"},
    {"code": "WORK_TYPE", "value": "P2", "label": "Type de travail", "confidence": "high"}
  ],
  "existing_operations": [
    {"number": "0010", "work_center": "FMEXUTIL", "description": "VIDANGER LES FOSSES A GRAISSES", "division": "CH94"},
    {"number": "0020", "work_center": "FMMANAGE", "description": "Envoi des bons de destruction à la DGE", "division": "CH94"}
  ],
  "plan_name": "Nettoyage EI B20-B23 - #50193+51157",
  "raw_text": "texte brut visible si pertinent"
}`;

async function extractSAPDataFromImages(images = []) {
  if (!images.length) {
    return { extracted: [], existing_operations: [], raw_texts: [] };
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️ OPENAI_API_KEY manquante - Vision désactivée");
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
        // Déjà en base64
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

      console.log(`[Vision] Analyse image (${mime}, ${b64.length} chars base64)...`);

      const completion = await openai.chat.completions.create({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrais toutes les données SAP de cette capture. Fais particulièrement attention aux opérations existantes et au Work Center principal." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
            ]
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.0,
        max_tokens: 2000
      });

      const content = completion.choices[0].message.content;
      console.log(`[Vision] Réponse brute: ${content.substring(0, 200)}...`);
      
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

  // Dédupliquer les opérations par numéro
  const uniqueOps = [];
  const seenOps = new Set();
  for (const op of allOperations) {
    const key = op.number || op.vornr;
    if (key && !seenOps.has(key)) {
      seenOps.add(key);
      uniqueOps.push(op);
    }
  }

  // Trier par numéro d'opération
  uniqueOps.sort((a, b) => {
    const numA = parseInt(a.number || a.vornr || "0", 10);
    const numB = parseInt(b.number || b.vornr || "0", 10);
    return numA - numB;
  });

  console.log(`[Vision] Extraction terminée: ${allExtracted.length} champs, ${uniqueOps.length} opérations`);

  return { 
    extracted: allExtracted, 
    existing_operations: uniqueOps,
    plan_name: planName,
    raw_texts: rawTexts 
  };
}

// =============================================================================
// 6. FONCTIONS UTILITAIRES POUR LES VALEURS CONTEXTUELLES
// =============================================================================

/**
 * Calcule le prochain numéro d'opération basé sur les opérations existantes
 */
function calculateNextOperationNumber(existingOperations = []) {
  if (!existingOperations || !existingOperations.length) return "10";
  
  const numbers = existingOperations
    .map(op => {
      const num = op.number || op.vornr || "0";
      return parseInt(String(num).replace(/^0+/, ""), 10);
    })
    .filter(n => !isNaN(n) && n > 0);
  
  if (!numbers.length) return "10";
  
  const maxOp = Math.max(...numbers);
  // Arrondir au multiple de 10 supérieur
  const nextOp = Math.ceil((maxOp + 1) / 10) * 10;
  
  return String(nextOp);
}

/**
 * Détermine le Work Center approprié basé sur les données extraites
 */
function determineWorkCenter(sapData) {
  // Priorité 1: Work Center principal (PosteTravPrinc)
  const mainWC = sapData.extracted?.find(e => 
    e.code === "MAIN_WORK_CENTER" || e.code === "ARBPL_MAIN" || e.code === "PosteTravPrinc"
  );
  if (mainWC?.value) return mainWC.value;
  
  // Priorité 2: Le plus fréquent dans les opérations existantes
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
  
  return null; // Laisser null plutôt que mettre une valeur incorrecte
}

/**
 * Détermine le type de travail (P1, P2, P3...)
 */
function determineWorkType(sapData) {
  const workType = sapData.extracted?.find(e => 
    e.code === "WORK_TYPE" || e.code === "VAGR" || e.code === "VAGRP" || e.code === "Type de travail"
  );
  if (workType?.value) return workType.value;
  
  return null;
}

/**
 * Extrait une valeur spécifique des données SAP
 */
function getSapValue(sapData, ...codes) {
  for (const code of codes) {
    const field = sapData.extracted?.find(e => e.code === code);
    if (field?.value) return field.value;
  }
  return null;
}

/**
 * Construit le contexte pour la génération d'instructions
 */
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
  
  // Extraire les identifiants
  context.planNumber = getSapValue(sapData, "WARPL", "Plan de maintenance");
  context.taskListGroup = getSapValue(sapData, "PLNNR", "Groupe Task List", "Groupe gamme");
  context.counter = getSapValue(sapData, "PLNAL", "Counter") || "1";
  context.division = getSapValue(sapData, "WERKS", "Division", "Div. planif.") || "CH94";
  
  // Chercher dans le texte de la demande
  const planMatch = requestText.match(/plan[s]?\s*(?:de maintenance)?\s*(\d{7,8})/i);
  if (planMatch && !context.planNumber) {
    context.planNumber = planMatch[1];
  }
  
  // Extraire le nom du plan depuis les opérations si disponible
  if (!context.planName && sapData.existing_operations?.length) {
    const firstOp = sapData.existing_operations[0];
    if (firstOp.description) {
      context.planName = firstOp.description;
    }
  }
  
  return context;
}

// =============================================================================
// 7. UTILITAIRES
// =============================================================================

function cleanJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    // Essayer de nettoyer
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
// 8. CHARGEMENT RÉFÉRENTIELS
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
        // Adapter selon la structure de ton fichier
        if (row["N° Plan"] || row["WARPL"]) {
          TASKLIST_REF.maintenance_plans.push({
            warpl: row["N° Plan"] || row["WARPL"],
            plnnr: row["N° Groupe"] || row["PLNNR"],
            description: row["Description"] || row["Nom"],
            counter: row["Counter"] || row["PLNAL"] || "1"
          });
        }
        if (row["N° Groupe"] || row["PLNNR"]) {
          TASKLIST_REF.task_list_groups.push({
            plnnr: row["N° Groupe"] || row["PLNNR"],
            description: row["Description"] || row["Nom"]
          });
        }
      }
      
      console.log(`✅ Référentiel Task List chargé: ${TASKLIST_REF.maintenance_plans.length} plans`);
    } else {
      console.log("ℹ️ Fichier Suivi_Task_List.xlsx non trouvé");
    }
  } catch (e) {
    console.error("❌ Erreur chargement référentiel:", e.message);
  }
}

function loadDropdowns() {
  try {
    if (fs.existsSync(DROPDOWN_CSV_PATH)) {
      const content = fs.readFileSync(DROPDOWN_CSV_PATH, "utf-8");
      const lines = content.split("\n").filter(l => l.trim());
      
      for (const line of lines.slice(1)) { // Skip header
        const parts = line.split(";");
        if (parts.length >= 2) {
          const col = parts[0].trim();
          const values = parts.slice(1).map(v => v.trim()).filter(v => v);
          if (values.length) {
            DROPDOWNS[col] = values;
          }
        }
      }
      
      console.log(`✅ Listes déroulantes chargées: ${Object.keys(DROPDOWNS).length} colonnes`);
    }
  } catch (e) {
    console.error("❌ Erreur chargement dropdowns:", e.message);
  }
}

function findPlanInfo(planNumber) {
  if (!TASKLIST_REF) return null;
  return TASKLIST_REF.maintenance_plans.find(p => 
    String(p.warpl) === String(planNumber) || 
    String(p.plnnr) === String(planNumber)
  );
}

// Charger au démarrage
loadTaskListReference();
loadDropdowns();

// =============================================================================
// 9. ANALYSE EXCEL
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

    // Trouver la ligne d'en-tête (chercher "ACTION" ou codes DCF)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (row.some(cell => /^(ACTION|DCFACTION|PLNNR|WARPL|EQUNR)/i.test(String(cell)))) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      // Essayer de trouver par position connue (ligne 5 souvent)
      headerRowIdx = 4;
    }

    const headers = rows[headerRowIdx] || [];
    const dataStartIdx = headerRowIdx + 1;

    // Mapper colonnes
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

    // Extraire quelques valeurs d'exemple
    const sampleRows = rows.slice(dataStartIdx, dataStartIdx + 5);
    sampleRows.forEach((row, rowOffset) => {
      const rowNumber = dataStartIdx + rowOffset + 1;
      const rowKey = `${sheetName}:${rowNumber}`;
      
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

    // Contexte pour IA
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
// 10. DATABASE SETUP
// =============================================================================

async function ensureMemoryTables() {
  try {
    // Table des fichiers DCF templates
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

    // Table des sessions wizard
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

    // Table des messages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dcf_messages (
        id SERIAL PRIMARY KEY,
        session_id INT REFERENCES dcf_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    // Table des pièces jointes (screenshots)
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
    
    // Ajouter les colonnes si elles n'existent pas (pour migration)
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
                       WHERE table_name = 'dcf_sessions' AND column_name = 'template_type') THEN
          ALTER TABLE dcf_sessions ADD COLUMN template_type VARCHAR(50);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dcf_attachments' AND column_name = 'extracted_fields') THEN
          ALTER TABLE dcf_attachments ADD COLUMN extracted_fields JSONB DEFAULT '[]'::jsonb;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dcf_attachments' AND column_name = 'stored_name') THEN
          ALTER TABLE dcf_attachments ADD COLUMN stored_name TEXT;
        END IF;
      END $$;
    `);
    
    console.log("✅ Tables DCF créées/migrées avec succès");
  } catch (e) {
    console.error("❌ Erreur création tables:", e.message);
  }
}

ensureMemoryTables();

// =============================================================================
// 11. ROUTES API - FICHIERS
// =============================================================================

app.post("/api/dcf/upload", upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Aucun fichier fourni." });

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
    console.error("[upload] Erreur:", e);
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

// =============================================================================
// 12. ROUTES API - WIZARD
// =============================================================================

// Créer une session
app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const { title } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO dcf_sessions (title) VALUES ($1) RETURNING id, title, created_at`,
      [title || "Session DCF"]
    );
    res.json({ ok: true, session: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 2: Analyse demande + screenshots → détection use case
app.post("/api/dcf/wizard/analyze", upload.array("screenshots", 10), async (req, res) => {
  try {
    // CORRECTION : Récupération de message OU requestText pour gérer les deux formats frontend
    const { sessionId, requestText, message } = req.body;
    const textToAnalyze = requestText || message || "";
    
    const screenshots = req.files || [];

    console.log(`[analyze] Message: "${textToAnalyze.substring(0, 100)}...", Screenshots: ${screenshots.length}`);

    // 1. Extraire données SAP des screenshots
    const sapData = await extractSAPDataFromImages(screenshots);
    console.log(`[analyze] Extracted ${sapData.extracted?.length || 0} SAP fields`);

    // 2. Sauvegarder les screenshots en base
    for (const ss of screenshots) {
      try {
        // CORRECTION : Génération d'un stored_name pour satisfaire la contrainte NOT NULL
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

    // 3. Détecter le cas d'usage
    // CORRECTION : Utilisation de textToAnalyze au lieu de requestText qui était undefined
    const useCase = detectUseCase(textToAnalyze);
    const useCaseInfo = USE_CASES[useCase] || USE_CASES.unknown;
    console.log(`[analyze] Use case: ${useCase}`);

    // 4. Chercher info dans référentiel
    let refInfo = "";
    // CORRECTION : Utilisation de textToAnalyze
    const planNumber = getSapValue(sapData, "WARPL") || textToAnalyze.match(/(\d{7,8})/)?.[1];
    if (planNumber) {
      const planInfo = findPlanInfo(planNumber);
      if (planInfo) {
        refInfo = `Plan ${planNumber} trouvé: TL Group=${planInfo.plnnr}, Counter=${planInfo.counter}`;
      }
    }

    // 5. Mapper DCF requis aux fichiers disponibles
    const { rows: recentFiles } = await pool.query(
      `SELECT id, filename FROM dcf_files WHERE file_data IS NOT NULL ORDER BY uploaded_at DESC LIMIT ${MAX_FILES_LIBRARY}`
    );

    const required_files = [];
    for (const dcfType of useCaseInfo.dcf_required) {
      const matchingFile = recentFiles.find(f => {
        const fn = f.filename.toLowerCase();
        if (dcfType === "TASK_LIST") return fn.includes("task") || fn.includes("tl") || fn.includes("tasklist");
        if (dcfType === "MAINTENANCE_PLAN") return fn.includes("pm") || fn.includes("plan") || fn.includes("maintenance");
        if (dcfType === "EQUIPMENT") return fn.includes("eqpt") || fn.includes("equipment") || fn.includes("equip");
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

    // 7. Construire le contexte
    // CORRECTION : Utilisation de textToAnalyze
    const context = buildInstructionContext(sapData, useCase, textToAnalyze);

    const response = {
      action: useCase,
      description: useCaseInfo.description,
      is_manual: useCase === "unknown",
      reasoning: `Cas détecté: ${useCaseInfo.description}. ${refInfo}`,
      required_files,
      sap_extracted: sapData.extracted || [],
      existing_operations: sapData.existing_operations || [],
      context: {
        nextOperationNumber: context.nextOperationNumber,
        workCenter: context.workCenter,
        workType: context.workType,
        planName: context.planName
      },
      reference_info: refInfo,
      questions: []
    };

    // Ajouter questions si données manquantes
    if (useCase === "create_operation" && !context.taskListGroup) {
      response.questions.push("Quel est le numéro du groupe Task List (PLNNR) ?");
    }
    if ((useCase === "change_operation" || useCase === "delete_operation") && !sapData.existing_operations?.length) {
      response.questions.push("Quel est le numéro de l'opération à modifier/supprimer (10, 20, 30...) ?");
    }

    console.log(`[analyze] Response: ${required_files.length} files, ${sapData.extracted?.length || 0} SAP fields`);
    res.json(response);
  } catch (e) {
    console.error("[analyze] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 3: Génération des instructions de remplissage
app.post("/api/dcf/wizard/instructions", upload.array("screenshots", 10), async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename, attachmentIds = [] } = req.body;
    const newScreenshots = req.files || [];

    console.log(`[instructions] Template: ${templateFilename}, New screenshots: ${newScreenshots.length}`);

    // 1. Récupérer le template
    const { rows } = await pool.query(
      `SELECT id, filename, analysis, file_data FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `Template "${templateFilename}" introuvable.` });
    }

    const file = rows[0];
    const analysis = file.file_data ? buildDeepExcelAnalysis(file.file_data, file.filename) : null;

    // 2. Récupérer les données SAP de la session
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

    // 3. Extraire données des nouveaux screenshots
    let newSapData = { extracted: [], existing_operations: [] };
    if (newScreenshots.length) {
      newSapData = await extractSAPDataFromImages(newScreenshots);
    }

    // 4. Fusionner toutes les données SAP
    const allSapData = {
      extracted: [...(sessionSapData.extracted || []), ...(newSapData.extracted || [])],
      existing_operations: [...(sessionSapData.existing_operations || []), ...(newSapData.existing_operations || [])],
      plan_name: sessionSapData.plan_name || newSapData.plan_name
    };

    // 5. Détecter le type de template
    const fn = templateFilename.toLowerCase();
    let templateType = "TASK_LIST";
    if (fn.includes("pm") || fn.includes("plan") || fn.includes("maintenance")) {
      templateType = "MAINTENANCE_PLAN";
    } else if (fn.includes("eqpt") || fn.includes("equipment")) {
      templateType = "EQUIPMENT";
    }

    // 6. Détecter le cas d'usage
    const useCase = detectUseCase(requestText || "");
    const useCaseInfo = USE_CASES[useCase] || USE_CASES.unknown;
    const dcfAction = useCaseInfo.dcf_actions[templateType];

    // 7. Obtenir le mapping des colonnes
    let columnsToFill = {};
    if (DCF_COLUMNS[templateType] && dcfAction && DCF_COLUMNS[templateType][dcfAction]) {
      columnsToFill = DCF_COLUMNS[templateType][dcfAction].columns;
    }

    // 8. Construire le contexte
    const context = buildInstructionContext(allSapData, useCase, requestText || "");

    // 9. Préparer les données pour le prompt
    const sapDataStr = JSON.stringify({
      extracted: allSapData.extracted,
      existing_operations: allSapData.existing_operations,
      plan_name: allSapData.plan_name
    }, null, 2);

    const dropdownBlock = Object.entries(DROPDOWNS)
      .map(([col, vals]) => `${col}: ${vals.slice(0, 10).join(", ")}${vals.length > 10 ? "..." : ""}`)
      .join("\n");

    // 10. Générer les instructions via IA
    const prompt = `Tu dois générer les instructions PRÉCISES de remplissage pour un fichier DCF SAP.

DEMANDE UTILISATEUR: "${requestText}"

CAS D'USAGE DÉTECTÉ: ${useCase} - ${useCaseInfo.description}

TEMPLATE: ${templateFilename} (Type: ${templateType})

STRUCTURE TEMPLATE:
${analysis?.ai_context || "N/A"}

DONNÉES SAP EXTRAITES DES CAPTURES:
${sapDataStr}

CONTEXTE CALCULÉ (UTILISE CES VALEURS):
- Prochain N° Opération: ${context.nextOperationNumber} (basé sur ${context.existingOperationsCount} opérations existantes: ${allSapData.existing_operations?.map(o => o.number).join(", ") || "aucune"})
- Work Center suggéré: ${context.workCenter || "NON TROUVÉ - À DEMANDER"}
- Type de travail: ${context.workType || "NON TROUVÉ"}
- N° Plan: ${context.planNumber || "NON TROUVÉ"}
- N° Groupe TL: ${context.taskListGroup || "NON TROUVÉ"}
- Counter: ${context.counter || "1"}
- Nom du plan: ${context.planName || "NON TROUVÉ"}

COLONNES OBLIGATOIRES POUR CE CAS (${dcfAction || "N/A"}):
${Object.entries(columnsToFill).map(([col, info]) => 
  `${col}: ${info.code} - ${info.label || ""} ${info.mandatory ? "(OBLIGATOIRE)" : "(optionnel)"} ${info.value ? `= "${info.value}"` : ""}`
).join("\n")}

LISTES DÉROULANTES DISPONIBLES:
${dropdownBlock || "N/A"}

RÈGLES CRITIQUES:
1. N° Opération (VORNR): Utilise ${context.nextOperationNumber}, PAS 10 par défaut!
2. Work Center (ARBPL): Utilise ${context.workCenter || "la valeur extraite"}, PAS FMEXMAINT par défaut!
3. Type travail (VAGR): Utilise ${context.workType || "la valeur extraite"}, PAS P1 par défaut!
4. Short Text (LTXA1, KTEXT): max 40 caractères
5. Counter (PLNAL): 1, 2, 3...
6. ACTION: Create, Change ou Delete uniquement
7. System Condition: I = Intrusive, N = Non-intrusive

GÉNÈRE les instructions ligne par ligne en JSON STRICT:
{
  "steps": [
    {
      "row": "6",
      "col": "I",
      "code": "ACTION",
      "label": "Action SAP",
      "value": "Create",
      "reason": "Nouvelle opération à créer",
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
      "reason": "Après opérations existantes ${allSapData.existing_operations?.map(o => o.number).join(", ") || ""}",
      "mandatory": true,
      "sheet": "DCF",
      "editable": true
    }
  ],
  "missing_data": ["Liste des données manquantes essentielles"]
}

IMPORTANT: 
- Utilise les VRAIES valeurs du contexte calculé, pas des valeurs par défaut!
- Si une valeur n'est pas trouvée, mets null et ajoute-la dans missing_data
- Génère TOUTES les colonnes obligatoires pour ce cas d'usage`;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Tu es un expert SAP DCF. Génère des instructions PRÉCISES basées sur les données extraites des screenshots. N'invente JAMAIS de valeurs - utilise uniquement ce qui est fourni dans le contexte." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 3000
    });

    const out = cleanJSON(completion.choices[0].message.content);
    const steps = Array.isArray(out.steps) ? out.steps : [];

    // 11. Post-traitement: marquer les champs éditables
    const processedSteps = steps.map(s => ({
      ...s,
      editable: s.editable !== false && (!s.value || s.mandatory === false || s.value === null)
    }));

    // 12. Vérifier les valeurs manquantes critiques
    const missingData = out.missing_data || [];
    if (!context.workCenter && useCase.includes("operation")) {
      missingData.push("Work Center (ARBPL) non trouvé dans les screenshots");
    }
    if (!context.taskListGroup && templateType === "TASK_LIST") {
      missingData.push("N° Groupe Task List (PLNNR) non trouvé");
    }

    console.log(`[instructions] Generated ${processedSteps.length} steps, ${missingData.length} missing`);

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
    console.error("[instructions] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 4: Générer le fichier rempli
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
      if (!inst.value || inst.value === "null" || inst.value === null) continue;
      
      const sheetName = inst.sheet && wb.Sheets[inst.sheet] ? inst.sheet : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const row = parseInt(inst.row, 10);
      const col = inst.col;
      if (!row || !col) continue;

      const cellRef = `${col}${row}`;
      ws[cellRef] = { t: "s", v: String(inst.value) };

      // Mettre à jour la plage si nécessaire
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
    console.error("[autofill] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// 13. ROUTES API - VALIDATION
// =============================================================================

app.post("/api/dcf/validate", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Aucun fichier fourni." });

    const wb = xlsx.read(file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

    const errors = [];
    const warnings = [];
    const successes = [];

    // Trouver la ligne d'en-tête
    let headerRowIdx = 4;
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      if (data[i].some(c => /^(ACTION|DCFACTION)/i.test(String(c)))) {
        headerRowIdx = i;
        break;
      }
    }

    const headers = data[headerRowIdx] || [];
    
    // Mapper les colonnes
    const colMap = {};
    headers.forEach((h, idx) => {
      const code = String(h).toUpperCase().trim();
      colMap[code] = idx;
    });

    // Valider chaque ligne de données
    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 1;
      
      const action = String(row[colMap["ACTION"] || colMap["DCFACTION"]] || "").trim();
      if (!action || !["Create", "Change", "Delete"].includes(action)) {
        continue; // Ignorer lignes sans action valide
      }

      // Vérifications générales
      if (action === "Create") {
        // Pour Task List
        if (colMap["PLNNR"] !== undefined) {
          const plnnr = row[colMap["PLNNR"]];
          if (!plnnr) {
            errors.push({ row: rowNum, field: "PLNNR", message: "N° Groupe Task List obligatoire pour Create" });
          }
        }
        
        if (colMap["VORNR"] !== undefined) {
          const vornr = row[colMap["VORNR"]];
          if (!vornr) {
            errors.push({ row: rowNum, field: "VORNR", message: "N° Opération obligatoire pour Create" });
          }
        }

        if (colMap["LTXA1"] !== undefined || colMap["KTEXT"] !== undefined) {
          const shortText = row[colMap["LTXA1"]] || row[colMap["KTEXT"]] || "";
          if (shortText.length > 40) {
            errors.push({ row: rowNum, field: "LTXA1/KTEXT", message: `Short Text trop long: ${shortText.length}/40 caractères` });
          }
        }
      }

      if (action === "Change" || action === "Delete") {
        // Vérifier qu'on a un identifiant
        const hasId = row[colMap["PLNNR"]] || row[colMap["WARPL"]] || row[colMap["EQUNR"]];
        if (!hasId) {
          errors.push({ row: rowNum, field: "ID", message: "Identifiant requis pour Change/Delete (PLNNR, WARPL ou EQUNR)" });
        }
      }

      // Validation réussie
      if (!errors.find(e => e.row === rowNum)) {
        successes.push({ row: rowNum, action, message: `Ligne ${rowNum}: ${action} valide` });
      }
    }

    res.json({
      ok: errors.length === 0,
      errors,
      warnings,
      successes,
      summary: {
        total_rows: data.length - headerRowIdx - 1,
        errors: errors.length,
        warnings: warnings.length,
        valid: successes.length
      }
    });
  } catch (e) {
    console.error("[validate] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// 14. ROUTES API - RÉFÉRENTIELS
// =============================================================================

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

app.get("/api/dcf/reference/dropdowns", (req, res) => {
  res.json({ ok: true, dropdowns: DROPDOWNS });
});

app.get("/api/dcf/reference/columns/:templateType/:action", (req, res) => {
  const { templateType, action } = req.params;
  const columns = DCF_COLUMNS[templateType]?.[action]?.columns;
  if (!columns) {
    return res.status(404).json({ error: "Template type ou action non trouvé" });
  }
  res.json({ ok: true, columns, description: DCF_COLUMNS[templateType][action].description });
});

// =============================================================================
// 15. ROUTES API - CHAT & HEALTH
// =============================================================================

app.post("/api/dcf/chat", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Tu es un assistant expert SAP PM DCF. Aide l'utilisateur avec ses questions sur le remplissage des fichiers DCF (Task List, Maintenance Plan, Equipment)." },
        { role: "user", content: req.body.message }
      ],
      max_tokens: 1000
    });
    res.json({ ok: true, answer: completion.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dcf/health", (req, res) => {
  res.json({
    status: "ok",
    version: "9.0.0",
    features: [
      "vision_extraction_v2",
      "auto_operation_numbering",
      "work_center_detection",
      "business_rules_strict",
      "tasklist_reference",
      "editable_values",
      "db_migration_auto"
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
// 16. DÉMARRAGE
// =============================================================================

app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           DCF SAP Assistant v9.0.0 - DÉMARRÉ                  ║
╠═══════════════════════════════════════════════════════════════╣
║  URL: http://${HOST}:${PORT}                                  
║  Vision Model: ${VISION_MODEL}                                
║  Answer Model: ${ANSWER_MODEL}                                
║                                                               ║
║  Améliorations v9:                                            ║
║  ✓ Fix colonnes DB (extracted_fields, use_case)               ║
║  ✓ Extraction Vision améliorée (opérations existantes)        ║
║  ✓ Calcul auto N° opération (10→20→30...)                     ║
║  ✓ Détection Work Center depuis screenshots                   ║
║  ✓ Mapping colonnes strict basé sur doc Word                  ║
╚═══════════════════════════════════════════════════════════════╝
`);
});
