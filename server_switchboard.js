// server_switchboard.js (FULL)
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

/* ========================= OpenAI (facultatif) ========================= */
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[SWITCHBOARD] OpenAI initialized with key');
    // Test rapide (tolérant aux erreurs)
    (async () => {
      try {
        await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5
        });
        console.log('[SWITCHBOARD] OpenAI test OK');
      } catch (testError) {
        console.error('[SWITCHBOARD] OpenAI test failed:', testError.message);
        openaiError = testError.message;
      }
    })();
  } catch (e) {
    console.warn('[SWITCHBOARD] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[SWITCHBOARD] No OPENAI_API_KEY found');
  openaiError = 'No API key';
}

/* ========================= App & middlewares ========================= */
const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
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

/* ========================= Schema (safe-migrations) ========================= */
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
      position_number TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard ON devices(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_devices_parent ON devices(parent_id);
    CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site);
    CREATE INDEX IF NOT EXISTS idx_devices_reference ON devices(reference);
  `);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS position_number TEXT;`);
}
ensureSchema().catch(e=>console.error('[SWITCHBOARD SCHEMA]', e.message));

/* ========================= SWITCHBOARDS ========================= */

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

/* ========================= DEVICES ========================= */

// Robust file coercion
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

// LIST Devices (tri par numéro, avec infos parent/downstream)
app.get('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    const switchboard_id = Number(req.query.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
      `
      SELECT d.*,
             parent.reference AS parent_reference,
             parent.name      AS parent_name,
             dsb.code         AS downstream_code
      FROM devices d
      LEFT JOIN devices parent ON parent.id = d.parent_id
      LEFT JOIN switchboards dsb ON dsb.id = d.downstream_switchboard_id
      WHERE d.switchboard_id=$1
      ORDER BY
        CASE WHEN (d.settings->>'position') ~ '^[0-9]+$' THEN (d.settings->>'position')::int ELSE NULL END ASC NULLS LAST,
        CASE WHEN (d.settings->>'number')  ~ '^[0-9]+$' THEN (d.settings->>'number')::int  ELSE NULL END ASC NULLS LAST,
        d.position_number ASC NULLS LAST,
        d.created_at ASC
      `,
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
        site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos, position_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        device_site, switchboard_id, b.parent_id || null, b.downstream_switchboard_id || null,
        b.name || null, b.device_type, b.manufacturer, b.reference, b.in_amps, b.icu_kA, b.ics_kA,
        b.poles, b.voltage_V, b.trip_unit, b.settings || {}, b.is_main_incoming || false, safePV, safePhotos, b.position_number || null
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
           settings=$11, is_main_incoming=$12, parent_id=$13, downstream_switchboard_id=$14, pv_tests=$15, photos=$16, position_number=$17, updated_at=NOW()
       FROM switchboards sb
       WHERE d.id=$18 AND d.switchboard_id = sb.id AND sb.site=$19
       RETURNING d.*`,
      [
        b.name || null, b.device_type, b.manufacturer, b.reference, b.in_amps, b.icu_kA, b.ics_kA, b.poles, b.voltage_V, b.trip_unit,
        b.settings || {}, !!b.is_main_incoming, b.parent_id || null, b.downstream_switchboard_id || null, safePV, safePhotos, b.position_number || null, id, site
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
        site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos, position_number
      ) SELECT sb.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id,
               COALESCE(d.name, d.reference) || ' (copy)', d.device_type, d.manufacturer, d.reference || ' (copy)', d.in_amps, d.icu_kA, d.ics_kA, d.poles, d.voltage_V, d.trip_unit, d.settings, FALSE, d.pv_tests, d.photos, d.position_number
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
      `SELECT DISTINCT manufacturer, reference
       FROM devices
       WHERE site=$1 AND manufacturer IS NOT NULL AND reference IS NOT NULL
       ORDER BY manufacturer, reference`,
      [site]
    );
    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICE REFERENCES] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

/* ======= NEW: Bulk operations ======= */

// Bulk Delete
app.post('/api/switchboard/devices/bulk-delete', async (req, res) => {
  try {
    const site = siteOf(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => Number(n)).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'No ids' });

    const r = await pool.query(
      `DELETE FROM devices d USING switchboards sb
       WHERE d.switchboard_id = sb.id AND sb.site=$1 AND d.id = ANY($2::int[])`,
      [site, ids]
    );
    res.json({ success: true, deleted: r.rowCount });
  } catch (e) {
    console.error('[BULK DELETE] error:', e.message);
    res.status(500).json({ error: 'Bulk delete failed' });
  }
});

// Bulk Duplicate
app.post('/api/switchboard/devices/bulk-duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => Number(n)).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'No ids' });

    const r = await pool.query(
      `INSERT INTO devices (
        site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos, position_number
      )
      SELECT sb.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id,
             COALESCE(d.name, d.reference) || ' (copy)', d.device_type, d.manufacturer, d.reference || ' (copy)', d.in_amps, d.icu_kA, d.ics_kA,
             d.poles, d.voltage_V, d.trip_unit, d.settings, FALSE, d.pv_tests, d.photos, d.position_number
      FROM devices d
      JOIN switchboards sb ON d.switchboard_id = sb.id
      WHERE d.id = ANY($1::int[]) AND sb.site=$2
      RETURNING id`,
      [ids, site]
    );
    res.json({ success: true, created: r.rowCount, ids: r.rows.map(r => r.id) });
  } catch (e) {
    console.error('[BULK DUPLICATE] error:', e.message);
    res.status(500).json({ error: 'Bulk duplicate failed' });
  }
});

/* ======= AI search ======= */

// Search Device References (OpenAI - texte)
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
          content:
            'You are an expert in electrical protective devices. For the query (brand + reference), return structured JSON with fields: manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings (LSIG params + curve_type if applicable), is_main_incoming (guess), position_number (if inferred). Output ONLY valid JSON.'
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

// Photo → Device (OpenAI Vision)
app.post('/api/switchboard/search-photo', async (req, res) => {
  try {
    const { image_base64, hint } = req.body || {};
    if (!image_base64) return res.status(400).json({ error: 'Missing image_base64' });

    if (!openai) {
      return res.json({
        error: 'OpenAI not available',
        suggestion: 'Install "openai" package or check API key'
      });
    }

    const imageUrl = `data:image/jpeg;base64,${image_base64}`;
    const messages = [
      {
        role: 'system',
        content:
          'You are an expert in identifying electrical protective devices from a photo. Return ONLY JSON with fields: manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming (guess), position_number (if visible), confidence (0-1).'
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: hint ? String(hint) : 'Identify the breaker from this photo and provide specs.' },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' }
    });

    const json = JSON.parse(completion.choices[0].message.content);

    // Tentative d’auto-match DB (same manufacturer + reference)
    let matched = null;
    if (json?.manufacturer && json?.reference) {
      const r = await pool.query(
        `SELECT * FROM devices WHERE site=$1 AND manufacturer ILIKE $2 AND reference ILIKE $3 LIMIT 1`,
        [siteOf(req), json.manufacturer, json.reference]
      );
      if (r.rows.length) matched = r.rows[0];
    }

    res.json({ ...json, match: matched ? { id: matched.id, switchboard_id: matched.switchboard_id } : null });
  } catch (e) {
    console.error('[SEARCH PHOTO] error:', e.message);
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

/* ======= NEW: Global text search (boards + devices) ======= */
app.get('/api/switchboard/search', async (req, res) => {
  try {
    const site = siteOf(req);
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ boards: [], devices: [] });

    const qb = `%${q}%`;
    const boards = await pool.query(
      `SELECT id, site, name, code, building_code, floor, room
       FROM switchboards
       WHERE site=$1 AND (name ILIKE $2 OR code ILIKE $2 OR building_code ILIKE $2 OR floor ILIKE $2 OR room ILIKE $2)
       ORDER BY name ASC
       LIMIT 50`,
      [site, qb]
    );

    const devs = await pool.query(
      `SELECT d.id, d.switchboard_id, d.device_type, d.manufacturer, d.reference, d.in_amps, d.settings
       FROM devices d
       JOIN switchboards sb ON sb.id = d.switchboard_id
       WHERE sb.site=$1 AND (
         d.manufacturer ILIKE $2 OR d.reference ILIKE $2 OR d.device_type ILIKE $2
         OR d.trip_unit ILIKE $2 OR (d.settings::text ILIKE $2)
       )
       ORDER BY d.created_at DESC
       LIMIT 100`,
      [site, qb]
    );

    res.json({
      boards: boards.rows.map(b => ({
        id: b.id,
        name: b.name,
        code: b.code,
        meta: { building_code: b.building_code, floor: b.floor, room: b.room }
      })),
      devices: devs.rows
    });
  } catch (e) {
    console.error('[GLOBAL SEARCH] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

/* ========================= GRAPH / REPORT ========================= */

// GRAPH (hiérarchie + downstream)
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

// REPORT (PDF)
app.get('/api/switchboard/boards/:id/report', async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);

    const rsb = await pool.query(`SELECT * FROM switchboards WHERE id=$1 AND site=$2`, [id, site]);
    if (!rsb.rows.length) return res.status(404).json({ error: 'Not found' });
    const sb = rsb.rows[0];

    const rdev = await pool.query(
      `
      SELECT d.*,
             parent.reference AS parent_reference,
             parent.name      AS parent_name,
             dsb.code         AS downstream_code
      FROM devices d
      LEFT JOIN devices parent ON parent.id = d.parent_id
      LEFT JOIN switchboards dsb ON dsb.id = d.downstream_switchboard_id
      WHERE d.switchboard_id=$1
      ORDER BY
        CASE WHEN (d.settings->>'position') ~ '^[0-9]+$' THEN (d.settings->>'position')::int ELSE NULL END ASC NULLS LAST,
        CASE WHEN (d.settings->>'number')  ~ '^[0-9]+$' THEN (d.settings->>'number')::int  ELSE NULL END ASC NULLS LAST,
        d.position_number ASC NULLS LAST,
        d.created_at ASC
      `,
      [id]
    );
    const devices = rdev.rows;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="switchboard_${sb.code || sb.name || id}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Bandeau
    doc.rect(0, 0, doc.page.width, 70).fill('#eef7ff');
    doc.fill('#0f3e99').fontSize(20).font('Helvetica-Bold').text('ElectroHub – Switchboard Report', 50, 25);
    doc.fill('#333').font('Helvetica');

    // Meta
    const y0 = 90;
    doc.fontSize(10)
      .text(`Report date: ${new Date().toLocaleString()}`, 50, y0)
      .text(`Name: ${sb.name}`, 50, y0 + 14)
      .text(`Code: ${sb.code}`, 50, y0 + 28)
      .text(`Location: ${[sb.building_code, sb.floor, sb.room].filter(Boolean).join(' / ') || '—'}`, 50, y0 + 42)
      .text(`Neutral regime: ${sb.regime_neutral || '—'}`, 50, y0 + 56)
      .text(`Principal: ${sb.is_principal ? 'Yes' : 'No'}`, 50, y0 + 70);

    // Devices
    let yy = y0 + 100;
    doc.fontSize(12).font('Helvetica-Bold').text('Devices (ordered by number)', 50, yy);
    yy += 14;

    doc.font('Helvetica').fontSize(10);
    const headers = ['#', 'Type', 'Manufacturer', 'Reference', 'In (A)', 'Icu (kA)', 'Ics (kA)', 'Poles', 'Voltage (V)', 'Trip', 'Parent', 'Downstream'];
    const X = [50, 80, 140, 210, 270, 310, 350, 385, 420, 455, 490, 525];
    const drawRow = (vals, y, shaded=false) => {
      if (shaded) doc.rect(45, y-2, 500, 16).fill('#f8fafc').fill('#333');
      vals.forEach((v, i) => doc.text(String(v ?? '—'), X[i], y, { width: (X[i+1] ?? 545) - X[i] - 6, ellipsis: true }));
    };
    drawRow(headers, yy, true); yy += 16;

    devices.forEach((d, idx) => {
      if (yy > 760) { doc.addPage(); yy = 50; }
      const num = (d.settings && (d.settings.position ?? d.settings.number)) ? (d.settings.position ?? d.settings.number) : (d.position_number ?? '');
      const vals = [
        num || '', d.device_type || '', d.manufacturer || '', d.reference || '',
        d.in_amps ?? '', d.icu_kA ?? '', d.ics_kA ?? '', d.poles ?? '', d.voltage_V ?? '',
        d.trip_unit ?? '', d.parent_name || d.parent_reference || '', d.downstream_code || ''
      ];
      drawRow(vals, yy, idx % 2 === 0); yy += 16;
    });

    // Hierarchy
    yy += 20;
    if (yy > 740) { doc.addPage(); yy = 50; }
    doc.font('Helvetica-Bold').fontSize(12).text('Hierarchy (Parent → Children)', 50, yy);
    yy += 16;
    doc.font('Helvetica').fontSize(10);

    const children = new Map();
    devices.forEach(d => { if (d.parent_id) { if (!children.has(d.parent_id)) children.set(d.parent_id, []); children.get(d.parent_id).push(d); } });
    const roots = devices.filter(d => !d.parent_id);

    const printNode = (node, depth=0) => {
      const bullet = '• '.padStart(depth*2 + 2, ' ');
      const line = `${bullet}${node.reference || node.name || node.device_type || 'Device'}  ${node.downstream_code ? `(→ SB ${node.downstream_code})` : ''}`;
      doc.text(line, 50, yy, { width: 500 }); yy += 14;
      const kids = children.get(node.id) || [];
      kids.forEach(k => { if (yy > 780) { doc.addPage(); yy = 50; } printNode(k, depth+1); });
    };
    roots.forEach(r => { if (yy > 780) { doc.addPage(); yy = 50; } printNode(r, 0); });

    // Footer
    doc.moveTo(50, 805).lineTo(545, 805).stroke('#e5e7eb');
    doc.fontSize(9).fill('#6b7280')
      .text('Generated by ElectroHub', 50, 810)
      .text(`Switchboard: ${sb.code || sb.name || id}`, 420, 810, { width: 175, align: 'right' });

    doc.end();
  } catch (e) {
    console.error('[SWITCHBOARD REPORT] error:', e.message);
    res.status(500).json({ error: 'Report failed' });
  }
});

/* ========================= START ========================= */
const port = process.env.SWITCHBOARD_PORT || 3003; // Use Render's PORT
app.listen(port, () => console.log(`Switchboard service running on :${port}`));
