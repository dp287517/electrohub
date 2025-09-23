// server_selectivity.js
import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import pg from 'pg';
import cors from 'cors';

dotenv.config();
const { Pool } = pg;
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json());

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// -- util: site depuis l'en-tête ajouté par ton client (voir lib/api.js)
function siteOf(req) {
  return req.get('X-Site') || req.query.site || null;
}

// -- util: conversion/lectures sûres
const num = (v) => (v === null || v === undefined ? null : Number(v));
const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

// -- seuils typiques MCB
const MCB_INSTANT = { B: 4, C: 8, D: 13 };

// -- calcule les seuils utiles pour un appareil
function thresholds(dev) {
  const In = num(dev.in_amps) || null;
  const settings = dev.settings || {};
  const curve = (settings.curve_type || dev.trip_unit || '').toUpperCase();

  let multInst = null;
  if (settings.ii) multInst = Number(settings.ii);
  else if (settings.isd) multInst = Number(settings.isd);
  else if (curve in MCB_INSTANT) multInst = MCB_INSTANT[curve];

  const Iinst = In && multInst ? multInst * In : null;

  const isd = settings.isd ? Number(settings.isd) : null;
  const tsd = settings.tsd ? Number(settings.tsd) : null;

  return { In, Iinst, isd, tsd, curve };
}

function verdict(up, down) {
  const upT = thresholds(up);
  const dnT = thresholds(down);
  const missing = [];

  if (!dnT.In) missing.push(`In (downstream #${down.id})`);
  if (!upT.In) missing.push(`In (upstream #${up.id})`);
  if (!dnT.Iinst) missing.push(`Iinst / courbe (downstream #${down.id})`);
  if (!upT.Iinst && !upT.isd) missing.push(`Iinst/ISD (upstream #${up.id})`);

  let status = 'OK';
  let reason = 'Likely selective';
  if (missing.length) {
    status = 'Missing data';
    reason = missing.join(', ');
  } else {
    const guard = 1.25; // marge simple
    const okInst = upT.Iinst && dnT.Iinst && upT.Iinst >= guard * dnT.Iinst;
    const okSd = upT.isd && upT.tsd && upT.tsd > 0 && (upT.isd * upT.In) >= guard * dnT.Iinst;

    if (okInst || okSd) {
      status = okInst ? 'OK (inst)' : 'OK (short-time)';
      reason = okInst ? 'Upstream instantaneous above downstream' : 'Short-time delay provides selectivity';
    } else {
      status = 'Conflict';
      reason = 'Instantaneous/short-time overlap';
    }
  }

  return { status, reason, upT, dnT, missing };
}

// ------ API ------

// 1) bootstrap: listes pour l’UI (tableaux + appareils)
app.get('/api/selectivity/bootstrap', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const boards = await pool.query(
      `SELECT id, name, code, building_code, floor, room 
       FROM switchboards WHERE site=$1 ORDER BY created_at DESC LIMIT 200`,
      [site]
    );

    const devices = await pool.query(
      `SELECT id, switchboard_id, parent_id, downstream_switchboard_id, device_type, manufacturer, reference,
              in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings, name
       FROM devices WHERE site=$1 ORDER BY created_at ASC`,
      [site]
    );

    res.json({ boards: boards.rows, devices: devices.rows });
  } catch (e) {
    console.error('[SELECTIVITY bootstrap]', e);
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

// 2) scan: calcule les paires et verdicts
app.get('/api/selectivity/scan', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const boardId = req.query.switchboard_id ? Number(req.query.switchboard_id) : null;
    const isc = req.query.isc_ka ? Number(req.query.isc_ka) : null;

    // charge appareils du tableau (ou de tout le site si board non fourni — limité)
    const devSql = boardId
      ? `SELECT * FROM devices WHERE site=$1 AND switchboard_id=$2 ORDER BY is_main_incoming DESC, created_at ASC`
      : `SELECT * FROM devices WHERE site=$1 ORDER BY is_main_incoming DESC, created_at ASC LIMIT 2000`;
    const vals = boardId ? [site, boardId] : [site];
    const { rows: devs } = await pool.query(devSql, vals);

    const byId = new Map(devs.map(d => [d.id, d]));

    // paires amont/aval par parent_id (dans un même tableau)
    const pairs = [];
    for (const d of devs) {
      if (d.parent_id && byId.has(d.parent_id)) {
        const up = byId.get(d.parent_id);
        const dn = d;

        // check Icu/Ics vs Isc si fourni
        const issues = [];
        if (isc !== null) {
          if (dn.ics_ka && Number(dn.ics_ka) < isc) issues.push(`Downstream Ics ${dn.ics_ka}kA < Isc ${isc}kA`);
          if (dn.icu_ka && Number(dn.icu_ka) < isc) issues.push(`Downstream Icu ${dn.icu_ka}kA < Isc ${isc}kA`);
          if (up.ics_ka && Number(up.ics_ka) < isc) issues.push(`Upstream Ics ${up.ics_ka}kA < Isc ${isc}kA`);
        }

        const v = verdict(up, dn);
        if (issues.length) {
          v.status = v.status === 'OK' ? 'Non-compliant' : v.status;
          v.reason = [v.reason, ...issues].join(' — ');
        }

        pairs.push({
          upstream: { id: up.id, name: up.name, ref: up.reference, mfr: up.manufacturer, in_amps: up.in_amps, trip_unit: up.trip_unit, settings: up.settings },
          downstream: { id: dn.id, name: dn.name, ref: dn.reference, mfr: dn.manufacturer, in_amps: dn.in_amps, trip_unit: dn.trip_unit, settings: dn.settings },
          verdict: v.status,
          reason: v.reason,
          missing: v.missing,
          suggestions: v.status.startsWith('OK') ? [] : [
            'Augmenter le seuil instantané amont ou activer un délai court (si possible)',
            'Réduire le seuil instantané aval (si sécurité/charge le permet)',
            'Envisager ZSI (zone selective interlocking) si équipements compatibles'
          ]
        });
      }
    }

    res.json({ board_id: boardId, isc_ka: isc, count: pairs.length, pairs });
  } catch (e) {
    console.error('[SELECTIVITY scan]', e);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// 3) courbes simplifiées (pour le bouton Graph)
app.get('/api/selectivity/curves', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

    const upId = Number(req.query.up_id);
    const dnId = Number(req.query.down_id);
    if (!upId || !dnId) return res.status(400).json({ error: 'Need up_id & down_id' });

    const q = await pool.query(`SELECT * FROM devices WHERE site=$1 AND id IN ($2,$3)`, [site, upId, dnId]);
    const up = q.rows.find(r => r.id === upId);
    const dn = q.rows.find(r => r.id === dnId);
    if (!up || !dn) return res.status(404).json({ error: 'Devices not found' });

    const upT = thresholds(up);
    const dnT = thresholds(dn);

    // très simple esquisse de TCC (log-log) : trois points par appareil
    function tcc(t) {
      const In = t.In || 100;
      const I1 = In;
      const I2 = t.isd ? t.isd * In : (t.Iinst || 10 * In) * 0.8;
      const I3 = t.Iinst || (t.isd ? t.isd * In * 1.2 : 12 * In);
      return [
        { I: I1, t: (t.tr || 10) },             // long-time (placeholder)
        { I: I2, t: (t.tsd || 0.2) },           // short-time
        { I: I3, t: 0.02 }                      // instantané
      ];
    }

    res.json({
      upstream: { id: up.id, curve: tcc(upT) },
      downstream: { id: dn.id, curve: tcc(dnT) }
    });
  } catch (e) {
    console.error('[SELECTIVITY curves]', e);
    res.status(500).json({ error: 'Curves failed' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
const port = process.env.SELECTIVITY_PORT || 3004;
app.listen(port, () => console.log(`Selectivity service listening on :${port}`));
