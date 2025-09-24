import { useEffect, useState, useRef } from 'react';
import { get, post } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Zap, Download, ChevronRight, Settings } from 'lucide-react';
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
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({ device_id: null, switchboard_id: null, line_length: 100, source_impedance: 0.1, phase_type: 'three' });
  const [liveTest, setLiveTest] = useState({ line_length: 100, source_impedance: 0.1 }); // For live slider
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
      const data = await get('/api/faultlevel/points', q);
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

  const handleCheck = async (deviceId, switchboardId, phaseType = 'three', testParams = null, isBatch = false) => {
    try {
      setBusy(true);
      const params = { 
        device: deviceId, 
        switchboard: switchboardId, 
        phase_type: phaseType,
        ...(testParams || {}) // Override for live test
      };
      const result = await get('/api/faultlevel/check', params);
      setCheckResult(result);
      setSelectedPoint({ deviceId, switchboardId, phaseType });
      setStatuses(prev => ({ ...prev, [`${deviceId}`]: result.status }));

      const curves = await get('/api/faultlevel/curves', params);
      const datasets = {
        labels: curves.curve.map(p => p.line_length.toFixed(0)),
        datasets: [
          { 
            label: 'Fault Current (kA)', 
            data: curves.curve.map(p => p.fault_ka), 
            borderColor: 'red', 
            tension: 0.1, 
            pointRadius: 2, // Visible points
            fill: false
          },
        ],
      };
      setCurveData(datasets);
      setShowGraph(true);

      console.log('[FLA UI] Check result:', result); // Debug

      try {
        const tipRes = await post('/api/faultlevel/ai-tip', { 
          query: `Explain why this point is ${result.status}: device ${deviceId}, fault_level: ${result.fault_level_ka || 'general'}, phase_type: ${phaseType}` 
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

  const handleLiveTest = (newParams) => {
    setLiveTest(newParams);
    if (selectedPoint) {
      handleCheck(selectedPoint.deviceId, selectedPoint.switchboardId, selectedPoint.phaseType, newParams);
    }
  };

  const handleBatchCheck = async () => {
    try {
      setBusy(true);
      for (const id of selectedPoints) {
        const point = points.find(p => p.device_id === id);
        if (point) await handleCheck(point.device_id, point.switchboard_id, point.phase_type || 'three', true);
      }
      setToast({ msg: 'Batch check completed!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Batch check failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
      setSelectedPoints([]);
    }
  };

  const autoEvaluateAll = async () => {
    try {
      setBusy(true);
      const results = [];
      for (const point of points.slice(0, 10)) {
        const res = await get('/api/faultlevel/check', { 
          device: point.device_id, 
          switchboard: point.switchboard_id, 
          phase_type: point.phase_type || 'three' 
        });
        results.push({ point: point.device_name, status: res.status });
        setStatuses(prev => ({ ...prev, [`${point.device_id}`]: res.status }));
      }
      const safe = results.filter(r => r.status === 'safe').length;
      setToast({ 
        msg: `${safe}/${results.length} points safe.`, 
        type: safe === results.length ? 'success' : 'info' 
      });
      if (safe === results.length) setShowConfetti(true);
    } catch (e) {
      setToast({ msg: `Auto-evaluation failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const openParamsModal = (point) => {
    setParamForm({
      device_id: point.device_id,
      switchboard_id: point.switchboard_id,
      line_length: point.line_length || 100,
      source_impedance: point.source_impedance || 0.1,
      phase_type: point.phase_type || (point.poles && [1, 2].includes(point.poles) ? 'single' : 'three')
    });
    setShowParamsModal(true);
  };

  const saveParameters = async () => {
    try {
      setBusy(true);
      const { device_id, switchboard_id, line_length, source_impedance, phase_type } = paramForm;
      if (!device_id || !switchboard_id) {
        setToast({ msg: 'Missing device or switchboard ID', type: 'error' });
        return;
      }
      if (isNaN(line_length) || line_length <= 0) {
        setToast({ msg: 'Invalid line length', type: 'error' });
        return;
      }
      if (isNaN(source_impedance) || source_impedance <= 0) {
        setToast({ msg: 'Invalid source impedance', type: 'error' });
        return;
      }
      if (!['three', 'single'].includes(phase_type)) {
        setToast({ msg: 'Invalid phase type', type: 'error' });
        return;
      }
      await post('/api/faultlevel/parameters', { device_id, switchboard_id, line_length, source_impedance, phase_type });
      setToast({ msg: 'Parameters saved!', type: 'success' });
      setShowParamsModal(false);
      loadPoints(); // Refresh
    } catch (e) {
      setToast({ msg: `Failed to save parameters: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const exportPDF = async () => {
    // ... (same as before, but with dynamic scales)
    const pdf = new jsPDF();
    // ... (omit for brevity, use previous version)
    pdf.save('fault_level_report.pdf');
  };

  const toggleSelect = (id) => {
    setSelectedPoints(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelectedPoints(selectedPoints.length === points.length ? [] : points.map(p => p.device_id));
  };

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      {/* ... (header and filters same) */}

      {/* Table same, but no Edit button */}

      {/* Live Test Section (after table, if selectedPoint) */}
      {selectedPoint && (
        <div className="mt-6 p-6 bg-white rounded-lg shadow-md">
          <h3 className="font-semibold mb-2 text-lg">Live Test Parameters</h3>
          <p className="text-sm text-gray-500 mb-4">Adjust line length and source impedance to see real-time changes in fault level. Graph updates automatically.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium">Line Length (m)</label>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={liveTest.line_length}
                onChange={e => handleLiveTest({ ...liveTest, line_length: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
              <span>{liveTest.line_length} m</span>
            </div>
            <div>
              <label className="block text-sm font-medium">Source Impedance (Ω)</label>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={liveTest.source_impedance}
                onChange={e => handleLiveTest({ ...liveTest, source_impedance: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
              <span>{liveTest.source_impedance} Ω</span>
            </div>
            <div>
              <label className="block text-sm font-medium">Phase Type</label>
              <select
                value={selectedPoint.phaseType}
                onChange={e => handleCheck(selectedPoint.deviceId, selectedPoint.switchboardId, e.target.value)}
                className="input w-full"
              >
                <option value="three">Three-Phase</option>
                <option value="single">Single-Phase</option>
              </select>
            </div>
          </div>
          {checkResult && checkResult.details && (
            <p className="text-sm text-blue-600">Calculated Ik: {checkResult.details.calculated_ik} kA (using {checkResult.details.used_line_length}m, {checkResult.details.used_source_impedance}Ω)</p>
          )}
          {checkResult && !checkResult.riskZones.length && (
            <p className="text-sm text-yellow-600 mt-2">Tip: Try lower impedance or shorter line for higher Ik and visible changes.</p>
          )}
        </div>
      )}

      {/* Results, Modals, Sidebar same as before, but graph options with dynamic scales */}
      {checkResult && (
        // ... (same)
      )}

      {/* Graph Modal with dynamic scales */}
      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="Fault Current Curves (Zoom & Pan Enabled)">
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
                      backgroundColor: 'rgba(255, 0, 0, 0.2)',
                      borderColor: 'red',
                      label: { content: 'Risk Zone', display: true, position: 'center' }
                    })) || []
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)}kA at ${context.parsed.x}m`
                    }
                  }
                },
                scales: {
                  x: { 
                    type: 'linear', 
                    title: { display: true, text: 'Line Length (m)' },
                    min: 0,
                    max: 550
                  },
                  y: { 
                    type: 'logarithmic', 
                    title: { display: true, text: 'Fault Current (kA)' },
                    min: Math.min(...curveData.datasets[0].data) / 2 || 0.1,
                    max: Math.max(...curveData.datasets[0].data) * 2 || 100,
                  },
                },
              }}
            />
          )}
        </div>
        <button onClick={() => setShowGraph(false)} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
          Close Graph
        </button>
      </Modal>

      {/* Other modals and sidebar same */}
      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div>
      </div>}
    </section>
  );
}
