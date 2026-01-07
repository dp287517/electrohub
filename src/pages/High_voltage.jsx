// src/pages/High_voltage.jsx - Redesigned following VSD/MobileEquipments pattern with sidebar tree + detail panel
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
  Thermometer, Wind, PlugZap, Radio, Cpu, FolderPlus, Folder, ChevronUp
} from 'lucide-react';
import { api, get, post, del } from '../lib/api';
import { EquipmentAIChat } from '../components/AIAvatar';
import MiniElectro from '../components/MiniElectro';
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

// ==================== ANIMATION & UI COMPONENTS ====================

const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

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

const Badge = ({ children, variant = 'default', size = 'md', className = '' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    orange: 'bg-orange-100 text-orange-700',
  };
  const sizes = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm'
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
};

// ==================== INPUT STYLES ====================

const inputBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 transition-all";
const selectBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white text-gray-900 transition-all";
const labelClass = "block text-sm font-medium text-gray-700 mb-1.5";

// ==================== MODAL COMPONENTS ====================

const DeleteConfirmModal = ({ isOpen, onClose, onConfirm, itemName, itemType = 'équipement', isLoading }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
        <div className="bg-gradient-to-r from-red-500 to-rose-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Confirmer la suppression</h2>
              <p className="text-red-100 text-sm">Cette action est irréversible</p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <p className="text-gray-700">
            Supprimer {itemType === 'device' ? 'le device' : "l'équipement"} <span className="font-semibold">"{itemName}"</span> ?
          </p>
        </div>
        <div className="border-t p-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
          <button onClick={onConfirm} disabled={isLoading}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-medium hover:from-red-600 hover:to-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
};

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Partager le lien</h2>
              <p className="text-amber-100 text-sm">{equipment.name}</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <input type="text" value={url} readOnly className={`${inputBaseClass} flex-1 text-sm font-mono bg-gray-50`} />
            <button onClick={handleCopy}
              className={`px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2 ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
              {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
              {copied ? 'Copié!' : 'Copier'}
            </button>
          </div>
        </div>
        <div className="border-t p-4">
          <button onClick={onClose} className="w-full py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Fermer</button>
        </div>
      </div>
    </div>
  );
};

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="sticky top-0 bg-gradient-to-r from-purple-500 to-indigo-600 p-6 text-white z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Sparkles size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Analyse IA</h2>
                <p className="text-purple-100 text-sm">Extraction automatique des specs</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {!result ? (
            <>
              <div onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${photos.length ? 'border-purple-400 bg-purple-50' : 'border-gray-300 hover:border-purple-400'}`}>
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files))} className="hidden" />
                {photos.length > 0 ? (
                  <div className="space-y-3">
                    <CheckCircle className="mx-auto text-purple-500" size={40} />
                    <p className="font-semibold text-purple-700">{photos.length} photo(s) sélectionnée(s)</p>
                    <button onClick={e => { e.stopPropagation(); setPhotos([]); }} className="text-sm text-red-600 hover:text-red-800">Supprimer</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Camera className="mx-auto text-gray-400" size={40} />
                    <p className="font-semibold text-gray-700">Glissez vos photos ici</p>
                    <p className="text-sm text-gray-500">Plaque signalétique, vue d'ensemble...</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Fabricant</label>
                  <input type="text" value={hints.manufacturer} onChange={e => setHints(h => ({ ...h, manufacturer: e.target.value }))} className={inputBaseClass} placeholder="Ex: ABB" />
                </div>
                <div>
                  <label className={labelClass}>Référence</label>
                  <input type="text" value={hints.reference} onChange={e => setHints(h => ({ ...h, reference: e.target.value }))} className={inputBaseClass} placeholder="Ex: HD4" />
                </div>
                <div>
                  <label className={labelClass}>Type</label>
                  <select value={hints.device_type} onChange={e => setHints(h => ({ ...h, device_type: e.target.value }))} className={selectBaseClass}>
                    <option value="">Sélectionner...</option>
                    {HV_DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <button onClick={analyzePhotos} disabled={isAnalyzing}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-3">
                {isAnalyzing ? <><RefreshCw size={20} className="animate-spin" />Analyse en cours...</> : <><Sparkles size={20} />Analyser</>}
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
                className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold flex items-center justify-center gap-3">
                <CheckCircle size={20} />Utiliser ces données
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== MOBILE TREE DRAWER ====================

const MobileTreeDrawer = React.memo(({ isOpen, onClose, tree, expandedBuildings, setExpandedBuildings, selectedEquipment, onSelectEquipment, placedIds }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl animate-slideRight overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-gradient-to-r from-amber-500 to-orange-600 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Équipements HV</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)).map(([building, equipments]) => (
              <div key={building}>
                <button
                  onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Building2 size={16} className="text-amber-500" />
                  <span className="font-medium truncate flex-1">{building}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {equipments.length}
                  </span>
                </button>

                {expandedBuildings[building] && (
                  <div className="ml-4 space-y-1 mt-1">
                    {equipments.map(eq => (
                      <button
                        key={eq.id}
                        onClick={() => { onSelectEquipment(eq); onClose(); }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-lg
                          ${selectedEquipment?.id === eq.id ? 'bg-amber-100 text-amber-700' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        {eq.has_photo ? (
                          <img
                            src={api.hv.equipmentPhotoUrl(eq.id, { bust: false })}
                            alt=""
                            className="w-6 h-6 rounded-lg object-cover flex-shrink-0"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <Zap size={14} className="text-amber-500 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{eq.name || 'Équipement'}</p>
                          <p className="text-xs text-gray-400 truncate">{eq.voltage_kv || 20}kV • {eq.regime_neutral}</p>
                        </div>
                        {!placedIds.has(eq.id) && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[9px] rounded-full flex items-center gap-0.5">
                            <MapPin size={8} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

// ==================== EDIT FORM ====================

const EditForm = ({ equipment, onSave, onCancel, showToast, site, switchboards, lvDevices, onPhotoUpdated }) => {
  const isNew = !equipment?.id;
  const [form, setForm] = useState({
    name: '', code: '', building_code: '', floor: '', room: '',
    regime_neutral: 'TN-S', is_principal: false, notes: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(Date.now());
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !equipment?.id) return;

    setIsUploadingPhoto(true);
    try {
      await api.hv.uploadEquipmentPhoto(equipment.id, file);
      setPhotoVersion(Date.now());
      onPhotoUpdated?.({ ...equipment, has_photo: true });
      showToast?.('Photo uploadée !', 'success');
    } catch (err) {
      console.error('Photo upload error:', err);
      showToast?.('Erreur lors de l\'upload', 'error');
    } finally {
      setIsUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handlePhotoDelete = async () => {
    if (!equipment?.id || !equipment?.has_photo) return;

    try {
      await api.hv.deleteEquipmentPhoto(equipment.id);
      setPhotoVersion(Date.now());
      onPhotoUpdated?.({ ...equipment, has_photo: false });
      showToast?.('Photo supprimée', 'success');
    } catch (err) {
      console.error('Photo delete error:', err);
      showToast?.('Erreur lors de la suppression', 'error');
    }
  };

  useEffect(() => {
    if (equipment?.id) {
      setForm({
        name: equipment.name || '',
        code: equipment.code || '',
        building_code: equipment.building_code || '',
        floor: equipment.floor || '',
        room: equipment.room || '',
        regime_neutral: equipment.regime_neutral || 'TN-S',
        is_principal: !!equipment.is_principal,
        notes: equipment.notes || ''
      });
    }
  }, [equipment]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!form.name?.trim()) {
      showToast?.('Le nom est requis', 'error');
      return;
    }
    if (!form.code?.trim()) {
      showToast?.('Le code est requis', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await onSave({ ...form, site });
    } catch (err) {
      // Error handled by parent
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-4 md:p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              {isNew ? <Plus size={24} /> : <Edit3 size={24} />}
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-bold">{isNew ? 'Nouvel équipement HV' : 'Modifier l\'équipement'}</h2>
              <p className="text-amber-100 text-sm">{equipment?.code || 'Cellule, transformateur...'}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-xl md:hidden">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 lg:col-span-1">
            <label className={labelClass}>Nom de l'équipement *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={inputBaseClass} placeholder="Ex: Cellule arrivée HTA" />
          </div>
          <div>
            <label className={labelClass}>Code *</label>
            <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              className={inputBaseClass} placeholder="Ex: HV-01" />
          </div>
        </div>

        {/* Profile Photo - only for existing equipment */}
        {!isNew && (
          <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-100">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Camera size={18} className="text-amber-600" />
              Photo de profil
            </h4>
            <div className="flex items-center gap-4">
              {/* Photo preview */}
              <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-100 border-2 border-amber-200 flex-shrink-0">
                {equipment?.has_photo ? (
                  <img
                    src={`${api.hv.equipmentPhotoUrl(equipment.id, { bust: false })}&v=${photoVersion}`}
                    alt="Photo équipement"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className={`absolute inset-0 flex flex-col items-center justify-center text-gray-400 ${equipment?.has_photo ? 'hidden' : ''}`}
                  style={{ display: equipment?.has_photo ? 'none' : 'flex' }}
                >
                  <Camera size={32} className="mb-1" />
                  <span className="text-xs">Aucune photo</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={isUploadingPhoto}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50 transition-colors text-sm font-medium"
                >
                  {isUploadingPhoto ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  {equipment?.has_photo ? 'Changer' : 'Ajouter'}
                </button>
                {equipment?.has_photo && (
                  <button
                    type="button"
                    onClick={handlePhotoDelete}
                    className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-xl transition-colors text-sm font-medium"
                  >
                    <Trash2 size={16} />
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Location */}
        <div className="p-4 bg-gray-50 rounded-2xl">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MapPin size={18} className="text-amber-500" />
            Localisation
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </form>

      {/* Actions */}
      <div className="border-t p-4 flex gap-3 bg-white">
        <button type="button" onClick={onCancel} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
          Annuler
        </button>
        <button onClick={handleSubmit} disabled={isSaving}
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
          {isNew ? 'Créer' : 'Mettre à jour'}
        </button>
      </div>
    </div>
  );
};

// ==================== DEVICE FORM MODAL ====================

const DeviceFormModal = ({ isOpen, onClose, device, equipmentId, onSave, showToast, downstreamSwitchboards = [], downstreamDevices = [] }) => {
  const [form, setForm] = useState({
    name: '', device_type: 'HV Circuit Breaker', manufacturer: '', reference: '',
    voltage_class_kv: 20, short_circuit_current_ka: 25, insulation_type: 'SF6',
    mechanical_endurance_class: 'M1', electrical_endurance_class: 'E2',
    poles: 3, is_main_incoming: false, downstream_switchboard_id: null,
    downstream_device_id: null, notes: ''
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
        downstream_switchboard_id: device.downstream_switchboard_id || null,
        downstream_device_id: device.downstream_device_id || null,
        notes: device.notes || ''
      });
    } else if (isOpen) {
      setForm({
        name: '', device_type: 'HV Circuit Breaker', manufacturer: '', reference: '',
        voltage_class_kv: 20, short_circuit_current_ka: 25, insulation_type: 'SF6',
        mechanical_endurance_class: 'M1', electrical_endurance_class: 'E2',
        poles: 3, is_main_incoming: false, downstream_switchboard_id: null,
        downstream_device_id: null, notes: ''
      });
    }
  }, [isOpen, device]);

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      showToast?.('Le nom est requis', 'error');
      return;
    }
    setIsSaving(true);
    try {
      if (device?.id) {
        await api.hv.update(device.id, form);
        showToast?.('Device mis à jour !', 'success');
      } else {
        await api.hv.create(equipmentId, form);
        showToast?.('Device créé !', 'success');
      }
      onSave();
      onClose();
    } catch (err) {
      showToast?.('Erreur: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-slideUp">
          <div className="bg-gradient-to-r from-orange-500 to-red-600 p-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl">
                  <CircleDot size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">{device ? 'Modifier le device' : 'Nouveau device HV'}</h2>
                  <p className="text-orange-100 text-sm">{device?.name || 'Disjoncteur, transformateur...'}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)] space-y-6">
            {/* AI Button */}
            <button onClick={() => setShowAIModal(true)}
              className="w-full py-3 rounded-xl bg-purple-100 border-2 border-dashed border-purple-300 text-purple-700 font-medium hover:bg-purple-200 flex items-center justify-center gap-2">
              <Sparkles size={20} />
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
                <label className={labelClass}>Type</label>
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
            <div className="p-4 bg-orange-50 rounded-xl">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Zap size={16} className="text-orange-600" />
                Électrique
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
            </div>

            {/* Downstream Connection */}
            <div className="p-4 bg-blue-50 rounded-xl">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Network size={16} className="text-blue-600" />
                Connexion aval (BT)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Tableau BT</label>
                  <select value={form.downstream_switchboard_id || ''} onChange={e => setForm(f => ({ ...f, downstream_switchboard_id: e.target.value ? Number(e.target.value) : null }))} className={selectBaseClass}>
                    <option value="">Aucun</option>
                    {downstreamSwitchboards.map(sb => (
                      <option key={sb.id} value={sb.id}>{sb.name} ({sb.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Device BT</label>
                  <select value={form.downstream_device_id || ''} onChange={e => setForm(f => ({ ...f, downstream_device_id: e.target.value ? Number(e.target.value) : null }))} className={selectBaseClass}>
                    <option value="">Aucun</option>
                    {downstreamDevices.map(d => (
                      <option key={d.id} value={d.id}>{d.name} - {d.switchboard_name}</option>
                    ))}
                  </select>
                </div>
              </div>
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

          <div className="border-t p-4 flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
            <button onClick={handleSubmit} disabled={isSaving}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
              {device ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </div>
      </div>

      <AIPhotoModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        onComplete={(specs) => setForm(f => ({ ...f, ...specs }))}
        showToast={showToast}
      />
    </>
  );
};

// ==================== DETAIL PANEL ====================

const DetailPanel = ({
  equipment,
  onClose,
  onEdit,
  onDelete,
  onShare,
  onNavigateToMap,
  isPlaced,
  showToast,
  devices,
  onAddDevice,
  onEditDevice,
  onDeleteDevice,
  onLoadDevices,
  controlStatuses,
  navigate,
  onPhotoUpdated
}) => {
  const [showTechnical, setShowTechnical] = useState(false);
  const [showDevices, setShowDevices] = useState(true);
  const [showAIChat, setShowAIChat] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(Date.now());
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

  // Get control status for this equipment
  const controlStatus = controlStatuses?.[equipment?.id];
  const hasOverdueControl = controlStatus?.status === 'overdue';

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !equipment?.id) return;

    setIsUploadingPhoto(true);
    try {
      await api.hv.uploadEquipmentPhoto(equipment.id, file);
      setPhotoVersion(Date.now());
      onPhotoUpdated?.({ ...equipment, has_photo: true });
      showToast?.('Photo uploadée !', 'success');
    } catch (err) {
      console.error('Photo upload error:', err);
      showToast?.('Erreur lors de l\'upload', 'error');
    } finally {
      setIsUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (equipment?.id && (!devices || devices.length === 0)) {
      onLoadDevices?.(equipment.id);
    }
  }, [equipment?.id, devices, onLoadDevices]);

  if (!equipment) return null;

  const getDeviceIcon = (type) => {
    const icons = {
      'HV Circuit Breaker': Power, 'HV Disconnect Switch': PlugZap, 'HV Fuse Switch': Shield,
      'Transformer': Factory, 'HV Cable': Cable, 'Busbar': Box, 'Current Transformer': Gauge,
      'Voltage Transformer': Activity, 'Surge Arrester': Zap, 'Capacitor Bank': Database,
      'Reactor': Wind, 'Earth Switch': Radio, 'Relay': Cpu, 'Meter': CircleDot, 'HV Cell': Box
    };
    return icons[type] || CircleDot;
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-4 md:p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg md:hidden"><X size={20} /></button>
          <button onClick={() => onEdit(equipment)} className="p-2 hover:bg-white/20 rounded-lg"><Edit3 size={18} /></button>
        </div>

        <div className="flex items-start gap-4">
          {/* Photo cliquable - similaire à Switchboards */}
          <div
            onClick={() => photoInputRef.current?.click()}
            className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl flex items-center justify-center overflow-hidden cursor-pointer relative group ${equipment.is_principal ? 'bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800' : 'bg-white/20'}`}
          >
            <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            {equipment.has_photo ? (
              <img
                src={`${api.hv.equipmentPhotoUrl(equipment.id, { bust: false })}&v=${photoVersion}`}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-white/70">
                <ImagePlus size={28} />
              </div>
            )}
            {/* Overlay au survol */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {isUploadingPhoto ? (
                <RefreshCw size={24} className="text-white animate-spin" />
              ) : (
                <Camera size={24} className="text-white" />
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-xl font-bold truncate">{equipment.name || 'Équipement HV'}</h2>
            {equipment.code && <p className="text-amber-100 text-sm font-mono">{equipment.code}</p>}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {equipment.is_principal && <Badge variant="warning" size="sm"><Star size={10} />Principal</Badge>}
              <Badge variant="default" size="sm">{equipment.voltage_kv || 20} kV</Badge>
              <Badge variant="default" size="sm">{equipment.regime_neutral}</Badge>
              {isPlaced ? (
                <Badge variant="success" size="sm"><MapPin size={10} />Localisé</Badge>
              ) : (
                <Badge variant="warning" size="sm"><MapPin size={10} />Non localisé</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Mini Electro - AI Assistant (en premier sur mobile) */}
        <MiniElectro
          equipment={equipment}
          equipmentType="hv"
          onAction={(action, params) => {
            if (action === 'docAttached') {
              showToast?.('Documentation associée avec succès!', 'success');
            }
          }}
        />

        {/* Location */}
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Building2 size={16} className="text-amber-500" />
            Localisation
          </h3>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Bâtiment</span>
              <p className="font-medium text-gray-900">{equipment.building_code || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Étage</span>
              <p className="font-medium text-gray-900">{equipment.floor || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Local</span>
              <p className="font-medium text-gray-900">{equipment.room || '-'}</p>
            </div>
          </div>
        </div>

        {/* Technical Specs */}
        <div className="bg-amber-50 rounded-xl overflow-hidden">
          <button onClick={() => setShowTechnical(!showTechnical)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-amber-100 transition-colors">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Gauge size={16} className="text-amber-600" />
              Caractéristiques électriques
            </h3>
            {showTechnical ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showTechnical && (
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-lg p-3 text-center">
                <Zap size={18} className="mx-auto text-amber-500 mb-1" />
                <p className="text-lg font-bold text-gray-900">{equipment.voltage_kv || 20}</p>
                <p className="text-xs text-gray-500">kV</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center">
                <Activity size={18} className="mx-auto text-orange-500 mb-1" />
                <p className="text-lg font-bold text-gray-900">{equipment.short_circuit_ka || '-'}</p>
                <p className="text-xs text-gray-500">kA</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center">
                <Shield size={18} className="mx-auto text-red-500 mb-1" />
                <p className="text-lg font-bold text-gray-900">{equipment.regime_neutral || 'TN-S'}</p>
                <p className="text-xs text-gray-500">Régime</p>
              </div>
            </div>
          )}
        </div>

        {/* Control Status Section */}
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${
                controlStatuses?.[equipment.id]?.status === 'overdue' ? 'bg-red-100' :
                controlStatuses?.[equipment.id]?.status === 'pending' ? 'bg-blue-100' : 'bg-gray-100'
              }`}>
                <ClipboardCheck size={20} className={
                  controlStatuses?.[equipment.id]?.status === 'overdue' ? 'text-red-600' :
                  controlStatuses?.[equipment.id]?.status === 'pending' ? 'text-blue-600' : 'text-gray-400'
                } />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">
                  Contrôles planifiés
                  {controlStatuses?.[equipment.id]?.controls?.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                      {controlStatuses[equipment.id].controls.length}
                    </span>
                  )}
                </h4>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {controlStatuses?.[equipment.id]?.overdueCount > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full flex items-center gap-1">
                      <AlertTriangle size={10} />
                      {controlStatuses[equipment.id].overdueCount} en retard
                    </span>
                  )}
                  {controlStatuses?.[equipment.id]?.pendingCount > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full flex items-center gap-1">
                      <CheckCircle size={10} />
                      {controlStatuses[equipment.id].pendingCount} planifié(s)
                    </span>
                  )}
                  {!controlStatuses?.[equipment.id]?.controls?.length && (
                    <span className="text-sm text-gray-400">Aucun contrôle planifié</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => navigate(`/app/switchboard-controls?tab=history&equipment_type=hv&hv_equipment_id=${equipment.id}`)}
                className="p-2 sm:px-3 sm:py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
                title="Historique"
              >
                <History size={14} />
                <span className="hidden sm:inline">Historique</span>
              </button>
              <button
                onClick={() => navigate(`/app/switchboard-controls?tab=schedules&equipment_type=hv&hv_equipment_id=${equipment.id}`)}
                className="p-2 sm:px-3 sm:py-1.5 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 flex items-center gap-1"
                title="Planifier"
              >
                <Plus size={14} />
                <span className="hidden sm:inline">Planifier</span>
              </button>
            </div>
          </div>

          {/* Pending Controls Section */}
          {controlStatuses?.[equipment.id]?.controls?.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              {controlStatuses[equipment.id].controls.map((ctrl, idx) => (
                <div
                  key={idx}
                  onClick={() => navigate(`/app/switchboard-controls?tab=schedules&schedule_id=${ctrl.schedule_id}`)}
                  className={`flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-all ${
                    ctrl.status === 'overdue' ? 'bg-red-50 border border-red-200 hover:bg-red-100' : 'bg-blue-50 border border-blue-200 hover:bg-blue-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {ctrl.status === 'overdue' ? (
                      <AlertTriangle size={14} className="text-red-600" />
                    ) : (
                      <Clock size={14} className="text-blue-600" />
                    )}
                    <span className={ctrl.status === 'overdue' ? 'text-red-700' : 'text-blue-700'}>
                      {ctrl.template_name}
                    </span>
                  </div>
                  <span className={`text-xs ${ctrl.status === 'overdue' ? 'text-red-500' : 'text-blue-500'}`}>
                    {ctrl.next_due ? new Date(ctrl.next_due).toLocaleDateString('fr-FR') : '-'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Devices Section */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <button onClick={() => setShowDevices(!showDevices)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CircleDot size={16} className="text-orange-500" />
              Devices ({devices?.length || 0})
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); onAddDevice(); }}
                className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200 flex items-center gap-1">
                <Plus size={14} />
                Ajouter
              </button>
              {showDevices ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>

          {showDevices && (
            <div className="border-t">
              {devices?.length > 0 ? (
                <div className="divide-y">
                  {devices.map((device, idx) => {
                    const Icon = getDeviceIcon(device.device_type);
                    return (
                      <div key={device.id} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${device.is_main_incoming ? 'bg-gradient-to-br from-orange-400 to-red-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                            <Icon size={20} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-gray-900 truncate">{device.name}</p>
                              <Badge variant="orange" size="sm">{device.device_type}</Badge>
                              {device.is_main_incoming && <Badge variant="danger" size="sm"><Star size={8} /></Badge>}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                              {device.manufacturer && <span>{device.manufacturer}</span>}
                              {device.reference && <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{device.reference}</span>}
                              <span>{device.voltage_class_kv || '?'}kV</span>
                              <span>{device.short_circuit_current_ka || '?'}kA</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => onEditDevice(device)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                              <Edit3 size={16} />
                            </button>
                            <button onClick={() => onDeleteDevice(device)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-xl flex items-center justify-center">
                    <CircleDot size={24} className="text-gray-400" />
                  </div>
                  <p className="text-gray-500">Aucun device</p>
                  <button onClick={onAddDevice}
                    className="mt-3 px-4 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200 flex items-center gap-2 mx-auto">
                    <Plus size={16} />
                    Ajouter un device
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        {equipment.notes && (
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Info size={16} className="text-gray-500" />
              Notes
            </h3>
            <p className="text-gray-600 text-sm whitespace-pre-wrap">{equipment.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t p-4 flex gap-3">
        <button onClick={() => onNavigateToMap(equipment)}
          className="flex-1 py-3 px-4 rounded-xl bg-emerald-100 text-emerald-700 font-medium hover:bg-emerald-200 flex items-center justify-center gap-2">
          <MapPin size={18} />
          {isPlaced ? 'Voir sur le plan' : 'Localiser'}
        </button>
        <button onClick={() => onDelete(equipment)}
          className="py-3 px-4 rounded-xl bg-red-100 text-red-700 font-medium hover:bg-red-200">
          <Trash2 size={18} />
        </button>
      </div>

      {/* AI Chat Modal */}
      <EquipmentAIChat
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        equipmentType="hv"
        equipment={{
          ...equipment,
          building: equipment.building_code
        }}
        controlStatus={controlStatus ? {
          hasOverdue: controlStatus.status === 'overdue',
          nextDueDate: controlStatus.next_due,
          lastControlDate: controlStatus.last_control,
          templateName: controlStatus.template_name
        } : null}
      />
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function HighVoltage() {
  const site = useUserSite();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Responsive
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Data state
  const [equipments, setEquipments] = useState([]);
  const [devices, setDevices] = useState({});
  const [loading, setLoading] = useState(true);
  const [switchboards, setSwitchboards] = useState([]);
  const [lvDevices, setLvDevices] = useState([]);

  // Placement state
  const [placedIds, setPlacedIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({});

  // Control status state
  const [controlStatuses, setControlStatuses] = useState({});

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [viewMode, setViewMode] = useState('detail'); // 'detail' | 'edit'
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals
  const [deviceModal, setDeviceModal] = useState({ open: false, data: null, equipmentId: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, item: null, type: null });
  const [shareModal, setShareModal] = useState({ open: false, equipment: null });
  const [isDeleting, setIsDeleting] = useState(false);

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportFilters, setReportFilters] = useState({ building: '', voltage_class: '', device_type: '' });
  const [reportLoading, setReportLoading] = useState(false);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Stats
  const stats = useMemo(() => ({
    total: equipments.length,
    placed: equipments.filter(e => placedIds.has(e.id)).length,
    unplaced: equipments.filter(e => !placedIds.has(e.id)).length,
  }), [equipments, placedIds]);

  // Liste des bâtiments uniques pour le filtre du rapport
  const buildings = useMemo(() => {
    const set = new Set(equipments.map(e => e.building).filter(Boolean));
    return Array.from(set).sort();
  }, [equipments]);

  // Fonction pour générer le rapport PDF
  const generateReport = useCallback(() => {
    setReportLoading(true);
    try {
      const url = api.hv.reportUrl ? api.hv.reportUrl(reportFilters) : '#';
      window.open(url, '_blank');
    } catch (e) {
      showToast('Erreur lors de la génération du rapport', 'error');
    } finally {
      setTimeout(() => {
        setReportLoading(false);
        setShowReportModal(false);
      }, 500);
    }
  }, [reportFilters]);

  // Load equipments
  const loadEquipments = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.hv.list({});
      setEquipments(resp?.data || []);
    } catch (err) {
      showToast('Erreur lors du chargement: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

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

  // Load control statuses
  const loadControlStatuses = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules({ equipment_type: 'hv' });
      const schedules = res?.schedules || [];
      const statuses = {};
      // Use date-only comparison to fix "today" items being marked as overdue
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      schedules.forEach(s => {
        if (s.hv_equipment_id) {
          const nextDue = s.next_due_date ? new Date(s.next_due_date) : null;
          if (nextDue) nextDue.setHours(0, 0, 0, 0);
          const isOverdue = nextDue && nextDue < now;

          if (!statuses[s.hv_equipment_id]) {
            statuses[s.hv_equipment_id] = { status: 'ok', controls: [], overdueCount: 0, pendingCount: 0, last_control: null, template_name: null };
          }

          statuses[s.hv_equipment_id].controls.push({
            template_name: s.template_name,
            next_due: s.next_due_date,
            status: isOverdue ? 'overdue' : 'pending',
            schedule_id: s.id
          });

          // Track the most recent last_control_date across all schedules for this equipment
          if (s.last_control_date) {
            const lastDate = new Date(s.last_control_date);
            const currentLast = statuses[s.hv_equipment_id].last_control
              ? new Date(statuses[s.hv_equipment_id].last_control)
              : null;
            if (!currentLast || lastDate > currentLast) {
              statuses[s.hv_equipment_id].last_control = s.last_control_date;
              statuses[s.hv_equipment_id].template_name = s.template_name;
            }
          }

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

      setControlStatuses(statuses);
    } catch (e) {
      console.error('Load control statuses error:', e);
    }
  }, []);

  // Load devices for equipment
  const loadDevices = useCallback(async (equipmentId) => {
    try {
      const data = await get(`/api/hv/equipments/${equipmentId}/devices`);
      setDevices(prev => ({ ...prev, [equipmentId]: data || [] }));
    } catch (err) {
      console.error('Failed to load devices', err);
    }
  }, []);

  // Load switchboards
  const loadSwitchboards = useCallback(async () => {
    try {
      const resp = await get('/api/switchboard/boards', { pageSize: 1000 });
      setSwitchboards(resp?.data || []);
    } catch (err) {
      console.error('Failed to load switchboards', err);
    }
  }, []);

  // Load LV devices
  const loadLvDevices = useCallback(async () => {
    try {
      const resp = await get('/api/hv/lv-devices', { q: '' });
      setLvDevices(resp || []);
    } catch (err) {
      console.error('Failed to load LV devices', err);
    }
  }, []);

  // Effects
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadEquipments();
    loadSwitchboards();
    loadLvDevices();
    loadPlacements();
    loadControlStatuses();
  }, [loadEquipments, loadSwitchboards, loadLvDevices, loadPlacements, loadControlStatuses]);

  // URL params handling
  useEffect(() => {
    const eqId = searchParams.get('equipment');
    if (eqId && (!selectedEquipment || selectedEquipment.id !== Number(eqId))) {
      const eq = equipments.find(e => e.id === Number(eqId));
      if (eq) {
        setSelectedEquipment(eq);
        const building = eq.building_code || 'Sans bâtiment';
        setExpandedBuildings(prev => ({ ...prev, [building]: true }));
      }
    }
  }, [searchParams, equipments]);

  // Handlers
  const handleSelectEquipment = async (eq) => {
    setSearchParams({ equipment: eq.id.toString() });
    setViewMode('detail');
    setSelectedEquipment(eq);
    if (!devices[eq.id]) {
      loadDevices(eq.id);
    }
  };

  const handleCloseEquipment = () => {
    setSelectedEquipment(null);
    setViewMode('detail');
    setSearchParams({});
  };

  const handleNewEquipment = () => {
    setSelectedEquipment({});
    setViewMode('edit');
    setSearchParams({});
  };

  const handleEditEquipment = (eq) => {
    setSelectedEquipment(eq);
    setViewMode('edit');
  };

  const handleSaveEquipment = async (payload) => {
    try {
      let saved;
      if (selectedEquipment?.id) {
        saved = await api.hv.updateEquipment(selectedEquipment.id, payload);
        showToast('Équipement mis à jour !', 'success');
        setEquipments(prev => prev.map(e => e.id === selectedEquipment.id ? { ...e, ...saved?.equipment || saved } : e));
      } else {
        saved = await api.hv.createEquipment(payload);
        showToast('Équipement créé !', 'success');
        setEquipments(prev => [...prev, saved?.equipment || saved]);
      }
      const eq = saved?.equipment || saved;
      setSelectedEquipment(eq);
      setViewMode('detail');
      setSearchParams({ equipment: eq.id.toString() });
    } catch (err) {
      console.error('Save error:', err);
      showToast(err.message || 'Erreur', 'error');
      throw err;
    }
  };

  const handleDeleteEquipment = async () => {
    if (!deleteModal.item) return;
    setIsDeleting(true);
    try {
      await del(`/api/hv/equipments/${deleteModal.item.id}`);
      showToast('Équipement supprimé !', 'success');
      setEquipments(prev => prev.filter(e => e.id !== deleteModal.item.id));
      if (selectedEquipment?.id === deleteModal.item.id) {
        handleCloseEquipment();
      }
      setDeleteModal({ open: false, item: null, type: null });
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteDevice = async () => {
    if (!deleteModal.item) return;
    setIsDeleting(true);
    try {
      await del(`/api/hv/devices/${deleteModal.item.id}`);
      showToast('Device supprimé !', 'success');
      const equipmentId = deleteModal.item.hv_equipment_id;
      if (equipmentId) {
        loadDevices(equipmentId);
      }
      setDeleteModal({ open: false, item: null, type: null });
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleNavigateToMap = (eq) => {
    const eqId = eq?.id || selectedEquipment?.id;
    if (!eqId) {
      navigate('/app/hv/map');
      return;
    }
    const details = placedDetails[eqId];
    if (details?.plans?.length > 0) {
      navigate(`/app/hv/map?hv=${eqId}&plan=${encodeURIComponent(details.plans[0])}`);
    } else {
      // Pass equipment ID so user can position it on map
      navigate(`/app/hv/map?hv=${eqId}`);
    }
  };

  // Build tree
  const buildingTree = useMemo(() => {
    const filtered = equipments.filter(eq => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        eq.name?.toLowerCase().includes(q) ||
        eq.code?.toLowerCase().includes(q) ||
        eq.building_code?.toLowerCase().includes(q)
      );
    });

    const tree = {};
    filtered.forEach(eq => {
      const building = eq.building_code || 'Sans bâtiment';
      if (!tree[building]) tree[building] = [];
      tree[building].push(eq);
    });
    return tree;
  }, [equipments, searchQuery]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* CSS Animations */}
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideRight { from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); } }
        .animate-slideUp { animation: slideUp 0.3s ease-out forwards; }
        .animate-slideRight { animation: slideRight 0.3s ease-out forwards; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          {/* Left */}
          <div className="flex items-center gap-3">
            {isMobile && (
              <button onClick={() => setShowMobileDrawer(true)} className="p-2 hover:bg-gray-100 rounded-lg">
                <Menu size={20} />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-100 rounded-xl">
                <Zap size={20} className="text-amber-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">High Voltage</h1>
                <p className="text-xs text-gray-500">Équipements HT/HTA</p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-1 text-xs">
            <Badge variant="default">Total: {stats.total}</Badge>
            <Badge variant="success">Localisés: {stats.placed}</Badge>
            <Badge variant="warning">Non localisés: {stats.unplaced}</Badge>
          </div>

          {/* Stats Mobile */}
          <div className="flex md:hidden items-center gap-1.5">
            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">{stats.total}</span>
            {stats.unplaced > 0 && (
              <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium">{stats.unplaced}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReportModal(true)}
              className="px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-100 flex items-center gap-2"
              title="Générer un rapport PDF"
            >
              <FileText size={16} />
              <span className="hidden sm:inline">Rapport</span>
            </button>
            <button
              onClick={() => navigate('/app/hv/map')}
              className="px-3 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 flex items-center gap-2"
            >
              <MapPin size={16} />
              <span className="hidden sm:inline">Carte</span>
            </button>
            <button
              onClick={handleNewEquipment}
              className="px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg text-sm font-medium hover:from-amber-600 hover:to-orange-700 flex items-center gap-2"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Nouveau</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Desktop */}
        {!isMobile && (
          <div className="w-80 bg-white border-r shadow-sm flex flex-col">
            {/* Search */}
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm bg-white text-gray-900"
                />
              </div>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : Object.keys(buildingTree).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Zap size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Aucun équipement HV</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {Object.entries(buildingTree).sort(([a], [b]) => a.localeCompare(b)).map(([building, eqs]) => (
                    <div key={building}>
                      <button
                        onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
                      >
                        {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Building2 size={16} className="text-amber-500" />
                        <span className="font-medium truncate flex-1">{building}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          {eqs.length}
                        </span>
                      </button>

                      {expandedBuildings[building] && (
                        <div className="ml-4 space-y-1 mt-1">
                          {eqs.map(eq => (
                            <button
                              key={eq.id}
                              onClick={() => handleSelectEquipment(eq)}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-lg transition-colors
                                ${selectedEquipment?.id === eq.id
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                              <Zap size={14} className={selectedEquipment?.id === eq.id ? 'text-amber-600' : 'text-gray-400'} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{eq.name || 'Équipement'}</p>
                                <p className="text-xs text-gray-400 truncate">{eq.voltage_kv || 20}kV • {eq.regime_neutral}</p>
                              </div>
                              {controlStatuses[eq.id]?.overdueCount > 0 && (
                                <span className="w-2 h-2 bg-red-500 rounded-full" />
                              )}
                              {!placedIds.has(eq.id) && (
                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[9px] rounded-full flex items-center gap-0.5">
                                  <MapPin size={8} />
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mobile: show tree directly when no equipment selected */}
        {isMobile && !selectedEquipment && (
          <div className="flex-1 bg-white p-3">
            <div className="space-y-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : Object.keys(buildingTree).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Zap size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Aucun équipement HV</p>
                  <button
                    onClick={handleNewEquipment}
                    className="mt-4 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg font-medium hover:from-amber-600 hover:to-orange-700 flex items-center gap-2 mx-auto"
                  >
                    <Plus size={18} />
                    Nouvel équipement HV
                  </button>
                </div>
              ) : (
                Object.entries(buildingTree).sort(([a], [b]) => a.localeCompare(b)).map(([building, eqs]) => (
                  <div key={building} className="bg-gray-50 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-gray-100"
                    >
                      {expandedBuildings[building] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <Building2 size={18} className="text-amber-500" />
                      <span className="font-semibold truncate flex-1">{building}</span>
                      <span className="text-xs text-gray-400 bg-white px-2 py-1 rounded-full shadow-sm">
                        {eqs.length}
                      </span>
                    </button>

                    {expandedBuildings[building] && (
                      <div className="bg-white border-t divide-y divide-gray-100">
                        {eqs.map(eq => (
                          <button
                            key={eq.id}
                            onClick={() => handleSelectEquipment(eq)}
                            className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-amber-50 transition-colors"
                          >
                            <Zap size={16} className="text-gray-400" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 block truncate">{eq.name || 'Équipement'}</span>
                              <span className="text-xs text-gray-500 truncate block">{eq.voltage_kv || 20}kV • {eq.regime_neutral}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {controlStatuses[eq.id]?.overdueCount > 0 && (
                                <span className="w-2 h-2 bg-red-500 rounded-full" />
                              )}
                              {!placedIds.has(eq.id) && (
                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[10px] rounded-full flex items-center gap-0.5">
                                  <MapPin size={10} />
                                </span>
                              )}
                            </div>
                            <ChevronRight size={16} className="text-gray-300" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className={`flex-1 overflow-hidden ${isMobile && !selectedEquipment ? 'hidden' : ''}`}>
          {selectedEquipment ? (
            <>
              {/* Mobile back button */}
              {isMobile && (
                <button
                  onClick={handleCloseEquipment}
                  className="m-3 flex items-center gap-2 text-gray-600 hover:text-gray-900 px-3 py-2 bg-white rounded-xl shadow-sm w-[calc(100%-1.5rem)]"
                >
                  <ArrowLeft size={18} />
                  <span className="font-medium">Retour aux équipements HV</span>
                </button>
              )}
              {viewMode === 'edit' ? (
                <EditForm
                  equipment={selectedEquipment}
                  onSave={handleSaveEquipment}
                  onCancel={() => selectedEquipment?.id ? setViewMode('detail') : handleCloseEquipment()}
                  showToast={showToast}
                  site={site}
                  switchboards={switchboards}
                  lvDevices={lvDevices}
                  onPhotoUpdated={(updated) => {
                    setSelectedEquipment(updated);
                    setEquipments(prev => prev.map(eq => eq.id === updated.id ? { ...eq, has_photo: updated.has_photo } : eq));
                  }}
                />
              ) : (
                <DetailPanel
                  equipment={selectedEquipment}
                  onClose={handleCloseEquipment}
                  onEdit={handleEditEquipment}
                  onDelete={(eq) => setDeleteModal({ open: true, item: eq, type: 'equipment' })}
                  onShare={(eq) => setShareModal({ open: true, equipment: eq })}
                  onNavigateToMap={handleNavigateToMap}
                  isPlaced={placedIds.has(selectedEquipment.id)}
                  showToast={showToast}
                  devices={devices[selectedEquipment.id] || []}
                  onAddDevice={() => setDeviceModal({ open: true, data: null, equipmentId: selectedEquipment.id })}
                  onEditDevice={(device) => setDeviceModal({ open: true, data: device, equipmentId: selectedEquipment.id })}
                  onDeleteDevice={(device) => setDeleteModal({ open: true, item: { ...device, hv_equipment_id: selectedEquipment.id }, type: 'device' })}
                  onLoadDevices={loadDevices}
                  controlStatuses={controlStatuses}
                  navigate={navigate}
                  onPhotoUpdated={(updated) => {
                    setSelectedEquipment(updated);
                    setEquipments(prev => prev.map(eq => eq.id === updated.id ? { ...eq, has_photo: updated.has_photo } : eq));
                  }}
                />
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-50">
              <div className="text-center px-4">
                <div className="w-20 h-20 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Zap size={40} className="text-amber-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-700">Sélectionnez un équipement</h3>
                <p className="text-gray-500 mt-1">ou créez-en un nouveau</p>
                <button
                  onClick={handleNewEquipment}
                  className="mt-4 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg font-medium hover:from-amber-600 hover:to-orange-700 flex items-center gap-2 mx-auto"
                >
                  <Plus size={18} />
                  Nouvel équipement HV
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Drawer */}
      <MobileTreeDrawer
        isOpen={showMobileDrawer}
        onClose={() => setShowMobileDrawer(false)}
        tree={buildingTree}
        expandedBuildings={expandedBuildings}
        setExpandedBuildings={setExpandedBuildings}
        selectedEquipment={selectedEquipment}
        onSelectEquipment={handleSelectEquipment}
        placedIds={placedIds}
      />

      {/* Modals */}
      <DeviceFormModal
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
        isLoading={isDeleting}
      />

      <ShareLinkModal
        isOpen={shareModal.open}
        onClose={() => setShareModal({ open: false, equipment: null })}
        equipment={shareModal.equipment}
      />

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-slideUp">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-500 to-indigo-600 p-6 text-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl">
                  <FileText size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Rapport PDF</h2>
                  <p className="text-purple-100 text-sm">Équipements haute tension</p>
                </div>
              </div>
            </div>

            {/* Content - Filtres */}
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">
                Sélectionnez les filtres pour personnaliser votre rapport. Laissez vide pour inclure tous les éléments.
              </p>

              {/* Filtre Bâtiment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bâtiment</label>
                <select
                  value={reportFilters.building}
                  onChange={e => setReportFilters(f => ({ ...f, building: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">Tous les bâtiments</option>
                  {buildings.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Filtre Tension */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Classe de tension (kV)</label>
                <select
                  value={reportFilters.voltage_class}
                  onChange={e => setReportFilters(f => ({ ...f, voltage_class: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">Toutes les tensions</option>
                  {VOLTAGE_CLASSES.map(v => <option key={v} value={v}>{v} kV</option>)}
                </select>
              </div>

              {/* Filtre Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type d'équipement</label>
                <select
                  value={reportFilters.device_type}
                  onChange={e => setReportFilters(f => ({ ...f, device_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">Tous les types</option>
                  {HV_DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Résumé */}
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                <p className="text-sm text-purple-800">
                  <span className="font-medium">Le rapport inclura :</span>{' '}
                  {reportFilters.building || "Tous les bâtiments"}
                  {" / "}
                  {reportFilters.voltage_class ? `${reportFilters.voltage_class} kV` : "Toutes tensions"}
                  {" / "}
                  {reportFilters.device_type || "Tous les types"}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t p-4 flex gap-3">
              <button
                onClick={() => { setShowReportModal(false); setReportFilters({ building: '', voltage_class: '', device_type: '' }); }}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={generateReport}
                disabled={reportLoading}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-medium hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {reportLoading ? (
                  <RefreshCw size={18} className="animate-spin" />
                ) : (
                  <>
                    <Download size={18} />
                    Télécharger le PDF
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
