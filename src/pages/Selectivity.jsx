// Selectivity.jsx
// React (Vite/CRA) + react-chartjs-2 + chart.js v4 + chartjs-plugin-annotation
// Correctifs inclus : datasets {x,y}, échelle X logarithmique, annotations zones,
// tooltip cohérent (interpolation à X), debounce du slider, appels /ai-tip limités,
// export PDF utilisant le même mode {x,y}.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  TimeScale,
  CategoryScale,
  Tooltip,
  Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import autoTable from 'jspdf-autotable';
import jsPDF from 'jspdf';

ChartJS.register(LineElement, PointElement, LinearScale, LogarithmicScale, TimeScale, CategoryScale, Tooltip, Legend, annotationPlugin);

const API = import.meta.env.VITE_SELECTIVITY_API || ''; // ex: http://localhost:3004
const DEFAULT_MARGIN = Number(import.meta.env.VITE_MARGIN_PCT ?? 0.10);
const HEADERS = (site) => ({
  'Content-Type': 'application/json',
  ...(site ? { 'X-Site': site } : {}),
});

/* ----------- utilitaires ----------- */
function debounce(fn, wait = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function interpolateYAtX(points, x) {
  if (!points?.length) return Infinity;
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

/* ----------- composant principal ----------- */
export default function Selectivity() {
  const [site, setSite] = useState('');
  const [pairs, setPairs] = useState({ rows: [], total: 0, page: 1, pageSize: 20, sort: 'name', dir: 'ASC' });
  const [selection, setSelection] = useState(null); // {up_id, down_id, up_name, down_name}
  const [curves, setCurves] = useState(null);       // { upstream, downstream, nonSelectiveZones, ... }
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [faultI, setFaultI] = useState(1000);       // A
  const [aiTips, setAiTips] = useState('');
  const chartRef = useRef(null);

  /* ----- chargement paires ----- */
  useEffect(() => {
    const run = async () => {
      const url = new URL(`${API}/pairs`);
      url.searchParams.set('page', pairs.page);
      url.searchParams.set('pageSize', pairs.pageSize);
      url.searchParams.set('sort', pairs.sort);
      url.searchParams.set('dir', pairs.dir);
      const r = await fetch(url.toString(), { headers: HEADERS(site) });
      if (!r.ok) throw new Error('pairs_failed');
      const j = await r.json();
      setPairs(prev => ({ ...prev, ...j }));
    };
    run().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, pairs.page, pairs.pageSize, pairs.sort, pairs.dir]);

  /* ----- charger courbes pour la sélection courante ----- */
  const loadCurves = useCallback(async (sel, m = margin) => {
    if (!sel) return;
    const url = new URL(`${API}/curves`);
    url.searchParams.set('upstream_id', sel.up_id);
    url.searchParams.set('downstream_id', sel.down_id);
    url.searchParams.set('margin_pct', m);
    const r = await fetch(url.toString(), { headers: HEADERS(site) });
    if (!r.ok) throw new Error('curves_failed');
    const j = await r.json();
    setCurves(j);
  }, [site, margin]);

  /* ----- calcul de statut + tips IA (bouton, pas à chaque slider) ----- */
  const runCheck = useCallback(async (sel, m = margin) => {
    if (!sel) return;
    const r = await fetch(`${API}/check`, {
      method: 'POST',
      headers: HEADERS(site),
      body: JSON.stringify({ upstream_id: sel.up_id, downstream_id: sel.down_id, margin_pct: m }),
    });
    if (!r.ok) throw new Error('check_failed');
    const j = await r.json();

    // Astuces IA : déclenchées ici seulement (pas en continu)
    try {
      const ai = await fetch(`${API}/ai-tip`, {
        method: 'POST',
        headers: HEADERS(site),
        body: JSON.stringify({
          context: {
            selection: sel,
            margin_pct: m,
            non_selective: j.non_selective,
            nonSelectiveZones: j.nonSelectiveZones,
          }
        }),
      });
      if (ai.ok) {
        const aj = await ai.json();
        setAiTips(aj.tips || '');
      } else {
        setAiTips('(IA indisponible)');
      }
    } catch {
      setAiTips('(IA indisponible)');
    }
  }, [site, margin]);

  /* ----- quand on change de sélection ----- */
  useEffect(() => {
    if (!selection) return;
    loadCurves(selection, margin).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, margin]);

  /* ----- slider de courant de défaut, debounced ----- */
  const [faultIDisplay, setFaultIDisplay] = useState(faultI);
  const debouncedSetFaultI = useMemo(() =>
    debounce((v) => setFaultI(v), 350), []
  );

  /* ----- données Chart.js (datasets en {x,y}) ----- */
  const chartData = useMemo(() => {
    const upstream = curves?.upstream ?? [];
    const downstream = curves?.downstream ?? [];

    return {
      datasets: [
        {
          label: 'Upstream',
          data: upstream,
          parsing: false, // important quand on passe {x,y}
          borderWidth: 2,
          tension: 0.15,
          pointRadius: 0,
        },
        {
          label: 'Downstream',
          data: downstream,
          parsing: false,
          borderWidth: 2,
          tension: 0.15,
          pointRadius: 0,
        },
        ...(faultI ? [{
          label: 'Courant de défaut',
          data: [{ x: faultI, y: 0.001 }, { x: faultI, y: 1000 }],
          parsing: false,
          borderWidth: 1,
          borderDash: [6, 6],
          pointRadius: 0,
        }] : []),
      ],
    };
  }, [curves, faultI]);

  const annotations = useMemo(() => {
    const anns = {};
    (curves?.nonSelectiveZones || []).forEach((z, idx) => {
      anns[`zone_${idx}`] = {
        type: 'box',
        xMin: z.xMin,
        xMax: z.xMax,
        yMin: 0.001,
        yMax: 1000,
        backgroundColor: 'rgba(255,0,0,0.08)',
        borderWidth: 0,
      };
    });
    return { annotations: anns };
  }, [curves]);

  const chartOptions = useMemo(() => ({
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const dsLabel = ctx.dataset.label || '';
            const x = ctx.raw?.x ?? ctx.parsed.x;
            const y = ctx.raw?.y ?? ctx.parsed.y;
            // comparer à même X via interpolation
            const up = curves?.upstream ?? [];
            const down = curves?.downstream ?? [];
            const tu = interpolateYAtX(up, x);
            const td = interpolateYAtX(down, x);
            const gapOK = td >= (1 + margin) * tu;
            const status = gapOK ? 'OK' : 'non-sélectif';
            return `${dsLabel}: I=${x.toFixed(0)} A, t=${y.toFixed(3)} s — statut @I: ${status}`;
          }
        }
      },
      annotation: annotations,
    },
    scales: {
      x: {
        type: 'logarithmic',
        title: { display: true, text: 'Courant (A) [log]' },
        min: 1,
        ticks: { callback: (v) => Number(v).toLocaleString() },
      },
      y: {
        type: 'logarithmic',
        title: { display: true, text: 'Temps de déclenchement (s) [log]' },
        min: 0.001,
        max: 1000,
      }
    }
  }), [annotations, curves, margin]);

  /* ----- export PDF (graphe + tableau) ----- */
  const exportPDF = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart) return;
    const canvas = chart.canvas;
    const dataUrl = canvas.toDataURL('image/png', 1.0);

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pad = 36;

    doc.setFontSize(14);
    doc.text('Analyse de sélectivité', pad, pad);
    doc.setFontSize(11);
    doc.text(`Site: ${site || '-'}`, pad, pad + 18);
    if (selection) {
      doc.text(`Upstream: ${selection.up_name} (#${selection.up_id})`, pad, pad + 36);
      doc.text(`Downstream: ${selection.down_name} (#${selection.down_id})`, pad, pad + 54);
    }
    doc.text(`Marge: ${(margin * 100).toFixed(0)}%`, pad, pad + 72);

    // graphe
    doc.addImage(dataUrl, 'PNG', pad, pad + 90, 523, 300);

    // zones non sélectives
    autoTable(doc, {
      startY: pad + 410,
      head: [['Zone', 'xMin (A)', 'xMax (A)']],
      body: (curves?.nonSelectiveZones || []).map((z, i) => [
        `Z${i + 1}`, Math.round(z.xMin).toLocaleString(), Math.round(z.xMax).toLocaleString()
      ]),
      styles: { fontSize: 9 },
      theme: 'grid',
    });

    doc.save('selectivity.pdf');
  }, [curves, selection, site, margin]);

  /* ----- rendu ----- */
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Sélectivité</h1>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-sm">Site (X-Site)</label>
          <input value={site} onChange={e => setSite(e.target.value)} placeholder="ex: SITE-01"
                 className="border rounded px-2 py-1" />
        </div>

        <div>
          <label className="block text-sm">Marge (%)</label>
          <input type="number" min="0" max="100" step="1"
                 value={Math.round(margin * 100)}
                 onChange={e => setMargin(Math.max(0, Math.min(1, Number(e.target.value)/100)))} 
                 className="border rounded px-2 py-1 w-24" />
        </div>

        <div>
          <button className="border rounded px-3 py-2"
                  onClick={() => selection && runCheck(selection, margin)}>
            Vérifier & Conseils IA
          </button>
        </div>

        <div className="ml-auto flex gap-2">
          <button className="border rounded px-3 py-2" onClick={exportPDF}>
            Export PDF
          </button>
        </div>
      </div>

      {/* liste des paires */}
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Tableau</th>
              <th className="text-left p-2">Bâtiment</th>
              <th className="text-left p-2">Étage</th>
              <th className="text-left p-2">Upstream</th>
              <th className="text-left p-2">Downstream</th>
              <th className="text-left p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {pairs.rows.map((r, idx) => (
              <tr key={idx} className="odd:bg-white even:bg-gray-50">
                <td className="p-2">{r.switchboard || '-'}</td>
                <td className="p-2">{r.building_code || '-'}</td>
                <td className="p-2">{r.floor ?? '-'}</td>
                <td className="p-2">{r.up_name} (In {r.up_in ?? '-'}A)</td>
                <td className="p-2">{r.down_name} (In {r.down_in ?? '-'}A)</td>
                <td className="p-2">
                  <button
                    className="border rounded px-2 py-1"
                    onClick={() => setSelection({
                      up_id: r.up_id, down_id: r.down_id,
                      up_name: r.up_name, down_name: r.down_name
                    })}
                  >
                    Visualiser
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* pagination simple */}
        <div className="flex items-center justify-between p-2">
          <div>Total: {pairs.total}</div>
          <div className="flex gap-2">
            <button className="border rounded px-2 py-1"
                    onClick={() => setPairs(p => ({ ...p, page: Math.max(1, p.page - 1) }))}>
              ◀
            </button>
            <span>Page {pairs.page}</span>
            <button className="border rounded px-2 py-1"
                    onClick={() => setPairs(p => ({ ...p, page: p.page + 1 }))}>
              ▶
            </button>
          </div>
        </div>
      </div>

      {/* graphe */}
      {selection && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 border rounded p-3" style={{ height: 420 }}>
            <div className="flex items-end gap-3 mb-2">
              <div>
                <label className="block text-sm">Courant de défaut (A)</label>
                <input type="number" className="border rounded px-2 py-1 w-32"
                       value={faultIDisplay}
                       onChange={(e) => {
                         const v = Math.max(1, Number(e.target.value || 1));
                         setFaultIDisplay(v);
                         debouncedSetFaultI(v);
                       }} />
              </div>
              <button className="border rounded px-3 py-2"
                      onClick={() => loadCurves(selection, margin)}>
                Recalculer courbes
              </button>
            </div>

            <Line
              ref={chartRef}
              data={chartData}
              options={chartOptions}
            />
          </div>

          <div className="border rounded p-3">
            <h3 className="font-medium mb-2">Conseils</h3>
            <div className="text-sm whitespace-pre-wrap">
              {aiTips || 'Clique “Vérifier & Conseils IA” pour générer des recommandations.'}
            </div>

            <h3 className="font-medium mt-4 mb-2">Zones non sélectives</h3>
            <ul className="text-sm list-disc pl-5">
              {(curves?.nonSelectiveZones || []).map((z, i) => (
                <li key={i}>I ∈ [{Math.round(z.xMin).toLocaleString()} ; {Math.round(z.xMax).toLocaleString()}] A</li>
              ))}
              {(!curves?.nonSelectiveZones || curves.nonSelectiveZones.length === 0) && (
                <li>Aucune zone détectée à la marge choisie.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
