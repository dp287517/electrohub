import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ================== CRUD ÉQUIPEMENTS ==================

// Récupérer tous les équipements
app.get('/api/atex', async (req, res) => {
  const result = await pool.query('SELECT * FROM atex_equipments ORDER BY id DESC');
  res.json(result.rows);
});

// Récupérer un équipement
app.get('/api/atex/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM atex_equipments WHERE id=$1', [req.params.id]);
  res.json(result.rows[0]);
});

// Créer un équipement
app.post('/api/atex', async (req, res) => {
  const { reference, name, building, zone, last_control_date, status, risk_level, comment } = req.body;
  const result = await pool.query(
    `INSERT INTO atex_equipments (reference, name, building, zone, last_control_date, status, risk_level, comment) 
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [reference, name, building, zone, last_control_date, status, risk_level, comment]
  );
  res.status(201).json(result.rows[0]);
});

// Modifier un équipement
app.put('/api/atex/:id', async (req, res) => {
  const { reference, name, building, zone, last_control_date, status, risk_level, comment } = req.body;
  const result = await pool.query(
    `UPDATE atex_equipments 
     SET reference=$1, name=$2, building=$3, zone=$4, last_control_date=$5, status=$6, risk_level=$7, comment=$8, updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [reference, name, building, zone, last_control_date, status, risk_level, comment, req.params.id]
  );
  res.json(result.rows[0]);
});

// Supprimer un équipement
app.delete('/api/atex/:id', async (req, res) => {
  await pool.query('DELETE FROM atex_equipments WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ================== FICHIERS ==================

// Upload fichier
app.post('/api/atex/:id/files', upload.single('file'), async (req, res) => {
  const { originalname, mimetype, buffer } = req.file;
  await pool.query(
    'INSERT INTO atex_files (equipment_id, filename, mime_type, file_data) VALUES ($1,$2,$3,$4)',
    [req.params.id, originalname, mimetype, buffer]
  );
  res.json({ success: true });
});

// Récupérer fichiers liés
app.get('/api/atex/:id/files', async (req, res) => {
  const result = await pool.query(
    'SELECT id, filename, mime_type, uploaded_at FROM atex_files WHERE equipment_id=$1',
    [req.params.id]
  );
  res.json(result.rows);
});

// Télécharger un fichier
app.get('/api/atex/files/:fileId', async (req, res) => {
  const result = await pool.query('SELECT * FROM atex_files WHERE id=$1', [req.params.fileId]);
  if (!result.rows.length) return res.status(404).send('Not found');
  const file = result.rows[0];
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.file_data);
});

// ================== EXCEL IMPORT / EXPORT ==================

// Import Excel
app.post('/api/atex/upload', upload.single('file'), async (req, res) => {
  const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);

  for (const row of rows) {
    await pool.query(
      `INSERT INTO atex_equipments (reference, name, building, zone, last_control_date, status, risk_level, comment) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (reference) DO NOTHING`,
      [
        row['Référence'],
        row['Nom équipement'],
        row['Bâtiment'],
        row['Zone ATEX'],
        row['Date dernier contrôle'],
        row['Statut'],
        row['Niveau de risque (1–5)'],
        row['Commentaire'],
      ]
    );
  }

  res.json({ success: true });
});

// Export Excel
app.get('/api/atex/export', async (req, res) => {
  const result = await pool.query('SELECT * FROM atex_equipments');
  const worksheet = xlsx.utils.json_to_sheet(result.rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'ATEX');
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="atex_export.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

export default app;
