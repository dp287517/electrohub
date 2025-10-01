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
  return (req.header('X-Site') || req.query.site || req.body?.site || '').toString();
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
  // correct month rollover
  if (d.getDate() < day) d.setDate(0);
  return toISODate(d);
}
function todayISO() { return toISODate(new Date()); }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr);
  const now = new Date();
  return Math.ceil((t - now) / (1000 * 60 * 60 * 24));
}
function bool(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' ? true : s === 'false' || s === '0' ? false : null;
}

/** Compute next_control using rule: when a range exists (min..max), ALWAYS use the farthest (max) */
function computeNextControl({ last_control, frequency_months, frequency_months_min, frequency_months_max }) {
  const base = last_control || todayISO();
  const months = clampInt(frequency_months_max, null) ?? clampInt(frequency_months, null) ?? clampInt(frequency_months_min, null);
  return months ? addMonths(base, months) : todayISO(); // Fallback to today if null to avoid errors
}

/** ---------------- Schema ---------------- */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_entities (
      id SERIAL PRIMARY KEY,
      site TEXT,
      module TEXT,
      building TEXT,
      zone TEXT,
      room TEXT,
      name TEXT,
      equipment_type TEXT,
      equipment_ref TEXT,
      related_type TEXT,
      related_id INTEGER,
      criticality TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_controls_entities_site ON controls_entities(site);
    CREATE INDEX IF NOT EXISTS idx_controls_entities_building ON controls_entities(building);

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

    -- Integrate with existing tables if exist
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'switchboards') THEN
        CREATE TABLE switchboards (
          id SERIAL PRIMARY KEY,
          site TEXT,
          name TEXT,
          building_code TEXT
        );
      END IF;
    END $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'devices') THEN
        CREATE TABLE devices (
          id SERIAL PRIMARY KEY,
          site TEXT,
          switchboard_id INTEGER REFERENCES switchboards(id),
          name TEXT
        );
      END IF;
    END $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'atex_equipments') THEN
        CREATE TABLE atex_equipments (
          id SERIAL PRIMARY KEY,
          site TEXT,
          name TEXT
        );
      END IF;
    END $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'hv_equipments') THEN
        CREATE TABLE hv_equipments (
          id SERIAL PRIMARY KEY,
          site TEXT,
          name TEXT
        );
      END IF;
    END $$;

    -- Add columns to link
    DO $$ BEGIN
      ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS switchboard_id INTEGER;
      ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS device_id INTEGER;
      ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS atex_id INTEGER;
      ALTER TABLE controls_entities ADD COLUMN IF NOT EXISTS hv_id INTEGER;
    END $$;
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
    const { q = '', building = '', room = '', equipment_type = '', module = '', sort = 'id', dir = 'desc', page = '1', pageSize = '100' } = req.query;
    const safeSort = ['id','name','building','room','equipment_type','created_at','updated_at'].includes(String(sort)) ? sort : 'id';
    const safeDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const p = clampInt(page, 1);
    const ps = Math.min(clampInt(pageSize, 100), 500);

    const params = [];
    let where = 'WHERE 1=1';
    if (site) { params.push(site); where += ` AND site = $${params.length}`; }
    if (building) { params.push(building); where += ` AND building = $${params.length}`; }
    if (room) { params.push(room); where += ` AND room = $${params.length}`; }
    if (equipment_type) { params.push(equipment_type); where += ` AND equipment_type = $${params.length}`; }
    if (module) { params.push(module); where += ` AND module = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND (name ILIKE $${params.length} OR equipment_ref ILIKE $${params.length} OR building ILIKE $${params.length})`; }

    params.push(ps);
    params.push((p - 1) * ps);

    const sql = `
      SELECT * FROM controls_entities
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
    const {
      name, module, building, zone, room, equipment_type, equipment_ref,
      related_type, related_id, criticality
    } = req.body || {};
    const out = await pool.query(`
      INSERT INTO controls_entities (site, name, module, building, zone, room, equipment_type, equipment_ref, related_type, related_id, criticality)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [site || null, name || null, module || null, building || null, zone || null, room || null, equipment_type || null, equipment_ref || null, related_type || null, related_id || null, criticality || null]);
    res.json(out.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/controls/entities/:id', async (req, res) => {
  try {
    const id = clampInt(req.params.id);
    const {
      name, module, building, zone, room, equipment_type, equipment_ref,
      related_type, related_id, criticality
    } = req.body || {};
    const out = await pool.query(`
      UPDATE controls_entities SET
        name = $1, module = $2, building = $3, zone = $4, room = $5,
        equipment_type = $6, equipment_ref = $7, related_type = $8, related_id = $9, criticality = $10,
        updated_at = now()
      WHERE id = $11
      RETURNING *
    `, [name || null, module || null, building || null, zone || null, room || null, equipment_type || null, equipment_ref || null, related_type || null, related_id || null, criticality || null, id]);
    res.json(out.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/controls/entities/:id', async (req, res) => {
  try {
    const id = clampInt(req.params.id);
    await pool.query(`DELETE FROM controls_entities WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ---------------- Tasks CRUD ---------------- */
app.get('/api/controls/tasks', async (req, res) => {
  try {
    const site = siteOf(req);
    const { entity_id, building = '', status = '', q = '', sort = 'next_control', dir = 'asc', page = '1', pageSize = '200' } = req.query;
    const safeSort = ['id','task_name','next_control','last_control','status','created_at'].includes(String(sort)) ? sort : 'next_control';
    const safeDir = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const p = clampInt(page, 1);
    const ps = Math.min(clampInt(pageSize, 200), 1000);

    const params = [];
    let where = 'WHERE 1=1';
    if (site) { params.push(site); where += ` AND t.site = $${params.length}`; }
    if (entity_id) { params.push(clampInt(entity_id)); where += ` AND t.entity_id = $${params.length}`; }
    if (building) { params.push(building); where += ` AND e.building = $${params.length}`; }
    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND (t.task_name ILIKE $${params.length} OR e.name ILIKE $${params.length})`; }

    params.push(ps);
    params.push((p - 1) * ps);

    const sql = `
      SELECT t.*, e.name as entity_name, e.building, e.room, e.equipment_type
      FROM controls_tasks t
      LEFT JOIN controls_entities e ON e.id = t.entity_id
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

app.put('/api/controls/tasks/:id', async (req, res) => {
  try {
    const id = clampInt(req.params.id);
    const body = req.body || {};
    const next_control = ('frequency_months' in body || 'frequency_months_min' in body || 'frequency_months_max' in body || 'last_control' in body)
      ? computeNextControl({
          last_control: body.last_control,
          frequency_months: body.frequency_months,
          frequency_months_min: body.frequency_months_min,
          frequency_months_max: body.frequency_months_max
        })
      : undefined;

    const out = await pool.query(`
      UPDATE controls_tasks SET
        entity_id = COALESCE($1, entity_id),
        task_name = COALESCE($2, task_name),
        task_code = COALESCE($3, task_code),
        frequency_months = COALESCE($4, frequency_months),
        frequency_months_min = COALESCE($5, frequency_months_min),
        frequency_months_max = COALESCE($6, frequency_months_max),
        last_control = COALESCE($7, last_control),
        next_control = COALESCE($8, next_control),
        status = COALESCE($9, status),
        value_type = COALESCE($10, value_type),
        result_schema = COALESCE($11, result_schema),
        procedure_md = COALESCE($12, procedure_md),
        hazards_md = COALESCE($13, hazards_md),
        ppe_md = COALESCE($14, ppe_md),
        tools_md = COALESCE($15, tools_md),
        ai_notes = COALESCE($16, ai_notes),
        updated_at = now()
      WHERE id = $17
      RETURNING *
    `, [
      clampInt(body.entity_id, null), body.task_name || null, body.task_code || null,
      clampInt(body.frequency_months, null), clampInt(body.frequency_months_min, null), clampInt(body.frequency_months_max, null),
      body.last_control ? toISODate(body.last_control) : null,
      next_control !== undefined ? next_control : null,
      body.status || null, body.value_type || null,
      body.result_schema ? JSON.stringify(body.result_schema) : null,
      body.procedure_md || null, body.hazards_md || null, body.ppe_md || null, body.tools_md || null,
      body.ai_notes ? JSON.stringify(body.ai_notes) : null, id
    ]);
    res.json(out.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/controls/tasks/:id', async (req, res) => {
  try {
    const id = clampInt(req.params.id);
    await pool.query(`DELETE FROM controls_tasks WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ---------------- Records (executions) ---------------- */
app.get('/api/controls/tasks/:id/records', async (req, res) => {
  try {
    const id = clampInt(req.params.id);
    const rows = (await pool.query(`SELECT * FROM controls_records WHERE task_id = $1 ORDER BY performed_at DESC`, [id])).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/controls/tasks/:id/records', upload.array('photos', 8), async (req, res) => {
  try {
    const taskId = clampInt(req.params.id);
    const site = siteOf(req);
    const {
      performed_at, performed_by, lang, result_status, numeric_value, text_value,
      checklist_result, comments
    } = req.body || {};

    // Insert record
    const rec = (await pool.query(`
      INSERT INTO controls_records (site, task_id, performed_at, performed_by, lang, result_status, numeric_value, text_value, checklist_result, comments)
      VALUES ($1,$2,COALESCE($3, now()),$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      site || null, taskId,
      performed_at || null, performed_by || null, lang || null,
      result_status || null, numeric_value !== undefined ? Number(numeric_value) : null, text_value || null,
      checklist_result ? JSON.stringify(JSON.parse(checklist_result)) : null,
      comments || null
    ])).rows[0];

    // Save photos as attachments
    for (const f of (req.files || [])) {
      await pool.query(`
        INSERT INTO controls_attachments (site, record_id, task_id, filename, mime, content)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [site || null, rec.id, taskId, f.originalname, f.mimetype, f.buffer]);
    }

    // Update task last/next control if necessary
    const task = (await pool.query(`SELECT * FROM controls_tasks WHERE id = $1`, [taskId])).rows[0];
    const next = computeNextControl(task);
    await pool.query(`UPDATE controls_tasks SET last_control = $1, next_control = $2, status = $3, updated_at = now() WHERE id = $4`,
      [toISODate(rec.performed_at), next, result_status || task.status, taskId]);

    res.json(rec);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ---------------- Attachments ---------------- */
app.get('/api/controls/tasks/:id/attachments', async (req, res) => {
  try {
    const taskId = clampInt(req.params.id);
    const rows = (await pool.query(`
      SELECT id, filename, mime, created_at FROM controls_attachments WHERE task_id = $1 ORDER BY created_at DESC
    `, [taskId])).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/controls/tasks/:id/attachments', upload.array('files', 12), async (req, res) => {
  try {
    const taskId = clampInt(req.params.id);
    const site = siteOf(req);
    for (const f of (req.files || [])) {
      await pool.query(`
        INSERT INTO controls_attachments (site, task_id, filename, mime, content) VALUES ($1,$2,$3,$4,$5)
      `, [site || null, taskId, f.originalname, f.mimetype, f.buffer]);
    }
    res.json({ ok: true, uploaded: (req.files || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/controls/attachments/:id/download', async (req, res) => {
  try {
    const id = clampInt(req.params.id);
    const row = (await pool.query(`SELECT * FROM controls_attachments WHERE id = $1`, [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename || 'file'}"`);
    res.send(row.content);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/controls/attachments/:id', async (req, res) => {
  try {
    const id = clampInt(req.params.id);
    await pool.query(`DELETE FROM controls_attachments WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** ---------------- Analytics + Roadmap ---------------- */
app.get('/api/controls/analytics', async (req, res) => {
  try {
    const site = siteOf(req);
    const now = todayISO();
    const params = [];
    let where = 'WHERE 1=1';
    if (site) { params.push(site); where += ` AND t.site = $${params.length}`; }

    const total = (await pool.query(`SELECT COUNT(*)::int as c FROM controls_tasks t ${where}`, params)).rows[0]?.c || 0;
    const overdue = (await pool.query(`SELECT COUNT(*)::int as c FROM controls_tasks t ${where} AND t.next_control < $${params.length+1}`, [...params, now])).rows[0]?.c || 0;
    const due_90 = (await pool.query(`SELECT COUNT(*)::int as c FROM controls_tasks t ${where} AND t.next_control BETWEEN $${params.length+1} AND $${params.length+2}`, [...params, now, toISODate(addMonths(now, 3))])).rows[0]?.c || 0;
    const future = Math.max(0, total - overdue - due_90);

    const byBuilding = (await pool.query(`
      SELECT e.building, COUNT(*)::int AS count
      FROM controls_tasks t
      LEFT JOIN controls_entities e ON e.id = t.entity_id
      ${where}
      GROUP BY e.building
      ORDER BY count DESC
      LIMIT 10
    `, params)).rows;

    res.json({
      generatedAt: new Date().toISOString(),
      stats: { total, overdue, due_90_days: due_90, future },
      byBuilding
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/controls/gantt-data', async (req, res) => {
  try {
    const site = siteOf(req);
    const { building = '' } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (site) { params.push(site); where += ` AND t.site = $${params.length}`; }
    if (building) { params.push(building); where += ` AND e.building = $${params.length}`; }

    const rows = (await pool.query(`
      SELECT t.id, t.task_name, t.last_control, t.next_control, e.building, e.name as entity_name
      FROM controls_tasks t
      LEFT JOIN controls_entities e ON e.id = t.entity_id
      ${where}
      ORDER BY t.next_control ASC NULLS LAST
      LIMIT 1000
    `, params)).rows;

    const tasks = rows.map(r => ({
      id: String(r.id),
      name: `${r.entity_name || 'Entity'} · ${r.task_name}`,
      building: r.building || '—',
      start: r.last_control || todayISO(), // Fallback
      end: r.next_control || addMonths(todayISO(), 12), // Fallback
      progress: r.last_control ? 100 : 0
    }));
    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ---------------- Suggests + Export ---------------- */
app.get('/api/controls/suggests', async (req, res) => {
  try {
    const site = siteOf(req);
    const params = [];
    let where = 'WHERE 1=1';
    if (site) { params.push(site); where += ` AND site = $${params.length}`; }
    const buildings = (await pool.query(`SELECT DISTINCT building FROM controls_entities ${where} ORDER BY building ASC`, params)).rows.map(r => r.building).filter(Boolean);
    const rooms     = (await pool.query(`SELECT DISTINCT room FROM controls_entities ${where} ORDER BY room ASC`, params)).rows.map(r => r.room).filter(Boolean);
    const modules   = (await pool.query(`SELECT DISTINCT module FROM controls_entities ${where} ORDER BY module ASC`, params)).rows.map(r => r.module).filter(Boolean);
    const types     = (await pool.query(`SELECT DISTINCT equipment_type FROM controls_entities ${where} ORDER BY equipment_type ASC`, params)).rows.map(r => r.equipment_type).filter(Boolean);
    res.json({ building: buildings, room: rooms, module: modules, equipment_type: types });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/controls/export', async (req, res) => {
  try {
    const site = siteOf(req);
    const rows = (await pool.query(`
      SELECT 
        e.id as entity_id, e.site, e.building, e.room, e.name as entity, e.equipment_type, e.equipment_ref,
        t.id as task_id, t.task_name, t.task_code, t.frequency_months, t.frequency_months_min, t.frequency_months_max,
        t.last_control, t.next_control, t.status, t.value_type
      FROM controls_entities e
      LEFT JOIN controls_tasks t ON t.entity_id = e.id
      WHERE ($1::text IS NULL OR e.site = $1)
      ORDER BY e.id ASC, t.id ASC
    `, [site || null])).rows;
    res.json({
      columns: [
        'entity_id','site','building','room','entity','equipment_type','equipment_ref',
        'task_id','task_name','task_code','frequency_months','frequency_months_min','frequency_months_max',
        'last_control','next_control','status','value_type'
      ],
      data: rows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** ---------------- AI: Photo analysis & Assistant ---------------- */
app.post('/api/controls/ai/analyze', upload.array('photos', 8), async (req, res) => {
  try {
    if (!openai) return res.status(501).json({ error: 'AI not configured' });
    const lang = (req.body?.lang || 'en').toString();
    const taskId = clampInt(req.body.task_id); // Pour contexte historique
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

    // Ajouter historique si taskId
    if (taskId) {
      const history = (await pool.query(`SELECT ai_result FROM controls_records WHERE task_id = $1 ORDER BY performed_at DESC LIMIT 5`, [taskId])).rows.map(r => r.ai_result);
      parsed.history = history; // Pour contexte futur
    }

    res.json({ ok: true, result: parsed });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    // Ajouter contexte historique si task_id
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

/** ---------------- Seed helpers ---------------- */
app.post('/api/controls/seed', async (req, res) => {
  try {
    const site = siteOf(req);
    const { entities = [], tasks = [] } = req.body || {};

    const createdEntities = [];
    for (const e of entities) {
      const out = await pool.query(`
        INSERT INTO controls_entities (site, name, module, building, zone, room, equipment_type, equipment_ref, related_type, related_id, criticality)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING
        RETURNING *
      `, [site || null, e.name || null, e.module || null, e.building || null, e.zone || null, e.room || null, e.equipment_type || null, e.equipment_ref || null, e.related_type || null, e.related_id || null, e.criticality || null]);
      if (out.rows[0]) createdEntities.push(out.rows[0]);
    }

    const createdTasks = [];
    for (const t of tasks) {
      const next = computeNextControl(t);
      const out = await pool.query(`
        INSERT INTO controls_tasks (
          site, entity_id, task_name, task_code,
          frequency_months, frequency_months_min, frequency_months_max,
          last_control, next_control, status, value_type, result_schema,
          procedure_md, hazards_md, ppe_md, tools_md
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING *
      `, [
        site || null, t.entity_id || null, t.task_name || null, t.task_code || null,
        clampInt(t.frequency_months, null), clampInt(t.frequency_months_min, null), clampInt(t.frequency_months_max, null),
        t.last_control ? toISODate(t.last_control) : null, next, t.status || 'Planned', t.value_type || 'checklist',
        t.result_schema ? JSON.stringify(t.result_schema) : null,
        t.procedure_md || null, t.hazards_md || null, t.ppe_md || null, t.tools_md || null
      ]);
      createdTasks.push(out.rows[0]);
    }
    res.json({ ok: true, entities: createdEntities.length, tasks: createdTasks.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** ---------------- Start ---------------- */
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] server listening on :${port}`));
