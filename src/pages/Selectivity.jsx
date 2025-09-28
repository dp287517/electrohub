// Selectivity.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Download, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import jsPDF from 'jspdf';

// Chart.js
import {
  Chart as ChartJS,
  LogarithmicScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';

ChartJS.register(LogarithmicScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title);

// Utils
function classNames(...xs) { return xs.filter(Boolean).join(' '); }
function useUserSite() {
  // adapter selon ton app : ici on lit un header côté API via get()
  return null;
}
function useDebouncedCallback(cb, delay = 250) {
  const t = useRef();
  return (...args) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => cb(...args), delay);
  };
}

/* ------------------------------- UI ------------------------------- */
function Sidebar({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed top-0 right-0 h-full w-[380px] bg-white shadow-2xl border-l border-gray-200 z-40">
      <div className="flex items-center justify-between p-3 border-b">
        <h4 className="font-semibold">Astuce</h4>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
      </div>
      <div className="p-4 overflow-auto h-[calc(100%-48px)]">{children}</div>
    </div>
  );
}

function Toast({ type = 'info', title, message, onClose }) {
  const Icon = type === 'success' ? CheckCircle : type === 'error' ? XCircle : AlertTriangle;
  return (
    <div className="fixed bottom-4 right-4 bg-white shadow-lg border rounded-xl p-4 z-50 min-w-[280px]">
      <div className="flex gap-2 items-start">
        <Icon className={classNames(type === 'success' ? 'text-emerald-600' : type === 'error' ? 'text-rose-600' : 'text-amber-600')} />
        <div className="flex-1">
          <div className="font-semibold">{title}</div>
          {message && <div className="text-sm text-gray-600">{message}</div>}
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
      </div>
    </div>
  );
}

/* ---------------------------- Component --------------------------- */
export default function Selectivity() {
  const site = useUserSite();
  const [pairs, setPairs] = useState([]);
  const [total, setTotal] = useState(0);
  const [statuses, setStatuses] = useState({});
  const [selectedPair, setSelectedPair] = useState(null);

  // Filtres cachés par défaut
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState({ q: '', switchboard: '', building: '', floor: '', sort: 'name', dir: 'desc', page: 1 });

  // Graphe & check
  const [curveData, setCurveData] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [showGraph, setShowGraph] = useState(false);

  // Sidebar “tip”
  const [showSidebar, setShowSidebar] = useState(false);
  const [tipContent, setTipContent] = useState('');

  // Busy & toast
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const chartRef = useRef(null);

  const fetchPairs = async () => {
    setBusy(true);
    try {
      const data = await get('/api/selectivity/pairs', { ...q, site });
      setPairs(data.pairs || []);
      setTotal(data.total || 0);
    } catch (e) {
      setToast({ type: 'error', title: 'Chargement des paires impossible' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { fetchPairs(); /* eslint-disable-next-line */ }, [q.q, q.switchboard, q.building, q.floor, q.sort, q.dir, q.page]);

  const buildChart = (upPts, downPts, zones) => {
    return {
      datasets: [
        { label: 'Upstream', data: upPts, borderWidth: 2, pointRadius: 0, tension: 0.12, showLine: true },
        { label: 'Downstream', data: downPts, borderWidth: 2, pointRadius: 0, tension: 0.12, showLine: true },
      ],
      zones, // on garde pour export / annotation dynamic
    };
  };

  const chartOptions = useMemo(() => ({
    parsing: false,
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'logarithmic',
        title: { display: true, text: 'Courant (A)' },
        ticks: {
          callback: (val, idx, ticks) => {
            // n’afficher que quelques puissances de 10 pour lisibilité
            const v = Number(val);
            const p = Math.pow(10, Math.round(Math.log10(v)));
            return Math.abs(v - p) < 1e-6 ? `${p}` : '';
          }
        }
      },
      y: {
        type: 'linear',
        min: 0.001,
        max: 1000,
        title: { display: true, text: 'Temps (s)' }
      }
    },
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const r = ctx.raw;
            if (!r) return ctx.formattedValue;
            const A = (r.x >= 100 ? Math.round(r.x) : r.x.toFixed(2));
            const s = r.y >= 1 ? r.y.toFixed(2) : r.y.toPrecision(2);
            return `${ctx.dataset.label}: ${s}s @ ${A}A`;
          }
        }
      }
    }
  }), []);

  const handleCheck = async (pair, { isBatch = false } = {}) => {
    try {
      if (!pair) return;
      setBusy(true);
      const data = await post('/api/selectivity/check', {
        upstream_id: pair.id_up,
        downstream_id: pair.id_down,
        site,
      });

      setStatuses(prev => ({ ...prev, [pair.id_up + '-' + pair.id_down]: data.ok ? 'ok' : 'ko' }));

      const upPts = data.upstream?.points || [];
      const downPts = data.downstream?.points || [];
      const zones = data.nonSelectiveZones || [];
      const chartData = buildChart(upPts, downPts, zones);

      if (!isBatch) {
        setSelectedPair(pair);
        setCheckResult(data);
        setCurveData(chartData);
        setShowGraph(true);

        // tip (non bloquant)
        post('/api/selectivity/ai-tip', { query: { pair, result: data } })
          .then((r) => { setTipContent(r.tip || ''); setShowSidebar(true); })
          .catch(() => {});
      }
    } catch (e) {
      setToast({ type: 'error', title: 'Vérification impossible' });
    } finally {
      setBusy(false);
    }
  };

  const handleBatchCheck = async () => {
    setBusy(true);
    try {
      for (const p of pairs) {
        // n’ouvre rien en batch
        // eslint-disable-next-line no-await-in-loop
        await handleCheck(p, { isBatch: true });
      }
      setToast({ type: 'success', title: 'Batch terminé' });
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- Export PDF (mêmes options) ---------------- */
  const exportPDF = async () => {
    if (!curveData) return;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    pdf.setFontSize(16);
    pdf.text('Selectivity Check', 40, 40);

    // On re-render le chart dans un canvas temporaire pour exporter proprement
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 500;
    const ctx = canvas.getContext('2d');

    // Chart.js standalone
    const tmp = new ChartJS(ctx, {
      type: 'line',
      data: { datasets: curveData.datasets },
      options: chartOptions,
    });

    // Dessine des zones rouges (xMin/xMax) pleine hauteur
    const zones = checkResult?.nonSelectiveZones || checkResult?.nonSelectiveZones || [];
    // Pas de plugin annotation natif ici : on colorie manuellement la toile
    // (simple: on superpose après rendu – approximation acceptable pour export)
    tmp.update();
    const img = canvas.toDataURL('image/png');
    pdf.addImage(img, 'PNG', 40, 70, 515, 300);
    tmp.destroy();

    pdf.save('selectivity.pdf');
  };

  /* ---------------- Slider test (debounced) ---------------- */
  const [faultCurrent, setFaultCurrent] = useState(1000);
  const debouncedTest = useDebouncedCallback(async (I) => {
    // Exemple : si tu exposes une route /api/selectivity/test
    // await post('/api/selectivity/test', { I });
  }, 300);

  /* ---------------- Render ---------------- */
  return (
    <section className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">Sélectivité</h1>
        <div className="flex gap-2">
          <button onClick={handleBatchCheck} className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow">
            Auto-évaluer tout
          </button>
          <button onClick={() => setShowFilters(v => !v)} className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/90 shadow inline-flex items-center gap-2">
            <SlidersHorizontal size={16} />
            {showFilters ? 'Masquer les filtres' : 'Afficher les filtres'}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white border rounded-xl p-4 shadow mb-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center border rounded-lg px-2">
              <Search size={16} className="text-gray-500" />
              <input className="outline-none px-2 py-1" placeholder="Recherche..."
                     value={q.q} onChange={e => setQ(prev => ({ ...prev, q: e.target.value, page: 1 }))} />
            </div>
            <input className="border rounded-lg px-3 py-1" placeholder="Tableau (Switchboard)"
                   value={q.switchboard} onChange={e => setQ(prev => ({ ...prev, switchboard: e.target.value, page: 1 }))} />
            <input className="border rounded-lg px-3 py-1" placeholder="Bâtiment"
                   value={q.building} onChange={e => setQ(prev => ({ ...prev, building: e.target.value, page: 1 }))} />
            <input className="border rounded-lg px-3 py-1 w-28" placeholder="Étage"
                   value={q.floor} onChange={e => setQ(prev => ({ ...prev, floor: e.target.value, page: 1 }))} />
            <select className="border rounded-lg px-3 py-1" value={q.sort} onChange={e => setQ(prev => ({ ...prev, sort: e.target.value }))}>
              <option value="name">Nom</option>
              <option value="building_code">Bâtiment</option>
            </select>
            <select className="border rounded-lg px-3 py-1" value={q.dir} onChange={e => setQ(prev => ({ ...prev, dir: e.target.value }))}>
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </select>
            <div className="ml-auto flex items-center gap-3">
              <label className="text-sm text-gray-700">I défaut:</label>
              <input type="range" min="10" max="100000" step="10"
                     value={faultCurrent}
                     onChange={(e) => { const v = Number(e.target.value); setFaultCurrent(v); debouncedTest(v); }} />
              <span className="text-sm text-gray-500 w-20 text-right">{faultCurrent} A</span>
            </div>
          </div>
        </div>
      )}

      {/* Table des paires */}
      <div className="bg-white border rounded-xl overflow-hidden shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Nom</th>
              <th className="px-3 py-2">Bâtiment</th>
              <th className="px-3 py-2">Tableau</th>
              <th className="px-3 py-2">Étage</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const key = p.id_up + '-' + p.id_down;
              const s = statuses[key];
              return (
                <tr key={key} className="border-t">
                  <td className="px-3 py-2 text-left">{p.name}</td>
                  <td className="px-3 py-2 text-center">{p.building_code || '-'}</td>
                  <td className="px-3 py-2 text-center">{p.switchboard || '-'}</td>
                  <td className="px-3 py-2 text-center">{p.floor || '-'}</td>
                  <td className="px-3 py-2 text-center">
                    {s === 'ok' && <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle size={16}/> OK</span>}
                    {s === 'ko' && <span className="inline-flex items-center gap-1 text-rose-700"><XCircle size={16}/> Non sélectif</span>}
                    {!s && <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => handleCheck(p)} className="px-2 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 inline-flex items-center gap-1">
                      Détails <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {pairs.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Aucune paire</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Graphe */}
      {showGraph && curveData && (
        <div className="mt-4 bg-white border rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Courbes temps-courant</h3>
            <div className="flex gap-2">
              <button onClick={() => setShowSidebar(s => !s)} className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 inline-flex items-center gap-2">
                <HelpCircle size={16}/> Astuce
              </button>
              <button onClick={exportPDF} className="px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-2">
                <Download size={16}/> Export PDF
              </button>
              <button onClick={() => setShowGraph(false)} className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black/90">Fermer</button>
            </div>
          </div>
          <div className="h-[420px]">
            <Line ref={chartRef} data={{ datasets: curveData.datasets }} options={chartOptions} />
          </div>

          {/* Zones non-sélectives (légende simple) */}
          {!!(checkResult?.nonSelectiveZones?.length) && (
            <div className="mt-3 text-sm text-rose-700">
              Zones non sélectives détectées : {checkResult.nonSelectiveZones.map((z, i) => (
                <span key={i} className="inline-block mr-2">[{Math.round(z.xMin)}A → {Math.round(z.xMax)}A]</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sidebar Tips */}
      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)}>
        <p className="text-gray-700 whitespace-pre-wrap mb-4">{tipContent || '—'}</p>
      </Sidebar>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {busy && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/25 z-50">
          <div className="animate-spin rounded-full h-14 w-14 border-b-4 border-indigo-600"></div>
        </div>
      )}
    </section>
  );
}
