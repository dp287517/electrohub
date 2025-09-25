// src/pages/Obsolescence.jsx
import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api.js'; // Changé de get/post à api.obsolescence
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Download, ChevronRight, Settings, BarChart, Timeline } from 'lucide-react';
import { Line, Pie } from 'react-chartjs-2';
import { Chart as GoogleChart } from 'react-google-charts';
import Confetti from 'react-confetti';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
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
      <h3 className="text-xl font-bold mb-4">Analysis Tip</h3>
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
  const [ganttData, setGanttData] = useState(null);
  const [capexData, setCapexData] = useState(null);
  const [urgencyPie, setUrgencyPie] = useState(null);
  const [showGantt, setShowGantt] = useState(false);
  const [showCapex, setShowCapex] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({ device_id: null, switchboard_id: null, manufacturing_date: '2000-01-01', avg_temp_c: 25, avg_humidity_pct: 50, operational_cycles_per_year: 100 });
  const [paramTips, setParamTips] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfAnalysis, setPdfAnalysis] = useState(null);
  const chartRef = useRef(null);
  const resultRef = useRef(null);
  const pageSize = 18;

  useEffect(() => {
    loadPoints();
    loadGantt();
    loadCapex();
    loadUrgencyPie();
  }, [q]);

  const loadPoints = async () => {
    try {
      setBusy(true);
      const data = await api.obsolescence.listPoints(q);
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

  const loadGantt = async () => {
    try {
      const data = await api.obsolescence.getGantt();
      setGanttData([['ID', 'Name', 'Start', 'End', 'Progress', 'Urgency'], ...data.data.map(d => [d.id, d.name, new Date(d.start), new Date(d.end), d.progress, d.urgency])]);
    } catch (e) {
      console.error(e);
    }
  };

  const loadCapex = async () => {
    try {
      const data = await api.obsolescence.getCapexForecast();
      setCapexData({
        labels: data.data.map(d => d.year),
        datasets: [{ label: 'Cumulative CAPEX (€)', data: data.data.map(d => d.capex), borderColor: 'rgb(75, 192, 192)', tension: 0.1 }]
      });
    } catch (e) {
      console.error(e);
    }
  };

  const loadUrgencyPie = async () => {
    try {
      const data = await api.obsolescence.listPoints({});
      const counts = { low: 0, medium: 0, high: 0 };
      data.data.forEach(p => {
        if (p.status === 'low-risk') counts.low++;
        else if (p.status === 'medium-risk') counts.medium++;
        else if (p.status === 'high-risk') counts.high++;
      });
      setUrgencyPie({
        labels: ['Low Risk', 'Medium Risk', 'High Risk'],
        datasets: [{ data: [counts.low, counts.medium, counts.high], backgroundColor: ['#4CAF50', '#FFC107', '#F44336'] }]
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleCheck = async (deviceId, switchboardId) => {
    try {
      setBusy(true);
      const result = await api.obsolescence.checkPoint(deviceId, switchboardId);
      setCheckResult(result);
      setStatuses(prev => ({ ...prev, [deviceId]: result.status }));
      if (result.status === 'low-risk') setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      loadGantt();
      loadCapex();
      loadUrgencyPie();
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
        await handleCheck(point.device_id, point.switchboard_id);
      }
      setToast({ msg: 'Batch check complete!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Batch failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    try {
      setBusy(true);
      await api.obsolescence.reset();
      loadPoints();
      setToast({ msg: 'Data reset!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Reset failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const getAiTip = async (context) => {
    try {
      const { tip } = await api.obsolescence.getAiTip({ query: context });
      setTipContent(tip);
      setShowSidebar(true);
    } catch (e) {
      console.error(e);
    }
  };

  const saveParameters = async () => {
    try {
      setBusy(true);
      await api.obsolescence.updateParameters(paramForm);
      setShowParamsModal(false);
      setToast({ msg: 'Parameters saved!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handlePdfUpload = async () => {
    try {
      setBusy(true);
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      const analysis = await api.obsolescence.analyzePdf(formData);
      setPdfAnalysis(analysis.extracted);
      // Autofill params example
      if (analysis.manufacturing_dates[0]) {
        setParamForm(prev => ({ ...prev, manufacturing_date: analysis.manufacturing_dates[0] }));
      }
      setToast({ msg: 'PDF analyzed!', type: 'success' });
    } catch (e) {
      setToast({ msg: `PDF analysis failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async () => {
    try {
      setBusy(true);
      const pdf = new jsPDF();
      pdf.text('CAPEX Forecasting Report', 20, 20);
      autoTable(pdf, {
        head: [['Device', 'Switchboard', 'Replacement Year', 'CAPEX (€)', 'Urgency']],
        body: points.map(p => [p.device_name, p.switchboard_name, p.replacement_year, p.capex_estimate_eur, p.urgency_score])
      });
      pdf.save('obsolescence-report.pdf');
    } catch (e) {
      setToast({ msg: `Export failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const openParams = (point) => {
    setParamForm({
      device_id: point.device_id,
      switchboard_id: point.switchboard_id,
      manufacturing_date: '2000-01-01', // Default or from DB
      avg_temp_c: 25,
      avg_humidity_pct: 50,
      operational_cycles_per_year: 100
    });
    setShowParamsModal(true);
  };

  return (
    <section className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Obsolescence Management & CAPEX Forecasting</h1>
        <div className="flex gap-4">
          <button onClick={handleBatchCheck} className="btn bg-blue-600 text-white" disabled={selectedPoints.length === 0 || busy}>
            Run Batch Check
          </button>
          <button onClick={handleReset} className="btn bg-red-600 text-white" disabled={busy}>
            Reset Data
          </button>
          <button onClick={() => setShowGantt(true)} className="btn bg-green-600 text-white">
            <Timeline size={16} /> View Gantt
          </button>
          <button onClick={() => setShowCapex(true)} className="btn bg-purple-600 text-white">
            <BarChart size={16} /> CAPEX Graph
          </button>
          <button onClick={exportPdf} className="btn bg-indigo-600 text-white">
            <Download size={16} /> Export PDF
          </button>
        </div>
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-md">
          <h3 className="text-lg font-semibold mb-4">Total Assets</h3>
          <p className="text-3xl font-bold">{total}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-md">
          <h3 className="text-lg font-semibold mb-4">Avg Urgency Score</h3>
          <p className="text-3xl font-bold">{points.reduce((acc, p) => acc + (p.urgency_score || 0), 0) / (points.length || 1)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-md">
          <h3 className="text-lg font-semibold mb-4">30-Year CAPEX (€)</h3>
          <p className="text-3xl font-bold">{capexData?.datasets[0].data[29] || 0}</p>
        </div>
      </div>

      {/* Urgency Pie */}
      <div className="bg-white p-6 rounded-xl shadow-md mb-8">
        <h3 className="text-lg font-semibold mb-4">Urgency Distribution</h3>
        {urgencyPie && <Pie data={urgencyPie} />}
      </div>

      {/* Search & Table */}
      <div className="mb-6 flex gap-4">
        <input
          type="text"
          placeholder="Search..."
          value={q.q}
          onChange={e => setQ({ ...q, q: e.target.value })}
          className="input flex-1"
        />
        {/* Other filters similar to ArcFlash */}
      </div>

      <div className="overflow-x-auto bg-white rounded-xl shadow-md">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Select</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Device</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Switchboard</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Urgency</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Replacement Year</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CAPEX (€)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {points.map(point => (
              <tr key={point.device_id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <input
                    type="checkbox"
                    checked={selectedPoints.includes(point.device_id)}
                    onChange={() => setSelectedPoints(prev => prev.includes(point.device_id) ? prev.filter(id => id !== point.device_id) : [...prev, point.device_id])}
                  />
                </td>
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{point.device_name}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{point.switchboard_name}</td>
                <td className="px-6 py-4">
                  {statuses[point.device_id] === 'low-risk' && <CheckCircle className="text-green-500" />}
                  {statuses[point.device_id] === 'medium-risk' && <AlertTriangle className="text-yellow-500" />}
                  {statuses[point.device_id] === 'high-risk' && <XCircle className="text-red-500" />}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{point.urgency_score}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{point.replacement_year}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{point.capex_estimate_eur}</td>
                <td className="px-6 py-4 flex gap-2">
                  <button onClick={() => handleCheck(point.device_id, point.switchboard_id)} className="text-blue-600 hover:text-blue-900">
                    Check
                  </button>
                  <button onClick={() => openParams(point)} className="text-green-600 hover:text-green-900">
                    <Settings size={16} />
                  </button>
                  <button onClick={() => getAiTip(`Obsolescence for ${point.device_name}`)} className="text-indigo-600 hover:text-indigo-900">
                    <HelpCircle size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* PDF Upload */}
      <div className="mt-8">
        <input type="file" onChange={e => setPdfFile(e.target.files[0])} accept=".pdf" />
        <button onClick={handlePdfUpload} className="btn bg-blue-600 text-white mt-2">Analyze Project PDF</button>
        {pdfAnalysis && <pre>{JSON.stringify(pdfAnalysis, null, 2)}</pre>}
      </div>

      {/* Modals */}
      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Obsolescence Parameters">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Manufacturing Date</label>
            <input
              type="date"
              value={paramForm.manufacturing_date}
              onChange={e => setParamForm({ ...paramForm, manufacturing_date: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Temperature (°C)</label>
            <input
              type="number"
              value={paramForm.avg_temp_c}
              onChange={e => setParamForm({ ...paramForm, avg_temp_c: Number(e.target.value) })}
              className="input w-full"
              min="0"
              max="100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Humidity (%)</label>
            <input
              type="number"
              value={paramForm.avg_humidity_pct}
              onChange={e => setParamForm({ ...paramForm, avg_humidity_pct: Number(e.target.value) })}
              className="input w-full"
              min="0"
              max="100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Operational Cycles/Year</label>
            <input
              type="number"
              value={paramForm.operational_cycles_per_year}
              onChange={e => setParamForm({ ...paramForm, operational_cycles_per_year: Number(e.target.value) })}
              className="input w-full"
              min="0"
            />
          </div>
          <button onClick={saveParameters} className="btn bg-blue-600 text-white w-full" disabled={busy}>
            Save
          </button>
        </div>
      </Modal>

      <Modal open={showGantt} onClose={() => setShowGantt(false)} title="30-Year Obsolescence Gantt">
        {ganttData && (
          <GoogleChart
            chartType="Gantt"
            width="100%"
            height="400px"
            data={ganttData}
          />
        )}
      </Modal>

      <Modal open={showCapex} onClose={() => setShowCapex(false)} title="30-Year CAPEX Forecast">
        {capexData && <Line data={capexData} />}
      </Modal>

      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)} tipContent={tipContent} />

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50"><div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div></div>}
      {showConfetti && <Confetti />}
    </section>
  );
}
