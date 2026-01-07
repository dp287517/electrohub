/**
 * ============================================================================
 * ELECTROHUB AI CHAT V2 - Enhanced Function Calling Architecture
 * ============================================================================
 *
 * Ce module implémente le système de chat IA avec Function Calling amélioré.
 *
 * Améliorations V2.1:
 * - Retry avec exponential backoff sur les appels LLM
 * - MAX_TOOL_ITERATIONS augmenté (5 itérations)
 * - Validation robuste des inputs
 * - Streaming SSE pour les réponses longues
 * - Métriques et logging avancé
 * - Système de handoff amélioré entre agents
 * - Support complet des procédures avec guidage
 * - Feedback utilisateur intégré
 *
 * Architecture:
 * 1. L'utilisateur envoie un message
 * 2. OpenAI analyse le message et décide d'utiliser des tools si nécessaire
 * 3. Les tools sont exécutés avec retry automatique
 * 4. OpenAI génère la réponse finale avec les données réelles
 * 5. Métriques collectées pour monitoring
 *
 * Fallback: Si OpenAI échoue (quota épuisé), bascule automatiquement sur Gemini
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// Configuration améliorée V2.1
const MAX_TOOL_ITERATIONS = 5; // Augmenté de 3 à 5 pour requêtes complexes
const MAX_CONVERSATION_HISTORY = 15; // Augmenté pour meilleur contexte
const MAX_RETRIES = 3; // Nombre de retry sur erreurs transitoires
const RETRY_BASE_DELAY_MS = 1000; // Délai de base pour exponential backoff

// ============================================================================
// MÉTRIQUES & LOGGING
// ============================================================================

const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  openaiCalls: 0,
  geminiFallbacks: 0,
  toolExecutions: 0,
  avgResponseTimeMs: 0,
  responseTimes: [],
  agentUsage: {},
  toolUsage: {},
  errors: []
};

function recordMetric(type, data = {}) {
  const timestamp = new Date().toISOString();

  switch(type) {
    case 'request_start':
      metrics.totalRequests++;
      break;
    case 'request_success':
      metrics.successfulRequests++;
      if (data.responseTimeMs) {
        metrics.responseTimes.push(data.responseTimeMs);
        if (metrics.responseTimes.length > 100) metrics.responseTimes.shift();
        metrics.avgResponseTimeMs = Math.round(
          metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
        );
      }
      break;
    case 'request_failure':
      metrics.failedRequests++;
      metrics.errors.push({ timestamp, error: data.error?.substring(0, 200) });
      if (metrics.errors.length > 50) metrics.errors.shift();
      break;
    case 'openai_call':
      metrics.openaiCalls++;
      break;
    case 'gemini_fallback':
      metrics.geminiFallbacks++;
      break;
    case 'tool_execution':
      metrics.toolExecutions++;
      const toolName = data.tool || 'unknown';
      metrics.toolUsage[toolName] = (metrics.toolUsage[toolName] || 0) + 1;
      break;
    case 'agent_used':
      const agent = data.agent || 'main';
      metrics.agentUsage[agent] = (metrics.agentUsage[agent] || 0) + 1;
      break;
  }
}

function log(level, context, message, data = {}) {
  const timestamp = new Date().toISOString();
  const emoji = { info: '📘', warn: '⚠️', error: '❌', success: '✅', debug: '🔍' }[level] || '📝';
  const logData = Object.keys(data).length > 0 ? ` | ${JSON.stringify(data)}` : '';
  console.log(`[${timestamp}] ${emoji} [CHAT-V2:${context}] ${message}${logData}`);
}

// ============================================================================
// RETRY LOGIC AVEC EXPONENTIAL BACKOFF
// ============================================================================

/**
 * Vérifie si l'erreur est liée au quota/rate limit
 */
function isQuotaError(error) {
  const msg = error?.message || '';
  return (
    error?.status === 429 ||
    error?.code === 'insufficient_quota' ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('Rate limit')
  );
}

/**
 * Vérifie si l'erreur est transitoire (retry possible)
 */
function isRetryableError(error) {
  const msg = error?.message || '';
  const status = error?.status || error?.response?.status;

  // Erreurs réseau/timeout
  if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
    return true;
  }

  // Erreurs serveur (500+)
  if (status >= 500) return true;

  // Rate limit (429) - retry avec backoff
  if (status === 429) return true;

  return false;
}

/**
 * Exécute une fonction avec retry et exponential backoff
 */
async function withRetry(fn, context, maxRetries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      log('warn', context, `Retry ${attempt}/${maxRetries} après erreur`, {
        error: error.message?.substring(0, 100),
        delayMs: delay
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================================
// VALIDATION DES INPUTS
// ============================================================================

/**
 * Valide et nettoie les inputs de la requête chat
 */
function validateChatInput(body) {
  const errors = [];

  // Message requis
  if (!body.message || typeof body.message !== 'string') {
    errors.push('Message requis et doit être une chaîne de caractères');
  } else if (body.message.length > 10000) {
    errors.push('Message trop long (max 10000 caractères)');
  }

  // Conversation history
  if (body.conversationHistory && !Array.isArray(body.conversationHistory)) {
    errors.push('conversationHistory doit être un tableau');
  }

  // Context
  if (body.context && typeof body.context !== 'object') {
    errors.push('context doit être un objet');
  }

  // Sanitize message
  const sanitizedMessage = body.message?.trim().substring(0, 10000) || '';

  // Sanitize conversation history
  const sanitizedHistory = Array.isArray(body.conversationHistory)
    ? body.conversationHistory
        .filter(msg => msg && msg.role && msg.content)
        .slice(-MAX_CONVERSATION_HISTORY)
        .map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: typeof msg.content === 'string' ? msg.content.substring(0, 5000) : ''
        }))
    : [];

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      message: sanitizedMessage,
      conversationHistory: sanitizedHistory,
      context: body.context || {}
    }
  };
}

// ============================================================================
// AGENTS IA - Configuration complète
// ============================================================================

const AGENTS_INFO = {
  main: {
    name: 'Electro',
    description: 'Assistant principal ElectroHub - orchestrateur',
    emoji: '⚡',
    expertise: ['vue globale', 'coordination', 'questions générales'],
    welcomeMessage: "Salut ! Je suis Electro, ton assistant IA principal. Je peux t'aider ou te passer à un spécialiste."
  },
  vsd: {
    name: 'Shakira',
    description: 'Spécialiste des variateurs de fréquence',
    emoji: '🎛️',
    expertise: ['variateurs', 'VFD', 'drives', 'paramétrage', 'codes erreur'],
    welcomeMessage: "Hey ! Shakira à ton service pour tout ce qui touche aux variateurs !"
  },
  meca: {
    name: 'Titan',
    description: 'Expert en équipements mécaniques',
    emoji: '⚙️',
    expertise: ['moteurs', 'pompes', 'compresseurs', 'ventilateurs', 'maintenance mécanique'],
    welcomeMessage: "Titan ici ! Les équipements mécaniques, c'est mon domaine."
  },
  glo: {
    name: 'Lumina',
    description: 'Spécialiste éclairage de sécurité',
    emoji: '💡',
    expertise: ['BAES', 'éclairage secours', 'blocs autonomes', 'tests d\'autonomie'],
    welcomeMessage: "Lumina pour vous éclairer sur tout ce qui est éclairage de sécurité !"
  },
  hv: {
    name: 'Voltaire',
    description: 'Expert haute tension',
    emoji: '⚡',
    expertise: ['transformateurs', 'cellules HT', 'postes de transformation', 'consignation'],
    welcomeMessage: "Voltaire, expert haute tension. Je gère les gros calibres !"
  },
  mobile: {
    name: 'Nomad',
    description: 'Spécialiste équipements mobiles',
    emoji: '📱',
    expertise: ['équipements portables', 'outillage mobile', 'chariots', 'vérifications'],
    welcomeMessage: "Nomad ici ! Je m'occupe de tout ce qui bouge."
  },
  atex: {
    name: 'Phoenix',
    description: 'Expert zones ATEX et explosives',
    emoji: '🔥',
    expertise: ['zones ATEX', 'atmosphères explosives', 'DRPCE', 'certification Ex'],
    welcomeMessage: "Phoenix à l'écoute. Les zones ATEX n'ont pas de secret pour moi."
  },
  switchboard: {
    name: 'Matrix',
    description: 'Spécialiste tableaux électriques',
    emoji: '🔌',
    expertise: ['TGBT', 'tableaux divisionnaires', 'armoires', 'distribution'],
    welcomeMessage: "Matrix connecté ! Je gère tous les tableaux électriques."
  },
  doors: {
    name: 'Portal',
    description: 'Expert portes et accès',
    emoji: '🚪',
    expertise: ['portes', 'accès', 'sorties secours', 'contrôle d\'accès'],
    welcomeMessage: "Portal à votre service pour toutes les questions de portes et accès."
  },
  datahub: {
    name: 'Nexus',
    description: 'Spécialiste capteurs et monitoring',
    emoji: '📊',
    expertise: ['capteurs', 'IoT', 'monitoring', 'télémétrie', 'données temps réel'],
    welcomeMessage: "Nexus en ligne ! Je surveille tous vos capteurs."
  },
  firecontrol: {
    name: 'Blaze',
    description: 'Expert sécurité incendie',
    emoji: '🧯',
    expertise: ['détection incendie', 'sprinklers', 'extincteurs', 'désenfumage', 'SSI'],
    welcomeMessage: "Blaze présent ! La sécurité incendie, c'est ma spécialité."
  }
};

// Cache pour les noms d'agents personnalisés
let customAgentNamesCache = null;
let customAgentNamesCacheTime = 0;
const CACHE_TTL = 300000; // 5 minutes (augmenté)

/**
 * Charge les noms d'agents personnalisés depuis la DB
 */
async function loadCustomAgentNames(pool) {
  if (customAgentNamesCache && Date.now() - customAgentNamesCacheTime < CACHE_TTL) {
    return customAgentNamesCache;
  }

  try {
    const result = await pool.query(
      `SELECT key, text_value FROM app_settings WHERE key LIKE 'ai_agent_name_%'`
    );

    const customNames = {};
    result.rows.forEach(row => {
      const agentType = row.key.replace('ai_agent_name_', '');
      if (row.text_value) {
        customNames[agentType] = row.text_value;
      }
    });

    customAgentNamesCache = customNames;
    customAgentNamesCacheTime = Date.now();
    log('debug', 'CACHE', 'Custom agent names loaded', { count: Object.keys(customNames).length });
    return customNames;
  } catch (err) {
    log('warn', 'CACHE', 'Error loading custom agent names', { error: err.message });
    return {};
  }
}

/**
 * Obtient les infos d'un agent avec nom personnalisé si disponible
 */
function getAgentInfo(agentType, customNames = {}) {
  const defaultInfo = AGENTS_INFO[agentType] || AGENTS_INFO.main;
  return {
    ...defaultInfo,
    type: agentType,
    name: customNames[agentType] || defaultInfo.name
  };
}

// ============================================================================
// SYSTÈME DE HANDOFF AMÉLIORÉ
// ============================================================================

/**
 * Génère un message de passage de relais personnalisé entre agents
 */
function generateHandoffMessage(fromAgent, toAgent, context = '') {
  if (!fromAgent || !toAgent) return null;
  if (fromAgent.type === toAgent.type) return null;

  const transitions = [
    {
      template: (from, to) =>
        `${from.emoji} *${from.name}*: Cette question est pour ${to.name}, je te le/la passe !\n\n${to.emoji} **${to.name}**: ${to.welcomeMessage}`,
      weight: 3
    },
    {
      template: (from, to) =>
        `${from.emoji} *${from.name}*: Ah, ça c'est le domaine de ${to.name} ! À toi ${to.name} !\n\n${to.emoji} **${to.name}**: Merci ${from.name} ! `,
      weight: 2
    },
    {
      template: (from, to) =>
        `${from.emoji} *${from.name}*: Je passe le relais à ${to.name}, c'est sa spécialité.\n\n${to.emoji} **${to.name}**: Salut ! `,
      weight: 2
    },
    {
      template: (from, to) =>
        `*[Transfert vers ${to.name}]*\n\n${to.emoji} **${to.name}**: `,
      weight: 1
    }
  ];

  // Sélection pondérée aléatoire
  const totalWeight = transitions.reduce((sum, t) => sum + t.weight, 0);
  let random = Math.random() * totalWeight;

  for (const transition of transitions) {
    random -= transition.weight;
    if (random <= 0) {
      return transition.template(fromAgent, toAgent);
    }
  }

  return transitions[0].template(fromAgent, toAgent);
}

/**
 * Détecte l'agent IA approprié basé sur le message et les tools utilisés
 */
function detectAgentType(message, toolResults, previousAgent = 'main', currentEquipment = null) {
  const messageLower = message.toLowerCase();

  // Si on a un équipement en contexte, utiliser son agent
  if (currentEquipment?.type) {
    const eqType = currentEquipment.type.toLowerCase();
    const typeToAgent = {
      'vsd': 'vsd',
      'meca': 'meca',
      'glo': 'glo',
      'hv': 'hv',
      'mobile': 'mobile',
      'atex': 'atex',
      'switchboard': 'switchboard',
      'door': 'doors',
      'datahub': 'datahub',
      'fire': 'firecontrol'
    };
    if (typeToAgent[eqType]) {
      return typeToAgent[eqType];
    }
  }

  // Patterns de détection améliorés
  const agentPatterns = {
    vsd: {
      keywords: ['vsd', 'variateur', 'variateurs', 'frequency drive', 'convertisseur de fréquence', 'vfd', 'drive', 'drives', 'altivar', 'powerflex', 'micromaster'],
      tools: ['search_vsd', 'get_vsd_details'],
      equipmentTypes: ['vsd']
    },
    meca: {
      keywords: ['meca', 'mécanique', 'mecanique', 'moteur', 'pompe', 'compresseur', 'ventilateur', 'agitateur', 'convoyeur', 'réducteur', 'palier', 'roulement'],
      tools: ['search_meca', 'get_meca_details'],
      equipmentTypes: ['meca']
    },
    glo: {
      keywords: ['glo', 'éclairage', 'eclairage', 'luminaire', 'baes', 'blocs autonomes', 'éclairage de sécurité', 'secours', 'autonomie'],
      tools: ['search_glo', 'get_glo_details'],
      equipmentTypes: ['glo']
    },
    hv: {
      keywords: ['hv', 'haute tension', 'ht', 'high voltage', 'transformateur', 'cellule ht', 'poste de transformation', 'consignation', '20kv', '15kv'],
      tools: ['search_hv', 'get_hv_details'],
      equipmentTypes: ['hv']
    },
    mobile: {
      keywords: ['mobile', 'équipement mobile', 'portable', 'appareil mobile', 'outillage mobile', 'chariot', 'perceuse', 'meuleuse'],
      tools: ['search_mobile', 'get_mobile_details'],
      equipmentTypes: ['mobile']
    },
    atex: {
      keywords: ['atex', 'zone atex', 'explosion', 'explosif', 'zone ex', 'atmosphère explosive', 'drpce', 'zone 0', 'zone 1', 'zone 2'],
      tools: ['search_atex', 'get_atex_details'],
      equipmentTypes: ['atex']
    },
    switchboard: {
      keywords: ['tableau', 'tableaux', 'armoire', 'switchboard', 'coffret', 'tgbt', 'td', 'tableau électrique', 'switchgear', 'disjoncteur'],
      tools: ['search_switchboard', 'get_switchboard_details'],
      equipmentTypes: ['switchboard']
    },
    doors: {
      keywords: ['porte', 'portes', 'door', 'accès', 'entrée', 'sortie secours', 'issue', 'coupe-feu'],
      tools: ['search_doors', 'get_doors_details'],
      equipmentTypes: ['doors', 'fire_doors', 'door']
    },
    datahub: {
      keywords: ['datahub', 'data hub', 'capteur', 'capteurs', 'sensor', 'monitoring', 'mesure', 'télémétrie', 'iot'],
      tools: ['search_datahub', 'get_datahub_details'],
      equipmentTypes: ['datahub']
    },
    firecontrol: {
      keywords: ['incendie', 'fire', 'détection incendie', 'sprinkler', 'extincteur', 'alarme incendie', 'ssi', 'désenfumage', 'ria'],
      tools: ['search_fire_control', 'get_fire_control_details'],
      equipmentTypes: ['firecontrol', 'fire']
    }
  };

  // 1. Vérifier les tools utilisés avec search_equipment
  const searchEquipmentResult = toolResults.find(r =>
    r.success && (r.toolName === 'search_equipment' || r.tool_call_id?.includes('search_equipment'))
  );

  if (searchEquipmentResult?.args?.equipment_type) {
    const eqType = searchEquipmentResult.args.equipment_type.toLowerCase();
    for (const [agentType, config] of Object.entries(agentPatterns)) {
      if (config.equipmentTypes?.includes(eqType)) {
        log('debug', 'AGENT', `Detected from search_equipment: ${agentType}`);
        return agentType;
      }
    }
  }

  // 2. Vérifier les tools spécifiques utilisés
  const toolsUsed = toolResults
    .filter(r => r.success)
    .map(r => r.toolName || r.tool_call_id?.split('_call_')?.[0] || '');

  for (const [agentType, config] of Object.entries(agentPatterns)) {
    if (config.tools.some(tool => toolsUsed.includes(tool))) {
      log('debug', 'AGENT', `Detected from tool usage: ${agentType}`);
      return agentType;
    }
  }

  // 3. Chercher les mots-clés dans le message
  for (const [agentType, config] of Object.entries(agentPatterns)) {
    const matchedKeyword = config.keywords.find(keyword => messageLower.includes(keyword));
    if (matchedKeyword) {
      log('debug', 'AGENT', `Detected from keyword "${matchedKeyword}": ${agentType}`);
      return agentType;
    }
  }

  // 4. Garder l'agent précédent si conversation en cours
  const returnToMainKeywords = ['electro', 'retour', 'autre chose', 'autre sujet', 'merci', 'au revoir', 'bye', 'salut'];
  const wantsToReturn = returnToMainKeywords.some(k => messageLower.includes(k) && messageLower.length < 50);

  if (previousAgent && previousAgent !== 'main' && !wantsToReturn) {
    log('debug', 'AGENT', `Keeping previous agent: ${previousAgent}`);
    return previousAgent;
  }

  log('debug', 'AGENT', 'Using main agent (default)');
  return 'main';
}

// ============================================================================
// SYSTÈME PROMPT AMÉLIORÉ
// ============================================================================

/**
 * Construit le prompt système enrichi avec le contexte
 */
function buildSystemPrompt(site, clientContext, customAgentNames = {}) {
  let prompt = SIMPLIFIED_SYSTEM_PROMPT;

  // Construire la liste des agents avec noms personnalisés
  const agentNames = {};
  for (const [type, info] of Object.entries(AGENTS_INFO)) {
    agentNames[type] = customAgentNames[type] || info.name;
  }

  // Section équipe d'agents
  prompt += `\n\n## ÉQUIPE D'AGENTS IA ELECTROHUB

Tu fais partie d'une équipe d'agents IA spécialisés. Voici tes collègues:
${Object.entries(AGENTS_INFO).map(([type, info]) =>
  `- ${info.emoji} **${agentNames[type]}** (${type}): ${info.description}`
).join('\n')}

**IMPORTANT**: Les utilisateurs peuvent te demander de parler à un agent par son nom.
Si l'utilisateur dit "passe-moi ${agentNames.doors}" ou "je veux parler à ${agentNames.vsd}", utilise la fonction **transfer_to_agent** avec le type correspondant.

Quand une question concerne un domaine spécifique, le système te passera automatiquement au spécialiste approprié.

## ⚠️ ACCÈS AUX CONTRÔLES POUR TOUS LES AGENTS
**IMPORTANT**: Tous les contrôles sont centralisés dans "Switchboard Controls".
En tant qu'agent spécialisé (VSD, mobile, meca, etc.), tu peux et DOIS utiliser la fonction **get_controls** pour répondre aux questions sur:
- L'état des contrôles (en retard, à venir, planifiés)
- Les échéances de maintenance
- Le planning de contrôles

## CAPACITÉS AVANCÉES
Tu peux:
- Rechercher des dépannages et analyser leur historique
- Trouver les équipements les plus problématiques
- Comparer la fiabilité entre équipements ou bâtiments
- Identifier les priorités de maintenance
- Rechercher et ouvrir des procédures
- Guider l'utilisateur étape par étape dans une procédure
- Mémoriser des insights pour améliorer tes réponses futures`;

  // Contexte utilisateur
  if (clientContext?.user) {
    prompt += `\n\n## CONTEXTE UTILISATEUR
- Site: ${site}
- Utilisateur: ${clientContext.user.name || clientContext.user.email || 'Technicien'}
- Rôle: ${clientContext.user.role || 'N/A'}`;
  }

  // Contexte équipement courant (depuis MiniElectro)
  if (clientContext?.currentEquipment) {
    const eq = clientContext.currentEquipment;
    prompt += `\n\n## ⚠️ ÉQUIPEMENT EN COURS DE CONSULTATION
**L'utilisateur est actuellement sur la fiche de cet équipement. Toutes les questions concernent CET équipement.**

- **Nom**: ${eq.name || eq.code || 'N/A'}
- **Code**: ${eq.code || 'N/A'}
- **Type**: ${eq.type || 'N/A'}
- **ID**: ${eq.id || 'N/A'}
- **Bâtiment**: ${eq.building || 'N/A'}
- **Étage**: ${eq.floor || 'N/A'}
- **Zone**: ${eq.zone || 'N/A'}
- **Localisation**: ${eq.location || 'N/A'}
- **Fabricant**: ${eq.manufacturer || 'N/A'}
- **Modèle**: ${eq.model || 'N/A'}
- **N° série**: ${eq.serialNumber || 'N/A'}
- **Puissance**: ${eq.power || 'N/A'}
- **Statut contrôle**: ${eq.status || 'N/A'}
- **Dernier contrôle**: ${eq.lastControl || 'N/A'}

**INSTRUCTIONS**: Utilise les fonctions appropriées avec les infos ci-dessus.
- **search_troubleshooting** avec equipment_name="${eq.name}" pour l'historique des pannes
${eq.type === 'doors' || eq.type === 'door' || (eq.name && eq.name.toLowerCase().includes('porte'))
  ? `- **get_controls** avec equipment_type="doors", equipment_name="${eq.name}" et filter="last" pour le dernier contrôle de cette porte
- **get_controls** avec equipment_type="doors", equipment_name="${eq.name}" et filter="history" pour l'historique des contrôles`
  : `- **get_controls** avec building="${eq.building}" pour les contrôles`}
- **get_non_conformities** pour les NC associées`;
  }

  // Résumé du contexte
  if (clientContext?.summary) {
    prompt += `\n\n## RÉSUMÉ DU SITE
- Équipements: ${clientContext.summary.totalEquipments || 'N/A'}
- Contrôles en retard: ${clientContext.summary.overdueControls || 0}
- Contrôles à venir: ${clientContext.summary.upcomingControls || 0}
- Bâtiments: ${clientContext.summary.buildingCount || 'N/A'}`;
  }

  // Date et heure
  const now = new Date();
  const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  prompt += `\n\n## DATE ET HEURE
Aujourd'hui: ${dayNames[now.getDay()]} ${now.toLocaleDateString('fr-FR')} - ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

  // Instructions de formatage
  prompt += `\n\n## FORMAT DES RÉPONSES
- Sois concis mais complet
- Utilise des emojis pour la clarté visuelle
- Structure avec des titres en **gras** et des listes
- Propose toujours des actions de suivi pertinentes
- Si tu ne sais pas, dis-le et propose d'utiliser un outil pour chercher`;

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

// ============================================================================
// CHAT V2 ROUTER
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

  // Initialiser Gemini (fallback)
  const gemini = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

  /**
   * Convertit les messages OpenAI vers le format Gemini
   */
  function convertToGeminiMessages(messages) {
    let systemPrompt = '';
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
        continue;
      }
      if (msg.role === 'tool') continue;

      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: msg.content || '' }] });
    }

    return { systemPrompt, contents };
  }

  /**
   * Appelle Gemini comme fallback
   */
  async function callGeminiFallback(messages, options = {}) {
    if (!gemini) throw new Error('GEMINI_API_KEY not configured');

    const model = gemini.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens ?? 2000,
      },
    });

    const { systemPrompt, contents } = convertToGeminiMessages(messages);

    if (systemPrompt && contents.length > 0) {
      const firstUserIdx = contents.findIndex(c => c.role === 'user');
      if (firstUserIdx >= 0 && contents[firstUserIdx].parts[0]?.text) {
        contents[firstUserIdx].parts[0].text =
          `[Instructions système]\n${systemPrompt}\n\n[Message utilisateur]\n${contents[firstUserIdx].parts[0].text}`;
      }
    }

    const result = await model.generateContent({ contents });
    const text = result.response.text();

    return {
      choices: [{
        message: {
          role: 'assistant',
          content: text,
          tool_calls: null
        }
      }]
    };
  }

  /**
   * Appelle OpenAI avec retry
   */
  async function callOpenAIWithRetry(params) {
    return withRetry(
      async () => {
        recordMetric('openai_call');
        return await openai.chat.completions.create(params);
      },
      'OPENAI'
    );
  }

  // =========================================================================
  // POST /api/ai-assistant/chat-v2
  // =========================================================================
  router.post('/chat-v2', async (req, res) => {
    const startTime = Date.now();
    recordMetric('request_start');

    try {
      // Validation des inputs
      const validation = validateChatInput(req.body);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { message, conversationHistory, context: clientContext } = validation.sanitized;
      const site = req.header('X-Site') || clientContext?.user?.site || process.env.DEFAULT_SITE || 'Nyon';

      log('info', 'REQUEST', `Message: "${message.substring(0, 80)}..."`, { site, historyLength: conversationHistory.length });

      // Charger les noms personnalisés des agents
      const customNames = await loadCustomAgentNames(pool);

      // Créer les handlers de tools
      const toolHandlers = createToolHandlers(pool, site);

      // Préparer les messages
      const messages = [
        { role: 'system', content: buildSystemPrompt(site, clientContext, customNames) },
        ...formatConversationHistory(conversationHistory),
        { role: 'user', content: message }
      ];

      let response;
      let usingGeminiFallback = false;

      // Appel initial à OpenAI avec retry
      try {
        response = await callOpenAIWithRetry({
          model: OPENAI_MODEL,
          messages,
          tools: TOOLS_DEFINITIONS,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 2000
        });
      } catch (openaiError) {
        log('error', 'OPENAI', `Error: ${openaiError.message}`);

        if (gemini && isQuotaError(openaiError)) {
          log('info', 'FALLBACK', 'Switching to Gemini');
          recordMetric('gemini_fallback');
          usingGeminiFallback = true;
          response = await callGeminiFallback(messages, { temperature: 0.7, max_tokens: 2000 });
        } else {
          throw openaiError;
        }
      }

      let assistantMessage = response.choices[0].message;
      let toolResults = [];
      let frontendInstructions = {};
      let iterations = 0;

      // Boucle de function calling améliorée
      while (assistantMessage.tool_calls && iterations < MAX_TOOL_ITERATIONS && !usingGeminiFallback) {
        iterations++;

        const toolNames = assistantMessage.tool_calls.map(tc => tc.function.name);
        log('info', 'TOOLS', `Iteration ${iterations}/${MAX_TOOL_ITERATIONS}`, { tools: toolNames });

        // Exécuter les tools avec métriques
        const results = await executeToolCalls(assistantMessage.tool_calls, toolHandlers);

        results.forEach(result => {
          recordMetric('tool_execution', { tool: result.toolName });
          if (result.frontend_instruction) {
            frontendInstructions = { ...frontendInstructions, ...result.frontend_instruction };
          }
        });

        toolResults.push(...results);

        // Préparer les messages avec les résultats
        const toolMessages = results.map(result => ({
          role: 'tool',
          tool_call_id: result.tool_call_id,
          content: JSON.stringify({
            success: result.success,
            ...result,
            tool_call_id: undefined
          })
        }));

        messages.push(assistantMessage);
        messages.push(...toolMessages);

        // Ré-appeler OpenAI
        try {
          response = await callOpenAIWithRetry({
            model: OPENAI_MODEL,
            messages,
            tools: TOOLS_DEFINITIONS,
            tool_choice: 'auto',
            temperature: 0.7,
            max_tokens: 2000
          });
        } catch (openaiError) {
          log('error', 'OPENAI', `Error in tool loop: ${openaiError.message}`);

          if (gemini && isQuotaError(openaiError)) {
            log('info', 'FALLBACK', 'Switching to Gemini in tool loop');
            recordMetric('gemini_fallback');
            usingGeminiFallback = true;
            response = await callGeminiFallback(messages, { temperature: 0.7, max_tokens: 2000 });
          } else {
            throw openaiError;
          }
        }

        assistantMessage = response.choices[0].message;
      }

      // Extraire le contenu final
      let finalContent = assistantMessage.content || 'Désolé, je n\'ai pas pu générer de réponse.';

      // Détecter l'agent approprié
      const previousAgent = clientContext?.previousAgentType || 'main';
      const currentEquipment = clientContext?.currentEquipment;
      const detectedAgent = detectAgentType(message, toolResults, previousAgent, currentEquipment);

      recordMetric('agent_used', { agent: detectedAgent });

      // Obtenir les infos de l'agent
      const agentInfo = getAgentInfo(detectedAgent, customNames);
      const previousAgentInfo = getAgentInfo(previousAgent, customNames);

      // Générer message de handoff si changement d'agent
      const isNewSpecialist = detectedAgent !== 'main' && detectedAgent !== previousAgent;
      const handoffMessage = isNewSpecialist
        ? generateHandoffMessage(previousAgentInfo, agentInfo)
        : null;

      if (handoffMessage) {
        finalContent = handoffMessage + finalContent;
        log('info', 'HANDOFF', `${previousAgentInfo.name} → ${agentInfo.name}`);
      }

      // Construire la réponse
      const chatResponse = {
        message: finalContent,
        provider: usingGeminiFallback ? 'gemini' : 'openai',
        model: usingGeminiFallback ? GEMINI_MODEL : OPENAI_MODEL,
        agentType: detectedAgent,
        agentName: agentInfo.name,
        agentEmoji: agentInfo.emoji,
        tools_used: toolResults.map(r => ({
          name: r.toolName || 'unknown',
          success: r.success
        })),
        iterations_used: iterations,
        ...frontendInstructions,
        actions: extractSuggestedActions(finalContent, toolResults)
      };

      // Ajouter les données des tools
      toolResults.forEach(result => {
        if (result.procedures?.length > 0) chatResponse.proceduresFound = result.procedures;
        if (result.records?.length > 0) chatResponse.troubleshootingRecords = result.records;
        if (result.equipment?.length > 0) chatResponse.equipmentList = result.equipment;
        if (result.controls?.length > 0) chatResponse.controlsList = result.controls;
        if (result.non_conformities?.length > 0) chatResponse.ncList = result.non_conformities;
        if (result.chart) chatResponse.chart = result.chart;
        if (result.procedure) chatResponse.procedureDetails = result.procedure;
        if (result.rankings) chatResponse.reliabilityRankings = result.rankings;
        if (result.priorities) chatResponse.maintenancePriorities = result.priorities;
        if (result.comparison) chatResponse.buildingComparison = result.comparison;

        // Transfer troubleshooting data
        if (result.ready_for_transfer && result.troubleshooting && result.target_equipment) {
          chatResponse.showTransferConfirmation = true;
          chatResponse.transferData = {
            troubleshootingId: result.troubleshooting.id,
            troubleshootingTitle: result.troubleshooting.title,
            sourceEquipment: result.troubleshooting.current_equipment,
            sourceBuilding: result.troubleshooting.current_building,
            targetEquipmentId: result.target_equipment.id,
            targetEquipmentName: result.target_equipment.name,
            targetEquipmentType: result.target_equipment.type,
            targetBuilding: result.target_equipment.building
          };
        }
        if (result.needs_clarification && result.candidates?.length > 0) {
          chatResponse.showTransferCandidates = true;
          chatResponse.transferCandidates = result.candidates;
        }
        if (result.transfer?.troubleshooting_id) {
          chatResponse.transferComplete = true;
        }
      });

      const responseTimeMs = Date.now() - startTime;
      recordMetric('request_success', { responseTimeMs });

      log('success', 'RESPONSE', `Generated in ${responseTimeMs}ms`, {
        toolsUsed: toolResults.length,
        agent: detectedAgent,
        iterations
      });

      res.json(chatResponse);

    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      recordMetric('request_failure', { error: error.message });

      log('error', 'FATAL', error.message, { stack: error.stack?.substring(0, 200) });

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

  // =========================================================================
  // POST /api/ai-assistant/chat-v2/stream (SSE Streaming)
  // =========================================================================
  router.post('/chat-v2/stream', async (req, res) => {
    // Headers pour SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const validation = validateChatInput(req.body);
      if (!validation.valid) {
        sendEvent('error', { message: validation.errors.join(', ') });
        res.end();
        return;
      }

      const { message, conversationHistory, context: clientContext } = validation.sanitized;
      const site = req.header('X-Site') || clientContext?.user?.site || process.env.DEFAULT_SITE || 'Nyon';

      sendEvent('status', { status: 'processing', message: 'Analyse de votre question...' });

      const customNames = await loadCustomAgentNames(pool);
      const toolHandlers = createToolHandlers(pool, site);

      const messages = [
        { role: 'system', content: buildSystemPrompt(site, clientContext, customNames) },
        ...formatConversationHistory(conversationHistory),
        { role: 'user', content: message }
      ];

      // Streaming avec OpenAI
      const stream = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        tools: TOOLS_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 2000,
        stream: true
      });

      let fullContent = '';
      let toolCalls = [];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          fullContent += delta.content;
          sendEvent('content', { text: delta.content });
        }

        if (delta?.tool_calls) {
          // Accumulate tool calls
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = { id: '', function: { name: '', arguments: '' } };
              }
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name = tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Si des tools ont été appelés, les exécuter
      if (toolCalls.length > 0) {
        sendEvent('status', { status: 'tools', message: 'Recherche de données...' });

        // Exécuter les tools
        const formattedToolCalls = toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        }));

        const results = await executeToolCalls(formattedToolCalls, toolHandlers);
        sendEvent('tools', { results: results.map(r => ({ name: r.toolName, success: r.success })) });

        // Ajouter les résultats et faire un second appel
        messages.push({ role: 'assistant', content: null, tool_calls: formattedToolCalls });
        results.forEach(r => {
          messages.push({
            role: 'tool',
            tool_call_id: r.tool_call_id,
            content: JSON.stringify(r)
          });
        });

        // Second appel streaming pour la réponse finale
        const stream2 = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 2000,
          stream: true
        });

        fullContent = '';
        for await (const chunk of stream2) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            sendEvent('content', { text: delta.content });
          }
        }
      }

      // Détecter l'agent
      const detectedAgent = detectAgentType(message, [], clientContext?.previousAgentType || 'main');
      const agentInfo = getAgentInfo(detectedAgent, customNames);

      sendEvent('complete', {
        agentType: detectedAgent,
        agentName: agentInfo.name,
        agentEmoji: agentInfo.emoji,
        actions: extractSuggestedActions(fullContent, [])
      });

      res.end();

    } catch (error) {
      log('error', 'STREAM', error.message);
      sendEvent('error', { message: error.message });
      res.end();
    }
  });

  // =========================================================================
  // GET /api/ai-assistant/chat-v2/health
  // =========================================================================
  router.get('/chat-v2/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '2.1',
      features: {
        function_calling: true,
        streaming: true,
        retry: true,
        tools_count: TOOLS_DEFINITIONS.length,
        max_iterations: MAX_TOOL_ITERATIONS,
        model: OPENAI_MODEL,
        fallback_model: GEMINI_MODEL,
        fallback_available: !!gemini
      },
      metrics: {
        totalRequests: metrics.totalRequests,
        successRate: metrics.totalRequests > 0
          ? Math.round((metrics.successfulRequests / metrics.totalRequests) * 100)
          : 100,
        avgResponseTimeMs: metrics.avgResponseTimeMs,
        geminiFallbackRate: metrics.totalRequests > 0
          ? Math.round((metrics.geminiFallbacks / metrics.totalRequests) * 100)
          : 0,
        topTools: Object.entries(metrics.toolUsage)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count })),
        topAgents: Object.entries(metrics.agentUsage)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count }))
      }
    });
  });

  // =========================================================================
  // POST /api/ai-assistant/feedback
  // =========================================================================
  router.post('/feedback', async (req, res) => {
    try {
      const { messageId, feedback, message, response, site, user } = req.body;

      if (!feedback || !['positive', 'negative'].includes(feedback)) {
        return res.status(400).json({ error: 'Invalid feedback' });
      }

      // Enregistrer le feedback en base
      await pool.query(`
        INSERT INTO ai_feedback (
          message_id, feedback_type, user_message, ai_response,
          site, user_email, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (message_id) DO UPDATE SET
          feedback_type = EXCLUDED.feedback_type,
          updated_at = NOW()
      `, [
        messageId || `fb_${Date.now()}`,
        feedback,
        message?.substring(0, 1000),
        response?.substring(0, 2000),
        site || 'unknown',
        user?.email || 'anonymous'
      ]);

      log('info', 'FEEDBACK', `${feedback} feedback recorded`, { messageId });

      res.json({ ok: true, message: 'Merci pour ton retour !' });
    } catch (error) {
      log('error', 'FEEDBACK', error.message);
      res.json({ ok: false, error: error.message });
    }
  });

  return router;
}

// ============================================================================
// ACTIONS SUGGÉRÉES
// ============================================================================

/**
 * Extrait des actions suggérées de la réponse
 */
function extractSuggestedActions(content, toolResults) {
  const actions = [];
  const contentLower = content.toLowerCase();

  // Actions basées sur les tools utilisés
  toolResults.forEach(result => {
    if (result.procedures?.length > 0) {
      const proc = result.procedures[0];
      actions.push({
        label: `📋 Voir "${proc.title?.substring(0, 20)}..."`,
        prompt: `Ouvre la procédure "${proc.title}"`
      });
    }

    if (result.records?.length > 0) {
      actions.push({
        label: '📊 Analyser ces dépannages',
        prompt: 'Analyse les causes récurrentes de ces dépannages'
      });
    }

    if (result.rankings?.length > 0) {
      actions.push({
        label: '🔧 Plan de maintenance',
        prompt: 'Propose un plan de maintenance pour les équipements les plus problématiques'
      });
    }

    if (result.priorities?.length > 0) {
      actions.push({
        label: '📅 Planifier les actions',
        prompt: 'Aide-moi à planifier ces actions prioritaires'
      });
    }

    if (result.equipment?.length > 0) {
      const eq = result.equipment[0];
      actions.push({
        label: `📍 Localiser ${eq.name?.substring(0, 15)}`,
        prompt: `Montre-moi ${eq.name} sur la carte`
      });
    }

    if (result.controls?.length > 0) {
      actions.push({
        label: '🗺️ Voir sur la carte',
        prompt: 'Montre ces équipements sur la carte'
      });
    }
  });

  // Actions contextuelles
  if (actions.length === 0) {
    if (contentLower.includes('procédure') || contentLower.includes('procedure')) {
      actions.push({ label: '🔍 Chercher procédure', prompt: 'Liste les procédures disponibles' });
    }
    if (contentLower.includes('contrôle') || contentLower.includes('retard')) {
      actions.push({ label: '⏰ Contrôles en retard', prompt: 'Quels sont les contrôles en retard ?' });
    }
    if (contentLower.includes('dépannage') || contentLower.includes('panne')) {
      actions.push({ label: '🔧 Derniers dépannages', prompt: 'Montre-moi les derniers dépannages' });
    }
    if (contentLower.includes('équipement') || contentLower.includes('problème')) {
      actions.push({ label: '📊 Équipements à risque', prompt: 'Quels équipements ont le plus de pannes ?' });
    }
  }

  // Actions par défaut si toujours vide
  if (actions.length === 0) {
    actions.push(
      { label: '📊 Vue d\'ensemble', prompt: 'Donne-moi une vue d\'ensemble du site' },
      { label: '🔧 Priorités maintenance', prompt: 'Quelles sont les priorités de maintenance ?' }
    );
  }

  return actions.slice(0, 4);
}

// ============================================================================
// TABLE INITIALIZATION
// ============================================================================

/**
 * Initialise les tables nécessaires pour le chat V2
 */
async function initChatV2Tables(pool) {
  console.log('[CHAT-V2] Initializing tables...');

  try {
    // Table de feedback utilisateur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id VARCHAR(100) UNIQUE NOT NULL,
        feedback_type VARCHAR(20) NOT NULL, -- 'positive' ou 'negative'
        user_message TEXT,
        ai_response TEXT,
        site VARCHAR(100),
        user_email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      )
    `);

    // Index pour recherche
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_site
      ON ai_feedback(site, created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_type
      ON ai_feedback(feedback_type, created_at DESC)
    `);

    // Table de métriques (optionnelle, pour persistance)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        metric_date DATE NOT NULL,
        site VARCHAR(100) NOT NULL,
        total_requests INTEGER DEFAULT 0,
        successful_requests INTEGER DEFAULT 0,
        failed_requests INTEGER DEFAULT 0,
        avg_response_time_ms INTEGER,
        gemini_fallbacks INTEGER DEFAULT 0,
        tool_executions INTEGER DEFAULT 0,
        tool_usage JSONB DEFAULT '{}',
        agent_usage JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(metric_date, site)
      )
    `);

    console.log('[CHAT-V2] Tables initialized successfully');
  } catch (err) {
    console.error('[CHAT-V2] Error initializing tables:', err.message);
    // Ne pas throw - laisser l'app démarrer même si les tables existent déjà
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  createChatV2Router,
  buildSystemPrompt,
  formatConversationHistory,
  extractSuggestedActions,
  validateChatInput,
  initChatV2Tables,
  AGENTS_INFO,
  metrics
};
