// server_hv.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import multer from 'multer';
import { getSiteFilter } from './lib/tenant-filter.js';
import { createAuditTrail, AUDIT_ACTIONS } from './lib/audit-trail.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import StreamZip from 'node-stream-zip';
import PDFDocument from 'pdfkit';
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// 📝 AUDIT TRAIL - Initialize for HV module
const audit = createAuditTrail(pool, 'hv');

// Data directories
const DATA_DIR = process.env.HV_DATA_DIR || path.resolve(__dirname, './_data_hv');
const MAPS_INCOMING_DIR = path.join(DATA_DIR, 'maps_incoming');
(async () => {
  for (const d of [DATA_DIR, MAPS_INCOMING_DIR]) {
    await fsp.mkdir(d, { recursive: true });
  }
})();

// OpenAI setup
let openai = null;
if (process.env.OPENAI_API_KEY) {
  try { openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
  catch (e) { console.warn('[HV] OpenAI init failed:', e.message); }
} else {
  console.warn('[HV] No OPENAI_API_KEY found');
}

// Gemini setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
let gemini = null;
if (GEMINI_API_KEY) {
  gemini = new GoogleGenerativeAI(GEMINI_API_KEY);
  console.log('[HV] Gemini initialized');
}

function isQuotaError(error) {
  const msg = error?.message || '';
  return error?.status === 429 || error?.code === 'insufficient_quota' || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
}

function convertToGeminiFormat(messages) {
  let systemPrompt = '', contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') { systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content; continue; }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (Array.isArray(msg.content)) {
      const parts = [];
      for (const item of msg.content) {
        if (item.type === 'text') parts.push({ text: item.text });
        else if (item.type === 'image_url') {
          const match = (item.image_url?.url || '').match(/^data:([^;]+);base64,(.+)$/);
          if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
      contents.push({ role, parts });
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }
  return { systemPrompt, contents };
}

async function callGemini(messages, options = {}) {
  if (!gemini) throw new Error('GEMINI_API_KEY not configured');
  const model = gemini.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { temperature: options.temperature ?? 0.7, maxOutputTokens: options.max_tokens ?? 4096 } });
  const { systemPrompt, contents } = convertToGeminiFormat(messages);
  if (systemPrompt && contents.length > 0) {
    const idx = contents.findIndex(c => c.role === 'user');
    if (idx >= 0 && contents[idx].parts[0]?.text) contents[idx].parts[0].text = `${systemPrompt}\n\n---\n\n${contents[idx].parts[0].text}`;
  }
  const result = await model.generateContent({ contents });
  return result.response.text();
}

async function chatWithFallback(messages, options = {}) {
  if (openai) {
    try {
      const response = await openai.chat.completions.create({ model: options.model || 'gpt-4o-mini', messages, temperature: options.temperature ?? 0.7, max_tokens: options.max_tokens ?? 2000, ...(options.response_format && { response_format: options.response_format }) });
      return { content: response.choices[0]?.message?.content || '', provider: 'openai' };
    } catch (error) {
      console.error('[HV] OpenAI failed:', error.message);
      if (gemini && isQuotaError(error)) {
        console.log('[HV] Fallback to Gemini...');
        const content = await callGemini(messages, options);
        return { content, provider: 'gemini' };
      }
      throw error;
    }
  }
  if (gemini) {
    const content = await callGemini(messages, options);
    return { content, provider: 'gemini' };
  }
  throw new Error('No AI provider configured');
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
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

// Multer (photos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 }
});

// Multer (ZIP uploads for plans)
const multerZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_INCOMING_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 } // 300MB max ZIP
});

// Utils
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}
const WHITELIST_SORT = ['created_at', 'name', 'code', 'building_code', 'floor'];
const sortSafe = (s) => WHITELIST_SORT.includes(String(s)) ? s : 'created_at';
const dirSafe = (d) => String(d).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

// Ensure schema
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hv_equipments (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      building_code TEXT,
      floor TEXT,
      room TEXT,
      regime_neutral TEXT,
      is_principal BOOLEAN DEFAULT FALSE,
      notes TEXT,
      photo BYTEA,
      modes JSONB DEFAULT '{}'::jsonb,
      quality JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- Add notes and photo columns if they don't exist (for existing tables)
    ALTER TABLE hv_equipments ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE hv_equipments ADD COLUMN IF NOT EXISTS photo BYTEA;
    CREATE TABLE IF NOT EXISTS hv_devices (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      hv_equipment_id INTEGER REFERENCES hv_equipments(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES hv_devices(id) ON DELETE SET NULL,
      downstream_hv_equipment_id INTEGER REFERENCES hv_equipments(id) ON DELETE SET NULL,
      downstream_device_id INTEGER,
      name TEXT,
      device_type TEXT NOT NULL,
      manufacturer TEXT,
      reference TEXT,
      voltage_class_kv NUMERIC,
      short_circuit_current_ka NUMERIC,
      insulation_type TEXT,
      mechanical_endurance_class TEXT,
      electrical_endurance_class TEXT,
      poles INTEGER,
      settings JSONB DEFAULT '{}'::jsonb,
      is_main_incoming BOOLEAN DEFAULT FALSE,
      photos BYTEA[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );

    -- Plans/Maps tables (like VSD)
    CREATE TABLE IF NOT EXISTS hv_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site TEXT NOT NULL,
      logical_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      content BYTEA NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_hv_plans_logical ON hv_plans(logical_name);
    CREATE INDEX IF NOT EXISTS idx_hv_plans_site ON hv_plans(site);

    CREATE TABLE IF NOT EXISTS hv_plan_names (
      logical_name TEXT PRIMARY KEY,
      site TEXT NOT NULL,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hv_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site TEXT NOT NULL,
      equipment_id INTEGER NOT NULL REFERENCES hv_equipments(id) ON DELETE CASCADE,
      logical_name TEXT NOT NULL,
      plan_id UUID NULL,
      page_index INTEGER NOT NULL DEFAULT 0,
      x_frac NUMERIC NOT NULL,
      y_frac NUMERIC NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (equipment_id, logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS idx_hv_positions_lookup ON hv_positions(logical_name, page_index);
  `);

  // Migration: add thumbnail column for pre-generated plan thumbnails
  await pool.query(`ALTER TABLE hv_plans ADD COLUMN IF NOT EXISTS thumbnail BYTEA NULL`);
}
ensureSchema().catch(e => console.error('[HV SCHEMA] Init error:', e.message));

// Health
app.get('/api/hv/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// ---------------- HV Equipments CRUD ----------------
app.get('/api/hv/equipments', async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req);
    // Site role requires a site, global/admin can see all
    if (role === 'site' && !siteName) return res.status(400).json({ error: 'Missing site' });
    const { q, building, floor, room, sort = 'created_at', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = [siteWhere]; const vals = [...siteParams]; let i = siteParams.length + 1;
    if (q) { where.push(`(name ILIKE $${i} OR code ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (building) { where.push(`building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    if (room) { where.push(`room ILIKE $${i}`); vals.push(`%${room}%`); i++; }
    const limit = Math.min(parseInt(pageSize, 10) || 18, 100);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;
    const sql = `
      SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, notes, modes, quality, created_at,
      (photo IS NOT NULL) AS has_photo,
      (SELECT COUNT(*) FROM hv_devices WHERE hv_equipment_id = hv_equipments.id)::int AS devices_count
      FROM hv_equipments
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortSafe(sort)} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM hv_equipments WHERE ${where.join(' AND ')}`, vals);
    res.json({ data: rows.rows, total: count.rows[0].total });
  } catch (e) { res.status(500).json({ error: 'List failed', details: e.message }); }
});

app.post('/api/hv/equipments', async (req, res) => {
  console.log('[HV EQUIPMENT CREATE] 🔵 Request received');
  console.log('[HV EQUIPMENT CREATE]   📋 Headers X-Site:', req.header('X-Site'));
  console.log('[HV EQUIPMENT CREATE]   📋 Query site:', req.query.site);
  console.log('[HV EQUIPMENT CREATE]   📋 Body:', JSON.stringify(req.body, null, 2));
  try {
    const site = siteOf(req);
    console.log('[HV EQUIPMENT CREATE]   🏢 Resolved site:', site || '(empty)');
    if (!site) {
      console.log('[HV EQUIPMENT CREATE] ❌ Missing site - returning 400');
      return res.status(400).json({ error: 'Missing site' });
    }
    const { name, code, building_code, floor, room, regime_neutral, is_principal, notes, modes, quality } = req.body;
    console.log('[HV EQUIPMENT CREATE]   📝 Extracted: name=', name, ', code=', code);
    if (!name || !code) {
      console.log('[HV EQUIPMENT CREATE] ❌ Missing name or code - returning 400');
      return res.status(400).json({ error: 'Name and code are required' });
    }
    console.log('[HV EQUIPMENT CREATE]   💾 Inserting into database...');
    const r = await pool.query(`
      INSERT INTO hv_equipments (site, name, code, building_code, floor, room, regime_neutral, is_principal, notes, modes, quality)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [site, name, code, building_code, floor, room, regime_neutral, is_principal, notes || null, modes || {}, quality || {}]);
    const eq = r.rows[0];
    console.log('[HV EQUIPMENT CREATE] ✅ Created equipment id:', eq.id, ', name:', eq.name);

    // 📝 AUDIT: Log création équipement HV
    try {
      await audit.log(req, AUDIT_ACTIONS.CREATED, {
        entityType: 'hv_equipment',
        entityId: eq.id,
        details: { name: eq.name, code: eq.code, site, building: building_code }
      });
    } catch (auditErr) {
      console.warn('[HV CREATE] Audit log failed (non-blocking):', auditErr.message);
    }

    res.status(201).json(eq);
  } catch (e) {
    console.error('[HV EQUIPMENT CREATE] ❌ Error:', e.message);
    console.error('[HV EQUIPMENT CREATE]   Stack:', e.stack);
    res.status(500).json({ error: 'Create failed', details: e.message });
  }
});

app.get('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`
      SELECT id, site, name, code, building_code, floor, room, regime_neutral, is_principal, notes, modes, quality, created_at,
      (photo IS NOT NULL) AS has_photo
      FROM hv_equipments WHERE id = $1 AND site = $2`, [Number(req.params.id), site]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Get failed', details: e.message }); }
});

app.put('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { name, code, building_code, floor, room, regime_neutral, is_principal, notes, modes, quality } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
    const r = await pool.query(`
      UPDATE hv_equipments SET name=$3, code=$4, building_code=$5, floor=$6, room=$7, regime_neutral=$8, is_principal=$9, notes=$10, modes=$11, quality=$12
      WHERE id=$1 AND site=$2 RETURNING *`,
      [Number(req.params.id), site, name, code, building_code, floor, room, regime_neutral, is_principal, notes || null, modes || {}, quality || {}]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    const eq = r.rows[0];

    // 📝 AUDIT: Log modification équipement HV
    try {
      await audit.log(req, AUDIT_ACTIONS.UPDATED, {
        entityType: 'hv_equipment',
        entityId: eq.id,
        details: { name: eq.name, code: eq.code, site, building: building_code }
      });
    } catch (auditErr) {
      console.warn('[HV UPDATE] Audit log failed (non-blocking):', auditErr.message);
    }

    res.json(eq);
  } catch (e) { res.status(500).json({ error: 'Update failed', details: e.message }); }
});

app.delete('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`DELETE FROM hv_equipments WHERE id=$1 AND site=$2 RETURNING *`, [Number(req.params.id), site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const eq = r.rows[0];

    // 📝 AUDIT: Log suppression équipement HV
    if (eq) {
      try {
        await audit.log(req, AUDIT_ACTIONS.DELETED, {
          entityType: 'hv_equipment',
          entityId: eq.id,
          details: { name: eq.name, code: eq.code, site }
        });
      } catch (auditErr) {
        console.warn('[HV DELETE] Audit log failed (non-blocking):', auditErr.message);
      }
    }

    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: 'Delete failed', details: e.message }); }
});

// ---------------- Equipment Photo (profile photo) ----------------
app.post('/api/hv/equipments/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid equipment ID' });
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });

    const r = await pool.query(
      `UPDATE hv_equipments SET photo = $1 WHERE id = $2 AND site = $3 RETURNING id`,
      [req.file.buffer, id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Equipment not found' });

    res.json({ success: true, id });
  } catch (e) {
    console.error('[HV EQUIPMENT PHOTO UPLOAD]', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/hv/equipments/:id/photo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid equipment ID' });

    const r = await pool.query(`SELECT photo FROM hv_equipments WHERE id = $1 AND site = $2`, [id, site]);
    if (!r.rows.length || !r.rows[0].photo) return res.status(404).json({ error: 'Photo not found' });

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].photo);
  } catch (e) {
    console.error('[HV EQUIPMENT PHOTO GET]', e.message);
    res.status(500).json({ error: 'Get photo failed' });
  }
});

app.delete('/api/hv/equipments/:id/photo', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site header' });

    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid equipment ID' });

    const r = await pool.query(
      `UPDATE hv_equipments SET photo = NULL WHERE id = $1 AND site = $2 RETURNING id`,
      [id, site]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Equipment not found' });

    res.json({ success: true });
  } catch (e) {
    console.error('[HV EQUIPMENT PHOTO DELETE]', e.message);
    res.status(500).json({ error: 'Delete photo failed' });
  }
});

// ---------------- HV Devices & tree ----------------
app.get('/api/hv/equipments/:id/devices', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`
      SELECT id, site, hv_equipment_id, parent_id, downstream_hv_equipment_id, downstream_device_id,
             name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka,
             insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings,
             is_main_incoming, created_at, updated_at,
             COALESCE(array_length(photos, 1), 0) AS photos_count
      FROM hv_devices WHERE hv_equipment_id=$1 AND site=$2 ORDER BY id ASC`, [Number(req.params.id), site]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Devices list failed', details: e.message }); }
});

app.post('/api/hv/equipments/:id/devices', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const hv_equipment_id = Number(req.params.id);
    const body = req.body || {};
    if (!body.device_type) return res.status(400).json({ error: 'Device type is required' });
    const r = await pool.query(`
      INSERT INTO hv_devices (site,hv_equipment_id,parent_id,downstream_hv_equipment_id,downstream_device_id,name,device_type,manufacturer,reference,voltage_class_kv,short_circuit_current_ka,insulation_type,mechanical_endurance_class,electrical_endurance_class,poles,settings,is_main_incoming)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id, site, hv_equipment_id, parent_id, downstream_hv_equipment_id, downstream_device_id,
                name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka,
                insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings,
                is_main_incoming, created_at, updated_at, 0 AS photos_count`,
      [site, hv_equipment_id, body.parent_id ?? null, body.downstream_hv_equipment_id ?? null, body.downstream_device_id ?? null, body.name ?? null, body.device_type, body.manufacturer ?? null, body.reference ?? null, body.voltage_class_kv ?? null, body.short_circuit_current_ka ?? null, body.insulation_type ?? null, body.mechanical_endurance_class ?? null, body.electrical_endurance_class ?? null, body.poles ?? null, body.settings || {}, body.is_main_incoming ?? false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Create failed', details: e.message }); }
});

app.put('/api/hv/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const body = req.body || {};
    if (!body.device_type) return res.status(400).json({ error: 'Device type is required' });
    const r = await pool.query(`
      UPDATE hv_devices SET
        name=$3, device_type=$4, manufacturer=$5, reference=$6, voltage_class_kv=$7, short_circuit_current_ka=$8,
        insulation_type=$9, mechanical_endurance_class=$10, electrical_endurance_class=$11, poles=$12, settings=$13,
        is_main_incoming=$14, parent_id=$15, downstream_hv_equipment_id=$16, downstream_device_id=$17, updated_at=NOW()
      WHERE id=$1 AND site=$2
      RETURNING id, site, hv_equipment_id, parent_id, downstream_hv_equipment_id, downstream_device_id,
                name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka,
                insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings,
                is_main_incoming, created_at, updated_at, COALESCE(array_length(photos, 1), 0) AS photos_count`,
      [Number(req.params.id), site, body.name ?? null, body.device_type, body.manufacturer ?? null, body.reference ?? null, body.voltage_class_kv ?? null, body.short_circuit_current_ka ?? null, body.insulation_type ?? null, body.mechanical_endurance_class ?? null, body.electrical_endurance_class ?? null, body.poles ?? null, body.settings || {}, body.is_main_incoming ?? false, body.parent_id ?? null, body.downstream_hv_equipment_id ?? null, body.downstream_device_id ?? null]
    );
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Update failed', details: e.message }); }
});

app.delete('/api/hv/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`DELETE FROM hv_devices WHERE id=$1 AND site=$2 RETURNING *`, [Number(req.params.id), site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: 'Delete failed', details: e.message }); }
});

// ---------------- BT devices suggestions (fail-soft) ----------------
app.get('/api/hv/lv-devices', async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req);
    // Site role requires a site, global/admin can see all
    if (role === 'site' && !siteName) return res.status(400).json({ error: 'Missing site' });
    const q = (req.query.q || '').toString().trim();

    const exists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'devices'
      ) AS present
    `);
    if (!exists.rows[0].present) return res.json([]);

    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='devices' AND table_schema='public'
    `);
    const names = cols.rows.map(r => r.column_name);
    const hasSwitchboard = names.includes('switchboard_name');
    const hasReference = names.includes('reference');

    const where = [siteWhere]; const vals = [...siteParams]; let i = siteParams.length + 1;
    if (q) {
      if (hasReference) { where.push(`(name ILIKE $${i} OR reference ILIKE $${i})`); }
      else { where.push(`name ILIKE $${i}`); }
      vals.push(`%${q}%`); i++;
    }

    const r = await pool.query(`
      SELECT id, name ${hasReference ? ', reference' : ''} ${hasSwitchboard ? ', switchboard_name' : ''}
      FROM devices WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 20
    `, vals);

    res.json(r.rows.map(row => ({
      id: row.id,
      name: row.name,
      reference: hasReference ? row.reference : null,
      switchboard_name: hasSwitchboard ? row.switchboard_name : null
    })));
  } catch (e) {
    console.error('[LV-DEVICES] Error:', e.message);
    res.status(200).json([]); // fail-soft
  }
});

// ---------------- Photos attachées à un device ----------------
app.post('/api/hv/devices/:id/photos', upload.array('photos', 5), async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const files = req.files || [];
    const buffers = files.map(f => f.buffer);

    const current = await pool.query(`SELECT photos FROM hv_devices WHERE id=$1 AND site=$2`, [id, site]);
    if (current.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    const existing = current.rows[0].photos || [];
    const updated = existing.concat(buffers);

    await pool.query(`UPDATE hv_devices SET photos=$3, updated_at=NOW() WHERE id=$1 AND site=$2`, [id, site, updated]);
    res.json({ count: updated.length });
  } catch (e) { res.status(500).json({ error: 'Upload photos failed', details: e.message }); }
});

// Rendre une photo
app.get('/api/hv/devices/:id/photo/:idx', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id); const idx = Number(req.params.idx);
    const r = await pool.query(`SELECT photos FROM hv_devices WHERE id=$1 AND site=$2`, [id, site]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    const arr = r.rows[0].photos || [];
    if (!arr[idx]) return res.status(404).json({ error: 'Photo not found' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.end(arr[idx]);
  } catch (e) { res.status(500).json({ error: 'Get photo failed', details: e.message }); }
});

// Supprimer une photo
app.delete('/api/hv/devices/:id/photo/:idx', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id); const idx = Number(req.params.idx);
    const r = await pool.query(`SELECT photos FROM hv_devices WHERE id=$1 AND site=$2`, [id, site]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    const arr = (r.rows[0].photos || []).filter((_, i) => i !== idx);
    await pool.query(`UPDATE hv_devices SET photos=$3, updated_at=NOW() WHERE id=$1 AND site=$2`, [id, site, arr]);
    res.json({ count: arr.length });
  } catch (e) { res.status(500).json({ error: 'Delete photo failed', details: e.message }); }
});

// ---------- Helpers (parsing / web) ----------
const parseNum = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).replace(',', '.');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const parsePoles = (v) => {
  const n = parseNum(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const sanitizeClass = (v, allowed) => {
  if (!v) return null;
  const up = String(v).toUpperCase().trim();
  return allowed.includes(up) ? up : null;
};
const safeJsonFromContent = (content) => {
  if (!content) return {};
  const fenced = content.replace(/```json|```/g, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  const slice = (start >= 0 && end > start) ? fenced.slice(start, end + 1) : fenced;
  try { return JSON.parse(slice); } catch { return {}; }
};

// --- Web search providers (optional) ---
const preferredDomains = (process.env.DATASHEET_PREFERRED_DOMAINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function webSearchDatasheet(q) {
  const results = [];
  const add = (arr) => arr.forEach(r => {
    if (!r?.url) return;
    if (!results.find(x => x.url === r.url)) results.push(r);
  });

  if (process.env.SERPAPI_KEY) {
    const u = new URL('https://serpapi.com/search.json');
    u.searchParams.set('engine', 'google');
    u.searchParams.set('q', q);
    u.searchParams.set('num', '10');
    u.searchParams.set('api_key', process.env.SERPAPI_KEY);
    const r = await fetch(u); if (r.ok) {
      const j = await r.json();
      const org = j.organic_results || [];
      add(org.map(o => ({ url: o.link, title: o.title || '' })));
    }
  } else if (process.env.BING_SEARCH_KEY) {
    const u = new URL('https://api.bing.microsoft.com/v7.0/search');
    u.searchParams.set('q', q);
    const r = await fetch(u, { headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SEARCH_KEY }});
    if (r.ok) {
      const j = await r.json();
      const org = (j.webPages && j.webPages.value) || [];
      add(org.map(o => ({ url: o.url, title: o.name || '' })));
    }
  } else if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID) {
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('q', q);
    u.searchParams.set('key', process.env.GOOGLE_API_KEY);
    u.searchParams.set('cx', process.env.GOOGLE_CSE_ID);
    u.searchParams.set('num', '10');
    const r = await fetch(u);
    if (r.ok) {
      const j = await r.json();
      const items = j.items || [];
      add(items.map(o => ({ url: o.link, title: o.title || '' })));
    }
  }

  const score = (u) => {
    const url = new URL(u);
    let s = 0;
    if (url.pathname.toLowerCase().endsWith('.pdf')) s += 3;
    if (preferredDomains.includes(url.hostname.replace(/^www\./,''))) s += 5;
    if (/datasheet|catalog|technical/i.test(u)) s += 2;
    return s;
  };
  return results
    .map(r => ({ ...r, s: score(r.url) }))
    .sort((a,b) => b.s - a.s)
    .slice(0, 5);
}

async function extractTextFromUrl(u) {
  let pdfParse = null;
  try { const m = await import('pdf-parse'); pdfParse = m.default || m; } catch { /* optional */ }

  const res = await fetch(u, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('pdf')) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!pdfParse) return '';
    const parsed = await pdfParse(buf);
    return (parsed.text || '').slice(0, 200000);
  }
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 200000);
}

async function enrichFromWeb({ manufacturer, reference, device_type }) {
  const baseQ = [manufacturer, reference, device_type, 'datasheet'].filter(Boolean).join(' ');
  const queries = [
    `${baseQ} filetype:pdf`,
    `${baseQ} technical data`,
    `${manufacturer} ${reference} IEC datasheet`
  ];
  const texts = [];
  for (const q of queries) {
    try {
      const hits = await webSearchDatasheet(q);
      for (const h of hits) {
        try {
          const t = await extractTextFromUrl(h.url);
          if (t && t.length > 500) texts.push(t);
          if (texts.length >= 2) break;
        } catch(_) {}
      }
      if (texts.length >= 2) break;
    } catch(_) {}
  }
  if (texts.length === 0) return {};

  const text = texts.join('\n\n---\n\n').slice(0, 14000);
  const messages = [
    { role: 'system', content: 'You extract HV device specs as strict JSON. Prefer explicit values from text; infer cautiously. Map device-specific attributes into settings.*' },
    { role: 'user', content:
`Extract these keys:

manufacturer, reference, device_type,
voltage_class_kv, short_circuit_current_ka, insulation_type,
mechanical_endurance_class, electrical_endurance_class, poles,
settings (object) with device-specific attributes:
- Transformer: capacity_kva, rated_voltage_primary_kv, rated_voltage_secondary_v, vector_group, cooling, connection, standard, frequency_hz, oil_kg, weight_kg, tap_info
- HV Circuit Breaker: standard, rated_current_a, rated_short_time_current_ka, opening_time_ms, insulation_medium (SF6/Vacuum/Air), poles
- HV Cell/Switchgear: standard, internal_arc_class, protection_relay_model, protection_functions
- Cable: voltage_class_kv, conductor_material, cross_section_mm2, insulation_material (XLPE/EPR/Paper), screen_type
- Relay: standard, model, functions_ansi, setting_examples

Return ONLY a JSON object.

TEXT:
${text}
`}
  ];
  const result = await chatWithFallback(messages, {
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 700
  });
  return safeJsonFromContent(result.content || '');
}

// ---------------- IA: specs à partir de texte + photos (Vision + Web enrich) ----------------
app.post('/api/hv/ai/specs', upload.array('photos', 5), async (req, res) => {
  try {
    const manufacturer_hint = req.body.manufacturer || '';
    const reference_hint = req.body.reference || '';
    const device_type_hint = req.body.device_type || '';
    const files = req.files || [];

    if (!openai && !gemini) return res.status(503).json({ error: 'AI not available. Set OPENAI_API_KEY or GEMINI_API_KEY.' });

    // 1) Vision on photos — schema stricte
    const imageParts = (files || []).map(f => {
      const base64 = Buffer.from(f.buffer).toString('base64');
      const mime = f.mimetype || 'image/jpeg';
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };
    });

    const vMessages = [
      { role: 'system', content: `
You are an HV expert (IEC 62271/60076/60228). Read nameplates and diagrams.
Return only STRICT JSON with these keys:

manufacturer, reference, device_type,
voltage_class_kv (number|null),
short_circuit_current_ka (number|null),
insulation_type (one of: Oil, SF6, Vacuum, Air, XLPE, EPR, Paper, Resin, or null),
mechanical_endurance_class (M1/M2|null),
electrical_endurance_class (E1/E2|null),
poles (integer|null),
settings (object) for device-specific attributes:
  transformer: capacity_kva, rated_voltage_primary_kv, rated_voltage_secondary_v,
               vector_group, cooling, connection, standard, frequency_hz, oil_kg, weight_kg, tap_info
  hv_circuit_breaker: standard, rated_current_a, rated_short_time_current_ka, opening_time_ms, poles
  hv_cell_switchgear: standard, internal_arc_class, protection_relay_model, protection_functions
  cable: voltage_class_kv, conductor_material, cross_section_mm2, insulation_material
  relay: model, standard, functions_ansi, setting_examples
If primary/secondary voltages appear, set voltage_class_kv to the HIGHEST voltage in kV (e.g. 22 kV for 22/0.4 kV).` },
      { role: 'user', content: [
        { type: 'text', text:
`Hints:
manufacturer: ${manufacturer_hint || '(none)'}
reference: ${reference_hint || '(none)'}
device_type: ${device_type_hint || '(unknown)'}
Please read all photos, transcribe the nameplate and extract as per schema.` },
        ...imageParts
      ]}
    ];

    const visionResult = await chatWithFallback(vMessages, {
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 800
    });
    const vjson = safeJsonFromContent(visionResult.content || '');

    if (process.env.HV_DEBUG === '1') {
      console.log('[VISION RAW]', vjson);
    }

    // Normalize Vision result
    const visionOut = {
      manufacturer: (vjson.manufacturer ?? manufacturer_hint) ?? null,
      reference: (vjson.reference ?? reference_hint) ?? null,
      device_type: (vjson.device_type ?? device_type_hint) ?? null,
      voltage_class_kv: parseNum(vjson.voltage_class_kv),
      short_circuit_current_ka: parseNum(vjson.short_circuit_current_ka),
      insulation_type: vjson.insulation_type ?? null,
      mechanical_endurance_class: sanitizeClass(vjson.mechanical_endurance_class, ['M1','M2']),
      electrical_endurance_class: sanitizeClass(vjson.electrical_endurance_class, ['E1','E2']),
      poles: parsePoles(vjson.poles),
      settings: vjson.settings || {}
    };

    // 2) Web enrichment (optional)
    let webOut = {};
    const hasSearchKeys = process.env.SERPAPI_KEY || process.env.BING_SEARCH_KEY || (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID);
    const canSearch = hasSearchKeys && (visionOut.manufacturer || visionOut.reference);
    if (canSearch) {
      try {
        const enriched = await enrichFromWeb({
          manufacturer: visionOut.manufacturer || manufacturer_hint,
          reference: visionOut.reference || reference_hint,
          device_type: visionOut.device_type || device_type_hint
        });
        if (process.env.HV_DEBUG === '1') console.log('[WEB RAW]', enriched);

        webOut = {
          manufacturer: enriched.manufacturer ?? null,
          reference: enriched.reference ?? null,
          device_type: enriched.device_type ?? null,
          voltage_class_kv: parseNum(enriched.voltage_class_kv),
          short_circuit_current_ka: parseNum(enriched.short_circuit_current_ka),
          insulation_type: enriched.insulation_type ?? null,
          mechanical_endurance_class: sanitizeClass(enriched.mechanical_endurance_class, ['M1','M2']),
          electrical_endurance_class: sanitizeClass(enriched.electrical_endurance_class, ['E1','E2']),
          poles: parsePoles(enriched.poles),
          settings: enriched.settings || {}
        };
      } catch (e) {
        console.warn('[WEB ENRICH] failed:', e.message);
      }
    }

    // 3) Merge
    const merged = {
      manufacturer: visionOut.manufacturer || webOut.manufacturer || null,
      reference: visionOut.reference || webOut.reference || null,
      device_type: visionOut.device_type || webOut.device_type || device_type_hint || 'HV Circuit Breaker',
      voltage_class_kv: (visionOut.voltage_class_kv ?? webOut.voltage_class_kv) ?? null,
      short_circuit_current_ka: (visionOut.short_circuit_current_ka ?? webOut.short_circuit_current_ka) ?? null,
      insulation_type: visionOut.insulation_type || webOut.insulation_type || null,
      mechanical_endurance_class: visionOut.mechanical_endurance_class || webOut.mechanical_endurance_class || null,
      electrical_endurance_class: visionOut.electrical_endurance_class || webOut.electrical_endurance_class || null,
      poles: (visionOut.poles ?? webOut.poles) ?? null,
      settings: { ...(webOut.settings || {}), ...(visionOut.settings || {}) }
    };

    // Drop empty keys
    const out = {};
    for (const [k,v] of Object.entries(merged)) {
      if (v === null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)) continue;
      out[k] = v;
    }
    return res.json(out);
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const detail = e?.response?.data?.error?.message || e?.error?.message || e?.message || 'Unknown error';
    console.error('[HV AI SPECS] Error:', { status, detail });
    if (status === 401) return res.status(401).json({ error: 'Unauthorized (check OPENAI_API_KEY)', details: detail });
    if (status === 404) return res.status(404).json({ error: 'Model not found', details: detail });
    if (status === 429) return res.status(429).json({ error: 'Rate limit or quota exceeded', details: detail });
    if (status === 400) return res.status(400).json({ error: 'Invalid request to OpenAI', details: detail });
    if (status === 503) return res.status(503).json({ error: 'OpenAI service unavailable', details: detail });
    return res.status(500).json({ error: 'AI specs extraction failed', details: detail });
  }
});

// ==================== MAPS / PLANS ENDPOINTS ====================

// Helper: count PDF pages
async function countPdfPages(buffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.numpages || 1;
  } catch {
    return 1;
  }
}

// Upload ZIP of PDFs
app.post('/api/hv/maps/uploadZip', multerZip.single('zip'), async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!req.file) return res.status(400).json({ error: 'No ZIP file uploaded' });

    const zipPath = req.file.path;
    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();
    const pdfs = Object.values(entries).filter(e =>
      !e.isDirectory &&
      e.name.toLowerCase().endsWith('.pdf') &&
      !e.name.startsWith('__MACOSX')
    );

    if (pdfs.length === 0) {
      await zip.close();
      return res.status(400).json({ error: 'No PDF files found in ZIP' });
    }

    const results = [];
    for (const entry of pdfs) {
      const filename = path.basename(entry.name);
      const logical_name = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const content = await zip.entryData(entry);
      const pageCount = await countPdfPages(content);

      // Get next version
      const versionRes = await pool.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM hv_plans WHERE site = $1 AND logical_name = $2`,
        [site, logical_name]
      );
      const version = versionRes.rows[0].next_version;

      // Insert plan
      const insertRes = await pool.query(
        `INSERT INTO hv_plans (site, logical_name, version, filename, file_path, page_count, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, logical_name, version, filename, page_count`,
        [site, logical_name, version, filename, `db://${logical_name}`, pageCount, content]
      );

      // Upsert display name
      await pool.query(
        `INSERT INTO hv_plan_names (logical_name, display_name)
         VALUES ($1, $2)
         ON CONFLICT (logical_name) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [logical_name, filename.replace(/\.pdf$/i, '')]
      );

      results.push(insertRes.rows[0]);
    }

    await zip.close();
    res.json({ uploaded: results.length, plans: results });
  } catch (e) {
    console.error('[HV MAPS] Upload ZIP error:', e.message);
    res.status(500).json({ error: 'Upload ZIP failed', details: e.message });
  }
});

// List plans - now includes VSD plans as well for unified plan management
app.get('/api/hv/maps/listPlans', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    // Fetch HV-specific plans
    const hvResult = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id, p.logical_name, p.version, p.filename, p.page_count,
             COALESCE(pn.display_name, p.logical_name) AS display_name,
             'hv' AS source
        FROM hv_plans p
        LEFT JOIN hv_plan_names pn ON pn.logical_name = p.logical_name AND pn.site = p.site
       WHERE p.site = $1
       ORDER BY p.logical_name, p.version DESC
    `, [site]);

    // Also fetch VSD plans (shared across electrical systems)
    const vsdResult = await pool.query(`
      SELECT DISTINCT ON (p.logical_name)
             p.id, p.logical_name, p.version, p.filename, p.page_count,
             COALESCE(pn.display_name, p.logical_name) AS display_name,
             'vsd' AS source
        FROM vsd_plans p
        LEFT JOIN vsd_plan_names pn ON pn.logical_name = p.logical_name
       ORDER BY p.logical_name, p.version DESC
    `);

    // Merge plans: HV plans first, then VSD plans (excluding duplicates by logical_name)
    const hvPlans = hvResult.rows;
    const hvLogicalNames = new Set(hvPlans.map(p => p.logical_name));
    const vsdPlans = vsdResult.rows.filter(p => !hvLogicalNames.has(p.logical_name));

    const allPlans = [...hvPlans, ...vsdPlans];
    res.json(allPlans);
  } catch (e) {
    console.error('[HV MAPS] List plans error:', e.message);
    res.status(500).json({ error: 'List plans failed', details: e.message });
  }
});

// Get plan file (PDF) - checks HV plans first, then VSD plans
app.get('/api/hv/maps/planFile', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { id, logical_name } = req.query;
    let rows = [];

    // Try HV plans first
    if (id) {
      const result = await pool.query(
        `SELECT content, filename FROM hv_plans WHERE id = $1 AND site = $2`,
        [id, site]
      );
      rows = result.rows;
    } else if (logical_name) {
      const result = await pool.query(
        `SELECT content, filename FROM hv_plans WHERE site = $1 AND logical_name = $2 ORDER BY version DESC LIMIT 1`,
        [site, logical_name]
      );
      rows = result.rows;
    } else {
      return res.status(400).json({ error: 'Missing id or logical_name' });
    }

    // If not found in HV plans, try VSD plans
    if (rows.length === 0) {
      if (id) {
        const result = await pool.query(
          `SELECT content, filename FROM vsd_plans WHERE id = $1`,
          [id]
        );
        rows = result.rows;
      } else if (logical_name) {
        const result = await pool.query(
          `SELECT content, filename FROM vsd_plans WHERE logical_name = $1 ORDER BY version DESC LIMIT 1`,
          [logical_name]
        );
        rows = result.rows;
      }
    }

    if (rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const { content, filename } = rows[0];
    if (!content) return res.status(404).json({ error: 'Plan content not available' });

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${filename}"`);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(content);
  } catch (e) {
    console.error('[HV MAPS] Get plan file error:', e.message);
    res.status(500).json({ error: 'Get plan file failed', details: e.message });
  }
});

// Rename plan (display name)
app.put('/api/hv/maps/renamePlan', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { logical_name, display_name } = req.body;
    if (!logical_name || !display_name) {
      return res.status(400).json({ error: 'Missing logical_name or display_name' });
    }

    await pool.query(
      `INSERT INTO hv_plan_names (logical_name, site, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (logical_name) DO UPDATE SET display_name = EXCLUDED.display_name, site = EXCLUDED.site`,
      [logical_name, site, display_name]
    );

    res.json({ success: true });
  } catch (e) {
    console.error('[HV MAPS] Rename plan error:', e.message);
    res.status(500).json({ error: 'Rename plan failed', details: e.message });
  }
});

// Get equipment positions on a plan
app.get('/api/hv/maps/positions', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { logical_name, id, page_index = 0 } = req.query;
    const planKey = logical_name || id;
    if (!planKey) return res.status(400).json({ error: 'Missing logical_name or id' });

    const { rows } = await pool.query(`
      SELECT pos.id, pos.equipment_id, pos.x_frac, pos.y_frac,
             e.name, e.code, e.building_code, e.floor, e.room, e.regime_neutral, e.is_principal
        FROM hv_positions pos
        JOIN hv_equipments e ON e.id = pos.equipment_id
       WHERE pos.site = $1 AND pos.logical_name = $2 AND pos.page_index = $3
       ORDER BY e.name
    `, [site, planKey, Number(page_index)]);

    res.json({ positions: rows });
  } catch (e) {
    console.error('[HV MAPS] Get positions error:', e.message);
    res.status(500).json({ error: 'Get positions failed', details: e.message });
  }
});

// Set/update equipment position on plan
// This ensures equipment is only on ONE plan at a time (deletes ALL old positions first)
app.post('/api/hv/maps/setPosition', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { equipment_id, logical_name, plan_id, page_index = 0, x_frac, y_frac } = req.body;
    if (!equipment_id || !logical_name || x_frac === undefined || y_frac === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // CRITICAL: Delete ALL existing positions for this equipment (across ALL sites/plans)
    // This ensures the equipment is NEVER on multiple plans
    const deleteResult = await pool.query(
      `DELETE FROM hv_positions WHERE equipment_id = $1`,
      [equipment_id]
    );
    console.log(`[HV MAPS] Deleted ${deleteResult.rowCount} old positions for equipment ${equipment_id}`);

    // Then insert the new position
    const { rows } = await pool.query(`
      INSERT INTO hv_positions (site, equipment_id, logical_name, plan_id, page_index, x_frac, y_frac)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [site, equipment_id, logical_name, plan_id || null, Number(page_index), x_frac, y_frac]);

    console.log(`[HV MAPS] Created new position for equipment ${equipment_id} on plan ${logical_name}`);
    res.json(rows[0]);
  } catch (e) {
    console.error('[HV MAPS] Set position error:', e.message);
    res.status(500).json({ error: 'Set position failed', details: e.message });
  }
});

// Cleanup duplicate positions - keeps only the most recent position per equipment
app.post('/api/hv/maps/cleanup-duplicates', async (req, res) => {
  try {
    const site = siteOf(req);

    // Find equipments with multiple positions
    const { rows: duplicates } = await pool.query(`
      SELECT equipment_id, COUNT(*) as count
      FROM hv_positions
      ${site ? 'WHERE site = $1' : ''}
      GROUP BY equipment_id
      HAVING COUNT(*) > 1
    `, site ? [site] : []);

    console.log(`[HV MAPS] Found ${duplicates.length} equipments with duplicate positions`);

    let totalRemoved = 0;
    for (const dup of duplicates) {
      // Keep only the most recent position (by created_at)
      const result = await pool.query(`
        DELETE FROM hv_positions
        WHERE equipment_id = $1
        AND id NOT IN (
          SELECT id FROM hv_positions
          WHERE equipment_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        )
      `, [dup.equipment_id]);
      totalRemoved += result.rowCount;
      console.log(`[HV MAPS] Equipment ${dup.equipment_id}: removed ${result.rowCount} duplicate positions`);
    }

    res.json({
      ok: true,
      duplicates_found: duplicates.length,
      positions_removed: totalRemoved
    });
  } catch (e) {
    console.error('[HV MAPS] Cleanup error:', e.message);
    res.status(500).json({ error: 'Cleanup failed', details: e.message });
  }
});

// Delete position
app.delete('/api/hv/maps/positions/:id', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { rowCount } = await pool.query(
      `DELETE FROM hv_positions WHERE id = $1 AND site = $2`,
      [req.params.id, site]
    );

    if (rowCount === 0) return res.status(404).json({ error: 'Position not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('[HV MAPS] Delete position error:', e.message);
    res.status(500).json({ error: 'Delete position failed', details: e.message });
  }
});

// Get all placed equipment IDs
app.get('/api/hv/maps/placed-ids', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { rows } = await pool.query(`
      SELECT DISTINCT equipment_id, logical_name
        FROM hv_positions
       WHERE site = $1
    `, [site]);

    const placed_ids = rows.map(r => r.equipment_id);
    const placed_details = {};
    rows.forEach(r => {
      if (!placed_details[r.equipment_id]) {
        placed_details[r.equipment_id] = { plans: [] };
      }
      if (!placed_details[r.equipment_id].plans.includes(r.logical_name)) {
        placed_details[r.equipment_id].plans.push(r.logical_name);
      }
    });

    res.json({ placed_ids, placed_details });
  } catch (e) {
    console.error('[HV MAPS] Get placed IDs error:', e.message);
    res.status(500).json({ error: 'Get placed IDs failed', details: e.message });
  }
});

// =============================================
// REPORT PDF
// =============================================
app.get('/api/hv/report', async (req, res) => {
  try {
    const { building, voltage_class, device_type } = req.query;
    const { where: siteWhere, params: siteParams, siteName } = getSiteFilter(req, { tableAlias: 'e' });
    if (!siteName) return res.status(400).json({ error: 'Missing site header' });

    // Build WHERE clause
    const conditions = [];
    const params = [...siteParams];
    let paramIdx = siteParams.length;

    if (siteWhere) conditions.push(siteWhere);
    if (building) { paramIdx++; conditions.push(`e.building = $${paramIdx}`); params.push(building); }
    if (voltage_class) { paramIdx++; conditions.push(`e.voltage_kv = $${paramIdx}`); params.push(voltage_class); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get equipments
    const { rows: equipments } = await pool.query(`
      SELECT e.*,
             (SELECT COUNT(*) FROM hv_devices d WHERE d.equipment_id = e.id) as device_count
      FROM hv_equipments e
      ${whereClause}
      ORDER BY e.building, e.code
    `, params);

    // Filter by device_type if needed (at device level)
    let devicesFilter = '';
    if (device_type) {
      devicesFilter = ` AND d.device_type = '${device_type.replace(/'/g, "''")}'`;
    }

    // Create PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport_hv_${siteName}_${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).fillColor('#4a1d96').text('Rapport Haute Tension', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#666').text(`Site: ${siteName}`, { align: 'center' });
    doc.text(`Généré le: ${new Date().toLocaleDateString('fr-FR')}`, { align: 'center' });
    doc.moveDown();

    // Filters applied
    const filtersText = [];
    if (building) filtersText.push(`Bâtiment: ${building}`);
    if (voltage_class) filtersText.push(`Tension: ${voltage_class} kV`);
    if (device_type) filtersText.push(`Type: ${device_type}`);
    if (filtersText.length > 0) {
      doc.fontSize(10).fillColor('#888').text(`Filtres: ${filtersText.join(' | ')}`, { align: 'center' });
    }
    doc.moveDown();

    // Summary
    doc.fontSize(14).fillColor('#333').text(`Total équipements: ${equipments.length}`);
    doc.moveDown();

    // Equipment list
    for (const eq of equipments) {
      doc.fontSize(12).fillColor('#4a1d96').text(`${eq.code || eq.name}`, { continued: true });
      doc.fillColor('#666').text(` - ${eq.building || 'N/A'}`);
      doc.fontSize(10).fillColor('#333');
      doc.text(`  Tension: ${eq.voltage_kv || 'N/A'} kV | Régime: ${eq.regime_neutral || 'N/A'} | Icc: ${eq.short_circuit_ka || 'N/A'} kA`);
      if (eq.notes) doc.text(`  Notes: ${eq.notes}`);
      doc.moveDown(0.5);

      if (doc.y > 700) {
        doc.addPage();
      }
    }

    doc.end();
  } catch (e) {
    console.error('[HV] Report error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------
// MANAGEMENT MONITORING REPORT (avec mini plans)
// -------------------------------------------------
app.get('/api/hv/management-monitoring', async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName } = getSiteFilter(req, { tableAlias: 'e' });
    if (!siteName) return res.status(400).json({ error: 'Missing site header' });

    const filterBuilding = req.query.building || null;
    const filterVoltage = req.query.voltage_class || null;

    // Récupérer les informations du site
    let siteInfo = { company_name: "Entreprise", site_name: siteName, logo: null, logo_mime: null };
    try {
      const siteRes = await pool.query(
        `SELECT company_name, company_address, company_phone, company_email, logo, logo_mime
         FROM site_settings WHERE site = $1`,
        [siteName]
      );
      if (siteRes.rows[0]) {
        siteInfo = { ...siteInfo, ...siteRes.rows[0], site_name: siteName };
      }
    } catch (e) { console.warn('[HV-MM] No site settings:', e.message); }

    // Récupérer les équipements avec filtres
    const conditions = [];
    const params = [...siteParams];
    let paramIdx = siteParams.length;

    if (siteWhere) conditions.push(siteWhere);
    if (filterBuilding) { paramIdx++; conditions.push(`e.building = $${paramIdx}`); params.push(filterBuilding); }
    if (filterVoltage) { paramIdx++; conditions.push(`e.voltage_kv = $${paramIdx}`); params.push(filterVoltage); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: equipments } = await pool.query(`
      SELECT e.*,
             (SELECT COUNT(*) FROM hv_devices d WHERE d.equipment_id = e.id) as device_count
      FROM hv_equipments e
      ${whereClause}
      ORDER BY e.building, e.code
    `, params);
    console.log(`[HV-MM] Found ${equipments.length} equipments`);

    // Récupérer les positions des équipements sur les plans
    const equipmentIds = equipments.map(e => e.id);
    let positionsMap = new Map();
    if (equipmentIds.length > 0) {
      const { rows: positions } = await pool.query(`
        SELECT pos.equipment_id, pos.logical_name, pos.plan_id, pos.x_frac, pos.y_frac,
               COALESCE(p_by_logical.thumbnail, p_by_id.thumbnail) AS plan_thumbnail,
               COALESCE(p_by_logical.content, p_by_id.content) AS plan_content,
               COALESCE(pn.display_name, pos.logical_name, 'Plan') AS plan_display_name
        FROM hv_positions pos
        LEFT JOIN (
          SELECT DISTINCT ON (logical_name) id, logical_name, content, thumbnail
          FROM hv_plans
          ORDER BY logical_name, version DESC
        ) p_by_logical ON p_by_logical.logical_name = pos.logical_name
        LEFT JOIN hv_plans p_by_id ON p_by_id.id = pos.plan_id
        LEFT JOIN hv_plan_names pn ON pn.logical_name = COALESCE(pos.logical_name, p_by_id.logical_name)
        WHERE pos.equipment_id = ANY($1)
      `, [equipmentIds]);

      for (const pos of positions) {
        if (!positionsMap.has(pos.equipment_id)) {
          positionsMap.set(pos.equipment_id, pos);
        }
      }
      console.log(`[HV-MM] Found ${positions.length} equipment positions on plans`);
    }

    // Créer le PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      info: {
        Title: 'Management Monitoring - Haute Tension',
        Author: siteInfo.company_name,
        Subject: 'Rapport de suivi des équipements haute tension'
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Management_Monitoring_HV_${siteName.replace(/[^a-zA-Z0-9-_]/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // Couleurs
    const colors = {
      primary: '#f59e0b',    // Amber
      secondary: '#d97706',
      text: '#1f2937',
      muted: '#6b7280',
      light: '#e5e7eb'
    };

    // En-tête avec logo
    if (siteInfo.logo && siteInfo.logo_mime) {
      try {
        const logoBuffer = Buffer.isBuffer(siteInfo.logo) ? siteInfo.logo : Buffer.from(siteInfo.logo);
        doc.image(logoBuffer, 50, 30, { fit: [100, 50] });
      } catch (e) { console.warn('[HV-MM] Logo error:', e.message); }
    }

    doc.fontSize(20).fillColor(colors.primary)
       .text('Management Monitoring', 200, 35, { width: 350, align: 'right' });
    doc.fontSize(12).fillColor(colors.muted)
       .text('Haute Tension', 200, 60, { width: 350, align: 'right' });
    doc.fontSize(10)
       .text(`${siteInfo.company_name} - ${siteInfo.site_name}`, 200, 78, { width: 350, align: 'right' })
       .text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 200, 92, { width: 350, align: 'right' });

    // Statistiques
    let y = 130;
    doc.rect(50, y, 495, 50).fill('#f3f4f6');
    doc.fontSize(11).fillColor(colors.text);
    doc.text(`Total équipements: ${equipments.length}`, 60, y + 12);

    const withPosition = equipments.filter(e => positionsMap.has(e.id)).length;
    doc.text(`Positionnés sur plan: ${withPosition}`, 250, y + 12);

    const totalDevices = equipments.reduce((sum, e) => sum + (e.device_count || 0), 0);
    doc.text(`Total appareils: ${totalDevices}`, 60, y + 32);

    // Fiches par équipement (2 par page)
    y = 200;
    let ficheY = y;
    let ficheCount = 0;

    for (const eq of equipments) {
      if (ficheCount > 0 && ficheCount % 2 === 0) {
        doc.addPage();
        ficheY = 50;
      }

      // Cadre de la fiche
      doc.rect(50, ficheY, 495, 320).stroke(colors.light);

      // En-tête de fiche
      doc.rect(50, ficheY, 495, 30).fill(colors.primary);
      doc.fontSize(12).fillColor('#ffffff')
         .text(eq.code || eq.name || `Équipement #${eq.id}`, 60, ficheY + 9, { width: 475, lineBreak: false });

      // Contenu de la fiche
      const infoX = 60;
      let infoY = ficheY + 45;
      const infoWidth = 300;
      const rightColX = 370;
      const imgWidth = 160;
      const imgHeight = 160;
      const rightY = ficheY + 45;

      const position = positionsMap.get(eq.id);

      // Mini plan avec localisation (plus grand car pas de photo)
      if (position && (position.plan_thumbnail || position.plan_content)) {
        try {
          const planDisplayName = position.plan_display_name || 'Plan';
          let planThumbnail = null;

          if (position.plan_thumbnail && position.plan_thumbnail.length > 0) {
            const { loadImage } = await import('canvas');
            const thumbnailBuffer = Buffer.isBuffer(position.plan_thumbnail)
              ? position.plan_thumbnail
              : Buffer.from(position.plan_thumbnail);

            const img = await loadImage(thumbnailBuffer);
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            if (position.x_frac !== null && position.y_frac !== null &&
                !isNaN(position.x_frac) && !isNaN(position.y_frac)) {
              const markerX = position.x_frac * img.width;
              const markerY = position.y_frac * img.height;
              const markerRadius = Math.max(12, img.width / 25);

              ctx.beginPath();
              ctx.arc(markerX, markerY, markerRadius, 0, 2 * Math.PI);
              ctx.fillStyle = colors.primary;
              ctx.fill();
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 3;
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(markerX, markerY, markerRadius / 3, 0, 2 * Math.PI);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
            }

            planThumbnail = canvas.toBuffer('image/png');
          }

          if (planThumbnail) {
            doc.image(planThumbnail, rightColX, rightY, { fit: [imgWidth, imgHeight], align: 'center' });
            doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.primary);
            doc.fontSize(6).fillColor(colors.muted)
               .text(planDisplayName, rightColX, rightY + imgHeight + 2, { width: imgWidth, align: 'center', lineBreak: false });
          } else {
            doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.light);
            doc.fontSize(7).fillColor(colors.muted).text('Plan N/A', rightColX + 60, rightY + 75, { lineBreak: false });
          }
        } catch (planErr) {
          console.warn(`[HV-MM] Plan thumbnail error for ${eq.code}:`, planErr.message);
          doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.light);
          doc.fontSize(7).fillColor(colors.muted).text('Plan N/A', rightColX + 60, rightY + 75, { lineBreak: false });
        }
      } else {
        doc.rect(rightColX, rightY, imgWidth, imgHeight).stroke(colors.light);
        doc.fontSize(7).fillColor(colors.muted).text('Non positionné', rightColX + 50, rightY + 75, { lineBreak: false });
      }

      // Informations de l'équipement
      const infoItems = [
        ['Code', eq.code || '-'],
        ['Nom', eq.name || '-'],
        ['Bâtiment', eq.building || '-'],
        ['Tension', eq.voltage_kv ? `${eq.voltage_kv} kV` : '-'],
        ['Régime neutre', eq.regime_neutral || '-'],
        ['Icc', eq.short_circuit_ka ? `${eq.short_circuit_ka} kA` : '-'],
        ['Appareils', String(eq.device_count || 0)],
        ['Notes', eq.notes || '-'],
      ];

      infoItems.forEach(([label, value]) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(colors.text).text(label + ':', infoX, infoY, { width: 90 });
        doc.font('Helvetica').fillColor(colors.muted).text(String(value).substring(0, 50), infoX + 93, infoY, { width: infoWidth - 93, lineBreak: false });
        infoY += 18;
      });

      ficheY += 330;
      ficheCount++;
    }

    // Numérotation des pages
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = range.start; i < range.start + totalPages; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(colors.muted)
         .text(`Management Monitoring - ${siteInfo.company_name || 'Document'} - Page ${i + 1}/${totalPages}`, 50, 810, { align: 'center', width: 495, lineBreak: false });
    }

    doc.end();
    console.log(`[HV-MM] Generated PDF with ${equipments.length} equipments`);

  } catch (e) {
    console.error('[HV-MM] Error:', e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
});

const port = process.env.HV_PORT || 3008;
app.listen(port, () => console.log(`HV service running on :${port}`));
