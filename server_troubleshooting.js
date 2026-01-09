// server_troubleshooting.js - Système de dépannage intelligent avec agent IA
// Gestion des dépannages, rapports PDF et analyses statistiques
import express from 'express';
import PDFDocument from 'pdfkit';
import pg from 'pg';
import { createCanvas } from 'canvas';

const router = express.Router();

// Admin emails authorized to delete any troubleshooting
const ADMIN_EMAILS = ['daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com'];

// Check if user is admin
function isAdmin(email) {
  if (!email) return false;
  return ADMIN_EMAILS.some(adminEmail => adminEmail.toLowerCase() === email.toLowerCase());
}

// Get database pool from main server
let pool;
export function setPool(p) {
  pool = p;
}

// ============================================================
// INITIALIZATION - Create troubleshooting tables
// ============================================================
export async function initTroubleshootingTables(poolInstance) {
  pool = poolInstance;

  try {
    // Main troubleshooting records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS troubleshooting_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site VARCHAR(100) NOT NULL,

        -- Equipment reference (polymorphic - one of these will be set)
        equipment_type VARCHAR(50) NOT NULL, -- 'switchboard', 'vsd', 'meca', 'hv', 'glo', 'mobile', 'datahub'
        equipment_id UUID,
        equipment_name VARCHAR(255),
        equipment_code VARCHAR(100),

        -- Location info
        building_code VARCHAR(100),
        floor VARCHAR(50),
        zone VARCHAR(100),
        room VARCHAR(100),

        -- Troubleshooting details
        title VARCHAR(500) NOT NULL,
        description TEXT NOT NULL,
        root_cause TEXT,
        solution TEXT,
        parts_replaced TEXT,

        -- Classification
        category VARCHAR(100), -- 'electrical', 'mechanical', 'software', 'other'
        severity VARCHAR(50), -- 'critical', 'major', 'minor', 'cosmetic'
        fault_type VARCHAR(100), -- 'breakdown', 'malfunction', 'preventive', 'corrective'

        -- Time tracking
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        duration_minutes INTEGER,
        downtime_minutes INTEGER,

        -- Technician info
        technician_name VARCHAR(255) NOT NULL,
        technician_email VARCHAR(255),

        -- AI analysis
        ai_diagnosis TEXT,
        ai_recommendations TEXT,

        -- Status
        status VARCHAR(50) DEFAULT 'completed', -- 'in_progress', 'completed', 'pending_review'

        -- Metadata
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Photos table for troubleshooting
    await pool.query(`
      CREATE TABLE IF NOT EXISTS troubleshooting_photos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        troubleshooting_id UUID NOT NULL REFERENCES troubleshooting_records(id) ON DELETE CASCADE,
        photo_data TEXT NOT NULL, -- Base64 encoded
        caption VARCHAR(500),
        photo_type VARCHAR(50) DEFAULT 'before', -- 'before', 'during', 'after'
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes for fast queries
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_site ON troubleshooting_records(site)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_equipment ON troubleshooting_records(equipment_type, equipment_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_building ON troubleshooting_records(building_code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_date ON troubleshooting_records(created_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_status ON troubleshooting_records(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_photos_record ON troubleshooting_photos(troubleshooting_id)`);

    // Multi-equipment support table - links troubleshooting to multiple equipment
    await pool.query(`
      CREATE TABLE IF NOT EXISTS troubleshooting_equipment_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        troubleshooting_id UUID NOT NULL REFERENCES troubleshooting_records(id) ON DELETE CASCADE,
        equipment_id UUID NOT NULL,
        equipment_type VARCHAR(50) NOT NULL,
        equipment_name VARCHAR(255),
        equipment_code VARCHAR(100),
        building_code VARCHAR(100),
        is_primary BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_links_record ON troubleshooting_equipment_links(troubleshooting_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_troubleshooting_links_equipment ON troubleshooting_equipment_links(equipment_type, equipment_id)`);

    console.log('[TROUBLESHOOTING] ✅ Tables initialized successfully');
    return true;
  } catch (error) {
    console.error('[TROUBLESHOOTING] ❌ Table initialization error:', error.message);
    return false;
  }
}

// ============================================================
// HELPER FUNCTIONS FOR MINI PLAN
// ============================================================

// Position table mapping for different equipment types
const POSITION_TABLE_MAP = {
  switchboard: { table: 'switchboard_positions', idCol: 'switchboard_id', planCol: 'logical_name', planTable: 'switchboard_plans', planNamesTable: 'switchboard_plan_names' },
  vsd: { table: 'vsd_positions', idCol: 'equipment_id', planCol: 'logical_name', planTable: 'vsd_plans', planNamesTable: 'vsd_plan_names' },
  meca: { table: 'meca_positions', idCol: 'equipment_id', planCol: 'logical_name', planTable: 'meca_plans', planNamesTable: 'meca_plan_names' },
  mobile: { table: 'me_equipment_positions', idCol: 'equipment_id', planCol: 'plan_logical_name', planTable: 'vsd_plans', planNamesTable: 'vsd_plan_names' },
  hv: { table: 'hv_positions', idCol: 'equipment_id', planCol: 'logical_name', planTable: 'hv_plans', planNamesTable: 'hv_plan_names' },
  glo: { table: 'glo_positions', idCol: 'equipment_id', planCol: 'logical_name', planTable: 'glo_plans', planNamesTable: 'glo_plan_names' },
  datahub: { table: 'dh_positions', idCol: 'item_id', planCol: 'logical_name', planTable: 'dh_plans', planNamesTable: null },
  atex: { table: 'atex_positions', idCol: 'equipment_id', planCol: 'logical_name', planTable: 'atex_plans', planNamesTable: null },
  infrastructure: { table: 'inf_positions', idCol: 'item_id', planCol: 'logical_name', planTable: 'vsd_plans', planNamesTable: 'vsd_plan_names' }
};

// Get equipment position and plan data for mini plan
async function getEquipmentPlanData(equipmentType, equipmentId) {
  const config = POSITION_TABLE_MAP[equipmentType];
  if (!config || !equipmentId) {
    return null;
  }

  try {
    // Get position
    const posQuery = `SELECT ${config.planCol} as plan_key, page_index, x_frac, y_frac FROM ${config.table} WHERE ${config.idCol} = $1 LIMIT 1`;
    const posResult = await pool.query(posQuery, [equipmentId]);

    if (posResult.rows.length === 0) {
      return null;
    }

    const pos = posResult.rows[0];

    // Get plan thumbnail
    let thumbnail = null;
    let displayName = pos.plan_key;

    try {
      const planQuery = `SELECT thumbnail, content FROM ${config.planTable} WHERE logical_name = $1 ORDER BY version DESC LIMIT 1`;
      const planResult = await pool.query(planQuery, [pos.plan_key]);

      if (planResult.rows.length > 0) {
        thumbnail = planResult.rows[0].thumbnail || planResult.rows[0].content;
      }

      // Try to get display name
      if (config.planNamesTable) {
        const nameQuery = `SELECT display_name FROM ${config.planNamesTable} WHERE logical_name = $1 LIMIT 1`;
        const nameResult = await pool.query(nameQuery, [pos.plan_key]);
        if (nameResult.rows.length > 0 && nameResult.rows[0].display_name) {
          displayName = nameResult.rows[0].display_name;
        }
      }
    } catch (planErr) {
      console.warn(`[TROUBLESHOOTING] Plan query error for ${equipmentType}:`, planErr.message);
    }

    return {
      x_frac: pos.x_frac,
      y_frac: pos.y_frac,
      page_index: pos.page_index || 0,
      plan_key: pos.plan_key,
      display_name: displayName,
      thumbnail: thumbnail
    };
  } catch (err) {
    console.error(`[TROUBLESHOOTING] getEquipmentPlanData error:`, err.message);
    return null;
  }
}

// Generate mini plan image with marker
async function generateMiniPlanImage(planData, markerColor = '#3b82f6') {
  if (!planData?.thumbnail) return null;

  try {
    const { loadImage } = await import('canvas');
    const thumbnailBuffer = Buffer.isBuffer(planData.thumbnail)
      ? planData.thumbnail
      : Buffer.from(planData.thumbnail);

    const img = await loadImage(thumbnailBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    // Draw marker if position is valid
    if (planData.x_frac !== null && planData.y_frac !== null &&
        !isNaN(planData.x_frac) && !isNaN(planData.y_frac)) {
      const markerX = planData.x_frac * img.width;
      const markerY = planData.y_frac * img.height;
      const markerRadius = Math.max(12, img.width / 25);

      // Outer circle
      ctx.beginPath();
      ctx.arc(markerX, markerY, markerRadius, 0, 2 * Math.PI);
      ctx.fillStyle = markerColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Inner dot
      ctx.beginPath();
      ctx.arc(markerX, markerY, markerRadius / 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('[TROUBLESHOOTING] generateMiniPlanImage error:', err.message);
    return null;
  }
}

// ============================================================
// CRUD ENDPOINTS
// ============================================================

// Create new troubleshooting record (supports multiple equipment)
router.post('/create', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const {
      equipment_type, equipment_id, equipment_name, equipment_code,
      building_code, floor, zone, room,
      title, description, root_cause, solution, parts_replaced,
      category, severity, fault_type,
      started_at, completed_at, duration_minutes, downtime_minutes,
      technician_name, technician_email,
      ai_diagnosis, ai_recommendations,
      photos = [],
      // NEW: Support for multiple equipment
      additional_equipment = [] // Array of { equipment_id, equipment_type, equipment_name, equipment_code, building_code }
    } = req.body;

    // Get user info from request if not provided
    const finalTechnicianName = technician_name || req.user?.name || req.user?.email?.split('@')[0] || 'Technicien';
    const finalTechnicianEmail = technician_email || req.user?.email || '';
    const finalEquipmentType = equipment_type || 'generic';
    const finalTitle = title || 'Dépannage sans titre';

    // Validate required fields - only title is truly required now
    if (!finalTitle) {
      return res.status(400).json({ error: 'Le titre est requis' });
    }

    // Insert main record
    const result = await pool.query(`
      INSERT INTO troubleshooting_records (
        site, equipment_type, equipment_id, equipment_name, equipment_code,
        building_code, floor, zone, room,
        title, description, root_cause, solution, parts_replaced,
        category, severity, fault_type,
        started_at, completed_at, duration_minutes, downtime_minutes,
        technician_name, technician_email,
        ai_diagnosis, ai_recommendations,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, 'completed')
      RETURNING *
    `, [
      site, finalEquipmentType, equipment_id, equipment_name, equipment_code,
      building_code, floor, zone, room,
      finalTitle, description || '', root_cause, solution, parts_replaced,
      category, severity || 'minor', fault_type,
      started_at || new Date(), completed_at || new Date(), duration_minutes || 0, downtime_minutes || 0,
      finalTechnicianName, finalTechnicianEmail,
      ai_diagnosis, ai_recommendations
    ]);

    const record = result.rows[0];

    // Insert photos if any
    if (photos.length > 0) {
      for (const photo of photos) {
        await pool.query(`
          INSERT INTO troubleshooting_photos (troubleshooting_id, photo_data, caption, photo_type)
          VALUES ($1, $2, $3, $4)
        `, [record.id, photo.data, photo.caption, photo.type || 'after']);
      }
    }

    // Insert primary equipment link
    if (equipment_id) {
      await pool.query(`
        INSERT INTO troubleshooting_equipment_links
        (troubleshooting_id, equipment_id, equipment_type, equipment_name, equipment_code, building_code, is_primary)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      `, [record.id, equipment_id, finalEquipmentType, equipment_name, equipment_code, building_code]);
    }

    // Insert additional equipment links
    if (additional_equipment && additional_equipment.length > 0) {
      for (const eq of additional_equipment) {
        await pool.query(`
          INSERT INTO troubleshooting_equipment_links
          (troubleshooting_id, equipment_id, equipment_type, equipment_name, equipment_code, building_code, is_primary)
          VALUES ($1, $2, $3, $4, $5, $6, FALSE)
        `, [record.id, eq.equipment_id, eq.equipment_type, eq.equipment_name, eq.equipment_code, eq.building_code]);
      }
    }

    const totalEquipment = 1 + (additional_equipment?.length || 0);
    console.log(`[TROUBLESHOOTING] ✅ Created record ${record.id} for ${totalEquipment} equipment(s) - Primary: ${equipment_name}`);
    res.json({ success: true, id: record.id, record, linkedEquipment: totalEquipment });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all troubleshooting records with filters
router.get('/list', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const {
      equipment_type, equipment_id, building_code, floor, zone,
      category, severity, fault_type,
      date_from, date_to,
      search,
      limit = 50, offset = 0
    } = req.query;

    let sql = `
      SELECT tr.*,
             (SELECT COUNT(*) FROM troubleshooting_photos WHERE troubleshooting_id = tr.id) as photo_count,
             ROW_NUMBER() OVER (ORDER BY tr.created_at DESC) as row_number
      FROM troubleshooting_records tr
      WHERE tr.site = $1
    `;
    const params = [site];
    let paramIndex = 2;

    if (equipment_type) {
      sql += ` AND tr.equipment_type = $${paramIndex++}`;
      params.push(equipment_type);
    }
    if (equipment_id) {
      sql += ` AND tr.equipment_id = $${paramIndex++}`;
      params.push(equipment_id);
    }
    if (building_code) {
      sql += ` AND tr.building_code = $${paramIndex++}`;
      params.push(building_code);
    }
    if (floor) {
      sql += ` AND tr.floor = $${paramIndex++}`;
      params.push(floor);
    }
    if (zone) {
      sql += ` AND tr.zone = $${paramIndex++}`;
      params.push(zone);
    }
    if (category) {
      sql += ` AND tr.category = $${paramIndex++}`;
      params.push(category);
    }
    if (severity) {
      sql += ` AND tr.severity = $${paramIndex++}`;
      params.push(severity);
    }
    if (fault_type) {
      sql += ` AND tr.fault_type = $${paramIndex++}`;
      params.push(fault_type);
    }
    if (date_from) {
      sql += ` AND tr.created_at >= $${paramIndex++}`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND tr.created_at <= $${paramIndex++}`;
      params.push(date_to);
    }
    if (search) {
      sql += ` AND (tr.title ILIKE $${paramIndex} OR tr.description ILIKE $${paramIndex} OR tr.equipment_name ILIKE $${paramIndex} OR tr.technician_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    sql += ` ORDER BY tr.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(sql, params);

    // Get total count
    const countSql = sql.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY.*$/, '');
    const countResult = await pool.query(countSql.slice(0, countSql.lastIndexOf('LIMIT')), params.slice(0, -2));

    res.json({
      success: true,
      records: result.rows,
      total: parseInt(countResult.rows[0]?.total || result.rows.length),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('[TROUBLESHOOTING] List error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single troubleshooting record with photos
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [recordRes, photosRes] = await Promise.all([
      pool.query('SELECT * FROM troubleshooting_records WHERE id = $1', [id]),
      pool.query('SELECT * FROM troubleshooting_photos WHERE troubleshooting_id = $1 ORDER BY created_at', [id])
    ]);

    if (recordRes.rows.length === 0) {
      return res.status(404).json({ error: 'Enregistrement non trouvé' });
    }

    res.json({
      success: true,
      record: recordRes.rows[0],
      photos: photosRes.rows
    });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Get error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update troubleshooting record
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const allowedFields = [
      'title', 'description', 'root_cause', 'solution', 'parts_replaced',
      'category', 'severity', 'fault_type',
      'started_at', 'completed_at', 'duration_minutes', 'downtime_minutes',
      'ai_diagnosis', 'ai_recommendations', 'status'
    ];

    const setClauses = [];
    const params = [id];
    let paramIndex = 2;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex++}`);
        params.push(updates[field]);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    setClauses.push('updated_at = NOW()');

    const result = await pool.query(`
      UPDATE troubleshooting_records
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);

    res.json({ success: true, record: result.rows[0] });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete troubleshooting record
// Only the creator (technician_email) or an admin can delete
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.headers['x-user-email'] || req.user?.email || '';

    // Get the record to check ownership
    const recordResult = await pool.query(
      'SELECT technician_email FROM troubleshooting_records WHERE id = $1',
      [id]
    );

    if (recordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dépannage non trouvé' });
    }

    const record = recordResult.rows[0];
    const isCreator = record.technician_email &&
                      record.technician_email.toLowerCase() === userEmail.toLowerCase();
    const isUserAdmin = isAdmin(userEmail);

    // Check permissions
    if (!isCreator && !isUserAdmin) {
      console.log(`[TROUBLESHOOTING] Delete denied - user: ${userEmail}, creator: ${record.technician_email}`);
      return res.status(403).json({
        error: 'Vous n\'êtes pas autorisé à supprimer ce dépannage. Seul le créateur ou un administrateur peut le supprimer.',
        canDelete: false
      });
    }

    await pool.query('DELETE FROM troubleshooting_records WHERE id = $1', [id]);
    console.log(`[TROUBLESHOOTING] Record ${id} deleted by ${userEmail} (admin: ${isUserAdmin}, creator: ${isCreator})`);
    res.json({ success: true });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ANALYTICS ENDPOINTS
// ============================================================

// Get statistics by building/floor/zone
router.get('/analytics/by-location', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { date_from, date_to, group_by = 'building' } = req.query;

    let groupField, groupName;
    switch (group_by) {
      case 'floor':
        groupField = 'building_code, floor';
        groupName = "CONCAT(building_code, ' - Étage ', COALESCE(floor, 'N/A'))";
        break;
      case 'zone':
        groupField = 'zone';
        groupName = "COALESCE(zone, 'Non définie')";
        break;
      default:
        groupField = 'building_code';
        groupName = "COALESCE(building_code, 'Non défini')";
    }

    let sql = `
      SELECT
        ${groupName} as location,
        COUNT(*) as total_interventions,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE severity = 'major') as major_count,
        COUNT(*) FILTER (WHERE severity = 'minor') as minor_count,
        AVG(duration_minutes) as avg_duration,
        SUM(downtime_minutes) as total_downtime,
        array_agg(DISTINCT equipment_type) as equipment_types
      FROM troubleshooting_records
      WHERE site = $1
    `;
    const params = [site];
    let paramIndex = 2;

    if (date_from) {
      sql += ` AND created_at >= $${paramIndex++}`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND created_at <= $${paramIndex++}`;
      params.push(date_to);
    }

    sql += ` GROUP BY ${groupField} ORDER BY total_interventions DESC`;

    const result = await pool.query(sql, params);

    res.json({
      success: true,
      group_by,
      data: result.rows.map(row => ({
        ...row,
        total_interventions: parseInt(row.total_interventions),
        critical_count: parseInt(row.critical_count),
        major_count: parseInt(row.major_count),
        minor_count: parseInt(row.minor_count),
        avg_duration: Math.round(parseFloat(row.avg_duration) || 0),
        total_downtime: parseInt(row.total_downtime) || 0
      }))
    });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Analytics by-location error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get most problematic equipment
router.get('/analytics/problematic-equipment', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { date_from, date_to, equipment_type, limit = 20 } = req.query;

    let sql = `
      SELECT
        equipment_type,
        equipment_id,
        equipment_name,
        equipment_code,
        building_code,
        COUNT(*) as intervention_count,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
        SUM(downtime_minutes) as total_downtime,
        AVG(duration_minutes) as avg_repair_time,
        MAX(created_at) as last_intervention,
        array_agg(DISTINCT category) as fault_categories
      FROM troubleshooting_records
      WHERE site = $1
    `;
    const params = [site];
    let paramIndex = 2;

    if (date_from) {
      sql += ` AND created_at >= $${paramIndex++}`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND created_at <= $${paramIndex++}`;
      params.push(date_to);
    }
    if (equipment_type) {
      sql += ` AND equipment_type = $${paramIndex++}`;
      params.push(equipment_type);
    }

    sql += `
      GROUP BY equipment_type, equipment_id, equipment_name, equipment_code, building_code
      HAVING COUNT(*) >= 2
      ORDER BY intervention_count DESC, critical_count DESC
      LIMIT $${paramIndex}
    `;
    params.push(parseInt(limit));

    const result = await pool.query(sql, params);

    res.json({
      success: true,
      problematic_equipment: result.rows.map(row => ({
        ...row,
        intervention_count: parseInt(row.intervention_count),
        critical_count: parseInt(row.critical_count),
        total_downtime: parseInt(row.total_downtime) || 0,
        avg_repair_time: Math.round(parseFloat(row.avg_repair_time) || 0)
      }))
    });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Analytics problematic-equipment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get monthly statistics
router.get('/analytics/monthly', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { year = new Date().getFullYear() } = req.query;

    const result = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        TO_CHAR(created_at, 'Month') as month_name,
        COUNT(*) as total_interventions,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE severity = 'major') as major_count,
        COUNT(*) FILTER (WHERE severity = 'minor') as minor_count,
        SUM(downtime_minutes) as total_downtime,
        AVG(duration_minutes) as avg_duration,
        COUNT(DISTINCT equipment_id) as unique_equipment,
        COUNT(DISTINCT technician_email) as technicians_involved
      FROM troubleshooting_records
      WHERE site = $1 AND EXTRACT(YEAR FROM created_at) = $2
      GROUP BY TO_CHAR(created_at, 'YYYY-MM'), TO_CHAR(created_at, 'Month')
      ORDER BY month
    `, [site, parseInt(year)]);

    res.json({
      success: true,
      year: parseInt(year),
      monthly_data: result.rows.map(row => ({
        ...row,
        total_interventions: parseInt(row.total_interventions),
        critical_count: parseInt(row.critical_count),
        major_count: parseInt(row.major_count),
        minor_count: parseInt(row.minor_count),
        total_downtime: parseInt(row.total_downtime) || 0,
        avg_duration: Math.round(parseFloat(row.avg_duration) || 0),
        unique_equipment: parseInt(row.unique_equipment),
        technicians_involved: parseInt(row.technicians_involved)
      }))
    });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Analytics monthly error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get summary statistics
router.get('/analytics/summary', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { date_from, date_to } = req.query;

    let dateFilter = '';
    const params = [site];
    let paramIndex = 2;

    if (date_from) {
      dateFilter += ` AND created_at >= $${paramIndex++}`;
      params.push(date_from);
    }
    if (date_to) {
      dateFilter += ` AND created_at <= $${paramIndex++}`;
      params.push(date_to);
    }

    const result = await pool.query(`
      SELECT
        COUNT(*) as total_interventions,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE severity = 'major') as major_count,
        COUNT(*) FILTER (WHERE severity = 'minor') as minor_count,
        COUNT(*) FILTER (WHERE fault_type = 'breakdown') as breakdowns,
        COUNT(*) FILTER (WHERE fault_type = 'preventive') as preventive,
        SUM(downtime_minutes) as total_downtime_minutes,
        AVG(duration_minutes) as avg_repair_time,
        COUNT(DISTINCT equipment_id) as unique_equipment,
        COUNT(DISTINCT building_code) as buildings_affected,
        COUNT(DISTINCT technician_email) as technicians_count,
        (SELECT equipment_name FROM troubleshooting_records WHERE site = $1 ${dateFilter} GROUP BY equipment_name ORDER BY COUNT(*) DESC LIMIT 1) as most_problematic
      FROM troubleshooting_records
      WHERE site = $1 ${dateFilter}
    `, params);

    const row = result.rows[0];

    // Get category breakdown
    const categoryResult = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM troubleshooting_records
      WHERE site = $1 ${dateFilter}
      GROUP BY category
      ORDER BY count DESC
    `, params);

    // Get equipment type breakdown
    const typeResult = await pool.query(`
      SELECT equipment_type, COUNT(*) as count
      FROM troubleshooting_records
      WHERE site = $1 ${dateFilter}
      GROUP BY equipment_type
      ORDER BY count DESC
    `, params);

    res.json({
      success: true,
      summary: {
        total_interventions: parseInt(row.total_interventions) || 0,
        by_severity: {
          critical: parseInt(row.critical_count) || 0,
          major: parseInt(row.major_count) || 0,
          minor: parseInt(row.minor_count) || 0
        },
        by_type: {
          breakdowns: parseInt(row.breakdowns) || 0,
          preventive: parseInt(row.preventive) || 0
        },
        total_downtime_hours: Math.round((parseInt(row.total_downtime_minutes) || 0) / 60),
        avg_repair_time_minutes: Math.round(parseFloat(row.avg_repair_time) || 0),
        unique_equipment: parseInt(row.unique_equipment) || 0,
        buildings_affected: parseInt(row.buildings_affected) || 0,
        technicians_count: parseInt(row.technicians_count) || 0,
        most_problematic_equipment: row.most_problematic
      },
      by_category: categoryResult.rows.map(r => ({ category: r.category || 'Non défini', count: parseInt(r.count) })),
      by_equipment_type: typeResult.rows.map(r => ({ type: r.equipment_type, count: parseInt(r.count) }))
    });
  } catch (error) {
    console.error('[TROUBLESHOOTING] Analytics summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PDF REPORT GENERATION
// ============================================================

// Generate single troubleshooting report PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const site = req.headers['x-site'] || 'default';

    // Get record and photos
    const [recordRes, photosRes, settingsRes] = await Promise.all([
      pool.query('SELECT * FROM troubleshooting_records WHERE id = $1', [id]),
      pool.query('SELECT * FROM troubleshooting_photos WHERE troubleshooting_id = $1 ORDER BY photo_type, created_at', [id]),
      pool.query('SELECT * FROM site_settings WHERE site = $1', [site])
    ]);

    if (recordRes.rows.length === 0) {
      return res.status(404).json({ error: 'Enregistrement non trouvé' });
    }

    const record = recordRes.rows[0];
    const photos = photosRes.rows;
    const settings = settingsRes.rows[0] || {};

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="depannage_${record.equipment_code || record.id}.pdf"`);
    doc.pipe(res);

    // Header
    let y = 50;

    // Logo
    if (settings.logo) {
      try {
        doc.image(settings.logo, 50, y, { width: 60 });
      } catch (e) { /* ignore */ }
    }

    // Title
    doc.fontSize(20).fillColor('#1e40af').text('RAPPORT DE DÉPANNAGE', 130, y, { width: 280, align: 'center' });
    doc.fontSize(10).fillColor('#6b7280').text(settings.company_name || site, 130, y + 25, { width: 280, align: 'center' });

    // Severity badge
    const severityColors = { critical: '#dc2626', major: '#f59e0b', minor: '#22c55e', cosmetic: '#6b7280' };
    const severityLabels = { critical: 'CRITIQUE', major: 'MAJEUR', minor: 'MINEUR', cosmetic: 'COSMÉTIQUE' };
    const badgeColor = severityColors[record.severity] || '#6b7280';
    doc.rect(470, y, 75, 24).fill(badgeColor);
    doc.fontSize(10).fillColor('#ffffff').text(severityLabels[record.severity] || record.severity?.toUpperCase() || 'N/A', 475, y + 7, { width: 65, align: 'center' });

    // Info box
    y = 100;
    doc.rect(50, y, 495, 100).fill('#f3f4f6');
    doc.fontSize(10).fillColor('#374151');

    // Equipment info
    doc.font('Helvetica-Bold').text('Équipement:', 60, y + 12);
    doc.font('Helvetica').text(`${record.equipment_name || ''} ${record.equipment_code ? `(${record.equipment_code})` : ''}`, 140, y + 12);

    doc.font('Helvetica-Bold').text('Type:', 60, y + 28);
    doc.font('Helvetica').text(getEquipmentTypeLabel(record.equipment_type), 140, y + 28);

    doc.font('Helvetica-Bold').text('Localisation:', 60, y + 44);
    doc.font('Helvetica').text(`${record.building_code || ''} ${record.floor ? `- Étage ${record.floor}` : ''} ${record.zone ? `- Zone ${record.zone}` : ''}`, 140, y + 44);

    doc.font('Helvetica-Bold').text('Technicien:', 60, y + 60);
    doc.font('Helvetica').text(`${record.technician_name} ${record.technician_email ? `(${record.technician_email})` : ''}`, 140, y + 60);

    doc.font('Helvetica-Bold').text('Date:', 60, y + 76);
    doc.font('Helvetica').text(new Date(record.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 140, y + 76);

    // Right column
    doc.font('Helvetica-Bold').text('Durée intervention:', 320, y + 12);
    doc.font('Helvetica').text(`${record.duration_minutes || 0} min`, 430, y + 12);

    doc.font('Helvetica-Bold').text('Temps d\'arrêt:', 320, y + 28);
    doc.font('Helvetica').text(`${record.downtime_minutes || 0} min`, 430, y + 28);

    doc.font('Helvetica-Bold').text('Catégorie:', 320, y + 44);
    doc.font('Helvetica').text(record.category || 'N/A', 430, y + 44);

    doc.font('Helvetica-Bold').text('Type de panne:', 320, y + 60);
    doc.font('Helvetica').text(getFaultTypeLabel(record.fault_type), 430, y + 60);

    // Mini plan section (if equipment has a position on a plan)
    y = 210;
    let miniPlanRendered = false;
    if (record.equipment_id && record.equipment_type) {
      try {
        const planData = await getEquipmentPlanData(record.equipment_type, record.equipment_id);
        if (planData?.thumbnail) {
          const miniPlanImage = await generateMiniPlanImage(planData);
          if (miniPlanImage) {
            // Mini plan section with header
            doc.rect(50, y, 495, 25).fill('#dbeafe');
            doc.fontSize(11).fillColor('#1e40af').font('Helvetica-Bold').text('LOCALISATION SUR PLAN', 60, y + 7);
            y += 30;

            const planWidth = 200;
            const planHeight = 140;

            try {
              doc.image(miniPlanImage, 50, y, { fit: [planWidth, planHeight], align: 'center' });
              doc.rect(50, y, planWidth, planHeight).stroke('#93c5fd');

              // Plan name label
              doc.fontSize(8).fillColor('#6b7280').text(planData.display_name || 'Plan', 50, y + planHeight + 3, { width: planWidth, align: 'center' });

              y += planHeight + 20;
              miniPlanRendered = true;
            } catch (imgErr) {
              console.warn('[TROUBLESHOOTING PDF] Mini plan image error:', imgErr.message);
            }
          }
        }
      } catch (planErr) {
        console.warn('[TROUBLESHOOTING PDF] Mini plan error:', planErr.message);
      }
    }

    // Title section
    if (!miniPlanRendered) y = 220;
    doc.rect(50, y, 495, 30).fill('#1e40af');
    doc.fontSize(14).fillColor('#ffffff').text('DESCRIPTION DU PROBLÈME', 60, y + 9);
    y += 40;

    doc.fontSize(12).fillColor('#1f2937').font('Helvetica-Bold').text(record.title, 50, y, { width: 495 });
    y += doc.heightOfString(record.title, { width: 495 }) + 15;

    doc.fontSize(10).fillColor('#374151').font('Helvetica').text(record.description, 50, y, { width: 495 });
    y += doc.heightOfString(record.description, { width: 495 }) + 20;

    // Root cause if available
    if (record.root_cause) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 25).fill('#fef3c7');
      doc.fontSize(11).fillColor('#92400e').font('Helvetica-Bold').text('CAUSE IDENTIFIÉE', 60, y + 7);
      y += 35;
      doc.fontSize(10).fillColor('#374151').font('Helvetica').text(record.root_cause, 50, y, { width: 495 });
      y += doc.heightOfString(record.root_cause, { width: 495 }) + 20;
    }

    // Solution
    if (record.solution) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 25).fill('#d1fae5');
      doc.fontSize(11).fillColor('#065f46').font('Helvetica-Bold').text('SOLUTION APPLIQUÉE', 60, y + 7);
      y += 35;
      doc.fontSize(10).fillColor('#374151').font('Helvetica').text(record.solution, 50, y, { width: 495 });
      y += doc.heightOfString(record.solution, { width: 495 }) + 20;
    }

    // Parts replaced
    if (record.parts_replaced) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 25).fill('#e0e7ff');
      doc.fontSize(11).fillColor('#3730a3').font('Helvetica-Bold').text('PIÈCES REMPLACÉES', 60, y + 7);
      y += 35;
      doc.fontSize(10).fillColor('#374151').font('Helvetica').text(record.parts_replaced, 50, y, { width: 495 });
      y += doc.heightOfString(record.parts_replaced, { width: 495 }) + 20;
    }

    // AI Analysis
    if (record.ai_diagnosis || record.ai_recommendations) {
      if (y > 550) { doc.addPage(); y = 50; }

      doc.rect(50, y, 495, 30).fill('#8b5cf6');
      doc.fontSize(12).fillColor('#ffffff').text('ANALYSE PHOTO', 60, y + 9);
      y += 40;

      if (record.ai_diagnosis) {
        doc.fontSize(10).fillColor('#5b21b6').font('Helvetica-Bold').text('Diagnostic:', 50, y);
        y += 15;
        doc.font('Helvetica').fillColor('#374151').text(record.ai_diagnosis, 50, y, { width: 495 });
        y += doc.heightOfString(record.ai_diagnosis, { width: 495 }) + 15;
      }

      if (record.ai_recommendations) {
        doc.fontSize(10).fillColor('#5b21b6').font('Helvetica-Bold').text('Recommandations:', 50, y);
        y += 15;
        doc.font('Helvetica').fillColor('#374151').text(record.ai_recommendations, 50, y, { width: 495 });
        y += doc.heightOfString(record.ai_recommendations, { width: 495 }) + 20;
      }
    }

    // Photos section
    if (photos.length > 0) {
      if (y > 500) { doc.addPage(); y = 50; }

      doc.rect(50, y, 495, 28).fill('#eff6ff');
      doc.fontSize(13).fillColor('#1e40af').text(`PHOTOS (${photos.length})`, 60, y + 7);
      y += 38;

      const photoWidth = 235;
      const photoHeight = 160;
      const gap = 15;

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const col = i % 2;
        const x = 50 + col * (photoWidth + gap);

        if (i % 2 === 0 && y + photoHeight + 40 > 750) {
          doc.addPage();
          y = 50;
        }

        try {
          doc.rect(x - 2, y - 2, photoWidth + 4, photoHeight + 4).fillAndStroke('#f8fafc', '#e2e8f0');
          doc.image(photo.photo_data, x, y, {
            width: photoWidth,
            height: photoHeight,
            fit: [photoWidth, photoHeight],
            align: 'center',
            valign: 'center'
          });

          // Photo type badge
          const typeLabels = { before: 'AVANT', during: 'PENDANT', after: 'APRÈS' };
          const typeColors = { before: '#dc2626', during: '#f59e0b', after: '#22c55e' };
          doc.rect(x + 5, y + 5, 55, 18).fill(typeColors[photo.photo_type] || '#6b7280');
          doc.fontSize(8).fillColor('#ffffff').text(typeLabels[photo.photo_type] || photo.photo_type, x + 8, y + 10, { width: 50, align: 'center' });

          if (photo.caption) {
            doc.fontSize(8).fillColor('#4b5563').text(photo.caption, x, y + photoHeight + 5, { width: photoWidth, align: 'center' });
          }
        } catch (e) {
          doc.rect(x, y, photoWidth, photoHeight).fill('#f3f4f6');
          doc.fontSize(10).fillColor('#9ca3af').text('Image non disponible', x, y + photoHeight / 2 - 5, { width: photoWidth, align: 'center' });
        }

        if (col === 1 || i === photos.length - 1) {
          y += photoHeight + (photo.caption ? 25 : 15);
        }
      }
    }

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#9ca3af');
      doc.text(`Rapport généré le ${new Date().toLocaleDateString('fr-FR')} - Page ${i + 1}/${pages.count}`, 50, 780, { width: 495, align: 'center' });
    }

    doc.end();
  } catch (error) {
    console.error('[TROUBLESHOOTING] PDF generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate bulk report PDF
router.get('/report/pdf', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const {
      date_from, date_to,
      equipment_type, building_code, floor, zone,
      category, severity,
      title = 'Rapport des dépannages'
    } = req.query;

    // Build query
    let sql = `
      SELECT tr.*,
             (SELECT COUNT(*) FROM troubleshooting_photos WHERE troubleshooting_id = tr.id) as photo_count
      FROM troubleshooting_records tr
      WHERE tr.site = $1
    `;
    const params = [site];
    let paramIndex = 2;

    if (date_from) {
      sql += ` AND tr.created_at >= $${paramIndex++}`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND tr.created_at <= $${paramIndex++}`;
      params.push(date_to);
    }
    if (equipment_type) {
      sql += ` AND tr.equipment_type = $${paramIndex++}`;
      params.push(equipment_type);
    }
    if (building_code) {
      sql += ` AND tr.building_code = $${paramIndex++}`;
      params.push(building_code);
    }
    if (floor) {
      sql += ` AND tr.floor = $${paramIndex++}`;
      params.push(floor);
    }
    if (zone) {
      sql += ` AND tr.zone = $${paramIndex++}`;
      params.push(zone);
    }
    if (category) {
      sql += ` AND tr.category = $${paramIndex++}`;
      params.push(category);
    }
    if (severity) {
      sql += ` AND tr.severity = $${paramIndex++}`;
      params.push(severity);
    }

    sql += ' ORDER BY tr.created_at DESC';

    const [recordsRes, settingsRes] = await Promise.all([
      pool.query(sql, params),
      pool.query('SELECT * FROM site_settings WHERE site = $1', [site])
    ]);

    const records = recordsRes.rows;
    const settings = settingsRes.rows[0] || {};

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="rapport_depannages_${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // Title page
    let y = 50;

    if (settings.logo) {
      try {
        doc.image(settings.logo, 250, y, { width: 100 });
        y += 120;
      } catch (e) { y += 20; }
    }

    doc.fontSize(24).fillColor('#1e40af').text(title, 50, y, { width: 495, align: 'center' });
    y += 40;

    doc.fontSize(12).fillColor('#6b7280').text(settings.company_name || site, 50, y, { width: 495, align: 'center' });
    y += 30;

    // Date range
    const dateRangeText = date_from || date_to
      ? `Période: ${date_from ? new Date(date_from).toLocaleDateString('fr-FR') : 'Début'} - ${date_to ? new Date(date_to).toLocaleDateString('fr-FR') : 'Aujourd\'hui'}`
      : 'Toutes les interventions';
    doc.fontSize(10).fillColor('#9ca3af').text(dateRangeText, 50, y, { width: 495, align: 'center' });
    y += 50;

    // Summary box
    const summary = calculateSummary(records);
    doc.rect(100, y, 395, 120).fill('#f3f4f6');

    doc.fontSize(14).fillColor('#1f2937').font('Helvetica-Bold').text('RÉSUMÉ', 110, y + 15);
    y += 40;

    const summaryItems = [
      ['Total interventions:', summary.total],
      ['Pannes critiques:', summary.critical],
      ['Pannes majeures:', summary.major],
      ['Temps d\'arrêt total:', `${summary.totalDowntime} min`],
      ['Durée moyenne réparation:', `${summary.avgDuration} min`]
    ];

    summaryItems.forEach(([label, value], i) => {
      doc.fontSize(10).fillColor('#374151').font('Helvetica-Bold').text(label, 120, y + i * 18);
      doc.font('Helvetica').text(String(value), 280, y + i * 18);
    });

    // Start new page for records
    doc.addPage();
    y = 50;

    // Records table
    doc.fontSize(16).fillColor('#1e40af').font('Helvetica-Bold').text(`LISTE DES INTERVENTIONS (${records.length})`, 40, y);
    y += 30;

    // Table header
    doc.rect(40, y, 515, 25).fill('#1e40af');
    doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold');
    doc.text('DATE', 45, y + 8, { width: 60 });
    doc.text('ÉQUIPEMENT', 110, y + 8, { width: 130 });
    doc.text('TITRE', 245, y + 8, { width: 150 });
    doc.text('SEV.', 400, y + 8, { width: 40 });
    doc.text('DURÉE', 445, y + 8, { width: 40 });
    doc.text('ARRÊT', 490, y + 8, { width: 50 });
    y += 25;

    // Table rows
    const severityColors = { critical: '#dc2626', major: '#f59e0b', minor: '#22c55e', cosmetic: '#6b7280' };

    records.forEach((record, idx) => {
      if (y > 720) {
        doc.addPage();
        y = 50;
        // Repeat header
        doc.rect(40, y, 515, 25).fill('#1e40af');
        doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold');
        doc.text('DATE', 45, y + 8, { width: 60 });
        doc.text('ÉQUIPEMENT', 110, y + 8, { width: 130 });
        doc.text('TITRE', 245, y + 8, { width: 150 });
        doc.text('SEV.', 400, y + 8, { width: 40 });
        doc.text('DURÉE', 445, y + 8, { width: 40 });
        doc.text('ARRÊT', 490, y + 8, { width: 50 });
        y += 25;
      }

      const bgColor = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(40, y, 515, 22).fill(bgColor);

      doc.fontSize(7).fillColor('#374151').font('Helvetica');
      doc.text(new Date(record.created_at).toLocaleDateString('fr-FR'), 45, y + 7, { width: 60 });
      doc.text(`${record.equipment_name || ''}\n${record.equipment_code || ''}`.substring(0, 40), 110, y + 4, { width: 130 });
      doc.text((record.title || '').substring(0, 50), 245, y + 7, { width: 150 });

      // Severity dot
      doc.circle(410, y + 11, 5).fill(severityColors[record.severity] || '#6b7280');

      doc.text(`${record.duration_minutes || 0}m`, 445, y + 7, { width: 40 });
      doc.text(`${record.downtime_minutes || 0}m`, 490, y + 7, { width: 50 });

      y += 22;
    });

    // Statistics page
    doc.addPage();
    y = 50;

    doc.fontSize(16).fillColor('#1e40af').font('Helvetica-Bold').text('STATISTIQUES', 40, y);
    y += 40;

    // By severity chart (visual representation)
    doc.fontSize(12).fillColor('#374151').font('Helvetica-Bold').text('Par sévérité', 40, y);
    y += 25;

    const severityData = [
      { label: 'Critique', count: summary.critical, color: '#dc2626' },
      { label: 'Majeur', count: summary.major, color: '#f59e0b' },
      { label: 'Mineur', count: summary.minor, color: '#22c55e' },
      { label: 'Cosmétique', count: summary.cosmetic, color: '#6b7280' }
    ];

    severityData.forEach((item, i) => {
      const barWidth = summary.total > 0 ? (item.count / summary.total) * 300 : 0;
      doc.rect(40, y + i * 25, barWidth, 18).fill(item.color);
      doc.fontSize(9).fillColor('#374151').text(`${item.label}: ${item.count}`, 350, y + i * 25 + 4);
    });
    y += 120;

    // By equipment type
    doc.fontSize(12).fillColor('#374151').font('Helvetica-Bold').text('Par type d\'équipement', 40, y);
    y += 25;

    const byType = {};
    records.forEach(r => {
      byType[r.equipment_type] = (byType[r.equipment_type] || 0) + 1;
    });

    Object.entries(byType).forEach(([type, count], i) => {
      const barWidth = summary.total > 0 ? (count / summary.total) * 300 : 0;
      doc.rect(40, y + i * 25, barWidth, 18).fill('#3b82f6');
      doc.fontSize(9).fillColor('#374151').text(`${getEquipmentTypeLabel(type)}: ${count}`, 350, y + i * 25 + 4);
    });

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#9ca3af');
      doc.text(`Rapport généré le ${new Date().toLocaleDateString('fr-FR')} - Page ${i + 1}/${pages.count}`, 40, 780, { width: 515, align: 'center' });
    }

    doc.end();
  } catch (error) {
    console.error('[TROUBLESHOOTING] Bulk PDF generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AI CHAT FOR TROUBLESHOOTING
// ============================================================

// AI chat endpoint for troubleshooting queries
router.post('/ai/chat', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { message, context = {} } = req.body;

    // Get relevant troubleshooting data for context
    const [summaryRes, recentRes, problematicRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as last_30_days,
          SUM(downtime_minutes) as total_downtime
        FROM troubleshooting_records WHERE site = $1
      `, [site]),
      pool.query(`
        SELECT equipment_name, equipment_type, title, severity, created_at
        FROM troubleshooting_records
        WHERE site = $1
        ORDER BY created_at DESC
        LIMIT 10
      `, [site]),
      pool.query(`
        SELECT equipment_name, COUNT(*) as count
        FROM troubleshooting_records
        WHERE site = $1 AND created_at > NOW() - INTERVAL '90 days'
        GROUP BY equipment_name
        HAVING COUNT(*) >= 2
        ORDER BY count DESC
        LIMIT 5
      `, [site])
    ]);

    const summary = summaryRes.rows[0];
    const recent = recentRes.rows;
    const problematic = problematicRes.rows;

    // Build context for AI
    const troubleshootingContext = `
Contexte des dépannages:
- Total interventions: ${summary.total}
- Interventions critiques: ${summary.critical}
- 30 derniers jours: ${summary.last_30_days}
- Temps d'arrêt total: ${Math.round((summary.total_downtime || 0) / 60)} heures

Équipements problématiques récents:
${problematic.map(p => `- ${p.equipment_name}: ${p.count} interventions`).join('\n')}

Dernières interventions:
${recent.map(r => `- ${new Date(r.created_at).toLocaleDateString('fr-FR')}: ${r.equipment_name} - ${r.title} (${r.severity})`).join('\n')}
    `;

    res.json({
      success: true,
      context: troubleshootingContext,
      summary: {
        total: parseInt(summary.total),
        critical: parseInt(summary.critical),
        last_30_days: parseInt(summary.last_30_days),
        total_downtime_hours: Math.round((summary.total_downtime || 0) / 60)
      },
      problematic_equipment: problematic,
      recent_interventions: recent
    });
  } catch (error) {
    console.error('[TROUBLESHOOTING] AI chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// INTELLIGENT EQUIPMENT SEARCH FOR TROUBLESHOOTING
// ============================================================

// Dictionnaire de synonymes et termes associés
const EQUIPMENT_SYNONYMS = {
  // Éclairage / Luminaires
  'luminaire': ['eclairage', 'éclairage', 'lampe', 'led', 'tube', 'neon', 'néon', 'projecteur', 'spot', 'plafonnier', 'applique'],
  'eclairage': ['luminaire', 'éclairage', 'lampe', 'led', 'tube', 'neon', 'néon', 'lumiere', 'lumière'],
  'lumiere': ['luminaire', 'eclairage', 'éclairage', 'lampe', 'led'],

  // CVC / Climatisation
  'climatisation': ['clim', 'cvc', 'chauffage', 'ventilation', 'hvac', 'pac', 'pompe a chaleur', 'chaud', 'froid', 'temperature', 'température'],
  'clim': ['climatisation', 'cvc', 'hvac', 'froid', 'chaud'],
  'cvc': ['climatisation', 'clim', 'chauffage', 'ventilation', 'hvac'],
  'chauffage': ['cvc', 'climatisation', 'chaud', 'radiateur', 'chaudiere', 'chaudière', 'temperature', 'température'],
  'froid': ['climatisation', 'clim', 'cvc', 'refroidissement', 'frigo', 'groupe froid', 'temperature', 'température'],
  'chaud': ['chauffage', 'cvc', 'climatisation', 'temperature', 'température'],
  'gel': ['froid', 'temperature', 'température', 'chauffage', 'cvc', 'protection gel'],

  // Plomberie / Eau
  'fuite': ['eau', 'plomberie', 'inondation', 'humidite', 'humidité', 'vanne', 'tuyau', 'canalisation'],
  'eau': ['fuite', 'plomberie', 'inondation', 'pompe', 'vanne', 'canalisation', 'robinet'],
  'inondation': ['fuite', 'eau', 'plomberie', 'pompe', 'degat des eaux', 'dégât des eaux'],
  'plomberie': ['eau', 'fuite', 'vanne', 'pompe', 'tuyau', 'canalisation', 'robinet'],

  // Électricité
  'tableau': ['armoire', 'coffret', 'switchboard', 'tgbt', 'td', 'disjoncteur'],
  'armoire': ['tableau', 'coffret', 'switchboard', 'armoire electrique', 'armoire électrique'],
  'variateur': ['vsd', 'vfd', 'drive', 'convertisseur', 'frequence', 'fréquence'],
  'vsd': ['variateur', 'vfd', 'drive', 'convertisseur frequence'],
  'disjoncteur': ['tableau', 'protection', 'coupure', 'differentiel', 'différentiel'],
  'prise': ['electricite', 'électricité', 'courant', 'alimentation'],

  // Moteurs / Mécanique
  'moteur': ['meca', 'mecanique', 'mécanique', 'pompe', 'ventilateur', 'compresseur'],
  'pompe': ['moteur', 'meca', 'eau', 'refoulement', 'relevage', 'surpresseur'],
  'ventilateur': ['moteur', 'meca', 'extraction', 'soufflage', 'cvc', 'ventilation'],
  'compresseur': ['moteur', 'meca', 'air comprime', 'air comprimé'],

  // Portes / Accès
  'porte': ['acces', 'accès', 'portail', 'barriere', 'barrière', 'issue', 'entree', 'entrée', 'sortie'],
  'portail': ['porte', 'barriere', 'barrière', 'acces', 'accès', 'parking'],
  'barriere': ['portail', 'porte', 'parking', 'acces', 'accès'],
  'issue': ['porte', 'secours', 'evacuation', 'évacuation', 'sortie'],

  // Sécurité
  'incendie': ['securite', 'sécurité', 'detecteur', 'détecteur', 'alarme', 'extincteur', 'desenfumage', 'désenfumage', 'sprinkler'],
  'alarme': ['securite', 'sécurité', 'incendie', 'intrusion', 'detecteur', 'détecteur'],
  'detecteur': ['alarme', 'incendie', 'fumee', 'fumée', 'presence', 'présence'],

  // Général
  'panne': ['probleme', 'problème', 'dysfonctionnement', 'arret', 'arrêt', 'defaut', 'défaut', 'erreur'],
  'probleme': ['panne', 'dysfonctionnement', 'defaut', 'défaut', 'incident'],
  'urgence': ['panne', 'critique', 'prioritaire', 'arret', 'arrêt']
};

// Mapping des étages/niveaux vers valeurs normalisées
const FLOOR_SYNONYMS = {
  // Sous-sol / Cave
  'sous sol': ['9', '-1', 's', 'ss', 'souterrain', 'cave', 'sous-sol'],
  'souterrain': ['9', '-1', 's', 'ss', 'sous sol', 'cave'],
  'ss': ['9', '-1', 's', 'sous sol', 'souterrain', 'cave'],
  'cave': ['9', '-1', 's', 'ss', 'sous sol', 'souterrain'],

  // Rez-de-chaussée
  'rdc': ['0', 'rez', 'rez de chaussee', 'rez-de-chaussee', 'ground'],
  'rez de chaussee': ['0', 'rdc', 'rez'],
  'rez': ['0', 'rdc', 'rez de chaussee'],

  // Étages numérotés
  '1er': ['1', 'premier', '1er etage', 'etage 1'],
  'premier': ['1', '1er', '1er etage', 'etage 1'],
  '2eme': ['2', 'deuxieme', '2eme etage', 'etage 2'],
  'deuxieme': ['2', '2eme', '2eme etage', 'etage 2'],
  '3eme': ['3', 'troisieme', '3eme etage', 'etage 3'],
  'troisieme': ['3', '3eme', '3eme etage', 'etage 3'],
  '4eme': ['4', 'quatrieme', '4eme etage', 'etage 4'],
  '5eme': ['5', 'cinquieme', '5eme etage', 'etage 5'],

  // Termes génériques
  'etage': ['niveau', 'floor'],
  'niveau': ['etage', 'floor']
};

// Mapping problèmes → types d'équipements suggérés
const PROBLEM_TO_EQUIPMENT_TYPE = {
  // Problèmes température
  'froid': ['cvc', 'climatisation', 'chauffage', 'glo'],
  'chaud': ['cvc', 'climatisation', 'chauffage', 'glo'],
  'gel': ['cvc', 'chauffage', 'plomberie', 'glo'],
  'temperature': ['cvc', 'climatisation', 'glo'],

  // Problèmes eau
  'fuite': ['plomberie', 'cvc', 'meca'],
  'inondation': ['plomberie', 'meca'],
  'eau': ['plomberie', 'meca', 'cvc'],

  // Problèmes électriques
  'coupure': ['switchboard', 'hv', 'vsd'],
  'court-circuit': ['switchboard', 'hv'],
  'surcharge': ['switchboard', 'vsd'],

  // Problèmes éclairage
  'luminaire': ['glo', 'eclairage'],
  'eclairage': ['glo'],
  'noir': ['glo', 'switchboard'],

  // Problèmes accès
  'porte': ['meca', 'mobile'],
  'acces': ['meca', 'mobile'],
  'bloquer': ['meca', 'mobile']
};

// Fonction de calcul de distance de Levenshtein pour tolérance aux fautes
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Normalise une chaîne pour la comparaison
function normalizeString(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ')
    .trim();
}

// Trouve les termes de recherche étendus basés sur les synonymes
function expandSearchTerms(query) {
  const normalized = normalizeString(query);
  const words = normalized.split(' ');
  const expandedTerms = new Set(words);
  const floorTerms = new Set(); // Separate set for floor values

  // Check for multi-word floor terms like "sous sol"
  const multiWordFloorTerms = Object.keys(FLOOR_SYNONYMS).filter(k => k.includes(' '));
  for (const floorTerm of multiWordFloorTerms) {
    if (normalized.includes(floorTerm)) {
      FLOOR_SYNONYMS[floorTerm].forEach(syn => floorTerms.add(normalizeString(syn)));
    }
  }

  for (const word of words) {
    // Pattern de bâtiment: b11, b20, bat11, bat20, etc. → "batiment 11", "11"
    const buildingMatch = word.match(/^(b|bat|batiment|building)(\d+)$/i);
    if (buildingMatch) {
      const buildingNum = buildingMatch[2];
      expandedTerms.add(buildingNum);
      expandedTerms.add(`batiment ${buildingNum}`);
      expandedTerms.add(`batiment${buildingNum}`);
      expandedTerms.add(`bat ${buildingNum}`);
      expandedTerms.add(`b${buildingNum}`);
      expandedTerms.add(`building ${buildingNum}`);
    }

    // Recherche exacte dans le dictionnaire équipements
    if (EQUIPMENT_SYNONYMS[word]) {
      EQUIPMENT_SYNONYMS[word].forEach(syn => expandedTerms.add(normalizeString(syn)));
    }

    // Recherche exacte dans le dictionnaire étages
    if (FLOOR_SYNONYMS[word]) {
      FLOOR_SYNONYMS[word].forEach(syn => floorTerms.add(normalizeString(syn)));
    }

    // Recherche fuzzy dans les clés du dictionnaire équipements
    for (const key of Object.keys(EQUIPMENT_SYNONYMS)) {
      const distance = levenshteinDistance(word, key);
      if (distance <= 2 && word.length > 3) { // Tolérance de 2 caractères pour mots > 3 chars
        expandedTerms.add(key);
        EQUIPMENT_SYNONYMS[key].forEach(syn => expandedTerms.add(normalizeString(syn)));
      }
    }
  }

  // Add floor terms to expanded terms
  floorTerms.forEach(term => expandedTerms.add(term));

  return Array.from(expandedTerms);
}

// Détermine les types d'équipements suggérés basés sur le problème
function suggestEquipmentTypes(query) {
  const normalized = normalizeString(query);
  const suggestedTypes = new Set();

  for (const [problem, types] of Object.entries(PROBLEM_TO_EQUIPMENT_TYPE)) {
    if (normalized.includes(normalizeString(problem))) {
      types.forEach(t => suggestedTypes.add(t));
    }
  }

  return Array.from(suggestedTypes);
}

// Endpoint de recherche intelligente d'équipements
router.get('/equipment/smart-search', async (req, res) => {
  try {
    const site = req.headers['x-site'] || 'default';
    const { q, limit = 20 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ results: [], expandedTerms: [], suggestedTypes: [] });
    }

    // Expansion des termes de recherche
    const expandedTerms = expandSearchTerms(q);
    const suggestedTypes = suggestEquipmentTypes(q);

    console.log(`[SMART-SEARCH] Query: "${q}" -> Expanded: [${expandedTerms.slice(0, 5).join(', ')}...]`);

    const results = [];

    // Tables à rechercher avec leurs configurations
    // hasZone: true si la table a une colonne 'zone'
    const searchConfigs = [
      { type: 'switchboard', table: 'switchboards', nameCol: 'name', codeCol: 'code', hasSite: true, hasBuilding: false, hasBuildingCode: true, hasZone: true },
      { type: 'vsd', table: 'vsd_equipments', nameCol: 'name', codeCol: 'tag', hasSite: true, hasBuilding: true, hasBuildingCode: false, hasZone: true },
      { type: 'meca', table: 'meca_equipments', nameCol: 'name', codeCol: 'tag', hasSite: false, hasBuilding: true, hasBuildingCode: false, hasZone: true, extraCols: ['equipment_type', 'category', 'function'] },
      { type: 'mobile', table: 'me_equipments', nameCol: 'name', codeCol: 'code', hasSite: false, hasBuilding: true, hasBuildingCode: false, hasZone: true },
      { type: 'hv', table: 'hv_equipments', nameCol: 'name', codeCol: 'code', hasSite: true, hasBuilding: false, hasBuildingCode: true, hasZone: true },
      { type: 'glo', table: 'glo_equipments', nameCol: 'name', codeCol: 'tag', hasSite: false, hasBuilding: true, hasBuildingCode: false, hasZone: true, extraCols: ['equipment_type', 'function'] },
      { type: 'datahub', table: 'dh_items', nameCol: 'name', codeCol: 'code', hasSite: false, hasBuilding: true, hasBuildingCode: false, hasZone: false },
      { type: 'atex', table: 'atex_equipments', nameCol: 'name', codeCol: null, hasSite: false, hasBuilding: true, hasBuildingCode: false, hasZone: true },
      { type: 'infrastructure', table: 'inf_items', nameCol: 'name', codeCol: 'code', hasSite: false, hasBuilding: true, hasBuildingCode: false, hasZone: false, extraCols: ['location', 'description'] }
    ];

    for (const config of searchConfigs) {
      try {
        // Construire les colonnes SELECT
        const selectCols = ['id', `${config.nameCol} as name`];
        if (config.codeCol) selectCols.push(`${config.codeCol} as code`);
        if (config.hasBuilding) selectCols.push('building');
        if (config.hasBuildingCode) selectCols.push('building_code');
        if (config.extraCols) {
          config.extraCols.forEach(col => selectCols.push(col));
        }
        selectCols.push('floor');
        if (config.hasZone) selectCols.push('zone');

        // Construire les conditions WHERE pour tous les termes étendus
        const searchConditions = expandedTerms.map((term, idx) => {
          const paramNum = config.hasSite ? idx + 2 : idx + 1;
          const conditions = [
            `LOWER(COALESCE(${config.nameCol}, '')) LIKE $${paramNum}`
          ];
          if (config.codeCol) {
            conditions.push(`LOWER(COALESCE(${config.codeCol}, '')) LIKE $${paramNum}`);
          }
          if (config.hasBuilding) {
            conditions.push(`LOWER(COALESCE(building, '')) LIKE $${paramNum}`);
          }
          if (config.hasBuildingCode) {
            conditions.push(`LOWER(COALESCE(building_code, '')) LIKE $${paramNum}`);
          }
          // Always search floor column
          conditions.push(`LOWER(COALESCE(floor, '')) LIKE $${paramNum}`);
          if (config.extraCols) {
            config.extraCols.forEach(col => {
              conditions.push(`LOWER(COALESCE(${col}, '')) LIKE $${paramNum}`);
            });
          }
          return `(${conditions.join(' OR ')})`;
        });

        const whereClause = searchConditions.join(' OR ');
        const params = config.hasSite ? [site] : [];
        expandedTerms.forEach(term => params.push(`%${term}%`));

        const query = `
          SELECT ${selectCols.join(', ')}, '${config.type}' as equipment_type
          FROM ${config.table}
          ${config.hasSite ? 'WHERE site = $1 AND' : 'WHERE'} (${whereClause})
          LIMIT 10
        `;

        const result = await pool.query(query, params);

        for (const row of result.rows) {
          // Calculer un score de pertinence
          const nameNorm = normalizeString(row.name || '');
          const buildingNorm = normalizeString(row.building || row.building_code || '');
          const floorNorm = normalizeString(row.floor || '');
          const codeNorm = normalizeString(row.code || '');
          const queryNorm = normalizeString(q);
          const originalWords = queryNorm.split(' ').filter(w => w.length > 1);
          let score = 0;

          // Match exact = score élevé
          if (nameNorm.includes(queryNorm)) score += 100;
          // Match sur le code
          if (codeNorm && codeNorm.includes(queryNorm)) score += 80;

          // IMPORTANT: Compter combien de mots originaux matchent
          let originalWordMatches = 0;
          let nameMatches = 0; // Track name-specific matches
          let locationMatches = 0; // Track building/floor matches

          for (const word of originalWords) {
            const wordMatchesName = nameNorm.includes(word);
            const wordMatchesBuilding = buildingNorm.includes(word);
            const wordMatchesFloor = floorNorm.includes(word);
            const wordMatchesCode = codeNorm.includes(word);

            if (wordMatchesName || wordMatchesBuilding || wordMatchesFloor || wordMatchesCode) {
              originalWordMatches++;
              // Bonus spécifique par type de match
              if (wordMatchesName) {
                score += 25;
                nameMatches++;
              }
              if (wordMatchesBuilding) {
                score += 30; // Building match important
                locationMatches++;
              }
              if (wordMatchesFloor) {
                score += 30; // Floor match important
                locationMatches++;
              }
              if (wordMatchesCode) score += 20;
            }
          }

          // Vérifier si le "mot principal" (premier mot non-numérique, non-étage) matche le nom
          const mainWords = originalWords.filter(w => {
            const isNumber = /^\d+$/.test(w);
            const isFloorTerm = ['rdc', 'rez', 'ss', 'sous', 'sol', '1er', '2eme', '3eme', '4eme', '5eme'].includes(w);
            return !isNumber && !isFloorTerm;
          });
          const primaryWord = mainWords[0];
          const primaryWordMatchesName = primaryWord && (
            nameNorm.includes(primaryWord) ||
            expandedTerms.some(term => {
              // Check if this expanded term comes from the primary word and matches name
              const termFromPrimary = EQUIPMENT_SYNONYMS[primaryWord]?.includes(term) ||
                                       normalizeString(primaryWord) === term;
              return termFromPrimary && nameNorm.includes(term);
            })
          );

          // GROS bonus pour les matchs multiples (AND logic reward)
          if (originalWordMatches >= 2) score += originalWordMatches * 40;
          if (originalWordMatches >= 3) score += 100; // Triple match bonus

          // GROS bonus si le mot principal matche le nom
          if (primaryWordMatchesName) score += 80;

          // Match sur les termes étendus (synonymes)
          expandedTerms.forEach(term => {
            if (nameNorm.includes(term)) score += 10;
            if (buildingNorm.includes(term)) score += 15;
            if (floorNorm.includes(term)) score += 15;
          });

          // Bonus si le type est suggéré
          if (suggestedTypes.includes(config.type)) score += 30;

          results.push({
            id: row.id,
            name: row.name,
            code: row.code || row.tag,
            equipment_type: config.type,
            type_label: getEquipmentTypeLabel(config.type),
            building: row.building || row.building_code,
            floor: row.floor,
            zone: config.hasZone ? row.zone : null,
            extra: config.extraCols ? config.extraCols.reduce((acc, col) => {
              if (row[col]) acc[col] = row[col];
              return acc;
            }, {}) : null,
            score,
            matchCount: originalWordMatches,
            nameMatches,
            primaryWordMatch: primaryWordMatchesName
          });
        }
      } catch (err) {
        console.error(`[SMART-SEARCH] ❌ Error searching ${config.type} (${config.table}):`, err.message);
        console.error(`[SMART-SEARCH] Query failed for table: ${config.table}`);
      }
    }

    // Filtrer les résultats peu pertinents
    // STRICT: Le mot principal (type d'équipement) doit matcher le nom
    const queryWords = normalizeString(q).split(' ').filter(w => w.length > 1);
    const queryWordCount = queryWords.length;

    // Identifier le mot principal (premier mot non-numérique, non-étage)
    const mainQueryWords = queryWords.filter(w => {
      const isNumber = /^\d+$/.test(w);
      const isFloorTerm = ['rdc', 'rez', 'ss', 'sous', 'sol', '1er', '2eme', '3eme', '4eme', '5eme'].includes(w);
      return !isNumber && !isFloorTerm;
    });
    const hasPrimaryWord = mainQueryWords.length > 0;

    let filteredResults = results;

    if (hasPrimaryWord && queryWordCount >= 2) {
      // STRICT: Le mot principal DOIT matcher le nom
      // Exemple: "porte 22 rez" → "porte" doit être dans le nom
      const primaryMatches = results.filter(r => r.primaryWordMatch);

      if (primaryMatches.length > 0) {
        // On a des matchs sur le mot principal - les garder
        filteredResults = primaryMatches;

        // En plus, pour 3+ mots, exiger 2+ matchs au total
        if (queryWordCount >= 3) {
          const strictMatches = primaryMatches.filter(r => r.matchCount >= 2);
          if (strictMatches.length > 0) {
            filteredResults = strictMatches;
          }
        }
      } else {
        // Pas de match sur le mot principal - fallback aux matchs multiples
        const multiMatches = results.filter(r => r.matchCount >= 2);
        if (multiMatches.length > 0) {
          filteredResults = multiMatches;
        }
      }
    } else if (queryWordCount >= 2) {
      // Requête sans mot principal clair (ex: "22 rdc") - garder matchs multiples
      const multiMatches = results.filter(r => r.matchCount >= 2);
      if (multiMatches.length > 0) {
        filteredResults = multiMatches;
      }
    }

    // Trier par score décroissant
    filteredResults.sort((a, b) => b.score - a.score);

    // Log par type pour debug
    const byType = {};
    filteredResults.forEach(r => { byType[r.equipment_type] = (byType[r.equipment_type] || 0) + 1; });
    console.log(`[SMART-SEARCH] Found ${filteredResults.length} results (filtered from ${results.length}) for "${q}":`, JSON.stringify(byType));

    res.json({
      success: true,
      query: q,
      expandedTerms: expandedTerms.slice(0, 10),
      suggestedTypes,
      results: filteredResults.slice(0, parseInt(limit))
    });
  } catch (error) {
    console.error('[SMART-SEARCH] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getEquipmentTypeLabel(type) {
  const labels = {
    switchboard: 'Tableau électrique',
    vsd: 'Variateur (VSD)',
    meca: 'Équipement mécanique',
    hv: 'Haute tension',
    glo: 'Équipement GLO',
    mobile: 'Équipement mobile',
    datahub: 'Datahub',
    atex: 'Équipement ATEX',
    infrastructure: 'Infrastructure'
  };
  return labels[type] || type;
}

function getFaultTypeLabel(type) {
  const labels = {
    breakdown: 'Panne',
    malfunction: 'Dysfonctionnement',
    preventive: 'Préventif',
    corrective: 'Correctif'
  };
  return labels[type] || type || 'N/A';
}

function calculateSummary(records) {
  return {
    total: records.length,
    critical: records.filter(r => r.severity === 'critical').length,
    major: records.filter(r => r.severity === 'major').length,
    minor: records.filter(r => r.severity === 'minor').length,
    cosmetic: records.filter(r => r.severity === 'cosmetic').length,
    totalDowntime: records.reduce((sum, r) => sum + (parseInt(r.downtime_minutes) || 0), 0),
    avgDuration: records.length > 0
      ? Math.round(records.reduce((sum, r) => sum + (parseInt(r.duration_minutes) || 0), 0) / records.length)
      : 0
  };
}

export default router;
