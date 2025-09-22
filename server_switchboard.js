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

// Schema
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
      icu_kA NUMERIC,
      ics_kA NUMERIC,
      poles INTEGER,
      voltage_V NUMERIC,
      trip_unit TEXT,
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

    ALTER TABLE devices ADD COLUMN IF NOT EXISTS name TEXT;
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

// LIST Devices
app.get('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const switchboard_id = Number(req.query.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
      `SELECT * FROM devices WHERE switchboard_id=$1 ORDER BY created_at DESC`,
      [switchboard_id]
    );
    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICES LIST] error:', e.message);
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
      `SELECT d.* FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.id=$1 AND sb.site=$2`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES GET] error:', e.message);
    res.status(500).json({ error: 'Get failed' });
  }
});

// Coerce helpers
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
    const device_site = sbCheck.rows[0].site;

    const safePV = coercePVTests(b.pv_tests);
    const safePhotos = coercePhotos(b.photos);

    const { rows } = await pool.query(
      `INSERT INTO devices (site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [device_site, switchboard_id, b.parent_id || null, b.downstream_switchboard_id || null, b.name || null, b.device_type, b.manufacturer || null, b.reference || null,
       b.in_amps || null, b.icu_kA || null, b.ics_kA || null, b.poles || null, b.voltage_V || null, b.trip_unit || null, b.settings || {}, !!b.is_main_incoming, safePV, safePhotos]
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
    const safePV = coercePVTests(b.pv_tests);
    const safePhotos = coercePhotos(b.photos);

    const { rows } = await pool.query(
      `UPDATE devices SET
        parent_id=$1, downstream_switchboard_id=$2, name=$3, device_type=$4, manufacturer=$5, reference=$6, in_amps=$7, icu_kA=$8, ics_kA=$9, poles=$10, voltage_V=$11, trip_unit=$12, settings=$13, is_main_incoming=$14, pv_tests=$15, photos=$16, updated_at=NOW()
       FROM switchboards sb
       WHERE devices.id=$17 AND devices.switchboard_id = sb.id AND sb.site=$18
       RETURNING devices.*`,
      [b.parent_id || null, b.downstream_switchboard_id || null, b.name || null, b.device_type, b.manufacturer || null, b.reference || null,
       b.in_amps || null, b.icu_kA || null, b.ics_kA || null, b.poles || null, b.voltage_V || null, b.trip_unit || null, b.settings || {}, !!b.is_main_incoming, safePV, safePhotos, id, site]
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
      `INSERT INTO devices (site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos)
       SELECT sb.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id,
              COALESCE(d.name, d.reference) || ' (copy)', d.device_type, d.manufacturer, COALESCE(d.reference, 'Device') || ' (copy)',
              d.in_amps, d.icu_kA, d.ics_kA, d.poles, d.voltage_V, d.trip_unit, d.settings, FALSE, d.pv_tests, d.photos
       FROM devices d
       JOIN switchboards sb ON d.switchboard_id = sb.id
       WHERE d.id=$1 AND sb.site=$2
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

    const r = await pool.query(
      `DELETE FROM devices d
       USING switchboards sb
       WHERE d.id=$1 AND d.switchboard_id = sb.id AND sb.site=$2`,
      [id, site]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[DEVICES DELETE] error:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Set Main Incoming
app.put('/api/switchboard/devices/:id/set-main', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const is_main_incoming = !!req.body.is_main_incoming;

    const r = await pool.query(
      `UPDATE devices d
       SET is_main_incoming=$1, updated_at=NOW()
       FROM switchboards sb
       WHERE d.id=$2 AND d.switchboard_id = sb.id AND sb.site=$3
       RETURNING d.*`,
      [is_main_incoming, id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES SET MAIN] error:', e.message);
    res.status(500).json({ error: 'Set main failed' });
  }
});

// Unique Device References
app.get('/api/switchboard/device-references', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { rows } = await pool.query(
      `SELECT DISTINCT manufacturer, reference FROM devices WHERE site=$1 AND manufacturer IS NOT NULL AND reference IS NOT NULL ORDER BY manufacturer, reference`,
      [site]
    );
    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICE REFERENCES] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// Search Device (OpenAI)
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
          content: 'You are an expert in electrical protective devices. For the query, return structured JSON with fields: manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings (LSIG params + curve_type). Output ONLY valid JSON.' 
        },
        { role: 'user', content: query }
      ],
      response_format: { type: 'json_object' }
    });

    const jsonResponse = JSON.parse(completion.choices[0].message.content);
    res.json(jsonResponse);
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
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

// ---- SEARCH ENDPOINTS ----
app.get('/api/switchboard/search-parents', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { query = '', switchboard_id } = req.query;
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const { rows } = await pool.query(
      `SELECT id, name, device_type, manufacturer, reference, in_amps
       FROM devices 
       WHERE switchboard_id = $1 AND site = $2 
       AND ($3 = '' OR name ILIKE $3 OR reference ILIKE $3 OR manufacturer ILIKE $3)
       ORDER BY name, reference 
       LIMIT 10`,
      [switchboard_id, site, `%${query}%`]
    );
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH PARENTS] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/switchboard/search-downstreams', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { query = '' } = req.query;

    const { rows } = await pool.query(
      `SELECT id, name, code, building_code 
       FROM switchboards 
       WHERE site = $1 AND ($2 = '' OR name ILIKE $2 OR code ILIKE $2 OR building_code ILIKE $2)
       ORDER BY name 
       LIMIT 10`,
      [site, `%${query}%`]
    );
    res.json({ suggestions: rows });
  } catch (e) {
    console.error('[SEARCH DOWNSTREAMS] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/switchboard/search-references', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { query = '' } = req.query;

    if (!query.trim()) return res.json({ suggestions: [], auto_fill: null });

    const { rows } = await pool.query(
      `SELECT DISTINCT manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings
       FROM devices 
       WHERE site = $1 AND (manufacturer ILIKE $2 OR reference ILIKE $2)
       ORDER BY manufacturer, reference 
       LIMIT 10`,
      [site, `%${query}%`]
    );

    // Auto-fill if exact match
    const exactMatch = rows.find(r => r.reference?.toLowerCase() === query.toLowerCase() || r.manufacturer?.toLowerCase() === query.toLowerCase());

    res.json({ 
      suggestions: rows,
      auto_fill: exactMatch ? {
        manufacturer: exactMatch.manufacturer,
        reference: exactMatch.reference,
        device_type: exactMatch.device_type,
        in_amps: exactMatch.in_amps,
        icu_kA: exactMatch.icu_kA,
        ics_kA: exactMatch.ics_kA,
        poles: exactMatch.poles,
        voltage_V: exactMatch.voltage_V,
        trip_unit: exactMatch.trip_unit,
        settings: exactMatch.settings || { curve_type: 'C' }
      } : null 
    });
  } catch (e) {
    console.error('[SEARCH REFERENCES] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ---- PHOTO ANALYSIS ----
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

    // Vision description
    const descriptionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You output ONLY valid JSON. No markdown fences, no prose.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this electrical device image. Extract: manufacturer, reference, device_type, in_amps, poles, voltage_V, description. JSON only.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300
    });

    let description;
    try {
      description = safeJsonParse(descriptionResponse.choices[0].message.content);
    } catch (parseErr) {
      console.error('[PHOTO] Parse error:', parseErr);
      return res.status(500).json({ error: 'Failed to parse photo description' });
    }

    // Search existing (manufacturer/reference)
    const { rows: existing } = await pool.query(
      `SELECT * FROM devices WHERE site = $1 
       AND (manufacturer ILIKE $2 OR reference ILIKE $3) 
       LIMIT 1`,
      [site, `%${description.manufacturer || ''}%`, `%${description.reference || ''}%`]
    );

    // Always ask AI to produce full specs from description
    const createResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Generate full device specs JSON from description. Include device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings {ir,tr,isd,curve_type}. Output ONLY valid JSON.' },
        { role: 'user', content: JSON.stringify(description) }
      ],
      response_format: { type: 'json_object' }
    });

    let specs;
    try {
      specs = safeJsonParse(createResponse.choices[0].message.content);
    } catch (parseErr) {
      console.error('[PHOTO] Specs parse error:', parseErr);
      return res.status(500).json({ error: 'Failed to parse device specs' });
    }

    if (existing.length > 0) {
      // merge missing fields into existing record for the response
      const cur = existing[0];
      const merged = {
        ...cur,
        device_type: cur.device_type || specs.device_type || 'Low Voltage Circuit Breaker',
        in_amps: cur.in_amps ?? specs.in_amps ?? 0,
        icu_kA: cur.icu_kA ?? specs.icu_kA ?? 0,
        ics_kA: cur.ics_kA ?? specs.ics_kA ?? 0,
        poles: cur.poles ?? specs.poles ?? 3,
        voltage_V: cur.voltage_V ?? specs.voltage_V ?? 400,
        trip_unit: cur.trip_unit || specs.trip_unit || '',
        settings: { ...(cur.settings || {}), ...(specs.settings || {}) }
      };
      return res.json({ ...merged, existing_id: cur.id, matched: true, photo_description: description.description });
    }

    if (switchboardId) {
      const { rows: [newDevice] } = await pool.query(
        `INSERT INTO devices (site, switchboard_id, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [deviceSite, switchboardId, specs.device_type || 'Low Voltage Circuit Breaker', 
         specs.manufacturer || description.manufacturer, specs.reference || description.reference,
         specs.in_amps || 0, specs.icu_kA || 0, specs.ics_kA || 0, specs.poles || 3, 
         specs.voltage_V || 400, specs.trip_unit || '', specs.settings || {}]
      );
      return res.json({ ...newDevice, created: true, photo_description: description.description });
    } else {
      return res.json({ ...specs, created: false, requires_switchboard: true, photo_description: description.description });
    }
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e.message);
    res.status(500).json({ error: 'Photo analysis failed', details: e.message });
  }
});

// ---- AI TIP ----
app.post('/api/switchboard/ai-tip', async (req, res) => {
  try {
    if (!openai) return res.json({ tip: 'AI tips unavailable' });

    const { query } = req.body;
    const context = query || 'General advice';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Provide short, helpful electrical engineering advice (1-2 sentences).' },
        { role: 'user', content: context }
      ],
      max_tokens: 100
    });

    const tip = completion.choices[0].message.content.trim();
    res.json({ tip });
  } catch (e) {
    console.error('[AI TIP] error:', e.message);
    res.status(500).json({ error: 'AI tip failed' });
  }
});

// ---- REPORT (PDF) ----
app.get('/api/switchboard/boards/:id/report', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    
    // Switchboard details
    const sbR = await pool.query('SELECT * FROM switchboards WHERE id=$1 AND site=$2', [id, site]);
    const row = sbR.rows[0];
    if (!row) return res.status(404).json({ error: 'Switchboard not found' });

    // Build device tree with relationships
    const buildDeviceTree = async (switchboardId) => {
      const { rows: devs } = await pool.query('SELECT * FROM devices WHERE switchboard_id=$1 ORDER BY created_at ASC', [switchboardId]);
      const byId = new Map(devs.map(d => [d.id, { ...d, children: [], parent: null }]));
      
      // Build parent-child relationships
      for (const d of devs) {
        const node = byId.get(d.id);
        if (d.parent_id && byId.has(d.parent_id)) {
          byId.get(d.parent_id).children.push(node);
          node.parent = byId.get(d.parent_id);
        }
      }
      
      // Roots are devices without parents
      const roots = devs.filter(d => !d.parent_id).map(d => byId.get(d.id));
      
      // Add downstream switchboards if any
      for (const node of byId.values()) {
        if (node.downstream_switchboard_id) {
          const downstreamTree = await buildDeviceTree(node.downstream_switchboard_id);
          node.downstream = downstreamTree;
        }
      }
      
      return { switchboard_id: switchboardId, devices: roots };
    };

    const tree = await buildDeviceTree(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="switchboard_${id}_report.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill('#eef7ff');
    doc.fill('#0f3e99').fontSize(24).font('Helvetica-Bold').text('ElectroHub Switchboard Report', 50, 25);
    doc.fontSize(12).text(`ID: ${id} | Date: ${new Date().toLocaleString()}`, 50, 55);
    doc.fill('#333');

    let y = 100;
    doc.fontSize(14).font('Helvetica-Bold').text('Switchboard Details', 50, y);
    y += 20;
    doc.font('Helvetica').fontSize(11);
    const sbDetails = [
      ['Name', row.name],
      ['Code', row.code],
      ['Building/Floor/Room', `${row.building_code || '—'} / ${row.floor || '—'} / ${row.room || '—'}`],
      ['Neutral Regime', row.regime_neutral],
      ['Principal', row.is_principal ? 'Yes' : 'No']
    ];
    sbDetails.forEach(([k, v], idx) => {
      doc.text(k, 50, y, { width: 150 });
      doc.text(v, 200, y);
      y += 15;
    });

    y += 30;
    doc.font('Helvetica-Bold').fontSize(14).text('Devices Hierarchy', 50, y);
    y += 20;

    if (tree.devices.length === 0) {
      doc.text('No devices', 50, y);
    } else {
      // Recursive function to draw tree
      const drawTree = (devices, level = 0) => {
        for (const device of devices) {
          doc.font('Helvetica-Bold').fontSize(12).text(device.name || 'Unnamed', 50 + level * 20, y);
          y += 15;
          doc.fontSize(11).text(`Type: ${device.device_type} | Reference: ${device.reference} | Amps: ${device.in_amps}`, 50 + level * 20, y);
          y += 15;
          doc.text(`Poles: ${device.poles} | Voltage: ${device.voltage_V}V | Icu: ${device.icu_kA}kA | Ics: ${device.ics_kA}kA`, 50 + level * 20, y);
          y += 20;
          
          if (device.children.length > 0) {
            doc.text('Children:', 50 + level * 20, y);
            y += 15;
            drawTree(device.children, level + 1);
          }
          
          if (device.downstream) {
            doc.text('Downstream Switchboard:', 50 + level * 20, y);
            y += 15;
            drawTree(device.downstream.devices, level + 1);
          }
        }
      };

      drawTree(tree.devices);
    }

    doc.end();
  } catch (e) {
    console.error('[REPORT] error:', e.message);
    res.status(500).json({ error: 'Report failed' });
  }
});

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => console.log(`Switchboard service running on :${port}`));
