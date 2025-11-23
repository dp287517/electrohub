// server_dcf.js — Assistant DCF SAP v5 (Backend Ultimate)
// Fonctionnalités : Multi-fichiers, Auto-fill Excel, Vision SAP intégrée, Continuous Learning
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
const OUTPUT_DIR = path.join(DATA_ROOT, "output"); // Pour les fichiers générés

// Création des dossiers au démarrage
await fsp.mkdir(EXCEL_DIR, { recursive: true });
await fsp.mkdir(ATTACH_DIR, { recursive: true });
await fsp.mkdir(OUTPUT_DIR, { recursive: true });

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

// Helper: Convertit "H" -> 7, "A" -> 0
function letterToColumnIndex(letter) {
  let column = 0;
  const length = letter.length;
  for (let i = 0; i < length; i++) {
    column += (letter.charCodeAt(i) - 64) * Math.pow(26, length - i - 1);
  }
  return column - 1;
}

// Nettoie le JSON retourné par l'IA
function cleanJSON(text) {
  if (!text) return {};
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error on:", cleaned.substring(0, 100));
    return { error: "Format JSON invalide", raw: text };
  }
}

// -----------------------------------------------------------------------------
// ANALYSE IMAGE (VISION SAP)
// -----------------------------------------------------------------------------
async function analyzeImageSAP(imagePath) {
  try {
    const buffer = await fsp.readFile(imagePath);
    const base64 = buffer.toString("base64");
    const mime = imagePath.match(/\.jpe?g$/i) ? "image/jpeg" : "image/png";

    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content: "Tu es un expert SAP. Extrais toutes les données techniques visibles (IDs, Work Centers, Plans, Dates, Textes) en JSON plat."
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });
    return response.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error("Vision Error", e);
    return "";
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
      for (let i = 0; i < Math.min(raw.length, 25); i++) {
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
// DB SCHEMA
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
    CREATE TABLE IF NOT EXISTS dcf_requests (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES dcf_sessions(id),
      request_text TEXT,
      detected_action TEXT,
      response_json JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  try {
    await pool.query(`ALTER TABLE dcf_requests ADD COLUMN IF NOT EXISTS response_json JSONB`);
  } catch (e) {}
  
  console.log("[DB] Schema v5 ready.");
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
// ROUTES : API WIZARD v5 (INTELLIGENCE & AUTOMATION)
// -----------------------------------------------------------------------------

// 1. ANALYSE DE LA DEMANDE (Support Multi-fichiers + Manuel + Continuous Learning)
app.post("/api/dcf/wizard/analyze", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) throw new Error("Message requis");

    // Continuous Learning : On utilise les 30 derniers fichiers importés comme bibliothèque
    const { rows: recentFiles } = await pool.query(
      `SELECT id, filename FROM dcf_files ORDER BY uploaded_at DESC LIMIT 30`
    );
    const filesList = recentFiles.map(f => `- ${f.filename} (ID: ${f.id})`).join("\n");

    const systemPrompt = `
      Tu es le moteur d'analyse DCF SAP v5.
      Ton but : Recommander LES fichiers templates nécessaires en piochant dans la bibliothèque ci-dessous.

      BIBLIOTHÈQUE DE TEMPLATES (Apprentissage continu):
      ${filesList}

      RÈGLES MÉTIER:
      1. **Multi-fichiers** : Si action complexe (ex: décommissionnement), recommande TOUS les fichiers requis (Plan, Equipement, BOM).
      2. **Manuel** : Si c'est trivial (modif texte simple), mets "is_manual": true.
      3. **Best Match** : Choisis le nom de fichier le plus ressemblant dans la liste.

      Réponds UNIQUEMENT en JSON :
      {
        "action": "type_action",
        "is_manual": false,
        "reasoning": "Pourquoi ces fichiers...",
        "required_files": [
           { "type": "Task List", "template_filename": "NomExactDuFichier.xlsx", "file_id": 123, "usage": "..." }
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

    // Enrichissement avec les IDs si l'IA a bien fait le lien, sinon on recherche
    if (result.required_files) {
      result.required_files.forEach(rf => {
        const match = recentFiles.find(f => f.filename === rf.template_filename);
        if (match) rf.file_id = match.id;
      });
    }

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

// 2. GÉNÉRATION INSTRUCTIONS + VISION INTEGRATION
app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename, attachmentIds } = req.body;

    // A. Récupération Structure Fichier
    let fileContext = "Structure standard SAP supposée.";
    const { rows: files } = await pool.query(
      `SELECT analysis FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );
    if (files.length > 0) fileContext = files[0].analysis.ai_context || "";

    // B. Récupération & Analyse Images (Vision)
    let visionContext = "";
    if (attachmentIds && attachmentIds.length > 0) {
      const { rows: atts } = await pool.query(
        `SELECT path, ocr_analysis FROM dcf_attachments WHERE id = ANY($1::int[])`,
        [attachmentIds]
      );
      
      // Si pas encore analysé, on le fait maintenant
      for (const att of atts) {
        let text = att.ocr_analysis;
        if (!text || typeof text !== "string") {
           text = await analyzeImageSAP(att.path);
        }
        visionContext += `\n[Données extraites de l'image SAP]:\n${text}\n`;
      }
    }

    const systemPrompt = `
      CONTEXTE:
      Demande: "${requestText}"
      Fichier: "${templateFilename}"
      
      STRUCTURE DU FICHIER:
      ${fileContext.slice(0, 4000)}

      DONNÉES VISUELLES (Screenshots SAP):
      ${visionContext ? visionContext : "Aucune capture fournie."}

      TACHE:
      Génère les instructions de remplissage.
      IMPORTANT : Si des données sont présentes dans les screenshots (ID équipement, Work Center), UTILISE-LES EXPLICITEMENT. Sinon, génère des exemples réalistes.

      FORMAT JSON (Array) :
      {
        "steps": [
          {
            "row": "6",
            "col": "H",
            "code": "ACTION",
            "label": "Action",
            "value": "Create",
            "reason": "...",
            "mandatory": true
          }
        ]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: "Tu es un expert SAP technique qui sait lire des screenshots." },
        { role: "user", content: systemPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const raw = cleanJSON(completion.choices[0].message.content);
    const instructions = raw.steps || (Array.isArray(raw) ? raw : []);

    res.json(instructions);

  } catch (e) {
    console.error("[Wizard Instructions] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 3. AUTO-FILL : GÉNÉRATION DU FICHIER REMPLI (NOUVEAU)
app.post("/api/dcf/wizard/autofill", async (req, res) => {
  try {
    const { templateFilename, instructions } = req.body;

    if (!templateFilename || !instructions || !instructions.length) {
      throw new Error("Paramètres manquants pour l'autofill");
    }

    // 1. Retrouver le fichier original sur le disque
    const { rows: files } = await pool.query(
      `SELECT path, filename FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [templateFilename]
    );

    if (files.length === 0) throw new Error("Fichier template introuvable sur le serveur.");
    
    const sourcePath = files[0].path;
    
    // 2. Charger le workbook
    const wb = xlsx.readFile(sourcePath, { cellFormula: false, cellHTML: false });
    
    // 3. Appliquer les modifications
    // On suppose que l'IA a donné des instructions pour la première feuille ou une feuille spécifique
    // Pour simplifier, on prend la feuille active ou la première qui contient des données DCF
    const sheetName = wb.SheetNames[0]; 
    const ws = wb.Sheets[sheetName];

    instructions.forEach(step => {
      if (step.col && step.row && step.value) {
        const cellRef = `${step.col}${step.row}`; // Ex: "H6"
        // Ecriture brute (xlsx gère le type si possible, sinon string)
        ws[cellRef] = { t: 's', v: String(step.value) };
      }
    });

    // 4. Ecrire dans un buffer
    const newFilename = `FILLED_${templateFilename.replace('.xlsm', '.xlsx')}`; // On sort en xlsx pour éviter les soucis de macros corrompues, ou on garde xlsm
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 5. Envoyer le fichier
    res.setHeader('Content-Disposition', `attachment; filename="${newFilename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (e) {
    console.error("[AutoFill] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 4. VALIDATION STRICTE
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
      Réponds en JSON :
      { "report_text": "...", "critical": [], "warnings": [], "suggestions": [] }
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
// ROUTES STANDARD (Uploads, Sessions...)
// -----------------------------------------------------------------------------

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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

app.post("/api/dcf/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
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

// Attachment upload (Image)
app.post("/api/dcf/attachments/upload", uploadAttach.array("files"), async (req, res) => {
  try {
    const files = req.files || [];
    const { session_id } = req.body;
    const items = [];
    for (const f of files) {
      // Analyse immédiate pour le Continuous Learning / Vision context
      let analysis = null;
      if (f.mimetype.startsWith("image/")) {
        analysis = await analyzeImageSAP(f.path);
      }
      const { rows } = await pool.query(
        `INSERT INTO dcf_attachments (session_id, filename, stored_name, path, mime, bytes, ocr_analysis)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, filename`,
        [session_id || null, f.originalname, f.filename, f.path, f.mimetype, f.size, analysis]
      );
      items.push(rows[0]);
    }
    res.json({ ok: true, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/dcf/health", (req, res) => res.json({ status: "ok", version: "5.0" }));

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v5] Backend Ultimate démarré sur http://${HOST}:${PORT}`);
});
