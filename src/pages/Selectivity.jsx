// src/pages/Selectivity.jsx
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Zap } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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

export default function Selectivity() {
  const site = useUserSite();
  const [pairs, setPairs] = useState([]);
  const [q, setQ] = useState({ q: '', switchboard: '', building: '', floor: '', sort: 'name', dir: 'desc', page: 1 });
  const [total, setTotal] = useState(0);
  const [selectedPair, setSelectedPair] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [curveData, setCurveData] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [faultCurrent, setFaultCurrent] = useState(1000); // Slider pour test interactif
  const pageSize = 18;

  useEffect(() => {
    loadPairs();
  }, [q]);

  const loadPairs = async () => {
    try {
      if (!site) return;
      setBusy(true);
      const data = await get('/api/selectivity/pairs', q);
      setPairs(data?.data || []);
      setTotal(data?.total || 0);
    } catch (e) {
      setToast({ msg: 'Failed to load pairs', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async (upstreamId, downstreamId, faultI = null) => {
    try {
      setBusy(true);
      const params = { upstream: upstreamId, downstream: downstreamId, fault_current: faultI };
      const result = await get('/api/selectivity/check', params);
      setCheckResult(result);
      setSelectedPair({ upstreamId, downstreamId });

      const curves = await get('/api/selectivity/curves', params);
      setCurveData({
        labels: curves.upstream.map(p => p.current.toFixed(0)),
        datasets: [
          { 
            label: 'Upstream', 
            data: curves.upstream.map(p => p.time), 
            borderColor: 'blue', 
            tension: 0.1,
            pointRadius: 0 
          },
          { 
            label: 'Downstream', 
            data: curves.downstream.map(p => p.time), 
            borderColor: 'green', 
            tension: 0.1,
            pointRadius: 0 
          },
        ],
      });
      setShowGraph(true);

      // Fetch tip explicatif
      const tipRes = await post('/api/selectivity/ai-tip', { 
        query: `Explain why this pair is ${result.status}: upstream ${upstreamId}, downstream ${downstreamId}, fault_current: ${faultI || 'general'}` 
      });
      setTipContent(tipRes.tip);
      setShowTipModal(true);
    } catch (e) {
      setToast({ msg: 'Check failed', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const autoEvaluateAll = async () => {
    try {
      setBusy(true);
      const results = [];
      for (const pair of pairs.slice(0, 5)) { // Limite à 5 pour perf
        const res = await get('/api/selectivity/check', { upstream: pair.upstream_id, downstream: pair.downstream_id });
        results.push({ pair: pair.downstream_name, status: res.status });
      }
      const compliant = results.filter(r => r.status === 'selective').length;
      setToast({ 
        msg: `${compliant}/${results.length} pairs selective. Check details in console.`, 
        type: compliant === results.length ? 'success' : 'info' 
      });
    } catch (e) {
      setToast({ msg: 'Auto-evaluation failed', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const testFaultCurrent = () => {
    if (selectedPair) {
      handleCheck(selectedPair.upstreamId, selectedPair.downstreamId, faultCurrent);
    }
  };

  return (
    <section className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Selectivity Analysis</h1>
        <p className="text-gray-600 max-w-3xl">
          This page verifies selectivity between upstream and downstream circuit breakers based on switchboard data. 
          Selectivity ensures that only the downstream breaker trips during a fault, preventing unnecessary outages (per IEC 60947-2 and 60898-1 standards). 
          Upstream/downstream links are defined via parent_id in devices. Use filters to target pairs, view time-current curves, 
          and get remediations if non-selective. If data is missing, edit via the Switchboards page.
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <input
          className="input flex-1"
          placeholder="Search by name..."
          value={q.q}
          onChange={e => setQ({ ...q, q: e.target.value, page: 1 })}
        />
        <input className="input w-32" placeholder="Switchboard ID" value={q.switchboard} onChange={e => setQ({ ...q, switchboard: e.target.value, page: 1 })} />
        <input className="input w-32" placeholder="Building" value={q.building} onChange={e => setQ({ ...q, building: e.target.value, page: 1 })} />
        <input className="input w-32" placeholder="Floor" value={q.floor} onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })} />
        <button 
          onClick={autoEvaluateAll} 
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          disabled={busy}
        >
          Auto-Evaluate All
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-200 rounded-lg">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Downstream</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Upstream</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Switchboard</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {pairs.map(pair => (
              <tr key={`${pair.downstream_id}-${pair.upstream_id}`} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-900">{pair.downstream_name} ({pair.downstream_type})</td>
                <td className="px-6 py-4 text-sm text-gray-900">{pair.upstream_name} ({pair.upstream_type})</td>
                <td className="px-6 py-4 text-sm text-gray-900">{pair.switchboard_name}</td>
                <td className="px-6 py-4 text-sm">
                  <button
                    onClick={() => handleCheck(pair.upstream_id, pair.downstream_id)}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    Check Selectivity
                  </button>
                  <a href={`/app/switchboards?edit=${pair.downstream_id}`} className="text-green-600 hover:underline">Edit</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Interactive Fault Test (if pair selected) */}
      {selectedPair && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">Test Specific Fault Current</h3>
          <div className="flex gap-2 items-center">
            <input
              type="range"
              min="100"
              max="10000"
              value={faultCurrent}
              onChange={e => setFaultCurrent(e.target.value)}
              className="flex-1"
            />
            <span className="text-sm">{faultCurrent} A</span>
            <button 
              onClick={testFaultCurrent} 
              className="px-3 py-1 bg-indigo-600 text-white rounded text-sm"
            >
              <Zap size={16} className="inline mr-1" /> Test
            </button>
          </div>
        </div>
      )}

      {/* Results Check */}
      {checkResult && (
        <div className="mt-8 p-6 bg-white rounded-lg border">
          <h2 className="text-xl font-semibold mb-4">Analysis Result</h2>
          <div className="flex items-center gap-2 mb-4">
            {checkResult.status === 'selective' ? <CheckCircle className="text-green-600" /> : <XCircle className="text-red-600" />}
            <span className="capitalize">{checkResult.status}</span>
          </div>
          {checkResult.missing?.length > 0 && (
            <div className="mb-4 text-yellow-600">
              <AlertTriangle className="inline mr-2" />
              Missing data: {checkResult.missing.join(', ')}
            </div>
          )}
          {checkResult.remediation?.length > 0 && (
            <ul className="list-disc pl-5 mb-4">
              {checkResult.remediation.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Graph Modal */}
      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="Time-Current Curves">
        <Line
          data={curveData}
          options={{
            responsive: true,
            scales: {
              x: { 
                type: 'logarithmic', 
                title: { display: true, text: 'Current (A)' },
                ticks: { callback: (value) => value.toFixed(0) + 'A' }
              },
              y: { 
                type: 'linear', 
                title: { display: true, text: 'Time (s)' },
                min: 0,
                ticks: { 
                  callback: (value) => value.toFixed(2) + 's',
                  maxTicksLimit: 10 
                }
              },
            },
            plugins: {
              tooltip: {
                callbacks: {
                  label: (context) => {
                    const nonSelective = context.datasetIndex === 1 && context.parsed.y >= curveData.datasets[0].data[context.dataIndex] * 1.05;
                    return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}s at ${context.parsed.x}A ${nonSelective ? '(Non-selective alert!)' : ''}`;
                  }
                }
              }
            }
          }}
        />
        <button 
          onClick={() => setShowGraph(false)} 
          className="mt-4 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        >
          Close Graph
        </button>
      </Modal>

      {/* Tip Modal */}
      <Modal open={showTipModal} onClose={() => setShowTipModal(false)} title="Explanation Tip">
        <p className="text-gray-700 whitespace-pre-wrap">{tipContent}</p>
        <HelpCircle className="text-blue-500 mt-2 inline" />
      </Modal>

      {toast && <Toast {...toast} />}
    </section>
  );
}
