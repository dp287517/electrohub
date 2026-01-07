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
 * Génère les AI insights pour un snapshot
 */
async function generateAIInsights(openai, agentType, agentInfo, snapshot, recentTroubles) {
  if (!openai) {
    return { ai_summary: null, ai_insights: [], ai_recommendations: [] };
  }

  try {
    const prompt = `Tu es ${agentInfo.name}, l'agent IA responsable de ${agentInfo.description}.
Analyse les données suivantes et génère:
1. Un résumé en 2-3 phrases (ai_summary)
2. 2-4 insights clés (ai_insights) - observations importantes
3. 1-3 recommandations (ai_recommendations) - actions à prendre

Données du snapshot:
- Équipements totaux: ${snapshot.total_equipment}
- État: ${snapshot.equipment_ok} OK, ${snapshot.equipment_warning} attention, ${snapshot.equipment_critical} critiques
- Contrôles en retard: ${snapshot.controls_overdue}
- Contrôles prévus aujourd'hui: ${snapshot.controls_due_today}
- Contrôles cette semaine: ${snapshot.controls_due_week}
- Dépannages du jour: ${snapshot.troubleshooting_count} (${snapshot.troubleshooting_resolved} résolus, ${snapshot.troubleshooting_pending} en cours)
- Score santé: ${snapshot.health_score}/100

${recentTroubles.length > 0 ? `Dépannages récents:\n${recentTroubles.map(t => `- ${t.equipment_name}: ${t.root_cause || 'cause inconnue'}`).join('\n')}` : ''}

Réponds UNIQUEMENT en JSON valide avec ce format:
{
  "ai_summary": "résumé ici",
  "ai_insights": ["insight 1", "insight 2"],
  "ai_recommendations": ["reco 1", "reco 2"]
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3
    });

    const content = response.choices[0]?.message?.content || '';
    // Extraire le JSON de la réponse
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ai_summary: parsed.ai_summary || null,
        ai_insights: parsed.ai_insights || [],
        ai_recommendations: parsed.ai_recommendations || []
      };
    }
  } catch (err) {
    console.error(`[AGENT-MEMORY] Error generating AI insights for ${agentType}:`, err.message);
  }

  return { ai_summary: null, ai_insights: [], ai_recommendations: [] };
}

/**
 * Génère un snapshot quotidien pour un agent spécifique
 */
async function generateAgentSnapshot(pool, site, agentType, date = new Date(), openai = null) {
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

    // Récupérer les dépannages récents pour l'analyse IA
    let recentTroubles = [];
    try {
      const troublesResult = await pool.query(`
        SELECT equipment_name, root_cause, symptoms, solution, status
        FROM troubleshooting_records
        WHERE site = $1 AND equipment_type = $2
        AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 10
      `, [site, agentType]);
      recentTroubles = troublesResult.rows;
    } catch (e) {
      // Table peut ne pas exister
    }

    // Générer les AI insights
    const agentInfo = AGENT_DOMAINS[agentType] || { name: agentType, description: 'Agent' };
    const aiInsights = await generateAIInsights(openai, agentType, agentInfo, snapshot, recentTroubles);
    snapshot.ai_summary = aiInsights.ai_summary;
    snapshot.ai_insights = aiInsights.ai_insights;
    snapshot.ai_recommendations = aiInsights.ai_recommendations;

    // Sauvegarder le snapshot
    await pool.query(`
      INSERT INTO agent_daily_snapshots (
        site, snapshot_date, agent_type,
        total_equipment, equipment_ok, equipment_warning, equipment_critical,
        controls_overdue, controls_due_today, controls_due_week, controls_completed_today,
        troubleshooting_count, troubleshooting_resolved, troubleshooting_pending,
        nc_open, nc_closed_today, health_score, raw_data,
        ai_summary, ai_insights, ai_recommendations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
        raw_data = EXCLUDED.raw_data,
        ai_summary = EXCLUDED.ai_summary,
        ai_insights = EXCLUDED.ai_insights,
        ai_recommendations = EXCLUDED.ai_recommendations
    `, [
      site, dateStr, agentType,
      snapshot.total_equipment, snapshot.equipment_ok, snapshot.equipment_warning, snapshot.equipment_critical,
      snapshot.controls_overdue, snapshot.controls_due_today, snapshot.controls_due_week, snapshot.controls_completed_today,
      snapshot.troubleshooting_count, snapshot.troubleshooting_resolved, snapshot.troubleshooting_pending,
      snapshot.nc_open, snapshot.nc_closed_today, snapshot.health_score, JSON.stringify(snapshot.raw_data),
      aiInsights.ai_summary, JSON.stringify(aiInsights.ai_insights), JSON.stringify(aiInsights.ai_recommendations)
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
async function generateAllDailySnapshots(pool, site, date = new Date(), openai = null) {
  console.log(`[AGENT-MEMORY] Generating all daily snapshots for ${site}`);

  const results = {};
  for (const agentType of AGENT_TYPES) {
    if (agentType === 'main') continue; // Electro agrège les autres
    try {
      results[agentType] = await generateAgentSnapshot(pool, site, agentType, date, openai);
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
// INTER-AGENT COMMUNICATION
// ============================================================================

/**
 * Envoie un message d'un agent à un autre
 * @param {object} pool - Pool PostgreSQL
 * @param {string} site - Site ID
 * @param {string} fromAgent - Agent émetteur
 * @param {string} toAgent - Agent destinataire ('main' pour Electro, ou type d'agent)
 * @param {string} messageType - Type: 'alert', 'info', 'request', 'response', 'learning'
 * @param {string} subject - Sujet du message
 * @param {string} content - Contenu du message
 * @param {object} context - Contexte additionnel (équipement, dépannage, etc.)
 */
async function sendAgentMessage(pool, site, fromAgent, toAgent, messageType, subject, content, context = {}) {
  console.log(`[AGENT-COMM] ${fromAgent} -> ${toAgent}: ${subject}`);

  const result = await pool.query(`
    INSERT INTO agent_communications (site, from_agent, to_agent, message_type, subject, content, context)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, created_at
  `, [site, fromAgent, toAgent, messageType, subject, content, JSON.stringify(context)]);

  return result.rows[0];
}

/**
 * Broadcast un message à tous les agents (via Electro)
 */
async function broadcastMessage(pool, site, fromAgent, messageType, subject, content, context = {}) {
  // Envoyer à Electro qui redistribuera
  return sendAgentMessage(pool, site, fromAgent, 'main', messageType, subject, content, {
    ...context,
    broadcast: true
  });
}

/**
 * Récupère les messages non lus pour un agent
 */
async function getUnreadMessages(pool, site, agentType, options = {}) {
  const { limit = 20, messageTypes = null } = options;

  let query = `
    SELECT * FROM agent_communications
    WHERE site = $1 AND to_agent = $2 AND read_at IS NULL
  `;
  const params = [site, agentType];
  let paramIndex = 3;

  if (messageTypes && messageTypes.length > 0) {
    query += ` AND message_type = ANY($${paramIndex})`;
    params.push(messageTypes);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Récupère tous les messages pour un agent (lus et non lus)
 */
async function getAgentMessages(pool, site, agentType, options = {}) {
  const { limit = 50, since = null, includeRead = true, direction = 'both' } = options;

  let query = `
    SELECT * FROM agent_communications
    WHERE site = $1 AND (
  `;
  const params = [site];
  let paramIndex = 2;

  if (direction === 'incoming' || direction === 'both') {
    query += `to_agent = $${paramIndex}`;
    params.push(agentType);
    paramIndex++;
  }

  if (direction === 'both') {
    query += ` OR `;
  }

  if (direction === 'outgoing' || direction === 'both') {
    query += `from_agent = $${paramIndex}`;
    params.push(agentType);
    paramIndex++;
  }

  query += `)`;

  if (!includeRead) {
    query += ` AND read_at IS NULL`;
  }

  if (since) {
    query += ` AND created_at > $${paramIndex}`;
    params.push(since);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Marque un message comme lu
 */
async function markMessageRead(pool, messageId) {
  await pool.query(`
    UPDATE agent_communications SET read_at = NOW() WHERE id = $1
  `, [messageId]);
}

/**
 * Marque tous les messages d'un agent comme lus
 */
async function markAllMessagesRead(pool, site, agentType) {
  await pool.query(`
    UPDATE agent_communications
    SET read_at = NOW()
    WHERE site = $1 AND to_agent = $2 AND read_at IS NULL
  `, [site, agentType]);
}

/**
 * Récupère le résumé des communications pour Electro (vue globale)
 */
async function getElectroCommunicationsSummary(pool, site, hoursBack = 24) {
  const result = await pool.query(`
    SELECT
      from_agent,
      to_agent,
      message_type,
      COUNT(*) as count,
      COUNT(*) FILTER (WHERE read_at IS NULL) as unread_count,
      MAX(created_at) as last_message_at
    FROM agent_communications
    WHERE site = $1
    AND created_at > NOW() - INTERVAL '${hoursBack} hours'
    GROUP BY from_agent, to_agent, message_type
    ORDER BY last_message_at DESC
  `, [site]);

  // Récupérer les derniers messages importants
  const importantMessages = await pool.query(`
    SELECT * FROM agent_communications
    WHERE site = $1
    AND created_at > NOW() - INTERVAL '${hoursBack} hours'
    AND (message_type = 'alert' OR context->>'broadcast' = 'true')
    ORDER BY created_at DESC
    LIMIT 10
  `, [site]);

  return {
    summary: result.rows,
    important_messages: importantMessages.rows
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
// AUTOMATIC LEARNING FROM TROUBLESHOOTING
// ============================================================================

/**
 * Extrait et enregistre les patterns d'apprentissage d'un dépannage résolu
 * @param {object} pool - Pool PostgreSQL
 * @param {string} site - Site ID
 * @param {object} troubleshooting - Le dépannage résolu
 * @param {object} openai - Client OpenAI pour extraction intelligente (optionnel)
 */
async function learnFromTroubleshooting(pool, site, troubleshooting, openai = null) {
  const {
    id,
    equipment_type,
    equipment_name,
    symptoms,
    root_cause,
    solution,
    description,
    severity,
    duration_minutes
  } = troubleshooting;

  console.log(`[AGENT-LEARNING] Learning from troubleshooting #${id} for ${equipment_type}`);

  // Ne pas apprendre si pas assez d'informations
  if (!root_cause && !solution) {
    console.log(`[AGENT-LEARNING] Skipping #${id} - no root_cause or solution`);
    return null;
  }

  const agentType = equipment_type || 'main';
  const learnings = [];

  // 1. Pattern basique: cause -> solution
  if (root_cause && solution) {
    const basicPattern = {
      type: 'cause_solution',
      equipment_type: agentType,
      equipment_name,
      root_cause,
      solution,
      symptoms: symptoms || description?.substring(0, 200),
      severity,
      duration_minutes
    };

    const learningId = await addAgentMemory(pool, site, agentType, 'learning',
      `Dépannage résolu: ${root_cause} → ${solution}`,
      {
        context: basicPattern,
        importance: severity === 'critical' ? 9 : severity === 'high' ? 7 : 5,
        tags: ['troubleshooting', 'pattern', equipment_name?.toLowerCase()].filter(Boolean)
      }
    );
    learnings.push({ id: learningId, type: 'basic' });
  }

  // 2. Extraction IA de patterns avancés (si OpenAI disponible)
  if (openai && (root_cause || solution || description)) {
    try {
      const prompt = `Analyse ce dépannage et extrait des patterns d'apprentissage réutilisables.

Équipement: ${equipment_name || 'Non spécifié'} (${equipment_type})
Symptômes: ${symptoms || 'Non spécifiés'}
Description: ${description || 'Non spécifiée'}
Cause racine: ${root_cause || 'Non identifiée'}
Solution: ${solution || 'Non spécifiée'}
Durée: ${duration_minutes || 'Non spécifiée'} minutes
Sévérité: ${severity || 'medium'}

Génère un JSON avec:
1. "keywords": liste de mots-clés pour retrouver ce problème (max 5)
2. "diagnostic_hints": conseils pour diagnostiquer ce type de problème
3. "prevention_tips": conseils pour prévenir ce problème
4. "similar_issues": types de problèmes similaires à surveiller
5. "estimated_complexity": simple/moderate/complex

Réponds UNIQUEMENT en JSON valide.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const aiPattern = JSON.parse(jsonMatch[0]);

        // Stocker le pattern IA enrichi
        const aiLearningId = await addAgentMemory(pool, site, agentType, 'learning',
          `Pattern IA: ${aiPattern.diagnostic_hints || 'Diagnostic automatique'}`,
          {
            context: {
              ...aiPattern,
              source_troubleshooting_id: id,
              equipment_name,
              root_cause,
              solution
            },
            importance: 6,
            tags: ['ai_extracted', 'pattern', ...(aiPattern.keywords || [])].slice(0, 10)
          }
        );
        learnings.push({ id: aiLearningId, type: 'ai_enriched' });
      }
    } catch (err) {
      console.error(`[AGENT-LEARNING] AI extraction error:`, err.message);
    }
  }

  // 3. Envoyer un message à Electro pour signaler l'apprentissage
  if (learnings.length > 0) {
    await sendAgentMessage(pool, site, agentType, 'main', 'learning',
      `Nouvel apprentissage: ${equipment_name || equipment_type}`,
      `J'ai appris de la résolution du dépannage #${id}. Cause: ${root_cause || 'N/A'}. Solution: ${solution || 'N/A'}.`,
      { troubleshooting_id: id, learnings }
    );
  }

  return learnings;
}

/**
 * Recherche des patterns similaires pour aider au diagnostic
 */
async function findSimilarPatterns(pool, site, agentType, searchTerms, options = {}) {
  const { limit = 5, minImportance = 3 } = options;

  // Normaliser les termes de recherche
  const terms = searchTerms.toLowerCase().split(/\s+/).filter(t => t.length >= 2);

  if (terms.length === 0) {
    return [];
  }

  // Recherche par tags et contenu
  const result = await pool.query(`
    SELECT id, content, context, importance, tags, created_at
    FROM agent_memory
    WHERE site = $1
    AND agent_type = $2
    AND memory_type = 'learning'
    AND importance >= $3
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      -- Recherche par tags
      tags && $4::text[]
      OR
      -- Recherche dans le contenu
      LOWER(content) LIKE ANY($5)
      OR
      -- Recherche dans le contexte JSON
      LOWER(context::text) LIKE ANY($5)
    )
    ORDER BY importance DESC, created_at DESC
    LIMIT $6
  `, [
    site,
    agentType,
    minImportance,
    terms,
    terms.map(t => `%${t}%`),
    limit
  ]);

  return result.rows.map(row => ({
    id: row.id,
    learning: row.content,
    context: row.context,
    importance: row.importance,
    tags: row.tags,
    learned_at: row.created_at
  }));
}

/**
 * Scan les dépannages récemment résolus et apprend de ceux non encore traités
 */
async function processUnlearnedTroubleshooting(pool, site, openai = null) {
  console.log(`[AGENT-LEARNING] Processing unlearned troubleshooting for ${site}`);

  // Récupérer les dépannages résolus des 7 derniers jours
  // qui ont une cause racine et/ou une solution
  const result = await pool.query(`
    SELECT tr.id, tr.equipment_type, tr.equipment_name, tr.title, tr.description,
           tr.symptoms, tr.root_cause, tr.solution, tr.severity, tr.duration_minutes,
           tr.completed_at
    FROM troubleshooting_records tr
    WHERE tr.site = $1
    AND tr.status = 'resolved'
    AND tr.completed_at > NOW() - INTERVAL '7 days'
    AND (tr.root_cause IS NOT NULL OR tr.solution IS NOT NULL)
    AND NOT EXISTS (
      -- Vérifier si on a déjà appris de ce dépannage
      SELECT 1 FROM agent_memory am
      WHERE am.site = $1
      AND am.memory_type = 'learning'
      AND am.context->>'source_troubleshooting_id' = tr.id::text
    )
    ORDER BY tr.completed_at DESC
    LIMIT 20
  `, [site]);

  console.log(`[AGENT-LEARNING] Found ${result.rows.length} unlearned troubleshooting records`);

  const learningsCreated = [];

  for (const troubleshooting of result.rows) {
    try {
      const learnings = await learnFromTroubleshooting(pool, site, troubleshooting, openai);
      if (learnings && learnings.length > 0) {
        learningsCreated.push({
          troubleshooting_id: troubleshooting.id,
          equipment: troubleshooting.equipment_name,
          learnings_count: learnings.length
        });
      }
    } catch (err) {
      console.error(`[AGENT-LEARNING] Error learning from #${troubleshooting.id}:`, err.message);
    }
  }

  return {
    processed: result.rows.length,
    learnings_created: learningsCreated.length,
    details: learningsCreated
  };
}

/**
 * Suggestion de diagnostic basée sur les apprentissages
 */
async function suggestDiagnostic(pool, site, agentType, symptoms, openai = null) {
  // 1. Rechercher des patterns similaires
  const patterns = await findSimilarPatterns(pool, site, agentType, symptoms, { limit: 5 });

  if (patterns.length === 0) {
    return {
      found_patterns: false,
      suggestion: "Aucun pattern similaire trouvé dans l'historique.",
      patterns: []
    };
  }

  // 2. Si OpenAI disponible, générer une suggestion intelligente
  let aiSuggestion = null;

  if (openai && patterns.length > 0) {
    try {
      const patternsText = patterns.map((p, i) =>
        `${i + 1}. ${p.learning}\n   Contexte: ${JSON.stringify(p.context)}`
      ).join('\n\n');

      const prompt = `En tant qu'expert maintenance, analyse ces symptômes et patterns historiques pour suggérer un diagnostic.

Symptômes actuels: ${symptoms}

Patterns similaires trouvés:
${patternsText}

Génère une suggestion de diagnostic en 2-3 phrases, en indiquant:
1. La cause probable basée sur l'historique
2. La solution recommandée
3. Les points à vérifier en priorité

Sois concis et actionnable.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.3
      });

      aiSuggestion = response.choices[0]?.message?.content || null;
    } catch (err) {
      console.error(`[AGENT-LEARNING] AI suggestion error:`, err.message);
    }
  }

  return {
    found_patterns: true,
    patterns_count: patterns.length,
    patterns: patterns,
    ai_suggestion: aiSuggestion,
    suggestion: aiSuggestion || `${patterns.length} pattern(s) similaire(s) trouvé(s) dans l'historique.`
  };
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
      const results = await generateAllDailySnapshots(pool, site, new Date(), openai);
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

      // D'abord générer les snapshots si pas encore fait (avec AI insights)
      await generateAllDailySnapshots(pool, site, new Date(), openai);

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
        await generateAllDailySnapshots(pool, site, new Date(), openai);
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

  // ============================================================================
  // INTER-AGENT COMMUNICATION ROUTES
  // ============================================================================

  // POST /api/agent-memory/comm/send - Envoyer un message entre agents
  router.post('/comm/send', async (req, res) => {
    try {
      const site = req.user?.site || req.body.site || 'default';
      const { from_agent, to_agent, message_type, subject, content, context = {} } = req.body;

      if (!from_agent || !to_agent || !subject || !content) {
        return res.status(400).json({ error: 'Missing required fields: from_agent, to_agent, subject, content' });
      }

      const result = await sendAgentMessage(pool, site, from_agent, to_agent, message_type || 'info', subject, content, context);
      res.json({ ok: true, message: result });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error sending message:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agent-memory/comm/broadcast - Broadcast un message à tous les agents
  router.post('/comm/broadcast', async (req, res) => {
    try {
      const site = req.user?.site || req.body.site || 'default';
      const { from_agent, message_type, subject, content, context = {} } = req.body;

      if (!from_agent || !subject || !content) {
        return res.status(400).json({ error: 'Missing required fields: from_agent, subject, content' });
      }

      const result = await broadcastMessage(pool, site, from_agent, message_type || 'info', subject, content, context);
      res.json({ ok: true, message: result });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error broadcasting message:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/comm/:agentType/unread - Messages non lus pour un agent
  router.get('/comm/:agentType/unread', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.query.site || 'default';
      const { limit = 20 } = req.query;

      const messages = await getUnreadMessages(pool, site, agentType, { limit: parseInt(limit) });
      res.json({ messages, count: messages.length });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting unread messages:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/comm/:agentType/all - Tous les messages pour un agent
  router.get('/comm/:agentType/all', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.query.site || 'default';
      const { limit = 50, direction = 'both', include_read = 'true' } = req.query;

      const messages = await getAgentMessages(pool, site, agentType, {
        limit: parseInt(limit),
        direction,
        includeRead: include_read === 'true'
      });
      res.json({ messages, count: messages.length });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting messages:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agent-memory/comm/:messageId/read - Marquer un message comme lu
  router.post('/comm/:messageId/read', async (req, res) => {
    try {
      const { messageId } = req.params;
      await markMessageRead(pool, messageId);
      res.json({ ok: true });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error marking message read:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agent-memory/comm/:agentType/read-all - Marquer tous les messages comme lus
  router.post('/comm/:agentType/read-all', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.body.site || 'default';
      await markAllMessagesRead(pool, site, agentType);
      res.json({ ok: true });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error marking all messages read:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/comm/electro/summary - Résumé des communications pour Electro
  router.get('/comm/electro/summary', async (req, res) => {
    try {
      const site = req.user?.site || req.query.site || 'default';
      const { hours = 24 } = req.query;

      const summary = await getElectroCommunicationsSummary(pool, site, parseInt(hours));
      res.json(summary);
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting Electro summary:', err);
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

  // ============================================================================
  // LEARNING ROUTES
  // ============================================================================

  // POST /api/agent-memory/learning/process - Traiter les dépannages non encore appris
  router.post('/learning/process', async (req, res) => {
    try {
      const site = req.user?.site || req.body.site || 'default';
      const result = await processUnlearnedTroubleshooting(pool, site, openai);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error processing unlearned troubleshooting:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agent-memory/learning/from-troubleshooting/:id - Apprendre d'un dépannage spécifique
  router.post('/learning/from-troubleshooting/:id', async (req, res) => {
    try {
      const site = req.user?.site || req.body.site || 'default';
      const { id } = req.params;

      // Récupérer le dépannage
      const troubleResult = await pool.query(`
        SELECT * FROM troubleshooting_records WHERE site = $1 AND id = $2
      `, [site, id]);

      if (troubleResult.rows.length === 0) {
        return res.status(404).json({ error: `Troubleshooting #${id} not found` });
      }

      const learnings = await learnFromTroubleshooting(pool, site, troubleResult.rows[0], openai);
      res.json({ ok: true, troubleshooting_id: id, learnings });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error learning from troubleshooting:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/learning/:agentType/patterns - Obtenir les patterns appris d'un agent
  router.get('/learning/:agentType/patterns', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.query.site || 'default';
      const { limit = 20, search } = req.query;

      let patterns;
      if (search) {
        patterns = await findSimilarPatterns(pool, site, agentType, search, { limit: parseInt(limit) });
      } else {
        // Retourner tous les patterns récents
        patterns = await getAgentMemory(pool, site, agentType, {
          memoryType: 'learning',
          limit: parseInt(limit)
        });
      }

      res.json({ patterns, count: patterns.length });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting patterns:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agent-memory/learning/:agentType/diagnose - Suggérer un diagnostic basé sur les apprentissages
  router.post('/learning/:agentType/diagnose', async (req, res) => {
    try {
      const { agentType } = req.params;
      const site = req.user?.site || req.body.site || 'default';
      const { symptoms } = req.body;

      if (!symptoms) {
        return res.status(400).json({ error: 'symptoms is required' });
      }

      const suggestion = await suggestDiagnostic(pool, site, agentType, symptoms, openai);
      res.json(suggestion);
    } catch (err) {
      console.error('[AGENT-MEMORY] Error suggesting diagnostic:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agent-memory/learning/stats - Statistiques globales d'apprentissage
  router.get('/learning/stats', async (req, res) => {
    try {
      const site = req.user?.site || req.query.site || 'default';

      const result = await pool.query(`
        SELECT
          agent_type,
          COUNT(*) as total_learnings,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as learnings_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as learnings_30d,
          AVG(importance)::numeric(3,1) as avg_importance
        FROM agent_memory
        WHERE site = $1 AND memory_type = 'learning'
        GROUP BY agent_type
        ORDER BY total_learnings DESC
      `, [site]);

      const totalResult = await pool.query(`
        SELECT COUNT(*) as total FROM agent_memory
        WHERE site = $1 AND memory_type = 'learning'
      `, [site]);

      res.json({
        total_learnings: parseInt(totalResult.rows[0]?.total || 0),
        by_agent: result.rows
      });
    } catch (err) {
      console.error('[AGENT-MEMORY] Error getting learning stats:', err);
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
  sendAgentMessage,
  broadcastMessage,
  getUnreadMessages,
  getAgentMessages,
  markMessageRead,
  markAllMessagesRead,
  getElectroCommunicationsSummary,
  learnFromTroubleshooting,
  findSimilarPatterns,
  processUnlearnedTroubleshooting,
  suggestDiagnostic,
  AGENT_TYPES,
  AGENT_DOMAINS
};
