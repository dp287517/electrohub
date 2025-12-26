// server_ai_assistant.js — ElectroHub AI Assistant Backend
// Supports OpenAI and Google Gemini for intelligent assistance
// VERSION 2.1 - Enhanced Response Formatting + Cross-Module Integration

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "url";
import path from "path";

// Polyfill fetch
let _fetch = globalThis.fetch;
try {
  if (typeof _fetch !== "function") {
    const { default: nf } = await import("node-fetch");
    _fetch = nf;
  }
} catch {
  const { default: nf } = await import("node-fetch");
  _fetch = nf;
}
globalThis.fetch = _fetch;

// OpenAI SDK
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";

// Response Templates (ES Module)
import {
  EMOJIS, LABELS,
  formatRiskBadge, formatCategoryBadge, formatEquipmentBadge,
  formatDuration, formatDate, formatNumber, createProgressBar, createDivider,
  ProcedureTemplates, DashboardTemplates, EquipmentTemplates,
  ConversationTemplates, IntegrationTemplates
} from './server_ai_response_templates.js';

dotenv.config();

// =============================================================================
// PROCEDURES DATABASE INTEGRATION
// =============================================================================

/**
 * Search procedures by keywords, category, or equipment
 * Returns matching procedures from database
 */
async function searchProcedures(pool, query, options = {}) {
  const { category, limit = 10, site } = options;

  try {
    let sql = `
      SELECT
        p.id, p.title, p.description, p.category, p.risk_level, p.status,
        p.site, p.building, p.zone, p.created_at,
        COUNT(ps.id) as step_count
      FROM procedures p
      LEFT JOIN procedure_steps ps ON ps.procedure_id = p.id
      WHERE p.status IN ('approved', 'review', 'draft')
    `;
    const params = [];
    let paramIndex = 1;

    // Full-text search on title and description
    if (query && query.trim()) {
      sql += ` AND (
        p.title ILIKE $${paramIndex}
        OR p.description ILIKE $${paramIndex}
        OR p.category ILIKE $${paramIndex}
      )`;
      params.push(`%${query.trim()}%`);
      paramIndex++;
    }

    // Filter by category
    if (category) {
      sql += ` AND p.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    // Filter by site (tenant)
    if (site) {
      sql += ` AND (p.site = $${paramIndex} OR p.site IS NULL)`;
      params.push(site);
      paramIndex++;
    }

    sql += ` GROUP BY p.id ORDER BY p.updated_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(sql, params);
    return result.rows;
  } catch (error) {
    console.error('[AI-Procedures] Search error:', error);
    return [];
  }
}

/**
 * Get a single procedure with all its steps
 */
async function getProcedureWithSteps(pool, procedureId) {
  try {
    // Get procedure
    const procResult = await pool.query(`
      SELECT p.*,
        (SELECT json_agg(pel.* ORDER BY pel.created_at)
         FROM procedure_equipment_links pel
         WHERE pel.procedure_id = p.id) as equipment_links
      FROM procedures p
      WHERE p.id = $1
    `, [procedureId]);

    if (procResult.rows.length === 0) return null;

    const procedure = procResult.rows[0];

    // Get steps
    const stepsResult = await pool.query(`
      SELECT * FROM procedure_steps
      WHERE procedure_id = $1
      ORDER BY step_number ASC
    `, [procedureId]);

    procedure.steps = stepsResult.rows;

    return procedure;
  } catch (error) {
    console.error('[AI-Procedures] Get procedure error:', error);
    return null;
  }
}

/**
 * Get all procedure categories with counts
 */
async function getProcedureCategories(pool) {
  try {
    const result = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM procedures
      WHERE status IN ('approved', 'review', 'draft')
      GROUP BY category
      ORDER BY count DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('[AI-Procedures] Categories error:', error);
    return [];
  }
}

/**
 * Get procedure statistics for context
 */
async function getProcedureStats(pool, site = null) {
  try {
    let sql = `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as drafts,
        COUNT(CASE WHEN risk_level = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high_risk
      FROM procedures
    `;
    const params = [];

    if (site) {
      sql += ` WHERE site = $1 OR site IS NULL`;
      params.push(site);
    }

    const result = await pool.query(sql, params);
    return result.rows[0] || { total: 0, approved: 0, drafts: 0, critical: 0, high_risk: 0 };
  } catch (error) {
    console.error('[AI-Procedures] Stats error:', error);
    return { total: 0, approved: 0, drafts: 0, critical: 0, high_risk: 0 };
  }
}

/**
 * Generate chart data based on query type
 */
async function generateChartData(pool, chartType, site = null) {
  try {
    switch (chartType) {
      case 'procedures_by_category': {
        const result = await pool.query(`
          SELECT category, COUNT(*) as count
          FROM procedures
          WHERE status IN ('approved', 'review', 'draft')
          ${site ? "AND (site = $1 OR site IS NULL)" : ""}
          GROUP BY category
          ORDER BY count DESC
        `, site ? [site] : []);

        const categoryLabels = {
          maintenance: 'Maintenance',
          securite: 'Sécurité',
          general: 'Général',
          mise_en_service: 'Mise en service',
          urgence: 'Urgence',
          controle: 'Contrôle'
        };

        return {
          type: 'pie',
          title: 'Procédures par catégorie',
          labels: result.rows.map(r => categoryLabels[r.category] || r.category),
          data: result.rows.map(r => parseInt(r.count))
        };
      }

      case 'procedures_by_risk': {
        const result = await pool.query(`
          SELECT risk_level, COUNT(*) as count
          FROM procedures
          WHERE status IN ('approved', 'review', 'draft')
          ${site ? "AND (site = $1 OR site IS NULL)" : ""}
          GROUP BY risk_level
          ORDER BY
            CASE risk_level
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
            END
        `, site ? [site] : []);

        const riskLabels = { critical: 'Critique', high: 'Élevé', medium: 'Modéré', low: 'Faible' };

        return {
          type: 'bar',
          title: 'Procédures par niveau de risque',
          labels: result.rows.map(r => riskLabels[r.risk_level] || r.risk_level),
          data: result.rows.map(r => parseInt(r.count))
        };
      }

      case 'equipment_by_building': {
        // Query from switchboard equipment (most common)
        const result = await pool.query(`
          SELECT building_code as building, COUNT(*) as count
          FROM switchboard_equipment
          WHERE building_code IS NOT NULL
          GROUP BY building_code
          ORDER BY count DESC
          LIMIT 10
        `);

        return {
          type: 'bar',
          title: 'Équipements par bâtiment',
          labels: result.rows.map(r => r.building || 'Non assigné'),
          data: result.rows.map(r => parseInt(r.count))
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error('[AI-Charts] Error generating chart:', error);
    return null;
  }
}

/**
 * Detect if message requests a chart/graph
 */
function detectChartRequest(message) {
  const m = message.toLowerCase();

  const chartKeywords = ['graphique', 'graphe', 'chart', 'diagramme', 'visualise', 'montre-moi en graphique', 'répartition'];
  const hasChartKeyword = chartKeywords.some(k => m.includes(k));

  if (!hasChartKeyword) return null;

  if (m.includes('procédure') && (m.includes('catégorie') || m.includes('type'))) {
    return 'procedures_by_category';
  }
  if (m.includes('procédure') && m.includes('risque')) {
    return 'procedures_by_risk';
  }
  if (m.includes('équipement') && m.includes('bâtiment')) {
    return 'equipment_by_building';
  }

  // Default chart based on context
  if (m.includes('procédure')) {
    return 'procedures_by_category';
  }

  return null;
}

// Multer for file uploads
const upload = multer({
  dest: '/tmp/ai-assistant-uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.AI_ASSISTANT_PORT || 3025);
const HOST = process.env.AI_ASSISTANT_HOST || "127.0.0.1";

// -----------------------------------------------------------------------------
// Database
// -----------------------------------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

// -----------------------------------------------------------------------------
// AI Providers
// -----------------------------------------------------------------------------

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.AI_ASSISTANT_OPENAI_MODEL || "gpt-4o-mini";

// Gemini (Google AI)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.AI_ASSISTANT_GEMINI_MODEL || "gemini-2.0-flash";

// -----------------------------------------------------------------------------
// System Prompt - Le coeur de l'intelligence (v2.0 - Procedures Integration)
// -----------------------------------------------------------------------------
const SYSTEM_PROMPT = `Tu es un assistant IA expert pour ElectroHub, une plateforme de gestion d'équipements électriques et de procédures opérationnelles.

## RÈGLES CRITIQUES
1. **SOIS BREF** - Pas de blabla. Réponses courtes et directes.
2. **AGIS** - Ne demande pas de confirmation, fais directement.
3. **UTILISE LES VRAIES DONNÉES** - Tu as accès aux procédures en base de données. NE JAMAIS INVENTER.

## Ton rôle
Tu aides à:
- Gérer les équipements électriques
- Planifier les contrôles
- Résoudre les non-conformités
- **TROUVER et AFFICHER des procédures existantes**
- **GUIDER l'utilisateur étape par étape** dans une procédure
- **CRÉER de nouvelles procédures** avec photos

## PROCÉDURES - FONCTIONNALITÉS CLÉS

### 1. RECHERCHER une procédure
Quand l'utilisateur cherche une procédure:
- Tu reçois les procédures trouvées dans le contexte
- Tu AFFICHES la liste avec: titre, catégorie, niveau de risque, nombre d'étapes
- Tu proposes d'OUVRIR une procédure spécifique

**Format de réponse pour une recherche:**
📋 **[X] procédure(s) trouvée(s):**

1. **[Titre]** - [Catégorie]
   • Risque: [Niveau] | [N] étapes
   • [Description courte]

→ Dis-moi le numéro pour l'ouvrir ou "détails [titre]"

### 2. AFFICHER une procédure
Quand tu dois afficher une procédure:
- Tu reçois la procédure complète avec ses étapes
- Tu AFFICHES un résumé clair
- Tu retournes procedureToOpen avec l'ID pour que le frontend ouvre le modal

**Format:**
📋 **[Titre]**
• Catégorie: [catégorie]
• Risque: [niveau]
• EPI requis: [liste]

**Étapes:**
1. [Titre étape 1] - [durée]min
2. [Titre étape 2] - [durée]min
...

→ Je peux te guider étape par étape. Dis "commencer" !

### 3. GUIDER étape par étape
Mode guidage activé quand l'utilisateur dit "commencer", "guider", "étape suivante":
- Tu affiches UNE étape à la fois
- Tu donnes les instructions détaillées
- Tu demandes confirmation avant de passer à la suivante
- Tu rappelles les avertissements de sécurité

**Format guidage:**
⚡ **Étape [N]/[Total]: [Titre]**

📝 **Instructions:**
[Instructions détaillées]

⚠️ **Attention:** [Avertissement si présent]

⏱️ Durée estimée: [X] min

→ Dis "suivant" quand tu as fini, ou "aide" si besoin.

### 4. CRÉER une procédure
Quand l'utilisateur veut CRÉER une NOUVELLE procédure:
- Tu indiques que tu vas ouvrir l'assistant de création
- Le frontend ouvrira le modal ProcedureCreator

## DÉDUCTION AUTOMATIQUE (création)
- Électricité → Gants isolants, Lunettes, Casque
- Hauteur → Harnais, Casque
- Manutention → Gants, Chaussures sécurité
- ATEX → Vêtements antistatiques, Chaussures ESD

## Format réponse
- COURT et STRUCTURÉ
- Utilise **gras** pour les mots clés
- ✓ pour confirmer
- 📋 pour les procédures
- ⚠️ pour les avertissements
- ⚡ pour les étapes en cours

## Équipements disponibles
Switchboards, VSD, Meca, ATEX, HV, GLO, Datahub, Projects, OIBT, Doors, Mobile Equipment`;

// -----------------------------------------------------------------------------
// Intent Detection - Procédures (v2.0 - Multi-intent)
// -----------------------------------------------------------------------------

// Intent types
const INTENT_TYPES = {
  SEARCH: 'search',           // Rechercher une procédure
  VIEW: 'view',               // Voir/afficher une procédure spécifique
  GUIDE: 'guide',             // Être guidé étape par étape
  CREATE: 'create',           // Créer une nouvelle procédure
  LIST: 'list',               // Lister toutes les procédures
  NEXT_STEP: 'next_step',     // Passer à l'étape suivante
  ANALYZE_REPORT: 'analyze_report', // Analyser un rapport
  EQUIPMENT: 'equipment',     // Question sur un équipement
  NONE: 'none'                // Pas d'intention procédure
};

/**
 * Détecte l'intention de l'utilisateur concernant les procédures
 * @returns {{ type: string, query: string|null, procedureId: string|null }}
 */
function detectProcedureIntent(message, conversationHistory = []) {
  if (!message) return { type: INTENT_TYPES.NONE };
  const m = message.toLowerCase().trim();

  // Check if we're in a guidance session
  const lastAssistant = conversationHistory
    .filter(msg => msg.role === 'assistant')
    .pop();
  const isInGuidance = lastAssistant?.procedureGuidance?.active;

  // 1. NEXT STEP - En mode guidage
  if (isInGuidance) {
    const nextStepPatterns = ['suivant', 'next', 'étape suivante', 'continue', 'ok', 'fait', 'terminé', 'fini'];
    if (nextStepPatterns.some(p => m.includes(p) || m === p)) {
      return {
        type: INTENT_TYPES.NEXT_STEP,
        procedureId: lastAssistant.procedureGuidance.procedureId,
        currentStep: lastAssistant.procedureGuidance.currentStep
      };
    }
  }

  // 2. CREATE - Créer une nouvelle procédure
  const createKeywords = ['créer', 'creer', 'nouvelle', 'ajouter', 'faire'];
  const procedureWords = ['procédure', 'procedure', 'excellence'];
  const hasCreate = createKeywords.some(k => m.includes(k));
  const hasProcedure = procedureWords.some(k => m.includes(k));

  if (hasCreate && hasProcedure) {
    const subject = extractProcedureSubject(m);
    return { type: INTENT_TYPES.CREATE, query: subject };
  }

  // 3. GUIDE - Demande de guidage
  const guidePatterns = [
    /guide[r]?\s*(moi|nous)?/i,
    /commence[r]?\s*(la\s+)?procédure/i,
    /lance[r]?\s*(la\s+)?procédure/i,
    /faire\s+la\s+procédure/i,
    /exécute[r]?\s*(la\s+)?procédure/i,
    /^commencer$/i,
    /^guider$/i,
    /étape\s+par\s+étape/i
  ];
  if (guidePatterns.some(p => p.test(m))) {
    // Check if there's a procedure ID in context
    const procedureId = extractProcedureIdFromContext(conversationHistory);
    return { type: INTENT_TYPES.GUIDE, procedureId };
  }

  // 4. VIEW - Voir une procédure spécifique
  const viewPatterns = [
    /(?:voir|affiche[r]?|ouvre?|montre|détails?)\s+(?:la\s+)?(?:procédure\s+)?(?:n[°o]?\s*)?(\d+|"[^"]+"|'[^']+')/i,
    /procédure\s+(?:n[°o]?\s*)?(\d+)/i,
    /^(\d+)$/  // Just a number
  ];
  for (const pattern of viewPatterns) {
    const match = m.match(pattern);
    if (match) {
      return { type: INTENT_TYPES.VIEW, query: match[1]?.replace(/['"]/g, '') };
    }
  }

  // 5. SEARCH - Rechercher une procédure
  const searchPatterns = [
    /(?:cherche|trouve|recherche|où\s+est)\s+(?:une?\s+)?(?:procédure|proc)/i,
    /procédure\s+(?:de|pour|sur)\s+(.+)/i,
    /(?:y\s+a|existe|as-tu|avez-vous)\s+(?:une?\s+)?procédure/i,
    /(?:liste|montre|affiche)\s+(?:les\s+)?procédures/i,
    /quelles?\s+procédures?/i
  ];
  for (const pattern of searchPatterns) {
    if (pattern.test(m)) {
      const subject = extractProcedureSubject(m);
      return { type: INTENT_TYPES.SEARCH, query: subject };
    }
  }

  // 6. LIST - Lister les procédures
  const listPatterns = [
    /(?:liste|toutes)\s+(?:les\s+)?procédures/i,
    /combien\s+(?:de\s+)?procédures/i,
    /(?:mes|nos)\s+procédures/i
  ];
  if (listPatterns.some(p => p.test(m))) {
    return { type: INTENT_TYPES.LIST };
  }

  // 7. ANALYZE_REPORT - Analyser un rapport
  const reportPatterns = [
    /analyse[r]?\s+(?:ce\s+|le\s+|un\s+)?rapport/i,
    /rapport\s+(?:à\s+)?analyse[r]?/i,
    /importer?\s+(?:un\s+)?rapport/i,
    /(?:extraire|créer)\s+(?:des\s+)?actions?\s+(?:du|depuis)\s+(?:un\s+)?rapport/i
  ];
  if (reportPatterns.some(p => p.test(m))) {
    return { type: INTENT_TYPES.ANALYZE_REPORT };
  }

  // 8. EQUIPMENT - Question sur un équipement spécifique
  const equipmentPatterns = [
    /tableau\s+(?:électrique|general|principal|divisionnaire|tgbt|td)/i,
    /armoire\s+(?:électrique|de\s+commande)/i,
    /variateur|vsd|altivar|danfoss|abb/i,
    /disjoncteur|interrupteur|sectionneur/i,
    /transformateur|transfo/i,
    /groupe\s+électrogène|gélectrogène/i,
    /moteur|pompe|ventilateur|compresseur/i,
    /(?:quel|où|combien|statut|état)\s+.*(?:équipement|appareil|matériel)/i
  ];
  if (equipmentPatterns.some(p => p.test(m))) {
    return { type: INTENT_TYPES.EQUIPMENT, query: m };
  }

  // 9. Fallback - Check for procedure keywords without clear action
  if (hasProcedure && !hasCreate) {
    const subject = extractProcedureSubject(m);
    if (subject) {
      return { type: INTENT_TYPES.SEARCH, query: subject };
    }
  }

  return { type: INTENT_TYPES.NONE };
}

/**
 * Extract the subject/topic from a procedure query
 */
function extractProcedureSubject(message) {
  const patterns = [
    /procédure\s+(?:de\s+|pour\s+|d[''])?(.+?)(?:\?|$|\.)/i,
    /cherche.*procédure.*(?:de\s+|pour\s+|sur\s+)(.+?)(?:\?|$|\.)/i,
    /(?:maintenance|intervention|contrôle)\s+(?:de\s+|du\s+|des?\s+)?(.+?)(?:\?|$|\.)/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1] && match[1].length > 2) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract procedure ID from conversation history
 */
function extractProcedureIdFromContext(history) {
  // Look for the last procedure that was viewed/searched
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.procedureToOpen?.id) {
      return msg.procedureToOpen.id;
    }
    if (msg.procedureGuidance?.procedureId) {
      return msg.procedureGuidance.procedureId;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function formatContextForPrompt(context) {
  if (!context) return "Aucun contexte disponible.";

  let formatted = "## Données actuelles de l'installation\n\n";

  if (context.summary) {
    formatted += `### Résumé global
• **${context.summary.totalEquipments}** équipements au total
• **${context.summary.upcomingControls}** contrôles à venir
• **${context.summary.overdueControls}** contrôles en retard
• **${context.summary.buildingCount}** bâtiments\n\n`;
  }

  if (context.buildings && context.buildings.length > 0) {
    formatted += "### Répartition par bâtiment\n";
    context.buildings.forEach(b => {
      formatted += `• **${b.name}**: ${b.equipments} équipements, ${b.floors} étages\n`;
    });
    formatted += "\n";
  }

  if (context.user) {
    formatted += `### Utilisateur
• Nom: ${context.user.name}
• Site: ${context.user.site}
• Rôle: ${context.user.role}\n`;
  }

  return formatted;
}

// -----------------------------------------------------------------------------
// OpenAI Chat
// -----------------------------------------------------------------------------
async function chatWithOpenAI(messages, context) {
  const systemMessage = {
    role: "system",
    content: SYSTEM_PROMPT + "\n\n" + formatContextForPrompt(context)
  };

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [systemMessage, ...messages],
    temperature: 0.7,
    max_tokens: 1500
  });

  return response.choices[0]?.message?.content || "Désolé, je n'ai pas pu générer de réponse.";
}

// -----------------------------------------------------------------------------
// Gemini Chat
// -----------------------------------------------------------------------------
async function chatWithGemini(messages, context) {
  if (!GEMINI_API_KEY) {
    throw new Error("Clé API Gemini non configurée");
  }

  const systemPrompt = SYSTEM_PROMPT + "\n\n" + formatContextForPrompt(context);

  // Format messages for Gemini
  const contents = [];

  // Add conversation history
  messages.forEach(msg => {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    });
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1500
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Gemini error:", error);
    throw new Error("Erreur Gemini API");
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Désolé, je n'ai pas pu générer de réponse.";
}

// -----------------------------------------------------------------------------
// Web Search (using DuckDuckGo HTML API - no key needed)
// -----------------------------------------------------------------------------
async function webSearch(query) {
  try {
    // Using DuckDuckGo instant answer API
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(searchUrl);
    const data = await response.json();

    const results = [];

    // Abstract/main result
    if (data.Abstract) {
      results.push({
        title: data.Heading || query,
        snippet: data.Abstract,
        url: data.AbstractURL
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 5).forEach(topic => {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(" - ")[0] || topic.Text.substring(0, 50),
            snippet: topic.Text,
            url: topic.FirstURL
          });
        }
      });
    }

    return results;
  } catch (error) {
    console.error("Web search error:", error);
    return [];
  }
}

// -----------------------------------------------------------------------------
// Extract actions from AI response
// -----------------------------------------------------------------------------
function extractActions(message) {
  const actions = [];

  // Patterns for detecting action suggestions
  const patterns = [
    /(?:je (?:peux|propose|suggère|recommande)|voulez-vous|souhaitez-vous)[^.?!]*\?/gi,
    /(?:pour|afin de)[^.]*(?:cliquez|accédez|allez)[^.]*\./gi
  ];

  // Look for bullet points that seem actionable
  const lines = message.split('\n');
  lines.forEach(line => {
    if (line.match(/^[•\-\*]\s*\*\*[^*]+\*\*/)) {
      const match = line.match(/\*\*([^*]+)\*\*/);
      if (match) {
        actions.push({
          label: match[1].substring(0, 50),
          prompt: `Explique-moi plus sur: ${match[1]}`
        });
      }
    }
  });

  return actions.slice(0, 4); // Max 4 actions
}

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ai-assistant",
    version: "2.1-full-procedures-integration",
    features: {
      procedureSearch: true,
      procedureView: true,
      procedureGuidance: true,
      procedureCreate: true,
      photoAnalysis: true
    },
    providers: {
      openai: !!process.env.OPENAI_API_KEY,
      gemini: !!GEMINI_API_KEY
    }
  });
});

// =============================================================================
// PROCEDURES API - Direct access for frontend
// =============================================================================

// Search procedures
app.get("/procedures/search", async (req, res) => {
  try {
    const { q, category, site, limit = 10 } = req.query;
    const procedures = await searchProcedures(pool, q, {
      category,
      site,
      limit: parseInt(limit)
    });
    res.json({ ok: true, procedures });
  } catch (error) {
    console.error('[Procedures Search]', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get procedure stats (MUST be before :id route)
app.get("/procedures/stats", async (req, res) => {
  try {
    const { site } = req.query;
    const stats = await getProcedureStats(pool, site);
    res.json({ ok: true, stats });
  } catch (error) {
    console.error('[Procedures Stats]', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get categories with counts (MUST be before :id route)
app.get("/procedures/categories", async (req, res) => {
  try {
    const categories = await getProcedureCategories(pool);
    res.json({ ok: true, categories });
  } catch (error) {
    console.error('[Procedures Categories]', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get procedure with steps (parameterized route MUST be last)
app.get("/procedures/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const procedure = await getProcedureWithSteps(pool, id);
    if (!procedure) {
      return res.status(404).json({ ok: false, error: 'Procedure not found' });
    }
    res.json({ ok: true, procedure });
  } catch (error) {
    console.error('[Procedures Get]', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const {
      message,
      context,
      provider = "openai",
      conversationHistory = [],
      webSearch: doWebSearch = false,
      user
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message requis" });
    }

    console.log(`[CHAT] Message reçu: "${message}"`);

    // =========================================================================
    // PROCEDURE INTENT DETECTION (v2.0 - Multi-intent)
    // =========================================================================
    const intent = detectProcedureIntent(message, conversationHistory);
    console.log(`[CHAT] Intent detected:`, intent);

    // Handle procedure intents
    if (intent.type !== INTENT_TYPES.NONE) {
      const site = user?.site || context?.user?.site;

      switch (intent.type) {
        // -----------------------------------------------------------------
        // SEARCH: Rechercher des procédures
        // -----------------------------------------------------------------
        case INTENT_TYPES.SEARCH:
        case INTENT_TYPES.LIST: {
          const procedures = await searchProcedures(pool, intent.query, {
            site,
            limit: intent.type === INTENT_TYPES.LIST ? 20 : 10
          });

          console.log(`[CHAT] Found ${procedures.length} procedures for query: "${intent.query}"`);

          if (procedures.length === 0) {
            return res.json({
              message: ProcedureTemplates.searchResults([], intent.query),
              actions: [
                { label: '➕ Créer une procédure', prompt: `Créer une procédure ${intent.query || ''}` },
                { label: '📂 Voir les catégories', prompt: 'Quelles catégories de procédures existent ?' }
              ],
              provider: 'system'
            });
          }

          // Format procedure list with beautiful templates
          const formattedProcedures = procedures.map(p => ({
            ...p,
            steps: { length: p.step_count || 0 }
          }));
          let responseText = ProcedureTemplates.searchResults(formattedProcedures, intent.query);

          return res.json({
            message: responseText,
            proceduresFound: procedures.map(p => ({ id: p.id, title: p.title, index: procedures.indexOf(p) + 1 })),
            actions: procedures.slice(0, 3).map((p, i) => ({
              label: `Voir ${i + 1}. ${p.title.substring(0, 20)}...`,
              prompt: `Voir la procédure ${i + 1}`
            })),
            provider: 'system'
          });
        }

        // -----------------------------------------------------------------
        // VIEW: Voir une procédure spécifique
        // -----------------------------------------------------------------
        case INTENT_TYPES.VIEW: {
          // Get the procedure - either by index or ID
          let procedure = null;
          const viewQuery = intent.query;

          // Check if it's a number (index from previous search)
          if (/^\d+$/.test(viewQuery)) {
            const index = parseInt(viewQuery) - 1;
            // Look for procedures in conversation history
            const lastProcedures = conversationHistory
              .filter(m => m.proceduresFound)
              .pop()?.proceduresFound;

            if (lastProcedures && lastProcedures[index]) {
              procedure = await getProcedureWithSteps(pool, lastProcedures[index].id);
            } else {
              // Fallback: search and take the nth result
              const searchResults = await searchProcedures(pool, null, { site, limit: 20 });
              if (searchResults[index]) {
                procedure = await getProcedureWithSteps(pool, searchResults[index].id);
              }
            }
          } else {
            // Search by title
            const searchResults = await searchProcedures(pool, viewQuery, { site, limit: 1 });
            if (searchResults[0]) {
              procedure = await getProcedureWithSteps(pool, searchResults[0].id);
            }
          }

          if (!procedure) {
            return res.json({
              message: ConversationTemplates.notFound('cette procédure'),
              actions: [{ label: '📋 Lister les procédures', prompt: 'Liste des procédures' }],
              provider: 'system'
            });
          }

          // Format procedure details with beautiful template
          const formattedProcedure = {
            ...procedure,
            ppe: (procedure.ppe_required || []).map(p => p.name || p),
            steps: (procedure.steps || []).map(s => ({
              title: s.title,
              duration: s.duration_minutes
            })),
            estimated_time: procedure.steps?.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
          };

          let responseText = ProcedureTemplates.procedureDetail(formattedProcedure);

          return res.json({
            message: responseText,
            procedureToOpen: { id: procedure.id, title: procedure.title },
            procedureDetails: procedure,
            actions: [
              { label: '▶️ Commencer le guidage', prompt: 'Commencer la procédure' },
              { label: '📥 Télécharger PDF', url: `/api/procedures/${procedure.id}/pdf` }
            ],
            provider: 'system'
          });
        }

        // -----------------------------------------------------------------
        // GUIDE: Démarrer le guidage étape par étape
        // -----------------------------------------------------------------
        case INTENT_TYPES.GUIDE: {
          let procedureId = intent.procedureId;

          // If no ID, look in recent conversation
          if (!procedureId) {
            const lastProcedure = conversationHistory
              .filter(m => m.procedureToOpen || m.procedureDetails)
              .pop();
            procedureId = lastProcedure?.procedureToOpen?.id || lastProcedure?.procedureDetails?.id;
          }

          if (!procedureId) {
            return res.json({
              message: `❓ Quelle procédure veux-tu exécuter ?\n\nDis "liste procédures" pour voir les options.`,
              actions: [{ label: 'Lister les procédures', prompt: 'Liste des procédures' }],
              provider: 'system'
            });
          }

          const procedure = await getProcedureWithSteps(pool, procedureId);
          if (!procedure || !procedure.steps?.length) {
            return res.json({
              message: `❌ Cette procédure n'a pas d'étapes définies.`,
              provider: 'system'
            });
          }

          // Start at step 1
          const step = procedure.steps[0];
          const totalSteps = procedure.steps.length;

          // Format step with beautiful template
          const formattedStep = {
            title: step.title,
            instructions: step.instructions,
            duration: step.duration_minutes,
            warnings: step.warning ? [step.warning] : [],
            notes: step.notes
          };

          let responseText = ProcedureTemplates.guidanceStep(
            formattedStep,
            0,
            totalSteps,
            procedure.title
          );

          return res.json({
            message: responseText,
            procedureGuidance: {
              active: true,
              procedureId: procedure.id,
              procedureTitle: procedure.title,
              currentStep: 1,
              totalSteps,
              stepData: step
            },
            provider: 'system'
          });
        }

        // -----------------------------------------------------------------
        // NEXT_STEP: Passer à l'étape suivante
        // -----------------------------------------------------------------
        case INTENT_TYPES.NEXT_STEP: {
          const { procedureId, currentStep } = intent;
          const nextStepNumber = (currentStep || 0) + 1;

          const procedure = await getProcedureWithSteps(pool, procedureId);
          if (!procedure) {
            return res.json({
              message: `❌ Procédure non trouvée. Recommence avec "liste procédures".`,
              provider: 'system'
            });
          }

          const step = procedure.steps.find(s => s.step_number === nextStepNumber);
          const totalSteps = procedure.steps.length;

          // Procedure completed
          if (!step || nextStepNumber > totalSteps) {
            return res.json({
              message: ProcedureTemplates.procedureComplete(procedure.title),
              procedureGuidance: { active: false, completed: true, procedureId },
              actions: [
                { label: '📥 Télécharger PDF', url: `/api/procedures/${procedure.id}/pdf` },
                { label: '📋 Nouvelle procédure', prompt: 'Liste des procédures' },
                { label: '📊 Enregistrer contrôle', prompt: 'Créer rapport de contrôle' }
              ],
              provider: 'system'
            });
          }

          // Show next step with beautiful template
          const formattedStep = {
            title: step.title,
            instructions: step.instructions,
            duration: step.duration_minutes,
            warnings: step.warning ? [step.warning] : [],
            notes: step.notes
          };

          let responseText = ProcedureTemplates.stepComplete(currentStep, totalSteps);
          responseText += '\n\n';
          responseText += ProcedureTemplates.guidanceStep(
            formattedStep,
            nextStepNumber - 1,
            totalSteps,
            procedure.title
          );

          return res.json({
            message: responseText,
            procedureGuidance: {
              active: true,
              procedureId: procedure.id,
              procedureTitle: procedure.title,
              currentStep: nextStepNumber,
              totalSteps,
              stepData: step
            },
            provider: 'system'
          });
        }

        // -----------------------------------------------------------------
        // CREATE: Créer une nouvelle procédure
        // -----------------------------------------------------------------
        case INTENT_TYPES.CREATE: {
          const subject = intent.query;

          return res.json({
            message: subject
              ? `📝 OK, je vais t'aider à créer la procédure **"${subject}"**.\n\n→ L'assistant de création s'ouvre...`
              : `📝 Créons une nouvelle procédure !\n\n→ L'assistant de création s'ouvre...`,
            openProcedureCreator: true,
            procedureCreatorContext: { suggestedTitle: subject },
            provider: 'system'
          });
        }

        // -----------------------------------------------------------------
        // ANALYZE_REPORT: Analyser un rapport pour créer des actions
        // -----------------------------------------------------------------
        case INTENT_TYPES.ANALYZE_REPORT: {
          return res.json({
            message: `📊 **Analyse de rapport**\n\nJe peux analyser un rapport (PDF, Word, TXT) pour en extraire automatiquement des actions et créer des procédures.\n\n→ L'outil d'import s'ouvre...`,
            openProcedureCreator: true,
            procedureCreatorContext: { mode: 'report' },
            provider: 'system'
          });
        }

        // -----------------------------------------------------------------
        // EQUIPMENT: Question sur un équipement
        // -----------------------------------------------------------------
        case INTENT_TYPES.EQUIPMENT: {
          // Let the AI handle equipment questions with context
          // Don't return here - fall through to standard AI chat
          break;
        }
      }
    }

    // =========================================================================
    // STANDARD AI CHAT (no procedure intent)
    // =========================================================================

    // Check for chart request
    const chartType = detectChartRequest(message);
    let chart = null;
    if (chartType) {
      const site = user?.site || context?.user?.site;
      chart = await generateChartData(pool, chartType, site);
    }

    // Build messages array
    const messages = [
      ...conversationHistory.map(m => ({
        role: m.role,
        content: m.content
      })),
      { role: "user", content: message }
    ];

    let aiResponse;
    let sources = [];

    // Web search if requested or if message asks for documentation
    const needsWebSearch = doWebSearch ||
      message.toLowerCase().includes("documentation") ||
      message.toLowerCase().includes("cherche") ||
      message.toLowerCase().includes("recherche") ||
      message.toLowerCase().includes("trouve");

    if (needsWebSearch && !message.toLowerCase().includes("procédure")) {
      const searchQuery = message
        .replace(/cherche|recherche|trouve|documentation|sur le web/gi, "")
        .trim();

      if (searchQuery.length > 5) {
        const searchResults = await webSearch(searchQuery + " electrical equipment manual");
        if (searchResults.length > 0) {
          sources = searchResults.map(r => ({
            title: r.title,
            url: r.url
          }));

          // Add search context to the last message
          const searchContext = "\n\n[Résultats de recherche web disponibles:\n" +
            searchResults.map(r => `- ${r.title}: ${r.snippet}`).join("\n") +
            "]";

          messages[messages.length - 1].content += searchContext;
        }
      }
    }

    // Add procedure context to help AI
    const procedureStats = await getProcedureStats(pool, user?.site);
    const contextWithProcedures = {
      ...context,
      procedures: {
        total: procedureStats.total,
        approved: procedureStats.approved,
        critical: procedureStats.critical
      }
    };

    // Call AI provider
    try {
      if (provider === "gemini" && GEMINI_API_KEY) {
        aiResponse = await chatWithGemini(messages, contextWithProcedures);
      } else {
        aiResponse = await chatWithOpenAI(messages, contextWithProcedures);
      }
    } catch (providerError) {
      console.error(`Error with ${provider}:`, providerError);

      // Fallback to other provider
      if (provider === "gemini" && process.env.OPENAI_API_KEY) {
        console.log("Falling back to OpenAI");
        aiResponse = await chatWithOpenAI(messages, contextWithProcedures);
      } else if (provider === "openai" && GEMINI_API_KEY) {
        console.log("Falling back to Gemini");
        aiResponse = await chatWithGemini(messages, contextWithProcedures);
      } else {
        throw providerError;
      }
    }

    // Extract suggested actions
    const actions = extractActions(aiResponse);

    // Log conversation (optional, for improvement)
    try {
      await pool.query(`
        INSERT INTO ai_assistant_logs (user_email, message, response, provider, context_summary, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        user?.email || 'anonymous',
        message.substring(0, 500),
        aiResponse.substring(0, 2000),
        provider,
        JSON.stringify(context?.summary || {})
      ]);
    } catch (logError) {
      // Ignore log errors - table might not exist
      console.log("Could not log conversation (table may not exist)");
    }

    res.json({
      message: aiResponse,
      actions,
      sources,
      chart, // Dynamic chart data if requested
      provider
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Erreur lors de la génération de réponse",
      details: error.message
    });
  }
});

// =============================================================================
// CHAT WITH PHOTO - Vision AI for procedure creation
// =============================================================================
app.post("/chat-with-photo", upload.single('photo'), async (req, res) => {
  try {
    const { message } = req.body;
    const photo = req.file;
    const context = req.body.context ? JSON.parse(req.body.context) : null;
    const conversationHistory = req.body.conversationHistory ? JSON.parse(req.body.conversationHistory) : [];
    const user = req.body.user ? JSON.parse(req.body.user) : null;

    if (!photo) {
      return res.status(400).json({ error: "Photo requise" });
    }

    // Read photo and convert to base64
    const photoBuffer = fs.readFileSync(photo.path);
    const base64Photo = photoBuffer.toString('base64');
    const mimeType = photo.mimetype || 'image/jpeg';

    // Clean up temp file
    fs.unlinkSync(photo.path);

    // Build conversation with vision
    const visionMessages = [
      {
        role: "system",
        content: `Tu es un assistant qui aide à créer des procédures opérationnelles.

RÈGLES:
- Sois BREF et DIRECT
- Analyse la photo envoyée
- Identifie: équipement, étape de travail, contexte
- Pose UNE question pour la suite

Si l'utilisateur crée une procédure:
- Confirme réception de la photo: "✓ Photo reçue"
- Décris brièvement ce que tu vois
- Demande "Étape suivante ?" ou si c'est fini

Format: Court, avec émojis (✓ 📷 ⚠️)`
      }
    ];

    // Add conversation history
    conversationHistory.slice(-6).forEach(msg => {
      visionMessages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current message with photo
    visionMessages.push({
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Photo}`,
            detail: "low" // Use low detail for faster processing
          }
        },
        {
          type: "text",
          text: message || "Voici la photo pour cette étape."
        }
      ]
    });

    // Call Vision AI with fallback
    let aiResponse;
    try {
      console.log('[AI-Assistant] Calling OpenAI Vision...');
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: visionMessages,
        max_tokens: 300,
        temperature: 0.7
      });
      aiResponse = response.choices[0]?.message?.content || "✓ Photo reçue. Étape suivante ?";
    } catch (openaiError) {
      console.log('[AI-Assistant] OpenAI Vision failed:', openaiError.message);

      // Fallback to Gemini if quota error
      if (GEMINI_API_KEY && (openaiError.status === 429 || openaiError.message?.includes('429') || openaiError.message?.includes('quota'))) {
        console.log('[AI-Assistant] Fallback to Gemini Vision...');
        try {
          const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  role: "user",
                  parts: [
                    { text: visionMessages[0].content + "\n\n" + (message || "Voici la photo pour cette étape.") },
                    { inlineData: { mimeType, data: base64Photo } }
                  ]
                }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
              })
            }
          );
          const data = await geminiResponse.json();
          aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "✓ Photo reçue. Étape suivante ?";
          console.log('[AI-Assistant] Gemini Vision success');
        } catch (geminiError) {
          console.error('[AI-Assistant] Gemini Vision also failed:', geminiError.message);
          aiResponse = "✓ Photo reçue. Étape suivante ?";
        }
      } else {
        throw openaiError;
      }
    }

    res.json({
      message: aiResponse,
      actions: [
        { label: "Étape suivante", prompt: "Étape suivante" },
        { label: "Terminer", prompt: "C'est fini, génère la procédure" }
      ],
      provider: "openai-vision"
    });

  } catch (error) {
    console.error("Chat with photo error:", error);
    res.status(500).json({
      error: "Erreur lors de l'analyse de la photo",
      message: "✓ Photo reçue ! Décris cette étape et envoie la suivante 📷"
    });
  }
});

// Web search endpoint
app.post("/web-search", async (req, res) => {
  try {
    const { query, type = "general" } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query requis" });
    }

    // Enhance query based on type
    let enhancedQuery = query;
    if (type === "documentation") {
      enhancedQuery += " manual PDF datasheet specifications";
    } else if (type === "troubleshooting") {
      enhancedQuery += " problem solution fix repair";
    }

    const results = await webSearch(enhancedQuery);

    res.json({ results });

  } catch (error) {
    console.error("Web search error:", error);
    res.status(500).json({ error: "Erreur de recherche" });
  }
});

// Generate action plan
app.post("/action-plan", async (req, res) => {
  try {
    const {
      context,
      timeframe = "7days",
      priority = "all",
      user
    } = req.body;

    const prompt = `Génère un plan d'actions pour les prochains ${timeframe === "7days" ? "7 jours" : timeframe}.

Contexte:
${formatContextForPrompt(context)}

Crée une liste d'actions prioritaires avec:
- Titre de l'action
- Priorité (haute/moyenne/basse)
- Description courte
- Deadline suggérée

Format ta réponse en JSON valide avec cette structure:
{
  "actions": [
    { "title": "...", "priority": "high|medium|low", "description": "...", "deadline": "..." }
  ],
  "summary": "Résumé en une phrase"
}`;

    const messages = [{ role: "user", content: prompt }];
    let response;

    try {
      response = await chatWithOpenAI(messages, null);
    } catch {
      response = await chatWithGemini(messages, null);
    }

    // Try to parse as JSON
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[0]);
        plan.generatedAt = new Date().toISOString();
        return res.json(plan);
      }
    } catch (parseError) {
      console.log("Could not parse action plan as JSON");
    }

    // Fallback: return as text
    res.json({
      generatedAt: new Date().toISOString(),
      actions: [],
      summary: response,
      rawResponse: true
    });

  } catch (error) {
    console.error("Action plan error:", error);
    res.status(500).json({ error: "Erreur génération plan" });
  }
});

// Get conversation history (if stored)
app.get("/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;

    const result = await pool.query(`
      SELECT message, response, provider, created_at
      FROM ai_assistant_logs
      WHERE user_email = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId, parseInt(limit)]);

    res.json({ history: result.rows });

  } catch (error) {
    console.error("History error:", error);
    res.json({ history: [] }); // Return empty if table doesn't exist
  }
});

// =============================================================================
// AI PLANNING - Day/Week control scheduling
// =============================================================================

// Get AI-generated planning for controls
app.get("/planning", async (req, res) => {
  try {
    const { period = 'day' } = req.query;
    const userEmail = req.headers['x-user-email'];
    const site = req.headers['x-site'];

    // Get controls due based on period
    const daysAhead = period === 'week' ? 7 : 1;
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);

    // Fetch upcoming controls
    const controlsResult = await pool.query(`
      SELECT
        se.id, se.equipment_name, se.building_code, se.floor, se.zone,
        ct.control_type, ct.next_control_date, ct.frequency,
        ct.last_control_date, ct.status
      FROM switchboard_equipment se
      LEFT JOIN control_tasks ct ON ct.equipment_id = se.id AND ct.equipment_type = 'switchboard'
      WHERE ct.next_control_date BETWEEN $1 AND $2
      ${site ? "AND (se.site = $3 OR se.site IS NULL)" : ""}
      ORDER BY ct.next_control_date ASC
    `, site ? [today, endDate, site] : [today, endDate]);

    // Fetch overdue controls
    const overdueResult = await pool.query(`
      SELECT
        se.id, se.equipment_name, se.building_code, se.floor,
        ct.control_type, ct.next_control_date, ct.last_control_date
      FROM switchboard_equipment se
      LEFT JOIN control_tasks ct ON ct.equipment_id = se.id AND ct.equipment_type = 'switchboard'
      WHERE ct.next_control_date < $1
      ${site ? "AND (se.site = $2 OR se.site IS NULL)" : ""}
      ORDER BY ct.next_control_date ASC
      LIMIT 10
    `, site ? [today, site] : [today]);

    // Fetch relevant procedures
    const proceduresResult = await pool.query(`
      SELECT id, title, category, risk_level
      FROM procedures
      WHERE status = 'approved'
      AND category IN ('controle', 'maintenance', 'securite')
      ORDER BY updated_at DESC
      LIMIT 5
    `);

    // Group controls by day
    const controlsByDay = {};
    controlsResult.rows.forEach(control => {
      const date = new Date(control.next_control_date).toISOString().split('T')[0];
      if (!controlsByDay[date]) {
        controlsByDay[date] = [];
      }
      controlsByDay[date].push(control);
    });

    // Generate AI insight
    const totalControls = controlsResult.rows.length;
    const overdueCount = overdueResult.rows.length;
    let aiInsight = '';

    if (overdueCount > 0) {
      aiInsight = `⚠️ ${overdueCount} contrôle(s) en retard à traiter en priorité. `;
    }
    if (totalControls > 0) {
      aiInsight += `📋 ${totalControls} contrôle(s) planifié(s) ${period === 'week' ? 'cette semaine' : 'aujourd\'hui'}.`;
    } else {
      aiInsight = `✅ Aucun contrôle planifié ${period === 'week' ? 'cette semaine' : 'aujourd\'hui'}.`;
    }

    res.json({
      ok: true,
      period,
      planning: {
        controlsByDay,
        overdue: overdueResult.rows,
        recommendedProcedures: proceduresResult.rows,
        summary: {
          total: totalControls,
          overdue: overdueCount,
          buildings: [...new Set(controlsResult.rows.map(c => c.building_code))].length
        }
      },
      aiInsight
    });
  } catch (error) {
    console.error('[Planning] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Generate AI planning with OpenAI
app.post("/generate-planning", async (req, res) => {
  try {
    const { period = 'week', user } = req.body;
    const site = user?.site;

    // Get current situation
    const daysAhead = period === 'week' ? 7 : 1;
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);

    // Fetch data for AI
    const [controls, overdue, procedures] = await Promise.all([
      pool.query(`
        SELECT se.equipment_name, se.building_code, ct.control_type, ct.next_control_date
        FROM switchboard_equipment se
        LEFT JOIN control_tasks ct ON ct.equipment_id = se.id
        WHERE ct.next_control_date BETWEEN $1 AND $2
        ${site ? "AND se.site = $3" : ""}
        LIMIT 20
      `, site ? [today, endDate, site] : [today, endDate]),
      pool.query(`
        SELECT COUNT(*) as count FROM control_tasks
        WHERE next_control_date < $1
      `, [today]),
      pool.query(`
        SELECT title, category FROM procedures
        WHERE status = 'approved' LIMIT 10
      `)
    ]);

    // Generate AI planning
    const prompt = `Tu es un planificateur expert en maintenance électrique.
Génère un planning optimisé pour ${period === 'week' ? 'la semaine' : 'la journée'}.

Données:
- ${controls.rows.length} contrôles planifiés
- ${overdue.rows[0]?.count || 0} contrôles en retard
- Procédures disponibles: ${procedures.rows.map(p => p.title).join(', ') || 'aucune'}

Réponds en JSON avec cette structure:
{
  "planning": [
    { "date": "YYYY-MM-DD", "priority": 1, "task": "...", "procedure": "...", "duration": 30 }
  ],
  "tips": ["conseil 1", "conseil 2"],
  "summary": "résumé en une phrase"
}`;

    const messages = [{ role: "user", content: prompt }];
    let aiResponse;

    try {
      aiResponse = await chatWithOpenAI(messages, null);
    } catch {
      aiResponse = await chatWithGemini(messages, null);
    }

    // Parse response
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[0]);
        return res.json({ ok: true, ...plan });
      }
    } catch (e) {
      console.log('Could not parse AI planning');
    }

    res.json({
      ok: true,
      planning: controls.rows.map((c, i) => ({
        date: c.next_control_date,
        priority: i + 1,
        task: `Contrôle ${c.control_type} - ${c.equipment_name}`,
        duration: 30
      })),
      tips: ['Commencez par les contrôles en retard', 'Regroupez par bâtiment'],
      summary: aiResponse
    });
  } catch (error) {
    console.error('[GeneratePlanning] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get procedure recommendations based on predictions
app.get("/procedure-recommendations", async (req, res) => {
  try {
    const site = req.headers['x-site'];

    // Get high-risk equipment
    const risksResult = await pool.query(`
      SELECT
        se.id, se.equipment_name, se.building_code,
        COALESCE(
          (SELECT COUNT(*) FROM non_conformities nc WHERE nc.equipment_id = se.id::text),
          0
        ) as nc_count
      FROM switchboard_equipment se
      WHERE se.status = 'active'
      ${site ? "AND se.site = $1" : ""}
      ORDER BY nc_count DESC
      LIMIT 10
    `, site ? [site] : []);

    // Get recommended procedures based on equipment types
    const proceduresResult = await pool.query(`
      SELECT p.id, p.title, p.category, p.risk_level,
        (SELECT COUNT(*) FROM procedure_steps WHERE procedure_id = p.id) as step_count
      FROM procedures p
      WHERE p.status = 'approved'
      ORDER BY
        CASE p.risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        p.updated_at DESC
      LIMIT 5
    `);

    res.json({
      ok: true,
      recommendations: proceduresResult.rows.map(p => ({
        procedure: p,
        reason: p.risk_level === 'critical' || p.risk_level === 'high'
          ? 'Procédure à risque élevé - révision recommandée'
          : 'Procédure fréquemment utilisée'
      })),
      highRiskEquipment: risksResult.rows.filter(e => parseInt(e.nc_count) > 0)
    });
  } catch (error) {
    console.error('[ProcedureRecommendations] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// Create logs table if needed
// -----------------------------------------------------------------------------
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_assistant_logs (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255),
        message TEXT,
        response TEXT,
        provider VARCHAR(50),
        context_summary JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✓ AI Assistant logs table ready");
  } catch (error) {
    console.log("Could not create logs table:", error.message);
  }

  // User preferences for avatar
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_assistant_preferences (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) UNIQUE,
        avatar_style VARCHAR(50) DEFAULT 'robot',
        ai_provider VARCHAR(50) DEFAULT 'openai',
        voice_enabled BOOLEAN DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✓ AI Assistant preferences table ready");
  } catch (error) {
    console.log("Could not create preferences table:", error.message);
  }
}

// Preferences endpoints
app.get("/preferences/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;
    const result = await pool.query(
      "SELECT * FROM ai_assistant_preferences WHERE user_email = $1",
      [userEmail]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      // Return defaults
      res.json({
        avatar_style: "robot",
        ai_provider: "openai",
        voice_enabled: true
      });
    }
  } catch (error) {
    res.json({
      avatar_style: "robot",
      ai_provider: "openai",
      voice_enabled: true
    });
  }
});

app.put("/preferences/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;
    const { avatar_style, ai_provider, voice_enabled } = req.body;

    await pool.query(`
      INSERT INTO ai_assistant_preferences (user_email, avatar_style, ai_provider, voice_enabled, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_email)
      DO UPDATE SET
        avatar_style = COALESCE($2, ai_assistant_preferences.avatar_style),
        ai_provider = COALESCE($3, ai_assistant_preferences.ai_provider),
        voice_enabled = COALESCE($4, ai_assistant_preferences.voice_enabled),
        updated_at = NOW()
    `, [userEmail, avatar_style, ai_provider, voice_enabled]);

    res.json({ success: true });
  } catch (error) {
    console.error("Preferences update error:", error);
    res.status(500).json({ error: "Could not update preferences" });
  }
});

// =============================================================================
// 🔗 CROSS-MODULE AI INTEGRATION ENDPOINTS
// =============================================================================

/**
 * Get AI recommendations for an equipment type
 * Links procedures with equipment for intelligent suggestions
 */
app.get("/equipment-recommendations/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const site = req.header('X-Site') || 'Nyon';

    // Get equipment details based on type
    let equipment = null;
    let riskLevel = 'low';

    switch (type) {
      case 'switchboard':
        const swResult = await pool.query(
          'SELECT * FROM switchboards WHERE id = $1 AND site = $2',
          [id, site]
        );
        equipment = swResult.rows[0];
        break;
      case 'vsd':
        const vsdResult = await pool.query(
          'SELECT * FROM vsd_equipments WHERE id = $1 AND site = $2',
          [id, site]
        );
        equipment = vsdResult.rows[0];
        break;
      case 'atex':
        const atexResult = await pool.query(`
          SELECT e.*, s.name as site_name
          FROM atex_equipments e
          JOIN sites s ON e.site_id = s.id
          WHERE e.id = $1 AND s.name = $2
        `, [id, site]);
        equipment = atexResult.rows[0];
        riskLevel = equipment?.zone?.startsWith('0') ? 'critical' : 'high';
        break;
      case 'meca':
        const mecaResult = await pool.query(`
          SELECT e.*, s.name as site_name
          FROM meca_equipments e
          JOIN sites s ON e.site_id = s.id
          WHERE e.id = $1 AND s.name = $2
        `, [id, site]);
        equipment = mecaResult.rows[0];
        break;
    }

    if (!equipment) {
      return res.json({ ok: false, error: 'Equipment not found' });
    }

    // Find relevant procedures for this equipment type
    const keywords = {
      switchboard: ['tableau', 'électrique', 'armoire', 'TGBT', 'disjoncteur'],
      vsd: ['variateur', 'VSD', 'onduleur', 'drive', 'fréquence'],
      atex: ['ATEX', 'explosif', 'zone', 'certification', 'Ex'],
      meca: ['mécanique', 'roulement', 'vibration', 'pompe', 'moteur']
    };

    const searchTerms = keywords[type] || [type];
    const proceduresResult = await pool.query(`
      SELECT id, title, description, category, risk_level,
             (SELECT COUNT(*) FROM procedure_steps WHERE procedure_id = p.id) as step_count
      FROM procedures p
      WHERE status IN ('approved', 'review')
        AND (site = $1 OR site IS NULL)
        AND (
          title ILIKE ANY($2)
          OR description ILIKE ANY($2)
          OR category ILIKE ANY($2)
        )
      ORDER BY
        CASE WHEN risk_level = 'critical' THEN 1
             WHEN risk_level = 'high' THEN 2
             WHEN risk_level = 'medium' THEN 3
             ELSE 4 END,
        created_at DESC
      LIMIT 5
    `, [site, searchTerms.map(t => `%${t}%`)]);

    // Calculate equipment risk score
    let riskScore = 0.3; // Base
    if (type === 'atex') riskScore = 0.7;
    if (equipment.last_control) {
      const daysSince = Math.floor((Date.now() - new Date(equipment.last_control)) / (1000 * 60 * 60 * 24));
      if (daysSince > 365) riskScore += 0.3;
      else if (daysSince > 180) riskScore += 0.15;
    }

    res.json({
      ok: true,
      equipment: {
        id: equipment.id,
        name: equipment.name || equipment.building_code,
        type,
        location: equipment.building || equipment.building_code,
        riskScore: Math.min(riskScore, 1)
      },
      recommendations: {
        procedures: proceduresResult.rows.map(p => ({
          id: p.id,
          title: p.title,
          category: p.category,
          riskLevel: p.risk_level,
          stepCount: p.step_count,
          relevance: 'high'
        })),
        actions: [
          { type: 'control', label: 'Planifier un contrôle', priority: riskScore > 0.5 ? 'high' : 'medium' },
          { type: 'procedure', label: 'Voir procédures associées', priority: 'medium' },
          { type: 'history', label: 'Consulter l\'historique', priority: 'low' }
        ],
        alerts: riskScore > 0.6 ? ['Équipement à risque élevé - contrôle recommandé'] : []
      }
    });
  } catch (error) {
    console.error('[AI] Equipment recommendations error:', error);
    res.json({ ok: false, error: error.message });
  }
});

/**
 * Unified equipment search across all modules
 */
app.get("/unified-search", async (req, res) => {
  try {
    const { q, types, limit = 20 } = req.query;
    const site = req.header('X-Site') || 'Nyon';

    if (!q || q.length < 2) {
      return res.json({ ok: false, error: 'Query too short' });
    }

    const results = {
      switchboards: [],
      vsd: [],
      atex: [],
      meca: [],
      procedures: []
    };

    const searchTypes = types ? types.split(',') : ['switchboards', 'vsd', 'atex', 'meca', 'procedures'];
    const searchPattern = `%${q}%`;

    // Search switchboards
    if (searchTypes.includes('switchboards')) {
      const swResult = await pool.query(`
        SELECT id, name, building_code, floor, 'switchboard' as type
        FROM switchboards
        WHERE site = $1 AND (name ILIKE $2 OR building_code ILIKE $2)
        LIMIT $3
      `, [site, searchPattern, limit]);
      results.switchboards = swResult.rows;
    }

    // Search VSD
    if (searchTypes.includes('vsd')) {
      const vsdResult = await pool.query(`
        SELECT id, name, building, 'vsd' as type
        FROM vsd_equipments
        WHERE site = $1 AND (name ILIKE $2 OR building ILIKE $2)
        LIMIT $3
      `, [site, searchPattern, limit]);
      results.vsd = vsdResult.rows;
    }

    // Search ATEX
    if (searchTypes.includes('atex')) {
      const atexResult = await pool.query(`
        SELECT e.id, e.name, e.building, e.zone, 'atex' as type
        FROM atex_equipments e
        JOIN sites s ON e.site_id = s.id
        WHERE s.name = $1 AND (e.name ILIKE $2 OR e.building ILIKE $2)
        LIMIT $3
      `, [site, searchPattern, limit]);
      results.atex = atexResult.rows;
    }

    // Search MECA
    if (searchTypes.includes('meca')) {
      const mecaResult = await pool.query(`
        SELECT e.id, e.name, e.building, 'meca' as type
        FROM meca_equipments e
        JOIN sites s ON e.site_id = s.id
        WHERE s.name = $1 AND (e.name ILIKE $2 OR e.building ILIKE $2)
        LIMIT $3
      `, [site, searchPattern, limit]);
      results.meca = mecaResult.rows;
    }

    // Search procedures
    if (searchTypes.includes('procedures')) {
      const procResult = await pool.query(`
        SELECT id, title, category, risk_level, 'procedure' as type
        FROM procedures
        WHERE (site = $1 OR site IS NULL)
          AND status IN ('approved', 'review')
          AND (title ILIKE $2 OR description ILIKE $2)
        LIMIT $3
      `, [site, searchPattern, limit]);
      results.procedures = procResult.rows;
    }

    // Combine and sort by relevance
    const allResults = [
      ...results.switchboards.map(r => ({ ...r, category: 'Tableaux' })),
      ...results.vsd.map(r => ({ ...r, category: 'Variateurs' })),
      ...results.atex.map(r => ({ ...r, category: 'ATEX' })),
      ...results.meca.map(r => ({ ...r, category: 'Mécanique' })),
      ...results.procedures.map(r => ({ ...r, category: 'Procédures' }))
    ];

    res.json({
      ok: true,
      query: q,
      totalResults: allResults.length,
      results: allResults.slice(0, limit),
      byCategory: {
        switchboards: results.switchboards.length,
        vsd: results.vsd.length,
        atex: results.atex.length,
        meca: results.meca.length,
        procedures: results.procedures.length
      }
    });
  } catch (error) {
    console.error('[AI] Unified search error:', error);
    res.json({ ok: false, error: error.message });
  }
});

/**
 * Get module integration status for AI dashboard
 */
app.get("/modules-status", async (req, res) => {
  try {
    const site = req.header('X-Site') || 'Nyon';

    // Count equipment in each module
    const counts = {};

    const swCount = await pool.query('SELECT COUNT(*) FROM switchboards WHERE site = $1', [site]);
    counts.switchboards = parseInt(swCount.rows[0].count);

    const vsdCount = await pool.query('SELECT COUNT(*) FROM vsd_equipments WHERE site = $1', [site]);
    counts.vsd = parseInt(vsdCount.rows[0].count);

    const atexCount = await pool.query(`
      SELECT COUNT(*) FROM atex_equipments e
      JOIN sites s ON e.site_id = s.id WHERE s.name = $1
    `, [site]);
    counts.atex = parseInt(atexCount.rows[0].count);

    const mecaCount = await pool.query(`
      SELECT COUNT(*) FROM meca_equipments e
      JOIN sites s ON e.site_id = s.id WHERE s.name = $1
    `, [site]);
    counts.meca = parseInt(mecaCount.rows[0].count);

    const procCount = await pool.query(`
      SELECT COUNT(*) FROM procedures WHERE site = $1 OR site IS NULL
    `, [site]);
    counts.procedures = parseInt(procCount.rows[0].count);

    // Module status
    const modules = [
      { id: 'switchboards', name: 'Tableaux électriques', icon: '⚡', count: counts.switchboards, status: 'full', aiFeatures: ['chat', 'risk', 'procedures'] },
      { id: 'vsd', name: 'Variateurs', icon: '🔄', count: counts.vsd, status: 'full', aiFeatures: ['chat', 'diagnostics', 'maintenance'] },
      { id: 'atex', name: 'ATEX', icon: '💥', count: counts.atex, status: 'full', aiFeatures: ['chat', 'zones', 'compliance'] },
      { id: 'meca', name: 'Mécanique', icon: '⚙️', count: counts.meca, status: 'full', aiFeatures: ['chat', 'vibration', 'maintenance'] },
      { id: 'procedures', name: 'Procédures', icon: '📋', count: counts.procedures, status: 'full', aiFeatures: ['search', 'guidance', 'creation'] },
      { id: 'hv', name: 'Haute tension', icon: '⚡', count: 0, status: 'full', aiFeatures: ['chat', 'safety'] },
      { id: 'mobile', name: 'Équip. mobiles', icon: '📱', count: 0, status: 'full', aiFeatures: ['chat', 'tracking'] },
      { id: 'doors', name: 'Portes CF', icon: '🚪', count: 0, status: 'full', aiFeatures: ['chat', 'compliance'] },
      { id: 'dcf', name: 'DCF-SAP', icon: '🔗', count: 0, status: 'partial', aiFeatures: ['readonly'] },
      { id: 'training', name: 'Formation ATEX', icon: '📚', count: 0, status: 'partial', aiFeatures: ['educational'] },
      { id: 'contractors', name: 'Prestataires', icon: '👷', count: 0, status: 'pending', aiFeatures: [] }
    ];

    res.json({
      ok: true,
      site,
      modules,
      summary: {
        totalEquipment: counts.switchboards + counts.vsd + counts.atex + counts.meca,
        totalProcedures: counts.procedures,
        aiIntegrated: modules.filter(m => m.status === 'full').length,
        partial: modules.filter(m => m.status === 'partial').length,
        pending: modules.filter(m => m.status === 'pending').length
      },
      message: IntegrationTemplates.moduleStatus()
    });
  } catch (error) {
    console.error('[AI] Modules status error:', error);
    res.json({ ok: false, error: error.message });
  }
});

/**
 * AI-powered welcome message with context
 */
app.get("/welcome", async (req, res) => {
  try {
    const site = req.header('X-Site') || 'Nyon';
    const userName = req.query.name || '';

    // Get quick stats
    const overdueResult = await pool.query(`
      SELECT COUNT(*) FROM control_schedules
      WHERE site = $1 AND next_due_date < CURRENT_DATE AND status != 'done'
    `, [site]);
    const overdueCount = parseInt(overdueResult.rows[0].count);

    const todayResult = await pool.query(`
      SELECT COUNT(*) FROM control_schedules
      WHERE site = $1 AND next_due_date = CURRENT_DATE
    `, [site]);
    const todayCount = parseInt(todayResult.rows[0].count);

    let welcomeMessage = ConversationTemplates.welcome(userName);

    // Add context-aware alerts
    if (overdueCount > 0) {
      welcomeMessage += `\n\n${EMOJIS.status.warning} **${overdueCount} contrôle(s) en retard** à traiter.`;
    }
    if (todayCount > 0) {
      welcomeMessage += `\n${EMOJIS.section.plan} **${todayCount} contrôle(s) prévu(s)** aujourd'hui.`;
    }

    res.json({
      ok: true,
      message: welcomeMessage,
      context: {
        site,
        overdueControls: overdueCount,
        todayControls: todayCount,
        hasAlerts: overdueCount > 0
      },
      quickActions: [
        { label: '📊 Brief du matin', prompt: 'Brief du matin' },
        { label: '📋 Procédures', prompt: 'Liste des procédures' },
        { label: '📅 Planning', prompt: 'Planning de la semaine' },
        { label: '❓ Aide', prompt: 'Aide' }
      ]
    });
  } catch (error) {
    console.error('[AI] Welcome error:', error);
    res.json({
      ok: true,
      message: ConversationTemplates.welcome(''),
      quickActions: []
    });
  }
});

/**
 * Get help message
 */
app.get("/help", (req, res) => {
  res.json({
    ok: true,
    message: ConversationTemplates.help(),
    categories: [
      { name: 'Recherche', examples: ['cherche procédure maintenance', 'trouve contrôle ATEX'] },
      { name: 'Guidage', examples: ['guide-moi', 'suivant', 'précédent'] },
      { name: 'Création', examples: ['créer une procédure', 'nouvelle procédure'] },
      { name: 'Analyse', examples: ['statistiques', 'analyse des risques', 'brief du matin'] },
      { name: 'Planification', examples: ['planning semaine', 'contrôles en retard'] }
    ]
  });
});

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------
initDatabase().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`\n🤖 AI Assistant server running on http://${HOST}:${PORT}`);
    console.log(`   OpenAI: ${process.env.OPENAI_API_KEY ? "✓" : "✗"}`);
    console.log(`   Gemini: ${GEMINI_API_KEY ? "✓" : "✗"}`);
    console.log(`   Response Templates: ✓\n`);
  });
});
