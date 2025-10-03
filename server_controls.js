// server_controls.js — Controls: TSD-ready, attachments, generate, sync, filters
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import pg from 'pg';
import OpenAI from 'openai';
import { TSD_LIBRARY, EQUIPMENT_TYPES } from './tsd_library.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// ---------------- CORS (utile si front sur un autre port/domaine) ----------------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site,User');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------------- Upload ----------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 }
});

// ---------------- Utils ----------------
function todayISO() { return new Date().toISOString().slice(0,10); }
function addMonths(dateStr, months) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0,10);
}
function isDue(last, freqMonths) {
  if (!last) return true;
  const next = addMonths(last, freqMonths);
  return new Date(next) <= new Date();
}
function log(...args) { if (process.env.CONTROLS_LOG !== '0') console.log('[controls]', ...args); }

// =====================================================================================
// SCHEMA
// =====================================================================================
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_entities (
      id SERIAL PRIMARY KEY,
      site TEXT DEFAULT 'Default',
      building TEXT,
      equipment_type TEXT,
      name TEXT,
      code TEXT,
      done JSONB DEFAULT '{}'::jsonb,   -- { "<task_code>": "YYYY-MM-DD", ... }
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
      site TEXT DEFAULT 'Default',
      entity_id INTEGER REFERENCES controls_entities(id) ON DELETE CASCADE,
      task_name TEXT,
      task_code TEXT,
      frequency_months INTEGER,
      last_control DATE,
      next_control DATE,
      status TEXT DEFAULT 'Planned',  -- Planned | Completed | Overdue
      value_type TEXT DEFAULT 'checklist',
      result_schema JSONB,            -- { field, type, unit, comparator, threshold }
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

  // tables minimales pour la synchro (si tu t'en sers)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controls_sync_sources (
      id SERIAL PRIMARY KEY,
      source TEXT,     -- 'SWITCHBOARD' | 'HV' | 'ATEX' | ...
      site TEXT,
      payload JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  log('[CONTROLS SCHEMA] Ready');
}
await ensureSchema().catch(e => console.error('[CONTROLS SCHEMA] Init error:', e.message));

// =====================================================================================
// LIBRARY (indispensable pour le front)
// =====================================================================================
app.get('/api/controls/library', (_req, res) => {
  res.json({ types: EQUIPMENT_TYPES, library: TSD_LIBRARY });
});

// =====================================================================================
// CATALOG (entities)
// =====================================================================================
app.get('/api/controls/catalog', async (req, res) => {
  const { site = 'Default', building, type, q } = req.query;
  let query = `SELECT * FROM controls_entities WHERE site = $1`;
  const values = [site];
  let i = 2;
  if (building) { query += ` AND building = $${i++}`; values.push(building); }
  if (type) { query += ` AND equipment_type = $${i++}`; values.push(type); }
  if (q) { query += ` AND (name ILIKE $${i} OR code ILIKE $${i})`; values.push(`%${q}%`); i++; }
  query += ' ORDER BY id DESC';
  const { rows } = await pool.query(query, values);
  res.json({ data: rows, types: EQUIPMENT_TYPES, buildings: ['92','B06','B11','B12','B20'] });
});

app.post('/api/controls/catalog', async (req, res) => {
  const { site = 'Default', building, equipment_type, name, code } = req.body || {};
  if (!building || !equipment_type || !name) return res.status(400).json({ error: 'Champs manquants' });
  if (!EQUIPMENT_TYPES.includes(equipment_type)) return res.status(400).json({ error: 'Type d’équipement inconnu' });
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

// =====================================================================================
// TASKS — génération, listing, détails, completion
// =====================================================================================
async function ensureOverdueFlags() {
  await pool.query(`UPDATE controls_tasks SET status = 'Overdue' WHERE status = 'Planned' AND next_control < CURRENT_DATE`);
}

function tsdItemFor(type, code) {
  return (TSD_LIBRARY[type] || []).find(i => i.id === code) || null;
}

async function regenerateTasks(site = 'Default') {
  // pour chaque entity → pour chaque item TSD → créer une tâche si due
  const { rows: entities } = await pool.query('SELECT * FROM controls_entities WHERE site = $1', [site]);
  let created = 0;
  for (const e of entities) {
    const items = TSD_LIBRARY[e.equipment_type] || [];
    const done = e.done || {};
    for (const it of items) {
      const last = done[it.id] || null;
      if (isDue(last, it.frequency_months)) {
        const { rows: exists } = await pool.query(
          `SELECT id FROM controls_tasks 
           WHERE site=$1 AND entity_id=$2 AND task_code=$3 AND status IN ('Planned','Overdue') LIMIT 1`,
          [site, e.id, it.id]
        );
        if (exists.length === 0) {
          await pool.query(
            `INSERT INTO controls_tasks (
              site, entity_id, task_name, task_code, frequency_months, last_control, next_control, status,
              value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Planned',$8,$9,$10,$11,$12,$13,$14)`,
            [
              site, e.id, `${e.name} • ${it.label}`, it.id, it.frequency_months,
              null, todayISO(),
              'checklist',
              JSON.stringify({ field: it.field, type: it.type, unit: it.unit, comparator: it.comparator, threshold: it.threshold }),
              it.procedure_md || '', it.hazards_md || '', it.ppe_md || '', it.tools_md || '',
              'system'
            ]
          );
          created++;
        }
      }
    }
  }
  await ensureOverdueFlags();
  return created;
}

app.post('/api/controls/generate', async (req, res) => {
  try {
    const site = req.body?.site || 'Default';
    const created = await regenerateTasks(site);
    res.json({ created });
  } catch (e) {
    log('generate error:', e.message);
    res.status(500).json({ error: 'Erreur génération', details: e.message });
  }
});

app.get('/api/controls/tasks', async (req, res) => {
  try {
    const { site = 'Default', building, type, status, q, page = 1, pageSize = 50 } = req.query;
    await ensureOverdueFlags();

    let query = `
      SELECT ct.*, ce.equipment_type, ce.building, ce.name AS entity_name
      FROM controls_tasks ct
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id
      WHERE ct.site = $1`;
    const values = [site];
    let i = 2;

    if (building) { query += ` AND ce.building = $${i++}`; values.push(building); }
    if (type) { query += ` AND ce.equipment_type = $${i++}`; values.push(type); }
    if (status) { query += ` AND ct.status = $${i++}`; values.push(status); }
    if (q) { query += ` AND (ct.task_name ILIKE $${i} OR ct.task_code ILIKE $${i})`; values.push(`%${q}%`); i++; }

    query += ` ORDER BY ct.next_control ASC NULLS LAST, ct.id DESC LIMIT $${i} OFFSET $${i + 1}`;
    values.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

    const { rows } = await pool.query(query, values);
    const { rows: totalRows } = await pool.query('SELECT COUNT(*) FROM controls_tasks WHERE site = $1', [site]);

    res.json({ data: rows, total: Number(totalRows?.[0]?.count || 0) });
  } catch (e) {
    log('tasks list error:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.get('/api/controls/tasks/:id/details', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: task } = await pool.query('SELECT * FROM controls_tasks WHERE id = $1', [id]);
    if (task.length === 0) return res.status(404).json({ error: 'Tâche non trouvée' });
    const t = task[0];
    const { rows: equip } = await pool.query('SELECT * FROM controls_entities WHERE id = $1', [t.entity_id]);
    const equipment_type = equip[0]?.equipment_type || 'UNKNOWN';
    const item = tsdItemFor(equipment_type, t.task_code);
    res.json({ ...t, equipment: equip[0] || null, tsd_item: item });
  } catch (e) {
    log('task details error:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.post('/api/controls/tasks/:id/complete', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: task } = await pool.query('SELECT * FROM controls_tasks WHERE id = $1', [id]);
    if (task.length === 0) return res.status(404).json({ error: 'Tâche non trouvée' });
    const t = task[0];

    const user = req.body?.user || 'unknown';
    const results = req.body?.results || {};
    const ai_risk_score = Number(req.body?.ai_risk_score) || null;

    // verdict simple (règles TSD)
    const { rows: entity } = await pool.query('SELECT equipment_type FROM controls_entities WHERE id = $1', [t.entity_id]);
    const equipment_type = entity[0]?.equipment_type || 'UNKNOWN';
    const item = tsdItemFor(equipment_type, t.task_code);

    let verdict = { status: 'To Verify', detail: 'No TSD rule' };
    if (item) {
      const v = results?.[item.field];
      if (item.type === 'check') {
        verdict = { status: v === true ? 'Compliant' : 'Non Compliant', detail: v === true ? 'OK' : 'Not checked' };
      } else if (item.type === 'number') {
        const num = Number(v);
        if (!isNaN(num)) {
          const thr = Number(item.threshold);
          const cmp = item.comparator || '<=';
          const ok =
            (cmp === '<=' && num <= thr) ||
            (cmp === '>=' && num >= thr) ||
            (cmp === '<' && num < thr) ||
            (cmp === '>' && num > thr) ||
            (cmp === '==' && num === thr);
          verdict = { status: ok ? 'Compliant' : 'Non Compliant', detail: `${num} ${item.unit || ''} vs ${cmp} ${thr}` };
        } else {
          verdict = { status: 'To Verify', detail: 'Missing numerical value' };
        }
      }
      // Si score IA fourni et élevé → forcer To Verify (jamais auto-valider)
      const RISK_THRESHOLD = Number(process.env.AI_RISK_THRESHOLD || 0.7);
      if (ai_risk_score != null && ai_risk_score >= RISK_THRESHOLD && verdict.status === 'Compliant') {
        verdict = { status: 'To Verify', detail: `AI risk ${ai_risk_score} ≥ ${RISK_THRESHOLD}` };
      }
    }

    await pool.query(
      `UPDATE controls_tasks SET 
        status = 'Completed',
        last_control = CURRENT_DATE,
        results = $1,
        ai_notes = ai_notes || $2::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3`,
      [JSON.stringify({ ...results, verdict }), JSON.stringify([{ score: ai_risk_score, ts: new Date().toISOString() }]), id]
    );

    // Marquer "fait" dans l'entité
    if (item) {
      await pool.query(
        'UPDATE controls_entities SET done = done || jsonb_build_object($1, $2) WHERE id = $3',
        [t.task_code, todayISO(), t.entity_id]
      );
    }

    // Historique
    await pool.query('INSERT INTO controls_history (task_id, "user", results) VALUES ($1, $2, $3)', [id, user, JSON.stringify(results)]);

    res.json({ success: true });
  } catch (e) {
    log('complete error:', e.message);
    res.status(500).json({ error: 'Erreur completion', details: e.message });
  }
});

// =====================================================================================
// ATTACHMENTS
// =====================================================================================
app.post('/api/controls/tasks/:id/upload', upload.array('files', 12), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: task } = await pool.query('SELECT id,status FROM controls_tasks WHERE id = $1', [id]);
    if (!task.length) return res.status(404).json({ error: 'Tâche non trouvée' });
    if (task[0].status === 'Completed') return res.status(400).json({ error: 'Tâche déjà complétée' });
    const files = req.files || [];
    for (const f of files) {
      await pool.query(
        'INSERT INTO controls_attachments (task_id, filename, size, mimetype, data) VALUES ($1,$2,$3,$4,$5)',
        [id, f.originalname, f.size, f.mimetype, f.buffer]
      );
    }
    res.json({ uploaded: files.length });
  } catch (e) {
    log('upload error:', e.message);
    res.status(500).json({ error: 'Erreur upload', details: e.message });
  }
});

app.get('/api/controls/tasks/:id/attachments', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      'SELECT id, filename, size, mimetype, uploaded_at FROM controls_attachments WHERE task_id=$1 ORDER BY uploaded_at DESC',
      [id]
    );
    res.json(rows);
  } catch (e) {
    log('attachments list error:', e.message);
    res.status(500).json({ error: 'Erreur liste pièces jointes', details: e.message });
  }
});

app.get('/api/controls/tasks/:id/attachments/:attId', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const attId = Number(req.params.attId);
    const { rows } = await pool.query('SELECT * FROM controls_attachments WHERE id=$1 AND task_id=$2', [attId, taskId]);
    if (!rows.length) return res.status(404).json({ error: 'Pièce jointe non trouvée' });
    const att = rows[0];
    res.setHeader('Content-Type', att.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
    res.send(att.data);
  } catch (e) {
    log('attachment get error:', e.message);
    res.status(500).json({ error: 'Erreur téléchargement', details: e.message });
  }
});

app.delete('/api/controls/attachments/:taskId/:attId', async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const attId = Number(req.params.attId);
    const { rowCount } = await pool.query('DELETE FROM controls_attachments WHERE id=$1 AND task_id=$2', [attId, taskId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Pièce jointe non trouvée' });
    res.json({ success: true });
  } catch (e) {
    log('attachment delete error:', e.message);
    res.status(500).json({ error: 'Erreur suppression PJ', details: e.message });
  }
});

// =====================================================================================
// NOT PRESENT
// =====================================================================================
app.get('/api/controls/not-present', async (req, res) => {
  try {
    const { site = 'Default', building } = req.query;
    let query = 'SELECT * FROM controls_not_present WHERE site = $1';
    const values = [site];
    if (building) { query += ' AND building = $2'; values.push(building); }
    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (e) {
    log('not present list error:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.post('/api/controls/not-present', async (req, res) => {
  try {
    const { site = 'Default', building, equipment_type, declared_by, note } = req.body || {};
    if (!building || !equipment_type) return res.status(400).json({ error: 'Missing fields' });
    if (!EQUIPMENT_TYPES.includes(equipment_type)) return res.status(400).json({ error: 'Unknown equipment_type' });
    const { rows: exists } = await pool.query(
      'SELECT id FROM controls_not_present WHERE site=$1 AND building=$2 AND equipment_type=$3',
      [site, building, equipment_type]
    );
    if (exists.length > 0) return res.status(409).json({ error: 'Already declared' });
    const { rows } = await pool.query(
      'INSERT INTO controls_not_present (site, building, equipment_type, declared_by, note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [site, building, equipment_type, declared_by || 'unknown', note || '']
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    log('not present create error:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// =====================================================================================
// HISTORY & RECORDS
// =====================================================================================
app.get('/api/controls/history', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ch.*, ct.task_name 
     FROM controls_history ch 
     LEFT JOIN controls_tasks ct ON ch.task_id = ct.id 
     ORDER BY ch.date DESC LIMIT 200`
  );
  res.json(rows);
});

app.get('/api/controls/records', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM controls_records ORDER BY created_at DESC');
  res.json(rows);
});

// =====================================================================================
// SYNC (optionnel) — si tu as des services Switchboard/HV/ATEX
// =====================================================================================
const SWITCHBOARD_URL = process.env.SWITCHBOARD_URL || process.env.SWITCHBOARD_BASE_URL || '';
const HV_URL         = process.env.HV_URL || process.env.HV_BASE_URL || '';
const ATEX_URL       = process.env.ATEX_URL || process.env.ATEX_BASE_URL || '';

async function safeFetchJson(url) {
  try {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    log('fetch error:', url, e.message);
    return null;
  }
}

async function loadSwitchboards(site='Default') {
  if (!SWITCHBOARD_URL) return [];
  const data = await safeFetchJson(`${SWITCHBOARD_URL}/api/switchboard/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data.map(sb => ({
    site, building: sb.building_code || 'B06',
    equipment_type: sb.is_principal ? 'LV_SWITCHGEAR' : 'DISTRIBUTION_BOARD',
    name: sb.name || `Board-${sb.id}`,
    code: sb.code || `SB-${sb.id}`
  }));
}
async function loadHV(site='Default') {
  if (!HV_URL) return [];
  const data = await safeFetchJson(`${HV_URL}/api/hv/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data.map(hv => ({
    site, building: hv.building_code || '92',
    equipment_type: 'HV_SWITCHGEAR',
    name: hv.name || `HV-${hv.id}`,
    code: hv.code || `HV-${hv.id}`
  }));
}
async function loadATEX(site='Default') {
  if (!ATEX_URL) return [];
  const data = await safeFetchJson(`${ATEX_URL}/api/atex/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data.map(ax => ({
    site, building: ax.building || 'B11',
    equipment_type: 'ATEX_EQUIPMENT',
    name: ax.component_type || `ATEX-${ax.id}`,
    code: ax.manufacturer_ref || `ATEX-${ax.id}`
  }));
}

app.post('/api/controls/sync', async (req, res) => {
  try {
    const site = req.body?.site || 'Default';
    const incoming = [
      ...(await loadSwitchboards(site)),
      ...(await loadHV(site)),
      ...(await loadATEX(site)),
    ];
    let added = 0, updated = 0;
    for (const inc of incoming) {
      if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) continue;
      const { rows: exist } = await pool.query(
        `SELECT * FROM controls_entities WHERE site=$1 AND equipment_type=$2 AND code = $3`,
        [inc.site, inc.equipment_type, inc.code || null]
      );
      if (exist.length === 0) {
        await pool.query(
          'INSERT INTO controls_entities (site, building, equipment_type, name, code) VALUES ($1,$2,$3,$4,$5)',
          [inc.site, inc.building, inc.equipment_type, inc.name, inc.code || null]
        );
        added++;
      } else {
        const prev = exist[0];
        if (prev.name !== inc.name || prev.building !== inc.building) {
          await pool.query('UPDATE controls_entities SET building=$1, name=$2 WHERE id=$3', [inc.building, inc.name, prev.id]);
          updated++;
        }
      }
    }
    const created = await regenerateTasks(site);
    res.json({ synced: { total: incoming.length, added, updated }, tasks_created: created });
  } catch (e) {
    log('sync error:', e.message);
    res.status(500).json({ error: 'Erreur sync', details: e.message });
  }
});

// =====================================================================================
// HEALTH
// =====================================================================================
app.get('/api/controls/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// =====================================================================================
// START
// =====================================================================================
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
