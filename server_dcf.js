// server_dcf.js v2 — Assistant DCF SAP (plans de maintenance)
// Node ESM — VERSION COMPLÈTE avec multi-fichiers, validation, guidage SAP, OCR

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
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ANSWER_MODEL = process.env.DCF_MODEL || "gpt-4o";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o";

// DB Neon / Postgres
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -----------------------------------------------------------------------------
// Helpers
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

// -----------------------------------------------------------------------------
// Analyse Excel COMPLÈTE (sans limite de lignes/colonnes)
// Génère un preview intelligent pour l'IA
// -----------------------------------------------------------------------------
function buildExcelAnalysis(absPath) {
  try {
    const wb = xlsx.readFile(absPath, { cellDates: false, sheetRows: 0 });
    const sheetNames = wb.SheetNames || [];
    const analysis = {
      sheetNames,
      totalSheets: sheetNames.length,
      sheets: {},
      dcfZones: [],
      preview: "",
    };

    for (const sheetName of sheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const ref = ws["!ref"] || "A1";
      const range = xlsx.utils.decode_range(ref);
      const totalRows = range.e.r + 1;
      const totalCols = range.e.c + 1;

      // Lecture COMPLÈTE (pas de limite)
      const fullData = xlsx.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: "",
      });

      // Détection des colonnes DCF importantes
      const headers = fullData[0] || [];
      const dcfColumns = detectDcfColumns(headers);

      // Extraction des zones DCF (lignes avec des données pertinentes)
      const dcfRows = extractDcfRows(fullData, dcfColumns);

      analysis.sheets[sheetName] = {
        totalRows,
        totalCols,
        headers,
        dcfColumns,
        dcfRowCount: dcfRows.length,
        sample: fullData.slice(0, 10), // Échantillon pour l'IA
      };

      if (dcfRows.length > 0) {
        analysis.dcfZones.push({
          sheet: sheetName,
          rows: dcfRows,
        });
      }
    }

    // Génération du preview pour l'IA (optimisé, < 40k caractères)
    analysis.preview = generateIntelligentPreview(analysis);

    return analysis;
  } catch (e) {
    console.error("[dcf] erreur analyse excel", e);
    return {
      sheetNames: [],
      totalSheets: 0,
      sheets: {},
      dcfZones: [],
      preview: null,
      error: e.message,
    };
  }
}

// Détecte les colonnes DCF typiques
function detectDcfColumns(headers) {
  const dcfKeywords = [
    "operation",
    "opération",
    "work center",
    "poste de travail",
    "short text",
    "texte court",
    "long text",
    "texte long",
    "duration",
    "durée",
    "work",
    "travail",
    "person",
    "personne",
    "nbr",
    "control key",
    "clé de contrôle",
    "plant",
    "division",
  ];

  const detected = [];
  headers.forEach((header, idx) => {
    const h = String(header).toLowerCase();
    for (const keyword of dcfKeywords) {
      if (h.includes(keyword)) {
        detected.push({ index: idx, name: header, keyword });
        break;
      }
    }
  });

  return detected;
}

// Extrait les lignes contenant des données DCF
function extractDcfRows(data, dcfColumns) {
  if (!dcfColumns.length) return [];

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    let hasData = false;

    for (const col of dcfColumns) {
      if (row[col.index] && String(row[col.index]).trim()) {
        hasData = true;
        break;
      }
    }

    if (hasData) {
      rows.push({ rowIndex: i, data: row });
    }
  }

  return rows;
}

// Génère un preview intelligent pour l'IA
function generateIntelligentPreview(analysis) {
  let preview = `=== ANALYSE EXCEL DCF ===\n`;
  preview += `Total feuilles: ${analysis.totalSheets}\n`;
  preview += `Feuilles: ${analysis.sheetNames.join(", ")}\n\n`;

  for (const [sheetName, sheet] of Object.entries(analysis.sheets)) {
    preview += `--- Feuille: ${sheetName} ---\n`;
    preview += `Dimensions: ${sheet.totalRows} lignes × ${sheet.totalCols} colonnes\n`;

    if (sheet.dcfColumns.length > 0) {
      preview += `Colonnes DCF détectées:\n`;
      sheet.dcfColumns.forEach((col) => {
        preview += `  - ${col.name} (colonne ${col.index})\n`;
      });
    }

    if (sheet.sample.length > 0) {
      preview += `Échantillon des premières lignes:\n`;
      const csv = sheet.sample
        .map((row) => row.slice(0, 15).join("\t"))
        .join("\n");
      preview += csv + "\n";
    }

    preview += "\n";

    // Limite de taille pour ne pas saturer l'IA
    if (preview.length > 35000) {
      preview += "\n[...preview tronqué pour optimisation IA...]\n";
      break;
    }
  }

  // Zones DCF importantes
  if (analysis.dcfZones.length > 0) {
    preview += `\n=== ZONES DCF IDENTIFIÉES ===\n`;
    for (const zone of analysis.dcfZones) {
      preview += `Feuille "${zone.sheet}": ${zone.rows.length} lignes DCF\n`;

      // Échantillon de lignes DCF
      const sample = zone.rows.slice(0, 5);
      for (const row of sample) {
        preview += `  Ligne ${row.rowIndex}: ${JSON.stringify(
          row.data.slice(0, 10)
        )}\n`;
      }
    }
  }

  return preview.slice(0, 40000);
}

// -----------------------------------------------------------------------------
// Analyse d'images SAP avec OCR + Vision
// -----------------------------------------------------------------------------
async function analyzeImageSAP(imagePath) {
  try {
    const buffer = await fsp.readFile(imagePath);
    const base64 = buffer.toString("base64");
    const mime = imagePath.endsWith(".png")
      ? "image/png"
      : imagePath.endsWith(".jpg") || imagePath.endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";

    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Tu es un expert SAP. Analyse cette capture d'écran SAP et extrait TOUTES les informations visibles : " +
            "numéros de transaction, codes équipement, postes de travail, textes courts/longs, durées, " +
            "messages d'erreur, champs obligatoires non remplis, etc. " +
            "Sois très précis et exhaustif. Formate ta réponse en JSON avec les clés appropriées.",
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
              text: "Analyse cette image SAP et extrais toutes les données visibles.",
            },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    });

    const content = response.choices?.[0]?.message?.content || "{}";

    // Essaie de parser le JSON, sinon retourne le texte brut
    try {
      return { type: "json", data: JSON.parse(content) };
    } catch {
      return { type: "text", data: content };
    }
  } catch (e) {
    console.error("[dcf] erreur analyse image SAP", e);
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const uploadAttach = multer({
  storage: attachStorage,
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
});

// -----------------------------------------------------------------------------
// Schéma DB v2 (avec analyse complète + images OCR)
// -----------------------------------------------------------------------------
async function ensureSchema() {
  // Fichiers Excel avec analyse complète
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

  // Sessions
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

  // Messages
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

  // Pièces jointes (images SAP avec OCR)
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

  // Index pour performance
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dcf_messages_session 
    ON dcf_messages(session_id, id)
  `);
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

// Healthcheck
app.get("/api/dcf/health", (_req, res) => {
  res.json({ ok: true, service: "dcf-v2", time: new Date().toISOString() });
});

// ✅ Upload Excel MULTI-FICHIERS
app.post(
  "/api/dcf/uploadExcelMulti",
  uploadExcel.array("files", 10),
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ ok: false, error: "Aucun fichier reçu" });
      }

      const results = [];

      for (const file of files) {
        const absPath = file.path;
        const analysis = buildExcelAnalysis(absPath);

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
            analysis.sheetNames.length ? analysis.sheetNames : null,
            JSON.stringify(analysis),
          ]
        );

        results.push(rows[0]);
      }

      res.json({ ok: true, files: results });
    } catch (e) {
      console.error("[dcf] uploadExcelMulti error", e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ✅ Upload Excel SIMPLE (rétro-compat)
app.post("/api/dcf/uploadExcel", uploadExcel.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Fichier manquant" });
    }

    const file = req.file;
    const absPath = file.path;
    const analysis = buildExcelAnalysis(absPath);

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
        analysis.sheetNames.length ? analysis.sheetNames : null,
        JSON.stringify(analysis),
      ]
    );

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error("[dcf] uploadExcel error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Liste des fichiers Excel
app.get("/api/dcf/files", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, sheet_names, uploaded_at, 
              analysis->>'totalSheets' as total_sheets
       FROM dcf_files
       ORDER BY uploaded_at DESC, id DESC`
    );
    res.json({ ok: true, files: rows });
  } catch (e) {
    console.error("[dcf] list files error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Détails d'un fichier Excel avec analyse
app.get("/api/dcf/files/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, sheet_names, analysis, uploaded_at
       FROM dcf_files WHERE id = $1`,
      [req.params.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: "Fichier non trouvé" });
    }

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error("[dcf] get file error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ✅ Upload pièces jointes avec OCR automatique
app.post(
  "/api/dcf/attachments/upload",
  uploadAttach.array("files", 20),
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ ok: false, error: "Aucun fichier reçu" });
      }

      const sessionId = req.body?.session_id || null;
      const items = [];

      for (const f of files) {
        // OCR automatique si image
        let ocrAnalysis = null;
        const isImage = /^image\//i.test(f.mimetype || "");

        if (isImage) {
          console.log(`[dcf] OCR analyse: ${f.originalname}`);
          ocrAnalysis = await analyzeImageSAP(f.path);
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
            ocrAnalysis ? JSON.stringify(ocrAnalysis) : null,
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

// Crée une session
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

// Récupération session + messages
app.get("/api/dcf/session/:id", async (req, res) => {
  try {
    const { rows: srows } = await pool.query(
      `SELECT id, user_email, title, context_file_ids, created_at, updated_at
       FROM dcf_sessions WHERE id = $1`,
      [req.params.id]
    );

    if (!srows[0]) {
      return res.status(404).json({ ok: false, error: "Session inconnue" });
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

// ✅ VALIDATION DCF
app.post("/api/dcf/validate", async (req, res) => {
  try {
    const { fileIds = [], mode = "auto" } = req.body || {};

    if (!fileIds.length) {
      return res
        .status(400)
        .json({ ok: false, error: "Aucun fichier à valider" });
    }

    // Récupère les analyses
    const { rows: files } = await pool.query(
      `SELECT id, filename, analysis FROM dcf_files WHERE id = ANY($1::int[])`,
      [fileIds]
    );

    if (!files.length) {
      return res
        .status(404)
        .json({ ok: false, error: "Fichiers non trouvés" });
    }

    // Prompt de validation
    const validationContext = files
      .map(
        (f) =>
          `Fichier: ${f.filename}\n${
            f.analysis?.preview || "[pas d'analyse disponible]"
          }`
      )
      .join("\n\n---\n\n");

    const sysText =
      "Tu es un expert SAP validation DCF. " +
      "Analyse ces fichiers DCF et identifie TOUTES les erreurs, incohérences, champs manquants, " +
      "durées incorrectes, postes de travail invalides, etc. " +
      "Formate ta réponse en sections claires : " +
      "1. Erreurs critiques (bloquantes) " +
      "2. Avertissements (à vérifier) " +
      "3. Suggestions d'amélioration " +
      "Sois très précis sur les numéros de lignes et colonnes.";

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: sysText },
        {
          role: "user",
          content: `Valide ces fichiers DCF :\n\n${validationContext}`,
        },
      ],
      temperature: 0.1,
    });

    const report =
      completion.choices?.[0]?.message?.content || "Validation impossible";

    res.json({ ok: true, report, files: files.map((f) => f.filename) });
  } catch (e) {
    console.error("[dcf] validate error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ✅ CHAT IA v2 (multi-contextes + OCR + guidage SAP)
app.post("/api/dcf/chat", async (req, res) => {
  try {
    const {
      message,
      sessionId: rawSessionId,
      fileIds = [],
      attachmentIds = [],
      mode = "chat",
    } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message requis" });
    }

    const email = getUserEmail(req);
    let sessionId = rawSessionId || null;

    // Crée la session si besoin
    if (!sessionId) {
      const { rows } = await pool.query(
        `INSERT INTO dcf_sessions (user_email, title, context_file_ids)
         VALUES ($1,$2,$3)
         RETURNING id`,
        [email, "Session DCF", fileIds]
      );
      sessionId = rows[0].id;
    } else {
      // Met à jour le contexte de la session
      await pool.query(
        `UPDATE dcf_sessions 
         SET context_file_ids = $1, updated_at = now()
         WHERE id = $2`,
        [fileIds, sessionId]
      );
    }

    // Historique (limite à 30 messages)
    const { rows: history } = await pool.query(
      `SELECT role, content
       FROM dcf_messages
       WHERE session_id = $1
       ORDER BY id ASC
       LIMIT 30`,
      [sessionId]
    );

    // Contexte multi-fichiers Excel
    let filesContext = "";
    if (fileIds.length > 0) {
      const { rows: files } = await pool.query(
        `SELECT id, filename, analysis
         FROM dcf_files WHERE id = ANY($1::int[])`,
        [fileIds]
      );

      filesContext = files
        .map(
          (f) =>
            `=== Fichier: ${f.filename} ===\n${
              f.analysis?.preview || "[analyse non disponible]"
            }`
        )
        .join("\n\n");
    }

    // Pièces jointes avec OCR
    const imgParts = [];
    let ocrContext = "";

    if (attachmentIds.length > 0) {
      const { rows: attachments } = await pool.query(
        `SELECT id, filename, path, mime, ocr_analysis
         FROM dcf_attachments
         WHERE id = ANY($1::int[])`,
        [attachmentIds]
      );

      for (const a of attachments) {
        const mime = a.mime || "application/octet-stream";

        // Ajoute l'OCR au contexte textuel
        if (a.ocr_analysis) {
          ocrContext += `\n=== OCR: ${a.filename} ===\n`;
          if (a.ocr_analysis.type === "json") {
            ocrContext += JSON.stringify(a.ocr_analysis.data, null, 2);
          } else {
            ocrContext += a.ocr_analysis.data;
          }
          ocrContext += "\n";
        }

        // Ajoute l'image si c'est une image
        if (/^image\//i.test(mime)) {
          try {
            const buf = await fsp.readFile(a.path);
            const b64 = buf.toString("base64");
            imgParts.push({
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${b64}`,
              },
            });
          } catch (e) {
            console.error("[dcf] read attachment fail", a.id, e);
          }
        }
      }
    }

    // Construction du prompt selon le mode
    let sysText = "";
    if (mode === "validation") {
      sysText =
        "Tu es un expert SAP validation DCF. " +
        "Identifie les erreurs, incohérences et champs manquants dans les fichiers DCF. " +
        "Sois précis sur les numéros de lignes/colonnes.";
    } else if (mode === "guidage" || mode === "sap") {
      sysText =
        "Tu es un guide SAP expert pour Daniel Palha. " +
        "Fournis des instructions ÉTAPE PAR ÉTAPE très détaillées pour accomplir les tâches SAP. " +
        "Format: " +
        "1. Transaction à utiliser (ex: IP01, IP02, IA05, etc.) " +
        "2. Navigation exacte (menus, boutons) " +
        "3. Champs à remplir avec valeurs précises " +
        "4. Validations à effectuer " +
        "5. Ce qui doit être rempli dans le DCF Excel (onglet, colonne, valeur) " +
        "Réponds toujours en FRANÇAIS.";
    } else {
      sysText =
        "Tu es un assistant SAP pour Daniel Palha. " +
        "Tu aides à préparer et remplir les DCF et les fichiers Excel associés " +
        "pour modifier des plans de maintenance SAP (maintenance plan, task list, equipment, etc.). " +
        "Réponds toujours en FRANÇAIS. " +
        "Donne des réponses très concrètes, sous forme de steps 1/2/3.";
    }

    // Enrichissement du message utilisateur
    let userText = message.trim();

    if (filesContext) {
      userText += "\n\n=== CONTEXTE FICHIERS DCF ===\n" + filesContext;
    }

    if (ocrContext) {
      userText += "\n\n=== DONNÉES EXTRAITES DES IMAGES SAP ===\n" + ocrContext;
    }

    const userContent = [{ type: "text", text: userText }, ...imgParts];

    const oaMessages = [
      { role: "system", content: sysText },
      ...history.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      { role: "user", content: userContent },
    ];

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: oaMessages,
      temperature: mode === "guidage" ? 0.1 : 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const answerText = String(raw || "");

    // Sauvegarde en base
    await pool.query(
      `INSERT INTO dcf_messages (session_id, role, content, metadata)
       VALUES ($1,'user',$2,$3)`,
      [sessionId, message.trim(), JSON.stringify({ mode, fileIds, attachmentIds })]
    );

    await pool.query(
      `INSERT INTO dcf_messages (session_id, role, content)
       VALUES ($1,'assistant',$2)`,
      [sessionId, answerText]
    );

    res.json({
      ok: true,
      sessionId,
      answer: answerText,
      mode,
    });
  } catch (e) {
    console.error("[dcf] chat error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Liste toutes les sessions
app.get("/api/dcf/sessions", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const { rows } = await pool.query(
      `SELECT id, title, context_file_ids, created_at, updated_at
       FROM dcf_sessions
       WHERE user_email = $1 OR user_email IS NULL
       ORDER BY updated_at DESC
       LIMIT 50`,
      [email]
    );

    res.json({ ok: true, sessions: rows });
  } catch (e) {
    console.error("[dcf] list sessions error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------------------------------------------------------
// BOOT
// -----------------------------------------------------------------------------
await ensureSchema();

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v2] service listening on ${HOST}:${PORT}`);
  console.log(`[dcf-v2] features: multi-files, validation, sap-guidance, ocr`);
});
