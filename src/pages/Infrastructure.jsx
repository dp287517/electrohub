// src/pages/Infrastructure.jsx - Infrastructure management with custom category markers
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useFormDraft } from '../hooks/useFormDraft';
import {
  Building2, Plus, Search, ChevronRight, ChevronDown, Layers,
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
import { getUserPermissions } from '../lib/permissions';

// ==================== PERMISSION HELPERS ====================

function getCurrentUserEmail() {
  try {
    const ehUser = localStorage.getItem('eh_user');
    if (ehUser) {
      const user = JSON.parse(ehUser);
      if (user?.email) return user.email.toLowerCase();
    }
    const email = localStorage.getItem('email') || localStorage.getItem('user.email');
    if (email) return email.toLowerCase();
  } catch (e) {}
  return null;
}

function canDeleteEquipment(item) {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return false;
  const permissions = getUserPermissions(currentEmail);
  if (permissions?.isAdmin) return true;
  const creatorEmail = item?.created_by_email?.toLowerCase();
  if (creatorEmail && creatorEmail === currentEmail) return true;
  return false;
}

import MiniElectro from '../components/MiniElectro';
import ImageLightbox, { useLightbox } from '../components/ImageLightbox';

// Icon mapping for dynamic category icons
const ICON_MAP = {
  circle: Circle, square: Square, triangle: Triangle, star: Star, heart: Heart,
  target: Target, mappin: MapPin, pin: Pin, crosshair: Crosshair, compass: Compass,
  navigation: Navigation, flag: Flag, database: Server, server: Server,
  harddrive: HardDrive, cpu: Cpu, wifi: Wifi, monitor: Monitor, zap: Zap,
  power: Power, battery: Battery, plug: Plug, flame: Flame, thermometer: Thermometer,
  gauge: Gauge, wrench: Wrench, hammer: Hammer, factory: Factory, cable: Cable,
  droplet: Droplet, wind: Wind, sun: Sun, cloud: Cloud, check: Check,
  alertcircle: AlertCircle, info: Info, shield: Shield, lock: Lock, eye: Eye,
  tag: Tag, bookmark: Bookmark, award: Award, user: User, users: Users,
  building: Building2, home: Home, box: Box, package: Package, folder: Folder,
  file: File, clock: Clock, calendar: Calendar, bell: Bell
};

// Toast Component
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  const bg = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-violet-500';
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
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B', '#84CC16', '#10B981', '#14B8A6', '#06B6D4'
];

// Icon presets for markers - extensive list
const ICON_PRESETS = [
  // Buildings & Infrastructure
  { id: 'building', label: 'Batiment', icon: Building2 },
  { id: 'home', label: 'Maison', icon: Home },
  { id: 'factory', label: 'Usine', icon: Factory },
  // Shapes
  { id: 'circle', label: 'Cercle', icon: Circle },
  { id: 'square', label: 'Carre', icon: Square },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'star', label: 'Etoile', icon: Star },
  { id: 'heart', label: 'Coeur', icon: Heart },
  { id: 'target', label: 'Cible', icon: Target },
  // Location
  { id: 'mappin', label: 'Pin', icon: MapPin },
  { id: 'pin', label: 'Epingle', icon: Pin },
  { id: 'crosshair', label: 'Viseur', icon: Crosshair },
  { id: 'compass', label: 'Boussole', icon: Compass },
  { id: 'navigation', label: 'Navigation', icon: Navigation },
  { id: 'flag', label: 'Drapeau', icon: Flag },
  // Data & Tech
  { id: 'server', label: 'Serveur', icon: Server },
  { id: 'harddrive', label: 'Disque dur', icon: HardDrive },
  { id: 'cpu', label: 'Processeur', icon: Cpu },
  { id: 'wifi', label: 'Wifi', icon: Wifi },
  { id: 'monitor', label: 'Ecran', icon: Monitor },
  // Energy & Power
  { id: 'zap', label: 'Electricite', icon: Zap },
  { id: 'power', label: 'Power', icon: Power },
  { id: 'battery', label: 'Batterie', icon: Battery },
  { id: 'plug', label: 'Prise', icon: Plug },
  { id: 'flame', label: 'Flamme', icon: Flame },
  { id: 'thermometer', label: 'Thermometre', icon: Thermometer },
  // Industrial
  { id: 'gauge', label: 'Jauge', icon: Gauge },
  { id: 'wrench', label: 'Cle', icon: Wrench },
  { id: 'hammer', label: 'Marteau', icon: Hammer },
  { id: 'cable', label: 'Cable', icon: Cable },
  // Nature
  { id: 'droplet', label: 'Goutte', icon: Droplet },
  { id: 'wind', label: 'Vent', icon: Wind },
  { id: 'sun', label: 'Soleil', icon: Sun },
  { id: 'cloud', label: 'Nuage', icon: Cloud },
  // Status
  { id: 'check', label: 'Valide', icon: Check },
  { id: 'alertcircle', label: 'Alerte', icon: AlertCircle },
  { id: 'info', label: 'Info', icon: Info },
  { id: 'shield', label: 'Securite', icon: Shield },
  { id: 'lock', label: 'Verrouille', icon: Lock },
  { id: 'eye', label: 'Visible', icon: Eye },
  // Other
  { id: 'tag', label: 'Tag', icon: Tag },
  { id: 'bookmark', label: 'Marque-page', icon: Bookmark },
  { id: 'award', label: 'Recompense', icon: Award },
  { id: 'user', label: 'Utilisateur', icon: User },
  { id: 'users', label: 'Groupe', icon: Users },
  { id: 'box', label: 'Boite', icon: Box },
  { id: 'package', label: 'Colis', icon: Package },
  { id: 'folder', label: 'Dossier', icon: Folder },
  { id: 'file', label: 'Fichier', icon: File },
  { id: 'clock', label: 'Horloge', icon: Clock },
  { id: 'calendar', label: 'Calendrier', icon: Calendar },
  { id: 'bell', label: 'Cloche', icon: Bell },
];

// Category Form Component
const CategoryForm = ({ form, setForm, onSave, onCancel, saveLabel, isLoading }) => (
  <div className="bg-violet-50 rounded-xl p-4 space-y-3 border border-violet-200">
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Nom *</label>
      <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500" placeholder="Nom de la categorie" />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
      <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500" placeholder="Description optionnelle" />
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
      <span className="text-sm text-gray-600">Icone:</span>
      {ICON_PRESETS.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => setForm(f => ({ ...f, icon: id }))}
          className={`p-2 rounded-lg border-2 transition-all ${form.icon === id ? 'border-violet-600 bg-violet-100' : 'border-gray-200 hover:border-violet-300'}`}
          title={label}>
          <Icon size={18} className={form.icon === id ? 'text-violet-600' : 'text-gray-500'} />
        </button>
      ))}
    </div>
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-gray-600">Taille:</span>
      {[24, 32, 40, 48].map(s => (
        <button key={s} onClick={() => setForm(f => ({ ...f, marker_size: s }))}
          className={`px-2 py-1 rounded text-xs ${form.marker_size === s ? 'bg-violet-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
          {s}px
        </button>
      ))}
    </div>
    {/* Assign to Controls checkbox */}
    <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
      <input
        type="checkbox"
        id="assign_to_controls"
        checked={form.assign_to_controls || false}
        onChange={e => setForm(f => ({ ...f, assign_to_controls: e.target.checked }))}
        className="w-5 h-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
      />
      <label htmlFor="assign_to_controls" className="flex-1 cursor-pointer">
        <span className="text-sm font-medium text-amber-800">Assigner a Controls</span>
        <p className="text-xs text-amber-600 mt-0.5">Les equipements de cette categorie seront disponibles dans Switchboard Controls</p>
      </label>
      <Zap size={20} className="text-amber-500" />
    </div>
    <div className="flex gap-2">
      <button onClick={onCancel} className="flex-1 py-2 px-3 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Annuler</button>
      <button onClick={onSave} disabled={isLoading}
        className="flex-1 py-2 px-3 rounded-lg bg-violet-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1 hover:bg-violet-700">
        {isLoading ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} {saveLabel}
      </button>
    </div>
  </div>
);

// Category Manager Modal
const CategoryManagerModal = ({ isOpen, onClose, categories, onCategoriesChange, showToast }) => {
  const [localCategories, setLocalCategories] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', color: '#8B5CF6', icon: 'building', marker_size: 32, assign_to_controls: false });
  const [isLoading, setIsLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: '', description: '', color: '#8B5CF6', icon: 'building', marker_size: 32, assign_to_controls: false });

  useEffect(() => { if (categories) setLocalCategories([...categories]); }, [categories]);
  useEffect(() => { if (!isOpen) { setEditingId(null); setShowNewForm(false); } }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!newCategory.name.trim()) { showToast('Le nom est requis', 'error'); return; }
    setIsLoading(true);
    try {
      await api.infrastructure.createCategory(newCategory);
      showToast('Categorie creee', 'success');
      setNewCategory({ name: '', description: '', color: '#8B5CF6', icon: 'building', marker_size: 32 });
      setShowNewForm(false);
      onCategoriesChange();
    } catch { showToast('Erreur', 'error'); }
    finally { setIsLoading(false); }
  };

  const handleUpdate = async (id) => {
    if (!editForm.name.trim()) { showToast('Le nom est requis', 'error'); return; }
    setIsLoading(true);
    try {
      await api.infrastructure.updateCategory(id, editForm);
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
      await api.infrastructure.deleteCategory(id);
      showToast('Categorie supprimee', 'success');
      onCategoriesChange();
    } catch { showToast('Erreur', 'error'); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-violet-600 to-purple-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl"><Palette size={24} /></div>
              <div>
                <h2 className="text-xl font-bold">Categories</h2>
                <p className="text-violet-200 text-sm">Personnaliser les marqueurs</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {!showNewForm && (
            <button onClick={() => setShowNewForm(true)}
              className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-violet-300 text-violet-600 font-medium hover:bg-violet-50 flex items-center justify-center gap-2">
              <Plus size={18} /> Ajouter une categorie
            </button>
          )}

          {showNewForm && (
            <CategoryForm form={newCategory} setForm={setNewCategory} onSave={handleCreate}
              onCancel={() => { setShowNewForm(false); setNewCategory({ name: '', description: '', color: '#8B5CF6', icon: 'building', marker_size: 32, assign_to_controls: false }); }}
              saveLabel="Creer" isLoading={isLoading} />
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
                    onCancel={() => setEditingId(null)} saveLabel="Sauvegarder" isLoading={isLoading} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-sm" style={{ backgroundColor: cat.color }}>
                        {(() => {
                          const iconData = ICON_PRESETS.find(i => i.id === cat.icon);
                          const IconComp = iconData?.icon || Building2;
                          return <IconComp size={18} className="text-white" />;
                        })()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-gray-900">{cat.name}</h4>
                          {cat.assign_to_controls && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-full flex items-center gap-1">
                              <Zap size={10} /> Controls
                            </span>
                          )}
                        </div>
                        {cat.description && <p className="text-sm text-gray-500">{cat.description}</p>}
                        <span className="text-xs text-gray-400">{cat.item_count || 0} items • {cat.marker_size}px • {ICON_PRESETS.find(i => i.id === cat.icon)?.label || 'Batiment'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingId(cat.id); setEditForm({ name: cat.name, description: cat.description || '', color: cat.color, icon: cat.icon, marker_size: cat.marker_size, assign_to_controls: cat.assign_to_controls || false }); }}
                        className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-violet-600"><Edit3 size={16} /></button>
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

// Detail Panel with photo and files support
const DetailPanel = ({ item, onClose, onEdit, onDelete, onNavigateToMap, isPlaced, categories, onPhotoUpload, onRefresh, onImageClick }) => {
  if (!item) return null;
  const cat = categories?.find(c => c.id === item.category_id);
  const IconComp = ICON_MAP[cat?.icon] || Building2;
  const photoInputRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [files, setFiles] = React.useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);
  const [photoKey, setPhotoKey] = React.useState(Date.now());

  // Load files
  React.useEffect(() => {
    if (item?.id) {
      setIsLoadingFiles(true);
      api.infrastructure.listFiles(item.id)
        .then(res => setFiles(res?.files || []))
        .catch(() => setFiles([]))
        .finally(() => setIsLoadingFiles(false));
    }
  }, [item?.id]);

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.infrastructure.uploadPhoto(item.id, file);
      setPhotoKey(Date.now());
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Photo upload error:", err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.infrastructure.uploadFile(item.id, file);
      const res = await api.infrastructure.listFiles(item.id);
      setFiles(res?.files || []);
    } catch (err) {
      console.error("File upload error:", err);
    }
  };

  const handleDeleteFile = async (fileId) => {
    if (!window.confirm("Supprimer ce fichier ?")) return;
    try {
      await api.infrastructure.deleteFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (err) {
      console.error("File delete error:", err);
    }
  };

  return (
    <div className="bg-white">
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-4 sm:p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg md:hidden"><X size={20} /></button>
          <button onClick={() => onEdit(item)} className="p-2 hover:bg-white/20 rounded-lg"><Edit3 size={18} /></button>
        </div>
        <div className="flex items-start gap-4">
          {/* Photo with icon fallback */}
          <div
            className="w-20 h-20 rounded-xl flex items-center justify-center overflow-hidden cursor-pointer relative group"
            style={{ backgroundColor: cat?.color || '#8B5CF6' }}
            onClick={() => photoInputRef.current?.click()}
          >
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
            {item.photo_path ? (
              <img
                src={api.infrastructure.photoUrl(item.id, { bust: true }) + `&t=${photoKey}`}
                alt=""
                className="w-full h-full object-cover cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onImageClick) onImageClick(api.infrastructure.photoUrl(item.id, { bust: true }), item.name);
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
                title="Cliquez pour agrandir"
              />
            ) : (
              <IconComp size={32} className="text-white" />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera size={20} className="text-white" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{item.name}</h2>
            <p className="text-violet-100 text-sm">{item.building} - {item.floor}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {cat && <Badge variant="default" style={{ backgroundColor: cat.color + '20', color: cat.color }}>{cat.name}</Badge>}
              {isPlaced ? <Badge variant="success"><MapPin size={10} className="inline mr-1" />Localise</Badge>
                : <Badge variant="warning"><MapPin size={10} className="inline mr-1" />Non localise</Badge>}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Mini Electro - AI Assistant */}
        <MiniElectro
          equipment={item}
          equipmentType="infrastructure"
          onAction={(action, params) => {
            if (action === 'docAttached') {
              onRefresh?.();
            }
          }}
        />

        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Building2 size={16} className="text-violet-500" />Informations</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Code</span><p className="font-medium">{item.code || '-'}</p></div>
            <div><span className="text-gray-500">Categorie</span><p className="font-medium">{cat?.name || '-'}</p></div>
            <div className="col-span-2"><span className="text-gray-500">Description</span><p className="font-medium">{item.description || '-'}</p></div>
            <div className="col-span-2"><span className="text-gray-500">Notes</span><p className="font-medium">{item.notes || '-'}</p></div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><MapPin size={16} className="text-violet-500" />Localisation</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Batiment</span><p className="font-medium">{item.building || '-'}</p></div>
            <div><span className="text-gray-500">Etage</span><p className="font-medium">{item.floor || '-'}</p></div>
            <div className="col-span-2"><span className="text-gray-500">Emplacement</span><p className="font-medium">{item.location || '-'}</p></div>
          </div>
        </div>

        {/* Files/Reports section */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText size={16} className="text-violet-500" />Fichiers & Rapports
            </h3>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 bg-violet-100 text-violet-600 rounded-lg hover:bg-violet-200"
            >
              <Plus size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          {isLoadingFiles ? (
            <div className="text-center py-4"><RefreshCw size={20} className="animate-spin mx-auto text-gray-400" /></div>
          ) : files.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-2">Aucun fichier</p>
          ) : (
            <div className="space-y-2">
              {files.map(file => (
                <div key={file.id} className="flex items-center gap-2 p-2 bg-white rounded-lg border">
                  <FileText size={16} className="text-gray-400 flex-shrink-0" />
                  <span className="text-sm truncate flex-1">{file.filename}</span>
                  <a
                    href={api.infrastructure.fileUrl(file.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-gray-100 rounded text-gray-500"
                  >
                    <Download size={14} />
                  </a>
                  <button
                    onClick={() => handleDeleteFile(file.id)}
                    className="p-1 hover:bg-red-50 rounded text-gray-500 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions - Boutons groupés */}
      <div className="p-4 sm:p-6 pt-2 space-y-3">
        <button onClick={() => onNavigateToMap(item)}
          className={`w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 shadow-lg ${isPlaced
            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-emerald-500/25'
            : 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-violet-500/25'}`}>
          <MapPin size={18} />{isPlaced ? 'Voir sur le plan' : 'Localiser sur le plan'}
        </button>
        {canDeleteEquipment(item) && (
          <button onClick={() => onDelete(item)}
            className="w-full py-3 px-4 rounded-xl bg-red-50 text-red-600 font-medium hover:bg-red-100 flex items-center justify-center gap-2">
            <Trash2 size={18} />Supprimer
          </button>
        )}
      </div>
    </div>
  );
};

// Edit Form with Photo & Files upload
const EditForm = ({ item, categories, onSave, onCancel, showToast }) => {
  const isNew = !item?.id;

  // Auto-save draft for new items only
  const draftKey = isNew ? 'infrastructure_new' : null;
  const initialFormData = { name: '', code: '', category_id: '', building: '', floor: '', location: '', description: '', notes: '', fire_interlock: false };

  const {
    formData: draftData,
    setFormData: setDraftData,
    clearDraft,
    hasDraft
  } = useFormDraft(draftKey || 'infrastructure_disabled', initialFormData, { debounceMs: 500 });

  // Use draft for new items, local state for existing items
  const [form, setFormInternal] = useState(initialFormData);
  const [isSaving, setIsSaving] = useState(false);

  // Sync form with draft or item
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

  // Photo & Files state
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [existingFiles, setExistingFiles] = useState([]);
  const [photoKey, setPhotoKey] = useState(Date.now());
  const photoInputRef = React.useRef(null);
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    if (item?.id) {
      // Editing existing item - load its data
      setFormInternal({
        name: item.name || '', code: item.code || '', category_id: item.category_id || '',
        building: item.building || '', floor: item.floor || '', location: item.location || '',
        description: item.description || '', notes: item.notes || '', fire_interlock: item.fire_interlock || false
      });
      api.infrastructure.listFiles(item.id).then(res => setExistingFiles(res?.files || [])).catch(() => {});
    } else if (isNew && hasDraft) {
      // New item - restore from draft if available
      setFormInternal(draftData);
    }
    // Reset pending files when item changes
    setPendingPhoto(null);
    setPendingPhotoPreview(null);
    setPendingFiles([]);
  }, [item, isNew, hasDraft, draftData]);

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingPhoto(file);
    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => setPendingPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setPendingFiles(prev => [...prev, ...files]);
    }
    e.target.value = ''; // Reset input
  };

  const removePendingFile = (index) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('Le nom est requis', 'error'); return; }
    setIsSaving(true);
    try {
      // Save form and get the item id
      const savedItem = await onSave(form, { pendingPhoto, pendingFiles });

      // If we have an item ID (returned from onSave), upload files
      if (savedItem?.id) {
        if (pendingPhoto) {
          try {
            await api.infrastructure.uploadPhoto(savedItem.id, pendingPhoto);
            setPhotoKey(Date.now());
          } catch (err) {
            console.error('Photo upload error:', err);
            showToast('Photo sauvegardee mais upload echoue', 'warning');
          }
        }
        for (const file of pendingFiles) {
          try {
            await api.infrastructure.uploadFile(savedItem.id, file);
          } catch (err) {
            console.error('File upload error:', err);
          }
        }
        // Clear draft after successful save
        if (isNew) clearDraft();
      }
    } catch { showToast('Erreur', 'error'); }
    finally { setIsSaving(false); }
  };

  // Existing photo upload (for existing items only)
  const handleExistingPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !item?.id) return;
    try {
      await api.infrastructure.uploadPhoto(item.id, file);
      setPhotoKey(Date.now());
      showToast('Photo mise a jour', 'success');
    } catch (err) {
      console.error('Photo upload error:', err);
      showToast('Erreur upload photo', 'error');
    }
  };

  return (
    <div className="bg-white">
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-4 sm:p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-xl"><Building2 size={24} /></div>
          <div>
            <h2 className="text-xl font-bold">{isNew ? 'Nouvel element' : 'Modifier'}</h2>
            <p className="text-violet-100 text-sm">Infrastructure</p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Photo Section */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Camera size={16} className="text-violet-500" />Photo</h3>
          <div className="flex items-start gap-4">
            <div
              onClick={() => photoInputRef.current?.click()}
              className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-violet-400 hover:bg-violet-50 transition-all overflow-hidden"
            >
              {pendingPhotoPreview ? (
                <img src={pendingPhotoPreview} alt="Preview" className="w-full h-full object-cover" />
              ) : item?.id && item?.photo_path ? (
                <img src={api.infrastructure.photoUrl(item.id, { bust: true }) + `&t=${photoKey}`} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="text-center text-gray-400">
                  <Camera size={32} className="mx-auto mb-2" />
                  <span className="text-xs">Cliquer pour ajouter</span>
                </div>
              )}
            </div>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
              onChange={isNew ? handlePhotoSelect : handleExistingPhotoChange} />
            <div className="flex-1 text-sm text-gray-500">
              <p className="font-medium text-gray-700 mb-1">Photo principale</p>
              <p>Formats acceptes: JPG, PNG, GIF</p>
              <p>Taille max: 10 MB</p>
              {pendingPhoto && (
                <div className="mt-2 flex items-center gap-2 text-violet-600">
                  <CheckCircle size={14} />
                  <span>{pendingPhoto.name}</span>
                  <button onClick={() => { setPendingPhoto(null); setPendingPhotoPreview(null); }} className="text-red-500 hover:text-red-700">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Documents Section */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><File size={16} className="text-violet-500" />Documents</h3>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50 transition-all"
          >
            <Folder size={24} className="mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600">Cliquer pour ajouter des documents</p>
            <p className="text-xs text-gray-400 mt-1">PDF, Word, Excel, images...</p>
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

          {/* Pending files */}
          {pendingFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Fichiers a ajouter:</p>
              {pendingFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-violet-50 rounded-lg p-2">
                  <File size={16} className="text-violet-500" />
                  <span className="flex-1 text-sm truncate">{file.name}</span>
                  <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
                  <button onClick={() => removePendingFile(idx)} className="text-red-500 hover:text-red-700 p-1">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Existing files (for existing items) */}
          {!isNew && existingFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Fichiers existants:</p>
              {existingFiles.map(file => (
                <div key={file.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                  <File size={16} className="text-gray-500" />
                  <span className="flex-1 text-sm truncate">{file.original_name}</span>
                  <a href={api.infrastructure.fileUrl(file.id)} target="_blank" rel="noopener noreferrer"
                    className="text-violet-500 hover:text-violet-700 p-1">
                    <Download size={14} />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Tag size={16} className="text-violet-500" />Identification</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" placeholder="Nom de l'element" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" placeholder="INF-001" />
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
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><MapPin size={16} className="text-violet-500" />Localisation</h3>
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
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Flame size={16} className="text-orange-500" />Asservissement incendie</h3>
          <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-orange-300 hover:bg-orange-50/50 transition-colors cursor-pointer">
            <input type="checkbox" checked={form.fire_interlock} onChange={e => setForm(f => ({ ...f, fire_interlock: e.target.checked }))}
              className="w-5 h-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            <div>
              <span className="font-medium text-gray-900">Inclure dans le controle incendie</span>
              <p className="text-sm text-gray-500">Cet element apparaitra dans le systeme d'asservissement incendie</p>
            </div>
          </label>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><FileText size={16} className="text-violet-500" />Details</h3>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" rows={2} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl" rows={2} /></div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 sm:p-6 pt-2 flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
        <button onClick={handleSave} disabled={isSaving}
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25">
          {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}Enregistrer
        </button>
      </div>
    </div>
  );
};

// Main Component
export default function Infrastructure() {
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
  const [placedDetails, setPlacedDetails] = useState({});
  const [toast, setToast] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), []);

  // Lightbox for image enlargement
  const { lightbox, openLightbox, closeLightbox } = useLightbox();

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.infrastructure.list({});
      setItems(res?.items || []);
    } catch { showToast('Erreur chargement', 'error'); }
    finally { setIsLoading(false); }
  }, [showToast]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.infrastructure.listCategories();
      setCategories(res?.categories || []);
    } catch {}
  }, []);

  const loadPlacements = useCallback(async () => {
    try {
      const res = await api.infrastructure.maps.placedIds();
      setPlacedIds(new Set((res?.placed_ids || []).map(String)));
      setPlacedDetails(res?.placed_details || {});
    } catch { setPlacedIds(new Set()); setPlacedDetails({}); }
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
      api.infrastructure.get(itemId).then(res => {
        if (res?.item) { setSelectedItem(res.item); setExpandedBuildings(prev => ({ ...prev, [res.item.building || 'Sans batiment']: true })); }
      }).catch(() => showToast('Item non trouve', 'error'));
    }
  }, [searchParams, showToast]);

  const handleSelectItem = async (item) => {
    setSearchParams({ item: item.id });
    setViewMode('detail');
    try { const res = await api.infrastructure.get(item.id); setSelectedItem(res?.item || item); }
    catch { setSelectedItem(item); }
  };

  const handleNewItem = () => { setSelectedItem({}); setViewMode('edit'); setSearchParams({}); };

  const handleSaveItem = async (formData, fileUploads = {}) => {
    const isNew = !selectedItem?.id;
    try {
      const saved = isNew ? await api.infrastructure.create(formData) : await api.infrastructure.update(selectedItem.id, formData);
      const newItem = saved?.item;
      if (isNew) setItems(prev => [...prev, newItem]);
      else setItems(prev => prev.map(i => i.id === newItem.id ? newItem : i));
      setSelectedItem(newItem);
      setViewMode('detail');
      setSearchParams({ item: newItem.id });
      showToast(isNew ? 'Element cree' : 'Element mis a jour', 'success');
      // Return the saved item so EditForm can upload files
      return newItem;
    } catch { throw new Error('Save failed'); }
  };

  const handleDeleteItem = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.infrastructure.remove(deleteTarget.id);
      setItems(prev => prev.filter(i => i.id !== deleteTarget.id));
      if (selectedItem?.id === deleteTarget.id) { setSelectedItem(null); setSearchParams({}); }
      showToast('Element supprime', 'success');
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

  const handleNavigateToMap = (item) => {
    const itemId = item?.id;
    if (!itemId) {
      navigate('/app/infrastructure/map');
      return;
    }

    const details = placedDetails[String(itemId)];
    const planKey = details?.plans?.[0] || details?.logical_name;

    if (planKey) {
      navigate(`/app/infrastructure/map?item=${itemId}&plan=${encodeURIComponent(planKey)}`);
    } else {
      navigate(`/app/infrastructure/map?item=${itemId}`);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Infrastructure</h1>
              <p className="text-xs text-gray-500">Gestion des infrastructures</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Badge variant="default">{stats.total} elements</Badge>
            <Badge variant="success">{stats.placed} localises</Badge>
            <Badge variant="default">{stats.categories} categories</Badge>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowCategoryModal(true)} className="p-2 hover:bg-violet-100 rounded-lg text-violet-600" title="Categories">
              <Palette size={20} />
            </button>
            <button onClick={() => navigate('/app/infrastructure/map')} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 flex items-center gap-2">
              <MapPin size={18} /><span className="hidden sm:inline">Plans</span>
            </button>
            <button onClick={handleNewItem} className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium flex items-center gap-2">
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
                <div className="text-center py-8 text-gray-500"><Building2 size={32} className="mx-auto mb-2 opacity-50" /><p className="text-sm">Aucun element</p></div>
              ) : Object.entries(tree).map(([building, floors]) => (
                <div key={building}>
                  <button onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg">
                    {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <Building2 size={16} className="text-violet-500" />
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
                            const IconComp = ICON_MAP[cat?.icon] || Building2;
                            return (
                              <button key={item.id} onClick={() => handleSelectItem(item)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg ml-2 ${selectedItem?.id === item.id ? 'bg-violet-100 text-violet-700' : 'text-gray-600 hover:bg-gray-100'}`}>
                                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: cat?.color || '#8B5CF6' }}>
                                  <IconComp size={10} className="text-white" />
                                </div>
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
              onNavigateToMap={handleNavigateToMap}
              onImageClick={openLightbox}
              isPlaced={isPlaced(selectedItem?.id)} />
          ) : viewMode === 'edit' ? (
            <EditForm item={selectedItem} categories={categories} onSave={handleSaveItem} showToast={showToast}
              onCancel={() => { if (selectedItem?.id) setViewMode('detail'); else { setSelectedItem(null); setSearchParams({}); } }} />
          ) : (
            /* Tree View - Arborescence principale */
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              {/* Search bar for mobile */}
              {isMobile && (
                <div className="mb-4">
                  <div className="relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Rechercher..." className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white" />
                  </div>
                </div>
              )}

              {/* Stats rapides */}
              <div className="flex flex-wrap gap-2 text-sm mb-4">
                <span className="px-3 py-1.5 bg-violet-100 text-violet-700 rounded-full font-medium">
                  {stats.total} element{stats.total > 1 ? 's' : ''}
                </span>
                <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">
                  {stats.placed} localise{stats.placed > 1 ? 's' : ''}
                </span>
                <span className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                  {Object.keys(tree).length} batiment{Object.keys(tree).length > 1 ? 's' : ''}
                </span>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw size={32} className="animate-spin text-violet-500" />
                </div>
              ) : Object.keys(tree).length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Building2 size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="font-medium">Aucun element</p>
                  <p className="text-sm mt-2">Creez votre premier element d'infrastructure</p>
                  <button onClick={handleNewItem} className="mt-4 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium flex items-center gap-2 mx-auto">
                    <Plus size={18} />Nouvel element
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(tree).map(([building, floors]) => {
                    const buildingItemCount = Object.values(floors).flat().length;
                    return (
                      <details key={building} className="group border rounded-2xl bg-white shadow-sm overflow-hidden">
                        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer bg-gradient-to-r from-violet-50 to-purple-50 hover:from-violet-100 hover:to-purple-100 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-violet-100 rounded-lg">
                              <Building2 size={18} className="text-violet-600" />
                            </div>
                            <span className="font-semibold text-gray-800">{building}</span>
                          </div>
                          <span className="px-2.5 py-1 bg-violet-500 text-white rounded-full text-xs font-medium">
                            {buildingItemCount} element{buildingItemCount > 1 ? 's' : ''}
                          </span>
                        </summary>
                        <div className="p-3 space-y-2 bg-gray-50/50">
                          {Object.entries(floors).map(([floor, floorItems]) => (
                            <details key={floor} className="ml-2 pl-3 border-l-2 border-violet-200">
                              <summary className="cursor-pointer py-2 text-sm text-gray-700 hover:text-violet-700 font-medium transition-colors flex items-center gap-2">
                                <span className="p-1 bg-purple-100 rounded"><Layers size={12} className="text-purple-600" /></span>
                                {floor}
                                <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-xs">
                                  {floorItems.length}
                                </span>
                              </summary>
                              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pb-2">
                                {floorItems.map(item => {
                                  const cat = categories.find(c => c.id === item.category_id);
                                  const IconComp = ICON_MAP[cat?.icon] || Building2;
                                  const placed = isPlaced(item.id);
                                  return (
                                    <div key={item.id} className="bg-white border rounded-xl p-3 shadow-sm hover:shadow-md transition-all">
                                      <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                                          style={{ backgroundColor: cat?.color || '#8B5CF6' }}>
                                          <IconComp size={16} className="text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <button className="text-violet-600 font-semibold hover:underline text-left truncate w-full text-sm"
                                            onClick={() => handleSelectItem(item)}>
                                            {item.name || 'Sans nom'}
                                          </button>
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {cat && <Badge variant="default">{cat.name}</Badge>}
                                            {placed ? (
                                              <Badge variant="success"><MapPin size={10} className="mr-1" />Localise</Badge>
                                            ) : (
                                              <Badge variant="warning"><AlertCircle size={10} className="mr-1" />Non localise</Badge>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex flex-col gap-1 flex-shrink-0">
                                          <button onClick={() => handleSelectItem(item)}
                                            className="p-1.5 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 text-xs" title="Voir">
                                            <Eye size={14} />
                                          </button>
                                          {placed && (
                                            <button onClick={() => handleNavigateToMap(item)}
                                              className="p-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-xs" title="Voir sur plan">
                                              <MapPin size={14} />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
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
