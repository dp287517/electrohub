import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import PDFParser from 'pdf2json';
import multer from 'multer';
import PDFDocument from 'pdfkit';

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
const upload = multer({ storage: multer.memoryStorage() });

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
        predicted_lifetime_years NUMERIC NOT NULL,
        replacement_year INTEGER NOT NULL,
        capex_estimate_eur NUMERIC NOT NULL,
        urgency_score NUMERIC NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
        status TEXT NOT NULL CHECK (status IN ('low-risk', 'medium-risk', 'high-risk', 'incomplete')),
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site)
      );
      CREATE INDEX IF NOT EXISTS idx_obsolescence_checks_site ON obsolescence_checks(site);

      CREATE TABLE IF NOT EXISTS obsolescence_parameters (
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        switchboard_id INTEGER REFERENCES switchboards(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        manufacturing_date DATE NOT NULL DEFAULT '2000-01-01',
        avg_temp_c NUMERIC NOT NULL DEFAULT 25,
        avg_humidity_pct NUMERIC NOT NULL DEFAULT 50,
        operational_cycles_per_year NUMERIC NOT NULL DEFAULT 100,
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
    
    console.log(`[OBS RESET] Cleared for site=${site}`);
    res.json({ message: 'Obs data reset successfully' });
  } catch (e) {
    console.error('[OBS RESET] error:', e.message);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// LIST Obs points (devices/switchboards)
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
        d.id AS device_id, d.name AS device_name, d.device_type, d.manufacturer, d.reference,
        s.id AS switchboard_id, s.name AS switchboard_name, s.building_code, s.floor,
        oc.status, oc.urgency_score, oc.replacement_year, oc.capex_estimate_eur
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE ${where.join(' AND ')}
      ORDER BY s.${sortSafe(sort)} ${dirSafe(dir)}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await pool.query(sql, vals);
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM devices d JOIN switchboards s ON d.switchboard_id = s.id WHERE ${where.join(' AND ')}`, vals);
    res.json({ data: rows.rows, total: count.rows[0].total });
  } catch (e) {
    console.error('[OBS POINTS] error:', e.message);
    res.status(500).json({ error: 'Points load failed' });
  }
});

// UPDATE Parameters
app.post('/api/obsolescence/parameters', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device_id, switchboard_id, manufacturing_date, avg_temp_c, avg_humidity_pct, operational_cycles_per_year } = req.body;
    if (!device_id || !switchboard_id) return res.status(400).json({ error: 'Missing IDs' });

    await pool.query(`
      INSERT INTO obsolescence_parameters (device_id, switchboard_id, site, manufacturing_date, avg_temp_c, avg_humidity_pct, operational_cycles_per_year)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET
        manufacturing_date = $4, avg_temp_c = $5, avg_humidity_pct = $6, operational_cycles_per_year = $7
    `, [Number(device_id), Number(switchboard_id), site, manufacturing_date, Number(avg_temp_c), Number(avg_humidity_pct), Number(operational_cycles_per_year)]);

    res.json({ message: 'Parameters updated' });
  } catch (e) {
    console.error('[OBS PARAMS] error:', e.message);
    res.status(500).json({ error: 'Params update failed' });
  }
});

// CHECK Point (forecast obsolescence)
app.get('/api/obsolescence/check', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const { device, switchboard } = req.query;
    const r = await pool.query(`
      SELECT d.*, s.*, op.*, sc.status AS selectivity_status, fc.status AS fla_status, ac.status AS arc_status
      FROM devices d
      JOIN switchboards s ON d.switchboard_id = s.id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $3
      LEFT JOIN selectivity_checks sc ON d.id = sc.downstream_id
      LEFT JOIN fault_checks fc ON d.id = fc.device_id
      LEFT JOIN arcflash_checks ac ON d.id = ac.device_id
      WHERE d.id = $1 AND d.switchboard_id = $2 AND d.site = $3
    `, [Number(device), Number(switchboard), site]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Point not found' });

    const point = r.rows[0];
    const manufacturing_date = new Date(point.manufacturing_date || '2000-01-01');
    const currentYear = new Date().getFullYear();
    const age = currentYear - manufacturing_date.getFullYear();

    // Base lifetime from device_type (norms-based)
    let baseLifetime = 25; // Default
    if (point.device_type.includes('Breaker')) baseLifetime = 25;
    if (point.device_type.includes('Switchboard')) baseLifetime = 35;
    if (point.device_type === 'Transformer') baseLifetime = 40;

    // Acceleration factors (Arrhenius for temp, Peck for humidity)
    const tempFactor = Math.pow(2, (point.avg_temp_c - 25) / 10); // Arrhenius: double rate every 10°C
    const humidityFactor = Math.exp((point.avg_humidity_pct - 50) / 20); // Simplified Peck
    const cyclesFactor = 1 + (point.operational_cycles_per_year / 1000); // Wear factor

    let predictedLifetime = baseLifetime / (tempFactor * humidityFactor * cyclesFactor);
    predictedLifetime = Math.max(5, Math.min(50, predictedLifetime)); // Clamp

    const replacementYear = manufacturing_date.getFullYear() + Math.round(predictedLifetime);

    // Urgency score: Integrate risks (0-100)
    const riskSelectivity = point.selectivity_status === 'non-selective' ? 30 : 0;
    const riskFla = point.fla_status === 'at-risk' ? 25 : 0;
    const riskArc = point.arc_status === 'at-risk' ? 25 : 0;
    const ageRisk = (age / baseLifetime) * 20;
    const urgencyScore = Math.min(100, riskSelectivity + riskFla + riskArc + ageRisk);

    // CAPEX estimate
    let basePrice = 500; // Default device
    if (point.device_type.includes('MCB')) basePrice = 100;
    if (point.device_type.includes('MCCB')) basePrice = 500;
    if (point.device_type.includes('ACB')) basePrice = 3000;
    const switchboardSize = await pool.query(`SELECT COUNT(*) FROM devices WHERE switchboard_id = $1`, [switchboard]);
    const switchboardPrice = 2000 + 300 * switchboardSize.rows[0].count; // Avg formula
    const capexEstimate = basePrice + (switchboard ? switchboardPrice / 10 : 0); // Pro-rate if switchboard

    let status = 'low-risk';
    if (urgencyScore > 70) status = 'high-risk';
    else if (urgencyScore > 40) status = 'medium-risk';

    // Save check
    await pool.query(`
      INSERT INTO obsolescence_checks (device_id, switchboard_id, site, predicted_lifetime_years, replacement_year, capex_estimate_eur, urgency_score, status, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET
        predicted_lifetime_years = $4, replacement_year = $5, capex_estimate_eur = $6, urgency_score = $7, status = $8, checked_at = NOW()
    `, [Number(device), Number(switchboard), site, predictedLifetime, replacementYear, capexEstimate, urgencyScore, status]);

    const remediations = getRemediations(point, urgencyScore, replacementYear);

    res.json({ predicted_lifetime_years: predictedLifetime, replacement_year: replacementYear, capex_estimate_eur: capexEstimate, urgency_score: urgencyScore, status, remediations });
  } catch (e) {
    console.error('[OBS CHECK] error:', e.message);
    res.status(500).json({ error: 'Check failed' });
  }
});

// GET Gantt data (30 years plan)
app.get('/api/obsolescence/gantt', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const currentYear = new Date().getFullYear();
    const rows = await pool.query(`
      SELECT oc.*, d.name AS device_name, s.name AS switchboard_name
      FROM obsolescence_checks oc
      JOIN devices d ON oc.device_id = d.id
      JOIN switchboards s ON oc.switchboard_id = s.id
      WHERE oc.site = $1
      ORDER BY oc.replacement_year ASC
    `, [site]);

    const ganttData = rows.rows.map(row => ({
      id: row.device_id,
      name: `${row.switchboard_name} - ${row.device_name}`,
      start: `${row.replacement_year - 1}-01-01`,
      end: `${row.replacement_year}-12-31`,
      progress: Math.min(100, ((currentYear - (row.replacement_year - row.predicted_lifetime_years)) / row.predicted_lifetime_years) * 100),
      urgency: row.urgency_score
    }));

    res.json({ data: ganttData });
  } catch (e) {
    console.error('[OBS GANTT] error:', e.message);
    res.status(500).json({ error: 'Gantt data failed' });
  }
});

// GET CAPEX Forecast (30 years cumulative)
app.get('/api/obsolescence/capex-forecast', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });
    const currentYear = new Date().getFullYear();
    const forecast = Array.from({length: 30}, (_, i) => ({ year: currentYear + i, capex: 0 }));

    const rows = await pool.query(`
      SELECT replacement_year, capex_estimate_eur
      FROM obsolescence_checks WHERE site = $1
    `, [site]);

    rows.rows.forEach(row => {
      const idx = row.replacement_year - currentYear;
      if (idx >= 0 && idx < 30) forecast[idx].capex += row.capex_estimate_eur;
    });

    // Cumulative
    for (let i = 1; i < 30; i++) {
      forecast[i].capex += forecast[i-1].capex;
    }

    res.json({ data: forecast });
  } catch (e) {
    console.error('[OBS CAPEX] error:', e.message);
    res.status(500).json({ error: 'CAPEX forecast failed' });
  }
});

// AI TIP
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
          content: `You are an expert in IEC 62402 obsolescence management. Provide concise, actionable advice based on "${context}". Reference norms, suggest mitigations like temp control or upgrades. Include CAPEX impacts. 1-2 sentences.` 
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

// ANALYZE PDF (upload and extract data)
app.post('/api/obsolescence/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });

    const pdfParser = new PDFParser();
    let extractedText = '';

    // Promisify pdf2json parsing
    const parsePromise = new Promise((resolve, reject) => {
      pdfParser.on('pdfParser_dataError', errData => reject(new Error(errData.parserError)));
      pdfParser.on('pdfParser_dataReady', pdfData => {
        extractedText = pdfParser.getRawTextContent();
        resolve(extractedText);
      });
    });

    pdfParser.parseBuffer(req.file.buffer);
    const text = await parsePromise;

    // Extract key info (AI-assisted)
    let extracted = { manufacturing_dates: [], risks: [] };
    if (openai) {
      const prompt = `Extract from this PDF text: manufacturing dates, device types, risks (selectivity, fault level, arc flash). Output JSON. Text: "${text.slice(0, 2000)}"`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      });
      extracted = JSON.parse(completion.choices[0].message.content);
    }

    res.json({ extracted });
  } catch (e) {
    console.error('[PDF ANALYZE] error:', e.message);
    res.status(500).json({ error: 'PDF analysis failed' });
  }
});

// EXPORT PDF Report
app.get('/api/obsolescence/export-pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=obsolescence-report.pdf');
    doc.pipe(res);

    doc.fontSize(25).text('CAPEX Forecasting Report', { align: 'center' });
    doc.moveDown();

    // AI Executive Summary
    let summary = 'Generated report.';
    if (openai) {
      const data = await pool.query(`SELECT * FROM obsolescence_checks WHERE site = $1`, [site]);
      const prompt = `Generate executive summary for obsolescence report based on this data: ${JSON.stringify(data.rows.slice(0,5))}. Focus on key risks and CAPEX over 30 years.`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }]
      });
      summary = completion.choices[0].message.content;
    }
    doc.fontSize(12).text(summary);

    // Table of checks
    doc.moveDown().text('Detailed Checks:');
    const checks = await pool.query(`SELECT * FROM obsolescence_checks WHERE site = $1`, [site]);
    checks.rows.forEach(row => {
      doc.text(`Device ${row.device_id}: Replacement ${row.replacement_year}, CAPEX €${row.capex_estimate_eur}, Urgency ${row.urgency_score}`);
    });

    doc.end();
  } catch (e) {
    console.error('[PDF EXPORT] error:', e.message);
    res.status(500).json({ error: 'PDF export failed' });
  }
});

// Helper: Remediations
function getRemediations(point, urgency, replacementYear) {
  return [
    `Monitor temp/humidity to extend life by 5-10 years (IEC 62402)`,
    `Budget €${Math.round(point.capex_estimate_eur * 1.1)} for replacement in ${replacementYear}`,
    urgency > 70 ? 'Urgent upgrade due to high risks' : 'Plan maintenance'
  ];
}

const port = process.env.OBSOLESCENCE_PORT || 3007;
app.listen(port, () => console.log(`Obsolescence service running on :${port}`));
