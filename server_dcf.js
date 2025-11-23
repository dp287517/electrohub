// server_dcf.js — Assistant DCF SAP v7.4.2
// FULL FIX:
// - Conserve toutes les routes v7.x
// - Fix stack overflow: analysisLite en DB, analysisFull pour indexation
// - Analyse Excel robuste SAP
// - Mémoire relationnelle (Plan/Equip/TaskList) + historique des noms
// - Log sessions dans dcf_messages (dcf_steps n'existe pas dans ta DB)
// Node ESM

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import pg from "pg";
import OpenAI from "openai";
import xlsx from "xlsx";

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

// -----------------------------------------------------------------------------
// 3. SAFE MIGRATIONS (création tables mémoire si absent)
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
// 4. EXCEL ANALYSIS ROBUSTE
// -----------------------------------------------------------------------------

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
    .slice(0, 80);
  if (!cells.length) return false;
  const codeLike = cells.filter((c) => /^[A-Z0-9_]{3,}$/.test(c)).length;
  return codeLike / cells.length > 0.35;
}

function findHeaderRow(raw) {
  for (let r = 0; r < Math.min(raw.length, 35); r++) {
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

/**
 * Analyse SAP DCF robuste:
 * - codes/labels flexibles
 * - extracted_values (FULL)
 * - rows_index (FULL)
 */
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

    const columns = [];
    codesRow.forEach((code, idx) => {
      const c = String(code).trim();
      if (c.length > 1 && /[A-Za-z0-9]/.test(c)) {
        const label = String(labelsRow[idx] || "").trim();
        columns.push({ idx, col: columnIndexToLetter(idx), code: c, label });
      }
    });

    const dataStartIdx = headerRowIdx + 3;
    const dataRows = raw.slice(dataStartIdx);

    const extracted = [];
    dataRows.forEach((rowArr, ridx) => {
      const rowNumber = dataStartIdx + ridx + 1;
      const rowKey = `${sheetName}::${rowNumber}`;

      for (const colDef of columns) {
        const v = rowArr[colDef.idx];
        const val = String(v ?? "").trim();
        if (val !== "") {
          extracted.push({
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

    analysis.extracted_values.push(...extracted);

    const sheetContext =
      `SHEET "${sheetName}"\n` +
      `Colonnes détectées: ${columns
        .map((c) => `${c.code}${c.label ? ` (${c.label})` : ""} -> ${c.col}`)
        .join(", ")}\n` +
      `Header ligne ${headerRowIdx + 1} | Codes ligne ${
        looksLikeCodes(row1) ? headerRowIdx + 2 : headerRowIdx + 1
      }\n` +
      `Début données: ligne ${dataStartIdx + 1}\n`;

    globalContext += sheetContext + "\n";

    analysis.sheets.push({
      name: sheetName,
      headerRowIdx: headerRowIdx + 1,
      codesRowIdx: looksLikeCodes(row1) ? headerRowIdx + 2 : headerRowIdx + 1,
      columns,
      dataStartRow: dataStartIdx + 1,
      extracted_count: extracted.length
    });
  }

  analysis.ai_context = globalContext.trim();
  return analysis;
}

/**
 * NEW FIX: réduit l’analyse pour stockage DB (évite stack overflow)
 */
function shrinkAnalysisForDB(analysis) {
  return {
    filename: analysis.filename,
    sheetNames: analysis.sheetNames,
    ai_context: analysis.ai_context,
    sheets: analysis.sheets,
    extracted_count: analysis.extracted_values?.length || 0
  };
}

// -----------------------------------------------------------------------------
// 5. INDEXATION DB
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

        // --- Maintenance Plan
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

        // --- Equipment
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

        // --- Task list générique
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
// 7. WIZARD ROUTES
// -----------------------------------------------------------------------------

app.post("/api/dcf/wizard/analyze", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

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
1) MODIFICATION TEXTE uniquement -> is_manual=true.
2) AJOUT D'OPÉRATION -> Fichier Task List.
3) AJOUT D'ÉQUIPEMENT DANS PLAN -> Fichier Maintenance Plan.
4) DÉCOMMISSIONNEMENT -> 3 fichiers: Task List + Maintenance Plan + Equipment.

Tu dois choisir parmi la bibliothèque UTILE ci-dessous.
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
      await pool.query(
        `
        INSERT INTO dcf_requests (session_id, user_request, analysis_json)
        VALUES ($1, $2, $3)
      `,
        [sessionId, message, out]
      );

      // NEW: log dans dcf_messages (table existante)
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

app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename, attachmentIds = [] } =
      req.body;

    const { rows } = await pool.query(
      `
      SELECT id, filename, analysis
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
    const fileContext = file.analysis?.ai_context || "";

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

    const prompt = `
Tu es un Expert SAP DCF. Tu dois remplir un fichier Excel DCF.

DEMANDE UTILISATEUR:
"${requestText}"
${memBlock}
FICHIER TEMPLATE:
"${templateFilename}"

STRUCTURE DU TEMPLATE (résumé):
${clampStr(fileContext, 5000)}

DONNÉES SAP (Vision OCR si dispo):
${visionContext || "N/A"}

INSTRUCTIONS:
- Génère une liste d'étapes ligne par ligne pour remplir le DCF.
- Chaque étape doit pointer une cellule (row, col) et un code champ.
- Valeur prêtes à copier/coller.
- mandatory=true si c’est obligatoire.

Réponds en JSON STRICT:
{
  "steps": [
    {
      "row": "6",
      "col": "H",
      "code": "WARPL",
      "label": "texte court",
      "value": "30482007",
      "reason": "pourquoi cette valeur",
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
    const steps = Array.isArray(out.steps) ? out.steps : [];

    if (sessionId) {
      // log steps dans dcf_messages (pas de dcf_steps chez toi)
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

app.post("/api/dcf/wizard/validate", async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || !fileIds.length) {
      return res.status(400).json({ error: "fileIds manquant." });
    }

    const { rows: files } = await pool.query(
      `
      SELECT id, filename, analysis
      FROM dcf_files
      WHERE id = ANY($1::int[])
    `,
      [fileIds]
    );

    const context = files
      .map(
        (f) =>
          `Fichier: ${f.filename}\nStructure:\n${
            f.analysis?.ai_context || ""
          }`
      )
      .join("\n\n")
      .slice(0, MAX_CONTEXT_CHARS);

    const prompt = `
Valide ces fichiers DCF SAP et détecte incohérences.

CONTEXTE:
${context}

Réponds en JSON STRICT:
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
        { role: "system", content: "Validateur SAP DCF." },
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
// 8. UPLOAD ROUTES (FIX STACK OVERFLOW)
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
        analysisLite,     // ✅ DB reçoit version légère
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
            analysisLite,  // ✅ version légère en DB
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
// 9. SESSIONS
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
// 10. ATTACHMENTS (SAP screenshots)
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
// 11. GENERIC CHAT
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
// 12. FILES LIST + HEALTH
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
  res.json({ status: "ok", version: "7.4.2 Full Fix" })
);

// -----------------------------------------------------------------------------
// 13. START
// -----------------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v7.4.2] Backend démarré sur http://${HOST}:${PORT}`);
});
