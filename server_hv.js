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

// --- OpenAI setup -----------------------------------------------------------
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (e) { console.warn('[HV] OpenAI init failed:', e.message); }

// --- App --------------------------------------------------------------------
const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// Uploads (memory) for photos
const upload = multer({ memoryStorage: true, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB/photo

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
app.get('/api/hv/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) { return (req.header('X-Site') || req.query.site || '').toString(); }
const WHITELIST_SORT = ['created_at','name','code','building_code','floor'];
const sortSafe = (s) => (WHITELIST_SORT.includes(String(s)) ? s : 'created_at');
const dirSafe = (d) => (String(d).toLowerCase() === 'asc' ? 'ASC' : 'DESC');

// --- Schema -----------------------------------------------------------------
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
    CREATE INDEX IF NOT EXISTS idx_hv_equipments_site ON hv_equipments(site);
    CREATE INDEX IF NOT EXISTS idx_hv_equipments_code ON hv_equipments(code);

    CREATE TABLE IF NOT EXISTS hv_devices (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      hv_equipment_id INTEGER REFERENCES hv_equipments(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES hv_devices(id) ON DELETE SET NULL,
      downstream_hv_equipment_id INTEGER REFERENCES hv_equipments(id) ON DELETE SET NULL,
      downstream_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
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
      pv_tests BYTEA,
      photos BYTEA[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_hv_devices_hv_equipment ON hv_devices(hv_equipment_id);
    CREATE INDEX IF NOT EXISTS idx_hv_devices_parent ON hv_devices(parent_id);
    CREATE INDEX IF NOT EXISTS idx_hv_devices_site ON hv_devices(site);
    CREATE INDEX IF NOT EXISTS idx_hv_devices_reference ON hv_devices(reference);
    CREATE INDEX IF NOT EXISTS idx_hv_devices_downstream ON hv_devices(downstream_hv_equipment_id);
    CREATE INDEX IF NOT EXISTS idx_hv_devices_downstream_device ON hv_devices(downstream_device_id);
  `);
}
ensureSchema().catch(e => console.error('[HV SCHEMA] error:', e.message));

// --- HV Equipments CRUD -----------------------------------------------------
app.get('/api/hv/equipments', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, building, floor, room, sort = 'created_at', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = ['site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(name ILIKE $${i} OR code ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (building) { where.push(`building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    if (room) { where.push(`room ILIKE $${i}`); vals.push(`%${room}%`); i++; }
    const limit = Math.min(parseInt(pageSize,10) || 18, 100);
    const offset = ((parseInt(page,10) || 1) - 1) * limit;

    const sql = `
      SELECT *, (SELECT COUNT(*) FROM hv_devices WHERE hv_equipment_id = hv_equipments.id)::int AS devices_count
      FROM hv_equipments
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortSafe(sort)} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM hv_equipments WHERE ${where.join(' AND ')}`, vals);
    res.json({ data: rows.rows, total: count.rows[0].total });
  } catch (e) { console.error('[HV LIST] error:', e); res.status(500).json({ error: 'List failed' }); }
});

app.get('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`SELECT * FROM hv_equipments WHERE id = $1 AND site = $2`, [Number(req.params.id), site]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error('[HV GET] error:', e); res.status(500).json({ error: 'Get failed' }); }
});

app.post('/api/hv/equipments', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality } = req.body;
    const r = await pool.query(`
      INSERT INTO hv_equipments (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [site, name, code, building_code, floor, room, regime_neutral, is_principal, modes || {}, quality || {}]);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error('[HV CREATE] error:', e); res.status(500).json({ error: 'Create failed' }); }
});

app.put('/api/hv/equipments/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality } = req.body;
    const r = await pool.query(`
      UPDATE hv_equipments SET name = $3, code = $4, building_code = $5, floor = $6, room = $7, regime_neutral = $8, is_principal = $9, modes = $10, quality = $11
      WHERE id = $1 AND site = $2
      RETURNING *
    `, [Number(req.params.id), site, name, code, building_code, floor, room, regime_neutral, is_principal, modes || {}, quality || {}]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error('[HV UPDATE] error:', e); res.status(500).json({ error: 'Update failed' }); }
});

app.post('/api/hv/equipments/:id/duplicate', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const id = Number(req.params.id);
    const orig = await pool.query(`SELECT * FROM hv_equipments WHERE id = $1 AND site = $2`, [id, site]);
    if (orig.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    const o = orig.rows[0];
    const r = await pool.query(`
      INSERT INTO hv_equipments (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [site, `${o.name} (copy)`, `${o.code}-copy`, o.building_code, o.floor, o.room, o.regime_neutral, o.is_principal, o.modes, o.quality]);

    const devices = await pool.query(`SELECT * FROM hv_devices WHERE hv_equipment_id = $1`, [id]);
    for (const d of devices.rows) {
      await pool.query(`
        INSERT INTO hv_devices (site, hv_equipment_id, parent_id, downstream_hv_equipment_id, downstream_device_id, name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings, is_main_incoming, pv_tests, photos)
        VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [site, r.rows[0].id, d.downstream_device_id, d.name, d.device_type, d.manufacturer, d.reference, d.voltage_class_kv, d.short_circuit_current_ka, d.insulation_type, d.mechanical_endurance_class, d.electrical_endurance_class, d.poles, d.settings, d.is_main_incoming, d.pv_tests, d.photos]);
    }
    res.json(r.rows[0]);
  } catch (e) { console.error('[HV DUPLICATE] error:', e); res.status(500).json({ error: 'Duplicate failed' }); }
});

app.delete('/api/hv/equipments/:id', async (req, res) => {
  try { const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' }); await pool.query(`DELETE FROM hv_equipments WHERE id = $1 AND site = $2`, [Number(req.params.id), site]); res.json({ message: 'Deleted' }); }
  catch (e) { console.error('[HV DELETE] error:', e); res.status(500).json({ error: 'Delete failed' }); }
});

// --- Suggestions / Search ---------------------------------------------------
app.get('/api/hv/lv-devices', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q } = req.query;
    const where = ['d.site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(d.name ILIKE $${i} OR d.reference ILIKE $${i} OR s.name ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const sql = `
      SELECT d.id, d.name, d.reference, d.device_type, s.name AS switchboard_name
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      WHERE ${where.join(' AND ')}
      ORDER BY d.name ASC
      LIMIT 50
    `;
    const rows = await pool.query(sql, vals);
    res.json(rows.rows);
  } catch (e) { console.error('[HV LV SUGGEST] error:', e); res.status(500).json({ error: 'Suggestions failed' }); }
});

app.get('/api/hv/devices/search', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q } = req.query; if (!q) return res.json([]);
    const rows = await pool.query(`
      SELECT id, name, device_type, manufacturer, reference
      FROM hv_devices
      WHERE site = $1 AND (name ILIKE $2 OR reference ILIKE $2 OR manufacturer ILIKE $2)
      ORDER BY name ASC
      LIMIT 50
    `, [site, `%${q}%`]);
    res.json(rows.rows);
  } catch (e) { console.error('[HV DEV SEARCH] error:', e); res.status(500).json({ error: 'Search failed' }); }
});

app.get('/api/hv/equipments/search', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q } = req.query; if (!q) return res.json([]);
    const rows = await pool.query(`
      SELECT id, name, code
      FROM hv_equipments
      WHERE site = $1 AND (name ILIKE $2 OR code ILIKE $2)
      ORDER BY name ASC
      LIMIT 50
    `, [site, `%${q}%`]);
    res.json(rows.rows);
  } catch (e) { console.error('[HV EQ SEARCH] error:', e); res.status(500).json({ error: 'Search failed' }); }
});

// --- HV Devices CRUD --------------------------------------------------------
app.get('/api/hv/equipments/:id/devices', async (req, res) => {
  try { const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' }); const r = await pool.query(`SELECT * FROM hv_devices WHERE hv_equipment_id = $1 AND site = $2 ORDER BY id ASC`, [Number(req.params.id), site]); res.json(r.rows); }
  catch (e) { console.error('[HV DEVICES LIST] error:', e); res.status(500).json({ error: 'Devices list failed' }); }
});

app.post('/api/hv/equipments/:id/devices', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const hv_equipment_id = Number(req.params.id);
    const { name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings, is_main_incoming, parent_id, downstream_hv_equipment_id, downstream_device_id } = req.body;
    const r = await pool.query(`
      INSERT INTO hv_devices (site, hv_equipment_id, parent_id, downstream_hv_equipment_id, downstream_device_id, name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings, is_main_incoming)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [site, hv_equipment_id, parent_id ? Number(parent_id) : null, downstream_hv_equipment_id ? Number(downstream_hv_equipment_id) : null, downstream_device_id ? Number(downstream_device_id) : null, name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings || {}, is_main_incoming]);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error('[HV DEVICE CREATE] error:', e); res.status(500).json({ error: 'Create failed' }); }
});

app.put('/api/hv/devices/:id', async (req, res) => {
  try {
    const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' });
    const { name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings, is_main_incoming, parent_id, downstream_hv_equipment_id, downstream_device_id } = req.body;
    const r = await pool.query(`
      UPDATE hv_devices SET name = $3, device_type = $4, manufacturer = $5, reference = $6, voltage_class_kv = $7, short_circuit_current_ka = $8, insulation_type = $9, mechanical_endurance_class = $10, electrical_endurance_class = $11, poles = $12, settings = $13, is_main_incoming = $14, parent_id = $15, downstream_hv_equipment_id = $16, downstream_device_id = $17, updated_at = NOW()
      WHERE id = $1 AND site = $2
      RETURNING *
    `, [Number(req.params.id), site, name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings || {}, is_main_incoming, parent_id ? Number(parent_id) : null, downstream_hv_equipment_id ? Number(downstream_hv_equipment_id) : null, downstream_device_id ? Number(downstream_device_id) : null]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error('[HV DEVICE UPDATE] error:', e); res.status(500).json({ error: 'Update failed' }); }
});

app.delete('/api/hv/devices/:id', async (req, res) => {
  try { const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' }); await pool.query(`DELETE FROM hv_devices WHERE id = $1 AND site = $2`, [Number(req.params.id), site]); res.json({ message: 'Deleted' }); }
  catch (e) { console.error('[HV DEVICE DELETE] error:', e); res.status(500).json({ error: 'Delete failed' }); }
});

// --- Photos -----------------------------------------------------------------
app.post('/api/hv/devices/:id/photos', upload.array('photos', 12), async (req, res) => {
  try { const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' }); const id = Number(req.params.id); const dev = await pool.query(`SELECT id, photos FROM hv_devices WHERE id = $1 AND site = $2`, [id, site]); if (dev.rows.length !== 1) return res.status(404).json({ error: 'Not found' }); const photos = dev.rows[0].photos || []; for (const f of req.files || []) { photos.push(f.buffer); } await pool.query(`UPDATE hv_devices SET photos = $2, updated_at = NOW() WHERE id = $1`, [id, photos]); res.json({ ok: true, count: photos.length }); }
  catch (e) { console.error('[HV PHOTO UPLOAD] error:', e); res.status(500).json({ error: 'Upload failed' }); }
});

app.get('/api/hv/devices/:id/photos/:idx', async (req, res) => {
  try { const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' }); const id = Number(req.params.id); const idx = Number(req.params.idx); const dev = await pool.query(`SELECT photos FROM hv_devices WHERE id = $1 AND site = $2`, [id, site]); if (dev.rows.length !== 1) return res.status(404).json({ error: 'Not found' }); const arr = dev.rows[0].photos || []; if (!arr[idx]) return res.status(404).json({ error: 'No photo at idx' }); res.setHeader('Content-Type', 'image/jpeg'); res.send(arr[idx]); }
  catch (e) { console.error('[HV PHOTO GET] error:', e); res.status(500).json({ error: 'Get photo failed' }); }
});

// --- AI ---------------------------------------------------------------------
async function getAiDeviceSpecs(description) {
  if (!openai) return {};
  try {
    const prompt = `Based on this HV device description: "${JSON.stringify(description)}"\n\nGenerate complete technical specifications for this high voltage electrical device per IEC 62271. Use realistic values based on the identified manufacturer and type.\n\nReturn JSON with: device_type, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings. If uncertain, use null. Output ONLY valid JSON.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [ { role: 'system', content: 'You are an electrical engineering expert in HV.' }, { role: 'user', content: prompt } ],
      response_format: { type: 'json_object' }, temperature: 0.2, max_tokens: 600
    });
    const specs = JSON.parse(completion.choices[0].message.content);
    const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
    const vc = n(specs.voltage_class_kv), icc = n(specs.short_circuit_current_ka), poles = n(specs.poles);
    return {
      device_type: specs.device_type || 'HV Circuit Breaker',
      voltage_class_kv: vc !== null && vc >= 3 && vc <= 245 ? vc : null,
      short_circuit_current_ka: icc !== null && icc >= 10 && icc <= 80 ? icc : null,
      insulation_type: specs.insulation_type || null,
      mechanical_endurance_class: specs.mechanical_endurance_class || null,
      electrical_endurance_class: specs.electrical_endurance_class || null,
      poles: poles !== null && poles >= 1 && poles <= 3 ? poles : null,
      settings: specs.settings || {}
    };
  } catch (e) { console.error('[HV AI SPECS] error:', e); return {}; }
}

app.post('/api/hv/devices/suggest-specs', async (req, res) => {
  try { const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' }); const { description } = req.body; const specs = await getAiDeviceSpecs(description || {}); res.json(specs); }
  catch (e) { console.error('[HV SUGGEST SPECS] error:', e); res.status(500).json({ error: 'Suggest failed' }); }
});

app.post('/api/hv/devices/:id/analyze', async (req, res) => {
  try { const site = siteOf(req); if (!site) return res.status(400).json({ error: 'Missing site' }); const id = Number(req.params.id); const dev = await pool.query(`SELECT name, manufacturer, reference FROM hv_devices WHERE id = $1 AND site = $2`, [id, site]); if (dev.rows.length !== 1) return res.status(404).json({ error: 'Not found' }); const description = { ...(req.body?.description || {}), ...dev.rows[0] }; const specs = await getAiDeviceSpecs(description); res.json(specs); }
  catch (e) { console.error('[HV ANALYZE] error:', e); res.status(500).json({ error: 'Analyze failed' }); }
});

// --- 404 & Error handlers (always JSON) ------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path, method: req.method });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[HV ERROR]', err);
  res.status(500).json({ error: 'Internal error', message: err?.message || 'unknown' });
});

// --- Start ------------------------------------------------------------------
const port = process.env.HV_PORT || 3009;
app.listen(port, () => console.log(`HV service running on :${port}`));
