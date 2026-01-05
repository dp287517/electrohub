/**
 * ============================================================================
 * ELECTROHUB AI CHAT V2 - Function Calling Architecture
 * ============================================================================
 *
 * Ce module implémente le nouveau système de chat IA avec Function Calling.
 * Il remplace progressivement la logique basée sur les regex.
 *
 * Architecture:
 * 1. L'utilisateur envoie un message
 * 2. OpenAI analyse le message et décide d'utiliser des tools si nécessaire
 * 3. Les tools sont exécutés et les résultats renvoyés à OpenAI
 * 4. OpenAI génère la réponse finale avec les données réelles
 */

import OpenAI from 'openai';
import express from 'express';
import {
  TOOLS_DEFINITIONS,
  SIMPLIFIED_SYSTEM_PROMPT,
  createToolHandlers,
  executeToolCalls
} from './server_ai_tools.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ITERATIONS = 3; // Limite de boucles tool calling
const MAX_CONVERSATION_HISTORY = 10; // Messages à garder

// ============================================================================
// CHAT V2 HANDLER
// ============================================================================

/**
 * Crée le router Express pour le chat v2
 */
function createChatV2Router(pool) {
  const router = express.Router();

  // Initialiser OpenAI
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  /**
   * POST /api/ai-assistant/chat-v2
   * Nouveau endpoint de chat avec function calling
   */
  router.post('/chat-v2', async (req, res) => {
    try {
      const {
        message,
        conversationHistory = [],
        context: clientContext = {}
      } = req.body;

      const site = req.header('X-Site') || clientContext?.user?.site || process.env.DEFAULT_SITE || 'Nyon';
      const userEmail = clientContext?.user?.email || 'anonymous';

      if (!message) {
        return res.status(400).json({ error: 'Message requis' });
      }

      console.log(`[CHAT-V2] 🚀 Message: "${message.substring(0, 80)}..." | Site: ${site}`);

      // Créer les handlers de tools avec le contexte
      const toolHandlers = createToolHandlers(pool, site);

      // Préparer les messages pour OpenAI
      const messages = [
        { role: 'system', content: buildSystemPrompt(site, clientContext) },
        ...formatConversationHistory(conversationHistory),
        { role: 'user', content: message }
      ];

      // Appel initial à OpenAI avec les tools
      let response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        tools: TOOLS_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 2000
      });

      let assistantMessage = response.choices[0].message;
      let toolResults = [];
      let frontendInstructions = {};
      let iterations = 0;

      // Boucle de function calling
      while (assistantMessage.tool_calls && iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        console.log(`[CHAT-V2] 🔧 Tool calls iteration ${iterations}:`,
          assistantMessage.tool_calls.map(tc => tc.function.name).join(', '));

        // Exécuter les tools
        const results = await executeToolCalls(assistantMessage.tool_calls, toolHandlers);
        toolResults.push(...results);

        // Collecter les instructions frontend
        results.forEach(result => {
          if (result.frontend_instruction) {
            frontendInstructions = { ...frontendInstructions, ...result.frontend_instruction };
          }
        });

        // Préparer les messages avec les résultats des tools
        const toolMessages = results.map(result => ({
          role: 'tool',
          tool_call_id: result.tool_call_id,
          content: JSON.stringify({
            success: result.success,
            ...result,
            tool_call_id: undefined // Ne pas inclure dans le content
          })
        }));

        // Ré-appeler OpenAI avec les résultats
        messages.push(assistantMessage);
        messages.push(...toolMessages);

        response = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages,
          tools: TOOLS_DEFINITIONS,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 2000
        });

        assistantMessage = response.choices[0].message;
      }

      // Extraire le contenu final
      const finalContent = assistantMessage.content || 'Désolé, je n\'ai pas pu générer de réponse.';

      // Construire la réponse
      const chatResponse = {
        message: finalContent,
        provider: 'openai',
        model: OPENAI_MODEL,
        tools_used: toolResults.map(r => ({
          name: r.tool_call_id?.split('_')[0] || 'unknown',
          success: r.success
        })),
        // Instructions frontend (modals, maps, etc.)
        ...frontendInstructions,
        // Actions suggérées
        actions: extractSuggestedActions(finalContent, toolResults)
      };

      // Ajouter les données spécifiques des tools
      toolResults.forEach(result => {
        if (result.procedures?.length > 0) {
          chatResponse.proceduresFound = result.procedures;
        }
        if (result.records?.length > 0) {
          chatResponse.troubleshootingRecords = result.records;
        }
        if (result.equipment?.length > 0) {
          chatResponse.equipmentList = result.equipment;
        }
        if (result.controls?.length > 0) {
          chatResponse.controlsList = result.controls;
        }
        if (result.non_conformities?.length > 0) {
          chatResponse.ncList = result.non_conformities;
        }
        if (result.chart) {
          chatResponse.chart = result.chart;
        }
        if (result.procedure) {
          chatResponse.procedureDetails = result.procedure;
        }
      });

      console.log(`[CHAT-V2] ✅ Response generated | Tools used: ${toolResults.length}`);

      res.json(chatResponse);

    } catch (error) {
      console.error('[CHAT-V2] ❌ Error:', error.message);

      // Fallback response
      res.json({
        message: `Désolé, une erreur s'est produite: ${error.message}. Peux-tu reformuler ta demande ?`,
        provider: 'system',
        error: true,
        actions: [
          { label: '🔄 Réessayer', prompt: req.body?.message },
          { label: '❓ Aide', prompt: 'Qu\'est-ce que tu peux faire ?' }
        ]
      });
    }
  });

  /**
   * POST /api/ai-assistant/chat-v2/with-photo
   * Chat avec analyse de photo
   */
  router.post('/chat-v2/with-photo', async (req, res) => {
    // TODO: Implémenter l'analyse de photo avec vision
    res.status(501).json({ error: 'Photo analysis not yet implemented in v2' });
  });

  /**
   * GET /api/ai-assistant/chat-v2/health
   * Health check du service v2
   */
  router.get('/chat-v2/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '2.0',
      features: {
        function_calling: true,
        tools_count: TOOLS_DEFINITIONS.length,
        model: OPENAI_MODEL
      }
    });
  });

  return router;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Construit le prompt système avec le contexte minimal
 */
function buildSystemPrompt(site, clientContext) {
  let prompt = SIMPLIFIED_SYSTEM_PROMPT;

  // Ajouter le contexte utilisateur
  if (clientContext?.user) {
    prompt += `\n\n## CONTEXTE UTILISATEUR
- Site: ${site}
- Utilisateur: ${clientContext.user.name || clientContext.user.email || 'Technicien'}`;
  }

  // Ajouter un résumé minimal du contexte si disponible
  if (clientContext?.summary) {
    prompt += `\n\n## RÉSUMÉ DU SITE
- Équipements: ${clientContext.summary.totalEquipments || 'N/A'}
- Contrôles en retard: ${clientContext.summary.overdueControls || 0}
- Contrôles à venir: ${clientContext.summary.upcomingControls || 0}`;
  }

  // Date et heure
  const now = new Date();
  const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  prompt += `\n\n## DATE ET HEURE
Aujourd'hui: ${dayNames[now.getDay()]} ${now.toLocaleDateString('fr-FR')} - ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

  return prompt;
}

/**
 * Formate l'historique de conversation pour OpenAI
 */
function formatConversationHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_CONVERSATION_HISTORY)
    .filter(msg => msg.role && msg.content)
    .map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }));
}

/**
 * Extrait des actions suggérées de la réponse
 */
function extractSuggestedActions(content, toolResults) {
  const actions = [];

  // Actions basées sur les tools utilisés
  toolResults.forEach(result => {
    if (result.procedures?.length > 0) {
      const proc = result.procedures[0];
      actions.push({
        label: `📋 Voir "${proc.title?.substring(0, 20)}..."`,
        prompt: `Ouvre la procédure "${proc.title}"`
      });
      if (result.procedures.length > 1) {
        actions.push({
          label: '📂 Voir toutes les procédures',
          prompt: 'Liste toutes les procédures trouvées'
        });
      }
    }

    if (result.records?.length > 0) {
      actions.push({
        label: '📊 Plus de détails',
        prompt: 'Donne-moi plus de détails sur ces dépannages'
      });
    }

    if (result.controls?.length > 0) {
      actions.push({
        label: '🗺️ Voir sur la carte',
        prompt: 'Montre ces équipements sur la carte'
      });
    }

    if (result.equipment?.length > 0) {
      const eq = result.equipment[0];
      actions.push({
        label: `📍 Localiser ${eq.name?.substring(0, 15)}`,
        prompt: `Montre-moi ${eq.name} sur la carte`
      });
    }
  });

  // Actions par défaut si aucune action spécifique
  if (actions.length === 0) {
    // Analyser le contenu pour suggérer des actions pertinentes
    const contentLower = content.toLowerCase();

    if (contentLower.includes('procédure') || contentLower.includes('procedure')) {
      actions.push({ label: '🔍 Chercher une procédure', prompt: 'Liste les procédures disponibles' });
    }
    if (contentLower.includes('contrôle') || contentLower.includes('retard')) {
      actions.push({ label: '⏰ Contrôles en retard', prompt: 'Quels sont les contrôles en retard ?' });
    }
    if (contentLower.includes('dépannage') || contentLower.includes('panne')) {
      actions.push({ label: '🔧 Derniers dépannages', prompt: 'Montre-moi les derniers dépannages' });
    }
  }

  // Limiter à 4 actions
  return actions.slice(0, 4);
}

// ============================================================================
// INTEGRATION WITH EXISTING CHAT (Progressive Migration)
// ============================================================================

/**
 * Middleware pour router vers v2 ou v1 selon les flags
 */
function createChatRouter(pool, useV2 = false) {
  const router = express.Router();

  // Toujours exposer v2
  const v2Router = createChatV2Router(pool);
  router.use('/', v2Router);

  // Si useV2 est true, rediriger /chat vers /chat-v2
  if (useV2) {
    router.post('/chat', (req, res, next) => {
      // Rediriger vers v2
      req.url = '/chat-v2';
      next();
    });
  }

  return router;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  createChatV2Router,
  createChatRouter,
  buildSystemPrompt,
  formatConversationHistory,
  extractSuggestedActions
};
