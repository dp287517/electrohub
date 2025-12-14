// lib/audit-trail.js
// =============================================================================
// MODULE D'AUDIT TRAIL UNIFIÉ
// Système de traçabilité pour tous les microservices ElectroHub
// =============================================================================
//
// USAGE:
//   import { createAuditTrail, logEvent } from './lib/audit-trail.js';
//
//   // Au démarrage du service:
//   const audit = createAuditTrail(pool, 'switchboard');
//   await audit.ensureTable();
//
//   // Dans une route:
//   await audit.log(req, 'device_created', { deviceId: 123, name: 'Disj1' });
//
// =============================================================================

import { extractTenantFromRequest } from './tenant-filter.js';

/**
 * Crée un système d'audit trail pour un microservice
 *
 * @param {Pool} pool - Pool de connexion PostgreSQL
 * @param {string} serviceName - Nom du service (ex: 'switchboard', 'atex', 'doors')
 * @returns {Object} Objet audit avec méthodes log, ensureTable, etc.
 */
export function createAuditTrail(pool, serviceName) {
  const tableName = `${serviceName}_audit_log`;

  /**
   * Crée la table d'audit si elle n'existe pas
   */
  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ts TIMESTAMPTZ DEFAULT NOW(),

        -- Multi-tenant
        company_id INTEGER,
        site_id INTEGER,

        -- Action
        action TEXT NOT NULL,
        entity_type TEXT,           -- Type d'entité (ex: 'device', 'switchboard', 'door')
        entity_id TEXT,             -- ID de l'entité concernée

        -- Acteur
        actor_name TEXT,
        actor_email TEXT,
        actor_role TEXT,

        -- Détails
        details JSONB DEFAULT '{}'::jsonb,
        old_values JSONB,           -- Valeurs avant modification (pour UPDATE)
        new_values JSONB,           -- Valeurs après modification (pour UPDATE)

        -- Métadonnées
        ip_address TEXT,
        user_agent TEXT,
        request_id TEXT,

        -- Index
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_${serviceName}_audit_ts ON ${tableName}(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_${serviceName}_audit_action ON ${tableName}(action);
      CREATE INDEX IF NOT EXISTS idx_${serviceName}_audit_company ON ${tableName}(company_id);
      CREATE INDEX IF NOT EXISTS idx_${serviceName}_audit_site ON ${tableName}(site_id);
      CREATE INDEX IF NOT EXISTS idx_${serviceName}_audit_entity ON ${tableName}(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_${serviceName}_audit_actor ON ${tableName}(actor_email);
    `);
    console.log(`[${serviceName}] Audit trail table ensured: ${tableName}`);
  }

  /**
   * Enregistre un événement d'audit
   *
   * @param {Request} req - Requête Express (pour extraire user/tenant)
   * @param {string} action - Action effectuée (ex: 'device_created', 'settings_updated')
   * @param {Object} options - Options supplémentaires
   * @param {string} options.entityType - Type d'entité
   * @param {string|number} options.entityId - ID de l'entité
   * @param {Object} options.details - Détails additionnels
   * @param {Object} options.oldValues - Valeurs avant modification
   * @param {Object} options.newValues - Valeurs après modification
   */
  async function log(req, action, options = {}) {
    const {
      entityType = null,
      entityId = null,
      details = {},
      oldValues = null,
      newValues = null
    } = options;

    try {
      // Extraire les infos utilisateur
      const tenant = extractTenantFromRequest(req);

      // Extraire le nom et email depuis plusieurs sources possibles
      const actorName = req.user?.name
        || req.headers['x-user-name']
        || tenant.email?.split('@')[0]
        || null;

      const actorEmail = req.user?.email
        || req.headers['x-user-email']
        || tenant.email
        || null;

      const actorRole = tenant.role || 'unknown';

      // Métadonnées de la requête
      const ipAddress = req.ip
        || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.connection?.remoteAddress
        || null;

      const userAgent = req.headers['user-agent'] || null;
      const requestId = req.headers['x-request-id'] || null;

      await pool.query(`
        INSERT INTO ${tableName} (
          company_id, site_id, action, entity_type, entity_id,
          actor_name, actor_email, actor_role,
          details, old_values, new_values,
          ip_address, user_agent, request_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        tenant.companyId,
        tenant.siteId,
        action,
        entityType,
        entityId?.toString(),
        actorName,
        actorEmail,
        actorRole,
        JSON.stringify(details),
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress,
        userAgent,
        requestId
      ]);

      // Log console pour debugging
      console.log(`[${serviceName}][AUDIT] ${action}`, {
        by: actorEmail || actorName || 'anonymous',
        entity: entityType ? `${entityType}:${entityId}` : null,
        company: tenant.companyId,
        site: tenant.siteId
      });
    } catch (e) {
      // Ne jamais bloquer l'application pour un log
      console.warn(`[${serviceName}][AUDIT] Failed to log ${action}:`, e.message);
    }
  }

  /**
   * Récupère l'historique d'audit pour une entité
   *
   * @param {string} entityType - Type d'entité
   * @param {string|number} entityId - ID de l'entité
   * @param {Object} options - Options de pagination
   * @returns {Array} Liste des événements
   */
  async function getHistory(entityType, entityId, options = {}) {
    const { limit = 50, offset = 0 } = options;

    const { rows } = await pool.query(`
      SELECT id, ts, action, actor_name, actor_email, details, old_values, new_values
      FROM ${tableName}
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY ts DESC
      LIMIT $3 OFFSET $4
    `, [entityType, entityId.toString(), limit, offset]);

    return rows;
  }

  /**
   * Récupère les événements récents pour un site/company
   *
   * @param {Object} tenant - Objet tenant
   * @param {Object} options - Options de filtrage
   * @returns {Array} Liste des événements
   */
  async function getRecentEvents(tenant, options = {}) {
    const {
      limit = 100,
      offset = 0,
      action = null,
      entityType = null,
      since = null
    } = options;

    let query = `
      SELECT id, ts, action, entity_type, entity_id,
             actor_name, actor_email, details
      FROM ${tableName}
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Filtrage par company/site selon le rôle
    if (tenant.role !== 'superadmin') {
      if (tenant.companyId) {
        query += ` AND company_id = $${paramIndex}`;
        params.push(tenant.companyId);
        paramIndex++;
      }

      if (tenant.role === 'site' && tenant.siteId) {
        query += ` AND site_id = $${paramIndex}`;
        params.push(tenant.siteId);
        paramIndex++;
      }
    }

    if (action) {
      query += ` AND action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (entityType) {
      query += ` AND entity_type = $${paramIndex}`;
      params.push(entityType);
      paramIndex++;
    }

    if (since) {
      query += ` AND ts >= $${paramIndex}`;
      params.push(since);
      paramIndex++;
    }

    query += ` ORDER BY ts DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Compte les événements par type (pour dashboard)
   */
  async function getStats(tenant, options = {}) {
    const { days = 30 } = options;

    let query = `
      SELECT
        action,
        COUNT(*) as count,
        COUNT(DISTINCT actor_email) as unique_actors
      FROM ${tableName}
      WHERE ts >= NOW() - INTERVAL '${days} days'
    `;
    const params = [];
    let paramIndex = 1;

    if (tenant.role !== 'superadmin' && tenant.companyId) {
      query += ` AND company_id = $${paramIndex}`;
      params.push(tenant.companyId);
      paramIndex++;
    }

    query += ` GROUP BY action ORDER BY count DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  return {
    tableName,
    ensureTable,
    log,
    getHistory,
    getRecentEvents,
    getStats
  };
}

/**
 * Fonction helper pour créer un log d'audit simple (sans créer l'objet complet)
 * Utile pour les services qui ont déjà leur propre pool
 *
 * @param {Pool} pool - Pool de connexion
 * @param {string} tableName - Nom de la table d'audit (ex: 'switchboard_audit_log')
 * @param {Request} req - Requête Express
 * @param {string} action - Action effectuée
 * @param {Object} options - Options supplémentaires
 */
export async function logAuditEvent(pool, tableName, req, action, options = {}) {
  const audit = createAuditTrail(pool, tableName.replace('_audit_log', ''));
  await audit.log(req, action, options);
}

/**
 * Actions standard prédéfinies pour cohérence
 */
export const AUDIT_ACTIONS = {
  // Création
  CREATED: 'created',
  IMPORTED: 'imported',
  CLONED: 'cloned',

  // Modification
  UPDATED: 'updated',
  SETTINGS_CHANGED: 'settings_changed',
  STATUS_CHANGED: 'status_changed',
  MOVED: 'moved',
  RENAMED: 'renamed',

  // Suppression
  DELETED: 'deleted',
  ARCHIVED: 'archived',
  PURGED: 'purged',

  // Contrôles / Inspections
  CHECK_STARTED: 'check_started',
  CHECK_COMPLETED: 'check_completed',
  CHECK_FAILED: 'check_failed',

  // Fichiers
  FILE_UPLOADED: 'file_uploaded',
  FILE_DELETED: 'file_deleted',
  PHOTO_UPDATED: 'photo_updated',

  // Plans / Positions
  POSITION_SET: 'position_set',
  POSITION_CLEARED: 'position_cleared',
  PLAN_UPLOADED: 'plan_uploaded',

  // Export / Rapports
  EXPORTED: 'exported',
  REPORT_GENERATED: 'report_generated',
  PDF_GENERATED: 'pdf_generated',

  // Accès
  VIEWED: 'viewed',
  SEARCHED: 'searched',
  DOWNLOADED: 'downloaded'
};

export default {
  createAuditTrail,
  logAuditEvent,
  AUDIT_ACTIONS
};
