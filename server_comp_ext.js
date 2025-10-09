/* server_comp_ext.js (ESM)
 * Backend for "Prestataires externes" (comp-ext) — ES Module compatible
 * Requires: node >= 18, packages: express, pg, multer, cors
 *
 * ENV:
 *  - DATABASE_URL (PostgreSQL connection string)
 *  - FILES_DIR (optional, default ./uploads/comp_ext)
 *  - COMP_EXT_PORT (optional, default 3014)
 */

import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// ---------- ESM dirname helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config ----------
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/comp_ext';
const FILES_DIR = process.env.FILES_DIR || path.join(__dirname, 'uploads', 'comp_ext');
fs.mkdirSync(FILES_DIR, { recursive: true });

// DB pool
const pool = new Pool({ connectionString: DATABASE_URL });

// Express app
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FILES_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${unique}-${safe}`);
  },
});
const upload = multer({ storage });

// ---------- Utils ----------
function toISODate(d) {
  if (!d) return null;
  const x = new Date(d);
  const y = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  return y.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const MS = 24 * 3600 * 1000;
  const d = Math.floor((new Date(a).setHours(0,0,0,0) - new Date(b).setHours(0,0,0,0)) / MS);
  return d;
}

// ---------- Schema & migrations ----------
async function ensureSchema() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_vendors (
        id               BIGSERIAL PRIMARY KEY,
        name             TEXT NOT NULL,
        offer_status     TEXT NOT NULL DEFAULT 'en_attente' CHECK (offer_status IN ('en_attente','reçue','recue','po_faite')),
        jsa_status       TEXT NOT NULL DEFAULT 'en_attente',
        pp_applicable    BOOLEAN NOT NULL DEFAULT FALSE,
        pp_link          TEXT,
        work_permit_required BOOLEAN NOT NULL DEFAULT FALSE,
        work_permit_link  TEXT,
        access_status    TEXT NOT NULL DEFAULT 'a_faire'     CHECK (access_status IN ('a_faire','fait')),
        pre_qual_status  TEXT NOT NULL DEFAULT 'non_fait',
        sap_wo           TEXT,
        owner            TEXT,
        visits_slots     INT NOT NULL DEFAULT 1,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Normalize JSA check to include the four states
    await c.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'comp_ext_vendors'::regclass
            AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%jsa_status%'
        LOOP
          EXECUTE 'ALTER TABLE comp_ext_vendors DROP CONSTRAINT ' || quote_ident(r.conname);
        END LOOP;
      END$$;
    `);
    await c.query(`
      ALTER TABLE comp_ext_vendors
      ADD CONSTRAINT comp_ext_vendors_jsa_check CHECK (jsa_status IN ('en_attente','transmis','receptionne','signe'));
    `);

    // Add/ensure columns
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS work_permit_required BOOLEAN NOT NULL DEFAULT FALSE;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS work_permit_link TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS visits_slots INT NOT NULL DEFAULT 1;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS pre_qual_status TEXT NOT NULL DEFAULT 'non_fait';`);

    // Ensure CHECK for pre_qual_status
    await c.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'comp_ext_vendors'::regclass
            AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%pre_qual_status%'
        LOOP
          EXECUTE 'ALTER TABLE comp_ext_vendors DROP CONSTRAINT ' || quote_ident(r.conname);
        END LOOP;
      END$$;
    `);
    await c.query(`
      ALTER TABLE comp_ext_vendors
      ADD CONSTRAINT comp_ext_vendors_prequal_check CHECK (pre_qual_status IN ('non_fait','en_cours','reçue','recue'));
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_visits (
        id         BIGSERIAL PRIMARY KEY,
        vendor_id  BIGINT NOT NULL REFERENCES comp_ext_vendors(id) ON DELETE CASCADE,
        vindex     INT NOT NULL,
        start_date DATE NOT NULL,
        end_date   DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_visits_vendor_id ON comp_ext_visits(vendor_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_visits_dates ON comp_ext_visits(start_date, end_date);`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_files (
        id             BIGSERIAL PRIMARY KEY,
        vendor_id      BIGINT NOT NULL REFERENCES comp_ext_vendors(id) ON DELETE CASCADE,
        category       TEXT,
        original_name  TEXT NOT NULL,
        stored_name    TEXT NOT NULL,
        mime           TEXT,
        size_bytes     BIGINT,
        disk_path      TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_files_vendor ON comp_ext_files(vendor_id);`);

    await c.query('COMMIT');
    console.log('[comp-ext] Schema ensured.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[comp-ext] ensureSchema error', e);
    throw e;
  } finally {
    c.release();
  }
}

// ---------- Middleware ----------
app.get('/api/comp-ext/health', (_req, res) => res.json({ ok: true }));

/* ========================= VENDORS ========================= */

// List vendors
app.get('/api/comp-ext/vendors', async (req, res) => {
  try {
    const { q } = req.query;
    const where = q ? `WHERE v.name ILIKE '%' || $1 || '%' OR v.sap_wo ILIKE '%' || $1 || '%'` : '';
    const params = q ? [q] : [];
    const vendors = (await pool.query(
      `SELECT v.id, v.name, v.offer_status, v.jsa_status, v.pp_applicable, v.pp_link,
              v.work_permit_required, v.work_permit_link,
              v.access_status, v.pre_qual_status,
              v.sap_wo, v.owner, v.visits_slots, v.created_at, v.updated_at,
              COALESCE(f.cnt, 0) AS files_count
       FROM comp_ext_vendors v
       LEFT JOIN (
         SELECT vendor_id, COUNT(*)::INT AS cnt FROM comp_ext_files GROUP BY vendor_id
       ) f ON f.vendor_id = v.id
       ${where}
       ORDER BY v.id DESC`,
      params
    )).rows;

    const ids = vendors.map(v => v.id);
    let visitsByVendor = {};
    if (ids.length) {
      const vrows = (await pool.query(
        `SELECT vendor_id, vindex, start_date, end_date
         FROM comp_ext_visits WHERE vendor_id = ANY($1::bigint[]) ORDER BY vendor_id, vindex`,
         [ids]
      )).rows;
      for (const r of vrows) {
        (visitsByVendor[r.vendor_id] ||= []).push({
          index: r.vindex,
          start: toISODate(r.start_date),
          end: toISODate(r.end_date),
        });
      }
    }

    const items = vendors.map(v => ({
      ...v,
      visits: visitsByVendor[v.id] || [],
    }));

    res.json({ items });
  } catch (e) {
    console.error('[comp-ext] vendors list', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Get one vendor
app.get('/api/comp-ext/vendors/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const v = (await pool.query(
      `SELECT id, name, offer_status, jsa_status, pp_applicable, pp_link,
              work_permit_required, work_permit_link,
              access_status, pre_qual_status,
              sap_wo, owner, visits_slots, created_at, updated_at
       FROM comp_ext_vendors WHERE id=$1`,
      [id]
    )).rows[0];
    if (!v) return res.status(404).json({ error: 'not_found' });

    const visits = (await pool.query(
      `SELECT vindex, start_date, end_date FROM comp_ext_visits WHERE vendor_id=$1 ORDER BY vindex`,
      [id]
    )).rows.map(r => ({ index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date) }));

    const files = (await pool.query(
      `SELECT id, category, original_name, stored_name, mime, size_bytes, created_at FROM comp_ext_files WHERE vendor_id=$1 ORDER BY id DESC`,
      [id]
    )).rows;
    const files_count = files.length;

    res.json({ ...v, visits, files, files_count });
  } catch (e) {
    console.error('[comp-ext] vendor get', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Create vendor
app.post('/api/comp-ext/vendors', async (req, res) => {
  const c = await pool.connect();
  try {
    const body = req.body || {};
    await c.query('BEGIN');
    const ins = await c.query(
      `INSERT INTO comp_ext_vendors
        (name, offer_status, jsa_status, pp_applicable, pp_link,
         work_permit_required, work_permit_link,
         access_status, pre_qual_status,
         sap_wo, owner, visits_slots)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, name, offer_status, jsa_status, pp_applicable, pp_link,
                 work_permit_required, work_permit_link,
                 access_status, pre_qual_status,
                 sap_wo, owner, visits_slots, created_at, updated_at`,
      [
        String(body.name||'').trim(),
        body.offer_status || 'en_attente',
        body.jsa_status || 'en_attente',
        !!body.pp_applicable,
        body.pp_link || null,
        !!body.work_permit_required,
        body.work_permit_link || null,
        body.access_status || 'a_faire',
        body.pre_qual_status || 'non_fait',
        body.sap_wo || null,
        body.owner || null,
        Math.max(1, Number(body.visits_slots || (Array.isArray(body.visits) ? body.visits.length||1 : 1))),
      ]
    );
    const vendor = ins.rows[0];
    const vid = vendor.id;

    const visits = Array.isArray(body.visits) ? body.visits : [];
    let idx = 1;
    for (const v of visits) {
      const s = v && v.start ? toISODate(v.start) : null;
      const e = v && v.end ? toISODate(v.end) : s;
      if (s && e) {
        await c.query(
          `INSERT INTO comp_ext_visits (vendor_id, vindex, start_date, end_date) VALUES ($1,$2,$3,$4)`,
          [vid, idx, s, e]
        );
        idx++;
      }
    }

    await c.query('COMMIT');
    res.status(201).json({ ...vendor, visits: visits.map((v,i)=>({ index: i+1, start: v.start||null, end: v.end||v.start||null })), files_count: 0 });
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[comp-ext] vendor create', e);
    res.status(400).json({ error: 'bad_request' });
  } finally {
    c.release();
  }
});

// Update vendor
app.put('/api/comp-ext/vendors/:id', async (req, res) => {
  const c = await pool.connect();
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    await c.query('BEGIN');

    const sets = [];
    const vals = [];
    const push = (col, val) => { vals.push(val); sets.push(`${col}=$${vals.length}`); };
    if (typeof body.name !== 'undefined') push('name', String(body.name).trim());
    if (typeof body.offer_status !== 'undefined') push('offer_status', body.offer_status);
    if (typeof body.jsa_status !== 'undefined') push('jsa_status', body.jsa_status);
    if (typeof body.pp_applicable !== 'undefined') push('pp_applicable', !!body.pp_applicable);
    if (typeof body.pp_link !== 'undefined') push('pp_link', body.pp_link || null);
    if (typeof body.work_permit_required !== 'undefined') push('work_permit_required', !!body.work_permit_required);
    if (typeof body.work_permit_link !== 'undefined') push('work_permit_link', body.work_permit_link || null);
    if (typeof body.access_status !== 'undefined') push('access_status', body.access_status);
    if (typeof body.pre_qual_status !== 'undefined') push('pre_qual_status', body.pre_qual_status);
    if (typeof body.sap_wo !== 'undefined') push('sap_wo', body.sap_wo || null);
    if (typeof body.owner !== 'undefined') push('owner', body.owner || null);
    if (typeof body.visits_slots !== 'undefined') push('visits_slots', Math.max(1, Number(body.visits_slots)||1));
    if (sets.length) push('updated_at', new Date());

    if (sets.length) {
      await c.query(`UPDATE comp_ext_vendors SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id`, [...vals, id]);
    }

    if (Array.isArray(body.visits)) {
      await c.query(`DELETE FROM comp_ext_visits WHERE vendor_id=$1`, [id]);
      let idx = 1;
      for (const v of body.visits) {
        const s = v && v.start ? toISODate(v.start) : null;
        const e = v && v.end ? toISODate(v.end) : s;
        if (s && e) {
          await c.query(`INSERT INTO comp_ext_visits (vendor_id, vindex, start_date, end_date) VALUES ($1,$2,$3,$4)`, [id, idx, s, e]);
          idx++;
        }
      }
    }

    await c.query('COMMIT');

    const row = (await pool.query(
      `SELECT id, name, offer_status, jsa_status, pp_applicable, pp_link,
              work_permit_required, work_permit_link,
              access_status, pre_qual_status,
              sap_wo, owner, visits_slots, created_at, updated_at
       FROM comp_ext_vendors WHERE id=$1`,
      [id]
    )).rows[0];
    const visits = (await pool.query(`SELECT vindex, start_date, end_date FROM comp_ext_visits WHERE vendor_id=$1 ORDER BY vindex`, [id])).rows
      .map(r => ({ index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date) }));
    const files_count = (await pool.query(`SELECT COUNT(*)::INT AS n FROM comp_ext_files WHERE vendor_id=$1`, [id])).rows[0].n;
    res.json({ ...row, visits, files_count });
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[comp-ext] vendor update', e);
    res.status(400).json({ error: 'bad_request' });
  } finally {
    c.release();
  }
});

// Delete vendor
app.delete('/api/comp-ext/vendors/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM comp_ext_vendors WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[comp-ext] vendor delete', e);
    res.status(400).json({ error: 'bad_request' });
  }
});

/* ========================= VISITS ========================= */

app.get('/api/comp-ext/visits', async (req, res) => {
  try {
    const vendor_id = Number(req.query.vendor_id || 0);
    if (!vendor_id) return res.status(400).json({ error: 'vendor_id_required' });
    const rows = (await pool.query(
      `SELECT id, vindex, start_date, end_date FROM comp_ext_visits WHERE vendor_id=$1 ORDER BY vindex`,
      [vendor_id]
    )).rows.map(r => ({ id: r.id, vindex: r.vindex, start_date: toISODate(r.start_date), end_date: toISODate(r.end_date) }));
    res.json({ visits: rows });
  } catch (e) {
    console.error('[comp-ext] visits list', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ========================= FILES ========================= */

app.get('/api/comp-ext/vendors/:id/files', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const category = req.query && req.query.category ? String(req.query.category) : null;
    const files = (await pool.query(
      `SELECT id, category, original_name, stored_name, mime, size_bytes, created_at
       FROM comp_ext_files
       WHERE vendor_id=$1 ${category ? 'AND category=$2' : ''}
       ORDER BY id DESC`,
      category ? [id, category] : [id]
    )).rows;
    res.json({ files });
  } catch (e) {
    console.error('[comp-ext] files list', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/comp-ext/vendors/:id/files', upload.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const category = (req.body && req.body.category) || null;
    const f = req.file;
    const ins = await pool.query(
      `INSERT INTO comp_ext_files (vendor_id, category, original_name, stored_name, mime, size_bytes, disk_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, category, original_name, stored_name, mime, size_bytes, created_at`,
      [id, category, f.originalname, f.filename, f.mimetype, f.size, path.join(FILES_DIR, f.filename)]
    );
    res.status(201).json({ file: ins.rows[0] });
  } catch (e) {
    console.error('[comp-ext] file upload', e);
    res.status(400).json({ error: 'bad_request' });
  }
});

// Compatibility upload endpoint for existing frontend
app.post('/api/comp-ext/vendors/:id/upload', upload.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const category = (req.query && req.query.category) || null;
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const f = req.file;
    const ins = await pool.query(
      `INSERT INTO comp_ext_files (vendor_id, category, original_name, stored_name, mime, size_bytes, disk_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, category, original_name, stored_name, mime, size_bytes, created_at`,
      [id, category, f.originalname, f.filename, f.mimetype, f.size, path.join(FILES_DIR, f.filename)]
    );
    res.status(201).json({ file: ins.rows[0] });
  } catch (e) {
    console.error('[comp-ext] upload (compat)', e);
    res.status(400).json({ error: 'bad_request' });
  }
});

app.get('/api/comp-ext/files/:fileId/download', async (req, res) => {
  try {
    const fid = Number(req.params.fileId);
    const row = (await pool.query(`SELECT original_name, disk_path, mime FROM comp_ext_files WHERE id=$1`, [fid])).rows[0];
    if (!row) return res.status(404).json({ error: 'not_found' });
    const filePath = row.disk_path;
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_missing' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.original_name.replace(/"/g, '')}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error('[comp-ext] file download', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/comp-ext/files/:fileId', async (req, res) => {
  try {
    const fid = Number(req.params.fileId);
    const row = (await pool.query(`DELETE FROM comp_ext_files WHERE id=$1 RETURNING disk_path`, [fid])).rows[0];
    if (row && row.disk_path && fs.existsSync(row.disk_path)) {
      fs.unlink(row.disk_path, () => {});
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[comp-ext] file delete', e);
    res.status(400).json({ error: 'bad_request' });
  }
});

/* ========================= CALENDAR / GANTT / STATS / ALERTS ========================= */

// Calendar & Gantt feed
app.get('/api/comp-ext/calendar', async (_req, res) => {
  try {
    const rows = (
      await pool.query(
        `SELECT v.id AS vendor_id, v.name, v.offer_status, v.jsa_status, v.access_status,
                vi.vindex, vi.start_date, vi.end_date
         FROM comp_ext_visits vi
         JOIN comp_ext_vendors v ON v.id = vi.vendor_id
         ORDER BY v.id, vi.vindex`
      )
    ).rows;

    const tasks = [];
    const events = [];
    for (const r of rows) {
      const s = toISODate(r.start_date);
      const e = toISODate(r.end_date || r.start_date);
      const ready = (r.offer_status === 'po_faite' && r.jsa_status === 'signe' && r.access_status === 'fait');
      const color = ready ? 'green' : 'red';

      tasks.push({
        id: `${r.vendor_id}-${r.vindex}`,
        name: `${r.name} • Visite ${r.vindex}`,
        start: s,
        end: e,
        vendor_id: r.vendor_id,
        vendor_name: r.name,
        vindex: r.vindex,
        startISO: s,
        endISO: e,
        status_color: color,
        ready,
      });

      const ds = new Date(s);
      const de = new Date(e);
      for (let d = new Date(ds); d <= de; d.setDate(d.getDate() + 1)) {
        events.push({
          date: toISODate(d),
          vendor_id: r.vendor_id,
          vendor_name: r.name,
          vindex: r.vindex,
          start: s,
          end: e,
          status_color: color,
          ready,
        });
      }
    }

    res.json({ tasks, events });
  } catch (e) {
    console.error('[comp-ext] calendar', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Stats
app.get('/api/comp-ext/stats', async (_req, res) => {
  try {
    const offer = (
      await pool.query(
        `SELECT
           SUM(CASE WHEN offer_status IN ('reçue','recue') THEN 1 ELSE 0 END) AS recue,
           SUM(CASE WHEN offer_status = 'po_faite' THEN 1 ELSE 0 END)          AS po_faite,
           SUM(CASE WHEN offer_status NOT IN ('reçue','recue','po_faite') THEN 1 ELSE 0 END) AS en_attente
         FROM comp_ext_vendors`
      )
    ).rows[0];

    const jsa = (
      await pool.query(
        `SELECT
           SUM(CASE WHEN jsa_status = 'en_attente'  THEN 1 ELSE 0 END) AS en_attente,
           SUM(CASE WHEN jsa_status = 'transmis'    THEN 1 ELSE 0 END) AS transmis,
           SUM(CASE WHEN jsa_status = 'receptionne' THEN 1 ELSE 0 END) AS receptionne,
           SUM(CASE WHEN jsa_status = 'signe'       THEN 1 ELSE 0 END) AS signe
         FROM comp_ext_vendors`
      )
    ).rows[0];

    const access = (
      await pool.query(
        `SELECT
           SUM(CASE WHEN access_status = 'fait' THEN 1 ELSE 0 END) AS fait,
           SUM(CASE WHEN access_status <> 'fait' THEN 1 ELSE 0 END) AS a_faire
         FROM comp_ext_vendors`
      )
    ).rows[0];

    const count = (await pool.query(`SELECT COUNT(*) AS n FROM comp_ext_vendors`)).rows[0];

    res.json({
      counts: {
        offer: {
          en_attente: Number(offer.en_attente || 0),
          recue: Number(offer.recue || 0),
          po_faite: Number(offer.po_faite || 0),
        },
        jsa: {
          en_attente: Number(jsa.en_attente || 0),
          transmis: Number(jsa.transmis || 0),
          receptionne: Number(jsa.receptionne || 0),
          signe: Number(jsa.signe || 0),
        },
        access: { a_faire: Number(access.a_faire || 0), fait: Number(access.fait || 0) },
      },
      total: Number(count.n || 0),
    });
  } catch (e) {
    console.error('[comp-ext] stats', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Alerts
app.get('/api/comp-ext/alerts', async (_req, res) => {
  try {
    const rows = (
      await pool.query(
        `SELECT v.id AS vendor_id, v.name, v.offer_status, v.jsa_status, v.access_status,
                v.pp_applicable, v.pp_link, v.work_permit_required, v.work_permit_link,
                vi.vindex, vi.start_date, vi.end_date
         FROM comp_ext_vendors v
         LEFT JOIN comp_ext_visits vi ON vi.vendor_id = v.id
         ORDER BY v.id, vi.vindex`
      )
    ).rows;

    const todayISO = toISODate(new Date());
    const alerts = [];
    for (const r of rows) {
      const s = r.start_date ? toISODate(r.start_date) : null;
      const ready = (r.offer_status === 'po_faite' && r.jsa_status === 'signe' && r.access_status === 'fait');

      if (s) {
        const dStart = daysBetween(s, todayISO); // positif => futur
        if (!ready) {
          if (dStart <= 0) {
            alerts.push({
              level: 'error',
              vendor_id: r.vendor_id,
              title: 'Visite non prête',
              message: `${r.name} • Visite ${r.vindex} : statuts incomplets (offer/jsa/access).`,
              date: s,
              kind: 'visit_not_ready',
            });
          } else if (dStart <= 7) {
            alerts.push({
              level: 'warn',
              vendor_id: r.vendor_id,
              title: 'Visite bientôt non prête',
              message: `${r.name} • Visite ${r.vindex} dans ${dStart}j : statuts incomplets.`,
              date: s,
              kind: 'visit_not_ready_soon',
            });
          }
        }
      }

      if (r.pp_applicable && !r.pp_link) {
        alerts.push({
          level: 'warn',
          vendor_id: r.vendor_id,
          title: 'Lien PP manquant',
          message: `${r.name} : Prévention plan applicable mais lien absent.`,
          kind: 'pp_link_missing',
        });
      }
      if (r.work_permit_required && !r.work_permit_link) {
        alerts.push({
          level: 'warn',
          vendor_id: r.vendor_id,
          title: 'Lien Permis de travail manquant',
          message: `${r.name} : Permis de travail requis mais lien absent.`,
          kind: 'work_permit_link_missing',
        });
      }
    }

    res.json({ alerts });
  } catch (e) {
    console.error('[comp-ext] alerts', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ========================= BOOT ========================= */

const UPLOAD_BASE = FILES_DIR;
const port = Number(process.env.COMP_EXT_PORT || 3014);

await ensureSchema();
app.listen(port, () => {
  console.log(`[comp-ext] API prête sur :${port} — uploads: ${UPLOAD_BASE}`);
});

// Exports (optional import in a parent server)
export { app, ensureSchema, pool };
