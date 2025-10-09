/* server_comp_ext.js (ESM) — comp-ext backend
 *
 * ENV:
 *  - COMP_EXT_PORT (default 3014)
 *  - DATABASE_URL
 *  - FILES_DIR (default ./uploads/comp_ext)
 *  - OPENAI_API_KEY (optional for /api/comp-ext/ask)
 */

import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';
import { fileURLToPath } from 'url';

let OpenAI = null;
try { ({ default: OpenAI } = await import('openai')); } catch (_) {}

const { Pool } = pg;

// ---------- ESM helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config ----------
const PORT = Number(process.env.COMP_EXT_PORT || 3014);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/comp_ext';
const FILES_DIR = process.env.FILES_DIR || path.join(__dirname, 'uploads', 'comp_ext');
fs.mkdirSync(FILES_DIR, { recursive: true });

// ---------- DB ----------
const pool = new Pool({ connectionString: DATABASE_URL });

// ---------- App ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- Upload ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FILES_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safe = (file.originalname || 'file').replace(/[^\w.\-]+/g, '_');
    cb(null, `${unique}-${safe}`);
  },
});
const upload = multer({ storage });

// ---------- Utils ----------
const toISODate = (d) => {
  if (!d) return null;
  const x = new Date(d);
  const y = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  return y.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => {
  const MS = 24 * 3600 * 1000;
  return Math.floor((new Date(a).setHours(0,0,0,0) - new Date(b).setHours(0,0,0,0)) / MS);
};
const normRecue = (s) => (!s ? s : s === 'recue' ? 'reçue' : s);

// ---------- Schema & Migrations (idempotent & ordered) ----------
async function ensureSchema() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // 1) Tables minimales
    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_vendors (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        offer_status TEXT,
        jsa_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_visits (
        id BIGSERIAL PRIMARY KEY,
        vendor_id BIGINT NOT NULL REFERENCES comp_ext_vendors(id) ON DELETE CASCADE,
        vindex INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS comp_ext_files (
        id BIGSERIAL PRIMARY KEY,
        vendor_id BIGINT NOT NULL REFERENCES comp_ext_vendors(id) ON DELETE CASCADE,
        category TEXT,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime TEXT,
        size_bytes BIGINT,
        disk_path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2) Colonnes manquantes
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS offer_status TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS msra_status TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS prequal_status TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS pp_applicable BOOLEAN NOT NULL DEFAULT FALSE;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS pp_link TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS work_permit_required BOOLEAN NOT NULL DEFAULT FALSE;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS work_permit_link TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS access_status TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS sap_wo TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS owner TEXT;`);
    await c.query(`ALTER TABLE comp_ext_vendors ADD COLUMN IF NOT EXISTS visits_slots INT NOT NULL DEFAULT 1;`);

    // 3) Normalisations
    await c.query(`UPDATE comp_ext_vendors SET offer_status = COALESCE(offer_status, 'en_attente');`);
    await c.query(`UPDATE comp_ext_vendors SET access_status = COALESCE(access_status, 'a_faire');`);
    await c.query(`UPDATE comp_ext_vendors SET msra_status = COALESCE(msra_status, jsa_status, 'en_attente');`);
    await c.query(`
      UPDATE comp_ext_vendors
      SET msra_status = CASE
        WHEN msra_status IN ('en_attente','transmis','receptionne','signe') THEN msra_status
        ELSE 'en_attente'
      END;
    `);
    await c.query(`UPDATE comp_ext_vendors SET prequal_status = COALESCE(prequal_status, 'non_fait');`);
    await c.query(`
      UPDATE comp_ext_vendors
      SET prequal_status = CASE
        WHEN prequal_status IN ('non_fait','en_cours','reçue','recue') THEN prequal_status
        ELSE 'non_fait'
      END;
    `);

    // 4) Drop contraintes existantes potentiellement incompatibles
    const dropLike = async (needle) => {
      await c.query(`
        DO $$
        DECLARE r RECORD;
        BEGIN
          FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid='comp_ext_vendors'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE ${pg.escapeLiteral('%' + needle + '%')}
          LOOP
            EXECUTE 'ALTER TABLE comp_ext_vendors DROP CONSTRAINT ' || quote_ident(r.conname);
          END LOOP;
        END$$;
      `);
    };
    await dropLike('offer_status');
    await dropLike('msra_status');
    await dropLike('prequal_status');
    await dropLike('access_status');

    // 5) Re-créer contraintes si absentes (guard IF NOT EXISTS)
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid='comp_ext_vendors'::regclass
             AND conname='comp_ext_vendors_offer_check'
        ) THEN
          ALTER TABLE comp_ext_vendors
          ADD CONSTRAINT comp_ext_vendors_offer_check
          CHECK (offer_status IN ('en_attente','reçue','recue','po_faite'));
        END IF;
      END$$;
    `);

    await c.query(`UPDATE comp_ext_vendors SET msra_status = COALESCE(msra_status, 'en_attente');`);
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid='comp_ext_vendors'::regclass
             AND conname='comp_ext_vendors_msra_check'
        ) THEN
          ALTER TABLE comp_ext_vendors
          ADD CONSTRAINT comp_ext_vendors_msra_check
          CHECK (msra_status IN ('en_attente','transmis','receptionne','signe'));
        END IF;
      END$$;
    `);
    await c.query(`ALTER TABLE comp_ext_vendors ALTER COLUMN msra_status SET NOT NULL;`);

    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid='comp_ext_vendors'::regclass
             AND conname='comp_ext_vendors_prequal_check'
        ) THEN
          ALTER TABLE comp_ext_vendors
          ADD CONSTRAINT comp_ext_vendors_prequal_check
          CHECK (prequal_status IN ('non_fait','en_cours','reçue','recue'));
        END IF;
      END$$;
    `);

    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid='comp_ext_vendors'::regclass
             AND conname='comp_ext_vendors_access_check'
        ) THEN
          ALTER TABLE comp_ext_vendors
          ADD CONSTRAINT comp_ext_vendors_access_check
          CHECK (access_status IN ('a_faire','fait'));
        END IF;
      END$$;
    `);

    // 6) Indexes
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_visits_vendor_id ON comp_ext_visits(vendor_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_visits_dates ON comp_ext_visits(start_date, end_date);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_comp_ext_files_vendor ON comp_ext_files(vendor_id);`);

    await c.query('COMMIT');
    console.log('[comp-ext] Schema ensured (guards on ADD CONSTRAINT).');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[comp-ext] ensureSchema error', e);
    throw e;
  } finally {
    c.release();
  }
}

// ---------- Health ----------
app.get('/api/comp-ext/health', (_req, res) => res.json({ ok: true }));

// ---------- Vendors ----------
app.get('/api/comp-ext/vendors', async (req, res) => {
  try {
    const { q } = req.query;
    const where = q ? `WHERE v.name ILIKE '%' || $1 || '%' OR v.sap_wo ILIKE '%' || $1 || '%'` : '';
    const params = q ? [q] : [];
    const vendors = (await pool.query(
      `SELECT v.id, v.name, v.offer_status, v.msra_status, v.jsa_status,
              v.prequal_status, v.pp_applicable, v.pp_link,
              v.work_permit_required, v.work_permit_link,
              v.access_status, v.sap_wo, v.owner, v.visits_slots,
              v.created_at, v.updated_at,
              COALESCE(f.cnt, 0) AS files_count
       FROM comp_ext_vendors v
       LEFT JOIN (SELECT vendor_id, COUNT(*)::INT AS cnt FROM comp_ext_files GROUP BY vendor_id) f
         ON f.vendor_id = v.id
       ${where}
       ORDER BY v.id DESC`,
      params
    )).rows;

    const ids = vendors.map(v => v.id);
    let visitsByVendor = {};
    if (ids.length) {
      const vrows = (await pool.query(
        `SELECT vendor_id, vindex, start_date, end_date
           FROM comp_ext_visits
          WHERE vendor_id = ANY($1::bigint[])
          ORDER BY vendor_id, vindex`,
        [ids]
      )).rows;
      for (const r of vrows) {
        (visitsByVendor[r.vendor_id] ||= []).push({
          index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date)
        });
      }
    }

    const items = vendors.map(v => ({
      ...v,
      msra_status: v.msra_status || v.jsa_status || 'en_attente',
      prequal_status: normRecue(v.prequal_status),
      visits: visitsByVendor[v.id] || [],
    }));
    res.json({ items });
  } catch (e) {
    console.error('[comp-ext] vendors list', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/comp-ext/vendors/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const v = (await pool.query(
      `SELECT id, name, offer_status, msra_status, jsa_status,
              prequal_status, pp_applicable, pp_link,
              work_permit_required, work_permit_link,
              access_status, sap_wo, owner, visits_slots, created_at, updated_at
         FROM comp_ext_vendors WHERE id=$1`,
      [id]
    )).rows[0];
    if (!v) return res.status(404).json({ error: 'not_found' });

    const visits = (await pool.query(
      `SELECT vindex, start_date, end_date
         FROM comp_ext_visits
        WHERE vendor_id=$1
        ORDER BY vindex`,
      [id]
    )).rows.map(r => ({ index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date) }));

    const files = (await pool.query(
      `SELECT id, category, original_name, stored_name, mime, size_bytes, created_at
         FROM comp_ext_files WHERE vendor_id=$1 ORDER BY id DESC`,
      [id]
    )).rows;

    res.json({
      ...v,
      msra_status: v.msra_status || v.jsa_status || 'en_attente',
      prequal_status: normRecue(v.prequal_status),
      visits,
      files: files.map(f => ({ ...f, url: `/api/comp-ext/files/${f.id}/download` })),
      files_count: files.length,
    });
  } catch (e) {
    console.error('[comp-ext] vendor get', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/comp-ext/vendors', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    await c.query('BEGIN');

    const ins = await c.query(
      `INSERT INTO comp_ext_vendors
        (name, offer_status, msra_status, prequal_status,
         pp_applicable, pp_link, work_permit_required, work_permit_link,
         access_status, sap_wo, owner, visits_slots)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, name, offer_status, msra_status, prequal_status,
                 pp_applicable, pp_link, work_permit_required, work_permit_link,
                 access_status, sap_wo, owner, visits_slots, created_at, updated_at`,
      [
        String(b.name || '').trim(),
        normRecue(b.offer_status || 'en_attente'),
        (b.msra_status || b.jsa_status || 'en_attente'),
        normRecue(b.prequal_status || 'non_fait'),
        !!b.pp_applicable,
        b.pp_link || null,
        !!b.work_permit_required,
        b.work_permit_link || null,
        b.access_status || 'a_faire',
        b.sap_wo || null,
        b.owner || null,
        Math.max(1, Number(b.visits_slots || (Array.isArray(b.visits) ? b.visits.length || 1 : 1))),
      ]
    );
    const vendor = ins.rows[0];
    const vid = vendor.id;

    const visits = Array.isArray(b.visits) ? b.visits : [];
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
    res.status(201).json({
      ...vendor,
      visits: visits.map((v,i)=>({ index: i+1, start: v.start || null, end: v.end || v.start || null })),
      files_count: 0,
    });
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[comp-ext] vendor create', e);
    res.status(400).json({ error: 'bad_request' });
  } finally {
    c.release();
  }
});

app.put('/api/comp-ext/vendors/:id', async (req, res) => {
  const c = await pool.connect();
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    await c.query('BEGIN');

    const sets = [];
    const vals = [];
    const push = (col, val) => { vals.push(val); sets.push(`${col}=$${vals.length}`); };

    if (b.name !== undefined) push('name', String(b.name).trim());
    if (b.offer_status !== undefined) push('offer_status', normRecue(b.offer_status));
    if (b.msra_status !== undefined) push('msra_status', b.msra_status);
    else if (b.jsa_status !== undefined) push('msra_status', b.jsa_status); // compat
    if (b.prequal_status !== undefined) push('prequal_status', normRecue(b.prequal_status));
    if (b.pp_applicable !== undefined) push('pp_applicable', !!b.pp_applicable);
    if (b.pp_link !== undefined) push('pp_link', b.pp_link || null);
    if (b.work_permit_required !== undefined) push('work_permit_required', !!b.work_permit_required);
    if (b.work_permit_link !== undefined) push('work_permit_link', b.work_permit_link || null);
    if (b.access_status !== undefined) push('access_status', b.access_status);
    if (b.sap_wo !== undefined) push('sap_wo', b.sap_wo || null);
    if (b.owner !== undefined) push('owner', b.owner || null);
    if (b.visits_slots !== undefined) push('visits_slots', Math.max(1, Number(b.visits_slots) || 1));
    if (sets.length) push('updated_at', new Date());

    if (sets.length) {
      await c.query(`UPDATE comp_ext_vendors SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id`, [...vals, id]);
    }

    if (Array.isArray(b.visits)) {
      await c.query(`DELETE FROM comp_ext_visits WHERE vendor_id=$1`, [id]);
      let idx = 1;
      for (const v of b.visits) {
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
      `SELECT id, name, offer_status, msra_status, jsa_status,
              prequal_status, pp_applicable, pp_link,
              work_permit_required, work_permit_link,
              access_status, sap_wo, owner, visits_slots, created_at, updated_at
         FROM comp_ext_vendors WHERE id=$1`,
      [id]
    )).rows[0];
    const visits = (await pool.query(
      `SELECT vindex, start_date, end_date FROM comp_ext_visits WHERE vendor_id=$1 ORDER BY vindex`,
      [id]
    )).rows.map(r => ({ index: r.vindex, start: toISODate(r.start_date), end: toISODate(r.end_date) }));
    const files_count = (await pool.query(`SELECT COUNT(*)::INT AS n FROM comp_ext_files WHERE vendor_id=$1`, [id])).rows[0].n;

    res.json({
      ...row,
      msra_status: row.msra_status || row.jsa_status || 'en_attente',
      prequal_status: normRecue(row.prequal_status),
      visits,
      files_count,
    });
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[comp-ext] vendor update', e);
    res.status(400).json({ error: 'bad_request' });
  } finally {
    c.release();
  }
});

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

// ---------- Visits ----------
app.get('/api/comp-ext/visits', async (req, res) => {
  try {
    const vendor_id = Number(req.query.vendor_id || 0);
    if (!vendor_id) return res.status(400).json({ error: 'vendor_id_required' });
    const rows = (await pool.query(
      `SELECT id, vindex, start_date, end_date
         FROM comp_ext_visits WHERE vendor_id=$1 ORDER BY vindex`,
      [vendor_id]
    )).rows.map(r => ({ id: r.id, vindex: r.vindex, start_date: toISODate(r.start_date), end_date: toISODate(r.end_date) }));
    res.json({ visits: rows });
  } catch (e) {
    console.error('[comp-ext] visits list', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- Files ----------
app.use('/api/comp-ext/_files', express.static(FILES_DIR, { fallthrough: true }));

app.get('/api/comp-ext/vendors/:id/files', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const category = req.query?.category ? String(req.query.category) : null;
    const files = (await pool.query(
      `SELECT id, category, original_name, stored_name, mime, size_bytes, created_at
         FROM comp_ext_files WHERE vendor_id=$1 ${category ? 'AND category=$2' : ''} ORDER BY id DESC`,
      category ? [id, category] : [id]
    )).rows.map(f => ({
      ...f,
      url: `/api/comp-ext/files/${f.id}/download`,
      download_url: `/api/comp-ext/files/${f.id}/download`,
      inline_url: `/api/comp-ext/files/${f.id}/inline`,
    }));
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
    const category = req.body?.category || null;
    const f = req.file;
    const ins = await pool.query(
      `INSERT INTO comp_ext_files
        (vendor_id, category, original_name, stored_name, mime, size_bytes, disk_path)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, category, original_name, stored_name, mime, size_bytes, created_at`,
      [id, category, f.originalname, f.filename, f.mimetype, f.size, path.join(FILES_DIR, f.filename)]
    );
    const row = ins.rows[0];
    res.status(201).json({
      file: {
        ...row,
        url: `/api/comp-ext/files/${row.id}/download`,
        download_url: `/api/comp-ext/files/${row.id}/download`,
        inline_url: `/api/comp-ext/files/${row.id}/inline`,
      },
    });
  } catch (e) {
    console.error('[comp-ext] file upload', e);
    res.status(400).json({ error: 'bad_request' });
  }
});

app.post('/api/comp-ext/vendors/:id/upload', upload.any(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const category = req.query?.category || null;
    const files = Array.isArray(req.files) ? req.files : [];
    const out = [];
    for (const f of files) {
      const ins = await pool.query(
        `INSERT INTO comp_ext_files
          (vendor_id, category, original_name, stored_name, mime, size_bytes, disk_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, category, original_name, stored_name, mime, size_bytes, created_at`,
        [id, category, f.originalname, f.filename, f.mimetype, f.size, path.join(FILES_DIR, f.filename)]
      );
      const row = ins.rows[0];
      out.push({
        ...row,
        url: `/api/comp-ext/files/${row.id}/download`,
        download_url: `/api/comp-ext/files/${row.id}/download`,
        inline_url: `/api/comp-ext/files/${row.id}/inline`,
      });
    }
    res.status(201).json({ files: out });
  } catch (e) {
    console.error('[comp-ext] upload (compat)', e);
    res.status(400).json({ error: 'bad_request' });
  }
});

app.get('/api/comp-ext/files/:fileId/download', async (req, res) => {
  try {
    const fid = Number(req.params.fileId);
    if (!Number.isFinite(fid)) return res.status(400).json({ error: 'bad_file_id' });
    const row = (await pool.query(
     `SELECT stored_name, mime FROM comp_ext_files WHERE id=$1`, [fid]
    )).rows[0];
    if (!row) return res.status(404).json({ error: 'not_found' });
    const filePath = path.resolve(FILES_DIR, row.stored_name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'file_missing' });

    const mime = row.mime || 'application/octet-stream';
    const filename = (row.original_name || 'file').replace(/"/g, '');
    const ascii = filename.replace(/[^\x20-\x7E]+/g, '_');
    const enc = encodeURIComponent(filename);

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`);
    fs.createReadStream(filePath).on('error', err => { console.error('[comp-ext] stream error', err); res.status(500).end(); }).pipe(res);
  } catch (e) {
    console.error('[comp-ext] file download', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/comp-ext/files/:fileId/inline', async (req, res) => {
  try {
    const fid = Number(req.params.fileId);
    if (!Number.isFinite(fid)) {
      return res.status(400).json({ error: 'bad_file_id' });
    }

    // On lit stored_name + mime et on reconstruit le chemin avec FILES_DIR
    const row = (await pool.query(
      `SELECT stored_name, mime FROM comp_ext_files WHERE id=$1`,
      [fid]
    )).rows[0];

    if (!row) {
      return res.status(404).json({ error: 'not_found' });
    }

    const filePath = path.resolve(FILES_DIR, row.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file_missing' });
    }

    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    // Optionnel : forcer l'affichage inline (certains navigateurs le font par défaut)
    // res.setHeader('Content-Disposition', 'inline');

    fs.createReadStream(filePath)
      .on('error', err => {
        console.error('[comp-ext] stream error', err);
        res.status(500).end();
      })
      .pipe(res);
  } catch (e) {
    console.error('[comp-ext] file inline', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/comp-ext/files/:fileId', async (req, res) => {
  try {
    const fid = Number(req.params.fileId);
    const row = (await pool.query(
      `DELETE FROM comp_ext_files WHERE id=$1 RETURNING disk_path`, [fid]
    )).rows[0];
    if (row?.disk_path && fs.existsSync(row.disk_path)) fs.unlink(row.disk_path, () => {});
    res.json({ ok: true });
  } catch (e) {
    console.error('[comp-ext] file delete', e);
    res.status(400).json({ error: 'bad_request' });
  }
});

// ---------- Calendar & Gantt ----------
app.get('/api/comp-ext/calendar', async (_req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT v.id AS vendor_id, v.name,
              v.offer_status, v.msra_status, v.access_status,
              vi.vindex, vi.start_date, vi.end_date
         FROM comp_ext_visits vi
         JOIN comp_ext_vendors v ON v.id = vi.vendor_id
        ORDER BY v.id, vi.vindex`
    )).rows;

    const tasks = [];
    const events = [];
    for (const r of rows) {
      const s = toISODate(r.start_date);
      const e = toISODate(r.end_date || r.start_date);
      const ready = (r.offer_status === 'po_faite' && (r.msra_status || 'en_attente') === 'signe' && r.access_status === 'fait');
      const color = ready ? 'green' : 'red';

      tasks.push({
        id: `${r.vendor_id}-${r.vindex}`,
        name: `${r.name} • Visite ${r.vindex}`,
        start: s, end: e,
        vendor_id: r.vendor_id, vendor_name: r.name, vindex: r.vindex,
        startISO: s, endISO: e, status_color: color, ready,
      });

      const ds = new Date(s), de = new Date(e);
      for (let d = new Date(ds); d <= de; d.setDate(d.getDate() + 1)) {
        events.push({
          date: toISODate(d),
          vendor_id: r.vendor_id, vendor_name: r.name, vindex: r.vindex,
          start: s, end: e, status_color: color, ready,
        });
      }
    }
    res.json({ tasks, events });
  } catch (e) {
    console.error('[comp-ext] calendar', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- Stats ----------
app.get('/api/comp-ext/stats', async (_req, res) => {
  try {
    const offer = (await pool.query(
      `SELECT
         SUM(CASE WHEN offer_status IN ('reçue','recue') THEN 1 ELSE 0 END) AS recue,
         SUM(CASE WHEN offer_status = 'po_faite' THEN 1 ELSE 0 END) AS po_faite,
         SUM(CASE WHEN offer_status NOT IN ('reçue','recue','po_faite') THEN 1 ELSE 0 END) AS en_attente
       FROM comp_ext_vendors`
    )).rows[0];

    const msra = (await pool.query(
      `SELECT
         SUM(CASE WHEN msra_status='en_attente'  THEN 1 ELSE 0 END) AS en_attente,
         SUM(CASE WHEN msra_status='transmis'    THEN 1 ELSE 0 END) AS transmis,
         SUM(CASE WHEN msra_status='receptionne' THEN 1 ELSE 0 END) AS receptionne,
         SUM(CASE WHEN msra_status='signe'       THEN 1 ELSE 0 END) AS signe
       FROM comp_ext_vendors`
    )).rows[0];

    const access = (await pool.query(
      `SELECT
         SUM(CASE WHEN access_status='fait' THEN 1 ELSE 0 END) AS fait,
         SUM(CASE WHEN access_status<>'fait' THEN 1 ELSE 0 END) AS a_faire
       FROM comp_ext_vendors`
    )).rows[0];

    const count = (await pool.query(`SELECT COUNT(*) AS n FROM comp_ext_vendors`)).rows[0];

    res.json({
      counts: {
        offer: { en_attente: Number(offer.en_attente||0), recue: Number(offer.recue||0), po_faite: Number(offer.po_faite||0) },
        msra:  { en_attente: Number(msra.en_attente||0), transmis: Number(msra.transmis||0), receptionne: Number(msra.receptionne||0), signe: Number(msra.signe||0) },
        access:{ a_faire: Number(access.a_faire||0), fait: Number(access.fait||0) },
      },
      total: Number(count.n||0),
    });
  } catch (e) {
    console.error('[comp-ext] stats', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- Alerts ----------
app.get('/api/comp-ext/alerts', async (_req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT v.id AS vendor_id, v.name,
              v.offer_status, v.msra_status, v.access_status,
              v.pp_applicable, v.pp_link, v.work_permit_required, v.work_permit_link,
              vi.vindex, vi.start_date, vi.end_date
         FROM comp_ext_vendors v
         LEFT JOIN comp_ext_visits vi ON vi.vendor_id = v.id
        ORDER BY v.id, vi.vindex`
    )).rows;

    const todayISO = toISODate(new Date());
    const alerts = [];
    for (const r of rows) {
      const s = r.start_date ? toISODate(r.start_date) : null;
      const ready = (r.offer_status === 'po_faite' && (r.msra_status || 'en_attente') === 'signe' && r.access_status === 'fait');

      if (s) {
        const dStart = daysBetween(s, todayISO);
        if (!ready) {
          if (dStart <= 0) alerts.push({ level:'error', vendor_id:r.vendor_id, title:'Visite non prête', message:`${r.name} • Visite ${r.vindex} : statuts incomplets (offer/MSRA/access).`, date:s, kind:'visit_not_ready' });
          else if (dStart <= 7) alerts.push({ level:'warn', vendor_id:r.vendor_id, title:'Visite bientôt non prête', message:`${r.name} • Visite ${r.vindex} dans ${dStart}j : statuts incomplets.`, date:s, kind:'visit_not_ready_soon' });
        }
      }
      if (r.pp_applicable && !r.pp_link) alerts.push({ level:'warn', vendor_id:r.vendor_id, title:'Lien PP manquant', message:`${r.name} : Prévention plan applicable mais lien absent.`, kind:'pp_link_missing' });
      if (r.work_permit_required && !r.work_permit_link) alerts.push({ level:'warn', vendor_id:r.vendor_id, title:'Lien Permis de travail manquant', message:`${r.name} : Permis de travail requis mais lien absent.`, kind:'work_permit_link_missing' });
    }
    res.json({ alerts });
  } catch (e) {
    console.error('[comp-ext] alerts', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- Ask (OpenAI) ----------
app.post('/api/comp-ext/ask', async (req, res) => {
  try {
    const question = (req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question_required' });

    const now = new Date();
    const today = toISODate(now);
    const in30 = toISODate(new Date(now.getTime() + 30 * 86400000));

    const [vendorsRows, visitsRows] = await Promise.all([
      pool.query(
        `SELECT id, name, offer_status, msra_status, access_status, prequal_status,
                pp_applicable, (pp_link IS NOT NULL AND pp_link <> '') AS has_pp_link,
                work_permit_required, (work_permit_link IS NOT NULL AND work_permit_link <> '') AS has_wp_link
           FROM comp_ext_vendors ORDER BY id DESC`
      ),
      pool.query(
        `SELECT v.vendor_id, v.vindex, v.start_date, v.end_date, e.name
           FROM comp_ext_visits v
           JOIN comp_ext_vendors e ON e.id = v.vendor_id
          WHERE (v.start_date <= $1::date AND v.end_date >= $2::date)
             OR (v.start_date BETWEEN $2::date AND $1::date)
             OR (v.end_date   BETWEEN $2::date AND $1::date)
          ORDER BY v.start_date ASC`,
        [in30, today]
      ),
    ]);

    const vendors = vendorsRows.rows;
    const visits = visitsRows.rows.map(r => ({
      vendor_id: r.vendor_id, vendor_name: r.name, vindex: r.vindex,
      start: toISODate(r.start_date), end: toISODate(r.end_date),
    }));

    const notReady = vendors.filter(v => !(v.offer_status === 'po_faite' && v.msra_status === 'signe' && v.access_status === 'fait'));

    if (!OpenAI || !process.env.OPENAI_API_KEY) {
      const summary = [
        `Question: ${question}`,
        `Prochaines visites (≤ 30 jours): ${visits.length}`,
        ...visits.slice(0, 10).map(x => `• ${x.vendor_name} (V${x.vindex}) ${x.start} → ${x.end}`),
        notReady.length ? `Vendors non prêts: ${notReady.length} (ex: ${notReady.slice(0,5).map(x=>x.name).join(', ')})` : `Tous les vendors semblent prêts.`,
      ].join('\n');
      return res.json({ answer: summary, llm: false });
    }

    const system = `Assistant pour un outil de prestataires externes.
Règle "prêt": offer_status="po_faite" AND msra_status="signe" AND access_status="fait".
Réponds en français, concis et actionnable.`;

    const context = {
      today,
      vendors: vendors.map(v => ({
        id: v.id, name: v.name,
        offer_status: v.offer_status, msra_status: v.msra_status, access_status: v.access_status,
        prequal_status: normRecue(v.prequal_status),
        pp_applicable: !!v.pp_applicable, has_pp_link: !!v.has_pp_link,
        work_permit_required: !!v.work_permit_required, has_wp_link: !!v.has_wp_link,
      })),
      upcoming_visits: visits,
    };

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Question: ${question}\nContexte JSON:\n${JSON.stringify(context)}` },
      ],
    });
    const answer = resp.choices?.[0]?.message?.content?.trim() || '(pas de réponse)';
    res.json({ answer, llm: true });
  } catch (e) {
    console.error('[comp-ext] ask error', e);
    res.status(500).json({ error: 'server_error', answer: "L'IA n'est pas disponible (clé absente/erreur)." });
  }
});

// ---------- Boot ----------
async function start() {
  await ensureSchema();
  app.listen(PORT, () => console.log(`[comp-ext] API prête sur :${PORT} — uploads: ${FILES_DIR}`));
}
const thisPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisPath) {
  start().catch(err => { console.error('[comp-ext] failed to start', err); process.exit(1); });
}

export { app, ensureSchema, pool };
