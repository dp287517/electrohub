// server.js — version 3.0 avec timeouts proxy robustes
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import pg from "pg";
import { createProxyMiddleware } from "http-proxy-middleware";
import switchboardMapApp from "./server_switchboard_map.js";
import adminRouter from "./server_admin.js";
import pushRouter, { notifyAdminsPendingUser } from "./server_push.js";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import multer from "multer";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// Pool séparé pour la base ATEX (si différente) - utilisé pour pending_reports
const atexDbUrl = process.env.ATEX_DATABASE_URL || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const atexPool = new Pool({ connectionString: atexDbUrl });

// Log database connections at startup
console.log(`[DB] Main pool: ${process.env.NEON_DATABASE_URL ? 'NEON_DATABASE_URL ✅' : '❌ NOT SET'}`);
console.log(`[DB] ATEX pool: ${process.env.ATEX_DATABASE_URL ? 'ATEX_DATABASE_URL' : process.env.DATABASE_URL ? 'DATABASE_URL' : 'NEON_DATABASE_URL (fallback)'} ✅`);

// ============================================================
// AI SETUP - OpenAI + Gemini (fallback)
// ============================================================
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const gemini = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const GEMINI_MODEL = "gemini-2.0-flash";

console.log(`[AI] OpenAI: ${openai ? '✅' : '❌'} | Gemini: ${gemini ? '✅' : '❌'}`);

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

// Chat with fallback (OpenAI -> Gemini)
async function chatWithFallback(messages, options = {}) {
  const hasOpenAI = !!openai;
  const hasGemini = !!gemini;

  console.log(`[AI-Fallback] Providers: OpenAI=${hasOpenAI}, Gemini=${hasGemini}`);

  // Try OpenAI first
  if (hasOpenAI) {
    try {
      console.log(`[AI-Fallback] Calling OpenAI...`);
      const response = await openai.chat.completions.create({
        model: options.model || "gpt-4o-mini",
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 2000,
        ...(options.response_format && { response_format: options.response_format }),
      });
      const content = response.choices[0]?.message?.content || '';
      console.log(`[AI-Fallback] OpenAI response: ${content.length} chars`);
      return { content, provider: 'openai' };
    } catch (error) {
      console.error(`[AI-Fallback] OpenAI failed: ${error.message}`);

      if (hasGemini && isQuotaError(error)) {
        console.log(`[AI-Fallback] Fallback to Gemini...`);
        try {
          const content = await callGemini(messages, options);
          console.log(`[AI-Fallback] Gemini response: ${content.length} chars`);
          return { content, provider: 'gemini' };
        } catch (geminiError) {
          console.error(`[AI-Fallback] Gemini also failed: ${geminiError.message}`);
          throw geminiError;
        }
      }
      throw error;
    }
  }

  // Only Gemini
  if (hasGemini) {
    console.log(`[AI-Fallback] Using Gemini (no OpenAI)...`);
    const content = await callGemini(messages, options);
    console.log(`[AI-Fallback] Gemini response: ${content.length} chars`);
    return { content, provider: 'gemini' };
  }

  throw new Error('No AI provider configured');
}

// ============================================================
// 🔥 INTELLIGENT MULTI-MODEL REASONING
// Combine OpenAI + Gemini for complex analysis
// ============================================================

// Detect if query requires multi-model reasoning
function needsMultiModelReasoning(message) {
  const complexPatterns = [
    /analyse.*complet|complet.*analyse/i,
    /prédiction|prédir|anticiper/i,
    /stratégi|recommand.*détaillé/i,
    /comparer|différence/i,
    /diagnostic|troubleshoot/i,
    /optimis/i,
    /pourquoi.*problème|problème.*pourquoi/i
  ];
  return complexPatterns.some(p => p.test(message));
}

// Multi-model reasoning: query both and synthesize
async function multiModelReasoning(messages, options = {}) {
  const hasOpenAI = !!openai;
  const hasGemini = !!gemini;

  // If only one provider, use standard fallback
  if (!hasOpenAI || !hasGemini) {
    return chatWithFallback(messages, options);
  }

  console.log('[AI-Multi] 🔥 Multi-model reasoning activated');

  try {
    // Call both in parallel
    const [openaiPromise, geminiPromise] = await Promise.allSettled([
      (async () => {
        const response = await openai.chat.completions.create({
          model: options.model || "gpt-4o-mini",
          messages,
          temperature: options.temperature ?? 0.5,
          max_tokens: options.max_tokens ?? 1500
        });
        return response.choices[0]?.message?.content || '';
      })(),
      callGemini(messages, { ...options, max_tokens: 1500 })
    ]);

    const openaiResult = openaiPromise.status === 'fulfilled' ? openaiPromise.value : null;
    const geminiResult = geminiPromise.status === 'fulfilled' ? geminiPromise.value : null;

    console.log(`[AI-Multi] OpenAI: ${openaiResult ? openaiResult.length + ' chars' : 'failed'}`);
    console.log(`[AI-Multi] Gemini: ${geminiResult ? geminiResult.length + ' chars' : 'failed'}`);

    // If only one succeeded, return that
    if (!openaiResult && !geminiResult) {
      throw new Error('Both AI providers failed');
    }
    if (!openaiResult) return { content: geminiResult, provider: 'gemini' };
    if (!geminiResult) return { content: openaiResult, provider: 'openai' };

    // Both succeeded - synthesize responses
    const synthesisPrompt = [
      {
        role: "system",
        content: `Tu es un expert en synthèse. Tu reçois deux réponses d'IA différentes à la même question.
Ton travail:
1. Identifie les POINTS COMMUNS (haute confiance)
2. Note les DIFFÉRENCES ou insights uniques de chaque réponse
3. Produis UNE SEULE réponse synthétisée qui combine le meilleur des deux
4. La réponse finale doit être PLUS COMPLÈTE et PLUS PRÉCISE que chaque réponse individuelle
5. Garde le format original (listes, emojis, etc.)
6. Ne mentionne PAS que tu synthétises deux réponses

Réponds directement à la question originale avec la synthèse.`
      },
      {
        role: "user",
        content: `Question originale: ${messages[messages.length - 1].content}

=== RÉPONSE A (OpenAI) ===
${openaiResult}

=== RÉPONSE B (Gemini) ===
${geminiResult}

=== FIN ===

Produis maintenant une réponse synthétisée optimale:`
      }
    ];

    // Use OpenAI for synthesis (faster)
    try {
      const synthesisResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: synthesisPrompt,
        temperature: 0.3,
        max_tokens: 2000
      });
      const synthesizedContent = synthesisResponse.choices[0]?.message?.content || openaiResult;
      console.log(`[AI-Multi] ✅ Synthesis complete: ${synthesizedContent.length} chars`);
      return { content: synthesizedContent, provider: 'multi-model', models: ['openai', 'gemini'] };
    } catch (e) {
      // Synthesis failed, return OpenAI result
      console.log(`[AI-Multi] Synthesis failed, using OpenAI result`);
      return { content: openaiResult, provider: 'openai' };
    }

  } catch (e) {
    console.error(`[AI-Multi] Error: ${e.message}`);
    // Fallback to standard
    return chatWithFallback(messages, options);
  }
}

// Smart AI call - decides between simple and multi-model
async function callAI(messages, options = {}) {
  const userMessage = messages[messages.length - 1]?.content || '';

  // Use multi-model for complex queries
  if (needsMultiModelReasoning(userMessage)) {
    return multiModelReasoning(messages, options);
  }

  // Standard fallback for simple queries
  return chatWithFallback(messages, options);
}

// ============================================================
// 🧠 AI MEMORY & LEARNING SYSTEM - Persistent User Intelligence
// ============================================================

// Initialize AI memory tables
async function initAIMemoryTables() {
  try {
    // Main user memory table - stores conversations, preferences, patterns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_user_memory (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        site VARCHAR(100),
        memory_type VARCHAR(50) NOT NULL, -- 'conversation', 'preference', 'pattern', 'learning', 'prediction_feedback'
        category VARCHAR(100), -- 'equipment', 'procedure', 'schedule', 'behavior', 'expertise', etc.
        key_data VARCHAR(255), -- searchable key (e.g., equipment name, procedure type)
        content JSONB NOT NULL, -- flexible JSON content
        importance FLOAT DEFAULT 0.5, -- 0-1, how important this memory is
        access_count INTEGER DEFAULT 1, -- how often this memory was used
        last_accessed TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ -- optional expiration
      )
    `);

    // Index for fast user lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_memory_user_email ON ai_user_memory(user_email)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_memory_type ON ai_user_memory(memory_type, category)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_memory_key ON ai_user_memory(key_data)
    `);

    // User interaction statistics - for learning patterns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_user_stats (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) UNIQUE NOT NULL,
        site VARCHAR(100),
        total_interactions INTEGER DEFAULT 0,
        favorite_topics JSONB DEFAULT '[]',
        expertise_areas JSONB DEFAULT '[]',
        working_hours JSONB DEFAULT '{}', -- {hour: count} to learn when user works
        response_preferences JSONB DEFAULT '{}', -- detail_level, chart_preference, etc.
        equipment_focus JSONB DEFAULT '[]', -- equipment types user works with most
        avg_session_length FLOAT DEFAULT 0,
        last_interaction TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Predictions tracking - for ML learning
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_predictions (
        id SERIAL PRIMARY KEY,
        prediction_type VARCHAR(100) NOT NULL, -- 'equipment_failure', 'maintenance_need', 'nc_risk', etc.
        target_id VARCHAR(255), -- equipment_id, etc.
        target_type VARCHAR(50), -- 'vsd', 'meca', 'atex', 'switchboard'
        site VARCHAR(100),
        prediction_data JSONB NOT NULL,
        confidence FLOAT DEFAULT 0.5,
        predicted_date DATE,
        was_accurate BOOLEAN, -- filled in later for training
        feedback_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Equipment usage patterns for predictive maintenance
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_equipment_patterns (
        id SERIAL PRIMARY KEY,
        equipment_id VARCHAR(255) NOT NULL,
        equipment_type VARCHAR(50) NOT NULL,
        site VARCHAR(100),
        pattern_type VARCHAR(100), -- 'failure_frequency', 'maintenance_cycle', 'degradation', 'usage'
        pattern_data JSONB NOT NULL,
        calculated_at TIMESTAMPTZ DEFAULT NOW(),
        next_prediction DATE,
        model_version VARCHAR(50)
      )
    `);

    console.log('[AI] 🧠 Memory tables initialized successfully');
    return true;
  } catch (e) {
    console.error('[AI] Memory tables init error:', e.message);
    return false;
  }
}

// Save a memory for a user
async function saveUserMemory(userEmail, memoryType, category, keyData, content, importance = 0.5, site = null) {
  try {
    // Check if similar memory exists
    const existing = await pool.query(`
      SELECT id, access_count, content FROM ai_user_memory
      WHERE user_email = $1 AND memory_type = $2 AND key_data = $3
      LIMIT 1
    `, [userEmail, memoryType, keyData]);

    if (existing.rows.length > 0) {
      // Update existing memory, merge content
      const oldContent = existing.rows[0].content;
      const mergedContent = { ...oldContent, ...content, updated: new Date().toISOString() };

      await pool.query(`
        UPDATE ai_user_memory
        SET content = $1, access_count = access_count + 1, last_accessed = NOW(), importance = GREATEST(importance, $2)
        WHERE id = $3
      `, [JSON.stringify(mergedContent), importance, existing.rows[0].id]);

      return { updated: true, id: existing.rows[0].id };
    }

    // Insert new memory
    const result = await pool.query(`
      INSERT INTO ai_user_memory (user_email, site, memory_type, category, key_data, content, importance)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [userEmail, site, memoryType, category, keyData, JSON.stringify(content), importance]);

    return { created: true, id: result.rows[0].id };
  } catch (e) {
    console.error('[AI] Save memory error:', e.message);
    return { error: e.message };
  }
}

// Get user memories for context
async function getUserMemories(userEmail, limit = 50, types = null) {
  try {
    let sql = `
      SELECT memory_type, category, key_data, content, importance, access_count, last_accessed
      FROM ai_user_memory
      WHERE user_email = $1
    `;
    const params = [userEmail];

    if (types && types.length > 0) {
      sql += ` AND memory_type = ANY($2)`;
      params.push(types);
    }

    sql += ` ORDER BY importance DESC, last_accessed DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sql, params);

    // Group by type for easy access
    const memories = {
      preferences: [],
      patterns: [],
      conversations: [],
      learnings: [],
      all: result.rows
    };

    result.rows.forEach(m => {
      if (m.memory_type === 'preference') memories.preferences.push(m);
      else if (m.memory_type === 'pattern') memories.patterns.push(m);
      else if (m.memory_type === 'conversation') memories.conversations.push(m);
      else if (m.memory_type === 'learning') memories.learnings.push(m);
    });

    return memories;
  } catch (e) {
    console.error('[AI] Get memories error:', e.message);
    return { preferences: [], patterns: [], conversations: [], learnings: [], all: [] };
  }
}

// Update user stats (for learning)
async function updateUserStats(userEmail, site, interactionData) {
  try {
    const hour = new Date().getHours();

    // Upsert user stats
    await pool.query(`
      INSERT INTO ai_user_stats (user_email, site, total_interactions, working_hours, last_interaction)
      VALUES ($1, $2, 1, $3, NOW())
      ON CONFLICT (user_email) DO UPDATE SET
        total_interactions = ai_user_stats.total_interactions + 1,
        working_hours = COALESCE(ai_user_stats.working_hours, '{}')::jsonb || $3::jsonb,
        last_interaction = NOW(),
        site = COALESCE($2, ai_user_stats.site)
    `, [userEmail, site, JSON.stringify({ [hour]: 1 })]);

    // Update favorite topics if topic provided
    if (interactionData.topic) {
      await pool.query(`
        UPDATE ai_user_stats
        SET favorite_topics = (
          SELECT jsonb_agg(DISTINCT elem)
          FROM (
            SELECT jsonb_array_elements_text(COALESCE(favorite_topics, '[]'::jsonb)) AS elem
            UNION
            SELECT $2
          ) AS combined
        )
        WHERE user_email = $1
      `, [userEmail, interactionData.topic]);
    }

    // Update equipment focus
    if (interactionData.equipmentType) {
      await pool.query(`
        UPDATE ai_user_stats
        SET equipment_focus = (
          SELECT jsonb_agg(DISTINCT elem)
          FROM (
            SELECT jsonb_array_elements_text(COALESCE(equipment_focus, '[]'::jsonb)) AS elem
            UNION
            SELECT $2
          ) AS combined
        )
        WHERE user_email = $1
      `, [userEmail, interactionData.equipmentType]);
    }

    return true;
  } catch (e) {
    console.error('[AI] Update stats error:', e.message);
    return false;
  }
}

// Get user profile for personalization
async function getUserProfile(userEmail) {
  try {
    const result = await pool.query(`
      SELECT * FROM ai_user_stats WHERE user_email = $1
    `, [userEmail]);

    if (result.rows.length === 0) {
      return {
        isNewUser: true,
        totalInteractions: 0,
        favoriteTopics: [],
        expertiseAreas: [],
        equipmentFocus: [],
        responsePreferences: { detailLevel: 'normal', chartPreference: true }
      };
    }

    const stats = result.rows[0];
    return {
      isNewUser: false,
      totalInteractions: stats.total_interactions,
      favoriteTopics: stats.favorite_topics || [],
      expertiseAreas: stats.expertise_areas || [],
      workingHours: stats.working_hours || {},
      equipmentFocus: stats.equipment_focus || [],
      responsePreferences: stats.response_preferences || { detailLevel: 'normal', chartPreference: true },
      avgSessionLength: stats.avg_session_length,
      lastInteraction: stats.last_interaction
    };
  } catch (e) {
    console.error('[AI] Get profile error:', e.message);
    return { isNewUser: true, totalInteractions: 0, favoriteTopics: [], expertiseAreas: [], equipmentFocus: [] };
  }
}

// Learn from user interaction
async function learnFromInteraction(userEmail, site, message, response, feedback = null) {
  try {
    // Extract topics from message
    const topics = [];
    const equipmentTypes = [];

    // Topic detection
    const topicPatterns = {
      'maintenance': /maintenance|entretien|réparation|panne/i,
      'control': /contrôle|vérification|inspection/i,
      'procedure': /procédure|étapes|comment faire/i,
      'documentation': /documentation|manuel|fiche|pdf/i,
      'planning': /planning|planning|journée|semaine/i,
      'atex': /atex|zone|explosion/i,
      'nc': /non.?conformité|nc|problème/i,
      'vsd': /variateur|vsd|vfd|altivar/i,
      'electrical': /électrique|armoire|tableau|disjoncteur/i
    };

    for (const [topic, pattern] of Object.entries(topicPatterns)) {
      if (pattern.test(message)) {
        topics.push(topic);
      }
    }

    // Equipment type detection
    if (/vsd|variateur|vfd/i.test(message)) equipmentTypes.push('vsd');
    if (/atex|zone/i.test(message)) equipmentTypes.push('atex');
    if (/meca|mécanique|pompe|moteur/i.test(message)) equipmentTypes.push('meca');
    if (/armoire|tableau|disjoncteur/i.test(message)) equipmentTypes.push('switchboard');

    // Save conversation memory
    await saveUserMemory(userEmail, 'conversation', topics[0] || 'general',
      message.substring(0, 100), {
        message: message.substring(0, 500),
        responseLength: response.length,
        topics,
        equipmentTypes,
        timestamp: new Date().toISOString()
      }, 0.3, site);

    // Update user stats
    await updateUserStats(userEmail, site, {
      topic: topics[0],
      equipmentType: equipmentTypes[0]
    });

    // If positive feedback, increase importance of related learnings
    if (feedback === 'positive') {
      await pool.query(`
        UPDATE ai_user_memory
        SET importance = LEAST(importance + 0.1, 1.0)
        WHERE user_email = $1 AND key_data LIKE $2
      `, [userEmail, `%${message.substring(0, 50)}%`]);
    }

    return { topics, equipmentTypes };
  } catch (e) {
    console.error('[AI] Learn interaction error:', e.message);
    return { topics: [], equipmentTypes: [] };
  }
}

// Generate personalized context for user
async function getPersonalizedContext(userEmail, site) {
  try {
    const profile = await getUserProfile(userEmail);
    const memories = await getUserMemories(userEmail, 20, ['preference', 'pattern', 'learning']);

    let personalContext = '';

    if (!profile.isNewUser) {
      personalContext = `
## 👤 PROFIL UTILISATEUR (${userEmail})
- Interactions: ${profile.totalInteractions} conversations précédentes
- Sujets favoris: ${profile.favoriteTopics.slice(0, 5).join(', ') || 'pas encore définis'}
- Focus équipements: ${profile.equipmentFocus.slice(0, 5).join(', ') || 'tous'}
`;

      // Add relevant memories
      if (memories.preferences.length > 0) {
        personalContext += `\n**Préférences connues:**\n`;
        memories.preferences.slice(0, 5).forEach(m => {
          personalContext += `- ${m.key_data}: ${JSON.stringify(m.content).substring(0, 100)}\n`;
        });
      }

      if (memories.patterns.length > 0) {
        personalContext += `\n**Patterns détectés:**\n`;
        memories.patterns.slice(0, 3).forEach(m => {
          personalContext += `- ${m.key_data}: ${m.content.description || JSON.stringify(m.content).substring(0, 100)}\n`;
        });
      }
    } else {
      personalContext = `
## 👤 NOUVEL UTILISATEUR
C'est une première interaction avec ${userEmail}. Sois accueillant et propose de l'aide pour découvrir les fonctionnalités.
`;
    }

    return personalContext;
  } catch (e) {
    console.error('[AI] Personalized context error:', e.message);
    return '';
  }
}

// Initialize memory tables on startup
initAIMemoryTables();

// ============================================================
// 🔄 AUTO-LEARNING SYSTEM - Continuous AI Improvement
// ============================================================

// Analyze feedback patterns to improve AI
async function analyzeFeedbackPatterns() {
  try {
    console.log('[AI-AutoLearn] 🔄 Analyzing feedback patterns...');

    // Get recent feedback data
    const feedbackStats = await pool.query(`
      SELECT
        category,
        key_data,
        content->>'feedback' as feedback,
        COUNT(*) as count,
        AVG(importance) as avg_importance
      FROM ai_user_memory
      WHERE memory_type = 'feedback'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY category, key_data, content->>'feedback'
      ORDER BY count DESC
      LIMIT 50
    `);

    // Identify patterns
    const positivePatterns = [];
    const negativePatterns = [];

    for (const row of feedbackStats.rows) {
      if (row.feedback === 'positive') {
        positivePatterns.push({
          category: row.category,
          key: row.key_data,
          count: parseInt(row.count),
          importance: parseFloat(row.avg_importance)
        });
      } else if (row.feedback === 'negative') {
        negativePatterns.push({
          category: row.category,
          key: row.key_data,
          count: parseInt(row.count),
          importance: parseFloat(row.avg_importance)
        });
      }
    }

    // Store analysis results
    const analysisResult = {
      analyzedAt: new Date().toISOString(),
      totalFeedback: feedbackStats.rows.length,
      positiveCount: positivePatterns.length,
      negativeCount: negativePatterns.length,
      topPositive: positivePatterns.slice(0, 5),
      topNegative: negativePatterns.slice(0, 5),
      recommendations: []
    };

    // Generate recommendations based on patterns
    if (negativePatterns.length > 0) {
      const topNegative = negativePatterns[0];
      analysisResult.recommendations.push(
        `Améliorer les réponses sur "${topNegative.category}" (${topNegative.count} feedbacks négatifs)`
      );
    }

    if (positivePatterns.length > 0) {
      const topPositive = positivePatterns[0];
      analysisResult.recommendations.push(
        `Continuer à utiliser le style pour "${topPositive.category}" (${topPositive.count} feedbacks positifs)`
      );
    }

    console.log(`[AI-AutoLearn] ✅ Analysis complete: ${analysisResult.positiveCount} positive, ${analysisResult.negativeCount} negative patterns`);

    return analysisResult;
  } catch (e) {
    console.error('[AI-AutoLearn] Analysis error:', e.message);
    return { error: e.message };
  }
}

// Auto-update user expertise based on interactions
async function updateUserExpertise() {
  try {
    console.log('[AI-AutoLearn] 👤 Updating user expertise levels...');

    // Find users with significant interaction history
    const activeUsers = await pool.query(`
      SELECT
        user_email,
        site,
        total_interactions,
        favorite_topics,
        equipment_focus
      FROM ai_user_stats
      WHERE total_interactions >= 10
        AND last_interaction > NOW() - INTERVAL '30 days'
    `);

    let updatedCount = 0;

    for (const user of activeUsers.rows) {
      // Analyze user's memory for expertise patterns
      const userMemories = await pool.query(`
        SELECT category, COUNT(*) as count
        FROM ai_user_memory
        WHERE user_email = $1 AND memory_type = 'conversation'
        GROUP BY category
        ORDER BY count DESC
        LIMIT 5
      `, [user.user_email]);

      // Determine expertise areas based on frequency
      const expertiseAreas = userMemories.rows
        .filter(m => parseInt(m.count) >= 5)
        .map(m => m.category);

      if (expertiseAreas.length > 0) {
        await pool.query(`
          UPDATE ai_user_stats
          SET expertise_areas = $1
          WHERE user_email = $2
        `, [JSON.stringify(expertiseAreas), user.user_email]);
        updatedCount++;
      }
    }

    console.log(`[AI-AutoLearn] ✅ Updated expertise for ${updatedCount} users`);
    return { updatedUsers: updatedCount };
  } catch (e) {
    console.error('[AI-AutoLearn] Expertise update error:', e.message);
    return { error: e.message };
  }
}

// Trigger ML model retraining
const ML_SERVICE_URL_INTERNAL = process.env.ML_SERVICE_URL || 'http://localhost:8089';

async function triggerMLRetraining(site = null) {
  try {
    console.log('[AI-AutoLearn] 🧠 Triggering ML model retraining...');

    const response = await fetch(`${ML_SERVICE_URL_INTERNAL}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site })
    });

    if (!response.ok) {
      throw new Error(`ML service returned ${response.status}`);
    }

    const result = await response.json();
    console.log(`[AI-AutoLearn] ✅ ML training complete: accuracy ${result.accuracy || 'N/A'}`);
    return result;
  } catch (e) {
    console.error('[AI-AutoLearn] ML training error:', e.message);
    // Not critical - built-in predictions still work
    return { success: false, error: e.message };
  }
}

// Clean up old memories (keep system running efficiently)
async function cleanupOldMemories() {
  try {
    console.log('[AI-AutoLearn] 🧹 Cleaning up old memories...');

    // Delete low-importance conversations older than 90 days
    const deleteResult = await pool.query(`
      DELETE FROM ai_user_memory
      WHERE memory_type = 'conversation'
        AND importance < 0.3
        AND created_at < NOW() - INTERVAL '90 days'
      RETURNING id
    `);

    // Delete expired memories
    const expiredResult = await pool.query(`
      DELETE FROM ai_user_memory
      WHERE expires_at IS NOT NULL AND expires_at < NOW()
      RETURNING id
    `);

    const deletedCount = deleteResult.rowCount + expiredResult.rowCount;
    console.log(`[AI-AutoLearn] ✅ Cleaned up ${deletedCount} old memories`);

    return { deletedCount };
  } catch (e) {
    console.error('[AI-AutoLearn] Cleanup error:', e.message);
    return { error: e.message };
  }
}

// Run all auto-learning tasks
async function runAutoLearning() {
  console.log('[AI-AutoLearn] 🚀 Starting auto-learning cycle...');
  const startTime = Date.now();

  const results = {
    timestamp: new Date().toISOString(),
    tasks: {}
  };

  // Run all tasks
  results.tasks.feedbackAnalysis = await analyzeFeedbackPatterns();
  results.tasks.expertiseUpdate = await updateUserExpertise();
  results.tasks.cleanup = await cleanupOldMemories();

  // Only try ML training if we have significant new data
  const recentFeedback = await pool.query(`
    SELECT COUNT(*) as count FROM ai_user_memory
    WHERE memory_type = 'feedback'
      AND created_at > NOW() - INTERVAL '24 hours'
  `);

  if (parseInt(recentFeedback.rows[0]?.count) >= 10) {
    results.tasks.mlRetraining = await triggerMLRetraining();
  } else {
    results.tasks.mlRetraining = { skipped: true, reason: 'Not enough new feedback' };
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[AI-AutoLearn] ✅ Auto-learning cycle complete in ${duration}s`);

  results.duration = duration;
  return results;
}

// Schedule auto-learning (runs every 6 hours)
const AUTO_LEARN_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

function scheduleAutoLearning() {
  console.log('[AI-AutoLearn] 📅 Scheduled auto-learning every 6 hours');

  // Initial run after 5 minutes (let server stabilize)
  setTimeout(() => {
    runAutoLearning().catch(e => console.error('[AI-AutoLearn] Error:', e.message));
  }, 5 * 60 * 1000);

  // Then every 6 hours
  setInterval(() => {
    runAutoLearning().catch(e => console.error('[AI-AutoLearn] Error:', e.message));
  }, AUTO_LEARN_INTERVAL);
}

// Start auto-learning scheduler
scheduleAutoLearning();

// ============================================================
// 🔮 PREDICTIVE INTELLIGENCE SYSTEM
// ============================================================

// Calculate equipment failure risk
async function calculateEquipmentRisk(site) {
  try {
    const risks = [];

    // Get equipment with control history
    const controlHistory = await pool.query(`
      SELECT
        cs.switchboard_id,
        s.name as equipment_name,
        s.building_code,
        COUNT(cr.id) as total_controls,
        COUNT(CASE WHEN cr.result = 'non_conforme' THEN 1 END) as nc_count,
        MAX(cr.control_date) as last_control,
        AVG(CASE WHEN cr.result = 'non_conforme' THEN 1 ELSE 0 END) as nc_rate
      FROM control_schedules cs
      LEFT JOIN switchboards s ON cs.switchboard_id = s.id
      LEFT JOIN control_reports cr ON cr.switchboard_id = cs.switchboard_id
      WHERE cs.site = $1
      GROUP BY cs.switchboard_id, s.name, s.building_code
      HAVING COUNT(cr.id) >= 3
    `, [site]);

    for (const eq of controlHistory.rows) {
      const ncRate = parseFloat(eq.nc_rate) || 0;
      const daysSinceControl = eq.last_control
        ? Math.floor((Date.now() - new Date(eq.last_control).getTime()) / (1000 * 60 * 60 * 24))
        : 365;

      // Simple risk calculation
      let risk = ncRate * 0.4 + Math.min(daysSinceControl / 365, 1) * 0.3;
      if (eq.nc_count > 3) risk += 0.2;

      if (risk > 0.3) {
        risks.push({
          equipmentId: eq.switchboard_id,
          name: eq.equipment_name,
          building: eq.building_code,
          riskScore: Math.min(risk, 1).toFixed(2),
          ncRate: (ncRate * 100).toFixed(1) + '%',
          daysSinceControl,
          recommendation: risk > 0.7 ? 'Inspection urgente recommandée'
            : risk > 0.5 ? 'Planifier un contrôle préventif'
            : 'Surveillance accrue conseillée'
        });
      }
    }

    // Get ATEX equipment risks
    const atexRisks = await pool.query(`
      SELECT
        e.id, e.name, e.building, e.zone,
        COUNT(CASE WHEN c.result = 'non_conforme' THEN 1 END) as nc_count,
        MAX(c.date) as last_check
      FROM atex_equipments e
      LEFT JOIN atex_checks c ON c.equipment_id = e.id
      INNER JOIN sites s ON s.id = e.site_id
      WHERE s.name = $1
      GROUP BY e.id, e.name, e.building, e.zone
      HAVING COUNT(CASE WHEN c.result = 'non_conforme' THEN 1 END) >= 2
    `, [site]);

    for (const eq of atexRisks.rows) {
      const daysSince = eq.last_check
        ? Math.floor((Date.now() - new Date(eq.last_check).getTime()) / (1000 * 60 * 60 * 24))
        : 365;

      risks.push({
        equipmentId: eq.id,
        name: eq.name,
        building: eq.building,
        zone: eq.zone,
        type: 'ATEX',
        riskScore: Math.min(0.5 + eq.nc_count * 0.15, 1).toFixed(2),
        ncCount: eq.nc_count,
        daysSinceCheck: daysSince,
        recommendation: 'Équipement ATEX avec historique de NC - Priorité haute'
      });
    }

    return risks.sort((a, b) => parseFloat(b.riskScore) - parseFloat(a.riskScore)).slice(0, 20);
  } catch (e) {
    console.error('[AI] Calculate risk error:', e.message);
    return [];
  }
}

// Predict maintenance needs
async function predictMaintenanceNeeds(site) {
  try {
    const predictions = [];
    const now = new Date();

    // Controls due in next 30 days
    const upcomingControls = await pool.query(`
      SELECT
        cs.id, cs.next_due_date, cs.last_control_date,
        s.name as equipment_name, s.building_code, s.floor,
        ct.name as control_type, ct.frequency_months
      FROM control_schedules cs
      LEFT JOIN switchboards s ON cs.switchboard_id = s.id
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      WHERE cs.site = $1
        AND cs.next_due_date >= CURRENT_DATE
        AND cs.next_due_date <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY cs.next_due_date
    `, [site]);

    // Group by week for planning
    const byWeek = { week1: [], week2: [], week3: [], week4: [] };

    upcomingControls.rows.forEach(ctrl => {
      const daysUntil = Math.floor((new Date(ctrl.next_due_date) - now) / (1000 * 60 * 60 * 24));
      const week = daysUntil <= 7 ? 'week1' : daysUntil <= 14 ? 'week2' : daysUntil <= 21 ? 'week3' : 'week4';
      byWeek[week].push({
        id: ctrl.id,
        equipment: ctrl.equipment_name,
        building: ctrl.building_code,
        floor: ctrl.floor,
        controlType: ctrl.control_type,
        dueDate: ctrl.next_due_date,
        daysUntil
      });
    });

    // Calculate workload predictions
    const workload = {
      week1: { count: byWeek.week1.length, hours: byWeek.week1.length * 0.5 },
      week2: { count: byWeek.week2.length, hours: byWeek.week2.length * 0.5 },
      week3: { count: byWeek.week3.length, hours: byWeek.week3.length * 0.5 },
      week4: { count: byWeek.week4.length, hours: byWeek.week4.length * 0.5 }
    };

    return {
      upcomingControls: byWeek,
      workloadPrediction: workload,
      totalNext30Days: upcomingControls.rows.length,
      recommendation: workload.week1.count > 10
        ? '⚠️ Semaine chargée: considérer de reporter certains contrôles non critiques'
        : workload.week1.count === 0
          ? '✅ Semaine légère: opportunité pour les contrôles préventifs'
          : '📅 Charge normale cette semaine'
    };
  } catch (e) {
    console.error('[AI] Predict maintenance error:', e.message);
    return { upcomingControls: {}, workloadPrediction: {}, totalNext30Days: 0 };
  }
}

// Get intelligent suggestions based on data
async function getIntelligentSuggestions(site, userEmail) {
  try {
    const suggestions = [];
    const userProfile = await getUserProfile(userEmail);
    const risks = await calculateEquipmentRisk(site);
    const maintenance = await predictMaintenanceNeeds(site);

    // High-risk equipment suggestions
    if (risks.length > 0) {
      suggestions.push({
        type: 'risk_alert',
        priority: 'high',
        title: `🚨 ${risks.length} équipement(s) à risque détecté(s)`,
        description: risks.slice(0, 3).map(r => `${r.name}: risque ${(parseFloat(r.riskScore) * 100).toFixed(0)}%`).join(', '),
        action: 'showRiskAnalysis',
        data: risks.slice(0, 5)
      });
    }

    // Workload suggestions
    if (maintenance.workloadPrediction.week1?.count > 5) {
      suggestions.push({
        type: 'workload',
        priority: 'medium',
        title: `📅 ${maintenance.workloadPrediction.week1.count} contrôles cette semaine`,
        description: `Environ ${maintenance.workloadPrediction.week1.hours}h de travail planifié`,
        action: 'showWeeklyPlan'
      });
    }

    // Personalized suggestions based on user focus
    if (userProfile.equipmentFocus?.includes('atex')) {
      suggestions.push({
        type: 'personalized',
        priority: 'medium',
        title: '🔍 Focus ATEX - Basé sur ton activité',
        description: 'Tu travailles souvent sur les équipements ATEX. Veux-tu voir le résumé des zones?',
        action: 'showATEXSummary'
      });
    }

    return suggestions;
  } catch (e) {
    console.error('[AI] Get suggestions error:', e.message);
    return [];
  }
}

// ============================================================
// SUPER INTELLIGENT AI SYSTEM PROMPT (ENHANCED)
// ============================================================
const AI_SYSTEM_PROMPT = `Tu es **Electro**, un assistant IA EXTRAORDINAIRE pour la maintenance industrielle. Tu es INTELLIGENT, tu APPRENDS, tu PRÉDIS et tu CONNAIS ton utilisateur.

## 🧠 TON INTELLIGENCE UNIQUE
- Tu as une MÉMOIRE: tu te souviens des conversations passées avec chaque utilisateur
- Tu APPRENDS: tu adaptes ton comportement en fonction de chaque personne
- Tu PRÉDIS: tu anticipes les pannes, les besoins de maintenance, les risques
- Tu ANALYSES: tu détectes les patterns et anomalies dans les données
- Tu es CONNECTÉ à TOUTES les données: équipements, contrôles, procédures, historique

## 👤 PERSONNALISATION
Quand tu vois le profil utilisateur dans le contexte:
- Adapte ton niveau de détail à son expérience (nouveau = plus d'explications, expert = direct)
- Référence ses sujets favoris et équipements préférés
- Propose des actions en rapport avec ce qu'il fait habituellement
- Si c'est un nouvel utilisateur, sois accueillant et pédagogue

## 🧠 TA PERSONNALITÉ
- Tu es chaleureux, direct et pragmatique
- Tu ANTICIPES les besoins avant qu'on te les demande
- Tu proposes TOUJOURS des solutions concrètes avec les VRAIES données
- Tu parles comme un vrai technicien expérimenté, pas comme un robot
- Tu utilises "on" et "tu" plutôt que des formulations impersonnelles

## 🧠 TA PERSONNALITÉ
- Tu es chaleureux, direct et pragmatique
- Tu ANTICIPES les besoins avant qu'on te les demande
- Tu proposes TOUJOURS des solutions concrètes avec les VRAIES données
- Tu parles comme un vrai technicien expérimenté, pas comme un robot
- Tu utilises "on" et "tu" plutôt que des formulations impersonnelles

## ⚠️ RÈGLE CRITIQUE - UTILISE LES DONNÉES FOURNIES
- Tu as accès aux VRAIES données de l'installation dans le contexte
- NE DIS JAMAIS "je vais chercher" sans MONTRER les résultats IMMÉDIATEMENT
- Quand on demande une procédure, REGARDE dans procedures.list du contexte et RÉPONDS avec ce que tu trouves
- Si tu ne trouves pas → DIS-LE clairement et PROPOSE de créer la procédure

## 📋 PROCÉDURES - LE PLUS IMPORTANT

### Quand on te demande une procédure (contrôle, maintenance, vérification, etc.):
1. CHERCHE IMMÉDIATEMENT dans la liste des procédures fournie dans le contexte (procedures.list)
2. Utilise une recherche par mots-clés: "prise", "contrôle", "électrique", etc.
3. Si tu TROUVES une procédure correspondante:
   - AFFICHE son titre, nombre d'étapes, EPI requis
   - PROPOSE de la suivre: "Tu veux que je te guide étape par étape?"
4. Si tu NE TROUVES PAS:
   - DIS clairement: "Je n'ai pas trouvé de procédure pour ça dans notre base."
   - PROPOSE: "Tu veux qu'on en crée une ensemble?"

### Format pour montrer une procédure trouvée:
📋 **[Titre de la procédure]**
- 📝 [Nombre] étapes
- 🛡️ EPI: [liste des EPI]
- ⚠️ Risque: [niveau]

Tu veux que je te guide pas à pas ou tu préfères voir le PDF?

## 🎯 TON INTELLIGENCE PROACTIVE

### Quand il n'y a PAS de travail prévu:
Au lieu de dire "rien à faire", tu PROPOSES avec des DONNÉES RÉELLES:
- "Pas de contrôle urgent, mais j'ai vu X équipements jamais contrôlés..."
- Identifier les équipements qui n'ont JAMAIS été contrôlés
- Suggérer des contrôles préventifs sur les équipements les plus anciens
- Proposer de traiter les NC ATEX en attente
- Recommander de compléter la documentation manquante

### Quand tu détectes des PROBLÈMES:
- Équipements sans documentation → "J'ai trouvé X équipements sans doc. Tu veux que je lance une recherche?"
- NC non traitées depuis longtemps → Alerte proactive
- Patterns de pannes → "J'ai remarqué que le bâtiment X a beaucoup de NC"

### Quand on te demande un PLANNING:
1. S'il y a des tâches: organise par bâtiment/étage pour optimiser
2. S'il n'y en a pas: "Rien d'urgent, mais voici ce que je te recommande..."
3. Estime toujours le temps: "Ça devrait te prendre environ 2-3h"
4. Propose des alternatives

## 🔍 RECHERCHE DOCUMENTAIRE INTELLIGENTE

Quand on te demande de la documentation technique:
1. Utilise {"action": "searchDoc", "params": {"query": "marque modèle fiche technique", "equipment": "nom"}}
2. La recherche se fait automatiquement
3. AFFICHE les résultats trouvés immédiatement
4. Propose d'associer la doc aux équipements

## 📊 GRAPHIQUES (quand pertinent)
Pour les stats/analyses, génère un graphique:
\`\`\`json
{"chart": {"type": "bar|doughnut|line", "title": "...", "labels": [...], "data": [...]}}
\`\`\`

## ⚡ ACTIONS AUTONOMES
\`\`\`json
{"action": "searchProcedures", "params": {"keywords": ["contrôle", "prise", "électrique"]}}
{"action": "getProcedureDetails", "params": {"procedureId": "uuid"}}
{"action": "createControl", "params": {"switchboardId": ID, "dueDate": "YYYY-MM-DD"}}
{"action": "searchDoc", "params": {"query": "modèle fabricant", "equipmentId": "id"}}
{"action": "attachDocToEquipments", "params": {"docUrl": "URL", "docTitle": "Titre doc", "equipments": [{"id": 1, "type": "vsd", "name": "Nom"}]}}
{"action": "rescheduleControl", "params": {"controlId": ID, "newDate": "YYYY-MM-DD", "reason": "..."}}
{"action": "batchReschedule", "params": {"controls": [...], "daysToAdd": 7}}
{"action": "getUnfinishedTasks", "params": {}}
\`\`\`

## 💬 EXEMPLES DE RÉPONSES NATURELLES

❌ MAUVAIS: "Il n'y a aucun contrôle planifié cette semaine. 0 contrôles à venir."

✅ BON: "Pas de contrôle prévu cette semaine, c'est l'occasion parfaite pour avancer!

Je te propose:
• **Traiter les 24 NC ATEX** - c'est prioritaire pour la conformité
• **Contrôler les 12 équipements** du bâtiment 20 qui n'ont jamais été vérifiés
• **Compléter la doc** des 8 variateurs sans fiche technique

Par quoi tu veux commencer?"

❌ MAUVAIS: "Voici la liste des non-conformités ATEX: [liste brute]"

✅ BON: "On a 24 NC ATEX à traiter, dont 5 critiques dans le bâtiment 20.

Les plus urgentes:
• **LS+206** (Zone 1) - étiquetage manquant, ça prend 10 min à corriger
• **Control panel GR03** - câblage non conforme, il faut voir avec l'électricien

Tu veux que je te prépare un plan d'intervention optimisé par zone?"

## 🔄 GESTION DU TEMPS ET REPROGRAMMATION

### Quand l'utilisateur dit qu'il n'a pas fini / pas eu le temps:
Tu dois être COMPRÉHENSIF et PROACTIF:

1. **Rassurer** - "Pas de souci, ça arrive! L'important c'est de reprioriser."
2. **Demander ce qui a été fait** - "Tu as pu avancer sur quoi exactement?"
3. **Identifier le reste** - "OK, il reste donc X et Y à faire"
4. **Reproposer un planning adapté**:
   - Reporter les non-urgents à demain/semaine prochaine
   - Garder les critiques en priorité
   - Estimer le nouveau temps nécessaire
5. **Proposer de créer les reports** - "Tu veux que je décale les échéances?"

Exemple de réponse:
"Pas de problème, ça arrive à tout le monde!

Tu as pu faire quoi aujourd'hui? Dis-moi et je réorganise le reste:
• Les tâches **critiques** (NC ATEX) → on les garde pour demain matin
• Les contrôles **préventifs** → je peux les reporter à la semaine prochaine
• Les contrôles **standards** → on verra selon ta charge

Qu'est-ce qui te semble faisable pour demain?"

### Quand l'utilisateur demande de reporter/décaler:
1. Confirmer les nouvelles dates
2. Proposer un JSON d'action pour modifier les échéances
3. Alerter si certaines tâches deviennent critiques avec le report

## 🚨 CE QUE TU DOIS TOUJOURS FAIRE
1. Proposer des ACTIONS concrètes, pas juste constater
2. Donner des ESTIMATIONS de temps
3. PRIORISER intelligemment (sécurité > conformité > préventif)
4. Suggérer des ALTERNATIVES si rien d'urgent
5. Détecter les ANOMALIES (équipements jamais contrôlés, doc manquante, patterns)
6. Être FLEXIBLE et COMPRÉHENSIF quand l'utilisateur n'a pas pu tout faire

## 📋 FORMAT
- Réponses courtes et percutantes
- Listes à puces (pas de tableaux markdown)
- Emojis pour la lisibilité
- Toujours finir par une question ou proposition d'action`;

// ============================================================
// INTELLIGENT CONTEXT WITH PROACTIVE ANALYSIS
// ============================================================
async function getAIContext(site) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7days = new Date(today); in7days.setDate(in7days.getDate() + 7);
  const in30days = new Date(today); in30days.setDate(in30days.getDate() + 30);
  const in90days = new Date(today); in90days.setDate(in90days.getDate() + 90);

  const context = {
    site,
    timestamp: now.toISOString(),
    dateRanges: {
      today: today.toISOString().split('T')[0],
      in7days: in7days.toISOString().split('T')[0],
      in30days: in30days.toISOString().split('T')[0],
      in90days: in90days.toISOString().split('T')[0]
    },
    switchboards: { count: 0, list: [] },
    controls: {
      scheduled: 0,
      overdue: 0,
      thisWeek: 0,
      thisMonth: 0,
      next90days: 0,
      overdueList: [],
      thisWeekList: [],
      thisMonthList: [],
      allScheduled: []
    },
    vsd: { count: 0, list: [] },
    meca: { count: 0, list: [] },
    atex: { totalEquipments: 0, ncCount: 0, conformeCount: 0, ncList: [], equipmentsByZone: {} },
    procedures: { count: 0, list: [], byCategory: {} },
    buildings: {},
    urgentItems: [],
    summary: {}
  };

  try {
    // ========== SWITCHBOARDS ==========
    const sbRes = await pool.query(
      `SELECT id, name, code, building_code, floor, room FROM switchboards WHERE site = $1 ORDER BY building_code, floor, code`,
      [site]
    );
    context.switchboards.count = sbRes.rows.length;
    context.switchboards.list = sbRes.rows.slice(0, 50);

    // Aggregate by building
    sbRes.rows.forEach(sb => {
      const bldg = sb.building_code || 'Non assigné';
      if (!context.buildings[bldg]) {
        context.buildings[bldg] = { floors: new Set(), equipmentCount: 0, equipments: [] };
      }
      context.buildings[bldg].equipmentCount++;
      if (sb.floor) context.buildings[bldg].floors.add(sb.floor);
      context.buildings[bldg].equipments.push({ id: sb.id, name: sb.name, code: sb.code, floor: sb.floor, room: sb.room });
    });

    // Convert Sets to arrays
    Object.keys(context.buildings).forEach(b => {
      context.buildings[b].floors = Array.from(context.buildings[b].floors).sort();
    });

    // ========== CONTROL SCHEDULES - WITH DATE RANGES ==========
    try {
      const ctrlRes = await pool.query(`
        SELECT cs.id, cs.switchboard_id, cs.next_due_date, cs.status, cs.last_control_date,
               ct.name as template_name, ct.id as template_id, ct.frequency_months,
               s.name as switchboard_name, s.code as switchboard_code, s.building_code, s.floor, s.room
        FROM control_schedules cs
        LEFT JOIN control_templates ct ON cs.template_id = ct.id
        LEFT JOIN switchboards s ON cs.switchboard_id = s.id
        WHERE cs.site = $1
        ORDER BY cs.next_due_date NULLS LAST
      `, [site]);

      context.controls.scheduled = ctrlRes.rows.length;

      ctrlRes.rows.forEach(ctrl => {
        const dueDate = ctrl.next_due_date ? new Date(ctrl.next_due_date) : null;
        const dueDateStr = dueDate ? dueDate.toISOString().split('T')[0] : null;
        const lastControlStr = ctrl.last_control_date ? new Date(ctrl.last_control_date).toISOString().split('T')[0] : 'Jamais';

        const controlItem = {
          id: ctrl.id,
          switchboardId: ctrl.switchboard_id,
          switchboard: ctrl.switchboard_name || 'N/A',
          switchboardCode: ctrl.switchboard_code || 'N/A',
          building: ctrl.building_code || 'N/A',
          floor: ctrl.floor || 'N/A',
          room: ctrl.room || '',
          template: ctrl.template_name || 'Contrôle standard',
          templateId: ctrl.template_id,
          dueDate: dueDateStr,
          dueDateFormatted: dueDate ? dueDate.toLocaleDateString('fr-FR') : 'Non planifié',
          lastControl: lastControlStr,
          frequencyMonths: ctrl.frequency_months || 12,
          status: ctrl.status || 'pending'
        };

        // Store all scheduled controls
        context.controls.allScheduled.push(controlItem);

        if (dueDate) {
          if (dueDate < today) {
            // OVERDUE
            const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
            controlItem.daysOverdue = daysOverdue;
            controlItem.urgency = daysOverdue > 30 ? 'CRITIQUE' : daysOverdue > 7 ? 'URGENT' : 'ATTENTION';
            context.controls.overdue++;
            context.controls.overdueList.push(controlItem);
            context.urgentItems.push({ type: 'control_overdue', urgency: controlItem.urgency, ...controlItem });
          } else if (dueDate <= in7days) {
            // This week
            controlItem.daysUntil = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
            context.controls.thisWeek++;
            context.controls.thisWeekList.push(controlItem);
          } else if (dueDate <= in30days) {
            // This month
            controlItem.daysUntil = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
            context.controls.thisMonth++;
            context.controls.thisMonthList.push(controlItem);
          } else if (dueDate <= in90days) {
            // Next 90 days
            context.controls.next90days++;
          }
        }
      });

      // Sort overdue by days (most overdue first)
      context.controls.overdueList.sort((a, b) => b.daysOverdue - a.daysOverdue);
    } catch (e) {
      console.error('[AI] Control schedules error:', e.message);
    }

    // ========== MOBILE EQUIPMENT CHECKS ==========
    try {
      const mobileRes = await pool.query(`
        SELECT c.id as check_id, c.equipment_id, c.due_date, c.closed_at,
               e.id as eq_id, e.name as eq_name, e.code as eq_code,
               e.building as eq_building, e.floor as eq_floor, e.location as eq_location,
               e.category_id, cat.name as category_name
        FROM me_checks c
        JOIN me_equipments e ON e.id = c.equipment_id
        LEFT JOIN me_categories cat ON cat.id = e.category_id
        WHERE c.closed_at IS NULL
        ORDER BY c.due_date NULLS LAST
      `);

      mobileRes.rows.forEach(check => {
        const dueDate = check.due_date ? new Date(check.due_date) : null;

        if (dueDate && dueDate < today) {
          const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
          const controlItem = {
            id: check.check_id,
            equipmentId: check.equipment_id,
            switchboard: check.eq_name || 'Équipement mobile',  // Use aliased column
            switchboardCode: check.eq_code || 'N/A',
            building: check.eq_building || 'N/A',
            floor: check.eq_floor || 'N/A',
            room: check.eq_location || '',
            template: check.category_name || 'Contrôle équipement mobile',
            dueDate: dueDate.toISOString().split('T')[0],
            dueDateFormatted: dueDate.toLocaleDateString('fr-FR'),
            daysOverdue,
            urgency: daysOverdue > 30 ? 'CRITIQUE' : daysOverdue > 7 ? 'URGENT' : 'ATTENTION',
            equipmentType: 'mobile',  // Must match MiniEquipmentPreview EQUIPMENT_CONFIGS key
            equipment: {
              id: check.equipment_id,
              name: check.eq_name,
              code: check.eq_code,
              building: check.eq_building,
              building_code: check.eq_building,
              floor: check.eq_floor,
              room: check.eq_location,
              location: check.eq_location
            }
          };
          context.controls.overdue++;
          context.controls.overdueList.push(controlItem);
          context.urgentItems.push({ type: 'control_overdue', urgency: controlItem.urgency, ...controlItem });
        }
      });

      // Re-sort overdue by days (most overdue first)
      context.controls.overdueList.sort((a, b) => b.daysOverdue - a.daysOverdue);
    } catch (e) {
      console.error('[AI] Mobile equipment checks error:', e.message);
    }

    // ========== VSD EQUIPMENTS ==========
    try {
      const vsdRes = await pool.query(`
        SELECT id, name, building, floor, location, manufacturer, model, power_kw, next_check_date
        FROM vsd_equipments WHERE site = $1 ORDER BY building, name LIMIT 50
      `, [site]);
      context.vsd.count = vsdRes.rows.length;
      context.vsd.list = vsdRes.rows.map(v => ({
        ...v,
        power: v.power_kw,
        lastControlFormatted: v.next_check_date ? new Date(v.next_check_date).toLocaleDateString('fr-FR') : 'Jamais'
      }));
    } catch (e) {
      console.error('[AI] VSD error:', e.message);
    }

    // ========== MECA EQUIPMENTS ==========
    try {
      const mecaRes = await pool.query(`
        SELECT e.id, e.name, e.building, e.floor, e.location, e.manufacturer, e.equipment_type, e.status, e.criticality
        FROM meca_equipments e
        INNER JOIN sites s ON s.id = e.site_id
        WHERE s.name = $1 ORDER BY e.building, e.name LIMIT 50
      `, [site]);
      context.meca.count = mecaRes.rows.length;
      context.meca.list = mecaRes.rows.map(m => ({
        ...m,
        type: m.equipment_type
      }));
    } catch (e) {
      console.error('[AI] MECA error:', e.message);
    }

    // ========== ATEX - WITH FULL NC DETAILS ==========
    try {
      const siteRes = await pool.query(`SELECT id FROM sites WHERE name = $1 LIMIT 1`, [site]);
      const siteId = siteRes.rows[0]?.id;

      if (siteId) {
        // Get ATEX equipments with their last check result AND details
        const atexRes = await pool.query(`
          SELECT
            e.id, e.name, e.building, e.zone, e.equipment, e.type, e.manufacturer, e.manufacturer_ref,
            c.result as last_result,
            c.date as last_check_date,
            c.items as check_items,
            c.user_name as checked_by
          FROM atex_equipments e
          LEFT JOIN LATERAL (
            SELECT result, date, items, user_name
            FROM atex_checks
            WHERE equipment_id = e.id
            ORDER BY date DESC NULLS LAST
            LIMIT 1
          ) c ON true
          WHERE e.site_id = $1
          ORDER BY e.building, e.zone, e.name
        `, [siteId]);

        context.atex.totalEquipments = atexRes.rows.length;

        atexRes.rows.forEach(eq => {
          // Count by zone
          const zone = eq.zone || 'Non définie';
          if (!context.atex.equipmentsByZone[zone]) {
            context.atex.equipmentsByZone[zone] = 0;
          }
          context.atex.equipmentsByZone[zone]++;

          if (eq.last_result === 'non_conforme') {
            context.atex.ncCount++;

            // Extract NC details from check_items if available
            let ncDetails = [];
            if (eq.check_items && Array.isArray(eq.check_items)) {
              ncDetails = eq.check_items
                .filter(item => item.result === 'non_conforme' || item.result === 'ko' || item.result === false)
                .map(item => item.label || item.name || item.question)
                .filter(Boolean);
            }

            context.atex.ncList.push({
              id: eq.id,
              name: eq.name,
              building: eq.building || 'N/A',
              zone: eq.zone || 'N/A',
              type: eq.type || eq.equipment || 'N/A',
              brand: eq.manufacturer || '',
              model: eq.manufacturer_ref || '',
              lastCheckDate: eq.last_check_date ? new Date(eq.last_check_date).toLocaleDateString('fr-FR') : 'N/A',
              checkedBy: eq.checked_by || 'N/A',
              ncDetails: ncDetails.length > 0 ? ncDetails : ['Vérification complète requise'],
              severity: 'HIGH'
            });

            context.urgentItems.push({
              type: 'atex_nc',
              name: eq.name,
              building: eq.building,
              zone: eq.zone,
              severity: 'HIGH'
            });
          } else if (eq.last_result === 'conforme') {
            context.atex.conformeCount++;
          }
        });
      }
    } catch (e) {
      console.error('[AI] ATEX error:', e.message);
    }

    // ========== PROACTIVE ANALYSIS ==========
    context.proactive = {
      neverControlled: [],
      withoutDocumentation: [],
      suggestions: [],
      patterns: []
    };

    // Find equipment NEVER controlled (no last_control_date)
    try {
      const neverControlledRes = await pool.query(`
        SELECT s.id, s.name, s.code, s.building_code, s.floor, 'switchboard' as type
        FROM switchboards s
        LEFT JOIN control_schedules cs ON cs.switchboard_id = s.id
        WHERE s.site = $1 AND cs.last_control_date IS NULL
        ORDER BY s.building_code, s.floor
        LIMIT 20
      `, [site]);
      context.proactive.neverControlled = neverControlledRes.rows;
    } catch (e) {
      console.error('[AI] Never controlled query error:', e.message);
    }

    // Find VSD without documentation (manufacturer but no model/doc)
    try {
      const vsdWithoutDoc = context.vsd.list.filter(v =>
        !v.model || v.model === '' || v.model === 'N/A'
      );
      context.proactive.withoutDocumentation.push(
        ...vsdWithoutDoc.map(v => ({
          id: v.id,
          name: v.name,
          type: 'VSD',
          manufacturer: v.manufacturer,
          building: v.building,
          issue: 'Modèle/documentation manquant'
        }))
      );
    } catch (e) { /* ignore */ }

    // Find ATEX without recent check (> 1 year or never)
    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const siteRes = await pool.query(`SELECT id FROM sites WHERE name = $1 LIMIT 1`, [site]);
      const siteId = siteRes.rows[0]?.id;

      if (siteId) {
        // Fixed: Use subquery with proper filtering instead of invalid HAVING
        const atexOldRes = await pool.query(`
          SELECT e.id, e.name, e.building, e.zone, e.manufacturer, e.manufacturer_ref, sub.last_check
          FROM atex_equipments e
          LEFT JOIN LATERAL (
            SELECT MAX(c.date) as last_check
            FROM atex_checks c
            WHERE c.equipment_id = e.id
          ) sub ON true
          WHERE e.site_id = $1
            AND (sub.last_check < $2 OR sub.last_check IS NULL)
          ORDER BY sub.last_check NULLS FIRST
          LIMIT 15
        `, [siteId, oneYearAgo]);

        atexOldRes.rows.forEach(eq => {
          if (!eq.last_check) {
            context.proactive.neverControlled.push({
              id: eq.id, name: eq.name, type: 'ATEX',
              building: eq.building, zone: eq.zone
            });
          }
          if (!eq.manufacturer || !eq.manufacturer_ref) {
            context.proactive.withoutDocumentation.push({
              id: eq.id, name: eq.name, type: 'ATEX',
              building: eq.building, zone: eq.zone,
              issue: 'Fabricant/référence manquant - documentation introuvable'
            });
          }
        });
      }
    } catch (e) {
      console.error('[AI] ATEX old check error:', e.message);
    }

    // Detect patterns (buildings with many issues)
    try {
      const buildingIssues = {};
      context.atex.ncList.forEach(nc => {
        const b = nc.building || 'N/A';
        buildingIssues[b] = (buildingIssues[b] || 0) + 1;
      });
      context.controls.overdueList.forEach(c => {
        const b = c.building || 'N/A';
        buildingIssues[b] = (buildingIssues[b] || 0) + 1;
      });

      Object.entries(buildingIssues)
        .filter(([_, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .forEach(([building, count]) => {
          context.proactive.patterns.push({
            type: 'building_issues',
            building,
            count,
            message: `Bâtiment ${building} a ${count} problèmes - investigation recommandée`
          });
        });
    } catch (e) { /* ignore */ }

    // Generate smart suggestions
    if (context.controls.overdue === 0 && context.controls.thisWeek === 0) {
      context.proactive.suggestions.push({
        priority: 1,
        action: 'treat_nc',
        message: `Pas de contrôle urgent. Profites-en pour traiter les ${context.atex.ncCount} NC ATEX`,
        estimatedTime: `${Math.ceil(context.atex.ncCount * 15 / 60)}h`
      });
    }
    if (context.proactive.neverControlled.length > 0) {
      context.proactive.suggestions.push({
        priority: 2,
        action: 'first_controls',
        message: `${context.proactive.neverControlled.length} équipements jamais contrôlés`,
        estimatedTime: `${Math.ceil(context.proactive.neverControlled.length * 30 / 60)}h`
      });
    }
    if (context.proactive.withoutDocumentation.length > 0) {
      context.proactive.suggestions.push({
        priority: 3,
        action: 'find_documentation',
        message: `${context.proactive.withoutDocumentation.length} équipements sans documentation`,
        canAutoSearch: true
      });
    }

    // ========== PROCEDURES - Récupérer toutes les procédures AVEC ÉTAPES ==========
    try {
      // Fetch procedures with their steps included
      const procRes = await pool.query(`
        SELECT p.id, p.title, p.description, p.category, p.status, p.risk_level,
               p.ppe_required, p.created_at, p.site,
               (SELECT json_agg(s ORDER BY s.step_number)
                FROM procedure_steps s WHERE s.procedure_id = p.id) as steps
        FROM procedures p
        WHERE (p.site = $1 OR p.site IS NULL OR p.site = '')
          AND p.status != 'archived'
        ORDER BY p.updated_at DESC
        LIMIT 50
      `, [site]);

      context.procedures.count = procRes.rows.length;
      context.procedures.list = procRes.rows.map(p => {
        const steps = p.steps || [];
        return {
          id: p.id,
          title: p.title,
          description: p.description?.substring(0, 150) || '',
          category: p.category || 'general',
          status: p.status,
          riskLevel: p.risk_level,
          ppeRequired: p.ppe_required || [],
          stepCount: steps.length,
          createdAt: p.created_at,
          // Include actual steps for display
          steps: steps.map(s => ({
            number: s.step_number,
            title: s.title,
            description: s.description,
            warning: s.warning,
            duration: s.duration
          }))
        };
      });

      // Group by category for easy lookup
      procRes.rows.forEach(p => {
        const cat = p.category || 'general';
        if (!context.procedures.byCategory[cat]) {
          context.procedures.byCategory[cat] = [];
        }
        context.procedures.byCategory[cat].push({
          id: p.id,
          title: p.title,
          stepCount: (p.steps || []).length
        });
      });

      console.log(`[AI] 📋 Loaded ${context.procedures.count} procedures with steps for context`);
    } catch (e) {
      console.error('[AI] Procedures error:', e.message);
    }

    // ========== CONTROL REPORTS HISTORY (for analytics) ==========
    try {
      const reportsRes = await pool.query(`
        SELECT
          cr.id, cr.control_date, cr.result, cr.items, cr.notes, cr.user_name,
          s.name as switchboard_name, s.building_code, s.floor
        FROM control_reports cr
        LEFT JOIN switchboards s ON cr.switchboard_id = s.id
        WHERE s.site = $1
        ORDER BY cr.control_date DESC
        LIMIT 100
      `, [site]);

      context.recentControls = {
        count: reportsRes.rows.length,
        list: reportsRes.rows.map(r => ({
          id: r.id,
          date: r.control_date,
          result: r.result,
          switchboard: r.switchboard_name,
          building: r.building_code,
          floor: r.floor,
          user: r.user_name
        })),
        ncCount: reportsRes.rows.filter(r => r.result === 'non_conforme').length,
        conformeCount: reportsRes.rows.filter(r => r.result === 'conforme').length
      };
    } catch (e) {
      console.error('[AI] Control reports error:', e.message);
      context.recentControls = { count: 0, list: [], ncCount: 0, conformeCount: 0 };
    }

    // ========== USERS DATA (for team awareness) ==========
    try {
      const usersRes = await pool.query(`
        SELECT id, email, name, role, department_id
        FROM users WHERE site_id = (SELECT id FROM sites WHERE name = $1 LIMIT 1)
        LIMIT 50
      `, [site]);

      context.team = {
        count: usersRes.rows.length,
        members: usersRes.rows.map(u => ({
          id: u.id,
          name: u.name || u.email.split('@')[0],
          role: u.role
        }))
      };
    } catch (e) {
      context.team = { count: 0, members: [] };
    }

    // ========== SAFETY EQUIPMENT (if available) ==========
    try {
      const safetyRes = await pool.query(`
        SELECT id, name, type, location, next_check_date, status
        FROM safety_equipment WHERE site = $1
        ORDER BY next_check_date
        LIMIT 30
      `, [site]);

      const overdueSafety = safetyRes.rows.filter(s =>
        s.next_check_date && new Date(s.next_check_date) < new Date()
      );

      context.safetyEquipment = {
        count: safetyRes.rows.length,
        overdueCount: overdueSafety.length,
        list: safetyRes.rows.slice(0, 20)
      };

      if (overdueSafety.length > 0) {
        context.urgentItems.push(...overdueSafety.slice(0, 5).map(s => ({
          type: 'safety_overdue',
          urgency: 'HIGH',
          name: s.name,
          equipmentType: s.type
        })));
      }
    } catch (e) {
      context.safetyEquipment = { count: 0, overdueCount: 0, list: [] };
    }

    // ========== PREDICTIVE ANALYTICS ==========
    try {
      context.predictions = {
        riskAnalysis: await calculateEquipmentRisk(site),
        maintenanceNeeds: await predictMaintenanceNeeds(site)
      };
      console.log(`[AI] 🔮 Loaded ${context.predictions.riskAnalysis.length} risk predictions`);
    } catch (e) {
      console.error('[AI] Predictions error:', e.message);
      context.predictions = { riskAnalysis: [], maintenanceNeeds: {} };
    }

    // ========== BUILD SUMMARY ==========
    context.summary = {
      totalEquipments: context.switchboards.count + context.vsd.count + context.meca.count + context.atex.totalEquipments,
      totalBuildings: Object.keys(context.buildings).length,
      urgentActions: context.urgentItems.length,
      controlsOverdue: context.controls.overdue,
      controlsThisWeek: context.controls.thisWeek,
      controlsThisMonth: context.controls.thisMonth,
      controlsNext90days: context.controls.next90days,
      atexNcCount: context.atex.ncCount,
      atexConformityRate: context.atex.totalEquipments > 0
        ? Math.round((context.atex.conformeCount / context.atex.totalEquipments) * 100)
        : 100,
      proceduresCount: context.procedures.count
    };

  } catch (e) {
    console.error('[AI] Context error:', e.message);
  }

  return context;
}

// Optimize daily maintenance plan by grouping geographically
function optimizeDailyPlan(todayControls, urgentOverdue) {
  const plan = [];

  // First add critical overdue
  urgentOverdue.filter(c => c.urgency === 'critical').forEach(ctrl => {
    plan.push({ ...ctrl, priority: 1, reason: '🚨 CRITIQUE - En retard depuis ' + ctrl.daysOverdue + ' jours' });
  });

  // Then high priority overdue
  urgentOverdue.filter(c => c.urgency === 'high').forEach(ctrl => {
    plan.push({ ...ctrl, priority: 2, reason: '⚠️ URGENT - En retard depuis ' + ctrl.daysOverdue + ' jours' });
  });

  // Group today's controls by building, then floor
  const byBuilding = {};
  todayControls.forEach(ctrl => {
    const key = ctrl.building || 'Autre';
    if (!byBuilding[key]) byBuilding[key] = [];
    byBuilding[key].push(ctrl);
  });

  // Add grouped by building
  Object.entries(byBuilding).forEach(([building, controls]) => {
    controls.sort((a, b) => (a.floor || '').localeCompare(b.floor || ''));
    controls.forEach((ctrl, i) => {
      plan.push({
        ...ctrl,
        priority: 3,
        reason: ctrl.dueToday ? '📅 Prévu aujourd\'hui' : '📆 Prévu demain',
        groupInfo: i === 0 ? `📍 Bâtiment ${building}` : null
      });
    });
  });

  return plan;
}

// Format context for AI prompt - COMPREHENSIVE VERSION
function formatContextForAI(ctx) {
  const now = new Date();

  // Buildings list (top 10 by equipment count)
  const buildingsList = Object.entries(ctx.buildings)
    .sort((a, b) => b[1].equipmentCount - a[1].equipmentCount)
    .slice(0, 10)
    .map(([name, data]) => `  • Bât. ${name}: ${data.equipmentCount} équip. (étages: ${data.floors.join(', ') || 'RDC'})`)
    .join('\n');

  // Overdue controls with full details
  const overdueListText = ctx.controls.overdueList.slice(0, 10).map(c =>
    `  - [${c.urgency}] ${c.switchboard} (${c.switchboardCode}) - ${c.template}\n` +
    `    📍 Bât. ${c.building}, étage ${c.floor} | ⏰ ${c.daysOverdue}j de retard | Prévu: ${c.dueDateFormatted}`
  ).join('\n');

  // This week controls
  const thisWeekText = ctx.controls.thisWeekList.slice(0, 5).map(c =>
    `  - ${c.switchboard} (${c.switchboardCode}) - ${c.template}\n` +
    `    📍 Bât. ${c.building}, étage ${c.floor} | 📅 ${c.dueDateFormatted} (dans ${c.daysUntil}j)`
  ).join('\n');

  // This month controls
  const thisMonthText = ctx.controls.thisMonthList.slice(0, 5).map(c =>
    `  - ${c.switchboard} - ${c.template} | 📅 ${c.dueDateFormatted} (dans ${c.daysUntil}j)`
  ).join('\n');

  // ATEX NC with FULL details
  const atexNcText = ctx.atex.ncList.slice(0, 10).map(nc =>
    `  - **${nc.name}** (${nc.type})\n` +
    `    📍 Bât. ${nc.building}, Zone ${nc.zone}\n` +
    `    ⚠️ Points NC: ${nc.ncDetails.slice(0, 3).join(', ')}\n` +
    `    📋 Dernier contrôle: ${nc.lastCheckDate} par ${nc.checkedBy}`
  ).join('\n');

  // ATEX zones summary
  const atexZones = Object.entries(ctx.atex.equipmentsByZone)
    .map(([zone, count]) => `Zone ${zone}: ${count} équip.`)
    .join(' | ');

  return `## 📊 DONNÉES TEMPS RÉEL - Site "${ctx.site}"
📅 ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}

### 🔢 RÉSUMÉ GLOBAL
- **${ctx.summary.totalEquipments}** équipements au total
- **${ctx.switchboards.count}** armoires électriques | **${ctx.vsd.count}** VSD | **${ctx.meca.count}** mécaniques
- **${ctx.atex.totalEquipments}** équipements ATEX (${atexZones || 'aucune zone définie'})
- **${ctx.summary.totalBuildings}** bâtiments équipés

### 📅 CONTRÔLES PLANIFIÉS
- **${ctx.controls.scheduled}** contrôles programmés au total
- 🚨 **${ctx.controls.overdue}** en RETARD
- 📆 **${ctx.controls.thisWeek}** cette semaine (7 prochains jours)
- 📆 **${ctx.controls.thisMonth}** ce mois (30 prochains jours)
- 📆 **${ctx.controls.next90days}** dans les 90 prochains jours

${ctx.controls.overdue > 0 ? `### 🚨 CONTRÔLES EN RETARD (${ctx.controls.overdue}) - PRIORITAIRES!
${overdueListText}` : '### ✅ Aucun contrôle en retard - Félicitations!'}

${ctx.controls.thisWeek > 0 ? `### 📅 CONTRÔLES CETTE SEMAINE (${ctx.controls.thisWeek})
${thisWeekText}` : '### 📅 Aucun contrôle prévu cette semaine'}

${ctx.controls.thisMonth > 0 ? `### 📅 CONTRÔLES CE MOIS (${ctx.controls.thisMonth})
${thisMonthText}` : ''}

### 🔥 NON-CONFORMITÉS ATEX (${ctx.atex.ncCount})
${ctx.atex.ncCount > 0 ? atexNcText : '✅ Aucune non-conformité ATEX active - Taux de conformité: ' + ctx.summary.atexConformityRate + '%'}

### 🏢 RÉPARTITION PAR BÂTIMENT
${buildingsList || 'Aucune donnée de bâtiment'}

### ⚡ ACTIONS URGENTES: ${ctx.urgentItems.length}
${ctx.urgentItems.length > 0 ? ctx.urgentItems.slice(0, 5).map(i =>
  `- ${i.type === 'control_overdue' ? '⏰' : '⚠️'} ${i.switchboard || i.name} (${i.urgency || i.severity})`
).join('\n') : '✅ Aucune action urgente'}

### 🎯 ANALYSE PROACTIVE
${ctx.proactive?.suggestions?.length > 0 ? ctx.proactive.suggestions.map(s =>
  `- ${s.message}${s.estimatedTime ? ` (~${s.estimatedTime})` : ''}`
).join('\n') : ''}

${ctx.proactive?.neverControlled?.length > 0 ? `**⚠️ ${ctx.proactive.neverControlled.length} équipements JAMAIS contrôlés:**
${ctx.proactive.neverControlled.slice(0, 5).map(e =>
  `  - ${e.name} (${e.type}) - Bât. ${e.building_code || e.building || 'N/A'}`
).join('\n')}` : ''}

${ctx.proactive?.withoutDocumentation?.length > 0 ? `**📄 ${ctx.proactive.withoutDocumentation.length} équipements SANS documentation:**
${ctx.proactive.withoutDocumentation.slice(0, 5).map(e =>
  `  - ${e.name} (${e.type}) - ${e.manufacturer || 'Marque inconnue'} - ${e.issue}`
).join('\n')}` : ''}

${ctx.proactive?.patterns?.length > 0 ? `**🔍 Patterns détectés:**
${ctx.proactive.patterns.map(p => `  - ${p.message}`).join('\n')}` : ''}

### 📋 PROCÉDURES DISPONIBLES (${ctx.procedures?.count || 0})
${ctx.procedures?.count > 0 ? ctx.procedures.list.slice(0, 15).map(p =>
  `- **${p.title}**\n  📝 ${p.stepCount} étapes | Catégorie: ${p.category} | Risque: ${p.riskLevel || 'medium'}`
).join('\n') : '⚠️ Aucune procédure créée pour ce site'}

${ctx.procedures?.byCategory && Object.keys(ctx.procedures.byCategory).length > 0 ? `**Par catégorie:**
${Object.entries(ctx.procedures.byCategory).map(([cat, procs]) =>
  `  • ${cat}: ${procs.length} procédure(s)`
).join('\n')}` : ''}
`;
}

// ============================================================
// AI DOCUMENT SEARCH - Query Ask Veeva for documents
// ============================================================
async function searchDocuments(query, limit = 5) {
  try {
    const askVeevaUrl = process.env.ASK_VEEVA_URL || 'http://127.0.0.1:3015';
    const response = await fetch(`${askVeevaUrl}/api/ask-veeva/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, threshold: 0.3 })
    });

    if (!response.ok) return { results: [], error: 'Document search unavailable' };

    const data = await response.json();
    return {
      results: (data.results || []).map(r => ({
        title: r.filename || r.title,
        excerpt: r.text?.substring(0, 300) + '...',
        score: r.score,
        page: r.page
      })),
      count: data.results?.length || 0
    };
  } catch (e) {
    console.error('[AI] Document search error:', e.message);
    return { results: [], error: e.message };
  }
}

// ============================================================
// MULTI-MODEL WEB SEARCH FOR DOCUMENTATION
// ============================================================

// Known manufacturer documentation portals
const MANUFACTURER_PORTALS = {
  'schneider': {
    name: 'Schneider Electric',
    baseUrl: 'https://www.se.com/ww/en/download/document/',
    searchUrl: 'https://www.se.com/ww/en/product/',
    pdfPattern: (model) => `https://download.schneider-electric.com/files?p_Doc_Ref=${model}`
  },
  'abb': {
    name: 'ABB',
    baseUrl: 'https://library.abb.com/',
    searchUrl: 'https://new.abb.com/products/',
    pdfPattern: (model) => `https://library.abb.com/en/search?q=${encodeURIComponent(model)}`
  },
  'siemens': {
    name: 'Siemens',
    baseUrl: 'https://support.industry.siemens.com/',
    searchUrl: 'https://mall.industry.siemens.com/',
    pdfPattern: (model) => `https://support.industry.siemens.com/cs/search?t=all&search=${encodeURIComponent(model)}`
  },
  'legrand': {
    name: 'Legrand',
    baseUrl: 'https://www.legrand.fr/',
    searchUrl: 'https://www.legrand.fr/catalogue/',
    pdfPattern: (model) => `https://www.legrand.fr/recherche?q=${encodeURIComponent(model)}`
  },
  'hager': {
    name: 'Hager',
    baseUrl: 'https://www.hager.fr/',
    searchUrl: 'https://www.hager.fr/catalogue/',
    pdfPattern: (model) => `https://www.hager.fr/recherche/${encodeURIComponent(model)}`
  },
  'danfoss': {
    name: 'Danfoss',
    baseUrl: 'https://www.danfoss.com/',
    searchUrl: 'https://www.danfoss.com/en/search/',
    pdfPattern: (model) => `https://www.danfoss.com/en/search/?query=${encodeURIComponent(model)}`
  },
  'altivar': {
    name: 'Schneider Electric (Altivar)',
    baseUrl: 'https://www.se.com/ww/en/',
    pdfPattern: (model) => `https://www.se.com/ww/en/product-range/62129-altivar-machine-atv320/#documents`
  }
};

async function searchWebForDocumentation(query, equipmentInfo = {}) {
  console.log(`[AI] 🌐 Web search for: ${query}`);
  const results = { sources: [], summary: null, pdfLinks: [] };

  // Detect manufacturer from query or equipment info
  const manufacturer = (equipmentInfo.manufacturer || query || '').toLowerCase();

  // Extract actual model number from query (e.g., "ATV212WD22N4" from "documentation schneider ATV212WD22N4")
  // Common patterns: ATV123..., ACS123..., 6SL123..., VLT123..., etc.
  const modelMatch = query.match(/\b(ATV\d{2,3}[A-Z0-9]+|ACS\d{3}[A-Z0-9-]+|6SL\d{4}[A-Z0-9-]+|VLT\d{4}[A-Z0-9-]+|[A-Z]{2,4}\d{3,}[A-Z0-9-]*)\b/i);
  const extractedModel = modelMatch ? modelMatch[1].toUpperCase() : '';
  const model = equipmentInfo.model || extractedModel || '';

  console.log(`[AI] Extracted model: "${model}" from query`);

  // Skip generic portal links for Altivar - we add specific ones below
  const isAltivar = query.toLowerCase().includes('altivar') || model.toLowerCase().includes('atv');

  // Generate direct PDF links based on known manufacturers (skip if no valid model or if Altivar)
  if (model && !isAltivar) {
    for (const [key, portal] of Object.entries(MANUFACTURER_PORTALS)) {
      if (key === 'altivar') continue; // Skip altivar, handled separately below
      if (manufacturer.includes(key) || query.toLowerCase().includes(key)) {
        results.pdfLinks.push({
          title: `Documentation ${portal.name} - ${model}`,
          url: portal.pdfPattern(model),
          manufacturer: portal.name,
          type: 'pdf'
        });
        break;
      }
    }
  }

  // Special handling for Altivar (Schneider VSD)
  const queryLower = query.toLowerCase();
  const modelLower = model.toLowerCase();

  if (queryLower.includes('altivar') || modelLower.includes('atv')) {
    // Detect specific Altivar series
    let series = 'ATV320';
    let seriesUrl = '62129-altivar-machine-atv320';

    if (queryLower.includes('atv212') || modelLower.includes('atv212')) {
      series = 'ATV212';
      seriesUrl = '1741-altivar-212';
      // Direct link to ATV212 documentation page on Schneider
      results.pdfLinks.push({
        title: `Altivar 212 - Guide de démarrage rapide (PDF)`,
        url: `https://www.se.com/fr/fr/download/document/S1A72710/`,
        manufacturer: 'Schneider Electric',
        type: 'pdf'
      });
      results.pdfLinks.push({
        title: `Altivar 212 - Manuel de programmation (PDF)`,
        url: `https://www.se.com/fr/fr/download/document/S1A72711/`,
        manufacturer: 'Schneider Electric',
        type: 'pdf'
      });
      results.pdfLinks.push({
        title: `Altivar ATV212 - Fiche produit ${model || 'ATV212'}`,
        url: `https://www.se.com/fr/fr/product/${model || 'ATV212HD22N4'}/`,
        manufacturer: 'Schneider Electric',
        type: 'web'
      });
    } else if (queryLower.includes('atv320') || modelLower.includes('atv320')) {
      series = 'ATV320';
      seriesUrl = '62129-altivar-machine-atv320';
      results.pdfLinks.push({
        title: `Altivar ATV320 - Guide de démarrage (PDF)`,
        url: `https://www.se.com/fr/fr/download/document/NVE41295/`,
        manufacturer: 'Schneider Electric',
        type: 'pdf'
      });
      results.pdfLinks.push({
        title: `Altivar ATV320 - Manuel de programmation (PDF)`,
        url: `https://www.se.com/fr/fr/download/document/NVE41297/`,
        manufacturer: 'Schneider Electric',
        type: 'pdf'
      });
    } else if (queryLower.includes('atv630') || queryLower.includes('atv930') || modelLower.includes('atv630')) {
      series = 'ATV630/930';
      seriesUrl = '62125-altivar-process-atv600';
      results.pdfLinks.push({
        title: `Altivar ATV630/930 - Guide de démarrage (PDF)`,
        url: `https://www.se.com/fr/fr/download/document/NVE61507/`,
        manufacturer: 'Schneider Electric',
        type: 'pdf'
      });
    } else if (queryLower.includes('atv71') || modelLower.includes('atv71')) {
      series = 'ATV71';
      seriesUrl = '1746-altivar-71';
      results.pdfLinks.push({
        title: `Altivar 71 - Manuel de programmation (PDF)`,
        url: `https://www.se.com/fr/fr/download/document/1755847/`,
        manufacturer: 'Schneider Electric',
        type: 'pdf'
      });
    }

    results.pdfLinks.push({
      title: `Altivar ${series} - Page produit Schneider`,
      url: `https://www.se.com/fr/fr/product-range/${seriesUrl}/`,
      manufacturer: 'Schneider Electric',
      type: 'web'
    });
    results.pdfLinks.push({
      title: `Altivar ${series} - Documents et téléchargements`,
      url: `https://www.se.com/fr/fr/product-range/${seriesUrl}/#documents`,
      manufacturer: 'Schneider Electric',
      type: 'pdf'
    });
  }

  // ABB drives
  if (queryLower.includes('abb') || queryLower.includes('acs') || modelLower.includes('acs')) {
    results.pdfLinks.push({
      title: 'ABB Drives - Documentation center',
      url: 'https://new.abb.com/drives/documents',
      manufacturer: 'ABB',
      type: 'web'
    });
  }

  // Siemens
  if (queryLower.includes('siemens') || queryLower.includes('sinamics') || modelLower.includes('sinamics')) {
    results.pdfLinks.push({
      title: 'Siemens SINAMICS - Documentation',
      url: 'https://support.industry.siemens.com/cs/document/109745527',
      manufacturer: 'Siemens',
      type: 'web'
    });
  }

  // Danfoss
  if (queryLower.includes('danfoss') || queryLower.includes('vlt') || modelLower.includes('vlt')) {
    results.pdfLinks.push({
      title: 'Danfoss VLT - Documentation',
      url: 'https://www.danfoss.com/en/products/dds/low-voltage-drives/vlt-drives/',
      manufacturer: 'Danfoss',
      type: 'web'
    });
  }

  // Build enhanced search query
  const enhancedQuery = `${query} ${equipmentInfo.manufacturer || ''} ${equipmentInfo.model || ''} fiche technique datasheet PDF`.trim();

  // Try Gemini with web grounding first
  if (gemini) {
    try {
      const prompt = `Tu es un expert en documentation technique industrielle. Recherche les informations techniques pour:

Équipement: ${equipmentInfo.name || query}
Fabricant: ${equipmentInfo.manufacturer || 'inconnu'}
Modèle: ${equipmentInfo.model || 'inconnu'}
Type: ${equipmentInfo.type || 'équipement électrique'}

IMPORTANT: Fournis:
1. Les caractéristiques techniques PRINCIPALES (puissance, tension, courant, dimensions)
2. Les procédures de maintenance recommandées
3. Les points de contrôle importants pour la sécurité
4. Si possible, le lien EXACT vers le PDF de la fiche technique officielle

Format ta réponse de manière structurée avec des bullet points.`;

      const response = await callGemini([{ role: "user", content: prompt }]);

      results.summary = response;
      results.sources.push({ provider: 'Gemini', content: response });

      // Extract any URLs from the response
      const urlRegex = /https?:\/\/[^\s\)\]]+/g;
      const foundUrls = response.match(urlRegex) || [];
      foundUrls.forEach(url => {
        if (!results.pdfLinks.find(l => l.url === url)) {
          results.pdfLinks.push({
            title: url.includes('.pdf') ? 'Document PDF trouvé' : 'Lien documentation',
            url: url,
            type: url.includes('.pdf') ? 'pdf' : 'web'
          });
        }
      });

      console.log('[AI] ✅ Gemini web search completed');
    } catch (e) {
      console.error('[AI] Gemini web search error:', e.message);
    }
  }

  // Also try AI for additional context (with fallback)
  if ((openai || gemini) && (!results.summary || results.summary.length < 100)) {
    try {
      const messages = [
        {
          role: 'system',
          content: `Tu es un expert en documentation technique industrielle. Fournis des informations précises sur les équipements électriques.
IMPORTANT: Inclus toujours des spécifications techniques concrètes (tension, puissance, courant) et des recommandations de maintenance.`
        },
        {
          role: 'user',
          content: `Donne-moi les informations techniques détaillées pour: ${equipmentInfo.name || query}
Fabricant: ${equipmentInfo.manufacturer || 'inconnu'}
Modèle: ${equipmentInfo.model || 'inconnu'}

Inclus:
1. Spécifications techniques (tension, puissance, courant, fréquence)
2. Procédures de maintenance recommandées
3. Points de contrôle importants
4. Intervalles de maintenance suggérés`
        }
      ];

      const result = await chatWithFallback(messages, { max_tokens: 800 });
      if (result.content) {
        results.sources.push({ provider: result.provider, content: result.content });
        if (!results.summary) results.summary = result.content;
        console.log(`[AI] ✅ ${result.provider} documentation search completed`);
      }
    } catch (e) {
      console.error('[AI] Doc search error:', e.message);
    }
  }

  // Add fallback search links if no PDFs found
  if (results.pdfLinks.length === 0) {
    results.pdfLinks.push({
      title: `Rechercher "${model}" sur Google`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query + ' datasheet PDF filetype:pdf')}`,
      type: 'search'
    });
  }

  return results;
}

// ============================================================
// AI ACTION EXECUTION - Execute autonomous actions
// ============================================================
async function executeAIAction(action, params, site) {
  console.log(`[AI] Executing action: ${action}`, params);

  try {
    switch (action) {
      case 'createControl': {
        const { switchboardId, templateId, dueDate, frequency } = params;
        const result = await pool.query(`
          INSERT INTO control_schedules (switchboard_id, template_id, next_due_date, frequency, site, created_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          RETURNING id
        `, [switchboardId, templateId || 1, dueDate, frequency || 'annual', site]);
        return { success: true, message: `✅ Contrôle créé (ID: ${result.rows[0]?.id})`, id: result.rows[0]?.id };
      }

      case 'createNC': {
        const { equipmentId, description, severity, equipmentType } = params;
        const table = equipmentType === 'atex' ? 'atex_nonconformities' : 'nonconformities';
        const result = await pool.query(`
          INSERT INTO ${table} (equipment_id, description, severity, status, site, created_at)
          VALUES ($1, $2, $3, 'open', $4, NOW())
          RETURNING id
        `, [equipmentId, description, severity || 'medium', site]);
        return { success: true, message: `✅ Non-conformité créée (ID: ${result.rows[0]?.id})`, id: result.rows[0]?.id };
      }

      case 'updateEquipment': {
        const { id, status, equipmentType } = params;
        const tables = {
          switchboard: 'switchboards',
          vsd: 'vsd_equipments',
          meca: 'meca_equipments',
          atex: 'atex_equipments'
        };
        const table = tables[equipmentType] || 'switchboards';
        await pool.query(`UPDATE ${table} SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
        return { success: true, message: `✅ Équipement ${id} mis à jour: ${status}` };
      }

      case 'scheduleReminder': {
        const { date, message, userId } = params;
        // Store reminder in a notifications table (create if needed)
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ai_reminders (
            id SERIAL PRIMARY KEY,
            reminder_date DATE NOT NULL,
            message TEXT NOT NULL,
            site TEXT,
            user_id INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            is_sent BOOLEAN DEFAULT FALSE
          )
        `);
        const result = await pool.query(`
          INSERT INTO ai_reminders (reminder_date, message, site, user_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [date, message, site, userId]);
        return { success: true, message: `✅ Rappel programmé pour le ${date}`, id: result.rows[0]?.id };
      }

      case 'searchEquipment': {
        const { query, type, building, floor } = params;
        let sql = 'SELECT id, name, code, building_code, floor FROM switchboards WHERE site = $1';
        const queryParams = [site];

        if (building) {
          sql += ' AND building_code ILIKE $' + (queryParams.length + 1);
          queryParams.push(`%${building}%`);
        }
        if (floor) {
          sql += ' AND floor = $' + (queryParams.length + 1);
          queryParams.push(floor);
        }
        if (query) {
          sql += ' AND (name ILIKE $' + (queryParams.length + 1) + ' OR code ILIKE $' + (queryParams.length + 1) + ')';
          queryParams.push(`%${query}%`);
        }
        sql += ' LIMIT 20';

        const result = await pool.query(sql, queryParams);
        return { success: true, results: result.rows, count: result.rows.length };
      }

      case 'getControlHistory': {
        const { switchboardId, limit } = params;
        const result = await pool.query(`
          SELECT cr.*, ct.name as template_name
          FROM control_reports cr
          LEFT JOIN control_templates ct ON cr.template_id = ct.id
          WHERE cr.switchboard_id = $1
          ORDER BY cr.control_date DESC
          LIMIT $2
        `, [switchboardId, limit || 10]);
        return { success: true, history: result.rows };
      }

      case 'getDailyPlan': {
        // Get optimized daily plan
        const context = await getAIContext(site);
        const totalTime = context.dailyPlan.reduce((acc, t) => acc + (t.estimatedDuration || 30), 0);

        return {
          success: true,
          plan: context.dailyPlan,
          summary: {
            totalTasks: context.dailyPlan.length,
            criticalTasks: context.dailyPlan.filter(t => t.priority === 1).length,
            urgentTasks: context.dailyPlan.filter(t => t.priority === 2).length,
            estimatedTime: `${Math.floor(totalTime / 60)}h${totalTime % 60 > 0 ? (totalTime % 60) + 'min' : ''}`,
            buildings: [...new Set(context.dailyPlan.map(t => t.building).filter(Boolean))]
          },
          overdueAlerts: context.controls.overdueList.filter(c => c.urgency === 'critical'),
          message: `📋 Plan du jour: ${context.dailyPlan.length} tâches (~${Math.floor(totalTime / 60)}h)`
        };
      }

      case 'batchCreateControls': {
        // Create multiple controls at once
        const { controls } = params;
        const results = [];

        for (const ctrl of controls) {
          try {
            const result = await pool.query(`
              INSERT INTO control_schedules (switchboard_id, template_id, next_due_date, frequency, site, created_at)
              VALUES ($1, $2, $3, $4, $5, NOW())
              RETURNING id
            `, [ctrl.switchboardId, ctrl.templateId || 1, ctrl.dueDate, ctrl.frequency || 'annual', site]);
            results.push({ success: true, id: result.rows[0]?.id, switchboardId: ctrl.switchboardId });
          } catch (e) {
            results.push({ success: false, error: e.message, switchboardId: ctrl.switchboardId });
          }
        }

        const successCount = results.filter(r => r.success).length;
        return {
          success: successCount > 0,
          message: `✅ ${successCount}/${controls.length} contrôles créés`,
          results
        };
      }

      case 'getEquipmentDetails': {
        const { equipmentId, type } = params;
        const tables = {
          switchboard: 'switchboards',
          vsd: 'vsd_equipments',
          meca: 'meca_equipments',
          atex: 'atex_equipments'
        };
        const table = tables[type] || 'switchboards';

        const eqResult = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [equipmentId]);
        if (eqResult.rows.length === 0) {
          return { success: false, message: 'Équipement non trouvé' };
        }

        // Get related controls
        let controls = [];
        if (type === 'switchboard') {
          const ctrlResult = await pool.query(`
            SELECT cs.*, ct.name as template_name
            FROM control_schedules cs
            LEFT JOIN control_templates ct ON cs.template_id = ct.id
            WHERE cs.switchboard_id = $1
            ORDER BY cs.next_due_date
          `, [equipmentId]);
          controls = ctrlResult.rows;
        }

        return {
          success: true,
          equipment: eqResult.rows[0],
          controls,
          message: `📍 ${eqResult.rows[0].name} - ${controls.length} contrôles planifiés`
        };
      }

      case 'searchDoc': {
        // Search documentation using multiple AI models
        const { query, equipmentId, equipmentType } = params;

        // Get equipment info if ID provided
        let equipmentInfo = { name: query };
        if (equipmentId) {
          try {
            const tables = {
              switchboard: 'switchboards',
              vsd: 'vsd_equipments',
              meca: 'meca_equipments',
              atex: 'atex_equipments'
            };
            const table = tables[equipmentType] || 'switchboards';
            const eqRes = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [equipmentId]);
            if (eqRes.rows[0]) {
              equipmentInfo = {
                id: eqRes.rows[0].id,
                name: eqRes.rows[0].name,
                manufacturer: eqRes.rows[0].manufacturer || eqRes.rows[0].brand,
                model: eqRes.rows[0].model,
                type: equipmentType
              };
            }
          } catch (e) { /* ignore */ }
        }

        // Search using multi-model approach
        const webResults = await searchWebForDocumentation(query, equipmentInfo);

        // Also search local documents
        const localResults = await searchDocuments(query);

        // 🔍 SEARCH FOR MATCHING EQUIPMENT IN DATABASE
        // Extract potential manufacturer and model from query
        const queryLower = query.toLowerCase();
        const matchingEquipments = [];

        // Search VSD equipments
        try {
          const vsdRes = await pool.query(`
            SELECT id, name, building, floor, manufacturer, model, 'vsd' as equipment_type
            FROM vsd_equipments
            WHERE LOWER(model) LIKE $1 OR LOWER(manufacturer) LIKE $1 OR LOWER(name) LIKE $1
            LIMIT 20
          `, [`%${queryLower}%`]);
          matchingEquipments.push(...vsdRes.rows);
        } catch (e) { /* ignore */ }

        // Search MECA equipments
        try {
          const mecaRes = await pool.query(`
            SELECT id, name, building, floor, manufacturer, model, 'meca' as equipment_type
            FROM meca_equipments
            WHERE LOWER(model) LIKE $1 OR LOWER(manufacturer) LIKE $1 OR LOWER(name) LIKE $1
            LIMIT 20
          `, [`%${queryLower}%`]);
          matchingEquipments.push(...mecaRes.rows);
        } catch (e) { /* ignore */ }

        // Search ATEX equipments
        try {
          const atexRes = await pool.query(`
            SELECT id, name, building, zone, manufacturer, manufacturer_ref as model, 'atex' as equipment_type
            FROM atex_equipments
            WHERE LOWER(manufacturer_ref) LIKE $1 OR LOWER(manufacturer) LIKE $1 OR LOWER(name) LIKE $1
            LIMIT 20
          `, [`%${queryLower}%`]);
          matchingEquipments.push(...atexRes.rows);
        } catch (e) { /* ignore */ }

        // Build response with matching equipment info
        let matchingMessage = '';
        if (matchingEquipments.length > 0) {
          matchingMessage = `\n\n📦 **${matchingEquipments.length} équipement(s) correspondant(s) trouvé(s) dans votre installation:**\n`;
          matchingEquipments.slice(0, 10).forEach(eq => {
            matchingMessage += `• **${eq.name}** (${eq.equipment_type.toUpperCase()}) - ${eq.building || 'N/A'}${eq.floor ? '/' + eq.floor : ''}${eq.zone ? ' Zone ' + eq.zone : ''}\n`;
          });
          if (matchingEquipments.length > 10) {
            matchingMessage += `• ... et ${matchingEquipments.length - 10} autres\n`;
          }
          matchingMessage += `\n💡 Souhaites-tu que j'associe cette documentation à ces équipements?`;
        }

        // Build sources array with PDF links
        const sources = [];
        if (webResults.pdfLinks) {
          webResults.pdfLinks.forEach(link => {
            sources.push({
              title: link.title,
              url: link.url,
              type: link.type,
              manufacturer: link.manufacturer
            });
          });
        }

        return {
          success: true,
          equipment: equipmentInfo,
          webSearch: webResults,
          localDocuments: localResults,
          sources: sources, // PDF and documentation links
          matchingEquipments: matchingEquipments.map(eq => ({
            id: eq.id,
            name: eq.name,
            type: eq.equipment_type,
            building: eq.building,
            floor: eq.floor,
            zone: eq.zone
          })),
          matchingCount: matchingEquipments.length,
          message: `🔍 Recherche documentation pour ${equipmentInfo.name}:\n` +
            (webResults.summary ? `\n**Résultats web:**\n${webResults.summary.substring(0, 500)}...` : '') +
            (sources.length > 0 ? `\n\n📄 **${sources.length} lien(s) de documentation trouvé(s)**` : '') +
            (localResults.count > 0 ? `\n\n**${localResults.count} documents locaux trouvés**` : '') +
            matchingMessage
        };
      }

      case 'autoDocSearch': {
        // Automatically search documentation for ALL equipment without docs
        const context = await getAIContext(site);
        const equipmentWithoutDocs = context.proactive?.withoutDocumentation || [];

        if (equipmentWithoutDocs.length === 0) {
          return { success: true, message: '✅ Tous les équipements ont de la documentation!' };
        }

        // Search for first 5 equipment
        const results = [];
        for (const eq of equipmentWithoutDocs.slice(0, 5)) {
          const searchQuery = `${eq.manufacturer || ''} ${eq.name} fiche technique`.trim();
          const webResults = await searchWebForDocumentation(searchQuery, eq);
          results.push({
            equipment: eq.name,
            manufacturer: eq.manufacturer,
            found: !!webResults.summary,
            summary: webResults.summary?.substring(0, 200)
          });
        }

        const foundCount = results.filter(r => r.found).length;
        return {
          success: true,
          searched: results.length,
          found: foundCount,
          results,
          message: `🔍 Recherche auto: ${foundCount}/${results.length} documentations trouvées`
        };
      }

      case 'attachDocToEquipments': {
        // Attach documentation URL to multiple equipments
        const { docUrl, docTitle, equipments } = params;
        // equipments = [{id, type: 'vsd'|'meca'|'atex'}]

        if (!docUrl || !equipments || equipments.length === 0) {
          return { success: false, message: '❌ URL de documentation ou équipements manquants' };
        }

        const updated = [];
        const errors = [];

        for (const eq of equipments) {
          try {
            const tables = {
              vsd: 'vsd_equipments',
              meca: 'meca_equipments',
              atex: 'atex_equipments'
            };
            const table = tables[eq.type];
            if (!table) {
              errors.push({ id: eq.id, error: 'Type inconnu' });
              continue;
            }

            // Update documentation_url field (create column if doesn't exist)
            await pool.query(`
              UPDATE ${table}
              SET documentation_url = $1, documentation_title = $2, updated_at = NOW()
              WHERE id = $3
            `, [docUrl, docTitle || 'Documentation technique', eq.id]);

            updated.push({ id: eq.id, type: eq.type, name: eq.name });
          } catch (e) {
            // If column doesn't exist, try to add it
            try {
              const tables = {
                vsd: 'vsd_equipments',
                meca: 'meca_equipments',
                atex: 'atex_equipments'
              };
              const table = tables[eq.type];
              await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS documentation_url TEXT`);
              await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS documentation_title TEXT`);
              await pool.query(`
                UPDATE ${table}
                SET documentation_url = $1, documentation_title = $2, updated_at = NOW()
                WHERE id = $3
              `, [docUrl, docTitle || 'Documentation technique', eq.id]);
              updated.push({ id: eq.id, type: eq.type, name: eq.name });
            } catch (e2) {
              errors.push({ id: eq.id, error: e2.message });
            }
          }
        }

        return {
          success: updated.length > 0,
          updated,
          errors,
          message: updated.length > 0
            ? `✅ Documentation associée à ${updated.length} équipement(s):\n${updated.map(u => `• ${u.name || u.id} (${u.type.toUpperCase()})`).join('\n')}`
            : `❌ Impossible d'associer la documentation: ${errors.map(e => e.error).join(', ')}`
        };
      }

      case 'rescheduleControl': {
        // Reschedule a control to a new date
        const { controlId, newDate, reason } = params;
        const result = await pool.query(`
          UPDATE control_schedules
          SET next_due_date = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING id, switchboard_id, next_due_date
        `, [newDate, controlId]);

        if (result.rows.length === 0) {
          return { success: false, message: `❌ Contrôle ${controlId} non trouvé` };
        }

        // Log the reschedule for tracking
        console.log(`[AI] Rescheduled control ${controlId} to ${newDate}. Reason: ${reason || 'User request'}`);

        return {
          success: true,
          controlId,
          newDate,
          message: `📅 Contrôle reporté au ${new Date(newDate).toLocaleDateString('fr-FR')}`
        };
      }

      case 'batchReschedule': {
        // Reschedule multiple controls at once
        const { controls, daysToAdd, reason } = params;
        const results = [];

        for (const ctrl of controls) {
          try {
            const newDate = new Date(ctrl.currentDate);
            newDate.setDate(newDate.getDate() + (daysToAdd || 7));

            await pool.query(`
              UPDATE control_schedules
              SET next_due_date = $1, updated_at = NOW()
              WHERE id = $2
            `, [newDate.toISOString().split('T')[0], ctrl.id]);

            results.push({
              id: ctrl.id,
              success: true,
              newDate: newDate.toISOString().split('T')[0]
            });
          } catch (e) {
            results.push({ id: ctrl.id, success: false, error: e.message });
          }
        }

        const successCount = results.filter(r => r.success).length;
        return {
          success: successCount > 0,
          message: `📅 ${successCount}/${controls.length} contrôles reportés de ${daysToAdd || 7} jours`,
          results
        };
      }

      case 'getUnfinishedTasks': {
        // Get tasks that were scheduled for today but not completed
        const context = await getAIContext(site);
        const today = new Date().toISOString().split('T')[0];

        // Tasks due today or overdue
        const unfinished = [
          ...context.controls.overdueList,
          ...context.controls.thisWeekList.filter(c => c.dueDate === today)
        ];

        return {
          success: true,
          unfinished,
          count: unfinished.length,
          message: unfinished.length > 0
            ? `📋 ${unfinished.length} tâches en attente - je peux t'aider à les réorganiser!`
            : `✅ Tout est à jour!`
        };
      }

      case 'searchProcedures': {
        // Search procedures by keywords
        const { keywords = [], category } = params;
        const keywordArray = Array.isArray(keywords) ? keywords : [keywords];

        let sql = `
          SELECT p.id, p.title, p.description, p.category, p.status, p.risk_level,
                 p.ppe_required, p.created_at,
                 (SELECT COUNT(*) FROM procedure_steps WHERE procedure_id = p.id) as step_count
          FROM procedures p
          WHERE (p.site = $1 OR p.site IS NULL OR p.site = '')
            AND p.status != 'archived'
        `;
        const queryParams = [site];

        // Add keyword search
        if (keywordArray.length > 0) {
          const keywordConditions = keywordArray.map((_, idx) => {
            const paramIdx = queryParams.length + 1 + idx;
            return `(p.title ILIKE $${paramIdx} OR p.description ILIKE $${paramIdx})`;
          });
          sql += ` AND (${keywordConditions.join(' OR ')})`;
          keywordArray.forEach(k => queryParams.push(`%${k}%`));
        }

        if (category) {
          queryParams.push(category);
          sql += ` AND p.category = $${queryParams.length}`;
        }

        sql += ` ORDER BY p.updated_at DESC LIMIT 20`;

        const result = await pool.query(sql, queryParams);

        const procedures = result.rows.map(p => ({
          id: p.id,
          title: p.title,
          description: p.description?.substring(0, 200) || '',
          category: p.category || 'general',
          status: p.status,
          riskLevel: p.risk_level || 'medium',
          ppeRequired: p.ppe_required || [],
          stepCount: parseInt(p.step_count) || 0
        }));

        if (procedures.length === 0) {
          return {
            success: true,
            found: false,
            count: 0,
            procedures: [],
            message: `❌ Je n'ai pas trouvé de procédure pour "${keywordArray.join(', ')}". Tu veux qu'on en crée une?`
          };
        }

        const proceduresList = procedures.map(p =>
          `📋 **${p.title}**\n   ├─ ${p.stepCount} étapes | Risque: ${p.riskLevel}\n   └─ EPI: ${Array.isArray(p.ppeRequired) ? p.ppeRequired.slice(0, 3).join(', ') || 'Non défini' : 'Non défini'}`
        ).join('\n\n');

        return {
          success: true,
          found: true,
          count: procedures.length,
          procedures,
          message: `✅ **${procedures.length} procédure(s) trouvée(s):**\n\n${proceduresList}\n\nTu veux que je te guide sur une de ces procédures?`
        };
      }

      case 'getProcedureDetails': {
        // Get full details of a specific procedure
        const { procedureId } = params;

        const procResult = await pool.query(`
          SELECT p.*,
                 (SELECT json_agg(s ORDER BY s.step_number)
                  FROM procedure_steps s WHERE s.procedure_id = p.id) as steps
          FROM procedures p
          WHERE p.id = $1
        `, [procedureId]);

        if (procResult.rows.length === 0) {
          return { success: false, message: `❌ Procédure non trouvée` };
        }

        const proc = procResult.rows[0];
        const steps = proc.steps || [];

        let stepsText = '';
        steps.forEach((s, i) => {
          stepsText += `\n**Étape ${i + 1}:** ${s.title}\n`;
          if (s.description) stepsText += `   ${s.description}\n`;
          if (s.warning) stepsText += `   ⚠️ ${s.warning}\n`;
        });

        return {
          success: true,
          procedure: {
            id: proc.id,
            title: proc.title,
            description: proc.description,
            category: proc.category,
            riskLevel: proc.risk_level,
            ppeRequired: proc.ppe_required || [],
            steps: steps.map(s => ({
              number: s.step_number,
              title: s.title,
              description: s.description,
              warning: s.warning,
              hasPhoto: !!s.photo_path
            }))
          },
          pdfUrl: `/api/procedures/${proc.id}/pdf`,
          message: `📋 **${proc.title}**\n\n🛡️ **EPI:** ${Array.isArray(proc.ppe_required) ? proc.ppe_required.join(', ') : 'Non défini'}\n⚠️ **Risque:** ${proc.risk_level || 'medium'}\n\n**${steps.length} étapes:**${stepsText}\n\n📥 [Télécharger le PDF](/api/procedures/${proc.id}/pdf)`
        };
      }

      default:
        return { success: false, message: `Action inconnue: ${action}` };
    }
  } catch (e) {
    console.error(`[AI] Action error (${action}):`, e.message);
    return { success: false, message: `Erreur: ${e.message}` };
  }
}

// ============================================================
// AI RESPONSE PARSER - Extract charts and actions from response
// ============================================================
function parseAIResponse(responseText) {
  const result = {
    message: responseText,
    chart: null,
    action: null,
    actionParams: null
  };

  // Extract JSON blocks for chart
  const chartMatch = responseText.match(/```json\s*(\{[^`]*"chart"[^`]*\})\s*```/s);
  if (chartMatch) {
    try {
      const parsed = JSON.parse(chartMatch[1]);
      if (parsed.chart) {
        result.chart = parsed.chart;
        result.message = responseText.replace(chartMatch[0], '').trim();
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Also try inline chart JSON
  const inlineChartMatch = responseText.match(/\{"chart"\s*:\s*\{[^}]+\}\}/);
  if (!result.chart && inlineChartMatch) {
    try {
      const parsed = JSON.parse(inlineChartMatch[0]);
      if (parsed.chart) {
        result.chart = parsed.chart;
      }
    } catch (e) { /* ignore */ }
  }

  // Extract action JSON
  const actionMatch = responseText.match(/```json\s*(\{[^`]*"action"[^`]*\})\s*```/s);
  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1]);
      if (parsed.action) {
        result.action = parsed.action;
        result.actionParams = parsed.params || {};
        result.message = responseText.replace(actionMatch[0], '').trim();
      }
    } catch (e) { /* ignore */ }
  }

  // Inline action JSON
  const inlineActionMatch = responseText.match(/\{"action"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^}]+\}\}/);
  if (!result.action && inlineActionMatch) {
    try {
      const parsed = JSON.parse(inlineActionMatch[0]);
      if (parsed.action) {
        result.action = parsed.action;
        result.actionParams = parsed.params || {};
      }
    } catch (e) { /* ignore */ }
  }

  return result;
}

// ============================================================
// AUTH AUDIT LOG - Traçage des connexions/déconnexions
// ============================================================
async function ensureAuthAuditTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_audit_log (
        id SERIAL PRIMARY KEY,
        ts TIMESTAMPTZ DEFAULT NOW(),
        action TEXT NOT NULL,
        email TEXT,
        user_name TEXT,
        user_id INTEGER,
        company_id INTEGER,
        site_id INTEGER,
        role TEXT,
        source TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        details JSONB DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_auth_audit_ts ON auth_audit_log(ts);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_email ON auth_audit_log(email);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_action ON auth_audit_log(action);
    `);
    console.log('[AUTH] Audit table ready');
  } catch (e) {
    console.error('[AUTH] Audit table error:', e.message);
  }
}
ensureAuthAuditTable();

async function logAuthEvent(req, action, data = {}) {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'] || null;

    await pool.query(`
      INSERT INTO auth_audit_log (action, email, user_name, user_id, company_id, site_id, role, source, ip_address, user_agent, success, error_message, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      action,
      data.email || null,
      data.name || null,
      data.user_id || null,
      data.company_id || null,
      data.site_id || null,
      data.role || null,
      data.source || 'unknown',
      ip,
      userAgent,
      data.success !== false,
      data.error || null,
      JSON.stringify(data.details || {})
    ]);
  } catch (e) {
    console.error('[AUTH AUDIT] Log failed:', e.message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Sécurité & cookies
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "wss:"],
      mediaSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
    },
  },
}));
app.use(cookieParser());

// ⚠️ NOTE: switchboardMapApp a un body-parser qui parse TOUS les bodies AVANT les proxies.
// C'est pour ça que les proxies avec PUT/POST doivent utiliser withRestream: true
// pour re-transmettre le body parsé au microservice.
app.use(switchboardMapApp);

// -------- AUTH LIGHT (n'a pas besoin du body pour passer) ----------
function authMiddleware(req, _res, next) {
  if (req.path.startsWith("/api/auth/") || req.path.startsWith("/api/public/")) return next();
  const token = req.cookies?.token;
  if (!token) return next();
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || "devsecret"); } catch {}
  next();
}
app.use(authMiddleware);

/* =================================================================
   PROXIES AVANT TOUT BODY-PARSER  => évite que le body soit mangé
   VERSION 3.0: Ajout de timeouts stricts pour éviter les blocages
   ================================================================= */
const atexTarget         = process.env.ATEX_BASE_URL         || "http://127.0.0.1:3001";
const loopcalcTarget     = process.env.LOOPCALC_BASE_URL      || "http://127.0.0.1:3002";
const switchboardTarget  = process.env.SWITCHBOARD_BASE_URL   || "http://127.0.0.1:3003";
const selectivityTarget  = process.env.SELECTIVITY_BASE_URL   || "http://127.0.0.1:3004";
const flaTarget          = process.env.FLA_BASE_URL           || "http://127.0.0.1:3005";
const arcflashTarget     = process.env.ARCFLASH_BASE_URL      || "http://127.0.0.1:3006";
const obsolescenceTarget = process.env.OBSOLESCENCE_BASE_URL  || "http://127.0.0.1:3007";
const hvTarget           = process.env.HV_BASE_URL            || "http://127.0.0.1:3008";
const diagramTarget      = process.env.DIAGRAM_BASE_URL       || "http://127.0.0.1:3010";
// Controls ancien système supprimé - remplacé par switchboard-controls intégré à server_switchboard.js
// const controlsTarget     = process.env.CONTROLS_BASE_URL      || "http://127.0.0.1:3011";
const oibtTarget         = process.env.OIBT_BASE_URL          || "http://127.0.0.1:3012";
const projectsTarget     = process.env.PROJECTS_BASE_URL      || "http://127.0.0.1:3013";
// 🔵 Comp-Ext (prestataires externes) — nouveau microservice sur 3014
const compExtTarget      = process.env.COMP_EXT_BASE_URL      || "http://127.0.0.1:3014";
// 🔵 Ask Veeva (lecture de documents + Q/R) — nouveau microservice sur 3015
const askVeevaTarget     = process.env.ASK_VEEVA_BASE_URL     || "http://127.0.0.1:3015";
// 🔵 Doors (portes coupe-feu) — microservice sur 3016  ✅ AJOUT
const doorsTarget        = process.env.DOORS_BASE_URL         || "http://127.0.0.1:3016";
// 🔵 VSD (Variateurs de fréquence) — microservice sur 3020  ✅ AJOUT
const vsdTarget          = process.env.VSD_BASE_URL           || "http://127.0.0.1:3020";
const mecaTarget = process.env.MECA_BASE_URL || "http://127.0.0.1:3021";
// 🔵 Mobile Equipment (Controle Electrique Appareils Mobiles) — microservice sur 3022
const mobileEquipTarget = process.env.MOBILE_EQUIP_BASE_URL || "http://127.0.0.1:3022";
// 🔵 GLO (Global Electrical Equipments: UPS, Batteries, Éclairages) — microservice sur 3023
const gloTarget = process.env.GLO_BASE_URL || "http://127.0.0.1:3023";
// 🔵 Datahub (Custom categories with map markers) — microservice sur 3024
const datahubTarget = process.env.DATAHUB_BASE_URL || "http://127.0.0.1:3024";
// 🤖 AI Assistant (avatar intelligent avec OpenAI/Gemini) — microservice sur 3025
const aiAssistantTarget = process.env.AI_ASSISTANT_BASE_URL || "http://127.0.0.1:3025";
// 📋 Procedures (Procédures opérationnelles avec création guidée par IA) — microservice sur 3026
const proceduresTarget = process.env.PROCEDURES_BASE_URL || "http://127.0.0.1:3026";
const dcfTarget = process.env.DCF_TARGET || "http://127.0.0.1:3030";
const learnExTarget = process.env.LEARN_EX_BASE_URL || "http://127.0.0.1:3040";
// 🔵 Infrastructure (plans électriques multi-zones) — intégré dans server_atex.js (port 3001)
const infraTarget = process.env.INFRA_BASE_URL || process.env.ATEX_BASE_URL || "http://127.0.0.1:3001";

// ============================================================
// PROXY HELPER v3.0 - Avec timeouts stricts
// ============================================================
function mkProxy(target, { withRestream = false, timeoutMs = 20000 } = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: "warn",

    // ✅ TIMEOUTS CRITIQUES pour éviter les blocages infinis
    proxyTimeout: timeoutMs,      // Timeout réponse backend (20s par défaut)
    timeout: timeoutMs + 5000,    // Timeout connexion total (25s par défaut)

    // ✅ Gestion d'erreur améliorée
    onError(err, req, res) {
      console.error(`[PROXY ERROR] ${req.method} ${req.path} -> ${target}: ${err.code || err.message}`);

      // Ne pas répondre si déjà envoyé
      if (res.headersSent) return;

      const isTimeout = err.code === 'ECONNRESET' ||
                       err.code === 'ETIMEDOUT' ||
                       err.code === 'ESOCKETTIMEDOUT' ||
                       err.message?.includes('timeout');

      if (isTimeout) {
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Timeout - le service met trop de temps à répondre",
          code: err.code || "TIMEOUT",
          retry: true
        }));
      } else {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Service temporairement indisponible",
          code: err.code || "UPSTREAM_ERROR",
          retry: true
        }));
      }
    },

    // Re-stream du body si déjà parsé en amont (sécurité)
    onProxyReq: withRestream
      ? (proxyReq, req) => {
          if (!req.body || !Object.keys(req.body).length) return;
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      : undefined,
  });
}

// ✅ ATEX: Ajout withRestream pour éviter les problèmes de body (setPosition, etc.)
app.use("/api/atex",         mkProxy(atexTarget, { withRestream: true, timeoutMs: 30000 }));
app.use("/api/loopcalc",     mkProxy(loopcalcTarget));
// ✅ SWITCHBOARD: Ajout withRestream pour éviter les problèmes de body
app.use("/api/switchboard",  mkProxy(switchboardTarget, { withRestream: true, timeoutMs: 25000 }));
app.use("/api/selectivity",  mkProxy(selectivityTarget));
app.use("/api/faultlevel",   mkProxy(flaTarget));
app.use("/api/arcflash",     mkProxy(arcflashTarget));
// ✅ OBSOLESCENCE: Ajout withRestream pour éviter les problèmes de body (service-year PUT)
app.use("/api/obsolescence", mkProxy(obsolescenceTarget, { withRestream: true, timeoutMs: 30000 }));
// ✅ HV: Ajout withRestream pour éviter les problèmes de body (setPosition, etc.)
app.use("/api/hv",           mkProxy(hvTarget, { withRestream: true, timeoutMs: 30000 }));
app.use("/api/diagram",      mkProxy(diagramTarget));
// Controls supprimé - switchboard-controls intégré à server_switchboard.js
// app.use("/api/controls",     mkProxy(controlsTarget));
app.use("/api/oibt",         mkProxy(oibtTarget));
app.use("/api/dcf", mkProxy(dcfTarget, { withRestream: true }));

// >>> Projects : proxy bavard + re-stream (si un jour body était déjà parsé)
app.use("/api/projects", mkProxy(projectsTarget, { withRestream: true }));

// >>> Comp-Ext (prestataires externes) : même traitement que Projects (re-stream utile pour PUT/POST)
app.use("/api/comp-ext", mkProxy(compExtTarget, { withRestream: true }));

// >>> Ask Veeva (ZIP + upload multipart) : re-stream INDISPENSABLE
app.use("/api/ask-veeva", mkProxy(askVeevaTarget, { withRestream: true }));
// >>> VSD (photos + pièces jointes) : re-stream INDISPENSABLE  ✅ AJOUT
app.use("/api/vsd", mkProxy(vsdTarget, { withRestream: true }));

// >>> Doors (photos + pièces jointes) : re-stream INDISPENSABLE  ✅ AJOUT
app.use("/api/doors", mkProxy(doorsTarget, { withRestream: true }));

// >>> Meca (Maintenance Mécanique) : re-stream nécessaire pour upload
app.use("/api/meca", mkProxy(mecaTarget, { withRestream: true }));

// >>> Learn-Ex (formation ATEX) : timeout étendu pour génération de certificats
app.use("/api/learn-ex", mkProxy(learnExTarget, { withRestream: true, timeoutMs: 60000 }));

// >>> Mobile Equipment (Controle Electrique Appareils Mobiles) : re-stream pour uploads
app.use("/api/mobile-equipment", mkProxy(mobileEquipTarget, { withRestream: true }));

// >>> GLO (Global Electrical Equipments: UPS, Batteries, Éclairages) : re-stream pour uploads
app.use("/api/glo", mkProxy(gloTarget, { withRestream: true }));

// >>> Datahub (Custom categories with map markers) : re-stream pour uploads
app.use("/api/datahub", mkProxy(datahubTarget, { withRestream: true }));

// >>> Procedures (Procédures opérationnelles avec création guidée par IA) : re-stream pour uploads photos
app.use("/api/procedures", mkProxy(proceduresTarget, { withRestream: true }));

// >>> Helper to call Procedures Microservice
async function callProceduresMicroservice(endpoint, options = {}) {
  const url = `${proceduresTarget}${endpoint}`;
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': options.userEmail || 'system',
        'X-Site': options.site || 'Nyon',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(err);
    }
    return response.json();
  } catch (e) {
    console.error(`[PROC] Error calling ${endpoint}:`, e.message);
    return null;
  }
}

// >>> AI Assistant - Powerful AI with OpenAI + Database access
app.post("/api/ai-assistant/chat", express.json(), async (req, res) => {
  try {
    const { message, context: clientContext, conversationHistory = [], executeAction = false } = req.body;
    const site = req.header('X-Site') || clientContext?.user?.site || process.env.DEFAULT_SITE || 'Nyon';
    const userEmail = clientContext?.user?.email || 'anonymous';

    if (!message) {
      return res.status(400).json({ error: "Message requis" });
    }

    console.log(`[AI] 🚀 Processing: "${message.substring(0, 50)}..." for site ${site}`);

    // =========================================================================
    // NAVIGATION & VISUALIZATION - Detect plan/building/equipment requests FIRST
    // =========================================================================
    const msgLower = message.toLowerCase();

    // ==========================================================================
    // MAP REQUEST WITH CONTEXT - User wants to see map of previously mentioned equipment
    // ==========================================================================
    // Detect explicit map requests OR confirmations ("oui", "ok") after equipment was mentioned
    const isConfirmation = /^(oui|ok|d'accord|yes|sure|affirmative|bien sûr|vas-y|go|montre|voir)\s*[!.?]*$/i.test(message.trim());
    const wantsMapFromContext = (
      (msgLower.includes('carte') || msgLower.includes('plan') || msgLower.includes('voir') || msgLower.includes('montre') || isConfirmation) &&
      (msgLower.includes('carte') || msgLower.includes('plan') || msgLower.includes('localisation') || msgLower.includes('position') ||
       msgLower.includes('équipement') || msgLower.includes('retard') || isConfirmation)
    );

    if (wantsMapFromContext && conversationHistory?.length > 0) {
      console.log('[AI] 🗺️ Map request with context detected');

      // Look for equipment in recent conversation (single or list)
      const recentEquipmentMsg = [...conversationHistory].reverse().find(msg =>
        msg.equipment || msg.locationEquipment || msg.equipmentList?.length > 0
      );

      if (recentEquipmentMsg) {
        // Handle multiple equipment in a list
        if (recentEquipmentMsg.equipmentList?.length > 1) {
          const equipmentList = recentEquipmentMsg.equipmentList;
          console.log(`[AI] 🗺️ Found ${equipmentList.length} equipment in context list`);

          // Use the first equipment for the map display
          const firstEquipment = equipmentList[0];
          const equipmentType = firstEquipment.equipmentType || 'switchboard';

          let response = `## 🗺️ Localisation des équipements\n\n`;
          response += `**${equipmentList.length} équipements à contrôler:**\n\n`;
          equipmentList.forEach((eq, i) => {
            const typeEmoji = eq.equipmentType === 'mobile' ? '📱' : '🔌';
            response += `${i + 1}. ${typeEmoji} **${eq.name}** — Bât. ${eq.building_code || 'N/A'}, ét. ${eq.floor || 'N/A'}\n`;
          });
          response += `\nVoici la localisation du premier équipement sur le plan :`;

          return res.json({
            message: response,
            showMap: true,
            locationEquipment: {
              id: firstEquipment.id,
              name: firstEquipment.name,
              code: firstEquipment.code,
              building_code: firstEquipment.building_code,
              floor: firstEquipment.floor,
              room: firstEquipment.room
            },
            locationEquipmentType: equipmentType,
            equipmentList: equipmentList,
            actions: equipmentList.slice(0, 3).map(eq => ({
              label: `📍 ${eq.name.substring(0, 20)}`,
              prompt: `Montre-moi ${eq.name} sur la carte`
            })),
            provider: 'system'
          });
        }

        // Handle single equipment
        const equipment = recentEquipmentMsg.equipment || recentEquipmentMsg.locationEquipment ||
                         (recentEquipmentMsg.equipmentList?.[0]);
        const equipmentType = recentEquipmentMsg.locationEquipmentType ||
                             equipment?.equipmentType ||
                             recentEquipmentMsg.equipmentType || 'switchboard';

        if (equipment) {
          console.log(`[AI] 🗺️ Found equipment in context: ${equipment.name} (${equipmentType})`);

          return res.json({
            message: `## 🗺️ Localisation de ${equipment.name}\n\n📍 **Bâtiment:** ${equipment.building_code || equipment.building || 'N/A'}\n📍 **Étage:** ${equipment.floor || 'N/A'}\n\nVoici la position sur le plan :`,
            showMap: true,
            locationEquipment: {
              id: equipment.id,
              name: equipment.name,
              code: equipment.code || equipment.tag,
              building_code: equipment.building_code || equipment.building,
              floor: equipment.floor,
              room: equipment.room || equipment.location
            },
            locationEquipmentType: equipmentType,
            actions: [
              { label: '🗺️ Vue complète', type: 'navigate', navigateTo: `/app/${equipmentType === 'mobile' ? 'mobile-equipments' : equipmentType + 's'}` },
              { label: '📋 Détails', prompt: `Détails sur ${equipment.name}` }
            ],
            provider: 'system'
          });
        }
      }
    }

    // ==========================================================================
    // OVERDUE CONTROL QUERIES - Return structured data with equipment info
    // ==========================================================================
    const wantsOverdueControls = (
      (msgLower.includes('retard') || msgLower.includes('overdue') || msgLower.includes('en attente')) &&
      (msgLower.includes('contrôle') || msgLower.includes('controle') || msgLower.includes('équipement') || msgLower.includes('mobile'))
    );

    if (wantsOverdueControls) {
      console.log('[AI] ⏰ Overdue control query detected');

      try {
        // Build context to get overdue controls
        const dbContext = await getAIContext(site);
        const overdueList = dbContext.controls?.overdueList || [];
        const overdueCount = dbContext.controls?.overdue || 0;

        if (overdueCount > 0) {
          let response = `🚨 **${overdueCount} contrôle(s) en retard!**\n\n`;

          // Build equipment list for map context
          const equipmentList = [];

          overdueList.slice(0, 5).forEach((c, i) => {
            const typeEmoji = c.equipmentType === 'mobile' ? '📱' : '🔌';
            response += `${i + 1}. ${typeEmoji} **${c.switchboard}** (${c.switchboardCode})\n`;
            response += `   📍 Bât. ${c.building}, ét. ${c.floor} | ⏰ ${c.daysOverdue}j de retard\n\n`;

            // Add to equipment list for map display
            equipmentList.push({
              id: c.equipment?.id || c.equipmentId || c.switchboardId,
              name: c.switchboard,
              code: c.switchboardCode,
              building_code: c.building,
              floor: c.floor,
              room: c.room,
              equipmentType: c.equipmentType || 'switchboard'
            });
          });

          if (overdueCount > 5) {
            response += `\n_...et ${overdueCount - 5} autre(s)_\n`;
          }

          response += `\nVeux-tu que je te montre leur localisation sur le plan ?`;

          // Actions with map navigation
          const actions = [
            { label: "🗺️ Voir sur la carte", prompt: "Montre-moi la carte des équipements en retard" },
            { label: "📋 Planifier les contrôles", prompt: "Planifier les contrôles en retard" }
          ];

          // If single equipment, include direct location data
          const singleEquipment = equipmentList.length === 1 ? equipmentList[0] : null;

          return res.json({
            message: response,
            actions,
            provider: "Electro",
            // Include equipment data for subsequent map requests
            equipmentList: equipmentList.length > 0 ? equipmentList : undefined,
            // If single equipment, also include direct location data for immediate map display
            ...(singleEquipment && {
              showMap: true,
              locationEquipment: singleEquipment,
              locationEquipmentType: singleEquipment.equipmentType
            })
          });
        }
      } catch (e) {
        console.error('[AI] Overdue control query error:', e.message);
      }
    }

    // ==========================================================================
    // SMART NAVIGATION DETECTION - Understand natural French requests
    // ==========================================================================

    // ACTION KEYWORDS: Words that indicate user wants to see/find/access something
    const hasActionKeyword = (
      msgLower.includes('voir') || msgLower.includes('montre') || msgLower.includes('ouvre') ||
      msgLower.includes('affiche') || msgLower.includes('cherche') || msgLower.includes('trouve') ||
      msgLower.includes('où') || msgLower.includes('localise') || msgLower.includes('besoin') ||
      msgLower.includes('accéder') || msgLower.includes('aller') || msgLower.includes('naviguer') ||
      msgLower.includes('plan') || msgLower.includes('carte') || msgLower.includes('liste') ||
      msgLower.includes('quels') || msgLower.includes('combien') || msgLower.includes('donne')
    );

    // LOCATION KEYWORDS: Words that indicate a place/building/floor
    const hasLocationKeyword = (
      msgLower.includes('bâtiment') || msgLower.includes('batiment') || msgLower.includes('building') ||
      msgLower.includes('étage') || msgLower.includes('etage') || msgLower.includes('floor') ||
      msgLower.includes('niveau') || msgLower.includes('local') || msgLower.includes('salle') ||
      msgLower.includes('zone') || msgLower.match(/\bbat\.?\s*\d/i) ||
      msgLower.match(/\b[a-z]?\d{2}[a-z]?\b/)  // Building codes like "02", "B02", etc.
    );

    // EQUIPMENT KEYWORDS: Words that indicate electrical equipment
    const hasEquipmentKeyword = (
      msgLower.includes('tableau') || msgLower.includes('armoire') || msgLower.includes('tgbt') ||
      msgLower.includes('équipement') || msgLower.includes('électrique') || msgLower.includes('vsd') ||
      msgLower.includes('variateur') || msgLower.includes('atex') || msgLower.includes('td ') ||
      msgLower.includes('distribution') || msgLower.includes('coffret') || msgLower.includes('datahub')
    );

    // Detect plan/building/navigation requests (BEFORE procedure logic)
    // Now uses smarter detection: needs action + (location OR equipment)
    const wantsPlanOrNavigation = (
      hasActionKeyword && (hasLocationKeyword || hasEquipmentKeyword)
    ) && !msgLower.includes('procédure') && !msgLower.includes('procedure') && !msgLower.includes('étape');

    if (wantsPlanOrNavigation) {
      console.log('[AI] 🗺️ Navigation/Plan request detected');

      // Extract building code (like "02", "B02", "bâtiment 02")
      const buildingMatch = msgLower.match(/(?:bâtiment|batiment|building|bat\.?)\s*([a-z]?\d{1,3}[a-z]?)/i) ||
                           msgLower.match(/\b([a-z]?\d{2}[a-z]?)\b/);
      const buildingCode = buildingMatch ? buildingMatch[1].toUpperCase() : null;

      // Extract floor if mentioned
      const floorMatch = msgLower.match(/(?:étage|etage|floor|niveau)\s*(-?\d+|rc|rdc|sous-sol|ss)/i);
      const floor = floorMatch ? floorMatch[1].toUpperCase() : null;

      // Query equipment in the building
      try {
        let query = `
          SELECT s.id, s.name, s.code, s.building_code, s.floor, s.room,
                 'switchboard' as equipment_type
          FROM switchboards s
          WHERE s.site = $1
        `;
        const params = [site];

        if (buildingCode) {
          query += ` AND UPPER(s.building_code) = $${params.length + 1}`;
          params.push(buildingCode);
        }
        if (floor) {
          query += ` AND UPPER(s.floor) = $${params.length + 1}`;
          params.push(floor);
        }

        query += ` ORDER BY s.building_code, s.floor, s.name LIMIT 20`;

        const equipResult = await pool.query(query, params);

        if (equipResult.rows.length > 0) {
          // Group by floor
          const byFloor = {};
          equipResult.rows.forEach(eq => {
            const f = eq.floor || 'N/A';
            if (!byFloor[f]) byFloor[f] = [];
            byFloor[f].push(eq);
          });

          const totalEquipment = equipResult.rows.length;
          const floors = [...new Set(equipResult.rows.map(e => e.floor).filter(Boolean))];

          let response = `## 🗺️ ${buildingCode ? `Bâtiment ${buildingCode}` : 'Équipements électriques'}\n\n`;
          response += `📊 **${totalEquipment} équipement${totalEquipment > 1 ? 's' : ''}** trouvé${totalEquipment > 1 ? 's' : ''}`;
          if (floors.length > 0) {
            response += ` sur ${floors.length} étage${floors.length > 1 ? 's' : ''} (${floors.join(', ')})`;
          }
          response += '\n\n';

          if (floor) {
            response += `**Étage ${floor}**\n\n`;
          }

          Object.keys(byFloor).sort().forEach(f => {
            if (!floor) response += `### 📍 Étage ${f}\n`;
            byFloor[f].forEach(eq => {
              response += `• **${eq.name}** (${eq.code || 'N/A'})`;
              if (eq.room) response += ` - ${eq.room}`;
              response += `\n`;
            });
            response += '\n';
          });

          // If only ONE equipment, show map with location
          const showSingleEquipmentMap = equipResult.rows.length === 1;
          const singleEquipment = showSingleEquipmentMap ? equipResult.rows[0] : null;

          // Create equipment actions with navigation data
          const actions = equipResult.rows.slice(0, 5).map(eq => ({
            label: `🔌 ${eq.name.substring(0, 25)}`,
            prompt: `Montre-moi le tableau ${eq.name}`,
            type: 'equipment',
            equipment: {
              id: eq.id,
              name: eq.name,
              code: eq.code,
              buildingCode: eq.building_code,
              floor: eq.floor
            }
          }));

          // Add floor filter if building has multiple floors
          if (floors.length > 1 && !floor) {
            floors.slice(0, 3).forEach(f => {
              actions.push({
                label: `📍 Étage ${f}`,
                prompt: `Montre-moi l'étage ${f} du bâtiment ${buildingCode}`,
                type: 'floor',
                floor: f,
                buildingCode
              });
            });
          }

          // Add main navigation action
          actions.unshift({
            label: `🗺️ Ouvrir le plan`,
            type: 'navigate',
            navigateTo: `/app/switchboards${buildingCode ? `?building=${buildingCode}` : ''}${floor ? `&floor=${floor}` : ''}`,
            prompt: null // No chat prompt, just navigate
          });

          return res.json({
            message: response,
            equipmentList: equipResult.rows,
            buildingCode,
            floor,
            floors,
            navigationMode: true,
            navigateTo: `/app/switchboards${buildingCode ? `?building=${buildingCode}` : ''}${floor ? `&floor=${floor}` : ''}`,
            // Map integration - show mini map when single equipment found
            showMap: showSingleEquipmentMap,
            locationEquipment: singleEquipment ? {
              id: singleEquipment.id,
              name: singleEquipment.name,
              code: singleEquipment.code,
              building_code: singleEquipment.building_code,
              floor: singleEquipment.floor,
              room: singleEquipment.room
            } : null,
            locationEquipmentType: 'switchboard',
            actions,
            provider: 'system'
          });
        } else {
          // No equipment found, but still helpful response
          return res.json({
            message: `🗺️ Je n'ai pas trouvé d'équipements${buildingCode ? ` dans le bâtiment ${buildingCode}` : ''}${floor ? ` à l'étage ${floor}` : ''}.\n\nTu veux que je cherche ailleurs ?`,
            actions: [
              { label: '📋 Tous les bâtiments', prompt: 'Liste des bâtiments' },
              { label: '🔍 Rechercher', prompt: 'Chercher un tableau électrique' }
            ],
            provider: 'system'
          });
        }
      } catch (e) {
        console.error('[AI] Navigation query error:', e.message);
      }
    }

    // ==========================================================================
    // BUILDING LIST - Show all buildings with equipment counts
    // ==========================================================================
    const wantsBuildingList = (
      (msgLower.includes('liste') || msgLower.includes('tous') || msgLower.includes('quels')) &&
      (msgLower.includes('bâtiment') || msgLower.includes('batiment') || msgLower.includes('building'))
    ) && !msgLower.includes('procédure');

    if (wantsBuildingList) {
      console.log('[AI] 🏢 Building list request detected');
      try {
        const buildingsResult = await pool.query(`
          SELECT
            building_code,
            COUNT(*) as equipment_count,
            array_agg(DISTINCT floor) as floors
          FROM switchboards
          WHERE site = $1 AND building_code IS NOT NULL AND building_code != ''
          GROUP BY building_code
          ORDER BY building_code
          LIMIT 20
        `, [site]);

        if (buildingsResult.rows.length > 0) {
          let response = `## 🏢 Bâtiments sur le site ${site}\n\n`;
          response += `📊 **${buildingsResult.rows.length} bâtiment(s)** avec équipements électriques\n\n`;

          buildingsResult.rows.forEach(b => {
            const floorList = b.floors?.filter(Boolean).sort().join(', ') || 'N/A';
            response += `### 🏗️ Bâtiment ${b.building_code}\n`;
            response += `• ${b.equipment_count} équipement(s)\n`;
            response += `• Étages: ${floorList}\n\n`;
          });

          response += `💡 Dis-moi quel bâtiment tu veux explorer !`;

          const actions = buildingsResult.rows.slice(0, 6).map(b => ({
            label: `🏗️ Bâtiment ${b.building_code}`,
            type: 'navigate',
            navigateTo: `/app/switchboards?building=${b.building_code}`,
            prompt: null
          }));

          return res.json({
            message: response,
            buildings: buildingsResult.rows,
            actions,
            provider: 'system'
          });
        } else {
          return res.json({
            message: `🏢 Aucun bâtiment trouvé sur le site ${site}. Vérifie que les équipements ont un code bâtiment.`,
            actions: [
              { label: '📋 Tous les équipements', type: 'navigate', navigateTo: '/app/switchboards' }
            ],
            provider: 'system'
          });
        }
      } catch (e) {
        console.error('[AI] Building list query error:', e.message);
      }
    }

    // Detect specific equipment query (tableau, armoire, VSD, ATEX, etc.)
    const wantsEquipmentInfo = (
      (msgLower.includes('tableau') || msgLower.includes('armoire') || msgLower.includes('tgbt') ||
       msgLower.includes('td ') || msgLower.includes('variateur') || msgLower.includes('vsd') ||
       msgLower.includes('atex') || msgLower.includes('équipement')) &&
      (msgLower.includes('montre') || msgLower.includes('voir') || msgLower.includes('info') ||
       msgLower.includes('détail') || msgLower.includes('où') || msgLower.includes('cherche'))
    ) && !msgLower.includes('procédure') && !msgLower.includes('procedure');

    if (wantsEquipmentInfo) {
      console.log('[AI] 🔌 Equipment info request detected');

      // Extract equipment name/code
      const equipMatch = msgLower.match(/(?:tableau|armoire|tgbt|td|variateur|vsd)\s+([^\s,?!]+)/i);
      const searchTerm = equipMatch ? equipMatch[1] : null;

      if (searchTerm) {
        try {
          const eqResult = await pool.query(`
            SELECT s.*, 'switchboard' as type,
                   (SELECT COUNT(*) FROM control_schedules WHERE switchboard_id = s.id) as control_count
            FROM switchboards s
            WHERE s.site = $1
              AND (LOWER(s.name) LIKE $2 OR LOWER(s.code) LIKE $2)
            LIMIT 5
          `, [site, `%${searchTerm.toLowerCase()}%`]);

          if (eqResult.rows.length > 0) {
            const eq = eqResult.rows[0];
            let response = `## 🔌 ${eq.name}\n\n`;
            response += `📍 **Localisation:** Bâtiment ${eq.building_code || 'N/A'}, Étage ${eq.floor || 'N/A'}`;
            if (eq.room) response += `, ${eq.room}`;
            response += `\n`;
            response += `🏷️ **Code:** ${eq.code || 'N/A'}\n`;
            response += `📋 **Contrôles planifiés:** ${eq.control_count}\n`;

            // If multiple results found, show them
            if (eqResult.rows.length > 1) {
              response += `\n📋 **${eqResult.rows.length} résultats trouvés:**\n`;
              eqResult.rows.forEach((e, i) => {
                response += `${i + 1}. ${e.name} (${e.code || 'N/A'}) - ${e.building_code || ''}\n`;
              });
            }

            return res.json({
              message: response,
              equipment: eq,
              equipmentList: eqResult.rows,
              navigationMode: true,
              navigateTo: `/app/switchboards?switchboard=${eq.id}`,
              buildingCode: eq.building_code,
              floor: eq.floor,
              // Show map with equipment location
              showMap: true,
              locationEquipment: {
                id: eq.id,
                name: eq.name,
                code: eq.code,
                building_code: eq.building_code,
                floor: eq.floor,
                room: eq.room
              },
              locationEquipmentType: 'switchboard',
              actions: [
                {
                  label: '🔌 Voir l\'équipement',
                  type: 'navigate',
                  navigateTo: `/app/switchboards?switchboard=${eq.id}`
                },
                {
                  label: '🗺️ Voir le bâtiment',
                  type: 'navigate',
                  navigateTo: `/app/switchboards?building=${eq.building_code}`
                },
                { label: '📋 Voir contrôles', prompt: `Contrôles pour ${eq.name}` }
              ],
              provider: 'system'
            });
          }
        } catch (e) {
          console.error('[AI] Equipment query error:', e.message);
        }
      }
    }

    // =========================================================================
    // PROCEDURE SYSTEM - Intégration microservice
    // =========================================================================

    // Check if we're in an active procedure session
    const lastProcMsg = [...conversationHistory].reverse().find(m => m.procedureSessionId);
    const activeSessionId = lastProcMsg?.procedureSessionId;

    // --- Si on a une session active, continuer avec le microservice ---
    if (activeSessionId) {
      console.log(`[AI] 📋 Continuing procedure session: ${activeSessionId}`);

      // Check if user wants to finish
      const isDone = /^(c'est (fini|bon|terminé|tout)|fini|terminé|stop|voilà)$/i.test(msgLower.trim()) ||
                     msgLower.includes("c'est fini") || msgLower.includes("c'est bon") ||
                     msgLower.includes("c'est tout") || msgLower.includes("terminé");

      if (isDone) {
        // Finalize the procedure
        const result = await callProceduresMicroservice(`/api/procedures/ai/finalize/${activeSessionId}`, {
          method: 'POST',
          userEmail,
          site
        });

        if (result?.id) {
          const pdfUrl = `/api/procedures/${result.id}/pdf`;
          return res.json({
            message: `✅ **Procédure créée !**\n\n📋 **${result.title}**\n\n[📥 Télécharger le PDF](${pdfUrl})\n\nJe l'ai sauvegardée. Tu peux me demander de la lire ou de te guider plus tard !`,
            actions: [
              { label: "Télécharger PDF", url: pdfUrl },
              { label: "Voir mes procédures", prompt: "Montre-moi mes procédures" }
            ],
            provider: 'system',
            pdfUrl,
            procedureId: result.id,
            procedureComplete: true
          });
        }
      }

      // Continue the session
      const result = await callProceduresMicroservice(`/api/procedures/ai/chat/${activeSessionId}`, {
        method: 'POST',
        userEmail,
        site,
        body: { message }
      });

      if (result) {
        return res.json({
          message: result.message,
          actions: result.options?.map(o => ({ label: o, prompt: o })) || [],
          provider: 'procedures-ai',
          procedureSessionId: activeSessionId,
          procedureStep: result.currentStep,
          expectsPhoto: result.expectsPhoto,
          procedureReady: result.procedureReady
        });
      }
    }

    // --- SEAMLESS MODE SWITCHING: Exit any procedure mode to return to normal ---
    const wantsExitMode = (
      msgLower.includes('menu principal') ||
      msgLower.includes('retour menu') ||
      msgLower.includes('mode normal') ||
      (msgLower.includes('sortir') && (msgLower.includes('procédure') || msgLower.includes('procedure'))) ||
      (msgLower.includes('quitter') && !msgLower.includes('application')) ||
      msgLower.includes("c'est bon") ||
      msgLower.includes('j\'ai fini') ||
      msgLower.includes('terminé') ||
      msgLower.includes('annuler')
    );

    // Check if we're in any procedure mode
    const inProcedureMode = [...conversationHistory].reverse().find(m =>
      m.procedureSessionId || m.procedureAssistSessionId || m.procedureEditId || m.mode?.includes('procedure')
    );

    if (wantsExitMode && inProcedureMode) {
      console.log('[AI] 🔄 Switching back to normal mode');

      return res.json({
        message: "✅ **Mode normal activé.**\n\nJe suis prêt à t'aider. Que veux-tu faire ?\n\n" +
                 "💡 Tu peux me demander:\n" +
                 "- Créer une procédure\n" +
                 "- Voir mes procédures\n" +
                 "- Suivre/exécuter une procédure\n" +
                 "- Modifier une procédure\n" +
                 "- Ou toute autre question !",
        actions: [
          { label: "Créer procédure", prompt: "Je veux créer une nouvelle procédure" },
          { label: "Mes procédures", prompt: "Montre-moi mes procédures" },
          { label: "Question", prompt: "" }
        ],
        provider: 'system',
        // Clear all procedure session IDs
        procedureSessionId: null,
        procedureAssistSessionId: null,
        procedureEditId: null,
        editAction: null,
        deleteStepId: null,
        mode: 'normal'
      });
    }

    // --- Détecter si on veut CRÉER une procédure → Ouvre le modal ProcedureCreator ---
    const wantsCreateProcedure = (
      (msgLower.includes('procédure') || msgLower.includes('procedure') || msgLower.includes('excellence')) &&
      (msgLower.includes('créer') || msgLower.includes('creer') || msgLower.includes('faire') ||
       msgLower.includes('nouvelle') || msgLower.includes('ajouter'))
    );

    if (wantsCreateProcedure) {
      console.log('[AI] 📋 Opening ProcedureCreator modal');

      // Extraire un sujet potentiel du message
      const subjectMatch = message.match(/(?:sur|pour|de|:)\s+["']?([^"']+)["']?$/i);
      const suggestedTitle = subjectMatch ? subjectMatch[1].trim() : null;

      return res.json({
        message: suggestedTitle
          ? `📝 Super ! Je vais t'aider à créer la procédure **"${suggestedTitle}"**.\n\n→ L'assistant de création s'ouvre...`
          : `📝 Créons une nouvelle procédure !\n\n→ L'assistant de création s'ouvre...`,
        openProcedureCreator: true,
        procedureCreatorContext: { suggestedTitle },
        provider: 'system'
      });
    }

    // --- Détecter si on veut IMPORTER un document existant ---
    const wantsImportDocument = (
      (msgLower.includes('procédure') || msgLower.includes('procedure') || msgLower.includes('document')) &&
      (msgLower.includes('import') || msgLower.includes('charger') || msgLower.includes('uploader') ||
       msgLower.includes('convertir') || msgLower.includes('transformer') || msgLower.includes('fichier'))
    );

    if (wantsImportDocument) {
      console.log('[AI] 📄 Document import mode');
      return res.json({
        message: `📄 **Import de document**\n\nEnvoie-moi ton fichier (PDF, Word, TXT) et je l'analyserai pour créer une procédure structurée automatiquement.\n\nUtilise le bouton 📎 pour joindre ton document.`,
        actions: [],
        provider: 'system',
        procedureMode: 'import-document',
        expectsFile: true
      });
    }

    // --- Détecter si on veut ANALYSER un rapport ---
    const wantsAnalyzeReport = (
      (msgLower.includes('rapport') || msgLower.includes('audit') || msgLower.includes('inspection')) &&
      (msgLower.includes('analys') || msgLower.includes('action') || msgLower.includes('correc') ||
       msgLower.includes('import') || msgLower.includes('charger'))
    );

    if (wantsAnalyzeReport) {
      console.log('[AI] 📊 Report analysis mode');
      return res.json({
        message: `📊 **Analyse de rapport**\n\nEnvoie-moi ton rapport d'audit ou d'inspection et j'extrairai automatiquement les actions correctives à mettre en place.\n\nUtilise le bouton 📎 pour joindre ton rapport.`,
        actions: [],
        provider: 'system',
        procedureMode: 'analyze-report',
        expectsFile: true
      });
    }

    // --- Détecter si on veut FAIRE/EXÉCUTER une procédure (mode guidance temps réel) ---
    const wantsExecuteProcedure = (
      (msgLower.includes('procédure') || msgLower.includes('procedure')) &&
      (msgLower.includes('faire') || msgLower.includes('exécuter') || msgLower.includes('executer') ||
       msgLower.includes('suivre') || msgLower.includes('guide') || msgLower.includes('commencer') ||
       msgLower.includes('lancer') || msgLower.includes('démarrer') || msgLower.includes('demarrer') ||
       msgLower.includes('effectuer') || msgLower.includes('réaliser'))
    ) || (
      msgLower.includes('guide') && msgLower.includes('moi') &&
      (msgLower.includes('pour') || msgLower.includes('étape'))
    );

    if (wantsExecuteProcedure && !activeSessionId) {
      console.log('[AI] 🎯 Procedure execution mode requested');

      // Extract procedure name if mentioned
      const procMatch = /(?:procédure|procedure)\s*[""«]?([^""»]+)[""»]?/i.exec(message) ||
                        /(?:faire|suivre|guide.*pour)\s+(?:la\s+)?[""«]?([^""»?]+)[""»]?/i.exec(message);
      const searchTitle = procMatch?.[1]?.trim();

      try {
        // Find the procedure
        let procQuery = `
          SELECT p.id, p.title, p.risk_level, p.ppe_required,
                 (SELECT COUNT(*) FROM procedure_steps WHERE procedure_id = p.id) as step_count
          FROM procedures p
          WHERE (p.site = $1 OR p.site IS NULL OR p.site = '')
        `;
        const params = [site];

        if (searchTitle) {
          procQuery += ` AND LOWER(p.title) LIKE $2`;
          params.push(`%${searchTitle.toLowerCase()}%`);
        }

        procQuery += ` ORDER BY CASE WHEN p.site = $1 THEN 0 ELSE 1 END, p.created_at DESC LIMIT 5`;

        const procResult = await pool.query(procQuery, params);

        if (procResult.rows.length === 0) {
          return res.json({
            message: "Je n'ai pas trouvé de procédure correspondante. Tu veux en créer une ou voir la liste ?",
            actions: [
              { label: "Voir mes procédures", prompt: "Montre-moi mes procédures" },
              { label: "Créer une procédure", prompt: "Je veux créer une procédure" }
            ],
            provider: 'system'
          });
        }

        // If multiple matches, ask user to choose
        if (procResult.rows.length > 1 && !searchTitle) {
          const procList = procResult.rows.map((p, i) =>
            `${i + 1}. **${p.title}** (${p.step_count} étapes, risque ${p.risk_level})`
          ).join('\n');

          return res.json({
            message: `**Quelle procédure veux-tu exécuter ?**\n\n${procList}\n\nDis-moi le numéro ou le nom de la procédure.`,
            actions: procResult.rows.slice(0, 3).map(p => ({
              label: p.title.substring(0, 25),
              prompt: `Je veux faire la procédure "${p.title}"`
            })),
            provider: 'system'
          });
        }

        // Start real-time assistance for the procedure
        const proc = procResult.rows[0];
        console.log(`[AI] 🚀 Starting real-time assistance for: ${proc.title}`);

        const assistResult = await callProceduresMicroservice('/api/procedures/ai/assist/start', {
          method: 'POST',
          userEmail,
          site,
          body: { procedureId: proc.id, initialQuestion: message }
        });

        if (assistResult?.sessionId) {
          let response = `## 🎯 Mode Guidance: ${proc.title}\n\n`;

          // Safety warning based on risk level
          if (proc.risk_level === 'high' || proc.risk_level === 'critical') {
            response += `⚠️ **Attention:** Procédure à risque ${proc.risk_level === 'critical' ? 'CRITIQUE' : 'ÉLEVÉ'}\n\n`;
          }

          // PPE reminder
          const ppe = proc.ppe_required || [];
          if (ppe.length > 0) {
            response += `🦺 **EPI requis:** ${ppe.join(', ')}\n\n`;
          }

          response += `---\n\n${assistResult.message}`;

          // Add photo if available
          const photoData = assistResult.currentStepPhoto ? {
            stepPhoto: assistResult.currentStepPhoto,
            stepNumber: 1
          } : null;

          return res.json({
            message: response,
            actions: [
              { label: "C'est fait", prompt: "C'est fait, étape suivante" },
              { label: "J'ai un problème", prompt: "J'ai un problème avec cette étape" },
              { label: "Arrêter", prompt: "Stop, je veux arrêter la procédure" }
            ],
            provider: 'procedures-assist',
            procedureAssistSessionId: assistResult.sessionId,
            procedureId: proc.id,
            procedureTitle: proc.title,
            currentStep: 1,
            totalSteps: assistResult.totalSteps,
            stepPhotos: assistResult.stepPhotos,
            currentStepPhoto: assistResult.currentStepPhoto,
            mode: 'procedure-guidance'
          });
        }
      } catch (e) {
        console.error('[AI] Procedure execution error:', e);
      }
    }

    // --- Check if we're in active ASSISTANCE mode ---
    const lastAssistMsg = [...conversationHistory].reverse().find(m => m.procedureAssistSessionId);
    const activeAssistSessionId = lastAssistMsg?.procedureAssistSessionId;

    if (activeAssistSessionId) {
      console.log(`[AI] 🎯 Continuing procedure guidance: ${activeAssistSessionId}`);

      // Check if user wants to stop
      const wantsStop = /^(stop|arrête|arreter|quitter|sortir|annuler)$/i.test(msgLower.trim()) ||
                        msgLower.includes('arrêter la procédure') || msgLower.includes('quitter la procédure');

      if (wantsStop) {
        return res.json({
          message: "✅ **Procédure interrompue.**\n\nTu peux la reprendre quand tu veux en disant \"Je veux faire la procédure X\".\n\nQue veux-tu faire maintenant ?",
          actions: [
            { label: "Voir mes procédures", prompt: "Montre-moi mes procédures" },
            { label: "Autre question", prompt: "" }
          ],
          provider: 'system',
          procedureAssistSessionId: null, // Clear session
          mode: 'normal'
        });
      }

      // Check if user wants to VIEW the procedure (open modal) while in guidance
      const wantsViewProcedure = (
        (msgLower.includes('voir') || msgLower.includes('montre') || msgLower.includes('ouvre') ||
         msgLower.includes('affiche') || msgLower.includes('lire')) &&
        (msgLower.includes('procédure') || msgLower.includes('procedure'))
      );

      if (wantsViewProcedure) {
        console.log('[AI] 📋 User wants to view procedure during guidance - fetching procedure details');

        // Get the procedure ID from the last message context
        const lastProcMsg = [...conversationHistory].reverse().find(m => m.procedureId);
        const procedureId = lastProcMsg?.procedureId;

        if (procedureId) {
          try {
            const procResult = await pool.query(`
              SELECT p.*,
                     (SELECT json_agg(s ORDER BY s.order_number) FROM procedure_steps s WHERE s.procedure_id = p.id) as steps
              FROM procedures p
              WHERE p.id = $1
            `, [procedureId]);

            if (procResult.rows.length > 0) {
              const proc = procResult.rows[0];
              const steps = proc.steps || [];

              let response = `## 📋 ${proc.title}\n\n`;
              response += `📊 **${steps.length} étape(s)**\n`;
              if (proc.risk_level) response += `⚠️ **Risque:** ${proc.risk_level}\n`;
              if (proc.ppe_required?.length) response += `🛡️ **EPI:** ${proc.ppe_required.join(', ')}\n`;
              response += `\n---\n`;

              steps.forEach((step, i) => {
                response += `\n**Étape ${i + 1}:** ${step.title || step.description?.substring(0, 50) || 'Étape'}\n`;
              });

              return res.json({
                message: response,
                procedureToOpen: { id: proc.id, title: proc.title },
                procedureDetails: proc,
                procedureAssistSessionId: activeAssistSessionId, // Keep guidance session active
                actions: [
                  { label: "▶️ Continuer le guidage", prompt: "Continue le guidage" },
                  { label: "📥 Télécharger PDF", url: `/api/procedures/${proc.id}/pdf` }
                ],
                provider: 'system'
              });
            }
          } catch (e) {
            console.error('[AI] Error fetching procedure for view:', e);
          }
        }

        // Fallback - let user know we couldn't find the procedure
        return res.json({
          message: "📋 Je n'ai pas trouvé la procédure en cours. Voici les options :",
          actions: [
            { label: "📋 Mes procédures", prompt: "Liste des procédures" },
            { label: "▶️ Continuer", prompt: "Continue" }
          ],
          procedureAssistSessionId: activeAssistSessionId,
          provider: 'system'
        });
      }

      // Continue assistance
      try {
        const result = await callProceduresMicroservice(`/api/procedures/ai/assist/${activeAssistSessionId}`, {
          method: 'POST',
          userEmail,
          site,
          body: { message, action: msgLower.includes("c'est fait") ? 'next' : null }
        });

        if (result) {
          let response = result.message;

          // Add photo comparison feedback if available
          if (result.photoAnalysis) {
            response += `\n\n📸 **Analyse de ta photo:**\n${result.photoAnalysis}`;
          }

          // Check if procedure is complete
          const isComplete = result.currentStepNumber > result.totalSteps || result.isComplete;

          if (isComplete) {
            return res.json({
              message: `✅ **Procédure terminée !**\n\nBravo, tu as complété toutes les étapes.\n\n${response}`,
              actions: [
                { label: "Télécharger PDF", prompt: `Génère le PDF de la procédure` },
                { label: "Autre procédure", prompt: "Montre-moi mes procédures" }
              ],
              provider: 'system',
              procedureAssistSessionId: null,
              mode: 'normal'
            });
          }

          return res.json({
            message: response,
            actions: [
              { label: "C'est fait", prompt: "C'est fait, étape suivante" },
              { label: "Envoyer photo", prompt: "Je t'envoie une photo de ce que j'ai fait" },
              { label: "Problème", prompt: "J'ai un problème" }
            ],
            provider: 'procedures-assist',
            procedureAssistSessionId: activeAssistSessionId,
            currentStep: result.currentStepNumber,
            totalSteps: result.totalSteps,
            currentStepPhoto: result.currentStepPhoto,
            mode: 'procedure-guidance'
          });
        }
      } catch (e) {
        console.error('[AI] Procedure assistance error:', e);
      }
    }

    // --- Détecter si on veut VOIR/CHERCHER une procédure ---
    const wantsSearchProcedure = (
      (msgLower.includes('procédure') || msgLower.includes('procedure')) &&
      (msgLower.includes('voir') || msgLower.includes('chercher') || msgLower.includes('trouver') ||
       msgLower.includes('montre') || msgLower.includes('affiche') || msgLower.includes('liste') ||
       msgLower.includes('quelles'))
    );

    if (wantsSearchProcedure) {
      console.log('[AI] 🔍 Procedure search mode');
      try {
        // Search procedures - include both site-specific and those without site
        const procResult = await pool.query(`
          SELECT id, title, created_at, risk_level, site,
                 (SELECT COUNT(*) FROM procedure_steps WHERE procedure_id = p.id) as step_count
          FROM procedures p
          WHERE site = $1 OR site IS NULL OR site = ''
          ORDER BY
            CASE WHEN site = $1 THEN 0 ELSE 1 END,
            created_at DESC
          LIMIT 10
        `, [site]);

        if (procResult.rows.length === 0) {
          return res.json({
            message: "Aucune procédure trouvée. Tu veux en créer une ?",
            actions: [{ label: "Créer une procédure", prompt: "Je veux créer une procédure" }],
            provider: 'system'
          });
        }

        const procList = procResult.rows.map((p, i) =>
          `${i + 1}. **${p.title}** (${p.step_count} étapes) - ${new Date(p.created_at).toLocaleDateString('fr-FR')}`
        ).join('\n');

        return res.json({
          message: `**Procédures disponibles :**\n\n${procList}\n\nDis-moi laquelle tu veux voir ou "lire la procédure X"`,
          actions: procResult.rows.slice(0, 3).map(p => ({
            label: p.title.substring(0, 25),
            prompt: `Montre-moi la procédure "${p.title}"`
          })),
          provider: 'system'
        });
      } catch (e) {
        console.error('[AI] Procedure search error:', e);
      }
    }

    // --- Détecter si on veut LIRE une procédure spécifique ---
    const wantsReadProcedure = /(?:lire|voir|montre|affiche|ouvre).*(?:procédure|procedure)\s*[""«]?([^""»]+)[""»]?/i.exec(message);
    if (wantsReadProcedure) {
      const searchTitle = wantsReadProcedure[1]?.trim();
      console.log(`[AI] 📖 Reading procedure: ${searchTitle}`);

      try {
        const procResult = await pool.query(`
          SELECT p.*, json_agg(
            json_build_object(
              'id', s.id,
              'step_number', s.step_number,
              'title', s.title,
              'description', s.description,
              'instructions', s.instructions,
              'has_photo', (s.photo_content IS NOT NULL OR s.photo_path IS NOT NULL)
            )
            ORDER BY s.step_number
          ) as steps
          FROM procedures p
          LEFT JOIN procedure_steps s ON s.procedure_id = p.id
          WHERE (p.site = $1 OR p.site IS NULL OR p.site = '') AND LOWER(p.title) LIKE $2
          GROUP BY p.id
          ORDER BY CASE WHEN p.site = $1 THEN 0 ELSE 1 END
          LIMIT 1
        `, [site, `%${searchTitle.toLowerCase()}%`]);

        if (procResult.rows.length > 0) {
          const proc = procResult.rows[0];
          const steps = proc.steps?.[0] ? proc.steps.filter(s => s.step_number) : [];

          let response = `## 📋 ${proc.title}\n\n`;
          const stepImages = [];

          if (steps.length > 0) {
            steps.forEach((s, i) => {
              response += `**Étape ${s.step_number}:** ${s.title || s.description}\n`;
              if (s.instructions) response += `   ${s.instructions}\n`;
              else if (s.description && s.title) response += `   ${s.description}\n`;
              if (s.has_photo) {
                response += `   📷 *Photo disponible*\n`;
                stepImages.push({ stepNumber: s.step_number, url: `/api/procedures/steps/${s.id}/photo` });
              }
              response += '\n';
            });
          }

          response += `\n---\nVeux-tu que je te guide étape par étape ou télécharger le PDF ?`;

          return res.json({
            message: response,
            actions: [
              { label: "Guide-moi", prompt: `Guide-moi pour "${proc.title}" étape par étape` },
              { label: "PDF", prompt: `Génère le PDF de "${proc.title}"` }
            ],
            provider: 'system',
            procedureId: proc.id,
            stepImages: stepImages.length > 0 ? stepImages : undefined
          });
        }
      } catch (e) {
        console.error('[AI] Read procedure error:', e);
      }
    }

    // --- Détecter si on veut MODIFIER une procédure ---
    const wantsModifyProcedure = (
      (msgLower.includes('procédure') || msgLower.includes('procedure')) &&
      (msgLower.includes('modifier') || msgLower.includes('éditer') || msgLower.includes('editer') ||
       msgLower.includes('changer') || msgLower.includes('mettre à jour') || msgLower.includes('ajouter étape') ||
       msgLower.includes('supprimer étape') || msgLower.includes('renommer'))
    );

    if (wantsModifyProcedure) {
      // Extract procedure name from message
      const modifyMatch = /[""«]([^""»]+)[""»]/i.exec(message);
      const searchTitle = modifyMatch?.[1] || '';

      console.log(`[AI] ✏️ Modify procedure mode: ${searchTitle}`);

      try {
        // Find the procedure
        const procResult = await pool.query(`
          SELECT p.*, json_agg(
            json_build_object(
              'id', s.id,
              'step_number', s.step_number,
              'title', s.title,
              'description', s.description,
              'instructions', s.instructions
            )
            ORDER BY s.step_number
          ) as steps
          FROM procedures p
          LEFT JOIN procedure_steps s ON s.procedure_id = p.id
          WHERE (p.site = $1 OR p.site IS NULL OR p.site = '') ${searchTitle ? "AND LOWER(p.title) LIKE $2" : ""}
          GROUP BY p.id
          ORDER BY CASE WHEN p.site = $1 THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1
        `, searchTitle ? [site, `%${searchTitle.toLowerCase()}%`] : [site]);

        if (procResult.rows.length > 0) {
          const proc = procResult.rows[0];
          const steps = proc.steps?.[0] ? proc.steps.filter(s => s.step_number) : [];

          let response = `## ✏️ Modifier: ${proc.title}\n\n`;
          response += `**Informations actuelles:**\n`;
          response += `- Niveau de risque: ${proc.risk_level || 'non défini'}\n`;
          response += `- EPI requis: ${(proc.ppe_required || []).join(', ') || 'aucun'}\n`;
          response += `- Catégorie: ${proc.category || 'général'}\n\n`;

          if (steps.length > 0) {
            response += `**Étapes (${steps.length}):**\n`;
            steps.forEach(s => {
              response += `${s.step_number}. ${s.title || s.description}\n`;
            });
          }

          response += `\n---\n**Que veux-tu modifier ?**\n`;
          response += `- "Ajouter une étape" pour ajouter une nouvelle étape\n`;
          response += `- "Modifier l'étape X" pour changer une étape\n`;
          response += `- "Changer le titre" pour renommer la procédure\n`;
          response += `- "Supprimer l'étape X" pour retirer une étape`;

          return res.json({
            message: response,
            actions: [
              { label: "Ajouter une étape", prompt: `Ajoute une étape à la procédure "${proc.title}"` },
              { label: "Changer le titre", prompt: `Change le titre de la procédure "${proc.title}"` },
              { label: "Modifier les EPI", prompt: `Modifie les EPI de la procédure "${proc.title}"` }
            ],
            provider: 'system',
            procedureEditId: proc.id,
            procedureTitle: proc.title,
            mode: 'procedure-edit'
          });
        } else {
          return res.json({
            message: "Je n'ai pas trouvé cette procédure. Montre-moi la liste des procédures disponibles.",
            actions: [{ label: "Voir les procédures", prompt: "Montre-moi mes procédures" }],
            provider: 'system'
          });
        }
      } catch (e) {
        console.error('[AI] Modify procedure error:', e);
      }
    }

    // --- Handle active edit session - ADDING a step ---
    const wantsAddStep = msgLower.includes('ajouter') && (msgLower.includes('étape') || msgLower.includes('etape'));
    const lastEditMsg = [...conversationHistory].reverse().find(m => m.procedureEditId);

    if (wantsAddStep && lastEditMsg?.procedureEditId) {
      console.log(`[AI] ➕ Adding step to procedure: ${lastEditMsg.procedureEditId}`);

      return res.json({
        message: "📝 **Nouvelle étape**\n\nDécris la nouvelle étape que tu veux ajouter. Je vais l'ajouter à la fin de la procédure.\n\nExemple: \"L'étape consiste à vérifier que le disjoncteur est en position OFF avant toute intervention\"",
        actions: [
          { label: "Annuler", prompt: "Annuler, je ne veux plus modifier" }
        ],
        provider: 'system',
        procedureEditId: lastEditMsg.procedureEditId,
        procedureTitle: lastEditMsg.procedureTitle,
        editAction: 'add-step',
        mode: 'procedure-edit'
      });
    }

    // --- Handle step addition description ---
    const lastEditAction = [...conversationHistory].reverse().find(m => m.editAction);

    if (lastEditAction?.editAction === 'add-step' && lastEditAction?.procedureEditId && message.length > 10) {
      console.log(`[AI] ✅ Creating new step for: ${lastEditAction.procedureEditId}`);

      try {
        // Get current step count
        const countResult = await pool.query(
          `SELECT MAX(step_number) as max_step FROM procedure_steps WHERE procedure_id = $1`,
          [lastEditAction.procedureEditId]
        );
        const nextStepNumber = (countResult.rows[0]?.max_step || 0) + 1;

        // Add the step
        await pool.query(
          `INSERT INTO procedure_steps (procedure_id, step_number, title, description, instructions)
           VALUES ($1, $2, $3, $4, $5)`,
          [lastEditAction.procedureEditId, nextStepNumber, `Étape ${nextStepNumber}`, message, message]
        );

        return res.json({
          message: `✅ **Étape ${nextStepNumber} ajoutée !**\n\n"${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"\n\nVeux-tu ajouter une autre étape ou continuer les modifications ?`,
          actions: [
            { label: "Ajouter une autre étape", prompt: `Ajoute une autre étape à la procédure` },
            { label: "Voir la procédure", prompt: `Montre-moi la procédure "${lastEditAction.procedureTitle}"` },
            { label: "Terminé", prompt: "C'est bon, j'ai fini les modifications" }
          ],
          provider: 'system',
          procedureEditId: lastEditAction.procedureEditId,
          procedureTitle: lastEditAction.procedureTitle,
          mode: 'procedure-edit'
        });
      } catch (e) {
        console.error('[AI] Add step error:', e);
        return res.json({
          message: "Erreur lors de l'ajout de l'étape. Réessaie.",
          actions: [{ label: "Réessayer", prompt: "Ajoute une étape" }],
          provider: 'system'
        });
      }
    }

    // --- Handle CHANGE TITLE request ---
    const wantsChangeTitle = msgLower.includes('change') && msgLower.includes('titre');
    if (wantsChangeTitle && lastEditMsg?.procedureEditId) {
      return res.json({
        message: `📝 **Nouveau titre**\n\nQuel est le nouveau titre pour "${lastEditMsg.procedureTitle}" ?\n\nÉcris simplement le nouveau titre.`,
        actions: [{ label: "Annuler", prompt: "Annuler" }],
        provider: 'system',
        procedureEditId: lastEditMsg.procedureEditId,
        procedureTitle: lastEditMsg.procedureTitle,
        editAction: 'change-title',
        mode: 'procedure-edit'
      });
    }

    // Handle title change
    if (lastEditAction?.editAction === 'change-title' && lastEditAction?.procedureEditId && message.length > 2) {
      try {
        await pool.query(
          `UPDATE procedures SET title = $1, updated_at = now() WHERE id = $2`,
          [message.trim(), lastEditAction.procedureEditId]
        );

        return res.json({
          message: `✅ **Titre modifié !**\n\nNouveau titre: "${message.trim()}"`,
          actions: [
            { label: "Autres modifications", prompt: `Modifier la procédure "${message.trim()}"` },
            { label: "Terminé", prompt: "C'est bon, j'ai fini" }
          ],
          provider: 'system',
          procedureEditId: lastEditAction.procedureEditId,
          procedureTitle: message.trim(),
          mode: 'procedure-edit'
        });
      } catch (e) {
        console.error('[AI] Change title error:', e);
      }
    }

    // --- Handle MODIFY EPI request ---
    const wantsModifyEPI = (msgLower.includes('modifie') || msgLower.includes('change')) &&
                           (msgLower.includes('epi') || msgLower.includes('équipement') || msgLower.includes('protection'));
    if (wantsModifyEPI && lastEditMsg?.procedureEditId) {
      return res.json({
        message: `🦺 **Équipements de Protection Individuelle**\n\nListe les EPI requis, séparés par des virgules.\n\nExemple: "Casque, Gants isolants, Lunettes de protection, Chaussures de sécurité"`,
        actions: [
          { label: "EPI standard", prompt: "Casque de sécurité, Gants de protection, Lunettes de sécurité, Chaussures de sécurité" },
          { label: "Annuler", prompt: "Annuler" }
        ],
        provider: 'system',
        procedureEditId: lastEditMsg.procedureEditId,
        procedureTitle: lastEditMsg.procedureTitle,
        editAction: 'change-ppe',
        mode: 'procedure-edit'
      });
    }

    // Handle PPE change
    if (lastEditAction?.editAction === 'change-ppe' && lastEditAction?.procedureEditId && message.length > 2) {
      try {
        const ppeList = message.split(',').map(p => p.trim()).filter(p => p.length > 0);

        await pool.query(
          `UPDATE procedures SET ppe_required = $1, updated_at = now() WHERE id = $2`,
          [JSON.stringify(ppeList), lastEditAction.procedureEditId]
        );

        return res.json({
          message: `✅ **EPI mis à jour !**\n\n${ppeList.map(p => `- ${p}`).join('\n')}`,
          actions: [
            { label: "Autres modifications", prompt: `Modifier la procédure "${lastEditAction.procedureTitle}"` },
            { label: "Terminé", prompt: "C'est bon, j'ai fini" }
          ],
          provider: 'system',
          procedureEditId: lastEditAction.procedureEditId,
          procedureTitle: lastEditAction.procedureTitle,
          mode: 'procedure-edit'
        });
      } catch (e) {
        console.error('[AI] Change PPE error:', e);
      }
    }

    // --- Handle DELETE STEP request ---
    const wantsDeleteStep = msgLower.includes('supprimer') && (msgLower.includes('étape') || msgLower.includes('etape'));
    const stepNumMatch = /étape\s*(\d+)|etape\s*(\d+)|supprimer\s*(\d+)/i.exec(message);

    if (wantsDeleteStep && lastEditMsg?.procedureEditId && stepNumMatch) {
      const stepNum = parseInt(stepNumMatch[1] || stepNumMatch[2] || stepNumMatch[3]);

      try {
        // Get the step
        const stepResult = await pool.query(
          `SELECT id, title FROM procedure_steps WHERE procedure_id = $1 AND step_number = $2`,
          [lastEditMsg.procedureEditId, stepNum]
        );

        if (stepResult.rows.length > 0) {
          return res.json({
            message: `⚠️ **Confirmer la suppression**\n\nVeux-tu vraiment supprimer l'étape ${stepNum}: "${stepResult.rows[0].title || 'Sans titre'}" ?\n\nCette action est irréversible.`,
            actions: [
              { label: "Oui, supprimer", prompt: `CONFIRMER SUPPRESSION ÉTAPE ${stepNum}` },
              { label: "Non, annuler", prompt: "Annuler la suppression" }
            ],
            provider: 'system',
            procedureEditId: lastEditMsg.procedureEditId,
            procedureTitle: lastEditMsg.procedureTitle,
            deleteStepId: stepResult.rows[0].id,
            deleteStepNum: stepNum,
            mode: 'procedure-edit'
          });
        }
      } catch (e) {
        console.error('[AI] Delete step prep error:', e);
      }
    }

    // Handle step deletion confirmation
    const lastDeleteMsg = [...conversationHistory].reverse().find(m => m.deleteStepId);
    if (lastDeleteMsg?.deleteStepId && msgLower.includes('confirmer suppression')) {
      try {
        await pool.query(`DELETE FROM procedure_steps WHERE id = $1`, [lastDeleteMsg.deleteStepId]);

        // Renumber remaining steps
        await pool.query(`
          WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY step_number) as new_num
            FROM procedure_steps WHERE procedure_id = $1
          )
          UPDATE procedure_steps SET step_number = numbered.new_num
          FROM numbered WHERE procedure_steps.id = numbered.id
        `, [lastDeleteMsg.procedureEditId]);

        return res.json({
          message: `✅ **Étape ${lastDeleteMsg.deleteStepNum} supprimée !**\n\nLes étapes ont été renumérotées automatiquement.`,
          actions: [
            { label: "Voir la procédure", prompt: `Montre-moi la procédure "${lastDeleteMsg.procedureTitle}"` },
            { label: "Autres modifications", prompt: `Modifier la procédure "${lastDeleteMsg.procedureTitle}"` }
          ],
          provider: 'system',
          procedureEditId: lastDeleteMsg.procedureEditId,
          procedureTitle: lastDeleteMsg.procedureTitle,
          mode: 'procedure-edit'
        });
      } catch (e) {
        console.error('[AI] Delete step error:', e);
      }
    }

    // --- Détecter si on veut GÉNÉRER UN PDF ---
    const wantsPDF = /(?:génère|genere|télécharge|telecharge|pdf|exporte?).*(?:procédure|procedure)/i.test(message) ||
                     /(?:procédure|procedure).*(?:pdf|génère|genere)/i.test(message);

    if (wantsPDF) {
      // Extract procedure name from message or use last mentioned
      const pdfMatch = /[""«]([^""»]+)[""»]/i.exec(message);
      const searchTitle = pdfMatch?.[1] || '';

      console.log(`[AI] 📄 Generating PDF for: ${searchTitle}`);

      try {
        // Find the procedure (include procedures without site)
        const procResult = await pool.query(`
          SELECT id, title FROM procedures
          WHERE (site = $1 OR site IS NULL OR site = '') ${searchTitle ? "AND LOWER(title) LIKE $2" : ""}
          ORDER BY CASE WHEN site = $1 THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1
        `, searchTitle ? [site, `%${searchTitle.toLowerCase()}%`] : [site]);

        if (procResult.rows.length > 0) {
          const proc = procResult.rows[0];
          // Call the procedures microservice to generate PDF
          const pdfUrl = `/api/procedures/${proc.id}/pdf`;

          return res.json({
            message: `✅ **PDF prêt !**\n\nProcédure: **${proc.title}**\n\n[📥 Télécharger le PDF](${pdfUrl})`,
            actions: [{ label: "Télécharger PDF", url: pdfUrl }],
            provider: 'system',
            pdfUrl: pdfUrl
          });
        } else {
          return res.json({
            message: "Je n'ai pas trouvé cette procédure. Dis-moi son nom exact ou crée-en une nouvelle.",
            actions: [{ label: "Créer une procédure", prompt: "Je veux créer une procédure" }],
            provider: 'system'
          });
        }
      } catch (e) {
        console.error('[AI] PDF generation error:', e);
      }
    }

    // Note: Titre et finalisation sont maintenant gérés via le microservice de procédures
    // (procedureSessionId dans conversationHistory)

    // Get real-time context from database
    const dbContext = await getAIContext(site);
    const contextPrompt = formatContextForAI(dbContext);

    // Check if user wants document search (with product/manufacturer name)
    const needsDocs = /document|manuel|fiche|norme|pdf|technique|spécification|datasheet|documentation/i.test(message);
    const hasProduct = /altivar|atv|abb|acs|siemens|sinamics|danfoss|vlt|schneider|sef|legrand/i.test(message);
    let docContext = '';
    let docSources = [];
    let webDocResults = null;

    if (needsDocs) {
      console.log('[AI] 📄 Searching documents...');
      const docResults = await searchDocuments(message, 5);
      if (docResults.results.length > 0) {
        docContext = `\n\n## Documents trouvés\n${docResults.results.map((d, i) =>
          `${i + 1}. **${d.title}** (pertinence: ${Math.round((d.score || 0) * 100)}%)\n   ${d.excerpt}`
        ).join('\n\n')}`;
        docSources = docResults.results.map(d => ({ title: d.title, page: d.page }));
      }

      // If user mentions a specific product, automatically search web documentation
      if (hasProduct) {
        console.log('[AI] 🌐 Auto-searching web documentation for product...');
        try {
          webDocResults = await searchWebForDocumentation(message, { name: message, manufacturer: '', model: '' });
          if (webDocResults.pdfLinks && webDocResults.pdfLinks.length > 0) {
            docContext += `\n\n## 📄 Documentation fabricant trouvée\n`;
            webDocResults.pdfLinks.forEach((link, i) => {
              docContext += `${i + 1}. [${link.title}](${link.url})`;
              if (link.manufacturer) docContext += ` - ${link.manufacturer}`;
              docContext += `\n`;
            });
            // Add to sources
            docSources = [...docSources, ...webDocResults.pdfLinks.map(l => ({
              title: l.title,
              url: l.url,
              type: l.type,
              manufacturer: l.manufacturer
            }))];
          }
          if (webDocResults.summary) {
            docContext += `\n\n**Résumé technique:**\n${webDocResults.summary.substring(0, 1000)}`;
          }
        } catch (e) {
          console.error('[AI] Web doc search error:', e.message);
        }
      }
    }

    // ============================================================
    // AUTO-DETECT SPECIFIC PROCEDURE REQUEST (show me, guide me)
    // ============================================================
    const wantsSpecificProcedure = (msgLower.includes('montre') || msgLower.includes('voir') ||
                                     msgLower.includes('guide') || msgLower.includes('détail') ||
                                     msgLower.includes('affiche')) && msgLower.includes('procédure');
    const quotedMatch = /[""«]([^""»]+)[""»]/i.exec(message);
    const procedureNameMatch = quotedMatch?.[1] || /procédure\s+(?:de\s+)?(.+?)(?:\s*\?|$)/i.exec(message)?.[1];

    if (wantsSpecificProcedure && procedureNameMatch) {
      console.log(`[AI] 📋 Looking for specific procedure: ${procedureNameMatch}`);

      try {
        // Search for the specific procedure by name
        const specificProcResult = await pool.query(`
          SELECT p.id, p.title, p.description, p.category, p.risk_level, p.ppe_required,
                 (SELECT json_agg(s ORDER BY s.step_number)
                  FROM procedure_steps s WHERE s.procedure_id = p.id) as steps
          FROM procedures p
          WHERE (p.site = $1 OR p.site IS NULL OR p.site = '')
            AND p.status != 'archived'
            AND (p.title ILIKE $2 OR p.description ILIKE $2)
          ORDER BY CASE WHEN p.title ILIKE $2 THEN 0 ELSE 1 END
          LIMIT 1
        `, [site, `%${procedureNameMatch}%`]);

        if (specificProcResult.rows.length > 0) {
          const proc = specificProcResult.rows[0];
          const steps = proc.steps || [];

          let stepsText = steps.map((s, i) =>
            `**Étape ${i + 1}:** ${s.title}${s.description ? `\n   ${s.description}` : ''}${s.warning ? `\n   ⚠️ ${s.warning}` : ''}`
          ).join('\n\n');

          const ppeList = Array.isArray(proc.ppe_required) ? proc.ppe_required.join(', ') : 'Non défini';

          return res.json({
            message: `📋 **${proc.title}**\n\n🛡️ **EPI requis:** ${ppeList}\n⚠️ **Niveau de risque:** ${proc.risk_level || 'medium'}\n📝 **Catégorie:** ${proc.category || 'general'}\n\n---\n\n${stepsText || 'Aucune étape définie'}\n\n---\n\n📥 [Télécharger le PDF](/api/procedures/${proc.id}/pdf)`,
            actions: [
              { label: "📥 Télécharger PDF", url: `/api/procedures/${proc.id}/pdf` },
              { label: "🚀 Être guidé pas à pas", prompt: `Lance-moi le mode guidage sur "${proc.title}"` },
              { label: "✏️ Modifier", prompt: `Modifier la procédure "${proc.title}"` }
            ],
            provider: 'system',
            procedureId: proc.id,
            procedureDetails: {
              id: proc.id,
              title: proc.title,
              steps: steps.length,
              riskLevel: proc.risk_level,
              ppe: proc.ppe_required
            }
          });
        }
      } catch (e) {
        console.error('[AI] Specific procedure lookup error:', e.message);
      }
    }

    // ============================================================
    // AUTO-DETECT PROCEDURE REQUESTS - CRITICAL FIX
    // ============================================================

    // Check if user is confirming to see a procedure ("oui", "la première", "celle-ci", "la 1", etc.)
    const isConfirmation = /^(oui|ok|d'accord|celle[- ]?(ci|là)|la premi[èe]re|la 1[èe]?re?|la \d+|le \d+|num[ée]ro \d+|\d+|yes|yep|ouais|vas-y|go|voir|montre)[\s!.]*$/i.test(msgLower.trim());

    // If user confirms, check conversation history for recent procedure list
    if (isConfirmation && conversationHistory?.length > 0) {
      const lastAssistantMsg = conversationHistory.filter(m => m.role === 'assistant').slice(-1)[0];
      if (lastAssistantMsg?.content?.includes('procédure')) {
        console.log('[AI] 📋 User confirmed - checking for procedure context...');

        // Look for procedure in context
        const procedures = dbContext.procedures?.list || [];
        if (procedures.length > 0) {
          // Extract the index from user message (e.g., "la 1", "la 2", "2", "numéro 3")
          let selectedIndex = 0; // Default to first
          const indexMatch = msgLower.match(/(?:la|le|num[ée]ro)?\s*(\d+)/i);
          if (indexMatch) {
            selectedIndex = parseInt(indexMatch[1]) - 1;
            if (selectedIndex < 0 || selectedIndex >= procedures.length) {
              selectedIndex = 0; // Fallback to first if out of bounds
            }
          }

          const selectedProc = procedures[selectedIndex];
          console.log(`[AI] 📖 CONFIRMATION DETECTED - Opening procedure #${selectedIndex + 1}: ${selectedProc.id} - "${selectedProc.title}"`);

          return res.json({
            message: `📋 **${selectedProc.title}**\n\nJ'ouvre la procédure pour toi...`,
            procedureToOpen: {
              id: selectedProc.id,
              title: selectedProc.title
            },
            actions: [
              { label: "🚀 Commencer le guidage", prompt: `Guide-moi étape par étape sur "${selectedProc.title}"` }
            ],
            provider: "Electro"
          });
        }
      }
    }

    // Procedure keywords - removed tableau/armoire to avoid conflicts with navigation
    const procedureKeywords = ['procédure', 'procedure', 'contrôle qualité', 'vérification',
                               'maintenance préventive', 'intervention', 'comment faire', 'méthode',
                               'prise électrique', 'prises électrique'];

    // Check if this is clearly a building/equipment navigation request (should NOT trigger procedure search)
    const isBuildingNavigation = (msgLower.includes('bâtiment') || msgLower.includes('batiment') ||
                                   msgLower.includes('étage') || msgLower.includes('building')) &&
                                  (msgLower.includes('tableau') || msgLower.includes('armoire') ||
                                   msgLower.includes('équipement') || msgLower.includes('electrique'));

    const wantsProcedure = !isBuildingNavigation &&
                           procedureKeywords.some(kw => msgLower.includes(kw)) &&
                           (msgLower.includes('?') || msgLower.includes('on a') || msgLower.includes('existe') ||
                            msgLower.includes('cherche') || msgLower.includes('trouve') || msgLower.includes('comment') ||
                            msgLower.includes('voir') || msgLower.includes('montre') || msgLower.includes('guide') ||
                            msgLower.includes('pour') || msgLower.includes('dois') || msgLower.includes('oui'));

    // Detect if user wants to SEE a specific procedure (not just search)
    const wantsToSeeProcedure = !isBuildingNavigation &&
                                (msgLower.includes('montre') || msgLower.includes('voir') ||
                                  msgLower.includes('affiche') || msgLower.includes('oui') ||
                                  msgLower.includes('guide-moi') || msgLower.includes('guide moi')) &&
                                 (msgLower.includes('procédure') || msgLower.includes('procedure') ||
                                  msgLower.includes('étape') || msgLower.includes('etape'));

    let procedureSearchResults = null;
    let procedureContext = '';
    let procedureDetailsLoaded = null;

    if (wantsProcedure || wantsToSeeProcedure) {
      console.log('[AI] 📋 Auto-detecting procedure request...');

      // Extract keywords from message for search
      const extractedKeywords = procedureKeywords.filter(kw => msgLower.includes(kw));

      // Also look for specific equipment types
      const equipmentTypes = ['prise', 'prises', 'tableau', 'armoire', 'disjoncteur', 'variateur', 'moteur',
                              'pompe', 'ventilateur', 'éclairage', 'eclairage', 'câble', 'cable', 'terre',
                              'électrique', 'electrique', 'atex', 'zone', 'thermographie', 'isolement'];
      const foundEquipment = equipmentTypes.filter(eq => msgLower.includes(eq));

      const searchKeywords = [...new Set([...extractedKeywords, ...foundEquipment])].slice(0, 5);

      if (searchKeywords.length > 0) {
        console.log(`[AI] 🔍 Searching procedures with keywords: ${searchKeywords.join(', ')}`);

        try {
          // Execute the searchProcedures action automatically
          procedureSearchResults = await executeAIAction('searchProcedures', {
            keywords: searchKeywords
          }, site);

          if (procedureSearchResults.success && procedureSearchResults.found && procedureSearchResults.procedures.length > 0) {
            // If user wants to SEE the procedure, SKIP AI and directly return procedure to open in modal
            const shouldOpenModal = wantsToSeeProcedure || procedureSearchResults.procedures.length === 1;

            if (shouldOpenModal) {
              const proc = procedureSearchResults.procedures[0];
              console.log(`[AI] 📖 OPENING PROCEDURE MODAL for ID: ${proc.id} - "${proc.title}"`);

              // BYPASS AI - Return directly to open modal
              return res.json({
                message: `📋 **${proc.title}**\n\nJ'ouvre la procédure pour toi...`,
                procedureToOpen: {
                  id: proc.id,
                  title: proc.title
                },
                actions: [
                  { label: "🚀 Commencer le guidage", prompt: `Guide-moi étape par étape sur "${proc.title}"` }
                ],
                provider: "Electro"
              });
            } else {
              // Multiple procedures found - list them and ask which one
              const procList = procedureSearchResults.procedures.slice(0, 5);
              return res.json({
                message: `📋 **${procedureSearchResults.count} procédure(s) trouvée(s):**\n\n` +
                  procList.map((p, i) => `${i + 1}. **${p.title}** (${p.stepCount} étapes)`).join('\n') +
                  `\n\nLaquelle veux-tu voir ?`,
                proceduresFound: procList,
                actions: procList.slice(0, 3).map(p => ({
                  label: p.title.substring(0, 25),
                  prompt: `Montre-moi la procédure "${p.title}"`
                })),
                provider: "Electro"
              });
            }
          } else {
            // No procedure found - suggest creating one
            return res.json({
              message: `📋 **Aucune procédure trouvée** pour "${searchKeywords.join(', ')}".\n\nVeux-tu en créer une ?`,
              actions: [
                { label: "➕ Créer une procédure", prompt: "Je veux créer une nouvelle procédure" }
              ],
              provider: "Electro"
            });
          }
        } catch (e) {
          console.error('[AI] Procedure search error:', e.message);
        }
      }
    }

    // Build full context with procedures
    const fullContext = contextPrompt + docContext + procedureContext;

    // ============================================================
    // 🧠 PERSONALIZED CONTEXT - Memory & Learning Integration
    // ============================================================
    let personalizedContext = '';
    let predictionsContext = '';

    try {
      // Get personalized context based on user history
      personalizedContext = await getPersonalizedContext(userEmail, site);

      // Add predictions context if available
      if (dbContext.predictions?.riskAnalysis?.length > 0) {
        const highRisk = dbContext.predictions.riskAnalysis.filter(r => parseFloat(r.riskScore) >= 0.5);
        if (highRisk.length > 0) {
          predictionsContext = `\n\n## 🔮 PRÉDICTIONS & RISQUES DÉTECTÉS
${highRisk.slice(0, 5).map(r => `- **${r.name}**: Risque ${(parseFloat(r.riskScore) * 100).toFixed(0)}% - ${r.recommendation}`).join('\n')}`;
        }
      }

      if (dbContext.predictions?.maintenanceNeeds?.recommendation) {
        predictionsContext += `\n\n**Charge de travail:** ${dbContext.predictions.maintenanceNeeds.recommendation}`;
      }
    } catch (e) {
      console.error('[AI] Personalization error:', e.message);
    }

    // Build messages for AI with personalized context
    const enhancedSystemPrompt = AI_SYSTEM_PROMPT + "\n\n" + personalizedContext + predictionsContext + "\n\n" + fullContext;

    const messages = [
      { role: "system", content: enhancedSystemPrompt },
      ...conversationHistory.slice(-8).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message }
    ];

    // Call AI (OpenAI -> Gemini fallback)
    const aiResult = await callAI(messages, { maxTokens: 2000 });

    // 🧠 Learn from this interaction (async, don't wait)
    if (aiResult.content) {
      learnFromInteraction(userEmail, site, message, aiResult.content).catch(e => {
        console.error('[AI] Learning error:', e.message);
      });
    }

    if (!aiResult.content) {
      // Ultimate fallback
      console.log('[AI] ⚠️ No AI available, using intelligent fallback');
      return res.json(generateIntelligentFallback(message, dbContext));
    }

    // Parse response for charts and actions
    const parsed = parseAIResponse(aiResult.content);

    // Execute action if requested and action found
    let actionResult = null;
    if (executeAction && parsed.action) {
      console.log(`[AI] ⚡ Executing action: ${parsed.action}`);
      actionResult = await executeAIAction(parsed.action, parsed.actionParams, site);

      // Append action result to message
      if (actionResult.success) {
        parsed.message += `\n\n---\n**Action exécutée:** ${actionResult.message}`;

        // For searchDoc action, append the actual PDF links to the message
        if (parsed.action === 'searchDoc' && actionResult.sources && actionResult.sources.length > 0) {
          parsed.message += `\n\n📄 **Documents disponibles:**`;
          actionResult.sources.forEach((source, i) => {
            parsed.message += `\n${i + 1}. [${source.title}](${source.url})`;
            if (source.manufacturer) parsed.message += ` - ${source.manufacturer}`;
          });
        }
      } else {
        parsed.message += `\n\n---\n**Erreur d'exécution:** ${actionResult.message}`;
      }
    }

    // If we auto-searched web docs and found results, append to message
    if (webDocResults && webDocResults.pdfLinks && webDocResults.pdfLinks.length > 0) {
      // Check if the AI response doesn't already contain the links
      if (!parsed.message.includes('schneider-electric.com') && !parsed.message.includes('se.com')) {
        parsed.message += `\n\n📄 **Documentation disponible:**`;
        webDocResults.pdfLinks.forEach((link, i) => {
          parsed.message += `\n${i + 1}. [${link.title}](${link.url})`;
          if (link.manufacturer) parsed.message += ` - ${link.manufacturer}`;
        });
      }
    }

    // Extract suggested follow-up actions
    let suggestedActions = extractActionsFromResponse(parsed.message, message);

    // Add procedure-specific actions if we searched for procedures
    if (procedureSearchResults) {
      if (procedureSearchResults.found && procedureSearchResults.procedures?.length > 0) {
        // Add actions to see procedure details or guide
        const firstProc = procedureSearchResults.procedures[0];
        suggestedActions = [
          { label: `📋 Voir "${firstProc.title}"`, prompt: `Montre-moi la procédure "${firstProc.title}"` },
          { label: "🚀 Être guidé", prompt: `Guide-moi sur la procédure "${firstProc.title}"` },
          ...suggestedActions.slice(0, 2)
        ];
      } else {
        // Add action to create a new procedure
        suggestedActions = [
          { label: "➕ Créer une procédure", prompt: "Je veux créer une nouvelle procédure" },
          ...suggestedActions.slice(0, 3)
        ];
      }
    }

    // Build response
    const response = {
      message: parsed.message,
      actions: suggestedActions,
      sources: docSources,
      provider: aiResult.provider,
      model: aiResult.model,
      context: {
        site,
        switchboards: dbContext.switchboards.count,
        controls: dbContext.controls,
        procedures: dbContext.procedures?.count || 0,
        timestamp: dbContext.timestamp
      }
    };

    // Add procedure search results to response if found
    if (procedureSearchResults?.found) {
      response.proceduresFound = procedureSearchResults.procedures;
    }

    // Add chart if present, or auto-generate for statistical queries
    if (parsed.chart) {
      response.chart = parsed.chart;
      console.log('[AI] 📊 Chart generated:', parsed.chart.type, parsed.chart.title);
    } else {
      // Auto-generate chart for analysis/statistics/overview queries
      const msgLower = message.toLowerCase();
      if (msgLower.includes('analyse') || msgLower.includes('statistique') || msgLower.includes('global') ||
          msgLower.includes('résumé') || msgLower.includes('vue') || msgLower.includes('situation') ||
          msgLower.includes('répartition') || msgLower.includes('bâtiment') || msgLower.includes('carte')) {
        const chartType = msgLower.includes('bâtiment') || msgLower.includes('carte') || msgLower.includes('répartition')
          ? 'buildings'
          : msgLower.includes('contrôle') ? 'controls' : 'overview';
        response.chart = autoGenerateChart(dbContext, chartType);
        if (response.chart) {
          console.log('[AI] 📊 Auto-generated chart:', response.chart.type, response.chart.title);
        }
      }
    }

    // Add pending action if not executed
    if (parsed.action && !executeAction) {
      response.pendingAction = {
        action: parsed.action,
        params: parsed.actionParams,
        description: `Action proposée: ${parsed.action}`
      };
      console.log('[AI] 🔧 Action proposed:', parsed.action);
    }

    // Add action result if executed
    if (actionResult) {
      response.actionResult = actionResult;
      // Merge sources from action result (e.g., searchDoc returns PDF links)
      if (actionResult.sources && actionResult.sources.length > 0) {
        response.sources = [...(response.sources || []), ...actionResult.sources];
      }
    }

    // Add predictions to response for frontend display
    if (dbContext.predictions?.riskAnalysis?.length > 0) {
      response.predictions = {
        highRiskCount: dbContext.predictions.riskAnalysis.filter(r => parseFloat(r.riskScore) >= 0.5).length,
        risks: dbContext.predictions.riskAnalysis.slice(0, 5)
      };
    }

    // Add user profile info for personalization display
    try {
      const profile = await getUserProfile(userEmail);
      response.userProfile = {
        isNewUser: profile.isNewUser,
        totalInteractions: profile.totalInteractions,
        favoriteTopics: profile.favoriteTopics?.slice(0, 3) || []
      };
    } catch (e) {
      // Ignore profile errors
    }

    res.json(response);

  } catch (error) {
    console.error('[AI] ❌ Error:', error.message);

    // Fallback on error
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';
    const dbContext = await getAIContext(site).catch(() => ({}));

    res.json(generateIntelligentFallback(req.body?.message || '', dbContext));
  }
});

// ============================================================
// 🧠 AI FEEDBACK ENDPOINT - Learn from user feedback
// ============================================================
app.post("/api/ai-assistant/feedback", express.json(), async (req, res) => {
  try {
    const { messageId, feedback, message, response, site } = req.body;
    const userEmail = req.body.user?.email || 'anonymous';

    console.log(`[AI] 📝 Feedback received: ${feedback} from ${userEmail}`);

    // Save feedback to memory
    await saveUserMemory(
      userEmail,
      'feedback',
      feedback === 'positive' ? 'helpful' : 'unhelpful',
      `feedback_${messageId}`,
      {
        messageId,
        feedback,
        userMessage: message?.substring(0, 200),
        aiResponse: response?.substring(0, 200),
        timestamp: new Date().toISOString()
      },
      feedback === 'positive' ? 0.8 : 0.3,
      site
    );

    // Learn from interaction with feedback
    if (message && response) {
      await learnFromInteraction(userEmail, site, message, response, feedback);
    }

    res.json({ ok: true, message: 'Merci pour ton feedback !' });
  } catch (e) {
    console.error('[AI] Feedback error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// 🔮 AI PREDICTIONS ENDPOINT - Get risk analysis
// ============================================================
app.get("/api/ai-assistant/predictions", async (req, res) => {
  try {
    const site = req.header('X-Site') || req.query.site || process.env.DEFAULT_SITE || 'Nyon';

    const [risks, maintenance] = await Promise.all([
      calculateEquipmentRisk(site),
      predictMaintenanceNeeds(site)
    ]);

    res.json({
      ok: true,
      predictions: {
        risks: {
          total: risks.length,
          high: risks.filter(r => parseFloat(r.riskScore) >= 0.7).length,
          medium: risks.filter(r => parseFloat(r.riskScore) >= 0.5 && parseFloat(r.riskScore) < 0.7).length,
          list: risks.slice(0, 10)
        },
        maintenance: {
          totalNext30Days: maintenance.totalNext30Days,
          workload: maintenance.workloadPrediction,
          recommendation: maintenance.recommendation,
          upcoming: maintenance.upcomingControls
        }
      }
    });
  } catch (e) {
    console.error('[AI] Predictions error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 💡 AI SUGGESTIONS ENDPOINT - Personalized suggestions
// ============================================================
app.get("/api/ai-assistant/suggestions", async (req, res) => {
  try {
    const site = req.header('X-Site') || req.query.site || process.env.DEFAULT_SITE || 'Nyon';
    const userEmail = req.query.email || 'anonymous';

    const suggestions = await getIntelligentSuggestions(site, userEmail);

    res.json({
      ok: true,
      suggestions
    });
  } catch (e) {
    console.error('[AI] Suggestions error:', e.message);
    res.json({ ok: false, suggestions: [] });
  }
});

// ============================================================
// 📊 AI HISTORICAL STATS - For dynamic charts
// ============================================================
app.get("/api/ai-assistant/historical-stats", async (req, res) => {
  try {
    const site = req.header('X-Site') || req.query.site || process.env.DEFAULT_SITE || 'Nyon';
    const period = parseInt(req.query.period) || 30;

    // Get control history for charts
    const controlStats = await pool.query(`
      SELECT
        DATE_TRUNC('day', cr.control_date) as day,
        COUNT(*) as total,
        SUM(CASE WHEN cr.result = 'conforme' THEN 1 ELSE 0 END) as conforme,
        SUM(CASE WHEN cr.result = 'non_conforme' THEN 1 ELSE 0 END) as non_conforme
      FROM control_reports cr
      LEFT JOIN switchboards s ON cr.switchboard_id = s.id
      WHERE s.site = $1
        AND cr.control_date >= CURRENT_DATE - INTERVAL '${period} days'
      GROUP BY DATE_TRUNC('day', cr.control_date)
      ORDER BY day
    `, [site]);

    // Get building distribution
    const buildingStats = await pool.query(`
      SELECT
        s.building_code,
        COUNT(DISTINCT s.id) as equipment_count,
        COUNT(DISTINCT CASE
          WHEN cs.last_control_date IS NULL
            OR cs.last_control_date < CURRENT_DATE - INTERVAL '1 year'
          THEN s.id
        END) as overdue
      FROM switchboards s
      LEFT JOIN control_schedules cs ON cs.switchboard_id = s.id
      WHERE s.site = $1
      GROUP BY s.building_code
      ORDER BY equipment_count DESC
    `, [site]);

    // Get equipment type distribution
    const typeStats = await pool.query(`
      SELECT 'switchboard' as type, COUNT(*) as count FROM switchboards WHERE site = $1
      UNION ALL
      SELECT 'vsd' as type, COUNT(*) as count FROM vsd_equipments WHERE site = $1
      UNION ALL
      SELECT 'atex' as type, COUNT(*) as count FROM atex_equipments e
        INNER JOIN sites s ON e.site_id = s.id WHERE s.name = $1
      UNION ALL
      SELECT 'meca' as type, COUNT(*) as count FROM meca_equipments e
        INNER JOIN sites s ON e.site_id = s.id WHERE s.name = $1
    `, [site]);

    // Calculate trends
    const recentControls = controlStats.rows.slice(-7);
    const olderControls = controlStats.rows.slice(-14, -7);
    const recentTotal = recentControls.reduce((sum, r) => sum + parseInt(r.total), 0);
    const olderTotal = olderControls.reduce((sum, r) => sum + parseInt(r.total), 0);
    const trend = olderTotal > 0 ? ((recentTotal - olderTotal) / olderTotal * 100).toFixed(1) : 0;

    res.json({
      ok: true,
      stats: {
        controlHistory: controlStats.rows.map(r => ({
          date: r.day,
          total: parseInt(r.total),
          conforme: parseInt(r.conforme),
          nonConforme: parseInt(r.non_conforme)
        })),
        buildingDistribution: buildingStats.rows.map(r => ({
          building: r.building_code,
          count: parseInt(r.equipment_count),
          overdue: parseInt(r.overdue)
        })),
        equipmentTypes: typeStats.rows.map(r => ({
          type: r.type,
          count: parseInt(r.count)
        })),
        trends: {
          controlsThisWeek: recentTotal,
          controlsLastWeek: olderTotal,
          percentChange: parseFloat(trend),
          direction: parseFloat(trend) >= 0 ? 'up' : 'down'
        }
      }
    });
  } catch (e) {
    console.error('[AI] Historical stats error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 🔄 AUTO-LEARNING ENDPOINT - Manual trigger
// ============================================================
app.post("/api/ai-assistant/auto-learn", express.json(), async (req, res) => {
  try {
    console.log('[AI] Manual auto-learning triggered');
    const results = await runAutoLearning();
    res.json({ ok: true, results });
  } catch (e) {
    console.error('[AI] Manual auto-learn error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/ai-assistant/learning-stats", async (req, res) => {
  try {
    // Get learning statistics
    const [memoryStats, feedbackStats, userStats] = await Promise.all([
      pool.query(`
        SELECT memory_type, COUNT(*) as count
        FROM ai_user_memory
        GROUP BY memory_type
      `),
      pool.query(`
        SELECT
          content->>'feedback' as feedback,
          COUNT(*) as count
        FROM ai_user_memory
        WHERE memory_type = 'feedback'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY content->>'feedback'
      `),
      pool.query(`
        SELECT COUNT(*) as total_users,
               SUM(total_interactions) as total_interactions
        FROM ai_user_stats
      `)
    ]);

    res.json({
      ok: true,
      stats: {
        memories: memoryStats.rows.reduce((acc, r) => {
          acc[r.memory_type] = parseInt(r.count);
          return acc;
        }, {}),
        recentFeedback: feedbackStats.rows.reduce((acc, r) => {
          acc[r.feedback || 'unknown'] = parseInt(r.count);
          return acc;
        }, {}),
        users: {
          total: parseInt(userStats.rows[0]?.total_users || 0),
          totalInteractions: parseInt(userStats.rows[0]?.total_interactions || 0)
        }
      }
    });
  } catch (e) {
    console.error('[AI] Learning stats error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// 🔗 ML SERVICE PROXY - Connect to Python ML service
// ============================================================
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8089';

app.post("/api/ai-assistant/ml/predict", express.json(), async (req, res) => {
  try {
    const { equipmentData, type = 'failure' } = req.body;

    const response = await fetch(`${ML_SERVICE_URL}/predict/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(equipmentData)
    });

    if (!response.ok) {
      throw new Error(`ML service error: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (e) {
    console.error('[ML Proxy] Error:', e.message);
    // Fallback to built-in predictions if ML service unavailable
    res.json({
      ok: false,
      fallback: true,
      error: 'ML service unavailable, using built-in predictions'
    });
  }
});

app.post("/api/ai-assistant/ml/analyze-patterns", express.json(), async (req, res) => {
  try {
    const site = req.body.site || req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';

    const response = await fetch(`${ML_SERVICE_URL}/analyze/patterns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site })
    });

    if (!response.ok) {
      throw new Error(`ML service error: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (e) {
    console.error('[ML Proxy] Pattern analysis error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// 👤 AI USER PROFILE ENDPOINT
// ============================================================
app.get("/api/ai-assistant/profile", async (req, res) => {
  try {
    const userEmail = req.query.email;
    if (!userEmail) {
      return res.json({ ok: false, error: 'Email required' });
    }

    const profile = await getUserProfile(userEmail);
    const memories = await getUserMemories(userEmail, 10, ['preference', 'learning']);

    res.json({
      ok: true,
      profile: {
        ...profile,
        recentLearnings: memories.learnings?.slice(0, 5) || [],
        preferences: memories.preferences?.slice(0, 5) || []
      }
    });
  } catch (e) {
    console.error('[AI] Profile error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// >>> AI Assistant - Chat with Photo (supports microservice sessions + GPT-4o Vision)
const aiPhotoUpload = multer({ dest: '/tmp/ai-photos/', limits: { fileSize: 10 * 1024 * 1024 } });
app.post("/api/ai-assistant/chat-with-photo", aiPhotoUpload.single('photo'), async (req, res) => {
  try {
    const { message } = req.body;
    const photo = req.file;
    const conversationHistory = req.body.conversationHistory ? JSON.parse(req.body.conversationHistory) : [];
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';
    const userEmail = req.header('X-User-Email') || 'anonymous';

    if (!photo) {
      return res.status(400).json({ error: "Photo requise" });
    }

    console.log(`[AI] 📷 Photo received: ${photo.originalname}`);

    // Check for active procedure sessions (microservice)
    const lastProcMsg = [...conversationHistory].reverse().find(m => m.procedureSessionId);
    const sessionId = lastProcMsg?.procedureSessionId;

    // Check for active procedure ASSISTANCE session (guidance mode)
    const lastAssistMsg = [...conversationHistory].reverse().find(m => m.procedureAssistSessionId);
    const assistSessionId = lastAssistMsg?.procedureAssistSessionId;

    // Read photo data
    const photoBuffer = fs.readFileSync(photo.path);

    // Priority 1: If we have an active assistance session, forward photo for comparison
    if (assistSessionId) {
      console.log(`[AI] 📷 Forwarding photo to procedure ASSISTANCE session: ${assistSessionId}`);

      try {
        // Create form data for microservice
        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('message', message || 'Voici ma photo');
        formData.append('photo', photoBuffer, {
          filename: photo.originalname,
          contentType: photo.mimetype
        });

        // Call microservice assistance endpoint
        const response = await fetch(`${proceduresTarget}/api/procedures/ai/assist/${assistSessionId}`, {
          method: 'POST',
          headers: {
            'X-User-Email': userEmail,
            'X-Site': site,
            ...formData.getHeaders()
          },
          body: formData
        });

        if (response.ok) {
          const result = await response.json();

          // Cleanup temp file
          fs.unlinkSync(photo.path);

          // Determine if procedure is complete
          const isComplete = result.procedureComplete || result.currentStepNumber > result.totalSteps;

          return res.json({
            message: result.message || result.guidance,
            photoFeedback: result.photoAnalysis,
            actions: isComplete
              ? [
                  { label: "Nouvelle procédure", prompt: "Je veux suivre une autre procédure" },
                  { label: "Retour menu", prompt: "Retourne au menu principal" }
                ]
              : [
                  { label: "📷 Envoyer photo", prompt: "Voici ma photo de l'étape" },
                  { label: "➡️ Étape suivante", prompt: "Passe à l'étape suivante" },
                  { label: "❓ Question", prompt: "J'ai une question sur cette étape" },
                  { label: "⚠️ Problème", prompt: "J'ai un problème" }
                ],
            provider: 'procedure-guidance',
            procedureAssistSessionId: isComplete ? null : assistSessionId,
            procedureComplete: isComplete,
            currentStep: result.currentStepNumber,
            totalSteps: result.totalSteps,
            currentStepPhoto: result.currentStepPhoto,
            safetyWarning: result.safetyWarning
          });
        }
      } catch (e) {
        console.error('[AI] Assistance photo error:', e.message);
        // Fall through to direct GPT-4o Vision
      }
    }

    // Priority 2: If we have an active creation session, forward the photo there
    if (sessionId) {
      console.log(`[AI] 📷 Forwarding photo to procedure session: ${sessionId}`);

      try {
        // Create form data for microservice
        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('message', message || 'Photo ajoutée');
        formData.append('photo', photoBuffer, {
          filename: photo.originalname,
          contentType: photo.mimetype
        });

        // Call microservice
        const response = await fetch(`${proceduresTarget}/api/procedures/ai/chat/${sessionId}`, {
          method: 'POST',
          headers: {
            'X-User-Email': userEmail,
            'X-Site': site,
            ...formData.getHeaders()
          },
          body: formData
        });

        if (response.ok) {
          const result = await response.json();

          // Cleanup temp file
          fs.unlinkSync(photo.path);

          return res.json({
            message: result.message,
            actions: result.options?.map(o => ({ label: o, prompt: o })) || [
              { label: "📷 Étape suivante", prompt: "Étape suivante" },
              { label: "✅ Terminer", prompt: "C'est fini" }
            ],
            provider: 'procedures-ai',
            procedureSessionId: sessionId,
            procedureStep: result.currentStep,
            expectsPhoto: result.expectsPhoto,
            procedureReady: result.procedureReady
          });
        }
      } catch (e) {
        console.error('[AI] Microservice photo error:', e.message);
        // Fall through to direct GPT-4o Vision
      }
    }

    // Fallback: Direct GPT-4o Vision analysis (no active session)
    const base64Photo = photoBuffer.toString('base64');
    const mimeType = photo.mimetype || 'image/jpeg';

    let aiDescription = '';
    try {
      const visionMessages = [
        {
          role: "system",
          content: `Tu analyses des photos pour la maintenance industrielle.
Décris BRIÈVEMENT ce que tu vois (1-2 lignes max).
Identifie: équipement, état, contexte.`
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Photo}`, detail: "low" } },
            { type: "text", text: message || "Décris cette image" }
          ]
        }
      ];
      const result = await chatWithFallback(visionMessages, { model: "gpt-4o", max_tokens: 150 });
      aiDescription = result.content || '';
    } catch (e) {
      console.error('[AI] Vision error:', e.message);
      aiDescription = "Photo reçue";
    }

    // Cleanup temp file
    fs.unlinkSync(photo.path);

    res.json({
      message: aiDescription || "Photo analysée. Que veux-tu faire ?",
      actions: [
        { label: "Créer une procédure", prompt: "Je veux créer une procédure avec cette photo" }
      ],
      provider: "gpt-4o-vision"
    });

  } catch (error) {
    console.error('[AI] ❌ Photo error:', error.message);
    res.json({
      message: "Photo reçue ! Que veux-tu faire avec ?",
      actions: [{ label: "Créer procédure", prompt: "Je veux créer une procédure" }],
      provider: "Electro"
    });
  }
});

// >>> AI Assistant - File upload for document import and report analysis
const aiFileUpload = multer({ dest: '/tmp/ai-files/', limits: { fileSize: 50 * 1024 * 1024 } });
app.post("/api/ai-assistant/upload-file", aiFileUpload.single('file'), async (req, res) => {
  try {
    const { mode } = req.body;  // 'import-document' or 'analyze-report'
    const file = req.file;
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';
    const userEmail = req.header('X-User-Email') || 'anonymous';

    if (!file) {
      return res.status(400).json({ error: "Fichier requis" });
    }

    console.log(`[AI] 📄 File received: ${file.originalname} (mode: ${mode})`);

    // Read file
    const fileBuffer = fs.readFileSync(file.path);

    try {
      // Create form data for microservice
      const FormData = (await import('form-data')).default;
      const formData = new FormData();

      // Choose endpoint based on mode
      const endpoint = mode === 'analyze-report'
        ? '/api/procedures/ai/analyze-report'
        : '/api/procedures/ai/analyze-document';

      const fieldName = mode === 'analyze-report' ? 'report' : 'document';
      formData.append(fieldName, fileBuffer, {
        filename: file.originalname,
        contentType: file.mimetype
      });

      // Call microservice
      const response = await fetch(`${proceduresTarget}${endpoint}`, {
        method: 'POST',
        headers: {
          'X-User-Email': userEmail,
          'X-Site': site,
          ...formData.getHeaders()
        },
        body: formData
      });

      // Cleanup temp file
      fs.unlinkSync(file.path);

      if (response.ok) {
        const result = await response.json();

        if (mode === 'analyze-report') {
          // Report analysis - show action list
          const actions = result.actions || [];
          let message = `📊 **Analyse du rapport terminée !**\n\n`;
          message += `**${result.title || file.originalname}**\n\n`;

          if (actions.length > 0) {
            message += `**${actions.length} actions identifiées :**\n`;
            actions.slice(0, 5).forEach((a, i) => {
              message += `${i + 1}. ${a.title || a.description}\n`;
              if (a.priority) message += `   ⚠️ Priorité: ${a.priority}\n`;
            });
            if (actions.length > 5) {
              message += `\n... et ${actions.length - 5} autres actions\n`;
            }
          }

          message += `\nVeux-tu créer des procédures pour ces actions ?`;

          return res.json({
            message,
            actions: [
              { label: "Créer procédures", prompt: "Crée les procédures pour ces actions" },
              { label: "Voir détails", prompt: "Montre-moi toutes les actions" }
            ],
            provider: 'procedures-ai',
            reportAnalysis: result,
            actionListId: result.actionListId
          });

        } else {
          // Document import - show parsed procedure
          const steps = result.steps || [];
          let message = `📄 **Document analysé !**\n\n`;
          message += `**${result.title || 'Procédure importée'}**\n`;
          if (result.description) message += `${result.description}\n`;
          message += `\n**${steps.length} étapes détectées**\n`;

          if (steps.length > 0) {
            steps.slice(0, 3).forEach((s, i) => {
              message += `${i + 1}. ${s.title || s.instructions?.substring(0, 50) + '...'}\n`;
            });
            if (steps.length > 3) {
              message += `... et ${steps.length - 3} autres étapes\n`;
            }
          }

          if (result.ppe_required?.length > 0) {
            message += `\n🦺 **EPI requis:** ${result.ppe_required.join(', ')}\n`;
          }

          message += `\nVeux-tu sauvegarder cette procédure ?`;

          return res.json({
            message,
            actions: [
              { label: "Sauvegarder", prompt: "Sauvegarde cette procédure" },
              { label: "Modifier", prompt: "Je veux modifier cette procédure avant de sauvegarder" }
            ],
            provider: 'procedures-ai',
            importedProcedure: result
          });
        }
      } else {
        const error = await response.text();
        console.error('[AI] Microservice file error:', error);
        return res.json({
          message: "Erreur lors de l'analyse du fichier. Réessaie.",
          actions: [],
          provider: 'fallback'
        });
      }

    } catch (e) {
      console.error('[AI] File processing error:', e.message);
      // Cleanup on error
      try { fs.unlinkSync(file.path); } catch {}
      return res.json({
        message: "Erreur lors du traitement du fichier.",
        actions: [],
        provider: 'fallback'
      });
    }

  } catch (error) {
    console.error('[AI] ❌ File upload error:', error.message);
    res.json({
      message: "Erreur lors de l'upload. Réessaie.",
      actions: [],
      provider: "Electro"
    });
  }
});

// Auto-generate chart from context data
function autoGenerateChart(ctx, type = 'overview') {
  const buildings = ctx.buildings || {};
  // Sort buildings by equipment count descending
  const sortedBuildings = Object.entries(buildings)
    .sort((a, b) => b[1].equipmentCount - a[1].equipmentCount)
    .slice(0, 10);
  const buildingNames = sortedBuildings.map(([name]) => `Bât. ${name}`);
  const buildingCounts = sortedBuildings.map(([_, data]) => data.equipmentCount);

  switch (type) {
    case 'buildings':
      if (buildingNames.length > 0) {
        return {
          type: 'bar',
          title: 'Équipements par bâtiment',
          labels: buildingNames,
          data: buildingCounts
        };
      }
      break;

    case 'equipment':
      return {
        type: 'doughnut',
        title: 'Types d\'équipements',
        labels: ['Armoires élec.', 'Variateurs VSD', 'Mécaniques', 'ATEX'],
        data: [
          ctx.switchboards?.count || 0,
          ctx.vsd?.count || 0,
          ctx.meca?.count || 0,
          ctx.atex?.totalEquipments || ctx.atex?.equipmentCount || 0
        ]
      };

    case 'controls':
      return {
        type: 'doughnut',
        title: 'État des contrôles planifiés',
        labels: ['En retard', 'Cette semaine', 'Ce mois', '3 prochains mois'],
        data: [
          ctx.controls?.overdue || 0,
          ctx.controls?.thisWeek || 0,
          ctx.controls?.thisMonth || 0,
          ctx.controls?.next90days || 0
        ]
      };

    case 'atex':
      return {
        type: 'doughnut',
        title: 'Conformité ATEX',
        labels: ['Conformes', 'Non-conformes', 'Non contrôlés'],
        data: [
          ctx.atex?.conformeCount || 0,
          ctx.atex?.ncCount || 0,
          Math.max(0, (ctx.atex?.totalEquipments || 0) - (ctx.atex?.conformeCount || 0) - (ctx.atex?.ncCount || 0))
        ]
      };

    case 'overview':
    default:
      // Combined overview chart - buildings if available, otherwise equipment types
      if (buildingNames.length > 0) {
        return {
          type: 'bar',
          title: 'Répartition des équipements par bâtiment',
          labels: buildingNames.slice(0, 8),
          data: buildingCounts.slice(0, 8)
        };
      }
      return {
        type: 'doughnut',
        title: 'Types d\'équipements',
        labels: ['Armoires élec.', 'Variateurs VSD', 'Mécaniques', 'ATEX'],
        data: [
          ctx.switchboards?.count || 0,
          ctx.vsd?.count || 0,
          ctx.meca?.count || 0,
          ctx.atex?.totalEquipments || ctx.atex?.equipmentCount || 0
        ]
      };
  }
  return null;
}

// Generate intelligent fallback response based on DB context
function generateIntelligentFallback(message, ctx) {
  const msg = (message || '').toLowerCase();
  const summary = ctx.summary || {};

  // Build response based on actual data
  if (msg.includes('contrôle') || msg.includes('retard') || msg.includes('overdue') || msg.includes('planning') || msg.includes('semaine') || msg.includes('mois')) {
    const overdueCount = ctx.controls?.overdue || 0;
    const overdueList = ctx.controls?.overdueList || [];
    const thisWeekList = ctx.controls?.thisWeekList || [];
    const thisMonthList = ctx.controls?.thisMonthList || [];

    let response = '';

    // Build equipment list for map display (include equipment data for subsequent map requests)
    const equipmentList = [];

    if (overdueCount > 0) {
      response += `🚨 **${overdueCount} contrôle(s) en retard!**\n\n`;
      if (overdueList.length > 0) {
        response += overdueList.slice(0, 5).map(c => {
          // Indicate if it's mobile equipment
          const typeLabel = c.equipmentType === 'mobile' ? ' 📱' : '';
          return `• **${c.switchboard}**${typeLabel} (${c.switchboardCode})\n  📍 Bât. ${c.building}, ét. ${c.floor} | ⏰ ${c.daysOverdue}j de retard`;
        }).join('\n') + '\n\n';

        // Build equipment list for map context
        overdueList.slice(0, 5).forEach(c => {
          equipmentList.push({
            id: c.equipment?.id || c.equipmentId || c.switchboardId,
            name: c.switchboard,
            code: c.switchboardCode,
            building_code: c.building,
            floor: c.floor,
            room: c.room,
            equipmentType: c.equipmentType || 'switchboard'
          });
        });
      }
    }

    if (thisWeekList.length > 0) {
      response += `📅 **Cette semaine (${thisWeekList.length}):**\n`;
      response += thisWeekList.slice(0, 5).map(c =>
        `• ${c.switchboard} — ${c.dueDateFormatted} (dans ${c.daysUntil}j)`
      ).join('\n') + '\n\n';
    }

    if (thisMonthList.length > 0) {
      response += `📆 **Ce mois (${thisMonthList.length}):**\n`;
      response += thisMonthList.slice(0, 3).map(c =>
        `• ${c.switchboard} — ${c.dueDateFormatted}`
      ).join('\n') + '\n';
    }

    if (!response) {
      response = `✅ **Aucun contrôle planifié** pour les prochaines semaines.\n\n` +
        `📊 ${ctx.controls?.scheduled || 0} contrôles programmés au total.\n` +
        `🏢 ${ctx.switchboards?.count || 0} armoires électriques sur ${summary.totalBuildings || 0} bâtiments.`;
    }

    // Actions with map navigation for overdue equipment
    const actions = [
      { label: "Voir par bâtiment", prompt: "Répartition par bâtiment" },
      { label: "ATEX", prompt: "Situation ATEX" }
    ];

    // Add map action if there are overdue items
    if (equipmentList.length > 0) {
      actions.unshift({ label: "🗺️ Voir sur la carte", prompt: "Montre-moi la carte des équipements en retard" });
    }

    // If there's exactly one overdue item, include it for direct map display
    const singleEquipment = equipmentList.length === 1 ? equipmentList[0] : null;

    return {
      message: response,
      actions,
      chart: autoGenerateChart(ctx, 'controls'),
      provider: "Electro",
      // Include equipment data for subsequent map requests
      equipmentList: equipmentList.length > 0 ? equipmentList : undefined,
      // If single equipment, also include direct location data
      ...(singleEquipment && {
        locationEquipment: singleEquipment,
        locationEquipmentType: singleEquipment.equipmentType
      })
    };
  }

  if (msg.includes('bâtiment') || msg.includes('building') || msg.includes('étage') || msg.includes('floor') || msg.includes('carte') || msg.includes('map') || msg.includes('répartition')) {
    const buildings = ctx.buildings || {};
    const buildingList = Object.entries(buildings)
      .sort((a, b) => b[1].equipmentCount - a[1].equipmentCount)
      .slice(0, 10)
      .map(([name, data]) => `• **Bât. ${name}**: ${data.equipmentCount} équip. (étages: ${data.floors?.join(', ') || 'RDC'})`)
      .join('\n');

    return {
      message: `📍 **Répartition par bâtiment** — Site ${ctx.site || 'actuel'}\n\n` +
        (buildingList || '• Aucune donnée de bâtiment') +
        `\n\n**Total:** ${ctx.switchboards?.count || 0} armoires sur **${Object.keys(buildings).length} bâtiments**`,
      actions: Object.keys(buildings).slice(0, 3).map(b => ({
        label: `Bât. ${b}`,
        prompt: `Détails du bâtiment ${b}`
      })),
      chart: autoGenerateChart(ctx, 'buildings'),
      provider: "Electro"
    };
  }

  if (msg.includes('atex') || msg.includes('nc') || msg.includes('non-conformité') || msg.includes('conformité')) {
    const ncList = ctx.atex?.ncList || [];
    let ncDetails = '';

    if (ncList.length > 0) {
      ncDetails = ncList.slice(0, 5).map(nc =>
        `• **${nc.name}** (${nc.type})\n` +
        `  📍 Bât. ${nc.building}, Zone ${nc.zone}\n` +
        `  ⚠️ ${nc.ncDetails?.slice(0, 2).join(', ') || 'Vérification requise'}`
      ).join('\n\n');
    }

    return {
      message: `🔥 **Situation ATEX** — Site ${ctx.site || 'actuel'}\n\n` +
        `• **${ctx.atex?.totalEquipments || 0}** équipements ATEX\n` +
        `• **${ctx.atex?.conformeCount || 0}** conformes\n` +
        `• **${ctx.atex?.ncCount || 0}** non-conformes\n` +
        `• **Taux de conformité:** ${summary.atexConformityRate || 100}%\n\n` +
        (ncDetails ? `**Non-conformités:**\n\n${ncDetails}` : '✅ Toutes les conformités OK!'),
      actions: [
        { label: "Planning contrôles", prompt: "Contrôles à venir" },
        { label: "Par bâtiment", prompt: "Répartition par bâtiment" }
      ],
      chart: autoGenerateChart(ctx, 'atex'),
      provider: "Electro"
    };
  }

  if (msg.includes('résumé') || msg.includes('summary') || msg.includes('situation') || msg.includes('global') || msg.includes('analyse') || msg.includes('statistique')) {
    return {
      message: `📊 **Vue globale** — Site ${ctx.site || 'actuel'}\n\n` +
        `**Équipements (${summary.totalEquipments || 0} total):**\n` +
        `• ${ctx.switchboards?.count || 0} armoires électriques\n` +
        `• ${ctx.vsd?.count || 0} variateurs VSD\n` +
        `• ${ctx.meca?.count || 0} équipements mécaniques\n` +
        `• ${ctx.atex?.totalEquipments || 0} ATEX (${summary.atexConformityRate || 100}% conformes)\n\n` +
        `**Contrôles planifiés:**\n` +
        (ctx.controls?.overdue > 0 ? `• 🚨 ${ctx.controls.overdue} en RETARD\n` : '• ✅ Aucun retard\n') +
        `• ${ctx.controls?.thisWeek || 0} cette semaine\n` +
        `• ${ctx.controls?.thisMonth || 0} ce mois\n` +
        `• ${ctx.controls?.scheduled || 0} au total\n\n` +
        `**${summary.totalBuildings || 0} bâtiments** équipés`,
      actions: [
        { label: "Contrôles", prompt: "Planning des contrôles" },
        { label: "Par bâtiment", prompt: "Répartition par bâtiment" },
        { label: "ATEX", prompt: "Situation ATEX" }
      ],
      chart: autoGenerateChart(ctx, 'overview'),
      provider: "Electro"
    };
  }

  // Handle procedure requests - FIXED: Show actual content, not just list
  if (msg.includes('procédure') || msg.includes('procedure') || msg.includes('prise') || msg.includes('contrôle') && msg.includes('comment')) {
    const procedures = ctx.procedures?.list || [];
    const procedureCount = ctx.procedures?.count || 0;

    // Check if user wants to see a specific procedure
    const wantsDetails = msg.includes('montre') || msg.includes('voir') || msg.includes('affiche') ||
                         msg.includes('détail') || msg.includes('étape') || msg.includes('oui');

    if (procedureCount > 0) {
      // Try to find a matching procedure
      let matchedProcedure = null;

      // Look for procedure name in message
      for (const proc of procedures) {
        const titleLower = proc.title.toLowerCase();
        const titleWords = titleLower.split(' ').filter(w => w.length > 3);

        // Check if any significant word from title is in message
        const matchScore = titleWords.filter(word => msg.includes(word)).length;
        if (matchScore >= 1 || (wantsDetails && procedures.length === 1)) {
          matchedProcedure = proc;
          break;
        }
      }

      // If found a match or user wants details and only 1 procedure, show full content
      if (matchedProcedure || (wantsDetails && procedures.length === 1)) {
        const proc = matchedProcedure || procedures[0];
        const steps = proc.steps || [];

        let stepsText = '';
        if (steps.length > 0) {
          stepsText = steps.map((s, i) =>
            `**Étape ${i + 1}: ${s.title}**\n${s.description || ''}\n${s.warning ? `⚠️ ${s.warning}` : ''}`
          ).join('\n\n');
        } else {
          stepsText = '*(Étapes non chargées - voir le PDF)*';
        }

        return {
          message: `📋 **${proc.title}**\n\n` +
            `**Catégorie:** ${proc.category || 'N/A'}\n` +
            `**Risque:** ${proc.riskLevel || 'medium'}\n` +
            `**EPI requis:** ${Array.isArray(proc.ppeRequired) && proc.ppeRequired.length > 0 ? proc.ppeRequired.join(', ') : 'Non défini'}\n\n` +
            `### ${proc.stepCount || steps.length} ÉTAPES:\n\n${stepsText}\n\n` +
            `📥 [Télécharger le PDF](/api/procedures/${proc.id}/pdf)`,
          actions: [
            { label: "🚀 Me guider", prompt: `Guide-moi étape par étape pour "${proc.title}"` },
            { label: "📋 Autres procédures", prompt: "Quelles autres procédures sont disponibles?" }
          ],
          procedureDetails: proc,
          provider: "Electro"
        };
      }

      // Otherwise list procedures
      const proceduresList = procedures.slice(0, 5).map((p, i) =>
        `${i + 1}. **${p.title}** (${p.stepCount || '?'} étapes) - ${p.category || 'N/A'}`
      ).join('\n');

      return {
        message: `📋 **Procédures disponibles:**\n\n${proceduresList}\n\nDis-moi laquelle tu veux voir en détail!`,
        actions: procedures.slice(0, 3).map(p => ({
          label: p.title.substring(0, 25),
          prompt: `Montre-moi les étapes de la procédure "${p.title}"`
        })),
        provider: "system"
      };
    } else {
      return {
        message: `📋 **Aucune procédure trouvée**\n\nJe n'ai pas trouvé de procédure correspondant à ta demande.\n\nTu veux qu'on en crée une ensemble ?`,
        actions: [
          { label: "➕ Créer une procédure", prompt: "Je veux créer une nouvelle procédure" }
        ],
        provider: "system"
      };
    }
  }

  // Default: show summary with chart
  return {
    message: `👋 **Electro** — Assistant ElectroHub\n\n` +
      `📊 **Site ${ctx.site || 'actuel'}:**\n` +
      `• ${summary.totalEquipments || 0} équipements sur ${summary.totalBuildings || 0} bâtiments\n` +
      (ctx.controls?.overdue > 0 ? `• 🚨 ${ctx.controls.overdue} contrôles en retard\n` : '') +
      `• ${ctx.controls?.thisWeek || 0} contrôles cette semaine\n` +
      (ctx.atex?.ncCount > 0 ? `• ⚠️ ${ctx.atex.ncCount} NC ATEX actives\n` : '') +
      (ctx.procedures?.count > 0 ? `• 📋 ${ctx.procedures.count} procédures disponibles\n` : '') +
      `\nComment puis-je vous aider ?`,
    actions: [
      { label: "Analyse complète", prompt: "Analyse globale de la situation" },
      { label: "Planning", prompt: "Contrôles à venir" },
      { label: "Procédures", prompt: "Liste des procédures" },
      { label: "ATEX", prompt: "Situation ATEX" }
    ],
    chart: autoGenerateChart(ctx, 'equipment'),
    provider: "Electro"
  };
}

// Extract action suggestions from AI response
function extractActionsFromResponse(response, originalMessage) {
  const actions = [];

  // If talking about controls, suggest control actions
  if (response.toLowerCase().includes('contrôle') || originalMessage.toLowerCase().includes('contrôle')) {
    actions.push({ label: "Planifier un contrôle", prompt: "Comment planifier un nouveau contrôle ?" });
  }

  // If talking about buildings, suggest building exploration
  if (response.toLowerCase().includes('bâtiment') || originalMessage.toLowerCase().includes('bâtiment')) {
    actions.push({ label: "Voir la carte", prompt: "Montre-moi la vue carte des équipements" });
  }

  // If talking about NC, suggest NC actions
  if (response.toLowerCase().includes('non-conformité') || response.toLowerCase().includes(' nc ')) {
    actions.push({ label: "Traiter les NC", prompt: "Comment traiter une non-conformité ?" });
  }

  // Always suggest a follow-up
  if (actions.length === 0) {
    actions.push(
      { label: "Résumé situation", prompt: "Donne-moi un résumé de la situation" },
      { label: "Autre question", prompt: "J'ai une autre question" }
    );
  }

  return actions.slice(0, 3);
}

// Execute AI action endpoint
app.post("/api/ai-assistant/execute-action", express.json(), async (req, res) => {
  try {
    const { action, params } = req.body;
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';

    if (!action) {
      return res.status(400).json({ success: false, message: 'Action requise' });
    }

    console.log(`[AI] ⚡ Executing action: ${action}`);
    const result = await executeAIAction(action, params || {}, site);

    res.json(result);
  } catch (error) {
    console.error('[AI] Execute action error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// MINI ELECTRO - EQUIPMENT ANALYSIS ENDPOINT
// ============================================================
app.post("/api/ai-assistant/analyze-equipment", express.json(), async (req, res) => {
  try {
    const { equipment, equipmentType } = req.body;
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';

    if (!equipment) {
      return res.status(400).json({ success: false, message: 'Equipment data required' });
    }

    console.log(`[AI] 🔍 Analyzing equipment: ${equipment.name} (${equipmentType})`);

    const issues = [];
    const suggestions = [];
    const stats = {};

    // 1. Check documentation status
    if (!equipment.documentationUrl && equipment.model) {
      issues.push('Documentation technique manquante pour ce modèle');
      suggestions.push({
        icon: 'search',
        title: 'Rechercher documentation',
        description: `Trouver la fiche technique ${equipment.manufacturer || ''} ${equipment.model || ''}`.trim(),
        action: 'searchDoc',
        color: 'bg-blue-100'
      });
    }

    // 2. Check control dates
    if (equipment.lastControl) {
      const lastDate = new Date(equipment.lastControl);
      const daysSince = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));

      if (daysSince > 365) {
        issues.push(`Contrôle en retard de ${daysSince - 365} jours`);
        suggestions.push({
          icon: 'calendar',
          title: 'Planifier contrôle urgent',
          description: 'Cet équipement nécessite un contrôle immédiat',
          action: 'scheduleControl',
          params: { equipmentId: equipment.id, priority: 'high' },
          color: 'bg-red-100'
        });
      } else if (daysSince > 300) {
        suggestions.push({
          icon: 'calendar',
          title: 'Contrôle à prévoir',
          description: `Prochain contrôle dans ${365 - daysSince} jours`,
          action: 'scheduleControl',
          params: { equipmentId: equipment.id },
          color: 'bg-orange-100'
        });
      }

      stats['Dernier ctrl'] = `${daysSince}j`;
    } else {
      issues.push('Aucun contrôle enregistré');
      suggestions.push({
        icon: 'calendar',
        title: 'Premier contrôle',
        description: 'Planifier le premier contrôle de cet équipement',
        action: 'scheduleControl',
        params: { equipmentId: equipment.id },
        color: 'bg-yellow-100'
      });
    }

    // 3. Check status
    if (equipment.status === 'non_conforme') {
      issues.push('Équipement marqué non conforme');
      suggestions.push({
        icon: 'wrench',
        title: 'Traiter la non-conformité',
        description: 'Consulter les actions correctives recommandées',
        action: 'treatNC',
        params: { equipmentId: equipment.id, type: equipmentType },
        color: 'bg-red-100'
      });
    }

    // 4. Type-specific analysis
    if (equipmentType === 'vsd') {
      // Check for similar VSD equipment
      try {
        const similarRes = await pool.query(`
          SELECT COUNT(*) as count FROM vsd_equipments
          WHERE manufacturer = $1 OR model = $2
        `, [equipment.manufacturer, equipment.model]);
        const similarCount = parseInt(similarRes.rows[0]?.count || 0);
        if (similarCount > 1) {
          stats['Similaires'] = similarCount;
          suggestions.push({
            icon: 'chart',
            title: `${similarCount} équipements similaires`,
            description: 'Voir tous les équipements du même type',
            action: 'showSimilar',
            params: { manufacturer: equipment.manufacturer, model: equipment.model },
            color: 'bg-green-100'
          });
        }
      } catch (e) { /* ignore */ }
    } else if (equipmentType === 'atex') {
      stats['Zone'] = equipment.zone || 'N/A';
      // Check ATEX NC count
      try {
        const ncRes = await pool.query(`
          SELECT COUNT(*) as count FROM atex_checks
          WHERE equipment_id = $1 AND result = 'non_conforme'
        `, [equipment.id]);
        const ncCount = parseInt(ncRes.rows[0]?.count || 0);
        if (ncCount > 0) {
          stats['NC'] = ncCount;
        }
      } catch (e) { /* ignore */ }
    }

    // 5. Search for matching equipment (for doc association)
    let matchingEquipments = [];
    if (equipment.model || equipment.manufacturer) {
      try {
        const searchTerm = `%${(equipment.model || equipment.manufacturer || '').toLowerCase()}%`;

        // Search across all equipment tables
        const tables = [
          { name: 'vsd_equipments', type: 'vsd', modelCol: 'model' },
          { name: 'meca_equipments', type: 'meca', modelCol: 'model' },
          { name: 'atex_equipments', type: 'atex', modelCol: 'manufacturer_ref' }
        ];

        for (const table of tables) {
          try {
            const res = await pool.query(`
              SELECT id, name, building, '${table.type}' as equipment_type
              FROM ${table.name}
              WHERE LOWER(${table.modelCol}) LIKE $1 OR LOWER(manufacturer) LIKE $1
              LIMIT 10
            `, [searchTerm]);
            matchingEquipments.push(...res.rows);
          } catch (e) { /* ignore table if not exists */ }
        }

        if (matchingEquipments.length > 1) {
          stats['Match'] = matchingEquipments.length;
        }
      } catch (e) { /* ignore */ }
    }

    // Default suggestion if no issues
    if (suggestions.length === 0) {
      suggestions.push({
        icon: 'doc',
        title: 'Équipement à jour',
        description: 'Aucune action urgente requise',
        action: 'viewDetails',
        color: 'bg-green-100'
      });
    }

    res.json({
      success: true,
      equipment: {
        id: equipment.id,
        name: equipment.name,
        type: equipmentType
      },
      issues,
      suggestions,
      stats,
      matchingEquipments: matchingEquipments.slice(0, 5),
      analyzedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('[AI] Analyze equipment error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      issues: ['Erreur lors de l\'analyse'],
      suggestions: [{
        icon: 'search',
        title: 'Rechercher documentation',
        description: 'Action de secours',
        action: 'searchDoc',
        color: 'bg-blue-100'
      }],
      stats: {}
    });
  }
});

// ============================================================
// COMPREHENSIVE STATISTICS ENDPOINT
// ============================================================
app.get("/api/ai-assistant/statistics", async (req, res) => {
  try {
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';
    const context = await getAIContext(site);

    // Build comprehensive statistics
    const stats = {
      site,
      generatedAt: new Date().toISOString(),

      // Equipment counts
      equipment: {
        switchboards: context.switchboards.count,
        vsd: context.vsd.count,
        meca: context.meca.count,
        atex: context.atex.equipmentCount,
        total: context.statistics.totalEquipments
      },

      // Controls status
      controls: {
        total: context.controls.total,
        overdue: context.controls.overdue,
        upcoming: context.controls.upcoming,
        overdueRate: context.statistics.overdueRate,
        criticalOverdue: context.controls.overdueList.filter(c => c.urgency === 'critical').length,
        urgentOverdue: context.controls.overdueList.filter(c => c.urgency === 'high').length
      },

      // ATEX compliance
      atex: {
        totalEquipments: context.atex.equipmentCount,
        nonConformities: context.atex.ncCount,
        complianceRate: context.atex.equipmentCount > 0
          ? Math.round(((context.atex.equipmentCount - context.atex.ncCount) / context.atex.equipmentCount) * 100)
          : 100
      },

      // Buildings
      buildings: {
        count: context.statistics.totalBuildings,
        details: Object.entries(context.buildings).map(([name, data]) => ({
          name,
          equipmentCount: data.equipmentCount,
          floors: data.floors
        }))
      },

      // Urgent items
      urgent: {
        total: context.urgentItems.length,
        controlsOverdue: context.urgentItems.filter(i => i.type === 'control_overdue').length,
        atexNC: context.urgentItems.filter(i => i.type === 'atex_nc').length,
        items: context.urgentItems.slice(0, 10)
      },

      // Daily workload
      dailyPlan: {
        tasksCount: context.dailyPlan.length,
        estimatedHours: Math.round(context.dailyPlan.reduce((acc, t) => acc + (t.estimatedDuration || 30), 0) / 60 * 10) / 10,
        tasks: context.dailyPlan.slice(0, 10)
      }
    };

    res.json(stats);
  } catch (error) {
    console.error('[AI] Statistics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// WEEKLY PLAN ENDPOINT
// ============================================================
app.get("/api/ai-assistant/weekly-plan", async (req, res) => {
  try {
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';

    // Get all controls for the next 7 days + overdue
    const result = await pool.query(`
      SELECT cs.id, cs.switchboard_id, cs.next_due_date, cs.frequency,
             ct.name as template_name,
             s.name as switchboard_name, s.code as switchboard_code, s.building_code, s.floor, s.room
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      LEFT JOIN switchboards s ON cs.switchboard_id = s.id
      WHERE cs.site = $1
        AND cs.next_due_date <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY cs.next_due_date
    `, [site]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Group by day
    const weekPlan = {
      overdue: [],
      days: {}
    };

    // Initialize days
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      weekPlan.days[dateKey] = {
        date: dateKey,
        dayName: date.toLocaleDateString('fr-FR', { weekday: 'long' }),
        tasks: [],
        estimatedHours: 0
      };
    }

    result.rows.forEach(ctrl => {
      const dueDate = new Date(ctrl.next_due_date);
      dueDate.setHours(0, 0, 0, 0);

      const task = {
        id: ctrl.id,
        switchboard: ctrl.switchboard_name,
        code: ctrl.switchboard_code,
        template: ctrl.template_name,
        building: ctrl.building_code,
        floor: ctrl.floor,
        room: ctrl.room,
        dueDate: ctrl.next_due_date,
        estimatedDuration: 30
      };

      if (dueDate < today) {
        // Overdue
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        task.daysOverdue = daysOverdue;
        task.urgency = daysOverdue > 30 ? 'critical' : daysOverdue > 7 ? 'high' : 'medium';
        weekPlan.overdue.push(task);
      } else {
        // This week
        const dateKey = dueDate.toISOString().split('T')[0];
        if (weekPlan.days[dateKey]) {
          weekPlan.days[dateKey].tasks.push(task);
          weekPlan.days[dateKey].estimatedHours += 0.5; // 30 min per task
        }
      }
    });

    // Sort overdue by urgency
    weekPlan.overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Calculate totals
    const totalTasks = weekPlan.overdue.length + Object.values(weekPlan.days).reduce((acc, d) => acc + d.tasks.length, 0);
    const totalHours = weekPlan.overdue.length * 0.5 + Object.values(weekPlan.days).reduce((acc, d) => acc + d.estimatedHours, 0);

    res.json({
      site,
      generatedAt: new Date().toISOString(),
      summary: {
        totalTasks,
        overdueCount: weekPlan.overdue.length,
        criticalCount: weekPlan.overdue.filter(t => t.urgency === 'critical').length,
        estimatedTotalHours: Math.round(totalHours * 10) / 10
      },
      overdue: weekPlan.overdue,
      days: Object.values(weekPlan.days)
    });
  } catch (error) {
    console.error('[AI] Weekly plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check for AI assistant
app.get("/api/ai-assistant/health", (req, res) => {
  const providers = [];
  if (openai) providers.push('openai');
  if (gemini) providers.push('gemini');

  res.json({
    status: providers.length > 0 ? "active" : "fallback",
    providers,
    primaryProvider: openai ? "openai" : (gemini ? "gemini" : "local"),
    capabilities: {
      chat: true,
      documentSearch: true,
      chartGeneration: true,
      autonomousActions: true,
      databaseAccess: true,
      tts: !!openai
    },
    message: providers.length > 0
      ? `🚀 AI surpuissant actif (${providers.join(' + ')})`
      : "Mode fallback intelligent avec données DB"
  });
});

// ============================================================
// TTS - Text-to-Speech with OpenAI (natural voice)
// ============================================================
app.post("/api/ai-assistant/tts", express.json(), async (req, res) => {
  const { text, voice = "nova" } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  // If no OpenAI, return error so client can fallback to browser TTS
  if (!openai) {
    return res.status(503).json({
      error: "TTS not available",
      fallback: true,
      message: "OpenAI TTS non disponible, utilisation de la voix navigateur"
    });
  }

  try {
    // Clean text for TTS (remove markdown, emojis excess)
    const cleanText = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/•/g, '')
      .replace(/#+\s/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .substring(0, 4000); // OpenAI limit

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice, // nova, alloy, echo, fable, onyx, shimmer
      input: cleanText,
      speed: 1.0
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache'
    });

    res.send(buffer);
  } catch (error) {
    console.error('[TTS] Error:', error);
    res.status(500).json({
      error: "TTS generation failed",
      fallback: true,
      message: error.message
    });
  }
});

// ============================================================
// MORNING BRIEF - Daily intelligent summary with stats
// ============================================================
app.get("/api/ai-assistant/morning-brief", async (req, res) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Get comprehensive stats
    const stats = await Promise.all([
      // Overdue controls
      pool.query(`
        SELECT COUNT(*) as count
        FROM control_schedules
        WHERE next_due_date < CURRENT_DATE AND (status IS NULL OR status != 'completed')
      `),
      // Controls this week
      pool.query(`
        SELECT COUNT(*) as count
        FROM control_schedules
        WHERE next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND (status IS NULL OR status != 'completed')
      `),
      // Equipment counts by type
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM switchboards) as switchboards,
          (SELECT COUNT(*) FROM vsd_equipments) as vsd,
          (SELECT COUNT(*) FROM meca_equipments) as meca,
          (SELECT COUNT(*) FROM atex_equipments) as atex,
          (SELECT COUNT(*) FROM hv_equipments) as hv,
          (SELECT COUNT(*) FROM glo_equipments) as glo
      `),
      // Recent controls completed (last 7 days)
      pool.query(`
        SELECT COUNT(*) as count
        FROM control_schedules
        WHERE status = 'completed'
        AND updated_at > CURRENT_DATE - INTERVAL '7 days'
      `),
      // ATEX non-conformities pending (checks with non_conforme result)
      pool.query(`
        SELECT COUNT(*) as count
        FROM atex_checks
        WHERE result = 'non_conforme'
        AND (status IS NULL OR status != 'resolved')
      `),
      // Equipment never controlled (switchboards only - they have control_schedules)
      pool.query(`
        SELECT COUNT(*) as count FROM (
          SELECT s.id FROM switchboards s
          LEFT JOIN control_schedules cs ON cs.switchboard_id = s.id
          WHERE cs.id IS NULL
        ) as never_controlled
      `),
      // Buildings with equipment
      pool.query(`
        SELECT COUNT(DISTINCT building_code) as count
        FROM switchboards
        WHERE building_code IS NOT NULL
      `),
      // Procedure statistics (resilient to missing tables)
      (async () => {
        try {
          // Check if procedure_executions table exists
          const tableCheck = await pool.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_name = 'procedure_executions'
            ) as exists
          `);

          if (tableCheck.rows[0]?.exists) {
            return await pool.query(`
              SELECT
                (SELECT COUNT(*) FROM procedures) as total,
                (SELECT COUNT(*) FROM procedures WHERE status = 'draft' OR status = 'incomplete') as drafts,
                (SELECT COUNT(DISTINCT procedure_id) FROM procedure_executions WHERE started_at > CURRENT_DATE - INTERVAL '7 days') as recently_used
            `);
          } else {
            // Table doesn't exist, just count procedures
            return await pool.query(`
              SELECT
                (SELECT COUNT(*) FROM procedures) as total,
                (SELECT COUNT(*) FROM procedures WHERE status = 'draft' OR status = 'incomplete') as drafts,
                0 as recently_used
            `);
          }
        } catch (e) {
          console.log('[MorningBrief] Procedure stats fallback:', e.message);
          return { rows: [{ total: 0, drafts: 0, recently_used: 0 }] };
        }
      })(),
      // Most used procedure (resilient to missing tables)
      (async () => {
        try {
          const tableCheck = await pool.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_name = 'procedure_executions'
            ) as exists
          `);

          if (tableCheck.rows[0]?.exists) {
            return await pool.query(`
              SELECT p.id, p.title, COUNT(pe.id) as usage_count
              FROM procedures p
              LEFT JOIN procedure_executions pe ON pe.procedure_id = p.id AND pe.started_at > CURRENT_DATE - INTERVAL '30 days'
              GROUP BY p.id, p.title
              ORDER BY usage_count DESC
              LIMIT 1
            `);
          } else {
            // Just get any procedure as fallback
            return await pool.query(`
              SELECT id, title, 0 as usage_count
              FROM procedures
              ORDER BY updated_at DESC
              LIMIT 1
            `);
          }
        } catch (e) {
          console.log('[MorningBrief] Most used proc fallback:', e.message);
          return { rows: [] };
        }
      })()
    ]);

    const [overdueRes, weekRes, equipmentRes, completedRes, atexNcRes, neverControlledRes, buildingsRes, procedureStatsRes, mostUsedProcRes] = stats;
    const equipment = equipmentRes.rows[0];
    const totalEquipment =
      parseInt(equipment.switchboards || 0) +
      parseInt(equipment.vsd || 0) +
      parseInt(equipment.meca || 0) +
      parseInt(equipment.atex || 0) +
      parseInt(equipment.hv || 0) +
      parseInt(equipment.glo || 0);

    // Calculate health score (0-100)
    const overdueCount = parseInt(overdueRes.rows[0]?.count || 0);
    const neverControlled = parseInt(neverControlledRes.rows[0]?.count || 0);
    const atexNc = parseInt(atexNcRes.rows[0]?.count || 0);
    const completedWeek = parseInt(completedRes.rows[0]?.count || 0);

    let healthScore = 100;
    healthScore -= Math.min(overdueCount * 5, 30); // -5 per overdue, max -30
    healthScore -= Math.min(atexNc * 3, 20); // -3 per NC, max -20
    healthScore -= Math.min(neverControlled * 0.5, 20); // -0.5 per never controlled, max -20
    healthScore += Math.min(completedWeek * 2, 15); // +2 per completion, max +15
    healthScore = Math.max(0, Math.min(100, healthScore));

    // Determine status and emoji
    let statusEmoji, statusText, statusColor;
    if (healthScore >= 80) {
      statusEmoji = "🟢";
      statusText = "Excellent";
      statusColor = "green";
    } else if (healthScore >= 60) {
      statusEmoji = "🟡";
      statusText = "Attention requise";
      statusColor = "yellow";
    } else if (healthScore >= 40) {
      statusEmoji = "🟠";
      statusText = "Action nécessaire";
      statusColor = "orange";
    } else {
      statusEmoji = "🔴";
      statusText = "Critique";
      statusColor = "red";
    }

    // Priority actions
    const priorityActions = [];
    if (overdueCount > 0) {
      priorityActions.push({
        type: "overdue",
        icon: "⚠️",
        title: `${overdueCount} contrôle(s) en retard`,
        description: "Tableaux électriques à contrôler",
        urgency: "high",
        action: "/app/switchboard-controls?tab=overdue"
      });
    }
    if (atexNc > 0) {
      priorityActions.push({
        type: "atex_nc",
        icon: "🧯",
        title: `${atexNc} NC ATEX en attente`,
        description: "Non-conformités à traiter",
        urgency: atexNc > 5 ? "high" : "medium",
        action: "/app/atex"
      });
    }
    if (neverControlled > 10) {
      priorityActions.push({
        type: "never_controlled",
        icon: "📋",
        title: `${neverControlled} équipements jamais contrôlés`,
        description: "Planifier des contrôles initiaux",
        urgency: "medium",
        action: "/app/switchboard-controls"
      });
    }

    // Generate AI insights if available
    let aiInsight = null;
    if (openai || gemini) {
      try {
        const insightPrompt = `En tant qu'expert maintenance industrielle, donne UN conseil actionnable et motivant pour aujourd'hui basé sur ces stats:
- Équipements: ${totalEquipment} total (${equipment.switchboards} tableaux, ${equipment.vsd} variateurs, ${equipment.meca} méca)
- Contrôles en retard: ${overdueCount}
- NC ATEX: ${atexNc}
- Complétés cette semaine: ${completedWeek}
- Score santé: ${healthScore}%

Réponds en 1-2 phrases max, style direct et encourageant. Commence par une action concrète.`;

        const result = await chatWithFallback(
          [{ role: "user", content: insightPrompt }],
          { max_tokens: 100, temperature: 0.7 }
        );
        aiInsight = result.content;
      } catch (e) {
        console.error('[MorningBrief] AI insight error:', e);
      }
    }

    res.json({
      success: true,
      date: todayStr,
      greeting: getGreeting(),
      healthScore: Math.round(healthScore),
      status: {
        emoji: statusEmoji,
        text: statusText,
        color: statusColor
      },
      stats: {
        totalEquipment,
        byType: {
          switchboards: parseInt(equipment.switchboards || 0),
          vsd: parseInt(equipment.vsd || 0),
          meca: parseInt(equipment.meca || 0),
          atex: parseInt(equipment.atex || 0),
          hv: parseInt(equipment.hv || 0),
          glo: parseInt(equipment.glo || 0)
        },
        controls: {
          overdue: overdueCount,
          thisWeek: parseInt(weekRes.rows[0]?.count || 0),
          completedThisWeek: completedWeek,
          neverControlled
        },
        atexNc,
        buildings: parseInt(buildingsRes.rows[0]?.count || 0),
        procedures: {
          total: parseInt(procedureStatsRes.rows[0]?.total || 0),
          drafts: parseInt(procedureStatsRes.rows[0]?.drafts || 0),
          recentlyUsed: parseInt(procedureStatsRes.rows[0]?.recently_used || 0),
          mostUsed: mostUsedProcRes.rows[0]?.title ? {
            id: mostUsedProcRes.rows[0].id,
            title: mostUsedProcRes.rows[0].title,
            usageCount: parseInt(mostUsedProcRes.rows[0].usage_count || 0)
          } : null
        }
      },
      priorityActions,
      aiInsight,
      charts: {
        equipmentDistribution: [
          { name: 'Tableaux', value: parseInt(equipment.switchboards || 0), color: '#f59e0b' },
          { name: 'VSD', value: parseInt(equipment.vsd || 0), color: '#6366f1' },
          { name: 'Méca', value: parseInt(equipment.meca || 0), color: '#22c55e' },
          { name: 'ATEX', value: parseInt(equipment.atex || 0), color: '#ef4444' },
          { name: 'HT', value: parseInt(equipment.hv || 0), color: '#eab308' },
          { name: 'GLO', value: parseInt(equipment.glo || 0), color: '#14b8a6' }
        ],
        controlsStatus: [
          { name: 'En retard', value: overdueCount, color: '#ef4444' },
          { name: 'Cette semaine', value: parseInt(weekRes.rows[0]?.count || 0), color: '#3b82f6' },
          { name: 'Complétés (7j)', value: completedWeek, color: '#22c55e' }
        ]
      }
    });
  } catch (error) {
    console.error('[MorningBrief] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper for greeting
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

// ============================================================
// PROCEDURE STORIES - Like Instagram stories for yesterday's procedures
// ============================================================
app.get("/api/ai-assistant/procedure-stories", async (req, res) => {
  try {
    // Get procedure executions from the last 48 hours
    const { rows: recentExecutions } = await pool.query(`
      SELECT
        pe.*,
        p.title as procedure_title,
        p.category,
        p.risk_level,
        p.ppe_required
      FROM procedure_executions pe
      JOIN procedures p ON p.id = pe.procedure_id
      WHERE pe.started_at > NOW() - INTERVAL '48 hours'
      ORDER BY pe.started_at DESC
      LIMIT 20
    `);

    // Group by day and create stories
    const stories = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    const todayStories = recentExecutions.filter(e =>
      new Date(e.started_at).toDateString() === today
    );
    const yesterdayStories = recentExecutions.filter(e =>
      new Date(e.started_at).toDateString() === yesterday
    );

    if (todayStories.length > 0) {
      stories.push({
        period: "Aujourd'hui",
        emoji: "🔥",
        count: todayStories.length,
        completed: todayStories.filter(s => s.status === 'completed').length,
        items: todayStories.slice(0, 5).map(s => ({
          id: s.id,
          procedureId: s.procedure_id,
          title: s.procedure_title,
          user: s.user_name || s.user_email?.split('@')[0] || 'Anonyme',
          status: s.status,
          duration: s.duration_minutes,
          time: new Date(s.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          category: s.category,
          riskLevel: s.risk_level
        }))
      });
    }

    if (yesterdayStories.length > 0) {
      stories.push({
        period: "Hier",
        emoji: "📅",
        count: yesterdayStories.length,
        completed: yesterdayStories.filter(s => s.status === 'completed').length,
        items: yesterdayStories.slice(0, 5).map(s => ({
          id: s.id,
          procedureId: s.procedure_id,
          title: s.procedure_title,
          user: s.user_name || s.user_email?.split('@')[0] || 'Anonyme',
          status: s.status,
          duration: s.duration_minutes,
          time: new Date(s.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          category: s.category,
          riskLevel: s.risk_level
        }))
      });
    }

    // Get top performers
    const { rows: topPerformers } = await pool.query(`
      SELECT user_email, user_name, COUNT(*) as execution_count
      FROM procedure_executions
      WHERE started_at > NOW() - INTERVAL '7 days' AND status = 'completed'
      GROUP BY user_email, user_name
      ORDER BY execution_count DESC
      LIMIT 3
    `);

    res.json({
      success: true,
      stories,
      highlights: {
        totalToday: todayStories.length,
        totalYesterday: yesterdayStories.length,
        topPerformers: topPerformers.map(p => ({
          name: p.user_name || p.user_email?.split('@')[0] || 'Anonyme',
          count: parseInt(p.execution_count)
        }))
      }
    });
  } catch (error) {
    console.error('[ProcedureStories] Error:', error);
    res.json({ success: true, stories: [], highlights: { totalToday: 0, totalYesterday: 0, topPerformers: [] } });
  }
});

// ============================================================
// OBSOLESCENCE DASHBOARD - Track equipment lifecycle
// ============================================================
app.get("/api/ai-assistant/obsolescence", async (req, res) => {
  try {
    // Get equipment approaching end of life
    const { rows: criticalSwitchboards } = await pool.query(`
      SELECT id, name, code, building_code, installation_date, expected_lifespan_years,
             end_of_life_date, obsolescence_status, live_status
      FROM switchboards
      WHERE (
        end_of_life_date < NOW() + INTERVAL '2 years'
        OR (installation_date IS NOT NULL AND
            installation_date + (expected_lifespan_years || ' years')::interval < NOW() + INTERVAL '2 years')
        OR obsolescence_status IN ('end_of_life', 'obsolete', 'critical')
      )
      ORDER BY COALESCE(end_of_life_date, installation_date + (expected_lifespan_years || ' years')::interval) ASC
      LIMIT 20
    `);

    const { rows: criticalDevices } = await pool.query(`
      SELECT d.id, d.name, d.manufacturer, d.reference, d.installation_date,
             d.expected_lifespan_years, d.end_of_life_date, d.obsolescence_status,
             d.spare_parts_available, d.manufacturer_support_until,
             s.name as switchboard_name, s.code as switchboard_code
      FROM devices d
      LEFT JOIN switchboards s ON s.id = d.switchboard_id
      WHERE (
        d.end_of_life_date < NOW() + INTERVAL '2 years'
        OR d.spare_parts_available = false
        OR d.manufacturer_support_until < NOW() + INTERVAL '1 year'
        OR d.obsolescence_status IN ('end_of_life', 'obsolete', 'critical')
      )
      ORDER BY COALESCE(d.end_of_life_date, d.manufacturer_support_until) ASC
      LIMIT 30
    `);

    // Calculate lifecycle metrics
    const { rows: lifecycleStats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE obsolescence_status = 'active') as active_count,
        COUNT(*) FILTER (WHERE obsolescence_status = 'aging') as aging_count,
        COUNT(*) FILTER (WHERE obsolescence_status = 'end_of_life') as eol_count,
        COUNT(*) FILTER (WHERE obsolescence_status = 'obsolete') as obsolete_count,
        AVG(EXTRACT(YEAR FROM AGE(NOW(), installation_date)))::integer as avg_age_years
      FROM switchboards
      WHERE installation_date IS NOT NULL
    `);

    // Format response
    const alerts = [];

    criticalSwitchboards.forEach(sb => {
      const yearsRemaining = sb.end_of_life_date
        ? Math.round((new Date(sb.end_of_life_date) - new Date()) / (365 * 24 * 60 * 60 * 1000) * 10) / 10
        : null;

      alerts.push({
        type: 'switchboard',
        severity: yearsRemaining !== null && yearsRemaining < 1 ? 'critical' : 'warning',
        id: sb.id,
        name: sb.name,
        code: sb.code,
        location: sb.building_code,
        status: sb.obsolescence_status,
        yearsRemaining,
        endOfLifeDate: sb.end_of_life_date,
        installationDate: sb.installation_date,
        icon: '⚡'
      });
    });

    criticalDevices.forEach(d => {
      alerts.push({
        type: 'device',
        severity: !d.spare_parts_available ? 'critical' : 'warning',
        id: d.id,
        name: d.name || `${d.manufacturer} ${d.reference}`,
        manufacturer: d.manufacturer,
        reference: d.reference,
        location: `${d.switchboard_name} (${d.switchboard_code})`,
        status: d.obsolescence_status,
        spareParts: d.spare_parts_available,
        supportUntil: d.manufacturer_support_until,
        icon: '🔌'
      });
    });

    res.json({
      success: true,
      alerts: alerts.slice(0, 15),
      stats: {
        active: parseInt(lifecycleStats.rows[0]?.active_count || 0),
        aging: parseInt(lifecycleStats.rows[0]?.aging_count || 0),
        endOfLife: parseInt(lifecycleStats.rows[0]?.eol_count || 0),
        obsolete: parseInt(lifecycleStats.rows[0]?.obsolete_count || 0),
        averageAge: lifecycleStats.rows[0]?.avg_age_years || 0
      },
      recommendations: alerts.length > 5 ? [
        "Planifier un audit d'obsolescence complet",
        "Prioriser le remplacement des équipements critiques",
        "Vérifier la disponibilité des pièces de rechange"
      ] : []
    });
  } catch (error) {
    console.error('[Obsolescence] Error:', error);
    res.json({ success: true, alerts: [], stats: { active: 0, aging: 0, endOfLife: 0, obsolete: 0, averageAge: 0 }, recommendations: [] });
  }
});

// ============================================================
// AI ROADMAP - Predictive maintenance planning
// ============================================================
app.get("/api/ai-assistant/roadmap", async (req, res) => {
  try {
    const { months = 12 } = req.query;

    // Get upcoming controls
    const { rows: upcomingControls } = await pool.query(`
      SELECT cs.*, s.name as switchboard_name, s.code as switchboard_code, s.building_code,
             ct.name as template_name
      FROM control_schedules cs
      LEFT JOIN switchboards s ON s.id = cs.switchboard_id
      LEFT JOIN control_templates ct ON ct.id = cs.template_id
      WHERE cs.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 month' * $1
      ORDER BY cs.next_due_date ASC
    `, [parseInt(months)]);

    // Get equipment reaching end of life
    const { rows: upcomingEOL } = await pool.query(`
      SELECT id, name, code, building_code, end_of_life_date, replacement_planned_date
      FROM switchboards
      WHERE end_of_life_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 month' * $1
      ORDER BY end_of_life_date ASC
    `, [parseInt(months)]);

    // Group by month
    const roadmap = {};
    const now = new Date();

    for (let i = 0; i <= parseInt(months); i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = monthDate.toISOString().slice(0, 7);
      roadmap[monthKey] = {
        month: monthDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
        controls: [],
        replacements: [],
        milestones: []
      };
    }

    // Add controls to roadmap
    upcomingControls.forEach(control => {
      const monthKey = control.next_due_date?.toISOString().slice(0, 7);
      if (roadmap[monthKey]) {
        roadmap[monthKey].controls.push({
          id: control.id,
          type: 'control',
          name: control.switchboard_name || 'Équipement',
          code: control.switchboard_code,
          location: control.building_code,
          template: control.template_name,
          dueDate: control.next_due_date,
          icon: '📋'
        });
      }
    });

    // Add replacements to roadmap
    upcomingEOL.forEach(eq => {
      const monthKey = eq.end_of_life_date?.toISOString().slice(0, 7);
      if (roadmap[monthKey]) {
        roadmap[monthKey].replacements.push({
          id: eq.id,
          type: 'replacement',
          name: eq.name,
          code: eq.code,
          location: eq.building_code,
          eolDate: eq.end_of_life_date,
          plannedDate: eq.replacement_planned_date,
          icon: '🔄'
        });
      }
    });

    // Generate AI recommendations if available
    let aiRecommendations = [];
    if (openai || gemini) {
      try {
        const roadmapSummary = Object.entries(roadmap).slice(0, 6).map(([month, data]) =>
          `${data.month}: ${data.controls.length} contrôles, ${data.replacements.length} remplacements`
        ).join('\n');

        const prompt = `En tant qu'expert maintenance industrielle, analyse cette roadmap et donne 3 recommandations stratégiques courtes:

${roadmapSummary}

Format: 3 bullet points concis et actionnables.`;

        const result = await chatWithFallback([{ role: "user", content: prompt }], { max_tokens: 200 });
        aiRecommendations = result.content.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•')).slice(0, 3);
      } catch (e) {
        console.error('[Roadmap] AI error:', e);
      }
    }

    res.json({
      success: true,
      roadmap: Object.entries(roadmap).map(([key, data]) => ({
        monthKey: key,
        ...data,
        summary: {
          totalControls: data.controls.length,
          totalReplacements: data.replacements.length,
          totalMilestones: data.milestones.length
        }
      })),
      totals: {
        controls: upcomingControls.length,
        replacements: upcomingEOL.length
      },
      aiRecommendations
    });
  } catch (error) {
    console.error('[Roadmap] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// EQUIPMENT LIVE STATUS - For animations and real-time display
// ============================================================
app.get("/api/ai-assistant/equipment-status", async (req, res) => {
  try {
    const { type = 'all', site } = req.query;

    let switchboardStatus = [];
    let deviceStatus = [];

    if (type === 'all' || type === 'switchboards') {
      const query = site
        ? `SELECT id, name, code, building_code, live_status, last_status_update, device_count FROM switchboards WHERE site = $1`
        : `SELECT id, name, code, building_code, live_status, last_status_update, device_count FROM switchboards`;
      const { rows } = await pool.query(query, site ? [site] : []);
      switchboardStatus = rows.map(s => ({
        id: s.id,
        type: 'switchboard',
        name: s.name,
        code: s.code,
        location: s.building_code,
        status: s.live_status || 'normal',
        lastUpdate: s.last_status_update,
        deviceCount: s.device_count,
        animation: getStatusAnimation(s.live_status)
      }));
    }

    if (type === 'all' || type === 'devices') {
      const query = site
        ? `SELECT d.id, d.name, d.live_status, d.last_status_update, s.code as switchboard_code
           FROM devices d LEFT JOIN switchboards s ON s.id = d.switchboard_id WHERE s.site = $1 AND d.live_status != 'normal' LIMIT 50`
        : `SELECT d.id, d.name, d.live_status, d.last_status_update, s.code as switchboard_code
           FROM devices d LEFT JOIN switchboards s ON s.id = d.switchboard_id WHERE d.live_status != 'normal' LIMIT 50`;
      const { rows } = await pool.query(query, site ? [site] : []);
      deviceStatus = rows.map(d => ({
        id: d.id,
        type: 'device',
        name: d.name,
        switchboard: d.switchboard_code,
        status: d.live_status || 'normal',
        lastUpdate: d.last_status_update,
        animation: getStatusAnimation(d.live_status)
      }));
    }

    res.json({
      success: true,
      switchboards: switchboardStatus,
      devices: deviceStatus,
      summary: {
        total: switchboardStatus.length + deviceStatus.length,
        normal: switchboardStatus.filter(s => s.status === 'normal').length,
        warning: switchboardStatus.filter(s => s.status === 'warning').length + deviceStatus.filter(d => d.status === 'warning').length,
        alarm: switchboardStatus.filter(s => s.status === 'alarm').length + deviceStatus.filter(d => d.status === 'alarm').length,
        offline: switchboardStatus.filter(s => s.status === 'offline').length + deviceStatus.filter(d => d.status === 'offline').length
      }
    });
  } catch (error) {
    console.error('[EquipmentStatus] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update equipment live status
app.put("/api/ai-assistant/equipment-status/:type/:id", express.json(), async (req, res) => {
  try {
    const { type, id } = req.params;
    const { status } = req.body;

    const validStatuses = ['normal', 'warning', 'alarm', 'offline', 'maintenance', 'running'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const table = type === 'switchboard' ? 'switchboards' : 'devices';
    const { rows } = await pool.query(
      `UPDATE ${table} SET live_status = $1, last_status_update = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }

    res.json({ success: true, equipment: rows[0] });
  } catch (error) {
    console.error('[EquipmentStatus] Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper for status animations
function getStatusAnimation(status) {
  const animations = {
    normal: { color: '#22c55e', pulse: false, icon: '✓' },
    warning: { color: '#f59e0b', pulse: true, icon: '⚠️' },
    alarm: { color: '#ef4444', pulse: true, speed: 'fast', icon: '🚨' },
    offline: { color: '#6b7280', pulse: false, icon: '⭕' },
    maintenance: { color: '#3b82f6', pulse: true, icon: '🔧' },
    running: { color: '#22c55e', pulse: true, speed: 'slow', icon: '▶️' }
  };
  return animations[status] || animations.normal;
}

// ============================================================
// MINI PLANS VIEWER - Quick view equipment schematics
// ============================================================
app.get("/api/ai-assistant/mini-plan/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;

    if (type === 'switchboard') {
      const { rows } = await pool.query(
        `SELECT s.*,
          (SELECT COUNT(*) FROM devices WHERE switchboard_id = s.id) as device_count,
          (SELECT json_agg(json_build_object(
            'id', d.id, 'name', d.name, 'type', d.device_type,
            'manufacturer', d.manufacturer, 'reference', d.reference,
            'in_amps', d.in_amps, 'position', d.position_number,
            'is_main', d.is_main_incoming, 'live_status', d.live_status
          ) ORDER BY d.position_number) FROM devices d WHERE d.switchboard_id = s.id) as devices
        FROM switchboards s WHERE s.id = $1`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Switchboard not found' });
      }

      const sb = rows[0];
      res.json({
        success: true,
        type: 'switchboard',
        data: {
          id: sb.id,
          name: sb.name,
          code: sb.code,
          building: sb.building_code,
          floor: sb.floor,
          room: sb.room,
          isPrincipal: sb.is_principal,
          regimeNeutral: sb.regime_neutral,
          deviceCount: parseInt(sb.device_count),
          devices: sb.devices || [],
          diagramData: sb.diagram_data,
          liveStatus: sb.live_status,
          hasPhoto: !!sb.photo
        },
        quickActions: [
          { label: 'Voir le schéma', action: 'openDiagram', icon: '📐' },
          { label: 'Historique contrôles', action: 'viewControls', icon: '📋' },
          { label: 'Signaler anomalie', action: 'reportIssue', icon: '⚠️' }
        ]
      });
    } else {
      res.status(400).json({ error: 'Unsupported type' });
    }
  } catch (error) {
    console.error('[MiniPlan] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ELEVENLABS TTS - Ultra-natural voice synthesis
// ============================================================
app.post("/api/ai-assistant/tts-elevenlabs", express.json(), async (req, res) => {
  const { text, voice = "Rachel" } = req.body;
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  // ElevenLabs voice IDs
  const voiceIds = {
    "Rachel": "21m00Tcm4TlvDq8ikWAM",   // Calm, professional female
    "Domi": "AZnzlk1XvdvUeBnXmlld",      // Strong, confident female
    "Bella": "EXAVITQu4vr4xnSDxMaL",     // Soft, warm female
    "Antoni": "ErXwobaYiN019PkySvjV",    // Professional male
    "Josh": "TxGEqnHWrfWFTfGW9XjX",      // Deep, warm male
    "Arnold": "VR6AewLTigWG4xSOukaG"     // Crisp, clear male
  };

  // If no ElevenLabs key, fallback to OpenAI
  if (!ELEVENLABS_API_KEY) {
    console.log('[TTS] No ElevenLabs key, falling back to OpenAI');
    if (!openai) {
      return res.status(503).json({ error: "No TTS provider available", fallback: true });
    }

    try {
      const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/•/g, '').substring(0, 4000);
      const mp3 = await openai.audio.speech.create({
        model: "tts-1-hd",
        voice: "nova",
        input: cleanText,
        speed: 1.0
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buffer.length });
      return res.send(buffer);
    } catch (e) {
      return res.status(500).json({ error: e.message, fallback: true });
    }
  }

  try {
    const voiceId = voiceIds[voice] || voiceIds["Rachel"];
    const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/•/g, '').substring(0, 5000);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
      'X-TTS-Provider': 'elevenlabs'
    });
    res.send(buffer);
  } catch (error) {
    console.error('[TTS-ElevenLabs] Error:', error);
    // Fallback to OpenAI
    if (openai) {
      try {
        const mp3 = await openai.audio.speech.create({
          model: "tts-1-hd",
          voice: "nova",
          input: text.substring(0, 4000),
          speed: 1.0
        });
        const buffer = Buffer.from(await mp3.arrayBuffer());
        res.set({ 'Content-Type': 'audio/mpeg', 'X-TTS-Provider': 'openai-fallback' });
        return res.send(buffer);
      } catch (e) {
        return res.status(500).json({ error: e.message, fallback: true });
      }
    }
    res.status(500).json({ error: error.message, fallback: true });
  }
});

// ============================================================
// WHISPER STT - Speech to text transcription
// ============================================================
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.post("/api/ai-assistant/stt", audioUpload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Audio file is required" });
  }

  if (!openai) {
    return res.status(503).json({ error: "Speech-to-text not available" });
  }

  try {
    // Create a File-like object from the buffer
    const audioFile = new File([req.file.buffer], 'audio.webm', { type: req.file.mimetype });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "fr",
      response_format: "text"
    });

    res.json({ success: true, text: transcription });
  } catch (error) {
    console.error('[STT] Whisper error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// HISTORICAL CHARTS - Control trends over 30/90 days
// ============================================================
app.get("/api/ai-assistant/historical-stats", async (req, res) => {
  const { period = '30' } = req.query;
  const days = parseInt(period) || 30;

  try {
    // Get daily control completions
    const completionsRes = await pool.query(`
      SELECT
        DATE(updated_at) as date,
        COUNT(*) as count
      FROM control_schedules
      WHERE status = 'completed'
      AND updated_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(updated_at)
      ORDER BY date ASC
    `);

    // Get daily ATEX NC creations (from atex_checks with non_conforme result)
    const ncCreatedRes = await pool.query(`
      SELECT
        DATE(date) as date,
        COUNT(*) as count
      FROM atex_checks
      WHERE result = 'non_conforme'
      AND date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(date)
      ORDER BY date ASC
    `);

    // Get daily ATEX conforming checks (as "resolved" indicator)
    const ncClosedRes = await pool.query(`
      SELECT
        DATE(date) as date,
        COUNT(*) as count
      FROM atex_checks
      WHERE result = 'conforme'
      AND date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(date)
      ORDER BY date ASC
    `);

    // Get equipment added over time
    const equipmentAddedRes = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM switchboards
      WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Build date labels for the period
    const labels = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(date.toISOString().split('T')[0]);
    }

    // Convert query results to maps
    const completionsMap = new Map(completionsRes.rows.map(r => [r.date?.toISOString().split('T')[0], parseInt(r.count)]));
    const ncCreatedMap = new Map(ncCreatedRes.rows.map(r => [r.date?.toISOString().split('T')[0], parseInt(r.count)]));
    const ncClosedMap = new Map(ncClosedRes.rows.map(r => [r.date?.toISOString().split('T')[0], parseInt(r.count)]));
    const equipmentMap = new Map(equipmentAddedRes.rows.map(r => [r.date?.toISOString().split('T')[0], parseInt(r.count)]));

    // Build datasets
    const datasets = {
      controlsCompleted: labels.map(d => completionsMap.get(d) || 0),
      ncCreated: labels.map(d => ncCreatedMap.get(d) || 0),
      ncClosed: labels.map(d => ncClosedMap.get(d) || 0),
      equipmentAdded: labels.map(d => equipmentMap.get(d) || 0)
    };

    // Calculate trends
    const halfPoint = Math.floor(labels.length / 2);
    const firstHalf = datasets.controlsCompleted.slice(0, halfPoint);
    const secondHalf = datasets.controlsCompleted.slice(halfPoint);
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length || 0;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length || 0;
    const trend = secondAvg > firstAvg ? 'up' : secondAvg < firstAvg ? 'down' : 'stable';

    res.json({
      success: true,
      period: days,
      labels,
      datasets,
      summary: {
        totalControlsCompleted: datasets.controlsCompleted.reduce((a, b) => a + b, 0),
        totalNcCreated: datasets.ncCreated.reduce((a, b) => a + b, 0),
        totalNcClosed: datasets.ncClosed.reduce((a, b) => a + b, 0),
        avgControlsPerDay: (datasets.controlsCompleted.reduce((a, b) => a + b, 0) / days).toFixed(1),
        trend
      }
    });
  } catch (error) {
    console.error('[HistoricalStats] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PROACTIVE SUGGESTIONS - Context-aware recommendations
// ============================================================
app.get("/api/ai-assistant/suggestions", async (req, res) => {
  const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';

  try {
    const suggestions = [];
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    // 1. Check overdue controls
    const overdueRes = await pool.query(`
      SELECT COUNT(*) as count FROM control_schedules
      WHERE next_due_date < CURRENT_DATE AND (status IS NULL OR status != 'completed')
    `);
    const overdueCount = parseInt(overdueRes.rows[0]?.count || 0);

    if (overdueCount > 0) {
      suggestions.push({
        type: 'urgent',
        icon: '⚠️',
        title: `${overdueCount} contrôle(s) en retard`,
        message: `Tu as des contrôles en retard. Veux-tu que je te prépare la liste optimisée par bâtiment?`,
        action: { type: 'navigate', path: '/app/switchboard-controls?tab=overdue' },
        priority: 1
      });
    }

    // 2. Morning brief suggestion (before 10am)
    if (hour < 10 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      suggestions.push({
        type: 'info',
        icon: '☀️',
        title: 'Brief du matin disponible',
        message: 'Consulte ton brief pour voir les priorités du jour et les contrôles à venir.',
        action: { type: 'scroll', target: 'morning-brief' },
        priority: 2
      });
    }

    // 3. Check ATEX NC (from atex_checks with non_conforme result)
    const atexNcRes = await pool.query(`
      SELECT COUNT(*) as count FROM atex_checks
      WHERE result = 'non_conforme'
      AND (status IS NULL OR status != 'resolved')
    `);
    const atexNcCount = parseInt(atexNcRes.rows[0]?.count || 0);

    if (atexNcCount > 5) {
      suggestions.push({
        type: 'warning',
        icon: '🧯',
        title: `${atexNcCount} NC ATEX en attente`,
        message: 'Plusieurs non-conformités ATEX sont en attente de traitement.',
        action: { type: 'navigate', path: '/app/atex?tab=nc' },
        priority: 2
      });
    }

    // 4. Weekly planning suggestion (Monday)
    if (dayOfWeek === 1 && hour >= 8 && hour <= 10) {
      suggestions.push({
        type: 'tip',
        icon: '📅',
        title: 'Planification de la semaine',
        message: 'Nouveau lundi! Veux-tu que je génère ton planning optimisé pour la semaine?',
        action: { type: 'command', command: 'generateWeeklyPlan' },
        priority: 3
      });
    }

    // 5. Documentation tip (general suggestion, no DB query needed)
    // Show occasionally to encourage documentation
    if (dayOfWeek === 3 && hour >= 10 && hour <= 14) { // Wednesday midday
      suggestions.push({
        type: 'tip',
        icon: '📚',
        title: 'Documentation technique',
        message: 'Besoin de documentation? Je peux rechercher les manuels et fiches techniques pour vos équipements.',
        action: { type: 'command', command: 'searchDoc' },
        priority: 4
      });
    }

    // 6. End of day suggestion (after 4pm)
    if (hour >= 16 && hour <= 18 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      suggestions.push({
        type: 'info',
        icon: '📝',
        title: 'Résumé de la journée',
        message: 'Veux-tu un résumé de ce qui a été fait aujourd\'hui?',
        action: { type: 'command', command: 'dailySummary' },
        priority: 5
      });
    }

    // Sort by priority
    suggestions.sort((a, b) => a.priority - b.priority);

    res.json({
      success: true,
      suggestions: suggestions.slice(0, 5),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Suggestions] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// EQUIPMENT IMAGE GENERATION - AI-powered visuals
// ============================================================
app.post("/api/ai-assistant/generate-image", express.json(), async (req, res) => {
  const { equipment, style = 'technical' } = req.body;

  if (!openai) {
    return res.status(503).json({ error: "Image generation not available" });
  }

  try {
    const prompt = style === 'technical'
      ? `Technical illustration of industrial ${equipment.type || 'electrical equipment'}: ${equipment.manufacturer || ''} ${equipment.model || ''}, professional engineering diagram style, clean white background, detailed technical drawing, isometric view`
      : `Photo-realistic image of industrial ${equipment.type || 'electrical equipment'}: ${equipment.manufacturer || ''} ${equipment.model || ''}, in a factory setting, professional lighting`;

    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard"
    });

    res.json({
      success: true,
      imageUrl: response.data[0].url,
      revisedPrompt: response.data[0].revised_prompt
    });
  } catch (error) {
    console.error('[ImageGen] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// >>> Infrastructure (plans électriques multi-zones) : re-stream pour uploads PDF
app.use("/api/infra", mkProxy(infraTarget, { withRestream: true }));

/* =================================================================
   Body parser APRES les proxys (pour nos routes locales uniquement)
   ================================================================= */
app.use(express.json({ limit: "25mb" }));

// -------- API de base ----------
app.get("/api/auth/me", async (req, res) => {
  const user = req.user || { id: "guest", name: "Guest", site: process.env.DEFAULT_SITE || "Nyon" };
  res.json(user);
});

// SECURITY: Route /api/auth/login désactivée - utiliser /api/auth/bubble ou /api/auth/signin
// Cette route était une faille de sécurité permettant de créer des tokens sans vérification
app.post("/api/auth/login", express.json(), async (req, res) => {
  console.log(`[SECURITY] ⚠️ Blocked attempt to use deprecated /api/auth/login route`);
  await logAuthEvent(req, 'LOGIN_BLOCKED', {
    source: 'deprecated_route',
    success: false,
    error: 'Route disabled for security',
    details: { email: req.body?.email }
  }).catch(() => {});
  res.status(403).json({
    error: "Cette route est désactivée. Utilisez haleon-tool.io pour vous connecter.",
    redirect: "https://haleon-tool.io"
  });
});

app.post("/api/auth/logout", async (req, res) => {
  // Extraire l'utilisateur depuis le JWT avant de le supprimer
  try {
    const token = req.cookies?.token;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
      await logAuthEvent(req, 'LOGOUT', {
        email: decoded.email,
        name: decoded.name,
        user_id: decoded.id,
        company_id: decoded.company_id,
        site_id: decoded.site_id,
        role: decoded.role,
        source: decoded.source || 'unknown'
      });
    }
  } catch (e) {
    // Token invalide ou expiré - logger quand même
    await logAuthEvent(req, 'LOGOUT', { source: 'unknown', details: { reason: 'token_invalid' } });
  }
  res.clearCookie("token");
  res.json({ ok: true });
});

/* ================================================================
   🔥 Routes manquantes ajoutées pour compatibilité front actuelle
   ================================================================ */

// /api/auth/signin : Login pour utilisateurs externes (avec mot de passe)
app.post("/api/auth/signin", express.json(), async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }

  try {
    // 1️⃣ Chercher l'utilisateur dans la table users
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.password_hash, u.department_id, u.company_id, u.site_id,
              u.role, u.allowed_apps, u.is_active,
              s.name as site_name, d.name as department_name, c.name as company_name
       FROM users u
       LEFT JOIN sites s ON u.site_id = s.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      console.log(`[auth/signin] ❌ User not found: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'User not found' });
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }

    if (!user.is_active) {
      console.log(`[auth/signin] ❌ User inactive: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'Account inactive' });
      return res.status(401).json({ error: "Compte désactivé" });
    }

    if (!user.password_hash) {
      console.log(`[auth/signin] ❌ No password set for: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'No password set' });
      return res.status(401).json({ error: "Utilisez la connexion Bubble/SSO" });
    }

    // 2️⃣ Vérifier le mot de passe avec bcrypt
    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default || bcryptModule;
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      console.log(`[auth/signin] ❌ Invalid password for: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'Invalid password' });
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }

    // 3️⃣ Créer le JWT avec toutes les infos tenant
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        site: user.site_name || 'Default',
        site_id: user.site_id,
        company_id: user.company_id,
        department_id: user.department_id,
        role: user.role || 'site',
        allowed_apps: user.allowed_apps,
        source: 'local'
      },
      process.env.JWT_SECRET || "devsecret",
      { expiresIn: "7d" }
    );

    // 4️⃣ Mettre à jour last_login
    await pool.query(
      `UPDATE users SET last_login = NOW() WHERE id = $1`,
      [user.id]
    ).catch(e => console.log(`[auth/signin] last_login update failed: ${e.message}`));

    // 5️⃣ Logger la connexion dans l'audit trail
    await logAuthEvent(req, 'LOGIN', {
      email: user.email,
      name: user.name,
      user_id: user.id,
      company_id: user.company_id,
      site_id: user.site_id,
      role: user.role,
      source: 'local',
      details: { site_name: user.site_name, company_name: user.company_name }
    });
    console.log(`[auth/signin] ✅ Login successful: ${email} (company=${user.company_id}, site=${user.site_id}, role=${user.role})`);

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", token, { httpOnly: true, sameSite: isProduction ? "none" : "lax", secure: isProduction });

    // Retourner les infos utilisateur complètes
    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        site: user.site_name,
        site_id: user.site_id,
        company_id: user.company_id,
        company: user.company_name,
        department: user.department_name,
        department_id: user.department_id,
        role: user.role || 'site',
        allowed_apps: user.allowed_apps
      }
    });

  } catch (err) {
    console.error(`[auth/signin] Error:`, err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// SECURITY: /api/auth/signup désactivé - les utilisateurs externes sont créés par l'admin uniquement
// Les utilisateurs Haleon passent par haleon-tool.io et sont en "pending" jusqu'à validation
app.post("/api/auth/signup", express.json(), async (req, res) => {
  console.log(`[SECURITY] ⚠️ Blocked signup attempt for: ${req.body?.email}`);
  await logAuthEvent(req, 'SIGNUP_BLOCKED', {
    email: req.body?.email,
    source: 'disabled_route',
    success: false,
    error: 'Self-registration disabled'
  }).catch(() => {});
  res.status(403).json({
    error: "L'inscription directe est désactivée. Contactez votre administrateur ou connectez-vous via haleon-tool.io",
    redirect: "https://haleon-tool.io"
  });
});

// /api/auth/me : Rafraîchit les permissions utilisateur depuis la DB
// Permet de synchroniser les changements faits par l'admin sans déconnexion
app.get("/api/auth/me", async (req, res) => {
  try {
    // 1️⃣ Extraire l'email depuis le JWT (cookie ou header)
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    } catch (e) {
      return res.status(401).json({ error: "Token invalide" });
    }

    const email = decoded.email;
    if (!email) {
      return res.status(401).json({ error: "Email manquant dans le token" });
    }

    // 2️⃣ Récupérer les données actuelles depuis la DB
    // Chercher dans users (external users)
    let userData = null;
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.name, u.department_id, u.company_id, u.site_id,
              u.role, u.allowed_apps, u.origin,
              s.name as site_name, c.name as company_name, d.name as department_name
       FROM users u
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN companies c ON c.id = u.company_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [email]
    );
    userData = userResult.rows[0];

    // Si pas dans users, chercher dans haleon_users
    if (!userData) {
      const haleonResult = await pool.query(
        `SELECT h.id, h.email, h.name, h.department_id, h.site_id, h.allowed_apps,
                s.name as site_name, s.company_id, c.name as company_name, d.name as department_name
         FROM haleon_users h
         LEFT JOIN sites s ON s.id = h.site_id
         LEFT JOIN companies c ON c.id = s.company_id
         LEFT JOIN departments d ON d.id = h.department_id
         WHERE LOWER(h.email) = LOWER($1) LIMIT 1`,
        [email]
      );
      userData = haleonResult.rows[0];
      if (userData) {
        userData.origin = 'haleon';
        userData.role = userData.role || 'site';
      }
    }

    if (!userData) {
      // Utilisateur non trouvé en DB, retourner les infos du JWT
      return res.json({
        ok: true,
        user: {
          id: decoded.id,
          email: decoded.email,
          name: decoded.name,
          site: decoded.site,
          site_id: decoded.site_id,
          company_id: decoded.company_id,
          role: decoded.role || 'site',
          allowed_apps: decoded.allowed_apps,
          source: decoded.source
        },
        fromDb: false
      });
    }

    // 3️⃣ Retourner les données mises à jour depuis la DB
    console.log(`[auth/me] ✅ Refreshed permissions for ${email}: allowed_apps=${JSON.stringify(userData.allowed_apps)}`);

    res.json({
      ok: true,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name || userData.email.split('@')[0],
        site: userData.site_name,
        site_id: userData.site_id,
        company_id: userData.company_id,
        company: userData.company_name,
        department: userData.department_name,
        department_id: userData.department_id,
        role: userData.role || 'site',
        allowed_apps: userData.allowed_apps,
        origin: userData.origin,
        source: decoded.source || 'local'
      },
      fromDb: true
    });

  } catch (err) {
    console.error(`[auth/me] Error:`, err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ================================================================
   🔵 Auth via Bubble (nouvelle route)
   ================================================================ */
import { verifyBubbleToken, signLocalJWT } from "./auth-bubble.js";

app.post("/api/auth/bubble", express.json(), async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "Missing token" });

    // 1️⃣ Vérifie le token Bubble via haleon-tool.io
    const user = await verifyBubbleToken(token);
    console.log(`[auth/bubble] 📧 User: ${user.email}`);

    // 2️⃣ Cherche l'utilisateur en base pour récupérer department_id, company_id, site_id
    let haleonUser = null;
    let mainUser = null;
    let isNewUser = false;

    // Chercher dans haleon_users
    try {
      const haleonResult = await pool.query(
        `SELECT id, email, name, department_id, site_id, allowed_apps, is_validated
         FROM haleon_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [user.email]
      );
      haleonUser = haleonResult.rows[0] || null;
      console.log(`[auth/bubble] haleon_users: ${haleonUser ? JSON.stringify({ id: haleonUser.id, dept: haleonUser.department_id, site: haleonUser.site_id, is_validated: haleonUser.is_validated }) : 'NOT FOUND'}`);
    } catch (e) {
      console.log(`[auth/bubble] haleon_users ERROR: ${e.message}`);
    }

    // Chercher dans users
    try {
      const result = await pool.query(
        `SELECT id, email, name, department_id, company_id, site_id, role, allowed_apps, is_active
         FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [user.email]
      );
      mainUser = result.rows[0] || null;
      console.log(`[auth/bubble] users: ${mainUser ? JSON.stringify({ id: mainUser.id, dept: mainUser.department_id, company: mainUser.company_id, site: mainUser.site_id }) : 'NOT FOUND'}`);
    } catch (e) {
      console.log(`[auth/bubble] users ERROR: ${e.message}`);
    }

    // 3️⃣ SÉCURITÉ: Si l'utilisateur n'existe nulle part, créer un enregistrement "pending"
    const isHaleon = user.email && user.email.toLowerCase().endsWith('@haleon.com');

    if (!haleonUser && !mainUser) {
      isNewUser = true;
      console.log(`[auth/bubble] 🆕 NEW USER detected: ${user.email} - creating pending entry`);

      try {
        // Créer un utilisateur en attente de validation dans haleon_users
        const insertResult = await pool.query(`
          INSERT INTO haleon_users (email, name, site_id, is_validated, created_at)
          VALUES ($1, $2, $3, FALSE, NOW())
          ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
          RETURNING id, email, name, is_validated
        `, [user.email.toLowerCase(), user.name, isHaleon ? 1 : null]);

        haleonUser = insertResult.rows[0];
        haleonUser.is_validated = false;
        console.log(`[auth/bubble] ✅ Created pending user: ${user.email}`);

        // 🔔 Logger l'événement pour notification admin
        await logAuthEvent(req, 'NEW_USER_PENDING', {
          email: user.email,
          name: user.name,
          source: 'bubble',
          success: true,
          details: { isHaleon, requiresValidation: true }
        });

        // 🔔 Envoyer notification push aux admins
        try {
          const pushResult = await notifyAdminsPendingUser({
            email: user.email,
            name: user.name,
            isHaleon
          });
          console.log(`[auth/bubble] 🔔 Admin notification sent:`, pushResult);
        } catch (pushErr) {
          console.log(`[auth/bubble] Push notification error (non-blocking):`, pushErr.message);
        }

      } catch (insertErr) {
        console.log(`[auth/bubble] Insert pending user error: ${insertErr.message}`);
      }
    }

    // 4️⃣ Déterminer si l'utilisateur est validé
    // Un utilisateur est validé si:
    // - Il existe dans haleon_users avec is_validated = true
    // - OU il existe dans users avec is_active = true (utilisateur externe créé par admin)
    const is_validated = haleonUser?.is_validated === true || mainUser?.is_active === true;

    // Fusionner les données
    const department_id = haleonUser?.department_id || mainUser?.department_id || null;
    const site_id = haleonUser?.site_id || mainUser?.site_id || (isHaleon ? 1 : null);
    const company_id = mainUser?.company_id || (isHaleon ? 1 : null);
    const role = mainUser?.role || 'site';
    const allowed_apps = haleonUser?.allowed_apps || mainUser?.allowed_apps || null;

    console.log(`[auth/bubble] ✅ Merged: is_validated=${is_validated}, department_id=${department_id}, site_id=${site_id}`);

    // 5️⃣ Crée un JWT local enrichi avec l'état de validation
    const enrichedUser = {
      ...user,
      department_id,
      company_id,
      site_id,
      role,
      allowed_apps,
      is_validated,  // ⚠️ CRITICAL: Indique si l'utilisateur peut accéder aux apps
      isPending: !is_validated,
    };
    const jwtToken = signLocalJWT(enrichedUser);

    // 6️⃣ Logger la connexion dans l'audit trail
    await logAuthEvent(req, is_validated ? 'LOGIN' : 'LOGIN_PENDING', {
      email: enrichedUser.email,
      name: enrichedUser.name,
      user_id: mainUser?.id || haleonUser?.id,
      company_id,
      site_id,
      role,
      source: 'bubble',
      success: true,
      details: { isHaleon, site: enrichedUser.site, is_validated, isNewUser }
    });

    // 6.5️⃣ Envoyer notification aux admins si LOGIN_PENDING (même pour utilisateurs existants)
    if (!is_validated && !isNewUser) {
      // isNewUser a déjà sa notification envoyée plus haut
      try {
        const pushResult = await notifyAdminsPendingUser({
          email: enrichedUser.email,
          name: enrichedUser.name,
          isHaleon
        });
        console.log(`[auth/bubble] 🔔 Pending user notification sent:`, pushResult);
      } catch (pushErr) {
        console.log(`[auth/bubble] Push notification error (non-blocking):`, pushErr.message);
      }
    }

    // 7️⃣ Stocke en cookie + renvoie au front
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", jwtToken, {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction
    });
    res.json({ ok: true, user: enrichedUser, jwt: jwtToken });
  } catch (err) {
    console.error("Bubble auth failed:", err);
    await logAuthEvent(req, 'LOGIN_FAILED', { source: 'bubble', success: false, error: err.message });
    res.status(401).json({ error: err.message || "Invalid Bubble token" });
  }
});

/* ================================================================
   🔵 Check Validation Status - Pour rafraîchir le token après validation
   ================================================================ */
app.get("/api/auth/check-status", async (req, res) => {
  try {
    // Get user from JWT token
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const secret = process.env.JWT_SECRET || "devsecret";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const email = decoded.email?.toLowerCase();
    if (!email) {
      return res.status(401).json({ error: "Invalid token - no email" });
    }

    console.log(`[check-status] 🔍 Checking validation status for ${email}`);

    // Check if user is now validated in the users table
    const userResult = await pool.query(`
      SELECT id, email, name, is_active, site_id, department_id, company_id, role, allowed_apps
      FROM users
      WHERE LOWER(email) = $1 AND is_active = TRUE
    `, [email]);

    const isValidated = userResult.rows.length > 0;
    console.log(`[check-status] User ${email} is_validated: ${isValidated}`);

    if (isValidated) {
      // User is now validated - generate a new JWT
      const user = userResult.rows[0];
      const newPayload = {
        id: user.id || decoded.id,
        name: user.name || decoded.name,
        email: user.email || decoded.email,
        source: decoded.source || "bubble",
        site: decoded.site,
        department_id: user.department_id || decoded.department_id,
        company_id: user.company_id || decoded.company_id,
        site_id: user.site_id || decoded.site_id,
        role: user.role || decoded.role || "site",
        allowed_apps: user.allowed_apps || decoded.allowed_apps,
        is_validated: true,
        isPending: false,
      };

      const newToken = jwt.sign(newPayload, secret, { expiresIn: "7d" });

      // Set new cookie
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie("token", newToken, {
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction
      });

      console.log(`[check-status] ✅ New validated token generated for ${email}`);
      res.json({
        ok: true,
        is_validated: true,
        isPending: false,
        jwt: newToken,
        user: newPayload
      });
    } else {
      // User is still pending
      console.log(`[check-status] ⏳ User ${email} is still pending`);
      res.json({
        ok: true,
        is_validated: false,
        isPending: true
      });
    }
  } catch (err) {
    console.error("[check-status] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   🔵 Unified Recent Activity - Aggregates from ALL audit tables
   ================================================================ */
app.get("/api/dashboard/activities", async (req, res) => {
  console.log(`[DASHBOARD ACTIVITIES] 🔵 Request received`);
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const activities = [];

    // Helper to safely query audit tables
    const safeQuery = async (tableName, mapper) => {
      try {
        // Try with 'ts' first (lib/audit-trail.js schema), then 'created_at' (manual schema)
        let rows;
        let usedColumn = 'ts';
        try {
          const result = await pool.query(`
            SELECT * FROM ${tableName}
            ORDER BY ts DESC
            LIMIT 15
          `);
          rows = result.rows;
        } catch (tsError) {
          // Try with created_at instead
          usedColumn = 'created_at';
          const result = await pool.query(`
            SELECT *, created_at as ts FROM ${tableName}
            ORDER BY created_at DESC
            LIMIT 15
          `);
          rows = result.rows;
        }
        console.log(`[DASHBOARD ACTIVITIES]   📋 ${tableName}: ${rows.length} rows (using ${usedColumn})`);
        return rows.map(mapper);
      } catch (e) {
        // Table might not exist
        console.log(`[DASHBOARD ACTIVITIES]   ⚠️ ${tableName}: table not found or error - ${e.message}`);
        return [];
      }
    };

    // 1. Switchboard audit
    const switchboardActivities = await safeQuery('switchboard_audit_log', row => {
      // Build description based on action
      let description = row.details?.name || row.entity_type;
      if (row.action === 'bulk_created' && row.details) {
        const created = row.details.created || 0;
        const updated = row.details.updated || 0;
        description = `${created} créé${created > 1 ? 's' : ''}, ${updated} mis à jour`;
      }

      return {
        id: `sw-${row.id}`,
        type: row.action,
        module: 'switchboard',
        title: row.action === 'created' ? 'Tableau créé' :
               row.action === 'updated' ? 'Tableau modifié' :
               row.action === 'deleted' ? 'Tableau supprimé' :
               row.action === 'bulk_created' ? '📷 Scan tableau terminé' :
               row.action,
        description,
        actor: row.actor_name || row.actor_email,
        timestamp: row.ts || row.created_at,
        url: '/app/switchboards',
        icon: '⚡',
        color: row.action === 'deleted' ? 'red' :
               row.action === 'created' ? 'green' :
               row.action === 'bulk_created' ? 'violet' : 'blue'
      };
    });
    activities.push(...switchboardActivities);

    // 2. Fire Doors audit
    const doorsActivities = await safeQuery('fire_doors_audit_log', row => ({
      id: `fd-${row.id}`,
      type: row.action,
      module: 'doors',
      title: row.action === 'created' ? 'Porte ajoutée' :
             row.action === 'updated' ? 'Porte modifiée' :
             row.action === 'deleted' ? 'Porte supprimée' : row.action,
      description: row.details?.name || row.entity_type,
      actor: row.actor_name || row.actor_email,
      timestamp: row.ts || row.created_at,
      url: '/app/doors',
      icon: '🚪',
      color: row.action === 'deleted' ? 'red' : row.action === 'created' ? 'green' : 'amber'
    }));
    activities.push(...doorsActivities);

    // 3. Mobile Equipment audit
    const mobileActivities = await safeQuery('mobile_equipment_audit_log', row => ({
      id: `me-${row.id}`,
      type: row.action,
      module: 'mobile-equipment',
      title: row.action === 'created' ? 'Équipement ajouté' :
             row.action === 'updated' ? 'Équipement modifié' :
             row.action === 'deleted' ? 'Équipement supprimé' : row.action,
      description: row.details?.name || row.entity_type,
      actor: row.actor_name || row.actor_email,
      timestamp: row.ts || row.created_at,
      url: '/app/mobile-equipments',
      icon: '🔌',
      color: row.action === 'deleted' ? 'red' : row.action === 'created' ? 'green' : 'blue'
    }));
    activities.push(...mobileActivities);

    // 4. DataHub audit
    const datahubActivities = await safeQuery('datahub_audit_log', row => ({
      id: `dh-${row.id}`,
      type: row.action,
      module: 'datahub',
      title: row.action === 'created' ? 'Donnée créée' :
             row.action === 'updated' ? 'Donnée modifiée' :
             row.action === 'deleted' ? 'Donnée supprimée' : row.action,
      description: row.details?.name || row.entity_type,
      actor: row.actor_name || row.actor_email,
      timestamp: row.ts || row.created_at,
      url: '/app/datahub',
      icon: '🗄️',
      color: row.action === 'deleted' ? 'red' : row.action === 'created' ? 'green' : 'violet'
    }));
    activities.push(...datahubActivities);

    // 5. Procedures audit
    const proceduresActivities = await safeQuery('procedures_audit_log', row => ({
      id: `pr-${row.id}`,
      type: row.action,
      module: 'procedures',
      title: row.action === 'created' ? 'Procédure créée' :
             row.action === 'updated' ? 'Procédure modifiée' :
             row.action === 'deleted' ? 'Procédure supprimée' : row.action,
      description: row.details?.title || row.entity_type,
      actor: row.actor_name || row.actor_email,
      timestamp: row.ts || row.created_at,
      url: '/app/procedures',
      icon: '📋',
      color: 'violet'
    }));
    activities.push(...proceduresActivities);

    // 6. Project Management audit
    const pmActivities = await safeQuery('pm_audit', row => ({
      id: `pm-${row.id}`,
      type: row.action,
      module: 'projects',
      title: row.action.includes('create') ? 'Projet créé' :
             row.action.includes('update') ? 'Projet modifié' :
             row.action.includes('delete') ? 'Projet supprimé' : row.action,
      description: row.details?.name || row.action,
      actor: row.user_email,
      timestamp: row.ts || row.created_at,
      url: '/app/projects',
      icon: '💳',
      color: 'green'
    }));
    activities.push(...pmActivities);

    // 7. Pending Reports (ATEX DRPCE, etc.) - for action_required
    // NOTE: Utilise atexPool car pending_reports est dans la base ATEX
    const actionRequired = [];
    try {
      console.log('[DASHBOARD ACTIVITIES] 🔍 Querying pending_reports from atexPool...');
      const { rows: pendingReports } = await atexPool.query(`
        SELECT id, report_type, status, user_email, created_at, completed_at, total_items, error_message
        FROM pending_reports
        WHERE status IN ('pending', 'completed', 'error')
        AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 10
      `);
      console.log(`[DASHBOARD ACTIVITIES] 📋 pending_reports: ${pendingReports.length} rows found`);
      if (pendingReports.length > 0) {
        console.log(`[DASHBOARD ACTIVITIES]   First report: id=${pendingReports[0].id}, status=${pendingReports[0].status}, type=${pendingReports[0].report_type}`);
      }

      for (const report of pendingReports) {
        // Map report types to friendly names
        const reportTypeLabels = {
          'drpce': 'Management Monitoring ATEX',
          'atex': 'Rapport ATEX',
          'management_monitoring': 'Management Monitoring ATEX'
        };
        const reportLabel = reportTypeLabels[report.report_type] || report.report_type || 'Management Monitoring';

        if (report.status === 'completed') {
          // Completed report - show in recent activities with download link
          activities.push({
            id: `report-${report.id}`,
            type: 'report_ready',
            module: 'atex',
            title: '📄 Rapport prêt à télécharger',
            description: `${reportLabel} - ${report.total_items || 0} équipements`,
            actor: report.user_email,
            timestamp: report.completed_at || report.created_at,
            url: `/app/atex?downloadReport=${report.id}`,
            icon: '📄',
            color: 'green',
            actionRequired: true
          });
        } else if (report.status === 'pending') {
          // Still generating - show in action_required
          actionRequired.push({
            id: `report-pending-${report.id}`,
            type: 'report_pending',
            module: 'atex',
            title: '⏳ Rapport en cours de génération',
            description: `${reportLabel} - Veuillez patienter...`,
            actor: report.user_email,
            timestamp: report.created_at,
            url: '/app/atex?tab=drpce',
            icon: '⏳',
            color: 'amber',
            actionRequired: true
          });
        } else if (report.status === 'error') {
          // Failed report - show in recent activities
          activities.push({
            id: `report-error-${report.id}`,
            type: 'report_error',
            module: 'atex',
            title: '❌ Erreur de génération',
            description: `${reportLabel} - ${report.error_message || 'Échec'}`.substring(0, 100),
            actor: report.user_email,
            timestamp: report.completed_at || report.created_at,
            url: '/app/atex?tab=drpce',
            icon: '❌',
            color: 'red',
            actionRequired: false
          });
        }
      }
    } catch (e) {
      // pending_reports table might not exist
      console.warn('[DASHBOARD] pending_reports query error:', e.message);
    }

    // 8. Pending Signature Requests - for action_required
    try {
      const userEmail = req.headers['x-user-email'] || req.query.email;
      if (userEmail) {
        const { rows: pendingSignatures } = await pool.query(`
          SELECT psr.id, psr.procedure_id, psr.status, psr.requested_at,
                 p.title as procedure_title, p.created_by
          FROM procedure_signature_requests psr
          JOIN procedures p ON psr.procedure_id = p.id
          WHERE psr.signer_email = $1 AND psr.status = 'pending'
          ORDER BY psr.requested_at DESC
          LIMIT 5
        `, [userEmail]);

        for (const sig of pendingSignatures) {
          actionRequired.push({
            id: `sig-${sig.id}`,
            type: 'signature_pending',
            module: 'procedures',
            title: '✍️ Signature requise',
            description: `"${sig.procedure_title}" attend votre signature`,
            actor: sig.created_by,
            timestamp: sig.requested_at,
            url: `/app/procedures/${sig.procedure_id}`,
            icon: '✍️',
            color: 'violet',
            actionRequired: true
          });
        }
      }
    } catch (e) {
      // procedure_signature_requests table might not exist
    }

    // 9. Recent procedure activities (created, signed, approved)
    try {
      const { rows: procActivities } = await pool.query(`
        SELECT p.id, p.title, p.status, p.created_by, p.created_at, p.updated_at
        FROM procedures p
        WHERE p.updated_at > NOW() - INTERVAL '7 days'
        ORDER BY p.updated_at DESC
        LIMIT 10
      `);

      for (const proc of procActivities) {
        const statusLabels = {
          draft: 'Brouillon créé',
          pending_signature: 'En attente de signature',
          approved: 'Approuvée',
          active: 'Activée',
          rejected: 'Rejetée'
        };
        const statusColors = {
          draft: 'blue',
          pending_signature: 'amber',
          approved: 'green',
          active: 'green',
          rejected: 'red'
        };
        const statusIcons = {
          draft: '📝',
          pending_signature: '✍️',
          approved: '✅',
          active: '✅',
          rejected: '❌'
        };

        activities.push({
          id: `proc-${proc.id}`,
          type: `procedure_${proc.status}`,
          module: 'procedures',
          title: statusLabels[proc.status] || 'Procédure modifiée',
          description: proc.title,
          actor: proc.created_by,
          timestamp: proc.updated_at,
          url: `/app/procedures/${proc.id}`,
          icon: statusIcons[proc.status] || '📋',
          color: statusColors[proc.status] || 'violet'
        });
      }
    } catch (e) {
      // procedures table might not exist
    }

    // 10. Panel Scan Jobs - Completed AI scans
    try {
      const userEmail = req.headers['x-user-email'] || req.query.email;
      console.log(`[DASHBOARD ACTIVITIES]   🔍 Querying panel_scan_jobs (userEmail: ${userEmail || 'none'})`);

      const { rows: panelScans } = await pool.query(`
        SELECT id, site, switchboard_id, user_email, status, progress, message,
               photos_count, result, error, created_at, completed_at
        FROM panel_scan_jobs
        WHERE completed_at IS NOT NULL
          AND completed_at > NOW() - INTERVAL '7 days'
        ORDER BY completed_at DESC
        LIMIT 15
      `);

      console.log(`[DASHBOARD ACTIVITIES]   📷 panel_scan_jobs: ${panelScans.length} completed scans found`);

      let addedScans = 0;
      for (const scan of panelScans) {
        console.log(`[DASHBOARD ACTIVITIES]     - Scan ${scan.id}: status="${scan.status}", completed_at=${scan.completed_at}`);
        const isSuccess = scan.status === 'completed';
        const deviceCount = scan.result?.devices?.length || scan.result?.length || 0;

        if (isSuccess) {
          addedScans++;
          activities.push({
            id: `scan-${scan.id}`,
            type: 'panel_scan_complete',
            module: 'switchboard',
            title: '📷 Scan IA terminé',
            description: `${deviceCount} appareil${deviceCount > 1 ? 's' : ''} détecté${deviceCount > 1 ? 's' : ''}`,
            actor: scan.user_email,
            timestamp: scan.completed_at,
            url: `/app/switchboards?scanJobId=${scan.id}&switchboardId=${scan.switchboard_id}`,
            icon: '📷',
            color: 'violet',
            actionRequired: scan.user_email === userEmail // Only action required for the user who launched it
          });
        } else if (scan.status === 'failed') {
          addedScans++;
          activities.push({
            id: `scan-${scan.id}`,
            type: 'panel_scan_failed',
            module: 'switchboard',
            title: '❌ Scan IA échoué',
            description: scan.error || 'Erreur lors de l\'analyse',
            actor: scan.user_email,
            timestamp: scan.completed_at,
            url: `/app/switchboards`,
            icon: '❌',
            color: 'red'
          });
        } else {
          console.log(`[DASHBOARD ACTIVITIES]     ⚠️ Scan ${scan.id} skipped: unexpected status "${scan.status}"`);
        }
      }
      console.log(`[DASHBOARD ACTIVITIES]   ✅ Added ${addedScans} panel scan activities`);

      // Also check for in-progress scans for action_required
      const { rows: inProgressScans } = await pool.query(`
        SELECT id, site, switchboard_id, user_email, status, progress, message, created_at
        FROM panel_scan_jobs
        WHERE status IN ('processing', 'pending')
          AND user_email = $1
          AND created_at > NOW() - INTERVAL '1 day'
        ORDER BY created_at DESC
        LIMIT 5
      `, [userEmail || '']);

      console.log(`[DASHBOARD ACTIVITIES]   ⏳ In-progress scans: ${inProgressScans.length}`);

      for (const scan of inProgressScans) {
        actionRequired.push({
          id: `scan-progress-${scan.id}`,
          type: 'panel_scan_in_progress',
          module: 'switchboard',
          title: '⏳ Scan IA en cours',
          description: `${scan.progress || 0}% - ${scan.message || 'Analyse en cours...'}`,
          actor: scan.user_email,
          timestamp: scan.created_at,
          url: `/app/switchboards?scanJobId=${scan.id}&switchboardId=${scan.switchboard_id}`,
          icon: '⏳',
          color: 'amber',
          actionRequired: true
        });
      }
    } catch (e) {
      console.log(`[DASHBOARD ACTIVITIES]   ❌ Panel scan query error: ${e.message}`);
    }

    // Sort by timestamp descending
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log(`[DASHBOARD ACTIVITIES] 📊 FINAL: ${activities.length} total activities, ${actionRequired.length} action_required`);
    console.log(`[DASHBOARD ACTIVITIES] 🏁 Returning ${Math.min(activities.length, limit)} recent items`);

    // Return structured response
    res.json({
      action_required: actionRequired,
      recent: activities.slice(0, limit)
    });

  } catch (err) {
    console.error("[dashboard/activities] Error:", err);
    res.status(500).json({ error: err.message, action_required: [], recent: [] });
  }
});

/* ================================================================
   🗑️ Delete specific activity / Clear all activities
   ================================================================ */

// Delete a specific activity (mainly for pending_reports and panel_scan_jobs)
app.delete("/api/dashboard/activities/:id", async (req, res) => {
  const { id } = req.params;
  console.log(`[DASHBOARD ACTIVITIES] 🗑️ Delete request for: ${id}`);

  try {
    // Parse the ID to determine source
    if (id.startsWith('report-pending-') || id.startsWith('report-')) {
      // It's a pending_reports entry
      const reportId = id.replace('report-pending-', '').replace('report-error-', '').replace('report-', '');
      await atexPool.query('DELETE FROM pending_reports WHERE id = $1', [reportId]);
      console.log(`[DASHBOARD ACTIVITIES] ✅ Deleted pending_report ${reportId}`);
    } else if (id.startsWith('scan-progress-') || id.startsWith('scan-')) {
      // It's a panel_scan_jobs entry
      const scanId = id.replace('scan-progress-', '').replace('scan-', '');
      await pool.query('DELETE FROM panel_scan_jobs WHERE id = $1', [scanId]);
      console.log(`[DASHBOARD ACTIVITIES] ✅ Deleted panel_scan_job ${scanId}`);
    } else {
      // For audit log entries, we don't delete (permanent records)
      // But we acknowledge the request
      console.log(`[DASHBOARD ACTIVITIES] ⚠️ Activity ${id} is from audit log, not deletable`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[dashboard/activities] Delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Clear all activities (delete ALL pending_reports and scan jobs)
app.delete("/api/dashboard/activities", async (req, res) => {
  console.log(`[DASHBOARD ACTIVITIES] 🗑️ Clear all activities request`);

  try {
    let deletedReports = 0;
    let deletedScans = 0;

    // Delete ALL pending_reports (user wants a clean slate)
    try {
      const result1 = await atexPool.query(`DELETE FROM pending_reports`);
      deletedReports = result1.rowCount || 0;
    } catch (e) {
      console.log('[DASHBOARD ACTIVITIES] pending_reports cleanup skipped:', e.message);
    }

    // Delete completed/failed panel_scan_jobs (keep in-progress ones)
    try {
      const result2 = await pool.query(`
        DELETE FROM panel_scan_jobs
        WHERE status IN ('completed', 'failed')
      `);
      deletedScans = result2.rowCount || 0;
    } catch (e) {
      console.log('[DASHBOARD ACTIVITIES] panel_scan_jobs cleanup skipped:', e.message);
    }

    console.log(`[DASHBOARD ACTIVITIES] ✅ Cleanup done: ${deletedReports} reports, ${deletedScans} scans`);
    res.json({ success: true, deleted: { reports: deletedReports, scans: deletedScans } });
  } catch (err) {
    console.error("[dashboard/activities] Clear error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   🔵 Save User Profile (department, site)
   ================================================================ */
app.put("/api/user/profile", express.json(), async (req, res) => {
  console.log(`[profile] 🔵 PUT /api/user/profile called`);
  console.log(`[profile] Body:`, req.body);
  console.log(`[profile] Cookies:`, req.cookies?.token ? 'present' : 'missing');
  console.log(`[profile] Auth header:`, req.headers.authorization ? 'present' : 'missing');

  try {
    // Get user from JWT token
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      console.log(`[profile] ❌ No token found`);
      return res.status(401).json({ error: "Not authenticated" });
    }

    const secret = process.env.JWT_SECRET || "devsecret";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr) {
      console.log(`[profile] ❌ JWT verify failed:`, jwtErr.message);
      return res.status(401).json({ error: "Invalid token: " + jwtErr.message });
    }

    const email = decoded.email;
    console.log(`[profile] 📧 Email from token: ${email}`);

    if (!email) {
      return res.status(401).json({ error: "Invalid token - no email" });
    }

    const { department_id, site_id } = req.body;
    console.log(`[profile] 📧 Updating user ${email}: department_id=${department_id}, site_id=${site_id}`);

    let dbUpdated = false;

    // Update haleon_users table (for @haleon.com users)
    if (email.toLowerCase().endsWith('@haleon.com')) {
      try {
        // Upsert into haleon_users
        await pool.query(`
          INSERT INTO haleon_users (email, department_id, site_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (email) DO UPDATE SET
            department_id = COALESCE($2, haleon_users.department_id),
            site_id = COALESCE($3, haleon_users.site_id),
            updated_at = NOW()
        `, [email.toLowerCase(), department_id, site_id || 1]);
        console.log(`[profile] ✅ Updated haleon_users for ${email}`);
        dbUpdated = true;
      } catch (haleonErr) {
        console.error(`[profile] ⚠️ haleon_users update failed:`, haleonErr.message);
        // Try alternate approach - just UPDATE if INSERT fails due to missing columns
        try {
          await pool.query(`
            UPDATE haleon_users SET
              department_id = COALESCE($2, department_id),
              site_id = COALESCE($3, site_id)
            WHERE LOWER(email) = LOWER($1)
          `, [email, department_id, site_id || 1]);
          console.log(`[profile] ✅ Updated haleon_users (UPDATE only) for ${email}`);
          dbUpdated = true;
        } catch (updateErr) {
          console.error(`[profile] ⚠️ haleon_users UPDATE also failed:`, updateErr.message);
        }
      }
    }

    // Also update users table if user exists there
    try {
      const result = await pool.query(`
        UPDATE users SET
          department_id = COALESCE($2, department_id),
          site_id = COALESCE($3, site_id),
          updated_at = NOW()
        WHERE LOWER(email) = LOWER($1)
        RETURNING id
      `, [email, department_id, site_id]);
      if (result.rowCount > 0) {
        console.log(`[profile] ✅ Updated users table for ${email}`);
        dbUpdated = true;
      }
    } catch (e) {
      console.log(`[profile] ⚠️ users table update skipped:`, e.message);
    }

    console.log(`[profile] DB updated: ${dbUpdated}`);

    // Generate a new JWT with updated info
    const newPayload = {
      ...decoded,
      department_id: department_id ?? decoded.department_id,
      site_id: site_id ?? decoded.site_id,
    };
    const newToken = jwt.sign(newPayload, secret, { expiresIn: "7d" });
    console.log(`[profile] ✅ New JWT generated with department_id=${newPayload.department_id}, site_id=${newPayload.site_id}`);

    // Set new cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", newToken, {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction
    });

    res.json({ ok: true, user: newPayload, jwt: newToken });
  } catch (err) {
    console.error("[profile] ❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   🔵 Public endpoints for departments and sites (for profile selection)
   Same queries as admin endpoints to ensure consistency
   ================================================================ */
app.get("/api/departments", async (req, res) => {
  try {
    // Use same query as admin endpoint for consistency
    const result = await pool.query(`
      SELECT d.id, d.code, d.name, d.company_id, d.site_id,
             c.name as company_name, s.name as site_name
      FROM departments d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN sites s ON d.site_id = s.id
      ORDER BY d.name ASC
    `);
    console.log(`[departments] Found ${result.rows.length} departments from DB`);
    res.json({ departments: result.rows });
  } catch (err) {
    console.error(`[departments] Error:`, err.message);
    // Return empty array - don't use fallback data with wrong IDs
    res.json({ departments: [], error: err.message });
  }
});

app.get("/api/sites", async (req, res) => {
  try {
    // Use same query as admin endpoint for consistency
    const result = await pool.query(`
      SELECT s.id, s.code, s.name, s.company_id, s.city, s.country,
             c.name as company_name
      FROM sites s
      LEFT JOIN companies c ON s.company_id = c.id
      ORDER BY s.name ASC
    `);
    console.log(`[sites] Found ${result.rows.length} sites from DB`);
    res.json({ sites: result.rows });
  } catch (err) {
    console.error(`[sites] Error:`, err.message);
    // Return empty array - don't use fallback data with wrong IDs
    res.json({ sites: [], error: err.message });
  }
});

/* ================================================================
   🔵 Admin API Routes (gestion utilisateurs, exploration DB)
   ================================================================ */
app.use("/api/admin", adminRouter);

/* ================================================================
   🔔 Push Notifications API Routes
   ================================================================ */
console.log('[Push] Mounting push router at /api/push');
app.use("/api/push", pushRouter);
console.log('[Push] Push router mounted');

// -------- Static ----------
const __dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const __public = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

// Serve PWA files (manifest.json, sw.js, icons) with appropriate caching
app.use(express.static(__public, {
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("sw.js")) {
      // Service worker should not be cached
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (filePath.endsWith("manifest.json")) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
  }
}));

// Serve hashed assets with long cache (immutable)
app.use("/assets", express.static(path.join(__dist, "assets"), {
  maxAge: "1y",
  immutable: true
}));

// Serve other static files with short cache
app.use(express.static(__dist, {
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    // Never cache index.html - always fetch fresh
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

// SPA fallback - serve index.html with no-cache headers
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(__dist, "index.html"));
});

// -------- Auto-init essential tables -----------
async function addColumnIfNotExists(table, column, definition) {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  } catch (err) {
    // Column might already exist or table doesn't exist
  }
}

async function initEssentialTables() {
  try {
    // Create companies table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT UNIQUE,
        logo BYTEA,
        logo_mime TEXT DEFAULT 'image/png',
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Switzerland',
        is_internal BOOLEAN DEFAULT FALSE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[init] ✅ Table companies vérifiée');

    // Create sites table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        code TEXT,
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Switzerland',
        timezone TEXT DEFAULT 'Europe/Zurich',
        is_active BOOLEAN DEFAULT TRUE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add missing columns to sites
    await addColumnIfNotExists('sites', 'company_id', 'INTEGER');
    await addColumnIfNotExists('sites', 'code', 'TEXT');
    await addColumnIfNotExists('sites', 'address', 'TEXT');
    await addColumnIfNotExists('sites', 'city', 'TEXT');
    await addColumnIfNotExists('sites', 'country', "TEXT DEFAULT 'Switzerland'");
    await addColumnIfNotExists('sites', 'timezone', "TEXT DEFAULT 'Europe/Zurich'");
    await addColumnIfNotExists('sites', 'is_active', 'BOOLEAN DEFAULT TRUE');
    await addColumnIfNotExists('sites', 'settings', "JSONB DEFAULT '{}'::jsonb");
    console.log('[init] ✅ Table sites vérifiée + colonnes ajoutées');

    // Create departments table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        site_id INTEGER,
        code TEXT,
        name TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add missing columns to departments
    await addColumnIfNotExists('departments', 'company_id', 'INTEGER');
    await addColumnIfNotExists('departments', 'site_id', 'INTEGER');
    await addColumnIfNotExists('departments', 'code', 'TEXT');
    await addColumnIfNotExists('departments', 'description', 'TEXT');
    await addColumnIfNotExists('departments', 'is_active', 'BOOLEAN DEFAULT TRUE');
    console.log('[init] ✅ Table departments vérifiée + colonnes ajoutées');

  } catch (err) {
    console.error('[init] ⚠️ Error creating essential tables:', err.message);
  }
}

// -------- Start -----------
const port = process.env.PORT || 3000;
initEssentialTables().then(() => {
  app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
});
