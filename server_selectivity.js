// server_selectivity.js
// Express + Postgres + (optionnel) OpenAI
// Correctifs inclus : CORS en whitelist, vérification parentage up/down,
// datasets {x,y} servis au front, marge configurable, échantillonnage densifié.

import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import cors from 'cors';
import OpenAI from 'openai';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  // ssl: { rejectUnauthorized: false } // active si nécessaire pour Neon
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(helmet({
  contentSecurityPolicy: false,
}));

/* ---------- CORS (whitelist + credentials sûrs) ---------- */
const ORIGIN_WHITELIST = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    // autoriser outils locaux sans origin (curl, Postman)
    if (!origin) return cb(null, true);
    if (ORIGIN_WHITELIST.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Site'],
}));

/* ---------- OpenAI (optionnel) ---------- */
let openai = null;
let openaiError = null;
if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (e) {
    openaiError = e?.message || String(e);
  }
}

/* ---------- Helpers ---------- */
function siteOf(req) {
  // IMPORTANT : en prod, mapper le site depuis l’auth et non le client
  return (req.header('X-Site') || req.query.site || '').toString();
}

const WHITELIST_SORT = ['name', 'building_code', 'floor']; // colonnes existantes côté switchboards
function sortSafe(sort) { return WHITELIST_SORT.includes(String(sort)) ? sort : 'name'; }
function dirSafe(dir) { return String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'; }

const MARGIN_PCT = Number(process.env.MARGIN_PCT || 0.10); // 10% par défaut (au lieu de 5%)
const MAX_PAGE_SIZE = 100;

/* ---------- Schéma : selectivity_checks ---------- */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS selectivity_checks (
      site TEXT NOT NULL,
      upstream_id INTEGER NOT NULL,
      downstream_id INTEGER NOT NULL,
      non_selective BOOLEAN NOT NULL,
      margin_pct REAL NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site, upstream_id, downstream_id)
    );
  `);
  // Index utiles si volumétrie
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_selectivity_checks_site ON selectivity_checks(site);`);
}
ensureSchema().catch(console.error);

/* ---------- Modèle de courbes (simplifié) ---------- */
/**
 * Device attendu (colonnes principales) :
 * id, site, name, parent_id, switchboard_id,
 * in_amps (In), ir (mult In pour LT), tr (s), isd (mult Ir pour STD), tsd (s),
 * ii (mult Ir pour INST), icu_ka (Icu en kA)
 */
function calculateTripTime(device, I) {
  // Approx indicatives : LT (I²t), STD (temporisée), INST (quasi instant)
  const In = device.in_amps || 100;
  const Ir = (device.ir || 1.0) * In;
  const Tr = Math.max(0, device.tr ?? 0.2); // s
  const Isd = (device.isd || 8) * Ir;       // seuil STD
  const Tsd = Math.max(0, device.tsd ?? 0.15);
  const Ii  = (device.ii  || 12) * Ir;      // seuil INST

  if (I < Ir) return Infinity; // pas de déclenchement en dessous de LT
  if (I >= Ii) return 0.03;    // instantané ~30ms
  if (I >= Isd) return Tsd;    // short delay
  // Long time (I²t) – éviter division par zéro aux abords de Ir
  const denom = (I / Ir) ** 2 - 1;
  if (denom <= 1e-6) return 1000;
  return Math.min(1000, Tr / denom);
}

function around(value, pct = 0.2, n = 3) {
  // points autour d’un seuil : ±pct
  const out = [];
  for (let k = -n; k <= n; k++) {
    const f = 1 + (k / n) * pct;
    out.push(value * f);
  }
  return out;
}

function generateCurvePoints(device) {
  const points = [];
  const In = device.in_amps || 100;
  const Imin = Math.max(0.1 * In, 1);
  const Imax = Math.max((device.icu_ka || 50) * 1000, 10 * In);

  // grille logarithmique globale
  for (let logI = Math.log10(Imin); logI <= Math.log10(Imax); logI += 0.05) {
    const I = 10 ** logI;
    let t = calculateTripTime(device, I);
    if (!isFinite(t)) t = 1000;
    if (t >= 0) points.push({ x: I, y: t });
  }

  // densifier autour des seuils
  const Ir = (device.ir || 1.0) * In;
  const Isd = (device.isd || 8) * Ir;
  const Ii  = (device.ii  || 12) * Ir;

  [Ir, Isd, Ii].forEach(S => {
    if (!S || !isFinite(S)) return;
    around(S, 0.25, 4).forEach(I => {
      if (I < Imin || I > Imax) return;
      let t = calculateTripTime(device, I);
      if (!isFinite(t)) t = 1000;
      points.push({ x: I, y: t });
    });
  });

  // trier par X croissant puis dédoublonner grossièrement
  points.sort((a, b) => a.x - b.x);
  const dedup = [];
  let prevX = -Infinity;
  for (const p of points) {
    if (Math.abs(Math.log10(p.x) - Math.log10(prevX)) > 1e-3) {
      dedup.push(p);
      prevX = p.x;
    }
  }
  return dedup;
}

// simple interpolation linéaire en log-x sur deux courbes
function interpolateYAtX(points, x) {
  // points: [{x,y}] triés
  if (!points.length) return Infinity;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;

  // recherche binaire
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid; else hi = mid;
  }
  const p1 = points[lo], p2 = points[hi];
  const t = (Math.log(x) - Math.log(p1.x)) / (Math.log(p2.x) - Math.log(p1.x));
  return p1.y + t * (p2.y - p1.y);
}

function computeNonSelectiveZones(upPts, downPts, margin = MARGIN_PCT) {
  // renvoie segments [xMin,xMax] où t_down < (1+margin)*t_up
  const zones = [];
  const xs = [...upPts.map(p => p.x), ...downPts.map(p => p.x)].sort((a, b) => a - b);
  if (!xs.length) return zones;

  let inZone = false;
  let start = null;

  for (const x of xs) {
    const tu = interpolateYAtX(upPts, x);
    const td = interpolateYAtX(downPts, x);
    const bad = td < (1 + margin) * tu;
    if (bad && !inZone) { inZone = true; start = x; }
    if (!bad && inZone) { inZone = false; zones.push({ xMin: start, xMax: x }); start = null; }
  }
  if (inZone && start != null) {
    zones.push({ xMin: start, xMax: xs[xs.length - 1] });
  }
  return zones;
}

/* ---------- Endpoints ---------- */

// Liste de couples possibles (downstream ayant un parent)
app.get('/pairs', async (req, res) => {
  const site = siteOf(req);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  const sort = sortSafe(req.query.sort);
  const dir = dirSafe(req.query.dir);

  try {
    const params = [site];
    const baseFrom = `
      FROM devices d
      JOIN devices u ON u.id = d.parent_id AND u.site = d.site
      LEFT JOIN switchboards s ON s.id = d.switchboard_id
      WHERE d.site = $1
    `;

    const countSql = `SELECT COUNT(*) ${baseFrom}`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = Number(countRows[0].count || 0);

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT
        d.id AS down_id, d.name AS down_name, d.in_amps AS down_in,
        u.id AS up_id,   u.name AS up_name,   u.in_amps AS up_in,
        s.name AS switchboard, s.building_code, s.floor
      ${baseFrom}
      ORDER BY s.${sort} ${dir} NULLS LAST, d.id ASC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await pool.query(listSql, [site, pageSize, offset]);

    res.json({ total, page, pageSize, sort, dir, rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'pairs_failed', details: e?.message });
  }
});

// Calcul + sauvegarde du statut de sélectivité pour un couple
app.post('/check', async (req, res) => {
  const site = siteOf(req);
  const { upstream_id, downstream_id, margin_pct } = req.body || {};
  const margin = isFinite(margin_pct) ? Number(margin_pct) : MARGIN_PCT;

  if (!site || !upstream_id || !downstream_id) {
    return res.status(400).json({ error: 'missing_params' });
  }

  try {
    // Charger les deux appareils
    const { rows: devs } = await pool.query(
      `SELECT * FROM devices WHERE site = $1 AND id IN ($2,$3)`,
      [site, upstream_id, downstream_id]
    );
    if (devs.length !== 2) return res.status(404).json({ error: 'devices_not_found' });
    const up = devs.find(d => d.id === Number(upstream_id));
    const down = devs.find(d => d.id === Number(downstream_id));

    if (!up || !down) return res.status(404).json({ error: 'devices_not_found' });

    // Vérifier le parentage : downstream.parent_id = upstream.id
    if (down.parent_id !== up.id) {
      return res.status(400).json({ error: 'invalid_relation', message: 'downstream is not a child of upstream' });
    }

    const upPts = generateCurvePoints(up);
    const downPts = generateCurvePoints(down);
    const zones = computeNonSelectiveZones(upPts, downPts, margin);
    const nonSelective = zones.length > 0;

    // upsert du résultat
    await pool.query(`
      INSERT INTO selectivity_checks (site, upstream_id, downstream_id, non_selective, margin_pct)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (site, upstream_id, downstream_id)
      DO UPDATE SET non_selective = EXCLUDED.non_selective,
                    margin_pct = EXCLUDED.margin_pct,
                    checked_at = now()
    `, [site, up.id, down.id, nonSelective, margin]);

    res.json({
      site,
      upstream_id: up.id,
      downstream_id: down.id,
      margin_pct: margin,
      non_selective: nonSelective,
      nonSelectiveZones: zones,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'check_failed', details: e?.message });
  }
});

// Renvoie courbes {x,y} pour affichage (log-x côté front) + zones calculées
app.get('/curves', async (req, res) => {
  const site = siteOf(req);
  const upId = Number(req.query.upstream_id);
  const downId = Number(req.query.downstream_id);
  const margin = isFinite(req.query.margin_pct) ? Number(req.query.margin_pct) : MARGIN_PCT;

  if (!site || !upId || !downId) return res.status(400).json({ error: 'missing_params' });

  try {
    const { rows: devs } = await pool.query(
      `SELECT * FROM devices WHERE site = $1 AND id IN ($2,$3)`,
      [site, upId, downId]
    );
    if (devs.length !== 2) return res.status(404).json({ error: 'devices_not_found' });

    const up = devs.find(d => d.id === upId);
    const down = devs.find(d => d.id === downId);

    const upstream = generateCurvePoints(up);
    const downstream = generateCurvePoints(down);
    const zones = computeNonSelectiveZones(upstream, downstream, margin);

    res.json({
      site,
      upstream_id: up.id,
      downstream_id: down.id,
      margin_pct: margin,
      upstream,
      downstream,
      nonSelectiveZones: zones,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'curves_failed', details: e?.message });
  }
});

// Astuce IA (optionnel) – throttler côté reverse proxy recommandé
app.post('/ai-tip', async (req, res) => {
  if (!openai) {
    return res.status(503).json({ error: 'ai_unavailable', details: openaiError || 'Missing OPENAI_API_KEY' });
  }
  try {
    const { context } = req.body || {};
    const prompt = `
Tu es un expert coordination/sélectivité BT. Contexte JSON:
${JSON.stringify(context ?? {}, null, 2)}

Donne 2 à 3 conseils concrets et actionnables (ajustements de réglages, ZSI si pertinent, alternatives d’appareillage).
    `.trim();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 220,
    });

    const text = completion.choices?.[0]?.message?.content || '';
    res.json({ tips: text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'ai_failed', details: e?.message });
  }
});

/* ---------- Démarrage ---------- */
const port = process.env.SELECTIVITY_PORT || 3004;
app.listen(port, () => console.log(`Selectivity service running on :${port}`));
