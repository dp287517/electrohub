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
      file_id INT,
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
// 3bis. DROPDOWNS (CSV OPTIONAL)
// -----------------------------------------------------------------------------

let DROPDOWN_INDEX = null;

/**
 * CSV schema (from your file):
 * Fichier | Feuille | Cellules concernées | Nom/Source liste | Nb valeurs | Valeurs (liste complète)
 */
function loadDropdownCSV() {
  try {
    if (!fs.existsSync(DROPDOWN_CSV_PATH)) {
      DROPDOWN_INDEX = null;
      return;
    }

    const raw = fs.readFileSync(DROPDOWN_CSV_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const header = lines.shift();
    if (!header) return;

    const idx = new Map();

    for (const line of lines) {
      // naive CSV split (works with your current export)
      const parts = line.split(",");
      if (parts.length < 6) continue;

      const fichier = (parts[0] || "").trim();
      const feuille = (parts[1] || "").trim();
      const cellules = (parts[2] || "").trim();
      const listName = (parts[3] || "").trim();
      const nb = Number((parts[4] || "0").trim()) || 0;
      const valuesStr = parts.slice(5).join(",").trim(); // keep commas inside list
      const values = valuesStr
        .split(/\s*,\s*/)
        .map((v) => v.trim())
        .filter(Boolean);

      const key = fichier.toLowerCase();
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push({
        fichier,
        feuille,
        cellules,
        listName,
        nb,
        values
      });
    }

    DROPDOWN_INDEX = idx;
    console.log(`✅ Dropdown CSV chargé: ${idx.size} fichiers indexés`);
  } catch (e) {
    console.warn("⚠️ Dropdown CSV non chargé:", e.message);
    DROPDOWN_INDEX = null;
  }
}

loadDropdownCSV();

/**
 * Return dropdown entries matching a template filename (case-insensitive contains).
 */
function getDropdownsForTemplate(templateFilename = "") {
  if (!DROPDOWN_INDEX) return [];
  const tf = templateFilename.toLowerCase();
  for (const [k, arr] of DROPDOWN_INDEX.entries()) {
    if (tf.includes(k)) return arr;
  }
  // fallback: try partial match
  for (const [k, arr] of DROPDOWN_INDEX.entries()) {
    if (k.includes(tf) || tf.includes(k)) return arr;
  }
  return [];
}

function dropdownBlockForPrompt(templateFilename) {
  const dds = getDropdownsForTemplate(templateFilename);
  if (!dds.length) return "N/A";

  return dds
    .map((d) => {
      const vals = d.values.slice(0, 80).join(", ");
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

function rowHasAnyDataInColumns(rowArr, columns) {
  for (const colDef of columns) {
    const v = String(rowArr[colDef.idx] ?? "").trim();
    if (v !== "") return true;
  }
  return false;
}

function findDataStartIdx(raw, headerRowIdx, columns) {
  let i = headerRowIdx + 1;

  while (i < raw.length) {
    const row = raw[i] || [];
    const isEmpty = row.every((c) => String(c ?? "").trim() === "");
    const isCodes = looksLikeCodes(row);

    if (isEmpty || isCodes) {
      i++;
      continue;
    }
    if (rowHasAnyDataInColumns(row, columns)) return i;

    i++;
  }
  return headerRowIdx + 2;
}

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

function applyHStartHeuristic(columns) {
  // Si on a clairement un template SAP où les colonnes utiles démarrent en H (idx>=7),
  // on ignore A..G pour éviter pollution/décalage.
  const beforeH = columns.filter((c) => c.idx < 7);
  const fromH = columns.filter((c) => c.idx >= 7);

  if (!beforeH.length || !fromH.length) return columns;

  // Heuristique: si la majorité des colonnes sont >=H, on filtre A..G.
  if (fromH.length >= beforeH.length * 2) return fromH;

  return columns;
}

function buildDeepExcelAnalysis(buffer, originalName = "") {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: false });
  const analysis = {
    filename: originalName,
    sheetNames: wb.SheetNames || [],
    ai_context: "",
    sheets: [],
    extracted_values: [],
    rows_index: {}
  };

  let globalContext = "";

  for (const sheetName of analysis.sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!raw.length) continue;

    const headerRowIdx = findHeaderRow(raw);

    const row0 = raw[headerRowIdx] || [];
    const row1 = raw[headerRowIdx + 1] || [];

    const codesRow = looksLikeCodes(row1) ? row1 : row0;
    const labelsRow = looksLikeCodes(row1) ? row0 : row1;

    let columns = [];
    codesRow.forEach((code, idx) => {
      const c = String(code).trim();
      if (c.length > 1 && /[A-Za-z0-9]/.test(c)) {
        const label = String(labelsRow[idx] || "").trim();
        columns.push({ idx, col: columnIndexToLetter(idx), code: c, label });
      }
    });

    columns = applyHStartHeuristic(columns);

    // Début données dynamique
    const dataStartIdx = findDataStartIdx(raw, headerRowIdx, columns);
    const dataRows = raw.slice(dataStartIdx);

    // Stats colonnes (constantes)
    const colStats = computeColumnStats(dataRows, columns);

    // Première ligne exemple "réelle"
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
      `Header ligne ${headerRowIdx + 1} | Codes ligne ${
        looksLikeCodes(row1) ? headerRowIdx + 2 : headerRowIdx + 1
      }\n` +
      `Début données détecté: ligne ${dataStartIdx + 1}\n` +
      `Exemple ligne ${exampleRowNumber || "?"}: ${exampleStr}\n` +
      (constantStr
        ? `Colonnes constantes (souvent figées / ne pas modifier sauf action explicite): ${constantStr}\n`
        : "");

    globalContext += sheetContext + "\n";

    analysis.sheets.push({
      name: sheetName,
      headerRowIdx: headerRowIdx + 1,
      codesRowIdx: looksLikeCodes(row1) ? headerRowIdx + 2 : headerRowIdx + 1,
      columns,
      dataStartRow: dataStartIdx + 1,
      extracted_count: extractedCount
    });
  }

  analysis.ai_context = globalContext.trim();
  return analysis;
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
- Génère une liste d'étapes ligne par ligne pour remplir le DCF.
- Chaque étape doit pointer une cellule (row, col) et un code champ.
- Valeur prêtes à copier/coller.
- mandatory=true si c’est obligatoire.
- Si le champ est optionnel ou incertain, mets mandatory=false et explique quoi demander.
- **NE MODIFIE JAMAIS une colonne identifiée comme constante/figée dans le template** (voir "Colonnes constantes" dans STRUCTURE DU TEMPLATE), sauf si l’utilisateur demande explicitement un changement. Pour ces champs, recopie la valeur constante si nécessaire ou laisse vide si déjà pré-rempli.
- **N’invente aucune valeur**. Si tu n’as pas une valeur certaine (demande utilisateur, SAP Vision, lignes exemples, mémoire), pose une question dans "reason" et mets mandatory=false.
- **Respecte les plages de colonnes utiles du template** : ne remplis que les colonnes détectées dans STRUCTURE DU TEMPLATE. Ne crée pas de colonnes supplémentaires.
- **ACTION**: utilise uniquement Insert / Change / Delete et écris-la dans la colonne d’action SAP préférée (ex ACTION_02). Si l’action manque, demande clarification.

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

app.get("/api/dcf/health", (req, res) =>
  res.json({ status: "ok", version: "7.4.9 Dropdown+Clarifications" })
);

// -----------------------------------------------------------------------------
// 15. START
// -----------------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v7.5.0] Backend démarré sur http://${HOST}:${PORT}`);
});
