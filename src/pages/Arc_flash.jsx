import { useEffect, useState, useRef } from 'react';
import { get, post } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Flame, Download, ChevronRight, Settings } from 'lucide-react';
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

// Register plugins
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

function Sidebar({ open, onClose, tipContent }) {
  if (!open) return null;
  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-40 overflow-y-auto p-6 transition-transform duration-300 ease-in-out transform translate-x-0">
      <button onClick={onClose} className="absolute top-4 right-4 p-1 hover:bg-gray-200 rounded">
        <X size={20} />
      </button>
      <h3 className="text-xl font-bold mb-4">Explanation Tip</h3>
      <p className="text-gray-700 whitespace-pre-wrap mb-4">{tipContent || 'No tip available'}</p>
      <HelpCircle className="text-blue-500 inline" size={24} />
    </div>
  );
}

export default function ArcFlash() {
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
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({ device_id: null, switchboard_id: null, working_distance: 455, enclosure_type: 'VCB', electrode_gap: 32, arcing_time: 0.2, fault_current_ka: null });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const chartRef = useRef(null);
  const pageSize = 18;

  useEffect(() => {
    loadPoints();
  }, [q]);

  const loadPoints = async () => {
    try {
      setBusy(true);
      const data = await get('/api/arcflash/points', q);
      setPoints(data?.data || []);
      setTotal(data?.total || 0);
      const initialStatuses = {};
      data?.data.forEach(point => {
        if (point.status) {
          initialStatuses[point.device_id] = point.status;
        }
      });
      setStatuses(initialStatuses);
    } catch (e) {
      setToast({ msg: `Failed to load points: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async (deviceId, switchboardId, isBatch = false) => {
    try {
      setBusy(true);
      const params = { device: deviceId, switchboard: switchboardId };
      const result = await get('/api/arcflash/check', params);
      setCheckResult(result);
      setSelectedPoint({ deviceId, switchboardId });
      setStatuses(prev => ({ ...prev, [`${deviceId}`]: result.status }));

      const curves = await get('/api/arcflash/curves', params);
      const validData = curves.curve.map(p => p.energy).filter(v => !isNaN(v) && v > 0);
      const datasets = {
        labels: curves.curve.map(p => p.distance.toFixed(0)),
        datasets: [
          { label: 'Incident Energy (cal/cm²)', data: validData.length ? validData : [1, 2, 3], borderColor: 'orange', tension: 0.1, pointRadius: 0 },
        ],
      };
      setCurveData(datasets);
      setShowGraph(true);

      try {
        const tipRes = await post('/api/arcflash/ai-tip', { 
          query: `Explain why this point is ${result.status}: incident_energy: ${result.incident_energy || 'general'}, ppe: ${result.ppe_category}` 
        });
        setTipContent(tipRes.tip || 'No tip available');
      } catch (tipError) {
        console.error('AI tip failed:', tipError.message);
        setTipContent('Failed to load AI tip');
      }
      setShowSidebar(true);

      if (result.status === 'safe' && !isBatch) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
      }
    } catch (e) {
      setToast({ msg: `Check failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleBatchCheck = async () => {
    try {
      setBusy(true);
      for (const { device_id, switchboard_id } of selectedPoints) {
        await handleCheck(device_id, switchboard_id, true);
      }
      setToast({ msg: 'Batch check completed', type: 'success' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Batch failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
      setSelectedPoints([]);
    }
  };

  const saveParameters = async () => {
    try {
      setBusy(true);
      await post('/api/arcflash/parameters', { ...paramForm, site });
      setToast({ msg: 'Parameters saved', type: 'success' });
      setShowParamsModal(false);
      loadPoints();
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    try {
      setBusy(true);
      await post('/api/arcflash/reset');
      setToast({ msg: 'Data reset', type: 'info' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Reset failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async () => {
    const canvas = await html2canvas(chartRef.current);
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF();
    pdf.addImage(imgData, 'PNG', 10, 10, 180, 160);
    pdf.save('arcflash-report.pdf');
  };

  const toggleSelect = (point) => {
    setSelectedPoints(prev => 
      prev.some(p => p.device_id === point.device_id) 
        ? prev.filter(p => p.device_id !== point.device_id)
        : [...prev, { device_id: point.device_id, switchboard_id: point.switchboard_id }]
    );
  };

  const openParams = (point) => {
    setParamForm({
      device_id: point.device_id,
      switchboard_id: point.switchboard_id,
      working_distance: point.working_distance || 455,
      enclosure_type: point.enclosure_type || 'VCB',
      electrode_gap: point.electrode_gap || 32,
      arcing_time: point.arcing_time || 0.2,
      fault_current_ka: point.fault_current_ka || point.icu_ka,
    });
    setShowParamsModal(true);
  };

  return (
    <section className="container-narrow py-10">
      {showConfetti && <Confetti />}
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">
        <Flame className="text-orange-600" /> Arc Flash Analysis
      </h1>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            className="input pl-10 w-full"
            placeholder="Search devices or switchboards..."
            value={q.q}
            onChange={e => setQ({ ...q, q: e.target.value, page: 1 })}
          />
        </div>
        <input className="input flex-1" placeholder="Switchboard ID" value={q.switchboard} onChange={e => setQ({ ...q, switchboard: e.target.value, page: 1 })} />
        <input className="input flex-1" placeholder="Building" value={q.building} onChange={e => setQ({ ...q, building: e.target.value, page: 1 })} />
        <input className="input flex-1" placeholder="Floor" value={q.floor} onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })} />
      </div>

      {/* Points Table */}
      <div className="overflow-x-auto rounded-lg shadow-md">
        <table className="w-full bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-left"><input type="checkbox" onChange={e => setSelectedPoints(e.target.checked ? points.map(p => ({ device_id: p.device_id, switchboard_id: p.switchboard_id })) : []) } /></th>
              <th className="p-3 text-left">Device</th>
              <th className="p-3 text-left">Switchboard</th>
              <th className="p-3 text-left">Building/Floor</th>
              <th className="p-3 text-left">Voltage (V)</th>
              <th className="p-3 text-left">Icu (kA)</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {points.map(point => {
              const status = statuses[point.device_id];
              const color = status === 'safe' ? 'text-green-600' : status === 'at-risk' ? 'text-red-600' : 'text-yellow-600';
              return (
                <tr key={point.device_id} className="border-t hover:bg-gray-50">
                  <td className="p-3"><input type="checkbox" checked={selectedPoints.some(p => p.device_id === point.device_id)} onChange={() => toggleSelect(point)} /></td>
                  <td className="p-3">{point.device_name || 'Unnamed'} ({point.device_type})</td>
                  <td className="p-3">{point.switchboard_name}</td>
                  <td className="p-3">{point.building_code}/{point.floor}</td>
                  <td className="p-3">{point.voltage_v}</td>
                  <td className="p-3">{point.icu_ka}</td>
                  <td className="p-3">
                    <span className={`font-medium ${color}`}>
                      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unchecked'}
                    </span>
                  </td>
                  <td className="p-3 flex gap-2">
                    <button onClick={() => handleCheck(point.device_id, point.switchboard_id)} className="btn-small">Check</button>
                    <button onClick={() => openParams(point)} className="btn-small flex items-center gap-1"><Settings size={14} /> Params</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination & Batch */}
      <div className="flex justify-between mt-4">
        <button onClick={() => setQ({ ...q, page: Math.max(1, q.page - 1) })} disabled={q.page === 1} className="btn">Previous</button>
        <span>Page {q.page} of {Math.ceil(total / pageSize)}</span>
        <button onClick={() => setQ({ ...q, page: q.page + 1 })} disabled={q.page >= Math.ceil(total / pageSize)} className="btn">Next</button>
      </div>

      {selectedPoints.length > 0 && (
        <button 
          onClick={handleBatchCheck} 
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md transition-transform hover:scale-105"
          disabled={busy}
        >
          Check Selected ({selectedPoints.length})
        </button>
      )}

      {/* Results */}
      {checkResult && (
        <div className="mt-8 p-6 bg-white rounded-lg shadow-md transition-all duration-500 transform scale-100">
          <h2 className="text-2xl font-semibold mb-4 text-indigo-800">Analysis Result</h2>
          <div className="flex items-center gap-2 mb-4">
            {checkResult.status === 'safe' ? <CheckCircle className="text-green-600 animate-bounce" size={24} /> :
             checkResult.status === 'at-risk' ? <XCircle className="text-red-600" size={24} /> :
             <AlertTriangle className="text-yellow-600" size={24} />}
            <span className="text-xl capitalize">{checkResult.status}</span>
          </div>
          <p className="mb-2">Incident Energy: {checkResult.incident_energy} cal/cm²</p>
          <p className="mb-2">PPE Category: {checkResult.ppe_category}</p>
          {checkResult.missing?.length > 0 && (
            <div className="mb-4 text-yellow-600 flex items-center">
              <AlertTriangle className="mr-2" />
              Missing data: {checkResult.missing.join(', ')}. Please update in Switchboards or Parameters.
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

      {/* Parameters Modal */}
      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Edit Arc Flash Parameters">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Working Distance (mm)</label>
            <input
              type="number"
              value={paramForm.working_distance}
              onChange={e => setParamForm({ ...paramForm, working_distance: e.target.value })}
              className="input w-full"
              placeholder="Default: 455"
              min="100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Enclosure Type</label>
            <select
              value={paramForm.enclosure_type}
              onChange={e => setParamForm({ ...paramForm, enclosure_type: e.target.value })}
              className="input w-full"
            >
              <option value="VCB">VCB (Vertical Conductors in Box)</option>
              <option value="VCBB">VCBB (Vertical Conductors Bottom Box)</option>
              <option value="HCB">HCB (Horizontal Conductors in Box)</option>
              <option value="HOA">HOA (Horizontal Open Air)</option>
              <option value="VOA">VOA (Vertical Open Air)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Electrode Gap (mm)</label>
            <input
              type="number"
              value={paramForm.electrode_gap}
              onChange={e => setParamForm({ ...paramForm, electrode_gap: e.target.value })}
              className="input w-full"
              placeholder="Default: 32"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Arcing Time (s)</label>
            <input
              type="number"
              step="0.01"
              value={paramForm.arcing_time}
              onChange={e => setParamForm({ ...paramForm, arcing_time: e.target.value })}
              className="input w-full"
              placeholder="Default: 0.2 (from selectivity)"
              min="0.01"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Fault Current (kA)</label>
            <input
              type="number"
              value={paramForm.fault_current_ka}
              onChange={e => setParamForm({ ...paramForm, fault_current_ka: e.target.value })}
              className="input w-full"
              placeholder="From Fault Level or manual"
              min="1"
            />
          </div>
          <button
            onClick={saveParameters}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 w-full"
            disabled={busy}
          >
            Save Parameters
          </button>
        </div>
      </Modal>

      {/* Graph Modal */}
      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="Incident Energy Curves (Zoom & Pan Enabled)">
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
                    annotations: checkResult?.riskZones?.map((zone, i) => ({
                      type: 'box',
                      yMin: zone.min,
                      yMax: zone.max,
                      backgroundColor: 'rgba(255, 165, 0, 0.2)',
                      borderColor: 'orange',
                      label: { content: 'Risk Zone', display: true, position: 'center' }
                    })) || []
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)} cal/cm² at ${context.parsed.x}mm`
                    }
                  }
                },
                scales: {
                  x: { 
                    type: 'linear', 
                    title: { display: true, text: 'Working Distance (mm)' }
                  },
                  y: { 
                    type: 'logarithmic', 
                    title: { display: true, text: 'Incident Energy (cal/cm²)' },
                    min: 0.1,
                    max: 100,
                  },
                },
              }}
            />
          )}
        </div>
        <button 
          onClick={exportPdf} 
          className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
        >
          <Download size={16} /> Export PDF
        </button>
        <button 
          onClick={() => setShowGraph(false)} 
          className="mt-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        >
          Close Graph
        </button>
      </Modal>

      {/* Sidebar for Tips */}
      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)} tipContent={tipContent} />

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div>
      </div>}
    </section>
  );
}
