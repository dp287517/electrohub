// server_switchboard.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import ExcelJS from 'exceljs';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI setup
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[SWITCHBOARD] OpenAI initialized');
  } catch (e) {
    console.warn('[SWITCHBOARD] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[SWITCHBOARD] No OPENAI_API_KEY found');
  openaiError = 'No API key';
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Upload setup for photos and Excel files
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site,X-User-Email,X-User-Name');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health
app.get('/api/switchboard/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || '').toString();
}

const WHITELIST_SORT = ['created_at', 'name', 'code', 'building_code', 'floor'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'created_at'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema avec nouvelles colonnes
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS switchboards (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      building_code TEXT,
      floor TEXT,
      room TEXT,
      regime_neutral TEXT,
      is_principal BOOLEAN DEFAULT FALSE,
      photo BYTEA,
      modes JSONB DEFAULT '{}'::jsonb,
      quality JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_switchboards_site ON switchboards(site);
    CREATE INDEX IF NOT EXISTS idx_switchboards_building ON switchboards(building_code);
    CREATE INDEX IF NOT EXISTS idx_switchboards_code ON switchboards(code);

    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      downstream_switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE SET NULL,
      name TEXT,
      device_type TEXT NOT NULL,
      manufacturer TEXT,
      reference TEXT,
      in_amps NUMERIC,
      icu_ka NUMERIC,
      ics_ka NUMERIC,
      poles INTEGER,
      voltage_v NUMERIC,
      trip_unit TEXT,
      position_number TEXT,
      is_differential BOOLEAN DEFAULT FALSE,
      is_complete BOOLEAN DEFAULT FALSE,
      settings JSONB DEFAULT '{}'::jsonb,
      is_main_incoming BOOLEAN DEFAULT FALSE,
      pv_tests BYTEA,
      photos BYTEA[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard ON devices(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_devices_parent ON devices(parent_id);
    CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site);
    CREATE INDEX IF NOT EXISTS idx_devices_reference ON devices(reference);
    CREATE INDEX IF NOT EXISTS idx_devices_downstream ON devices(downstream_switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_devices_manufacturer ON devices(manufacturer);
    CREATE INDEX IF NOT EXISTS idx_devices_name ON devices(name);
    CREATE INDEX IF NOT EXISTS idx_devices_position ON devices(position_number);
    CREATE INDEX IF NOT EXISTS idx_devices_complete ON devices(is_complete);

    -- Add columns if missing
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'name') THEN
        ALTER TABLE devices ADD COLUMN name TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'position_number') THEN
        ALTER TABLE devices ADD COLUMN position_number TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'is_differential') THEN
        ALTER TABLE devices ADD COLUMN is_differential BOOLEAN DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'is_complete') THEN
        ALTER TABLE devices ADD COLUMN is_complete BOOLEAN DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'switchboards' AND column_name = 'photo') THEN
        ALTER TABLE switchboards ADD COLUMN photo BYTEA;
      END IF;
    END $$;

    -- Add trigger for updated_at
    CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_devices_updated_at') THEN
        CREATE TRIGGER update_devices_updated_at
        BEFORE UPDATE ON devices
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;
  `);
}
ensureSchema().catch(e => console.error('[SWITCHBOARD SCHEMA]', e.message));

// Helper: Check if device is complete
function checkDeviceComplete(device) {
  return !!(device.manufacturer && device.reference && device.in_amps && Number(device.in_amps) > 0);
}

// Helper: Detect if device is differential from text
function detectDifferential(text) {
  if (!text) return false;
  const lowerText = String(text).toLowerCase();
  const patterns = [
    'ddr', 'rcd', 'rcbo', 'différentiel', 'differentiel', 'diff',
    '30ma', '300ma', '30 ma', '300 ma', 'δ', 'vigi'
  ];
  return patterns.some(p => lowerText.includes(p));
}

// Helper: Detect differential from position format (X.X like 9.1)
function detectDifferentialFromPosition(position) {
  if (!position) return false;
  return /^\d+\.\d+$/.test(String(position).trim());
}

// ==================== SWITCHBOARDS CRUD ====================

// LIST Switchboards
app.get('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, building, floor, room, sort = 'created_at', dir = 'desc', page = '1', pageSize = '100' } = req.query;
    const where = ['site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(name ILIKE $${i} OR code ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (building) { where.push(`building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    if (room) { where.push(`room ILIKE $${i}`); vals.push(`%${room}%`); i++; }
    const limit = Math.min(parseInt(pageSize, 10) || 100, 500);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    const sql = `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, 
                        modes, quality, created_at, (photo IS NOT NULL) as has_photo
                 FROM switchboards
                 WHERE ${where.join(' AND ')}
                 ORDER BY ${sortSafe(sort)} ${dirSafe(dir)}
                 LIMIT ${limit} OFFSET ${offset}`;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM switchboards WHERE ${where.join(' AND ')}`, vals);
    const data = rows.rows.map(r => ({
      id: r.id,
      meta: { site: r.site, building_code: r.building_code, floor: r.floor, room: r.room },
      name: r.name, code: r.code, regime_neutral: r.regime_neutral,
      is_principal: r.is_principal,
      has_photo: r.has_photo,
      modes: r.modes || {}, quality: r.quality || {}, created_at: r.created_at
    }));
    res.json({ data, total: count.rows[0].total, page: Number(page), pageSize: limit });
  } catch (e) {
    console.error('[SWITCHBOARD LIST] error:', e);
    res.status(500).json({ error: 'List failed' });
  }
});

// GET ONE Switchboard
app.get('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const r = await pool.query(
      `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, 
              modes, quality, created_at, (photo IS NOT NULL) as has_photo
       FROM switchboards WHERE id=$1 AND site=$2`, [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];
    res.json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal,
      has_photo: sb.has_photo,
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD GET] error:', e);
    res.status(500).json({ error: 'Get failed' });
  }
});

// CREATE Switchboard
app.post('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();
    if (!name || !code) return res.status(400).json({ error: 'Missing name/code' });
    const building = b?.meta?.building_code || null;
    const floor = b?.meta?.floor || null;
    const room = b?.meta?.room || null;
    const regime = b?.regime_neutral || null;
    const is_principal = !!b?.is_principal;
    const modes = b?.modes || {};
    const quality = b?.quality || {};

    const r = await pool.query(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, created_at`,
      [site, name, code, building, floor, room, regime, is_principal, modes, quality]
    );
    const sb = r.rows[0];
    res.status(201).json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: false,
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD CREATE] error:', e);
    res.status(500).json({ error: 'Create failed' });
  }
});

// UPDATE Switchboard
app.put('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();
    if (!name || !code) return res.status(400).json({ error: 'Missing name/code' });
    const building = b?.meta?.building_code || null;
    const floor = b?.meta?.floor || null;
    const room = b?.meta?.room || null;
    const regime = b?.regime_neutral || null;
    const is_principal = !!b?.is_principal;
    const modes = b?.modes || {};
    const quality = b?.quality || {};

    const r = await pool.query(
      `UPDATE switchboards SET
        name=$1, code=$2, building_code=$3, floor=$4, room=$5, regime_neutral=$6, is_principal=$7, modes=$8, quality=$9
       WHERE id=$10 AND site=$11
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, created_at, (photo IS NOT NULL) as has_photo`,
      [name, code, building, floor, room, regime, is_principal, modes, quality, id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];
    res.json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: sb.has_photo,
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD UPDATE] error:', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE Switchboard (cascade deletes devices)
app.delete('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    
    // Count devices before delete
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM devices WHERE switchboard_id = $1`, [id]
    );
    const deviceCount = countResult.rows[0]?.count || 0;
    
    const r = await pool.query(`DELETE FROM switchboards WHERE id=$1 AND site=$2 RETURNING id, name`, [id, site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    
    res.json({ success: true, deleted: id, name: r.rows[0].name, devices_deleted: deviceCount });
  } catch (e) {
    console.error('[SWITCHBOARD DELETE] error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// DUPLICATE Switchboard
app.post('/api/switchboard/boards/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const r = await pool.query(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality)
       SELECT site, name || ' (copy)', code || '_COPY', building_code, floor, room, regime_neutral, FALSE, modes, quality
       FROM switchboards WHERE id=$1 AND site=$2
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, created_at`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];
    res.status(201).json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal, has_photo: false,
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD DUPLICATE] error:', e);
    res.status(500).json({ error: 'Duplicate failed' });
  }
});

// ==================== SWITCHBOARD PHOTO ====================

// Upload Switchboard Photo
app.post('/api/switchboard/boards/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });

    const r = await pool.query(
      `UPDATE switchboards SET photo = $1 WHERE id = $2 AND site = $3 RETURNING id`,
      [req.file.buffer, id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    
    res.json({ success: true, id });
  } catch (e) {
    console.error('[SWITCHBOARD PHOTO UPLOAD] error:', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Get Switchboard Photo
app.get('/api/switchboard/boards/:id/photo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const r = await pool.query(
      `SELECT photo FROM switchboards WHERE id = $1 AND site = $2`, [id, site]
    );
    if (!r.rows.length || !r.rows[0].photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].photo);
  } catch (e) {
    console.error('[SWITCHBOARD PHOTO GET] error:', e);
    res.status(500).json({ error: 'Get photo failed' });
  }
});

// ==================== DEVICE COUNTS ====================

// Device counts for progress tracking
app.post('/api/switchboard/devices-count', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const boardIds = req.body?.board_ids || [];
    
    if (!boardIds.length) {
      // Return counts for all boards of the site
      const { rows } = await pool.query(
        `SELECT d.switchboard_id, 
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE d.is_complete = true)::int AS complete
         FROM devices d 
         JOIN switchboards sb ON d.switchboard_id = sb.id
         WHERE sb.site = $1 
         GROUP BY d.switchboard_id`, [site]
      );
      const counts = {};
      rows.forEach(r => {
        counts[r.switchboard_id] = { total: r.total, complete: r.complete };
      });
      return res.json({ counts });
    }

    const ids = boardIds.map(Number).filter(Boolean);
    if (!ids.length) return res.json({ counts: {} });

    const { rows } = await pool.query(
      `SELECT switchboard_id, 
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_complete = true)::int AS complete
       FROM devices
       WHERE switchboard_id = ANY($1::int[])
       GROUP BY switchboard_id`, [ids]
    );
    
    const counts = {};
    rows.forEach(r => {
      counts[r.switchboard_id] = { total: r.total, complete: r.complete };
    });
    
    // Include boards with 0 devices
    ids.forEach(id => {
      if (!counts[id]) counts[id] = { total: 0, complete: 0 };
    });
    
    res.json({ counts });
  } catch (e) {
    console.error('[DEVICES COUNT] error:', e.message);
    res.status(500).json({ error: 'Count failed' });
  }
});

// ==================== DEVICES CRUD ====================

// LIST Devices for a switchboard
app.get('/api/switchboard/boards/:boardId/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const switchboard_id = Number(req.params.boardId);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
      `SELECT d.id, d.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id,
              d.name, d.device_type, d.manufacturer, d.reference,
              d.in_amps, d.icu_ka, d.ics_ka, d.poles, d.voltage_v, d.trip_unit,
              d.position_number, d.is_differential, d.is_complete, d.settings,
              d.is_main_incoming, d.created_at, d.updated_at
       FROM devices d
       WHERE d.switchboard_id = $1 
       ORDER BY d.position_number ASC NULLS LAST, d.created_at ASC`,
      [switchboard_id]
    );
    
    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICES LIST] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// Legacy endpoint for backward compatibility
app.get('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const switchboard_id = Number(req.query.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
      `SELECT * FROM devices WHERE switchboard_id = $1 
       ORDER BY position_number ASC NULLS LAST, created_at ASC`,
      [switchboard_id]
    );
    
    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICES LIST LEGACY] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// GET ONE Device
app.get('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const r = await pool.query(
      `SELECT d.*, s.name as switchboard_name
       FROM devices d
       JOIN switchboards s ON d.switchboard_id = s.id
       WHERE d.id = $1 AND s.site = $2`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES GET] error:', e.message);
    res.status(500).json({ error: 'Get failed' });
  }
});

// CREATE Device
app.post('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const b = req.body || {};
    const switchboard_id = Number(b.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT site FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    // Calculate is_complete and is_differential
    const is_complete = checkDeviceComplete(b);
    const is_differential = b.is_differential || detectDifferential(b.name) || detectDifferentialFromPosition(b.position_number);

    const settings = b.settings || {};

    const { rows } = await pool.query(
      `INSERT INTO devices (
        site, switchboard_id, parent_id, downstream_switchboard_id, 
        name, device_type, manufacturer, reference, 
        in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, 
        position_number, is_differential, is_complete, settings, is_main_incoming
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        site, switchboard_id, 
        b.parent_id || null, 
        b.downstream_switchboard_id || null, 
        b.name || null, 
        b.device_type || 'Low Voltage Circuit Breaker', 
        b.manufacturer || null, 
        b.reference || null,
        b.in_amps ? Number(b.in_amps) : null, 
        b.icu_ka ? Number(b.icu_ka) : null,
        b.ics_ka ? Number(b.ics_ka) : null, 
        b.poles ? Number(b.poles) : null,
        b.voltage_v ? Number(b.voltage_v) : null,
        b.trip_unit || null, 
        b.position_number || null,
        is_differential,
        is_complete,
        settings,
        !!b.is_main_incoming
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[DEVICES CREATE] error:', e.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

// UPDATE Device
app.put('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const b = req.body || {};
    
    // Calculate is_complete and is_differential
    const is_complete = checkDeviceComplete(b);
    const is_differential = b.is_differential !== undefined 
      ? b.is_differential 
      : (detectDifferential(b.name) || detectDifferentialFromPosition(b.position_number));

    const settings = b.settings || {};

    const { rows } = await pool.query(
      `UPDATE devices SET
        parent_id = $1, downstream_switchboard_id = $2, name = $3, device_type = $4, 
        manufacturer = $5, reference = $6, in_amps = $7, icu_ka = $8, ics_ka = $9, 
        poles = $10, voltage_v = $11, trip_unit = $12, position_number = $13,
        is_differential = $14, is_complete = $15, settings = $16, is_main_incoming = $17,
        updated_at = NOW()
       FROM switchboards sb
       WHERE devices.id = $18 AND devices.switchboard_id = sb.id AND sb.site = $19
       RETURNING devices.*`,
      [
        b.parent_id || null,
        b.downstream_switchboard_id || null,
        b.name || null,
        b.device_type || 'Low Voltage Circuit Breaker',
        b.manufacturer || null,
        b.reference || null,
        b.in_amps ? Number(b.in_amps) : null,
        b.icu_ka ? Number(b.icu_ka) : null,
        b.ics_ka ? Number(b.ics_ka) : null,
        b.poles ? Number(b.poles) : null,
        b.voltage_v ? Number(b.voltage_v) : null,
        b.trip_unit || null,
        b.position_number || null,
        is_differential,
        is_complete,
        settings,
        !!b.is_main_incoming,
        id,
        site
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[DEVICES UPDATE] error:', e.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE Device
app.delete('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const r = await pool.query(
      `DELETE FROM devices d
       USING switchboards sb
       WHERE d.id = $1 AND d.switchboard_id = sb.id AND sb.site = $2
       RETURNING d.id`,
      [id, site]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[DEVICES DELETE] error:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ==================== EXCEL IMPORT ====================

app.post('/api/switchboard/import-excel', upload.single('file'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'No worksheet found' });

    // Extract tableau name from row 2 columns D-G (merged)
    let tableauName = '';
    const row2 = sheet.getRow(2);
    for (let col = 4; col <= 7; col++) {
      const val = row2.getCell(col).value;
      if (val) {
        tableauName = String(val).trim();
        break;
      }
    }

    // Extract code from row 4 columns D-G (merged)
    let code = '';
    const row4 = sheet.getRow(4);
    for (let col = 4; col <= 7; col++) {
      const val = row4.getCell(col).value;
      if (val) {
        code = String(val).trim();
        break;
      }
    }

    if (!tableauName) tableauName = 'Tableau importé';
    if (!code) code = `IMP-${Date.now()}`;

    // Parse building and floor from code (format: BUILDING-FLOOR-XX-XX)
    const codeParts = code.split('-');
    const building = codeParts[0] || null;
    const floor = codeParts[1] || null;

    // Check if switchboard exists or create new one
    let switchboardId;
    const existingBoard = await pool.query(
      `SELECT id FROM switchboards WHERE site = $1 AND code = $2`,
      [site, code]
    );

    if (existingBoard.rows.length > 0) {
      switchboardId = existingBoard.rows[0].id;
      // Update name if different
      await pool.query(
        `UPDATE switchboards SET name = $1, building_code = $2, floor = $3 WHERE id = $4`,
        [tableauName, building, floor, switchboardId]
      );
    } else {
      const newBoard = await pool.query(
        `INSERT INTO switchboards (site, name, code, building_code, floor, regime_neutral)
         VALUES ($1, $2, $3, $4, $5, 'TN-S')
         RETURNING id`,
        [site, tableauName, code, building, floor]
      );
      switchboardId = newBoard.rows[0].id;
    }

    // Parse devices from rows 12+ 
    // Column A = position (repère départ), columns B-E = designation (merged)
    let devicesCreated = 0;
    const startRow = 12;

    for (let rowNum = startRow; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      
      // Get position from column A
      const positionCell = row.getCell(1).value;
      const position = positionCell ? String(positionCell).trim() : '';
      
      // Skip empty rows or header rows
      if (!position || position.toLowerCase().includes('repère') || position.toLowerCase().includes('départ')) {
        continue;
      }

      // Get designation from columns B-E (might be merged)
      let designation = '';
      for (let col = 2; col <= 5; col++) {
        const val = row.getCell(col).value;
        if (val) {
          designation = String(val).trim();
          break;
        }
      }

      if (!designation) continue;

      // Detect if differential from designation or position format
      const is_differential = detectDifferential(designation) || detectDifferentialFromPosition(position);

      // Insert device (marked as incomplete since we don't have specs)
      await pool.query(
        `INSERT INTO devices (site, switchboard_id, name, device_type, position_number, is_differential, is_complete)
         VALUES ($1, $2, $3, $4, $5, $6, false)`,
        [site, switchboardId, designation, 'Low Voltage Circuit Breaker', position, is_differential]
      );
      devicesCreated++;
    }

    res.json({
      success: true,
      switchboard: {
        id: switchboardId,
        name: tableauName,
        code,
        building,
        floor
      },
      devices_created: devicesCreated
    });
  } catch (e) {
    console.error('[EXCEL IMPORT] error:', e.message, e.stack);
    res.status(500).json({ error: 'Import failed', details: e.message });
  }
});

// ==================== AI PHOTO ANALYSIS ====================

app.post('/api/switchboard/analyze-photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    if (!openai) return res.status(503).json({ error: 'OpenAI not available' });

    const buffer = req.file.buffer;
    const base64Image = buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    // Vision analysis
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You output ONLY valid JSON. No markdown fences, no prose. Focus on electrical device identification.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this electrical device image. Extract with high precision:
              - manufacturer: brand name (e.g., "Schneider", "ABB", "Siemens", "Legrand", "Hager")
              - reference: exact model number visible on the device
              - is_differential: boolean, true if you see any of: "30mA", "300mA", "Δ", "DDR", "RCD", "RCBO", "Vigi", differential symbol
              
              If text is unclear, use null. Output JSON only.`
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300
    });

    let result;
    try {
      result = JSON.parse(response.choices[0].message.content);
    } catch (parseErr) {
      console.error('[PHOTO] Parse error:', parseErr);
      return res.status(500).json({ error: 'Failed to parse photo analysis' });
    }

    const manufacturer = result.manufacturer || null;
    const reference = result.reference || null;
    const is_differential = !!result.is_differential;

    // Build query for AI search
    const quick_ai_query = [manufacturer, reference].filter(Boolean).join(' ').trim() || null;

    res.json({
      manufacturer,
      reference,
      is_differential,
      quick_ai_query
    });
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e.message);
    res.status(500).json({ error: 'Photo analysis failed', details: e.message });
  }
});

// ==================== AI DEVICE SEARCH ====================

app.post('/api/switchboard/search-device', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });
    if (!openai) return res.json({ error: 'OpenAI not available' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in electrical protective devices. For the query "${query}", extract and return structured JSON with complete device specifications.

Required fields (use realistic manufacturer-standard values):
- manufacturer: string (exact brand name)
- reference: string (exact model number)
- device_type: string ("MCCB", "ACB", "MCB", "RCBO", "Low Voltage Circuit Breaker")
- in_amps: number (rated current in Amps)
- icu_ka: number (ultimate breaking capacity in kA) 
- ics_ka: number (service breaking capacity in kA, usually 75-100% of Icu)
- poles: number (1-4)
- voltage_v: number (rated voltage, typically 400V for LV)
- trip_unit: string (e.g., "Thermal Magnetic", "Electronic", "Micrologic 5.2")
- is_differential: boolean (true if RCBO, Vigi, or has differential protection)

Settings object (LSIG protection - use manufacturer defaults):
- ir: number (long-time pickup, multiple of In, typically 0.4-1.0)
- tr: number (long-time delay in seconds)
- isd: number (short-time pickup, multiple of Ir)
- tsd: number (short-time delay in seconds)
- ii: number (instantaneous pickup, multiple of In)
- ig: number (ground fault pickup, multiple of In)
- tg: number (ground fault delay in seconds)
- zsi: boolean (Zone Selective Interlocking)
- erms: boolean (Energy Reducing Maintenance)
- curve_type: string ("B", "C", "D" for MCBs)

Output ONLY valid JSON. Use null for unknown values.` 
        },
        { role: 'user', content: `Extract device specifications: ${query}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 800
    });

    const jsonResponse = JSON.parse(completion.choices[0].message.content);
    
    // Safe number conversion
    const safeNum = (val) => {
      if (val === null || val === undefined) return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    };

    const validated = {
      manufacturer: jsonResponse.manufacturer || null,
      reference: jsonResponse.reference || null,
      device_type: jsonResponse.device_type || 'Low Voltage Circuit Breaker',
      in_amps: safeNum(jsonResponse.in_amps),
      icu_ka: safeNum(jsonResponse.icu_ka),
      ics_ka: safeNum(jsonResponse.ics_ka) || (safeNum(jsonResponse.icu_ka) ? safeNum(jsonResponse.icu_ka) * 0.75 : null),
      poles: safeNum(jsonResponse.poles) || 3,
      voltage_v: safeNum(jsonResponse.voltage_v) || 400,
      trip_unit: jsonResponse.trip_unit || null,
      is_differential: !!jsonResponse.is_differential,
      settings: {
        ir: safeNum(jsonResponse.settings?.ir) ?? 1,
        tr: safeNum(jsonResponse.settings?.tr) ?? 10,
        isd: safeNum(jsonResponse.settings?.isd) ?? 6,
        tsd: safeNum(jsonResponse.settings?.tsd) ?? 0.1,
        ii: safeNum(jsonResponse.settings?.ii) ?? 10,
        ig: safeNum(jsonResponse.settings?.ig) ?? 0.5,
        tg: safeNum(jsonResponse.settings?.tg) ?? 0.2,
        zsi: !!jsonResponse.settings?.zsi,
        erms: !!jsonResponse.settings?.erms,
        curve_type: jsonResponse.settings?.curve_type || 'C'
      }
    };

    res.json(validated);
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

// ==================== SEARCH HELPERS ====================

// Search Device References (autocomplete)
app.get('/api/switchboard/search-references', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const query = (req.query.query || '').trim().toLowerCase();

    const where = ['site = $1'];
    const vals = [site];
    let i = 2;
    if (query) {
      where.push(`(LOWER(reference) ILIKE $${i} OR LOWER(manufacturer) ILIKE $${i})`);
      vals.push(`%${query}%`);
      i++;
    }

    const { rows } = await pool.query(
      `SELECT DISTINCT manufacturer, reference, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, is_differential, settings
       FROM devices
       WHERE ${where.join(' AND ')} AND manufacturer IS NOT NULL
       ORDER BY manufacturer, reference
       LIMIT 20`, vals
    );

    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH REFERENCES] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Parent Devices
app.get('/api/switchboard/search-parents', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const query = (req.query.query || '').trim().toLowerCase();
    const switchboard_id = Number(req.query.switchboard_id);

    const where = ['sb.site = $1'];
    const vals = [site];
    let i = 2;
    if (query) {
      where.push(`(LOWER(d.name) ILIKE $${i} OR LOWER(d.manufacturer) ILIKE $${i} OR LOWER(d.reference) ILIKE $${i})`);
      vals.push(`%${query}%`);
      i++;
    }
    if (switchboard_id) {
      where.push(`d.switchboard_id = $${i}`);
      vals.push(switchboard_id);
    }

    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.device_type, d.manufacturer, d.reference, sb.name as switchboard_name
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE ${where.join(' AND ')}
       ORDER BY d.created_at DESC
       LIMIT 20`, vals
    );
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH PARENTS] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Downstream Switchboards
app.get('/api/switchboard/search-downstreams', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const query = (req.query.query || '').trim().toLowerCase();

    const where = ['site = $1'];
    const vals = [site];
    let i = 2;
    if (query) {
      where.push(`(LOWER(name) ILIKE $${i} OR LOWER(code) ILIKE $${i})`);
      vals.push(`%${query}%`);
    }

    const { rows } = await pool.query(
      `SELECT id, name, code, building_code, floor, room
       FROM switchboards
       WHERE ${where.join(' AND ')}
       ORDER BY name
       LIMIT 20`, vals
    );
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH DOWNSTREAMS] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== GRAPH ====================

app.get('/api/switchboard/boards/:id/graph', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const rootId = Number(req.params.id);
    const sb = await pool.query('SELECT * FROM switchboards WHERE id=$1 AND site=$2', [rootId, site]);
    if (!sb.rows.length) return res.status(404).json({ error: 'Not found' });

    const buildTree = async (switchboardId) => {
      const { rows: devs } = await pool.query(
        'SELECT * FROM devices WHERE switchboard_id=$1 ORDER BY position_number ASC NULLS LAST, created_at ASC', 
        [switchboardId]
      );
      const byId = new Map(devs.map(d => [d.id, { ...d, children: [], downstream: null }]));
      const roots = [];
      for (const d of devs) {
        const node = byId.get(d.id);
        if (d.parent_id && byId.has(d.parent_id)) byId.get(d.parent_id).children.push(node);
        else roots.push(node);
      }
      for (const node of byId.values()) {
        if (node.downstream_switchboard_id) node.downstream = await buildTree(node.downstream_switchboard_id);
      }
      return { switchboard_id: switchboardId, devices: roots };
    };

    const graph = await buildTree(rootId);
    res.json(graph);
  } catch (e) {
    console.error('[SWITCHBOARD GRAPH] error:', e.message);
    res.status(500).json({ error: 'Graph failed' });
  }
});

// ==================== STATS & CALENDAR ====================

app.get('/api/switchboard/stats', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM switchboards WHERE site = $1) as total_boards,
        (SELECT COUNT(*)::int FROM devices d JOIN switchboards sb ON d.switchboard_id = sb.id WHERE sb.site = $1) as total_devices,
        (SELECT COUNT(*)::int FROM devices d JOIN switchboards sb ON d.switchboard_id = sb.id WHERE sb.site = $1 AND d.is_complete = true) as complete_devices,
        (SELECT COUNT(*)::int FROM devices d JOIN switchboards sb ON d.switchboard_id = sb.id WHERE sb.site = $1 AND d.is_differential = true) as differential_devices,
        (SELECT COUNT(*)::int FROM switchboards WHERE site = $1 AND is_principal = true) as principal_boards
    `, [site]);

    res.json(stats.rows[0]);
  } catch (e) {
    console.error('[STATS] error:', e.message);
    res.status(500).json({ error: 'Stats failed' });
  }
});

app.get('/api/switchboard/calendar', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    // Return boards grouped by building for calendar view
    const { rows } = await pool.query(`
      SELECT sb.id, sb.name, sb.code, sb.building_code, sb.floor, sb.is_principal,
             COUNT(d.id)::int as device_count,
             COUNT(d.id) FILTER (WHERE d.is_complete = true)::int as complete_count
      FROM switchboards sb
      LEFT JOIN devices d ON d.switchboard_id = sb.id
      WHERE sb.site = $1
      GROUP BY sb.id
      ORDER BY sb.building_code, sb.floor, sb.name
    `, [site]);

    res.json({ data: rows });
  } catch (e) {
    console.error('[CALENDAR] error:', e.message);
    res.status(500).json({ error: 'Calendar failed' });
  }
});

// ==================== AI TIP ====================

app.post('/api/switchboard/ai-tip', async (req, res) => {
  try {
    if (!openai) return res.json({ tip: 'AI tips unavailable' });

    const { query } = req.body;
    const context = query || 'General electrical engineering advice';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert electrical engineer. Provide a brief, practical tip (1-2 sentences) related to: "${context}". 
          Reference standards (IEC, NEC) when relevant. Be specific and actionable.` 
        },
        { role: 'user', content: context }
      ],
      max_tokens: 120,
      temperature: 0.3
    });

    res.json({ tip: completion.choices[0].message.content.trim() });
  } catch (e) {
    console.error('[AI TIP] error:', e.message);
    res.status(500).json({ error: 'AI tip failed' });
  }
});

// ==================== START SERVER ====================

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => console.log(`[SWITCHBOARD] Service running on :${port}`));
