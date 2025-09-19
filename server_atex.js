// server_atex.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import multer from 'multer';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// CORS
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Utils
function addMonths(dateStr, months = 36) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Conformité (case-insensitive)
function assessCompliance(atex_ref = '', zone_gas = null, zone_dust = null) {
  const ref = (atex_ref || '').toUpperCase();
  const needsG = [0,1,2].includes(Number(zone_gas));
  const needsD = [20,21,22].includes(Number(zone_dust));
  const hasG = /\bG\b/.test(ref);
  const hasD = /\bD\b/.test(ref);

  const problems = [];
  if (needsG && !hasG) problems.push('Marquage gaz (G) manquant pour une zone gaz.');
  if (needsD && !hasD) problems.push('Marquage poussières (D) manquant pour une zone poussières.');

  return { status: problems.length ? 'Non conforme' : 'Conforme', problems };
}

app.get('/api/atex/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// SUGGESTS (auto-complétion)
app.get('/api/atex/suggests', async (req, res) => {
  try {
    const fields = ['building','room','component_type','manufacturer','manufacturer_ref','atex_ref'];
    const out = {};
    for (const f of fields) {
      const r = await pool.query(
        `SELECT DISTINCT ${f} FROM atex_equipments WHERE ${f} IS NOT NULL AND ${f}<>'' ORDER BY ${f} ASC LIMIT 200`
      );
      out[f] = r.rows.map(x => x[f]);
    }
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Suggests failed' });
  }
});

// Helpers multi-filtres
function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function addLikeIn(where, values, i, field, arr) {
  if (!arr.length) return i;
  const slots = arr.map((_,k)=> `$${i + k}`);
  where.push(`${field} IN (${slots.join(',')})`);
  values.push(...arr);
  return i + arr.length;
}

// LIST avec filtres multiples & tri
app.get('/api/atex/equipments', async (req, res) => {
  try {
    const {
      q, sort='updated_at', dir='desc', page='1', pageSize='100'
    } = req.query;

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

    if (q) { where.push(`(building ILIKE $${i} OR room ILIKE $${i} OR component_type ILIKE $${i} OR manufacturer ILIKE $${i} OR manufacturer_ref ILIKE $${i} OR atex_ref ILIKE $${i})`); values.push(`%${q}%`); i++; }
    if (buildings.length) { i = addLikeIn(where, values, i, 'building', buildings); }
    if (rooms.length)     { i = addLikeIn(where, values, i, 'room', rooms); }
    if (types.length)     { i = addLikeIn(where, values, i, 'component_type', types); }
    if (mans.length)      { i = addLikeIn(where, values, i, 'manufacturer', mans); }
    if (statuses.length)  { i = addLikeIn(where, values, i, 'status', statuses); }
    if (gases.length)     { where.push(`zone_gas = ANY($${i}::int[])`); values.push(gases); i++; }
    if (dusts.length)     { where.push(`zone_dust = ANY($${i}::int[])`); values.push(dusts); i++; }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortSafe = ['building','room','component_type','manufacturer','manufacturer_ref','atex_ref','zone_gas','zone_dust','status','last_control','next_control','updated_at','created_at'].includes(sort) ? sort : 'updated_at';
    const dirSafe = (String(dir).toLowerCase()==='asc') ? 'ASC' : 'DESC';
    const limit = Math.min(parseInt(pageSize,10)||100, 300);
    const offset = ((parseInt(page,10)||1)-1) * limit;

    const { rows } = await pool.query(
      `SELECT * FROM atex_equipments ${whereSql} ORDER BY ${sortSafe} ${dirSafe} LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'List failed' });
  }
});

// CREATE
app.post('/api/atex/equipments', async (req, res) => {
  try {
    const {
      site, building, room, component_type, manufacturer, manufacturer_ref,
      atex_ref, zone_gas, zone_dust, last_control, next_control,
      comments, attachments, frequency_months
    } = req.body;

    const { status } = assessCompliance(atex_ref, zone_gas, zone_dust);
    const nextCtrl = next_control || addMonths(last_control, frequency_months ? Number(frequency_months) : 36);

    const { rows } = await pool.query(
      `INSERT INTO atex_equipments
       (site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
        zone_gas, zone_dust, status, last_control, next_control, comments, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
       zone_gas ?? null, zone_dust ?? null, status, last_control || null, nextCtrl || null,
       comments || null, attachments || []]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Create failed' });
  }
});

// UPDATE
app.put('/api/atex/equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const patch = { ...req.body };

    if ('atex_ref' in patch || 'zone_gas' in patch || 'zone_dust' in patch) {
      const cur = await pool.query('SELECT atex_ref, zone_gas, zone_dust FROM atex_equipments WHERE id=$1', [id]);
      const merged = {
        atex_ref: patch.atex_ref ?? cur.rows[0]?.atex_ref,
        zone_gas: patch.zone_gas ?? cur.rows[0]?.zone_gas,
        zone_dust: patch.zone_dust ?? cur.rows[0]?.zone_dust,
      };
      patch.status = assessCompliance(merged.atex_ref, merged.zone_gas, merged.zone_dust).status;
    }

    if (patch.last_control && !patch.next_control) {
      const freq = Number(patch.frequency_months || 36);
      patch.next_control = addMonths(patch.last_control, freq);
      delete patch.frequency_months;
    }

    const keys = Object.keys(patch);
    if (!keys.length) return res.status(400).json({ error: 'No fields to update' });

    const set = keys.map((k,i)=> `${k}=$${i+1}`).join(', ');
    const vals = keys.map(k => patch[k]); vals.push(id);

    const { rows } = await pool.query(`UPDATE atex_equipments SET ${set} WHERE id=$${keys.length+1} RETURNING *`, vals);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE
app.delete('/api/atex/equipments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_equipments WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ------- Pièces jointes -------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Liste pièces jointes d’un équipement
app.get('/api/atex/equipments/:id/attachments', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, filename, mimetype, size, created_at FROM atex_attachments WHERE equipment_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Attachments list failed' });
  }
});

// Upload (plusieurs fichiers)
app.post('/api/atex/equipments/:id/attachments', upload.array('files', 12), async (req, res) => {
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
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Télécharger
app.get('/api/atex/attachments/:attId/download', async (req, res) => {
  try {
    const r = await pool.query('SELECT filename, mimetype, size, data FROM atex_attachments WHERE id=$1', [req.params.attId]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', row.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
    res.send(Buffer.from(row.data, 'binary'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Supprimer une PJ
app.delete('/api/atex/attachments/:attId', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_attachments WHERE id=$1', [req.params.attId]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Delete attachment failed' });
  }
});

// ------- Chat IA (inchangé) -------
app.post('/api/atex/ai/:id', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY manquant' });
    const id = req.params.id;
    const r = await pool.query('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    const eq = r.rows[0]; if (!eq) return res.status(404).json({ error: 'Not found' });

    const prompt = `
Tu es expert ATEX. Analyse la conformité, puis liste: 1) Pourquoi non conforme (si applicable), 2) Mesures préventives, 3) Palliatives, 4) Correctives. Reste concis.

Équipement:
- Bâtiment: ${eq.building}
- Local: ${eq.room}
- Type: ${eq.component_type}
- Fabricant: ${eq.manufacturer}
- Réf fabricant: ${eq.manufacturer_ref}
- Marquage ATEX: ${eq.atex_ref}
- Zone gaz: ${eq.zone_gas ?? '—'}
- Zone poussières: ${eq.zone_dust ?? '—'}
- Statut: ${eq.status}
- Dernier contrôle: ${eq.last_control ?? '—'}
- Prochain contrôle: ${eq.next_control ?? '—'}
`.trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role:'system', content:'Tu es un expert en conformité ATEX.' },
          { role:'user', content: prompt }
        ]
      })
    });
    if (!resp.ok) return res.status(500).json({ error: 'OpenAI error', details: await resp.text() });
    const json = await resp.json();
    res.json({ analysis: json.choices?.[0]?.message?.content?.trim() || '—' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'AI failed' });
  }
});

const port = process.env.ATEX_PORT || 3001;
app.listen(port, () => console.log(`ATEX service listening on :${port}`));
