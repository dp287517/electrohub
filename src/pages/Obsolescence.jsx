// Obsolescence.jsx
// Redesigned with VSD/MECA support, beautiful animations, timeline, pro PDF export
import React, { useEffect, useState, Fragment, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import {
  HelpCircle, ChevronRight, ChevronDown, Calendar, Pencil, SlidersHorizontal,
  TrendingUp, AlertTriangle, Clock, Building2, Zap, Cpu, Cog, Gauge,
  Download, FileText, ExternalLink, BarChart3, PieChart, Activity,
  ArrowUpRight, ArrowDownRight, Filter, RefreshCw, Info, Target,
  CircleDot, Layers, ChevronUp, X, Check, Eye
} from 'lucide-react';
import { Line, Doughnut, Radar, Bar } from 'react-chartjs-2';
import jsPDF from 'jspdf';

import {
  Chart as ChartJS, CategoryScale, LinearScale, BarController, BarElement,
  PointElement, LineElement, ArcElement, Title, Tooltip, Legend, RadialLinearScale, Filler
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(
  CategoryScale, LinearScale, BarController, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, RadialLinearScale, annotationPlugin, zoomPlugin, Filler
);

// ==================== CONSTANTS ====================
const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'];
const ASSET_COLORS = {
  sb: '#3b82f6',
  hv: '#8b5cf6',
  vsd: '#10b981',
  meca: '#f59e0b'
};
const ASSET_LABELS = {
  sb: 'Switchboards',
  hv: 'High Voltage',
  vsd: 'VSD',
  meca: 'Mechanical'
};
const ASSET_ICONS = {
  sb: Zap,
  hv: Gauge,
  vsd: Cpu,
  meca: Cog
};
const URGENCY_COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  ok: '#10b981'
};

const withAlpha = (hex, a) => {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
};

function useUserSite() {
  try { return (JSON.parse(localStorage.getItem('eh_user') || '{}')?.site) || '' } catch { return '' }
}

// ==================== UI COMPONENTS ====================

const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div
    className={`animate-fadeSlideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

const Badge = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

function Toast({ msg, type = 'info', onClose }) {
  const colors = {
    success: 'bg-emerald-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-blue-500 text-white',
    warning: 'bg-amber-500 text-white'
  };
  const icons = { success: Check, error: X, info: Info, warning: AlertTriangle };
  const Icon = icons[type] || Info;

  useEffect(() => {
    const t = setTimeout(() => onClose?.(), 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-4 right-4 px-5 py-4 rounded-2xl shadow-2xl ${colors[type]} flex items-center gap-3 z-[100] animate-fadeSlideUp`}>
      <Icon size={20} />
      <span className="font-medium">{msg}</span>
      <button onClick={onClose} className="ml-2 p-1 hover:bg-white/20 rounded-lg"><X size={16} /></button>
    </div>
  );
}

function Modal({ open, onClose, children, title, wide = false, icon: IconComp }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className={`w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} bg-white rounded-3xl shadow-2xl overflow-hidden animate-fadeSlideUp`}>
        <div className="flex items-center justify-between px-6 py-5 border-b bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
          <div className="flex items-center gap-3">
            {IconComp && <div className="p-2 bg-white/20 rounded-xl"><IconComp size={22} /></div>}
            <h3 className="text-xl font-bold">{title}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/20 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[75vh]">{children}</div>
      </div>
    </div>
  );
}

// Animated Tab Button
const TabButton = ({ active, onClick, icon: Icon, label, color, count }) => (
  <button
    onClick={onClick}
    className={`relative flex items-center gap-2 px-5 py-3 rounded-xl font-semibold transition-all duration-300 ${
      active
        ? `bg-white text-gray-900 shadow-lg scale-105`
        : 'text-white/80 hover:text-white hover:bg-white/10'
    }`}
  >
    <Icon size={18} className={active ? `text-${color}` : ''} style={active ? { color } : {}} />
    <span>{label}</span>
    {count !== undefined && (
      <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${
        active ? 'bg-gray-100 text-gray-700' : 'bg-white/20 text-white'
      }`}>
        {count}
      </span>
    )}
    {active && (
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full" style={{ backgroundColor: color }} />
    )}
  </button>
);

// Asset Type Filter Chips
const AssetChip = ({ type, active, onClick, stats }) => {
  const Icon = ASSET_ICONS[type] || Layers;
  const color = ASSET_COLORS[type] || '#6b7280';
  const label = type === 'all' ? 'All Types' : (ASSET_LABELS[type] || type);

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-200 ${
        active
          ? 'bg-white shadow-md ring-2'
          : 'bg-white/50 hover:bg-white/80'
      }`}
      style={active ? { ringColor: color } : {}}
    >
      <Icon size={16} style={{ color }} />
      <span className="text-gray-700">{label}</span>
      {stats && (
        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
          {stats.count}
        </span>
      )}
    </button>
  );
};

// KPI Card Component
const KpiCard = ({ title, value, subtitle, icon: Icon, color, trend, delay = 0 }) => (
  <AnimatedCard delay={delay}>
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
          {trend !== undefined && (
            <div className={`flex items-center gap-1 mt-2 text-sm font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {trend >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              <span>{Math.abs(trend)}% vs last year</span>
            </div>
          )}
        </div>
        <div className="p-3 rounded-2xl" style={{ backgroundColor: withAlpha(color, 0.1) }}>
          <Icon size={28} style={{ color }} />
        </div>
      </div>
    </div>
  </AnimatedCard>
);

// Urgency Progress Bar
const UrgencyBar = ({ urgent, medium, low, total }) => {
  const urgentPct = total ? (urgent / total) * 100 : 0;
  const mediumPct = total ? (medium / total) * 100 : 0;
  const lowPct = total ? (low / total) * 100 : 0;

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
        <div className="bg-red-500 transition-all duration-500" style={{ width: `${urgentPct}%` }} />
        <div className="bg-amber-500 transition-all duration-500" style={{ width: `${mediumPct}%` }} />
        <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${lowPct}%` }} />
      </div>
      <div className="flex justify-between text-xs font-medium">
        <span className="text-red-600">Urgent: {urgent}</span>
        <span className="text-amber-600">Medium: {medium}</span>
        <span className="text-emerald-600">OK: {low}</span>
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function Obsolescence() {
  const site = useUserSite();
  const navigate = useNavigate();

  // Tab state
  const [tab, setTab] = useState('overview');

  // Data state
  const [assetStats, setAssetStats] = useState(null);
  const [items, setItems] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [ganttTasks, setGanttTasks] = useState([]);
  const [capexForecast, setCapexForecast] = useState({});
  const [buildingBuckets, setBuildingBuckets] = useState({});

  // Filter state
  const [selectedAsset, setSelectedAsset] = useState('all');
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedBuildings, setExpandedBuildings] = useState({});

  // UI state
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // AI assistant
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiMessages, setAiMessages] = useState([]);
  const [health, setHealth] = useState({ openai: false, web_cost: false });

  // Quick edit
  const [quickEditItem, setQuickEditItem] = useState(null);

  // Building color map
  const buildingColorMap = useMemo(() => {
    const map = {};
    buildings.forEach((b, i) => {
      map[b.building] = PALETTE[i % PALETTE.length];
    });
    return map;
  }, [buildings]);

  // ==================== DATA LOADING ====================

  useEffect(() => {
    loadHealth();
    loadAssetStats();
    loadBuildings();
  }, []);

  useEffect(() => {
    loadItems();
    if (tab === 'roll-up') loadGanttData();
    if (tab === 'analysis') {
      loadCapexForecast();
      loadBuildingBuckets();
    }
  }, [tab, selectedAsset, selectedBuilding]);

  const loadHealth = async () => {
    try {
      const h = await get('/api/obsolescence/health');
      setHealth(h);
    } catch { }
  };

  const loadAssetStats = async () => {
    try {
      const res = await get('/api/obsolescence/asset-stats');
      setAssetStats(res.stats);
    } catch (e) {
      console.error('Stats error:', e);
    }
  };

  const loadBuildings = async () => {
    try {
      const res = await get('/api/obsolescence/buildings', { asset: selectedAsset });
      setBuildings(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setToast({ msg: `Failed to load buildings: ${e.message}`, type: 'error' });
    }
  };

  const loadItems = async () => {
    try {
      setBusy(true);
      const params = { asset: selectedAsset, limit: 200 };
      if (selectedBuilding) params.building = selectedBuilding;
      const res = await get('/api/obsolescence/all-items', params);
      setItems(res.items || []);
    } catch (e) {
      setToast({ msg: `Failed to load items: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const loadGanttData = async () => {
    try {
      const params = { asset: selectedAsset };
      if (selectedBuilding) params.building = selectedBuilding;
      const res = await get('/api/obsolescence/gantt-data', params);
      const tasks = (res.tasks || [])
        .map(t => ({
          ...t,
          start: new Date(t.start),
          end: new Date(t.end)
        }))
        .filter(t => !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()))
        .map(t => {
          const color = t.urgency === 'critical' ? URGENCY_COLORS.critical
            : t.urgency === 'warning' ? URGENCY_COLORS.warning
              : URGENCY_COLORS.ok;
          return {
            ...t,
            styles: {
              backgroundColor: withAlpha(color, 0.85),
              backgroundSelectedColor: color,
              progressColor: withAlpha('#1f2937', 0.3),
              progressSelectedColor: '#1f2937'
            }
          };
        });
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg: `Gantt failed: ${e.message}`, type: 'error' });
      setGanttTasks([]);
    }
  };

  const loadCapexForecast = async () => {
    try {
      const res = await get('/api/obsolescence/capex-forecast', { asset: selectedAsset });
      setCapexForecast(res.forecasts || {});
    } catch (e) {
      setToast({ msg: `CAPEX failed: ${e.message}`, type: 'error' });
    }
  };

  const loadBuildingBuckets = async () => {
    try {
      const res = await get('/api/obsolescence/building-urgency-buckets', { asset: selectedAsset });
      setBuildingBuckets(res.buckets || {});
    } catch (e) {
      setToast({ msg: `Buckets failed: ${e.message}`, type: 'error' });
    }
  };

  // ==================== COMPUTED VALUES ====================

  const stats = useMemo(() => {
    if (!assetStats) return { totalAssets: 0, totalCapex: 0, avgUrgency: 0, urgentCount: 0 };
    const all = assetStats.all || {};
    return {
      totalAssets: all.count || 0,
      totalCapex: all.totalCost || 0,
      avgUrgency: all.count ? Math.round(((all.urgent * 100 + all.medium * 50) / all.count)) : 0,
      urgentCount: all.urgent || 0,
      mediumCount: all.medium || 0,
      okCount: all.low || 0
    };
  }, [assetStats]);

  const topPriorities = useMemo(() => {
    return items.filter(i => i.urgency_level === 'critical').slice(0, 5);
  }, [items]);

  // Group items by building for tree view
  const itemsByBuilding = useMemo(() => {
    const grouped = {};
    items.forEach(item => {
      const b = item.building_code || 'Unknown';
      if (!grouped[b]) grouped[b] = [];
      grouped[b].push(item);
    });
    return grouped;
  }, [items]);

  // ==================== CHARTS ====================

  const computeYears = () => Array.from({ length: 20 }, (_, i) => new Date().getFullYear() + i);

  const capexChartData = useMemo(() => {
    const years = computeYears();
    const groups = Object.keys(capexForecast || {});
    if (!groups.length) return null;

    const datasets = [];
    groups.forEach((group, idx) => {
      const color = buildingColorMap[group] || PALETTE[idx % PALETTE.length];
      const annual = years.map(y =>
        (capexForecast[group] || []).reduce((s, f) => s + (f.year === y ? f.capex_year : 0), 0)
      );
      const cumul = annual.reduce((acc, cur, i) => [...acc, (acc[i - 1] || 0) + cur], []);

      datasets.push({
        type: 'bar',
        label: `${group} Annual`,
        data: annual,
        backgroundColor: withAlpha(color, 0.7),
        borderRadius: 6,
        order: 2
      });
      datasets.push({
        type: 'line',
        label: `${group} Cumulative`,
        data: cumul,
        borderColor: color,
        backgroundColor: withAlpha(color, 0.1),
        tension: 0.4,
        borderWidth: 3,
        pointRadius: 0,
        fill: true,
        order: 1
      });
    });

    return { labels: years, datasets };
  }, [capexForecast, buildingColorMap]);

  const assetDistributionData = useMemo(() => {
    if (!assetStats) return null;
    const types = ['switchboards', 'hv', 'vsd', 'meca'];
    const data = types.map(t => assetStats[t]?.count || 0);
    const colors = [ASSET_COLORS.sb, ASSET_COLORS.hv, ASSET_COLORS.vsd, ASSET_COLORS.meca];

    return {
      labels: ['Switchboards', 'High Voltage', 'VSD', 'Mechanical'],
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 8
      }]
    };
  }, [assetStats]);

  const radarData = useMemo(() => {
    const labels = ['Age Pressure', 'CAPEX Density', 'Critical Assets', 'Coverage', 'Risk Score'];
    const groups = Object.keys(capexForecast || {}).slice(0, 5);
    if (!groups.length) return { labels, datasets: [] };

    const datasets = groups.map((g, idx) => {
      const color = buildingColorMap[g] || PALETTE[idx % PALETTE.length];
      const bucket = buildingBuckets[g] || {};
      const capexSum = (capexForecast[g] || []).reduce((a, b) => a + b.capex_year, 0);

      return {
        label: g,
        data: [
          bucket.total ? ((bucket.urgent + bucket.medium) / bucket.total) * 100 : 0,
          Math.min(100, capexSum / 5000),
          bucket.urgent ? (bucket.urgent / (bucket.total || 1)) * 100 : 0,
          Math.min(100, (bucket.total || 0) * 10),
          bucket.total ? ((bucket.urgent * 3 + bucket.medium) / bucket.total) * 25 : 0
        ],
        borderColor: color,
        backgroundColor: withAlpha(color, 0.15),
        pointRadius: 0,
        borderWidth: 2
      };
    });

    return { labels, datasets };
  }, [capexForecast, buildingBuckets, buildingColorMap]);

  const urgencyDistributionData = useMemo(() => {
    return {
      labels: ['Critical (<5y)', 'Warning (5-10y)', 'OK (>10y)'],
      datasets: [{
        data: [stats.urgentCount, stats.mediumCount, stats.okCount],
        backgroundColor: [URGENCY_COLORS.critical, URGENCY_COLORS.warning, URGENCY_COLORS.ok],
        borderWidth: 0,
        hoverOffset: 8
      }]
    };
  }, [stats]);

  // ==================== NAVIGATION ====================

  const navigateToItem = (item) => {
    const id = item.switchboard_id || item.hv_equipment_id || item.vsd_id || item.meca_id;
    if (item.kind === 'sb') navigate(`/app/switchboards?switchboard=${id}`);
    else if (item.kind === 'hv') navigate(`/app/hv?hv=${id}`);
    else if (item.kind === 'vsd') navigate(`/app/vsd?vsd=${id}`);
    else if (item.kind === 'meca') navigate(`/app/meca?meca=${id}`);
  };

  // Get display name (prefer code over name)
  const getItemDisplayName = (item) => {
    return item.code || item.name || `${(item.kind || 'item').toUpperCase()}-${item.switchboard_id || item.hv_equipment_id || item.vsd_id || item.meca_id}`;
  };

  // ==================== AI ASSISTANT ====================

  const sendAi = async () => {
    if (!aiQuery.trim()) return;
    const q = aiQuery.trim();
    setAiMessages(m => [...m, { role: 'user', content: q }]);
    setAiQuery('');
    try {
      const r = await post('/api/obsolescence/ai-query', { query: q, site });
      setAiMessages(m => [...m, { role: 'assistant', content: r.response }]);
    } catch (e) {
      setAiMessages(m => [...m, { role: 'assistant', content: `(Error) ${e.message}` }]);
    }
  };

  // ==================== PDF EXPORT ====================

  const exportPdf = async () => {
    try {
      setBusy(true);
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 40;
      const pageWidth = 595;
      const pageHeight = 842;
      let y = margin;

      // Helper functions
      const addText = (text, size = 11, bold = false, color = [51, 51, 51]) => {
        pdf.setFontSize(size);
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        pdf.setTextColor(...color);
        pdf.text(text, margin, y);
        y += size * 1.4;
      };

      const addLine = (color = [220, 220, 220]) => {
        pdf.setDrawColor(...color);
        pdf.setLineWidth(1);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 15;
      };

      const addSpacer = (h = 20) => { y += h; };

      const checkPageBreak = (needed = 100) => {
        if (y + needed > pageHeight - margin) {
          pdf.addPage();
          y = margin;
          return true;
        }
        return false;
      };

      // === COVER PAGE ===
      // Gradient header simulation
      pdf.setFillColor(16, 185, 129); // emerald-500
      pdf.rect(0, 0, pageWidth, 200, 'F');
      pdf.setFillColor(13, 148, 103); // darker
      pdf.rect(0, 150, pageWidth, 50, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(32);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Obsolescence Report', margin, 80);

      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Asset Lifecycle Management Analysis`, margin, 110);
      pdf.text(`Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, margin, 135);
      pdf.text(`Site: ${site || 'All Sites'}`, margin, 160);

      y = 240;

      // Executive Summary Box
      pdf.setFillColor(249, 250, 251);
      pdf.roundedRect(margin, y, pageWidth - 2 * margin, 140, 10, 10, 'F');

      y += 25;
      addText('EXECUTIVE SUMMARY', 14, true, [31, 41, 55]);
      addSpacer(10);

      const summaryItems = [
        { label: 'Total Assets Under Management', value: stats.totalAssets.toLocaleString() },
        { label: 'Total CAPEX Forecast', value: `£${stats.totalCapex.toLocaleString('en-GB')}` },
        { label: 'Critical Priority Assets', value: `${stats.urgentCount} items requiring immediate attention` },
        { label: 'Average Risk Score', value: `${stats.avgUrgency}%` }
      ];

      summaryItems.forEach(item => {
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(107, 114, 128);
        pdf.text(item.label + ':', margin + 15, y);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(17, 24, 39);
        pdf.text(item.value, margin + 180, y);
        y += 18;
      });

      y += 30;

      // Asset Breakdown
      addText('ASSET BREAKDOWN BY TYPE', 14, true, [31, 41, 55]);
      addSpacer(10);

      const assetTypes = [
        { type: 'Switchboards', count: assetStats?.switchboards?.count || 0, cost: assetStats?.switchboards?.totalCost || 0, color: [59, 130, 246] },
        { type: 'High Voltage', count: assetStats?.hv?.count || 0, cost: assetStats?.hv?.totalCost || 0, color: [139, 92, 246] },
        { type: 'VSD', count: assetStats?.vsd?.count || 0, cost: assetStats?.vsd?.totalCost || 0, color: [16, 185, 129] },
        { type: 'Mechanical', count: assetStats?.meca?.count || 0, cost: assetStats?.meca?.totalCost || 0, color: [245, 158, 11] }
      ];

      assetTypes.forEach(asset => {
        pdf.setFillColor(...asset.color);
        pdf.circle(margin + 8, y - 3, 4, 'F');
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(31, 41, 55);
        pdf.text(asset.type, margin + 20, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`${asset.count} assets`, margin + 150, y);
        pdf.text(`£${asset.cost.toLocaleString('en-GB')}`, margin + 250, y);
        y += 22;
      });

      // === PAGE 2: CRITICAL PRIORITIES ===
      pdf.addPage();
      y = margin;

      pdf.setFillColor(239, 68, 68); // red
      pdf.rect(0, 0, pageWidth, 60, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Critical Priorities', margin, 40);

      y = 90;

      addText('Assets requiring replacement within the next 5 years:', 12, false, [107, 114, 128]);
      addSpacer(15);

      // Table header
      pdf.setFillColor(249, 250, 251);
      pdf.rect(margin, y, pageWidth - 2 * margin, 25, 'F');
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(107, 114, 128);
      pdf.text('Asset Name', margin + 10, y + 17);
      pdf.text('Type', margin + 200, y + 17);
      pdf.text('Building', margin + 270, y + 17);
      pdf.text('Forecast Year', margin + 350, y + 17);
      pdf.text('Est. Cost', margin + 440, y + 17);
      y += 30;

      const criticalItems = items.filter(i => i.urgency_level === 'critical').slice(0, 15);
      criticalItems.forEach((item, idx) => {
        checkPageBreak(25);
        if (idx % 2 === 0) {
          pdf.setFillColor(249, 250, 251);
          pdf.rect(margin, y - 12, pageWidth - 2 * margin, 22, 'F');
        }

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(31, 41, 55);
        pdf.text((item.name || 'N/A').substring(0, 25), margin + 10, y);
        pdf.text(ASSET_LABELS[item.kind] || item.kind, margin + 200, y);
        pdf.text((item.building_code || 'N/A').substring(0, 12), margin + 270, y);
        pdf.setTextColor(239, 68, 68);
        pdf.text(String(item.forecast_year || 'N/A'), margin + 350, y);
        pdf.setTextColor(31, 41, 55);
        pdf.text(`£${(item.estimated_cost_gbp || 0).toLocaleString('en-GB')}`, margin + 440, y);
        y += 22;
      });

      // === PAGE 3: BUILDING ANALYSIS ===
      pdf.addPage();
      y = margin;

      pdf.setFillColor(59, 130, 246); // blue
      pdf.rect(0, 0, pageWidth, 60, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Building Analysis', margin, 40);

      y = 90;

      Object.entries(buildingBuckets).forEach(([building, bucket]) => {
        checkPageBreak(100);

        pdf.setFillColor(249, 250, 251);
        pdf.roundedRect(margin, y, pageWidth - 2 * margin, 70, 8, 8, 'F');

        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(31, 41, 55);
        pdf.text(`Building ${building}`, margin + 15, y + 25);

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Total Assets: ${bucket.total || 0}`, margin + 15, y + 45);

        // Mini bar
        const barWidth = 200;
        const barX = margin + 280;
        const barY = y + 30;

        const total = bucket.total || 1;
        const urgentW = (bucket.urgent / total) * barWidth;
        const mediumW = (bucket.medium / total) * barWidth;
        const lowW = (bucket.low / total) * barWidth;

        pdf.setFillColor(239, 68, 68);
        pdf.roundedRect(barX, barY, urgentW, 10, 2, 2, 'F');
        pdf.setFillColor(245, 158, 11);
        pdf.roundedRect(barX + urgentW, barY, mediumW, 10, 0, 0, 'F');
        pdf.setFillColor(16, 185, 129);
        pdf.roundedRect(barX + urgentW + mediumW, barY, lowW, 10, 2, 2, 'F');

        pdf.setFontSize(9);
        pdf.setTextColor(239, 68, 68);
        pdf.text(`${bucket.urgent || 0} critical`, barX, barY + 25);
        pdf.setTextColor(245, 158, 11);
        pdf.text(`${bucket.medium || 0} warning`, barX + 70, barY + 25);
        pdf.setTextColor(16, 185, 129);
        pdf.text(`${bucket.low || 0} ok`, barX + 140, barY + 25);

        y += 85;
      });

      // === FINAL PAGE: DISCLAIMER ===
      pdf.addPage();
      y = margin;

      pdf.setFillColor(249, 250, 251);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');

      addText('ESTIMATES & SCOPE', 16, true, [31, 41, 55]);
      addSpacer(20);

      const disclaimers = [
        '• Values are indicative estimates based on current market prices and typical UK installation costs.',
        '• Pricing includes materials and standard labour; excludes enclosures, cabling, and accessories.',
        '• Asset lifespans are estimated based on industry standards and operating conditions.',
        '• Web-assisted pricing is used when enabled; otherwise calibrated heuristics are applied.',
        '• This report should be used for planning purposes only. Obtain formal quotes for budgeting.',
        '• Critical assets should be assessed by qualified engineers before replacement decisions.'
      ];

      disclaimers.forEach(d => {
        checkPageBreak(20);
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(75, 85, 99);
        pdf.text(d, margin, y, { maxWidth: pageWidth - 2 * margin });
        y += 22;
      });

      addSpacer(40);

      // Footer
      pdf.setFontSize(10);
      pdf.setTextColor(156, 163, 175);
      pdf.text('Generated by ElectroHub Obsolescence Module', margin, pageHeight - 40);
      pdf.text(`© ${new Date().getFullYear()} ElectroHub`, margin, pageHeight - 25);

      pdf.save(`obsolescence-report-${new Date().toISOString().split('T')[0]}.pdf`);
      setToast({ msg: 'PDF exported successfully!', type: 'success' });
    } catch (e) {
      console.error('PDF export error:', e);
      setToast({ msg: `Export failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // ==================== ICS EXPORT ====================

  const downloadICS = (item) => {
    const y = item.forecast_year || (new Date().getFullYear() + 1);
    const dt = `${y}0101T090000Z`;
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ElectroHub//Obsolescence//EN
BEGIN:VEVENT
UID:${item.id || Math.random()}@electrohub
DTSTAMP:${dt}
DTSTART:${dt}
SUMMARY:Replace ${item.name} (forecast)
DESCRIPTION:Forecast replacement of ${item.name}. Estimated cost: £${(item.estimated_cost_gbp || 0).toLocaleString('en-GB')}
END:VEVENT
END:VCALENDAR`;
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.name}-forecast.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==================== RENDER ====================

  return (
    <section className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeSlideUp { animation: fadeSlideUp 0.4s ease-out forwards; }
        .gantt-table { font-family: inherit !important; }
        .gantt-table_header { background: #f9fafb !important; }
      `}</style>

      {/* ===== HEADER ===== */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Activity size={32} />
                Obsolescence Dashboard
              </h1>
              <p className="text-emerald-100 mt-2">
                Manage asset lifecycle, forecast CAPEX, and plan replacements
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowFilters(true)}
                className="px-4 py-2 bg-white/10 backdrop-blur rounded-xl hover:bg-white/20 transition-colors flex items-center gap-2"
              >
                <Filter size={18} />
                Filters
              </button>
              <button
                onClick={exportPdf}
                disabled={busy}
                className="px-4 py-2 bg-white text-emerald-600 rounded-xl font-medium hover:bg-emerald-50 transition-colors flex items-center gap-2 shadow-lg"
              >
                <FileText size={18} />
                Export PDF
              </button>
              <button
                onClick={() => setAiOpen(true)}
                className="p-3 bg-amber-500 rounded-xl hover:bg-amber-600 transition-colors shadow-lg"
                title="AI Assistant"
              >
                <HelpCircle size={20} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-8 overflow-x-auto pb-2">
            <TabButton
              active={tab === 'overview'}
              onClick={() => setTab('overview')}
              icon={BarChart3}
              label="Overview"
              color="#10b981"
            />
            <TabButton
              active={tab === 'roll-up'}
              onClick={() => setTab('roll-up')}
              icon={Clock}
              label="Timeline"
              color="#f59e0b"
              count={ganttTasks.length}
            />
            <TabButton
              active={tab === 'analysis'}
              onClick={() => setTab('analysis')}
              icon={PieChart}
              label="Analysis"
              color="#3b82f6"
            />
          </div>
        </div>
      </div>

      {/* Asset Type Filter Bar */}
      <div className="bg-white border-b shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3 overflow-x-auto">
          <span className="text-sm font-medium text-gray-500 whitespace-nowrap">Filter by type:</span>
          <AssetChip type="all" active={selectedAsset === 'all'} onClick={() => setSelectedAsset('all')} stats={assetStats?.all} />
          <AssetChip type="sb" active={selectedAsset === 'sb'} onClick={() => setSelectedAsset('sb')} stats={assetStats?.switchboards} />
          <AssetChip type="hv" active={selectedAsset === 'hv'} onClick={() => setSelectedAsset('hv')} stats={assetStats?.hv} />
          <AssetChip type="vsd" active={selectedAsset === 'vsd'} onClick={() => setSelectedAsset('vsd')} stats={assetStats?.vsd} />
          <AssetChip type="meca" active={selectedAsset === 'meca'} onClick={() => setSelectedAsset('meca')} stats={assetStats?.meca} />

          {selectedBuilding && (
            <div className="ml-auto flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-lg">
              <Building2 size={14} />
              <span className="text-sm font-medium">{selectedBuilding}</span>
              <button onClick={() => setSelectedBuilding(null)} className="p-0.5 hover:bg-blue-100 rounded">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ===== OVERVIEW TAB ===== */}
        {tab === 'overview' && (
          <div className="space-y-8">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <KpiCard
                title="Total Assets"
                value={stats.totalAssets.toLocaleString()}
                subtitle={`${Object.keys(itemsByBuilding).length} buildings`}
                icon={Layers}
                color="#3b82f6"
                delay={0}
              />
              <KpiCard
                title="Critical Priority"
                value={stats.urgentCount}
                subtitle="Replacement within 5 years"
                icon={AlertTriangle}
                color="#ef4444"
                delay={100}
              />
              <KpiCard
                title="Total CAPEX Forecast"
                value={`£${(stats.totalCapex / 1000000).toFixed(2)}M`}
                subtitle="20-year projection"
                icon={TrendingUp}
                color="#10b981"
                delay={200}
              />
              <KpiCard
                title="Risk Score"
                value={`${stats.avgUrgency}%`}
                subtitle="Portfolio average"
                icon={Target}
                color="#f59e0b"
                delay={300}
              />
            </div>

            {/* Urgency Distribution Bar */}
            <AnimatedCard delay={400}>
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Asset Urgency Distribution</h3>
                <UrgencyBar
                  urgent={stats.urgentCount}
                  medium={stats.mediumCount}
                  low={stats.okCount}
                  total={stats.totalAssets}
                />
              </div>
            </AnimatedCard>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Top Priorities */}
              <AnimatedCard delay={500} className="lg:col-span-2">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                  <div className="px-6 py-4 border-b bg-gradient-to-r from-red-50 to-orange-50">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <AlertTriangle size={20} className="text-red-500" />
                      Top Priorities
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">Assets requiring immediate attention</p>
                  </div>
                  <div className="divide-y">
                    {topPriorities.length === 0 ? (
                      <div className="p-8 text-center text-gray-500">
                        <Check size={48} className="mx-auto text-emerald-500 mb-3" />
                        <p className="font-medium">No critical priorities</p>
                        <p className="text-sm">All assets are within acceptable lifecycle ranges</p>
                      </div>
                    ) : (
                      topPriorities.map((item, idx) => {
                        const Icon = ASSET_ICONS[item.kind] || CircleDot;
                        return (
                          <div key={item.id || idx} className="px-6 py-4 hover:bg-gray-50 transition-colors flex items-center gap-4">
                            <div className="p-2 rounded-xl" style={{ backgroundColor: withAlpha(ASSET_COLORS[item.kind] || '#6b7280', 0.1) }}>
                              <Icon size={20} style={{ color: ASSET_COLORS[item.kind] || '#6b7280' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 truncate">{getItemDisplayName(item)}</p>
                              <p className="text-sm text-gray-500">{item.building_code} • {ASSET_LABELS[item.kind]}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-red-600">{item.forecast_year}</p>
                              <p className="text-sm text-gray-500">£{(item.estimated_cost_gbp || 0).toLocaleString('en-GB')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => downloadICS(item)}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Add to calendar"
                              >
                                <Calendar size={18} />
                              </button>
                              <button
                                onClick={() => navigateToItem(item)}
                                className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="View details"
                              >
                                <ExternalLink size={18} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </AnimatedCard>

              {/* Asset Distribution */}
              <AnimatedCard delay={600}>
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Asset Distribution</h3>
                  {assetDistributionData && (
                    <div className="h-64">
                      <Doughnut
                        data={assetDistributionData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } }
                          },
                          cutout: '65%'
                        }}
                      />
                    </div>
                  )}
                </div>
              </AnimatedCard>
            </div>

            {/* Asset Table */}
            <AnimatedCard delay={700}>
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">All Assets</h3>
                  <span className="text-sm text-gray-500">{items.length} items</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                        <th className="px-6 py-4">Asset</th>
                        <th className="px-6 py-4">Type</th>
                        <th className="px-6 py-4">Building</th>
                        <th className="px-6 py-4">Forecast Year</th>
                        <th className="px-6 py-4">Est. Cost</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.slice(0, 20).map((item, idx) => {
                        const Icon = ASSET_ICONS[item.kind] || CircleDot;
                        return (
                          <tr key={item.id || idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg" style={{ backgroundColor: withAlpha(ASSET_COLORS[item.kind] || '#6b7280', 0.1) }}>
                                  <Icon size={16} style={{ color: ASSET_COLORS[item.kind] || '#6b7280' }} />
                                </div>
                                <span className="font-medium text-gray-900">{getItemDisplayName(item)}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">{ASSET_LABELS[item.kind] || item.kind}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{item.building_code}</td>
                            <td className="px-6 py-4">
                              <span className={`font-semibold ${item.urgency_level === 'critical' ? 'text-red-600' : item.urgency_level === 'warning' ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {item.forecast_year}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                              £{(item.estimated_cost_gbp || 0).toLocaleString('en-GB')}
                            </td>
                            <td className="px-6 py-4">
                              <Badge variant={item.urgency_level === 'critical' ? 'danger' : item.urgency_level === 'warning' ? 'warning' : 'success'}>
                                {item.remaining_years}y remaining
                              </Badge>
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={() => navigateToItem(item)}
                                className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              >
                                <ExternalLink size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {items.length > 20 && (
                  <div className="px-6 py-4 border-t bg-gray-50 text-center">
                    <span className="text-sm text-gray-500">Showing 20 of {items.length} items. Use filters to refine.</span>
                  </div>
                )}
              </div>
            </AnimatedCard>
          </div>
        )}

        {/* ===== ROLL-UP (TIMELINE) TAB ===== */}
        {tab === 'roll-up' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <AnimatedCard delay={0}>
                <div className="bg-gradient-to-br from-red-500 to-rose-600 rounded-2xl p-6 text-white shadow-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-red-100 font-medium">Critique (&lt;5 ans)</p>
                      <p className="text-4xl font-bold mt-2">
                        {ganttTasks.filter(t => t.urgency === 'critical').length}
                      </p>
                      <p className="text-red-200 text-sm mt-1">
                        £{ganttTasks.filter(t => t.urgency === 'critical').reduce((a, t) => a + (t.cost || 0), 0).toLocaleString('en-GB')}
                      </p>
                    </div>
                    <AlertTriangle size={40} className="text-red-200" />
                  </div>
                </div>
              </AnimatedCard>
              <AnimatedCard delay={100}>
                <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-6 text-white shadow-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-amber-100 font-medium">Attention (5-10 ans)</p>
                      <p className="text-4xl font-bold mt-2">
                        {ganttTasks.filter(t => t.urgency === 'warning').length}
                      </p>
                      <p className="text-amber-200 text-sm mt-1">
                        £{ganttTasks.filter(t => t.urgency === 'warning').reduce((a, t) => a + (t.cost || 0), 0).toLocaleString('en-GB')}
                      </p>
                    </div>
                    <Clock size={40} className="text-amber-200" />
                  </div>
                </div>
              </AnimatedCard>
              <AnimatedCard delay={200}>
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-6 text-white shadow-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-emerald-100 font-medium">OK (&gt;10 ans)</p>
                      <p className="text-4xl font-bold mt-2">
                        {ganttTasks.filter(t => t.urgency === 'ok').length}
                      </p>
                      <p className="text-emerald-200 text-sm mt-1">
                        £{ganttTasks.filter(t => t.urgency === 'ok').reduce((a, t) => a + (t.cost || 0), 0).toLocaleString('en-GB')}
                      </p>
                    </div>
                    <Check size={40} className="text-emerald-200" />
                  </div>
                </div>
              </AnimatedCard>
            </div>

            {/* Timeline View - Grouped by Year */}
            <AnimatedCard delay={300}>
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="px-6 py-5 border-b bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Planning de remplacement</h2>
                      <p className="text-gray-500 text-sm mt-1">Équipements classés par année de fin de vie</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <span className="text-xs text-gray-600">Critique</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500" />
                        <span className="text-xs text-gray-600">Attention</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                        <span className="text-xs text-gray-600">OK</span>
                      </div>
                    </div>
                  </div>
                </div>

                {ganttTasks.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {(() => {
                      // Group tasks by year
                      const byYear = {};
                      ganttTasks.forEach(task => {
                        const year = task.end.getFullYear();
                        if (!byYear[year]) byYear[year] = [];
                        byYear[year].push(task);
                      });
                      const years = Object.keys(byYear).sort((a, b) => Number(a) - Number(b));
                      const currentYear = new Date().getFullYear();

                      return years.map((year, yearIdx) => {
                        const tasksInYear = byYear[year];
                        const yearCost = tasksInYear.reduce((a, t) => a + (t.cost || 0), 0);
                        const yearsFromNow = Number(year) - currentYear;
                        const isExpanded = expandedBuildings[`year-${year}`] !== false;

                        return (
                          <div key={year} className="group">
                            {/* Year Header */}
                            <button
                              onClick={() => setExpandedBuildings(prev => ({ ...prev, [`year-${year}`]: !isExpanded }))}
                              className="w-full px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                            >
                              <div className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center font-bold shadow-lg ${
                                yearsFromNow < 5 ? 'bg-gradient-to-br from-red-500 to-rose-600 text-white' :
                                yearsFromNow <= 10 ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white' :
                                'bg-gradient-to-br from-emerald-500 to-teal-600 text-white'
                              }`}>
                                <span className="text-2xl">{year}</span>
                              </div>
                              <div className="flex-1 text-left">
                                <div className="flex items-center gap-3">
                                  <span className="text-lg font-bold text-gray-900">{tasksInYear.length} équipement{tasksInYear.length > 1 ? 's' : ''}</span>
                                  <Badge variant={yearsFromNow < 5 ? 'danger' : yearsFromNow <= 10 ? 'warning' : 'success'}>
                                    {yearsFromNow <= 0 ? 'Dépassé!' : `dans ${yearsFromNow} an${yearsFromNow > 1 ? 's' : ''}`}
                                  </Badge>
                                </div>
                                <p className="text-gray-500 text-sm mt-1">
                                  CAPEX estimé: <span className="font-semibold text-gray-700">£{yearCost.toLocaleString('en-GB')}</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-4">
                                {/* Mini type distribution */}
                                <div className="hidden md:flex items-center gap-1">
                                  {['sb', 'hv', 'vsd', 'meca'].map(kind => {
                                    const count = tasksInYear.filter(t => t.kind === kind).length;
                                    if (count === 0) return null;
                                    const Icon = ASSET_ICONS[kind];
                                    return (
                                      <div key={kind} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100">
                                        <Icon size={12} style={{ color: ASSET_COLORS[kind] }} />
                                        <span className="text-xs font-medium text-gray-600">{count}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                {isExpanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                              </div>
                            </button>

                            {/* Expanded Items */}
                            {isExpanded && (
                              <div className="px-6 pb-4">
                                <div className="ml-20 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                  {tasksInYear.map((task, idx) => {
                                    const Icon = ASSET_ICONS[task.kind] || CircleDot;
                                    const [kind, id] = task.id.split('-');
                                    return (
                                      <div
                                        key={task.id}
                                        onClick={() => {
                                          if (kind === 'sb') navigate(`/app/switchboards?switchboard=${id}`);
                                          else if (kind === 'hv') navigate(`/app/hv?hv=${id}`);
                                          else if (kind === 'vsd') navigate(`/app/vsd?vsd=${id}`);
                                          else if (kind === 'meca') navigate(`/app/meca?meca=${id}`);
                                        }}
                                        className="group/card flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-md cursor-pointer transition-all bg-white"
                                      >
                                        <div
                                          className="p-2 rounded-xl transition-colors"
                                          style={{ backgroundColor: withAlpha(ASSET_COLORS[task.kind] || '#6b7280', 0.1) }}
                                        >
                                          <Icon size={18} style={{ color: ASSET_COLORS[task.kind] || '#6b7280' }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="font-semibold text-gray-900 truncate group-hover/card:text-emerald-600 transition-colors">
                                            {task.name}
                                          </p>
                                          <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <span>{task.building}</span>
                                            <span>•</span>
                                            <span>{ASSET_LABELS[task.kind]}</span>
                                          </div>
                                        </div>
                                        <div className="text-right">
                                          <p className="font-semibold text-gray-900 text-sm">£{(task.cost || 0).toLocaleString('en-GB')}</p>
                                          <div className={`w-full h-1.5 rounded-full mt-1 overflow-hidden bg-gray-200`}>
                                            <div
                                              className="h-full rounded-full transition-all"
                                              style={{
                                                width: `${task.progress}%`,
                                                backgroundColor: task.urgency === 'critical' ? URGENCY_COLORS.critical : task.urgency === 'warning' ? URGENCY_COLORS.warning : URGENCY_COLORS.ok
                                              }}
                                            />
                                          </div>
                                        </div>
                                        <ExternalLink size={16} className="text-gray-300 group-hover/card:text-emerald-500 transition-colors" />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <div className="h-96 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <Clock size={48} className="mx-auto mb-4 text-gray-300" />
                      <p className="font-medium">Aucune donnée de timeline</p>
                      <p className="text-sm">Ajoutez des équipements pour voir leur cycle de vie</p>
                    </div>
                  </div>
                )}
              </div>
            </AnimatedCard>

            {/* Visual Timeline Bar */}
            {ganttTasks.length > 0 && (
              <AnimatedCard delay={400}>
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Vue chronologique</h3>
                  <div className="relative">
                    {/* Timeline axis */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-4">
                      {(() => {
                        const currentYear = new Date().getFullYear();
                        const years = Array.from({ length: 20 }, (_, i) => currentYear + i);
                        const tasksByYear = {};
                        ganttTasks.forEach(t => {
                          const y = t.end.getFullYear();
                          if (!tasksByYear[y]) tasksByYear[y] = [];
                          tasksByYear[y].push(t);
                        });

                        return years.map(year => {
                          const tasks = tasksByYear[year] || [];
                          const count = tasks.length;
                          const maxHeight = 120;
                          const height = count > 0 ? Math.min(maxHeight, 20 + count * 15) : 20;
                          const cost = tasks.reduce((a, t) => a + (t.cost || 0), 0);
                          const yearsFromNow = year - currentYear;
                          const color = yearsFromNow < 5 ? URGENCY_COLORS.critical : yearsFromNow <= 10 ? URGENCY_COLORS.warning : URGENCY_COLORS.ok;

                          return (
                            <div key={year} className="flex flex-col items-center min-w-[50px]">
                              <div
                                className="w-10 rounded-t-lg transition-all hover:opacity-80 cursor-pointer relative group"
                                style={{
                                  height: `${height}px`,
                                  backgroundColor: count > 0 ? withAlpha(color, 0.8) : '#e5e7eb'
                                }}
                                title={count > 0 ? `${count} équipements - £${cost.toLocaleString('en-GB')}` : 'Aucun équipement'}
                              >
                                {count > 0 && (
                                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                    {count} • £{(cost / 1000).toFixed(0)}k
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-1 font-medium">
                                {year.toString().slice(-2)}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              </AnimatedCard>
            )}
          </div>
        )}

        {/* ===== ANALYSIS TAB ===== */}
        {tab === 'analysis' && (
          <div className="space-y-8">
            {/* CAPEX Forecast Chart */}
            <AnimatedCard>
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">CAPEX Forecast</h2>
                    <p className="text-gray-500 mt-1">20-year capital expenditure projection by building</p>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl">
                    <TrendingUp size={18} />
                    <span className="font-semibold">£{(stats.totalCapex / 1000000).toFixed(2)}M total</span>
                  </div>
                </div>
                {capexChartData ? (
                  <div className="h-[500px]">
                    <Line
                      data={capexChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                          x: { grid: { display: false } },
                          y: {
                            ticks: { callback: v => `£${(v / 1000).toFixed(0)}k` },
                            grid: { color: '#f3f4f6' }
                          }
                        },
                        plugins: {
                          legend: { position: 'top', labels: { usePointStyle: true, padding: 20 } },
                          tooltip: {
                            callbacks: {
                              label: ctx => `${ctx.dataset.label}: £${ctx.raw.toLocaleString('en-GB')}`
                            }
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="h-96 flex items-center justify-center text-gray-500">No forecast data</div>
                )}
              </div>
            </AnimatedCard>

            {/* Two Column: Radar + Urgency */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AnimatedCard delay={100}>
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 h-full">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Risk / Readiness Radar</h3>
                  <div className="h-80">
                    <Radar
                      data={radarData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom' } },
                        scales: {
                          r: {
                            beginAtZero: true,
                            max: 100,
                            grid: { color: '#e5e7eb' },
                            angleLines: { color: '#e5e7eb' }
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              </AnimatedCard>

              <AnimatedCard delay={200}>
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 h-full">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Urgency Distribution</h3>
                  <div className="h-80">
                    <Doughnut
                      data={urgencyDistributionData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } }
                        },
                        cutout: '60%'
                      }}
                    />
                  </div>
                </div>
              </AnimatedCard>
            </div>

            {/* Building Breakdown */}
            <AnimatedCard delay={300}>
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Building Breakdown</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {Object.entries(buildingBuckets).map(([building, bucket], idx) => (
                    <div
                      key={building}
                      className="p-5 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow cursor-pointer"
                      onClick={() => setSelectedBuilding(building)}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: buildingColorMap[building] || PALETTE[idx % PALETTE.length] }}
                          />
                          <h4 className="font-bold text-gray-900">Building {building}</h4>
                        </div>
                        <span className="text-sm text-gray-500">{bucket.total || 0} assets</span>
                      </div>
                      <UrgencyBar
                        urgent={bucket.urgent || 0}
                        medium={bucket.medium || 0}
                        low={bucket.low || 0}
                        total={bucket.total || 0}
                      />
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-sm text-gray-500">
                          Est. CAPEX: <span className="font-semibold text-gray-900">
                            £{((capexForecast[building] || []).reduce((a, b) => a + b.capex_year, 0) / 1000).toFixed(0)}k
                          </span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </AnimatedCard>
          </div>
        )}
      </div>

      {/* ===== MODALS ===== */}

      {/* Filters Modal */}
      <Modal open={showFilters} onClose={() => setShowFilters(false)} title="Filters" icon={Filter}>
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Building</label>
            <select
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              value={selectedBuilding || ''}
              onChange={e => setSelectedBuilding(e.target.value || null)}
            >
              <option value="">All Buildings</option>
              {buildings.map(b => (
                <option key={b.building} value={b.building}>{b.building} ({b.count} assets)</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Asset Type</label>
            <div className="grid grid-cols-2 gap-3">
              {['all', 'sb', 'hv', 'vsd', 'meca'].map(type => (
                <button
                  key={type}
                  onClick={() => setSelectedAsset(type)}
                  className={`px-4 py-3 rounded-xl font-medium transition-colors ${selectedAsset === type
                      ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  {type === 'all' ? 'All Types' : ASSET_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={() => {
                setSelectedBuilding(null);
                setSelectedAsset('all');
              }}
              className="flex-1 px-4 py-3 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
            >
              Clear All
            </button>
            <button
              onClick={() => setShowFilters(false)}
              className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </Modal>

      {/* AI Assistant Modal */}
      <Modal open={aiOpen} onClose={() => setAiOpen(false)} title="AI Assistant" icon={HelpCircle} wide>
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 rounded-xl text-sm text-amber-800">
            Ask about obsolescence strategies, pricing estimates, replacement schedules, or get recommendations for monitoring solutions.
            {health.web_cost && <span className="ml-2 font-medium">(Web-assist pricing enabled)</span>}
          </div>

          <div className="h-80 overflow-y-auto rounded-xl border border-gray-200 p-4 bg-gray-50 space-y-4">
            {aiMessages.length === 0 && (
              <div className="text-gray-500 text-sm">
                Try: "What's the roadmap for building 21?" or "MCCB 250A price UK?"
              </div>
            )}
            {aiMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl ${m.role === 'user'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-800'
                  }`}>
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendAi()}
              placeholder="Ask anything about obsolescence..."
              className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <button
              onClick={sendAi}
              className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700"
            >
              Send
            </button>
          </div>

          {!health.openai && (
            <p className="text-xs text-red-600">OpenAI not configured. Set OPENAI_API_KEY to enable AI features.</p>
          )}
        </div>
      </Modal>

      {/* Toast */}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Loading Overlay */}
      {busy && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl flex items-center gap-4">
            <RefreshCw size={24} className="animate-spin text-emerald-600" />
            <span className="font-medium text-gray-700">Loading...</span>
          </div>
        </div>
      )}
    </section>
  );
}
