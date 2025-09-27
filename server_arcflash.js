// server_arcflash.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI setup
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[ARCFLASH] OpenAI initialized');
  } catch (e) {
    console.warn('[ARCFLASH] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[ARCFLASH] No OPENAI_API_KEY found');
  openaiError = 'No API key';
}

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
app.get('/api/arcflash/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}

const WHITELIST_SORT = ['name','code','building_code'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'name'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema - Tables for arcflash_checks and arcflash_parameters
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS arcflash_checks (
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        incident_energy NUMERIC NOT NULL,
        ppe_category INTEGER NOT NULL CHECK (ppe_category BETWEEN 0 AND 4),
        status TEXT NOT NULL CHECK (status IN ('safe', 'at-risk', 'incomplete')),
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site)
      );
      CREATE INDEX IF NOT EXISTS idx_arcflash_checks_site ON arcflash_checks(site);

      CREATE TABLE IF NOT EXISTS arcflash_parameters (
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        working_distance NUMERIC NOT NULL DEFAULT 455,
        enclosure_type TEXT DEFAULT 'VCB' CHECK (enclosure_type IN ('VCB', 'VCBB', 'HCB', 'HOA', 'VOA')),
        electrode_gap NUMERIC NOT NULL DEFAULT 32,
        arcing_time NUMERIC NOT NULL DEFAULT 0.2,
        fault_current_ka NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site)
      );
      CREATE INDEX IF NOT EXISTS idx_arcflash_parameters_site ON arcflash_parameters(site);
    `);
    console.log('[ARC SCHEMA] Schema ensured');
  } catch (e) {
    console.error('[ARC SCHEMA] error:', e.message);
    throw e;
  }
}
ensureSchema().catch(e => console.error('[ARC SCHEMA] error:', e.message));

// RESET Arc data
app.post('/api/arcflash/reset', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    await pool.query(`DELETE FROM arcflash_checks WHERE site = $1`, [site]);
    await pool.query(`DELETE FROM arcflash_parameters WHERE site = $1`, [site]);
    
    console.log(`[ARC RESET] Cleared arcflash_checks and arcflash_parameters for site=${site}`);
    res.json({ message: 'Arc data reset successfully' });
  } catch (e) {
    console.error('[ARC RESET] error:', e.message, e.stack);
    res.status(500).json({ error: 'Reset failed', details: e.message });
  }
});

// LIST Arc points
app.get('/api/arcflash/points', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, switchboard, building, floor, sort = 'name', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = ['d.site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(d.name ILIKE $${i} OR s.name ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (switchboard && !isNaN(Number(switchboard))) { where.push(`d.switchboard_id = $${i}`); vals.push(Number(switchboard)); i++; }
    if (building) { where.push(`s.building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`s.floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    const limit = Math.min(parseInt(pageSize,10) || 18, 100);
    const offset = ((parseInt(page,10) || 1) - 1) * limit;

    const sql = `
      SELECT 
        d.id AS device_id, d.name AS device_name, d.device_type, d.in_amps, d.icu_ka, d.voltage_v, d.settings, d.poles,
        s.id AS switchboard_id, s.name AS switchboard_name, s.building_code, s.floor, s.room,
        ac.status, ac.incident_energy, ac.ppe_category,
        ap.working_distance, ap.enclosure_type, ap.electrode_gap, ap.arcing_time, ap.fault_current_ka
      FROM devices d 
      JOIN switchboards s ON d.switchboard_id = s.id 
      LEFT JOIN arcflash_checks ac ON d.id = ac.device_id AND s.id = ac.switchboard_id AND ac.site = $1
      LEFT JOIN arcflash_parameters ap ON d.id = ap.device_id AND s.id = ap.switchboard_id AND ap.site = $1
      WHERE ${where.join(' AND ')}
      ORDER BY d.name ${dirSafe(dir)}
      LIMIT $${i} OFFSET $${i+1}
    `;
    vals.push(limit, offset);
    const { rows: data } = await pool.query(sql, vals);

    const { rows: [{ count: total }] } = await pool.query(
      `SELECT COUNT(*) FROM devices d JOIN switchboards s ON d.switchboard_id = s.id WHERE ${where.join(' AND ')}`,
      vals.slice(0, i-1)
    );

    res.json({ data, total: Number(total) });
  } catch (e) {
    console.error('[ARC POINTS] error:', e.message, e.stack);
    res.status(500).json({ error: 'Points fetch failed', details: e.message });
  }
});

// UPDATE Parameters
app.post('/api/arcflash/parameters', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device_id, switchboard_id, working_distance, enclosure_type, electrode_gap, arcing_time, fault_current_ka, settings, parent_id } = req.body;
    if (!device_id || !switchboard_id) return res.status(400).json({ error: 'Missing IDs' });

    const cleanParentId = (parent_id === '' || parent_id === undefined) ? null : Number(parent_id);

    // Validate parent_id: must exist in devices for the same site and not equal to self
    let validatedParentId = null;
    if (cleanParentId !== null) {
      if (cleanParentId === Number(device_id)) {
        return res.status(400).json({ error: 'Parameters update failed', details: 'parent_id cannot equal device_id' });
      }
      const { rows: parentRows } = await pool.query(`SELECT 1 FROM devices WHERE id = $1 AND site = $2`, [cleanParentId, site]);
      if (!parentRows.length) {
        return res.status(400).json({ error: 'Parameters update failed', details: 'parent_id does not reference a valid device for this site' });
      }
      validatedParentId = cleanParentId;
    }

    await pool.query(`
      INSERT INTO arcflash_parameters (device_id, switchboard_id, site, working_distance, enclosure_type, electrode_gap, arcing_time, fault_current_ka)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET
        working_distance = EXCLUDED.working_distance,
        enclosure_type = EXCLUDED.enclosure_type,
        electrode_gap = EXCLUDED.electrode_gap,
        arcing_time = EXCLUDED.arcing_time,
        fault_current_ka = EXCLUDED.fault_current_ka
    `, [device_id, switchboard_id, site, working_distance || 455, enclosure_type || 'VCB', electrode_gap || 32, arcing_time || 0.2, fault_current_ka]);

    // Update devices settings/parent conditionally; keep existing when undefined
    const settingsValue = (typeof settings === 'undefined') ? null : settings;
    await pool.query(`
      UPDATE devices
      SET settings = COALESCE($1, settings),
          parent_id = $2
      WHERE id = $3 AND site = $4
    `, [settingsValue, validatedParentId, device_id, site]);

    if (validatedParentId) {
      await pool.query(`
        INSERT INTO selectivity_checks (upstream_id, downstream_id, site, status)
        VALUES ($1, $2, $3, 'incomplete')
        ON CONFLICT (upstream_id, downstream_id, site) DO UPDATE SET status = 'incomplete'
      `, [validatedParentId, device_id, site]);
    }

    console.log(`[ARC PARAMS] Updated for device=${device_id}, switchboard=${switchboard_id}`);
    res.json({ message: 'Parameters updated' });
  } catch (e) {
    console.error('[ARC PARAMS] error:', e.message, e.stack);
    res.status(500).json({ error: 'Parameters update failed', details: e.message });
  }
});

// Autofill missing parameters using OpenAI
app.post('/api/arcflash/autofill', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    if (!openai) return res.status(503).json({ error: 'OpenAI unavailable' });

    const devices = await pool.query(`
      SELECT d.id, d.name, d.device_type, d.in_amps, d.icu_ka, d.voltage_v, d.settings, d.parent_id, d.switchboard_id, d.is_main_incoming
      FROM devices d
      WHERE d.site = $1 AND (d.settings IS NULL OR d.settings = '{}'::jsonb OR d.parent_id IS NULL)
    `, [site]);

    if (!devices.rows.length) {
      return res.json({ message: 'No devices with missing parameters' });
    }

    const updates = [];
    for (const device of devices.rows) {
      const { id, device_type, in_amps = 100, icu_ka = 20, voltage_v = 400, switchboard_id, is_main_incoming = false } = device;

      if (is_main_incoming) {
        console.log(`[ARC AUTOFILL] Skipping main breaker ${id} - no autofill needed`);
        continue;
      }

      // Generate settings if missing
      let settings = device.settings || {};
      if (Object.keys(settings).length === 0) {
        const prompt = `Generate realistic protection settings for a ${device_type} breaker with In=${in_amps}A, Icu=${icu_ka}kA, Voltage=${voltage_v}V. Return JSON: {"ir": number, "isd": number, "tsd": number, "ii": number, "ig": number, "tg": number, "zsi": boolean, "erms": boolean, "curve_type": string}`;
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        });
        settings = JSON.parse(completion.choices[0].message.content.trim());
        await pool.query(`UPDATE devices SET settings = $1 WHERE id = $2 AND site = $3`, [settings, id, site]);
        updates.push({ device_id: id, settings });
        console.log(`[ARC AUTOFILL] Generated settings for device ${id}: ${JSON.stringify(settings)}`);
      }

      // Generate parent_id if missing
      if (!device.parent_id) {
        const upstream = await pool.query(`
          SELECT id FROM devices
          WHERE site = $1 AND switchboard_id = $2 AND in_amps >= $3 AND id != $4 AND (name LIKE '%PRINCIPAL%' OR is_main_incoming = true)
          LIMIT 1
        `, [site, switchboard_id, in_amps, id]);
        if (upstream.rows.length) {
          const parent_id = upstream.rows[0].id;
          await pool.query(`UPDATE devices SET parent_id = $1 WHERE id = $2 AND site = $3`, [parent_id, id, site]);
          await pool.query(`
            INSERT INTO selectivity_checks (upstream_id, downstream_id, site, status)
            VALUES ($1, $2, $3, 'incomplete')
            ON CONFLICT (upstream_id, downstream_id, site) DO NOTHING
          `, [parent_id, id, site]);
          updates.push({ device_id: id, parent_id });
          console.log(`[ARC AUTOFILL] Set parent_id=${parent_id} for device ${id}`);
        } else {
          console.warn(`[ARC AUTOFILL] No suitable upstream for device ${id}`);
        }
      }
    }

    res.json({ message: 'Parameters autofilled', updates });
  } catch (e) {
    console.error('[ARC AUTOFILL] error:', e.message, e.stack);
    res.status(500).json({ error: 'Autofill failed', details: e.message });
  }
});

// CHECK Arc Flash
app.get('/api/arcflash/check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard } = req.query;
    if (!device || !switchboard) return res.status(400).json({ error: 'Missing device or switchboard' });

    const r = await pool.query(`
      SELECT d.*, s.regime_neutral, ap.working_distance, ap.enclosure_type, ap.electrode_gap, ap.arcing_time, ap.fault_current_ka,
        fc.fault_level_ka, sc.upstream_id, up.settings AS upstream_settings, up.in_amps AS upstream_in_amps
      FROM devices d 
      JOIN switchboards s ON d.switchboard_id = s.id 
      LEFT JOIN arcflash_parameters ap ON d.id = ap.device_id AND s.id = ap.switchboard_id AND ap.site = $3
      LEFT JOIN fault_checks fc ON d.id = fc.device_id AND s.id = fc.switchboard_id AND fc.site = $3 AND fc.phase_type = 'three'
      LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id AND sc.site = $3
      LEFT JOIN devices up ON sc.upstream_id = up.id
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (!r.rows.length) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    point.voltage_v = point.voltage_v || 400;
    const working_distance = Math.max(point.working_distance || 455, 100);
    const enclosure_type = point.enclosure_type || 'VCB';
    const electrode_gap = point.electrode_gap || 32;
    const fault_current_ka = point.fault_current_ka || point.fault_level_ka || point.icu_ka || 20;

    let arcing_time = point.arcing_time || 0.2;
    if (point.upstream_id) {
      const upstream = { settings: point.upstream_settings || {}, in_amps: point.upstream_in_amps || 100 };
      const calculated_time = calculateTripTime(upstream, fault_current_ka * 1000);
      arcing_time = calculated_time !== Infinity ? calculated_time : arcing_time;
    }

    if (!point.voltage_v || !fault_current_ka) {
      await pool.query(`
        INSERT INTO arcflash_checks (device_id, switchboard_id, site, incident_energy, ppe_category, status)
        VALUES ($1, $2, $3, 0, 0, 'incomplete')
        ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET status = 'incomplete'
      `, [device, switchboard, site]);
      return res.json({ status: 'incomplete', missing: ['voltage_v or fault_current_ka'] });
    }

    const { incident_energy, ppe_category, riskZones } = calculateArcFlash(point, fault_current_ka, arcing_time, working_distance, enclosure_type, electrode_gap);
    const isSafe = ppe_category <= 2;
    const status = isSafe ? 'safe' : 'at-risk';
    const details = `Incident Energy: ${incident_energy} cal/cm², PPE: ${ppe_category}`;

    await pool.query(`
      INSERT INTO arcflash_checks (device_id, switchboard_id, site, incident_energy, ppe_category, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET
        incident_energy = EXCLUDED.incident_energy,
        ppe_category = EXCLUDED.ppe_category,
        status = EXCLUDED.status,
        checked_at = NOW()
    `, [device, switchboard, site, incident_energy, ppe_category, status]);

    res.json({ status, incident_energy, ppe_category, details, remediation: getRemediations(point, incident_energy, ppe_category), riskZones });
  } catch (e) {
    console.error('[ARC CHECK] error:', e.message, e.stack);
    res.status(500).json({ error: 'Check failed', details: e.message });
  }
});

// GET Curves data
app.get('/api/arcflash/curves', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard } = req.query;
    if (!device || !switchboard) return res.status(400).json({ error: 'Missing device or switchboard' });

    const r = await pool.query(`
      SELECT d.*, s.regime_neutral, ap.working_distance, ap.enclosure_type, ap.electrode_gap, ap.arcing_time, ap.fault_current_ka,
        fc.fault_level_ka, sc.upstream_id, up.settings AS upstream_settings, up.in_amps AS upstream_in_amps
      FROM devices d 
      JOIN switchboards s ON d.switchboard_id = s.id 
      LEFT JOIN arcflash_parameters ap ON d.id = ap.device_id AND s.id = ap.switchboard_id AND ap.site = $3
      LEFT JOIN fault_checks fc ON d.id = fc.device_id AND s.id = fc.switchboard_id AND fc.site = $3 AND fc.phase_type = 'three'
      LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id AND sc.site = $3
      LEFT JOIN devices up ON sc.upstream_id = up.id
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (!r.rows.length) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    point.voltage_v = point.voltage_v || 400;
    const working_distance = Math.max(point.working_distance || 455, 100);
    const fault_current_ka = point.fault_current_ka || point.fault_level_ka || point.icu_ka || 20;
    const enclosure_type = point.enclosure_type || 'VCB';
    const electrode_gap = point.electrode_gap || 32;
    
    let arcing_time = point.arcing_time || 0.2;
    if (point.upstream_id) {
      const upstream = { settings: point.upstream_settings || {}, in_amps: point.upstream_in_amps || 100 };
      const calculated_time = calculateTripTime(upstream, fault_current_ka * 1000);
      arcing_time = calculated_time !== Infinity ? calculated_time : arcing_time;
    }

    const curve = generateArcCurve(point, fault_current_ka, arcing_time, enclosure_type, electrode_gap, working_distance);

    res.json({ curve });
  } catch (e) {
    console.error('[ARC CURVES] error:', e.message, e.stack);
    res.status(500).json({ error: 'Curves generation failed', details: e.message });
  }
});

// AI TIP for remediation
app.post('/api/arcflash/ai-tip', async (req, res) => {
  try {
    if (!openai) return res.json({ tip: 'AI tips unavailable' });

    const { query } = req.body;
    const context = query || 'Arc flash advice';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in IEEE 1584 arc flash calculations. Provide concise advice based on "${context}". Reference standards, suggest mitigations like PPE or engineering controls. 1-2 sentences.` 
        },
        { role: 'user', content: context }
      ],
      max_tokens: 120,
      temperature: 0.3
    });

    const tip = completion.choices[0].message.content.trim();
    res.json({ tip });
  } catch (e) {
    console.error('[AI TIP] error:', e.message, e.stack);
    res.status(500).json({ error: 'AI tip failed', details: e.message });
  }
});

// Helper functions
function calculateArcFlash(point, faultKa, arcingTime, workingDistMm, enclosure, gap) {
  const V = point.voltage_v / 1000; // kV
  const Ibf = faultKa; // kA
  const t = Math.max(arcingTime, 0.01); // Minimum 10 ms
  const D = Math.max(workingDistMm / 25.4, 3.94); // Minimum 100 mm (3.94 inches)
  const G = gap / 25.4; // inches

  // Arcing current Ia (simplifié)
  const lgIa = 0.00402 + 0.983 * Math.log10(Ibf);
  const Ia = Math.pow(10, lgIa);

  // Incident energy E (simplifié)
  const k1 = enclosure === 'VCB' ? -0.097 : -0.555;
  const lgE = 1.081 * Math.log10(Ia) + 0.0011 * G + 1.9593 * Math.log10(t) + k1 + 1.0;
  let E = Math.pow(10, lgE) * 4.184 * (610 / workingDistMm) ** 2;

  E = Math.max(E, 0.1); // Minimum 0.1 cal/cm²

  // PPE category
  let ppe = 0;
  if (E > 40) ppe = 4;
  else if (E > 25) ppe = 3;
  else if (E > 8) ppe = 2;
  else if (E > 1.2) ppe = 1;

  const riskZones = E > 1.2 ? [{ min: 1.2, max: E }] : [];

  console.log(`[ARC CALC] E=${E} cal/cm², PPE=${ppe} for V=${V}kV, Ibf=${Ibf}kA, t=${t}s, D=${workingDistMm}mm`);

  return { incident_energy: Math.round(E * 100) / 100, ppe_category: ppe, riskZones };
}

function getRemediations(point, E, ppe) {
  return [
    `Require PPE Category ${ppe} (IEC 61482 compliant)`,
    'Reduce arcing time via faster protection (IEC 60947-2)',
    'Increase working distance or use arc-resistant switchgear (IEC TR 61641)'
  ];
}

function generateArcCurve(point, faultKa, arcingTime, enclosure, gap) {
  const points = [];
  const V = point.voltage_v / 1000;
  const Ibf = faultKa;
  const t = Math.max(arcingTime, 0.01);
  const G = gap / 25.4;

  const lgIa = 0.00402 + 0.983 * Math.log10(Ibf);
  const Ia = Math.pow(10, lgIa);

  for (let dist = 100; dist <= 1000; dist += 50) { // mm
    const D = dist / 25.4;
    const k1 = enclosure === 'VCB' ? -0.097 : -0.555;
    const lgE = 1.081 * Math.log10(Ia) + 0.0011 * G + 1.9593 * Math.log10(t) + k1 + 1.0;
    let E = Math.pow(10, lgE) * 4.184 * (610 / dist) ** 2; // cal/cm²
    E = Math.max(E, 0.1);
    points.push({ distance: dist, energy: Math.round(E * 100) / 100 });
  }
  
  console.log(`[ARC CURVES] Generated ${points.length} points, sample: ${JSON.stringify(points[0])}`);
  
  return points;
}

function calculateTripTime(device, I) {
  const { settings = {}, in_amps: In = 100 } = device;
  const Ir = settings.ir || 1;
  const Tr = settings.tr || 10;
  const Isd = settings.isd || 6;
  const Tsd = settings.tsd || 0.1;
  const Ii = settings.ii || 10;

  if (I > Ii * Ir * In) return 0.01;
  if (I > Isd * Ir * In) return Tsd;
  if (I > Ir * In) return Tr / ((I / (Ir * In)) ** 2 - 1);
  return Infinity;
}

const port = process.env.ARCFLASH_PORT || 3006;
app.listen(port, () => console.log(`ArcFlash service running on :${port}`));
