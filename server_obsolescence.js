// server_obsolescence.js
// (CSP-safe, hybrid pricing with your bracket as floor, web-cost optional, + HV/VSD/MECA support + asset filter)
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import multer from 'multer';
import axios from 'axios';
import { getSiteFilter } from './lib/tenant-filter.js';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// ========== VSD COST ESTIMATION ==========
function estimateVsdCostGBP(vsd) {
  const powerKw = Number(vsd?.power_kw || 0);
  // VSD pricing based on power rating (UK installed prices)
  if (powerKw <= 0.75) return 800;
  if (powerKw <= 1.5) return 1000;
  if (powerKw <= 2.2) return 1200;
  if (powerKw <= 4) return 1500;
  if (powerKw <= 7.5) return 2200;
  if (powerKw <= 11) return 3000;
  if (powerKw <= 15) return 3800;
  if (powerKw <= 22) return 4800;
  if (powerKw <= 30) return 6000;
  if (powerKw <= 45) return 8000;
  if (powerKw <= 55) return 10000;
  if (powerKw <= 75) return 13000;
  if (powerKw <= 90) return 16000;
  if (powerKw <= 110) return 20000;
  if (powerKw <= 132) return 25000;
  if (powerKw <= 160) return 30000;
  if (powerKw <= 200) return 38000;
  if (powerKw <= 250) return 48000;
  if (powerKw <= 315) return 60000;
  if (powerKw <= 400) return 75000;
  return 90000; // >400kW
}

// ========== MECA COST ESTIMATION ==========
function estimateMecaCostGBP(meca) {
  const category = String(meca?.category || '').toLowerCase();
  const subcategory = String(meca?.subcategory || '').toLowerCase();
  const powerKw = Number(meca?.power_kw || 0);

  // Base cost by category
  let baseCost = 5000;
  if (category.includes('pump') || category.includes('pompe')) {
    baseCost = powerKw <= 5 ? 3000 : powerKw <= 15 ? 6000 : powerKw <= 30 ? 12000 : powerKw <= 55 ? 20000 : 35000;
  } else if (category.includes('compressor') || category.includes('compresseur')) {
    baseCost = powerKw <= 5 ? 8000 : powerKw <= 15 ? 15000 : powerKw <= 30 ? 25000 : powerKw <= 55 ? 40000 : 65000;
  } else if (category.includes('fan') || category.includes('ventilat')) {
    baseCost = powerKw <= 5 ? 2000 : powerKw <= 15 ? 4000 : powerKw <= 30 ? 8000 : powerKw <= 55 ? 15000 : 25000;
  } else if (category.includes('motor') || category.includes('moteur')) {
    baseCost = powerKw <= 5 ? 1500 : powerKw <= 15 ? 3000 : powerKw <= 30 ? 6000 : powerKw <= 55 ? 12000 : 20000;
  } else if (category.includes('conveyor') || category.includes('convoyeur')) {
    baseCost = 15000;
  } else if (category.includes('hvac') || category.includes('cta') || category.includes('ahu')) {
    baseCost = 25000;
  }

  return Math.round(baseCost * 1.15); // +15% for installation
}

// ========== VSD TOTALS ==========
async function computeVsdTotals(site) {
  const hasSite = site && site.trim() !== '';

  // Try to select service_year if it exists, otherwise fallback
  let result;
  try {
    result = await pool.query(`
      SELECT
        id, name, tag, building, floor, zone, manufacturer, model,
        power_kw, voltage, ui_status, criticality, created_at,
        service_year AS stored_service_year
      FROM vsd_equipments
      ${hasSite ? 'WHERE site = $1' : ''}
      ORDER BY id ASC
    `, hasSite ? [site] : []);
  } catch (err) {
    // Fallback if service_year column doesn't exist
    result = await pool.query(`
      SELECT
        id, name, tag, building, floor, zone, manufacturer, model,
        power_kw, voltage, ui_status, criticality, created_at,
        NULL AS stored_service_year
      FROM vsd_equipments
      ${hasSite ? 'WHERE site = $1' : ''}
      ORDER BY id ASC
    `, hasSite ? [site] : []);
  }

  return result.rows.map(vsd => {
    // Use stored service_year if available, otherwise estimate from created_at
    let service_year;
    if (vsd.stored_service_year) {
      service_year = vsd.stored_service_year;
    } else {
      const createdAt = vsd.created_at ? new Date(vsd.created_at).getFullYear() : new Date().getFullYear() - 5;
      service_year = createdAt;
    }
    const avg_life_years = 15; // VSD typical lifespan

    return {
      kind: 'vsd',
      vsd_id: vsd.id,
      name: vsd.name || vsd.tag || `VSD-${vsd.id}`,
      building_code: vsd.building || 'Unknown',
      floor: vsd.floor || '',
      site: site,
      device_count: 1,
      service_year,
      avg_life_years,
      estimated_cost_gbp: estimateVsdCostGBP(vsd),
      manufacturer: vsd.manufacturer,
      power_kw: vsd.power_kw,
      status: vsd.ui_status,
      criticality: vsd.criticality
    };
  });
}

// ========== MECA TOTALS ==========
async function computeMecaTotals(site) {
  const hasSite = site && site.trim() !== '';

  // Try with all columns, fallback progressively for missing columns
  let result;
  try {
    result = await pool.query(`
      SELECT
        id, name, tag, building, floor, zone, manufacturer, model,
        category, power_kw, criticality, installation_date, created_at
      FROM meca_equipments
      ${hasSite ? 'WHERE site = $1' : ''}
      ORDER BY id ASC
    `, hasSite ? [site] : []);
  } catch (err) {
    // Final fallback with minimal columns
    try {
      result = await pool.query(`
        SELECT
          id, name, tag, building, floor, manufacturer, model,
          category, power_kw, installation_date, created_at
        FROM meca_equipments
        ${hasSite ? 'WHERE site = $1' : ''}
        ORDER BY id ASC
      `, hasSite ? [site] : []);
    } catch (err2) {
      console.log('[OBS] MECA query failed:', err2.message);
      return [];
    }
  }

  return result.rows.map(meca => {
    // Use installation_date if available, otherwise estimate from created_at
    let service_year;
    if (meca.installation_date) {
      service_year = new Date(meca.installation_date).getFullYear();
    } else if (meca.created_at) {
      service_year = new Date(meca.created_at).getFullYear() - 3; // Assume 3 years before entry
    } else {
      service_year = new Date().getFullYear() - 8;
    }

    // Lifespan varies by category
    const category = String(meca.category || '').toLowerCase();
    let avg_life_years = 20;
    if (category.includes('pump') || category.includes('pompe')) avg_life_years = 15;
    if (category.includes('compressor') || category.includes('compresseur')) avg_life_years = 12;
    if (category.includes('fan') || category.includes('ventilat')) avg_life_years = 18;
    if (category.includes('motor') || category.includes('moteur')) avg_life_years = 25;

    return {
      kind: 'meca',
      meca_id: meca.id,
      name: meca.name || meca.tag || `MECA-${meca.id}`,
      building_code: meca.building || 'Unknown',
      floor: meca.floor || '',
      site: site,
      device_count: 1,
      service_year,
      avg_life_years,
      estimated_cost_gbp: estimateMecaCostGBP(meca),
      manufacturer: meca.manufacturer,
      category: meca.category,
      power_kw: meca.power_kw,
      criticality: meca.criticality
    };
  });
}

let openai = null;
try {
  if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch {}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage() });

app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const GBP = v => Math.max(0, Math.round(Number(v || 0)));
const webCostCache = new Map();
const isWebCostEnabled = !!process.env.ENABLE_WEB_COST;

function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}

// ---------- SCHEMA (SB-side only; HV vient d'un service/table dédié qu'on lit en lecture) ----------
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS obsolescence_checks (
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
      site TEXT NOT NULL,
      remaining_life_years NUMERIC NOT NULL,
      urgency_score NUMERIC NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
      status TEXT NOT NULL CHECK (status IN ('ok','warning','critical','incomplete')),
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
      document_link TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (device_id, switchboard_id, site)
    );
    CREATE INDEX IF NOT EXISTS idx_obsolescence_parameters_site ON obsolescence_parameters(site);
  `);
}
ensureSchema().catch(console.error);

// ---------- COÛTS (SB) ----------
function bracketBreakerCostGBP(amps) {
  const A = Number(amps || 0);
  if (A <= 10) return 20;
  if (A <= 20) return 30;
  if (A <= 40) return 60;
  if (A <= 80) return 80;
  if (A <= 120) return 150;
  if (A <= 160) return 500;
  if (A <= 250) return 800;
  if (A <= 400) return 1200;
  if (A <= 630) return 2000;
  if (A <= 1500) return 5000;
  if (A <= 2000) return 10000;
  if (A <= 4000) return 15000;
  return 15000;
}

function estimateDeviceCostGBP(type = '', inAmps = 0) {
  const t = String(type || '').toUpperCase();
  const A = Number(inAmps || 0);

  let base = bracketBreakerCostGBP(A);

  if (t.includes('MCCB')) {
    const fam =
      A <= 160 ? 600 :
      A <= 250 ? 1000 :
      A <= 400 ? 1800 :
      A <= 630 ? 3200 :
      A <= 800 ? 5200 : 8500;
    base = Math.max(base, fam);
  } else if (t.includes('ACB')) {
    const fam = A <= 3200 ? 9000 : 14000;
    base = Math.max(base, fam);
  } else if (t.includes('VCB') || t.includes('VACUUM')) {
    base = Math.max(base, 15000);
  } else if (t.includes('MCB') || t.includes('MINIATURE')) {
    base = Math.max(base, base);
  } else if (t.includes('RELAY') || t.includes('PROTECTION')) {
    base = Math.max(base, 2500);
  } else if (t.includes('FUSE')) {
    base = Math.max(base, 150);
  } else if (t.includes('BREAKER') || t.includes('DISJONCTEUR')) {
    base = Math.max(base, base);
  }

  return GBP(base);
}

// Optionnel: raffinement web (si ENABLE_WEB_COST=1 et clé OpenAI dispo)
async function estimateFromWeb(type = '', inAmps = 0) {
  try {
    if (!isWebCostEnabled || !openai) return null;
    const key = `${String(type).toUpperCase()}_${Number(inAmps)}`;
    if (webCostCache.has(key)) return webCostCache.get(key);

    const q = encodeURIComponent(`${type} ${inAmps}A price UK installed`);
    const r = await axios.get(`https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1&no_html=1`);
    const abstract = r?.data?.AbstractText || '';
    if (!abstract) return null;

    const comp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Return ONE integer: installed cost in GBP (materials+labour), conservative, no symbols.' },
        { role: 'user', content: `Infer a realistic installed price for ${type} ${inAmps}A in the UK from: "${abstract}". Return just the number.` }
      ],
      max_tokens: 10,
      temperature: 0.2
    });
    const n = parseInt((comp.choices?.[0]?.message?.content || '').replace(/[^0-9]/g, ''), 10);
    const val = Number.isFinite(n) && n > 0 ? n : null;
    if (val) webCostCache.set(key, val);
    return val;
  } catch {
    return null;
  }
}

async function deviceEstimatedOrParamCostGBP(row) {
  if (row.replacement_cost && Number(row.replacement_cost) > 0) return GBP(row.replacement_cost);
  const web = await estimateFromWeb(row.device_type, row.in_amps);
  if (web) return GBP(web);
  return estimateDeviceCostGBP(row.device_type, row.in_amps);
}

async function computeSwitchboardTotals(site) {
  // Support global role: if site is null/undefined, return all switchboards
  const hasSite = site && site.trim() !== '';
  const r = await pool.query(`
    SELECT s.id AS switchboard_id, s.name, s.code, s.building_code, s.floor, s.site,
           d.id AS device_id, d.device_type, d.in_amps,
           op.replacement_cost, op.manufacture_date, op.avg_life_years
    FROM switchboards s
    LEFT JOIN devices d ON d.switchboard_id = s.id
    LEFT JOIN obsolescence_parameters op
      ON op.device_id = d.id AND op.switchboard_id = s.id AND op.site = s.site
    ${hasSite ? 'WHERE s.site = $1' : ''}
  `, hasSite ? [site] : []);

  const bySB = new Map();
  for (const row of r.rows) {
    if (!bySB.has(row.switchboard_id)) bySB.set(row.switchboard_id, {
      switchboard_id: row.switchboard_id,
      name: row.name,
      code: row.code,
      building_code: row.building_code,
      floor: row.floor,
      site: row.site,
      devices: [],
    });
    bySB.get(row.switchboard_id).devices.push(row);
  }

  const enriched = [];
  for (const sb of bySB.values()) {
    const n = sb.devices.filter(d => d.device_id).length;
    const boardBase = 1500 + 400 * Math.max(0, n - 4);
    let sumDevices = 0;
    for (const d of sb.devices) {
      if (!d.device_id) continue;
      const c = await deviceEstimatedOrParamCostGBP(d);
      sumDevices += c;
    }
    const total = GBP((boardBase + sumDevices) * 1.15);
    const years = sb.devices.map(d => d.manufacture_date).filter(Boolean).map(x => new Date(x).getFullYear()).filter(y => Number.isFinite(y));
    const service_year = years.length ? years.sort((a,b)=>a-b)[Math.floor(years.length/2)] : null;
    const lifeVals = sb.devices.map(d => Number(d.avg_life_years)).filter(v => Number.isFinite(v) && v>0);
    const avg_life_years = lifeVals.length ? Math.round(lifeVals.reduce((a,b)=>a+b,0)/lifeVals.length) : 25;

    enriched.push({
      kind: 'sb',
      switchboard_id: sb.switchboard_id,
      name: sb.name,
      code: sb.code,
      building_code: sb.building_code,
      floor: sb.floor,
      site: sb.site,
      device_count: n,
      service_year,
      avg_life_years,
      estimated_cost_gbp: total,
    });
  }
  return enriched;
}

// ---------- COÛTS (HV) ----------
function estimateHvDeviceCostGBP(dev) {
  const t = String(dev?.device_type || '').toUpperCase();
  // fallback length for cables (if length_m column absent or null)
  const lengthM = Number(dev?.length_m || 0) || 50;

  if (t.includes('TRANSFORMER'))       return 25000;
  if (t.includes('CIRCUIT BREAKER'))   return 15000;
  if (t.includes('VCB') || t.includes('SWITCHGEAR') || t.includes('CELL')) return 20000;
  if (t.includes('RELAY'))             return 4000;
  if (t.includes('CABLE'))             return 120 * lengthM;
  return 8000; // générique HV
}

async function computeHvTotals(site) {
  // Support global role: if site is null/undefined, return all HV equipments
  const hasSite = site && site.trim() !== '';

  // Try to select service_year if it exists, otherwise fallback to basic query
  let eq;
  try {
    eq = await pool.query(`
      SELECT e.id AS hv_equipment_id, e.name, e.building_code, e.floor, e.site,
             e.service_year AS stored_service_year
      FROM hv_equipments e
      ${hasSite ? 'WHERE e.site = $1' : ''}
      ORDER BY e.id ASC
    `, hasSite ? [site] : []);
  } catch (err) {
    // Fallback if service_year column doesn't exist
    eq = await pool.query(`
      SELECT e.id AS hv_equipment_id, e.name, e.building_code, e.floor, e.site,
             NULL AS stored_service_year
      FROM hv_equipments e
      ${hasSite ? 'WHERE e.site = $1' : ''}
      ORDER BY e.id ASC
    `, hasSite ? [site] : []);
  }

  const out = [];
  for (const row of eq.rows) {
    const devs = await pool.query(`
      SELECT d.*
      FROM hv_devices d
      WHERE d.hv_equipment_id = $1
      ORDER BY d.id ASC
    `, [row.hv_equipment_id]);

    const n = devs.rows.length;
    const base = 5000 + 2000 * Math.max(0, n - 2); // châssis/liaisons HV
    let sum = 0;
    for (const d of devs.rows) sum += estimateHvDeviceCostGBP(d);
    const estimated_cost_gbp = GBP((base + sum) * 1.10);

    // Use stored service_year if available
    const service_year = row.stored_service_year || null;
    const avg_life_years = 30; // défaut HV

    out.push({
      kind: 'hv',
      hv_equipment_id: row.hv_equipment_id,
      name: row.name,
      building_code: row.building_code || 'Unknown',
      floor: row.floor || '',
      site: row.site,
      device_count: n,
      service_year,
      avg_life_years,
      estimated_cost_gbp
    });
  }
  return out;
}

// ---------- Sélecteur selon le filtre asset ----------
async function pickTotalsByAsset(site, asset = 'all') {
  const sbs = await computeSwitchboardTotals(site);
  if (asset === 'sb') return sbs;

  const hvs = await computeHvTotals(site);
  if (asset === 'hv') return hvs;

  // VSD support
  let vsds = [];
  try {
    vsds = await computeVsdTotals(site);
  } catch (e) {
    console.log('[OBS] VSD table not available:', e.message);
  }
  if (asset === 'vsd') return vsds;

  // MECA support
  let mecas = [];
  try {
    mecas = await computeMecaTotals(site);
  } catch (e) {
    console.log('[OBS] MECA table not available:', e.message);
  }
  if (asset === 'meca') return mecas;

  // Combined assets
  return [...sbs, ...hvs, ...vsds, ...mecas];
}

// ---------- Get asset stats by type ----------
async function getAssetStats(site) {
  const sbs = await computeSwitchboardTotals(site);
  const hvs = await computeHvTotals(site);
  let vsds = [];
  let mecas = [];
  try { vsds = await computeVsdTotals(site); } catch {}
  try { mecas = await computeMecaTotals(site); } catch {}

  const now = new Date().getFullYear();
  const calcStats = (items) => {
    let totalCost = 0;
    let urgent = 0, medium = 0, low = 0;
    items.forEach(it => {
      totalCost += it.estimated_cost_gbp || 0;
      const remaining = (it.service_year || now - 10) + (it.avg_life_years || 25) - now;
      if (remaining < 5) urgent++;
      else if (remaining <= 10) medium++;
      else low++;
    });
    return { count: items.length, totalCost, urgent, medium, low };
  };

  return {
    switchboards: calcStats(sbs),
    hv: calcStats(hvs),
    vsd: calcStats(vsds),
    meca: calcStats(mecas),
    all: calcStats([...sbs, ...hvs, ...vsds, ...mecas])
  };
}

// ---------- Obsolescence calc ----------
function calculateObsolescence(point) {
  const nowY = new Date().getFullYear();
  const mfg = point.manufacture_date && !isNaN(new Date(point.manufacture_date).getTime())
    ? new Date(point.manufacture_date).getFullYear()
    : nowY - 10;

  const age = Math.max(0, nowY - mfg);
  const avgLife = Number(point.avg_life_years) || 25;
  const temp = Number(point.avg_temperature) || 25;
  const hum = Number(point.avg_humidity) || 50;
  const cycles = Number(point.operation_cycles) || 5000;

  const tempFactor = Math.pow(2, (temp - 25) / 10);
  const humFactor = hum > 70 ? 1.5 : 1;
  const cycleFactor = cycles > 10000 ? 1.2 : 1;

  const adjustedLife = Math.max(1, avgLife / (tempFactor * humFactor * cycleFactor));
  const remaining = Math.max(0, adjustedLife - age);

  let urgency = (age / adjustedLife) * 50;
  if (point.selectivity_status === 'non-selective') urgency += 20;
  if (point.fault_status === 'at-risk')          urgency += 15;
  if (point.arc_status === 'at-risk')            urgency += 15;
  urgency = Math.min(100, Math.max(0, urgency));

  const status = urgency < 30 ? 'ok' : urgency < 70 ? 'warning' : 'critical';
  return { remaining_life_years: Math.round(remaining), urgency_score: Math.round(urgency), status };
}

// ---------- HEALTH ----------
app.get('/api/obsolescence/health', (_req, res) =>
  res.json({ ok: true, ts: Date.now(), openai: !!openai, web_cost: isWebCostEnabled })
);

// ---------- ASSET STATS (for dashboard cards) ----------
app.get('/api/obsolescence/asset-stats', async (req, res) => {
  try {
    const { siteName, role } = getSiteFilter(req);
    const site = (role === 'global' || role === 'admin' || role === 'superadmin') ? (siteName || null) : (siteName || siteOf(req));
    const stats = await getAssetStats(site);
    res.json({ stats });
  } catch (e) {
    console.error('[OBS STATS]', e.message);
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ---------- ALL ITEMS (flat list for tables) ----------
app.get('/api/obsolescence/all-items', async (req, res) => {
  try {
    const { siteName, role } = getSiteFilter(req);
    const site = (role === 'global' || role === 'admin' || role === 'superadmin') ? (siteName || null) : (siteName || siteOf(req));
    const { asset = 'all', building, sort = 'urgency', limit = 100 } = req.query;

    let items = await pickTotalsByAsset(site, String(asset));
    const now = new Date().getFullYear();

    // Add computed fields
    items = items.map(it => {
      const serviceYear = it.service_year || (now - 10);
      const avgLife = it.avg_life_years || 25;
      const forecastYear = serviceYear + avgLife;
      const remainingYears = forecastYear - now;
      const urgencyScore = Math.min(100, Math.max(0, ((avgLife - remainingYears) / avgLife) * 100));
      return {
        ...it,
        forecast_year: forecastYear,
        remaining_years: remainingYears,
        urgency_score: Math.round(urgencyScore),
        urgency_level: remainingYears < 5 ? 'critical' : remainingYears <= 10 ? 'warning' : 'ok'
      };
    });

    // Filter by building if specified
    if (building) {
      items = items.filter(it => it.building_code === building);
    }

    // Sort
    if (sort === 'urgency') {
      items.sort((a, b) => b.urgency_score - a.urgency_score);
    } else if (sort === 'cost') {
      items.sort((a, b) => b.estimated_cost_gbp - a.estimated_cost_gbp);
    } else if (sort === 'year') {
      items.sort((a, b) => a.forecast_year - b.forecast_year);
    }

    // Limit
    items = items.slice(0, Number(limit));

    res.json({ items, total: items.length });
  } catch (e) {
    console.error('[OBS ALL-ITEMS]', e.message);
    res.status(500).json({ error: 'Items failed' });
  }
});

// ---------- TEST DATA ----------
app.post('/api/obsolescence/test-data', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const sb = await pool.query('SELECT id FROM switchboards WHERE site=$1 LIMIT 1', [site]);
    if (sb.rows.length === 0) {
      const sbi = await pool.query(
        'INSERT INTO switchboards (site, name, code, building_code, floor) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [site, 'Test SB', 'TSB', '21', 'Ground']
      );
      await pool.query(
        'INSERT INTO devices (site, switchboard_id, name, device_type, in_amps, replacement_cost) VALUES ($1,$2,$3,$4,$5,$6)',
        [site, sbi.rows[0].id, 'MCCB 250A', 'MCCB', 250, 0]
      );
    }
    res.json({ message: 'Test data ready' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- RESET ----------
app.post('/api/obsolescence/reset', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    await pool.query('DELETE FROM obsolescence_checks WHERE site=$1', [site]);
    await pool.query('DELETE FROM obsolescence_parameters WHERE site=$1', [site]);
    res.json({ message: 'Reset ok' });
  } catch (e) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// ---------- BUILDINGS (asset filter) ----------
app.get('/api/obsolescence/buildings', async (req, res) => {
  try {
    const { siteName, role } = getSiteFilter(req);
    // For global/admin users: no site filter (pass null), for site users: require site
    const site = (role === 'global' || role === 'admin' || role === 'superadmin') ? (siteName || null) : (siteName || siteOf(req));
    const { asset = 'all' } = req.query;
    if (role === 'site' && !site) return res.status(400).json({ error: 'Missing site' });

    const totals = await pickTotalsByAsset(site, String(asset));
    console.log(`[OBS BUILDINGS] Loaded ${totals.length} items for role=${role}, site=${site || 'all'}`);
    const grouped = new Map();
    for (const it of totals) {
      const key = it.building_code || 'Unknown';
      if (!grouped.has(key)) grouped.set(key, { building: key, count: 0, total_cost: 0 });
      const g = grouped.get(key);
      g.count += 1;
      g.total_cost += it.estimated_cost_gbp;
    }
    res.json({ data: Array.from(grouped.values()) });
  } catch (e) {
    console.error('[OBS BUILDINGS]', e.message);
    res.status(500).json({ error: 'Buildings load failed' });
  }
});

// ---------- SWITCHBOARDS/HV (asset filter) ----------
app.get('/api/obsolescence/switchboards', async (req, res) => {
  try {
    const { siteName, role } = getSiteFilter(req);
    // For global/admin users: no site filter (pass null), for site users: require site
    const site = (role === 'global' || role === 'admin' || role === 'superadmin') ? (siteName || null) : (siteName || siteOf(req));
    const { building, asset = 'sb' } = req.query;
    if ((role === 'site' && !site) || !building) return res.status(400).json({ error: 'Missing params' });

    const now = new Date().getFullYear();
    const items = await pickTotalsByAsset(site, String(asset));

    // On conserve le même format d’objets retournés pour le front
    const result = items
      .filter(it => (it.building_code || '') === String(building))
      .map(it => {
        const service_year = it.service_year;
        const avg_life_years = it.avg_life_years;
        const forecast_year = (service_year || now - 10) + (avg_life_years || (it.kind === 'hv' ? 30 : 25));
        return {
          id: it.kind === 'hv' ? it.hv_equipment_id : it.switchboard_id,
          name: it.name,
          floor: it.floor || '',
          device_count: it.device_count || 0,
          total_cost: it.estimated_cost_gbp,
          service_year,
          avg_life_years,
          forecast_year
        };
      });

    res.json({ data: result });
  } catch (e) {
    console.error('[OBS SWITCHBOARDS]', e.message);
    res.status(500).json({ error: 'Switchboards load failed' });
  }
});

// ---------- DEVICES (SB uniquement — Quick edit reste SB) ----------
app.get('/api/obsolescence/devices', async (req, res) => {
  try {
    const site = siteOf(req);
    const { switchboard } = req.query;
    if (!site || !switchboard) return res.status(400).json({ error: 'Missing params' });
    const r = await pool.query(`
      SELECT d.*, op.*, oc.*
      FROM devices d
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.switchboard_id = d.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND oc.switchboard_id = d.switchboard_id AND oc.site = $1
      WHERE d.switchboard_id = $2 AND d.site = $1
    `, [site, Number(switchboard)]);
    res.json({ data: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'Devices load failed' });
  }
});

// ---------- QUICK SET (SB) ----------
app.post('/api/obsolescence/quick-set', async (req, res) => {
  try {
    const site = siteOf(req);
    const { switchboard_id, service_year, avg_life_years, override_cost_per_device } = req.body || {};
    if (!site || !switchboard_id) return res.status(400).json({ error: 'Missing params' });

    await pool.query(`
      INSERT INTO obsolescence_parameters (device_id, switchboard_id, site)
      SELECT d.id, d.switchboard_id, $1
      FROM devices d
      LEFT JOIN obsolescence_parameters op
        ON op.device_id = d.id AND op.switchboard_id = d.switchboard_id AND op.site = $1
      WHERE d.switchboard_id = $2 AND d.site = $1 AND op.device_id IS NULL
    `, [site, Number(switchboard_id)]);

    const date = service_year ? `${service_year}-01-01` : null;
    if (date) {
      await pool.query(
        `UPDATE obsolescence_parameters SET manufacture_date=$1 WHERE switchboard_id=$2 AND site=$3`,
        [date, Number(switchboard_id), site]
      );
    }
    if (Number(avg_life_years) > 0) {
      await pool.query(
        `UPDATE obsolescence_parameters SET avg_life_years=$1 WHERE switchboard_id=$2 AND site=$3`,
        [Number(avg_life_years), Number(switchboard_id), site]
      );
    }
    if (override_cost_per_device !== undefined) {
      await pool.query(
        `UPDATE obsolescence_parameters SET replacement_cost=$1 WHERE switchboard_id=$2 AND site=$3`,
        [Number(override_cost_per_device) || 0, Number(switchboard_id), site]
      );
    }
    res.json({ message: 'Switchboard parameters updated' });
  } catch (e) {
    console.error('[OBS QUICK-SET]', e.message);
    res.status(500).json({ error: 'Quick set failed' });
  }
});

// ---------- AI-FILL (SB) ----------
app.post('/api/obsolescence/ai-fill', async (req, res) => {
  try {
    const site = siteOf(req);
    await pool.query(`
      INSERT INTO obsolescence_parameters (device_id, switchboard_id, site)
      SELECT d.id, d.switchboard_id, $1
      FROM devices d
      LEFT JOIN obsolescence_parameters op
        ON op.device_id = d.id AND op.switchboard_id = d.switchboard_id AND op.site = $1
      WHERE d.site = $1 AND op.device_id IS NULL
    `, [site]);

    await pool.query(`
      UPDATE obsolescence_parameters
      SET avg_temperature = 25,
          avg_life_years = CASE WHEN avg_life_years = 25 THEN 30 ELSE avg_life_years END,
          manufacture_date = CASE WHEN manufacture_date = '2000-01-01' THEN (CURRENT_DATE - INTERVAL '10 years')::date ELSE manufacture_date END
      WHERE site = $1
    `, [site]);

    res.json({ message: 'AI fill done' });
  } catch (e) {
    console.error('[OBS AI-FILL]', e.message);
    res.status(500).json({ error: 'AI fill failed' });
  }
});

// ---------- DOUGHNUT GLOBAL (SB uniquement — indicateurs existants) ----------
app.get('/api/obsolescence/doughnut', async (req, res) => {
  try {
    const site = siteOf(req);
    const { group = 'building' } = req.query;
    let groupExpr = 's.building_code';
    if (group === 'floor') groupExpr = 's.floor';
    if (group === 'switchboard') groupExpr = 's.name';
    const rows = await pool.query(`
      SELECT ${groupExpr} AS label,
        COUNT(CASE WHEN oc.status = 'ok' THEN 1 END) AS ok,
        COUNT(CASE WHEN oc.status = 'warning' THEN 1 END) AS warning,
        COUNT(CASE WHEN oc.status = 'critical' THEN 1 END) AS critical,
        COALESCE(SUM(op.replacement_cost),0) AS total_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE s.site = $1
      GROUP BY ${groupExpr}
    `, [site]);
    res.json({ data: rows.rows });
  } catch (e) {
    res.status(500).json({ error: 'Doughnut data failed' });
  }
});

// ---------- BUCKETS PAR BÂTIMENT (asset filter) ----------
app.get('/api/obsolescence/building-urgency-buckets', async (req, res) => {
  try {
    const site = siteOf(req);
    const { asset = 'all' } = req.query;
    const totals = await pickTotalsByAsset(site, String(asset));
    const now = new Date().getFullYear();

    const byB = new Map(); // building -> { urgent, medium, low, total }
    for (const it of totals) {
      const service = it.service_year ?? (now - 10);
      const life = it.avg_life_years ?? (it.kind === 'hv' ? 30 : 25);
      const remaining = service + life - now;
      const b = it.building_code || 'Unknown';
      if (!byB.has(b)) byB.set(b, { urgent:0, medium:0, low:0, total:0 });

      if (remaining < 5) byB.get(b).urgent += 1;
      else if (remaining <= 10) byB.get(b).medium += 1;
      else byB.get(b).low += 1;
      byB.get(b).total += 1;
    }
    res.json({ buckets: Object.fromEntries(byB) });
  } catch (e) {
    console.error('[OBS BUCKETS]', e.message);
    res.status(500).json({ error: 'Buckets failed' });
  }
});

// ---------- CAPEX-FORECAST (asset filter) ----------
app.get('/api/obsolescence/capex-forecast', async (req, res) => {
  try {
    const site = siteOf(req);
    const { asset = 'all' } = req.query;
    const totals = await pickTotalsByAsset(site, String(asset));
    const now = new Date().getFullYear();

    const forecasts = {};
    for (const it of totals) {
      const label = it.building_code || 'Unknown';
      if (!forecasts[label]) forecasts[label] = [];
      const year = (it.service_year || now - 10) + (it.avg_life_years || (it.kind === 'hv' ? 30 : 25));
      forecasts[label].push({ year, capex_year: it.estimated_cost_gbp });
    }
    res.json({ forecasts });
  } catch (e) {
    res.status(500).json({ error: 'CAPEX forecast failed' });
  }
});

// ---------- AI-QUERY ----------
app.post('/api/obsolescence/ai-query', async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: 'OpenAI not configured' });
    const { query, site } = req.body || {};

    const db = await pool.query(`
      SELECT s.name AS switchboard, s.building_code, d.name AS device, d.device_type, d.in_amps,
             op.manufacture_date, op.avg_life_years, op.replacement_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.switchboard_id = s.id AND op.site = $1
      WHERE s.site = $1
    `, [site]);
    const context = db.rows.length ? JSON.stringify(db.rows.slice(0, 300)) : 'No data';

    let inlinePrice = '';
    const m = String(query||'').match(/(mccb|acb|vcb|breaker|disjoncteur|mcb)\s*([0-9]{1,4})\s*a/i);
    if (m) {
      const typ = m[1];
      const amps = Number(m[2]);
      const web = await estimateFromWeb(typ, amps);
      const base = estimateDeviceCostGBP(typ, amps);
      const final = web || base;
      inlinePrice = `\n\n**Quick estimate** for ${typ.toUpperCase()} ${amps}A installed (UK): **£${final.toLocaleString('en-GB')}** ${web ? '(web-assist)' : '(heuristic)'}.\n`;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content:
`You are an experienced IEC/IEEE asset-management engineer.
Answer in concise bullet points, with actionable recommendations.
When relevant, propose sensors (cabinet temperature probes, cable overheat tags like HeatTag, electrical monitoring/IoT, trend analysis, thermal imaging routines).
Always add a short "Estimates & Scope" note: prices are indicative, include materials+labour, exclude enclosures/cabling/accessories; confirm locally.` },
        { role: 'user', content: `SITE DB (trimmed): ${context}` },
        { role: 'user', content: String(query || '') + inlinePrice }
      ],
      max_tokens: 450,
      temperature: 0.3
    });
    const response = completion.choices?.[0]?.message?.content?.trim() || 'No response';
    res.json({ response, updates: false, web_cost: isWebCostEnabled });
  } catch (e) {
    console.error('[AI QUERY] error:', e.message);
    res.status(500).json({ error: 'AI query failed' });
  }
});

// ---------- AUTO-CHECK (SB) ----------
async function fetchDevicesForAutoCheck(site) {
  const sqlFull = `
    SELECT d.*,
           s.id AS sb_id,
           op.manufacture_date, op.avg_temperature, op.avg_humidity, op.operation_cycles, op.avg_life_years,
           sc.status AS selectivity_status, fc.status AS fault_status, ac.status AS arc_status
    FROM devices d
    JOIN switchboards s ON d.switchboard_id = s.id
    LEFT JOIN obsolescence_parameters op ON op.device_id = d.id AND op.switchboard_id = s.id AND op.site = $1
    LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id
    LEFT JOIN fault_checks fc      ON d.id = fc.device_id
    LEFT JOIN arcflash_checks ac   ON d.id = ac.device_id
    WHERE d.site = $1
  `;
  const sqlSimple = `
    SELECT d.*,
           s.id AS sb_id,
           op.manufacture_date, op.avg_temperature, op.avg_humidity, op.operation_cycles, op.avg_life_years
    FROM devices d
    JOIN switchboards s ON d.switchboard_id = s.id
    LEFT JOIN obsolescence_parameters op ON op.device_id = d.id AND op.switchboard_id = s.id AND op.site = $1
    WHERE d.site = $1
  `;
  try {
    const r = await pool.query(sqlFull, [site]);
    return r.rows;
  } catch (e) {
    if (e.code === '42P01') {
      const r2 = await pool.query(sqlSimple, [site]);
      return r2.rows;
    }
    throw e;
  }
}

app.post('/api/obsolescence/auto-check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const rows = await fetchDevicesForAutoCheck(site);
    for (const row of rows) {
      const obs = calculateObsolescence(row);
      await pool.query(`
        INSERT INTO obsolescence_checks (device_id, switchboard_id, site, remaining_life_years, urgency_score, status)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (device_id, switchboard_id, site) DO UPDATE
        SET remaining_life_years=$4, urgency_score=$5, status=$6, checked_at=NOW()
      `, [row.id, row.sb_id || row.switchboard_id, site, obs.remaining_life_years, obs.urgency_score, obs.status]);
    }
    res.json({ message: 'Auto check done' });
  } catch (e) {
    console.error('[OBS AUTO-CHECK]', e.message);
    res.status(500).json({ error: 'Auto check failed' });
  }
});

// ---------- GANTT-DATA (asset filter) ----------
app.get('/api/obsolescence/gantt-data', async (req, res) => {
  try {
    const { siteName, role } = getSiteFilter(req);
    const site = (role === 'global' || role === 'admin' || role === 'superadmin') ? (siteName || null) : (siteName || siteOf(req));
    const rawB = req.query.building;
    const rawS = req.query.switchboard;
    const { asset = 'all' } = req.query;

    const building = (rawB && !['', 'null', 'undefined'].includes(String(rawB).toLowerCase())) ? String(rawB) : null;
    const switchboard = (rawS && !['', 'null', 'undefined'].includes(String(rawS).toLowerCase())) ? Number(rawS) : null;

    const totals = await pickTotalsByAsset(site, String(asset));
    let filtered = totals.filter(it =>
      (!building || it.building_code === building) &&
      (!switchboard || it.switchboard_id === switchboard)
    );
    if (!filtered.length) filtered = totals;

    const now = new Date().getFullYear();
    const tasks = filtered.map(it => {
      const mfgYear = it.service_year || (now - 10);
      let life = it.avg_life_years;
      if (!life) {
        if (it.kind === 'hv') life = 30;
        else if (it.kind === 'vsd') life = 15;
        else if (it.kind === 'meca') life = 20;
        else life = 25;
      }
      const endYear = mfgYear + life;
      const remaining = endYear - now;

      // Get unique ID based on kind
      let itemId;
      if (it.kind === 'hv') itemId = `hv-${it.hv_equipment_id}`;
      else if (it.kind === 'vsd') itemId = `vsd-${it.vsd_id}`;
      else if (it.kind === 'meca') itemId = `meca-${it.meca_id}`;
      else itemId = `sb-${it.switchboard_id}`;

      // Calculate progress (how far through lifecycle)
      const age = now - mfgYear;
      const progress = Math.min(100, Math.max(0, (age / life) * 100));

      return {
        start: new Date(mfgYear, 0, 1),
        end: new Date(endYear, 0, 1),
        name: it.code || it.name || `${it.kind.toUpperCase()}-${it.switchboard_id || it.hv_equipment_id || it.vsd_id || it.meca_id}`,
        display_name: it.name,
        code: it.code,
        id: itemId,
        progress: Math.round(progress),
        type: 'task',
        cost: it.estimated_cost_gbp,
        building: it.building_code || 'Unknown',
        kind: it.kind,
        remaining_years: remaining,
        urgency: remaining < 5 ? 'critical' : remaining <= 10 ? 'warning' : 'ok',
        // For interoperability links
        link_id: it.switchboard_id || it.hv_equipment_id || it.vsd_id || it.meca_id
      };
    });

    // Sort by urgency (soonest first)
    tasks.sort((a, b) => a.end - b.end);

    res.json({ tasks });
  } catch (e) {
    console.error('[OBS GANTT]', e.message);
    res.status(500).json({ error: 'Gantt data failed' });
  }
});

// ---------- UPDATE SERVICE YEAR (all asset types) ----------
app.put('/api/obsolescence/service-year', async (req, res) => {
  try {
    const { siteName, role } = getSiteFilter(req);
    const site = (role === 'global' || role === 'admin' || role === 'superadmin') ? (siteName || null) : (siteName || siteOf(req));
    const { kind, id, service_year } = req.body || {};

    if (!kind || !id || service_year === undefined) {
      return res.status(400).json({ error: 'Missing required fields: kind, id, service_year' });
    }

    const year = parseInt(service_year, 10);
    if (!Number.isFinite(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ error: 'Invalid service_year (must be between 1900 and 2100)' });
    }

    const equipmentId = parseInt(id, 10);
    if (!Number.isFinite(equipmentId)) {
      return res.status(400).json({ error: 'Invalid equipment id' });
    }

    let result;

    switch (kind) {
      case 'sb': {
        // For switchboards, update manufacture_date in obsolescence_parameters
        const date = `${year}-01-01`;
        // Try to update existing rows first
        result = await pool.query(`
          UPDATE obsolescence_parameters
          SET manufacture_date = $1
          WHERE switchboard_id = $2 ${site ? 'AND site = $3' : ''}
        `, site ? [date, equipmentId, site] : [date, equipmentId]);

        // If no rows updated, insert parameters for all devices
        if (result.rowCount === 0) {
          await pool.query(`
            INSERT INTO obsolescence_parameters (device_id, switchboard_id, site, manufacture_date)
            SELECT d.id, d.switchboard_id, d.site, $1::date
            FROM devices d
            WHERE d.switchboard_id = $2 ${site ? 'AND d.site = $3' : ''}
            ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET manufacture_date = EXCLUDED.manufacture_date
          `, site ? [date, equipmentId, site] : [date, equipmentId]);
        }
        break;
      }

      case 'hv': {
        // For HV equipment, try to update service_year
        try {
          result = await pool.query(`
            UPDATE hv_equipments
            SET service_year = $1
            WHERE id = $2 ${site ? 'AND site = $3' : ''}
          `, site ? [year, equipmentId, site] : [year, equipmentId]);
        } catch (e) {
          // Column doesn't exist - for now, store in a JSON field or return message
          console.log('[OBS] HV service_year column not available:', e.message);
          return res.status(400).json({
            error: 'La colonne service_year n\'existe pas pour les équipements HV. Contactez l\'administrateur.'
          });
        }
        break;
      }

      case 'vsd': {
        // For VSD equipment, try to update service_year
        try {
          result = await pool.query(`
            UPDATE vsd_equipments
            SET service_year = $1
            WHERE id = $2 ${site ? 'AND site = $3' : ''}
          `, site ? [year, equipmentId, site] : [year, equipmentId]);
        } catch (e) {
          console.log('[OBS] VSD service_year column not available:', e.message);
          return res.status(400).json({
            error: 'La colonne service_year n\'existe pas pour les équipements VSD. Contactez l\'administrateur.'
          });
        }
        break;
      }

      case 'meca': {
        // For MECA equipment, update installation_date
        const date = `${year}-01-01`;
        try {
          result = await pool.query(`
            UPDATE meca_equipments
            SET installation_date = $1
            WHERE id = $2 ${site ? 'AND site = $3' : ''}
          `, site ? [date, equipmentId, site] : [date, equipmentId]);
        } catch (e) {
          console.log('[OBS] MECA installation_date update failed:', e.message);
          return res.status(400).json({
            error: 'Impossible de mettre à jour la date d\'installation. Contactez l\'administrateur.'
          });
        }
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown equipment kind: ${kind}` });
    }

    console.log(`[OBS SERVICE-YEAR] Updated ${kind}-${equipmentId} to ${year}`);
    res.json({
      success: true,
      message: `Service year updated to ${year}`,
      kind,
      id: equipmentId,
      service_year: year
    });
  } catch (e) {
    console.error('[OBS SERVICE-YEAR]', e.message);
    res.status(500).json({ error: `Update failed: ${e.message}` });
  }
});

// ---------- KPI ----------
app.get('/api/obsolescence/avg-urgency', async (req, res) => {
  try {
    const site = siteOf(req);
    const r = await pool.query('SELECT AVG(urgency_score) AS avg FROM obsolescence_checks WHERE site=$1', [site]);
    res.json({ avg: r.rows[0]?.avg || 45 });
  } catch {
    res.status(500).json({ error: 'Avg urgency failed' });
  }
});

app.get('/api/obsolescence/total-capex', async (req, res) => {
  try {
    const site = siteOf(req);
    const totals = await pickTotalsByAsset(site, 'all');
    const total = totals.reduce((a, b) => a + b.estimated_cost_gbp, 0);
    res.json({ total: GBP(total) });
  } catch {
    res.status(500).json({ error: 'Total CAPEX failed' });
  }
});

const port = Number(process.env.OBSOLESCENCE_PORT || 3007);
app.listen(port, () => console.log(`[OBSOLESCENCE] service running on :${port}`));
