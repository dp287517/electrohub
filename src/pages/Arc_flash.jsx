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
  const [paramForm, setParamForm] = useState({ device_id: null, switchboard_id: null, working_distance: 455, enclosure_type: 'VCB', electrode_gap: 32, arcing_time: 0.2, fault_current_ka: null, settings: {}, parent_id: null });
  const [paramTips, setParamTips] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const chartRef = useRef(null);
  const resultRef = useRef(null);
  const pageSize = 18;

  useEffect(() => {
    loadPoints();
  }, [q]);

  const loadPoints = async () => {
    try {
      setBusy(true);
      const params = {
        ...q,
        switchboard: isNaN(Number(q.switchboard)) ? '' : q.switchboard, // Prevent NaN
      };
      const data = await get('/api/arcflash/points', params);
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

  const handleAutofill = async () => {
    try {
      setBusy(true);
      const result = await post('/api/arcflash/autofill', { site });
      setToast({ msg: result.message, type: 'success' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Autofill failed: ${e.message || 'Server endpoint not found'}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async (deviceId, switchboardId, isBatch = false) => {
    try {
      setBusy(true);
      if (!deviceId || !switchboardId) throw new Error('Missing device or switchboard ID');
      const params = { device: deviceId, switchboard: switchboardId };
      const result = await get('/api/arcflash/check', params);
      setCheckResult(result);
      setSelectedPoint({ deviceId, switchboardId });
      setStatuses(prev => ({ ...prev, [`${deviceId}`]: result.status }));
      setParamTips(result.paramTips || {});

      const curves = await get('/api/arcflash/curves', params);
      const validData = curves.curve.map(p => p.energy).filter(v => !isNaN(v) && v > 0);
      const datasets = {
        labels: curves.curve.map(p => p.distance.toFixed(0)),
        datasets: [
          { label: 'Incident Energy (cal/cm²)', data: validData.length ? validData : [0.1, 0.2, 0.3], borderColor: 'orange', tension: 0.1, pointRadius: 0 },
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
        if (device_id && switchboard_id) {
          await handleCheck(device_id, switchboard_id, true);
        }
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
      if (!paramForm.device_id || !paramForm.switchboard_id) {
        throw new Error('Device ID or Switchboard ID is missing');
      }
      const result = await post('/api/arcflash/parameters', { ...paramForm, site });
      setToast({ msg: result.message, type: 'success' });
      setParamTips(result.tips || {});
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
      await post('/api/arcflash/reset', { site });
      setToast({ msg: 'Data reset', type: 'info' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Reset failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async (isLabel = false) => {
    if (!checkResult || !curveData) {
      setToast({ msg: 'No results or graph to export. Run a check first.', type: 'error' });
      return;
    }

    try {
      setBusy(true);
      const pdf = new jsPDF();

      // Capture graph
      const chartCanvas = chartRef.current?.canvas;
      if (!chartCanvas) {
        setToast({ msg: 'Graph not rendered. Try again.', type: 'error' });
        return;
      }
      const graphImg = chartCanvas.toDataURL('image/png');

      // Capture result section
      const resultElement = resultRef.current;
      if (!resultElement) {
        setToast({ msg: 'Results not rendered. Try again.', type: 'error' });
        return;
      }
      const resultCanvas = await html2canvas(resultElement, { scale: 2 });
      const resultImg = resultCanvas.toDataURL('image/png');

      if (isLabel) {
        pdf.setFontSize(18);
        pdf.text('Arc Flash Label', 20, 20);
        pdf.setFontSize(12);
        pdf.text(`Device: ${selectedPoint?.deviceId} - Switchboard: ${selectedPoint?.switchboardId}`, 20, 40);
        pdf.text(`Incident Energy: ${checkResult?.incident_energy} cal/cm²`, 20, 50);
        pdf.text(`PPE Category: ${checkResult?.ppe_category} (IEC 61482 compliant)`, 20, 60);
        pdf.text('Required PPE: Arc-rated clothing, gloves, face shield', 20, 70);
        pdf.text('Warning: High Arc Flash Risk - Maintain Safe Distance', 20, 80);
        pdf.addImage(resultImg, 'PNG', 20, 90, 160, 80);
      } else {
        pdf.addImage(graphImg, 'PNG', 10, 10, 180, 100);
        pdf.addPage();
        pdf.addImage(resultImg, 'PNG', 10, 10, 180, 80);
        pdf.text('Full Arc Flash Report', 20, 100);
        pdf.text(`Status: ${checkResult?.status}`, 20, 110);
        pdf.text(`Remediation: ${checkResult?.remediation?.join('; ')}`, 20, 120);
        if (Object.keys(paramTips).length > 0) {
          pdf.text('Parameter Optimization Tips:', 20, 130);
          pdf.text(`- Working Distance: ${paramTips.working_distance_tip || 'No tip available'}`, 20, 140);
          pdf.text(`- Arcing Time: ${paramTips.arcing_time_tip || 'No tip available'}`, 20, 150);
          pdf.text(`- Fault Current: ${paramTips.fault_current_tip || 'No tip available'}`, 20, 160);
        }
      }

      pdf.save(isLabel ? 'arcflash-label.pdf' : 'arcflash-report.pdf');
      setToast({ msg: `PDF ${isLabel ? 'label' : 'report'} generated successfully`, type: 'success' });
    } catch (e) {
      setToast({ msg: `PDF export failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (point) => {
    setSelectedPoints(prev => 
      prev.some(p => p.device_id === point.device_id) 
        ? prev.filter(p => p.device_id !== point.device_id)
        : [...prev, { device_id: point.device_id, switchboard_id: point.switchboard_id }]
    );
  };

  const openParams = (point) => {
    if (!point.device_id || !point.switchboard_id) {
      setToast({ msg: 'Invalid device or switchboard data', type: 'error' });
      return;
    }
    setParamForm({
      device_id: Number(point.device_id),
      switchboard_id: Number(point.switchboard_id),
      working_distance: point.working_distance || 455,
      enclosure_type: point.enclosure_type || 'VCB',
      electrode_gap: point.electrode_gap || 32,
      arcing_time: point.arcing_time || 0.2,
      fault_current_ka: point.fault_current_ka || point.icu_ka,
      settings: point.settings || { ir: 1, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: 'C' },
      parent_id: point.parent_id || '',
    });
    setParamTips({});
    setShowParamsModal(true);
  };

  return (
    <section className="container-narrow py-10">
      {showConfetti && <Confetti />}
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">
        <Flame className="text-orange-600" /> Arc Flash Analysis
      </h1>

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
        <input
          className="input flex-1"
          placeholder="Switchboard ID"
          type="number"
          value={q.switchboard}
          onChange={e => setQ({ ...q, switchboard: e.target.value, page: 1 })}
        />
        <input className="input flex-1" placeholder="Building" value={q.building} onChange={e => setQ({ ...q, building: e.target.value, page: 1 })} />
        <input className="input flex-1" placeholder="Floor" value={q.floor} onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })} />
      </div>

      <div className="flex gap-4 mb-6">
        <button onClick={handleAutofill} className="btn" disabled={busy}>
          Autofill Missing Parameters
        </button>
        <button onClick={handleReset} className="btn bg-red-500 hover:bg-red-600 text-white" disabled={busy}>
          Reset Arc Data
        </button>
      </div>

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
                    <button onClick={() => handleCheck(point.device_id, point.switchboard_id)} className="btn-small" disabled={busy}>
                      Check
                    </button>
                    <button onClick={() => openParams(point)} className="btn-small flex items-center gap-1" disabled={busy}>
                      <Settings size={14} /> Params
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between mt-4">
        <button onClick={() => setQ({ ...q, page: Math.max(1, q.page - 1) })} disabled={q.page === 1 || busy} className="btn">
          Previous
        </button>
        <span>Page {q.page} of {Math.ceil(total / pageSize)}</span>
        <button onClick={() => setQ({ ...q, page: q.page + 1 })} disabled={q.page >= Math.ceil(total / pageSize) || busy} className="btn">
          Next
        </button>
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

      {checkResult && (
        <div ref={resultRef} className="mt-8 p-6 bg-white rounded-lg shadow-md transition-all duration-500 transform scale-100">
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
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Remediation Actions:</h3>
              <ul className="list-disc pl-5 text-gray-700">
                {checkResult.remediation.map((r, i) => <li key={i} className="mb-1">{r}</li>)}
              </ul>
            </div>
          )}
          {Object.keys(paramTips).length > 0 && (
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Parameter Optimization Tips:</h3>
              <ul className="list-disc pl-5 text-gray-700">
                {paramTips.working_distance_tip && <li className="mb-1">Working Distance: {paramTips.working_distance_tip}</li>}
                {paramTips.arcing_time_tip && <li className="mb-1">Arcing Time: {paramTips.arcing_time_tip}</li>}
                {paramTips.fault_current_tip && <li className="mb-1">Fault Current: {paramTips.fault_current_tip}</li>}
              </ul>
            </div>
          )}
          <div className="flex gap-4">
            <button 
              onClick={() => setShowSidebar(true)} 
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
              disabled={busy}
            >
              <ChevronRight size={16} /> View Explanation
            </button>
            <button 
              onClick={() => exportPdf(true)} 
              className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-2"
              disabled={busy}
            >
              <Download size={16} /> Generate Arc Flash Label PDF
            </button>
            <button 
              onClick={() => exportPdf(false)} 
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
              disabled={busy}
            >
              <Download size={16} /> Generate Full Report PDF
            </button>
          </div>
        </div>
      )}

      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Edit Arc Flash Parameters">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Working Distance (mm)</label>
            <input
              type="number"
              value={paramForm.working_distance || 455}
              onChange={e => setParamForm({ ...paramForm, working_distance: Math.max(Number(e.target.value), 100) })}
              className="input w-full"
              placeholder="Minimum: 100"
              min="100"
            />
            {paramTips.working_distance_tip && (
              <p className="text-sm text-gray-600 mt-1">{paramTips.working_distance_tip}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Enclosure Type</label>
            <select
              value={paramForm.enclosure_type || 'VCB'}
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
              value={paramForm.electrode_gap || 32}
              onChange={e => setParamForm({ ...paramForm, electrode_gap: Number(e.target.value) })}
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
              value={paramForm.arcing_time || 0.2}
              onChange={e => setParamForm({ ...paramForm, arcing_time: Number(e.target.value) })}
              className="input w-full"
              placeholder="Default: 0.2 (from selectivity if available)"
              min="0.01"
            />
            {paramTips.arcing_time_tip && (
              <p className="text-sm text-gray-600 mt-1">{paramTips.arcing_time_tip}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Fault Current (kA)</label>
            <input
              type="number"
              value={paramForm.fault_current_ka || ''}
              onChange={e => setParamForm({ ...paramForm, fault_current_ka: Number(e.target.value) })}
              className="input w-full"
              placeholder="From Fault Level or manual"
              min="1"
            />
            {paramTips.fault_current_tip && (
              <p className="text-sm text-gray-600 mt-1">{paramTips.fault_current_tip}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Protection Settings (Ir)</label>
            <input
              type="number"
              step="0.1"
              value={paramForm.settings.ir || 1}
              onChange={e => setParamForm({ ...paramForm, settings: { ...paramForm.settings, ir: Number(e.target.value) } })}
              className="input w-full"
              placeholder="Long-time pickup (default: 1)"
              min="0.1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Protection Settings (Isd)</label>
            <input
              type="number"
              step="0.1"
              value={paramForm.settings.isd || 6}
              onChange={e => setParamForm({ ...paramForm, settings: { ...paramForm.settings, isd: Number(e.target.value) } })}
              className="input w-full"
              placeholder="Short-time pickup (default: 6)"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Protection Settings (Tsd, s)</label>
            <input
              type="number"
              step="0.01"
              value={paramForm.settings.tsd || 0.1}
              onChange={e => setParamForm({ ...paramForm, settings: { ...paramForm.settings, tsd: Number(e.target.value) } })}
              className="input w-full"
              placeholder="Short-time delay (default: 0.1)"
              min="0.01"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Protection Settings (Ii)</label>
            <input
              type="number"
              step="0.1"
              value={paramForm.settings.ii || 10}
              onChange={e => setParamForm({ ...paramForm, settings: { ...paramForm.settings, ii: Number(e.target.value) } })}
              className="input w-full"
              placeholder="Instantaneous pickup (default: 10)"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Parent Device ID</label>
            <input
              type="number"
              value={paramForm.parent_id || ''}
              onChange={e => setParamForm({ ...paramForm, parent_id: Number(e.target.value) || null })}
              className="input w-full"
              placeholder="Upstream device ID (optional)"
            />
          </div>
          <button
            onClick={saveParameters}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 w-full"
            disabled={busy || !paramForm.device_id || !paramForm.switchboard_id}
          >
            Save Parameters
          </button>
        </div>
      </Modal>

      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="Incident Energy Curves (Zoom & Pan Enabled)">
        {curveData ? (
          <div ref={chartRef}>
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
          </div>
        ) : (
          <p className="text-red-600">Graph data not available. Try running the check again.</p>
        )}
        <button 
          onClick={() => exportPdf(false)} 
          className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
          disabled={busy}
        >
          <Download size={16} /> Export Full Report PDF
        </button>
        <button 
          onClick={() => setShowGraph(false)} 
          className="mt-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          disabled={busy}
        >
          Close Graph
        </button>
      </Modal>

      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)} tipContent={tipContent} />

      {toast && <Toast {...toast} />}
      {busy && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div>
        </div>
      )}
    </section>
  );
}
