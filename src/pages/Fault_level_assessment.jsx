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

  const handleCheck = async (deviceId, switchboardId, phaseType = 'three', isBatch = false) => {
    try {
      setBusy(true);
      const params = { device: deviceId, switchboard: switchboardId, phase_type: phaseType };
      const result = await get('/api/faultlevel/check', params);
      setCheckResult(result);
      setSelectedPoint({ deviceId, switchboardId, phaseType });
      setStatuses(prev => ({ ...prev, [`${deviceId}`]: result.status }));

      const curves = await get('/api/faultlevel/curves', params);
      const validData = curves.curve.map(p => p.fault_ka).filter(v => !isNaN(v) && v > 0);
      const datasets = {
        labels: curves.curve.map(p => p.line_length.toFixed(0)),
        datasets: [
          { label: 'Fault Current (kA)', data: validData.length ? validData : [1, 2, 3], borderColor: 'red', tension: 0.1, pointRadius: 0 },
        ],
      };
      setCurveData(datasets);
      setShowGraph(true);

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
      setToast({ msg: 'Parameters saved! Refreshing data...', type: 'success' });
      setShowParamsModal(false);
      // Force refresh after 500ms to ensure DB update
      setTimeout(() => loadPoints(), 500);
    } catch (e) {
      setToast({ msg: `Failed to save parameters: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const exportPDF = async () => {
    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text('Fault Level Report', 10, 10);
    pdf.setFontSize(12);
    pdf.text(`Date: ${new Date().toLocaleString()}`, 10, 20);
    
    // Table of points
    pdf.text('Points Status:', 10, 30);
    let y = 40;
    points.forEach(point => {
      const status = statuses[point.device_id] || 'Pending';
      pdf.text(`${point.device_name} in ${point.switchboard_name}: ${status} (${point.fault_level_ka || 'N/A'} kA)`, 10, y);
      y += 10;
    });

    // Graphs for checked points
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    let chartInstance = null;

    for (const point of points.filter(p => statuses[p.device_id])) {
      try {
        const curves = await get('/api/faultlevel/curves', {
          device: point.device_id,
          switchboard: point.switchboard_id,
          phase_type: point.phase_type || 'three'
        });
        const data = {
          labels: curves.curve.map(p => p.line_length.toFixed(0)),
          datasets: [
            { label: 'Fault Current (kA)', data: curves.curve.map(p => p.fault_ka).filter(v => !isNaN(v) && v > 0), borderColor: 'red', tension: 0.1, pointRadius: 0 },
          ],
        };
        const status = statuses[point.device_id];
        const riskZones = status === 'at-risk' ? (await get('/api/faultlevel/check', {
          device: point.device_id,
          switchboard: point.switchboard_id,
          phase_type: point.phase_type || 'three'
        })).riskZones : [];

        pdf.addPage();
        pdf.setFontSize(14);
        pdf.text(`Fault Curve for Point: ${point.device_name} (${point.phase_type})`, 10, 10);
        pdf.setFontSize(12);
        pdf.text(`Status: ${status}`, 10, 20);

        chartInstance = new ChartJS(ctx, {
          type: 'line',
          data: data,
          options: {
            responsive: false,
            plugins: {
              annotation: {
                annotations: riskZones.map((zone, i) => ({
                  type: 'box',
                  yMin: zone.min,
                  yMax: zone.max,
                  backgroundColor: 'rgba(255, 0, 0, 0.2)',
                  borderColor: 'red',
                  label: { content: 'Risk Zone', display: true, position: 'center' }
                }))
              },
              title: { display: true, text: `Curve: ${point.device_name} (${point.phase_type})` },
              tooltip: {
                callbacks: {
                  label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)}kA at ${context.parsed.x}m`
                }
              }
            },
            scales: {
              x: { 
                type: 'linear', 
                title: { display: true, text: 'Line Length (m)' }
              },
              y: { 
                type: 'logarithmic', 
                title: { display: true, text: 'Fault Current (kA)' },
                min: 0.1,
                max: 100,
              },
            },
          }
        });

        await new Promise(resolve => setTimeout(resolve, 500));
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 10, 30, 180, 100);
        chartInstance.destroy();
      } catch (e) {
        console.error('Failed to generate chart for PDF:', e.message);
        pdf.text('Error generating curve', 10, 30);
      }
    }

    canvas.remove();
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
      {showConfetti && <Confetti width={window.innerWidth} height={window.innerHeight} />}
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4 drop-shadow-md">Fault Level Assessment</h1>
        <p className="text-gray-600 max-w-3xl">
          This page calculates short-circuit fault levels (Ik) for devices in switchboards per IEC 60909-0. 
          It supports three-phase and single-phase faults, comparing Ik to Icu/Ics ratings. 
          Data like voltage and Icu are auto-filled from switchboards; edit line length and source impedance below. 
          View curves and get AI remediations.
        </p>
      </header>

      {/* Filters */}
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

      {/* Table */}
      <div className="overflow-x-auto shadow-xl rounded-lg">
        <table className="min-w-full bg-white border border-gray-200 rounded-lg">
          <thead className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">
                <input type="checkbox" onChange={toggleSelectAll} checked={selectedPoints.length === points.length} />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Device</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Switchboard</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Voltage (V)</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Line Length (m)</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Source Impedance (Ω)</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Phase Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {points.map(point => (
              <tr key={point.device_id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <input 
                    type="checkbox" 
                    checked={selectedPoints.includes(point.device_id)} 
                    onChange={() => toggleSelect(point.device_id)} 
                  />
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">{point.device_name} ({point.device_type})</td>
                <td className="px-6 py-4 text-sm text-gray-900">{point.switchboard_name}</td>
                <td className="px-6 py-4 text-sm text-gray-900">{point.voltage_v} V</td>
                <td className="px-6 py-4 text-sm text-gray-900">{point.line_length} m</td>
                <td className="px-6 py-4 text-sm text-gray-900">{point.source_impedance} Ω</td>
                <td className="px-6 py-4 text-sm text-gray-900">{point.phase_type}</td>
                <td className="px-6 py-4 text-sm">
                  {statuses[point.device_id] === 'safe' ? <CheckCircle className="text-green-600" /> :
                   statuses[point.device_id] === 'at-risk' ? <XCircle className="text-red-600" /> :
                   statuses[point.device_id] === 'incomplete' ? <AlertTriangle className="text-yellow-600" /> : 'Pending'}
                </td>
                <td className="px-6 py-4 text-sm">
                  <button
                    onClick={() => handleCheck(point.device_id, point.switchboard_id, point.phase_type)}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    Check
                  </button>
                  <button
                    onClick={() => openParamsModal(point)}
                    className="text-purple-600 hover:underline"
                  >
                    <Settings size={16} className="inline mr-1" /> Parameters
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <p className="mb-2">Fault Level: {checkResult.fault_level_ka} kA</p>
          {checkResult.missing?.length > 0 && (
            <div className="mb-4 text-yellow-600 flex items-center">
              <AlertTriangle className="mr-2" />
              Missing data: {checkResult.missing.join(', ')}. Please update voltage or Icu in the Switchboards page.
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
      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Edit Fault Parameters">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Line Length (m)</label>
            <input
              type="number"
              value={paramForm.line_length}
              onChange={e => setParamForm({ ...paramForm, line_length: e.target.value })}
              className="input w-full"
              placeholder="Default: 100"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Source Impedance (Ω)</label>
            <input
              type="number"
              step="0.01"
              value={paramForm.source_impedance}
              onChange={e => setParamForm({ ...paramForm, source_impedance: e.target.value })}
              className="input w-full"
              placeholder="Default: 0.1"
              min="0.01"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Phase Type</label>
            <select
              value={paramForm.phase_type}
              onChange={e => setParamForm({ ...paramForm, phase_type: e.target.value })}
              className="input w-full"
            >
              <option value="three">Three-Phase</option>
              <option value="single">Single-Phase</option>
            </select>
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
                    title: { display: true, text: 'Line Length (m)' }
                  },
                  y: { 
                    type: 'logarithmic', 
                    title: { display: true, text: 'Fault Current (kA)' },
                    min: 0.1,
                    max: 100,
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
      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)} tipContent={tipContent} />

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div>
      </div>}
    </section>
  );
}
