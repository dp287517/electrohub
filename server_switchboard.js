// server_switchboard.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI setup with error handling
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
app.use(express.static('public')); // For temp photo uploads

// File upload setup
const storage = multer.memoryStorage();
const upload = multer({ storage });

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

// Schema setup
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS switchboards (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
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
    CREATE INDEX IF NOT EXISTS idx_switchboards_name ON switchboards(name);

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
    CREATE INDEX IF NOT EXISTS idx_devices_manufacturer ON devices(manufacturer);
    CREATE INDEX IF NOT EXISTS idx_devices_name ON devices(name);
  `);

  // Ensure name column exists
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS name TEXT;`);
  
  console.log('[SWITCHBOARD] Schema ready');
}
ensureSchema().catch(e => console.error('[SWITCHBOARD SCHEMA]', e.message));

// ---- SEARCH ENDPOINTS (for autocomplete) ----

// Search parents (devices in current switchboard)
app.get('/api/switchboard/search-parents', async (req, res) => {
  try {
    const site = siteOf(req);
    const { query = '', switchboard_id } = req.query;
    if (!switchboard_id) return res.status(400).json({ error: 'Missing switchboard_id' });

    const { rows } = await pool.query(
      `SELECT id, name, device_type, manufacturer, reference 
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

// Search downstream switchboards
app.get('/api/switchboard/search-downstreams', async (req, res) => {
  try {
    const site = siteOf(req);
    const { query = '' } = req.query;

    const { rows } = await pool.query(
      `SELECT id, name, code, building_code 
       FROM switchboards 
       WHERE site = $1 AND ($2 = '' OR name ILIKE $2 OR code ILIKE $2)
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

// Search device references (with auto-fill logic)
app.get('/api/switchboard/search-references', async (req, res) => {
  try {
    const site = siteOf(req);
    const { query = '' } = req.query;

    if (!query.trim()) {
      return res.json({ suggestions: [], auto_fill: null });
    }

    const { rows } = await pool.query(
      `SELECT DISTINCT manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit
       FROM devices 
       WHERE site = $1 AND (manufacturer ILIKE $2 OR reference ILIKE $2)
       ORDER BY manufacturer, reference 
       LIMIT 5`,
      [site, `%${query}%`]
    );

    // Auto-fill logic: if exact match found, return full data
    const exactMatch = rows.find(r => 
      r.manufacturer?.toLowerCase().includes(query.toLowerCase()) || 
      r.reference?.toLowerCase().includes(query.toLowerCase())
    );

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
        settings: { curve_type: 'C' } // Default curve
      } : null 
    });
  } catch (e) {
    console.error('[SEARCH REFERENCES] error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ---- PHOTO ANALYSIS ENDPOINT ----
app.post('/api/switchboard/analyze-photo', upload.single('photo'), async (req, res) => {
  try {
    if (!openai || !req.file) {
      return res.status(400).json({ error: 'OpenAI or file missing' });
    }

    const buffer = req.file.buffer;
    
    // Step 1: Describe the image using vision
    const descriptionResponse = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this electrical device in detail. Extract: manufacturer, model/reference, type (MCB, MCCB, etc.), rating (amps), poles, and any visible specs. Format as JSON: {manufacturer, reference, device_type, in_amps, poles, description}. Be precise about brand logos and model numbers.'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${req.file.mimetype};base64,${buffer.toString('base64')}`
              }
            }
          ]
        }
      ],
      max_tokens: 300
    });

    const description = JSON.parse(descriptionResponse.choices[0].message.content);
    console.log('[PHOTO ANALYSIS] Description:', description);

    // Step 2: Search for existing device match
    const site = siteOf(req);
    const { rows: existing } = await pool.query(
      `SELECT id, manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit
       FROM devices 
       WHERE site = $1 
       AND (manufacturer ILIKE $2 OR reference ILIKE $3)
       LIMIT 1`,
      [site, `%${description.manufacturer || ''}%`, `%${description.reference || ''}%`]
    );

    let result;
    if (existing.length > 0) {
      // Match found - return existing device
      const match = existing[0];
      result = {
        ...match,
        existing_id: match.id,
        matched: true,
        photo_description: description.description,
        settings: { curve_type: 'C', ir: match.in_amps ? match.in_amps / 1000 : 1 }
      };
      console.log('[PHOTO ANALYSIS] Matched existing device:', match.id);
    } else {
      // Step 3: Create new device via OpenAI specs
      const createResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'Based on this device description, provide complete specs in JSON format. Fill missing values with reasonable defaults for the device type. Fields: manufacturer, reference, device_type, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings {ir, tr, isd, tsd, ii, ig, tg, zsi, erms, curve_type}.' 
          },
          { role: 'user', content: JSON.stringify(description) }
        ],
        response_format: { type: 'json_object' }
      });

      const specs = JSON.parse(createResponse.choices[0].message.content);
      
      // Insert new device
      const { rows: [newDevice] } = await pool.query(
        `INSERT INTO devices (site, device_type, manufacturer, reference, in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          site, specs.device_type, specs.manufacturer, specs.reference,
          specs.in_amps, specs.icu_kA || 10, specs.ics_kA || 8,
          specs.poles || 3, specs.voltage_V || 400, specs.trip_unit,
          specs.settings || {}
        ]
      );

      result = {
        ...newDevice,
        created: true,
        photo_description: description.description,
        settings: specs.settings
      };
      console.log('[PHOTO ANALYSIS] Created new device:', newDevice.id);
    }

    res.json(result);
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e.message);
    res.status(500).json({ error: 'Photo analysis failed', details: e.message });
  }
});

// ---- AI TIP ENDPOINT ----
app.post('/api/switchboard/ai-tip', async (req, res) => {
  try {
    if (!openai) {
      return res.json({ error: 'OpenAI not available', tip: 'AI tips require OpenAI configuration.' });
    }

    const { query } = req.body;
    const context = query || 'General switchboard management advice';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful electrical engineering assistant. Provide concise, actionable advice (1-2 sentences) for switchboard management. Focus on best practices, safety, and next steps. Be encouraging and professional.' 
        },
        { role: 'user', content: `Context: ${context}. Provide a helpful tip.` }
      ],
      max_tokens: 100
    });

    const tip = completion.choices[0].message.content.trim();
    res.json({ tip });
  } catch (e) {
    console.error('[AI TIP] error:', e.message);
    res.status(500).json({ error: 'AI tip failed', tip: 'Unable to generate tip at this time.' });
  }
});

// ---- SWITCHBOARD ENDPOINTS ----
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

app.post('/api/switchboard/boards/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
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

// ---- DEVICE ENDPOINTS ----
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
        site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, 
        in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        device_site, switchboard_id, b.parent_id || null, b.downstream_switchboard_id || null,
        b.name || null, b.device_type, b.manufacturer, b.reference, 
        b.in_amps, b.icu_kA, b.ics_kA, b.poles, b.voltage_V, b.trip_unit, 
        b.settings || {}, b.is_main_incoming || false, safePV, safePhotos
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[DEVICES CREATE] error:', e.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

app.put('/api/switchboard/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);
    const b = req.body || {};

    const safePV = coercePVTests(b.pv_tests);
    const safePhotos = coercePhotos(b.photos);

    const r = await pool.query(
      `UPDATE devices d
       SET name=$1, device_type=$2, manufacturer=$3, reference=$4, in_amps=$5, icu_kA=$6, ics_kA=$7, poles=$8, 
           voltage_V=$9, trip_unit=$10, settings=$11, is_main_incoming=$12, parent_id=$13, 
           downstream_switchboard_id=$14, pv_tests=$15, photos=$16, updated_at=NOW()
       FROM switchboards sb
       WHERE d.id=$17 AND d.switchboard_id = sb.id AND sb.site=$18
       RETURNING d.*`,
      [
        b.name || null, b.device_type, b.manufacturer, b.reference, b.in_amps, b.icu_kA, b.ics_kA, 
        b.poles, b.voltage_V, b.trip_unit, b.settings || {}, !!b.is_main_incoming, 
        b.parent_id || null, b.downstream_switchboard_id || null, safePV, safePhotos, id, site
      ]
    );
    
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[DEVICES UPDATE] error:', e.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.post('/api/switchboard/devices/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req);
    const id = Number(req.params.id);

    const r = await pool.query(
      `INSERT INTO devices (
        site, switchboard_id, parent_id, downstream_switchboard_id, name, device_type, manufacturer, reference, 
        in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, settings, is_main_incoming, pv_tests, photos
      ) SELECT sb.site, d.switchboard_id, d.parent_id, d.downstream_switchboard_id,
               COALESCE(d.name, d.reference) || ' (copy)', d.device_type, d.manufacturer, d.reference || ' (copy)', 
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

app.get('/api/switchboard/device-references', async (req, res) => {
  try {
    const site = siteOf(req);
    const { rows } = await pool.query(
      `SELECT DISTINCT manufacturer, reference FROM devices 
       WHERE site=$1 AND manufacturer IS NOT NULL AND reference IS NOT NULL 
       ORDER BY manufacturer, reference LIMIT 100`,
      [site]
    );
    res.json({ data: rows });
  } catch (e) {
    console.error('[DEVICE REFERENCES] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// Search device with OpenAI
app.post('/api/switchboard/search-device', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    if (!openai) {
      return res.json({ 
        error: 'OpenAI not available',
        suggestion: 'Check API key configuration'
      });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in electrical protective devices. For the query "${query}", return structured JSON with fields: 
          manufacturer, reference, device_type (from: High Voltage Cell, High Voltage Disconnect Switch, High Voltage Circuit Breaker, Transformer, Low Voltage Switchboard, Low Voltage Circuit Breaker, MCCB, ACB, MCB, Fuse, Relay), 
          in_amps, icu_kA, ics_kA, poles, voltage_V, trip_unit, 
          settings (object with: ir, tr, isd, tsd, ii, ig, tg, zsi (boolean), erms (boolean), curve_type (B/C/D or description)), 
          is_main_incoming (boolean guess). 
          Use reasonable defaults for missing values. Output ONLY valid JSON.` 
        },
        { role: 'user', content: query }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500
    });

    const jsonResponse = JSON.parse(completion.choices[0].message.content);
    res.json(jsonResponse);
  } catch (e) {
    console.error('[SEARCH DEVICE] error:', e.message);
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

// Graph endpoint
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
        if (d.parent_id && byId.has(d.parent_id)) {
          byId.get(d.parent_id).children.push(node);
        } else {
          roots.push(node);
        }
      }
      
      for (const node of byId.values()) {
        if (node.downstream_switchboard_id) {
          try {
            node.downstream = await buildTree(node.downstream_switchboard_id);
          } catch (e) {
            console.warn('[GRAPH] Downstream error:', e.message);
            node.downstream = null;
          }
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

// ---- PROFESSIONAL PDF REPORT ----
app.get('/api/switchboard/boards/:id/report', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const site = siteOf(req);
    
    // Get switchboard data
    const sbResult = await pool.query('SELECT * FROM switchboards WHERE id=$1 AND site=$2', [id, site]);
    const sb = sbResult.rows[0];
    if (!sb) return res.status(404).json({ error: 'Switchboard not found' });

    // Get all devices with hierarchy
    const { rows: devices } = await pool.query('SELECT * FROM devices WHERE switchboard_id=$1 ORDER BY created_at ASC', [id]);
    const byId = new Map(devices.map(d => [d.id, { ...d, children: [] }]));
    
    for (const d of devices) {
      if (d.parent_id && byId.has(d.parent_id)) {
        byId.get(d.parent_id).children.push(byId.get(d.id));
      }
    }
    
    const rootDevices = devices.filter(d => !d.parent_id).map(d => byId.get(d.id));

    // PDF Generation
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="switchboard_${sb.code || id}_report.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Header with branding
    doc.rect(0, 0, doc.page.width, 80).fill('#f8fafc');
    doc.fill('#1e40af').fontSize(24).font('Helvetica-Bold').text('ElectroHub', 50, 25);
    doc.fontSize(16).text('Switchboard Technical Report', 50, 45);
    doc.fill('#374151').fontSize(12).text(`Report #${id} • ${new Date().toLocaleString()}`, 50, 65);

    let y = 100;

    // Switchboard Information
    doc.font('Helvetica-Bold').fontSize(14).text('Switchboard Information', 50, y);
    y += 25;
    doc.font('Helvetica').fontSize(11);
    
    const sbInfo = [
      ['Switchboard Name', sb.name],
      ['Code', sb.code],
      ['Location', `${sb.building_code || '—'} • ${sb.floor || '—'} • ${sb.room || '—'}`],
      ['Neutral Regime', sb.regime_neutral || '—'],
      ['Principal Board', sb.is_principal ? 'Yes' : 'No'],
      ['Site', sb.site]
    ];

    sbInfo.forEach(([key, value], idx) => {
      if (idx % 2 === 0) {
        doc.rect(45, y-5, 510, 20).fill('#f1f5f9');
      }
      doc.text(key + ':', 55, y);
      doc.text(value || '—', 250, y, { width: 300, align: 'left' });
      y += 20;
    });

    y += 20;

    // Operating Modes & Quality
    doc.font('Helvetica-Bold').fontSize(14).text('Operating Modes & Quality', 50, y);
    y += 25;
    doc.fontSize(11);
    
    const modes = sb.modes || {};
    const modeKeys = Object.keys(modes);
    if (modeKeys.length > 0) {
      modeKeys.forEach((key, idx) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        doc.text(`${label}: ${modes[key] ? 'Enabled' : 'Disabled'}`, 55, y + idx * 15);
      });
      y += modeKeys.length * 15 + 10;
    }

    const quality = sb.quality || {};
    if (quality.thd || quality.flicker) {
      doc.text(`THD: ${quality.thd || '—'}`, 55, y);
      doc.text(`Flicker: ${quality.flicker || '—'}`, 55, y + 15);
      y += 30;
    }

    // Devices List (Hierarchical)
    doc.addPage();
    y = 50;
    doc.font('Helvetica-Bold').fontSize(16).text('Device Inventory', 50, y);
    y += 30;

    const renderDeviceTree = (devices, level = 0, pageY) => {
      let currentY = pageY;
      
      devices.forEach(device => {
        // Device row with indentation
        const indent = level * 15;
        const deviceName = device.name || `${device.manufacturer || ''} ${device.reference || ''}`.trim() || 'Unnamed Device';
        
        // Badge for main incoming
        const badgeText = device.is_main_incoming ? '[MAIN]' : '';
        const badgeColor = device.is_main_incoming ? '#059669' : '#6b7280';
        
        doc.fill('#000').text('│'.repeat(level), 50 + indent, currentY);
        doc.text(deviceName + (badgeText ? ` ${badgeText}` : ''), 55 + indent, currentY, { 
          width: 400, 
          align: 'left',
          continued: true 
        });
        
        // Specs
        doc.text(`Type: ${device.device_type}`, 55 + indent, currentY + 12);
        doc.text(`In: ${device.in_amps || '—'}A, Icu: ${device.icu_kA || '—'}kA, Poles: ${device.poles || '—'}`, 200 + indent, currentY + 12);
        
        currentY += 30;

        // Settings summary
        if (device.settings && Object.keys(device.settings).length > 0) {
          const settings = device.settings;
          doc.fontSize(9).text(
            `Settings: Ir=${settings.ir || '—'} Tr=${settings.tr || '—'}${settings.isd ? ` Isd=${settings.isd}` : ''}${settings.curve_type ? ` Curve: ${settings.curve_type}` : ''}`,
            55 + indent, currentY, { width: 500 }
          );
          doc.fontSize(11);
          currentY += 12;
        }

        // Downstream link
        if (device.downstream_switchboard_id) {
          doc.fill('#3b82f6').text(`→ Links to Switchboard #${device.downstream_switchboard_id}`, 55 + indent, currentY);
          currentY += 15;
        }

        // Recurse children
        if (device.children && device.children.length > 0) {
          currentY = renderDeviceTree(device.children, level + 1, currentY);
        }

        // Page break check
        if (currentY > 750) {
          doc.addPage();
          currentY = 50;
        }
      });
      
      return currentY;
    };

    y = renderDeviceTree(rootDevices, 0, y);

    // Connection Diagram (simple schematic)
    doc.addPage();
    y = 50;
    doc.font('Helvetica-Bold').fontSize(14).text('Connection Overview', 50, y);
    y += 25;
    
    doc.fontSize(10).fill('#6b7280');
    doc.text('This diagram shows the hierarchical structure and downstream connections:', 50, y);
    y += 15;
    
    // Simple tree visualization
    let diagramY = y;
    rootDevices.forEach((device, idx) => {
      const x = 80 + (idx * 150);
      if (x > 500) return; // Limit to page width
      
      // Device box
      doc.roundedRect(x, diagramY, 120, 40, 3).stroke('#3b82f6');
      doc.fill('#3b82f6').text(device.name || device.reference || 'Device', x + 5, diagramY + 10, { 
        width: 110, 
        align: 'center' 
      });
      doc.text(`${device.in_amps || '?'}A`, x + 5, diagramY + 25, { width: 110, align: 'center' });
      
      // Main incoming highlight
      if (device.is_main_incoming) {
        doc.rect(x - 2, diagramY - 2, 124, 44).stroke('#059669').lineWidth(2);
      }
      
      // Downstream arrow
      if (device.downstream_switchboard_id) {
        doc.moveTo(x + 60, diagramY + 40).lineTo(x + 60, diagramY + 60).stroke('#ef4444');
        doc.text(`SB #${device.downstream_switchboard_id}`, x + 45, diagramY + 65);
      }
      
      diagramY += 80;
      if (diagramY > 700) diagramY = y; // Reset for next row
    });

    // Footer
    const footerY = 820;
    doc.rect(0, footerY - 10, doc.page.width, 30).fill('#f3f4f6');
    doc.fill('#6b7280').fontSize(9)
      .text('Generated by ElectroHub • Professional Electrical Management System', 50, footerY)
      .text(`Switchboard ${sb.code || id} • Total Devices: ${devices.length}`, 400, footerY, { 
        width: 150, align: 'right' 
      });

    doc.end();
    console.log(`[PDF REPORT] Generated for switchboard ${id}`);
  } catch (e) {
    console.error('[SWITCHBOARD REPORT] error:', e.message);
    res.status(500).json({ error: 'Report generation failed' });
  }
});

const port = process.env.SWITCHBOARD_PORT || 3003;
app.listen(port, () => {
  console.log(`🚀 Switchboard service running on :${port}`);
  console.log(`📊 OpenAI ${openai ? '✅ Ready' : '❌ ' + openaiError}`);
});
