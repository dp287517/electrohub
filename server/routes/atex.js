import express from 'express';
import multer from 'multer';
import { pool } from '../db.js';
import { authOptional } from '../middlewares/auth.js';
import { siteScope } from '../middlewares/siteScope.js';
import { z } from 'zod';
import { computeCompliance } from '../services/atexCompliance.js';
import { suggestForNonConformity } from '../services/openaiAssistant.js';
import { buildTemplateBuffer, parseImportBuffer } from '../services/atexExcel.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(authOptional, siteScope);

const eqSchema = z.object({
  reference: z.string().min(1),
  brand: z.string().min(1),
  designation: z.string().min(1),
  atex_reference: z.string().optional().nullable(),
  marking: z.string().optional().nullable(),
  building: z.string().min(1),
  room: z.string().optional().nullable(),
  zone_gas: z.number().int().nullable().optional(),
  zone_dust: z.number().int().nullable().optional(),
  category_g: z.enum(['1G','2G','3G']).nullable().optional(),
  category_d: z.enum(['1D','2D','3D']).nullable().optional(),
  last_inspection_date: z.string().nullable().optional(),
  comments: z.string().optional().nullable()
});

router.post('/equipments', async (req,res)=>{
  try{
    const p = eqSchema.parse(req.body);
    const site = req.site;
    const comp = computeCompliance(p);
    const q = `INSERT INTO atex_equipment
    (reference,brand,designation,atex_reference,marking,building,room,site,zone_gas,zone_dust,category_g,category_d,last_inspection_date,next_due_date,compliant,comments)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *`;
    const vals = [p.reference, p.brand, p.designation, p.atex_reference||null, p.marking||null, p.building, p.room||null, site, p.zone_gas??null, p.zone_dust??null, p.category_g??null, p.category_d??null, p.last_inspection_date||null, comp.next_due_date, comp.compliant, p.comments||null];
    const { rows } = await pool.query(q, vals);
    res.json(rows[0]);
  }catch(e){ res.status(400).json({ error: e.message }); }
});

router.put('/equipments/:id', async (req,res)=>{
  try{
    const id = req.params.id;
    const p = eqSchema.partial().parse(req.body);
    const { rows: curRows } = await pool.query('SELECT * FROM atex_equipment WHERE id=$1 AND site=$2', [id, req.site]);
    if (!curRows.length) return res.status(404).json({ error: 'Not found' });
    const cur = curRows[0];
    const merged = { ...cur, ...p };
    const comp = computeCompliance(merged);
    const patch = { ...p, next_due_date: comp.next_due_date, compliant: comp.compliant };
    const fields = Object.keys(patch);
    if (!fields.length) return res.status(400).json({ error: 'No fields' });
    const setSql = fields.map((k,i)=> `${k}=$${i+1}`).join(', ');
    const { rows } = await pool.query(`UPDATE atex_equipment SET ${setSql}, updated_at=now() WHERE id=$${fields.length+1} AND site=$${fields.length+2} RETURNING *`, [...fields.map(k=>patch[k]), id, req.site]);
    res.json(rows[0]);
  }catch(e){ res.status(400).json({ error: e.message }); }
});

router.delete('/equipments/:id', async (req,res)=>{
  const id = req.params.id;
  await pool.query('DELETE FROM atex_files WHERE equipment_id=$1', [id]);
  const { rowCount } = await pool.query('DELETE FROM atex_equipment WHERE id=$1 AND site=$2', [id, req.site]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.get('/equipments', async (req,res)=>{
  const { q, building, zone_gas, zone_dust, category_g, category_d, status, sort='updated_at:desc', page='1', pageSize='50' } = req.query;
  const where = ['site=$1']; const vals = [req.site];
  if (building){ vals.push(building); where.push(`building=$${vals.length}`); }
  if (zone_gas){ vals.push(+zone_gas); where.push(`zone_gas=$${vals.length}`); }
  if (zone_dust){ vals.push(+zone_dust); where.push(`zone_dust=$${vals.length}`); }
  if (category_g){ vals.push(category_g); where.push(`category_g=$${vals.length}`); }
  if (category_d){ vals.push(category_d); where.push(`category_d=$${vals.length}`); }
  if (status === 'compliant'){ where.push('compliant=true'); }
  if (status === 'noncompliant'){ where.push('compliant=false'); }
  if (q){ vals.push('%'+q.toLowerCase()+'%'); where.push(`(lower(reference) LIKE $${vals.length} OR lower(brand) LIKE $${vals.length} OR lower(designation) LIKE $${vals.length})`); }
  const [scol,sdir] = String(sort).split(':');
  const orderCol = ['reference','brand','building','updated_at','next_due_date','last_inspection_date','compliant'].includes(scol) ? scol : 'updated_at';
  const dir = sdir==='asc' ? 'ASC' : 'DESC';
  const p = Math.max(1, parseInt(page)); const ps = Math.min(200, Math.max(10, parseInt(pageSize)));
  const offset = (p-1)*ps;
  const sql = `SELECT * FROM atex_equipment WHERE ${where.join(' AND ')} ORDER BY ${orderCol} ${dir} LIMIT ${ps} OFFSET ${offset}`;
  const { rows } = await pool.query(sql, vals);
  res.json(rows);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/equipments/:id/files', upload.array('files', 10), async (req,res)=>{
  const id = req.params.id;
  if (!req.files?.length) return res.json([]);
  const inserted = [];
  for (const f of req.files){
    const { rows } = await pool.query(
      'INSERT INTO atex_files(equipment_id, filename, mime_type, file_data) VALUES($1,$2,$3,$4) RETURNING id, filename, mime_type, uploaded_at',
      [id, f.originalname, f.mimetype, f.buffer]
    );
    inserted.push(rows[0]);
  }
  res.json(inserted);
});

router.get('/equipments/:id/files', async (req,res)=>{
  const { rows } = await pool.query('SELECT id, filename, mime_type, uploaded_at FROM atex_files WHERE equipment_id=$1', [req.params.id]);
  res.json(rows);
});

router.get('/files/:fileId', async (req,res)=>{
  const fid = req.params.fileId;
  const { rows } = await pool.query('SELECT filename, mime_type, file_data FROM atex_files WHERE id=$1', [fid]);
  if (!rows.length) return res.status(404).end();
  const file = rows[0];
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.send(file.file_data);
});

router.delete('/files/:fileId', async (req,res)=>{
  const fid = req.params.fileId;
  await pool.query('DELETE FROM atex_files WHERE id=$1', [fid]);
  res.json({ ok: true });
});

router.get('/template', async (_req,res)=>{
  const buf = await buildTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="atex_template.xlsx"');
  res.send(buf);
});

router.post('/import', upload.single('file'), async (req,res)=>{
  try{
    if (!req.file) throw new Error('Fichier Excel absent');
    const items = await parseImportBuffer(req.file.buffer);
    await pool.query('BEGIN');
    for (const p of items){
      const comp = computeCompliance(p);
      await pool.query(`INSERT INTO atex_equipment
      (reference,brand,designation,atex_reference,marking,building,room,site,zone_gas,zone_dust,category_g,category_d,last_inspection_date,next_due_date,compliant,comments)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (reference) DO UPDATE SET
        brand=EXCLUDED.brand, designation=EXCLUDED.designation, atex_reference=EXCLUDED.atex_reference, marking=EXCLUDED.marking,
        building=EXCLUDED.building, room=EXCLUDED.room, site=EXCLUDED.site, zone_gas=EXCLUDED.zone_gas, zone_dust=EXCLUDED.zone_dust,
        category_g=EXCLUDED.category_g, category_d=EXCLUDED.category_d, last_inspection_date=EXCLUDED.last_inspection_date,
        next_due_date=EXCLUDED.next_due_date, compliant=EXCLUDED.compliant, comments=EXCLUDED.comments, updated_at=now()
      `, [p.reference, p.brand, p.designation, p.atex_reference||null, p.marking||null, p.building, p.room||null, 'Default', p.zone_gas??null, p.zone_dust??null, p.category_g??null, p.category_d??null, p.last_inspection_date||null, comp.next_due_date, comp.compliant, p.comments||null]);
    }
    await pool.query('COMMIT');
    res.json({ inserted: items.length });
  }catch(e){
    await pool.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

router.get('/export', async (req,res)=>{
  const { rows } = await pool.query('SELECT * FROM atex_equipment WHERE site=$1 ORDER BY updated_at DESC', [req.site]);
  const wb = new (await import('exceljs')).Workbook();
  const ws = wb.addWorksheet('ATEX');
  const cols = Object.keys(rows[0] || { reference: '' });
  ws.addRow(cols);
  rows.forEach(r => ws.addRow(cols.map(c => r[c])));
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="atex_export.xlsx"');
  res.send(Buffer.from(buf));
});

router.post('/assist/:id', async (req,res)=>{
  const { rows } = await pool.query('SELECT * FROM atex_equipment WHERE id=$1 AND site=$2', [req.params.id, req.site]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const eq = rows[0];
  if (eq.compliant) return res.json({ message: 'Équipement conforme. Aucune action requise.' });
  const answer = await suggestForNonConformity(eq);
  res.json({ answer });
});

export default router;
