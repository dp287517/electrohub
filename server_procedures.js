// ==============================
// server_procedures.js — Procedures microservice (ESM)
// Port: 3026
// VERSION 1.0 - AI-Guided Operational Procedures
// Features: Step-by-step procedures, photos, PPE, equipment links, PDF generation
// ==============================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import PDFDocument from "pdfkit";
import { createAuditTrail, AUDIT_ACTIONS } from "./lib/audit-trail.js";
import { extractTenantFromRequest, getTenantFilter } from "./lib/tenant-filter.js";

// OpenAI for AI-guided creation
import OpenAI from "openai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------
// App & Config
// ------------------------------
const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "object-src": ["'self'", "blob:"],
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'", "blob:"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "connect-src": ["'self'", "*"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-User-Email",
      "X-User-Name",
      "X-Site",
      "Authorization",
    ],
    exposedHeaders: [],
  })
);

app.use(express.json({ limit: "16mb" }));

const PORT = Number(process.env.PROCEDURES_PORT || 3026);
const HOST = process.env.PROCEDURES_HOST || "0.0.0.0";

// Storage layout
const DATA_ROOT = path.join(process.cwd(), "uploads", "procedures");
const FILES_DIR = path.join(DATA_ROOT, "files");
const PHOTOS_DIR = path.join(DATA_ROOT, "photos");
await fsp.mkdir(FILES_DIR, { recursive: true });
await fsp.mkdir(PHOTOS_DIR, { recursive: true });

// Multer for file uploads
const uploadPhoto = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per photo
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Seules les images sont acceptées"), false);
    }
  },
});

const uploadFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ------------------------------
// Database
// ------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
  max: 10,
});

// ------------------------------
// OpenAI
// ------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.AI_ASSISTANT_OPENAI_MODEL || "gpt-4o-mini";

// ------------------------------
// Schema
// ------------------------------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Main procedures table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS procedures (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'general',
      type TEXT DEFAULT 'procedure',
      status TEXT DEFAULT 'draft',
      version INTEGER DEFAULT 1,
      site TEXT,
      building TEXT,
      zone TEXT,

      -- Safety info
      ppe_required JSONB DEFAULT '[]'::jsonb,
      safety_codes JSONB DEFAULT '[]'::jsonb,
      risk_level TEXT DEFAULT 'low',

      -- Emergency contacts
      emergency_contacts JSONB DEFAULT '[]'::jsonb,

      -- Metadata
      created_by TEXT,
      updated_by TEXT,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Add missing columns if table existed
  const alterColumns = [
    "ALTER TABLE procedures ADD COLUMN IF NOT EXISTS ppe_required JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE procedures ADD COLUMN IF NOT EXISTS safety_codes JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE procedures ADD COLUMN IF NOT EXISTS emergency_contacts JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE procedures ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'low'",
    "ALTER TABLE procedures ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1",
    "ALTER TABLE procedures ADD COLUMN IF NOT EXISTS approved_by TEXT",
    "ALTER TABLE procedures ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ",
  ];
  for (const sql of alterColumns) {
    try { await pool.query(sql); } catch {}
  }

  // Procedure steps
  await pool.query(`
    CREATE TABLE IF NOT EXISTS procedure_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      procedure_id UUID REFERENCES procedures(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      warning TEXT,
      duration_minutes INTEGER,
      requires_validation BOOLEAN DEFAULT false,
      validation_criteria TEXT,
      photo_path TEXT,
      photo_content BYTEA,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Add index for ordering
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_procedure_steps_order ON procedure_steps(procedure_id, step_number);`);
  } catch {}

  // Equipment links - link procedures to any equipment type
  await pool.query(`
    CREATE TABLE IF NOT EXISTS procedure_equipment_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      procedure_id UUID REFERENCES procedures(id) ON DELETE CASCADE,
      equipment_type TEXT NOT NULL,
      equipment_id UUID NOT NULL,
      equipment_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(procedure_id, equipment_type, equipment_id)
    );
  `);

  // Procedure files (attachments, existing procedures to analyze)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS procedure_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      procedure_id UUID REFERENCES procedures(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT,
      mimetype TEXT,
      size_bytes INTEGER,
      content BYTEA,
      file_type TEXT DEFAULT 'attachment',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // AI conversation sessions for guided creation
  await pool.query(`
    CREATE TABLE IF NOT EXISTS procedure_ai_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      procedure_id UUID REFERENCES procedures(id) ON DELETE CASCADE,
      user_email TEXT,
      conversation JSONB DEFAULT '[]'::jsonb,
      current_step TEXT DEFAULT 'init',
      collected_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Action lists generated from reports
  await pool.query(`
    CREATE TABLE IF NOT EXISTS procedure_action_lists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      procedure_id UUID REFERENCES procedures(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      source_type TEXT,
      source_filename TEXT,
      actions JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'pending',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  console.log("[Procedures] Schema ensured");
}

// ------------------------------
// Audit Trail
// ------------------------------
let audit;
(async () => {
  audit = await createAuditTrail(pool, "procedures");
  await audit.ensureTable();
})();

// ------------------------------
// AI Guided Procedure Creation
// ------------------------------

const PROCEDURE_CREATION_PROMPT = `Tu es un assistant expert en création de procédures opérationnelles pour la maintenance industrielle et électrique.

Tu guides l'utilisateur étape par étape pour créer une procédure complète et professionnelle.

## Ton processus de création

1. **Comprendre le besoin** - Demande le titre et l'objectif de la procédure
2. **Identifier les risques** - Demande les EPI requis, les codes de sécurité, le niveau de risque
3. **Définir les étapes** - Pour chaque étape, demande:
   - Le titre de l'étape
   - Les instructions détaillées
   - Les avertissements/précautions
   - Si une photo est nécessaire
   - La durée estimée
4. **Contacts d'urgence** - Demande les contacts à inclure
5. **Équipements liés** - Demande quels équipements sont concernés
6. **Validation** - Résume et demande confirmation

## Format de réponse

Réponds TOUJOURS en JSON avec cette structure:
{
  "message": "Ton message à l'utilisateur",
  "currentStep": "init|risks|steps|contacts|equipment|review|complete",
  "question": "La question spécifique à poser",
  "options": ["option1", "option2"], // optionnel, pour choix multiples
  "expectsPhoto": false, // true si on attend une photo
  "collectedData": {}, // données collectées jusqu'ici
  "procedureReady": false // true quand la procédure est complète
}

## EPI courants
- Casque de sécurité
- Lunettes de protection
- Gants isolants
- Chaussures de sécurité
- Vêtements antistatiques
- Protection auditive
- Masque respiratoire
- Harnais de sécurité

## Niveaux de risque
- low: Risque faible, opération standard
- medium: Risque modéré, attention requise
- high: Risque élevé, supervision nécessaire
- critical: Risque critique, habilitation spéciale requise

Sois conversationnel, professionnel et guide l'utilisateur de manière fluide.`;

async function aiGuidedChat(sessionId, userMessage, uploadedPhoto = null) {
  // Get or create session
  let session;
  const { rows } = await pool.query(
    `SELECT * FROM procedure_ai_sessions WHERE id = $1`,
    [sessionId]
  );

  if (rows.length === 0) {
    // Create new session
    const { rows: newSession } = await pool.query(
      `INSERT INTO procedure_ai_sessions (id, conversation, current_step, collected_data)
       VALUES ($1, '[]'::jsonb, 'init', '{}'::jsonb)
       RETURNING *`,
      [sessionId]
    );
    session = newSession[0];
  } else {
    session = rows[0];
  }

  // Build conversation history
  const conversation = session.conversation || [];

  // Add user message
  const userEntry = { role: "user", content: userMessage };
  if (uploadedPhoto) {
    userEntry.photo = uploadedPhoto;
  }
  conversation.push(userEntry);

  // Build messages for OpenAI
  const messages = [
    { role: "system", content: PROCEDURE_CREATION_PROMPT },
    {
      role: "system",
      content: `État actuel de la session:
- Étape: ${session.current_step}
- Données collectées: ${JSON.stringify(session.collected_data, null, 2)}`
    },
    ...conversation.map(c => ({
      role: c.role,
      content: c.content + (c.photo ? `\n[Photo uploadée: ${c.photo}]` : "")
    }))
  ];

  // Call OpenAI
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 1500,
    response_format: { type: "json_object" }
  });

  const aiContent = response.choices[0]?.message?.content || "{}";
  let aiResponse;

  try {
    aiResponse = JSON.parse(aiContent);
  } catch {
    aiResponse = {
      message: aiContent,
      currentStep: session.current_step,
      question: "",
      procedureReady: false
    };
  }

  // Add AI response to conversation
  conversation.push({
    role: "assistant",
    content: aiResponse.message,
    data: aiResponse
  });

  // Update session
  const newCollectedData = {
    ...session.collected_data,
    ...(aiResponse.collectedData || {})
  };

  await pool.query(
    `UPDATE procedure_ai_sessions
     SET conversation = $1, current_step = $2, collected_data = $3, updated_at = now()
     WHERE id = $4`,
    [
      JSON.stringify(conversation),
      aiResponse.currentStep || session.current_step,
      JSON.stringify(newCollectedData),
      sessionId
    ]
  );

  return {
    message: aiResponse.message,
    currentStep: aiResponse.currentStep,
    question: aiResponse.question,
    options: aiResponse.options,
    expectsPhoto: aiResponse.expectsPhoto,
    procedureReady: aiResponse.procedureReady,
    collectedData: newCollectedData
  };
}

// Analyze existing procedure document
async function analyzeExistingProcedure(fileContent, filename, mimetype) {
  const prompt = `Analyse ce document de procédure et extrais les informations clés.

Document: ${filename}
Contenu: ${fileContent.substring(0, 10000)}

Retourne un JSON avec:
{
  "title": "Titre de la procédure",
  "description": "Description courte",
  "steps": [
    {
      "step_number": 1,
      "title": "Titre de l'étape",
      "instructions": "Instructions détaillées",
      "warning": "Avertissements éventuels"
    }
  ],
  "ppe_required": ["Liste des EPI"],
  "safety_codes": ["Codes de sécurité"],
  "risk_level": "low|medium|high|critical",
  "summary": "Résumé de la procédure"
}`;

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 2000,
    response_format: { type: "json_object" }
  });

  try {
    return JSON.parse(response.choices[0]?.message?.content || "{}");
  } catch {
    return { error: "Impossible d'analyser le document" };
  }
}

// Generate action list from report
async function generateActionListFromReport(reportContent, filename) {
  const prompt = `Analyse ce rapport et génère une liste d'actions correctives ou préventives.

Rapport: ${filename}
Contenu: ${reportContent.substring(0, 15000)}

Retourne un JSON avec:
{
  "title": "Titre de la liste d'actions",
  "actions": [
    {
      "priority": "high|medium|low",
      "action": "Description de l'action",
      "responsible": "Qui doit faire l'action (si mentionné)",
      "deadline": "Échéance (si mentionnée)",
      "equipment": "Équipement concerné (si mentionné)",
      "category": "maintenance|sécurité|conformité|amélioration"
    }
  ],
  "summary": "Résumé des actions nécessaires",
  "totalActions": 0
}`;

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 2500,
    response_format: { type: "json_object" }
  });

  try {
    return JSON.parse(response.choices[0]?.message?.content || "{}");
  } catch {
    return { error: "Impossible d'analyser le rapport" };
  }
}

// ------------------------------
// PDF Generation
// ------------------------------
async function generateProcedurePDF(procedureId) {
  // Get procedure with all related data
  const { rows: procedures } = await pool.query(
    `SELECT * FROM procedures WHERE id = $1`,
    [procedureId]
  );

  if (procedures.length === 0) {
    throw new Error("Procédure non trouvée");
  }

  const procedure = procedures[0];

  // Get steps
  const { rows: steps } = await pool.query(
    `SELECT * FROM procedure_steps WHERE procedure_id = $1 ORDER BY step_number`,
    [procedureId]
  );

  // Get equipment links
  const { rows: equipmentLinks } = await pool.query(
    `SELECT * FROM procedure_equipment_links WHERE procedure_id = $1`,
    [procedureId]
  );

  // Create PDF
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
    info: {
      Title: procedure.title,
      Author: "ElectroHub",
      Subject: "Procédure opérationnelle",
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  // Colors
  const colors = {
    primary: "#7c3aed",
    secondary: "#a78bfa",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    text: "#1f2937",
    lightBg: "#f3f4f6",
  };

  // Risk level colors
  const riskColors = {
    low: colors.success,
    medium: colors.warning,
    high: colors.danger,
    critical: "#7f1d1d",
  };

  // --- Cover Page ---
  doc.rect(0, 0, 595, 842).fill("#faf5ff");
  doc.rect(0, 0, 595, 200).fill(colors.primary);

  // Title
  doc.fontSize(28).fillColor("#fff").text("PROCÉDURE OPÉRATIONNELLE", 50, 70, {
    align: "center",
    width: 495,
  });

  doc.fontSize(18).text(procedure.title, 50, 120, {
    align: "center",
    width: 495,
  });

  // Version and date
  doc
    .fontSize(12)
    .text(`Version ${procedure.version || 1} - ${new Date().toLocaleDateString("fr-FR")}`, 50, 160, {
      align: "center",
      width: 495,
    });

  // Info box
  let yPos = 240;
  doc.rect(50, yPos, 495, 120).fillAndStroke("#fff", "#e5e7eb");

  yPos += 15;
  doc.fontSize(11).fillColor(colors.text);
  doc.text(`Catégorie: ${procedure.category || "Général"}`, 70, yPos);
  yPos += 20;
  doc.text(`Site: ${procedure.site || "Non spécifié"}`, 70, yPos);
  yPos += 20;
  doc.text(`Bâtiment: ${procedure.building || "Non spécifié"}`, 70, yPos);
  yPos += 20;

  // Risk level
  const riskLevel = procedure.risk_level || "low";
  const riskLabels = {
    low: "Faible",
    medium: "Modéré",
    high: "Élevé",
    critical: "Critique",
  };
  doc.text("Niveau de risque: ", 70, yPos);
  doc
    .fillColor(riskColors[riskLevel])
    .text(riskLabels[riskLevel], 170, yPos);

  // Description
  if (procedure.description) {
    yPos += 50;
    doc.fontSize(12).fillColor(colors.text).text("Description:", 50, yPos);
    yPos += 20;
    doc.fontSize(10).text(procedure.description, 50, yPos, { width: 495 });
  }

  // --- PPE Page ---
  doc.addPage();
  doc.fontSize(20).fillColor(colors.primary).text("ÉQUIPEMENTS DE PROTECTION", 50, 50);

  yPos = 90;
  const ppeList = procedure.ppe_required || [];
  if (ppeList.length > 0) {
    ppeList.forEach((ppe, i) => {
      doc.rect(50, yPos, 495, 30).fillAndStroke(i % 2 === 0 ? "#fff" : colors.lightBg, "#e5e7eb");
      doc.fontSize(11).fillColor(colors.text).text(`• ${ppe}`, 70, yPos + 10);
      yPos += 30;
    });
  } else {
    doc.fontSize(11).fillColor(colors.text).text("Aucun EPI spécifique requis", 50, yPos);
  }

  // Safety codes
  yPos += 30;
  doc.fontSize(16).fillColor(colors.primary).text("CODES DE SÉCURITÉ", 50, yPos);
  yPos += 30;

  const safetyCodes = procedure.safety_codes || [];
  if (safetyCodes.length > 0) {
    safetyCodes.forEach((code) => {
      doc.fontSize(11).fillColor(colors.text).text(`• ${code}`, 70, yPos);
      yPos += 20;
    });
  } else {
    doc.fontSize(11).fillColor(colors.text).text("Aucun code de sécurité spécifique", 50, yPos);
  }

  // Emergency contacts
  const contacts = procedure.emergency_contacts || [];
  if (contacts.length > 0) {
    yPos += 30;
    doc.fontSize(16).fillColor(colors.danger).text("CONTACTS D'URGENCE", 50, yPos);
    yPos += 30;

    contacts.forEach((contact) => {
      doc.rect(50, yPos, 495, 40).fillAndStroke("#fef2f2", colors.danger);
      doc.fontSize(11).fillColor(colors.text);
      doc.text(`${contact.name || "Contact"}`, 70, yPos + 8);
      doc.text(`Tél: ${contact.phone || "N/A"}`, 70, yPos + 22);
      if (contact.role) {
        doc.text(`Rôle: ${contact.role}`, 300, yPos + 8);
      }
      yPos += 45;
    });
  }

  // --- Steps Pages ---
  doc.addPage();
  doc.fontSize(20).fillColor(colors.primary).text("ÉTAPES DE LA PROCÉDURE", 50, 50);

  yPos = 90;
  for (const step of steps) {
    // Check if we need a new page
    if (yPos > 700) {
      doc.addPage();
      yPos = 50;
    }

    // Step header
    doc.rect(50, yPos, 495, 35).fill(colors.primary);
    doc
      .fontSize(14)
      .fillColor("#fff")
      .text(`Étape ${step.step_number}: ${step.title}`, 60, yPos + 10);
    yPos += 40;

    // Instructions
    if (step.instructions) {
      doc.fontSize(10).fillColor(colors.text).text(step.instructions, 50, yPos, { width: 495 });
      yPos += doc.heightOfString(step.instructions, { width: 495 }) + 10;
    }

    // Warning
    if (step.warning) {
      doc.rect(50, yPos, 495, 30).fillAndStroke("#fef3c7", colors.warning);
      doc.fontSize(10).fillColor(colors.warning).text(`⚠ ${step.warning}`, 60, yPos + 10, { width: 475 });
      yPos += 35;
    }

    // Duration
    if (step.duration_minutes) {
      doc.fontSize(9).fillColor("#6b7280").text(`Durée estimée: ${step.duration_minutes} minutes`, 50, yPos);
      yPos += 15;
    }

    // Photo
    if (step.photo_content) {
      try {
        const imgHeight = 150;
        if (yPos + imgHeight > 750) {
          doc.addPage();
          yPos = 50;
        }
        doc.image(step.photo_content, 50, yPos, { width: 200, height: imgHeight });
        yPos += imgHeight + 10;
      } catch (e) {
        console.error("Error adding image:", e);
      }
    } else if (step.photo_path) {
      try {
        const imgPath = path.join(PHOTOS_DIR, path.basename(step.photo_path));
        if (fs.existsSync(imgPath)) {
          const imgHeight = 150;
          if (yPos + imgHeight > 750) {
            doc.addPage();
            yPos = 50;
          }
          doc.image(imgPath, 50, yPos, { width: 200, height: imgHeight });
          yPos += imgHeight + 10;
        }
      } catch (e) {
        console.error("Error adding image from path:", e);
      }
    }

    yPos += 20;
  }

  // --- Equipment Links Page ---
  if (equipmentLinks.length > 0) {
    doc.addPage();
    doc.fontSize(20).fillColor(colors.primary).text("ÉQUIPEMENTS CONCERNÉS", 50, 50);

    yPos = 90;
    equipmentLinks.forEach((link, i) => {
      doc.rect(50, yPos, 495, 35).fillAndStroke(i % 2 === 0 ? "#fff" : colors.lightBg, "#e5e7eb");
      doc.fontSize(11).fillColor(colors.text);
      doc.text(`${link.equipment_name || link.equipment_id}`, 70, yPos + 10);
      doc.fontSize(9).fillColor("#6b7280").text(`Type: ${link.equipment_type}`, 350, yPos + 10);
      yPos += 35;
    });
  }

  // --- Footer on all pages ---
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor("#9ca3af")
      .text(
        `${procedure.title} - Page ${i + 1}/${pages.count} - Généré le ${new Date().toLocaleDateString("fr-FR")} par ElectroHub`,
        50,
        800,
        { align: "center", width: 495 }
      );
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

// ------------------------------
// API Routes
// ------------------------------

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "procedures", port: PORT });
});

// --- PROCEDURES CRUD ---

// List all procedures
app.get("/api/procedures", async (req, res) => {
  try {
    const site = extractTenantFromRequest(req);
    const { category, status, search } = req.query;

    let sql = `SELECT p.*,
               (SELECT COUNT(*) FROM procedure_steps WHERE procedure_id = p.id) as step_count,
               (SELECT COUNT(*) FROM procedure_equipment_links WHERE procedure_id = p.id) as equipment_count
               FROM procedures p WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (site && site !== "all") {
      sql += ` AND (p.site = $${paramIndex} OR p.site IS NULL)`;
      params.push(site);
      paramIndex++;
    }

    if (category) {
      sql += ` AND p.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (status) {
      sql += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (search) {
      sql += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    sql += ` ORDER BY p.updated_at DESC`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error listing procedures:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get single procedure with all details
app.get("/api/procedures/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: procedures } = await pool.query(
      `SELECT * FROM procedures WHERE id = $1`,
      [id]
    );

    if (procedures.length === 0) {
      return res.status(404).json({ error: "Procédure non trouvée" });
    }

    const procedure = procedures[0];

    // Get steps
    const { rows: steps } = await pool.query(
      `SELECT id, step_number, title, description, instructions, warning,
              duration_minutes, requires_validation, validation_criteria, photo_path,
              created_at, updated_at
       FROM procedure_steps WHERE procedure_id = $1 ORDER BY step_number`,
      [id]
    );

    // Get equipment links
    const { rows: equipmentLinks } = await pool.query(
      `SELECT * FROM procedure_equipment_links WHERE procedure_id = $1`,
      [id]
    );

    // Get files
    const { rows: files } = await pool.query(
      `SELECT id, filename, mimetype, size_bytes, file_type, created_at
       FROM procedure_files WHERE procedure_id = $1`,
      [id]
    );

    res.json({
      ...procedure,
      steps,
      equipment_links: equipmentLinks,
      files,
    });
  } catch (err) {
    console.error("Error getting procedure:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create procedure
app.post("/api/procedures", async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      type,
      site,
      building,
      zone,
      ppe_required,
      safety_codes,
      risk_level,
      emergency_contacts,
      steps,
      equipment_links,
    } = req.body;

    const userEmail = req.headers["x-user-email"] || "system";

    // Create procedure
    const { rows } = await pool.query(
      `INSERT INTO procedures
       (title, description, category, type, site, building, zone,
        ppe_required, safety_codes, risk_level, emergency_contacts, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        title,
        description,
        category || "general",
        type || "procedure",
        site,
        building,
        zone,
        JSON.stringify(ppe_required || []),
        JSON.stringify(safety_codes || []),
        risk_level || "low",
        JSON.stringify(emergency_contacts || []),
        userEmail,
      ]
    );

    const procedure = rows[0];

    // Add steps if provided
    if (steps && steps.length > 0) {
      for (const step of steps) {
        await pool.query(
          `INSERT INTO procedure_steps
           (procedure_id, step_number, title, description, instructions, warning,
            duration_minutes, requires_validation, validation_criteria)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            procedure.id,
            step.step_number,
            step.title,
            step.description,
            step.instructions,
            step.warning,
            step.duration_minutes,
            step.requires_validation || false,
            step.validation_criteria,
          ]
        );
      }
    }

    // Add equipment links if provided
    if (equipment_links && equipment_links.length > 0) {
      for (const link of equipment_links) {
        await pool.query(
          `INSERT INTO procedure_equipment_links
           (procedure_id, equipment_type, equipment_id, equipment_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (procedure_id, equipment_type, equipment_id) DO NOTHING`,
          [procedure.id, link.equipment_type, link.equipment_id, link.equipment_name]
        );
      }
    }

    if (audit) {
      await audit.log(req, AUDIT_ACTIONS.CREATE, { procedureId: procedure.id, title });
    }

    res.status(201).json(procedure);
  } catch (err) {
    console.error("Error creating procedure:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update procedure
app.put("/api/procedures/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      category,
      type,
      status,
      site,
      building,
      zone,
      ppe_required,
      safety_codes,
      risk_level,
      emergency_contacts,
    } = req.body;

    const userEmail = req.headers["x-user-email"] || "system";

    const { rows } = await pool.query(
      `UPDATE procedures SET
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       category = COALESCE($3, category),
       type = COALESCE($4, type),
       status = COALESCE($5, status),
       site = COALESCE($6, site),
       building = COALESCE($7, building),
       zone = COALESCE($8, zone),
       ppe_required = COALESCE($9, ppe_required),
       safety_codes = COALESCE($10, safety_codes),
       risk_level = COALESCE($11, risk_level),
       emergency_contacts = COALESCE($12, emergency_contacts),
       updated_by = $13,
       updated_at = now()
       WHERE id = $14
       RETURNING *`,
      [
        title,
        description,
        category,
        type,
        status,
        site,
        building,
        zone,
        ppe_required ? JSON.stringify(ppe_required) : null,
        safety_codes ? JSON.stringify(safety_codes) : null,
        risk_level,
        emergency_contacts ? JSON.stringify(emergency_contacts) : null,
        userEmail,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Procédure non trouvée" });
    }

    if (audit) {
      await audit.log(req, AUDIT_ACTIONS.UPDATE, { procedureId: id });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error updating procedure:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete procedure
app.delete("/api/procedures/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await pool.query(
      `DELETE FROM procedures WHERE id = $1`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: "Procédure non trouvée" });
    }

    if (audit) {
      await audit.log(req, AUDIT_ACTIONS.DELETE, { procedureId: id });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting procedure:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- STEPS ---

// Add step
app.post("/api/procedures/:id/steps", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, instructions, warning, duration_minutes, requires_validation, validation_criteria } = req.body;

    // Get next step number
    const { rows: maxStep } = await pool.query(
      `SELECT COALESCE(MAX(step_number), 0) + 1 as next_step FROM procedure_steps WHERE procedure_id = $1`,
      [id]
    );

    const { rows } = await pool.query(
      `INSERT INTO procedure_steps
       (procedure_id, step_number, title, description, instructions, warning,
        duration_minutes, requires_validation, validation_criteria)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        maxStep[0].next_step,
        title,
        description,
        instructions,
        warning,
        duration_minutes,
        requires_validation || false,
        validation_criteria,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error adding step:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update step
app.put("/api/procedures/:procedureId/steps/:stepId", async (req, res) => {
  try {
    const { stepId } = req.params;
    const { title, description, instructions, warning, duration_minutes, step_number, requires_validation, validation_criteria } = req.body;

    const { rows } = await pool.query(
      `UPDATE procedure_steps SET
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       instructions = COALESCE($3, instructions),
       warning = COALESCE($4, warning),
       duration_minutes = COALESCE($5, duration_minutes),
       step_number = COALESCE($6, step_number),
       requires_validation = COALESCE($7, requires_validation),
       validation_criteria = COALESCE($8, validation_criteria),
       updated_at = now()
       WHERE id = $9
       RETURNING *`,
      [title, description, instructions, warning, duration_minutes, step_number, requires_validation, validation_criteria, stepId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Étape non trouvée" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error updating step:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete step
app.delete("/api/procedures/:procedureId/steps/:stepId", async (req, res) => {
  try {
    const { procedureId, stepId } = req.params;

    // Get step number before deleting
    const { rows: step } = await pool.query(
      `SELECT step_number FROM procedure_steps WHERE id = $1`,
      [stepId]
    );

    if (step.length === 0) {
      return res.status(404).json({ error: "Étape non trouvée" });
    }

    await pool.query(`DELETE FROM procedure_steps WHERE id = $1`, [stepId]);

    // Reorder remaining steps
    await pool.query(
      `UPDATE procedure_steps SET step_number = step_number - 1
       WHERE procedure_id = $1 AND step_number > $2`,
      [procedureId, step[0].step_number]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting step:", err);
    res.status(500).json({ error: err.message });
  }
});

// Upload step photo
app.post("/api/procedures/:procedureId/steps/:stepId/photo", uploadPhoto.single("photo"), async (req, res) => {
  try {
    const { stepId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: "Aucune photo fournie" });
    }

    // Read file to buffer
    const photoBuffer = await fsp.readFile(req.file.path);

    // Update step
    const { rows } = await pool.query(
      `UPDATE procedure_steps SET photo_path = $1, photo_content = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [req.file.filename, photoBuffer, stepId]
    );

    // Clean up temp file (content is in DB)
    await fsp.unlink(req.file.path).catch(() => {});

    if (rows.length === 0) {
      return res.status(404).json({ error: "Étape non trouvée" });
    }

    res.json({ success: true, photo_path: req.file.filename });
  } catch (err) {
    console.error("Error uploading step photo:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get step photo
app.get("/api/procedures/steps/:stepId/photo", async (req, res) => {
  try {
    const { stepId } = req.params;

    const { rows } = await pool.query(
      `SELECT photo_content, photo_path FROM procedure_steps WHERE id = $1`,
      [stepId]
    );

    if (rows.length === 0 || (!rows[0].photo_content && !rows[0].photo_path)) {
      return res.status(404).json({ error: "Photo non trouvée" });
    }

    if (rows[0].photo_content) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.end(rows[0].photo_content, "binary");
    }

    // Fallback to file
    const filePath = path.join(PHOTOS_DIR, rows[0].photo_path);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    res.status(404).json({ error: "Photo non trouvée" });
  } catch (err) {
    console.error("Error getting step photo:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- EQUIPMENT LINKS ---

// Add equipment link
app.post("/api/procedures/:id/equipment", async (req, res) => {
  try {
    const { id } = req.params;
    const { equipment_type, equipment_id, equipment_name } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO procedure_equipment_links (procedure_id, equipment_type, equipment_id, equipment_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (procedure_id, equipment_type, equipment_id) DO UPDATE SET equipment_name = $4
       RETURNING *`,
      [id, equipment_type, equipment_id, equipment_name]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error adding equipment link:", err);
    res.status(500).json({ error: err.message });
  }
});

// Remove equipment link
app.delete("/api/procedures/:id/equipment/:linkId", async (req, res) => {
  try {
    const { linkId } = req.params;

    await pool.query(`DELETE FROM procedure_equipment_links WHERE id = $1`, [linkId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Error removing equipment link:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- AI GUIDED CREATION ---

// Start AI-guided session
app.post("/api/procedures/ai/start", async (req, res) => {
  try {
    const userEmail = req.headers["x-user-email"] || "anonymous";
    const { initialMessage } = req.body;

    // Create session
    const { rows } = await pool.query(
      `INSERT INTO procedure_ai_sessions (user_email, conversation, current_step, collected_data)
       VALUES ($1, '[]'::jsonb, 'init', '{}'::jsonb)
       RETURNING id`,
      [userEmail]
    );

    const sessionId = rows[0].id;

    // Start conversation
    const response = await aiGuidedChat(
      sessionId,
      initialMessage || "Je veux créer une nouvelle procédure"
    );

    res.json({
      sessionId,
      ...response,
    });
  } catch (err) {
    console.error("Error starting AI session:", err);
    res.status(500).json({ error: err.message });
  }
});

// Continue AI-guided conversation
app.post("/api/procedures/ai/chat/:sessionId", uploadPhoto.single("photo"), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    let photoPath = null;
    if (req.file) {
      photoPath = req.file.filename;
    }

    const response = await aiGuidedChat(sessionId, message, photoPath);

    res.json(response);
  } catch (err) {
    console.error("Error in AI chat:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create procedure from AI session
app.post("/api/procedures/ai/finalize/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userEmail = req.headers["x-user-email"] || "system";

    // Get session data
    const { rows: sessions } = await pool.query(
      `SELECT * FROM procedure_ai_sessions WHERE id = $1`,
      [sessionId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ error: "Session non trouvée" });
    }

    const session = sessions[0];
    const data = session.collected_data || {};

    // Create procedure from collected data
    const { rows } = await pool.query(
      `INSERT INTO procedures
       (title, description, category, site, building, zone,
        ppe_required, safety_codes, risk_level, emergency_contacts, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.title || "Nouvelle procédure",
        data.description || "",
        data.category || "general",
        data.site,
        data.building,
        data.zone,
        JSON.stringify(data.ppe_required || []),
        JSON.stringify(data.safety_codes || []),
        data.risk_level || "low",
        JSON.stringify(data.emergency_contacts || []),
        userEmail,
      ]
    );

    const procedure = rows[0];

    // Add steps
    if (data.steps && data.steps.length > 0) {
      for (let i = 0; i < data.steps.length; i++) {
        const step = data.steps[i];
        await pool.query(
          `INSERT INTO procedure_steps
           (procedure_id, step_number, title, description, instructions, warning, duration_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            procedure.id,
            i + 1,
            step.title,
            step.description,
            step.instructions,
            step.warning,
            step.duration_minutes,
          ]
        );
      }
    }

    // Link to AI session
    await pool.query(
      `UPDATE procedure_ai_sessions SET procedure_id = $1 WHERE id = $2`,
      [procedure.id, sessionId]
    );

    res.status(201).json(procedure);
  } catch (err) {
    console.error("Error finalizing procedure:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- ANALYZE EXISTING DOCUMENTS ---

// Analyze existing procedure document
app.post("/api/procedures/ai/analyze-document", uploadFile.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun document fourni" });
    }

    // Read file content
    const content = await fsp.readFile(req.file.path, "utf-8");

    const analysis = await analyzeExistingProcedure(content, req.file.originalname, req.file.mimetype);

    // Clean up temp file
    await fsp.unlink(req.file.path).catch(() => {});

    res.json(analysis);
  } catch (err) {
    console.error("Error analyzing document:", err);
    res.status(500).json({ error: err.message });
  }
});

// Generate action list from report
app.post("/api/procedures/ai/analyze-report", uploadFile.single("report"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun rapport fourni" });
    }

    const userEmail = req.headers["x-user-email"] || "system";

    // Read file content
    const content = await fsp.readFile(req.file.path, "utf-8");

    const analysis = await generateActionListFromReport(content, req.file.originalname);

    // Save action list
    if (analysis.actions && analysis.actions.length > 0) {
      const { rows } = await pool.query(
        `INSERT INTO procedure_action_lists
         (title, source_type, source_filename, actions, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          analysis.title || `Actions depuis ${req.file.originalname}`,
          "report",
          req.file.originalname,
          JSON.stringify(analysis.actions),
          userEmail,
        ]
      );
      analysis.actionListId = rows[0].id;
    }

    // Clean up temp file
    await fsp.unlink(req.file.path).catch(() => {});

    res.json(analysis);
  } catch (err) {
    console.error("Error analyzing report:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get action lists
app.get("/api/procedures/action-lists", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM procedure_action_lists ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error getting action lists:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- PDF GENERATION ---

// Generate PDF for procedure
app.get("/api/procedures/:id/pdf", async (req, res) => {
  try {
    const { id } = req.params;

    const pdfBuffer = await generateProcedurePDF(id);

    // Get procedure title for filename
    const { rows } = await pool.query(`SELECT title FROM procedures WHERE id = $1`, [id]);
    const title = rows[0]?.title || "procedure";
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="procedure_${safeTitle}_${new Date().toISOString().split("T")[0]}.pdf"`
    );

    res.end(pdfBuffer);
  } catch (err) {
    console.error("Error generating PDF:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- CATEGORIES ---

// Get procedure categories
app.get("/api/procedures/categories", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, COUNT(*) as count FROM procedures GROUP BY category ORDER BY category`
    );

    const defaultCategories = [
      { id: "general", name: "Général", icon: "file-text" },
      { id: "maintenance", name: "Maintenance", icon: "wrench" },
      { id: "securite", name: "Sécurité", icon: "shield" },
      { id: "mise_en_service", name: "Mise en service", icon: "play" },
      { id: "mise_hors_service", name: "Mise hors service", icon: "power-off" },
      { id: "urgence", name: "Urgence", icon: "alert-triangle" },
      { id: "controle", name: "Contrôle", icon: "check-circle" },
      { id: "formation", name: "Formation", icon: "book" },
    ];

    // Merge with counts
    const result = defaultCategories.map((cat) => ({
      ...cat,
      count: rows.find((r) => r.category === cat.id)?.count || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error("Error getting categories:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- SEARCH EQUIPMENT FOR LINKING ---

// Search all equipment types
app.get("/api/procedures/search-equipment", async (req, res) => {
  try {
    const { q, type } = req.query;
    const searchTerm = `%${q || ""}%`;
    const results = [];

    // Search based on type or all
    const types = type ? [type] : ["switchboard", "vsd", "meca", "atex"];

    for (const t of types) {
      try {
        let sql, params;

        switch (t) {
          case "switchboard":
            sql = `SELECT id::text, name, code, 'switchboard' as type FROM switchboards WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "vsd":
            sql = `SELECT id::text, name, manufacturer_ref as code, 'vsd' as type FROM vsd_equipments WHERE name ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "meca":
            sql = `SELECT id::text, name, tag as code, 'meca' as type FROM meca_equipments WHERE name ILIKE $1 OR tag ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "atex":
            sql = `SELECT id::text, name, manufacturer as code, 'atex' as type FROM atex_equipments WHERE name ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          default:
            continue;
        }

        const { rows } = await pool.query(sql, params);
        results.push(...rows.map((r) => ({ ...r, equipment_type: t })));
      } catch (e) {
        // Table might not exist, skip
        console.log(`Equipment table ${t} not found:`, e.message);
      }
    }

    res.json(results);
  } catch (err) {
    console.error("Error searching equipment:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// Start Server
// ------------------------------
async function startServer() {
  try {
    await ensureSchema();
    app.listen(PORT, HOST, () => {
      console.log(`[Procedures] Server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error("[Procedures] Failed to start:", err);
    process.exit(1);
  }
}

startServer();
