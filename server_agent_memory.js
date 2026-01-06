/**
 * ============================================================================
 * ELECTROHUB AGENT MEMORY SYSTEM
 * ============================================================================
 *
 * Système de mémoire persistante pour les agents IA.
 * Chaque agent a sa propre mémoire + Electro a une vue globale.
 *
 * Features:
 * - Daily snapshots automatiques de chaque domaine
 * - Mémoire long-terme par agent
 * - Tour de table du matin
 * - KPIs historiques
 * - Communication inter-agents via Electro
 */

import express from 'express';

// ============================================================================
// CONFIGURATION
// ============================================================================

const AGENT_TYPES = ['main', 'vsd', 'meca', 'glo', 'hv', 'mobile', 'atex', 'switchboard', 'doors', 'datahub', 'firecontrol'];

const AGENT_DOMAINS = {
  main: { name: 'Electro', tables: ['*'], description: 'Orchestrateur - vue globale' },
  vsd: { name: 'Shakira', tables: ['vsd_equipment'], description: 'Variateurs de fréquence' },
  meca: { name: 'Titan', tables: ['meca_equipment'], description: 'Équipements mécaniques' },
  glo: { name: 'Lumina', tables: ['glo_equipment'], description: 'Éclairage de sécurité' },
  hv: { name: 'Voltaire', tables: ['hv_equipment'], description: 'Haute tension' },
  mobile: { name: 'Nomad', tables: ['mobile_equipment'], description: 'Équipements mobiles' },
  atex: { name: 'Phoenix', tables: ['atex_equipment'], description: 'Zones ATEX' },
  switchboard: { name: 'Matrix', tables: ['switchboards', 'switchboard_devices'], description: 'Tableaux électriques' },
  doors: { name: 'Portal', tables: ['doors'], description: 'Portes et accès' },
  datahub: { name: 'Nexus', tables: ['datahub_items'], description: 'Capteurs et monitoring' },
  firecontrol: { name: 'Blaze', tables: ['fire_equipment'], description: 'Sécurité incendie' }
};

// ============================================================================
// TABLE INITIALIZATION
// ============================================================================

export async function initAgentMemoryTables(pool) {
  console.log('[AGENT-MEMORY] Initializing tables...');

  try {
    // Table principale de mémoire des agents
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site VARCHAR(100) NOT NULL,
        agent_type VARCHAR(50) NOT NULL,
        memory_type VARCHAR(50) NOT NULL, -- 'insight', 'learning', 'alert', 'kpi', 'event'
        content TEXT NOT NULL,
        context JSONB DEFAULT '{}',
        importance INTEGER DEFAULT 5, -- 1-10, 10 = critique
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ, -- NULL = permanent
        tags TEXT[] DEFAULT '{}'
      )
    `);

    // Index pour recherche rapide
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_memory_site_agent
      ON agent_memory(site, agent_type, created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_memory_type
      ON agent_memory(memory_type, importance DESC)
    `);

    // Table des snapshots quotidiens
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_daily_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site VARCHAR(100) NOT NULL,
        snapshot_date DATE NOT NULL,
        agent_type VARCHAR(50) NOT NULL,

        -- Métriques générales
        total_equipment INTEGER DEFAULT 0,
        equipment_ok INTEGER DEFAULT 0,
        equipment_warning INTEGER DEFAULT 0,
        equipment_critical INTEGER DEFAULT 0,

        -- Contrôles
        controls_overdue INTEGER DEFAULT 0,
        controls_due_today INTEGER DEFAULT 0,
        controls_due_week INTEGER DEFAULT 0,
        controls_completed_today INTEGER DEFAULT 0,

        -- Dépannages
        troubleshooting_count INTEGER DEFAULT 0,
        troubleshooting_resolved INTEGER DEFAULT 0,
        troubleshooting_pending INTEGER DEFAULT 0,

        -- Non-conformités
        nc_open INTEGER DEFAULT 0,
        nc_closed_today INTEGER DEFAULT 0,

        -- KPIs calculés
        health_score INTEGER DEFAULT 100, -- 0-100
        mtbf_hours NUMERIC, -- Mean Time Between Failures
        mttr_hours NUMERIC, -- Mean Time To Repair

        -- Données brutes pour analyse
        raw_data JSONB DEFAULT '{}',

        -- Résumé IA généré
        ai_summary TEXT,
        ai_insights JSONB DEFAULT '[]',
        ai_recommendations JSONB DEFAULT '[]',

        created_at TIMESTAMPTZ DEFAULT NOW(),

        UNIQUE(site, snapshot_date, agent_type)
      )
    `);

    // Index pour snapshots
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_snapshots_lookup
      ON agent_daily_snapshots(site, agent_type, snapshot_date DESC)
    `);

    // Table des communications inter-agents
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_communications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site VARCHAR(100) NOT NULL,
        from_agent VARCHAR(50) NOT NULL,
        to_agent VARCHAR(50) NOT NULL, -- 'main' pour broadcast à Electro
        message_type VARCHAR(50) NOT NULL, -- 'alert', 'info', 'request', 'response'
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        context JSONB DEFAULT '{}',
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Table du brief du matin
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_morning_briefs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site VARCHAR(100) NOT NULL,
        brief_date DATE NOT NULL,

        -- Brief global d'Electro
        global_summary TEXT,
        global_health_score INTEGER,
        priority_actions JSONB DEFAULT '[]',

        -- Tour de table (réponse de chaque agent)
        agent_reports JSONB DEFAULT '{}', -- { "vsd": { summary, issues, kpis }, ... }

        -- Généré par IA
        generated_at TIMESTAMPTZ DEFAULT NOW(),

        UNIQUE(site, brief_date)
      )
    `);

    console.log('[AGENT-MEMORY] Tables initialized successfully');
  } catch (err) {
    console.error('[AGENT-MEMORY] Error initializing tables:', err);
    throw err;
  }
}

// ============================================================================
// SNAPSHOT GENERATION
// ============================================================================

/**
 * Génère un snapshot quotidien pour un agent spécifique
 */
async function generateAgentSnapshot(pool, site, agentType, date = new Date()) {
  const dateStr = date.toISOString().split('T')[0];
  console.log(`[AGENT-MEMORY] Generating snapshot for ${agentType} on ${dateStr}`);

  const snapshot = {
    total_equipment: 0,
    equipment_ok: 0,
    equipment_warning: 0,
    equipment_critical: 0,
    controls_overdue: 0,
    controls_due_today: 0,
    controls_due_week: 0,
    controls_completed_today: 0,
    troubleshooting_count: 0,
    troubleshooting_resolved: 0,
    troubleshooting_pending: 0,
    nc_open: 0,
    nc_closed_today: 0,
    health_score: 100,
    raw_data: {}
  };

  try {
    // Mapping table par type d'agent
    const tableMap = {
      vsd: 'vsd_equipment',
      meca: 'meca_equipment',
      glo: 'glo_equipment',
      hv: 'hv_equipment',
      mobile: 'mobile_equipment',
      atex: 'atex_equipment',
      switchboard: 'switchboards',
      doors: 'doors',
      datahub: 'datahub_items'
    };

    const equipmentTable = tableMap[agentType];

    // Compter les équipements si applicable
    if (equipmentTable) {
      try {
        const countResult = await pool.query(
          `SELECT COUNT(*) as total FROM ${equipmentTable} WHERE site = $1`,
          [site]
        );
        snapshot.total_equipment = parseInt(countResult.rows[0]?.total || 0);
        snapshot.equipment_ok = snapshot.total_equipment; // Par défaut tous OK
      } catch (e) {
        // Table peut ne pas exister
      }
    }

    // Compter les contrôles en retard pour ce type
    const controlTypeMap = {
      vsd: 'vsd',
      meca: 'meca',
      glo: 'glo',
      hv: 'hv',
      mobile: 'mobile_equipment',
      switchboard: 'switchboard',
      doors: 'door'
    };

    const controlType = controlTypeMap[agentType];
    if (controlType) {
      try {
        // Contrôles en retard
        const overdueResult = await pool.query(`
          SELECT COUNT(*) as count FROM control_schedules
          WHERE site = $1
          AND equipment_type = $2
          AND next_due_date < CURRENT_DATE
          AND is_active = true
        `, [site, controlType]);
        snapshot.controls_overdue = parseInt(overdueResult.rows[0]?.count || 0);

        // Contrôles aujourd'hui
        const todayResult = await pool.query(`
          SELECT COUNT(*) as count FROM control_schedules
          WHERE site = $1
          AND equipment_type = $2
          AND next_due_date = CURRENT_DATE
          AND is_active = true
        `, [site, controlType]);
        snapshot.controls_due_today = parseInt(todayResult.rows[0]?.count || 0);

        // Contrôles cette semaine
        const weekResult = await pool.query(`
          SELECT COUNT(*) as count FROM control_schedules
          WHERE site = $1
          AND equipment_type = $2
          AND next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          AND is_active = true
        `, [site, controlType]);
        snapshot.controls_due_week = parseInt(weekResult.rows[0]?.count || 0);
      } catch (e) {
        // Tables peuvent ne pas exister
      }
    }

    // Dépannages du jour pour ce type
    try {
      const troubleResult = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE status = 'pending') as pending
        FROM troubleshooting_records
        WHERE site = $1
        AND equipment_type = $2
        AND DATE(created_at) = $3
      `, [site, agentType, dateStr]);

      const row = troubleResult.rows[0] || {};
      snapshot.troubleshooting_count = parseInt(row.total || 0);
      snapshot.troubleshooting_resolved = parseInt(row.resolved || 0);
      snapshot.troubleshooting_pending = parseInt(row.pending || 0);
    } catch (e) {
      // Table peut ne pas exister
    }

    // Calculer le health score
    let healthDeductions = 0;
    healthDeductions += snapshot.controls_overdue * 5; // -5 par contrôle en retard
    healthDeductions += snapshot.troubleshooting_pending * 3; // -3 par dépannage en cours
    healthDeductions += snapshot.nc_open * 4; // -4 par NC ouverte
    snapshot.health_score = Math.max(0, 100 - healthDeductions);

    // Sauvegarder le snapshot
    await pool.query(`
      INSERT INTO agent_daily_snapshots (
        site, snapshot_date, agent_type,
        total_equipment, equipment_ok, equipment_warning, equipment_critical,
        controls_overdue, controls_due_today, controls_due_week, controls_completed_today,
        troubleshooting_count, troubleshooting_resolved, troubleshooting_pending,
        nc_open, nc_closed_today, health_score, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (site, snapshot_date, agent_type)
      DO UPDATE SET
        total_equipment = EXCLUDED.total_equipment,
        equipment_ok = EXCLUDED.equipment_ok,
        controls_overdue = EXCLUDED.controls_overdue,
        controls_due_today = EXCLUDED.controls_due_today,
        controls_due_week = EXCLUDED.controls_due_week,
        troubleshooting_count = EXCLUDED.troubleshooting_count,
        troubleshooting_resolved = EXCLUDED.troubleshooting_resolved,
        troubleshooting_pending = EXCLUDED.troubleshooting_pending,
        health_score = EXCLUDED.health_score,
        raw_data = EXCLUDED.raw_data
    `, [
      site, dateStr, agentType,
      snapshot.total_equipment, snapshot.equipment_ok, snapshot.equipment_warning, snapshot.equipment_critical,
      snapshot.controls_overdue, snapshot.controls_due_today, snapshot.controls_due_week, snapshot.controls_completed_today,
      snapshot.troubleshooting_count, snapshot.troubleshooting_resolved, snapshot.troubleshooting_pending,
      snapshot.nc_open, snapshot.nc_closed_today, snapshot.health_score, JSON.stringify(snapshot.raw_data)
    ]);

    return snapshot;
  } catch (err) {
    console.error(`[AGENT-MEMORY] Error generating snapshot for ${agentType}:`, err);
    throw err;
  }
}

/**
 * Génère tous les snapshots quotidiens pour un site
 */
async function generateAllDailySnapshots(pool, site, date = new Date()) {
  console.log(`[AGENT-MEMORY] Generating all daily snapshots for ${site}`);

  const results = {};
  for (const agentType of AGENT_TYPES) {
    if (agentType === 'main') continue; // Electro agrège les autres
    try {
      results[agentType] = await generateAgentSnapshot(pool, site, agentType, date);
    } catch (err) {
      console.error(`[AGENT-MEMORY] Failed to generate snapshot for ${agentType}:`, err.message);
      results[agentType] = { error: err.message };
    }
  }

  // Snapshot global pour Electro (agrégation)
  const globalSnapshot = {
    total_equipment: 0,
    controls_overdue: 0,
    controls_due_today: 0,
    troubleshooting_count: 0,
    health_score: 0,
    agent_count: 0
  };

  for (const [type, data] of Object.entries(results)) {
    if (data.error) continue;
    globalSnapshot.total_equipment += data.total_equipment || 0;
    globalSnapshot.controls_overdue += data.controls_overdue || 0;
    globalSnapshot.controls_due_today += data.controls_due_today || 0;
    globalSnapshot.troubleshooting_count += data.troubleshooting_count || 0;
    globalSnapshot.health_score += data.health_score || 0;
    globalSnapshot.agent_count++;
  }

  if (globalSnapshot.agent_count > 0) {
    globalSnapshot.health_score = Math.round(globalSnapshot.health_score / globalSnapshot.agent_count);
  }

  // Sauvegarder snapshot Electro
  const dateStr = date.toISOString().split('T')[0];
  await pool.query(`
    INSERT INTO agent_daily_snapshots (
      site, snapshot_date, agent_type,
      total_equipment, controls_overdue, controls_due_today,
      troubleshooting_count, health_score, raw_data
    ) VALUES ($1, $2, 'main', $3, $4, $5, $6, $7, $8)
    ON CONFLICT (site, snapshot_date, agent_type)
    DO UPDATE SET
      total_equipment = EXCLUDED.total_equipment,
      controls_overdue = EXCLUDED.controls_overdue,
      controls_due_today = EXCLUDED.controls_due_today,
      troubleshooting_count = EXCLUDED.troubleshooting_count,
      health_score = EXCLUDED.health_score,
      raw_data = EXCLUDED.raw_data
  `, [
    site, dateStr,
    globalSnapshot.total_equipment, globalSnapshot.controls_overdue,
    globalSnapshot.controls_due_today, globalSnapshot.troubleshooting_count,
    globalSnapshot.health_score, JSON.stringify(results)
  ]);

  results.main = globalSnapshot;
  return results;
}

// ============================================================================
// MORNING BRIEF - TOUR DE TABLE
// ============================================================================

/**
 * Génère le brief du matin avec tour de table de tous les agents
 */
async function generateMorningBrief(pool, site, openai = null) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  console.log(`[AGENT-MEMORY] Generating morning brief for ${site}`);

  // Récupérer les snapshots d'hier et aujourd'hui
  const snapshotsResult = await pool.query(`
    SELECT * FROM agent_daily_snapshots
    WHERE site = $1 AND snapshot_date IN ($2, $3)
    ORDER BY agent_type, snapshot_date DESC
  `, [site, today, yesterday]);

  const snapshotsByAgent = {};
  for (const row of snapshotsResult.rows) {
    if (!snapshotsByAgent[row.agent_type]) {
      snapshotsByAgent[row.agent_type] = [];
    }
    snapshotsByAgent[row.agent_type].push(row);
  }

  // Récupérer les dépannages d'hier
  const troubleshootingResult = await pool.query(`
    SELECT
      equipment_type,
      COUNT(*) as count,
      array_agg(DISTINCT root_cause) FILTER (WHERE root_cause IS NOT NULL) as causes,
      array_agg(equipment_name) as equipment_names
    FROM troubleshooting_records
    WHERE site = $1 AND DATE(created_at) = $2
    GROUP BY equipment_type
  `, [site, yesterday]);

  const troubleshootingByType = {};
  for (const row of troubleshootingResult.rows) {
    troubleshootingByType[row.equipment_type] = row;
  }

  // Générer le rapport de chaque agent
  const agentReports = {};
  let globalHealthScore = 0;
  let agentCount = 0;

  for (const agentType of AGENT_TYPES) {
    if (agentType === 'main') continue;

    const agentInfo = AGENT_DOMAINS[agentType];
    const snapshots = snapshotsByAgent[agentType] || [];
    const todaySnapshot = snapshots.find(s => s.snapshot_date.toISOString().split('T')[0] === today);
    const yesterdaySnapshot = snapshots.find(s => s.snapshot_date.toISOString().split('T')[0] === yesterday);
    const troubles = troubleshootingByType[agentType];

    const report = {
      agent_name: agentInfo.name,
      domain: agentInfo.description,
      health_score: todaySnapshot?.health_score || 100,
      health_trend: todaySnapshot && yesterdaySnapshot
        ? todaySnapshot.health_score - yesterdaySnapshot.health_score
        : 0,
      summary: [],
      issues: [],
      kpis: {
        equipment_count: todaySnapshot?.total_equipment || 0,
        controls_overdue: todaySnapshot?.controls_overdue || 0,
        controls_today: todaySnapshot?.controls_due_today || 0,
        troubles_yesterday: troubles?.count || 0
      }
    };

    // Générer résumé
    if (report.kpis.controls_overdue > 0) {
      report.issues.push(`⚠️ ${report.kpis.controls_overdue} contrôle(s) en retard`);
    }
    if (report.kpis.controls_today > 0) {
      report.summary.push(`📅 ${report.kpis.controls_today} contrôle(s) prévu(s) aujourd'hui`);
    }
    if (troubles?.count > 0) {
      report.summary.push(`🔧 ${troubles.count} dépannage(s) hier`);
      if (troubles.causes?.length > 0) {
        report.issues.push(`Causes principales: ${troubles.causes.slice(0, 3).join(', ')}`);
      }
    }

    if (report.summary.length === 0 && report.issues.length === 0) {
      report.summary.push('✅ RAS - Tout est sous contrôle');
    }

    agentReports[agentType] = report;
    globalHealthScore += report.health_score;
    agentCount++;
  }

  globalHealthScore = agentCount > 0 ? Math.round(globalHealthScore / agentCount) : 100;

  // Construire les actions prioritaires
  const priorityActions = [];
  for (const [type, report] of Object.entries(agentReports)) {
    if (report.kpis.controls_overdue > 0) {
      priorityActions.push({
        agent: type,
        agent_name: report.agent_name,
        action: `Rattraper ${report.kpis.controls_overdue} contrôle(s) en retard`,
        urgency: 'high'
      });
    }
  }

  // Générer résumé global avec IA si disponible
  let globalSummary = '';
  if (openai) {
    try {
      const prompt = `Tu es Electro, l'IA coordinatrice. Génère un brief du matin en 3-4 phrases pour l'équipe.

Données:
- Score santé global: ${globalHealthScore}/100
- Contrôles en retard total: ${Object.values(agentReports).reduce((s, r) => s + r.kpis.controls_overdue, 0)}
- Dépannages hier: ${Object.values(agentReports).reduce((s, r) => s + r.kpis.troubles_yesterday, 0)}
- Agents avec problèmes: ${Object.entries(agentReports).filter(([, r]) => r.issues.length > 0).map(([t, r]) => r.agent_name).join(', ') || 'Aucun'}

Sois concis, motivant et actionnable.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200
      });
      globalSummary = response.choices[0]?.message?.content || '';
    } catch (err) {
      console.error('[AGENT-MEMORY] Error generating AI summary:', err.message);
    }
  }

  if (!globalSummary) {
    globalSummary = `Bonjour ! Score santé global: ${globalHealthScore}/100. ` +
      (priorityActions.length > 0
        ? `${priorityActions.length} action(s) prioritaire(s) à traiter.`
        : 'Bonne journée à tous !');
  }

  // Sauvegarder le brief
  await pool.query(`
    INSERT INTO agent_morning_briefs (site, brief_date, global_summary, global_health_score, priority_actions, agent_reports)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (site, brief_date) DO UPDATE SET
      global_summary = EXCLUDED.global_summary,
      global_health_score = EXCLUDED.global_health_score,
      priority_actions = EXCLUDED.priority_actions,
      agent_reports = EXCLUDED.agent_reports,
      generated_at = NOW()
  `, [site, today, globalSummary, globalHealthScore, JSON.stringify(priorityActions), JSON.stringify(agentReports)]);

  return {
    date: today,
    global_summary: globalSummary,
    global_health_score: globalHealthScore,
    priority_actions: priorityActions,
    agent_reports: agentReports
  };
}

// ============================================================================
// MEMORY OPERATIONS
// ============================================================================

/**
 * Ajoute une entrée dans la mémoire d'un agent
 */
async function addAgentMemory(pool, site, agentType, memoryType, content, options = {}) {
  const { context = {}, importance = 5, expiresInDays = null, tags = [] } = options;

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
    : null;

  const result = await pool.query(`
    INSERT INTO agent_memory (site, agent_type, memory_type, content, context, importance, expires_at, tags)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [site, agentType, memoryType, content, JSON.stringify(context), importance, expiresAt, tags]);

  return result.rows[0]?.id;
}

/**
 * Récupère la mémoire d'un agent
 */
async function getAgentMemory(pool, site, agentType, options = {}) {
  const {
    memoryType = null,
    limit = 50,
    minImportance = 1,
    includeExpired = false,
    tags = []
  } = options;

  let query = `
    SELECT * FROM agent_memory
    WHERE site = $1
    AND agent_type = $2
    AND importance >= $3
  `;
  const params = [site, agentType, minImportance];
  let paramIndex = 4;

  if (!includeExpired) {
    query += ` AND (expires_at IS NULL OR expires_at > NOW())`;
  }

  if (memoryType) {
    query += ` AND memory_type = $${paramIndex}`;
    params.push(memoryType);
    paramIndex++;
  }

  if (tags.length > 0) {
    query += ` AND tags && $${paramIndex}`;
    params.push(tags);
    paramIndex++;
  }

  query += ` ORDER BY importance DESC, created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Récupère l'historique des snapshots d'un agent
 */
async function getAgentHistory(pool, site, agentType, days = 30) {
  const result = await pool.query(`
    SELECT * FROM agent_daily_snapshots
    WHERE site = $1 AND agent_type = $2
    AND snapshot_date >= CURRENT_DATE - INTERVAL '${days} days'
    ORDER BY snapshot_date DESC
  `, [site, agentType]);

  return result.rows;
}

// ============================================================================
// EXPRESS ROUTER
// ============================================================================

export function createAgentMemoryRouter(pool, openai = null) {
  const router = express.Router();

  // GET /api/agent-memory/snapshot/generate - Générer snapshots manuellement
  router.post('/snapshot/generate', async (req, res) => {
    try {
      const site = req.user?.site || req.body.site || 'default';
      const results = await generateAllDailySnapshots(pool, site);
      res.json({ ok: true, snapshots: results });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error generating snapshots:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/morning-brief - Brief du matin
  router.get('/morning-brief', async (req, res) => {
    try {
      const site = req.user?.site || req.query.site || 'default';

      // D'abord générer les snapshots si pas encore fait
      await generateAllDailySnapshots(pool, site);

      // Puis générer le brief
      const brief = await generateMorningBrief(pool, site, openai);
      res.json(brief);
    } catch (err) {
      console.error('[AGENT-MEMORY] Error generating morning brief:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/tour-de-table - Tour de table formaté pour l'UI
  router.get('/tour-de-table', async (req, res) => {
    try {
      const site = req.user?.site || req.query.site || 'default';
      const today = new Date().toISOString().split('T')[0];

      // Récupérer le brief existant ou le générer
      let briefResult = await pool.query(`
        SELECT * FROM agent_morning_briefs WHERE site = $1 AND brief_date = $2
      `, [site, today]);

      if (briefResult.rows.length === 0) {
        await generateAllDailySnapshots(pool, site);
        await generateMorningBrief(pool, site, openai);
        briefResult = await pool.query(`
          SELECT * FROM agent_morning_briefs WHERE site = $1 AND brief_date = $2
        `, [site, today]);
      }

      const brief = briefResult.rows[0];
      if (!brief) {
        return res.json({ agents: [], global: { summary: 'Aucun brief disponible', health_score: 100 } });
      }

      // Formater pour l'UI
      const agents = [];
      const reports = brief.agent_reports || {};

      for (const [type, report] of Object.entries(reports)) {
        agents.push({
          type,
          name: report.agent_name,
          domain: report.domain,
          health_score: report.health_score,
          health_trend: report.health_trend,
          message: report.summary.join(' ') + (report.issues.length > 0 ? ' ' + report.issues.join(' ') : ''),
          kpis: report.kpis
        });
      }

      res.json({
        date: brief.brief_date,
        global: {
          summary: brief.global_summary,
          health_score: brief.global_health_score,
          priority_actions: brief.priority_actions
        },
        agents: agents.sort((a, b) => a.health_score - b.health_score) // Plus mauvais en premier
      });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting tour de table:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/:agentType - Mémoire d'un agent
  router.get('/:agentType', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.query.site || 'default';
      const { type, limit = 50, importance = 1 } = req.query;

      const memories = await getAgentMemory(pool, site, agentType, {
        memoryType: type,
        limit: parseInt(limit),
        minImportance: parseInt(importance)
      });

      res.json({ memories });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting memory:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/:agentType/history - Historique snapshots
  router.get('/:agentType/history', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.query.site || 'default';
      const { days = 30 } = req.query;

      const history = await getAgentHistory(pool, site, agentType, parseInt(days));
      res.json({ history });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting history:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agent-memory/:agentType/learn - Agent apprend quelque chose
  router.post('/:agentType/learn', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.body.site || 'default';
      const { content, type = 'learning', importance = 5, context = {}, tags = [] } = req.body;

      if (!content) {
        return res.status(400).json({ error: 'Content required' });
      }

      const id = await addAgentMemory(pool, site, agentType, type, content, {
        context,
        importance,
        tags
      });

      res.json({ ok: true, id });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error adding memory:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/yesterday/troubleshooting - Dépannages d'hier
  router.get('/yesterday/troubleshooting', async (req, res) => {
    try {
      const site = req.user?.site || req.query.site || 'default';
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      const result = await pool.query(`
        SELECT
          tr.*,
          COALESCE(tr.equipment_name, 'Non spécifié') as equipment_name
        FROM troubleshooting_records tr
        WHERE tr.site = $1 AND DATE(tr.created_at) = $2
        ORDER BY tr.created_at DESC
      `, [site, yesterday]);

      // Grouper par type d'équipement
      const byType = {};
      for (const row of result.rows) {
        const type = row.equipment_type || 'other';
        if (!byType[type]) {
          byType[type] = [];
        }
        byType[type].push(row);
      }

      res.json({
        date: yesterday,
        total: result.rows.length,
        by_type: byType,
        records: result.rows
      });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting yesterday troubleshooting:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  generateAgentSnapshot,
  generateAllDailySnapshots,
  generateMorningBrief,
  addAgentMemory,
  getAgentMemory,
  getAgentHistory,
  AGENT_TYPES,
  AGENT_DOMAINS
};
