// server_obsolescence.js (final patched)
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import multer from 'multer';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// ---- OpenAI setup (guarded) ----
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[OBSOLESCENCE] OpenAI initialized');
  } else {
    console.warn('[OBSOLESCENCE] No OPENAI_API_KEY found');
  }
} catch (e) {
  console.warn('[OBSOLESCENCE] OpenAI init failed:', e.message);
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Upload setup for PDF
const upload = multer({ storage: multer.memoryStorage() });

// ---- CORS ----
app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Helpers ----
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}

async function safeAlter() {
  // Make existing DBs forward-compatible (user error: missing "document_link" column)
  await pool.query(`ALTER TABLE obsolescence_parameters ADD COLUMN IF NOT EXISTS document_link TEXT`);
}

// ---- Schema ----
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
  await safeAlter();
  console.log('[OBS SCHEMA] ok');
}
ensureSchema().catch(e => console.error('[OBS SCHEMA] error:', e.message));

// ---- Health ----
app.get('/api/obsolescence/health', (_req, res) => res.json({ ok: true, ts: Date.now(), openai: !!openai }));

// ---- Test data ----
app.post('/api/obsolescence/test-data', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const sb = await pool.query('SELECT id FROM switchboards WHERE site=$1 LIMIT 1', [site]);
    if (sb.rows.length === 0) {
      const sbi = await pool.query(
        'INSERT INTO switchboards (site, name, code, building_code, floor) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [site, 'Test SB', 'TSB', 'Building A', '1']
      );
      await pool.query(
        'INSERT INTO devices (site, switchboard_id, name, device_type, in_amps, replacement_cost) VALUES ($1,$2,$3,$4,$5,$6)',
        [site, sbi.rows[0].id, 'Test Device', 'MCCB', 100, 1000]
      );
    }
    res.json({ message: 'Test data ready' });
  } catch (e) {
    console.error('[OBS TEST] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- RESET ----
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

// ---- LIST Buildings ----
app.get('/api/obsolescence/buildings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const r = await pool.query(`
      SELECT s.building_code AS building,
             COUNT(d.id) AS count,
             COALESCE(SUM(op.replacement_cost),0) AS total_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.switchboard_id = s.id AND op.site = $1
      WHERE s.site = $1
      GROUP BY s.building_code
      ORDER BY s.building_code
    `, [site]);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[OBS BUILDINGS] error:', e.message);
    res.status(500).json({ error: 'Buildings load failed' });
  }
});

// ---- LIST Switchboards (aggregate; used for Overview, no devices) ----
app.get('/api/obsolescence/switchboards', async (req, res) => {
  try {
    const site = siteOf(req);
    const { building } = req.query;
    if (!site || !building) return res.status(400).json({ error: 'Missing params' });
    const r = await pool.query(`
      SELECT s.id,
             s.name,
             s.floor,
             COUNT(d.id) AS device_count,
             COALESCE(SUM(op.replacement_cost),0) AS total_cost,
             AVG(EXTRACT(YEAR FROM op.manufacture_date))::int AS service_year,
             AVG(op.avg_life_years)::int AS avg_life_years,
             AVG(oc.urgency_score)::int AS avg_urgency
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.switchboard_id = s.id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND oc.switchboard_id = s.id AND oc.site = $1
      WHERE s.site = $1 AND s.building_code = $2
      GROUP BY s.id, s.name, s.floor
      ORDER BY s.name
    `, [site, building]);

    // post-processing: forecast year + estimated cost if missing
    const currentYear = new Date().getFullYear();
    const enriched = [];
    for (const row of r.rows) {
      const baseYear = (row.service_year || 2000) + (row.avg_life_years || 25);
      const pullAhead = Math.min(3, Math.floor((row.avg_urgency || 0) / 30)); // pull earlier if urgent
      const forecast_year = baseYear - pullAhead;
      let estimated_cost_gbp = Number(row.total_cost || 0);
      if (!estimated_cost_gbp || estimated_cost_gbp === 0) {
        // simple heuristic: 5000£ per device if costs are unknown
        estimated_cost_gbp = Number(row.device_count || 0) * 5000;
      }
      enriched.push({ ...row, forecast_year, estimated_cost_gbp });
    }
    res.json({ data: enriched });
  } catch (e) {
    console.error('[OBS SWITCHBOARDS] error:', e.message);
    res.status(500).json({ error: 'Switchboards load failed' });
  }
});

// ---- UPDATE Parameters ----
app.post('/api/obsolescence/parameters', async (req, res) => {
  try {
    const site = siteOf(req);
    const p = req.body || {};
    if (!p.device_id || !p.switchboard_id) return res.status(400).json({ error: 'Missing device_id or switchboard_id' });
    await pool.query(`
      INSERT INTO obsolescence_parameters
        (device_id, switchboard_id, site, manufacture_date, avg_temperature, avg_humidity, operation_cycles, avg_life_years, replacement_cost, document_link)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE
      SET manufacture_date=$4, avg_temperature=$5, avg_humidity=$6, operation_cycles=$7, avg_life_years=$8, replacement_cost=$9, document_link=$10
    `, [
      Number(p.device_id), Number(p.switchboard_id), site,
      p.manufacture_date || '2000-01-01',
      Number(p.avg_temperature) || 25,
      Number(p.avg_humidity) || 50,
      Number(p.operation_cycles) || 5000,
      Number(p.avg_life_years) || 25,
      Number(p.replacement_cost) || 1000,
      p.document_link || null
    ]);
    res.json({ message: 'Parameters updated' });
  } catch (e) {
    console.error('[OBS PARAMS] error:', e.message);
    res.status(500).json({ error: 'Params update failed', details: e.message });
  }
});

// ---- CHECK ----
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
    if (Number(point.replacement_cost) === 1000) {
      point.replacement_cost = await estimateCost(point.device_type);
    }
    const obs = calculateObsolescence(point);
    await pool.query(`
      INSERT INTO obsolescence_checks (device_id, switchboard_id, site, remaining_life_years, urgency_score, status)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE
      SET remaining_life_years=$4, urgency_score=$5, status=$6, checked_at=NOW()
    `, [Number(device), Number(switchboard), site, obs.remaining_life_years, obs.urgency_score, obs.status]);
    res.json(obs);
  } catch (e) {
    console.error('[OBS CHECK] error:', e.message);
    res.status(500).json({ error: 'Check failed' });
  }
});

// ---- AUTO-CHECK ----
app.post('/api/obsolescence/auto-check', async (req, res) => {
  try {
    const site = siteOf(req);
    const points = await pool.query(`
      SELECT d.id AS device_id, s.id AS switchboard_id
      FROM devices d JOIN switchboards s ON d.switchboard_id = s.id WHERE d.site = $1
    `, [site]);
    for (const p of points.rows) {
      const point = await pool.query(`
        SELECT d.*, op.*, sc.status AS selectivity_status, fc.status AS fault_status, ac.status AS arc_status
        FROM devices d
        JOIN switchboards s ON d.switchboard_id = s.id
        LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
        LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id
        LEFT JOIN fault_checks fc ON d.id = fc.device_id
        LEFT JOIN arcflash_checks ac ON d.id = ac.device_id
        WHERE d.id = $2 AND d.switchboard_id = $3 AND d.site = $1
      `, [site, p.device_id, p.switchboard_id]);
      if (point.rows.length === 0) continue;
      let pt = point.rows[0];
      if (Number(pt.replacement_cost) === 1000) {
        pt.replacement_cost = await estimateCost(pt.device_type);
      }
      const obs = calculateObsolescence(pt);
      await pool.query(`
        INSERT INTO obsolescence_checks (device_id, switchboard_id, site, remaining_life_years, urgency_score, status)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (device_id, switchboard_id, site) DO UPDATE
        SET remaining_life_years=$4, urgency_score=$5, status=$6, checked_at=NOW()
      `, [p.device_id, p.switchboard_id, site, obs.remaining_life_years, obs.urgency_score, obs.status]);
    }
    res.json({ message: 'Auto check done' });
  } catch (e) {
    console.error('[OBS AUTO-CHECK] error:', e.message);
    res.status(500).json({ error: 'Auto check failed' });
  }
});

// ---- AI-FILL (simple heuristics) ----
app.post('/api/obsolescence/ai-fill', async (req, res) => {
  try {
    const site = siteOf(req);
    const defaults = await pool.query(`
      SELECT d.device_type, op.*
      FROM obsolescence_parameters op
      JOIN devices d ON d.id = op.device_id
      WHERE op.site = $1 AND (op.avg_temperature = 25 OR op.avg_life_years = 25 OR op.replacement_cost = 1000)
    `, [site]);
    for (const def of defaults.rows) {
      const estCost = await estimateCost(def.device_type);
      const avgLife = Number(def.avg_life_years) === 25 ? 30 : Number(def.avg_life_years);
      const mfg = def.manufacture_date && String(def.manufacture_date) !== '2000-01-01'
        ? def.manufacture_date
        : new Date().toISOString().split('T')[0];
      await pool.query(
        `UPDATE obsolescence_parameters
         SET avg_temperature=$1, avg_life_years=$2, manufacture_date=$3, replacement_cost=$4
         WHERE device_id=$5 AND switchboard_id=$6 AND site=$7`,
        [25, avgLife || 30, mfg, estCost, def.device_id, def.switchboard_id, site]
      );
    }
    res.json({ message: 'AI fill done' });
  } catch (e) {
    console.error('[OBS AI-FILL] error:', e.message);
    res.status(500).json({ error: 'AI fill failed' });
  }
});

// ---- DOUGHNUT ----
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
    console.error('[OBS DOUGHNUT] error:', e.message);
    res.status(500).json({ error: 'Doughnut data failed' });
  }
});

// ---- CAPEX-FORECAST ----
app.get('/api/obsolescence/capex-forecast', async (req, res) => {
  try {
    const site = siteOf(req);
    const { group = 'building' } = req.query;
    let groupExpr = 's.building_code';
    if (group === 'floor') groupExpr = 's.floor';
    if (group === 'switchboard') groupExpr = 's.name';

    const r = await pool.query(`
      SELECT ${groupExpr} AS group_label,
             op.replacement_cost,
             op.manufacture_date,
             op.avg_life_years,
             oc.urgency_score
      FROM switchboards s
      JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE s.site = $1
    `, [site]);

    const forecasts = {};
    const currentYear = new Date().getFullYear();
    r.rows.forEach(row => {
      if (!forecasts[row.group_label]) forecasts[row.group_label] = [];
      const mfg = row.manufacture_date ? new Date(row.manufacture_date) : new Date('2000-01-01');
      const life = Number(row.avg_life_years) || 25;
      const urgency = Number(row.urgency_score) || 0;
      const base = (!isNaN(mfg.getTime()) ? mfg.getFullYear() : currentYear) + Math.round(life);
      const pullAhead = Math.min(3, Math.floor(urgency / 30));
      const year = base - pullAhead;
      const capex_year = Math.max(Number(row.replacement_cost) || 0, 0);
      forecasts[row.group_label].push({ year, capex_year });
    });

    res.json({ forecasts });
  } catch (e) {
    console.error('[OBS CAPEX FORECAST] error:', e.message);
    res.status(500).json({ error: 'CAPEX forecast failed' });
  }
});

// ---- AI-QUERY ----
app.post('/api/obsolescence/ai-query', async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: 'OpenAI not configured' });
    const { query, site } = req.body || {};
    const dbContext = await pool.query(`
      SELECT s.name, op.* 
      FROM switchboards s 
      LEFT JOIN devices d ON s.id = d.switchboard_id 
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.switchboard_id = s.id AND op.site = $1 
      WHERE s.site = $1
    `, [site]);
    const context = dbContext.rows.length ? JSON.stringify(dbContext.rows) : 'No data';
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
    let updates = false;
    if (String(query || '').toLowerCase().includes('set temp')) {
      const tempMatch = String(query).match(/\d+/);
      if (tempMatch) {
        const temp = parseFloat(tempMatch[0]);
        await pool.query(`UPDATE obsolescence_parameters SET avg_temperature = $1 WHERE site = $2`, [temp, site]);
        updates = true;
      }
    }
    res.json({ response, updates });
  } catch (e) {
    console.error('[AI QUERY] error:', e.message);
    res.status(500).json({ error: 'AI query failed' });
  }
});

// ---- GANTT-DATA (fix GROUP BY expression) ----
app.get('/api/obsolescence/gantt-data', async (req, res) => {
  try {
    const site = siteOf(req);
    const { group = 'switchboard', building, switchboard } = req.query;
    let groupExpr = 's.name'; // << use expression; alias later
    let where = 's.site = $1';
    const vals = [site];
    if (building) { where += ' AND s.building_code = $2'; vals.push(building); }
    if (switchboard) { where += ' AND s.id = $' + (vals.length + 1); vals.push(Number(switchboard)); }
    const r = await pool.query(`
      SELECT ${groupExpr} AS group_label,
             AVG(EXTRACT(YEAR FROM op.manufacture_date))::int AS manufacture_year,
             AVG(op.avg_life_years)::int AS avg_life_years,
             AVG(oc.urgency_score)::int AS urgency_score,
             COALESCE(SUM(op.replacement_cost),0) AS replacement_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE ${where}
      GROUP BY ${groupExpr}
    `, vals);
    const tasks = r.rows.map(row => {
      const mfgYear = Number(row.manufacture_year) || 2000;
      const life = Number(row.avg_life_years) || 25;
      const start = new Date(mfgYear, 0, 1);
      const end = new Date(mfgYear + life, 0, 1);
      return {
        start, end,
        name: row.group_label || 'Unknown',
        id: row.group_label || 'unknown',
        progress: Number(row.urgency_score) || 0,
        type: 'task',
        cost: Number(row.replacement_cost) || 0,
      };
    }).filter(t => !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()));
    res.json({ tasks });
  } catch (e) {
    console.error('[OBS GANTT] error:', e.message);
    res.status(500).json({ error: 'Gantt data failed' });
  }
});

// ---- KPIs ----
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
    const r = await pool.query('SELECT SUM(replacement_cost) AS total FROM obsolescence_parameters WHERE site=$1', [site]);
    res.json({ total: r.rows[0]?.total || 50000 });
  } catch {
    res.status(500).json({ error: 'Total CAPEX failed' });
  }
});

// ---- PDF Analysis (optional) ----
app.post('/api/obsolescence/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    const site = siteOf(req);
    const { device_id, switchboard_id } = req.body;
    // Placeholder extraction (kept minimal)
    const manufacture_date = '2015-06-01';
    await pool.query(
      `UPDATE obsolescence_parameters SET manufacture_date=$1 WHERE device_id=$2 AND switchboard_id=$3 AND site=$4`,
      [manufacture_date, Number(device_id), Number(switchboard_id), site]
    );
    res.json({ manufacture_date });
  } catch (e) {
    console.error('[PDF ANALYZE] error:', e.message);
    res.status(500).json({ error: 'PDF analysis failed', details: e.message });
  }
});

// ---- Logic helpers ----
function calculateObsolescence(point) {
  const currentYear = new Date().getFullYear();
  const manufactureYear = point.manufacture_date && !isNaN(new Date(point.manufacture_date).getTime())
    ? new Date(point.manufacture_date).getFullYear() : 2000;
  const age = currentYear - manufactureYear;
  const avgLife = Number(point.avg_life_years) || 25;
  const temp = Number(point.avg_temperature) || 25;
  const humidity = Number(point.avg_humidity) || 50;
  const cycles = Number(point.operation_cycles) || 5000;

  const tempFactor = Math.pow(2, (temp - 25) / 10);
  const humFactor = humidity > 70 ? 1.5 : 1;
  const cycleFactor = cycles > 10000 ? 1.2 : 1;
  const adjustedLife = avgLife / (tempFactor * humFactor * cycleFactor);
  const remaining_life_years = Math.max(adjustedLife - age, 0);

  let urgency = (age / Math.max(adjustedLife, 1)) * 50;
  if (point.selectivity_status === 'non-selective') urgency += 20;
  if (point.fault_status === 'at-risk') urgency += 15;
  if (point.arc_status === 'at-risk') urgency += 15;
  urgency = Math.min(Math.max(urgency, 0), 100);
  const status = urgency < 30 ? 'ok' : urgency < 70 ? 'warning' : 'critical';
  const riskZones = urgency > 50 ? [{ min: 50, max: urgency }] : [];
  return { remaining_life_years: Math.round(remaining_life_years), urgency_score: Math.round(urgency), status, riskZones };
}

async function estimateCost(deviceType = '') {
  const t = String(deviceType || '').toUpperCase();
  if (t.includes('MCCB')) return 2000;
  if (t.includes('VCB') || t.includes('VACUUM')) return 15000;
  if (t.includes('AIR') && t.includes('CB')) return 10000;
  if (t.includes('PROTECTION') || t.includes('RELAY')) return 3000;
  return 5000;
}

// ---- Start ----
const port = Number(process.env.OBSOLESCENCE_PORT || 3007);
app.listen(port, () => console.log(`[OBSOLESCENCE] service running on :${port}`));
