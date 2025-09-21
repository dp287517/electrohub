// server_switchboard.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI - avec fallback si pas disponible
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[SWITCHBOARD] OpenAI initialized with key');
    // Test rapide (tolerant aux erreurs)
    try {
      const test = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 5
      });
      console.log('[SWITCHBOARD] OpenAI test OK');
    } catch (testError) {
      console.error('[SWITCHBOARD] OpenAI test failed:', testError.message);
      openaiError = testError.message;
    }
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
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

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
app.get('/api/switchboard/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || '').toString();
}

const WHITELIST_SORT = ['created_at','name','code','building_code','floor'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'created_at'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// SQL bootstrap (ajout downstream_switchboard_id + name pour devices)
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
      name TEXT,  -- <== ajouté
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
  `);

  // si la table devices existait déjà sans 'name', on l'ajoute
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS name TEXT;`);
}
ensureSchema().catch(e=>console.error('[SWITCHBOARD SCHEMA]', e.message));

// LIST Switchboards
app.get('/api/switchboard/boards', async (req, res) => {
  try {
    const site = siteOf(req);
    const { q, building, floor, room, sort='created_at', dir='desc', page='1', pageSize='18' } = req.query;
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
    const b = req.body || {};
    const name = String(b.name||'').trim();
    const code = String(b.code||'').trim();
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!name || !code) return res.status(400).json({ error: 'Missing name/code' });

    const building = b?.meta?.building_code || null;
    const floor = b?.meta?.floor || null;
    const room = b?.meta?.room || null;
    const regime = b?.regime_neutral || null;
    const is_principal = !!b?.is_principal;
    const modes = b?.modes || {};
    const quality = b?.quality || {};

    const r = await pool.query(
      `INSERT INTO switchboards (site,name,code,building_code,floor,room,regime_neutral,is_principal,modes,quality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
    const id = Number(req.params.id);
    const b = req.body || {};
    const name = String(b.name||'').trim();
    const code = String(b.code||'').trim();
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
    const id = Number(req.params.id);
    const r = await pool.query(
      `INSERT INTO switchboards (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality)
       SELECT site, name || ' (copy)', code || '_C', building_code, floor, room, regime_neutral, FALSE, modes, quality
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
    const id = Number(req.params.id);
    const r = await pool.query(`DELETE FROM switchboards WHERE id=$1 AND site=$2`, [id, site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[SWITCHBOARD DELETE] error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// LIST Devices
app.get('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
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

// Helpers robustesse fichiers (évite 500 si front envoie File/objet)
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
    const b = req.body || {};
    const switchboard_id = Number(b.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT site FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });
    const device_site = sbCheck.rows[0].site;

    const safePV = coercePVTests(b.pv_tests);
    const safePhotos = coercePhotos(b.photos);

    const { rows } = await pool.query(
      `INSERT INTO devices (
        site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        device_site, switchboard_id, b.parent_id || null, b.downstream_switchboard_id || null,
        b.name || null, b.device_type, b.manufacturer, b.reference, b.in_amps, b.icu_kA, b.ics_kA,
        b.poles, b.voltage_V, b.trip_unit, b.settings || {}, b.is_main_incoming || false, safePV, safePhotos
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
    const id = Number(req.params.id);
    const b = req.body || {};

    const safePV = coercePVTests(b.pv_tests);
    const safePhotos = coercePhotos(b.photos);

    const r = await pool.query(
      `UPDATE devices d
       SET name=$1, device_type=$2, manufacturer=$3, reference=$4, in_amps=$5, icu_kA=$6, ics_kA=$7, poles=$8, voltage_V=$9, trip_unit=$10,
           settings=$11, is_main_incoming=$12, parent_id=$13, downstream_switchboard_id=$14, pv_tests=$15, photos=$16, updated_at=NOW()
       FROM switchboards sb
       WHERE d.id=$17 AND d.switchboard_id = sb.id AND sb.site=$18
       RETURNING d.*`,
      [
        b.name || null, b.device_type, b.manufacturer, b.reference, b.in_amps, b.icu_kA, b.ics_kA, b.poles, b.voltage_V, b.trip_unit,
        b.settings || {}, !!b.is_main_incoming, b.parent_id || null, b.downstream_switchboard_id || null, safePV, safePhotos, id, site
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES UPDATE] error:', e.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DUPLICATE Device
app.post('/api/switchboard/devices/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);

    const r = await pool.query(
      `INSERT INTO devices (
        site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos
      ) SELECT sb.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id,
               COALESCE(d.name, d.reference) || ' (copy)', d.device_type, d.manufacturer, d.reference || ' (copy)', d.in_amps, d.icu_kA, d.ics_kA, d.poles, d.voltage_V, d.trip_unit, d.settings, FALSE, d.pv_tests, d.photos
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

// Set Main Incoming for Device
app.put('/api/switchboard/devices/:id/set-main', async (req, res) => {
  try {
    const site = siteOf(req);
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

// List Unique Device References (for quick select)
app.get('/api/switchboard/device-references', async (req, res) => {
  try {
    const site = siteOf(req);
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

// Search Device References (OpenAI)
app.post('/api/switchboard/search-device', async (req, res) => {
  try {
    const query = req.body.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    if (!openai) {
      return res.json({ 
        error: 'OpenAI not available',
        suggestion: 'Install "openai" package or check API key'
      });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert in electrical protective devices. For the query (brand + reference), return structured JSON with fields: manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings (LSIG params + curve_type if applicable e.g. "B", "C", "D" for MCB or detailed TCC data), is_main_incoming (guess), other specs. If chat-like, continue conversation. Output ONLY valid JSON.' 
        },
        { role: 'user', content: query }
      ],
      response_format: { type: 'json_object' }
    });

    const jsonResponse = JSON.parse(completion.choices[0].message.content);
    res.json(jsonResponse);
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

// GRAPH endpoint (hiérarchie récursive + liaisons downstream)
app.get('/api/switchboard/boards/:id/graph', async (req, res) => {
  try {
    const site = siteOf(req);
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
        if (node.downstream_switchboard_id) {
          node.downstream = await buildTree(node.downstream_switchboard_id);
        }
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

const port = process.env.SWITCHBOARD_PORT || 3003; // Use Render's PORT
app.listen(port, () => console.log(`Switchboard service running on :${port}`));
