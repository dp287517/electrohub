// Obsolescence.jsx (CSP-safe, AI assistant, filters, PDF, radar centered, Gantt colors per building, pricing note)
import React, { useEffect, useState, Fragment } from 'react';
import { get, post } from '../lib/api.js';
import { HelpCircle, ChevronRight, ChevronDown, Calendar, Pencil, SlidersHorizontal } from 'lucide-react';
import { Line, Doughnut, Radar } from 'react-chartjs-2';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import jsPDF from 'jspdf';

import {
  Chart as ChartJS, CategoryScale, LinearScale, BarController, BarElement,
  PointElement, LineElement, ArcElement, Title, Tooltip, Legend, RadialLinearScale
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(
  CategoryScale, LinearScale, BarController, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, RadialLinearScale, annotationPlugin, zoomPlugin
);

const PALETTE = ['#2563eb','#16a34a','#dc2626','#7c3aed','#f59e0b','#0ea5e9','#059669','#d946ef','#ef4444','#3b82f6'];
const withAlpha = (hex, a) => {
  const h = hex.replace('#',''); const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
};

function useUserSite() {
  try { return (JSON.parse(localStorage.getItem('eh_user') || '{}')?.site) || '' } catch { return '' }
}

function Toast({ msg, type='info' }) {
  const colors = { success:'bg-green-600 text-white', error:'bg-red-600 text-white', info:'bg-blue-600 text-white' };
  return <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-xl text-sm ${colors[type]} ring-1 ring-black/10`}>{msg}</div>;
}

function Modal({ open, onClose, children, title, wide=false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`w-full ${wide?'max-w-4xl':'max-w-lg'} bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5`}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-green-50 to-orange-50">
          <h3 className="text-xl font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">×</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[75vh]">{children}</div>
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
  const [showFilters, setShowFilters] = useState(false);

  const [ganttTasks, setGanttTasks] = useState([]);

  const [doughnutData, setDoughnutData] = useState([]);
  const [buildingBuckets, setBuildingBuckets] = useState({});
  const [capexForecast, setCapexForecast] = useState({});

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [avgUrgency, setAvgUrgency] = useState(45);
  const [totalCapex, setTotalCapex] = useState(50000);

  // AI assistant
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiMessages, setAiMessages] = useState([]);
  const [health, setHealth] = useState({ openai:false, web_cost:false });

  // Quick Edit modal
  const [showQuick, setShowQuick] = useState(false);
  const [quick, setQuick] = useState({ switchboard_id:null, service_year:'', avg_life_years:30, override_cost_per_device:'' });

  // palette “par bâtiment” stable
  const buildingColor = new Map();
  const colorForBuilding = (b) => {
    if (!buildingColor.has(b)) buildingColor.set(b, PALETTE[buildingColor.size % PALETTE.length]);
    return buildingColor.get(b);
  };

  useEffect(() => {
    (async () => {
      try { const h = await get('/api/obsolescence/health'); setHealth(h); } catch {}
      await loadBuildings();
    })();
    const t = setInterval(autoCheck, 300000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (tab === 'roll-up') loadGanttData();
    if (tab === 'analysis') {
      loadDoughnutData();
      loadCapexForecast();
      loadBuildingBuckets();
    }
  }, [tab, selectedFilter]);

  const autoCheck = async () => {
    try {
      await post('/api/obsolescence/auto-check');
      await loadBuildings();
      if (tab === 'roll-up') loadGanttData();
      if (tab === 'analysis') { loadDoughnutData(); loadCapexForecast(); loadBuildingBuckets(); }
    } catch {}
  };

  const loadBuildings = async () => {
    try {
      setBusy(true);
      const data = await get('/api/obsolescence/buildings');
      setBuildings(Array.isArray(data.data) ? data.data : []);
      // Seed defaults + checks
      await post('/api/obsolescence/ai-fill');
      await post('/api/obsolescence/auto-check');
      // KPIs
      const u = await get('/api/obsolescence/avg-urgency');   setAvgUrgency(Number(u.avg || 45));
      const c = await get('/api/obsolescence/total-capex');   setTotalCapex(Number(c.total || 50000));
    } catch (e) {
      setToast({ msg: `Failed to load buildings: ${e.message}`, type: 'error' });
    } finally { setBusy(false); }
  };

  const loadSwitchboards = async (building) => {
    try {
      const data = await get('/api/obsolescence/switchboards', { building });
      setSwitchboards(prev => ({ ...prev, [building]: Array.isArray(data.data) ? data.data : [] }));
    } catch (e) { setToast({ msg: `Switchboards failed: ${e.message}`, type: 'error' }); }
  };

  const toggleBuilding = (building) => {
    setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }));
    if (!switchboards[building]) loadSwitchboards(building);
    setSelectedFilter(prev => ({ ...prev, building, switchboard: null }));
  };

  const loadGanttData = async () => {
    try {
      const params = {};
      if (selectedFilter.building) params.building = selectedFilter.building;
      if (selectedFilter.switchboard) params.switchboard = selectedFilter.switchboard;

      const data = await get('/api/obsolescence/gantt-data', params);
      const tasks = (data.tasks || [])
        .map(t => ({ ...t, start:new Date(t.start), end:new Date(t.end) }))
        .filter(t => !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()))
        .map(t => {
          const nowY = new Date().getFullYear();
          const remaining = t.end.getFullYear() - nowY;
          const base = colorForBuilding(t.building || 'Unknown');
          // plus chaud quand imminent
          const hue = remaining < 5 ? '#ef4444' : remaining <= 10 ? '#f59e0b' : base;
          return {
            ...t,
            styles: {
              backgroundColor: withAlpha(hue, 0.9),
              backgroundSelectedColor: withAlpha(hue, 1),
              progressColor: '#111827',
              progressSelectedColor: '#111827'
            }
          };
        });
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg: `Gantt failed: ${e.message}`, type: 'error' });
      setGanttTasks([]);
    }
  };

  const loadDoughnutData = async () => {
    try {
      const data = await get('/api/obsolescence/doughnut', { group:'building', ...selectedFilter });
      setDoughnutData(Array.isArray(data.data) ? data.data : []);
    } catch (e) {
      setToast({ msg: `Doughnut failed: ${e.message}`, type: 'error' });
      setDoughnutData([]);
    }
  };

  const loadCapexForecast = async () => {
    try {
      const data = await get('/api/obsolescence/capex-forecast', { group:'building', ...selectedFilter });
      setCapexForecast(data && data.forecasts && typeof data.forecasts === 'object' ? data.forecasts : {});
    } catch (e) {
      setToast({ msg: `CAPEX failed: ${e.message}`, type: 'error' });
      setCapexForecast({});
    }
  };

  const loadBuildingBuckets = async () => {
    try {
      const data = await get('/api/obsolescence/building-urgency-buckets');
      setBuildingBuckets(data && data.buckets && typeof data.buckets === 'object' ? data.buckets : {});
    } catch (e) {
      setToast({ msg: `Buckets failed: ${e.message}`, type: 'error' });
      setBuildingBuckets({});
    }
  };

  // ---- Charts helpers
  const computeYears = () => Array.from({ length: 30 }, (_, i) => new Date().getFullYear() + i);

  const getCapexChartData = (forecasts) => {
    const years = computeYears();
    const datasets = [];
    const keys = Object.keys(forecasts || {});
    keys.forEach((group, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      const annual = years.map(y => (forecasts[group] || []).reduce((s, f) => s + (f.year === y ? f.capex_year : 0), 0));
      const cumul = annual.reduce((acc, cur, i) => [...acc, (acc[i-1] || 0) + cur], []);
      datasets.push({
        type:'bar',
        label:`${group} Annual (£)`,
        data: annual,
        backgroundColor: (ctx) => {
          const { chartArea, ctx: c } = ctx.chart;
          if (!chartArea) return color;
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, withAlpha(color, 0.9));
          g.addColorStop(1, withAlpha(color, 0.25));
          return g;
        },
        borderRadius: 6
      });
      datasets.push({
        type:'line',
        label:`${group} Cumulative (£)`,
        data: cumul,
        borderColor: color,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 0,
        fill: false,
      });
    });
    return { labels: years, datasets };
  };

  const getCapexChartDataSingle = (forecasts, group, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    const years = computeYears();
    const annual = years.map(y => (forecasts[group] || []).reduce((s, f) => s + (f.year === y ? f.capex_year : 0), 0));
    const cumul = annual.reduce((acc, cur, i) => [...acc, (acc[i-1] || 0) + cur], []);
    return {
      labels: years,
      datasets: [
        {
          type:'bar',
          label:'Annual (£)',
          data: annual,
          backgroundColor: (ctx) => {
            const { chartArea, ctx: c } = ctx.chart;
            if (!chartArea) return color;
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, withAlpha(color, 0.9));
            g.addColorStop(1, withAlpha(color, 0.25));
            return g;
          },
          borderRadius: 6
        },
        {
          type:'line',
          label:'Cumulative (£)',
          data: cumul,
          borderColor: color,
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 0,
          fill:false
        }
      ]
    };
  };

  const chartBigOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { borderWidth: 3, tension: 0.35 } },
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

  const getBuildingDoughnutData = (b) => ({
    labels: ['Urgent <5y', 'Medium 5–10y', 'Low >10y'],
    datasets: [{
      data: [b?.urgent || 0, b?.medium || 0, b?.low || 0],
      backgroundColor: ['#ef4444','#f59e0b','#16a34a'],
      borderWidth: 0
    }]
  });
  const doughnutSmallOptions = { responsive:true, plugins:{ legend:{ position:'bottom' } }, cutout:'70%' };

  // Radar (centré)
  const getRadarData = () => {
    const labels = ['Age pressure','Urgency','CAPEX density','Unknowns','Thermal risk'];
    const groups = Object.keys(capexForecast || {});
    if (!groups.length) return { labels, datasets: [] };
    const datasets = groups.slice(0, 6).map((g,idx) => {
      const color = PALETTE[idx%PALETTE.length];
      const capexSum = (capexForecast[g]||[]).reduce((a,b)=>a+b.capex_year,0);
      const urg = Number(avgUrgency)||45;
      const age = 50; // proxy
      const unknowns = Math.max(0, 100 - (buildingBuckets[g]?.total||1)*5);
      const thermal = 40; // placeholder metric
      return {
        label: `Bldg ${g}`,
        data: [age, urg, Math.min(100, capexSum/10000), unknowns, thermal],
        borderColor: color,
        backgroundColor: withAlpha(color, .2),
        pointRadius: 0,
        borderWidth: 2,
      };
    });
    return { labels, datasets };
  };
  const radarOptions = {
    responsive:true,
    maintainAspectRatio:false,
    plugins:{ legend:{ position:'bottom' } },
    scales:{ r:{ beginAtZero:true, max:100, grid:{ color:'#eee' } } },
    elements:{ line:{ tension:0.25 } }
  };

  // ICS
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

  // Quick edit
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

  // AI assistant
  const sendAi = async () => {
    if (!aiQuery.trim()) return;
    const q = aiQuery.trim();
    setAiMessages(m => [...m, { role:'user', content:q }]);
    setAiQuery('');
    try {
      const r = await post('/api/obsolescence/ai-query', { query:q, site });
      setAiMessages(m => [...m, { role:'assistant', content:r.response }]);
      if (r.web_cost) setToast({ msg:'Web-assist cost estimation is active.', type:'info' });
    } catch (e) {
      setAiMessages(m => [...m, { role:'assistant', content:`(Erreur AI) ${e.message}` }]);
    }
  };

  // Export PDF
  const exportPdf = async () => {
    try {
      setBusy(true);
      const pdf = new jsPDF({ unit:'pt', format:'a4' });
      const margin = 40;
      let y = margin;

      const addTitle = (t) => { pdf.setFontSize(18); pdf.text(t, margin, y); y += 24; pdf.setFontSize(11); };
      const addLine = () => { pdf.setDrawColor(230); pdf.line(margin, y, 555, y); y += 12; };

      // Page 1
      addTitle('Obsolescence Report');
      pdf.text(`Site: ${site || 'N/A'}`, margin, y); y += 16;
      pdf.text(`Avg Urgency: ${Number(avgUrgency).toFixed(1)}%`, margin, y); y += 16;
      pdf.text(`Total CAPEX Forecast: £${Number(totalCapex).toLocaleString('en-GB')}`, margin, y); y += 20;
      addLine();
      pdf.text('Buildings overview:', margin, y); y += 16;

      buildings.forEach(b => {
        pdf.text(`• ${b.building} — switchboards: ${b.count}, total est.: £${Number(b.total_cost||0).toLocaleString('en-GB')}`, margin, y);
        y += 16;
        if (y > 760) { pdf.addPage(); y = margin; }
      });

      // Page 2 — Top urgences
      pdf.addPage(); y = margin;
      addTitle('Top priorities (horizon < 5y)');
      const now = new Date().getFullYear();
      const rows = Object.values(switchboards).flat().map(sb => ({
        b: sb?.building || '', n: sb?.name || '', y: sb?.forecast_year || now+1, c: sb?.total_cost || 0
      })).sort((a,b) => a.y - b.y).slice(0, 12);

      rows.forEach(r => {
        pdf.text(`• ${r.n} — forecast ${r.y} — £${Number(r.c).toLocaleString('en-GB')}`, margin, y);
        y += 16;
        if (y > 760) { pdf.addPage(); y = margin; }
      });

      // Disclaimers
      pdf.addPage(); y = margin;
      addTitle('Estimates & Scope');
      pdf.text([
        '— Values are indicative, based on current prices and a typical installation in your region.',
        '— Prices include materials + labour; they exclude enclosures, cabling, and extra accessories.',
        '— Web-assisted pricing is used when enabled; otherwise a calibrated ampere bracket / family heuristic is applied.'
      ], margin, y);

      pdf.save('obsolescence-report.pdf');
      setToast({ msg: 'PDF exported!', type: 'success' });
    } catch (e) {
      setToast({ msg: `Export failed: ${e.message}`, type: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <section className="p-8 max-w-7xl mx-auto bg-gradient-to-br from-green-50 to-orange-50 rounded-3xl shadow-xl min-h-screen">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-800">Obsolescence Dashboard</h1>
        <div className="flex gap-3">
          <button onClick={() => setShowFilters(true)} className="px-3 py-2 bg-white text-gray-700 rounded-xl shadow ring-1 ring-black/10 hover:bg-gray-50 flex items-center gap-2">
            <SlidersHorizontal size={18}/> Filters
          </button>
          <button onClick={exportPdf} className="px-4 py-2 bg-green-600 text-white rounded-xl shadow-md hover:bg-green-700">Export PDF</button>
          <button onClick={() => setAiOpen(true)} className="p-3 bg-orange-500 text-white rounded-xl shadow-md hover:bg-orange-600" title="Ask the AI">
            <HelpCircle size={20} />
          </button>
        </div>
      </header>

      <div className="flex gap-4 mb-8 border-b pb-2">
        <button onClick={() => setTab('overview')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'overview' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Overview</button>
        <button onClick={() => setTab('roll-up')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'roll-up' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-600'}`}>Roll-up</button>
        <button onClick={() => setTab('analysis')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'analysis' ? 'bg-white text-green-600 shadow-md' : 'text-gray-600'}`}>Analysis</button>
      </div>

      {/* KPI cards */}
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
                      <td className="p-4 cursor-pointer" onClick={() => { toggleBuilding(b.building); }}>
                        {expandedBuildings[b.building] ? <ChevronDown className="inline mr-2" /> : <ChevronRight className="inline mr-2" />}
                        {b.building} ({b.count} switchboards)
                      </td>
                      <td className="p-4"></td>
                      <td className="p-4">£{Number(b.total_cost || 0).toLocaleString('en-GB')}</td>
                      <td className="p-4"></td>
                      <td className="p-4"></td>
                    </tr>

                    {expandedBuildings[b.building] && (switchboards[b.building] || []).map((sb) => (
                      <tr key={`sb-${sb.id}`} className="bg-orange-50 hover:bg-orange-100 transition-colors">
                        <td className="p-4 pl-8">{sb.name}</td>
                        <td className="p-4">{sb.service_year ?? 'N/A'}</td>
                        <td className="p-4">£{Number(sb.total_cost || 0).toLocaleString('en-GB')}</td>
                        <td className="p-4">{sb.forecast_year ?? 'N/A'}</td>
                        <td className="p-4 flex gap-3">
                          <button onClick={() => openQuick(sb)} className="text-green-700 hover:text-green-900" title="Quick edit"><Pencil size={16} /></button>
                          <button onClick={() => {
                            const y = sb.forecast_year ?? (new Date().getFullYear() + 1);
                            downloadICS({ ...sb, forecast_year: y });
                          }} className="text-blue-700 hover:text-blue-900" title="Add to calendar"><Calendar size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-3">
              Estimates are indicative, based on current prices and a typical installation in your region.
              Prices include materials + labour; exclude enclosures, cabling, extra accessories. Web-assist is used if enabled.
            </p>
          </div>
        </>
      )}

      {tab === 'roll-up' && (
        <div className="bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold text-gray-800">Gantt (Portfolio)</h2>
          </div>
          {ganttTasks.length ? (
            <div className="h-[620px] overflow-auto">
              <Gantt
                tasks={ganttTasks}
                viewMode={ViewMode.Year}
                columnWidth={120}
                listCellWidth="300px"
                todayColor="#ff6b00"
              />
            </div>
          ) : <p className="text-gray-600 text-center py-20">No data available yet.</p>}
        </div>
      )}

      {tab === 'analysis' && (
        <div className="grid grid-cols-1 gap-8">
          {/* Grand graphique plein écran */}
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5 h-[640px]">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">CAPEX Forecast — All Buildings</h2>
            {Object.keys(capexForecast || {}).length ? (
              <Line data={getCapexChartData(capexForecast)} options={chartBigOptions} />
            ) : <p className="text-gray-600 text-center py-20">No data.</p>}
          </div>

          {/* Radar centré */}
          <div className="bg-white p-6 rounded-2xl shadow-md ring-1 ring-black/5">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Risk / Readiness Radar</h2>
            <div className="h-[440px] flex items-center justify-center">
              <div className="w-full max-w-[720px] h-full">
                <Radar data={getRadarData()} options={radarOptions} />
              </div>
            </div>
          </div>

          {/* Doughnuts par bâtiment : <5y / 5–10y / >10y */}
          <div>
            <h2 className="text-2xl font-bold mb-2 text-gray-800">Replacement Horizon — by Building</h2>
            <p className="text-xs text-gray-500 mb-4">
              Counts of switchboards due per horizon. Estimates exclude enclosures/cables/accessories.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {Object.keys(buildingBuckets || {}).map(b => (
                <div key={b} className="bg-white p-5 rounded-2xl shadow-md ring-1 ring-black/5">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Building {b}</h3>
                  <Doughnut data={getBuildingDoughnutData(buildingBuckets[b])} options={doughnutSmallOptions} />
                  <div className="text-xs mt-2 text-gray-600">
                    Total: {buildingBuckets[b]?.total || 0} switchboards
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mini-charts par bâtiment */}
          <div>
            <h2 className="text-2xl font-bold mb-4 text-gray-800">CAPEX — per Building</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {Object.keys(capexForecast || {}).map((group, idx) => (
                <div key={group} className="bg-white p-5 rounded-2xl shadow-md ring-1 ring-black/5 h-[320px]">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Building {group}</h3>
                  <Line data={getCapexChartDataSingle(capexForecast, group, idx)} options={{
                    ...chartBigOptions, maintainAspectRatio:false, animation:{ duration:500 }
                  }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters drawer */}
      <Modal open={showFilters} onClose={()=>setShowFilters(false)} title="Filters" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Building</label>
            <select className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10"
              value={selectedFilter.building || ''} onChange={e => setSelectedFilter(s => ({ ...s, building: e.target.value || null, switchboard: null }))}>
              <option value="">All</option>
              {buildings.map(b => <option key={b.building} value={b.building}>{b.building}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Switchboard</label>
            <select className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10"
              value={selectedFilter.switchboard || ''} onChange={e => setSelectedFilter(s => ({ ...s, switchboard: e.target.value || null }))}>
              <option value="">All</option>
              {((selectedFilter.building ? (switchboards[selectedFilter.building] || []) : [])).map(sb =>
                <option key={sb.id} value={sb.id}>{sb.name}</option>
              )}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-between">
          <button onClick={()=>setSelectedFilter({ building:null, switchboard:null })} className="px-3 py-2 rounded-lg ring-1 ring-black/10 bg-gray-50">Clear</button>
          <button onClick={()=>{ setShowFilters(false); if (tab==='roll-up') loadGanttData(); if (tab==='analysis'){ loadCapexForecast(); loadDoughnutData(); }}} className="px-4 py-2 bg-green-600 text-white rounded-lg">Apply</button>
        </div>
      </Modal>

      {/* Quick edit */}
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

      {/* AI Assistant */}
      <Modal open={aiOpen} onClose={()=>setAiOpen(false)} title={`AI Assistant ${health.web_cost ? ' (web-assist ON)' : ''}`} wide>
        <div className="space-y-3">
          <div className="text-sm text-gray-600">
            Ask questions (IEC obsolescence, MCCB/ACB/VCB pricing, roadmap per building, Temp/HeatTag sensors, electrical monitoring…).
            The AI adds sensor/monitoring ideas + a dedicated box Estimates & Scope.
            (I can also speak to you in any language.)
          </div>
          <div className="h-[320px] overflow-y-auto rounded-xl ring-1 ring-black/10 p-3 bg-gray-50">
            {aiMessages.length === 0 && <div className="text-gray-500 text-sm">🧠 Tell me for example: MCCB 250A installed price UK? or building 21 roadmap.</div>}
            {aiMessages.map((m, i) => (
              <div key={i} className={`mb-3 ${m.role==='user'?'text-right':''}`}>
                <div className={`inline-block px-3 py-2 rounded-xl ${m.role==='user'?'bg-green-600 text-white':'bg-white ring-1 ring-black/10'}`} style={{maxWidth:'80%'}}>
                  <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="flex-1 p-3 rounded-xl bg-white ring-1 ring-black/10" placeholder="Ask anything…" value={aiQuery} onChange={e=>setAiQuery(e.target.value)} onKeyDown={e=>e.key==='Enter' && sendAi()} />
            <button onClick={sendAi} className="px-4 py-2 bg-green-600 text-white rounded-xl">Send</button>
          </div>
          {!health.openai && <div className="text-xs text-red-600">OpenAI non configuré — définis OPENAI_API_KEY.</div>}
        </div>
      </Modal>

      {toast && <Toast {...toast} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><div className="animate-spin h-16 w-16 border-b-4 border-green-500 rounded-full"></div></div>}
    </section>
  );
}
