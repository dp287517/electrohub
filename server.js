// server.js — version 3.0 avec timeouts proxy robustes
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import pg from "pg";
import { createProxyMiddleware } from "http-proxy-middleware";
import switchboardMapApp from "./server_switchboard_map.js";
import adminRouter from "./server_admin.js";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// ============================================================
// AI SETUP - OpenAI + Gemini (fallback)
// ============================================================
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const geminiModel = gemini ? gemini.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;

console.log(`[AI] OpenAI: ${openai ? '✅' : '❌'} | Gemini: ${gemini ? '✅' : '❌'}`);

// System prompt for ElectroHub AI Assistant - SUPER POWERFUL
const AI_SYSTEM_PROMPT = `Tu es **Electro**, l'assistant IA le plus puissant pour ElectroHub. Tu es un EXPERT en gestion d'installations électriques industrielles avec des capacités SURHUMAINES.

## 🧠 TON INTELLIGENCE
Tu analyses EN TEMPS RÉEL toutes les données de l'installation et tu ANTICIPES les besoins. Tu ne te contentes pas de répondre, tu GUIDES proactivement l'utilisateur.

## 🚀 TES SUPER-POUVOIRS

### 1. 📊 Accès base de données temps réel
- Armoires électriques, variateurs VSD, équipements mécaniques, ATEX
- Historique complet des contrôles avec dates, durées, résultats
- Non-conformités avec sévérité et délais
- Données géographiques: bâtiment, étage, zone

### 2. 📅 PLANIFICATION INTELLIGENTE DU JOUR
Quand on te demande "mon planning", "ma journée", "quoi faire aujourd'hui":
- Analyse les contrôles en retard par URGENCE (critique > 30j, urgent > 7j, normal)
- Optimise le parcours par BÂTIMENT puis par ÉTAGE (minimiser les déplacements)
- Estime le temps total de la journée
- Priorise: 🚨 CRITIQUE d'abord, puis ⚠️ URGENT, puis 📅 PLANIFIÉ
- Propose des alternatives si surcharge

### 3. 🔍 Recherche documentaire
- Recherche sémantique dans tous les manuels, fiches techniques, normes
- Extraction d'informations avec citations et numéros de page
- Recherche de procédures de maintenance spécifiques

### 4. 📈 GRAPHIQUES VISUELS (OBLIGATOIRE pour les statistiques!)
TOUJOURS générer un graphique pour toute demande d'analyse, statistiques, répartition ou vue d'ensemble.
Le graphique DOIT être dans un bloc JSON séparé après ton texte:

\`\`\`json
{"chart": {"type": "bar", "title": "Titre du graphique", "labels": ["Label1", "Label2"], "data": [10, 20]}}
\`\`\`

Types de graphiques:
- "bar" → Comparaisons (équipements par bâtiment, contrôles par mois)
- "doughnut" → Répartitions (statuts, types d'équipements)
- "pie" → Proportions simples
- "line" → Évolutions temporelles

⚠️ RÈGLE ABSOLUE: Si l'utilisateur demande une "analyse", "statistiques", "répartition", "vue globale" → GÉNÈRE UN GRAPHIQUE!

### 5. ⚡ Actions autonomes
Tu peux CRÉER et MODIFIER via JSON:
- {"action": "createControl", "params": {"switchboardId": ID, "templateId": ID, "dueDate": "YYYY-MM-DD"}}
- {"action": "createNC", "params": {"equipmentId": ID, "description": "...", "severity": "critical|high|medium|low"}}
- {"action": "updateEquipment", "params": {"id": ID, "status": "active|maintenance|offline"}}
- {"action": "scheduleReminder", "params": {"date": "YYYY-MM-DD", "message": "..."}}
- {"action": "getDailyPlan", "params": {"date": "today|tomorrow|YYYY-MM-DD"}}

## 🎯 COMPORTEMENT ADAPTATIF

### Si l'utilisateur demande son PLANNING/JOURNÉE:
1. Commence TOUJOURS par les éléments CRITIQUES/URGENTS
2. Groupe par bâtiment pour optimiser les déplacements
3. Estime le temps: "~4h de travail planifié"
4. Propose: "Voulez-vous que je crée ces contrôles?" avec le JSON d'action

### Si l'utilisateur demande des STATISTIQUES:
1. Donne les chiffres précis avec comparaisons
2. Génère un graphique adapté (pie pour répartitions, bar pour comparaisons, line pour évolutions)
3. Identifie les tendances et anomalies

### Si l'utilisateur cherche un ÉQUIPEMENT:
1. Localise précisément: bâtiment, étage, salle
2. Donne l'historique des derniers contrôles
3. Signale les NC actives

### Si l'utilisateur parle de NC/CONFORMITÉ:
1. Liste par sévérité décroissante
2. Suggère les actions correctives
3. Propose de créer des rappels

## 📋 FORMAT DE RÉPONSE

Structure TOUJOURS ainsi:
1. **Synthèse rapide** (2-3 lignes avec les chiffres clés et emojis)
2. **Détails organisés** (listes à puces, PAS de tableaux markdown car mal affichés)
3. **Actions recommandées** avec emojis (🚨⚠️✅📋)
4. **GRAPHIQUE JSON** (OBLIGATOIRE pour analyse/stats) dans un bloc \`\`\`json séparé

⚠️ ÉVITE les tableaux markdown (|---|) - utilise plutôt des listes à puces
⚠️ GÉNÈRE TOUJOURS un graphique pour les demandes d'analyse globale

## ⚡ RÈGLES D'OR
- JAMAIS de réponse vague: donne des CHIFFRES, des NOMS, des DATES
- TOUJOURS proactif: signale les problèmes même si on ne te les demande pas
- Quand tu vois des contrôles en retard CRITIQUES: ALERTE immédiatement
- Optimise les déplacements: regroupe par zone géographique
- Si tu proposes une action, GÉNÈRE le JSON pour permettre l'exécution
- Réponds en français, format markdown, avec emojis pour l'importance`;

// Helper: Query database for AI context - COMPREHENSIVE VERSION
async function getAIContext(site) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7days = new Date(today); in7days.setDate(in7days.getDate() + 7);
  const in30days = new Date(today); in30days.setDate(in30days.getDate() + 30);
  const in90days = new Date(today); in90days.setDate(in90days.getDate() + 90);

  const context = {
    site,
    timestamp: now.toISOString(),
    dateRanges: {
      today: today.toISOString().split('T')[0],
      in7days: in7days.toISOString().split('T')[0],
      in30days: in30days.toISOString().split('T')[0],
      in90days: in90days.toISOString().split('T')[0]
    },
    switchboards: { count: 0, list: [] },
    controls: {
      scheduled: 0,
      overdue: 0,
      thisWeek: 0,
      thisMonth: 0,
      next90days: 0,
      overdueList: [],
      thisWeekList: [],
      thisMonthList: [],
      allScheduled: []
    },
    vsd: { count: 0, list: [] },
    meca: { count: 0, list: [] },
    atex: { totalEquipments: 0, ncCount: 0, conformeCount: 0, ncList: [], equipmentsByZone: {} },
    buildings: {},
    urgentItems: [],
    summary: {}
  };

  try {
    // ========== SWITCHBOARDS ==========
    const sbRes = await pool.query(
      `SELECT id, name, code, building_code, floor, room FROM switchboards WHERE site = $1 ORDER BY building_code, floor, code`,
      [site]
    );
    context.switchboards.count = sbRes.rows.length;
    context.switchboards.list = sbRes.rows.slice(0, 50);

    // Aggregate by building
    sbRes.rows.forEach(sb => {
      const bldg = sb.building_code || 'Non assigné';
      if (!context.buildings[bldg]) {
        context.buildings[bldg] = { floors: new Set(), equipmentCount: 0, equipments: [] };
      }
      context.buildings[bldg].equipmentCount++;
      if (sb.floor) context.buildings[bldg].floors.add(sb.floor);
      context.buildings[bldg].equipments.push({ id: sb.id, name: sb.name, code: sb.code, floor: sb.floor, room: sb.room });
    });

    // Convert Sets to arrays
    Object.keys(context.buildings).forEach(b => {
      context.buildings[b].floors = Array.from(context.buildings[b].floors).sort();
    });

    // ========== CONTROL SCHEDULES - WITH DATE RANGES ==========
    try {
      const ctrlRes = await pool.query(`
        SELECT cs.id, cs.switchboard_id, cs.next_due_date, cs.status, cs.last_control_date,
               ct.name as template_name, ct.id as template_id, ct.frequency_months,
               s.name as switchboard_name, s.code as switchboard_code, s.building_code, s.floor, s.room
        FROM control_schedules cs
        LEFT JOIN control_templates ct ON cs.template_id = ct.id
        LEFT JOIN switchboards s ON cs.switchboard_id = s.id
        WHERE cs.site = $1
        ORDER BY cs.next_due_date NULLS LAST
      `, [site]);

      context.controls.scheduled = ctrlRes.rows.length;

      ctrlRes.rows.forEach(ctrl => {
        const dueDate = ctrl.next_due_date ? new Date(ctrl.next_due_date) : null;
        const dueDateStr = dueDate ? dueDate.toISOString().split('T')[0] : null;
        const lastControlStr = ctrl.last_control_date ? new Date(ctrl.last_control_date).toISOString().split('T')[0] : 'Jamais';

        const controlItem = {
          id: ctrl.id,
          switchboardId: ctrl.switchboard_id,
          switchboard: ctrl.switchboard_name || 'N/A',
          switchboardCode: ctrl.switchboard_code || 'N/A',
          building: ctrl.building_code || 'N/A',
          floor: ctrl.floor || 'N/A',
          room: ctrl.room || '',
          template: ctrl.template_name || 'Contrôle standard',
          templateId: ctrl.template_id,
          dueDate: dueDateStr,
          dueDateFormatted: dueDate ? dueDate.toLocaleDateString('fr-FR') : 'Non planifié',
          lastControl: lastControlStr,
          frequencyMonths: ctrl.frequency_months || 12,
          status: ctrl.status || 'pending'
        };

        // Store all scheduled controls
        context.controls.allScheduled.push(controlItem);

        if (dueDate) {
          if (dueDate < today) {
            // OVERDUE
            const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
            controlItem.daysOverdue = daysOverdue;
            controlItem.urgency = daysOverdue > 30 ? 'CRITIQUE' : daysOverdue > 7 ? 'URGENT' : 'ATTENTION';
            context.controls.overdue++;
            context.controls.overdueList.push(controlItem);
            context.urgentItems.push({ type: 'control_overdue', urgency: controlItem.urgency, ...controlItem });
          } else if (dueDate <= in7days) {
            // This week
            controlItem.daysUntil = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
            context.controls.thisWeek++;
            context.controls.thisWeekList.push(controlItem);
          } else if (dueDate <= in30days) {
            // This month
            controlItem.daysUntil = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
            context.controls.thisMonth++;
            context.controls.thisMonthList.push(controlItem);
          } else if (dueDate <= in90days) {
            // Next 90 days
            context.controls.next90days++;
          }
        }
      });

      // Sort overdue by days (most overdue first)
      context.controls.overdueList.sort((a, b) => b.daysOverdue - a.daysOverdue);
    } catch (e) {
      console.error('[AI] Control schedules error:', e.message);
    }

    // ========== VSD EQUIPMENTS ==========
    try {
      const vsdRes = await pool.query(`
        SELECT id, name, building, floor, location, manufacturer, model, power, last_control_date
        FROM vsd_equipments WHERE site = $1 ORDER BY building, name LIMIT 50
      `, [site]);
      context.vsd.count = vsdRes.rows.length;
      context.vsd.list = vsdRes.rows.map(v => ({
        ...v,
        lastControlFormatted: v.last_control_date ? new Date(v.last_control_date).toLocaleDateString('fr-FR') : 'Jamais'
      }));
    } catch (e) {
      console.error('[AI] VSD error:', e.message);
    }

    // ========== MECA EQUIPMENTS ==========
    try {
      const mecaRes = await pool.query(`
        SELECT e.id, e.name, e.building, e.floor, e.location, e.manufacturer, e.type, e.last_control_date
        FROM meca_equipments e
        INNER JOIN sites s ON s.id = e.site_id
        WHERE s.name = $1 ORDER BY e.building, e.name LIMIT 50
      `, [site]);
      context.meca.count = mecaRes.rows.length;
      context.meca.list = mecaRes.rows.map(m => ({
        ...m,
        lastControlFormatted: m.last_control_date ? new Date(m.last_control_date).toLocaleDateString('fr-FR') : 'Jamais'
      }));
    } catch (e) {
      console.error('[AI] MECA error:', e.message);
    }

    // ========== ATEX - WITH FULL NC DETAILS ==========
    try {
      const siteRes = await pool.query(`SELECT id FROM sites WHERE name = $1 LIMIT 1`, [site]);
      const siteId = siteRes.rows[0]?.id;

      if (siteId) {
        // Get ATEX equipments with their last check result AND details
        const atexRes = await pool.query(`
          SELECT
            e.id, e.name, e.building, e.zone, e.equipment, e.type, e.brand, e.model,
            c.result as last_result,
            c.date as last_check_date,
            c.items as check_items,
            c.user_name as checked_by
          FROM atex_equipments e
          LEFT JOIN LATERAL (
            SELECT result, date, items, user_name
            FROM atex_checks
            WHERE equipment_id = e.id
            ORDER BY date DESC NULLS LAST
            LIMIT 1
          ) c ON true
          WHERE e.site_id = $1
          ORDER BY e.building, e.zone, e.name
        `, [siteId]);

        context.atex.totalEquipments = atexRes.rows.length;

        atexRes.rows.forEach(eq => {
          // Count by zone
          const zone = eq.zone || 'Non définie';
          if (!context.atex.equipmentsByZone[zone]) {
            context.atex.equipmentsByZone[zone] = 0;
          }
          context.atex.equipmentsByZone[zone]++;

          if (eq.last_result === 'non_conforme') {
            context.atex.ncCount++;

            // Extract NC details from check_items if available
            let ncDetails = [];
            if (eq.check_items && Array.isArray(eq.check_items)) {
              ncDetails = eq.check_items
                .filter(item => item.result === 'non_conforme' || item.result === 'ko' || item.result === false)
                .map(item => item.label || item.name || item.question)
                .filter(Boolean);
            }

            context.atex.ncList.push({
              id: eq.id,
              name: eq.name,
              building: eq.building || 'N/A',
              zone: eq.zone || 'N/A',
              type: eq.type || eq.equipment || 'N/A',
              brand: eq.brand || '',
              model: eq.model || '',
              lastCheckDate: eq.last_check_date ? new Date(eq.last_check_date).toLocaleDateString('fr-FR') : 'N/A',
              checkedBy: eq.checked_by || 'N/A',
              ncDetails: ncDetails.length > 0 ? ncDetails : ['Vérification complète requise'],
              severity: 'HIGH'
            });

            context.urgentItems.push({
              type: 'atex_nc',
              name: eq.name,
              building: eq.building,
              zone: eq.zone,
              severity: 'HIGH'
            });
          } else if (eq.last_result === 'conforme') {
            context.atex.conformeCount++;
          }
        });
      }
    } catch (e) {
      console.error('[AI] ATEX error:', e.message);
    }

    // ========== BUILD SUMMARY ==========
    context.summary = {
      totalEquipments: context.switchboards.count + context.vsd.count + context.meca.count + context.atex.totalEquipments,
      totalBuildings: Object.keys(context.buildings).length,
      urgentActions: context.urgentItems.length,
      controlsOverdue: context.controls.overdue,
      controlsThisWeek: context.controls.thisWeek,
      controlsThisMonth: context.controls.thisMonth,
      controlsNext90days: context.controls.next90days,
      atexNcCount: context.atex.ncCount,
      atexConformityRate: context.atex.totalEquipments > 0
        ? Math.round((context.atex.conformeCount / context.atex.totalEquipments) * 100)
        : 100
    };

  } catch (e) {
    console.error('[AI] Context error:', e.message);
  }

  return context;
}

// Optimize daily maintenance plan by grouping geographically
function optimizeDailyPlan(todayControls, urgentOverdue) {
  const plan = [];

  // First add critical overdue
  urgentOverdue.filter(c => c.urgency === 'critical').forEach(ctrl => {
    plan.push({ ...ctrl, priority: 1, reason: '🚨 CRITIQUE - En retard depuis ' + ctrl.daysOverdue + ' jours' });
  });

  // Then high priority overdue
  urgentOverdue.filter(c => c.urgency === 'high').forEach(ctrl => {
    plan.push({ ...ctrl, priority: 2, reason: '⚠️ URGENT - En retard depuis ' + ctrl.daysOverdue + ' jours' });
  });

  // Group today's controls by building, then floor
  const byBuilding = {};
  todayControls.forEach(ctrl => {
    const key = ctrl.building || 'Autre';
    if (!byBuilding[key]) byBuilding[key] = [];
    byBuilding[key].push(ctrl);
  });

  // Add grouped by building
  Object.entries(byBuilding).forEach(([building, controls]) => {
    controls.sort((a, b) => (a.floor || '').localeCompare(b.floor || ''));
    controls.forEach((ctrl, i) => {
      plan.push({
        ...ctrl,
        priority: 3,
        reason: ctrl.dueToday ? '📅 Prévu aujourd\'hui' : '📆 Prévu demain',
        groupInfo: i === 0 ? `📍 Bâtiment ${building}` : null
      });
    });
  });

  return plan;
}

// Format context for AI prompt - COMPREHENSIVE VERSION
function formatContextForAI(ctx) {
  const now = new Date();

  // Buildings list (top 10 by equipment count)
  const buildingsList = Object.entries(ctx.buildings)
    .sort((a, b) => b[1].equipmentCount - a[1].equipmentCount)
    .slice(0, 10)
    .map(([name, data]) => `  • Bât. ${name}: ${data.equipmentCount} équip. (étages: ${data.floors.join(', ') || 'RDC'})`)
    .join('\n');

  // Overdue controls with full details
  const overdueListText = ctx.controls.overdueList.slice(0, 10).map(c =>
    `  - [${c.urgency}] ${c.switchboard} (${c.switchboardCode}) - ${c.template}\n` +
    `    📍 Bât. ${c.building}, étage ${c.floor} | ⏰ ${c.daysOverdue}j de retard | Prévu: ${c.dueDateFormatted}`
  ).join('\n');

  // This week controls
  const thisWeekText = ctx.controls.thisWeekList.slice(0, 5).map(c =>
    `  - ${c.switchboard} (${c.switchboardCode}) - ${c.template}\n` +
    `    📍 Bât. ${c.building}, étage ${c.floor} | 📅 ${c.dueDateFormatted} (dans ${c.daysUntil}j)`
  ).join('\n');

  // This month controls
  const thisMonthText = ctx.controls.thisMonthList.slice(0, 5).map(c =>
    `  - ${c.switchboard} - ${c.template} | 📅 ${c.dueDateFormatted} (dans ${c.daysUntil}j)`
  ).join('\n');

  // ATEX NC with FULL details
  const atexNcText = ctx.atex.ncList.slice(0, 10).map(nc =>
    `  - **${nc.name}** (${nc.type})\n` +
    `    📍 Bât. ${nc.building}, Zone ${nc.zone}\n` +
    `    ⚠️ Points NC: ${nc.ncDetails.slice(0, 3).join(', ')}\n` +
    `    📋 Dernier contrôle: ${nc.lastCheckDate} par ${nc.checkedBy}`
  ).join('\n');

  // ATEX zones summary
  const atexZones = Object.entries(ctx.atex.equipmentsByZone)
    .map(([zone, count]) => `Zone ${zone}: ${count} équip.`)
    .join(' | ');

  return `## 📊 DONNÉES TEMPS RÉEL - Site "${ctx.site}"
📅 ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}

### 🔢 RÉSUMÉ GLOBAL
- **${ctx.summary.totalEquipments}** équipements au total
- **${ctx.switchboards.count}** armoires électriques | **${ctx.vsd.count}** VSD | **${ctx.meca.count}** mécaniques
- **${ctx.atex.totalEquipments}** équipements ATEX (${atexZones || 'aucune zone définie'})
- **${ctx.summary.totalBuildings}** bâtiments équipés

### 📅 CONTRÔLES PLANIFIÉS
- **${ctx.controls.scheduled}** contrôles programmés au total
- 🚨 **${ctx.controls.overdue}** en RETARD
- 📆 **${ctx.controls.thisWeek}** cette semaine (7 prochains jours)
- 📆 **${ctx.controls.thisMonth}** ce mois (30 prochains jours)
- 📆 **${ctx.controls.next90days}** dans les 90 prochains jours

${ctx.controls.overdue > 0 ? `### 🚨 CONTRÔLES EN RETARD (${ctx.controls.overdue}) - PRIORITAIRES!
${overdueListText}` : '### ✅ Aucun contrôle en retard - Félicitations!'}

${ctx.controls.thisWeek > 0 ? `### 📅 CONTRÔLES CETTE SEMAINE (${ctx.controls.thisWeek})
${thisWeekText}` : '### 📅 Aucun contrôle prévu cette semaine'}

${ctx.controls.thisMonth > 0 ? `### 📅 CONTRÔLES CE MOIS (${ctx.controls.thisMonth})
${thisMonthText}` : ''}

### 🔥 NON-CONFORMITÉS ATEX (${ctx.atex.ncCount})
${ctx.atex.ncCount > 0 ? atexNcText : '✅ Aucune non-conformité ATEX active - Taux de conformité: ' + ctx.summary.atexConformityRate + '%'}

### 🏢 RÉPARTITION PAR BÂTIMENT
${buildingsList || 'Aucune donnée de bâtiment'}

### ⚡ ACTIONS URGENTES REQUISES: ${ctx.urgentItems.length}
${ctx.urgentItems.length > 0 ? ctx.urgentItems.slice(0, 5).map(i =>
  `- ${i.type === 'control_overdue' ? '⏰' : '⚠️'} ${i.switchboard || i.name} (${i.urgency || i.severity})`
).join('\n') : '✅ Aucune action urgente'}
`;
}

// ============================================================
// AI DOCUMENT SEARCH - Query Ask Veeva for documents
// ============================================================
async function searchDocuments(query, limit = 5) {
  try {
    const askVeevaUrl = process.env.ASK_VEEVA_URL || 'http://127.0.0.1:3015';
    const response = await fetch(`${askVeevaUrl}/api/ask-veeva/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, threshold: 0.3 })
    });

    if (!response.ok) return { results: [], error: 'Document search unavailable' };

    const data = await response.json();
    return {
      results: (data.results || []).map(r => ({
        title: r.filename || r.title,
        excerpt: r.text?.substring(0, 300) + '...',
        score: r.score,
        page: r.page
      })),
      count: data.results?.length || 0
    };
  } catch (e) {
    console.error('[AI] Document search error:', e.message);
    return { results: [], error: e.message };
  }
}

// ============================================================
// AI ACTION EXECUTION - Execute autonomous actions
// ============================================================
async function executeAIAction(action, params, site) {
  console.log(`[AI] Executing action: ${action}`, params);

  try {
    switch (action) {
      case 'createControl': {
        const { switchboardId, templateId, dueDate, frequency } = params;
        const result = await pool.query(`
          INSERT INTO control_schedules (switchboard_id, template_id, next_due_date, frequency, site, created_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          RETURNING id
        `, [switchboardId, templateId || 1, dueDate, frequency || 'annual', site]);
        return { success: true, message: `✅ Contrôle créé (ID: ${result.rows[0]?.id})`, id: result.rows[0]?.id };
      }

      case 'createNC': {
        const { equipmentId, description, severity, equipmentType } = params;
        const table = equipmentType === 'atex' ? 'atex_nonconformities' : 'nonconformities';
        const result = await pool.query(`
          INSERT INTO ${table} (equipment_id, description, severity, status, site, created_at)
          VALUES ($1, $2, $3, 'open', $4, NOW())
          RETURNING id
        `, [equipmentId, description, severity || 'medium', site]);
        return { success: true, message: `✅ Non-conformité créée (ID: ${result.rows[0]?.id})`, id: result.rows[0]?.id };
      }

      case 'updateEquipment': {
        const { id, status, equipmentType } = params;
        const tables = {
          switchboard: 'switchboards',
          vsd: 'vsd_equipments',
          meca: 'meca_equipments',
          atex: 'atex_equipments'
        };
        const table = tables[equipmentType] || 'switchboards';
        await pool.query(`UPDATE ${table} SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
        return { success: true, message: `✅ Équipement ${id} mis à jour: ${status}` };
      }

      case 'scheduleReminder': {
        const { date, message, userId } = params;
        // Store reminder in a notifications table (create if needed)
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ai_reminders (
            id SERIAL PRIMARY KEY,
            reminder_date DATE NOT NULL,
            message TEXT NOT NULL,
            site TEXT,
            user_id INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            is_sent BOOLEAN DEFAULT FALSE
          )
        `);
        const result = await pool.query(`
          INSERT INTO ai_reminders (reminder_date, message, site, user_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [date, message, site, userId]);
        return { success: true, message: `✅ Rappel programmé pour le ${date}`, id: result.rows[0]?.id };
      }

      case 'searchEquipment': {
        const { query, type, building, floor } = params;
        let sql = 'SELECT id, name, code, building_code, floor FROM switchboards WHERE site = $1';
        const queryParams = [site];

        if (building) {
          sql += ' AND building_code ILIKE $' + (queryParams.length + 1);
          queryParams.push(`%${building}%`);
        }
        if (floor) {
          sql += ' AND floor = $' + (queryParams.length + 1);
          queryParams.push(floor);
        }
        if (query) {
          sql += ' AND (name ILIKE $' + (queryParams.length + 1) + ' OR code ILIKE $' + (queryParams.length + 1) + ')';
          queryParams.push(`%${query}%`);
        }
        sql += ' LIMIT 20';

        const result = await pool.query(sql, queryParams);
        return { success: true, results: result.rows, count: result.rows.length };
      }

      case 'getControlHistory': {
        const { switchboardId, limit } = params;
        const result = await pool.query(`
          SELECT cr.*, ct.name as template_name
          FROM control_reports cr
          LEFT JOIN control_templates ct ON cr.template_id = ct.id
          WHERE cr.switchboard_id = $1
          ORDER BY cr.control_date DESC
          LIMIT $2
        `, [switchboardId, limit || 10]);
        return { success: true, history: result.rows };
      }

      case 'getDailyPlan': {
        // Get optimized daily plan
        const context = await getAIContext(site);
        const totalTime = context.dailyPlan.reduce((acc, t) => acc + (t.estimatedDuration || 30), 0);

        return {
          success: true,
          plan: context.dailyPlan,
          summary: {
            totalTasks: context.dailyPlan.length,
            criticalTasks: context.dailyPlan.filter(t => t.priority === 1).length,
            urgentTasks: context.dailyPlan.filter(t => t.priority === 2).length,
            estimatedTime: `${Math.floor(totalTime / 60)}h${totalTime % 60 > 0 ? (totalTime % 60) + 'min' : ''}`,
            buildings: [...new Set(context.dailyPlan.map(t => t.building).filter(Boolean))]
          },
          overdueAlerts: context.controls.overdueList.filter(c => c.urgency === 'critical'),
          message: `📋 Plan du jour: ${context.dailyPlan.length} tâches (~${Math.floor(totalTime / 60)}h)`
        };
      }

      case 'batchCreateControls': {
        // Create multiple controls at once
        const { controls } = params;
        const results = [];

        for (const ctrl of controls) {
          try {
            const result = await pool.query(`
              INSERT INTO control_schedules (switchboard_id, template_id, next_due_date, frequency, site, created_at)
              VALUES ($1, $2, $3, $4, $5, NOW())
              RETURNING id
            `, [ctrl.switchboardId, ctrl.templateId || 1, ctrl.dueDate, ctrl.frequency || 'annual', site]);
            results.push({ success: true, id: result.rows[0]?.id, switchboardId: ctrl.switchboardId });
          } catch (e) {
            results.push({ success: false, error: e.message, switchboardId: ctrl.switchboardId });
          }
        }

        const successCount = results.filter(r => r.success).length;
        return {
          success: successCount > 0,
          message: `✅ ${successCount}/${controls.length} contrôles créés`,
          results
        };
      }

      case 'getEquipmentDetails': {
        const { equipmentId, type } = params;
        const tables = {
          switchboard: 'switchboards',
          vsd: 'vsd_equipments',
          meca: 'meca_equipments',
          atex: 'atex_equipments'
        };
        const table = tables[type] || 'switchboards';

        const eqResult = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [equipmentId]);
        if (eqResult.rows.length === 0) {
          return { success: false, message: 'Équipement non trouvé' };
        }

        // Get related controls
        let controls = [];
        if (type === 'switchboard') {
          const ctrlResult = await pool.query(`
            SELECT cs.*, ct.name as template_name
            FROM control_schedules cs
            LEFT JOIN control_templates ct ON cs.template_id = ct.id
            WHERE cs.switchboard_id = $1
            ORDER BY cs.next_due_date
          `, [equipmentId]);
          controls = ctrlResult.rows;
        }

        return {
          success: true,
          equipment: eqResult.rows[0],
          controls,
          message: `📍 ${eqResult.rows[0].name} - ${controls.length} contrôles planifiés`
        };
      }

      default:
        return { success: false, message: `Action inconnue: ${action}` };
    }
  } catch (e) {
    console.error(`[AI] Action error (${action}):`, e.message);
    return { success: false, message: `Erreur: ${e.message}` };
  }
}

// ============================================================
// AI RESPONSE PARSER - Extract charts and actions from response
// ============================================================
function parseAIResponse(responseText) {
  const result = {
    message: responseText,
    chart: null,
    action: null,
    actionParams: null
  };

  // Extract JSON blocks for chart
  const chartMatch = responseText.match(/```json\s*(\{[^`]*"chart"[^`]*\})\s*```/s);
  if (chartMatch) {
    try {
      const parsed = JSON.parse(chartMatch[1]);
      if (parsed.chart) {
        result.chart = parsed.chart;
        result.message = responseText.replace(chartMatch[0], '').trim();
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Also try inline chart JSON
  const inlineChartMatch = responseText.match(/\{"chart"\s*:\s*\{[^}]+\}\}/);
  if (!result.chart && inlineChartMatch) {
    try {
      const parsed = JSON.parse(inlineChartMatch[0]);
      if (parsed.chart) {
        result.chart = parsed.chart;
      }
    } catch (e) { /* ignore */ }
  }

  // Extract action JSON
  const actionMatch = responseText.match(/```json\s*(\{[^`]*"action"[^`]*\})\s*```/s);
  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1]);
      if (parsed.action) {
        result.action = parsed.action;
        result.actionParams = parsed.params || {};
        result.message = responseText.replace(actionMatch[0], '').trim();
      }
    } catch (e) { /* ignore */ }
  }

  // Inline action JSON
  const inlineActionMatch = responseText.match(/\{"action"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^}]+\}\}/);
  if (!result.action && inlineActionMatch) {
    try {
      const parsed = JSON.parse(inlineActionMatch[0]);
      if (parsed.action) {
        result.action = parsed.action;
        result.actionParams = parsed.params || {};
      }
    } catch (e) { /* ignore */ }
  }

  return result;
}

// ============================================================
// AI CALL WITH FALLBACK - OpenAI -> Gemini -> Local
// ============================================================
async function callAI(messages, options = {}) {
  const { maxTokens = 2000, temperature = 0.7 } = options;

  // Try OpenAI first
  if (openai) {
    try {
      console.log('[AI] Calling OpenAI...');
      const completion = await openai.chat.completions.create({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        messages,
        temperature,
        max_tokens: maxTokens
      });
      return {
        content: completion.choices[0]?.message?.content || '',
        provider: 'openai',
        model: process.env.AI_MODEL || 'gpt-4o-mini'
      };
    } catch (e) {
      console.error('[AI] OpenAI error:', e.message);
    }
  }

  // Fallback to Gemini
  if (geminiModel) {
    try {
      console.log('[AI] Falling back to Gemini...');
      // Convert messages to Gemini format
      const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
      const userMessages = messages.filter(m => m.role !== 'system');

      const prompt = systemPrompt + '\n\n' + userMessages.map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n\n');

      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      return {
        content: response.text(),
        provider: 'gemini',
        model: 'gemini-1.5-flash'
      };
    } catch (e) {
      console.error('[AI] Gemini error:', e.message);
    }
  }

  // No AI available
  return {
    content: null,
    provider: 'none',
    error: 'Aucun service IA disponible'
  };
}

// ============================================================
// AUTH AUDIT LOG - Traçage des connexions/déconnexions
// ============================================================
async function ensureAuthAuditTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_audit_log (
        id SERIAL PRIMARY KEY,
        ts TIMESTAMPTZ DEFAULT NOW(),
        action TEXT NOT NULL,
        email TEXT,
        user_name TEXT,
        user_id INTEGER,
        company_id INTEGER,
        site_id INTEGER,
        role TEXT,
        source TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        details JSONB DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_auth_audit_ts ON auth_audit_log(ts);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_email ON auth_audit_log(email);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_action ON auth_audit_log(action);
    `);
    console.log('[AUTH] Audit table ready');
  } catch (e) {
    console.error('[AUTH] Audit table error:', e.message);
  }
}
ensureAuthAuditTable();

async function logAuthEvent(req, action, data = {}) {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'] || null;

    await pool.query(`
      INSERT INTO auth_audit_log (action, email, user_name, user_id, company_id, site_id, role, source, ip_address, user_agent, success, error_message, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      action,
      data.email || null,
      data.name || null,
      data.user_id || null,
      data.company_id || null,
      data.site_id || null,
      data.role || null,
      data.source || 'unknown',
      ip,
      userAgent,
      data.success !== false,
      data.error || null,
      JSON.stringify(data.details || {})
    ]);
  } catch (e) {
    console.error('[AUTH AUDIT] Log failed:', e.message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Sécurité & cookies
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "wss:"],
      mediaSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
    },
  },
}));
app.use(cookieParser());

// ⚠️ NOTE: switchboardMapApp a un body-parser qui parse TOUS les bodies AVANT les proxies.
// C'est pour ça que les proxies avec PUT/POST doivent utiliser withRestream: true
// pour re-transmettre le body parsé au microservice.
app.use(switchboardMapApp);

// -------- AUTH LIGHT (n'a pas besoin du body pour passer) ----------
function authMiddleware(req, _res, next) {
  if (req.path.startsWith("/api/auth/") || req.path.startsWith("/api/public/")) return next();
  const token = req.cookies?.token;
  if (!token) return next();
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || "devsecret"); } catch {}
  next();
}
app.use(authMiddleware);

/* =================================================================
   PROXIES AVANT TOUT BODY-PARSER  => évite que le body soit mangé
   VERSION 3.0: Ajout de timeouts stricts pour éviter les blocages
   ================================================================= */
const atexTarget         = process.env.ATEX_BASE_URL         || "http://127.0.0.1:3001";
const loopcalcTarget     = process.env.LOOPCALC_BASE_URL      || "http://127.0.0.1:3002";
const switchboardTarget  = process.env.SWITCHBOARD_BASE_URL   || "http://127.0.0.1:3003";
const selectivityTarget  = process.env.SELECTIVITY_BASE_URL   || "http://127.0.0.1:3004";
const flaTarget          = process.env.FLA_BASE_URL           || "http://127.0.0.1:3005";
const arcflashTarget     = process.env.ARCFLASH_BASE_URL      || "http://127.0.0.1:3006";
const obsolescenceTarget = process.env.OBSOLESCENCE_BASE_URL  || "http://127.0.0.1:3007";
const hvTarget           = process.env.HV_BASE_URL            || "http://127.0.0.1:3008";
const diagramTarget      = process.env.DIAGRAM_BASE_URL       || "http://127.0.0.1:3010";
// Controls ancien système supprimé - remplacé par switchboard-controls intégré à server_switchboard.js
// const controlsTarget     = process.env.CONTROLS_BASE_URL      || "http://127.0.0.1:3011";
const oibtTarget         = process.env.OIBT_BASE_URL          || "http://127.0.0.1:3012";
const projectsTarget     = process.env.PROJECTS_BASE_URL      || "http://127.0.0.1:3013";
// 🔵 Comp-Ext (prestataires externes) — nouveau microservice sur 3014
const compExtTarget      = process.env.COMP_EXT_BASE_URL      || "http://127.0.0.1:3014";
// 🔵 Ask Veeva (lecture de documents + Q/R) — nouveau microservice sur 3015
const askVeevaTarget     = process.env.ASK_VEEVA_BASE_URL     || "http://127.0.0.1:3015";
// 🔵 Doors (portes coupe-feu) — microservice sur 3016  ✅ AJOUT
const doorsTarget        = process.env.DOORS_BASE_URL         || "http://127.0.0.1:3016";
// 🔵 VSD (Variateurs de fréquence) — microservice sur 3020  ✅ AJOUT
const vsdTarget          = process.env.VSD_BASE_URL           || "http://127.0.0.1:3020";
const mecaTarget = process.env.MECA_BASE_URL || "http://127.0.0.1:3021";
// 🔵 Mobile Equipment (Controle Electrique Appareils Mobiles) — microservice sur 3022
const mobileEquipTarget = process.env.MOBILE_EQUIP_BASE_URL || "http://127.0.0.1:3022";
// 🔵 GLO (Global Electrical Equipments: UPS, Batteries, Éclairages) — microservice sur 3023
const gloTarget = process.env.GLO_BASE_URL || "http://127.0.0.1:3023";
// 🔵 Datahub (Custom categories with map markers) — microservice sur 3024
const datahubTarget = process.env.DATAHUB_BASE_URL || "http://127.0.0.1:3024";
// 🤖 AI Assistant (avatar intelligent avec OpenAI/Gemini) — microservice sur 3025
const aiAssistantTarget = process.env.AI_ASSISTANT_BASE_URL || "http://127.0.0.1:3025";
const dcfTarget = process.env.DCF_TARGET || "http://127.0.0.1:3030";
const learnExTarget = process.env.LEARN_EX_BASE_URL || "http://127.0.0.1:3040";
// 🔵 Infrastructure (plans électriques multi-zones) — intégré dans server_atex.js (port 3001)
const infraTarget = process.env.INFRA_BASE_URL || process.env.ATEX_BASE_URL || "http://127.0.0.1:3001";

// ============================================================
// PROXY HELPER v3.0 - Avec timeouts stricts
// ============================================================
function mkProxy(target, { withRestream = false, timeoutMs = 20000 } = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: "warn",

    // ✅ TIMEOUTS CRITIQUES pour éviter les blocages infinis
    proxyTimeout: timeoutMs,      // Timeout réponse backend (20s par défaut)
    timeout: timeoutMs + 5000,    // Timeout connexion total (25s par défaut)

    // ✅ Gestion d'erreur améliorée
    onError(err, req, res) {
      console.error(`[PROXY ERROR] ${req.method} ${req.path} -> ${target}: ${err.code || err.message}`);

      // Ne pas répondre si déjà envoyé
      if (res.headersSent) return;

      const isTimeout = err.code === 'ECONNRESET' ||
                       err.code === 'ETIMEDOUT' ||
                       err.code === 'ESOCKETTIMEDOUT' ||
                       err.message?.includes('timeout');

      if (isTimeout) {
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Timeout - le service met trop de temps à répondre",
          code: err.code || "TIMEOUT",
          retry: true
        }));
      } else {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Service temporairement indisponible",
          code: err.code || "UPSTREAM_ERROR",
          retry: true
        }));
      }
    },

    // Re-stream du body si déjà parsé en amont (sécurité)
    onProxyReq: withRestream
      ? (proxyReq, req) => {
          if (!req.body || !Object.keys(req.body).length) return;
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      : undefined,
  });
}

// ✅ ATEX: Ajout withRestream pour éviter les problèmes de body (setPosition, etc.)
app.use("/api/atex",         mkProxy(atexTarget, { withRestream: true, timeoutMs: 30000 }));
app.use("/api/loopcalc",     mkProxy(loopcalcTarget));
// ✅ SWITCHBOARD: Ajout withRestream pour éviter les problèmes de body
app.use("/api/switchboard",  mkProxy(switchboardTarget, { withRestream: true, timeoutMs: 25000 }));
app.use("/api/selectivity",  mkProxy(selectivityTarget));
app.use("/api/faultlevel",   mkProxy(flaTarget));
app.use("/api/arcflash",     mkProxy(arcflashTarget));
// ✅ OBSOLESCENCE: Ajout withRestream pour éviter les problèmes de body (service-year PUT)
app.use("/api/obsolescence", mkProxy(obsolescenceTarget, { withRestream: true, timeoutMs: 30000 }));
// ✅ HV: Ajout withRestream pour éviter les problèmes de body (setPosition, etc.)
app.use("/api/hv",           mkProxy(hvTarget, { withRestream: true, timeoutMs: 30000 }));
app.use("/api/diagram",      mkProxy(diagramTarget));
// Controls supprimé - switchboard-controls intégré à server_switchboard.js
// app.use("/api/controls",     mkProxy(controlsTarget));
app.use("/api/oibt",         mkProxy(oibtTarget));
app.use("/api/dcf", mkProxy(dcfTarget, { withRestream: true }));

// >>> Projects : proxy bavard + re-stream (si un jour body était déjà parsé)
app.use("/api/projects", mkProxy(projectsTarget, { withRestream: true }));

// >>> Comp-Ext (prestataires externes) : même traitement que Projects (re-stream utile pour PUT/POST)
app.use("/api/comp-ext", mkProxy(compExtTarget, { withRestream: true }));

// >>> Ask Veeva (ZIP + upload multipart) : re-stream INDISPENSABLE
app.use("/api/ask-veeva", mkProxy(askVeevaTarget, { withRestream: true }));
// >>> VSD (photos + pièces jointes) : re-stream INDISPENSABLE  ✅ AJOUT
app.use("/api/vsd", mkProxy(vsdTarget, { withRestream: true }));

// >>> Doors (photos + pièces jointes) : re-stream INDISPENSABLE  ✅ AJOUT
app.use("/api/doors", mkProxy(doorsTarget, { withRestream: true }));

// >>> Meca (Maintenance Mécanique) : re-stream nécessaire pour upload
app.use("/api/meca", mkProxy(mecaTarget, { withRestream: true }));

// >>> Learn-Ex (formation ATEX) : timeout étendu pour génération de certificats
app.use("/api/learn-ex", mkProxy(learnExTarget, { withRestream: true, timeoutMs: 60000 }));

// >>> Mobile Equipment (Controle Electrique Appareils Mobiles) : re-stream pour uploads
app.use("/api/mobile-equipment", mkProxy(mobileEquipTarget, { withRestream: true }));

// >>> GLO (Global Electrical Equipments: UPS, Batteries, Éclairages) : re-stream pour uploads
app.use("/api/glo", mkProxy(gloTarget, { withRestream: true }));

// >>> Datahub (Custom categories with map markers) : re-stream pour uploads
app.use("/api/datahub", mkProxy(datahubTarget, { withRestream: true }));

// >>> AI Assistant - Powerful AI with OpenAI + Database access
app.post("/api/ai-assistant/chat", express.json(), async (req, res) => {
  try {
    const { message, context: clientContext, conversationHistory = [], executeAction = false } = req.body;
    const site = req.header('X-Site') || clientContext?.user?.site || process.env.DEFAULT_SITE || 'Nyon';

    if (!message) {
      return res.status(400).json({ error: "Message requis" });
    }

    console.log(`[AI] 🚀 Processing: "${message.substring(0, 50)}..." for site ${site}`);

    // Get real-time context from database
    const dbContext = await getAIContext(site);
    const contextPrompt = formatContextForAI(dbContext);

    // Check if user wants document search
    const needsDocs = /document|manuel|fiche|norme|pdf|technique|spécification|datasheet/i.test(message);
    let docContext = '';
    let docSources = [];

    if (needsDocs) {
      console.log('[AI] 📄 Searching documents...');
      const docResults = await searchDocuments(message, 5);
      if (docResults.results.length > 0) {
        docContext = `\n\n## Documents trouvés\n${docResults.results.map((d, i) =>
          `${i + 1}. **${d.title}** (pertinence: ${Math.round((d.score || 0) * 100)}%)\n   ${d.excerpt}`
        ).join('\n\n')}`;
        docSources = docResults.results.map(d => ({ title: d.title, page: d.page }));
      }
    }

    // Build full context
    const fullContext = contextPrompt + docContext;

    // Build messages for AI
    const messages = [
      { role: "system", content: AI_SYSTEM_PROMPT + "\n\n" + fullContext },
      ...conversationHistory.slice(-8).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message }
    ];

    // Call AI (OpenAI -> Gemini fallback)
    const aiResult = await callAI(messages, { maxTokens: 2000 });

    if (!aiResult.content) {
      // Ultimate fallback
      console.log('[AI] ⚠️ No AI available, using intelligent fallback');
      return res.json(generateIntelligentFallback(message, dbContext));
    }

    // Parse response for charts and actions
    const parsed = parseAIResponse(aiResult.content);

    // Execute action if requested and action found
    let actionResult = null;
    if (executeAction && parsed.action) {
      console.log(`[AI] ⚡ Executing action: ${parsed.action}`);
      actionResult = await executeAIAction(parsed.action, parsed.actionParams, site);

      // Append action result to message
      if (actionResult.success) {
        parsed.message += `\n\n---\n**Action exécutée:** ${actionResult.message}`;
      } else {
        parsed.message += `\n\n---\n**Erreur d'exécution:** ${actionResult.message}`;
      }
    }

    // Extract suggested follow-up actions
    const suggestedActions = extractActionsFromResponse(parsed.message, message);

    // Build response
    const response = {
      message: parsed.message,
      actions: suggestedActions,
      sources: docSources,
      provider: aiResult.provider,
      model: aiResult.model,
      context: {
        site,
        switchboards: dbContext.switchboards.count,
        controls: dbContext.controls,
        timestamp: dbContext.timestamp
      }
    };

    // Add chart if present, or auto-generate for statistical queries
    if (parsed.chart) {
      response.chart = parsed.chart;
      console.log('[AI] 📊 Chart generated:', parsed.chart.type, parsed.chart.title);
    } else {
      // Auto-generate chart for analysis/statistics/overview queries
      const msgLower = message.toLowerCase();
      if (msgLower.includes('analyse') || msgLower.includes('statistique') || msgLower.includes('global') ||
          msgLower.includes('résumé') || msgLower.includes('vue') || msgLower.includes('situation') ||
          msgLower.includes('répartition') || msgLower.includes('bâtiment') || msgLower.includes('carte')) {
        const chartType = msgLower.includes('bâtiment') || msgLower.includes('carte') || msgLower.includes('répartition')
          ? 'buildings'
          : msgLower.includes('contrôle') ? 'controls' : 'overview';
        response.chart = autoGenerateChart(dbContext, chartType);
        if (response.chart) {
          console.log('[AI] 📊 Auto-generated chart:', response.chart.type, response.chart.title);
        }
      }
    }

    // Add pending action if not executed
    if (parsed.action && !executeAction) {
      response.pendingAction = {
        action: parsed.action,
        params: parsed.actionParams,
        description: `Action proposée: ${parsed.action}`
      };
      console.log('[AI] 🔧 Action proposed:', parsed.action);
    }

    // Add action result if executed
    if (actionResult) {
      response.actionResult = actionResult;
    }

    res.json(response);

  } catch (error) {
    console.error('[AI] ❌ Error:', error.message);

    // Fallback on error
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';
    const dbContext = await getAIContext(site).catch(() => ({}));

    res.json(generateIntelligentFallback(req.body?.message || '', dbContext));
  }
});

// Auto-generate chart from context data
function autoGenerateChart(ctx, type = 'overview') {
  const buildings = ctx.buildings || {};
  // Sort buildings by equipment count descending
  const sortedBuildings = Object.entries(buildings)
    .sort((a, b) => b[1].equipmentCount - a[1].equipmentCount)
    .slice(0, 10);
  const buildingNames = sortedBuildings.map(([name]) => `Bât. ${name}`);
  const buildingCounts = sortedBuildings.map(([_, data]) => data.equipmentCount);

  switch (type) {
    case 'buildings':
      if (buildingNames.length > 0) {
        return {
          type: 'bar',
          title: 'Équipements par bâtiment',
          labels: buildingNames,
          data: buildingCounts
        };
      }
      break;

    case 'equipment':
      return {
        type: 'doughnut',
        title: 'Types d\'équipements',
        labels: ['Armoires élec.', 'Variateurs VSD', 'Mécaniques', 'ATEX'],
        data: [
          ctx.switchboards?.count || 0,
          ctx.vsd?.count || 0,
          ctx.meca?.count || 0,
          ctx.atex?.totalEquipments || ctx.atex?.equipmentCount || 0
        ]
      };

    case 'controls':
      return {
        type: 'doughnut',
        title: 'État des contrôles planifiés',
        labels: ['En retard', 'Cette semaine', 'Ce mois', '3 prochains mois'],
        data: [
          ctx.controls?.overdue || 0,
          ctx.controls?.thisWeek || 0,
          ctx.controls?.thisMonth || 0,
          ctx.controls?.next90days || 0
        ]
      };

    case 'atex':
      return {
        type: 'doughnut',
        title: 'Conformité ATEX',
        labels: ['Conformes', 'Non-conformes', 'Non contrôlés'],
        data: [
          ctx.atex?.conformeCount || 0,
          ctx.atex?.ncCount || 0,
          Math.max(0, (ctx.atex?.totalEquipments || 0) - (ctx.atex?.conformeCount || 0) - (ctx.atex?.ncCount || 0))
        ]
      };

    case 'overview':
    default:
      // Combined overview chart - buildings if available, otherwise equipment types
      if (buildingNames.length > 0) {
        return {
          type: 'bar',
          title: 'Répartition des équipements par bâtiment',
          labels: buildingNames.slice(0, 8),
          data: buildingCounts.slice(0, 8)
        };
      }
      return {
        type: 'doughnut',
        title: 'Types d\'équipements',
        labels: ['Armoires élec.', 'Variateurs VSD', 'Mécaniques', 'ATEX'],
        data: [
          ctx.switchboards?.count || 0,
          ctx.vsd?.count || 0,
          ctx.meca?.count || 0,
          ctx.atex?.totalEquipments || ctx.atex?.equipmentCount || 0
        ]
      };
  }
  return null;
}

// Generate intelligent fallback response based on DB context
function generateIntelligentFallback(message, ctx) {
  const msg = (message || '').toLowerCase();
  const summary = ctx.summary || {};

  // Build response based on actual data
  if (msg.includes('contrôle') || msg.includes('retard') || msg.includes('overdue') || msg.includes('planning') || msg.includes('semaine') || msg.includes('mois')) {
    const overdueCount = ctx.controls?.overdue || 0;
    const overdueList = ctx.controls?.overdueList || [];
    const thisWeekList = ctx.controls?.thisWeekList || [];
    const thisMonthList = ctx.controls?.thisMonthList || [];

    let response = '';

    if (overdueCount > 0) {
      response += `🚨 **${overdueCount} contrôle(s) en retard!**\n\n`;
      if (overdueList.length > 0) {
        response += overdueList.slice(0, 5).map(c =>
          `• **${c.switchboard}** (${c.switchboardCode})\n  📍 Bât. ${c.building}, ét. ${c.floor} | ⏰ ${c.daysOverdue}j de retard`
        ).join('\n') + '\n\n';
      }
    }

    if (thisWeekList.length > 0) {
      response += `📅 **Cette semaine (${thisWeekList.length}):**\n`;
      response += thisWeekList.slice(0, 5).map(c =>
        `• ${c.switchboard} — ${c.dueDateFormatted} (dans ${c.daysUntil}j)`
      ).join('\n') + '\n\n';
    }

    if (thisMonthList.length > 0) {
      response += `📆 **Ce mois (${thisMonthList.length}):**\n`;
      response += thisMonthList.slice(0, 3).map(c =>
        `• ${c.switchboard} — ${c.dueDateFormatted}`
      ).join('\n') + '\n';
    }

    if (!response) {
      response = `✅ **Aucun contrôle planifié** pour les prochaines semaines.\n\n` +
        `📊 ${ctx.controls?.scheduled || 0} contrôles programmés au total.\n` +
        `🏢 ${ctx.switchboards?.count || 0} armoires électriques sur ${summary.totalBuildings || 0} bâtiments.`;
    }

    return {
      message: response,
      actions: [
        { label: "Voir par bâtiment", prompt: "Répartition par bâtiment" },
        { label: "ATEX", prompt: "Situation ATEX" }
      ],
      chart: autoGenerateChart(ctx, 'controls'),
      provider: "fallback"
    };
  }

  if (msg.includes('bâtiment') || msg.includes('building') || msg.includes('étage') || msg.includes('floor') || msg.includes('carte') || msg.includes('map') || msg.includes('répartition')) {
    const buildings = ctx.buildings || {};
    const buildingList = Object.entries(buildings)
      .sort((a, b) => b[1].equipmentCount - a[1].equipmentCount)
      .slice(0, 10)
      .map(([name, data]) => `• **Bât. ${name}**: ${data.equipmentCount} équip. (étages: ${data.floors?.join(', ') || 'RDC'})`)
      .join('\n');

    return {
      message: `📍 **Répartition par bâtiment** — Site ${ctx.site || 'actuel'}\n\n` +
        (buildingList || '• Aucune donnée de bâtiment') +
        `\n\n**Total:** ${ctx.switchboards?.count || 0} armoires sur **${Object.keys(buildings).length} bâtiments**`,
      actions: Object.keys(buildings).slice(0, 3).map(b => ({
        label: `Bât. ${b}`,
        prompt: `Détails du bâtiment ${b}`
      })),
      chart: autoGenerateChart(ctx, 'buildings'),
      provider: "fallback"
    };
  }

  if (msg.includes('atex') || msg.includes('nc') || msg.includes('non-conformité') || msg.includes('conformité')) {
    const ncList = ctx.atex?.ncList || [];
    let ncDetails = '';

    if (ncList.length > 0) {
      ncDetails = ncList.slice(0, 5).map(nc =>
        `• **${nc.name}** (${nc.type})\n` +
        `  📍 Bât. ${nc.building}, Zone ${nc.zone}\n` +
        `  ⚠️ ${nc.ncDetails?.slice(0, 2).join(', ') || 'Vérification requise'}`
      ).join('\n\n');
    }

    return {
      message: `🔥 **Situation ATEX** — Site ${ctx.site || 'actuel'}\n\n` +
        `• **${ctx.atex?.totalEquipments || 0}** équipements ATEX\n` +
        `• **${ctx.atex?.conformeCount || 0}** conformes\n` +
        `• **${ctx.atex?.ncCount || 0}** non-conformes\n` +
        `• **Taux de conformité:** ${summary.atexConformityRate || 100}%\n\n` +
        (ncDetails ? `**Non-conformités:**\n\n${ncDetails}` : '✅ Toutes les conformités OK!'),
      actions: [
        { label: "Planning contrôles", prompt: "Contrôles à venir" },
        { label: "Par bâtiment", prompt: "Répartition par bâtiment" }
      ],
      chart: autoGenerateChart(ctx, 'atex'),
      provider: "fallback"
    };
  }

  if (msg.includes('résumé') || msg.includes('summary') || msg.includes('situation') || msg.includes('global') || msg.includes('analyse') || msg.includes('statistique')) {
    return {
      message: `📊 **Vue globale** — Site ${ctx.site || 'actuel'}\n\n` +
        `**Équipements (${summary.totalEquipments || 0} total):**\n` +
        `• ${ctx.switchboards?.count || 0} armoires électriques\n` +
        `• ${ctx.vsd?.count || 0} variateurs VSD\n` +
        `• ${ctx.meca?.count || 0} équipements mécaniques\n` +
        `• ${ctx.atex?.totalEquipments || 0} ATEX (${summary.atexConformityRate || 100}% conformes)\n\n` +
        `**Contrôles planifiés:**\n` +
        (ctx.controls?.overdue > 0 ? `• 🚨 ${ctx.controls.overdue} en RETARD\n` : '• ✅ Aucun retard\n') +
        `• ${ctx.controls?.thisWeek || 0} cette semaine\n` +
        `• ${ctx.controls?.thisMonth || 0} ce mois\n` +
        `• ${ctx.controls?.scheduled || 0} au total\n\n` +
        `**${summary.totalBuildings || 0} bâtiments** équipés`,
      actions: [
        { label: "Contrôles", prompt: "Planning des contrôles" },
        { label: "Par bâtiment", prompt: "Répartition par bâtiment" },
        { label: "ATEX", prompt: "Situation ATEX" }
      ],
      chart: autoGenerateChart(ctx, 'overview'),
      provider: "fallback"
    };
  }

  // Default: show summary with chart
  return {
    message: `👋 **Electro** — Assistant ElectroHub\n\n` +
      `📊 **Site ${ctx.site || 'actuel'}:**\n` +
      `• ${summary.totalEquipments || 0} équipements sur ${summary.totalBuildings || 0} bâtiments\n` +
      (ctx.controls?.overdue > 0 ? `• 🚨 ${ctx.controls.overdue} contrôles en retard\n` : '') +
      `• ${ctx.controls?.thisWeek || 0} contrôles cette semaine\n` +
      (ctx.atex?.ncCount > 0 ? `• ⚠️ ${ctx.atex.ncCount} NC ATEX actives\n` : '') +
      `\nComment puis-je vous aider ?`,
    actions: [
      { label: "Analyse complète", prompt: "Analyse globale de la situation" },
      { label: "Planning", prompt: "Contrôles à venir" },
      { label: "ATEX", prompt: "Situation ATEX" }
    ],
    chart: autoGenerateChart(ctx, 'equipment'),
    provider: "fallback"
  };
}

// Extract action suggestions from AI response
function extractActionsFromResponse(response, originalMessage) {
  const actions = [];

  // If talking about controls, suggest control actions
  if (response.toLowerCase().includes('contrôle') || originalMessage.toLowerCase().includes('contrôle')) {
    actions.push({ label: "Planifier un contrôle", prompt: "Comment planifier un nouveau contrôle ?" });
  }

  // If talking about buildings, suggest building exploration
  if (response.toLowerCase().includes('bâtiment') || originalMessage.toLowerCase().includes('bâtiment')) {
    actions.push({ label: "Voir la carte", prompt: "Montre-moi la vue carte des équipements" });
  }

  // If talking about NC, suggest NC actions
  if (response.toLowerCase().includes('non-conformité') || response.toLowerCase().includes(' nc ')) {
    actions.push({ label: "Traiter les NC", prompt: "Comment traiter une non-conformité ?" });
  }

  // Always suggest a follow-up
  if (actions.length === 0) {
    actions.push(
      { label: "Résumé situation", prompt: "Donne-moi un résumé de la situation" },
      { label: "Autre question", prompt: "J'ai une autre question" }
    );
  }

  return actions.slice(0, 3);
}

// Execute AI action endpoint
app.post("/api/ai-assistant/execute-action", express.json(), async (req, res) => {
  try {
    const { action, params } = req.body;
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';

    if (!action) {
      return res.status(400).json({ success: false, message: 'Action requise' });
    }

    console.log(`[AI] ⚡ Executing action: ${action}`);
    const result = await executeAIAction(action, params || {}, site);

    res.json(result);
  } catch (error) {
    console.error('[AI] Execute action error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// COMPREHENSIVE STATISTICS ENDPOINT
// ============================================================
app.get("/api/ai-assistant/statistics", async (req, res) => {
  try {
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';
    const context = await getAIContext(site);

    // Build comprehensive statistics
    const stats = {
      site,
      generatedAt: new Date().toISOString(),

      // Equipment counts
      equipment: {
        switchboards: context.switchboards.count,
        vsd: context.vsd.count,
        meca: context.meca.count,
        atex: context.atex.equipmentCount,
        total: context.statistics.totalEquipments
      },

      // Controls status
      controls: {
        total: context.controls.total,
        overdue: context.controls.overdue,
        upcoming: context.controls.upcoming,
        overdueRate: context.statistics.overdueRate,
        criticalOverdue: context.controls.overdueList.filter(c => c.urgency === 'critical').length,
        urgentOverdue: context.controls.overdueList.filter(c => c.urgency === 'high').length
      },

      // ATEX compliance
      atex: {
        totalEquipments: context.atex.equipmentCount,
        nonConformities: context.atex.ncCount,
        complianceRate: context.atex.equipmentCount > 0
          ? Math.round(((context.atex.equipmentCount - context.atex.ncCount) / context.atex.equipmentCount) * 100)
          : 100
      },

      // Buildings
      buildings: {
        count: context.statistics.totalBuildings,
        details: Object.entries(context.buildings).map(([name, data]) => ({
          name,
          equipmentCount: data.equipmentCount,
          floors: data.floors
        }))
      },

      // Urgent items
      urgent: {
        total: context.urgentItems.length,
        controlsOverdue: context.urgentItems.filter(i => i.type === 'control_overdue').length,
        atexNC: context.urgentItems.filter(i => i.type === 'atex_nc').length,
        items: context.urgentItems.slice(0, 10)
      },

      // Daily workload
      dailyPlan: {
        tasksCount: context.dailyPlan.length,
        estimatedHours: Math.round(context.dailyPlan.reduce((acc, t) => acc + (t.estimatedDuration || 30), 0) / 60 * 10) / 10,
        tasks: context.dailyPlan.slice(0, 10)
      }
    };

    res.json(stats);
  } catch (error) {
    console.error('[AI] Statistics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// WEEKLY PLAN ENDPOINT
// ============================================================
app.get("/api/ai-assistant/weekly-plan", async (req, res) => {
  try {
    const site = req.header('X-Site') || process.env.DEFAULT_SITE || 'Nyon';

    // Get all controls for the next 7 days + overdue
    const result = await pool.query(`
      SELECT cs.id, cs.switchboard_id, cs.next_due_date, cs.frequency,
             ct.name as template_name,
             s.name as switchboard_name, s.code as switchboard_code, s.building_code, s.floor, s.room
      FROM control_schedules cs
      LEFT JOIN control_templates ct ON cs.template_id = ct.id
      LEFT JOIN switchboards s ON cs.switchboard_id = s.id
      WHERE cs.site = $1
        AND cs.next_due_date <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY cs.next_due_date
    `, [site]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Group by day
    const weekPlan = {
      overdue: [],
      days: {}
    };

    // Initialize days
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      weekPlan.days[dateKey] = {
        date: dateKey,
        dayName: date.toLocaleDateString('fr-FR', { weekday: 'long' }),
        tasks: [],
        estimatedHours: 0
      };
    }

    result.rows.forEach(ctrl => {
      const dueDate = new Date(ctrl.next_due_date);
      dueDate.setHours(0, 0, 0, 0);

      const task = {
        id: ctrl.id,
        switchboard: ctrl.switchboard_name,
        code: ctrl.switchboard_code,
        template: ctrl.template_name,
        building: ctrl.building_code,
        floor: ctrl.floor,
        room: ctrl.room,
        dueDate: ctrl.next_due_date,
        estimatedDuration: 30
      };

      if (dueDate < today) {
        // Overdue
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        task.daysOverdue = daysOverdue;
        task.urgency = daysOverdue > 30 ? 'critical' : daysOverdue > 7 ? 'high' : 'medium';
        weekPlan.overdue.push(task);
      } else {
        // This week
        const dateKey = dueDate.toISOString().split('T')[0];
        if (weekPlan.days[dateKey]) {
          weekPlan.days[dateKey].tasks.push(task);
          weekPlan.days[dateKey].estimatedHours += 0.5; // 30 min per task
        }
      }
    });

    // Sort overdue by urgency
    weekPlan.overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Calculate totals
    const totalTasks = weekPlan.overdue.length + Object.values(weekPlan.days).reduce((acc, d) => acc + d.tasks.length, 0);
    const totalHours = weekPlan.overdue.length * 0.5 + Object.values(weekPlan.days).reduce((acc, d) => acc + d.estimatedHours, 0);

    res.json({
      site,
      generatedAt: new Date().toISOString(),
      summary: {
        totalTasks,
        overdueCount: weekPlan.overdue.length,
        criticalCount: weekPlan.overdue.filter(t => t.urgency === 'critical').length,
        estimatedTotalHours: Math.round(totalHours * 10) / 10
      },
      overdue: weekPlan.overdue,
      days: Object.values(weekPlan.days)
    });
  } catch (error) {
    console.error('[AI] Weekly plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check for AI assistant
app.get("/api/ai-assistant/health", (req, res) => {
  const providers = [];
  if (openai) providers.push('openai');
  if (geminiModel) providers.push('gemini');

  res.json({
    status: providers.length > 0 ? "active" : "fallback",
    providers,
    primaryProvider: openai ? "openai" : (geminiModel ? "gemini" : "local"),
    capabilities: {
      chat: true,
      documentSearch: true,
      chartGeneration: true,
      autonomousActions: true,
      databaseAccess: true
    },
    message: providers.length > 0
      ? `🚀 AI surpuissant actif (${providers.join(' + ')})`
      : "Mode fallback intelligent avec données DB"
  });
});

// >>> Infrastructure (plans électriques multi-zones) : re-stream pour uploads PDF
app.use("/api/infra", mkProxy(infraTarget, { withRestream: true }));

/* =================================================================
   Body parser APRES les proxys (pour nos routes locales uniquement)
   ================================================================= */
app.use(express.json({ limit: "25mb" }));

// -------- API de base ----------
app.get("/api/auth/me", async (req, res) => {
  const user = req.user || { id: "guest", name: "Guest", site: process.env.DEFAULT_SITE || "Nyon" };
  res.json(user);
});

// Parser local au niveau route (optionnel car express.json global est déjà monté)
app.post("/api/auth/login", express.json(), async (req, res) => {
  const { email, site = process.env.DEFAULT_SITE || "Nyon" } = req.body || {};
  const token = jwt.sign(
    { id: email || "user", name: email || "user", site },
    process.env.JWT_SECRET || "devsecret",
    { expiresIn: "7d" }  // Extended from 2h to 7 days
  );
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie("token", token, { httpOnly: true, sameSite: isProduction ? "none" : "lax", secure: isProduction });
  res.json({ ok: true });
});

app.post("/api/auth/logout", async (req, res) => {
  // Extraire l'utilisateur depuis le JWT avant de le supprimer
  try {
    const token = req.cookies?.token;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
      await logAuthEvent(req, 'LOGOUT', {
        email: decoded.email,
        name: decoded.name,
        user_id: decoded.id,
        company_id: decoded.company_id,
        site_id: decoded.site_id,
        role: decoded.role,
        source: decoded.source || 'unknown'
      });
    }
  } catch (e) {
    // Token invalide ou expiré - logger quand même
    await logAuthEvent(req, 'LOGOUT', { source: 'unknown', details: { reason: 'token_invalid' } });
  }
  res.clearCookie("token");
  res.json({ ok: true });
});

/* ================================================================
   🔥 Routes manquantes ajoutées pour compatibilité front actuelle
   ================================================================ */

// /api/auth/signin : Login pour utilisateurs externes (avec mot de passe)
app.post("/api/auth/signin", express.json(), async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }

  try {
    // 1️⃣ Chercher l'utilisateur dans la table users
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.password_hash, u.department_id, u.company_id, u.site_id,
              u.role, u.allowed_apps, u.is_active,
              s.name as site_name, d.name as department_name, c.name as company_name
       FROM users u
       LEFT JOIN sites s ON u.site_id = s.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      console.log(`[auth/signin] ❌ User not found: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'User not found' });
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }

    if (!user.is_active) {
      console.log(`[auth/signin] ❌ User inactive: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'Account inactive' });
      return res.status(401).json({ error: "Compte désactivé" });
    }

    if (!user.password_hash) {
      console.log(`[auth/signin] ❌ No password set for: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'No password set' });
      return res.status(401).json({ error: "Utilisez la connexion Bubble/SSO" });
    }

    // 2️⃣ Vérifier le mot de passe avec bcrypt
    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default || bcryptModule;
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      console.log(`[auth/signin] ❌ Invalid password for: ${email}`);
      await logAuthEvent(req, 'LOGIN_FAILED', { email, source: 'local', success: false, error: 'Invalid password' });
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }

    // 3️⃣ Créer le JWT avec toutes les infos tenant
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        site: user.site_name || 'Default',
        site_id: user.site_id,
        company_id: user.company_id,
        department_id: user.department_id,
        role: user.role || 'site',
        allowed_apps: user.allowed_apps,
        source: 'local'
      },
      process.env.JWT_SECRET || "devsecret",
      { expiresIn: "7d" }
    );

    // 4️⃣ Mettre à jour last_login
    await pool.query(
      `UPDATE users SET last_login = NOW() WHERE id = $1`,
      [user.id]
    ).catch(e => console.log(`[auth/signin] last_login update failed: ${e.message}`));

    // 5️⃣ Logger la connexion dans l'audit trail
    await logAuthEvent(req, 'LOGIN', {
      email: user.email,
      name: user.name,
      user_id: user.id,
      company_id: user.company_id,
      site_id: user.site_id,
      role: user.role,
      source: 'local',
      details: { site_name: user.site_name, company_name: user.company_name }
    });
    console.log(`[auth/signin] ✅ Login successful: ${email} (company=${user.company_id}, site=${user.site_id}, role=${user.role})`);

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", token, { httpOnly: true, sameSite: isProduction ? "none" : "lax", secure: isProduction });

    // Retourner les infos utilisateur complètes
    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        site: user.site_name,
        site_id: user.site_id,
        company_id: user.company_id,
        company: user.company_name,
        department: user.department_name,
        department_id: user.department_id,
        role: user.role || 'site',
        allowed_apps: user.allowed_apps
      }
    });

  } catch (err) {
    console.error(`[auth/signin] Error:`, err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// /api/auth/signup : placeholder pour inscription (à brancher sur DB plus tard)
app.post("/api/auth/signup", express.json(), async (_req, res) => {
  // TODO: insérer l'utilisateur en base (pool.query(...))
  res.status(201).json({ ok: true });
});

// /api/auth/me : Rafraîchit les permissions utilisateur depuis la DB
// Permet de synchroniser les changements faits par l'admin sans déconnexion
app.get("/api/auth/me", async (req, res) => {
  try {
    // 1️⃣ Extraire l'email depuis le JWT (cookie ou header)
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "devsecret");
    } catch (e) {
      return res.status(401).json({ error: "Token invalide" });
    }

    const email = decoded.email;
    if (!email) {
      return res.status(401).json({ error: "Email manquant dans le token" });
    }

    // 2️⃣ Récupérer les données actuelles depuis la DB
    // Chercher dans users (external users)
    let userData = null;
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.name, u.department_id, u.company_id, u.site_id,
              u.role, u.allowed_apps, u.origin,
              s.name as site_name, c.name as company_name, d.name as department_name
       FROM users u
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN companies c ON c.id = u.company_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [email]
    );
    userData = userResult.rows[0];

    // Si pas dans users, chercher dans haleon_users
    if (!userData) {
      const haleonResult = await pool.query(
        `SELECT h.id, h.email, h.name, h.department_id, h.site_id, h.allowed_apps,
                s.name as site_name, s.company_id, c.name as company_name, d.name as department_name
         FROM haleon_users h
         LEFT JOIN sites s ON s.id = h.site_id
         LEFT JOIN companies c ON c.id = s.company_id
         LEFT JOIN departments d ON d.id = h.department_id
         WHERE LOWER(h.email) = LOWER($1) LIMIT 1`,
        [email]
      );
      userData = haleonResult.rows[0];
      if (userData) {
        userData.origin = 'haleon';
        userData.role = userData.role || 'site';
      }
    }

    if (!userData) {
      // Utilisateur non trouvé en DB, retourner les infos du JWT
      return res.json({
        ok: true,
        user: {
          id: decoded.id,
          email: decoded.email,
          name: decoded.name,
          site: decoded.site,
          site_id: decoded.site_id,
          company_id: decoded.company_id,
          role: decoded.role || 'site',
          allowed_apps: decoded.allowed_apps,
          source: decoded.source
        },
        fromDb: false
      });
    }

    // 3️⃣ Retourner les données mises à jour depuis la DB
    console.log(`[auth/me] ✅ Refreshed permissions for ${email}: allowed_apps=${JSON.stringify(userData.allowed_apps)}`);

    res.json({
      ok: true,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name || userData.email.split('@')[0],
        site: userData.site_name,
        site_id: userData.site_id,
        company_id: userData.company_id,
        company: userData.company_name,
        department: userData.department_name,
        department_id: userData.department_id,
        role: userData.role || 'site',
        allowed_apps: userData.allowed_apps,
        origin: userData.origin,
        source: decoded.source || 'local'
      },
      fromDb: true
    });

  } catch (err) {
    console.error(`[auth/me] Error:`, err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ================================================================
   🔵 Auth via Bubble (nouvelle route)
   ================================================================ */
import { verifyBubbleToken, signLocalJWT } from "./auth-bubble.js";

app.post("/api/auth/bubble", express.json(), async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "Missing token" });

    // 1️⃣ Vérifie le token Bubble
    const user = await verifyBubbleToken(token);
    console.log(`[auth/bubble] 📧 User: ${user.email}`);

    // 2️⃣ Cherche l'utilisateur en base pour récupérer department_id, company_id, site_id
    // On cherche dans TOUTES les tables et on fusionne les données
    let haleonUser = null;
    let mainUser = null;

    // Chercher dans haleon_users
    try {
      const haleonResult = await pool.query(
        `SELECT id, email, name, department_id, site_id, allowed_apps
         FROM haleon_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [user.email]
      );
      haleonUser = haleonResult.rows[0] || null;
      console.log(`[auth/bubble] haleon_users: ${haleonUser ? JSON.stringify({ id: haleonUser.id, dept: haleonUser.department_id, site: haleonUser.site_id }) : 'NOT FOUND'}`);
    } catch (e) {
      console.log(`[auth/bubble] haleon_users ERROR: ${e.message}`);
    }

    // Chercher dans users
    try {
      const result = await pool.query(
        `SELECT id, email, name, department_id, company_id, site_id, role, allowed_apps
         FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [user.email]
      );
      mainUser = result.rows[0] || null;
      console.log(`[auth/bubble] users: ${mainUser ? JSON.stringify({ id: mainUser.id, dept: mainUser.department_id, company: mainUser.company_id, site: mainUser.site_id }) : 'NOT FOUND'}`);
    } catch (e) {
      console.log(`[auth/bubble] users ERROR: ${e.message}`);
    }

    // 3️⃣ Fusionner les données - priorité à haleon_users pour le department_id
    // car c'est là que le département est mis à jour depuis le dashboard
    const isHaleon = user.email && user.email.toLowerCase().endsWith('@haleon.com');

    // Utiliser les données de haleon_users en priorité si disponibles, sinon fallback sur users
    const department_id = haleonUser?.department_id || mainUser?.department_id || null;
    const site_id = haleonUser?.site_id || mainUser?.site_id || (isHaleon ? 1 : null);
    const company_id = mainUser?.company_id || (isHaleon ? 1 : null);
    const role = mainUser?.role || 'site';
    const allowed_apps = haleonUser?.allowed_apps || mainUser?.allowed_apps || null;

    console.log(`[auth/bubble] ✅ Merged: department_id=${department_id}, company_id=${company_id}, site_id=${site_id}`);

    // 4️⃣ Crée un JWT local enrichi avec les infos de la base
    const enrichedUser = {
      ...user,
      department_id,
      company_id,
      site_id,
      role,
      allowed_apps,
    };
    const jwtToken = signLocalJWT(enrichedUser);

    // 5️⃣ Logger la connexion dans l'audit trail
    await logAuthEvent(req, 'LOGIN', {
      email: enrichedUser.email,
      name: enrichedUser.name,
      user_id: mainUser?.id || haleonUser?.id,
      company_id,
      site_id,
      role,
      source: 'bubble',
      details: { isHaleon, site: enrichedUser.site }
    });

    // 6️⃣ Stocke en cookie + renvoie au front
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", jwtToken, {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction
    });
    res.json({ ok: true, user: enrichedUser, jwt: jwtToken });
  } catch (err) {
    console.error("Bubble auth failed:", err);
    await logAuthEvent(req, 'LOGIN_FAILED', { source: 'bubble', success: false, error: err.message });
    res.status(401).json({ error: err.message || "Invalid Bubble token" });
  }
});

/* ================================================================
   🔵 Save User Profile (department, site)
   ================================================================ */
app.put("/api/user/profile", express.json(), async (req, res) => {
  console.log(`[profile] 🔵 PUT /api/user/profile called`);
  console.log(`[profile] Body:`, req.body);
  console.log(`[profile] Cookies:`, req.cookies?.token ? 'present' : 'missing');
  console.log(`[profile] Auth header:`, req.headers.authorization ? 'present' : 'missing');

  try {
    // Get user from JWT token
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      console.log(`[profile] ❌ No token found`);
      return res.status(401).json({ error: "Not authenticated" });
    }

    const secret = process.env.JWT_SECRET || "devsecret";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr) {
      console.log(`[profile] ❌ JWT verify failed:`, jwtErr.message);
      return res.status(401).json({ error: "Invalid token: " + jwtErr.message });
    }

    const email = decoded.email;
    console.log(`[profile] 📧 Email from token: ${email}`);

    if (!email) {
      return res.status(401).json({ error: "Invalid token - no email" });
    }

    const { department_id, site_id } = req.body;
    console.log(`[profile] 📧 Updating user ${email}: department_id=${department_id}, site_id=${site_id}`);

    let dbUpdated = false;

    // Update haleon_users table (for @haleon.com users)
    if (email.toLowerCase().endsWith('@haleon.com')) {
      try {
        // Upsert into haleon_users
        await pool.query(`
          INSERT INTO haleon_users (email, department_id, site_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (email) DO UPDATE SET
            department_id = COALESCE($2, haleon_users.department_id),
            site_id = COALESCE($3, haleon_users.site_id),
            updated_at = NOW()
        `, [email.toLowerCase(), department_id, site_id || 1]);
        console.log(`[profile] ✅ Updated haleon_users for ${email}`);
        dbUpdated = true;
      } catch (haleonErr) {
        console.error(`[profile] ⚠️ haleon_users update failed:`, haleonErr.message);
        // Try alternate approach - just UPDATE if INSERT fails due to missing columns
        try {
          await pool.query(`
            UPDATE haleon_users SET
              department_id = COALESCE($2, department_id),
              site_id = COALESCE($3, site_id)
            WHERE LOWER(email) = LOWER($1)
          `, [email, department_id, site_id || 1]);
          console.log(`[profile] ✅ Updated haleon_users (UPDATE only) for ${email}`);
          dbUpdated = true;
        } catch (updateErr) {
          console.error(`[profile] ⚠️ haleon_users UPDATE also failed:`, updateErr.message);
        }
      }
    }

    // Also update users table if user exists there
    try {
      const result = await pool.query(`
        UPDATE users SET
          department_id = COALESCE($2, department_id),
          site_id = COALESCE($3, site_id),
          updated_at = NOW()
        WHERE LOWER(email) = LOWER($1)
        RETURNING id
      `, [email, department_id, site_id]);
      if (result.rowCount > 0) {
        console.log(`[profile] ✅ Updated users table for ${email}`);
        dbUpdated = true;
      }
    } catch (e) {
      console.log(`[profile] ⚠️ users table update skipped:`, e.message);
    }

    console.log(`[profile] DB updated: ${dbUpdated}`);

    // Generate a new JWT with updated info
    const newPayload = {
      ...decoded,
      department_id: department_id ?? decoded.department_id,
      site_id: site_id ?? decoded.site_id,
    };
    const newToken = jwt.sign(newPayload, secret, { expiresIn: "7d" });
    console.log(`[profile] ✅ New JWT generated with department_id=${newPayload.department_id}, site_id=${newPayload.site_id}`);

    // Set new cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie("token", newToken, {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction
    });

    res.json({ ok: true, user: newPayload, jwt: newToken });
  } catch (err) {
    console.error("[profile] ❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   🔵 Public endpoints for departments and sites (for profile selection)
   Same queries as admin endpoints to ensure consistency
   ================================================================ */
app.get("/api/departments", async (req, res) => {
  try {
    // Use same query as admin endpoint for consistency
    const result = await pool.query(`
      SELECT d.id, d.code, d.name, d.company_id, d.site_id,
             c.name as company_name, s.name as site_name
      FROM departments d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN sites s ON d.site_id = s.id
      ORDER BY d.name ASC
    `);
    console.log(`[departments] Found ${result.rows.length} departments from DB`);
    res.json({ departments: result.rows });
  } catch (err) {
    console.error(`[departments] Error:`, err.message);
    // Return empty array - don't use fallback data with wrong IDs
    res.json({ departments: [], error: err.message });
  }
});

app.get("/api/sites", async (req, res) => {
  try {
    // Use same query as admin endpoint for consistency
    const result = await pool.query(`
      SELECT s.id, s.code, s.name, s.company_id, s.city, s.country,
             c.name as company_name
      FROM sites s
      LEFT JOIN companies c ON s.company_id = c.id
      ORDER BY s.name ASC
    `);
    console.log(`[sites] Found ${result.rows.length} sites from DB`);
    res.json({ sites: result.rows });
  } catch (err) {
    console.error(`[sites] Error:`, err.message);
    // Return empty array - don't use fallback data with wrong IDs
    res.json({ sites: [], error: err.message });
  }
});

/* ================================================================
   🔵 Admin API Routes (gestion utilisateurs, exploration DB)
   ================================================================ */
app.use("/api/admin", adminRouter);

// -------- Static ----------
const __dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");

// Serve hashed assets with long cache (immutable)
app.use("/assets", express.static(path.join(__dist, "assets"), {
  maxAge: "1y",
  immutable: true
}));

// Serve other static files with short cache
app.use(express.static(__dist, {
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    // Never cache index.html - always fetch fresh
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

// SPA fallback - serve index.html with no-cache headers
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(__dist, "index.html"));
});

// -------- Auto-init essential tables -----------
async function addColumnIfNotExists(table, column, definition) {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  } catch (err) {
    // Column might already exist or table doesn't exist
  }
}

async function initEssentialTables() {
  try {
    // Create companies table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT UNIQUE,
        logo BYTEA,
        logo_mime TEXT DEFAULT 'image/png',
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Switzerland',
        is_internal BOOLEAN DEFAULT FALSE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[init] ✅ Table companies vérifiée');

    // Create sites table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        code TEXT,
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Switzerland',
        timezone TEXT DEFAULT 'Europe/Zurich',
        is_active BOOLEAN DEFAULT TRUE,
        settings JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add missing columns to sites
    await addColumnIfNotExists('sites', 'company_id', 'INTEGER');
    await addColumnIfNotExists('sites', 'code', 'TEXT');
    await addColumnIfNotExists('sites', 'address', 'TEXT');
    await addColumnIfNotExists('sites', 'city', 'TEXT');
    await addColumnIfNotExists('sites', 'country', "TEXT DEFAULT 'Switzerland'");
    await addColumnIfNotExists('sites', 'timezone', "TEXT DEFAULT 'Europe/Zurich'");
    await addColumnIfNotExists('sites', 'is_active', 'BOOLEAN DEFAULT TRUE');
    await addColumnIfNotExists('sites', 'settings', "JSONB DEFAULT '{}'::jsonb");
    console.log('[init] ✅ Table sites vérifiée + colonnes ajoutées');

    // Create departments table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        site_id INTEGER,
        code TEXT,
        name TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add missing columns to departments
    await addColumnIfNotExists('departments', 'company_id', 'INTEGER');
    await addColumnIfNotExists('departments', 'site_id', 'INTEGER');
    await addColumnIfNotExists('departments', 'code', 'TEXT');
    await addColumnIfNotExists('departments', 'description', 'TEXT');
    await addColumnIfNotExists('departments', 'is_active', 'BOOLEAN DEFAULT TRUE');
    console.log('[init] ✅ Table departments vérifiée + colonnes ajoutées');

  } catch (err) {
    console.error('[init] ⚠️ Error creating essential tables:', err.message);
  }
}

// -------- Start -----------
const port = process.env.PORT || 3000;
initEssentialTables().then(() => {
  app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
});
