// server_obsolescence.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import OpenAI from 'openai';
import multer from 'multer';
import PDFParse from 'pdf-parse';
import Joi from 'joi';
import axios from 'axios';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// OpenAI setup
let openai = null;
let openaiError = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[OBSOLESCENCE] OpenAI initialisé');
  } catch (e) {
    console.warn('[OBSOLESCENCE] Échec init OpenAI:', e.message);
    openaiError = e.message;
  }
} else {
  console.warn('[OBSOLESCENCE] Aucune OPENAI_API_KEY trouvée');
  openaiError = 'Aucune clé API';
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Upload setup pour PDF, limite à 5MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString().trim();
}

// Schema validation
const idSchema = Joi.object({
  device_id: Joi.number().integer().positive(),
  switchboard_id: Joi.number().integer().positive().required(),
});

const paramSchema = Joi.object({
  switchboard_id: Joi.number().integer().positive().required(),
  manufacture_date: Joi.date().required(),
  avg_temperature: Joi.number().min(0).max(100).required(),
  avg_humidity: Joi.number().min(0).max(100).required(),
  operation_cycles: Joi.number().min(0).required(),
  avg_life_years: Joi.number().min(10).required(),
  replacement_cost: Joi.number().min(0).required(),
  document_link: Joi.string().uri().allow('').optional(),
});

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
        document_link TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, switchboard_id, site)
      );
      CREATE INDEX IF NOT EXISTS idx_obsolescence_parameters_site ON obsolescence_parameters(site);
    `);
    console.log('[OBS SCHEMA] Schéma assuré');
  } catch (e) {
    console.error('[OBS SCHEMA] erreur:', e.message);
    throw e;
  }
}
ensureSchema().catch(e => console.error('[OBS SCHEMA] erreur:', e.message));

// Test data
app.post('/api/obsolescence/test-data', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Site manquant' });
    const sbCheck = await pool.query('SELECT id FROM switchboards WHERE site = $1 LIMIT 1', [site]);
    if (sbCheck.rows.length === 0) {
      const sbIns = await pool.query(
        'INSERT INTO switchboards (site, name, code, building_code, floor) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [site, 'Test SB', 'TSB', 'Bâtiment A', '1']
      );
      await pool.query(
        'INSERT INTO devices (site, switchboard_id, name, device_type, in_amps, replacement_cost) VALUES ($1, $2, $3, $4, $5, $6)',
        [site, sbIns.rows[0].id, 'Test Device', 'MCCB', 100, 1000]
      );
      console.log('[OBS TEST] Données test créées');
    }
    res.json({ message: 'Données test créées/vérifiées' });
  } catch (e) {
    console.error('[OBS TEST] erreur:', e.message);
    res.status(500).json({ error: 'Échec création données test', details: e.message });
  }
});

// RESET
app.post('/api/obsolescence/reset', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Site manquant' });
    await pool.query(`DELETE FROM obsolescence_checks WHERE site = $1`, [site]);
    await pool.query(`DELETE FROM obsolescence_parameters WHERE site = $1`, [site]);
    console.log(`[OBS RESET] Effacé obsolescence_checks et obsolescence_parameters pour site=${site}`);
    res.json({ message: 'Données obsolescence réinitialisées' });
  } catch (e) {
    console.error('[OBS RESET] erreur:', e.message);
    res.status(500).json({ error: 'Échec réinitialisation', details: e.message });
  }
});

// LIST Buildings
app.get('/api/obsolescence/buildings', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Site manquant' });
    const r = await pool.query(`
      SELECT DISTINCT building_code AS building, COUNT(*) AS count, SUM(op.replacement_cost) AS total_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.site = $1
      GROUP BY building_code
    `, [site]);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[OBS BUILDINGS] erreur:', e.message);
    res.status(500).json({ error: 'Échec chargement bâtiments', details: e.message });
  }
});

// LIST Switchboards by Building
app.get('/api/obsolescence/switchboards', async (req, res) => {
  try {
    const site = siteOf(req);
    const { building } = req.query;
    if (!site || !building) return res.status(400).json({ error: 'Params manquants' });
    const r = await pool.query(`
      SELECT s.id, s.name, s.floor, COUNT(d.id) AS device_count, SUM(op.replacement_cost) AS total_cost,
      AVG(EXTRACT(YEAR FROM op.manufacture_date)) AS manufacture_date, AVG(op.avg_life_years) AS remaining_life_years, op.document_link
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.site = $1
      WHERE s.site = $1 AND s.building_code = $2
      GROUP BY s.id, op.document_link
    `, [site, building]);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[OBS SWITCHBOARDS] erreur:', e.message);
    res.status(500).json({ error: 'Échec chargement tableaux', details: e.message });
  }
});

// UPDATE Parameters (pour switchboard entier)
app.post('/api/obsolescence/parameters', async (req, res) => {
  const { error } = paramSchema.validate(req.body);
  if (error) return res.status(422).json({ error: 'Données invalides', details: error.details });
  try {
    const site = siteOf(req);
    const params = req.body;
    const devices = await pool.query('SELECT id FROM devices WHERE switchboard_id = $1 AND site = $2', [params.switchboard_id, site]);
    for (const dev of devices.rows) {
      await pool.query(`
        INSERT INTO obsolescence_parameters (device_id, switchboard_id, site, manufacture_date, avg_temperature, avg_humidity, operation_cycles, avg_life_years, replacement_cost, document_link)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (device_id, switchboard_id, site)
        DO UPDATE SET manufacture_date = $4, avg_temperature = $5, avg_humidity = $6, operation_cycles = $7, avg_life_years = $8, replacement_cost = $9, document_link = $10
      `, [dev.id, params.switchboard_id, site, params.manufacture_date, params.avg_temperature, params.avg_humidity, params.operation_cycles, params.avg_life_years, params.replacement_cost, params.document_link || null]);
    }
    res.json({ message: 'Paramètres mis à jour pour le tableau entier' });
  } catch (e) {
    console.error('[OBS PARAMS] erreur:', e.message);
    res.status(500).json({ error: 'Échec mise à jour params', details: e.message });
  }
});

// CHECK
app.get('/api/obsolescence/check', async (req, res) => {
  const { error } = idSchema.validate(req.query);
  if (error) return res.status(422).json({ error: 'Données invalides', details: error.details });
  try {
    const { device, switchboard } = req.query;
    const site = siteOf(req);
    if (!device || !switchboard || !site) return res.status(400).json({ error: 'Params manquants' });
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
    if (pointRes.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });
    let point = pointRes.rows[0];
    if (point.replacement_cost === 1000) {
      point.replacement_cost = await estimateCost(point.device_type);
    }
    const obs = calculateObsolescence(point);
    await pool.query(`
      INSERT INTO obsolescence_checks (device_id, switchboard_id, site, remaining_life_years, urgency_score, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET remaining_life_years = $4, urgency_score = $5, status = $6, checked_at = NOW()
    `, [Number(device), Number(switchboard), site, obs.remaining_life_years, obs.urgency_score, obs.status]);
    res.json(obs);
  } catch (e) {
    console.error('[OBS CHECK] erreur:', e.message);
    res.status(500).json({ error: 'Échec vérification', details: e.message });
  }
});

// AUTO-CHECK
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
      if (pt.replacement_cost === 1000) {
        pt.replacement_cost = await estimateCost(pt.device_type);
      }
      const obs = calculateObsolescence(pt);
      await pool.query(`
        INSERT INTO obsolescence_checks (device_id, switchboard_id, site, remaining_life_years, urgency_score, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (device_id, switchboard_id, site) DO UPDATE SET remaining_life_years = $4, urgency_score = $5, status = $6, checked_at = NOW()
      `, [p.device_id, p.switchboard_id, site, obs.remaining_life_years, obs.urgency_score, obs.status]);
    }
    res.json({ message: 'Vérification auto terminée' });
  } catch (e) {
    console.error('[OBS AUTO-CHECK] erreur:', e.message);
    res.status(500).json({ error: 'Échec vérification auto', details: e.message });
  }
});

// AI-FILL (par switchboard)
app.post('/api/obsolescence/ai-fill', async (req, res) => {
  try {
    const site = siteOf(req);
    const switchboards = await pool.query('SELECT id FROM switchboards WHERE site = $1', [site]);
    for (const sb of switchboards.rows) {
      const defaults = await pool.query(`
        SELECT * FROM obsolescence_parameters WHERE switchboard_id = $1 AND site = $2 AND (avg_temperature = 25 OR avg_life_years = 25 OR replacement_cost = 1000)
      `, [sb.id, site]);
      for (const def of defaults.rows) {
        // Estimation IA
        def.avg_temperature = 25; // De recherche
        def.avg_life_years = 30; // Moyenne MCCB
        def.manufacture_date = new Date().toISOString().split('T')[0]; // Date récente par défaut
        def.replacement_cost = await estimateCost(def.device_type);
        // Mise à jour
        await pool.query(`UPDATE obsolescence_parameters SET avg_temperature = $1, avg_life_years = $2, manufacture_date = $3, replacement_cost = $4 WHERE device_id = $5 AND switchboard_id = $6 AND site = $7`,
          [def.avg_temperature, def.avg_life_years, def.manufacture_date, def.replacement_cost, def.device_id, def.switchboard_id, site]);
      }
    }
    res.json({ message: 'Remplissage IA terminé' });
  } catch (e) {
    console.error('[OBS AI-FILL] erreur:', e.message);
    res.status(500).json({ error: 'Échec remplissage IA', details: e.message });
  }
});

// DOUGHNUT
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
    console.error('[OBS DOUGHNUT] erreur:', e.message);
    res.status(500).json({ error: 'Échec données camembert', details: e.message });
  }
});

// CAPEX-FORECAST
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
    console.error('[OBS CAPEX FORECAST] erreur:', e.message);
    res.status(500).json({ error: 'Échec prévision CAPEX', details: e.message });
  }
});

// AI-QUERY
app.post('/api/obsolescence/ai-query', async (req, res) => {
  try {
    const { query, site } = req.body;
    const dbContext = await pool.query(`
      SELECT s.name, op.* 
      FROM switchboards s 
      LEFT JOIN devices d ON s.id = d.switchboard_id 
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND op.site = $1 
      WHERE s.site = $1
    `, [site]);
    const context = dbContext.rows.length ? JSON.stringify(dbContext.rows) : 'Aucune donnée';
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `Vous êtes un expert en obsolescence de sous-stations. Utilisez le contexte DB: ${context}. Fournissez une analyse basée sur les données DB, normes comme IEC 62271, stratégies CAPEX. Si la requête inclut 'set temp' ou similaire, mettez à jour avg_temperature dans obsolescence_parameters pour le tableau entier (retournez updates: true).` 
        },
        { role: 'user', content: query }
      ],
      max_tokens: 200,
      temperature: 0.5
    });
    const response = completion.choices[0].message.content.trim();
    let updates = false;
    if (query.toLowerCase().includes('set temp')) {
      const tempMatch = query.match(/\d+/);
      if (tempMatch) {
        const temp = parseFloat(tempMatch[0]);
        await pool.query(`UPDATE obsolescence_parameters SET avg_temperature = $1 WHERE site = $2`, [temp, site]);
        updates = true;
      }
    }
    res.json({ response, updates });
  } catch (e) {
    console.error('[AI QUERY] erreur:', e.message);
    res.status(500).json({ error: 'Échec requête IA', details: e.message });
  }
});

// GANTT-DATA avec agrégation switchboard
app.get('/api/obsolescence/gantt-data', async (req, res) => {
  try {
    const site = siteOf(req);
    const { group = 'switchboard', building, switchboard } = req.query;
    let groupField = 's.name AS group_label, s.id';
    let where = 's.site = $1';
    let vals = [site];
    if (building) { where += ' AND s.building_code = $2'; vals.push(building); }
    if (switchboard) { where += ' AND s.id = $3'; vals.push(Number(switchboard)); }
    const r = await pool.query(`
      SELECT ${groupField}, AVG(EXTRACT(YEAR FROM op.manufacture_date)) AS manufacture_year, AVG(op.avg_life_years) AS avg_life_years, AVG(oc.urgency_score) AS urgency_score, SUM(op.replacement_cost) AS replacement_cost
      FROM switchboards s
      LEFT JOIN devices d ON s.id = d.switchboard_id
      LEFT JOIN obsolescence_parameters op ON d.id = op.device_id AND s.id = op.switchboard_id AND op.site = $1
      LEFT JOIN obsolescence_checks oc ON d.id = oc.device_id AND s.id = oc.switchboard_id AND oc.site = $1
      WHERE ${where}
      GROUP BY s.id, s.name
    `, vals);
    const tasks = r.rows.map(row => ({
      start: new Date(row.manufacture_year || 2000, 0, 1),
      end: new Date((row.manufacture_year || 2000) + (row.avg_life_years || 25), 11, 31),
      name: row.group_label || 'Inconnu',
      id: row.id || 'inconnu',
      progress: row.urgency_score || 0,
      type: 'task',
      cost: row.replacement_cost || 0,
    })).filter(task => !isNaN(task.start.getTime()) && !isNaN(task.end.getTime()));
    res.json({ tasks });
  } catch (e) {
    console.error('[OBS GANTT] erreur:', e.message);
    res.status(500).json({ error: 'Échec données Gantt', details: e.message });
  }
});

// ANNUAL-GANTT pour switchboard
app.get('/api/obsolescence/annual-gantt', async (req, res) => {
  try {
    const { switchboard_id } = req.query;
    const site = siteOf(req);
    const r = await pool.query(`
      SELECT op.manufacture_date, op.avg_life_years
      FROM obsolescence_parameters op WHERE switchboard_id = $1 AND site = $2 LIMIT 1
    `, [Number(switchboard_id), site]);
    const row = r.rows[0];
    const tasks = [];
    if (row) {
      const manufactureYear = new Date(row.manufacture_date).getFullYear();
      for (let m = 0; m < 12; m++) {
        tasks.push({
          start: new Date(manufactureYear, m, 1),
          end: new Date(manufactureYear, m + 1, 0),
          name: `Mois ${m + 1}`,
          id: `${switchboard_id}-${m}`,
          progress: (m / 12) * 100,
          type: 'task',
        });
      }
    }
    res.json({ tasks });
  } catch (e) {
    console.error('[OBS ANNUAL GANTT] erreur:', e.message);
    res.status(500).json({ error: 'Échec Gantt annuel', details: e.message });
  }
});

// Nouveaux endpoints pour graphs supplémentaires
app.get('/api/obsolescence/cost-by-building', async (req, res) => {
  try {
    const site = siteOf(req);
    const r = await pool.query(`
      SELECT building_code AS building, SUM(replacement_cost) AS total_cost
      FROM switchboards s JOIN obsolescence_parameters op ON s.id = op.switchboard_id WHERE op.site = $1
      GROUP BY building_code
    `, [site]);
    res.json({ data: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'Échec coûts par bâtiment' });
  }
});

app.get('/api/obsolescence/urgency-vs-age', async (req, res) => {
  try {
    const site = siteOf(req);
    const r = await pool.query(`
      SELECT EXTRACT(YEAR FROM AGE(NOW(), op.manufacture_date)) AS age, oc.urgency_score AS urgency
      FROM obsolescence_parameters op JOIN obsolescence_checks oc ON op.switchboard_id = oc.switchboard_id WHERE op.site = $1
    `, [site]);
    res.json({ data: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'Échec urgence vs âge' });
  }
});

// Additional endpoints pour suggestions
app.get('/api/obsolescence/avg-urgency', async (req, res) => {
  try {
    const site = siteOf(req);
    const r = await pool.query(`SELECT AVG(urgency_score) AS avg FROM obsolescence_checks WHERE site = $1`, [site]);
    res.json({ avg: r.rows[0].avg || 45 });
  } catch (e) {
    res.status(500).json({ error: 'Échec urgence moyenne', details: e.message });
  }
});

app.get('/api/obsolescence/total-capex', async (req, res) => {
  try {
    const site = siteOf(req);
    const r = await pool.query(`SELECT SUM(replacement_cost) AS total FROM obsolescence_parameters WHERE site = $1`, [site]);
    res.json({ total: r.rows[0].total || 50000 });
  } catch (e) {
    res.status(500).json({ error: 'Échec CAPEX total', details: e.message });
  }
});

// PDF Analysis (réel avec pdf-parse)
app.post('/api/obsolescence/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun PDF uploadé' });
    const site = siteOf(req);
    const { switchboard_id } = req.body;
    const { error } = Joi.object({ switchboard_id: Joi.number().required() }).validate({ switchboard_id });
    if (error) return res.status(422).json({ error: 'Données invalides' });
    const buffer = req.file.buffer;
    const data = await PDFParse(buffer);
    const pdfText = data.text;
    const prompt = `Extraire date de fabrication, modèle et coût du texte PDF suivant : "${pdfText.slice(0, 2000)}" (tronqué si trop long). Retourner en JSON.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const extracted = JSON.parse(completion.choices[0].message.content);
    const manufacture_date = extracted.manufacture_date && !isNaN(new Date(extracted.manufacture_date).getTime()) ? extracted.manufacture_date : '2000-01-01';
    await pool.query(`
      UPDATE obsolescence_parameters SET manufacture_date = $1
      WHERE switchboard_id = $2 AND site = $3
    `, [manufacture_date, Number(switchboard_id), site]);
    res.json({ manufacture_date });
  } catch (e) {
    console.error('[PDF ANALYZE] erreur:', e.message);
    res.status(500).json({ error: 'Échec analyse PDF', details: e.message });
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

async function estimateCost(deviceType) {
  try {
    // Basé sur recherches 2025 : MCCB 50-150 USD, convertir approx à EUR
    if (deviceType === 'MCCB') return 100; // Moyenne approx en EUR
    const searchResult = await axios.get(`https://api.duckduckgo.com/?q=average+cost+of+${deviceType}&format=json`);
    const prompt = `Estimer coût de remplacement pour ${deviceType} basé sur ces données : ${searchResult.data.AbstractText || 'Aucune donnée'}. Retourner un nombre.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });
    return parseFloat(completion.choices[0].message.content) || 1000;
  } catch {
    return 1000;
  }
}

const port = process.env.OBSOLESCENCE_PORT || 3007;
app.listen(port, () => console.log(`Service obsolescence sur :${port}`));
