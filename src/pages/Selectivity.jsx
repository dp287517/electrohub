import { useEffect, useState, useRef } from 'react';
import { get, post } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Zap, Download, ChevronRight } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import Confetti from 'react-confetti';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LogarithmicScale,
} from 'chart.js';
import Annotation from 'chartjs-plugin-annotation';
import Zoom from 'chartjs-plugin-zoom';

// Enregistrement des plugins
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LogarithmicScale,
  Annotation,
  Zoom
);

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

function Toast({ msg, type }) {
  const colors = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-blue-600 text-white',
  };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm ${colors[type]}`}>
      {msg}
    </div>
  );
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[80vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-100px)]">{children}</div>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-40 overflow-y-auto p-6 transition-transform duration-300 ease-in-out transform translate-x-0">
      <button onClick={onClose} className="absolute top-4 right-4 p-1 hover:bg-gray-200 rounded">
        <X size={20} />
      </button>
      {children}
    </div>
  );
}

export default function Selectivity() {
  const site = useUserSite();
  const [pairs, setPairs] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [selectedPairs, setSelectedPairs] = useState([]);
  const [q, setQ] = useState({ q: '', switchboard: '', building: '', floor: '', sort: 'name', dir: 'desc', page: 1 });
  const [total, setTotal] = useState(0);
  const [selectedPair, setSelectedPair] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [curveData, setCurveData] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const chartRef = useRef(null);
  const pageSize = 18;

  // Ajout pour toggle filtres (cachés par défaut)
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadPairs();
  }, [q]);

  const loadPairs = async () => {
    try {
      setBusy(true);
      const data = await get('/api/selectivity/pairs', q);
      setPairs(data?.data || []);
      setTotal(data?.total || 0);
      // Initialiser les statuts depuis l'API
      const initialStatuses = {};
      data?.data.forEach(pair => {
        if (pair.status) {
          initialStatuses[pair.downstream_id] = pair.status;
        }
      });
      setStatuses(initialStatuses);
    } catch (e) {
      setToast({ msg: 'Failed to load pairs', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async (upstreamId, downstreamId, faultI = null, isBatch = false) => {
    try {
      setBusy(true);
      const params = { upstream: upstreamId, downstream: downstreamId };
      const result = await get('/api/selectivity/check', params);
      setCheckResult(result);
      setSelectedPair({ upstreamId, downstreamId });
      setStatuses(prev => ({ ...prev, [`${downstreamId}`]: result.status }));

      const curves = await get('/api/selectivity/curves', params);
      const datasets = {
        datasets: [
          { label: 'Upstream', data: curves.upstream.map(p => ({ x: p.current, y: Math.min(p.time, 1000) })), borderColor: 'blue', tension: 0.1, pointRadius: 0 },
          { label: 'Downstream', data: curves.downstream.map(p => ({ x: p.current, y: Math.min(p.time, 1000) })), borderColor: 'green', tension: 0.1, pointRadius: 0 },
        ],
      };
      setCurveData(datasets);
      setShowGraph(true);

      const tipRes = await post('/api/selectivity/ai-tip', { 
        query: `Explain why this pair is ${result.status}: upstream ${upstreamId}, downstream ${downstreamId}, fault_current: ${faultI || 'general'}` 
      });
      setTipContent(tipRes.tip);
      setShowSidebar(true);

      if (result.status === 'selective' && !isBatch) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
      }
    } catch (e) {
      setToast({ msg: 'Check failed', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleBatchCheck = async () => {
    try {
      setBusy(true);
      for (const id of selectedPairs) {
        const pair = pairs.find(p => p.downstream_id === id);
        if (pair) await handleCheck(pair.upstream_id, pair.downstream_id, null, true);
      }
      setToast({ msg: 'Batch check completed!', type: 'success' });
    } catch (e) {
      setToast({ msg: 'Batch check failed', type: 'error' });
    } finally {
      setBusy(false);
      setSelectedPairs([]);
    }
  };

  const autoEvaluateAll = async () => {
    try {
      setBusy(true);
      const results = [];
      for (const pair of pairs.slice(0, 10)) {
        const res = await get('/api/selectivity/check', { upstream: pair.upstream_id, downstream: pair.downstream_id });
        results.push({ pair: pair.downstream_name, status: res.status });
        setStatuses(prev => ({ ...prev, [`${pair.downstream_id}`]: res.status }));
      }
      const compliant = results.filter(r => r.status === 'selective').length;
      setToast({ 
        msg: `${compliant}/${results.length} pairs selective.`, 
        type: compliant === results.length ? 'success' : 'info' 
      });
      if (compliant === results.length) setShowConfetti(true);
    } catch (e) {
      setToast({ msg: 'Auto-evaluation failed', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const exportPDF = async () => {
    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text('Selectivity Report', 10, 10);
    pdf.setFontSize(12);
    pdf.text(`Date: ${new Date().toLocaleString()}`, 10, 20);
    
    // Tableau des paires
    pdf.text('Pairs Status:', 10, 30);
    let y = 40;
    pairs.forEach(pair => {
      const status = statuses[pair.downstream_id] || 'Pending';
      pdf.text(`${pair.downstream_name} vs ${pair.upstream_name}: ${status}`, 10, y);
      y += 10;
    });

    // Graphiques pour chaque paire vérifiée
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    let chartInstance = null;

    for (const pair of pairs.filter(p => statuses[p.downstream_id])) {
      try {
        const curves = await get('/api/selectivity/curves', {
          upstream: pair.upstream_id,
          downstream: pair.downstream_id,
        });
        const data = {
          datasets: [
            { label: 'Upstream', data: curves.upstream.map(p => ({ x: p.current, y: Math.min(p.time, 1000) })), borderColor: 'blue', tension: 0.1, pointRadius: 0 },
            { label: 'Downstream', data: curves.downstream.map(p => ({ x: p.current, y: Math.min(p.time, 1000) })), borderColor: 'green', tension: 0.1, pointRadius: 0 },
          ],
        };
        const status = statuses[pair.downstream_id];
        const nonSelectiveZones = status === 'non-selective' ? (await get('/api/selectivity/check', {
          upstream: pair.upstream_id,
          downstream: pair.downstream_id,
        })).nonSelectiveZones : [];

        pdf.addPage();
        pdf.setFontSize(14);
        pdf.text(`Selectivity Curve for Pair: ${pair.downstream_name} vs ${pair.upstream_name}`, 10, 10);
        pdf.setFontSize(12);
        pdf.text(`Status: ${status}`, 10, 20);

        // Créer un graphique temporaire
        chartInstance = new ChartJS(ctx, {
          type: 'line',
          data: data,
          options: {
            parsing: { xAxisKey: 'x', yAxisKey: 'y' },
            responsive: false,
            scales: {
              x: { type: 'logarithmic', title: { display: true, text: 'Current (A)' }, ticks: { callback: (value) => Number(value).toFixed(0) + 'A' } },
              y: { type: 'linear', title: { display: true, text: 'Time (s)' }, min: 0.001, max: 1000, ticks: { callback: (value) => Number(value).toFixed(2) + 's', maxTicksLimit: 10 } },
            },
            plugins: {
              annotation: {
                annotations: nonSelectiveZones.map((zone, i) => ({
                  type: 'box',
                  xMin: zone.xMin,
                  xMax: zone.xMax,
                  backgroundColor: 'rgba(255, 0, 0, 0.2)',
                  borderColor: 'red',
                  label: { content: 'Non-Selective', display: true, position: 'center' }
                }))
              },
              title: { display: true, text: `Curve: ${pair.downstream_name} vs ${pair.upstream_name}` },
              tooltip: {
                callbacks: {
                  label: (context) => {
                    const nonSelective = context.datasetIndex === 1 && context.parsed.y >= data.datasets[0].data[context.dataIndex]?.y * 1.05;
                    return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}s at ${context.parsed.x}A ${nonSelective ? '(Non-selective)' : ''}`;
                  }
                }
              }
            },
          }
        });

        // Attendre que le graphique soit rendu
        await new Promise(resolve => setTimeout(resolve, 500));
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 10, 30, 180, 100);
        chartInstance.destroy();
      } catch (e) {
        console.error('Failed to generate chart for PDF:', e);
        pdf.text('Error generating curve', 10, 30);
      }
    }

    canvas.remove();
    pdf.save('selectivity_report.pdf');
  };

  const toggleSelect = (id) => {
    setSelectedPairs(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelectedPairs(selectedPairs.length === pairs.length ? [] : pairs.map(p => p.downstream_id));
  };

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      {showConfetti && <Confetti width={window.innerWidth} height={window.innerHeight} />}
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4 drop-shadow-md">Selectivity Analysis</h1>
        <p className="text-gray-600 max-w-3xl">
          This page verifies selectivity between upstream and downstream circuit breakers based on switchboard data. 
          Selectivity ensures that only the downstream breaker trips during a fault, preventing unnecessary outages (per IEC 60947-2 and 60898-1 standards). 
          Upstream/downstream links are defined via parent_id in devices. Use filters to target pairs, view time-current curves, 
          and get remediations if non-selective. If data is missing, edit via the Switchboards page.
        </p>
      </header>

      {/* Bouton toggle pour filtres */}
      <button 
        onClick={() => setShowFilters(!showFilters)} 
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md transition-transform hover:scale-105 mb-4"
      >
        {showFilters ? 'Hide Filters' : 'Show Filters'}
      </button>

      {/* Filters (cachés par défaut) */}
      {showFilters && (
        <div className="flex flex-wrap gap-4 mb-6 items-center">
          <input
            className="input flex-1 shadow-sm"
            placeholder="Search by name..."
            value={q.q}
            onChange={e => setQ({ ...q, q: e.target.value, page: 1 })}
          />
          <input className="input w-32 shadow-sm" placeholder="Switchboard ID" value={q.switchboard} onChange={e => setQ({ ...q, switchboard: e.target.value, page: 1 })} />
          <input className="input w-32 shadow-sm" placeholder="Building" value={q.building} onChange={e => setQ({ ...q, building: e.target.value, page: 1 })} />
          <input className="input w-32 shadow-sm" placeholder="Floor" value={q.floor} onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })} />
          <button 
            onClick={autoEvaluateAll} 
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md transition-transform hover:scale-105"
            disabled={busy}
          >
            Auto-Evaluate All
          </button>
          <button 
            onClick={exportPDF} 
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-md transition-transform hover:scale-105"
          >
            <Download size={16} className="inline mr-1" /> Export PDF
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto shadow-xl rounded-lg">
        <table className="min-w-full bg-white border border-gray-200 rounded-lg">
          <thead className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">
                <input type="checkbox" onChange={toggleSelectAll} checked={selectedPairs.length === pairs.length} />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Downstream</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Upstream</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Switchboard</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {pairs.map(pair => (
              <tr key={`${pair.downstream_id}-${pair.upstream_id}`} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <input 
                    type="checkbox" 
                    checked={selectedPairs.includes(pair.downstream_id)} 
                    onChange={() => toggleSelect(pair.downstream_id)} 
                  />
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">{pair.downstream_name} ({pair.downstream_type})</td>
                <td className="px-6 py-4 text-sm text-gray-900">{pair.upstream_name} ({pair.upstream_type})</td>
                <td className="px-6 py-4 text-sm text-gray-900">{pair.switchboard_name}</td>
                <td className="px-6 py-4 text-sm">
                  {statuses[pair.downstream_id] === 'selective' ? <CheckCircle className="text-green-600" /> :
                   statuses[pair.downstream_id] === 'non-selective' ? <XCircle className="text-red-600" /> :
                   statuses[pair.downstream_id] === 'incomplete' ? <AlertTriangle className="text-yellow-600" /> : 'Pending'}
                </td>
                <td className="px-6 py-4 text-sm">
                  <button
                    onClick={() => handleCheck(pair.upstream_id, pair.downstream_id)}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    Check
                  </button>
                  <a href={`/app/switchboards?edit=${pair.downstream_id}`} className="text-green-600 hover:underline">Edit</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedPairs.length > 0 && (
        <button 
          onClick={handleBatchCheck} 
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md transition-transform hover:scale-105"
          disabled={busy}
        >
          Check Selected ({selectedPairs.length})
        </button>
      )}

      {/* Results */}
      {checkResult && (
        <div className="mt-8 p-6 bg-white rounded-lg shadow-md transition-all duration-500 transform scale-100">
          <h2 className="text-2xl font-semibold mb-4 text-indigo-800">Analysis Result</h2>
          <div className="flex items-center gap-2 mb-4">
            {checkResult.status === 'selective' ? <CheckCircle className="text-green-600 animate-bounce" size={24} /> :
             checkResult.status === 'non-selective' ? <XCircle className="text-red-600" size={24} /> :
             <AlertTriangle className="text-yellow-600" size={24} />}
            <span className="text-xl capitalize">{checkResult.status}</span>
          </div>
          {checkResult.missing?.length > 0 && (
            <div className="mb-4 text-yellow-600 flex items-center">
              <AlertTriangle className="mr-2" />
              Missing data: {checkResult.missing.join(', ')}
            </div>
          )}
          {checkResult.remediation?.length > 0 && (
            <ul className="list-disc pl-5 mb-4 text-gray-700">
              {checkResult.remediation.map((r, i) => <li key={i} className="mb-1">{r}</li>)}
            </ul>
          )}
          <button 
            onClick={() => setShowSidebar(true)} 
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
          >
            <ChevronRight size={16} /> View Explanation
          </button>
        </div>
      )}

      {/* Graph Modal */}
      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="Time-Current Curves (Zoom & Pan Enabled)">
        <div ref={chartRef}>
          {curveData && (
            <Line
              data={curveData}
              options={{
                parsing: { xAxisKey: 'x', yAxisKey: 'y' },
                responsive: true,
                scales: {
                  x: { type: 'logarithmic', title: { display: true, text: 'Current (A)' }, ticks: { callback: (value) => Number(value).toFixed(0) + 'A' } },
                  y: { type: 'linear', title: { display: true, text: 'Time (s)' }, min: 0.001, max: 1000, ticks: { callback: (value) => Number(value).toFixed(2) + 's', maxTicksLimit: 10 } },
                },
                plugins: {
                  zoom: {
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
                    pan: { enabled: true, mode: 'xy' },
                  },
                  annotation: {
                    annotations: checkResult?.nonSelectiveZones?.map((zone, i) => ({
                      type: 'box',
                      xMin: zone.xMin,
                      xMax: zone.xMax,
                      backgroundColor: 'rgba(255, 0, 0, 0.2)',
                      borderColor: 'red',
                      label: { content: 'Non-Selective', display: true, position: 'center' }
                    })) || []
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => {
                        const nonSelective = context.datasetIndex === 1 && context.parsed.y >= (data.datasets[0].data[context.dataIndex]?.y || Infinity) * 1.05;
                        return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}s at ${context.parsed.x}A ${nonSelective ? '(Non-selective)' : ''}`;
                      }
                    }
                  }
                },
              }}
            />
          )}
        </div>
        <button 
          onClick={() => setShowGraph(false)} 
          className="mt-4 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        >
          Close Graph
        </button>
      </Modal>

      {/* Sidebar for Tips */}
      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)}>
        <h3 className="text-xl font-bold mb-4">Explanation Tip</h3>
        <p className="text-gray-700 whitespace-pre-wrap mb-4">{tipContent}</p>
        <HelpCircle className="text-blue-500 inline" size={24} />
      </Sidebar>

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div>
      </div>}
    </section>
  );
}
