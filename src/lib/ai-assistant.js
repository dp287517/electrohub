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
          content: m.content,
          // Equipment data for map context
          equipmentList: m.equipmentList || null,
          equipment: m.equipment || null,
          locationEquipment: m.locationEquipment || null,
          locationEquipmentType: m.locationEquipmentType || null,
          // Procedure context for guidance (v2.0)
          procedureToOpen: m.procedureToOpen || null,
          proceduresFound: m.proceduresFound || null,
          procedureDetails: m.procedureDetails || null,
          procedureGuidance: m.procedureGuidance || null,
          // Legacy procedure session tracking
          procedureSessionId: m.procedureSessionId,
          procedureStep: m.procedureStep,
          procedureMode: m.procedureMode,
          procedureId: m.procedureId
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
        actionResult: data.actionResult || null,
        // ===============================
        // PROCEDURE INTEGRATION (v2.0)
        // ===============================
        // Search results
        proceduresFound: data.proceduresFound || null,
        // View procedure - triggers modal
        procedureToOpen: data.procedureToOpen || null,
        procedureDetails: data.procedureDetails || null,
        // Guidance mode
        procedureGuidance: data.procedureGuidance || null,
        // Create procedure - triggers modal
        openProcedureCreator: data.openProcedureCreator || false,
        procedureCreatorContext: data.procedureCreatorContext || null,
        // ===============================
        // NAVIGATION INTEGRATION
        // ===============================
        navigationMode: data.navigationMode || null,
        navigateTo: data.navigateTo || null,
        buildingCode: data.buildingCode || null,
        floor: data.floor || null,
        equipmentList: data.equipmentList || null,
        // ===============================
        // MAP LOCATION INTEGRATION
        // ===============================
        showMap: data.showMap || false,
        locationEquipment: data.locationEquipment || null,
        locationEquipmentType: data.locationEquipmentType || null,
        locationControlStatus: data.locationControlStatus || null,
        // ===============================
        // Legacy fields (backward compat)
        // ===============================
        procedureSessionId: data.procedureSessionId || null,
        procedureStep: data.procedureStep || null,
        expectsPhoto: data.expectsPhoto || false,
        procedureReady: data.procedureReady || false,
        procedureId: data.procedureId || null,
        procedureMode: data.procedureMode || null,
        pdfUrl: data.pdfUrl || null,
        procedureComplete: data.procedureComplete || false,
        // File upload mode
        expectsFile: data.expectsFile || false,
        importedProcedure: data.importedProcedure || null,
        reportAnalysis: data.reportAnalysis || null
      };
    } catch (error) {
      console.error('Erreur chat IA:', error);

      // Fallback: réponse basique sans backend
      return this.fallbackResponse(message, context);
    }
  }

  /**
   * Chat avec photo - pour création de procédures et analyses visuelles
   * @param {string} message - Message de l'utilisateur
   * @param {File|null} photo - Fichier photo optionnel
   * @param {object} options - Options supplémentaires
   */
  async chatWithPhoto(message, photo = null, options = {}) {
    const {
      context = null,
      conversationHistory = []
    } = options;

    try {
      // Préparer le contexte
      const fullContext = context || await this.getGlobalContext();

      // Si pas de photo, utiliser le chat normal
      if (!photo) {
        return this.chat(message, options);
      }

      // Créer FormData pour l'upload de photo
      const formData = new FormData();
      formData.append('message', message || '');
      formData.append('photo', photo);
      formData.append('context', JSON.stringify(this.prepareContextForAI(fullContext)));
      formData.append('conversationHistory', JSON.stringify(
        conversationHistory.map(m => ({
          role: m.role,
          content: m.content,
          photo: m.photo ? true : false, // Juste indiquer si photo, pas le contenu
          // Equipment data for map context
          equipmentList: m.equipmentList || null,
          equipment: m.equipment || null,
          locationEquipment: m.locationEquipment || null,
          locationEquipmentType: m.locationEquipmentType || null,
          // Procedure context for guidance (v2.0)
          procedureToOpen: m.procedureToOpen || null,
          proceduresFound: m.proceduresFound || null,
          procedureDetails: m.procedureDetails || null,
          procedureGuidance: m.procedureGuidance || null,
          // Legacy procedure session tracking
          procedureSessionId: m.procedureSessionId,
          procedureStep: m.procedureStep,
          procedureMode: m.procedureMode,
          procedureId: m.procedureId
        }))
      ));
      formData.append('user', JSON.stringify(this.getCurrentUser()));

      const response = await fetch(`${this.baseUrl}/chat-with-photo`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Erreur lors de l\'envoi de la photo');
      }

      const data = await response.json();

      return {
        message: data.message,
        actions: data.actions || [],
        sources: data.sources || [],
        provider: data.provider,
        model: data.model,
        chart: data.chart || null,
        pendingAction: data.pendingAction || null,
        // ===============================
        // PROCEDURE INTEGRATION (v2.0)
        // ===============================
        proceduresFound: data.proceduresFound || null,
        procedureToOpen: data.procedureToOpen || null,
        procedureDetails: data.procedureDetails || null,
        procedureGuidance: data.procedureGuidance || null,
        openProcedureCreator: data.openProcedureCreator || false,
        procedureCreatorContext: data.procedureCreatorContext || null,
        // ===============================
        // NAVIGATION INTEGRATION
        // ===============================
        navigationMode: data.navigationMode || null,
        navigateTo: data.navigateTo || null,
        buildingCode: data.buildingCode || null,
        floor: data.floor || null,
        equipmentList: data.equipmentList || null,
        // ===============================
        // MAP LOCATION INTEGRATION
        // ===============================
        showMap: data.showMap || false,
        locationEquipment: data.locationEquipment || null,
        locationEquipmentType: data.locationEquipmentType || null,
        locationControlStatus: data.locationControlStatus || null,
        // Legacy fields
        procedureSessionId: data.procedureSessionId || null,
        procedureStep: data.procedureStep || null,
        expectsPhoto: data.expectsPhoto || false,
        procedureReady: data.procedureReady || false,
        procedureId: data.procedureId || null,
        procedureMode: data.procedureMode || null,
        stepNumber: data.stepNumber || null
      };
    } catch (error) {
      console.error('Erreur chat avec photo:', error);

      return {
        message: "J'ai bien reçu ta photo ! Dis-moi ce que tu veux faire avec.",
        actions: [
          { label: 'Créer une procédure', prompt: 'Utilise cette photo pour créer une procédure' },
          { label: 'Analyser l\'équipement', prompt: 'Analyse cet équipement sur la photo' }
        ]
      };
    }
  }

  /**
   * Upload de fichier pour import de document ou analyse de rapport
   * @param {File} file - Fichier à uploader (PDF, Word, TXT)
   * @param {string} mode - 'import-document' ou 'analyze-report'
   * @param {object} options - Options supplémentaires
   */
  async uploadFile(file, mode = 'import-document', options = {}) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);

      const response = await fetch(`${this.baseUrl}/upload-file`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Erreur lors de l\'upload du fichier');
      }

      const data = await response.json();

      return {
        message: data.message,
        actions: data.actions || [],
        provider: data.provider,
        // Document import results
        importedProcedure: data.importedProcedure || null,
        // Report analysis results
        reportAnalysis: data.reportAnalysis || null,
        actionListId: data.actionListId || null
      };
    } catch (error) {
      console.error('Erreur upload fichier:', error);

      return {
        message: "Erreur lors du traitement du fichier. Réessaie.",
        actions: [],
        provider: 'fallback'
      };
    }
  }

  /**
   * Chat avec contexte d'équipement spécifique
   * @param {string} message - Message de l'utilisateur
   * @param {object} equipmentContext - Contexte de l'équipement
   * @param {object} options - Options supplémentaires
   */
  async chatWithEquipment(message, equipmentContext, options = {}) {
    const { conversationHistory = [] } = options;

    try {
      const data = await post(`${this.baseUrl}/chat`, {
        message,
        context: this.prepareEquipmentContextForAI(equipmentContext),
        provider: 'openai',
        conversationHistory: conversationHistory.map(m => ({
          role: m.role,
          content: m.content
        })),
        webSearch: true, // Enable web search for documentation
        user: this.getCurrentUser(),
        mode: 'equipment' // Indicate equipment-specific mode
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
      console.error('Erreur chat équipement:', error);
      // Fallback response for equipment
      return this.fallbackEquipmentResponse(message, equipmentContext);
    }
  }

  /**
   * Prépare le contexte équipement pour l'IA
   */
  prepareEquipmentContextForAI(equipmentContext) {
    if (!equipmentContext) return null;

    return {
      mode: 'equipment',
      equipmentType: equipmentContext.type,
      equipmentTypeName: equipmentContext.typeName,
      equipment: equipmentContext.equipment,
      controlStatus: equipmentContext.controlStatus,
      user: this.getCurrentUser() ? {
        name: this.getCurrentUser().name,
        site: this.getCurrentUser().site,
        role: this.getCurrentUser().role
      } : null
    };
  }

  /**
   * Réponse de fallback pour équipement si le backend n'est pas disponible
   */
  fallbackEquipmentResponse(message, equipmentContext) {
    const lowerMessage = message.toLowerCase();
    const eq = equipmentContext?.equipment || {};
    const eqName = eq.name || eq.tag || 'cet équipement';
    const eqType = equipmentContext?.typeName || 'équipement';

    // Diagnostic request
    if (lowerMessage.includes('diagnostic') || lowerMessage.includes('état') || lowerMessage.includes('analyse')) {
      return {
        message: `Voici mon diagnostic pour **${eqName}** :

📋 **Informations générales :**
• Type : ${eqType}
• Fabricant : ${eq.manufacturer || 'Non renseigné'}
• Modèle : ${eq.model || 'Non renseigné'}
• Localisation : ${[eq.building, eq.floor, eq.room].filter(Boolean).join(' > ') || 'Non spécifiée'}
${eq.power_kw ? `• Puissance : ${eq.power_kw} kW` : ''}
${eq.voltage ? `• Tension : ${eq.voltage} V` : ''}

${equipmentContext?.controlStatus?.hasOverdue ?
  `⚠️ **Point d'attention** : Des contrôles sont en retard pour cet équipement. Je recommande de planifier une intervention rapidement.` :
  `✅ **Statut contrôles** : Les contrôles sont à jour.`}

Souhaitez-vous que je recherche la documentation technique ou que je propose un plan de maintenance ?`,
        actions: [
          { label: 'Rechercher documentation', prompt: `Recherche la documentation technique pour ${eq.manufacturer || ''} ${eq.model || eqName}` },
          { label: 'Plan de maintenance', prompt: 'Propose un plan de maintenance préventive pour cet équipement' }
        ]
      };
    }

    // Maintenance request
    if (lowerMessage.includes('maintenance') || lowerMessage.includes('entretien') || lowerMessage.includes('préventif')) {
      return {
        message: `Voici mes recommandations de maintenance pour **${eqName}** (${eqType}) :

📅 **Maintenance préventive recommandée :**

**Hebdomadaire :**
• Inspection visuelle de l'état général
• Vérification des voyants et indicateurs
• Contrôle des connexions visibles

**Mensuelle :**
• Nettoyage des filtres et ventilations
• Vérification des serrages
• Test des dispositifs de sécurité

**Annuelle :**
• Contrôle complet par un technicien qualifié
• Remplacement des pièces d'usure
• Mise à jour de la documentation

${equipmentContext?.controlStatus?.nextDueDate ?
  `📌 **Prochain contrôle prévu** : ${new Date(equipmentContext.controlStatus.nextDueDate).toLocaleDateString('fr-FR')}` : ''}

Voulez-vous plus de détails sur un type de maintenance spécifique ?`,
        actions: [
          { label: 'Checklist maintenance', prompt: 'Génère une checklist de maintenance détaillée' },
          { label: 'Pièces de rechange', prompt: 'Quelles pièces de rechange prévoir pour cet équipement ?' }
        ]
      };
    }

    // Documentation request
    if (lowerMessage.includes('documentation') || lowerMessage.includes('doc') || lowerMessage.includes('manuel') || lowerMessage.includes('recherche')) {
      return {
        message: `Je vais rechercher la documentation pour **${eqName}**.

🔍 **Termes de recherche suggérés :**
• "${eq.manufacturer || ''} ${eq.model || ''} manual"
• "${eq.manufacturer || ''} ${eq.reference || ''} datasheet"
• "${eqType} maintenance guide"

📚 **Types de documents utiles :**
• Manuel d'installation et mise en service
• Guide de maintenance préventive
• Schémas électriques et mécaniques
• Fiches de paramétrage
• Bulletins de sécurité

Pour une recherche plus précise, activez la recherche web dans les paramètres ou fournissez-moi plus de détails sur ce que vous cherchez.`,
        actions: [
          { label: 'Normes applicables', prompt: 'Quelles normes s\'appliquent à ce type d\'équipement ?' },
          { label: 'Procédures sécurité', prompt: 'Quelles sont les procédures de sécurité pour intervenir sur cet équipement ?' }
        ]
      };
    }

    // Safety/compliance request
    if (lowerMessage.includes('sécurité') || lowerMessage.includes('conformité') || lowerMessage.includes('norme') || lowerMessage.includes('risque')) {
      return {
        message: `Analyse de conformité pour **${eqName}** (${eqType}) :

🛡️ **Points de sécurité à vérifier :**
• Protection contre les contacts directs et indirects
• Dispositifs de coupure d'urgence
• Signalétique et balisage
• Accès et dégagements
• Ventilation et température

📋 **Normes potentiellement applicables :**
• NF C 15-100 (Installations électriques BT)
• NF C 13-100/200 (Postes HT/BT)
• EN 60204 (Sécurité machines)
• Directives ATEX si applicable

${equipmentContext?.controlStatus?.hasOverdue ?
  `⚠️ **Alerte** : Des contrôles réglementaires sont en retard. Cela peut impacter la conformité de l'installation.` : ''}

Voulez-vous que j'approfondisse un point particulier ?`,
        actions: [
          { label: 'Analyse des risques', prompt: 'Fais une analyse des risques pour cet équipement' },
          { label: 'Plan de conformité', prompt: 'Propose un plan pour mettre cet équipement en conformité' }
        ]
      };
    }

    // Problems/issues request
    if (lowerMessage.includes('problème') || lowerMessage.includes('panne') || lowerMessage.includes('erreur') || lowerMessage.includes('défaut')) {
      return {
        message: `Guide de dépannage pour **${eqName}** (${eqType}) :

🔧 **Problèmes courants et solutions :**

**1. Défaut d'alimentation**
• Vérifier le disjoncteur amont
• Contrôler les fusibles
• Mesurer la tension d'entrée

**2. Surchauffe**
• Nettoyer les ventilations
• Vérifier la charge
• Contrôler l'environnement (température ambiante)

**3. Défaut de communication**
• Vérifier les connexions réseau/bus
• Contrôler les paramètres de communication
• Redémarrer l'équipement si nécessaire

**4. Alarmes/Voyants**
• Consulter le manuel pour les codes d'erreur
• Noter le code pour diagnostic approfondi

Quel problème rencontrez-vous exactement ?`,
        actions: [
          { label: 'Code d\'erreur', prompt: 'J\'ai un code d\'erreur, aide-moi à le comprendre' },
          { label: 'Contacter support', prompt: 'Comment contacter le support technique du fabricant ?' }
        ]
      };
    }

    // Default response
    return {
      message: `Je suis prêt à vous aider avec **${eqName}** (${eqType}).

📊 **Informations disponibles :**
• Fabricant : ${eq.manufacturer || 'Non renseigné'}
• Modèle : ${eq.model || 'Non renseigné'}
• Localisation : ${[eq.building, eq.floor].filter(Boolean).join(' > ') || 'Non spécifiée'}
${eq.power_kw ? `• Puissance : ${eq.power_kw} kW` : ''}

🤖 **Je peux vous aider à :**
• Faire un **diagnostic** de l'équipement
• Proposer un **plan de maintenance**
• Rechercher de la **documentation technique**
• Analyser la **conformité** et les normes
• Résoudre des **problèmes** techniques

Que souhaitez-vous savoir ?`,
      actions: [
        { label: 'Diagnostic complet', prompt: 'Fais un diagnostic complet de cet équipement' },
        { label: 'Plan maintenance', prompt: 'Propose un plan de maintenance préventive' },
        { label: 'Documentation', prompt: 'Recherche la documentation technique' },
        { label: 'Conformité', prompt: 'Vérifie la conformité de cet équipement' }
      ]
    };
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

  // ============================================================
  // 📋 PROCEDURES - Direct access methods
  // ============================================================

  /**
   * Search procedures directly (bypasses chat)
   */
  async searchProcedures(query = '', options = {}) {
    try {
      const { category, limit = 10 } = options;
      const site = this.getCurrentUser()?.site;
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (category) params.append('category', category);
      if (site) params.append('site', site);
      params.append('limit', limit.toString());

      const data = await get(`${this.baseUrl}/procedures/search?${params}`);
      return data;
    } catch (error) {
      console.error('[Procedures Search] Error:', error);
      return { ok: false, procedures: [] };
    }
  }

  /**
   * Get procedure with all steps
   */
  async getProcedure(id) {
    try {
      const data = await get(`${this.baseUrl}/procedures/${id}`);
      return data;
    } catch (error) {
      console.error('[Procedures Get] Error:', error);
      return { ok: false, procedure: null };
    }
  }

  /**
   * Get procedure statistics
   */
  async getProcedureStats() {
    try {
      const site = this.getCurrentUser()?.site;
      const params = site ? `?site=${encodeURIComponent(site)}` : '';
      const data = await get(`${this.baseUrl}/procedures/stats${params}`);
      return data;
    } catch (error) {
      console.error('[Procedures Stats] Error:', error);
      return { ok: false, stats: null };
    }
  }

  /**
   * Get procedure categories with counts
   */
  async getProcedureCategories() {
    try {
      const data = await get(`${this.baseUrl}/procedures/categories`);
      return data;
    } catch (error) {
      console.error('[Procedures Categories] Error:', error);
      return { ok: false, categories: [] };
    }
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

  /**
   * Text-to-Speech avec OpenAI (voix naturelle IA)
   * Retourne un blob audio MP3 ou null si fallback nécessaire
   */
  async textToSpeech(text, voice = 'nova') {
    try {
      const response = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.fallback) {
          // Use browser fallback
          return null;
        }
        throw new Error(error.message || 'TTS failed');
      }

      const audioBlob = await response.blob();
      return audioBlob;
    } catch (error) {
      console.error('[TTS] Error:', error);
      return null; // Return null to trigger browser fallback
    }
  }

  /**
   * Récupère le brief du matin avec stats et insights IA
   */
  async getMorningBrief() {
    try {
      const data = await get(`${this.baseUrl}/morning-brief`);
      return data;
    } catch (error) {
      console.error('[MorningBrief] Error:', error);
      return {
        success: false,
        error: error.message,
        // Fallback data
        greeting: this.getGreeting(),
        healthScore: 75,
        status: { emoji: '🟡', text: 'Données partielles', color: 'yellow' },
        stats: { totalEquipment: 0, controls: { overdue: 0, thisWeek: 0 } },
        priorityActions: [],
        aiInsight: 'Chargement des données en cours...'
      };
    }
  }

  /**
   * Helper pour le greeting
   */
  getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }

  /**
   * ElevenLabs TTS - Ultra-natural voice
   * Falls back to OpenAI if ElevenLabs unavailable
   * Includes timeout to handle network issues gracefully
   */
  async textToSpeechPremium(text, voice = 'Rachel') {
    // Limit text length to avoid large audio files that may fail
    const maxLength = 500;
    const truncatedText = text.length > maxLength
      ? text.substring(0, maxLength).replace(/\s+\S*$/, '...')
      : text;

    // Create abort controller with 10s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${this.baseUrl}/tts-elevenlabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: truncatedText, voice }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.fallback) return null;
        throw new Error(error.message || 'TTS failed');
      }

      return await response.blob();
    } catch (error) {
      clearTimeout(timeoutId);
      // Silently fail for network/timeout errors - fallback to browser TTS
      if (error.name === 'AbortError') {
        console.log('[TTS-Premium] Timeout - using browser fallback');
      } else {
        console.log('[TTS-Premium] Network error - using browser fallback');
      }
      return null;
    }
  }

  /**
   * Whisper STT - Speech to text transcription
   */
  async speechToText(audioBlob) {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');

      const response = await fetch(`${this.baseUrl}/stt`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('STT failed');
      }

      const data = await response.json();
      return data.text;
    } catch (error) {
      console.error('[STT] Error:', error);
      return null;
    }
  }

  /**
   * Get historical statistics for charts
   */
  async getHistoricalStats(period = 30) {
    try {
      const data = await get(`${this.baseUrl}/historical-stats?period=${period}`);
      return data;
    } catch (error) {
      console.error('[HistoricalStats] Error:', error);
      return null;
    }
  }

  /**
   * Get proactive suggestions based on context
   */
  async getSuggestions() {
    try {
      const data = await get(`${this.baseUrl}/suggestions`);
      return data;
    } catch (error) {
      console.error('[Suggestions] Error:', error);
      return { suggestions: [] };
    }
  }

  /**
   * Generate equipment image with AI
   */
  async generateEquipmentImage(equipment, style = 'technical') {
    try {
      const response = await fetch(`${this.baseUrl}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment, style })
      });

      if (!response.ok) {
        throw new Error('Image generation failed');
      }

      return await response.json();
    } catch (error) {
      console.error('[ImageGen] Error:', error);
      return null;
    }
  }

  /**
   * Send notification via browser push API
   */
  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.log('Notifications not supported');
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  /**
   * Show a notification
   */
  showNotification(title, options = {}) {
    // Check if Notification API is available
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return null;
    }

    try {
      const notification = new Notification(title, {
        icon: '/electro-icon.png',
        badge: '/electro-badge.png',
        vibrate: [200, 100, 200],
        ...options
      });

      notification.onclick = () => {
        window.focus();
        if (options.url) {
          window.location.href = options.url;
        }
        notification.close();
      };

      return notification;
    } catch (err) {
      console.error('Notification error:', err);
      return null;
    }
  }

  /**
   * Schedule morning brief notification
   */
  scheduleMorningBrief() {
    const now = new Date();
    const target = new Date();
    target.setHours(8, 0, 0, 0);

    if (now > target) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    setTimeout(async () => {
      const brief = await this.getMorningBrief();
      if (brief && Notification.permission === 'granted') {
        this.showNotification(`${brief.greeting} ! Score: ${brief.healthScore}%`, {
          body: brief.aiInsight || 'Consulte ton brief du matin',
          tag: 'morning-brief',
          url: '/dashboard'
        });
      }
      // Reschedule for next day
      this.scheduleMorningBrief();
    }, delay);
  }

  // ============================================================
  // 🧠 FEEDBACK & LEARNING - Help AI improve
  // ============================================================

  /**
   * Submit feedback on an AI response
   */
  async submitFeedback(messageId, feedback, message, response) {
    try {
      const data = await post(`${this.baseUrl}/feedback`, {
        messageId,
        feedback, // 'positive' or 'negative'
        message,
        response,
        site: this.getCurrentUser()?.site,
        user: this.getCurrentUser()
      });
      return data;
    } catch (error) {
      console.error('[Feedback] Error:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================================
  // 🔮 PREDICTIONS - Risk analysis and forecasting
  // ============================================================

  /**
   * Get AI predictions for equipment risks
   */
  async getPredictions() {
    try {
      const data = await get(`${this.baseUrl}/predictions`);
      return data;
    } catch (error) {
      console.error('[Predictions] Error:', error);
      return { ok: false, predictions: null };
    }
  }

  /**
   * Get ML-based prediction for specific equipment
   */
  async getMLPrediction(equipmentData, type = 'failure') {
    try {
      const data = await post(`${this.baseUrl}/ml/predict`, {
        equipmentData,
        type
      });
      return data;
    } catch (error) {
      console.error('[ML Prediction] Error:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Get pattern analysis from ML service
   */
  async getPatternAnalysis() {
    try {
      const data = await post(`${this.baseUrl}/ml/analyze-patterns`, {
        site: this.getCurrentUser()?.site
      });
      return data;
    } catch (error) {
      console.error('[Pattern Analysis] Error:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================================
  // 👤 USER PROFILE - Personalization data
  // ============================================================

  /**
   * Get user AI profile (memories, preferences, stats)
   */
  async getUserAIProfile() {
    try {
      const user = this.getCurrentUser();
      if (!user?.email) return { ok: false, error: 'Not logged in' };

      const data = await get(`${this.baseUrl}/profile?email=${encodeURIComponent(user.email)}`);
      return data;
    } catch (error) {
      console.error('[Profile] Error:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================================
  // 🔔 PROACTIVE NOTIFICATIONS
  // ============================================================

  /**
   * Check for alerts and show notifications
   */
  async checkForAlerts() {
    try {
      const predictions = await this.getPredictions();

      if (predictions.ok && predictions.predictions?.risks?.high > 0) {
        const highRiskCount = predictions.predictions.risks.high;
        this.showNotification(
          `⚠️ ${highRiskCount} équipement(s) à risque élevé`,
          {
            body: 'Des équipements nécessitent une attention urgente',
            tag: 'risk-alert',
            url: '/controls'
          }
        );
      }

      return predictions;
    } catch (error) {
      console.error('[Alerts] Error:', error);
      return null;
    }
  }

  /**
   * Schedule periodic alert checks
   */
  scheduleAlertChecks(intervalMinutes = 30) {
    // Initial check after 5 seconds
    setTimeout(() => this.checkForAlerts(), 5000);

    // Then check periodically
    setInterval(() => this.checkForAlerts(), intervalMinutes * 60 * 1000);
  }

  // ============================================================
  // 📅 AI PLANNING - Day/Week control scheduling
  // ============================================================

  /**
   * Get AI-generated planning for controls
   * @param {string} period - 'day' or 'week'
   */
  async getAIPlanning(period = 'day') {
    try {
      const data = await get(`${this.baseUrl}/planning?period=${period}`);
      return data;
    } catch (error) {
      console.error('[Planning] Error:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Generate AI planning for controls with procedure recommendations
   */
  async generateControlPlanning(options = {}) {
    try {
      const data = await post(`${this.baseUrl}/generate-planning`, {
        period: options.period || 'week',
        includeRecommendations: true,
        user: this.getCurrentUser()
      });
      return data;
    } catch (error) {
      console.error('[GeneratePlanning] Error:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Get procedure recommendations based on predictions
   */
  async getProcedureRecommendations() {
    try {
      const data = await get(`${this.baseUrl}/procedure-recommendations`);
      return data;
    } catch (error) {
      console.error('[ProcedureRecommendations] Error:', error);
      return { ok: false, recommendations: [] };
    }
  }

  /**
   * Get drafts for procedure creation resumption
   */
  async getProcedureDrafts() {
    try {
      const data = await get('/api/procedures/drafts');
      return data;
    } catch (error) {
      console.error('[Drafts] Error:', error);
      return { ok: false, drafts: [] };
    }
  }

  // ============================================================
  // 🔗 CROSS-MODULE INTEGRATION
  // ============================================================

  /**
   * Get AI recommendations for a specific equipment
   * Links procedures with equipment for intelligent suggestions
   */
  async getEquipmentRecommendations(type, id) {
    try {
      const data = await get(`${this.baseUrl}/equipment-recommendations/${type}/${id}`);
      return data;
    } catch (error) {
      console.error('[EquipmentRecommendations] Error:', error);
      return { ok: false, recommendations: { procedures: [], actions: [], alerts: [] } };
    }
  }

  /**
   * Unified search across all modules
   */
  async unifiedSearch(query, options = {}) {
    try {
      const params = new URLSearchParams({ q: query });
      if (options.types) params.append('types', options.types.join(','));
      if (options.limit) params.append('limit', options.limit);

      const data = await get(`${this.baseUrl}/unified-search?${params}`);
      return data;
    } catch (error) {
      console.error('[UnifiedSearch] Error:', error);
      return { ok: false, results: [], totalResults: 0 };
    }
  }

  /**
   * Get all modules integration status
   */
  async getModulesStatus() {
    try {
      const data = await get(`${this.baseUrl}/modules-status`);
      return data;
    } catch (error) {
      console.error('[ModulesStatus] Error:', error);
      return { ok: false, modules: [] };
    }
  }

  /**
   * Get AI-powered welcome message with context
   */
  async getWelcomeMessage(userName = '') {
    try {
      const data = await get(`${this.baseUrl}/welcome?name=${encodeURIComponent(userName)}`);
      return data;
    } catch (error) {
      console.error('[Welcome] Error:', error);
      return { ok: false, message: 'Bonjour! Comment puis-je vous aider?' };
    }
  }

  /**
   * Get help message and command examples
   */
  async getHelp() {
    try {
      const data = await get(`${this.baseUrl}/help`);
      return data;
    } catch (error) {
      console.error('[Help] Error:', error);
      return { ok: false, message: 'Aide non disponible' };
    }
  }

  /**
   * Get incomplete procedures (drafts) with AI suggestions
   */
  async getIncompleteProcedures() {
    try {
      const data = await get(`${this.baseUrl}/incomplete-procedures`);
      return data;
    } catch (error) {
      console.error('[IncompleteProcedures] Error:', error);
      return { ok: false, drafts: [], message: 'Impossible de charger les brouillons' };
    }
  }

  // ============================================================
  // 📊 ADVANCED CHARTS DATA
  // ============================================================

  /**
   * Get data for trend charts
   */
  async getTrendData(period = 30) {
    try {
      const data = await get(`${this.baseUrl}/historical-stats?period=${period}`);
      return data;
    } catch (error) {
      console.error('[TrendData] Error:', error);
      return null;
    }
  }

  /**
   * Generate chart config for Recharts
   */
  generateChartConfig(type, data) {
    const colors = {
      primary: '#3B82F6',
      success: '#10B981',
      warning: '#F59E0B',
      danger: '#EF4444',
      purple: '#8B5CF6'
    };

    switch (type) {
      case 'trend':
        return {
          type: 'line',
          data: data.controlHistory?.map(d => ({
            date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
            conforme: d.conforme,
            nonConforme: d.nonConforme,
            total: d.total
          })) || [],
          colors: [colors.success, colors.danger, colors.primary]
        };

      case 'buildings':
        return {
          type: 'bar',
          data: data.buildingDistribution?.map(b => ({
            name: b.building || 'N/A',
            equipments: b.count,
            overdue: b.overdue
          })) || [],
          colors: [colors.primary, colors.warning]
        };

      case 'types':
        return {
          type: 'pie',
          data: data.equipmentTypes?.map(t => ({
            name: t.type.toUpperCase(),
            value: t.count
          })) || [],
          colors: [colors.primary, colors.success, colors.warning, colors.purple]
        };

      case 'risks':
        return {
          type: 'gauge',
          data: data.risks || [],
          colors: [colors.success, colors.warning, colors.danger]
        };

      default:
        return null;
    }
  }
}

// Export singleton
export const aiAssistant = new AIAssistant();
export default aiAssistant;
