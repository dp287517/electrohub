// server_controls.js — Refactor complet backend Controls
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

const app = express();
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// ---------- Upload ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 }
});

// ---------- Utils ----------
function todayISO() { return new Date().toISOString().slice(0,10); }
function log(...args) { if (process.env.CONTROLS_LOG !== '0') console.log('[controls]', ...args); }

// ---------- Ensure Schema ----------
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_entities (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      building TEXT,
      equipment_type TEXT,
      name TEXT,
      code TEXT,
      done JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_equipments (
      id SERIAL PRIMARY KEY,
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      manufacturer TEXT,
      model TEXT,
      serial_number TEXT,
      specs JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_tasks (
      id SERIAL PRIMARY KEY,
      site TEXT,
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      task_name TEXT,
      task_code TEXT,
      frequency_months INTEGER,
      next_control DATE,
      status TEXT DEFAULT 'Planned',
      value_type TEXT,
      result_schema JSONB,
      procedure_md TEXT,
      hazards_md TEXT,
      ppe_md TEXT,
      tools_md TEXT,
      results JSONB,
      ai_notes JSONB DEFAULT '[]'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_history (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE CASCADE,
      "user" TEXT,
      results JSONB,
      date TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES controls_tasks(id) ON DELETE CASCADE,
      filename TEXT,
      size INTEGER,
      mimetype TEXT,
      data BYTEA,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_not_present (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      building TEXT,
      equipment_type TEXT,
      declared_by TEXT,
      note TEXT,
      last_assessment_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_records (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      entity_id INTEGER,
      record JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  log('[CONTROLS SCHEMA] Schema ready');
}
ensureSchema().catch(e => console.error('[CONTROLS SCHEMA] Init error:', e.message));


// =====================================================================================
// ROUTES API
// =====================================================================================

// ---- Healthcheck
app.get('/api/controls/health', async (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ---- Catalog
app.get('/api/controls/catalog', async (req, res) => {
  const { site = 'Default' } = req.query;
  const { rows } = await pool.query('SELECT * FROM controls_entities WHERE site = $1', [site]);
  res.json({ data: rows });
});

app.post('/api/controls/catalog', async (req, res) => {
  const { site = 'Default', building, equipment_type, name, code } = req.body || {};
  if (!building || !equipment_type || !name) return res.status(400).json({ error: 'Champs manquants' });
  const { rows } = await pool.query(
    'INSERT INTO controls_entities (site, building, equipment_type, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [site, building, equipment_type, name, code || null]
  );
  res.status(201).json(rows[0]);
});

app.delete('/api/controls/catalog/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM controls_entities WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Non trouvé' });
  res.json({ success: true });
});

// ---- Tasks
app.get('/api/controls/tasks', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM controls_tasks ORDER BY next_control ASC');
  res.json({ data: rows });
});

app.get('/api/controls/tasks/:id/details', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM controls_tasks WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

app.post('/api/controls/tasks/:id/complete', async (req, res) => {
  const id = req.params.id;
  const { results, user = 'unknown' } = req.body;
  await pool.query('UPDATE controls_tasks SET status=$1, results=$2, updated_at=NOW() WHERE id=$3',
    ['Completed', JSON.stringify(results), id]);
  await pool.query('INSERT INTO controls_history (task_id, "user", results) VALUES ($1,$2,$3)',
    [id, user, JSON.stringify(results)]);
  res.json({ success: true });
});

// ---- Attachments
app.post('/api/controls/tasks/:id/upload', upload.array('files', 12), async (req, res) => {
  const id = req.params.id;
  for (const f of req.files) {
    await pool.query(
      'INSERT INTO controls_attachments (task_id, filename, size, mimetype, data) VALUES ($1,$2,$3,$4,$5)',
      [id, f.originalname, f.size, f.mimetype, f.buffer]
    );
  }
  res.json({ uploaded: req.files.length });
});

app.get('/api/controls/tasks/:id/attachments', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, filename, size, mimetype, uploaded_at FROM controls_attachments WHERE task_id=$1',
    [req.params.id]
  );
  res.json(rows);
});

// ---- Not Present
app.get('/api/controls/not-present', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM controls_not_present');
  res.json(rows);
});

app.post('/api/controls/not-present', async (req, res) => {
  const { building, equipment_type, note, declared_by = 'unknown' } = req.body || {};
  if (!building || !equipment_type) return res.status(400).json({ error: 'Missing fields' });
  const { rows } = await pool.query(
    'INSERT INTO controls_not_present (building, equipment_type, note, declared_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [building, equipment_type, note || '', declared_by]
  );
  res.status(201).json(rows[0]);
});

// ---- History
app.get('/api/controls/history', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM controls_history ORDER BY date DESC LIMIT 100');
  res.json(rows);
});

// ---- Records
app.get('/api/controls/records', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM controls_records ORDER BY created_at DESC');
  res.json(rows);
});


// =====================================================================================
// Start server
// =====================================================================================
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
