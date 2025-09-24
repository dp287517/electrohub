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
        working_distance NUMERIC NOT NULL DEFAULT 455,  -- mm, default IEEE
        enclosure_type TEXT DEFAULT 'VCB' CHECK (enclosure_type IN ('VCB', 'VCBB', 'HCB', 'HOA', 'VOA')),
        electrode_gap NUMERIC NOT NULL DEFAULT 32,  -- mm
        arcing_time NUMERIC NOT NULL DEFAULT 0.2,  -- seconds, from selectivity if available
        fault_current_ka NUMERIC,  -- from faultlevel if available
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

// LIST Arc points (based on switchboards/devices)
app.get('/api/arcflash/points', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, switchboard, building, floor, sort = 'name', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = ['d.site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(d.name ILIKE $${i} OR s.name ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (switchboard) { where.push(`d.switchboard_id = $${i}`); vals.push(Number(switchboard)); i++; }
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
      ORDER BY ${sortSafe(sort)} ${dirSafe(dir)}
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
    const { device_id, switchboard_id, working_distance, enclosure_type, electrode_gap, arcing_time, fault_current_ka } = req.body;
    if (!device_id || !switchboard_id) return res.status(400).json({ error: 'Missing IDs' });

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

    console.log(`[ARC PARAMS] Updated for device=${device_id}, switchboard=${switchboard_id}`);
    res.json({ message: 'Parameters updated' });
  } catch (e) {
    console.error('[ARC PARAMS] error:', e.message, e.stack);
    res.status(500).json({ error: 'Parameters update failed', details: e.message });
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
        fc.fault_level_ka  -- Join with fault_checks for fault_current if available
      FROM devices d 
      JOIN switchboards s ON d.switchboard_id = s.id 
      LEFT JOIN arcflash_parameters ap ON d.id = ap.device_id AND s.id = ap.switchboard_id AND ap.site = $3
      LEFT JOIN fault_checks fc ON d.id = fc.device_id AND s.id = fc.switchboard_id AND fc.site = $3 AND fc.phase_type = 'three'
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (!r.rows.length) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    point.voltage_v = point.voltage_v || 400;
    const working_distance = point.working_distance || 455; // mm
    const enclosure_type = point.enclosure_type || 'VCB';
    const electrode_gap = point.electrode_gap || 32; // mm
    const arcing_time = point.arcing_time || 0.2; // s (from selectivity if integrated)
    const fault_current_ka = point.fault_current_ka || point.fault_level_ka || 20; // kA, default or from faultlevel

    if (!point.voltage_v || !fault_current_ka) {
      await pool.query(`
        INSERT INTO arcflash_checks (device_id, switchboard_id, site, incident_energy, ppe_category, status)
        VALUES ($1, $2, $3, 0, 0, 'incomplete')
        ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET status = 'incomplete'
      `, [device, switchboard, site]);
      return res.json({ status: 'incomplete', missing: ['voltage_v or fault_current_ka'] });
    }

    // Calculate Arc Flash (IEEE 1584 simplified)
    const { incident_energy, ppe_category, riskZones } = calculateArcFlash(point, fault_current_ka, arcing_time, working_distance, enclosure_type, electrode_gap);
    const isSafe = ppe_category <= 2; // Arbitrary threshold for 'safe'
    const status = isSafe ? 'safe' : 'at-risk';
    const details = `Incident Energy: ${incident_energy} cal/cm², PPE: ${ppe_category}`;
    const remediation = getRemediations(point, incident_energy, ppe_category);

    await pool.query(`
      INSERT INTO arcflash_checks (device_id, switchboard_id, site, incident_energy, ppe_category, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET
        incident_energy = EXCLUDED.incident_energy,
        ppe_category = EXCLUDED.ppe_category,
        status = EXCLUDED.status,
        checked_at = NOW()
    `, [device, switchboard, site, incident_energy, ppe_category, status]);

    res.json({ status, incident_energy, ppe_category, details, remediation, riskZones });
  } catch (e) {
    console.error('[ARC CHECK] error:', e.message, e.stack);
    res.status(500).json({ error: 'Check failed', details: e.message });
  }
});

// GET Curves data for graph (e.g., incident energy vs distance)
app.get('/api/arcflash/curves', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard } = req.query;
    if (!device || !switchboard) return res.status(400).json({ error: 'Missing device or switchboard' });

    const r = await pool.query(`
      SELECT d.*, s.regime_neutral, ap.working_distance, ap.enclosure_type, ap.electrode_gap, ap.arcing_time, ap.fault_current_ka,
        fc.fault_level_ka
      FROM devices d 
      JOIN switchboards s ON d.switchboard_id = s.id 
      LEFT JOIN arcflash_parameters ap ON d.id = ap.device_id AND s.id = ap.switchboard_id AND ap.site = $3
      LEFT JOIN fault_checks fc ON d.id = fc.device_id AND s.id = fc.switchboard_id AND fc.site = $3 AND fc.phase_type = 'three'
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (!r.rows.length) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    point.voltage_v = point.voltage_v || 400;
    const arcing_time = point.arcing_time || 0.2;
    const fault_current_ka = point.fault_current_ka || point.fault_level_ka || 20;
    const enclosure_type = point.enclosure_type || 'VCB';
    const electrode_gap = point.electrode_gap || 32;

    console.log(`[ARC CURVES] Generating for device=${device}, switchboard=${switchboard}, voltage_v=${point.voltage_v}, fault_current_ka=${fault_current_ka}`);
    
    const curve = generateArcCurve(point, fault_current_ka, arcing_time, enclosure_type, electrode_gap);

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

// Helper functions for calculations (IEEE 1584 simplified)
function calculateArcFlash(point, faultKa, arcingTime, workingDistMm, enclosure, gap) {
  const V = point.voltage_v / 1000; // kV
  const Ibf = faultKa; // kA
  const t = arcingTime; // s
  const D = workingDistMm / 25.4; // inches
  const G = gap / 25.4; // inches

  // Arcing current Ia (approx)
  const lgIa = -0.004 * Math.pow(Math.log10(V), 2) + 0.555 * Math.log10(V) + 0.0966 * Math.log10(Ibf) - 0.000526 * G + 0.5588;
  const Ia = Math.pow(10, lgIa);

  // Incident energy E (cal/cm²)
  const k1 = enclosure === 'VCB' ? -0.097 : -0.555; // Factors simplified
  const lgE = k1 + 1.081 * Math.log10(Ia) + 0.0011 * G + 1.9593 * Math.log10(t) - 0.0076 * Math.pow(V, 2) + 0.6279 * V - 6.4633 / D;
  let E = Math.pow(10, lgE) * 4.184; // To cal/cm²

  E = Math.max(E, 0); // Non-negative

  // PPE category
  let ppe = 0;
  if (E > 40) ppe = 4;
  else if (E > 25) ppe = 3;
  else if (E > 8) ppe = 2;
  else if (E > 1.2) ppe = 1;

  const riskZones = E > 1.2 ? [{ min: 1.2, max: E }] : [];

  console.log(`[ARC CALC] E=${E} cal/cm², PPE=${ppe} for V=${V}kV, Ibf=${Ibf}kA, t=${t}s`);

  return { incident_energy: Math.round(E * 100) / 100, ppe_category: ppe, riskZones };
}

function getRemediations(point, E, ppe) {
  return [
    `Require PPE Category ${ppe} (IEEE 1584)`,
    'Reduce arcing time via faster protection (NFPA 70E)',
    'Increase working distance or add barriers'
  ];
}

function generateArcCurve(point, faultKa, arcingTime, enclosure, gap) {
  const points = [];
  const V = point.voltage_v / 1000;
  const Ibf = faultKa;
  const t = arcingTime;
  const G = gap / 25.4;

  const lgIa = -0.004 * Math.pow(Math.log10(V), 2) + 0.555 * Math.log10(V) + 0.0966 * Math.log10(Ibf) - 0.000526 * G + 0.5588;
  const Ia = Math.pow(10, lgIa);

  for (let dist = 200; dist <= 1000; dist += 50) { // Vary distance mm
    const D = dist / 25.4;
    const k1 = enclosure === 'VCB' ? -0.097 : -0.555;
    const lgE = k1 + 1.081 * Math.log10(Ia) + 0.0011 * G + 1.9593 * Math.log10(t) - 0.0076 * Math.pow(V, 2) + 0.6279 * V - 6.4633 / D;
    let E = Math.pow(10, lgE) * 4.184;
    E = Math.max(E, 0.1);
    points.push({ distance: dist, energy: Math.round(E * 100) / 100 });
  }
  
  console.log(`[ARC CURVES] Generated ${points.length} points, sample: ${JSON.stringify(points[0])}`);
  
  return points;
}

const port = process.env.ARCFLASH_PORT || 3006;
app.listen(port, () => console.log(`ArcFlash service running on :${port}`));
