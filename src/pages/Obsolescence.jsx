// src/pages/Obsolescence.jsx (final patched - switchboards only, £, actions at SB level)
import React, { useEffect, useState, useRef, Fragment } from 'react';
import { get, post, upload } from '../lib/api.js';
import { HelpCircle, ChevronRight, Settings, Upload, ChevronDown, Send, Calendar } from 'lucide-react';
import { Line, Doughnut } from 'react-chartjs-2';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
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
        <button onClick={onClose}><span className="sr-only">Close</span>×</button>
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

// simple ICS export for a given switchboard forecast year
function downloadICS(sbName, year) {
  if (!year || isNaN(Number(year))) return;
  const start = `${year}-06-01T09:00:00Z`;
  const end = `${year}-06-01T10:00:00Z`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ElectroHub//Obsolescence//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@electrohub`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').split('.')[0]}Z`,
    `DTSTART:${start.replace(/[-:]/g,'').replace('.000','')}`,
    `DTEND:${end.replace(/[-:]/g,'').replace('.000','')}`,
    `SUMMARY:Replacement planning - ${sbName}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `replacement_${sbName}_${year}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const [aiTips, setAiTips] = useState([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const chartRef = useRef(null);
  const ganttRef = useRef(null);
  const [avgUrgency, setAvgUrgency] = useState(45);
  const [totalCapex, setTotalCapex] = useState(50000);

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
      await post('/api/obsolescence/ai-fill'); // populate sensible defaults
      const urgencyRes = await get('/api/obsolescence/avg-urgency');
      setAvgUrgency(Number(urgencyRes.avg || 45));
      const capexRes = await get('/api/obsolescence/total-capex');
      setTotalCapex(Number(capexRes.total || 50000));
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
      })).filter(task => !isNaN(task.start.getTime()) && !isNaN(task.end.getTime()));
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg: `Gantt failed: ${e.message}`, type: 'error' });
      setGanttTasks([]);
    }
  };

  const loadDoughnutData = async () => {
    try {
      const params = { group: 'building', ...selectedFilter };
      const data = await get('/api/obsolescence/doughnut', params);
      setDoughnutData(data.data || []);
    } catch (e) {
      setToast({ msg: `Doughnut failed: ${e.message}`, type: 'error' });
      setDoughnutData([]);
    }
  };

  const loadCapexForecast = async () => {
    try {
      const params = { group: 'building', ...selectedFilter };
      const data = await get('/api/obsolescence/capex-forecast', params);
      setCapexForecast(data.forecasts || {});
    } catch (e) {
      setToast({ msg: `CAPEX failed: ${e.message}`, type: 'error' });
      setCapexForecast({});
    }
  };

  const handleAiQuery = async (query) => {
    try {
      const { response, updates } = await post('/api/obsolescence/ai-query', { query, site });
      setAiTips(prev => [...prev, { id: Date.now(), content: response }].slice(-5));
      if (updates) {
        loadBuildings();
      }
    } catch (e) {
      setToast({ msg: `AI query failed: ${e.message}`, type: 'error' });
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
        label: `${group} Annual (£)`,
        data: annual,
        backgroundColor: '#1e90ff',
      });
      datasets.push({
        type: 'line',
        label: `${group} Cumulative (£)`,
        data: cumul,
        borderColor: '#32cd32',
        fill: false,
      });
    });
    return { labels: years, datasets };
  };

  return (
    <section className="p-8 max-w-7xl mx-auto bg-gradient-to-br from-green-50 to-orange-50 rounded-3xl shadow-xl min-h-screen">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-800">Obsolescence Dashboard</h1>
        <div className="flex gap-4">
          <button onClick={() => {
            const pdf = new jsPDF();
            pdf.text('Obsolescence Report', 10, 10);
            pdf.save('obsolescence-report.pdf');
          }} className="px-4 py-2 bg-green-500 text-white rounded-xl shadow-md hover:bg-green-600">Export PDF</button>
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
            <p className="text-3xl font-bold text-orange-600">{Number(avgUrgency).toFixed(1)}%</p>
          </div>
          <div className="p-6 bg-white rounded-2xl shadow-md ring-1 ring-black/5">
            <h3 className="text-lg font-bold text-gray-800">Total CAPEX Forecast</h3>
            <p className="text-3xl font-bold text-green-600">£{Number(totalCapex).toLocaleString()}</p>
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
                <th className="p-4">Est. Replacement Cost</th>
                <th className="p-4">Forecast Replacement Date</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map(build => (
                <Fragment key={`b-${build.building}`}>
                  <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-green-50/50 transition-colors">
                    <td className="p-4 flex items-center cursor-pointer" onClick={() => toggleBuilding(build.building)}>
                      {expandedBuildings[build.building] ? <ChevronDown /> : <ChevronRight />} {build.building} ({build.count} switchboards)
                    </td>
                    <td></td>
                    <td className="p-4 font-semibold">£{Number(build.total_cost || 0).toLocaleString()}</td>
                    <td></td>
                    <td></td>
                  </motion.tr>
                  {expandedBuildings[build.building] && (switchboards[build.building] || []).map(sb => (
                    <motion.tr key={`sb-${sb.id}`} className="bg-orange-50 hover:bg-orange-100 transition-colors">
                      <td className="p-4 pl-8">{sb.name} (Floor: {sb.floor})</td>
                      <td className="p-4">{sb.service_year || 'N/A'}</td>
                      <td className="p-4 font-semibold">£{Number(sb.estimated_cost_gbp || 0).toLocaleString()}</td>
                      <td className="p-4">{sb.forecast_year || 'N/A'}</td>
                      <td className="p-4 flex gap-2">
                        <button onClick={() => downloadICS(sb.name, sb.forecast_year)} className="text-blue-600 hover:text-blue-800" title="Add to Calendar">
                          <Calendar size={16} />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </Fragment>
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
          ) : <p className="text-gray-600 text-center py-20">No data available yet.</p>}
        </div>
      )}

      {tab === 'analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Urgency Distribution</h2>
            {doughnutData.length ? (
              <Doughnut data={getDoughnutChartData(doughnutData)} options={{ responsive: true, plugins: { legend: { position: 'top' } } }} />
            ) : <p className="text-gray-600 text-center py-20">No data.</p>}
          </div>
          <div ref={chartRef} className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">CAPEX Forecast</h2>
            {Object.keys(capexForecast).length ? (
              <Line data={getCapexChartData(capexForecast)} options={{ responsive: true, plugins: { zoom: { zoom: { wheel: { enabled: true }, mode: 'xy' } } } }} />
            ) : <p className="text-gray-600 text-center py-20">No data.</p>}
          </div>
        </div>
      )}

      <AnimatePresence>
        <Sidebar tips={aiTips} open={showSidebar} onClose={() => setShowSidebar(false)} onSendQuery={handleAiQuery} />
      </AnimatePresence>

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><div className="animate-spin h-16 w-16 border-b-4 border-green-500 rounded-full"></div></div>}
    </section>
  );
}
