// src/pages/Arc_flash.jsx - Full Auto IEEE 1584 Arc Flash Analysis
import React, { useState, useEffect, useMemo } from 'react';
import {
  Flame, AlertTriangle, CheckCircle, XCircle, Building2, ChevronDown, ChevronRight,
  Settings, Download, RefreshCw, Shield, Info, Search, Eye, Zap
} from 'lucide-react';
import { get } from '../lib/api.js';
import { calculateArcFlash, calculateFaultLevel, STANDARD_PARAMS, getCableSection, getTripTime } from '../lib/electrical-calculations.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const PPE_COLORS = {
  0: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', fill: 'bg-green-500' },
  1: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300', fill: 'bg-blue-500' },
  2: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300', fill: 'bg-yellow-500' },
  3: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', fill: 'bg-orange-500' },
  4: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', fill: 'bg-red-500' },
  5: { bg: 'bg-red-200', text: 'text-red-900', border: 'border-red-500', fill: 'bg-red-900' },
};

const PPE_REQUIREMENTS = {
  0: { clothing: 'Vêtements non-fondants', gloves: 'Non requis', face: 'Lunettes de sécurité' },
  1: { clothing: 'Chemise FR + Pantalon FR', gloves: 'Cuir', face: 'Écran facial classe 1' },
  2: { clothing: 'Combinaison FR 8 cal/cm²', gloves: 'Cuir + sous-gants', face: 'Écran facial classe 2' },
  3: { clothing: 'Combinaison FR 25 cal/cm²', gloves: 'Gants isolants classe 0', face: 'Cagoule FR + écran' },
  4: { clothing: 'Combinaison FR 40 cal/cm²', gloves: 'Gants isolants classe 00', face: 'Cagoule FR + écran' },
  5: { clothing: 'TRAVAIL INTERDIT', gloves: 'TRAVAIL INTERDIT', face: 'TRAVAIL INTERDIT' },
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

const ArcFlashLabel = ({ analysis, boardName }) => {
  if (!analysis) return null;

  const colors = PPE_COLORS[analysis.ppe_category] || PPE_COLORS[5];
  const ppe = PPE_REQUIREMENTS[analysis.ppe_category] || PPE_REQUIREMENTS[5];
  const isDanger = analysis.ppe_category >= 3;
  const isExtreme = analysis.ppe_category >= 5;

  return (
    <div className={`rounded-xl border-4 ${colors.border} overflow-hidden shadow-lg max-w-md`}>
      {/* Header */}
      <div className={`p-4 ${isExtreme ? 'bg-red-700' : isDanger ? 'bg-red-600' : 'bg-amber-500'} text-white text-center`}>
        <div className="flex items-center justify-center gap-2 mb-1">
          <AlertTriangle size={24} />
          <span className="text-xl font-bold">
            {isExtreme ? 'DANGER EXTRÊME' : isDanger ? 'DANGER' : 'WARNING'}
          </span>
          <AlertTriangle size={24} />
        </div>
        <div className="text-sm opacity-90">Arc Flash Hazard</div>
      </div>

      {/* Energy & PPE */}
      <div className="grid grid-cols-2 divide-x">
        <div className="p-4 text-center bg-white">
          <div className="text-xs text-gray-500 mb-1">Énergie Incidente</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{analysis.incident_energy_cal}</div>
          <div className="text-sm text-gray-600">cal/cm²</div>
        </div>
        <div className={`p-4 text-center ${colors.bg}`}>
          <div className="text-xs text-gray-600 mb-1">Catégorie PPE</div>
          <div className={`text-3xl font-bold ${colors.text}`}>{analysis.ppe_category}</div>
          <div className={`text-sm ${colors.text}`}>{analysis.ppe_name}</div>
        </div>
      </div>

      {/* Arc Flash Boundary */}
      <div className="p-3 bg-gray-100 text-center border-t">
        <span className="text-sm text-gray-600">Arc Flash Boundary: </span>
        <span className="font-bold text-gray-900">{analysis.arc_flash_boundary_mm} mm</span>
      </div>

      {/* PPE Requirements */}
      <div className="p-4 bg-white border-t">
        <div className="text-xs font-semibold text-gray-500 mb-2">ÉQUIPEMENT REQUIS:</div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Vêtements:</span>
            <span className="font-medium text-gray-900">{ppe.clothing}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Gants:</span>
            <span className="font-medium text-gray-900">{ppe.gloves}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Protection faciale:</span>
            <span className="font-medium text-gray-900">{ppe.face}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-2 bg-gray-50 border-t text-center">
        <div className="text-xs text-gray-500">{boardName}</div>
        <div className="text-xs text-gray-400">IEEE 1584-2018 | NFPA 70E</div>
      </div>
    </div>
  );
};

const SwitchboardCard = ({ board, devices, faultLevel, arcFlash, expanded, onToggle }) => {
  const hasDevices = devices.length > 0;
  const colors = arcFlash ? (PPE_COLORS[arcFlash.ppe_category] || PPE_COLORS[5]) : null;
  const isDanger = arcFlash?.ppe_category >= 3;

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${isDanger ? 'ring-2 ring-red-400' : ''}`}>
      {/* Header */}
      <div
        className={`px-4 py-3 cursor-pointer flex items-center justify-between ${
          isDanger ? 'bg-red-50' : hasDevices ? 'bg-amber-50' : 'bg-gray-50'
        }`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isDanger ? 'bg-red-100' : 'bg-amber-100'}`}>
            <Flame size={20} className={isDanger ? 'text-red-600' : 'text-amber-600'} />
          </div>
          <div>
            <div className="font-semibold text-gray-900">{board.name}</div>
            <div className="text-sm text-gray-500">{board.code} • {devices.length} device(s)</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {arcFlash && (
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${colors.bg} ${colors.text}`}>
              PPE Cat. {arcFlash.ppe_category} • {arcFlash.incident_energy_cal} cal/cm²
            </span>
          )}
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="p-4 border-t">
          {!hasDevices ? (
            <div className="text-center text-gray-500 py-8">
              <Flame size={32} className="mx-auto mb-2 text-gray-300" />
              <p>Aucun disjoncteur dans ce tableau</p>
            </div>
          ) : arcFlash ? (
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Arc Flash Label */}
              <ArcFlashLabel analysis={arcFlash} boardName={`${board.name} (${board.code})`} />

              {/* Details */}
              <div className="space-y-4">
                {/* Calculation Inputs */}
                <div className="p-4 bg-gray-50 rounded-xl">
                  <h4 className="font-semibold text-gray-700 mb-3">Paramètres de calcul</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Tension:</span>
                      <span className="ml-2 font-medium">{arcFlash.voltage_v} V</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Courant de défaut:</span>
                      <span className="ml-2 font-medium">{arcFlash.bolted_fault_ka} kA</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Courant d'arc:</span>
                      <span className="ml-2 font-medium">{arcFlash.arc_current_ka} kA</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Durée d'arc:</span>
                      <span className="ml-2 font-medium">{arcFlash.arc_duration_ms} ms</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Distance de travail:</span>
                      <span className="ml-2 font-medium">{arcFlash.working_distance_mm} mm</span>
                    </div>
                  </div>
                </div>

                {/* Fault Level Info */}
                {faultLevel && (
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                    <h4 className="font-semibold text-blue-700 mb-2 flex items-center gap-2">
                      <Zap size={16} />
                      Courant de court-circuit
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600">Ik":</span>
                        <span className="ml-2 font-bold text-blue-700">{faultLevel.Ik_kA.toFixed(2)} kA</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Ip:</span>
                        <span className="ml-2 font-medium">{faultLevel.Ip_kA.toFixed(2)} kA</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Main Device Info */}
                {devices[0] && (
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <h4 className="font-semibold text-gray-700 mb-2">Disjoncteur principal</h4>
                    <div className="text-sm">
                      <p className="font-medium">{devices[0].name || devices[0].reference}</p>
                      <p className="text-gray-500">{devices[0].manufacturer} • {devices[0].in_amps}A • Icu: {devices[0].icu_ka || '?'}kA</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <RefreshCw size={24} className="animate-spin mx-auto text-amber-500" />
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

export default function ArcFlash() {
  const [switchboards, setSwitchboards] = useState([]);
  const [devicesByBoard, setDevicesByBoard] = useState({});
  const [faultLevels, setFaultLevels] = useState({});
  const [arcFlashResults, setArcFlashResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedBoards, setExpandedBoards] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPPE, setFilterPPE] = useState('all');

  const [settings, setSettings] = useState({
    upstreamFaultKa: 50,
    transformerKva: 630,
    workingDistance: 455,
  });

  // Load all data on mount
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
      const boardsResp = await get('/api/switchboard/boards', { pageSize: 500 });
      const boards = boardsResp?.data || [];
      setSwitchboards(boards);

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

      // Auto-expand boards with high PPE
      const expanded = new Set();
      boards.forEach(b => {
        if (devicesMap[b.id]?.length > 0) expanded.add(b.id);
      });
      setExpandedBoards(expanded);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const runAllAnalyses = () => {
    const newFaultLevels = {};
    const newArcFlash = {};
    let faultLevelMap = new Map();

    const sortedBoards = [...switchboards].sort((a, b) => {
      if (a.is_principal && !b.is_principal) return -1;
      if (!a.is_principal && b.is_principal) return 1;
      return 0;
    });

    for (const board of sortedBoards) {
      const devices = devicesByBoard[board.id] || [];
      if (devices.length === 0) continue;

      const mainDevice = devices.find(d => d.is_main_incoming) || devices[0];

      // Determine upstream fault level
      let upstreamFaultKa = settings.upstreamFaultKa;
      for (const [boardId, boardDevices] of Object.entries(devicesByBoard)) {
        const feedingDevice = boardDevices.find(d => d.downstream_switchboard_id === board.id);
        if (feedingDevice && faultLevelMap.has(Number(boardId))) {
          upstreamFaultKa = faultLevelMap.get(Number(boardId)).Ik_kA;
          break;
        }
      }

      // Calculate fault level
      const fla = calculateFaultLevel({
        voltage_v: board.voltage_v || mainDevice?.voltage_v || 400,
        source_fault_ka: upstreamFaultKa,
        cable_length_m: mainDevice?.cable_length_m || STANDARD_PARAMS.cableLengths.default,
        cable_section_mm2: mainDevice?.cable_section_mm2 || getCableSection(mainDevice?.in_amps || 100),
        transformer_kva: board.is_principal ? settings.transformerKva : null,
        transformer_ukr: board.is_principal ? STANDARD_PARAMS.transformers[settings.transformerKva] : null,
      });
      newFaultLevels[board.id] = fla;
      faultLevelMap.set(board.id, fla);

      // Calculate arc flash
      const tripTime = getTripTime(mainDevice);
      const af = calculateArcFlash({
        voltage_v: board.voltage_v || mainDevice?.voltage_v || 400,
        bolted_fault_ka: fla.Ik_kA,
        arc_duration_s: tripTime,
        working_distance_mm: settings.workingDistance,
        electrode_gap_mm: STANDARD_PARAMS.electrodeGaps[board.voltage_v || 400] || 32,
        electrode_config: STANDARD_PARAMS.electrodeConfigs[board.type || 'Panel'] || 'VCB',
      });
      newArcFlash[board.id] = af;
    }

    setFaultLevels(newFaultLevels);
    setArcFlashResults(newArcFlash);
  };

  // Filter boards
  const filteredBoards = useMemo(() => {
    return switchboards.filter(board => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!board.name.toLowerCase().includes(query) && !board.code?.toLowerCase().includes(query)) {
          return false;
        }
      }

      if (filterPPE !== 'all') {
        const af = arcFlashResults[board.id];
        if (filterPPE === 'high' && (!af || af.ppe_category < 3)) return false;
        if (filterPPE === 'low' && af && af.ppe_category >= 3) return false;
        if (filterPPE === 'empty' && (devicesByBoard[board.id]?.length || 0) > 0) return false;
      }

      return true;
    });
  }, [switchboards, arcFlashResults, devicesByBoard, searchQuery, filterPPE]);

  // Stats
  const stats = useMemo(() => {
    const byPPE = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let empty = 0;

    switchboards.forEach(board => {
      const devices = devicesByBoard[board.id] || [];
      if (devices.length === 0) { empty++; return; }
      const af = arcFlashResults[board.id];
      if (af) byPPE[af.ppe_category]++;
    });

    return { byPPE, empty, total: switchboards.length - empty };
  }, [switchboards, devicesByBoard, arcFlashResults]);

  // Export PDF with all labels
  const exportPDF = () => {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Header
    pdf.setFillColor(220, 38, 38);
    pdf.rect(0, 0, pageWidth, 40, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('ARC FLASH ANALYSIS', 14, 20);
    pdf.setFontSize(10);
    pdf.text(`IEEE 1584-2018 - ${new Date().toLocaleDateString()}`, 14, 32);

    let y = 50;
    pdf.setTextColor(0);
    pdf.setFontSize(12);
    pdf.text(`Tableaux analysés: ${stats.total} | PPE ≥3: ${stats.byPPE[3] + stats.byPPE[4] + stats.byPPE[5]}`, 14, y);
    y += 15;

    // Summary table
    const tableData = [];
    filteredBoards.forEach(board => {
      const devices = devicesByBoard[board.id] || [];
      const af = arcFlashResults[board.id];
      if (!af) return;

      tableData.push([
        board.name,
        board.code || '-',
        af.incident_energy_cal,
        af.ppe_category,
        af.ppe_name,
        af.arc_flash_boundary_mm,
        af.arc_duration_ms
      ]);
    });

    pdf.autoTable({
      startY: y,
      head: [['Tableau', 'Code', 'cal/cm²', 'PPE', 'Catégorie', 'AFB (mm)', 't (ms)']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [220, 38, 38] },
      didParseCell: (data) => {
        if (data.column.index === 3 && data.section === 'body') {
          const cat = parseInt(data.cell.text[0]);
          if (cat >= 4) data.cell.styles.textColor = [127, 29, 29];
          else if (cat >= 3) data.cell.styles.textColor = [220, 38, 38];
          else if (cat >= 2) data.cell.styles.textColor = [245, 158, 11];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    pdf.save(`ArcFlash_report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <section className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-red-50">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        .animate-pulse-danger { animation: pulse 1s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white">
        <div className="max-w-[95vw] mx-auto px-4 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-white/20 rounded-2xl">
                <Flame size={36} />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Arc Flash Analysis</h1>
                <p className="text-amber-100">Analyse automatique IEEE 1584-2018 de tous les tableaux</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={loadAllData} disabled={loading} className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl flex items-center gap-2">
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                Actualiser
              </button>
              <button onClick={exportPDF} className="px-4 py-2 bg-white text-orange-600 rounded-xl font-medium flex items-center gap-2">
                <Download size={18} />
                Export PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[95vw] mx-auto px-4 py-6">
        {/* Stats - PPE Distribution */}
        <div className="grid grid-cols-3 md:grid-cols-7 gap-3 mb-6 animate-slideUp">
          {[0, 1, 2, 3, 4, 5].map(cat => {
            const colors = PPE_COLORS[cat];
            return (
              <div key={cat} className={`${colors.bg} rounded-xl p-3 text-center border ${colors.border}`}>
                <div className={`text-2xl font-bold ${colors.text}`}>{stats.byPPE[cat]}</div>
                <div className={`text-xs ${colors.text}`}>PPE {cat}</div>
              </div>
            );
          })}
          <div className="bg-gray-100 rounded-xl p-3 text-center border">
            <div className="text-2xl font-bold text-gray-400">{stats.empty}</div>
            <div className="text-xs text-gray-500">Vides</div>
          </div>
        </div>

        {/* Filters */}
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
            <select value={filterPPE} onChange={e => setFilterPPE(e.target.value)} className="px-4 py-2 border rounded-lg">
              <option value="all">Toutes catégories</option>
              <option value="high">PPE ≥ 3 (Danger)</option>
              <option value="low">PPE &lt; 3</option>
              <option value="empty">Sans devices</option>
            </select>
            <details className="relative">
              <summary className="px-4 py-2 border rounded-lg cursor-pointer flex items-center gap-2 hover:bg-gray-50">
                <Settings size={18} />
                Paramètres
              </summary>
              <div className="absolute right-0 mt-2 p-4 bg-white rounded-xl shadow-xl border z-10 w-72">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Pcc réseau (kA)</label>
                    <input type="number" value={settings.upstreamFaultKa} onChange={e => setSettings(s => ({ ...s, upstreamFaultKa: Number(e.target.value) }))} className="w-full px-3 py-2 border rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Distance de travail (mm)</label>
                    <input type="number" value={settings.workingDistance} onChange={e => setSettings(s => ({ ...s, workingDistance: Number(e.target.value) }))} className="w-full px-3 py-2 border rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Transformateur (kVA)</label>
                    <select value={settings.transformerKva} onChange={e => setSettings(s => ({ ...s, transformerKva: Number(e.target.value) }))} className="w-full px-3 py-2 border rounded-lg">
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
            <RefreshCw size={48} className="animate-spin mx-auto text-orange-500 mb-4" />
            <p className="text-gray-500">Chargement et analyse de tous les tableaux...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBoards.map(board => (
              <SwitchboardCard
                key={board.id}
                board={board}
                devices={devicesByBoard[board.id] || []}
                faultLevel={faultLevels[board.id]}
                arcFlash={arcFlashResults[board.id]}
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

        {/* Info */}
        <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
          <div className="flex items-start gap-3">
            <Info size={20} className="text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium mb-1">Calcul automatique selon IEEE 1584-2018 & NFPA 70E</p>
              <p>L'énergie incidente et les catégories PPE sont calculées automatiquement.
                 Le temps d'arc est estimé à partir du type de disjoncteur.
                 Distance de travail par défaut: {settings.workingDistance}mm.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
