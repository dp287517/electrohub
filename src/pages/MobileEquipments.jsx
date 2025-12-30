// src/pages/MobileEquipments.jsx - Mobile Equipment Electrical Control
// Based on Doors.jsx pattern with VSD plans support
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useFormDraft } from '../hooks/useFormDraft';
import {
  Zap, Plus, Search, ChevronRight, ChevronDown, Building2, Layers,
  MoreVertical, Copy, Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Camera, Upload, RefreshCw, Eye, AlertCircle, Menu, Share2, ExternalLink,
  MapPin, Tag, Hash, Info, Calendar, Clock, FileText, Download, Check,
  XCircle, HelpCircle, History, ClipboardCheck, Settings, QrCode, Cpu, Sparkles
} from 'lucide-react';
import { api } from '../lib/api';
import { EquipmentAIChat } from '../components/AIAvatar';
import MiniElectro from '../components/MiniElectro';
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

const inputBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400";
const selectBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900";

// ==================== STATUS HELPERS ====================

const STATUS = {
  A_FAIRE: 'a_faire',
  EN_COURS: 'en_cours_30',
  EN_RETARD: 'en_retard',
  FAIT: 'fait'
};

const statusConfig = {
  [STATUS.A_FAIRE]: { label: 'A faire', variant: 'success', blink: '' },
  [STATUS.EN_COURS]: { label: 'Sous 30j', variant: 'warning', blink: 'blink-orange' },
  [STATUS.EN_RETARD]: { label: 'En retard', variant: 'danger', blink: 'blink-red' },
  [STATUS.FAIT]: { label: 'Fait', variant: 'info', blink: '' }
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

  const url = `${window.location.origin}${window.location.pathname}?equipment=${equipment.id}`;

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
        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Partager le lien</h2>
              <p className="text-blue-100 text-sm">{equipment.name}</p>
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
                copied ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
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

// Category Manager Modal (remplace Settings Modal)
const CategoryManagerModal = ({ isOpen, onClose, categories, onCategoriesChange, showToast }) => {
  const [localCategories, setLocalCategories] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: '', description: '' });

  useEffect(() => {
    if (categories) {
      setLocalCategories([...categories]);
    }
  }, [categories]);

  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setShowNewForm(false);
      setNewCategory({ name: '', description: '' });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!newCategory.name.trim()) {
      showToast('Le nom est requis', 'error');
      return;
    }
    setIsLoading(true);
    try {
      await api.mobileEquipment.createCategory(newCategory);
      showToast('Categorie creee', 'success');
      setNewCategory({ name: '', description: '' });
      setShowNewForm(false);
      onCategoriesChange();
    } catch (err) {
      showToast('Erreur lors de la creation', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (id) => {
    if (!editForm.name.trim()) {
      showToast('Le nom est requis', 'error');
      return;
    }
    setIsLoading(true);
    try {
      await api.mobileEquipment.updateCategory(id, editForm);
      showToast('Categorie mise a jour', 'success');
      setEditingId(null);
      onCategoriesChange();
    } catch (err) {
      showToast('Erreur lors de la mise a jour', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Supprimer la categorie "${name}" ?`)) return;
    setIsLoading(true);
    try {
      await api.mobileEquipment.deleteCategory(id);
      showToast('Categorie supprimee', 'success');
      onCategoriesChange();
    } catch (err) {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditForm({ name: cat.name, description: cat.description || '' });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slideUp max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Tag size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Categories</h2>
                <p className="text-purple-200 text-sm">Gestion des categories d'equipements</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Add new category button */}
          {!showNewForm && (
            <button
              onClick={() => setShowNewForm(true)}
              className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-purple-300 text-purple-600 font-medium hover:bg-purple-50 flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              Ajouter une categorie
            </button>
          )}

          {/* New category form */}
          {showNewForm && (
            <div className="bg-purple-50 rounded-xl p-4 space-y-3 border border-purple-200">
              <input
                type="text"
                value={newCategory.name}
                onChange={e => setNewCategory(prev => ({ ...prev, name: e.target.value }))}
                className={inputBaseClass}
                placeholder="Nom de la categorie *"
                autoFocus
              />
              <input
                type="text"
                value={newCategory.description}
                onChange={e => setNewCategory(prev => ({ ...prev, description: e.target.value }))}
                className={inputBaseClass}
                placeholder="Description (optionnel)"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowNewForm(false); setNewCategory({ name: '', description: '' }); }}
                  className="flex-1 py-2 px-3 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isLoading}
                  className="flex-1 py-2 px-3 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {isLoading ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  Creer
                </button>
              </div>
            </div>
          )}

          {/* Categories list */}
          <div className="space-y-2">
            {localCategories.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Tag size={32} className="mx-auto mb-2 opacity-30" />
                <p>Aucune categorie</p>
                <p className="text-sm">Creez des categories pour organiser vos equipements</p>
              </div>
            ) : (
              localCategories.map(cat => (
                <div
                  key={cat.id}
                  className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-purple-300 transition-colors"
                >
                  {editingId === cat.id ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                        className={inputBaseClass}
                        placeholder="Nom *"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={editForm.description}
                        onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                        className={inputBaseClass}
                        placeholder="Description"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex-1 py-2 px-3 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
                        >
                          Annuler
                        </button>
                        <button
                          onClick={() => handleUpdate(cat.id)}
                          disabled={isLoading}
                          className="flex-1 py-2 px-3 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1"
                        >
                          {isLoading ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                          Sauvegarder
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{cat.name}</h4>
                        {cat.description && (
                          <p className="text-sm text-gray-500">{cat.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(cat)}
                          className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-purple-600"
                          title="Modifier"
                        >
                          <Edit3 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id, cat.name)}
                          className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-red-600"
                          title="Supprimer"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t p-4">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
          >
            Fermer
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
        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Calendar size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Calendrier des controles</h2>
                <p className="text-blue-200 text-sm">Visualisez les prochains controles</p>
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
                Precedent
              </button>
              <button
                onClick={() => setCursor(dayjs().startOf('month'))}
                className="px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg text-sm font-medium"
              >
                Aujourd'hui
              </button>
              <button
                onClick={() => setCursor(cursor.add(1, 'month'))}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
              >
                Suivant
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
                    ${isToday ? 'ring-2 ring-blue-500' : ''}
                    ${dayEvents.length > 0 ? 'hover:border-blue-300 hover:shadow-sm cursor-pointer' : 'cursor-default'}
                  `}
                >
                  <div className={`text-xs mb-1 font-medium ${isToday ? 'text-blue-600' : ''}`}>
                    {day.format('D')}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {dayEvents.slice(0, 3).map((ev, i) => (
                      <span
                        key={i}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-full ${getStatusColor(ev.status)}`}
                        title={ev.equipment_name}
                      >
                        {ev.equipment_name || ev.equipment_id}
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
              <span className="w-3 h-3 rounded bg-emerald-100"></span> A faire
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
const MobileTreeDrawer = React.memo(({ isOpen, onClose, tree, expandedBuildings, setExpandedBuildings, selectedEquipment, onSelectEquipment, placedIds }) => {
  if (!isOpen) return null;

  const isPlaced = (id) => placedIds.has(String(id));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl animate-slideRight overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-gradient-to-r from-blue-500 to-cyan-600 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Appareils mobiles</h2>
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
                  <Building2 size={16} className="text-blue-500" />
                  <span className="font-medium truncate flex-1">{building}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {Object.values(floors).flat().length}
                  </span>
                </button>

                {expandedBuildings[building] && (
                  <div className="ml-4 space-y-1 mt-1">
                    {Object.entries(floors).map(([floor, equipments]) => (
                      <div key={floor}>
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-500 flex items-center gap-1">
                          <Layers size={12} />
                          {floor}
                        </div>
                        {equipments.map(eq => {
                          return (
                            <button
                              key={eq.id}
                              onClick={() => { onSelectEquipment(eq); onClose(); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg ml-2
                                ${selectedEquipment?.id === eq.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                              <Cpu size={14} className="text-cyan-500" />
                              <span className="text-sm truncate flex-1">{eq.name}</span>
                              {!isPlaced(eq.id) && (
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
  const [history, setHistory] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const photoInputRef = useRef(null);

  // Get control status for this equipment
  const controlStatus = controlStatuses?.[equipment?.id];
  const hasOverdueControl = controlStatus?.status === 'overdue';

  useEffect(() => {
    if (equipment?.id) {
      loadFiles();
      loadHistory();
    }
  }, [equipment?.id]);

  const loadFiles = async () => {
    if (!equipment?.id) return;
    setLoadingFiles(true);
    try {
      const res = await api.mobileEquipment.listFiles(equipment.id).catch(() => ({}));
      setFiles(res?.files || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFiles(false);
    }
  };

  const loadHistory = async () => {
    if (!equipment?.id) return;
    setLoadingHistory(true);
    try {
      const res = await api.mobileEquipment.listHistory(equipment.id).catch(() => ({}));
      const checks = Array.isArray(res?.checks) ? res.checks : [];
      setHistory(checks);
    } catch (e) {
      console.error(e);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  if (!equipment) return null;

  const statusConf = getStatusConfig(equipment.status);
  const stateVariant = equipment.equipment_state === 'conforme' ? 'success' : equipment.equipment_state === 'non_conforme' ? 'danger' : 'default';

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-cyan-600 p-6 text-white">
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
              <img src={api.mobileEquipment.photoUrl(equipment.id)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Camera size={24} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{equipment.name}</h2>
            <p className="text-blue-100 text-sm">
              {equipment.building} - {equipment.floor}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {equipment.equipment_state && (
                <Badge variant={stateVariant}>
                  {equipment.equipment_state === 'conforme' ? 'Conforme' : 'Non conforme'}
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
        {/* Control Status Section - Linked to switchboard-controls */}
        <div className="bg-gray-50 rounded-xl p-4">
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
                  Controles planifies
                  {controlStatuses?.[equipment.id]?.controls?.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded-full">
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
                      {controlStatuses[equipment.id].pendingCount} planifie(s)
                    </span>
                  )}
                  {!controlStatuses?.[equipment.id]?.controls?.length && (
                    <span className="text-sm text-gray-400">Aucun controle planifie</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* List scheduled controls */}
          {controlStatuses?.[equipment.id]?.controls?.length > 0 && (
            <div className="border-t border-gray-200 pt-3 space-y-2 mb-3">
              {controlStatuses[equipment.id].controls.slice(0, 3).map((ctrl, idx) => (
                <div
                  key={idx}
                  onClick={() => navigate(`/app/switchboard-controls?tab=schedules&schedule_id=${ctrl.schedule_id}`)}
                  className={`flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-all ${
                    ctrl.status === 'overdue' ? 'bg-red-50 border border-red-200 hover:bg-red-100' : 'bg-blue-50 border border-blue-200 hover:bg-blue-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {ctrl.status === 'overdue' ? (
                      <AlertTriangle size={14} className="text-red-500" />
                    ) : (
                      <Clock size={14} className="text-blue-500" />
                    )}
                    <span className="font-medium">{ctrl.template_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={ctrl.status === 'overdue' ? 'text-red-600' : 'text-blue-600'}>
                      {ctrl.next_due ? dayjs(ctrl.next_due).format('DD/MM/YY') : '-'}
                    </span>
                    <ChevronRight size={14} className={ctrl.status === 'overdue' ? 'text-red-400' : 'text-blue-400'} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/app/switchboard-controls?tab=history&equipment_type=mobile_equipment&mobile_equipment_id=${equipment.id}`)}
              className="flex-1 py-2 px-3 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1"
            >
              <History size={14} />
              Historique
            </button>
            <button
              onClick={() => navigate(`/app/switchboard-controls?tab=schedules&equipment_type=mobile_equipment&mobile_equipment_id=${equipment.id}`)}
              className="flex-1 py-2 px-3 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 flex items-center justify-center gap-1"
            >
              <ClipboardCheck size={14} />
              Gerer
            </button>
          </div>
        </div>

        {/* Equipment Info */}
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Cpu size={16} className="text-blue-500" />
            Informations
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Code</span>
              <p className="font-medium text-gray-900">{equipment.code || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Categorie</span>
              <p className="font-medium text-gray-900">{equipment.category_name || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Marque</span>
              <p className="font-medium text-gray-900">{equipment.brand || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Modele</span>
              <p className="font-medium text-gray-900">{equipment.model || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">N Serie</span>
              <p className="font-medium text-gray-900">{equipment.serial_number || '-'}</p>
            </div>
            <div>
              <span className="text-gray-500">Puissance</span>
              <p className="font-medium text-gray-900">{equipment.power_rating || '-'}</p>
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Building2 size={16} className="text-blue-500" />
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
            <div className="col-span-2">
              <span className="text-gray-500">Emplacement</span>
              <p className="font-medium text-gray-900">{equipment.location || '-'}</p>
            </div>
          </div>
        </div>

        {/* Current Check Items Preview */}
        {equipment.current_check?.items?.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <ClipboardCheck size={16} className="text-blue-500" />
              Controle en cours
            </h3>
            <div className="space-y-2">
              {equipment.current_check.items.slice(0, 5).map((item, idx) => (
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
              <History size={16} className="text-blue-500" />
              Historique des controles
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
                <p className="text-sm text-gray-500 text-center py-2">Aucun controle</p>
              ) : (
                history.slice(0, 5).map((check) => (
                  <div key={check.id} className="bg-white rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        {dayjs(check.date || check.closed_at).format('DD/MM/YYYY')}
                      </span>
                      <Badge variant={check.result === 'conforme' ? 'success' : 'danger'}>
                        {check.result === 'conforme' ? 'Conforme' : 'Non conforme'}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500">
                      Par {check.user || 'Inconnu'}
                    </p>
                    {(check.counts || check.result_counts) && (
                      <div className="flex gap-2 mt-2 text-xs">
                        <span className="text-emerald-600">{(check.counts || check.result_counts)?.conforme || 0} OK</span>
                        <span className="text-red-600">{(check.counts || check.result_counts)?.nc || 0} NC</span>
                        <span className="text-gray-400">{(check.counts || check.result_counts)?.na || 0} N/A</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Files */}
        {files.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <FileText size={16} className="text-blue-500" />
              Fichiers ({files.length})
            </h3>
            <div className="space-y-2">
              {files.map(file => (
                <a
                  key={file.id}
                  href={file.download_url || file.inline_url || file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200 hover:border-blue-300 transition-colors"
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
          equipment={equipment}
          equipmentType="mobile"
          onAction={(action, params) => {
            if (action === 'docAttached') {
              showToast?.('Documentation associée avec succès!', 'success');
            }
          }}
        />
      </div>

      {/* Actions */}
      <div className="border-t p-4 space-y-2">
        <button
          onClick={() => onNavigateToMap(equipment)}
          className={`w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
            isPlaced
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700'
              : 'bg-gradient-to-r from-blue-500 to-cyan-600 text-white hover:from-blue-600 hover:to-cyan-700'
          }`}
        >
          <MapPin size={18} />
          {isPlaced ? 'Voir sur le plan' : 'Localiser sur le plan'}
        </button>
        <button
          onClick={() => onDelete(equipment)}
          className="w-full py-3 px-4 rounded-xl bg-red-50 text-red-600 font-medium hover:bg-red-100 flex items-center justify-center gap-2 transition-all"
        >
          <Trash2 size={18} />
          Supprimer
        </button>
      </div>

      {/* AI Chat Modal */}
      <EquipmentAIChat
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        equipmentType="mobile"
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

const EditForm = ({ equipment, categories, onSave, onCancel, showToast }) => {
  const isNew = !equipment?.id;
  const initialFormData = {
    name: '', code: '', building: '', floor: '', location: '',
    category_id: '', serial_number: '', brand: '', model: '', power_rating: ''
  };

  // Auto-save draft for new items only
  const {
    formData: draftData,
    setFormData: setDraftData,
    clearDraft,
    hasDraft
  } = useFormDraft(isNew ? 'mobile_equipment_new' : 'mobile_equipment_disabled', initialFormData, { debounceMs: 500 });

  const [form, setFormInternal] = useState(initialFormData);
  const [isSaving, setIsSaving] = useState(false);

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

  useEffect(() => {
    if (equipment?.id) {
      // Editing existing equipment
      setFormInternal({
        name: equipment.name || '',
        code: equipment.code || '',
        building: equipment.building || '',
        floor: equipment.floor || '',
        location: equipment.location || '',
        category_id: equipment.category_id || '',
        serial_number: equipment.serial_number || '',
        brand: equipment.brand || '',
        model: equipment.model || '',
        power_rating: equipment.power_rating || ''
      });
    } else if (isNew && hasDraft) {
      // New equipment - restore from draft
      setFormInternal(draftData);
    }
  }, [equipment, isNew, hasDraft, draftData]);

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
      <div className="bg-gradient-to-r from-blue-500 to-cyan-600 p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-xl">
            <Cpu size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">{isNew ? 'Nouvel equipement' : 'Modifier l\'equipement'}</h2>
            <p className="text-blue-100 text-sm">Appareil mobile electrique</p>
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Identification */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Tag size={16} className="text-blue-500" />
            Identification
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={inputBaseClass}
                placeholder="Perceuse electrique A1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input
                type="text"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                className={inputBaseClass}
                placeholder="EQ-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
              <select
                value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                className={selectBaseClass}
              >
                <option value="">-- Aucune --</option>
                {(categories || []).map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Technical Details */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Zap size={16} className="text-blue-500" />
            Details techniques
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Marque</label>
              <input
                type="text"
                value={form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                className={inputBaseClass}
                placeholder="Bosch"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modele</label>
              <input
                type="text"
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                className={inputBaseClass}
                placeholder="GSB 18V-55"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">N Serie</label>
              <input
                type="text"
                value={form.serial_number}
                onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))}
                className={inputBaseClass}
                placeholder="SN123456"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Puissance</label>
              <input
                type="text"
                value={form.power_rating}
                onChange={e => setForm(f => ({ ...f, power_rating: e.target.value }))}
                className={inputBaseClass}
                placeholder="750W"
              />
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 size={16} className="text-blue-500" />
            Localisation
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batiment</label>
              <input
                type="text"
                value={form.building}
                onChange={e => setForm(f => ({ ...f, building: e.target.value }))}
                className={inputBaseClass}
                placeholder="Batiment A"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Etage</label>
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
                placeholder="Atelier maintenance"
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
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-medium hover:from-blue-600 hover:to-cyan-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
          Enregistrer
        </button>
      </div>
    </div>
  );
};

// ==================== NOTE: Contrôles gérés via switchboard-controls ====================
// Les contrôles sont maintenant gérés depuis /app/switchboard-controls
// avec le type d'équipement "mobile_equipment"

// ==================== MAIN COMPONENT ====================

export default function MobileEquipments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // State
  const [equipments, setEquipments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [settings, setSettings] = useState(null);

  // View mode
  const [viewMode, setViewMode] = useState('detail'); // 'detail' | 'edit'

  // Placement state
  const [placedIds, setPlacedIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({});

  // Control statuses from switchboard-controls
  const [controlStatuses, setControlStatuses] = useState({});

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

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportFilters, setReportFilters] = useState({ building: '', status: '', category: '' });
  const [reportLoading, setReportLoading] = useState(false);

  // Load equipments
  const loadEquipments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.mobileEquipment.list({});
      const list = res?.items || res?.equipments || res || [];
      setEquipments(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Load equipments error:', err);
      showToast('Erreur lors du chargement', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      const res = await api.mobileEquipment.listCategories();
      setCategories(res?.categories || []);
    } catch (err) {
      console.error('Load categories error:', err);
    }
  }, []);

  // Load control statuses from switchboard-controls (like Switchboards.jsx)
  const loadControlStatuses = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules({ equipment_type: 'mobile_equipment' });
      const schedules = res.schedules || [];
      const statuses = {};
      const now = new Date();

      schedules.forEach(s => {
        if (s.mobile_equipment_id) {
          const nextDue = s.next_due_date ? new Date(s.next_due_date) : null;
          const isOverdue = nextDue && nextDue < now;

          // Initialize if not exists
          if (!statuses[s.mobile_equipment_id]) {
            statuses[s.mobile_equipment_id] = {
              status: 'ok',
              controls: [],
              overdueCount: 0,
              pendingCount: 0
            };
          }

          const controlInfo = {
            template_name: s.template_name || s.mobile_equipment_name || 'Contrôle',
            next_due: s.next_due_date,
            status: isOverdue ? 'overdue' : 'pending',
            schedule_id: s.id
          };

          statuses[s.mobile_equipment_id].controls.push(controlInfo);

          if (isOverdue) {
            statuses[s.mobile_equipment_id].overdueCount++;
            statuses[s.mobile_equipment_id].status = 'overdue';
          } else {
            statuses[s.mobile_equipment_id].pendingCount++;
            if (statuses[s.mobile_equipment_id].status !== 'overdue') {
              statuses[s.mobile_equipment_id].status = 'pending';
            }
          }
        }
      });

      setControlStatuses(statuses);
    } catch (e) {
      console.warn('Load control statuses error:', e);
    }
  }, []);

  // Load settings
  const loadSettings = useCallback(async () => {
    try {
      const res = await api.mobileEquipment.settingsGet();
      setSettings({
        checklist_template: res?.checklist_template || [],
        default_frequency: res?.default_frequency || '6_mois'
      });
    } catch (err) {
      console.error('Load settings error:', err);
    }
  }, []);

  // Load placements - get all equipment IDs that are placed on maps (like High Voltage)
  const loadPlacements = useCallback(async () => {
    try {
      const response = await api.mobileEquipment.maps.placedIds();
      const ids = response?.placed_ids || [];
      setPlacedIds(new Set(ids.map(String)));
      setPlacedDetails(response?.placed_details || {});
    } catch (err) {
      console.error('Load placements error:', err);
      setPlacedIds(new Set());
      setPlacedDetails({});
    }
  }, []);

  // Load calendar events
  const loadCalendar = useCallback(async () => {
    try {
      const res = await api.mobileEquipment.calendar?.() || {};
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
    loadEquipments();
    loadCategories();
    loadSettings();
    loadPlacements();
    loadControlStatuses();
  }, [loadEquipments, loadCategories, loadSettings, loadPlacements, loadControlStatuses]);

  // Load calendar when modal opens
  useEffect(() => {
    if (showCalendarModal) {
      loadCalendar();
    }
  }, [showCalendarModal, loadCalendar]);

  // URL params handling
  useEffect(() => {
    const equipmentId = searchParams.get('equipment');
    if (equipmentId && (!selectedEquipment || selectedEquipment.id !== equipmentId)) {
      api.mobileEquipment.get(equipmentId)
        .then(res => {
          const e = res?.equipment || res;
          if (e) {
            setSelectedEquipment(e);
            const building = e.building || 'Sans batiment';
            setExpandedBuildings(prev => ({ ...prev, [building]: true }));
          }
        })
        .catch(() => showToast('Equipement non trouve', 'error'));
    }
  }, [searchParams, showToast]);

  // Handlers
  const handleSelectEquipment = async (e) => {
    setSearchParams({ equipment: e.id.toString() });
    setViewMode('detail');

    try {
      const res = await api.mobileEquipment.get(e.id);
      setSelectedEquipment(res?.equipment || res || e);
    } catch (err) {
      setSelectedEquipment(e);
    }
  };

  const handleNewEquipment = () => {
    setSelectedEquipment({});
    setViewMode('edit');
    setSearchParams({});
  };

  const handleEditEquipment = (e) => {
    setSelectedEquipment(e);
    setViewMode('edit');
  };

  const handleSaveEquipment = async (formData) => {
    const isNew = !selectedEquipment?.id;

    try {
      let saved;
      if (isNew) {
        saved = await api.mobileEquipment.create(formData);
      } else {
        saved = await api.mobileEquipment.update(selectedEquipment.id, formData);
      }

      const newEquipment = saved?.equipment || saved;

      if (isNew) {
        setEquipments(prev => [...prev, newEquipment]);
      } else {
        setEquipments(prev => prev.map(e => e.id === newEquipment.id ? newEquipment : e));
      }

      setSelectedEquipment(newEquipment);
      setViewMode('detail');
      setSearchParams({ equipment: newEquipment.id.toString() });
      showToast(isNew ? 'Equipement cree' : 'Equipement mis a jour', 'success');
    } catch (err) {
      throw err;
    }
  };

  const handleDeleteEquipment = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      await api.mobileEquipment.remove(deleteTarget.id);
      setEquipments(prev => prev.filter(e => e.id !== deleteTarget.id));

      if (selectedEquipment?.id === deleteTarget.id) {
        setSelectedEquipment(null);
        setSearchParams({});
      }

      showToast('Equipement supprime', 'success');
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
      await api.mobileEquipment.uploadPhoto(equipmentId, file);
      showToast('Photo enregistree', 'success');

      const res = await api.mobileEquipment.get(equipmentId);
      const updated = res?.equipment || res;
      setSelectedEquipment(updated);
      setEquipments(prev => prev.map(e => e.id === equipmentId ? updated : e));
    } catch (err) {
      showToast('Erreur lors de l\'upload', 'error');
    }
  };

  const handleSaveSettings = async (newSettings) => {
    await api.mobileEquipment.settingsSet(newSettings);
    setSettings(newSettings);
  };

  // Navigate to map with plan info (like High Voltage)
  const handleNavigateToMap = (eq) => {
    const eqId = eq?.id || selectedEquipment?.id;
    if (!eqId) {
      navigate('/app/mobile-equipments/map');
      return;
    }
    const details = placedDetails[eqId] || placedDetails[String(eqId)];
    if (details?.plans?.length > 0) {
      navigate(`/app/mobile-equipments/map?equipment=${eqId}&plan=${encodeURIComponent(details.plans[0])}`);
    } else {
      // Pass equipment ID so user can position it on map
      navigate(`/app/mobile-equipments/map?equipment=${eqId}`);
    }
  };

  // Build tree structure: Building > Floor > Equipments
  const tree = useMemo(() => {
    const result = {};
    const query = searchQuery.toLowerCase();
    const equipmentsList = Array.isArray(equipments) ? equipments : [];

    const filtered = equipmentsList.filter(e => {
      if (!query) return true;
      return (
        e.name?.toLowerCase().includes(query) ||
        e.code?.toLowerCase().includes(query) ||
        e.building?.toLowerCase().includes(query) ||
        e.floor?.toLowerCase().includes(query) ||
        e.location?.toLowerCase().includes(query)
      );
    });

    filtered.forEach(e => {
      const building = e.building || 'Sans batiment';
      const floor = e.floor || 'Sans etage';

      if (!result[building]) result[building] = {};
      if (!result[building][floor]) result[building][floor] = [];
      result[building][floor].push(e);
    });

    // Sort equipments within each floor
    Object.values(result).forEach(floors => {
      Object.values(floors).forEach(equipmentList => {
        equipmentList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      });
    });

    return result;
  }, [equipments, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const equipmentsList = Array.isArray(equipments) ? equipments : [];
    const total = equipmentsList.length;
    const aFaire = equipmentsList.filter(e => e.status === STATUS.A_FAIRE).length;
    const enCours = equipmentsList.filter(e => e.status === STATUS.EN_COURS).length;
    const enRetard = equipmentsList.filter(e => e.status === STATUS.EN_RETARD).length;
    const placed = equipmentsList.filter(e => placedIds.has(String(e.id))).length;
    return { total, aFaire, enCours, enRetard, placed };
  }, [equipments, placedIds]);

  const isPlaced = (id) => placedIds.has(String(id));

  // Liste des bâtiments uniques pour le filtre du rapport
  const buildings = useMemo(() => {
    const set = new Set(equipments.map(e => e.building).filter(Boolean));
    return Array.from(set).sort();
  }, [equipments]);

  // Liste des catégories uniques
  const meCategories = useMemo(() => {
    const set = new Set(equipments.map(e => e.category).filter(Boolean));
    return Array.from(set).sort();
  }, [equipments]);

  // Fonction pour générer le rapport PDF
  const generateReport = useCallback(() => {
    setReportLoading(true);
    try {
      const url = api.mobileEquipment.reportUrl(reportFilters);
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
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white">
                <Cpu size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Appareils Mobiles</h1>
                <p className="text-xs text-gray-500">Controles electriques</p>
              </div>
            </div>
          </div>

          {/* Stats - Desktop */}
          <div className="hidden md:flex items-center gap-2">
            <Badge variant="default">{stats.total} equipements</Badge>
            <Badge variant="success">{stats.placed} localises</Badge>
          </div>

          {/* Stats - Mobile (condensed) */}
          <div className="flex md:hidden items-center gap-1.5">
            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">{stats.total}</span>
            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium">{stats.placed} loc.</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCalendarModal(true)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
              title="Calendrier des controles"
            >
              <Calendar size={20} />
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 hover:bg-purple-100 rounded-lg text-purple-600"
              title="Gerer les categories"
            >
              <Tag size={20} />
            </button>
            <button
              onClick={() => setShowReportModal(true)}
              className="px-4 py-2 rounded-xl bg-amber-100 text-amber-700 font-medium hover:bg-amber-200 flex items-center gap-2"
              title="Générer un rapport PDF"
            >
              <FileText size={18} />
              <span className="hidden sm:inline">Rapport</span>
            </button>
            <button
              onClick={() => navigate('/app/mobile-equipments/map')}
              className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 flex items-center gap-2"
            >
              <MapPin size={18} />
              <span className="hidden sm:inline">Plans</span>
            </button>
            <button
              onClick={handleNewEquipment}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-medium hover:from-blue-600 hover:to-cyan-700 flex items-center gap-2"
            >
              <Plus size={18} />
              <span className="hidden sm:inline">Nouveau</span>
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
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto">
              <div className="space-y-1 p-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw size={24} className="animate-spin text-gray-400" />
                  </div>
                ) : Object.keys(tree).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Cpu size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucun equipement</p>
                  </div>
                ) : (
                  Object.entries(tree).map(([building, floors]) => (
                    <div key={building}>
                      <button
                        onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
                      >
                        {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Building2 size={16} className="text-blue-500" />
                        <span className="font-medium truncate flex-1">{building}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          {Object.values(floors).flat().length}
                        </span>
                      </button>

                      {expandedBuildings[building] && (
                        <div className="ml-4 space-y-1 mt-1">
                          {Object.entries(floors).map(([floor, equipmentList]) => (
                            <div key={floor}>
                              <div className="px-3 py-1.5 text-xs font-medium text-gray-500 flex items-center gap-1">
                                <Layers size={12} />
                                {floor}
                              </div>
                              {equipmentList.map(eq => {
                                return (
                                  <button
                                    key={eq.id}
                                    onClick={() => handleSelectEquipment(eq)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg ml-2
                                      ${selectedEquipment?.id === eq.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                                  >
                                    <Cpu size={14} className="text-cyan-500" />
                                    <span className="text-sm truncate flex-1">{eq.name}</span>
                                    {!isPlaced(eq.id) && (
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
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewMode === 'detail' && selectedEquipment?.id ? (
            <DetailPanel
              equipment={selectedEquipment}
              onClose={() => { setSelectedEquipment(null); setSearchParams({}); }}
              onEdit={handleEditEquipment}
              onDelete={(e) => { setDeleteTarget(e); setShowDeleteModal(true); }}
              onShare={(e) => setShowShareModal(true)}
              onNavigateToMap={handleNavigateToMap}
              onPhotoUpload={handlePhotoUpload}
              isPlaced={isPlaced(selectedEquipment?.id)}
              showToast={showToast}
              controlStatuses={controlStatuses}
              navigate={navigate}
            />
          ) : viewMode === 'edit' ? (
            <EditForm
              equipment={selectedEquipment}
              categories={categories}
              onSave={handleSaveEquipment}
              onCancel={() => {
                if (selectedEquipment?.id) {
                  setViewMode('detail');
                } else {
                  setSelectedEquipment(null);
                  setSearchParams({});
                }
              }}
              showToast={showToast}
            />
          ) : isMobile ? (
            /* Mobile: show tree directly when no equipment selected */
            <div className="flex-1 bg-white p-3 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw size={32} className="animate-spin text-blue-500" />
                </div>
              ) : Object.keys(tree).length === 0 ? (
                <div className="text-center py-12">
                  <Cpu size={48} className="mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-medium text-gray-600 mb-2">Aucun equipement</h3>
                  <p className="text-gray-500 text-sm max-w-xs mx-auto mb-4">
                    Commencez par creer votre premier appareil mobile
                  </p>
                  <button
                    onClick={handleNewEquipment}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-medium hover:from-blue-600 hover:to-cyan-700 flex items-center gap-2 mx-auto"
                  >
                    <Plus size={18} />
                    Nouvel equipement
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(tree).map(([building, floors]) => (
                    <div key={building} className="bg-gray-50 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-gray-100"
                      >
                        {expandedBuildings[building] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        <Building2 size={18} className="text-blue-500" />
                        <span className="font-semibold truncate flex-1">{building}</span>
                        <span className="text-xs text-gray-400 bg-white px-2 py-1 rounded-full shadow-sm">
                          {Object.values(floors).flat().length}
                        </span>
                      </button>

                      {expandedBuildings[building] && (
                        <div className="bg-white border-t divide-y">
                          {Object.entries(floors).map(([floor, equipmentList]) => (
                            <div key={floor}>
                              <div className="px-4 py-2 text-xs font-medium text-gray-500 flex items-center gap-2 bg-gray-50/50">
                                <Layers size={14} className="text-amber-500" />
                                {floor}
                                <span className="text-gray-400">({equipmentList.length})</span>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {equipmentList.map(eq => {
                                  return (
                                    <button
                                      key={eq.id}
                                      onClick={() => handleSelectEquipment(eq)}
                                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50 transition-colors"
                                    >
                                      <Cpu size={16} className="text-cyan-500" />
                                      <div className="flex-1 min-w-0">
                                        <span className="text-sm font-medium text-gray-900 block truncate">{eq.name}</span>
                                        <span className="text-xs text-gray-500 truncate block">
                                          {eq.code} {eq.brand && `• ${eq.brand}`}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {!placedIds.has(String(eq.id)) && (
                                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded-full flex items-center gap-0.5">
                                            <MapPin size={10} />
                                          </span>
                                        )}
                                      </div>
                                      <ChevronRight size={16} className="text-gray-300" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Desktop: empty state */
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <Cpu size={48} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">Appareils Mobiles</h3>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                  Selectionnez un equipement dans la liste ou creez-en un nouveau
                </p>
                <button
                  onClick={handleNewEquipment}
                  className="mt-4 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-medium hover:from-blue-600 hover:to-cyan-700 flex items-center gap-2 mx-auto"
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
        tree={tree}
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
        itemName={deleteTarget?.name}
        isLoading={isDeleting}
      />

      <ShareLinkModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        equipment={selectedEquipment}
      />

      <CategoryManagerModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        categories={categories}
        onCategoriesChange={loadCategories}
        showToast={showToast}
      />

      <CalendarModal
        isOpen={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
        events={calendarEvents}
        onDayClick={(day) => {
          setShowCalendarModal(false);
          if (day.events?.[0]?.equipment_id) {
            handleSelectEquipment({ id: day.events[0].equipment_id });
          }
        }}
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
                  <p className="text-amber-100 text-sm">Équipements mobiles</p>
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

              {/* Filtre Catégorie */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                <select
                  value={reportFilters.category}
                  onChange={e => setReportFilters(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="">Toutes les catégories</option>
                  {meCategories.map(c => <option key={c} value={c}>{c}</option>)}
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
                  <option value="a_faire">À faire</option>
                  <option value="en_cours">En cours</option>
                  <option value="en_retard">En retard</option>
                  <option value="fait">Fait</option>
                </select>
              </div>

              {/* Résumé */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm text-amber-800">
                  <span className="font-medium">Le rapport inclura :</span>{' '}
                  {reportFilters.building || "Tous les bâtiments"}
                  {" / "}
                  {reportFilters.category || "Toutes les catégories"}
                  {" / "}
                  {reportFilters.status === "a_faire" ? "À faire" :
                   reportFilters.status === "en_cours" ? "En cours" :
                   reportFilters.status === "en_retard" ? "En retard" :
                   reportFilters.status === "fait" ? "Fait" : "Tous les statuts"}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t p-4 flex gap-3">
              <button
                onClick={() => { setShowReportModal(false); setReportFilters({ building: '', status: '', category: '' }); }}
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
    </div>
  );
}