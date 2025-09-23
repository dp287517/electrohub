/**
 * server_selectivity.js
 * Lightweight Express router you can mount under /api/selectivity
 *
 * Assumptions (adapt as needed):
 *  - You have a Postgres pool exposed as `pool` OR you can swap by passing your own `db` adapter.
 *  - Your "devices" table contains at least:
 *      id (pk), switchboard_id, upstream_switchboard_id (nullable),
 *      name, brand, reference, rated_current_in (A), curve (B/C/D or MCCB/ACB),
 *      instantaneous_pickup_ii (A), long_time_ir (A), short_time_isd (A), short_time_delay_ts (s),
 *      icu_ka, ics_ka, poles, voltage_v
 *  - Your "switchboards" table has: id, name, upstream_switchboard_id (nullable)
 *
 * Endpoints:
 *  GET /api/selectivity/pairs?switchboard_id=
 *    -> returns all upstream/downstream device pairs discovered from topology
 *
 *  POST /api/selectivity/check
 *    body: { upstream_id, downstream_id }
 *    -> returns computed selectivity result, missing fields, chart points
 *
 *  POST /api/selectivity/scan
 *    body: { switchboard_id }
 *    -> returns a table of remediation actions for all device pairs on that board
 *
 * Notes:
 *  The math is an approximation based on IEC concepts (60947-2 for MCCB/ACB, 60898-1 for MCB).
 *  For authoritative results, use manufacturer pairwise selectivity tables.
 */

import express from "express";

export function buildSelectivityRouter(deps = {}) {
  const router = express.Router();
  const pool = deps.pool; // required for SQL endpoints, else in-memory fallback

  // ---------- Helpers -------------------------------------------------------
  function need(v) { return v !== undefined && v !== null && v !== "" && !Number.isNaN(v); }
  function toNum(v) { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : undefined; }

  // Time-current curve approximations on log-log axes for 2–3 segments
  // Returns array of {i, t} points (A, s) suitable for plotting
  function makeTCC(dev) {
    const In = toNum(dev.rated_current_in);
    if (!need(In)) return null;

    const curve = (dev.curve || "").toUpperCase(); // "B","C","D","MCCB","ACB"
    const Ir = toNum(dev.long_time_ir) || In;       // A
    const ts = toNum(dev.short_time_delay_ts) || 0.15; // s default 150 ms
    const Isd = toNum(dev.short_time_isd) || 6 * In;   // A (MCCB short-time multiple ≈ 4–10 In)
    const Ii = toNum(dev.instantaneous_pickup_ii);     // A

    // IEC 60898-1 ranges for MCB instantaneous
    let instMinMult = 5, instMaxMult = 10;
    if (curve === "B") { instMinMult = 3; instMaxMult = 5; }
    else if (curve === "C") { instMinMult = 5; instMaxMult = 10; }
    else if (curve === "D") { instMinMult = 10; instMaxMult = 20; }

    const IiEff = Ii || instMinMult * In;

    // Build points: overload knee (~1.5–6 In), short-time plateau (ts @ Isd), instantaneous drop
    const pts = [];
    // Overload inverse-time segment
    pts.push({ i: 1.05 * Ir, t: 100 });  // long-time region (very slow)
    pts.push({ i: 1.5 * Ir, t: 10 });
    pts.push({ i: 6 * Ir, t: 1.5 });     // typical thermal limit vicinity

    // Short-time delay plateau (if MCCB/ACB)
    pts.push({ i: Isd, t: Math.max(0.1, ts) });

    // Instantaneous region: trip very fast at IiEff
    pts.push({ i: IiEff, t: 0.02 });
    pts.push({ i: Math.max(IiEff * 1.2, Isd * 1.2), t: 0.005 });

    return pts;
  }

  // Determine selectivity qualitatively between two devices using simple overlap checks
  // Returns {verdict, limit_kA, reasons[], missing[], hints[]}
  function checkPair(up, dn, faultKA) {
    const missing = [];
    const reasons = [];
    const hints = [];

    const InUp = toNum(up.rated_current_in);
    const InDn = toNum(dn.rated_current_in);
    if (!need(InUp)) missing.push("upstream.rated_current_in");
    if (!need(InDn)) missing.push("downstream.rated_current_in");

    const IiUp = toNum(up.instantaneous_pickup_ii);
    const IiDn = toNum(dn.instantaneous_pickup_ii);

    const curveUp = (up.curve || "").toUpperCase();
    const curveDn = (dn.curve || "").toUpperCase();

    // Build curves (rough) and check overlap in time for same current samples
    const cu = makeTCC(up);
    const cd = makeTCC(dn);
    if (!cu) missing.push("upstream.tcc");
    if (!cd) missing.push("downstream.tcc");

    if (missing.length) {
      return { verdict: "UNKNOWN", limit_kA: null, reasons, missing, hints };
    }

    // Sample a set of logarithmic currents from 1*InDn to 20*InDn
    const Imin = Math.max(1.1 * InDn, 0.5 * (InUp || InDn));
    const Imax = 20 * InDn;
    const samples = [];
    for (let k = 0; k < 20; k++) {
      const f = k / 19;
      const i = Imin * Math.pow(Imax / Imin, f);
      samples.push(i);
    }

    // Helper: time by linear interpolation on piecewise segments
    function tAt(c, i) {
      // find segment that brackets i (by i)
      for (let s = 0; s < c.length - 1; s++) {
        const a = c[s], b = c[s + 1];
        if ((i >= a.i && i <= b.i) || (i >= b.i && i <= a.i)) {
          // log-log interpolation
          const li = Math.log(i), la = Math.log(a.i), lb = Math.log(b.i);
          const lt = Math.log(a.t) + (Math.log(b.t) - Math.log(a.t)) * (li - la) / (lb - la);
          return Math.exp(lt);
        }
      }
      // outside range: extrapolate with nearest
      return c[c.length - 1].t;
    }

    // Evaluate overlap: selectivity if t_dn < t_up at most currents up to fault level
    let okCount = 0, total = 0;
    for (const i of samples) {
      const tUp = tAt(cu, i);
      const tDn = tAt(cd, i);
      if (tDn < tUp * 0.8) okCount++; // require decent time separation
      total++;
    }
    const ratio = okCount / total;

    // Estimate selectivity limit current as min overlap crossing ≈ min(I where t_dn >= t_up)
    let limitA = null;
    for (const i of samples) {
      const tUp = tAt(cu, i);
      const tDn = tAt(cd, i);
      if (tDn >= tUp) { limitA = i; break; }
    }
    const limit_kA = limitA ? limitA / 1000 : null;

    // Basic heuristics combining IEC ideas:
    // - Upstream must have higher instantaneous threshold than downstream
    if (need(IiUp) && need(IiDn) && IiUp <= IiDn) {
      reasons.push("Upstream instantaneous pickup should exceed downstream.");
    }

    let verdict = "PARTIAL";
    if (ratio > 0.9) verdict = "TOTAL";
    if (ratio < 0.5) verdict = "POOR";

    if (faultKA && limit_kA && faultKA > limit_kA) {
      reasons.push(`Prospective Isc (${faultKA.toFixed(2)} kA) exceeds estimated selectivity limit (${limit_kA.toFixed(2)} kA).`);
      verdict = "NOT SELECTIVE";
    }

    if (!need(IiUp)) hints.push("Enter upstream instantaneous pickup (Ii) to refine short-circuit selectivity.");
    if (!need(IiDn)) hints.push("Enter downstream instantaneous pickup (Ii) to refine short-circuit selectivity.");
    if (!need(up.short_time_delay_ts)) hints.push("Set upstream short-time delay (ts) if device is category B (IEC 60947-2).");

    return { verdict, limit_kA, reasons, missing, hints };
  }

  // ---------- SQL helpers (adapt fields to your DB) -------------------------
  async function loadBoardDevices(switchboardId) {
    if (!pool) return []; // no DB
    const q = `
      SELECT d.*,
             sb.upstream_switchboard_id AS board_upstream_id
      FROM devices d
      JOIN switchboards sb ON sb.id = d.switchboard_id
      WHERE d.switchboard_id = $1
      ORDER BY d.id ASC
    `;
    const { rows } = await pool.query(q, [switchboardId]);
    return rows;
  }

  // Build naive upstream/downstream pairs based on same board or upstream board link
  function makePairs(devs) {
    const pairs = [];
    // Same-board pairs: any device upstream main vs downstream feeders — heuristic: higher In considered upstream
    const sorted = [...devs].sort((a,b)=> (parseFloat(b.rated_current_in||0) - parseFloat(a.rated_current_in||0)));
    for (let i=0;i<sorted.length;i++) {
      for (let j=i+1;j<sorted.length;j++) {
        pairs.push({ upstream: sorted[i], downstream: sorted[j], relation: "same_board_heuristic" });
      }
    }
    return pairs;
  }

  // ---------- Routes --------------------------------------------------------
  router.get("/pairs", async (req, res) => {
    try {
      const switchboardId = req.query.switchboard_id;
      if (!switchboardId) return res.status(400).json({ error: "switchboard_id required" });
      const devs = await loadBoardDevices(switchboardId);
      const pairs = makePairs(devs).map(p => ({
        upstream_id: p.upstream.id,
        downstream_id: p.downstream.id,
        upstream_name: p.upstream.name,
        downstream_name: p.downstream.name,
        relation: p.relation
      }));
      return res.json({ pairs });
    } catch (e) {
      console.error("[SELECTIVITY /pairs] error:", e);
      res.status(500).json({ error: "pairs_failed" });
    }
  });

  router.post("/check", express.json(), async (req, res) => {
    try {
      const { upstream_id, downstream_id, prospective_short_circuit_kA } = req.body || {};
      if (!pool) return res.status(501).json({ error: "db_not_configured" });
      const { rows } = await pool.query(`SELECT * FROM devices WHERE id = ANY($1)`, [[upstream_id, downstream_id]]);
      const up = rows.find(r=>r.id===upstream_id);
      const dn = rows.find(r=>r.id===downstream_id);
      if (!up || !dn) return res.status(404).json({ error: "device_not_found" });
      const faultKA = prospective_short_circuit_kA ? parseFloat(prospective_short_circuit_kA) : undefined;
      const resu = checkPair(up, dn, faultKA);
      const cu = makeTCC(up);
      const cd = makeTCC(dn);
      return res.json({ upstream: {id: up.id, name: up.name}, downstream: {id: dn.id, name: dn.name}, result: resu, curves: {upstream: cu, downstream: cd} });
    } catch (e) {
      console.error("[SELECTIVITY /check] error:", e);
      res.status(500).json({ error: "check_failed" });
    }
  });

  router.post("/scan", express.json(), async (req, res) => {
    try {
      const { switchboard_id, prospective_short_circuit_kA } = req.body || {};
      if (!switchboard_id) return res.status(400).json({ error: "switchboard_id required" });
      const devs = await loadBoardDevices(switchboard_id);
      const pairs = makePairs(devs);
      const table = pairs.map(p => {
        const r = checkPair(p.upstream, p.downstream, prospective_short_circuit_kA ? parseFloat(prospective_short_circuit_kA) : undefined);
        return {
          upstream_id: p.upstream.id, upstream_name: p.upstream.name,
          downstream_id: p.downstream.id, downstream_name: p.downstream.name,
          verdict: r.verdict, limit_kA: r.limit_kA,
          remediation: remediationHint(r, p.upstream, p.downstream)
        };
      });
      res.json({ rows: table });
    } catch (e) {
      console.error("[SELECTIVITY /scan] error:", e);
      res.status(500).json({ error: "scan_failed" });
    }
  });

  function remediationHint(r, up, dn) {
    const tips = [];
    if (r.verdict === "TOTAL") return "OK – No action.";
    if (r.missing?.length) return "Missing data: " + r.missing.join(", ");
    if (r.reasons?.length) tips.push(...r.reasons);
    // generic suggestions
    tips.push("Increase upstream instantaneous pickup (Ii) or enable short-time delay (category B) to create time separation.");
    tips.push("Use manufacturer selectivity tables (pairwise) to confirm/select alternate breaker combo.");
    return tips.join(" ");
  }

  return router;
}

// If you want to run as a stand-alone service for quick tests:
if (process.env.SELECTIVITY_STANDALONE === "1") {
  const express = (await import("express")).default;
  const { Pool } = await import("pg");
  const app = express();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  app.use("/api/selectivity", buildSelectivityRouter({ pool }));
  const port = process.env.SELECTIVITY_PORT || 3004;
  app.listen(port, () => console.log("[selectivity] ready on :" + port));
}
