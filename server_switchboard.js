// server_switchboard.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import multer from 'multer';

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

// Upload setup for photo
const upload = multer({ memoryStorage: true });

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site');
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

const WHITELIST_SORT = ['created_at','name','code','building_code','floor'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'created_at'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema - AMÉLIORATION: Meilleure gestion des NULL et defaults
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

    -- Add columns if missing
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'name') THEN
        ALTER TABLE devices ADD COLUMN name TEXT;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'position_number') THEN
        ALTER TABLE devices ADD COLUMN position_number TEXT;
      END IF;
      -- Ensure settings defaults
      UPDATE devices 
      SET settings = COALESCE(settings, '{}'::jsonb) || 
        '{"ir": 1, "tr": 10, "isd": 6, "tsd": 0.1, "ii": 10, "ig": 0.5, "tg": 0.2, "zsi": false, "erms": false, "curve_type": ""}'::jsonb
      WHERE settings IS NULL OR settings = '{}'::jsonb;
    END $$;

    -- Add trigger if missing (matches schema)
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

// LIST Switchboards
app.get('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, building, floor, room, sort = 'created_at', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = ['site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(name ILIKE $${i} OR code ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (building) { where.push(`building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    if (room) { where.push(`room ILIKE $${i}`); vals.push(`%${room}%`); i++; }
    const limit = Math.min(parseInt(pageSize,10) || 18, 100);
    const offset = ((parseInt(page,10) || 1) - 1) * limit;

    const sql = `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, created_at
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
      `SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, created_at
       FROM switchboards WHERE id=$1 AND site=$2`, [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];
    res.json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal,
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
      is_principal: sb.is_principal,
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
       RETURNING id, site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality, created_at`,
      [name, code, building, floor, room, regime, is_principal, modes, quality, id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = r.rows[0];
    res.json({
      id: sb.id,
      meta: { site: sb.site, building_code: sb.building_code, floor: sb.floor, room: sb.room },
      name: sb.name, code: sb.code, regime_neutral: sb.regime_neutral,
      is_principal: sb.is_principal,
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD UPDATE] error:', e);
    res.status(500).json({ error: 'Update failed' });
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
      is_principal: sb.is_principal,
      modes: sb.modes || {}, quality: sb.quality || {}, created_at: sb.created_at
    });
  } catch (e) {
    console.error('[SWITCHBOARD DUPLICATE] error:', e);
    res.status(500).json({ error: 'Duplicate failed' });
  }
});

// DELETE Switchboard
app.delete('/api/switchboard/boards/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const r = await pool.query(`DELETE FROM switchboards WHERE id=$1 AND site=$2`, [id, site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[SWITCHBOARD DELETE] error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Amélioration 1 : endpoint pour compter les devices par switchboard
app.get('/api/switchboard/devices-count', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const idsParam = (req.query.ids || '').toString().trim();
    if (!idsParam) {
      // counts for all boards of the site
      const { rows } = await pool.query(
        `SELECT switchboard_id, COUNT(*)::int AS count
         FROM devices d JOIN switchboards sb ON d.switchboard_id = sb.id
         WHERE sb.site = $1 GROUP BY switchboard_id`, [site]
      );
      const map = {};
      rows.forEach(r => map[r.switchboard_id] = r.count);
      return res.json({ counts: map });
    }

    const ids = idsParam.split(',').map(s => Number(s)).filter(Boolean);
    if (!ids.length) return res.json({ counts: {} });

    const { rows } = await pool.query(
      `SELECT switchboard_id, COUNT(*)::int AS count
       FROM devices d
       WHERE switchboard_id = ANY($1::int[])
       GROUP BY switchboard_id`, [ids]
    );
    const map = {};
    rows.forEach(r => map[r.switchboard_id] = r.count);
    res.json({ counts: map });
  } catch (e) {
    console.error('[DEVICES COUNT] error:', e.message);
    res.status(500).json({ error: 'Count failed' });
  }
});

// Liste toutes les références uniques des dispositifs pour le site
app.get('/api/switchboard/device-references', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Site manquant' });

    const sql = `
      SELECT DISTINCT ON (manufacturer, reference) 
        manufacturer, reference, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings
      FROM devices 
      WHERE site = $1 AND manufacturer IS NOT NULL AND reference IS NOT NULL
      ORDER BY manufacturer, reference, created_at DESC
    `;
    const { rows } = await pool.query(sql, [site]);

    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICE REFERENCES] erreur:', e.message);
    res.status(500).json({ error: 'Échec de la récupération' });
  }
});

// LIST Devices - AMÉLIORATION: Retour plus complet pour l'édition
app.get('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const switchboard_id = Number(req.query.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
      `SELECT d.*, 
       COALESCE(s.name, '') as switchboard_name,
       COALESCE(p.name, '') as parent_name,
       COALESCE(p.manufacturer, '') as parent_manufacturer,
       COALESCE(p.reference, '') as parent_reference
       FROM devices d
       LEFT JOIN switchboards s ON d.switchboard_id = s.id
       LEFT JOIN devices p ON d.parent_id = p.id
       WHERE d.switchboard_id=$1 
       ORDER BY d.created_at DESC`,
      [switchboard_id]
    );
    
    // AMÉLIORATION: Enrichir les devices avec des infos parent/downstream
    const enriched = rows.map(d => ({
      ...d,
      // Conserver les NULL réels pour persistance
      in_amps: d.in_amps,
      icu_ka: d.icu_ka,
      ics_ka: d.ics_ka,
      poles: d.poles,
      voltage_v: d.voltage_v,
      settings: d.settings || {
        ir: 1, tr: 10, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: ''
      }
    }));
    
    res.json({ data: enriched });
  } catch (e) {
    console.error('[DEVICES LIST] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// GET ONE Device - AMÉLIORATION: Retour complet avec parent/downstream info
app.get('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);

    const r = await pool.query(
      `SELECT d.*, 
       s.name as switchboard_name,
       p.name as parent_name,
       p.manufacturer as parent_manufacturer,
       p.reference as parent_reference,
       ds.name as downstream_name,
       ds.code as downstream_code
       FROM devices d
       JOIN switchboards s ON d.switchboard_id = s.id
       LEFT JOIN devices p ON d.parent_id = p.id
       LEFT JOIN switchboards ds ON d.downstream_switchboard_id = ds.id
       WHERE d.id=$1 AND s.site=$2`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    
    const device = r.rows[0];
    const enriched = {
      ...device,
      // Conserver les NULL réels pour persistance
      in_amps: device.in_amps,
      icu_ka: device.icu_ka,
      ics_ka: device.ics_ka,
      poles: device.poles,
      voltage_v: device.voltage_v,
      settings: device.settings || {
        ir: 1, tr: 10, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: ''
      }
    };
    
    res.json(enriched);
  } catch (e) {
    console.error('[DEVICES GET] error:', e.message);
    res.status(500).json({ error: 'Get failed' });
  }
});

// Coerce helpers - AMÉLIORATION: Meilleure gestion des valeurs NULL
function coercePVTests(pv_tests) {
  if (typeof pv_tests === 'string' && pv_tests.length > 0) {
    try { return Buffer.from(pv_tests, 'base64'); } catch { return null; }
  }
  return null;
}

function coercePhotos(photos) {
  if (Array.isArray(photos)) {
    const out = [];
    for (const p of photos) {
      if (typeof p === 'string') {
        try { out.push(Buffer.from(p, 'base64')); } catch { /* ignore */ }
      }
    }
    return out;
  }
  return [];
}

// CREATE Device - AMÉLIORATION: Préservation des NULL et meilleure gestion settings
app.post('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const b = req.body || {};
    const switchboard_id = Number(b.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT site FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });
    const device_site = sbCheck.rows[0].site;

    const safePV = coercePVTests(b.pv_tests);
    const safePhotos = coercePhotos(b.photos);
    
    // AMÉLIORATION: Gestion fine des NULL et merge des settings
    const settings = b.settings || {};
    const mergedSettings = {
      ir: settings.ir !== undefined ? Number(settings.ir) : null,
      tr: settings.tr !== undefined ? Number(settings.tr) : null,
      isd: settings.isd !== undefined ? Number(settings.isd) : null,
      tsd: settings.tsd !== undefined ? Number(settings.tsd) : null,
      ii: settings.ii !== undefined ? Number(settings.ii) : null,
      ig: settings.ig !== undefined ? Number(settings.ig) : null,
      tg: settings.tg !== undefined ? Number(settings.tg) : null,
      zsi: settings.zsi !== undefined ? Boolean(settings.zsi) : null,
      erms: settings.erms !== undefined ? Boolean(settings.erms) : null,
      curve_type: settings.curve_type || null
    };

    const { rows } = await pool.query(
      `INSERT INTO devices (site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings, is_main_incoming, pv_tests, photos, position_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [device_site, switchboard_id, b.parent_id || null, b.downstream_switchboard_id || null, b.name || null, b.device_type, b.manufacturer || null, b.reference || null,
       b.in_amps !== undefined ? Number(b.in_amps) : null, 
       b.icu_ka !== undefined ? Number(b.icu_ka) : null,
       b.ics_ka !== undefined ? Number(b.ics_ka) : null, 
       b.poles !== undefined ? Number(b.poles) : null,
       b.voltage_v !== undefined ? Number(b.voltage_v) : null,
       b.trip_unit || null, 
       mergedSettings,
       !!b.is_main_incoming, safePV, safePhotos, b.position_number || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[DEVICES CREATE] error:', e.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

// UPDATE Device - AMÉLIORATION: Préservation des NULL et mise à jour settings
app.put('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const b = req.body || {};
    const safePV = coercePVTests(b.pv_tests);
    const safePhotos = coercePhotos(b.photos);
    
    // AMÉLIORATION: Gestion fine des NULL et merge des settings
    const settings = b.settings || {};
    const mergedSettings = {
      ir: settings.ir !== undefined ? Number(settings.ir) : null,
      tr: settings.tr !== undefined ? Number(settings.tr) : null,
      isd: settings.isd !== undefined ? Number(settings.isd) : null,
      tsd: settings.tsd !== undefined ? Number(settings.tsd) : null,
      ii: settings.ii !== undefined ? Number(settings.ii) : null,
      ig: settings.ig !== undefined ? Number(settings.ig) : null,
      tg: settings.tg !== undefined ? Number(settings.tg) : null,
      zsi: settings.zsi !== undefined ? Boolean(settings.zsi) : null,
      erms: settings.erms !== undefined ? Boolean(settings.erms) : null,
      curve_type: settings.curve_type !== undefined ? settings.curve_type : null,
      ...settings // Merge avec tout autre paramètre personnalisé
    };

    const { rows } = await pool.query(
      `UPDATE devices SET
        parent_id=$1, downstream_switchboard_id=$2, name=$3, device_type=$4, manufacturer=$5, reference=$6, 
        in_amps=$7, icu_ka=$8, ics_ka=$9, poles=$10, voltage_v=$11, trip_unit=$12, settings=$13, is_main_incoming=$14, 
        pv_tests=$15, photos=$16, position_number=$17
       FROM switchboards sb
       WHERE devices.id=$18 AND devices.switchboard_id = sb.id AND sb.site=$19
       RETURNING devices.*`,
      [
        b.parent_id !== undefined ? b.parent_id : null, 
        b.downstream_switchboard_id !== undefined ? b.downstream_switchboard_id : null,
        b.name !== undefined ? b.name : null, 
        b.device_type, 
        b.manufacturer !== undefined ? b.manufacturer : null,
        b.reference !== undefined ? b.reference : null,
        b.in_amps !== undefined ? Number(b.in_amps) : null,
        b.icu_ka !== undefined ? Number(b.icu_ka) : null,
        b.ics_ka !== undefined ? Number(b.ics_ka) : null,
        b.poles !== undefined ? Number(b.poles) : null,
        b.voltage_v !== undefined ? Number(b.voltage_v) : null,
        b.trip_unit !== undefined ? b.trip_unit : null,
        mergedSettings,
        !!b.is_main_incoming,
        safePV,
        safePhotos,
        b.position_number !== undefined ? b.position_number : null,
        id, site
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[DEVICES UPDATE] error:', e.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DUPLICATE Device
app.post('/api/switchboard/devices/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const r = await pool.query(
      `INSERT INTO devices (site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings, is_main_incoming, pv_tests, photos, position_number)
       SELECT site, switchboard_id, parent_id, downstream_switchboard_id, name || ' (copy)', device_type, manufacturer, reference, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings, FALSE, pv_tests, photos, position_number
       FROM devices WHERE id=$1 AND site=$2
       RETURNING *`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES DUPLICATE] error:', e.message);
    res.status(500).json({ error: 'Duplicate failed' });
  }
});

// DELETE Device
app.delete('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const r = await pool.query(`DELETE FROM devices WHERE id=$1 AND site=$2`, [id, site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[DEVICES DELETE] error:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// SET Main Incoming
app.put('/api/switchboard/devices/:id/set-main', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const b = req.body || {};
    const isMain = !!b.is_main_incoming;

    const { rows } = await pool.query(
      `UPDATE devices SET is_main_incoming=$1
       FROM switchboards sb
       WHERE devices.id=$2 AND devices.switchboard_id = sb.id AND sb.site=$3
       RETURNING devices.*`,
      [isMain, id, site]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[SET MAIN] error:', e.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

// Search Parent Devices
app.get('/api/switchboard/search-parents', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const query = (req.query.query || '').trim().toLowerCase();
    const switchboard_id = Number(req.query.switchboard_id);

    const where = ['d.site = $1', 'd.switchboard_id != $2'];
    const vals = [site, switchboard_id];
    let i = 3;
    if (query) {
      where.push(`(LOWER(d.name) ILIKE $${i} OR LOWER(d.manufacturer) ILIKE $${i} OR LOWER(d.reference) ILIKE $${i})`);
      vals.push(`%${query}%`);
      i++;
    }

    const sql = `SELECT d.id, d.name, d.device_type, d.manufacturer, d.reference, s.name as switchboard_name
                 FROM devices d
                 JOIN switchboards s ON d.switchboard_id = s.id
                 WHERE ${where.join(' AND ')}
                 ORDER BY d.created_at DESC
                 LIMIT 20`;
    const { rows } = await pool.query(sql, vals);
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
      i++;
    }

    const sql = `SELECT id, name, code, building_code, floor, room
                 FROM switchboards
                 WHERE ${where.join(' AND ')}
                 ORDER BY created_at DESC
                 LIMIT 20`;
    const { rows } = await pool.query(sql, vals);
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH DOWNSTREAMS] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Device References
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

    const sql = `SELECT DISTINCT manufacturer, reference, device_type, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings
                 FROM devices
                 WHERE ${where.join(' AND ')}
                 ORDER BY manufacturer, reference
                 LIMIT 20`;
    const { rows } = await pool.query(sql, vals);

    let exactMatch = null;
    const queryLower = query.toLowerCase();
    for (const row of rows) {
      const refLower = (row.reference || '').toLowerCase();
      const mfgLower = (row.manufacturer || '').toLowerCase();
      const fullLower = `${mfgLower} ${refLower}`.trim();
      if (refLower === queryLower || mfgLower === queryLower || fullLower === queryLower) {
        exactMatch = row;
        break;
      }
      
      // Match partiel très proche (premier 4+ chars)
      if (queryLower.length >= 4 && 
          (refLower.startsWith(queryLower) || mfgLower.startsWith(queryLower) || fullLower.startsWith(queryLower))) {
        exactMatch = row;
        break;
      }
    }

    const suggestions = rows.map(r => ({
      ...r,
      // Conserver les valeurs réelles (pas de fallback)
      in_amps: r.in_amps,
      icu_ka: r.icu_ka,
      ics_ka: r.ics_ka,
      poles: r.poles,
      voltage_v: r.voltage_v,
      settings: r.settings || {}
    }));

    res.json({ 
      suggestions,
      auto_fill: exactMatch ? {
        manufacturer: exactMatch.manufacturer,
        reference: exactMatch.reference,
        device_type: exactMatch.device_type || 'Low Voltage Circuit Breaker',
        in_amps: exactMatch.in_amps,
        icu_ka: exactMatch.icu_ka,
        ics_ka: exactMatch.ics_ka,
        poles: exactMatch.poles,
        voltage_v: exactMatch.voltage_v,
        trip_unit: exactMatch.trip_unit || '',
        settings: exactMatch.settings || { curve_type: '' }
      } : null 
    });
  } catch (e) {
    console.error('[SEARCH REFERENCES] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Device (OpenAI) - AMÉLIORATION: Meilleure prompt pour specs complètes
app.post('/api/switchboard/search-device', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    if (!openai) {
      return res.json({ error: 'OpenAI not available' });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in electrical protective devices. For the query "${query}", extract and return structured JSON with ALL relevant fields for a complete device specification. 

Required fields (use realistic values based on manufacturer standards):
- manufacturer: string (e.g. "Schneider", "ABB", "Siemens")
- reference: string (specific model number)
- device_type: string (e.g. "MCCB", "ACB", "MCB", "Low Voltage Circuit Breaker")
- in_amps: number (rated current in Amps)
- icu_ka: number (ultimate breaking capacity in kA) 
- ics_ka: number (service breaking capacity in kA, usually 0.75-1.0 × Icu)
- poles: number (1-4 poles)
- voltage_v: number (rated voltage in Volts, typically 400 for LV)
- trip_unit: string (e.g. "Thermal Magnetic", "Electronic", "Micrologic")

Settings object (LSIG protection parameters - use realistic defaults):
- ir: number (long-time pickup current, multiple of In)
- tr: number (long-time delay in seconds)
- isd: number (short-time pickup current, multiple of Ir)
- tsd: number (short-time delay in seconds)
- ii: number (instantaneous pickup current, multiple of In)
- ig: number (ground fault pickup current, multiple of In)
- tg: number (ground fault delay in seconds)
- zsi: boolean (Zone Selective Interlocking)
- erms: boolean (Energy Reducing Maintenance System)
- curve_type: string (e.g. "C", "D", "K" for MCBs)

Output ONLY valid JSON. If uncertain about a value, use null. Base values on electrical engineering standards.` 
        },
        { role: 'user', content: `Extract device specifications: ${query}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 800
    });

    const jsonResponse = JSON.parse(completion.choices[0].message.content);
    
    // AMÉLIORATION: Validation et defaults intelligents
    const validated = {
      manufacturer: jsonResponse.manufacturer || null,
      reference: jsonResponse.reference || null,
      device_type: jsonResponse.device_type || 'Low Voltage Circuit Breaker',
      in_amps: jsonResponse.in_amps ? Number(jsonResponse.in_amps) : null,
      icu_ka: jsonResponse.icu_ka ? Number(jsonResponse.icu_ka) : null,
      ics_ka: jsonResponse.ics_ka ? Number(jsonResponse.ics_ka) : (jsonResponse.icu_ka ? Number(jsonResponse.icu_ka) * 0.75 : null),
      poles: jsonResponse.poles ? Number(jsonResponse.poles) : 3,
      voltage_v: jsonResponse.voltage_v ? Number(jsonResponse.voltage_v) : 400,
      trip_unit: jsonResponse.trip_unit || null,
      settings: {
        ir: jsonResponse.settings?.ir ? Number(jsonResponse.settings.ir) : 1,
        tr: jsonResponse.settings?.tr ? Number(jsonResponse.settings.tr) : 10,
        isd: jsonResponse.settings?.isd ? Number(jsonResponse.settings.isd) : 6,
        tsd: jsonResponse.settings?.tsd ? Number(jsonResponse.settings.tsd) : 0.1,
        ii: jsonResponse.settings?.ii ? Number(jsonResponse.settings.ii) : 10,
        ig: jsonResponse.settings?.ig ? Number(jsonResponse.settings.ig) : 0.5,
        tg: jsonResponse.settings?.tg ? Number(jsonResponse.settings.tg) : 0.2,
        zsi: jsonResponse.settings?.zsi !== undefined ? Boolean(jsonResponse.settings.zsi) : false,
        erms: jsonResponse.settings?.erms !== undefined ? Boolean(jsonResponse.settings.erms) : false,
        curve_type: jsonResponse.settings?.curve_type || 'C',
        ...jsonResponse.settings // Merge avec tout autre paramètre
      }
    };

    res.json(validated);
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

// Graph
app.get('/api/switchboard/boards/:id/graph', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const rootId = Number(req.params.id);
    const sb = await pool.query('SELECT * FROM switchboards WHERE id=$1 AND site=$2', [rootId, site]);
    if (!sb.rows.length) return res.status(404).json({ error: 'Not found' });

    const buildTree = async (switchboardId) => {
      const { rows: devs } = await pool.query('SELECT * FROM devices WHERE switchboard_id=$1 ORDER BY created_at ASC', [switchboardId]);
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

// ---- PHOTO ANALYSIS (amélioration 5 : enrichissement systématique + flux Quick AI) ----
function safeJsonParse(raw) {
  if (typeof raw !== 'string') return raw;
  let s = raw.trim();
  // strip fences ```json ... ```
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/,'').trim();
  }
  // si un JSON est noyé dans du texte, on récupère le premier bloc {...}
  const m = s.match(/\{[\s\S]*\}$/);
  if (m) s = m[0];
  return JSON.parse(s);
}

app.post('/api/switchboard/analyze-photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!openai || !req.file) return res.status(400).json({ error: 'OpenAI or file missing' });

    const switchboardId = req.query.switchboard_id ? Number(req.query.switchboard_id) : null;
    let deviceSite = site;
    if (switchboardId) {
      const chk = await pool.query('SELECT site FROM switchboards WHERE id=$1 AND site=$2', [switchboardId, site]);
      if (!chk.rows.length) return res.status(404).json({ error: 'Switchboard not found for photo attach' });
      deviceSite = chk.rows[0].site;
    }

    const buffer = req.file.buffer;
    const base64Image = buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Vision description - AMÉLIORATION: Prompt plus précis
    const descriptionResponse = await openai.chat.completions.create({
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
              - manufacturer: brand name (Schneider, ABB, Siemens, etc.)
              - reference: exact model number visible on the device
              - device_type: type (Circuit Breaker, MCCB, ACB, MCB, Switch, Fuse, etc.)
              - in_amps: rated current if visible
              - poles: number of poles if visible
              - voltage_v: voltage rating if visible
              - description: brief technical description of what you see

              Be specific with model numbers. If text is unclear, use "unknown". JSON only.` 
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 400
    });

    let description;
    try {
      description = safeJsonParse(descriptionResponse.choices[0].message.content);
    } catch (parseErr) {
      console.error('[PHOTO] Parse error:', parseErr);
      return res.status(500).json({ error: 'Failed to parse photo description' });
    }

    if (!description.manufacturer && !description.reference) {
      return res.json({ 
        error: 'Could not identify manufacturer or reference from photo',
        description: description.description || 'Device visible but identification unclear',
        manufacturer: null, 
        reference: null 
      });
    }

    // AMÉLIORATION: Recherche existant plus précise
    const { rows: existing } = await pool.query(
      `SELECT d.*, sb.name as switchboard_name
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.site = $1 
       AND (LOWER(COALESCE(d.manufacturer, '')) = LOWER($2) OR LOWER(d.reference) = LOWER($3))
       ORDER BY d.updated_at DESC
       LIMIT 3`,
      [site, description.manufacturer || '', description.reference || '']
    );

    let responseData;
    
    if (existing.length > 0) {
      // AMÉLIORATION: Meilleur merge existant + AI specs
      const bestMatch = existing[0];
      const aiSpecs = await getAiDeviceSpecs(description);
      
      responseData = {
        ...bestMatch,
        // Priorité: DB > AI specs > defaults, mais conserve NULL si pas de valeur
        device_type: bestMatch.device_type || aiSpecs.device_type,
        in_amps: bestMatch.in_amps !== null ? bestMatch.in_amps : aiSpecs.in_amps,
        icu_ka: bestMatch.icu_ka !== null ? bestMatch.icu_ka : aiSpecs.icu_ka,
        ics_ka: bestMatch.ics_ka !== null ? bestMatch.ics_ka : aiSpecs.ics_ka,
        poles: bestMatch.poles !== null ? bestMatch.poles : aiSpecs.poles,
        voltage_v: bestMatch.voltage_v !== null ? bestMatch.voltage_v : aiSpecs.voltage_v,
        trip_unit: bestMatch.trip_unit || aiSpecs.trip_unit,
        settings: {
          ...(bestMatch.settings || {}),
          ...(aiSpecs.settings || {})
        },
        existing_id: bestMatch.id,
        matched: true,
        photo_description: description.description || `Identified: ${description.manufacturer} ${description.reference}`,
        quick_ai_query: `${description.manufacturer} ${description.reference}`.trim() // Pour le frontend
      };
      
      res.json(responseData);
      
    } else {
      // Pas d'existant, générer specs AI complètes
      const aiSpecs = await getAiDeviceSpecs(description);
      
      if (switchboardId) {
        // Créer directement le device
        const { rows: [newDevice] } = await pool.query(
          `INSERT INTO devices (site, switchboard_id, device_type, manufacturer, reference, in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings, name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING *`,
          [deviceSite, switchboardId, 
           aiSpecs.device_type || description.device_type || 'Low Voltage Circuit Breaker', 
           description.manufacturer,
           description.reference,
           aiSpecs.in_amps, aiSpecs.icu_ka, aiSpecs.ics_ka, aiSpecs.poles, aiSpecs.voltage_v,
           aiSpecs.trip_unit, aiSpecs.settings,
           `${description.manufacturer} ${description.reference}`]
        );
        
        res.json({ 
          ...newDevice, 
          created: true, 
          photo_description: description.description || `Created: ${description.manufacturer} ${description.reference}`,
          quick_ai_query: `${description.manufacturer} ${description.reference}`.trim()
        });
        
      } else {
        // Retourner specs pour pré-remplissage manuel
        res.json({ 
          ...aiSpecs,
          manufacturer: description.manufacturer,
          reference: description.reference,
          name: `${description.manufacturer} ${description.reference}`,
          created: false, 
          requires_switchboard: true,
          photo_description: description.description || `Ready to create: ${description.manufacturer} ${description.reference}`,
          quick_ai_query: `${description.manufacturer} ${description.reference}`.trim()
        });
      }
    }
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e.message);
    res.status(500).json({ error: 'Photo analysis failed', details: e.message });
  }
});

// NOUVELLE FONCTION: Génération specs AI à partir de description photo
async function getAiDeviceSpecs(description) {
  if (!openai) return {};
  
  try {
    const prompt = `Based on this device description: "${JSON.stringify(description)}"
    
    Generate complete technical specifications for this electrical device. Use realistic values based on the identified manufacturer and type.
    
    Return JSON with:
    - device_type: specific type
    - in_amps: realistic rated current
    - icu_ka: ultimate breaking capacity (kA)
    - ics_ka: service breaking capacity (typically 75% of Icu)
    - poles: number of poles (1-4)
    - voltage_v: rated voltage (typically 400V for LV)
    - trip_unit: type of trip unit
    - settings: object with {ir, tr, isd, tsd, ii, ig, tg, zsi, erms, curve_type}
    
    Use engineering standards for this manufacturer. JSON only.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an electrical engineering expert. Generate realistic device specifications.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 600
    });

    const specs = safeJsonParse(completion.choices[0].message.content);
    
    return {
      device_type: specs.device_type || 'Low Voltage Circuit Breaker',
      in_amps: specs.in_amps ? Number(specs.in_amps) : null,
      icu_ka: specs.icu_ka ? Number(specs.icu_ka) : null,
      ics_ka: specs.ics_ka ? Number(specs.ics_ka) : null,
      poles: specs.poles ? Number(specs.poles) : 3,
      voltage_v: specs.voltage_v ? Number(specs.voltage_v) : 400,
      trip_unit: specs.trip_unit || null,
      settings: {
        ir: specs.settings?.ir ? Number(specs.settings.ir) : 1,
        tr: specs.settings?.tr ? Number(specs.settings.tr) : 10,
        isd: specs.settings?.isd ? Number(specs.settings.isd) : 6,
        tsd: specs.settings?.tsd ? Number(specs.settings.tsd) : 0.1,
        ii: specs.settings?.ii ? Number(specs.settings.ii) : 10,
        ig: specs.settings?.ig ? Number(specs.settings.ig) : 0.5,
        tg: specs.settings?.tg ? Number(specs.settings.tg) : 0.2,
        zsi: specs.settings?.zsi !== undefined ? Boolean(specs.settings.zsi) : false,
        erms: specs.settings?.erms !== undefined ? Boolean(specs.settings.erms) : false,
        curve_type: specs.settings?.curve_type || 'C',
        ...specs.settings
      }
    };
  } catch (e) {
    console.error('[AI SPECS] error:', e);
    return {
      device_type: 'Low Voltage Circuit Breaker',
      settings: { ir: 1, tr: 10, isd: 6, curve_type: 'C' }
    };
  }
}

// ---- AI TIP - AMÉLIORATION: Réponses plus contextuelles ----
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
          content: `You are an expert electrical engineer providing concise, practical advice. 
          
          Context: "${context}"
          
          Respond in 1-2 sentences with actionable advice. Be specific about standards (IEC, NEC), safety, or best practices. 
          Keep it professional and helpful. No fluff.` 
        },
        { role: 'user', content: context }
      ],
      max_tokens: 120,
      temperature: 0.3
    });

    const tip = completion.choices[0].message.content.trim();
    res.json({ tip });
  } catch (e) {
    console.error('[AI TIP] error:', e.message);
    res.status(500).json({ error: 'AI tip failed' });
  }
});

// ---- REPORT (PDF) - AMÉLIORATION: Rapport plus complet ----
app.get('/api/switchboard/boards/:id/report', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query('SELECT * FROM switchboards WHERE id=$1 AND site=$2', [id, site]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Switchboard not found' });

    // Get devices avec infos enrichies
    const devsR = await pool.query(`
      SELECT d.*, p.name as parent_name
      FROM devices d
      LEFT JOIN devices p ON d.parent_id = p.id
      WHERE d.switchboard_id=$1 
      ORDER BY d.is_main_incoming DESC, d.created_at ASC
    `, [id]);
    const devices = devsR.rows;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="switchboard_${row.code || id}_report.pdf"`);
    
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Header amélioré
    doc.rect(0, 0, doc.page.width, 90).fill('#1e3a8a');
    doc.fill('white').fontSize(24).font('Helvetica-Bold').text('ElectroHub', 50, 25);
    doc.fontSize(16).text('Switchboard Technical Report', 50, 50);
    doc.fontSize(10).text(`Site: ${site} | ID: ${id} | Generated: ${new Date().toLocaleString()}`, 50, 70);
    doc.fill('#333');

    let y = 110;
    
    // Switchboard Details
    doc.fontSize(14).font('Helvetica-Bold').fill('#1e3a8a').text('📋 Switchboard Information', 50, y);
    y += 25;
    doc.font('Helvetica').fontSize(11).fill('#333');
    
    const sbDetails = [
      ['Name', row.name],
      ['Code', row.code],
      ['Location', `${row.building_code || 'N/A'} / ${row.floor || 'N/A'} / ${row.room || 'N/A'}`],
      ['Neutral Regime', row.regime_neutral || 'N/A'],
      ['Type', row.is_principal ? 'Principal' : 'Distribution'],
      ['Total Devices', devices.length]
    ];
    
    sbDetails.forEach(([k, v]) => {
      doc.text(`${k}:`, 60, y, { width: 120, continued: true });
      doc.text(v, 180, y);
      y += 18;
    });

    y += 30;
    doc.fontSize(14).font('Helvetica-Bold').fill('#1e3a8a').text('🔌 Connected Devices', 50, y);
    y += 25;
    
    if (devices.length === 0) {
      doc.fontSize(11).text('No devices configured', 60, y);
    } else {
      // Group by main incoming vs regular
      const mains = devices.filter(d => d.is_main_incoming);
      const regulars = devices.filter(d => !d.is_main_incoming);
      
      if (mains.length > 0) {
        y += 5;
        doc.fontSize(12).font('Helvetica-Bold').text('Main Incoming Devices', 60, y);
        y += 20;
        
        mains.forEach(d => {
          doc.fontSize(11).font('Helvetica-Bold').text(`• ${d.manufacturer || 'N/A'} ${d.reference || 'N/A'}`, 60, y);
          y += 15;
          doc.font('Helvetica').text(`  Type: ${d.device_type} | Rating: ${d.in_amps || 'N/A'}A | Poles: ${d.poles || 'N/A'}`, 60, y);
          if (d.parent_name) {
            doc.text(`  Upstream: ${d.parent_name}`, 60, y + 15);
            y += 15;
          }
          y += 10;
        });
      }
      
      if (regulars.length > 0) {
        y += 10;
        doc.fontSize(12).font('Helvetica-Bold').text('Protection & Distribution Devices', 60, y);
        y += 20;
        
        regulars.forEach((d, idx) => {
          if (y > 750) { doc.addPage(); y = 50; } // Pagination
          
          doc.fontSize(10).font('Helvetica').text(`${idx + 1}. ${d.manufacturer || 'N/A'} ${d.reference || 'N/A'}`, 60, y);
          y += 12;
          doc.text(`   ${d.device_type} | ${d.in_amps || 'N/A'}A | Icu: ${d.icu_ka || 'N/A'}kA | ${d.poles || 'N/A'}P`, 70, y);
          
          if (d.settings && (d.settings.ir || d.settings.curve_type)) {
            y += 12;
            const settingsStr = [
              d.settings.curve_type ? `Curve: ${d.settings.curve_type}` : null,
              d.settings.ir ? `Ir: ${d.settings.ir}xIn` : null,
              d.settings.isd ? `Isd: ${d.settings.isd}xIr` : null
            ].filter(Boolean).join(' | ');
            
            if (settingsStr) {
              doc.text(`   Settings: ${settingsStr}`, 70, y);
              y += 12;
            }
          }
          
          if (idx < regulars.length - 1) y += 5;
        });
      }
    }

    // Footer
    y = doc.page.height - 60;
    doc.fontSize(8).fill('#666').text('Generated by ElectroHub • For internal use only', 50, y);
    
    doc.end();
  } catch (e) {
    console.error('[REPORT] error:', e.message);
    res.status(500).json({ error: 'Report failed' });
  }
});

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => console.log(`Switchboard service running on :${port}`));
