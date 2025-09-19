// server_loopcalc.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// simple calc
function assessCompliance({ voltage, resistance, capacitance, inductance, distance, maxCurrent, safetyFactor }) {
  const loopResistance = (resistance/1000) * distance * 2;
  const loopCurrent = voltage / loopResistance;
  const compliant = loopCurrent >= maxCurrent * safetyFactor;
  return { compliance: compliant ? 'Compliant' : 'Non-compliant', loopResistance, loopCurrent };
}

// list calcs
app.get('/api/loopcalc/calculations', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM loop_calcs ORDER BY created_at DESC LIMIT 50');
  res.json(rows);
});

// create calc
app.post('/api/loopcalc/calculations', async (req, res) => {
  try {
    const calc = assessCompliance(req.body);
    const { rows } = await pool.query(
      `INSERT INTO loop_calcs (project, voltage, cable_type, resistance, capacitance, inductance, distance, max_current, safety_factor, compliance, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       RETURNING *`,
      [req.body.project, req.body.voltage, req.body.cableType, req.body.resistance, req.body.capacitance, req.body.inductance, req.body.distance, req.body.maxCurrent, req.body.safetyFactor, calc.compliance]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Calculation failed' });
  }
});

const port = process.env.LOOPCALC_PORT || 3002;
app.listen(port, () => console.log(`LoopCalc service running on :${port}`));
