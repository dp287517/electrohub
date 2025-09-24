// src/pages/FaultLevelAssessment.jsx
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

export default function FaultLevelAssessment() {
  const site = useUserSite();
  const [points, setPoints] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [selectedPoints, setSelectedPoints] = useState([]);
  const [q, setQ] = useState({ q: '', switchboard: '', building: '', floor: '', sort: 'name', dir: 'desc', page: 1 });
  const [total, setTotal] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [curveData, setCurveData] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [faultType, setFaultType] = useState('3ph'); // '3ph' or '1ph'
  const [showConfetti, setShowConfetti] = useState(false);
  const chartRef = useRef(null);
  const pageSize = 18;

  useEffect(() => {
    loadPoints();
  }, [q]);

  const loadPoints = async () => {
    try {
      setBusy(true);
      const data = await get('/api/fla/points', q);
      setPoints(data?.data || []);
      setTotal(data?.total || 0);
      const initialStatuses = {};
      data?.data.forEach(point => {
        if (point.status) {
          initialStatuses[point.switchboard_id || point.device_id] = point.status;
        }
      });
      setStatuses(initialStatuses);
    } catch (e) {
      setToast({ msg: 'Failed to load points', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async (pointId, pointType, isBatch = false) => {
    try {
      setBusy(true);
      const params = { point: pointId, type: pointType, fault_type: faultType };
      const result = await get('/api/fla/check', params);
      setCheckResult(result);
      setSelectedPoint({ pointId, pointType });
      setStatuses(prev => ({ ...prev, [pointId]: result.status }));

      const curves = await get('/api/fla/curves', params);
      const datasets = {
        labels: curves.curve.map(p => p.impedance.toFixed(2)),
        datasets: [
          { label: 'Fault Current (kA)', data: curves.curve.map(p => p.ik), borderColor: 'red', tension: 0.1, pointRadius: 0 },
        ],
      };
      setCurveData(datasets);
      setShowGraph(true);

      const tipRes = await post('/api/fla/ai-tip', { 
        query: `Explain why this point is ${result.status}: ${pointType} ${pointId}, fault_type: ${faultType}` 
      });
      setTipContent(tipRes.tip);
      setShowSidebar(true);

      if (result.status === 'safe' && !isBatch) {
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
      for (const point of selectedPoints) {
        await handleCheck(point.pointId, point.pointType, true);
      }
      setToast({ msg: 'Batch check completed', type: 'success' });
      loadPoints();
    } catch (e) {
      setToast({ msg: 'Batch check failed', type: 'error' });
    } finally {
      setBusy(false);
      setSelectedPoints([]);
    }
  };

  const handleExport = async () => {
    try {
      const canvas = await html2canvas(chartRef.current);
      const img = canvas.toDataURL('image/png');
      const pdf = new jsPDF();
      pdf.addImage(img, 'PNG', 10, 10, 180, 160);
      pdf.save('fla_report.pdf');
    } catch (e) {
      setToast({ msg: 'Export failed', type: 'error' });
    }
  };

  const toggleSelect = (point) => {
    const id = point.switchboard_id || point.device_id;
    const type = point.switchboard_id ? 'switchboard' : 'device';
    setSelectedPoints(prev => 
      prev.some(p => p.pointId === id) 
        ? prev.filter(p => p.pointId !== id)
        : [...prev, { pointId: id, pointType: type }]
    );
  };

  const toggleAll = () => {
    if (selectedPoints.length === points.length) {
      setSelectedPoints([]);
    } else {
      setSelectedPoints(points.map(point => ({
        pointId: point.switchboard_id || point.device_id,
        pointType: point.switchboard_id ? 'switchboard' : 'device'
      })));
    }
  };

  return (
    <section className="container mx-auto p-6">
      {showConfetti && <Confetti />}

      {/* Search & Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search points..."
            value={q.q}
            onChange={e => setQ(prev => ({ ...prev, q: e.target.value, page: 1 }))}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:border-indigo-500"
          />
        </div>
        <select 
          value={faultType}
          onChange={e => setFaultType(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="3ph">Triphasé (3ph)</option>
          <option value="1ph">Monophasé (1ph)</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow-md">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left">
                <input 
                  type="checkbox" 
                  checked={selectedPoints.length === points.length && points.length > 0}
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="px-6 py-3 text-left">Point</th>
              <th className="px-6 py-3 text-left">Type</th>
              <th className="px-6 py-3 text-left">Location</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {points.map(point => {
              const id = point.switchboard_id || point.device_id;
              const type = point.switchboard_id ? 'Switchboard' : 'Device';
              const name = point.switchboard_name || point.device_name;
              return (
                <tr key={id} className="border-t">
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox" 
                      checked={selectedPoints.some(p => p.pointId === id)}
                      onChange={() => toggleSelect(point)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-6 py-4">{name}</td>
                  <td className="px-6 py-4">{type}</td>
                  <td className="px-6 py-4">{point.building_code} / {point.floor}</td>
                  <td className="px-6 py-4">
                    {statuses[id] === 'safe' ? <CheckCircle className="text-green-600" size={20} /> :
                     statuses[id] === 'unsafe' ? <XCircle className="text-red-600" size={20} /> :
                     <AlertTriangle className="text-yellow-600" size={20} />}
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => handleCheck(id, point.switchboard_id ? 'switchboard' : 'device')}
                      className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                    >
                      Check
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex justify-between">
        <button 
          disabled={q.page === 1} 
          onClick={() => setQ(prev => ({ ...prev, page: prev.page - 1 }))}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Previous
        </button>
        <span>Page {q.page} of {Math.ceil(total / pageSize)}</span>
        <button 
          disabled={q.page * pageSize >= total} 
          onClick={() => setQ(prev => ({ ...prev, page: prev.page + 1 }))}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {/* Batch Actions */}
      {selectedPoints.length > 0 && (
        <div className="mt-4 flex gap-4">
          <button 
            onClick={handleBatchCheck}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Check Selected ({selectedPoints.length})
          </button>
        </div>
      )}

      {/* Results */}
      {checkResult && (
        <div className="mt-8 p-6 bg-white rounded-lg shadow-md transition-all duration-500 transform scale-100">
          <h2 className="text-2xl font-semibold mb-4 text-indigo-800">Analysis Result</h2>
          <div className="flex items-center gap-2 mb-4">
            {checkResult.status === 'safe' ? <CheckCircle className="text-green-600 animate-bounce" size={24} /> :
             checkResult.status === 'unsafe' ? <XCircle className="text-red-600" size={24} /> :
             <AlertTriangle className="text-yellow-600" size={24} />}
            <span className="text-xl capitalize">{checkResult.status}</span>
          </div>
          <p>Ik": {checkResult.ik.toFixed(2)} A | Ip: {checkResult.ip.toFixed(2)} A</p>
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
      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="Fault Level Curves (Zoom & Pan Enabled)">
        <div ref={chartRef}>
          {curveData && (
            <Line
              data={curveData}
              options={{
                responsive: true,
                plugins: {
                  zoom: {
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
                    pan: { enabled: true, mode: 'xy' },
                  },
                  annotation: {
                    annotations: checkResult?.criticalZones?.map((zone, i) => ({
                      type: 'box',
                      yMin: zone.min / 1000,
                      yMax: zone.max / 1000,
                      backgroundColor: 'rgba(255, 0, 0, 0.2)',
                      borderColor: 'red',
                      label: { content: 'Critical', display: true, position: 'center' }
                    })) || []
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)} kA at Z=${context.parsed.x} Ω`
                    }
                  }
                },
                scales: {
                  x: { 
                    type: 'logarithmic', 
                    title: { display: true, text: 'Impedance (Ω)' },
                    ticks: { callback: (value) => Number(value).toFixed(2) + 'Ω' }
                  },
                  y: { 
                    type: 'linear', 
                    title: { display: true, text: 'Fault Current (kA)' },
                    min: 0,
                    ticks: { callback: (value) => Number(value).toFixed(2) + 'kA' }
                  },
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
