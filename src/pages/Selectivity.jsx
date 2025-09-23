// src/pages/Selectivity.jsx
import { useEffect, useState } from 'react';
import { get } from '../lib/api.js';
import { api } from '../lib/api.js'; // Utilise la nouvelle section selectivity
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
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
  LogarithmicScale,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, LogarithmicScale);

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

export default function Selectivity() {
  const site = useUserSite();
  const [pairs, setPairs] = useState([]);
  const [q, setQ] = useState({ q: '', switchboard: '', building: '', floor: '', sort: 'name', dir: 'desc', page: 1 });
  const [total, setTotal] = useState(0);
  const [selectedPair, setSelectedPair] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [curveData, setCurveData] = useState(null);
  const [aiTip, setAiTip] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const pageSize = 18;

  useEffect(() => {
    loadPairs();
  }, [q]);

  const loadPairs = async () => {
    try {
      if (!site) return;
      setBusy(true);
      const data = await api.selectivity.listPairs(q);
      setPairs(data?.data || []);
      setTotal(data?.total || 0);
    } catch (e) {
      setToast({ msg: 'Failed to load pairs', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async (upstreamId, downstreamId) => {
    try {
      setBusy(true);
      const result = await api.selectivity.checkPair(upstreamId, downstreamId);
      setCheckResult(result);
      const curves = await api.selectivity.getCurves(upstreamId, downstreamId);
      setCurveData({
        labels: curves.upstream.map(p => p.current),
        datasets: [
          { label: 'Upstream', data: curves.upstream.map(p => p.time), borderColor: 'blue' },
          { label: 'Downstream', data: curves.downstream.map(p => p.time), borderColor: 'green' },
        ],
      });
      if (result.status === 'non-selective') {
        const tip = await api.selectivity.getAiTip({ query: `Remediation for non-selective pair: upstream ${upstreamId}, downstream ${downstreamId}` });
        setAiTip(tip.tip);
      }
    } catch (e) {
      setToast({ msg: 'Check failed', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Selectivity Analysis</h1>
        <p className="text-gray-600 max-w-3xl">
          Cette page vérifie la sélectivité entre disjoncteurs amont et aval basée sur les données des switchboards. 
          La sélectivité assure que seul le disjoncteur aval déclenche en cas de défaut, évitant des coupures inutiles (normes IEC 60947-2, 60898-1). 
          Les liens amont/aval sont définis via parent_id dans les devices. Utilisez les filtres pour cibler, visualisez les courbes temps-courant, 
          et obtenez des remédiations si non-sélectif. Si données manquantes, éditez via la page Switchboards.
        </p>
      </header>

      {/* Filtres */}
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
      </div>

      {/* Tableau */}
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
                    className="text-blue-600 hover:underline"
                  >
                    Check Selectivity
                  </button>
                  <a href={`/app/switchboards?edit=${pair.downstream_id}`} className="ml-4 text-green-600 hover:underline">Edit</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Résultats Check */}
      {checkResult && (
        <div className="mt-8 p-6 bg-white rounded-lg border">
          <h2 className="text-xl font-semibold mb-4">Analysis Result</h2>
          <div className="flex items-center gap-2 mb-4">
            {checkResult.status === 'selective' ? <CheckCircle className="text-green-600" /> : <XCircle className="text-red-600" />}
            <span>{checkResult.status.toUpperCase()}</span>
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
          {aiTip && <p className="text-gray-600 italic">AI Tip: {aiTip}</p>}
        </div>
      )}

      {/* Graphique */}
      {curveData && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Time-Current Curves</h2>
          <Line
            data={curveData}
            options={{
              scales: {
                x: { type: 'logarithmic', title: { display: true, text: 'Current (A)' } },
                y: { type: 'logarithmic', title: { display: true, text: 'Time (s)' } },
              },
            }}
          />
        </div>
      )}

      {toast && <Toast {...toast} />}
    </section>
  );
}
