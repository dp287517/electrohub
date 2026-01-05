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
      description: `Recherche les dépannages, interventions, réparations ou pannes dans l'historique.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "derniers dépannages", "interventions récentes", "pannes de la semaine"
- "qu'est-ce qui a été réparé", "problèmes résolus"
- "historique des interventions", "dépannages critiques"
- Toute question sur des réparations passées ou des pannes`,
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Nombre de jours à remonter dans l'historique (défaut: 7)"
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
          limit: {
            type: "number",
            description: "Nombre maximum de résultats (défaut: 10, max: 50)"
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
      description: `Recherche des équipements (tableaux électriques, variateurs, etc.).

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "où est le tableau...", "trouve l'équipement..."
- "équipements du bâtiment X", "tableaux de l'étage Y"
- "liste des variateurs", "équipements ATEX"
- Toute question sur la localisation ou l'état d'équipements`,
      parameters: {
        type: "object",
        properties: {
          equipment_type: {
            type: "string",
            enum: ["switchboard", "vsd", "meca", "atex", "hv", "mobile", "glo", "door"],
            description: "Type d'équipement à chercher"
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
  // CONTRÔLES
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "get_controls",
      description: `Récupère les contrôles planifiés, en retard ou à venir.

UTILISE CETTE FONCTION QUAND l'utilisateur demande:
- "contrôles en retard", "équipements à contrôler"
- "planning des contrôles", "contrôles de la semaine"
- "qu'est-ce que je dois faire aujourd'hui"
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
            description: "Type d'équipement à filtrer"
          },
          building: {
            type: "string",
            description: "Code du bâtiment pour filtrer"
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
          t.id, t.title, t.description, t.severity, t.status,
          t.solution, t.technician_name, t.created_at, t.resolved_at,
          t.equipment_id, t.equipment_type, t.equipment_name,
          t.building, t.floor, t.duration_minutes
        FROM troubleshooting t
        WHERE t.site = $1
          AND t.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      `;
      const queryParams = [site];
      let paramIndex = 2;

      if (severity && severity !== 'all') {
        query += ` AND t.severity = $${paramIndex}`;
        queryParams.push(severity);
        paramIndex++;
      }

      if (building) {
        query += ` AND UPPER(t.building) = $${paramIndex}`;
        queryParams.push(building.toUpperCase());
        paramIndex++;
      }

      if (equipment_name) {
        query += ` AND LOWER(t.equipment_name) LIKE $${paramIndex}`;
        queryParams.push(`%${equipment_name.toLowerCase()}%`);
        paramIndex++;
      }

      query += ` ORDER BY t.created_at DESC LIMIT ${Math.min(parseInt(limit) || 10, 50)}`;

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
            building: r.building,
            floor: r.floor,
            date: r.created_at,
            resolved_at: r.resolved_at,
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
      const { equipment_type = 'switchboard', building, floor, name, code, limit = 20 } = params;

      // Mapper le type d'équipement à la table
      const tableMap = {
        switchboard: { table: 'switchboards', columns: 'id, name, code, building_code, floor, room, site' },
        vsd: { table: 'vsd_drives', columns: 'id, name, tag as code, building as building_code, floor, location as room, site' },
        meca: { table: 'equipment_meca', columns: 'id, name, tag as code, building as building_code, floor, location as room, site' },
        atex: { table: 'atex_equipment', columns: 'id, name, tag as code, building as building_code, floor, location as room, site' },
        mobile: { table: 'mobile_equipment', columns: 'id, name, code, building_code, floor, room, site' },
        hv: { table: 'hv_equipment', columns: 'id, name, tag as code, building as building_code, floor, location as room, site' }
      };

      const tableInfo = tableMap[equipment_type] || tableMap.switchboard;

      let query = `
        SELECT ${tableInfo.columns}, '${equipment_type}' as equipment_type
        FROM ${tableInfo.table}
        WHERE site = $1
      `;
      const queryParams = [site];
      let paramIndex = 2;

      if (building) {
        query += ` AND UPPER(building_code) = $${paramIndex}`;
        queryParams.push(building.toUpperCase());
        paramIndex++;
      }

      if (floor) {
        query += ` AND UPPER(floor) = $${paramIndex}`;
        queryParams.push(floor.toUpperCase());
        paramIndex++;
      }

      if (name) {
        query += ` AND LOWER(name) LIKE $${paramIndex}`;
        queryParams.push(`%${name.toLowerCase()}%`);
        paramIndex++;
      }

      if (code) {
        query += ` AND LOWER(code) LIKE $${paramIndex}`;
        queryParams.push(`%${code.toLowerCase()}%`);
        paramIndex++;
      }

      query += ` ORDER BY building_code, floor, name LIMIT ${Math.min(parseInt(limit) || 20, 50)}`;

      try {
        const result = await pool.query(query, queryParams);

        return {
          success: true,
          count: result.rows.length,
          equipment_type,
          filters: { building, floor, name, code },
          equipment: result.rows.map(eq => ({
            id: eq.id,
            name: eq.name,
            code: eq.code,
            building_code: eq.building_code,
            floor: eq.floor,
            room: eq.room,
            equipment_type
          })),
          summary: result.rows.length === 0
            ? `Aucun équipement ${equipment_type} trouvé avec ces critères.`
            : `${result.rows.length} équipement(s) ${equipment_type} trouvé(s).`
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
        vsd: 'vsd_drives',
        meca: 'equipment_meca',
        atex: 'atex_equipment',
        mobile: 'mobile_equipment',
        hv: 'hv_equipment'
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
    // CONTRÔLES
    // -----------------------------------------------------------------------
    get_controls: async (params) => {
      const { filter = 'overdue', equipment_type = 'all', building, limit = 20 } = params;

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

      if (building) {
        query += ` AND UPPER(s.building_code) = $${paramIndex}`;
        queryParams.push(building.toUpperCase());
        paramIndex++;
      }

      query += ` ORDER BY sc.next_control_date ASC LIMIT ${Math.min(parseInt(limit) || 20, 50)}`;

      try {
        const result = await pool.query(query, queryParams);

        // Calculer des stats
        const overdueCount = result.rows.filter(r => r.days_overdue > 0).length;

        return {
          success: true,
          filter,
          count: result.rows.length,
          overdue_count: overdueCount,
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
            ? `Aucun contrôle ${filter === 'overdue' ? 'en retard' : 'prévu'}.`
            : `${result.rows.length} contrôle(s) ${filter === 'overdue' ? 'en retard' : 'prévu(s)'}.`
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
        // Récupérer les équipements spécifiés
        const tableMap = {
          switchboard: 'switchboards',
          vsd: 'vsd_drives',
          meca: 'equipment_meca',
          mobile: 'mobile_equipment'
        };
        const table = tableMap[equipment_type] || 'switchboards';

        try {
          const result = await pool.query(`
            SELECT id, name, code, building_code, floor, room
            FROM ${table}
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
              FROM troubleshooting
              WHERE site = $1 AND created_at >= NOW() - INTERVAL '30 days'
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
        success: false,
        error: `Tool "${name}" not found`
      };
    }

    const result = await handler(args);
    console.log(`[TOOL] ${name} completed:`, result.success ? 'success' : 'failed');

    return {
      tool_call_id: toolCall.id,
      ...result
    };
  } catch (error) {
    console.error(`[TOOL] ${name} error:`, error.message);
    return {
      tool_call_id: toolCall.id,
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

## RÈGLES CRITIQUES
1. **UTILISE LES FONCTIONS** pour accéder aux données (dépannages, procédures, équipements, contrôles)
2. **NE JAMAIS INVENTER** de données - si tu n'as pas l'info, utilise une fonction pour la récupérer
3. **SOIS BREF** - Pas de blabla, des réponses directes et structurées
4. **PROPOSE TOUJOURS** une action suivante ou des options

## QUAND UTILISER LES FONCTIONS

| Demande utilisateur | Fonction à utiliser |
|---------------------|---------------------|
| "derniers dépannages", "interventions", "pannes" | search_troubleshooting |
| "procédure pour...", "comment faire..." | search_procedures |
| "ouvre/montre la procédure" | open_procedure_modal |
| "équipements du bâtiment X" | search_equipment |
| "contrôles en retard", "planning" | get_controls |
| "NC ouvertes", "non-conformités" | get_non_conformities |
| "montre sur la carte" | show_map |
| "statistiques", "vue d'ensemble" | get_statistics |
| "documentation", "fiche technique" | search_documentation |

## FORMAT DE RÉPONSE
- Utilise des emojis pour la lisibilité: 🔧 📋 ⚠️ ✅ 📍 🗺️
- **Gras** pour les éléments importants
- Listes à puces pour les énumérations
- Termine par une question ou proposition d'action

## EXEMPLES

❌ MAUVAIS: "Je vais chercher les dépannages..." (sans utiliser de fonction)
✅ BON: [Utilise search_troubleshooting] puis "🔧 **3 dépannages** cette semaine..."

❌ MAUVAIS: "Il existe peut-être une procédure pour ça"
✅ BON: [Utilise search_procedures] puis "📋 **Procédure trouvée**: Contrôle des prises..."`;

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
