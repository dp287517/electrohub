// ============================================================
// 🎨 AI RESPONSE TEMPLATES - Beautiful structured responses
// ============================================================
// This module provides beautiful, consistent formatting for AI responses

// ============================================================
// 📊 EMOJI MAPPINGS
// ============================================================

const EMOJIS = {
  // Risk levels
  risk: {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
    unknown: '⚪'
  },

  // Categories
  category: {
    maintenance: '🔧',
    securite: '🛡️',
    general: '📋',
    mise_en_service: '▶️',
    mise_hors_service: '⏹️',
    urgence: '🚨',
    controle: '✅',
    formation: '📚',
    inspection: '🔍',
    nettoyage: '🧹'
  },

  // Equipment types
  equipment: {
    switchboard: '⚡',
    vsd: '🔄',
    atex: '💥',
    meca: '⚙️',
    mobile: '📱',
    hv: '⚡',
    door: '🚪',
    glo: '🌐'
  },

  // Status
  status: {
    success: '✅',
    warning: '⚠️',
    error: '❌',
    info: 'ℹ️',
    pending: '⏳',
    complete: '✓',
    arrow: '→',
    bullet: '•'
  },

  // Actions
  action: {
    search: '🔍',
    create: '➕',
    edit: '✏️',
    delete: '🗑️',
    view: '👁️',
    guide: '📖',
    analyze: '📊',
    plan: '📅',
    alert: '🔔',
    settings: '⚙️'
  },

  // Sections
  section: {
    summary: '📊',
    details: '📝',
    steps: '📋',
    ppe: '🦺',
    tools: '🧰',
    duration: '⏱️',
    location: '📍',
    team: '👥',
    notes: '📌',
    documents: '📄',
    links: '🔗',
    recommendations: '💡',
    history: '📜',
    stats: '📈'
  }
};

// ============================================================
// 🏷️ LABEL MAPPINGS
// ============================================================

const LABELS = {
  risk: {
    critical: 'Critique',
    high: 'Élevé',
    medium: 'Modéré',
    low: 'Faible'
  },

  category: {
    maintenance: 'Maintenance',
    securite: 'Sécurité',
    general: 'Général',
    mise_en_service: 'Mise en service',
    mise_hors_service: 'Mise hors service',
    urgence: 'Urgence',
    controle: 'Contrôle',
    formation: 'Formation',
    inspection: 'Inspection',
    nettoyage: 'Nettoyage'
  },

  equipment: {
    switchboard: 'Tableau électrique',
    vsd: 'Variateur',
    atex: 'Équipement ATEX',
    meca: 'Équipement mécanique',
    mobile: 'Équipement mobile',
    hv: 'Haute tension',
    door: 'Porte coupe-feu',
    glo: 'GLO'
  },

  status: {
    conform: 'Conforme',
    non_conform: 'Non conforme',
    pending: 'En attente',
    overdue: 'En retard',
    scheduled: 'Planifié'
  }
};

// ============================================================
// 📐 FORMATTING HELPERS
// ============================================================

function formatRiskBadge(level) {
  const emoji = EMOJIS.risk[level] || EMOJIS.risk.unknown;
  const label = LABELS.risk[level] || level;
  return `${emoji} ${label}`;
}

function formatCategoryBadge(cat) {
  const key = cat?.toLowerCase().replace(/\s+/g, '_') || 'general';
  const emoji = EMOJIS.category[key] || '📋';
  const label = LABELS.category[key] || cat || 'Général';
  return `${emoji} ${label}`;
}

function formatEquipmentBadge(type) {
  const key = type?.toLowerCase() || 'switchboard';
  const emoji = EMOJIS.equipment[key] || '⚡';
  const label = LABELS.equipment[key] || type;
  return `${emoji} ${label}`;
}

function formatDuration(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return new Intl.NumberFormat('fr-FR').format(num);
}

function createProgressBar(current, total, width = 10) {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function createDivider(char = '─', length = 30) {
  return char.repeat(length);
}

// ============================================================
// 📋 PROCEDURE TEMPLATES
// ============================================================

const ProcedureTemplates = {
  // Search results list
  searchResults(procedures, query) {
    if (!procedures?.length) {
      return `${EMOJIS.action.search} **Aucun résultat pour "${query}"**\n\n` +
        `Je n'ai pas trouvé de procédure correspondant à ta recherche.\n\n` +
        `${EMOJIS.status.arrow} **Suggestions:**\n` +
        `• Essaie avec des termes plus généraux\n` +
        `• Vérifie l'orthographe\n` +
        `• Dis-moi "**créer une procédure**" pour en créer une nouvelle`;
    }

    let response = `${EMOJIS.action.search} **${procedures.length} procédure(s) trouvée(s)**\n\n`;

    procedures.forEach((proc, i) => {
      const riskBadge = formatRiskBadge(proc.risk_level);
      const catBadge = formatCategoryBadge(proc.category);
      const stepCount = proc.steps?.length || 0;

      response += `**${i + 1}.** ${proc.title}\n`;
      response += `   ${catBadge} • ${riskBadge} • ${EMOJIS.section.steps} ${stepCount} étapes\n`;
      if (proc.description) {
        response += `   ${proc.description.substring(0, 80)}${proc.description.length > 80 ? '...' : ''}\n`;
      }
      response += '\n';
    });

    response += `${createDivider()}\n`;
    response += `${EMOJIS.status.arrow} Dis-moi le **numéro** pour voir les détails`;

    return response;
  },

  // Procedure detail view
  procedureDetail(proc) {
    let response = `${EMOJIS.section.details} **${proc.title}**\n\n`;

    // Meta info box
    response += `┌${'─'.repeat(35)}┐\n`;
    response += `│ ${formatCategoryBadge(proc.category).padEnd(33)}│\n`;
    response += `│ ${formatRiskBadge(proc.risk_level).padEnd(33)}│\n`;
    response += `│ ${EMOJIS.section.steps} ${(proc.steps?.length || 0)} étapes${' '.repeat(22)}│\n`;
    if (proc.estimated_time) {
      response += `│ ${EMOJIS.section.duration} ~${formatDuration(proc.estimated_time)}${' '.repeat(20)}│\n`;
    }
    response += `└${'─'.repeat(35)}┘\n\n`;

    // Description
    if (proc.description) {
      response += `${EMOJIS.section.notes} **Description:**\n${proc.description}\n\n`;
    }

    // PPE Required
    if (proc.ppe?.length) {
      response += `${EMOJIS.section.ppe} **Équipements de protection:**\n`;
      proc.ppe.forEach(item => {
        response += `   • ${item}\n`;
      });
      response += '\n';
    }

    // Steps preview
    if (proc.steps?.length) {
      response += `${EMOJIS.section.steps} **Étapes:**\n`;
      proc.steps.slice(0, 5).forEach((step, i) => {
        const duration = step.duration ? ` (${formatDuration(step.duration)})` : '';
        response += `   ${i + 1}. ${step.title}${duration}\n`;
      });
      if (proc.steps.length > 5) {
        response += `   ... et ${proc.steps.length - 5} autres étapes\n`;
      }
      response += '\n';
    }

    response += `${createDivider()}\n`;
    response += `${EMOJIS.action.guide} Dis "**guidage**" pour un accompagnement étape par étape`;

    return response;
  },

  // Guidance step
  guidanceStep(step, currentIndex, totalSteps, procedureTitle) {
    const progress = createProgressBar(currentIndex + 1, totalSteps);
    const isLast = currentIndex === totalSteps - 1;

    let response = `${EMOJIS.action.guide} **${procedureTitle}**\n`;
    response += `${progress} Étape ${currentIndex + 1}/${totalSteps}\n\n`;

    response += `${'═'.repeat(35)}\n`;
    response += `**${step.title}**\n`;
    response += `${'═'.repeat(35)}\n\n`;

    // Instructions
    if (step.instructions) {
      response += `${EMOJIS.section.details} **Instructions:**\n${step.instructions}\n\n`;
    }

    // Duration
    if (step.duration) {
      response += `${EMOJIS.section.duration} Durée estimée: **${formatDuration(step.duration)}**\n\n`;
    }

    // Warnings
    if (step.warnings?.length) {
      response += `${EMOJIS.status.warning} **Attention:**\n`;
      step.warnings.forEach(w => {
        response += `   ⚠️ ${w}\n`;
      });
      response += '\n';
    }

    // Notes
    if (step.notes) {
      response += `${EMOJIS.section.notes} **Notes:** ${step.notes}\n\n`;
    }

    response += `${createDivider()}\n`;
    if (isLast) {
      response += `${EMOJIS.status.success} C'est la **dernière étape**! Dis "**terminé**" quand tu as fini.`;
    } else {
      response += `${EMOJIS.status.arrow} Dis "**suivant**" quand tu as terminé cette étape`;
    }

    return response;
  },

  // Step completion
  stepComplete(stepNumber, totalSteps) {
    return `${EMOJIS.status.complete} **Étape ${stepNumber}/${totalSteps} terminée!**`;
  },

  // Procedure complete
  procedureComplete(title) {
    return `\n${'🎉'.repeat(3)}\n\n` +
      `**Procédure terminée avec succès!**\n\n` +
      `Tu as complété: **${title}**\n\n` +
      `${EMOJIS.status.arrow} Que veux-tu faire maintenant?\n` +
      `• Enregistrer un rapport de contrôle\n` +
      `• Chercher une autre procédure\n` +
      `• Retourner au dashboard`;
  }
};

// ============================================================
// 📈 DASHBOARD & STATS TEMPLATES
// ============================================================

const DashboardTemplates = {
  // Morning brief summary
  morningBrief(data) {
    let response = `${EMOJIS.section.summary} **Brief du Matin**\n`;
    response += `${formatDate(new Date())}\n\n`;

    // Urgent alerts
    if (data.urgentAlerts?.length) {
      response += `${EMOJIS.action.alert} **Alertes Urgentes** (${data.urgentAlerts.length})\n`;
      response += `${'─'.repeat(30)}\n`;
      data.urgentAlerts.slice(0, 3).forEach(alert => {
        response += `${EMOJIS.risk.critical} ${alert.message}\n`;
      });
      response += '\n';
    }

    // Today's controls
    response += `${EMOJIS.section.stats} **Contrôles du jour**\n`;
    response += `${'─'.repeat(30)}\n`;
    response += `• Planifiés: **${data.todayControls || 0}**\n`;
    response += `• En retard: **${data.overdueControls || 0}** ${data.overdueControls > 0 ? '⚠️' : ''}\n`;
    response += `• Complétés cette semaine: **${data.weeklyCompleted || 0}**\n\n`;

    // Equipment status
    response += `${EMOJIS.equipment.switchboard} **Statut Équipements**\n`;
    response += `${'─'.repeat(30)}\n`;
    response += `• Total: **${formatNumber(data.totalEquipment || 0)}**\n`;
    response += `• À contrôler: **${data.toControl || 0}**\n`;
    response += `• Conformes: **${data.conformRate || 0}%**\n\n`;

    // Recommendations
    if (data.recommendations?.length) {
      response += `${EMOJIS.section.recommendations} **Recommandations IA**\n`;
      response += `${'─'.repeat(30)}\n`;
      data.recommendations.slice(0, 3).forEach(rec => {
        response += `${EMOJIS.status.bullet} ${rec}\n`;
      });
    }

    return response;
  },

  // Control statistics
  controlStats(stats) {
    let response = `${EMOJIS.section.stats} **Statistiques de Contrôle**\n\n`;

    // Period summary
    response += `**Période:** ${stats.period || '30 derniers jours'}\n\n`;

    // Progress bar
    const conformRate = stats.conformRate || 0;
    response += `**Taux de conformité:**\n`;
    response += `${createProgressBar(conformRate, 100, 20)} ${conformRate}%\n\n`;

    // Breakdown
    response += `${EMOJIS.status.success} Conformes: **${stats.conform || 0}**\n`;
    response += `${EMOJIS.status.error} Non-conformes: **${stats.nonConform || 0}**\n`;
    response += `${EMOJIS.status.pending} En attente: **${stats.pending || 0}**\n\n`;

    // Trend
    if (stats.trend) {
      const trendEmoji = stats.trend > 0 ? '📈' : stats.trend < 0 ? '📉' : '➡️';
      response += `${trendEmoji} **Tendance:** ${stats.trend > 0 ? '+' : ''}${stats.trend}% vs période précédente`;
    }

    return response;
  },

  // Risk analysis
  riskAnalysis(risks) {
    let response = `${EMOJIS.section.stats} **Analyse des Risques**\n\n`;

    if (!risks?.length) {
      response += `${EMOJIS.status.success} Aucun équipement à risque élevé détecté.\n`;
      return response;
    }

    response += `**${risks.length} équipement(s) à surveiller:**\n\n`;

    risks.slice(0, 5).forEach((risk, i) => {
      const riskEmoji = risk.riskScore >= 0.7 ? EMOJIS.risk.critical :
                        risk.riskScore >= 0.5 ? EMOJIS.risk.high : EMOJIS.risk.medium;

      response += `**${i + 1}. ${risk.name}**\n`;
      response += `   ${riskEmoji} Score: ${(risk.riskScore * 100).toFixed(0)}%\n`;
      response += `   ${EMOJIS.section.location} ${risk.building || 'N/A'}\n`;
      response += `   ${EMOJIS.section.recommendations} ${risk.recommendation}\n\n`;
    });

    if (risks.length > 5) {
      response += `... et ${risks.length - 5} autres équipements\n`;
    }

    return response;
  },

  // Planning view
  weeklyPlanning(planning) {
    let response = `${EMOJIS.section.plan} **Planning de la Semaine**\n\n`;

    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

    days.forEach(day => {
      const dayData = planning[day.toLowerCase()] || [];
      const count = dayData.length;

      response += `**${day}** `;
      if (count === 0) {
        response += `${EMOJIS.status.success} Libre\n`;
      } else {
        response += `(${count} contrôle${count > 1 ? 's' : ''})\n`;
        dayData.slice(0, 2).forEach(ctrl => {
          response += `   ${EMOJIS.status.bullet} ${ctrl.equipment} - ${ctrl.type}\n`;
        });
        if (count > 2) {
          response += `   ... +${count - 2} autres\n`;
        }
      }
    });

    return response;
  }
};

// ============================================================
// 🔌 EQUIPMENT TEMPLATES
// ============================================================

const EquipmentTemplates = {
  // Equipment detail
  equipmentDetail(equipment, type = 'switchboard') {
    const typeEmoji = EMOJIS.equipment[type] || EMOJIS.equipment.switchboard;
    const typeLabel = LABELS.equipment[type] || type;

    let response = `${typeEmoji} **${equipment.name}**\n`;
    response += `${typeLabel}\n\n`;

    // Location info
    response += `${EMOJIS.section.location} **Localisation:**\n`;
    response += `   Bâtiment: ${equipment.building || 'N/A'}\n`;
    if (equipment.floor) response += `   Étage: ${equipment.floor}\n`;
    if (equipment.room) response += `   Local: ${equipment.room}\n`;
    response += '\n';

    // Status
    response += `${EMOJIS.section.stats} **Statut:**\n`;
    const statusEmoji = equipment.status === 'conform' ? EMOJIS.status.success : EMOJIS.status.warning;
    response += `   ${statusEmoji} ${LABELS.status[equipment.status] || equipment.status}\n`;
    if (equipment.lastControl) {
      response += `   Dernier contrôle: ${formatDate(equipment.lastControl)}\n`;
    }
    response += '\n';

    // Additional info based on type
    if (type === 'atex' && equipment.zone) {
      response += `${EMOJIS.status.warning} **Zone ATEX:** ${equipment.zone}\n\n`;
    }

    if (type === 'vsd' && equipment.power) {
      response += `${EMOJIS.equipment.vsd} **Puissance:** ${equipment.power} kW\n\n`;
    }

    // Recommendations
    if (equipment.recommendations?.length) {
      response += `${EMOJIS.section.recommendations} **Recommandations:**\n`;
      equipment.recommendations.forEach(rec => {
        response += `   ${EMOJIS.status.bullet} ${rec}\n`;
      });
    }

    return response;
  },

  // Equipment list
  equipmentList(equipments, type = 'switchboard') {
    const typeEmoji = EMOJIS.equipment[type] || EMOJIS.equipment.switchboard;
    const typeLabel = LABELS.equipment[type] || type;

    let response = `${typeEmoji} **${equipments.length} ${typeLabel}(s)**\n\n`;

    equipments.slice(0, 10).forEach((eq, i) => {
      const statusEmoji = eq.status === 'conform' ? EMOJIS.status.success :
                          eq.status === 'overdue' ? EMOJIS.status.warning : EMOJIS.status.info;
      response += `${i + 1}. **${eq.name}** ${statusEmoji}\n`;
      response += `   ${EMOJIS.section.location} ${eq.building || 'N/A'}`;
      if (eq.lastControl) {
        response += ` • ${formatDate(eq.lastControl)}`;
      }
      response += '\n';
    });

    if (equipments.length > 10) {
      response += `\n... et ${equipments.length - 10} autres`;
    }

    return response;
  }
};

// ============================================================
// 💬 CONVERSATION TEMPLATES
// ============================================================

const ConversationTemplates = {
  // Welcome message
  welcome(userName) {
    return `👋 **Bonjour${userName ? ` ${userName}` : ''}!**\n\n` +
      `Je suis **IA Électro**, ton assistant intelligent pour la gestion électrique.\n\n` +
      `${EMOJIS.status.arrow} **Je peux t'aider à:**\n` +
      `• ${EMOJIS.action.search} Chercher et consulter des procédures\n` +
      `• ${EMOJIS.action.guide} Te guider étape par étape\n` +
      `• ${EMOJIS.action.analyze} Analyser tes équipements\n` +
      `• ${EMOJIS.action.plan} Planifier tes contrôles\n\n` +
      `Comment puis-je t'aider aujourd'hui?`;
  },

  // Error message
  error(message) {
    return `${EMOJIS.status.error} **Oops!**\n\n` +
      `${message || 'Une erreur est survenue.'}\n\n` +
      `${EMOJIS.status.arrow} Essaie de reformuler ta demande ou contacte le support.`;
  },

  // Not found
  notFound(item) {
    return `${EMOJIS.status.warning} **Non trouvé**\n\n` +
      `Je n'ai pas pu trouver ${item || 'cet élément'}.\n\n` +
      `${EMOJIS.status.arrow} Vérifie l'orthographe ou essaie avec d'autres termes.`;
  },

  // Confirmation
  confirmation(action, details) {
    return `${EMOJIS.status.success} **${action}**\n\n` +
      `${details || ''}\n\n` +
      `${EMOJIS.status.arrow} Que veux-tu faire ensuite?`;
  },

  // Loading
  loading(action) {
    return `${EMOJIS.status.pending} ${action || 'Chargement en cours...'}`;
  },

  // Help
  help() {
    return `${EMOJIS.status.info} **Aide - IA Électro**\n\n` +
      `**Commandes disponibles:**\n\n` +
      `${EMOJIS.action.search} **Recherche:**\n` +
      `   "cherche procédure maintenance"\n` +
      `   "trouve contrôle ATEX"\n\n` +
      `${EMOJIS.action.guide} **Guidage:**\n` +
      `   "guide-moi pour [procédure]"\n` +
      `   "suivant" / "précédent"\n\n` +
      `${EMOJIS.action.create} **Création:**\n` +
      `   "créer une procédure"\n` +
      `   "nouvelle procédure maintenance"\n\n` +
      `${EMOJIS.action.analyze} **Analyse:**\n` +
      `   "montre les statistiques"\n` +
      `   "analyse des risques"\n` +
      `   "brief du matin"\n\n` +
      `${EMOJIS.action.plan} **Planification:**\n` +
      `   "planning de la semaine"\n` +
      `   "contrôles en retard"`;
  }
};

// ============================================================
// 🔗 INTEGRATION STATUS TEMPLATES
// ============================================================

const IntegrationTemplates = {
  // Module status overview
  moduleStatus() {
    return `${EMOJIS.section.stats} **Intégrations IA - État des Modules**\n\n` +
      `${EMOJIS.status.success} **Pleinement intégrés:**\n` +
      `   • ${EMOJIS.equipment.switchboard} Tableaux électriques\n` +
      `   • ${EMOJIS.equipment.vsd} Variateurs (VSD)\n` +
      `   • ${EMOJIS.equipment.atex} Équipements ATEX\n` +
      `   • ${EMOJIS.equipment.meca} Équipements mécaniques\n` +
      `   • ${EMOJIS.equipment.mobile} Équipements mobiles\n` +
      `   • ${EMOJIS.equipment.hv} Haute tension\n` +
      `   • ${EMOJIS.equipment.door} Portes coupe-feu\n` +
      `   • 📋 Procédures\n` +
      `   • 📊 Dashboard & Analytics\n\n` +
      `${EMOJIS.status.warning} **Partiellement intégrés:**\n` +
      `   • 🔗 DCF-SAP (lecture seule)\n` +
      `   • 📚 Formation ATEX (éducatif)\n` +
      `   • 🌐 Ask Veeva (recherche web)\n\n` +
      `${EMOJIS.status.pending} **En développement:**\n` +
      `   • 👷 Gestion des prestataires\n` +
      `   • 📅 Planification avancée\n` +
      `   • 🤖 Auto-apprentissage`;
  }
};

// ============================================================
// 📤 EXPORTS
// ============================================================

module.exports = {
  EMOJIS,
  LABELS,

  // Helpers
  formatRiskBadge,
  formatCategoryBadge,
  formatEquipmentBadge,
  formatDuration,
  formatDate,
  formatNumber,
  createProgressBar,
  createDivider,

  // Templates
  ProcedureTemplates,
  DashboardTemplates,
  EquipmentTemplates,
  ConversationTemplates,
  IntegrationTemplates
};
