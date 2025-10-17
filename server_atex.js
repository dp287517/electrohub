// server_atex_combined.js — Backend ATEX complet + intégration "Plans" (Leaflet-ready)
// Remplace ton server_atex.js actuel par CE fichier (ou copie-colle). 
// Port par défaut: process.env.ATEX_PORT || 3001

import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import StreamZip from 'node-stream-zip';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// NOTE: Node 18+ fournit fetch en global → utilisé pour les endpoints IA/photo

dotenv.config();
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
});

const app = express();
app.use(helmet());
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// CORS (simple et permissif — aligne si besoin)
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-User-Email,X-User-Name,X-Site');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ======================================================================
//                  Utils génériques (dates, conformité)
// ======================================================================
function addMonths(dateStr, months = 36) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function getCategoryFromMarking(ref, type) {
  const upper = (ref || '').toUpperCase();
  const match = upper.match(new RegExp(`II\\s*([1-3])${type}`, 'i'));
  return match ? parseInt(match[1]) : null;
}

function getRequiredCategory(zone, type) {
  const z = Number(zone);
  if (type === 'gas') {
    if (z === 0) return 1;
    if (z === 1) return [1, 2];
    if (z === 2) return [1, 2, 3];
  } else if (type === 'dust') {
    if (z === 20) return 1;
    if (z === 21) return [1, 2];
    if (z === 22) return [1, 2, 3];
  }
  return null;
}

function assessCompliance(atex_ref = '', zone_gas = null, zone_dust = null) {
  const ref = (atex_ref || '').toUpperCase();
  const needsGas = [0, 1, 2].includes(Number(zone_gas));
  const needsDust = [20, 21, 22].includes(Number(zone_dust));

  const catGas = getCategoryFromMarking(ref, 'G');
  const catDust = getCategoryFromMarking(ref, 'D');

  const problems = [];
  if (needsGas) {
    if (catGas === null) {
      problems.push('No gas category (G) in ATEX marking for gas zone.');
    } else {
      const reqGas = getRequiredCategory(zone_gas, 'gas');
      if (!reqGas.includes(catGas)) {
        problems.push(`Gas category ${catGas}G not suitable for zone ${zone_gas} (requires ${reqGas.join(' or ')}).`);
      }
    }
  }
  if (needsDust) {
    if (catDust === null) {
      problems.push('No dust category (D) in ATEX marking for dust zone.');
    } else {
      const reqDust = getRequiredCategory(zone_dust, 'dust');
      if (!reqDust.includes(catDust)) {
        problems.push(`Dust category ${catDust}D not suitable for zone ${zone_dust} (requires ${reqDust.join(' or ')}).`);
      }
    }
  }
  return { status: problems.length ? 'Non conforme' : 'Conforme', problems };
}

// ======================================================================
//                  Schéma DB (ajouts + tables Plans)
// ======================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Répertoires pour les plans
const DATA_ROOT = process.env.ATEX_DATA_DIR || path.join(__dirname, 'data_atex');
const FILES_DIR = path.join(DATA_ROOT, 'files');
const MAPS_ROOT = path.join(DATA_ROOT, 'maps');
const MAPS_INCOMING_DIR = path.join(MAPS_ROOT, 'incoming');
const MAPS_STORE_DIR = path.join(MAPS_ROOT, 'plans');
await fsp.mkdir(DATA_ROOT, { recursive: true });
await fsp.mkdir(FILES_DIR, { recursive: true });
await fsp.mkdir(MAPS_INCOMING_DIR, { recursive: true });
await fsp.mkdir(MAPS_STORE_DIR, { recursive: true });

// PDF.js worker & fonts (nécessaires pour compter les pages)
function resolvePdfWorker() {
  try {
    return require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  } catch {
    return require.resolve('pdfjs-dist/build/pdf.worker.mjs');
  }
}
pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorker();
const pdfjsPkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
const PDF_STANDARD_FONTS = path.join(pdfjsPkgDir, 'standard_fonts/');

async function ensureSchema() {
  // 1) Colonne frequency_months sur atex_equipments (compat ascendante)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'atex_equipments' AND column_name = 'frequency_months'
      ) THEN
        ALTER TABLE atex_equipments ADD COLUMN frequency_months INTEGER;
      END IF;
    END $$;
  `);

  // 2) Tables Plans & Positions (inspiré logique "portes")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL,
      version TEXT NOT NULL,
      filename TEXT,
      file_path TEXT,
      page_count INT,
      content BYTEA,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS atex_plans_logical_idx ON atex_plans(logical_name);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS atex_plans_created_idx ON atex_plans(created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_plan_names (
      logical_name TEXT PRIMARY KEY,
      display_name TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS atex_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES atex_equipments(id) ON DELETE CASCADE,
      plan_logical_name TEXT NOT NULL,
      page_index INT NOT NULL DEFAULT 0,
      page_label TEXT,
      x_frac NUMERIC,
      y_frac NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'atex_positions_uniq'
      ) THEN
        ALTER TABLE atex_positions
        ADD CONSTRAINT atex_positions_uniq UNIQUE (equipment_id, plan_logical_name, page_index);
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_pos_equip ON atex_positions(equipment_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atex_pos_plan_page ON atex_positions(plan_logical_name, page_index);`);
}
await ensureSchema().catch(e => console.error('[ATEX SCHEMA] error:', e.message));

// ======================================================================
//                            Helpers Plans
// ======================================================================
function parsePlanName(entryName) {
  const base = path.basename(entryName).replace(/\.pdf$/i, '');
  const m = base.match(/^(.*?)(?:[_-](v?\d+))?$/i);
  const logical = (m?.[1] || base || 'plan').trim();
  const version = (m?.[2] || 'v1').trim();
  return { logical, version };
}

async function pdfPageCount(abs) {
  const data = new Uint8Array(await fsp.readFile(abs));
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: PDF_STANDARD_FONTS }).promise;
  const n = doc.numPages || 1;
  await doc.cleanup();
  return n;
}

// ======================================================================
//                         API: Health (simple)
// ======================================================================
app.get('/api/atex/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ======================================================================
//                         API: Plans / Positions
// ======================================================================
const uploadZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_INCOMING_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

app.post('/api/atex/maps/uploadZip', uploadZip.single('zip'), async (req, res) => {
  const zipPath = req.file?.path;
  if (!zipPath) return res.status(400).json({ ok: false, error: 'zip manquant' });

  const zip = new StreamZip.async({ file: zipPath, storeEntries: true });
  const imported = [];
  try {
    const entries = await zip.entries();
    const files = Object.values(entries).filter((e) => !e.isDirectory && /\.pdf$/i.test(e.name));

    for (const entry of files) {
      const tmpOut = path.join(MAPS_INCOMING_DIR, `tmp_${Date.now()}_${path.basename(entry.name).replace(/[^\w.\-]+/g, '_')}`);
      await fsp.mkdir(path.dirname(tmpOut), { recursive: true });
      await zip.extract(entry.name, tmpOut);

      const { logical, version } = parsePlanName(entry.name);

      const safeRel = entry.name.replace(/[^\w.\-\/]+/g, '_');
      const dest = path.join(MAPS_STORE_DIR, `${Date.now()}_${safeRel}`);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(tmpOut, dest);

      const page_count = await pdfPageCount(dest).catch(() => 1);
      let buf = null;
      try { buf = await fsp.readFile(dest); } catch {}

      await pool.query(
        `INSERT INTO atex_plans (logical_name, version, filename, file_path, page_count, content)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [logical, version, path.basename(dest), dest, page_count, buf]
      );

      await pool.query(
        `INSERT INTO atex_plan_names (logical_name, display_name)
         VALUES ($1, $2)
         ON CONFLICT (logical_name) DO NOTHING`,
        [logical, logical]
      );

      imported.push({ logical_name: logical, version, page_count });
    }

    res.json({ ok: true, imported });
  } catch (e) {
    console.error('[UPLOAD ZIP] error:', e?.message);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    await zip.close().catch(() => {});
    fs.rmSync(zipPath, { force: true });
  }
});

app.get('/api/atex/maps/plans', async (_req, res) => {
  try {
    const q = `
      WITH latest AS (
        SELECT DISTINCT ON (logical_name)
               id, logical_name, version, page_count, created_at
          FROM atex_plans
         ORDER BY logical_name, created_at DESC
      )
      SELECT l.id, l.logical_name, n.display_name, l.version, l.page_count, l.created_at
        FROM latest l
        LEFT JOIN atex_plan_names n ON n.logical_name = l.logical_name
       ORDER BY l.logical_name ASC;`;
    const { rows } = await pool.query(q);
    res.json({ ok: true, plans: rows });
  } catch (e) {
    console.error('[PLANS LIST] error:', e?.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/atex/maps/plan/:logical/rename', async (req, res) => {
  try {
    const logical = String(req.params.logical || '');
    const display_name = String(req.body?.display_name || '').trim() || logical;
    if (!logical) return res.status(400).json({ ok: false, error: 'logical_name requis' });

    await pool.query(
      `INSERT INTO atex_plan_names (logical_name, display_name)
       VALUES ($1,$2)
       ON CONFLICT (logical_name) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [logical, display_name]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[PLAN RENAME] error:', e?.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/atex/maps/plan/:idOrLogical/file', async (req, res) => {
  try {
    const key = String(req.params.idOrLogical || '');
    let row = null;
    if (/^[0-9a-fA-F-]{36}$/.test(key)) {
      const r = await pool.query('SELECT * FROM atex_plans WHERE id=$1 LIMIT 1', [key]);
      row = r.rows?.[0] || null;
    } else {
      const r = await pool.query('SELECT * FROM atex_plans WHERE logical_name=$1 ORDER BY created_at DESC LIMIT 1', [key]);
      row = r.rows?.[0] || null;
    }
    if (!row) return res.status(404).json({ ok: false, error: 'plan introuvable' });

    res.setHeader('Content-Type', 'application/pdf');
    if (row.content) return res.send(row.content);
    if (row.file_path && fs.existsSync(row.file_path)) {
      return fs.createReadStream(row.file_path).pipe(res);
    }
    res.status(410).json({ ok: false, error: 'fichier indisponible' });
  } catch (e) {
    console.error('[PLAN FILE] error:', e?.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/atex/maps/positions', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const logicalParam = String(req.query.logical_name || '');
    const pageIndex = Number(req.query.page_index || 0);

    let logical = logicalParam;
    if (!logical && /^[0-9a-fA-F-]{36}$/.test(id)) {
      const { rows } = await pool.query('SELECT logical_name FROM atex_plans WHERE id=$1 LIMIT 1', [id]);
      logical = rows?.[0]?.logical_name || '';
    }
    if (!logical) return res.status(400).json({ ok: false, error: 'logical_name ou id requis' });

    const q = `
      SELECT p.id, p.equipment_id, p.plan_logical_name, p.page_index, p.page_label,
             p.x_frac::float AS x_frac, p.y_frac::float AS y_frac,
             e.code, e.building, e.room, e.component_type, e.status
        FROM atex_positions p
        LEFT JOIN atex_equipments e ON e.id = p.equipment_id
       WHERE p.plan_logical_name = $1 AND p.page_index = $2
       ORDER BY e.building, e.room, e.code;`;
    const { rows } = await pool.query(q, [logical, pageIndex]);
    res.json({ ok: true, positions: rows });
  } catch (e) {
    console.error('[POS LIST] error:', e?.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/atex/maps/positions/:equipmentId', async (req, res) => {
  try {
    const equipmentId = String(req.params.equipmentId || '');
    const body = req.body || {};
    const logical = String(body.plan_logical_name || body.logical_name || '');
    const page_index = Number(body.page_index ?? 0);
    const x_frac = Number(body.x_frac ?? NaN);
    const y_frac = Number(body.y_frac ?? NaN);
    const page_label = body.page_label ? String(body.page_label) : null;

    if (!equipmentId || !logical || Number.isNaN(x_frac) || Number.isNaN(y_frac)) {
      return res.status(400).json({ ok: false, error: 'paramètres invalides' });
    }

    const q = `
      INSERT INTO atex_positions (equipment_id, plan_logical_name, page_index, page_label, x_frac, y_frac, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6, now(), now())
      ON CONFLICT (equipment_id, plan_logical_name, page_index)
      DO UPDATE SET page_label = EXCLUDED.page_label,
                    x_frac = EXCLUDED.x_frac,
                    y_frac = EXCLUDED.y_frac,
                    updated_at = now()
      RETURNING id;`;
    const { rows } = await pool.query(q, [equipmentId, logical, page_index, page_label, x_frac, y_frac]);
    res.json({ ok: true, id: rows?.[0]?.id });
  } catch (e) {
    console.error('[POS UPSERT] error:', e?.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/atex/maps/positions/:equipmentId', async (req, res) => {
  try {
    const equipmentId = String(req.params.equipmentId || '');
    const logical = String(req.query.plan_logical_name || req.query.logical_name || '');
    const page_index = Number(req.query.page_index ?? 0);
    if (!equipmentId || !logical) {
      return res.status(400).json({ ok: false, error: 'paramètres invalides' });
    }
    await pool.query('DELETE FROM atex_positions WHERE equipment_id=$1 AND plan_logical_name=$2 AND page_index=$3', [equipmentId, logical, page_index]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[POS DELETE] error:', e?.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================================================
//                     API: ATEX EXISTANT (CRUD & Co.)
// ======================================================================
// SUGGESTS
app.get('/api/atex/suggests', async (req, res) => {
  try {
    const fields = ['building', 'room', 'component_type', 'manufacturer', 'manufacturer_ref', 'atex_ref'];
    const out = {};
    for (const f of fields) {
      const r = await pool.query(`SELECT DISTINCT ${f} FROM atex_equipments WHERE ${f} IS NOT NULL AND ${f}<>'' ORDER BY ${f} ASC LIMIT 200`);
      out[f] = r.rows.map(x => x[f]);
    }
    res.json(out);
  } catch (e) {
    console.error('[SUGGESTS] error:', e?.message);
    res.status(500).json({ error: 'Suggests failed' });
  }
});

// Helpers LIST
function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }
function addLikeIn(where, values, i, field, arr) {
  if (!arr.length) return i;
  const slots = arr.map((_, k) => `$${i + k}`);
  where.push(`${field} IN (${slots.join(',')})`);
  values.push(...arr);
  return i + arr.length;
}
async function runListQuery({ whereSql, values, sortSafe, dirSafe, limit, offset }) {
  return pool.query(
    `SELECT * FROM atex_equipments ${whereSql} ORDER BY ${sortSafe} ${dirSafe} LIMIT ${limit} OFFSET ${offset}`,
    values
  );
}

// LIST
app.get('/api/atex/equipments', async (req, res) => {
  try {
    const { q, sort = 'id', dir = 'desc', page = '1', pageSize = '100' } = req.query;

    const buildings = asArray(req.query.building).filter(Boolean);
    const rooms = asArray(req.query.room).filter(Boolean);
    const types = asArray(req.query.component_type).filter(Boolean);
    const mans = asArray(req.query.manufacturer).filter(Boolean);
    const statuses = asArray(req.query.status).filter(Boolean);
    const gases = asArray(req.query.zone_gas).filter(Boolean).map(Number);
    const dusts = asArray(req.query.zone_dust).filter(Boolean).map(Number);

    const where = [];
    const values = [];
    let i = 1;

    if (q) {
      where.push(`(building ILIKE $${i} OR room ILIKE $${i} OR component_type ILIKE $${i} OR manufacturer ILIKE $${i} OR manufacturer_ref ILIKE $${i} OR atex_ref ILIKE $${i})`);
      values.push(`%${q}%`);
      i++;
    }
    if (buildings.length) { i = addLikeIn(where, values, i, 'building', buildings); }
    if (rooms.length) { i = addLikeIn(where, values, i, 'room', rooms); }
    if (types.length) { i = addLikeIn(where, values, i, 'component_type', types); }
    if (mans.length) { i = addLikeIn(where, values, i, 'manufacturer', mans); }
    if (statuses.length) { i = addLikeIn(where, values, i, 'status', statuses); }
    if (gases.length) { where.push(`zone_gas = ANY($${i}::int[])`); values.push(gases); i++; }
    if (dusts.length) { where.push(`zone_dust = ANY($${i}::int[])`); values.push(dusts); i++; }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const whitelist = ['id', 'building', 'room', 'component_type', 'manufacturer', 'manufacturer_ref', 'atex_ref', 'zone_gas', 'zone_dust', 'status', 'last_control', 'next_control', 'comments', 'frequency_months', 'created_at', 'updated_at'];
    const sortSafe = whitelist.includes(sort) ? sort : 'id';
    const dirSafe = (String(dir).toLowerCase() === 'asc') ? 'ASC' : 'DESC';
    const limit = Math.min(parseInt(pageSize, 10) || 100, 300);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    try {
      const { rows } = await runListQuery({ whereSql, values, sortSafe, dirSafe, limit, offset });
      return res.json(rows);
    } catch (e) {
      const isUnknownColumn = /column .* does not exist/i.test(e?.message || '');
      if (isUnknownColumn && sortSafe !== 'id') {
        console.warn(`[LIST] Unknown sort column "${sortSafe}", falling back to "id"`);
        const { rows } = await runListQuery({ whereSql, values, sortSafe: 'id', dirSafe, limit, offset });
        return res.json(rows);
      }
      throw e;
    }
  } catch (e) {
    console.error('[LIST] error:', e?.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// CREATE
app.post('/api/atex/equipments', async (req, res) => {
  try {
    const { site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref, zone_gas, zone_dust, last_control, next_control, comments, frequency_months } = req.body;

    const { status } = assessCompliance(atex_ref, zone_gas, zone_dust);
    const nextCtrl = next_control || addMonths(last_control, frequency_months ? Number(frequency_months) : 36);

    const { rows } = await pool.query(
      `INSERT INTO atex_equipments
       (site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
        zone_gas, zone_dust, status, last_control, next_control, comments, frequency_months)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref, zone_gas ?? null, zone_dust ?? null, status, last_control || null, nextCtrl || null, comments || null, frequency_months || 36]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[CREATE] error:', e?.message);
    res.status(500).json({ error: 'Create failed', details: e.message });
  }
});

// UPDATE
app.put('/api/atex/equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const patch = { ...req.body };

    const validFields = ['site', 'building', 'room', 'component_type', 'manufacturer', 'manufacturer_ref', 'atex_ref', 'zone_gas', 'zone_dust', 'last_control', 'next_control', 'comments', 'frequency_months'];
    const filteredPatch = {};
    for (const key of validFields) {
      if (patch[key] !== undefined) filteredPatch[key] = patch[key] === '' ? null : patch[key];
    }

    if ('atex_ref' in filteredPatch || 'zone_gas' in filteredPatch || 'zone_dust' in filteredPatch) {
      const cur = await pool.query('SELECT atex_ref, zone_gas, zone_dust FROM atex_equipments WHERE id=$1', [id]);
      const merged = {
        atex_ref: 'atex_ref' in filteredPatch ? filteredPatch.atex_ref : cur.rows[0]?.atex_ref,
        zone_gas: 'zone_gas' in filteredPatch ? filteredPatch.zone_gas : cur.rows[0]?.zone_gas,
        zone_dust: 'zone_dust' in filteredPatch ? filteredPatch.zone_dust : cur.rows[0]?.zone_dust,
      };
      filteredPatch.status = assessCompliance(merged.atex_ref, merged.zone_gas, merged.zone_dust).status;
    }

    if (filteredPatch.last_control && !filteredPatch.next_control) {
      const freq = Number(filteredPatch.frequency_months || 36);
      filteredPatch.next_control = addMonths(filteredPatch.last_control, freq);
    }

    const keys = Object.keys(filteredPatch);
    if (!keys.length) return res.status(400).json({ error: 'No fields to update' });

    const set = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
    const vals = keys.map(k => filteredPatch[k]);
    vals.push(id);

    const { rows } = await pool.query(`UPDATE atex_equipments SET ${set} WHERE id=$${keys.length + 1} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Equipment not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[UPDATE] error:', e?.message);
    res.status(500).json({ error: 'Update failed', details: e.message });
  }
});

// DELETE
app.delete('/api/atex/equipments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_equipments WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE] error:', e?.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Pièces jointes
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.get('/api/atex/equipments/:id/attachments', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, filename, mimetype, size, created_at FROM atex_attachments WHERE equipment_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(r.rows);
  } catch (e) {
    console.error('[ATTACH LIST] error:', e?.message);
    res.status(500).json({ error: 'Attachments list failed' });
  }
});
app.post('/api/atex/equipments/:id/attachments', uploadMem.array('files', 12), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });
    const results = [];
    for (const f of req.files) {
      const q = await pool.query('INSERT INTO atex_attachments (equipment_id, filename, mimetype, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mimetype, size, created_at', [id, f.originalname, f.mimetype, f.size, f.buffer]);
      results.push(q.rows[0]);
    }
    res.status(201).json(results);
  } catch (e) {
    console.error('[ATTACH UPLOAD] error:', e?.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});
app.get('/api/atex/attachments/:attId/download', async (req, res) => {
  try {
    const r = await pool.query('SELECT filename, mimetype, size, data FROM atex_attachments WHERE id=$1', [req.params.attId]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', row.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
    res.send(Buffer.from(row.data, 'binary'));
  } catch (e) {
    console.error('[ATTACH DL] error:', e?.message);
    res.status(500).json({ error: 'Download failed' });
  }
});
app.delete('/api/atex/attachments/:attId', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_attachments WHERE id=$1', [req.params.attId]);
    res.json({ success: true });
  } catch (e) {
    console.error('[ATTACH DEL] error:', e?.message);
    res.status(500).json({ error: 'Delete attachment failed' });
  }
});

// Analyse Photo (auto-remplissage)
app.post('/api/atex/photo-analysis', uploadMem.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY missing' });

    const base64 = req.file.buffer.toString('base64');
    const prompt = `\nAnalyze this equipment photo or label. Extract the following information if visible:\n- Manufacturer name (e.g., Schneider, Siemens)\n- Manufacturer reference or model number (e.g., 218143RT, NSX100F)\n- ATEX marking (e.g., II 2G Ex ib IIC T4 Gb, or similar full ATEX certification string)\n\nBe precise and only extract text that matches these fields. If not found or unclear, use null.\n\nReturn ONLY a JSON object with keys: manufacturer, manufacturer_ref, atex_ref.\n`.trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert in reading equipment labels and ATEX markings. Respond with JSON only.' },
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
          ]}
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 200
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[PHOTO ANALYSIS] OpenAI error:', errText);
      return res.status(500).json({ error: 'OpenAI analysis failed', details: errText });
    }

    const json = await resp.json();
    const analysis = json.choices?.[0]?.message?.content?.trim();

    let parsed;
    try { parsed = JSON.parse(analysis); } catch { return res.status(500).json({ error: 'Invalid JSON from analysis' }); }

    res.json({
      manufacturer: parsed.manufacturer || null,
      manufacturer_ref: parsed.manufacturer_ref || null,
      atex_ref: parsed.atex_ref || null
    });
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e?.message);
    res.status(500).json({ error: 'Photo analysis failed' });
  }
});

// Chat IA (analyse conformité textuelle)
app.post('/api/atex/ai/:id', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY manquant' });
    const id = req.params.id;
    const r = await pool.query('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    const eq = r.rows[0];
    if (!eq) return res.status(404).json({ error: 'Not found' });

    const prompt = `\nYou are an ATEX compliance expert. Analyze the equipment's compliance with ATEX standards. Provide a structured response in English:\n\n1) Reasons for non-compliance (if applicable, be specific about marking vs. zone mismatch, protection levels, etc.)\n\n2) Preventive measures\n\n3) Palliative measures\n\n4) Corrective actions\n\nBe concise and accurate. Recall: Gas zones - 0 (most hazardous), 1, 2 (least); Equipment category 1 for all, 2 for 1-2, 3 for 2 only. Similar for dust.\n\nEquipment:\n- Building: ${eq.building}\n- Room: ${eq.room}\n- Type: ${eq.component_type}\n- Manufacturer: ${eq.manufacturer}\n- Manufacturer Ref: ${eq.manufacturer_ref}\n- ATEX Marking: ${eq.atex_ref}\n- Gas Zone: ${eq.zone_gas ?? '—'}\n- Dust Zone: ${eq.zone_dust ?? '—'}\n- Current Status: ${eq.status}\n- Last Control: ${eq.last_control ?? '—'}\n- Next Control: ${eq.next_control ?? '—'}\n`.trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are an ATEX compliance expert. Respond in English only.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!resp.ok) return res.status(500).json({ error: 'OpenAI error', details: await resp.text() });
    const json = await resp.json();
    res.json({ analysis: json.choices?.[0]?.message?.content?.trim() || '—' });
  } catch (e) {
    console.error('[AI] error:', e?.message);
    res.status(500).json({ error: 'AI failed' });
  }
});

// Analytics + Export
app.get('/api/atex/analytics', async (req, res) => {
  try {
    const now = new Date();
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'Conforme' THEN 1 END) as compliant,
        COUNT(CASE WHEN status = 'Non conforme' THEN 1 END) as non_compliant,
        COUNT(CASE WHEN status = 'À vérifier' THEN 1 END) as to_review,
        COUNT(CASE WHEN next_control < $1 THEN 1 END) as overdue,
        COUNT(CASE WHEN next_control >= $1 AND next_control <= $2 THEN 1 END) as due_90_days,
        COUNT(CASE WHEN next_control > $2 THEN 1 END) as future
      FROM atex_equipments
    `, [now.toISOString().slice(0, 10), ninetyDaysFromNow.toISOString().slice(0, 10)]);

    const zones = await pool.query(`
      SELECT 
        COALESCE(zone_gas, 0) as gas_zone,
        COALESCE(zone_dust, 0) as dust_zone,
        COUNT(*) as count
      FROM atex_equipments 
      GROUP BY zone_gas, zone_dust 
      ORDER BY gas_zone, dust_zone
    `);

    const byType = await pool.query(`
      SELECT component_type, COUNT(*) as count
      FROM atex_equipments 
      GROUP BY component_type 
      ORDER BY count DESC 
      LIMIT 10
    `);

    const byBuilding = await pool.query(`
      SELECT building, COUNT(*) as count
      FROM atex_equipments 
      WHERE building IS NOT NULL AND building <> ''
      GROUP BY building 
      ORDER BY count DESC 
      LIMIT 10
    `);

    const riskEquipment = await pool.query(`
      SELECT id, component_type, building, room, zone_gas, zone_dust, status, next_control,
             $1::date - next_control::date as days_overdue
      FROM atex_equipments 
      WHERE next_control < $2 OR (next_control >= $1 AND next_control <= $3)
      ORDER BY next_control ASC
      LIMIT 20
    `, [now.toISOString().slice(0, 10), now.toISOString().slice(0, 10), ninetyDaysFromNow.toISOString().slice(0, 10)]);

    const complianceByZone = await pool.query(`
      SELECT 
        COALESCE(zone_gas, 0) as zone,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'Conforme' THEN 1 END) as compliant,
        COUNT(CASE WHEN status = 'Non conforme' THEN 1 END) as non_compliant,
        COUNT(CASE WHEN status = 'À vérifier' THEN 1 END) as to_review
      FROM atex_equipments 
      WHERE zone_gas IS NOT NULL 
      GROUP BY zone_gas 
      ORDER BY zone_gas
    `);

    res.json({
      stats: stats.rows[0],
      zones: zones.rows,
      byType: byType.rows,
      byBuilding: byBuilding.rows,
      riskEquipment: riskEquipment.rows,
      complianceByZone: complianceByZone.rows,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] error:', e?.message);
    res.status(500).json({ error: 'Analytics failed' });
  }
});

app.get('/api/atex/export', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        COALESCE(site, '') as site,
        COALESCE(building, '') as building,
        COALESCE(room, '') as room,
        COALESCE(component_type, '') as component_type,
        COALESCE(manufacturer, '') as manufacturer,
        COALESCE(manufacturer_ref, '') as manufacturer_ref,
        COALESCE(atex_ref, '') as atex_ref,
        zone_gas,
        zone_dust,
        COALESCE(status, '') as status,
        CASE WHEN last_control IS NOT NULL THEN last_control::text ELSE '' END as last_control,
        CASE WHEN next_control IS NOT NULL THEN next_control::text ELSE '' END as next_control,
        COALESCE(comments, '') as comments,
        COALESCE(frequency_months, 36)::text as frequency_months,
        CASE WHEN created_at IS NOT NULL THEN created_at::text ELSE '' END as created_at,
        CASE WHEN updated_at IS NOT NULL THEN updated_at::text ELSE '' END as updated_at
      FROM atex_equipments 
      ORDER BY building, room, component_type
    `);

    const exportData = rows.map(row => ({
      site: row.site,
      building: row.building,
      room: row.room,
      component_type: row.component_type,
      manufacturer: row.manufacturer,
      manufacturer_ref: row.manufacturer_ref,
      atex_ref: row.atex_ref,
      zone_gas: row.zone_gas || '',
      zone_dust: row.zone_dust || '',
      status: row.status,
      last_control: row.last_control ? row.last_control.slice(0, 10) : '',
      next_control: row.next_control ? row.next_control.slice(0, 10) : '',
      comments: row.comments,
      frequency_months: row.frequency_months,
      created_at: row.created_at ? row.created_at.slice(0, 19) : '',
      updated_at: row.updated_at ? row.updated_at.slice(0, 19) : ''
    }));

    res.json({ data: exportData, columns: Object.keys(exportData[0] || {}) });
  } catch (e) {
    console.error('[EXPORT] error:', e?.message);
    res.status(500).json({ error: 'Export failed: ' + e.message });
  }
});

// ======================================================================
//                                  Boot
// ======================================================================
const port = process.env.ATEX_PORT || 3001;
app.listen(port, () => console.log(`ATEX service listening on :${port}`));
