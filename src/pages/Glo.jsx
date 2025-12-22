// src/pages/Glo.jsx - Global Electrical Equipments (UPS, Compensation, Emergency Lighting)
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Zap, Plus, Search, ChevronRight, ChevronDown, Building2, Layers,
  MoreVertical, Copy, Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Camera, Sparkles, Upload, RefreshCw, Eye, ImagePlus, AlertCircle,
  Menu, Settings, Share2, ExternalLink, MapPin, Power, Battery,
  Tag, Hash, Factory, Gauge, Thermometer, Network, Info, Lightbulb, Sun,
  FolderPlus, Folder, ChevronUp, GripVertical, ClipboardCheck, Clock, Calendar,
  History, FileText, Download
} from 'lucide-react';
import { api } from '../lib/api';
import { EquipmentAIChat } from '../components/AIAvatar';

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

const inputBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400";
const selectBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white text-gray-900";

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
              <p className="text-red-100 text-sm">Cette action est irreversible</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <p className="text-gray-700">
            Supprimer l'equipement <span className="font-semibold">"{itemName}"</span> ?
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

  const url = `${window.location.origin}${window.location.pathname}?glo=${equipment.id}`;

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
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Partager le lien</h2>
              <p className="text-emerald-100 text-sm">{equipment.name || equipment.tag}</p>
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
                copied ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              }`}
            >
              {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
              {copied ? 'Copie!' : 'Copier'}
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

// Mobile Tree Drawer
const MobileTreeDrawer = React.memo(({ isOpen, onClose, tree, expandedBuildings, setExpandedBuildings, selectedEquipment, onSelectEquipment, placedIds }) => {
  if (!isOpen) return null;

  const isPlaced = (id) => placedIds.has(id);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl animate-slideRight overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Equipements</h2>
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
                  <Building2 size={16} className="text-emerald-500" />
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
                          ${selectedEquipment?.id === eq.id ? 'bg-emerald-100 text-emerald-700' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        <Zap size={14} className="text-emerald-500" />
                        <span className="text-sm truncate flex-1">{eq.name || eq.tag || 'Equipement'}</span>
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
      const res = await api.glo.listFiles(equipment.id).catch(() => ({}));
      setFiles(res?.files || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFiles(false);
    }
  };

  if (!equipment) return null;

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

  // Category-specific icon
  const getCategoryIcon = () => {
    const catName = equipment.category_name?.toLowerCase() || '';
    if (catName.includes('ups') || catName.includes('onduleur')) return <Battery size={16} className="text-emerald-500" />;
    if (catName.includes('compensation') || catName.includes('batterie')) return <Zap size={16} className="text-amber-500" />;
    if (catName.includes('eclairage') || catName.includes('secours')) return <Lightbulb size={16} className="text-red-500" />;
    return <Power size={16} className="text-emerald-500" />;
  };

  // Check if any technical specs exist
  const hasTechnicalSpecs = equipment.power_kva || equipment.power_kw || equipment.voltage_input ||
    equipment.voltage_output || equipment.current_a || equipment.frequency_hz ||
    equipment.autonomy_minutes || equipment.autonomy_hours || equipment.reactive_power_kvar ||
    equipment.efficiency_percent || equipment.lumen_output;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors md:hidden"
          >
            <X size={20} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAIChat(true)}
              className={`p-2 rounded-lg transition-all flex items-center gap-1 ${
                hasOverdueControl
                  ? 'bg-amber-500 hover:bg-amber-400 animate-pulse'
                  : 'hover:bg-white/20'
              }`}
              title="Assistant IA"
            >
              <Sparkles size={18} />
            </button>
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
              <img src={api.glo.photoUrl(equipment.id, { bust: true })} alt="" className="w-full h-full object-cover" />
            ) : (
              <Camera size={24} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{equipment.name || 'Equipement'}</h2>
            {equipment.tag && (
              <p className="text-emerald-100 text-sm font-mono">{equipment.tag}</p>
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
                  Localise
                </Badge>
              ) : (
                <Badge variant="warning">
                  <MapPin size={10} className="inline mr-1" />
                  Non localise
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Equipment Structure */}
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Folder size={16} className="text-emerald-500" />
            Structure de l'equipement
          </h3>

          {/* Main Equipment (Category) */}
          <div className="bg-white rounded-lg p-3 border border-emerald-200 mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                {getCategoryIcon()}
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500">Categorie</p>
                <p className="font-semibold text-gray-900">{equipment.category_name || 'Non defini'}</p>
              </div>
            </div>
          </div>

          {/* Sub-Equipment (Subcategory) */}
          {equipment.subcategory_name && (
            <div className="ml-6 bg-white rounded-lg p-3 border border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center">
                  <Zap size={12} className="text-gray-500" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-500">Type</p>
                  <p className="font-medium text-gray-900">{equipment.subcategory_name}</p>
                </div>
              </div>

              {/* Manufacturer & Model */}
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
                      <span className="text-gray-500 text-xs">Modele</span>
                      <p className="font-medium text-gray-800">{equipment.model}</p>
                    </div>
                  )}
                  {equipment.serial_number && (
                    <div className="col-span-2">
                      <span className="text-gray-500 text-xs">N serie</span>
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
                <Gauge size={16} className="text-emerald-500" />
                Caracteristiques techniques
              </h3>
              {showTechnical ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {showTechnical && (
              <div className="px-4 pb-4 space-y-4">
                {/* Quick Stats */}
                {(equipment.power_kva || equipment.power_kw || equipment.reactive_power_kvar) && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white rounded-lg p-2 text-center">
                      <Power size={16} className="mx-auto text-emerald-500 mb-1" />
                      <p className="text-lg font-bold text-gray-900">{equipment.power_kva || equipment.power_kw || '-'}</p>
                      <p className="text-xs text-gray-500">{equipment.power_kva ? 'kVA' : 'kW'}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <Battery size={16} className="mx-auto text-amber-500 mb-1" />
                      <p className="text-lg font-bold text-gray-900">{equipment.autonomy_minutes || equipment.autonomy_hours || '-'}</p>
                      <p className="text-xs text-gray-500">{equipment.autonomy_minutes ? 'min' : equipment.autonomy_hours ? 'h' : ''}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <Zap size={16} className="mx-auto text-blue-500 mb-1" />
                      <p className="text-lg font-bold text-gray-900">{equipment.efficiency_percent || equipment.reactive_power_kvar || '-'}</p>
                      <p className="text-xs text-gray-500">{equipment.efficiency_percent ? '%' : equipment.reactive_power_kvar ? 'kVAr' : ''}</p>
                    </div>
                  </div>
                )}

                {/* Electrical */}
                {(equipment.voltage_input || equipment.voltage_output || equipment.current_a || equipment.frequency_hz) && (
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                      <Zap size={12} /> Electrique
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {equipment.voltage_input && (
                        <div>
                          <span className="text-gray-400 text-xs">Tension entree</span>
                          <p className="font-medium">{equipment.voltage_input}</p>
                        </div>
                      )}
                      {equipment.voltage_output && (
                        <div>
                          <span className="text-gray-400 text-xs">Tension sortie</span>
                          <p className="font-medium">{equipment.voltage_output}</p>
                        </div>
                      )}
                      {equipment.current_a && (
                        <div>
                          <span className="text-gray-400 text-xs">Courant</span>
                          <p className="font-medium">{equipment.current_a} A</p>
                        </div>
                      )}
                      {equipment.frequency_hz && (
                        <div>
                          <span className="text-gray-400 text-xs">Frequence</span>
                          <p className="font-medium">{equipment.frequency_hz} Hz</p>
                        </div>
                      )}
                      {equipment.phases && (
                        <div>
                          <span className="text-gray-400 text-xs">Phases</span>
                          <p className="font-medium">{equipment.phases}</p>
                        </div>
                      )}
                      {equipment.ip_rating && (
                        <div>
                          <span className="text-gray-400 text-xs">IP</span>
                          <p className="font-medium">{equipment.ip_rating}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* UPS Specific */}
                {(equipment.ups_type || equipment.ups_topology || equipment.battery_type || equipment.battery_count) && (
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                      <Battery size={12} /> UPS / Onduleur
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {equipment.ups_type && <div><span className="text-gray-400 text-xs">Type UPS</span><p className="font-medium">{equipment.ups_type}</p></div>}
                      {equipment.ups_topology && <div><span className="text-gray-400 text-xs">Topologie</span><p className="font-medium">{equipment.ups_topology}</p></div>}
                      {equipment.battery_type && <div><span className="text-gray-400 text-xs">Type batterie</span><p className="font-medium">{equipment.battery_type}</p></div>}
                      {equipment.battery_count && <div><span className="text-gray-400 text-xs">Nb batteries</span><p className="font-medium">{equipment.battery_count}</p></div>}
                    </div>
                  </div>
                )}

                {/* Compensation Specific */}
                {(equipment.capacitor_type || equipment.steps || equipment.automatic_regulation || equipment.thd_filter) && (
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                      <Zap size={12} /> Compensation
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {equipment.capacitor_type && <div><span className="text-gray-400 text-xs">Type condensateur</span><p className="font-medium">{equipment.capacitor_type}</p></div>}
                      {equipment.steps && <div><span className="text-gray-400 text-xs">Etages</span><p className="font-medium">{equipment.steps}</p></div>}
                      <div><span className="text-gray-400 text-xs">Regulation auto</span><p className="font-medium">{equipment.automatic_regulation ? 'Oui' : 'Non'}</p></div>
                      <div><span className="text-gray-400 text-xs">Filtre THD</span><p className="font-medium">{equipment.thd_filter ? 'Oui' : 'Non'}</p></div>
                    </div>
                  </div>
                )}

                {/* Emergency Lighting Specific */}
                {(equipment.lighting_type || equipment.lamp_type || equipment.lumen_output || equipment.test_button || equipment.self_test) && (
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                      <Lightbulb size={12} /> Eclairage de secours
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {equipment.lighting_type && <div><span className="text-gray-400 text-xs">Type</span><p className="font-medium">{equipment.lighting_type}</p></div>}
                      {equipment.lamp_type && <div><span className="text-gray-400 text-xs">Lampe</span><p className="font-medium">{equipment.lamp_type}</p></div>}
                      {equipment.lumen_output && <div><span className="text-gray-400 text-xs">Lumens</span><p className="font-medium">{equipment.lumen_output} lm</p></div>}
                      <div><span className="text-gray-400 text-xs">Bouton test</span><p className="font-medium">{equipment.test_button ? 'Oui' : 'Non'}</p></div>
                      <div><span className="text-gray-400 text-xs">Auto-test</span><p className="font-medium">{equipment.self_test ? 'Oui' : 'Non'}</p></div>
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
            <Building2 size={16} className="text-emerald-500" />
            Localisation
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Batiment</span>
              <p className="font-medium text-gray-900">{equipment.building || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Etage</span>
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

        {/* Test dates */}
        {(equipment.last_test_date || equipment.next_test_date) && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Calendar size={16} className="text-blue-500" />
              Tests
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {equipment.last_test_date && (
                <div>
                  <span className="text-gray-500">Dernier test</span>
                  <p className="font-medium text-gray-900">{new Date(equipment.last_test_date).toLocaleDateString('fr-FR')}</p>
                </div>
              )}
              {equipment.next_test_date && (
                <div>
                  <span className="text-gray-500">Prochain test</span>
                  <p className="font-medium text-gray-900">{new Date(equipment.next_test_date).toLocaleDateString('fr-FR')}</p>
                </div>
              )}
            </div>
          </div>
        )}

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
                onClick={() => navigate(`/app/switchboard-controls?tab=history&equipment_type=glo&glo_equipment_id=${equipment.id}`)}
                className="p-2 sm:px-3 sm:py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
                title="Historique"
              >
                <History size={14} />
                <span className="hidden sm:inline">Historique</span>
              </button>
              <button
                onClick={() => navigate(`/app/switchboard-controls?tab=schedules&equipment_type=glo&glo_equipment_id=${equipment.id}`)}
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
            <h3 className="font-semibold text-gray-900 mb-3">Pieces jointes</h3>
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
          className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-medium hover:from-emerald-600 hover:to-teal-700 transition-all flex items-center justify-center gap-2"
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
    </div>
  );
};

// ==================== CATEGORIES SETTINGS PANEL ====================

const CategoriesSettingsPanel = ({ onClose, showToast }) => {
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState({});

  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [addingSubcategoryTo, setAddingSubcategoryTo] = useState(null);

  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSubcategory, setEditingSubcategory] = useState(null);
  const [editName, setEditName] = useState('');

  const loadCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.glo.listCategories();
      setCategories(res?.categories || []);
    } catch (err) {
      console.error('Load categories error:', err);
      showToast?.('Erreur lors du chargement des categories', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setIsAddingCategory(true);
    try {
      await api.glo.createCategory({ name: newCategoryName.trim() });
      showToast?.('Categorie creee', 'success');
      setNewCategoryName('');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la creation', 'error');
    } finally {
      setIsAddingCategory(false);
    }
  };

  const handleUpdateCategory = async (id) => {
    if (!editName.trim()) return;
    try {
      await api.glo.updateCategory(id, { name: editName.trim() });
      showToast?.('Categorie modifiee', 'success');
      setEditingCategory(null);
      setEditName('');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la modification', 'error');
    }
  };

  const handleDeleteCategory = async (id, name) => {
    if (!window.confirm(`Supprimer la categorie "${name}" et toutes ses sous-categories ?`)) return;
    try {
      await api.glo.deleteCategory(id);
      showToast?.('Categorie supprimee', 'success');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la suppression', 'error');
    }
  };

  const handleAddSubcategory = async (categoryId) => {
    if (!newSubcategoryName.trim()) return;
    try {
      await api.glo.createSubcategory({
        category_id: categoryId,
        name: newSubcategoryName.trim()
      });
      showToast?.('Sous-categorie creee', 'success');
      setNewSubcategoryName('');
      setAddingSubcategoryTo(null);
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la creation', 'error');
    }
  };

  const handleUpdateSubcategory = async (id) => {
    if (!editName.trim()) return;
    try {
      await api.glo.updateSubcategory(id, { name: editName.trim() });
      showToast?.('Sous-categorie modifiee', 'success');
      setEditingSubcategory(null);
      setEditName('');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la modification', 'error');
    }
  };

  const handleDeleteSubcategory = async (id, name) => {
    if (!window.confirm(`Supprimer la sous-categorie "${name}" ?`)) return;
    try {
      await api.glo.deleteSubcategory(id);
      showToast?.('Sous-categorie supprimee', 'success');
      loadCategories();
    } catch (err) {
      showToast?.('Erreur lors de la suppression', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Settings size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Parametres</h2>
              <p className="text-emerald-100 text-sm">Gerer les categories et sous-categories</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={32} className="animate-spin text-emerald-500" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <FolderPlus size={18} className="text-emerald-500" />
                Ajouter une categorie
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                  placeholder="Ex: UPS Modulaire, BAES..."
                  className={inputBaseClass}
                />
                <button
                  onClick={handleAddCategory}
                  disabled={!newCategoryName.trim() || isAddingCategory}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-medium hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                >
                  {isAddingCategory ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  Ajouter
                </button>
              </div>
            </div>

            {categories.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Folder size={48} className="mx-auto mb-3 text-gray-300" />
                <p>Aucune categorie definie</p>
                <p className="text-sm mt-1">Commencez par creer une categorie</p>
              </div>
            ) : (
              <div className="space-y-3">
                {categories.map(cat => (
                  <div key={cat.id} className="border rounded-xl overflow-hidden bg-white shadow-sm">
                    <div className="flex items-center gap-3 p-4 bg-gray-50 border-b">
                      <button
                        onClick={() => setExpandedCategories(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {expandedCategories[cat.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>

                      <span className="text-xl">{cat.icon || '📁'}</span>

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
                          <button onClick={() => handleUpdateCategory(cat.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded">
                            <CheckCircle size={18} />
                          </button>
                          <button onClick={() => { setEditingCategory(null); setEditName(''); }} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded">
                            <X size={18} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 font-semibold text-gray-900">{cat.name}</span>
                          <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                            {cat.subcategories?.length || 0} sous-cat.
                          </span>
                          <button onClick={() => { setEditingCategory(cat.id); setEditName(cat.name); }} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded">
                            <Edit3 size={16} />
                          </button>
                          <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>

                    {expandedCategories[cat.id] && (
                      <div className="p-4 space-y-2">
                        {addingSubcategoryTo === cat.id ? (
                          <div className="flex gap-2 mb-3">
                            <input
                              type="text"
                              value={newSubcategoryName}
                              onChange={e => setNewSubcategoryName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddSubcategory(cat.id)}
                              placeholder="Nom de la sous-categorie..."
                              className="flex-1 px-3 py-2 border rounded-lg text-sm"
                              autoFocus
                            />
                            <button onClick={() => handleAddSubcategory(cat.id)} disabled={!newSubcategoryName.trim()} className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50">
                              Ajouter
                            </button>
                            <button onClick={() => { setAddingSubcategoryTo(null); setNewSubcategoryName(''); }} className="px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingSubcategoryTo(cat.id)} className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-emerald-400 hover:text-emerald-600 flex items-center justify-center gap-2">
                            <Plus size={16} />
                            Ajouter une sous-categorie
                          </button>
                        )}

                        {(cat.subcategories || []).length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-2">Aucune sous-categorie</p>
                        ) : (
                          <div className="space-y-1">
                            {(cat.subcategories || []).map(sub => (
                              <div key={sub.id} className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
                                <Zap size={14} className="text-gray-400" />
                                {editingSubcategory === sub.id ? (
                                  <div className="flex-1 flex gap-2">
                                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleUpdateSubcategory(sub.id)} className="flex-1 px-2 py-1 border rounded text-sm" autoFocus />
                                    <button onClick={() => handleUpdateSubcategory(sub.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><CheckCircle size={16} /></button>
                                    <button onClick={() => { setEditingSubcategory(null); setEditName(''); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={16} /></button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="flex-1 text-sm text-gray-700">{sub.name}</span>
                                    <button onClick={() => { setEditingSubcategory(sub.id); setEditName(sub.name); }} className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded"><Edit3 size={14} /></button>
                                    <button onClick={() => handleDeleteSubcategory(sub.id, sub.name)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
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

      {/* AI Chat Modal */}
      <EquipmentAIChat
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        equipmentType="glo"
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

// ==================== EDIT FORM COMPONENT ====================

const EditForm = ({ equipment, onSave, onCancel, showToast, categories = [] }) => {
  const [form, setForm] = useState({
    name: '', tag: '', equipment_type: '', function: '',
    category_id: '', subcategory_id: '',
    building: '', floor: '', zone: '', location: '', panel: '',
    power_kva: '', power_kw: '', voltage_input: '', voltage_output: '',
    current_a: '', frequency_hz: '', phases: '', ip_rating: '',
    // UPS
    ups_type: '', ups_topology: '', battery_type: '', battery_count: '',
    autonomy_minutes: '', efficiency_percent: '',
    // Compensation
    reactive_power_kvar: '', capacitor_type: '', steps: '',
    automatic_regulation: false, thd_filter: false,
    // Emergency Lighting
    lighting_type: '', lamp_type: '', lumen_output: '', autonomy_hours: '',
    test_button: false, self_test: false,
    // General
    manufacturer: '', model: '', serial_number: '', year: '',
    status: '', criticality: '', last_test_date: '', next_test_date: '', comments: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (equipment) {
      setForm({
        name: equipment.name || '', tag: equipment.tag || '',
        equipment_type: equipment.equipment_type || '', function: equipment.function || '',
        category_id: equipment.category_id || '', subcategory_id: equipment.subcategory_id || '',
        building: equipment.building || '', floor: equipment.floor || '',
        zone: equipment.zone || '', location: equipment.location || '', panel: equipment.panel || '',
        power_kva: equipment.power_kva ?? '', power_kw: equipment.power_kw ?? '',
        voltage_input: equipment.voltage_input || '', voltage_output: equipment.voltage_output || '',
        current_a: equipment.current_a ?? '', frequency_hz: equipment.frequency_hz ?? '',
        phases: equipment.phases || '', ip_rating: equipment.ip_rating || '',
        ups_type: equipment.ups_type || '', ups_topology: equipment.ups_topology || '',
        battery_type: equipment.battery_type || '', battery_count: equipment.battery_count ?? '',
        autonomy_minutes: equipment.autonomy_minutes ?? '', efficiency_percent: equipment.efficiency_percent ?? '',
        reactive_power_kvar: equipment.reactive_power_kvar ?? '', capacitor_type: equipment.capacitor_type || '',
        steps: equipment.steps ?? '', automatic_regulation: equipment.automatic_regulation || false,
        thd_filter: equipment.thd_filter || false,
        lighting_type: equipment.lighting_type || '', lamp_type: equipment.lamp_type || '',
        lumen_output: equipment.lumen_output ?? '', autonomy_hours: equipment.autonomy_hours ?? '',
        test_button: equipment.test_button || false, self_test: equipment.self_test || false,
        manufacturer: equipment.manufacturer || '', model: equipment.model || '',
        serial_number: equipment.serial_number || '', year: equipment.year || '',
        status: equipment.status || '', criticality: equipment.criticality || '',
        last_test_date: equipment.last_test_date || '', next_test_date: equipment.next_test_date || '',
        comments: equipment.comments || ''
      });
    }
  }, [equipment]);

  const selectedCategory = categories.find(c => c.id === form.category_id);
  const subcategories = selectedCategory?.subcategories || [];

  const handleCategoryChange = (categoryId) => {
    setForm(f => ({ ...f, category_id: categoryId, subcategory_id: '' }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...form,
        power_kva: form.power_kva !== '' ? Number(form.power_kva) : null,
        power_kw: form.power_kw !== '' ? Number(form.power_kw) : null,
        current_a: form.current_a !== '' ? Number(form.current_a) : null,
        frequency_hz: form.frequency_hz !== '' ? Number(form.frequency_hz) : null,
        battery_count: form.battery_count !== '' ? Number(form.battery_count) : null,
        autonomy_minutes: form.autonomy_minutes !== '' ? Number(form.autonomy_minutes) : null,
        efficiency_percent: form.efficiency_percent !== '' ? Number(form.efficiency_percent) : null,
        reactive_power_kvar: form.reactive_power_kvar !== '' ? Number(form.reactive_power_kvar) : null,
        steps: form.steps !== '' ? Number(form.steps) : null,
        lumen_output: form.lumen_output !== '' ? Number(form.lumen_output) : null,
        autonomy_hours: form.autonomy_hours !== '' ? Number(form.autonomy_hours) : null,
        last_test_date: form.last_test_date || null,
        next_test_date: form.next_test_date || null,
      };
      await onSave(payload);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Edit3 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">{equipment?.id ? 'Modifier' : 'Nouvel equipement'}</h2>
              <p className="text-emerald-100 text-sm">{equipment?.name || 'Remplissez les informations'}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-lg"><X size={20} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Identification */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Tag size={16} className="text-emerald-500" />
            Identification
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputBaseClass} placeholder="Nom de l'equipement" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tag</label>
              <input type="text" value={form.tag} onChange={e => setForm(f => ({ ...f, tag: e.target.value }))} className={inputBaseClass} placeholder="UPS-001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
              <select value={form.category_id} onChange={e => handleCategoryChange(e.target.value)} className={selectBaseClass}>
                <option value="">-- Selectionner --</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sous-categorie</label>
              <select value={form.subcategory_id} onChange={e => setForm(f => ({ ...f, subcategory_id: e.target.value }))} className={selectBaseClass} disabled={!form.category_id}>
                <option value="">-- Selectionner --</option>
                {subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fabricant</label>
              <input type="text" value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} className={inputBaseClass} placeholder="APC, Schneider..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modele</label>
              <input type="text" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">N serie</label>
              <input type="text" value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Annee</label>
              <input type="text" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} className={inputBaseClass} placeholder="2020" />
            </div>
          </div>
        </div>

        {/* Electrical */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Zap size={16} className="text-emerald-500" />
            Electrique
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Puissance (kVA)</label>
              <input type="number" step="0.1" value={form.power_kva} onChange={e => setForm(f => ({ ...f, power_kva: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Puissance (kW)</label>
              <input type="number" step="0.1" value={form.power_kw} onChange={e => setForm(f => ({ ...f, power_kw: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tension entree</label>
              <input type="text" value={form.voltage_input} onChange={e => setForm(f => ({ ...f, voltage_input: e.target.value }))} className={inputBaseClass} placeholder="400V" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tension sortie</label>
              <input type="text" value={form.voltage_output} onChange={e => setForm(f => ({ ...f, voltage_output: e.target.value }))} className={inputBaseClass} placeholder="230V" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Courant (A)</label>
              <input type="number" step="0.1" value={form.current_a} onChange={e => setForm(f => ({ ...f, current_a: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequence (Hz)</label>
              <input type="number" value={form.frequency_hz} onChange={e => setForm(f => ({ ...f, frequency_hz: e.target.value }))} className={inputBaseClass} placeholder="50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phases</label>
              <select value={form.phases} onChange={e => setForm(f => ({ ...f, phases: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="1P">Monophase</option>
                <option value="3P">Triphase</option>
                <option value="3P+N">Triphase + N</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">IP</label>
              <input type="text" value={form.ip_rating} onChange={e => setForm(f => ({ ...f, ip_rating: e.target.value }))} className={inputBaseClass} placeholder="IP20" />
            </div>
          </div>
        </div>

        {/* UPS Specific */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Battery size={16} className="text-emerald-500" />
            UPS / Onduleur
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type UPS</label>
              <select value={form.ups_type} onChange={e => setForm(f => ({ ...f, ups_type: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="Online">Online</option>
                <option value="Line-Interactive">Line-Interactive</option>
                <option value="Offline">Offline</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Topologie</label>
              <select value={form.ups_topology} onChange={e => setForm(f => ({ ...f, ups_topology: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="Double conversion">Double conversion</option>
                <option value="Delta conversion">Delta conversion</option>
                <option value="Standby">Standby</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type batterie</label>
              <select value={form.battery_type} onChange={e => setForm(f => ({ ...f, battery_type: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="Plomb">Plomb</option>
                <option value="Lithium-ion">Lithium-ion</option>
                <option value="NiCd">NiCd</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nb batteries</label>
              <input type="number" value={form.battery_count} onChange={e => setForm(f => ({ ...f, battery_count: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Autonomie (min)</label>
              <input type="number" value={form.autonomy_minutes} onChange={e => setForm(f => ({ ...f, autonomy_minutes: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rendement (%)</label>
              <input type="number" step="0.1" value={form.efficiency_percent} onChange={e => setForm(f => ({ ...f, efficiency_percent: e.target.value }))} className={inputBaseClass} />
            </div>
          </div>
        </div>

        {/* Compensation Specific */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Zap size={16} className="text-amber-500" />
            Batterie de Compensation
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Puissance reactive (kVAr)</label>
              <input type="number" step="0.1" value={form.reactive_power_kvar} onChange={e => setForm(f => ({ ...f, reactive_power_kvar: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type condensateur</label>
              <select value={form.capacitor_type} onChange={e => setForm(f => ({ ...f, capacitor_type: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="Sec">Sec</option>
                <option value="Impregne">Impregne</option>
                <option value="Film">Film</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nb etages</label>
              <input type="number" value={form.steps} onChange={e => setForm(f => ({ ...f, steps: e.target.value }))} className={inputBaseClass} />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="auto_reg" checked={form.automatic_regulation} onChange={e => setForm(f => ({ ...f, automatic_regulation: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500" />
              <label htmlFor="auto_reg" className="text-sm font-medium text-gray-700">Regulation automatique</label>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="thd" checked={form.thd_filter} onChange={e => setForm(f => ({ ...f, thd_filter: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500" />
              <label htmlFor="thd" className="text-sm font-medium text-gray-700">Filtre THD</label>
            </div>
          </div>
        </div>

        {/* Emergency Lighting Specific */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Lightbulb size={16} className="text-red-500" />
            Eclairage de Secours
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={form.lighting_type} onChange={e => setForm(f => ({ ...f, lighting_type: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="BAES">BAES</option>
                <option value="BAEH">BAEH</option>
                <option value="Source centralisee">Source centralisee</option>
                <option value="Projecteur">Projecteur</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type lampe</label>
              <select value={form.lamp_type} onChange={e => setForm(f => ({ ...f, lamp_type: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="LED">LED</option>
                <option value="Fluorescent">Fluorescent</option>
                <option value="Incandescent">Incandescent</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lumens</label>
              <input type="number" value={form.lumen_output} onChange={e => setForm(f => ({ ...f, lumen_output: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Autonomie (h)</label>
              <input type="number" step="0.5" value={form.autonomy_hours} onChange={e => setForm(f => ({ ...f, autonomy_hours: e.target.value }))} className={inputBaseClass} />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="test_btn" checked={form.test_button} onChange={e => setForm(f => ({ ...f, test_button: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500" />
              <label htmlFor="test_btn" className="text-sm font-medium text-gray-700">Bouton test</label>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="self_test" checked={form.self_test} onChange={e => setForm(f => ({ ...f, self_test: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500" />
              <label htmlFor="self_test" className="text-sm font-medium text-gray-700">Auto-test</label>
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 size={16} className="text-emerald-500" />
            Localisation
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batiment</label>
              <input type="text" value={form.building} onChange={e => setForm(f => ({ ...f, building: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Etage</label>
              <input type="text" value={form.floor} onChange={e => setForm(f => ({ ...f, floor: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
              <input type="text" value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Local</label>
              <input type="text" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className={inputBaseClass} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tableau</label>
              <input type="text" value={form.panel} onChange={e => setForm(f => ({ ...f, panel: e.target.value }))} className={inputBaseClass} />
            </div>
          </div>
        </div>

        {/* Status & Tests */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Info size={16} className="text-emerald-500" />
            Statut & Tests
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="en_service">En service</option>
                <option value="hors_service">Hors service</option>
                <option value="spare">Spare</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Criticite</label>
              <select value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))} className={selectBaseClass}>
                <option value="">--</option>
                <option value="critique">Critique</option>
                <option value="important">Important</option>
                <option value="standard">Standard</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dernier test</label>
              <input type="date" value={form.last_test_date} onChange={e => setForm(f => ({ ...f, last_test_date: e.target.value }))} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prochain test</label>
              <input type="date" value={form.next_test_date} onChange={e => setForm(f => ({ ...f, next_test_date: e.target.value }))} className={inputBaseClass} />
            </div>
          </div>
        </div>

        {/* Comments */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Commentaires</label>
          <textarea value={form.comments} onChange={e => setForm(f => ({ ...f, comments: e.target.value }))} className={`${inputBaseClass} min-h-[100px]`} placeholder="Notes..." />
        </div>
      </div>

      <div className="border-t p-4 flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
        <button onClick={handleSave} disabled={isSaving} className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
          Enregistrer
        </button>
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function Glo() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [equipments, setEquipments] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);

  const [categories, setCategories] = useState([]);
  const [viewMode, setViewMode] = useState('detail');
  const [placedIds, setPlacedIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({});

  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportFilters, setReportFilters] = useState({ building: '', status: '', equipment_type: '' });
  const [reportLoading, setReportLoading] = useState(false);

  // Control statuses (like Switchboards)
  const [controlStatuses, setControlStatuses] = useState({});

  const loadEquipments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.glo.listEquipments({});
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
      const response = await api.gloMaps.placedIds();
      const ids = response?.placed_ids || [];
      setPlacedIds(new Set(ids));
      setPlacedDetails(response?.placed_details || {});
    } catch (e) {
      console.error("Load placements error:", e);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.glo.listCategories();
      setCategories(res?.categories || []);
    } catch (err) {
      console.error('Load categories error:', err);
    }
  }, []);

  // Load control statuses for all GLO equipments (like Switchboards)
  const loadControlStatuses = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules({ equipment_type: 'glo' });
      const schedules = res.schedules || [];
      const statuses = {};
      const now = new Date();

      schedules.forEach(s => {
        if (s.glo_equipment_id) {
          const nextDue = s.next_due_date ? new Date(s.next_due_date) : null;
          const isOverdue = nextDue && nextDue < now;

          // Initialize if not exists
          if (!statuses[s.glo_equipment_id]) {
            statuses[s.glo_equipment_id] = {
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

          statuses[s.glo_equipment_id].controls.push(controlInfo);

          if (isOverdue) {
            statuses[s.glo_equipment_id].overdueCount++;
            statuses[s.glo_equipment_id].status = 'overdue';
          } else {
            statuses[s.glo_equipment_id].pendingCount++;
            if (statuses[s.glo_equipment_id].status !== 'overdue') {
              statuses[s.glo_equipment_id].status = 'pending';
            }
          }
        }
      });

      setControlStatuses(statuses);
    } catch (e) {
      console.warn('Load control statuses error:', e);
    }
  }, []);

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

  useEffect(() => {
    const gloId = searchParams.get('glo');
    if (gloId && (!selectedEquipment || selectedEquipment.id !== gloId)) {
      api.glo.getEquipment(gloId)
        .then(res => {
          const eq = res?.equipment || res;
          if (eq) {
            setSelectedEquipment(eq);
            const building = eq.building || 'Sans batiment';
            setExpandedBuildings(prev => ({ ...prev, [building]: true }));
          }
        })
        .catch(() => showToast('Equipement non trouve', 'error'));
    }
  }, [searchParams, showToast]);

  const handleSelectEquipment = async (eq) => {
    setSearchParams({ glo: eq.id.toString() });
    setViewMode('detail');
    try {
      const res = await api.glo.getEquipment(eq.id);
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
        saved = await api.glo.updateEquipment(selectedEquipment.id, payload);
        showToast('Equipement modifie !', 'success');
        setEquipments(prev => prev.map(e => e.id === selectedEquipment.id ? { ...e, ...saved?.equipment || saved } : e));
      } else {
        saved = await api.glo.createEquipment(payload);
        showToast('Equipement cree !', 'success');
        setEquipments(prev => [...prev, saved?.equipment || saved]);
      }
      const eq = saved?.equipment || saved;
      setSelectedEquipment(eq);
      setViewMode('detail');
      setSearchParams({ glo: eq.id.toString() });
    } catch (err) {
      console.error('Save error:', err);
      showToast(err.message || 'Erreur', 'error');
      throw err;
    }
  };

  const handleDeleteEquipment = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.glo.deleteEquipment(deleteTarget.id);
      showToast('Equipement supprime', 'success');
      setEquipments(prev => prev.filter(e => e.id !== deleteTarget.id));
      if (selectedEquipment?.id === deleteTarget.id) handleCloseEquipment();
      setShowDeleteModal(false);
      setDeleteTarget(null);
    } catch (err) {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePhotoUpload = async (equipmentId, file) => {
    try {
      await api.glo.uploadPhoto(equipmentId, file);
      showToast('Photo mise a jour', 'success');
      const res = await api.glo.getEquipment(equipmentId);
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
      navigate('/app/glo/map');
      return;
    }
    const details = placedDetails[eqId];
    if (details?.plans?.length > 0) {
      navigate(`/app/glo/map?glo=${eqId}&plan=${encodeURIComponent(details.plans[0])}`);
    } else {
      // Pass equipment ID so user can position it on map
      navigate(`/app/glo/map?glo=${eqId}`);
    }
  };

  const buildingTree = useMemo(() => {
    const filtered = equipments.filter(eq => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        eq.name?.toLowerCase().includes(q) ||
        eq.tag?.toLowerCase().includes(q) ||
        eq.manufacturer?.toLowerCase().includes(q) ||
        eq.building?.toLowerCase().includes(q) ||
        eq.category_name?.toLowerCase().includes(q)
      );
    });

    const tree = {};
    filtered.forEach(eq => {
      const building = eq.building || 'Sans batiment';
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
  const gloEquipmentTypes = useMemo(() => {
    const set = new Set(equipments.map(e => e.equipment_type).filter(Boolean));
    return Array.from(set).sort();
  }, [equipments]);

  // Fonction pour générer le rapport PDF
  const generateReport = useCallback(() => {
    setReportLoading(true);
    try {
      const url = api.glo.reportUrl(reportFilters);
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
              <button onClick={() => setShowMobileDrawer(true)} className="p-2 hover:bg-gray-100 rounded-lg">
                <Menu size={20} />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-100 rounded-xl">
                <Zap size={20} className="text-emerald-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Global Electrical Equipments</h1>
                <p className="text-xs text-gray-500">UPS, Batteries de compensation, Eclairages de secours</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs">
              <Badge variant="default">Total: {stats.total}</Badge>
              <Badge variant="success">Localises: {stats.placed}</Badge>
              <Badge variant="warning">Non localises: {stats.unplaced}</Badge>
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
              onClick={() => navigate('/app/glo/map')}
              className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 flex items-center gap-2"
            >
              <MapPin size={16} />
              Carte
            </button>

            <button
              onClick={() => { setSelectedEquipment(null); setViewMode('settings'); }}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
            >
              <Settings size={16} />
              Parametres
            </button>

            <button
              onClick={handleNewEquipment}
              className="px-3 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg text-sm font-medium hover:from-emerald-600 hover:to-teal-700 flex items-center gap-2"
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

            <div className="flex-1 overflow-y-auto p-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : Object.keys(buildingTree).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Zap size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Aucun equipement</p>
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
                        <Building2 size={16} className="text-emerald-500" />
                        <span className="font-medium truncate flex-1">{building}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{eqs.length}</span>
                      </button>

                      {expandedBuildings[building] && (
                        <div className="ml-4 space-y-1 mt-1">
                          {eqs.map(eq => (
                            <button
                              key={eq.id}
                              onClick={() => handleSelectEquipment(eq)}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-lg transition-colors
                                ${selectedEquipment?.id === eq.id ? 'bg-emerald-100 text-emerald-700' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                              <Zap size={14} className={selectedEquipment?.id === eq.id ? 'text-emerald-600' : 'text-gray-400'} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{eq.name || eq.tag || 'Equipement'}</p>
                                <p className="text-xs text-gray-400 truncate">{eq.category_name || eq.manufacturer}</p>
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
            <CategoriesSettingsPanel onClose={() => { setViewMode('detail'); loadCategories(); }} showToast={showToast} />
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
                  <Zap size={40} className="text-gray-300" />
                </div>
                <h3 className="text-lg font-medium text-gray-700">Selectionnez un equipement</h3>
                <p className="text-gray-500 mt-1">ou creez-en un nouveau</p>
                <button
                  onClick={handleNewEquipment}
                  className="mt-4 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg font-medium hover:from-emerald-600 hover:to-teal-700 flex items-center gap-2 mx-auto"
                >
                  <Plus size={18} />
                  Nouvel equipement
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
        itemName={deleteTarget?.name || deleteTarget?.tag || 'cet equipement'}
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
                  <p className="text-amber-100 text-sm">Équipements globaux (UPS, Compensation, Éclairage)</p>
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
                  value={reportFilters.equipment_type}
                  onChange={e => setReportFilters(f => ({ ...f, equipment_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="">Tous les types</option>
                  {gloEquipmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
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
                  {reportFilters.equipment_type || "Tous les types"}
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
                onClick={() => { setShowReportModal(false); setReportFilters({ building: '', status: '', equipment_type: '' }); }}
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

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
