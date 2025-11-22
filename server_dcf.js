// server_dcf.js — Assistant DCF SAP v4 (Backend Wizard)
// Node ESM

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
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

// Création des dossiers
await fsp.mkdir(EXCEL_DIR, { recursive: true });
await fsp.mkdir(ATTACH_DIR, { recursive: true });

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const ANSWER_MODEL = process.env.DCF_MODEL || "gpt-4o";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o";

// DB Configuration (Neon / Postgres)
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -----------------------------------------------------------------------------
// UTILS & HELPERS
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
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = ((n - 1) % 26) + 65;
    s = String.fromCharCode(r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Helper pour nettoyer les blocs de code Markdown du JSON
function cleanJSON(text) {
  if (!text) return "{}";
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error on:", cleaned.substring(0, 100));
    throw new Error("L'IA n'a pas retourné un JSON valide.");
  }
}

// -----------------------------------------------------------------------------
// ANALYSE EXCEL (Moteur Structurel)
// -----------------------------------------------------------------------------
const SAP_FIELD_DICTIONARY = {
  VORNR_01: { name: "Operation Number", description: "Ex: 0010, 0020", mandatory: true },
  "ARBPL-02": { name: "Work Center", description: "Poste de travail (ex: CH94...)", mandatory: true },
  STEUS: { name: "Control Key", description: "Clé contrôle (PM01...)", mandatory: true },
  LTXA1: { name: "Short Text", description: "Description (max 40 car.)", mandatory: true },
  ARBEI: { name: "Work", description: "Charge (ex: 1.5)", mandatory: false },
  ARBEH: { name: "Unit", description: "Unité (H)", mandatory: false },
  ANZZL: { name: "Pers.", description: "Nb personnes", mandatory: false },
  TPLNR: { name: "Func. Loc.", description: "Lieu technique", mandatory: true },
  EQUNR: { name: "Equipment", description: "ID Équipement", mandatory: true },
  PLNNR: { name: "Group", description: "Task List Group", mandatory: true },
  // Ajoute d'autres clés ici si nécessaire
};

function buildDeepExcelAnalysis(absPath) {
  try {
    const wb = xlsx.readFile(absPath, { cellDates: false, sheetRows: 0 });
    const sheetNames = wb.SheetNames || [];
    const analysis = {
      filename: path.basename(absPath),
      totalSheets: sheetNames.length,
      sheetNames,
      sheets: {},
      dictionary: {},
      ai_context: "",
    };

    let globalContext = "";

    for (const sheetName of sheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!raw.length) continue;

      // Recherche Ligne "ACTION" / "LINE" pour repérer le header DCF
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(raw.length, 15); i++) {
        const rowStr = raw[i].map(x => String(x).toUpperCase()).join(" ");
        if (rowStr.includes("ACTION") && (rowStr.includes("LINE") || rowStr.includes("OBJECT"))) {
          headerRowIdx = i;
          break;
        }
      }

      const codesRowIdx = headerRowIdx !== -1 ? headerRowIdx + 1 : -1;
      const columns = [];
      
      if (codesRowIdx !== -1 && raw[codesRowIdx]) {
        const codes = raw[codesRowIdx];
        codes.forEach((code, idx) => {
          const c = String(code).trim();
          if (c && c.length > 2) {
            const colLetter = columnIndexToLetter(idx);
            const info = SAP_FIELD_DICTIONARY[c] || { name: c, mandatory: false };
            columns.push({
              col: colLetter,
              idx,
              code: c,
              name: info.name,
              mandatory: info.mandatory
            });
            // Ajout au dictionnaire global
            analysis.dictionary[c] = { ...info, col: colLetter };
          }
        });
      }

      // Extraction de quelques lignes de données pour l'exemple
      const sampleRows = [];
      const startData = codesRowIdx !== -1 ? codesRowIdx + 2 : 5;
      for (let i = startData; i < Math.min(raw.length, startData + 5); i++) {
        if (raw[i]) sampleRows.push(raw[i].slice(0, 20)); // On prend les 20 premières cols
      }

      analysis.sheets[sheetName] = {
        headerRowIdx,
        columns,
        sample: sampleRows
      };

      // Construction du contexte texte pour l'IA
      globalContext += `\n--- FEUILLE: ${sheetName} ---\n`;
      if (columns.length > 0) {
        globalContext += `Mapping Colonnes (extrait): ${columns.slice(0, 15).map(c => `${c.col}=${c.code}`).join(", ")}...\n`;
      } else {
        globalContext += "Structure DCF non détectée automatiquement.\n";
      }
    }

    analysis.ai_context = globalContext;
    return analysis;
  } catch (e) {
    console.error("Analysis Error", e);
    return { error: e.message, ai_context: "Erreur analyse fichier." };
  }
}

// -----------------------------------------------------------------------------
// DB SCHEMA (Mise à jour v4)
// -----------------------------------------------------------------------------
async function ensureSchema() {
  // Tables existantes v3 (conservées)
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

  // --- NOUVELLES TABLES V4 ---

  // Bibliothèque d'exemples (Analysés structurellement)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_examples (
      id SERIAL PRIMARY KEY,
      original_file_id INT REFERENCES dcf_files(id),
      dcf_type TEXT, -- 'Task List', 'Maintenance Plan', 'Equipment'
      template_version TEXT, 
      mapping JSONB, -- Mapping colonne/champ
      field_examples JSONB, -- Valeurs types trouvées
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Historique des requêtes Wizard
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_requests (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES dcf_sessions(id),
      request_text TEXT,
      detected_action TEXT,
      detected_type TEXT,
      recommended_file_id INT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  
  console.log("[DB] Schema v4 ready.");
}
await ensureSchema();

// -----------------------------------------------------------------------------
// MULTER CONFIG
// -----------------------------------------------------------------------------
const excelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, EXCEL_DIR),
  filename: (_req, file, cb) => {
    const base = sanitizeName(file.originalname || "dcf.xlsx");
    const ts = new Date().toISOString().replace(/[:.]/g, "");
    cb(null, `${ts}_${base}`);
  },
});
const uploadExcel = multer({ storage: excelStorage });

const attachStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ATTACH_DIR),
  filename: (_req, file, cb) => {
    const base = sanitizeName(file.originalname || "img.png");
    const ts = new Date().toISOString().replace(/[:.]/g, "");
    cb(null, `${ts}_${base}`);
  },
});
const uploadAttach = multer({ storage: attachStorage });

// -----------------------------------------------------------------------------
// ROUTES WIZARD V4
// -----------------------------------------------------------------------------

// 1. ÉTAPE 1: ANALYSE DE LA DEMANDE
app.post("/api/dcf/wizard/analyze", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) throw new Error("Message requis");

    // On cherche le fichier le plus pertinent parmi les 10 derniers uploads (Simulate library search)
    const { rows: recentFiles } = await pool.query(
      `SELECT id, filename, analysis FROM dcf_files ORDER BY uploaded_at DESC LIMIT 10`
    );
    
    const filesList = recentFiles.map(f => `- ID ${f.id}: ${f.filename}`).join("\n");

    const systemPrompt = `
      Tu es le moteur d'analyse DCF SAP v4.
      Ton but : Analyser la demande utilisateur et choisir le meilleur fichier template parmi la liste fournie.
      
      LISTE FICHIERS DISPONIBLES:
      ${filesList}
      
      Si aucun fichier ne correspond parfaitement, invente un nom de fichier standard (ex: ERP_MDCF_Task_List_4.06.xlsm).

      Réponds UNIQUEMENT en JSON formaté ainsi :
      {
        "action": "create_operation" | "modify_plan" | "create_equipment" | "unknown",
        "dcf_type": "Task List" | "Maintenance Plan" | "Equipment",
        "template_filename": "Nom du fichier choisi",
        "reasoning": "Une phrase expliquant pourquoi ce template.",
        "similar_count": 12
      }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const result = cleanJSON(completion.choices[0].message.content);

    // Log en DB
    if (sessionId) {
      await pool.query(
        `INSERT INTO dcf_requests (session_id, request_text, detected_action, detected_type) VALUES ($1, $2, $3, $4)`,
        [sessionId, message, result.action, result.dcf_type]
      );
    }

    res.json(result);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 2. ÉTAPE 3: GÉNÉRATION INSTRUCTIONS
app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename } = req.body;

    // Essayer de récupérer le contenu réel du fichier s'il existe en DB
    let fileContext = "Aucun fichier chargé.";
    const { rows: files } = await pool.query(
      `SELECT analysis FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (files.length > 0) {
      fileContext = files[0].analysis.ai_context; // Le mapping colonne réel
    } else {
      // Fallback : On demande à l'IA d'halluciner une structure standard plausible si le fichier n'est pas en DB
      fileContext = "Fichier standard DCF Task List. Supposez les colonnes : H=ACTION, L=EQUNR, T=ARBPL, AJ=LTXA1...";
    }

    const systemPrompt = `
      CONTEXTE:
      L'utilisateur veut : "${requestText}"
      Fichier Template : "${templateFilename}"
      Structure détectée du fichier : 
      ${fileContext.slice(0, 4000)}

      TACHE:
      Génère les instructions de remplissage LIGNE PAR LIGNE pour l'Excel.
      Sois très précis sur les colonnes (Lettre) et les Codes SAP.
      Invente des données réalistes basées sur la demande (ex: si user dit "Chambre 953", mets "CH94" en work center si pertinent).

      FORMAT JSON ATTENDU (Array) :
      [
        {
          "row": "6", // Numéro ligne Excel suggérée
          "col": "H", // Lettre colonne
          "code": "ACTION", // Code SAP en header
          "label": "Action", // Nom humain
          "value": "Create", // Valeur à saisir
          "reason": "Pour créer une nouvelle entrée",
          "mandatory": true
        },
        ...
      ]
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Tu es un assistant technique SAP précis." },
        { role: "user", content: systemPrompt }
      ],
      response_format: { type: "json_object" }, // Attention: pour array, il faut wrapper
      temperature: 0.2
    });

    // Hack: OpenAI force souvent un objet racine si json_object est demandé.
    // On parse et on cherche l'array.
    const rawJson = cleanJSON(completion.choices[0].message.content);
    let instructions = [];
    if (Array.isArray(rawJson)) instructions = rawJson;
    else if (rawJson.instructions) instructions = rawJson.instructions;
    else if (rawJson.steps) instructions = rawJson.steps;
    else instructions = Object.values(rawJson)[0] || []; // Tentative désespérée

    res.json(instructions);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 3. ÉTAPE 4: VALIDATION STRICTE
app.post("/api/dcf/wizard/validate", async (req, res) => {
  try {
    const { fileIds } = req.body;
    
    // Récupération données fichiers
    const { rows: files } = await pool.query(
      `SELECT filename, analysis FROM dcf_files WHERE id = ANY($1::int[])`,
      [fileIds]
    );

    const analysisData = files.map(f => 
      `Fichier: ${f.filename}\nStructure:\n${f.analysis.ai_context || "N/A"}`
    ).join("\n\n");

    const systemPrompt = `
      Tu es un validateur strict de fichiers DCF SAP.
      Analyse les structures fournies.
      
      Règles:
      1. Vérifie que les champs obligatoires (VORNR, ARBPL, EQUNR) semblent remplis.
      2. Vérifie les formats (Heure = décimal, Text < 40 chars).
      3. Détecte les incohérences.

      Réponds en JSON :
      {
        "report_text": "Résumé global...",
        "critical": ["Erreur 1: Ligne 6 Col T (ARBPL) vide", ...],
        "warnings": ["Warning 1: ..."],
        "suggestions": ["Sugg 1: ..."]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Valide ces données :\n${analysisData.slice(0, 6000)}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const result = cleanJSON(completion.choices[0].message.content);
    res.json({ report: result.report_text, ...result });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// ROUTES EXISTANTES (Uploads & Session basics)
// -----------------------------------------------------------------------------

// Start Session
app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const { title } = req.body;
    const email = getUserEmail(req);
    const { rows } = await pool.query(
      `INSERT INTO dcf_sessions (user_email, title) VALUES ($1, $2) RETURNING id`,
      [email, title || "Session Wizard"]
    );
    res.json({ ok: true, sessionId: rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload Excel
app.post("/api/dcf/uploadExcel", uploadExcel.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const absPath = file.path;
    const analysis = buildDeepExcelAnalysis(absPath);

    const { rows } = await pool.query(
      `INSERT INTO dcf_files (filename, stored_name, path, mime, bytes, sheet_names, analysis)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, filename`,
      [file.originalname, file.filename, absPath, file.mimetype, file.size, analysis.sheetNames, analysis]
    );

    // Si le fichier est "propre", on pourrait l'ajouter aux dcf_examples ici
    // Pour l'instant, on le stocke juste.
    
    res.json({ ok: true, file: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload Attachments (Screenshots)
app.post("/api/dcf/attachments/upload", uploadAttach.array("files"), async (req, res) => {
  try {
    const files = req.files || [];
    const { session_id } = req.body;
    
    const items = [];
    for (const f of files) {
      const { rows } = await pool.query(
        `INSERT INTO dcf_attachments (session_id, filename, stored_name, path, mime, bytes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename`,
        [session_id || null, f.originalname, f.filename, f.path, f.mimetype, f.size]
      );
      items.push(rows[0]);
    }
    res.json({ ok: true, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Chat (Route générique fallback)
app.post("/api/dcf/chat", async (req, res) => {
  // Cette route est utilisée pour l'analyse de screenshots dans le wizard (Step 3)
  // ou pour des questions générales.
  try {
    const { message, attachmentIds, mode } = req.body;
    
    // Gestion sommaire des attachments (OCR) si présents
    let ocrText = "";
    if (attachmentIds && attachmentIds.length) {
       // Simuler OCR ou implémenter GPT-4 Vision ici
       // Pour l'instant, on fait confiance au frontend wizard qui n'utilise pas cette route pour l'OCR complexe
       // mais on peut l'ajouter si nécessaire.
    }

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
         { role: "system", content: "Tu es un assistant SAP." },
         { role: "user", content: message }
      ]
    });
    
    res.json({ ok: true, answer: completion.choices[0].message.content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Start Server
app.listen(PORT, HOST, () => {
  console.log(`[dcf-v4] Backend Wizard listening on http://${HOST}:${PORT}`);
});
