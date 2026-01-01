// src/pages/Doors.jsx - Redesigned following VSD/Meca/Switchboard pattern
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useFormDraft } from '../hooks/useFormDraft';
import {
  DoorOpen, Plus, Search, ChevronRight, ChevronDown, Building2, Layers,
  MoreVertical, Copy, Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Camera, Upload, RefreshCw, Eye, AlertCircle, Menu, Share2, ExternalLink,
  MapPin, Tag, Hash, Info, Calendar, Clock, FileText, Download, Check,
  XCircle, HelpCircle, History, ClipboardCheck, Settings, QrCode
} from 'lucide-react';
import { api } from '../lib/api';
import MiniElectro from '../components/MiniElectro';
import AuditHistory from '../components/AuditHistory.jsx';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
dayjs.locale('fr');

// ==================== INLINE STYLES ====================

const InlineStyles = () => (
  <style>{`
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideRight {
      from { opacity: 0; transform: translateX(-20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .animate-slideUp { animation: slideUp 0.3s ease-out forwards; }
    .animate-slideRight { animation: slideRight 0.3s ease-out forwards; }

    @keyframes blinkOrange { 0%,100%{opacity:1} 50%{opacity:0.4} }
    @keyframes blinkRed { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .blink-orange { animation: blinkOrange 1.5s ease-in-out infinite; }
    .blink-red { animation: blinkRed 0.8s ease-in-out infinite; }
  `}</style>
);

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

const inputBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400";
const selectBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-transparent bg-white text-gray-900";

// ==================== STATUS HELPERS ====================

const STATUS = {
  A_FAIRE: 'a_faire',
  EN_COURS: 'en_cours_30',
  EN_RETARD: 'en_retard',
  FAIT: 'fait'
};

const statusConfig = {
  [STATUS.A_FAIRE]: { label: 'À faire', variant: 'success', blink: '', iconColor: 'text-emerald-500' },
  [STATUS.EN_COURS]: { label: 'Sous 30j', variant: 'warning', blink: 'blink-orange', iconColor: 'text-amber-500' },
  [STATUS.EN_RETARD]: { label: 'En retard', variant: 'danger', blink: 'blink-red', iconColor: 'text-red-500' },
  [STATUS.FAIT]: { label: 'Fait', variant: 'info', blink: '', iconColor: 'text-emerald-500' }
};

const getStatusConfig = (status) => statusConfig[status] || statusConfig[STATUS.A_FAIRE];

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
            Supprimer la porte <span className="font-semibold">"{itemName}"</span> ?
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
const ShareLinkModal = ({ isOpen, onClose, door }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !door) return null;

  const url = `${window.location.origin}${window.location.pathname}?door=${door.id}`;

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
        <div className="bg-gradient-to-r from-rose-500 to-red-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Partager le lien</h2>
              <p className="text-rose-100 text-sm">{door.name}</p>
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
                copied ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
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

// Settings Modal
const SettingsModal = ({ isOpen, onClose, settings, onSave, showToast }) => {
  const [localSettings, setLocalSettings] = useState({ checklist_template: [], frequency: '1_an' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocalSettings({
        checklist_template: settings.checklist_template || ['Point 1', 'Point 2', 'Point 3', 'Point 4', 'Point 5'],
        frequency: settings.frequency || '1_an'
      });
    }
  }, [settings]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(localSettings);
      showToast('Paramètres enregistrés', 'success');
      onClose();
    } catch (err) {
      showToast('Erreur lors de la sauvegarde', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateTemplateItem = (index, value) => {
    setLocalSettings(prev => ({
      ...prev,
      checklist_template: prev.checklist_template.map((item, i) => i === index ? value : item)
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slideUp max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-gray-700 to-gray-800 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Settings size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Paramètres</h2>
              <p className="text-gray-300 text-sm">Configuration des contrôles</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Fréquence des contrôles</label>
            <select
              value={localSettings.frequency}
              onChange={e => setLocalSettings(prev => ({ ...prev, frequency: e.target.value }))}
              className={selectBaseClass}
            >
              <option value="1_mois">Tous les mois</option>
              <option value="3_mois">Tous les 3 mois</option>
              <option value="2_an">Tous les 6 mois</option>
              <option value="1_an">Tous les ans</option>
              <option value="2_ans">Tous les 2 ans</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Points de contrôle (5 max)</label>
            <div className="space-y-2">
              {localSettings.checklist_template.map((item, index) => (
                <input
                  key={index}
                  type="text"
                  value={item}
                  onChange={e => updateTemplateItem(index, e.target.value)}
                  className={inputBaseClass}
                  placeholder={`Point ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="border-t p-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-gray-700 to-gray-800 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
};

// Calendar Modal
const CalendarModal = ({ isOpen, onClose, events = [], onDayClick }) => {
  const [cursor, setCursor] = useState(() => dayjs().startOf('month'));

  if (!isOpen) return null;

  const start = cursor.startOf('week');
  const end = cursor.endOf('month').endOf('week');
  const days = [];
  let d = start;
  while (d.isBefore(end) || d.isSame(end, 'day')) {
    days.push(d);
    d = d.add(1, 'day');
  }

  const eventMap = new Map();
  for (const e of events) {
    const k = dayjs(e.date).format('YYYY-MM-DD');
    const arr = eventMap.get(k) || [];
    arr.push(e);
    eventMap.set(k, arr);
  }

  const getStatusColor = (status) => {
    if (status === 'en_retard') return 'bg-red-100 text-red-700';
    if (status === 'en_cours_30') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-slideUp max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-rose-500 to-red-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Calendar size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Calendrier des contrôles</h2>
                <p className="text-rose-200 text-sm">Visualisez les prochains contrôles</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg text-gray-900">{cursor.format('MMMM YYYY')}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCursor(cursor.subtract(1, 'month'))}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
              >
                ◀ Précédent
              </button>
              <button
                onClick={() => setCursor(dayjs().startOf('month'))}
                className="px-3 py-1.5 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded-lg text-sm font-medium"
              >
                Aujourd'hui
              </button>
              <button
                onClick={() => setCursor(cursor.add(1, 'month'))}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
              >
                Suivant ▶
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-xs text-gray-600 mb-2">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((l) => (
              <div key={l} className="px-2 py-1 text-center font-medium">{l}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const key = day.format('YYYY-MM-DD');
              const dayEvents = eventMap.get(key) || [];
              const isCurMonth = day.month() === cursor.month();
              const isToday = day.isSame(dayjs(), 'day');

              return (
                <button
                  key={key}
                  onClick={() => dayEvents.length > 0 && onDayClick?.({ date: key, events: dayEvents })}
                  disabled={dayEvents.length === 0}
                  className={`
                    border rounded-lg p-2 text-left min-h-[80px] transition-all
                    ${isCurMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'}
                    ${isToday ? 'ring-2 ring-rose-500' : ''}
                    ${dayEvents.length > 0 ? 'hover:border-rose-300 hover:shadow-sm cursor-pointer' : 'cursor-default'}
                  `}
                >
                  <div className={`text-xs mb-1 font-medium ${isToday ? 'text-rose-600' : ''}`}>
                    {day.format('D')}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {dayEvents.slice(0, 3).map((ev, i) => (
                      <span
                        key={i}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-full ${getStatusColor(ev.status)}`}
                        title={ev.door_name}
                      >
                        {ev.door_name || ev.door_id}
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-gray-500 font-medium">+{dayEvents.length - 3}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-4 text-xs text-gray-500 border-t pt-4">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-emerald-100"></span> À faire
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-amber-100"></span> Sous 30 jours
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-red-100"></span> En retard
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Mobile Tree Drawer
const MobileTreeDrawer = React.memo(({ isOpen, onClose, tree, expandedBuildings, setExpandedBuildings, selectedDoor, onSelectDoor, placedIds }) => {
  if (!isOpen) return null;

  const isPlaced = (id) => placedIds.has(String(id));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl animate-slideRight overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-gradient-to-r from-rose-500 to-red-600 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Portes coupe-feu</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {Object.entries(tree).map(([building, floors]) => (
              <div key={building}>
                <button
                  onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Building2 size={16} className="text-rose-500" />
                  <span className="font-medium truncate flex-1">{building}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {Object.values(floors).flat().length}
                  </span>
                </button>

                {expandedBuildings[building] && (
                  <div className="ml-4 space-y-1 mt-1">
                    {Object.entries(floors).map(([floor, doors]) => (
                      <div key={floor}>
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-500 flex items-center gap-1">
                          <Layers size={12} />
                          {floor}
                        </div>
                        {doors.map(door => {
                          const statusConf = getStatusConfig(door.status);
                          return (
                            <button
                              key={door.id}
                              onClick={() => { onSelectDoor(door); onClose(); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg ml-2
                                ${selectedDoor?.id === door.id ? 'bg-rose-100 text-rose-700' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                              <DoorOpen size={14} className={`${statusConf.iconColor} ${statusConf.blink}`} />
                              <span className="text-sm truncate flex-1">{door.name}</span>
                              {!isPlaced(door.id) && (
                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[9px] rounded-full flex items-center gap-0.5">
                                  <MapPin size={8} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
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
  door,
  onClose,
  onEdit,
  onDelete,
  onShare,
  onNavigateToMap,
  onPhotoUpload,
  onStartCheck,
  isPlaced,
  showToast,
  settings
}) => {
  const [files, setFiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (door?.id) {
      loadFiles();
      loadHistory();
    }
  }, [door?.id]);

  const loadFiles = async () => {
    if (!door?.id) return;
    setLoadingFiles(true);
    try {
      const res = await api.doors.listFiles(door.id).catch(() => ({}));
      setFiles(res?.files || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFiles(false);
    }
  };

  const loadHistory = async () => {
    if (!door?.id) return;
    setLoadingHistory(true);
    try {
      const res = await api.doors.listHistory(door.id).catch(() => ({}));
      // API returns { ok, checks: [...] }
      const checks = Array.isArray(res?.checks) ? res.checks : [];
      setHistory(checks);
    } catch (e) {
      console.error(e);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  if (!door) return null;

  const statusConf = getStatusConfig(door.status);
  const doorStateVariant = door.door_state === 'conforme' ? 'success' : door.door_state === 'non_conforme' ? 'danger' : 'default';

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-500 to-red-600 p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors md:hidden"
          >
            <X size={20} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onShare(door)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="Partager"
            >
              <Share2 size={18} />
            </button>
            <button
              onClick={() => onEdit(door)}
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
              onChange={(e) => e.target.files?.[0] && onPhotoUpload(door.id, e.target.files[0])}
            />
            {door.photo_url ? (
              <img src={api.doors.photoUrl(door.id)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Camera size={24} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{door.name}</h2>
            <p className="text-rose-100 text-sm">
              {door.building} • {door.floor}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant={statusConf.variant} className={statusConf.blink}>
                <Clock size={10} className="inline mr-1" />
                {statusConf.label}
              </Badge>
              {door.door_state && (
                <Badge variant={doorStateVariant}>
                  {door.door_state === 'conforme' ? 'Conforme' : 'Non conforme'}
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
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <Calendar size={20} className="mx-auto text-rose-500 mb-1" />
            <p className="text-sm font-bold text-gray-900">
              {door.next_check_date ? dayjs(door.next_check_date).format('DD/MM/YY') : '-'}
            </p>
            <p className="text-xs text-gray-500">Prochain</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <History size={20} className="mx-auto text-blue-500 mb-1" />
            <p className="text-sm font-bold text-gray-900">{history.length}</p>
            <p className="text-xs text-gray-500">Contrôles</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <FileText size={20} className="mx-auto text-amber-500 mb-1" />
            <p className="text-sm font-bold text-gray-900">{files.length}</p>
            <p className="text-xs text-gray-500">Fichiers</p>
          </div>
        </div>

        {/* Start Check Button */}
        <button
          onClick={() => onStartCheck(door)}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-medium flex items-center justify-center gap-2 hover:from-rose-600 hover:to-red-700 transition-all"
        >
          <ClipboardCheck size={18} />
          Lancer un contrôle
        </button>

        {/* Location */}
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Building2 size={16} className="text-rose-500" />
            Localisation
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Bâtiment</span>
              <p className="font-medium text-gray-900">{door.building || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Étage</span>
              <p className="font-medium text-gray-900">{door.floor || '-'}</p>
            </div>
            <div className="col-span-2">
              <span className="text-gray-500">Emplacement</span>
              <p className="font-medium text-gray-900">{door.location || '-'}</p>
            </div>
          </div>
        </div>

        {/* Current Check Items Preview */}
        {door.current_check?.items?.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <ClipboardCheck size={16} className="text-rose-500" />
              Contrôle en cours
            </h3>
            <div className="space-y-2">
              {door.current_check.items.slice(0, 5).map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  {item.value === 'conforme' ? (
                    <CheckCircle size={14} className="text-emerald-500" />
                  ) : item.value === 'non_conforme' ? (
                    <XCircle size={14} className="text-red-500" />
                  ) : item.value === 'na' ? (
                    <HelpCircle size={14} className="text-gray-400" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />
                  )}
                  <span className="text-gray-700 truncate flex-1">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History Toggle */}
        <div className="bg-gray-50 rounded-xl p-4">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between"
          >
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <History size={16} className="text-rose-500" />
              Historique des contrôles
            </h3>
            <ChevronDown size={18} className={`text-gray-500 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>

          {showHistory && (
            <div className="mt-4 space-y-3">
              {loadingHistory ? (
                <div className="text-center py-4">
                  <RefreshCw size={20} className="animate-spin mx-auto text-gray-400" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-2">Aucun contrôle</p>
              ) : (
                history.slice(0, 10).map((check) => (
                  <details key={check.id} className="bg-white rounded-lg border border-gray-200 group">
                    <summary className="p-3 cursor-pointer list-none">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <ChevronRight size={16} className="text-gray-400 transition-transform group-open:rotate-90" />
                          <span className="text-sm font-medium text-gray-900">
                            {dayjs(check.date || check.closed_at).format('DD/MM/YYYY')}
                          </span>
                        </div>
                        <Badge variant={check.result === 'conforme' ? 'success' : 'danger'}>
                          {check.result === 'conforme' ? 'Conforme' : 'Non conforme'}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 ml-6">
                        Par {check.user || 'Inconnu'}
                      </p>
                      {(check.counts || check.result_counts) && (
                        <div className="flex gap-2 mt-2 ml-6 text-xs">
                          <span className="text-emerald-600">{(check.counts || check.result_counts)?.conforme || 0} OK</span>
                          <span className="text-red-600">{(check.counts || check.result_counts)?.nc || 0} NC</span>
                          <span className="text-gray-400">{(check.counts || check.result_counts)?.na || 0} N/A</span>
                        </div>
                      )}
                    </summary>

                    {/* Détails du contrôle */}
                    <div className="px-3 pb-3 border-t border-gray-100 mt-2 pt-3 space-y-2">
                      {/* Questions avec résultats */}
                      {check.items && check.items.length > 0 && (
                        <div className="space-y-1.5">
                          {check.items.map((item, idx) => (
                            <div key={idx} className="text-xs">
                              <div className="flex items-start gap-2">
                                {item.value === 'conforme' ? (
                                  <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                                ) : item.value === 'non_conforme' ? (
                                  <XCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                                ) : (
                                  <HelpCircle size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                                )}
                                <span className={`flex-1 ${
                                  item.value === 'non_conforme' ? 'text-red-700 font-medium' : 'text-gray-600'
                                }`}>
                                  {item.label || `Point ${idx + 1}`}
                                </span>
                              </div>
                              {/* Commentaire */}
                              {item.comment && (
                                <div className="ml-6 mt-1 p-2 bg-amber-50 rounded text-amber-800 italic">
                                  💬 {item.comment}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Photos/Fichiers du contrôle */}
                      {check.files && check.files.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-gray-100">
                          <p className="text-xs font-medium text-gray-500 mb-2">📎 Pièces jointes ({check.files.length})</p>
                          <div className="flex flex-wrap gap-2">
                            {check.files.map((file) => (
                              <a
                                key={file.id}
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700"
                              >
                                <FileText size={12} />
                                {file.name}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Lien vers PDF NC */}
                      {check.nc_pdf_url && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <a
                            href={check.nc_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-50 hover:bg-red-100 rounded-lg text-xs text-red-700 font-medium"
                          >
                            <Download size={14} />
                            Télécharger le rapport de non-conformités
                          </a>
                        </div>
                      )}
                    </div>
                  </details>
                ))
              )}
            </div>
          )}
        </div>

        {/* Files */}
        {files.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <FileText size={16} className="text-rose-500" />
              Fichiers ({files.length})
            </h3>
            <div className="space-y-2">
              {files.map(file => (
                <a
                  key={file.id}
                  href={file.download_url || file.inline_url || file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200 hover:border-rose-300 transition-colors"
                >
                  <FileText size={14} className="text-gray-400" />
                  <span className="text-sm text-gray-700 truncate flex-1">{file.filename}</span>
                  <Download size={14} className="text-gray-400" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Mini Electro - AI Assistant */}
        <MiniElectro
          equipment={door}
          equipmentType="doors"
          onAction={(action, params) => {
            if (action === 'docAttached') {
              showToast?.('Documentation associée avec succès!', 'success');
            }
          }}
        />

        {/* Historique des modifications */}
        {door.id && (
          <AuditHistory
            apiEndpoint="/api/doors/audit/entity"
            entityType="door"
            entityId={door.id}
            title="Historique des modifications"
            maxHeight="250px"
            showFilters={false}
          />
        )}
      </div>

      {/* Actions */}
      <div className="border-t p-4 flex gap-3">
        <button
          onClick={() => onNavigateToMap(door)}
          className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
        >
          <MapPin size={18} />
          Voir sur plan
        </button>
        <button
          onClick={() => onDelete(door)}
          className="py-3 px-4 rounded-xl border border-red-200 text-red-600 font-medium hover:bg-red-50 flex items-center justify-center gap-2"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
};

// ==================== EDIT FORM COMPONENT ====================

const EditForm = ({ door, onSave, onCancel, showToast }) => {
  const isNew = !door?.id;
  const initialFormData = { name: '', building: '', floor: '', location: '' };

  // Auto-save draft for new items only
  const {
    formData: draftData,
    setFormData: setDraftData,
    clearDraft,
    hasDraft
  } = useFormDraft(isNew ? 'doors_new' : 'doors_disabled', initialFormData, { debounceMs: 500 });

  const [form, setFormInternal] = useState(initialFormData);
  const [isSaving, setIsSaving] = useState(false);

  // Sync form with draft or door
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

  useEffect(() => {
    if (door?.id) {
      // Editing existing door
      setFormInternal({
        name: door.name || '',
        building: door.building || '',
        floor: door.floor || '',
        location: door.location || ''
      });
    } else if (isNew && hasDraft) {
      // New door - restore from draft
      setFormInternal(draftData);
    }
  }, [door, isNew, hasDraft, draftData]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      showToast('Le nom est requis', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(form);
      // Clear draft after successful save
      if (isNew) clearDraft();
    } catch (err) {
      showToast('Erreur lors de la sauvegarde', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-500 to-red-600 p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-xl">
            <DoorOpen size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">{isNew ? 'Nouvelle porte' : 'Modifier la porte'}</h2>
            <p className="text-rose-100 text-sm">Porte coupe-feu</p>
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Identification */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Tag size={16} className="text-rose-500" />
            Identification
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={inputBaseClass}
              placeholder="Porte coupe-feu A1"
            />
          </div>
        </div>

        {/* Location */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 size={16} className="text-rose-500" />
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
                placeholder="Bâtiment A"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Étage</label>
              <input
                type="text"
                value={form.floor}
                onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
                className={inputBaseClass}
                placeholder="RDC"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Emplacement</label>
              <input
                type="text"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className={inputBaseClass}
                placeholder="Couloir principal"
              />
            </div>
          </div>
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
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-medium hover:from-rose-600 hover:to-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
          Enregistrer
        </button>
      </div>
    </div>
  );
};

// ==================== CHECK FORM COMPONENT ====================

const CheckForm = ({ door, settings, onSave, onCancel, showToast }) => {
  const [items, setItems] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState(null);
  const photoInputRefs = useRef({});

  useEffect(() => {
    if (door?.current_check?.items) {
      setItems(door.current_check.items);
    } else if (settings?.checklist_template) {
      setItems(settings.checklist_template.map((label, index) => ({
        index,
        label,
        value: null,
        comment: '',
        photos: []
      })));
    }
  }, [door, settings]);

  const updateItem = (index, field, value) => {
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handlePhotoUpload = async (index, file) => {
    if (!file || !door?.id || !door?.current_check?.id) return;

    setUploadingIndex(index);
    try {
      // Upload photo for this checklist item
      const res = await api.doors.uploadCheckPhoto(door.id, door.current_check.id, index, file);
      const photoUrl = res?.url || res?.photo_url;
      if (photoUrl) {
        setItems(prev => prev.map((item, i) =>
          i === index ? { ...item, photos: [...(item.photos || []), photoUrl] } : item
        ));
        showToast('Photo ajoutée', 'success');
      }
    } catch (err) {
      console.error('Photo upload error:', err);
      showToast('Erreur lors de l\'upload', 'error');
    } finally {
      setUploadingIndex(null);
    }
  };

  const handleSave = async (close = false) => {
    if (close) {
      const incomplete = items.some(item => !item.value);
      if (incomplete) {
        showToast('Veuillez remplir tous les points', 'error');
        return;
      }
      setIsClosing(true);
    } else {
      setIsSaving(true);
    }

    try {
      await onSave(items, close);
      if (close) {
        showToast('Contrôle terminé', 'success');
      } else {
        showToast('Contrôle enregistré', 'success');
      }
    } catch (err) {
      showToast('Erreur lors de la sauvegarde', 'error');
    } finally {
      setIsSaving(false);
      setIsClosing(false);
    }
  };

  const allFilled = items.every(item => item.value);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-500 to-red-600 p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-xl">
            <ClipboardCheck size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Contrôle</h2>
            <p className="text-rose-100 text-sm">{door?.name}</p>
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {items.map((item, index) => (
          <div key={index} className="bg-gray-50 rounded-xl p-4">
            <p className="font-medium text-gray-900 mb-3">{item.label}</p>

            <div className="flex gap-2 mb-3">
              <button
                onClick={() => updateItem(index, 'value', 'conforme')}
                className={`flex-1 py-2.5 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                  item.value === 'conforme'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:border-emerald-300'
                }`}
              >
                <CheckCircle size={16} />
                Conforme
              </button>
              <button
                onClick={() => updateItem(index, 'value', 'non_conforme')}
                className={`flex-1 py-2.5 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                  item.value === 'non_conforme'
                    ? 'bg-red-500 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:border-red-300'
                }`}
              >
                <XCircle size={16} />
                Non conforme
              </button>
              <button
                onClick={() => updateItem(index, 'value', 'na')}
                className={`py-2.5 px-4 rounded-xl font-medium transition-all ${
                  item.value === 'na'
                    ? 'bg-gray-500 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
              >
                N/A
              </button>
            </div>

            {/* Comment field - always visible */}
            <div className="space-y-2">
              <input
                type="text"
                value={item.comment || ''}
                onChange={e => updateItem(index, 'comment', e.target.value)}
                className={inputBaseClass}
                placeholder="Commentaire (optionnel)"
              />

              {/* Photo upload */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={el => photoInputRefs.current[index] = el}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handlePhotoUpload(index, e.target.files[0]);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  onClick={() => photoInputRefs.current[index]?.click()}
                  disabled={uploadingIndex === index}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-100 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {uploadingIndex === index ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Camera size={14} />
                  )}
                  Photo
                </button>

                {/* Show existing photos */}
                {item.photos?.length > 0 && item.photos.map((photo, photoIdx) => (
                  <a
                    key={photoIdx}
                    href={photo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 hover:border-rose-400 transition-colors"
                  >
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="border-t p-4 space-y-3">
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="flex-1 py-3 px-4 rounded-xl border border-rose-300 text-rose-600 font-medium hover:bg-rose-50 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            Sauvegarder
          </button>
        </div>
        <button
          onClick={() => handleSave(true)}
          disabled={isClosing || !allFilled}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isClosing ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle size={18} />}
          Terminer le contrôle
        </button>
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function Doors() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // State
  const [doors, setDoors] = useState([]);
  const [selectedDoor, setSelectedDoor] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [settings, setSettings] = useState(null);

  // View mode
  const [viewMode, setViewMode] = useState('detail'); // 'detail' | 'edit' | 'check'

  // Placement state
  const [placedIds, setPlacedIds] = useState(new Set());

  // Toast state
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  // Modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load doors
  const loadDoors = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.doors.list({});
      const list = res?.items || res?.doors || res || [];
      setDoors(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Load doors error:', err);
      showToast('Erreur lors du chargement', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  // Load settings
  const loadSettings = useCallback(async () => {
    try {
      const res = await api.doors.settingsGet();
      // API returns { ok, checklist_template, frequency } directly
      setSettings({
        checklist_template: res?.checklist_template || [],
        frequency: res?.frequency || 'monthly'
      });
    } catch (err) {
      console.error('Load settings error:', err);
    }
  }, []);

  // Load placements by iterating through all plans and their positions
  const loadPlacements = useCallback(async () => {
    try {
      const plansRes = await api.doorsMaps.listPlans();
      const plans = plansRes?.plans || plansRes?.items || [];
      const placed = new Set();

      for (const plan of plans) {
        try {
          // Get positions for all pages (assume max 20 pages)
          for (let pageIdx = 0; pageIdx < 20; pageIdx++) {
            const positions = await api.doorsMaps.positionsAuto(plan.logical_name || plan.id, pageIdx).catch(() => ({}));
            const list = positions?.items || positions?.points || [];
            if (list.length === 0 && pageIdx > 0) break; // No more pages
            list.forEach(p => {
              if (p.door_id) {
                placed.add(String(p.door_id));
              }
            });
          }
        } catch {}
      }
      setPlacedIds(placed);
    } catch (err) {
      console.error('Load placements error:', err);
      setPlacedIds(new Set());
    }
  }, []);

  // Load calendar events
  const loadCalendar = useCallback(async () => {
    try {
      const res = await api.doors.calendar?.() || {};
      const events = Array.isArray(res?.events) ? res.events : [];
      setCalendarEvents(events);
    } catch (err) {
      console.error('Load calendar error:', err);
      setCalendarEvents([]);
    }
  }, []);

  // Effects
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadDoors();
    loadSettings();
    loadPlacements();
  }, [loadDoors, loadSettings, loadPlacements]);

  // Load calendar when modal opens
  useEffect(() => {
    if (showCalendarModal) {
      loadCalendar();
    }
  }, [showCalendarModal, loadCalendar]);

  // URL params handling
  useEffect(() => {
    const doorId = searchParams.get('door');
    if (doorId && (!selectedDoor || selectedDoor.id !== doorId)) {
      api.doors.get(doorId)
        .then(res => {
          const d = res?.door || res;
          if (d) {
            setSelectedDoor(d);
            const building = d.building || 'Sans bâtiment';
            setExpandedBuildings(prev => ({ ...prev, [building]: true }));
          }
        })
        .catch(() => showToast('Porte non trouvée', 'error'));
    }
  }, [searchParams, showToast]);

  // Handlers
  const handleSelectDoor = async (d) => {
    setSearchParams({ door: d.id.toString() });
    setViewMode('detail');

    try {
      const res = await api.doors.get(d.id);
      setSelectedDoor(res?.door || res || d);
    } catch (err) {
      setSelectedDoor(d);
    }
  };

  const handleNewDoor = () => {
    setSelectedDoor({});
    setViewMode('edit');
    setSearchParams({});
  };

  const handleEditDoor = (d) => {
    setSelectedDoor(d);
    setViewMode('edit');
  };

  const handleStartCheck = async (d) => {
    try {
      // Start or get current check
      await api.doors.startCheck(d.id);
      // Reload door with current_check
      const res = await api.doors.get(d.id);
      setSelectedDoor(res?.door || res || d);
      setViewMode('check');
    } catch (err) {
      showToast('Erreur lors du démarrage du contrôle', 'error');
    }
  };

  const handleSaveDoor = async (formData) => {
    const isNew = !selectedDoor?.id;

    try {
      let saved;
      if (isNew) {
        saved = await api.doors.create(formData);
      } else {
        saved = await api.doors.update(selectedDoor.id, formData);
      }

      const newDoor = saved?.door || saved;

      if (isNew) {
        setDoors(prev => [...prev, newDoor]);
      } else {
        setDoors(prev => prev.map(d => d.id === newDoor.id ? newDoor : d));
      }

      setSelectedDoor(newDoor);
      setViewMode('detail');
      setSearchParams({ door: newDoor.id.toString() });
      showToast(isNew ? 'Porte créée' : 'Porte mise à jour', 'success');
    } catch (err) {
      throw err;
    }
  };

  const handleSaveCheck = async (items, close) => {
    if (!selectedDoor?.current_check?.id) {
      showToast('Aucun contrôle en cours', 'error');
      return;
    }

    try {
      await api.doors.saveCheck(selectedDoor.id, selectedDoor.current_check.id, { items, close });

      // Reload door
      const res = await api.doors.get(selectedDoor.id);
      const updatedDoor = res?.door || res;
      setSelectedDoor(updatedDoor);

      // Update in list
      setDoors(prev => prev.map(d => d.id === updatedDoor.id ? updatedDoor : d));

      if (close) {
        setViewMode('detail');
      }
    } catch (err) {
      throw err;
    }
  };

  const handleDeleteDoor = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      await api.doors.remove(deleteTarget.id);
      setDoors(prev => prev.filter(d => d.id !== deleteTarget.id));

      if (selectedDoor?.id === deleteTarget.id) {
        setSelectedDoor(null);
        setSearchParams({});
      }

      showToast('Porte supprimée', 'success');
      setShowDeleteModal(false);
      setDeleteTarget(null);
    } catch (err) {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePhotoUpload = async (doorId, file) => {
    try {
      await api.doors.uploadPhoto(doorId, file);
      showToast('Photo enregistrée', 'success');

      // Reload door
      const res = await api.doors.get(doorId);
      const updated = res?.door || res;
      setSelectedDoor(updated);
      setDoors(prev => prev.map(d => d.id === doorId ? updated : d));
    } catch (err) {
      showToast('Erreur lors de l\'upload', 'error');
    }
  };

  const handleSaveSettings = async (newSettings) => {
    await api.doors.settingsSet(newSettings);
    setSettings(newSettings);
  };

  const handleNavigateToMap = (d) => {
    navigate('/app/doors/map?door=' + d.id);
  };

  // Build tree structure: Building > Floor > Doors
  const tree = useMemo(() => {
    const result = {};
    const query = searchQuery.toLowerCase();
    const doorsList = Array.isArray(doors) ? doors : [];

    const filtered = doorsList.filter(d => {
      if (!query) return true;
      return (
        d.name?.toLowerCase().includes(query) ||
        d.building?.toLowerCase().includes(query) ||
        d.floor?.toLowerCase().includes(query) ||
        d.location?.toLowerCase().includes(query)
      );
    });

    filtered.forEach(d => {
      const building = d.building || 'Sans bâtiment';
      const floor = d.floor || 'Sans étage';

      if (!result[building]) result[building] = {};
      if (!result[building][floor]) result[building][floor] = [];
      result[building][floor].push(d);
    });

    // Sort doors within each floor
    Object.values(result).forEach(floors => {
      Object.values(floors).forEach(doorList => {
        doorList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      });
    });

    return result;
  }, [doors, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const doorsList = Array.isArray(doors) ? doors : [];
    const total = doorsList.length;
    const aFaire = doorsList.filter(d => d.status === STATUS.A_FAIRE).length;
    const enCours = doorsList.filter(d => d.status === STATUS.EN_COURS).length;
    const enRetard = doorsList.filter(d => d.status === STATUS.EN_RETARD).length;
    const placed = doorsList.filter(d => placedIds.has(String(d.id))).length;
    return { total, aFaire, enCours, enRetard, placed };
  }, [doors, placedIds]);

  const isPlaced = (id) => placedIds.has(String(id));

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <InlineStyles />

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          {/* Left */}
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                onClick={() => setShowMobileDrawer(true)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <Menu size={20} />
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center text-white">
                <DoorOpen size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Portes coupe-feu</h1>
                <p className="text-xs text-gray-500">Contrôles périodiques</p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-2">
            <Badge variant="default">{stats.total} total</Badge>
            <Badge variant="success">{stats.aFaire} à faire</Badge>
            <Badge variant="warning" className="blink-orange">{stats.enCours} sous 30j</Badge>
            <Badge variant="danger" className="blink-red">{stats.enRetard} en retard</Badge>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCalendarModal(true)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
              title="Calendrier des contrôles"
            >
              <Calendar size={20} />
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
              title="Paramètres"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={() => navigate('/app/doors/map')}
              className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 flex items-center gap-2"
            >
              <MapPin size={18} />
              <span className="hidden sm:inline">Plans</span>
            </button>
            <button
              onClick={handleNewDoor}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-medium hover:from-rose-600 hover:to-red-700 flex items-center gap-2"
            >
              <Plus size={18} />
              <span className="hidden sm:inline">Nouvelle</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Desktop */}
        {!isMobile && (
          <div className="w-80 border-r bg-white flex flex-col overflow-hidden">
            {/* Search */}
            <div className="p-4 border-b">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : Object.keys(tree).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <DoorOpen size={32} className="mx-auto mb-2 opacity-50" />
                  <p>Aucune porte</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {Object.entries(tree).map(([building, floors]) => (
                    <div key={building}>
                      <button
                        onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
                      >
                        {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Building2 size={16} className="text-rose-500" />
                        <span className="font-medium truncate flex-1">{building}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          {Object.values(floors).flat().length}
                        </span>
                      </button>

                      {expandedBuildings[building] && (
                        <div className="ml-4 space-y-1 mt-1">
                          {Object.entries(floors).map(([floor, floorDoors]) => (
                            <div key={floor}>
                              <div className="px-3 py-1.5 text-xs font-medium text-gray-500 flex items-center gap-1">
                                <Layers size={12} />
                                {floor}
                              </div>
                              {floorDoors.map(d => {
                                const statusConf = getStatusConfig(d.status);
                                return (
                                  <button
                                    key={d.id}
                                    onClick={() => handleSelectDoor(d)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg ml-2
                                      ${selectedDoor?.id === d.id ? 'bg-rose-100 text-rose-700' : 'text-gray-600 hover:bg-gray-100'}`}
                                  >
                                    <DoorOpen size={14} className={`${statusConf.iconColor} ${statusConf.blink}`} />
                                    <span className="text-sm truncate flex-1">{d.name}</span>
                                    {!isPlaced(d.id) && (
                                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[9px] rounded-full flex items-center gap-0.5">
                                        <MapPin size={8} />
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
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

        {/* Main Panel */}
        <div className="flex-1 overflow-hidden">
          {!selectedDoor ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <DoorOpen size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Sélectionnez une porte</p>
                <p className="text-sm">ou créez-en une nouvelle</p>
              </div>
            </div>
          ) : viewMode === 'edit' ? (
            <EditForm
              door={selectedDoor}
              onSave={handleSaveDoor}
              onCancel={() => {
                if (selectedDoor?.id) {
                  setViewMode('detail');
                } else {
                  setSelectedDoor(null);
                }
              }}
              showToast={showToast}
            />
          ) : viewMode === 'check' ? (
            <CheckForm
              door={selectedDoor}
              settings={settings}
              onSave={handleSaveCheck}
              onCancel={() => setViewMode('detail')}
              showToast={showToast}
            />
          ) : (
            <DetailPanel
              door={selectedDoor}
              onClose={() => {
                setSelectedDoor(null);
                setSearchParams({});
              }}
              onEdit={handleEditDoor}
              onDelete={(d) => {
                setDeleteTarget(d);
                setShowDeleteModal(true);
              }}
              onShare={(d) => setShowShareModal(true)}
              onNavigateToMap={handleNavigateToMap}
              onPhotoUpload={handlePhotoUpload}
              onStartCheck={handleStartCheck}
              isPlaced={isPlaced(selectedDoor?.id)}
              showToast={showToast}
              settings={settings}
            />
          )}
        </div>
      </div>

      {/* Mobile Drawer */}
      <MobileTreeDrawer
        isOpen={showMobileDrawer}
        onClose={() => setShowMobileDrawer(false)}
        tree={tree}
        expandedBuildings={expandedBuildings}
        setExpandedBuildings={setExpandedBuildings}
        selectedDoor={selectedDoor}
        onSelectDoor={handleSelectDoor}
        placedIds={placedIds}
      />

      {/* Modals */}
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteTarget(null);
        }}
        onConfirm={handleDeleteDoor}
        itemName={deleteTarget?.name}
        isLoading={isDeleting}
      />

      <ShareLinkModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        door={selectedDoor}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={settings}
        onSave={handleSaveSettings}
        showToast={showToast}
      />

      <CalendarModal
        isOpen={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
        events={calendarEvents}
        onDayClick={({ events: dayEvents }) => {
          if (dayEvents.length > 0) {
            // Navigate to the first door's detail
            const firstEvent = dayEvents[0];
            if (firstEvent.door_id) {
              setSearchParams({ door: firstEvent.door_id.toString() });
              const foundDoor = doors.find(d => d.id === firstEvent.door_id || d.id === String(firstEvent.door_id));
              if (foundDoor) {
                setSelectedDoor(foundDoor);
                if (foundDoor.building) {
                  setExpandedBuildings(prev => ({ ...prev, [foundDoor.building]: true }));
                }
              }
            }
            setShowCalendarModal(false);
          }
        }}
      />

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
