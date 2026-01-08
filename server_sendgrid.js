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
 * Get yesterday's date in YYYY-MM-DD format (Paris timezone)
 */
function getYesterdayDate() {
  // Use Paris timezone
  const now = new Date();
  const parisTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  parisTime.setDate(parisTime.getDate() - 1);
  return parisTime.toISOString().split('T')[0];
}

/**
 * Format date for display in French (Paris timezone)
 */
function formatDateFr(dateStr) {
  const options = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Paris'
  };
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', options);
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

/**
 * Get current time in Paris timezone
 */
function getParisTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

/**
 * Get today's date in YYYY-MM-DD format (Paris timezone)
 */
function getTodayDate() {
  const parisTime = getParisTime();
  return parisTime.toISOString().split('T')[0];
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
function isWeekend(date) {
  const day = new Date(date + 'T12:00:00').getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Check if today is Monday (Paris timezone)
 */
function isMonday() {
  return getParisTime().getDay() === 1;
}

/**
 * Get date range for daily report
 * - Regular weekdays: yesterday only + overnight until 5:58
 * - Monday: Friday + Saturday + Sunday + overnight until 5:58
 */
function getDailyReportDateRange() {
  const parisTime = getParisTime();
  const today = getTodayDate();

  // Calculate cutoff time (5:58 AM today)
  const cutoffTime = new Date(today + 'T05:58:00');

  if (isMonday()) {
    // Monday: include Friday, Saturday, Sunday
    const friday = new Date(parisTime);
    friday.setDate(friday.getDate() - 3);
    return {
      startDate: friday.toISOString().split('T')[0],
      endDate: getYesterdayDate(),
      cutoffTime: cutoffTime,
      isWeekendRecap: true,
      label: 'Récapitulatif du weekend (Ven-Dim)'
    };
  } else {
    // Regular weekday: yesterday only
    return {
      startDate: getYesterdayDate(),
      endDate: getYesterdayDate(),
      cutoffTime: cutoffTime,
      isWeekendRecap: false,
      label: 'Hier'
    };
  }
}

/**
 * Get date range for last 7 days
 */
function getWeeklyDateRange() {
  const parisTime = getParisTime();
  const endDate = new Date(parisTime);
  endDate.setDate(endDate.getDate() - 1); // Yesterday

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6); // 7 days ago

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0]
  };
}

/**
 * Get date range for last month
 */
function getMonthlyDateRange() {
  const parisTime = getParisTime();

  // Last month's first and last day
  const lastMonth = new Date(parisTime.getFullYear(), parisTime.getMonth() - 1, 1);
  const lastDayOfLastMonth = new Date(parisTime.getFullYear(), parisTime.getMonth(), 0);

  return {
    startDate: lastMonth.toISOString().split('T')[0],
    endDate: lastDayOfLastMonth.toISOString().split('T')[0],
    monthName: lastMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
  };
}

/**
 * Format date range for display
 */
function formatDateRangeFr(startDate, endDate) {
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');

  if (startDate === endDate) {
    return formatDateFr(startDate);
  }

  const startStr = start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const endStr = end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

  return `${startStr} au ${endStr}`;
}

/**
 * Generate QuickChart URL for a chart
 * Uses QuickChart.io service to generate chart images
 */
function generateChartUrl(config, width = 500, height = 300) {
  const chartConfig = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${chartConfig}&w=${width}&h=${height}&bkg=white`;
}

// ============================================================
// DATA FETCHING
// ============================================================

/**
 * Fetch outages for a date range (enhanced for daily reports)
 * Includes overnight issues from today until cutoff time
 */
async function getOutagesForDateRange(site, startDate, endDate, cutoffTime = null) {
  try {
    let query = `
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
        AND (
          DATE(created_at) BETWEEN $2 AND $3
    `;

    const params = [site, startDate, endDate];

    // Include overnight issues if cutoff time provided
    if (cutoffTime) {
      query += `
          OR (DATE(created_at) = $4 AND created_at <= $5)
      `;
      const todayDate = getTodayDate();
      params.push(todayDate, cutoffTime.toISOString());
    }

    query += `
        )
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'major' THEN 2
          WHEN 'minor' THEN 3
          ELSE 4
        END,
        created_at DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('[SendGrid] Error fetching outages:', error.message);
    return [];
  }
}

/**
 * Fetch outages from yesterday for a specific site (legacy compatibility)
 */
async function getYesterdayOutages(site) {
  return getOutagesForDateRange(site, getYesterdayDate(), getYesterdayDate());
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

/**
 * Get stats for a date range (for daily/weekly/monthly reports)
 */
async function getStatsForDateRange(site, startDate, endDate, cutoffTime = null) {
  try {
    let query = `
      SELECT
        COUNT(*) as total_outages,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN severity = 'major' THEN 1 END) as major_count,
        COUNT(CASE WHEN severity = 'minor' THEN 1 END) as minor_count,
        COUNT(CASE WHEN severity = 'cosmetic' THEN 1 END) as cosmetic_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as resolved_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN fault_type = 'breakdown' THEN 1 END) as breakdowns,
        COUNT(CASE WHEN fault_type = 'preventive' THEN 1 END) as preventive_count,
        COUNT(CASE WHEN fault_type = 'corrective' THEN 1 END) as corrective_count,
        COALESCE(SUM(downtime_minutes), 0) as total_downtime,
        COALESCE(AVG(duration_minutes), 0) as avg_repair_time,
        COUNT(DISTINCT equipment_id) as unique_equipment,
        COUNT(DISTINCT technician_email) as technicians_count
      FROM troubleshooting_records
      WHERE site = $1
        AND (
          DATE(created_at) BETWEEN $2 AND $3
    `;

    const params = [site, startDate, endDate];

    if (cutoffTime) {
      query += `
          OR (DATE(created_at) = $4 AND created_at <= $5)
      `;
      const todayDate = getTodayDate();
      params.push(todayDate, cutoffTime.toISOString());
    }

    query += `
        )
    `;

    const result = await pool.query(query, params);
    return result.rows[0] || {};
  } catch (error) {
    console.error('[SendGrid] Error fetching range stats:', error.message);
    return {};
  }
}

/**
 * Get daily breakdown for charts (outages per day)
 */
async function getDailyBreakdown(site, startDate, endDate) {
  try {
    const result = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN severity = 'major' THEN 1 END) as major,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as resolved,
        COALESCE(SUM(downtime_minutes), 0) as downtime
      FROM troubleshooting_records
      WHERE site = $1
        AND DATE(created_at) BETWEEN $2 AND $3
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `, [site, startDate, endDate]);

    return result.rows;
  } catch (error) {
    console.error('[SendGrid] Error fetching daily breakdown:', error.message);
    return [];
  }
}

/**
 * Get equipment type breakdown (for risk analysis)
 */
async function getEquipmentTypeBreakdown(site, startDate, endDate) {
  try {
    const result = await pool.query(`
      SELECT
        equipment_type,
        COUNT(*) as incident_count,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN severity = 'major' THEN 1 END) as major_count,
        COALESCE(SUM(downtime_minutes), 0) as total_downtime,
        COALESCE(AVG(duration_minutes), 0) as avg_repair_time
      FROM troubleshooting_records
      WHERE site = $1
        AND DATE(created_at) BETWEEN $2 AND $3
      GROUP BY equipment_type
      ORDER BY incident_count DESC
    `, [site, startDate, endDate]);

    return result.rows;
  } catch (error) {
    console.error('[SendGrid] Error fetching equipment breakdown:', error.message);
    return [];
  }
}

/**
 * Get most problematic equipment for the period
 */
async function getProblematicEquipment(site, startDate, endDate, limit = 5) {
  try {
    const result = await pool.query(`
      SELECT
        equipment_type,
        equipment_name,
        equipment_code,
        building_code,
        COUNT(*) as incident_count,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COALESCE(SUM(downtime_minutes), 0) as total_downtime
      FROM troubleshooting_records
      WHERE site = $1
        AND DATE(created_at) BETWEEN $2 AND $3
      GROUP BY equipment_type, equipment_name, equipment_code, building_code
      HAVING COUNT(*) >= 2
      ORDER BY incident_count DESC, critical_count DESC
      LIMIT $4
    `, [site, startDate, endDate, limit]);

    return result.rows;
  } catch (error) {
    console.error('[SendGrid] Error fetching problematic equipment:', error.message);
    return [];
  }
}

/**
 * Get control/maintenance stats for the period
 */
async function getMaintenanceStats(site, startDate, endDate) {
  try {
    // Try to get control records - this table may not exist in all setups
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_controls,
        COUNT(CASE WHEN status = 'conform' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'non_conform' THEN 1 END) as non_conform,
        COUNT(CASE WHEN status = 'partial' THEN 1 END) as partial
      FROM control_records
      WHERE site = $1
        AND DATE(performed_at) BETWEEN $2 AND $3
    `, [site, startDate, endDate]);

    return result.rows[0] || { total_controls: 0, completed: 0, non_conform: 0, partial: 0 };
  } catch (error) {
    // Table may not exist
    console.log('[SendGrid] Control records not available:', error.message);
    return { total_controls: 0, completed: 0, non_conform: 0, partial: 0 };
  }
}

/**
 * Get overdue controls count
 */
async function getOverdueControls(site) {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as overdue_count
      FROM control_schedules
      WHERE site = $1
        AND status = 'overdue'
    `, [site]);

    return parseInt(result.rows[0]?.overdue_count || 0);
  } catch (error) {
    console.log('[SendGrid] Control schedules not available:', error.message);
    return 0;
  }
}

/**
 * Get agent snapshots aggregated for a date range
 */
async function getAgentSnapshotsForRange(site, startDate, endDate) {
  try {
    const result = await pool.query(`
      SELECT
        agent_type,
        AVG(health_score) as avg_health_score,
        SUM(troubleshooting_count) as total_troubleshooting,
        SUM(troubleshooting_resolved) as total_resolved,
        AVG(total_equipment) as avg_equipment,
        AVG(equipment_critical) as avg_critical,
        SUM(controls_completed_today) as total_controls_completed
      FROM agent_daily_snapshots
      WHERE site = $1
        AND snapshot_date BETWEEN $2 AND $3
      GROUP BY agent_type
      ORDER BY
        CASE agent_type
          WHEN 'main' THEN 0
          ELSE 1
        END,
        agent_type
    `, [site, startDate, endDate]);

    return result.rows;
  } catch (error) {
    console.error('[SendGrid] Error fetching agent snapshots range:', error.message);
    return [];
  }
}

/**
 * Calculate risk score for equipment types based on incidents
 */
function calculateRiskScores(equipmentBreakdown, totalIncidents) {
  return equipmentBreakdown.map(eq => {
    const incidentWeight = (parseInt(eq.incident_count) / Math.max(totalIncidents, 1)) * 40;
    const criticalWeight = (parseInt(eq.critical_count) / Math.max(parseInt(eq.incident_count), 1)) * 35;
    const downtimeWeight = Math.min((parseInt(eq.total_downtime) / 60) / 10, 1) * 25; // Cap at 10 hours

    const riskScore = Math.round(incidentWeight + criticalWeight + downtimeWeight);

    return {
      ...eq,
      risk_score: Math.min(riskScore, 100), // Cap at 100
      risk_level: riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low'
    };
  });
}

// ============================================================
// CHART GENERATION FOR EMAILS
// ============================================================

/**
 * Generate incidents per day bar chart URL
 */
function generateIncidentsChart(dailyData, width = 600, height = 250) {
  const labels = dailyData.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  });

  const config = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Critiques',
          data: dailyData.map(d => parseInt(d.critical) || 0),
          backgroundColor: '#DC2626'
        },
        {
          label: 'Majeurs',
          data: dailyData.map(d => parseInt(d.major) || 0),
          backgroundColor: '#F97316'
        },
        {
          label: 'Autres',
          data: dailyData.map(d => Math.max(0, parseInt(d.total) - parseInt(d.critical || 0) - parseInt(d.major || 0))),
          backgroundColor: '#3B82F6'
        }
      ]
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        title: { display: true, text: 'Incidents par jour' }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  };

  return generateChartUrl(config, width, height);
}

/**
 * Generate severity distribution doughnut chart URL
 */
function generateSeverityChart(stats, width = 300, height = 250) {
  const config = {
    type: 'doughnut',
    data: {
      labels: ['Critiques', 'Majeurs', 'Mineurs', 'Cosmétiques'],
      datasets: [{
        data: [
          parseInt(stats.critical_count) || 0,
          parseInt(stats.major_count) || 0,
          parseInt(stats.minor_count) || 0,
          parseInt(stats.cosmetic_count) || 0
        ],
        backgroundColor: ['#DC2626', '#F97316', '#FBBF24', '#22C55E']
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        title: { display: true, text: 'Répartition par sévérité' }
      }
    }
  };

  return generateChartUrl(config, width, height);
}

/**
 * Generate risk by equipment type horizontal bar chart URL
 */
function generateRiskChart(riskData, width = 500, height = 300) {
  const topRisks = riskData.slice(0, 6);
  const agentNames = {
    vsd: 'VSD', meca: 'Méca', glo: 'Éclairage', hv: 'HT',
    mobile: 'Mobile', atex: 'ATEX', switchboard: 'Tableaux',
    doors: 'Portes', datahub: 'Datahub', firecontrol: 'Incendie'
  };

  const config = {
    type: 'horizontalBar',
    data: {
      labels: topRisks.map(r => agentNames[r.equipment_type] || r.equipment_type),
      datasets: [{
        label: 'Score de risque',
        data: topRisks.map(r => r.risk_score),
        backgroundColor: topRisks.map(r =>
          r.risk_level === 'high' ? '#DC2626' :
          r.risk_level === 'medium' ? '#F97316' : '#22C55E'
        )
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Analyse des risques par domaine' }
      },
      scales: {
        x: { max: 100, beginAtZero: true }
      }
    }
  };

  return generateChartUrl(config, width, height);
}

/**
 * Generate health score trend line chart URL
 */
function generateHealthTrendChart(dailyData, width = 600, height = 250) {
  const labels = dailyData.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  });

  // Calculate a simple health indicator: resolved percentage
  const healthScores = dailyData.map(d => {
    const total = parseInt(d.total) || 1;
    const resolved = parseInt(d.resolved) || 0;
    return Math.round((resolved / total) * 100);
  });

  const config = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Taux de résolution (%)',
        data: healthScores,
        borderColor: '#22C55E',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        title: { display: true, text: 'Taux de résolution quotidien' }
      },
      scales: {
        y: { min: 0, max: 100 }
      }
    }
  };

  return generateChartUrl(config, width, height);
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
 * Structure: For each agent with data, show agent info + their troubleshooting table
 */
function generateDailyReportEmail(site, date, outages, agentSnapshots, stats, agentImages = {}, agentCustomNames = {}) {
  const formattedDate = formatDateFr(date);
  const hasOutages = outages.length > 0;

  // Group outages by equipment type (agent type)
  const outagesByAgent = outages.reduce((acc, outage) => {
    const type = outage.equipment_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(outage);
    return acc;
  }, {});

  // Create a map of agent snapshots by type
  const snapshotsByAgent = {};
  agentSnapshots.forEach(snapshot => {
    snapshotsByAgent[snapshot.agent_type] = snapshot;
  });

  // Get all agent types that have either snapshots or outages
  const allAgentTypes = new Set([
    ...Object.keys(outagesByAgent),
    ...Object.keys(snapshotsByAgent)
  ]);

  // Filter to only agents with data (outages or meaningful snapshot data)
  const agentsWithData = Array.from(allAgentTypes).filter(agentType => {
    const hasOutagesForAgent = outagesByAgent[agentType]?.length > 0;
    const snapshot = snapshotsByAgent[agentType];
    const hasSnapshotData = snapshot && (
      snapshot.troubleshooting_count > 0 ||
      snapshot.equipment_critical > 0 ||
      snapshot.controls_overdue > 0 ||
      snapshot.nc_open > 0
    );
    return hasOutagesForAgent || hasSnapshotData;
  });

  // Sort agents: main first, then by number of outages
  agentsWithData.sort((a, b) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    const outagesA = outagesByAgent[a]?.length || 0;
    const outagesB = outagesByAgent[b]?.length || 0;
    return outagesB - outagesA;
  });

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
    .container { max-width: 900px; margin: 0 auto; background: white; }
    .header { background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 30px; text-align: center; color: white; }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-bottom: 1px solid #e5e7eb; }
    .stat-box { padding: 20px; text-align: center; border-right: 1px solid #e5e7eb; }
    .stat-box:last-child { border-right: none; }
    .stat-value { font-size: 28px; font-weight: bold; color: #1e40af; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .agent-section { border-bottom: 2px solid #e5e7eb; }
    .agent-header { display: flex; align-items: center; gap: 15px; padding: 20px 25px; background: linear-gradient(to right, #f8fafc, #ffffff); }
    .agent-avatar { width: 70px; height: 70px; border-radius: 12px; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .agent-avatar-fallback { width: 70px; height: 70px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-size: 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .agent-header-info { flex: 1; }
    .agent-name { font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 2px; }
    .agent-domain { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
    .agent-summary { font-size: 13px; color: #374151; line-height: 1.5; }
    .agent-metrics { display: flex; gap: 20px; margin-top: 10px; flex-wrap: wrap; }
    .agent-metric { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b7280; }
    .agent-metric strong { color: #1f2937; font-size: 14px; }
    .health-badge { display: inline-flex; align-items: center; justify-content: center; padding: 4px 10px; border-radius: 20px; font-weight: 600; font-size: 12px; color: white; }
    .outage-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .outage-table th { background: #f1f5f9; padding: 12px 15px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
    .outage-table td { padding: 12px 15px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .outage-table tr:last-child td { border-bottom: none; }
    .outage-table tr:hover { background: #f8fafc; }
    .severity-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; color: white; }
    .status-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
    .no-outages { padding: 20px 25px; text-align: center; color: #6b7280; font-size: 13px; background: #f9fafb; }
    .no-data { text-align: center; padding: 60px 25px; color: #6b7280; }
    .no-data-icon { font-size: 56px; margin-bottom: 15px; }
    .footer { background: #1f2937; padding: 25px; text-align: center; color: #9ca3af; font-size: 12px; }
    @media (max-width: 600px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-box { border-bottom: 1px solid #e5e7eb; }
      .agent-header { flex-direction: column; text-align: center; }
      .agent-metrics { justify-content: center; }
      .outage-table { font-size: 11px; }
      .outage-table th, .outage-table td { padding: 8px 10px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>📊 Rapport quotidien des dépannages</h1>
      <p>${formattedDate} • Site: ${site}</p>
    </div>

    <!-- Stats Summary -->
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-value">${stats.total_outages || 0}</div>
        <div class="stat-label">Dépannages</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #DC2626;">${stats.critical_count || 0}</div>
        <div class="stat-label">Critiques</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #22C55E;">${stats.resolved_count || 0}</div>
        <div class="stat-label">Résolus</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${Math.round(stats.total_downtime || 0)}<span style="font-size: 14px;">min</span></div>
        <div class="stat-label">Temps d'arrêt</div>
      </div>
    </div>

    ${agentsWithData.length > 0 ? agentsWithData.map(agentType => {
      const agent = AGENT_AVATARS[agentType] || AGENT_AVATARS.main;
      const snapshot = snapshotsByAgent[agentType];
      const agentOutages = outagesByAgent[agentType] || [];
      const healthScore = snapshot?.health_score || null;
      const healthColor = healthScore >= 80 ? '#22C55E' : healthScore >= 60 ? '#FBBF24' : '#DC2626';
      const imageData = agentImages[agentType];
      // Use CID for email attachments, HTTP URL for browser preview
      const imageUrl = imageData?.hasCid ? `cid:${imageData.cid}` : imageData?.httpUrl || null;
      const agentName = agentCustomNames[agentType] || agent.name;

      return `
      <!-- Agent Section: ${agentName} -->
      <div class="agent-section">
        <div class="agent-header">
          ${imageUrl ? `
            <img src="${imageUrl}" alt="${agentName}" class="agent-avatar" style="width: 70px; height: 70px; border-radius: 12px; object-fit: cover;" />
          ` : `
            <div class="agent-avatar-fallback" style="background: linear-gradient(135deg, ${agent.color}, ${agent.color}CC);">
              ${agent.icon}
            </div>
          `}
          <div class="agent-header-info">
            <div class="agent-name">${agentName}</div>
            <div class="agent-domain">${agent.description}</div>
            ${snapshot?.ai_summary ? `<div class="agent-summary">${snapshot.ai_summary}</div>` : ''}
            <div class="agent-metrics">
              ${healthScore !== null ? `
                <div class="agent-metric">
                  <span class="health-badge" style="background: ${healthColor};">${healthScore}%</span>
                  <span>Santé</span>
                </div>
              ` : ''}
              ${snapshot ? `
                <div class="agent-metric">
                  <strong>${snapshot.total_equipment || 0}</strong> équipements
                  ${snapshot.equipment_critical > 0 ? `<span style="color: #DC2626;">(${snapshot.equipment_critical} 🔴)</span>` : ''}
                </div>
                <div class="agent-metric">
                  <strong>${agentOutages.length}</strong> dépannages hier
                </div>
                ${snapshot.controls_overdue > 0 ? `
                  <div class="agent-metric" style="color: #DC2626;">
                    <strong>${snapshot.controls_overdue}</strong> contrôles en retard
                  </div>
                ` : ''}
              ` : `
                <div class="agent-metric">
                  <strong>${agentOutages.length}</strong> dépannages hier
                </div>
              `}
            </div>
          </div>
        </div>

        ${agentOutages.length > 0 ? `
          <table class="outage-table">
            <thead>
              <tr>
                <th style="width: 25%;">Équipement</th>
                <th style="width: 30%;">Problème</th>
                <th style="width: 12%;">Sévérité</th>
                <th style="width: 12%;">Statut</th>
                <th style="width: 12%;">Durée</th>
                <th style="width: 9%;">Lien</th>
              </tr>
            </thead>
            <tbody>
              ${agentOutages.map(outage => `
              <tr>
                <td>
                  <strong>${outage.equipment_name || outage.equipment_code || '-'}</strong>
                  ${outage.building_code ? `<br><span style="font-size: 11px; color: #6b7280;">📍 ${outage.building_code}${outage.floor ? ` / ${outage.floor}` : ''}</span>` : ''}
                </td>
                <td>
                  <strong>${outage.title || '-'}</strong>
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
                  ${outage.downtime_minutes ? `<br><span style="font-size: 11px; color: #DC2626;">⏱️ ${outage.downtime_minutes}min</span>` : ''}
                </td>
                <td>
                  <a href="${APP_URL}/app/troubleshooting/${outage.id}" style="color: #3B82F6; text-decoration: none; font-weight: 500;">Voir →</a>
                </td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="no-outages">
            ✅ Aucun dépannage enregistré hier pour cet agent
          </div>
        `}
      </div>
      `;
    }).join('') : `
      <div class="no-data">
        <div class="no-data-icon">✅</div>
        <p style="font-size: 18px; font-weight: 600; color: #1f2937;">Aucun dépannage enregistré hier</p>
        <p style="margin-top: 10px;">Excellente journée ! Tous les équipements ont fonctionné normalement.</p>
      </div>
    `}

    <!-- Footer -->
    <div class="footer">
      <p>Ce rapport a été généré automatiquement par Haleon-tool</p>
      <p style="margin-top: 15px; font-size: 11px;">© ${new Date().getFullYear()} Haleon-tool - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate Weekly KPI Report Email Template
 * Beautiful email with charts, KPIs, risk analysis, and agent summaries
 */
function generateWeeklyReportEmail(site, dateRange, stats, dailyBreakdown, riskData, problematicEquipment, agentSnapshots, agentImages = {}, agentCustomNames = {}) {
  const { startDate, endDate } = dateRange;
  const formattedRange = formatDateRangeFr(startDate, endDate);

  // Generate chart URLs
  const incidentsChartUrl = dailyBreakdown.length > 0 ? generateIncidentsChart(dailyBreakdown) : null;
  const severityChartUrl = generateSeverityChart(stats);
  const riskChartUrl = riskData.length > 0 ? generateRiskChart(riskData) : null;
  const healthChartUrl = dailyBreakdown.length > 0 ? generateHealthTrendChart(dailyBreakdown) : null;

  // Calculate KPIs
  const totalOutages = parseInt(stats.total_outages) || 0;
  const resolvedCount = parseInt(stats.resolved_count) || 0;
  const resolutionRate = totalOutages > 0 ? Math.round((resolvedCount / totalOutages) * 100) : 100;
  const avgRepairTime = Math.round(parseFloat(stats.avg_repair_time) || 0);
  const totalDowntime = Math.round(parseInt(stats.total_downtime) || 0);
  const downtimeHours = (totalDowntime / 60).toFixed(1);

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport hebdomadaire - ${site}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; background: white; }
    .header { background: linear-gradient(135deg, #7c3aed, #a855f7); padding: 35px; text-align: center; color: white; }
    .header h1 { font-size: 26px; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-bottom: 2px solid #e5e7eb; }
    .kpi-box { padding: 25px 15px; text-align: center; border-right: 1px solid #e5e7eb; }
    .kpi-box:last-child { border-right: none; }
    .kpi-value { font-size: 32px; font-weight: bold; color: #1f2937; }
    .kpi-label { font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px; }
    .kpi-trend { font-size: 12px; margin-top: 5px; }
    .kpi-trend.positive { color: #22C55E; }
    .kpi-trend.negative { color: #DC2626; }
    .section { padding: 25px; border-bottom: 1px solid #e5e7eb; }
    .section-title { font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    .chart-container { text-align: center; margin: 20px 0; }
    .chart-container img { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .charts-row { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; }
    .charts-row .chart-item { flex: 1; min-width: 280px; max-width: 400px; }
    .risk-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    .risk-table th, .risk-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    .risk-table th { background: #f8fafc; font-weight: 600; color: #475569; }
    .risk-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; color: white; }
    .risk-high { background: #DC2626; }
    .risk-medium { background: #F97316; }
    .risk-low { background: #22C55E; }
    .agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
    .agent-card { background: #f8fafc; border-radius: 12px; padding: 15px; text-align: center; }
    .agent-avatar { width: 60px; height: 60px; border-radius: 10px; margin: 0 auto 10px; object-fit: cover; }
    .agent-avatar-fallback { width: 60px; height: 60px; border-radius: 10px; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; }
    .agent-name { font-weight: 600; color: #1f2937; }
    .agent-stats { font-size: 12px; color: #6b7280; margin-top: 5px; }
    .agent-health { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; color: white; margin-top: 8px; }
    .problematic-list { margin-top: 15px; }
    .problematic-item { display: flex; align-items: center; gap: 15px; padding: 12px; background: #fef2f2; border-left: 4px solid #DC2626; margin-bottom: 10px; border-radius: 0 8px 8px 0; }
    .problematic-info { flex: 1; }
    .problematic-name { font-weight: 600; color: #1f2937; }
    .problematic-details { font-size: 12px; color: #6b7280; }
    .footer { background: #1f2937; padding: 25px; text-align: center; color: #9ca3af; font-size: 12px; }
    @media (max-width: 600px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .kpi-box { border-bottom: 1px solid #e5e7eb; }
      .charts-row { flex-direction: column; }
      .agent-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>📈 Rapport hebdomadaire</h1>
      <p>${formattedRange} • Site: ${site}</p>
    </div>

    <!-- KPI Summary -->
    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-value">${totalOutages}</div>
        <div class="kpi-label">Total interventions</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-value" style="color: ${resolutionRate >= 80 ? '#22C55E' : resolutionRate >= 60 ? '#F97316' : '#DC2626'};">${resolutionRate}%</div>
        <div class="kpi-label">Taux de résolution</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-value">${avgRepairTime}<span style="font-size: 14px;">min</span></div>
        <div class="kpi-label">Temps moyen réparation</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-value" style="color: #DC2626;">${downtimeHours}<span style="font-size: 14px;">h</span></div>
        <div class="kpi-label">Temps d'arrêt total</div>
      </div>
    </div>

    <!-- Charts Section -->
    ${dailyBreakdown.length > 0 ? `
    <div class="section">
      <div class="section-title">📊 Évolution sur 7 jours</div>
      <div class="charts-row">
        ${incidentsChartUrl ? `
        <div class="chart-item">
          <img src="${incidentsChartUrl}" alt="Incidents par jour" />
        </div>
        ` : ''}
        ${healthChartUrl ? `
        <div class="chart-item">
          <img src="${healthChartUrl}" alt="Taux de résolution" />
        </div>
        ` : ''}
      </div>
    </div>
    ` : ''}

    <!-- Severity & Risk Analysis -->
    <div class="section">
      <div class="section-title">⚠️ Analyse des risques</div>
      <div class="charts-row">
        <div class="chart-item">
          <img src="${severityChartUrl}" alt="Répartition par sévérité" />
        </div>
        ${riskChartUrl && riskData.length > 0 ? `
        <div class="chart-item">
          <img src="${riskChartUrl}" alt="Risques par domaine" />
        </div>
        ` : ''}
      </div>

      ${riskData.length > 0 ? `
      <table class="risk-table">
        <thead>
          <tr>
            <th>Domaine</th>
            <th>Incidents</th>
            <th>Critiques</th>
            <th>Temps d'arrêt</th>
            <th>Risque</th>
          </tr>
        </thead>
        <tbody>
          ${riskData.slice(0, 6).map(r => `
          <tr>
            <td><strong>${AGENT_AVATARS[r.equipment_type]?.name || r.equipment_type}</strong></td>
            <td>${r.incident_count}</td>
            <td style="color: #DC2626;">${r.critical_count}</td>
            <td>${Math.round(r.total_downtime / 60 * 10) / 10}h</td>
            <td><span class="risk-badge risk-${r.risk_level}">${r.risk_score}%</span></td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}
    </div>

    <!-- Problematic Equipment -->
    ${problematicEquipment.length > 0 ? `
    <div class="section">
      <div class="section-title">🔴 Équipements problématiques</div>
      <div class="problematic-list">
        ${problematicEquipment.map(eq => `
        <div class="problematic-item">
          <div class="problematic-info">
            <div class="problematic-name">${eq.equipment_name || eq.equipment_code}</div>
            <div class="problematic-details">
              ${AGENT_AVATARS[eq.equipment_type]?.name || eq.equipment_type} •
              ${eq.building_code || '-'} •
              ${eq.incident_count} incidents •
              ${eq.critical_count} critiques •
              ${Math.round(eq.total_downtime)}min d'arrêt
            </div>
          </div>
        </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Agent Summary -->
    ${agentSnapshots.length > 0 ? `
    <div class="section">
      <div class="section-title">🤖 Performance des agents IA</div>
      <div class="agent-grid">
        ${agentSnapshots.filter(s => s.agent_type !== 'main').map(snapshot => {
          const agent = AGENT_AVATARS[snapshot.agent_type] || AGENT_AVATARS.main;
          const avgHealth = Math.round(parseFloat(snapshot.avg_health_score) || 0);
          const healthColor = avgHealth >= 80 ? '#22C55E' : avgHealth >= 60 ? '#FBBF24' : '#DC2626';
          const imageData = agentImages[snapshot.agent_type];
          const imageUrl = imageData?.hasCid ? 'cid:' + imageData.cid : imageData?.httpUrl || null;
          const agentName = agentCustomNames[snapshot.agent_type] || agent.name;

          return '<div class="agent-card">' +
            (imageUrl ?
              '<img src="' + imageUrl + '" alt="' + agentName + '" class="agent-avatar" />' :
              '<div class="agent-avatar-fallback" style="background: linear-gradient(135deg, ' + agent.color + ', ' + agent.color + 'CC);">' + agent.icon + '</div>'
            ) +
            '<div class="agent-name">' + agentName + '</div>' +
            '<div class="agent-stats">' + (parseInt(snapshot.total_troubleshooting) || 0) + ' dépannages • ' + (parseInt(snapshot.total_resolved) || 0) + ' résolus</div>' +
            '<div class="agent-health" style="background: ' + healthColor + ';">Santé: ' + avgHealth + '%</div>' +
          '</div>';
        }).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Footer -->
    <div class="footer">
      <p>Ce rapport a été généré automatiquement par Haleon-tool</p>
      <p style="margin-top: 15px; font-size: 11px;">© ${new Date().getFullYear()} Haleon-tool - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate Monthly KPI Report Email Template
 * Comprehensive monthly analysis with trends and comparisons
 */
function generateMonthlyReportEmail(site, dateRange, stats, dailyBreakdown, riskData, problematicEquipment, maintenanceStats, agentSnapshots, agentImages = {}, agentCustomNames = {}) {
  const { startDate, endDate, monthName } = dateRange;

  // Generate chart URLs
  const incidentsChartUrl = dailyBreakdown.length > 0 ? generateIncidentsChart(dailyBreakdown, 700, 300) : null;
  const severityChartUrl = generateSeverityChart(stats);
  const riskChartUrl = riskData.length > 0 ? generateRiskChart(riskData, 600, 350) : null;

  // Calculate KPIs
  const totalOutages = parseInt(stats.total_outages) || 0;
  const resolvedCount = parseInt(stats.resolved_count) || 0;
  const resolutionRate = totalOutages > 0 ? Math.round((resolvedCount / totalOutages) * 100) : 100;
  const avgRepairTime = Math.round(parseFloat(stats.avg_repair_time) || 0);
  const totalDowntime = Math.round(parseInt(stats.total_downtime) || 0);
  const downtimeHours = (totalDowntime / 60).toFixed(1);
  const breakdowns = parseInt(stats.breakdowns) || 0;
  const preventive = parseInt(stats.preventive_count) || 0;

  // Maintenance KPIs
  const totalControls = parseInt(maintenanceStats.total_controls) || 0;
  const controlsCompleted = parseInt(maintenanceStats.completed) || 0;
  const controlsNonConform = parseInt(maintenanceStats.non_conform) || 0;

  // Helper to generate agent cards
  const generateAgentCards = () => {
    if (agentSnapshots.length === 0) return '';
    return agentSnapshots.filter(s => s.agent_type !== 'main').map(snapshot => {
      const agent = AGENT_AVATARS[snapshot.agent_type] || AGENT_AVATARS.main;
      const avgHealth = Math.round(parseFloat(snapshot.avg_health_score) || 0);
      const healthColor = avgHealth >= 80 ? '#22C55E' : avgHealth >= 60 ? '#FBBF24' : '#DC2626';
      const imageData = agentImages[snapshot.agent_type];
      const imageUrl = imageData?.hasCid ? 'cid:' + imageData.cid : imageData?.httpUrl || null;
      const agentName = agentCustomNames[snapshot.agent_type] || agent.name;

      return '<div class="agent-card">' +
        (imageUrl ?
          '<img src="' + imageUrl + '" alt="' + agentName + '" class="agent-avatar" />' :
          '<div class="agent-avatar-fallback" style="background: linear-gradient(135deg, ' + agent.color + ', ' + agent.color + 'CC);">' + agent.icon + '</div>'
        ) +
        '<div class="agent-name">' + agentName + '</div>' +
        '<div class="agent-health" style="background: ' + healthColor + ';">' + avgHealth + '%</div>' +
      '</div>';
    }).join('');
  };

  // Helper to generate risk table rows
  const generateRiskRows = () => {
    return riskData.slice(0, 8).map(r => {
      const agentName = AGENT_AVATARS[r.equipment_type]?.name || r.equipment_type;
      return '<tr><td><strong>' + agentName + '</strong></td>' +
        '<td>' + r.incident_count + '</td>' +
        '<td style="color: #DC2626;">' + r.critical_count + '</td>' +
        '<td>' + (Math.round(r.total_downtime / 60 * 10) / 10) + 'h</td>' +
        '<td><span class="risk-badge risk-' + r.risk_level + '">' + r.risk_score + '%</span></td></tr>';
    }).join('');
  };

  const resolutionColor = resolutionRate >= 80 ? '#22C55E' : resolutionRate >= 60 ? '#F97316' : '#DC2626';

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport mensuel - ${site}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; background: white; }
    .header { background: linear-gradient(135deg, #0ea5e9, #38bdf8); padding: 40px; text-align: center; color: white; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 16px; }
    .summary-banner { background: #f0f9ff; padding: 20px 25px; border-bottom: 2px solid #0ea5e9; }
    .summary-text { font-size: 15px; color: #0369a1; line-height: 1.8; }
    .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; border-bottom: 2px solid #e5e7eb; }
    .kpi-box { padding: 25px 10px; text-align: center; border-right: 1px solid #e5e7eb; }
    .kpi-box:last-child { border-right: none; }
    .kpi-value { font-size: 28px; font-weight: bold; color: #1f2937; }
    .kpi-label { font-size: 10px; color: #6b7280; text-transform: uppercase; margin-top: 5px; }
    .section { padding: 25px; border-bottom: 1px solid #e5e7eb; }
    .section-title { font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    .chart-container { text-align: center; margin: 20px 0; }
    .chart-container img { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .charts-row { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; }
    .charts-row .chart-item { flex: 1; min-width: 280px; max-width: 450px; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px; }
    .stat-card { background: #f8fafc; border-radius: 12px; padding: 20px; text-align: center; }
    .stat-card-value { font-size: 24px; font-weight: bold; color: #1f2937; }
    .stat-card-label { font-size: 12px; color: #6b7280; margin-top: 5px; }
    .risk-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    .risk-table th, .risk-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    .risk-table th { background: #f8fafc; font-weight: 600; color: #475569; }
    .risk-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; color: white; }
    .risk-high { background: #DC2626; }
    .risk-medium { background: #F97316; }
    .risk-low { background: #22C55E; }
    .agent-row { display: flex; flex-wrap: wrap; gap: 15px; margin-top: 15px; }
    .agent-card { flex: 1; min-width: 150px; background: #f8fafc; border-radius: 12px; padding: 15px; text-align: center; }
    .agent-avatar { width: 50px; height: 50px; border-radius: 8px; margin: 0 auto 10px; object-fit: cover; }
    .agent-avatar-fallback { width: 50px; height: 50px; border-radius: 8px; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; }
    .agent-name { font-weight: 600; font-size: 14px; color: #1f2937; }
    .agent-health { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; color: white; margin-top: 5px; }
    .footer { background: #1f2937; padding: 25px; text-align: center; color: #9ca3af; font-size: 12px; }
    @media (max-width: 600px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .kpi-box { border-bottom: 1px solid #e5e7eb; }
      .stats-grid { grid-template-columns: 1fr; }
      .agent-row { justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>📅 Rapport mensuel</h1>
      <p>${monthName} • Site: ${site}</p>
    </div>

    <!-- Summary Banner -->
    <div class="summary-banner">
      <div class="summary-text">
        <strong>Résumé du mois:</strong>
        ${totalOutages} interventions enregistrées dont ${parseInt(stats.critical_count) || 0} critiques et ${parseInt(stats.major_count) || 0} majeures.
        Taux de résolution de ${resolutionRate}% avec un temps moyen de réparation de ${avgRepairTime} minutes.
        ${breakdowns > 0 ? breakdowns + ' pannes totales.' : ''}
        ${preventive > 0 ? preventive + ' maintenances préventives réalisées.' : ''}
      </div>
    </div>

    <!-- KPI Summary -->
    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-value">${totalOutages}</div>
        <div class="kpi-label">Interventions</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-value" style="color: ${resolutionColor};">${resolutionRate}%</div>
        <div class="kpi-label">Résolution</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-value">${avgRepairTime}<span style="font-size: 12px;">min</span></div>
        <div class="kpi-label">MTTR</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-value" style="color: #DC2626;">${downtimeHours}<span style="font-size: 12px;">h</span></div>
        <div class="kpi-label">Arrêt total</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-value">${parseInt(stats.unique_equipment) || 0}</div>
        <div class="kpi-label">Équip. touchés</div>
      </div>
    </div>

    <!-- Intervention Types -->
    <div class="section">
      <div class="section-title">📊 Répartition des interventions</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-value" style="color: #DC2626;">${breakdowns}</div>
          <div class="stat-card-label">Pannes</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style="color: #F97316;">${parseInt(stats.corrective_count) || 0}</div>
          <div class="stat-card-label">Correctives</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style="color: #22C55E;">${preventive}</div>
          <div class="stat-card-label">Préventives</div>
        </div>
      </div>
    </div>

    ${totalControls > 0 ? `
    <!-- Maintenance/Controls -->
    <div class="section">
      <div class="section-title">🔧 Maintenance planifiée</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-value">${totalControls}</div>
          <div class="stat-card-label">Contrôles effectués</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style="color: #22C55E;">${controlsCompleted}</div>
          <div class="stat-card-label">Conformes</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style="color: #DC2626;">${controlsNonConform}</div>
          <div class="stat-card-label">Non conformes</div>
        </div>
      </div>
    </div>
    ` : ''}

    ${dailyBreakdown.length > 0 ? `
    <!-- Charts -->
    <div class="section">
      <div class="section-title">📈 Évolution mensuelle</div>
      <div class="chart-container">
        <img src="${incidentsChartUrl}" alt="Incidents par jour" />
      </div>
    </div>
    ` : ''}

    ${riskData.length > 0 ? `
    <!-- Risk Analysis -->
    <div class="section">
      <div class="section-title">⚠️ Analyse des risques par domaine</div>
      <div class="charts-row">
        <div class="chart-item">
          <img src="${severityChartUrl}" alt="Répartition sévérité" />
        </div>
        <div class="chart-item">
          <img src="${riskChartUrl}" alt="Risques par domaine" />
        </div>
      </div>
      <table class="risk-table">
        <thead>
          <tr>
            <th>Domaine</th>
            <th>Incidents</th>
            <th>Critiques</th>
            <th>Temps d'arrêt</th>
            <th>Score risque</th>
          </tr>
        </thead>
        <tbody>
          ${generateRiskRows()}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${agentSnapshots.length > 0 ? `
    <!-- Agent Performance -->
    <div class="section">
      <div class="section-title">🤖 Synthèse des agents IA</div>
      <div class="agent-row">
        ${generateAgentCards()}
      </div>
    </div>
    ` : ''}

    <!-- Footer -->
    <div class="footer">
      <p>Ce rapport a été généré automatiquement par Haleon-tool</p>
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
 * Get agent images data for embedding in emails (CID attachments)
 * Returns both the list of agents with images AND the actual binary data
 */
async function getAgentImagesData() {
  try {
    const result = await pool.query(`
      SELECT key, binary_data, mime_type FROM app_settings
      WHERE key LIKE 'ai_image_%' AND binary_data IS NOT NULL
    `);

    const agentImages = {};
    const attachments = [];

    result.rows.forEach(row => {
      const agentType = row.key.replace('ai_image_', '');
      const cid = `agent-${agentType}-image`;

      agentImages[agentType] = {
        hasCid: true,
        cid: cid
      };

      // Add as attachment for SendGrid
      attachments.push({
        content: row.binary_data.toString('base64'),
        filename: `${agentType}.${row.mime_type?.split('/')[1] || 'png'}`,
        type: row.mime_type || 'image/png',
        disposition: 'inline',
        content_id: cid
      });
    });

    return { agentImages, attachments };
  } catch (error) {
    console.error('[SendGrid] Error fetching agent images:', error.message);
    return { agentImages: {}, attachments: [] };
  }
}

/**
 * Get agent images info for preview (uses HTTP URLs, not CID)
 */
async function getAgentImagesForPreview() {
  try {
    const result = await pool.query(`
      SELECT key FROM app_settings
      WHERE key LIKE 'ai_image_%' AND binary_data IS NOT NULL
    `);

    const agentImages = {};
    result.rows.forEach(row => {
      const agentType = row.key.replace('ai_image_', '');
      agentImages[agentType] = {
        hasCid: false,
        httpUrl: `${APP_URL}/api/admin/settings/ai-agents/${agentType}/image`
      };
    });

    return agentImages;
  } catch (error) {
    console.error('[SendGrid] Error fetching agent images for preview:', error.message);
    return {};
  }
}

/**
 * Get custom agent names from database
 */
async function getAgentCustomNames() {
  try {
    const result = await pool.query(`
      SELECT key, text_value FROM app_settings
      WHERE key LIKE 'ai_agent_name_%'
    `);

    const customNames = {};
    result.rows.forEach(row => {
      const agentType = row.key.replace('ai_agent_name_', '');
      if (row.text_value) {
        customNames[agentType] = row.text_value;
      }
    });

    return customNames;
  } catch (error) {
    console.error('[SendGrid] Error fetching agent names:', error.message);
    return {};
  }
}

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
    // Fetch all necessary data including agent images and custom names
    const [outages, agentSnapshots, stats, agentImagesData, agentCustomNames] = await Promise.all([
      getYesterdayOutages(site),
      getYesterdayAgentSnapshots(site),
      getDayStats(site),
      getAgentImagesData(),
      getAgentCustomNames()
    ]);

    const { agentImages, attachments } = agentImagesData;

    // Generate email HTML
    const htmlContent = generateDailyReportEmail(site, yesterday, outages, agentSnapshots, stats, agentImages, agentCustomNames);

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

    // Add inline image attachments if any
    if (attachments.length > 0) {
      msg.attachments = attachments;
      console.log(`[SendGrid] Including ${attachments.length} inline image(s) in email`);
    }

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

/**
 * Send weekly KPI report email
 */
async function sendWeeklyReport(email, site) {
  if (!SENDGRID_API_KEY) {
    console.warn('[SendGrid] API key not configured, skipping email send');
    return { success: false, error: 'SendGrid API key not configured' };
  }

  try {
    const dateRange = getWeeklyDateRange();
    const { startDate, endDate } = dateRange;

    // Fetch all data for the week
    const [stats, dailyBreakdown, equipmentBreakdown, problematicEquipment, agentSnapshots, agentImagesData, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getProblematicEquipment(site, startDate, endDate),
      getAgentSnapshotsForRange(site, startDate, endDate),
      getAgentImagesData(),
      getAgentCustomNames()
    ]);

    const { agentImages, attachments } = agentImagesData;

    // Calculate risk scores
    const totalIncidents = parseInt(stats.total_outages) || 0;
    const riskData = calculateRiskScores(equipmentBreakdown, totalIncidents);

    // Generate email HTML
    const htmlContent = generateWeeklyReportEmail(site, dateRange, stats, dailyBreakdown, riskData, problematicEquipment, agentSnapshots, agentImages, agentCustomNames);

    // Prepare email
    const msg = {
      to: email,
      from: {
        email: SENDGRID_FROM_EMAIL,
        name: SENDGRID_FROM_NAME
      },
      subject: `📈 Rapport hebdomadaire - ${site} - ${formatDateRangeFr(startDate, endDate)}`,
      html: htmlContent,
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true }
      }
    };

    if (attachments.length > 0) {
      msg.attachments = attachments;
    }

    const response = await sgMail.send(msg);

    await pool.query(`
      INSERT INTO email_history (email_to, email_type, subject, site, status, sendgrid_message_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [email, 'weekly_report', msg.subject, site, 'sent', response[0]?.headers?.['x-message-id'] || null]);

    console.log(`[SendGrid] ✅ Weekly report sent to ${email} for site ${site}`);
    return { success: true, messageId: response[0]?.headers?.['x-message-id'] };

  } catch (error) {
    console.error('[SendGrid] ❌ Error sending weekly report:', error.message);
    await pool.query(`
      INSERT INTO email_history (email_to, email_type, subject, site, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [email, 'weekly_report', 'Failed to send', site, 'error', error.message]);
    return { success: false, error: error.message };
  }
}

/**
 * Send weekly reports to all subscribers for a site
 */
async function sendWeeklyReportsToAllSubscribers(site) {
  try {
    const result = await pool.query(`
      SELECT email, name
      FROM email_subscriptions
      WHERE (site = $1 OR site IS NULL)
        AND weekly_summary = TRUE
    `, [site]);

    const subscribers = result.rows;
    console.log(`[SendGrid] Sending weekly reports to ${subscribers.length} subscribers for site ${site}`);

    const results = [];
    for (const subscriber of subscribers) {
      const sendResult = await sendWeeklyReport(subscriber.email, site);
      results.push({ email: subscriber.email, ...sendResult });
    }

    return results;
  } catch (error) {
    console.error('[SendGrid] Error sending weekly reports:', error.message);
    return [];
  }
}

/**
 * Send monthly KPI report email
 */
async function sendMonthlyReport(email, site) {
  if (!SENDGRID_API_KEY) {
    console.warn('[SendGrid] API key not configured, skipping email send');
    return { success: false, error: 'SendGrid API key not configured' };
  }

  try {
    const dateRange = getMonthlyDateRange();
    const { startDate, endDate, monthName } = dateRange;

    // Fetch all data for the month
    const [stats, dailyBreakdown, equipmentBreakdown, problematicEquipment, maintenanceStats, agentSnapshots, agentImagesData, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getProblematicEquipment(site, startDate, endDate, 10),
      getMaintenanceStats(site, startDate, endDate),
      getAgentSnapshotsForRange(site, startDate, endDate),
      getAgentImagesData(),
      getAgentCustomNames()
    ]);

    const { agentImages, attachments } = agentImagesData;

    // Calculate risk scores
    const totalIncidents = parseInt(stats.total_outages) || 0;
    const riskData = calculateRiskScores(equipmentBreakdown, totalIncidents);

    // Generate email HTML
    const htmlContent = generateMonthlyReportEmail(site, dateRange, stats, dailyBreakdown, riskData, problematicEquipment, maintenanceStats, agentSnapshots, agentImages, agentCustomNames);

    // Prepare email
    const msg = {
      to: email,
      from: {
        email: SENDGRID_FROM_EMAIL,
        name: SENDGRID_FROM_NAME
      },
      subject: `📅 Rapport mensuel - ${site} - ${monthName}`,
      html: htmlContent,
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true }
      }
    };

    if (attachments.length > 0) {
      msg.attachments = attachments;
    }

    const response = await sgMail.send(msg);

    await pool.query(`
      INSERT INTO email_history (email_to, email_type, subject, site, status, sendgrid_message_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [email, 'monthly_report', msg.subject, site, 'sent', response[0]?.headers?.['x-message-id'] || null]);

    console.log(`[SendGrid] ✅ Monthly report sent to ${email} for site ${site}`);
    return { success: true, messageId: response[0]?.headers?.['x-message-id'] };

  } catch (error) {
    console.error('[SendGrid] ❌ Error sending monthly report:', error.message);
    await pool.query(`
      INSERT INTO email_history (email_to, email_type, subject, site, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [email, 'monthly_report', 'Failed to send', site, 'error', error.message]);
    return { success: false, error: error.message };
  }
}

/**
 * Send monthly reports to all subscribers for a site
 */
async function sendMonthlyReportsToAllSubscribers(site) {
  try {
    const result = await pool.query(`
      SELECT email, name
      FROM email_subscriptions
      WHERE (site = $1 OR site IS NULL)
        AND weekly_summary = TRUE
    `, [site]);

    const subscribers = result.rows;
    console.log(`[SendGrid] Sending monthly reports to ${subscribers.length} subscribers for site ${site}`);

    const results = [];
    for (const subscriber of subscribers) {
      const sendResult = await sendMonthlyReport(subscriber.email, site);
      results.push({ email: subscriber.email, ...sendResult });
    }

    return results;
  } catch (error) {
    console.error('[SendGrid] Error sending monthly reports:', error.message);
    return [];
  }
}

// ============================================================
// SCHEDULED TASKS
// ============================================================

/**
 * Get the next valid weekday for daily reports
 * Skips Saturday and Sunday
 */
function getNextWeekday(date) {
  const next = new Date(date);
  const day = next.getDay();

  // If Saturday, move to Monday
  if (day === 6) next.setDate(next.getDate() + 2);
  // If Sunday, move to Monday
  else if (day === 0) next.setDate(next.getDate() + 1);

  return next;
}

/**
 * Check if we should send daily report today
 * Returns false on Saturday and Sunday
 */
function shouldSendDailyToday() {
  const parisTime = getParisTime();
  const day = parisTime.getDay();
  return day !== 0 && day !== 6; // Not Sunday (0) or Saturday (6)
}

/**
 * Schedule all email reports
 */
function scheduleAllReports() {
  console.log('[SendGrid] 📅 Initializing email schedulers...');

  // Helper to get all sites with subscribers
  async function getAllSites() {
    const result = await pool.query(`
      SELECT DISTINCT site FROM email_subscriptions WHERE site IS NOT NULL
    `);
    return result.rows.map(r => r.site);
  }

  // ========================================
  // DAILY REPORT - 5:59 AM (Mon-Fri only)
  // ========================================
  function scheduleDailyReport() {
    const runDaily = async () => {
      const parisTime = getParisTime();
      const day = parisTime.getDay();

      // Skip weekends (Saturday = 6, Sunday = 0)
      if (day === 0 || day === 6) {
        console.log('[SendGrid] ⏭️ Skipping daily report (weekend)');
        return;
      }

      console.log(`[SendGrid] 📧 Running daily report... ${isMonday() ? '(Monday - includes weekend recap)' : ''}`);

      try {
        const sites = await getAllSites();
        for (const site of sites) {
          await sendDailyReportsToAllSubscribers(site);
        }
      } catch (error) {
        console.error('[SendGrid] Error in daily report:', error.message);
      }
    };

    // Calculate time until 5:59 AM
    const now = new Date();
    let nextRun = new Date(now);
    nextRun.setHours(5, 59, 0, 0);

    if (now >= nextRun) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    // Skip to Monday if it's weekend
    nextRun = getNextWeekday(nextRun);

    const msUntilFirstRun = nextRun - now;
    console.log(`[SendGrid] 📅 Next daily report: ${nextRun.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);

    setTimeout(() => {
      runDaily();
      // Then run every 24 hours (but check for weekend in the function)
      setInterval(runDaily, 24 * 60 * 60 * 1000);
    }, msUntilFirstRun);
  }

  // ========================================
  // WEEKLY REPORT - Monday 6:01 AM
  // ========================================
  function scheduleWeeklyReport() {
    const runWeekly = async () => {
      console.log('[SendGrid] 📈 Running weekly report...');
      try {
        const sites = await getAllSites();
        for (const site of sites) {
          await sendWeeklyReportsToAllSubscribers(site);
        }
      } catch (error) {
        console.error('[SendGrid] Error in weekly report:', error.message);
      }
    };

    // Calculate time until next Monday 6:01 AM
    const now = new Date();
    let nextMonday = new Date(now);
    nextMonday.setHours(6, 1, 0, 0);

    // Find next Monday
    const daysUntilMonday = (8 - nextMonday.getDay()) % 7 || 7;
    if (nextMonday.getDay() !== 1 || now >= nextMonday) {
      nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    }

    const msUntilFirstRun = nextMonday - now;
    console.log(`[SendGrid] 📅 Next weekly report: ${nextMonday.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);

    setTimeout(() => {
      runWeekly();
      // Then run every 7 days
      setInterval(runWeekly, 7 * 24 * 60 * 60 * 1000);
    }, msUntilFirstRun);
  }

  // ========================================
  // MONTHLY REPORT - 1st of month 6:30 AM
  // ========================================
  function scheduleMonthlyReport() {
    const runMonthly = async () => {
      console.log('[SendGrid] 📅 Running monthly report...');
      try {
        const sites = await getAllSites();
        for (const site of sites) {
          await sendMonthlyReportsToAllSubscribers(site);
        }
      } catch (error) {
        console.error('[SendGrid] Error in monthly report:', error.message);
      }
    };

    // Calculate time until next 1st of month at 6:30 AM
    const now = new Date();
    let nextFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1, 6, 30, 0);

    // If it's already past 6:30 on the 1st, schedule for next month
    if (now.getDate() === 1 && now.getHours() < 6) {
      nextFirst = new Date(now.getFullYear(), now.getMonth(), 1, 6, 30, 0);
    }

    const msUntilFirstRun = nextFirst - now;
    console.log(`[SendGrid] 📅 Next monthly report: ${nextFirst.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);

    setTimeout(() => {
      runMonthly();
      // Schedule next month - use recursive setTimeout for variable month lengths
      const scheduleNextMonth = () => {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        nextMonth.setHours(6, 30, 0, 0);

        const msUntilNext = nextMonth - new Date();
        setTimeout(() => {
          runMonthly();
          scheduleNextMonth();
        }, msUntilNext);
      };
      scheduleNextMonth();
    }, msUntilFirstRun);
  }

  // Start all schedulers
  scheduleDailyReport();
  scheduleWeeklyReport();
  scheduleMonthlyReport();
}

// Start all schedulers
scheduleAllReports();

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

    const [outages, agentSnapshots, stats, agentImages, agentCustomNames] = await Promise.all([
      getYesterdayOutages(site),
      getYesterdayAgentSnapshots(site),
      getDayStats(site),
      getAgentImagesForPreview(),
      getAgentCustomNames()
    ]);

    const html = generateDailyReportEmail(site, yesterday, outages, agentSnapshots, stats, agentImages, agentCustomNames);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('[SendGrid] Preview error:', error.message);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * GET /api/sendgrid/test-send
 * Send a test daily email (for admin testing - no auth for simplicity)
 * Usage: /api/sendgrid/test-send?email=xxx@xxx.com&site=Nyon
 */
router.get('/test-send', async (req, res) => {
  try {
    const { email, site } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email parameter required. Usage: ?email=xxx@xxx.com&site=Nyon' });
    }

    if (!site) {
      return res.status(400).json({ error: 'Site parameter required. Usage: ?email=xxx@xxx.com&site=Nyon' });
    }

    console.log(`[SendGrid] 🧪 Test daily send requested for ${email} - site: ${site}`);

    const result = await sendDailyOutageReport(email, site);

    if (result.success) {
      res.json({
        success: true,
        message: `✅ Email quotidien envoyé avec succès à ${email}`,
        messageId: result.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        message: `❌ Erreur lors de l'envoi`,
        error: result.error
      });
    }

  } catch (error) {
    console.error('[SendGrid] Test send error:', error.message);
    res.status(500).json({ error: 'Failed to send test email: ' + error.message });
  }
});

/**
 * GET /api/sendgrid/test-weekly
 * Send a test weekly report email
 * Usage: /api/sendgrid/test-weekly?email=xxx@xxx.com&site=Nyon
 */
router.get('/test-weekly', async (req, res) => {
  try {
    const { email, site } = req.query;

    if (!email || !site) {
      return res.status(400).json({ error: 'Email and site parameters required. Usage: ?email=xxx@xxx.com&site=Nyon' });
    }

    console.log(`[SendGrid] 🧪 Test weekly send requested for ${email} - site: ${site}`);

    const result = await sendWeeklyReport(email, site);

    if (result.success) {
      res.json({
        success: true,
        message: `✅ Rapport hebdomadaire envoyé avec succès à ${email}`,
        messageId: result.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        message: `❌ Erreur lors de l'envoi`,
        error: result.error
      });
    }

  } catch (error) {
    console.error('[SendGrid] Test weekly error:', error.message);
    res.status(500).json({ error: 'Failed to send weekly report: ' + error.message });
  }
});

/**
 * GET /api/sendgrid/test-monthly
 * Send a test monthly report email
 * Usage: /api/sendgrid/test-monthly?email=xxx@xxx.com&site=Nyon
 */
router.get('/test-monthly', async (req, res) => {
  try {
    const { email, site } = req.query;

    if (!email || !site) {
      return res.status(400).json({ error: 'Email and site parameters required. Usage: ?email=xxx@xxx.com&site=Nyon' });
    }

    console.log(`[SendGrid] 🧪 Test monthly send requested for ${email} - site: ${site}`);

    const result = await sendMonthlyReport(email, site);

    if (result.success) {
      res.json({
        success: true,
        message: `✅ Rapport mensuel envoyé avec succès à ${email}`,
        messageId: result.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        message: `❌ Erreur lors de l'envoi`,
        error: result.error
      });
    }

  } catch (error) {
    console.error('[SendGrid] Test monthly error:', error.message);
    res.status(500).json({ error: 'Failed to send monthly report: ' + error.message });
  }
});

/**
 * GET /api/sendgrid/preview-weekly
 * Preview the weekly report email
 */
router.get('/preview-weekly', async (req, res) => {
  try {
    const site = req.query.site || 'default';
    const dateRange = getWeeklyDateRange();
    const { startDate, endDate } = dateRange;

    const [stats, dailyBreakdown, equipmentBreakdown, problematicEquipment, agentSnapshots, agentImages, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getProblematicEquipment(site, startDate, endDate),
      getAgentSnapshotsForRange(site, startDate, endDate),
      getAgentImagesForPreview(),
      getAgentCustomNames()
    ]);

    const totalIncidents = parseInt(stats.total_outages) || 0;
    const riskData = calculateRiskScores(equipmentBreakdown, totalIncidents);

    const html = generateWeeklyReportEmail(site, dateRange, stats, dailyBreakdown, riskData, problematicEquipment, agentSnapshots, agentImages, agentCustomNames);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('[SendGrid] Preview weekly error:', error.message);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * GET /api/sendgrid/preview-monthly
 * Preview the monthly report email
 */
router.get('/preview-monthly', async (req, res) => {
  try {
    const site = req.query.site || 'default';
    const dateRange = getMonthlyDateRange();
    const { startDate, endDate } = dateRange;

    const [stats, dailyBreakdown, equipmentBreakdown, problematicEquipment, maintenanceStats, agentSnapshots, agentImages, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getProblematicEquipment(site, startDate, endDate, 10),
      getMaintenanceStats(site, startDate, endDate),
      getAgentSnapshotsForRange(site, startDate, endDate),
      getAgentImagesForPreview(),
      getAgentCustomNames()
    ]);

    const totalIncidents = parseInt(stats.total_outages) || 0;
    const riskData = calculateRiskScores(equipmentBreakdown, totalIncidents);

    const html = generateMonthlyReportEmail(site, dateRange, stats, dailyBreakdown, riskData, problematicEquipment, maintenanceStats, agentSnapshots, agentImages, agentCustomNames);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('[SendGrid] Preview monthly error:', error.message);
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
