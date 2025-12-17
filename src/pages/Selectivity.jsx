// src/pages/Selectivity.jsx - Full Auto IEC 60947-2 Protection Coordination
import React, { useState, useEffect, useMemo } from 'react';
import {
  GitBranch, AlertTriangle, CheckCircle, X, Download, Shield, Clock,
  Activity, Settings, Info, RefreshCw, ChevronDown, ChevronRight,
  AlertCircle, Book, HelpCircle, Layers, ArrowRight, ArrowDown,
  Check, XCircle, Building2, Zap, Filter, BarChart3
} from 'lucide-react';
import { get } from '../lib/api.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// ==================== IEC 60947-2 CALCULATIONS ====================

const CURVE_TYPES = {
  B: { thermal: { min: 3, max: 5 }, magnetic: { min: 3, max: 5 } },
  C: { thermal: { min: 5, max: 10 }, magnetic: { min: 5, max: 10 } },
  D: { thermal: { min: 10, max: 14 }, magnetic: { min: 10, max: 14 } },
  K: { thermal: { min: 10, max: 14 }, magnetic: { min: 10, max: 14 } },
  Z: { thermal: { min: 2.4, max: 3.6 }, magnetic: { min: 2.4, max: 3.6 } }
};

function generateTripCurve(params) {
  const { In = 100, Ir = 1.0, Tr = 10, Isd = 8, Tsd = 0.1, Ii = 10, curve = 'C', isMCCB = true } = params;
  const points = [];
  const Ir_A = Ir * In;
  const Isd_A = Isd * Ir * In;
  const Ii_A = Ii * In;

  for (let mult = 0.5; mult <= 100; mult *= 1.1) {
    const I = mult * In;
    let t;

    if (isMCCB) {
      if (I >= Ii_A) t = 0.01;
      else if (I >= Isd_A) t = Tsd;
      else if (I >= Ir_A) {
        t = Tr * Math.pow(Ir_A / I, 2);
        t = Math.max(t, 0.01);
        t = Math.min(t, 10000);
      } else t = null;
    } else {
      const curveData = CURVE_TYPES[curve] || CURVE_TYPES.C;
      const magMin = curveData.magnetic.min * In;
      const magMax = curveData.magnetic.max * In;
      if (I >= magMax) t = 0.01;
      else if (I >= magMin) t = 0.02 + (magMax - I) / (magMax - magMin) * 0.1;
      else if (I >= 1.13 * In) {
        t = 3600 * Math.pow(1.45 * In / I, 2);
        t = Math.min(t, 10000);
      } else t = null;
    }

    if (t !== null) points.push({ current: I, time: t });
  }
  return points;
}

function getTripTime(params, I) {
  const { In, Ir = 1, Tr = 10, Isd = 8, Tsd = 0.1, Ii = 10 } = params;
  const Ir_A = Ir * In;
  const Isd_A = Isd * Ir * In;
  const Ii_A = Ii * In;
  if (I >= Ii_A) return 0.01;
  if (I >= Isd_A) return Tsd;
  if (I >= Ir_A) return Math.max(Tr * Math.pow(Ir_A / I, 2), 0.01);
  return null;
}

function checkSelectivity(upstream, downstream, faultCurrents) {
  const results = [];
  let isSelective = true;
  let isPartiallySelective = false;

  for (const Ifault of faultCurrents) {
    const tUp = getTripTime(upstream, Ifault);
    const tDown = getTripTime(downstream, Ifault);
    let status;
    if (tDown === null || tUp === null) status = 'no_trip';
    else if (tDown < tUp * 0.9) status = 'selective';
    else if (tDown < tUp) { status = 'partial'; isPartiallySelective = true; }
    else { status = 'non_selective'; isSelective = false; }

    results.push({ current: Ifault, tUp, tDown, status, margin: tUp && tDown ? ((tUp - tDown) / tUp * 100) : null });
  }

  return {
    results,
    isSelective: isSelective && !isPartiallySelective,
    isPartiallySelective,
    limitCurrent: isSelective ? null : results.find(r => r.status === 'non_selective')?.current
  };
}

// Convert device from DB to trip params
function deviceToTripParams(device) {
  const settings = device.settings || {};
  const In = device.in_amps || 100;
  return {
    name: device.name || `${device.manufacturer || ''} ${device.reference || ''}`.trim() || 'Device',
    In,
    Ir: settings.Ir || 1.0,
    Tr: settings.Tr || (In > 100 ? 15 : 10),
    Isd: settings.Isd || 8,
    Tsd: settings.Tsd || (In > 100 ? 0.2 : 0.1),
    Ii: settings.Ii || (In > 100 ? 12 : 10),
    isMCCB: device.device_type?.includes('MCCB') || In > 63,
    curve: settings.curve || 'C',
    _device: device
  };
}

// ==================== HELPERS ====================

const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const config = {
    success: { bg: 'bg-emerald-500', Icon: CheckCircle },
    error: { bg: 'bg-red-500', Icon: AlertCircle },
    info: { bg: 'bg-purple-500', Icon: Info },
    warning: { bg: 'bg-amber-500', Icon: AlertTriangle }
  };
  const { bg, Icon } = config[type] || config.info;
  return (
    <div className={`fixed bottom-4 right-4 z-[200] ${bg} text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-slideUp`}>
      <Icon size={22} /><span className="font-medium">{message}</span>
      <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-xl"><X size={16} /></button>
    </div>
  );
};

const Badge = ({ children, variant = 'default', size = 'md', className = '' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700 border-gray-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  const sizes = { sm: 'px-2 py-0.5 text-[10px]', md: 'px-2.5 py-1 text-xs', lg: 'px-3 py-1.5 text-sm' };
  return <span className={`inline-flex items-center gap-1 rounded-full font-semibold border ${variants[variant]} ${sizes[size]} ${className}`}>{children}</span>;
};

// ==================== STATS CARD ====================

const StatsCard = ({ icon: Icon, label, value, color, subtext }) => (
  <div className={`bg-white rounded-2xl border border-gray-100 p-5 shadow-lg hover:shadow-xl transition-shadow`}>
    <div className="flex items-center gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={24} className="text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {subtext && <p className="text-xs text-gray-400">{subtext}</p>}
      </div>
    </div>
  </div>
);

// ==================== SELECTIVITY PAIR CARD ====================

const SelectivityPairCard = ({ upstream, downstream, result, expanded, onToggle }) => {
  const statusConfig = {
    selective: { color: 'emerald', icon: CheckCircle, label: 'Sélectif', bg: 'bg-emerald-500' },
    partial: { color: 'amber', icon: AlertTriangle, label: 'Partiel', bg: 'bg-amber-500' },
    non_selective: { color: 'red', icon: XCircle, label: 'Non Sélectif', bg: 'bg-red-500' }
  };

  const status = result.isSelective ? 'selective' : result.isPartiallySelective ? 'partial' : 'non_selective';
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <div className={`bg-white rounded-xl border-2 border-${config.color}-200 overflow-hidden mb-3`}>
      <button onClick={onToggle} className={`w-full p-4 flex items-center justify-between hover:bg-${config.color}-50 transition-colors`}>
        <div className="flex items-center gap-4">
          <div className={`p-2 ${config.bg} rounded-lg`}>
            <StatusIcon size={20} className="text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">{upstream.name}</span>
              <ArrowRight size={16} className="text-gray-400" />
              <span className="font-semibold text-gray-900">{downstream.name}</span>
            </div>
            <p className="text-sm text-gray-500">
              {upstream.In}A → {downstream.In}A
              {typeof result.limitCurrent === 'number' && <span className="text-red-600 ml-2">| Limite: {result.limitCurrent.toFixed(0)}A</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={status === 'selective' ? 'success' : status === 'partial' ? 'warning' : 'danger'}>
            {config.label}
          </Badge>
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-4 bg-gray-50">
          {/* Trip Curve Chart */}
          <div className="mb-4">
            <MiniSelectivityChart upstream={upstream} downstream={downstream} result={result} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
              <p className="text-xs font-semibold text-purple-800 mb-1">AMONT</p>
              <p className="font-bold">{upstream.name}</p>
              <div className="grid grid-cols-3 gap-1 mt-2 text-xs">
                <span>In: {upstream.In}A</span>
                <span>Ir: {upstream.Ir}×</span>
                <span>Ii: {upstream.Ii}×</span>
              </div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <p className="text-xs font-semibold text-green-800 mb-1">AVAL</p>
              <p className="font-bold">{downstream.name}</p>
              <div className="grid grid-cols-3 gap-1 mt-2 text-xs">
                <span>In: {downstream.In}A</span>
                <span>Ir: {downstream.Ir}×</span>
                <span>Ii: {downstream.Ii}×</span>
              </div>
            </div>
          </div>

          <table className="w-full text-xs overflow-x-auto">
            <thead>
              <tr className="bg-gray-200">
                <th className="px-2 py-1 text-left">Icc (A)</th>
                <th className="px-2 py-1 text-left">t Amont</th>
                <th className="px-2 py-1 text-left">t Aval</th>
                <th className="px-2 py-1 text-left">Marge</th>
                <th className="px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.results.slice(0, 8).map((r, idx) => (
                <tr key={idx} className={r.status === 'selective' ? 'bg-emerald-50' : r.status === 'partial' ? 'bg-amber-50' : r.status === 'non_selective' ? 'bg-red-50' : ''}>
                  <td className="px-2 py-1 font-mono">{r.current.toFixed(0)}</td>
                  <td className="px-2 py-1 font-mono">{r.tUp?.toFixed(3) || '—'}</td>
                  <td className="px-2 py-1 font-mono">{r.tDown?.toFixed(3) || '—'}</td>
                  <td className="px-2 py-1 font-mono">{r.margin?.toFixed(1) || '—'}%</td>
                  <td className="px-2 py-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.status === 'selective' ? 'bg-emerald-200 text-emerald-800' : r.status === 'partial' ? 'bg-amber-200 text-amber-800' : r.status === 'non_selective' ? 'bg-red-200 text-red-800' : 'bg-gray-200'}`}>
                      {r.status === 'selective' ? 'OK' : r.status === 'partial' ? '~' : r.status === 'non_selective' ? 'NON' : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ==================== SWITCHBOARD SELECTIVITY CARD ====================

const SwitchboardSelectivityCard = ({ board, devices, pairResults, expanded, onToggle }) => {
  const stats = useMemo(() => {
    const selective = pairResults.filter(p => p.result.isSelective).length;
    const partial = pairResults.filter(p => p.result.isPartiallySelective).length;
    const nonSelective = pairResults.filter(p => !p.result.isSelective && !p.result.isPartiallySelective).length;
    return { total: pairResults.length, selective, partial, nonSelective };
  }, [pairResults]);

  const [expandedPairs, setExpandedPairs] = useState({});

  const statusColor = stats.nonSelective > 0 ? 'red' : stats.partial > 0 ? 'amber' : 'emerald';

  return (
    <div className={`bg-white rounded-2xl border-2 border-${statusColor}-200 overflow-hidden shadow-lg`}>
      <button onClick={onToggle} className={`w-full p-5 flex items-center justify-between hover:bg-${statusColor}-50 transition-colors`}>
        <div className="flex items-center gap-4">
          <div className={`p-3 bg-${statusColor}-500 rounded-xl`}>
            <Building2 size={24} className="text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-gray-900">{board.name}</h3>
            <p className="text-sm text-gray-500">{board.code} • {devices.length} devices • {stats.total} paires</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {stats.selective > 0 && <Badge variant="success">{stats.selective} OK</Badge>}
            {stats.partial > 0 && <Badge variant="warning">{stats.partial} Partiel</Badge>}
            {stats.nonSelective > 0 && <Badge variant="danger">{stats.nonSelective} NON</Badge>}
          </div>
          {expanded ? <ChevronDown size={24} /> : <ChevronRight size={24} />}
        </div>
      </button>

      {expanded && pairResults.length > 0 && (
        <div className="border-t border-gray-100 p-4 bg-gray-50">
          {pairResults.map((pair, idx) => (
            <SelectivityPairCard
              key={idx}
              upstream={pair.upstream}
              downstream={pair.downstream}
              result={pair.result}
              expanded={expandedPairs[idx]}
              onToggle={() => setExpandedPairs(p => ({ ...p, [idx]: !p[idx] }))}
            />
          ))}
        </div>
      )}

      {expanded && pairResults.length === 0 && (
        <div className="border-t border-gray-100 p-8 text-center text-gray-500">
          <Layers size={32} className="mx-auto mb-2 opacity-50" />
          <p>Aucune paire amont/aval détectée</p>
          <p className="text-xs mt-1">Les devices doivent avoir un parent_id pour établir la hiérarchie</p>
        </div>
      )}
    </div>
  );
};

// ==================== MINI CHART FOR PAIR ====================

const MiniSelectivityChart = ({ upstream, downstream, result }) => {
  const upCurve = useMemo(() => generateTripCurve(upstream), [upstream]);
  const downCurve = useMemo(() => generateTripCurve(downstream), [downstream]);

  const chartData = {
    datasets: [
      {
        label: `Amont (${upstream.In}A)`,
        data: upCurve.map(p => ({ x: p.current, y: p.time })),
        borderColor: 'rgb(168, 85, 247)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      },
      {
        label: `Aval (${downstream.In}A)`,
        data: downCurve.map(p => ({ x: p.current, y: p.time })),
        borderColor: 'rgb(34, 197, 94)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      }
    ]
  };

  if (result?.limitCurrent) {
    chartData.datasets.push({
      label: 'Limite',
      data: [{ x: result.limitCurrent, y: 0.001 }, { x: result.limitCurrent, y: 10000 }],
      borderColor: 'rgb(239, 68, 68)',
      borderWidth: 2,
      borderDash: [5, 5],
      pointRadius: 0,
      fill: false
    });
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10 } } } },
    scales: {
      x: { type: 'logarithmic', title: { display: true, text: 'I (A)', font: { size: 10 } }, min: Math.min(upstream.In, downstream.In) * 0.5, max: Math.max(upstream.In, downstream.In) * 100 },
      y: { type: 'logarithmic', title: { display: true, text: 't (s)', font: { size: 10 } }, min: 0.001, max: 10000 }
    }
  };

  return (
    <div className="h-64 bg-white rounded-xl border p-3">
      <Line data={chartData} options={options} />
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function Selectivity() {
  const [loading, setLoading] = useState(true);
  const [switchboards, setSwitchboards] = useState([]);
  const [devicesByBoard, setDevicesByBoard] = useState({});
  const [analysisResults, setAnalysisResults] = useState({});
  const [expandedBoards, setExpandedBoards] = useState({});
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('all'); // all, issues, ok

  // Auto-load all data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  // Auto-run analysis when data loaded
  useEffect(() => {
    if (switchboards.length > 0 && Object.keys(devicesByBoard).length > 0) {
      runAllAnalyses();
    }
  }, [devicesByBoard]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // Load all switchboards
      const boardsResp = await get('/api/switchboard/boards', { pageSize: 500 });
      const boards = boardsResp?.data || [];
      setSwitchboards(boards);

      // Load devices for all boards in parallel
      const devicesMap = {};
      await Promise.all(boards.map(async (board) => {
        try {
          const devResp = await get(`/api/switchboard/boards/${board.id}/devices`);
          devicesMap[board.id] = devResp?.data || [];
        } catch (err) {
          devicesMap[board.id] = [];
        }
      }));
      setDevicesByBoard(devicesMap);

      // Auto-expand boards with devices
      const autoExpand = {};
      boards.forEach(b => {
        if ((devicesMap[b.id] || []).length > 0) autoExpand[b.id] = true;
      });
      setExpandedBoards(autoExpand);

    } catch (err) {
      setToast({ type: 'error', message: 'Erreur chargement: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const runAllAnalyses = () => {
    const results = {};

    switchboards.forEach(board => {
      const devices = devicesByBoard[board.id] || [];
      if (devices.length < 2) {
        results[board.id] = [];
        return;
      }

      // Find main breaker (device without parent_id or marked as main)
      const mainBreaker = devices.find(d => !d.parent_id || d.is_main_breaker);
      const childDevices = devices.filter(d => d.parent_id || (!d.is_main_breaker && d.id !== mainBreaker?.id));

      const pairResults = [];

      // If we have a main breaker, check selectivity with all children
      if (mainBreaker) {
        const upstreamParams = deviceToTripParams(mainBreaker);

        childDevices.forEach(child => {
          const downstreamParams = deviceToTripParams(child);

          // Generate fault currents to test
          const maxFault = Math.max(upstreamParams.In, downstreamParams.In) * 50;
          const faultCurrents = [];
          for (let i = downstreamParams.In; i <= maxFault; i *= 1.5) {
            faultCurrents.push(i);
          }

          const result = checkSelectivity(upstreamParams, downstreamParams, faultCurrents);
          pairResults.push({ upstream: upstreamParams, downstream: downstreamParams, result });
        });
      }

      // Also check parent-child relationships between devices
      devices.forEach(child => {
        if (child.parent_id) {
          const parent = devices.find(d => d.id === child.parent_id);
          if (parent && parent.id !== mainBreaker?.id) {
            const upstreamParams = deviceToTripParams(parent);
            const downstreamParams = deviceToTripParams(child);

            const maxFault = Math.max(upstreamParams.In, downstreamParams.In) * 50;
            const faultCurrents = [];
            for (let i = downstreamParams.In; i <= maxFault; i *= 1.5) {
              faultCurrents.push(i);
            }

            const result = checkSelectivity(upstreamParams, downstreamParams, faultCurrents);
            // Avoid duplicates
            if (!pairResults.some(p => p.upstream._device?.id === parent.id && p.downstream._device?.id === child.id)) {
              pairResults.push({ upstream: upstreamParams, downstream: downstreamParams, result });
            }
          }
        }
      });

      results[board.id] = pairResults;
    });

    setAnalysisResults(results);
  };

  // Calculate global stats
  const globalStats = useMemo(() => {
    let totalPairs = 0, selective = 0, partial = 0, nonSelective = 0;

    Object.values(analysisResults).forEach(pairs => {
      pairs.forEach(p => {
        totalPairs++;
        if (p.result.isSelective) selective++;
        else if (p.result.isPartiallySelective) partial++;
        else nonSelective++;
      });
    });

    return { totalPairs, selective, partial, nonSelective, boardsCount: switchboards.length };
  }, [analysisResults, switchboards]);

  // Filter boards
  const filteredBoards = useMemo(() => {
    return switchboards.filter(board => {
      const pairs = analysisResults[board.id] || [];
      if (filter === 'all') return true;
      if (filter === 'issues') return pairs.some(p => !p.result.isSelective);
      if (filter === 'ok') return pairs.every(p => p.result.isSelective) && pairs.length > 0;
      return true;
    });
  }, [switchboards, analysisResults, filter]);

  // Export all to PDF
  const exportAllPDF = () => {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Header
    pdf.setFillColor(168, 85, 247);
    pdf.rect(0, 0, pageWidth, 45, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('SELECTIVITY ANALYSIS REPORT', 14, 25);
    pdf.setFontSize(10);
    pdf.text('IEC 60947-2 Protection Coordination - All Switchboards', 14, 35);

    // Global stats
    let y = 55;
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('GLOBAL STATISTICS', 14, y);
    y += 8;

    pdf.autoTable({
      startY: y,
      head: [['Total Pairs', 'Selective', 'Partial', 'Non-Selective']],
      body: [[globalStats.totalPairs, globalStats.selective, globalStats.partial, globalStats.nonSelective]],
      theme: 'grid',
      headStyles: { fillColor: [168, 85, 247] },
      styles: { fontSize: 10, halign: 'center' }
    });

    y = pdf.lastAutoTable.finalY + 15;

    // Per-board results
    switchboards.forEach(board => {
      const pairs = analysisResults[board.id] || [];
      if (pairs.length === 0) return;

      if (y > pageHeight - 60) {
        pdf.addPage();
        y = 20;
      }

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${board.name} (${board.code})`, 14, y);
      y += 8;

      const tableData = pairs.map(p => [
        p.upstream.name,
        `${p.upstream.In}A`,
        p.downstream.name,
        `${p.downstream.In}A`,
        typeof p.result.limitCurrent === 'number' ? `${p.result.limitCurrent.toFixed(0)}A` : '—',
        p.result.isSelective ? 'OK' : p.result.isPartiallySelective ? 'Partiel' : 'NON'
      ]);

      pdf.autoTable({
        startY: y,
        head: [['Amont', 'In', 'Aval', 'In', 'Limite', 'Status']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100] },
        styles: { fontSize: 8 },
        columnStyles: { 5: { fontStyle: 'bold' } }
      });

      y = pdf.lastAutoTable.finalY + 10;
    });

    // Footer
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Generated ${new Date().toLocaleDateString('fr-FR')} - ElectroHub`, 14, pageHeight - 10);
    pdf.text('IEC 60947-2 Compliant', pageWidth - 50, pageHeight - 10);

    pdf.save(`selectivity_report_all_${new Date().toISOString().slice(0, 10)}.pdf`);
    setToast({ type: 'success', message: 'Rapport PDF exporté!' });
  };

  return (
    <section className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .animate-pulse { animation: pulse 1.5s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 via-purple-500 to-indigo-500 text-white">
        <div className="max-w-[95vw] mx-auto px-4 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-white/20 rounded-2xl">
                <GitBranch size={36} />
              </div>
              <div>
                <h1 className="text-3xl lg:text-4xl font-bold">Selectivity Analysis</h1>
                <p className="text-purple-100 mt-1">Coordination automatique IEC 60947-2</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={loadAllData} disabled={loading}
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors disabled:opacity-50">
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                Actualiser
              </button>
              <button onClick={exportAllPDF} disabled={globalStats.totalPairs === 0}
                className="px-4 py-2.5 bg-white text-purple-600 hover:bg-purple-50 rounded-xl font-medium flex items-center gap-2 transition-colors disabled:opacity-50">
                <Download size={18} />
                Export PDF
              </button>
              <a href="https://webstore.iec.ch/publication/3987" target="_blank" rel="noopener noreferrer"
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors">
                <Book size={18} />IEC 60947
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-[95vw] mx-auto px-4 -mt-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatsCard icon={Building2} label="Tableaux" value={globalStats.boardsCount} color="bg-purple-500" />
          <StatsCard icon={Layers} label="Paires analysées" value={globalStats.totalPairs} color="bg-indigo-500" />
          <StatsCard icon={CheckCircle} label="Sélectifs" value={globalStats.selective} color="bg-emerald-500" subtext={globalStats.totalPairs > 0 ? `${(globalStats.selective/globalStats.totalPairs*100).toFixed(0)}%` : ''} />
          <StatsCard icon={AlertTriangle} label="Partiels" value={globalStats.partial} color="bg-amber-500" />
          <StatsCard icon={XCircle} label="Non Sélectifs" value={globalStats.nonSelective} color="bg-red-500" />
        </div>
      </div>

      {/* Filter */}
      <div className="max-w-[95vw] mx-auto px-4 mt-6">
        <div className="flex items-center gap-2 bg-white rounded-xl p-2 shadow-lg w-fit">
          <Filter size={18} className="text-gray-400 ml-2" />
          {[
            { key: 'all', label: 'Tous' },
            { key: 'issues', label: 'Problèmes' },
            { key: 'ok', label: 'OK' }
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${filter === f.key ? 'bg-purple-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[95vw] mx-auto px-4 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-4" />
            <p className="text-gray-500 animate-pulse">Chargement et analyse automatique...</p>
          </div>
        ) : filteredBoards.length === 0 ? (
          <div className="bg-white rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
            <div className="w-24 h-24 mx-auto mb-6 bg-purple-100 rounded-3xl flex items-center justify-center">
              <GitBranch size={48} className="text-purple-500" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Aucun tableau trouvé</h3>
            <p className="text-gray-500">Créez des tableaux électriques avec des disjoncteurs pour voir l'analyse de sélectivité automatique.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredBoards.map(board => (
              <SwitchboardSelectivityCard
                key={board.id}
                board={board}
                devices={devicesByBoard[board.id] || []}
                pairResults={analysisResults[board.id] || []}
                expanded={expandedBoards[board.id]}
                onToggle={() => setExpandedBoards(e => ({ ...e, [board.id]: !e[board.id] }))}
              />
            ))}
          </div>
        )}

        {/* Info Panel */}
        {!loading && globalStats.totalPairs > 0 && (
          <div className="mt-8 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border border-purple-100 p-6">
            <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <HelpCircle size={18} className="text-purple-600" />
              Principe de sélectivité (IEC 60947-2)
            </h4>
            <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-600">
              <div className="flex items-start gap-2">
                <CheckCircle size={16} className="text-emerald-500 mt-0.5" />
                <div><strong className="text-emerald-700">Sélectif:</strong> Le disjoncteur aval déclenche toujours avant l'amont (marge &gt;10%)</div>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-500 mt-0.5" />
                <div><strong className="text-amber-700">Partiel:</strong> Sélectivité jusqu'à un certain courant de défaut</div>
              </div>
              <div className="flex items-start gap-2">
                <XCircle size={16} className="text-red-500 mt-0.5" />
                <div><strong className="text-red-700">Non sélectif:</strong> Risque de déclenchement simultané</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </section>
  );
}
