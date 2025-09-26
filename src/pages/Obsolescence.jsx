// src/pages/Obsolescence.jsx
import { useEffect, useState, useRef } from 'react';
import { get, post, upload } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Download, ChevronRight, Settings, Upload, ChevronDown, Send, Calendar } from 'lucide-react';
import { Line, Bar, Doughnut, Scatter } from 'react-chartjs-2';
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
  ScatterController,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import * as yup from 'yup';
import debounce from 'lodash/debounce';

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
  zoomPlugin,
  ScatterController
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
      <p className="text-sm text-gray-600 mb-4">Exemples : 'Analyse du tableau X', 'Estimer le coût de remplacement', 'Set temp 30 pour switchboard Y'</p>
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

const paramSchema = yup.object({
  manufacture_date: yup.date().required('Date de fabrication requise').max(new Date(), 'Date future non autorisée'),
  avg_temperature: yup.number().required('Température requise').min(0).max(100),
  avg_humidity: yup.number().required('Humidité requise').min(0).max(100),
  operation_cycles: yup.number().required('Cycles requis').min(0),
  avg_life_years: yup.number().required('Années de vie requises').min(10),
  replacement_cost: yup.number().required('Coût requis').min(0),
  document_link: yup.string().url('Lien invalide').nullable(),
});

export default function Obsolescence() {
  const site = useUserSite();
  const [tab, setTab] = useState('overview');
  const [buildings, setBuildings] = useState([]);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [switchboards, setSwitchboards] = useState({});
  const [selectedFilter, setSelectedFilter] = useState({ building: null, switchboard: null });
  const [ganttTasks, setGanttTasks] = useState([]);
  const [doughnutData, setDoughnutData] = useState([]);
  const [capexForecast, setCapexForecast] = useState({});
  const [costByBuildingData, setCostByBuildingData] = useState([]);
  const [urgencyVsAgeData, setUrgencyVsAgeData] = useState([]);
  const [aiTips, setAiTips] = useState([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({
    switchboard_id: null, manufacture_date: '2000-01-01', avg_temperature: 25, avg_humidity: 50,
    operation_cycles: 5000, avg_life_years: 30, replacement_cost: 1000, document_link: ''
  });
  const [paramErrors, setParamErrors] = useState({});
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const chartRef = useRef(null);
  const ganttRef = useRef(null);
  const [avgUrgency, setAvgUrgency] = useState(45);
  const [totalCapex, setTotalCapex] = useState(50000);
  const [selectedSwitchboard, setSelectedSwitchboard] = useState(null);
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
      loadCostByBuilding();
      loadUrgencyVsAge();
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
        loadCostByBuilding();
        loadUrgencyVsAge();
      }
    } catch (e) {
      console.error('Auto check failed', e);
      setToast({ msg: 'Échec de la vérification automatique : Vérifiez votre connexion.', type: 'error' });
    }
  };

  const loadBuildings = async () => {
    try {
      setBusy(true);
      const data = await get('/api/obsolescence/buildings');
      setBuildings(data.data || []);
      await post('/api/obsolescence/ai-fill'); // Auto-fill with AI
      const urgencyRes = await get('/api/obsolescence/avg-urgency');
      setAvgUrgency(Number(urgencyRes.avg) || 45);
      const capexRes = await get('/api/obsolescence/total-capex');
      setTotalCapex(Number(capexRes.total) || 50000);
    } catch (e) {
      setToast({ msg: `Échec du chargement des bâtiments : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const loadSwitchboards = async (building) => {
    try {
      const data = await get('/api/obsolescence/switchboards', { building });
      setSwitchboards(prev => ({ ...prev, [building]: data.data }));
    } catch (e) {
      setToast({ msg: `Échec : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
    }
  };

  const toggleBuilding = (building) => {
    setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }));
    if (!switchboards[building]) loadSwitchboards(building);
    setSelectedFilter(prev => ({ ...prev, building, switchboard: null }));
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
      setToast({ msg: `Échec du Gantt : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
      setGanttTasks([]); 
    }
  };

  const loadDoughnutData = async () => {
    try {
      const params = { group: 'building', ...selectedFilter };
      const data = await get('/api/obsolescence/doughnut', params);
      setDoughnutData(data.data || []);
    } catch (e) {
      setToast({ msg: `Échec du camembert : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
      setDoughnutData([]); 
    }
  };

  const loadCapexForecast = async () => {
    try {
      const params = { group: 'building', ...selectedFilter };
      const data = await get('/api/obsolescence/capex-forecast', params);
      setCapexForecast(data.forecasts || {});
    } catch (e) {
      setToast({ msg: `Échec du CAPEX : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
      setCapexForecast({}); 
    }
  };

  const loadCostByBuilding = async () => {
    try {
      const data = await get('/api/obsolescence/cost-by-building');
      setCostByBuildingData(data.data || []);
    } catch (e) {
      setCostByBuildingData([]);
    }
  };

  const loadUrgencyVsAge = async () => {
    try {
      const data = await get('/api/obsolescence/urgency-vs-age');
      setUrgencyVsAgeData(data.data || []);
    } catch (e) {
      setUrgencyVsAgeData([]);
    }
  };

  const debouncedAiQuery = debounce(async (query) => {
    try {
      const { response, updates } = await post('/api/obsolescence/ai-query', { query, site });
      setAiTips(prev => [...prev, { id: Date.now(), content: response }].slice(-5));
      if (updates) {
        loadBuildings(); 
      }
    } catch (e) {
      setToast({ msg: `Échec de la requête IA : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
    }
  }, 500);

  const handleAiQuery = (query) => debouncedAiQuery(query);

  const handlePdfUpload = async () => {
    if (!pdfFile) {
      setToast({ msg: 'Aucun PDF sélectionné', type: 'error' });
      return;
    }
    try {
      setBusy(true);
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('switchboard_id', paramForm.switchboard_id);
      const { manufacture_date } = await upload('/api/obsolescence/analyze-pdf', formData);
      setParamForm({ ...paramForm, manufacture_date });
      setToast({ msg: 'PDF analysé avec succès !', type: 'success' });
    } catch (e) {
      setToast({ msg: `Échec du PDF : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const saveParameters = async () => {
    try {
      await paramSchema.validate(paramForm, { abortEarly: false });
      setParamErrors({});
      const flatForm = { ...paramForm };
      await post('/api/obsolescence/parameters', flatForm);
      setToast({ msg: 'Paramètres sauvegardés !', type: 'success' });
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      loadBuildings();
      setShowParamsModal(false);
    } catch (e) {
      if (e.name === 'ValidationError') {
        const errors = e.inner.reduce((acc, err) => ({ ...acc, [err.path]: err.message }), {});
        setParamErrors(errors);
      } else {
        setToast({ msg: `Échec de la sauvegarde : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
      }
    }
  };

  const exportPdf = async () => {
    try {
      setBusy(true);
      const pdf = new jsPDF();
      pdf.text('Rapport Obsolescence', 10, 10);
      if (chartRef.current) {
        const canvas = await html2canvas(chartRef.current);
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 20, 190, 100);
      }
      if (ganttRef.current) {
        const ganttCanvas = await html2canvas(ganttRef.current);
        pdf.addPage();
        pdf.addImage(ganttCanvas.toDataURL('image/png'), 'PNG', 10, 10, 190, 100);
      }
      pdf.save('rapport-obsolescence.pdf');
      setToast({ msg: 'PDF exporté avec succès !', type: 'success' });
    } catch (e) {
      setToast({ msg: `Échec de l\'export : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const getDoughnutChartData = (data) => ({
    labels: data.map(d => d.label || 'Inconnu'),
    datasets: [
      { label: 'OK', data: data.map(d => d.ok || 0), backgroundColor: '#00ff00' },
      { label: 'Avertissement', data: data.map(d => d.warning || 0), backgroundColor: '#ffa500' },
      { label: 'Critique', data: data.map(d => d.critical || 0), backgroundColor: '#ff0000' },
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
        label: `${group} Annuel (€)`,
        data: annual,
        backgroundColor: '#1e90ff',
      });
      datasets.push({
        type: 'line',
        label: `${group} Cumulatif (€)`,
        data: cumul,
        borderColor: '#32cd32',
        fill: false,
      });
    });
    return { labels: years, datasets };
  };

  const getCostByBuildingData = (data) => ({
    labels: data.map(d => d.building),
    datasets: [{
      label: 'Coût par bâtiment (€)',
      data: data.map(d => d.total_cost),
      backgroundColor: '#ff6384',
    }],
  });

  const getUrgencyVsAgeData = (data) => ({
    datasets: [{
      label: 'Urgence vs Âge',
      data: data.map(d => ({ x: d.age, y: d.urgency })),
      backgroundColor: '#36a2eb',
    }],
  });

  const openAnnualGantt = async (task) => {
    try {
      const data = await get('/api/obsolescence/annual-gantt', { switchboard_id: task.id });
      setAnnualGanttTasks(data.tasks || []);
      setSelectedSwitchboard({ name: task.name });
      setShowGanttModal(true);
    } catch (e) {
      setToast({ msg: `Échec du Gantt annuel : ${e.message}. Vérifiez votre connexion.`, type: 'error' });
    }
  };

  return (
    <section className="p-8 max-w-7xl mx-auto bg-gradient-to-br from-green-50 to-orange-50 rounded-3xl shadow-xl min-h-screen">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-800">Tableau de Bord Obsolescence</h1>
        <div className="flex gap-4">
          <button onClick={exportPdf} className="px-4 py-2 bg-green-500 text-white rounded-xl shadow-md hover:bg-green-600">Exporter PDF</button>
          <button onClick={() => setShowSidebar(true)} className="p-3 bg-orange-500 text-white rounded-xl shadow-md hover:bg-orange-600">
            <HelpCircle size={24} />
          </button>
        </div>
      </header>

      <div className="flex gap-4 mb-8 border-b pb-2">
        <button onClick={() => setTab('overview')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'overview' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Vue Globale</button>
        <button onClick={() => setTab('roll-up')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'roll-up' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-600'}`}>Roll-up</button>
        <button onClick={() => setTab('analysis')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'analysis' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Analyse</button>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="p-6 bg-white rounded-2xl shadow-md ring-1 ring-black/5">
            <h3 className="text-lg font-bold text-gray-800">Total Bâtiments</h3>
            <p className="text-3xl font-bold text-green-600">{buildings.length}</p>
          </div>
          <div className="p-6 bg-white rounded-2xl shadow-md ring-1 ring-black/5">
            <h3 className="text-lg font-bold text-gray-800">Urgence Moyenne</h3>
            <p className="text-3xl font-bold text-orange-600">{Number(avgUrgency).toFixed(1)}%</p>
          </div>
          <div className="p-6 bg-white rounded-2xl shadow-md ring-1 ring-black/5">
            <h3 className="text-lg font-bold text-gray-800">Prévision CAPEX Totale</h3>
            <p className="text-3xl font-bold text-green-600">€{Number(totalCapex).toLocaleString()}</p>
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="overflow-x-auto bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          <input type="text" placeholder="Rechercher un bâtiment ou tableau..." className="w-full p-3 mb-4 rounded-xl bg-gray-50 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500" />
          <table className="w-full text-left">
            <thead>
              <tr className="bg-green-50 text-gray-700">
                <th className="p-4">Nom</th>
                <th className="p-4">Année de Service</th>
                <th className="p-4">Document</th>
                <th className="p-4">Coût de Remplacement Est.</th>
                <th className="p-4">Année de Remplacement Prévue</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map(build => (
                <>
                  <motion.tr key={build.building} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-green-50/50 transition-colors">
                    <td className="p-4 flex items-center cursor-pointer" onClick={() => toggleBuilding(build.building)}>
                      {expandedBuildings[build.building] ? <ChevronDown /> : <ChevronRight />} {build.building} ({build.count} tableaux)
                    </td>
                    <td></td><td></td><td>€{Number(build.total_cost).toLocaleString() || 'N/A'}</td><td></td><td></td>
                  </motion.tr>
                  {expandedBuildings[build.building] && switchboards[build.building]?.map(sb => (
                    <motion.tr key={sb.id} className="bg-orange-50 hover:bg-orange-100 transition-colors">
                      <td className="p-4 pl-8">{sb.name} (Étage: {sb.floor})</td>
                      <td className="p-4">{new Date(sb.manufacture_date).getFullYear() || 'N/A'}</td>
                      <td className="p-4">{sb.document_link ? <a href={sb.document_link} className="text-blue-600 underline">Lien</a> : 'N/A'}</td>
                      <td className="p-4">€{Number(sb.total_cost).toLocaleString() || 'N/A'}</td>
                      <td className="p-4">{sb.remaining_life_years ? new Date().getFullYear() + Number(sb.remaining_life_years) : 'N/A'}</td>
                      <td className="p-4 flex gap-2">
                        <button onClick={() => { setParamForm({ ...sb }); setShowParamsModal(true); }} className="text-green-600 hover:text-green-800"><Settings size={16} /></button>
                        <button onClick={() => openAnnualGantt({ id: sb.id, name: sb.name })} className="text-blue-600 hover:text-blue-800"><Calendar size={16} /></button>
                      </td>
                    </motion.tr>
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
              onClick={openAnnualGantt}
            />
          ) : <p className="text-gray-600 text-center py-20">Aucune donnée disponible. L\'IA analyse...</p>}
        </div>
      )}

      {tab === 'analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Distribution d\'Urgence</h2>
            {doughnutData.length ? (
              <Doughnut data={getDoughnutChartData(doughnutData)} options={{ responsive: true, plugins: { legend: { position: 'top' } } }} />
            ) : <p className="text-gray-600 text-center py-20">Aucune donnée. Exécution de l\'analyse IA...</p>}
          </div>
          <div ref={chartRef} className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Prévision CAPEX</h2>
            {Object.keys(capexForecast).length ? (
              <Line data={getCapexChartData(capexForecast)} options={{ responsive: true, plugins: { zoom: { zoom: { wheel: { enabled: true }, mode: 'xy' } } } }} />
            ) : <p className="text-gray-600 text-center py-20">Aucune donnée. Exécution de l\'analyse IA...</p>}
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Coûts par Bâtiment</h2>
            {costByBuildingData.length ? (
              <Bar data={getCostByBuildingData(costByBuildingData)} options={{ responsive: true }} />
            ) : <p className="text-gray-600 text-center py-20">Aucune donnée.</p>}
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Urgence vs Âge</h2>
            {urgencyVsAgeData.length ? (
              <Scatter data={getUrgencyVsAgeData(urgencyVsAgeData)} options={{ responsive: true }} />
            ) : <p className="text-gray-600 text-center py-20">Aucune donnée.</p>}
          </div>
        </div>
      )}

      <AnimatePresence>
        <Sidebar tips={aiTips} open={showSidebar} onClose={() => setShowSidebar(false)} onSendQuery={handleAiQuery} />
      </AnimatePresence>

      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Modifier Paramètres">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Date de Fabrication <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type="date"
                value={paramForm.manufacture_date}
                onChange={e => setParamForm({ ...paramForm, manufacture_date: e.target.value })}
                className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              />
              <Calendar className="absolute right-2 top-2 text-gray-500" size={20} />
            </div>
            {paramErrors.manufacture_date && <p className="text-red-500 text-xs">{paramErrors.manufacture_date}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Température Moyenne (°C) - Température ambiante typique</label>
            <input
              type="number"
              value={paramForm.avg_temperature}
              onChange={e => setParamForm({ ...paramForm, avg_temperature: Number(e.target.value) })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              min="0"
              step="0.1"
            />
            {paramErrors.avg_temperature && <p className="text-red-500 text-xs">{paramErrors.avg_temperature}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Humidité Moyenne (%) - Humidité relative typique</label>
            <input
              type="number"
              value={paramForm.avg_humidity}
              onChange={e => setParamForm({ ...paramForm, avg_humidity: Number(e.target.value) })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              min="0"
              max="100"
              step="1"
            />
            {paramErrors.avg_humidity && <p className="text-red-500 text-xs">{paramErrors.avg_humidity}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Cycles d\'Opération - Nombre de cycles d\'activation typiques</label>
            <input
              type="number"
              value={paramForm.operation_cycles}
              onChange={e => setParamForm({ ...paramForm, operation_cycles: Number(e.target.value) })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              min="0"
            />
            {paramErrors.operation_cycles && <p className="text-red-500 text-xs">{paramErrors.operation_cycles}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Années de Vie Moyennes (Norm) - Durée de vie normative</label>
            <input
              type="number"
              value={paramForm.avg_life_years}
              onChange={e => setParamForm({ ...paramForm, avg_life_years: Number(e.target.value) })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              min="10"
              step="1"
            />
            {paramErrors.avg_life_years && <p className="text-red-500 text-xs">{paramErrors.avg_life_years}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Coût de Remplacement (€) - Coût estimé du remplacement</label>
            <input
              type="number"
              value={paramForm.replacement_cost}
              onChange={e => setParamForm({ ...paramForm, replacement_cost: Number(e.target.value) })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
              min="0"
              step="100"
            />
            {paramErrors.replacement_cost && <p className="text-red-500 text-xs">{paramErrors.replacement_cost}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Lien Document - URL vers la documentation</label>
            <input
              type="text"
              value={paramForm.document_link}
              onChange={e => setParamForm({ ...paramForm, document_link: e.target.value })}
              className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10 focus:ring-2 focus:ring-green-500"
            />
            {paramErrors.document_link && <p className="text-red-500 text-xs">{paramErrors.document_link}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Télécharger PDF pour Extraction IA</label>
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0])} className="w-full p-2 rounded-xl bg-gray-50 text-gray-800 ring-1 ring-black/10" />
            <button onClick={handlePdfUpload} className="mt-2 w-full p-2 bg-green-500 text-white rounded-xl shadow-md hover:bg-green-600" disabled={busy || !pdfFile}>
              <Upload size={16} /> Analyser PDF
            </button>
          </div>
          <button
            onClick={saveParameters}
            className="w-full p-2 bg-orange-500 text-white rounded-xl shadow-md hover:bg-orange-600"
            disabled={busy}
          >
            Sauvegarder Paramètres
          </button>
        </div>
      </Modal>

      <Modal open={showGanttModal} onClose={() => setShowGanttModal(false)} title={`Gantt Annuel pour ${selectedSwitchboard?.name}`}>
        <div className="h-[400px]">
          {annualGanttTasks.length ? (
            <Gantt
              tasks={annualGanttTasks}
              viewMode={ViewMode.Month}
              columnWidth={80}
              listCellWidth="200px"
              todayColor="#ff6b00"
              onClick={task => handleAiQuery(`Expliquer Gantt annuel pour ${task.name}`)}
            />
          ) : <p className="text-gray-600 text-center py-20">Aucune donnée annuelle</p>}
        </div>
      </Modal>

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><div className="animate-spin h-16 w-16 border-b-4 border-green-500 rounded-full"></div></div>}
      {showConfetti && <Confetti />}
    </section>
  );
}
