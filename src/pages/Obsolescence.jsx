// src/pages/Obsolescence.jsx
import { useEffect, useState, useRef } from 'react';
import { get, post, upload } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Download, ChevronRight, Settings, Upload, ChevronDown, Send, Calendar } from 'lucide-react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import Confetti from 'react-confetti';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  annotationPlugin,
  zoomPlugin
);

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

function Toast({ msg, type }) {
  const colors = {
    success: 'bg-green-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-blue-500 text-white',
  };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-xl text-sm ${colors[type]} ring-1 ring-black/10`}>
      {msg}
    </div>
  );
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-green-50 to-orange-50">
          <h3 className="text-xl font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={20} className="text-gray-600" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[60vh]">{children}</div>
      </div>
    </div>
  );
}

function Sidebar({ tips, open, onClose, onSendQuery }) {
  const [query, setQuery] = useState('');
  if (!open) return null;
  return (
    <motion.div
      initial={{ x: 400 }}
      animate={{ x: 0 }}
      exit={{ x: 400 }}
      className="fixed right-0 top-0 h-full w-96 bg-white/95 backdrop-blur-md shadow-2xl z-40 overflow-y-auto p-6 rounded-l-3xl ring-1 ring-black/5"
    >
      <div className="flex justify-between mb-6">
        <h3 className="text-2xl font-bold text-gray-800">AI Assistant</h3>
        <button onClick={onClose}><X size={24} className="text-gray-600" /></button>
      </div>
      <div className="space-y-4 mb-4">
        {tips.map(tip => (
          <motion.p key={tip.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-gray-700 p-4 bg-gradient-to-r from-green-50 to-orange-50 rounded-xl shadow-sm ring-1 ring-black/5">{tip.content}</motion.p>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ask AI: Analyze switchboard X or set temp..."
          className="flex-1 p-3 rounded-xl bg-gray-50 text-gray-800 placeholder-gray-500 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
        />
        <button onClick={() => { onSendQuery(query); setQuery(''); }} className="p-3 bg-green-500 text-white rounded-xl shadow-md hover:bg-green-600">
          <Send size={20} />
        </button>
      </div>
    </motion.div>
  );
}

export default function Obsolescence() {
  const site = useUserSite();
  const [tab, setTab] = useState('overview');
  const [buildings, setBuildings] = useState([]);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [expandedSwitchboards, setExpandedSwitchboards] = useState({});
  const [switchboards, setSwitchboards] = useState({});
  const [devices, setDevices] = useState({});
  const [selectedFilter, setSelectedFilter] = useState({ building: null, switchboard: null });
  const [ganttTasks, setGanttTasks] = useState([]);
  const [doughnutData, setDoughnutData] = useState([]);
  const [capexForecast, setCapexForecast] = useState({});
  const [aiTips, setAiTips] = useState([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({
    device_id: null, switchboard_id: null, manufacture_date: '2000-01-01', avg_temperature: 25, avg_humidity: 50,
    operation_cycles: 5000, avg_life_years: 30, replacement_cost: 1000, document_link: ''
  });
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const chartRef = useRef(null);
  const ganttRef = useRef(null);
  const [avgUrgency, setAvgUrgency] = useState(45);
  const [totalCapex, setTotalCapex] = useState(50000);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showGanttModal, setShowGanttModal] = useState(false);
  const [annualGanttTasks, setAnnualGanttTasks] = useState([]);

  useEffect(() => {
    loadBuildings();
    const interval = setInterval(autoCheck, 300000); // Every 5 min
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (tab === 'roll-up') loadGanttData();
    if (tab === 'analysis') {
      loadDoughnutData();
      loadCapexForecast();
    }
  }, [tab, selectedFilter]);

  const autoCheck = async () => {
    try {
      await post('/api/obsolescence/auto-check');
      loadBuildings();
      if (tab === 'roll-up') loadGanttData();
      if (tab === 'analysis') {
        loadDoughnutData();
        loadCapexForecast();
      }
    } catch (e) {
      console.error('Auto check failed', e);
    }
  };

  const loadBuildings = async () => {
    try {
      setBusy(true);
      const data = await get('/api/obsolescence/buildings');
      setBuildings(data.data || []);
      await post('/api/obsolescence/ai-fill'); // Auto-fill with AI
      const urgencyRes = await get('/api/obsolescence/avg-urgency');
      setAvgUrgency(urgencyRes.avg || 45);
      const capexRes = await get('/api/obsolescence/total-capex');
      setTotalCapex(capexRes.total || 50000);
    } catch (e) {
      setToast({ msg: `Failed to load buildings: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const loadSwitchboards = async (building) => {
    try {
      const data = await get('/api/obsolescence/switchboards', { building });
      setSwitchboards(prev => ({ ...prev, [building]: data.data }));
    } catch (e) {
      setToast({ msg: `Failed: ${e.message}`, type: 'error' });
    }
  };

  const loadDevices = async (switchboard) => {
    try {
      const data = await get('/api/obsolescence/devices', { switchboard });
      setDevices(prev => ({ ...prev, [switchboard]: data.data }));
    } catch (e) {
      setToast({ msg: `Failed: ${e.message}`, type: 'error' });
    }
  };

  const toggleBuilding = (building) => {
    setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }));
    if (!switchboards[building]) loadSwitchboards(building);
    setSelectedFilter({ building, switchboard: null });
  };

  const toggleSwitchboard = (switchboard) => {
    setExpandedSwitchboards(prev => ({ ...prev, [switchboard]: !prev[switchboard] }));
    if (!devices[switchboard]) loadDevices(switchboard);
    setSelectedFilter(prev => ({ ...prev, switchboard });
  };

  const loadGanttData = async () => {
    try {
      const params = { ...selectedFilter };
      const data = await get('/api/obsolescence/gantt-data', params);
      const tasks = (data.tasks || []).map(task => ({
        ...task,
        start: new Date(task.start),
        end: new Date(task.end),
      })).filter(task => !isNaN(task.start.getTime()));
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg: `Gantt failed: ${e.message}`, type: 'error' });
      setGanttTasks([]); // No crash
    }
  };

  const loadDoughnutData = async () => {
    try {
      const params = { group: 'building', ...selectedFilter };
      const data = await get('/api/obsolescence/doughnut', params);
      setDoughnutData(data.data || []);
    } catch (e) {
      setToast({ msg: `Doughnut failed: ${e.message}`, type: 'error' });
      setDoughnutData([]); // No crash
    }
  };

  const loadCapexForecast = async () => {
    try {
      const params = { group: 'building', ...selectedFilter };
      const data = await get('/api/obsolescence/capex-forecast', params);
      setCapexForecast(data.forecasts || {});
    } catch (e) {
      setToast({ msg: `CAPEX failed: ${e.message}`, type: 'error' });
      setCapexForecast({}); // No crash
    }
  };

  const handleAiQuery = async (query) => {
    try {
      const { response, updates } = await post('/api/obsolescence/ai-query', { query });
      setAiTips(prev => [...prev, { id: Date.now(), content: response }].slice(-5));
      if (updates) {
        loadBuildings(); // Refresh if DB updated
      }
    } catch (e) {
      setToast({ msg: `AI query failed: ${e.message}`, type: 'error' });
    }
  };

  const handlePdfUpload = async () => {
    if (!pdfFile) {
      setToast({ msg: 'No PDF selected', type: 'error' });
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
      setToast({ msg: 'PDF analyzed!', type: 'success' });
    } catch (e) {
      setToast({ msg: `PDF failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const saveParameters = async () => {
    try {
      const flatForm = { 
        device_id: paramForm.device_id,
        switchboard_id: paramForm.switchboard_id,
        manufacture_date: paramForm.manufacture_date,
        avg_temperature: paramForm.avg_temperature,
        avg_humidity: paramForm.avg_humidity,
        operation_cycles: paramForm.operation_cycles,
        avg_life_years: paramForm.avg_life_years,
        replacement_cost: paramForm.replacement_cost,
        document_link: paramForm.document_link
      };
      await post('/api/obsolescence/parameters', flatForm);
      setToast({ msg: 'Parameters saved!', type: 'success' });
      loadBuildings();
      setShowParamsModal(false);
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    }
  };

  const exportPdf = async () => {
    try {
      setBusy(true);
      const pdf = new jsPDF();
      pdf.text('Obsolescence Report', 10, 10);
      // Add canvases or table data here if needed
      pdf.save('obsolescence-report.pdf');
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
      { label: 'OK', data: data.map(d => d.ok || 0), backgroundColor: '#00ff00' },
      { label: 'Warning', data: data.map(d => d.warning || 0), backgroundColor: '#ffa500' },
      { label: 'Critical', data: data.map(d => d.critical || 0), backgroundColor: '#ff0000' },
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

  const openAnnualGantt = async (device) => {
    try {
      const data = await get('/api/obsolescence/annual-gantt', { device_id: device.device_id });
      setAnnualGanttTasks(data.tasks || []);
      setSelectedDevice(device);
      setShowGanttModal(true);
    } catch (e) {
      setToast({ msg: `Annual Gantt failed: ${e.message}`, type: 'error' });
    }
  };

  return (
    <section className="p-8 max-w-7xl mx-auto bg-gradient-to-br from-green-50 to-orange-50 rounded-3xl shadow-xl min-h-screen">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-800">Obsolescence Dashboard</h1>
        <div className="flex gap-4">
          <button onClick={exportPdf} className="px-4 py-2 bg-green-500 text-white rounded-xl shadow-md hover:bg-green-600">Export PDF</button>
          <button onClick={() => setShowSidebar(true)} className="p-3 bg-orange-500 text-white rounded-xl shadow-md hover:bg-orange-600">
            <HelpCircle size={24} />
          </button>
        </div>
      </header>

      <div className="flex gap-4 mb-8 border-b pb-2">
        <button onClick={() => setTab('overview')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'overview' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Overview</button>
        <button onClick={() => setTab('roll-up')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'roll-up' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-600'}`}>Roll-up</button>
        <button onClick={() => setTab('analysis')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'analysis' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Analysis</button>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="p-6 bg-white rounded-2xl shadow-md ring-1 ring-black/5">
            <h3 className="text-lg font-bold text-gray-800">Total Buildings</h3>
            <p className="text-3xl font-bold text-green-600">{buildings.length}</p>
          </div>
          <div className="p-6 bg-white rounded-2xl shadow-md ring-1 ring-black/5">
            <h3 className="text-lg font-bold text-gray-800">Avg Urgency</h3>
            <p className="text-3xl font-bold text-orange-600">{avgUrgency.toFixed(1)}%</p>
          </div>
          <div className="p-6 bg-white rounded-2xl shadow-md ring-1 ring-black/5">
            <h3 className="text-lg font-bold text-gray-800">Total CAPEX Forecast</h3>
            <p className="text-3xl font-bold text-green-600">€{totalCapex.toLocaleString()}</p>
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="overflow-x-auto bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-green-50 text-gray-700">
                <th className="p-4">Name</th>
                <th className="p-4">Service Year</th>
                <th className="p-4">Document</th>
                <th className="p-4">Est. Replacement Cost</th>
                <th className="p-4">Forecast Replacement Date</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map(build => (
                <>
                  <motion.tr key={build.building} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-green-50/50 transition-colors">
                    <td className="p-4 flex items-center cursor-pointer" onClick={() => toggleBuilding(build.building)}>
                      {expandedBuildings[build.building] ? <ChevronDown /> : <ChevronRight />} {build.building} ({build.count} items)
                    </td>
                    <td></td><td></td><td>€{build.total_cost?.toLocaleString() || 'N/A'}</td><td></td><td></td>
                  </motion.tr>
                  {expandedBuildings[build.building] && switchboards[build.building]?.map(sb => (
                    <>
                      <motion.tr key={sb.id} className="bg-orange-50 hover:bg-orange-100 transition-colors">
                        <td className="p-4 pl-8 flex items-center cursor-pointer" onClick={() => toggleSwitchboard(sb.id)}>
                          {expandedSwitchboards[sb.id] ? <ChevronDown /> : <ChevronRight />} {sb.name} (Floor: {sb.floor})
                        </td>
                        <td></td><td></td><td>€{sb.total_cost?.toLocaleString() || 'N/A'}</td><td></td><td></td>
                      </motion.tr>
                      {expandedSwitchboards[sb.id] && devices[sb.id]?.map(dev => (
                        <motion.tr key={dev.device_id} className="bg-white hover:bg-gray-50 transition-colors">
                          <td className="p-4 pl-16">{dev.name || 'Device'}</td>
                          <td className="p-4">{new Date(dev.manufacture_date).getFullYear() || 'N/A'}</td>
                          <td className="p-4">{dev.document_link ? <a href={dev.document_link} className="text-blue-600 underline">Link</a> : 'N/A'}</td>
                          <td className="p-4">€{dev.replacement_cost?.toLocaleString() || 'N/A'}</td>
                          <td className="p-4">{dev.remaining_life_years ? new Date().getFullYear() + dev.remaining_life_years : 'N/A'}</td>
                          <td className="p-4 flex gap-2">
                            <button onClick={() => { setParamForm({ ...dev }); setShowParamsModal(true); }} className="text-green-600 hover:text-green-800"><Settings size={16} /></button>
                            <button onClick={() => openAnnualGantt(dev)} className="text-blue-600 hover:text-blue-800"><Calendar size={16} /></button>
                          </td>
                        </motion.tr>
                      ))}
                    </>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'roll-up' && (
        <div ref={ganttRef} className="h-[600px] overflow-auto bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          {ganttTasks.length ? (
            <Gantt
              tasks={ganttTasks}
              viewMode={ViewMode.Decade}
              columnWidth={120}
              listCellWidth="250px"
              todayColor="#ff6b00"
              onClick={task => handleAiQuery(`Explain Gantt for ${task.name}`)}
            />
          ) : <p className="text-gray-600 text-center py-20">No data available yet. AI is analyzing...</p>}
        </div>
      )}

      {tab === 'analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Urgency Distribution</h2>
            {doughnutData.length ? (
              <Doughnut data={getDoughnutChartData(doughnutData)} options={{ responsive: true, plugins: { legend: { position: 'top' } } }} />
            ) : <p className="text-gray-600 text-center py-20">No data. Running AI analysis...</p>}
          </div>
          <div ref={chartRef} className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">CAPEX Forecast</h2>
            {Object.keys(capexForecast).length ? (
              <Line data={getCapexChartData(capexForecast)} options={{ responsive: true, plugins: { zoom: { zoom: { wheel: { enabled: true }, mode: 'xy' } } } }} />
            ) : <p className="text-gray-600 text-center py-20">No data. Running AI analysis...</p>}
          </div>
        </div>
      )}

      <AnimatePresence>
        <Sidebar tips={aiTips} open={showSidebar} onClose={() => setShowSidebar(false)} onSendQuery={handleAiQuery} />
      </AnimatePresence>

      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Edit Parameters">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Manufacture Date</label>
            <div className="relative">
              <input
                type="date"
                value={paramForm.manufacture_date}
                onChange={e => setParamForm({ ...paramForm, manufacture_date: e.target.value })}
                className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              />
              <Calendar className="absolute right-2 top-2 text-gray-500" size={20} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Temperature (°C)</label>
            <input
              type="number"
              value={paramForm.avg_temperature}
              onChange={e => setParamForm({ ...paramForm, avg_temperature: Number(e.target.value) })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
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
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
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
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              min="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Life Years (Norm)</label>
            <input
              type="number"
              value={paramForm.avg_life_years}
              onChange={e => setParamForm({ ...paramForm, avg_life_years: Number(e.target.value) })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
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
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              min="0"
              step="100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Document Link</label>
            <input
              type="text"
              value={paramForm.document_link}
              onChange={e => setParamForm({ ...paramForm, document_link: e.target.value })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Upload PDF for AI Extraction</label>
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0])} className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10" />
            <button onClick={handlePdfUpload} className="mt-2 w-full p-2 bg-green-500 text-white rounded-xl shadow-md hover:bg-green-600" disabled={busy || !pdfFile}>
              <Upload size={16} /> Analyze PDF
            </button>
          </div>
          <button
            onClick={saveParameters}
            className="w-full p-2 bg-orange-500 text-white rounded-xl shadow-md hover:bg-orange-600"
            disabled={busy}
          >
            Save Parameters
          </button>
        </div>
      </Modal>

      <Modal open={showGanttModal} onClose={() => setShowGanttModal(false)} title={`Annual Gantt for ${selectedDevice?.name}`}>
        <div className="h-[400px]">
          {annualGanttTasks.length ? (
            <Gantt
              tasks={annualGanttTasks}
              viewMode={ViewMode.Month}
              columnWidth={80}
              listCellWidth="200px"
              todayColor="#ff6b00"
              onClick={task => handleAiQuery(`Explain annual Gantt for ${task.name}`)}
            />
          ) : <p className="text-gray-600 text-center py-20">No annual data</p>}
        </div>
      </Modal>

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><div className="animate-spin h-16 w-16 border-b-4 border-green-500 rounded-full"></div></div>}
      {showConfetti && <Confetti />}
    </section>
  );
}
