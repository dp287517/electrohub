// server_dcf.js — Assistant DCF SAP v7 (Full Database Storage)
// FIX: Plus aucune dépendance au système de fichiers (évite l'erreur ENOENT sur Render)
// Node ESM

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import pg from "pg"; // Client Postgres
import { fileURLToPath } from "url";
import OpenAI from "openai";
import xlsx from "xlsx";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));

// -----------------------------------------------------------------------------
// 1. CONFIGURATION
// -----------------------------------------------------------------------------
const PORT = Number(process.env.DCF_PORT || 3030);
const HOST = process.env.DCF_HOST || "127.0.0.1";

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ANSWER_MODEL = process.env.DCF_MODEL || "gpt-4o";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o";

// Database
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// Utils
function cleanJSON(text) {
  if (!text) return {};
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } 
  catch (e) { return { error: "Invalid JSON", raw: text }; }
}

function safeEmail(x) { return x && /\S+@\S+\.\S+/.test(x) ? String(x).trim().toLowerCase() : null; }
function getUserEmail(req) { return safeEmail(req.headers["x-user-email"] || req.headers["x-user_email"]); }

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
// 2. ANALYSE EXCEL (Depuis Buffer Mémoire)
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

function buildDeepExcelAnalysis(fileBuffer, originalName) {
  try {
    // Lecture depuis le buffer (RAM) au lieu du disque
    const wb = xlsx.read(fileBuffer, { type: "buffer", cellDates: false, sheetRows: 0 });
    
    const analysis = {
      filename: originalName,
      sheetNames: wb.SheetNames || [],
      ai_context: "",
      extracted_values: []
    };

    let globalContext = "";

    for (const sheetName of analysis.sheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      // Conversion en JSON pour analyse structure
      const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!raw.length) continue;

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

        // Extraction valeurs pour indexation
        const dataStart = headerRowIdx + 3;
        for (let r = dataStart; r < raw.length; r++) {
          const row = raw[r];
          columns.forEach(colDef => {
            const val = row[colDef.idx];
            if (val && String(val).trim().length > 1) {
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
    return { error: e.message, ai_context: "Erreur lecture fichier" };
  }
}

async function analyzeImageSAP(fileBuffer, mimeType) {
  try {
    const base64 = fileBuffer.toString("base64");
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: "Expert SAP. Extrais texte technique (ID, Plan, Task List, Opération) en JSON." },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }] }
      ],
      max_tokens: 800,
    });
    return response.choices?.[0]?.message?.content || "";
  } catch { return ""; }
}

// -----------------------------------------------------------------------------
// 3. BASE DE DONNÉES (Schema v7 - Avec File Data)
// -----------------------------------------------------------------------------
async function ensureSchema() {
  // Table Fichiers (Avec stockage binaire BYTEA)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_files (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      mime TEXT,
      bytes BIGINT,
      sheet_names TEXT[],
      analysis JSONB,
      uploaded_at TIMESTAMPTZ DEFAULT now(),
      file_data BYTEA,
      stored_name TEXT,
      path TEXT 
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

  // Attachments (Avec stockage binaire BYTEA)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_attachments (
      id SERIAL PRIMARY KEY,
      session_id UUID NULL REFERENCES dcf_sessions(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mime TEXT,
      bytes BIGINT,
      ocr_analysis JSONB,
      uploaded_at TIMESTAMPTZ DEFAULT now(),
      file_data BYTEA,
      stored_name TEXT,
      path TEXT
    )
  `);

  // Requests (Historique Wizard)
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

  // Index
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_values_index (
      id SERIAL PRIMARY KEY,
      field_code TEXT,
      value TEXT,
      source_file_id INT REFERENCES dcf_files(id),
      seen_count INT DEFAULT 1,
      last_seen_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (field_code, value)
    )
  `);

  // MIGRATION DE SECURITE
  // On s'assure que les colonnes BYTEA existent bien
  try { await pool.query(`ALTER TABLE dcf_files ADD COLUMN IF NOT EXISTS file_data BYTEA`); } catch(e) {}
  try { await pool.query(`ALTER TABLE dcf_attachments ADD COLUMN IF NOT EXISTS file_data BYTEA`); } catch(e) {}
  try { await pool.query(`ALTER TABLE dcf_requests ADD COLUMN IF NOT EXISTS response_json JSONB`); } catch(e) {}

  console.log("[DB] Schema v7 (Full Database Storage) ready.");
}
await ensureSchema();

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
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// 4. MULTER (MEMORY STORAGE - CRITIQUE)
// -----------------------------------------------------------------------------
// On stocke dans la RAM (buffer) pour envoyer directement à la DB
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// -----------------------------------------------------------------------------
// 5. ROUTES WIZARD v7
// -----------------------------------------------------------------------------

// ANALYSE (Pas de changement logique, juste accès DB propre)
app.post("/api/dcf/wizard/analyze", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    // On récupère la liste des fichiers (juste les noms)
    const { rows: recentFiles } = await pool.query(`SELECT id, filename FROM dcf_files WHERE file_data IS NOT NULL ORDER BY uploaded_at DESC LIMIT 50`);
    const filesList = recentFiles.map(f => `- ${f.filename} (ID: ${f.id})`).join("\n");

    const systemPrompt = `
      Tu es l'Expert Technique SAP DCF.
      RÈGLES MÉTIER STRICTES (Protocole Charles):
      1. **MODIFICATION TEXTE** -> "is_manual": true.
      2. **AJOUT D'OPÉRATION** -> Fichier **Task List** requis.
      3. **AJOUT D'ÉQUIPEMENT DANS PLAN** -> Fichier **Maintenance Plan**.
      4. **DÉCOMMISSIONNEMENT** -> Pack 3 fichiers (Task List, Maint Plan, Equipment).

      BIBLIOTHÈQUE :
      ${filesList}

      Réponds en JSON strict :
      {
        "action": "type_action",
        "is_manual": boolean,
        "reasoning": "...",
        "required_files": [{ "type": "...", "template_filename": "...", "file_id": 123, "usage": "..." }]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
      response_format: { type: "json_object" },
      temperature: 0.0
    });

    const result = cleanJSON(completion.choices[0].message.content);

    if (result.required_files) {
      result.required_files.forEach(rf => {
        const match = recentFiles.find(f => f.filename === rf.template_filename);
        if (match) rf.file_id = match.id;
      });
    }

    if (sessionId) await pool.query(`INSERT INTO dcf_requests (session_id, request_text, detected_action, response_json) VALUES ($1, $2, $3, $4)`, [sessionId, message, result.action, result]);

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// INSTRUCTIONS (Avec Vision DB)
app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { requestText, templateFilename, attachmentIds } = req.body;

    // 1. Contexte Fichier
    let fileContext = "";
    const { rows: files } = await pool.query(`SELECT analysis FROM dcf_files WHERE filename = $1 LIMIT 1`, [templateFilename]);
    if (files.length) fileContext = files[0].analysis.ai_context || "";

    // 2. Contexte Vision (Lecture depuis DB buffer)
    let visionContext = "";
    if (attachmentIds?.length) {
      const { rows: atts } = await pool.query(`SELECT ocr_analysis, file_data, mime FROM dcf_attachments WHERE id = ANY($1::int[])`, [attachmentIds]);
      for (const att of atts) {
        let text = att.ocr_analysis;
        // Si pas d'analyse pré-calculée, on le fait à la volée avec le buffer
        if ((!text || typeof text !== 'string') && att.file_data) {
           text = await analyzeImageSAP(att.file_data, att.mime);
        }
        visionContext += `\n[SCREENSHOT DATA]: ${text}\n`;
      }
    }

    const prompt = `
      CONTEXTE: "${requestText}"
      FICHIER: "${templateFilename}"
      STRUCTURE: ${fileContext.slice(0, 5000)}
      VISION: ${visionContext || "N/A"}

      ACTION: Génère instructions LIGNE PAR LIGNE.
      JSON: { "steps": [{ "row": "6", "col": "H", "code": "ACTION", "label":"...", "value": "Create", "reason": "...", "mandatory": true }] }
    `;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "system", content: "Expert SAP." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    res.json(cleanJSON(completion.choices[0].message.content).steps || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AUTO-FILL (Lecture DB -> Buffer -> DB)
app.post("/api/dcf/wizard/autofill", async (req, res) => {
  try {
    const { templateFilename, instructions } = req.body;
    
    // 1. Charger fichier depuis DB
    const { rows: files } = await pool.query(`SELECT file_data FROM dcf_files WHERE filename = $1 ORDER BY uploaded_at DESC LIMIT 1`, [templateFilename]);
    if (!files.length || !files[0].file_data) throw new Error("Fichier introuvable en base (Veuillez le ré-uploader).");

    const isMacro = templateFilename.toLowerCase().endsWith(".xlsm");
    
    // Lecture Buffer
    const wb = xlsx.read(files[0].file_data, { type: "buffer", cellFormula: false });
    const ws = wb.Sheets[wb.SheetNames[0]]; 

    // Application
    if (instructions && Array.isArray(instructions)) {
      instructions.forEach(step => {
        if (step.col && step.row) {
          const ref = `${step.col}${step.row}`;
          ws[ref] = { t: 's', v: String(step.value || "") };
        }
      });
    }

    // Export
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

// VALIDATION
app.post("/api/dcf/wizard/validate", async (req, res) => {
  try {
    const { fileIds } = req.body;
    const { rows: files } = await pool.query(`SELECT filename, analysis FROM dcf_files WHERE id = ANY($1::int[])`, [fileIds]);
    const context = files.map(f => `Fichier: ${f.filename}\nStructure:\n${f.analysis.ai_context}`).join("\n");
    
    const prompt = `Valide ces fichiers DCF SAP.\n${context.slice(0, 8000)}\nJSON: { "report": "...", "critical": [], "warnings": [], "suggestions": [] }`;

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [{ role: "system", content: "Validateur SAP." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    res.json(cleanJSON(completion.choices[0].message.content));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------------
// 6. ROUTES GLOBALES (UPLOAD EN DB)
// -----------------------------------------------------------------------------

// Upload Excel : Buffer -> DB
app.post("/api/dcf/uploadExcel", upload.single("file"), async (req, res) => {
  try {
    const analysis = buildDeepExcelAnalysis(req.file.buffer, req.file.originalname);
    const { rows } = await pool.query(
      `INSERT INTO dcf_files (filename, mime, bytes, sheet_names, analysis, file_data) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename`, 
      [req.file.originalname, req.file.mimetype, req.file.size, analysis.sheetNames, analysis, req.file.buffer]
    );
    await indexFileValues(rows[0].id, analysis);
    res.json({ ok: true, file: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload Multi
app.post("/api/dcf/uploadExcelMulti", upload.array("files"), async (req, res) => {
  try {
    const out = [];
    for (const f of req.files) {
      const analysis = buildDeepExcelAnalysis(f.buffer, f.originalname);
      const { rows } = await pool.query(
        `INSERT INTO dcf_files (filename, mime, bytes, sheet_names, analysis, file_data) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename`, 
        [f.originalname, f.mimetype, f.size, analysis.sheetNames, analysis, f.buffer]
      );
      await indexFileValues(rows[0].id, analysis);
      out.push(rows[0]);
    }
    res.json({ ok: true, files: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Session
app.post("/api/dcf/startSession", async (req, res) => {
  const { rows } = await pool.query(`INSERT INTO dcf_sessions (title) VALUES ($1) RETURNING id`, [req.body.title || "Session DCF"]);
  res.json({ ok: true, sessionId: rows[0].id });
});

// Upload Attachments (Images) : Buffer -> DB
app.post("/api/dcf/attachments/upload", upload.array("files"), async (req, res) => {
  try {
    const items = [];
    for (const f of req.files) {
      let ocr = null;
      // Analyse immédiate
      if (f.mimetype.startsWith("image/")) ocr = await analyzeImageSAP(f.buffer, f.mimetype);
      
      const { rows } = await pool.query(
        `INSERT INTO dcf_attachments (session_id, filename, mime, bytes, ocr_analysis, file_data) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, 
        [req.body.session_id, f.originalname, f.mimetype, f.size, ocr, f.buffer]
      );
      items.push(rows[0]);
    }
    res.json({ ok: true, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Chat
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

// Liste fichiers (sans le blob lourd)
app.get("/api/dcf/files", async (req, res) => {
  const { rows } = await pool.query(`SELECT id, filename, uploaded_at FROM dcf_files WHERE file_data IS NOT NULL ORDER BY uploaded_at DESC LIMIT 50`);
  res.json({ ok: true, files: rows });
});

app.get("/api/dcf/health", (req, res) => res.json({ status: "ok", version: "7.0 FullDB" }));

app.listen(PORT, HOST, () => {
  console.log(`[dcf-v7] Backend Full Database démarré sur http://${HOST}:${PORT}`);
});
