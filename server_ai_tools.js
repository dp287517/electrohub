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
  // TRANSFERT DE DÉPANNAGE
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "propose_troubleshooting_transfer",
      description: `Propose de transférer un dépannage vers un autre équipement quand le technicien s'est trompé.

UTILISE CETTE FONCTION QUAND l'utilisateur dit:
- "je me suis trompé d'équipement", "mauvais équipement"
- "ce dépannage devrait être sur...", "c'était pas le bon équipement"
- "transfère ce dépannage vers...", "déplace l'intervention sur..."
- "erreur, c'était l'équipement X", "corrige l'équipement"

**IMPORTANT - NE PAS DEVINER LA DESTINATION !**
Si l'utilisateur dit juste "c'est pas le bon équipement" SANS préciser la destination:
→ NE PAS appeler cette fonction !
→ DEMANDE d'abord: "Vers quel équipement voulez-vous transférer ce dépannage ?"

N'appelle cette fonction QUE si l'utilisateur a clairement indiqué l'équipement CIBLE.

WORKFLOW:
1. L'utilisateur signale une erreur ET précise l'équipement cible
2. Tu recherches l'équipement cible
3. Tu proposes le transfert avec un bouton de confirmation
4. L'utilisateur confirme et le transfert est effectué`,
      parameters: {
        type: "object",
        properties: {
          troubleshooting_id: {
            type: "string",
            description: "ID du dépannage à transférer (optionnel - prend le plus récent si non spécifié)"
          },
          target_equipment_name: {
            type: "string",
            description: "Nom ou partie du nom de l'équipement CIBLE (où le dépannage DOIT être transféré)"
          },
          target_equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "glo", "doors", "datahub"],
            description: "Type de l'équipement cible (optionnel)"
          },
          target_building: {
            type: "string",
            description: "Bâtiment de l'équipement cible (optionnel, pour affiner la recherche)"
          },
          current_equipment_id: {
            type: "string",
            description: "ID de l'équipement actuel à EXCLURE des résultats (car l'utilisateur est dessus)"
          },
          source_equipment_name: {
            type: "string",
            description: "Nom de l'équipement SOURCE (où l'utilisateur se trouve) - pour chercher le dernier dépannage de CET équipement, pas le dernier global"
          }
        },
        required: ["target_equipment_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "confirm_troubleshooting_transfer",
      description: `Exécute le transfert d'un dépannage vers un autre équipement après confirmation de l'utilisateur.

⚠️ NE PAS UTILISER DIRECTEMENT - Utiliser propose_troubleshooting_transfer d'abord
Cette fonction est appelée automatiquement quand l'utilisateur clique sur le bouton de confirmation.`,
      parameters: {
        type: "object",
        properties: {
          troubleshooting_id: {
            type: "string",
            description: "ID du dépannage à transférer"
          },
          target_equipment_id: {
            type: "string",
            description: "ID de l'équipement cible"
          },
          target_equipment_type: {
            type: "string",
            description: "Type de l'équipement cible"
          },
          target_equipment_name: {
            type: "string",
            description: "Nom de l'équipement cible"
          },
          target_building: {
            type: "string",
            description: "Bâtiment de l'équipement cible"
          }
        },
        required: ["troubleshooting_id", "target_equipment_id", "target_equipment_type", "target_equipment_name"]
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
      description: `Recherche des équipements dans TOUTES les catégories (tableaux, variateurs, portes, datahub/capteurs, etc.).

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "où est le tableau...", "trouve l'équipement..."
- "équipements du bâtiment X", "tableaux de l'étage Y"
- "liste des variateurs", "équipements ATEX"
- Quand un dépannage mentionne un équipement et tu veux le retrouver
- Toute question sur la localisation ou l'état d'équipements

⚠️ **RÈGLE IMPORTANTE**: NE SPÉCIFIE PAS equipment_type sauf si l'utilisateur le demande EXPLICITEMENT.
- Si l'utilisateur dit juste un nom (ex: "flux laminaire microdoseur"), cherche avec name SANS type
- La recherche ira automatiquement dans TOUS les types et TOUTES les catégories (dont datahub)
- Les équipements datahub ont des CATÉGORIES (ex: "Flux laminaire" est une catégorie, "microdoseur" est le nom)

**CATÉGORIES DATAHUB**: Les capteurs/équipements datahub sont organisés en catégories.
Exemple: Pour "Flux laminaire microdoseur", "Flux laminaire" = catégorie, "microdoseur" = nom.
La recherche trouve l'équipement même si tu donnes "catégorie + nom".`,
      parameters: {
        type: "object",
        properties: {
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "glo", "datahub", "infrastructure"],
            description: "Type d'équipement - NE PAS SPÉCIFIER sauf demande explicite de l'utilisateur. La recherche par défaut cherche dans TOUS les types."
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
            description: "Nom ou partie du nom de l'équipement (peut inclure la catégorie pour datahub)"
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
      description: `Récupère les contrôles planifiés, en retard ou à venir pour tous types d'équipements.

⚠️ IMPORTANT:
- Les contrôles des tableaux électriques sont dans "Switchboard Controls" (scheduled_controls)
- Les contrôles des portes coupe-feu sont dans "Fire Door Checks" (fd_checks)
- Cette fonction gère automatiquement les deux types selon le paramètre equipment_type

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "contrôles en retard", "équipements à contrôler"
- "planning des contrôles", "contrôles de la semaine"
- "qu'est-ce que je dois faire aujourd'hui"
- "quel est l'état de cet équipement" (pour les contrôles)
- "y a-t-il des contrôles en retard ?"
- "prochain contrôle prévu", "échéances"
- "dernier contrôle de cette porte", "historique contrôles porte"
- Toute question sur les contrôles ou la planification

POUR LES PORTES COUPE-FEU:
- Utilise equipment_type="doors" pour filtrer uniquement les portes
- Le door_id peut être passé dans equipment_id pour une porte spécifique`,
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["overdue", "today", "this_week", "this_month", "next_30_days", "all", "last", "history"],
            description: "Filtre temporel. 'last' = dernier contrôle effectué, 'history' = historique des contrôles"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "doors", "vsd", "meca", "atex", "hv", "mobile", "all"],
            description: "Type d'équipement. 'doors' pour les portes coupe-feu, 'switchboard' pour tableaux"
          },
          building: {
            type: "string",
            description: "Code du bâtiment pour filtrer (très utile pour contextualiser)"
          },
          equipment_id: {
            type: "string",
            description: "ID spécifique d'un équipement (switchboard ou door) pour filtrer ses contrôles"
          },
          equipment_name: {
            type: "string",
            description: "Nom de l'équipement pour recherche (ex: 'Porte 001', 'TD-A1')"
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
- "montre sur la carte", "voir le plan", "localise"
- "où se trouve...", "localisation de..."
- "carte du bâtiment X"
- "affiche X sur le plan"

Tu peux utiliser soit equipment_ids (si tu connais les IDs), soit equipment_name (pour rechercher par nom).
IMPORTANT: Si l'utilisateur demande de voir un équipement sur la carte, utilise TOUJOURS cette fonction avec le nom de l'équipement.`,
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
            description: "Liste des IDs d'équipements à mettre en évidence (si connus)"
          },
          equipment_name: {
            type: "string",
            description: "Nom ou code de l'équipement à rechercher et afficher sur la carte (ex: 'Tableau Général', '27-9-G')"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "mobile", "hv", "glo", "atex", "datahub", "infrastructure", "doors", "firecontrol"],
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
            enum: ["electro", "meca", "hv", "vsd", "atex", "mobile", "doors", "datahub", "switchboards", "glo", "infrastructure"],
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
            enum: ["electro", "meca", "hv", "vsd", "atex", "mobile", "doors", "datahub", "switchboards", "glo", "infrastructure", "all"],
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
            enum: ["electro", "meca", "hv", "vsd", "atex", "mobile", "doors", "datahub", "switchboards", "glo", "infrastructure"],
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
- Suite à search_equipment avec suggest_transfer=true

**IMPORTANT**: Après avoir appelé cette fonction, tu DOIS IMMÉDIATEMENT parler en tant que le NOUVEL agent !
Le nouvel agent doit se présenter et proposer son aide avec le contexte de l'équipement.

Cette fonction retourne les informations pour basculer vers l'agent spécialisé.`,
      parameters: {
        type: "object",
        properties: {
          equipment_id: {
            type: "string",
            description: "ID de l'équipement"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "glo", "datahub", "doors", "infrastructure"],
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
  },

  // -------------------------------------------------------------------------
  // COMPARAISON D'ÉQUIPEMENTS
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "compare_equipment",
      description: `Compare deux équipements en termes de fiabilité, pannes, contrôles.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "compare ces deux équipements", "différence entre X et Y"
- "lequel est le plus fiable", "le meilleur entre..."
- "performance comparée", "comparer les pannes"
- "X vs Y", "contre", "ou bien"`,
      parameters: {
        type: "object",
        properties: {
          equipment_1_name: {
            type: "string",
            description: "Nom ou code du premier équipement"
          },
          equipment_2_name: {
            type: "string",
            description: "Nom ou code du deuxième équipement"
          },
          period_days: {
            type: "number",
            description: "Période de comparaison en jours (défaut: 90)"
          }
        },
        required: ["equipment_1_name", "equipment_2_name"]
      }
    }
  },

  // -------------------------------------------------------------------------
  // PRÉDICTION DE PANNE (ML Service)
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "predict_equipment_failure",
      description: `Prédit le risque de panne d'un équipement en utilisant l'IA prédictive.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "risque de panne", "probabilité de défaillance"
- "quand va tomber en panne", "prédiction"
- "équipement à risque", "vulnérable"
- "maintenance prédictive", "anticiper les pannes"`,
      parameters: {
        type: "object",
        properties: {
          equipment_name: {
            type: "string",
            description: "Nom de l'équipement à analyser"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "all"],
            description: "Type d'équipement"
          }
        },
        required: ["equipment_name"]
      }
    }
  },

  // -------------------------------------------------------------------------
  // HISTORIQUE COMPLET D'UN ÉQUIPEMENT
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_equipment_history",
      description: `Récupère l'historique complet d'un équipement : pannes, contrôles, NC, modifications.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "historique de cet équipement", "tout sur X"
- "depuis quand", "évolution de"
- "vie de l'équipement", "parcours"
- "qu'est-ce qui s'est passé avec..."`,
      parameters: {
        type: "object",
        properties: {
          equipment_name: {
            type: "string",
            description: "Nom ou code de l'équipement"
          },
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "glo", "hv", "mobile", "doors"],
            description: "Type d'équipement"
          },
          include_controls: {
            type: "boolean",
            description: "Inclure l'historique des contrôles (défaut: true)"
          },
          include_nc: {
            type: "boolean",
            description: "Inclure les non-conformités (défaut: true)"
          },
          include_troubleshooting: {
            type: "boolean",
            description: "Inclure les dépannages (défaut: true)"
          }
        },
        required: ["equipment_name"]
      }
    }
  },

  // -------------------------------------------------------------------------
  // CHARGE DE TRAVAIL ÉQUIPE
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_team_workload",
      description: `Analyse la charge de travail de l'équipe maintenance.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "charge de travail", "planning équipe"
- "qui fait quoi", "répartition du travail"
- "combien de contrôles à faire", "workload"
- "est-ce qu'on est surchargés", "capacité"`,
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "this_week", "this_month", "next_week"],
            description: "Période à analyser"
          },
          include_overdue: {
            type: "boolean",
            description: "Inclure les tâches en retard (défaut: true)"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // RÉSUMÉ INTELLIGENT DU JOUR
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_daily_briefing",
      description: `Génère un briefing intelligent pour la journée.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "brief du jour", "résumé du matin"
- "quoi de neuf", "situation actuelle"
- "qu'est-ce qui m'attend", "ma journée"
- "bonjour", "salut" (en début de journée)`,
      parameters: {
        type: "object",
        properties: {
          include_yesterday: {
            type: "boolean",
            description: "Inclure les événements de la veille (défaut: true)"
          },
          include_priorities: {
            type: "boolean",
            description: "Inclure les priorités du jour (défaut: true)"
          },
          include_weather: {
            type: "boolean",
            description: "Inclure les conditions qui peuvent affecter le travail"
          }
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // DASHBOARD ÉQUIPEMENTS POUR AGENT SPÉCIALISÉ
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_my_equipment_dashboard",
      description: `Récupère le tableau de bord complet des équipements du domaine de l'agent.
Chaque agent IA spécialisé peut utiliser cette fonction pour voir:
- Tous ses équipements et leur état
- Les contrôles à venir et en retard
- Les dépannages récents
- Les métriques et KPIs de son domaine
- Les messages des autres agents

UTILISE CETTE FONCTION QUAND:
- L'utilisateur demande "mes équipements", "mon dashboard"
- Pour avoir une vue d'ensemble de ton domaine
- Au début d'une conversation pour connaître l'état de ton parc`,
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            enum: ["vsd", "meca", "glo", "hv", "mobile", "atex", "switchboard", "doors", "datahub", "firecontrol"],
            description: "Type d'agent (déterminé automatiquement si non spécifié)"
          },
          include_equipment_list: {
            type: "boolean",
            description: "Inclure la liste des équipements (défaut: true, limité à 50)"
          },
          include_controls: {
            type: "boolean",
            description: "Inclure les contrôles à venir et en retard (défaut: true)"
          },
          include_troubleshooting: {
            type: "boolean",
            description: "Inclure les dépannages récents (défaut: true)"
          },
          include_communications: {
            type: "boolean",
            description: "Inclure les messages des autres agents (défaut: true)"
          }
        }
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
    // TRANSFERT DE DÉPANNAGE (Version intelligente)
    // -----------------------------------------------------------------------
    propose_troubleshooting_transfer: async (params) => {
      const { troubleshooting_id, target_equipment_name, target_equipment_type, target_building, current_equipment_id, source_equipment_name } = params;

      try {
        // 1. Récupérer le dépannage à transférer
        // Si on a un ID, chercher ce dépannage précis
        // Sinon, chercher le plus récent de l'équipement source (si spécifié) ou le plus récent global
        let troubleQuery = `
          SELECT id, title, description, equipment_id, equipment_type, equipment_name, building_code, started_at
          FROM troubleshooting_records
          WHERE site = $1
        `;
        const troubleParams = [site];
        let paramIdx = 2;

        if (troubleshooting_id) {
          troubleQuery += ` AND id = $${paramIdx}`;
          troubleParams.push(troubleshooting_id);
          paramIdx++;
        } else if (source_equipment_name) {
          // Filtrer par l'équipement source (celui où l'utilisateur se trouve)
          troubleQuery += ` AND LOWER(equipment_name) LIKE $${paramIdx}`;
          troubleParams.push(`%${source_equipment_name.toLowerCase()}%`);
          paramIdx++;
          troubleQuery += ` ORDER BY started_at DESC LIMIT 1`;
        } else {
          troubleQuery += ` ORDER BY started_at DESC LIMIT 1`;
        }

        const troubleResult = await pool.query(troubleQuery, troubleParams);

        if (troubleResult.rows.length === 0) {
          return {
            success: false,
            error: troubleshooting_id
              ? `Dépannage #${troubleshooting_id} non trouvé.`
              : `Aucun dépannage récent trouvé.`,
            message: 'Impossible de trouver le dépannage à transférer.'
          };
        }

        const troubleshooting = troubleResult.rows[0];

        // 2. Configuration des tables d'équipements avec descriptions pour l'utilisateur
        // IMPORTANT: siteColumn = colonne site directe, siteJoin = join sur table sites
        const tableMap = {
          switchboard: { table: 'switchboards', nameCol: 'name', buildingCol: 'building_code', codeCol: 'code', siteColumn: 'site', label: 'Tableau électrique', agent: 'Matrix' },
          vsd: { table: 'vsd_equipments', nameCol: 'name', buildingCol: 'building', codeCol: null, siteColumn: 'site', label: 'Variateur (VSD)', agent: 'Shakira' },
          meca: { table: 'meca_equipments', nameCol: 'name', buildingCol: 'building', codeCol: null, siteColumn: null, siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id', siteCondition: "s.name = $1", label: 'Équipement mécanique', agent: 'Titan' },
          atex: { table: 'atex_equipments', nameCol: 'name', buildingCol: 'building', codeCol: 'tag', siteColumn: null, siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id', siteCondition: "s.name = $1", label: 'Zone ATEX', agent: 'Phoenix' },
          hv: { table: 'hv_equipments', nameCol: 'name', buildingCol: 'building_code', codeCol: 'code', siteColumn: null, label: 'Haute tension', agent: 'Voltaire' },
          mobile: { table: 'me_equipments', nameCol: 'name', buildingCol: 'building', codeCol: 'code', siteColumn: null, label: 'Équipement mobile', agent: 'Nomad' },
          glo: { table: 'glo_equipments', nameCol: 'name', buildingCol: 'building', codeCol: 'tag', siteColumn: null, label: 'Éclairage de sécurité', agent: 'Lumina' },
          doors: { table: 'fd_doors', nameCol: 'name', buildingCol: 'building', codeCol: null, siteColumn: null, siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id', siteCondition: "s.name = $1", label: 'Porte coupe-feu', agent: 'Portal' },
          datahub: { table: 'dh_items', nameCol: 'name', buildingCol: 'building', codeCol: 'code', siteColumn: null, label: 'Capteur/Monitoring', agent: 'Nexus', hasCategory: true }
        };

        // PRIORITÉ: Si type spécifié, chercher UNIQUEMENT dans ce type d'abord
        // Sinon chercher dans l'ordre mais NE PAS mélanger les résultats
        let typesToSearch;
        if (target_equipment_type) {
          typesToSearch = [target_equipment_type];
        } else {
          // Ordre de priorité: meca, vsd, switchboard... datahub en dernier
          typesToSearch = ['meca', 'vsd', 'switchboard', 'atex', 'hv', 'mobile', 'glo', 'doors', 'datahub'];
        }

        const candidates = [];
        const similarEquipments = [];

        // 3. Préparer les termes de recherche (mots individuels pour recherche floue)
        // IMPORTANT: Garder les chiffres et mots courts car ils sont souvent importants (ex: "Otrivin 3")
        const searchTerms = target_equipment_name.toLowerCase().split(/\s+/).filter(t => t.length >= 1);
        const exactPattern = `%${target_equipment_name.toLowerCase()}%`;

        // Si un seul mot, ajouter aussi une recherche sans les espaces pour les numéros collés
        const compactPattern = target_equipment_name.replace(/\s+/g, '').toLowerCase();
        const alternatePattern = compactPattern !== target_equipment_name.toLowerCase() ? `%${compactPattern}%` : null;

        for (const eqType of typesToSearch) {
          const config = tableMap[eqType];
          if (!config) continue;

          try {
            // Recherche spéciale pour datahub avec catégories
            // NOTE: dh_items n'a PAS de colonne site - pas de filtre site
            if (config.hasCategory) {
              // Recherche dans nom ET catégorie pour datahub - inclut pattern alternatif (ex: "otrivin3")
              const datahubPatterns = alternatePattern ? [exactPattern, alternatePattern] : [exactPattern];

              for (const pattern of datahubPatterns) {
                let datahubQuery = `
                  SELECT dh.id, dh.name, dh.building, dhc.name as category_name,
                         '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                  FROM dh_items dh
                  LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
                  WHERE (
                    LOWER(dh.name) LIKE $1
                    OR LOWER(dhc.name) LIKE $1
                    OR LOWER(COALESCE(dhc.name, '') || ' ' || dh.name) LIKE $1
                    OR LOWER(REPLACE(COALESCE(dhc.name, '') || dh.name, ' ', '')) LIKE $1
                    OR (dh.code IS NOT NULL AND LOWER(dh.code) LIKE $1)
                  )
                `;
                let datahubParams = [pattern];

                if (target_building) {
                  datahubQuery += ` AND UPPER(dh.building) = $2`;
                  datahubParams.push(target_building.toUpperCase());
                }

                datahubQuery += ` LIMIT 5`;
                const datahubResult = await pool.query(datahubQuery, datahubParams);

                // Formater le nom avec la catégorie
                for (const row of datahubResult.rows) {
                  if (!candidates.find(c => c.id === row.id && c.equipment_type === eqType)) {
                    candidates.push({
                      ...row,
                      name: row.category_name ? `${row.category_name} - ${row.name}` : row.name,
                      original_name: row.name
                    });
                  }
                }
              }

              // IMPORTANT: Si on a trouvé des candidats exacts dans datahub, arrêter la recherche
              if (candidates.filter(c => c.equipment_type === eqType).length > 0) {
                break; // Arrêter dès qu'on trouve dans ce type
              }

              // Recherche floue avec TOUS les mots individuels (y compris chiffres)
              if (searchTerms.length > 0) {
                for (const term of searchTerms) {
                  const fuzzyQuery = `
                    SELECT dh.id, dh.name, dh.building, dhc.name as category_name,
                           '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                    FROM dh_items dh
                    LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
                    WHERE (
                      LOWER(dh.name) LIKE $1
                      OR LOWER(dhc.name) LIKE $1
                      OR (dh.code IS NOT NULL AND LOWER(dh.code) LIKE $1)
                    )
                    LIMIT 5
                  `;
                  const fuzzyResult = await pool.query(fuzzyQuery, [`%${term}%`]);
                  for (const row of fuzzyResult.rows) {
                    if (!similarEquipments.find(s => s.id === row.id && s.equipment_type === eqType)) {
                      similarEquipments.push({
                        ...row,
                        name: row.category_name ? `${row.category_name} - ${row.name}` : row.name,
                        original_name: row.name
                      });
                    }
                  }
                }
              }
              continue;
            }

            // Recherche standard pour les autres types
            // Construire la requête selon la configuration du site
            let searchQuery;
            let searchParams;
            const nameCondition = config.codeCol
              ? `(LOWER(e.${config.nameCol}) LIKE $PATTERN OR LOWER(e.${config.codeCol}) LIKE $PATTERN)`
              : `LOWER(e.${config.nameCol}) LIKE $PATTERN`;
            const buildingCondition = target_building ? `AND UPPER(e.${config.buildingCol}) = $BUILDING` : '';

            if (config.siteJoin) {
              // Tables avec join sur sites (meca, atex, doors)
              searchQuery = `
                SELECT e.id, e.${config.nameCol} as name, e.${config.buildingCol} as building,
                       '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                FROM ${config.table} e
                ${config.siteJoin.replace('{table}', 'e')}
                WHERE ${config.siteCondition} AND ${nameCondition.replace(/\$PATTERN/g, '$2')} ${buildingCondition.replace('$BUILDING', '$3')}
                LIMIT 5
              `;
              searchParams = [site, exactPattern];
              if (target_building) searchParams.push(target_building.toUpperCase());
            } else if (config.siteColumn) {
              // Tables avec colonne site directe (switchboard, vsd, datahub)
              searchQuery = `
                SELECT e.id, e.${config.nameCol} as name, e.${config.buildingCol} as building,
                       '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                FROM ${config.table} e
                WHERE e.${config.siteColumn} = $1 AND ${nameCondition.replace(/\$PATTERN/g, '$2')} ${buildingCondition.replace('$BUILDING', '$3')}
                LIMIT 5
              `;
              searchParams = [site, exactPattern];
              if (target_building) searchParams.push(target_building.toUpperCase());
            } else {
              // Tables sans filtre site (hv, mobile, glo)
              searchQuery = `
                SELECT e.id, e.${config.nameCol} as name, e.${config.buildingCol} as building,
                       '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                FROM ${config.table} e
                WHERE ${nameCondition.replace(/\$PATTERN/g, '$1')} ${buildingCondition.replace('$BUILDING', '$2')}
                LIMIT 5
              `;
              searchParams = [exactPattern];
              if (target_building) searchParams.push(target_building.toUpperCase());
            }

            const searchResult = await pool.query(searchQuery, searchParams);

            // IMPORTANT: Si on trouve des résultats exacts, on arrête la recherche
            if (searchResult.rows.length > 0) {
              candidates.push(...searchResult.rows);
              break; // Arrêter dès qu'on trouve dans ce type
            }

            // Si pas de résultat exact, recherche floue avec les mots individuels
            if (searchTerms.length > 0) {
              for (const term of searchTerms) {
                let fuzzyQuery;
                let fuzzyParams;
                const termPattern = `%${term}%`;

                if (config.siteJoin) {
                  fuzzyQuery = `
                    SELECT e.id, e.${config.nameCol} as name, e.${config.buildingCol} as building,
                           '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                    FROM ${config.table} e
                    ${config.siteJoin.replace('{table}', 'e')}
                    WHERE ${config.siteCondition} AND LOWER(e.${config.nameCol}) LIKE $2
                    LIMIT 3
                  `;
                  fuzzyParams = [site, termPattern];
                } else if (config.siteColumn) {
                  fuzzyQuery = `
                    SELECT e.id, e.${config.nameCol} as name, e.${config.buildingCol} as building,
                           '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                    FROM ${config.table} e
                    WHERE e.${config.siteColumn} = $1 AND LOWER(e.${config.nameCol}) LIKE $2
                    LIMIT 3
                  `;
                  fuzzyParams = [site, termPattern];
                } else {
                  fuzzyQuery = `
                    SELECT e.id, e.${config.nameCol} as name, e.${config.buildingCol} as building,
                           '${eqType}' as equipment_type, '${config.label}' as type_label, '${config.agent}' as agent_name
                    FROM ${config.table} e
                    WHERE LOWER(e.${config.nameCol}) LIKE $1
                    LIMIT 3
                  `;
                  fuzzyParams = [termPattern];
                }

                const fuzzyResult = await pool.query(fuzzyQuery, fuzzyParams);
                for (const row of fuzzyResult.rows) {
                  if (!similarEquipments.find(s => s.id === row.id)) {
                    similarEquipments.push(row);
                  }
                }
              }
            }
          } catch (e) {
            // Table might not exist, continue
          }
        }

        // 3.5 Filtrer l'équipement actuel (ne pas proposer de transférer vers soi-même !)
        if (current_equipment_id) {
          const currentIdStr = String(current_equipment_id);
          // Filtrer les candidats exacts
          const filteredCandidates = candidates.filter(c => String(c.id) !== currentIdStr);
          candidates.length = 0;
          candidates.push(...filteredCandidates);
          // Filtrer les équipements similaires
          const filteredSimilar = similarEquipments.filter(s => String(s.id) !== currentIdStr);
          similarEquipments.length = 0;
          similarEquipments.push(...filteredSimilar);
        }

        // 4. Si aucun candidat exact trouvé
        if (candidates.length === 0) {
          // Mais on a des équipements similaires
          if (similarEquipments.length > 0) {
            const similarList = similarEquipments.slice(0, 6).map((c, idx) =>
              `${idx + 1}. **${c.name}** (${c.type_label} - Bât. ${c.building || 'N/A'}) [ID: ${c.id}]`
            ).join('\n');

            return {
              success: true,
              needs_clarification: true,
              partial_match: true,
              troubleshooting: {
                id: troubleshooting.id,
                title: troubleshooting.title,
                current_equipment: troubleshooting.equipment_name,
                current_building: troubleshooting.building_code
              },
              candidates: similarEquipments.slice(0, 6).map(c => ({
                id: c.id,
                name: c.name,
                building: c.building,
                type: c.equipment_type,
                type_label: c.type_label,
                agent: c.agent_name
              })),
              message: `Je n'ai pas trouvé "${target_equipment_name}" exactement, mais voici des équipements similaires:\n\n${similarList}\n\n**Dépannage ID**: ${troubleshooting.id}\n\nIndique le numéro de ton choix (1, 2, etc.) pour effectuer le transfert.`,
              ai_hint: `Quand l'utilisateur choisit un numéro, appelle confirm_troubleshooting_transfer avec troubleshooting_id="${troubleshooting.id}" et l'ID de l'équipement choisi.`,
              frontend_instruction: {
                showTransferCandidates: true,
                troubleshootingId: troubleshooting.id,
                candidates: similarEquipments.slice(0, 6).map(c => ({
                  id: c.id,
                  name: c.name,
                  building: c.building,
                  type: c.equipment_type,
                  type_label: c.type_label,
                  label: `${c.name} (${c.type_label} - ${c.building || 'N/A'})`
                }))
              }
            };
          }

          // Aucun équipement trouvé du tout - demander le type
          return {
            success: false,
            no_match: true,
            troubleshooting: {
              id: troubleshooting.id,
              title: troubleshooting.title,
              current_equipment: troubleshooting.equipment_name,
              current_building: troubleshooting.building_code
            },
            message: `Je n'ai trouvé aucun équipement "${target_equipment_name}". De quel type d'équipement s'agit-il ?`,
            equipment_types: Object.entries(tableMap).map(([key, config]) => ({
              type: key,
              label: config.label,
              agent: config.agent
            })),
            suggestion: `Dis-moi si c'est un tableau électrique, un variateur, une porte coupe-feu, ou autre. Je demanderai à l'agent spécialisé de le chercher.`
          };
        }

        // 5. Si plusieurs candidats, demander clarification
        if (candidates.length > 1) {
          // Construire un message avec les IDs pour que l'AI puisse les réutiliser
          const candidatesList = candidates.map((c, idx) =>
            `${idx + 1}. **${c.name}** (${c.type_label} - Bât. ${c.building || 'N/A'}) [ID: ${c.id}]`
          ).join('\n');

          return {
            success: true,
            needs_clarification: true,
            troubleshooting: {
              id: troubleshooting.id,
              title: troubleshooting.title,
              current_equipment: troubleshooting.equipment_name,
              current_building: troubleshooting.building_code
            },
            candidates: candidates.map(c => ({
              id: c.id,
              name: c.name,
              building: c.building,
              type: c.equipment_type,
              type_label: c.type_label,
              agent: c.agent_name
            })),
            // Message enrichi avec les IDs pour référence
            message: `J'ai trouvé ${candidates.length} équipements pour le transfert du dépannage "${troubleshooting.title}":\n\n${candidatesList}\n\n**Dépannage ID**: ${troubleshooting.id}\n\nIndique le numéro de ton choix (1, 2, etc.) et j'effectuerai le transfert.`,
            // Hint pour l'AI sur comment confirmer
            ai_hint: `Quand l'utilisateur choisit un numéro, appelle confirm_troubleshooting_transfer avec troubleshooting_id="${troubleshooting.id}" et l'ID de l'équipement choisi.`,
            frontend_instruction: {
              showTransferCandidates: true,
              troubleshootingId: troubleshooting.id,
              candidates: candidates.map(c => ({
                id: c.id,
                name: c.name,
                building: c.building,
                type: c.equipment_type,
                type_label: c.type_label,
                label: `${c.name} (${c.type_label} - ${c.building || 'N/A'})`
              }))
            }
          };
        }

        // 6. Un seul candidat - proposer le transfert avec bouton de confirmation
        const target = candidates[0];
        const sourceAgent = tableMap[troubleshooting.equipment_type]?.agent;
        const targetAgent = target.agent_name;

        return {
          success: true,
          ready_for_transfer: true,
          troubleshooting: {
            id: troubleshooting.id,
            title: troubleshooting.title,
            description: troubleshooting.description,
            current_equipment: troubleshooting.equipment_name,
            current_building: troubleshooting.building_code,
            current_type: troubleshooting.equipment_type
          },
          target_equipment: {
            id: target.id,
            name: target.name,
            building: target.building,
            type: target.equipment_type,
            type_label: target.type_label
          },
          agent_change: sourceAgent !== targetAgent ? {
            from: sourceAgent,
            to: targetAgent,
            message: `Cet équipement est géré par ${targetAgent}.`
          } : null,
          message: `Transfert vers ${target.name} (${target.type_label})`,
          frontend_instruction: {
            showTransferConfirmation: true,
            transferData: {
              troubleshootingId: troubleshooting.id,
              troubleshootingTitle: troubleshooting.title,
              sourceEquipment: troubleshooting.equipment_name,
              sourceBuilding: troubleshooting.building_code,
              targetEquipmentId: target.id,
              targetEquipmentName: target.name,
              targetEquipmentType: target.equipment_type,
              targetBuilding: target.building
            }
          }
        };
      } catch (error) {
        console.error('[TOOL] propose_troubleshooting_transfer error:', error.message);
        return { success: false, error: error.message };
      }
    },

    confirm_troubleshooting_transfer: async (params) => {
      const { troubleshooting_id, target_equipment_id, target_equipment_type, target_equipment_name, target_building } = params;

      try {
        // Vérifier que le dépannage existe
        const checkResult = await pool.query(
          `SELECT id, title, equipment_name, building_code FROM troubleshooting_records WHERE id = $1 AND site = $2`,
          [troubleshooting_id, site]
        );

        if (checkResult.rows.length === 0) {
          return {
            success: false,
            error: `Dépannage #${troubleshooting_id} non trouvé.`
          };
        }

        const original = checkResult.rows[0];

        // Mettre à jour le dépannage
        const updateResult = await pool.query(`
          UPDATE troubleshooting_records
          SET
            equipment_id = $1,
            equipment_type = $2,
            equipment_name = $3,
            building_code = $4,
            updated_at = NOW()
          WHERE id = $5 AND site = $6
          RETURNING id, title, equipment_name, building_code
        `, [target_equipment_id, target_equipment_type, target_equipment_name, target_building, troubleshooting_id, site]);

        if (updateResult.rows.length === 0) {
          return {
            success: false,
            error: 'Erreur lors de la mise à jour du dépannage.'
          };
        }

        const updated = updateResult.rows[0];

        // Log de l'action (optionnel - pour audit)
        console.log(`[TRANSFER] Troubleshooting ${troubleshooting_id} transferred from ${original.equipment_name} to ${target_equipment_name}`);

        return {
          success: true,
          message: `✅ Transfert effectué avec succès !\n\n📋 **${updated.title}**\n\n- **Ancien équipement**: ${original.equipment_name} (${original.building_code || 'N/A'})\n- **Nouvel équipement**: ${updated.equipment_name} (${updated.building_code || 'N/A'})`,
          transfer: {
            troubleshooting_id: updated.id,
            title: updated.title,
            from: {
              equipment: original.equipment_name,
              building: original.building_code
            },
            to: {
              equipment: updated.equipment_name,
              building: updated.building_code,
              type: target_equipment_type
            }
          },
          frontend_instruction: {
            transferComplete: true,
            troubleshootingId: troubleshooting_id,
            refreshTroubleshooting: true
          }
        };
      } catch (error) {
        console.error('[TOOL] confirm_troubleshooting_transfer error:', error.message);
        return { success: false, error: error.message };
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
          codeCol: 'code',
          label: 'Tableau électrique'
        },
        vsd: {
          table: 'vsd_equipments',
          columns: 'id, name, building as building_code, floor, location as room',
          siteColumn: 'site',
          buildingCol: 'building',
          codeCol: null, // pas de code/tag
          label: 'Variateur (VSD)'
        },
        meca: {
          table: 'meca_equipments',
          columns: 'id, name, building as building_code, floor, location as room',
          siteColumn: null, // utilise site_id join
          siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id',
          siteCondition: "s.name = $1",
          buildingCol: 'building',
          codeCol: null,
          label: 'Équipement mécanique'
        },
        atex: {
          table: 'atex_equipments',
          columns: 'id, name, tag as code, building as building_code, floor, location as room',
          siteColumn: null,
          siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id',
          siteCondition: "s.name = $1",
          buildingCol: 'building',
          codeCol: 'tag',
          label: 'Zone ATEX'
        },
        mobile: {
          table: 'me_equipments',
          columns: 'id, name, code, building as building_code, floor, location as room',
          siteColumn: null, // pas de filtre site apparent
          buildingCol: 'building',
          codeCol: 'code',
          label: 'Équipement mobile'
        },
        hv: {
          table: 'hv_equipments',
          columns: 'id, name, code, building_code, floor, room',
          siteColumn: null, // pas de filtre site apparent
          buildingCol: 'building_code',
          codeCol: 'code',
          label: 'Haute tension'
        },
        glo: {
          table: 'glo_equipments',
          columns: 'id, name, tag as code, building as building_code, floor, location as room',
          siteColumn: null,
          buildingCol: 'building',
          codeCol: 'tag',
          label: 'Éclairage de sécurité'
        },
        datahub: {
          table: 'dh_items',
          columns: 'id, name, code, building as building_code, floor, location as room',
          siteColumn: 'site',
          buildingCol: 'building',
          codeCol: 'code',
          hasCategory: true, // Flag pour recherche dans catégories
          label: 'Capteur/Monitoring'
        },
        infrastructure: {
          table: 'inf_items',
          columns: 'id, name, code, building as building_code, floor, location as room',
          siteColumn: null,
          buildingCol: 'building',
          codeCol: 'code',
          label: 'Infrastructure'
        },
        doors: {
          table: 'fd_doors',
          columns: 'id, name, building as building_code, floor, location as room',
          siteColumn: null,
          siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id',
          siteCondition: "s.name = $1",
          buildingCol: 'building',
          codeCol: null,
          label: 'Porte coupe-feu'
        }
      };

      // Si pas de type spécifié et qu'on a un nom, chercher dans TOUS les types
      if (!equipment_type && name) {
        try {
          const allResults = [];
          const searchTerms = name.toLowerCase().split(/\s+/).filter(t => t.length > 2);

          for (const [eqType, tableInfo] of Object.entries(tableMap)) {
            try {
              let query;
              let queryParams;

              // Recherche spéciale pour datahub avec catégories
              // NOTE: dh_items n'a PAS de colonne site - pas de filtre site
              if (tableInfo.hasCategory) {
                query = `
                  SELECT dh.id, dh.name, dh.code, dh.building as building_code, dh.floor, dh.location as room,
                         dhc.name as category_name, '${eqType}' as equipment_type
                  FROM dh_items dh
                  LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
                  WHERE (
                    LOWER(dh.name) LIKE $1
                    OR LOWER(dhc.name) LIKE $1
                    OR LOWER(COALESCE(dhc.name, '') || ' ' || dh.name) LIKE $1
                  )
                  LIMIT 5
                `;
                queryParams = [`%${name.toLowerCase()}%`];

                const result = await pool.query(query, queryParams);
                // Formater avec catégorie
                for (const row of result.rows) {
                  allResults.push({
                    ...row,
                    name: row.category_name ? `${row.category_name} - ${row.name}` : row.name,
                    equipment_type: eqType
                  });
                }

                // Recherche floue par mots si pas de résultat exact
                if (result.rows.length === 0 && searchTerms.length > 0) {
                  for (const term of searchTerms) {
                    const fuzzyQuery = `
                      SELECT dh.id, dh.name, dh.code, dh.building as building_code, dh.floor, dh.location as room,
                             dhc.name as category_name, '${eqType}' as equipment_type
                      FROM dh_items dh
                      LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
                      WHERE (LOWER(dh.name) LIKE $1 OR LOWER(dhc.name) LIKE $1)
                      LIMIT 3
                    `;
                    const fuzzyResult = await pool.query(fuzzyQuery, [`%${term}%`]);
                    for (const row of fuzzyResult.rows) {
                      if (!allResults.find(r => r.id === row.id)) {
                        allResults.push({
                          ...row,
                          name: row.category_name ? `${row.category_name} - ${row.name}` : row.name,
                          equipment_type: eqType
                        });
                      }
                    }
                  }
                }
                continue;
              }

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
            // Déterminer si tous les équipements sont du même type pour suggérer le transfert
            const equipmentTypes = [...new Set(allResults.map(r => r.equipment_type))];
            const singleType = equipmentTypes.length === 1 ? equipmentTypes[0] : null;

            // Mapping agent par type
            const agentMap = {
              vsd: { name: 'Shakira', type: 'vsd' },
              meca: { name: 'Titan', type: 'meca' },
              glo: { name: 'Lumina', type: 'glo' },
              hv: { name: 'Voltaire', type: 'hv' },
              mobile: { name: 'Nomad', type: 'mobile' },
              atex: { name: 'Phoenix', type: 'atex' },
              switchboard: { name: 'Matrix', type: 'switchboard' },
              doors: { name: 'Portal', type: 'doors' },
              datahub: { name: 'Nexus', type: 'datahub' },
              infrastructure: { name: 'Nexus', type: 'datahub' }
            };

            const result = {
              success: true,
              count: allResults.length,
              equipment_type: singleType || 'mixed',
              filters: { name },
              equipment: allResults.slice(0, limit),
              summary: `${allResults.length} équipement(s) trouvé(s) correspondant à "${name}".`
            };

            // Si un seul type trouvé, suggérer le transfert vers l'agent spécialisé
            if (singleType && agentMap[singleType]) {
              const agent = agentMap[singleType];
              result.suggest_transfer = true;
              result.suggested_agent = agent.type;
              result.suggested_agent_name = agent.name;
              result.transfer_message = `Cet équipement est de type **${singleType}**. Voulez-vous que je vous transfère à **${agent.name}** (l'agent spécialisé) pour plus de détails ?`;
            }

            return result;
          }

          // === RECHERCHE DE SUGGESTIONS si rien trouvé ===
          // Recherche floue par mots individuels
          const suggestions = [];
          for (const [eqType, tableInfo] of Object.entries(tableMap)) {
            try {
              // Recherche floue pour datahub avec catégories (pas de filtre site)
              if (tableInfo.hasCategory) {
                for (const term of searchTerms) {
                  const fuzzyQuery = `
                    SELECT dh.id, dh.name, dh.code, dh.building as building_code, dh.floor,
                           dhc.name as category_name, '${eqType}' as equipment_type
                    FROM dh_items dh
                    LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
                    WHERE (LOWER(dh.name) LIKE $1 OR LOWER(dhc.name) LIKE $1)
                    LIMIT 5
                  `;
                  const fuzzyResult = await pool.query(fuzzyQuery, [`%${term}%`]);
                  for (const row of fuzzyResult.rows) {
                    if (!suggestions.find(s => s.id === row.id)) {
                      suggestions.push({
                        ...row,
                        name: row.category_name ? `${row.category_name} - ${row.name}` : row.name,
                        equipment_type: eqType
                      });
                    }
                  }
                }
              } else {
                // Recherche floue standard pour autres types
                for (const term of searchTerms) {
                  let fuzzyQuery;
                  let fuzzyParams;

                  if (tableInfo.siteColumn) {
                    fuzzyQuery = `
                      SELECT ${tableInfo.columns}, '${eqType}' as equipment_type
                      FROM ${tableInfo.table}
                      WHERE ${tableInfo.siteColumn} = $1 AND LOWER(name) LIKE $2
                      LIMIT 3
                    `;
                    fuzzyParams = [site, `%${term}%`];
                  } else if (tableInfo.siteJoin) {
                    fuzzyQuery = `
                      SELECT ${tableInfo.columns}, '${eqType}' as equipment_type
                      FROM ${tableInfo.table} e
                      ${tableInfo.siteJoin.replace('{table}', 'e')}
                      WHERE ${tableInfo.siteCondition} AND LOWER(e.name) LIKE $2
                      LIMIT 3
                    `;
                    fuzzyParams = [site, `%${term}%`];
                  } else {
                    fuzzyQuery = `
                      SELECT ${tableInfo.columns}, '${eqType}' as equipment_type
                      FROM ${tableInfo.table}
                      WHERE LOWER(name) LIKE $1
                      LIMIT 3
                    `;
                    fuzzyParams = [`%${term}%`];
                  }

                  const fuzzyResult = await pool.query(fuzzyQuery, fuzzyParams);
                  for (const row of fuzzyResult.rows) {
                    if (!suggestions.find(s => s.id === row.id)) {
                      suggestions.push({ ...row, equipment_type: eqType });
                    }
                  }
                }
              }
            } catch (e) {
              // Skip errors
            }
          }

          // Retourner avec suggestions si on en a trouvé
          if (suggestions.length > 0) {
            return {
              success: true,
              count: 0,
              equipment_type: 'all',
              filters: { name },
              equipment: [],
              suggestions: suggestions.slice(0, 10),
              has_suggestions: true,
              summary: `Aucun équipement ne correspond exactement à "${name}", mais voici des équipements similaires.`,
              message: `Je n'ai pas trouvé "${name}" exactement. Voici des suggestions basées sur les mots-clés "${searchTerms.join('", "')}":`,
              suggestion_list: suggestions.slice(0, 10).map(s => `• ${s.name} (${s.equipment_type}${s.building_code ? ` - Bât. ${s.building_code}` : ''})`).join('\n')
            };
          }

          // Vraiment rien trouvé
          return {
            success: true,
            count: 0,
            equipment_type: 'all',
            filters: { name },
            equipment: [],
            summary: `Aucun équipement trouvé pour "${name}". Essayez avec un autre nom ou vérifiez l'orthographe.`
          };
        } catch (error) {
          console.error('[TOOL] search_equipment (all types) error:', error.message);
        }
      }

      const tableInfo = tableMap[equipment_type] || tableMap.switchboard;
      const actualType = equipment_type || 'switchboard';

      // Gestion spéciale pour datahub avec catégories
      // NOTE: dh_items n'a PAS de colonne site - pas de filtre site
      if (tableInfo.hasCategory) {
        try {
          let datahubQuery = `
            SELECT dh.id, dh.name, dh.code, dh.building as building_code, dh.floor, dh.location as room,
                   dhc.name as category_name, 'datahub' as equipment_type
            FROM dh_items dh
            LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
            WHERE 1=1
          `;
          let datahubParams = [];
          let paramIdx = 1;

          if (building) {
            datahubQuery += ` AND UPPER(dh.building) = $${paramIdx}`;
            datahubParams.push(building.toUpperCase());
            paramIdx++;
          }
          if (floor) {
            datahubQuery += ` AND UPPER(dh.floor) = $${paramIdx}`;
            datahubParams.push(floor.toUpperCase());
            paramIdx++;
          }
          if (name) {
            datahubQuery += ` AND (LOWER(dh.name) LIKE $${paramIdx} OR LOWER(dhc.name) LIKE $${paramIdx} OR LOWER(COALESCE(dhc.name, '') || ' ' || dh.name) LIKE $${paramIdx})`;
            datahubParams.push(`%${name.toLowerCase()}%`);
            paramIdx++;
          }
          if (code) {
            datahubQuery += ` AND LOWER(dh.code) LIKE $${paramIdx}`;
            datahubParams.push(`%${code.toLowerCase()}%`);
            paramIdx++;
          }

          datahubQuery += ` ORDER BY dh.building, dh.floor, dh.name LIMIT ${Math.min(parseInt(limit) || 20, 50)}`;

          const result = await pool.query(datahubQuery, datahubParams);

          const response = {
            success: true,
            count: result.rows.length,
            equipment_type: 'datahub',
            filters: { building, floor, name, code },
            equipment: result.rows.map(eq => ({
              id: eq.id,
              name: eq.category_name ? `${eq.category_name} - ${eq.name}` : eq.name,
              original_name: eq.name,
              category: eq.category_name,
              code: eq.code,
              building_code: eq.building_code,
              floor: eq.floor,
              room: eq.room,
              equipment_type: 'datahub'
            })),
            summary: result.rows.length === 0
              ? `Aucun équipement datahub trouvé avec ces critères.`
              : `${result.rows.length} équipement(s) datahub trouvé(s).`
          };

          // Suggérer le transfert vers Nexus pour datahub
          if (result.rows.length > 0) {
            response.suggest_transfer = true;
            response.suggested_agent = 'datahub';
            response.suggested_agent_name = 'Nexus';
            response.transfer_message = `Cet équipement est de type **datahub**. Voulez-vous que je vous transfère à **Nexus** (l'agent spécialisé capteurs/monitoring) pour plus de détails ?`;
          }

          return response;
        } catch (error) {
          console.error('[TOOL] search_equipment (datahub) error:', error.message);
          return { success: false, error: error.message, equipment: [] };
        }
      }

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

        // ========== SUGGESTIONS SI AUCUN RÉSULTAT ==========
        // Si aucun résultat, chercher des suggestions dans le même type d'équipement
        if (result.rows.length === 0 && name) {
          try {
            const searchName = name.toLowerCase();
            // Préparer les termes de recherche (mots individuels + chiffres)
            const searchTerms = searchName.split(/[\s.\-_]+/).filter(t => t.length >= 1);

            let suggestQuery;
            let suggestParams = [];

            // Construire une requête de suggestions avec OR pour chaque terme
            if (tableInfo.siteJoin) {
              suggestQuery = `
                SELECT ${tableInfo.columns}, '${actualType}' as equipment_type
                FROM ${tableInfo.table} e
                ${tableInfo.siteJoin.replace('{table}', 'e')}
                WHERE ${tableInfo.siteCondition}
                  AND (
                    ${searchTerms.map((_, i) => `LOWER(e.name) LIKE $${i + 2}`).join(' OR ')}
                    ${tableInfo.codeCol ? `OR ${searchTerms.map((_, i) => `LOWER(e.${tableInfo.codeCol}) LIKE $${i + 2}`).join(' OR ')}` : ''}
                  )
                ORDER BY e.name
                LIMIT 10
              `;
              suggestParams = [site, ...searchTerms.map(t => `%${t}%`)];
            } else if (tableInfo.siteColumn) {
              suggestQuery = `
                SELECT ${tableInfo.columns}, '${actualType}' as equipment_type
                FROM ${tableInfo.table}
                WHERE ${tableInfo.siteColumn} = $1
                  AND (
                    ${searchTerms.map((_, i) => `LOWER(name) LIKE $${i + 2}`).join(' OR ')}
                    ${tableInfo.codeCol ? `OR ${searchTerms.map((_, i) => `LOWER(${tableInfo.codeCol}) LIKE $${i + 2}`).join(' OR ')}` : ''}
                  )
                ORDER BY name
                LIMIT 10
              `;
              suggestParams = [site, ...searchTerms.map(t => `%${t}%`)];
            } else {
              suggestQuery = `
                SELECT ${tableInfo.columns}, '${actualType}' as equipment_type
                FROM ${tableInfo.table}
                WHERE (
                  ${searchTerms.map((_, i) => `LOWER(name) LIKE $${i + 1}`).join(' OR ')}
                  ${tableInfo.codeCol ? `OR ${searchTerms.map((_, i) => `LOWER(${tableInfo.codeCol}) LIKE $${i + 1}`).join(' OR ')}` : ''}
                )
                ORDER BY name
                LIMIT 10
              `;
              suggestParams = searchTerms.map(t => `%${t}%`);
            }

            const suggestResult = await pool.query(suggestQuery, suggestParams);

            if (suggestResult.rows.length > 0) {
              return {
                success: true,
                count: 0,
                equipment_type: actualType,
                filters: { building, floor, name, code },
                equipment: [],
                suggestions: suggestResult.rows.map(eq => ({
                  id: eq.id,
                  name: eq.name,
                  code: eq.code,
                  building_code: eq.building_code,
                  floor: eq.floor,
                  room: eq.room,
                  equipment_type: actualType
                })),
                has_suggestions: true,
                summary: `Aucun équipement ne correspond exactement à "${name}", mais voici des équipements ${tableInfo.label} similaires.`,
                message: `Je n'ai pas trouvé "${name}" exactement. Voici des suggestions basées sur les mots-clés "${searchTerms.join('", "')}":`,
                suggestion_list: suggestResult.rows.slice(0, 10).map(s => `• ${s.name}${s.code ? ` (${s.code})` : ''}${s.building_code ? ` - Bât. ${s.building_code}` : ''}`).join('\n')
              };
            }
          } catch (suggestError) {
            console.error('[TOOL] search_equipment suggestions error:', suggestError.message);
          }
        }

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
        datahub: 'dh_items',
        infrastructure: 'inf_items'
      };

      const table = tableMap[equipment_type] || 'switchboards';

      try {
        let result;

        // Gestion spéciale pour datahub avec catégorie
        if (equipment_type === 'datahub') {
          result = await pool.query(`
            SELECT dh.*, dhc.name as category_name
            FROM dh_items dh
            LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
            WHERE dh.id = $1
          `, [equipment_id]);
        } else {
          result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [equipment_id]);
        }

        if (result.rows.length === 0) {
          return { success: false, error: 'Équipement non trouvé' };
        }

        const equipment = result.rows[0];

        // Formater le nom avec la catégorie pour datahub
        if (equipment_type === 'datahub' && equipment.category_name) {
          equipment.display_name = `${equipment.category_name} - ${equipment.name}`;
        }

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
    // CONTRÔLES (Switchboard Controls + Fire Door Checks)
    // NOTE: Gère les contrôles de tableaux (scheduled_controls) ET portes (fd_checks)
    // -----------------------------------------------------------------------
    get_controls: async (params) => {
      const { filter = 'overdue', equipment_type = 'all', building, equipment_id, equipment_name, limit = 20 } = params;

      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const maxLimit = Math.min(parseInt(limit) || 20, 50);

      // ===== PORTES COUPE-FEU (fd_checks) =====
      if (equipment_type === 'doors') {
        try {
          let doorQuery = '';
          const doorParams = [site];
          let paramIdx = 2;

          // Si on cherche le dernier contrôle ou l'historique
          if (filter === 'last' || filter === 'history') {
            doorQuery = `
              SELECT
                c.id as control_id,
                c.due_date,
                c.closed_at,
                c.status,
                c.result_counts,
                c.closed_by_name,
                c.closed_by_email,
                d.id as equipment_id,
                d.name as equipment_name,
                d.building,
                d.floor,
                d.location,
                'door' as equipment_type,
                CASE WHEN c.status = 'ok' THEN 'Conforme'
                     WHEN c.status = 'nc' THEN 'Non conforme'
                     ELSE 'En cours' END as status_label
              FROM fd_checks c
              JOIN fd_doors d ON c.door_id = d.id
              WHERE d.site = $1 AND c.closed_at IS NOT NULL
            `;

            // Filtrer par equipment_id si spécifié
            if (equipment_id) {
              doorQuery += ` AND d.id = $${paramIdx}`;
              doorParams.push(equipment_id);
              paramIdx++;
            }

            // Filtrer par nom si spécifié
            if (equipment_name) {
              doorQuery += ` AND LOWER(d.name) LIKE $${paramIdx}`;
              doorParams.push(`%${equipment_name.toLowerCase()}%`);
              paramIdx++;
            }

            // Filtrer par bâtiment
            if (building) {
              doorQuery += ` AND UPPER(d.building) = $${paramIdx}`;
              doorParams.push(building.toUpperCase());
              paramIdx++;
            }

            doorQuery += ` ORDER BY c.closed_at DESC`;

            if (filter === 'last') {
              // Pour "last", on veut le dernier contrôle par porte
              doorQuery = `
                SELECT DISTINCT ON (d.id)
                  c.id as control_id,
                  c.due_date,
                  c.closed_at,
                  c.status,
                  c.result_counts,
                  c.closed_by_name,
                  c.closed_by_email,
                  d.id as equipment_id,
                  d.name as equipment_name,
                  d.building,
                  d.floor,
                  d.location,
                  'door' as equipment_type,
                  CASE WHEN c.status = 'ok' THEN 'Conforme'
                       WHEN c.status = 'nc' THEN 'Non conforme'
                       ELSE 'En cours' END as status_label
                FROM fd_checks c
                JOIN fd_doors d ON c.door_id = d.id
                WHERE d.site = $1 AND c.closed_at IS NOT NULL
                ${equipment_id ? `AND d.id = $${paramIdx - (equipment_name ? 2 : 1) - (building ? 1 : 0)}` : ''}
                ${equipment_name ? `AND LOWER(d.name) LIKE $${paramIdx - (building ? 1 : 0) - 1}` : ''}
                ${building ? `AND UPPER(d.building) = $${paramIdx - 1}` : ''}
                ORDER BY d.id, c.closed_at DESC
              `;
            }

            doorQuery += ` LIMIT ${maxLimit}`;
          } else {
            // Contrôles planifiés (pending)
            let dateCondition = '';
            switch (filter) {
              case 'overdue':
                dateCondition = `AND c.due_date < '${today}'`;
                break;
              case 'today':
                dateCondition = `AND c.due_date = '${today}'`;
                break;
              case 'this_week':
                const weekEnd = new Date(now);
                weekEnd.setDate(weekEnd.getDate() + 7);
                dateCondition = `AND c.due_date BETWEEN '${today}' AND '${weekEnd.toISOString().split('T')[0]}'`;
                break;
              case 'this_month':
              case 'next_30_days':
                const thirtyDays = new Date(now);
                thirtyDays.setDate(thirtyDays.getDate() + 30);
                dateCondition = `AND c.due_date BETWEEN '${today}' AND '${thirtyDays.toISOString().split('T')[0]}'`;
                break;
              default:
                dateCondition = '';
            }

            doorQuery = `
              SELECT
                c.id as control_id,
                c.due_date,
                c.started_at,
                d.id as equipment_id,
                d.name as equipment_name,
                d.building,
                d.floor,
                d.location,
                'door' as equipment_type,
                CASE
                  WHEN c.due_date < CURRENT_DATE THEN
                    EXTRACT(DAY FROM CURRENT_DATE - c.due_date)::int
                  ELSE 0
                END as days_overdue,
                CASE WHEN c.started_at IS NOT NULL THEN 'En cours' ELSE 'Planifié' END as status_label
              FROM fd_checks c
              JOIN fd_doors d ON c.door_id = d.id
              WHERE d.site = $1 AND c.closed_at IS NULL
              ${dateCondition}
            `;

            if (equipment_id) {
              doorQuery += ` AND d.id = $${paramIdx}`;
              doorParams.push(equipment_id);
              paramIdx++;
            }

            if (equipment_name) {
              doorQuery += ` AND LOWER(d.name) LIKE $${paramIdx}`;
              doorParams.push(`%${equipment_name.toLowerCase()}%`);
              paramIdx++;
            }

            if (building) {
              doorQuery += ` AND UPPER(d.building) = $${paramIdx}`;
              doorParams.push(building.toUpperCase());
              paramIdx++;
            }

            doorQuery += ` ORDER BY c.due_date ASC LIMIT ${maxLimit}`;
          }

          const result = await pool.query(doorQuery, doorParams);

          const overdueCount = result.rows.filter(r => r.days_overdue > 0).length;

          return {
            success: true,
            filter,
            equipment_type: 'doors',
            count: result.rows.length,
            overdue_count: overdueCount,
            building_filter: building || 'all',
            controls: result.rows.map(c => ({
              control_id: c.control_id,
              due_date: c.due_date,
              closed_at: c.closed_at,
              status: c.status,
              status_label: c.status_label,
              result_counts: c.result_counts,
              closed_by: c.closed_by_name || c.closed_by_email,
              equipment_id: c.equipment_id,
              equipment_name: c.equipment_name,
              building: c.building,
              floor: c.floor,
              location: c.location,
              equipment_type: 'door',
              days_overdue: c.days_overdue || 0
            })),
            summary: result.rows.length === 0
              ? `Aucun contrôle ${filter === 'last' ? 'effectué' : filter === 'history' ? 'dans l\'historique' : filter === 'overdue' ? 'en retard' : 'prévu'} pour les portes coupe-feu${equipment_name ? ` "${equipment_name}"` : ''}${building ? ` du bâtiment ${building}` : ''}.`
              : `${result.rows.length} contrôle(s) ${filter === 'last' ? 'dernier(s)' : filter === 'history' ? 'dans l\'historique' : filter === 'overdue' ? 'en retard' : 'prévu(s)'} pour les portes coupe-feu${overdueCount > 0 ? ` (${overdueCount} en retard)` : ''}.`
          };
        } catch (error) {
          console.error('[TOOL] get_controls (doors) error:', error.message);
          return { success: false, error: error.message, controls: [] };
        }
      }

      // ===== TABLEAUX ÉLECTRIQUES (scheduled_controls) =====
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
        case 'last':
        case 'history':
          // Pour switchboards, pas d'historique dans scheduled_controls (c'est dans control_records)
          dateCondition = '';
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
      if (equipment_id && (equipment_type === 'switchboard' || equipment_type === 'all')) {
        query += ` AND s.id = $${paramIndex}`;
        queryParams.push(equipment_id);
        paramIndex++;
      }

      // Si un nom d'équipement est spécifié
      if (equipment_name) {
        query += ` AND (LOWER(s.name) LIKE $${paramIndex} OR LOWER(s.code) LIKE $${paramIndex})`;
        queryParams.push(`%${equipment_name.toLowerCase()}%`);
        paramIndex++;
      }

      query += ` ORDER BY sc.next_control_date ASC LIMIT ${maxLimit}`;

      try {
        const result = await pool.query(query, queryParams);

        // Calculer des stats
        const overdueCount = result.rows.filter(r => r.days_overdue > 0).length;
        const upcomingCount = result.rows.filter(r => r.days_overdue === 0).length;

        // Message adapté selon le contexte
        let contextNote = '';
        if (equipment_type && equipment_type !== 'switchboard' && equipment_type !== 'all' && equipment_type !== 'doors') {
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
      const { building, floor, equipment_ids, equipment_name, equipment_type } = params;

      // Table mapping for all equipment types
      const tableMap = {
        switchboard: { table: 'switchboards', cols: 'id, name, code, building_code, floor, room', nameCol: 'name', codeCol: 'code', siteCol: 'site' },
        vsd: { table: 'vsd_equipments', cols: 'id, name, building as building_code, floor, location as room', nameCol: 'name', codeCol: null, siteCol: 'site' },
        meca: { table: 'meca_equipments', cols: 'id, name, building as building_code, floor, location as room', nameCol: 'name', codeCol: null, siteCol: null },
        mobile: { table: 'me_equipments', cols: 'id, name, code, building as building_code, floor, location as room', nameCol: 'name', codeCol: 'code', siteCol: null },
        hv: { table: 'hv_equipments', cols: 'id, name, code, building_code, floor, room', nameCol: 'name', codeCol: 'code', siteCol: null },
        glo: { table: 'glo_equipments', cols: 'id, name, tag as code, building as building_code, floor, location as room', nameCol: 'name', codeCol: 'tag', siteCol: null },
        atex: { table: 'atex_equipments', cols: 'id, name, tag as code, building as building_code, floor, location as room', nameCol: 'name', codeCol: 'tag', siteCol: null },
        datahub: { table: 'dh_items', cols: 'id, name, code, building as building_code, floor, location as room', nameCol: 'name', codeCol: 'code', siteCol: null },
        infrastructure: { table: 'inf_items', cols: 'id, name, code, building as building_code, floor, location as room', nameCol: 'name', codeCol: 'code', siteCol: null },
        doors: { table: 'door_items', cols: 'id, name, code, building as building_code, floor, location as room', nameCol: 'name', codeCol: 'code', siteCol: null },
        firecontrol: { table: 'fc_items', cols: 'id, name, code, building as building_code, floor, location as room', nameCol: 'name', codeCol: 'code', siteCol: null }
      };

      // Ce handler retourne des instructions pour le frontend
      let equipmentToShow = [];
      let detectedType = equipment_type || 'switchboard';

      // Case 1: Search by equipment name (NEW - priority for user requests like "show X on map")
      if (equipment_name && (!equipment_ids || equipment_ids.length === 0)) {
        console.log('[TOOL] show_map: Searching by name:', equipment_name);
        const searchTerm = equipment_name.toLowerCase().trim();

        // If type is specified, search only that type
        const typesToSearch = equipment_type ? [equipment_type] : Object.keys(tableMap);

        for (const eqType of typesToSearch) {
          const info = tableMap[eqType];
          if (!info) continue;

          try {
            // Special handling for datahub - search in categories too AND join with dh_positions for map data
            if (eqType === 'datahub') {
              // For datahub, search in item name, category name, and combined "Category - Name"
              // Also handle case where user searches with "Category - Name" format
              const searchParts = searchTerm.split(' - ');
              const categorySearch = searchParts.length > 1 ? searchParts[0] : searchTerm;
              const nameSearch = searchParts.length > 1 ? searchParts[1] : searchTerm;

              // IMPORTANT: Join with dh_positions to get actual map position (logical_name, x_frac, y_frac)
              const datahubQuery = `
                SELECT dh.id, dh.name, dh.code, dh.building as building_code, dh.floor, dh.location as room,
                       dhc.name as category_name, 'datahub' as equipment_type,
                       dhp.logical_name as plan_name, dhp.page_index, dhp.x_frac, dhp.y_frac,
                       dhp.id as position_id
                FROM dh_items dh
                LEFT JOIN dh_categories dhc ON dh.category_id = dhc.id
                LEFT JOIN dh_positions dhp ON dhp.item_id = dh.id
                WHERE (
                  LOWER(dh.name) LIKE $1
                  OR LOWER(dhc.name) LIKE $1
                  OR LOWER(COALESCE(dhc.name, '') || ' - ' || dh.name) LIKE $1
                  ${searchParts.length > 1 ? `OR (LOWER(dhc.name) LIKE $2 AND LOWER(dh.name) LIKE $3)` : ''}
                  OR (dh.code IS NOT NULL AND LOWER(dh.code) LIKE $1)
                )
                LIMIT 5
              `;
              const datahubParams = searchParts.length > 1
                ? [`%${searchTerm}%`, `%${categorySearch}%`, `%${nameSearch}%`]
                : [`%${searchTerm}%`];

              const result = await pool.query(datahubQuery, datahubParams);
              if (result.rows.length > 0) {
                // Format with category name and position info
                const formattedRows = result.rows.map(row => ({
                  ...row,
                  name: row.category_name ? `${row.category_name} - ${row.name}` : row.name,
                  original_name: row.name,
                  // Add position data for frontend
                  has_map_position: !!row.plan_name,
                  map_position: row.plan_name ? {
                    plan_name: row.plan_name,
                    page_index: row.page_index,
                    x_frac: row.x_frac,
                    y_frac: row.y_frac
                  } : null
                }));
                equipmentToShow.push(...formattedRows);
                if (equipmentToShow.length === formattedRows.length) {
                  detectedType = eqType;
                }
              }
              continue;
            }

            // Build search query - search by name and code
            let query = `SELECT ${info.cols}, '${eqType}' as equipment_type FROM ${info.table} WHERE (`;
            const conditions = [];
            const queryParams = [];
            let paramIndex = 1;

            // Search by name (always available)
            conditions.push(`LOWER(${info.nameCol}) LIKE $${paramIndex}`);
            queryParams.push(`%${searchTerm}%`);
            paramIndex++;

            // Search by code if available
            if (info.codeCol) {
              conditions.push(`LOWER(${info.codeCol}) LIKE $${paramIndex}`);
              queryParams.push(`%${searchTerm}%`);
              paramIndex++;
            }

            query += conditions.join(' OR ') + ')';

            // Add site filter if available
            if (info.siteCol) {
              query += ` AND ${info.siteCol} = $${paramIndex}`;
              queryParams.push(site);
              paramIndex++;
            }

            query += ' LIMIT 5';

            const result = await pool.query(query, queryParams);
            if (result.rows.length > 0) {
              equipmentToShow.push(...result.rows);
              // Use the first found equipment's type
              if (equipmentToShow.length === result.rows.length) {
                detectedType = eqType;
              }
            }
          } catch (e) {
            console.error(`[TOOL] show_map search ${eqType} error:`, e.message);
          }

          // Stop searching if we found enough
          if (equipmentToShow.length >= 5) break;
        }

        console.log('[TOOL] show_map: Found', equipmentToShow.length, 'equipment(s) for name search');
      }

      // Case 2: Search by equipment IDs
      if (equipmentToShow.length === 0 && equipment_ids && equipment_ids.length > 0) {
        const info = tableMap[detectedType] || tableMap.switchboard;

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
      }

      // Case 3: Search by building (fallback)
      if (equipmentToShow.length === 0 && building) {
        try {
          let query = `
            SELECT id, name, code, building_code, floor, room
            FROM switchboards
            WHERE site = $1 AND UPPER(building_code) = $2
          `;
          const queryParams = [site, building.toUpperCase()];

          if (floor) {
            query += ` AND UPPER(floor) = $3`;
            queryParams.push(floor.toUpperCase());
          }

          query += ` ORDER BY floor, name LIMIT 20`;

          const result = await pool.query(query, queryParams);
          equipmentToShow = result.rows;
          detectedType = 'switchboard';
        } catch (e) {
          console.error('[TOOL] show_map building query error:', e.message);
        }
      }

      // Build response with proper frontend instructions
      const foundEquipment = equipmentToShow[0] || null;

      // Vérifier si l'équipement a une position définie
      // Pour datahub, vérifier has_map_position (position sur plan) en priorité
      const hasMapPosition = foundEquipment?.has_map_position || foundEquipment?.map_position;
      const hasBuildingPosition = foundEquipment &&
        (foundEquipment.building_code || foundEquipment.floor || foundEquipment.room);
      const hasPosition = hasMapPosition || hasBuildingPosition;

      let summary;
      if (foundEquipment) {
        if (hasMapPosition) {
          const mapPos = foundEquipment.map_position;
          summary = `📍 Affichage de **${foundEquipment.name || foundEquipment.code}** sur le plan "${mapPos.plan_name}".`;
        } else if (hasBuildingPosition) {
          summary = `📍 Affichage de **${foundEquipment.name || foundEquipment.code}** sur la carte (Bât. ${foundEquipment.building_code || '?'}, ${foundEquipment.floor || '?'}).`;
        } else {
          summary = `⚠️ **${foundEquipment.name || foundEquipment.code}** trouvé, mais cet équipement n'a pas de position définie sur les plans. Contactez l'administrateur pour ajouter sa localisation.`;
        }
      } else {
        summary = equipment_name
          ? `Aucun équipement trouvé pour "${equipment_name}".`
          : 'Aucun équipement trouvé.';
      }

      // Build frontend instruction with datahub map position if available
      const frontendInstruction = {
        showMap: equipmentToShow.length > 0,
        building: foundEquipment?.building_code || building,
        floor: foundEquipment?.floor || floor,
        locationEquipment: foundEquipment,
        locationEquipmentType: foundEquipment?.equipment_type || detectedType,
        equipmentList: equipmentToShow
      };

      // Pour datahub, ajouter les infos de position sur plan
      if (foundEquipment?.map_position) {
        frontendInstruction.datahubPosition = foundEquipment.map_position;
        frontendInstruction.navigateToPlan = foundEquipment.map_position.plan_name;
        frontendInstruction.highlightItem = foundEquipment.id;
      }

      return {
        success: equipmentToShow.length > 0,
        action: 'show_map',
        count: equipmentToShow.length,
        equipment: equipmentToShow.slice(0, 5),
        has_position: hasPosition,
        has_map_position: !!hasMapPosition,
        position_warning: !hasPosition && foundEquipment ? 'Equipment found but has no position data in database' : null,
        summary,
        frontend_instruction: frontendInstruction
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
          glo: 'glo',
          infrastructure: 'infrastructure'
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
        door: { agent: 'doors', route: '/app/doors' },
        infrastructure: { agent: 'infrastructure', route: '/app/infrastructure' }
      };

      const agentInfo = agentMap[equipment_type] || agentMap.switchboard;
      const targetRoute = `${agentInfo.route}${equipment_id ? `?id=${equipment_id}&openChat=true` : ''}`;

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
        message: `Je te transfère vers l'agent ${agentInfo.agent.toUpperCase()} pour l'équipement "${equipment_name || 'cet équipement'}". ${context || ''}`,
        // Navigation mode for frontend (uses existing navigation handler)
        navigationMode: true,
        navigateTo: targetRoute,
        // Legacy ui_action for compatibility
        ui_action: {
          type: 'navigate_to_equipment',
          route: targetRoute,
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
            datahub: 'dh_items',
            infrastructure: 'inf_items'
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
          door: { agent: 'doors', route: '/app/doors' },
          infrastructure: { agent: 'infrastructure', route: '/app/infrastructure' }
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
          firecontrol: 'Blaze',
          infrastructure: 'Atlas'
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
          firecontrol: 'Expert sécurité incendie',
          infrastructure: 'Expert infrastructure et bâtiments'
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
          firecontrol: '/app/fire-control',
          infrastructure: '/app/infrastructure'
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
    },

    // -----------------------------------------------------------------------
    // COMPARAISON D'ÉQUIPEMENTS
    // -----------------------------------------------------------------------
    compare_equipment: async (params) => {
      const { equipment_1_name, equipment_2_name, period_days = 90 } = params;

      try {
        // Fonction pour récupérer les stats d'un équipement
        const getEquipmentStats = async (equipmentName) => {
          const failures = await pool.query(`
            SELECT COUNT(*) as failure_count,
                   SUM(duration_minutes) as total_downtime,
                   MAX(started_at) as last_failure
            FROM troubleshooting_records
            WHERE site = $1
              AND LOWER(equipment_name) LIKE $2
              AND started_at >= NOW() - INTERVAL '${parseInt(period_days)} days'
          `, [site, `%${equipmentName.toLowerCase()}%`]);

          return {
            name: equipmentName,
            failure_count: parseInt(failures.rows[0]?.failure_count || 0),
            total_downtime: parseInt(failures.rows[0]?.total_downtime || 0),
            last_failure: failures.rows[0]?.last_failure
          };
        };

        const [eq1Stats, eq2Stats] = await Promise.all([
          getEquipmentStats(equipment_1_name),
          getEquipmentStats(equipment_2_name)
        ]);

        // Déterminer le meilleur
        const eq1Score = eq1Stats.failure_count * 10 + eq1Stats.total_downtime;
        const eq2Score = eq2Stats.failure_count * 10 + eq2Stats.total_downtime;
        const better = eq1Score <= eq2Score ? equipment_1_name : equipment_2_name;

        return {
          success: true,
          period_days,
          equipment_1: eq1Stats,
          equipment_2: eq2Stats,
          better_reliability: better,
          comparison: {
            failure_difference: Math.abs(eq1Stats.failure_count - eq2Stats.failure_count),
            downtime_difference: Math.abs(eq1Stats.total_downtime - eq2Stats.total_downtime)
          },
          summary: `Comparaison sur ${period_days} jours: ${eq1Stats.name} (${eq1Stats.failure_count} pannes) vs ${eq2Stats.name} (${eq2Stats.failure_count} pannes). ${better} est plus fiable.`
        };
      } catch (error) {
        console.error('[TOOL] compare_equipment error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // PRÉDICTION DE PANNE
    // -----------------------------------------------------------------------
    predict_equipment_failure: async (params) => {
      const { equipment_name, equipment_type } = params;

      try {
        // Récupérer l'historique des pannes
        const history = await pool.query(`
          SELECT COUNT(*) as total_failures,
                 AVG(duration_minutes) as avg_downtime,
                 MAX(started_at) as last_failure,
                 MIN(started_at) as first_failure
          FROM troubleshooting_records
          WHERE site = $1
            AND LOWER(equipment_name) LIKE $2
        `, [site, `%${equipment_name.toLowerCase()}%`]);

        const stats = history.rows[0];
        const totalFailures = parseInt(stats.total_failures || 0);

        // Calcul du risque basé sur l'historique
        let riskLevel = 'low';
        let riskScore = 0;
        let prediction = 'Faible probabilité de panne à court terme';

        if (totalFailures === 0) {
          prediction = 'Aucune panne enregistrée - équipement fiable ou nouvellement installé';
        } else if (totalFailures >= 5) {
          riskLevel = 'high';
          riskScore = 80;
          prediction = 'Risque élevé - équipement avec historique de pannes fréquentes';
        } else if (totalFailures >= 3) {
          riskLevel = 'medium';
          riskScore = 50;
          prediction = 'Risque modéré - surveillance recommandée';
        } else {
          riskScore = 20;
          prediction = 'Risque faible - quelques incidents isolés';
        }

        // Calcul du MTBF estimé
        let mtbfDays = null;
        if (stats.first_failure && stats.last_failure && totalFailures > 1) {
          const daysBetween = Math.floor(
            (new Date(stats.last_failure) - new Date(stats.first_failure)) / (1000 * 60 * 60 * 24)
          );
          mtbfDays = Math.round(daysBetween / (totalFailures - 1));
        }

        return {
          success: true,
          equipment_name,
          equipment_type: equipment_type || 'unknown',
          risk_level: riskLevel,
          risk_score: riskScore,
          prediction,
          statistics: {
            total_failures: totalFailures,
            avg_downtime_minutes: Math.round(parseFloat(stats.avg_downtime || 0)),
            mtbf_days: mtbfDays,
            last_failure: stats.last_failure
          },
          recommendations: riskLevel === 'high'
            ? ['Planifier une maintenance préventive', 'Vérifier les pièces d\'usure', 'Envisager un remplacement']
            : riskLevel === 'medium'
            ? ['Surveillance renforcée', 'Contrôle visuel régulier']
            : ['Maintenir le plan de maintenance actuel']
        };
      } catch (error) {
        console.error('[TOOL] predict_equipment_failure error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // HISTORIQUE COMPLET D'UN ÉQUIPEMENT
    // -----------------------------------------------------------------------
    get_equipment_history: async (params) => {
      const {
        equipment_name,
        equipment_type,
        include_controls = true,
        include_nc = true,
        include_troubleshooting = true
      } = params;

      try {
        const results = {
          equipment_name,
          troubleshooting: [],
          controls: [],
          non_conformities: []
        };

        // Dépannages
        if (include_troubleshooting) {
          const troubleshooting = await pool.query(`
            SELECT id, title, description, severity, status, started_at, completed_at,
                   solution, technician_name, duration_minutes
            FROM troubleshooting_records
            WHERE site = $1 AND LOWER(equipment_name) LIKE $2
            ORDER BY started_at DESC
            LIMIT 20
          `, [site, `%${equipment_name.toLowerCase()}%`]);
          results.troubleshooting = troubleshooting.rows;
        }

        // Contrôles (recherche dans switchboards par nom)
        if (include_controls) {
          const controls = await pool.query(`
            SELECT sc.id, sc.control_type, sc.result, sc.next_control_date,
                   sc.control_date, sc.comments, s.name as equipment_name
            FROM scheduled_controls sc
            JOIN switchboards s ON sc.switchboard_id = s.id
            WHERE s.site = $1 AND LOWER(s.name) LIKE $2
            ORDER BY sc.control_date DESC NULLS LAST
            LIMIT 10
          `, [site, `%${equipment_name.toLowerCase()}%`]);
          results.controls = controls.rows;
        }

        // Non-conformités
        if (include_nc) {
          const nc = await pool.query(`
            SELECT id, title, description, severity, status, created_at, resolved_at
            FROM non_conformities
            WHERE site = $1 AND LOWER(equipment_name) LIKE $2
            ORDER BY created_at DESC
            LIMIT 10
          `, [site, `%${equipment_name.toLowerCase()}%`]);
          results.non_conformities = nc.rows;
        }

        const totalEvents = results.troubleshooting.length +
                            results.controls.length +
                            results.non_conformities.length;

        return {
          success: true,
          ...results,
          total_events: totalEvents,
          summary: totalEvents === 0
            ? `Aucun historique trouvé pour "${equipment_name}"`
            : `${totalEvents} événements trouvés: ${results.troubleshooting.length} dépannages, ${results.controls.length} contrôles, ${results.non_conformities.length} NC`
        };
      } catch (error) {
        console.error('[TOOL] get_equipment_history error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // CHARGE DE TRAVAIL ÉQUIPE
    // -----------------------------------------------------------------------
    get_team_workload: async (params) => {
      const { period = 'this_week', include_overdue = true } = params;

      try {
        // Définir la période
        let dateFilter = '';
        switch (period) {
          case 'today':
            dateFilter = "sc.next_control_date = CURRENT_DATE";
            break;
          case 'this_week':
            dateFilter = "sc.next_control_date >= CURRENT_DATE AND sc.next_control_date <= CURRENT_DATE + INTERVAL '7 days'";
            break;
          case 'next_week':
            dateFilter = "sc.next_control_date >= CURRENT_DATE + INTERVAL '7 days' AND sc.next_control_date <= CURRENT_DATE + INTERVAL '14 days'";
            break;
          case 'this_month':
            dateFilter = "sc.next_control_date >= CURRENT_DATE AND sc.next_control_date <= CURRENT_DATE + INTERVAL '30 days'";
            break;
          default:
            dateFilter = "sc.next_control_date >= CURRENT_DATE AND sc.next_control_date <= CURRENT_DATE + INTERVAL '7 days'";
        }

        // Contrôles à venir
        const upcoming = await pool.query(`
          SELECT COUNT(*) as count
          FROM scheduled_controls sc
          JOIN switchboards s ON sc.switchboard_id = s.id
          WHERE s.site = $1 AND ${dateFilter}
        `, [site]);

        // Contrôles en retard
        let overdue = { rows: [{ count: 0 }] };
        if (include_overdue) {
          overdue = await pool.query(`
            SELECT COUNT(*) as count
            FROM scheduled_controls sc
            JOIN switchboards s ON sc.switchboard_id = s.id
            WHERE s.site = $1 AND sc.next_control_date < CURRENT_DATE
          `, [site]);
        }

        // Dépannages en cours
        const openTroubleshooting = await pool.query(`
          SELECT COUNT(*) as count
          FROM troubleshooting_records
          WHERE site = $1 AND status = 'in_progress'
        `, [site]);

        // NC ouvertes
        const openNC = await pool.query(`
          SELECT COUNT(*) as count
          FROM non_conformities
          WHERE site = $1 AND status = 'open'
        `, [site]);

        const totalWorkload = parseInt(upcoming.rows[0].count) +
                              parseInt(overdue.rows[0].count) +
                              parseInt(openTroubleshooting.rows[0].count) +
                              parseInt(openNC.rows[0].count);

        return {
          success: true,
          period,
          workload: {
            upcoming_controls: parseInt(upcoming.rows[0].count),
            overdue_controls: parseInt(overdue.rows[0].count),
            open_troubleshooting: parseInt(openTroubleshooting.rows[0].count),
            open_nc: parseInt(openNC.rows[0].count),
            total: totalWorkload
          },
          load_level: totalWorkload > 20 ? 'high' : totalWorkload > 10 ? 'medium' : 'normal',
          summary: `Charge de travail (${period}): ${totalWorkload} tâches (${parseInt(upcoming.rows[0].count)} contrôles prévus, ${parseInt(overdue.rows[0].count)} en retard)`
        };
      } catch (error) {
        console.error('[TOOL] get_team_workload error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // BRIEFING DU JOUR
    // -----------------------------------------------------------------------
    get_daily_briefing: async (params) => {
      const { include_yesterday = true, include_priorities = true } = params;

      try {
        const briefing = {
          date: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
          yesterday_events: null,
          today_tasks: null,
          priorities: null,
          alerts: []
        };

        // Événements d'hier
        if (include_yesterday) {
          const yesterday = await pool.query(`
            SELECT COUNT(*) as failures
            FROM troubleshooting_records
            WHERE site = $1 AND started_at >= CURRENT_DATE - INTERVAL '1 day' AND started_at < CURRENT_DATE
          `, [site]);

          const completedYesterday = await pool.query(`
            SELECT COUNT(*) as completed
            FROM troubleshooting_records
            WHERE site = $1 AND completed_at >= CURRENT_DATE - INTERVAL '1 day' AND completed_at < CURRENT_DATE
          `, [site]);

          briefing.yesterday_events = {
            new_failures: parseInt(yesterday.rows[0].failures),
            resolved: parseInt(completedYesterday.rows[0].completed)
          };
        }

        // Tâches du jour
        const todayControls = await pool.query(`
          SELECT COUNT(*) as count
          FROM scheduled_controls sc
          JOIN switchboards s ON sc.switchboard_id = s.id
          WHERE s.site = $1 AND sc.next_control_date = CURRENT_DATE
        `, [site]);

        const overdueControls = await pool.query(`
          SELECT COUNT(*) as count
          FROM scheduled_controls sc
          JOIN switchboards s ON sc.switchboard_id = s.id
          WHERE s.site = $1 AND sc.next_control_date < CURRENT_DATE
        `, [site]);

        briefing.today_tasks = {
          controls_due: parseInt(todayControls.rows[0].count),
          overdue: parseInt(overdueControls.rows[0].count)
        };

        // Alertes
        if (parseInt(overdueControls.rows[0].count) > 0) {
          briefing.alerts.push({
            level: 'warning',
            message: `${overdueControls.rows[0].count} contrôle(s) en retard à traiter`
          });
        }

        // Dépannages en cours
        const openIssues = await pool.query(`
          SELECT COUNT(*) as count
          FROM troubleshooting_records
          WHERE site = $1 AND status = 'in_progress'
        `, [site]);

        if (parseInt(openIssues.rows[0].count) > 0) {
          briefing.alerts.push({
            level: 'info',
            message: `${openIssues.rows[0].count} dépannage(s) en cours`
          });
        }

        // Priorités
        if (include_priorities) {
          const priorities = await pool.query(`
            SELECT s.name, s.building_code,
                   EXTRACT(DAY FROM CURRENT_DATE - sc.next_control_date)::int as days_overdue
            FROM scheduled_controls sc
            JOIN switchboards s ON sc.switchboard_id = s.id
            WHERE s.site = $1 AND sc.next_control_date < CURRENT_DATE
            ORDER BY days_overdue DESC
            LIMIT 5
          `, [site]);

          briefing.priorities = priorities.rows.map(p => ({
            equipment: p.name,
            building: p.building_code,
            days_overdue: p.days_overdue,
            urgency: p.days_overdue > 30 ? 'critical' : p.days_overdue > 14 ? 'high' : 'medium'
          }));
        }

        return {
          success: true,
          ...briefing,
          summary: `Bonjour ! ${briefing.today_tasks.controls_due} contrôle(s) prévu(s) aujourd'hui, ${briefing.today_tasks.overdue} en retard. ${briefing.alerts.length} alerte(s).`
        };
      } catch (error) {
        console.error('[TOOL] get_daily_briefing error:', error.message);
        return { success: false, error: error.message };
      }
    },

    // -----------------------------------------------------------------------
    // DASHBOARD ÉQUIPEMENTS POUR AGENT SPÉCIALISÉ
    // -----------------------------------------------------------------------
    get_my_equipment_dashboard: async (params) => {
      const {
        agent_type,
        include_equipment_list = true,
        include_controls = true,
        include_troubleshooting = true,
        include_communications = true
      } = params;

      if (!agent_type) {
        return {
          success: false,
          error: 'agent_type is required. Use your agent type (vsd, meca, glo, hv, mobile, atex, switchboard, doors, datahub, firecontrol).'
        };
      }

      try {
        const dashboard = {
          agent_type,
          site,
          generated_at: new Date().toISOString(),
          summary: {},
          equipment_list: [],
          controls: { overdue: [], upcoming: [] },
          troubleshooting: [],
          communications: { unread: [], recent: [] },
          snapshot: null
        };

        // Configuration des tables par type d'agent
        const tableConfig = {
          vsd: { table: 'vsd_equipments', nameCol: 'name', siteCol: 'site', controlType: 'vsd' },
          meca: { table: 'meca_equipments', nameCol: 'name', siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id', siteCondition: "s.name = $1", controlType: 'meca' },
          glo: { table: 'glo_equipments', nameCol: 'name', siteCol: null, controlType: 'glo' },
          hv: { table: 'hv_equipments', nameCol: 'name', siteCol: null, controlType: 'hv' },
          mobile: { table: 'me_equipments', nameCol: 'name', siteCol: null, controlType: 'mobile_equipment' },
          atex: { table: 'atex_equipments', nameCol: 'name', siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id', siteCondition: "s.name = $1", controlType: 'atex' },
          switchboard: { table: 'switchboards', nameCol: 'name', siteCol: 'site', controlType: 'switchboard' },
          doors: { table: 'fd_doors', nameCol: 'name', siteJoin: 'INNER JOIN sites s ON s.id = {table}.site_id', siteCondition: "s.name = $1", controlType: 'door' },
          datahub: { table: 'dh_items', nameCol: 'name', siteCol: null, controlType: null }, // No site column
          firecontrol: { table: 'fire_equipment', nameCol: 'name', siteCol: 'site', controlType: 'fire' }
        };

        const config = tableConfig[agent_type];
        if (!config) {
          return { success: false, error: `Unknown agent type: ${agent_type}` };
        }

        // 1. Récupérer les équipements
        if (include_equipment_list) {
          try {
            let equipQuery;
            let equipParams = [];

            if (config.siteJoin) {
              // Table avec join sur sites
              const joinClause = config.siteJoin.replace('{table}', 't');
              equipQuery = `
                SELECT t.id, t.${config.nameCol} as name, t.building, t.floor, t.location
                FROM ${config.table} t
                ${joinClause}
                WHERE ${config.siteCondition}
                ORDER BY t.${config.nameCol}
                LIMIT 50
              `;
              equipParams = [site];
            } else if (config.siteCol) {
              // Table avec colonne site directe
              equipQuery = `
                SELECT id, ${config.nameCol} as name, building, floor, location
                FROM ${config.table}
                WHERE ${config.siteCol} = $1
                ORDER BY ${config.nameCol}
                LIMIT 50
              `;
              equipParams = [site];
            } else {
              // Table sans filtre site (datahub, glo, hv, mobile)
              equipQuery = `
                SELECT id, ${config.nameCol} as name, building, floor, location
                FROM ${config.table}
                ORDER BY ${config.nameCol}
                LIMIT 50
              `;
            }

            const equipResult = await pool.query(equipQuery, equipParams);
            dashboard.equipment_list = equipResult.rows;
            dashboard.summary.total_equipment = equipResult.rows.length;
          } catch (e) {
            console.error(`[TOOL] get_my_equipment_dashboard - equipment list error:`, e.message);
            dashboard.summary.total_equipment = 0;
          }
        }

        // 2. Récupérer les contrôles
        if (include_controls && config.controlType) {
          try {
            // Contrôles en retard
            const overdueResult = await pool.query(`
              SELECT cs.id, cs.equipment_id, cs.equipment_type, cs.next_due_date, cs.frequency,
                     EXTRACT(DAY FROM CURRENT_DATE - cs.next_due_date)::int as days_overdue
              FROM control_schedules cs
              WHERE cs.site = $1
              AND cs.equipment_type = $2
              AND cs.next_due_date < CURRENT_DATE
              AND cs.is_active = true
              ORDER BY cs.next_due_date ASC
              LIMIT 20
            `, [site, config.controlType]);
            dashboard.controls.overdue = overdueResult.rows;

            // Contrôles à venir (7 jours)
            const upcomingResult = await pool.query(`
              SELECT cs.id, cs.equipment_id, cs.equipment_type, cs.next_due_date, cs.frequency
              FROM control_schedules cs
              WHERE cs.site = $1
              AND cs.equipment_type = $2
              AND cs.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
              AND cs.is_active = true
              ORDER BY cs.next_due_date ASC
              LIMIT 20
            `, [site, config.controlType]);
            dashboard.controls.upcoming = upcomingResult.rows;

            dashboard.summary.controls_overdue = overdueResult.rows.length;
            dashboard.summary.controls_upcoming = upcomingResult.rows.length;
          } catch (e) {
            console.error(`[TOOL] get_my_equipment_dashboard - controls error:`, e.message);
            dashboard.summary.controls_overdue = 0;
            dashboard.summary.controls_upcoming = 0;
          }
        }

        // 3. Récupérer les dépannages récents
        if (include_troubleshooting) {
          try {
            const troubleResult = await pool.query(`
              SELECT tr.id, tr.title, tr.equipment_name, tr.status, tr.severity,
                     tr.root_cause, tr.solution, tr.started_at, tr.completed_at
              FROM troubleshooting_records tr
              WHERE tr.site = $1
              AND tr.equipment_type = $2
              AND tr.started_at > NOW() - INTERVAL '30 days'
              ORDER BY tr.started_at DESC
              LIMIT 15
            `, [site, agent_type]);
            dashboard.troubleshooting = troubleResult.rows;

            const pending = troubleResult.rows.filter(t => t.status === 'pending' || t.status === 'in_progress');
            const resolved = troubleResult.rows.filter(t => t.status === 'resolved');
            dashboard.summary.troubleshooting_pending = pending.length;
            dashboard.summary.troubleshooting_resolved_30d = resolved.length;
          } catch (e) {
            console.error(`[TOOL] get_my_equipment_dashboard - troubleshooting error:`, e.message);
            dashboard.summary.troubleshooting_pending = 0;
            dashboard.summary.troubleshooting_resolved_30d = 0;
          }
        }

        // 4. Récupérer les communications inter-agents
        if (include_communications) {
          try {
            // Messages non lus
            const unreadResult = await pool.query(`
              SELECT id, from_agent, message_type, subject, content, context, created_at
              FROM agent_communications
              WHERE site = $1 AND to_agent = $2 AND read_at IS NULL
              ORDER BY created_at DESC
              LIMIT 10
            `, [site, agent_type]);
            dashboard.communications.unread = unreadResult.rows;

            // Messages récents (lus et non lus)
            const recentResult = await pool.query(`
              SELECT id, from_agent, to_agent, message_type, subject, created_at, read_at
              FROM agent_communications
              WHERE site = $1 AND (to_agent = $2 OR from_agent = $2)
              ORDER BY created_at DESC
              LIMIT 10
            `, [site, agent_type]);
            dashboard.communications.recent = recentResult.rows;

            dashboard.summary.unread_messages = unreadResult.rows.length;
          } catch (e) {
            console.error(`[TOOL] get_my_equipment_dashboard - communications error:`, e.message);
            dashboard.summary.unread_messages = 0;
          }
        }

        // 5. Récupérer le dernier snapshot avec AI insights
        try {
          const snapshotResult = await pool.query(`
            SELECT snapshot_date, health_score, ai_summary, ai_insights, ai_recommendations,
                   total_equipment, equipment_ok, equipment_warning, equipment_critical
            FROM agent_daily_snapshots
            WHERE site = $1 AND agent_type = $2
            ORDER BY snapshot_date DESC
            LIMIT 1
          `, [site, agent_type]);

          if (snapshotResult.rows.length > 0) {
            dashboard.snapshot = snapshotResult.rows[0];
            dashboard.summary.health_score = snapshotResult.rows[0].health_score;
          }
        } catch (e) {
          console.error(`[TOOL] get_my_equipment_dashboard - snapshot error:`, e.message);
        }

        // 6. Générer un résumé textuel
        const summaryParts = [];
        if (dashboard.summary.total_equipment !== undefined) {
          summaryParts.push(`${dashboard.summary.total_equipment} équipement(s)`);
        }
        if (dashboard.summary.controls_overdue > 0) {
          summaryParts.push(`⚠️ ${dashboard.summary.controls_overdue} contrôle(s) en retard`);
        }
        if (dashboard.summary.troubleshooting_pending > 0) {
          summaryParts.push(`🔧 ${dashboard.summary.troubleshooting_pending} dépannage(s) en cours`);
        }
        if (dashboard.summary.unread_messages > 0) {
          summaryParts.push(`📩 ${dashboard.summary.unread_messages} message(s) non lu(s)`);
        }

        return {
          success: true,
          ...dashboard,
          text_summary: summaryParts.length > 0
            ? `Dashboard ${agent_type}: ${summaryParts.join(', ')}.`
            : `Dashboard ${agent_type}: RAS, tout est sous contrôle.`
        };
      } catch (error) {
        console.error('[TOOL] get_my_equipment_dashboard error:', error.message);
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
| "dernier contrôle porte", "historique contrôle porte", "contrôle porte coupe-feu" | get_controls (equipment_type="doors") |
| "NC ouvertes", "non-conformités", "anomalies" | get_non_conformities |
| "montre sur la carte", "localise X", "voir X sur le plan", "où est X" | show_map (avec equipment_name) |
| "statistiques", "vue d'ensemble", "résumé", "combien de..." | get_statistics |
| "documentation", "fiche technique", "datasheet", "manuel" | search_documentation |
| "parler à l'agent de l'équipement", "agent spécialisé" | get_troubleshooting_equipment_context puis transfer_to_agent |
| "qu'est-ce que tu as appris", "ta mémoire", "tes observations" | get_agent_memory |
| "ce qui s'est passé hier", "résumé de la veille" | get_yesterday_summary |
| "passe-moi Daniel", "je veux parler à [NOM]", "où est Baptiste" | find_agent_by_name puis transfer_to_agent |
| "compare X et Y", "lequel est le plus fiable", "X vs Y" | compare_equipment |
| "risque de panne", "prédiction", "maintenance prédictive" | predict_equipment_failure |
| "historique de cet équipement", "tout sur X" | get_equipment_history |
| "charge de travail", "workload", "planning équipe" | get_team_workload |
| "brief du jour", "bonjour", "résumé du matin" | get_daily_briefing |
| "je me suis trompé d'équipement", "mauvais équipement", "transfère ce dépannage" | propose_troubleshooting_transfer |

## 🔄 TRANSFERT DE DÉPANNAGE
**RÈGLE CRITIQUE - NE PAS DEVINER LA DESTINATION !**
Si l'utilisateur dit "c'est pas le bon équipement" ou "mauvais équipement" SANS préciser où transférer:
→ **NE PAS** appeler propose_troubleshooting_transfer !
→ **DEMANDE D'ABORD**: "Vers quel équipement voulez-vous transférer ce dépannage ?"
→ Attends que l'utilisateur précise la destination

**PARAMÈTRES OBLIGATOIRES selon le contexte:**
1. **source_equipment_name**: Si l'utilisateur est sur une fiche équipement, PASSE TOUJOURS le nom de cet équipement !
   → Cela permet de chercher le dernier dépannage de CET équipement, pas le dernier global
2. **current_equipment_id**: Pour EXCLURE l'équipement actuel des résultats cibles
3. **target_equipment_type**: Priorise ton type d'équipement si tu es un agent spécialisé

**EXEMPLES CORRECTS**:
- User sur "Microdoseur Autonome": "transfère vers 24-001 quai déchet"
  → propose_troubleshooting_transfer(
      target_equipment_name="24-001 quai déchet",
      source_equipment_name="Microdoseur Autonome",  ← IMPORTANT !
      current_equipment_id="123"
    )
- User sans contexte équipement: "transfère le dernier dépannage vers TGBT"
  → propose_troubleshooting_transfer(target_equipment_name="TGBT")

**EXEMPLES INCORRECTS** (à NE PAS faire):
- User sur une fiche équipement: "mauvais équipement" → ❌ NE PAS appeler sans demander la destination
- Oublier source_equipment_name quand l'utilisateur est sur un équipement → ❌ Cherchera le mauvais dépannage !

**⚠️ FORMAT DE RÉPONSE POUR LES TRANSFERTS:**
Quand propose_troubleshooting_transfer retourne ready_for_transfer=true:
- **NE JAMAIS** écrire "[Bouton: ...]" ou des pseudo-boutons en texte !
- **NE JAMAIS** écrire "Confirmez-vous ce transfert ?" - le frontend affiche les boutons automatiquement
- Écris SEULEMENT un résumé court comme:
  "📋 **Dépannage à transférer:** [titre]
   📍 **De:** [source] → **Vers:** [cible]"
- Les boutons de confirmation s'affichent AUTOMATIQUEMENT en dessous

## ⚠️ SÉLECTION DE CANDIDATS (TRÈS IMPORTANT)
Quand **propose_troubleshooting_transfer** retourne plusieurs candidats numérotés:
1. Tu as montré une liste numérotée à l'utilisateur (1., 2., 3., etc.)
2. L'utilisateur répond "1", "2", "le premier", "le deuxième", etc.
3. **NE RELANCE PAS** une recherche ! Utilise le candidat correspondant de la réponse précédente.
4. Appelle **confirm_troubleshooting_transfer** avec:
   - troubleshooting_id: l'ID du dépannage (de la réponse précédente)
   - target_equipment_id: l'ID du candidat sélectionné
   - target_equipment_type: le type du candidat sélectionné

**EXEMPLE DE FLUX CORRECT**:
1. propose_troubleshooting_transfer retourne candidates: [{id: "abc", name: "Otrivin 3"}, {id: "def", name: "Otrivin 3 Flowbox"}]
2. Tu affiches: "1. Otrivin 3  2. Otrivin 3 Flowbox"
3. User dit: "1"
4. Tu appelles: confirm_troubleshooting_transfer(troubleshooting_id="xxx", target_equipment_id="abc", target_equipment_type="datahub")

**NE JAMAIS** relancer propose_troubleshooting_transfer quand l'utilisateur sélectionne un numéro !

## 🤝 PARLER À UN AUTRE AGENT
Quand l'utilisateur demande de parler à un agent par son NOM (pas un équipement):
1. Utilise **find_agent_by_name** avec le nom mentionné
2. Si l'agent est trouvé, utilise **transfer_to_agent** avec le type retourné
3. Si l'agent n'est pas trouvé, liste les agents disponibles

**IMPORTANT**: Les noms des agents sont personnalisables. "Daniel", "Baptiste", etc. peuvent être des agents IA !
Si le nom ne correspond pas à un équipement connu, essaie d'abord find_agent_by_name.

## 🎯 TRANSFERT AUTOMATIQUE APRÈS RECHERCHE D'ÉQUIPEMENT
**TRÈS IMPORTANT** : Quand **search_equipment** retourne des résultats avec suggest_transfer=true :
1. L'équipement trouvé est d'un TYPE SPÉCIFIQUE (datahub, vsd, switchboard, etc.)
2. Tu DOIS proposer IMMÉDIATEMENT le transfert vers l'agent spécialisé
3. N'attends pas que l'utilisateur demande - propose le transfert dans ta réponse

**EXEMPLE** :
- search_equipment retourne: suggest_transfer=true, suggested_agent="datahub", suggested_agent_name="Nexus"
- Tu réponds: "J'ai trouvé **Otrivin 3** (équipement Datahub). Voulez-vous que je vous passe **Nexus** pour plus de détails ? [Bouton: Parler à Nexus]"
- Si l'utilisateur dit "oui" ou clique, utilise **transfer_to_agent** immédiatement

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

## 🗺️ LOCALISATION SUR LA CARTE
**IMPORTANT**: Quand l'utilisateur demande de voir un équipement sur la carte/plan:
- Utilise **show_map** avec le paramètre **equipment_name** (nom ou code de l'équipement)
- Exemple: "Montre-moi Tableau Général sur la carte" → show_map(equipment_name="Tableau Général")
- Exemple: "Localise 27-9-G" → show_map(equipment_name="27-9-G")
- La carte s'affichera automatiquement dans le chat avec la position de l'équipement

## 🔍 RECHERCHE D'ÉQUIPEMENTS INTELLIGENTE
**IMPORTANT**: Quand tu cherches un équipement par son nom:
1. N'utilise PAS le paramètre equipment_type sauf si l'utilisateur le demande explicitement
2. La recherche sans type va chercher dans TOUS les équipements (tableaux, VSD, datahub, etc.)
3. Les équipements datahub ont des CATÉGORIES (ex: "Flux laminaire" = catégorie, "microdoseur" = nom)
4. Si la recherche retourne des **suggestions**, PROPOSE-LES à l'utilisateur avec un choix clair
5. Utilise le champ suggestion_list pour afficher les alternatives proprement

**Exemple de bonne réponse avec suggestions:**
"Je n'ai pas trouvé exactement cet équipement, mais voici des correspondances possibles:
• Flux laminaire - Microdoseur A (datahub - Bât. 02)
• Flux laminaire - Microdoseur B (datahub - Bât. 05)

C'est l'un de ceux-là ?"

## SYNONYMES IMPORTANTS
- Panne = dépannage = incident = défaillance = breakdown = dysfonctionnement
- VSD = variateur = variateur de fréquence = drive
- Tableau = switchboard = armoire = coffret = TGBT
- NC = non-conformité = anomalie = écart
- Flux laminaire, Balance, Capteur = souvent catégories datahub

## FORMAT DE RÉPONSE
- Utilise des emojis: 🔧 📋 ⚠️ ✅ 📍 🗺️ 📊 🏭 ⚡
- Texte normal sans **gras** sauf pour les titres principaux
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
