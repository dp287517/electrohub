// src/pages/Fault_level_assessment.jsx - Professional IEC 60909 Fault Level Assessment
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Zap, Plus, Search, ChevronRight, ChevronDown, Building2,
  Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Settings, Info, Download, RefreshCw, Eye, AlertCircle,
  FileText, Share2, Activity, Target, Gauge, TrendingUp,
  Shield, Clock, Calculator, BarChart3, PieChart, Layers,
  ArrowRight, Play, Check, XCircle, HelpCircle, Book, Cpu,
  ChevronLeft, Filter, RotateCcw
} from 'lucide-react';
import { api, get, post } from '../lib/api.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler, LogarithmicScale
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import Annotation from 'chartjs-plugin-annotation';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, LogarithmicScale, Annotation);

// ==================== IEC 60909 CALCULATIONS ====================

/**
 * IEC 60909-0 Short-Circuit Current Calculation
 * Ik" = c * Un / (sqrt(3) * |Zk|)
 */

const IEC_VOLTAGE_FACTORS = {
  LV: { cmax: 1.05, cmin: 0.95 },
  MV: { cmax: 1.10, cmin: 1.00 },
  HV: { cmax: 1.10, cmin: 1.00 }
};

const CABLE_RESISTIVITY = { copper: 0.0178, aluminum: 0.0287 };
const CABLE_REACTANCE = { single_core: 0.08, multi_core: 0.07, busbar: 0.05 };

function calculateFaultCurrent(params) {
  const {
    voltage_v = 400, source_impedance_mohm = 10, cable_length_m = 50,
    cable_section_mm2 = 95, cable_material = 'copper', cable_type = 'multi_core',
    transformer_power_kva = 630, transformer_ukr_percent = 6, phase_type = 'three'
  } = params;

  const voltageLevel = voltage_v < 1000 ? 'LV' : voltage_v < 35000 ? 'MV' : 'HV';
  const c = IEC_VOLTAGE_FACTORS[voltageLevel].cmax;
  const Zs = source_impedance_mohm / 1000;

  let Zt = 0;
  if (transformer_power_kva > 0) {
    Zt = (transformer_ukr_percent / 100) * (Math.pow(voltage_v, 2) / (transformer_power_kva * 1000));
  }

  const rho = CABLE_RESISTIVITY[cable_material] || 0.0178;
  const Rc = (rho * cable_length_m) / cable_section_mm2;
  const Xc = (CABLE_REACTANCE[cable_type] || 0.07) * (cable_length_m / 1000);
  const Ztotal = Math.sqrt(Math.pow(Zs + Rc, 2) + Math.pow(Xc, 2)) + Zt;

  let Ik;
  if (phase_type === 'three') {
    Ik = (c * voltage_v) / (Math.sqrt(3) * Ztotal);
  } else {
    Ik = (c * voltage_v) / (2 * Ztotal);
  }

  const RX_ratio = (Zs + Rc) / (Xc || 0.001);
  const kappa = 1.02 + 0.98 * Math.exp(-3 * RX_ratio);
  const Ip = kappa * Math.sqrt(2) * Ik;
  const Ib = Ik;
  const Ith = Ik * Math.sqrt(1);

  return {
    Ik_kA: Ik / 1000, Ip_kA: Ip / 1000, Ib_kA: Ib / 1000, Ith_kA: Ith / 1000,
    Ztotal_mohm: Ztotal * 1000, RX_ratio, kappa, voltage_factor: c
  };
}

function generateFaultCurve(params, maxLength = 200) {
  const points = [];
  for (let length = 0; length <= maxLength; length += 5) {
    const result = calculateFaultCurrent({ ...params, cable_length_m: length });
    points.push({ length, Ik_kA: result.Ik_kA, Ip_kA: result.Ip_kA });
  }
  return points;
}

// ==================== HELPERS ====================

function useUserSite() {
  try { return (JSON.parse(localStorage.getItem('eh_user') || '{}')?.site) || ''; } catch { return ''; }
}

// ==================== COMPONENTS ====================

const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div className={`animate-slideUp ${className}`} style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}>
    {children}
  </div>
);

const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const config = {
    success: { bg: 'bg-emerald-500', Icon: CheckCircle },
    error: { bg: 'bg-red-500', Icon: AlertCircle },
    info: { bg: 'bg-blue-500', Icon: Info },
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
    info: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  const sizes = { sm: 'px-2 py-0.5 text-[10px]', md: 'px-2.5 py-1 text-xs', lg: 'px-3 py-1.5 text-sm' };
  return <span className={`inline-flex items-center gap-1 rounded-full font-semibold border ${variants[variant]} ${sizes[size]} ${className}`}>{children}</span>;
};

const StatCard = ({ icon: Icon, label, value, unit, color = 'blue', description }) => (
  <div className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-lg transition-all duration-300">
    <div className="flex items-center justify-between mb-3">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br from-${color}-400 to-${color}-600 flex items-center justify-center text-white shadow-lg`}>
        <Icon size={22} />
      </div>
    </div>
    <p className="text-3xl font-bold text-gray-900 mb-1">{value} <span className="text-lg text-gray-500">{unit}</span></p>
    <p className="text-sm font-medium text-gray-700">{label}</p>
    {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
  </div>
);

const inputBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 transition-all";
const selectBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 transition-all";
const labelClass = "block text-sm font-semibold text-gray-700 mb-2";

// ==================== FAULT RESULT CARD ====================

const FaultResultCard = ({ result, params, onExportPDF }) => {
  if (!result) return null;

  const getStatus = (Ik_kA, device_Icu_kA) => {
    if (!device_Icu_kA) return { status: 'unknown', color: 'gray', text: 'À vérifier' };
    if (Ik_kA > device_Icu_kA) return { status: 'danger', color: 'red', text: 'DANGER - Ik > Icu' };
    if (Ik_kA > device_Icu_kA * 0.8) return { status: 'warning', color: 'amber', text: 'Attention - Proche limite' };
    return { status: 'safe', color: 'emerald', text: 'OK - Ik < Icu' };
  };

  const status = getStatus(result.Ik_kA, params.device_Icu_kA);

  return (
    <AnimatedCard>
      <div className={`bg-white rounded-3xl border-2 ${status.status === 'danger' ? 'border-red-400' : status.status === 'warning' ? 'border-amber-400' : 'border-gray-100'} overflow-hidden`}>
        <div className={`p-6 bg-gradient-to-r ${status.status === 'danger' ? 'from-red-500 to-rose-600' : status.status === 'warning' ? 'from-amber-500 to-orange-600' : 'from-blue-500 to-cyan-600'} text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-2xl"><Zap size={32} /></div>
              <div>
                <h3 className="text-2xl font-bold">Résultat du calcul</h3>
                <p className="text-white/80">IEC 60909-0</p>
              </div>
            </div>
            <Badge variant={status.status === 'danger' ? 'danger' : status.status === 'warning' ? 'warning' : 'success'} size="lg">
              {status.status === 'danger' ? <XCircle size={14} /> : status.status === 'warning' ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
              {status.text}
            </Badge>
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard icon={Zap} label='Ik" (Initial)' value={result.Ik_kA.toFixed(2)} unit="kA" color="blue" description="Courant de court-circuit initial" />
            <StatCard icon={TrendingUp} label="Ip (Crête)" value={result.Ip_kA.toFixed(2)} unit="kA" color="purple" description="Courant de crête" />
            <StatCard icon={Clock} label="Ib (Coupure)" value={result.Ib_kA.toFixed(2)} unit="kA" color="cyan" description="Courant de coupure" />
            <StatCard icon={Activity} label="Ith (Thermique)" value={result.Ith_kA.toFixed(2)} unit="kA" color="amber" description="Équivalent thermique 1s" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-2xl">
            <div className="text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Impédance totale</p>
              <p className="text-lg font-bold text-gray-900">{result.Ztotal_mohm.toFixed(2)} mΩ</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Rapport R/X</p>
              <p className="text-lg font-bold text-gray-900">{result.RX_ratio.toFixed(3)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Facteur κ</p>
              <p className="text-lg font-bold text-gray-900">{result.kappa.toFixed(3)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Facteur c</p>
              <p className="text-lg font-bold text-gray-900">{result.voltage_factor}</p>
            </div>
          </div>

          {params.device_Icu_kA && (
            <div className="mt-6 p-4 bg-blue-50 rounded-2xl">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Shield size={18} className="text-blue-600" />
                Vérification du dispositif de protection
              </h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-white rounded-xl">
                  <p className="text-xs text-gray-500">Ik" calculé</p>
                  <p className="text-xl font-bold text-gray-900">{result.Ik_kA.toFixed(2)} kA</p>
                </div>
                <div className="text-center p-3 bg-white rounded-xl">
                  <p className="text-xs text-gray-500">Icu dispositif</p>
                  <p className="text-xl font-bold text-gray-900">{params.device_Icu_kA} kA</p>
                </div>
                <div className="text-center p-3 bg-white rounded-xl">
                  <p className="text-xs text-gray-500">Marge</p>
                  <p className={`text-xl font-bold ${result.Ik_kA > params.device_Icu_kA ? 'text-red-600' : 'text-emerald-600'}`}>
                    {((params.device_Icu_kA - result.Ik_kA) / params.device_Icu_kA * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4 bg-gray-50 flex justify-end gap-3">
          <button onClick={onExportPDF}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-cyan-700 transition-all flex items-center gap-2 shadow-lg">
            <Download size={18} />
            Exporter PDF Professionnel
          </button>
        </div>
      </div>
    </AnimatedCard>
  );
};

// ==================== FAULT CURVE CHART ====================

const FaultCurveChart = ({ params, deviceIcu }) => {
  const curveData = useMemo(() => generateFaultCurve(params), [params]);

  const annotations = deviceIcu ? {
    icuLine: {
      type: 'line',
      yMin: deviceIcu,
      yMax: deviceIcu,
      borderColor: 'rgb(239, 68, 68)',
      borderWidth: 2,
      borderDash: [6, 6],
      label: {
        display: true,
        content: `Icu = ${deviceIcu} kA`,
        position: 'end',
        backgroundColor: 'rgb(239, 68, 68)',
        color: 'white',
        font: { weight: 'bold' }
      }
    }
  } : {};

  const chartData = {
    labels: curveData.map(p => p.length),
    datasets: [
      {
        label: 'Ik" (kA)',
        data: curveData.map(p => p.Ik_kA),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 3
      },
      {
        label: 'Ip (kA)',
        data: curveData.map(p => p.Ip_kA),
        borderColor: 'rgb(168, 85, 247)',
        backgroundColor: 'rgba(168, 85, 247, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 3
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Courbe Ik en fonction de la longueur de câble', font: { size: 16, weight: 'bold' } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} kA` } },
      annotation: { annotations }
    },
    scales: {
      x: { title: { display: true, text: 'Longueur câble (m)', font: { weight: 'bold' } } },
      y: { title: { display: true, text: 'Courant (kA)', font: { weight: 'bold' } }, beginAtZero: true }
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-lg">
      <div className="h-80">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};

// ==================== DEVICE SELECTOR ====================

const DeviceSelector = ({ onSelect, selectedDevice }) => {
  const [switchboards, setSwitchboards] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedSwitchboard, setSelectedSwitchboard] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadSwitchboards(); }, []);

  const loadSwitchboards = async () => {
    try {
      const resp = await get('/api/switchboard/boards', { pageSize: 500 });
      setSwitchboards(resp?.data || []);
    } catch (err) { console.error('Failed to load switchboards', err); }
  };

  const loadDevices = async (switchboardId) => {
    setLoading(true);
    try {
      const resp = await get(`/api/switchboard/boards/${switchboardId}/devices`);
      setDevices(resp?.data || []);
    } catch (err) { console.error('Failed to load devices', err); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Tableau électrique</label>
        <select value={selectedSwitchboard || ''} onChange={e => { setSelectedSwitchboard(e.target.value); if (e.target.value) loadDevices(e.target.value); }} className={selectBaseClass}>
          <option value="">Sélectionner un tableau...</option>
          {switchboards.map(sb => <option key={sb.id} value={sb.id}>{sb.name} ({sb.code})</option>)}
        </select>
      </div>

      {selectedSwitchboard && (
        <div>
          <label className={labelClass}>Device à analyser</label>
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 py-3"><RefreshCw size={16} className="animate-spin" />Chargement...</div>
          ) : (
            <select value={selectedDevice?.id || ''} onChange={e => { const dev = devices.find(d => d.id === Number(e.target.value)); onSelect(dev); }} className={selectBaseClass}>
              <option value="">Sélectionner un device...</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.name} - {d.reference} ({d.icu_ka || '?'} kA)</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function FaultLevelAssessment() {
  const [toast, setToast] = useState(null);
  const [result, setResult] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);

  const [params, setParams] = useState({
    voltage_v: 400, source_impedance_mohm: 10, cable_length_m: 50,
    cable_section_mm2: 95, cable_material: 'copper', cable_type: 'multi_core',
    transformer_power_kva: 630, transformer_ukr_percent: 6, phase_type: 'three',
    device_Icu_kA: null
  });

  useEffect(() => {
    if (selectedDevice) {
      setParams(p => ({
        ...p,
        device_Icu_kA: selectedDevice.icu_ka || null,
        cable_section_mm2: selectedDevice.cable_section_mm2 || p.cable_section_mm2,
        cable_length_m: selectedDevice.cable_length_m || p.cable_length_m
      }));
    }
  }, [selectedDevice]);

  const handleCalculate = () => {
    try {
      const res = calculateFaultCurrent(params);
      setResult(res);
      setToast({ type: 'success', message: 'Calcul IEC 60909 effectué avec succès !' });
    } catch (err) {
      setToast({ type: 'error', message: 'Erreur de calcul: ' + err.message });
    }
  };

  const exportPDF = () => {
    if (!result) return;

    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Header
    pdf.setFillColor(59, 130, 246);
    pdf.rect(0, 0, pageWidth, 50, 'F');
    pdf.setFillColor(6, 182, 212);
    pdf.rect(pageWidth * 0.6, 0, pageWidth * 0.4, 50, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    pdf.text('FAULT LEVEL ASSESSMENT', 14, 25);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.text('IEC 60909-0 Calculation Report', 14, 35);
    pdf.text(new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }), 14, 45);

    const status = result.Ik_kA > (params.device_Icu_kA || 999) ? 'DANGER' : 'OK';
    pdf.setFillColor(status === 'DANGER' ? 239 : 16, status === 'DANGER' ? 68 : 185, status === 'DANGER' ? 68 : 129);
    pdf.roundedRect(pageWidth - 50, 15, 40, 20, 3, 3, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(10);
    pdf.text(status, pageWidth - 40, 28);

    let y = 65;
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('RÉSULTATS DU CALCUL', 14, y);

    y += 15;
    pdf.autoTable({
      startY: y,
      head: [['Paramètre', 'Valeur', 'Unité', 'Description']],
      body: [
        ['Ik" (Initial)', result.Ik_kA.toFixed(3), 'kA', 'Courant de court-circuit initial symétrique'],
        ['Ip (Crête)', result.Ip_kA.toFixed(3), 'kA', 'Courant de crête (valeur maximale)'],
        ['Ib (Coupure)', result.Ib_kA.toFixed(3), 'kA', 'Courant de coupure'],
        ['Ith (Thermique)', result.Ith_kA.toFixed(3), 'kA', 'Courant thermique équivalent (1s)'],
        ['Ztotal', result.Ztotal_mohm.toFixed(3), 'mΩ', 'Impédance totale au point de défaut'],
        ['R/X', result.RX_ratio.toFixed(4), '-', 'Rapport résistance/réactance'],
        ['κ', result.kappa.toFixed(4), '-', 'Facteur de crête'],
        ['c', result.voltage_factor.toFixed(2), '-', 'Facteur de tension IEC']
      ],
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 255] },
      styles: { fontSize: 10, cellPadding: 5 },
      columnStyles: { 0: { fontStyle: 'bold' }, 3: { fontStyle: 'italic', textColor: [100, 100, 100] } }
    });

    y = pdf.lastAutoTable.finalY + 20;

    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text("PARAMÈTRES D'ENTRÉE", 14, y);

    y += 10;
    pdf.autoTable({
      startY: y,
      head: [['Paramètre', 'Valeur']],
      body: [
        ['Tension nominale', `${params.voltage_v} V`],
        ['Impédance source', `${params.source_impedance_mohm} mΩ`],
        ['Longueur câble', `${params.cable_length_m} m`],
        ['Section câble', `${params.cable_section_mm2} mm²`],
        ['Matériau câble', params.cable_material === 'copper' ? 'Cuivre' : 'Aluminium'],
        ['Puissance transfo', `${params.transformer_power_kva} kVA`],
        ['Ukr transfo', `${params.transformer_ukr_percent} %`],
        ['Type de phase', params.phase_type === 'three' ? 'Triphasé' : 'Monophasé']
      ],
      theme: 'grid',
      headStyles: { fillColor: [100, 100, 100] },
      styles: { fontSize: 10 }
    });

    y = pdf.lastAutoTable.finalY + 20;

    if (params.device_Icu_kA) {
      const margin = ((params.device_Icu_kA - result.Ik_kA) / params.device_Icu_kA * 100);
      const isOk = result.Ik_kA <= params.device_Icu_kA;

      pdf.setFillColor(isOk ? 240 : 254, isOk ? 253 : 242, isOk ? 244 : 242);
      pdf.rect(10, y - 5, pageWidth - 20, 40, 'F');

      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(isOk ? 16 : 185, isOk ? 185 : 28, isOk ? 129 : 28);
      pdf.text(isOk ? 'VÉRIFICATION OK' : 'ATTENTION - DÉPASSEMENT', 14, y + 8);

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text(`Ik" calculé: ${result.Ik_kA.toFixed(2)} kA | Icu dispositif: ${params.device_Icu_kA} kA | Marge: ${margin.toFixed(1)}%`, 14, y + 22);
    }

    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text('Généré par ElectroHub - Fault Level Assessment Module', 14, pageHeight - 10);
    pdf.text('Conforme IEC 60909-0:2016', pageWidth - 60, pageHeight - 10);

    pdf.save(`fault_level_assessment_${new Date().toISOString().slice(0, 10)}.pdf`);
    setToast({ type: 'success', message: 'PDF professionnel exporté avec succès !' });
  };

  return (
    <section className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out; }
      `}</style>

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 text-white">
        <div className="max-w-[95vw] mx-auto px-4 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-white/20 rounded-2xl"><Zap size={36} /></div>
              <div>
                <h1 className="text-3xl lg:text-4xl font-bold">Fault Level Assessment</h1>
                <p className="text-blue-100 mt-1">Calcul de courant de court-circuit selon IEC 60909-0</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a href="https://webstore.iec.ch/publication/24100" target="_blank" rel="noopener noreferrer"
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors">
                <Book size={18} />Norme IEC 60909
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[95vw] mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Panel - Parameters */}
          <div className="lg:col-span-1 space-y-6">
            <AnimatedCard>
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-lg">
                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Settings size={20} className="text-blue-600" />
                  Paramètres de calcul
                </h3>

                <div className="mb-6 p-4 bg-blue-50 rounded-xl">
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Target size={16} className="text-blue-600" />
                    Sélection depuis tableau
                  </h4>
                  <DeviceSelector onSelect={setSelectedDevice} selectedDevice={selectedDevice} />
                </div>

                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>Tension nominale (V)</label>
                    <select value={params.voltage_v} onChange={e => setParams(p => ({ ...p, voltage_v: Number(e.target.value) }))} className={selectBaseClass}>
                      <option value={230}>230 V (Mono)</option>
                      <option value={400}>400 V (Tri)</option>
                      <option value={690}>690 V</option>
                      <option value={1000}>1000 V</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Impédance source (mΩ)</label>
                    <input type="number" step="0.1" value={params.source_impedance_mohm}
                      onChange={e => setParams(p => ({ ...p, source_impedance_mohm: Number(e.target.value) }))}
                      className={inputBaseClass} />
                    <p className="text-xs text-gray-500 mt-1">Impédance du réseau amont</p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-xl">
                    <h4 className="font-semibold text-gray-700 mb-3">Transformateur</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Puissance (kVA)</label>
                        <input type="number" value={params.transformer_power_kva}
                          onChange={e => setParams(p => ({ ...p, transformer_power_kva: Number(e.target.value) }))}
                          className={inputBaseClass} />
                      </div>
                      <div>
                        <label className={labelClass}>Ukr (%)</label>
                        <input type="number" step="0.1" value={params.transformer_ukr_percent}
                          onChange={e => setParams(p => ({ ...p, transformer_ukr_percent: Number(e.target.value) }))}
                          className={inputBaseClass} />
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-xl">
                    <h4 className="font-semibold text-gray-700 mb-3">Câble</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Longueur (m)</label>
                        <input type="number" value={params.cable_length_m}
                          onChange={e => setParams(p => ({ ...p, cable_length_m: Number(e.target.value) }))}
                          className={inputBaseClass} />
                      </div>
                      <div>
                        <label className={labelClass}>Section (mm²)</label>
                        <select value={params.cable_section_mm2}
                          onChange={e => setParams(p => ({ ...p, cable_section_mm2: Number(e.target.value) }))}
                          className={selectBaseClass}>
                          {[1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300].map(s => (
                            <option key={s} value={s}>{s} mm²</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Matériau</label>
                        <select value={params.cable_material}
                          onChange={e => setParams(p => ({ ...p, cable_material: e.target.value }))}
                          className={selectBaseClass}>
                          <option value="copper">Cuivre</option>
                          <option value="aluminum">Aluminium</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Type</label>
                        <select value={params.cable_type}
                          onChange={e => setParams(p => ({ ...p, cable_type: e.target.value }))}
                          className={selectBaseClass}>
                          <option value="single_core">Monoconducteur</option>
                          <option value="multi_core">Multiconducteur</option>
                          <option value="busbar">Jeu de barres</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Type de défaut</label>
                    <select value={params.phase_type} onChange={e => setParams(p => ({ ...p, phase_type: e.target.value }))} className={selectBaseClass}>
                      <option value="three">Triphasé symétrique</option>
                      <option value="single">Monophasé</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Icu du dispositif (kA)</label>
                    <input type="number" step="0.1" value={params.device_Icu_kA || ''}
                      onChange={e => setParams(p => ({ ...p, device_Icu_kA: e.target.value ? Number(e.target.value) : null }))}
                      className={inputBaseClass} placeholder="Pour vérification" />
                    <p className="text-xs text-gray-500 mt-1">Pouvoir de coupure ultime du disjoncteur</p>
                  </div>
                </div>

                <button onClick={handleCalculate}
                  className="w-full mt-6 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold text-lg hover:from-blue-700 hover:to-cyan-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-200">
                  <Calculator size={24} />
                  Calculer Ik
                </button>
              </div>
            </AnimatedCard>

            <AnimatedCard delay={100}>
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border border-blue-100 p-6">
                <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <HelpCircle size={18} className="text-blue-600" />
                  Formules IEC 60909
                </h4>
                <div className="space-y-3 text-sm">
                  <div className="p-3 bg-white rounded-xl">
                    <p className="font-mono text-blue-800">Ik" = c × Un / (√3 × Zk)</p>
                    <p className="text-gray-500 text-xs mt-1">Courant de court-circuit initial</p>
                  </div>
                  <div className="p-3 bg-white rounded-xl">
                    <p className="font-mono text-purple-800">Ip = κ × √2 × Ik"</p>
                    <p className="text-gray-500 text-xs mt-1">Courant de crête</p>
                  </div>
                  <div className="p-3 bg-white rounded-xl">
                    <p className="font-mono text-cyan-800">κ = 1.02 + 0.98 × e^(-3×R/X)</p>
                    <p className="text-gray-500 text-xs mt-1">Facteur de crête</p>
                  </div>
                </div>
              </div>
            </AnimatedCard>
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-2 space-y-6">
            {result ? (
              <>
                <FaultResultCard result={result} params={params} onExportPDF={exportPDF} />
                <AnimatedCard delay={200}>
                  <FaultCurveChart params={params} deviceIcu={params.device_Icu_kA} />
                </AnimatedCard>
              </>
            ) : (
              <AnimatedCard>
                <div className="bg-white rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
                  <div className="w-24 h-24 mx-auto mb-6 bg-blue-100 rounded-3xl flex items-center justify-center">
                    <Calculator size={48} className="text-blue-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Prêt à calculer</h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Configurez les paramètres du réseau électrique puis cliquez sur "Calculer Ik" pour obtenir le courant de court-circuit selon la norme IEC 60909-0.
                  </p>
                </div>
              </AnimatedCard>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </section>
  );
}
