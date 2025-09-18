// atex.routes.js
import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const router = express.Router();

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// --- helpers métier --- //
function computeNextDueDate(lastDateStr, nextFromClient) {
  if (!lastDateStr) return nextFromClient || null;
  const last = new Date(lastDateStr);
  if (Number.isNaN(last.getTime())) return nextFromClient || null;

  const max = new Date(last);
  max.setFullYear(max.getFullYear() + 3);
  if (!nextFromClient) return max.toISOString().slice(0, 10);

  const client = new Date(nextFromClient);
  if (Number.isNaN(client.getTime())) return max.toISOString().slice(0, 10);

  // On borne à max(last + 3 ans)
  return (client > max ? max : client).toISOString().slice(0, 10);
}

function isGasCompliant(zoneGas, categoryG) {
  if (zoneGas == null || categoryG == null) return true; // pas de contrainte si non utilisé
  const cat = String(categoryG).toUpperCase();
  if (zoneGas === 0) return cat === '1G';
  if (zoneGas === 1) return cat === '1G' || cat === '2G';
  if (zoneGas === 2) return cat === '1G' || cat === '2G' || cat === '3G';
  return false;
}

function isDustCompliant(zoneDust, categoryD) {
  if (zoneDust == null || categoryD == null) return true;
  const cat = String(categoryD).toUpperCase();
  if (zoneDust === 20) return cat === '1D';
  if (zoneDust === 21) return cat === '1D' || cat === '2D';
  if (zoneDust === 22) return cat === '1D' || cat === '2D' || cat === '3D';
  return false;
}

function computeCompliance({ zone_gas, category_g, zone_dust, category_d }) {
  const gasOK = isGasCompliant(zone_gas, category_g);
  const dustOK = isDustCompliant(zone_dust, category_d);
  return gasOK && dustOK;
}

// --- routes --- //

// GET /api/atex/equipment?ref=REF  (insensible à la casse)
router.get('/equipment', async (req, res) => {
  try {
    const ref = (req.query.ref || '').trim();
    if (!ref) return res.status(400).json({ error: 'Missing ref' });

    const { rows } = await pool.query(
      `SELECT * FROM atex_equipment WHERE lower(reference)=lower($1)`,
      [ref]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  } catch (e) {
    console.error('GET /equipment error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/atex/equipment  (create)
router.post('/equipment', async (req, res) => {
  try {
    const {
      reference, designation, building,
      zone_gas, zone_dust, category_g, category_d,
      marking, last_inspection_date, next_due_date, comments
    } = req.body || {};

    if (!reference || !designation || !building) {
      return res.status(400).json({ error: 'reference, designation, building are required' });
    }

    const nextDue = computeNextDueDate(last_inspection_date, next_due_date);
    const compliant = computeCompliance({
      zone_gas: zone_gas == null ? null : Number(zone_gas),
      zone_dust: zone_dust == null ? null : Number(zone_dust),
      category_g: category_g || null,
      category_d: category_d || null
    });

    const { rows } = await pool.query(
      `INSERT INTO atex_equipment
       (reference, designation, building, zone_gas, zone_dust, category_g, category_d, marking,
        last_inspection_date, next_due_date, compliant, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        reference.trim(),
        designation,
        building,
        zone_gas == null ? null : Number(zone_gas),
        zone_dust == null ? null : Number(zone_dust),
        category_g || null,
        category_d || null,
        marking || null,
        last_inspection_date || null,
        nextDue,
        compliant,
        comments || null
      ]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    if (String(e?.message || '').includes('unique')) {
      return res.status(409).json({ error: 'Reference already exists' });
    }
    console.error('POST /equipment error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/atex/equipment/:id  (update)
router.put('/equipment/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const {
      reference, designation, building,
      zone_gas, zone_dust, category_g, category_d,
      marking, last_inspection_date, next_due_date, comments
    } = req.body || {};

    // Récupérer l’existant pour recalculer à partir d’une base sûre
    const prev = await pool.query(`SELECT * FROM atex_equipment WHERE id=$1`, [id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Not found' });

    const base = prev.rows[0];

    const lastDate = (last_inspection_date ?? base.last_inspection_date);
    const nextDue = computeNextDueDate(lastDate, (next_due_date ?? base.next_due_date));

    const zGas = (zone_gas == null ? base.zone_gas : Number(zone_gas));
    const zDust = (zone_dust == null ? base.zone_dust : Number(zone_dust));
    const cG = (category_g == null ? base.category_g : category_g);
    const cD = (category_d == null ? base.category_d : category_d);

    const compliant = computeCompliance({
      zone_gas: zGas,
      zone_dust: zDust,
      category_g: cG,
      category_d: cD
    });

    const { rows } = await pool.query(
      `UPDATE atex_equipment SET
        reference = $1,
        designation = $2,
        building = $3,
        zone_gas = $4,
        zone_dust = $5,
        category_g = $6,
        category_d = $7,
        marking = $8,
        last_inspection_date = $9,
        next_due_date = $10,
        compliant = $11,
        comments = $12
       WHERE id=$13
       RETURNING *`,
      [
        (reference ?? base.reference).trim(),
        (designation ?? base.designation),
        (building ?? base.building),
        zGas,
        zDust,
        cG,
        cD,
        (marking ?? base.marking),
        lastDate,
        nextDue,
        compliant,
        (comments ?? base.comments),
        id
      ]
    );

    res.json(rows[0]);
  } catch (e) {
    if (String(e?.message || '').includes('unique')) {
      return res.status(409).json({ error: 'Reference already exists' });
    }
    console.error('PUT /equipment/:id error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
