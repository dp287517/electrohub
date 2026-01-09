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

// Mapping from equipment_type to app ID (for permission checking)
const EQUIPMENT_TYPE_TO_APP = {
  'switchboard': 'switchboards',
  'device': 'switchboards',
  'vsd': 'vsd',
  'meca': 'meca',
  'mobile': 'mobile-equipments',
  'mobile_equipment': 'mobile-equipments',
  'hv': 'hv',
  'glo': 'glo',
  'datahub': 'datahub',
  'infrastructure': 'infrastructure',
  'atex': 'atex',
  'doors': 'doors',
  'firecontrol': 'firecontrol'
};

// Admin emails (have access to everything)
const ADMIN_EMAILS = [
  'daniel.x.palha@haleon.com',
  'palhadaniel.elec@gmail.com'
];

/**
 * Get user permissions from database
 * Returns the allowed_apps array for a user
 */
async function getUserPermissions(email) {
  if (!email) return { allowedApps: [], isAdmin: false };

  // Check if admin
  if (ADMIN_EMAILS.includes(email.toLowerCase())) {
    return { allowedApps: null, isAdmin: true }; // null = all apps
  }

  try {
    // Check haleon_users first
    let result = await pool.query(`
      SELECT allowed_apps, is_validated, is_active
      FROM haleon_users
      WHERE LOWER(email) = LOWER($1)
    `, [email]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (!user.is_validated || !user.is_active) {
        return { allowedApps: [], isAdmin: false };
      }
      return {
        allowedApps: user.allowed_apps || null, // null = all apps
        isAdmin: false
      };
    }

    // Check external users
    result = await pool.query(`
      SELECT allowed_apps, is_active
      FROM users
      WHERE LOWER(email) = LOWER($1)
    `, [email]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (!user.is_active) {
        return { allowedApps: [], isAdmin: false };
      }
      return {
        allowedApps: user.allowed_apps || null,
        isAdmin: false
      };
    }

    // User not found - no access
    return { allowedApps: [], isAdmin: false };

  } catch (error) {
    console.error('[SendGrid] Error fetching user permissions:', error.message);
    return { allowedApps: [], isAdmin: false };
  }
}

/**
 * Check if user can see a specific equipment type
 */
function canUserSeeEquipmentType(permissions, equipmentType) {
  // Admin sees everything
  if (permissions.isAdmin) return true;

  // null allowedApps = all apps
  if (permissions.allowedApps === null) return true;

  // Empty array = no access
  if (!permissions.allowedApps || permissions.allowedApps.length === 0) return false;

  // Check if equipment type's app is in allowed apps
  const appId = EQUIPMENT_TYPE_TO_APP[equipmentType];
  if (!appId) return false;

  return permissions.allowedApps.includes(appId);
}

/**
 * Get allowed equipment types for a user
 */
function getAllowedEquipmentTypes(permissions) {
  if (permissions.isAdmin || permissions.allowedApps === null) {
    // Return all equipment types
    return Object.keys(AGENT_AVATARS).filter(k => k !== 'main');
  }

  if (!permissions.allowedApps || permissions.allowedApps.length === 0) {
    return [];
  }

  // Filter equipment types based on allowed apps
  return Object.keys(AGENT_AVATARS).filter(type => {
    if (type === 'main') return false;
    const appId = EQUIPMENT_TYPE_TO_APP[type];
    return appId && permissions.allowedApps.includes(appId);
  });
}

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
 * Get date range for last 30 days
 */
function getMonthlyDateRange() {
  const parisTime = getParisTime();

  // Last 30 days ending yesterday
  const endDate = new Date(parisTime);
  endDate.setDate(endDate.getDate() - 1); // Yesterday

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 29); // 30 days total

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    monthName: 'Les 30 derniers jours'
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
 * Generate QuickChart URL for a chart (sync version for backward compatibility)
 * Uses QuickChart.io service to generate chart images
 */
function generateChartUrl(config, width = 500, height = 300) {
  try {
    const chartConfig = JSON.stringify(config);
    const url = `https://quickchart.io/chart?c=${encodeURIComponent(chartConfig)}&w=${width}&h=${height}&bkg=white&f=png`;
    console.log(`[SendGrid] Generated chart URL (length: ${url.length})`);
    return url;
  } catch (error) {
    console.error('[SendGrid] Error generating chart URL:', error.message);
    return null;
  }
}

/**
 * Generate a short chart URL using QuickChart's API (async)
 * This creates a shorter, cached URL that works better in emails
 */
async function generateShortChartUrl(config, width = 500, height = 300) {
  try {
    const response = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chart: config,
        width: width,
        height: height,
        backgroundColor: 'white',
        format: 'png'
      })
    });

    if (!response.ok) {
      console.error(`[SendGrid] QuickChart API error: ${response.status}`);
      // Fallback to regular URL
      return generateChartUrl(config, width, height);
    }

    const data = await response.json();
    if (data.success && data.url) {
      console.log(`[SendGrid] Generated short chart URL: ${data.url}`);
      return data.url;
    }

    // Fallback to regular URL
    return generateChartUrl(config, width, height);
  } catch (error) {
    console.error('[SendGrid] Error generating short chart URL:', error.message);
    // Fallback to regular URL
    return generateChartUrl(config, width, height);
  }
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
 * Get maintenance stats by agent/equipment type
 */
async function getMaintenanceStatsByAgent(site, startDate, endDate) {
  try {
    const result = await pool.query(`
      SELECT
        equipment_type,
        COUNT(*) as total_controls,
        COUNT(CASE WHEN status = 'conform' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'non_conform' THEN 1 END) as non_conform
      FROM control_records
      WHERE site = $1
        AND DATE(performed_at) BETWEEN $2 AND $3
      GROUP BY equipment_type
    `, [site, startDate, endDate]);

    const statsByAgent = {};
    result.rows.forEach(row => {
      statsByAgent[row.equipment_type] = {
        total: parseInt(row.total_controls) || 0,
        completed: parseInt(row.completed) || 0,
        non_conform: parseInt(row.non_conform) || 0
      };
    });

    return statsByAgent;
  } catch (error) {
    console.log('[SendGrid] Maintenance by agent not available:', error.message);
    return {};
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
 * Clear labels with weekday names
 */
function generateIncidentsChart(dailyData, width = 600, height = 250) {
  // Use weekday + day format for clarity (Lun 5, Mar 6, etc.)
  const joursSemaine = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const labels = dailyData.map(d => {
    const date = new Date(d.date);
    const jour = joursSemaine[date.getDay()];
    const day = date.getDate();
    return jour + ' ' + day;
  });

  const config = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Depannages',
        data: dailyData.map(d => parseInt(d.total) || 0),
        backgroundColor: 'rgba(59,130,246,0.8)',
        borderColor: 'rgb(37,99,235)',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Nombre de depannages par jour', font: { size: 14 } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  };

  const url = generateChartUrl(config, width, height);
  console.log(`[SendGrid] Chart URL generated for ${dailyData.length} days of data`);
  return url;
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
    type: 'bar',
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
function generateDailyReportEmail(site, date, outages, agentSnapshots, stats, agentImages = {}, agentCustomNames = {}, allowedEquipmentTypes = null) {
  const formattedDate = formatDateFr(date);

  // Filter outages by permissions if provided
  const filteredOutages = allowedEquipmentTypes
    ? outages.filter(o => allowedEquipmentTypes.includes(o.equipment_type))
    : outages;

  const hasOutages = filteredOutages.length > 0;

  // Group outages by equipment type (agent type)
  const outagesByAgent = filteredOutages.reduce((acc, outage) => {
    const type = outage.equipment_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(outage);
    return acc;
  }, {});

  // Create a map of agent snapshots by type (filtered)
  const snapshotsByAgent = {};
  agentSnapshots.forEach(snapshot => {
    if (!allowedEquipmentTypes || allowedEquipmentTypes.includes(snapshot.agent_type)) {
      snapshotsByAgent[snapshot.agent_type] = snapshot;
    }
  });

  // Get all agent types that have either snapshots or outages (filtered by permissions)
  const allAgentTypes = new Set([
    ...Object.keys(outagesByAgent),
    ...Object.keys(snapshotsByAgent)
  ]);

  // Filter to only agents with data (outages or meaningful snapshot data)
  const agentsWithData = Array.from(allAgentTypes).filter(agentType => {
    // Also check permissions
    if (allowedEquipmentTypes && !allowedEquipmentTypes.includes(agentType)) {
      return false;
    }
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

  // Recalculate stats based on filtered outages
  const filteredStats = {
    total_outages: filteredOutages.length,
    critical_count: filteredOutages.filter(o => o.severity === 'critical').length,
    resolved_count: filteredOutages.filter(o => o.status === 'resolved').length,
    total_downtime: filteredOutages.reduce((sum, o) => sum + (parseInt(o.downtime_minutes) || 0), 0)
  };

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
        <div class="stat-value">${filteredStats.total_outages || 0}</div>
        <div class="stat-label">Dépannages</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #DC2626;">${filteredStats.critical_count || 0}</div>
        <div class="stat-label">Critiques</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #22C55E;">${filteredStats.resolved_count || 0}</div>
        <div class="stat-label">Résolus</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${Math.round(filteredStats.total_downtime || 0)}<span style="font-size: 14px;">min</span></div>
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
      <p style="margin-top: 15px; font-size: 11px;">© ${new Date().getFullYear()} Haleon-tool - Daniel Palha - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate Weekly KPI Report Email Template
 * Beautiful email with charts, KPIs, and agent performance table
 */
function generateWeeklyReportEmail(site, dateRange, stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages = {}, agentCustomNames = {}, allowedEquipmentTypes = null) {
  const { startDate, endDate } = dateRange;
  const formattedRange = formatDateRangeFr(startDate, endDate);

  // Generate simple chart URL for incidents
  const incidentsChartUrl = dailyBreakdown.length > 0 ? generateIncidentsChart(dailyBreakdown) : null;

  // Filter equipment types if permissions provided
  const visibleTypes = allowedEquipmentTypes || Object.keys(AGENT_AVATARS).filter(k => k !== 'main');

  // Calculate KPIs (filtered by permissions)
  let totalOutages = 0;
  let totalDowntimeMinutes = 0;
  let totalMaintenance = 0;

  // Build breakdown by agent type and calculate filtered totals
  const breakdownByAgent = {};
  equipmentBreakdown.forEach(eq => {
    if (visibleTypes.includes(eq.equipment_type)) {
      breakdownByAgent[eq.equipment_type] = {
        incidents: parseInt(eq.incident_count) || 0,
        critical: parseInt(eq.critical_count) || 0,
        downtime: parseInt(eq.total_downtime) || 0
      };
      totalOutages += parseInt(eq.incident_count) || 0;
      totalDowntimeMinutes += parseInt(eq.total_downtime) || 0;
    }
  });

  // Calculate maintenance totals (filtered)
  visibleTypes.forEach(type => {
    const m = maintenanceByAgent[type];
    if (m) totalMaintenance += parseInt(m.completed) || 0;
  });

  const resolvedCount = parseInt(stats.resolved_count) || 0;
  const resolutionRate = totalOutages > 0 ? Math.round((resolvedCount / totalOutages) * 100) : 100;
  const downtimeHours = (totalDowntimeMinutes / 60).toFixed(1);

  // App routes for links
  const APP_ROUTES = {
    'switchboard': 'switchboards',
    'vsd': 'vsd',
    'meca': 'meca',
    'mobile': 'mobile-equipments',
    'hv': 'hv',
    'glo': 'glo',
    'datahub': 'datahub',
    'atex': 'atex',
    'doors': 'doors',
    'firecontrol': 'firecontrol'
  };

  // Generate agent table rows (filtered by permissions)
  const generateAgentTableRows = () => {
    return visibleTypes.map(agentType => {
      const agent = AGENT_AVATARS[agentType];
      if (!agent) return '';

      const imageData = agentImages[agentType];
      const imageUrl = imageData?.hasCid ? 'cid:' + imageData.cid : imageData?.httpUrl || null;
      const agentName = agentCustomNames[agentType] || agent.name;
      const breakdown = breakdownByAgent[agentType] || { incidents: 0, critical: 0, downtime: 0 };
      const maintenance = maintenanceByAgent[agentType] || { total: 0, completed: 0, non_conform: 0 };
      const appRoute = APP_ROUTES[agentType] || agentType;

      return '<tr>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">' +
          '<div style="display: flex; align-items: center; gap: 12px;">' +
            (imageUrl ?
              '<img src="' + imageUrl + '" alt="' + agentName + '" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover;" />' :
              '<div style="width: 45px; height: 45px; border-radius: 8px; background: linear-gradient(135deg, ' + agent.color + ', ' + agent.color + 'CC); display: flex; align-items: center; justify-content: center; color: white; font-size: 18px;">' + agent.icon + '</div>'
            ) +
            '<div>' +
              '<strong style="color: #1f2937;">' + agentName + '</strong>' +
              '<div style="font-size: 11px; color: #6b7280;">' + agent.description + '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">' +
          '<a href="' + APP_URL + '/troubleshooting?type=' + agentType + '" style="text-decoration: none;">' +
            '<span style="font-size: 18px; font-weight: bold; color: #3B82F6;">' + breakdown.incidents + '</span>' +
          '</a>' +
          (breakdown.critical > 0 ? '<br><span style="font-size: 11px; color: #DC2626;">dont ' + breakdown.critical + ' critiques</span>' : '') +
        '</td>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">' +
          '<a href="' + APP_URL + '/' + appRoute + '/controls" style="text-decoration: none;">' +
            '<span style="font-size: 18px; font-weight: bold; color: #22C55E;">' + maintenance.completed + '</span>' +
          '</a>' +
          (maintenance.non_conform > 0 ? '<br><span style="font-size: 11px; color: #F97316;">' + maintenance.non_conform + ' NC</span>' : '') +
        '</td>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">' +
          '<span style="font-size: 14px; color: #6b7280;">' + Math.round(breakdown.downtime) + ' min</span>' +
        '</td>' +
      '</tr>';
    }).join('');
  };

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport hebdomadaire - ${site}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6;">
  <div style="max-width: 800px; margin: 0 auto; background: white;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #7c3aed, #a855f7); padding: 35px; text-align: center; color: white;">
      <h1 style="margin: 0; font-size: 26px;">📈 Rapport hebdomadaire</h1>
      <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">${formattedRange} • Site: ${site}</p>
    </div>

    <!-- KPI Summary -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 2px solid #e5e7eb;">
      <tr>
        <td style="padding: 25px 15px; text-align: center; border-right: 1px solid #e5e7eb; width: 25%;">
          <a href="${APP_URL}/troubleshooting" style="text-decoration: none;">
            <div style="font-size: 32px; font-weight: bold; color: #3B82F6;">${totalOutages}</div>
            <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Dépannages</div>
          </a>
        </td>
        <td style="padding: 25px 15px; text-align: center; border-right: 1px solid #e5e7eb; width: 25%;">
          <div style="font-size: 32px; font-weight: bold; color: ${resolutionRate >= 80 ? '#22C55E' : resolutionRate >= 60 ? '#F97316' : '#DC2626'};">${resolutionRate}%</div>
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Résolution</div>
        </td>
        <td style="padding: 25px 15px; text-align: center; border-right: 1px solid #e5e7eb; width: 25%;">
          <div style="font-size: 32px; font-weight: bold; color: #22C55E;">${totalMaintenance}</div>
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Maintenances</div>
        </td>
        <td style="padding: 25px 15px; text-align: center; width: 25%;">
          <div style="font-size: 32px; font-weight: bold; color: #DC2626;">${downtimeHours}h</div>
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Temps d'arrêt</div>
        </td>
      </tr>
    </table>

    ${incidentsChartUrl ? `
    <!-- Chart -->
    <div style="padding: 25px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin: 0 0 20px;">📊 Évolution sur 7 jours</h2>
      <div style="text-align: center;">
        <img src="${incidentsChartUrl}" alt="Incidents par jour" style="max-width: 100%; height: auto; border-radius: 8px;" />
      </div>
    </div>
    ` : ''}

    <!-- Agent Performance Table -->
    <div style="padding: 25px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin: 0 0 20px;">🤖 Performance par Agent IA</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
        <thead>
          <tr style="background: #f8fafc;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Agent IA</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Dépannages</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Maintenances</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Temps d'arrêt</th>
          </tr>
        </thead>
        <tbody>
          ${generateAgentTableRows()}
        </tbody>
      </table>
    </div>

    <!-- Quick Access Links -->
    <div style="padding: 25px; border-bottom: 1px solid #e5e7eb; text-align: center;">
      <h2 style="font-size: 16px; font-weight: 700; color: #1f2937; margin: 0 0 20px;">🔗 Accès rapide</h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 10px; text-align: center;">
            <a href="${APP_URL}/troubleshooting" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">📋 Voir tous les dépannages</a>
          </td>
          <td style="padding: 10px; text-align: center;">
            <a href="${APP_URL}/switchboards/controls" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #22C55E, #16A34A); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">🔧 Voir les maintenances</a>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <div style="background: #1f2937; padding: 25px; text-align: center; color: #9ca3af; font-size: 12px;">
      <p style="margin: 0;">Ce rapport a été généré automatiquement par Haleon-tool</p>
      <p style="margin: 15px 0 0; font-size: 11px;">© ${new Date().getFullYear()} Haleon-tool - Daniel Palha - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate Monthly KPI Report Email Template
 * Same structure as weekly but for 30 days
 */
function generateMonthlyReportEmail(site, dateRange, stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages = {}, agentCustomNames = {}, allowedEquipmentTypes = null) {
  const { startDate, endDate, monthName } = dateRange;
  const formattedRange = formatDateRangeFr(startDate, endDate);

  // Generate chart URL
  const incidentsChartUrl = dailyBreakdown.length > 0 ? generateIncidentsChart(dailyBreakdown, 700, 300) : null;

  // Filter equipment types if permissions provided
  const visibleTypes = allowedEquipmentTypes || Object.keys(AGENT_AVATARS).filter(k => k !== 'main');

  // Calculate KPIs (filtered by permissions)
  let totalOutages = 0;
  let totalDowntimeMinutes = 0;
  let totalMaintenance = 0;

  // Build breakdown by agent type and calculate filtered totals
  const breakdownByAgent = {};
  equipmentBreakdown.forEach(eq => {
    if (visibleTypes.includes(eq.equipment_type)) {
      breakdownByAgent[eq.equipment_type] = {
        incidents: parseInt(eq.incident_count) || 0,
        critical: parseInt(eq.critical_count) || 0,
        downtime: parseInt(eq.total_downtime) || 0
      };
      totalOutages += parseInt(eq.incident_count) || 0;
      totalDowntimeMinutes += parseInt(eq.total_downtime) || 0;
    }
  });

  // Calculate maintenance totals (filtered)
  visibleTypes.forEach(type => {
    const m = maintenanceByAgent[type];
    if (m) totalMaintenance += parseInt(m.completed) || 0;
  });

  const resolvedCount = parseInt(stats.resolved_count) || 0;
  const resolutionRate = totalOutages > 0 ? Math.round((resolvedCount / totalOutages) * 100) : 100;
  const downtimeHours = (totalDowntimeMinutes / 60).toFixed(1);

  // App routes for links
  const APP_ROUTES = {
    'switchboard': 'switchboards',
    'vsd': 'vsd',
    'meca': 'meca',
    'mobile': 'mobile-equipments',
    'hv': 'hv',
    'glo': 'glo',
    'datahub': 'datahub',
    'atex': 'atex',
    'doors': 'doors',
    'firecontrol': 'firecontrol'
  };

  // Generate agent table rows (filtered by permissions)
  const generateAgentTableRows = () => {
    return visibleTypes.map(agentType => {
      const agent = AGENT_AVATARS[agentType];
      if (!agent) return '';

      const imageData = agentImages[agentType];
      const imageUrl = imageData?.hasCid ? 'cid:' + imageData.cid : imageData?.httpUrl || null;
      const agentName = agentCustomNames[agentType] || agent.name;
      const breakdown = breakdownByAgent[agentType] || { incidents: 0, critical: 0, downtime: 0 };
      const maintenance = maintenanceByAgent[agentType] || { total: 0, completed: 0, non_conform: 0 };
      const appRoute = APP_ROUTES[agentType] || agentType;

      return '<tr>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">' +
          '<div style="display: flex; align-items: center; gap: 12px;">' +
            (imageUrl ?
              '<img src="' + imageUrl + '" alt="' + agentName + '" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover;" />' :
              '<div style="width: 45px; height: 45px; border-radius: 8px; background: linear-gradient(135deg, ' + agent.color + ', ' + agent.color + 'CC); display: flex; align-items: center; justify-content: center; color: white; font-size: 18px;">' + agent.icon + '</div>'
            ) +
            '<div>' +
              '<strong style="color: #1f2937;">' + agentName + '</strong>' +
              '<div style="font-size: 11px; color: #6b7280;">' + agent.description + '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">' +
          '<a href="' + APP_URL + '/troubleshooting?type=' + agentType + '" style="text-decoration: none;">' +
            '<span style="font-size: 18px; font-weight: bold; color: #3B82F6;">' + breakdown.incidents + '</span>' +
          '</a>' +
          (breakdown.critical > 0 ? '<br><span style="font-size: 11px; color: #DC2626;">dont ' + breakdown.critical + ' critiques</span>' : '') +
        '</td>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">' +
          '<a href="' + APP_URL + '/' + appRoute + '/controls" style="text-decoration: none;">' +
            '<span style="font-size: 18px; font-weight: bold; color: #22C55E;">' + maintenance.completed + '</span>' +
          '</a>' +
          (maintenance.non_conform > 0 ? '<br><span style="font-size: 11px; color: #F97316;">' + maintenance.non_conform + ' NC</span>' : '') +
        '</td>' +
        '<td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">' +
          '<span style="font-size: 14px; color: #6b7280;">' + Math.round(breakdown.downtime) + ' min</span>' +
        '</td>' +
      '</tr>';
    }).join('');
  };

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport mensuel - ${site}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6;">
  <div style="max-width: 800px; margin: 0 auto; background: white;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0ea5e9, #38bdf8); padding: 35px; text-align: center; color: white;">
      <h1 style="margin: 0; font-size: 26px;">📅 Rapport mensuel</h1>
      <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">${monthName} (${formattedRange}) • Site: ${site}</p>
    </div>

    <!-- KPI Summary -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 2px solid #e5e7eb;">
      <tr>
        <td style="padding: 25px 15px; text-align: center; border-right: 1px solid #e5e7eb; width: 25%;">
          <a href="${APP_URL}/troubleshooting" style="text-decoration: none;">
            <div style="font-size: 32px; font-weight: bold; color: #3B82F6;">${totalOutages}</div>
            <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Dépannages</div>
          </a>
        </td>
        <td style="padding: 25px 15px; text-align: center; border-right: 1px solid #e5e7eb; width: 25%;">
          <div style="font-size: 32px; font-weight: bold; color: ${resolutionRate >= 80 ? '#22C55E' : resolutionRate >= 60 ? '#F97316' : '#DC2626'};">${resolutionRate}%</div>
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Résolution</div>
        </td>
        <td style="padding: 25px 15px; text-align: center; border-right: 1px solid #e5e7eb; width: 25%;">
          <div style="font-size: 32px; font-weight: bold; color: #22C55E;">${totalMaintenance}</div>
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Maintenances</div>
        </td>
        <td style="padding: 25px 15px; text-align: center; width: 25%;">
          <div style="font-size: 32px; font-weight: bold; color: #DC2626;">${downtimeHours}h</div>
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 5px;">Temps d'arrêt</div>
        </td>
      </tr>
    </table>

    ${incidentsChartUrl ? `
    <!-- Chart -->
    <div style="padding: 25px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin: 0 0 20px;">📊 Évolution sur 30 jours</h2>
      <div style="text-align: center;">
        <img src="${incidentsChartUrl}" alt="Incidents par jour" style="max-width: 100%; height: auto; border-radius: 8px;" />
      </div>
    </div>
    ` : ''}

    <!-- Agent Performance Table -->
    <div style="padding: 25px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="font-size: 18px; font-weight: 700; color: #1f2937; margin: 0 0 20px;">🤖 Performance par Agent IA</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
        <thead>
          <tr style="background: #f8fafc;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Agent IA</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Dépannages</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Maintenances</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #475569;">Temps d'arrêt</th>
          </tr>
        </thead>
        <tbody>
          ${generateAgentTableRows()}
        </tbody>
      </table>
    </div>

    <!-- Quick Access Links -->
    <div style="padding: 25px; border-bottom: 1px solid #e5e7eb; text-align: center;">
      <h2 style="font-size: 16px; font-weight: 700; color: #1f2937; margin: 0 0 20px;">🔗 Accès rapide</h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 10px; text-align: center;">
            <a href="${APP_URL}/troubleshooting" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">📋 Voir tous les dépannages</a>
          </td>
          <td style="padding: 10px; text-align: center;">
            <a href="${APP_URL}/switchboards/controls" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #22C55E, #16A34A); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">🔧 Voir les maintenances</a>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <div style="background: #1f2937; padding: 25px; text-align: center; color: #9ca3af; font-size: 12px;">
      <p style="margin: 0;">Ce rapport a été généré automatiquement par Haleon-tool</p>
      <p style="margin: 15px 0 0; font-size: 11px;">© ${new Date().getFullYear()} Haleon-tool - Daniel Palha - Tous droits réservés</p>
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
    // Fetch user permissions for filtering
    const permissions = await getUserPermissions(email);
    const allowedEquipmentTypes = getAllowedEquipmentTypes(permissions);

    // If user has no access to any equipment types, skip sending
    if (allowedEquipmentTypes.length === 0 && !permissions.isAdmin && permissions.allowedApps !== null) {
      console.log(`[SendGrid] Skipping daily report for ${email} - no equipment access`);
      return { success: false, error: 'User has no equipment access' };
    }

    // Fetch all necessary data including agent images and custom names
    const [outages, agentSnapshots, stats, agentImagesData, agentCustomNames] = await Promise.all([
      getYesterdayOutages(site),
      getYesterdayAgentSnapshots(site),
      getDayStats(site),
      getAgentImagesData(),
      getAgentCustomNames()
    ]);

    const { agentImages, attachments } = agentImagesData;

    // Generate email HTML with permission filtering
    const htmlContent = generateDailyReportEmail(site, yesterday, outages, agentSnapshots, stats, agentImages, agentCustomNames, allowedEquipmentTypes.length > 0 ? allowedEquipmentTypes : null);

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

    // Fetch user permissions for filtering
    const permissions = await getUserPermissions(email);
    const allowedEquipmentTypes = getAllowedEquipmentTypes(permissions);

    // If user has no access to any equipment types, skip sending
    if (allowedEquipmentTypes.length === 0 && !permissions.isAdmin && permissions.allowedApps !== null) {
      console.log(`[SendGrid] Skipping weekly report for ${email} - no equipment access`);
      return { success: false, error: 'User has no equipment access' };
    }

    // Fetch all data for the week
    const [stats, dailyBreakdown, equipmentBreakdown, problematicEquipment, maintenanceStats, maintenanceByAgent, agentImagesData, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getProblematicEquipment(site, startDate, endDate),
      getMaintenanceStats(site, startDate, endDate),
      getMaintenanceStatsByAgent(site, startDate, endDate),
      getAgentImagesData(),
      getAgentCustomNames()
    ]);

    const { agentImages, attachments } = agentImagesData;

    // Calculate risk scores
    const totalIncidents = parseInt(stats.total_outages) || 0;
    const riskData = calculateRiskScores(equipmentBreakdown, totalIncidents);

    // Generate email HTML with permission filtering
    const htmlContent = generateWeeklyReportEmail(site, dateRange, stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages, agentCustomNames, allowedEquipmentTypes.length > 0 ? allowedEquipmentTypes : null);

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

    // Fetch user permissions for filtering
    const permissions = await getUserPermissions(email);
    const allowedEquipmentTypes = getAllowedEquipmentTypes(permissions);

    // If user has no access to any equipment types, skip sending
    if (allowedEquipmentTypes.length === 0 && !permissions.isAdmin && permissions.allowedApps !== null) {
      console.log(`[SendGrid] Skipping monthly report for ${email} - no equipment access`);
      return { success: false, error: 'User has no equipment access' };
    }

    // Fetch all data for the month
    const [stats, dailyBreakdown, equipmentBreakdown, problematicEquipment, maintenanceStats, maintenanceByAgent, agentImagesData, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getProblematicEquipment(site, startDate, endDate, 10),
      getMaintenanceStats(site, startDate, endDate),
      getMaintenanceStatsByAgent(site, startDate, endDate),
      getAgentImagesData(),
      getAgentCustomNames()
    ]);

    const { agentImages, attachments } = agentImagesData;

    // Calculate risk scores
    const totalIncidents = parseInt(stats.total_outages) || 0;
    const riskData = calculateRiskScores(equipmentBreakdown, totalIncidents);

    // Generate email HTML with permission filtering
    const htmlContent = generateMonthlyReportEmail(site, dateRange, stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages, agentCustomNames, allowedEquipmentTypes.length > 0 ? allowedEquipmentTypes : null);

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

    // Calculate time until 5:59 AM Paris time
    const getNextParisTime = (hour, minute) => {
      const now = new Date();
      // Create a date string for today at the target Paris time
      const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const targetParis = new Date(parisNow);
      targetParis.setHours(hour, minute, 0, 0);

      // If already past target time in Paris, go to tomorrow
      if (parisNow >= targetParis) {
        targetParis.setDate(targetParis.getDate() + 1);
      }

      // Convert back: calculate the offset between Paris target and now
      const parisTargetStr = targetParis.toLocaleString('en-US', { timeZone: 'Europe/Paris' });
      const nowStr = now.toLocaleString('en-US', { timeZone: 'Europe/Paris' });

      // Calculate milliseconds until target
      const msPerDay = 24 * 60 * 60 * 1000;
      const targetMs = targetParis.getHours() * 3600000 + targetParis.getMinutes() * 60000;
      const nowMs = parisNow.getHours() * 3600000 + parisNow.getMinutes() * 60000 + parisNow.getSeconds() * 1000;

      let msUntil = targetMs - nowMs;
      if (msUntil <= 0) {
        msUntil += msPerDay;
      }

      return msUntil;
    };

    let msUntilFirstRun = getNextParisTime(5, 59);

    // Check if next run falls on weekend
    const nextRunDate = new Date(Date.now() + msUntilFirstRun);
    const dayOfWeek = new Date(nextRunDate.toLocaleString('en-US', { timeZone: 'Europe/Paris' })).getDay();
    if (dayOfWeek === 0) { // Sunday
      msUntilFirstRun += 24 * 60 * 60 * 1000; // Add 1 day
    } else if (dayOfWeek === 6) { // Saturday
      msUntilFirstRun += 2 * 24 * 60 * 60 * 1000; // Add 2 days
    }

    const nextRunTime = new Date(Date.now() + msUntilFirstRun);
    console.log(`[SendGrid] 📅 Next daily report: ${nextRunTime.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (Paris time)`);

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

    const [stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getMaintenanceStats(site, startDate, endDate),
      getMaintenanceStatsByAgent(site, startDate, endDate),
      getAgentImagesForPreview(),
      getAgentCustomNames()
    ]);

    const html = generateWeeklyReportEmail(site, dateRange, stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages, agentCustomNames);

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

    const [stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages, agentCustomNames] = await Promise.all([
      getStatsForDateRange(site, startDate, endDate),
      getDailyBreakdown(site, startDate, endDate),
      getEquipmentTypeBreakdown(site, startDate, endDate),
      getMaintenanceStats(site, startDate, endDate),
      getMaintenanceStatsByAgent(site, startDate, endDate),
      getAgentImagesForPreview(),
      getAgentCustomNames()
    ]);

    const html = generateMonthlyReportEmail(site, dateRange, stats, dailyBreakdown, equipmentBreakdown, maintenanceStats, maintenanceByAgent, agentImages, agentCustomNames);

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
