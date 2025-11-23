// server_dcf.js — Assistant DCF SAP v6 (Architecture "Charles" Complète)
// Features: Multi-fichiers, Vision, Auto-fill (support Macros), Indexation, Règles Métier Strictes
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
// 1. CONFIGURATION & UTILS
// -----------------------------------------------------------------------------
const PORT = Number(process.env.DCF_PORT || 3030);
const HOST = process.env.DCF_HOST || "127.0.0.1";

const DATA_ROOT = path.join(process.cwd(), "uploads", "dcf");
const EXCEL_DIR = path.join(DATA_ROOT, "excel");
const ATTACH_DIR = path.join(DATA_ROOT, "attachments");
const OUTPUT_DIR = path.join(DATA_ROOT, "output");

// Création des dossiers (Système de fichiers)
await fsp.mkdir(EXCEL_DIR, { recursive: true });
await fsp.mkdir(ATTACH_DIR, { recursive: true });
await fsp.mkdir(OUTPUT_DIR, { recursive: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ANSWER_MODEL = process.env.DCF_MODEL || "gpt-4o";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

function cleanJSON(text) {
  if (!text) return {};
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } 
  catch (e) { return { error: "Invalid JSON", raw: text }; }
}

function sanitizeName(name = "") { return String(name).replace(/[^\w.\-]+/g, "_"); }
function safeEmail(x) { return x && /\S+@\S+\.\S+/.test(x) ? String(x).trim().toLowerCase() : null; }
function getUserEmail(req) { return safeEmail(req.headers["x-user-email"] || req.headers["x-user_email"]); }

// Helper Excel : Convertit index 0 -> "A"
function columnIndexToLetter(idx) {
  let n = idx + 1, s = "";
  while (n > 0) {
    const r = ((n - 1) % 26) + 65;
    s = String.fromCharCode(r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// -----------------------------------------------------------------------------
// 2. ANALYSE EXCEL & INDEXATION (Le "Cerveau")
// -----------------------------------------------------------------------------
const SAP_FIELD_DICTIONARY = {
  VORNR_01: { name: "Operation Number", mandatory: true },
  "ARBPL-02": { name: "Work Center", mandatory: true },
  STEUS: { name: "Control Key", mandatory: true },
  LTXA1: { name: "Short Text", mandatory: true },
  TPLNR: { name: "Func. Loc.", mandatory: true },
  EQUNR: { name: "Equipment", mandatory: true },
  PLNNR: { name: "Group / Plan", mandatory: true },
  ACTION: { name: "Action", mandatory: true }
};

// Analyse un fichier et retourne structure + valeurs uniques pour l'indexation
function buildDeepExcelAnalysis(absPath) {
  try {
    const wb = xlsx.readFile(absPath, { cellDates: false, sheetRows: 0 });
    const analysis = {
      filename: path.basename(absPath),
      sheetNames: wb.SheetNames || [],
      ai_context: "",
      extracted_values: [] // Pour l'indexation v6
    };

    let globalContext = "";

    for (const sheetName of analysis.sheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!raw.length) continue;

      // Détection Header DCF
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(raw.length, 30); i++) {
        const rowStr = raw[i].map(x => String(x).toUpperCase()).join(" ");
        if (rowStr.includes("ACTION") && (rowStr.includes("LINE") || rowStr.includes("OBJECT"))) {
          headerRowIdx = i;
          break;
        }
      }

      if (headerRowIdx !== -1 && raw[headerRowIdx + 1]) {
        const codes = raw[headerRowIdx + 1];
        const columns = [];
        
        codes.forEach((code, idx) => {
          const c = String(code).trim();
          if (c.length > 2) {
            columns.push({ col: columnIndexToLetter(idx), idx, code: c });
          }
        });

        // Extraction des valeurs pour l'apprentissage (v6)
        const dataStart = headerRowIdx + 3;
        for (let r = dataStart; r < raw.length; r++) {
          const row = raw[r];
          columns.forEach(colDef => {
            const val = row[colDef.idx];
            if (val && String(val).trim().length > 1) {
              // On indexe seulement les champs clés
              if (["ARBPL-02", "WERKS", "STEUS", "PLNNR", "EQUNR"].includes(colDef.code)) {
                analysis.extracted_values.push({
                  field: colDef.code,
                  value: String(val).trim(),
                  sheet: sheetName
                });
              }
            }
          });
        }

        globalContext += `\n--- FEUILLE: ${sheetName} ---\nMapping: ${columns.map(c => `${c.col}=${c.code}`).join(", ")}\n`;
      }
    }
    analysis.ai_context = globalContext;
    return analysis;
  } catch (e) {
    console.error("Analysis Error", e);
    return { error: e.message, ai_context: "" };
  }
}

// Vision SAP
async function analyzeImageSAP(imagePath) {
  try {
    const buffer = await fsp.readFile(imagePath);
    const base64 = buffer.toString("base64");
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: "Expert SAP. Extrais tout texte technique (ID, Plan, Task List, Opération) en JSON." },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } }] }
      ],
      max_tokens: 800,
    });
    return response.choices?.[0]?.message?.content || "";
  } catch { return ""; }
}

// -----------------------------------------------------------------------------
// 3. BASE DE DONNÉES (Schema Complet & Explicite)
// -----------------------------------------------------------------------------
async function ensureSchema() {
  
  // 1. Table des fichiers uploadés
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

  // 2. Table des sessions (Conversations)
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

  // 3. Table des messages (Chat)
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

  // 4. Table des pièces jointes (Images/Screenshots)
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

  // 5. Table des requêtes Wizard (Historique v4/v5/v6)
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

  // 6. Table d'Indexation des Valeurs (Cerveau v6)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_values_index (
      id SERIAL PRIMARY KEY,
      field_code TEXT,   -- ex: ARBPL-02
      value TEXT,        -- ex: CH940015
      source_file_id INT REFERENCES dcf_files(id),
      seen_count INT DEFAULT 1,
      last_seen_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (field_code, value)
    )
  `);

  // Migration de sécurité (Au cas où une vieille version existe)
  try { 
    await pool.query(`ALTER TABLE dcf_requests ADD COLUMN IF NOT EXISTS response_json JSONB`); 
  } catch (e) {
    console.log("Migration check: ", e.message);
  }
  
  console.log("[DB] Schema v6 (Complet & Explicite) ready.");
}
await ensureSchema();

// Helper pour indexer un fichier après upload
async function indexFileValues(fileId, analysis) {
  if (!analysis.extracted_values || !analysis.extracted_values.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of analysis.extracted_values) {
      await client.query(`
        INSERT INTO dcf_values_index (field_code, value, source_file_id, seen_count, last_seen_at)
        VALUES ($1, $2, $3, 1, now())
        ON CONFLICT (field_code, value) 
        DO UPDATE SET seen_count = dcf_values_index.seen_count + 1, last_seen_at = now()
      `, [item.field, item.value, fileId]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("[Indexer] Failed", e);
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// 4. MULTER CONFIG
// -----------------------------------------------------------------------------
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, EXCEL_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${sanitizeName(file.originalname)}`)
});
const uploadExcel = multer({ storage: excelStorage });

const attachStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ATTACH_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${sanitizeName(file.originalname)}`)
});
const uploadAttach = multer({ storage: attachStorage });

// -----------------------------------------------------------------------------
// 5. LOGIQUE WIZARD V6 (PROTOCOLES STRICTES)
// -----------------------------------------------------------------------------

// ÉTAPE 1 : ANALYSE (Protocole Charles)
app.post("/api/dcf/wizard/analyze", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    // Récupération de la bibliothèque (Templates disponibles)
    const { rows: recentFiles } = await pool.query(`SELECT id, filename FROM dcf_files ORDER BY uploaded_at DESC LIMIT 50`);
    const filesList = recentFiles.map(f => `- ${f.filename} (ID: ${f.id})`).join("\n");

    const systemPrompt = `
      Tu es l'Expert Technique SAP DCF (Niveau Senior).
      
      RÈGLES MÉTIER STRICTES (Protocole Charles):
      
      1. **MODIFICATION TEXTE / DESCRIPTION** :
         - Si l'utilisateur veut juste changer un texte court, un long text, ou corriger une faute -> **MANUEL** (Pas de DCF).
         - Réponds: "is_manual": true.
      
      2. **AJOUT D'OPÉRATION DANS UN PLAN** :
         - ATTENTION : Dans SAP, on n'ajoute pas une opération dans le "Plan" directement. On l'ajoute dans la **TASK LIST** (Gamme) liée au plan.
         - Fichier requis : **Task List** (ex: ERP_MDCF_Task_List...).
         - NE PAS recommander "Maintenance Plan" pour un ajout d'opération technique.
      
      3. **AJOUT D'UN ÉQUIPEMENT DANS UN PLAN** :
         - Là, on touche à la structure du plan (Maintenance Item).
         - Fichier requis : **Maintenance Plan**.
      
      4. **DÉCOMMISSIONNEMENT (Suppression complète)** :
         - C'est complexe. Il faut souvent 3 fichiers :
           a) **Task List** (pour vider les opérations)
           b) **Maintenance Plan** (pour désactiver les items)
           c) **Equipment** (pour mettre le statut INAC/DLFL)
         - Recommande les 3 si l'utilisateur veut "tout supprimer".

      BIBLIOTHÈQUE DISPONIBLE :
      ${filesList}

      Réponds en JSON strict :
      {
        "action": "create_operation_in_tl" | "modify_text" | "decommission_full",
        "is_manual": boolean,
        "reasoning": "Explication technique précise...",
        "required_files": [
           { "type": "Task List", "template_filename": "MeilleurMatch.xlsx", "file_id": 123, "usage": "Ajout de l'opération 0020" }
        ]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
      response_format: { type: "json_object" },
      temperature: 0.0 // Zéro température pour éviter les hallucinations
    });

    const result = cleanJSON(completion.choices[0].message.content);

    // Matching IDs si l'IA a oublié
    if (result.required_files) {
      result.required_files.forEach(rf => {
        const match = recentFiles.find(f => f.filename === rf.template_filename);
        if (match) rf.file_id = match.id;
      });
    }

    if (sessionId) await pool.query(`INSERT INTO dcf_requests (session_id, request_text, detected_action, response_json) VALUES ($1, $2, $3, $4)`, [sessionId, message, result.action, result]);

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ÉTAPE 3 : INSTRUCTIONS + VISION
app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { requestText, templateFilename, attachmentIds } = req.body;

    // 1. Contexte Fichier
    let fileContext = "";
    const { rows: files } = await pool.query(`SELECT analysis FROM dcf_files WHERE filename = $1 LIMIT 1`, [templateFilename]);
    if (files.length) fileContext = files[0].analysis.ai_context || "";

    // 2. Contexte Vision
    let visionContext = "";
    if (attachmentIds?.length) {
      const { rows: atts } = await pool.query(`SELECT path, ocr_analysis FROM dcf_attachments WHERE id = ANY($1::int[])`, [attachmentIds]);
      for (const att of atts) {
        let text = att.ocr_analysis || await analyzeImageSAP(att.path);
        visionContext += `\n[SCREENSHOT DATA]: ${text}\n`;
      }
    }

    const prompt = `
      CONTEXTE: "${requestText}"
      FICHIER: "${templateFilename}"
      STRUCTURE DETECTEE: ${fileContext.slice(0, 5000)}
      DONNÉES VISUELLES: ${visionContext || "N/A"}

      ACTION: Génère les instructions de remplissage LIGNE PAR LIGNE.
      PRIORITÉ: Utilise les données des screenshots (ID, Plan, WorkCtr) si disponibles.
      
      FORMAT JSON: { "steps": [{ "row": "6", "col": "H", "code": "ACTION", "label":"...", "value": "Create", "reason": "...", "mandatory": true }] }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "system", content: "Expert SAP Technique." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    res.json(cleanJSON(completion.choices[0].message.content).steps || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ÉTAPE 3 (Bonus) : AUTO-FILL (Génération Fichier avec support Macros)
app.post("/api/dcf/wizard/autofill", async (req, res) => {
  try {
    const { templateFilename, instructions } = req.body;
    
    const { rows: files } = await pool.query(`SELECT path FROM dcf_files WHERE filename = $1 LIMIT 1`, [templateFilename]);
    if (!files.length) throw new Error("Template introuvable");

    const isMacro = templateFilename.toLowerCase().endsWith(".xlsm");
    
    // On charge le fichier sans parser les formules pour gagner du temps et de la stabilité
    const wb = xlsx.readFile(files[0].path, { cellFormula: false });
    const ws = wb.Sheets[wb.SheetNames[0]]; // On prend la 1ère feuille par défaut

    // Appliquer instructions
    if (instructions && Array.isArray(instructions)) {
      instructions.forEach(step => {
        if (step.col && step.row) {
          const ref = `${step.col}${step.row}`;
          // Force en string pour éviter les bugs de format SAP
          ws[ref] = { t: 's', v: String(step.value || "") };
        }
      });
    }

    // Export en respectant le type (xlsm ou xlsx)
    const bookType = isMacro ? "xlsm" : "xlsx";
    const newFilename = `FILLED_${templateFilename}`;
    
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: bookType });
    
    res.setHeader('Content-Disposition', `attachment; filename="${newFilename}"`);
    res.send(buffer);
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: e.message }); 
  }
});

// ÉTAPE 4 : VALIDATION PRÉDICTIVE (v6)
app.post("/api/dcf/wizard/validate", async (req, res) => {
  try {
    const { fileIds } = req.body;
    const { rows: files } = await pool.query(`SELECT filename, analysis FROM dcf_files WHERE id = ANY($1::int[])`, [fileIds]);

    const context = files.map(f => `Fichier: ${f.filename}\nStructure:\n${f.analysis.ai_context}`).join("\n");
    
    const prompt = `
      Valide ces fichiers DCF SAP.
      Structure:
      ${context.slice(0, 8000)}
      
      Règles:
      1. Champs obligatoires (VORNR, ARBPL, etc.)
      2. Cohérence (Action=Create nécessite des données)
      
      JSON: { "report": "...", "critical": [], "warnings": [], "suggestions": [] }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "system", content: "Validateur SAP Strict." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const result = cleanJSON(completion.choices[0].message.content);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MODULE : REVERSE DCF (Explication de fichier)
app.post("/api/dcf/wizard/explain", async (req, res) => {
  try {
    const { fileId } = req.body;
    const { rows } = await pool.query(`SELECT path, filename FROM dcf_files WHERE id = $1`, [fileId]);
    if (!rows.length) throw new Error("Fichier introuvable");

    const wb = xlsx.readFile(rows[0].path, { sheetRows: 50 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const csv = xlsx.utils.sheet_to_csv(ws);

    const prompt = `
      Tu es un analyste SAP. Voici le contenu brut d'un fichier DCF.
      Explique ce que ce fichier va faire dans SAP.
      CSV: ${csv.slice(0, 5000)}
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "user", content: prompt }]
    });

    res.json({ explanation: completion.choices[0].message.content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------------
// 6. ROUTES GLOBALES (Upload, Health, etc.)
// -----------------------------------------------------------------------------

app.post("/api/dcf/uploadExcel", uploadExcel.single("file"), async (req, res) => {
  try {
    const analysis = buildDeepExcelAnalysis(req.file.path);
    const { rows } = await pool.query(`INSERT INTO dcf_files (filename, path, analysis) VALUES ($1, $2, $3) RETURNING id, filename`, [req.file.originalname, req.file.path, analysis]);
    await indexFileValues(rows[0].id, analysis); // Indexation
    res.json({ ok: true, file: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/dcf/uploadExcelMulti", uploadExcel.array("files"), async (req, res) => {
  try {
    const out = [];
    for (const f of req.files) {
      const analysis = buildDeepExcelAnalysis(f.path);
      const { rows } = await pool.query(`INSERT INTO dcf_files (filename, path, analysis) VALUES ($1, $2, $3) RETURNING id, filename`, [f.originalname, f.path, analysis]);
      await indexFileValues(rows[0].id, analysis);
      out.push(rows[0]);
    }
    res.json({ ok: true, files: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/dcf/startSession", async (req, res) => {
  const { rows } = await pool.query(`INSERT INTO dcf_sessions (title) VALUES ($1) RETURNING id`, [req.body.title || "Session DCF"]);
  res.json({ ok: true, sessionId: rows[0].id });
});

app.post("/api/dcf/attachments/upload", uploadAttach.array("files"), async (req, res) => {
  const items = [];
  for (const f of req.files) {
    let ocr = null;
    if (f.mimetype.startsWith("image/")) ocr = await analyzeImageSAP(f.path);
    const { rows } = await pool.query(`INSERT INTO dcf_attachments (session_id, filename, path, ocr_analysis) VALUES ($1, $2, $3, $4) RETURNING id`, [req.body.session_id, f.originalname, f.path, ocr]);
    items.push(rows[0]);
  }
  res.json({ ok: true, items });
});

app.post("/api/dcf/chat", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "system", content: "Assistant SAP." }, { role: "user", content: req.body.message }]
    });
    res.json({ ok: true, answer: completion.choices[0].message.content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/dcf/sessions", async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM dcf_sessions ORDER BY created_at DESC LIMIT 20`);
  res.json({ ok: true, sessions: rows });
});

app.get("/api/dcf/files", async (req, res) => {
  const { rows } = await pool.query(`SELECT id, filename, uploaded_at FROM dcf_files ORDER BY uploaded_at DESC LIMIT 50`);
  res.json({ ok: true, files: rows });
});

app.get("/api/dcf/health", (req, res) => res.json({ status: "ok", version: "6.0 Ultimate" }));

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v6] Backend Ultimate (Charles Protocol) démarré sur http://${HOST}:${PORT}`);
});
