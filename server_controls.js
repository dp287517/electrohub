// server_controls.js — Controls Full TSD-Ready + External Sync + Scheduler + Vision with OpenAI
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

// OpenAI setup
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.warn('[CONTROLS] No OPENAI_API_KEY found');
}

// ---------------- CORS ----------------
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

// ---------------- Helpers ----------------
function toCSV(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    const needQuotes = /[",\n]/.test(s);
    const body = s.replace(/"/g, '""');
    return needQuotes ? `"${body}"` : body;
  };
  const head = headers.map(esc).join(',');
  const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
  return `${head}\n${body}`;
}

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

function isOverdue(dueISO) {
  if (!dueISO) return false;
  return new Date(dueISO) < new Date(todayISO());
}

function eqKey(equip) { return `${equip.equipment_type}:${equip.id}`; }

function log(...args) { if (process.env.CONTROLS_LOG !== '0') console.log('[controls]', ...args); }

// =====================================================================================
// 1) Référentiels (types, bâtiments) + Catalog interne + “Non présent”
// =====================================================================================

const EQUIPMENT_TYPES = [
  'EARTHING_SYSTEM', 'HV_SWITCHGEAR', 'LV_SWITCHGEAR', 'TRANSFORMER_OIL', 'TRANSFORMER_RESIN',
  'PFC_HV', 'PFC_LV', 'BUSDUCT', 'DISTRIBUTION_BOARD', 'UPS_SMALL', 'UPS_LARGE',
  'BATTERY_SYSTEM', 'VSD', 'MOTORS_HV', 'MOTORS_LV', 'ATEX_EQUIPMENT',
  'EMERGENCY_LIGHTING', 'FIRE_ALARM'
];

const BUILDINGS = ['92', 'B06', 'B11', 'B12', 'B20'];

// TSD — Bibliothèque des points de contrôle
const TSD_LIBRARY = {
  EARTHING_SYSTEM: [
    { id: 'earth_electrode_inspection', label: 'Inspection des conducteurs de mise à la terre', field: 'earth_electrode_inspection', type: 'check', comparator: '==', threshold: true, frequency_months: 12, procedure_md: 'Inspecter les connexions pour assurer leur sécurité.', hazards_md: 'Risque électrique.', ppe_md: 'Gants isolants, lunettes de sécurité.', tools_md: 'Tournevis isolé, multimètre.' },
    { id: 'earth_electrode_testing', label: 'Test des électrodes de terre', field: 'earth_electrode_resistance', type: 'number', unit: 'Ω', comparator: '<=', threshold: 100, frequency_months: 60, procedure_md: 'Mesurer la résistance avec un ohmmètre.', hazards_md: 'Risque électrique.', ppe_md: 'Équipement de protection individuelle.', tools_md: 'Ohmmètre.' },
    // ... autres éléments comme dans le script original
  ],
  HV_SWITCHGEAR: [
    { id: 'hv_visu_room', label: 'Visuel: salle propre/sèche', field: 'hv_visu_room', type: 'check', comparator: '==', threshold: true, frequency_months: 3, procedure_md: 'Vérifier propreté et absence d’humidité.', hazards_md: 'Risque électrique.', ppe_md: 'Gants isolants.', tools_md: 'Aucun.' },
    // ... autres éléments
  ],
  // ... autres types d'équipements avec procedure_md, hazards_md, ppe_md, tools_md ajoutés
};

// Ajout des métadonnées manquantes pour chaque item de TSD_LIBRARY
Object.keys(TSD_LIBRARY).forEach(type => {
  TSD_LIBRARY[type].forEach(item => {
    item.procedure_md = item.procedure_md || 'Suivre la procédure standard pour ce contrôle.';
    item.hazards_md = item.hazards_md || 'Risque électrique standard.';
    item.ppe_md = item.ppe_md || 'Gants isolants, lunettes de sécurité.';
    item.tools_md = item.tools_md || 'Outils standard pour maintenance électrique.';
  });
});

// =====================================================================================
// Schema Setup
// =====================================================================================

async function ensureSchema() {
  try {
    // Création de controls_tasks avec le schéma fourni
    await pool.query(`
      CREATE TABLE IF NOT EXISTS controls_tasks (
        id SERIAL PRIMARY KEY,
        site TEXT,
        entity_id INTEGER,
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
        ai_notes JSONB DEFAULT '[]'::jsonb,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (entity_id) REFERENCES controls_entities(id) ON DELETE CASCADE
      );
    `);
    // Création de controls_history (correction du mot-clé "user")
    await pool.query(`
      CREATE TABLE IF NOT EXISTS controls_history (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL,
        "user" TEXT NOT NULL,
        results JSONB NOT NULL,
        date TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (task_id) REFERENCES controls_tasks(id) ON DELETE CASCADE
      );
    `);
    // Création de controls_attachments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS controls_attachments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mimetype TEXT NOT NULL,
        data BYTEA NOT NULL,
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (task_id) REFERENCES controls_tasks(id) ON DELETE CASCADE
      );
    `);
    log('[CONTROLS SCHEMA] Schema ensured successfully');
  } catch (e) {
    console.error('[CONTROLS SCHEMA] Init error:', e.message, 'Stack:', e.stack);
    throw e;
  }
}
ensureSchema().catch(e => console.error('[CONTROLS SCHEMA] Init error:', e.message));

// =====================================================================================
// Adapters: Switchboards / HV / ATEX
// =====================================================================================

const SWITCHBOARD_URL = process.env.SWITCHBOARD_URL || 'http://localhost:3003';
const HV_URL = process.env.HV_URL || 'http://localhost:3009';
const ATEX_URL = process.env.ATEX_URL || 'http://localhost:3001';

async function safeFetchJson(url, options = {}) {
  try {
    const r = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    log('fetch error:', url, e.message);
    return null;
  }
}

async function loadSwitchboards(site = 'Default') {
  const data = await safeFetchJson(`${SWITCHBOARD_URL}/api/switchboard/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data.map(sb => ({
    id: sb.id,
    site,
    building: sb.building_code || 'B06',
    equipment_type: sb.is_principal ? 'LV_SWITCHGEAR' : 'DISTRIBUTION_BOARD',
    name: sb.name || `Board-${sb.id}`,
    code: sb.code || `SB-${sb.id}`
  }));
}

async function loadHV(site = 'Default') {
  const data = await safeFetchJson(`${HV_URL}/api/hv/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data.map(hv => ({
    id: hv.id,
    site,
    building: hv.building_code || '92',
    equipment_type: 'HV_SWITCHGEAR',
    name: hv.name || `HV-${hv.id}`,
    code: hv.code || `HV-${hv.id}`
  }));
}

async function loadATEX(site = 'Default') {
  const data = await safeFetchJson(`${ATEX_URL}/api/atex/equipments?site=${encodeURIComponent(site)}`);
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data.map(ax => ({
    id: ax.id,
    site,
    building: ax.building || 'B11',
    equipment_type: 'ATEX_EQUIPMENT',
    name: ax.component_type || `ATEX-${ax.id}`,
    code: ax.manufacturer_ref || `ATEX-${ax.id}`
  }));
}

async function syncAllExternal(site = 'Default') {
  const [sb, hv, atex] = await Promise.all([loadSwitchboards(site), loadHV(site), loadATEX(site)]);
  const incoming = [...sb, ...hv, ...atex];
  let added = 0, updated = 0;
  for (const inc of incoming) {
    if (!EQUIPMENT_TYPES.includes(inc.equipment_type)) continue;
    const { rows: existing } = await pool.query(
      'SELECT * FROM controls_entities WHERE site = $1 AND equipment_type = $2 AND id::text = $3',
      [inc.site, inc.equipment_type, inc.id.toString()]
    );
    if (existing.length === 0) {
      await pool.query(
        'INSERT INTO controls_entities (site, building, equipment_type, name, code) VALUES ($1, $2, $3, $4, $5)',
        [inc.site, inc.building, inc.equipment_type, inc.name, inc.code]
      );
      added++;
    } else {
      const prev = existing[0];
      if (prev.name !== inc.name || prev.code !== inc.code || prev.building !== inc.building) {
        await pool.query(
          'UPDATE controls_entities SET building = $1, name = $2, code = $3 WHERE id = $4',
          [inc.building, inc.name, inc.code, prev.id]
        );
        updated++;
      }
    }
  }
  return { added, updated, total: incoming.length };
}

// =====================================================================================
// Génération des tâches (incl. NOT_PRESENT) + statut Overdue
// =====================================================================================
async function ensureOverdueFlags() {
  await pool.query("UPDATE controls_tasks SET status = 'Overdue' WHERE status = 'Planned' AND next_control < CURRENT_DATE");
}

async function regenerateTasks(site = 'Default') {
  const { rows: entities } = await pool.query('SELECT * FROM controls_entities WHERE site = $1', [site]);
  const created = [];
  for (const entity of entities) {
    const items = TSD_LIBRARY[entity.equipment_type] || [];
    let done = entity.done || {};
    for (const it of items) {
      const last = done[it.id] || null;
      if (isDue(last, it.frequency_months)) {
        const { rows: exists } = await pool.query(
          'SELECT * FROM controls_tasks WHERE status IN (\'Planned\', \'Overdue\') AND entity_id = $1 AND task_code = $2',
          [entity.id, it.id]
        );
        if (exists.length === 0) {
          const next_control = todayISO();
          await pool.query(
            `INSERT INTO controls_tasks (
              site, entity_id, task_name, task_code, frequency_months, next_control, status,
              value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              site, entity.id, `${entity.name} • ${it.label}`, it.id, it.frequency_months, next_control, 'Planned',
              'checklist', JSON.stringify({ field: it.field, type: it.type, unit: it.unit, comparator: it.comparator, threshold: it.threshold }),
              it.procedure_md, it.hazards_md, it.ppe_md, it.tools_md, 'system', new Date().toISOString()
            ]
          );
          created.push(true);
        }
      }
    }
  }
  // NOT_PRESENT
  const { rows: decls } = await pool.query('SELECT * FROM controls_not_present WHERE site = $1', [site]);
  for (const decl of decls) {
    const last = decl.last_assessment_at;
    if (isDue(last ? last.toISOString().slice(0, 10) : null, 12)) {
      const { rows: exists } = await pool.query(
        'SELECT * FROM controls_tasks WHERE status IN (\'Planned\', \'Overdue\') AND task_code = \'annual_assessment\' AND entity_id = $1',
        [decl.id]
      );
      if (exists.length === 0) {
        const next_control = todayISO();
        await pool.query(
          `INSERT INTO controls_tasks (
            site, entity_id, task_name, task_code, frequency_months, next_control, status,
            value_type, result_schema, procedure_md, hazards_md, ppe_md, tools_md, created_by, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            site, decl.id, `[Annual Assessment] ${decl.equipment_type} — declared not present`, 'annual_assessment', 12, next_control, 'Planned',
            'checklist', JSON.stringify({ field: 'assessment', type: 'check', comparator: '==', threshold: true }),
            'Vérifier l’absence de l’équipement.', 'Aucun risque.', 'Aucun EPI requis.', 'Aucun outil requis.', 'system', new Date().toISOString()
          ]
        );
        created.push(true);
      }
    }
  }
  await ensureOverdueFlags();
  return created.length;
}

// =====================================================================================
// Évaluations TSD + intégration risk score (vision) dans le verdict
// =====================================================================================

function evaluate(tsd_item, results, aiRiskScore = null) {
  if (!tsd_item) return { status: 'To Verify', detail: 'No TSD rule found' };

  const RISK_THRESHOLD = Number(process.env.AI_RISK_THRESHOLD || 0.7);

  const v = results?.[tsd_item.field];
  let baseVerdict;
  switch (tsd_item.type) {
    case 'check': {
      const ok = (v === true);
      baseVerdict = { status: ok ? 'Compliant' : 'Non Compliant', detail: ok ? 'OK' : 'Not checked' };
      break;
    }
    case 'number': {
      const num = Number(v);
      if (isNaN(num)) baseVerdict = { status: 'To Verify', detail: 'Missing numerical value' };
      else {
        const thr = Number(tsd_item.threshold);
        if (tsd_item.comparator === '>=') baseVerdict = { status: num >= thr ? 'Compliant' : 'Non Compliant', detail: `${num} ${tsd_item.unit || ''} vs ≥ ${thr}` };
        else if (tsd_item.comparator === '<=') baseVerdict = { status: num <= thr ? 'Compliant' : 'Non Compliant', detail: `${num} ${tsd_item.unit || ''} vs ≤ ${thr}` };
        else if (tsd_item.comparator === '<') baseVerdict = { status: num < thr ? 'Compliant' : 'Non Compliant', detail: `${num} ${tsd_item.unit || ''} vs < ${thr}` };
        else if (tsd_item.comparator === '==') baseVerdict = { status: num === thr ? 'Compliant' : 'Non Compliant', detail: `${num} vs == ${thr}` };
        else baseVerdict = { status: 'To Verify', detail: 'Unhandled comparator' };
      }
      break;
    }
    default:
      baseVerdict = { status: 'To Verify', detail: 'Unhandled type' };
  }

  if (aiRiskScore != null && aiRiskScore >= RISK_THRESHOLD && baseVerdict.status === 'Compliant') {
    return { status: 'To Verify', detail: `AI risk score ${aiRiskScore.toFixed(2)} ≥ threshold ${RISK_THRESHOLD}` };
  }
  return baseVerdict;
}

// =====================================================================================
// API
// =====================================================================================

// Health
app.get('/api/controls/health', async (_req, res) => {
  const openaiOk = !!openai;
  res.json({ ok: true, ts: Date.now(), openai: openaiOk });
});

// ---- Sync externe
app.post('/api/controls/sync', async (req, res) => {
  const site = req.body?.site || 'Default';
  const r = await syncAllExternal(site);
  const created = await regenerateTasks(site);
  res.json({ synced: r, tasks_created: created });
});

// ---- Catalog équipements
aapp.get('/api/controls/catalog', async (req, res) => {
  const { site = 'Default', building, type } = req.query;
  let query = 'SELECT * FROM controls_entities WHERE site = $1';
  const values = [site];
  let i = 2;
  if (building) {
    query += ` AND building = $${i}`;
    values.push(building);
    i++;
  }
  if (type) {
    query += ` AND equipment_type = $${i}`;
    values.push(type);
    i++;
  }
  const { rows } = await pool.query(query, values);
  res.json({ data: rows, types: EQUIPMENT_TYPES, buildings: BUILDINGS });
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

// ---- Déclaration Non Présent
app.get('/api/controls/not-present', async (req, res) => {
  const { site = 'Default', building } = req.query;
  let query = 'SELECT * FROM controls_not_present WHERE site = $1';
  const values = [site];
  if (building) {
    query += ' AND building = $2';
    values.push(building);
  }
  const { rows } = await pool.query(query, values);
  res.json(rows);
});

app.post('/api/controls/not-present', async (req, res) => {
  const { site = 'Default', building, equipment_type, declared_by, note } = req.body || {};
  if (!building || !equipment_type) return res.status(400).json({ error: 'Missing fields' });
  if (!EQUIPMENT_TYPES.includes(equipment_type)) return res.status(400).json({ error: 'Unknown equipment_type' });
  const { rows: exists } = await pool.query('SELECT * FROM controls_not_present WHERE site = $1 AND building = $2 AND equipment_type = $3', [site, building, equipment_type]);
  if (exists.length > 0) return res.status(409).json({ error: 'Already declared' });
  const { rows } = await pool.query(
    'INSERT INTO controls_not_present (site, building, equipment_type, declared_by, note) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [site, building, equipment_type, declared_by || 'unknown', note || '']
  );
  await regenerateTasks(site);
  res.status(201).json(rows[0]);
});

app.post('/api/controls/not-present/:id/assess', async (req, res) => {
  const id = Number(req.params.id);
  const { rows: decl } = await pool.query('SELECT * FROM controls_not_present WHERE id = $1', [id]);
  if (decl.length === 0) return res.status(404).json({ error: 'Not found' });
  await pool.query('UPDATE controls_not_present SET last_assessment_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  await pool.query(
    `UPDATE controls_tasks SET status = 'Completed', last_control = CURRENT_DATE, operator = $1, results = $2, updated_at = CURRENT_TIMESTAMP
     WHERE task_code = 'annual_assessment' AND entity_id = $3 AND status IN ('Planned', 'Overdue')`,
    [req.body?.user || 'unknown', JSON.stringify({ note: req.body?.note || '', verdict: { status: 'Compliant', detail: 'Assessment réalisé' } }), id]
  );
  const { rows: updatedTask } = await pool.query(
    `SELECT * FROM controls_tasks WHERE task_code = 'annual_assessment' AND entity_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [id]
  );
  if (updatedTask.length > 0) {
    await pool.query('INSERT INTO controls_history (task_id, "user", results) VALUES ($1, $2, $3)', [updatedTask[0].id, updatedTask[0].operator, updatedTask[0].results]);
  }
  res.json({ success: true });
});

// ---- Librairie TSD
app.get('/api/controls/library', (_req, res) => {
  res.json({ types: EQUIPMENT_TYPES, library: TSD_LIBRARY });
});

// ---- Tâches: list / generate / details
app.get('/api/controls/tasks', async (req, res) => {
  try {
    const { site = 'Default', building, type, status, q, page = 1, pageSize = 50 } = req.query;
    await ensureOverdueFlags();
    let query = `
      SELECT ct.*, ce.equipment_type 
      FROM controls_tasks ct 
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id 
      WHERE ct.site = $1`;
    const values = [site];
    let i = 2;
    if (building) {
      query += ` AND ce.building = $${i}`;
      values.push(building);
      i++;
    }
    if (type) {
      query += ` AND ce.equipment_type = $${i}`;
      values.push(type);
      i++;
    }
    if (status) {
      query += ` AND ct.status = $${i}`;
      values.push(status);
      i++;
    }
    if (q) {
      query += ` AND (ct.task_name ILIKE $${i} OR ct.task_code ILIKE $${i})`;
      values.push(`%${q}%`);
      i++;
    }
    query += ` ORDER BY ct.next_control ASC LIMIT $${i} OFFSET $${i + 1}`;
    values.push(Number(pageSize));
    values.push((Number(page) - 1) * Number(pageSize));
    const { rows } = await pool.query(query, values);
    const { rows: totalRows } = await pool.query('SELECT COUNT(*) FROM controls_tasks WHERE site = $1', [site]);
    res.json({ data: rows, total: totalRows[0].count });
  } catch (e) {
    log('Erreur dans /api/controls/tasks:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.post('/api/controls/generate', async (req, res) => {
  try {
    const site = req.body?.site || 'Default';
    const created = await regenerateTasks(site);
    res.json({ created });
  } catch (e) {
    log('Erreur dans /api/controls/generate:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.get('/api/controls/tasks/:id/details', async (req, res) => {
  try {
    const { rows: task } = await pool.query('SELECT * FROM controls_tasks WHERE id = $1', [req.params.id]);
    if (task.length === 0) return res.status(404).json({ error: 'Tâche non trouvée' });
    const t = task[0];
    const { rows: equip } = await pool.query(
      'SELECT * FROM controls_entities WHERE id = $1',
      [t.entity_id]
    );
    const equipment_type = equip[0]?.equipment_type || 'UNKNOWN';
    const item = TSD_LIBRARY[equipment_type]?.find(i => i.id === t.task_code) || null;
    res.json({ ...t, equipment: equip[0] || null, tsd_item: item });
  } catch (e) {
    log('Erreur dans /api/controls/tasks/:id/details:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// ---- Pièces jointes
app.post('/api/controls/tasks/:id/upload', upload.array('files', 12), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: task } = await pool.query('SELECT * FROM controls_tasks WHERE id = $1', [id]);
    if (task.length === 0) return res.status(404).json({ error: 'Tâche non trouvée' });
    if (task[0].status === 'Completed') return res.status(400).json({ error: 'Tâche déjà complétée' });
    const files = (req.files || []).map(f => ({
      filename: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
      data: f.buffer,
      uploaded_at: new Date().toISOString()
    }));
    for (const file of files) {
      await pool.query(
        'INSERT INTO controls_attachments (task_id, filename, size, mimetype, data, uploaded_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, file.filename, file.size, file.mimetype, file.data, file.uploaded_at]
      );
    }
    res.json({ uploaded: files.length });
  } catch (e) {
    log('Erreur dans /api/controls/tasks/:id/upload:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.get('/api/controls/tasks/:id/attachments', async (req, res) => {
  try {
    const { rows: attachments } = await pool.query(
      'SELECT id, filename, size, mimetype, uploaded_at FROM controls_attachments WHERE task_id = $1',
      [req.params.id]
    );
    res.json(attachments);
  } catch (e) {
    log('Erreur dans /api/controls/tasks/:id/attachments:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.get('/api/controls/tasks/:id/attachments/:attId', async (req, res) => {
  try {
    const { rows: attachment } = await pool.query(
      'SELECT * FROM controls_attachments WHERE id = $1 AND task_id = $2',
      [req.params.attId, req.params.id]
    );
    if (attachment.length === 0) return res.status(404).json({ error: 'Pièce jointe non trouvée' });
    const att = attachment[0];
    res.setHeader('Content-Type', att.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
    res.send(att.data);
  } catch (e) {
    log('Erreur dans /api/controls/tasks/:id/attachments/:attId:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.delete('/api/controls/attachments/:taskId/:attId', async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const attId = Number(req.params.attId);
    const { rowCount } = await pool.query(
      'DELETE FROM controls_attachments WHERE id = $1 AND task_id = $2',
      [attId, taskId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Pièce jointe non trouvée' });
    res.json({ success: true });
  } catch (e) {
    log('Erreur dans /api/controls/attachments/:taskId/:attId:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// ---- IA Vision: score de risque et tags avec OpenAI
app.post('/api/controls/ai/vision-score', upload.array('files', 8), async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: 'IA indisponible' });
    const hints = (req.body?.hints || '').toLowerCase();
    const files = req.files || [];
    const imageParts = files.map(f => ({
      type: "image_url",
      image_url: { url: `data:${f.mimetype};base64,${f.buffer.toString('base64')}` }
    }));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Vous êtes un expert en maintenance électrique. Analysez les images pour détecter des risques comme la surchauffe, la corrosion, les connexions desserrées, les violations IP. Retournez un JSON : { ai_risk_score: number 0-1, tags: array of strings }' },
        { role: 'user', content: [{ type: "text", text: `Indices : ${hints}. Analysez les risques.` }, ...imageParts] }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    });
    const json = JSON.parse(completion.choices[0].message.content);
    res.json({ ai_risk_score: Number(json.ai_risk_score || 0), tags: json.tags || [] });
  } catch (e) {
    log('Erreur dans /api/controls/ai/vision-score:', e.message);
    res.status(500).json({ error: 'Échec de l’analyse IA', details: e.message });
  }
});

// ---- Compléter une tâche
app.post('/api/controls/tasks/:id/complete', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: task } = await pool.query('SELECT * FROM controls_tasks WHERE id = $1', [id]);
    if (task.length === 0) return res.status(404).json({ error: 'Tâche non trouvée' });
    const t = task[0];
    if (t.status === 'Completed') return res.status(400).json({ error: 'Tâche déjà complétée' });

    const user = req.body?.user || 'unknown';
    const results = req.body?.results || {};
    const ai_risk_score = Number(req.body?.ai_risk_score) || null;

    const { rows: entity } = await pool.query('SELECT equipment_type FROM controls_entities WHERE id = $1', [t.entity_id]);
    const equipment_type = entity[0]?.equipment_type || 'UNKNOWN';
    const item = TSD_LIBRARY[equipment_type]?.find(i => i.id === t.task_code) || null;
    const verdict = evaluate(item, results, ai_risk_score);

    await pool.query(
      `UPDATE controls_tasks SET 
        status = 'Completed', 
        last_control = CURRENT_DATE, 
        created_by = $1, 
        results = $2, 
        ai_notes = ai_notes || $3::jsonb, 
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $4`,
      [user, JSON.stringify({ ...results, verdict }), JSON.stringify([{ score: ai_risk_score, timestamp: new Date().toISOString() }]), id]
    );

    // Update EQUIP_DONE
    if (item && equipment_type !== 'NOT_PRESENT') {
      await pool.query(
        'UPDATE controls_entities SET done = done || jsonb_build_object($1, $2) WHERE equipment_type = $3 AND id = $4',
        [t.task_code, todayISO(), equipment_type, t.entity_id]
      );
    }

    await pool.query('INSERT INTO controls_history (task_id, "user", results) VALUES ($1, $2, $3)', [id, user, { ...results, verdict }]);

    res.json({ message: 'Tâche complétée', verdict });
  } catch (e) {
    log('Erreur dans /api/controls/tasks/:id/complete:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// ---- Historique & export
app.get('/api/controls/history', async (req, res) => {
  try {
    const { user, q, page = 1, pageSize = 50 } = req.query;
    let query = 'SELECT * FROM controls_history';
    const values = [];
    let i = 1;
    if (user) {
      query += ` WHERE "user" = $${i}`;
      values.push(user);
      i++;
    }
    if (q) {
      query += user ? ' AND' : ' WHERE';
      query += ` results::text ILIKE $${i}`;
      values.push(`%${q}%`);
      i++;
    }
    query += ` ORDER BY date DESC LIMIT $${i} OFFSET $${i + 1}`;
    values.push(Number(pageSize));
    values.push((Number(page) - 1) * Number(pageSize));
    const { rows } = await pool.query(query, values);
    const { rows: totalRows } = await pool.query('SELECT COUNT(*) FROM controls_history');
    res.json({ data: rows, total: totalRows[0].count });
  } catch (e) {
    log('Erreur dans /api/controls/history:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

app.get('/api/controls/history/export', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM controls_history');
    const csv = toCSV(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=controls_history.csv');
    res.send(csv);
  } catch (e) {
    log('Erreur dans /api/controls/history/export:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// ---- Analytics
app.get('/api/controls/analytics', async (_req, res) => {
  try {
    await ensureOverdueFlags();
    const { rows: stats } = await pool.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'Planned') AS planned,
        COUNT(*) FILTER (WHERE status = 'Overdue') AS overdue
      FROM controls_tasks
    `);
    const { rows: byBuilding } = await pool.query(`
      SELECT ce.building, COUNT(*) 
      FROM controls_tasks ct 
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id 
      GROUP BY ce.building
    `);
    const { rows: byType } = await pool.query(`
      SELECT ce.equipment_type, COUNT(*) 
      FROM controls_tasks ct 
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id 
      GROUP BY ce.equipment_type
    `);
    const gaps = await Promise.all(
      EQUIPMENT_TYPES.map(async ty => {
        const hasEquip = (await pool.query('SELECT COUNT(*) FROM controls_entities WHERE equipment_type = $1', [ty])).rows[0].count > 0;
        const hasNP = (await pool.query('SELECT COUNT(*) FROM controls_not_present WHERE equipment_type = $1', [ty])).rows[0].count > 0;
        return !hasEquip && !hasNP ? ty : null;
      })
    ).then(results => results.filter(ty => ty));
    res.json({
      ...stats[0],
      byBuilding: byBuilding.reduce((acc, r) => ({ ...acc, [r.building]: r.count }), {}),
      byType: byType.reduce((acc, r) => ({ ...acc, [r.equipment_type]: r.count }), {}),
      gaps
    });
  } catch (e) {
    log('Erreur dans /api/controls/analytics:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// ---- Roadmap
app.get('/api/controls/roadmap', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ce.equipment_type, COUNT(*) AS count, MIN(ct.next_control) AS start, MAX(ct.next_control) AS end
      FROM controls_tasks ct
      LEFT JOIN controls_entities ce ON ct.entity_id = ce.id
      WHERE ct.status IN ('Planned', 'Overdue')
      GROUP BY ce.equipment_type
    `);
    const roadmap = rows.map((r, idx) => ({
      id: idx + 1,
      title: `Q4 — ${r.equipment_type} (${r.count} tâches)`,
      start: r.start,
      end: r.end
    }));
    res.json(roadmap);
  } catch (e) {
    log('Erreur dans /api/controls/roadmap:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// ---- Assistant IA
app.post('/api/controls/ai/assistant', async (req, res) => {
  try {
    const { mode, text, lang = 'fr' } = req.body || {};
    if (!openai) return res.status(503).json({ error: 'IA indisponible' });
    if (mode === 'text') {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Vous êtes un assistant en maintenance électrique. Répondez en ${lang}.` },
          { role: 'user', content: text }
        ],
        temperature: 0.5
      });
      res.json({ reply: completion.choices[0].message.content });
    } else if (mode === 'vision') {
      res.json({ suggestion: 'Analyse de vision non implémentée - à intégrer avec OpenAI' });
    } else {
      res.status(400).json({ error: 'Mode inconnu' });
    }
  } catch (e) {
    log('Erreur dans /api/controls/ai/assistant:', e.message);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// =====================================================================================
// Scheduler quotidien (Overdue + notifications)
// =====================================================================================

const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK || null;
async function notify(payload) {
  if (!ALERT_WEBHOOK) return;
  try {
    await fetch(ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    log('Erreur de notification:', e.message);
  }
}

async function dailyMaintenance() {
  try {
    await ensureOverdueFlags();
    const { rows: overdue } = await pool.query(
      `SELECT ct.id, ct.task_name AS title, ce.equipment_type, ct.next_control AS due_date
       FROM controls_tasks ct
       LEFT JOIN controls_entities ce ON ct.entity_id = ce.id
       WHERE ct.status = 'Overdue'
       LIMIT 50`
    );
    if (overdue.length > 0) {
      notify({ type: 'controls.overdue', at: new Date().toISOString(), count: overdue.length, items: overdue });
      log(`Tâches en retard: ${overdue.length}`);
    }
    await regenerateTasks('Default');
    log('Tâche quotidienne effectuée');
  } catch (e) {
    log('Erreur dans dailyMaintenance:', e.message);
  }
}

// Lancement job: toutes les 6h (et au démarrage)
const SIX_HOURS = 6 * 60 * 60 * 1000;
setTimeout(dailyMaintenance, 5 * 1000);
setInterval(dailyMaintenance, SIX_HOURS);

// =====================================================================================
// Démarrage
// =====================================================================================
const port = Number(process.env.CONTROLS_PORT || 3011);
app.listen(port, () => console.log(`[controls] serveur démarré sur :${port}`));
