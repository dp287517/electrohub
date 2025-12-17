// src/pages/Selectivity.jsx - Professional IEC 60947-2 Protection Coordination
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Zap, AlertTriangle, CheckCircle, X, Download, Shield, Clock, Calculator,
  Activity, Target, TrendingUp, Settings, Info, RefreshCw, Eye,
  AlertCircle, Book, HelpCircle, GitBranch, Layers, ArrowRight, ArrowDown,
  Check, XCircle, FileText, ChevronDown, ChevronRight, Network, Building2
} from 'lucide-react';
import { api, get, post } from '../lib/api.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import Annotation from 'chartjs-plugin-annotation';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, Annotation);

// ==================== IEC 60947-2 TRIP CURVE CALCULATIONS ====================

/**
 * Standard trip curves for circuit breakers
 * Based on IEC 60947-2 for MCCBs and IEC 60898 for MCBs
 */

const CURVE_TYPES = {
  B: { thermal: { min: 3, max: 5 }, magnetic: { min: 3, max: 5 } },
  C: { thermal: { min: 5, max: 10 }, magnetic: { min: 5, max: 10 } },
  D: { thermal: { min: 10, max: 14 }, magnetic: { min: 10, max: 14 } },
  K: { thermal: { min: 10, max: 14 }, magnetic: { min: 10, max: 14 } },
  Z: { thermal: { min: 2.4, max: 3.6 }, magnetic: { min: 2.4, max: 3.6 } }
};

/**
 * Generate trip curve points for a circuit breaker
 * Returns array of {current, time} points
 */
function generateTripCurve(params) {
  const {
    In = 100,        // Nominal current (A)
    Ir = 1.0,        // Long-time pickup (multiple of In)
    Tr = 10,         // Long-time delay (s)
    Isd = 8,         // Short-time pickup (multiple of Ir*In)
    Tsd = 0.1,       // Short-time delay (s)
    Ii = 10,         // Instantaneous pickup (multiple of In)
    curve = 'C',     // Curve type for MCBs
    isMCCB = true    // MCCB or MCB
  } = params;

  const points = [];
  const Ir_A = Ir * In;
  const Isd_A = Isd * Ir * In;
  const Ii_A = Ii * In;

  // Generate points from 0.5*In to 100*In (log scale)
  for (let mult = 0.5; mult <= 100; mult *= 1.1) {
    const I = mult * In;
    let t;

    if (isMCCB) {
      // MCCB trip curve (adjustable settings)
      if (I >= Ii_A) {
        // Instantaneous region
        t = 0.01;
      } else if (I >= Isd_A) {
        // Short-time region (I²t constant or definite time)
        t = Tsd;
      } else if (I >= Ir_A) {
        // Long-time (thermal) region: t = Tr * (Ir*In / I)²
        t = Tr * Math.pow(Ir_A / I, 2);
        t = Math.max(t, 0.01);
        t = Math.min(t, 10000);
      } else {
        // Below pickup - no trip
        t = null;
      }
    } else {
      // MCB trip curve (fixed curves B, C, D)
      const curveData = CURVE_TYPES[curve] || CURVE_TYPES.C;
      const magMin = curveData.magnetic.min * In;
      const magMax = curveData.magnetic.max * In;

      if (I >= magMax) {
        t = 0.01;
      } else if (I >= magMin) {
        // Magnetic region - quick trip
        t = 0.02 + (magMax - I) / (magMax - magMin) * 0.1;
      } else if (I >= 1.13 * In) {
        // Thermal region
        t = 3600 * Math.pow(1.45 * In / I, 2);
        t = Math.min(t, 10000);
      } else {
        t = null;
      }
    }

    if (t !== null) {
      points.push({ current: I, time: t });
    }
  }

  return points;
}

/**
 * Check selectivity between upstream and downstream devices
 */
function checkSelectivity(upstream, downstream, faultCurrents) {
  const results = [];
  let isSelective = true;
  let isPartiallySelective = false;

  for (const Ifault of faultCurrents) {
    const tUp = getTripTime(upstream, Ifault);
    const tDown = getTripTime(downstream, Ifault);

    let status;
    if (tDown === null || tUp === null) {
      status = 'no_trip';
    } else if (tDown < tUp * 0.9) {
      status = 'selective';
    } else if (tDown < tUp) {
      status = 'partial';
      isPartiallySelective = true;
    } else {
      status = 'non_selective';
      isSelective = false;
    }

    results.push({
      current: Ifault,
      tUp,
      tDown,
      status,
      margin: tUp && tDown ? ((tUp - tDown) / tUp * 100) : null
    });
  }

  return {
    results,
    isSelective: isSelective && !isPartiallySelective,
    isPartiallySelective,
    limitCurrent: isSelective ? null : results.find(r => r.status === 'non_selective')?.current
  };
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

const inputBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 transition-all";
const selectBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white text-gray-900 transition-all";
const labelClass = "block text-sm font-semibold text-gray-700 mb-2";

// ==================== SELECTIVITY CHART ====================

const SelectivityChart = ({ upstream, downstream, selectivityResult }) => {
  const upstreamCurve = useMemo(() => generateTripCurve(upstream), [upstream]);
  const downstreamCurve = useMemo(() => generateTripCurve(downstream), [downstream]);

  const chartData = {
    datasets: [
      {
        label: `Amont: ${upstream.name || 'Upstream'} (${upstream.In}A)`,
        data: upstreamCurve.map(p => ({ x: p.current, y: p.time })),
        borderColor: 'rgb(168, 85, 247)',
        backgroundColor: 'rgba(168, 85, 247, 0.1)',
        fill: false,
        tension: 0.1,
        pointRadius: 0,
        borderWidth: 3
      },
      {
        label: `Aval: ${downstream.name || 'Downstream'} (${downstream.In}A)`,
        data: downstreamCurve.map(p => ({ x: p.current, y: p.time })),
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        fill: false,
        tension: 0.1,
        pointRadius: 0,
        borderWidth: 3
      }
    ]
  };

  // Add selectivity limit line if not fully selective
  if (selectivityResult?.limitCurrent) {
    chartData.datasets.push({
      label: 'Limite de sélectivité',
      data: [
        { x: selectivityResult.limitCurrent, y: 0.001 },
        { x: selectivityResult.limitCurrent, y: 10000 }
      ],
      borderColor: 'rgb(239, 68, 68)',
      borderWidth: 2,
      borderDash: [10, 5],
      pointRadius: 0,
      fill: false
    });
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Courbes temps-courant (IEC 60947-2)', font: { size: 16, weight: 'bold' } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const current = ctx.parsed.x;
            const time = ctx.parsed.y;
            return `${ctx.dataset.label}: ${time.toFixed(3)}s @ ${current.toFixed(0)}A`;
          }
        }
      }
    },
    scales: {
      x: {
        type: 'logarithmic',
        title: { display: true, text: 'Courant (A)', font: { weight: 'bold' } },
        min: Math.min(upstream.In, downstream.In) * 0.5,
        max: Math.max(upstream.In, downstream.In) * 100
      },
      y: {
        type: 'logarithmic',
        title: { display: true, text: 'Temps de déclenchement (s)', font: { weight: 'bold' } },
        min: 0.001,
        max: 10000
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-lg">
      <div className="h-96">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};

// ==================== SELECTIVITY RESULT CARD ====================

const SelectivityResultCard = ({ result, upstream, downstream, onExportPDF }) => {
  if (!result) return null;

  const { isSelective, isPartiallySelective, limitCurrent, results } = result;

  return (
    <AnimatedCard>
      <div className={`bg-white rounded-3xl border-2 ${isSelective ? 'border-emerald-400' : isPartiallySelective ? 'border-amber-400' : 'border-red-400'} overflow-hidden`}>
        {/* Header */}
        <div className={`p-6 text-white ${isSelective ? 'bg-gradient-to-r from-emerald-500 to-teal-600' : isPartiallySelective ? 'bg-gradient-to-r from-amber-500 to-orange-600' : 'bg-gradient-to-r from-red-500 to-rose-600'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-2xl">
                <GitBranch size={32} />
              </div>
              <div>
                <h3 className="text-2xl font-bold">Analyse de Sélectivité</h3>
                <p className="text-white/80">IEC 60947-2</p>
              </div>
            </div>
            <Badge variant={isSelective ? 'success' : isPartiallySelective ? 'warning' : 'danger'} size="lg">
              {isSelective ? <CheckCircle size={14} /> : isPartiallySelective ? <AlertTriangle size={14} /> : <XCircle size={14} />}
              {isSelective ? 'SÉLECTIF' : isPartiallySelective ? 'PARTIELLEMENT SÉLECTIF' : 'NON SÉLECTIF'}
            </Badge>
          </div>
        </div>

        {/* Device Comparison */}
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-4 bg-purple-50 rounded-2xl border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDown size={18} className="text-purple-600" />
                <span className="font-bold text-purple-800">AMONT</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{upstream.name || 'Disjoncteur amont'}</p>
              <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                <div><span className="text-gray-500">In:</span> <span className="font-semibold">{upstream.In}A</span></div>
                <div><span className="text-gray-500">Ir:</span> <span className="font-semibold">{upstream.Ir}×In</span></div>
                <div><span className="text-gray-500">Isd:</span> <span className="font-semibold">{upstream.Isd}×Ir</span></div>
                <div><span className="text-gray-500">Ii:</span> <span className="font-semibold">{upstream.Ii}×In</span></div>
              </div>
            </div>

            <div className="p-4 bg-green-50 rounded-2xl border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDown size={18} className="text-green-600" />
                <span className="font-bold text-green-800">AVAL</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{downstream.name || 'Disjoncteur aval'}</p>
              <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                <div><span className="text-gray-500">In:</span> <span className="font-semibold">{downstream.In}A</span></div>
                <div><span className="text-gray-500">Ir:</span> <span className="font-semibold">{downstream.Ir}×In</span></div>
                <div><span className="text-gray-500">Isd:</span> <span className="font-semibold">{downstream.Isd}×Ir</span></div>
                <div><span className="text-gray-500">Ii:</span> <span className="font-semibold">{downstream.Ii}×In</span></div>
              </div>
            </div>
          </div>

          {/* Selectivity Limit */}
          {limitCurrent && (
            <div className="p-4 bg-red-50 rounded-2xl border border-red-200 mb-6">
              <p className="font-semibold text-red-800">Limite de sélectivité: <span className="text-2xl">{limitCurrent.toFixed(0)} A</span></p>
              <p className="text-sm text-red-600 mt-1">Au-delà de ce courant, la coordination n'est plus assurée.</p>
            </div>
          )}

          {/* Detailed Results Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-3 text-left font-semibold">Courant (A)</th>
                  <th className="px-4 py-3 text-left font-semibold">t Amont (s)</th>
                  <th className="px-4 py-3 text-left font-semibold">t Aval (s)</th>
                  <th className="px-4 py-3 text-left font-semibold">Marge (%)</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 10).map((r, idx) => (
                  <tr key={idx} className={`border-b ${r.status === 'selective' ? 'bg-emerald-50' : r.status === 'partial' ? 'bg-amber-50' : r.status === 'non_selective' ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-2 font-mono">{r.current.toFixed(0)}</td>
                    <td className="px-4 py-2 font-mono">{r.tUp?.toFixed(3) || '—'}</td>
                    <td className="px-4 py-2 font-mono">{r.tDown?.toFixed(3) || '—'}</td>
                    <td className="px-4 py-2 font-mono">{r.margin?.toFixed(1) || '—'}</td>
                    <td className="px-4 py-2">
                      <Badge variant={r.status === 'selective' ? 'success' : r.status === 'partial' ? 'warning' : r.status === 'non_selective' ? 'danger' : 'default'} size="sm">
                        {r.status === 'selective' ? 'OK' : r.status === 'partial' ? 'Partiel' : r.status === 'non_selective' ? 'NON' : '—'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t p-4 bg-gray-50 flex justify-end gap-3">
          <button onClick={onExportPDF}
            className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-medium hover:from-purple-600 hover:to-indigo-700 transition-all flex items-center gap-2 shadow-lg">
            <Download size={18} />
            Exporter Rapport PDF
          </button>
        </div>
      </div>
    </AnimatedCard>
  );
};

// ==================== DEVICE SETTINGS FORM ====================

const DeviceSettingsForm = ({ title, icon: Icon, color, device, onChange }) => (
  <div className={`p-4 bg-${color}-50 rounded-2xl border border-${color}-200`}>
    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
      <Icon size={18} className={`text-${color}-600`} />
      {title}
    </h4>
    <div className="space-y-3">
      <div>
        <label className={labelClass}>Nom</label>
        <input type="text" value={device.name || ''} onChange={e => onChange({ ...device, name: e.target.value })} className={inputBaseClass} placeholder="Ex: Q1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>In (A)</label>
          <input type="number" value={device.In} onChange={e => onChange({ ...device, In: Number(e.target.value) })} className={inputBaseClass} />
        </div>
        <div>
          <label className={labelClass}>Ir (×In)</label>
          <input type="number" step="0.1" value={device.Ir} onChange={e => onChange({ ...device, Ir: Number(e.target.value) })} className={inputBaseClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Tr (s)</label>
          <input type="number" step="0.1" value={device.Tr} onChange={e => onChange({ ...device, Tr: Number(e.target.value) })} className={inputBaseClass} />
        </div>
        <div>
          <label className={labelClass}>Isd (×Ir)</label>
          <input type="number" step="0.1" value={device.Isd} onChange={e => onChange({ ...device, Isd: Number(e.target.value) })} className={inputBaseClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Tsd (s)</label>
          <input type="number" step="0.01" value={device.Tsd} onChange={e => onChange({ ...device, Tsd: Number(e.target.value) })} className={inputBaseClass} />
        </div>
        <div>
          <label className={labelClass}>Ii (×In)</label>
          <input type="number" step="0.1" value={device.Ii} onChange={e => onChange({ ...device, Ii: Number(e.target.value) })} className={inputBaseClass} />
        </div>
      </div>
    </div>
  </div>
);

// ==================== DEVICE SELECTOR WITH AUTO-FILL ====================

const SwitchboardDeviceSelector = ({ label, onDeviceSelect, selectedDevice }) => {
  const [switchboards, setSwitchboards] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedSwitchboard, setSelectedSwitchboard] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSwitchboards();
  }, []);

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

  const handleSwitchboardChange = (e) => {
    const sbId = e.target.value;
    setSelectedSwitchboard(sbId);
    setSelectedDeviceId('');
    setDevices([]);
    if (sbId) loadDevices(sbId);
  };

  const handleDeviceChange = (e) => {
    const devId = e.target.value;
    setSelectedDeviceId(devId);
    const device = devices.find(d => String(d.id) === devId);
    if (device && onDeviceSelect) {
      // Extract trip unit settings if available
      const settings = device.settings || {};
      onDeviceSelect({
        name: device.name || `${device.manufacturer || ''} ${device.reference || ''}`.trim(),
        In: device.in_amps || 100,
        Ir: settings.Ir || 1.0,
        Tr: settings.Tr || 10,
        Isd: settings.Isd || 8,
        Tsd: settings.Tsd || 0.1,
        Ii: settings.Ii || 10,
        isMCCB: device.device_type?.includes('MCCB') || device.in_amps > 63,
        // Keep original device info
        _device: device
      });
    }
  };

  return (
    <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 mb-4">
      <h4 className="font-semibold text-indigo-800 mb-3 flex items-center gap-2">
        <Building2 size={16} />
        {label}
      </h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Tableau</label>
          <select
            value={selectedSwitchboard}
            onChange={handleSwitchboardChange}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="">Sélectionner...</option>
            {switchboards.map(sb => (
              <option key={sb.id} value={sb.id}>{sb.name} ({sb.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Device</label>
          <select
            value={selectedDeviceId}
            onChange={handleDeviceChange}
            disabled={!selectedSwitchboard || loading}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100"
          >
            <option value="">{loading ? 'Chargement...' : 'Sélectionner...'}</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} - {d.in_amps}A {d.manufacturer || ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      {selectedDevice?._device && (
        <div className="mt-2 text-xs text-indigo-600">
          ✓ {selectedDevice._device.manufacturer} {selectedDevice._device.reference} - Icu: {selectedDevice._device.icu_ka}kA
        </div>
      )}
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function Selectivity() {
  const [toast, setToast] = useState(null);
  const [selectivityResult, setSelectivityResult] = useState(null);

  const [upstream, setUpstream] = useState({
    name: 'Q1 Principal',
    In: 400,
    Ir: 1.0,
    Tr: 15,
    Isd: 8,
    Tsd: 0.2,
    Ii: 12,
    isMCCB: true
  });

  const [downstream, setDownstream] = useState({
    name: 'Q2 Départ',
    In: 100,
    Ir: 1.0,
    Tr: 10,
    Isd: 8,
    Tsd: 0.1,
    Ii: 10,
    isMCCB: true
  });

  const handleAnalyze = () => {
    try {
      // Generate fault currents to test
      const maxFault = Math.max(upstream.In, downstream.In) * 50;
      const faultCurrents = [];
      for (let i = downstream.In; i <= maxFault; i *= 1.5) {
        faultCurrents.push(i);
      }

      const result = checkSelectivity(upstream, downstream, faultCurrents);
      setSelectivityResult(result);
      setToast({ type: result.isSelective ? 'success' : result.isPartiallySelective ? 'warning' : 'error',
        message: result.isSelective ? 'Sélectivité totale confirmée !' : result.isPartiallySelective ? 'Sélectivité partielle' : 'Problème de sélectivité détecté' });
    } catch (err) {
      setToast({ type: 'error', message: 'Erreur: ' + err.message });
    }
  };

  const exportPDF = () => {
    if (!selectivityResult) return;

    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Header
    const isOk = selectivityResult.isSelective;
    pdf.setFillColor(isOk ? 16 : 239, isOk ? 185 : 68, isOk ? 129 : 68);
    pdf.rect(0, 0, pageWidth, 45, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('SELECTIVITY ANALYSIS REPORT', 14, 25);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('IEC 60947-2 Protection Coordination', 14, 35);

    // Status badge
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(pageWidth - 55, 12, 45, 22, 3, 3, 'F');
    pdf.setTextColor(isOk ? 16 : 239, isOk ? 185 : 68, isOk ? 129 : 68);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text(isOk ? 'SÉLECTIF' : 'NON SÉLECTIF', pageWidth - 32, 26, { align: 'center' });

    // Device comparison
    let y = 60;
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('DISPOSITIFS ANALYSÉS', 14, y);

    y += 10;
    pdf.autoTable({
      startY: y,
      head: [['Position', 'Nom', 'In (A)', 'Ir', 'Isd', 'Ii', 'Tr (s)', 'Tsd (s)']],
      body: [
        ['AMONT', upstream.name, upstream.In, upstream.Ir, upstream.Isd, upstream.Ii, upstream.Tr, upstream.Tsd],
        ['AVAL', downstream.name, downstream.In, downstream.Ir, downstream.Isd, downstream.Ii, downstream.Tr, downstream.Tsd]
      ],
      theme: 'grid',
      headStyles: { fillColor: [168, 85, 247], textColor: 255 },
      styles: { fontSize: 10 }
    });

    y = pdf.lastAutoTable.finalY + 15;

    // Results
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('RÉSULTATS DE COORDINATION', 14, y);

    y += 10;
    pdf.autoTable({
      startY: y,
      head: [['Courant (A)', 't Amont (s)', 't Aval (s)', 'Marge (%)', 'Status']],
      body: selectivityResult.results.map(r => [
        r.current.toFixed(0),
        r.tUp?.toFixed(3) || '—',
        r.tDown?.toFixed(3) || '—',
        r.margin?.toFixed(1) || '—',
        r.status === 'selective' ? 'OK' : r.status === 'partial' ? 'Partiel' : 'NON'
      ]),
      theme: 'striped',
      headStyles: { fillColor: [100, 100, 100] },
      styles: { fontSize: 9 },
      columnStyles: { 4: { fontStyle: 'bold' } }
    });

    // Conclusion
    y = pdf.lastAutoTable.finalY + 15;
    pdf.setFillColor(isOk ? 240 : 254, isOk ? 253 : 242, isOk ? 244 : 242);
    pdf.rect(10, y, pageWidth - 20, 30, 'F');
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(isOk ? 16 : 185, isOk ? 185 : 28, isOk ? 129 : 28);
    pdf.text(isOk ? 'CONCLUSION: SÉLECTIVITÉ TOTALE CONFIRMÉE' : `CONCLUSION: LIMITE DE SÉLECTIVITÉ À ${selectivityResult.limitCurrent?.toFixed(0) || '?'} A`, 14, y + 18);

    // Footer
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} - ElectroHub`, 14, pageHeight - 10);
    pdf.text('Conforme IEC 60947-2', pageWidth - 50, pageHeight - 10);

    pdf.save(`selectivity_report_${new Date().toISOString().slice(0, 10)}.pdf`);
    setToast({ type: 'success', message: 'Rapport PDF exporté !' });
  };

  return (
    <section className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
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
                <p className="text-purple-100 mt-1">Coordination des protections selon IEC 60947-2</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a href="https://webstore.iec.ch/publication/3987" target="_blank" rel="noopener noreferrer"
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors">
                <Book size={18} />Norme IEC 60947
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[95vw] mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Panel - Device Settings */}
          <div className="lg:col-span-1 space-y-6">
            <AnimatedCard>
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-lg">
                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Settings size={20} className="text-purple-600" />
                  Configuration des dispositifs
                </h3>

                {/* Upstream Device Selector */}
                <SwitchboardDeviceSelector
                  label="Sélectionner disjoncteur AMONT depuis tableau"
                  onDeviceSelect={(device) => setUpstream({ ...upstream, ...device })}
                  selectedDevice={upstream}
                />

                {/* Downstream Device Selector */}
                <SwitchboardDeviceSelector
                  label="Sélectionner disjoncteur AVAL depuis tableau"
                  onDeviceSelect={(device) => setDownstream({ ...downstream, ...device })}
                  selectedDevice={downstream}
                />

                <div className="border-t border-gray-200 pt-4 mt-4">
                  <p className="text-xs text-gray-500 mb-4">Ou configurer manuellement :</p>
                </div>

                <div className="space-y-6">
                  <DeviceSettingsForm title="Disjoncteur Amont" icon={ArrowDown} color="purple" device={upstream} onChange={setUpstream} />
                  <DeviceSettingsForm title="Disjoncteur Aval" icon={ArrowRight} color="green" device={downstream} onChange={setDownstream} />
                </div>

                <button onClick={handleAnalyze}
                  className="w-full mt-6 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-lg hover:from-purple-700 hover:to-indigo-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-purple-200">
                  <GitBranch size={24} />
                  Analyser la Sélectivité
                </button>
              </div>
            </AnimatedCard>

            {/* Info Card */}
            <AnimatedCard delay={100}>
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border border-purple-100 p-6">
                <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <HelpCircle size={18} className="text-purple-600" />
                  Principe de sélectivité
                </h4>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>La sélectivité assure que seul le disjoncteur le plus proche du défaut déclenche, évitant les coupures inutiles.</p>
                  <p className="font-semibold text-purple-700">Condition: t(aval) &lt; t(amont)</p>
                  <p>Le temps de déclenchement aval doit toujours être inférieur au temps de déclenchement amont pour tout courant de défaut.</p>
                </div>
              </div>
            </AnimatedCard>
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-2 space-y-6">
            {selectivityResult ? (
              <>
                <SelectivityResultCard result={selectivityResult} upstream={upstream} downstream={downstream} onExportPDF={exportPDF} />
                <AnimatedCard delay={200}>
                  <SelectivityChart upstream={upstream} downstream={downstream} selectivityResult={selectivityResult} />
                </AnimatedCard>
              </>
            ) : (
              <AnimatedCard>
                <div className="bg-white rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
                  <div className="w-24 h-24 mx-auto mb-6 bg-purple-100 rounded-3xl flex items-center justify-center">
                    <GitBranch size={48} className="text-purple-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Analyse de Sélectivité</h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Configurez les réglages des disjoncteurs amont et aval puis cliquez sur "Analyser la Sélectivité" pour vérifier la coordination selon IEC 60947-2.
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
