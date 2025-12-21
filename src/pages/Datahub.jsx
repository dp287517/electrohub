// src/pages/Datahub.jsx - Datahub with custom category markers
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Database, Plus, Search, ChevronRight, ChevronDown, Building2, Layers,
  Trash2, Edit3, Save, X, AlertTriangle, CheckCircle, RefreshCw, MapPin,
  Tag, Camera, FileText, Download, Settings, Palette, Circle, Square, Triangle,
  Star, Heart, Zap, Flame, Droplet, Wind, Sun, Moon, Cloud, Thermometer,
  Gauge, Power, Cpu, Wifi, Radio, Speaker, Mic, Headphones, Monitor, Smartphone,
  Printer, Server, HardDrive, Usb, Cable, Plug, Battery, BatteryCharging,
  Wrench, Hammer, Scissors, Key, Lock, Unlock, Shield, AlertCircle, Info,
  HelpCircle, Clock, Timer, Calendar, Bell, Mail, MessageSquare, Phone,
  Video, Image, Film, Music, Folder, File, Archive, Box, Package, Gift,
  ShoppingCart, CreditCard, Wallet, DollarSign, PieChart, BarChart2, LineChart,
  TrendingUp, Activity, Target, Flag, Bookmark, Award, Trophy, Crown, Gem,
  Eye, EyeOff, User, Users, UserCheck, Home, Building, Factory, Store,
  Car, Truck, Plane, Ship, Train, Bike, Footprints, Map, Compass, Navigation,
  Globe, Pin, Anchor, Crosshair, Move, Maximize, Minimize, Copy, Clipboard,
  Check, XCircle, MinusCircle, PlusCircle, ArrowUp, ArrowDown, ArrowLeft, ArrowRight
} from 'lucide-react';
import { api } from '../lib/api';

// Toast Component
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  const bg = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  return (
    <div className={`fixed bottom-4 right-4 z-[200] ${bg} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3`}>
      {type === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
      <span className="font-medium">{message}</span>
      <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg"><X size={16} /></button>
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
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>{children}</span>;
};

// Color picker presets
const COLOR_PRESETS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
  '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#A855F7'
];

// Icon presets for markers - extensive list
const ICON_PRESETS = [
  // Shapes
  { id: 'circle', label: 'Cercle', icon: Circle },
  { id: 'square', label: 'Carré', icon: Square },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'star', label: 'Étoile', icon: Star },
  { id: 'heart', label: 'Cœur', icon: Heart },
  { id: 'target', label: 'Cible', icon: Target },
  // Location
  { id: 'mappin', label: 'Pin', icon: MapPin },
  { id: 'pin', label: 'Épingle', icon: Pin },
  { id: 'crosshair', label: 'Viseur', icon: Crosshair },
  { id: 'compass', label: 'Boussole', icon: Compass },
  { id: 'navigation', label: 'Navigation', icon: Navigation },
  { id: 'flag', label: 'Drapeau', icon: Flag },
  // Data & Tech
  { id: 'database', label: 'Base données', icon: Database },
  { id: 'server', label: 'Serveur', icon: Server },
  { id: 'harddrive', label: 'Disque dur', icon: HardDrive },
  { id: 'cpu', label: 'Processeur', icon: Cpu },
  { id: 'wifi', label: 'Wifi', icon: Wifi },
  { id: 'monitor', label: 'Écran', icon: Monitor },
  // Energy & Power
  { id: 'zap', label: 'Électricité', icon: Zap },
  { id: 'power', label: 'Power', icon: Power },
  { id: 'battery', label: 'Batterie', icon: Battery },
  { id: 'plug', label: 'Prise', icon: Plug },
  { id: 'flame', label: 'Flamme', icon: Flame },
  { id: 'thermometer', label: 'Thermomètre', icon: Thermometer },
  // Industrial
  { id: 'gauge', label: 'Jauge', icon: Gauge },
  { id: 'wrench', label: 'Clé', icon: Wrench },
  { id: 'hammer', label: 'Marteau', icon: Hammer },
  { id: 'factory', label: 'Usine', icon: Factory },
  { id: 'cable', label: 'Câble', icon: Cable },
  // Nature
  { id: 'droplet', label: 'Goutte', icon: Droplet },
  { id: 'wind', label: 'Vent', icon: Wind },
  { id: 'sun', label: 'Soleil', icon: Sun },
  { id: 'cloud', label: 'Nuage', icon: Cloud },
  // Status
  { id: 'check', label: 'Validé', icon: Check },
  { id: 'alertcircle', label: 'Alerte', icon: AlertCircle },
  { id: 'info', label: 'Info', icon: Info },
  { id: 'shield', label: 'Sécurité', icon: Shield },
  { id: 'lock', label: 'Verrouillé', icon: Lock },
  { id: 'eye', label: 'Visible', icon: Eye },
  // Other
  { id: 'tag', label: 'Tag', icon: Tag },
  { id: 'bookmark', label: 'Marque-page', icon: Bookmark },
  { id: 'award', label: 'Récompense', icon: Award },
  { id: 'user', label: 'Utilisateur', icon: User },
  { id: 'users', label: 'Groupe', icon: Users },
  { id: 'building', label: 'Bâtiment', icon: Building },
  { id: 'home', label: 'Maison', icon: Home },
  { id: 'box', label: 'Boîte', icon: Box },
  { id: 'package', label: 'Colis', icon: Package },
  { id: 'folder', label: 'Dossier', icon: Folder },
  { id: 'file', label: 'Fichier', icon: File },
  { id: 'clock', label: 'Horloge', icon: Clock },
  { id: 'calendar', label: 'Calendrier', icon: Calendar },
  { id: 'bell', label: 'Cloche', icon: Bell },
];

// Category Manager Modal
const CategoryManagerModal = ({ isOpen, onClose, categories, onCategoriesChange, showToast }) => {
  const [localCategories, setLocalCategories] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', color: '#3B82F6', icon: 'circle', marker_size: 32 });
  const [isLoading, setIsLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: '', description: '', color: '#3B82F6', icon: 'circle', marker_size: 32 });

  useEffect(() => { if (categories) setLocalCategories([...categories]); }, [categories]);
  useEffect(() => { if (!isOpen) { setEditingId(null); setShowNewForm(false); } }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!newCategory.name.trim()) { showToast('Le nom est requis', 'error'); return; }
    setIsLoading(true);
    try {
      await api.datahub.createCategory(newCategory);
      showToast('Categorie creee', 'success');
      setNewCategory({ name: '', description: '', color: '#3B82F6', icon: 'circle', marker_size: 32 });
      setShowNewForm(false);
      onCategoriesChange();
    } catch { showToast('Erreur', 'error'); }
    finally { setIsLoading(false); }
  };

  const handleUpdate = async (id) => {
    if (!editForm.name.trim()) { showToast('Le nom est requis', 'error'); return; }
    setIsLoading(true);
    try {
      await api.datahub.updateCategory(id, editForm);
      showToast('Categorie mise a jour', 'success');
      setEditingId(null);
      onCategoriesChange();
    } catch { showToast('Erreur', 'error'); }
    finally { setIsLoading(false); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Supprimer "${name}" ?`)) return;
    setIsLoading(true);
    try {
      await api.datahub.deleteCategory(id);
      showToast('Categorie supprimee', 'success');
      onCategoriesChange();
    } catch { showToast('Erreur', 'error'); }
    finally { setIsLoading(false); }
  };

  const CategoryForm = ({ form, setForm, onSave, onCancel, saveLabel }) => (
    <div className="bg-purple-50 rounded-xl p-4 space-y-3 border border-purple-200">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Nom *</label>
        <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500" placeholder="Nom de la catégorie" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500" placeholder="Description optionnelle" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">Couleur:</span>
        {COLOR_PRESETS.map(c => (
          <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">Icône:</span>
        {ICON_PRESETS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setForm(f => ({ ...f, icon: id }))}
            className={`p-2 rounded-lg border-2 transition-all ${form.icon === id ? 'border-purple-600 bg-purple-100' : 'border-gray-200 hover:border-purple-300'}`}
            title={label}>
            <Icon size={18} className={form.icon === id ? 'text-purple-600' : 'text-gray-500'} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">Taille:</span>
        {[24, 32, 40, 48].map(s => (
          <button key={s} onClick={() => setForm(f => ({ ...f, marker_size: s }))}
            className={`px-2 py-1 rounded text-xs ${form.marker_size === s ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
            {s}px
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 px-3 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Annuler</button>
        <button onClick={onSave} disabled={isLoading}
          className="flex-1 py-2 px-3 rounded-lg bg-purple-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1 hover:bg-purple-700">
          {isLoading ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} {saveLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl"><Palette size={24} /></div>
              <div>
                <h2 className="text-xl font-bold">Categories</h2>
                <p className="text-purple-200 text-sm">Personnaliser les marqueurs</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {!showNewForm && (
            <button onClick={() => setShowNewForm(true)}
              className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-purple-300 text-purple-600 font-medium hover:bg-purple-50 flex items-center justify-center gap-2">
              <Plus size={18} /> Ajouter une categorie
            </button>
          )}

          {showNewForm && (
            <CategoryForm form={newCategory} setForm={setNewCategory} onSave={handleCreate}
              onCancel={() => { setShowNewForm(false); setNewCategory({ name: '', description: '', color: '#3B82F6', icon: 'circle', marker_size: 32 }); }}
              saveLabel="Creer" />
          )}

          <div className="space-y-2">
            {localCategories.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Tag size={32} className="mx-auto mb-2 opacity-30" />
                <p>Aucune categorie</p>
              </div>
            ) : localCategories.map(cat => (
              <div key={cat.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                {editingId === cat.id ? (
                  <CategoryForm form={editForm} setForm={setEditForm} onSave={() => handleUpdate(cat.id)}
                    onCancel={() => setEditingId(null)} saveLabel="Sauvegarder" />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-sm" style={{ backgroundColor: cat.color }}>
                        {(() => {
                          const iconData = ICON_PRESETS.find(i => i.id === cat.icon);
                          const IconComp = iconData?.icon || Circle;
                          return <IconComp size={18} className="text-white" />;
                        })()}
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">{cat.name}</h4>
                        {cat.description && <p className="text-sm text-gray-500">{cat.description}</p>}
                        <span className="text-xs text-gray-400">{cat.item_count || 0} items • {cat.marker_size}px • {ICON_PRESETS.find(i => i.id === cat.icon)?.label || 'Cercle'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingId(cat.id); setEditForm({ name: cat.name, description: cat.description || '', color: cat.color, icon: cat.icon, marker_size: cat.marker_size }); }}
                        className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-purple-600"><Edit3 size={16} /></button>
                      <button onClick={() => handleDelete(cat.id, cat.name)}
                        className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-red-600"><Trash2 size={16} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t p-4">
          <button onClick={onClose} className="w-full py-3 px-4 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">Fermer</button>
        </div>
      </div>
    </div>
  );
};

// Detail Panel
const DetailPanel = ({ item, onClose, onEdit, onDelete, onNavigateToMap, isPlaced, categories }) => {
  if (!item) return null;
  const cat = categories?.find(c => c.id === item.category_id);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg md:hidden"><X size={20} /></button>
          <button onClick={() => onEdit(item)} className="p-2 hover:bg-white/20 rounded-lg"><Edit3 size={18} /></button>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center" style={{ backgroundColor: cat?.color || '#6366F1' }}>
            <Database size={28} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{item.name}</h2>
            <p className="text-indigo-100 text-sm">{item.building} - {item.floor}</p>
            <div className="flex items-center gap-2 mt-2">
              {cat && <Badge variant="default" style={{ backgroundColor: cat.color + '20', color: cat.color }}>{cat.name}</Badge>}
              {isPlaced ? <Badge variant="success"><MapPin size={10} className="inline mr-1" />Localise</Badge>
                : <Badge variant="warning"><MapPin size={10} className="inline mr-1" />Non localise</Badge>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Database size={16} className="text-indigo-500" />Informations</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Code</span><p className="font-medium">{item.code || '-'}</p></div>
            <div><span className="text-gray-500">Categorie</span><p className="font-medium">{cat?.name || '-'}</p></div>
            <div className="col-span-2"><span className="text-gray-500">Description</span><p className="font-medium">{item.description || '-'}</p></div>
            <div className="col-span-2"><span className="text-gray-500">Notes</span><p className="font-medium">{item.notes || '-'}</p></div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Building2 size={16} className="text-indigo-500" />Localisation</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Batiment</span><p className="font-medium">{item.building || '-'}</p></div>
            <div><span className="text-gray-500">Etage</span><p className="font-medium">{item.floor || '-'}</p></div>
            <div className="col-span-2"><span className="text-gray-500">Emplacement</span><p className="font-medium">{item.location || '-'}</p></div>
          </div>
        </div>
      </div>

      <div className="border-t p-4 space-y-2">
        <button onClick={() => onNavigateToMap(item)}
          className={`w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 ${isPlaced
            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
            : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'}`}>
          <MapPin size={18} />{isPlaced ? 'Voir sur le plan' : 'Localiser sur le plan'}
        </button>
        <button onClick={() => onDelete(item)}
          className="w-full py-3 px-4 rounded-xl bg-red-50 text-red-600 font-medium hover:bg-red-100 flex items-center justify-center gap-2">
          <Trash2 size={18} />Supprimer
        </button>
      </div>
    </div>
  );
};

// Edit Form
const EditForm = ({ item, categories, onSave, onCancel, showToast }) => {
  const isNew = !item?.id;
  const [form, setForm] = useState({ name: '', code: '', category_id: '', building: '', floor: '', location: '', description: '', notes: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (item) setForm({
      name: item.name || '', code: item.code || '', category_id: item.category_id || '',
      building: item.building || '', floor: item.floor || '', location: item.location || '',
      description: item.description || '', notes: item.notes || ''
    });
  }, [item]);

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('Le nom est requis', 'error'); return; }
    setIsSaving(true);
    try { await onSave(form); } catch { showToast('Erreur', 'error'); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-xl"><Database size={24} /></div>
          <div>
            <h2 className="text-xl font-bold">{isNew ? 'Nouvel item' : 'Modifier'}</h2>
            <p className="text-indigo-100 text-sm">Datahub</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Tag size={16} className="text-indigo-500" />Identification</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" placeholder="Nom de l'item" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" placeholder="DH-001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
              <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl bg-white">
                <option value="">-- Aucune --</option>
                {(categories || []).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Building2 size={16} className="text-indigo-500" />Localisation</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Batiment</label>
              <input type="text" value={form.building} onChange={e => setForm(f => ({ ...f, building: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Etage</label>
              <input type="text" value={form.floor} onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" /></div>
            <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Emplacement</label>
              <input type="text" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" /></div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><FileText size={16} className="text-indigo-500" />Details</h3>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" rows={2} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" rows={2} /></div>
        </div>
      </div>

      <div className="border-t p-4 flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
        <button onClick={handleSave} disabled={isSaving}
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
          {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}Enregistrer
        </button>
      </div>
    </div>
  );
};

// Main Component
export default function Datahub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [viewMode, setViewMode] = useState('detail');
  const [placedIds, setPlacedIds] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), []);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.datahub.list({});
      setItems(res?.items || []);
    } catch { showToast('Erreur chargement', 'error'); }
    finally { setIsLoading(false); }
  }, [showToast]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.datahub.listCategories();
      setCategories(res?.categories || []);
    } catch {}
  }, []);

  const loadPlacements = useCallback(async () => {
    try {
      const res = await api.datahub.maps.placedIds();
      setPlacedIds(new Set((res?.placed_ids || []).map(String)));
    } catch { setPlacedIds(new Set()); }
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => { loadItems(); loadCategories(); loadPlacements(); }, [loadItems, loadCategories, loadPlacements]);

  useEffect(() => {
    const itemId = searchParams.get('item');
    if (itemId && (!selectedItem || selectedItem.id !== itemId)) {
      api.datahub.get(itemId).then(res => {
        if (res?.item) { setSelectedItem(res.item); setExpandedBuildings(prev => ({ ...prev, [res.item.building || 'Sans batiment']: true })); }
      }).catch(() => showToast('Item non trouve', 'error'));
    }
  }, [searchParams, showToast]);

  const handleSelectItem = async (item) => {
    setSearchParams({ item: item.id });
    setViewMode('detail');
    try { const res = await api.datahub.get(item.id); setSelectedItem(res?.item || item); }
    catch { setSelectedItem(item); }
  };

  const handleNewItem = () => { setSelectedItem({}); setViewMode('edit'); setSearchParams({}); };

  const handleSaveItem = async (formData) => {
    const isNew = !selectedItem?.id;
    try {
      const saved = isNew ? await api.datahub.create(formData) : await api.datahub.update(selectedItem.id, formData);
      const newItem = saved?.item;
      if (isNew) setItems(prev => [...prev, newItem]);
      else setItems(prev => prev.map(i => i.id === newItem.id ? newItem : i));
      setSelectedItem(newItem);
      setViewMode('detail');
      setSearchParams({ item: newItem.id });
      showToast(isNew ? 'Item cree' : 'Item mis a jour', 'success');
    } catch { throw new Error('Save failed'); }
  };

  const handleDeleteItem = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.datahub.remove(deleteTarget.id);
      setItems(prev => prev.filter(i => i.id !== deleteTarget.id));
      if (selectedItem?.id === deleteTarget.id) { setSelectedItem(null); setSearchParams({}); }
      showToast('Item supprime', 'success');
      setShowDeleteModal(false);
      setDeleteTarget(null);
    } catch { showToast('Erreur suppression', 'error'); }
    finally { setIsDeleting(false); }
  };

  const tree = useMemo(() => {
    const result = {};
    const query = searchQuery.toLowerCase();
    const filtered = items.filter(i => !query || i.name?.toLowerCase().includes(query) || i.code?.toLowerCase().includes(query));
    filtered.forEach(i => {
      const building = i.building || 'Sans batiment';
      const floor = i.floor || 'Sans etage';
      if (!result[building]) result[building] = {};
      if (!result[building][floor]) result[building][floor] = [];
      result[building][floor].push(i);
    });
    return result;
  }, [items, searchQuery]);

  const stats = useMemo(() => ({
    total: items.length,
    placed: items.filter(i => placedIds.has(String(i.id))).length,
    categories: categories.length
  }), [items, placedIds, categories]);

  const isPlaced = (id) => placedIds.has(String(id));

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
              <Database size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Datahub</h1>
              <p className="text-xs text-gray-500">Gestion des donnees</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Badge variant="default">{stats.total} items</Badge>
            <Badge variant="success">{stats.placed} localises</Badge>
            <Badge variant="default">{stats.categories} categories</Badge>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowCategoryModal(true)} className="p-2 hover:bg-purple-100 rounded-lg text-purple-600" title="Categories">
              <Palette size={20} />
            </button>
            <button onClick={() => navigate('/app/datahub/map')} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 flex items-center gap-2">
              <MapPin size={18} /><span className="hidden sm:inline">Plans</span>
            </button>
            <button onClick={handleNewItem} className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium flex items-center gap-2">
              <Plus size={18} /><span className="hidden sm:inline">Nouveau</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {!isMobile && (
          <div className="w-80 border-r bg-white flex flex-col overflow-hidden">
            <div className="p-4 border-b">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..." className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8"><RefreshCw size={24} className="animate-spin text-gray-400" /></div>
              ) : Object.keys(tree).length === 0 ? (
                <div className="text-center py-8 text-gray-500"><Database size={32} className="mx-auto mb-2 opacity-50" /><p className="text-sm">Aucun item</p></div>
              ) : Object.entries(tree).map(([building, floors]) => (
                <div key={building}>
                  <button onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg">
                    {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <Building2 size={16} className="text-indigo-500" />
                    <span className="font-medium truncate flex-1">{building}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{Object.values(floors).flat().length}</span>
                  </button>
                  {expandedBuildings[building] && (
                    <div className="ml-4 space-y-1 mt-1">
                      {Object.entries(floors).map(([floor, floorItems]) => (
                        <div key={floor}>
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 flex items-center gap-1"><Layers size={12} />{floor}</div>
                          {floorItems.map(item => {
                            const cat = categories.find(c => c.id === item.category_id);
                            return (
                              <button key={item.id} onClick={() => handleSelectItem(item)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg ml-2 ${selectedItem?.id === item.id ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat?.color || '#6366F1' }} />
                                <span className="text-sm truncate flex-1">{item.name}</span>
                                {!isPlaced(item.id) && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[9px] rounded-full"><MapPin size={8} /></span>}
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
        )}

        {/* Main Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewMode === 'detail' && selectedItem?.id ? (
            <DetailPanel item={selectedItem} categories={categories}
              onClose={() => { setSelectedItem(null); setSearchParams({}); }}
              onEdit={(i) => { setSelectedItem(i); setViewMode('edit'); }}
              onDelete={(i) => { setDeleteTarget(i); setShowDeleteModal(true); }}
              onNavigateToMap={(i) => navigate('/app/datahub/map?item=' + i.id)}
              isPlaced={isPlaced(selectedItem?.id)} />
          ) : viewMode === 'edit' ? (
            <EditForm item={selectedItem} categories={categories} onSave={handleSaveItem} showToast={showToast}
              onCancel={() => { if (selectedItem?.id) setViewMode('detail'); else { setSelectedItem(null); setSearchParams({}); } }} />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <Database size={48} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">Datahub</h3>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">Selectionnez un item ou creez-en un nouveau</p>
                <button onClick={handleNewItem} className="mt-4 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium flex items-center gap-2 mx-auto">
                  <Plus size={18} />Nouvel item
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-rose-600 p-6 text-white">
              <div className="flex items-center gap-3"><AlertTriangle size={24} /><h2 className="text-xl font-bold">Confirmer la suppression</h2></div>
            </div>
            <div className="p-6"><p>Supprimer "{deleteTarget?.name}" ?</p></div>
            <div className="border-t p-4 flex gap-3">
              <button onClick={() => { setShowDeleteModal(false); setDeleteTarget(null); }} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700">Annuler</button>
              <button onClick={handleDeleteItem} disabled={isDeleting} className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {isDeleting ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      <CategoryManagerModal isOpen={showCategoryModal} onClose={() => setShowCategoryModal(false)}
        categories={categories} onCategoriesChange={loadCategories} showToast={showToast} />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
