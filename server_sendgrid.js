// server_sendgrid.js - SendGrid Email Service for Daily Outage Reports
// Sends daily email summaries with outages and AI agent insights

console.log('[SendGrid] 📧 Loading SendGrid email module...');

import express from 'express';
import sgMail from '@sendgrid/mail';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const router = express.Router();

// ============================================================
// SENDGRID CONFIGURATION
// ============================================================
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'admin@haleon-tool.io';
const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Haleon-tool';
const APP_URL = process.env.APP_URL || 'https://autonomix-elec.onrender.com';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log('[SendGrid] ✅ API key configured');
} else {
  console.warn('[SendGrid] ⚠️ SENDGRID_API_KEY not configured. Email sending disabled.');
}

// ============================================================
// AI AGENT CONFIGURATION WITH AVATARS
// ============================================================
const AGENT_AVATARS = {
  main: { name: 'Electro', color: '#3B82F6', icon: '⚡', description: 'Orchestrateur - vue globale' },
  vsd: { name: 'Shakira', color: '#F97316', icon: '🔄', description: 'Variateurs de fréquence' },
  meca: { name: 'Titan', color: '#64748B', icon: '⚙️', description: 'Équipements mécaniques' },
  glo: { name: 'Lumina', color: '#FBBF24', icon: '💡', description: 'Éclairage de sécurité' },
  hv: { name: 'Voltaire', color: '#DC2626', icon: '🔴', description: 'Haute tension' },
  mobile: { name: 'Nomad', color: '#0D9488', icon: '📱', description: 'Équipements mobiles' },
  atex: { name: 'Phoenix', color: '#F43F5E', icon: '🔥', description: 'Zones ATEX' },
  switchboard: { name: 'Matrix', color: '#8B5CF6', icon: '🎛️', description: 'Tableaux électriques' },
  doors: { name: 'Portal', color: '#06B6D4', icon: '🚪', description: 'Portes et accès' },
  datahub: { name: 'Nexus', color: '#22C55E', icon: '📊', description: 'Capteurs et monitoring' },
  firecontrol: { name: 'Blaze', color: '#EF4444', icon: '🧯', description: 'Sécurité incendie' }
};

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'devsecret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
let tablesInitialized = false;

async function initEmailTables() {
  if (tablesInitialized) return true;

  try {
    // Table for email subscriptions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_subscriptions (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255),
        site VARCHAR(100),
        daily_outage_report BOOLEAN DEFAULT TRUE,
        weekly_summary BOOLEAN DEFAULT TRUE,
        critical_alerts BOOLEAN DEFAULT TRUE,
        language VARCHAR(10) DEFAULT 'fr',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[SendGrid] email_subscriptions table ready');

    // Table for email history/logs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_history (
        id SERIAL PRIMARY KEY,
        email_to VARCHAR(255) NOT NULL,
        email_type VARCHAR(50) NOT NULL,
        subject VARCHAR(500),
        site VARCHAR(100),
        status VARCHAR(50) DEFAULT 'sent',
        sendgrid_message_id VARCHAR(255),
        error_message TEXT,
        sent_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[SendGrid] email_history table ready');

    // Create indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_subs_site ON email_subscriptions(site)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_history_date ON email_history(sent_at)`);

    tablesInitialized = true;
    console.log('[SendGrid] ✅ All tables initialized');
    return true;
  } catch (error) {
    console.error('[SendGrid] ❌ Table initialization error:', error.message);
    return false;
  }
}

// Initialize tables on module load
initEmailTables();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterdayDate() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Format date for display in French
 */
function formatDateFr(dateStr) {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateStr).toLocaleDateString('fr-FR', options);
}

/**
 * Get severity color for display
 */
function getSeverityColor(severity) {
  const colors = {
    critical: '#DC2626',
    major: '#F97316',
    minor: '#FBBF24',
    cosmetic: '#22C55E'
  };
  return colors[severity] || '#6B7280';
}

/**
 * Get severity label in French
 */
function getSeverityLabel(severity) {
  const labels = {
    critical: 'Critique',
    major: 'Majeur',
    minor: 'Mineur',
    cosmetic: 'Cosmétique'
  };
  return labels[severity] || severity;
}

/**
 * Get status label in French
 */
function getStatusLabel(status) {
  const labels = {
    completed: 'Résolu',
    in_progress: 'En cours',
    pending_review: 'En attente'
  };
  return labels[status] || status;
}

/**
 * Get status color
 */
function getStatusColor(status) {
  const colors = {
    completed: '#22C55E',
    in_progress: '#F97316',
    pending_review: '#6B7280'
  };
  return colors[status] || '#6B7280';
}

// ============================================================
// DATA FETCHING
// ============================================================

/**
 * Fetch outages from yesterday for a specific site
 */
async function getYesterdayOutages(site) {
  const yesterday = getYesterdayDate();

  try {
    const result = await pool.query(`
      SELECT
        id,
        equipment_type,
        equipment_name,
        equipment_code,
        building_code,
        floor,
        zone,
        title,
        description,
        root_cause,
        solution,
        category,
        severity,
        fault_type,
        status,
        started_at,
        completed_at,
        duration_minutes,
        downtime_minutes,
        technician_name,
        ai_diagnosis,
        ai_recommendations,
        created_at
      FROM troubleshooting_records
      WHERE site = $1
        AND DATE(created_at) = $2
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'major' THEN 2
          WHEN 'minor' THEN 3
          ELSE 4
        END,
        created_at DESC
    `, [site, yesterday]);

    return result.rows;
  } catch (error) {
    console.error('[SendGrid] Error fetching outages:', error.message);
    return [];
  }
}

/**
 * Fetch agent snapshots from yesterday for a specific site
 */
async function getYesterdayAgentSnapshots(site) {
  const yesterday = getYesterdayDate();

  try {
    const result = await pool.query(`
      SELECT
        agent_type,
        total_equipment,
        equipment_ok,
        equipment_warning,
        equipment_critical,
        controls_overdue,
        controls_due_today,
        controls_completed_today,
        troubleshooting_count,
        troubleshooting_resolved,
        troubleshooting_pending,
        nc_open,
        nc_closed_today,
        health_score,
        ai_summary,
        ai_insights,
        ai_recommendations
      FROM agent_daily_snapshots
      WHERE site = $1
        AND snapshot_date = $2
      ORDER BY
        CASE agent_type
          WHEN 'main' THEN 0
          ELSE 1
        END,
        agent_type
    `, [site, yesterday]);

    return result.rows;
  } catch (error) {
    console.error('[SendGrid] Error fetching agent snapshots:', error.message);
    return [];
  }
}

/**
 * Get overall stats for the day
 */
async function getDayStats(site) {
  const yesterday = getYesterdayDate();

  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_outages,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN severity = 'major' THEN 1 END) as major_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as resolved_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
        COALESCE(SUM(downtime_minutes), 0) as total_downtime,
        COALESCE(AVG(duration_minutes), 0) as avg_repair_time
      FROM troubleshooting_records
      WHERE site = $1
        AND DATE(created_at) = $2
    `, [site, yesterday]);

    return result.rows[0] || {};
  } catch (error) {
    console.error('[SendGrid] Error fetching day stats:', error.message);
    return {};
  }
}

// ============================================================
// EMAIL TEMPLATE GENERATION
// ============================================================

/**
 * Generate agent avatar SVG for email
 */
function generateAgentAvatarSVG(agentType, size = 40) {
  const agent = AGENT_AVATARS[agentType] || AGENT_AVATARS.main;
  const initial = agent.name.charAt(0).toUpperCase();

  return `
    <div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${agent.color}, ${agent.color}CC);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: ${size * 0.45}px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    ">${initial}</div>
  `;
}

/**
 * Generate the full HTML email template
 */
function generateDailyReportEmail(site, date, outages, agentSnapshots, stats) {
  const formattedDate = formatDateFr(date);
  const hasOutages = outages.length > 0;
  const hasAgentData = agentSnapshots.length > 0;

  // Group outages by equipment type
  const outagesByType = outages.reduce((acc, outage) => {
    const type = outage.equipment_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(outage);
    return acc;
  }, {});

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport quotidien des pannes - ${site}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; background: white; }
    .header { background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 30px; text-align: center; color: white; }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-bottom: 1px solid #e5e7eb; }
    .stat-box { padding: 20px; text-align: center; border-right: 1px solid #e5e7eb; }
    .stat-box:last-child { border-right: none; }
    .stat-value { font-size: 28px; font-weight: bold; color: #1e40af; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .section { padding: 25px; border-bottom: 1px solid #e5e7eb; }
    .section-title { font-size: 18px; font-weight: 600; color: #1f2937; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    .section-icon { width: 24px; height: 24px; }
    .outage-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .outage-table th { background: #f9fafb; padding: 12px 10px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; }
    .outage-table td { padding: 12px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .outage-table tr:hover { background: #f9fafb; }
    .severity-badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; color: white; }
    .status-badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
    .agent-card { display: flex; align-items: flex-start; gap: 15px; padding: 15px; background: #f9fafb; border-radius: 8px; margin-bottom: 12px; }
    .agent-avatar { flex-shrink: 0; }
    .agent-info { flex: 1; }
    .agent-name { font-weight: 600; color: #1f2937; margin-bottom: 4px; }
    .agent-domain { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
    .agent-summary { font-size: 13px; color: #374151; }
    .agent-stats { display: flex; gap: 15px; margin-top: 10px; flex-wrap: wrap; }
    .agent-stat { font-size: 12px; color: #6b7280; }
    .agent-stat strong { color: #1f2937; }
    .health-score { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; font-weight: bold; font-size: 12px; color: white; }
    .equipment-type-header { background: #e5e7eb; padding: 8px 12px; font-weight: 600; font-size: 13px; color: #374151; margin-top: 15px; border-radius: 4px 4px 0 0; }
    .no-data { text-align: center; padding: 40px; color: #6b7280; }
    .no-data-icon { font-size: 48px; margin-bottom: 15px; }
    .footer { background: #1f2937; padding: 25px; text-align: center; color: #9ca3af; font-size: 12px; }
    .footer a { color: #60a5fa; text-decoration: none; }
    @media (max-width: 600px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-box { border-bottom: 1px solid #e5e7eb; }
      .outage-table { font-size: 11px; }
      .outage-table th, .outage-table td { padding: 8px 6px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>📊 Rapport quotidien des pannes</h1>
      <p>${formattedDate} - Site: ${site}</p>
    </div>

    <!-- Stats Summary -->
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-value">${stats.total_outages || 0}</div>
        <div class="stat-label">Pannes totales</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #DC2626;">${stats.critical_count || 0}</div>
        <div class="stat-label">Critiques</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #22C55E;">${stats.resolved_count || 0}</div>
        <div class="stat-label">Résolues</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${Math.round(stats.total_downtime || 0)}<span style="font-size: 14px;">min</span></div>
        <div class="stat-label">Temps d'arrêt</div>
      </div>
    </div>

    ${hasAgentData ? `
    <!-- Agent Summaries -->
    <div class="section">
      <div class="section-title">
        <span>🤖</span> Résumé des Agents IA
      </div>
      ${agentSnapshots.map(snapshot => {
        const agent = AGENT_AVATARS[snapshot.agent_type] || AGENT_AVATARS.main;
        const healthColor = snapshot.health_score >= 80 ? '#22C55E' : snapshot.health_score >= 60 ? '#FBBF24' : '#DC2626';
        return `
        <div class="agent-card">
          <div class="agent-avatar">
            <div style="
              width: 50px;
              height: 50px;
              border-radius: 50%;
              background: linear-gradient(135deg, ${agent.color}, ${agent.color}CC);
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: bold;
              font-size: 18px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            ">${agent.icon}</div>
          </div>
          <div class="agent-info">
            <div class="agent-name">${agent.name}</div>
            <div class="agent-domain">${agent.description}</div>
            ${snapshot.ai_summary ? `<div class="agent-summary">${snapshot.ai_summary}</div>` : ''}
            <div class="agent-stats">
              <div class="agent-stat">
                <div class="health-score" style="background: ${healthColor};">${snapshot.health_score || '-'}%</div>
              </div>
              <div class="agent-stat">Équipements: <strong>${snapshot.total_equipment || 0}</strong> (${snapshot.equipment_ok || 0} OK, ${snapshot.equipment_warning || 0} ⚠️, ${snapshot.equipment_critical || 0} 🔴)</div>
              <div class="agent-stat">Dépannages: <strong>${snapshot.troubleshooting_count || 0}</strong> (${snapshot.troubleshooting_resolved || 0} résolus)</div>
              ${snapshot.controls_overdue > 0 ? `<div class="agent-stat" style="color: #DC2626;">Contrôles en retard: <strong>${snapshot.controls_overdue}</strong></div>` : ''}
            </div>
          </div>
        </div>
        `;
      }).join('')}
    </div>
    ` : ''}

    <!-- Outages Table -->
    <div class="section">
      <div class="section-title">
        <span>🔧</span> Détail des pannes
      </div>

      ${hasOutages ? `
        ${Object.entries(outagesByType).map(([type, typeOutages]) => {
          const agent = AGENT_AVATARS[type] || { name: type, color: '#6B7280', icon: '📦' };
          return `
          <div class="equipment-type-header">
            ${agent.icon} ${agent.name} - ${agent.description || type} (${typeOutages.length})
          </div>
          <table class="outage-table">
            <thead>
              <tr>
                <th style="width: 22%;">Équipement</th>
                <th style="width: 28%;">Problème</th>
                <th style="width: 12%;">Sévérité</th>
                <th style="width: 12%;">Statut</th>
                <th style="width: 13%;">Durée</th>
                <th style="width: 13%;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${typeOutages.map(outage => `
              <tr>
                <td>
                  <strong>${outage.equipment_name || outage.equipment_code || '-'}</strong>
                  ${outage.building_code ? `<br><span style="font-size: 11px; color: #6b7280;">📍 ${outage.building_code}${outage.floor ? ` / ${outage.floor}` : ''}</span>` : ''}
                </td>
                <td>
                  <strong>${outage.title}</strong>
                  ${outage.root_cause ? `<br><span style="font-size: 11px; color: #6b7280;">Cause: ${outage.root_cause}</span>` : ''}
                </td>
                <td>
                  <span class="severity-badge" style="background: ${getSeverityColor(outage.severity)};">
                    ${getSeverityLabel(outage.severity)}
                  </span>
                </td>
                <td>
                  <span class="status-badge" style="background: ${getStatusColor(outage.status)}20; color: ${getStatusColor(outage.status)};">
                    ${getStatusLabel(outage.status)}
                  </span>
                </td>
                <td>
                  ${outage.duration_minutes ? `${outage.duration_minutes} min` : '-'}
                  ${outage.downtime_minutes ? `<br><span style="font-size: 11px; color: #DC2626;">⏱️ ${outage.downtime_minutes} min arrêt</span>` : ''}
                </td>
                <td>
                  <a href="${APP_URL}/troubleshooting/${outage.id}" style="color: #3B82F6; text-decoration: none; font-weight: 500;">Voir →</a>
                </td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          `;
        }).join('')}
      ` : `
        <div class="no-data">
          <div class="no-data-icon">✅</div>
          <p><strong>Aucune panne enregistrée hier</strong></p>
          <p style="margin-top: 8px;">Excellente journée ! Tous les équipements ont fonctionné normalement.</p>
        </div>
      `}
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>Ce rapport a été généré automatiquement par Haleon-tool</p>
      <p style="margin-top: 10px;">
        <a href="#">Se désinscrire</a> |
        <a href="#">Préférences email</a> |
        <a href="${APP_URL}">Accéder à l'application</a>
      </p>
      <p style="margin-top: 15px; font-size: 11px;">© ${new Date().getFullYear()} Haleon-tool - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>
  `;
}

// ============================================================
// EMAIL SENDING
// ============================================================

/**
 * Send the daily outage report email
 */
async function sendDailyOutageReport(email, site) {
  if (!SENDGRID_API_KEY) {
    console.warn('[SendGrid] API key not configured, skipping email send');
    return { success: false, error: 'SendGrid API key not configured' };
  }

  const yesterday = getYesterdayDate();

  try {
    // Fetch all necessary data
    const [outages, agentSnapshots, stats] = await Promise.all([
      getYesterdayOutages(site),
      getYesterdayAgentSnapshots(site),
      getDayStats(site)
    ]);

    // Generate email HTML
    const htmlContent = generateDailyReportEmail(site, yesterday, outages, agentSnapshots, stats);

    // Prepare email
    const msg = {
      to: email,
      from: {
        email: SENDGRID_FROM_EMAIL,
        name: SENDGRID_FROM_NAME
      },
      subject: `📊 Rapport quotidien - ${site} - ${formatDateFr(yesterday)}`,
      html: htmlContent,
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true }
      }
    };

    // Send email
    const response = await sgMail.send(msg);

    // Log to database
    await pool.query(`
      INSERT INTO email_history (email_to, email_type, subject, site, status, sendgrid_message_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [email, 'daily_outage_report', msg.subject, site, 'sent', response[0]?.headers?.['x-message-id'] || null]);

    console.log(`[SendGrid] ✅ Daily report sent to ${email} for site ${site}`);
    return { success: true, messageId: response[0]?.headers?.['x-message-id'] };

  } catch (error) {
    console.error('[SendGrid] ❌ Error sending email:', error.message);

    // Log error to database
    await pool.query(`
      INSERT INTO email_history (email_to, email_type, subject, site, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [email, 'daily_outage_report', 'Failed to send', site, 'error', error.message]);

    return { success: false, error: error.message };
  }
}

/**
 * Send daily reports to all subscribers for a site
 */
async function sendDailyReportsToAllSubscribers(site) {
  try {
    const result = await pool.query(`
      SELECT email, name
      FROM email_subscriptions
      WHERE (site = $1 OR site IS NULL)
        AND daily_outage_report = TRUE
    `, [site]);

    const subscribers = result.rows;
    console.log(`[SendGrid] Sending daily reports to ${subscribers.length} subscribers for site ${site}`);

    const results = [];
    for (const subscriber of subscribers) {
      const sendResult = await sendDailyOutageReport(subscriber.email, site);
      results.push({ email: subscriber.email, ...sendResult });
    }

    return results;
  } catch (error) {
    console.error('[SendGrid] Error sending to all subscribers:', error.message);
    return [];
  }
}

// ============================================================
// SCHEDULED TASK - Daily Report at 7:00 AM
// ============================================================
function scheduleDailyReports() {
  const now = new Date();
  const scheduledHour = 7; // 7:00 AM
  const scheduledMinute = 0;

  // Calculate time until next scheduled run
  let nextRun = new Date(now);
  nextRun.setHours(scheduledHour, scheduledMinute, 0, 0);

  if (now >= nextRun) {
    // If it's past 7 AM today, schedule for tomorrow
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const msUntilNextRun = nextRun - now;

  console.log(`[SendGrid] 📅 Next daily report scheduled for: ${nextRun.toLocaleString()}`);

  setTimeout(async () => {
    console.log('[SendGrid] 📧 Running scheduled daily report...');

    try {
      // Get all unique sites with subscribers
      const sitesResult = await pool.query(`
        SELECT DISTINCT site FROM email_subscriptions WHERE site IS NOT NULL
      `);

      for (const row of sitesResult.rows) {
        await sendDailyReportsToAllSubscribers(row.site);
      }
    } catch (error) {
      console.error('[SendGrid] Error in scheduled report:', error.message);
    }

    // Schedule next run (24 hours later)
    setInterval(async () => {
      console.log('[SendGrid] 📧 Running scheduled daily report...');
      try {
        const sitesResult = await pool.query(`
          SELECT DISTINCT site FROM email_subscriptions WHERE site IS NOT NULL
        `);
        for (const row of sitesResult.rows) {
          await sendDailyReportsToAllSubscribers(row.site);
        }
      } catch (error) {
        console.error('[SendGrid] Error in scheduled report:', error.message);
      }
    }, 24 * 60 * 60 * 1000);

  }, msUntilNextRun);
}

// Start scheduler
scheduleDailyReports();

// ============================================================
// API ROUTES
// ============================================================

/**
 * POST /api/sendgrid/subscribe
 * Subscribe to email notifications
 */
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { email, name, site, daily_outage_report = true, weekly_summary = true, critical_alerts = true, language = 'fr' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    await pool.query(`
      INSERT INTO email_subscriptions (email, name, site, daily_outage_report, weekly_summary, critical_alerts, language)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        site = EXCLUDED.site,
        daily_outage_report = EXCLUDED.daily_outage_report,
        weekly_summary = EXCLUDED.weekly_summary,
        critical_alerts = EXCLUDED.critical_alerts,
        language = EXCLUDED.language,
        updated_at = NOW()
    `, [email, name, site, daily_outage_report, weekly_summary, critical_alerts, language]);

    console.log(`[SendGrid] ✅ Subscribed: ${email}`);
    res.json({ success: true, message: 'Subscription saved' });

  } catch (error) {
    console.error('[SendGrid] Subscribe error:', error.message);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

/**
 * DELETE /api/sendgrid/unsubscribe
 * Unsubscribe from email notifications
 */
router.delete('/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    await pool.query(`DELETE FROM email_subscriptions WHERE email = $1`, [email]);

    console.log(`[SendGrid] ✅ Unsubscribed: ${email}`);
    res.json({ success: true, message: 'Unsubscribed successfully' });

  } catch (error) {
    console.error('[SendGrid] Unsubscribe error:', error.message);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

/**
 * GET /api/sendgrid/subscriptions
 * Get subscription preferences
 */
router.get('/subscriptions', authenticateToken, async (req, res) => {
  try {
    const email = req.user.email || req.query.email;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await pool.query(`
      SELECT * FROM email_subscriptions WHERE email = $1
    `, [email]);

    res.json(result.rows[0] || null);

  } catch (error) {
    console.error('[SendGrid] Get subscriptions error:', error.message);
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
});

/**
 * POST /api/sendgrid/send-daily-report
 * Manually trigger daily report (admin only)
 */
router.post('/send-daily-report', authenticateToken, async (req, res) => {
  try {
    const { email, site } = req.body;

    if (!email || !site) {
      return res.status(400).json({ error: 'Email and site are required' });
    }

    const result = await sendDailyOutageReport(email, site);
    res.json(result);

  } catch (error) {
    console.error('[SendGrid] Manual send error:', error.message);
    res.status(500).json({ error: 'Failed to send report' });
  }
});

/**
 * POST /api/sendgrid/send-to-all
 * Send daily report to all subscribers for a site (admin only)
 */
router.post('/send-to-all', authenticateToken, async (req, res) => {
  try {
    const { site } = req.body;

    if (!site) {
      return res.status(400).json({ error: 'Site is required' });
    }

    const results = await sendDailyReportsToAllSubscribers(site);
    res.json({ success: true, results });

  } catch (error) {
    console.error('[SendGrid] Send to all error:', error.message);
    res.status(500).json({ error: 'Failed to send reports' });
  }
});

/**
 * GET /api/sendgrid/preview
 * Preview the daily report email (for testing - no auth required)
 */
router.get('/preview', async (req, res) => {
  try {
    const site = req.query.site || 'default';
    const yesterday = getYesterdayDate();

    const [outages, agentSnapshots, stats] = await Promise.all([
      getYesterdayOutages(site),
      getYesterdayAgentSnapshots(site),
      getDayStats(site)
    ]);

    const html = generateDailyReportEmail(site, yesterday, outages, agentSnapshots, stats);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('[SendGrid] Preview error:', error.message);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * GET /api/sendgrid/history
 * Get email sending history
 */
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, site } = req.query;

    let query = `
      SELECT * FROM email_history
      ${site ? 'WHERE site = $1' : ''}
      ORDER BY sent_at DESC
      LIMIT ${site ? '$2' : '$1'}
    `;

    const params = site ? [site, limit] : [limit];
    const result = await pool.query(query, params);

    res.json(result.rows);

  } catch (error) {
    console.error('[SendGrid] History error:', error.message);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

/**
 * GET /api/sendgrid/subscribers
 * Get all subscribers (admin only)
 */
router.get('/subscribers', authenticateToken, async (req, res) => {
  try {
    const { site } = req.query;

    let query = `SELECT * FROM email_subscriptions`;
    const params = [];

    if (site) {
      query += ` WHERE site = $1`;
      params.push(site);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (error) {
    console.error('[SendGrid] Get subscribers error:', error.message);
    res.status(500).json({ error: 'Failed to get subscribers' });
  }
});

// ============================================================
// EXPORTS
// ============================================================
export default router;
export { sendDailyOutageReport, sendDailyReportsToAllSubscribers, initEmailTables };
