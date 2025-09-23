/**
 * server_selectivity.js — compatible avec ton schéma Neon "devices"
 * Colonnes utilisées: id, switchboard_id, parent_id, device_type, manufacturer, reference,
 * in_amps (In), icu_ka, ics_ka, poles, voltage_v, trip_unit, settings (JSON: Ii, Isd, ts, curve).
 */
import express from "express";

export function buildSelectivityRouter(deps = {}) {
  const router = express.Router();
  const pool = deps.pool;

  const need = (v) => v !== undefined && v !== null && v !== "" && !Number.isNaN(v);
  const toNum = (v) => {
    const n = typeof v === "string" ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : undefined;
  };

  function curveFromTripUnit(dev) {
    // Try explicit curve in settings; else infer from trip_unit (B/C/D/MCCB/ACB)
    const s = dev.settings || {};
    if (s.curve) return String(s.curve).toUpperCase();
    const tu = (dev.trip_unit || "").toUpperCase();
    if (["B","C","D"].includes(tu)) return tu;
    if (tu.includes("ACB")) return "ACB";
    if (tu.includes("MCCB")) return "MCCB";
    return "C"; // default
  }

  function pickSettings(dev) {
    const s = dev.settings || {};
    return {
      Ii: toNum(s.Ii),            // instantaneous pickup (A), if provided
      Isd: toNum(s.Isd),          // short-time pickup (A)
      ts: toNum(s.ts),            // short-time delay (s)
    };
  }

  function makeTCC(dev) {
    const In = toNum(dev.in_amps);
    if (!need(In)) return null;

    const curve = curveFromTripUnit(dev);
    const { Ii, Isd, ts } = pickSettings(dev);

    const Ir = In; // long-time set approx
    let instMinMult = 5, instMaxMult = 10;
    if (curve === "B") { instMinMult = 3; instMaxMult = 5; }
    else if (curve === "C") { instMinMult = 5; instMaxMult = 10; }
    else if (curve === "D") { instMinMult = 10; instMaxMult = 20; }

    const IiEff = Ii || instMinMult * In;
    const IsdEff = Isd || 6 * In;
    const tsEff = need(ts) ? ts : 0.15;

    const pts = [];
    pts.push({ i: 1.05 * Ir, t: 100 });
    pts.push({ i: 1.5 * Ir, t: 10 });
    pts.push({ i: 6 * Ir, t: 1.5 });
    pts.push({ i: IsdEff, t: Math.max(0.1, tsEff) });
    pts.push({ i: IiEff, t: 0.02 });
    pts.push({ i: Math.max(IiEff * 1.2, IsdEff * 1.2), t: 0.005 });
    return pts;
  }

  function checkPair(up, dn, faultKA) {
    const missing = [];
    const reasons = [];
    const hints = [];

    const InUp = toNum(up.in_amps);
    const InDn = toNum(dn.in_amps);
    if (!need(InUp)) missing.push("upstream.in_amps");
    if (!need(InDn)) missing.push("downstream.in_amps");

    const sUp = pickSettings(up), sDn = pickSettings(dn);
    const IiUp = sUp.Ii, IiDn = sDn.Ii;

    const cu = makeTCC(up);
    const cd = makeTCC(dn);
    if (!cu) missing.push("upstream.tcc");
    if (!cd) missing.push("downstream.tcc");
    if (missing.length) return { verdict: "UNKNOWN", limit_kA: null, reasons, missing, hints };

    const Imin = Math.max(1.1 * InDn, 0.5 * (InUp || InDn));
    const Imax = 20 * InDn;
    const samples = [];
    for (let k = 0; k < 20; k++) {
      const f = k / 19;
      const i = Imin * Math.pow(Imax / Imin, f);
      samples.push(i);
    }

    function tAt(c, i) {
      for (let s = 0; s < c.length - 1; s++) {
        const a = c[s], b = c[s + 1];
        if ((i >= a.i && i <= b.i) || (i >= b.i && i <= a.i)) {
          const li = Math.log(i), la = Math.log(a.i), lb = Math.log(b.i);
          const lt = Math.log(a.t) + (Math.log(b.t) - Math.log(a.t)) * (li - la) / (lb - la);
          return Math.exp(lt);
        }
      }
      return c[c.length - 1].t;
    }

    let okCount = 0, total = 0;
    for (const i of samples) {
      const tUp = tAt(cu, i);
      const tDn = tAt(cd, i);
      if (tDn < tUp * 0.8) okCount++;
      total++;
    }
    const ratio = okCount / total;

    let limitA = null;
    for (const i of samples) {
      const tUp = tAt(cu, i);
      const tDn = tAt(cd, i);
      if (tDn >= tUp) { limitA = i; break; }
    }
    const limit_kA = limitA ? limitA / 1000 : null;

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

    if (!need(IiUp)) hints.push("Set upstream instantaneous pickup (Ii) in device settings.");
    if (!need(IiDn)) hints.push("Set downstream instantaneous pickup (Ii) in device settings.");

    return { verdict, limit_kA, reasons, missing, hints };
  }

  async function loadBoardDevices(switchboardId) {
    if (!pool) return [];
    const q = `
      SELECT id, switchboard_id, parent_id, device_type, manufacturer, reference,
             in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings, name
      FROM devices
      WHERE switchboard_id = $1
      ORDER BY COALESCE(position_number, 'z'), id
    `;
    const { rows } = await pool.query(q, [switchboardId]);
    // settings is jsonb; ensure parsed object
    return rows.map(r => ({
      ...r,
      settings: typeof r.settings === "string" ? JSON.parse(r.settings || "{}") : (r.settings || {}),
    }));
  }

  function makePairs(devs) {
    const pairs = [];
    const sorted = [...devs].sort((a,b)=> (parseFloat(b.in_amps||0) - parseFloat(a.in_amps||0)));
    for (let i=0;i<sorted.length;i++) {
      for (let j=i+1;j<sorted.length;j++) {
        pairs.push({ upstream: sorted[i], downstream: sorted[j], relation: "same_board_heuristic" });
      }
    }
    return pairs;
  }

  router.get("/pairs", async (req, res) => {
    try {
      const switchboardId = req.query.switchboard_id;
      if (!switchboardId) return res.status(400).json({ error: "switchboard_id required" });
      const devs = await loadBoardDevices(switchboardId);
      const pairs = makePairs(devs).map(p => ({
        upstream_id: p.upstream.id,
        downstream_id: p.downstream.id,
        upstream_name: p.upstream.name || `${p.upstream.manufacturer || ""} ${p.upstream.reference || ""}`.trim(),
        downstream_name: p.downstream.name || `${p.downstream.manufacturer || ""} ${p.downstream.reference || ""}`.trim(),
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
      const { rows } = await pool.query(`
        SELECT id, switchboard_id, parent_id, device_type, manufacturer, reference,
               in_amps, icu_ka, ics_ka, poles, voltage_v, trip_unit, settings, name
        FROM devices WHERE id = ANY($1)
      `, [[upstream_id, downstream_id]]);
      const norm = (r)=>({...r, settings: typeof r.settings==="string" ? JSON.parse(r.settings||"{}") : (r.settings||{})});
      const up = norm(rows.find(r=>r.id===upstream_id));
      const dn = norm(rows.find(r=>r.id===downstream_id));
      if (!up || !dn) return res.status(404).json({ error: "device_not_found" });
      const faultKA = prospective_short_circuit_kA ? parseFloat(prospective_short_circuit_kA) : undefined;
      const result = checkPair(up, dn, faultKA);
      return res.json({
        upstream: {id: up.id, name: up.name || `${up.manufacturer||""} ${up.reference||""}`.trim()},
        downstream: {id: dn.id, name: dn.name || `${dn.manufacturer||""} ${dn.reference||""}`.trim()},
        result,
        curves: { upstream: makeTCC(up), downstream: makeTCC(dn) }
      });
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
          upstream_id: p.upstream.id, upstream_name: p.upstream.name || `${p.upstream.manufacturer||""} ${p.upstream.reference||""}`.trim(),
          downstream_id: p.downstream.id, downstream_name: p.downstream.name || `${p.downstream.manufacturer||""} ${p.downstream.reference||""}`.trim(),
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
    if (r.verdict === "TOTAL") return "OK – No action.";
    if (r.missing?.length) return "Missing data: " + r.missing.join(", ");
    const tips = [];
    if (r.reasons?.length) tips.push(...r.reasons);
    tips.push("Increase upstream instantaneous pickup (Ii) or enable short-time delay (ts) when available.");
    tips.push("Use manufacturer pairwise selectivity tables to validate or change device combination.");
    return tips.join(" ");
  }

  return router;
}

// Standalone
if (process.env.SELECTIVITY_STANDALONE === "1") {
  const expressMod = await import("express");
  const { Pool } = await import("pg");
  const app = expressMod.default();
  const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL });
  app.use("/api/selectivity", buildSelectivityRouter({ pool }));
  const port = process.env.SELECTIVITY_PORT || 3004;
  app.listen(port, () => console.log("[selectivity] ready on :" + port));
}
