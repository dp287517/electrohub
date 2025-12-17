// src/pages/Fault_level_assessment.jsx - Full Auto IEC 60909 Fault Level Assessment
import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap, AlertTriangle, CheckCircle, XCircle, Building2, ChevronDown, ChevronRight,
  Settings, Download, RefreshCw, AlertCircle, Activity, TrendingUp, Shield,
  Info, Book, Cpu, Filter, Search, BarChart3
} from 'lucide-react';
import { get } from '../lib/api.js';
import { calculateFaultLevel, STANDARD_PARAMS, getCableSection } from '../lib/electrical-calculations.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const cardClass = "bg-white rounded-xl border shadow-sm overflow-hidden";
const badgeClass = "px-2 py-1 rounded-full text-xs font-semibold";

// ═══════════════════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════════════════

// Fault Current Comparison Chart - Ik" vs Icu for all boards
const FaultCurrentComparisonChart = ({ switchboards, devicesByBoard, analyses }) => {
  const chartData = useMemo(() => {
    const boardsWithData = switchboards
      .filter(b => analyses[b.id] && (devicesByBoard[b.id]?.length || 0) > 0)
      .sort((a, b) => (analyses[b.id]?.Ik_kA || 0) - (analyses[a.id]?.Ik_kA || 0))
      .slice(0, 15);

    if (boardsWithData.length === 0) return null;

    return {
      labels: boardsWithData.map(b => b.code || b.name.slice(0, 12)),
      datasets: [
        {
          label: 'Ik" (kA)',
          data: boardsWithData.map(b => analyses[b.id]?.Ik_kA || 0),
          backgroundColor: boardsWithData.map(b => {
            const analysis = analyses[b.id];
            const devices = devicesByBoard[b.id] || [];
            const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];
            const icuOk = !mainDevice?.icu_ka || analysis.Ik_kA <= mainDevice.icu_ka;
            return icuOk ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
          }),
          borderRadius: 6
        },
        {
          label: 'Icu (kA)',
          data: boardsWithData.map(b => {
            const devices = devicesByBoard[b.id] || [];
            const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];
            return mainDevice?.icu_ka || 0;
          }),
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 2,
          borderRadius: 6
        }
      ]
    };
  }, [switchboards, devicesByBoard, analyses]);

  if (!chartData) return null;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Comparaison Ik" vs Icu par tableau', font: { size: 14, weight: 'bold' } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} kA`
        }
      }
    },
    scales: {
      x: { ticks: { font: { size: 10 } } },
      y: { title: { display: true, text: 'kA' }, beginAtZero: true }
    }
  };

  return (
    <div className="bg-white rounded-xl border p-4 shadow-lg mb-6">
      <div className="h-72">
        <Bar data={chartData} options={options} />
      </div>
      <div className="flex justify-center gap-6 mt-3 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-500"></div>
          <span>Ik" ≤ Icu (OK)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-500"></div>
          <span>Ik" &gt; Icu (Danger)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-blue-400"></div>
          <span>Icu nominal</span>
        </div>
      </div>
    </div>
  );
};

// Device-level chart within a switchboard
const DeviceFaultChart = ({ board, devices, boardAnalysis }) => {
  const chartData = useMemo(() => {
    if (!boardAnalysis || devices.length < 2) return null;

    const deviceData = devices.map(dev => {
      const devFla = calculateFaultLevel({
        voltage_v: board.voltage_v || 400,
        source_fault_ka: boardAnalysis.Ik_kA,
        cable_length_m: dev.cable_length_m || 15,
        cable_section_mm2: dev.cable_section_mm2 || getCableSection(dev.in_amps || 100),
      });
      return {
        name: dev.name || dev.reference || 'Device',
        ik: devFla.Ik_kA,
        icu: dev.icu_ka || 0,
        ok: !dev.icu_ka || devFla.Ik_kA <= dev.icu_ka
      };
    });

    return {
      labels: deviceData.map(d => d.name.slice(0, 10)),
      datasets: [
        {
          label: 'Ik"',
          data: deviceData.map(d => d.ik),
          backgroundColor: deviceData.map(d => d.ok ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)'),
          borderRadius: 4
        },
        {
          label: 'Icu',
          data: deviceData.map(d => d.icu),
          backgroundColor: 'rgba(59, 130, 246, 0.4)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    };
  }, [board, devices, boardAnalysis]);

  if (!chartData) return null;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10 } } },
      title: { display: false }
    },
    scales: {
      x: { title: { display: true, text: 'kA' }, beginAtZero: true },
      y: { ticks: { font: { size: 9 } } }
    }
  };

  return (
    <div className="h-48 mt-4">
      <Bar data={chartData} options={options} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

const StatusBadge = ({ ok, danger }) => (
  <span className={`${badgeClass} ${danger ? 'bg-red-100 text-red-700' : ok ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
    {danger ? <XCircle size={12} className="inline mr-1" /> : ok ? <CheckCircle size={12} className="inline mr-1" /> : <AlertTriangle size={12} className="inline mr-1" />}
    {danger ? 'DANGER' : ok ? 'OK' : 'ATTENTION'}
  </span>
);

const ValueCard = ({ label, value, unit, status, icon: Icon }) => (
  <div className={`p-4 rounded-xl border-2 ${status === 'danger' ? 'bg-red-50 border-red-200' : status === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'}`}>
    <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
      {Icon && <Icon size={14} />}
      {label}
    </div>
    <div className="flex items-baseline gap-1">
      <span className={`text-2xl font-bold ${status === 'danger' ? 'text-red-600' : status === 'warning' ? 'text-amber-600' : 'text-gray-900'}`}>
        {value}
      </span>
      <span className="text-gray-500 text-sm">{unit}</span>
    </div>
  </div>
);

const SwitchboardCard = ({ board, devices, analysis, expanded, onToggle }) => {
  const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];
  const icuOk = !mainDevice?.icu_ka || (analysis?.Ik_kA <= mainDevice.icu_ka);
  const hasDevices = devices.length > 0;

  return (
    <div className={`${cardClass} transition-all ${!icuOk ? 'ring-2 ring-red-400' : ''}`}>
      {/* Header */}
      <div
        className={`px-4 py-3 cursor-pointer flex items-center justify-between ${!icuOk ? 'bg-red-50' : hasDevices ? 'bg-blue-50' : 'bg-gray-50'}`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${!icuOk ? 'bg-red-100' : 'bg-blue-100'}`}>
            <Building2 size={20} className={!icuOk ? 'text-red-600' : 'text-blue-600'} />
          </div>
          <div>
            <div className="font-semibold text-gray-900">{board.name}</div>
            <div className="text-sm text-gray-500">{board.code} • {devices.length} device(s)</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {analysis && <StatusBadge ok={icuOk} danger={!icuOk} />}
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="p-4 border-t bg-white">
          {!hasDevices ? (
            <div className="text-center text-gray-500 py-8">
              <Zap size={32} className="mx-auto mb-2 text-gray-300" />
              <p>Aucun disjoncteur dans ce tableau</p>
              <p className="text-sm">Ajoutez des disjoncteurs pour voir l'analyse</p>
            </div>
          ) : analysis ? (
            <div className="space-y-4">
              {/* Main Results Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ValueCard
                  label='Ik" (Initial)'
                  value={analysis.Ik_kA.toFixed(2)}
                  unit="kA"
                  status={!icuOk ? 'danger' : null}
                  icon={Zap}
                />
                <ValueCard label="Ip (Crête)" value={analysis.Ip_kA.toFixed(2)} unit="kA" icon={TrendingUp} />
                <ValueCard label="Ib (Coupure)" value={analysis.Ib_kA.toFixed(2)} unit="kA" icon={Activity} />
                <ValueCard label="Ith (1s)" value={analysis.Ith_kA.toFixed(2)} unit="kA" icon={Shield} />
              </div>

              {/* Technical Details */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <div className="text-xs text-gray-500">R/X</div>
                  <div className="font-semibold">{analysis.RX_ratio}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <div className="text-xs text-gray-500">κ</div>
                  <div className="font-semibold">{analysis.kappa}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <div className="text-xs text-gray-500">Z total</div>
                  <div className="font-semibold">{analysis.Ztotal_mohm.toFixed(2)} mΩ</div>
                </div>
              </div>

              {/* Main Device Comparison */}
              {mainDevice && (
                <div className={`p-4 rounded-xl ${icuOk ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-900">{mainDevice.name || mainDevice.reference}</div>
                      <div className="text-sm text-gray-500">{mainDevice.manufacturer} • {mainDevice.in_amps}A</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Icu du disjoncteur</div>
                      <div className={`text-xl font-bold ${icuOk ? 'text-green-600' : 'text-red-600'}`}>
                        {mainDevice.icu_ka || '?'} kA
                      </div>
                    </div>
                  </div>
                  {!icuOk && (
                    <div className="mt-3 p-2 bg-red-100 rounded-lg text-red-700 text-sm flex items-center gap-2">
                      <AlertTriangle size={16} />
                      Ik" ({analysis.Ik_kA.toFixed(1)} kA) dépasse Icu ({mainDevice.icu_ka} kA) - Disjoncteur sous-dimensionné!
                    </div>
                  )}
                </div>
              )}

              {/* Device Fault Chart */}
              {devices.length > 1 && (
                <DeviceFaultChart board={board} devices={devices} boardAnalysis={analysis} />
              )}

              {/* Per-Device Analysis */}
              {devices.length > 1 && (
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700 flex items-center gap-2">
                    <ChevronRight size={16} className="group-open:rotate-90 transition-transform" />
                    Tableau détaillé ({devices.length} devices)
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left">Device</th>
                          <th className="px-3 py-2 text-right">In</th>
                          <th className="px-3 py-2 text-right">Ik"</th>
                          <th className="px-3 py-2 text-right">Icu</th>
                          <th className="px-3 py-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {devices.map(dev => {
                          const devFla = calculateFaultLevel({
                            voltage_v: board.voltage_v || 400,
                            source_fault_ka: analysis.Ik_kA,
                            cable_length_m: dev.cable_length_m || 15,
                            cable_section_mm2: dev.cable_section_mm2 || getCableSection(dev.in_amps || 100),
                          });
                          const devOk = !dev.icu_ka || devFla.Ik_kA <= dev.icu_ka;
                          return (
                            <tr key={dev.id} className={`border-t ${!devOk ? 'bg-red-50' : ''}`}>
                              <td className="px-3 py-2 font-medium">{dev.name || dev.reference}</td>
                              <td className="px-3 py-2 text-right">{dev.in_amps}A</td>
                              <td className="px-3 py-2 text-right font-mono">{devFla.Ik_kA.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right">{dev.icu_ka || '-'}</td>
                              <td className="px-3 py-2 text-center">
                                {devOk ? <CheckCircle size={16} className="inline text-green-500" /> : <XCircle size={16} className="inline text-red-500" />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <RefreshCw size={24} className="animate-spin mx-auto text-blue-500" />
              <p className="text-sm text-gray-500 mt-2">Calcul en cours...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function FaultLevelAssessment() {
  const [switchboards, setSwitchboards] = useState([]);
  const [devicesByBoard, setDevicesByBoard] = useState({});
  const [analyses, setAnalyses] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedBoards, setExpandedBoards] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  // Network settings
  const [settings, setSettings] = useState({
    upstreamFaultKa: 50,
    transformerKva: 630,
  });

  // Load all switchboards on mount
  useEffect(() => {
    loadAllData();
  }, []);

  // Recalculate when settings change
  useEffect(() => {
    if (switchboards.length > 0) {
      runAllAnalyses();
    }
  }, [settings, devicesByBoard]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // Load all switchboards
      const boardsResp = await get('/api/switchboard/boards', { pageSize: 500 });
      const boards = boardsResp?.data || [];
      setSwitchboards(boards);

      // Load devices for each board in parallel
      const devicesMap = {};
      await Promise.all(boards.map(async (board) => {
        try {
          const devResp = await get(`/api/switchboard/boards/${board.id}/devices`);
          devicesMap[board.id] = devResp?.data || [];
        } catch (e) {
          devicesMap[board.id] = [];
        }
      }));
      setDevicesByBoard(devicesMap);

      // Auto-expand boards with issues
      const expanded = new Set();
      boards.forEach(b => {
        if (devicesMap[b.id]?.length > 0) {
          expanded.add(b.id);
        }
      });
      setExpandedBoards(expanded);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const runAllAnalyses = () => {
    const newAnalyses = {};
    let faultLevelMap = new Map();

    // Sort boards: principal first, then by code
    const sortedBoards = [...switchboards].sort((a, b) => {
      if (a.is_principal && !b.is_principal) return -1;
      if (!a.is_principal && b.is_principal) return 1;
      return (a.code || '').localeCompare(b.code || '');
    });

    for (const board of sortedBoards) {
      const devices = devicesByBoard[board.id] || [];
      if (devices.length === 0) continue;

      const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];

      // Determine upstream fault level
      let upstreamFaultKa = settings.upstreamFaultKa;

      // Check if fed from another board
      for (const [boardId, boardDevices] of Object.entries(devicesByBoard)) {
        const feedingDevice = boardDevices.find(d => d.downstream_switchboard_id === board.id);
        if (feedingDevice && faultLevelMap.has(Number(boardId))) {
          upstreamFaultKa = faultLevelMap.get(Number(boardId)).Ik_kA;
          break;
        }
      }

      const analysis = calculateFaultLevel({
        voltage_v: board.voltage_v || mainDevice?.voltage_v || 400,
        source_fault_ka: upstreamFaultKa,
        cable_length_m: mainDevice?.cable_length_m || STANDARD_PARAMS.cableLengths.default,
        cable_section_mm2: mainDevice?.cable_section_mm2 || getCableSection(mainDevice?.in_amps || 100),
        cable_material: mainDevice?.cable_material || 'copper',
        transformer_kva: board.is_principal ? settings.transformerKva : null,
        transformer_ukr: board.is_principal ? STANDARD_PARAMS.transformers[settings.transformerKva] : null,
      });

      newAnalyses[board.id] = analysis;
      faultLevelMap.set(board.id, analysis);
    }

    setAnalyses(newAnalyses);
  };

  // Filter boards
  const filteredBoards = useMemo(() => {
    return switchboards.filter(board => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!board.name.toLowerCase().includes(query) && !board.code?.toLowerCase().includes(query)) {
          return false;
        }
      }

      // Status filter
      if (filterStatus !== 'all') {
        const devices = devicesByBoard[board.id] || [];
        const analysis = analyses[board.id];
        const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];
        const icuOk = !mainDevice?.icu_ka || !analysis || analysis.Ik_kA <= mainDevice.icu_ka;

        if (filterStatus === 'danger' && icuOk) return false;
        if (filterStatus === 'ok' && !icuOk) return false;
        if (filterStatus === 'empty' && devices.length > 0) return false;
      }

      return true;
    });
  }, [switchboards, devicesByBoard, analyses, searchQuery, filterStatus]);

  // Stats
  const stats = useMemo(() => {
    let total = 0, ok = 0, danger = 0, empty = 0;
    switchboards.forEach(board => {
      const devices = devicesByBoard[board.id] || [];
      if (devices.length === 0) { empty++; return; }
      total++;
      const analysis = analyses[board.id];
      const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];
      const icuOk = !mainDevice?.icu_ka || !analysis || analysis.Ik_kA <= mainDevice.icu_ka;
      if (icuOk) ok++; else danger++;
    });
    return { total, ok, danger, empty };
  }, [switchboards, devicesByBoard, analyses]);

  // Export all to PDF
  const exportPDF = () => {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Header
    pdf.setFillColor(30, 58, 138);
    pdf.rect(0, 0, pageWidth, 40, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('FAULT LEVEL ASSESSMENT', 14, 20);
    pdf.setFontSize(10);
    pdf.text(`Analyse automatique IEC 60909 - ${new Date().toLocaleDateString()}`, 14, 32);

    // Stats
    let y = 50;
    pdf.setTextColor(0);
    pdf.setFontSize(12);
    pdf.text(`Tableaux analysés: ${stats.total} | OK: ${stats.ok} | Danger: ${stats.danger} | Sans devices: ${stats.empty}`, 14, y);

    y += 15;

    // Table
    const tableData = [];
    filteredBoards.forEach(board => {
      const devices = devicesByBoard[board.id] || [];
      const analysis = analyses[board.id];
      const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];
      const icuOk = !mainDevice?.icu_ka || !analysis || analysis.Ik_kA <= mainDevice.icu_ka;

      tableData.push([
        board.name,
        board.code || '-',
        devices.length,
        analysis ? analysis.Ik_kA.toFixed(2) : '-',
        analysis ? analysis.Ip_kA.toFixed(2) : '-',
        mainDevice?.icu_ka || '-',
        icuOk ? 'OK' : 'DANGER'
      ]);
    });

    pdf.autoTable({
      startY: y,
      head: [['Tableau', 'Code', 'Devices', 'Ik" (kA)', 'Ip (kA)', 'Icu (kA)', 'Status']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [30, 58, 138] },
      didParseCell: (data) => {
        if (data.column.index === 6 && data.section === 'body') {
          data.cell.styles.textColor = data.cell.text[0] === 'OK' ? [22, 163, 74] : [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    pdf.save(`FLA_report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <section className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
      `}</style>

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 text-white">
        <div className="max-w-[95vw] mx-auto px-4 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-white/20 rounded-2xl">
                <Zap size={36} />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Fault Level Assessment</h1>
                <p className="text-blue-100">Analyse automatique IEC 60909-0 de tous les tableaux</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={loadAllData}
                disabled={loading}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl flex items-center gap-2"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                Actualiser
              </button>
              <button
                onClick={exportPDF}
                className="px-4 py-2 bg-white text-blue-600 rounded-xl font-medium flex items-center gap-2"
              >
                <Download size={18} />
                Export PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[95vw] mx-auto px-4 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-slideUp">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-500">Tableaux analysés</div>
          </div>
          <div className="bg-green-50 rounded-xl p-4 shadow-sm border border-green-200">
            <div className="text-3xl font-bold text-green-600">{stats.ok}</div>
            <div className="text-sm text-green-700">Conformes</div>
          </div>
          <div className="bg-red-50 rounded-xl p-4 shadow-sm border border-red-200">
            <div className="text-3xl font-bold text-red-600">{stats.danger}</div>
            <div className="text-sm text-red-700">Sous-dimensionnés</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 shadow-sm border">
            <div className="text-3xl font-bold text-gray-400">{stats.empty}</div>
            <div className="text-sm text-gray-500">Sans disjoncteurs</div>
          </div>
        </div>

        {/* Filters & Settings */}
        <div className="bg-white rounded-xl p-4 shadow-sm border mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher un tableau..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="all">Tous les statuts</option>
              <option value="ok">Conformes</option>
              <option value="danger">Sous-dimensionnés</option>
              <option value="empty">Sans devices</option>
            </select>
            <details className="relative">
              <summary className="px-4 py-2 border rounded-lg cursor-pointer flex items-center gap-2 hover:bg-gray-50">
                <Settings size={18} />
                Paramètres réseau
              </summary>
              <div className="absolute right-0 mt-2 p-4 bg-white rounded-xl shadow-xl border z-10 w-72">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Pcc réseau (kA)</label>
                    <input
                      type="number"
                      value={settings.upstreamFaultKa}
                      onChange={e => setSettings(s => ({ ...s, upstreamFaultKa: Number(e.target.value) }))}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Transformateur (kVA)</label>
                    <select
                      value={settings.transformerKva}
                      onChange={e => setSettings(s => ({ ...s, transformerKva: Number(e.target.value) }))}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      {Object.keys(STANDARD_PARAMS.transformers).map(kva => (
                        <option key={kva} value={kva}>{kva} kVA</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="text-center py-12">
            <RefreshCw size={48} className="animate-spin mx-auto text-blue-500 mb-4" />
            <p className="text-gray-500">Chargement et analyse de tous les tableaux...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Global Comparison Chart */}
            {Object.keys(analyses).length > 0 && (
              <FaultCurrentComparisonChart
                switchboards={switchboards}
                devicesByBoard={devicesByBoard}
                analyses={analyses}
              />
            )}

            {/* Switchboards List */}
            {filteredBoards.map(board => (
              <SwitchboardCard
                key={board.id}
                board={board}
                devices={devicesByBoard[board.id] || []}
                analysis={analyses[board.id]}
                expanded={expandedBoards.has(board.id)}
                onToggle={() => {
                  setExpandedBoards(prev => {
                    const next = new Set(prev);
                    if (next.has(board.id)) next.delete(board.id);
                    else next.add(board.id);
                    return next;
                  });
                }}
              />
            ))}

            {filteredBoards.length === 0 && (
              <div className="text-center py-12 bg-white rounded-xl">
                <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">Aucun tableau trouvé</p>
              </div>
            )}
          </div>
        )}

        {/* Footer Info */}
        <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-200">
          <div className="flex items-start gap-3">
            <Info size={20} className="text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Calcul automatique selon IEC 60909-0</p>
              <p>Les valeurs sont calculées automatiquement à partir des caractéristiques des câbles et disjoncteurs.
                 Les longueurs de câble par défaut sont de {STANDARD_PARAMS.cableLengths.default}m.
                 Ajustez les paramètres réseau si nécessaire.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
