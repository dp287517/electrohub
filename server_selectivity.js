// server_selectivity.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import cors from 'cors';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

/* ----------------------- CORS (whitelist) ----------------------- */
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // allow same-origin / curl / server-to-server (no origin header)
    if (!origin) return callback(null, true);
    if (ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
};
 
/* ----------------------- App & security ------------------------- */
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(cors(corsOptions));

/* ----------------------- Helpers -------------------------------- */
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || '').toString();
}

const WHITELIST_SORT = ['name', 'building_code']; // retire "code" si la colonne n'existe pas
function sortSafe(sort) {
  return WHITELIST_SORT.includes(String(sort)) ? sort : 'name';
}
function dirSafe(dir) {
  return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
}

const SELECTIVITY_MARGIN = Number(process.env.SELECTIVITY_MARGIN || '0.05'); // 5% par défaut
const EPS = 1e-9;

/* ----------------------- DB bootstrap (facultatif) --------------- */
// Appelle à l’init si besoin pour créer une table d’audit des checks
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS selectivity_checks (
      id SERIAL PRIMARY KEY,
      site TEXT,
      upstream_id INTEGER,
      downstream_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT now(),
      ok BOOLEAN,
      non_selective_zones JSONB
    );
  `);
}
ensureSchema().catch(console.error);

/* ----------------------- Modèle de calcul ------------------------ */
/**
 * Modèle simplifié pour courbe temps-courant en s fonction de I (A).
 * Supporte quelques paramètres courants (Ir, In, Tr, Isd, Ii).
 * On reste volontairement simple mais stable numériquement.
 */
function tripTime(device, I) {
  const In = Number(device?.in_amps) || 100;        // courant nominal
  const Ir = Number(device?.ir || 1);               // long time pickup (en In)
  const Tr = Number(device?.tr_s || 5);             // long time delay (s)
  const Isd = Number(device?.isd || 5);             // short delay pickup (en Ir)
  const Tsd = Number(device?.tsd_s || 0.1);         // short delay time (s)
  const Ii = Number(device?.ii || 10);              // instant pickup (en Ir)
  const Iamp = Math.max(I, EPS);

  // Zones : LT (I < Isd*Ir*In), STD (entre Isd et Ii), INST (>= Ii*Ir*In)
  const LT_pick = Ir * In;
  const SD_pick = Isd * Ir * In;
  const INST_pick = Ii * Ir * In;

  if (Iamp < LT_pick * (1 + EPS)) {
    // En-dessous du pickup LT, pas de déclenchement dans la fenêtre -> bornons haut
    return Infinity;
  }

  if (Iamp < SD_pick) {
    // Long Time : loi type I^2t (simplifiée) avec EPS pour stabilité
    const ratio = Iamp / (Ir * In);
    const denom = Math.max(ratio * ratio - 1, EPS);
    return Math.max(Tr / denom, EPS);
  }

  if (Iamp < INST_pick) {
    // Short Time : palier temporisé
    return Math.max(Tsd, EPS);
  }

  // Instantané : très rapide, bornons bas
  return 0.01;
}

/**
 * Construit des points {x,y} d’une courbe temps-courant pour un device.
 * Echelle log en X => on échantillonne en log10(I).
 */
function buildCurve(device) {
  const points = [];
  const In = Number(device?.in_amps) || 100;
  const Icu_kA = Number(device?.icu_ka) || 50;

  // Plage robuste : 0.2×In → (Icu_kA*1000) A
  const Imin = Math.max(0.2 * In, 1);
  const Imax = Math.max(Icu_kA * 1000, 10 * In);

  const logMin = Math.log10(Imin);
  const logMax = Math.log10(Imax);
  const step = 0.08; // résolution fine

  for (let l = logMin; l <= logMax + EPS; l += step) {
    const I = Math.pow(10, l);
    let t = tripTime(device, I);
    if (!isFinite(t) || t > 1000) t = 1000; // bornage pour affichage
    if (t < EPS) t = EPS;
    points.push({ x: I, y: t });
  }
  return points;
}

/**
 * Détecte les zones non sélectives : t_down >= (1 + margin) * t_up
 * Retourne une liste de bandes [xMin,xMax].
 */
function findNonSelectiveZones(upPts, downPts, margin = SELECTIVITY_MARGIN) {
  // On suppose les deux séries sur un maillage log similaire
  const zones = [];
  let current = null;

  const n = Math.min(upPts.length, downPts.length);
  for (let i = 0; i < n; i++) {
    const u = upPts[i];
    const d = downPts[i];
    const nonSel = d.y >= (1 + margin) * u.y; // down plus lent qu’up => non sélectif

    if (nonSel && !current) {
      current = { xMin: Math.min(u.x, d.x), xMax: Math.max(u.x, d.x) };
    } else if (nonSel && current) {
      current.xMax = Math.max(current.xMax, u.x, d.x);
    } else if (!nonSel && current) {
      zones.push(current);
      current = null;
    }
  }
  if (current) zones.push(current);
  return zones;
}

/* ----------------------- API ------------------------------------ */

// Liste de paires (amont/aval) avec filtres
app.get('/api/selectivity/pairs', async (req, res) => {
  try {
    const site = siteOf(req);
    const { q = '', switchboard = '', building = '', floor = '', sort = 'name', dir = 'desc', page = 1 } = req.query;

    const s = sortSafe(sort);
    const d = dirSafe(dir);
    const limit = 20;
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    // Exemple simplifié : suppose une vue materialized "device_pairs" (id_up, id_down, name, building_code, ...)
    const { rows } = await pool.query(
      `
      SELECT id_up, id_down, name, building_code, floor, switchboard
      FROM device_pairs
      WHERE ($1 = '' OR name ILIKE '%'||$1||'%')
        AND ($2 = '' OR switchboard = $2)
        AND ($3 = '' OR building_code = $3)
        AND ($4 = '' OR floor = $4)
        AND ($5 = '' OR site = $5)
      ORDER BY ${s} ${d}
      LIMIT ${limit} OFFSET ${offset}
      `,
      [q, switchboard, building, floor, site, site]
    );

    const { rows: totalRows } = await pool.query(
      `
      SELECT count(*)::int AS total
      FROM device_pairs
      WHERE ($1 = '' OR name ILIKE '%'||$1||'%')
        AND ($2 = '' OR switchboard = $2)
        AND ($3 = '' OR building_code = $3)
        AND ($4 = '' OR floor = $4)
        AND ($5 = '' OR site = $5)
      `,
      [q, switchboard, building, floor, site, site]
    );

    res.json({ pairs: rows, total: totalRows[0]?.total || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'pairs_list_failed' });
  }
});

// Récupération d’un device par id (simplifiée)
async function getDeviceById(id) {
  const { rows } = await pool.query(`SELECT * FROM devices WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Check sélectivité entre 2 équipements
app.post('/api/selectivity/check', async (req, res) => {
  try {
    const { upstream_id, downstream_id } = req.body || {};
    if (!upstream_id || !downstream_id) return res.status(400).json({ error: 'missing_ids' });

    const [up, down] = await Promise.all([getDeviceById(upstream_id), getDeviceById(downstream_id)]);
    if (!up || !down) return res.status(404).json({ error: 'device_not_found' });

    const upPts = buildCurve(up);
    const downPts = buildCurve(down);

    const zones = findNonSelectiveZones(upPts, downPts);
    const ok = zones.length === 0;

    // Audit (best-effort)
    const site = (await pool.query(`SELECT site FROM devices WHERE id = $1`, [upstream_id])).rows[0]?.site || null;
    pool.query(
      `INSERT INTO selectivity_checks (site, upstream_id, downstream_id, ok, non_selective_zones)
       VALUES ($1,$2,$3,$4,$5)`,
      [site, upstream_id, downstream_id, ok, JSON.stringify(zones)]
    ).catch(() => {});

    res.json({
      ok,
      nonSelectiveZones: zones,
      upstream: { id: up.id, name: up.name, points: upPts },
      downstream: { id: down.id, name: down.name, points: downPts },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'check_failed' });
  }
});

/* ----------------------- AI Tip (rate-limited) ------------------- */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 req/min par IP
  keyGenerator: (req) => {
    const site = siteOf(req) || '';
    const ip = req.ip || req.headers['x-forwarded-for'] || '';
    return crypto.createHash('sha1').update(String(site) + '|' + String(ip)).digest('hex');
  },
});

app.post('/api/selectivity/ai-tip', limiter, async (req, res) => {
  // Remplace par ton moteur IA favori si besoin — placeholder sans external call
  try {
    const { query } = req.body || {};
    const tip = `Pour améliorer la sélectivité, augmente légèrement le temps de déclenchement en amont (LT/STD)
et vérifie la zone autour de Ir*In et Isd*Ir*In. Marge actuelle ${(SELECTIVITY_MARGIN * 100).toFixed(1)}%.`;
    res.json({ tip, for: query || null });
  } catch {
    res.status(500).json({ error: 'ai_tip_failed' });
  }
});

/* ----------------------- Boot ----------------------------------- */
const port = Number(process.env.SELECTIVITY_PORT || 3004);
app.listen(port, () => console.log(`Selectivity service running on :${port}`));
