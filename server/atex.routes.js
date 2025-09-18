import express from 'express';
import multer from 'multer';
import { Pool } from 'pg';
import { z } from 'zod';
import { atexAssistMessage } from './openai.helper.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Compliance logic
const rank = { '1G':3, '2G':2, '3G':1, '1D':3, '2D':2, '3D':1 };
const minCatG = { 0:'1G', 1:'2G', 2:'3G' };
const minCatD = { 20:'1D', 21:'2D', 22:'3D' };
const isCompliant = ({ zone_gas, zone_dust, category_g, category_d }) => {
  let ok = true;
  if (zone_gas != null) {
    if (!category_g) ok = false;
    else ok = ok && (rank[category_g] >= rank[minCatG[zone_gas]]);
  }
  if (ok && zone_dust != null) {
    if (!category_d) ok = false;
    else ok = ok && (rank[category_d] >= rank[minCatD[zone_dust]]);
  }
  return ok;
};
const nextDue = (last) => {
  if (!last) return null;
  const d = new Date(last);
  const nd = new Date(d);
  nd.setFullYear(d.getFullYear() + 3);
  return nd.toISOString().slice(0,10);
};

const baseSchema = z.object({
  reference: z.string().min(1),
  designation: z.string().min(1),
  building: z.string().min(1),
  zone_gas: z.number().int().nullable().optional(),
  zone_dust: z.number().int().nullable().optional(),
  category_g: z.enum(['1G','2G','3G']).nullable().optional(),
  category_d: z.enum(['1D','2D','3D']).nullable().optional(),
  marking: z.string().optional(),
  last_inspection_date: z.string().nullable().optional(),
  comments: z.string().optional()
});

// Create (recompute compliant & next_due_date)
router.post('/', async (req, res) => {
  try {
    const p = baseSchema.parse(req.body);
    const compliant = isCompliant(p);
    const next_due_date = nextDue(p.last_inspection_date || null);
    const q = `INSERT INTO atex_equipment(reference,designation,building,zone_gas,zone_dust,category_g,category_d,marking,last_inspection_date,next_due_date,compliant,comments)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`;
    const vals = [p.reference, p.designation, p.building, p.zone_gas ?? null, p.zone_dust ?? null, p.category_g ?? null, p.category_d ?? null, p.marking || null, p.last_inspection_date || null, next_due_date, compliant, p.comments || null];
    const { rows } = await pool.query(q, vals);
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Update (recompute if relevant fields present)
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const p = baseSchema.partial().parse(req.body);
    const recompute = ('zone_gas' in p) || ('zone_dust' in p) || ('category_g' in p) || ('category_d' in p) || ('last_inspection_date' in p);
    if (recompute) {
      const { rows: curRows } = await pool.query('SELECT * FROM atex_equipment WHERE id=$1', [id]);
      if (!curRows.length) return res.status(404).json({ error: 'Not found' });
      const cur = curRows[0];
      const merged = { ...cur, ...p };
      p.compliant = isCompliant(merged);
      p.next_due_date = merged.last_inspection_date ? nextDue(merged.last_inspection_date) : null;
    }
    const fields = Object.keys(p);
    if (!fields.length) return res.status(400).json({ error: 'No fields provided' });
    const setSql = fields.map((k,i)=> `${k}=$${i+1}`).join(', ');
    const { rows } = await pool.query(`UPDATE atex_equipment SET ${setSql}, updated_at=now() WHERE id=$${fields.length+1} RETURNING *`, [...fields.map(k=>p[k]), id]);
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete
router.delete('/:id', async (req,res)=>{
  const id = req.params.id;
  await pool.query('DELETE FROM atex_files WHERE equipment_id=$1', [id]);
  const { rowCount } = await pool.query('DELETE FROM atex_equipment WHERE id=$1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Get by reference (case-insensitive)
router.get('/by-ref/:reference', async (req,res)=>{
  const r = req.params.reference;
  const { rows } = await pool.query('SELECT * FROM atex_equipment WHERE lower(reference)=lower($1)', [r]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  return res.json(rows[0]);
});

// List with filters (building, zone, category, q)
router.get('/', async (req, res) => {
  const { building, zone_gas, zone_dust, category_g, category_d, q } = req.query;
  const where = [];
  const vals = [];
  if (building) { vals.push(building); where.push(`building=$${vals.length}`); }
  if (zone_gas) { vals.push(Number(zone_gas)); where.push(`zone_gas=$${vals.length}`); }
  if (zone_dust) { vals.push(Number(zone_dust)); where.push(`zone_dust=$${vals.length}`); }
  if (category_g) { vals.push(category_g); where.push(`category_g=$${vals.length}`); }
  if (category_d) { vals.push(category_d); where.push(`category_d=$${vals.length}`); }
  if (q) { vals.push('%'+q.toLowerCase()+'%'); where.push(`(lower(reference) LIKE $${vals.length} OR lower(designation) LIKE $${vals.length})`); }
  const sql = `SELECT * FROM atex_equipment ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT 2000`;
  const { rows } = await pool.query(sql, vals);
  res.json(rows);
});

// Upload attachments (BYTEA)
router.post('/:id/attachments', upload.array('files', 10), async (req,res)=>{
  const id = req.params.id;
  if (!req.files?.length) return res.json([]);
  const inserted = [];
  for (const f of req.files) {
    const { rows } = await pool.query(
      'INSERT INTO atex_files(equipment_id, filename, mime_type, file_data) VALUES($1,$2,$3,$4) RETURNING id, filename, mime_type, uploaded_at',
      [id, f.originalname, f.mimetype, f.buffer]
    );
    inserted.push(rows[0]);
  }
  res.json(inserted);
});

// Download attachment
router.get('/files/:fileId', async (req,res)=>{
  const fid = req.params.fileId;
  const { rows } = await pool.query('SELECT filename, mime_type, file_data FROM atex_files WHERE id=$1', [fid]);
  if (!rows.length) return res.status(404).end();
  const file = rows[0];
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.send(file.file_data);
});

// Risk scoring
router.post('/:id/risk', async (req,res)=>{
  const id = req.params.id;
  const { likelihood, severity, detectability, note } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO atex_risk_score(equipment_id, likelihood, severity, detectability, note) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [id, likelihood, severity, detectability, note || null]
  );
  res.json(rows[0]);
});

// Export CSV
router.get('/export', async (req,res)=>{
  const { rows } = await pool.query('SELECT * FROM atex_equipment ORDER BY updated_at DESC');
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const csv = [cols.join(',')].concat(
    rows.map(r => cols.map(k => {
      const v = r[k];
      if (v == null) return '';
      const s = String(v).replace(/"/g,'""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','))
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="atex-export.csv"');
  res.send(csv);
});

// OpenAI assist (only if non-compliant)
router.post('/:id/assist', async (req,res)=>{
  const id = req.params.id;
  const { rows } = await pool.query('SELECT * FROM atex_equipment WHERE id=$1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const eq = rows[0];
  if (eq.compliant) return res.json({ message: 'Equipment is compliant. No action needed.' });
  const answer = await atexAssistMessage(eq);
  res.json({ answer });
});

export default router;
