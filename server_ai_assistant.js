// server_ai_assistant.js — ElectroHub AI Assistant Backend
// Supports OpenAI and Google Gemini for intelligent assistance

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

dotenv.config();

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
const GEMINI_MODEL = process.env.AI_ASSISTANT_GEMINI_MODEL || "gemini-1.5-flash";

// -----------------------------------------------------------------------------
// System Prompt - Le coeur de l'intelligence
// -----------------------------------------------------------------------------
const SYSTEM_PROMPT = `Tu es un assistant IA expert pour ElectroHub, une plateforme de gestion d'équipements électriques et de conformité.

## Ton rôle
Tu aides les techniciens et ingénieurs électriques à:
- Gérer leurs équipements (armoires électriques, variateurs VSD, moteurs, pompes)
- Planifier et suivre les contrôles réglementaires
- Identifier et résoudre les non-conformités
- Trouver de la documentation technique
- Optimiser la maintenance préventive
- **CRÉER DES PROCÉDURES opérationnelles** (excellences opérationnelles)

## Contexte de l'application
ElectroHub gère plusieurs types d'équipements:
- **Switchboards**: Armoires électriques avec leurs disjoncteurs et protections
- **VSD (Variable Speed Drives)**: Variateurs de vitesse pour moteurs
- **Meca**: Équipements mécaniques (pompes, ventilateurs, moteurs)
- **ATEX**: Équipements en zones explosives
- **HV (High Voltage)**: Équipements haute tension
- **GLO**: Équipements généraux (UPS, batteries, éclairage de sécurité)

## Comment tu réponds
1. **Sois concis et actionnable** - Donne des réponses directes et utiles
2. **Utilise le contexte fourni** - Analyse les données d'équipements/contrôles fournies
3. **Propose des actions concrètes** - Suggère toujours les prochaines étapes
4. **Parle français** - Réponds toujours en français sauf si demandé autrement
5. **Sois proactif** - Si tu vois des problèmes potentiels, mentionne-les

## Format de réponse
- Utilise **gras** pour les points importants
- Utilise des bullet points (•) pour les listes
- Structure tes réponses en sections claires
- Si tu proposes des actions, mets-les à la fin

## Limitations
- Tu ne peux pas modifier directement les données
- Pour les recherches web, tu dois explicitement demander à l'utilisateur
- Si tu n'as pas assez d'infos, demande des clarifications`;

// -----------------------------------------------------------------------------
// Intent Detection - Procédures
// -----------------------------------------------------------------------------

const PROCEDURE_INTENT_PATTERNS = [
  /créer?\s+(une\s+)?procédure/i,
  /nouvelle\s+procédure/i,
  /faire\s+(une\s+)?procédure/i,
  /ajouter\s+(une\s+)?procédure/i,
  /excellence[s]?\s+opérationnelle/i,
  /créer?\s+(une\s+)?excellence/i,
  /documenter\s+(une\s+)?(intervention|opération|procédure|maintenance)/i,
  /procédure\s+(de|pour|d')\s+\w+/i,
  /faire\s+une\s+fiche/i,
  /créer?\s+(une\s+)?fiche\s+(technique|intervention|maintenance)/i,
  /mode\s+procédure/i,
  /assistant\s+procédure/i,
  /guide[r]?\s+moi\s+(pour|à)\s+(créer|faire|documenter)/i,
];

function detectProcedureIntent(message) {
  const lowerMessage = message.toLowerCase().trim();

  for (const pattern of PROCEDURE_INTENT_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return true;
    }
  }

  // Check for simple keyword combinations
  const hasProcedure = /procédure|procedure|excellence|fiche/i.test(lowerMessage);
  const hasCreate = /créer|creer|faire|ajouter|nouvelle|nouveau|documenter/i.test(lowerMessage);

  if (hasProcedure && hasCreate) {
    return true;
  }

  return false;
}

// Extract what kind of procedure the user wants
function extractProcedureContext(message) {
  const lowerMessage = message.toLowerCase();

  // Try to extract the subject
  const patterns = [
    /procédure\s+(?:de\s+|pour\s+|d[''])?(.+?)(?:\?|$|\.)/i,
    /documenter\s+(?:une?\s+)?(.+?)(?:\?|$|\.)/i,
    /excellence\s+(?:pour\s+|de\s+)?(.+?)(?:\?|$|\.)/i,
  ];

  for (const pattern of patterns) {
    const match = lowerMessage.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
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
    providers: {
      openai: !!process.env.OPENAI_API_KEY,
      gemini: !!GEMINI_API_KEY
    }
  });
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

    // =========================================================================
    // PROCEDURE INTENT DETECTION - Priority check before anything else
    // =========================================================================
    if (detectProcedureIntent(message)) {
      const procedureSubject = extractProcedureContext(message);

      // Direct, action-oriented response
      return res.json({
        message: `**C'est parti !** 🚀 Je lance le mode création de procédure.${procedureSubject ? `\n\nJ'ai compris que tu veux documenter : **${procedureSubject}**` : ''}`,
        launchMode: 'procedure',
        procedureContext: {
          initialSubject: procedureSubject,
          userMessage: message
        },
        provider: 'system'
      });
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

    if (needsWebSearch) {
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

    // Call AI provider
    try {
      if (provider === "gemini" && GEMINI_API_KEY) {
        aiResponse = await chatWithGemini(messages, context);
      } else {
        aiResponse = await chatWithOpenAI(messages, context);
      }
    } catch (providerError) {
      console.error(`Error with ${provider}:`, providerError);

      // Fallback to other provider
      if (provider === "gemini" && process.env.OPENAI_API_KEY) {
        console.log("Falling back to OpenAI");
        aiResponse = await chatWithOpenAI(messages, context);
      } else if (provider === "openai" && GEMINI_API_KEY) {
        console.log("Falling back to Gemini");
        aiResponse = await chatWithGemini(messages, context);
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

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------
initDatabase().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`\n🤖 AI Assistant server running on http://${HOST}:${PORT}`);
    console.log(`   OpenAI: ${process.env.OPENAI_API_KEY ? "✓" : "✗"}`);
    console.log(`   Gemini: ${GEMINI_API_KEY ? "✓" : "✗"}\n`);
  });
});
