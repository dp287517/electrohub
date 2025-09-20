// server_switchboard.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';  // Add dependency: npm install openai

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// SQL bootstrap (idempotent)
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
      modes JSONB DEFAULT '{}'::jsonb,
      quality JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_switchboards_site ON switchboards(site);
    CREATE INDEX IF NOT EXISTS idx_switchboards_building ON switchboards(building_code);
    CREATE INDEX IF NOT EXISTS idx_switchboards_code ON switchboards(code);
    
    CREATE TABLE IF NOT EXISTS protective_devices (
      id SERIAL PRIMARY KEY,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES protective_devices(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      rating NUMERIC NOT NULL,
      voltage_level TEXT NOT NULL DEFAULT 'LV',
      icu NUMERIC,
      ics NUMERIC,
      settings JSONB DEFAULT '{}'::jsonb,
      is_main BOOLEAN DEFAULT FALSE,
      pv_tests BYTEA,
      photos BYTEA[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_devices_switchboard ON protective_devices(switchboard_id);
    CREATE INDEX IF NOT EXISTS idx_devices_parent ON protective_devices(parent_id);
  `);
}
ensureSchema().catch(e=>console.error('[SWITCHBOARD SCHEMA]', e.message));

// LIST Switchboards
app.get('/api/switchboard/boards', async (req, res) => {
  // ... (same as before)
});

// GET ONE Switchboard
app.get('/api/switchboard/boards/:id', async (req, res) => {
  // ... (same as before)
});

// CREATE Switchboard
app.post('/api/switchboard/boards', async (req, res) => {
  // ... (same as before)
});

// UPDATE Switchboard
app.put('/api/switchboard/boards/:id', async (req, res) => {
  // ... (same as before)
});

// DUPLICATE Switchboard
app.post('/api/switchboard/boards/:id/duplicate', async (req, res) => {
  // ... (same as before, but also duplicate devices if needed - for simplicity, not duplicating devices here)
});

// DELETE Switchboard
app.delete('/api/switchboard/boards/:id', async (req, res) => {
  // ... (same as before)
});

// LIST Devices for a switchboard
app.get('/api/switchboard/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    const switchboard_id = Number(req.query.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    // Verify switchboard belongs to site
    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
      `SELECT * FROM protective_devices WHERE switchboard_id=$1 ORDER BY created_at DESC`,
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
      `SELECT pd.* FROM protective_devices pd
       JOIN switchboards sb ON pd.switchboard_id = sb.id
       WHERE pd.id=$1 AND sb.site=$2`,
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
    const b = req.body;
    const switchboard_id = Number(b.switchboard_id);
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    // Verify switchboard
    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE id=$1 AND site=$2', [switchboard_id, site]);
    if (!sbCheck.rows.length) return res.status(404).json({ error: 'Switchboard not found' });

    const { rows } = await pool.query(
      `INSERT INTO protective_devices (
        switchboard_id, parent_id, name, type, rating, voltage_level, icu, ics, settings, is_main, pv_tests, photos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        switchboard_id, b.parent_id || null, b.name, b.type, b.rating, b.voltage_level, b.icu, b.ics,
        b.settings || {}, b.is_main || false, b.pv_tests || null, b.photos || []
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
    const b = req.body;

    const r = await pool.query(
      `UPDATE protective_devices pd
       SET name=$1, type=$2, rating=$3, voltage_level=$4, icu=$5, ics=$6, settings=$7, is_main=$8,
           parent_id=$9, pv_tests=$10, photos=$11, updated_at=NOW()
       FROM switchboards sb
       WHERE pd.id=$12 AND pd.switchboard_id = sb.id AND sb.site=$13
       RETURNING pd.*`,
      [
        b.name, b.type, b.rating, b.voltage_level, b.icu, b.ics, b.settings || {}, b.is_main,
        b.parent_id || null, b.pv_tests || null, b.photos || [], id, site
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
      `INSERT INTO protective_devices (
        switchboard_id, parent_id, name, type, rating, voltage_level, icu, ics, settings, is_main, pv_tests, photos
      ) SELECT switchboard_id, parent_id, name || ' (copy)', type, rating, voltage_level, icu, ics, settings, FALSE, pv_tests, photos
        FROM protective_devices pd
        JOIN switchboards sb ON pd.switchboard_id = sb.id
        WHERE pd.id=$1 AND sb.site=$2
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
      `DELETE FROM protective_devices pd
       USING switchboards sb
       WHERE pd.id=$1 AND pd.switchboard_id = sb.id AND sb.site=$2`,
      [id, site]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error('[DEVICES DELETE] error:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Set Main for Device (quick update)
app.put('/api/switchboard/devices/:id/set-main', async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const is_main = !!req.body.is_main;

    const r = await pool.query(
      `UPDATE protective_devices pd
       SET is_main=$1, updated_at=NOW()
       FROM switchboards sb
       WHERE pd.id=$2 AND pd.switchboard_id = sb.id AND sb.site=$3
       RETURNING pd.*`,
      [is_main, id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES SET MAIN] error:', e.message);
    res.status(500).json({ error: 'Set main failed' });
  }
});

// Search Device References (using OpenAI for intelligent search/summary)
app.post('/api/switchboard/search-device', async (req, res) => {
  try {
    const query = req.body.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert in electrical protective devices. Provide references, brands, specifications for the query, focusing on Icu, Ics, TCC, LSIG settings for selectivity, fault level, arc flash.' },
        { role: 'user', content: query }
      ],
    });

    const results = completion.choices[0].message.content.split('\n').map(line => ({
      title: line.split(':')[0],
      snippet: line,
      link: ''  // Could web search for links
    }));

    res.json({ results });
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => console.log(`Switchboard service running on :${port}`));
