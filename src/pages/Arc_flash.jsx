// src/pages/Arc_flash.jsx - Professional IEEE 1584-2018 Arc Flash Analysis with Danger Labels
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Zap, AlertTriangle, CheckCircle, X, Download, Shield, Clock, Calculator,
  Activity, Target, Bolt, TrendingUp, Settings, Info, RefreshCw, Eye,
  AlertCircle, Book, HelpCircle, Flame, Users, HardHat, Glasses, Hand,
  Shirt, FileText, Printer, ChevronRight, ChevronDown
} from 'lucide-react';
import { api, get, post } from '../lib/api.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import Annotation from 'chartjs-plugin-annotation';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, Annotation);

// ==================== IEEE 1584-2018 CALCULATIONS ====================

/**
 * IEEE 1584-2018 Arc Flash Incident Energy Calculation
 *
 * For LV (208V - 600V) and MV (601V - 15000V) systems
 *
 * Key equations:
 * 1. Arcing Current (Ia): Depends on voltage, bolted fault current, gap, electrode config
 * 2. Incident Energy (E): Based on Ia, arc duration, working distance, enclosure type
 * 3. Arc Flash Boundary (AFB): Distance at which E = 1.2 cal/cm²
 */

// Electrode configurations (IEEE 1584-2018 Table 1)
const ELECTRODE_CONFIGS = {
  VCB: { name: 'Vertical conductors/electrodes inside a box/enclosure', k1: -0.555, k2: -0.113, k3: 0.0016 },
  VCBB: { name: 'Vertical conductors/electrodes terminated in a barrier', k1: -0.539, k2: -0.096, k3: 0.00149 },
  HCB: { name: 'Horizontal conductors/electrodes inside a box/enclosure', k1: -0.598, k2: -0.113, k3: 0.00154 },
  VOA: { name: 'Vertical conductors/electrodes in open air', k1: -0.403, k2: -0.046, k3: 0.00189 },
  HOA: { name: 'Horizontal conductors/electrodes in open air', k1: -0.365, k2: -0.046, k3: 0.00189 }
};

// PPE Categories per NFPA 70E-2021
const PPE_CATEGORIES = [
  { cat: 0, minCal: 0, maxCal: 1.2, color: '#22c55e', name: 'Catégorie 0', description: 'Vêtements non-fondants', clothing: 'Chemise longue, pantalon', gloves: 'Non requis', face: 'Lunettes de sécurité' },
  { cat: 1, minCal: 1.2, maxCal: 4, color: '#84cc16', name: 'Catégorie 1', description: '4 cal/cm² minimum', clothing: 'Chemise FR + pantalon FR', gloves: 'Gants cuir', face: 'Écran facial + casque' },
  { cat: 2, minCal: 4, maxCal: 8, color: '#eab308', name: 'Catégorie 2', description: '8 cal/cm² minimum', clothing: 'Chemise FR + pantalon FR + combinaison', gloves: 'Gants isolants', face: 'Écran facial AR + cagoule' },
  { cat: 3, minCal: 8, maxCal: 25, color: '#f97316', name: 'Catégorie 3', description: '25 cal/cm² minimum', clothing: 'Combinaison AR complète', gloves: 'Gants isolants classe 00', face: 'Cagoule AR complète' },
  { cat: 4, minCal: 25, maxCal: 40, color: '#ef4444', name: 'Catégorie 4', description: '40 cal/cm² minimum', clothing: 'Combinaison AR multicouches', gloves: 'Gants isolants classe 0', face: 'Cagoule AR + écran' },
  { cat: 5, minCal: 40, maxCal: Infinity, color: '#7f1d1d', name: 'DANGER EXTRÊME', description: 'Travail interdit - Consignation obligatoire', clothing: 'INTERDIT', gloves: 'N/A', face: 'N/A' }
];

function getPPECategory(incidentEnergy) {
  return PPE_CATEGORIES.find(p => incidentEnergy >= p.minCal && incidentEnergy < p.maxCal) || PPE_CATEGORIES[5];
}

/**
 * IEEE 1584-2018 Simplified Calculation for LV Systems
 */
function calculateArcFlash(params) {
  const {
    voltage_v = 480,
    bolted_fault_ka = 25,
    arc_duration_s = 0.1,
    working_distance_mm = 455,
    electrode_gap_mm = 32,
    electrode_config = 'VCB',
    enclosure_width_mm = 508,
    enclosure_height_mm = 508,
    enclosure_depth_mm = 203
  } = params;

  const V = voltage_v;
  const Ibf = bolted_fault_ka;
  const t = arc_duration_s;
  const D = working_distance_mm;
  const G = electrode_gap_mm;

  // Get electrode configuration coefficients
  const config = ELECTRODE_CONFIGS[electrode_config] || ELECTRODE_CONFIGS.VCB;

  // Step 1: Calculate Arcing Current (Ia) - IEEE 1584-2018 Eq. 1
  let lgIa;
  if (V <= 600) {
    // LV equation
    lgIa = 0.00402 + 0.983 * Math.log10(Ibf);
  } else {
    // MV equation (simplified)
    lgIa = 0.00402 + 0.983 * Math.log10(Ibf) - 0.0113 * (V / 1000);
  }
  const Ia = Math.pow(10, lgIa);

  // Step 2: Calculate Normalized Incident Energy (En) - IEEE 1584-2018 Eq. 3
  const k1 = config.k1;
  const k2 = config.k2;

  // Enclosure size correction factor
  const CF = 1.0; // Simplified - would be calculated based on enclosure dimensions

  // lgEn = k1 + k2*lg(G) + 1.081*lg(Ia) + 0.0011*G
  const lgEn = k1 + k2 * Math.log10(G) + 1.081 * Math.log10(Ia) + 0.0011 * G;
  const En = Math.pow(10, lgEn);

  // Step 3: Calculate Incident Energy at working distance
  // E = 4.184 * Cf * En * (t/0.2) * (610^x / D^x)
  // where x is distance exponent (typically 2 for box, 1.5 for open air)
  const x = electrode_config.includes('OA') ? 1.5 : 2.0;
  const E = 4.184 * CF * En * (t / 0.2) * Math.pow(610 / D, x);

  // Step 4: Calculate Arc Flash Boundary (distance where E = 1.2 cal/cm²)
  // AFB = 610 * (4.184 * Cf * En * (t/0.2) / 1.2)^(1/x)
  const AFB = 610 * Math.pow((4.184 * CF * En * (t / 0.2) / 1.2), 1 / x);

  // Get PPE category
  const ppe = getPPECategory(E);

  return {
    arcing_current_ka: Ia,
    incident_energy_cal: E,
    arc_flash_boundary_mm: AFB,
    arc_flash_boundary_m: AFB / 1000,
    ppe_category: ppe.cat,
    ppe_info: ppe,
    normalized_energy: En,
    distance_exponent: x
  };
}

function generateEnergyCurve(params, maxDistance = 2000) {
  const points = [];
  for (let d = 200; d <= maxDistance; d += 50) {
    const result = calculateArcFlash({ ...params, working_distance_mm: d });
    points.push({
      distance_mm: d,
      energy: result.incident_energy_cal,
      ppe_cat: result.ppe_category
    });
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
    info: { bg: 'bg-amber-500', Icon: Info },
    warning: { bg: 'bg-orange-500', Icon: AlertTriangle }
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

const inputBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 transition-all";
const selectBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 transition-all";
const labelClass = "block text-sm font-semibold text-gray-700 mb-2";

// ==================== ARC FLASH DANGER LABEL ====================

const ArcFlashDangerLabel = ({ result, params, onExportPDF }) => {
  if (!result) return null;

  const ppe = result.ppe_info;
  const isDanger = result.ppe_category >= 3;
  const isExtreme = result.ppe_category >= 5;

  return (
    <AnimatedCard>
      <div className={`rounded-3xl overflow-hidden shadow-2xl border-4 ${isExtreme ? 'border-red-800' : isDanger ? 'border-red-500' : 'border-amber-500'}`}>
        {/* Header - DANGER or WARNING */}
        <div className={`p-6 text-white text-center ${isExtreme ? 'bg-gradient-to-r from-red-900 to-red-700' : isDanger ? 'bg-gradient-to-r from-red-600 to-red-500' : 'bg-gradient-to-r from-amber-500 to-orange-500'}`}>
          <div className="flex items-center justify-center gap-4 mb-2">
            <AlertTriangle size={48} className="animate-pulse" />
            <h2 className="text-4xl font-black tracking-wider">
              {isExtreme ? 'DANGER EXTRÊME' : isDanger ? 'DANGER' : 'WARNING'}
            </h2>
            <AlertTriangle size={48} className="animate-pulse" />
          </div>
          <p className="text-xl font-bold uppercase tracking-wide">
            {isExtreme ? 'ARC FLASH - TRAVAIL INTERDIT' : 'ARC FLASH HAZARD'}
          </p>
        </div>

        {/* Main Content */}
        <div className="bg-white p-6">
          {/* Incident Energy + PPE Category */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center p-6 rounded-2xl" style={{ backgroundColor: ppe.color + '20', borderColor: ppe.color, borderWidth: 3 }}>
              <Flame size={40} className="mx-auto mb-2" style={{ color: ppe.color }} />
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Énergie Incidente</p>
              <p className="text-5xl font-black mt-2" style={{ color: ppe.color }}>{result.incident_energy_cal.toFixed(1)}</p>
              <p className="text-xl font-bold" style={{ color: ppe.color }}>cal/cm²</p>
            </div>
            <div className="text-center p-6 rounded-2xl" style={{ backgroundColor: ppe.color + '20', borderColor: ppe.color, borderWidth: 3 }}>
              <Shield size={40} className="mx-auto mb-2" style={{ color: ppe.color }} />
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Catégorie PPE</p>
              <p className="text-5xl font-black mt-2" style={{ color: ppe.color }}>{ppe.cat}</p>
              <p className="text-lg font-bold" style={{ color: ppe.color }}>{ppe.description}</p>
            </div>
          </div>

          {/* Arc Flash Boundary */}
          <div className="bg-gray-100 rounded-2xl p-4 mb-6 text-center">
            <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1">Arc Flash Boundary (Limite de Sécurité)</p>
            <p className="text-3xl font-black text-gray-900">{result.arc_flash_boundary_m.toFixed(2)} m</p>
            <p className="text-sm text-gray-500">({result.arc_flash_boundary_mm.toFixed(0)} mm)</p>
          </div>

          {/* PPE Requirements */}
          {!isExtreme && (
            <div className="space-y-3">
              <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
                <Users size={20} className="text-red-500" />
                Équipements de Protection Individuelle Requis
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <Shirt size={24} className="text-blue-600" />
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Vêtements</p>
                    <p className="font-semibold text-gray-900 text-sm">{ppe.clothing}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <Hand size={24} className="text-orange-600" />
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Gants</p>
                    <p className="font-semibold text-gray-900 text-sm">{ppe.gloves}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <Glasses size={24} className="text-purple-600" />
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Protection faciale</p>
                    <p className="font-semibold text-gray-900 text-sm">{ppe.face}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <HardHat size={24} className="text-yellow-600" />
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Protection tête</p>
                    <p className="font-semibold text-gray-900 text-sm">Casque isolant requis</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Extreme danger warning */}
          {isExtreme && (
            <div className="bg-red-100 border-2 border-red-500 rounded-2xl p-6 text-center">
              <AlertTriangle size={48} className="mx-auto text-red-600 mb-3" />
              <h3 className="text-2xl font-black text-red-700 mb-2">TRAVAIL SOUS TENSION INTERDIT</h3>
              <p className="text-red-600 font-medium">
                L'énergie incidente dépasse 40 cal/cm². Consignation obligatoire avant toute intervention.
              </p>
            </div>
          )}
        </div>

        {/* Footer - Technical Details */}
        <div className="bg-gray-900 text-white p-4">
          <div className="grid grid-cols-4 gap-4 text-center text-sm">
            <div>
              <p className="text-gray-400 text-xs uppercase">Tension</p>
              <p className="font-bold">{params.voltage_v} V</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase">Icc</p>
              <p className="font-bold">{params.bolted_fault_ka} kA</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase">Durée arc</p>
              <p className="font-bold">{(params.arc_duration_s * 1000).toFixed(0)} ms</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase">Distance</p>
              <p className="font-bold">{params.working_distance_mm} mm</p>
            </div>
          </div>
          <p className="text-center text-xs text-gray-500 mt-3">Calcul selon IEEE 1584-2018 | Généré le {new Date().toLocaleDateString('fr-FR')}</p>
        </div>

        {/* Export Button */}
        <div className="bg-gray-100 p-4 flex justify-center gap-3">
          <button onClick={() => onExportPDF(false)}
            className="px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl font-bold hover:from-red-600 hover:to-rose-700 transition-all flex items-center gap-2 shadow-lg">
            <Download size={20} />
            Télécharger l'étiquette Arc Flash
          </button>
          <button onClick={() => onExportPDF(true)}
            className="px-6 py-3 bg-gradient-to-r from-gray-700 to-gray-900 text-white rounded-xl font-bold hover:from-gray-800 hover:to-black transition-all flex items-center gap-2 shadow-lg">
            <FileText size={20} />
            Rapport complet PDF
          </button>
        </div>
      </div>
    </AnimatedCard>
  );
};

// ==================== ENERGY CURVE CHART ====================

const EnergyCurveChart = ({ params }) => {
  const curveData = useMemo(() => generateEnergyCurve(params), [params]);

  // Add PPE category zones as annotations
  const annotations = {};
  PPE_CATEGORIES.slice(0, 5).forEach((ppe, idx) => {
    annotations[`zone${idx}`] = {
      type: 'box',
      yMin: ppe.minCal,
      yMax: Math.min(ppe.maxCal, 50),
      backgroundColor: ppe.color + '20',
      borderColor: ppe.color,
      borderWidth: 1,
      label: {
        display: true,
        content: `Cat ${ppe.cat}`,
        position: 'start'
      }
    };
  });

  const chartData = {
    labels: curveData.map(p => p.distance_mm),
    datasets: [{
      label: 'Énergie incidente (cal/cm²)',
      data: curveData.map(p => p.energy),
      borderColor: 'rgb(239, 68, 68)',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      borderWidth: 3
    }]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Énergie incidente en fonction de la distance', font: { size: 16, weight: 'bold' } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)} cal/cm² @ ${ctx.parsed.x} mm` } },
      annotation: { annotations }
    },
    scales: {
      x: { title: { display: true, text: 'Distance de travail (mm)', font: { weight: 'bold' } } },
      y: {
        title: { display: true, text: 'Énergie incidente (cal/cm²)', font: { weight: 'bold' } },
        beginAtZero: true,
        max: 50
      }
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
              {devices.map(d => <option key={d.id} value={d.id}>{d.name} - {d.reference}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function ArcFlash() {
  const [toast, setToast] = useState(null);
  const [result, setResult] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);

  const [params, setParams] = useState({
    voltage_v: 480,
    bolted_fault_ka: 25,
    arc_duration_s: 0.1,
    working_distance_mm: 455,
    electrode_gap_mm: 32,
    electrode_config: 'VCB',
    enclosure_width_mm: 508,
    enclosure_height_mm: 508,
    enclosure_depth_mm: 203
  });

  // Auto-fill params from selected device
  useEffect(() => {
    if (selectedDevice) {
      const settings = selectedDevice.settings || {};
      setParams(p => ({
        ...p,
        voltage_v: selectedDevice.voltage_v || p.voltage_v,
        // Use Icu as estimate for bolted fault if available
        bolted_fault_ka: selectedDevice.icu_ka || p.bolted_fault_ka,
        // Arc duration based on trip time if available
        arc_duration_s: settings.trip_time_s || p.arc_duration_s,
      }));
    }
  }, [selectedDevice]);

  const handleCalculate = () => {
    try {
      const res = calculateArcFlash(params);
      setResult(res);
      setToast({ type: 'success', message: 'Calcul IEEE 1584 effectué avec succès !' });
    } catch (err) {
      setToast({ type: 'error', message: 'Erreur de calcul: ' + err.message });
    }
  };

  const exportPDF = (fullReport = false) => {
    if (!result) return;

    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ppe = result.ppe_info;
    const isExtreme = result.ppe_category >= 5;
    const isDanger = result.ppe_category >= 3;

    // === PAGE 1: ARC FLASH LABEL ===

    // Header band
    if (isExtreme) {
      pdf.setFillColor(127, 29, 29);
    } else if (isDanger) {
      pdf.setFillColor(220, 38, 38);
    } else {
      pdf.setFillColor(245, 158, 11);
    }
    pdf.rect(0, 0, pageWidth, 50, 'F');

    // Warning symbols (triangles)
    pdf.setFillColor(255, 255, 255);
    pdf.triangle(25, 35, 15, 45, 35, 45, 'F');
    pdf.triangle(pageWidth - 25, 35, pageWidth - 35, 45, pageWidth - 15, 45, 'F');

    // Exclamation marks
    pdf.setTextColor(isExtreme ? 127 : isDanger ? 220 : 245, isExtreme ? 29 : 38, isExtreme ? 29 : isDanger ? 38 : 11);
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('!', 25, 44, { align: 'center' });
    pdf.text('!', pageWidth - 25, 44, { align: 'center' });

    // Main title
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(32);
    pdf.setFont('helvetica', 'bold');
    pdf.text(isExtreme ? 'DANGER EXTRÊME' : isDanger ? 'DANGER' : 'WARNING', pageWidth / 2, 28, { align: 'center' });
    pdf.setFontSize(14);
    pdf.text(isExtreme ? 'ARC FLASH - TRAVAIL INTERDIT' : 'ARC FLASH HAZARD', pageWidth / 2, 42, { align: 'center' });

    // Incident Energy Box
    let y = 65;
    pdf.setFillColor(254, 242, 242);
    pdf.setDrawColor(239, 68, 68);
    pdf.setLineWidth(2);
    pdf.roundedRect(14, y, (pageWidth - 28) / 2 - 5, 60, 5, 5, 'FD');

    pdf.setTextColor(100, 100, 100);
    pdf.setFontSize(10);
    pdf.text('ÉNERGIE INCIDENTE', 14 + (pageWidth - 28) / 4 - 2.5, y + 15, { align: 'center' });
    pdf.setTextColor(220, 38, 38);
    pdf.setFontSize(36);
    pdf.setFont('helvetica', 'bold');
    pdf.text(result.incident_energy_cal.toFixed(1), 14 + (pageWidth - 28) / 4 - 2.5, y + 40, { align: 'center' });
    pdf.setFontSize(14);
    pdf.text('cal/cm²', 14 + (pageWidth - 28) / 4 - 2.5, y + 52, { align: 'center' });

    // PPE Category Box
    const ppeX = 14 + (pageWidth - 28) / 2 + 5;
    pdf.roundedRect(ppeX, y, (pageWidth - 28) / 2 - 5, 60, 5, 5, 'FD');

    pdf.setTextColor(100, 100, 100);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('CATÉGORIE PPE', ppeX + (pageWidth - 28) / 4 - 2.5, y + 15, { align: 'center' });
    pdf.setTextColor(220, 38, 38);
    pdf.setFontSize(48);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(ppe.cat), ppeX + (pageWidth - 28) / 4 - 2.5, y + 45, { align: 'center' });
    pdf.setFontSize(10);
    pdf.text(ppe.description, ppeX + (pageWidth - 28) / 4 - 2.5, y + 55, { align: 'center' });

    // Arc Flash Boundary
    y += 70;
    pdf.setFillColor(243, 244, 246);
    pdf.setDrawColor(156, 163, 175);
    pdf.setLineWidth(1);
    pdf.roundedRect(14, y, pageWidth - 28, 30, 5, 5, 'FD');

    pdf.setTextColor(55, 65, 81);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('ARC FLASH BOUNDARY:', 24, y + 18);
    pdf.setFontSize(16);
    pdf.text(`${result.arc_flash_boundary_m.toFixed(2)} m (${result.arc_flash_boundary_mm.toFixed(0)} mm)`, pageWidth - 24, y + 18, { align: 'right' });

    // PPE Requirements
    y += 40;
    if (!isExtreme) {
      pdf.setTextColor(31, 41, 55);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('ÉQUIPEMENTS DE PROTECTION REQUIS', 14, y);

      y += 10;
      pdf.autoTable({
        startY: y,
        head: [['Protection', 'Exigence']],
        body: [
          ['Vêtements', ppe.clothing],
          ['Gants', ppe.gloves],
          ['Protection faciale', ppe.face],
          ['Casque', 'Casque isolant requis']
        ],
        theme: 'grid',
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 11, cellPadding: 6 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
      });
      y = pdf.lastAutoTable.finalY + 10;
    } else {
      pdf.setFillColor(254, 226, 226);
      pdf.setDrawColor(220, 38, 38);
      pdf.setLineWidth(2);
      pdf.roundedRect(14, y, pageWidth - 28, 50, 5, 5, 'FD');

      pdf.setTextColor(127, 29, 29);
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('TRAVAIL SOUS TENSION INTERDIT', pageWidth / 2, y + 20, { align: 'center' });
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Énergie > 40 cal/cm² - Consignation obligatoire', pageWidth / 2, y + 35, { align: 'center' });
      y += 60;
    }

    // Technical footer
    pdf.setFillColor(31, 41, 55);
    pdf.rect(0, pageHeight - 35, pageWidth, 35, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    const footerY = pageHeight - 22;
    pdf.text(`Tension: ${params.voltage_v}V`, 20, footerY);
    pdf.text(`Icc: ${params.bolted_fault_ka}kA`, 60, footerY);
    pdf.text(`Durée: ${(params.arc_duration_s * 1000).toFixed(0)}ms`, 100, footerY);
    pdf.text(`Distance: ${params.working_distance_mm}mm`, 145, footerY);

    pdf.setTextColor(156, 163, 175);
    pdf.setFontSize(8);
    pdf.text(`IEEE 1584-2018 | Généré le ${new Date().toLocaleDateString('fr-FR')}`, pageWidth / 2, pageHeight - 8, { align: 'center' });

    if (fullReport) {
      // === PAGE 2: FULL REPORT ===
      pdf.addPage();

      // Header
      pdf.setFillColor(220, 38, 38);
      pdf.rect(0, 0, pageWidth, 40, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('ARC FLASH ANALYSIS REPORT', 14, 25);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('IEEE 1584-2018 Calculation', 14, 35);

      // Results table
      let ry = 55;
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('RÉSULTATS DU CALCUL', 14, ry);

      ry += 10;
      pdf.autoTable({
        startY: ry,
        head: [['Paramètre', 'Valeur', 'Unité', 'Description']],
        body: [
          ['Courant d\'arc', result.arcing_current_ka.toFixed(2), 'kA', 'Courant d\'arc calculé'],
          ['Énergie incidente', result.incident_energy_cal.toFixed(2), 'cal/cm²', 'À la distance de travail'],
          ['Arc Flash Boundary', result.arc_flash_boundary_m.toFixed(2), 'm', 'Distance E = 1.2 cal/cm²'],
          ['Catégorie PPE', result.ppe_category, '-', result.ppe_info.description],
          ['Énergie normalisée', result.normalized_energy.toFixed(4), '-', 'En (IEEE 1584)'],
          ['Exposant distance', result.distance_exponent.toFixed(1), '-', 'x factor']
        ],
        theme: 'striped',
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [254, 242, 242] },
        styles: { fontSize: 10, cellPadding: 5 }
      });

      ry = pdf.lastAutoTable.finalY + 15;

      // Input parameters
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text("PARAMÈTRES D'ENTRÉE", 14, ry);

      ry += 8;
      pdf.autoTable({
        startY: ry,
        head: [['Paramètre', 'Valeur']],
        body: [
          ['Tension nominale', `${params.voltage_v} V`],
          ['Courant de défaut', `${params.bolted_fault_ka} kA`],
          ['Durée de l\'arc', `${params.arc_duration_s * 1000} ms`],
          ['Distance de travail', `${params.working_distance_mm} mm`],
          ['Écartement électrodes', `${params.electrode_gap_mm} mm`],
          ['Configuration', ELECTRODE_CONFIGS[params.electrode_config]?.name || params.electrode_config]
        ],
        theme: 'grid',
        headStyles: { fillColor: [100, 100, 100] },
        styles: { fontSize: 10 }
      });

      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text('Généré par ElectroHub - Arc Flash Analysis Module', 14, pageHeight - 10);
      pdf.text('Conforme IEEE 1584-2018 & NFPA 70E-2021', pageWidth - 70, pageHeight - 10);
    }

    pdf.save(`arc_flash_${fullReport ? 'report' : 'label'}_${new Date().toISOString().slice(0, 10)}.pdf`);
    setToast({ type: 'success', message: `${fullReport ? 'Rapport complet' : 'Étiquette Arc Flash'} exporté !` });
  };

  return (
    <section className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
        .animate-pulse { animation: pulse 1.5s infinite; }
      `}</style>

      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 via-red-500 to-orange-500 text-white">
        <div className="max-w-[95vw] mx-auto px-4 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-white/20 rounded-2xl">
                <Flame size={36} />
              </div>
              <div>
                <h1 className="text-3xl lg:text-4xl font-bold">Arc Flash Analysis</h1>
                <p className="text-red-100 mt-1">Calcul d'énergie incidente selon IEEE 1584-2018</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a href="https://standards.ieee.org/standard/1584-2018.html" target="_blank" rel="noopener noreferrer"
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors">
                <Book size={18} />Norme IEEE 1584
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
                  <Settings size={20} className="text-red-600" />
                  Paramètres de calcul
                </h3>

                <div className="mb-6 p-4 bg-red-50 rounded-xl">
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Target size={16} className="text-red-600" />
                    Sélection depuis tableau
                  </h4>
                  <DeviceSelector onSelect={setSelectedDevice} selectedDevice={selectedDevice} />
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Tension (V)</label>
                      <select value={params.voltage_v} onChange={e => setParams(p => ({ ...p, voltage_v: Number(e.target.value) }))} className={selectBaseClass}>
                        {[208, 240, 277, 400, 480, 600, 4160, 13800].map(v => <option key={v} value={v}>{v} V</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Icc (kA)</label>
                      <input type="number" step="0.1" value={params.bolted_fault_ka}
                        onChange={e => setParams(p => ({ ...p, bolted_fault_ka: Number(e.target.value) }))}
                        className={inputBaseClass} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Durée arc (ms)</label>
                      <input type="number" step="1" value={params.arc_duration_s * 1000}
                        onChange={e => setParams(p => ({ ...p, arc_duration_s: Number(e.target.value) / 1000 }))}
                        className={inputBaseClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Distance (mm)</label>
                      <select value={params.working_distance_mm} onChange={e => setParams(p => ({ ...p, working_distance_mm: Number(e.target.value) }))} className={selectBaseClass}>
                        <option value={305}>305 mm (12")</option>
                        <option value={455}>455 mm (18")</option>
                        <option value={610}>610 mm (24")</option>
                        <option value={910}>910 mm (36")</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Configuration électrodes</label>
                    <select value={params.electrode_config} onChange={e => setParams(p => ({ ...p, electrode_config: e.target.value }))} className={selectBaseClass}>
                      {Object.entries(ELECTRODE_CONFIGS).map(([key, cfg]) => (
                        <option key={key} value={key}>{key} - {cfg.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Écartement électrodes (mm)</label>
                    <select value={params.electrode_gap_mm} onChange={e => setParams(p => ({ ...p, electrode_gap_mm: Number(e.target.value) }))} className={selectBaseClass}>
                      <option value={13}>13 mm (Panelboard)</option>
                      <option value={25}>25 mm (LV MCC)</option>
                      <option value={32}>32 mm (LV Switchgear)</option>
                      <option value={102}>102 mm (MV Switchgear)</option>
                      <option value={153}>153 mm (HV Switchgear)</option>
                    </select>
                  </div>
                </div>

                <button onClick={handleCalculate}
                  className="w-full mt-6 py-4 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 text-white font-bold text-lg hover:from-red-700 hover:to-orange-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-red-200">
                  <Flame size={24} />
                  Calculer Arc Flash
                </button>
              </div>
            </AnimatedCard>

            {/* PPE Categories Reference */}
            <AnimatedCard delay={100}>
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-lg">
                <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield size={18} className="text-red-600" />
                  Catégories PPE (NFPA 70E)
                </h4>
                <div className="space-y-2">
                  {PPE_CATEGORIES.slice(0, 5).map(ppe => (
                    <div key={ppe.cat} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: ppe.color + '15' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: ppe.color }}>
                        {ppe.cat}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 text-sm">{ppe.minCal} - {ppe.maxCal === Infinity ? '40+' : ppe.maxCal} cal/cm²</p>
                        <p className="text-xs text-gray-500">{ppe.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </AnimatedCard>
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-2 space-y-6">
            {result ? (
              <>
                <ArcFlashDangerLabel result={result} params={params} onExportPDF={exportPDF} />
                <AnimatedCard delay={200}>
                  <EnergyCurveChart params={params} />
                </AnimatedCard>
              </>
            ) : (
              <AnimatedCard>
                <div className="bg-white rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
                  <div className="w-24 h-24 mx-auto mb-6 bg-red-100 rounded-3xl flex items-center justify-center">
                    <Flame size={48} className="text-red-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Analyse Arc Flash</h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Configurez les paramètres du système électrique puis cliquez sur "Calculer Arc Flash" pour obtenir l'énergie incidente et la catégorie PPE requise selon IEEE 1584-2018.
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
