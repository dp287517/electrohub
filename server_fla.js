import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSiteFilter } from './lib/tenant-filter.js';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI setup
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[FLA] OpenAI initialized');
  } catch (e) {
    console.warn('[FLA] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[FLA] No OPENAI_API_KEY found');
  openaiError = 'No API key';
}

// Gemini setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
let gemini = null;
if (GEMINI_API_KEY) {
  gemini = new GoogleGenerativeAI(GEMINI_API_KEY);
  console.log('[FLA] Gemini initialized');
}

function isQuotaError(error) {
  const msg = error?.message || '';
  return error?.status === 429 || error?.code === 'insufficient_quota' || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
}

async function callGemini(messages, options = {}) {
  if (!gemini) throw new Error('GEMINI_API_KEY not configured');
  const model = gemini.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { temperature: options.temperature ?? 0.7, maxOutputTokens: options.max_tokens ?? 4096 } });
  let systemPrompt = '', contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') { systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content; continue; }
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
  }
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
      console.error('[FLA] OpenAI failed:', error.message);
      if (gemini && isQuotaError(error)) {
        console.log('[FLA] Fallback to Gemini...');
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
app.get('/api/faultlevel/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}

const WHITELIST_SORT = ['name','code','building_code'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'name'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema - Add fault_checks and fault_parameters tables
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fault_checks (
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        phase_type TEXT NOT NULL CHECK (phase_type IN ('three', 'single')),
        fault_level_ka NUMERIC NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('safe', 'at-risk', 'incomplete')),
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site, phase_type)
      );
      CREATE INDEX IF NOT EXISTS idx_fault_checks_site ON fault_checks(site);

      CREATE TABLE IF NOT EXISTS fault_parameters (
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        line_length NUMERIC NOT NULL DEFAULT 100,
        source_impedance NUMERIC NOT NULL DEFAULT 0.1,
        cable_resistivity NUMERIC NOT NULL DEFAULT 0.0175,
        phase_type TEXT DEFAULT 'three' CHECK (phase_type IN ('three', 'single')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site)
      );
      CREATE INDEX IF NOT EXISTS idx_fault_parameters_site ON fault_parameters(site);

      -- Add phase_type column if missing
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'fault_parameters' AND column_name = 'phase_type') THEN
          ALTER TABLE fault_parameters ADD COLUMN phase_type TEXT DEFAULT 'three' CHECK (phase_type IN ('three', 'single'));
        END IF;
      END $$;
    `);
    console.log('[FLA SCHEMA] Schema ensured with phase_type');
  } catch (e) {
    console.error('[FLA SCHEMA] error:', e.message);
    throw e;
  }
}
ensureSchema().catch(e => console.error('[FLA SCHEMA] error:', e.message));

// LIST Fault points (based on switchboards/devices)
app.get('/api/faultlevel/points', async (req, res) => {
  try {
    const { where: siteWhere, params: siteParams, siteName, role } = getSiteFilter(req, { tableAlias: 'd' });
    // Site role requires a site, global/admin can see all
    if (role === 'site' && !siteName) return res.status(400).json({ error: 'Missing site' });
    const { q, switchboard, building, floor, sort = 'name', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = [siteWhere]; const vals = [...siteParams]; let i = siteParams.length + 1;
    if (q) { where.push(`(d.name ILIKE $${i} OR s.name ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (switchboard) { where.push(`d.switchboard_id = $${i}`); vals.push(Number(switchboard)); i++; }
    if (building) { where.push(`s.building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`s.floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    const limit = Math.min(parseInt(pageSize,10) || 18, 100);
    const offset = ((parseInt(page,10) || 1) - 1) * limit;

    const sql = `
      SELECT
        d.id AS device_id, d.name AS device_name, d.device_type, d.in_amps, d.icu_ka, d.voltage_v, d.settings, d.poles,
        s.id AS switchboard_id, s.name AS switchboard_name, s.regime_neutral,
        fc.status AS status, fc.phase_type AS check_phase_type, fc.fault_level_ka,
        fp.line_length, fp.source_impedance, fp.cable_resistivity, fp.phase_type
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN fault_parameters fp ON d.id = fp.device_id AND s.id = fp.switchboard_id AND fp.site = d.site
      LEFT JOIN fault_checks fc ON d.id = fc.device_id AND s.id = fc.switchboard_id AND fc.site = d.site AND fc.phase_type = COALESCE(fp.phase_type, CASE WHEN d.poles IN (1,2) THEN 'single' ELSE 'three' END)
      WHERE ${where.join(' AND ')}
      ORDER BY s.${sortSafe(sort)} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM devices d JOIN switchboards s ON d.switchboard_id = s.id WHERE ${where.join(' AND ')}`, vals);

    console.log(`[FLA POINTS] Loaded ${rows.rows.length} points for role=${role}, site=${siteName || 'all'}`);

    res.json({ 
      data: rows.rows.map(r => ({ 
        ...r, 
        voltage_v: r.voltage_v || 400,
        line_length: r.line_length || 100,
        source_impedance: r.source_impedance || 0.1,
        cable_resistivity: r.cable_resistivity || 0.0175,
        phase_type: r.phase_type || (r.poles && [1, 2].includes(r.poles) ? 'single' : 'three')
      })), 
      total: count.rows[0].total 
    });
  } catch (e) {
    console.error('[FLA POINTS] error:', e.message, e.stack);
    res.status(500).json({ error: 'List points failed', details: e.message });
  }
});

// UPDATE Fault parameters
app.post('/api/faultlevel/parameters', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device_id, switchboard_id, line_length = 100, source_impedance = 0.1, cable_resistivity = 0.0175, phase_type = 'three' } = req.body;

    console.log(`[FLA PARAMETERS] Received for device_id=${device_id}, switchboard_id=${switchboard_id}, site=${site}, line_length=${line_length}, source_impedance=${source_impedance}, phase_type=${phase_type}`);

    if (!device_id || !switchboard_id) {
      return res.status(400).json({ error: 'Missing device_id or switchboard_id' });
    }
    if (isNaN(line_length) || line_length <= 0) {
      return res.status(400).json({ error: 'Invalid line_length' });
    }
    if (isNaN(source_impedance) || source_impedance <= 0 || source_impedance > 10) {
      return res.status(400).json({ error: 'Invalid source_impedance (must be between 0 and 10 Ω)' });
    }
    if (isNaN(cable_resistivity) || cable_resistivity <= 0) {
      return res.status(400).json({ error: 'Invalid cable_resistivity' });
    }
    if (!['three', 'single'].includes(phase_type)) {
      return res.status(400).json({ error: 'Invalid phase_type' });
    }

    // Verify device and switchboard exist, and get poles
    const check = await pool.query(
      `SELECT d.poles FROM devices d JOIN switchboards s ON d.switchboard_id = s.id 
       WHERE d.id = $1 AND s.id = $2 AND d.site = $3`,
      [Number(device_id), Number(switchboard_id), site]
    );
    if (!check.rows.length) {
      return res.status(404).json({ error: 'Device or switchboard not found' });
    }

    // Use poles to determine default phase_type, but respect user input
    const default_phase_type = check.rows[0].poles && [1, 2].includes(check.rows[0].poles) ? 'single' : 'three';
    const final_phase_type = phase_type || default_phase_type;

    await pool.query(`
      INSERT INTO fault_parameters (device_id, switchboard_id, site, line_length, source_impedance, cable_resistivity, phase_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (device_id, switchboard_id, site)
      DO UPDATE SET 
        line_length = $4,
        source_impedance = $5,
        cable_resistivity = $6,
        phase_type = $7,
        created_at = NOW()
    `, [Number(device_id), Number(switchboard_id), site, Number(line_length), Number(source_impedance), Number(cable_resistivity), final_phase_type]);

    console.log(`[FLA PARAMETERS] Updated: device_id=${device_id}, switchboard_id=${switchboard_id}, line_length=${line_length}, source_impedance=${source_impedance}, phase_type=${final_phase_type}`);
    
    res.json({ message: 'Parameters updated' });
  } catch (e) {
    console.error('[FLA PARAMETERS] error:', e.message, e.stack);
    res.status(500).json({ error: 'Update parameters failed', details: e.message });
  }
});

// CHECK Fault level for a point
app.get('/api/faultlevel/check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard, phase_type = 'three' } = req.query;
    if (!device || !switchboard) return res.status(400).json({ error: 'Missing device or switchboard' });
    if (!['three', 'single'].includes(phase_type)) return res.status(400).json({ error: 'Invalid phase_type' });

    // Clear previous fault_checks entry to force fresh calculation
    await pool.query(`
      DELETE FROM fault_checks 
      WHERE device_id = $1 AND switchboard_id = $2 AND site = $3 AND phase_type = $4
    `, [Number(device), Number(switchboard), site, phase_type]);

    const r = await pool.query(`
      SELECT d.*, s.regime_neutral, s.modes, 
             fp.line_length, fp.source_impedance, fp.cable_resistivity, fp.phase_type
      FROM devices d 
      JOIN switchboards s ON d.switchboard_id = s.id 
      LEFT JOIN fault_parameters fp ON d.id = fp.device_id AND s.id = fp.switchboard_id AND fp.site = $3
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (!r.rows.length) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    point.voltage_v = point.voltage_v || 400; // Default
    point.in_amps = point.in_amps || 100; // Default
    point.icu_ka = point.icu_ka || 50; // Default
    const line_length = Number(point.line_length) || 100; // Ensure numeric
    const source_impedance = Number(point.source_impedance) || 0.1; // Ensure numeric
    const cable_resistivity = Number(point.cable_resistivity) || 0.0175; // Ensure numeric
    const effective_phase_type = phase_type || point.phase_type || (point.poles && [1, 2].includes(point.poles) ? 'single' : 'three');

    console.log(`[FLA CHECK] Calculating for device=${device}, switchboard=${switchboard}, phase_type=${effective_phase_type}, voltage_v=${point.voltage_v}, icu_ka=${point.icu_ka}, line_length=${line_length}, source_impedance=${source_impedance}, cable_resistivity=${cable_resistivity}`);

    // Check missing data
    const missing = [];
    if (!point.voltage_v) missing.push('Voltage missing');
    if (!point.icu_ka) missing.push('Icu missing');

    if (missing.length > 0) {
      await pool.query(`
        INSERT INTO fault_checks (device_id, switchboard_id, site, phase_type, fault_level_ka, status, checked_at)
        VALUES ($1, $2, $3, $4, 0, $5, NOW())
        ON CONFLICT (device_id, switchboard_id, site, phase_type)
        DO UPDATE SET fault_level_ka = 0, status = $5, checked_at = NOW()
      `, [Number(device), Number(switchboard), site, effective_phase_type, 'incomplete']);
      return res.json({ 
        status: 'incomplete', 
        missing, 
        remediation: 'Complete voltage and Icu settings in the Switchboards page' 
      });
    }

    // Calculate fault level (IEC 60909 simplified)
    const { faultLevelKa, riskZones } = calculateFaultLevel(point, effective_phase_type, source_impedance, line_length, cable_resistivity);
    
    // Check if fault level is too low (invalid)
    if (faultLevelKa < 0.001) {
      await pool.query(`
        INSERT INTO fault_checks (device_id, switchboard_id, site, phase_type, fault_level_ka, status, checked_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (device_id, switchboard_id, site, phase_type)
        DO UPDATE SET fault_level_ka = $5, status = $6, checked_at = NOW()
      `, [Number(device), Number(switchboard), site, effective_phase_type, faultLevelKa, 'incomplete']);
      return res.json({ 
        status: 'incomplete', 
        fault_level_ka: faultLevelKa,
        details: { 
          why: 'Fault level too low (<0.001 kA), likely due to high source impedance.',
          calculated_ik: faultLevelKa,
          used_line_length: line_length,
          used_source_impedance: source_impedance,
          used_phase_type: effective_phase_type,
          icu_ka: point.icu_ka
        },
        remediation: ['Reduce source impedance (e.g., <10 Ω) to get a valid fault level calculation']
      });
    }

    const isSafe = faultLevelKa < point.icu_ka;
    const remediation = isSafe ? [] : getRemediations(point, faultLevelKa);
    const details = { 
      why: isSafe ? 
        'Safe: Calculated Ik < Icu (per IEC 60909 and 60947).' : 
        'At risk: Ik >= Icu; reinforce protection or reduce impedance.',
      calculated_ik: faultLevelKa,
      used_line_length: line_length,
      used_source_impedance: source_impedance,
      used_phase_type: effective_phase_type,
      icu_ka: point.icu_ka
    };

    // Save status
    await pool.query(`
      INSERT INTO fault_checks (device_id, switchboard_id, site, phase_type, fault_level_ka, status, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (device_id, switchboard_id, site, phase_type)
      DO UPDATE SET fault_level_ka = $5, status = $6, checked_at = NOW()
    `, [Number(device), Number(switchboard), site, effective_phase_type, faultLevelKa, isSafe ? 'safe' : 'at-risk']);

    console.log(`[FLA CHECK] Result for device=${device}, switchboard=${switchboard}: fault_level_ka=${faultLevelKa}, status=${isSafe ? 'safe' : 'at-risk'}, icu_ka=${point.icu_ka}`);
    
    res.json({ status: isSafe ? 'safe' : 'at-risk', fault_level_ka: faultLevelKa, details, remediation, riskZones });
  } catch (e) {
    console.error('[FLA CHECK] error:', e.message, e.stack);
    res.status(500).json({ error: 'Check failed', details: e.message });
  }
});

// GET Curves data for graph (e.g., fault current vs line length)
app.get('/api/faultlevel/curves', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard, phase_type = 'three' } = req.query;
    if (!device || !switchboard) return res.status(400).json({ error: 'Missing device or switchboard' });
    if (!['three', 'single'].includes(phase_type)) return res.status(400).json({ error: 'Invalid phase_type' });

    const r = await pool.query(`
      SELECT d.*, s.regime_neutral, fp.line_length, fp.source_impedance, fp.cable_resistivity, fp.phase_type
      FROM devices d 
      JOIN switchboards s ON d.switchboard_id = s.id 
      LEFT JOIN fault_parameters fp ON d.id = fp.device_id AND s.id = fp.switchboard_id AND fp.site = $3
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (!r.rows.length) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    point.voltage_v = point.voltage_v || 400;
    const line_length = Number(point.line_length) || 100;
    const source_impedance = Number(point.source_impedance) || 0.1;
    const cable_resistivity = Number(point.cable_resistivity) || 0.0175;
    const effective_phase_type = phase_type || point.phase_type || (point.poles && [1, 2].includes(point.poles) ? 'single' : 'three');

    console.log(`[FLA CURVES] Generating for device=${device}, switchboard=${switchboard}, phase_type=${effective_phase_type}, voltage_v=${point.voltage_v}, line_length=${line_length}, source_impedance=${source_impedance}, cable_resistivity=${cable_resistivity}`);
    
    const curve = generateFaultCurve(point, effective_phase_type, source_impedance, line_length, cable_resistivity);

    res.json({ curve });
  } catch (e) {
    console.error('[FLA CURVES] error:', e.message, e.stack);
    res.status(500).json({ error: 'Curves generation failed', details: e.message });
  }
});

// AI TIP for remediation
app.post('/api/faultlevel/ai-tip', async (req, res) => {
  try {
    if (!openai && !gemini) return res.json({ tip: 'AI tips unavailable' });

    const { query } = req.body;
    const context = query || 'Fault level advice';

    const result = await chatWithFallback(
      [
        {
          role: 'system',
          content: `You are an expert in IEC 60909 fault calculations. Provide concise advice based on "${context}". Reference standards, suggest impedance adjustments. 1-2 sentences.`
        },
        { role: 'user', content: context }
      ],
      { max_tokens: 120, temperature: 0.3 }
    );

    res.json({ tip: result.content.trim() });
  } catch (e) {
    console.error('[AI TIP] error:', e.message, e.stack);
    res.status(500).json({ error: 'AI tip failed', details: e.message });
  }
});

// Helper functions for calculations (based on IEC 60909)
function calculateFaultLevel(point, phase_type, sourceZ, lineLength, cableResistivity) {
  const Un = point.voltage_v; // Nominal voltage
  const c = 1.1; // Voltage factor for max fault (IEC 60909)
  const Zline = (lineLength / 1000) * cableResistivity; // Line impedance in ohms
  let Zk = Math.max(sourceZ + Zline, 0.001); // Protect against zero impedance

  let faultLevelKa;
  if (phase_type === 'three') {
    // Three-phase: Ik" = c * Un / (√3 * Zk) in kA
    faultLevelKa = (c * Un / (Math.sqrt(3) * Zk)) / 1000;
  } else {
    // Single-phase (phase-earth approx): Ik1 = √3 * c * Un / (3 * Zk + Z0), assume Z0 = 2*Zk
    const Z0 = 2 * Zk;
    faultLevelKa = (Math.sqrt(3) * c * Un / (3 * Zk + Z0)) / 1000;
  }

  faultLevelKa = Math.max(faultLevelKa, 0); // Ensure non-negative
  const riskZones = faultLevelKa > point.icu_ka ? [{ min: point.icu_ka, max: faultLevelKa }] : [];

  console.log(`[FLA CALC] Ik=${faultLevelKa} kA for Un=${Un}, Zk=${Zk}Ω, phase_type=${phase_type}, icu_ka=${point.icu_ka}, line_length=${lineLength}, source_impedance=${sourceZ}, cable_resistivity=${cableResistivity}`);
  
  return { faultLevelKa: Math.round(faultLevelKa * 10000) / 10000, riskZones }; // Round to 4 decimals for precision
}

function getRemediations(point, faultLevelKa) {
  return [
    `Increase device Icu rating above ${faultLevelKa} kA`,
    'Add series reactor to increase impedance (IEC 60909)',
    'Shorten line length to reduce Zline'
  ];
}

function generateFaultCurve(point, phase_type, sourceZ, lineLength, cableResistivity) {
  const points = [];
  const Un = point.voltage_v;
  const c = 1.1;
  for (let length = 10; length <= 500; length += 10) { // Vary line length
    const Zline = (length / 1000) * cableResistivity;
    let Zk = Math.max(sourceZ + Zline, 0.001); // Protect against zero
    let Ik;
    if (phase_type === 'three') {
      Ik = (c * Un / (Math.sqrt(3) * Zk)) / 1000;
    } else {
      const Z0 = 2 * Zk;
      Ik = (Math.sqrt(3) * c * Un / (3 * Zk + Z0)) / 1000;
    }
    Ik = Math.max(Ik, 0.001); // Minimum for graph visibility
    points.push({ line_length: length, fault_ka: Math.round(Ik * 10000) / 10000 });
  }
  
  console.log(`[FLA CURVES] Generated ${points.length} points, sample: ${JSON.stringify(points[0])}`);
  
  return points;
}

const port = process.env.FLA_PORT || 3005;
app.listen(port, () => console.log(`FLA service running on :${port}`));
