// server_dcf.js — Assistant DCF SAP v4 (Backend Complet)
// Intègre la logique multi-fichiers et détection "Action Manuelle"
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
// CONFIGURATION
// -----------------------------------------------------------------------------
const PORT = Number(process.env.DCF_PORT || 3030);
const HOST = process.env.DCF_HOST || "127.0.0.1";

const DATA_ROOT = path.join(process.cwd(), "uploads", "dcf");
const EXCEL_DIR = path.join(DATA_ROOT, "excel");
const ATTACH_DIR = path.join(DATA_ROOT, "attachments");

// Création des dossiers au démarrage
await fsp.mkdir(EXCEL_DIR, { recursive: true });
await fsp.mkdir(ATTACH_DIR, { recursive: true });

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const ANSWER_MODEL = process.env.DCF_MODEL || "gpt-4o";

// DB Neon / Postgres
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -----------------------------------------------------------------------------
// UTILITAIRES
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

// Nettoie le JSON retourné par l'IA (enlève les ```json ... ```)
function cleanJSON(text) {
  if (!text) return {};
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error on:", cleaned.substring(0, 100));
    // On retourne un objet vide ou erreur pour éviter le crash
    return { error: "Format JSON invalide", raw: text };
  }
}

// -----------------------------------------------------------------------------
// MOTEUR D'ANALYSE EXCEL (Structure)
// -----------------------------------------------------------------------------
const SAP_FIELD_DICTIONARY = {
  VORNR_01: { name: "Operation Number", description: "Numéro d'opération", mandatory: true },
  "ARBPL-02": { name: "Work Center", description: "Poste de travail (ex: CH94...)", mandatory: true },
  STEUS: { name: "Control Key", description: "Clé contrôle (PM01...)", mandatory: true },
  LTXA1: { name: "Short Text", description: "Description courte", mandatory: true },
  ARBEI: { name: "Work", description: "Charge (ex: 1.5)", mandatory: false },
  TPLNR: { name: "Func. Loc.", description: "Lieu technique", mandatory: true },
  EQUNR: { name: "Equipment", description: "ID Équipement", mandatory: true },
  PLNNR: { name: "Group", description: "Task List Group", mandatory: true },
  ACTION: { name: "Action", description: "Create / Change / Delete", mandatory: true }
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
      for (let i = 0; i < Math.min(raw.length, 20); i++) {
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
            analysis.dictionary[c] = { ...info, col: colLetter };
          }
        });
      }

      analysis.sheets[sheetName] = { headerRowIdx, columns };

      // Ajout au contexte IA
      globalContext += `\n--- FEUILLE: ${sheetName} ---\n`;
      if (columns.length > 0) {
        globalContext += `Mapping Colonnes: ${columns.map(c => `${c.col}=${c.code}`).join(", ")}\n`;
      } else {
        globalContext += "Structure DCF standard non détectée.\n";
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
// BASE DE DONNÉES (Schema v4)
// -----------------------------------------------------------------------------
async function ensureSchema() {
  // Tables existantes (v3)
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

  // Tables v4 (Historique Wizard)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_requests (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES dcf_sessions(id),
      request_text TEXT,
      detected_action TEXT,
      response_json JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  
  console.log("[DB] Schema v4 ready.");
}
await ensureSchema();

// -----------------------------------------------------------------------------
// MULTER
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
// ROUTES : API WIZARD v4 (INTELLIGENCE)
// -----------------------------------------------------------------------------

// 1. ÉTAPE 1: ANALYSE DE LA DEMANDE (Support Multi-fichiers + Manuel)
app.post("/api/dcf/wizard/analyze", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) throw new Error("Message requis");

    // On récupère la liste des fichiers disponibles en base (pour la bibliothèque)
    const { rows: recentFiles } = await pool.query(
      `SELECT id, filename FROM dcf_files ORDER BY uploaded_at DESC LIMIT 30`
    );
    const filesList = recentFiles.map(f => `- ${f.filename}`).join("\n");

    const systemPrompt = `
      Tu es le moteur d'analyse DCF SAP v4.
      Ton but : Analyser la demande utilisateur et recommander LES fichiers templates nécessaires.

      LISTE DE TEMPLATES DISPONIBLES:
      ${filesList}

      RÈGLES MÉTIER (Critique):
      1. **Multi-fichiers** : Si l'utilisateur demande une action complexe comme "Décommissionner" ou "Retirer une cuve", cela nécessite souvent PLUSIEURS fichiers (ex: un pour le Plan, un pour la BOM, un pour l'Equipement). Recommande-les tous.
      2. **Mode Manuel** : Si la demande est très simple (ex: "Changer texte description", "Corriger faute frappe"), un DCF n'est pas nécessaire. Mets "is_manual": true.
      3. **Création Standard** : Pour "Créer opération" ou "Ajouter maintenance", recommande le fichier "Task List" ou "Maintenance Plan" approprié.

      Réponds UNIQUEMENT en JSON formaté ainsi :
      {
        "action": "decommission_equipment" | "create_operation" | "manual_fix",
        "is_manual": false, // true si l'action doit être faite à la main dans SAP
        "reasoning": "Explication courte pour l'utilisateur...",
        "required_files": [
           {
             "type": "Task List",
             "template_filename": "Nom du fichier 1 (parmi la liste ou nom standard)",
             "usage": "Pour supprimer les opérations"
           },
           {
             "type": "Equipment",
             "template_filename": "Nom du fichier 2",
             "usage": "Pour mettre le statut INAC"
           }
        ]
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

    // Sauvegarde en historique
    if (sessionId) {
      await pool.query(
        `INSERT INTO dcf_requests (session_id, request_text, detected_action, response_json) VALUES ($1, $2, $3, $4)`,
        [sessionId, message, result.action, result]
      );
    }

    res.json(result);

  } catch (e) {
    console.error("[Wizard Analyze] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 2. ÉTAPE 3: GÉNÉRATION INSTRUCTIONS (Ligne par Ligne)
app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename } = req.body;

    // Récupérer la structure réelle du fichier si connu
    let fileContext = "Aucune structure connue. Utilise les standards SAP.";
    const { rows: files } = await pool.query(
      `SELECT analysis FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (files.length > 0) {
      fileContext = files[0].analysis.ai_context || "";
    }

    const systemPrompt = `
      CONTEXTE:
      Demande user: "${requestText}"
      Fichier cible: "${templateFilename}"
      
      STRUCTURE DU FICHIER (Colonnes réelles détectées):
      ${fileContext.slice(0, 5000)}

      TACHE:
      Génère les instructions de remplissage LIGNE PAR LIGNE.
      Sois précis sur les coordonnées Excel (Ligne, Colonne) et les Codes SAP.
      Invente des données réalistes si nécessaire (ex: Work Center CH94...).

      FORMAT JSON ATTENDU (Array) :
      {
        "steps": [
          {
            "row": "6",
            "col": "H",
            "code": "ACTION",
            "label": "Action",
            "value": "Create",
            "reason": "Création d'entrée",
            "mandatory": true
          },
          {
            "row": "6",
            "col": "L",
            "code": "EQUNR",
            "label": "Equipment",
            "value": "10029921",
            "reason": "ID de la cuve",
            "mandatory": true
          }
        ]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Tu es un expert SAP technique." },
        { role: "user", content: systemPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    });

    const raw = cleanJSON(completion.choices[0].message.content);
    const instructions = raw.steps || (Array.isArray(raw) ? raw : []);

    res.json(instructions);

  } catch (e) {
    console.error("[Wizard Instructions] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 3. ÉTAPE 4: VALIDATION STRICTE
app.post("/api/dcf/wizard/validate", async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!fileIds || !fileIds.length) throw new Error("Aucun fichier à valider");

    const { rows: files } = await pool.query(
      `SELECT filename, analysis FROM dcf_files WHERE id = ANY($1::int[])`,
      [fileIds]
    );

    const context = files.map(f => 
      `Fichier: ${f.filename}\nPreview:\n${f.analysis.ai_context}`
    ).join("\n\n");

    const systemPrompt = `
      Tu es le validateur SAP. Analyse ces fichiers DCF remplis.
      
      RÈGLES DE VALIDATION:
      1. Vérifie la présence des champs obligatoires (VORNR, ARBPL, etc.).
      2. Vérifie les formats (Heures en décimal, Textes courts < 40 chars).
      3. Vérifie la cohérence (Action=Create nécessite des données).

      Réponds en JSON :
      {
        "report_text": "Résumé en texte...",
        "critical": ["Erreur critique ligne 6 : Work Center manquant"],
        "warnings": ["Attention : Texte un peu long ligne 8"],
        "suggestions": ["Suggestion : Utiliser la majuscule"]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: context.slice(0, 8000) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const result = cleanJSON(completion.choices[0].message.content);
    res.json({ report: result.report_text, ...result });

  } catch (e) {
    console.error("[Wizard Validate] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// ROUTES STANDARD (Uploads, Sessions, Chat Fallback)
// -----------------------------------------------------------------------------

// Upload Excel
app.post("/api/dcf/uploadExcel", uploadExcel.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) throw new Error("Fichier manquant");
    
    const absPath = file.path;
    const analysis = buildDeepExcelAnalysis(absPath);

    const { rows } = await pool.query(
      `INSERT INTO dcf_files (filename, stored_name, path, mime, bytes, sheet_names, analysis)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, filename`,
      [file.originalname, file.filename, absPath, file.mimetype, file.size, analysis.sheetNames, analysis]
    );

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/dcf/uploadExcelMulti", uploadExcel.array("files"), async (req, res) => {
  try {
    const files = req.files || [];
    const out = [];
    for (const file of files) {
      const absPath = file.path;
      const analysis = buildDeepExcelAnalysis(absPath);
      const { rows } = await pool.query(
        `INSERT INTO dcf_files (filename, stored_name, path, mime, bytes, sheet_names, analysis)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, filename`,
        [file.originalname, file.filename, absPath, file.mimetype, file.size, analysis.sheetNames, analysis]
      );
      out.push(rows[0]);
    }
    res.json({ ok: true, files: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sessions & Chat
app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const { title } = req.body;
    const email = getUserEmail(req);
    const { rows } = await pool.query(
      `INSERT INTO dcf_sessions (user_email, title) VALUES ($1, $2) RETURNING id`,
      [email, title || "Session DCF"]
    );
    res.json({ ok: true, sessionId: rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/dcf/sessions", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM dcf_sessions ORDER BY created_at DESC LIMIT 20`);
    res.json({ ok: true, sessions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/dcf/files", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, filename, uploaded_at FROM dcf_files ORDER BY uploaded_at DESC LIMIT 50`);
    res.json({ ok: true, files: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Route Chat générique (Fallback)
app.post("/api/dcf/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    // Logique basique pour questions hors-wizard
    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Tu es un assistant SAP généraliste." },
        { role: "user", content: message }
      ]
    });
    res.json({ ok: true, answer: completion.choices[0].message.content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Attachments upload
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

// Health
app.get("/api/dcf/health", (req, res) => res.json({ status: "ok", version: "4.0" }));

// Start
app.listen(PORT, HOST, () => {
  console.log(`[dcf-v4] Backend complet démarré sur http://${HOST}:${PORT}`);
});
