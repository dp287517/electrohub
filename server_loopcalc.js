// server_loopcalc.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import PDFDocument from 'pdfkit';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Health
app.get('/api/loopcalc/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Domain helpers
function assessCompliance({ voltage, resistance, distance, maxCurrent, safetyFactor }) {
  // résistance boucle = (Ω/km -> Ω/m * distance * aller/retour)
  const loopResistance = (Number(resistance) / 1000) * Number(distance) * 2; // Ω
  const loopCurrent = loopResistance > 0 ? Number(voltage) / loopResistance : 0; // A
  const compliant = loopCurrent >= Number(maxCurrent) * Number(safetyFactor);
  return { compliance: compliant ? 'Compliant' : 'Non-compliant', loopResistance, loopCurrent };
}

// ---- LIST with filters/sort/pagination
// query: q, compliance, project, sort=created_at|project|voltage|distance|compliance , dir=asc|desc , page=1 , pageSize=20
app.get('/api/loopcalc/calculations', async (req, res) => {
  try {
    const { q, compliance, project, sort = 'created_at', dir = 'desc', page = '1', pageSize = '20' } = req.query;
    const where = [];
    const vals = [];
    let i = 1;

    if (q) {
      where.push(`(project ILIKE $${i} OR cable_type ILIKE $${i})`);
      vals.push(`%${q}%`); i++;
    }
    if (project) {
      where.push(`project ILIKE $${i}`); vals.push(`%${project}%`); i++;
    }
    if (compliance) {
      where.push(`compliance = $${i}`); vals.push(compliance); i++;
    }

    const whitelist = ['created_at','project','voltage','distance','compliance'];
    const sortSafe = whitelist.includes(String(sort)) ? sort : 'created_at';
    const dirSafe = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const limit = Math.min(parseInt(pageSize,10) || 20, 100);
    const offset = ((parseInt(page,10) || 1) - 1) * limit;

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, project, voltage, cable_type, resistance, capacitance, inductance, distance, max_current, safety_factor, compliance, created_at
       FROM loop_calcs
       ${whereSql}
       ORDER BY ${sortSafe} ${dirSafe}
       LIMIT ${limit} OFFSET ${offset}`
      , vals
    );

    // total count for pagination
    const countQ = await pool.query(`SELECT COUNT(*)::int AS total FROM loop_calcs ${whereSql}`, vals);
    res.json({ data: rows, total: countQ.rows[0].total, page: Number(page), pageSize: limit });
  } catch (e) {
    console.error('[LOOP LIST] error:', e.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// ---- CREATE (compute + store)
app.post('/api/loopcalc/calculations', async (req, res) => {
  try {
    const payload = {
      project: req.body.project || null,
      voltage: Number(req.body.voltage),
      cable_type: String(req.body.cableType || ''),
      resistance: Number(req.body.resistance),
      capacitance: Number(req.body.capacitance),
      inductance: Number(req.body.inductance),
      distance: Number(req.body.distance),
      max_current: Number(req.body.maxCurrent),
      safety_factor: Number(req.body.safetyFactor)
    };
    const calc = assessCompliance({
      voltage: payload.voltage,
      resistance: payload.resistance,
      distance: payload.distance,
      maxCurrent: payload.max_current,
      safetyFactor: payload.safety_factor
    });

    const { rows } = await pool.query(
      `INSERT INTO loop_calcs
        (project, voltage, cable_type, resistance, capacitance, inductance, distance, max_current, safety_factor, compliance, created_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
       RETURNING *`,
      [
        payload.project, payload.voltage, payload.cable_type, payload.resistance,
        payload.capacitance, payload.inductance, payload.distance,
        payload.max_current, payload.safety_factor, calc.compliance
      ]
    );
    const row = rows[0];
    // enrich with computed fields for client convenience
    row.loop_resistance = calc.loopResistance;
    row.loop_current = calc.loopCurrent;
    res.status(201).json(row);
  } catch (e) {
    console.error('[LOOP CREATE] error:', e.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

// ---- REPORT (PDF Pro)
app.get('/api/loopcalc/:id/report', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query('SELECT * FROM loop_calcs WHERE id=$1', [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });

    // recompute (for derived values)
    const calc = assessCompliance({
      voltage: row.voltage,
      resistance: row.resistance,
      distance: row.distance,
      maxCurrent: row.max_current,
      safetyFactor: row.safety_factor
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="loopcalc_${id}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Header brand band
    doc.rect(0, 0, doc.page.width, 70).fill('#eef7ff');
    doc.fill('#0f3e99').fontSize(20).font('Helvetica-Bold').text('ElectroHub – Loop Calculation Report', 50, 25);
    doc.fill('#333');

    // Meta
    const y0 = 90;
    doc.fontSize(10).text(`Report date: ${new Date().toLocaleString()}`, 50, y0);
    doc.text(`Project: ${row.project || '—'}`, 50, y0 + 14);
    doc.text(`Compliance: ${calc.compliance}`, 50, y0 + 28, { continued: true });

    // Compliance badge
    const badgeX = 430, badgeY = y0 + 22, badgeW = 120, badgeH = 22;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6)
      .fill(calc.compliance === 'Compliant' ? '#16a34a' : '#dc2626');
    doc.fill('#fff').fontSize(11).font('Helvetica-Bold')
      .text(calc.compliance.toUpperCase(), badgeX, badgeY + 5, { width: badgeW, align: 'center' });
    doc.fill('#333').font('Helvetica');

    // Inputs table
    const tY = y0 + 60;
    doc.fontSize(12).font('Helvetica-Bold').text('Inputs', 50, tY);
    doc.font('Helvetica').fontSize(10);
    const rows = [
      ['Source voltage (V)', `${row.voltage}`],
      ['Cable type', row.cable_type || '—'],
      ['Distance (m)', `${row.distance}`],
      ['Resistance (Ω/km)', `${row.resistance}`],
      ['Capacitance (nF/km)', `${row.capacitance}`],
      ['Inductance (mH/km)', `${row.inductance}`],
      ['Max current (A)', `${row.max_current}`],
      ['Safety factor', `${row.safety_factor}`],
    ];
    let yy = tY + 18;
    rows.forEach(([k,v], idx) => {
      if (idx % 2 === 0) { doc.rect(45, yy-4, 510, 18).fill('#f8fafc').fill('#333'); }
      doc.text(k, 55, yy);
      doc.text(v, 330, yy, { width: 220, align: 'right' });
      yy += 18;
    });

    // Results
    yy += 12;
    doc.font('Helvetica-Bold').fontSize(12).text('Results', 50, yy);
    doc.font('Helvetica').fontSize(10);
    yy += 18;
    const loopR = calc.loopResistance.toFixed(4);
    const loopI = calc.loopCurrent.toFixed(4);
    doc.text('Loop resistance (Ω)', 55, yy);
    doc.text(loopR, 330, yy, { width: 220, align: 'right' });
    yy += 18;
    doc.text('Loop current (A)', 55, yy);
    doc.text(loopI, 330, yy, { width: 220, align: 'right' });
    yy += 28;

    // Schematic (simple): source -> cable -> load
    const sx = 80, sy = yy + 20;
    // source
    doc.circle(sx, sy, 10).stroke('#0f3e99');
    doc.text('Source', sx - 18, sy + 14, { width: 36, align: 'center' });
    // cable
    doc.moveTo(sx+10, sy).lineTo(sx+170, sy).dash(2, { space: 2 }).stroke('#0f3e99').undash();
    doc.text('Cable', sx + 70, sy + 8, { width: 40, align:'center' });
    // load
    doc.rect(sx+170, sy-12, 60, 24).stroke('#0f3e99');
    doc.text('Load', sx+170, sy + 14, { width: 60, align:'center' });
    // annotations
    doc.fontSize(9).fill('#555')
      .text(`Distance: ${row.distance} m`, sx + 40, sy - 26)
      .text(`R: ${row.resistance} Ω/km`, sx + 40, sy - 14)
      .text(`C: ${row.capacitance} nF/km`, sx + 40, sy - 2)
      .text(`L: ${row.inductance} mH/km`, sx + 40, sy + 10);
    doc.fill('#333');

    // Footer
    doc.moveTo(50, 805).lineTo(545, 805).stroke('#e5e7eb');
    doc.fontSize(9).fill('#6b7280')
      .text('Generated by ElectroHub', 50, 810)
      .text(`Report #${id}`, 500, 810, { width: 45, align: 'right' });

    doc.end();
  } catch (e) {
    console.error('[LOOP REPORT] error:', e.message);
    res.status(500).json({ error: 'Report failed' });
  }
});

const port = process.env.LOOPCALC_PORT || 3002;
app.listen(port, () => console.log(`LoopCalc service running on :${port}`));
