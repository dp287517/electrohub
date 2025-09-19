// server_atex.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import multer from 'multer';
import jwt from 'jsonwebtoken';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// CORS
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// MIDDLEWARE AUTH - S'APPLIQUE À TOUTES LES ROUTES ATEX (SAUF HEALTH)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'dev', (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Applique auth à /api/atex/*
app.use('/api/atex', authenticateToken);

// Health (publique, sans auth)
app.get('/api/atex/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Utils
function addMonths(dateStr, months = 36) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

// Enhanced Conformité: Parse category from marking and check against zone
function getCategoryFromMarking(ref, type) { // type: 'G' or 'D'
  const upper = (ref || '').toUpperCase();
  const match = upper.match(new RegExp(`II\\s*([1-3])${type}`, 'i'));
  return match ? parseInt(match[1]) : null;
}

function getRequiredCategory(zone, type) { // type: gas or dust
  const z = Number(zone);
  if (type === 'gas') {
    if (z === 0) return 1;
    if (z === 1) return [1, 2];
    if (z === 2) return [1, 2, 3];
  } else if (type === 'dust') {
    if (z === 20) return 1;
    if (z === 21) return [1, 2];
    if (z === 22) return [1, 2, 3];
  }
  return null;
}

function assessCompliance(atex_ref = '', zone_gas = null, zone_dust = null) {
  const ref = (atex_ref || '').toUpperCase();
  const needsGas = [0,1,2].includes(Number(zone_gas));
  const needsDust = [20,21,22].includes(Number(zone_dust));

  // Parse categories
  const catGas = getCategoryFromMarking(ref, 'G');
  const catDust = getCategoryFromMarking(ref, 'D');

  const problems = [];

  // Gas check
  if (needsGas) {
    if (catGas === null) {
      problems.push('No gas category (G) in ATEX marking for gas zone.');
    } else {
      const reqGas = getRequiredCategory(zone_gas, 'gas');
      if (reqGas && !reqGas.includes(catGas)) {
        problems.push(`Gas category ${catGas}G not suitable for zone ${zone_gas} (requires ${reqGas.join(' or ')}).`);
      }
    }
  }

  // Dust check
  if (needsDust) {
    if (catDust === null) {
      problems.push('No dust category (D) in ATEX marking for dust zone.');
    } else {
      const reqDust = getRequiredCategory(zone_dust, 'dust');
      if (reqDust && !reqDust.includes(catDust)) {
        problems.push(`Dust category ${catDust}D not suitable for zone ${zone_dust} (requires ${reqDust.join(' or ')}).`);
      }
    }
  }

  return { status: problems.length ? 'Non conforme' : 'Conforme', problems };
}

// SUGGESTS - FILTRE PAR SITE
app.get('/api/atex/suggests', async (req, res) => {
  try {
    const userSite = req.user.site;
    const fields = ['building','room','component_type','manufacturer','manufacturer_ref','atex_ref'];
    const out = {};
    
    for (const field of fields) {
      const { rows } = await pool.query(`
        SELECT DISTINCT ${field} 
        FROM atex_equipments 
        WHERE site = $1 AND ${field} IS NOT NULL AND ${field} <> '' 
        ORDER BY ${field} ASC 
        LIMIT 200
      `, [userSite]);
      
      out[field] = rows.map(row => row[field]).filter(Boolean);
    }
    
    res.json(out);
  } catch (e) {
    console.error('[SUGGESTS] error:', e);
    res.status(500).json({ error: 'Suggests failed: ' + e.message });
  }
});

// LIST - VERSION SIMPLIFIÉE ET ROBUSTE AVEC FILTRE SITE
app.get('/api/atex/equipments', async (req, res) => {
  try {
    const userSite = req.user.site;
    const { sort = 'created_at', dir = 'DESC', limit = 100, offset = 0, search = '' } = req.query;
    
    // Construction simple de la query
    let whereClause = `WHERE site = $1`;
    let values = [userSite];
    let countValues = [userSite];
    
    // Ajoute le filtre search si présent
    if (search) {
      const searchParam = `%${search}%`;
      whereClause += ` AND (component_type ILIKE $2 OR building ILIKE $2 OR room ILIKE $2)`;
      values.push(searchParam);
      countValues.push(searchParam);
    }
    
    // Query pour les données (paramètres ajustés pour search)
    const paramOffset = values.length + 1;
    const paramLimit = paramOffset + 1;
    const dataQuery = `
      SELECT * FROM atex_equipments 
      ${whereClause}
      ORDER BY ${sort} ${dir.toUpperCase()}
      LIMIT $${paramLimit} OFFSET $${paramOffset}
    `;
    
    values.push(parseInt(limit), parseInt(offset));
    
    const { rows: dataRows } = await pool.query(dataQuery, values);
    
    // Query pour le total (paramètres ajustés)
    const countParamOffset = countValues.length + 1;
    const countQuery = `
      SELECT COUNT(*) as total FROM atex_equipments 
      ${whereClause.replace(/\$2/g, '$1').replace(/\$1/g, '$1')}  -- Ajuste pour count (pas de search double)
    `;
    
    const { rows: countRows } = await pool.query(countQuery, countValues);
    
    res.json({ 
      data: dataRows, 
      total: parseInt(countRows[0].total),
      userSite
    });
    
  } catch (e) {
    console.error('[LIST] error:', e);
    res.status(500).json({ error: 'List failed: ' + e.message });
  }
});

// CREATE - SITE AUTO
app.post('/api/atex/equipments', async (req, res) => {
  try {
    const userSite = req.user.site;
    const { 
      building, room, component_type, manufacturer, manufacturer_ref, 
      atex_ref, zone_gas, zone_dust, last_control, comments 
    } = req.body;

    const next_control = last_control ? addMonths(last_control, 36) : null;
    const compliance = assessCompliance(atex_ref, zone_gas, zone_dust);
    
    const { rows } = await pool.query(`
      INSERT INTO atex_equipments (
        site, building, room, component_type, manufacturer, manufacturer_ref, 
        atex_ref, zone_gas, zone_dust, status, last_control, next_control, 
        comments, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *
    `, [
      userSite, building, room, component_type, manufacturer, manufacturer_ref, 
      atex_ref, zone_gas, zone_dust, compliance.status, last_control, next_control, 
      comments
    ]);

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[CREATE] error:', e?.message);
    res.status(500).json({ error: 'Create failed: ' + e.message });
  }
});

// UPDATE - FILTRE PAR SITE
app.put('/api/atex/equipments/:id', async (req, res) => {
  try {
    const userSite = req.user.site;
    const id = req.params.id;
    const updates = { ...req.body };
    const setClauses = [];
    const values = [id, userSite];

    // Calcule next_control si last_control changé
    if (updates.last_control !== undefined) {
      updates.next_control = addMonths(updates.last_control, 36);
    }

    // Évalue conformité si zones ou atex_ref changés
    if (updates.atex_ref !== undefined || updates.zone_gas !== undefined || updates.zone_dust !== undefined) {
      const compliance = assessCompliance(updates.atex_ref || '', updates.zone_gas, updates.zone_dust);
      updates.status = compliance.status;
    }

    Object.keys(updates).forEach((key, index) => {
      setClauses.push(`${key} = $${index + 3}`);
      values.push(updates[key]);
    });

    const { rows } = await pool.query(`
      UPDATE atex_equipments 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND site = $2
      RETURNING *
    `, values);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found or access denied' });
    }

    res.json(rows[0]);
  } catch (e) {
    console.error('[UPDATE] error:', e?.message);
    res.status(500).json({ error: 'Update failed: ' + e.message });
  }
});

// DELETE - FILTRE PAR SITE
app.delete('/api/atex/equipments/:id', async (req, res) => {
  try {
    const userSite = req.user.site;
    const id = req.params.id;
    const { rows } = await pool.query(
      'DELETE FROM atex_equipments WHERE id = $1 AND site = $2 RETURNING id',
      [id, userSite]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found or access denied' });
    }

    res.json({ message: 'Deleted successfully' });
  } catch (e) {
    console.error('[DELETE] error:', e?.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ANALYTICS - FILTRE PAR SITE
app.get('/api/atex/analytics', async (req, res) => {
  try {
    const userSite = req.user.site;
    const now = new Date();
    const ninetyDaysFromNow = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000));

    // Stats générales
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN next_control < $1 THEN 1 END)::int as overdue,
        COUNT(CASE WHEN next_control >= $1 AND next_control <= $2 THEN 1 END)::int as due_90_days,
        COUNT(CASE WHEN next_control > $2 THEN 1 END)::int as future,
        COUNT(CASE WHEN status = 'Conforme' THEN 1 END)::int as compliant,
        COUNT(CASE WHEN status = 'Non conforme' THEN 1 END)::int as non_compliant
      FROM atex_equipments 
      WHERE site = $3
    `, [
      now.toISOString().slice(0,10), 
      ninetyDaysFromNow.toISOString().slice(0,10),
      userSite
    ]);

    // Répartition par zone
    const zones = await pool.query(`
      SELECT 
        COALESCE(zone_gas, 0) as gas_zone,
        COALESCE(zone_dust, 0) as dust_zone,
        COUNT(*) as count
      FROM atex_equipments 
      WHERE site = $1
      GROUP BY zone_gas, zone_dust 
      ORDER BY gas_zone, dust_zone
    `, [userSite]);

    // Répartition par type
    const byType = await pool.query(`
      SELECT component_type, COUNT(*) as count
      FROM atex_equipments 
      WHERE site = $1
      GROUP BY component_type 
      ORDER BY count DESC 
      LIMIT 10
    `, [userSite]);

    // Répartition par bâtiment
    const byBuilding = await pool.query(`
      SELECT building, COUNT(*) as count
      FROM atex_equipments 
      WHERE site = $1 AND building IS NOT NULL AND building <> ''
      GROUP BY building 
      ORDER BY count DESC 
      LIMIT 10
    `, [userSite]);

    // Équipements à risque
    const riskEquipment = await pool.query(`
      SELECT id, component_type, building, room, zone_gas, zone_dust, status, next_control,
             $1::date - next_control::date as days_overdue
      FROM atex_equipments 
      WHERE site = $4 AND (next_control < $2 OR (next_control >= $1 AND next_control <= $3))
      ORDER BY next_control ASC
      LIMIT 20
    `, [
      now.toISOString().slice(0,10), 
      now.toISOString().slice(0,10), 
      ninetyDaysFromNow.toISOString().slice(0,10),
      userSite
    ]);

    // Compliance par zone
    const complianceByZone = await pool.query(`
      SELECT 
        COALESCE(zone_gas, 0) as zone,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'Conforme' THEN 1 END) as compliant,
        COUNT(CASE WHEN status = 'Non conforme' THEN 1 END) as non_compliant,
        COUNT(CASE WHEN status = 'À vérifier' THEN 1 END) as to_review
      FROM atex_equipments 
      WHERE site = $1 AND zone_gas IS NOT NULL 
      GROUP BY zone_gas 
      ORDER BY zone_gas
    `, [userSite]);

    res.json({
      stats: stats.rows[0],
      zones: zones.rows,
      byType: byType.rows,
      byBuilding: byBuilding.rows,
      riskEquipment: riskEquipment.rows,
      complianceByZone: complianceByZone.rows,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] error:', e?.message);
    res.status(500).json({ error: 'Analytics failed' });
  }
});

// ------- EXPORT EXCEL -------
app.get('/api/atex/export', async (req, res) => {
  try {
    const userSite = req.user.site;
    const { rows } = await pool.query(`
      SELECT 
        COALESCE(site, '') as site,
        COALESCE(building, '') as building,
        COALESCE(room, '') as room,
        COALESCE(component_type, '') as component_type,
        COALESCE(manufacturer, '') as manufacturer,
        COALESCE(manufacturer_ref, '') as manufacturer_ref,
        COALESCE(atex_ref, '') as atex_ref,
        zone_gas,
        zone_dust,
        COALESCE(status, '') as status,
        CASE WHEN last_control IS NOT NULL THEN last_control::text ELSE '' END as last_control,
        CASE WHEN next_control IS NOT NULL THEN next_control::text ELSE '' END as next_control,
        COALESCE(comments, '') as comments,
        CASE WHEN created_at IS NOT NULL THEN created_at::text ELSE '' END as created_at,
        CASE WHEN updated_at IS NOT NULL THEN updated_at::text ELSE '' END as updated_at
      FROM atex_equipments 
      WHERE site = $1
      ORDER BY building, room, component_type
    `, [userSite]);

    // Format pour Excel
    const exportData = rows.map(row => ({
      site: row.site,
      building: row.building,
      room: row.room,
      component_type: row.component_type,
      manufacturer: row.manufacturer,
      manufacturer_ref: row.manufacturer_ref,
      atex_ref: row.atex_ref,
      zone_gas: row.zone_gas || '',
      zone_dust: row.zone_dust || '',
      status: row.status,
      last_control: row.last_control ? row.last_control.slice(0,10) : '',
      next_control: row.next_control ? row.next_control.slice(0,10) : '',
      comments: row.comments,
      created_at: row.created_at ? row.created_at.slice(0,19) : '',
      updated_at: row.updated_at ? row.updated_at.slice(0,19) : ''
    }));

    res.json({ data: exportData, columns: Object.keys(exportData[0] || {}) });
  } catch (e) {
    console.error('[EXPORT] error:', e?.message);
    res.status(500).json({ error: 'Export failed: ' + e.message });
  }
});

const port = process.env.ATEX_PORT || 3001;
app.listen(port, () => console.log(`ATEX service listening on :${port}`));
