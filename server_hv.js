// server_hv.js
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
    console.log('[HV] OpenAI initialized');
  } catch (e) {
    console.warn('[HV] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[HV] No OPENAI_API_KEY found');
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
app.get('/api/hv/health', (_req, res) => {
  console.log('[HV HEALTH] Request received');
  res.json({ ok: true, ts: Date.now(), openai: !!openai });
});

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}

const WHITELIST_SORT = ['created_at', 'name', 'code', 'building_code', 'floor'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'created_at'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema
async function ensureSchema() {
  try {
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
      CREATE INDEX IF NOT EXISTS idx_hv_equipments_building ON hv_equipments(building_code);
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
      CREATE INDEX IF NOT EXISTS idx_hv_devices_manufacturer ON hv_devices(manufacturer);
      CREATE INDEX IF NOT EXISTS idx_hv_devices_name ON hv_devices(name);
      CREATE INDEX IF NOT EXISTS idx_hv_devices_downstream_device ON hv_devices(downstream_device_id);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'hv_devices' AND column_name = 'downstream_device_id') THEN
          ALTER TABLE hv_devices ADD COLUMN downstream_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    console.log('[HV SCHEMA] Schema ensured');
  } catch (e) {
    console.error('[HV SCHEMA] Error:', e.message);
    throw e;
  }
}
ensureSchema().catch(e => console.error('[HV SCHEMA] Init error:', e.message));

// LIST HV Equipments
app.get('/api/hv/equipments', async (req, res) => {
  try {
    console.log('[HV LIST] Request:', req.query);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

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
    console.log('[HV LIST] Success: Returned', rows.rows.length, 'rows');
    res.json({ data: rows.rows, total: count.rows[0].total });
  } catch (e) {
    console.error('[HV LIST] Error:', e.message, e.stack);
    res.status(500).json({ error: 'List failed', details: e.message });
  }
});

// CREATE HV Equipment
app.post('/api/hv/equipments', async (req, res) => {
  try {
    console.log('[HV CREATE] Request body:', req.body);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });

    const r = await pool.query(`
      INSERT INTO hv_equipments (site, name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [site, name, code, building_code, floor, room, regime_neutral, is_principal, modes || {}, quality || {}]);

    console.log('[HV CREATE] Success: Created equipment', r.rows[0].id);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('[HV CREATE] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Create failed', details: e.message });
  }
});

// GET One HV Equipment (row only)
app.get('/api/hv/equipments/:id', async (req, res) => {
  try {
    console.log('[HV GET] Request for ID:', req.params.id);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const r = await pool.query(`SELECT * FROM hv_equipments WHERE id = $1 AND site = $2`, [Number(req.params.id), site]);
    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });

    res.json(r.rows[0]);
  } catch (e) {
    console.error('[HV GET] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Get failed', details: e.message });
  }
});

// UPDATE HV Equipment
app.put('/api/hv/equipments/:id', async (req, res) => {
  try {
    console.log('[HV UPDATE] Request for ID:', req.params.id, 'Body:', req.body);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { name, code, building_code, floor, room, regime_neutral, is_principal, modes, quality } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });

    const r = await pool.query(`
      UPDATE hv_equipments 
      SET name = $3, code = $4, building_code = $5, floor = $6, room = $7, regime_neutral = $8, is_principal = $9, modes = $10, quality = $11
      WHERE id = $1 AND site = $2
      RETURNING *
    `, [Number(req.params.id), site, name, code, building_code, floor, room, regime_neutral, is_principal, modes || {}, quality || {}]);

    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });

    console.log('[HV UPDATE] Success: Updated equipment', r.rows[0].id);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[HV UPDATE] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Update failed', details: e.message });
  }
});

// DUPLICATE HV Equipment (+ devices)
app.post('/api/hv/equipments/:id/duplicate', async (req, res) => {
  try {
    console.log('[HV DUPLICATE] Request for ID:', req.params.id);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [site, r.rows[0].id, d.parent_id, d.downstream_hv_equipment_id, d.downstream_device_id, d.name, d.device_type, d.manufacturer, d.reference, d.voltage_class_kv, d.short_circuit_current_ka, d.insulation_type, d.mechanical_endurance_class, d.electrical_endurance_class, d.poles, d.settings, d.is_main_incoming, d.pv_tests, d.photos]);
    }
    console.log('[HV DUPLICATE] Success: Duplicated equipment', r.rows[0].id);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[HV DUPLICATE] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Duplicate failed', details: e.message });
  }
});

// DELETE HV Equipment
app.delete('/api/hv/equipments/:id', async (req, res) => {
  try {
    console.log('[HV DELETE] Request for ID:', req.params.id);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const r = await pool.query(`DELETE FROM hv_equipments WHERE id = $1 AND site = $2 RETURNING *`, [Number(req.params.id), site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    console.log('[HV DELETE] Success: Deleted equipment', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('[HV DELETE] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Delete failed', details: e.message });
  }
});

// LIST HV Devices for a HV Equipment (flat list)
app.get('/api/hv/equipments/:id/devices', async (req, res) => {
  try {
    console.log('[HV DEVICES LIST] Request for equipment ID:', req.params.id);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const r = await pool.query(`
      WITH RECURSIVE device_tree AS (
        SELECT *, NULL::integer AS parent_id FROM hv_devices WHERE hv_equipment_id = $1 AND parent_id IS NULL
        UNION ALL
        SELECT d.*, t.id AS parent_id FROM hv_devices d
        JOIN device_tree t ON d.parent_id = t.id
      )
      SELECT * FROM device_tree WHERE site = $2 ORDER BY id ASC
    `, [Number(req.params.id), site]);
    console.log('[HV DEVICES LIST] Success: Returned', r.rows.length, 'devices');
    res.json(r.rows);
  } catch (e) {
    console.error('[HV DEVICES LIST] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Devices list failed', details: e.message });
  }
});

// CREATE HV Device
app.post('/api/hv/equipments/:id/devices', async (req, res) => {
  try {
    console.log('[HV DEVICE CREATE] Request for equipment ID:', req.params.id, 'Body:', req.body);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const hv_equipment_id = Number(req.params.id);
    const { name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings, is_main_incoming, parent_id, downstream_hv_equipment_id, downstream_device_id } = req.body;
    if (!device_type) return res.status(400).json({ error: 'Device type is required' });

    const r = await pool.query(`
      INSERT INTO hv_devices (site, hv_equipment_id, parent_id, downstream_hv_equipment_id, downstream_device_id, name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings, is_main_incoming)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [site, hv_equipment_id, parent_id ? Number(parent_id) : null, downstream_hv_equipment_id ? Number(downstream_hv_equipment_id) : null, downstream_device_id ? Number(downstream_device_id) : null, name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings || {}, is_main_incoming]);

    await triggerAutoChecks(r.rows[0].id, hv_equipment_id);
    console.log('[HV DEVICE CREATE] Success: Created device', r.rows[0].id);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('[HV DEVICE CREATE] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Create failed', details: e.message });
  }
});

// UPDATE HV Device
app.put('/api/hv/devices/:id', async (req, res) => {
  try {
    console.log('[HV DEVICE UPDATE] Request for device ID:', req.params.id, 'Body:', req.body);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const { name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings, is_main_incoming, parent_id, downstream_hv_equipment_id, downstream_device_id } = req.body;
    if (!device_type) return res.status(400).json({ error: 'Device type is required' });

    const r = await pool.query(`
      UPDATE hv_devices 
      SET name = $3, device_type = $4, manufacturer = $5, reference = $6, voltage_class_kv = $7, short_circuit_current_ka = $8, insulation_type = $9, mechanical_endurance_class = $10, electrical_endurance_class = $11, poles = $12, settings = $13, is_main_incoming = $14, parent_id = $15, downstream_hv_equipment_id = $16, downstream_device_id = $17, updated_at = NOW()
      WHERE id = $1 AND site = $2
      RETURNING *
    `, [Number(req.params.id), site, name, device_type, manufacturer, reference, voltage_class_kv, short_circuit_current_ka, insulation_type, mechanical_endurance_class, electrical_endurance_class, poles, settings || {}, is_main_incoming, parent_id ? Number(parent_id) : null, downstream_hv_equipment_id ? Number(downstream_hv_equipment_id) : null, downstream_device_id ? Number(downstream_device_id) : null]);

    if (r.rows.length !== 1) return res.status(404).json({ error: 'Not found' });

    await triggerAutoChecks(r.rows[0].id, r.rows[0].hv_equipment_id);
    console.log('[HV DEVICE UPDATE] Success: Updated device', r.rows[0].id);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[HV DEVICE UPDATE] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Update failed', details: e.message });
  }
});

// DELETE HV Device
app.delete('/api/hv/devices/:id', async (req, res) => {
  try {
    console.log('[HV DEVICE DELETE] Request for device ID:', req.params.id);
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const r = await pool.query(`DELETE FROM hv_devices WHERE id = $1 AND site = $2 RETURNING *`, [Number(req.params.id), site]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    console.log('[HV DEVICE DELETE] Success: Deleted device', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('[HV DEVICE DELETE] Error:', e.message, e.stack);
    res.status(500).json({ error: 'Delete failed', details: e.message });
  }
});

// AI helper (new): generate HV specs from description
app.post('/api/hv/ai/specs', async (req, res) => {
  try {
    const description = req.body || {};
    const specs = await getAiDeviceSpecs(description);
    res.json(specs || {});
  } catch (e) {
    console.error('[HV AI SPECS] Endpoint error:', e.message);
    res.status(500).json({ error: 'AI specs failed', details: e.message });
  }
});

// Fonction pour trigger auto checks (piocher dans tables existantes sans modifier servers)
async function triggerAutoChecks(hvDeviceId, hvEquipmentId) {
  try {
    console.log('[HV AUTO CHECKS] Triggering for device ID:', hvDeviceId);
    const hvDev = await pool.query(`SELECT * FROM hv_devices WHERE id = $1`, [hvDeviceId]);
    if (hvDev.rows.length === 0) {
      console.error('[HV AUTO CHECKS] Device not found:', hvDeviceId);
      return;
    }
    const d = hvDev.rows[0];
    if (d.downstream_device_id) {
      console.log('[HV AUTO CHECKS] Checking selectivity for HV:', hvDeviceId, 'BT:', d.downstream_device_id);
      const sel = await pool.query(`
        SELECT * FROM selectivity_checks 
        WHERE upstream_id = $1 AND downstream_id = $2 AND site = $3
      `, [hvDeviceId, d.downstream_device_id, d.site]);
      // No direct calc (respect existing servers)
    }
  } catch (e) {
    console.error('[HV AUTO CHECKS] Error:', e.message, e.stack);
  }
}

// AI pour specs HV
async function getAiDeviceSpecs(description) {
  if (!openai) {
    console.warn('[HV AI SPECS] OpenAI not available');
    return {};
  }

  try {
    console.log('[HV AI SPECS] Processing description:', description);
    const prompt = `Based on this HV device description: "${JSON.stringify(description)}"

    Generate complete technical specifications for this high voltage electrical device per IEC 62271. Use realistic values based on the identified manufacturer and type.

    Return JSON with:
    - device_type
    - voltage_class_kv
    - short_circuit_current_ka
    - insulation_type
    - mechanical_endurance_class
    - electrical_endurance_class
    - poles
    - settings {distance_zone, differential_bias, overcurrent}

    If uncertain, use null. Output ONLY valid JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an electrical engineering expert in HV. Generate realistic specs.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 600
    });

    const specs = JSON.parse(completion.choices[0].message.content);

    const safeNumber = (val) => {
      const num = Number(val);
      return isNaN(num) ? null : num;
    };

    const result = {
      device_type: specs.device_type || 'HV Circuit Breaker',
      voltage_class_kv: safeNumber(specs.voltage_class_kv),
      short_circuit_current_ka: safeNumber(specs.short_circuit_current_ka),
      insulation_type: specs.insulation_type || null,
      mechanical_endurance_class: specs.mechanical_endurance_class || null,
      electrical_endurance_class: specs.electrical_endurance_class || null,
      poles: safeNumber(specs.poles) ?? 3,
      settings: specs.settings || {}
    };
    console.log('[HV AI SPECS] Success:', result);
    return result;
  } catch (e) {
    console.error('[HV AI SPECS] Error:', e.message, e.stack);
    return {};
  }
}

const port = process.env.HV_PORT || 3009;
app.listen(port, () => console.log(`HV service running on :${port}`));
