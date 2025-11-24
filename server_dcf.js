// server_dcf.js — Assistant DCF SAP v7.5.0
// FULL FIX + Memory + Protocole Charles + Validate Smart + ACTION Multi-Cols + Instructions ACTION-aware
// + Dropdown lists support (CSV) + Clarification scaffolding
//
// - Pré-routage métier (ajout opération/contrôle dans plan existant => TL+MP)
// - Validation scope-aware: ignore lignes sans vraie action SAP
// - ACTION peut être dans ACTION, ACTION_01, ACTION_02, ACTION_03...
// - Only whitelist actions: Insert | Change | Delete
// - Instructions: IA guidée vers ACTION_0X + remap auto
// - Instructions length-aware (SAP max lengths + troncature auto)
// - Analyse Excel robuste SAP + mémoire relationnelle + historique noms
// - Dropdown CSV: on n’invente pas les valeurs de listes, on demande si besoin

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

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ANSWER_MODEL = process.env.DCF_ANSWER_MODEL || "gpt-4o-mini";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o-mini";

// Limites
const MAX_FILES_LIBRARY = 50;
const MAX_CONTEXT_CHARS = 12000;
const MAX_ATTACHMENT_TEXT = 6000;
const MAX_MEMORY_HINTS = 50;
const MAX_NUMBERS_SCAN = 40;

// Dropdown CSV path (optional)
const DROPDOWN_CSV_PATH =
  process.env.DCF_DROPDOWN_CSV_PATH ||
  path.join(process.cwd(), "Listes_deroulantes__data_validation_.csv");

// -----------------------------------------------------------------------------
// 1. EXPRESS SETUP
// -----------------------------------------------------------------------------

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));

// -----------------------------------------------------------------------------
// 2. HELPERS
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

function safeEmail(x) {
  return x && /\S+@\S+\.\S+/.test(x) ? String(x).trim().toLowerCase() : null;
}

function getUserEmail(req) {
  return safeEmail(req.headers["x-user-email"] || req.headers["x-user_email"]);
}

function clampStr(s, n) {
  return String(s ?? "").slice(0, n);
}

function extractMaybeNumber(text) {
  return (String(text || "").match(/\b\d{4,12}\b/g) || []).slice(0, MAX_NUMBERS_SCAN);
}

function extractUseCaseFromText(message = "") {
  const m = String(message).toLowerCase();
  if (/(décommission|decommission|retirer|supprimer équipement|retirer equipement)/.test(m))
    return "decommission";
  if (/(ajout|ajouter|rajouter|créer|creer).*(opération|operation|contrôle|controle|inspection|check).*(plan)/.test(m))
    return "add_operation_in_plan";
  if (/(ajout|ajouter|rajouter).*(équipement|equipement).*(plan)/.test(m))
    return "add_equipment_in_plan";
  if (/(modif|modifier|changer).*(texte|short text|long text)/.test(m))
    return "text_only_change";
  return "unknown";
}

// -----------------------------------------------------------------------------
// 3. DB SAFE MIGRATIONS (tables mémoire)
// -----------------------------------------------------------------------------

async function ensureMemoryTables() {
  // Core tables (needed for first run)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_files (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      stored_name TEXT,
      path TEXT,
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
      created_at TIMESTAMP DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_requests (
      id SERIAL PRIMARY KEY,
      session_id INT REFERENCES dcf_sessions(id) ON DELETE CASCADE,
      request_text TEXT NOT NULL,
      detected_action TEXT,
      detected_type TEXT,
      recommended_file_id INT REFERENCES dcf_files(id),
      response_json JSONB DEFAULT '{}'::jsonb,
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
      uploaded_at TIMESTAMP DEFAULT now()
    );
  `);

  // Memory tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_entity_memory (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      key_code TEXT NOT NULL,
      key_value TEXT NOT NULL,
      name_code TEXT,
      name_value TEXT,
      extra JSONB DEFAULT '{}'::jsonb,
      seen_count INT DEFAULT 1,
      last_seen_at TIMESTAMP DEFAULT now(),
      UNIQUE(entity_type, key_code, key_value)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_row_memory (
      id SERIAL PRIMARY KEY,
      file_id INT REFERENCES dcf_files(id) ON DELETE CASCADE,
      sheet TEXT,
      row_number INT,
      data JSONB DEFAULT '{}'::jsonb,
      seen_count INT DEFAULT 1,
      last_seen_at TIMESTAMP DEFAULT now(),
      UNIQUE(file_id, sheet, row_number)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_entity_name_history (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      key_code TEXT NOT NULL,
      key_value TEXT NOT NULL,
      old_name_value TEXT,
      new_name_value TEXT,
      changed_at TIMESTAMP DEFAULT now()
      );
    `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_values_index (
      id SERIAL PRIMARY KEY,
      field_code TEXT NOT NULL,
      value TEXT NOT NULL,
      file_id INT REFERENCES dcf_files(id) ON DELETE SET NULL,
      seen_count INT DEFAULT 1,
      last_seen_at TIMESTAMP DEFAULT now(),
      UNIQUE(field_code, value)
    );
  `);
}

ensureMemoryTables().catch(() =>
  console.warn("⚠️ Impossible de créer les tables mémoire (non bloquant).")
);

// -----------------------------------------------------------------------------
// 3bis. DROPDOWNS (CSV OPTIONAL) — ROBUST PARSE + ROBUST MATCH
// -----------------------------------------------------------------------------

let DROPDOWN_INDEX = null;

/**
 * Normalise une clé de fichier pour matcher même si:
 * - extension différente / absente
 * - accents
 * - underscores / espaces
 * - variantes de nom (Maintenance Plan vs DCF_MaintPlan etc.)
 */
function normalizeKey(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // enlève accents
    .replace(/\.(xlsx|xlsm|xls)$/i, "") // enlève extension
    .replace(/[^a-z0-9]+/g, " ") // remplace tout par espace
    .trim();
}

/**
 * Détecte automatiquement si le CSV est séparé par "," ou ";"
 * (Excel FR sort souvent du ";" par défaut)
 */
function detectDelimiter(headerLine = "") {
  const comma = (headerLine.match(/,/g) || []).length;
  const semi  = (headerLine.match(/;/g) || []).length;
  return semi > comma ? ";" : ",";
}

/**
 * Split CSV en respectant les guillemets.
 * Ex: "valeur, avec virgule" reste un seul champ.
 */
function smartSplitCSVLine(line, delim) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      inQ = !inQ;
      continue;
    }

    if (ch === delim && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

/**
 * CSV schema:
 * Fichier | Feuille | Cellules concernées | Nom/Source liste | Nb valeurs | Valeurs (liste complète)
 */
function loadDropdownCSV() {
  try {
    if (!fs.existsSync(DROPDOWN_CSV_PATH)) {
      console.warn("⚠️ Dropdown CSV introuvable:", DROPDOWN_CSV_PATH);
      DROPDOWN_INDEX = null;
      return;
    }

    const raw = fs.readFileSync(DROPDOWN_CSV_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
    const header = lines.shift();
    if (!header) {
      DROPDOWN_INDEX = null;
      return;
    }

    const delim = detectDelimiter(header);
    const idx = new Map();

    for (const line of lines) {
      const parts = smartSplitCSVLine(line, delim).map((p) => String(p || "").trim());
      if (parts.length < 6) continue;

      const fichierRaw = parts[0];
      const feuille = parts[1];
      const cellules = parts[2];
      const listName = parts[3];
      const nb = Number(parts[4] || "0") || 0;

      // tout ce qui reste = valeurs (on re-joint au cas où des virgules sont dedans)
      const valuesStr = parts.slice(5).join(delim).trim();
      const values = valuesStr
        .split(/\s*[,;]\s*/)   // virgule OU point-virgule
        .map((v) => v.trim())
        .filter(Boolean);


      const key = normalizeKey(fichierRaw);
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push({
        fichier: fichierRaw,
        feuille,
        cellules,
        listName,
        nb,
        values,
      });
    }

    DROPDOWN_INDEX = idx;
    console.log(`✅ Dropdown CSV chargé: ${idx.size} fichiers indexés (delim="${delim}")`);
  } catch (e) {
    console.warn("⚠️ Dropdown CSV non chargé:", e.message);
    DROPDOWN_INDEX = null;
  }
}

loadDropdownCSV();

/**
 * Matching robuste template <-> CSV
 * 1) match direct normalisé
 * 2) contains
 * 3) fallback fuzzy par mots-clés
 */
function getDropdownsForTemplate(templateFilename = "") {
  if (!DROPDOWN_INDEX) return [];

  const tf = normalizeKey(templateFilename);

  // 1) match direct
  if (DROPDOWN_INDEX.has(tf)) return DROPDOWN_INDEX.get(tf);

  // 2) contains
  for (const [k, arr] of DROPDOWN_INDEX.entries()) {
    if (tf.includes(k) || k.includes(tf)) return arr;
  }

  // 3) fuzzy buckets (si nom trop différent)
  const buckets = [
    { key: "maintenance plan", words: ["maintenance", "plan", "warpl", "mp"] },
    { key: "equipment", words: ["equipment", "equnr", "eq"] },
    { key: "task list", words: ["task", "list", "plnnr", "plnty"] },
    { key: "functional location", words: ["functional", "location", "iloan", "tplnr"] },
  ];

  for (const b of buckets) {
    if (b.words.some((w) => tf.includes(w))) {
      for (const [k, arr] of DROPDOWN_INDEX.entries()) {
        if (k.includes(b.key)) return arr;
      }
    }
  }

  return [];
}

function dropdownBlockForPrompt(templateFilename) {
  const dds = getDropdownsForTemplate(templateFilename);
  if (!dds.length) return "N/A";

  return dds
    .map((d) => {
      const vals = (d.values || []).slice(0, 120).join(", ");
      return `- Liste "${d.listName}" (cells: ${d.cellules}) valeurs autorisées: ${vals}`;
    })
    .join("\n");
}

// -----------------------------------------------------------------------------
// 4. EXCEL ANALYSIS ROBUSTE  (v7.5.0)
// -----------------------------------------------------------------------------
// Objectifs robustesse:
// - Détecter dynamiquement la ligne de début des données (pas de +3 hardcodé)
// - Détecter et signaler les colonnes constantes/figées (ex WERKS=CH94)
// - Ajouter une ligne d'exemple dans ai_context pour éviter hallucinations
// - Gérer tous les templates (Maintenance Plan, Equipment, Task List, FL, etc.)
// - Heuristique "templates SAP commencent en H" sans casser un template atypique

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

function looksLikeCodes(row) {
  const cells = row
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 120);

  if (!cells.length) return false;

  const codeLike = cells.filter((c) =>
    /^[A-Z0-9_]{2,}$/.test(c) && !/^(TRUE|FALSE|YES|NO)$/i.test(c)
  ).length;

  return codeLike / cells.length > 0.35;
}

// Heuristique: si beaucoup de colonnes codes sont >= H,
// on ignore A..G pour éviter les colonnes parasites.
function applyHStartHeuristic(columns, startLetter = "H") {
  if (!Array.isArray(columns) || columns.length === 0) return columns || [];

  const startIdx = letterToIndex(startLetter); // utilise la helper déjà définie
  const afterH = columns.filter(c => c.idx >= startIdx);
  const beforeH = columns.filter(c => c.idx < startIdx);

  // Si au moins 60% des colonnes détectées sont après H → on filtre avant H
  if (afterH.length / columns.length >= 0.6) {
    return afterH;
  }
  return columns;
}

function findHeaderRow(raw) {
  for (let r = 0; r < Math.min(raw.length, 40); r++) {
    const row = raw[r].map((c) => String(c).toLowerCase());
    if (
      row.some((c) => c.includes("code")) ||
      row.some((c) => c.includes("field")) ||
      row.some((c) => c.includes("champ")) ||
      row.some((c) => c.includes("field name"))
    ) {
      return r;
    }
  }
  const idx = raw.findIndex((r) => r.some((c) => String(c).trim() !== ""));
  return idx === -1 ? 0 : idx;
}

// NEW: Column windows per template to prevent drift (H..end fixed)
const TEMPLATE_COL_WINDOWS = [
  { match: /maintenance plan/i, start: "H", end: "BE" },
  { match: /equipment/i, start: "H", end: "BU" },
  { match: /task list/i, start: "H", end: "EB" },
  { match: /functional location/i, start: "H", end: "BR" }
];

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

function getWindowForFilename(filename = "") {
  const f = String(filename || "");
  for (const w of TEMPLATE_COL_WINDOWS) {
    if (w.match.test(f)) return w;
  }
  return null;
}

function clampColumnsToWindow(columns, window) {
  if (!window) return columns;
  const startIdx = letterToIndex(window.start);
  const endIdx = letterToIndex(window.end);
  return columns.filter((c) => c.idx >= startIdx && c.idx <= endIdx);
}

// test si une ligne contient des données sur les colonnes utiles
function rowHasAnyDataInColumns(rowArr, columns) {
  for (const colDef of columns) {
    const v = String(rowArr[colDef.idx] ?? "").trim();
    if (v !== "") return true;
  }
  return false;
}

// stats colonnes (constantes, valeurs uniques, etc.)
function computeColumnStats(dataRows, columns) {
  const stats = {};
  for (const colDef of columns) {
    const values = [];
    for (const r of dataRows) {
      const v = String(r[colDef.idx] ?? "").trim();
      if (v !== "") values.push(v);
    }
    if (!values.length) continue;

    const uniq = [...new Set(values)];
    stats[colDef.code] = {
      unique: uniq,
      isConstant: uniq.length === 1,
      constantValue: uniq.length === 1 ? uniq[0] : null,
      filledCount: values.length
    };
  }
  return stats;
}

// évite de considérer une ligne d'exemple/constantes comme data réelle
function isRowMostlyConstants(row, columns, colStats) {
  let filled = 0;
  let constants = 0;
  for (const colDef of columns) {
    const v = String(row[colDef.idx] ?? "").trim();
    if (v !== "") {
      filled++;
      if (colStats?.[colDef.code]?.isConstant) constants++;
    }
  }
  return filled > 0 && constants / filled > 0.8;
}

// début des données dynamique et anti-décalage
function findDataStartIdx(raw, headerRowIdx, columns) {
  let i = headerRowIdx + 1;

  // skip lignes vides/codes
  while (i < raw.length) {
    const row = raw[i] || [];
    const isEmpty = row.every((c) => String(c ?? "").trim() === "");
    const isCodes = looksLikeCodes(row);
    if (isEmpty || isCodes) {
      i++;
      continue;
    }
    break;
  }

  // probe stats sur 10 lignes max
  const probeRows = raw.slice(i, i + 10);
  const probeStats = computeColumnStats(probeRows, columns);

  while (i < raw.length) {
    const row = raw[i] || [];
    if (!rowHasAnyDataInColumns(row, columns)) {
      i++;
      continue;
    }
    if (isRowMostlyConstants(row, columns, probeStats)) {
      i++;
      continue;
    }
    return i;
  }

  return headerRowIdx + 2;
}

function buildDeepExcelAnalysis(buffer, originalName = "") {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: false });
  const analysis = {
    filename: originalName,
    sheetNames: wb.SheetNames || [],
    ai_context: "",
    sheets: [],
    extracted_values: [],
    rows_index: {},
    debug_info: [] // ⚡ NOUVEAU : logs debug
  };

  let globalContext = "";

  for (const sheetName of analysis.sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!raw.length) continue;

    const debugLog = [];

    // ========== ÉTAPE 1 : DÉTECTION HEADER ==========
    debugLog.push(`\n🔍 SHEET "${sheetName}" - ${raw.length} lignes détectées`);

    const headerRowIdx = findHeaderRow(raw);
    debugLog.push(`📍 Header row détectée : ligne ${headerRowIdx + 1} (index ${headerRowIdx})`);
    debugLog.push(`   Contenu : ${JSON.stringify(raw[headerRowIdx]?.slice(0, 15) || [])}`);

    const row0 = raw[headerRowIdx] || [];
    const row1 = raw[headerRowIdx + 1] || [];

    debugLog.push(`📍 Ligne suivante (codes potentiels) : ligne ${headerRowIdx + 2}`);
    debugLog.push(`   Contenu : ${JSON.stringify(row1.slice(0, 15) || [])}`);

    // ========== ÉTAPE 2 : IDENTIFICATION CODES/LABELS ==========
    const row0IsCodes = looksLikeCodes(row0);
    const row1IsCodes = looksLikeCodes(row1);

    debugLog.push(`🔬 Analyse lignes :`);
    debugLog.push(`   - row0 looks like codes? ${row0IsCodes}`);
    debugLog.push(`   - row1 looks like codes? ${row1IsCodes}`);

    const codesRow = row1IsCodes ? row1 : row0;
    const labelsRow = row1IsCodes ? row0 : row1;
    const codesRowIdx = row1IsCodes ? headerRowIdx + 1 : headerRowIdx;

    debugLog.push(`✅ Décision : codes en ligne ${codesRowIdx + 1}, labels en ligne ${row1IsCodes ? headerRowIdx + 1 : headerRowIdx + 2}`);

    // ========== ÉTAPE 3 : EXTRACTION COLONNES (SANS FILTRE) ==========
    let rawColumns = [];
    codesRow.forEach((code, idx) => {
      const c = String(code).trim();
      if (c.length > 1 && /[A-Za-z0-9]/.test(c)) {
        const label = String(labelsRow[idx] || "").trim();
        rawColumns.push({ idx, col: columnIndexToLetter(idx), code: c, label });
      }
    });

    debugLog.push(`📊 ${rawColumns.length} colonnes brutes détectées (avant filtres) :`);
    rawColumns.slice(0, 20).forEach(c => {
      debugLog.push(`   ${c.col} (idx=${c.idx}) : ${c.code} "${c.label}"`);
    });

    // ========== ÉTAPE 4 : APPLICATION HEURISTIQUE H (OPTIONNELLE) ==========
    let columns = [...rawColumns];

    // ⚠️ DÉSACTIVATION TEMPORAIRE de l'heuristique H pour debug
    // const afterHFiltered = applyHStartHeuristic(columns);
    // debugLog.push(`🔧 Heuristique H : ${columns.length} → ${afterHFiltered.length} colonnes`);
    // columns = afterHFiltered;

    debugLog.push(`⏭️  Heuristique H DÉSACTIVÉE (debug mode)`);

    // ========== ÉTAPE 5 : WINDOW CLAMP (OPTIONNEL) ==========
    const window = getWindowForFilename(originalName);
    if (window) {
      const beforeClamp = columns.length;
      columns = clampColumnsToWindow(columns, window);
      debugLog.push(`📏 Window ${window.start}-${window.end} appliquée : ${beforeClamp} → ${columns.length} colonnes`);
    } else {
      debugLog.push(`📏 Pas de fenêtre template définie`);
    }

    // ========== ÉTAPE 6 : DÉBUT DONNÉES ==========
    const dataStartIdx = findDataStartIdx(raw, headerRowIdx, columns);
    debugLog.push(`📍 Début données détecté : ligne ${dataStartIdx + 1} (index ${dataStartIdx})`);

    const dataRows = raw.slice(dataStartIdx);
    const colStats = computeColumnStats(dataRows, columns);

    // ========== ÉTAPE 7 : EXEMPLE LIGNE ==========
    let exampleRowNumber = null;
    let exampleMap = {};
    for (let ridx = 0; ridx < dataRows.length; ridx++) {
      if (rowHasAnyDataInColumns(dataRows[ridx], columns)) {
        exampleRowNumber = dataStartIdx + ridx + 1;
        for (const colDef of columns) {
          const val = String(dataRows[ridx][colDef.idx] ?? "").trim();
          if (val !== "") exampleMap[colDef.code] = val;
        }
        break;
      }
    }

    debugLog.push(`📝 Exemple ligne ${exampleRowNumber || "?"} :`);
    debugLog.push(`   ${JSON.stringify(exampleMap).slice(0, 200)}`);

    // ========== ÉTAPE 8 : EXTRACTION VALEURS ==========
    let extractedCount = 0;

    dataRows.forEach((rowArr, ridx) => {
      const rowNumber = dataStartIdx + ridx + 1;
      const rowKey = `${sheetName}::${rowNumber}`;

      for (const colDef of columns) {
        const v = rowArr[colDef.idx];
        const val = String(v ?? "").trim();
        if (val !== "") {
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

          extractedCount++;
        }
      }
    });

    debugLog.push(`✅ ${extractedCount} valeurs extraites`);

    // ========== SAVE DEBUG LOG ==========
    analysis.debug_info.push(debugLog.join("\n"));

    // ========== CONTEXT TEXTE ==========
    const columnsStr = columns
      .map((c) => `${c.code}${c.label ? ` (${c.label})` : ""} -> ${c.col}`)
      .join(", ");

    const constantStr = Object.entries(colStats)
      .filter(([_, st]) => st.isConstant)
      .map(([code, st]) => `${code}=${st.constantValue}`)
      .join(", ");

    const exampleStr = exampleRowNumber
      ? Object.entries(exampleMap)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      : "N/A";

    const sheetContext =
      `SHEET "${sheetName}"\n` +
      `Colonnes détectées: ${columnsStr}\n` +
      `Header ligne ${headerRowIdx + 1} | Codes ligne ${codesRowIdx + 1}\n` +
      `Fenêtre template: ${window ? window.start + "-" + window.end : "auto"}\n` +
      `Début données détecté: ligne ${dataStartIdx + 1}\n` +
      `Exemple ligne ${exampleRowNumber || "?"}: ${exampleStr}\n` +
      (constantStr
        ? `Colonnes constantes (figées): ${constantStr}\n`
        : "");

    globalContext += sheetContext + "\n";

    analysis.sheets.push({
      name: sheetName,
      headerRowIdx: headerRowIdx + 1,
      codesRowIdx: codesRowIdx + 1,
      columns,
      dataStartRow: dataStartIdx + 1,
      extracted_count: extractedCount
    });
  }

  analysis.ai_context = globalContext.trim();

  // ⚡ AFFICHE DEBUG DANS CONSOLE SERVEUR
  console.log("\n" + "=".repeat(80));
  console.log(`📋 ANALYSE EXCEL : ${originalName}`);
  console.log("=".repeat(80));
  analysis.debug_info.forEach(log => console.log(log));
  console.log("=".repeat(80) + "\n");

  return analysis;
}

// -----------------------------------------------------------------------------
// 4.b ANALYSIS SHRINKING FOR DB (compat v7.5.0)
// -----------------------------------------------------------------------------
// L'analyse complète peut être très grosse (extracted_values, context long).
// On stocke une version "lite" en DB pour historique/debug léger.
function shrinkAnalysisForDB(analysisFull) {
  if (!analysisFull || typeof analysisFull !== "object") return analysisFull;
  const ai = String(analysisFull.ai_context || "");
  return {
    filename: analysisFull.filename,
    sheetNames: analysisFull.sheetNames || [],
    sheets: analysisFull.sheets || [],
    // utile pour debug, mais on limite la taille
    ai_context: ai.length > 20000 ? ai.slice(0, 20000) + "\n...[TRUNCATED]" : ai,
    extracted_count: Array.isArray(analysisFull.extracted_values)
      ? analysisFull.extracted_values.length
      : 0,
    rows_index: analysisFull.rows_index || {}
  };
}

function buildFileContext(analysis) {
  return {
    filename: analysis.filename,
    sheetNames: analysis.sheetNames,
    ai_context: analysis.ai_context,
    sheets: analysis.sheets,
    extracted_count: analysis.extracted_values?.length || 0
  };
}
// -----------------------------------------------------------------------------
// 5. INDEXATION DB (values + mémoire entités)
// -----------------------------------------------------------------------------

async function indexFileValues(fileId, analysis) {
  try {
    const values = analysis.extracted_values || [];
    if (!values.length) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of values) {
        await client.query(
          `
          INSERT INTO dcf_values_index (field_code, value, file_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (field_code, value)
          DO UPDATE 
            SET seen_count = dcf_values_index.seen_count + 1,
                last_seen_at = now()
        `,
          [item.field, item.value, fileId]
        );
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  } catch {}
}

async function indexEntityMemory(fileId, analysis) {
  try {
    const rowsIndex = analysis.rows_index || {};
    if (!Object.keys(rowsIndex).length) return;

    const client = await pool.connect();
    try {
      for (const rowKey of Object.keys(rowsIndex)) {
        const row = rowsIndex[rowKey];

        // 1) Maintenance Plan (WARPL -> WPTXT)
        if (row.WARPL) {
          const keyValue = String(row.WARPL).trim();
          const nameValue = String(
            row.WPTXT ||
              row.PLTEXT ||
              row.PLTXT ||
              row.PLANNAM ||
              ""
          ).trim();

          const extra = {};
          if (row.TPLNR) extra.TPLNR = row.TPLNR;
          if (row.EQUNR) extra.EQUNR = row.EQUNR;
          if (row.MPTYP) extra.MPTYP = row.MPTYP;
          if (row.STRAT) extra.STRAT = row.STRAT;
          if (row.WERKS) extra.WERKS = row.WERKS;

          const prev = await client.query(
            `
            SELECT name_value 
            FROM dcf_entity_memory
            WHERE entity_type='maintenance_plan' AND key_code='WARPL' AND key_value=$1
            LIMIT 1
          `,
            [keyValue]
          );
          const prevName = prev.rows[0]?.name_value || null;
          const newName = nameValue || null;

          if (prevName && newName && prevName !== newName) {
            await client.query(
              `
              INSERT INTO dcf_entity_name_history(entity_type, key_code, key_value, old_name_value, new_name_value)
              VALUES ($1,$2,$3,$4,$5)
            `,
              ["maintenance_plan", "WARPL", keyValue, prevName, newName]
            );
          }

          await client.query(
            `
            INSERT INTO dcf_entity_memory(entity_type, key_code, key_value, name_code, name_value, extra)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT(entity_type, key_code, key_value)
            DO UPDATE SET
              name_value = COALESCE(EXCLUDED.name_value, dcf_entity_memory.name_value),
              extra = dcf_entity_memory.extra || EXCLUDED.extra,
              seen_count = dcf_entity_memory.seen_count + 1,
              last_seen_at = now()
          `,
            [
              "maintenance_plan",
              "WARPL",
              keyValue,
              newName ? "WPTXT" : null,
              newName,
              extra
            ]
          );
        }

        // 2) Equipment (EQUNR -> EQKTX)
        if (row.EQUNR) {
          const keyValue = String(row.EQUNR).trim();
          const nameValue = String(
            row.EQKTX || row.SHORTTEXT || row.EQTXT || ""
          ).trim();

          const extra = {};
          if (row.TPLNR) extra.TPLNR = row.TPLNR;
          if (row.SERGE) extra.SERGE = row.SERGE;
          if (row.BEGRU) extra.BEGRU = row.BEGRU;
          if (row.WERKS) extra.WERKS = row.WERKS;

          const prev = await client.query(
            `
            SELECT name_value 
            FROM dcf_entity_memory
            WHERE entity_type='equipment' AND key_code='EQUNR' AND key_value=$1
            LIMIT 1
          `,
            [keyValue]
          );
          const prevName = prev.rows[0]?.name_value || null;
          const newName = nameValue || null;

          if (prevName && newName && prevName !== newName) {
            await client.query(
              `
              INSERT INTO dcf_entity_name_history(entity_type, key_code, key_value, old_name_value, new_name_value)
              VALUES ($1,$2,$3,$4,$5)
            `,
              ["equipment", "EQUNR", keyValue, prevName, newName]
            );
          }

          await client.query(
            `
            INSERT INTO dcf_entity_memory(entity_type, key_code, key_value, name_code, name_value, extra)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT(entity_type, key_code, key_value)
            DO UPDATE SET
              name_value = COALESCE(EXCLUDED.name_value, dcf_entity_memory.name_value),
              extra = dcf_entity_memory.extra || EXCLUDED.extra,
              seen_count = dcf_entity_memory.seen_count + 1,
              last_seen_at = now()
          `,
            [
              "equipment",
              "EQUNR",
              keyValue,
              newName ? "EQKTX" : null,
              newName,
              extra
            ]
          );
        }

        // 3) Task list (PLNNR/TLNUM -> KTEXT)
        if (row.PLNNR || row.PLNAL || row.TLNUM) {
          const keyValue = String(
            row.PLNNR || row.TLNUM || row.PLNAL || ""
          ).trim();
          if (keyValue) {
            const nameValue = String(
              row.KTEXT || row.TLTXT || row.LTXA1 || row.PLNNTXT || ""
            ).trim();

            const extra = {};
            if (row.WERKS) extra.WERKS = row.WERKS;
            if (row.STRAT) extra.STRAT = row.STRAT;

            const prev = await client.query(
              `
              SELECT name_value 
              FROM dcf_entity_memory
              WHERE entity_type='task_list' AND key_code='PLNNR' AND key_value=$1
              LIMIT 1
            `,
              [keyValue]
            );
            const prevName = prev.rows[0]?.name_value || null;
            const newName = nameValue || null;

            if (prevName && newName && prevName !== newName) {
              await client.query(
                `
                INSERT INTO dcf_entity_name_history(entity_type, key_code, key_value, old_name_value, new_name_value)
                VALUES ($1,$2,$3,$4,$5)
              `,
                ["task_list", "PLNNR", keyValue, prevName, newName]
              );
            }

            await client.query(
              `
              INSERT INTO dcf_entity_memory(entity_type, key_code, key_value, name_code, name_value, extra)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT(entity_type, key_code, key_value)
              DO UPDATE SET
                name_value = COALESCE(EXCLUDED.name_value, dcf_entity_memory.name_value),
                extra = dcf_entity_memory.extra || EXCLUDED.extra,
                seen_count = dcf_entity_memory.seen_count + 1,
                last_seen_at = now()
            `,
              [
                "task_list",
                "PLNNR",
                keyValue,
                newName ? "KTEXT" : null,
                newName,
                extra
              ]
            );
          }
        }

        // 4) Functional Location (TPLNR -> texte)
        if (row.TPLNR) {
          const keyValue = String(row.TPLNR).trim();
          if (keyValue) {
            const nameValue = String(
              row.PLTXT || row.PLTEXT || row.TPLTX || row.FLTEXT || row.FLTXT || ""
            ).trim();

            const extra = {};
            if (row.WERKS) extra.WERKS = row.WERKS;
            if (row.BEGRU) extra.BEGRU = row.BEGRU;

            const prev = await client.query(
              `
              SELECT name_value
              FROM dcf_entity_memory
              WHERE entity_type='functional_location' AND key_code='TPLNR' AND key_value=$1
              LIMIT 1
            `,
              [keyValue]
            );
            const prevName = prev.rows[0]?.name_value || null;
            const newName = nameValue || null;

            if (prevName && newName && prevName !== newName) {
              await client.query(
                `
                INSERT INTO dcf_entity_name_history(entity_type, key_code, key_value, old_name_value, new_name_value)
                VALUES ($1,$2,$3,$4,$5)
              `,
                ["functional_location", "TPLNR", keyValue, prevName, newName]
              );
            }

            await client.query(
              `
              INSERT INTO dcf_entity_memory(entity_type, key_code, key_value, name_code, name_value, extra)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT(entity_type, key_code, key_value)
              DO UPDATE SET
                name_value = COALESCE(EXCLUDED.name_value, dcf_entity_memory.name_value),
                extra = dcf_entity_memory.extra || EXCLUDED.extra,
                seen_count = dcf_entity_memory.seen_count + 1,
                last_seen_at = now()
            `,
              [
                "functional_location",
                "TPLNR",
                keyValue,
                newName ? "PLTXT" : null,
                newName,
                extra
              ]
            );
          }
        }
      }
    } finally {
      client.release();
    }
  } catch {}
}

async function fetchMemoryHintsFromText(text) {
  const nums = extractMaybeNumber(text);
  if (!nums.length) return [];

  try {
    const { rows } = await pool.query(
      `
      SELECT entity_type, key_code, key_value, name_value, extra
      FROM dcf_entity_memory
      WHERE key_value = ANY($1::text[])
      ORDER BY last_seen_at DESC
      LIMIT $2
    `,
      [nums, MAX_MEMORY_HINTS]
    );

    return rows.map((r) => {
      const extraStr = r.extra
        ? Object.entries(r.extra)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : "";
      return `- ${r.entity_type} ${r.key_code}=${r.key_value}${
        r.name_value ? ` -> "${r.name_value}"` : ""
      }${extraStr ? ` (${extraStr})` : ""}`;
    });
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------------
// 6. MULTER
// -----------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// -----------------------------------------------------------------------------
// 7. LENGTH NORMALIZATION (Instructions)
// -----------------------------------------------------------------------------

const SAP_MAXLEN = {
  KTEXT: 40,
  LTXA1: 40,
  TEXT1: 132,
  WPTXT: 40,
  PLTXT: 40,
  EQKTX: 40
};

function enforceSapLengthsOnSteps(steps = []) {
  return steps.map((s) => {
    const code = String(s.code || "").trim().toUpperCase();
    const maxLen = SAP_MAXLEN[code];
    if (!maxLen) return s;

    const val = String(s.value ?? "");
    if (val.length <= maxLen) return s;

    const truncated = val.slice(0, maxLen);
    const overflow = val.slice(maxLen);

    return {
      ...s,
      value: truncated,
      reason: `${
        s.reason ? s.reason + " | " : ""
      }Texte tronqué SAP (max ${maxLen}). Reste à mettre en long text: "${overflow.slice(
        0, 80
      )}${overflow.length > 80 ? "…" : ""}"`
    };
  });
}

// -----------------------------------------------------------------------------
// 8. ACTION COLUMN DETECTION
// -----------------------------------------------------------------------------

function detectPreferredActionCode(analysisLiteOrFull) {
  const sheets = analysisLiteOrFull?.sheets || [];
  const allCodes = [];
  for (const sh of sheets) {
    for (const c of sh.columns || []) {
      if (c?.code) allCodes.push(String(c.code).toUpperCase());
    }
  }
  if (allCodes.includes("ACTION_02")) return "ACTION_02";
  if (allCodes.includes("ACTION_01")) return "ACTION_01";
  const anyActionX = allCodes.find((c) => /^ACTION_\d+$/i.test(c));
  if (anyActionX) return anyActionX;
  return "ACTION";
}

function findColumnByCode(analysis, wantedCode) {
  const sheets = analysis?.sheets || [];
  const w = String(wantedCode).toUpperCase();
  for (const sh of sheets) {
    for (const col of sh.columns || []) {
      if (String(col.code).toUpperCase() === w) {
        return { sheet: sh.name, col: col.col };
      }
    }
  }
  return null;
}

function remapActionStepsToPreferred(steps, analysisFull, preferredActionCode) {
  const allowed = new Set(["insert", "change", "delete"]);
  const pref = String(preferredActionCode || "ACTION").toUpperCase();
  if (!steps.length) return steps;

  return steps.map((s) => {
    const code = String(s.code || "").toUpperCase();
    const val = String(s.value || "").trim().toLowerCase();

    const isActionStep =
      /^ACTION(_\d+)?$/i.test(code) && allowed.has(val);

    if (!isActionStep) return s;
    if (code === pref) return s;

    const targetPos = findColumnByCode(analysisFull, pref);
    if (!targetPos) {
      return { ...s, code: pref };
    }

    return {
      ...s,
      code: pref,
      col: targetPos.col,
      sheet: targetPos.sheet || s.sheet,
      reason: `${s.reason ? s.reason + " | " : ""}Action SAP remappée automatiquement vers ${pref}.`
    };
  });
}

// -----------------------------------------------------------------------------
// 9. WIZARD ROUTES
// -----------------------------------------------------------------------------

// ✅ ANALYZE renforcé + pré-routage TL+MP + clarifications scaffold
app.post("/api/dcf/wizard/analyze", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const msgLower = String(message || "").toLowerCase();
    const useCase = extractUseCaseFromText(message);

    const planNums = msgLower.match(/\b\d{6,12}\b/g) || [];
    const hasPlanWord =
      /plan\s*(de)?\s*(maintenance)?/.test(msgLower) ||
      /maintenance\s*plan/.test(msgLower);

    const wantsAddOperation =
      /(ajout|ajouter|rajoute|rajouter|crée|creer|insère|inserer|intègre|integrer|ajouter une|ajouter le)\b/.test(msgLower) &&
      /(opération|operation|contrôle|controle|check|vérif|verif|inspection|test)/.test(msgLower);

    const isAddOperationInExistingPlan =
      wantsAddOperation && hasPlanWord && planNums.length > 0;

    if (isAddOperationInExistingPlan) {
      const { rows: tlFile } = await pool.query(
        `SELECT id, filename FROM dcf_files 
         WHERE filename ILIKE '%task list%' 
         ORDER BY uploaded_at DESC LIMIT 1`
      );
      const { rows: mpFile } = await pool.query(
        `SELECT id, filename FROM dcf_files 
         WHERE filename ILIKE '%maintenance plan%' 
         ORDER BY uploaded_at DESC LIMIT 1`
      );

      const forcedOut = {
        action: "add_operation_in_plan",
        is_manual: false,
        reasoning:
          "Ajout d’une opération/contrôle dans un plan existant : protocole SAP = créer/ajouter l’opération dans la Task List puis rattacher au Maintenance Plan.",
        required_files: [
          tlFile[0]
            ? {
                type: "Task List",
                template_filename: tlFile[0].filename,
                file_id: tlFile[0].id,
                usage:
                  "Créer/ajouter l’opération (short text, long text, durée, nb personnes, workcenter)."
              }
            : null,
          mpFile[0]
            ? {
                type: "Maintenance Plan",
                template_filename: mpFile[0].filename,
                file_id: mpFile[0].id,
                usage:
                  `Rattacher la nouvelle opération au plan ${planNums[0]} (ou mettre à jour la TL liée).`
              }
            : null
        ].filter(Boolean),
        questions: [] // scaffold for future UX
      };

      if (sessionId) {
        await pool.query(
          `
          INSERT INTO dcf_requests
            (session_id, request_text, detected_action, detected_type, recommended_file_id, response_json)
          VALUES
            ($1,$2,$3,$4,$5,$6)
        `,
          [
            sessionId,
            message,
            forcedOut.action,
            forcedOut.required_files?.[0]?.type || null,
            forcedOut.required_files?.[0]?.file_id || null,
            forcedOut
          ]
        );

        await pool.query(
          `
          INSERT INTO dcf_messages (session_id, role, content)
          VALUES ($1,'assistant',$2)
        `,
          [sessionId, JSON.stringify(forcedOut)]
        );
      }

      return res.json(forcedOut);
    }

    const { rows: recentFiles } = await pool.query(
      `
      SELECT id, filename 
      FROM dcf_files
      WHERE file_data IS NOT NULL
      ORDER BY uploaded_at DESC
      LIMIT $1
    `,
      [MAX_FILES_LIBRARY]
    );

    const filesList = recentFiles
      .map((f) => `- ${f.filename} (ID: ${f.id})`)
      .join("\n");

    const memHints = await fetchMemoryHintsFromText(message);
    const memBlock = memHints.length
      ? `\nMEMOIRE METIER (si pertinente):\n${memHints.join("\n")}\n`
      : "";

    const systemPrompt = `
Tu es l'Expert Technique SAP DCF.

RÈGLES MÉTIER STRICTES (Protocole Charles):
1) MODIFICATION TEXTE uniquement (short/long text sans ajout/suppression d'opération) -> is_manual=true.
2) AJOUT / CREATION d'OPÉRATION dans une TL -> DCF Task List.
3) AJOUT d'une OPÉRATION/CONTRÔLE dans un PLAN EXISTANT -> DCF Task List + DCF Maintenance Plan.
4) AJOUT d'ÉQUIPEMENT dans un PLAN -> DCF Maintenance Plan + DCF Equipment si nouvel équipement.
5) DÉCOMMISSIONNEMENT -> DCF Task List + DCF Maintenance Plan + DCF Equipment.
6) Si doute entre (1) et (3) : privilégie DCF (is_manual=false).

Tu dois choisir uniquement parmi la bibliothèque ci-dessous.
`;

    const userPrompt = `
Demande utilisateur:
"${message}"
${memBlock}
Bibliothèque disponible:
${filesList}

Réponds en JSON STRICT uniquement:
{
  "action": "type_action",
  "is_manual": boolean,
  "reasoning": "texte court",
  "required_files": [
    {
      "type": "Task List | Maintenance Plan | Equipment | autres",
      "template_filename": "nom exact fichier",
      "file_id": 123,
      "usage": "ce qu'on va faire dans ce fichier"
    }
  ],
  "questions": [
    "questions de clarification si la demande est incomplète (non bloquant)"
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.0
    });

    const out = cleanJSON(completion.choices[0].message.content);

    if (sessionId) {
      const detectedType =
        (Array.isArray(out?.required_files) && out.required_files[0]?.type) ||
        null;

      const recommendedFileId =
        (Array.isArray(out?.required_files) &&
          out.required_files[0]?.file_id) ||
        null;

      await pool.query(
        `
        INSERT INTO dcf_requests
          (session_id, request_text, detected_action, detected_type, recommended_file_id, response_json)
        VALUES
          ($1, $2, $3, $4, $5, $6)
      `,
        [
          sessionId,
          message,
          out?.action || null,
          detectedType,
          recommendedFileId,
          out
        ]
      );

      await pool.query(
        `
        INSERT INTO dcf_messages (session_id, role, content)
        VALUES ($1, 'assistant', $2)
      `,
        [sessionId, JSON.stringify(out)]
      );
    }

    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ✅ INSTRUCTIONS renforcées + longueur SAP + ACTION aware + dropdowns
function validateAIColumns(out, templateFilename) {
  const window = getWindowForFilename(templateFilename);
  if (!window || !Array.isArray(out)) return { fixed: out || [], critical: [] };

  const start = letterToIndex(window.start);
  const end = letterToIndex(window.end);

  const fixed = [];
  const critical = [];

  for (const step of out) {
    const colLetter = String(step.col || "").trim().toUpperCase();
    const idx = letterToIndex(colLetter);
    if (!colLetter || idx < start || idx > end) {
      critical.push({
        sheet: step.sheet,
        row: step.row,
        col: step.col,
        code: step.code,
        label: step.label,
        value: step.value,
        mandatory: false,
        reason: `Colonne hors zone ${window.start}-${window.end} pour ${templateFilename}. Refusée.`
      });
      continue;
    }
    fixed.push(step);
  }

  return { fixed, critical };
}

app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename, attachmentIds = [] } =
      req.body;

    const { rows } = await pool.query(
      `
      SELECT id, filename, analysis, file_data
      FROM dcf_files
      WHERE filename = $1
      ORDER BY uploaded_at DESC
      LIMIT 1
    `,
      [templateFilename]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Template introuvable." });
    }

    const file = rows[0];

    const analysisFull = file.file_data
      ? buildDeepExcelAnalysis(file.file_data, file.filename)
      : null;

    const fileContext =
      file.analysis?.ai_context || analysisFull?.ai_context || "";

    const preferredActionCode = detectPreferredActionCode(
      file.analysis || analysisFull
    );

    let visionContext = "";
    if (attachmentIds.length) {
      const { rows: att } = await pool.query(
        `
        SELECT id, extracted_text
        FROM dcf_attachments
        WHERE id = ANY($1::int[])
      `,
        [attachmentIds]
      );

      visionContext = att
        .map((a) => a.extracted_text || "")
        .join("\n")
        .slice(0, MAX_ATTACHMENT_TEXT);
    }

    const memHints = await fetchMemoryHintsFromText(requestText);
    const memBlock = memHints.length
      ? `\nMEMOIRE METIER (si pertinente):\n${memHints.join("\n")}\n`
      : "";

    const dropdownBlock = dropdownBlockForPrompt(templateFilename);

    const prompt = `
Tu es un Expert SAP DCF. Tu dois remplir un fichier Excel DCF.

DEMANDE UTILISATEUR:
"${requestText}"
${memBlock}
FICHIER TEMPLATE:
"${templateFilename}"

STRUCTURE DU TEMPLATE:
${clampStr(fileContext, 5000)}

LISTES DEROUlANTES (IMPORTANT):
${dropdownBlock}
Règle: si un champ correspond à une liste déroulante, tu DOIS choisir une valeur dans la liste.
Si la valeur n’est pas claire dans la demande ou dans les captures SAP, pose une question dans "reason" et mets mandatory=false.

DONNÉES SAP (Vision OCR si dispo):
${visionContext || "N/A"}

CONTRAINTES SAP IMPORTANTES:
- KTEXT / LTXA1 (short text TL) : max 40 caractères
- TEXT1 (texte long court SAP) : max 132 caractères
- WPTXT / PLTXT / EQKTX : max 40 caractères
Si un texte dépasse, TRONQUE et mets le reste dans la “reason” comme long text.

ACTION SAP (IMPORTANT):
- Dans ce template, la vraie colonne d'action SAP est: ${preferredActionCode}.
- Quand tu dois mettre Insert/Change/Delete, écris TOUJOURS dans ${preferredActionCode}.
- N'utilise pas ACTION (simple) si elle sert à un usage métier.

INSTRUCTIONS:
- Génère une liste d’étapes ligne par ligne pour remplir le DCF, en respectant STRICTEMENT la structure du template.
- Chaque étape doit pointer une cellule (row, col), un code champ (code) et une valeur (value) prête à copier/coller.
- mandatory=true uniquement si le champ est réellement obligatoire SAP pour l’action demandée.
- Si le champ est optionnel, incertain, ou non applicable au cas, mets mandatory=false et explique clairement quoi demander / vérifier dans "reason".
- Ne remplis QUE les colonnes détectées dans STRUCTURE DU TEMPLATE. N’ajoute jamais une colonne hors fenêtre H→fin du template.
- **NE MODIFIE JAMAIS une colonne identifiée comme constante/figée** dans le contexte Excel, sauf si l’utilisateur demande explicitement un changement.
- **N’invente aucune valeur.** Si une valeur n’est pas certaine via la demande, une capture SAP, une liste déroulante, ou la mémoire, pose une question dans "reason" et mets mandatory=false.
- Si un champ a une liste déroulante: choisis une valeur AUTORISÉE. Si aucune ne colle, explique le doute dans "reason".
- ACTION SAP: utilise toujours ${preferredActionCode} pour Insert/Change/Delete.
- Conserve la cohérence intra-fichier: même WARPL/WPTXT/STRAT etc doivent rester identiques sur la même ligne de plan.

Réponds en JSON STRICT:
{
  "steps": [
    {
      "row": "6",
      "col": "H",
      "code": "WARPL",
      "label": "texte court",
      "value": "30482007",
      "reason": "pourquoi cette valeur / question si incertain",
      "mandatory": true,
      "sheet": "NomSheetOptionnel"
    }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Expert SAP DCF." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const out = cleanJSON(completion.choices[0].message.content);
    let steps = Array.isArray(out.steps) ? out.steps : [];

    steps = enforceSapLengthsOnSteps(steps);

    if (analysisFull) {
      steps = remapActionStepsToPreferred(
        steps,
        analysisFull,
        preferredActionCode
      );
    }

    if (sessionId) {
      await pool.query(
        `
        INSERT INTO dcf_messages (session_id, role, content)
        VALUES ($1, 'assistant', $2)
      `,
        [sessionId, JSON.stringify({ type: "steps", templateFilename, steps })]
      );
    }

    res.json(steps);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/dcf/wizard/autofill", async (req, res) => {
  try {
    const { templateFilename, instructions } = req.body;

    const { rows } = await pool.query(
      `
      SELECT filename, mime, file_data
      FROM dcf_files
      WHERE filename = $1
      ORDER BY uploaded_at DESC
      LIMIT 1
    `,
      [templateFilename]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Template introuvable." });
    }

    const tpl = rows[0];
    const wb = xlsx.read(tpl.file_data, { type: "buffer" });
    const steps = Array.isArray(instructions) ? instructions : [];

    for (const inst of steps) {
      const sheetName =
        inst.sheet && wb.Sheets[inst.sheet]
          ? inst.sheet
          : wb.SheetNames[0];

      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const cellAddress = `${inst.col}${inst.row}`;
      ws[cellAddress] = { t: "s", v: String(inst.value ?? "") };
    }

    const isXlsm = String(tpl.filename).toLowerCase().endsWith(".xlsm");
    const outBuffer = xlsx.write(wb, {
      type: "buffer",
      bookType: isXlsm ? "xlsm" : "xlsx"
    });

    res.setHeader(
      "Content-Type",
      isXlsm
        ? "application/vnd.ms-excel.sheet.macroEnabled.12"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="FILLED_${sanitizeName(tpl.filename)}"`
    );

    res.send(outBuffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ✅ VALIDATE intelligent scope-aware + ACTION multi-colonnes + dropdown-aware
app.post("/api/dcf/wizard/validate", async (req, res) => {
  try {
    const { fileIds, useCase = null } = req.body;
    if (!Array.isArray(fileIds) || !fileIds.length) {
      return res.status(400).json({ error: "fileIds manquant." });
    }

    const { rows: files } = await pool.query(
      `
      SELECT id, filename, analysis, file_data
      FROM dcf_files
      WHERE id = ANY($1::int[])
    `,
      [fileIds]
    );

    if (!files.length) {
      return res.status(404).json({ error: "Aucun fichier trouvé." });
    }

    const rebuilt = files.map((f) => {
      let full = null;
      try {
        if (f.file_data) {
          full = buildDeepExcelAnalysis(f.file_data, f.filename);
        }
      } catch {
        full = null;
      }
      return { ...f, analysis_full: full };
    });

    function getActiveRows(fullAnalysis) {
      const rowsIndex = fullAnalysis?.rows_index || {};
      const active = [];
      const allowed = new Set(["insert", "change", "delete"]);

      for (const key of Object.keys(rowsIndex)) {
        const row = rowsIndex[key];

        const actionKeys = Object.keys(row).filter(k =>
          /^ACTION(_\d+)?$/i.test(k)
        );

        let foundAction = null;
        for (const ak of actionKeys) {
          const val = String(row[ak] || "").trim().toLowerCase();
          if (allowed.has(val)) {
            foundAction = { action: val, col: ak };
            break;
          }
        }

        if (foundAction) {
          active.push({
            key,
            action: foundAction.action,
            action_col: foundAction.col,
            row
          });
        }
      }
      return active;
    }

    const activeRowsByFile = rebuilt.map((f) => ({
      id: f.id,
      filename: f.filename,
      active_rows: getActiveRows(f.analysis_full)
    }));

    const noActive = activeRowsByFile.every((f) => !f.active_rows.length);
    if (noActive) {
      return res.json({
        report:
          "Aucune vraie ACTION SAP détectée (Insert/Change/Delete). Vérifie ACTION_01/02/03.",
        critical: [],
        warnings: [],
        suggestions: []
      });
    }

    const context = JSON.stringify(activeRowsByFile).slice(0, MAX_CONTEXT_CHARS);

    // dropdowns summary per file
    const dropdownByFile = rebuilt.map((f) => ({
      filename: f.filename,
      dropdowns: getDropdownsForTemplate(f.filename)
    }));
    const dropdownContext = JSON.stringify(dropdownByFile).slice(0, 4000);

    const prompt = `
Tu valides des fichiers DCF SAP.

IMPORTANT:
- Ignore toutes les lignes sans vraie action SAP.
- Les actions SAP peuvent être dans ACTION, ACTION_01, ACTION_02, ACTION_03...
- Ne contrôle QUE les lignes avec Insert/Change/Delete.

Cas d'usage: ${useCase || "unknown"}.

LISTES DEROUlANTES (référence):
${dropdownContext}
Règle: si un champ possède une liste, une valeur hors liste = WARNING (pas critique pour l'instant).

Règles spécifiques:
- add_operation_in_plan:
  * Task List: EQUNR optionnel si non fourni par l’utilisateur.
  * Maintenance Plan: WARPL requis uniquement sur les lignes ACTION.
- text_only_change: ne pas exiger EQUNR/WARPL si pas liés à l'action.
- decommission: exiger cohérence TL+MP+Equipment sur lignes ACTION.

Données actives:
${context}

Réponds JSON STRICT:
{
  "report": "résumé global",
  "critical": ["erreurs bloquantes"],
  "warnings": ["points à vérifier"],
  "suggestions": ["améliorations possibles"]
}
`;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Validateur SAP DCF scope-aware." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    let out = cleanJSON(completion.choices[0].message.content);

    const toLine = (x) => {
      if (typeof x === "string") return x;
      if (!x || typeof x !== "object") return String(x ?? "");
      const sheet = x.sheet ? `[${x.sheet}] ` : "";
      const col = x.column ? `${x.column}: ` : "";
      const msg =
        x.suggestion ??
        x.warning ??
        x.message ??
        x.reason ??
        "";
      const line = `${sheet}${col}${msg}`.trim();
      return line || JSON.stringify(x);
    };

    out.critical = (out.critical || []).map(toLine);
    out.warnings = (out.warnings || []).map(toLine);
    out.suggestions = (out.suggestions || []).map(toLine);

    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// 10. UPLOAD ROUTES
// -----------------------------------------------------------------------------

app.post("/api/dcf/uploadExcel", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier." });

    const analysisFull = buildDeepExcelAnalysis(
      req.file.buffer,
      req.file.originalname
    );
    const analysisLite = shrinkAnalysisForDB(analysisFull);

    const storedName = `${Date.now()}_${sanitizeName(req.file.originalname)}`;
    const relPath = storedName;

    const { rows } = await pool.query(
      `
      INSERT INTO dcf_files
        (filename, stored_name, path, mime, bytes, sheet_names, analysis, file_data)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, filename, uploaded_at
    `,
      [
        req.file.originalname,
        storedName,
        relPath,
        req.file.mimetype,
        req.file.size,
        analysisFull.sheetNames,
        analysisLite,
        req.file.buffer
      ]
    );

    const fileId = rows[0].id;

    await indexFileValues(fileId, analysisFull);
    await indexEntityMemory(fileId, analysisFull);

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post(
  "/api/dcf/uploadExcelMulti",
  upload.array("files"),
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ error: "Aucun fichier." });
      }

      const out = [];
      for (const f of files) {
        const analysisFull = buildDeepExcelAnalysis(f.buffer, f.originalname);
        const analysisLite = shrinkAnalysisForDB(analysisFull);

        const storedName = `${Date.now()}_${sanitizeName(f.originalname)}`;
        const relPath = storedName;

        const { rows } = await pool.query(
          `
          INSERT INTO dcf_files
            (filename, stored_name, path, mime, bytes, sheet_names, analysis, file_data)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, filename, uploaded_at
        `,
          [
            f.originalname,
            storedName,
            relPath,
            f.mimetype,
            f.size,
            analysisFull.sheetNames,
            analysisLite,
            f.buffer
          ]
        );

        const fileId = rows[0].id;

        await indexFileValues(fileId, analysisFull);
        await indexEntityMemory(fileId, analysisFull);

        out.push(rows[0]);
      }

      res.json({ ok: true, files: out });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

// -----------------------------------------------------------------------------
// 11. SESSIONS
// -----------------------------------------------------------------------------

app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const title = req.body?.title || "Session DCF";
    const userEmail = getUserEmail(req);

    const { rows } = await pool.query(
      `
      INSERT INTO dcf_sessions (title, created_by)
      VALUES ($1, $2)
      RETURNING id
    `,
      [title, userEmail]
    );

    res.json({ ok: true, sessionId: rows[0].id });
  } catch (e) {
    try {
      const title = req.body?.title || "Session DCF";
      const { rows } = await pool.query(
        `
        INSERT INTO dcf_sessions (title)
        VALUES ($1)
        RETURNING id
      `,
        [title]
      );
      return res.json({ ok: true, sessionId: rows[0].id });
    } catch (e2) {
      console.error(e2);
      res.status(500).json({ error: e2.message });
    }
  }
});

app.get("/api/dcf/sessions", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM dcf_sessions ORDER BY created_at DESC LIMIT 20`
    );
    res.json({ ok: true, sessions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// 12. ATTACHMENTS (SAP screenshots)
// -----------------------------------------------------------------------------

app.post(
  "/api/dcf/attachments/upload",
  upload.array("files"),
  async (req, res) => {
    try {
      const files = req.files || [];
      const sessionId = req.body?.sessionId || null;

      if (!files.length) {
        return res.status(400).json({ error: "Aucun fichier image." });
      }

      const items = [];

      for (const f of files) {
        let extractedText = "";

        try {
          const b64 = f.buffer.toString("base64");
          const completion = await openai.chat.completions.create({
            model: VISION_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "Tu lis une capture SAP. Extrais les codes, ID opérations, numéros plan, équipements, functional location. Répond uniquement par le texte utile."
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "Lis cette capture SAP." },
                  {
                    type: "image_url",
                    image_url: { url: `data:${f.mimetype};base64,${b64}` }
                  }
                ]
              }
            ],
            temperature: 0.0
          });

          extractedText = completion.choices[0].message.content || "";
        } catch {
          extractedText = "";
        }

        const storedName = `${Date.now()}_${sanitizeName(f.originalname)}`;

        const { rows } = await pool.query(
          `
          INSERT INTO dcf_attachments
            (session_id, filename, stored_name, mime, bytes, file_data, extracted_text)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, filename
        `,
          [
            sessionId,
            f.originalname,
            storedName,
            f.mimetype,
            f.size,
            f.buffer,
            extractedText
          ]
        );

        items.push({
          id: rows[0].id,
          filename: rows[0].filename,
          extracted_text: extractedText
        });
      }

      res.json({ ok: true, items });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

// -----------------------------------------------------------------------------
// 13. GENERIC CHAT
// -----------------------------------------------------------------------------

app.post("/api/dcf/chat", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Assistant SAP." },
        { role: "user", content: req.body.message }
      ]
    });

    res.json({
      ok: true,
      answer: completion.choices[0].message.content
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// 14. FILES LIST + HEALTH
// -----------------------------------------------------------------------------

app.get("/api/dcf/files", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, filename, uploaded_at
      FROM dcf_files
      WHERE file_data IS NOT NULL
      ORDER BY uploaded_at DESC
      LIMIT 50
    `
    );

    res.json({ ok: true, files: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download a stored template/file by id (blank template support)
app.get("/api/dcf/files/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const { rows } = await pool.query(
      "SELECT filename, mime, file_data FROM dcf_files WHERE id=$1",
      [id]
    );
    if (!rows.length) return res.status(404).send("Not found");

    const f = rows[0];
    res.setHeader("Content-Type", f.mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(f.filename)}"`
    );
    return res.send(f.file_data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ⚡ NOUVEAU : Route debug pour analyse Excel détaillée
app.get("/api/dcf/files/:id/debug", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      "SELECT filename, file_data FROM dcf_files WHERE id=$1",
      [id]
    );
    
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    
    const file = rows[0];
    const fullAnalysis = buildDeepExcelAnalysis(file.file_data, file.filename);
    
    res.json({
      filename: file.filename,
      sheets: fullAnalysis.sheets,
      debug_logs: fullAnalysis.debug_info,
      ai_context: fullAnalysis.ai_context
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dcf/health", (req, res) =>
  res.json({ status: "ok", version: "7.5.0 Dropdown+Clarifications" })
);

// -----------------------------------------------------------------------------
// 15. START
// -----------------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v7.5.0] Backend démarré sur http://${HOST}:${PORT}`);
});
