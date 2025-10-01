// server_controls.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import pg from 'pg';
import OpenAI from 'openai';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

/** ---------------- App ---------------- */
const app = express();
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

/** ---------------- AI (optional) ---------------- */
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (_) {
  openai = null;
}

/** ---------------- Uploads ---------------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** ---------------- Helpers ---------------- */
function siteOf(req) {
  const site = (req.header('X-Site') || req.query.site || req.body?.site || '').toString();
  console.log('Site detected:', site);
  return site || 'default_site';
}
function clampInt(v, def = null) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function toISODate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function addMonths(dateStr, months) {
  if (!dateStr || !months) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months));
  if (d.getDate() < day) d.setDate(0);
  return toISODate(d);
}
function todayISO() { return toISODate(new Date()); }

/** Compute next_control using rule: when a range exists (min..max), ALWAYS use the farthest (max) */
function computeNextControl({ last_control, frequency_months, frequency_months_min, frequency_months_max }) {
  const base = last_control || todayISO();
  const months = clampInt(frequency_months_max, null) ?? clampInt(frequency_months, null) ?? clampInt(frequency_months_min, null);
  return months ? addMonths(base, months) : todayISO();
}

/** ---------------- Schema ---------------- */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_entities (
      id SERIAL PRIMARY KEY,
      site TEXT,
      device_id INTEGER REFERENCES devices(id),
      switchboard_id INTEGER REFERENCES switchboards(id),
      name TEXT,
      equipment_type TEXT,
      building TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_controls_entities_site ON controls_entities(site);
    CREATE INDEX IF NOT EXISTS idx_controls_entities_device ON controls_entities(device_id);
    CREATE INDEX IF NOT EXISTS idx_controls_entities_switchboard ON controls_entities(switchboard_id);

    CREATE TABLE IF NOT EXISTS controls_tasks (
      id SERIAL PRIMARY KEY,
      site TEXT,
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      task_name TEXT,
      task_code TEXT,
      frequency_months INTEGER,
      frequency_months_min INTEGER,
      frequency_months_max INTEGER,
      last_control DATE,
      next_control DATE,
      status TEXT DEFAULT 'Planned',
      value_type TEXT DEFAULT 'checklist',
      result_schema JSONB,
      procedure_md TEXT,
      hazards_md TEXT,
      ppe_md TEXT,
      tools_md TEXT,
      ai_notes JSONB,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_controls_tasks_site ON controls_tasks(site);
    CREATE INDEX IF NOT EXISTS idx_controls_tasks_entity ON controls_tasks(entity_id);
    CREATE INDEX IF NOT EXISTS idx_controls_tasks_next ON controls_tasks(next_control);

    CREATE TABLE IF NOT EXISTS controls_records (
      id SERIAL PRIMARY KEY,
      site TEXT,
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE CASCADE,
      performed_at TIMESTAMPTZ DEFAULT now(),
      performed_by TEXT,
      lang TEXT,
      result_status TEXT,
      numeric_value DOUBLE PRECISION,
      text_value TEXT,
      checklist_result JSONB,
      ai_result JSONB,
      comments TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_controls_records_task ON controls_records(task_id);

    CREATE TABLE IF NOT EXISTS controls_attachments (
      id SERIAL PRIMARY KEY,
      site TEXT,
      record_id INTEGER REFERENCES controls_records(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE CASCADE,
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      filename TEXT,
      mime TEXT,
      content BYTEA,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_controls_attachments_task ON controls_attachments(task_id);
    CREATE INDEX IF NOT EXISTS idx_controls_attachments_record ON controls_attachments(record_id);
  `);
}
await ensureSchema();

/** ---------------- Health ---------------- */
app.get('/api/controls/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), openai: !!openai });
});

/** ---------------- Entities CRUD ---------------- */
app.get('/api/controls/entities', async (req, res) => {
  try {
    const site = siteOf(req);
    const { q = '', building = '', sort = 'name', dir = 'asc', page = '1', pageSize = '100' } = req.query;
    const safeSort = ['id', 'name', 'building', 'equipment_type', 'created_at'].includes(String(sort)) ? sort : 'name';
    const safeDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const p = clampInt(page, 1);
    const ps = Math.min(clampInt(pageSize, 100), 500);

    const params = [site];
    let where = 'WHERE ce.site = $1';
    if (q) { params.push(`%${q}%`); where += ` AND (ce.name ILIKE $${params.length} OR d.name ILIKE $${params.length})`; }
    if (building) { params.push(building); where += ` AND s.building_code = $${params.length}`; }

    params.push(ps);
    params.push((p - 1) * ps);

    const sql = `
      SELECT ce.*, d.name AS device_name, s.name AS switchboard_name, s.building_code
      FROM controls_entities ce
      LEFT JOIN devices d ON ce.device_id = d.id
      LEFT JOIN switchboards s ON ce.switchboard_id = s.id
      ${where}
      ORDER BY ${safeSort} ${safeDir}
      LIMIT $${params.length-1} OFFSET $${params.length}
    `;
    const rows = (await pool.query(sql, params)).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/controls/entities', async (req, res) => {
  try {
    const site = siteOf(req);
    const { device_id, switchboard_id, name, equipment_type, building } = req.body || {};
    const out = await pool.query(`
      INSERT INTO controls_entities (site, device_id, switchboard_id, name, equipment_type, building)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [site, clampInt(device_id), clampInt(switchboard_id), name || null, equipment_type || null, building || null]);
    res.json(out.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ---------------- Tasks CRUD ---------------- */
app.get('/api/controls/tasks', async (req, res) => {
  try {
    const site = siteOf(req);
    const { entity_id, building = '', status = '', q = '', sort = 'next_control', dir = 'asc', page = '1', pageSize = '200' } = req.query;
    const safeSort = ['id', 'task_name', 'next_control', 'last_control', 'status', 'created_at'].includes(String(sort)) ? sort : 'next_control';
    const safeDir = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const p = clampInt(page, 1);
    const ps = Math.min(clampInt(pageSize, 200), 1000);

    const params = [site];
    let where = 'WHERE t.site = $1';
    if (entity_id) { params.push(clampInt(entity_id)); where += ` AND t.entity_id = $${params.length}`; }
    if (building) { params.push(building); where += ` AND ce.building = $${params.length}`; }
    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND (t.task_name ILIKE $${params.length} OR ce.name ILIKE $${params.length})`; }

    params.push(ps);
    params.push((p - 1) * ps);

    const sql = `
      SELECT t.*, ce.name AS entity_name, ce.building, ce.equipment_type, d.name AS device_name, s.name AS switchboard_name
      FROM controls_tasks t
      JOIN controls_entities ce ON t.entity_id = ce.id
      LEFT JOIN devices d ON ce.device_id = d.id
      LEFT JOIN switchboards s ON ce.switchboard_id = s.id
      ${where}
      ORDER BY ${safeSort} ${safeDir}
      LIMIT $${params.length-1} OFFSET $${params.length}
    `;
    const rows = (await pool.query(sql, params)).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/controls/tasks', async (req, res) => {
  try {
    const site = siteOf(req);
    const body = req.body || {};
    const next_control = computeNextControl(body);
    const out = await pool.query(`
      INSERT INTO controls_tasks (
        site, entity_id, task_name, task_code,
        frequency_months, frequency_months_min, frequency_months_max,
        last_control, next_control, status, value_type, result_schema,
        procedure_md, hazards_md, ppe_md, tools_md, ai_notes, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      RETURNING *
    `, [
      site || null, clampInt(body.entity_id, null),
      body.task_name || null, body.task_code || null,
      clampInt(body.frequency_months, null), clampInt(body.frequency_months_min, null), clampInt(body.frequency_months_max, null),
      body.last_control ? toISODate(body.last_control) : null,
      next_control,
      body.status || 'Planned',
      body.value_type || 'checklist',
      body.result_schema ? JSON.stringify(body.result_schema) : null,
      body.procedure_md || null, body.hazards_md || null, body.ppe_md || null, body.tools_md || null,
      body.ai_notes ? JSON.stringify(body.ai_notes) : null,
      body.created_by || null
    ]);
    res.json(out.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ---------------- Seed helpers ---------------- */
app.get('/api/controls/init-from-pdf', async (req, res) => {
  try {
    const site = siteOf(req);
    console.log('Starting init-from-pdf with site:', site);

    // Charger les devices et switchboards existants
    const devices = (await pool.query(`
      SELECT id, name, switchboard_id, site FROM devices WHERE site = $1
    `, [site])).rows;
    const switchboards = (await pool.query(`
      SELECT id, name, building_code FROM switchboards WHERE site = $1
    `, [site])).rows;

    // Mapper PDF tasks aux devices/switchboards
    const pdfTasks = [
      { equipment_type: 'High Voltage Switchgear (>1000 V ac)', task_name: 'Visual Inspection', freq_min: 3, freq_max: 3, procedure_md: 'Check for noises, smells, heat.', hazards_md: 'Arc flash', ppe_md: 'Arc-rated PPE', tools_md: 'None', value_type: 'checklist', result_schema: [{key: 'No abnormality', type: 'boolean'}] },
      { equipment_type: 'Earthing Systems', task_name: 'Earth Electrode Resistance', freq_min: 12, freq_max: 60, procedure_md: 'Test resistance with disconnection.', hazards_md: 'Shock risk', ppe_md: 'Gloves', tools_md: 'Ohmmeter', value_type: 'numeric', result_schema: [{key: 'Resistance (Ω)', type: 'number'}] },
      // Ajoute d'autres tâches du PDF ici, en limitant pour test
    ];

    const entities = [];
    devices.forEach((d, index) => {
      const sb = switchboards.find(s => s.id === d.switchboard_id) || switchboards[0];
      entities.push({
        site,
        device_id: d.id,
        switchboard_id: sb.id,
        name: d.name,
        equipment_type: pdfTasks[index % pdfTasks.length]?.equipment_type || 'Unknown',
        building: sb.building_code || 'Default Bldg'
      });
    });

    const createdEntities = [];
    for (const e of entities) {
      try {
        const out = await pool.query(`
          INSERT INTO controls_entities (site, device_id, switchboard_id, name, equipment_type, building)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (device_id, switchboard_id, site) DO NOTHING
          RETURNING *
        `, [e.site, e.device_id, e.switchboard_id, e.name, e.equipment_type, e.building]);
        if (out.rows[0]) createdEntities.push(out.rows[0]);
      } catch (e) {
        console.error('Entity insertion error:', e.message, e.stack, 'Data:', e);
        throw e;
      }
    }

    const tasks = [];
    createdEntities.forEach((e, index) => {
      const task = pdfTasks[index % pdfTasks.length];
      if (task) {
        tasks.push({
          entity_id: e.id,
          task_name: task.task_name,
          frequency_months_min: task.freq_min,
          frequency_months_max: task.freq_max,
          procedure_md: task.procedure_md,
          hazards_md: task.hazards_md,
          ppe_md: task.ppe_md,
          tools_md: task.tools_md,
          value_type: task.value_type,
          result_schema: task.result_schema
        });
      }
    });

    const createdTasks = [];
    for (const t of tasks) {
      try {
        const next_control = computeNextControl({ frequency_months_min: t.frequency_months_min, frequency_months_max: t.frequency_months_max });
        const out = await pool.query(`
          INSERT INTO controls_tasks (site, entity_id, task_name, frequency_months_min, frequency_months_max, next_control, procedure_md, hazards_md, ppe_md, tools_md, value_type, result_schema)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `, [site, t.entity_id, t.task_name, t.frequency_months_min, t.frequency_months_max, next_control, t.procedure_md, t.hazards_md, t.ppe_md, t.tools_md, t.value_type, JSON.stringify(t.result_schema)]);
        if (out.rows[0]) createdTasks.push(out.rows[0]);
      } catch (e) {
        console.error('Task insertion error:', e.message, e.stack, 'Data:', t);
        throw e;
      }
    }

    res.json({ ok: true, entities: createdEntities.length, tasks: createdTasks.length });
    console.log('Seed completed:', { entities: createdEntities.length, tasks: createdTasks.length });
  } catch (e) {
    console.error('Init from PDF error:', e.message, e.stack);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

/** ---------------- AI: Photo analysis & Assistant ---------------- */
app.post('/api/controls/ai/analyze', upload.array('photos', 8), async (req, res) => {
  try {
    if (!openai) return res.status(501).json({ error: 'AI not configured' });
    const lang = (req.body?.lang || 'en').toString();
    const taskId = clampInt(req.body.task_id);
    const instructions = `You are a maintenance QA assistant. Extract clear, structured inspection results from photos. 
- Language: ${lang}
- Output a JSON object with keys: status ("Compliant"|"Non-compliant"|"To review"), observations (array of strings), measurements (object of key->value), risks (array), hints (array). Keep it concise.`;

    const images = (req.files || []).map(f => ({
      type: 'image_url',
      image_url: { url: `data:${f.mimetype};base64,${f.buffer.toString('base64')}` }
    }));
    const textPart = { type: 'text', text: instructions };

    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: [textPart, ...images] }]
    });

    let parsed = {};
    try {
      parsed = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
    } catch { parsed = { raw: resp.choices?.[0]?.message?.content || '' }; }

    if (taskId) {
      const history = (await pool.query(`SELECT ai_result FROM controls_records WHERE task_id = $1 ORDER BY performed_at DESC LIMIT 5`, [taskId])).rows.map(r => r.ai_result);
      parsed.history = history;
    }

    res.json({ ok: true, result: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/controls/ai/assistant', async (req, res) => {
  try {
    if (!openai) return res.status(501).json({ error: 'AI not configured' });
    const { query = '', lang = 'en', context = {}, task_id } = req.body || {};
    const sys = `You are an electrical maintenance assistant.
- Always answer in the user language: ${lang}.
- Provide step-by-step instructions, required tools, safety/LV-HV/LOTO precautions, and a short checklist.
- If the task has a periodicity range (e.g., 3–8 years) ALWAYS plan the next date using the longest interval.
- If no equipment is linked, help the user link the task to a building/zone.`;

    let extraContext = '';
    if (task_id) {
      const task = (await pool.query(`SELECT ai_notes FROM controls_tasks WHERE id = $1`, [task_id])).rows[0];
      extraContext = `\nHistorical notes: ${JSON.stringify(task?.ai_notes || {})}`;
    }

    const msg = [
      { role: 'system', content: sys },
      { role: 'user', content: String(query || 'Help') + '\nContext:' + JSON.stringify(context) + extraContext }
    ];
    const r = await openai.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: msg });
    res.json({ response: r.choices?.[0]?.message?.content || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ---------------- Start ---------------- */
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] server listening on :${port}`));
