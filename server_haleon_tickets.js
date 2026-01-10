// server_haleon_tickets.js
// Module d'intégration Haleon Tool Tickets
// Gère la synchronisation avec Bubble et les opérations sur les tickets

import express from 'express';

const BUBBLE_API_KEY = process.env.HALEON_TICKETS_API_KEY || process.env.BUBBLE_PRIVATE_KEY || '851cbb99c81df43edd4f81942bdf5006';
const BUBBLE_BASE_URL = 'https://haleon-tool.io/api/1.1';

// ============================================================
// HELPERS - Bubble API
// ============================================================

async function bubbleFetch(endpoint, options = {}) {
  const url = `${BUBBLE_BASE_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${BUBBLE_API_KEY}`,
    'Content-Type': 'application/json',
    ...options.headers
  };

  console.log(`[Bubble API] ${options.method || 'GET'} ${url}`);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      timeout: 30000
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Bubble API] Error ${response.status}: ${text}`);
      throw new Error(`Bubble API error: ${response.status} - ${text}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[Bubble API] Fetch error:`, error.message);
    throw error;
  }
}

// Normaliser le statut Bubble
function normalizeStatus(status) {
  const mapping = {
    'Ouvert (En attente d\'attribution)': 'unassigned',
    'Ouvert (Attribué)': 'assigned',
    'Ouvert (Demande de Devis)': 'quote_pending',
    'Fermé': 'closed',
    'Clôturé': 'closed'
  };
  return mapping[status] || 'unknown';
}

// Normaliser la priorité Bubble
function normalizePriority(priority) {
  const mapping = {
    'LOW': 'low',
    'MEDIUM': 'medium',
    'HIGH': 'high',
    'URGENT': 'urgent',
    'Safety': 'safety'
  };
  return mapping[priority] || 'medium';
}

// ============================================================
// INIT TABLES
// ============================================================

export async function initHaleonTicketsTables(pool) {
  console.log('[Haleon Tickets] Initialisation des tables...');

  try {
    // Table des équipes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_team_id VARCHAR(255),
        name VARCHAR(255) NOT NULL,
        color VARCHAR(50) DEFAULT '#3b82f6',
        site VARCHAR(100) DEFAULT 'Nyon',
        bubble_users TEXT[],
        is_active BOOLEAN DEFAULT TRUE,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Ajouter un index unique sur name pour les ON CONFLICT (plus robuste)
    // D'abord supprimer les doublons s'il y en a
    try {
      const duplicates = await pool.query(`
        SELECT name, COUNT(*) as cnt FROM haleon_ticket_teams GROUP BY name HAVING COUNT(*) > 1
      `);
      if (duplicates.rows.length > 0) {
        console.log('[Haleon Tickets] Found duplicates, cleaning:', duplicates.rows);
        await pool.query(`
          DELETE FROM haleon_ticket_teams a
          USING haleon_ticket_teams b
          WHERE a.id < b.id AND a.name = b.name
        `);
        console.log('[Haleon Tickets] Duplicates cleaned');
      }
    } catch (e) {
      console.log('[Haleon Tickets] Duplicate check error:', e.message);
    }

    // Créer l'index unique s'il n'existe pas
    try {
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_haleon_ticket_teams_name_unique ON haleon_ticket_teams(name)
      `);
      console.log('[Haleon Tickets] ✅ Unique index on name created/verified');
    } catch (indexError) {
      console.error('[Haleon Tickets] ❌ Index creation failed:', indexError.message);
      // Si l'index existe déjà avec un autre nom, ignorer
      if (!indexError.message.includes('already exists')) {
        console.error('[Haleon Tickets] Will use fallback logic in sync');
      }
    }

    // Table des catégories
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_category_id VARCHAR(255) UNIQUE,
        name VARCHAR(255) NOT NULL,
        team_name VARCHAR(255),
        color VARCHAR(50) DEFAULT '#3b82f6',
        icon_url TEXT,
        site VARCHAR(100) DEFAULT 'Nyon',
        is_active BOOLEAN DEFAULT TRUE,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Table des membres
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_team_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES haleon_ticket_teams(id) ON DELETE CASCADE,
        user_email VARCHAR(255) NOT NULL,
        user_name VARCHAR(255),
        can_assign BOOLEAN DEFAULT TRUE,
        can_close BOOLEAN DEFAULT TRUE,
        added_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(team_id, user_email)
      )
    `);

    // Table de cache des tickets
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_tickets_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_ticket_id VARCHAR(255) NOT NULL UNIQUE,
        ticket_code VARCHAR(50),
        description TEXT,
        status VARCHAR(100),
        status_normalized VARCHAR(50),
        priority VARCHAR(50),
        priority_normalized VARCHAR(50),
        category_name VARCHAR(255),
        team_name VARCHAR(255),
        building VARCHAR(255),
        floor VARCHAR(255),
        zone VARCHAR(255),
        created_by_email VARCHAR(255),
        created_by_name VARCHAR(255),
        assigned_to_email VARCHAR(255),
        assigned_to_name VARCHAR(255),
        bubble_created_at TIMESTAMPTZ,
        bubble_modified_at TIMESTAMPTZ,
        date_attribution TIMESTAMPTZ,
        date_cloture TIMESTAMPTZ,
        devis_id VARCHAR(255),
        zap_id VARCHAR(255),
        urgence_sla VARCHAR(50),
        raw_data JSONB,
        last_sync_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Table des actions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_ticket_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bubble_ticket_id VARCHAR(255) NOT NULL,
        ticket_code VARCHAR(50),
        action_type VARCHAR(50) NOT NULL,
        performed_by_email VARCHAR(255) NOT NULL,
        performed_by_name VARCHAR(255),
        action_data JSONB,
        sync_status VARCHAR(50) DEFAULT 'pending',
        sync_error TEXT,
        bubble_response JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        synced_at TIMESTAMPTZ
      )
    `);

    // Table de config
    await pool.query(`
      CREATE TABLE IF NOT EXISTS haleon_tickets_config (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) NOT NULL UNIQUE,
        value JSONB,
        description TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Index
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_teams_name ON haleon_ticket_teams(name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_members_email ON haleon_ticket_team_members(user_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_team ON haleon_tickets_cache(team_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_status ON haleon_tickets_cache(status_normalized)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_haleon_tickets_assigned ON haleon_tickets_cache(assigned_to_email)`);

    console.log('[Haleon Tickets] ✅ Tables initialisées');
  } catch (error) {
    console.error('[Haleon Tickets] ❌ Erreur initialisation:', error);
  }
}

// ============================================================
// ROUTER
// ============================================================

export function createHaleonTicketsRouter(pool) {
  const router = express.Router();

  // Middleware pour vérifier l'authentification
  const requireAuth = (req, res, next) => {
    if (!req.user?.email) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    next();
  };

  // Middleware pour vérifier les droits admin
  const requireAdmin = (req, res, next) => {
    const adminEmails = ['daniel.x.palha@haleon.com', 'florent.x.baents@haleon.com', 'yoann.x.grand@haleon.com'];
    if (!req.user?.email || !adminEmails.includes(req.user.email.toLowerCase())) {
      // Check also if user has admin role
      if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
        return res.status(403).json({ error: 'Accès admin requis' });
      }
    }
    next();
  };

  // ============================================================
  // ÉQUIPES - ADMIN
  // ============================================================

  // GET /api/haleon-tickets/teams - Liste des équipes
  router.get('/teams', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          t.*,
          COUNT(DISTINCT m.id) as member_count,
          (
            SELECT COUNT(*) FROM haleon_tickets_cache tc
            WHERE tc.team_name = t.name
            AND tc.status_normalized IN ('unassigned', 'assigned', 'quote_pending')
          ) as open_tickets_count
        FROM haleon_ticket_teams t
        LEFT JOIN haleon_ticket_team_members m ON m.team_id = t.id
        WHERE t.is_active = true
        GROUP BY t.id
        ORDER BY t.name
      `);

      res.json({ teams: result.rows });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur liste équipes:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/haleon-tickets/teams/sync - Synchroniser depuis Bubble
  router.post('/teams/sync', requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('[Haleon Tickets] Synchronisation des équipes depuis Bubble...');

      // 0. Nettoyer les anciennes équipes qui ont des noms ressemblant à des IDs Bubble
      await pool.query(`
        DELETE FROM haleon_ticket_teams
        WHERE name ~ '^[0-9]{13}x[0-9]+$'
      `);
      console.log('[Haleon Tickets] Anciennes équipes avec IDs nettoyées');

      // 1. Mapping statique Nom de catégorie → Nom d'équipe (basé sur Bubble UI)
      // L'API Bubble retourne des IDs pour les références, pas les noms texte
      const categoryNameToTeam = {
        'Déplacement de mobiliers et agencements': 'Technicien Facility',
        'Nettoyage (Propreté des locaux)': 'Cleaning',
        'Meeting room, printer, écrans, TV (only support)': 'Employee Experience et Services',
        'Chauffage, ventilation (HVAC)': 'Thermistes',
        'Réparations mineures et entretiens de base': 'Technicien Facility',
        'Déchets (transport ou récupération)': 'Waste',
        'Transfert (palettes et colis)': 'Technicien Facility',
        'EPI et habits jetables': 'Softservice',
        'Maintenance infrastructure (bâtiment)': 'Infra',
        'Maintenance Electrique': 'Elec',
        'Consommables bureautiques': 'Softservice',
        'Espaces verts et extérieurs': 'Infra',
        'Restauration, fitness': 'Employee Experience et Services',
        'Aménagement Meeting Room, salle': 'Technicien Facility',
        'Haleon-Tool Support': 'Haleon-tool Support',
        'Consignation Electrique / Utilités': 'Consignation',
        'Machine (café), fontaines à eau, distrib. snack': 'My Greenshop',
        'Accessoires IT': 'Softservice'
      };

      // 2. Récupérer les catégories
      const categoriesData = await bubbleFetch('/obj/TICKET:%20Cat%C3%A9gorie?limit=100');
      const categories = categoriesData.response?.results || [];
      console.log(`[Haleon Tickets] ${categories.length} catégories trouvées`);

      // 3. Détecter les catégories non mappées et construire le mapping
      const unmappedCategories = [];
      const equipeUserToName = new Map();

      for (const cat of categories) {
        const teamName = categoryNameToTeam[cat.Nom];
        if (teamName && cat.EquipeUser) {
          equipeUserToName.set(cat.EquipeUser, teamName);
          console.log(`[Haleon Tickets] Mapping: ${cat.EquipeUser} → ${teamName} (via "${cat.Nom}")`);
        } else if (cat.Nom && !categoryNameToTeam[cat.Nom]) {
          // Catégorie non mappée détectée
          unmappedCategories.push({
            name: cat.Nom,
            equipeUserId: cat.EquipeUser || 'N/A',
            color: cat.Color
          });
          console.log(`[Haleon Tickets] ⚠️ CATÉGORIE NON MAPPÉE: "${cat.Nom}" (EquipeUser: ${cat.EquipeUser})`);
        }
      }
      console.log(`[Haleon Tickets] ${equipeUserToName.size} mappings EquipeUser→nom trouvés`);

      if (unmappedCategories.length > 0) {
        console.log(`[Haleon Tickets] ⚠️ ${unmappedCategories.length} catégories non mappées détectées !`);
      }

      // 4. Extraire les équipes uniques avec leurs vrais noms
      const teamsMap = new Map();
      for (const cat of categories) {
        const teamId = cat.EquipeUser;
        if (teamId) {
          // Utiliser le nom trouvé via mapping, sinon fallback sur l'ID
          const teamName = equipeUserToName.get(teamId) || teamId;

          if (!teamsMap.has(teamName)) {
            teamsMap.set(teamName, {
              bubble_id: teamId,
              name: teamName,
              color: cat.Color || '#3b82f6',
              site: cat.Site || 'Nyon'
            });
          }
        }

        // Upsert catégorie avec le vrai nom d'équipe
        const categoryTeamName = equipeUserToName.get(cat.EquipeUser) || cat.EquipeUser;

        await pool.query(`
          INSERT INTO haleon_ticket_categories (bubble_category_id, name, team_name, color, icon_url, site, last_sync_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (bubble_category_id) DO UPDATE SET
            name = EXCLUDED.name,
            team_name = EXCLUDED.team_name,
            color = EXCLUDED.color,
            icon_url = EXCLUDED.icon_url,
            site = EXCLUDED.site,
            last_sync_at = NOW(),
            updated_at = NOW()
        `, [cat._id, cat.Nom, categoryTeamName, cat.Color, cat.Image, cat.Site]);
      }

      // 5. Upsert équipes avec les vrais noms
      let teamsCreated = 0;
      let teamsUpdated = 0;

      for (const [teamName, teamData] of teamsMap) {
        const bubbleUsers = teamData.users ?
          (Array.isArray(teamData.users) ? teamData.users : teamData.users.split(',').map(u => u.trim()))
          : [];

        // Upsert avec gestion d'erreur pour le cas où l'index n'existe pas encore
        try {
          const result = await pool.query(`
            INSERT INTO haleon_ticket_teams (bubble_team_id, name, color, site, bubble_users, last_sync_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (name) DO UPDATE SET
              bubble_team_id = COALESCE(EXCLUDED.bubble_team_id, haleon_ticket_teams.bubble_team_id),
              color = EXCLUDED.color,
              site = EXCLUDED.site,
              bubble_users = EXCLUDED.bubble_users,
              last_sync_at = NOW(),
              updated_at = NOW()
            RETURNING (xmax = 0) as inserted
          `, [teamData.bubble_id, teamName, teamData.color, teamData.site, bubbleUsers]);

          if (result.rows[0]?.inserted) {
            teamsCreated++;
          } else {
            teamsUpdated++;
          }
        } catch (upsertError) {
          // Si l'ON CONFLICT échoue, essayer de créer l'index et réessayer
          if (upsertError.message.includes('ON CONFLICT') || upsertError.message.includes('unique')) {
            console.log('[Haleon Tickets] Creating unique index on name...');
            await pool.query(`
              CREATE UNIQUE INDEX IF NOT EXISTS idx_haleon_ticket_teams_name_unique ON haleon_ticket_teams(name)
            `);

            // Réessayer l'upsert
            const existing = await pool.query(
              'SELECT id FROM haleon_ticket_teams WHERE name = $1',
              [teamName]
            );

            if (existing.rows.length > 0) {
              await pool.query(`
                UPDATE haleon_ticket_teams
                SET bubble_team_id = COALESCE($2, bubble_team_id),
                    color = $3, site = $4, bubble_users = $5, last_sync_at = NOW(), updated_at = NOW()
                WHERE name = $1
              `, [teamName, teamData.bubble_id, teamData.color, teamData.site, bubbleUsers]);
              teamsUpdated++;
            } else {
              await pool.query(`
                INSERT INTO haleon_ticket_teams (bubble_team_id, name, color, site, bubble_users, last_sync_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
              `, [teamData.bubble_id, teamName, teamData.color, teamData.site, bubbleUsers]);
              teamsCreated++;
            }
          } else {
            throw upsertError;
          }
        }
      }

      console.log(`[Haleon Tickets] Sync terminée: ${teamsCreated} créées, ${teamsUpdated} mises à jour`);

      res.json({
        success: true,
        teams_created: teamsCreated,
        teams_updated: teamsUpdated,
        categories_synced: categories.length,
        unmapped_categories: unmappedCategories,
        has_unmapped: unmappedCategories.length > 0
      });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur sync équipes:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // MEMBRES - ADMIN
  // ============================================================

  // GET /api/haleon-tickets/teams/:teamId/members - Liste des membres d'une équipe
  router.get('/teams/:teamId/members', requireAuth, async (req, res) => {
    try {
      const { teamId } = req.params;

      const result = await pool.query(`
        SELECT m.*, t.name as team_name
        FROM haleon_ticket_team_members m
        JOIN haleon_ticket_teams t ON t.id = m.team_id
        WHERE m.team_id = $1
        ORDER BY m.user_name, m.user_email
      `, [teamId]);

      res.json({ members: result.rows });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur liste membres:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/haleon-tickets/teams/:teamId/members - Ajouter un membre
  router.post('/teams/:teamId/members', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { user_email, user_name, can_assign = true, can_close = true } = req.body;

      if (!user_email) {
        return res.status(400).json({ error: 'Email requis' });
      }

      const result = await pool.query(`
        INSERT INTO haleon_ticket_team_members (team_id, user_email, user_name, can_assign, can_close, added_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (team_id, user_email) DO UPDATE SET
          user_name = EXCLUDED.user_name,
          can_assign = EXCLUDED.can_assign,
          can_close = EXCLUDED.can_close
        RETURNING *
      `, [teamId, user_email.toLowerCase(), user_name, can_assign, can_close, req.user.email]);

      res.json({ member: result.rows[0] });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur ajout membre:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/haleon-tickets/teams/:teamId/members/:memberId - Retirer un membre
  router.delete('/teams/:teamId/members/:memberId', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { teamId, memberId } = req.params;

      await pool.query(`
        DELETE FROM haleon_ticket_team_members
        WHERE id = $1 AND team_id = $2
      `, [memberId, teamId]);

      res.json({ success: true });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur suppression membre:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/haleon-tickets/available-users - Utilisateurs ElectroHub disponibles
  router.get('/available-users', requireAuth, requireAdmin, async (req, res) => {
    try {
      // Récupérer les utilisateurs actifs de haleon_users
      const result = await pool.query(`
        SELECT DISTINCT email, name
        FROM haleon_users
        WHERE is_active = true
        ORDER BY name, email
      `);

      res.json({ users: result.rows });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur liste users:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // TICKETS - Synchronisation
  // ============================================================

  // POST /api/haleon-tickets/sync - Synchroniser les tickets depuis Bubble
  router.post('/sync', requireAuth, async (req, res) => {
    try {
      console.log('[Haleon Tickets] Synchronisation des tickets depuis Bubble...');

      // Récupérer les tickets ouverts
      const constraints = [
        { key: 'Statut', constraint_type: 'contains', value: 'Ouvert' }
      ];

      const ticketsData = await bubbleFetch(
        `/obj/TICKET?constraints=${encodeURIComponent(JSON.stringify(constraints))}&limit=200&sort_field=Modified%20Date&descending=true`
      );

      const tickets = ticketsData.response?.results || [];
      console.log(`[Haleon Tickets] ${tickets.length} tickets ouverts trouvés`);

      let synced = 0;
      for (const ticket of tickets) {
        const ticketCode = ticket['TicketCode/ text - search'] || `TICKET#${ticket.CodeTicket || 'N/A'}`;

        await pool.query(`
          INSERT INTO haleon_tickets_cache (
            bubble_ticket_id, ticket_code, description, status, status_normalized,
            priority, priority_normalized, category_name, team_name,
            building, floor, zone, created_by_email, assigned_to_email,
            bubble_created_at, bubble_modified_at, date_attribution, date_cloture,
            devis_id, zap_id, urgence_sla, raw_data, last_sync_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
          ON CONFLICT (bubble_ticket_id) DO UPDATE SET
            ticket_code = EXCLUDED.ticket_code,
            description = EXCLUDED.description,
            status = EXCLUDED.status,
            status_normalized = EXCLUDED.status_normalized,
            priority = EXCLUDED.priority,
            priority_normalized = EXCLUDED.priority_normalized,
            category_name = EXCLUDED.category_name,
            team_name = EXCLUDED.team_name,
            building = EXCLUDED.building,
            floor = EXCLUDED.floor,
            zone = EXCLUDED.zone,
            assigned_to_email = EXCLUDED.assigned_to_email,
            bubble_modified_at = EXCLUDED.bubble_modified_at,
            date_attribution = EXCLUDED.date_attribution,
            date_cloture = EXCLUDED.date_cloture,
            devis_id = EXCLUDED.devis_id,
            raw_data = EXCLUDED.raw_data,
            last_sync_at = NOW()
        `, [
          ticket._id,
          ticketCode,
          ticket.Description,
          ticket.Statut,
          normalizeStatus(ticket.Statut),
          ticket.UrgenceSLA,
          normalizePriority(ticket.UrgenceSLA),
          ticket['Catégorie'],
          ticket['Catégorie Equipe/User'],
          ticket['Bâtiment'],
          ticket['Bat Etage'],
          ticket.Zone,
          ticket.CréateurDuTicket,
          ticket['Attribué à'],
          ticket['Creation Date'] ? new Date(ticket['Creation Date']) : null,
          ticket['Modified Date'] ? new Date(ticket['Modified Date']) : null,
          ticket['Date Attribution'] ? new Date(ticket['Date Attribution']) : null,
          ticket['Date Clôture'] ? new Date(ticket['Date Clôture']) : null,
          ticket.Devis,
          ticket['ZAP lié'],
          ticket.UrgenceSLA,
          JSON.stringify(ticket)
        ]);
        synced++;
      }

      console.log(`[Haleon Tickets] ${synced} tickets synchronisés`);

      res.json({
        success: true,
        tickets_synced: synced
      });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur sync tickets:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // TICKETS - Lecture
  // ============================================================

  // GET /api/haleon-tickets/my-teams - Équipes de l'utilisateur connecté
  router.get('/my-teams', requireAuth, async (req, res) => {
    try {
      const userEmail = req.user.email.toLowerCase();

      const result = await pool.query(`
        SELECT t.*, m.can_assign, m.can_close
        FROM haleon_ticket_teams t
        JOIN haleon_ticket_team_members m ON m.team_id = t.id
        WHERE m.user_email = $1 AND t.is_active = true
        ORDER BY t.name
      `, [userEmail]);

      res.json({ teams: result.rows });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur mes équipes:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/haleon-tickets/list - Liste des tickets accessibles à l'utilisateur
  router.get('/list', requireAuth, async (req, res) => {
    try {
      const userEmail = req.user.email.toLowerCase();
      const { status, team, assigned_to_me, limit = 50 } = req.query;

      // Récupérer les équipes de l'utilisateur
      const teamsResult = await pool.query(`
        SELECT t.name
        FROM haleon_ticket_teams t
        JOIN haleon_ticket_team_members m ON m.team_id = t.id
        WHERE m.user_email = $1 AND t.is_active = true
      `, [userEmail]);

      const userTeams = teamsResult.rows.map(r => r.name);

      if (userTeams.length === 0) {
        return res.json({ tickets: [], message: 'Aucune équipe assignée' });
      }

      // Construire la requête
      let query = `
        SELECT * FROM haleon_tickets_cache
        WHERE team_name = ANY($1)
        AND status_normalized IN ('unassigned', 'assigned', 'quote_pending')
      `;
      const params = [userTeams];
      let paramIndex = 2;

      if (status) {
        query += ` AND status_normalized = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (team) {
        query += ` AND team_name = $${paramIndex}`;
        params.push(team);
        paramIndex++;
      }

      if (assigned_to_me === 'true') {
        query += ` AND assigned_to_email = $${paramIndex}`;
        params.push(userEmail);
        paramIndex++;
      }

      query += ` ORDER BY
        CASE priority_normalized
          WHEN 'safety' THEN 1
          WHEN 'urgent' THEN 2
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 4
          ELSE 5
        END,
        bubble_created_at DESC
        LIMIT $${paramIndex}`;
      params.push(parseInt(limit));

      const result = await pool.query(query, params);

      res.json({ tickets: result.rows, user_teams: userTeams });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur liste tickets:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/haleon-tickets/stats - Statistiques des tickets pour l'utilisateur
  router.get('/stats', requireAuth, async (req, res) => {
    try {
      const userEmail = req.user.email.toLowerCase();

      // Récupérer les équipes de l'utilisateur
      const teamsResult = await pool.query(`
        SELECT t.name
        FROM haleon_ticket_teams t
        JOIN haleon_ticket_team_members m ON m.team_id = t.id
        WHERE m.user_email = $1 AND t.is_active = true
      `, [userEmail]);

      const userTeams = teamsResult.rows.map(r => r.name);

      if (userTeams.length === 0) {
        return res.json({
          total: 0,
          unassigned: 0,
          assigned: 0,
          my_tickets: 0,
          urgent: 0,
          by_team: []
        });
      }

      // Stats globales
      const statsResult = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status_normalized IN ('unassigned', 'assigned', 'quote_pending')) as total,
          COUNT(*) FILTER (WHERE status_normalized = 'unassigned') as unassigned,
          COUNT(*) FILTER (WHERE status_normalized IN ('assigned', 'quote_pending')) as assigned,
          COUNT(*) FILTER (WHERE assigned_to_email = $2) as my_tickets,
          COUNT(*) FILTER (WHERE priority_normalized IN ('urgent', 'safety')) as urgent
        FROM haleon_tickets_cache
        WHERE team_name = ANY($1)
      `, [userTeams, userEmail]);

      // Stats par équipe
      const byTeamResult = await pool.query(`
        SELECT
          team_name,
          COUNT(*) FILTER (WHERE status_normalized IN ('unassigned', 'assigned', 'quote_pending')) as total,
          COUNT(*) FILTER (WHERE status_normalized = 'unassigned') as unassigned,
          COUNT(*) FILTER (WHERE priority_normalized IN ('urgent', 'safety')) as urgent
        FROM haleon_tickets_cache
        WHERE team_name = ANY($1)
        GROUP BY team_name
        ORDER BY team_name
      `, [userTeams]);

      res.json({
        ...statsResult.rows[0],
        by_team: byTeamResult.rows,
        user_teams: userTeams
      });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // CONFIG & TEST - DOIT ÊTRE AVANT /:ticketId !
  // ============================================================

  // GET /api/haleon-tickets/test - Test de connexion
  router.get('/test', async (req, res) => {
    try {
      // Test DB
      const dbTest = await pool.query('SELECT NOW() as time');

      // Test Bubble API
      let bubbleTest = { status: 'unknown' };
      try {
        const response = await bubbleFetch('/obj/TICKET?limit=1');
        bubbleTest = {
          status: 'ok',
          tickets_count: response.response?.count || 0
        };
      } catch (e) {
        bubbleTest = { status: 'error', message: e.message };
      }

      // Check unique index
      let indexStatus = 'unknown';
      try {
        const indexCheck = await pool.query(`
          SELECT indexname FROM pg_indexes
          WHERE tablename = 'haleon_ticket_teams' AND indexname LIKE '%name%'
        `);
        indexStatus = indexCheck.rows.length > 0 ? 'exists: ' + indexCheck.rows.map(r => r.indexname).join(', ') : 'missing';
      } catch (e) {
        indexStatus = 'error: ' + e.message;
      }

      res.json({
        status: 'ok',
        database: { connected: true, time: dbTest.rows[0].time },
        bubble: bubbleTest,
        unique_index_on_name: indexStatus
      });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });

  // ============================================================
  // TICKETS - Détail et Actions (routes avec paramètres EN DERNIER)
  // ============================================================

  // GET /api/haleon-tickets/:ticketId - Détail d'un ticket
  router.get('/:ticketId', requireAuth, async (req, res) => {
    try {
      const { ticketId } = req.params;

      const result = await pool.query(`
        SELECT * FROM haleon_tickets_cache
        WHERE bubble_ticket_id = $1 OR ticket_code = $1
      `, [ticketId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Ticket non trouvé' });
      }

      // Récupérer les actions
      const actionsResult = await pool.query(`
        SELECT * FROM haleon_ticket_actions
        WHERE bubble_ticket_id = $1
        ORDER BY created_at DESC
      `, [result.rows[0].bubble_ticket_id]);

      res.json({
        ticket: result.rows[0],
        actions: actionsResult.rows
      });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur détail ticket:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // TICKETS - Actions
  // ============================================================

  // POST /api/haleon-tickets/:ticketId/assign - S'attribuer un ticket
  router.post('/:ticketId/assign', requireAuth, async (req, res) => {
    try {
      const { ticketId } = req.params;
      const userEmail = req.user.email;
      const userName = req.user.name || userEmail.split('@')[0];

      // Vérifier que l'utilisateur a accès à ce ticket
      const ticketResult = await pool.query(`
        SELECT tc.* FROM haleon_tickets_cache tc
        JOIN haleon_ticket_teams t ON t.name = tc.team_name
        JOIN haleon_ticket_team_members m ON m.team_id = t.id AND m.user_email = $2
        WHERE tc.bubble_ticket_id = $1 AND m.can_assign = true
      `, [ticketId, userEmail.toLowerCase()]);

      if (ticketResult.rows.length === 0) {
        return res.status(403).json({ error: 'Pas d\'accès à ce ticket ou pas de permission d\'attribution' });
      }

      const ticket = ticketResult.rows[0];

      // Appeler le workflow Bubble pour assigner
      // TODO: Créer un workflow Bubble "assign_ticket"
      // Pour l'instant, on simule localement

      // Logger l'action
      await pool.query(`
        INSERT INTO haleon_ticket_actions (bubble_ticket_id, ticket_code, action_type, performed_by_email, performed_by_name, action_data, sync_status)
        VALUES ($1, $2, 'assign', $3, $4, $5, 'pending')
      `, [ticketId, ticket.ticket_code, userEmail, userName, JSON.stringify({ assigned_to: userEmail })]);

      // Mettre à jour le cache local
      await pool.query(`
        UPDATE haleon_tickets_cache
        SET assigned_to_email = $2,
            assigned_to_name = $3,
            status = 'Ouvert (Attribué)',
            status_normalized = 'assigned',
            date_attribution = NOW()
        WHERE bubble_ticket_id = $1
      `, [ticketId, userEmail, userName]);

      res.json({
        success: true,
        message: `Ticket ${ticket.ticket_code} attribué à ${userName}`,
        note: 'La synchronisation avec Bubble sera effectuée prochainement'
      });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur attribution:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/haleon-tickets/:ticketId/comment - Ajouter un commentaire
  router.post('/:ticketId/comment', requireAuth, async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { comment } = req.body;
      const userEmail = req.user.email;
      const userName = req.user.name || userEmail.split('@')[0];

      if (!comment) {
        return res.status(400).json({ error: 'Commentaire requis' });
      }

      // Vérifier l'accès
      const ticketResult = await pool.query(`
        SELECT tc.* FROM haleon_tickets_cache tc
        JOIN haleon_ticket_teams t ON t.name = tc.team_name
        JOIN haleon_ticket_team_members m ON m.team_id = t.id AND m.user_email = $2
        WHERE tc.bubble_ticket_id = $1
      `, [ticketId, userEmail.toLowerCase()]);

      if (ticketResult.rows.length === 0) {
        return res.status(403).json({ error: 'Pas d\'accès à ce ticket' });
      }

      const ticket = ticketResult.rows[0];

      // Logger l'action
      await pool.query(`
        INSERT INTO haleon_ticket_actions (bubble_ticket_id, ticket_code, action_type, performed_by_email, performed_by_name, action_data, sync_status)
        VALUES ($1, $2, 'comment', $3, $4, $5, 'pending')
      `, [ticketId, ticket.ticket_code, userEmail, userName, JSON.stringify({ comment })]);

      res.json({
        success: true,
        message: 'Commentaire ajouté',
        note: 'La synchronisation avec Bubble sera effectuée prochainement'
      });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur commentaire:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/haleon-tickets/:ticketId/close - Fermer un ticket
  router.post('/:ticketId/close', requireAuth, async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { resolution_note } = req.body;
      const userEmail = req.user.email;
      const userName = req.user.name || userEmail.split('@')[0];

      // Vérifier l'accès et les permissions
      const ticketResult = await pool.query(`
        SELECT tc.* FROM haleon_tickets_cache tc
        JOIN haleon_ticket_teams t ON t.name = tc.team_name
        JOIN haleon_ticket_team_members m ON m.team_id = t.id AND m.user_email = $2
        WHERE tc.bubble_ticket_id = $1 AND m.can_close = true
      `, [ticketId, userEmail.toLowerCase()]);

      if (ticketResult.rows.length === 0) {
        return res.status(403).json({ error: 'Pas d\'accès ou pas de permission de fermeture' });
      }

      const ticket = ticketResult.rows[0];

      // Logger l'action
      await pool.query(`
        INSERT INTO haleon_ticket_actions (bubble_ticket_id, ticket_code, action_type, performed_by_email, performed_by_name, action_data, sync_status)
        VALUES ($1, $2, 'close', $3, $4, $5, 'pending')
      `, [ticketId, ticket.ticket_code, userEmail, userName, JSON.stringify({ resolution_note })]);

      // Mettre à jour le cache local
      await pool.query(`
        UPDATE haleon_tickets_cache
        SET status = 'Fermé',
            status_normalized = 'closed',
            date_cloture = NOW()
        WHERE bubble_ticket_id = $1
      `, [ticketId]);

      res.json({
        success: true,
        message: `Ticket ${ticket.ticket_code} fermé`,
        note: 'La synchronisation avec Bubble sera effectuée prochainement'
      });
    } catch (error) {
      console.error('[Haleon Tickets] Erreur fermeture:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default { createHaleonTicketsRouter, initHaleonTicketsTables };
