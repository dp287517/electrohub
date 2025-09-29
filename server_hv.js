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

// ---------- Helpers (AI parsing/normalization) ----------
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
  // strip fences
  const fenced = content.replace(/```json|```/g, '');
  // first {...}
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  const slice = (start >= 0 && end > start) ? fenced.slice(start, end + 1) : fenced;
  try { return JSON.parse(slice); } catch { return {}; }
};

// ---------------- IA: specs à partir de texte + photos (robuste) ----------------
app.post('/api/hv/ai/specs', upload.array('photos', 5), async (req, res) => {
  try {
    const manufacturer_hint = req.body.manufacturer || '';
    const reference_hint = req.body.reference || '';
    const device_type_hint = req.body.device_type || '';
    const files = req.files || [];

    if (!openai) {
      return res.status(503).json({ error: 'OpenAI not available. Set OPENAI_API_KEY.' });
    }

    // Convert images to data URLs for Vision
    const imageParts = (files || []).map(f => {
      const base64 = Buffer.from(f.buffer).toString('base64');
      const mime = f.mimetype || 'image/jpeg';
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };
    });

    const messages = [
      { role: 'system', content: 'You are an electrical engineering expert (IEC 62271 HV). Extract realistic specs as pure JSON.' },
      { role: 'user', content: [
        { type: 'text', text:
`Manufacturer (hint): ${manufacturer_hint}
Reference (hint): ${reference_hint}
Device type (hint): ${device_type_hint}

From these images, extract fields if visible:
- manufacturer, reference
- device_type
- voltage_class_kv, short_circuit_current_ka, poles
- insulation_type (SF6/Vacuum/Air)
- mechanical_endurance_class (M1/M2)
- electrical_endurance_class (E1/E2)
Return ONLY a JSON object, no prose.` },
        ...imageParts
      ]}
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 700
    });

    const content = completion.choices?.[0]?.message?.content || '';
    let json = safeJsonFromContent(content);

    // Normalize
    const outRaw = {
      manufacturer: json.manufacturer ?? null,
      reference: json.reference ?? null,
      device_type: json.device_type ?? null,
      voltage_class_kv: parseNum(json.voltage_class_kv),
      short_circuit_current_ka: parseNum(json.short_circuit_current_ka),
      insulation_type: json.insulation_type ?? null,
      mechanical_endurance_class: sanitizeClass(json.mechanical_endurance_class, ['M1','M2']),
      electrical_endurance_class: sanitizeClass(json.electrical_endurance_class, ['E1','E2']),
      poles: parsePoles(json.poles),
      settings: json.settings || {}
    };

    // Drop non-informative values & avoid blocking "empty" detection on front
    const out = {};
    for (const [k, v] of Object.entries(outRaw)) {
      if (v === null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)) continue;
      // don't include device_type if it's only equal to the hint
      if (k === 'device_type' && v === device_type_hint) continue;
      out[k] = v;
    }

    return res.json(out); // could be {} if nothing useful
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const detail =
      e?.response?.data?.error?.message ||
      e?.error?.message ||
      e?.message ||
      'Unknown error';

    console.error('[HV AI SPECS] OpenAI error:', {
      status,
      code: e?.code,
      type: e?.type,
      message: e?.message,
      response: e?.response?.data || null
    });

    if (status === 401) return res.status(401).json({ error: 'Unauthorized (check OPENAI_API_KEY)', details: detail });
    if (status === 404) return res.status(404).json({ error: 'Model not found', details: detail });
    if (status === 429) return res.status(429).json({ error: 'Rate limit or quota exceeded', details: detail });
    if (status === 400) return res.status(400).json({ error: 'Invalid request to OpenAI', details: detail });
    if (status === 503) return res.status(503).json({ error: 'OpenAI service unavailable', details: detail });

    return res.status(500).json({ error: 'AI specs extraction failed', details: detail });
  }
});

const port = process.env.HV_PORT || 3009;
app.listen(port, () => console.log(`HV service running on :${port}`));
