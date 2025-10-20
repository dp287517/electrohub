// server_atex.js
// Backend ATEX aligné "Doors-style" pour l'import ZIP (disk + pdf.js), BLOB en DB.
// Compatible 100% avec ta DB Neon et le front livré (parties 1/2 + 2/2).

import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import multer from 'multer';

// ==== FICHIERS / ZIP / PDF (pattern Doors) ====
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import StreamZip from 'node-stream-zip';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import crypto from 'crypto';

function resolvePdfWorker() {
  try { return require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'); }
  catch { return require.resolve('pdfjs-dist/build/pdf.worker.mjs'); }
}
pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorker();
const pdfjsPkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
const PDF_STANDARD_FONTS = path.join(pdfjsPkgDir, 'standard_fonts/');

// Dossiers temporaires (extraction ZIP)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.join(process.cwd(), 'uploads', 'atex');
const MAPS_TMP_DIR = path.join(DATA_ROOT, 'maps_tmp');
await fsp.mkdir(MAPS_TMP_DIR, { recursive: true });

// ==== App / Pool ====
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

// -----------------------------------------------------
// CORS
// -----------------------------------------------------
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-User-Email,X-User-Name,X-Site');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// -----------------------------------------------------
// Utils
// -----------------------------------------------------
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
function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }
function addLikeIn(where, values, i, field, arr) {
  if (!arr.length) return i;
  const slots = arr.map((_, k) => `$${i + k}`);
  where.push(`${field} IN (${slots.join(',')})`);
  values.push(...arr);
  return i + arr.length;
}
function getHeaderSite(req) {
  return (req.get('X-Site') || '').trim() || 'Nyon'; // défaut demandé
}

// -----------------------------------------------------
// Compliance helpers
// -----------------------------------------------------
function getCategoryFromMarking(ref, type) {
  const upper = (ref || '').toUpperCase();
  const match = upper.match(new RegExp(`II\\s*([1-3])${type}`, 'i'));
  return match ? parseInt(match[1], 10) : null;
}
function getRequiredCategory(zone, type) {
  const z = Number(zone);
  if (type === 'gas') {
    if (z === 0) return [1];
    if (z === 1) return [1, 2];
    if (z === 2) return [1, 2, 3];
  } else if (type === 'dust') {
    if (z === 20) return [1];
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
    if (catGas == null) {
      problems.push('No gas category (G) in ATEX marking for gas zone.');
    } else {
      const reqGas = getRequiredCategory(zone_gas, 'gas');
      if (reqGas && !reqGas.includes(catGas)) {
        problems.push(`Gas category ${catGas}G not suitable for zone ${zone_gas} (requires ${reqGas.join(' or ')}).`);
      }
    }
  }
  if (needsDust) {
    if (catDust == null) {
      problems.push('No dust category (D) in ATEX marking for dust zone.');
    } else {
      const reqDust = getRequiredCategory(zone_dust, 'dust');
      if (reqDust && !reqDust.includes(catDust)) {
        problems.push(`Dust category ${catDust}D not suitable for zone ${zone_dust} (requires ${reqDust.join(' or ')}).`);
      }
    }
  }
  return { status: problems.length ? 'Non conforme' : 'Conforme', problems };
}

// -----------------------------------------------------
// Schema (DDL) — crée ce qui manque, non destructif
// -----------------------------------------------------
async function ensureSchema() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- Base équipements (ajouts éventuels)
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='atex_equipments' AND column_name='frequency_months') THEN
        ALTER TABLE atex_equipments ADD COLUMN frequency_months INTEGER;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='atex_equipments' AND column_name='subarea_id') THEN
        ALTER TABLE atex_equipments ADD COLUMN subarea_id UUID NULL;
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='atex_equipments' AND column_name='photo_path') THEN
        ALTER TABLE atex_equipments ADD COLUMN photo_path TEXT NULL;
      END IF;
    END $$;

    -- Plans
    CREATE TABLE IF NOT EXISTS atex_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logical_name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      page_count INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Fichier PDF par logical_name (stockage DB pour simplicité du déploiement)
    CREATE TABLE IF NOT EXISTS atex_plan_files (
      logical_name TEXT PRIMARY KEY REFERENCES atex_plans(logical_name) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL DEFAULT 'application/pdf',
      size BIGINT NOT NULL,
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Positions
    CREATE TABLE IF NOT EXISTS atex_positions (
      equipment_id BIGINT NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      plan_logical_name TEXT NOT NULL REFERENCES atex_plans(logical_name) ON DELETE CASCADE,
      page_index INT NOT NULL DEFAULT 0,
      x_frac NUMERIC(8,6) NOT NULL CHECK (x_frac>=0 AND x_frac<=1),
      y_frac NUMERIC(8,6) NOT NULL CHECK (y_frac>=0 AND y_frac<=1),
      PRIMARY KEY (equipment_id, plan_logical_name, page_index)
    );
    CREATE INDEX IF NOT EXISTS atex_positions_by_plan_page ON atex_positions(plan_logical_name,page_index);

    -- Zones dessinées
    CREATE TABLE IF NOT EXISTS atex_subareas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_logical_name TEXT NOT NULL REFERENCES atex_plans(logical_name) ON DELETE CASCADE,
      page_index INT NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      shape_type TEXT NOT NULL CHECK (shape_type IN ('rect','poly','circle')),
      geometry JSONB NOT NULL,
      zone_gas INT NULL CHECK (zone_gas IN (0,1,2)),
      zone_dust INT NULL CHECK (zone_dust IN (20,21,22)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS atex_subareas_by_plan ON atex_subareas(plan_logical_name,page_index);

    -- Tags
    CREATE TABLE IF NOT EXISTS atex_tags (
      id BIGSERIAL PRIMARY KEY,
      tag TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS atex_equipment_tags (
      equipment_id BIGINT NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      tag_id BIGINT NOT NULL REFERENCES atex_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (equipment_id, tag_id)
    );

    -- Pièces jointes
    CREATE TABLE IF NOT EXISTS atex_attachments (
      id BIGSERIAL PRIMARY KEY,
      equipment_id BIGINT NOT NULL REFERENCES atex_equipments(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mimetype TEXT,
      size BIGINT,
      data BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Photo principale (binaire, 1 par équipement)
    CREATE TABLE IF NOT EXISTS atex_photos (
      equipment_id BIGINT PRIMARY KEY REFERENCES atex_equipments(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size BIGINT NOT NULL,
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
ensureSchema().catch(e => console.error('[ATEX SCHEMA] error:', e.message));

// -----------------------------------------------------
// Health
// -----------------------------------------------------
app.get('/api/atex/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// -----------------------------------------------------
// SUGGESTS
// -----------------------------------------------------
app.get('/api/atex/suggests', async (_req, res) => {
  try {
    const fields = ['building', 'room', 'component_type', 'manufacturer', 'manufacturer_ref', 'atex_ref'];
    const out = {};
    for (const f of fields) {
      const r = await pool.query(
        `SELECT DISTINCT ${f} FROM atex_equipments WHERE ${f} IS NOT NULL AND ${f}<>'' ORDER BY ${f} ASC LIMIT 200`
      );
      out[f] = r.rows.map(x => x[f]);
    }
    res.json(out);
  } catch (e) {
    console.error('[SUGGESTS] error:', e?.message);
    res.status(500).json({ error: 'Suggests failed' });
  }
});

// -----------------------------------------------------
// LIST (avec filtres/tri/pagination)
// -----------------------------------------------------
async function runListQuery({ whereSql, values, sortSafe, dirSafe, limit, offset }) {
  return pool.query(
    `SELECT * FROM atex_equipments ${whereSql} ORDER BY ${sortSafe} ${dirSafe} LIMIT ${limit} OFFSET ${offset}`,
    values
  );
}
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
      values.push(`%${q}%`); i++;
    }
    if (buildings.length) { i = addLikeIn(where, values, i, 'building', buildings); }
    if (rooms.length) { i = addLikeIn(where, values, i, 'room', rooms); }
    if (types.length) { i = addLikeIn(where, values, i, 'component_type', types); }
    if (mans.length) { i = addLikeIn(where, values, i, 'manufacturer', mans); }
    if (statuses.length) { i = addLikeIn(where, values, i, 'status', statuses); }
    if (gases.length) { where.push(`zone_gas = ANY($${i}::int[])`); values.push(gases); i++; }
    if (dusts.length) { where.push(`zone_dust = ANY($${i}::int[])`); values.push(dusts); i++; }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const whitelist = ['id','site','building','room','component_type','manufacturer','manufacturer_ref','atex_ref','zone_gas','zone_dust','status','last_control','next_control','comments','frequency_months','created_at','updated_at'];
    const sortSafe = whitelist.includes(sort) ? sort : 'id';
    const dirSafe = (String(dir).toLowerCase() === 'asc') ? 'ASC' : 'DESC';
    const limit = Math.min(parseInt(pageSize, 10) || 100, 300);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    try {
      const { rows } = await runListQuery({ whereSql, values, sortSafe, dirSafe, limit, offset });
      return res.json(rows);
    } catch (e) {
      if (/column .* does not exist/i.test(e?.message || '') && sortSafe !== 'id') {
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

// -----------------------------------------------------
// CREATE / UPDATE / DELETE
// -----------------------------------------------------
app.post('/api/atex/equipments', async (req, res) => {
  try {
    const {
      site, building, room, component_type, manufacturer, manufacturer_ref,
      atex_ref, zone_gas, zone_dust, last_control, next_control,
      comments, frequency_months
    } = req.body;

    const siteVal = (site || '').trim() || getHeaderSite(req) || 'Nyon';
    const { status } = assessCompliance(atex_ref, zone_gas, zone_dust);
    const nextCtrl = next_control || addMonths(last_control, frequency_months ? Number(frequency_months) : 36);

    const { rows } = await pool.query(
      `INSERT INTO atex_equipments
       (site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
        zone_gas, zone_dust, status, last_control, next_control, comments, frequency_months)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [siteVal, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
       zone_gas ?? null, zone_dust ?? null, status, last_control || null, nextCtrl || null,
       comments || null, frequency_months || 36]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[CREATE] error:', e?.message);
    res.status(500).json({ error: 'Create failed', details: e.message });
  }
});

app.put('/api/atex/equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const patch = { ...req.body };

    const validFields = [
      'site', 'building', 'room', 'component_type', 'manufacturer', 'manufacturer_ref',
      'atex_ref', 'zone_gas', 'zone_dust', 'last_control', 'next_control', 'comments', 'frequency_months', 'subarea_id'
    ];
    const filteredPatch = {};
    for (const key of validFields) {
      if (patch[key] !== undefined) {
        filteredPatch[key] = patch[key] === '' ? null : patch[key];
      }
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

app.delete('/api/atex/equipments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_equipments WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE] error:', e?.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// -----------------------------------------------------
// Pièces jointes (atex_attachments)
// -----------------------------------------------------
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.get('/api/atex/equipments/:id/attachments', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, filename, mimetype, size, created_at FROM atex_attachments WHERE equipment_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
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
      const q = await pool.query(
        'INSERT INTO atex_attachments (equipment_id, filename, mimetype, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mimetype, size, created_at',
        [id, f.originalname, f.mimetype, f.size, f.buffer]
      );
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

// -----------------------------------------------------
// Photo PRINCIPALE (comme Doors) — stockée dans atex_photos
// -----------------------------------------------------
app.get('/api/atex/equipments/:id/photo', async (req, res) => {
  try {
    const r = await pool.query('SELECT filename, mimetype, size, data FROM atex_photos WHERE equipment_id=$1', [req.params.id]);
    const row = r.rows[0];
    if (!row) return res.status(404).end();
    res.setHeader('Content-Type', row.mimetype || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
    res.send(Buffer.from(row.data, 'binary'));
  } catch (e) {
    console.error('[PHOTO GET] error:', e?.message);
    res.status(500).json({ error: 'Photo get failed' });
  }
});

app.post('/api/atex/equipments/:id/photo', uploadMem.single('photo'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'No photo' });
    const { originalname, mimetype, size, buffer } = req.file;
    await pool.query(`
      INSERT INTO atex_photos (equipment_id, filename, mimetype, size, data)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (equipment_id) DO UPDATE
        SET filename=EXCLUDED.filename, mimetype=EXCLUDED.mimetype, size=EXCLUDED.size, data=EXCLUDED.data, updated_at=now()
    `, [id, originalname, mimetype, size, buffer]);

    // chemin "virtuel" exploitable côté front
    await pool.query(`UPDATE atex_equipments SET photo_path=$1 WHERE id=$2`, [`/api/atex/equipments/${id}/photo`, id]);

    res.json({ ok: true, url: `/api/atex/equipments/${id}/photo` });
  } catch (e) {
    console.error('[PHOTO POST] error:', e?.message);
    res.status(500).json({ error: 'Photo upload failed' });
  }
});

// -----------------------------------------------------
// Analyse Photo — SINGLE + BATCH multi-photos
// -----------------------------------------------------
async function openAIJsonImageExtract(base64List) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  const prompt = `
Analyze one or several equipment photos/labels. Extract the following if visible:
- manufacturer
- manufacturer_ref
- atex_ref (full ATEX marking string if possible)

Return a single JSON object with keys {manufacturer, manufacturer_ref, atex_ref}, merging all inputs.
Prefer consistent, exact strings from images.
`.trim();

  const images = base64List.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }));
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role:'system', content:'You are an expert in reading equipment labels and ATEX markings. Respond with JSON only.' },
        { role:'user', content: [{ type:'text', text: prompt }, ...images] }
      ],
      response_format: { type:'json_object' },
      temperature: 0.2,
      max_tokens: 300
    })
  });
  if (!resp.ok) throw new Error(await resp.text());
  const json = await resp.json();
  const txt = json.choices?.[0]?.message?.content?.trim() || '{}';
  return JSON.parse(txt);
}

app.post('/api/atex/photo-analysis', uploadMem.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    const base64 = req.file.buffer.toString('base64');
    const parsed = await openAIJsonImageExtract([base64]);
    res.json({
      manufacturer: parsed.manufacturer || null,
      manufacturer_ref: parsed.manufacturer_ref || null,
      atex_ref: parsed.atex_ref || null
    });
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e?.message);
    res.status(500).json({ error: 'Photo analysis failed', details: e.message });
  }
});

app.post('/api/atex/photo-analysis/batch', uploadMem.array('files', 8), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files' });
    const base64List = files.map(f => f.buffer.toString('base64'));
    const parsed = await openAIJsonImageExtract(base64List);
    res.json({
      manufacturer: parsed.manufacturer || null,
      manufacturer_ref: parsed.manufacturer_ref || null,
      atex_ref: parsed.atex_ref || null
    });
  } catch (e) {
    console.error('[PHOTO ANALYSIS BATCH] error:', e?.message);
    res.status(500).json({ error: 'Photo analysis batch failed', details: e.message });
  }
});

// -----------------------------------------------------
// Analytics & Export
// -----------------------------------------------------
app.get('/api/atex/analytics', async (_req, res) => {
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
    `, [now.toISOString().slice(0,10), ninetyDaysFromNow.toISOString().slice(0,10)]);

    const zones = await pool.query(`
      SELECT COALESCE(zone_gas, 0) as gas_zone, COALESCE(zone_dust, 0) as dust_zone, COUNT(*) as count
      FROM atex_equipments GROUP BY zone_gas, zone_dust ORDER BY gas_zone, dust_zone
    `);

    const byType = await pool.query(`
      SELECT component_type, COUNT(*) as count
      FROM atex_equipments GROUP BY component_type ORDER BY count DESC LIMIT 10
    `);

    const byBuilding = await pool.query(`
      SELECT building, COUNT(*) as count
      FROM atex_equipments 
      WHERE building IS NOT NULL AND building <> ''
      GROUP BY building ORDER BY count DESC LIMIT 10
    `);

    const riskEquipment = await pool.query(`
      SELECT id, component_type, building, room, zone_gas, zone_dust, status, next_control,
             $1::date - next_control::date as days_overdue
      FROM atex_equipments 
      WHERE next_control < $2 OR (next_control >= $1 AND next_control <= $3)
      ORDER BY next_control ASC
      LIMIT 20
    `, [now.toISOString().slice(0,10), now.toISOString().slice(0,10), ninetyDaysFromNow.toISOString().slice(0,10)]);

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

app.get('/api/atex/export', async (_req, res) => {
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
        zone_gas, zone_dust,
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

// -----------------------------------------------------
// MAPS ATEX — plans & positions (base viewer)
// -----------------------------------------------------

// 1) Liste plans
app.get('/api/atex/maps/plans', async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, logical_name, display_name, page_count, created_at
      FROM atex_plans ORDER BY created_at DESC
    `);
    res.json({ plans: r.rows });
  } catch (e) {
    console.error('[MAPS plans] error:', e?.message);
    res.status(500).json({ error: 'List plans failed' });
  }
});

// 2) Rename plan (display_name)
app.put('/api/atex/maps/rename/:logical', async (req, res) => {
  try {
    const { logical } = req.params;
    const { display_name } = req.body || {};
    await pool.query(`UPDATE atex_plans SET display_name=$1 WHERE logical_name=$2`, [display_name || null, logical]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[MAPS rename] error:', e?.message);
    res.status(500).json({ error: 'Rename plan failed' });
  }
});

// 3) Upload ZIP de plans (disk, pdf.js) — écrasement NON destructif des positions
const uploadZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MAPS_TMP_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

async function pdfPageCountFromFile(absPath) {
  const data = new Uint8Array(await fsp.readFile(absPath));
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: PDF_STANDARD_FONTS }).promise;
  const n = doc.numPages || 1;
  await doc.cleanup();
  return n;
}

app.post('/api/atex/maps/upload-zip', uploadZip.single('file'), async (req, res) => {
  const zipPath = req.file?.path;
  if (!zipPath) return res.status(400).json({ error: 'No ZIP file' });

  const zip = new StreamZip.async({ file: zipPath, storeEntries: true });
  const imported = [];
  try {
    const entries = await zip.entries();
    const pdfs = Object.values(entries).filter(e => !e.isDirectory && /\.pdf$/i.test(e.name));
    if (!pdfs.length) return res.status(400).json({ error: 'ZIP must contain at least one PDF' });

    for (const entry of pdfs) {
      // extrait chaque PDF vers un tmp file
      const tmpOut = path.join(MAPS_TMP_DIR, `${crypto.randomUUID()}.pdf`);
      await zip.extract(entry.name, tmpOut);

      // logical_name = nom de fichier sans .pdf
      const filename = path.basename(entry.name);
      const logical = filename.replace(/\.pdf$/i, '');

      // compte pages & lit le BLOB
      const page_count = await pdfPageCountFromFile(tmpOut).catch(() => 1);
      const buf = await fsp.readFile(tmpOut);

      // upsert plan (nom + page_count) — garde display_name si déjà défini
      await pool.query(`
        INSERT INTO atex_plans (logical_name, display_name, page_count)
        VALUES ($1, $2, $3)
        ON CONFLICT (logical_name) DO UPDATE
          SET display_name = COALESCE(atex_plans.display_name, EXCLUDED.display_name),
              page_count   = EXCLUDED.page_count
      `, [logical, logical, page_count]);

      // upsert fichier en BLOB dans atex_plan_files
      await pool.query(`
        INSERT INTO atex_plan_files (logical_name, filename, mimetype, size, data)
        VALUES ($1,$2,'application/pdf',$3,$4)
        ON CONFLICT (logical_name) DO UPDATE
          SET filename=EXCLUDED.filename,
              size=EXCLUDED.size,
              data=EXCLUDED.data,
              updated_at=now()
      `, [logical, filename, buf.length, buf]);

      imported.push({ logical_name: logical, filename, page_count, size: buf.length });

      // nettoyage du tmp
      try { await fsp.unlink(tmpOut); } catch {}
    }

    res.json({ ok: true, imported: imported.length, details: imported });
  } catch (e) {
    console.error('[MAPS upload-zip] error:', e?.message);
    res.status(500).json({ error: 'Upload ZIP failed', details: e.message });
  } finally {
    await zip.close().catch(() => {});
    try { fs.rmSync(zipPath, { force: true }); } catch {}
  }
});

// 4) Servir un PDF plan pour rendu PDF.js
app.get('/api/atex/maps/plan/:logical/file', async (req, res) => {
  try {
    const { logical } = req.params;
    const r = await pool.query(`SELECT filename, mimetype, size, data FROM atex_plan_files WHERE logical_name=$1`, [logical]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Plan file not found' });
    res.setHeader('Content-Type', row.mimetype || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
    res.send(Buffer.from(row.data, 'binary'));
  } catch (e) {
    console.error('[MAPS plan file] error:', e?.message);
    res.status(500).json({ error: 'Serve plan failed' });
  }
});

// 5) Positions (GET)
app.get('/api/atex/maps/positions', async (req, res) => {
  try {
    const logical = String(req.query.logical_name || '').trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.json({ items: [] });

    const { rows } = await pool.query(
      `
      SELECT e.id AS equipment_id, e.component_type, e.building, e.room,
             p.x_frac, p.y_frac, e.status, e.zone_gas, e.zone_dust
        FROM atex_positions p
        JOIN atex_equipments e ON e.id = p.equipment_id
       WHERE p.plan_logical_name = $1 AND p.page_index = $2
       ORDER BY e.id ASC
      `,
      [logical, pageIndex]
    );

    res.json({ items: rows });
  } catch (e) {
    console.error('[MAPS positions GET] error:', e?.message);
    res.status(500).json({ error: 'Positions get failed' });
  }
});

// 6) Positions (PUT) — set/replace position for an equipment on given plan/page
app.put('/api/atex/maps/positions/:equipmentId', async (req, res) => {
  try {
    const equipmentId = Number(req.params.equipmentId);
    const { logical_name, page_index = 0, x_frac, y_frac } = req.body || {};
    if (!equipmentId || !logical_name || x_frac == null || y_frac == null) {
      return res.status(400).json({ error: 'Missing fields (equipmentId, logical_name, x_frac, y_frac)' });
    }
    if (x_frac < 0 || x_frac > 1 || y_frac < 0 || y_frac > 1) {
      return res.status(400).json({ error: 'x_frac/y_frac must be within [0,1]' });
    }

    await pool.query(`
      INSERT INTO atex_positions (equipment_id, plan_logical_name, page_index, x_frac, y_frac)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (equipment_id, plan_logical_name, page_index)
      DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac
    `, [equipmentId, logical_name, Number(page_index), Number(x_frac), Number(y_frac)]);

    res.json({ ok: true });
  } catch (e) {
    console.error('[MAPS positions PUT] error:', e?.message);
    res.status(500).json({ error: 'Positions save failed' });
  }
});

// 7) Équipements SANS position pour un plan/page
app.get('/api/atex/maps/unplaced', async (req, res) => {
  try {
    const logical = String(req.query.logical_name || '').trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.json({ items: [] });

    const { rows } = await pool.query(`
      SELECT e.id, e.component_type, e.building, e.room, e.status, e.zone_gas, e.zone_dust
        FROM atex_equipments e
        LEFT JOIN atex_positions p
          ON p.equipment_id = e.id
         AND p.plan_logical_name = $1
         AND p.page_index = $2
       WHERE p.equipment_id IS NULL
       ORDER BY e.id ASC
    `, [logical, pageIndex]);

    res.json({ items: rows });
  } catch (e) {
    console.error('[MAPS unplaced] error:', e?.message);
    res.status(500).json({ error: 'Unplaced get failed' });
  }
});

// -----------------------------------------------------
// Chat IA
// -----------------------------------------------------
app.post('/api/atex/ai/:id', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY manquant' });
    const id = req.params.id;
    const r = await pool.query('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    const eq = r.rows[0];
    if (!eq) return res.status(404).json({ error: 'Not found' });

    const prompt = `
You are an ATEX compliance expert. Analyze the equipment's compliance with ATEX standards. Provide a structured response in English:

1) Reasons for non-compliance (if applicable)
2) Preventive measures
3) Palliative measures
4) Corrective actions

Equipment:
- Building: ${eq.building}
- Room: ${eq.room}
- Type: ${eq.component_type}
- Manufacturer: ${eq.manufacturer}
- Manufacturer Ref: ${eq.manufacturer_ref}
- ATEX Marking: ${eq.atex_ref}
- Gas Zone: ${eq.zone_gas ?? '—'}
- Dust Zone: ${eq.zone_dust ?? '—'}
- Current Status: ${eq.status}
- Last Control: ${eq.last_control ?? '—'}
- Next Control: ${eq.next_control ?? '—'}
`.trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role:'system', content:'You are an ATEX compliance expert. Respond in English only.' },
          { role:'user', content: prompt }
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

// ==============================
// PARTIE 2 — Subareas / géométrie
// ==============================

// ---------- Helpers géométrie (point in shape) ----------
function pointInRect(pt, rect) {
  const { x, y } = pt;
  const { x: rx, y: ry, w, h } = rect || {};
  if ([x,y,rx,ry,w,h].some(v => typeof v !== 'number')) return false;
  return x >= rx && x <= rx + w && y >= ry && y <= ry + h;
}
function pointInPoly(pt, poly) {
  const { x, y } = pt;
  const pts = (poly?.points || []).filter(p => typeof p.x === 'number' && typeof p.y === 'number');
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInCircle(pt, circle) {
  const { x, y } = pt;
  const { cx, cy, r } = circle || {};
  if ([x,y,cx,cy,r].some(v => typeof v !== 'number')) return false;
  const dx = x - cx, dy = y - cy;
  return (dx*dx + dy*dy) <= (r*r);
}
function pointInShape(pt, shape_type, geometry) {
  try {
    if (shape_type === 'rect')   return pointInRect(pt, geometry);
    if (shape_type === 'poly')   return pointInPoly(pt, geometry);
    if (shape_type === 'circle') return pointInCircle(pt, geometry);
  } catch {}
  return false;
}

// ---------- SUBAREAS (zones dessinées) ----------
app.get('/api/atex/maps/subareas', async (req, res) => {
  try {
    const logical = String(req.query.logical_name || '').trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.json({ items: [] });

    const r = await pool.query(
      `SELECT id, plan_logical_name, page_index, name, shape_type, geometry, zone_gas, zone_dust, created_at
         FROM atex_subareas
        WHERE plan_logical_name=$1 AND page_index=$2
        ORDER BY created_at ASC`,
      [logical, pageIndex]
    );
    res.json({ items: r.rows });
  } catch (e) {
    console.error('[SUBAREAS GET] error:', e?.message);
    res.status(500).json({ error: 'Subareas get failed' });
  }
});

app.post('/api/atex/maps/subareas', async (req, res) => {
  try {
    const { logical_name, page_index=0, name, shape_type, geometry, zone_gas=null, zone_dust=null } = req.body || {};
    if (!logical_name || !name || !shape_type || !geometry) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const r = await pool.query(
      `INSERT INTO atex_subareas (plan_logical_name, page_index, name, shape_type, geometry, zone_gas, zone_dust)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       RETURNING *`,
      [logical_name, Number(page_index), String(name), String(shape_type), JSON.stringify(geometry),
       zone_gas===''?null:zone_gas, zone_dust===''?null:zone_dust]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('[SUBAREAS POST] error:', e?.message);
    res.status(500).json({ error: 'Subarea create failed' });
  }
});

app.put('/api/atex/maps/subareas/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const patch = {};
    const allowed = ['name','shape_type','geometry','zone_gas','zone_dust'];
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields' });

    const sets = [];
    const vals = [];
    let i = 1;
    if ('name' in patch)       { sets.push(`name=$${i++}`);       vals.push(patch.name); }
    if ('shape_type' in patch) { sets.push(`shape_type=$${i++}`); vals.push(patch.shape_type); }
    if ('geometry' in patch)   { sets.push(`geometry=$${i++}::jsonb`); vals.push(JSON.stringify(patch.geometry)); }
    if ('zone_gas' in patch)   { sets.push(`zone_gas=$${i++}`);   vals.push(patch.zone_gas===''?null:patch.zone_gas); }
    if ('zone_dust' in patch)  { sets.push(`zone_dust=$${i++}`);  vals.push(patch.zone_dust===''?null:patch.zone_dust); }
    vals.push(id);

    const r = await pool.query(`UPDATE atex_subareas SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, vals);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[SUBAREAS PUT] error:', e?.message);
    res.status(500).json({ error: 'Subarea update failed' });
  }
});

app.delete('/api/atex/maps/subareas/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    await pool.query(`DELETE FROM atex_subareas WHERE id=$1`, [id]);
    await pool.query(`UPDATE atex_equipments SET subarea_id=NULL WHERE subarea_id::text=$1`, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[SUBAREAS DEL] error:', e?.message);
    res.status(500).json({ error: 'Subarea delete failed' });
  }
});

// Appliquer les zones d’une page aux équipements placés
app.post('/api/atex/maps/subareas/apply', async (req, res) => {
  try {
    const { logical_name, page_index=0 } = req.body || {};
    if (!logical_name) return res.status(400).json({ error: 'logical_name required' });

    const [posQ, saQ] = await Promise.all([
      pool.query(`
        SELECT p.equipment_id, p.x_frac::float8 AS x, p.y_frac::float8 AS y
          FROM atex_positions p
         WHERE p.plan_logical_name=$1 AND p.page_index=$2
      `, [logical_name, Number(page_index)]),
      pool.query(`
        SELECT id, shape_type, geometry, zone_gas, zone_dust
          FROM atex_subareas
         WHERE plan_logical_name=$1 AND page_index=$2
      `, [logical_name, Number(page_index)])
    ]);

    const subareas = saQ.rows.map(sa => ({
      id: sa.id,
      shape_type: sa.shape_type,
      geometry: sa.geometry,
      zone_gas: sa.zone_gas,
      zone_dust: sa.zone_dust
    }));

    let updated = 0;
    for (const p of posQ.rows) {
      const pt = { x: Number(p.x), y: Number(p.y) };
      const found = subareas.find(sa => pointInShape(pt, sa.shape_type, sa.geometry));
      if (!found) {
        await pool.query(`UPDATE atex_equipments SET subarea_id=NULL WHERE id=$1`, [p.equipment_id]);
        continue;
      }

      // applique subarea + zones si renseignées, puis recalcule le status
      const curQ = await pool.query(`SELECT atex_ref, zone_gas, zone_dust FROM atex_equipments WHERE id=$1`, [p.equipment_id]);
      const cur = curQ.rows[0] || {};
      const newZG = found.zone_gas ?? cur.zone_gas;
      const newZD = found.zone_dust ?? cur.zone_dust;
      const newStatus = assessCompliance(cur.atex_ref, newZG, newZD).status;

      await pool.query(
        `UPDATE atex_equipments SET subarea_id=$1, zone_gas=$2, zone_dust=$3, status=$4 WHERE id=$5`,
        [found.id, newZG ?? null, newZD ?? null, newStatus, p.equipment_id]
      );
      updated++;
    }

    res.json({ ok: true, updated, total: posQ.rowCount });
  } catch (e) {
    console.error('[SUBAREAS APPLY] error:', e?.message);
    res.status(500).json({ error: 'Apply subareas failed' });
  }
});

// ---------- CREATE-ON-MAP (création via plan) ----------
app.post('/api/atex/maps/equipments', async (req, res) => {
  try {
    const {
      logical_name, page_index=0, x_frac, y_frac,
      building=null, room=null, component_type=null,
      manufacturer=null, manufacturer_ref=null, atex_ref=null,
      zone_gas=null, zone_dust=null, frequency_months=36, comments=null
    } = req.body || {};
    if (!logical_name || x_frac==null || y_frac==null) {
      return res.status(400).json({ error: 'Missing logical_name/x_frac/y_frac' });
    }
    if (x_frac<0 || x_frac>1 || y_frac<0 || y_frac>1) {
      return res.status(400).json({ error: 'x_frac/y_frac must be within [0,1]' });
    }

    const site = getHeaderSite(req) || 'Nyon';
    const { status } = assessCompliance(atex_ref, zone_gas, zone_dust);

    const eq = await pool.query(
      `INSERT INTO atex_equipments
         (site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
          zone_gas, zone_dust, status, comments, frequency_months)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
       zone_gas, zone_dust, status, comments, frequency_months]
    );
    const newEq = eq.rows[0];

    await pool.query(
      `INSERT INTO atex_positions (equipment_id, plan_logical_name, page_index, x_frac, y_frac)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (equipment_id,plan_logical_name,page_index)
       DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac`,
      [newEq.id, logical_name, Number(page_index), Number(x_frac), Number(y_frac)]
    );

    res.status(201).json({ equipment: newEq });
  } catch (e) {
    console.error('[CREATE ON MAP] error:', e?.message);
    res.status(500).json({ error: 'Create-on-map failed' });
  }
});

// ---------- DUPLICATION (clone) ----------
app.post('/api/atex/maps/positions/:equipmentId/clone', async (req, res) => {
  try {
    const sourceId = Number(req.params.equipmentId);
    const { logical_name, page_index=0, x_frac=null, y_frac=null } = req.body || {};
    if (!sourceId || !logical_name) return res.status(400).json({ error: 'Missing fields' });

    const [eqQ, posQ] = await Promise.all([
      pool.query(`SELECT * FROM atex_equipments WHERE id=$1`, [sourceId]),
      pool.query(`SELECT x_frac::float8 AS x, y_frac::float8 AS y FROM atex_positions WHERE equipment_id=$1 AND plan_logical_name=$2 AND page_index=$3`,
        [sourceId, logical_name, Number(page_index)])
    ]);
    const src = eqQ.rows[0];
    if (!src) return res.status(404).json({ error: 'Source equipment not found' });

    const xx = (x_frac==null) ? (posQ.rows[0]?.x ?? 0.5) : Number(x_frac);
    const yy = (y_frac==null) ? (posQ.rows[0]?.y ?? 0.5) : Number(y_frac);

    const ins = await pool.query(`
      INSERT INTO atex_equipments
        (site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
         zone_gas, zone_dust, status, comments, frequency_months)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [src.site, src.building, src.room, src.component_type, src.manufacturer, src.manufacturer_ref, src.atex_ref,
       src.zone_gas, src.zone_dust, src.status, src.comments, src.frequency_months]
    );
    const clone = ins.rows[0];

    await pool.query(`
      INSERT INTO atex_positions (equipment_id, plan_logical_name, page_index, x_frac, y_frac)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (equipment_id, plan_logical_name, page_index)
      DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac
    `, [clone.id, logical_name, Number(page_index), xx, yy]);

    res.status(201).json({ clone });
  } catch (e) {
    console.error('[CLONE] error:', e?.message);
    res.status(500).json({ error: 'Clone failed' });
  }
});

// ---------- TAGS ----------
app.get('/api/atex/tags', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id, tag FROM atex_tags ORDER BY tag ASC`);
    res.json({ tags: r.rows });
  } catch (e) {
    console.error('[TAGS GET] error:', e?.message);
    res.status(500).json({ error: 'Tags get failed' });
  }
});

app.post('/api/atex/tags', async (req, res) => {
  try {
    const tag = String(req.body?.tag || '').trim();
    if (!tag) return res.status(400).json({ error: 'tag required' });
    const r = await pool.query(`
      INSERT INTO atex_tags (tag) VALUES ($1)
      ON CONFLICT (tag) DO UPDATE SET tag=EXCLUDED.tag
      RETURNING id, tag
    `, [tag]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('[TAGS POST] error:', e?.message);
    res.status(500).json({ error: 'Tag create failed' });
  }
});

app.post('/api/atex/equipments/:id/tags', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tagTxt = String(req.body?.tag || '').trim();
    if (!tagTxt) return res.status(400).json({ error: 'tag required' });

    const t = await pool.query(`
      INSERT INTO atex_tags (tag) VALUES ($1)
      ON CONFLICT (tag) DO UPDATE SET tag=EXCLUDED.tag
      RETURNING id, tag
    `, [tagTxt]);
    const tagId = t.rows[0].id;

    await pool.query(`
      INSERT INTO atex_equipment_tags (equipment_id, tag_id)
      VALUES ($1,$2) ON CONFLICT DO NOTHING
    `, [id, tagId]);

    const r = await pool.query(`
      SELECT et.tag_id, t.tag FROM atex_equipment_tags et
      JOIN atex_tags t ON t.id=et.tag_id
      WHERE et.equipment_id=$1 ORDER BY t.tag
    `, [id]);

    res.status(201).json({ tags: r.rows });
  } catch (e) {
    console.error('[EQ TAG ADD] error:', e?.message);
    res.status(500).json({ error: 'Equip tag add failed' });
  }
});

app.delete('/api/atex/equipments/:id/tags/:tag', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tagTxt = decodeURIComponent(String(req.params.tag || '')).trim();
    if (!tagTxt) return res.status(400).json({ error: 'tag required' });
    const t = await pool.query(`SELECT id FROM atex_tags WHERE tag=$1`, [tagTxt]);
    const tagId = t.rows[0]?.id;
    if (!tagId) return res.json({ success: true });

    await pool.query(`DELETE FROM atex_equipment_tags WHERE equipment_id=$1 AND tag_id=$2`, [id, tagId]);
    res.json({ success: true });
  } catch (e) {
    console.error('[EQ TAG DEL] error:', e?.message);
    res.status(500).json({ error: 'Equip tag delete failed' });
  }
});

// ---------- utilitaires maps ----------
app.get('/api/atex/maps/summary', async (req, res) => {
  try {
    const logical = String(req.query.logical_name || '').trim();
    const pageIndex = Number(req.query.page_index || 0);
    if (!logical) return res.json({ placed: 0, unplaced: 0 });

    const placedQ = await pool.query(`
      SELECT COUNT(*)::int AS c FROM atex_positions
       WHERE plan_logical_name=$1 AND page_index=$2
    `, [logical, pageIndex]);

    const unplacedQ = await pool.query(`
      SELECT COUNT(*)::int AS c
        FROM atex_equipments e
        LEFT JOIN atex_positions p
          ON p.equipment_id=e.id
         AND p.plan_logical_name=$1
         AND p.page_index=$2
       WHERE p.equipment_id IS NULL
    `, [logical, pageIndex]);

    res.json({ placed: placedQ.rows[0].c, unplaced: unplacedQ.rows[0].c });
  } catch (e) {
    console.error('[MAPS SUMMARY] error:', e?.message);
    res.status(500).json({ error: 'Summary failed' });
  }
});

app.post('/api/atex/maps/positions/reassign', async (req, res) => {
  try {
    const { from_logical, to_logical, page_index=0 } = req.body || {};
    if (!from_logical || !to_logical) return res.status(400).json({ error: 'from_logical/to_logical required' });
    const src = await pool.query(`
      SELECT equipment_id, x_frac, y_frac
        FROM atex_positions
       WHERE plan_logical_name=$1 AND page_index=$2
    `, [from_logical, Number(page_index)]);

    let upserts = 0;
    for (const row of src.rows) {
      await pool.query(`
        INSERT INTO atex_positions (equipment_id, plan_logical_name, page_index, x_frac, y_frac)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (equipment_id, plan_logical_name, page_index)
        DO UPDATE SET x_frac=EXCLUDED.x_frac, y_frac=EXCLUDED.y_frac
      `, [row.equipment_id, to_logical, Number(page_index), Number(row.x_frac), Number(row.y_frac)]);
      upserts++;
    }
    res.json({ ok: true, count: upserts });
  } catch (e) {
    console.error('[REASSIGN POS] error:', e?.message);
    res.status(500).json({ error: 'Reassign failed' });
  }
});

// -----------------------------------------------------
// Start + export
// -----------------------------------------------------
const port = process.env.ATEX_PORT || 3001;
app.listen(port, () => console.log(`ATEX service listening on :${port}`));

export default app;
