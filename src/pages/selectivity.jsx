// src/pages/Selectivity.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { get, post } from "../api"; // adapt to your helper
import { Search, Filter, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";

function logTicks(min, max, count = 6) {
  const ticks = [];
  for (let k = 0; k < count; k++) {
    const f = k / (count - 1);
    ticks.push(min * Math.pow(max / min, f));
  }
  return ticks;
}

function VerdictPill({ verdict }) {
  const styles = {
    "TOTAL": "bg-green-100 text-green-800 border-green-200",
    "PARTIAL": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "POOR": "bg-orange-100 text-orange-800 border-orange-200",
    "NOT SELECTIVE": "bg-red-100 text-red-800 border-red-200",
    "UNKNOWN": "bg-gray-100 text-gray-800 border-gray-200"
  };
  return <span className={`px-2 py-1 rounded-full text-xs border ${styles[verdict] || styles.UNKNOWN}`}>{verdict}</span>;
}

export default function Selectivity() {
  const [switchboardId, setSwitchboardId] = useState("");
  const [pairs, setPairs] = useState([]);
  const [faultKA, setFaultKA] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPair, setSelectedPair] = useState(null);
  const [scanRows, setScanRows] = useState([]);
  const [filterVerdict, setFilterVerdict] = useState("");

  const loadPairs = useCallback(async () => {
    if (!switchboardId) return;
    setLoading(true);
    try {
      const data = await get(`/api/selectivity/pairs?switchboard_id=${encodeURIComponent(switchboardId)}`);
      setPairs(data?.pairs || []);
    } catch (e) {
      console.error(e);
      alert("Failed to load pairs");
    } finally {
      setLoading(false);
    }
  }, [switchboardId]);

  const runScan = useCallback(async () => {
    if (!switchboardId) return;
    setLoading(true);
    try {
      const data = await post(`/api/selectivity/scan`, {
        switchboard_id: switchboardId,
        prospective_short_circuit_kA: faultKA ? parseFloat(faultKA) : undefined,
      });
      setScanRows(data?.rows || []);
    } catch (e) {
      console.error(e);
      alert("Scan failed");
    } finally {
      setLoading(false);
    }
  }, [switchboardId, faultKA]);

  const filteredRows = useMemo(() => {
    return scanRows.filter(r => !filterVerdict || r.verdict === filterVerdict);
  }, [scanRows, filterVerdict]);

  const [chartData, setChartData] = useState([]);
  const [info, setInfo] = useState(null);

  const openPair = async (p) => {
    setSelectedPair(p);
    try {
      const data = await post(`/api/selectivity/check`, {
        upstream_id: p.upstream_id,
        downstream_id: p.downstream_id,
        prospective_short_circuit_kA: faultKA ? parseFloat(faultKA) : undefined,
      });
      // Build chart points on log scale by sampling provided curves
      const up = data.curves?.upstream || [];
      const dn = data.curves?.downstream || [];
      // Recharts can't do log axes natively, so pre-transform: x=log10(I), y=log10(t)
      const rows = [];
      const pushPts = (arr, who) => {
        arr.forEach(pt => {
          rows.push({ who, xi: Math.log10(pt.i), yt: Math.log10(pt.t) });
        });
      };
      pushPts(up, "Upstream");
      pushPts(dn, "Downstream");
      setChartData(rows);
      setInfo(data);
    } catch (e) {
      console.error(e);
      alert("Check failed");
    }
  };

  return (
    <div className="p-4 space-y-6">
      <section className="bg-white rounded-2xl p-4 shadow border">
        <h1 className="text-2xl font-semibold">Selectivity</h1>
        <p className="text-sm text-gray-600 mt-2">
          This page evaluates upstream/downstream protection device selectivity (discrimination). It uses
          IEC concepts (e.g., IEC 60947-2 for MCCB/ACB and IEC 60898-1 for MCBs) by comparing simplified
          time–current curves and settings (In, Isd, ts, Ii). Results are indicative; always confirm with
          manufacturer selectivity tables for the exact breaker combination and settings.
        </p>
      </section>

      <section className="bg-white rounded-2xl p-4 shadow border">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500">Switchboard ID</label>
            <input className="border rounded-lg px-3 py-2" value={switchboardId} onChange={e=>setSwitchboardId(e.target.value)} placeholder="e.g. 12" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500">Prospective Isc at board (kA)</label>
            <input className="border rounded-lg px-3 py-2" value={faultKA} onChange={e=>setFaultKA(e.target.value)} placeholder="e.g. 6" />
          </div>
          <button onClick={loadPairs} className="px-3 py-2 rounded-lg bg-gray-100 border hover:bg-gray-200 flex items-center gap-2">
            <Search size={16}/> Load pairs
          </button>
          <button onClick={runScan} className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Run scan</button>

          <div className="ml-auto flex gap-2 items-center">
            <Filter size={16} className="text-gray-500"/>
            <select className="border rounded-lg px-2 py-2" value={filterVerdict} onChange={e=>setFilterVerdict(e.target.value)}>
              <option value="">All</option>
              <option value="TOTAL">TOTAL</option>
              <option value="PARTIAL">PARTIAL</option>
              <option value="POOR">POOR</option>
              <option value="NOT SELECTIVE">NOT SELECTIVE</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Upstream</th>
                <th className="py-2 pr-4">Downstream</th>
                <th className="py-2 pr-4">Verdict</th>
                <th className="py-2 pr-4">Limit (kA)</th>
                <th className="py-2 pr-4">Remediation</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, idx) => (
                <tr key={idx} className="border-b hover:bg-gray-50">
                  <td className="py-2 pr-4">{r.upstream_name}</td>
                  <td className="py-2 pr-4">{r.downstream_name}</td>
                  <td className="py-2 pr-4"><VerdictPill verdict={r.verdict}/></td>
                  <td className="py-2 pr-4">{r.limit_kA ? r.limit_kA.toFixed(2) : "—"}</td>
                  <td className="py-2 pr-4">{r.remediation}</td>
                  <td className="py-2 pr-4">
                    <button onClick={()=>openPair(r)} className="text-blue-600 hover:underline">View curves</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {info && (
        <section className="bg-white rounded-2xl p-4 shadow border">
          <div className="flex items-center gap-2 mb-2">
            <Info size={18} className="text-gray-500"/>
            <div className="font-medium">{info.upstream.name} (Upstream) vs {info.downstream.name} (Downstream)</div>
            <div className="ml-2"><VerdictPill verdict={info.result?.verdict}/></div>
          </div>
          <div className="text-xs text-gray-600 mb-3">
            {info.result?.reasons?.length ? <span className="text-orange-700">Notes: {info.result.reasons.join(" ")}</span> : null}
            {info.result?.missing?.length ? <span className="ml-2 text-red-700">Missing: {info.result.missing.join(", ")}</span> : null}
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis type="number" dataKey="xi" tickFormatter={v=>`10^${v.toFixed(1)} A`} />
                <YAxis type="number" dataKey="yt" tickFormatter={v=>`10^${v.toFixed(1)} s`} />
                <Tooltip formatter={(v, n, p)=>{
                  if (p && typeof p.payload?.xi === "number" && typeof p.payload?.yt === "number") {
                    const I = Math.pow(10, p.payload.xi);
                    const T = Math.pow(10, p.payload.yt);
                    return [`t = ${T.toFixed(3)} s`, `I = ${I.toFixed(0)} A`];
                  }
                  return v;
                }}/>
                <Legend />
                <Line dataKey="yt" name="Upstream" data={chartData.filter(r=>r.who==='Upstream')} dot={false} strokeWidth={2}/>
                <Line dataKey="yt" name="Downstream" data={chartData.filter(r=>r.who==='Downstream')} dot={false} strokeWidth={2}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}
