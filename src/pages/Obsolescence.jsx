// Obsolescence.jsx (final)
import React, { useEffect, useState, useRef, Fragment } from 'react';
import { get, post } from '../lib/api.js';
import { HelpCircle, ChevronRight, ChevronDown, Calendar, Pencil } from 'lucide-react';
import { Line, Doughnut } from 'react-chartjs-2';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import jsPDF from 'jspdf';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarController, BarElement,
  PointElement, LineElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(CategoryScale, LinearScale, BarController, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, annotationPlugin, zoomPlugin);

function useUserSite() {
  try { return (JSON.parse(localStorage.getItem('eh_user') || '{}')?.site) || '' } catch { return '' }
}

function Toast({ msg, type='info' }) {
  const colors = { success:'bg-green-600 text-white', error:'bg-red-600 text-white', info:'bg-blue-600 text-white' };
  return <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-xl text-sm ${colors[type]} ring-1 ring-black/10`}>{msg}</div>;
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-green-50 to-orange-50">
          <h3 className="text-xl font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">×</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[70vh]">{children}</div>
      </div>
    </div>
  );
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
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [avgUrgency, setAvgUrgency] = useState(45);
  const [totalCapex, setTotalCapex] = useState(50000);

  // Quick Edit modal
  const [showQuick, setShowQuick] = useState(false);
  const [quick, setQuick] = useState({ switchboard_id:null, service_year:'', avg_life_years:30, override_cost_per_device:'' });

  useEffect(() => {
    loadBuildings();
    const t = setInterval(autoCheck, 300000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (tab === 'roll-up') loadGanttData();
    if (tab === 'analysis') { loadDoughnutData(); loadCapexForecast(); }
  }, [tab, selectedFilter]);

  const autoCheck = async () => {
    try {
      await post('/api/obsolescence/auto-check');
      loadBuildings();
      if (tab === 'roll-up') loadGanttData();
      if (tab === 'analysis') { loadDoughnutData(); loadCapexForecast(); }
    } catch {}
  };

  const loadBuildings = async () => {
    try {
      setBusy(true);
      const data = await get('/api/obsolescence/buildings');
      setBuildings(data.data || []);
      await post('/api/obsolescence/ai-fill'); // seed+defaults
      const u = await get('/api/obsolescence/avg-urgency'); setAvgUrgency(Number(u.avg || 45));
      const c = await get('/api/obsolescence/total-capex'); setTotalCapex(Number(c.total || 50000));
    } catch (e) {
      setToast({ msg: `Failed to load buildings: ${e.message}`, type: 'error' });
    } finally { setBusy(false); }
  };

  const loadSwitchboards = async (building) => {
    try {
      const data = await get('/api/obsolescence/switchboards', { building });
      setSwitchboards(prev => ({ ...prev, [building]: data.data || [] }));
    } catch (e) {
      setToast({ msg: `Switchboards failed: ${e.message}`, type: 'error' });
    }
  };

  const toggleBuilding = (building) => {
    setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }));
    if (!switchboards[building]) loadSwitchboards(building);
    setSelectedFilter(prev => ({ ...prev, building, switchboard: null }));
  };

  const loadGanttData = async () => {
    try {
      // N’envoie PAS de null/undefined
      const params = {};
      if (selectedFilter.building) params.building = selectedFilter.building;
      if (selectedFilter.switchboard) params.switchboard = selectedFilter.switchboard;

      const data = await get('/api/obsolescence/gantt-data', params);
      const tasks = (data.tasks || []).map(t => ({ ...t, start:new Date(t.start), end:new Date(t.end) }))
                       .filter(t => !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()));
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg: `Gantt failed: ${e.message}`, type: 'error' });
      setGanttTasks([]);
    }
  };

  const loadDoughnutData = async () => {
    try {
      const data = await get('/api/obsolescence/doughnut', { group:'building', ...selectedFilter });
      setDoughnutData(data.data || []);
    } catch (e) {
      setToast({ msg: `Doughnut failed: ${e.message}`, type: 'error' });
      setDoughnutData([]);
    }
  };

  const loadCapexForecast = async () => {
    try {
      const data = await get('/api/obsolescence/capex-forecast', { group:'building', ...selectedFilter });
      setCapexForecast(data.forecasts || {});
    } catch (e) {
      setToast({ msg: `CAPEX failed: ${e.message}`, type: 'error' });
      setCapexForecast({});
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

  const computeYears = () => Array.from({ length: 30 }, (_, i) => new Date().getFullYear() + i);

  const getCapexChartData = (forecasts) => {
    const years = computeYears();
    const datasets = [];
    Object.keys(forecasts).forEach(group => {
      const annual = years.map(y => forecasts[group].reduce((s, f) => s + (f.year === y ? f.capex_year : 0), 0));
      const cumul = annual.reduce((acc, cur, i) => [...acc, (acc[i-1] || 0) + cur], []);
      datasets.push({ type:'bar', label:`${group} Annual (£)`, data: annual, backgroundColor:'#1e90ff' });
      datasets.push({ type:'line', label:`${group} Cumulative (£)`, data: cumul, borderColor:'#32cd32', borderWidth:2, tension:0.3, fill:false });
    });
    return { labels: years, datasets };
  };

  const getCapexChartDataSingle = (forecasts, group) => {
    const years = computeYears();
    const annual = years.map(y => (forecasts[group] || []).reduce((s, f) => s + (f.year === y ? f.capex_year : 0), 0));
    const cumul = annual.reduce((acc, cur, i) => [...acc, (acc[i-1] || 0) + cur], []);
    return {
      labels: years,
      datasets: [
        { type:'bar', label:'Annual (£)', data: annual, backgroundColor:'#1e90ff' },
        { type:'line', label:'Cumulative (£)', data: cumul, borderColor:'#32cd32', borderWidth:2, tension:0.3, fill:false }
      ]
    };
  };

  const chartBigOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: v => `£${Number(v).toLocaleString('en-GB')}` } }
    },
    plugins: {
      legend: { position: 'top' },
      zoom: { zoom: { wheel: { enabled: true }, mode: 'xy' } },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: £${Number(ctx.raw).toLocaleString('en-GB')}` } }
    },
    animation: { duration: 600 }
  };

  const downloadICS = (sb) => {
    const y = sb.forecast_year || (new Date().getFullYear() + 1);
    const dt = `${y}0101T090000Z`;
    const ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ElectroHub//Obsolescence//EN
BEGIN:VEVENT
UID:${sb.id || Math.random()}@electrohub
DTSTAMP:${dt}
DTSTART:${dt}
SUMMARY:Replace ${sb.name} (forecast)
DESCRIPTION:Forecast replacement of ${sb.name}
END:VEVENT
END:VCALENDAR`;
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${sb.name}-forecast.ics`; a.click();
    URL.revokeObjectURL(url);
  };

  const openQuick = (sb) => {
    setQuick({
      switchboard_id: sb.id,
      service_year: sb.service_year || '',
      avg_life_years: sb.avg_life_years || 30,
      override_cost_per_device: ''
    });
    setShowQuick(true);
  };

  const saveQuick = async () => {
    try {
      await post('/api/obsolescence/quick-set', {
        switchboard_id: quick.switchboard_id,
        service_year: quick.service_year ? Number(quick.service_year) : undefined,
        avg_life_years: Number(quick.avg_life_years) || undefined,
        override_cost_per_device: quick.override_cost_per_device === '' ? undefined : Number(quick.override_cost_per_device)
      });
      setShowQuick(false);
      await loadBuildings();
      if (selectedFilter.building) await loadSwitchboards(selectedFilter.building);
      setToast({ msg: 'Saved!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    }
  };

  return (
    <section className="p-8 max-w-7xl mx-auto bg-gradient-to-br from-green-50 to-orange-50 rounded-3xl shadow-xl min-h-screen">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-800">Obsolescence Dashboard</h1>
        <div className="flex gap-4">
          <button onClick={() => { const pdf = new jsPDF(); pdf.text('Obsolescence Report', 10, 10); pdf.save('obsolescence-report.pdf'); }}
                  className="px-4 py-2 bg-green-600 text-white rounded-xl shadow-md hover:bg-green-700">Export PDF</button>
          <button onClick={() => setTab('analysis')} className="p-3 bg-orange-500 text-white rounded-xl shadow-md hover:bg-orange-600">
            <HelpCircle size={20} />
          </button>
        </div>
      </header>

      <div className="flex gap-4 mb-8 border-b pb-2">
        <button onClick={() => setTab('overview')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'overview' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Overview</button>
        <button onClick={() => setTab('roll-up')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'roll-up' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-600'}`}>Roll-up</button>
        <button onClick={() => setTab('analysis')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'analysis' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Analysis</button>
      </div>

      {tab === 'overview' && (
        <>
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
              <p className="text-3xl font-bold text-green-600">£{Number(totalCapex).toLocaleString('en-GB')}</p>
            </div>
          </div>

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
                {buildings.map(b => (
                  <Fragment key={`b-${b.building}`}>
                    <tr className="hover:bg-green-50/50 transition-colors">
                      <td className="p-4 cursor-pointer" onClick={() => { setExpandedBuildings(prev => ({ ...prev, [b.building]: !prev[b.building] })); if (!switchboards[b.building]) loadSwitchboards(b.building); }}>
                        {expandedBuildings[b.building] ? <ChevronDown className="inline mr-2" /> : <ChevronRight className="inline mr-2" />}
                        {b.building} ({b.count} switchboards)
                      </td>
                      <td className="p-4"></td>
                      <td className="p-4">£{Number(b.total_cost || 0).toLocaleString('en-GB')}</td>
                      <td className="p-4"></td>
                      <td className="p-4"></td>
                    </tr>

                    {expandedBuildings[b.building] && (switchboards[b.building] || []).map(sb => (
                      <tr key={`sb-${sb.id}`} className="bg-orange-50 hover:bg-orange-100 transition-colors">
                        <td className="p-4 pl-8">{sb.name}</td>
                        <td className="p-4">{sb.service_year ?? 'N/A'}</td>
                        <td className="p-4">£{Number(sb.total_cost || 0).toLocaleString('en-GB')}</td>
                        <td className="p-4">{sb.forecast_year ?? 'N/A'}</td>
                        <td className="p-4 flex gap-3">
                          <button onClick={() => openQuick(sb)} className="text-green-700 hover:text-green-900" title="Quick edit"><Pencil size={16} /></button>
                          <button onClick={() => {
                            const y = sb.forecast_year ?? (new Date().getFullYear() + 1);
                            const dt = `${y}-01-01`;
                            downloadICS({ ...sb, forecast_year: y, dt });
                          }} className="text-blue-700 hover:text-blue-900" title="Add to calendar"><Calendar size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'roll-up' && (
        <div className="h-[600px] overflow-auto bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          {ganttTasks.length ? (
            <Gantt
              tasks={ganttTasks}
              viewMode={ViewMode.Year}        // plus universel que "Decade"
              columnWidth={120}
              listCellWidth="250px"
              todayColor="#ff6b00"
            />
          ) : <p className="text-gray-600 text-center py-20">No data available yet.</p>}
        </div>
      )}

      {tab === 'analysis' && (
        <div className="grid grid-cols-1 gap-8">
          {/* Grand graphique plein écran */}
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5 h-[640px]">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">CAPEX Forecast — All Buildings</h2>
            {Object.keys(capexForecast).length ? (
              <Line data={getCapexChartData(capexForecast)} options={chartBigOptions} />
            ) : <p className="text-gray-600 text-center py-20">No data.</p>}
          </div>

          {/* Doughnut */}
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Urgency Distribution</h2>
            {doughnutData.length ? <Doughnut data={getDoughnutChartData(doughnutData)} /> : <p className="text-gray-600 text-center py-20">No data.</p>}
          </div>

          {/* Mini-charts par bâtiment */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {Object.keys(capexForecast).map(group => (
              <div key={group} className="bg-white p-5 rounded-2xl shadow-md ring-1 ring-black/5 h-[320px]">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Building {group}</h3>
                <Line data={getCapexChartDataSingle(capexForecast, group)} options={{
                  ...chartBigOptions, maintainAspectRatio:false, animation:{ duration:500 }
                }} />
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={showQuick} onClose={() => setShowQuick(false)} title="Quick edit (Switchboard)">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Service Year</label>
            <input type="number" min="1950" max="2100" step="1" value={quick.service_year ?? ''} onChange={e => setQuick(q => ({ ...q, service_year: e.target.value }))} className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Avg Life (years)</label>
            <input type="number" min="10" max="60" step="1" value={quick.avg_life_years ?? 30} onChange={e => setQuick(q => ({ ...q, avg_life_years: Number(e.target.value) }))} className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Override Cost per Device (£) — optional</label>
            <input type="number" min="0" step="10" value={quick.override_cost_per_device} onChange={e => setQuick(q => ({ ...q, override_cost_per_device: e.target.value }))} className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10" />
          </div>
          <button onClick={saveQuick} className="w-full p-2 bg-orange-600 text-white rounded-xl shadow-md hover:bg-orange-700">Save</button>
        </div>
      </Modal>

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><div className="animate-spin h-16 w-16 border-b-4 border-green-500 rounded-full"></div></div>}
    </section>
  );
}
