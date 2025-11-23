// server_dcf.js — Assistant DCF SAP v7.3 (Full Backend corrigé)
// - Conserve toutes les routes actuelles
// - Corrige les parties invalides (ellipsis)
// - Ajoute robustesse validation + upload + parsing Excel
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
if (!DATABASE_URL) {
  console.error("❌ NEON_DATABASE_URL / DATABASE_URL manquante");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
});

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ANSWER_MODEL = process.env.DCF_ANSWER_MODEL || "gpt-4o-mini";
const VISION_MODEL = process.env.DCF_VISION_MODEL || "gpt-4o-mini";

// Limites sécurité
const MAX_FILES_LIBRARY = 50;       // liste pour analyze
const MAX_CONTEXT_CHARS = 12000;    // prompt validate/instructions
const MAX_ATTACHMENT_TEXT = 6000;   // OCR accumulé par prompt

// -----------------------------------------------------------------------------
// 1. EXPRESS SETUP
// -----------------------------------------------------------------------------

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));

// -----------------------------------------------------------------------------
// 2. HELPERS JSON / SANITIZE
// -----------------------------------------------------------------------------

function cleanJSON(text = "") {
  try {
    const cleaned = text
      .trim()
      .replace(/```json/gi, "")
      .replace(/```/g, "");
    return JSON.parse(cleaned);
  } catch (e) {
    return { error: "Invalid JSON", raw: text };
  }
}

function sanitizeName(name = "") {
  return String(name).replace(/[^\w.\-]+/g, "_");
}

function safeEmail(x) {
  return x && /\S+@\S+\.\S+/.test(x)
    ? String(x).trim().toLowerCase()
    : null;
}

function getUserEmail(req) {
  return safeEmail(req.headers["x-user-email"] || req.headers["x-user_email"]);
}

// -----------------------------------------------------------------------------
// 3. EXCEL ANALYSIS (structure DCF)
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

/**
 * Analyse profonde “DCF-like” :
 * - détecte ligne header (Code / Field / Champ)
 * - récupère codes, labels, et valeurs existantes
 * - génère un contexte IA par sheet
 */
function buildDeepExcelAnalysis(buffer, originalName = "") {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: false });
  const analysis = {
    filename: originalName,
    sheetNames: wb.SheetNames || [],
    ai_context: "",
    sheets: [],
    extracted_values: []
  };

  let globalContext = "";

  for (const sheetName of analysis.sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!raw.length) continue;

    // Heuristique : trouver la ligne contenant “Code” / “Champ” / “Field”
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(raw.length, 30); r++) {
      const row = raw[r].map((c) => String(c).toLowerCase());
      if (
        row.some((c) => c.includes("code")) ||
        row.some((c) => c.includes("field")) ||
        row.some((c) => c.includes("champ"))
      ) {
        headerRowIdx = r;
        break;
      }
    }

    // fallback : si rien trouvé, on prend la 1ère ligne non vide
    if (headerRowIdx === -1) {
      headerRowIdx = raw.findIndex((r) =>
        r.some((c) => String(c).trim() !== "")
      );
      if (headerRowIdx === -1) headerRowIdx = 0;
    }

    const codesRow = raw[headerRowIdx + 1] || [];
    const labelsRow = raw[headerRowIdx + 2] || [];

    const columns = [];
    codesRow.forEach((code, idx) => {
      const c = String(code).trim();
      if (c.length > 1 && /[A-Za-z0-9]/.test(c)) {
        const label = String(labelsRow[idx] || "").trim();
        columns.push({
          idx,
          col: columnIndexToLetter(idx),
          code: c,
          label
        });
      }
    });

    const dataStartIdx = headerRowIdx + 3;
    const dataRows = raw.slice(dataStartIdx);

    // Extraction valeurs existantes
    const extracted = [];
    dataRows.forEach((rowArr, ridx) => {
      const rowNumber = dataStartIdx + ridx + 1; // Excel 1-indexed
      columns.forEach((colDef) => {
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
        }
      });
    });

    analysis.extracted_values.push(...extracted);

    const sheetContext =
      `SHEET "${sheetName}"\n` +
      `Colonnes détectées: ${columns
        .map((c) => `${c.code}${c.label ? ` (${c.label})` : ""} -> ${c.col}`)
        .join(", ")}\n` +
      `Début données: ligne ${dataStartIdx + 1}\n`;

    globalContext += sheetContext + "\n";

    analysis.sheets.push({
      name: sheetName,
      headerRowIdx: headerRowIdx + 1,
      columns,
      dataStartRow: dataStartIdx + 1,
      extracted_count: extracted.length
    });
  }

  analysis.ai_context = globalContext.trim();
  return analysis;
}

// Indexation simple des valeurs (optionnel)
// Si ta table n’existe pas encore, ça ne casse pas (try/catch)
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
    } catch (e) {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  } catch (e) {
    // Silent fail volontaire (non bloquant)
  }
}

// -----------------------------------------------------------------------------
// 4. MULTER (MEMORY STORAGE)
// -----------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// -----------------------------------------------------------------------------
// 5. ROUTES WIZARD
// -----------------------------------------------------------------------------

// 5.1 Analyze request -> files required
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

    // Log request si session
    if (sessionId) {
      await pool.query(
        `
        INSERT INTO dcf_requests (session_id, user_request, analysis_json)
        VALUES ($1, $2, $3)
      `,
        [sessionId, message, out]
      );
    }

    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 5.2 Instructions from template + optional SAP screenshots
app.post("/api/dcf/wizard/instructions", async (req, res) => {
  try {
    const { sessionId, requestText, templateFilename, attachmentIds = [] } =
      req.body;

    // récupère le template (dernier uploadé avec ce nom)
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

    // Récupère contexte OCR / vision
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

    const prompt = `
Tu es un Expert SAP DCF. Tu dois remplir un fichier Excel DCF.

DEMANDE UTILISATEUR:
"${requestText}"

FICHIER TEMPLATE:
"${templateFilename}"

STRUCTURE DU TEMPLATE (résumé):
${fileContext.slice(0, 5000)}

DONNÉES SAP (Vision OCR si dispo):
${visionContext || "N/A"}

INSTRUCTIONS:
- Génère une liste d'étapes ligne par ligne pour remplir le DCF.
- Chaque étape doit pointer une cellule (row, col) et un code champ.
- Valeur doit être prêtes à copier/coller.
- mandatory=true si c’est obligatoire.

Réponds en JSON STRICT:
{
  "steps": [
    {
      "row": "6",
      "col": "H",
      "code": "ACTION",
      "label": "texte court",
      "value": "Create / Update / Delete / ...",
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

    // Log si session
    if (sessionId) {
      await pool.query(
        `
        INSERT INTO dcf_steps (session_id, template_id, steps_json)
        VALUES ($1, $2, $3)
      `,
        [sessionId, file.id, steps]
      );
    }

    res.json(steps);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 5.3 Autofill template from instructions -> returns XLSX/XLSM
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

    // Applique sur la 1ère sheet par défaut, sauf si inst.sheet est fourni et existe
    for (const inst of steps) {
      const sheetName =
        inst.sheet && wb.Sheets[inst.sheet]
          ? inst.sheet
          : wb.SheetNames[0];

      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const cellAddress = `${inst.col}${inst.row}`;
      ws[cellAddress] = {
        t: "s",
        v: String(inst.value ?? "")
      };
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

// 5.4 Validate filled excels
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

    // --- NORMALISATION ROBUSTE (évite crash front)
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
// 6. ROUTES LIBRARY UPLOAD
// -----------------------------------------------------------------------------

// Upload single template
app.post("/api/dcf/uploadExcel", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier." });

    const analysis = buildDeepExcelAnalysis(
      req.file.buffer,
      req.file.originalname
    );

    const storedName = `${Date.now()}_${sanitizeName(req.file.originalname)}`;
    const relPath = storedName; // maintien compat schema NOT NULL

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
        analysis.sheetNames,
        analysis,
        req.file.buffer
      ]
    );

    await indexFileValues(rows[0].id, analysis);

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Upload multi templates
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
        const analysis = buildDeepExcelAnalysis(f.buffer, f.originalname);
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
            analysis.sheetNames,
            analysis,
            f.buffer
          ]
        );

        await indexFileValues(rows[0].id, analysis);
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
// 7. SESSIONS
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
    // fallback si colonne created_by n’existe pas
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

// Liste sessions
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
// 8. ATTACHMENTS (SAP screenshots)
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

        // Vision OCR via OpenAI
        try {
          const b64 = f.buffer.toString("base64");
          const completion = await openai.chat.completions.create({
            model: VISION_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "Tu lis une capture SAP. Extrais les codes, ID opérations, numéros plan, équipements. Répond uniquement par le texte utile."
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
        } catch (visionErr) {
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
// 9. GENERIC CHAT (debug)
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
// 10. FILES LIST + HEALTH
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
  res.json({ status: "ok", version: "7.3 Full Fix" })
);

// -----------------------------------------------------------------------------
// 11. START
// -----------------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(
    `[dcf-v7.3] Backend FullDB démarré sur http://${HOST}:${PORT}`
  );
});
