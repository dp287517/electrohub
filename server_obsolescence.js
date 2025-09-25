// server_obsolescence.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import multer from 'multer';
import PDFDocument from 'pdfkit'; // Pour génération PDF
import fs from 'fs'; // Pour temp files si besoin
import path from 'path';

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

const WHITELIST_SORT = ['name','code','building_code'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'name'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema - Tables for obsolescence_checks and obsolescence_parameters
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
        avg_temperature NUMERIC NOT NULL DEFAULT 25,  -- °C
        avg_humidity NUMERIC NOT NULL DEFAULT 50,  -- %
        operation_cycles INTEGER NOT NULL DEFAULT 5000,
        avg_life_years NUMERIC NOT NULL DEFAULT 25,  -- Based on norms
        replacement_cost NUMERIC NOT NULL DEFAULT 1000,  -- €
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

// RESET Obs data
app.post('/api/obsolescence/reset', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    await pool.query(`DELETE FROM obsolescence_checks WHERE site = $1`, [site]);
    await pool.query(`DELETE FROM obsolescence_parameters WHERE site = $1`, [site]);
    
    console.log(`[OBS RESET] Cleared obsolescence_checks and obsolescence_parameters for site=${site}`);
    res.json({ message: 'Obs data reset successfully' });
  } catch (e) {
    console.error('[OBS RESET] error:', e.message, e.stack);
    res.status(500).json({ error: 'Reset failed', details: e.message });
  }
});

// LIST Obs points (devices in switchboards)
app.get('/api/obsolescence/points', async (req, res) => {
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
        d.id AS device_id, d.name AS name, d.device_type, d.manufacturer, d.reference, d.in_amps, d.icu_ka, d.poles, d.settings,
        s.id AS switchboard_id, s.name AS switchboard_name, s.building_code, s.floor,
        op.manufacture_date, op.avg_temperature, op.avg_humidity, op.operation_cycles, op.avg_life_years, op.replacement_cost,
        oc.remaining_life_years, oc.urgency_score, oc.status
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id
      LEFT JOIN fault_checks fc ON d.id = fc.device_id
      LEFT JOIN arcflash_checks ac ON d.id = ac.device_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.${sortSafe(sort)} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM devices d JOIN switchboards s ON d.switchboard_id = s.id WHERE ${where.join(' AND ')}`, vals);
    res.json({ data: rows.rows, total: count.rows[0].total });
  } catch (e) {
    console.error('[OBS POINTS] error:', e.message, e.stack);
    res.status(500).json({ error: 'Points load failed', details: e.message });
  }
});

// UPDATE Parameters
app.post('/api/obsolescence/parameters', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device_id, switchboard_id, manufacture_date, avg_temperature, avg_humidity, operation_cycles, avg_life_years, replacement_cost } = req.body;

    await pool.query(`
      INSERT INTO obsolescence_parameters (device_id, switchboard_id, site, manufacture_date, avg_temperature, avg_humidity, operation_cycles, avg_life_years, replacement_cost)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (device_id, switchboard_id, site)
      DO UPDATE SET manufacture_date = $4, avg_temperature = $5, avg_humidity = $6, operation_cycles = $7, avg_life_years = $8, replacement_cost = $9
    `, [Number(device_id), Number(switchboard_id), site, manufacture_date, Number(avg_temperature), Number(avg_humidity), Number(operation_cycles), Number(avg_life_years), Number(replacement_cost)]);

    res.json({ message: 'Parameters updated' });
  } catch (e) {
    console.error('[OBS PARAMS] error:', e.message, e.stack);
    res.status(500).json({ error: 'Params update failed', details: e.message });
  }
});

// CHECK Obsolescence
app.get('/api/obsolescence/check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard } = req.query;
    const r = await pool.query(`
      SELECT d.*, s.*, op.*, sc.status AS selectivity_status, fc.status AS fault_status, ac.status AS arc_status
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $3
      LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id
      LEFT JOIN fault_checks fc ON d.id = fc.device_id
      LEFT JOIN arcflash_checks ac ON d.id = ac.device_id
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    const { remaining_life_years, urgency_score, status, riskZones } = calculateObsolescence(point);

    await pool.query(`
      INSERT INTO obsolescence_checks (device_id, switchboard_id, site, remaining_life_years, urgency_score, status, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (device_id, switchboard_id, site)
      DO UPDATE SET remaining_life_years = $4, urgency_score = $5, status = $6, checked_at = NOW()
    `, [Number(device), Number(switchboard), site, remaining_life_years, urgency_score, status]);

    const remediations = getRemediations(point, urgency_score);

    res.json({ remaining_life_years, urgency_score, status, riskZones, remediations });
  } catch (e) {
    console.error('[OBS CHECK] error:', e.message, e.stack);
    res.status(500).json({ error: 'Check failed', details: e.message });
  }
});

// GET Forecast data (Gantt/CAPEX over 30 years)
app.get('/api/obsolescence/forecast', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard } = req.query;
    const r = await pool.query(`
      SELECT d.*, s.*, op.*, oc.*
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $3
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $3
      WHERE d.id = $1 AND s.id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    const forecast = generateForecast(point);

    res.json({ forecast });
  } catch (e) {
    console.error('[OBS FORECAST] error:', e.message, e.stack);
    res.status(500).json({ error: 'Forecast generation failed', details: e.message });
  }
});

// AI TIP for obsolescence
app.post('/api/obsolescence/ai-tip', async (req, res) => {
  try {
    if (!openai) return res.json({ tip: 'AI tips unavailable' });

    const { query } = req.body;
    const context = query || 'Obsolescence advice';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in IEC/IEEE asset management. Provide concise advice on obsolescence based on "${context}". Reference norms like IEC 62271, suggest CAPEX strategies or mitigations. 1-2 sentences.` 
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

// ANALYZE PDF (upload and extract manufacture date, etc.)
app.post('/api/obsolescence/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    const site = siteOf(req);
    const { device_id, switchboard_id } = req.body;

    // Simulation extraction (in real: use pdfjs or OCR)
    // Prompt IA pour "analyser" buffer PDF (ici mock)
    const pdfText = 'Mock extracted text: Manufacture date 2015-06-01'; // Remplacer par real extraction
    const prompt = `Extract manufacture date from this PDF text: "${pdfText}"`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const extracted = JSON.parse(completion.choices[0].message.content);
    const manufacture_date = extracted.manufacture_date || '2000-01-01';

    // Update params
    await pool.query(`
      UPDATE obsolescence_parameters SET manufacture_date = $1
      WHERE device_id = $2 AND switchboard_id = $3 AND site = $4
    `, [manufacture_date, Number(device_id), Number(switchboard_id), site]);

    res.json({ manufacture_date });
  } catch (e) {
    console.error('[PDF ANALYZE] error:', e.message, e.stack);
    res.status(500).json({ error: 'PDF analysis failed', details: e.message });
  }
});

// Helper functions for calculations (based on norms)
function calculateObsolescence(point) {
  const currentYear = new Date().getFullYear();
  const manufactureYear = new Date(point.manufacture_date).getFullYear() || 2000;
  const age = currentYear - manufactureYear;
  const avgLife = point.avg_life_years || 25;

  // Acceleration factors
  const tempFactor = Math.pow(2, (point.avg_temperature - 25) / 10); // Arrhenius
  const humFactor = point.avg_humidity > 70 ? 1.5 : 1; // Corrosion
  const cycleFactor = point.operation_cycles > 10000 ? 1.2 : 1;

  const adjustedLife = avgLife / (tempFactor * humFactor * cycleFactor);
  const remaining_life_years = Math.max(adjustedLife - age, 0);

  // Urgency score (0-100)
  let urgency = (age / adjustedLife) * 50;
  if (point.selectivity_status === 'non-selective') urgency += 20;
  if (point.fault_status === 'at-risk') urgency += 15;
  if (point.arc_status === 'at-risk') urgency += 15;
  urgency = Math.min(urgency, 100);

  const status = urgency < 30 ? 'ok' : urgency < 70 ? 'warning' : 'critical';
  const riskZones = urgency > 50 ? [{ min: 50, max: urgency }] : [];

  return { remaining_life_years: Math.round(remaining_life_years), urgency_score: Math.round(urgency), status, riskZones };
}

function getRemediations(point, urgency) {
  return [
    `Monitor closely if urgency >50; plan replacement in ${Math.round(30 - urgency / 3)} years`,
    'Reduce temperature/humidity to extend life (IEC 62271)',
    `Estimated CAPEX: ${point.replacement_cost * 1.1}€ with 10% inflation`
  ];
}

function generateForecast(point) {
  const forecast = [];
  const currentYear = new Date().getFullYear();
  let capexCumul = 0;
  const inflation = 1.02; // 2%/an

  for (let y = 0; y < 30; y++) {
    const year = currentYear + y;
    const remaining = calculateObsolescence({ ...point, manufacture_date: new Date(point.manufacture_date).setFullYear(manufactureYear + y) }).remaining_life_years;
    const capexYear = remaining <= 0 ? point.replacement_cost * Math.pow(inflation, y) : 0;
    capexCumul += capexYear;
    forecast.push({ year, remaining_life: remaining, capex_year: Math.round(capexYear), capex_cumul: Math.round(capexCumul) });
  }

  return forecast;
}

const port = process.env.OBSOLESCENCE_PORT || 3007;
app.listen(port, () => console.log(`Obsolescence service running on :${port}`));
