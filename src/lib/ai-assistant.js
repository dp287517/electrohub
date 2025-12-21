/**
 * Service AI Assistant - Intelligence artificielle pour ElectroHub
 *
 * Ce service fournit une interface unifiée pour interagir avec différents
 * modèles d'IA (OpenAI, Gemini) et récupère le contexte global de l'application
 * pour des réponses personnalisées et pertinentes.
 */

import { get, post } from './api';

// Cache du contexte global
let contextCache = null;
let contextCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

class AIAssistant {
  constructor() {
    this.baseUrl = '/api/ai-assistant';
  }

  /**
   * Récupère le contexte global de l'application
   * Inclut: équipements, contrôles, non-conformités, bâtiments, etc.
   */
  async getGlobalContext() {
    // Utiliser le cache si valide
    if (contextCache && contextCacheTime && (Date.now() - contextCacheTime < CACHE_DURATION)) {
      return contextCache;
    }

    try {
      // Récupérer les données de différentes sources en parallèle
      const [
        switchboardData,
        vsdData,
        mecaData,
        controlsDashboard
      ] = await Promise.allSettled([
        this.fetchSwitchboardContext(),
        this.fetchVSDContext(),
        this.fetchMecaContext(),
        this.fetchControlsDashboard()
      ]);

      const context = {
        timestamp: new Date().toISOString(),
        user: this.getCurrentUser(),

        // Données agrégées
        totalEquipments: 0,
        upcomingControls: 0,
        overdueControls: 0,
        nonConformities: 0,

        // Données par catégorie
        switchboards: switchboardData.status === 'fulfilled' ? switchboardData.value : null,
        vsd: vsdData.status === 'fulfilled' ? vsdData.value : null,
        meca: mecaData.status === 'fulfilled' ? mecaData.value : null,
        dashboard: controlsDashboard.status === 'fulfilled' ? controlsDashboard.value : null,

        // Bâtiments et étages
        buildings: {},

        // Statistiques calculées
        stats: {}
      };

      // Calculer les totaux
      if (context.switchboards?.equipments) {
        context.totalEquipments += context.switchboards.equipments.length;
        this.aggregateByBuilding(context, context.switchboards.equipments, 'switchboard');
      }
      if (context.vsd?.equipments) {
        context.totalEquipments += context.vsd.equipments.length;
      }
      if (context.meca?.equipments) {
        context.totalEquipments += context.meca.equipments.length;
      }

      if (context.dashboard) {
        context.upcomingControls = context.dashboard.stats?.pending || 0;
        context.overdueControls = context.dashboard.stats?.overdue || 0;
      }

      // Mettre en cache
      contextCache = context;
      contextCacheTime = Date.now();

      return context;
    } catch (error) {
      console.error('Erreur récupération contexte:', error);
      return {
        error: true,
        message: 'Impossible de récupérer le contexte complet',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Récupère les données Switchboard
   */
  async fetchSwitchboardContext() {
    try {
      const data = await get('/api/switchboard/controls/equipment');
      return {
        equipments: data || [],
        count: data?.length || 0
      };
    } catch (error) {
      console.error('Erreur switchboard:', error);
      return null;
    }
  }

  /**
   * Récupère les données VSD
   */
  async fetchVSDContext() {
    try {
      const data = await get('/api/vsd/equipments');
      return {
        equipments: data || [],
        count: data?.length || 0
      };
    } catch (error) {
      console.error('Erreur VSD:', error);
      return null;
    }
  }

  /**
   * Récupère les données Meca
   */
  async fetchMecaContext() {
    try {
      const data = await get('/api/meca/equipments');
      return {
        equipments: data || [],
        count: data?.length || 0
      };
    } catch (error) {
      console.error('Erreur Meca:', error);
      return null;
    }
  }

  /**
   * Récupère le dashboard des contrôles
   */
  async fetchControlsDashboard() {
    try {
      const data = await get('/api/switchboard/controls/dashboard');
      return data;
    } catch (error) {
      console.error('Erreur dashboard:', error);
      return null;
    }
  }

  /**
   * Agrège les équipements par bâtiment
   */
  aggregateByBuilding(context, equipments, type) {
    if (!Array.isArray(equipments)) return;

    equipments.forEach(eq => {
      const building = eq.building_code || eq.building || 'Non assigné';
      const floor = eq.floor || 'Non assigné';

      if (!context.buildings[building]) {
        context.buildings[building] = {
          floors: {},
          totalEquipments: 0,
          types: {}
        };
      }

      if (!context.buildings[building].floors[floor]) {
        context.buildings[building].floors[floor] = {
          equipments: [],
          count: 0
        };
      }

      context.buildings[building].floors[floor].equipments.push({
        id: eq.id,
        name: eq.equipment_name || eq.name,
        type: type,
        status: eq.status,
        nextControl: eq.next_control_date
      });

      context.buildings[building].floors[floor].count++;
      context.buildings[building].totalEquipments++;
      context.buildings[building].types[type] = (context.buildings[building].types[type] || 0) + 1;
    });
  }

  /**
   * Récupère l'utilisateur courant
   */
  getCurrentUser() {
    try {
      const userStr = localStorage.getItem('eh_user');
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  }

  /**
   * Envoie un message au chat IA
   */
  async chat(message, options = {}) {
    const {
      context = null,
      provider = 'openai',
      conversationHistory = [],
      webSearch = false
    } = options;

    try {
      // Construire le contexte pour l'IA
      const fullContext = context || await this.getGlobalContext();

      const data = await post(`${this.baseUrl}/chat`, {
        message,
        context: this.prepareContextForAI(fullContext),
        provider,
        conversationHistory: conversationHistory.map(m => ({
          role: m.role,
          content: m.content
        })),
        webSearch,
        user: this.getCurrentUser()
      });

      return {
        message: data.message,
        actions: data.actions || [],
        sources: data.sources || [],
        provider: data.provider,
        model: data.model,
        chart: data.chart || null,
        pendingAction: data.pendingAction || null,
        actionResult: data.actionResult || null
      };
    } catch (error) {
      console.error('Erreur chat IA:', error);

      // Fallback: réponse basique sans backend
      return this.fallbackResponse(message, context);
    }
  }

  /**
   * Exécute une action autonome
   */
  async executeAction(action, params) {
    try {
      const data = await post(`${this.baseUrl}/execute-action`, {
        action,
        params,
        user: this.getCurrentUser()
      });
      return data;
    } catch (error) {
      console.error('Erreur exécution action:', error);
      return {
        success: false,
        message: `Erreur: ${error.message}`
      };
    }
  }

  /**
   * Prépare le contexte pour l'envoi à l'IA
   */
  prepareContextForAI(context) {
    if (!context) return null;

    // Résumé concis pour ne pas surcharger le prompt
    return {
      summary: {
        totalEquipments: context.totalEquipments,
        upcomingControls: context.upcomingControls,
        overdueControls: context.overdueControls,
        nonConformities: context.nonConformities,
        buildingCount: Object.keys(context.buildings || {}).length
      },
      buildings: Object.entries(context.buildings || {}).map(([name, data]) => ({
        name,
        floors: Object.keys(data.floors || {}).length,
        equipments: data.totalEquipments,
        types: data.types
      })),
      recentActivity: context.dashboard?.recentActivity || [],
      user: context.user ? {
        name: context.user.name,
        site: context.user.site,
        role: context.user.role
      } : null
    };
  }

  /**
   * Réponse de fallback si le backend n'est pas disponible
   */
  fallbackResponse(message, context) {
    const lowerMessage = message.toLowerCase();

    // Analyse basique des intentions
    if (lowerMessage.includes('contrôle') || lowerMessage.includes('control')) {
      return {
        message: `D'après mes données, vous avez **${context?.upcomingControls || 0} contrôles à venir** et **${context?.overdueControls || 0} en retard**.

Je vous recommande de prioriser les contrôles en retard. Voulez-vous que je vous fasse une liste détaillée ?`,
        actions: [
          { label: 'Voir les contrôles en retard', prompt: 'Montre-moi les contrôles en retard' },
          { label: 'Planifier les contrôles', prompt: 'Aide-moi à planifier les prochains contrôles' }
        ]
      };
    }

    if (lowerMessage.includes('bâtiment') || lowerMessage.includes('building') || lowerMessage.includes('étage')) {
      const buildingCount = Object.keys(context?.buildings || {}).length;
      return {
        message: `Vous avez des équipements répartis sur **${buildingCount} bâtiments**.

${Object.entries(context?.buildings || {}).slice(0, 5).map(([name, data]) =>
  `• **${name}**: ${data.totalEquipments} équipements sur ${Object.keys(data.floors).length} étages`
).join('\n')}

Voulez-vous des détails sur un bâtiment en particulier ?`,
        actions: Object.keys(context?.buildings || {}).slice(0, 3).map(name => ({
          label: `Détails ${name}`,
          prompt: `Montre-moi les équipements du bâtiment ${name}`
        }))
      };
    }

    if (lowerMessage.includes('non-conformité') || lowerMessage.includes('nc') || lowerMessage.includes('atex')) {
      return {
        message: `Je détecte que vous vous intéressez aux **non-conformités**.

Pour une analyse complète, je peux :
• Lister toutes les NC actives par catégorie
• Rechercher de la documentation technique
• Proposer des actions correctives

Que souhaitez-vous faire ?`,
        actions: [
          { label: 'Lister les NC', prompt: 'Liste toutes les non-conformités actives' },
          { label: 'Chercher documentation', prompt: 'Recherche de la documentation pour les équipements en non-conformité' }
        ]
      };
    }

    // Réponse générique
    return {
      message: `Je comprends votre demande. Voici un résumé de votre installation :

• **${context?.totalEquipments || 0}** équipements au total
• **${context?.upcomingControls || 0}** contrôles à venir
• **${context?.overdueControls || 0}** contrôles en retard
• **${Object.keys(context?.buildings || {}).length}** bâtiments

Comment puis-je vous aider plus précisément ?`,
      actions: [
        { label: 'Voir les contrôles', prompt: 'Montre-moi les contrôles à venir' },
        { label: 'Analyser par bâtiment', prompt: 'Regroupe les équipements par bâtiment' },
        { label: 'Non-conformités', prompt: 'Quelles sont les non-conformités actuelles ?' }
      ]
    };
  }

  /**
   * Recherche web pour documentation
   */
  async searchDocumentation(query) {
    try {
      const data = await post(`${this.baseUrl}/web-search`, {
        query,
        type: 'documentation'
      });
      return data;
    } catch (error) {
      console.error('Erreur recherche web:', error);
      return {
        results: [],
        error: 'Recherche non disponible'
      };
    }
  }

  /**
   * Génère un plan d'actions
   */
  async generateActionPlan(options = {}) {
    const context = await this.getGlobalContext();

    try {
      const data = await post(`${this.baseUrl}/action-plan`, {
        context: this.prepareContextForAI(context),
        timeframe: options.timeframe || '7days',
        priority: options.priority || 'all',
        user: this.getCurrentUser()
      });
      return data;
    } catch (error) {
      console.error('Erreur génération plan:', error);
      return this.generateFallbackPlan(context);
    }
  }

  /**
   * Plan d'actions de fallback
   */
  generateFallbackPlan(context) {
    const actions = [];
    const today = new Date();

    // Contrôles en retard = priorité haute
    if (context?.overdueControls > 0) {
      actions.push({
        priority: 'high',
        title: `Traiter ${context.overdueControls} contrôle(s) en retard`,
        description: 'Ces contrôles sont passés leur date limite',
        deadline: 'Immédiat'
      });
    }

    // Contrôles à venir cette semaine
    if (context?.upcomingControls > 0) {
      actions.push({
        priority: 'medium',
        title: `Préparer ${context.upcomingControls} contrôle(s) à venir`,
        description: 'Planifier et préparer les prochains contrôles',
        deadline: '7 jours'
      });
    }

    return {
      generatedAt: today.toISOString(),
      actions,
      summary: `${actions.length} actions identifiées`
    };
  }

  /**
   * Invalide le cache
   */
  invalidateCache() {
    contextCache = null;
    contextCacheTime = null;
  }
}

// Export singleton
export const aiAssistant = new AIAssistant();
export default aiAssistant;
