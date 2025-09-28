// server_selectivity.js (ESM)
// - Passage à ES Modules (import ... from) car "type":"module" dans package.json
// - Même logique que la version précédente : CORS sûr, stabilité numérique, plage de test élargie
// - Schéma de base de données inchangé

import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';

const { Pool } = pg;

const app = express();
app.use(bodyParser.json());

// ------- CORS SÛR (Origin + Credentials) -------
app.use((req, res, next) => {
  const allowed = process.env.CORS_ORIGIN; // ex: https://app.mondomaine.com
  if (allowed) {
    const origin = req.headers.origin;
    const useOrigin =
      origin && (origin === allowed || origin.includes(allowed)) ? origin : allowed;
    res.setHeader('Access-Control-Allow-Origin', useOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    // Pas d’origin défini -> pas de credentials
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ------- DB (schéma inchangé) -------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
});

// Utilitaire : récupération d’un appareil par id (existant dans ton backend)
async function getDeviceById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, in_amps, settings
     FROM devices
     WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// --------- Physique/Modèle simplifié ---------
const EPS = 1e-9;

// Temps de déclenchement côté "long time" (modèle simple) avec clamp près de Ir·In
function longTimeTrip(I, In, Ir, Tr) {
  const Ith = (Ir || 1) * (In || 100); // courant de seuil long time
  if (I <= Ith * (1 + 1e-6)) return 1e6; // "très long" au lieu d'Infinity
  return Tr / ((((I / Ith) ** 2) - 1) + EPS);
}

// Instantanée (Ii) — retourne 0 si on dépasse le seuil instantané, sinon Infinity
function instantaneousTrip(I, In, Ir, Ii) {
  const ithInst = (Ii || 10) * (Ir || 1) * (In || 100);
  return I >= ithInst ? 0 : Infinity;
}

// Short delay (simplifié) — si I dépasse Isd*Ir*In => TsD, sinon Infinity
function shortDelayTrip(I, In, Ir, Isd, Tsd) {
  const ithS = (Isd || 0) * (Ir || 1) * (In || 100);
  if (!Isd) return Infinity;
  return I >= ithS ? (Tsd || 0.1) : Infinity;
}

// Calcul global de temps de déclenchement (min de tous les étages)
function calculateTripTime(I, device) {
  const In = device.in_amps || 100;
  const s = device.settings || {};
  const Ir = s.ir || 1;
  const Tr = s.tr || 10;      // constante de temps long time (exemple)
  const Ii = s.ii || 10;      // multiple instantané
  const Isd = s.isd || 0;     // multiple short delay (0 = désactivé)
  const Tsd = s.tsd || 0.1;   // temps de short delay

  const tLT = longTimeTrip(I, In, Ir, Tr);
  const tSD = shortDelayTrip(I, In, Ir, Isd, Tsd);
  const tIN = instantaneousTrip(I, In, Ir, Ii);

  return Math.min(tLT, tSD, tIN);
}

// Génération robuste de la plage de courant (log-spaced)
function buildCurrentSweep(up, down, faultI) {
  if (faultI && Number.isFinite(Number(faultI))) {
    return [Number(faultI)];
  }
  const InUp = up.in_amps || 100;
  const InDown = down.in_amps || 100;
  const sUp = up.settings || {};
  const sDown = down.settings || {};
  const IrUp = sUp.ir || 1;
  const IrDown = sDown.ir || 1;
  const IiUp = sUp.ii || 10;
  const IiDown = sDown.ii || 10;

  const baseMin = 0.1 * Math.max(1, Math.min(InUp, InDown));
  const maxUp = (IiUp * IrUp * InUp);
  const maxDown = (IiDown * IrDown * InDown);
  const baseMax = 20 * Math.max(maxUp, maxDown, InUp, InDown);

  const steps = 60;
  const logMin = Math.log10(baseMin);
  const logMax = Math.log10(baseMax);
  return Array.from({ length: steps }, (_, i) =>
    10 ** (logMin + (i * (logMax - logMin)) / (steps - 1))
  );
}

// Comparaison sélectivité : aval doit déclencher au moins 5% plus vite que amont
function isSelective(tUp, tDown) {
  if (!isFinite(tUp) && !isFinite(tDown)) return false;
  if (!isFinite(tUp)) return false; // amont "inf" => aval doit être fini
  if (!isFinite(tDown)) return false; // aval inf -> pas acceptable
  return tDown < (tUp / 1.05); // aval au moins 5% plus rapide
}

// Point par point
function checkSelectivity(up, down, currents) {
  const pointsUp = [];
  const pointsDown = [];
  let allSelective = true;

  for (const I of currents) {
    const tU = calculateTripTime(I, up);
    const tD = calculateTripTime(I, down);
    pointsUp.push({ current: I, time: tU });
    pointsDown.push({ current: I, time: tD });

    const finite = isFinite(tU) && isFinite(tD);
    if (finite) {
      const ok = tD < (tU / 1.05);
      if (!ok) allSelective = false;
    }
  }

  return {
    status: allSelective ? 'selective' : 'non-selective',
    curves: { upstream: pointsUp, downstream: pointsDown },
  };
}

// --------- API ---------

// GET /api/pairs -> paires amont/aval
app.get('/api/pairs', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT upstream_id, downstream_id
       FROM device_pairs
       ORDER BY downstream_id, upstream_id`
    );
    res.json({ pairs: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/check-selectivity
app.post('/api/check-selectivity', async (req, res) => {
  try {
    let { upstreamId, downstreamId, faultCurrent, upstream, downstream } = req.body || {};

    if (!upstream || !downstream) {
      if (!upstreamId || !downstreamId) {
        return res.status(400).json({ error: 'Missing upstream/downstream identifiers' });
      }
      const [up, down] = await Promise.all([
        getDeviceById(upstreamId),
        getDeviceById(downstreamId),
      ]);
      if (!up || !down) {
        return res.status(404).json({ error: 'Device not found' });
      }
      upstream = up;
      downstream = down;
    }

    const currents = buildCurrentSweep(upstream, downstream, faultCurrent);
    const result = checkSelectivity(upstream, downstream, currents);

    // Optionnel : journaliser (schéma existant)
    // await pool.query(
    //   `INSERT INTO selectivity_checks(site_id, upstream_id, downstream_id, status, at)
    //    VALUES ($1,$2,$3,$4,NOW())`,
    //   [req.headers['x-site'] || null, upstream.id, downstream.id, result.status]
    // );

    res.json({
      status: result.status,
      currents,
      curves: result.curves,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Démarrage
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`selectivity server listening on ${port}`);
});
