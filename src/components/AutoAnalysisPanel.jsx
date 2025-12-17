/**
 * src/components/AutoAnalysisPanel.jsx
 * Automatic Electrical Analysis Panel
 * Shows FLA, Arc Flash, and Selectivity results inline
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap, AlertTriangle, CheckCircle, XCircle, Shield, Activity,
  GitBranch, Flame, ChevronDown, ChevronRight, Info, AlertCircle,
  RefreshCw, Settings, Download, Eye, EyeOff
} from 'lucide-react';
import { runCascadeAnalysis, STANDARD_PARAMS } from '../lib/electrical-calculations.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const cardClass = "bg-white rounded-xl border shadow-sm overflow-hidden";
const badgeClass = "px-2 py-0.5 rounded-full text-xs font-semibold";

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

const StatusBadge = ({ ok, label }) => (
  <span className={`${badgeClass} ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
    {ok ? <CheckCircle size={12} className="inline mr-1" /> : <XCircle size={12} className="inline mr-1" />}
    {label}
  </span>
);

const ValueBox = ({ label, value, unit, status = null, small = false }) => (
  <div className={`p-3 bg-gray-50 rounded-lg ${small ? 'text-sm' : ''}`}>
    <div className="text-xs text-gray-500 mb-1">{label}</div>
    <div className="flex items-baseline gap-1">
      <span className={`font-bold ${status === 'danger' ? 'text-red-600' : status === 'warning' ? 'text-amber-600' : status === 'ok' ? 'text-green-600' : 'text-gray-900'}`}>
        {value}
      </span>
      {unit && <span className="text-gray-500 text-sm">{unit}</span>}
    </div>
  </div>
);

const WarningsList = ({ warnings }) => {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <div className="flex items-center gap-2 text-amber-800 font-semibold mb-2">
        <AlertTriangle size={16} />
        Alertes ({warnings.length})
      </div>
      <ul className="space-y-1 text-sm text-amber-700">
        {warnings.map((w, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-amber-500">•</span>
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// FAULT LEVEL SECTION
// ═══════════════════════════════════════════════════════════════════════════

const FaultLevelSection = ({ data, mainDeviceIcu }) => {
  if (!data) return null;

  const icuOk = !mainDeviceIcu || data.Ik_kA <= mainDeviceIcu;

  return (
    <div className={cardClass}>
      <div className={`px-4 py-3 border-b flex items-center justify-between ${icuOk ? 'bg-blue-50' : 'bg-red-50'}`}>
        <div className="flex items-center gap-2 font-semibold text-gray-800">
          <Zap size={18} className={icuOk ? 'text-blue-600' : 'text-red-600'} />
          Fault Level Assessment
        </div>
        <StatusBadge ok={icuOk} label={icuOk ? 'OK' : 'DANGER'} />
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ValueBox label='Ik" (Initial)' value={data.Ik_kA.toFixed(2)} unit="kA" status={icuOk ? 'ok' : 'danger'} />
          <ValueBox label="Ip (Crête)" value={data.Ip_kA.toFixed(2)} unit="kA" />
          <ValueBox label="Ib (Coupure)" value={data.Ib_kA.toFixed(2)} unit="kA" />
          <ValueBox label="Ith (1s)" value={data.Ith_kA.toFixed(2)} unit="kA" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <ValueBox label="R/X" value={data.RX_ratio} small />
          <ValueBox label="κ" value={data.kappa} small />
          <ValueBox label="Z total" value={data.Ztotal_mohm.toFixed(2)} unit="mΩ" small />
        </div>
        {mainDeviceIcu && (
          <div className="mt-3 text-sm">
            <span className="text-gray-500">Icu disjoncteur: </span>
            <span className={`font-semibold ${icuOk ? 'text-green-600' : 'text-red-600'}`}>
              {mainDeviceIcu} kA
            </span>
            {!icuOk && <span className="text-red-600 ml-2">⚠️ Sous-dimensionné!</span>}
          </div>
        )}
        <div className="mt-2 text-xs text-gray-400">
          Calculé selon {data.standard}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// ARC FLASH SECTION
// ═══════════════════════════════════════════════════════════════════════════

const PPE_COLORS = {
  0: 'bg-green-500', 1: 'bg-blue-500', 2: 'bg-yellow-500',
  3: 'bg-orange-500', 4: 'bg-red-500', 5: 'bg-red-900',
};

const ArcFlashSection = ({ data }) => {
  if (!data) return null;

  const isDanger = data.ppe_category >= 3;
  const isExtreme = data.ppe_category >= 5;

  return (
    <div className={cardClass}>
      <div className={`px-4 py-3 border-b flex items-center justify-between ${isExtreme ? 'bg-red-100' : isDanger ? 'bg-orange-50' : 'bg-amber-50'}`}>
        <div className="flex items-center gap-2 font-semibold text-gray-800">
          <Flame size={18} className={isExtreme ? 'text-red-700' : isDanger ? 'text-orange-600' : 'text-amber-600'} />
          Arc Flash Analysis
        </div>
        <span className={`${badgeClass} text-white ${PPE_COLORS[data.ppe_category] || 'bg-gray-500'}`}>
          {data.ppe_name}
        </span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ValueBox
            label="Énergie incidente"
            value={data.incident_energy_cal}
            unit="cal/cm²"
            status={isExtreme ? 'danger' : isDanger ? 'warning' : 'ok'}
          />
          <ValueBox label="Arc Flash Boundary" value={data.arc_flash_boundary_mm} unit="mm" />
          <ValueBox label="Courant d'arc" value={data.arc_current_ka} unit="kA" />
          <ValueBox label="Durée arc" value={data.arc_duration_ms} unit="ms" />
        </div>

        {/* Mini Arc Flash Label */}
        <div className={`mt-4 p-3 rounded-lg border-2 ${isExtreme ? 'border-red-600 bg-red-50' : isDanger ? 'border-orange-500 bg-orange-50' : 'border-amber-400 bg-amber-50'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-lg font-bold ${isExtreme ? 'text-red-700' : isDanger ? 'text-orange-700' : 'text-amber-700'}`}>
                {isExtreme ? '⚠️ DANGER EXTRÊME' : isDanger ? '⚠️ DANGER' : '⚡ WARNING'}
              </div>
              <div className="text-sm text-gray-600">Arc Flash Hazard</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900">{data.incident_energy_cal}</div>
              <div className="text-xs text-gray-500">cal/cm²</div>
            </div>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-400">
          Calculé selon {data.standard} | Distance: {data.working_distance_mm}mm
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// SELECTIVITY SECTION
// ═══════════════════════════════════════════════════════════════════════════

const SelectivitySection = ({ data }) => {
  const [expanded, setExpanded] = useState(false);

  if (!data || data.length === 0) return null;

  const allSelective = data.every(s => s.isSelective);
  const hasIssues = data.some(s => !s.isSelective);

  return (
    <div className={cardClass}>
      <div
        className={`px-4 py-3 border-b flex items-center justify-between cursor-pointer ${allSelective ? 'bg-emerald-50' : 'bg-amber-50'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 font-semibold text-gray-800">
          <GitBranch size={18} className={allSelective ? 'text-emerald-600' : 'text-amber-600'} />
          Selectivity Analysis ({data.length} paires)
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge ok={allSelective} label={allSelective ? 'SÉLECTIF' : 'ATTENTION'} />
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          {data.map((sel, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border ${sel.isSelective ? 'bg-emerald-50 border-emerald-200' : sel.isPartiallySelective ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">{sel.upstream.name}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-semibold">{sel.downstream.name}</span>
                </div>
                <span className={`${badgeClass} ${sel.isSelective ? 'bg-emerald-100 text-emerald-700' : sel.isPartiallySelective ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {sel.isSelective ? '✓ Sélectif' : sel.isPartiallySelective ? `Partiel (${sel.limitCurrent?.toFixed(0)}A)` : '✗ Non sélectif'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div>Amont: {sel.upstream.in_amps}A</div>
                <div>Aval: {sel.downstream.in_amps}A</div>
              </div>
            </div>
          ))}
          <div className="text-xs text-gray-400">
            Analyse selon IEC 60947-2
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE ANALYSIS SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

const DeviceAnalysisSummary = ({ data }) => {
  const [expanded, setExpanded] = useState(false);

  if (!data || data.length === 0) return null;

  const allOk = data.every(d => d.icuOk);
  const issues = data.filter(d => !d.icuOk);

  return (
    <div className={cardClass}>
      <div
        className={`px-4 py-3 border-b flex items-center justify-between cursor-pointer ${allOk ? 'bg-green-50' : 'bg-red-50'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 font-semibold text-gray-800">
          <Activity size={18} className={allOk ? 'text-green-600' : 'text-red-600'} />
          Analyse par device ({data.length})
        </div>
        <div className="flex items-center gap-2">
          {issues.length > 0 && (
            <span className={`${badgeClass} bg-red-100 text-red-700`}>
              {issues.length} problème(s)
            </span>
          )}
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </div>

      {expanded && (
        <div className="p-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-left">Device</th>
                <th className="px-2 py-2 text-right">In</th>
                <th className="px-2 py-2 text-right">Ik"</th>
                <th className="px-2 py-2 text-right">Icu</th>
                <th className="px-2 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, idx) => (
                <tr key={idx} className={`border-t ${d.icuOk ? '' : 'bg-red-50'}`}>
                  <td className="px-2 py-2 font-medium">{d.device.name || d.device.reference}</td>
                  <td className="px-2 py-2 text-right">{d.device.in_amps}A</td>
                  <td className="px-2 py-2 text-right">{d.faultLevel.Ik_kA.toFixed(2)} kA</td>
                  <td className="px-2 py-2 text-right">{d.device.icu_ka || '-'} kA</td>
                  <td className="px-2 py-2 text-center">
                    {d.icuOk ? (
                      <CheckCircle size={16} className="inline text-green-500" />
                    ) : (
                      <XCircle size={16} className="inline text-red-500" />
                    )}
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

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════════════════

const SettingsPanel = ({ settings, onChange }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cardClass}>
      <div
        className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 font-semibold text-gray-700">
          <Settings size={18} className="text-gray-500" />
          Paramètres réseau
        </div>
        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Puissance de court-circuit réseau (kA)
              </label>
              <input
                type="number"
                value={settings.upstreamFaultKa}
                onChange={e => onChange({ ...settings, upstreamFaultKa: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transformateur (kVA)
              </label>
              <select
                value={settings.transformerKva || ''}
                onChange={e => onChange({ ...settings, transformerKva: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Sans transfo (réseau direct)</option>
                {Object.keys(STANDARD_PARAMS.transformers).map(kva => (
                  <option key={kva} value={kva}>{kva} kVA</option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Ces paramètres sont utilisés pour calculer le courant de court-circuit à l'entrée du tableau.
            Valeurs par défaut: 50 kA (réseau MT), impédances transformateur selon IEC 60076.
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function AutoAnalysisPanel({ switchboard, devices, onClose }) {
  const [settings, setSettings] = useState({
    upstreamFaultKa: 50,
    transformerKva: switchboard?.is_principal ? 630 : null,
  });
  const [isVisible, setIsVisible] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);

  // Auto-calculate when switchboard or devices change
  const analysis = useMemo(() => {
    if (!switchboard || !devices || devices.length === 0) return null;

    setIsCalculating(true);
    try {
      const result = runCascadeAnalysis(
        switchboard,
        devices,
        settings.upstreamFaultKa,
        settings.transformerKva
      );
      return result;
    } catch (err) {
      console.error('Analysis failed:', err);
      return { warnings: [`Erreur de calcul: ${err.message}`] };
    } finally {
      setIsCalculating(false);
    }
  }, [switchboard, devices, settings.upstreamFaultKa, settings.transformerKva]);

  // Get main device for Icu comparison
  const mainDevice = useMemo(() => {
    return devices?.find(d => d.is_main_incoming) || devices?.[0];
  }, [devices]);

  // Export PDF
  const exportPDF = () => {
    if (!analysis) return;

    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Header
    pdf.setFillColor(30, 58, 138);
    pdf.rect(0, 0, pageWidth, 35, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('ANALYSE ÉLECTRIQUE AUTOMATIQUE', 14, 20);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Tableau: ${switchboard.name} (${switchboard.code})`, 14, 30);

    let y = 45;

    // Warnings
    if (analysis.warnings?.length > 0) {
      pdf.setFillColor(254, 243, 199);
      pdf.rect(10, y, pageWidth - 20, 8 + analysis.warnings.length * 6, 'F');
      pdf.setTextColor(180, 83, 9);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('ALERTES:', 14, y + 6);
      pdf.setFont('helvetica', 'normal');
      analysis.warnings.forEach((w, i) => {
        pdf.text(`• ${w}`, 14, y + 12 + i * 6);
      });
      y += 15 + analysis.warnings.length * 6;
    }

    // FLA
    if (analysis.faultLevel) {
      pdf.setTextColor(0);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('FAULT LEVEL ASSESSMENT (IEC 60909)', 14, y);
      y += 8;

      pdf.autoTable({
        startY: y,
        head: [['Paramètre', 'Valeur', 'Unité']],
        body: [
          ['Ik" (Initial)', analysis.faultLevel.Ik_kA.toFixed(2), 'kA'],
          ['Ip (Crête)', analysis.faultLevel.Ip_kA.toFixed(2), 'kA'],
          ['Ib (Coupure)', analysis.faultLevel.Ib_kA.toFixed(2), 'kA'],
          ['Ith (1s)', analysis.faultLevel.Ith_kA.toFixed(2), 'kA'],
          ['R/X', analysis.faultLevel.RX_ratio, '-'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [59, 130, 246] },
      });
      y = pdf.lastAutoTable.finalY + 10;
    }

    // Arc Flash
    if (analysis.arcFlash) {
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('ARC FLASH ANALYSIS (IEEE 1584)', 14, y);
      y += 8;

      pdf.autoTable({
        startY: y,
        head: [['Paramètre', 'Valeur', 'Unité']],
        body: [
          ['Énergie incidente', analysis.arcFlash.incident_energy_cal, 'cal/cm²'],
          ['Catégorie PPE', analysis.arcFlash.ppe_name, '-'],
          ['Arc Flash Boundary', analysis.arcFlash.arc_flash_boundary_mm, 'mm'],
          ['Courant d\'arc', analysis.arcFlash.arc_current_ka, 'kA'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [245, 158, 11] },
      });
      y = pdf.lastAutoTable.finalY + 10;
    }

    // Selectivity
    if (analysis.selectivity?.length > 0) {
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('SELECTIVITY ANALYSIS (IEC 60947-2)', 14, y);
      y += 8;

      pdf.autoTable({
        startY: y,
        head: [['Amont', 'Aval', 'Status', 'Limite']],
        body: analysis.selectivity.map(s => [
          `${s.upstream.name} (${s.upstream.in_amps}A)`,
          `${s.downstream.name} (${s.downstream.in_amps}A)`,
          s.isSelective ? 'Sélectif' : s.isPartiallySelective ? 'Partiel' : 'Non sélectif',
          s.limitCurrent ? `${s.limitCurrent.toFixed(0)} A` : '-',
        ]),
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129] },
      });
    }

    // Footer
    pdf.setFontSize(8);
    pdf.setTextColor(128);
    pdf.text(`Généré le ${new Date().toLocaleString()} | ElectroHub Auto-Analysis`, 14, 285);

    pdf.save(`analyse_${switchboard.code}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (!switchboard || !devices || devices.length === 0) {
    return (
      <div className="p-4 bg-gray-50 rounded-xl text-center text-gray-500">
        <Info size={24} className="mx-auto mb-2 text-gray-400" />
        <p>Sélectionnez un tableau avec des disjoncteurs pour voir l'analyse automatique.</p>
      </div>
    );
  }

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="w-full p-3 bg-blue-50 hover:bg-blue-100 rounded-xl text-blue-700 font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <Eye size={18} />
        Afficher l'analyse automatique
      </button>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white">
            <Zap size={20} />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Analyse Automatique</h3>
            <p className="text-xs text-gray-500">{switchboard.name} - {devices.length} device(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCalculating && <RefreshCw size={16} className="animate-spin text-blue-500" />}
          <button
            onClick={exportPDF}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Exporter PDF"
          >
            <Download size={18} className="text-gray-600" />
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Masquer"
          >
            <EyeOff size={18} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* Settings */}
      <SettingsPanel settings={settings} onChange={setSettings} />

      {/* Warnings */}
      <WarningsList warnings={analysis?.warnings} />

      {/* Results */}
      {analysis && (
        <>
          <FaultLevelSection data={analysis.faultLevel} mainDeviceIcu={mainDevice?.icu_ka} />
          <ArcFlashSection data={analysis.arcFlash} />
          <SelectivitySection data={analysis.selectivity} />
          <DeviceAnalysisSummary data={analysis.deviceAnalysis} />
        </>
      )}

      {/* Timestamp */}
      <div className="text-xs text-gray-400 text-right">
        Dernière analyse: {analysis?.timestamp ? new Date(analysis.timestamp).toLocaleString() : '-'}
      </div>
    </div>
  );
}
