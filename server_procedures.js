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
import QRCode from "qrcode";
import { createAuditTrail, AUDIT_ACTIONS } from "./lib/audit-trail.js";
import { extractTenantFromRequest, getTenantFilter } from "./lib/tenant-filter.js";

// OpenAI for AI-guided creation
import OpenAI from "openai";
// Gemini fallback
import { GoogleGenerativeAI } from "@google/generative-ai";

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
// OpenAI & Gemini
// ------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.AI_ASSISTANT_OPENAI_MODEL || "gpt-4o-mini";

// Gemini configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
let gemini = null;
if (GEMINI_API_KEY) {
  gemini = new GoogleGenerativeAI(GEMINI_API_KEY);
}

// Check if error is quota/rate limit related
function isQuotaError(error) {
  const msg = error?.message || '';
  return (
    error?.status === 429 ||
    error?.code === 'insufficient_quota' ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  );
}

// Convert OpenAI messages to Gemini format
function convertToGeminiFormat(messages) {
  let systemPrompt = '';
  const contents = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (Array.isArray(msg.content)) {
      const parts = [];
      for (const item of msg.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url') {
          const url = item.image_url?.url || '';
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: { mimeType: match[1], data: match[2] }
            });
          }
        }
      }
      contents.push({ role, parts });
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  return { systemPrompt, contents };
}

// Call Gemini API
async function callGemini(messages, options = {}) {
  if (!gemini) throw new Error('GEMINI_API_KEY not configured');

  const model = gemini.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.max_tokens ?? 4096,
    },
  });

  const { systemPrompt, contents } = convertToGeminiFormat(messages);

  // Add system prompt to first user message
  if (systemPrompt && contents.length > 0) {
    const firstUserIdx = contents.findIndex(c => c.role === 'user');
    if (firstUserIdx >= 0 && contents[firstUserIdx].parts[0]?.text) {
      contents[firstUserIdx].parts[0].text = `${systemPrompt}\n\n---\n\n${contents[firstUserIdx].parts[0].text}`;
    }
  }

  const result = await model.generateContent({ contents });
  return result.response.text();
}

// Parse JSON from AI response (handles markdown code blocks)
function parseAIJson(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
}

// Chat with fallback
async function chatWithFallback(messages, options = {}) {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!gemini;

  console.log(`[PROC-AI] Providers: OpenAI=${hasOpenAI}, Gemini=${hasGemini}`);

  // Try OpenAI first
  if (hasOpenAI) {
    try {
      console.log(`[PROC-AI] Calling OpenAI (${options.model || OPENAI_MODEL})...`);
      const response = await openai.chat.completions.create({
        model: options.model || OPENAI_MODEL,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 1500,
        ...(options.response_format && { response_format: options.response_format }),
      });
      const content = response.choices[0]?.message?.content || '';
      console.log(`[PROC-AI] OpenAI response: ${content.length} chars`);
      return { content, provider: 'openai' };
    } catch (error) {
      console.error(`[PROC-AI] OpenAI failed: ${error.message}`);

      if (hasGemini && isQuotaError(error)) {
        console.log(`[PROC-AI] Fallback to Gemini...`);
        try {
          const content = await callGemini(messages, options);
          console.log(`[PROC-AI] Gemini response: ${content.length} chars`);
          return { content, provider: 'gemini' };
        } catch (geminiError) {
          console.error(`[PROC-AI] Gemini also failed: ${geminiError.message}`);
          throw geminiError;
        }
      }
      throw error;
    }
  }

  // Only Gemini
  if (hasGemini) {
    console.log(`[PROC-AI] Using Gemini (no OpenAI)...`);
    const content = await callGemini(messages, options);
    console.log(`[PROC-AI] Gemini response: ${content.length} chars`);
    return { content, provider: 'gemini' };
  }

  throw new Error('No AI provider configured');
}

// ------------------------------
// RAMS REFERENCE DATA - Based on RAMS_B20_ATEX Excel (Annexes 1-4)
// ------------------------------

// ANNEXE 4 - Échelles de cotation officielles
const RAMS_GRAVITY_SCALE = {
  5: { level: 5, label: "Catastrophique", desc: "Mortalité, invalide à vie", keywords: "décès, mort, invalide permanent" },
  4: { level: 4, label: "Critique", desc: "Incapacité permanente (amputation, fractures multiples, surdité, brûlure 3e degré)", keywords: "amputation, fractures multiples, surdité, brûlure grave" },
  3: { level: 3, label: "Grave", desc: "Incapacité temporaire (entorse, fracture simple, tendinite, commotion)", keywords: "entorse, fracture, tendinite, commotion, brûlure modérée" },
  2: { level: 2, label: "Important", desc: "Perte de temps (foulure, gastro, coupure profonde)", keywords: "foulure, coupure profonde, arrêt travail" },
  1: { level: 1, label: "Mineure", desc: "Premiers soins sans perte de temps (ecchymose, inconfort, égratignure)", keywords: "ecchymose, égratignure, inconfort" }
};

const RAMS_PROBABILITY_SCALE = {
  5: { level: 5, label: "Très probable", desc: "Aucune mesure de sécurité, va certainement survenir" },
  4: { level: 4, label: "Probable", desc: "Mesures de sécurité faibles (EPI seulement fournis)" },
  3: { level: 3, label: "Possible", desc: "Mesures de prévention en place (formation, procédures, inspections, alarmes)" },
  2: { level: 2, label: "Peu probable", desc: "Contrôles techniques en place (protecteurs fixes, ventilation auto, garde-corps)" },
  1: { level: 1, label: "Improbable", desc: "Pratiquement impossible, élimination à la source" }
};

// ANNEXE 1 - Liste complète des catégories de dangers (checkbox)
const RAMS_HAZARD_CATEGORIES = {
  // Dangers physiques
  "Présence de bruit": { group: "Physique", ppe: ["Bouchons d'oreilles EN 352-2", "Serre-têtes EN352-1"] },
  "Éclairage insuffisant": { group: "Physique", ppe: [] },
  "Rayonnement laser / soudure": { group: "Physique", ppe: ["Casque de soudage EN379 / EN175"] },
  "Vibration": { group: "Physique", ppe: ["Gants anti-vibrations"] },
  "Outil coupants / tranchants": { group: "Physique", ppe: ["Gants anti coupure EN388"] },
  "Travail en hauteur": { group: "Physique", ppe: ["Harnais antichute EN 361", "Casque à jugulaire EN 12492"] },
  "Écrasement / choc": { group: "Physique", ppe: ["Casque de chantier EN397", "Chaussures de sécurité EN345 S3"] },
  "Coupure / Cisaillement": { group: "Physique", ppe: ["Gants anti coupure EN388 - 4 4 3 3 D P"] },
  "Projection": { group: "Physique", ppe: ["Lunettes de sécurité EN ISO 16321", "Visière de sécurité EN16321"] },
  "Gaz sous pression": { group: "Physique", ppe: [] },
  "Coincement": { group: "Physique", ppe: ["Gants de protection mécanique EN388"] },

  // Dangers chute
  "Chute de plein pied": { group: "Chute", ppe: ["Chaussures de sécurité EN345 S3"] },
  "Chute de hauteur < 1m": { group: "Chute", ppe: ["Casque de chantier EN397"] },
  "Chute de hauteur 1m > 1,8m": { group: "Chute", ppe: ["Harnais antichute EN 361"] },
  "Chute de hauteur > 3m": { group: "Chute", ppe: ["Harnais antichute EN 361", "Stop chute EN 360"] },
  "Circulation (frappé par)": { group: "Chute", ppe: ["Gilet haute visibilité EN ISO 20471"] },

  // Dangers levage
  "Chute de charge": { group: "Levage", ppe: ["Casque de chantier EN397"] },
  "Rupture d'élingue": { group: "Levage", ppe: [] },

  // Dangers environnement de travail
  "Zone dangereuse ATEX": { group: "Environnement", ppe: ["Chaussures de sécurité ESD certifiées ATEX", "Vêtements antistatiques"] },
  "Vent fort": { group: "Environnement", ppe: [] },
  "Intempéries": { group: "Environnement", ppe: [] },
  "Température basse": { group: "Environnement", ppe: ["Gants de protection froid EN511"] },
  "Température élevée": { group: "Environnement", ppe: ["Gants de protection chaleur EN407"] },
  "Incendie": { group: "Environnement", ppe: [] },
  "Accès exigu": { group: "Environnement", ppe: [] },
  "Travailleur isolé": { group: "Environnement", ppe: [] },
  "Coactivité": { group: "Environnement", ppe: ["Gilet haute visibilité EN ISO 20471"] },

  // Dangers électriques
  "Fil dénudé / endommagé": { group: "Électrique", ppe: ["Gants isolants"] },
  "Électrisation": { group: "Électrique", ppe: ["Casque électriquement isolants EN50365", "Gants isolants"] },
  "Arc électrique": { group: "Électrique", ppe: ["Visière arc électrique", "Vêtements ARC"] },

  // Dangers ergonomiques
  "Déplacement de charge lourde": { group: "Ergonomie", ppe: ["Gants de manutention"] },
  "Posture contraignante": { group: "Ergonomie", ppe: ["Genouillères"] },
  "Levage manuel": { group: "Ergonomie", ppe: ["Ceinture lombaire"] },

  // Dangers chimiques
  "Éclaboussures produits dangereux": { group: "Chimique", ppe: ["Gants de protection chimique EN374", "Lunettes étanches"] },
  "Vapeur / poussières / fumées toxiques": { group: "Chimique", ppe: ["Masque FFP2", "Masque FFP3"] },

  // Génériques
  "Accès / circulation": { group: "Général", ppe: ["Chaussures de sécurité EN345 S3", "Gilet haute visibilité"] },
  "Manutention / TMS": { group: "Général", ppe: ["Gants de manutention"] },
  "Coupures / projections": { group: "Général", ppe: ["Lunettes de protection", "Gants anti-coupures"] },
  "Bruit": { group: "Général", ppe: ["Protections auditives EN352"] },
  "Chute d'objets": { group: "Général", ppe: ["Casque de sécurité EN397"] },
  "Organisation": { group: "Général", ppe: [] },
  "Électrique": { group: "Électrique", ppe: ["Gants isolants", "VAT"] },
  "Électrique - ATEX": { group: "Électrique", ppe: ["Gants isolants", "Écran facial arc", "Vêtements antistatiques"] },
  "Risque ATEX": { group: "ATEX", ppe: ["Vêtements antistatiques", "Chaussures ESD"] },
  "Thermique": { group: "Thermique", ppe: ["Gants protection thermique"] },
  "Glissade / Chute": { group: "Chute", ppe: ["Chaussures de sécurité antidérapantes"] },
  "Ergonomie": { group: "Ergonomie", ppe: ["Genouillères"] },
  "Perçage / Poussières": { group: "Physique", ppe: ["Lunettes de protection", "Masque FFP2"] }
};

// ------------------------------
// AI Risk Analysis for RAMS
// ------------------------------
async function analyzeRisksWithAI(procedure, steps) {
  const prompt = `Tu es un expert HSE (Hygiène Sécurité Environnement) spécialisé dans l'analyse de risques professionnels selon la méthodologie RAMS (Risk Assessment Method Statement).

Analyse cette procédure opérationnelle et génère une évaluation des risques COMPLÈTE pour chaque étape, avec évaluation INITIALE et FINALE (après mesures).

## PROCÉDURE
Titre: ${procedure.title}
Description: ${procedure.description || 'Non spécifié'}
Catégorie: ${procedure.category || 'Général'}
Niveau de risque déclaré: ${procedure.risk_level || 'low'}
EPI requis: ${JSON.stringify(procedure.ppe_required || [])}
Codes sécurité: ${JSON.stringify(procedure.safety_codes || [])}

## ÉTAPES
${steps.map((s, i) => `
Étape ${s.step_number}: ${s.title}
- Instructions: ${s.instructions || 'Aucune'}
- Avertissement: ${s.warning || 'Aucun'}
- Durée: ${s.duration_minutes || '?'} min
`).join('\n')}

## ÉCHELLES DE COTATION (Réf. Annexe 4)

GRAVITÉ (G) - Conséquences potentielles:
5 = Catastrophique : Mortalité, invalide à vie
4 = Critique : Incapacité permanente (amputation, fractures multiples, surdité, brûlure 3e degré)
3 = Grave : Incapacité temporaire (entorse, fracture simple, tendinite, commotion)
2 = Important : Perte de temps (foulure, gastro, coupure profonde, brûlure modérée)
1 = Mineure : Premiers soins sans perte de temps (ecchymose, inconfort, égratignure)

PROBABILITÉ (P) - Mesures en place:
5 = Très probable : Aucune mesure de sécurité, va certainement survenir
4 = Probable : Mesures de sécurité faibles (EPI seulement fournis)
3 = Possible : Mesures de prévention en place (formation, procédures, inspections, alarmes)
2 = Peu probable : Contrôles techniques en place (protecteurs fixes, ventilation auto, garde-corps)
1 = Improbable : Pratiquement impossible, élimination à la source

NIR = G × P (Niveau d'Indice de Risque)
- NIR ≥ 15: CRITIQUE
- NIR ≥ 10: ÉLEVÉ
- NIR ≥ 5: MODÉRÉ
- NIR < 5: FAIBLE

## CATÉGORIES DE DANGERS STANDARDS
- Accès / circulation
- Coactivité
- Manutention / TMS
- Coupures / projections
- Chute d'objets
- Chute de hauteur
- Électrique
- Électrique - ATEX
- Risque ATEX
- Arc électrique
- Thermique
- Chimique
- Bruit
- Ergonomie
- Organisation
- Glissade / Chute

## FORMAT DE RÉPONSE (JSON STRICT)
{
  "global_assessment": {
    "overall_risk": "low|medium|high|critical",
    "main_hazards": ["danger 1", "danger 2"],
    "critical_steps": [2, 4],
    "total_hazards": 12,
    "max_nir_initial": 15,
    "max_nir_final": 5
  },
  "steps": [
    {
      "step_number": 1,
      "hazards": [
        {
          "checkbox": "Accès / circulation",
          "danger": "Description précise du danger et scénario d'accident",
          "gi": 3,
          "pi": 2,
          "measures": "Mesures préventives concrètes à mettre en place",
          "ppe": ["Chaussures de sécurité S3", "Gilet haute visibilité"],
          "actions": "Actions détaillées et contrôles à effectuer",
          "responsible": "Chef d'équipe",
          "gf": 3,
          "pf": 1
        }
      ]
    }
  ]
}

## RÈGLES IMPORTANTES
1. Identifie 2-4 dangers pertinents par étape
2. gi/pi = Gravité/Probabilité INITIALES (avant mesures)
3. gf/pf = Gravité/Probabilité FINALES (après mesures) - gf reste souvent égal à gi, mais pf doit être RÉDUIT grâce aux mesures
4. La probabilité finale (pf) doit être ≤ pi si des mesures efficaces sont appliquées
5. Sois réaliste et cohérent avec l'activité décrite
6. Les mesures doivent être concrètes et applicables
7. Les EPI doivent être spécifiques au danger identifié
8. Le responsable doit être un rôle (Chef d'équipe, Électricien, Technicien, Tous, Superviseur)

RÉPONDS UNIQUEMENT AVEC LE JSON, sans texte avant ou après.`;

  try {
    // Try OpenAI first, then Gemini fallback
    const result = await chatWithFallback(
      [{ role: "user", content: prompt }],
      { temperature: 0.3, max_tokens: 4000, response_format: { type: "json_object" } }
    );

    const content = result.content || "{}";
    // Extract JSON from response (handle potential markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log("[RAMS] AI analysis completed:", {
        steps: parsed.steps?.length || 0,
        totalHazards: parsed.global_assessment?.total_hazards || 'N/A',
        overallRisk: parsed.global_assessment?.overall_risk || 'N/A'
      });
      return parsed;
    }
    return null;
  } catch (error) {
    console.error("[RAMS] AI risk analysis error:", error.message);

    // Fallback: Generate basic structure from keywords
    return generateFallbackRiskAnalysis(procedure, steps);
  }
}

// Fallback risk analysis when AI fails
function generateFallbackRiskAnalysis(procedure, steps) {
  const riskLevel = procedure.risk_level || 'low';
  const baseGravity = { low: 2, medium: 3, high: 4, critical: 5 }[riskLevel] || 2;
  const baseProb = { low: 2, medium: 3, high: 4, critical: 5 }[riskLevel] || 2;

  const hazardTemplates = {
    'electri': { checkbox: 'Électrique', danger: 'Risque d\'électrocution ou d\'arc électrique', gi: 4, ppe: ['Gants isolants', 'Écran facial'] },
    'atex': { checkbox: 'Risque ATEX', danger: 'Risque d\'inflammation en zone ATEX', gi: 5, ppe: ['Vêtements antistatiques', 'Chaussures ESD'] },
    'hauteur': { checkbox: 'Chute de hauteur', danger: 'Chute lors de travaux en élévation', gi: 4, ppe: ['Harnais de sécurité', 'Casque'] },
    'manutention': { checkbox: 'Manutention / TMS', danger: 'Troubles musculo-squelettiques lors de manutention', gi: 2, ppe: ['Gants de manutention'] },
    'coupure': { checkbox: 'Coupures / projections', danger: 'Coupures ou blessures lors de manipulations', gi: 3, ppe: ['Gants anti-coupures', 'Lunettes de protection'] },
    'default': { checkbox: 'Organisation', danger: 'Risque opérationnel général', gi: baseGravity, ppe: ['Chaussures de sécurité'] }
  };

  const stepsAnalysis = steps.map(step => {
    const combined = ((step.instructions || '') + ' ' + (step.warning || '') + ' ' + (step.title || '')).toLowerCase();
    const hazards = [];

    Object.entries(hazardTemplates).forEach(([keyword, template]) => {
      if (keyword !== 'default' && combined.includes(keyword)) {
        hazards.push({
          checkbox: template.checkbox,
          danger: template.danger,
          gi: template.gi,
          pi: baseProb,
          measures: `Appliquer les mesures de prévention standard. ${step.warning || ''}`,
          ppe: template.ppe,
          actions: 'Vérifier l\'environnement avant intervention. Respecter les consignes de sécurité.',
          responsible: 'Chef d\'équipe',
          gf: template.gi,
          pf: Math.max(1, baseProb - 2)
        });
      }
    });

    if (hazards.length === 0) {
      hazards.push({
        ...hazardTemplates.default,
        pi: baseProb,
        measures: 'Appliquer les mesures de prévention standard.',
        actions: 'Suivre les instructions de la procédure.',
        responsible: 'Tous',
        gf: hazardTemplates.default.gi,
        pf: Math.max(1, baseProb - 1)
      });
    }

    return { step_number: step.step_number, hazards };
  });

  return {
    global_assessment: {
      overall_risk: riskLevel,
      main_hazards: [...new Set(stepsAnalysis.flatMap(s => s.hazards.map(h => h.checkbox)))],
      critical_steps: stepsAnalysis.filter(s => s.hazards.some(h => h.gi * h.pi >= 12)).map(s => s.step_number),
      total_hazards: stepsAnalysis.reduce((acc, s) => acc + s.hazards.length, 0)
    },
    steps: stepsAnalysis
  };
}

// Analyze photos with AI for additional risk detection
async function analyzePhotoForRisks(photoBuffer) {
  try {
    const base64Image = photoBuffer.toString('base64');
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyse cette photo de chantier/installation et identifie les risques potentiels visibles.

Reponds en JSON:
{
  "risks_detected": [
    {"category": "Type", "description": "Description", "severity": 1-5}
  ],
  "safety_observations": ["observation 1", "observation 2"],
  "ppe_visible": ["epi visible 1"],
  "ppe_missing": ["epi manquant potentiel"]
}`
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}` }
            }
          ]
        }
      ],
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.error("[RAMS] Photo analysis error:", error.message);
    return null;
  }
}

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

## IMPORTANT: Gestion des photos

Quand tu demandes "Voulez-vous ajouter une photo pour cette étape?" et que l'utilisateur répond "oui", "yes", "ok", ou toute réponse affirmative:
- Tu DOIS répondre avec "expectsPhoto": true
- Tu DOIS dire "Parfait, veuillez uploader la photo pour cette étape."
- Tu NE DOIS PAS passer à l'étape suivante ou demander autre chose
- Tu ATTENDS que l'utilisateur upload la photo (tu recevras l'analyse de la photo dans le prochain message)

Quand tu reçois un message contenant "[Photo analysée:" ou "[Photo:", cela signifie que l'utilisateur a uploadé une photo. Tu peux alors:
- Confirmer la réception de la photo
- Passer à la question suivante (durée estimée, ou étape suivante)

## Format de réponse

Réponds TOUJOURS en JSON avec cette structure:
{
  "message": "Ton message à l'utilisateur",
  "currentStep": "init|risks|steps|contacts|equipment|review|complete",
  "question": "La question spécifique à poser",
  "options": ["option1", "option2"], // optionnel, pour choix multiples
  "expectsPhoto": false, // METTRE true quand on attend une photo de l'utilisateur
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

  // If a photo was uploaded, analyze it with GPT-4o Vision
  let photoAnalysis = null;
  if (uploadedPhoto) {
    try {
      const photoPath = path.join(PHOTOS_DIR, uploadedPhoto);
      if (fs.existsSync(photoPath)) {
        const photoBuffer = fs.readFileSync(photoPath);
        const base64Photo = photoBuffer.toString('base64');
        const mimeType = 'image/jpeg';

        const visionMessages = [
          {
            role: "system",
            content: "Tu analyses des photos pour créer des procédures de maintenance. Décris brièvement (2-3 lignes) ce que tu vois: l'action, l'équipement, le contexte. Sois direct."
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Photo}`, detail: "low" } },
              { type: "text", text: userMessage || "Décris cette image pour une procédure" }
            ]
          }
        ];
        const visionResult = await chatWithFallback(visionMessages, { model: "gpt-4o", max_tokens: 200 });
        photoAnalysis = visionResult.content || '';
        console.log(`[PROC] Photo analysis: ${photoAnalysis.substring(0, 100)}...`);
      }
    } catch (e) {
      console.error('[PROC] Photo analysis error:', e.message);
    }
  }

  // Add user message
  const userEntry = { role: "user", content: userMessage };
  if (uploadedPhoto) {
    userEntry.photo = uploadedPhoto;
    if (photoAnalysis) {
      userEntry.photoAnalysis = photoAnalysis;
    }
  }
  conversation.push(userEntry);

  // Build messages for OpenAI
  const photoContext = photoAnalysis ? `\n[Photo analysée: ${photoAnalysis}]` : (uploadedPhoto ? `\n[Photo uploadée: ${uploadedPhoto}]` : "");
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
      content: c.content + (c.photoAnalysis ? `\n[Photo: ${c.photoAnalysis}]` : (c.photo ? `\n[Photo: ${c.photo}]` : ""))
    }))
  ];

  // Call AI with fallback
  const result = await chatWithFallback(messages, {
    temperature: 0.7,
    max_tokens: 1500,
    response_format: { type: "json_object" }
  });

  let aiResponse;
  try {
    aiResponse = parseAIJson(result.content);
  } catch {
    aiResponse = {
      message: result.content,
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

  const result = await chatWithFallback(
    [{ role: "user", content: prompt }],
    { temperature: 0.3, max_tokens: 2000, response_format: { type: "json_object" } }
  );

  try {
    return parseAIJson(result.content);
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

  const result = await chatWithFallback(
    [{ role: "user", content: prompt }],
    { temperature: 0.3, max_tokens: 2500, response_format: { type: "json_object" } }
  );

  try {
    return parseAIJson(result.content);
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

  // Risk level colors and labels (using text instead of emojis for PDF compatibility)
  const riskConfig = {
    low: { color: colors.success, label: "FAIBLE", icon: "[OK]" },
    medium: { color: colors.warning, label: "MODERE", icon: "[!]" },
    high: { color: colors.danger, label: "ELEVE", icon: "[!!]" },
    critical: { color: "#7f1d1d", label: "CRITIQUE", icon: "[XXX]" },
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
  doc.fontSize(20).fillColor("#fff").text("SECURITE & EPI", 50, 22, { width: 495 });

  yPos = 90;

  // EPI Section
  doc.fontSize(14).fillColor(colors.text).text("ÉQUIPEMENTS DE PROTECTION INDIVIDUELLE", 50, yPos);
  yPos += 30;

  const ppeList = procedure.ppe_required || [];
  if (ppeList.length > 0) {
    const ppePerRow = 2;
    ppeList.forEach((ppe, i) => {
      const col = i % ppePerRow;
      const row = Math.floor(i / ppePerRow);
      const x = 50 + col * 260;
      const y = yPos + row * 45;

      doc.roundedRect(x, y, 245, 40, 5).fillAndStroke("#fef3c7", colors.warning);
      doc.fontSize(11).fillColor(colors.text).text(`* ${ppe}`, x + 15, y + 14, { width: 220 });
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
      doc.fontSize(10).fillColor(colors.text).text(`> ${code}`, 65, yPos + 10, { width: 465 });
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
    doc.fontSize(14).fillColor(colors.danger).text("CONTACTS D'URGENCE", 70, yPos + 15);
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
  doc.fontSize(20).fillColor("#fff").text("ETAPES DE LA PROCEDURE", 50, 22, { width: 495 });

  yPos = 90;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Calculate actual content height
    const hasPhoto = step.photo_content || step.photo_path;
    const instructionHeight = step.instructions ? doc.heightOfString(step.instructions, { width: 455 }) + 15 : 0;
    const warningHeight = step.warning ? 45 : 0;
    const photoHeight = hasPhoto ? 180 : 0;
    const baseHeight = 60; // Header + padding
    const stepHeight = baseHeight + instructionHeight + warningHeight + photoHeight;

    // Check if we need a new page
    if (yPos + stepHeight > 750) {
      doc.addPage();
      yPos = 50;
    }

    // Step card
    doc.roundedRect(50, yPos, 495, stepHeight, 10).fillAndStroke("#fff", "#e5e7eb");

    // Step number circle
    doc.circle(80, yPos + 25, 18).fill(colors.primary);
    doc.fontSize(14).fillColor("#fff").text(String(step.step_number), 71, yPos + 18);

    // Step title
    doc.fontSize(14).fillColor(colors.text).font("Helvetica-Bold").text(step.title, 110, yPos + 18, { width: 420 });

    // Duration if available
    if (step.duration_minutes) {
      doc.fontSize(9).fillColor("#6b7280").font("Helvetica").text(`${step.duration_minutes} min`, 450, yPos + 20);
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
      doc.fontSize(9).fillColor(colors.warning).text(`ATTENTION: ${step.warning}`, 85, contentY + 10, { width: 425 });
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

    yPos += stepHeight + 15; // Add spacing between steps
  }

  // === EQUIPMENT LINKS PAGE ===
  if (equipmentLinks.length > 0) {
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill(colors.secondary);
    doc.fontSize(20).fillColor("#fff").text("EQUIPEMENTS CONCERNES", 50, 22, { width: 495 });

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

// ------------------------------
// RAMS - Risk Assessment Method Statement A3 PDF
// Professional format based on industrial standards with Initial AND Final evaluation
// ------------------------------
async function generateMethodStatementA3PDF(procedureId, baseUrl = 'https://electrohub.app') {
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
    `SELECT id, step_number, title, description, instructions, warning,
            duration_minutes, requires_validation, validation_criteria,
            photo_path, photo_content, created_at, updated_at
     FROM procedure_steps WHERE procedure_id = $1 ORDER BY step_number`,
    [procedureId]
  );

  // Get site settings with multiple fallbacks
  let siteSettings = {};
  try {
    let { rows: settings } = await pool.query(
      `SELECT logo, logo_mime, company_name, company_address, company_phone
       FROM site_settings WHERE site = $1`, [procedure.site || 'default']
    );
    if (settings.length === 0) {
      const r = await pool.query(`SELECT logo, logo_mime, company_name, company_address, company_phone
                                   FROM site_settings WHERE logo IS NOT NULL LIMIT 1`);
      settings = r.rows;
    }
    if (settings.length > 0) siteSettings = settings[0];
  } catch (e) {
    console.log("[RAMS] Site settings error:", e.message);
  }

  // === AI RISK ANALYSIS (with new complete format) ===
  console.log("[RAMS] Starting AI risk analysis for procedure:", procedure.title);
  let aiAnalysis = null;
  try {
    aiAnalysis = await analyzeRisksWithAI(procedure, steps);
    if (aiAnalysis) {
      console.log("[RAMS] AI analysis completed - Global risk:", aiAnalysis.global_assessment?.overall_risk);
    }
  } catch (e) {
    console.log("[RAMS] AI analysis failed, using fallback:", e.message);
    aiAnalysis = generateFallbackRiskAnalysis(procedure, steps);
  }

  // Build hazards map from AI analysis
  const aiHazardsMap = new Map();
  if (aiAnalysis?.steps) {
    aiAnalysis.steps.forEach(stepAnalysis => {
      aiHazardsMap.set(stepAnalysis.step_number, stepAnalysis.hazards || []);
    });
  }

  // Generate QR Code
  let qrCodeBuffer = null;
  try {
    qrCodeBuffer = await QRCode.toBuffer(`${baseUrl}/procedures?id=${procedureId}&ai=true`, {
      width: 80, margin: 1, color: { dark: '#1e1b4b', light: '#ffffff' }
    });
  } catch (e) {
    console.log("[RAMS] QR code error:", e.message);
  }

  // === PDF SETUP - A3 LANDSCAPE ===
  const pageWidth = 1190.55;
  const pageHeight = 841.89;
  const margin = 20;

  const doc = new PDFDocument({
    size: [pageWidth, pageHeight],
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `RAMS - ${procedure.title}`,
      Author: siteSettings.company_name || "ElectroHub",
      Subject: "Risk Assessment Method Statement",
      Creator: "ElectroHub RAMS Generator v2",
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  // Colors - Using company green #30EA03 for header
  const c = {
    headerBg: "#30EA03",       // Vert entreprise
    headerText: "#000000",     // Texte noir sur vert
    primary: "#7c3aed",
    danger: "#dc2626",
    warning: "#f59e0b",
    success: "#16a34a",
    info: "#2563eb",
    text: "#1f2937",
    lightText: "#6b7280",
    lightBg: "#f8fafc",
    border: "#d1d5db",
    white: "#ffffff",
    darkRed: "#7f1d1d",
    orange: "#ea580c",
    darkBlue: "#1e1b4b",
  };

  // Risk color functions
  const getRiskColor = (nir) => {
    if (nir >= 15) return c.darkRed;
    if (nir >= 10) return c.danger;
    if (nir >= 5) return c.warning;
    return c.success;
  };

  const getGravityColor = (g) => {
    if (g >= 5) return c.darkRed;
    if (g >= 4) return c.danger;
    if (g >= 3) return c.orange;
    if (g >= 2) return c.warning;
    return c.success;
  };

  const riskLevel = procedure.risk_level || 'low';

  // === HEADER SECTION ===
  const headerH = 65;
  doc.rect(0, 0, pageWidth, headerH).fill(c.headerBg);

  // Logo / Company
  let logoX = margin;
  if (siteSettings.logo) {
    try {
      doc.image(siteSettings.logo, margin, 8, { height: 48 });
      logoX = margin + 65;
    } catch (e) {}
  }

  doc.font("Helvetica-Bold").fontSize(12).fillColor(c.headerText)
     .text(siteSettings.company_name || "ELECTROHUB", logoX + 5, 10);

  // Method Statement badge
  doc.roundedRect(logoX + 5, 30, 140, 24, 4).fill(c.primary);
  doc.fontSize(11).fillColor(c.white).text("METHOD STATEMENT", logoX + 15, 36);

  // Title centered - black text on green
  const titleW = 500;
  const titleX = (pageWidth - titleW) / 2;
  doc.fontSize(13).fillColor(c.headerText)
     .text(procedure.title.toUpperCase(), titleX, 8, { width: titleW, align: "center" });
  doc.fontSize(9).fillColor("#1a5c00")
     .text(`Activite: ${procedure.category || "Generale"} | Version ${procedure.version || 1} | ${new Date().toLocaleDateString("fr-FR")}`, titleX, 28, { width: titleW, align: "center" });
  doc.fontSize(8).fillColor("#2d7a00")
     .text(`Site: ${procedure.site || 'N/A'} | Batiment: ${procedure.building || 'N/A'}`, titleX, 44, { width: titleW, align: "center" });

  // Risk badge
  const riskColors = { low: c.success, medium: c.warning, high: c.danger, critical: c.darkRed };
  const riskLabels = { low: "FAIBLE", medium: "MODÉRÉ", high: "ÉLEVÉ", critical: "CRITIQUE" };
  doc.roundedRect(pageWidth - 175, 8, 75, 48, 5).fill(riskColors[riskLevel] || c.success);
  doc.fontSize(8).fillColor(c.white).text("RISQUE", pageWidth - 170, 14, { width: 65, align: "center" });
  doc.fontSize(13).text(riskLabels[riskLevel] || "FAIBLE", pageWidth - 170, 30, { width: 65, align: "center" });

  // QR Code
  if (qrCodeBuffer) {
    try {
      doc.image(qrCodeBuffer, pageWidth - margin - 70, 5, { width: 55 });
    } catch (e) {}
  }

  // === CONTENT LAYOUT - Fixed proportions to avoid overlap ===
  let y = headerH + 8;
  const contentW = pageWidth - margin * 2;
  const sidebarW = 260;  // Fixed sidebar width
  const col1W = contentW - sidebarW - 20;  // Table width with gap
  const col2W = sidebarW;
  const col2X = margin + col1W + 20;  // Sidebar position

  // === MAIN RISK TABLE HEADER ===
  doc.rect(margin, y, col1W, 20).fill(c.danger);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
     .text("ANALYSE DES RISQUES - MÉTHODOLOGIE ET IDENTIFICATION DES DANGERS", margin + 10, y + 5);
  y += 20;

  // Column headers with Initial AND Final evaluation
  const tableHeaderH = 35;
  const colWidths = {
    n: 28,
    task: col1W * 0.14,
    danger: col1W * 0.18,
    gi: 28, pi: 28, niri: 32,
    measures: col1W * 0.18,
    ppe: col1W * 0.10,
    actions: col1W * 0.12,
    resp: 45,
    gf: 28, pf: 28, nirf: 32
  };

  // Header row 1 - Evaluation labels
  doc.rect(margin, y, col1W, 15).fill(c.lightBg).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.text);

  let hx = margin + colWidths.n + colWidths.task + colWidths.danger;
  doc.text("ÉVALUATION INITIALE", hx, y + 4, { width: colWidths.gi + colWidths.pi + colWidths.niri, align: "center" });
  hx += colWidths.gi + colWidths.pi + colWidths.niri + colWidths.measures + colWidths.ppe + colWidths.actions + colWidths.resp;
  doc.text("ÉVALUATION FINALE", hx, y + 4, { width: colWidths.gf + colWidths.pf + colWidths.nirf, align: "center" });
  y += 15;

  // Header row 2 - Column names
  doc.rect(margin, y, col1W, tableHeaderH - 15).fill(c.lightBg).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(6).fillColor(c.text);

  const headers = [
    { label: "N", w: colWidths.n },
    { label: "TÂCHE / ACTIVITÉ", w: colWidths.task },
    { label: "DANGER - SCÉNARIO", w: colWidths.danger },
    { label: "G", w: colWidths.gi },
    { label: "P", w: colWidths.pi },
    { label: "NIR", w: colWidths.niri },
    { label: "MESURES PRÉVENTIVES", w: colWidths.measures },
    { label: "EPI", w: colWidths.ppe },
    { label: "ACTIONS DÉTAILLÉES", w: colWidths.actions },
    { label: "RESP.", w: colWidths.resp },
    { label: "G", w: colWidths.gf },
    { label: "P", w: colWidths.pf },
    { label: "NIR", w: colWidths.nirf }
  ];

  hx = margin;
  headers.forEach((h, i) => {
    const align = i < 3 || (i >= 6 && i < 10) ? "left" : "center";
    doc.text(h.label, hx + 2, y + 5, { width: h.w - 4, align });
    if (i < headers.length - 1) {
      doc.moveTo(hx + h.w, y).lineTo(hx + h.w, y + tableHeaderH - 15).stroke(c.border);
    }
    hx += h.w;
  });
  y += tableHeaderH - 15;

  // === TABLE ROWS ===
  const maxTableY = pageHeight - 130;
  let rowCount = 0;

  for (const step of steps) {
    const aiStepHazards = aiHazardsMap.get(step.step_number) || [];

    // Use AI hazards or generate fallback
    const hazards = aiStepHazards.length > 0 ? aiStepHazards : [{
      checkbox: "Organisation",
      danger: step.warning || "Risque opérationnel standard",
      gi: 2, pi: 2,
      measures: "Suivre les instructions de la procédure",
      ppe: procedure.ppe_required?.slice(0, 2) || [],
      actions: "Respecter les consignes de sécurité",
      responsible: "Tous",
      gf: 2, pf: 1
    }];

    for (let hi = 0; hi < Math.min(hazards.length, 3); hi++) {
      if (y > maxTableY - 30) {
        doc.addPage();
        y = margin;
        doc.rect(margin, y, col1W, 18).fill(c.danger);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
           .text("ANALYSE DES RISQUES (suite)", margin + 10, y + 4);
        y += 20;
      }

      const hazard = hazards[hi];
      const isFirst = hi === 0;
      const rowH = 32;
      const isEven = rowCount % 2 === 0;

      doc.rect(margin, y, col1W, rowH).fillAndStroke(isEven ? c.white : c.lightBg, c.border);

      let rx = margin;

      // N (step number)
      if (isFirst) {
        doc.circle(rx + colWidths.n / 2, y + rowH / 2, 10).fill(c.primary);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
           .text(String(step.step_number), rx + colWidths.n / 2 - 4, y + rowH / 2 - 5);
      }
      rx += colWidths.n;

      // Task
      if (isFirst) {
        doc.font("Helvetica-Bold").fontSize(6).fillColor(c.text)
           .text(step.title.substring(0, 40), rx + 2, y + 4, { width: colWidths.task - 4 });
      }
      rx += colWidths.task;

      // Danger with checkbox
      const checkbox = hazard.checkbox || hazard.category || "Risque";
      doc.font("Helvetica-Bold").fontSize(6).fillColor(c.danger)
         .text(`☐ ${checkbox}`, rx + 2, y + 3, { width: colWidths.danger - 4 });
      doc.font("Helvetica").fontSize(5).fillColor(c.text)
         .text((hazard.danger || "").substring(0, 70), rx + 2, y + 12, { width: colWidths.danger - 4 });
      rx += colWidths.danger;

      // G initial
      const gi = hazard.gi || hazard.gravity || 2;
      const pi = hazard.pi || hazard.probability || 2;
      const niri = gi * pi;
      doc.roundedRect(rx + 3, y + 8, 22, 16, 2).fill(getGravityColor(gi));
      doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
         .text(String(gi), rx + 3, y + 11, { width: 22, align: "center" });
      rx += colWidths.gi;

      // P initial
      doc.roundedRect(rx + 3, y + 8, 22, 16, 2).fill(getGravityColor(pi));
      doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
         .text(String(pi), rx + 3, y + 11, { width: 22, align: "center" });
      rx += colWidths.pi;

      // NIR initial
      doc.roundedRect(rx + 2, y + 8, 28, 16, 2).fill(getRiskColor(niri));
      doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
         .text(String(niri), rx + 2, y + 11, { width: 28, align: "center" });
      rx += colWidths.niri;

      // Measures
      const measures = typeof hazard.measures === 'string' ? hazard.measures :
                       (Array.isArray(hazard.measures) ? hazard.measures.join(". ") : "");
      doc.font("Helvetica").fontSize(5).fillColor(c.text)
         .text(measures.substring(0, 70), rx + 2, y + 4, { width: colWidths.measures - 4 });
      rx += colWidths.measures;

      // PPE
      const ppeText = Array.isArray(hazard.ppe) ? hazard.ppe.slice(0, 2).join(", ") : (hazard.ppe || "");
      doc.font("Helvetica").fontSize(5).fillColor(c.info)
         .text(ppeText.substring(0, 35), rx + 2, y + 4, { width: colWidths.ppe - 4 });
      rx += colWidths.ppe;

      // Actions
      doc.font("Helvetica").fontSize(5).fillColor(c.text)
         .text((hazard.actions || "").substring(0, 50), rx + 2, y + 4, { width: colWidths.actions - 4 });
      rx += colWidths.actions;

      // Responsible
      doc.font("Helvetica").fontSize(5).fillColor(c.text)
         .text(hazard.responsible || "Tous", rx + 2, y + 12, { width: colWidths.resp - 4, align: "center" });
      rx += colWidths.resp;

      // G final
      const gf = hazard.gf || gi;
      const pf = hazard.pf || Math.max(1, pi - 1);
      const nirf = gf * pf;
      doc.roundedRect(rx + 3, y + 8, 22, 16, 2).fill(getGravityColor(gf));
      doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
         .text(String(gf), rx + 3, y + 11, { width: 22, align: "center" });
      rx += colWidths.gf;

      // P final
      doc.roundedRect(rx + 3, y + 8, 22, 16, 2).fill(getGravityColor(pf));
      doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
         .text(String(pf), rx + 3, y + 11, { width: 22, align: "center" });
      rx += colWidths.pf;

      // NIR final
      doc.roundedRect(rx + 2, y + 8, 28, 16, 2).fill(getRiskColor(nirf));
      doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
         .text(String(nirf), rx + 2, y + 11, { width: 28, align: "center" });

      y += rowH;
      rowCount++;
    }
  }

  // === RISK SCALES ===
  y = Math.max(y + 10, maxTableY - 60);
  const scaleW = (col1W - 20) / 2;

  // Gravity scale
  doc.rect(margin, y, scaleW, 16).fill(c.info);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white).text("GRAVITÉ (G)", margin + 5, y + 4);
  y += 16;

  // Use official RAMS scales from Annexe 4
  const gravityScale = [
    { level: 5, label: "Catastrophique", desc: "Mortalité", color: c.darkRed },
    { level: 4, label: "Critique", desc: "Incap. perm.", color: c.danger },
    { level: 3, label: "Grave", desc: "Incap. temp.", color: c.orange },
    { level: 2, label: "Important", desc: "Perte temps", color: c.warning },
    { level: 1, label: "Mineure", desc: "1ers soins", color: c.success },
  ];

  gravityScale.forEach((g, i) => {
    const sw = scaleW / 5;
    doc.rect(margin + i * sw, y, sw, 32).fillAndStroke(g.color, c.border);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(c.white)
       .text(String(g.level), margin + i * sw, y + 2, { width: sw, align: "center" });
    doc.fontSize(5).text(g.label, margin + i * sw, y + 15, { width: sw, align: "center" });
    doc.fontSize(4).fillColor("#ffffff99").text(g.desc, margin + i * sw, y + 23, { width: sw, align: "center" });
  });

  // Probability scale (Réf. Annexe 4)
  const probX = margin + scaleW + 20;
  doc.rect(probX, y - 16, scaleW, 16).fill(c.primary);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white).text("PROBABILITÉ (P) - Réf. Annexe 4", probX + 5, y - 12);

  const probScale = [
    { level: 5, label: "Très probable", desc: "0 mesure", color: c.darkRed },
    { level: 4, label: "Probable", desc: "EPI seuls", color: c.danger },
    { level: 3, label: "Possible", desc: "Prévention", color: c.orange },
    { level: 2, label: "Peu probable", desc: "Ctrl tech.", color: c.warning },
    { level: 1, label: "Improbable", desc: "Éliminé", color: c.success },
  ];

  probScale.forEach((p, i) => {
    const sw = scaleW / 5;
    doc.rect(probX + i * sw, y, sw, 32).fillAndStroke(p.color, c.border);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(c.white)
       .text(String(p.level), probX + i * sw, y + 2, { width: sw, align: "center" });
    doc.fontSize(5).text(p.label, probX + i * sw, y + 15, { width: sw, align: "center" });
    doc.fontSize(4).fillColor("#ffffff99").text(p.desc, probX + i * sw, y + 23, { width: sw, align: "center" });
  });

  // === RIGHT COLUMN (SIDE PANEL) ===
  let ry = headerH + 8;

  // Photos section (NO EMOJI)
  doc.rect(col2X, ry, col2W, 18).fill(c.primary);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white).text("PHOTOS DES ETAPES", col2X + 8, ry + 4);
  ry += 20;

  const photoBoxW = (col2W - 15) / 2;
  const photoBoxH = 95;
  let photoCol = 0;
  let photosPlaced = 0;

  for (let i = 0; i < steps.length && photosPlaced < 6 && ry + photoBoxH < pageHeight - 200; i++) {
    const step = steps[i];
    if (!step.photo_content && !step.photo_path) continue;

    const px = col2X + photoCol * (photoBoxW + 10);
    doc.roundedRect(px, ry, photoBoxW, photoBoxH, 5).fillAndStroke(c.white, c.border);

    // Step badge
    doc.circle(px + 12, ry + 12, 9).fill(c.primary);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white)
       .text(String(step.step_number), px + 7, ry + 8, { width: 10, align: "center" });

    // Photo
    const imgX = px + 5, imgY = ry + 22, imgW = photoBoxW - 10, imgH = photoBoxH - 40;
    let photoOk = false;

    if (step.photo_content) {
      try {
        doc.image(step.photo_content, imgX, imgY, { fit: [imgW, imgH], align: "center", valign: "center" });
        photoOk = true;
      } catch (e) { console.log("[RAMS] Photo content error:", e.message); }
    }

    if (!photoOk && step.photo_path) {
      try {
        const imgPath = path.join(PHOTOS_DIR, path.basename(step.photo_path));
        if (fs.existsSync(imgPath)) {
          doc.image(imgPath, imgX, imgY, { fit: [imgW, imgH], align: "center", valign: "center" });
          photoOk = true;
        }
      } catch (e) { console.log("[RAMS] Photo path error:", e.message); }
    }

    if (!photoOk) {
      doc.rect(imgX, imgY, imgW, imgH).fill(c.lightBg);
      doc.fontSize(7).fillColor(c.lightText).text("Photo N/A", imgX + 5, imgY + imgH/2 - 5);
    }

    doc.font("Helvetica").fontSize(6).fillColor(c.text)
       .text(step.title.substring(0, 25), px + 3, ry + photoBoxH - 15, { width: photoBoxW - 6, align: "center" });

    photosPlaced++;
    photoCol++;
    if (photoCol >= 2) { photoCol = 0; ry += photoBoxH + 8; }
  }

  if (photosPlaced === 0) {
    doc.rect(col2X, ry, col2W, 60).fillAndStroke(c.lightBg, c.border);
    doc.fontSize(8).fillColor(c.lightText).text("Aucune photo disponible", col2X + 10, ry + 25);
    ry += 65;
  } else if (photoCol !== 0) {
    ry += photoBoxH + 8;
  }

  // EPI Section (NO EMOJI)
  ry += 5;
  doc.rect(col2X, ry, col2W, 18).fill(c.warning);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white).text("EPI OBLIGATOIRES", col2X + 8, ry + 4);
  ry += 18;

  const ppeList = procedure.ppe_required || [];
  const ppeH = Math.min(90, Math.max(45, ppeList.length * 11 + 10));
  doc.rect(col2X, ry, col2W, ppeH).fillAndStroke(c.lightBg, c.border);
  doc.font("Helvetica").fontSize(7).fillColor(c.text);
  ppeList.slice(0, 8).forEach((ppe, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    doc.text("☑ " + ppe, col2X + 5 + col * (col2W / 2), ry + 5 + row * 11, { width: col2W / 2 - 10 });
  });
  ry += ppeH + 5;

  // Safety Codes (NO EMOJI)
  doc.rect(col2X, ry, col2W, 18).fill(c.info);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white).text("CONSIGNES SECURITE", col2X + 8, ry + 4);
  ry += 18;

  const safetyCodes = procedure.safety_codes || [];
  const scH = Math.min(55, Math.max(35, safetyCodes.length * 12 + 8));
  doc.rect(col2X, ry, col2W, scH).fillAndStroke(c.lightBg, c.border);
  doc.font("Helvetica").fontSize(7).fillColor(c.text);
  safetyCodes.slice(0, 4).forEach((code, i) => {
    doc.text("▸ " + code, col2X + 5, ry + 5 + i * 12, { width: col2W - 10 });
  });
  ry += scH + 5;

  // Emergency Contacts (NO EMOJI)
  const contacts = procedure.emergency_contacts || [];
  if (contacts.length > 0) {
    doc.rect(col2X, ry, col2W, 18).fill(c.danger);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white).text("CONTACTS URGENCE", col2X + 8, ry + 4);
    ry += 18;
    const contactH = Math.min(contacts.length * 18 + 8, 60);
    doc.rect(col2X, ry, col2W, contactH).fillAndStroke("#fef2f2", c.danger);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(c.danger);
    contacts.slice(0, 3).forEach((contact, i) => {
      doc.text(`${contact.name}: ${contact.phone}`, col2X + 8, ry + 6 + i * 18, { width: col2W - 16 });
    });
    ry += contactH + 5;
  }

  // Risk Summary (NO EMOJI)
  const summaryY = Math.max(ry, pageHeight - 85);
  doc.rect(col2X, summaryY, col2W, 60).fillAndStroke(c.darkBlue, c.border);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white).text("SYNTHESE RISQUE", col2X + 8, summaryY + 5);

  // Calculate summary from AI analysis
  let maxNirInitial = 0, maxNirFinal = 0, totalHazards = 0;
  if (aiAnalysis?.steps) {
    aiAnalysis.steps.forEach(step => {
      (step.hazards || []).forEach(h => {
        const niri = (h.gi || h.gravity || 2) * (h.pi || h.probability || 2);
        const nirf = (h.gf || h.gi || 2) * (h.pf || 1);
        if (niri > maxNirInitial) maxNirInitial = niri;
        if (nirf > maxNirFinal) maxNirFinal = nirf;
        totalHazards++;
      });
    });
  }

  doc.font("Helvetica").fontSize(7).fillColor("#a5b4fc");
  doc.text(`Dangers identifiés: ${totalHazards}`, col2X + 8, summaryY + 20);
  doc.text(`NIR max initial: ${maxNirInitial}`, col2X + 8, summaryY + 32);
  doc.text(`NIR max résiduel: ${maxNirFinal}`, col2X + 8, summaryY + 44);

  if (maxNirInitial > 0) {
    const reduction = Math.round((1 - maxNirFinal / maxNirInitial) * 100);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(c.success)
       .text(`Réduction: ${reduction}%`, col2X + col2W / 2, summaryY + 44);
  }

  // === FOOTER ===
  const footerY = pageHeight - 20;
  doc.rect(0, footerY, pageWidth, 20).fill(c.headerBg);

  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.headerText);
  doc.text(siteSettings.company_name || "ElectroHub", margin, footerY + 6);
  doc.text(`RAMS - ${procedure.title} - v${procedure.version || 1}`, pageWidth / 2 - 100, footerY + 6, { width: 200, align: "center" });
  doc.text(`${new Date().toLocaleString("fr-FR")} | ID: ${procedureId.substring(0, 8)}`, pageWidth - margin - 180, footerY + 6, { width: 180, align: "right" });

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
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

// --- CATEGORIES (MUST be before /:id route) ---

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

// --- ACTION LISTS (MUST be before /:id route) ---

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

// --- SEARCH EQUIPMENT (MUST be before /:id route) ---

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

// API Endpoint: Generate Example Method Statement PDF
// IMPORTANT: This route MUST be defined BEFORE /api/procedures/:id to avoid UUID parse error
app.get("/api/procedures/example-method-statement-pdf", async (req, res) => {
  try {
    console.log("[RAMS] Generating example Method Statement PDF...");

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "electrohub.app";
    const baseUrl = `${protocol}://${host}`;

    const pdfBuffer = await generateExampleMethodStatementPDF(baseUrl);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="RAMS_Exemple_ATEX_${new Date().toISOString().split("T")[0]}.pdf"`
    );

    console.log("[RAMS] Example PDF generated successfully");
    res.end(pdfBuffer);
  } catch (err) {
    console.error("[RAMS] Error generating example PDF:", err);
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Generate Example Method Statement (returns procedure data)
// IMPORTANT: This route MUST be defined BEFORE /api/procedures/:id to avoid UUID parse error
app.post("/api/procedures/generate-example-method-statement", async (req, res) => {
  try {
    // Return the example data structure for display/editing
    res.json({
      success: true,
      data: EXAMPLE_RAMS_DATA,
      message: "Exemple RAMS ATEX généré avec succès"
    });
  } catch (err) {
    console.error("Error generating example:", err);
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Generate Example Work Method PDF (A4)
app.get("/api/procedures/example-work-method-pdf", async (req, res) => {
  try {
    console.log("[Work Method] Generating example Work Method PDF...");

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "electrohub.app";
    const baseUrl = `${protocol}://${host}`;

    const pdfBuffer = await generateExampleWorkMethodPDF(baseUrl);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Methode_Travail_Exemple_${new Date().toISOString().split("T")[0]}.pdf"`
    );

    console.log("[Work Method] Example PDF generated successfully");
    res.end(pdfBuffer);
  } catch (err) {
    console.error("[Work Method] Error generating example PDF:", err);
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Generate Example Procedure PDF (A4)
app.get("/api/procedures/example-procedure-pdf", async (req, res) => {
  try {
    console.log("[Procedure] Generating example Procedure PDF...");

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "electrohub.app";
    const baseUrl = `${protocol}://${host}`;

    const pdfBuffer = await generateExampleProcedurePDF(baseUrl);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Procedure_Exemple_${new Date().toISOString().split("T")[0]}.pdf"`
    );

    console.log("[Procedure] Example PDF generated successfully");
    res.end(pdfBuffer);
  } catch (err) {
    console.error("[Procedure] Error generating example PDF:", err);
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Download all 3 documents as ZIP
app.get("/api/procedures/example-all-documents", async (req, res) => {
  try {
    console.log("[Documents] Generating all example documents...");

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "electrohub.app";
    const baseUrl = `${protocol}://${host}`;

    // Generate all 3 PDFs
    const [ramsPdf, workMethodPdf, procedurePdf] = await Promise.all([
      generateExampleMethodStatementPDF(baseUrl),
      generateExampleWorkMethodPDF(baseUrl),
      generateExampleProcedurePDF(baseUrl)
    ]);

    // Create ZIP archive
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Documentation_Complete_${new Date().toISOString().split("T")[0]}.zip"`
    );

    archive.pipe(res);

    const dateStr = new Date().toISOString().split("T")[0];
    archive.append(ramsPdf, { name: `RAMS_${dateStr}.pdf` });
    archive.append(workMethodPdf, { name: `Methode_Travail_${dateStr}.pdf` });
    archive.append(procedurePdf, { name: `Procedure_${dateStr}.pdf` });

    await archive.finalize();

    console.log("[Documents] All documents generated successfully");
  } catch (err) {
    console.error("[Documents] Error generating documents:", err);
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
    const site = req.headers["x-site"] || req.query.site;

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
    const conversation = session.conversation || [];

    // Extract photos from conversation (user messages with photos)
    const conversationPhotos = conversation
      .filter(msg => msg.role === 'user' && msg.photo)
      .map(msg => msg.photo);

    console.log(`[Procedures] Finalize: Found ${conversationPhotos.length} photos in conversation`);

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
        data.site || site,
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

    // Add steps with photos
    if (data.steps && data.steps.length > 0) {
      for (let i = 0; i < data.steps.length; i++) {
        const step = data.steps[i];
        let photoContent = null;
        let photoPath = null;

        // Try to link a photo to this step
        // Use photo from step data if available, otherwise use conversation photo
        if (step.photo) {
          photoPath = step.photo;
        } else if (conversationPhotos[i]) {
          photoPath = conversationPhotos[i];
        }

        // Read photo content if we have a path
        if (photoPath) {
          try {
            const fullPath = path.join(PHOTOS_DIR, path.basename(photoPath));
            if (fs.existsSync(fullPath)) {
              photoContent = await fsp.readFile(fullPath);
              console.log(`[Procedures] Step ${i + 1}: Loaded photo ${photoPath}`);
            }
          } catch (e) {
            console.log(`[Procedures] Could not read photo for step ${i + 1}:`, e.message);
          }
        }

        await pool.query(
          `INSERT INTO procedure_steps
           (procedure_id, step_number, title, description, instructions, warning, duration_minutes, photo_path, photo_content)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            procedure.id,
            i + 1,
            step.title,
            step.description,
            step.instructions,
            step.warning,
            step.duration_minutes,
            photoPath,
            photoContent,
          ]
        );
      }
    } else if (conversationPhotos.length > 0) {
      // If no steps defined but we have photos, create steps from photos
      console.log(`[Procedures] Creating ${conversationPhotos.length} steps from photos`);
      for (let i = 0; i < conversationPhotos.length; i++) {
        const photoPath = conversationPhotos[i];
        let photoContent = null;

        try {
          const fullPath = path.join(PHOTOS_DIR, path.basename(photoPath));
          if (fs.existsSync(fullPath)) {
            photoContent = await fsp.readFile(fullPath);
          }
        } catch (e) {
          console.log(`[Procedures] Could not read photo ${i}:`, e.message);
        }

        await pool.query(
          `INSERT INTO procedure_steps
           (procedure_id, step_number, title, photo_path, photo_content)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            procedure.id,
            i + 1,
            `Étape ${i + 1}`,
            photoPath,
            photoContent,
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

// Generate Method Statement A3 Landscape PDF with QR Code
app.get("/api/procedures/:id/method-statement-pdf", async (req, res) => {
  try {
    const { id } = req.params;

    // Get base URL from request or use default
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "electrohub.app";
    const baseUrl = `${protocol}://${host}`;

    const pdfBuffer = await generateMethodStatementA3PDF(id, baseUrl);

    // Get procedure title for filename
    const { rows } = await pool.query(`SELECT title FROM procedures WHERE id = $1`, [id]);
    const title = rows[0]?.title || "method_statement";
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="method_statement_${safeTitle}_A3_${new Date().toISOString().split("T")[0]}.pdf"`
    );

    res.end(pdfBuffer);
  } catch (err) {
    console.error("Error generating Method Statement PDF:", err);
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

    const result = await chatWithFallback(messages, {
      temperature: 0.5,
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });

    const aiResponse = parseAIJson(result.content);

    // Save conversation
    await pool.query(
      `UPDATE procedure_ai_sessions SET conversation = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify([
        { role: "user", content: initialQuestion || "Début assistance" },
        { role: "assistant", ...aiResponse }
      ]), sessionId]
    );

    // Build step photos array
    const stepPhotos = steps
      .filter(s => s.photo_content || s.photo_path)
      .map(s => ({
        stepNumber: s.step_number,
        url: `/api/procedures/steps/${s.id}/photo`
      }));

    // Get current step photo if available
    const currentStep = steps.find(s => s.step_number === 1);
    const currentStepPhoto = currentStep && (currentStep.photo_content || currentStep.photo_path)
      ? `/api/procedures/steps/${currentStep.id}/photo`
      : null;

    res.json({
      sessionId,
      procedureTitle: procedure.title,
      totalSteps: steps.length,
      stepPhotos,
      currentStepPhoto,
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
      // Analyze photo with Vision (fallback to Gemini)
      const photoBuffer = await fsp.readFile(req.file.path);
      const base64Image = photoBuffer.toString('base64');

      const visionMessages = [
        {
          role: "user",
          content: [
            { type: "text", text: `Analyse cette photo dans le contexte de l'étape ${collectedData.currentStepNumber || 1} de la procédure "${session.procedure_title}". L'utilisateur doit faire: ${steps[collectedData.currentStepNumber - 1]?.instructions || 'suivre les instructions'}. Est-ce correct ? Y a-t-il des problèmes de sécurité ?` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ];
      const visionResult = await chatWithFallback(visionMessages, { model: "gpt-4o", max_tokens: 500 });

      photoAnalysis = visionResult.content;
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

    const result = await chatWithFallback(messages, {
      temperature: 0.5,
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });

    const aiResponse = parseAIJson(result.content);

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

    // Get current step photo based on AI response
    const currentStepNum = aiResponse.currentStepNumber || newCollectedData.currentStepNumber || 1;
    const currentStep = steps.find(s => s.step_number === currentStepNum);
    const currentStepPhoto = currentStep && (currentStep.photo_content || currentStep.photo_path)
      ? `/api/procedures/steps/${currentStep.id}/photo`
      : null;

    res.json({
      ...aiResponse,
      photoAnalysis,
      totalSteps: steps.length,
      currentStepPhoto
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

    const visionMessages = [
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
    ];
    const result = await chatWithFallback(visionMessages, { model: "gpt-4o", max_tokens: 1000 });

    await fsp.unlink(req.file.path).catch(() => {});

    res.json({
      analysis: result.content,
      success: true
    });
  } catch (err) {
    console.error("Error analyzing photo:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// EXAMPLE METHOD STATEMENT - Based on RAMS_B20_ATEX Excel Template
// Professional RAMS format with complete AI-generated risk analysis
// ------------------------------

// Example data structure based on RAMS_B20_ATEX_Box117_Box110.xlsx
const EXAMPLE_RAMS_DATA = {
  activity: "Remplacement de matériel ATEX non conforme (B20 Box 117) + ajout mises à terre (B20 Box 110)",
  category: "Maintenance électrique",
  workDate: new Date().toLocaleDateString("fr-FR"),
  workTime: "07h00 – 16h30",
  workers: 2,
  company: "ElectroHub",
  approver: "Daniel Palha",
  riskLevel: "medium",
  version: 1,
  steps: [
    {
      number: 1,
      title: "Accès et préparation chantier (B20 – Box 117 / Box 110)",
      hazards: [
        {
          checkbox: "Accès / circulation",
          danger: "Déplacements dans la zone : risque de trébucher/glisser, heurt avec engins ou piétons.",
          gi: 3, pi: 2,
          measures: "Briefing sécurité + repérage. Maintenir cheminement dégagé, rangement permanent, éclairage suffisant.",
          ppe: ["Chaussures de sécurité S3", "Gilet haute visibilité"],
          actions: "Rester sur cheminements autorisés. Balisage si proximité d'une voie.",
          responsible: "Chef d'équipe",
          gf: 3, pf: 1
        },
        {
          checkbox: "Coactivité",
          danger: "Coactivité avec autres intervenants : interférences, intrusion dans la zone de travail.",
          gi: 3, pi: 3,
          measures: "Coordination avec responsable de zone. Informer les parties prenantes.",
          ppe: ["Gilet haute visibilité", "Casque de sécurité"],
          actions: "Définir zones interdites, respecter les consignes site.",
          responsible: "Superviseur",
          gf: 3, pf: 1
        },
        {
          checkbox: "Manutention / TMS",
          danger: "Manutention du matériel : postures contraignantes, charges, pincements.",
          gi: 2, pi: 3,
          measures: "Techniques de levage appropriées. Utiliser aides mécaniques si > 15kg.",
          ppe: ["Gants de manutention"],
          actions: "Formation gestes et postures. Pauses régulières.",
          responsible: "Tous",
          gf: 2, pf: 1
        }
      ]
    },
    {
      number: 2,
      title: "Consignation électrique ATEX",
      hazards: [
        {
          checkbox: "Électrique - ATEX",
          danger: "Risque d'électrocution lors de la consignation. Arc électrique potentiel.",
          gi: 5, pi: 3,
          measures: "Procédure LOTO stricte. Vérification VAT. Cadenas personnel.",
          ppe: ["Gants isolants classe 00", "Écran facial arc", "Vêtements ARC 8 cal/cm²"],
          actions: "Identifier tous points de coupure. Afficher pancarte CONSIGNÉ. Test VAT avant intervention.",
          responsible: "Électricien habilité",
          gf: 5, pf: 1
        },
        {
          checkbox: "Risque ATEX",
          danger: "Zone ATEX : risque d'inflammation en cas d'étincelle ou source de chaleur.",
          gi: 5, pi: 2,
          measures: "Vérification atmosphère (explosimètre). Outillage certifié ATEX. Pas de flamme nue.",
          ppe: ["Vêtements antistatiques", "Chaussures ESD"],
          actions: "Contrôle explosimètre avant et pendant travaux. Permis de feu si nécessaire.",
          responsible: "Chef d'équipe",
          gf: 5, pf: 1
        }
      ]
    },
    {
      number: 3,
      title: "Dépose ancien matériel Box 117",
      hazards: [
        {
          checkbox: "Coupures / projections",
          danger: "Risque de coupure lors de manipulations/outillage ; projections lors de dépose.",
          gi: 3, pi: 3,
          measures: "Utiliser outillage adapté. Protéger les yeux. Zone de travail dégagée.",
          ppe: ["Lunettes de protection", "Gants anti-coupures"],
          actions: "Inspecter outillage avant usage. Évacuer débris immédiatement.",
          responsible: "Technicien",
          gf: 3, pf: 1
        },
        {
          checkbox: "Chute d'objets",
          danger: "Chute d'outils/visserie/matériel pendant la dépose.",
          gi: 3, pi: 3,
          measures: "Utiliser bac de rétention. Attacher outils en hauteur. Zone balisée en dessous.",
          ppe: ["Casque de sécurité"],
          actions: "Vérifier fixation avant démontage. Communiquer avec équipier.",
          responsible: "Tous",
          gf: 3, pf: 1
        }
      ]
    },
    {
      number: 4,
      title: "Installation du nouveau matériel ATEX",
      hazards: [
        {
          checkbox: "Électrique - ATEX",
          danger: "Risques électriques lors du câblage. Non-conformité installation ATEX.",
          gi: 5, pi: 3,
          measures: "Vérifier certification ATEX du matériel. Serrage au couple. Test isolement.",
          ppe: ["Gants isolants", "Lunettes de protection"],
          actions: "Contrôle visuel composants. Mesures d'isolement. Documentation complète.",
          responsible: "Électricien ATEX",
          gf: 5, pf: 1
        },
        {
          checkbox: "Ergonomie",
          danger: "Postures contraignantes lors de l'installation en espace confiné.",
          gi: 2, pi: 3,
          measures: "Aménager poste de travail. Alterner les tâches. Micro-pauses.",
          ppe: ["Genouillères si nécessaire"],
          actions: "Adapter la position. Utiliser support/établi mobile.",
          responsible: "Tous",
          gf: 2, pf: 1
        }
      ]
    },
    {
      number: 5,
      title: "Ajout mises à terre (Box 110)",
      hazards: [
        {
          checkbox: "Électrique",
          danger: "Contact avec conducteurs lors du raccordement terre. Défaut d'équipotentialité.",
          gi: 4, pi: 3,
          measures: "Vérifier hors tension. Utiliser connecteurs appropriés. Test continuité.",
          ppe: ["Gants isolants", "VAT"],
          actions: "Mesurer résistance terre < 10Ω. Documenter points de raccordement.",
          responsible: "Électricien habilité",
          gf: 4, pf: 1
        },
        {
          checkbox: "Perçage / Poussières",
          danger: "Projections lors du perçage pour fixation. Poussières métalliques.",
          gi: 2, pi: 3,
          measures: "Lunettes obligatoires. Aspiration si possible. Masque FFP2.",
          ppe: ["Lunettes de protection", "Masque FFP2", "Protections auditives"],
          actions: "Percer à vitesse adaptée. Nettoyer immédiatement les copeaux.",
          responsible: "Technicien",
          gf: 2, pf: 1
        }
      ]
    },
    {
      number: 6,
      title: "Déconsignation et tests",
      hazards: [
        {
          checkbox: "Électrique",
          danger: "Remise sous tension prématurée. Erreur de manipulation lors des tests.",
          gi: 5, pi: 2,
          measures: "Procédure de déconsignation stricte. Vérifier absence de personnel dans la zone.",
          ppe: ["Gants isolants", "Écran facial"],
          actions: "Communication claire avant remise tension. Tests progressifs. Mesures électriques.",
          responsible: "Électricien habilité",
          gf: 5, pf: 1
        },
        {
          checkbox: "Arc électrique",
          danger: "Risque d'arc flash lors de la première mise sous tension.",
          gi: 5, pi: 2,
          measures: "Distance de sécurité. Équipement ARC. Fermeture armoire avant tension.",
          ppe: ["Vêtements ARC", "Écran facial ARC"],
          actions: "Respecter périmètre arc flash. Procédure de mise sous tension sécurisée.",
          responsible: "Chef d'équipe",
          gf: 5, pf: 1
        }
      ]
    },
    {
      number: 7,
      title: "Repli et nettoyage",
      hazards: [
        {
          checkbox: "Glissade / Chute",
          danger: "Sol glissant après nettoyage. Encombrement des passages.",
          gi: 2, pi: 2,
          measures: "Nettoyage méthodique. Rangement au fur et à mesure. Signaler sol mouillé.",
          ppe: ["Chaussures de sécurité"],
          actions: "Évacuer déchets correctement (tri ATEX). Vérification finale zone.",
          responsible: "Tous",
          gf: 2, pf: 1
        },
        {
          checkbox: "Organisation",
          danger: "Oubli de matériel. Documentation incomplète.",
          gi: 2, pi: 2,
          measures: "Check-list de repli. Inventaire outillage. Rapport d'intervention.",
          ppe: [],
          actions: "Compléter documentation. Signature rapport. Transmission au client.",
          responsible: "Chef d'équipe",
          gf: 2, pf: 1
        }
      ]
    }
  ],
  ppeRequired: [
    "Casque de sécurité",
    "Lunettes de protection",
    "Gants isolants classe 00",
    "Chaussures de sécurité S3 ESD",
    "Vêtements antistatiques",
    "Gilet haute visibilité",
    "Protections auditives",
    "Écran facial ARC"
  ],
  safetyCodes: [
    "Permis de travail ATEX obligatoire",
    "Procédure LOTO à respecter",
    "Contrôle explosimètre avant intervention",
    "Habilitation électrique B2V-BR minimum"
  ],
  emergencyContacts: [
    { name: "Urgences site", phone: "118 / 144" },
    { name: "Responsable HSE", phone: "+41 79 XXX XX XX" },
    { name: "Électricien astreinte", phone: "+41 79 XXX XX XX" }
  ]
};

// Generate Example Method Statement PDF - Complete RAMS format
async function generateExampleMethodStatementPDF(baseUrl = 'https://electrohub.app') {
  const data = EXAMPLE_RAMS_DATA;

  // Generate QR Code - Links to AI assistant for this procedure
  const docRef = `RAMS-${data.workDate.replace(/\//g, '')}`;
  let qrCodeBuffer = null;
  try {
    // QR Code links to the AI assistant page with procedure context
    qrCodeBuffer = await QRCode.toBuffer(`${baseUrl}/procedures/ai-assistant?ref=${docRef}&type=rams`, {
      width: 80, margin: 1, color: { dark: '#1e1b4b', light: '#ffffff' }
    });
  } catch (e) {
    console.log("[RAMS Example] QR code error:", e.message);
  }

  // === PDF SETUP - A3 LANDSCAPE ===
  const pageWidth = 1190.55;
  const pageHeight = 841.89;
  const margin = 15;

  const doc = new PDFDocument({
    size: [pageWidth, pageHeight],
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `RAMS Exemple - ${data.activity}`,
      Author: data.company,
      Subject: "Risk Assessment Method Statement - Exemple ATEX",
      Creator: "ElectroHub RAMS Generator v2",
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  // Colors - Using company green #30EA03 for header
  const c = {
    headerBg: "#30EA03",      // Vert entreprise
    headerText: "#000000",     // Texte noir sur vert
    primary: "#7c3aed",
    danger: "#dc2626",
    warning: "#f59e0b",
    success: "#16a34a",
    info: "#2563eb",
    text: "#1f2937",
    lightText: "#6b7280",
    lightBg: "#f8fafc",
    border: "#d1d5db",
    white: "#ffffff",
    darkRed: "#7f1d1d",
    orange: "#ea580c",
    darkBlue: "#1e1b4b",
  };

  // Risk color function
  const getRiskColor = (nir) => {
    if (nir >= 15) return c.darkRed;
    if (nir >= 10) return c.danger;
    if (nir >= 5) return c.warning;
    return c.success;
  };

  const getGravityColor = (g) => {
    if (g >= 5) return c.darkRed;
    if (g >= 4) return c.danger;
    if (g >= 3) return c.orange;
    if (g >= 2) return c.warning;
    return c.success;
  };

  // === LAYOUT CONSTANTS - Fixed proportions to avoid overlap ===
  const contentW = pageWidth - margin * 2;
  const sidebarW = 260;  // Fixed sidebar width
  const tableW = contentW - sidebarW - 20;  // Table width with gap
  const sidebarX = margin + tableW + 20;  // Sidebar position

  // === PAGE 1: HEADER + RISK TABLE ===

  // Header background - GREEN #30EA03 - Increased height for better layout
  const headerH = 75;
  doc.rect(0, 0, pageWidth, headerH).fill(c.headerBg);

  // Left section: Company + RAMS badge
  doc.font("Helvetica-Bold").fontSize(16).fillColor(c.headerText)
     .text(data.company.toUpperCase(), margin + 5, 8);

  // RAMS badge (renamed from METHOD STATEMENT)
  doc.roundedRect(margin + 5, 28, 70, 20, 4).fill(c.darkBlue);
  doc.fontSize(10).fillColor(c.white).text("RAMS", margin + 22, 33);

  // Document reference under badge
  doc.font("Helvetica").fontSize(7).fillColor("#1a5c00")
     .text(`Ref: RAMS-${data.workDate.replace(/\//g, '')}`, margin + 5, 52);

  // Center section: Main title (properly positioned, no overlap)
  const titleStartX = 200;
  const titleEndX = pageWidth - 250;
  const titleW = titleEndX - titleStartX;

  doc.font("Helvetica-Bold").fontSize(11).fillColor(c.headerText)
     .text(data.activity.toUpperCase(), titleStartX, 6, { width: titleW, align: "center" });

  // Subtitle info on separate lines
  doc.font("Helvetica").fontSize(8).fillColor("#1a5c00")
     .text(`Activite: ${data.category}`, titleStartX, 24, { width: titleW, align: "center" });
  doc.fontSize(7).fillColor("#2d7a00")
     .text(`Date: ${data.workDate} | Heure: ${data.workTime}`, titleStartX, 38, { width: titleW, align: "center" });
  doc.fontSize(7).fillColor("#2d7a00")
     .text(`Version ${data.version} | ${data.workers} collaborateur(s)`, titleStartX, 50, { width: titleW, align: "center" });

  // Document links indicator
  doc.font("Helvetica").fontSize(6).fillColor(c.headerText)
     .text("Documents lies: RAMS | Methode de Travail | Procedure", titleStartX, 62, { width: titleW, align: "center" });

  // Right section: Risk badge + QR Code
  const riskColors = { low: c.success, medium: c.warning, high: c.danger, critical: c.darkRed };
  const riskLabels = { low: "FAIBLE", medium: "MODERE", high: "ELEVE", critical: "CRITIQUE" };
  doc.roundedRect(pageWidth - 170, 6, 70, 44, 5).fill(riskColors[data.riskLevel]);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.white).text("RISQUE", pageWidth - 165, 12, { width: 60, align: "center" });
  doc.fontSize(11).text(riskLabels[data.riskLevel], pageWidth - 165, 26, { width: 60, align: "center" });

  // QR Code - Fixed URL to AI assistant
  if (qrCodeBuffer) {
    try {
      doc.image(qrCodeBuffer, pageWidth - margin - 60, 8, { width: 48 });
      doc.font("Helvetica").fontSize(5).fillColor(c.headerText)
         .text("Scanner pour", pageWidth - margin - 60, 58, { width: 48, align: "center" });
      doc.text("assistant IA", pageWidth - margin - 60, 64, { width: 48, align: "center" });
    } catch (e) {}
  }

  // === CONTENT SECTION ===
  let y = headerH + 8;

  // === REGULATORY NOTE ===
  doc.roundedRect(margin, y, tableW, 30, 3).fillAndStroke("#fef3c7", c.warning);
  doc.font("Helvetica").fontSize(6).fillColor(c.text)
     .text("Reglementation: Les jeunes de 13/18 ans doivent respecter les exigences reglementaires (OLT5). Les entreprises externes doivent detenir une autorisation de travail valide. Zone ATEX - Respect strict des procedures anti-explosion.", margin + 8, y + 4, { width: tableW - 16 });
  doc.font("Helvetica-Bold").fontSize(6).fillColor(c.danger)
     .text("! REVUE OBLIGATOIRE Construction Safety si NIR > 9 post mitigation", margin + 8, y + 18, { width: tableW - 16 });
  y += 35;

  // === MAIN RISK TABLE HEADER ===
  doc.rect(margin, y, tableW, 18).fill(c.danger);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
     .text("ANALYSE DES RISQUES - METHODOLOGIE ET IDENTIFICATION DES DANGERS", margin + 10, y + 4);
  y += 18;

  // Table column headers - matching Excel structure
  const tableHeaderH = 32;

  // Define columns (proportional to fit within tableW)
  const colWidths = {
    n: 25,
    task: tableW * 0.12,
    danger: tableW * 0.15,
    gi: 24,
    pi: 24,
    niri: 28,
    measures: tableW * 0.16,
    ppe: tableW * 0.10,
    actions: tableW * 0.11,
    resp: 42,
    gf: 24,
    pf: 24,
    nirf: 28
  };

  // Header row 1 - Evaluation labels
  doc.rect(margin, y, tableW, 14).fill(c.lightBg).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(6).fillColor(c.text);

  let hx = margin + colWidths.n + colWidths.task + colWidths.danger;
  doc.text("EVALUATION INITIALE", hx, y + 4, { width: colWidths.gi + colWidths.pi + colWidths.niri, align: "center" });
  hx += colWidths.gi + colWidths.pi + colWidths.niri + colWidths.measures + colWidths.ppe + colWidths.actions + colWidths.resp;
  doc.text("EVALUATION FINALE", hx, y + 4, { width: colWidths.gf + colWidths.pf + colWidths.nirf, align: "center" });
  y += 14;

  // Header row 2 - Column names
  doc.rect(margin, y, tableW, tableHeaderH - 14).fill(c.lightBg).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(5).fillColor(c.text);

  const headers = [
    { label: "N", w: colWidths.n },
    { label: "TACHE / ACTIVITE", w: colWidths.task },
    { label: "DANGER - SCENARIO", w: colWidths.danger },
    { label: "G", w: colWidths.gi },
    { label: "P", w: colWidths.pi },
    { label: "NIR", w: colWidths.niri },
    { label: "MESURES PREVENTIVES", w: colWidths.measures },
    { label: "EPI", w: colWidths.ppe },
    { label: "ACTIONS DETAILLEES", w: colWidths.actions },
    { label: "RESP.", w: colWidths.resp },
    { label: "G", w: colWidths.gf },
    { label: "P", w: colWidths.pf },
    { label: "NIR", w: colWidths.nirf }
  ];

  hx = margin;
  headers.forEach((h, i) => {
    const align = i < 3 || (i >= 6 && i < 10) ? "left" : "center";
    doc.text(h.label, hx + 2, y + 4, { width: h.w - 4, align });
    if (i < headers.length - 1) {
      doc.moveTo(hx + h.w, y).lineTo(hx + h.w, y + tableHeaderH - 14).stroke(c.border);
    }
    hx += h.w;
  });
  y += tableHeaderH - 14;

  // === TABLE ROWS ===
  // For example RAMS, we know it fits on 1 page - no page breaks needed
  const maxTableY = pageHeight - 130; // Leave space for scales and signature
  let rowCount = 0;

  for (const step of data.steps) {
    // No page break for example - all content fits on one page

    for (let hi = 0; hi < step.hazards.length; hi++) {
      const hazard = step.hazards[hi];
      const isFirst = hi === 0;
      const rowH = 28;
      const isEven = rowCount % 2 === 0;

      doc.rect(margin, y, tableW, rowH).fillAndStroke(isEven ? c.white : c.lightBg, c.border);

      let rx = margin;

      // N (step number) - only on first hazard of step
      if (isFirst) {
        doc.circle(rx + colWidths.n / 2, y + rowH / 2, 9).fill(c.primary);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
           .text(String(step.number), rx + colWidths.n / 2 - 3, y + rowH / 2 - 4);
      }
      rx += colWidths.n;

      // Task/Activity
      doc.font("Helvetica-Bold").fontSize(5).fillColor(c.text);
      if (isFirst) {
        doc.text(step.title.substring(0, 35), rx + 2, y + 3, { width: colWidths.task - 4 });
      }
      rx += colWidths.task;

      // Danger with checkbox (no emoji, use simple checkbox)
      doc.font("Helvetica-Bold").fontSize(5).fillColor(c.danger)
         .text(`[x] ${hazard.checkbox}`, rx + 2, y + 2, { width: colWidths.danger - 4 });
      doc.font("Helvetica").fontSize(4.5).fillColor(c.text)
         .text(hazard.danger.substring(0, 65), rx + 2, y + 10, { width: colWidths.danger - 4 });
      rx += colWidths.danger;

      // G initial
      const niri = hazard.gi * hazard.pi;
      doc.roundedRect(rx + 2, y + 6, 20, 14, 2).fill(getGravityColor(hazard.gi));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
         .text(String(hazard.gi), rx + 2, y + 9, { width: 20, align: "center" });
      rx += colWidths.gi;

      // P initial
      doc.roundedRect(rx + 2, y + 6, 20, 14, 2).fill(getGravityColor(hazard.pi));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
         .text(String(hazard.pi), rx + 2, y + 9, { width: 20, align: "center" });
      rx += colWidths.pi;

      // NIR initial
      doc.roundedRect(rx + 1, y + 6, 26, 14, 2).fill(getRiskColor(niri));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
         .text(String(niri), rx + 1, y + 9, { width: 26, align: "center" });
      rx += colWidths.niri;

      // Measures
      doc.font("Helvetica").fontSize(4.5).fillColor(c.text)
         .text(hazard.measures.substring(0, 65), rx + 2, y + 3, { width: colWidths.measures - 4 });
      rx += colWidths.measures;

      // PPE
      doc.font("Helvetica").fontSize(4.5).fillColor(c.info)
         .text(hazard.ppe.slice(0, 2).join(", ").substring(0, 30), rx + 2, y + 3, { width: colWidths.ppe - 4 });
      rx += colWidths.ppe;

      // Actions
      doc.font("Helvetica").fontSize(4.5).fillColor(c.text)
         .text(hazard.actions.substring(0, 45), rx + 2, y + 3, { width: colWidths.actions - 4 });
      rx += colWidths.actions;

      // Responsible
      doc.font("Helvetica").fontSize(4.5).fillColor(c.text)
         .text(hazard.responsible, rx + 2, y + 10, { width: colWidths.resp - 4, align: "center" });
      rx += colWidths.resp;

      // G final
      const nirf = hazard.gf * hazard.pf;
      doc.roundedRect(rx + 2, y + 6, 20, 14, 2).fill(getGravityColor(hazard.gf));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
         .text(String(hazard.gf), rx + 2, y + 9, { width: 20, align: "center" });
      rx += colWidths.gf;

      // P final
      doc.roundedRect(rx + 2, y + 6, 20, 14, 2).fill(getGravityColor(hazard.pf));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
         .text(String(hazard.pf), rx + 2, y + 9, { width: 20, align: "center" });
      rx += colWidths.pf;

      // NIR final
      doc.roundedRect(rx + 1, y + 6, 26, 14, 2).fill(getRiskColor(nirf));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(c.white)
         .text(String(nirf), rx + 1, y + 9, { width: 26, align: "center" });

      y += rowH;
      rowCount++;
    }
  }

  // === RISK SCALES ===
  y = Math.max(y + 8, maxTableY - 50);
  const scaleW = (tableW - 15) / 2;

  // Gravity scale
  doc.rect(margin, y, scaleW, 14).fill(c.info);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.white).text("GRAVITE (G)", margin + 5, y + 3);
  y += 14;

  // Use official RAMS scales from Annexe 4
  const gravityScale = [
    { level: 5, label: "Catastrophique", desc: "Mortalite", color: c.darkRed },
    { level: 4, label: "Critique", desc: "Incap. perm.", color: c.danger },
    { level: 3, label: "Grave", desc: "Incap. temp.", color: c.orange },
    { level: 2, label: "Important", desc: "Perte temps", color: c.warning },
    { level: 1, label: "Mineure", desc: "1ers soins", color: c.success },
  ];

  gravityScale.forEach((g, i) => {
    const sw = scaleW / 5;
    doc.rect(margin + i * sw, y, sw, 28).fillAndStroke(g.color, c.border);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(c.white)
       .text(String(g.level), margin + i * sw, y + 2, { width: sw, align: "center" });
    doc.fontSize(5).text(g.label, margin + i * sw, y + 14, { width: sw, align: "center" });
    doc.fontSize(4).text(g.desc, margin + i * sw, y + 21, { width: sw, align: "center" });
  });

  // Probability scale (Ref. Annexe 4)
  const probX = margin + scaleW + 15;
  doc.rect(probX, y - 14, scaleW, 14).fill(c.primary);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.white).text("PROBABILITE (P) - Ref. Annexe 4", probX + 5, y - 11);

  const probScale = [
    { level: 5, label: "Tres probable", desc: "0 mesure", color: c.darkRed },
    { level: 4, label: "Probable", desc: "EPI seuls", color: c.danger },
    { level: 3, label: "Possible", desc: "Prevention", color: c.orange },
    { level: 2, label: "Peu probable", desc: "Ctrl tech.", color: c.warning },
    { level: 1, label: "Improbable", desc: "Elimine", color: c.success },
  ];

  probScale.forEach((p, i) => {
    const sw = scaleW / 5;
    doc.rect(probX + i * sw, y, sw, 28).fillAndStroke(p.color, c.border);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(c.white)
       .text(String(p.level), probX + i * sw, y + 2, { width: sw, align: "center" });
    doc.fontSize(5).text(p.label, probX + i * sw, y + 14, { width: sw, align: "center" });
    doc.fontSize(4).text(p.desc, probX + i * sw, y + 21, { width: sw, align: "center" });
  });

  // === RIGHT COLUMN (SIDE PANEL) - Fixed position, no overlap ===
  let ry = headerH + 8;

  // Photos section header (NO EMOJI - simple text)
  doc.rect(sidebarX, ry, sidebarW, 16).fill(c.primary);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white).text("PHOTOS DES ETAPES", sidebarX + 8, ry + 4);
  ry += 18;

  // Photo grid with placeholder images (4 columns x 2 rows)
  const photoGridW = sidebarW - 8;
  const photoCols = 4;
  const photoRows = 2;
  const photoW = (photoGridW - (photoCols - 1) * 4) / photoCols;
  const photoH = 45;

  doc.rect(sidebarX, ry, sidebarW, photoRows * (photoH + 4) + 20).fillAndStroke(c.lightBg, c.border);

  // Draw placeholder photos for first 8 steps
  for (let row = 0; row < photoRows; row++) {
    for (let col = 0; col < photoCols; col++) {
      const stepIdx = row * photoCols + col;
      if (stepIdx < data.steps.length) {
        const px = sidebarX + 4 + col * (photoW + 4);
        const py = ry + 4 + row * (photoH + 4);

        // Photo placeholder with step-specific color/icon
        const stepColors = [c.info, c.warning, c.danger, c.success, c.primary, c.orange, c.darkBlue, c.danger];
        doc.rect(px, py, photoW, photoH).fillAndStroke(stepColors[stepIdx] || c.lightBg, c.border);

        // Step number circle
        doc.circle(px + photoW / 2, py + photoH / 2 - 5, 10).fill(c.white);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(stepColors[stepIdx] || c.primary)
           .text(String(stepIdx + 1), px + photoW / 2 - 4, py + photoH / 2 - 9);

        // Step label
        doc.font("Helvetica").fontSize(5).fillColor(c.white)
           .text(data.steps[stepIdx].title.substring(0, 15), px + 2, py + photoH - 10, { width: photoW - 4, align: "center" });
      }
    }
  }

  ry += photoRows * (photoH + 4) + 10;

  // Photo caption
  doc.font("Helvetica").fontSize(6).fillColor(c.lightText)
     .text("Photos des etapes ajoutees lors de la creation de la procedure", sidebarX + 4, ry, { width: sidebarW - 8, align: "center" });
  ry += 20;

  // EPI Section (NO EMOJI)
  doc.rect(sidebarX, ry, sidebarW, 16).fill(c.warning);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white).text("EPI OBLIGATOIRES", sidebarX + 8, ry + 4);
  ry += 16;

  const ppeH = Math.min(75, data.ppeRequired.length * 10 + 8);
  doc.rect(sidebarX, ry, sidebarW, ppeH).fillAndStroke(c.lightBg, c.border);
  doc.font("Helvetica").fontSize(6).fillColor(c.text);
  data.ppeRequired.slice(0, 8).forEach((ppe, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    doc.text("[x] " + ppe, sidebarX + 4 + col * (sidebarW / 2), ry + 4 + row * 10, { width: sidebarW / 2 - 8 });
  });
  ry += ppeH + 4;

  // Safety Codes Section (NO EMOJI)
  doc.rect(sidebarX, ry, sidebarW, 16).fill(c.info);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white).text("CONSIGNES SECURITE", sidebarX + 8, ry + 4);
  ry += 16;

  const scH = Math.min(50, data.safetyCodes.length * 11 + 6);
  doc.rect(sidebarX, ry, sidebarW, scH).fillAndStroke(c.lightBg, c.border);
  doc.font("Helvetica").fontSize(6).fillColor(c.text);
  data.safetyCodes.forEach((code, i) => {
    doc.text("> " + code, sidebarX + 4, ry + 4 + i * 11, { width: sidebarW - 8 });
  });
  ry += scH + 4;

  // Emergency Contacts (NO EMOJI)
  doc.rect(sidebarX, ry, sidebarW, 16).fill(c.danger);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white).text("CONTACTS URGENCE", sidebarX + 8, ry + 4);
  ry += 16;

  const contactH = data.emergencyContacts.length * 16 + 6;
  doc.rect(sidebarX, ry, sidebarW, contactH).fillAndStroke("#fef2f2", c.danger);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.danger);
  data.emergencyContacts.forEach((contact, i) => {
    doc.text(`${contact.name}: ${contact.phone}`, sidebarX + 6, ry + 4 + i * 16, { width: sidebarW - 12 });
  });
  ry += contactH + 4;

  // Risk Summary (NO EMOJI)
  doc.rect(sidebarX, ry, sidebarW, 55).fillAndStroke(c.darkBlue, c.border);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.white).text("SYNTHESE RISQUE", sidebarX + 8, ry + 4);

  // Calculate summary stats
  let maxNirInitial = 0, maxNirFinal = 0, totalHazards = 0;
  data.steps.forEach(step => {
    step.hazards.forEach(h => {
      const niri = h.gi * h.pi;
      const nirf = h.gf * h.pf;
      if (niri > maxNirInitial) maxNirInitial = niri;
      if (nirf > maxNirFinal) maxNirFinal = nirf;
      totalHazards++;
    });
  });

  doc.font("Helvetica").fontSize(6).fillColor("#a5b4fc");
  doc.text(`Dangers identifies: ${totalHazards}`, sidebarX + 8, ry + 18);
  doc.text(`NIR max initial: ${maxNirInitial}`, sidebarX + 8, ry + 30);
  doc.text(`NIR max residuel: ${maxNirFinal}`, sidebarX + 8, ry + 42);

  // Risk reduction indicator
  const reduction = Math.round((1 - maxNirFinal / maxNirInitial) * 100);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.success)
     .text(`Reduction: ${reduction}%`, sidebarX + sidebarW / 2, ry + 42);

  // === FOOTER (on first/main page only) ===
  const footerY = pageHeight - 18;
  doc.rect(0, footerY, pageWidth, 18).fill(c.headerBg);

  doc.font("Helvetica-Bold").fontSize(7).fillColor(c.headerText);
  doc.text(`${data.company} - RAMS`, margin, footerY + 4);
  doc.text(`Document genere par IA - ${new Date().toLocaleString("fr-FR")}`, pageWidth / 2 - 100, footerY + 4, { width: 200, align: "center" });
  doc.text(`Ref: ${docRef}`, pageWidth - margin - 180, footerY + 4, { width: 180, align: "right" });

  // === COMPACT SIGNATURE BOX (positioned after scales, before footer) ===
  // Position after risk scales at bottom of table area
  const sigBoxY = y + 40; // Below the scales
  const sigBoxW = tableW;
  const sigBoxH = 35;

  // Only draw if it fits before footer
  if (sigBoxY + sigBoxH < footerY - 5) {
    doc.rect(margin, sigBoxY, sigBoxW, sigBoxH).stroke(c.border);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(c.text)
       .text("SIGNATURES:", margin + 5, sigBoxY + 4);

    // 3 signature areas in one row
    const sigColW = (sigBoxW - 20) / 3;
    ["Redacteur", "Approbateur HSE", "Chef d'equipe"].forEach((role, i) => {
      const sx = margin + 5 + i * (sigColW + 5);
      doc.font("Helvetica").fontSize(6).fillColor(c.lightText)
         .text(role + ":", sx, sigBoxY + 14);
      doc.rect(sx, sigBoxY + 22, sigColW - 10, 10).stroke(c.border);
    });
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ====================================
// WORK METHOD PDF GENERATOR (A4)
// Detailed work methodology with photos
// ====================================
async function generateWorkMethodPDF(procedureData, steps, baseUrl = 'https://electrohub.app') {
  const data = procedureData;
  const docRef = `MT-${new Date().toLocaleDateString('fr-FR').replace(/\//g, '')}`;

  // Generate QR Code
  let qrCodeBuffer = null;
  try {
    qrCodeBuffer = await QRCode.toBuffer(`${baseUrl}/procedures/ai-assistant?ref=${docRef}&type=workmethod`, {
      width: 80, margin: 1, color: { dark: '#1e1b4b', light: '#ffffff' }
    });
  } catch (e) {
    console.log("[Work Method] QR code error:", e.message);
  }

  // A4 Portrait
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 30;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    bufferPages: true,
    info: {
      Title: `Methode de Travail - ${data.title || data.activity}`,
      Author: data.company || "ElectroHub",
      Subject: "Work Method Documentation",
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const c = {
    headerBg: "#30EA03",
    headerText: "#000000",
    primary: "#7c3aed",
    danger: "#dc2626",
    warning: "#f59e0b",
    success: "#16a34a",
    info: "#2563eb",
    text: "#1f2937",
    lightText: "#6b7280",
    lightBg: "#f8fafc",
    border: "#d1d5db",
    white: "#ffffff",
    darkBlue: "#1e1b4b",
  };

  const contentW = pageWidth - margin * 2;

  // === HEADER ===
  doc.rect(0, 0, pageWidth, 70).fill(c.headerBg);

  doc.font("Helvetica-Bold").fontSize(12).fillColor(c.headerText)
     .text(data.company || "ELECTROHUB", margin, 8);

  doc.roundedRect(margin, 24, 120, 18, 3).fill(c.info);
  doc.fontSize(9).fillColor(c.white).text("METHODE DE TRAVAIL", margin + 8, 28);

  doc.font("Helvetica").fontSize(7).fillColor("#1a5c00")
     .text(`Ref: ${docRef}`, margin, 48);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(c.headerText)
     .text(data.title || data.activity, margin + 150, 12, { width: 280, align: "center" });
  doc.font("Helvetica").fontSize(7).fillColor("#2d7a00")
     .text(`Version ${data.version || 1} | ${new Date().toLocaleDateString('fr-FR')}`, margin + 150, 28, { width: 280, align: "center" });

  // Document links
  doc.fontSize(6).fillColor(c.headerText)
     .text("Docs lies: RAMS | Methode | Procedure", margin + 150, 42, { width: 280, align: "center" });

  if (qrCodeBuffer) {
    try {
      doc.image(qrCodeBuffer, pageWidth - margin - 45, 8, { width: 40 });
    } catch (e) {}
  }

  let y = 85;

  // === INTRODUCTION ===
  doc.font("Helvetica-Bold").fontSize(11).fillColor(c.primary)
     .text("OBJECTIF DE L'INTERVENTION", margin, y);
  y += 15;

  doc.rect(margin, y, contentW, 50).fillAndStroke(c.lightBg, c.border);
  doc.font("Helvetica").fontSize(9).fillColor(c.text)
     .text(data.description || data.activity || "Description de l'intervention", margin + 10, y + 10, { width: contentW - 20 });
  y += 60;

  // === STEPS WITH PHOTOS ===
  doc.font("Helvetica-Bold").fontSize(11).fillColor(c.primary)
     .text("METHODOLOGIE DETAILLEE", margin, y);
  y += 20;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Check if we need a new page
    if (y > pageHeight - 200) {
      doc.addPage();
      y = margin;
    }

    // Step header
    doc.roundedRect(margin, y, contentW, 25, 3).fill(c.darkBlue);
    doc.circle(margin + 18, y + 12, 10).fill(c.primary);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(c.white)
       .text(String(step.step_number || i + 1), margin + 13, y + 7);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(c.white)
       .text(step.title, margin + 40, y + 7);

    if (step.duration_minutes) {
      doc.font("Helvetica").fontSize(8).fillColor("#a5b4fc")
         .text(`Duree: ${step.duration_minutes} min`, pageWidth - margin - 80, y + 8);
    }
    y += 30;

    // Step content box
    const contentBoxH = 120;
    doc.rect(margin, y, contentW, contentBoxH).stroke(c.border);

    // Photo area (left)
    const photoW = 150;
    const photoH = contentBoxH - 10;
    doc.rect(margin + 5, y + 5, photoW, photoH).fillAndStroke(c.lightBg, c.border);

    if (step.photo_content || step.photo_path) {
      try {
        if (step.photo_content) {
          doc.image(step.photo_content, margin + 5, y + 5, { fit: [photoW, photoH], align: 'center', valign: 'center' });
        }
      } catch (e) {
        doc.font("Helvetica").fontSize(8).fillColor(c.lightText)
           .text("Photo disponible", margin + 5 + photoW / 2 - 30, y + photoH / 2);
      }
    } else {
      // Placeholder
      doc.font("Helvetica").fontSize(8).fillColor(c.lightText)
         .text("Photo etape " + (step.step_number || i + 1), margin + 35, y + photoH / 2);
    }

    // Instructions (right)
    const textX = margin + photoW + 15;
    const textW = contentW - photoW - 25;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(c.text)
       .text("Instructions:", textX, y + 8);
    doc.font("Helvetica").fontSize(8).fillColor(c.text)
       .text(step.instructions || step.description || "Suivre la procedure standard", textX, y + 20, { width: textW, height: 45 });

    if (step.warning) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(c.danger)
         .text("! Attention:", textX, y + 70);
      doc.font("Helvetica").fontSize(7).fillColor(c.danger)
         .text(step.warning, textX, y + 82, { width: textW, height: 30 });
    }

    y += contentBoxH + 10;
  }

  // === SIGNATURE SECTION ===
  if (y > pageHeight - 150) {
    doc.addPage();
    y = margin;
  }

  y += 20;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(c.primary)
     .text("VALIDATION", margin, y);
  y += 18;

  // Signature boxes
  const sigW = (contentW - 20) / 2;
  doc.rect(margin, y, sigW, 60).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.text).text("Redacteur", margin + 10, y + 8);
  doc.font("Helvetica").fontSize(7).fillColor(c.lightText);
  doc.text("Nom:", margin + 10, y + 25);
  doc.text("Date:", margin + 10, y + 40);

  doc.rect(margin + sigW + 20, y, sigW, 60).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.text).text("Technicien", margin + sigW + 30, y + 8);
  doc.font("Helvetica").fontSize(7).fillColor(c.lightText);
  doc.text("Nom:", margin + sigW + 30, y + 25);
  doc.text("Date:", margin + sigW + 30, y + 40);

  // Footer on all pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, pageHeight - 20, pageWidth, 20).fill(c.headerBg);
    doc.font("Helvetica").fontSize(7).fillColor(c.headerText);
    doc.text(data.company || "ElectroHub", margin, pageHeight - 14);
    doc.text(`Methode de Travail - ${docRef}`, pageWidth / 2 - 60, pageHeight - 14, { width: 120, align: "center" });
    doc.text(`Page ${i + 1}/${range.count}`, pageWidth - margin - 50, pageHeight - 14, { width: 50, align: "right" });
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ====================================
// PROCEDURE DOCUMENT PDF GENERATOR (A4)
// Clear step-by-step procedure - NEW FORMAT
// ====================================
async function generateProcedureDocPDF(procedureData, steps, baseUrl = 'https://electrohub.app') {
  const data = procedureData;
  const docRef = `PROC-${new Date().toLocaleDateString('fr-FR').replace(/\//g, '')}`;

  // Generate QR Code
  let qrCodeBuffer = null;
  try {
    qrCodeBuffer = await QRCode.toBuffer(`${baseUrl}/procedures/ai-assistant?ref=${docRef}&type=procedure`, {
      width: 80, margin: 1, color: { dark: '#1e1b4b', light: '#ffffff' }
    });
  } catch (e) {
    console.log("[Procedure] QR code error:", e.message);
  }

  // A4 Portrait
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 30;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    bufferPages: true,
    info: {
      Title: `Procedure - ${data.title || data.activity}`,
      Author: data.company || "ElectroHub",
      Subject: "Operating Procedure",
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const c = {
    headerBg: "#30EA03",
    headerText: "#000000",
    primary: "#7c3aed",
    danger: "#dc2626",
    warning: "#f59e0b",
    success: "#16a34a",
    info: "#2563eb",
    text: "#1f2937",
    lightText: "#6b7280",
    lightBg: "#f8fafc",
    border: "#d1d5db",
    white: "#ffffff",
    darkBlue: "#1e1b4b",
  };

  const contentW = pageWidth - margin * 2;

  // === HEADER ===
  doc.rect(0, 0, pageWidth, 70).fill(c.headerBg);

  doc.font("Helvetica-Bold").fontSize(12).fillColor(c.headerText)
     .text(data.company || "ELECTROHUB", margin, 8);

  doc.roundedRect(margin, 24, 90, 18, 3).fill(c.success);
  doc.fontSize(9).fillColor(c.white).text("PROCEDURE", margin + 12, 28);

  doc.font("Helvetica").fontSize(7).fillColor("#1a5c00")
     .text(`Ref: ${docRef}`, margin, 48);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(c.headerText)
     .text(data.title || data.activity, margin + 120, 12, { width: 320, align: "center" });
  doc.font("Helvetica").fontSize(7).fillColor("#2d7a00")
     .text(`Version ${data.version || 1} | ${new Date().toLocaleDateString('fr-FR')}`, margin + 120, 28, { width: 320, align: "center" });

  doc.fontSize(6).fillColor(c.headerText)
     .text("Docs lies: RAMS | Methode | Procedure", margin + 120, 42, { width: 320, align: "center" });

  if (qrCodeBuffer) {
    try {
      doc.image(qrCodeBuffer, pageWidth - margin - 45, 8, { width: 40 });
    } catch (e) {}
  }

  let y = 85;

  // === PROCEDURE INFO BOX ===
  doc.rect(margin, y, contentW, 60).fillAndStroke(c.lightBg, c.border);

  doc.font("Helvetica-Bold").fontSize(9).fillColor(c.text);
  doc.text("Categorie:", margin + 10, y + 10);
  doc.text("Niveau de risque:", margin + 10, y + 25);
  doc.text("Duree estimee:", margin + 10, y + 40);

  doc.font("Helvetica").fontSize(9).fillColor(c.text);
  doc.text(data.category || "General", margin + 100, y + 10);

  const riskColors = { low: c.success, medium: c.warning, high: c.danger, critical: c.danger };
  const riskLabels = { low: "Faible", medium: "Modere", high: "Eleve", critical: "Critique" };
  doc.fillColor(riskColors[data.risk_level || data.riskLevel] || c.success)
     .text(riskLabels[data.risk_level || data.riskLevel] || "Faible", margin + 100, y + 25);

  const totalDuration = steps.reduce((sum, s) => sum + (s.duration_minutes || 10), 0);
  doc.fillColor(c.text).text(`${totalDuration} minutes`, margin + 100, y + 40);

  // PPE required
  const ppeList = data.ppe_required || data.ppeRequired || [];
  if (ppeList.length > 0) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(c.text)
       .text("EPI requis:", margin + 280, y + 10);
    doc.font("Helvetica").fontSize(8).fillColor(c.info)
       .text(ppeList.slice(0, 4).join(", "), margin + 280, y + 22, { width: 240 });
  }

  y += 70;

  // === STEPS CHECKLIST ===
  doc.font("Helvetica-Bold").fontSize(11).fillColor(c.primary)
     .text("ETAPES A SUIVRE", margin, y);
  y += 20;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Check for new page
    if (y > pageHeight - 100) {
      doc.addPage();
      y = margin;
    }

    // Step box with checkbox
    const stepH = 55;
    doc.rect(margin, y, contentW, stepH).stroke(c.border);

    // Checkbox
    doc.rect(margin + 8, y + 8, 15, 15).stroke(c.border);

    // Step number circle
    doc.circle(margin + 45, y + 15, 12).fill(c.primary);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(c.white)
       .text(String(step.step_number || i + 1), margin + 40, y + 10);

    // Step title
    doc.font("Helvetica-Bold").fontSize(10).fillColor(c.text)
       .text(step.title, margin + 65, y + 8, { width: contentW - 150 });

    // Duration badge
    if (step.duration_minutes) {
      doc.roundedRect(pageWidth - margin - 60, y + 5, 50, 16, 3).fill(c.lightBg);
      doc.font("Helvetica").fontSize(7).fillColor(c.lightText)
         .text(`${step.duration_minutes} min`, pageWidth - margin - 55, y + 9);
    }

    // Instructions
    doc.font("Helvetica").fontSize(8).fillColor(c.text)
       .text(step.instructions || step.description || "Executer cette etape selon les consignes", margin + 65, y + 25, { width: contentW - 80, height: 25 });

    // Warning if exists
    if (step.warning) {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(c.danger)
         .text("! " + step.warning.substring(0, 80), margin + 65, y + 42, { width: contentW - 80 });
    }

    // Validation checkbox
    if (step.requires_validation) {
      doc.rect(pageWidth - margin - 20, y + stepH - 20, 12, 12).stroke(c.success);
      doc.font("Helvetica").fontSize(6).fillColor(c.success)
         .text("Valid.", pageWidth - margin - 45, y + stepH - 18);
    }

    y += stepH + 5;
  }

  // === COMPLETION SECTION ===
  if (y > pageHeight - 180) {
    doc.addPage();
    y = margin;
  }

  y += 15;

  // Notes section
  doc.font("Helvetica-Bold").fontSize(10).fillColor(c.primary)
     .text("NOTES / OBSERVATIONS", margin, y);
  y += 15;
  doc.rect(margin, y, contentW, 60).stroke(c.border);
  y += 70;

  // Signature section
  doc.font("Helvetica-Bold").fontSize(10).fillColor(c.primary)
     .text("SIGNATURES DE COMPLETION", margin, y);
  y += 18;

  const sigW = (contentW - 30) / 3;

  // Technician
  doc.rect(margin, y, sigW, 70).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.text).text("Executant", margin + 10, y + 8);
  doc.font("Helvetica").fontSize(7).fillColor(c.lightText);
  doc.text("Nom:", margin + 10, y + 25);
  doc.text("Date:", margin + 10, y + 40);
  doc.text("Signature:", margin + 10, y + 55);

  // Verifier
  doc.rect(margin + sigW + 15, y, sigW, 70).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.text).text("Verificateur", margin + sigW + 25, y + 8);
  doc.font("Helvetica").fontSize(7).fillColor(c.lightText);
  doc.text("Nom:", margin + sigW + 25, y + 25);
  doc.text("Date:", margin + sigW + 25, y + 40);
  doc.text("Signature:", margin + sigW + 25, y + 55);

  // Approver
  doc.rect(margin + (sigW + 15) * 2, y, sigW, 70).stroke(c.border);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(c.text).text("Approbateur", margin + (sigW + 15) * 2 + 10, y + 8);
  doc.font("Helvetica").fontSize(7).fillColor(c.lightText);
  doc.text("Nom:", margin + (sigW + 15) * 2 + 10, y + 25);
  doc.text("Date:", margin + (sigW + 15) * 2 + 10, y + 40);
  doc.text("Signature:", margin + (sigW + 15) * 2 + 10, y + 55);

  // Footer on all pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, pageHeight - 20, pageWidth, 20).fill(c.headerBg);
    doc.font("Helvetica").fontSize(7).fillColor(c.headerText);
    doc.text(data.company || "ElectroHub", margin, pageHeight - 14);
    doc.text(`Procedure - ${docRef}`, pageWidth / 2 - 50, pageHeight - 14, { width: 100, align: "center" });
    doc.text(`Page ${i + 1}/${range.count}`, pageWidth - margin - 50, pageHeight - 14, { width: 50, align: "right" });
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ====================================
// EXAMPLE DATA FOR ALL 3 DOCUMENTS
// ====================================
function getExampleDocumentData() {
  return {
    procedure: {
      title: EXAMPLE_RAMS_DATA.activity,
      activity: EXAMPLE_RAMS_DATA.activity,
      description: "Intervention de maintenance electrique en zone ATEX pour le remplacement de materiel non conforme et ajout de mises a terre supplementaires.",
      category: EXAMPLE_RAMS_DATA.category,
      company: EXAMPLE_RAMS_DATA.company,
      version: EXAMPLE_RAMS_DATA.version,
      risk_level: EXAMPLE_RAMS_DATA.riskLevel,
      riskLevel: EXAMPLE_RAMS_DATA.riskLevel,
      ppe_required: EXAMPLE_RAMS_DATA.ppeRequired,
      ppeRequired: EXAMPLE_RAMS_DATA.ppeRequired,
      safety_codes: EXAMPLE_RAMS_DATA.safetyCodes,
      workDate: EXAMPLE_RAMS_DATA.workDate,
      workTime: EXAMPLE_RAMS_DATA.workTime,
      workers: EXAMPLE_RAMS_DATA.workers,
    },
    steps: EXAMPLE_RAMS_DATA.steps.map((s, i) => ({
      step_number: s.number,
      title: s.title,
      description: s.hazards[0]?.measures || "Suivre les consignes de securite",
      instructions: s.hazards.map(h => h.measures).join(". "),
      warning: s.hazards.find(h => h.gi >= 4)?.danger || null,
      duration_minutes: 15 + i * 5,
      requires_validation: s.hazards.some(h => h.gi >= 4),
      photo_path: null,
      photo_content: null,
    }))
  };
}

// Example Work Method PDF Generator
async function generateExampleWorkMethodPDF(baseUrl = 'https://electrohub.app') {
  const { procedure, steps } = getExampleDocumentData();
  return generateWorkMethodPDF(procedure, steps, baseUrl);
}

// Example Procedure PDF Generator
async function generateExampleProcedurePDF(baseUrl = 'https://electrohub.app') {
  const { procedure, steps } = getExampleDocumentData();
  return generateProcedureDocPDF(procedure, steps, baseUrl);
}

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
