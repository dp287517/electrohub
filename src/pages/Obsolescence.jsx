// src/pages/Obsolescence.jsx
import { useEffect, useState, useRef } from 'react';
import { get, post, upload } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Download, ChevronRight, Settings, Upload } from 'lucide-react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import Confetti from 'react-confetti';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { motion } from 'framer-motion';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  LogarithmicScale,
} from 'chart.js';
import Annotation from 'chartjs-plugin-annotation';
import Zoom from 'chartjs-plugin-zoom';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  PointElement,
  LineElement,
  ArcElement,
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

function Sidebar({ tips }) {
  return (
    <motion.div
      initial={{ x: 300 }}
      animate={{ x: 0 }}
      className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-40 overflow-y-auto p-6"
    >
      <h3 className="text-xl font-bold mb-4">AI Insights</h3>
      {tips.length ? tips.map(tip => (
        <p key={tip.id} className="text-sm text-gray-700 mb-2">{tip.content}</p>
      )) : <p>No tips yet, hover over items!</p>}
    </motion.div>
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
  const [ganttTasks, setGanttTasks] = useState([]);
  const [doughnutData, setDoughnutData] = useState([]);
  const [capexForecast, setCapexForecast] = useState({});
  const [aiTips, setAiTips] = useState([]);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({
    device_id: null,
    switchboard_id: null,
    manufacture_date: '2000-01-01',
    avg_temperature: 25,
    avg_humidity: 50,
    operation_cycles: 5000,
    avg_life_years: 25,
    replacement_cost: 1000
  });
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [groupBy, setGroupBy] = useState('building');
  const chartRef = useRef(null);
  const ganttRef = useRef(null);
  const resultRef = useRef(null);
  const pageSize = 18;

  useEffect(() => {
    loadPoints();
    loadGanttData();
    loadDoughnutData();
    loadCapexForecast();
  }, [q, groupBy]);

  const loadPoints = async () => {
    try {
      setBusy(true);
      const params = { ...q, switchboard: isNaN(Number(q.switchboard)) ? '' : q.switchboard };
      const data = await get('/api/obsolescence/points', params);
      setPoints(data?.data || []);
      setTotal(data?.total || 0);
      const initialStatuses = {};
      data?.data.forEach(point => {
        if (point.status) initialStatuses[point.device_id] = point.status;
      });
      setStatuses(initialStatuses);
    } catch (e) {
      setToast({ msg: `Failed to load points: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const loadGanttData = async () => {
    try {
      const data = await get('/api/obsolescence/gantt-data', { group: groupBy });
      // Convertir les dates en objets Date
      const tasks = data.tasks.map(task => ({
        ...task,
        start: new Date(task.start),
        end: new Date(task.end),
      })).filter(task => !isNaN(task.start.getTime()) && !isNaN(task.end.getTime()));
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg: `Failed to load Gantt data: ${e.message}`, type: 'error' });
    }
  };

  const loadDoughnutData = async () => {
    try {
      const data = await get('/api/obsolescence/doughnut', { group: groupBy });
      setDoughnutData(data.data);
    } catch (e) {
      setToast({ msg: `Failed to load doughnut data: ${e.message}`, type: 'error' });
    }
  };

  const loadCapexForecast = async () => {
    try {
      const data = await get('/api/obsolescence/capex-forecast', { group: groupBy });
      setCapexForecast(data.forecasts);
    } catch (e) {
      setToast({ msg: `Failed to load CAPEX forecast: ${e.message}`, type: 'error' });
    }
  };

  const handleCheck = async (point) => {
    try {
      setBusy(true);
      const result = await get(`/api/obsolescence/check?device=${point.device_id}&switchboard=${point.switchboard_id}`);
      setCheckResult(result);
      setStatuses(prev => ({ ...prev, [point.device_id]: result.status }));
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      setToast({ msg: 'Check completed successfully!', type: 'success' });
      loadGanttData();
      loadDoughnutData();
      loadCapexForecast();
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
      setToast({ msg: 'Batch check completed! Updates Gantt and charts.', type: 'success' });
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
      loadGanttData();
      loadDoughnutData();
      loadCapexForecast();
      setToast({ msg: 'Data reset successfully!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Reset failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const getAiTip = async (context) => {
    try {
      const { tip } = await post('/api/obsolescence/ai-tip', { query: context });
      setAiTips(prev => [...prev, { id: Date.now(), content: tip }].slice(-5));
    } catch (e) {
      setToast({ msg: `AI tip failed: ${e.message}`, type: 'error' });
    }
  };

  const handlePdfUpload = async () => {
    if (!pdfFile) {
      setToast({ msg: 'No PDF file selected', type: 'error' });
      return;
    }
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
      loadGanttData();
      loadDoughnutData();
      loadCapexForecast();
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    }
  };

  const exportPdf = async () => {
    try {
      setBusy(true);
      const pdf = new jsPDF();
      pdf.text('Obsolescence Financial Report', 10, 10);
      if (resultRef.current) {
        const resultCanvas = await html2canvas(resultRef.current);
        pdf.addImage(resultCanvas.toDataURL('image/png'), 'PNG', 10, 20, 180, 100);
      }
      if (ganttRef.current) {
        pdf.addPage();
        const ganttCanvas = await html2canvas(ganttRef.current);
        pdf.addImage(ganttCanvas.toDataURL('image/png'), 'PNG', 10, 10, 180, 100);
      }
      if (chartRef.current) {
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

  const getDoughnutChartData = (data) => ({
    labels: data.map(d => d.label || 'Unknown'),
    datasets: [
      {
        label: 'OK',
        data: data.map(d => d.ok || 0),
        backgroundColor: '#00ff00',
      },
      {
        label: 'Warning',
        data: data.map(d => d.warning || 0),
        backgroundColor: '#ffa500',
      },
      {
        label: 'Critical',
        data: data.map(d => d.critical || 0),
        backgroundColor: '#ff0000',
      },
    ],
  });

  const getCapexChartData = (forecasts) => {
    const years = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() + i);
    const datasets = [];
    Object.keys(forecasts).forEach(group => {
      const annual = years.map(y => forecasts[group].reduce((sum, f) => sum + (f.year === y ? f.capex_year : 0), 0));
      const cumul = annual.reduce((acc, cur, i) => [...acc, (acc[i-1] || 0) + cur], []);
      datasets.push({
        type: 'bar',
        label: `${group} Annual (€)`,
        data: annual,
        backgroundColor: '#1e90ff',
      });
      datasets.push({
        type: 'line',
        label: `${group} Cumulative (€)`,
        data: cumul,
        borderColor: '#32cd32',
        fill: false,
      });
    });
    return { labels: years, datasets };
  };

  return (
    <section className="p-6 max-w-7xl mx-auto relative">
      <h1 className="text-3xl font-bold mb-6">Obsolescence CAPEX Forecasting</h1>

      {/* Filters and Controls */}
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
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="input">
          <option value="building">By Building</option>
          <option value="floor">By Floor</option>
          <option value="switchboard">By Switchboard</option>
        </select>
        <button
          onClick={handleBatchCheck}
          className="btn-primary flex items-center gap-2"
          disabled={selectedPoints.length === 0 || busy}
          title="Run obsolescence checks for selected devices to update urgency and CAPEX"
        >
          Batch Check ({selectedPoints.length})
        </button>
        <button onClick={handleReset} className="btn-secondary" disabled={busy}>
          Reset Data
        </button>
        <button onClick={exportPdf} className="btn-primary flex items-center gap-2" disabled={busy}>
          <Download size={16} /> Export PDF
        </button>
      </div>

      {/* Gantt Chart */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">30-Year Replacement Timeline</h2>
        <div ref={ganttRef} className="h-96 overflow-auto border rounded-lg p-4 bg-white shadow">
          {ganttTasks.length ? (
            <Gantt
              tasks={ganttTasks}
              viewMode={ViewMode.Year}
              columnWidth={100}
              listCellWidth="200px"
              onClick={task => getAiTip(`Replacement strategy for ${task.name}`)}
              tooltipContent={task => {
                const startYear = task.start && !isNaN(task.start.getTime()) ? task.start.getFullYear() : 'N/A';
                return `Replace in ${startYear}: €${task.cost}`;
              }}
            />
          ) : <p className="text-gray-500">No data, run checks or add devices</p>}
        </div>
      </motion.div>

      {/* Doughnut Chart */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Urgency Distribution by {groupBy}</h2>
        <div className="h-64">
          <Doughnut
            data={getDoughnutChartData(doughnutData)}
            options={{
              responsive: true,
              plugins: {
                legend: { position: 'top' },
                tooltip: {
                  callbacks: {
                    label: context => `${context.dataset.label}: ${context.raw} devices`
                  }
                }
              }
            }}
          />
        </div>
      </motion.div>

      {/* CAPEX Forecast Chart */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">CAPEX Forecast (Annual & Cumulative)</h2>
        <div ref={chartRef} className="h-96">
          <Line
            data={getCapexChartData(capexForecast)}
            options={{
              responsive: true,
              plugins: {
                zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }, pan: { enabled: true, mode: 'xy' } },
                legend: { position: 'top' },
                tooltip: {
                  callbacks: {
                    label: context => `${context.dataset.label}: €${context.parsed.y.toLocaleString()}`
                  }
                }
              },
              scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Cost (€)' } },
                x: { title: { display: true, text: 'Year' } }
              }
            }}
          />
        </div>
      </motion.div>

      {/* Points List */}
      <div ref={resultRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {points.map(point => (
          <motion.div
            key={point.device_id}
            whileHover={{ scale: 1.05 }}
            className="card p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow"
            onMouseEnter={() => getAiTip(`Obsolescence for ${point.name || 'Device'} in ${point.switchboard_name}`)}
          >
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
                <button
                  onClick={() => { setSelectedPoint(point); setParamForm({ ...paramForm, ...point }); setShowParamsModal(true); }}
                  className="text-blue-600"
                >
                  <Settings size={16} />
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-2">Switchboard: {point.switchboard_name}</p>
            <p className="text-sm text-gray-600 mb-2">Building: {point.building_code} | Floor: {point.floor}</p>
            <div className="flex gap-2 mb-4">
              <button onClick={() => handleCheck(point)} className="btn-small-primary" disabled={busy}>
                Run Check
              </button>
              <button onClick={() => getAiTip(`CAPEX strategy for ${point.name}`)} className="btn-small-info">
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
          </motion.div>
        ))}
      </div>

      {/* Parameters Modal */}
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
            <label className="block text-sm font-medium text-gray-700">Optional: Upload PDF for AI Date Extraction</label>
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0])} className="input w-full" />
            <button onClick={handlePdfUpload} className="mt-2 btn-primary w-full" disabled={busy || !pdfFile}>
              <Upload size={16} /> Analyze PDF
            </button>
          </div>
          <button
            onClick={saveParameters}
            className="btn-primary w-full"
            disabled={busy}
          >
            Save Parameters
          </button>
        </div>
      </Modal>

      <Sidebar tips={aiTips} />

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
