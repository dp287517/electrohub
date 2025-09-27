// server_obsolescence.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import multer from 'multer';
import axios from 'axios';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

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

function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}

// ---------- SCHEMA ----------
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

// ---------- UTIL: coûts ----------
function estimateDeviceCostGBP(type = '', inAmps = 0) {
  const t = String(type || '').toUpperCase();
  const A = Number(inAmps || 0);

  // Barèmes (prix matériel) – bornes prudentes
  let base = 600; // fallback
  if (t.includes('MCCB')) {
    if (A <= 125) base = 450;
    else if (A <= 250) base = 900;
    else if (A <= 400) base = 1800;
    else if (A <= 630) base = 3200;
    else if (A <= 800) base = 5200;
    else base = 8500;
  } else if (t.includes('ACB')) {
    base = A <= 3200 ? 9000 : 14000;
  } else if (t.includes('VCB') || t.includes('VACUUM')) {
    base = 15000;
  } else if (t.includes('RELAY') || t.includes('PROTECTION')) {
    base = 2500;
  } else if (t.includes('FUSE')) {
    base = 150;
  }

  // Intégration pose/essais/gestion : +30 %
  const installed = base * 1.3;
  return GBP(installed);
}

// Optionnel: tentative de raffinement web (DuckDuckGo Instant Answer + LLM)
async function estimateFromWeb(type = '', inAmps = 0) {
  try {
    if (!process.env.ENABLE_WEB_COST || !openai) return null;
    const q = encodeURIComponent(`${type} ${inAmps}A price UK installed`);
    const r = await axios.get(`https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1&no_html=1`);
    const abstract = r?.data?.AbstractText || '';
    if (!abstract) return null;
    const comp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Return a single GBP integer for an installed cost (materials+labour), conservative.' },
        { role: 'user', content: `From this snippet, infer a realistic installed price for ${type} ${inAmps}A in the UK: "${abstract}". Only the number.` }
      ],
      max_tokens: 10,
      temperature: 0.2
    });
    const n = parseInt((comp.choices?.[0]?.message?.content || '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function deviceEstimatedOrParamCostGBP(row) {
  // Si paramètre saisi, on l’utilise, sinon estimation (web → heuristique)
  if (row.replacement_cost && Number(row.replacement_cost) > 0) return GBP(row.replacement_cost);
  const web = await estimateFromWeb(row.device_type, row.in_amps);
  if (web) return GBP(web);
  return estimateDeviceCostGBP(row.device_type, row.in_amps);
}

async function computeSwitchboardTotals(site) {
  // Ramène chaque device + param et regroupe au niveau switchboard
  const r = await pool.query(`
    SELECT s.id AS switchboard_id, s.name, s.building_code,
           d.id AS device_id, d.device_type, d.in_amps,
           op.replacement_cost,
           op.manufacture_date, op.avg_life_years
    FROM switchboards s
    LEFT JOIN devices d ON d.switchboard_id = s.id
    LEFT JOIN obsolescence_parameters op
      ON op.device_id = d.id AND op.switchboard_id = s.id AND op.site = $1
    WHERE s.site = $1
  `, [site]);

  const bySB = new Map();
  for (const row of r.rows) {
    if (!bySB.has(row.switchboard_id)) bySB.set(row.switchboard_id, {
      switchboard_id: row.switchboard_id,
      name: row.name,
      building_code: row.building_code,
      devices: [],
    });
    bySB.get(row.switchboard_id).devices.push(row);
  }

  const enriched = [];
  for (const sb of bySB.values()) {
    // coût de board : base + par voie (approximation via nb devices)
    const n = sb.devices.filter(d => d.device_id).length;
    const boardBase = 1500 + 400 * Math.max(0, n - 4); // châssis, barres, coffret
    let sumDevices = 0;

    for (const d of sb.devices) {
      if (!d.device_id) continue;
      const c = await deviceEstimatedOrParamCostGBP(d);
      sumDevices += c;
    }

    // marge projet 15% (gestion, logistique)
    const total = GBP((boardBase + sumDevices) * 1.15);
    // service year (médiane) & life (moyenne) si disponibles
    const years = sb.devices.map(d => d.manufacture_date).filter(Boolean).map(x => new Date(x).getFullYear()).filter(y => Number.isFinite(y));
    const service_year = years.length ? years.sort((a,b)=>a-b)[Math.floor(years.length/2)] : null;
    const lifeVals = sb.devices.map(d => Number(d.avg_life_years)).filter(v => Number.isFinite(v) && v>0);
    const avg_life_years = lifeVals.length ? Math.round(lifeVals.reduce((a,b)=>a+b,0)/lifeVals.length) : 25;

    enriched.push({
      switchboard_id: sb.switchboard_id,
      name: sb.name,
      building_code: sb.building_code,
      device_count: n,
      service_year,
      avg_life_years,
      estimated_cost_gbp: total,
    });
  }
  return enriched;
}

// ---------- HEALTH ----------
app.get('/api/obsolescence/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

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
    res.status(500).json({ error: e.message });
  }
});

// ---------- BUILDINGS (corrigé: nb de switchboards + coût enrichi) ----------
app.get('/api/obsolescence/buildings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const sbTotals = await computeSwitchboardTotals(site);
    const grouped = new Map();
    for (const sb of sbTotals) {
      const key = sb.building_code || 'Unknown';
      if (!grouped.has(key)) grouped.set(key, { building: key, count: 0, total_cost: 0 });
      const g = grouped.get(key);
      g.count += 1;
      g.total_cost += sb.estimated_cost_gbp;
    }
    res.json({ data: Array.from(grouped.values()) });
  } catch (e) {
    console.error('[OBS BUILDINGS]', e.message);
    res.status(500).json({ error: 'Buildings load failed' });
  }
});

// ---------- SWITCHBOARDS (coût et forecast calculés correctement) ----------
app.get('/api/obsolescence/switchboards', async (req, res) => {
  try {
    const site = siteOf(req);
    const { building } = req.query;
    if (!site || !building) return res.status(400).json({ error: 'Missing params' });

    const sbTotals = await computeSwitchboardTotals(site);
    const now = new Date().getFullYear();
    const result = sbTotals
      .filter(sb => (sb.building_code || '') === String(building))
      .map(sb => {
        const forecast_year = (sb.service_year || now - 10) + (sb.avg_life_years || 25);
        return {
          id: sb.switchboard_id,
          name: sb.name,
          floor: '', // si tu as la colonne floor, tu peux l’ajouter au SELECT
          device_count: sb.device_count,
          total_cost: sb.estimated_cost_gbp,
          service_year: sb.service_year,
          forecast_year
        };
      });
    res.json({ data: result });
  } catch (e) {
    console.error('[OBS SWITCHBOARDS]', e.message);
    res.status(500).json({ error: 'Switchboards load failed' });
  }
});

// ---------- DEVICES (inchangé, utile pour l’édition fine si besoin) ----------
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

// ---------- QUICK SET (tu peux forcer l’année de service au niveau Switchboard) ----------
app.post('/api/obsolescence/quick-set', async (req, res) => {
  try {
    const site = siteOf(req);
    const { switchboard_id, service_year, avg_life_years, override_cost_per_device } = req.body || {};
    if (!site || !switchboard_id) return res.status(400).json({ error: 'Missing params' });

    // Crée les lignes manquantes
    await pool.query(`
      INSERT INTO obsolescence_parameters (device_id, switchboard_id, site)
      SELECT d.id, d.switchboard_id, $1
      FROM devices d
      LEFT JOIN obsolescence_parameters op
        ON op.device_id = d.id AND op.switchboard_id = d.switchboard_id AND op.site = $1
      WHERE d.switchboard_id = $2 AND d.site = $1 AND op.device_id IS NULL
    `, [site, Number(switchboard_id)]);

    // Met à jour manufacture_date (= 1er janvier de l’année), avg_life_years, et coût si demandé
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
    if (Number(override_cost_per_device) >= 0) {
      await pool.query(
        `UPDATE obsolescence_parameters SET replacement_cost=$1 WHERE switchboard_id=$2 AND site=$3`,
        [Number(override_cost_per_device), Number(switchboard_id), site]
      );
    }
    res.json({ message: 'Switchboard parameters updated' });
  } catch (e) {
    console.error('[OBS QUICK-SET]', e.message);
    res.status(500).json({ error: 'Quick set failed' });
  }
});

// ---------- AI-FILL (crée les lignes + valeurs par défaut raisonnables) ----------
app.post('/api/obsolescence/ai-fill', async (req, res) => {
  try {
    const site = siteOf(req);

    // 1) insère les lignes manquantes
    await pool.query(`
      INSERT INTO obsolescence_parameters (device_id, switchboard_id, site)
      SELECT d.id, d.switchboard_id, $1
      FROM devices d
      LEFT JOIN obsolescence_parameters op
        ON op.device_id = d.id AND op.switchboard_id = d.switchboard_id AND op.site = $1
      WHERE d.site = $1 AND op.device_id IS NULL
    `, [site]);

    // 2) complète des valeurs par défaut si toujours “neutres”
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

// ---------- DOUGHNUT ----------
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

// ---------- CAPEX-FORECAST (même base de coût enrichie) ----------
app.get('/api/obsolescence/capex-forecast', async (req, res) => {
  try {
    const site = siteOf(req);
    const sbTotals = await computeSwitchboardTotals(site);
    const now = new Date().getFullYear();

    const forecasts = {};
    for (const sb of sbTotals) {
      const label = sb.building_code || 'Unknown';
      if (!forecasts[label]) forecasts[label] = [];
      const year = (sb.service_year || now - 10) + (sb.avg_life_years || 25);
      forecasts[label].push({ year, capex_year: sb.estimated_cost_gbp });
    }
    res.json({ forecasts });
  } catch (e) {
    res.status(500).json({ error: 'CAPEX forecast failed' });
  }
});

// ---------- AI-QUERY (conservé) ----------
app.post('/api/obsolescence/ai-query', async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: 'OpenAI not configured' });
    const { query, site } = req.body || {};
    const db = await pool.query(`
      SELECT s.name, op.*
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.switchboard_id = s.id AND op.site = $1
      WHERE s.site = $1
    `, [site]);
    const context = db.rows.length ? JSON.stringify(db.rows) : 'No data';
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are an expert in substation obsolescence. DB context: ${context}.` },
        { role: 'user', content: String(query || '') }
      ],
      max_tokens: 200,
      temperature: 0.5
    });
    const response = completion.choices?.[0]?.message?.content?.trim() || 'No response';
    res.json({ response, updates: false });
  } catch (e) {
    res.status(500).json({ error: 'AI query failed' });
  }
});

// ---------- GANTT-DATA (robuste aux manques) ----------
app.get('/api/obsolescence/gantt-data', async (req, res) => {
  try {
    const site = siteOf(req);
    const { building, switchboard } = req.query;
    const sbTotals = await computeSwitchboardTotals(site);
    const filtered = sbTotals.filter(sb =>
      (!building || sb.building_code === String(building)) &&
      (!switchboard || sb.switchboard_id === Number(switchboard))
    );
    const tasks = filtered.map(sb => {
      const mfgYear = sb.service_year || (new Date().getFullYear() - 10);
      const life = sb.avg_life_years || 25;
      return {
        start: new Date(mfgYear, 0, 1),
        end: new Date(mfgYear + life, 0, 1),
        name: sb.name,
        id: String(sb.switchboard_id),
        progress: 0,
        type: 'task',
        cost: sb.estimated_cost_gbp
      };
    });
    res.json({ tasks });
  } catch (e) {
    console.error('[OBS GANTT]', e.message);
    res.status(500).json({ error: 'Gantt data failed' });
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
    const sbTotals = await computeSwitchboardTotals(site);
    const total = sbTotals.reduce((a, b) => a + b.estimated_cost_gbp, 0);
    res.json({ total: GBP(total) });
  } catch {
    res.status(500).json({ error: 'Total CAPEX failed' });
  }
});

const port = Number(process.env.OBSOLESCENCE_PORT || 3007);
app.listen(port, () => console.log(`[OBSOLESCENCE] service running on :${port}`));
