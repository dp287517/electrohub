// server_dcf.js — Assistant DCF SAP v3
// Node ESM

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import xlsx from "xlsx";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------
const PORT = Number(process.env.DCF_PORT || 3030);
const HOST = process.env.DCF_HOST || "127.0.0.1";

const DATA_ROOT = path.join(process.cwd(), "uploads", "dcf");
const EXCEL_DIR = path.join(DATA_ROOT, "excel");
const ATTACH_DIR = path.join(DATA_ROOT, "attachments");

await fsp.mkdir(EXCEL_DIR, { recursive: true });
await fsp.mkdir(ATTACH_DIR, { recursive: true });

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const ANSWER_MODEL = process.env.DCF_MODEL || "gpt-4o";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o";

// DB Neon / Postgres
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------
function safeEmail(x) {
  if (!x) return null;
  const s = String(x).trim();
  return s && /\S+@\S+\.\S+/.test(s) ? s.toLowerCase() : null;
}

function getUserEmail(req) {
  return (
    safeEmail(req.headers["x-user-email"]) ||
    safeEmail(req.headers["x-user_email"]) ||
    null
  );
}

function sanitizeName(name = "") {
  return String(name).replace(/[^\w.\-]+/g, "_");
}

function columnIndexToLetter(idx) {
  // 0 -> A, 1 -> B…
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = ((n - 1) % 26) + 65;
    s = String.fromCharCode(r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// -----------------------------------------------------------------------------
// Analyse Excel v3 — buildDeepExcelAnalysis
// -----------------------------------------------------------------------------

/**
 * Objet minimal pour représenter un champ SAP DCF.
 * Dans la pratique, tu pourras enrichir SAP_FIELD_DICTIONARY
 * à partir de tes templates Defaults. :contentReference[oaicite:3]{index=3}
 */
const SAP_FIELD_DICTIONARY = {
  VORNR_01: {
    name: "Operation Number",
    description: "Numéro d'opération (0010, 0020...)",
    mandatory: true,
  },
  "ARBPL-02": {
    name: "Work Center (opération)",
    description: "Poste de travail (ELEC01, MECA01...)",
    mandatory: true,
  },
  STEUS: {
    name: "Control Key",
    description: "Clé de contrôle (PM01, PM02...)",
    mandatory: true,
  },
  LTXA1: {
    name: "Operation Short Text",
    description: "Texte court (max 40 caractères)",
    mandatory: true,
  },
  ARBEI: {
    name: "Work / Durée",
    description: "Durée de travail (0.5, 1, 1.5...)",
    mandatory: true,
  },
  ARBEH: {
    name: "Unit",
    description: "Unité (H, MIN, J)",
    mandatory: true,
  },
  ANZZL: {
    name: "Number of Persons",
    description: "Nombre de personnes (1, 2...)",
    mandatory: true,
  },
  // ➕ à compléter au besoin avec les 40+ champs décrits dans ta doc
};

function buildDeepExcelAnalysis(absPath) {
  try {
    const wb = xlsx.readFile(absPath, {
      cellDates: false,
      sheetRows: 0, // lecture complète
    });

    const sheetNames = wb.SheetNames || [];
    const analysis = {
      totalSheets: sheetNames.length,
      sheetNames,
      sheets: {}, // par feuille
      dictionary: {}, // champs détectés dans ce fichier
      dcfZones: [], // zones de lignes avec données DCF
      ai_preview: "", // gros texte pour l'IA
    };

    for (const sheetName of sheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const ref = ws["!ref"] || "A1";
      const range = xlsx.utils.decode_range(ref);
      const totalRows = range.e.r + 1;
      const totalCols = range.e.c + 1;

      const raw = xlsx.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: "",
      });

      if (!raw.length) {
        analysis.sheets[sheetName] = {
          totalRows,
          totalCols,
          headersRow: null,
          codesRow: null,
          mandatoryRow: null,
          columns: [],
          dcfRowCount: 0,
          sample: [],
        };
        continue;
      }

      // Heuristiques DCF : 
      // - on cherche une ligne contenant "ACTION" / "Line"
      // - on considère la ligne suivante comme Field Names (codes SAP)
      // - encore suivante comme Mandatory. :contentReference[oaicite:4]{index=4}
      let headerRowIdx = null;
      for (let i = 0; i < Math.min(raw.length, 10); i++) {
        const row = raw[i].map((c) => String(c || "").toUpperCase());
        if (
          row.some((c) => c === "ACTION") &&
          row.some((c) => c === "LINE")
        ) {
          headerRowIdx = i;
          break;
        }
      }

      const codesRowIdx =
        headerRowIdx !== null && raw[headerRowIdx + 1]
          ? headerRowIdx + 1
          : null;
      const mandatoryRowIdx =
        codesRowIdx !== null && raw[codesRowIdx + 1]
          ? codesRowIdx + 1
          : null;

      const codesRow =
        codesRowIdx !== null ? raw[codesRowIdx] || [] : [];
      const mandatoryRow =
        mandatoryRowIdx !== null ? raw[mandatoryRowIdx] || [] : [];

      const columns = [];
      const localDict = {};

      for (let c = 0; c < totalCols; c++) {
        const colLetter = columnIndexToLetter(c);
        const fieldCode = String(codesRow[c] || "").trim();
        const mandatoryRaw = String(
          mandatoryRow[c] || ""
        ).toUpperCase();

        const mandatory =
          mandatoryRaw.includes("⚠") ||
          mandatoryRaw.includes("MANDATORY") ||
          mandatoryRaw === "X";

        if (!fieldCode) continue;

        const dictInfo = SAP_FIELD_DICTIONARY[fieldCode] || {};
        const colInfo = {
          columnIndex: c,
          columnLetter: colLetter,
          fieldCode,
          fieldName: dictInfo.name || null,
          description: dictInfo.description || null,
          mandatory: dictInfo.mandatory || mandatory,
        };

        columns.push(colInfo);
        analysis.dictionary[fieldCode] = {
          ...(analysis.dictionary[fieldCode] || {}),
          ...colInfo,
        };
      }

      // Détection de lignes DCF "pleines"
      const dcfRows = [];
      for (let r = (mandatoryRowIdx || 4) + 1; r < raw.length; r++) {
        const row = raw[r];
        let hasData = false;
        for (const col of columns) {
          const v = row[col.columnIndex];
          if (v && String(v).trim()) {
            hasData = true;
            break;
          }
        }
        if (hasData) {
          dcfRows.push({
            rowIndex: r, // index 0-based
            excelRow: r + 1, // index Excel 1-based
            cells: row,
          });
        }
      }

      analysis.sheets[sheetName] = {
        totalRows,
        totalCols,
        headersRow: headerRowIdx,
        codesRow: codesRowIdx,
        mandatoryRow: mandatoryRowIdx,
        columns,
        dcfRowCount: dcfRows.length,
        sample: raw.slice(0, 12),
      };

      if (dcfRows.length) {
        analysis.dcfZones.push({
          sheet: sheetName,
          rows: dcfRows.slice(0, 50), // on limite un peu
        });
      }
    }

    analysis.ai_preview = generateEnrichedAIContext(analysis);
    return analysis;
  } catch (e) {
    console.error("[dcf] buildDeepExcelAnalysis error", e);
    return {
      error: e.message,
      totalSheets: 0,
      sheetNames: [],
      sheets: {},
      dictionary: {},
      dcfZones: [],
      ai_preview: "",
    };
  }
}

function generateEnrichedAIContext(analysis) {
  // Texte d’environ 10–15K caractères max pour l’IA
  let out = "";
  out += "=== CONTEXTE DCF SAP (Analyse Excel) ===\n";
  out += `Nombre de feuilles: ${analysis.totalSheets}\n`;
  out += `Feuilles: ${analysis.sheetNames.join(", ")}\n\n`;

  const codes = Object.keys(analysis.dictionary);
  if (codes.length) {
    out += "=== CHAMPS SAP DÉTECTÉS ===\n";
    for (const code of codes) {
      const f = analysis.dictionary[code];
      out += `- ${code} (${f.fieldName || "?"}) → Col ${f.columnLetter}`;
      if (f.mandatory) out += " [OBLIGATOIRE]";
      if (f.description) out += ` – ${f.description}`;
      out += "\n";
    }
    out += "\n";
  }

  for (const [sheetName, sheet] of Object.entries(analysis.sheets)) {
    out += `--- Feuille: ${sheetName} ---\n`;
    out += `Dimensions: ${sheet.totalRows} lignes x ${sheet.totalCols} colonnes\n`;
    if (sheet.columns?.length) {
      out += `Colonnes DCF mappées: ${sheet.columns
        .map(
          (c) =>
            `${c.columnLetter}:${c.fieldCode}${
              c.mandatory ? "![OBL]" : ""
            }`
        )
        .join(", ")}\n`;
    }
    if (sheet.sample?.length) {
      out += "\nExtrait des premières lignes (tabulé):\n";
      const csv = sheet.sample
        .map((row) => row.slice(0, 15).join("\t"))
        .join("\n");
      out += csv + "\n\n";
    }

    if (out.length > 12000) {
      out +=
        "\n[Preview tronqué pour rester dans les limites de tokens]\n";
      break;
    }
  }

  if (analysis.dcfZones?.length) {
    out += "\n=== ZONES DCF (lignes avec données) ===\n";
    for (const zone of analysis.dcfZones) {
      out += `Feuille ${zone.sheet}: ${zone.rows.length} lignes avec opérations\n`;
      for (const row of zone.rows.slice(0, 5)) {
        out += `  Ligne Excel ${row.excelRow}: ${JSON.stringify(
          row.cells.slice(0, 15)
        )}\n`;
      }
    }
  }

  return out;
}

// -----------------------------------------------------------------------------
// Analyse images SAP (OCR via Vision)
// -----------------------------------------------------------------------------
async function analyzeImageSAP(imagePath) {
  try {
    const buffer = await fsp.readFile(imagePath);
    const base64 = buffer.toString("base64");
    const mime = imagePath.match(/\.jpe?g$/i)
      ? "image/jpeg"
      : imagePath.match(/\.png$/i)
      ? "image/png"
      : "image/png";

    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Tu es un expert SAP PM. Tu reçois des captures d'écran SAP (transactions IP02, IA05, etc.) et tu dois en extraire TOUTES les infos utiles pour remplir un DCF : numéros de plan, task list, work center, opération, textes, durées, messages d'erreur. Réponds en JSON structuré.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${base64}`,
              },
            },
            {
              type: "text",
              text: "Analyse cette capture SAP pour aider à remplir/valider un DCF.",
            },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0.1,
    });

    const content = response.choices?.[0]?.message?.content || "{}";

    try {
      return { type: "json", data: JSON.parse(content) };
    } catch {
      return { type: "text", data: content };
    }
  } catch (e) {
    console.error("[dcf] analyzeImageSAP error", e);
    return { type: "error", data: e.message };
  }
}

// -----------------------------------------------------------------------------
// Multer (uploads)
// -----------------------------------------------------------------------------
const excelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, EXCEL_DIR),
  filename: (_req, file, cb) => {
    const base = sanitizeName(file.originalname || "dcf.xlsx");
    const ts = new Date().toISOString().replace(/[:.]/g, "");
    cb(null, `${ts}_${base}`);
  },
});

const attachStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ATTACH_DIR),
  filename: (_req, file, cb) => {
    const base = sanitizeName(file.originalname || "file.bin");
    const ts = new Date().toISOString().replace(/[:.]/g, "");
    cb(null, `${ts}_${base}`);
  },
});

const uploadExcel = multer({
  storage: excelStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

const uploadAttach = multer({
  storage: attachStorage,
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
});

// -----------------------------------------------------------------------------
// Schéma DB
// -----------------------------------------------------------------------------
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_files (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime TEXT,
      bytes BIGINT,
      sheet_names TEXT[],
      analysis JSONB,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email TEXT,
      title TEXT,
      context_file_ids INT[],
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id UUID REFERENCES dcf_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_attachments (
      id SERIAL PRIMARY KEY,
      session_id UUID NULL REFERENCES dcf_sessions(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime TEXT,
      bytes BIGINT,
      ocr_analysis JSONB,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dcf_messages_session
    ON dcf_messages(session_id, id)
  `);
}

await ensureSchema();

// -----------------------------------------------------------------------------
// PROMPTS IA
// -----------------------------------------------------------------------------
function getEnrichedSystemPrompt(mode, ctx) {
  const base =
    "Tu es un expert SAP PM et DCF. Tu connais la structure exacte des fichiers DCF (Task List, Maintenance Plan, Equipment) : " +
    "lignes, colonnes, codes SAP (VORNR_01, LTXA1, ARBEI, etc.) et champs obligatoires. " +
    "Tu réponds toujours en FRANÇAIS, de manière très concrète, avec :\n" +
    "- la FEUILLE quand c'est utile (ex: DCF)\n" +
    "- le NUMÉRO DE LIGNE EXCEL (par ex: Ligne 15)\n" +
    "- la LETTRE DE COLONNE (par ex: AJ)\n" +
    "- le CODE SAP du champ (par ex: LTXA1)\n" +
    "- ce qu'il faut ÉCRIRE exactement dans la cellule\n\n" +
    "Tu t'appuies sur le contexte d'analyse du fichier DCF (colonnes détectées, champs obligatoires, exemples de valeurs) " +
    "et sur les éventuelles captures SAP OCR pour donner des réponses PRÉCISES, PAS génériques.\n";

  const ctxText = [];
  if (ctx?.excel) {
    ctxText.push(
      "=== CONTEXTE EXCEL DCF ===\n" + ctx.excel.slice(0, 8000)
    );
  }
  if (ctx?.ocr) {
    ctxText.push(
      "=== CONTEXTE CAPTURES SAP (OCR) ===\n" + ctx.ocr.slice(0, 4000)
    );
  }

  let modeSpec = "";
  if (mode === "guidage") {
    modeSpec =
      "MODE GUIDAGE SAP: tu donnes des instructions PAS À PAS, structurées en blocs, pour que l'utilisateur puisse remplir ou modifier le DCF. " +
      "Tu utilises un format de type boîtes, par exemple :\n" +
      "Ligne 15, Colonne AJ (LTXA1 - Operation Short Text)\n" +
      "  📝 Écris: ...\n" +
      "  ⚠️  OBLIGATOIRE | Max 40 caractères\n";
  } else if (mode === "validation") {
    modeSpec =
      "MODE VALIDATION: tu analyses les fichiers DCF pour trouver les ERREURS. " +
      "Tu sépares bien :\n" +
      "1) Erreurs critiques (bloquantes) avec ligne/colonne/champ précis\n" +
      "2) Avertissements (à vérifier)\n" +
      "3) Suggestions d'amélioration\n";
  } else {
    modeSpec =
      "MODE CHAT GÉNÉRAL: tu expliques clairement la logique SAP / DCF, " +
      "mais tu continues à être concret et pratique (ligne/colonne) dès que possible.\n";
  }

  return base + "\n" + modeSpec + "\n\n" + ctxText.join("\n\n");
}

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------

// Healthcheck
app.get("/api/dcf/health", (_req, res) => {
  res.json({
    ok: true,
    service: "dcf-v3",
    time: new Date().toISOString(),
  });
});

// Upload Excel MULTI
app.post(
  "/api/dcf/uploadExcelMulti",
  uploadExcel.array("files", 10),
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res
          .status(400)
          .json({ ok: false, error: "Aucun fichier reçu" });
      }

      const out = [];
      for (const file of files) {
        const absPath = file.path;
        const analysis = buildDeepExcelAnalysis(absPath);

        const { rows } = await pool.query(
          `INSERT INTO dcf_files (filename, stored_name, path, mime, bytes, sheet_names, analysis)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, filename, sheet_names, uploaded_at`,
          [
            file.originalname,
            file.filename,
            absPath,
            file.mimetype || null,
            file.size || null,
            analysis.sheetNames?.length
              ? analysis.sheetNames
              : null,
            analysis,
          ]
        );
        out.push(rows[0]);
      }

      res.json({ ok: true, files: out });
    } catch (e) {
      console.error("[dcf] uploadExcelMulti error", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// Upload Excel SIMPLE (retro-compat)
app.post(
  "/api/dcf/uploadExcel",
  uploadExcel.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ ok: false, error: "Fichier manquant" });
      }
      const file = req.file;
      const absPath = file.path;
      const analysis = buildDeepExcelAnalysis(absPath);

      const { rows } = await pool.query(
        `INSERT INTO dcf_files (filename, stored_name, path, mime, bytes, sheet_names, analysis)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, filename, sheet_names, uploaded_at`,
        [
          file.originalname,
          file.filename,
          absPath,
          file.mimetype || null,
          file.size || null,
          analysis.sheetNames?.length
            ? analysis.sheetNames
            : null,
          analysis,
        ]
      );

      res.json({ ok: true, file: rows[0] });
    } catch (e) {
      console.error("[dcf] uploadExcel error", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// Liste fichiers
app.get("/api/dcf/files", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, sheet_names, uploaded_at
       FROM dcf_files
       ORDER BY uploaded_at DESC, id DESC`
    );
    res.json({ ok: true, files: rows });
  } catch (e) {
    console.error("[dcf] list files error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Détails fichier
app.get("/api/dcf/files/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, sheet_names, analysis, uploaded_at
       FROM dcf_files WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res
        .status(404)
        .json({ ok: false, error: "Fichier DCF introuvable" });
    }
    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error("[dcf] get file error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Upload pièces jointes (images SAP)
app.post(
  "/api/dcf/attachments/upload",
  uploadAttach.array("files", 20),
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res
          .status(400)
          .json({ ok: false, error: "Aucun fichier reçu" });
      }
      const sessionId = req.body?.session_id || null;

      const items = [];
      for (const f of files) {
        let ocr = null;
        const isImage = /^image\//i.test(f.mimetype || "");
        if (isImage) {
          ocr = await analyzeImageSAP(f.path);
        }
        const { rows } = await pool.query(
          `INSERT INTO dcf_attachments (session_id, filename, stored_name, path, mime, bytes, ocr_analysis)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, filename, uploaded_at, ocr_analysis`,
          [
            sessionId || null,
            f.originalname,
            f.filename,
            f.path,
            f.mimetype || null,
            f.size || null,
            ocr ? ocr : null,
          ]
        );
        items.push(rows[0]);
      }

      res.json({ ok: true, items });
    } catch (e) {
      console.error("[dcf] upload attachments error", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// Créer une session
app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const title = req.body?.title || "Session DCF";
    const contextFileIds = req.body?.context_file_ids || [];

    const { rows } = await pool.query(
      `INSERT INTO dcf_sessions (user_email, title, context_file_ids)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [email, title, contextFileIds]
    );

    res.json({ ok: true, sessionId: rows[0].id });
  } catch (e) {
    console.error("[dcf] startSession error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Liste sessions (pour le menu déroulant)
app.get("/api/dcf/sessions", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const params = [];
    let where = "";
    if (email) {
      where = "WHERE user_email = $1";
      params.push(email);
    }
    const { rows } = await pool.query(
      `SELECT id, user_email, title, context_file_ids, created_at, updated_at
       FROM dcf_sessions
       ${where}
       ORDER BY created_at DESC
       LIMIT 50`,
      params
    );
    res.json({ ok: true, sessions: rows });
  } catch (e) {
    console.error("[dcf] list sessions error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Récupérer une session + messages
app.get("/api/dcf/session/:id", async (req, res) => {
  try {
    const { rows: srows } = await pool.query(
      `SELECT id, user_email, title, context_file_ids, created_at, updated_at
       FROM dcf_sessions WHERE id = $1`,
      [req.params.id]
    );
    if (!srows[0]) {
      return res
        .status(404)
        .json({ ok: false, error: "Session inconnue" });
    }
    const { rows: msgs } = await pool.query(
      `SELECT role, content, metadata, created_at
       FROM dcf_messages
       WHERE session_id = $1
       ORDER BY id ASC`,
      [req.params.id]
    );
    res.json({ ok: true, session: srows[0], messages: msgs });
  } catch (e) {
    console.error("[dcf] get session error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// VALIDATION
app.post("/api/dcf/validate", async (req, res) => {
  try {
    const { fileIds = [], mode = "auto" } = req.body || {};
    if (!fileIds.length) {
      return res
        .status(400)
        .json({ ok: false, error: "Aucun fichier à valider" });
    }

    const { rows: files } = await pool.query(
      `SELECT id, filename, analysis
       FROM dcf_files
       WHERE id = ANY($1::int[])`,
      [fileIds]
    );
    if (!files.length) {
      return res
        .status(404)
        .json({ ok: false, error: "Fichiers non trouvés" });
    }

    const validationContext = files
      .map((f) => {
        const a = f.analysis || {};
        return (
          `Fichier: ${f.filename}\n` +
          (a.ai_preview ||
            a.preview ||
            "[Pas de contexte détaillé disponible]")
        );
      })
      .join("\n\n---\n\n");

    const sysText = getEnrichedSystemPrompt("validation", {
      excel: validationContext,
    });

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: sysText },
        {
          role: "user",
          content:
            "Valide ces fichiers DCF. Donne un rapport structuré en trois sections : " +
            "1) Erreurs critiques, 2) Avertissements, 3) Suggestions. " +
            "Indique toujours la feuille, la ligne, la colonne (lettre) et le code SAP quand c'est possible.",
        },
      ],
      temperature: 0.1,
    });

    const report =
      completion.choices?.[0]?.message?.content ||
      "Validation impossible";

    res.json({
      ok: true,
      report,
      files: files.map((f) => f.filename),
    });
  } catch (e) {
    console.error("[dcf] validate error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// CHAT IA
app.post("/api/dcf/chat", async (req, res) => {
  try {
    const {
      message,
      sessionId: rawSessionId,
      fileIds = [],
      attachmentIds = [],
      mode = "guidage",
      useCase = null,
    } = req.body || {};

    if (!message || typeof message !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "message requis" });
    }

    const email = getUserEmail(req);
    let sessionId = rawSessionId || null;

    // Crée la session si besoin
    if (!sessionId) {
      const { rows } = await pool.query(
        `INSERT INTO dcf_sessions (user_email, title, context_file_ids)
         VALUES ($1,$2,$3)
         RETURNING id`,
        [
          email,
          useCase
            ? `DCF – ${useCase}`
            : "Session DCF Assistant",
          fileIds,
        ]
      );
      sessionId = rows[0].id;
    } else {
      await pool.query(
        `UPDATE dcf_sessions
         SET context_file_ids = $1, updated_at = now()
         WHERE id = $2`,
        [fileIds, sessionId]
      );
    }

    // Contexte Excel
    let excelContext = "";
    if (fileIds.length) {
      const { rows: files } = await pool.query(
        `SELECT filename, analysis
         FROM dcf_files
         WHERE id = ANY($1::int[])`,
        [fileIds]
      );
      excelContext = files
        .map((f) => {
          const a = f.analysis || {};
          return (
            `Fichier: ${f.filename}\n` +
            (a.ai_preview ||
              a.preview ||
              "[Pas de contexte détaillé]")
          );
        })
        .join("\n\n---\n\n");
    }

    // Contexte OCR
    let ocrContext = "";
    if (attachmentIds.length) {
      const { rows: atts } = await pool.query(
        `SELECT id, filename, ocr_analysis
         FROM dcf_attachments
         WHERE id = ANY($1::int[])`,
        [attachmentIds]
      );
      ocrContext = atts
        .map((a) => {
          if (!a.ocr_analysis) return `Image: ${a.filename}`;
          return `Image: ${a.filename}\n${JSON.stringify(
            a.ocr_analysis
          )}`;
        })
        .join("\n\n");
    }

    // Historique limité
    const { rows: history } = await pool.query(
      `SELECT role, content
       FROM dcf_messages
       WHERE session_id = $1
       ORDER BY id ASC
       LIMIT 30`,
      [sessionId]
    );

    const sysText = getEnrichedSystemPrompt(mode, {
      excel: excelContext,
      ocr: ocrContext,
    });

    const msgs = [
      { role: "system", content: sysText },
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: "user",
        content: useCase
          ? `Cas d'usage: ${useCase}\n\nQuestion: ${message}`
          : message,
      },
    ];

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: msgs,
      temperature: 0.2,
    });

    const answer =
      completion.choices?.[0]?.message?.content || "";

    // Sauvegarde des messages
    await pool.query(
      `INSERT INTO dcf_messages (session_id, role, content, metadata)
       VALUES ($1,$2,$3,$4), ($1,$5,$6,$7)`,
      [
        sessionId,
        "user",
        message,
        JSON.stringify({ fileIds, attachmentIds, mode, useCase }),
        "assistant",
        answer,
        JSON.stringify({ model: ANSWER_MODEL }),
      ]
    );

    res.json({
      ok: true,
      sessionId,
      answer,
    });
  } catch (e) {
    console.error("[dcf] chat error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------------------------------------------------------
// SERVER START
// -----------------------------------------------------------------------------
app.listen(PORT, HOST, () => {
  console.log(
    `[dcf] Assistant DCF SAP v3 listening on http://${HOST}:${PORT}`
  );
});
