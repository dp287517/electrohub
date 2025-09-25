// src/pages/Obsolescence.jsx
import { useEffect, useState, useRef } from 'react';
import { get, post, upload } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Download, ChevronRight, Settings, Upload, ChevronDown } from 'lucide-react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import Confetti from 'react-confetti';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Annotation,
  Zoom,
} from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Annotation, Zoom);

function useUserSite() {
  // inchangé
}

function Toast({ msg, type }) {
  // inchangé, mais design plus moderne
}

function Modal({ open, onClose, children, title }) {
  // inchangé, mais plus élégant
}

function Sidebar({ tips, open, onClose }) {
  if (!open) return null;
  return (
    <motion.div
      initial={{ x: 300 }}
      animate={{ x: 0 }}
      exit={{ x: 300 }}
      className="fixed right-0 top-0 h-full w-80 bg-gradient-to-b from-indigo-50 to-white shadow-2xl z-40 overflow-y-auto p-6 rounded-l-2xl"
    >
      <div className="flex justify-between mb-4">
        <h3 className="text-xl font-bold text-indigo-800">AI Insights</h3>
        <button onClick={onClose}><X size={20} /></button>
      </div>
      {tips.map(tip => (
        <motion.p key={tip.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-gray-700 mb-3 p-3 bg-white rounded-lg shadow">{tip.content}</motion.p>
      ))}
    </motion.div>
  );
}

export default function Obsolescence() {
  const site = useUserSite();
  const [tab, setTab] = useState('overview');
  const [buildings, setBuildings] = useState([]);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [expandedSwitchboards, setExpandedSwitchboards] = useState({});
  const [switchboards, setSwitchboards] = useState({}); // {building: [switchboards]}
  const [devices, setDevices] = useState({}); // {switchboardId: [devices]}
  const [selectedFilter, setSelectedFilter] = useState({ building: null, switchboard: null });
  const [ganttTasks, setGanttTasks] = useState([]);
  const [doughnutData, setDoughnutData] = useState([]);
  const [capexForecast, setCapexForecast] = useState({});
  const [aiTips, setAiTips] = useState([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({
    device_id: null, switchboard_id: null, manufacture_date: '2000-01-01', avg_temperature: 25, avg_humidity: 50,
    operation_cycles: 5000, avg_life_years: 25, replacement_cost: 1000, document_link: ''
  });
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const chartRef = useRef(null);
  const ganttRef = useRef(null);

  useEffect(() => {
    loadBuildings();
  }, []);

  useEffect(() => {
    if (tab === 'roll-up') loadGanttData();
    if (tab === 'analysis') {
      loadDoughnutData();
      loadCapexForecast();
    }
  }, [tab, selectedFilter]);

  const loadBuildings = async () => {
    try {
      setBusy(true);
      const data = await get('/api/obsolescence/buildings');
      setBuildings(data.data);
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
    setSelectedFilter(prev => ({ ...prev, switchboard }));
  };

  const loadGanttData = async () => {
    try {
      const params = { ...selectedFilter };
      const data = await get('/api/obsolescence/gantt-data', params);
      const tasks = data.tasks.map(task => ({
        ...task,
        start: new Date(task.start),
        end: new Date(task.end),
      })).filter(task => !isNaN(task.start.getTime()));
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg: `Gantt failed: ${e.message}`, type: 'error' });
    }
  };

  // Similaires pour doughnut et capex, avec params filter

  const handleCheck = async (device) => {
    // inchangé, mais refresh hiérarchie après
    loadBuildings();
  };

  const saveParameters = async () => {
    try {
      const flatForm = { ...paramForm }; // Assure plat
      await post('/api/obsolescence/parameters', flatForm);
      setToast({ msg: 'Saved!', type: 'success' });
      // Refresh data
      loadBuildings();
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    }
  };

  // Autres fonctions inchangées, mais adaptées

  return (
    <section className="p-6 max-w-7xl mx-auto bg-gradient-to-br from-white to-indigo-50 rounded-3xl shadow-xl">
      <h1 className="text-4xl font-bold mb-8 text-indigo-900">Obsolescence CAPEX Forecasting</h1>

      {/* Onglets */}
      <div className="flex gap-4 mb-6 border-b pb-2">
        <button onClick={() => setTab('overview')} className={`px-6 py-2 rounded-t-lg ${tab === 'overview' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600'}`}>Overview</button>
        <button onClick={() => setTab('roll-up')} className={`px-6 py-2 rounded-t-lg ${tab === 'roll-up' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600'}`}>Roll-up</button>
        <button onClick={() => setTab('analysis')} className={`px-6 py-2 rounded-t-lg ${tab === 'analysis' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600'}`}>Analysis</button>
      </div>

      {tab === 'overview' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-indigo-100">
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
                <motion.tr key={build.building} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <td className="p-4 flex items-center cursor-pointer" onClick={() => toggleBuilding(build.building)}>
                    {expandedBuildings[build.building] ? <ChevronDown /> : <ChevronRight />} {build.building} ({build.count} items)
                  </td>
                  <td></td><td></td><td>€{build.total_cost.toLocaleString()}</td><td></td>
                  <td></td>
                </motion.tr>
              ))}
              {/* Sous-lignes pour switchboards et devices de manière similaire, avec clics et colonnes remplies */}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'roll-up' && (
        <div ref={ganttRef} className="h-[600px] overflow-auto border rounded-2xl p-4 bg-white shadow-lg">
          <Gantt
            tasks={ganttTasks}
            viewMode={ViewMode.Year}
            columnWidth={120}
            listCellWidth="250px"
            todayColor="#ff0000" // Highlight année actuelle
            onClick={task => getAiTip(`Strategy for ${task.name}`)}
            // Zoom auto sur current year
          />
        </div>
      )}

      {tab === 'analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-2xl shadow-lg">
            <h2 className="text-2xl font-semibold mb-4">Urgency Distribution</h2>
            <Doughnut data={getDoughnutChartData(doughnutData)} options={{ /* options splendides avec gradients */ }} />
          </div>
          <div ref={chartRef} className="bg-white p-6 rounded-2xl shadow-lg">
            <h2 className="text-2xl font-semibold mb-4">CAPEX Forecast</h2>
            <Line data={getCapexChartData(capexForecast)} options={{ /* courbe splendide avec annotations, zoom */ }} />
          </div>
        </div>
      )}

      <AnimatePresence>
        <Sidebar tips={aiTips} open={showSidebar} onClose={() => setShowSidebar(false)} />
      </AnimatePresence>

      {/* Modals, toasts, confetti inchangés */}

      <button onClick={() => setShowSidebar(true)} className="fixed bottom-8 right-8 bg-indigo-600 text-white p-4 rounded-full shadow-lg">
        <HelpCircle size={24} />
      </button>
    </section>
  );
}