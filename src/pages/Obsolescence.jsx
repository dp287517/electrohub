// src/pages/Obsolescence.jsx
import { useEffect, useState, useRef } from 'react';
import { get, post, upload } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Flame, Download, ChevronRight, Settings, Upload } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import { Chart as GoogleChart } from 'react-google-charts';
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

export default function Obsolescence() {
  const site = useUserSite();
  const [points, setPoints] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [selectedPoints, setSelectedPoints] = useState([]);
  const [q, setQ] = useState({ q: '', switchboard: '', building: '', floor: '', sort: 'name', dir: 'desc', page: 1 });
  const [total, setTotal] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [forecastData, setForecastData] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({ device_id: null, switchboard_id: null, manufacture_date: '2000-01-01', avg_temperature: 25, avg_humidity: 50, operation_cycles: 5000, avg_life_years: 25, replacement_cost: 1000 });
  const [paramTips, setParamTips] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
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
        switchboard: isNaN(Number(q.switchboard)) ? '' : q.switchboard,
      };
      const data = await get('/api/obsolescence/points', params);
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

  const handleCheck = async (point, autofill = false) => {
    try {
      setBusy(true);
      if (autofill) {
        const aiSpecs = await getAiSpecs(point);
        await saveParameters({ ...paramForm, ...aiSpecs });
      }
      const result = await get(`/api/obsolescence/check?device=${point.device_id}&switchboard=${point.switchboard_id}`);
      setCheckResult(result);
      setStatuses(prev => ({ ...prev, [point.device_id]: result.status }));
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      setToast({ msg: 'Check completed successfully!', type: 'success' });
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
        if (point) await handleCheck(point);
      }
      setToast({ msg: 'Batch check completed!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Batch check failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    try {
      setBusy(true);
      await post('/api/obsolescence/reset', {});
      loadPoints();
      setToast({ msg: 'Data reset successfully!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Reset failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const loadForecast = async (point) => {
    try {
      setBusy(true);
      const data = await get(`/api/obsolescence/forecast?device=${point.device_id}&switchboard=${point.switchboard_id}`);
      setForecastData(data.forecast);
      setShowGraph(true);
    } catch (e) {
      setToast({ msg: `Forecast load failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const getAiTip = async (context) => {
    try {
      const { tip } = await post('/api/obsolescence/ai-tip', { query: context });
      setTipContent(tip);
      setShowSidebar(true);
    } catch (e) {
      setToast({ msg: `AI tip failed: ${e.message}`, type: 'error' });
    }
  };

  const handlePdfUpload = async () => {
    if (!pdfFile) return;
    try {
      setBusy(true);
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('device_id', paramForm.device_id);
      formData.append('switchboard_id', paramForm.switchboard_id);
      const { manufacture_date } = await upload('/api/obsolescence/analyze-pdf', formData);
      setParamForm({ ...paramForm, manufacture_date });
      setToast({ msg: 'PDF analyzed successfully!', type: 'success' });
    } catch (e) {
      setToast({ msg: `PDF analysis failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const saveParameters = async (updatedForm = paramForm) => {
    try {
      await post('/api/obsolescence/parameters', updatedForm);
      setToast({ msg: 'Parameters saved!', type: 'success' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    }
  };

  const exportPdf = async (fullReport = false) => {
    try {
      setBusy(true);
      const pdf = new jsPDF();
      pdf.text('Obsolescence Report', 10, 10);
      // Add result
      const resultCanvas = await html2canvas(resultRef.current);
      pdf.addImage(resultCanvas.toDataURL('image/png'), 'PNG', 10, 20, 180, 100);
      if (fullReport && chartRef.current) {
        pdf.addPage();
        const chartCanvas = await html2canvas(chartRef.current);
        pdf.addImage(chartCanvas.toDataURL('image/png'), 'PNG', 10, 10, 180, 100);
      }
      pdf.save('obsolescence_report.pdf');
      setToast({ msg: 'PDF exported!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Export failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const getChartData = (forecast) => ({
    labels: forecast.map(f => f.year),
    datasets: [
      {
        label: 'Remaining Life (years)',
        data: forecast.map(f => f.remaining_life),
        borderColor: 'blue',
        fill: false,
      },
      {
        label: 'CAPEX Cumulative (€)',
        data: forecast.map(f => f.capex_cumul),
        borderColor: 'green',
        fill: false,
      },
    ],
  });

  const getGanttData = (forecast) => [
    ['Year', 'Remaining Life', { type: 'string', role: 'style' }],
    ...forecast.map(f => [f.year.toString(), f.remaining_life, f.remaining_life < 5 ? 'red' : f.remaining_life < 10 ? 'orange' : 'green']),
  ];

  return (
    <section className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Obsolescence CAPEX Forecasting</h1>
      {/* Search and controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search devices or switchboards..."
            className="input pl-10 w-full"
            value={q.q}
            onChange={e => setQ({ ...q, q: e.target.value, page: 1 })}
          />
        </div>
        <button onClick={handleBatchCheck} className="btn-primary" disabled={selectedPoints.length === 0 || busy}>
          Run Batch Check ({selectedPoints.length})
        </button>
        <button onClick={handleReset} className="btn-secondary" disabled={busy}>
          Reset Data
        </button>
      </div>

      {/* Points list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {points.map(point => (
          <div key={point.device_id} className="card p-4">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold truncate">{point.name || 'Unnamed'}</h3>
              <div className="flex gap-2">
                <input
                  type="checkbox"
                  checked={selectedPoints.includes(point.device_id)}
                  onChange={() => setSelectedPoints(prev => 
                    prev.includes(point.device_id) ? prev.filter(id => id !== point.device_id) : [...prev, point.device_id]
                  )}
                />
                <button onClick={() => { setSelectedPoint(point); setShowParamsModal(true); }} className="text-blue-600">
                  <Settings size={16} />
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-2">Switchboard: {point.switchboard_name}</p>
            <div className="flex gap-2 mb-4">
              <button onClick={() => handleCheck(point)} className="btn-small-primary" disabled={busy}>
                Run Check
              </button>
              <button onClick={() => loadForecast(point)} className="btn-small-secondary" disabled={busy}>
                View Forecast
              </button>
              <button onClick={() => getAiTip(`Obsolescence for ${point.device_type}`)} className="btn-small-info">
                AI Tip
              </button>
            </div>
            {statuses[point.device_id] && (
              <div className="flex items-center gap-2 text-sm">
                {statuses[point.device_id] === 'ok' ? <CheckCircle className="text-green-500" /> :
                 statuses[point.device_id] === 'warning' ? <AlertTriangle className="text-yellow-500" /> :
                 <XCircle className="text-red-500" />}
                <span>{statuses[point.device_id].toUpperCase()}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {/* ... (similaire aux autres pages, omis pour brièveté) */}

      {/* Params Modal */}
      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Obsolescence Parameters">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Manufacture Date</label>
            <input
              type="date"
              value={paramForm.manufacture_date}
              onChange={e => setParamForm({ ...paramForm, manufacture_date: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Temperature (°C)</label>
            <input
              type="number"
              value={paramForm.avg_temperature}
              onChange={e => setParamForm({ ...paramForm, avg_temperature: Number(e.target.value) })}
              className="input w-full"
              min="0"
              step="0.1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Humidity (%)</label>
            <input
              type="number"
              value={paramForm.avg_humidity}
              onChange={e => setParamForm({ ...paramForm, avg_humidity: Number(e.target.value) })}
              className="input w-full"
              min="0"
              max="100"
              step="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Operation Cycles</label>
            <input
              type="number"
              value={paramForm.operation_cycles}
              onChange={e => setParamForm({ ...paramForm, operation_cycles: Number(e.target.value) })}
              className="input w-full"
              min="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Life Years (Norm)</label>
            <input
              type="number"
              value={paramForm.avg_life_years}
              onChange={e => setParamForm({ ...paramForm, avg_life_years: Number(e.target.value) })}
              className="input w-full"
              min="10"
              step="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Replacement Cost (€)</label>
            <input
              type="number"
              value={paramForm.replacement_cost}
              onChange={e => setParamForm({ ...paramForm, replacement_cost: Number(e.target.value) })}
              className="input w-full"
              min="0"
              step="100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Upload PDF for Analysis</label>
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0])} className="input w-full" />
            <button onClick={handlePdfUpload} className="mt-2 btn-primary w-full" disabled={busy || !pdfFile}>
              <Upload size={16} /> Analyze PDF
            </button>
          </div>
          <button
            onClick={() => saveParameters()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 w-full"
            disabled={busy}
          >
            Save Parameters
          </button>
        </div>
      </Modal>

      {/* Forecast Modal with Graphs */}
      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="30-Year CAPEX Forecast (Zoom & Pan Enabled)">
        {forecastData ? (
          <div>
            <div ref={chartRef} className="mb-8">
              <Line
                data={getChartData(forecastData)}
                options={{
                  responsive: true,
                  plugins: {
                    zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }, pan: { enabled: true, mode: 'xy' } },
                    annotation: {
                      annotations: checkResult?.riskZones?.map((zone, i) => ({
                        type: 'box',
                        yMin: zone.min,
                        yMax: zone.max,
                        backgroundColor: 'rgba(255, 0, 0, 0.2)',
                        borderColor: 'red',
                        label: { content: 'High Urgency', display: true, position: 'center' }
                      })) || []
                    },
                    tooltip: {
                      callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.parsed.y} at year ${context.parsed.x}`
                      }
                    }
                  },
                  scales: {
                    x: { title: { display: true, text: 'Year' } },
                    y: { title: { display: true, text: 'Value' } },
                  },
                }}
              />
            </div>
            <GoogleChart
              chartType="Gantt"
              width="100%"
              height="400px"
              data={getGanttData(forecastData)}
              options={{
                gantt: {
                  trackHeight: 30,
                  barHeight: 20,
                },
              }}
            />
          </div>
        ) : (
          <p className="text-red-600">Forecast data not available. Try running the check again.</p>
        )}
        <button 
          onClick={() => exportPdf(true)} 
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
          Close
        </button>
      </Modal>

      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)} tipContent={tipContent} />

      {toast && <Toast {...toast} />}
      {busy && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div>
        </div>
      )}
      {showConfetti && <Confetti />}
    </section>
  );
}
