// src/pages/Datahub_map.jsx - Map view for Datahub with category filtering and item creation
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/atex-map.css"; // Styles de netteté pour les plans
import {
  Database, Search, ChevronLeft, ChevronRight, Building2, MapPin, X, RefreshCw,
  Trash2, ArrowLeft, ArrowUp, ArrowDown, Plus, Circle, Square, Triangle, Star, Heart, Target, Menu,
  CheckCircle, AlertCircle, Crosshair, Tag, Filter, Layers, Eye, EyeOff, Zap,
  Power, Battery, Plug, Gauge, Wrench, Factory, Server, Cpu, Wifi, Shield, Flag,
  Home, Building, Box, Clock, Calendar, Bell, Navigation, Compass, Pin, Bookmark,
  Award, User, Users, Folder, File, Info, Lock, Check, Flame, Thermometer,
  HardDrive, Monitor, Cable, Droplet, Wind, Sun, Cloud, Package, Link2, Loader2,
  ExternalLink
} from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const STORAGE_KEY_PLAN = "datahub_map_selected_plan";
const STORAGE_KEY_PAGE = "datahub_map_page_index";

// Marker sizes (same as other map pages)
const ICON_PX = 22;
const ICON_PX_SELECTED = 30;

// SVG paths for marker icons
const SVG_PATHS = {
  circle: '<circle cx="12" cy="12" r="8"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  triangle: '<polygon points="12,3 22,21 2,21"/>',
  star: '<polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/>',
  heart: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  mappin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88"/>',
  navigation: '<polygon points="3,11 22,2 13,21 11,13"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  harddrive: '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  zap: '<polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  battery: '<rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="13" x2="23" y2="11"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 7V2"/><path d="M15 7V2"/><path d="M6 13V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  thermometer: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
  cable: '<path d="M4 9a2 2 0 0 1-2-2V5h6v2a2 2 0 0 1-2 2Z"/><path d="M3 5V3"/><path d="M7 5V3"/><path d="M19 15a2 2 0 0 1 2-2h1v6h-6v-2a2 2 0 0 1 2-2Z"/><path d="M22 19v2"/><path d="M18 19v2"/><path d="M4 9v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alertcircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  tag: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29,7 12,12 20.71,7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  default: '<circle cx="12" cy="12" r="8"/>'
};

// Icon mapping for dynamic icons
const ICON_MAP = {
  circle: Circle, square: Square, triangle: Triangle, star: Star, heart: Heart,
  target: Target, mappin: MapPin, pin: Pin, crosshair: Crosshair, compass: Compass,
  navigation: Navigation, flag: Flag, database: Database, server: Server,
  harddrive: HardDrive, cpu: Cpu, wifi: Wifi, monitor: Monitor, zap: Zap,
  power: Power, battery: Battery, plug: Plug, flame: Flame, thermometer: Thermometer,
  gauge: Gauge, wrench: Wrench, hammer: Wrench, factory: Factory, cable: Cable,
  droplet: Droplet, wind: Wind, sun: Sun, cloud: Cloud, check: Check,
  alertcircle: AlertCircle, info: Info, shield: Shield, lock: Lock, eye: Eye,
  tag: Tag, bookmark: Bookmark, award: Award, user: User, users: Users,
  building: Building, home: Home, box: Box, package: Package, folder: Folder,
  file: File, clock: Clock, calendar: Calendar, bell: Bell
};

// SVG paths for external equipment icons (matching UnifiedEquipmentMap)
const EXTERNAL_SVG_ICONS = {
  // VSD: CPU/chip icon (electronic component)
  vsd: `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>`,
  // HV: outlined lightning polygon
  hv: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>`,
  // MECA: sun/gear with radiating lines
  meca: `<circle cx="12" cy="12" r="3" fill="white"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="white" stroke-width="2" stroke-linecap="round"/>`,
  // GLO: battery icon
  glo: `<rect x="1" y="6" width="18" height="12" rx="2"/><path d="M23 10v4"/><path d="M7 10v4M11 10v4"/>`,
  // Mobile: CPU/chip icon (same as VSD)
  mobile: `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>`,
  // Switchboards: filled lightning bolt
  switchboards: `<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" fill="white"/>`,
};

// External equipment categories with distinctive colors and icons
// Colors and icons matching UnifiedEquipmentMap for consistency
const EXTERNAL_CATEGORIES = {
  vsd: {
    id: 'vsd',
    name: 'Variateurs (VSD)',
    shortName: 'VSD',
    color: '#10b981', // Emerald (same as UnifiedEquipmentMap)
    gradient: 'radial-gradient(circle at 30% 30%, #34d399, #059669)',
    svgPath: EXTERNAL_SVG_ICONS.vsd
  },
  hv: {
    id: 'hv',
    name: 'Haute Tension',
    shortName: 'HT',
    color: '#f59e0b', // Amber (same as UnifiedEquipmentMap HV)
    gradient: 'radial-gradient(circle at 30% 30%, #f59e0b, #ea580c)',
    svgPath: EXTERNAL_SVG_ICONS.hv
  },
  meca: {
    id: 'meca',
    name: 'Electromecanique',
    shortName: 'MECA',
    color: '#3b82f6', // Blue (same as UnifiedEquipmentMap)
    gradient: 'radial-gradient(circle at 30% 30%, #3b82f6, #2563eb)',
    svgPath: EXTERNAL_SVG_ICONS.meca
  },
  glo: {
    id: 'glo',
    name: 'Equipements Globaux',
    shortName: 'GLO',
    color: '#34d399', // Emerald (same as UnifiedEquipmentMap)
    gradient: 'radial-gradient(circle at 30% 30%, #34d399, #059669)',
    svgPath: EXTERNAL_SVG_ICONS.glo
  },
  mobile: {
    id: 'mobile',
    name: 'Equipements Mobiles',
    shortName: 'Mobiles',
    color: '#06b6d4', // Cyan (same as UnifiedEquipmentMap)
    gradient: 'linear-gradient(to bottom right, #22d3ee, #2563eb)',
    svgPath: EXTERNAL_SVG_ICONS.mobile
  },
  switchboards: {
    id: 'switchboards',
    name: 'Tableaux Electriques',
    shortName: 'Tableaux',
    color: '#f59e0b', // Amber (same as UnifiedEquipmentMap)
    gradient: 'radial-gradient(circle at 30% 30%, #facc15, #f59e0b)',
    svgPath: EXTERNAL_SVG_ICONS.switchboards
  }
};

const STORAGE_KEY_EXTERNAL_VISIBLE = "datahub_map_external_visible";

function userHeaders() {
  const email = localStorage.getItem("email") || "";
  const name = localStorage.getItem("name") || "";
  const h = {};
  if (email) h["X-User-Email"] = email;
  if (name) h["X-User-Name"] = name;
  return h;
}

function pdfDocOpts(url) {
  return { url, withCredentials: true, httpHeaders: userHeaders(), standardFontDataUrl: "/standard_fonts/" };
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Toast component
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  const bg = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-indigo-500';
  return (
    <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] ${bg} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-slideUp`}>
      {type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
      <span className="font-medium">{message}</span>
    </div>
  );
};

// Badge component
const Badge = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>{children}</span>;
};

// Create Item Modal with Photo Upload
const CreateItemModal = ({ isOpen, onClose, categories, onCreate, position }) => {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState(null);
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setCategoryId(categories[0]?.id || '');
      setPendingPhoto(null);
      setPendingPhotoPreview(null);
    }
  }, [isOpen, categories]);

  if (!isOpen) return null;

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setPendingPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      await onCreate({ name: name.trim(), category_id: categoryId || null }, position, pendingPhoto);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-5 text-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl"><Plus size={24} /></div>
            <div>
              <h2 className="text-xl font-bold">Nouvel item</h2>
              <p className="text-indigo-100 text-sm">Sera place sur le plan</p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Photo Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Photo (optionnel)</label>
            <div className="flex items-center gap-3">
              <div
                onClick={() => photoInputRef.current?.click()}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all overflow-hidden flex-shrink-0"
              >
                {pendingPhotoPreview ? (
                  <img src={pendingPhotoPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-gray-400">
                    <Database size={20} className="mx-auto" />
                    <span className="text-[10px]">Photo</span>
                  </div>
                )}
              </div>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
              {pendingPhoto && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{pendingPhoto.name}</p>
                  <button onClick={() => { setPendingPhoto(null); setPendingPhotoPreview(null); }}
                    className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mt-1">
                    <X size={12} /> Supprimer
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Nom de l'item"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Categorie</label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {categories.length === 0 ? (
                <div className="col-span-2 text-center py-4 text-gray-500 text-sm">
                  Aucune categorie disponible
                </div>
              ) : categories.map(cat => {
                const IconComp = ICON_MAP[cat.icon] || Circle;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryId(cat.id)}
                    className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                      categoryId === cat.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: cat.color }}
                    >
                      <IconComp size={14} className="text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-900 truncate">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t p-4 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isCreating ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />}
            Creer
          </button>
        </div>
      </div>
    </div>
  );
};

// Category Filter Chips
const CategoryFilterChips = ({ categories, selectedCategories, onToggle, onClearAll }) => {
  if (categories.length === 0) return null;

  const allSelected = selectedCategories.length === 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={onClearAll}
        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
          allSelected
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        <Layers size={12} />
        Toutes
      </button>
      {categories.map(cat => {
        const isSelected = selectedCategories.includes(cat.id);
        const IconComp = ICON_MAP[cat.icon] || Circle;
        return (
          <button
            key={cat.id}
            onClick={() => onToggle(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              isSelected
                ? 'text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={isSelected ? { backgroundColor: cat.color } : {}}
          >
            <IconComp size={12} />
            {cat.name}
          </button>
        );
      })}
    </div>
  );
};

// Detail Panel for selected item with Equipment Links
const DetailPanel = ({ item, category, position, onClose, onDelete, onNavigate, isMobile, links = [], linksLoading = false, onAddLink, onDeleteLink, onLinkClick, currentPlan, currentPageIndex = 0 }) => {
  const [showAddLink, setShowAddLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  if (!item) return null;
  const IconComp = ICON_MAP[category?.icon] || Circle;

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await api.equipmentLinks.search(query, 'datahub', item.id);
      setSearchResults(res?.results || []);
    } catch (e) { console.error('Search error:', e); }
    finally { setSearching(false); }
  };

  const handleAddLinkClick = async (target, direction) => {
    try {
      const linkLabel = direction || 'connected';
      await onAddLink?.({ source_type: 'datahub', source_id: String(item.id), target_type: target.type, target_id: String(target.id), link_label: linkLabel });
      setShowAddLink(false); setSearchQuery(''); setSearchResults([]);
    } catch (e) { console.error('Add link error:', e); }
  };

  const isOnSamePlan = (link) => {
    const eq = link.linkedEquipment;
    return eq?.hasPosition && eq?.plan === currentPlan && (eq?.pageIndex || 0) === currentPageIndex;
  };

  return (
    <div className={`${isMobile ? 'fixed inset-x-2 bottom-20 z-[60]' : 'absolute top-4 right-4 w-80 z-[60]'} bg-white rounded-2xl shadow-2xl border overflow-hidden animate-slideUp pointer-events-auto max-h-[80vh] flex flex-col`}>
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-4 text-white flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2 bg-white/20 rounded-xl flex-shrink-0"><IconComp size={20} /></div>
            <div className="min-w-0">
              <h3 className="font-bold truncate">{item.name}</h3>
              <p className="text-indigo-100 text-sm truncate">{category?.name || 'Sans categorie'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg flex-shrink-0"><X size={18} /></button>
        </div>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Batiment</span>
            <span className="font-semibold text-gray-900 truncate block">{item.building || '-'}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Etage</span>
            <span className="font-semibold text-gray-900 truncate block">{item.floor || '-'}</span>
          </div>
        </div>

        {item.description && (
          <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2">{item.description}</p>
        )}

        {/* Equipment Links Section */}
        <div className="border-t pt-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Link2 size={14} />Équipements liés</span>
            <button onClick={() => setShowAddLink(!showAddLink)} className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-indigo-600" title="Ajouter un lien"><Plus size={16} /></button>
          </div>
          {showAddLink && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 mb-2">
              <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)} placeholder="Rechercher..." className="w-full px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-indigo-500 bg-white" autoFocus />
              {searching && <div className="flex items-center gap-2 text-sm text-gray-500 mt-2"><Loader2 size={14} className="animate-spin" />...</div>}
              {searchResults.length > 0 && (
                <div className="mt-2 max-h-36 overflow-y-auto space-y-1">
                  {searchResults.map((result) => (
                    <div key={`${result.type}-${result.id}`} className="bg-white rounded border p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-medium text-sm truncate">{result.code || result.name}</span>
                        <span className="text-xs text-gray-500">{result.type}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => handleAddLinkClick(result, 'upstream')} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded border border-green-300" title="Amont"><ArrowDown size={12} /><span>Amont</span></button>
                        <button onClick={() => handleAddLinkClick(result, 'downstream')} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded border border-red-300" title="Aval"><ArrowUp size={12} /><span>Aval</span></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {linksLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2"><Loader2 size={14} className="animate-spin" />...</div>
          ) : links.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">Aucun lien</p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {links.map((link, idx) => {
                const eq = link.linkedEquipment; const samePlan = isOnSamePlan(link);
                return (
                  <div key={link.id || idx} className={`flex items-center justify-between p-1.5 rounded-lg text-sm ${samePlan ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
                    <button onClick={() => onLinkClick?.(link)} className="flex items-center gap-2 flex-1 text-left hover:underline truncate">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                      <span className="font-medium truncate">{eq?.code || eq?.name}</span>
                    </button>
                    {link.type === 'manual' && link.id && <button onClick={() => onDeleteLink?.(link.id)} className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600 flex-shrink-0"><Trash2 size={12} /></button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => onNavigate(item)} className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-100 text-indigo-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-indigo-200">
            <Eye size={16} />Voir details
          </button>
          {position && (
            <button onClick={() => onDelete(position.id)} className="py-2.5 px-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium flex items-center justify-center gap-2 hover:bg-red-100"><Trash2 size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
};

export default function DatahubMap() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const targetItemIdRef = useRef(null);

  // Core data
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [positions, setPositions] = useState([]);
  const [placedIds, setPlacedIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({}); // item_id -> { plans: [...] }

  // UI state
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [toast, setToast] = useState(null);
  const [pdfReady, setPdfReady] = useState(false);

  // Control statuses for datahub items { item_id: { status: 'overdue'|'upcoming' } }
  const [controlStatuses, setControlStatuses] = useState({});

  // Equipment links
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);

  // External equipment categories (VSD, HV, MECA, GLO, Mobile, Switchboards)
  // Store plan key WITH positions to ensure synchronization (prevents stale data issues)
  const [externalPositions, setExternalPositions] = useState({
    planKey: null,
    positions: { vsd: [], hv: [], meca: [], glo: [], mobile: [], switchboards: [] }
  });
  const [externalTotals, setExternalTotals] = useState({ vsd: 0, hv: 0, meca: 0, glo: 0, mobile: 0, switchboards: 0 });
  const [visibleExternalCategories, setVisibleExternalCategories] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_EXTERNAL_VISIBLE);
      return saved ? JSON.parse(saved) : ['vsd', 'hv', 'meca', 'glo', 'mobile', 'switchboards'];
    } catch { return ['vsd', 'hv', 'meca', 'glo', 'mobile', 'switchboards']; }
  });

  // Creation mode
  const [createMode, setCreateMode] = useState(false);
  const [placementMode, setPlacementMode] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingPosition, setPendingPosition] = useState(null);

  // Refs
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const markersRef = useRef([]);
  const markersMapRef = useRef(new Map()); // Map of item_id -> marker for efficient updates
  const pdfDocRef = useRef(null);
  const createModeRef = useRef(false);
  const placementModeRef = useRef(null);
  const canvasDimRef = useRef({ w: 0, h: 0 });
  const selectedItemIdRef = useRef(null); // Track selected item for marker drawing
  const positionsRef = useRef([]); // Keep positions for redrawing
  const imgSizeRef = useRef({ w: 0, h: 0 }); // Store image size for redrawing
  const currentPlanKeyRef = useRef(null); // Track current plan being loaded (for stale response detection)
  const drawMarkersRef = useRef(null); // Ref to always get latest drawMarkers (avoids stale closures)
  const controlStatusesRef = useRef({}); // Keep control statuses ref for marker drawing
  const connectionsLayerRef = useRef(null); // Layer for connection polylines

  // Keep refs in sync
  useEffect(() => { createModeRef.current = createMode; }, [createMode]);
  useEffect(() => { placementModeRef.current = placementMode; }, [placementMode]);
  useEffect(() => { controlStatusesRef.current = controlStatuses; }, [controlStatuses]);

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), []);

  // Load control statuses for datahub items
  const loadControlStatuses = useCallback(async () => {
    try {
      const dashboardRes = await api.switchboardControls.dashboard();
      const statuses = {};

      // Process overdue items
      (dashboardRes?.overdue_list || []).forEach(item => {
        if (item.datahub_equipment_id) {
          statuses[item.datahub_equipment_id] = { status: 'overdue', template_name: item.template_name };
        }
      });

      // Process upcoming items (only if not already marked as overdue)
      (dashboardRes?.upcoming || []).forEach(item => {
        if (item.datahub_equipment_id && !statuses[item.datahub_equipment_id]) {
          statuses[item.datahub_equipment_id] = { status: 'upcoming', template_name: item.template_name };
        }
      });

      setControlStatuses(statuses);
    } catch (err) {
      console.error("Error loading datahub control statuses:", err);
    }
  }, []);

  // Load equipment links for selected item
  const loadEquipmentLinks = useCallback(async (itemId) => {
    if (!itemId) {
      setLinks([]);
      return;
    }
    setLinksLoading(true);
    try {
      const res = await api.equipmentLinks.getLinks('datahub', itemId);
      setLinks(res?.links || []);
    } catch (err) {
      console.error('Error loading equipment links:', err);
      setLinks([]);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  // Handle adding a link
  const handleAddLink = useCallback(async (linkData) => {
    try {
      await api.equipmentLinks.createLink(linkData);
      if (selectedPosition?.item?.id) {
        loadEquipmentLinks(selectedPosition.item.id);
      }
    } catch (err) {
      console.error('Error creating link:', err);
    }
  }, [selectedPosition, loadEquipmentLinks]);

  // Handle deleting a link
  const handleDeleteLink = useCallback(async (linkId) => {
    try {
      await api.equipmentLinks.deleteLink(linkId);
      if (selectedPosition?.item?.id) {
        loadEquipmentLinks(selectedPosition.item.id);
      }
    } catch (err) {
      console.error('Error deleting link:', err);
    }
  }, [selectedPosition, loadEquipmentLinks]);

  // Handle clicking on a link to navigate to the linked equipment
  const handleLinkClick = useCallback((link) => {
    const eq = link.linkedEquipment;
    if (!eq) return;

    // Check if it's on the same plan
    if (eq.plan_key && eq.page_index !== undefined) {
      const samePlan = selectedPlan?.logical_name === eq.plan_key && pageIndex === eq.page_index;

      if (samePlan && eq.x_coord !== undefined && eq.y_coord !== undefined) {
        // Navigate to the marker on the same plan
        const marker = markersRef.current.find(m => {
          if (eq.equipment_type === 'datahub') {
            return m.meta?.item?.id === eq.equipment_id;
          }
          return m.meta?.equipment_id === eq.equipment_id || m.meta?.switchboard_id === eq.equipment_id;
        });
        if (marker) {
          // Highlight the marker temporarily
          const originalStrokeWidth = marker.graphic.style.strokeWidth;
          marker.graphic.style.strokeWidth = '4px';
          setTimeout(() => {
            marker.graphic.style.strokeWidth = originalStrokeWidth;
          }, 2000);
        }
      } else if (eq.plan_key) {
        // Navigate to different plan
        const targetPlan = plans.find(p => p.logical_name === eq.plan_key);
        if (targetPlan) {
          setSelectedPlan(targetPlan);
          setPageIndex(eq.page_index || 0);
        }
      }
    } else {
      // Navigate to the equipment's detail page
      const typeRoutes = {
        'hv': '/high-voltage',
        'switchboard': '/switchboards',
        'vsd': '/vsds',
        'meca': '/meca-equipment',
        'glo': '/glo-equipment',
        'mobile': '/mobile-equipments',
        'datahub': '/datahub'
      };
      const route = typeRoutes[eq.equipment_type];
      if (route) {
        window.open(`${route}/${eq.equipment_id}`, '_blank');
      }
    }
  }, [selectedPlan, pageIndex, plans]);

  // Responsive
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setShowSidebar(false);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      const [plansRes, itemsRes, catsRes, placedRes] = await Promise.all([
        api.datahub.maps.listPlans(),
        api.datahub.list({}),
        api.datahub.listCategories(),
        api.datahub.maps.placedIds()
      ]);
      setPlans(plansRes?.plans || []);
      setItems(itemsRes?.items || []);
      setCategories(catsRes?.categories || []);
      setPlacedIds(new Set((placedRes?.placed_ids || []).map(String)));
      setPlacedDetails(placedRes?.placed_details || {});

      // Load control statuses for markers
      loadControlStatuses();
    } catch (e) {
      console.error("Load error:", e);
    }
  }, [loadControlStatuses]);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle URL params for navigation from list page
  useEffect(() => {
    const urlPlanKey = searchParams.get("plan");
    const focusItemId = searchParams.get("item");
    console.log('[DATAHUB_MAP] URL params useEffect:', { focusItemId, urlPlanKey, plansCount: plans.length });

    if (urlPlanKey && plans.length > 0) {
      const targetPlan = plans.find(p => p.logical_name === urlPlanKey);
      console.log('[DATAHUB_MAP] Found target plan:', targetPlan?.logical_name);

      if (targetPlan) {
        if (focusItemId) {
          targetItemIdRef.current = focusItemId;
          console.log('[DATAHUB_MAP] Set targetItemIdRef to:', focusItemId);
        }

        if (!selectedPlan || selectedPlan.logical_name !== targetPlan.logical_name) {
          // Different plan - PDF will reload and set pdfReady when done
          console.log('[DATAHUB_MAP] Switching to target plan');
          setPdfReady(false);
          setSelectedPlan(targetPlan);
          setPageIndex(0);
        } else {
          // Same plan - just need to trigger highlight
          console.log('[DATAHUB_MAP] Already on target plan, triggering highlight');
          setPdfReady(false);
          setTimeout(() => setPdfReady(true), 100);
        }
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, plans, selectedPlan, setSearchParams]);

  // Initial plan selection from localStorage
  useEffect(() => {
    if (plans.length > 0 && !selectedPlan) {
      const urlPlanKey = searchParams.get("plan");
      if (urlPlanKey) return; // URL params effect will handle this

      let planToSelect = null;
      const saved = localStorage.getItem(STORAGE_KEY_PLAN);
      planToSelect = plans.find(p => p.logical_name === saved || p.id === saved);

      setSelectedPlan(planToSelect || plans[0]);
      const savedPage = parseInt(localStorage.getItem(STORAGE_KEY_PAGE) || "0", 10);
      setPageIndex(savedPage);
    }
  }, [plans, selectedPlan, searchParams]);

  // Save selected plan
  useEffect(() => {
    if (selectedPlan) {
      localStorage.setItem(STORAGE_KEY_PLAN, selectedPlan.logical_name || selectedPlan.id);
      localStorage.setItem(STORAGE_KEY_PAGE, String(pageIndex));
    }
  }, [selectedPlan, pageIndex]);

  // Load PDF
  const loadPdf = useCallback(async () => {
    if (!selectedPlan || !mapContainerRef.current) return;
    setIsLoading(true);
    try {
      const url = api.datahub.maps.planFileUrlAuto(selectedPlan);
      const doc = await pdfjsLib.getDocument(pdfDocOpts(url)).promise;
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
      const page = await doc.getPage(clamp(pageIndex + 1, 1, doc.numPages));
      const scale = window.devicePixelRatio >= 2 ? 2 : 1.5;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const dataUrl = canvas.toDataURL("image/png");
      canvasDimRef.current = { w: vp.width, h: vp.height };
      initMap(dataUrl, vp.width, vp.height);
    } catch (e) {
      console.error("PDF load error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedPlan, pageIndex]);

  // Load positions
  const loadPositions = useCallback(async () => {
    if (!selectedPlan) return;
    try {
      const res = await api.datahub.maps.positionsAuto(selectedPlan.logical_name || selectedPlan.id, pageIndex);
      setPositions(res?.positions || []);
    } catch { setPositions([]); }
  }, [selectedPlan, pageIndex]);

  // Load external equipment positions (VSD, HV, MECA, GLO, Mobile, Switchboards)
  // Uses individual equipment APIs like UnifiedEquipmentMap for reliability
  const loadExternalPositions = useCallback(async () => {
    if (!selectedPlan) return;
    const planKey = selectedPlan.logical_name || selectedPlan.id;
    const requestKey = `${planKey}:${pageIndex}`;

    // Track which plan/page we're loading for
    currentPlanKeyRef.current = requestKey;
    console.log('[Datahub] Loading external positions for:', requestKey);

    // Define equipment type loaders (same pattern as UnifiedEquipmentMap)
    const loaders = [
      { type: 'vsd', apiCall: () => api.vsdMaps?.positionsAuto?.(planKey, pageIndex) },
      { type: 'hv', apiCall: () => api.hvMaps?.positionsAuto?.(planKey, pageIndex) },
      { type: 'meca', apiCall: () => api.mecaMaps?.positionsAuto?.(planKey, pageIndex) },
      { type: 'glo', apiCall: () => api.gloMaps?.positionsAuto?.(planKey, pageIndex) },
      { type: 'mobile', apiCall: () => api.mobileEquipment?.maps?.positionsAuto?.(planKey, pageIndex) },
      { type: 'switchboards', apiCall: () => api.switchboardMaps?.positionsAuto?.(planKey, pageIndex) },
    ];

    try {
      // Load all positions in parallel
      const results = await Promise.allSettled(loaders.map(async ({ type, apiCall }) => {
        try {
          const res = await apiCall();
          return { type, positions: res?.positions || [] };
        } catch (e) {
          console.log(`[Datahub] ${type} positions not available:`, e.message);
          return { type, positions: [] };
        }
      }));

      // Check if plan changed while we were loading
      if (currentPlanKeyRef.current !== requestKey) {
        console.log('[Datahub] Ignoring stale external positions for:', requestKey, '(current:', currentPlanKeyRef.current, ')');
        return;
      }

      // Build positions object by type
      const newPositions = { vsd: [], hv: [], meca: [], glo: [], mobile: [], switchboards: [] };
      const newTotals = { vsd: 0, hv: 0, meca: 0, glo: 0, mobile: 0, switchboards: 0 };

      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          const { type, positions } = result.value;
          // Map positions to include equipment info for tooltips
          newPositions[type] = positions.map(p => ({
            id: p.id,
            equipment_id: type === 'switchboards' ? p.switchboard_id : p.equipment_id,
            x_frac: parseFloat(p.x_frac),
            y_frac: parseFloat(p.y_frac),
            name: p.name || p.tag || p.code || type.toUpperCase(),
            building: p.building || p.building_code,
            floor: p.floor,
            details: p.manufacturer ? `${p.manufacturer} ${p.model || ''}`.trim() : (p.equipment_type || '')
          }));
          newTotals[type] = newPositions[type].length;
        }
      });

      console.log('[Datahub] External positions loaded for', requestKey, ':', newTotals);
      // Store planKey WITH positions in state for atomic synchronization
      setExternalPositions({ planKey: requestKey, positions: newPositions });
      setExternalTotals(newTotals);

    } catch (e) {
      if (currentPlanKeyRef.current === requestKey) {
        console.log('[Datahub] External positions error:', e.message);
        setExternalPositions({
          planKey: requestKey,
          positions: { vsd: [], hv: [], meca: [], glo: [], mobile: [], switchboards: [] }
        });
        setExternalTotals({ vsd: 0, hv: 0, meca: 0, glo: 0, mobile: 0, switchboards: 0 });
      }
    }
  }, [selectedPlan, pageIndex]);

  // Save visible external categories to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_EXTERNAL_VISIBLE, JSON.stringify(visibleExternalCategories));
  }, [visibleExternalCategories]);

  // Toggle external category visibility
  const toggleExternalCategory = useCallback((catId) => {
    setVisibleExternalCategories(prev => {
      if (prev.includes(catId)) {
        return prev.filter(id => id !== catId);
      } else {
        return [...prev, catId];
      }
    });
  }, []);

  useEffect(() => {
    if (selectedPlan) {
      // Update current plan key ref FIRST before any loading
      const newPlanKey = `${selectedPlan.logical_name || selectedPlan.id}:${pageIndex}`;
      currentPlanKeyRef.current = newPlanKey;

      console.log('[Datahub] Plan changed to:', newPlanKey);

      loadPdf();
      loadPositions();
      loadExternalPositions();
    }
  }, [selectedPlan, pageIndex, loadPdf, loadPositions, loadExternalPositions]);

  // Initialize map
  const initMap = (imageUrl, w, h) => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    markersRef.current = [];
    markersMapRef.current.clear();

    // Store image size for marker drawing
    imgSizeRef.current = { w, h };

    const bounds = [[0, 0], [h, w]];
    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, zoomControl: false,
      attributionControl: false, maxBounds: bounds, maxBoundsViscosity: 1
    });
    L.control.zoom({ position: "topright" }).addTo(map);
    const overlay = L.imageOverlay(imageUrl, bounds).addTo(map);
    map.fitBounds(bounds);
    mapRef.current = map;
    overlayRef.current = overlay;
    connectionsLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", handleMapClick);

    // Draw initial markers after map is initialized
    // Use ref to get latest version of drawMarkers (avoids stale closure)
    // External markers will be redrawn when their positions load via useEffect
    if (drawMarkersRef.current) {
      drawMarkersRef.current();
    }

    // Mark PDF as ready after map initialization
    setPdfReady(true);
  };

  // Create marker icon (like Switchboard's makeSwitchboardIcon)
  const makeMarkerIcon = useCallback((item, cat, isSelected) => {
    const size = isSelected ? ICON_PX_SELECTED : ICON_PX;
    const iconId = cat?.icon || 'circle';
    const svgPath = SVG_PATHS[iconId] || SVG_PATHS.default;

    // Check control status for this item
    const controlStatus = item?.id ? controlStatusesRef.current[item.id] : null;
    const isOverdue = controlStatus?.status === 'overdue';
    const isUpcoming = controlStatus?.status === 'upcoming';

    // Determine colors based on control status (overdue takes priority)
    let bgGradient;
    if (isSelected) {
      bgGradient = "radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed)"; // Purple - selected
    } else if (isOverdue) {
      bgGradient = "radial-gradient(circle at 30% 30%, #ef4444, #dc2626)"; // Red - overdue
    } else if (isUpcoming) {
      bgGradient = "radial-gradient(circle at 30% 30%, #f59e0b, #d97706)"; // Amber - upcoming
    } else {
      const color = cat?.color || "#6366F1";
      bgGradient = `radial-gradient(circle at 30% 30%, ${color}cc, ${color})`; // Category color - default
    }

    // Animation class goes on the INNER div (like Switchboard)
    let animClass = "";
    if (isSelected) animClass = "datahub-marker-selected";
    else if (isOverdue) animClass = "datahub-marker-overdue";

    const html = `
      <div class="${animClass}" style="width:${size}px;height:${size}px;background:${bgGradient};border:2px solid white;border-radius:50%;
        box-shadow:0 4px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;">
        <svg viewBox="0 0 24 24" width="${size * 0.5}" height="${size * 0.5}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${svgPath}
        </svg>
      </div>`;

    return L.divIcon({
      className: "datahub-marker-inline", // Neutral wrapper (like sb-marker-inline)
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }, []);

  // Create marker icon for external equipment (VSD, HV, MECA, etc.)
  // Same size and style as UnifiedEquipmentMap for consistency
  const makeExternalMarkerIcon = useCallback((extCategory) => {
    const size = ICON_PX; // Same size as Datahub markers (22px)
    const bgGradient = extCategory.gradient || `radial-gradient(circle at 30% 30%, ${extCategory.color}cc, ${extCategory.color})`;
    const svgPath = extCategory.svgPath || SVG_PATHS.default;
    // Switchboards use 0.55 size like UnifiedEquipmentMap, others use 0.5
    const iconSize = extCategory.id === 'switchboards' ? size * 0.55 : size * 0.5;

    const html = `
      <div style="width:${size}px;height:${size}px;background:${bgGradient};border:2px solid white;border-radius:9999px;
        box-shadow:0 4px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${svgPath}
        </svg>
      </div>`;

    return L.divIcon({
      className: "datahub-marker-external",
      html,
      iconSize: [size, size],
      iconAnchor: [Math.round(size / 2), Math.round(size / 2)]
    });
  }, []);

  // Draw markers function (like Switchboard's drawMarkers)
  const drawMarkers = useCallback(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;

    const { w, h } = imgSizeRef.current;
    if (w === 0 || h === 0) return;

    // Clear existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    markersMapRef.current.clear();

    const bounds = overlay.getBounds();
    const boundsH = bounds.getNorth();
    const boundsW = bounds.getEast();

    positionsRef.current.forEach(pos => {
      const item = items.find(i => i.id === pos.item_id);
      if (!item) return;

      // Filter by selected categories
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category_id)) return;

      const cat = categories.find(c => c.id === item.category_id);
      const isSelected = pos.item_id === selectedItemIdRef.current;
      const icon = makeMarkerIcon(item, cat, isSelected);

      const lat = boundsH * (1 - pos.y_frac);
      const lng = boundsW * pos.x_frac;
      const marker = L.marker([lat, lng], { icon, draggable: true, riseOnHover: true }).addTo(map);
      marker.__meta = { id: pos.id, item_id: pos.item_id, lat, lng };

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedItem(item);
        setSelectedPosition(pos);
        setPlacementMode(null);
        setCreateMode(false);
        // Load equipment links
        loadEquipmentLinks(item.id);
        // Animate to marker position
        map.setView([lat, lng], map.getZoom(), { animate: true });
      });

      marker.on("dragend", async () => {
        const ll = marker.getLatLng();
        const newX = clamp(ll.lng / boundsW, 0, 1);
        const newY = clamp(1 - ll.lat / boundsH, 0, 1);
        try {
          await api.datahub.maps.setPosition(pos.item_id, {
            logical_name: selectedPlan.logical_name || selectedPlan.id,
            page_index: pageIndex, x_frac: newX, y_frac: newY
          });
          await loadPositions();
        } catch (e) {
          console.error("Move error:", e);
          await loadPositions();
        }
      });

      marker.bindTooltip(`<strong>${item.name}</strong><br/>${cat?.name || 'Sans categorie'}`, {
        direction: "top", offset: [0, -ICON_PX / 2], className: "datahub-tooltip"
      });

      markersRef.current.push(marker);
      // Store with String key for consistent lookup (URL params are always strings)
      markersMapRef.current.set(String(pos.item_id), marker);
    });

    // Draw external equipment markers (VSD, HV, MECA, GLO, Mobile, Switchboards)
    // CRITICAL: Check planKey stored WITH positions in state (not ref) for atomic synchronization
    const currentKey = `${selectedPlan?.logical_name || selectedPlan?.id}:${pageIndex}`;
    const positionsMatchPlan = externalPositions.planKey === currentKey;

    console.log('[Datahub] Drawing external markers check:', {
      currentPlan: currentKey,
      positionsPlanKey: externalPositions.planKey,
      match: positionsMatchPlan,
      visibleCategories: visibleExternalCategories
    });

    if (!positionsMatchPlan) {
      console.log('[Datahub] Skipping external markers - positions are for different plan (state.planKey:', externalPositions.planKey, ')');
    } else {
      Object.entries(EXTERNAL_CATEGORIES).forEach(([catKey, extCat]) => {
        // Skip if this external category is not visible
        if (!visibleExternalCategories.includes(catKey)) return;

        const positions = externalPositions.positions[catKey] || [];
        if (positions.length > 0) {
          console.log(`[Datahub] Drawing ${positions.length} ${catKey} markers for plan ${currentKey}`);
        }
        const icon = makeExternalMarkerIcon(extCat);

        positions.forEach(pos => {
          // External equipment uses direct y_frac (not inverted like Datahub items)
          // Switchboard/VSD/etc save: y_frac = lat / h (direct)
          // Datahub saves: y_frac = 1 - lat / h (inverted)
          const lat = boundsH * pos.y_frac;
          const lng = boundsW * pos.x_frac;
          const marker = L.marker([lat, lng], { icon, draggable: false, riseOnHover: true }).addTo(map);
          marker.__meta = { id: pos.id, equipment_id: pos.equipment_id, type: catKey, lat, lng };

          // External markers are read-only (no drag, no click selection)
          // But we show tooltip with equipment info
          const tooltipContent = `
            <div style="text-align:center;">
              <strong style="color:${extCat.color}">${extCat.name}</strong><br/>
              <span>${pos.name || 'Equipement'}</span>
              ${pos.details ? `<br/><small style="color:#888">${pos.details}</small>` : ''}
            </div>
          `;
          marker.bindTooltip(tooltipContent, {
            direction: "top", offset: [0, -ICON_PX / 2], className: "datahub-tooltip"
          });

          markersRef.current.push(marker);
        });
      });
    }
  }, [items, categories, selectedCategories, selectedPlan, pageIndex, loadPositions, makeMarkerIcon, externalPositions, visibleExternalCategories, makeExternalMarkerIcon]);

  // Keep drawMarkersRef in sync with latest drawMarkers (synchronous update during render)
  drawMarkersRef.current = drawMarkers;

  // Draw connection lines between selected item and its linked equipment
  const drawConnections = useCallback(() => {
    const map = mapRef.current;
    const g = connectionsLayerRef.current;
    if (!map || !g) return;

    g.clearLayers();
    if (!selectedItemIdRef.current || !links.length) return;

    const selectedMarker = markersMapRef.current.get(selectedItemIdRef.current)
      || markersMapRef.current.get(String(selectedItemIdRef.current))
      || markersMapRef.current.get(Number(selectedItemIdRef.current));
    if (!selectedMarker) return;

    const sourceLatLng = selectedMarker.getLatLng();
    const currentPlanKey = selectedPlan?.logical_name || selectedPlan?.id;

    links.forEach((link) => {
      const eq = link.linkedEquipment;
      if (!eq?.hasPosition) return;
      const eqPlan = eq.plan_key || eq.plan;
      const eqPage = eq.page_index ?? eq.pageIndex ?? 0;
      if (eqPlan !== currentPlanKey || eqPage !== pageIndex) return;

      const targetId = eq.equipment_id || eq.id;
      let targetMarker = markersMapRef.current.get(targetId)
        || markersMapRef.current.get(String(targetId))
        || markersMapRef.current.get(Number(targetId));
      if (!targetMarker) return;

      const targetLatLng = targetMarker.getLatLng();
      let color = '#3b82f6', flowDirection = null;
      const linkLabel = link.link_label || link.relationship;

      if (linkLabel === 'upstream') { color = '#10b981'; flowDirection = 'toSource'; }
      else if (linkLabel === 'downstream') { color = '#ef4444'; flowDirection = 'toTarget'; }
      else if (linkLabel === 'feeds') { color = '#10b981'; flowDirection = 'toTarget'; }
      else if (linkLabel === 'fed_by') { color = '#ef4444'; flowDirection = 'toSource'; }
      else if (linkLabel === 'powers') { color = '#f59e0b'; flowDirection = 'toTarget'; }
      else if (linkLabel === 'powered_by') { color = '#f59e0b'; flowDirection = 'toSource'; }

      const animClass = flowDirection === 'toTarget' ? 'equipment-link-line flow-to-target'
        : flowDirection === 'toSource' ? 'equipment-link-line flow-to-source' : 'equipment-link-line';

      const polyline = L.polyline([sourceLatLng, targetLatLng], {
        color, weight: 3, opacity: 0.8, dashArray: '10, 5', className: animClass
      });
      polyline.addTo(g);

      if (flowDirection) {
        const arrowEnd = flowDirection === 'toTarget' ? targetLatLng : sourceLatLng;
        const arrowStart = flowDirection === 'toTarget' ? sourceLatLng : targetLatLng;
        const dx = arrowEnd.lng - arrowStart.lng, dy = arrowEnd.lat - arrowStart.lat;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const arrowIcon = L.divIcon({
          className: 'arrow-marker',
          html: `<div style="transform: rotate(${angle - 90}deg); color: ${color}; font-size: 18px; font-weight: bold; text-shadow: 0 0 3px white;">▲</div>`,
          iconSize: [20, 20], iconAnchor: [10, 10]
        });
        L.marker(arrowEnd, { icon: arrowIcon, interactive: false }).addTo(g);
      }
    });
  }, [links, selectedPlan, pageIndex]);

  // Redraw connections when links or selection changes
  useEffect(() => { drawConnections(); }, [links, selectedItem, drawConnections]);

  // Highlight marker with flash animation (for navigation)
  const highlightMarker = useCallback((itemId) => {
    // Try to find marker with the ID as-is first, then try with type conversion
    let mk = markersMapRef.current.get(itemId);
    if (!mk) mk = markersMapRef.current.get(String(itemId));
    if (!mk) mk = markersMapRef.current.get(Number(itemId));
    if (!mk || !mapRef.current) return;

    // Center on marker
    const ll = mk.getLatLng();
    mapRef.current.setView(ll, mapRef.current.getZoom(), { animate: true });

    // Flash animation
    const el = mk.getElement();
    if (el) {
      el.classList.add("datahub-marker-flash");
      setTimeout(() => el.classList.remove("datahub-marker-flash"), 2000);
    }
  }, []);

  // Adjust view to fit the entire plan (like Meca, Mobile Equipment, etc.)
  const adjust = useCallback(() => {
    const m = mapRef.current;
    const layer = overlayRef.current;
    if (!m || !layer) return;
    const b = layer.getBounds();
    try { m.scrollWheelZoom?.disable(); } catch {}
    m.invalidateSize(false);
    const fitZoom = m.getBoundsZoom(b, true);
    m.setMinZoom(fitZoom - 1);
    m.fitBounds(b, { padding: [8, 8] });
    setTimeout(() => { try { m.scrollWheelZoom?.enable(); } catch {} }, 50);
  }, []);

  // Smart navigation: navigate to the correct plan and highlight the item marker
  // Similar to GLO's handleEquipmentClick
  const handleViewOnMap = useCallback(
    async (item) => {
      // Clear any existing selection - user must click marker to see details
      setSelectedItem(null);
      setSelectedPosition(null);
      setPlacementMode(null);
      setCreateMode(false);

      // Check if this item is placed somewhere (keys are strings)
      const details = placedDetails[String(item.id)];

      // Handle both formats: { plans: [...] } or { logical_name: "...", page_index: 0 }
      const targetPlanKey = details?.plans?.[0] || details?.logical_name;

      if (targetPlanKey) {
        // Find the plan
        const targetPlan = plans.find(p => p.logical_name === targetPlanKey);
        if (targetPlan) {
          // If we're not on that plan, switch to it
          if (selectedPlan?.logical_name !== targetPlanKey) {
            // Store the target item ID for highlighting after plan loads
            targetItemIdRef.current = String(item.id);
            setSelectedPlan(targetPlan);
            setPageIndex(0);
            setPdfReady(false);
          } else {
            // Same plan - just highlight after a small delay to ensure map is ready
            setTimeout(() => highlightMarker(String(item.id)), 100);
          }
        }
      } else {
        // Item is on current plan, just highlight it
        const pos = positions.find(p => String(p.item_id) === String(item.id));
        if (pos) {
          highlightMarker(String(item.id));
        }
      }

      // On mobile, close sidebar so user can see the map
      if (isMobile) setShowSidebar(false);
    },
    [plans, selectedPlan, placedDetails, positions, highlightMarker, isMobile]
  );

  // Handle map click
  const handleMapClick = async (e) => {
    const bounds = overlayRef.current?.getBounds();
    if (!bounds) return;
    const h = bounds.getNorth();
    const w = bounds.getEast();
    const x_frac = clamp(e.latlng.lng / w, 0, 1);
    const y_frac = clamp(1 - e.latlng.lat / h, 0, 1);

    // Create mode - show modal to create new item
    if (createModeRef.current) {
      setPendingPosition({ x_frac, y_frac });
      setShowCreateModal(true);
      setCreateMode(false);
      return;
    }

    // Placement mode - place existing item
    if (placementModeRef.current) {
      try {
        await api.datahub.maps.setPosition(placementModeRef.current.id, {
          logical_name: selectedPlan.logical_name || selectedPlan.id,
          page_index: pageIndex, x_frac, y_frac
        });
        setPlacedIds(prev => new Set([...prev, String(placementModeRef.current.id)]));
        showToast(`"${placementModeRef.current.name}" place sur le plan`);
        await loadPositions();
        setPlacementMode(null);
      } catch (e) {
        console.error("Set position error:", e);
        showToast("Erreur de placement", "error");
      }
    }
  };

  // Create item and place it
  const handleCreateItem = async (formData, position, pendingPhoto = null) => {
    try {
      const res = await api.datahub.create(formData);
      const newItem = res?.item;
      if (!newItem?.id) throw new Error("Creation failed");

      // Upload photo if provided
      if (pendingPhoto) {
        try {
          await api.datahub.uploadPhoto(newItem.id, pendingPhoto);
        } catch (photoErr) {
          console.error("Photo upload error:", photoErr);
          // Continue even if photo upload fails
        }
      }

      // Place the item on the map
      await api.datahub.maps.setPosition(newItem.id, {
        logical_name: selectedPlan.logical_name || selectedPlan.id,
        page_index: pageIndex,
        x_frac: position.x_frac,
        y_frac: position.y_frac
      });

      // Reload data
      await loadData();
      await loadPositions();
      showToast(`"${newItem.name}" cree et place`);
    } catch (e) {
      console.error("Create error:", e);
      showToast("Erreur de creation", "error");
      throw e;
    }
  };

  // Delete position
  const handleDeletePosition = async (posId) => {
    try {
      await api.datahub.maps.deletePosition(posId);
      await loadPositions();
      const pos = positions.find(p => p.id === posId);
      if (pos) {
        setPlacedIds(prev => { const n = new Set(prev); n.delete(String(pos.item_id)); return n; });
      }
      setSelectedItem(null);
      setSelectedPosition(null);
      showToast("Position supprimee");
    } catch {
      showToast("Erreur de suppression", "error");
    }
  };

  // Keep positions ref in sync and redraw markers when positions change
  // Uses drawMarkersRef to always call the latest version (avoids stale closures)
  useEffect(() => {
    positionsRef.current = positions;
    if (mapRef.current && imgSizeRef.current.w > 0 && drawMarkersRef.current) {
      drawMarkersRef.current();
      // Mark PDF as ready after markers are drawn
      setPdfReady(true);
    }
  }, [positions, items, categories, selectedCategories, externalPositions, visibleExternalCategories, controlStatuses]);

  // Redraw markers when selectedItem changes (like Switchboard line 574-580)
  useEffect(() => {
    selectedItemIdRef.current = selectedItem?.id || null;
    // Redraw markers to update selection state
    if (mapRef.current && imgSizeRef.current.w > 0 && drawMarkersRef.current) {
      drawMarkersRef.current();
    }
  }, [selectedItem]);

  // Focus on item from URL - triggered when pdfReady becomes true
  useEffect(() => {
    console.log('[DATAHUB_MAP] pdfReady useEffect:', { pdfReady, targetId: targetItemIdRef.current });
    if (!pdfReady || !targetItemIdRef.current) return;
    const targetId = targetItemIdRef.current;
    targetItemIdRef.current = null;
    console.log('[DATAHUB_MAP] Triggering highlight for:', targetId);
    // Small delay to ensure markers are rendered in DOM
    setTimeout(() => {
      console.log('[DATAHUB_MAP] Calling highlightMarker now');
      highlightMarker(targetId);
    }, 300);
  }, [pdfReady, highlightMarker]);

  // Smart navigation: navigate to the correct plan and highlight the item marker
  // Clicking on card navigates + animates (like Meca_map pattern)
  const handleItemClick = useCallback(async (item) => {
    console.log('[DATAHUB_MAP] handleItemClick called', { itemId: item.id, itemName: item.name });
    console.log('[DATAHUB_MAP] placedDetails keys:', Object.keys(placedDetails));
    console.log('[DATAHUB_MAP] Looking for key:', String(item.id));

    // Clear any existing selection
    setSelectedItem(null);
    setSelectedPosition(null);

    // Check if this item is placed somewhere
    const details = placedDetails[String(item.id)];
    console.log('[DATAHUB_MAP] Found details:', details);

    // Handle both formats: { plans: [...] } or { logical_name: "...", page_index: 0 }
    const targetPlanKey = details?.plans?.[0] || details?.logical_name;

    if (targetPlanKey) {
      console.log('[DATAHUB_MAP] Target plan key:', targetPlanKey);

      // Find the plan
      const targetPlan = plans.find(p => p.logical_name === targetPlanKey);
      console.log('[DATAHUB_MAP] Target plan found:', targetPlan?.logical_name);

      if (targetPlan) {
        // If we're not on that plan, switch to it
        if (selectedPlan?.logical_name !== targetPlanKey) {
          console.log('[DATAHUB_MAP] Switching to different plan');
          setSelectedPlan(targetPlan);
          setPageIndex(0);
          setPdfReady(false);

          // Store target ID for highlight after PDF loads
          targetItemIdRef.current = String(item.id);
        } else {
          // Same plan - just highlight
          console.log('[DATAHUB_MAP] Same plan, highlighting marker:', String(item.id));
          highlightMarker(String(item.id));
        }
      }
    } else {
      // Not in placedDetails but might be on current plan
      console.log('[DATAHUB_MAP] Not in placedDetails, checking current plan positions');
      const pos = positions.find(p => String(p.item_id) === String(item.id));
      if (pos) {
        console.log('[DATAHUB_MAP] Found on current plan, highlighting');
        highlightMarker(String(item.id));
      } else {
        console.log('[DATAHUB_MAP] Item not placed anywhere');
      }
    }

    // On mobile, close sidebar so user can see the map
    if (isMobile) setShowSidebar(false);
  }, [plans, selectedPlan, placedDetails, positions, highlightMarker, isMobile]);

  // Filter items
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = items.filter(i => !q || i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q));

    // Category filter
    if (selectedCategories.length > 0) {
      list = list.filter(i => selectedCategories.includes(i.category_id));
    }

    // Placement filter
    if (filterMode === "placed") {
      list = list.filter(i => placedIds.has(String(i.id)));
    } else if (filterMode === "unplaced") {
      list = list.filter(i => !placedIds.has(String(i.id)));
    }

    return list;
  }, [items, searchQuery, filterMode, placedIds, selectedCategories]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    placed: items.filter(i => placedIds.has(String(i.id))).length,
    unplaced: items.filter(i => !placedIds.has(String(i.id))).length,
  }), [items, placedIds]);

  // IDs of items placed on the current plan (for "placed elsewhere" badge)
  const currentPlacedHere = useMemo(() => new Set(positions.map(p => String(p.item_id))), [positions]);

  // Category toggle
  const toggleCategory = (catId) => {
    setSelectedCategories(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-selected {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.7); }
          50% { transform: scale(1.15); box-shadow: 0 0 0 10px rgba(99, 102, 241, 0); }
        }
        @keyframes blink-overdue {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes flash-marker {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          20% { transform: scale(1.5); filter: brightness(1.4); }
          40% { transform: scale(1.2); filter: brightness(1.2); }
          60% { transform: scale(1.4); filter: brightness(1.3); }
          80% { transform: scale(1.1); filter: brightness(1.1); }
        }
        .animate-slideUp { animation: slideUp 0.3s ease-out forwards; }
        /* Neutral wrapper like sb-marker-inline */
        .datahub-marker-inline { background: transparent !important; border: none !important; }
        /* Animation class on inner div (like Switchboard) */
        .datahub-marker-selected { animation: pulse-selected 1.5s ease-in-out infinite; z-index: 2000 !important; }
        .datahub-marker-overdue { animation: blink-overdue 1s ease-in-out infinite; }
        .datahub-marker-flash > div { animation: flash-marker 2s ease-in-out; }
        @keyframes flash-marker {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          25% { transform: scale(1.3); filter: brightness(1.3); }
          50% { transform: scale(1); filter: brightness(1); }
          75% { transform: scale(1.3); filter: brightness(1.3); }
        }
        .datahub-tooltip { font-size: 12px; padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.15); z-index: 3000 !important; }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
        .leaflet-pane { z-index: 400; }
        .leaflet-marker-pane { z-index: 600 !important; }
        .leaflet-popup-pane { z-index: 700 !important; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20 flex-shrink-0">
        <div className="px-3 md:px-4 py-2 md:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button onClick={() => navigate("/app/datahub")} className="p-2 hover:bg-gray-100 rounded-lg flex-shrink-0">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                <Database size={18} />
              </div>
              <div className="min-w-0 hidden sm:block">
                <h1 className="text-base md:text-lg font-bold text-gray-900 truncate">Datahub - Plans</h1>
                <p className="text-xs text-gray-500 truncate">{selectedPlan?.display_name || selectedPlan?.logical_name || "Aucun plan"}</p>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2">
            <Badge variant="default">{stats.total} items</Badge>
            <Badge variant="success">{stats.placed} places</Badge>
            <Badge variant="warning">{stats.unplaced} non places</Badge>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            {!isMobile && (
              <button
                onClick={() => setShowSidebar(v => !v)}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
              >
                {showSidebar ? <EyeOff size={16} /> : <Eye size={16} />}
                <span className="hidden md:inline">{showSidebar ? "Masquer" : "Afficher"}</span>
              </button>
            )}
            <button
              onClick={() => setShowSidebar(v => !v)}
              className="p-2 hover:bg-gray-100 rounded-lg md:hidden relative"
            >
              <Menu size={20} />
              {stats.unplaced > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[10px] rounded-full flex items-center justify-center">
                  {stats.unplaced}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Plan selector */}
        <div className="px-3 md:px-4 pb-2 md:pb-3 flex items-center gap-2 flex-wrap">
          <select
            value={selectedPlan?.logical_name || ""}
            onChange={e => {
              const p = plans.find(p => p.logical_name === e.target.value);
              if (p) { setSelectedPlan(p); setPageIndex(0); }
            }}
            className="flex-1 min-w-[120px] max-w-xs px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
          >
            {plans.length === 0 && <option value="">Aucun plan</option>}
            {plans.map(p => <option key={p.logical_name || p.id} value={p.logical_name}>{p.display_name || p.logical_name}</option>)}
          </select>

          {numPages > 1 && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl px-2 py-1">
              <button onClick={() => setPageIndex(i => Math.max(0, i - 1))} disabled={pageIndex === 0} className="p-1 disabled:opacity-30">
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm px-2 tabular-nums">{pageIndex + 1}/{numPages}</span>
              <button onClick={() => setPageIndex(i => Math.min(numPages - 1, i + 1))} disabled={pageIndex >= numPages - 1} className="p-1 disabled:opacity-30">
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>

        {/* External equipment categories toggle - show all equipment types on map */}
        <div className="px-3 md:px-4 pb-2 md:pb-3 flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Equipements:</span>
          {Object.entries(EXTERNAL_CATEGORIES).map(([catKey, extCat]) => {
            const isActive = visibleExternalCategories.includes(catKey);
            const count = externalTotals[catKey] || 0;
            const IconComp = ICON_MAP[extCat.icon] || Circle;
            return (
              <button
                key={catKey}
                onClick={() => toggleExternalCategory(catKey)}
                title={`${extCat.name} (${count})`}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'text-white shadow-sm'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                }`}
                style={isActive ? { backgroundColor: extCat.color } : {}}
              >
                <IconComp size={12} />
                <span className="hidden sm:inline">{extCat.shortName}</span>
                {count > 0 && <span className="ml-0.5 tabular-nums">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        {showSidebar && (
          <>
            {isMobile && <div className="absolute inset-0 bg-black/50 z-20" onClick={() => setShowSidebar(false)} />}

            <div className={`${isMobile ? 'absolute inset-y-0 right-0 z-30 w-[85vw] max-w-[340px]' : 'w-80 lg:w-96'} bg-white border-l shadow-lg flex flex-col`}>
              {/* Sidebar header */}
              <div className="p-3 border-b space-y-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">Items ({filteredItems.length})</span>
                  {isMobile && (
                    <button onClick={() => setShowSidebar(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                      <X size={18} />
                    </button>
                  )}
                </div>

                {/* Search */}
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Rechercher..."
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm"
                  />
                </div>

                {/* Filter tabs */}
                <div className="flex gap-1">
                  {[
                    { key: 'all', label: 'Tous', count: stats.total },
                    { key: 'unplaced', label: 'Non places', count: stats.unplaced, variant: 'warning' },
                    { key: 'placed', label: 'Places', count: stats.placed, variant: 'success' },
                  ].map(f => (
                    <button
                      key={f.key}
                      onClick={() => setFilterMode(f.key)}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                        filterMode === f.key
                          ? f.variant === 'warning' ? 'bg-amber-500 text-white'
                            : f.variant === 'success' ? 'bg-emerald-500 text-white'
                            : 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Category filters */}
                {categories.length > 0 && (
                  <div className="pt-1">
                    <CategoryFilterChips
                      categories={categories}
                      selectedCategories={selectedCategories}
                      onToggle={toggleCategory}
                      onClearAll={() => setSelectedCategories([])}
                    />
                  </div>
                )}
              </div>

              {/* Items list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filteredItems.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Database size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Aucun item</p>
                    <p className="text-sm text-gray-400 mt-1">Modifiez vos filtres</p>
                  </div>
                ) : filteredItems.map(item => {
                  const cat = categories.find(c => c.id === item.category_id);
                  const placed = placedIds.has(String(item.id));
                  const isPlacedHere = currentPlacedHere.has(String(item.id));
                  const isPlacedElsewhere = placed && !isPlacedHere;
                  const isSelected = String(selectedItem?.id) === String(item.id);
                  const isPlacing = String(placementMode?.id) === String(item.id);
                  const IconComp = ICON_MAP[cat?.icon] || Circle;

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleItemClick(item)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                        isSelected ? 'bg-indigo-50 border-indigo-300 shadow-sm' :
                        isPlacing ? 'bg-green-50 border-green-300' :
                        'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                          style={{ backgroundColor: cat?.color || '#6366F1' }}
                        >
                          <IconComp size={16} className="text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-gray-900 truncate text-sm">{item.name}</p>
                            {isPlacedElsewhere && <Badge variant="purple">Placé ailleurs</Badge>}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{cat?.name || 'Sans categorie'}</p>
                          <p className="text-xs text-gray-400 truncate">{item.building || '-'} • {item.floor || '-'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {isPlacedHere ? (
                            <span className="flex items-center gap-1 text-emerald-600 text-xs">
                              <CheckCircle size={14} />
                              Placé
                            </span>
                          ) : placed ? (
                            <span className="flex items-center gap-1 text-purple-600 text-xs">
                              <CheckCircle size={14} />
                              Ailleurs
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600 text-xs">
                              <AlertCircle size={14} />
                              Non placé
                            </span>
                          )}

                          <button
                            onClick={(e) => { e.stopPropagation(); setPlacementMode(item); }}
                            className="px-2 py-1 bg-indigo-500 text-white text-xs rounded-lg flex items-center gap-1 hover:bg-indigo-600 transition-colors"
                            title={placed ? "Déplacer sur ce plan" : "Placer sur ce plan"}
                          >
                            <Target size={12} />
                            {placed ? "Déplacer" : "Placer"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Map area */}
        <div className="flex-1 relative">
          {!selectedPlan || plans.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <MapPin size={48} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">Aucun plan disponible</h3>
                <p className="text-sm text-gray-400 max-w-xs mx-auto">Importez des plans PDF depuis la page VSD</p>
              </div>
            </div>
          ) : (
            <>
              <div ref={mapContainerRef} className="absolute inset-0 z-10" />

              {/* Loading overlay */}
              {isLoading && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw size={32} className="animate-spin text-indigo-500" />
                    <span className="text-sm text-gray-600">Chargement...</span>
                  </div>
                </div>
              )}

              {/* Create button */}
              <button
                onClick={() => {
                  setCreateMode(true);
                  setPlacementMode(null);
                  setSelectedItem(null);
                }}
                disabled={createMode || isLoading}
                className="absolute top-3 left-3 z-10 w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg flex items-center justify-center hover:from-green-400 hover:to-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Creer un nouvel item"
              >
                <Plus size={24} />
              </button>

              {/* Adjust button - fit plan to view */}
              <button
                onClick={adjust}
                disabled={isLoading}
                className="absolute top-3 left-[68px] z-10 h-12 px-4 rounded-xl bg-white text-gray-700 shadow-lg flex items-center justify-center gap-2 hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200"
                title="Ajuster la vue au plan"
              >
                <Compass size={18} />
                <span className="text-sm font-medium">Ajuster</span>
              </button>

              {/* Create mode indicator */}
              {createMode && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[90vw]">
                  <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-slideUp">
                    <div className="p-2 bg-white/20 rounded-lg flex-shrink-0">
                      <Crosshair size={20} className="animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">Mode creation actif</p>
                      <p className="text-green-100 text-sm truncate">Cliquez sur le plan pour creer un nouvel item</p>
                    </div>
                    <button onClick={() => setCreateMode(false)} className="p-2 hover:bg-white/20 rounded-lg flex-shrink-0">
                      <X size={18} />
                    </button>
                  </div>
                </div>
              )}

              {/* Placement mode indicator */}
              {placementMode && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[90vw]">
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-slideUp">
                    <div className="p-2 bg-white/20 rounded-lg flex-shrink-0">
                      <Target size={20} className="animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">Mode placement</p>
                      <p className="text-indigo-100 text-sm truncate">Cliquez pour placer "{placementMode.name}"</p>
                    </div>
                    <button onClick={() => setPlacementMode(null)} className="p-2 hover:bg-white/20 rounded-lg flex-shrink-0">
                      <X size={18} />
                    </button>
                  </div>
                </div>
              )}

              {/* Selected item detail panel */}
              {selectedItem && !createMode && !placementMode && (
                <DetailPanel
                  item={selectedItem}
                  category={categories.find(c => c.id === selectedItem.category_id)}
                  position={selectedPosition}
                  onClose={() => {
                    setSelectedItem(null);
                    setSelectedPosition(null);
                  }}
                  onDelete={handleDeletePosition}
                  onNavigate={(item) => navigate(`/app/datahub?item=${item.id}`)}
                  isMobile={isMobile}
                  links={links}
                  linksLoading={linksLoading}
                  onAddLink={handleAddLink}
                  onDeleteLink={handleDeleteLink}
                  onLinkClick={handleLinkClick}
                  currentPlan={selectedPlan}
                  currentPageIndex={pageIndex}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile FAB */}
      {isMobile && !showSidebar && selectedPlan && (
        <button
          onClick={() => setShowSidebar(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-full shadow-lg flex items-center justify-center z-20"
        >
          <Database size={24} />
          {stats.unplaced > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
              {stats.unplaced}
            </span>
          )}
        </button>
      )}

      {/* Create item modal */}
      <CreateItemModal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setPendingPosition(null); }}
        categories={categories}
        onCreate={handleCreateItem}
        position={pendingPosition}
      />

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
