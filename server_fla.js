// server_fla.js
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
    console.log('[FLA] OpenAI initialized');
  } catch (e) {
    console.warn('[FLA] OpenAI init failed:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[FLA] No OPENAI_API_KEY found');
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
app.get('/api/fla/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || '').toString();
}

const WHITELIST_SORT = ['name','code','building_code'];
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'name'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

// Schema - Ajout de la table fla_checks pour sauvegarder les checks
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fla_checks (
      point_id INTEGER NOT NULL,
      point_type TEXT NOT NULL CHECK (point_type IN ('switchboard', 'device')),
      site TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('safe', 'unsafe', 'incomplete')),
      checked_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (point_id, point_type, site)
    );
    CREATE INDEX IF NOT EXISTS idx_fla_checks_site ON fla_checks(site);
  `);
}
ensureSchema().catch(e => console.error('[FLA SCHEMA] error:', e.message));

// LIST Points (switchboards ou devices principaux)
app.get('/api/fla/points', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { q, switchboard, building, floor, sort = 'name', dir = 'desc', page = '1', pageSize = '18' } = req.query;
    const where = ['s.site = $1']; const vals = [site]; let i = 2;
    if (q) { where.push(`(s.name ILIKE $${i} OR d.name ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    if (switchboard) { where.push(`s.id = $${i}`); vals.push(Number(switchboard)); i++; }
    if (building) { where.push(`s.building_code ILIKE $${i}`); vals.push(`%${building}%`); i++; }
    if (floor) { where.push(`s.floor ILIKE $${i}`); vals.push(`%${floor}%`); i++; }
    const limit = Math.min(parseInt(pageSize,10) || 18, 100);
    const offset = ((parseInt(page,10) || 1) - 1) * limit;

    const sql = `
      SELECT 
        s.id AS switchboard_id, s.name AS switchboard_name, s.building_code, s.floor, s.regime_neutral,
        d.id AS device_id, d.name AS device_name, d.device_type, d.voltage_v, d.in_amps, d.icu_ka, d.settings,
        fc.status AS status
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id AND d.is_main_incoming = TRUE
      LEFT JOIN fla_checks fc ON (fc.point_id = s.id AND fc.point_type = 'switchboard') OR (fc.point_id = d.id AND fc.point_type = 'device')
      WHERE ${where.join(' AND ')}
      ORDER BY s.${sortSafe(sort)} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM switchboards s WHERE ${where.join(' AND ')}`, vals);
    res.json({ data: rows.rows, total: count.rows[0].total });
  } catch (e) {
    console.error('[FLA POINTS] error:', e);
    res.status(500).json({ error: 'List points failed' });
  }
});

// CHECK Fault Level for a point (switchboard or device)
app.get('/api/fla/check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { point, type = 'switchboard', fault_type = '3ph' } = req.query; // type: 'switchboard' or 'device', fault_type: '3ph' or '1ph'
    const pointId = Number(point);

    let data;
    if (type === 'switchboard') {
      const r = await pool.query('SELECT * FROM switchboards WHERE id = $1 AND site = $2', [pointId, site]);
      data = r.rows[0];
      if (!data) return res.status(404).json({ error: 'Switchboard not found' });
      // Get main incoming device if exists for additional data
      const devR = await pool.query('SELECT * FROM devices WHERE switchboard_id = $1 AND is_main_incoming = TRUE LIMIT 1', [pointId]);
      if (devR.rows.length > 0) {
        data = { ...data, ...devR.rows[0] }; // Merge device data
      }
    } else if (type === 'device') {
      const r = await pool.query('SELECT * FROM devices WHERE id = $1 AND site = $2', [pointId, site]);
      data = r.rows[0];
      if (!data) return res.status(404).json({ error: 'Device not found' });
      // Get switchboard for regime_neutral if needed
      const sbR = await pool.query('SELECT regime_neutral FROM switchboards WHERE id = $1 AND site = $2', [data.switchboard_id, site]);
      if (sbR.rows.length > 0) {
        data.regime_neutral = sbR.rows[0].regime_neutral;
      }
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    // Defaults if missing
    const defaults = {
      voltage_v: data.voltage_v || 400,
      icu_ka: data.icu_ka || 50,
      regime_neutral: data.regime_neutral || 'TN-C-S',
      z_k: data.settings?.z_k || 0.1, // Impédance totale (ohm)
      c_factor: data.settings?.c_factor || 1.1, // Facteur de tension IEC 60909
      kappa: data.settings?.kappa || 1.7, // Pour Ip, basé sur R/X
    };

    // Vérification données manquantes
    const missing = [];
    if (!data.voltage_v) missing.push('Voltage missing');
    if (!data.icu_ka) missing.push('Icu missing');

    if (missing.length > 0) {
      return res.json({ status: 'incomplete', missing, remediation: 'Complete settings in Switchboards' });
    }

    // Calcul fault level
    const { ik, ip, isSafe, criticalZones } = calculateFaultLevel(data, defaults, fault_type);
    const remediation = isSafe ? [] : getRemediations(data, defaults, fault_type);
    const details = { 
      why: isSafe ? 
        'Safe: Calculated Ik" < Icu (IEC 60909-0).' : 
        'Unsafe: Ik" >= Icu; risk of equipment failure during fault.'
    };

    // Sauvegarde du statut
    await pool.query(`
      INSERT INTO fla_checks (point_id, point_type, site, status, checked_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (point_id, point_type, site)
      DO UPDATE SET status = $4, checked_at = NOW()
    `, [pointId, type, site, isSafe ? 'safe' : 'unsafe']);

    res.json({ status: isSafe ? 'safe' : 'unsafe', ik, ip, details, remediation, criticalZones });
  } catch (e) {
    console.error('[FLA CHECK] error:', e);
    res.status(500).json({ error: 'Check failed' });
  }
});

// GET Curves data for graph (e.g., fault current vs time or impedance)
app.get('/api/fla/curves', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { point, type = 'switchboard' } = req.query;
    const pointId = Number(point);

    let data;
    if (type === 'switchboard') {
      const r = await pool.query('SELECT * FROM switchboards WHERE id = $1 AND site = $2', [pointId, site]);
      data = r.rows[0];
      const devR = await pool.query('SELECT * FROM devices WHERE switchboard_id = $1 AND is_main_incoming = TRUE LIMIT 1', [pointId]);
      if (devR.rows.length > 0) data = { ...data, ...devR.rows[0] };
    } else {
      const r = await pool.query('SELECT * FROM devices WHERE id = $1 AND site = $2', [pointId, site]);
      data = r.rows[0];
    }
    if (!data) return res.status(404).json({ error: 'Point not found' });

    const defaults = {
      voltage_v: data.voltage_v || 400,
      z_k: data.settings?.z_k || 0.1,
    };

    const curve = generateCurvePoints(data, defaults); // e.g., Ik vs time or impedance

    res.json({ curve });
  } catch (e) {
    console.error('[FLA CURVES] error:', e);
    res.status(500).json({ error: 'Curves generation failed' });
  }
});

// AI TIP for remediation
app.post('/api/fla/ai-tip', async (req, res) => {
  try {
    if (!openai) return res.json({ tip: 'AI tips unavailable' });

    const { query } = req.body;
    const context = query || 'Fault level advice';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an expert in IEC 60909 fault level assessment. Provide concise remediation advice based on "${context}". Use standards like adjusting impedance, c factor. 1-2 sentences.` 
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

// Fonctions helpers pour calculs (basés sur IEC 60909)
function calculateFaultLevel(data, defaults, faultType) {
  const U_n = defaults.voltage_v;
  const Z_k = defaults.z_k; // Impédance totale
  const c = defaults.c_factor;
  const kappa = defaults.kappa;
  let ik, ip;

  if (faultType === '3ph') {
    ik = (c * U_n / Math.sqrt(3)) / Z_k; // Ik" symétrique (A)
  } else if (faultType === '1ph') {
    const Z1 = Z_k; // Simplification: Z1 ≈ Z_k
    const Z0 = getZ0FromNeutral(data.regime_neutral, Z1); // Basé sur régime
    ik = (c * U_n) / (Z1 + Z0); // Ik1 phase-terre/neutre (A)
  }

  ip = kappa * Math.sqrt(2) * ik; // Courant de crête

  const isSafe = ik / 1000 < (data.icu_ka || defaults.icu_ka); // Comparaison avec Icu (kA)
  const criticalZones = isSafe ? [] : [{ min: data.icu_ka * 1000, max: ip }]; // Zones où Ik > Icu

  return { ik, ip, isSafe, criticalZones };
}

function getZ0FromNeutral(regime, Z1) {
  // Estimations simples basées sur IEC 60909-3
  switch (regime) {
    case 'TN-C-S':
    case 'TN-C':
      return 0.5 * Z1; // Typique pour TN
    case 'TT':
      return 10 * Z1; // Haut pour TT
    case 'IT':
      return Infinity; // Isolé, faible courant
    default:
      return Z1; // Conservatif
  }
}

function getRemediations(data, defaults, faultType) {
  return [
    `Increase transformer impedance to reduce Ik (IEC 60909).`,
    `Check neutral regime for ${faultType} faults.`,
    `Upgrade device Icu to > ${Math.ceil(defaults.icu_ka)} kA.`
  ];
}

function generateCurvePoints(data, defaults) {
  const points = [];
  const minZ = defaults.z_k * 0.1;
  const maxZ = defaults.z_k * 10;
  for (let logZ = Math.log10(minZ); logZ < Math.log10(maxZ); logZ += 0.1) {
    const Z = Math.pow(10, logZ);
    const tempDefaults = { ...defaults, z_k: Z };
    const { ik } = calculateFaultLevel(data, tempDefaults, '3ph'); // Exemple pour 3ph
    points.push({ impedance: Z, ik: ik / 1000 }); // Z vs Ik (kA)
  }
  return points;
}

const port = process.env.FLA_PORT || 3005;
app.listen(port, () => console.log(`FLA service running on :${port}`));
