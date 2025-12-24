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
// PDF Generation - Professional Template with Logo
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

  // Get steps with photos
  const { rows: steps } = await pool.query(
    `SELECT * FROM procedure_steps WHERE procedure_id = $1 ORDER BY step_number`,
    [procedureId]
  );

  // Get equipment links
  const { rows: equipmentLinks } = await pool.query(
    `SELECT * FROM procedure_equipment_links WHERE procedure_id = $1`,
    [procedureId]
  );

  // Get site settings (logo, company name) from Switchboard settings
  let siteSettings = {};
  try {
    const { rows: settings } = await pool.query(
      `SELECT logo, logo_mime, company_name FROM site_settings WHERE site = $1`,
      [procedure.site || 'default']
    );
    if (settings.length > 0) {
      siteSettings = settings[0];
    }
  } catch (e) {
    console.log("[Procedures] Could not fetch site settings:", e.message);
  }

  // Create PDF
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
    info: {
      Title: procedure.title,
      Author: siteSettings.company_name || "ElectroHub",
      Subject: "Procédure opérationnelle",
      Creator: "ElectroHub Procedures System",
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  // Colors - Professional scheme
  const colors = {
    primary: "#7c3aed",
    secondary: "#a78bfa",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    text: "#1f2937",
    lightBg: "#f3f4f6",
    darkBg: "#111827",
  };

  // Risk level colors and labels
  const riskConfig = {
    low: { color: colors.success, label: "FAIBLE", icon: "✓" },
    medium: { color: colors.warning, label: "MODÉRÉ", icon: "⚠" },
    high: { color: colors.danger, label: "ÉLEVÉ", icon: "⚠" },
    critical: { color: "#7f1d1d", label: "CRITIQUE", icon: "⛔" },
  };

  const riskInfo = riskConfig[procedure.risk_level] || riskConfig.low;

  // === COVER PAGE ===
  doc.rect(0, 0, 595, 842).fill("#faf5ff");

  // Header band with gradient effect
  doc.rect(0, 0, 595, 220).fill(colors.primary);
  doc.rect(0, 200, 595, 20).fill(colors.secondary);

  // Logo if available
  let logoWidth = 0;
  if (siteSettings.logo) {
    try {
      doc.image(siteSettings.logo, 40, 25, { width: 80, height: 60 });
      logoWidth = 90;
    } catch (e) {
      console.log("[Procedures] Could not add logo to PDF:", e.message);
    }
  }

  // Company name
  if (siteSettings.company_name) {
    doc.fontSize(14).fillColor("#fff").text(siteSettings.company_name, 40 + logoWidth, 40, { width: 200 });
  }

  // Document type badge
  doc.roundedRect(400, 30, 150, 30, 5).fill("#fff");
  doc.fontSize(10).fillColor(colors.primary).text("PROCÉDURE OPÉRATIONNELLE", 410, 40, { width: 130, align: "center" });

  // Main title
  doc.fontSize(32).fillColor("#fff").text("PROCÉDURE", 50, 90, { align: "center", width: 495 });
  doc.fontSize(22).text(procedure.title.toUpperCase(), 50, 135, { align: "center", width: 495 });

  // Version badge
  doc.roundedRect(230, 175, 135, 25, 3).fill("rgba(255,255,255,0.2)");
  doc.fontSize(10).fillColor("#fff").text(`Version ${procedure.version || 1} • ${new Date().toLocaleDateString("fr-FR")}`, 235, 182, { width: 125, align: "center" });

  // Risk level banner
  doc.rect(0, 230, 595, 50).fill(riskInfo.color);
  doc.fontSize(16).fillColor("#fff").text(`${riskInfo.icon} NIVEAU DE RISQUE: ${riskInfo.label}`, 50, 245, { align: "center", width: 495 });

  // Info card
  let yPos = 310;
  doc.roundedRect(50, yPos, 495, 140, 10).fillAndStroke("#fff", "#e5e7eb");

  yPos += 20;
  doc.fontSize(14).fillColor(colors.primary).text("INFORMATIONS GÉNÉRALES", 70, yPos);

  yPos += 30;
  doc.fontSize(11).fillColor(colors.text);

  const infoGrid = [
    ["Catégorie", procedure.category || "Général"],
    ["Site", procedure.site || "Non spécifié"],
    ["Bâtiment", procedure.building || "Non spécifié"],
    ["Zone", procedure.zone || "Non spécifié"],
  ];

  infoGrid.forEach(([label, value], i) => {
    const x = i % 2 === 0 ? 70 : 300;
    const y = yPos + Math.floor(i / 2) * 25;
    doc.font("Helvetica-Bold").text(`${label}:`, x, y, { continued: true });
    doc.font("Helvetica").text(` ${value}`);
  });

  // Description box
  if (procedure.description) {
    yPos = 480;
    doc.roundedRect(50, yPos, 495, 80, 10).fillAndStroke("#f8fafc", "#e5e7eb");
    doc.fontSize(10).fillColor(colors.primary).text("DESCRIPTION", 70, yPos + 15);
    doc.fontSize(10).fillColor(colors.text).text(procedure.description, 70, yPos + 35, { width: 455 });
  }

  // Stats at bottom of cover
  yPos = 600;
  const stats = [
    { label: "Étapes", value: steps.length, color: colors.primary },
    { label: "Équipements liés", value: equipmentLinks.length, color: colors.secondary },
    { label: "EPI requis", value: (procedure.ppe_required || []).length, color: colors.warning },
  ];

  const statWidth = 150;
  stats.forEach((stat, i) => {
    const x = 50 + i * (statWidth + 22);
    doc.roundedRect(x, yPos, statWidth, 70, 8).fillAndStroke(stat.color, stat.color);
    doc.fontSize(28).fillColor("#fff").text(String(stat.value), x, yPos + 12, { width: statWidth, align: "center" });
    doc.fontSize(10).text(stat.label, x, yPos + 48, { width: statWidth, align: "center" });
  });

  // Created by
  doc.fontSize(9).fillColor("#9ca3af").text(`Créé par: ${procedure.created_by || "Système"} • Dernière modification: ${new Date(procedure.updated_at).toLocaleString("fr-FR")}`, 50, 750, { align: "center", width: 495 });

  // === PAGE 2: SAFETY ===
  doc.addPage();

  // Header
  doc.rect(0, 0, 595, 60).fill(colors.danger);
  doc.fontSize(20).fillColor("#fff").text("⚠ SÉCURITÉ & EPI", 50, 22, { width: 495 });

  yPos = 90;

  // EPI Section
  doc.fontSize(14).fillColor(colors.text).text("ÉQUIPEMENTS DE PROTECTION INDIVIDUELLE", 50, yPos);
  yPos += 30;

  const ppeList = procedure.ppe_required || [];
  if (ppeList.length > 0) {
    const ppeIcons = {
      "Casque de sécurité": "🪖",
      "Lunettes de protection": "🥽",
      "Gants isolants": "🧤",
      "Chaussures de sécurité": "👞",
      "Protection auditive": "🎧",
      "Masque respiratoire": "😷",
      "Harnais de sécurité": "🦺",
      "Vêtements antistatiques": "👔",
    };

    const ppePerRow = 2;
    ppeList.forEach((ppe, i) => {
      const col = i % ppePerRow;
      const row = Math.floor(i / ppePerRow);
      const x = 50 + col * 260;
      const y = yPos + row * 45;

      doc.roundedRect(x, y, 245, 40, 5).fillAndStroke("#fef3c7", colors.warning);
      doc.fontSize(11).fillColor(colors.text).text(`${ppeIcons[ppe] || "•"} ${ppe}`, x + 15, y + 14, { width: 220 });
    });

    yPos += Math.ceil(ppeList.length / ppePerRow) * 45 + 20;
  } else {
    doc.fontSize(11).fillColor("#6b7280").text("Aucun EPI spécifique requis pour cette procédure.", 50, yPos);
    yPos += 30;
  }

  // Safety Codes
  yPos += 20;
  doc.fontSize(14).fillColor(colors.text).text("CODES & CONSIGNES DE SÉCURITÉ", 50, yPos);
  yPos += 30;

  const safetyCodes = procedure.safety_codes || [];
  if (safetyCodes.length > 0) {
    safetyCodes.forEach((code, i) => {
      doc.roundedRect(50, yPos, 495, 30, 5).fillAndStroke("#dbeafe", colors.primary);
      doc.fontSize(10).fillColor(colors.text).text(`📋 ${code}`, 65, yPos + 10, { width: 465 });
      yPos += 35;
    });
  } else {
    doc.fontSize(11).fillColor("#6b7280").text("Aucun code de sécurité spécifique.", 50, yPos);
    yPos += 30;
  }

  // Emergency Contacts
  const contacts = procedure.emergency_contacts || [];
  if (contacts.length > 0) {
    yPos += 30;
    doc.rect(50, yPos, 495, 40 + contacts.length * 35).fillAndStroke("#fef2f2", colors.danger);
    doc.fontSize(14).fillColor(colors.danger).text("📞 CONTACTS D'URGENCE", 70, yPos + 15);
    yPos += 45;

    contacts.forEach((contact, i) => {
      doc.fontSize(11).fillColor(colors.text);
      doc.font("Helvetica-Bold").text(contact.name || "Contact", 70, yPos);
      if (contact.role) doc.font("Helvetica").text(` (${contact.role})`, { continued: false });
      doc.font("Helvetica-Bold").fillColor(colors.danger).text(contact.phone || "N/A", 400, yPos);
      yPos += 25;
    });
  }

  // === STEPS PAGES ===
  doc.addPage();
  doc.rect(0, 0, 595, 60).fill(colors.primary);
  doc.fontSize(20).fillColor("#fff").text("📋 ÉTAPES DE LA PROCÉDURE", 50, 22, { width: 495 });

  yPos = 90;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Check if we need a new page
    const stepHeight = 120 + (step.photo_content ? 180 : 0);
    if (yPos + stepHeight > 750) {
      doc.addPage();
      yPos = 50;
    }

    // Step card
    doc.roundedRect(50, yPos, 495, stepHeight - 10, 10).fillAndStroke("#fff", "#e5e7eb");

    // Step number circle
    doc.circle(80, yPos + 25, 18).fill(colors.primary);
    doc.fontSize(14).fillColor("#fff").text(String(step.step_number), 71, yPos + 18);

    // Step title
    doc.fontSize(14).fillColor(colors.text).font("Helvetica-Bold").text(step.title, 110, yPos + 18, { width: 420 });

    // Duration if available
    if (step.duration_minutes) {
      doc.fontSize(9).fillColor("#6b7280").font("Helvetica").text(`⏱ ${step.duration_minutes} min`, 450, yPos + 20);
    }

    let contentY = yPos + 45;

    // Instructions
    if (step.instructions) {
      doc.fontSize(10).fillColor(colors.text).font("Helvetica").text(step.instructions, 70, contentY, { width: 455 });
      contentY += doc.heightOfString(step.instructions, { width: 455 }) + 10;
    }

    // Warning
    if (step.warning) {
      doc.roundedRect(70, contentY, 455, 30, 5).fillAndStroke("#fef3c7", colors.warning);
      doc.fontSize(9).fillColor(colors.warning).text(`⚠ ${step.warning}`, 85, contentY + 10, { width: 425 });
      contentY += 40;
    }

    // Photo
    if (step.photo_content) {
      try {
        doc.image(step.photo_content, 70, contentY, { width: 200, height: 150 });
        doc.fontSize(8).fillColor("#9ca3af").text(`Photo étape ${step.step_number}`, 70, contentY + 155);
        contentY += 170;
      } catch (e) {
        console.log(`[Procedures] Could not add step ${step.step_number} photo:`, e.message);
      }
    } else if (step.photo_path) {
      try {
        const imgPath = path.join(PHOTOS_DIR, path.basename(step.photo_path));
        if (fs.existsSync(imgPath)) {
          doc.image(imgPath, 70, contentY, { width: 200, height: 150 });
          doc.fontSize(8).fillColor("#9ca3af").text(`Photo étape ${step.step_number}`, 70, contentY + 155);
          contentY += 170;
        }
      } catch (e) {
        console.log(`[Procedures] Could not add step ${step.step_number} photo from path:`, e.message);
      }
    }

    yPos += stepHeight;
  }

  // === EQUIPMENT LINKS PAGE ===
  if (equipmentLinks.length > 0) {
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill(colors.secondary);
    doc.fontSize(20).fillColor("#fff").text("🔗 ÉQUIPEMENTS CONCERNÉS", 50, 22, { width: 495 });

    yPos = 90;

    const typeLabels = {
      switchboard: "Armoire électrique",
      vsd: "Variateur de vitesse",
      meca: "Équipement mécanique",
      atex: "Équipement ATEX",
      hv: "Haute Tension",
      glo: "UPS/Batteries",
      mobile: "Équipement mobile",
      doors: "Porte coupe-feu",
      datahub: "DataHub",
      projects: "Projet",
      oibt: "OIBT",
    };

    equipmentLinks.forEach((link, i) => {
      doc.roundedRect(50, yPos, 495, 45, 8).fillAndStroke(i % 2 === 0 ? "#f8fafc" : "#fff", "#e5e7eb");

      doc.roundedRect(70, yPos + 12, 100, 22, 3).fill(colors.primary);
      doc.fontSize(9).fillColor("#fff").text(typeLabels[link.equipment_type] || link.equipment_type, 75, yPos + 17, { width: 90, align: "center" });

      doc.fontSize(12).fillColor(colors.text).text(link.equipment_name || link.equipment_id, 185, yPos + 15, { width: 340 });

      yPos += 50;
    });
  }

  // === FOOTER on all pages ===
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);

    // Footer line
    doc.rect(50, 810, 495, 1).fill("#e5e7eb");

    // Footer text
    doc.fontSize(8).fillColor("#9ca3af").text(
      `${procedure.title} • Page ${i + 1}/${pages.count} • Généré le ${new Date().toLocaleString("fr-FR")} • ElectroHub`,
      50, 818, { align: "center", width: 495 }
    );

    // Logo watermark on each page (small)
    if (siteSettings.logo && i > 0) {
      try {
        doc.image(siteSettings.logo, 510, 10, { width: 40, height: 30 });
      } catch (e) {}
    }
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

// Helper to get equipment details for linked equipment
async function getLinkedEquipmentDetails(links) {
  const details = [];

  for (const link of links) {
    try {
      let sql;
      switch (link.equipment_type) {
        case "switchboard":
          sql = `SELECT name, code, building_code as building FROM switchboards WHERE id = $1`;
          break;
        case "vsd":
          sql = `SELECT name, manufacturer_ref as code, building FROM vsd_equipments WHERE id = $1`;
          break;
        case "meca":
          sql = `SELECT name, tag as code, building FROM meca_equipments WHERE id = $1`;
          break;
        default:
          continue;
      }

      const { rows } = await pool.query(sql, [link.equipment_id]);
      if (rows.length > 0) {
        details.push({ ...link, ...rows[0] });
      }
    } catch (e) {
      details.push(link);
    }
  }

  return details;
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

// Search ALL equipment types across the entire system
app.get("/api/procedures/search-equipment", async (req, res) => {
  try {
    const { q, type } = req.query;
    const searchTerm = `%${q || ""}%`;
    const results = [];

    // ALL equipment types in the system
    const allTypes = [
      "switchboard", "vsd", "meca", "atex", "hv", "glo",
      "mobile", "doors", "datahub", "projects", "oibt"
    ];
    const types = type ? [type] : allTypes;

    for (const t of types) {
      try {
        let sql, params;

        switch (t) {
          case "switchboard":
            sql = `SELECT id::text, name, code, building_code as building, 'switchboard' as type, 'Armoire électrique' as type_label FROM switchboards WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "vsd":
            sql = `SELECT id::text, name, manufacturer_ref as code, building, 'vsd' as type, 'Variateur de vitesse' as type_label FROM vsd_equipments WHERE name ILIKE $1 OR manufacturer_ref ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "meca":
            sql = `SELECT id::text, name, tag as code, building, 'meca' as type, 'Équipement mécanique' as type_label FROM meca_equipments WHERE name ILIKE $1 OR tag ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "atex":
            sql = `SELECT id::text, name, manufacturer as code, building, 'atex' as type, 'Équipement ATEX' as type_label FROM atex_equipments WHERE name ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "hv":
            sql = `SELECT id::text, name, tag as code, building, 'hv' as type, 'Haute Tension' as type_label FROM hv_equipments WHERE name ILIKE $1 OR tag ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "glo":
            sql = `SELECT id::text, name, tag as code, building, 'glo' as type, 'UPS/Batteries/Éclairage' as type_label FROM glo_equipments WHERE name ILIKE $1 OR tag ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "mobile":
            sql = `SELECT id::text, name, serial_number as code, location as building, 'mobile' as type, 'Équipement mobile' as type_label FROM me_equipments WHERE name ILIKE $1 OR serial_number ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "doors":
            sql = `SELECT id::text, name, code, building, 'doors' as type, 'Porte coupe-feu' as type_label FROM doors WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "datahub":
            sql = `SELECT i.id::text, i.name, i.code, i.building, 'datahub' as type, COALESCE(c.name, 'DataHub') as type_label FROM dh_items i LEFT JOIN dh_categories c ON i.category_id = c.id WHERE i.name ILIKE $1 OR i.code ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "projects":
            sql = `SELECT id::text, name, code, site as building, 'projects' as type, 'Projet' as type_label FROM pm_projects WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          case "oibt":
            sql = `SELECT id::text, name, dossier_number as code, site as building, 'oibt' as type, 'OIBT/Périodique' as type_label FROM oibt_projects WHERE name ILIKE $1 OR dossier_number ILIKE $1 LIMIT 10`;
            params = [searchTerm];
            break;
          default:
            continue;
        }

        const { rows } = await pool.query(sql, params);
        results.push(...rows.map((r) => ({ ...r, equipment_type: t })));
      } catch (e) {
        // Table might not exist, skip silently
        console.log(`[Procedures] Equipment table ${t} skipped:`, e.message);
      }
    }

    res.json(results);
  } catch (err) {
    console.error("Error searching equipment:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- REAL-TIME ASSISTANCE MODE ---
// "Faisons ça ensemble" - Guide l'utilisateur étape par étape

const REALTIME_ASSISTANCE_PROMPT = `Tu es un expert technique qui guide l'utilisateur EN TEMPS RÉEL pour effectuer une opération.

Tu as accès à une procédure existante et tu dois guider l'utilisateur étape par étape.
Tu peux aussi analyser des photos qu'il t'envoie pour vérifier qu'il fait correctement les étapes.

## Ton rôle
- Guide l'utilisateur de manière interactive
- Vérifie les photos envoyées et confirme si c'est correct
- Réponds aux questions en temps réel
- Adapte-toi au contexte (si l'utilisateur signale un problème)
- Propose des alternatives si une étape n'est pas possible

## Format de réponse JSON
{
  "message": "Ton message à l'utilisateur",
  "currentStepNumber": 1,
  "isStepComplete": false,
  "needsPhoto": false,
  "photoFeedback": null,
  "warning": null,
  "canProceed": true,
  "suggestedActions": ["action1", "action2"],
  "emergencyStop": false
}

Sois professionnel, précis et sécuritaire. Si tu détectes un danger, dis STOP immédiatement.`;

// Start real-time assistance session
app.post("/api/procedures/ai/assist/start", async (req, res) => {
  try {
    const { procedureId, initialQuestion } = req.body;
    const userEmail = req.headers["x-user-email"] || "anonymous";

    // Get procedure details
    const { rows: procedures } = await pool.query(
      `SELECT * FROM procedures WHERE id = $1`, [procedureId]
    );
    const { rows: steps } = await pool.query(
      `SELECT * FROM procedure_steps WHERE procedure_id = $1 ORDER BY step_number`, [procedureId]
    );

    const procedure = procedures[0];
    if (!procedure) {
      return res.status(404).json({ error: "Procédure non trouvée" });
    }

    // Create assistance session
    const { rows: sessions } = await pool.query(
      `INSERT INTO procedure_ai_sessions
       (procedure_id, user_email, current_step, collected_data, conversation)
       VALUES ($1, $2, 'assist_step_1', $3, '[]'::jsonb)
       RETURNING id`,
      [procedureId, userEmail, JSON.stringify({ mode: 'realtime_assist', currentStepNumber: 1 })]
    );

    const sessionId = sessions[0].id;

    // Build context for AI
    const procedureContext = `
PROCÉDURE: ${procedure.title}
DESCRIPTION: ${procedure.description || 'N/A'}
NIVEAU DE RISQUE: ${procedure.risk_level}
EPI REQUIS: ${JSON.stringify(procedure.ppe_required || [])}
CODES SÉCURITÉ: ${JSON.stringify(procedure.safety_codes || [])}
CONTACTS URGENCE: ${JSON.stringify(procedure.emergency_contacts || [])}

ÉTAPES:
${steps.map(s => `
Étape ${s.step_number}: ${s.title}
Instructions: ${s.instructions || 'N/A'}
Avertissement: ${s.warning || 'Aucun'}
Durée estimée: ${s.duration_minutes || 'N/A'} minutes
`).join('\n')}
`;

    const messages = [
      { role: "system", content: REALTIME_ASSISTANCE_PROMPT + "\n\n" + procedureContext },
      { role: "user", content: initialQuestion || "Je suis prêt à commencer la procédure. Guide-moi." }
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });

    const aiResponse = JSON.parse(response.choices[0]?.message?.content || "{}");

    // Save conversation
    await pool.query(
      `UPDATE procedure_ai_sessions SET conversation = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify([
        { role: "user", content: initialQuestion || "Début assistance" },
        { role: "assistant", ...aiResponse }
      ]), sessionId]
    );

    res.json({
      sessionId,
      procedureTitle: procedure.title,
      totalSteps: steps.length,
      ...aiResponse
    });
  } catch (err) {
    console.error("Error starting assistance:", err);
    res.status(500).json({ error: err.message });
  }
});

// Continue real-time assistance with optional photo analysis
app.post("/api/procedures/ai/assist/:sessionId", uploadPhoto.single("photo"), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, action } = req.body;

    // Get session
    const { rows: sessions } = await pool.query(
      `SELECT s.*, p.title as procedure_title, p.ppe_required, p.safety_codes, p.emergency_contacts, p.risk_level
       FROM procedure_ai_sessions s
       JOIN procedures p ON s.procedure_id = p.id
       WHERE s.id = $1`, [sessionId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ error: "Session non trouvée" });
    }

    const session = sessions[0];
    const conversation = session.conversation || [];
    const collectedData = session.collected_data || {};

    // Get steps
    const { rows: steps } = await pool.query(
      `SELECT * FROM procedure_steps WHERE procedure_id = $1 ORDER BY step_number`,
      [session.procedure_id]
    );

    // Build message with photo if present
    let userContent = message || action || "Continue";
    let photoAnalysis = null;

    if (req.file) {
      // Analyze photo with GPT-4 Vision
      const photoBuffer = await fsp.readFile(req.file.path);
      const base64Image = photoBuffer.toString('base64');

      const visionResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Analyse cette photo dans le contexte de l'étape ${collectedData.currentStepNumber || 1} de la procédure "${session.procedure_title}". L'utilisateur doit faire: ${steps[collectedData.currentStepNumber - 1]?.instructions || 'suivre les instructions'}. Est-ce correct ? Y a-t-il des problèmes de sécurité ?` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ]
          }
        ],
        max_tokens: 500
      });

      photoAnalysis = visionResponse.choices[0]?.message?.content;
      userContent += `\n\n[ANALYSE PHOTO]: ${photoAnalysis}`;

      // Clean up
      await fsp.unlink(req.file.path).catch(() => {});
    }

    // Add to conversation
    conversation.push({ role: "user", content: message || action, photo: !!req.file, photoAnalysis });

    // Build context
    const procedureContext = `
PROCÉDURE: ${session.procedure_title}
ÉTAPE ACTUELLE: ${collectedData.currentStepNumber || 1} / ${steps.length}
NIVEAU DE RISQUE: ${session.risk_level}

ÉTAPES:
${steps.map(s => `Étape ${s.step_number}: ${s.title} - ${s.instructions || 'N/A'}`).join('\n')}
`;

    const messages = [
      { role: "system", content: REALTIME_ASSISTANCE_PROMPT + "\n\n" + procedureContext },
      ...conversation.map(c => ({ role: c.role, content: typeof c === 'string' ? c : (c.content || JSON.stringify(c)) })),
      { role: "user", content: userContent }
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });

    const aiResponse = JSON.parse(response.choices[0]?.message?.content || "{}");

    // Update conversation and step
    conversation.push({ role: "assistant", ...aiResponse });
    const newCollectedData = {
      ...collectedData,
      currentStepNumber: aiResponse.currentStepNumber || collectedData.currentStepNumber
    };

    await pool.query(
      `UPDATE procedure_ai_sessions SET conversation = $1, collected_data = $2, updated_at = now() WHERE id = $3`,
      [JSON.stringify(conversation), JSON.stringify(newCollectedData), sessionId]
    );

    res.json({
      ...aiResponse,
      photoAnalysis,
      totalSteps: steps.length
    });
  } catch (err) {
    console.error("Error in assistance:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- ANALYZE PHOTO STANDALONE ---
app.post("/api/procedures/ai/analyze-photo", uploadPhoto.single("photo"), async (req, res) => {
  try {
    const { context, question } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Aucune photo fournie" });
    }

    const photoBuffer = await fsp.readFile(req.file.path);
    const base64Image = photoBuffer.toString('base64');

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${question || "Analyse cette image en détail."}\n\nContexte: ${context || "Maintenance industrielle / équipements électriques"}`
            },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ],
      max_tokens: 1000
    });

    await fsp.unlink(req.file.path).catch(() => {});

    res.json({
      analysis: response.choices[0]?.message?.content,
      success: true
    });
  } catch (err) {
    console.error("Error analyzing photo:", err);
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
