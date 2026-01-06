// src/pages/Meca.jsx - Redesigned following Switchboards pattern
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useFormDraft } from '../hooks/useFormDraft';
import {
  Cog, Plus, Search, ChevronRight, ChevronDown, Building2, Layers,
  MoreVertical, Copy, Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Camera, Sparkles, Upload, RefreshCw, Eye, ImagePlus, AlertCircle,
  Menu, Settings, Share2, ExternalLink, MapPin, Zap, Power,
  Tag, Hash, Factory, Gauge, Thermometer, Network, Info, Droplet, Wind,
  FolderPlus, Folder, ChevronUp, GripVertical, ClipboardCheck, Clock, Calendar,
  History, FileText, Download
} from 'lucide-react';
import { api } from '../lib/api';
import { EquipmentAIChat } from '../components/AIAvatar';
import MiniElectro from '../components/MiniElectro';
import ImageLightbox, { useLightbox } from '../components/ImageLightbox';

// ==================== ANIMATION COMPONENTS ====================

const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

// Toast Notification Component
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  const Icon = type === 'success' ? CheckCircle : type === 'error' ? AlertCircle : Info;

  return (
    <div className={`fixed bottom-4 right-4 z-[200] ${bgColor} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-slideUp`}>
      <Icon size={20} />
      <span className="font-medium">{message}</span>
      <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
        <X size={16} />
      </button>
    </div>
  );
};

// Badge Component
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
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

// ==================== INPUT STYLES ====================

const inputBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400";
const selectBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white text-gray-900";

// ==================== MODAL COMPONENTS ====================

// Delete Confirm Modal
const DeleteConfirmModal = ({ isOpen, onClose, onConfirm, itemName, isLoading }) => {
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
            Supprimer l'équipement <span className="font-semibold">"{itemName}"</span> ?
          </p>
        </div>

        <div className="border-t p-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-medium hover:from-red-600 hover:to-rose-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
};

// Share Link Modal
const ShareLinkModal = ({ isOpen, onClose, equipment }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !equipment) return null;

  const url = `${window.location.origin}${window.location.pathname}?meca=${equipment.id}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
        <div className="bg-gradient-to-r from-orange-500 to-amber-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Partager le lien</h2>
              <p className="text-orange-100 text-sm">{equipment.name || equipment.tag}</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              readOnly
              className={`${inputBaseClass} flex-1 text-sm font-mono`}
            />
            <button
              onClick={handleCopy}
              className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
                copied ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
              }`}
            >
              {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
              {copied ? 'Copié!' : 'Copier'}
            </button>
          </div>
        </div>

        <div className="border-t p-4">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

// AI Photo Analysis Modal
const AIPhotoModal = ({ isOpen, onClose, onComplete, showToast }) => {
  const [photos, setPhotos] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPhotos([]);
      setResult(null);
    }
  }, [isOpen]);

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files);
    setPhotos(files);
  };

  const analyzePhotos = async () => {
    if (!photos.length) return;
    setIsAnalyzing(true);
    try {
      const res = await api.meca.extractFromPhotos(photos);
      setResult(res?.extracted || res || {});
    } catch (err) {
      showToast?.('Erreur lors de l\'analyse', 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUse = () => {
    if (result) {
      onComplete(result);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="sticky top-0 bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Analyse IA</h2>
              <p className="text-amber-100 text-sm">Extraction automatique des données</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {!result ? (
            <>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
                  ${photos.length ? 'border-amber-500 bg-amber-50' : 'border-gray-300 hover:border-amber-400'}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                {photos.length > 0 ? (
                  <div className="space-y-2">
                    <CheckCircle className="mx-auto text-amber-500" size={40} />
                    <p className="font-medium text-amber-700">{photos.length} photo(s) sélectionnée(s)</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPhotos([]); }}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Supprimer
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Camera className="mx-auto text-gray-400" size={48} />
                    <p className="font-medium text-gray-700">Sélectionnez des photos</p>
                    <p className="text-sm text-gray-500">Photo de la plaque signalétique</p>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-sm text-gray-600">
                  <Sparkles size={14} className="inline mr-1 text-amber-500" />
                  L'IA extraira automatiquement : fabricant, modèle, puissance, débit, pression, etc.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 space-y-2">
                <h3 className="font-semibold text-gray-900 mb-3">Données extraites</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {result.manufacturer && (
                    <div className="bg-white rounded-lg p-2">
                      <span className="text-gray-500 text-xs">Fabricant</span>
                      <p className="font-semibold">{result.manufacturer}</p>
                    </div>
                  )}
                  {result.model && (
                    <div className="bg-white rounded-lg p-2">
                      <span className="text-gray-500 text-xs">Modèle</span>
                      <p className="font-semibold">{result.model}</p>
                    </div>
                  )}
                  {result.power_kw && (
                    <div className="bg-white rounded-lg p-2">
                      <span className="text-gray-500 text-xs">Puissance</span>
                      <p className="font-semibold">{result.power_kw} kW</p>
                    </div>
                  )}
                  {result.flow_m3h && (
                    <div className="bg-white rounded-lg p-2">
                      <span className="text-gray-500 text-xs">Débit</span>
                      <p className="font-semibold">{result.flow_m3h} m³/h</p>
                    </div>
                  )}
                  {result.pressure_bar && (
                    <div className="bg-white rounded-lg p-2">
                      <span className="text-gray-500 text-xs">Pression</span>
                      <p className="font-semibold">{result.pressure_bar} bar</p>
                    </div>
                  )}
                  {result.speed_rpm && (
                    <div className="bg-white rounded-lg p-2">
                      <span className="text-gray-500 text-xs">Vitesse</span>
                      <p className="font-semibold">{result.speed_rpm} rpm</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
            Annuler
          </button>
          {!result ? (
            <button
              onClick={analyzePhotos}
              disabled={!photos.length || isAnalyzing}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isAnalyzing ? <RefreshCw size={18} className="animate-spin" /> : <Eye size={18} />}
              {isAnalyzing ? 'Analyse...' : 'Analyser'}
            </button>
          ) : (
            <button
              onClick={handleUse}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium flex items-center justify-center gap-2"
            >
              <CheckCircle size={18} />
              Utiliser ces données
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Mobile Tree Drawer
const MobileTreeDrawer = React.memo(({ isOpen, onClose, tree, expandedBuildings, setExpandedBuildings, selectedEquipment, onSelectEquipment, placedIds }) => {
  if (!isOpen) return null;

  const isPlaced = (id) => placedIds.has(id);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl animate-slideRight overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-gradient-to-r from-orange-500 to-amber-600 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Équipements</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {Object.entries(tree).map(([building, equipments]) => (
              <div key={building}>
                <button
                  onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Building2 size={16} className="text-orange-500" />
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
                          ${selectedEquipment?.id === eq.id ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        <Cog size={14} className="text-orange-500" />
                        <span className="text-sm truncate flex-1">{eq.name || eq.tag || 'Équipement'}</span>
                        {!isPlaced(eq.id) && (
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

// ==================== DETAIL PANEL COMPONENT ====================

const DetailPanel = ({
  equipment,
  onClose,
  onEdit,
  onDelete,
  onShare,
  onNavigateToMap,
  onPhotoUpload,
  onImageClick,
  isPlaced,
  showToast,
  controlStatuses,
  navigate
}) => {
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const photoInputRef = useRef(null);

  // Get control status for this equipment
  const controlStatus = controlStatuses?.[equipment?.id];
  const hasOverdueControl = controlStatus?.status === 'overdue';

  useEffect(() => {
    if (equipment?.id) {
      loadFiles();
    }
  }, [equipment?.id]);

  const loadFiles = async () => {
    if (!equipment?.id) return;
    setLoadingFiles(true);
    try {
      const res = await api.meca.listFiles(equipment.id).catch(() => ({}));
      setFiles(res?.files || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFiles(false);
    }
  };

  if (!equipment) return null;

  // Support both ui_status and status fields
  const equipmentStatus = equipment.ui_status || equipment.status;

  const statusColors = {
    en_service: 'success',
    hors_service: 'danger',
    spare: 'warning'
  };

  const statusLabels = {
    en_service: 'En service',
    hors_service: 'Hors service',
    spare: 'Spare'
  };

  const criticalityColors = {
    critique: 'danger',
    important: 'warning',
    standard: 'default'
  };

  // Check if any technical specs exist
  const hasTechnicalSpecs = equipment.power_kw || equipment.voltage || equipment.current_a ||
    equipment.ip_rating || equipment.drive_type || equipment.coupling || equipment.mounting ||
    equipment.speed_rpm || equipment.fluid || equipment.flow_m3h || equipment.pressure_bar;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-600 p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors md:hidden"
          >
            <X size={20} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onShare(equipment)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="Partager"
            >
              <Share2 size={18} />
            </button>
            <button
              onClick={() => onEdit(equipment)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="Modifier"
            >
              <Edit3 size={18} />
            </button>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div
            onClick={() => photoInputRef.current?.click()}
            className="w-20 h-20 rounded-xl bg-white/20 flex items-center justify-center cursor-pointer hover:bg-white/30 transition-colors overflow-hidden"
          >
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPhotoUpload(equipment.id, e.target.files[0])}
            />
            {equipment.photo_url ? (
              <img
                src={api.meca.photoUrl(equipment.id, { bust: true })}
                alt=""
                className="w-full h-full object-cover cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onImageClick) onImageClick(api.meca.photoUrl(equipment.id, { bust: true }), equipment.name || 'Equipement');
                }}
                title="Cliquez pour agrandir"
              />
            ) : (
              <Camera size={24} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{equipment.name || 'Équipement'}</h2>
            {equipment.tag && (
              <p className="text-orange-100 text-sm font-mono">{equipment.tag}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {equipmentStatus && (
                <Badge variant={statusColors[equipmentStatus] || 'default'}>
                  {statusLabels[equipmentStatus] || equipmentStatus}
                </Badge>
              )}
              {equipment.criticality && (
                <Badge variant={criticalityColors[equipment.criticality] || 'default'}>
                  {equipment.criticality}
                </Badge>
              )}
              {isPlaced ? (
                <Badge variant="success">
                  <MapPin size={10} className="inline mr-1" />
                  Localisé
                </Badge>
              ) : (
                <Badge variant="warning">
                  <MapPin size={10} className="inline mr-1" />
                  Non localisé
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Mini Electro - AI Assistant (en premier sur mobile) */}
        <MiniElectro
          equipment={equipment}
          equipmentType="meca"
          onAction={(action, params) => {
            if (action === 'docAttached') {
              showToast?.('Documentation associée avec succès!', 'success');
            } else if (action === 'scheduleControl') {
              navigate(`/app/switchboard-controls?tab=schedules&equipment_type=meca&meca_equipment_id=${equipment.id}`);
            }
          }}
        />

        {/* Equipment Structure */}
        <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Folder size={16} className="text-orange-500" />
            Structure de l'équipement
          </h3>

          {/* Main Equipment (Category) */}
          <div className="bg-white rounded-lg p-3 border border-orange-200 mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                <Cog size={16} className="text-orange-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500">Équipement principal</p>
                <p className="font-semibold text-gray-900">{equipment.category || 'Non défini'}</p>
              </div>
            </div>
          </div>

          {/* Sub-Equipment (Type) */}
          {equipment.equipment_type && (
            <div className="ml-6 bg-white rounded-lg p-3 border border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center">
                  <Cog size={12} className="text-gray-500" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-500">Sous-équipement</p>
                  <p className="font-medium text-gray-900">{equipment.equipment_type}</p>
                </div>
              </div>

              {/* Manufacturer & Model under sub-equipment */}
              {(equipment.manufacturer || equipment.model) && (
                <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-2 text-sm">
                  {equipment.manufacturer && (
                    <div>
                      <span className="text-gray-500 text-xs">Fabricant</span>
                      <p className="font-medium text-gray-800">{equipment.manufacturer}</p>
                    </div>
                  )}
                  {equipment.model && (
                    <div>
                      <span className="text-gray-500 text-xs">Modèle</span>
                      <p className="font-medium text-gray-800">{equipment.model}</p>
                    </div>
                  )}
                  {equipment.serial_number && (
                    <div className="col-span-2">
                      <span className="text-gray-500 text-xs">N° série</span>
                      <p className="font-medium font-mono text-gray-800">{equipment.serial_number}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Technical Specs (Collapsible) */}
        {hasTechnicalSpecs && (
          <div className="bg-gray-50 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-100 transition-colors"
            >
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Gauge size={16} className="text-orange-500" />
                Caractéristiques techniques
              </h3>
              {showTechnical ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {showTechnical && (
              <div className="px-4 pb-4 space-y-4">
                {/* Quick Stats */}
                {(equipment.power_kw || equipment.flow_m3h || equipment.pressure_bar) && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white rounded-lg p-2 text-center">
                      <Gauge size={16} className="mx-auto text-orange-500 mb-1" />
                      <p className="text-lg font-bold text-gray-900">{equipment.power_kw || '-'}</p>
                      <p className="text-xs text-gray-500">kW</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <Droplet size={16} className="mx-auto text-blue-500 mb-1" />
                      <p className="text-lg font-bold text-gray-900">{equipment.flow_m3h || '-'}</p>
                      <p className="text-xs text-gray-500">m³/h</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <Wind size={16} className="mx-auto text-teal-500 mb-1" />
                      <p className="text-lg font-bold text-gray-900">{equipment.pressure_bar || '-'}</p>
                      <p className="text-xs text-gray-500">bar</p>
                    </div>
                  </div>
                )}

                {/* Electrical */}
                {(equipment.voltage || equipment.current_a || equipment.ip_rating) && (
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                      <Zap size={12} /> Électrique
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-gray-400 text-xs">Tension</span>
                        <p className="font-medium">{equipment.voltage || '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 text-xs">Courant</span>
                        <p className="font-medium">{equipment.current_a ? `${equipment.current_a} A` : '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 text-xs">IP</span>
                        <p className="font-medium">{equipment.ip_rating || '-'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mechanical */}
                {(equipment.drive_type || equipment.coupling || equipment.mounting || equipment.speed_rpm || equipment.fluid) && (
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                      <Cog size={12} /> Mécanique
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {equipment.drive_type && <div><span className="text-gray-400 text-xs">Entraînement</span><p className="font-medium">{equipment.drive_type}</p></div>}
                      {equipment.coupling && <div><span className="text-gray-400 text-xs">Accouplement</span><p className="font-medium">{equipment.coupling}</p></div>}
                      {equipment.mounting && <div><span className="text-gray-400 text-xs">Montage</span><p className="font-medium">{equipment.mounting}</p></div>}
                      {equipment.speed_rpm && <div><span className="text-gray-400 text-xs">Vitesse</span><p className="font-medium">{equipment.speed_rpm} rpm</p></div>}
                      {equipment.fluid && <div><span className="text-gray-400 text-xs">Fluide</span><p className="font-medium">{equipment.fluid}</p></div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Location */}
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Building2 size={16} className="text-orange-500" />
            Localisation
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Bâtiment</span>
              <p className="font-medium text-gray-900">{equipment.building || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Étage</span>
              <p className="font-medium text-gray-900">{equipment.floor || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Zone</span>
              <p className="font-medium text-gray-900">{equipment.zone || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Local</span>
              <p className="font-medium text-gray-900">{equipment.location || '-'}</p>
            </div>
            {equipment.panel && (
              <div className="col-span-2">
                <span className="text-gray-500">Tableau</span>
                <p className="font-medium text-gray-900">{equipment.panel}</p>
              </div>
            )}
          </div>
        </div>

        {/* Control Status Section - Same as Switchboards */}
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
                <div className="flex items-center gap-2 mt-1">
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
                onClick={() => navigate(`/app/switchboard-controls?tab=history&equipment_type=meca&meca_equipment_id=${equipment.id}`)}
                className="p-2 sm:px-3 sm:py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
                title="Historique"
              >
                <History size={14} />
                <span className="hidden sm:inline">Historique</span>
              </button>
              <button
                onClick={() => navigate(`/app/switchboard-controls?tab=schedules&equipment_type=meca&meca_equipment_id=${equipment.id}`)}
                className="p-2 sm:px-3 sm:py-1.5 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 flex items-center gap-1"
                title="Gérer"
              >
                <ClipboardCheck size={14} />
                <span className="hidden sm:inline">Gérer</span>
              </button>
            </div>
          </div>

          {/* List all controls */}
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
                      <CheckCircle size={14} className="text-blue-600" />
                    )}
                    <span className={ctrl.status === 'overdue' ? 'text-red-700 font-medium' : 'text-blue-700'}>
                      {ctrl.template_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${ctrl.status === 'overdue' ? 'text-red-600' : 'text-blue-600'}`}>
                      {ctrl.next_due ? new Date(ctrl.next_due).toLocaleDateString('fr-FR') : '-'}
                    </span>
                    <ChevronRight size={14} className={ctrl.status === 'overdue' ? 'text-red-400' : 'text-blue-400'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments */}
        {equipment.comments && (
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Commentaires</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{equipment.comments}</p>
          </div>
        )}

        {/* Files */}
        {files.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Pièces jointes</h3>
            <div className="space-y-2">
              {files.map(f => (
                <a
                  key={f.id}
                  href={f.download_url || f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 p-2 bg-white rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <ExternalLink size={14} className="text-gray-400" />
                  <span className="text-sm text-blue-600 truncate">{f.original_name || f.name}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t p-4 space-y-2">
        <button
          onClick={() => onNavigateToMap(equipment)}
          className="w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-xl font-medium hover:from-orange-600 hover:to-amber-700 transition-all flex items-center justify-center gap-2"
        >
          <MapPin size={18} />
          {isPlaced ? 'Voir sur le plan' : 'Localiser sur le plan'}
        </button>
        <button
          onClick={() => onDelete(equipment)}
          className="w-full py-3 px-4 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all flex items-center justify-center gap-2"
        >
          <Trash2 size={18} />
          Supprimer
        </button>
      </div>

      {/* AI Chat Modal */}
      <EquipmentAIChat
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        equipmentType="meca"
        equipment={equipment}
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

// ==================== CATEGORIES SETTINGS PANEL ====================

const CategoriesSettingsPanel = ({ onClose, showToast }) => {
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState({});

  // Form state for new category
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  // Form state for new subcategory
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [addingSubcategoryTo, setAddingSubcategoryTo] = useState(null);

  // Edit state
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSubcategory, setEditingSubcategory] = useState(null);
  const [editName, setEditName] = useState('');

  const loadCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.meca.listCategories();
      setCategories(res?.categories || []);
    } catch (err) {
      console.error('Load categories error:', err);
      showToast?.('Erreur lors du chargement des catégories', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Category CRUD
  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setIsAddingCategory(true);
    try {
      await api.meca.createCategory({ name: newCategoryName.trim() });
      showToast?.('Catégorie créée', 'success');
      setNewCategoryName('');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la création', 'error');
    } finally {
      setIsAddingCategory(false);
    }
  };

  const handleUpdateCategory = async (id) => {
    if (!editName.trim()) return;
    try {
      await api.meca.updateCategory(id, { name: editName.trim() });
      showToast?.('Catégorie modifiée', 'success');
      setEditingCategory(null);
      setEditName('');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la modification', 'error');
    }
  };

  const handleDeleteCategory = async (id, name) => {
    if (!window.confirm(`Supprimer la catégorie "${name}" et toutes ses sous-catégories ?`)) return;
    try {
      await api.meca.deleteCategory(id);
      showToast?.('Catégorie supprimée', 'success');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la suppression', 'error');
    }
  };

  // Subcategory CRUD
  const handleAddSubcategory = async (categoryId) => {
    if (!newSubcategoryName.trim()) return;
    try {
      await api.meca.createSubcategory({
        category_id: categoryId,
        name: newSubcategoryName.trim()
      });
      showToast?.('Sous-catégorie créée', 'success');
      setNewSubcategoryName('');
      setAddingSubcategoryTo(null);
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la création', 'error');
    }
  };

  const handleUpdateSubcategory = async (id) => {
    if (!editName.trim()) return;
    try {
      await api.meca.updateSubcategory(id, { name: editName.trim() });
      showToast?.('Sous-catégorie modifiée', 'success');
      setEditingSubcategory(null);
      setEditName('');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la modification', 'error');
    }
  };

  const handleDeleteSubcategory = async (id, name) => {
    if (!window.confirm(`Supprimer la sous-catégorie "${name}" ?`)) return;
    try {
      await api.meca.deleteSubcategory(id);
      showToast?.('Sous-catégorie supprimée', 'success');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la suppression', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Settings size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Paramètres</h2>
              <p className="text-orange-100 text-sm">Gérer les catégories et sous-catégories</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={32} className="animate-spin text-orange-500" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Add Category Form */}
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <FolderPlus size={18} className="text-orange-500" />
                Ajouter une catégorie d'équipement
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                  placeholder="Ex: Porte Automatique, Ascenseur..."
                  className={inputBaseClass}
                />
                <button
                  onClick={handleAddCategory}
                  disabled={!newCategoryName.trim() || isAddingCategory}
                  className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-xl font-medium hover:from-orange-600 hover:to-amber-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                >
                  {isAddingCategory ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  Ajouter
                </button>
              </div>
            </div>

            {/* Categories List */}
            {categories.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Folder size={48} className="mx-auto mb-3 text-gray-300" />
                <p>Aucune catégorie définie</p>
                <p className="text-sm mt-1">Commencez par créer une catégorie d'équipement</p>
              </div>
            ) : (
              <div className="space-y-3">
                {categories.map(cat => (
                  <div key={cat.id} className="border rounded-xl overflow-hidden bg-white shadow-sm">
                    {/* Category Header */}
                    <div className="flex items-center gap-3 p-4 bg-gray-50 border-b">
                      <button
                        onClick={() => setExpandedCategories(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {expandedCategories[cat.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>

                      <Folder size={20} className="text-orange-500" />

                      {editingCategory === cat.id ? (
                        <div className="flex-1 flex gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUpdateCategory(cat.id)}
                            className="flex-1 px-3 py-1.5 border rounded-lg text-sm"
                            autoFocus
                          />
                          <button
                            onClick={() => handleUpdateCategory(cat.id)}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"
                          >
                            <CheckCircle size={18} />
                          </button>
                          <button
                            onClick={() => { setEditingCategory(null); setEditName(''); }}
                            className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 font-semibold text-gray-900">{cat.name}</span>
                          <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                            {cat.subcategories?.length || 0} sous-cat.
                          </span>
                          <button
                            onClick={() => { setEditingCategory(cat.id); setEditName(cat.name); }}
                            className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded"
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteCategory(cat.id, cat.name)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Subcategories */}
                    {expandedCategories[cat.id] && (
                      <div className="p-4 space-y-2">
                        {/* Add Subcategory */}
                        {addingSubcategoryTo === cat.id ? (
                          <div className="flex gap-2 mb-3">
                            <input
                              type="text"
                              value={newSubcategoryName}
                              onChange={e => setNewSubcategoryName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddSubcategory(cat.id)}
                              placeholder="Nom de la sous-catégorie..."
                              className="flex-1 px-3 py-2 border rounded-lg text-sm"
                              autoFocus
                            />
                            <button
                              onClick={() => handleAddSubcategory(cat.id)}
                              disabled={!newSubcategoryName.trim()}
                              className="px-3 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
                            >
                              Ajouter
                            </button>
                            <button
                              onClick={() => { setAddingSubcategoryTo(null); setNewSubcategoryName(''); }}
                              className="px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                            >
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingSubcategoryTo(cat.id)}
                            className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-orange-400 hover:text-orange-600 flex items-center justify-center gap-2"
                          >
                            <Plus size={16} />
                            Ajouter une sous-catégorie
                          </button>
                        )}

                        {/* Subcategories List */}
                        {(cat.subcategories || []).length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-2">
                            Aucune sous-catégorie
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {(cat.subcategories || []).map(sub => (
                              <div key={sub.id} className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
                                <Cog size={14} className="text-gray-400" />

                                {editingSubcategory === sub.id ? (
                                  <div className="flex-1 flex gap-2">
                                    <input
                                      type="text"
                                      value={editName}
                                      onChange={e => setEditName(e.target.value)}
                                      onKeyDown={e => e.key === 'Enter' && handleUpdateSubcategory(sub.id)}
                                      className="flex-1 px-2 py-1 border rounded text-sm"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleUpdateSubcategory(sub.id)}
                                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                    >
                                      <CheckCircle size={16} />
                                    </button>
                                    <button
                                      onClick={() => { setEditingSubcategory(null); setEditName(''); }}
                                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="flex-1 text-sm text-gray-700">{sub.name}</span>
                                    <button
                                      onClick={() => { setEditingSubcategory(sub.id); setEditName(sub.name); }}
                                      className="p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                      style={{ opacity: 1 }}
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSubcategory(sub.id, sub.name)}
                                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== EDIT FORM COMPONENT ====================

const EditForm = ({ equipment, onSave, onCancel, showToast, categories = [] }) => {
  const isNew = !equipment?.id;
  const initialFormData = {
    name: '', tag: '', category: '', category_id: '', subcategory_id: '', equipment_type: '',
    manufacturer: '', model: '', power_kw: '', voltage: '', current_a: '', ip_rating: '',
    drive_type: '', coupling: '', mounting: '', fluid: '', flow_m3h: '', pressure_bar: '',
    speed_rpm: '', building: '', floor: '', zone: '', location: '', panel: '',
    ui_status: '', criticality: '', comments: ''
  };

  // Auto-save draft for new items only
  const {
    formData: draftData,
    setFormData: setDraftData,
    clearDraft,
    hasDraft
  } = useFormDraft(isNew ? 'meca_new' : 'meca_disabled', initialFormData, { debounceMs: 500 });

  const [form, setFormInternal] = useState(initialFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);

  // Sync form with draft or equipment
  const setForm = useCallback((newData) => {
    if (typeof newData === 'function') {
      setFormInternal(prev => {
        const updated = newData(prev);
        if (isNew) setDraftData(updated);
        return updated;
      });
    } else {
      setFormInternal(newData);
      if (isNew) setDraftData(newData);
    }
  }, [isNew, setDraftData]);

  // Debug: Log received categories
  useEffect(() => {
    console.log('[EditForm] Categories received:', categories.length, categories);
  }, [categories]);

  useEffect(() => {
    if (equipment?.id) {
      // Editing existing equipment
      setFormInternal({
        name: equipment.name || '',
        tag: equipment.tag || '',
        category: equipment.category || '',
        category_id: equipment.category_id || '',
        subcategory_id: equipment.subcategory_id || '',
        equipment_type: equipment.equipment_type || '',
        manufacturer: equipment.manufacturer || '',
        model: equipment.model || '',
        power_kw: equipment.power_kw ?? '',
        voltage: equipment.voltage || '',
        current_a: equipment.current_a ?? '',
        ip_rating: equipment.ip_rating || '',
        drive_type: equipment.drive_type || '',
        coupling: equipment.coupling || '',
        mounting: equipment.mounting || '',
        fluid: equipment.fluid || '',
        flow_m3h: equipment.flow_m3h ?? '',
        pressure_bar: equipment.pressure_bar ?? '',
        speed_rpm: equipment.speed_rpm ?? '',
        building: equipment.building || '',
        floor: equipment.floor || '',
        zone: equipment.zone || '',
        location: equipment.location || '',
        panel: equipment.panel || '',
        ui_status: equipment.ui_status || equipment.status || '',
        criticality: equipment.criticality || '',
        comments: equipment.comments || ''
      });
    } else if (isNew && hasDraft) {
      // New equipment - restore from draft
      setFormInternal(draftData);
    }
  }, [equipment, isNew, hasDraft, draftData]);

  // Get subcategories for the selected category
  const selectedCategory = categories.find(c => c.id === form.category_id);
  const subcategories = selectedCategory?.subcategories || [];

  const handleCategoryChange = (categoryId) => {
    const cat = categories.find(c => c.id === categoryId);
    setForm(f => ({
      ...f,
      category_id: categoryId,
      category: cat?.name || '',
      subcategory_id: '' // Reset subcategory when category changes
    }));
  };

  const handleSubcategoryChange = (subcategoryId) => {
    const sub = subcategories.find(s => s.id === subcategoryId);
    setForm(f => ({
      ...f,
      subcategory_id: subcategoryId,
      equipment_type: sub?.name || f.equipment_type // Use subcategory name as equipment type
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...form,
        // Map ui_status to status for backend compatibility
        status: form.ui_status,
        power_kw: form.power_kw !== '' ? Number(form.power_kw) : null,
        current_a: form.current_a !== '' ? Number(form.current_a) : null,
        flow_m3h: form.flow_m3h !== '' ? Number(form.flow_m3h) : null,
        pressure_bar: form.pressure_bar !== '' ? Number(form.pressure_bar) : null,
        speed_rpm: form.speed_rpm !== '' ? Number(form.speed_rpm) : null,
      };
      // Remove ui_status from payload since we've mapped it to status
      delete payload.ui_status;
      await onSave(payload);
      // Clear draft after successful save
      if (isNew) clearDraft();
    } finally {
      setIsSaving(false);
    }
  };

  const handleAIComplete = (data) => {
    setForm(prev => ({
      ...prev,
      manufacturer: data.manufacturer || prev.manufacturer,
      model: data.model || prev.model,
      category: data.category || prev.category,
      equipment_type: data.equipment_type || prev.equipment_type,
      voltage: data.voltage || prev.voltage,
      ip_rating: data.ip_rating || prev.ip_rating,
      fluid: data.fluid || prev.fluid,
      power_kw: data.power_kw ?? prev.power_kw,
      current_a: data.current_a ?? prev.current_a,
      flow_m3h: data.flow_m3h ?? prev.flow_m3h,
      pressure_bar: data.pressure_bar ?? prev.pressure_bar,
      speed_rpm: data.speed_rpm ?? prev.speed_rpm,
    }));
    showToast?.('Données appliquées', 'success');
  };

  // Fallback categories if none defined in DB
  const FALLBACK_CATEGORIES = [
    'Pompe', 'Ventilateur', 'Compresseur', 'Moteur', 'Convoyeur',
    'Agitateur', 'Broyeur', 'Malaxeur', 'Extracteur', 'Autre'
  ];

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Edit3 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {equipment?.id ? 'Modifier l\'équipement' : 'Nouvel équipement'}
              </h2>
              <p className="text-orange-100 text-sm">
                {equipment?.name || 'Remplissez les informations'}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-lg">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* AI Button */}
        <button
          onClick={() => setShowAIModal(true)}
          className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-700 flex items-center justify-center gap-2"
        >
          <Sparkles size={18} />
          Analyser une photo (IA)
        </button>

        {/* Identification */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Tag size={16} className="text-orange-500" />
            Identification
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={inputBaseClass}
                placeholder="Nom de l'équipement"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tag / Repère</label>
              <input
                type="text"
                value={form.tag}
                onChange={e => setForm(f => ({ ...f, tag: e.target.value }))}
                className={inputBaseClass}
                placeholder="PMP-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Folder size={14} className="inline mr-1 text-orange-500" />
                Équipement (catégorie)
              </label>
              {categories.length > 0 ? (
                <select
                  value={form.category_id}
                  onChange={e => handleCategoryChange(e.target.value)}
                  className={selectBaseClass}
                >
                  <option value="">— Sélectionner —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className={selectBaseClass}
                >
                  <option value="">—</option>
                  {FALLBACK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Cog size={14} className="inline mr-1 text-gray-400" />
                Sous-équipement
              </label>
              {categories.length > 0 && form.category_id ? (
                <select
                  value={form.subcategory_id}
                  onChange={e => handleSubcategoryChange(e.target.value)}
                  className={selectBaseClass}
                  disabled={!form.category_id}
                >
                  <option value="">— Sélectionner —</option>
                  {subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.equipment_type}
                  onChange={e => setForm(f => ({ ...f, equipment_type: e.target.value }))}
                  className={inputBaseClass}
                  placeholder="Moteur, capteur..."
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fabricant</label>
              <input
                type="text"
                value={form.manufacturer}
                onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                className={inputBaseClass}
                placeholder="Grundfos, KSB..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modèle</label>
              <input
                type="text"
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
          </div>
        </div>

        {/* Electrical */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Zap size={16} className="text-orange-500" />
            Électrique
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Puissance (kW)</label>
              <input
                type="number"
                step="0.1"
                value={form.power_kw}
                onChange={e => setForm(f => ({ ...f, power_kw: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tension</label>
              <input
                type="text"
                value={form.voltage}
                onChange={e => setForm(f => ({ ...f, voltage: e.target.value }))}
                className={inputBaseClass}
                placeholder="400V"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Courant (A)</label>
              <input
                type="number"
                step="0.1"
                value={form.current_a}
                onChange={e => setForm(f => ({ ...f, current_a: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Indice IP</label>
              <input
                type="text"
                value={form.ip_rating}
                onChange={e => setForm(f => ({ ...f, ip_rating: e.target.value }))}
                className={inputBaseClass}
                placeholder="IP55"
              />
            </div>
          </div>
        </div>

        {/* Mechanical/Process */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Cog size={16} className="text-orange-500" />
            Mécanique / Process
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Entraînement</label>
              <input
                type="text"
                value={form.drive_type}
                onChange={e => setForm(f => ({ ...f, drive_type: e.target.value }))}
                className={inputBaseClass}
                placeholder="Direct, courroie..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Accouplement</label>
              <input
                type="text"
                value={form.coupling}
                onChange={e => setForm(f => ({ ...f, coupling: e.target.value }))}
                className={inputBaseClass}
                placeholder="Flexible, rigide..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Montage</label>
              <input
                type="text"
                value={form.mounting}
                onChange={e => setForm(f => ({ ...f, mounting: e.target.value }))}
                className={inputBaseClass}
                placeholder="Sur socle, bride..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fluide</label>
              <input
                type="text"
                value={form.fluid}
                onChange={e => setForm(f => ({ ...f, fluid: e.target.value }))}
                className={inputBaseClass}
                placeholder="Eau, air, huile..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Débit (m³/h)</label>
              <input
                type="number"
                step="0.1"
                value={form.flow_m3h}
                onChange={e => setForm(f => ({ ...f, flow_m3h: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pression (bar)</label>
              <input
                type="number"
                step="0.1"
                value={form.pressure_bar}
                onChange={e => setForm(f => ({ ...f, pressure_bar: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vitesse (rpm)</label>
              <input
                type="number"
                value={form.speed_rpm}
                onChange={e => setForm(f => ({ ...f, speed_rpm: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 size={16} className="text-orange-500" />
            Localisation
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bâtiment</label>
              <input
                type="text"
                value={form.building}
                onChange={e => setForm(f => ({ ...f, building: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Étage</label>
              <input
                type="text"
                value={form.floor}
                onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
              <input
                type="text"
                value={form.zone}
                onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Local</label>
              <input
                type="text"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tableau / Coffret</label>
              <input
                type="text"
                value={form.panel}
                onChange={e => setForm(f => ({ ...f, panel: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Info size={16} className="text-orange-500" />
            Statut & Criticité
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
              <select
                value={form.ui_status}
                onChange={e => setForm(f => ({ ...f, ui_status: e.target.value }))}
                className={selectBaseClass}
              >
                <option value="">—</option>
                <option value="en_service">En service</option>
                <option value="hors_service">Hors service</option>
                <option value="spare">Spare</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Criticité</label>
              <select
                value={form.criticality}
                onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))}
                className={selectBaseClass}
              >
                <option value="">—</option>
                <option value="critique">Critique</option>
                <option value="important">Important</option>
                <option value="standard">Standard</option>
              </select>
            </div>
          </div>
        </div>

        {/* Comments */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Commentaires</label>
          <textarea
            value={form.comments}
            onChange={e => setForm(f => ({ ...f, comments: e.target.value }))}
            className={`${inputBaseClass} min-h-[100px]`}
            placeholder="Notes libres..."
          />
        </div>
      </div>

      {/* Actions */}
      <div className="border-t p-4 flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
        >
          Annuler
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 text-white font-medium hover:from-orange-600 hover:to-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
          Enregistrer
        </button>
      </div>

      <AIPhotoModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        onComplete={handleAIComplete}
        showToast={showToast}
      />
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function Meca() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // State
  const [equipments, setEquipments] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);

  // Categories state
  const [categories, setCategories] = useState([]);

  // View mode: 'detail' | 'edit' | 'settings'
  const [viewMode, setViewMode] = useState('detail');

  // Placement state
  const [placedIds, setPlacedIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({});

  // Toast state
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  // Modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportFilters, setReportFilters] = useState({ building: '', status: '', type: '' });
  const [reportLoading, setReportLoading] = useState(false);

  // Control statuses (like Switchboards)
  const [controlStatuses, setControlStatuses] = useState({});

  // Lightbox for image enlargement
  const { lightbox, openLightbox, closeLightbox } = useLightbox();

  // Functions - defined before useEffects that use them
  const loadEquipments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.meca.listEquipments({});
      const list = res?.items || res?.equipments || res || [];
      setEquipments(list);
    } catch (err) {
      console.error('Load equipments error:', err);
      showToast('Erreur lors du chargement', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const loadPlacements = useCallback(async () => {
    try {
      const response = await api.mecaMaps.placedIds();
      // UUIDs are strings, don't convert to numbers
      const ids = response?.placed_ids || [];
      setPlacedIds(new Set(ids));
      setPlacedDetails(response?.placed_details || {});
    } catch (e) {
      console.error("Load placements error:", e);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.meca.listCategories();
      const cats = res?.categories || [];
      console.log('[MECA] Categories loaded:', cats.length, cats);
      setCategories(cats);
    } catch (err) {
      console.error('[MECA] Load categories error:', err);
    }
  }, []);

  // Load control statuses for all MECA equipments (like Switchboards)
  const loadControlStatuses = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules({ equipment_type: 'meca' });
      const schedules = res.schedules || [];
      const statuses = {};
      // Use date-only comparison to fix "today" items being marked as overdue
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      schedules.forEach(s => {
        if (s.meca_equipment_id) {
          const nextDue = s.next_due_date ? new Date(s.next_due_date) : null;
          if (nextDue) nextDue.setHours(0, 0, 0, 0);
          const isOverdue = nextDue && nextDue < now;

          // Initialize if not exists
          if (!statuses[s.meca_equipment_id]) {
            statuses[s.meca_equipment_id] = {
              status: 'ok',
              controls: [],
              overdueCount: 0,
              pendingCount: 0
            };
          }

          const controlInfo = {
            template_name: s.template_name,
            next_due: s.next_due_date,
            status: isOverdue ? 'overdue' : 'pending',
            schedule_id: s.id
          };

          statuses[s.meca_equipment_id].controls.push(controlInfo);

          if (isOverdue) {
            statuses[s.meca_equipment_id].overdueCount++;
            statuses[s.meca_equipment_id].status = 'overdue';
          } else {
            statuses[s.meca_equipment_id].pendingCount++;
            if (statuses[s.meca_equipment_id].status !== 'overdue') {
              statuses[s.meca_equipment_id].status = 'pending';
            }
          }
        }
      });

      setControlStatuses(statuses);
    } catch (e) {
      console.warn('Load control statuses error:', e);
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
    loadPlacements();
    loadCategories();
    loadControlStatuses();
  }, [loadEquipments, loadPlacements, loadCategories, loadControlStatuses]);

  // Refresh placements on visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) loadPlacements();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', loadPlacements);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', loadPlacements);
    };
  }, [loadPlacements]);

  // URL params handling - load equipment from URL on initial page load only
  useEffect(() => {
    const mecaId = searchParams.get('meca');
    // Only fetch if we have a mecaId and no equipment is currently selected
    // Compare as strings since IDs are UUIDs, not numbers
    if (mecaId && (!selectedEquipment || String(selectedEquipment.id) !== mecaId)) {
      api.meca.getEquipment(mecaId)
        .then(res => {
          const eq = res?.equipment || res;
          if (eq) {
            setSelectedEquipment(eq);
            const building = eq.building || 'Sans bâtiment';
            setExpandedBuildings(prev => ({ ...prev, [building]: true }));
          }
        })
        .catch(() => showToast('Équipement non trouvé', 'error'));
    }
  }, [searchParams, showToast, selectedEquipment]);

  const handleSelectEquipment = async (eq) => {
    setSearchParams({ meca: eq.id.toString() });
    setViewMode('detail');
    try {
      const res = await api.meca.getEquipment(eq.id);
      setSelectedEquipment(res?.equipment || res || eq);
    } catch {
      setSelectedEquipment(eq);
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
  };

  const handleEditEquipment = (eq) => {
    setSelectedEquipment(eq);
    setViewMode('edit');
  };

  const handleSaveEquipment = async (payload) => {
    try {
      let saved;
      if (selectedEquipment?.id) {
        saved = await api.meca.updateEquipment(selectedEquipment.id, payload);
        showToast('Équipement modifié !', 'success');
        setEquipments(prev => prev.map(e => e.id === selectedEquipment.id ? { ...e, ...saved?.equipment || saved } : e));
      } else {
        saved = await api.meca.createEquipment(payload);
        showToast('Équipement créé !', 'success');
        setEquipments(prev => [...prev, saved?.equipment || saved]);
      }
      const eq = saved?.equipment || saved;
      setSelectedEquipment(eq);
      setViewMode('detail');
      setSearchParams({ meca: eq.id.toString() });
    } catch (err) {
      console.error('Save error:', err);
      showToast(err.message || 'Erreur lors de l\'enregistrement', 'error');
      throw err;
    }
  };

  const handleDeleteEquipment = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.meca.deleteEquipment(deleteTarget.id);
      showToast('Équipement supprimé', 'success');
      setEquipments(prev => prev.filter(e => e.id !== deleteTarget.id));
      if (selectedEquipment?.id === deleteTarget.id) {
        handleCloseEquipment();
      }
      setShowDeleteModal(false);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete error:', err);
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePhotoUpload = async (equipmentId, file) => {
    try {
      await api.meca.uploadPhoto(equipmentId, file);
      showToast('Photo mise à jour', 'success');
      const res = await api.meca.getEquipment(equipmentId);
      const eq = res?.equipment || res;
      setSelectedEquipment(eq);
      setEquipments(prev => prev.map(e => e.id === equipmentId ? { ...e, photo_url: eq.photo_url } : e));
    } catch (err) {
      showToast('Erreur upload photo', 'error');
    }
  };

  const handleNavigateToMap = (eq) => {
    const eqId = eq?.id || selectedEquipment?.id;
    if (!eqId) {
      navigate('/app/meca/map');
      return;
    }

    const details = placedDetails[eqId];
    if (details?.plans?.length > 0) {
      const planKey = details.plans[0];
      navigate(`/app/meca/map?meca=${eqId}&plan=${encodeURIComponent(planKey)}`);
    } else {
      // Pass equipment ID so user can position it on map
      navigate(`/app/meca/map?meca=${eqId}`);
    }
  };

  // Build tree
  const buildingTree = useMemo(() => {
    const filtered = equipments.filter(eq => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        eq.name?.toLowerCase().includes(q) ||
        eq.tag?.toLowerCase().includes(q) ||
        eq.manufacturer?.toLowerCase().includes(q) ||
        eq.building?.toLowerCase().includes(q) ||
        eq.category?.toLowerCase().includes(q)
      );
    });

    const tree = {};
    filtered.forEach(eq => {
      const building = eq.building || 'Sans bâtiment';
      if (!tree[building]) tree[building] = [];
      tree[building].push(eq);
    });
    return tree;
  }, [equipments, searchQuery]);

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

  // Liste des types d'équipements uniques
  const equipmentTypes = useMemo(() => {
    const set = new Set(equipments.map(e => e.equipment_type).filter(Boolean));
    return Array.from(set).sort();
  }, [equipments]);

  // Fonction pour générer le rapport PDF
  const generateReport = useCallback(() => {
    setReportLoading(true);
    try {
      const url = api.meca.reportUrl(reportFilters);
      window.open(url, '_blank');
    } catch (e) {
      showToast('Erreur lors de la génération du rapport', 'error');
    } finally {
      setTimeout(() => {
        setReportLoading(false);
        setShowReportModal(false);
      }, 500);
    }
  }, [reportFilters, showToast]);

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-slideUp { animation: slideUp .3s ease-out forwards; }
        .animate-slideRight { animation: slideRight .3s ease-out forwards; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                onClick={() => setShowMobileDrawer(true)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <Menu size={20} />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="p-2 bg-orange-100 rounded-xl">
                <Cog size={20} className="text-orange-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Équipements mécaniques</h1>
                <p className="text-xs text-gray-500">Pompes, ventilateurs, moteurs...</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs">
              <Badge variant="default">Total: {stats.total}</Badge>
              <Badge variant="success">Localisés: {stats.placed}</Badge>
              <Badge variant="warning">Non localisés: {stats.unplaced}</Badge>
            </div>

            <button
              onClick={() => setShowReportModal(true)}
              className="px-3 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 flex items-center gap-2"
              title="Générer un rapport PDF"
            >
              <FileText size={16} />
              Rapport
            </button>

            <button
              onClick={() => navigate('/app/meca/map')}
              className="px-3 py-2 bg-orange-50 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-100 flex items-center gap-2"
            >
              <MapPin size={16} />
              Carte
            </button>

            <button
              onClick={() => { setSelectedEquipment(null); setViewMode('settings'); }}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
            >
              <Settings size={16} />
              Paramètres
            </button>

            <button
              onClick={handleNewEquipment}
              className="px-3 py-2 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg text-sm font-medium hover:from-orange-600 hover:to-amber-700 flex items-center gap-2"
            >
              <Plus size={16} />
              Nouveau
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex">
        {/* Sidebar - Desktop */}
        {!isMobile && (
          <div className="w-80 bg-white border-r shadow-sm flex flex-col min-h-[calc(100vh-120px)] sticky top-0 self-start">
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
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : Object.keys(buildingTree).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Cog size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Aucun équipement</p>
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
                        <Building2 size={16} className="text-orange-500" />
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
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                              <Cog size={14} className={selectedEquipment?.id === eq.id ? 'text-orange-600' : 'text-gray-400'} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{eq.name || eq.tag || 'Équipement'}</p>
                                <p className="text-xs text-gray-400 truncate">
                                  {eq.category || eq.manufacturer} {eq.power_kw ? `• ${eq.power_kw}kW` : ''}
                                </p>
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
              )}
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 min-h-[calc(100vh-120px)]">
          {viewMode === 'settings' ? (
            <CategoriesSettingsPanel
              onClose={() => { setViewMode('detail'); loadCategories(); }}
              showToast={showToast}
            />
          ) : selectedEquipment ? (
            viewMode === 'edit' ? (
              <EditForm
                equipment={selectedEquipment}
                onSave={handleSaveEquipment}
                onCancel={() => selectedEquipment?.id ? setViewMode('detail') : handleCloseEquipment()}
                showToast={showToast}
                categories={categories}
              />
            ) : (
              <DetailPanel
                equipment={selectedEquipment}
                onClose={handleCloseEquipment}
                onEdit={handleEditEquipment}
                onDelete={(eq) => { setDeleteTarget(eq); setShowDeleteModal(true); }}
                onShare={(eq) => setShowShareModal(true)}
                onNavigateToMap={handleNavigateToMap}
                onPhotoUpload={handlePhotoUpload}
                onImageClick={openLightbox}
                isPlaced={placedIds.has(selectedEquipment.id)}
                showToast={showToast}
                controlStatuses={controlStatuses}
                navigate={navigate}
              />
            )
          ) : (
            <div className="min-h-[calc(100vh-120px)] flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Cog size={40} className="text-gray-300" />
                </div>
                <h3 className="text-lg font-medium text-gray-700">Sélectionnez un équipement</h3>
                <p className="text-gray-500 mt-1">ou créez-en un nouveau</p>
                <button
                  onClick={handleNewEquipment}
                  className="mt-4 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg font-medium hover:from-orange-600 hover:to-amber-700 flex items-center gap-2 mx-auto"
                >
                  <Plus size={18} />
                  Nouvel équipement
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
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
        onConfirm={handleDeleteEquipment}
        itemName={deleteTarget?.name || deleteTarget?.tag || 'cet équipement'}
        isLoading={isDeleting}
      />

      <ShareLinkModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        equipment={selectedEquipment}
      />

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-slideUp">
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl">
                  <FileText size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Rapport PDF</h2>
                  <p className="text-amber-100 text-sm">Équipements mécaniques</p>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="">Tous les bâtiments</option>
                  {buildings.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Filtre Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type d'équipement</label>
                <select
                  value={reportFilters.type}
                  onChange={e => setReportFilters(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="">Tous les types</option>
                  {equipmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Filtre Statut */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                <select
                  value={reportFilters.status}
                  onChange={e => setReportFilters(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="">Tous les statuts</option>
                  <option value="en_service">En service</option>
                  <option value="hors_service">Hors service</option>
                  <option value="spare">Spare</option>
                </select>
              </div>

              {/* Résumé */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm text-amber-800">
                  <span className="font-medium">Le rapport inclura :</span>{' '}
                  {reportFilters.building || "Tous les bâtiments"}
                  {" / "}
                  {reportFilters.type || "Tous les types"}
                  {" / "}
                  {reportFilters.status === "en_service" ? "En service" :
                   reportFilters.status === "hors_service" ? "Hors service" :
                   reportFilters.status === "spare" ? "Spare" : "Tous les statuts"}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t p-4 flex gap-3">
              <button
                onClick={() => { setShowReportModal(false); setReportFilters({ building: '', status: '', type: '' }); }}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={generateReport}
                disabled={reportLoading}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Image Lightbox */}
      {lightbox.open && (
        <ImageLightbox
          src={lightbox.src}
          title={lightbox.title}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
