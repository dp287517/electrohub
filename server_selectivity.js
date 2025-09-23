// server_selectivity.js
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
    console.log('[SELECTIVITY] OpenAI initialized');
  } catch (e) {
    console.warn('[SELECTIVITY] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[SELECTIVITY] No OPENAI_API_KEY found');
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
app.get('/api/selectivity/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || '').toString();
}

const WHITELIST_SORT = ['name','code','building_code'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'name'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema - Pas de nouvelle table, réutilise devices et switchboards de switchboard

// LIST Pairs amont/aval
app.get('/api/selectivity/pairs', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, switchboard, building, floor, sort = 'name', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = ['d.site = $1 AND d.parent_id IS NOT NULL']; const vals = [site]; let i = 2;
    if (q) { where.push(`(d.name ILIKE $${i} OR u.name ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (switchboard) { where.push(`d.switchboard_id = $${i}`); vals.push(Number(switchboard)); i++; }
    if (building) { where.push(`s.building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`s.floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    const limit = Math.min(parseInt(pageSize,10) || 18, 100);
    const offset = ((parseInt(page,10) || 1) - 1) * limit;

    const sql = `
      SELECT 
        d.id AS downstream_id, d.name AS downstream_name, d.device_type AS downstream_type, d.settings AS downstream_settings,
        u.id AS upstream_id, u.name AS upstream_name, u.device_type AS upstream_type, u.settings AS upstream_settings,
        s.id AS switchboard_id, s.name AS switchboard_name
      FROM devices d
      JOIN devices u ON d.parent_id = u.id
      JOIN switchboards s ON d.switchboard_id = s.id
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortSafe(sort)} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM devices d JOIN devices u ON d.parent_id = u.id JOIN switchboards s ON d.switchboard_id = s.id WHERE ${where.join(' AND ')}`, vals);
    res.json({ data: rows.rows, total: count.rows[0].total });
  } catch (e) {
    console.error('[SELECTIVITY PAIRS] error:', e);
    res.status(500).json({ error: 'List pairs failed' });
  }
});

// CHECK Selectivity for a pair
app.get('/api/selectivity/check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { upstream, downstream } = req.query;
    const r = await pool.query(`
      SELECT * FROM devices WHERE id IN ($1, $2) AND site = $3
    `, [Number(upstream), Number(downstream), site]);
    if (r.rows.length !== 2) return res.status(404).json({ error: 'Devices not found' });

    const up = r.rows.find(d => d.id === Number(upstream));
    const down = r.rows.find(d => d.id === Number(downstream));

    // Vérification données manquantes
    const missing = [];
    if (!up.settings?.ir || !down.settings?.ir) missing.push('Ir missing');
    if (!up.in_amps || !down.in_amps) missing.push('In amps missing');
    // Ajouter plus selon besoins

    if (missing.length > 0) {
      return res.json({ status: 'incomplete', missing, remediation: 'Complete device settings in Switchboards' });
    }

    // Calcul sélectivité (simplifié basé sur IEC)
    const isSelective = checkSelectivity(up, down); // Fonction implémentée ci-dessous
    const remediation = isSelective ? [] : getRemediations(up, down);

    res.json({ status: isSelective ? 'selective' : 'non-selective', details: { /* points de calcul */ }, remediation });
  } catch (e) {
    console.error('[SELECTIVITY CHECK] error:', e);
    res.status(500).json({ error: 'Check failed' });
  }
});

// GET Curves data for graph
app.get('/api/selectivity/curves', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { upstream, downstream } = req.query;
    const r = await pool.query(`
      SELECT * FROM devices WHERE id IN ($1, $2) AND site = $3
    `, [Number(upstream), Number(downstream), site]);
    if (r.rows.length !== 2) return res.status(404).json({ error: 'Devices not found' });

    const up = r.rows.find(d => d.id === Number(upstream));
    const down = r.rows.find(d => d.id === Number(downstream));

    const upCurve = generateCurvePoints(up); // Points [current, time]
    const downCurve = generateCurvePoints(down);

    res.json({ upstream: upCurve, downstream: downCurve });
  } catch (e) {
    console.error('[SELECTIVITY CURVES] error:', e);
    res.status(500).json({ error: 'Curves generation failed' });
  }
});

// AI TIP for remediation
app.post('/api/selectivity/ai-tip', async (req, res) => {
  try {
    if (!openai) return res.json({ tip: 'AI tips unavailable' });

    const { query } = req.body;
    const context = query || 'Selectivity advice';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in IEC 60947 selectivity. Provide concise remediation advice based on "${context}". Use standards like time-current curves, adjust Ir/Isd. 1-2 sentences.` 
        },
        { role: 'user', content: context }
      ],
      max_tokens: 120,
      temperature: 0.3
    });

    const tip = completion.choices[0].message.content.trim();
    res.json({ tip });
  } catch (e) {
    console.error('[AI TIP] error:', e.message);
    res.status(500).json({ error: 'AI tip failed' });
  }
});

// Fonctions helpers pour calculs (basés sur recherches IEC)
function checkSelectivity(up, down) {
  // Grille de courants test (log scale)
  const currents = Array.from({length: 20}, (_, i) => Math.pow(10, i/5) * Math.min(up.in_amps, down.in_amps));
  for (let I of currents) {
    const tDown = calculateTripTime(down, I);
    const tUp = calculateTripTime(up, I);
    if (tDown >= tUp * 1.05) return false; // Non-selective si aval plus lent
  }
  return true;
}

function calculateTripTime(device, I) {
  const { settings, in_amps: In, device_type } = device;
  const Ir = settings.ir || 1;
  const Tr = settings.tr || 10;
  const Isd = settings.isd || 6;
  const Tsd = settings.tsd || 0.1;
  const Ii = settings.ii || 10;

  if (I > Ii * Ir * In) return 0.01; // Instantané
  if (I > Isd * Ir * In) return Tsd; // Short-time
  if (I > Ir * In) return Tr / ((I / (Ir * In)) ** 2 - 1); // Long-time approx I²t
  return Infinity; // Pas de trip
}

function getRemediations(up, down) {
  return ['Increase upstream Isd to > downstream Isd * 1.6', 'Enable ZSI if available', 'Check curve types compatibility'];
}

function generateCurvePoints(device) {
  const points = [];
  const minI = device.in_amps * 0.1;
  const maxI = device.icu_ka * 1000;
  for (let logI = Math.log10(minI); logI < Math.log10(maxI); logI += 0.1) {
    const I = Math.pow(10, logI);
    const t = calculateTripTime(device, I);
    if (t < Infinity) points.push({ current: I, time: t });
  }
  return points;
}

const port = process.env.SELECTIVITY_PORT || 3004;
app.listen(port, () => console.log(`Selectivity service running on :${port}`));
