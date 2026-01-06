/**
 * ============================================================================
 * ELECTROHUB AI TOOLS - Function Calling System
 * ============================================================================
 *
 * Ce fichier définit tous les tools (fonctions) que l'IA peut appeler
 * pour accéder aux données réelles de la base de données.
 *
 * Architecture:
 * 1. TOOLS_DEFINITIONS - Schémas OpenAI des fonctions disponibles
 * 2. TOOL_HANDLERS - Implémentations des fonctions
 * 3. executeToolCall() - Exécuteur de tools
 * 4. formatToolResult() - Formateur de résultats pour l'IA
 */

// ============================================================================
// TOOLS DEFINITIONS - Schémas OpenAI pour Function Calling
// ============================================================================

const TOOLS_DEFINITIONS = [
  // -------------------------------------------------------------------------
  // DÉPANNAGES / INTERVENTIONS
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "search_troubleshooting",
      description: `Recherche les dépannages, interventions, réparations, pannes ou incidents dans l'historique.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "derniers dépannages", "interventions récentes", "pannes de la semaine"
- "panne", "incident", "défaillance", "problème", "dysfonctionnement"
- "qu'est-ce qui a été réparé", "problèmes résolus"
- "breakdown", "failure", "issue", "trouble"
- "historique des interventions", "dépannages critiques"
- "combien de pannes", "fréquence des pannes"
- Toute question sur des réparations passées, pannes ou incidents`,
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Nombre de jours à remonter dans l'historique (défaut: 7, utilise 30 ou 90 pour plus de données)"
          },
          severity: {
            type: "string",
            enum: ["critical", "major", "minor", "all"],
            description: "Niveau de sévérité à filtrer. 'all' pour tous les niveaux."
          },
          building: {
            type: "string",
            description: "Code du bâtiment pour filtrer (ex: '02', '20', 'B01')"
          },
          equipment_name: {
            type: "string",
            description: "Nom ou partie du nom de l'équipement à chercher"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "all"],
            description: "Type d'équipement (variateur=vsd, tableau=switchboard)"
          },
          limit: {
            type: "number",
            description: "Nombre maximum de résultats (défaut: 10, max: 50)"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // ANALYSE DE FIABILITÉ ÉQUIPEMENTS
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "analyze_equipment_reliability",
      description: `Analyse la fiabilité des équipements : trouve les plus problématiques, ceux avec le plus de pannes.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "équipement avec le plus de pannes", "le plus problématique"
- "équipements les moins fiables", "les plus défaillants"
- "quel VSD tombe le plus en panne", "variateur problématique"
- "classement par nombre de pannes", "top des pannes"
- "analyse de fiabilité", "MTBF", "taux de panne"
- "quel tableau a le plus de problèmes"
- Toute analyse comparative de fiabilité entre équipements`,
      parameters: {
        type: "object",
        properties: {
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "all"],
            description: "Type d'équipement à analyser (variateur=vsd, tableau=switchboard)"
          },
          period_days: {
            type: "number",
            description: "Période d'analyse en jours (défaut: 90)"
          },
          building: {
            type: "string",
            description: "Filtrer par bâtiment"
          },
          top_n: {
            type: "number",
            description: "Nombre d'équipements à retourner dans le classement (défaut: 10)"
          },
          metric: {
            type: "string",
            enum: ["failure_count", "downtime", "severity_score"],
            description: "Métrique de classement: nombre de pannes, temps d'arrêt, ou score de sévérité"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // ANALYSE PAR BÂTIMENT
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "analyze_by_building",
      description: `Analyse les données par bâtiment : pannes, contrôles, NC, équipements.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "analyse par bâtiment", "comparaison des bâtiments"
- "quel bâtiment a le plus de pannes/problèmes"
- "état du bâtiment X", "situation par bâtiment"
- "répartition par bâtiment", "distribution géographique"
- "bâtiment le plus critique", "zone à problèmes"
- Toute comparaison ou analyse par localisation`,
      parameters: {
        type: "object",
        properties: {
          analysis_type: {
            type: "string",
            enum: ["failures", "controls", "nc", "equipment_count", "overview"],
            description: "Type d'analyse: pannes, contrôles, NC, comptage équipements, ou vue globale"
          },
          period_days: {
            type: "number",
            description: "Période d'analyse en jours (défaut: 30)"
          },
          building: {
            type: "string",
            description: "Bâtiment spécifique à analyser (sinon tous)"
          },
          generate_chart: {
            type: "boolean",
            description: "Générer un graphique comparatif"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // PRIORITÉS DE MAINTENANCE
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_maintenance_priorities",
      description: `Identifie les priorités de maintenance : équipements nécessitant attention urgente.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "quels équipements nécessitent plus de maintenance"
- "priorités de maintenance", "urgences maintenance"
- "qu'est-ce qui a besoin d'attention", "à surveiller"
- "équipements critiques", "risque de panne"
- "planning de maintenance recommandé"
- "où concentrer les efforts", "quoi réparer en premier"
- Toute question sur les priorités ou recommandations de maintenance`,
      parameters: {
        type: "object",
        properties: {
          criteria: {
            type: "string",
            enum: ["overdue_controls", "frequent_failures", "old_equipment", "high_severity_nc", "combined"],
            description: "Critère de priorisation: contrôles en retard, pannes fréquentes, équipements vieux, NC critiques, ou combiné"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "all"],
            description: "Type d'équipement à analyser"
          },
          building: {
            type: "string",
            description: "Filtrer par bâtiment"
          },
          limit: {
            type: "number",
            description: "Nombre de résultats (défaut: 15)"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // PROCÉDURES
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "search_procedures",
      description: `Recherche des procédures opérationnelles par mots-clés ou catégorie.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "procédure pour...", "comment faire...", "méthode pour..."
- "procédure de maintenance", "procédure de contrôle"
- "existe-t-il une procédure", "cherche procédure"
- Toute question sur des procédures ou modes opératoires`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Mots-clés de recherche (ex: 'prise électrique', 'maintenance pompe')"
          },
          category: {
            type: "string",
            enum: ["maintenance", "securite", "general", "mise_en_service", "mise_hors_service", "urgence", "controle", "formation", "inspection", "nettoyage"],
            description: "Catégorie de procédure à filtrer"
          },
          risk_level: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "Niveau de risque à filtrer"
          },
          limit: {
            type: "number",
            description: "Nombre maximum de résultats (défaut: 10)"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_procedure_details",
      description: `Récupère les détails complets d'une procédure spécifique avec toutes ses étapes.

UTILISE CETTE FONCTION QUAND:
- L'utilisateur veut voir une procédure spécifique
- Après une recherche, pour afficher les détails
- Pour préparer un guidage étape par étape`,
      parameters: {
        type: "object",
        properties: {
          procedure_id: {
            type: "string",
            description: "ID de la procédure (UUID)"
          },
          procedure_title: {
            type: "string",
            description: "Titre de la procédure (si l'ID n'est pas connu)"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_procedure_modal",
      description: `Ouvre le modal de visualisation d'une procédure dans l'interface utilisateur.

UTILISE CETTE FONCTION QUAND:
- L'utilisateur dit "ouvre", "montre-moi", "affiche" une procédure
- Après avoir trouvé la bonne procédure et vouloir l'afficher`,
      parameters: {
        type: "object",
        properties: {
          procedure_id: {
            type: "string",
            description: "ID de la procédure à ouvrir"
          },
          start_guidance: {
            type: "boolean",
            description: "Si true, démarre immédiatement le guidage étape par étape"
          }
        },
        required: ["procedure_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_procedure",
      description: `Ouvre l'assistant de création de nouvelle procédure.

UTILISE CETTE FONCTION QUAND:
- L'utilisateur veut créer/ajouter/faire une nouvelle procédure
- Aucune procédure existante ne correspond au besoin`,
      parameters: {
        type: "object",
        properties: {
          suggested_title: {
            type: "string",
            description: "Titre suggéré pour la nouvelle procédure"
          },
          category: {
            type: "string",
            enum: ["maintenance", "securite", "general", "mise_en_service", "mise_hors_service", "urgence", "controle", "formation"],
            description: "Catégorie suggérée"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // ÉQUIPEMENTS
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "search_equipment",
      description: `Recherche des équipements (tableaux électriques, variateurs, portes, etc.).

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "où est le tableau...", "trouve l'équipement..."
- "équipements du bâtiment X", "tableaux de l'étage Y"
- "liste des variateurs", "équipements ATEX"
- Quand un dépannage mentionne un équipement et tu veux le retrouver
- Toute question sur la localisation ou l'état d'équipements

ASTUCE: Si tu ne connais pas le type, ne le spécifie pas et utilise juste le nom - la recherche ira chercher dans TOUS les types.`,
      parameters: {
        type: "object",
        properties: {
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "glo", "datahub"],
            description: "Type d'équipement à chercher (OPTIONNEL - si non spécifié, cherche dans tous les types)"
          },
          building: {
            type: "string",
            description: "Code du bâtiment (ex: '02', '20')"
          },
          floor: {
            type: "string",
            description: "Étage (ex: '0', '1', '-1', 'RDC')"
          },
          name: {
            type: "string",
            description: "Nom ou partie du nom de l'équipement"
          },
          code: {
            type: "string",
            description: "Code/Tag de l'équipement"
          },
          limit: {
            type: "number",
            description: "Nombre maximum de résultats (défaut: 20)"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_equipment_details",
      description: `Récupère les détails complets d'un équipement spécifique.

UTILISE CETTE FONCTION pour obtenir:
- Informations techniques détaillées
- Historique des contrôles
- Non-conformités associées
- Documentation liée`,
      parameters: {
        type: "object",
        properties: {
          equipment_id: {
            type: "string",
            description: "ID de l'équipement"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "glo", "door"],
            description: "Type d'équipement"
          },
          include_history: {
            type: "boolean",
            description: "Inclure l'historique des contrôles"
          },
          include_nc: {
            type: "boolean",
            description: "Inclure les non-conformités"
          }
        },
        required: ["equipment_id", "equipment_type"]
      }
    }
  },

  // -------------------------------------------------------------------------
  // CONTRÔLES (centralisés dans Switchboard Controls)
  // IMPORTANT: Tous les contrôles sont gérés depuis "Switchboard Controls"
  // Tous les agents (mobile, vsd, meca, etc.) peuvent consulter ces données
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_controls",
      description: `Récupère les contrôles planifiés, en retard ou à venir.

⚠️ IMPORTANT: Tous les contrôles sont centralisés dans "Switchboard Controls".
Même si tu es un agent spécialisé (mobile, vsd, meca...), tu peux et dois utiliser cette fonction
pour répondre aux questions sur l'état des contrôles, les retards, les plannings.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "contrôles en retard", "équipements à contrôler"
- "planning des contrôles", "contrôles de la semaine"
- "qu'est-ce que je dois faire aujourd'hui"
- "quel est l'état de cet équipement" (pour les contrôles)
- "y a-t-il des contrôles en retard ?"
- "prochain contrôle prévu", "échéances"
- Toute question sur les contrôles ou la planification`,
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["overdue", "today", "this_week", "this_month", "next_30_days", "all"],
            description: "Filtre temporel pour les contrôles"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "all"],
            description: "Type d'équipement contexte (pour info, tous les contrôles viennent de Switchboard Controls)"
          },
          building: {
            type: "string",
            description: "Code du bâtiment pour filtrer (très utile pour contextualiser)"
          },
          equipment_id: {
            type: "string",
            description: "ID spécifique d'un switchboard pour filtrer ses contrôles"
          },
          limit: {
            type: "number",
            description: "Nombre maximum de résultats (défaut: 20)"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // CARTE / NAVIGATION
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "show_map",
      description: `Affiche la carte/plan avec la localisation d'équipements.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "montre sur la carte", "voir le plan"
- "où se trouve...", "localisation de..."
- "carte du bâtiment X"`,
      parameters: {
        type: "object",
        properties: {
          building: {
            type: "string",
            description: "Code du bâtiment à afficher"
          },
          floor: {
            type: "string",
            description: "Étage à afficher"
          },
          equipment_ids: {
            type: "array",
            items: { type: "string" },
            description: "Liste des IDs d'équipements à mettre en évidence"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "mobile"],
            description: "Type d'équipement pour le contexte"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // NON-CONFORMITÉS
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_non_conformities",
      description: `Récupère les non-conformités (NC) ouvertes ou résolues.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "NC en cours", "non-conformités à traiter"
- "NC ATEX", "problèmes de conformité"
- "état des NC", "NC critiques"`,
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["open", "in_progress", "resolved", "all"],
            description: "Statut des NC à filtrer"
          },
          severity: {
            type: "string",
            enum: ["critical", "major", "minor", "all"],
            description: "Sévérité des NC"
          },
          equipment_type: {
            type: "string",
            description: "Type d'équipement concerné"
          },
          building: {
            type: "string",
            description: "Bâtiment concerné"
          },
          limit: {
            type: "number",
            description: "Nombre maximum de résultats"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // STATISTIQUES & DASHBOARD
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_statistics",
      description: `Récupère des statistiques globales ou par catégorie.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "statistiques", "résumé", "vue d'ensemble"
- "combien de...", "état global"
- "analyse", "tendances"`,
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["overview", "controls", "equipment", "procedures", "troubleshooting", "nc"],
            description: "Type de statistiques à récupérer"
          },
          period: {
            type: "string",
            enum: ["today", "week", "month", "quarter", "year"],
            description: "Période pour les statistiques"
          },
          building: {
            type: "string",
            description: "Filtrer par bâtiment"
          },
          generate_chart: {
            type: "boolean",
            description: "Générer un graphique avec les données"
          },
          chart_type: {
            type: "string",
            enum: ["bar", "pie", "line", "doughnut"],
            description: "Type de graphique à générer"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // RECHERCHE DOCUMENTATION
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "search_documentation",
      description: `Recherche de la documentation technique (fiches techniques, manuels).

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "documentation pour...", "fiche technique de..."
- "manuel du...", "datasheet"
- Toute demande de documentation technique`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Termes de recherche (marque, modèle, référence)"
          },
          manufacturer: {
            type: "string",
            description: "Fabricant (Schneider, ABB, Siemens, etc.)"
          },
          equipment_type: {
            type: "string",
            description: "Type d'équipement"
          }
        },
        required: ["query"]
      }
    }
  },

  // -------------------------------------------------------------------------
  // MÉMOIRE AGENTS - Accès à l'historique et apprentissages
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_agent_memory",
      description: `Récupère la mémoire persistante de l'agent: insights, apprentissages, patterns identifiés.

UTILISE CETTE FONCTION QUAND:
- Tu as besoin de contexte historique pour répondre
- L'utilisateur demande "qu'est-ce que tu as appris", "tes observations"
- Tu veux vérifier si un pattern a déjà été identifié
- Tu prépares un brief du matin

Cette fonction te donne accès à ta mémoire long-terme.`,
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            enum: ["electro", "meca", "hv", "vsd", "atex", "mobile", "doors", "datahub", "switchboards", "glo"],
            description: "Type d'agent dont on veut la mémoire (utilise ton propre type)"
          },
          memory_type: {
            type: "string",
            enum: ["pattern", "insight", "kpi", "recommendation", "alert", "all"],
            description: "Type de mémoire à récupérer (défaut: all)"
          },
          days: {
            type: "number",
            description: "Nombre de jours d'historique (défaut: 30)"
          },
          limit: {
            type: "number",
            description: "Nombre max de résultats (défaut: 20)"
          }
        },
        required: ["agent_type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_yesterday_summary",
      description: `Récupère le résumé des activités et dépannages de la veille pour un agent.

UTILISE CETTE FONCTION QUAND:
- L'utilisateur demande "qu'est-ce qui s'est passé hier"
- Pour le brief du matin
- Pour faire un tour de table
- Electro veut savoir ce que les autres agents ont fait

Retourne les dépannages, incidents et statistiques de la veille.`,
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            enum: ["electro", "meca", "hv", "vsd", "atex", "mobile", "doors", "datahub", "switchboards", "glo", "all"],
            description: "Type d'agent (utilise 'all' pour tour de table complet)"
          }
        },
        required: ["agent_type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "record_agent_insight",
      description: `Enregistre un nouvel apprentissage ou insight dans la mémoire de l'agent.

UTILISE CETTE FONCTION QUAND:
- Tu identifies un pattern récurrent
- Tu fais une observation importante sur un équipement
- Tu veux te souvenir d'une information pour plus tard
- Tu calcules un KPI intéressant

Cela te permet de construire ta mémoire long-terme.`,
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            enum: ["electro", "meca", "hv", "vsd", "atex", "mobile", "doors", "datahub", "switchboards", "glo"],
            description: "Ton type d'agent"
          },
          memory_type: {
            type: "string",
            enum: ["pattern", "insight", "kpi", "recommendation", "alert"],
            description: "Type de mémoire à enregistrer"
          },
          content: {
            type: "string",
            description: "Contenu de l'insight/apprentissage à mémoriser"
          },
          related_equipment: {
            type: "string",
            description: "Équipement concerné (optionnel)"
          },
          importance: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "Niveau d'importance (défaut: medium)"
          }
        },
        required: ["agent_type", "memory_type", "content"]
      }
    }
  },

  // -------------------------------------------------------------------------
  // TRANSFERT VERS AGENT SPÉCIALISÉ
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "transfer_to_agent",
      description: `Transfère l'utilisateur vers l'agent IA spécialisé d'un équipement.

UTILISE CETTE FONCTION QUAND:
- L'utilisateur dit "je veux parler à l'agent de cet équipement"
- L'utilisateur veut plus de détails d'un agent spécialisé
- Tu as identifié un équipement et l'utilisateur veut interagir avec son agent
- Suite à un dépannage, l'utilisateur veut en savoir plus via l'agent

Cette fonction retourne les informations pour ouvrir le chat avec l'agent spécialisé.`,
      parameters: {
        type: "object",
        properties: {
          equipment_id: {
            type: "string",
            description: "ID de l'équipement"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "glo", "datahub", "doors"],
            description: "Type d'équipement"
          },
          equipment_name: {
            type: "string",
            description: "Nom de l'équipement pour affichage"
          },
          context: {
            type: "string",
            description: "Contexte à transmettre à l'agent (ex: 'suite au dépannage du 05/01')"
          }
        },
        required: ["equipment_type", "equipment_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_troubleshooting_equipment_context",
      description: `Récupère le contexte complet d'un équipement mentionné dans un dépannage.

UTILISE CETTE FONCTION QUAND:
- Un dépannage mentionne un équipement et tu veux en savoir plus
- L'utilisateur veut parler à l'agent d'un équipement du dépannage
- Tu dois retrouver les infos complètes d'un équipement depuis un dépannage

Cette fonction cherche l'équipement dans toutes les tables et retourne son contexte complet.`,
      parameters: {
        type: "object",
        properties: {
          troubleshooting_id: {
            type: "string",
            description: "ID du dépannage (si connu)"
          },
          equipment_name: {
            type: "string",
            description: "Nom de l'équipement mentionné dans le dépannage"
          },
          equipment_type: {
            type: "string",
            description: "Type d'équipement si connu (ex: 'door', 'vsd', etc.)"
          }
        },
        required: ["equipment_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "find_agent_by_name",
      description: `Trouve un agent IA par son nom personnalisé.

UTILISE CETTE FONCTION QUAND:
- L'utilisateur demande "passe-moi Daniel", "je veux parler à Baptiste"
- L'utilisateur mentionne un nom qui pourrait être un agent IA
- Tu ne reconnais pas le nom comme un équipement

Cette fonction retourne l'agent correspondant au nom donné.`,
      parameters: {
        type: "object",
        properties: {
          agent_name: {
            type: "string",
            description: "Nom de l'agent à chercher (ex: 'Daniel', 'Baptiste', 'Shakira')"
          }
        },
        required: ["agent_name"]
      }
    }
  }
];

// ============================================================================
// TOOL HANDLERS - Implémentations des fonctions
// ============================================================================

/**
 * Crée les handlers de tools avec accès au pool de connexion et au site
 */
function createToolHandlers(pool, site) {
  return {
    // -----------------------------------------------------------------------
    // DÉPANNAGES
    // -----------------------------------------------------------------------
    search_troubleshooting: async (params) => {
      const { days = 7, severity, building, equipment_name, limit = 10 } = params;

      let query = `
        SELECT
          tr.id, tr.title, tr.description, tr.severity, tr.status,
          tr.solution, tr.technician_name, tr.started_at, tr.completed_at,
          tr.equipment_id, tr.equipment_type, tr.equipment_name,
          tr.building_code, tr.floor, tr.duration_minutes
        FROM troubleshooting_records tr
        WHERE tr.site = $1
          AND tr.started_at >= NOW() - INTERVAL '${parseInt(days)} days'
      `;
      const queryParams = [site];
      let paramIndex = 2;

      if (severity && severity !== 'all') {
        query += ` AND tr.severity = $${paramIndex}`;
        queryParams.push(severity);
        paramIndex++;
      }

      if (building) {
        query += ` AND UPPER(tr.building_code) = $${paramIndex}`;
        queryParams.push(building.toUpperCase());
        paramIndex++;
      }

      if (equipment_name) {
        query += ` AND LOWER(tr.equipment_name) LIKE $${paramIndex}`;
        queryParams.push(`%${equipment_name.toLowerCase()}%`);
        paramIndex++;
      }

      query += ` ORDER BY tr.started_at DESC LIMIT ${Math.min(parseInt(limit) || 10, 50)}`;

      try {
        const result = await pool.query(query, queryParams);

        return {
          success: true,
          count: result.rows.length,
          period_days: days,
          filters_applied: { severity, building, equipment_name },
          records: result.rows.map(r => ({
            id: r.id,
            title: r.title,
            description: r.description?.substring(0, 200),
            severity: r.severity,
            status: r.status,
            solution: r.solution?.substring(0, 200),
            technician: r.technician_name,
            equipment: r.equipment_name,
            equipment_id: r.equipment_id,
            equipment_type: r.equipment_type,
            building: r.building_code,
            floor: r.floor,
            date: r.started_at,
            completed_at: r.completed_at,
            duration_minutes: r.duration_minutes
          })),
          // Message formaté pour l'IA
          summary: result.rows.length === 0
            ? `Aucun dépannage trouvé sur les ${days} derniers jours.`
            : `${result.rows.length} dépannage(s) trouvé(s) sur les ${days} derniers jours.`
        };
      } catch (error) {
        console.error('[TOOL] search_troubleshooting error:', error.message);
        return { success: false, error: error.message, records: [] };
      }
    },

    // -----------------------------------------------------------------------
    // ANALYSE DE FIABILITÉ ÉQUIPEMENTS
    // -----------------------------------------------------------------------
    analyze_equipment_reliability: async (params) => {
      const { equipment_type = 'all', period_days = 90, building, top_n = 10, metric = 'failure_count' } = params;

      try {
        // Requête pour trouver les équipements avec le plus de pannes
        let query = `
          SELECT
            tr.equipment_name,
            tr.equipment_type,
            tr.building_code,
            COUNT(*) as failure_count,
            SUM(tr.duration_minutes) as total_downtime,
            SUM(CASE WHEN tr.severity = 'critical' THEN 3 WHEN tr.severity = 'major' THEN 2 ELSE 1 END) as severity_score,
            MAX(tr.started_at) as last_failure,
            array_agg(DISTINCT tr.title) as failure_titles
          FROM troubleshooting_records tr
          WHERE tr.site = $1
            AND tr.started_at >= NOW() - INTERVAL '${parseInt(period_days)} days'
        `;
        const queryParams = [site];
        let paramIndex = 2;

        if (equipment_type && equipment_type !== 'all') {
          query += ` AND tr.equipment_type = $${paramIndex}`;
          queryParams.push(equipment_type);
          paramIndex++;
        }

        if (building) {
          query += ` AND UPPER(tr.building_code) = $${paramIndex}`;
          queryParams.push(building.toUpperCase());
          paramIndex++;
        }

        query += ` GROUP BY tr.equipment_name, tr.equipment_type, tr.building_code`;

        // Ordre selon la métrique
        const orderBy = {
          'failure_count': 'failure_count DESC',
          'downtime': 'total_downtime DESC',
          'severity_score': 'severity_score DESC'
        }[metric] || 'failure_count DESC';

        query += ` ORDER BY ${orderBy} LIMIT ${Math.min(parseInt(top_n) || 10, 50)}`;

        const result = await pool.query(query, queryParams);

        // Calculer le total pour pourcentages
        const totalFailures = result.rows.reduce((sum, r) => sum + parseInt(r.failure_count), 0);

        return {
          success: true,
          period_days,
          equipment_type,
          metric_used: metric,
          total_failures_analyzed: totalFailures,
          rankings: result.rows.map((r, index) => ({
            rank: index + 1,
            equipment_name: r.equipment_name,
            equipment_type: r.equipment_type,
            building: r.building_code,
            failure_count: parseInt(r.failure_count),
            percentage: totalFailures > 0 ? Math.round((parseInt(r.failure_count) / totalFailures) * 100) : 0,
            total_downtime_minutes: parseInt(r.total_downtime) || 0,
            severity_score: parseInt(r.severity_score),
            last_failure: r.last_failure,
            common_issues: r.failure_titles.slice(0, 3)
          })),
          summary: result.rows.length === 0
            ? `Aucune donnée de fiabilité sur les ${period_days} derniers jours.`
            : `Top ${result.rows.length} équipements les plus problématiques sur ${period_days} jours.`
        };
      } catch (error) {
        console.error('[TOOL] analyze_equipment_reliability error:', error.message);
        return { success: false, error: error.message, rankings: [] };
      }
    },

    // -----------------------------------------------------------------------
    // ANALYSE PAR BÂTIMENT
    // -----------------------------------------------------------------------
    analyze_by_building: async (params) => {
      const { analysis_type = 'overview', period_days = 30, building, generate_chart = false } = params;

      try {
        let results = {};
        let chartData = null;

        // Si un bâtiment spécifique est demandé
        if (building) {
          // Analyse détaillée d'un bâtiment
          const [failures, controls, nc, equipment] = await Promise.all([
            pool.query(`
              SELECT COUNT(*) as count, severity
              FROM troubleshooting_records
              WHERE site = $1 AND UPPER(building_code) = $2
                AND started_at >= NOW() - INTERVAL '${parseInt(period_days)} days'
              GROUP BY severity
            `, [site, building.toUpperCase()]),
            pool.query(`
              SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE next_control_date < CURRENT_DATE) as overdue
              FROM scheduled_controls sc
              JOIN switchboards s ON sc.switchboard_id = s.id
              WHERE s.site = $1 AND UPPER(s.building_code) = $2
            `, [site, building.toUpperCase()]),
            pool.query(`
              SELECT COUNT(*) as count, status
              FROM non_conformities
              WHERE site = $1 AND UPPER(building) = $2
              GROUP BY status
            `, [site, building.toUpperCase()]),
            pool.query(`
              SELECT COUNT(*) as count
              FROM switchboards
              WHERE site = $1 AND UPPER(building_code) = $2
            `, [site, building.toUpperCase()])
          ]);

          results = {
            building: building.toUpperCase(),
            period_days,
            failures: {
              total: failures.rows.reduce((sum, r) => sum + parseInt(r.count), 0),
              by_severity: failures.rows
            },
            controls: {
              total: parseInt(controls.rows[0]?.total || 0),
              overdue: parseInt(controls.rows[0]?.overdue || 0)
            },
            non_conformities: {
              total: nc.rows.reduce((sum, r) => sum + parseInt(r.count), 0),
              by_status: nc.rows
            },
            equipment_count: parseInt(equipment.rows[0]?.count || 0)
          };
        } else {
          // Comparaison entre bâtiments
          const buildingStats = await pool.query(`
            SELECT
              s.building_code,
              COUNT(DISTINCT s.id) as equipment_count,
              (SELECT COUNT(*) FROM troubleshooting_records tr
               WHERE tr.site = $1 AND tr.building_code = s.building_code
               AND tr.started_at >= NOW() - INTERVAL '${parseInt(period_days)} days') as failure_count,
              (SELECT COUNT(*) FROM scheduled_controls sc2
               JOIN switchboards s2 ON sc2.switchboard_id = s2.id
               WHERE s2.site = $1 AND s2.building_code = s.building_code
               AND sc2.next_control_date < CURRENT_DATE) as overdue_controls
            FROM switchboards s
            WHERE s.site = $1 AND s.building_code IS NOT NULL
            GROUP BY s.building_code
            ORDER BY failure_count DESC
          `, [site]);

          results = {
            comparison: buildingStats.rows.map(b => ({
              building: b.building_code,
              equipment_count: parseInt(b.equipment_count),
              failures: parseInt(b.failure_count),
              overdue_controls: parseInt(b.overdue_controls)
            })),
            period_days,
            most_problematic: buildingStats.rows[0]?.building_code || 'N/A'
          };

          if (generate_chart) {
            chartData = {
              type: 'bar',
              title: `Pannes par bâtiment (${period_days} jours)`,
              labels: buildingStats.rows.map(b => `Bât. ${b.building_code}`),
              data: buildingStats.rows.map(b => parseInt(b.failure_count))
            };
          }
        }

        return {
          success: true,
          analysis_type,
          ...results,
          chart: chartData,
          summary: building
            ? `Analyse du bâtiment ${building.toUpperCase()} sur ${period_days} jours.`
            : `Comparaison de ${results.comparison?.length || 0} bâtiments sur ${period_days} jours.`
        };
      } catch (error) {
        console.error('[TOOL] analyze_by_building error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // PRIORITÉS DE MAINTENANCE
    // -----------------------------------------------------------------------
    get_maintenance_priorities: async (params) => {
      const { criteria = 'combined', equipment_type = 'all', building, limit = 15 } = params;

      try {
        let priorities = [];

        // Contrôles en retard
        if (criteria === 'overdue_controls' || criteria === 'combined') {
          let query = `
            SELECT
              s.id, s.name as equipment_name, s.code, s.building_code, s.floor,
              'switchboard' as equipment_type,
              sc.next_control_date,
              EXTRACT(DAY FROM CURRENT_DATE - sc.next_control_date)::int as days_overdue,
              'overdue_control' as priority_reason,
              CASE
                WHEN EXTRACT(DAY FROM CURRENT_DATE - sc.next_control_date) > 30 THEN 'critical'
                WHEN EXTRACT(DAY FROM CURRENT_DATE - sc.next_control_date) > 14 THEN 'high'
                ELSE 'medium'
              END as priority_level
            FROM scheduled_controls sc
            JOIN switchboards s ON sc.switchboard_id = s.id
            WHERE s.site = $1 AND sc.next_control_date < CURRENT_DATE
          `;
          const queryParams = [site];

          if (building) {
            query += ` AND UPPER(s.building_code) = $2`;
            queryParams.push(building.toUpperCase());
          }

          query += ` ORDER BY days_overdue DESC LIMIT ${Math.min(parseInt(limit), 50)}`;

          const result = await pool.query(query, queryParams);
          priorities.push(...result.rows);
        }

        // Équipements avec pannes fréquentes
        if (criteria === 'frequent_failures' || criteria === 'combined') {
          let query = `
            SELECT
              tr.equipment_name, tr.equipment_type, tr.building_code as building_code,
              COUNT(*) as failure_count,
              'frequent_failures' as priority_reason,
              CASE
                WHEN COUNT(*) >= 5 THEN 'critical'
                WHEN COUNT(*) >= 3 THEN 'high'
                ELSE 'medium'
              END as priority_level
            FROM troubleshooting_records tr
            WHERE tr.site = $1 AND tr.started_at >= NOW() - INTERVAL '90 days'
          `;
          const queryParams = [site];
          let paramIndex = 2;

          if (equipment_type && equipment_type !== 'all') {
            query += ` AND tr.equipment_type = $${paramIndex}`;
            queryParams.push(equipment_type);
            paramIndex++;
          }

          if (building) {
            query += ` AND UPPER(tr.building_code) = $${paramIndex}`;
            queryParams.push(building.toUpperCase());
          }

          query += ` GROUP BY tr.equipment_name, tr.equipment_type, tr.building_code
                     HAVING COUNT(*) >= 2
                     ORDER BY failure_count DESC LIMIT ${Math.min(parseInt(limit), 30)}`;

          const result = await pool.query(query, queryParams);
          priorities.push(...result.rows.map(r => ({
            ...r,
            failure_count: parseInt(r.failure_count)
          })));
        }

        // NC critiques ouvertes
        if (criteria === 'high_severity_nc' || criteria === 'combined') {
          let query = `
            SELECT
              nc.equipment_name, nc.equipment_type, nc.building as building_code,
              nc.title, nc.severity, nc.created_at,
              'critical_nc' as priority_reason,
              nc.severity as priority_level
            FROM non_conformities nc
            WHERE nc.site = $1 AND nc.status = 'open' AND nc.severity IN ('critical', 'major')
          `;
          const queryParams = [site];

          if (building) {
            query += ` AND UPPER(nc.building) = $2`;
            queryParams.push(building.toUpperCase());
          }

          query += ` ORDER BY CASE nc.severity WHEN 'critical' THEN 1 ELSE 2 END, nc.created_at ASC
                     LIMIT ${Math.min(parseInt(limit), 30)}`;

          const result = await pool.query(query, queryParams);
          priorities.push(...result.rows);
        }

        // Trier par niveau de priorité
        const priorityOrder = { critical: 1, high: 2, major: 2, medium: 3 };
        priorities.sort((a, b) => (priorityOrder[a.priority_level] || 4) - (priorityOrder[b.priority_level] || 4));

        // Limiter le total
        priorities = priorities.slice(0, parseInt(limit));

        return {
          success: true,
          criteria,
          equipment_type,
          building: building || 'all',
          total_priorities: priorities.length,
          priorities: priorities.map((p, i) => ({
            rank: i + 1,
            equipment_name: p.equipment_name || p.name,
            equipment_type: p.equipment_type,
            building: p.building_code,
            priority_level: p.priority_level,
            reason: p.priority_reason,
            details: p.days_overdue ? `${p.days_overdue} jours de retard`
                   : p.failure_count ? `${p.failure_count} pannes en 90j`
                   : p.title || 'NC ouverte'
          })),
          summary: priorities.length === 0
            ? 'Aucune priorité de maintenance identifiée.'
            : `${priorities.length} équipements nécessitant attention (${priorities.filter(p => p.priority_level === 'critical').length} critiques).`
        };
      } catch (error) {
        console.error('[TOOL] get_maintenance_priorities error:', error.message);
        return { success: false, error: error.message, priorities: [] };
      }
    },

    // -----------------------------------------------------------------------
    // PROCÉDURES
    // -----------------------------------------------------------------------
    search_procedures: async (params) => {
      const { query: searchQuery, category, risk_level, limit = 10 } = params;

      let query = `
        SELECT
          p.id, p.title, p.description, p.category, p.risk_level, p.status,
          p.site, p.building, p.zone, p.created_at,
          p.ppe_required,
          (SELECT COUNT(*) FROM procedure_steps WHERE procedure_id = p.id) as step_count
        FROM procedures p
        WHERE (p.site = $1 OR p.site IS NULL OR p.site = '')
          AND (p.status = 'approved' OR p.status = 'draft')
      `;
      const queryParams = [site];
      let paramIndex = 2;

      if (searchQuery) {
        query += ` AND (
          LOWER(p.title) LIKE $${paramIndex}
          OR LOWER(p.description) LIKE $${paramIndex}
          OR p.id::text = $${paramIndex + 1}
        )`;
        queryParams.push(`%${searchQuery.toLowerCase()}%`, searchQuery);
        paramIndex += 2;
      }

      if (category) {
        query += ` AND p.category = $${paramIndex}`;
        queryParams.push(category);
        paramIndex++;
      }

      if (risk_level) {
        query += ` AND p.risk_level = $${paramIndex}`;
        queryParams.push(risk_level);
        paramIndex++;
      }

      query += ` ORDER BY
        CASE WHEN p.site = $1 THEN 0 ELSE 1 END,
        p.created_at DESC
        LIMIT ${Math.min(parseInt(limit) || 10, 30)}`;

      try {
        const result = await pool.query(query, queryParams);

        return {
          success: true,
          count: result.rows.length,
          search_query: searchQuery,
          procedures: result.rows.map(p => ({
            id: p.id,
            title: p.title,
            description: p.description?.substring(0, 150),
            category: p.category,
            risk_level: p.risk_level,
            status: p.status,
            step_count: parseInt(p.step_count) || 0,
            ppe_required: p.ppe_required || [],
            building: p.building,
            created_at: p.created_at
          })),
          summary: result.rows.length === 0
            ? `Aucune procédure trouvée pour "${searchQuery || 'cette recherche'}".`
            : `${result.rows.length} procédure(s) trouvée(s).`
        };
      } catch (error) {
        console.error('[TOOL] search_procedures error:', error.message);
        return { success: false, error: error.message, procedures: [] };
      }
    },

    get_procedure_details: async (params) => {
      const { procedure_id, procedure_title } = params;

      let query = `
        SELECT p.*,
          (SELECT json_agg(s ORDER BY s.step_number)
           FROM procedure_steps s
           WHERE s.procedure_id = p.id) as steps
        FROM procedures p
        WHERE (p.site = $1 OR p.site IS NULL OR p.site = '')
      `;
      const queryParams = [site];

      if (procedure_id) {
        query += ` AND p.id = $2`;
        queryParams.push(procedure_id);
      } else if (procedure_title) {
        query += ` AND LOWER(p.title) LIKE $2`;
        queryParams.push(`%${procedure_title.toLowerCase()}%`);
      } else {
        return { success: false, error: 'procedure_id ou procedure_title requis' };
      }

      query += ` LIMIT 1`;

      try {
        const result = await pool.query(query, queryParams);

        if (result.rows.length === 0) {
          return { success: false, error: 'Procédure non trouvée', procedure: null };
        }

        const proc = result.rows[0];
        const steps = proc.steps || [];

        return {
          success: true,
          procedure: {
            id: proc.id,
            title: proc.title,
            description: proc.description,
            category: proc.category,
            risk_level: proc.risk_level,
            status: proc.status,
            ppe_required: proc.ppe_required || [],
            building: proc.building,
            zone: proc.zone,
            created_at: proc.created_at,
            step_count: steps.length,
            estimated_duration: steps.reduce((sum, s) => sum + (s.duration_minutes || 5), 0),
            steps: steps.map(s => ({
              step_number: s.step_number,
              title: s.title,
              instructions: s.instructions,
              warning: s.warning,
              duration_minutes: s.duration_minutes,
              has_photo: !!(s.photo_content || s.photo_path)
            }))
          }
        };
      } catch (error) {
        console.error('[TOOL] get_procedure_details error:', error.message);
        return { success: false, error: error.message };
      }
    },

    open_procedure_modal: async (params) => {
      const { procedure_id, start_guidance = false } = params;

      // Ce handler retourne des instructions pour le frontend
      return {
        success: true,
        action: 'open_modal',
        procedure_id,
        start_guidance,
        frontend_instruction: {
          procedureToOpen: { id: procedure_id },
          startGuidance: start_guidance
        }
      };
    },

    create_procedure: async (params) => {
      const { suggested_title, category } = params;

      return {
        success: true,
        action: 'open_creator',
        frontend_instruction: {
          openProcedureCreator: true,
          procedureCreatorContext: {
            suggestedTitle: suggested_title,
            category: category
          }
        }
      };
    },

    // -----------------------------------------------------------------------
    // ÉQUIPEMENTS
    // -----------------------------------------------------------------------
    search_equipment: async (params) => {
      const { equipment_type, building, floor, name, code, limit = 20 } = params;

      // Mapper le type d'équipement à la table avec les bons noms de colonnes
      const tableMap = {
        switchboard: {
          table: 'switchboards',
          columns: 'id, name, code, building_code, floor, room',
          siteColumn: 'site',
          buildingCol: 'building_code',
          codeCol: 'code'
        },
        vsd: {
          table: 'vsd_equipments',
          columns: 'id, name, building as building_code, floor, location as room',
          siteColumn: 'site',
          buildingCol: 'building',
          codeCol: null // pas de code/tag
        },
        meca: {
          table: 'meca_equipments',
          columns: 'id, name, building as building_code, floor, location as room',
          siteColumn: null, // utilise site_id join
          siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id',
          siteCondition: "s.name = $1",
          buildingCol: 'building',
          codeCol: null
        },
        atex: {
          table: 'atex_equipments',
          columns: 'id, name, tag as code, building as building_code, floor, location as room',
          siteColumn: null,
          siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id',
          siteCondition: "s.name = $1",
          buildingCol: 'building',
          codeCol: 'tag'
        },
        mobile: {
          table: 'me_equipments',
          columns: 'id, name, code, building as building_code, floor, location as room',
          siteColumn: null, // pas de filtre site apparent
          buildingCol: 'building',
          codeCol: 'code'
        },
        hv: {
          table: 'hv_equipments',
          columns: 'id, name, code, building_code, floor, room',
          siteColumn: null, // pas de filtre site apparent
          buildingCol: 'building_code',
          codeCol: 'code'
        },
        glo: {
          table: 'glo_equipments',
          columns: 'id, name, tag as code, building as building_code, floor, location as room',
          siteColumn: null,
          buildingCol: 'building',
          codeCol: 'tag'
        },
        datahub: {
          table: 'dh_items',
          columns: 'id, name, code, building as building_code, floor, location as room',
          siteColumn: null,
          buildingCol: 'building',
          codeCol: 'code'
        }
      };

      // Si pas de type spécifié et qu'on a un nom, chercher dans TOUS les types
      if (!equipment_type && name) {
        try {
          const allResults = [];
          for (const [eqType, tableInfo] of Object.entries(tableMap)) {
            try {
              let query;
              let queryParams;

              if (tableInfo.siteJoin) {
                // Tables avec join sur sites
                query = `
                  SELECT ${tableInfo.columns}, '${eqType}' as equipment_type
                  FROM ${tableInfo.table} e
                  ${tableInfo.siteJoin.replace('{table}', 'e')}
                  WHERE ${tableInfo.siteCondition} AND LOWER(e.name) LIKE $2
                  LIMIT 5
                `;
                queryParams = [site, `%${name.toLowerCase()}%`];
              } else if (tableInfo.siteColumn) {
                // Tables avec colonne site directe
                query = `
                  SELECT ${tableInfo.columns}, '${eqType}' as equipment_type
                  FROM ${tableInfo.table}
                  WHERE ${tableInfo.siteColumn} = $1 AND LOWER(name) LIKE $2
                  LIMIT 5
                `;
                queryParams = [site, `%${name.toLowerCase()}%`];
              } else {
                // Tables sans filtre site
                query = `
                  SELECT ${tableInfo.columns}, '${eqType}' as equipment_type
                  FROM ${tableInfo.table}
                  WHERE LOWER(name) LIKE $1
                  LIMIT 5
                `;
                queryParams = [`%${name.toLowerCase()}%`];
              }

              const result = await pool.query(query, queryParams);
              allResults.push(...result.rows.map(r => ({ ...r, equipment_type: eqType })));
            } catch (e) {
              // Table might not exist, skip
              console.log(`[TOOL] search_equipment: Table ${tableInfo.table} error:`, e.message);
            }
          }

          if (allResults.length > 0) {
            return {
              success: true,
              count: allResults.length,
              equipment_type: 'all',
              filters: { name },
              equipment: allResults.slice(0, limit),
              summary: `${allResults.length} équipement(s) trouvé(s) correspondant à "${name}".`
            };
          }
        } catch (error) {
          console.error('[TOOL] search_equipment (all types) error:', error.message);
        }
      }

      const tableInfo = tableMap[equipment_type] || tableMap.switchboard;
      const actualType = equipment_type || 'switchboard';

      // Construire la requête selon le type de table
      let query;
      let queryParams = [];
      let paramIndex = 1;

      if (tableInfo.siteJoin) {
        // Tables avec join sur sites
        query = `
          SELECT ${tableInfo.columns}, '${actualType}' as equipment_type
          FROM ${tableInfo.table} e
          ${tableInfo.siteJoin.replace('{table}', 'e')}
          WHERE ${tableInfo.siteCondition}
        `;
        queryParams.push(site);
        paramIndex++;
      } else if (tableInfo.siteColumn) {
        // Tables avec colonne site directe
        query = `
          SELECT ${tableInfo.columns}, '${actualType}' as equipment_type
          FROM ${tableInfo.table}
          WHERE ${tableInfo.siteColumn} = $1
        `;
        queryParams.push(site);
        paramIndex++;
      } else {
        // Tables sans filtre site
        query = `
          SELECT ${tableInfo.columns}, '${actualType}' as equipment_type
          FROM ${tableInfo.table}
          WHERE 1=1
        `;
      }

      // Ajout alias pour les colonnes filtrées
      const nameAlias = tableInfo.siteJoin ? 'e.name' : 'name';
      const buildingAlias = tableInfo.siteJoin ? `e.${tableInfo.buildingCol}` : tableInfo.buildingCol;
      const floorAlias = tableInfo.siteJoin ? 'e.floor' : 'floor';

      if (building) {
        query += ` AND UPPER(${buildingAlias}) = $${paramIndex}`;
        queryParams.push(building.toUpperCase());
        paramIndex++;
      }

      if (floor) {
        query += ` AND UPPER(${floorAlias}) = $${paramIndex}`;
        queryParams.push(floor.toUpperCase());
        paramIndex++;
      }

      if (name) {
        query += ` AND LOWER(${nameAlias}) LIKE $${paramIndex}`;
        queryParams.push(`%${name.toLowerCase()}%`);
        paramIndex++;
      }

      if (code && tableInfo.codeCol) {
        const codeAlias = tableInfo.siteJoin ? `e.${tableInfo.codeCol}` : tableInfo.codeCol;
        query += ` AND LOWER(${codeAlias}) LIKE $${paramIndex}`;
        queryParams.push(`%${code.toLowerCase()}%`);
        paramIndex++;
      }

      query += ` ORDER BY ${buildingAlias}, ${floorAlias}, ${nameAlias} LIMIT ${Math.min(parseInt(limit) || 20, 50)}`;

      try {
        const result = await pool.query(query, queryParams);

        return {
          success: true,
          count: result.rows.length,
          equipment_type: actualType,
          filters: { building, floor, name, code },
          equipment: result.rows.map(eq => ({
            id: eq.id,
            name: eq.name,
            code: eq.code,
            building_code: eq.building_code,
            floor: eq.floor,
            room: eq.room,
            equipment_type: actualType
          })),
          summary: result.rows.length === 0
            ? `Aucun équipement ${actualType} trouvé avec ces critères.`
            : `${result.rows.length} équipement(s) ${actualType} trouvé(s).`
        };
      } catch (error) {
        console.error('[TOOL] search_equipment error:', error.message);
        return { success: false, error: error.message, equipment: [] };
      }
    },

    get_equipment_details: async (params) => {
      const { equipment_id, equipment_type, include_history = false, include_nc = false } = params;

      const tableMap = {
        switchboard: 'switchboards',
        vsd: 'vsd_equipments',
        meca: 'meca_equipments',
        atex: 'atex_equipments',
        mobile: 'me_equipments',
        hv: 'hv_equipments',
        glo: 'glo_equipments',
        datahub: 'dh_items'
      };

      const table = tableMap[equipment_type] || 'switchboards';

      try {
        const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [equipment_id]);

        if (result.rows.length === 0) {
          return { success: false, error: 'Équipement non trouvé' };
        }

        const equipment = result.rows[0];
        const response = {
          success: true,
          equipment: {
            ...equipment,
            equipment_type
          }
        };

        // Historique des contrôles si demandé
        if (include_history && equipment_type === 'switchboard') {
          const historyResult = await pool.query(`
            SELECT id, control_date, result, notes, created_at
            FROM control_reports
            WHERE switchboard_id = $1
            ORDER BY control_date DESC
            LIMIT 10
          `, [equipment_id]);
          response.control_history = historyResult.rows;
        }

        // Non-conformités si demandé
        if (include_nc) {
          const ncResult = await pool.query(`
            SELECT id, title, severity, status, created_at
            FROM non_conformities
            WHERE equipment_id = $1 AND equipment_type = $2
            ORDER BY created_at DESC
            LIMIT 10
          `, [equipment_id, equipment_type]);
          response.non_conformities = ncResult.rows;
        }

        return response;
      } catch (error) {
        console.error('[TOOL] get_equipment_details error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // CONTRÔLES (Tous les contrôles sont gérés via Switchboard Controls)
    // NOTE: Tous les agents doivent pouvoir voir les contrôles planifiés
    // même s'ils sont sur un équipement non-switchboard (mobile, vsd, etc.)
    // -----------------------------------------------------------------------
    get_controls: async (params) => {
      const { filter = 'overdue', equipment_type = 'all', building, equipment_id, limit = 20 } = params;

      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Calculer les dates selon le filtre
      let dateCondition = '';
      switch (filter) {
        case 'overdue':
          dateCondition = `AND sc.next_control_date < '${today}'`;
          break;
        case 'today':
          dateCondition = `AND sc.next_control_date = '${today}'`;
          break;
        case 'this_week':
          const weekEnd = new Date(now);
          weekEnd.setDate(weekEnd.getDate() + 7);
          dateCondition = `AND sc.next_control_date BETWEEN '${today}' AND '${weekEnd.toISOString().split('T')[0]}'`;
          break;
        case 'this_month':
          const monthEnd = new Date(now);
          monthEnd.setDate(monthEnd.getDate() + 30);
          dateCondition = `AND sc.next_control_date BETWEEN '${today}' AND '${monthEnd.toISOString().split('T')[0]}'`;
          break;
        case 'next_30_days':
          const thirtyDays = new Date(now);
          thirtyDays.setDate(thirtyDays.getDate() + 30);
          dateCondition = `AND sc.next_control_date BETWEEN '${today}' AND '${thirtyDays.toISOString().split('T')[0]}'`;
          break;
        default:
          dateCondition = '';
      }

      let query = `
        SELECT
          sc.id as control_id, sc.next_control_date, sc.control_type,
          s.id as equipment_id, s.name as equipment_name, s.code as equipment_code,
          s.building_code, s.floor, s.room,
          'switchboard' as equipment_type,
          CASE
            WHEN sc.next_control_date < CURRENT_DATE THEN
              EXTRACT(DAY FROM CURRENT_DATE - sc.next_control_date)::int
            ELSE 0
          END as days_overdue
        FROM scheduled_controls sc
        JOIN switchboards s ON sc.switchboard_id = s.id
        WHERE s.site = $1
        ${dateCondition}
      `;

      const queryParams = [site];
      let paramIndex = 2;

      // Filtrer par bâtiment si spécifié
      if (building) {
        query += ` AND UPPER(s.building_code) = $${paramIndex}`;
        queryParams.push(building.toUpperCase());
        paramIndex++;
      }

      // Si un equipment_id spécifique est demandé (pour switchboard)
      if (equipment_id && equipment_type === 'switchboard') {
        query += ` AND s.id = $${paramIndex}`;
        queryParams.push(equipment_id);
        paramIndex++;
      }

      query += ` ORDER BY sc.next_control_date ASC LIMIT ${Math.min(parseInt(limit) || 20, 50)}`;

      try {
        const result = await pool.query(query, queryParams);

        // Calculer des stats
        const overdueCount = result.rows.filter(r => r.days_overdue > 0).length;
        const upcomingCount = result.rows.filter(r => r.days_overdue === 0).length;

        // Message adapté selon le contexte
        let contextNote = '';
        if (equipment_type && equipment_type !== 'switchboard' && equipment_type !== 'all') {
          contextNote = `\n\n📋 **Note**: Tous les contrôles sont gérés depuis "Switchboard Controls". ` +
            `Voici les contrôles planifiés${building ? ` pour le bâtiment ${building}` : ''}.`;
        }

        return {
          success: true,
          filter,
          count: result.rows.length,
          overdue_count: overdueCount,
          upcoming_count: upcomingCount,
          building_filter: building || 'all',
          controls: result.rows.map(c => ({
            control_id: c.control_id,
            next_control_date: c.next_control_date,
            control_type: c.control_type,
            equipment_id: c.equipment_id,
            equipment_name: c.equipment_name,
            equipment_code: c.equipment_code,
            building: c.building_code,
            floor: c.floor,
            room: c.room,
            equipment_type: c.equipment_type,
            days_overdue: c.days_overdue
          })),
          summary: result.rows.length === 0
            ? `Aucun contrôle ${filter === 'overdue' ? 'en retard' : 'prévu'}${building ? ` pour le bâtiment ${building}` : ''}.`
            : `${result.rows.length} contrôle(s) ${filter === 'overdue' ? 'en retard' : 'prévu(s)'}${overdueCount > 0 ? ` (${overdueCount} en retard)` : ''}.${contextNote}`
        };
      } catch (error) {
        console.error('[TOOL] get_controls error:', error.message);
        return { success: false, error: error.message, controls: [] };
      }
    },

    // -----------------------------------------------------------------------
    // CARTE / NAVIGATION
    // -----------------------------------------------------------------------
    show_map: async (params) => {
      const { building, floor, equipment_ids, equipment_type = 'switchboard' } = params;

      // Ce handler retourne des instructions pour le frontend
      let equipmentToShow = [];

      if (equipment_ids && equipment_ids.length > 0) {
        // Récupérer les équipements spécifiés (noms de tables corrects)
        const tableMap = {
          switchboard: { table: 'switchboards', cols: 'id, name, code, building_code, floor, room' },
          vsd: { table: 'vsd_equipments', cols: 'id, name, building as building_code, floor, location as room' },
          meca: { table: 'meca_equipments', cols: 'id, name, building as building_code, floor, location as room' },
          mobile: { table: 'me_equipments', cols: 'id, name, code, building as building_code, floor, location as room' },
          hv: { table: 'hv_equipments', cols: 'id, name, code, building_code, floor, room' },
          glo: { table: 'glo_equipments', cols: 'id, name, tag as code, building as building_code, floor, location as room' },
          atex: { table: 'atex_equipments', cols: 'id, name, tag as code, building as building_code, floor, location as room' },
          datahub: { table: 'dh_items', cols: 'id, name, code, building as building_code, floor, location as room' }
        };
        const info = tableMap[equipment_type] || tableMap.switchboard;

        try {
          const result = await pool.query(`
            SELECT ${info.cols}
            FROM ${info.table}
            WHERE id = ANY($1)
          `, [equipment_ids]);
          equipmentToShow = result.rows;
        } catch (e) {
          console.error('[TOOL] show_map equipment query error:', e.message);
        }
      } else if (building) {
        // Récupérer les équipements du bâtiment
        try {
          let query = `
            SELECT id, name, code, building_code, floor, room
            FROM switchboards
            WHERE site = $1 AND UPPER(building_code) = $2
          `;
          const params = [site, building.toUpperCase()];

          if (floor) {
            query += ` AND UPPER(floor) = $3`;
            params.push(floor.toUpperCase());
          }

          query += ` ORDER BY floor, name LIMIT 20`;

          const result = await pool.query(query, params);
          equipmentToShow = result.rows;
        } catch (e) {
          console.error('[TOOL] show_map building query error:', e.message);
        }
      }

      return {
        success: true,
        action: 'show_map',
        frontend_instruction: {
          showMap: true,
          building,
          floor,
          locationEquipment: equipmentToShow[0] || null,
          locationEquipmentType: equipment_type,
          equipmentList: equipmentToShow
        }
      };
    },

    // -----------------------------------------------------------------------
    // NON-CONFORMITÉS
    // -----------------------------------------------------------------------
    get_non_conformities: async (params) => {
      const { status = 'open', severity, equipment_type, building, limit = 20 } = params;

      let query = `
        SELECT
          nc.id, nc.title, nc.description, nc.severity, nc.status,
          nc.equipment_id, nc.equipment_type, nc.equipment_name,
          nc.building, nc.created_at, nc.resolved_at
        FROM non_conformities nc
        WHERE nc.site = $1
      `;
      const queryParams = [site];
      let paramIndex = 2;

      if (status && status !== 'all') {
        query += ` AND nc.status = $${paramIndex}`;
        queryParams.push(status);
        paramIndex++;
      }

      if (severity && severity !== 'all') {
        query += ` AND nc.severity = $${paramIndex}`;
        queryParams.push(severity);
        paramIndex++;
      }

      if (equipment_type) {
        query += ` AND nc.equipment_type = $${paramIndex}`;
        queryParams.push(equipment_type);
        paramIndex++;
      }

      if (building) {
        query += ` AND UPPER(nc.building) = $${paramIndex}`;
        queryParams.push(building.toUpperCase());
        paramIndex++;
      }

      query += ` ORDER BY
        CASE nc.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 WHEN 'minor' THEN 3 ELSE 4 END,
        nc.created_at DESC
        LIMIT ${Math.min(parseInt(limit) || 20, 50)}`;

      try {
        const result = await pool.query(query, queryParams);

        const criticalCount = result.rows.filter(nc => nc.severity === 'critical').length;
        const majorCount = result.rows.filter(nc => nc.severity === 'major').length;

        return {
          success: true,
          count: result.rows.length,
          critical_count: criticalCount,
          major_count: majorCount,
          filters: { status, severity, equipment_type, building },
          non_conformities: result.rows.map(nc => ({
            id: nc.id,
            title: nc.title,
            description: nc.description?.substring(0, 200),
            severity: nc.severity,
            status: nc.status,
            equipment_name: nc.equipment_name,
            equipment_type: nc.equipment_type,
            building: nc.building,
            created_at: nc.created_at
          })),
          summary: result.rows.length === 0
            ? 'Aucune non-conformité trouvée.'
            : `${result.rows.length} NC trouvée(s)${criticalCount > 0 ? ` dont ${criticalCount} critique(s)` : ''}.`
        };
      } catch (error) {
        console.error('[TOOL] get_non_conformities error:', error.message);
        return { success: false, error: error.message, non_conformities: [] };
      }
    },

    // -----------------------------------------------------------------------
    // STATISTIQUES
    // -----------------------------------------------------------------------
    get_statistics: async (params) => {
      const { type = 'overview', period = 'month', building, generate_chart = false, chart_type = 'bar' } = params;

      const stats = {};

      try {
        switch (type) {
          case 'overview':
            // Stats globales
            const [switchboards, controls, procedures, nc] = await Promise.all([
              pool.query(`SELECT COUNT(*) as count FROM switchboards WHERE site = $1`, [site]),
              pool.query(`
                SELECT
                  COUNT(*) FILTER (WHERE next_control_date < CURRENT_DATE) as overdue,
                  COUNT(*) FILTER (WHERE next_control_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) as this_week,
                  COUNT(*) FILTER (WHERE next_control_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) as this_month
                FROM scheduled_controls sc
                JOIN switchboards s ON sc.switchboard_id = s.id
                WHERE s.site = $1
              `, [site]),
              pool.query(`SELECT COUNT(*) as count FROM procedures WHERE site = $1 OR site IS NULL`, [site]),
              pool.query(`SELECT COUNT(*) as count FROM non_conformities WHERE site = $1 AND status = 'open'`, [site])
            ]);

            stats.overview = {
              total_equipment: parseInt(switchboards.rows[0]?.count || 0),
              controls_overdue: parseInt(controls.rows[0]?.overdue || 0),
              controls_this_week: parseInt(controls.rows[0]?.this_week || 0),
              controls_this_month: parseInt(controls.rows[0]?.this_month || 0),
              total_procedures: parseInt(procedures.rows[0]?.count || 0),
              open_nc: parseInt(nc.rows[0]?.count || 0)
            };
            break;

          case 'troubleshooting':
            const troubleStats = await pool.query(`
              SELECT
                severity,
                COUNT(*) as count,
                AVG(duration_minutes) as avg_duration
              FROM troubleshooting_records
              WHERE site = $1 AND started_at >= NOW() - INTERVAL '30 days'
              GROUP BY severity
            `, [site]);

            stats.troubleshooting = {
              by_severity: troubleStats.rows,
              total: troubleStats.rows.reduce((sum, r) => sum + parseInt(r.count), 0)
            };
            break;

          case 'equipment':
            const equipStats = await pool.query(`
              SELECT building_code, COUNT(*) as count
              FROM switchboards
              WHERE site = $1
              GROUP BY building_code
              ORDER BY count DESC
            `, [site]);

            stats.equipment = {
              by_building: equipStats.rows,
              total: equipStats.rows.reduce((sum, r) => sum + parseInt(r.count), 0)
            };
            break;
        }

        // Générer graphique si demandé
        let chart = null;
        if (generate_chart && stats.overview) {
          chart = {
            type: chart_type,
            title: 'Vue d\'ensemble',
            labels: ['Équipements', 'Contrôles en retard', 'Cette semaine', 'NC ouvertes'],
            data: [
              stats.overview.total_equipment,
              stats.overview.controls_overdue,
              stats.overview.controls_this_week,
              stats.overview.open_nc
            ]
          };
        }

        return {
          success: true,
          type,
          period,
          statistics: stats,
          chart,
          summary: `Statistiques ${type} générées pour le site.`
        };
      } catch (error) {
        console.error('[TOOL] get_statistics error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // DOCUMENTATION
    // -----------------------------------------------------------------------
    search_documentation: async (params) => {
      const { query: searchQuery, manufacturer, equipment_type } = params;

      // Recherche DuckDuckGo pour documentation technique
      try {
        const searchTerms = [
          searchQuery,
          manufacturer,
          'fiche technique',
          'datasheet',
          'PDF'
        ].filter(Boolean).join(' ');

        const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(searchTerms)}&format=json&no_html=1`;
        const response = await fetch(searchUrl);
        const data = await response.json();

        const results = [];

        if (data.Abstract) {
          results.push({
            title: data.Heading || searchQuery,
            snippet: data.Abstract,
            url: data.AbstractURL
          });
        }

        if (data.RelatedTopics) {
          data.RelatedTopics.slice(0, 5).forEach(topic => {
            if (topic.Text && topic.FirstURL) {
              results.push({
                title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 50),
                snippet: topic.Text,
                url: topic.FirstURL
              });
            }
          });
        }

        return {
          success: true,
          query: searchQuery,
          results,
          summary: results.length === 0
            ? `Aucune documentation trouvée pour "${searchQuery}".`
            : `${results.length} résultat(s) trouvé(s) pour "${searchQuery}".`
        };
      } catch (error) {
        console.error('[TOOL] search_documentation error:', error.message);
        return { success: false, error: error.message, results: [] };
      }
    },

    // -----------------------------------------------------------------------
    // MÉMOIRE AGENTS
    // -----------------------------------------------------------------------
    get_agent_memory: async (params) => {
      const { agent_type, memory_type = 'all', days = 30, limit = 20 } = params;

      try {
        let query = `
          SELECT id, agent_type, memory_type, content, related_equipment, importance,
                 created_at, updated_at
          FROM agent_memory
          WHERE site = $1 AND agent_type = $2
            AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        `;
        const queryParams = [site, agent_type];

        if (memory_type !== 'all') {
          query += ` AND memory_type = $${queryParams.length + 1}`;
          queryParams.push(memory_type);
        }

        query += ` ORDER BY importance DESC, created_at DESC LIMIT ${parseInt(limit)}`;

        const { rows } = await pool.query(query, queryParams);

        return {
          success: true,
          agent_type,
          memories: rows,
          count: rows.length,
          summary: rows.length === 0
            ? `Aucune mémoire trouvée pour ${agent_type}.`
            : `${rows.length} élément(s) de mémoire trouvé(s) pour ${agent_type}.`
        };
      } catch (error) {
        console.error('[TOOL] get_agent_memory error:', error.message);
        return { success: false, error: error.message, memories: [] };
      }
    },

    get_yesterday_summary: async (params) => {
      const { agent_type } = params;

      try {
        // Map agent types to equipment types for troubleshooting query
        const agentToEquipment = {
          meca: 'meca',
          hv: 'hv',
          vsd: 'vsd',
          atex: 'atex',
          mobile: 'mobile',
          doors: 'door',
          datahub: 'datahub',
          switchboards: 'switchboard',
          glo: 'glo'
        };

        // For 'all' or 'electro', get everything
        const isAllAgents = agent_type === 'all' || agent_type === 'electro';

        // Get yesterday's date range
        const yesterdayStart = "NOW() - INTERVAL '1 day'";
        const yesterdayEnd = "NOW()";

        // Get troubleshooting from yesterday
        let troubleQuery = `
          SELECT id, title, description, severity, status, equipment_type, equipment_name,
                 building_code, technician_name, duration_minutes, started_at, completed_at
          FROM troubleshooting_records
          WHERE site = $1
            AND started_at >= ${yesterdayStart}
            AND started_at < ${yesterdayEnd}
        `;
        const queryParams = [site];

        if (!isAllAgents && agentToEquipment[agent_type]) {
          troubleQuery += ` AND equipment_type = $2`;
          queryParams.push(agentToEquipment[agent_type]);
        }

        troubleQuery += ` ORDER BY severity DESC, started_at DESC`;

        const { rows: troubleshooting } = await pool.query(troubleQuery, queryParams);

        // Get daily snapshot if exists
        let snapshotQuery = `
          SELECT *
          FROM agent_daily_snapshots
          WHERE site = $1 AND snapshot_date = CURRENT_DATE - INTERVAL '1 day'
        `;
        const snapshotParams = [site];

        if (!isAllAgents) {
          snapshotQuery += ` AND agent_type = $2`;
          snapshotParams.push(agent_type);
        }

        const { rows: snapshots } = await pool.query(snapshotQuery, snapshotParams);

        // Calculate summary stats
        const stats = {
          total_interventions: troubleshooting.length,
          critical: troubleshooting.filter(t => t.severity === 'critical').length,
          major: troubleshooting.filter(t => t.severity === 'major').length,
          minor: troubleshooting.filter(t => t.severity === 'minor').length,
          completed: troubleshooting.filter(t => t.status === 'completed').length,
          avg_duration: troubleshooting.length > 0
            ? Math.round(troubleshooting.reduce((sum, t) => sum + (t.duration_minutes || 0), 0) / troubleshooting.length)
            : 0
        };

        return {
          success: true,
          agent_type,
          date: 'yesterday',
          troubleshooting: troubleshooting.slice(0, 10), // Top 10 most important
          snapshots,
          stats,
          summary: troubleshooting.length === 0
            ? `Aucune intervention hier pour ${agent_type}.`
            : `${troubleshooting.length} intervention(s) hier: ${stats.critical} critique(s), ${stats.major} majeure(s), ${stats.minor} mineure(s).`
        };
      } catch (error) {
        console.error('[TOOL] get_yesterday_summary error:', error.message);
        return { success: false, error: error.message };
      }
    },

    record_agent_insight: async (params) => {
      const { agent_type, memory_type, content, related_equipment, importance = 'medium' } = params;

      try {
        const { rows } = await pool.query(`
          INSERT INTO agent_memory (site, agent_type, memory_type, content, related_equipment, importance)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, created_at
        `, [site, agent_type, memory_type, content, related_equipment || null, importance]);

        return {
          success: true,
          id: rows[0].id,
          message: `Mémoire enregistrée avec succès pour ${agent_type}.`,
          created_at: rows[0].created_at
        };
      } catch (error) {
        console.error('[TOOL] record_agent_insight error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // TRANSFERT AGENT & CONTEXTE ÉQUIPEMENT
    // -----------------------------------------------------------------------
    transfer_to_agent: async (params) => {
      const { equipment_id, equipment_type, equipment_name, context } = params;

      // Map equipment type to agent type and route
      const agentMap = {
        switchboard: { agent: 'switchboards', route: '/app/switchboards' },
        vsd: { agent: 'vsd', route: '/app/vsd' },
        meca: { agent: 'meca', route: '/app/equipment-meca' },
        atex: { agent: 'atex', route: '/app/atex' },
        hv: { agent: 'hv', route: '/app/high-voltage' },
        mobile: { agent: 'mobile', route: '/app/mobile-equipment' },
        glo: { agent: 'glo', route: '/app/glo' },
        datahub: { agent: 'datahub', route: '/app/datahub' },
        doors: { agent: 'doors', route: '/app/doors' },
        door: { agent: 'doors', route: '/app/doors' }
      };

      const agentInfo = agentMap[equipment_type] || agentMap.switchboard;

      return {
        success: true,
        action: 'transfer_to_agent',
        agent_type: agentInfo.agent,
        route: agentInfo.route,
        equipment: {
          id: equipment_id,
          type: equipment_type,
          name: equipment_name
        },
        context: context || null,
        message: `Je te transfère vers l'agent ${agentInfo.agent.toUpperCase()} pour l'équipement "${equipment_name}". ${context || ''}`,
        ui_action: {
          type: 'navigate_to_equipment',
          route: `${agentInfo.route}${equipment_id ? `?id=${equipment_id}` : ''}`,
          open_chat: true
        }
      };
    },

    get_troubleshooting_equipment_context: async (params) => {
      const { troubleshooting_id, equipment_name, equipment_type } = params;

      try {
        let equipmentData = null;
        let foundType = equipment_type;

        // Si on a un ID de dépannage, récupérer les infos de l'équipement
        if (troubleshooting_id) {
          const troubleResult = await pool.query(`
            SELECT equipment_id, equipment_type, equipment_name, building_code, description
            FROM troubleshooting_records
            WHERE id = $1 AND site = $2
          `, [troubleshooting_id, site]);

          if (troubleResult.rows.length > 0) {
            const tr = troubleResult.rows[0];
            foundType = tr.equipment_type;
            equipmentData = {
              id: tr.equipment_id,
              type: tr.equipment_type,
              name: tr.equipment_name,
              building: tr.building_code,
              from_troubleshooting: true
            };
          }
        }

        // Chercher l'équipement dans toutes les tables (noms corrects)
        if (!equipmentData && equipment_name) {
          const tableMap = {
            switchboard: 'switchboards',
            vsd: 'vsd_equipments',
            meca: 'meca_equipments',
            atex: 'atex_equipments',
            mobile: 'me_equipments',
            hv: 'hv_equipments',
            glo: 'glo_equipments',
            datahub: 'dh_items'
          };

          const typesToSearch = foundType ? [foundType] : Object.keys(tableMap);

          for (const eqType of typesToSearch) {
            const tableName = tableMap[eqType];
            if (!tableName) continue;

            try {
              const nameCol = 'name';
              const result = await pool.query(`
                SELECT id, name, site
                FROM ${tableName}
                WHERE site = $1 AND LOWER(name) LIKE $2
                LIMIT 1
              `, [site, `%${equipment_name.toLowerCase()}%`]);

              if (result.rows.length > 0) {
                equipmentData = {
                  id: result.rows[0].id,
                  type: eqType,
                  name: result.rows[0].name,
                  from_search: true
                };
                foundType = eqType;
                break;
              }
            } catch (e) {
              // Table might not exist, continue
            }
          }
        }

        if (!equipmentData) {
          return {
            success: false,
            message: `Équipement "${equipment_name}" non trouvé dans la base de données.`,
            suggestion: "L'équipement pourrait être enregistré sous un autre nom ou ne pas encore être dans le système."
          };
        }

        // Map to agent info
        const agentMap = {
          switchboard: { agent: 'switchboards', route: '/app/switchboards' },
          vsd: { agent: 'vsd', route: '/app/vsd' },
          meca: { agent: 'meca', route: '/app/equipment-meca' },
          atex: { agent: 'atex', route: '/app/atex' },
          hv: { agent: 'hv', route: '/app/high-voltage' },
          mobile: { agent: 'mobile', route: '/app/mobile-equipment' },
          glo: { agent: 'glo', route: '/app/glo' },
          datahub: { agent: 'datahub', route: '/app/datahub' },
          doors: { agent: 'doors', route: '/app/doors' },
          door: { agent: 'doors', route: '/app/doors' }
        };

        const agentInfo = agentMap[foundType] || agentMap.switchboard;

        return {
          success: true,
          equipment: equipmentData,
          agent: {
            type: agentInfo.agent,
            route: agentInfo.route
          },
          can_transfer: true,
          message: `Équipement "${equipmentData.name}" trouvé (type: ${foundType}). Tu peux utiliser transfer_to_agent pour ouvrir le chat avec l'agent ${agentInfo.agent.toUpperCase()}.`
        };
      } catch (error) {
        console.error('[TOOL] get_troubleshooting_equipment_context error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // RECHERCHE AGENT PAR NOM
    // -----------------------------------------------------------------------
    find_agent_by_name: async (params) => {
      const { agent_name } = params;

      try {
        // Default agent names
        const defaultNames = {
          main: 'Electro',
          vsd: 'Shakira',
          meca: 'Titan',
          glo: 'Lumina',
          hv: 'Voltaire',
          mobile: 'Nomad',
          atex: 'Phoenix',
          switchboard: 'Matrix',
          doors: 'Portal',
          datahub: 'Nexus',
          firecontrol: 'Blaze'
        };

        // Agent descriptions
        const agentDescriptions = {
          main: 'Assistant principal ElectroHub',
          vsd: 'Spécialiste variateurs de fréquence',
          meca: 'Expert équipements mécaniques (moteurs, pompes, compresseurs)',
          glo: 'Spécialiste éclairage de sécurité (BAES, blocs autonomes)',
          hv: 'Expert haute tension (transformateurs, cellules HT)',
          mobile: 'Spécialiste équipements mobiles',
          atex: 'Expert zones ATEX et atmosphères explosives',
          switchboard: 'Spécialiste tableaux électriques (TGBT, TD)',
          doors: 'Expert portes et accès',
          datahub: 'Spécialiste capteurs et monitoring',
          firecontrol: 'Expert sécurité incendie'
        };

        // Agent routes
        const agentRoutes = {
          main: '/app/chat',
          vsd: '/app/vsd',
          meca: '/app/equipment-meca',
          glo: '/app/glo',
          hv: '/app/high-voltage',
          mobile: '/app/mobile-equipment',
          atex: '/app/atex',
          switchboard: '/app/switchboards',
          doors: '/app/doors',
          datahub: '/app/datahub',
          firecontrol: '/app/fire-control'
        };

        // Load custom names from database
        let customNames = {};
        try {
          const result = await pool.query(
            `SELECT key, text_value FROM app_settings WHERE key LIKE 'ai_agent_name_%'`
          );
          result.rows.forEach(row => {
            const agentType = row.key.replace('ai_agent_name_', '');
            if (row.text_value) {
              customNames[agentType] = row.text_value;
            }
          });
        } catch (e) {
          console.log('[TOOL] find_agent_by_name: Could not load custom names, using defaults');
        }

        // Merge with defaults
        const allNames = { ...defaultNames, ...customNames };

        // Normalize search name
        const searchName = agent_name.toLowerCase().trim();

        // Find matching agent
        let foundAgent = null;
        for (const [agentType, name] of Object.entries(allNames)) {
          if (name.toLowerCase() === searchName) {
            foundAgent = {
              type: agentType,
              name: name,
              description: agentDescriptions[agentType] || 'Agent spécialisé',
              route: agentRoutes[agentType] || '/app/chat'
            };
            break;
          }
        }

        // Also check partial matches
        if (!foundAgent) {
          for (const [agentType, name] of Object.entries(allNames)) {
            if (name.toLowerCase().includes(searchName) || searchName.includes(name.toLowerCase())) {
              foundAgent = {
                type: agentType,
                name: name,
                description: agentDescriptions[agentType] || 'Agent spécialisé',
                route: agentRoutes[agentType] || '/app/chat'
              };
              break;
            }
          }
        }

        if (foundAgent) {
          return {
            success: true,
            found: true,
            agent: foundAgent,
            message: `Agent "${foundAgent.name}" trouvé ! C'est le ${foundAgent.description}. Utilise transfer_to_agent avec type="${foundAgent.type}" pour ouvrir le chat avec cet agent.`,
            available_agents: Object.entries(allNames).map(([type, name]) => ({
              type,
              name,
              description: agentDescriptions[type]
            }))
          };
        } else {
          return {
            success: true,
            found: false,
            message: `Aucun agent nommé "${agent_name}" trouvé.`,
            available_agents: Object.entries(allNames).map(([type, name]) => ({
              type,
              name,
              description: agentDescriptions[type]
            })),
            suggestion: `Les agents disponibles sont: ${Object.values(allNames).join(', ')}`
          };
        }
      } catch (error) {
        console.error('[TOOL] find_agent_by_name error:', error.message);
        return { success: false, error: error.message };
      }
    }
  };
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

/**
 * Exécute un appel de tool et retourne le résultat
 */
async function executeToolCall(toolCall, handlers) {
  const { name, arguments: argsString } = toolCall.function;

  try {
    const args = JSON.parse(argsString || '{}');
    console.log(`[TOOL] Executing: ${name}`, args);

    const handler = handlers[name];
    if (!handler) {
      return {
        tool_call_id: toolCall.id,
        toolName: name,
        args,
        success: false,
        error: `Tool "${name}" not found`
      };
    }

    const result = await handler(args);
    console.log(`[TOOL] ${name} completed:`, result.success ? 'success' : 'failed');

    return {
      tool_call_id: toolCall.id,
      toolName: name,
      args,
      ...result
    };
  } catch (error) {
    console.error(`[TOOL] ${name} error:`, error.message);
    return {
      tool_call_id: toolCall.id,
      toolName: name,
      args: JSON.parse(argsString || '{}'),
      success: false,
      error: error.message
    };
  }
}

/**
 * Exécute plusieurs appels de tools en parallèle
 */
async function executeToolCalls(toolCalls, handlers) {
  const results = await Promise.all(
    toolCalls.map(tc => executeToolCall(tc, handlers))
  );
  return results;
}

// ============================================================================
// SIMPLIFIED SYSTEM PROMPT
// ============================================================================

const SIMPLIFIED_SYSTEM_PROMPT = `Tu es **Electro**, l'assistant IA d'ElectroHub pour la maintenance industrielle.

## TON RÔLE
- Aider les techniciens avec les équipements électriques, procédures et contrôles
- Utiliser les FONCTIONS disponibles pour accéder aux VRAIES données
- Répondre de façon concise, utile et actionnable
- Fournir des analyses pertinentes et des recommandations

## RÈGLES CRITIQUES
1. **UTILISE TOUJOURS LES FONCTIONS** pour accéder aux données réelles
2. **NE JAMAIS INVENTER** de données - utilise une fonction pour récupérer l'info
3. **SOIS BREF** - Pas de blabla, des réponses directes et structurées
4. **PROPOSE TOUJOURS** une action suivante ou des options
5. **ANALYSE INTELLIGEMMENT** - Combine les données pour donner des insights utiles

## QUAND UTILISER LES FONCTIONS

| Demande utilisateur | Fonction à utiliser |
|---------------------|---------------------|
| "derniers dépannages", "pannes", "incidents", "interventions" | search_troubleshooting |
| "équipement le plus problématique", "plus de pannes", "moins fiable" | analyze_equipment_reliability |
| "analyse par bâtiment", "quel bâtiment a le plus de problèmes" | analyze_by_building |
| "priorités maintenance", "quoi réparer en premier", "urgences" | get_maintenance_priorities |
| "procédure pour...", "comment faire...", "mode opératoire" | search_procedures |
| "ouvre/montre la procédure", "affiche la procédure" | open_procedure_modal |
| "équipements du bâtiment", "trouve le tableau", "où est..." | search_equipment |
| "contrôles en retard", "planning contrôles", "prochains contrôles", "état équipement" | get_controls |
| "NC ouvertes", "non-conformités", "anomalies" | get_non_conformities |
| "montre sur la carte", "localise", "plan" | show_map |
| "statistiques", "vue d'ensemble", "résumé", "combien de..." | get_statistics |
| "documentation", "fiche technique", "datasheet", "manuel" | search_documentation |
| "parler à l'agent de l'équipement", "agent spécialisé" | get_troubleshooting_equipment_context puis transfer_to_agent |
| "qu'est-ce que tu as appris", "ta mémoire", "tes observations" | get_agent_memory |
| "ce qui s'est passé hier", "résumé de la veille" | get_yesterday_summary |
| "passe-moi Daniel", "je veux parler à [NOM]", "où est Baptiste" | find_agent_by_name puis transfer_to_agent |

## 🤝 PARLER À UN AUTRE AGENT
Quand l'utilisateur demande de parler à un agent par son NOM (pas un équipement):
1. Utilise **find_agent_by_name** avec le nom mentionné
2. Si l'agent est trouvé, utilise **transfer_to_agent** avec le type retourné
3. Si l'agent n'est pas trouvé, liste les agents disponibles

**IMPORTANT**: Les noms des agents sont personnalisables. "Daniel", "Baptiste", etc. peuvent être des agents IA !
Si le nom ne correspond pas à un équipement connu, essaie d'abord find_agent_by_name.

## 🔗 TRANSFERT VERS AGENTS SPÉCIALISÉS
Quand l'utilisateur veut parler à l'agent d'un équipement mentionné dans un dépannage:
1. Utilise **get_troubleshooting_equipment_context** avec le nom de l'équipement
2. Si trouvé, utilise **transfer_to_agent** pour transférer vers l'agent spécialisé
3. Si non trouvé, explique que l'équipement n'est pas dans la base et propose des alternatives

**IMPORTANT**: Les dépannages contiennent equipment_type qui indique le type (door, vsd, meca, etc.)
Utilise cette info pour chercher dans la bonne table!

## ⚠️ ACCÈS AUX CONTRÔLES POUR TOUS LES AGENTS
**IMPORTANT**: Tous les contrôles sont centralisés dans "Switchboard Controls".
Même si tu es un agent spécialisé (Shakira pour VSD, Baptiste pour mobile, etc.),
tu peux et DOIS utiliser la fonction get_controls pour répondre aux questions sur:
- L'état des contrôles (en retard, à venir)
- Les échéances de contrôle
- Le planning de maintenance
Utilise le paramètre "building" pour filtrer par bâtiment si l'utilisateur est sur un équipement spécifique.

## SYNONYMES IMPORTANTS
- Panne = dépannage = incident = défaillance = breakdown = dysfonctionnement
- VSD = variateur = variateur de fréquence = drive
- Tableau = switchboard = armoire = coffret = TGBT
- NC = non-conformité = anomalie = écart

## FORMAT DE RÉPONSE
- Utilise des emojis: 🔧 📋 ⚠️ ✅ 📍 🗺️ 📊 🏭 ⚡
- **Gras** pour les éléments importants
- Listes à puces pour les énumérations
- Termine par une question ou proposition d'action

## EXEMPLES

**Recherche simple:**
User: "montre moi les dernières pannes"
→ [Utilise search_troubleshooting avec days=7]
→ "🔧 **3 pannes** cette semaine:
   1. VSD Pompe 12 - Surchauffe (critique)
   2. Tableau TGBT-02 - Défaut terre
   3. Moteur M05 - Vibrations

   Veux-tu les détails d'une panne ?"

**Analyse de fiabilité:**
User: "quel variateur tombe le plus en panne ?"
→ [Utilise analyze_equipment_reliability avec equipment_type='vsd']
→ "📊 **Top 3 VSD problématiques** (90 derniers jours):
   1. 🥇 VSD-P12 - 5 pannes (42% du total)
   2. 🥈 VSD-C03 - 2 pannes
   3. 🥉 VSD-M08 - 1 panne

   Le VSD-P12 nécessite une attention particulière. Voir les détails ?"

**Analyse par bâtiment:**
User: "quel bâtiment a le plus de problèmes ?"
→ [Utilise analyze_by_building avec generate_chart=true]
→ "🏭 **Analyse par bâtiment** (30 jours):
   • Bât. 02: 8 pannes, 3 contrôles en retard ⚠️
   • Bât. 05: 4 pannes, 1 contrôle en retard
   • Bât. 01: 2 pannes, 0 contrôle en retard ✅

   Le bâtiment 02 concentre 50% des problèmes."

**Priorités maintenance:**
User: "qu'est-ce qui a besoin d'attention ?"
→ [Utilise get_maintenance_priorities avec criteria='combined']
→ "🚨 **5 priorités critiques**:
   1. TGBT-02 - Contrôle en retard de 45 jours
   2. VSD-P12 - 5 pannes en 90 jours
   3. NC-0234 - Défaut isolation (critique)

   Par quoi veux-tu commencer ?"`;


// ============================================================================
// EXPORTS
// ============================================================================

export {
  TOOLS_DEFINITIONS,
  SIMPLIFIED_SYSTEM_PROMPT,
  createToolHandlers,
  executeToolCall,
  executeToolCalls
};
