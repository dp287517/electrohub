// server_dcf.js — Assistant DCF SAP (plans de maintenance)
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
app.use(express.json({ limit: "16mb" }));

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
const ANSWER_MODEL = process.env.DCF_MODEL || "gpt-4o-mini";

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

// Crée un petit "texte" exploitable par l'IA à partir du XLSM/XLSX
function buildExcelPreview(absPath) {
  try {
    const wb = xlsx.readFile(absPath, { cellDates: false });
    const sheetNames = wb.SheetNames || [];
    const chunks = [];

    for (const sheetName of sheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const ref = ws["!ref"] || "A1:K40";
      const range = xlsx.utils.decode_range(ref);

      const maxRow = Math.min(range.e.r, 60);
      const maxCol = Math.min(range.e.c, 15);

      const clipRange = {
        s: range.s,
        e: { r: maxRow, c: maxCol },
      };

      const csv = xlsx.utils.sheet_to_csv(ws, {
        FS: "\t",
        RS: "\n",
        blankrows: false,
        raw: true,
        range: clipRange,
      });

      chunks.push(`--- Feuille: ${sheetName} ---\n${csv}`);

      // on limite un peu la taille envoyée à l'IA
      if (chunks.join("\n").length > 32000) break;
    }

    const text_preview = chunks.join("\n").slice(0, 40000);
    return { sheetNames, text_preview };
  } catch (e) {
    console.error("[dcf] erreur preview excel", e);
    return { sheetNames: [], text_preview: null };
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
  limits: { fileSize: 40 * 1024 * 1024 },
});

const uploadAttach = multer({
  storage: attachStorage,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
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
      text_preview TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email TEXT,
      title TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dcf_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id UUID REFERENCES dcf_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
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
      uploaded_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

// Healthcheck
app.get("/api/dcf/health", (_req, res) => {
  res.json({ ok: true, service: "dcf", time: new Date().toISOString() });
});

// Upload Excel DCF
app.post("/api/dcf/uploadExcel", uploadExcel.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Fichier manquant" });
    }
    const file = req.file;
    const absPath = file.path;

    const { sheetNames, text_preview } = buildExcelPreview(absPath);

    const { rows } = await pool.query(
      `INSERT INTO dcf_files (filename, stored_name, path, mime, bytes, sheet_names, text_preview)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, filename, sheet_names, uploaded_at`,
      [
        file.originalname,
        file.filename,
        absPath,
        file.mimetype || null,
        file.size || null,
        sheetNames.length ? sheetNames : null,
        text_preview,
      ]
    );

    res.json({ ok: true, file: rows[0] });
  } catch (e) {
    console.error("[dcf] uploadExcel error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Liste des fichiers Excel DCF
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

// Upload pièces jointes (images SAP, PDF, etc.)
app.post(
  "/api/dcf/attachments/upload",
  uploadAttach.array("files", 10),
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ ok: false, error: "Aucun fichier reçu" });
      }
      const sessionId = req.body?.session_id || null;
      const items = [];

      for (const f of files) {
        const { rows } = await pool.query(
          `INSERT INTO dcf_attachments (session_id, filename, stored_name, path, mime, bytes)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, filename, uploaded_at`,
          [
            sessionId || null,
            f.originalname,
            f.filename,
            f.path,
            f.mimetype || null,
            f.size || null,
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

// Crée une session de discussion (optionnel, la route /chat la crée si absent)
app.post("/api/dcf/startSession", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const title = req.body?.title || "Session DCF";
    const { rows } = await pool.query(
      `INSERT INTO dcf_sessions (user_email, title)
       VALUES ($1,$2)
       RETURNING id`,
      [email, title]
    );
    res.json({ ok: true, sessionId: rows[0].id });
  } catch (e) {
    console.error("[dcf] startSession error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Récupération d'une session + messages
app.get("/api/dcf/session/:id", async (req, res) => {
  try {
    const { rows: srows } = await pool.query(
      `SELECT id, user_email, title, created_at
       FROM dcf_sessions WHERE id = $1`,
      [req.params.id]
    );
    if (!srows[0]) return res.status(404).json({ ok: false, error: "Session inconnue" });

    const { rows: msgs } = await pool.query(
      `SELECT role, content, created_at
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

// Chat IA principal
app.post("/api/dcf/chat", async (req, res) => {
  try {
    const { message, sessionId: rawSessionId, fileId, attachmentIds = [] } =
      req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message requis" });
    }

    const email = getUserEmail(req);
    let sessionId = rawSessionId || null;

    // Crée la session si besoin
    if (!sessionId) {
      const { rows } = await pool.query(
        `INSERT INTO dcf_sessions (user_email, title)
         VALUES ($1,$2)
         RETURNING id`,
        [email, "Session DCF"]
      );
      sessionId = rows[0].id;
    }

    // Historique (limite à 20 messages pour rester léger)
    const { rows: history } = await pool.query(
      `SELECT role, content
       FROM dcf_messages
       WHERE session_id = $1
       ORDER BY id ASC
       LIMIT 20`,
      [sessionId]
    );

    // Contexte fichier DCF
    let fileCtx = null;
    if (fileId) {
      const { rows } = await pool.query(
        `SELECT id, filename, sheet_names, text_preview
         FROM dcf_files WHERE id = $1`,
        [fileId]
      );
      fileCtx = rows[0] || null;
    }

    // Pièces jointes -> images pour OpenAI (si JPG/PNG)
    const imgParts = [];
    if (Array.isArray(attachmentIds) && attachmentIds.length) {
      const ids = attachmentIds.map((x) => Number(x)).filter((x) => Number.isInteger(x));
      if (ids.length) {
        const { rows } = await pool.query(
          `SELECT id, filename, path, mime
           FROM dcf_attachments
           WHERE id = ANY($1::int[])`,
          [ids]
        );
        for (const a of rows) {
          const mime = a.mime || "application/octet-stream";
          if (!/^image\//i.test(mime)) continue; // pour l'instant on envoie que des images
          try {
            const buf = await fsp.readFile(a.path);
            const b64 = buf.toString("base64");
            imgParts.push({
              type: "input_image",
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

    // Texte utilisateur enrichi avec contexte fichier
    let userText = message.trim();
    if (fileCtx?.filename) {
      userText +=
        "\n\nContexte : utilise le modèle DCF présent dans le fichier Excel suivant " +
        `("${fileCtx.filename}"). Le texte ci-dessous est un extrait lisible par l'IA :\n` +
        (fileCtx.text_preview || "").slice(0, 12000);
    }

    const userContent = [{ type: "text", text: userText }, ...imgParts];

    const sysText =
      "Tu es un assistant SAP pour Daniel Palha. " +
      "Tu aides à préparer et remplir les DCF et les fichiers Excel associés " +
      "pour modifier des plans de maintenance SAP (maintenance plan, task list, equipment, etc.). " +
      "Réponds toujours en FRANÇAIS. " +
      "Donne des réponses très concrètes, sous forme de steps 1/2/3, " +
      "en séparant bien :\n" +
      "- ce qu'il faut faire dans SAP (transactions, champs à remplir)\n" +
      "- ce qu'il faut remplir dans les fichiers DCF Excel (onglets, colonnes, short text, long text, durées, nombre de personnes, etc.).";

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
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const answerText =
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
        ? raw.map((p) => (typeof p === "string" ? p : p.text || "")).join("\n")
        : String(raw || "");

    // Sauvegarde en base
    await pool.query(
      `INSERT INTO dcf_messages (session_id, role, content)
       VALUES ($1,'user',$2)`,
      [sessionId, message.trim()]
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
    });
  } catch (e) {
    console.error("[dcf] chat error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------------------------------------------------------
// BOOT
// -----------------------------------------------------------------------------
await ensureSchema();

app.listen(PORT, HOST, () => {
  console.log(`[dcf] service listening on ${HOST}:${PORT}`);
});
