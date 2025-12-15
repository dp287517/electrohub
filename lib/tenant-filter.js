// lib/tenant-filter.js
// =============================================================================
// HELPER MULTI-TENANT POUR TOUS LES MICROSERVICES
// Gère le filtrage par company_id et site_id
// =============================================================================
//
// USAGE:
//   import { getTenantFilter, requireTenant, extractTenantFromRequest } from './lib/tenant-filter.js';
//
//   // Dans une route:
//   const tenant = extractTenantFromRequest(req);
//   const filter = getTenantFilter(tenant);
//   const result = await pool.query(`SELECT * FROM my_table WHERE ${filter.where}`, filter.params);
//
// =============================================================================

import jwt from 'jsonwebtoken';

/**
 * Extrait les informations de tenant depuis la requête
 * Cherche dans: cookies, header Authorization, headers X-Company-Id/X-Site-Id
 *
 * @param {Request} req - Express request
 * @returns {Object} { userId, companyId, siteId, role, email }
 */
export function extractTenantFromRequest(req) {
  const tenant = {
    userId: null,
    companyId: null,
    siteId: null,
    role: 'site',
    email: null,
    siteName: null, // Pour compatibilité avec site TEXT existant
  };

  // 1. Essayer d'extraire depuis le JWT (cookie ou header)
  let token = req.cookies?.token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (token) {
    try {
      const secret = process.env.JWT_SECRET || 'devsecret';
      const decoded = jwt.verify(token, secret);
      tenant.userId = decoded.id;
      tenant.email = decoded.email;
      tenant.companyId = decoded.company_id || decoded.companyId;
      tenant.siteId = decoded.site_id || decoded.siteId;
      tenant.siteName = decoded.site || decoded.siteName;
      tenant.role = decoded.role || 'site';
    } catch (e) {
      // Token invalide, continuer avec les headers
    }
  }

  // 2. Override par headers explicites (pour les requêtes internes)
  if (req.headers['x-company-id']) {
    tenant.companyId = parseInt(req.headers['x-company-id']);
  }
  if (req.headers['x-site-id']) {
    tenant.siteId = parseInt(req.headers['x-site-id']);
  }
  if (req.headers['x-site']) {
    tenant.siteName = req.headers['x-site'];
  }
  if (req.headers['x-user-role']) {
    tenant.role = req.headers['x-user-role'];
  }
  if (req.headers['x-user-email']) {
    tenant.email = req.headers['x-user-email'];
  }

  // 3. Si on a req.user (défini par un middleware auth), utiliser ces données
  if (req.user) {
    tenant.userId = tenant.userId || req.user.id;
    tenant.email = tenant.email || req.user.email;
    tenant.companyId = tenant.companyId || req.user.company_id || req.user.companyId;
    tenant.siteId = tenant.siteId || req.user.site_id || req.user.siteId;
    tenant.siteName = tenant.siteName || req.user.site || req.user.siteName;
    tenant.role = req.user.role || tenant.role;
  }

  return tenant;
}

/**
 * Génère les conditions WHERE pour filtrer par tenant
 *
 * @param {Object} tenant - Objet tenant de extractTenantFromRequest
 * @param {Object} options - Options supplémentaires
 * @param {string} options.tableAlias - Alias de table (ex: 'e' pour e.company_id)
 * @param {boolean} options.useSiteName - Utiliser site TEXT au lieu de site_id (pour compatibilité)
 * @param {number} options.paramOffset - Offset pour les paramètres $1, $2...
 * @returns {Object} { where: string, params: array, nextParam: number }
 */
export function getTenantFilter(tenant, options = {}) {
  const { tableAlias = '', useSiteName = false, paramOffset = 0 } = options;
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const params = [];
  let paramIndex = paramOffset + 1;
  const conditions = [];

  // Superadmin: pas de filtre
  if (tenant.role === 'superadmin') {
    return { where: '1=1', params: [], nextParam: paramIndex };
  }

  // Admin ou Global: filtrer par company_id uniquement
  if (tenant.role === 'admin' || tenant.role === 'global') {
    if (tenant.companyId) {
      conditions.push(`${prefix}company_id = $${paramIndex}`);
      params.push(tenant.companyId);
      paramIndex++;
    }
  }
  // Site: filtrer par site_id (ou site TEXT pour compatibilité)
  else {
    if (tenant.companyId) {
      conditions.push(`${prefix}company_id = $${paramIndex}`);
      params.push(tenant.companyId);
      paramIndex++;
    }

    if (useSiteName && tenant.siteName) {
      conditions.push(`${prefix}site = $${paramIndex}`);
      params.push(tenant.siteName);
      paramIndex++;
    } else if (tenant.siteId) {
      conditions.push(`${prefix}site_id = $${paramIndex}`);
      params.push(tenant.siteId);
      paramIndex++;
    }
  }

  // Si aucune condition:
  // - Pour les utilisateurs @haleon.com: autoriser tout (migration en cours)
  // - Sinon: bloquer par sécurité
  if (conditions.length === 0) {
    // Autoriser les utilisateurs Haleon pendant la migration
    if (tenant.email && tenant.email.endsWith('@haleon.com')) {
      return { where: '1=1', params: [], nextParam: paramIndex };
    }
    // Bloquer les autres par défaut (sécurité)
    return { where: '1=0', params: [], nextParam: paramIndex };
  }

  return {
    where: conditions.join(' AND '),
    params,
    nextParam: paramIndex
  };
}

/**
 * Middleware Express qui exige un tenant valide
 * Rejette la requête si pas de company_id/site_id
 *
 * @param {Object} options
 * @param {boolean} options.requireSite - Exiger aussi site_id (pas juste company)
 * @param {string[]} options.allowRoles - Rôles autorisés (défaut: tous)
 */
export function requireTenant(options = {}) {
  const { requireSite = false, allowRoles = null } = options;

  return (req, res, next) => {
    const tenant = extractTenantFromRequest(req);
    req.tenant = tenant;

    // Vérifier le rôle si spécifié
    if (allowRoles && !allowRoles.includes(tenant.role)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Role '${tenant.role}' not allowed. Required: ${allowRoles.join(', ')}`
      });
    }

    // Superadmin a tous les accès
    if (tenant.role === 'superadmin') {
      return next();
    }

    // Vérifier company_id
    if (!tenant.companyId) {
      return res.status(403).json({
        error: 'Tenant required',
        message: 'No company associated with your account'
      });
    }

    // Vérifier site_id si requis
    if (requireSite && !tenant.siteId && tenant.role === 'site') {
      return res.status(403).json({
        error: 'Site required',
        message: 'No site associated with your account'
      });
    }

    next();
  };
}

/**
 * Ajoute automatiquement company_id et site_id lors de l'INSERT
 *
 * @param {Object} tenant - Objet tenant
 * @param {Object} data - Données à insérer
 * @returns {Object} Données enrichies avec company_id et site_id
 */
export function addTenantToData(tenant, data) {
  return {
    ...data,
    company_id: tenant.companyId,
    site_id: tenant.siteId
  };
}

/**
 * Vérifie si un utilisateur peut accéder à une ressource spécifique
 *
 * @param {Object} tenant - Objet tenant de l'utilisateur
 * @param {Object} resource - Ressource avec company_id et site_id
 * @returns {boolean}
 */
export function canAccessResource(tenant, resource) {
  // Superadmin: accès total
  if (tenant.role === 'superadmin') return true;

  // Doit être dans la même entreprise
  if (tenant.companyId !== resource.company_id) return false;

  // Admin/Global: accès à toute l'entreprise
  if (tenant.role === 'admin' || tenant.role === 'global') return true;

  // Site: uniquement son site
  return tenant.siteId === resource.site_id;
}

/**
 * Génère les colonnes et valeurs pour un INSERT avec tenant
 *
 * @param {Object} tenant - Objet tenant
 * @param {Object} data - Données à insérer
 * @param {number} paramOffset - Offset pour les paramètres
 * @returns {Object} { columns: string[], placeholders: string[], params: any[], nextParam: number }
 */
export function buildInsertWithTenant(tenant, data, paramOffset = 0) {
  const enrichedData = addTenantToData(tenant, data);
  const columns = Object.keys(enrichedData);
  const params = Object.values(enrichedData);
  const placeholders = columns.map((_, i) => `$${paramOffset + i + 1}`);

  return {
    columns,
    placeholders,
    params,
    nextParam: paramOffset + columns.length + 1
  };
}

/**
 * Helper pour construire une requête SELECT avec filtrage tenant
 *
 * @param {string} baseQuery - Requête de base (ex: "SELECT * FROM my_table")
 * @param {Object} tenant - Objet tenant
 * @param {Object} options - Options supplémentaires
 * @returns {Object} { query: string, params: array }
 */
export function buildSelectQuery(baseQuery, tenant, options = {}) {
  const { additionalWhere = '', additionalParams = [], useSiteName = false } = options;
  const filter = getTenantFilter(tenant, { useSiteName, paramOffset: additionalParams.length });

  let query = baseQuery;
  const params = [...additionalParams, ...filter.params];

  // Ajouter le WHERE tenant
  if (baseQuery.toLowerCase().includes('where')) {
    query += ` AND ${filter.where}`;
  } else {
    query += ` WHERE ${filter.where}`;
  }

  // Ajouter les conditions additionnelles
  if (additionalWhere) {
    query += ` AND ${additionalWhere}`;
  }

  return { query, params };
}

/**
 * Helper pour filtrage par site TEXT (compatibilité avec ancien schéma)
 * Respecte le rôle global/admin qui peut voir tous les sites
 *
 * @param {Request} req - Express request
 * @param {Object} options
 * @param {string} options.tableAlias - Alias de table (ex: 's' pour s.site)
 * @param {number} options.paramOffset - Offset pour les paramètres
 * @returns {Object} { where: string, params: array, siteName: string|null, role: string }
 */
export function getSiteFilter(req, options = {}) {
  const { tableAlias = '', paramOffset = 0 } = options;
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const tenant = extractTenantFromRequest(req);

  // Récupérer le site depuis header X-Site (pour compatibilité)
  const siteName = req.headers['x-site'] || req.query?.site || tenant.siteName;

  // Superadmin: pas de filtre
  if (tenant.role === 'superadmin') {
    return {
      where: '1=1',
      params: [],
      siteName,
      role: tenant.role,
      tenant
    };
  }

  // Global ou Admin: pas de filtre par site (voit toute l'entreprise)
  if (tenant.role === 'global' || tenant.role === 'admin') {
    return {
      where: '1=1',
      params: [],
      siteName,
      role: tenant.role,
      tenant
    };
  }

  // Site role: filtrer par site TEXT
  if (siteName) {
    return {
      where: `${prefix}site = $${paramOffset + 1}`,
      params: [siteName],
      siteName,
      role: tenant.role,
      tenant
    };
  }

  // Pas de site défini - bloquer par sécurité
  return {
    where: '1=0',
    params: [],
    siteName: null,
    role: tenant.role,
    tenant
  };
}

/**
 * Middleware qui vérifie le site ou autorise les rôles global/admin
 */
export function requireSiteOrGlobal() {
  return (req, res, next) => {
    const { siteName, role } = getSiteFilter(req);

    // Rôles globaux autorisés
    if (role === 'superadmin' || role === 'admin' || role === 'global') {
      return next();
    }

    // Sinon, site requis
    if (!siteName) {
      return res.status(400).json({
        error: 'Site required',
        message: 'Missing X-Site header'
      });
    }

    next();
  };
}

export default {
  extractTenantFromRequest,
  getTenantFilter,
  requireTenant,
  addTenantToData,
  canAccessResource,
  buildInsertWithTenant,
  buildSelectQuery,
  getSiteFilter,
  requireSiteOrGlobal
};
