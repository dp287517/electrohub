// server_obsolescence.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import axios from 'axios'; // Ajout pour web search simulation, mais utilise tool réel si intégré

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI setup
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[OBSOLESCENCE] OpenAI initialized');
  } catch (e) {
    console.warn('[OBSOLESCENCE] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[OBSOLESCENCE] No OPENAI_API_KEY found');
  openaiError = 'No API key';
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Upload setup for PDF
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
app.get('/api/obsolescence/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}

const WHITELIST_SORT = ['name', 'code', 'building_code'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'name'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema - Étendu pour documents
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS obsolescence_checks (
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        remaining_life_years NUMERIC NOT NULL,
        urgency_score NUMERIC NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
        status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'critical', 'incomplete')),
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site)
      );
      CREATE INDEX IF NOT EXISTS idx_obsolescence_checks_site ON obsolescence_checks(site);

      CREATE TABLE IF NOT EXISTS obsolescence_parameters (
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        manufacture_date DATE NOT NULL DEFAULT '2000-01-01',
        avg_temperature NUMERIC NOT NULL DEFAULT 25,
        avg_humidity NUMERIC NOT NULL DEFAULT 50,
        operation_cycles INTEGER NOT NULL DEFAULT 5000,
        avg_life_years NUMERIC NOT NULL DEFAULT 25,
        replacement_cost NUMERIC NOT NULL DEFAULT 1000,
        document_link TEXT,  -- Nouveau champ pour PDF/link
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site)
      );
      CREATE INDEX IF NOT EXISTS idx_obsolescence_parameters_site ON obsolescence_parameters(site);
    `);
    console.log('[OBS SCHEMA] Schema ensured');
  } catch (e) {
    console.error('[OBS SCHEMA] error:', e.message);
    throw e;
  }
}
ensureSchema().catch(e => console.error('[OBS SCHEMA] error:', e.message));

// Test data
app.post('/api/obsolescence/test-data', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE site = $1 LIMIT 1', [site]);
    if (sbCheck.rows.length === 0) {
      const sbIns = await pool.query(
        'INSERT INTO switchboards (site, name, code, building_code, floor) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [site, 'Test SB', 'TSB', 'Building A', '1']
      );
      await pool.query(
        'INSERT INTO devices (site, switchboard_id, name, device_type, in_amps, replacement_cost) VALUES ($1, $2, $3, $4, $5, $6)',
        [site, sbIns.rows[0].id, 'Test Device', 'MCCB', 100, 1000]
      );
      console.log('[OBS TEST] Created test data');
    }
    res.json({ message: 'Test data created/verified' });
  } catch (e) {
    console.error('[OBS TEST] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// RESET
app.post('/api/obsolescence/reset', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    await pool.query(`DELETE FROM obsolescence_checks WHERE site = $1`, [site]);
    await pool.query(`DELETE FROM obsolescence_parameters WHERE site = $1`, [site]);
    console.log(`[OBS RESET] Cleared for site=${site}`);
    res.json({ message: 'Reset successful' });
  } catch (e) {
    console.error('[OBS RESET] error:', e.message);
    res.status(500).json({ error: 'Reset failed', details: e.message });
  }
});

// LIST Buildings
app.get('/api/obsolescence/buildings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const rows = await pool.query(`
      SELECT DISTINCT building_code AS building,
        COUNT(*) AS count,
        SUM(op.replacement_cost) AS total_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.site = $1
      WHERE s.site = $1
      GROUP BY building_code
    `, [site]);
    res.json({ data: rows.rows });
  } catch (e) {
    console.error('[OBS BUILDINGS] error:', e.message);
    res.status(500).json({ error: 'Buildings load failed' });
  }
});

// LIST Switchboards by Building
app.get('/api/obsolescence/switchboards', async (req, res) => {
  try {
    const site = siteOf(req);
    const { building } = req.query;
    if (!site || !building) return res.status(400).json({ error: 'Missing params' });
    const rows = await pool.query(`
      SELECT s.id, s.name, s.floor,
        COUNT(d.id) AS device_count,
        SUM(op.replacement_cost) AS total_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.site = $1
      WHERE s.site = $1 AND s.building_code = $2
      GROUP BY s.id
    `, [site, building]);
    res.json({ data: rows.rows });
  } catch (e) {
    console.error('[OBS SWITCHBOARDS] error:', e.message);
    res.status(500).json({ error: 'Switchboards load failed' });
  }
});

// LIST Devices by Switchboard
app.get('/api/obsolescence/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    const { switchboard } = req.query;
    if (!site || !switchboard) return res.status(400).json({ error: 'Missing params' });
    const rows = await pool.query(`
      SELECT d.*, op.*, oc.*
      FROM devices d
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND oc.site = $1
      WHERE d.switchboard_id = $2 AND d.site = $1
    `, [site, Number(switchboard)]);
    res.json({ data: rows.rows });
  } catch (e) {
    console.error('[OBS DEVICES] error:', e.message);
    res.status(500).json({ error: 'Devices load failed' });
  }
});

// UPDATE Parameters
app.post('/api/obsolescence/parameters', async (req, res) => {
  try {
    const site = siteOf(req);
    const params = req.body;
    await pool.query(`
      INSERT INTO obsolescence_parameters (device_id, switchboard_id, site, manufacture_date, avg_temperature, avg_humidity, operation_cycles, avg_life_years, replacement_cost, document_link)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (device_id, switchboard_id, site)
      DO UPDATE SET manufacture_date = $4, avg_temperature = $5, avg_humidity = $6, operation_cycles = $7, avg_life_years = $8, replacement_cost = $9, document_link = $10
    `, [params.device_id, params.switchboard_id, site, params.manufacture_date, params.avg_temperature, params.avg_humidity, params.operation_cycles, params.avg_life_years, params.replacement_cost, params.document_link || null]);
    res.json({ message: 'Parameters updated' });
  } catch (e) {
    console.error('[OBS PARAMS] error:', e.message);
    res.status(500).json({ error: 'Params update failed', details: e.message });
  }
});

// CHECK with cost estimation if default
app.get('/api/obsolescence/check', async (req, res) => {
  try {
    const { device, switchboard } = req.query;
    const site = siteOf(req);
    if (!device || !switchboard || !site) return res.status(400).json({ error: 'Missing params' });
    const pointRes = await pool.query(`
      SELECT d.*, op.*, sc.status AS selectivity_status, fc.status AS fault_status, ac.status AS arc_status
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id
      LEFT JOIN fault_checks fc ON d.id = fc.device_id
      LEFT JOIN arcflash_checks ac ON d.id = ac.device_id
      WHERE d.id = $2 AND d.switchboard_id = $3 AND d.site = $1
    `, [site, Number(device), Number(switchboard)]);
    if (pointRes.rows.length === 0) return res.status(404).json({ error: 'Point not found' });
    let point = pointRes.rows[0];
    if (point.replacement_cost === 1000) {
      point.replacement_cost = await estimateCost(point.device_type);
      // Update in DB
      await pool.query(`UPDATE obsolescence_parameters SET replacement_cost = $1 WHERE device_id = $2 AND switchboard_id = $3 AND site = $4`, [point.replacement_cost, Number(device), Number(switchboard), site]);
    }
    const obs = calculateObsolescence(point);
    await pool.query(`
      INSERT INTO obsolescence_checks (device_id, switchboard_id, site, remaining_life_years, urgency_score, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET remaining_life_years = $4, urgency_score = $5, status = $6, checked_at = NOW()
    `, [Number(device), Number(switchboard), site, obs.remaining_life_years, obs.urgency_score, obs.status]);
    res.json(obs);
  } catch (e) {
    console.error('[OBS CHECK] error:', e.message);
    res.status(500).json({ error: 'Check failed' });
  }
});

// Estimation coût
async function estimateCost(deviceType) {
  try {
    const searchResult = await axios.get(`https://api.example.com/search?query=average+cost+of+${deviceType}`); // Remplace par vrai API si besoin
    const prompt = `Estimate replacement cost for ${deviceType} based on: ${searchResult.data}`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });
    return parseFloat(completion.choices[0].message.content) || 1000;
  } catch {
    return 1000;
  }
}

// Gantt Data
app.get('/api/obsolescence/gantt-data', async (req, res) => {
  try {
    const site = siteOf(req);
    const { group = 'building', building, switchboard } = req.query;
    let where = 'd.site = $1'; let vals = [site]; let i = 2;
    if (building) { where += ' AND s.building_code = $' + i; vals.push(building); i++; }
    if (switchboard) { where += ' AND s.id = $' + i; vals.push(Number(switchboard)); }
    const r = await pool.query(`
      SELECT d.id AS device_id, d.name, s.building_code, s.floor, s.name AS switchboard_name,
             op.manufacture_date, op.avg_life_years, op.replacement_cost, oc.urgency_score,
             ${group === 'building' ? 's.building_code' : group === 'floor' ? 's.floor' : 's.name'} AS group_field
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE ${where}
    `, vals);
    const tasks = r.rows.map(row => {
      const startYear = new Date(row.manufacture_date || '2000-01-01').getFullYear();
      const endYear = startYear + (row.avg_life_years || 25);
      return {
        start: new Date(`${endYear - 5}-01-01`),
        end: new Date(`${endYear}-12-31`),
        name: row.name || 'Device',
        id: row.device_id,
        progress: row.urgency_score || 0,
        type: 'task',
        cost: row.replacement_cost || 1000,
        group: row.group_field || 'Unknown',
      };
    }).filter(task => !isNaN(new Date(task.start).getTime()) && !isNaN(new Date(task.end).getTime()));
    res.json({ tasks });
  } catch (e) {
    console.error('[OBS GANTT] error:', e.message);
    res.status(500).json({ error: 'Gantt data failed' });
  }
});

// Doughnut Data
app.get('/api/obsolescence/doughnut', async (req, res) => {
  try {
    const site = siteOf(req);
    const { group = 'building' } = req.query;
    let groupField = 's.building_code';
    if (group === 'floor') groupField = 's.floor';
    if (group === 'switchboard') groupField = 's.name';
    const sql = `
      SELECT ${groupField} AS label,
        COUNT(CASE WHEN oc.status = 'ok' THEN 1 END) AS ok,
        COUNT(CASE WHEN oc.status = 'warning' THEN 1 END) AS warning,
        COUNT(CASE WHEN oc.status = 'critical' THEN 1 END) AS critical,
        SUM(op.replacement_cost) AS total_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE s.site = $1
      GROUP BY ${groupField}
    `;
    const rows = await pool.query(sql, [site]);
    res.json({ data: rows.rows });
  } catch (e) {
    console.error('[OBS DOUGHNUT] error:', e.message);
    res.status(500).json({ error: 'Doughnut data failed' });
  }
});

// CAPEX Forecast
app.get('/api/obsolescence/capex-forecast', async (req, res) => {
  try {
    const site = siteOf(req);
    const { group = 'building' } = req.query;
    let groupField = 's.building_code';
    if (group === 'floor') groupField = 's.floor';
    if (group === 'switchboard') groupField = 's.name';

    const r = await pool.query(`
      SELECT ${groupField} AS group_label, op.replacement_cost, op.manufacture_date, op.avg_life_years, oc.urgency_score
      FROM switchboards s
      JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE s.site = $1
    `, [site]);

    const forecasts = {};
    r.rows.forEach(row => {
      if (!forecasts[row.group_label]) forecasts[row.group_label] = [];
      forecasts[row.group_label].push(generateForecastForItem(row));
    });

    res.json({ forecasts });
  } catch (e) {
    console.error('[OBS CAPEX FORECAST] error:', e.message);
    res.status(500).json({ error: 'CAPEX forecast failed' });
  }
});

// AI Tip
app.post('/api/obsolescence/ai-tip', async (req, res) => {
  try {
    if (!openai) return res.json({ tip: 'AI tips unavailable' });
    const { query } = req.body;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in IEC/IEEE asset management. Provide concise advice on obsolescence based on "${query}". Reference norms like IEC 62271, suggest CAPEX strategies or mitigations. 1-2 sentences.` 
        },
        { role: 'user', content: query }
      ],
      max_tokens: 120,
      temperature: 0.3
    });
    res.json({ tip: completion.choices[0].message.content.trim() });
  } catch (e) {
    console.error('[AI TIP] error:', e.message);
    res.status(500).json({ error: 'AI tip failed' });
  }
});

// PDF Analysis
app.post('/api/obsolescence/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    const site = siteOf(req);
    const { device_id, switchboard_id } = req.body;
    const pdfText = 'Mock extracted text: Manufacture date 2015-06-01'; // Replace with real extraction
    const prompt = `Extract manufacture date from this PDF text: "${pdfText}"`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const extracted = JSON.parse(completion.choices[0].message.content);
    const manufacture_date = extracted.manufacture_date && !isNaN(new Date(extracted.manufacture_date).getTime()) ? extracted.manufacture_date : '2000-01-01';
    await pool.query(`
      UPDATE obsolescence_parameters SET manufacture_date = $1
      WHERE device_id = $2 AND switchboard_id = $3 AND site = $4
    `, [manufacture_date, Number(device_id), Number(switchboard_id), site]);
    res.json({ manufacture_date });
  } catch (e) {
    console.error('[PDF ANALYZE] error:', e.message);
    res.status(500).json({ error: 'PDF analysis failed', details: e.message });
  }
});

// Helper functions
function calculateObsolescence(point) {
  const currentYear = new Date().getFullYear();
  const manufactureYear = point.manufacture_date && !isNaN(new Date(point.manufacture_date).getTime()) ? new Date(point.manufacture_date).getFullYear() : 2000;
  const age = currentYear - manufactureYear;
  const avgLife = point.avg_life_years || 25;
  const tempFactor = Math.pow(2, (point.avg_temperature - 25) / 10);
  const humFactor = point.avg_humidity > 70 ? 1.5 : 1;
  const cycleFactor = point.operation_cycles > 10000 ? 1.2 : 1;
  const adjustedLife = avgLife / (tempFactor * humFactor * cycleFactor);
  const remaining_life_years = Math.max(adjustedLife - age, 0);
  let urgency = (age / adjustedLife) * 50;
  if (point.selectivity_status === 'non-selective') urgency += 20;
  if (point.fault_status === 'at-risk') urgency += 15;
  if (point.arc_status === 'at-risk') urgency += 15;
  urgency = Math.min(urgency, 100);
  const status = urgency < 30 ? 'ok' : urgency < 70 ? 'warning' : 'critical';
  return { remaining_life_years: Math.round(remaining_life_years), urgency_score: Math.round(urgency), status };
}

function generateForecastForItem(item) {
  const forecast = [];
  const currentYear = new Date().getFullYear();
  let capexCumul = 0;
  const inflation = 1.02;
  const manufactureYear = item.manufacture_date && !isNaN(new Date(item.manufacture_date).getTime()) ? new Date(item.manufacture_date).getFullYear() : 2000;
  const lifeYears = item.avg_life_years || 25;
  const replacementYear = manufactureYear + lifeYears;

  for (let y = 0; y < 30; y++) {
    const year = currentYear + y;
    const remaining = lifeYears - (year - manufactureYear);
    const capexYear = year >= replacementYear ? item.replacement_cost * Math.pow(inflation, y) : 0;
    capexCumul += capexYear;
    forecast.push({ year, capex_year: Math.round(capexYear), capex_cumul: Math.round(capexCumul), remaining_life: Math.max(remaining, 0) });
  }
  return forecast;
}

const port = process.env.OBSOLESCENCE_PORT || 3007;
app.listen(port, () => console.log(`Obsolescence service running on :${port}`));