// src/pages/High_voltage.jsx - Complete redesign following Switchboards pattern
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Zap, Plus, Search, ChevronRight, ChevronDown, Building2, Layers,
  MoreVertical, Copy, Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Camera, Sparkles, Shield, Upload, FileSpreadsheet, ArrowRight, ArrowLeft,
  Settings, Info, Download, RefreshCw, Eye, ImagePlus, ShieldCheck, AlertCircle,
  Menu, FileText, Printer, Share2, Link, ExternalLink, GitBranch, ArrowUpRight,
  MapPin, Database, History, Star, ClipboardCheck, Calendar, Clock, Power,
  Activity, Target, Gauge, CircleDot, Network, Box, Cable, Factory,
  Thermometer, Wind, PlugZap, Radio, Cpu, PieChart, BarChart3, TrendingUp
} from 'lucide-react';
import { api, get, post, del } from '../lib/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// ==================== CONSTANTS ====================

const REGIMES = ['TN-S', 'TN-C-S', 'IT', 'TT'];
const HV_DEVICE_TYPES = [
  'HV Circuit Breaker', 'HV Disconnect Switch', 'HV Fuse Switch',
  'Transformer', 'HV Cable', 'Busbar', 'Current Transformer',
  'Voltage Transformer', 'Surge Arrester', 'Capacitor Bank',
  'Reactor', 'Earth Switch', 'Relay', 'Meter', 'HV Cell'
];
const INSULATION_TYPES = ['Oil', 'SF6', 'Vacuum', 'Air', 'XLPE', 'EPR', 'Paper', 'Resin', 'Dry'];
const MECHANICAL_CLASSES = ['M1', 'M2'];
const ELECTRICAL_CLASSES = ['E1', 'E2', 'E3'];
const VOLTAGE_CLASSES = [6.6, 10, 11, 13.8, 15, 20, 22, 33, 36, 66, 110, 132, 220, 400];

// ==================== HELPERS ====================

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

// ==================== ANIMATION COMPONENTS ====================

const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

// Progress Ring Component
const ProgressRing = React.memo(({ progress, size = 40, strokeWidth = 4, color = '#f59e0b' }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
    </svg>
  );
});

// Toast Notification
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const config = {
    success: { bg: 'bg-emerald-500', Icon: CheckCircle },
    error: { bg: 'bg-red-500', Icon: AlertCircle },
    info: { bg: 'bg-amber-500', Icon: Info },
    warning: { bg: 'bg-orange-500', Icon: AlertTriangle }
  };
  const { bg, Icon } = config[type] || config.info;

  return (
    <div className={`fixed bottom-4 right-4 z-[200] ${bg} text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-slideUp`}>
      <Icon size={22} />
      <span className="font-medium">{message}</span>
      <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-xl transition-colors ml-2">
        <X size={16} />
      </button>
    </div>
  );
};

// Badge Component
const Badge = ({ children, variant = 'default', size = 'md', className = '' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700 border-gray-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
  };
  const sizes = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm'
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold border ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
};

// Stat Card Component
const StatCard = ({ icon: Icon, label, value, trend, color = 'amber', onClick }) => (
  <button
    onClick={onClick}
    className={`group bg-white rounded-2xl p-5 border border-gray-100 hover:border-${color}-200 hover:shadow-lg transition-all duration-300 text-left w-full`}
  >
    <div className="flex items-center justify-between mb-3">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br from-${color}-400 to-${color}-600 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
        <Icon size={22} />
      </div>
      {trend && (
        <Badge variant={trend > 0 ? 'success' : 'danger'} size="sm">
          <TrendingUp size={10} className={trend < 0 ? 'rotate-180' : ''} />
          {Math.abs(trend)}%
        </Badge>
      )}
    </div>
    <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
    <p className="text-sm text-gray-500">{label}</p>
  </button>
);

// ==================== INPUT STYLES ====================

const inputBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 transition-all";
const selectBaseClass = "w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white text-gray-900 transition-all";
const labelClass = "block text-sm font-semibold text-gray-700 mb-2";

// ==================== MODAL COMPONENTS ====================

// Base Modal
const Modal = ({ isOpen, onClose, title, subtitle, icon: Icon, color = 'amber', children, footer, size = 'md' }) => {
  if (!isOpen) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className={`bg-white rounded-3xl shadow-2xl w-full ${sizes[size]} max-h-[90vh] overflow-hidden animate-scaleIn`}>
        <div className={`bg-gradient-to-r from-${color}-500 to-${color}-600 p-6 text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {Icon && (
                <div className="p-3 bg-white/20 rounded-2xl">
                  <Icon size={28} />
                </div>
              )}
              <div>
                <h2 className="text-2xl font-bold">{title}</h2>
                {subtitle && <p className={`text-${color}-100 text-sm mt-1`}>{subtitle}</p>}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">{children}</div>
        {footer && <div className="border-t p-4 bg-gray-50">{footer}</div>}
      </div>
    </div>
  );
};

// Delete Confirm Modal
const DeleteConfirmModal = ({ isOpen, onClose, onConfirm, itemName, itemType = 'équipement', isLoading }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Confirmer la suppression" subtitle="Cette action est irréversible" icon={AlertTriangle} color="red" size="sm"
    footer={
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
        <button onClick={onConfirm} disabled={isLoading}
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-medium hover:from-red-600 hover:to-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}
          Supprimer
        </button>
      </div>
    }>
    <div className="text-center py-4">
      <div className="w-20 h-20 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
        <Trash2 size={40} className="text-red-500" />
      </div>
      <p className="text-gray-700 text-lg">
        Supprimer {itemType === 'device' ? 'le device' : "l'équipement"} <span className="font-bold text-red-600">"{itemName}"</span> ?
      </p>
      <p className="text-gray-500 text-sm mt-2">Tous les devices associés seront également supprimés.</p>
    </div>
  </Modal>
);

// Share Link Modal
const ShareLinkModal = ({ isOpen, onClose, equipment }) => {
  const [copied, setCopied] = useState(false);
  if (!isOpen || !equipment) return null;

  const url = `${window.location.origin}/app/hv?equipment=${equipment.id}`;
  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Partager le lien" subtitle={equipment.name} icon={Share2} color="amber" size="sm">
      <div className="space-y-4">
        <div className="flex gap-2">
          <input type="text" value={url} readOnly className={`${inputBaseClass} flex-1 text-sm font-mono bg-gray-50`} />
          <button onClick={handleCopy}
            className={`px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2 ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
            {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
            {copied ? 'Copié!' : 'Copier'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

// AI Photo Analysis Modal
const AIPhotoModal = ({ isOpen, onClose, onComplete, showToast }) => {
  const [photos, setPhotos] = useState([]);
  const [hints, setHints] = useState({ manufacturer: '', reference: '', device_type: '' });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) { setPhotos([]); setResult(null); setHints({ manufacturer: '', reference: '', device_type: '' }); }
  }, [isOpen]);

  const analyzePhotos = async () => {
    setIsAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append('manufacturer', hints.manufacturer || '');
      fd.append('reference', hints.reference || '');
      fd.append('device_type', hints.device_type || '');
      photos.forEach(f => fd.append('photos', f));

      const res = await fetch('/api/hv/ai/specs', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('AI analysis failed');
      const specs = await res.json();
      setResult(specs);
    } catch (err) {
      showToast?.("Erreur lors de l'analyse IA", 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUse = () => {
    if (result) onComplete(result);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Analyse IA" subtitle="Extraction automatique des spécifications" icon={Sparkles} color="purple" size="md">
      <div className="space-y-6">
        {!result ? (
          <>
            <div onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${photos.length ? 'border-purple-400 bg-purple-50' : 'border-gray-300 hover:border-purple-400'}`}>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files))} className="hidden" />
              {photos.length > 0 ? (
                <div className="space-y-3">
                  <div className="w-16 h-16 mx-auto bg-purple-100 rounded-2xl flex items-center justify-center">
                    <CheckCircle className="text-purple-500" size={32} />
                  </div>
                  <p className="font-semibold text-purple-700">{photos.length} photo(s) sélectionnée(s)</p>
                  <button onClick={e => { e.stopPropagation(); setPhotos([]); }} className="text-sm text-red-600 hover:text-red-800">Supprimer</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-16 h-16 mx-auto bg-gray-100 rounded-2xl flex items-center justify-center">
                    <Camera className="text-gray-400" size={32} />
                  </div>
                  <p className="font-semibold text-gray-700">Glissez vos photos ici</p>
                  <p className="text-sm text-gray-500">Plaque signalétique, vue d'ensemble, intérieur cellule...</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Fabricant (indice)</label>
                <input type="text" value={hints.manufacturer} onChange={e => setHints(h => ({ ...h, manufacturer: e.target.value }))} className={inputBaseClass} placeholder="Ex: ABB, Schneider..." />
              </div>
              <div>
                <label className={labelClass}>Référence (indice)</label>
                <input type="text" value={hints.reference} onChange={e => setHints(h => ({ ...h, reference: e.target.value }))} className={inputBaseClass} placeholder="Ex: HD4..." />
              </div>
              <div>
                <label className={labelClass}>Type (indice)</label>
                <select value={hints.device_type} onChange={e => setHints(h => ({ ...h, device_type: e.target.value }))} className={selectBaseClass}>
                  <option value="">Sélectionner...</option>
                  {HV_DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <button onClick={analyzePhotos} disabled={isAnalyzing}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 flex items-center justify-center gap-3">
              {isAnalyzing ? <><RefreshCw size={20} className="animate-spin" />Analyse en cours...</> : <><Sparkles size={20} />Analyser avec l'IA</>}
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl p-6">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <CheckCircle className="text-emerald-500" size={20} />
                Données extraites
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(result).filter(([k, v]) => v && typeof v !== 'object').map(([key, value]) => (
                  <div key={key} className="bg-white rounded-xl p-3 border border-gray-100">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">{key.replace(/_/g, ' ')}</span>
                    <p className="font-semibold text-gray-900 mt-1">{value}</p>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={handleUse}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold hover:from-emerald-600 hover:to-teal-700 flex items-center justify-center gap-3">
              <CheckCircle size={20} />Utiliser ces données
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

// ==================== HV EQUIPMENT FORM MODAL ====================

const HVEquipmentFormModal = ({ isOpen, onClose, equipment, onSave, showToast, site }) => {
  const [form, setForm] = useState({
    name: '', code: '', building_code: '', floor: '', room: '',
    regime_neutral: 'TN-S', is_principal: false, voltage_kv: 20,
    short_circuit_ka: 25, modes: {}, quality: {}, notes: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && equipment) {
      setForm({
        name: equipment.name || '',
        code: equipment.code || '',
        building_code: equipment.building_code || '',
        floor: equipment.floor || '',
        room: equipment.room || '',
        regime_neutral: equipment.regime_neutral || 'TN-S',
        is_principal: !!equipment.is_principal,
        voltage_kv: equipment.voltage_kv || 20,
        short_circuit_ka: equipment.short_circuit_ka || 25,
        modes: equipment.modes || {},
        quality: equipment.quality || {},
        notes: equipment.notes || ''
      });
    } else if (isOpen) {
      setForm({
        name: '', code: '', building_code: '', floor: '', room: '',
        regime_neutral: 'TN-S', is_principal: false, voltage_kv: 20,
        short_circuit_ka: 25, modes: {}, quality: {}, notes: ''
      });
    }
  }, [isOpen, equipment]);

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      showToast?.('Le nom est requis', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const payload = { ...form, site };
      if (equipment?.id) {
        await api.hv.updateEquipment(equipment.id, payload);
        showToast?.('Équipement HV mis à jour !', 'success');
      } else {
        await api.hv.createEquipment(payload);
        showToast?.('Équipement HV créé !', 'success');
      }
      onSave();
      onClose();
    } catch (err) {
      showToast?.('Erreur: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={equipment ? 'Modifier l\'équipement HV' : 'Nouvel équipement HV'}
      subtitle={equipment ? equipment.code : 'Cellule, transformateur, câble...'}
      icon={Zap} color="amber" size="lg"
      footer={
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
          <button onClick={handleSubmit} disabled={isSaving}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {equipment ? 'Mettre à jour' : 'Créer'}
          </button>
        </div>
      }>
      <div className="space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelClass}>Nom de l'équipement *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={inputBaseClass} placeholder="Ex: Cellule arrivée HTA" />
          </div>
          <div>
            <label className={labelClass}>Code</label>
            <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              className={inputBaseClass} placeholder="Ex: HV-01" />
          </div>
        </div>

        {/* Location */}
        <div className="p-4 bg-gray-50 rounded-2xl">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MapPin size={18} className="text-amber-500" />
            Localisation
          </h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Bâtiment</label>
              <input type="text" value={form.building_code} onChange={e => setForm(f => ({ ...f, building_code: e.target.value }))}
                className={inputBaseClass} placeholder="Ex: B01" />
            </div>
            <div>
              <label className={labelClass}>Étage</label>
              <input type="text" value={form.floor} onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
                className={inputBaseClass} placeholder="Ex: RDC" />
            </div>
            <div>
              <label className={labelClass}>Local</label>
              <input type="text" value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
                className={inputBaseClass} placeholder="Ex: Poste HTA" />
            </div>
          </div>
        </div>

        {/* Electrical Characteristics */}
        <div className="p-4 bg-amber-50 rounded-2xl">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Zap size={18} className="text-amber-600" />
            Caractéristiques électriques
          </h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Tension (kV)</label>
              <select value={form.voltage_kv} onChange={e => setForm(f => ({ ...f, voltage_kv: Number(e.target.value) }))} className={selectBaseClass}>
                {VOLTAGE_CLASSES.map(v => <option key={v} value={v}>{v} kV</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Icc (kA)</label>
              <input type="number" step="0.1" value={form.short_circuit_ka} onChange={e => setForm(f => ({ ...f, short_circuit_ka: Number(e.target.value) }))}
                className={inputBaseClass} placeholder="Ex: 25" />
            </div>
            <div>
              <label className={labelClass}>Régime de neutre</label>
              <select value={form.regime_neutral} onChange={e => setForm(f => ({ ...f, regime_neutral: e.target.value }))} className={selectBaseClass}>
                {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
            <input type="checkbox" checked={form.is_principal} onChange={e => setForm(f => ({ ...f, is_principal: e.target.checked }))}
              className="w-5 h-5 rounded-lg border-gray-300 text-amber-600 focus:ring-amber-500" />
            <span className="font-medium text-gray-700">Équipement principal</span>
          </label>
        </div>

        {/* Notes */}
        <div>
          <label className={labelClass}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className={`${inputBaseClass} min-h-[100px]`} placeholder="Informations complémentaires..." />
        </div>
      </div>
    </Modal>
  );
};

// ==================== HV DEVICE FORM MODAL ====================

const HVDeviceFormModal = ({ isOpen, onClose, device, equipmentId, onSave, showToast, downstreamSwitchboards = [], downstreamDevices = [] }) => {
  const [form, setForm] = useState({
    name: '', device_type: 'HV Circuit Breaker', manufacturer: '', reference: '',
    voltage_class_kv: 20, short_circuit_current_ka: 25, insulation_type: 'SF6',
    mechanical_endurance_class: 'M1', electrical_endurance_class: 'E2',
    poles: 3, is_main_incoming: false, parent_id: null,
    downstream_switchboard_id: null, downstream_device_id: null,
    settings: {}, notes: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);

  useEffect(() => {
    if (isOpen && device) {
      setForm({
        name: device.name || '',
        device_type: device.device_type || 'HV Circuit Breaker',
        manufacturer: device.manufacturer || '',
        reference: device.reference || '',
        voltage_class_kv: device.voltage_class_kv || 20,
        short_circuit_current_ka: device.short_circuit_current_ka || 25,
        insulation_type: device.insulation_type || 'SF6',
        mechanical_endurance_class: device.mechanical_endurance_class || 'M1',
        electrical_endurance_class: device.electrical_endurance_class || 'E2',
        poles: device.poles || 3,
        is_main_incoming: !!device.is_main_incoming,
        parent_id: device.parent_id || null,
        downstream_switchboard_id: device.downstream_switchboard_id || null,
        downstream_device_id: device.downstream_device_id || null,
        settings: device.settings || {},
        notes: device.notes || ''
      });
    } else if (isOpen) {
      setForm({
        name: '', device_type: 'HV Circuit Breaker', manufacturer: '', reference: '',
        voltage_class_kv: 20, short_circuit_current_ka: 25, insulation_type: 'SF6',
        mechanical_endurance_class: 'M1', electrical_endurance_class: 'E2',
        poles: 3, is_main_incoming: false, parent_id: null,
        downstream_switchboard_id: null, downstream_device_id: null,
        settings: {}, notes: ''
      });
    }
  }, [isOpen, device]);

  const handleAIComplete = (specs) => {
    setForm(f => ({
      ...f,
      ...specs,
      settings: { ...(f.settings || {}), ...(specs.settings || {}) }
    }));
  };

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      showToast?.('Le nom est requis', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const payload = { ...form };
      if (device?.id) {
        await api.hv.update(device.id, payload);
        showToast?.('Device HV mis à jour !', 'success');
      } else {
        await api.hv.create(equipmentId, payload);
        showToast?.('Device HV créé !', 'success');
      }
      onSave();
      onClose();
    } catch (err) {
      showToast?.('Erreur: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={device ? 'Modifier le device HV' : 'Nouveau device HV'}
        subtitle={device ? device.name : 'Disjoncteur, transformateur, câble...'}
        icon={CircleDot} color="orange" size="xl"
        footer={
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
            <button onClick={handleSubmit} disabled={isSaving}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-semibold hover:from-orange-600 hover:to-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
              {device ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        }>
        <div className="space-y-6">
          {/* AI Suggestion Button */}
          <button onClick={() => setShowAIModal(true)}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-100 to-indigo-100 border-2 border-dashed border-purple-300 text-purple-700 font-semibold hover:from-purple-200 hover:to-indigo-200 transition-all flex items-center justify-center gap-3">
            <Sparkles size={22} className="text-purple-500" />
            Analyser une photo avec l'IA
          </button>

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className={labelClass}>Nom du device *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={inputBaseClass} placeholder="Ex: Disjoncteur arrivée" />
            </div>
            <div>
              <label className={labelClass}>Type de device</label>
              <select value={form.device_type} onChange={e => setForm(f => ({ ...f, device_type: e.target.value }))} className={selectBaseClass}>
                {HV_DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Fabricant</label>
              <input type="text" value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                className={inputBaseClass} placeholder="Ex: ABB, Schneider..." />
            </div>
            <div>
              <label className={labelClass}>Référence</label>
              <input type="text" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                className={inputBaseClass} placeholder="Ex: HD4/GT" />
            </div>
          </div>

          {/* Electrical Specs */}
          <div className="p-4 bg-orange-50 rounded-2xl">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Zap size={18} className="text-orange-600" />
              Caractéristiques électriques
            </h4>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className={labelClass}>Tension (kV)</label>
                <input type="number" step="0.1" value={form.voltage_class_kv} onChange={e => setForm(f => ({ ...f, voltage_class_kv: Number(e.target.value) }))}
                  className={inputBaseClass} />
              </div>
              <div>
                <label className={labelClass}>Icc (kA)</label>
                <input type="number" step="0.1" value={form.short_circuit_current_ka} onChange={e => setForm(f => ({ ...f, short_circuit_current_ka: Number(e.target.value) }))}
                  className={inputBaseClass} />
              </div>
              <div>
                <label className={labelClass}>Isolation</label>
                <select value={form.insulation_type} onChange={e => setForm(f => ({ ...f, insulation_type: e.target.value }))} className={selectBaseClass}>
                  {INSULATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Pôles</label>
                <select value={form.poles} onChange={e => setForm(f => ({ ...f, poles: Number(e.target.value) }))} className={selectBaseClass}>
                  {[1, 2, 3, 4].map(p => <option key={p} value={p}>{p}P</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className={labelClass}>Endurance mécanique</label>
                <select value={form.mechanical_endurance_class} onChange={e => setForm(f => ({ ...f, mechanical_endurance_class: e.target.value }))} className={selectBaseClass}>
                  <option value="">Non spécifié</option>
                  {MECHANICAL_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Endurance électrique</label>
                <select value={form.electrical_endurance_class} onChange={e => setForm(f => ({ ...f, electrical_endurance_class: e.target.value }))} className={selectBaseClass}>
                  <option value="">Non spécifié</option>
                  {ELECTRICAL_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Downstream Connection */}
          <div className="p-4 bg-blue-50 rounded-2xl">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Network size={18} className="text-blue-600" />
              Connexion aval (BT)
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Tableau BT connecté</label>
                <select value={form.downstream_switchboard_id || ''} onChange={e => setForm(f => ({ ...f, downstream_switchboard_id: e.target.value ? Number(e.target.value) : null }))} className={selectBaseClass}>
                  <option value="">Aucun</option>
                  {downstreamSwitchboards.map(sb => (
                    <option key={sb.id} value={sb.id}>{sb.name} ({sb.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Device BT connecté</label>
                <select value={form.downstream_device_id || ''} onChange={e => setForm(f => ({ ...f, downstream_device_id: e.target.value ? Number(e.target.value) : null }))} className={selectBaseClass}>
                  <option value="">Aucun</option>
                  {downstreamDevices.map(d => (
                    <option key={d.id} value={d.id}>{d.name} - {d.switchboard_name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-sm text-blue-600 mt-2 flex items-center gap-2">
              <Info size={14} />
              La connexion aval permet les calculs de sélectivité, arc flash et Icc sur toute la chaîne.
            </p>
          </div>

          {/* Options */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
              <input type="checkbox" checked={form.is_main_incoming} onChange={e => setForm(f => ({ ...f, is_main_incoming: e.target.checked }))}
                className="w-5 h-5 rounded-lg border-gray-300 text-orange-600 focus:ring-orange-500" />
              <span className="font-medium text-gray-700">Arrivée principale</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className={labelClass}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className={`${inputBaseClass} min-h-[80px]`} placeholder="Informations complémentaires..." />
          </div>
        </div>
      </Modal>

      <AIPhotoModal isOpen={showAIModal} onClose={() => setShowAIModal(false)} onComplete={handleAIComplete} showToast={showToast} />
    </>
  );
};

// ==================== DEVICE TREE COMPONENT ====================

const DeviceTree = React.memo(({ devices, level = 0, onEdit, onDelete, downstreamInfo }) => {
  const getDeviceIcon = (type) => {
    const icons = {
      'HV Circuit Breaker': Power, 'HV Disconnect Switch': PlugZap, 'HV Fuse Switch': Shield,
      'Transformer': Factory, 'HV Cable': Cable, 'Busbar': Box, 'Current Transformer': Gauge,
      'Voltage Transformer': Activity, 'Surge Arrester': Zap, 'Capacitor Bank': Database,
      'Reactor': Wind, 'Earth Switch': Radio, 'Relay': Cpu, 'Meter': PieChart, 'HV Cell': Box
    };
    return icons[type] || CircleDot;
  };

  return (
    <div className={`space-y-2 ${level > 0 ? 'ml-8 pl-4 border-l-2 border-orange-200' : ''}`}>
      {devices.map((device, idx) => {
        const Icon = getDeviceIcon(device.device_type);
        const downstream = downstreamInfo?.[device.id];

        return (
          <AnimatedCard key={device.id} delay={idx * 50}>
            <div className={`group bg-white rounded-xl border-2 ${device.is_main_incoming ? 'border-orange-400 bg-orange-50/50' : 'border-gray-100'} p-4 hover:shadow-lg hover:border-orange-300 transition-all`}>
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${device.is_main_incoming ? 'bg-gradient-to-br from-orange-400 to-red-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                  <Icon size={24} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="font-bold text-gray-900 truncate">{device.name || `${device.manufacturer} ${device.reference}`}</h4>
                    <Badge variant="orange" size="sm">{device.device_type}</Badge>
                    {device.is_main_incoming && <Badge variant="danger" size="sm"><Star size={10} />Principal</Badge>}
                  </div>

                  <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                    {device.manufacturer && <span className="flex items-center gap-1"><Factory size={12} />{device.manufacturer}</span>}
                    {device.reference && <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{device.reference}</span>}
                    <span className="flex items-center gap-1"><Zap size={12} />{device.voltage_class_kv || '?'} kV</span>
                    <span className="flex items-center gap-1"><Activity size={12} />{device.short_circuit_current_ka || '?'} kA</span>
                    {device.insulation_type && <span className="flex items-center gap-1"><Shield size={12} />{device.insulation_type}</span>}
                  </div>

                  {/* Downstream connection info */}
                  {downstream && (
                    <div className="mt-2 flex items-center gap-2">
                      <ArrowRight size={14} className="text-blue-500" />
                      <Badge variant="info" size="sm">
                        <Zap size={10} />
                        Connecté à: {downstream.switchboard_name || downstream.device_name}
                      </Badge>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onEdit(device)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl" title="Modifier">
                    <Edit3 size={18} />
                  </button>
                  <button onClick={() => onDelete(device)} className="p-2 text-red-600 hover:bg-red-50 rounded-xl" title="Supprimer">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {device.children?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <DeviceTree devices={device.children} level={level + 1} onEdit={onEdit} onDelete={onDelete} downstreamInfo={downstreamInfo} />
                </div>
              )}
            </div>
          </AnimatedCard>
        );
      })}
    </div>
  );
});

// ==================== EQUIPMENT CARD COMPONENT ====================

const EquipmentCard = React.memo(({ equipment, isExpanded, onToggle, onEdit, onDelete, onShare, onAddDevice, devices, onEditDevice, onDeleteDevice, downstreamInfo, isPlaced, controlStatus, onNavigateToMap, onNavigateToControls }) => {
  const deviceCount = equipment.devices_count || devices?.length || 0;
  const progress = Math.min(100, (deviceCount / 10) * 100);

  return (
    <AnimatedCard className="mb-4">
      <div className={`bg-white rounded-2xl border-2 ${controlStatus?.status === 'overdue' ? 'border-red-400' : equipment.is_principal ? 'border-amber-400' : 'border-gray-100'} overflow-hidden hover:shadow-xl transition-all duration-300`}>
        {/* Header */}
        <div className={`p-5 ${equipment.is_principal ? 'bg-gradient-to-r from-amber-50 to-orange-50' : ''}`}>
          <div className="flex items-center gap-4">
            <button onClick={onToggle} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              {isExpanded ? <ChevronDown size={24} className="text-amber-600" /> : <ChevronRight size={24} className="text-gray-400" />}
            </button>

            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${equipment.is_principal ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg' : 'bg-amber-100 text-amber-600'}`}>
              <Zap size={28} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xl font-bold text-gray-900 truncate">{equipment.name}</h3>
                {equipment.code && <Badge variant="default" size="md">{equipment.code}</Badge>}
                {equipment.is_principal && <Badge variant="warning" size="sm"><Star size={10} />Principal</Badge>}
                {/* Placement badge */}
                {isPlaced ? (
                  <Badge variant="success" size="sm" className="cursor-pointer" onClick={() => onNavigateToMap?.(equipment)}>
                    <MapPin size={10} />Localisé
                  </Badge>
                ) : (
                  <Badge variant="default" size="sm" className="cursor-pointer" onClick={() => onNavigateToMap?.(equipment)}>
                    <MapPin size={10} />Non localisé
                  </Badge>
                )}
                {/* Control status badge */}
                {controlStatus?.overdueCount > 0 && (
                  <Badge variant="danger" size="sm" className="cursor-pointer" onClick={() => onNavigateToControls?.(equipment)}>
                    <AlertTriangle size={10} />{controlStatus.overdueCount} en retard
                  </Badge>
                )}
                {controlStatus?.pendingCount > 0 && controlStatus?.overdueCount === 0 && (
                  <Badge variant="info" size="sm" className="cursor-pointer" onClick={() => onNavigateToControls?.(equipment)}>
                    <Clock size={10} />{controlStatus.pendingCount} à venir
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500 mt-1 flex-wrap">
                <span className="flex items-center gap-1"><MapPin size={14} />{equipment.building_code || '—'} / {equipment.floor || '—'} / {equipment.room || '—'}</span>
                <span className="flex items-center gap-1"><Shield size={14} />{equipment.regime_neutral}</span>
                <span className="flex items-center gap-1"><Zap size={14} />{equipment.voltage_kv || 20} kV</span>
                <span className="flex items-center gap-1"><Activity size={14} />{equipment.short_circuit_ka || '?'} kA</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-3">
                <ProgressRing progress={progress} size={48} strokeWidth={4} />
                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">{deviceCount}</p>
                  <p className="text-xs text-gray-500">devices</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button onClick={() => onNavigateToMap?.(equipment)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-emerald-600" title="Voir sur le plan">
                  <MapPin size={18} />
                </button>
                <button onClick={() => onNavigateToControls?.(equipment)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-blue-600" title="Contrôles">
                  <ClipboardCheck size={18} />
                </button>
                <button onClick={() => onShare(equipment)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-amber-600" title="Partager">
                  <Share2 size={18} />
                </button>
                <button onClick={() => onEdit(equipment)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-blue-600" title="Modifier">
                  <Edit3 size={18} />
                </button>
                <button onClick={() => onDelete(equipment)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-red-600" title="Supprimer">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="border-t border-gray-100 p-5 bg-gray-50/50">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                <CircleDot size={18} className="text-orange-500" />
                Devices ({deviceCount})
              </h4>
              <button onClick={onAddDevice}
                className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-red-600 transition-all flex items-center gap-2 shadow-lg shadow-orange-200">
                <Plus size={18} />
                Ajouter un device
              </button>
            </div>

            {devices?.length > 0 ? (
              <DeviceTree devices={devices} onEdit={onEditDevice} onDelete={onDeleteDevice} downstreamInfo={downstreamInfo} />
            ) : (
              <div className="text-center py-12 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-2xl flex items-center justify-center">
                  <CircleDot size={32} className="text-gray-400" />
                </div>
                <p className="text-gray-500 font-medium">Aucun device</p>
                <p className="text-sm text-gray-400 mt-1">Ajoutez des disjoncteurs, transformateurs, câbles...</p>
              </div>
            )}
          </div>
        )}
      </div>
    </AnimatedCard>
  );
});

// ==================== MAIN COMPONENT ====================

export default function HighVoltage() {
  const site = useUserSite();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Data state
  const [equipments, setEquipments] = useState([]);
  const [devices, setDevices] = useState({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [switchboards, setSwitchboards] = useState([]);
  const [lvDevices, setLvDevices] = useState([]);

  // Placement state
  const [placedIds, setPlacedIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({});

  // Control status state
  const [controlStatuses, setControlStatuses] = useState({});
  const [upcomingControls, setUpcomingControls] = useState([]);
  const [showUpcomingPanel, setShowUpcomingPanel] = useState(false);

  // UI state
  const [expanded, setExpanded] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [toast, setToast] = useState(null);

  // Filters
  const [q, setQ] = useState({ q: '', building: '', floor: '', room: '', sort: 'created_at', dir: 'desc', page: 1 });

  // Modals
  const [equipmentModal, setEquipmentModal] = useState({ open: false, data: null });
  const [deviceModal, setDeviceModal] = useState({ open: false, data: null, equipmentId: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, item: null, type: null });
  const [shareModal, setShareModal] = useState({ open: false, equipment: null });

  // Stats
  const stats = useMemo(() => {
    const totalDevices = Object.values(devices).flat().length;
    const principalCount = equipments.filter(e => e.is_principal).length;
    const withTransformers = Object.values(devices).flat().filter(d => d.device_type === 'Transformer').length;
    const placedCount = equipments.filter(e => placedIds.has(e.id)).length;
    const unplacedCount = equipments.length - placedCount;
    const overdueCount = upcomingControls.filter(c => c.isOverdue).length;
    return { totalDevices, principalCount, withTransformers, equipmentCount: equipments.length, placedCount, unplacedCount, overdueCount };
  }, [equipments, devices, placedIds, upcomingControls]);

  // Load equipments
  const loadEquipments = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.hv.list(q);
      setEquipments(resp?.data || []);
      setTotal(resp?.total || 0);
    } catch (err) {
      setToast({ type: 'error', message: 'Erreur lors du chargement: ' + err.message });
    } finally {
      setLoading(false);
    }
  }, [q]);

  // Load placements
  const loadPlacements = useCallback(async () => {
    try {
      const response = await api.hvMaps.placedIds();
      const ids = (response?.placed_ids || response?.ids || []).map(Number);
      setPlacedIds(new Set(ids));
      setPlacedDetails(response?.placed_details || {});
    } catch (e) {
      console.error('Load placements error:', e);
    }
  }, []);

  // Load control statuses for HV equipments
  const loadControlStatuses = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules({ equipment_type: 'hv' });
      const schedules = res?.schedules || [];
      const statuses = {};
      const upcoming30Days = [];
      const now = new Date();
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      schedules.forEach(s => {
        if (s.hv_equipment_id) {
          const nextDue = s.next_due_date ? new Date(s.next_due_date) : null;
          const isOverdue = nextDue && nextDue < now;
          const isUpcoming = nextDue && !isOverdue && nextDue <= in30Days;

          if (nextDue && (isOverdue || isUpcoming)) {
            upcoming30Days.push({
              ...s,
              isOverdue,
              daysUntil: isOverdue
                ? -Math.ceil((now - nextDue) / (1000 * 60 * 60 * 24))
                : Math.ceil((nextDue - now) / (1000 * 60 * 60 * 24))
            });
          }

          if (!statuses[s.hv_equipment_id]) {
            statuses[s.hv_equipment_id] = {
              status: 'ok',
              controls: [],
              overdueCount: 0,
              pendingCount: 0
            };
          }

          statuses[s.hv_equipment_id].controls.push({
            template_name: s.template_name,
            next_due: s.next_due_date,
            status: isOverdue ? 'overdue' : 'pending',
            schedule_id: s.id
          });

          if (isOverdue) {
            statuses[s.hv_equipment_id].overdueCount++;
            statuses[s.hv_equipment_id].status = 'overdue';
          } else if (nextDue) {
            statuses[s.hv_equipment_id].pendingCount++;
            if (statuses[s.hv_equipment_id].status !== 'overdue') {
              statuses[s.hv_equipment_id].status = 'pending';
            }
          }
        }
      });

      upcoming30Days.sort((a, b) => new Date(a.next_due_date || 0) - new Date(b.next_due_date || 0));
      setUpcomingControls(upcoming30Days);
      setControlStatuses(statuses);
    } catch (e) {
      console.error('Load control statuses error:', e);
    }
  }, []);

  // Load devices for an equipment
  const loadDevices = useCallback(async (equipmentId) => {
    try {
      const data = await get(`/api/hv/equipments/${equipmentId}/devices`);
      // Build tree structure
      const flat = data || [];
      const byId = new Map();
      flat.forEach(d => byId.set(d.id, { ...d, children: [] }));
      const roots = [];
      flat.forEach(d => {
        const node = byId.get(d.id);
        if (d.parent_id && byId.has(d.parent_id)) {
          byId.get(d.parent_id).children.push(node);
        } else {
          roots.push(node);
        }
      });
      setDevices(prev => ({ ...prev, [equipmentId]: roots }));
    } catch (err) {
      console.error('Failed to load devices', err);
    }
  }, []);

  // Load switchboards for downstream connection
  const loadSwitchboards = useCallback(async () => {
    try {
      const resp = await get('/api/switchboard/boards', { pageSize: 1000 });
      setSwitchboards(resp?.data || []);
    } catch (err) {
      console.error('Failed to load switchboards', err);
    }
  }, []);

  // Load LV devices for downstream connection
  const loadLvDevices = useCallback(async () => {
    try {
      const resp = await get('/api/hv/lv-devices', { q: '' });
      setLvDevices(resp || []);
    } catch (err) {
      console.error('Failed to load LV devices', err);
    }
  }, []);

  // Navigate to map with equipment
  const handleNavigateToMap = useCallback((equipment) => {
    const eqId = equipment?.id;
    if (!eqId) {
      navigate('/app/hv/map');
      return;
    }
    const details = placedDetails[eqId];
    if (details?.plans?.length > 0) {
      const planKey = details.plans[0];
      navigate(`/app/hv/map?hv=${eqId}&plan=${encodeURIComponent(planKey)}`);
    } else {
      navigate('/app/hv/map');
    }
  }, [navigate, placedDetails]);

  useEffect(() => {
    loadEquipments();
    loadSwitchboards();
    loadLvDevices();
    loadPlacements();
    loadControlStatuses();
  }, [loadEquipments, loadSwitchboards, loadLvDevices, loadPlacements, loadControlStatuses]);

  // Load devices when expanded
  useEffect(() => {
    Object.keys(expanded).forEach(id => {
      if (expanded[id] && !devices[id]) {
        loadDevices(Number(id));
      }
    });
  }, [expanded, devices, loadDevices]);

  // Handle equipment from URL
  useEffect(() => {
    const eqId = searchParams.get('equipment');
    if (eqId) {
      setExpanded(prev => ({ ...prev, [eqId]: true }));
    }
  }, [searchParams]);

  // Handlers
  const handleToggleExpand = (id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDeleteEquipment = async () => {
    if (!deleteModal.item) return;
    try {
      await del(`/api/hv/equipments/${deleteModal.item.id}`);
      setToast({ type: 'success', message: 'Équipement supprimé !' });
      loadEquipments();
    } catch (err) {
      setToast({ type: 'error', message: 'Erreur: ' + err.message });
    } finally {
      setDeleteModal({ open: false, item: null, type: null });
    }
  };

  const handleDeleteDevice = async () => {
    if (!deleteModal.item) return;
    try {
      await del(`/api/hv/devices/${deleteModal.item.id}`);
      setToast({ type: 'success', message: 'Device supprimé !' });
      // Reload devices for the parent equipment
      const equipmentId = deleteModal.item.hv_equipment_id;
      if (equipmentId) {
        loadDevices(equipmentId);
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Erreur: ' + err.message });
    } finally {
      setDeleteModal({ open: false, item: null, type: null });
    }
  };

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Export PDF
  const exportPDF = async () => {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Header
    pdf.setFillColor(245, 158, 11);
    pdf.rect(0, 0, pageWidth, 40, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(24);
    pdf.text('High Voltage Equipment Report', 14, 25);
    pdf.setFontSize(10);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 14, 35);

    // Stats
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(12);
    let y = 55;
    pdf.text(`Total Equipments: ${stats.equipmentCount}`, 14, y);
    pdf.text(`Total Devices: ${stats.totalDevices}`, 80, y);
    pdf.text(`Principal: ${stats.principalCount}`, 140, y);

    y += 15;

    // Equipment list
    equipments.forEach((eq, idx) => {
      if (y > 270) {
        pdf.addPage();
        y = 20;
      }

      pdf.setFillColor(254, 243, 199);
      pdf.rect(10, y - 5, pageWidth - 20, 25, 'F');
      pdf.setFontSize(14);
      pdf.setTextColor(146, 64, 14);
      pdf.text(`${eq.name} (${eq.code || 'N/A'})`, 14, y + 5);
      pdf.setFontSize(10);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${eq.building_code || '—'} / ${eq.floor || '—'} / ${eq.room || '—'} | ${eq.voltage_kv || 20}kV | ${eq.regime_neutral}`, 14, y + 15);

      y += 35;

      // Devices
      const eqDevices = devices[eq.id] || [];
      if (eqDevices.length > 0) {
        pdf.autoTable({
          startY: y,
          head: [['Device', 'Type', 'Fabricant', 'Tension', 'Icc', 'Isolation']],
          body: eqDevices.map(d => [
            d.name || '—',
            d.device_type || '—',
            d.manufacturer || '—',
            `${d.voltage_class_kv || '?'} kV`,
            `${d.short_circuit_current_ka || '?'} kA`,
            d.insulation_type || '—'
          ]),
          theme: 'striped',
          headStyles: { fillColor: [245, 158, 11] },
          margin: { left: 14 },
        });
        y = pdf.lastAutoTable.finalY + 15;
      }
    });

    pdf.save('hv_equipment_report.pdf');
    setToast({ type: 'success', message: 'PDF exporté !' });
  };

  return (
    <section className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50">
      {/* CSS Animations */}
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out; }
        .animate-pulse { animation: pulse 2s infinite; }
      `}</style>

      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white">
        <div className="max-w-[95vw] mx-auto px-4 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-white/20 rounded-2xl">
                  <Zap size={32} />
                </div>
                <div>
                  <h1 className="text-3xl lg:text-4xl font-bold">High Voltage Equipment</h1>
                  <p className="text-amber-100 mt-1">Cellules HTA, transformateurs, câbles et équipements haute tension</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => navigate('/app/hv/map')}
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors">
                <MapPin size={18} />
                Plans
              </button>
              <button onClick={() => setShowUpcomingPanel(!showUpcomingPanel)}
                className={`px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors ${stats.overdueCount > 0 ? 'bg-red-500/80 hover:bg-red-500' : 'bg-white/20 hover:bg-white/30'}`}>
                <ClipboardCheck size={18} />
                Contrôles
                {stats.overdueCount > 0 && (
                  <span className="px-2 py-0.5 bg-white text-red-600 rounded-full text-xs font-bold">{stats.overdueCount}</span>
                )}
              </button>
              <button onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors">
                <Search size={18} />
                Filtres
              </button>
              <button onClick={exportPDF}
                className="px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium flex items-center gap-2 transition-colors">
                <Download size={18} />
                Export PDF
              </button>
              <button onClick={() => setEquipmentModal({ open: true, data: null })}
                className="px-5 py-2.5 bg-white text-amber-600 rounded-xl font-semibold flex items-center gap-2 hover:bg-amber-50 transition-colors shadow-lg">
                <Plus size={20} />
                Nouvel équipement
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-[95vw] mx-auto px-4 -mt-6 relative z-10">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <StatCard icon={Zap} label="Équipements HV" value={stats.equipmentCount} color="amber" />
          <StatCard icon={CircleDot} label="Devices totaux" value={stats.totalDevices} color="orange" />
          <StatCard icon={MapPin} label="Localisés" value={stats.placedCount} color="emerald" onClick={() => navigate('/app/hv/map')} />
          <StatCard icon={Target} label="Non localisés" value={stats.unplacedCount} color="gray" />
          <StatCard icon={ClipboardCheck} label="Contrôles à venir" value={upcomingControls.length} color="blue" onClick={() => setShowUpcomingPanel(true)} />
          <StatCard icon={AlertTriangle} label="En retard" value={stats.overdueCount} color="red" onClick={() => navigate('/app/switchboard-controls?tab=overdue&equipment_type=hv')} />
        </div>
      </div>

      {/* Upcoming Controls Panel */}
      {showUpcomingPanel && (
        <div className="max-w-[95vw] mx-auto px-4 mt-6">
          <AnimatedCard>
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ClipboardCheck size={24} />
                  <div>
                    <h3 className="font-bold">Contrôles à venir</h3>
                    <p className="text-blue-100 text-sm">{upcomingControls.length} contrôle(s) dans les 30 prochains jours</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate('/app/switchboard-controls?equipment_type=hv')}
                    className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    Voir tout
                    <ArrowRight size={14} />
                  </button>
                  <button onClick={() => setShowUpcomingPanel(false)} className="p-1.5 hover:bg-white/20 rounded-lg">
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div className="p-4 max-h-[300px] overflow-y-auto">
                {upcomingControls.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ClipboardCheck size={40} className="mx-auto mb-2 text-gray-300" />
                    <p>Aucun contrôle planifié</p>
                    <button
                      onClick={() => navigate('/app/switchboard-controls?tab=schedules&equipment_type=hv')}
                      className="mt-3 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200"
                    >
                      Planifier un contrôle
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {upcomingControls.map((ctrl, idx) => (
                      <div
                        key={ctrl.id || idx}
                        className={`p-3 rounded-xl border-2 flex items-center justify-between ${ctrl.isOverdue ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${ctrl.isOverdue ? 'bg-red-500 text-white' : 'bg-blue-100 text-blue-600'}`}>
                            {ctrl.isOverdue ? <AlertTriangle size={20} /> : <Calendar size={20} />}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{ctrl.template_name || 'Contrôle'}</p>
                            <p className="text-sm text-gray-500">{ctrl.equipment_name || ctrl.hv_equipment_name || `Équipement #${ctrl.hv_equipment_id}`}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant={ctrl.isOverdue ? 'danger' : ctrl.daysUntil <= 7 ? 'warning' : 'info'}>
                            {ctrl.isOverdue ? `${Math.abs(ctrl.daysUntil)}j de retard` : `Dans ${ctrl.daysUntil}j`}
                          </Badge>
                          <p className="text-xs text-gray-400 mt-1">
                            {ctrl.next_due_date ? new Date(ctrl.next_due_date).toLocaleDateString('fr-FR') : '—'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </AnimatedCard>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div className="max-w-[95vw] mx-auto px-4 mt-6">
          <AnimatedCard>
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-2">
                  <label className={labelClass}>Recherche</label>
                  <div className="relative">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={q.q} onChange={e => setQ(prev => ({ ...prev, q: e.target.value, page: 1 }))}
                      className={`${inputBaseClass} pl-12`} placeholder="Nom, code..." />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Bâtiment</label>
                  <input type="text" value={q.building} onChange={e => setQ(prev => ({ ...prev, building: e.target.value, page: 1 }))}
                    className={inputBaseClass} placeholder="Ex: B01" />
                </div>
                <div>
                  <label className={labelClass}>Étage</label>
                  <input type="text" value={q.floor} onChange={e => setQ(prev => ({ ...prev, floor: e.target.value, page: 1 }))}
                    className={inputBaseClass} placeholder="Ex: RDC" />
                </div>
                <div>
                  <label className={labelClass}>Local</label>
                  <input type="text" value={q.room} onChange={e => setQ(prev => ({ ...prev, room: e.target.value, page: 1 }))}
                    className={inputBaseClass} placeholder="Ex: Poste HTA" />
                </div>
              </div>
            </div>
          </AnimatedCard>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-[95vw] mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <RefreshCw size={48} className="mx-auto text-amber-500 animate-spin mb-4" />
              <p className="text-gray-500 font-medium">Chargement des équipements...</p>
            </div>
          </div>
        ) : equipments.length === 0 ? (
          <AnimatedCard>
            <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-200">
              <div className="w-24 h-24 mx-auto mb-6 bg-amber-100 rounded-3xl flex items-center justify-center">
                <Zap size={48} className="text-amber-500" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Aucun équipement HV</h3>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">Commencez par créer votre premier équipement haute tension : cellule, transformateur, câble...</p>
              <button onClick={() => setEquipmentModal({ open: true, data: null })}
                className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-700 transition-all flex items-center gap-2 mx-auto shadow-lg">
                <Plus size={20} />
                Créer mon premier équipement
              </button>
            </div>
          </AnimatedCard>
        ) : (
          <div className="space-y-4">
            {equipments.map(equipment => (
              <EquipmentCard
                key={equipment.id}
                equipment={equipment}
                isExpanded={expanded[equipment.id]}
                onToggle={() => handleToggleExpand(equipment.id)}
                onEdit={() => setEquipmentModal({ open: true, data: equipment })}
                onDelete={() => setDeleteModal({ open: true, item: equipment, type: 'equipment' })}
                onShare={() => setShareModal({ open: true, equipment })}
                onAddDevice={() => setDeviceModal({ open: true, data: null, equipmentId: equipment.id })}
                devices={devices[equipment.id] || []}
                onEditDevice={(device) => setDeviceModal({ open: true, data: device, equipmentId: equipment.id })}
                onDeleteDevice={(device) => setDeleteModal({ open: true, item: { ...device, hv_equipment_id: equipment.id }, type: 'device' })}
                downstreamInfo={{}}
                isPlaced={placedIds.has(equipment.id)}
                controlStatus={controlStatuses[equipment.id]}
                onNavigateToMap={handleNavigateToMap}
                onNavigateToControls={(eq) => navigate(`/app/switchboard-controls?tab=schedules&equipment_type=hv&hv_equipment_id=${eq.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <HVEquipmentFormModal
        isOpen={equipmentModal.open}
        onClose={() => setEquipmentModal({ open: false, data: null })}
        equipment={equipmentModal.data}
        onSave={loadEquipments}
        showToast={showToast}
        site={site}
      />

      <HVDeviceFormModal
        isOpen={deviceModal.open}
        onClose={() => setDeviceModal({ open: false, data: null, equipmentId: null })}
        device={deviceModal.data}
        equipmentId={deviceModal.equipmentId}
        onSave={() => {
          if (deviceModal.equipmentId) loadDevices(deviceModal.equipmentId);
          loadEquipments();
        }}
        showToast={showToast}
        downstreamSwitchboards={switchboards}
        downstreamDevices={lvDevices}
      />

      <DeleteConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, item: null, type: null })}
        onConfirm={deleteModal.type === 'equipment' ? handleDeleteEquipment : handleDeleteDevice}
        itemName={deleteModal.item?.name || deleteModal.item?.code}
        itemType={deleteModal.type}
        isLoading={false}
      />

      <ShareLinkModal
        isOpen={shareModal.open}
        onClose={() => setShareModal({ open: false, equipment: null })}
        equipment={shareModal.equipment}
      />

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </section>
  );
}
