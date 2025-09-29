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

// Schema - Ajout de la table selectivity_checks avec statut étendu
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS selectivity_checks (
      upstream_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      downstream_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      site TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('selective', 'partial-selective', 'non-selective', 'incomplete')),
      checked_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (upstream_id, downstream_id, site)
    );
    CREATE INDEX IF NOT EXISTS idx_selectivity_checks_site ON selectivity_checks(site);
  `);
}
ensureSchema().catch(e => console.error('[SELECTIVITY SCHEMA] error:', e.message));

// LIST Pairs amont/aval (inchangé)
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
        s.id AS switchboard_id, s.name AS switchboard_name,
        sc.status AS status
      FROM devices d
      JOIN devices u ON d.parent_id = u.id
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id AND u.id = sc.upstream_id AND sc.site = $1
      WHERE ${where.join(' AND ')}
      ORDER BY s.${sortSafe(sort)} ${dirSafe(dir)}
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

// CHECK Selectivity for a pair (corrigé avec automatisation et partial)
app.get('/api/selectivity/check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { upstream, downstream, fault_current } = req.query;
    const r = await pool.query(`
      SELECT * FROM devices WHERE id IN ($1, $2) AND site = $3
    `, [Number(upstream), Number(downstream), site]);
    if (r.rows.length !== 2) return res.status(404).json({ error: 'Devices not found' });

    let up = r.rows.find(d => d.id === Number(upstream));
    let down = r.rows.find(d => d.id === Number(downstream));

    // Automatisation des settings à partir de device_type/switchboard data
    [up, down].forEach(device => {
      device.settings = device.settings || {};
      const type = device.device_type?.toLowerCase() || 'mccb'; // Assume MCCB par défaut
      if (!device.settings.trip_type) {
        device.settings.trip_type = type.includes('mcb') ? 'thermal-magnetic' : 'electronic';
      }
      if (device.settings.trip_type === 'thermal-magnetic') {
        device.settings.tsd = 0; // Pas de délai pour TM
        if (!device.settings.curve) device.settings.curve = 'C'; // Default C
        const curveMultipliers = { 'B': {min:3, max:5, avg:4}, 'C': {min:5, max:10, avg:7.5}, 'D': {min:10, max:20, avg:15} };
        device.settings.isd = device.settings.isd || curveMultipliers[device.settings.curve]?.avg || 6;
      }
      device.settings.ir = device.settings.ir || 1;
      device.settings.tr = device.settings.tr || 10;
      device.settings.isd = device.settings.isd || 6;
      device.settings.tsd = device.settings.tsd || 0.1;
      device.settings.ii = device.settings.ii || 10;
    });

    // Vérification données manquantes
    const missing = [];
    if (!up.settings.ir || !down.settings.ir) missing.push('Ir missing');
    if (!up.in_amps || !down.in_amps) missing.push('In amps missing');

    if (missing.length > 0) {
      await pool.query(`
        INSERT INTO selectivity_checks (upstream_id, downstream_id, site, status, checked_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (upstream_id, downstream_id, site)
        DO UPDATE SET status = $4, checked_at = NOW()
      `, [Number(upstream), Number(downstream), site, 'incomplete']);
      return res.json({ status: 'incomplete', missing, remediation: 'Complete device settings in Switchboards' });
    }

    // Calcul sélectivité et zones non-sélectives
    const { isSelective, isPartial, nonSelectiveZones } = checkSelectivity(up, down, Number(fault_current));
    const status = isSelective ? 'selective' : (isPartial ? 'partial-selective' : 'non-selective');
    const remediation = isSelective ? [] : getRemediations(up, down);
    const details = { 
      why: isSelective ? 
        'Total selectivity achieved: Downstream trip time < upstream for all tested currents (IEC 60947-2).' : 
        (isPartial ? 'Partial selectivity: Selective up to Icu downstream, but non-selective beyond (adjust for Isc max).' :
        'Non-selectivity: Downstream trip time >= upstream at some currents; adjust settings for better coordination.')
    };

    // Sauvegarde du statut
    await pool.query(`
      INSERT INTO selectivity_checks (upstream_id, downstream_id, site, status, checked_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (upstream_id, downstream_id, site)
      DO UPDATE SET status = $4, checked_at = NOW()
    `, [Number(upstream), Number(downstream), site, status]);

    res.json({ status, details, remediation, nonSelectiveZones });
  } catch (e) {
    console.error('[SELECTIVITY CHECK] error:', e);
    res.status(500).json({ error: 'Check failed' });
  }
});

// GET Curves data for graph (ajout automatisation similaire)
app.get('/api/selectivity/curves', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { upstream, downstream } = req.query;
    const r = await pool.query(`
      SELECT * FROM devices WHERE id IN ($1, $2) AND site = $3
    `, [Number(upstream), Number(downstream), site]);
    if (r.rows.length !== 2) return res.status(404).json({ error: 'Devices not found' });

    let up = r.rows.find(d => d.id === Number(upstream));
    let down = r.rows.find(d => d.id === Number(downstream));

    // Automatisation identique à /check
    [up, down].forEach(device => {
      device.settings = device.settings || {};
      const type = device.device_type?.toLowerCase() || 'mccb';
      if (!device.settings.trip_type) {
        device.settings.trip_type = type.includes('mcb') ? 'thermal-magnetic' : 'electronic';
      }
      if (device.settings.trip_type === 'thermal-magnetic') {
        device.settings.tsd = 0;
        if (!device.settings.curve) device.settings.curve = 'C';
        const curveMultipliers = { 'B': {min:3, max:5, avg:4}, 'C': {min:5, max:10, avg:7.5}, 'D': {min:10, max:20, avg:15} };
        device.settings.isd = device.settings.isd || curveMultipliers[device.settings.curve]?.avg || 6;
      }
      device.settings.ir = device.settings.ir || 1;
      device.settings.tr = device.settings.tr || 10;
      device.settings.isd = device.settings.isd || 6;
      device.settings.tsd = device.settings.tsd || 0.1;
      device.settings.ii = device.settings.ii || 10;
    });

    const upCurve = generateCurvePoints(up);
    const downCurve = generateCurvePoints(down);

    res.json({ upstream: upCurve, downstream: downCurve });
  } catch (e) {
    console.error('[SELECTIVITY CURVES] error:', e);
    res.status(500).json({ error: 'Curves generation failed' });
  }
});

// AI TIP for remediation (prompt mis à jour)
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
          content: `You are an expert in IEC 60947 selectivity. Provide concise remediation advice based on "${context}". Consider trip_type (thermal-magnetic or electronic) and curve (B/C/D). For TM, ensure Im_up >=2*Im_down max. Use standards like time-current curves, adjust Ir/Isd. 1-2 sentences.` 
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

// Fonctions helpers pour calculs (corrigées)
function checkSelectivity(up, down, faultI = null) {
  const minIn = Math.min(up.in_amps || 100, down.in_amps || 100);
  const maxIcu = Math.min(up.icu_ka || 50, down.icu_ka || 50) * 1000;
  const currents = faultI ? [Number(faultI)] : Array.from({length: 20}, (_, i) => Math.pow(10, i/5) * minIn).filter(I => I <= maxIcu);
  const nonSelectiveZones = [];
  let zoneStart = null;
  let isSelective = true;
  let isPartial = false;

  for (let i = 0; i < currents.length; i++) {
    const I = currents[i];
    const tDown = calculateTripTime(down, I);
    const tUp = calculateTripTime(up, I);
    const isInstant = tUp < 0.05 || tDown < 0.05; // Pour TM/instant, marge stricte
    const threshold = isInstant ? 1 : 1.05;
    if (tDown >= tUp * threshold) {
      isSelective = false;
      if (zoneStart === null) zoneStart = I;
      // Partial si zone au-delà Icu down
      if (I > (down.icu_ka || 10) * 1000) isPartial = true;
    } else if (zoneStart !== null) {
      nonSelectiveZones.push({ xMin: zoneStart, xMax: I });
      zoneStart = null;
    }
  }
  if (zoneStart !== null) nonSelectiveZones.push({ xMin: zoneStart, xMax: currents[currents.length - 1] });

  if (!isSelective && nonSelectiveZones.every(zone => zone.xMin > (down.icu_ka || 10) * 1000)) isPartial = true;

  return { isSelective, isPartial, nonSelectiveZones };
}

function calculateTripTime(device, I) {
  const { settings, in_amps: In } = device;
  const Ir = settings.ir || 1;
  const Tr = settings.tr || 10;
  const Isd = settings.isd || 6;
  const Tsd = settings.tsd || 0.1;
  const Ii = settings.ii || 10;

  if (I > Ii * Ir * In) return 0.01; // Instantané
  if (I > Isd * Ir * In) return Tsd; // Short-time (0 pour TM)
  if (I > Ir * In) {
    // Formule affinée pour TM : calibrée à 6*Ir (Schneider/IEC approx)
    const k = Tr * Math.pow(6 * Ir * In, 2) / 36; // k = I²t constant approx
    return k / Math.pow(I, 2);
  }
  return Infinity; // Pas de trip
}

function getRemediations(up, down) {
  const rem = [];
  if (up.settings.trip_type === 'thermal-magnetic' || down.settings.trip_type === 'thermal-magnetic') {
    rem.push('For TM: Ensure Im_up >= 2 * Im_down max (IEC ratio)');
  }
  rem.push('Increase upstream Isd to > downstream Isd * 1.6');
  rem.push('Enable ZSI if available (for electronic)');
  rem.push('Check curve types compatibility (B/C/D)');
  return rem;
}

function generateCurvePoints(device) {
  const points = [];
  const minI = (device.in_amps || 100) * 0.1;
  const maxI = (device.icu_ka || 50) * 1000;
  for (let logI = Math.log10(minI); logI < Math.log10(maxI); logI += 0.1) {
    const I = Math.pow(10, logI);
    let t = calculateTripTime(device, I);
    if (t === Infinity) t = 1000; // Limite pour affichage
    if (t > 0) points.push({ current: I, time: t });
  }
  return points;
}

const port = process.env.SELECTIVITY_PORT || 3004;
app.listen(port, () => console.log(`Selectivity service running on :${port}`));
