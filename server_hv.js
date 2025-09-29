// server_hv.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import multer from 'multer';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI setup
let openai = null;
if (process.env.OPENAI_API_KEY) {
  try { openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
  catch (e) { console.warn('[HV] OpenAI init failed:', e.message); }
} else {
  console.warn('[HV] No OPENAI_API_KEY found');
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
      modes JSONB DEFAULT '{}'::jsonb,
      quality JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
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
  `);
}
ensureSchema().catch(e => console.error('[HV SCHEMA] Init error:', e.message));

// Health
app.get('/api/hv/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// ---------------- HV Equipments CRUD ----------------
app.get('/api/hv/equipments', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, building, floor, room, sort = 'created_at', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = ['site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(name ILIKE $${i} OR code ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (building) { where.push(`building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    if (room) { where.push(`room ILIKE $${i}`); vals.push(`%${room}%`); i++; }
    const limit = Math.min(parseInt(pageSize, 10) || 18, 100);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;
    const sql = `
      SELECT *,
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
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
    const r = await pool.query(`
      INSERT INTO hv_equipments (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [site, name, code, building_code, floor, room, regime_neutral, is_principal, modes || {}, quality || {}]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Create failed', details: e.message }); }
});

app.get('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`SELECT * FROM hv_equipments WHERE id = $1 AND site = $2`, [Number(req.params.id), site]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Get failed', details: e.message }); }
});

app.put('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
    const r = await pool.query(`
      UPDATE hv_equipments SET name=$3, code=$4, building_code=$5, floor=$6, room=$7, regime_neutral=$8, is_principal=$9, modes=$10, quality=$11
      WHERE id=$1 AND site=$2 RETURNING *`,
      [Number(req.params.id), site, name, code, building_code, floor, room, regime_neutral, is_principal, modes || {}, quality || {}]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Update failed', details: e.message }); }
});

app.delete('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`DELETE FROM hv_equipments WHERE id=$1 AND site=$2 RETURNING *`, [Number(req.params.id), site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: 'Delete failed', details: e.message }); }
});

// ---------------- HV Devices & tree ----------------
app.get('/api/hv/equipments/:id/devices', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`SELECT * FROM hv_devices WHERE hv_equipment_id=$1 AND site=$2 ORDER BY id ASC`, [Number(req.params.id), site]);
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
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
      WHERE id=$1 AND site=$2 RETURNING *`,
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
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const q = (req.query.q || '').toString().trim();

    // Check existence of "devices" table
    const exists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'devices'
      ) AS present
    `);
    if (!exists.rows[0].present) return res.json([]);

    // Optional columns
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='devices' AND table_schema='public'
    `);
    const names = cols.rows.map(r => r.column_name);
    const hasSwitchboard = names.includes('switchboard_name');
    const hasReference = names.includes('reference');

    const where = ['site = $1']; const vals = [site]; let i = 2;
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

// ---------------- IA: specs à partir de texte + photos (FIX) ----------------
app.post('/api/hv/ai/specs', upload.array('photos', 5), async (req, res) => {
  try {
    const manufacturer = req.body.manufacturer || '';
    const reference = req.body.reference || '';
    const device_type = req.body.device_type || '';
    const files = req.files || [];

    // Avant : renvoyait {} silencieusement si pas de clé -> ambigu côté front.
    if (!openai) return res.status(503).json({ error: 'OpenAI not available' });

    // IMPORTANT : envoyer les images comme "image_url" (data URL) pour l’API Vision
    const imageParts = files.map(f => {
      const base64 = Buffer.from(f.buffer).toString('base64');
      const mime = f.mimetype || 'image/jpeg';
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };
    });

    const messages = [
      { role: 'system', content: 'You are an electrical engineering expert (IEC 62271 HV). Extract realistic specs.' },
      { role: 'user', content: [
          { type: 'text', text: `Manufacturer: ${manufacturer}\nReference: ${reference}\nDevice type: ${device_type}\n\nPlease infer specs if visible.` },
          ...imageParts
        ]
      }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 700
    });

    let json = {};
    try { json = JSON.parse(completion.choices?.[0]?.message?.content || '{}'); } catch { json = {}; }

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const out = {
      device_type: json.device_type || device_type || 'HV Circuit Breaker',
      voltage_class_kv: num(json.voltage_class_kv),
      short_circuit_current_ka: num(json.short_circuit_current_ka),
      insulation_type: json.insulation_type ?? null,
      mechanical_endurance_class: json.mechanical_endurance_class ?? null,
      electrical_endurance_class: json.electrical_endurance_class ?? null,
      poles: num(json.poles) ?? null,
      settings: json.settings || {}
    };
    res.json(out);
  } catch (e) {
    console.error('[HV AI SPECS] Error:', e);
    res.status(500).json({ error: 'AI specs extraction failed' });
  }
});

const port = process.env.HV_PORT || 3009;
app.listen(port, () => console.log(`HV service running on :${port}`));
