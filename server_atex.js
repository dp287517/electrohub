import express from 'express';
import multer from 'multer';
import pkg from 'pg';
import xlsx from 'xlsx';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const upload = multer();
const router = express.Router();

router.get('/search', async (req, res) => {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Reference required' });
  try {
    const { rows } = await pool.query(
      `select * from atex_equipments where lower(ref) = lower($1) limit 1`,
      [ref]
    );
    if (rows.length === 0) return res.json(null);

    const eq = rows[0];
    const { rows: att } = await pool.query(
      `select id, filename, mimetype from atex_attachments where equipment_id = $1`,
      [eq.id]
    );
    eq.attachments = att.map(a => ({
      id: a.id,
      filename: a.filename,
      mimetype: a.mimetype,
      url: `/api/atex/attachment/${a.id}`
    }));
    res.json(eq);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

router.post('/create', async (req, res) => {
  const { site_id, ref, certification_zones, installation_zone, last_control, comments, building, area } = req.body;
  try {
    const { rows } = await pool.query(
      `insert into atex_equipments (site_id, ref, certification_zones, installation_zone, last_control, comments, building, area)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [site_id, ref, certification_zones, installation_zone, last_control, comments, building, area]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB insert error' });
  }
});

router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { certification_zones, installation_zone, last_control, comments, building, area } = req.body;
  try {
    const { rows } = await pool.query(
      `update atex_equipments set certification_zones=$1, installation_zone=$2, last_control=$3,
       comments=$4, building=$5, area=$6, updated_at=now() where id=$7 returning *`,
      [certification_zones, installation_zone, last_control, comments, building, area, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB update error' });
  }
});

router.post('/upload/:equipmentId', upload.array('files'), async (req, res) => {
  const { equipmentId } = req.params;
  try {
    for (const file of req.files) {
      await pool.query(
        `insert into atex_attachments (equipment_id, filename, mimetype, data) values ($1,$2,$3,$4)`,
        [equipmentId, file.originalname, file.mimetype, file.buffer]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Attachment upload failed' });
  }
});

router.get('/attachment/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`select * from atex_attachments where id=$1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).send('Not found');
    const file = rows[0];
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Download error' });
  }
});

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    for (const row of data) {
      await pool.query(
        `insert into atex_equipments (site_id, ref, certification_zones, installation_zone, last_control, comments, building, area)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [1, row.Reference, row.CertificationZones.split(','), row.InstallationZone, row.LastControl, row.Comment, row.Building, row.Area]
      );
    }
    res.json({ imported: data.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Import failed' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const { rows } = await pool.query('select * from atex_equipments');
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'ATEX');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=atex_export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/assessment', async (req, res) => {
  try {
    const { rows } = await pool.query('select installation_zone, count(*) as count from atex_equipments group by installation_zone');
    res.json({ stats: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Assessment failed' });
  }
});

export default router;
