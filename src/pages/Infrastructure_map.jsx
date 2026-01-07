// src/pages/Infrastructure_map.jsx - Map view for Infrastructure with category filtering
// Based on Datahub_map.jsx - adapted for Infrastructure module
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/atex-map.css";
import {
  Building2, Search, ChevronLeft, ChevronRight, MapPin, X, RefreshCw,
  Trash2, ArrowLeft, Plus, Circle, Square, Triangle, Star, Heart, Target, Menu,
  CheckCircle, AlertCircle, Crosshair, Tag, Filter, Layers, Eye, EyeOff, Zap,
  Power, Battery, Plug, Gauge, Wrench, Factory, Server, Cpu, Wifi, Shield, Flag,
  Home, Building, Box, Clock, Calendar, Bell, Navigation, Compass, Pin, Bookmark,
  Award, User, Users, Folder, File, Info, Lock, Check, Flame, Thermometer,
  HardDrive, Monitor, Cable, Droplet, Wind, Sun, Cloud, Package, Link2, Loader2, ExternalLink
} from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const STORAGE_KEY_PLAN = "infrastructure_map_selected_plan";
const STORAGE_KEY_PAGE = "infrastructure_map_page_index";

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
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>',
  default: '<circle cx="12" cy="12" r="8"/>'
};

// Icon mapping for dynamic icons
const ICON_MAP = {
  circle: Circle, square: Square, triangle: Triangle, star: Star, heart: Heart,
  target: Target, mappin: MapPin, pin: Pin, crosshair: Crosshair, compass: Compass,
  navigation: Navigation, flag: Flag, database: Server, server: Server,
  harddrive: HardDrive, cpu: Cpu, wifi: Wifi, monitor: Monitor, zap: Zap,
  power: Power, battery: Battery, plug: Plug, flame: Flame, thermometer: Thermometer,
  gauge: Gauge, wrench: Wrench, factory: Factory, cable: Cable,
  droplet: Droplet, wind: Wind, sun: Sun, cloud: Cloud, check: Check,
  alertcircle: AlertCircle, info: Info, shield: Shield, lock: Lock, eye: Eye,
  tag: Tag, bookmark: Bookmark, award: Award, user: User, users: Users,
  building: Building2, home: Home, box: Box, package: Package, folder: Folder,
  file: File, clock: Clock, calendar: Calendar, bell: Bell
};

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
  const bg = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-violet-500';
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

// Create Item Modal
const CreateItemModal = ({ isOpen, onClose, categories, onCreate, position }) => {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setCategoryId(categories[0]?.id || '');
    }
  }, [isOpen, categories]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      await onCreate({ name: name.trim(), category_id: categoryId || null }, position);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-5 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl"><Plus size={24} /></div>
            <div>
              <h2 className="text-xl font-bold">Nouvel element</h2>
              <p className="text-violet-100 text-sm">Sera place sur le plan</p>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-violet-500" placeholder="Nom de l'element" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Categorie</label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {categories.length === 0 ? (
                <div className="col-span-2 text-center py-4 text-gray-500 text-sm">Aucune categorie</div>
              ) : categories.map(cat => {
                const IconComp = ICON_MAP[cat.icon] || Circle;
                return (
                  <button key={cat.id} onClick={() => setCategoryId(cat.id)}
                    className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${categoryId === cat.id ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: cat.color }}>
                      <IconComp size={14} className="text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-900 truncate">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="border-t p-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Annuler</button>
          <button onClick={handleCreate} disabled={!name.trim() || isCreating}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {isCreating ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />}Creer
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
      <button onClick={onClearAll}
        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${allSelected ? 'bg-violet-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
        <Layers size={12} />Toutes
      </button>
      {categories.map(cat => {
        const isSelected = selectedCategories.includes(cat.id);
        const IconComp = ICON_MAP[cat.icon] || Circle;
        return (
          <button key={cat.id} onClick={() => onToggle(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${isSelected ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            style={isSelected ? { backgroundColor: cat.color } : {}}>
            <IconComp size={12} />{cat.name}
          </button>
        );
      })}
    </div>
  );
};

// Detail Panel for selected item
const DetailPanel = ({ item, category, position, onClose, onDelete, onNavigate, isMobile, currentPlan }) => {
  if (!item) return null;
  const IconComp = ICON_MAP[category?.icon] || Circle;

  return (
    <div className={`${isMobile ? 'fixed inset-x-2 bottom-20 z-[60]' : 'absolute top-4 right-4 w-72 z-[60]'} bg-white rounded-xl shadow-xl border overflow-hidden animate-slideUp pointer-events-auto flex flex-col`}>
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 px-3 py-2 text-white flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <IconComp size={16} />
            <span className="font-medium text-sm truncate">{item.name}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0"><X size={16} /></button>
        </div>
      </div>
      <div className="p-2">
        <button onClick={() => onNavigate(item)} className="w-full py-2 px-3 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5">
          <ExternalLink size={14} />Voir détails
        </button>
      </div>
    </div>
  );
};

export default function InfrastructureMap() {
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
  const [placedDetails, setPlacedDetails] = useState({});

  // UI state
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showSidebar, setShowSidebar] = useState(true);
  const [toast, setToast] = useState(null);
  const [pdfReady, setPdfReady] = useState(false);

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
  const pdfDocRef = useRef(null);
  const createModeRef = useRef(false);
  const placementModeRef = useRef(null);
  const canvasDimRef = useRef({ w: 0, h: 0 });
  const selectedItemIdRef = useRef(null);
  const positionsRef = useRef([]);
  const imgSizeRef = useRef({ w: 0, h: 0 });
  const currentPlanKeyRef = useRef(null);

  useEffect(() => { createModeRef.current = createMode; }, [createMode]);
  useEffect(() => { placementModeRef.current = placementMode; }, [placementMode]);

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), []);

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
        api.infrastructure.maps.listPlans(),
        api.infrastructure.list({}),
        api.infrastructure.listCategories(),
        api.infrastructure.maps.placedIds()
      ]);
      setPlans(plansRes?.plans || []);
      setItems(itemsRes?.items || []);
      setCategories(catsRes?.categories || []);
      setPlacedIds(new Set((placedRes?.placed_ids || []).map(String)));
      setPlacedDetails(placedRes?.placed_details || {});
    } catch (e) {
      console.error("Load error:", e);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle URL params for navigation
  useEffect(() => {
    const urlPlanKey = searchParams.get("plan");
    const focusItemId = searchParams.get("item");

    if (urlPlanKey && plans.length > 0) {
      const targetPlan = plans.find(p => p.logical_name === urlPlanKey);
      if (targetPlan) {
        if (focusItemId) targetItemIdRef.current = focusItemId;
        if (!selectedPlan || selectedPlan.logical_name !== targetPlan.logical_name) {
          setPdfReady(false);
          setSelectedPlan(targetPlan);
          setPageIndex(0);
        } else {
          setPdfReady(false);
          setTimeout(() => setPdfReady(true), 100);
        }
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, plans, selectedPlan, setSearchParams]);

  // Initial plan selection
  useEffect(() => {
    if (plans.length > 0 && !selectedPlan) {
      const urlPlanKey = searchParams.get("plan");
      if (urlPlanKey) return;
      const saved = localStorage.getItem(STORAGE_KEY_PLAN);
      const planToSelect = plans.find(p => p.logical_name === saved || p.id === saved) || plans[0];
      setSelectedPlan(planToSelect);
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
      const url = api.infrastructure.maps.planFileUrlAuto(selectedPlan);
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
      const res = await api.infrastructure.maps.positionsAuto(selectedPlan.logical_name || selectedPlan.id, pageIndex);
      setPositions(res?.positions || []);
    } catch { setPositions([]); }
  }, [selectedPlan, pageIndex]);

  useEffect(() => {
    if (selectedPlan) {
      const newPlanKey = `${selectedPlan.logical_name || selectedPlan.id}:${pageIndex}`;
      currentPlanKeyRef.current = newPlanKey;
      loadPdf();
      loadPositions();
    }
  }, [selectedPlan, pageIndex, loadPdf, loadPositions]);

  // Initialize map
  const initMap = (imageUrl, w, h) => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    markersRef.current = [];
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

    map.on("click", handleMapClick);
    drawMarkers();
    setPdfReady(true);
  };

  // Create marker icon
  const makeMarkerIcon = useCallback((item, cat, isSelected) => {
    const size = isSelected ? ICON_PX_SELECTED : ICON_PX;
    const iconId = cat?.icon || 'building';
    const svgPath = SVG_PATHS[iconId] || SVG_PATHS.default;
    const color = cat?.color || "#8B5CF6";
    const bgGradient = isSelected
      ? "radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed)"
      : `radial-gradient(circle at 30% 30%, ${color}cc, ${color})`;

    const html = `
      <div style="width:${size}px;height:${size}px;background:${bgGradient};border:2px solid white;border-radius:50%;
        box-shadow:0 4px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;">
        <svg viewBox="0 0 24 24" width="${size * 0.5}" height="${size * 0.5}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${svgPath}
        </svg>
      </div>`;

    return L.divIcon({
      className: "infrastructure-marker-inline",
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }, []);

  // Draw markers
  const drawMarkers = useCallback(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;

    const { w, h } = imgSizeRef.current;
    if (w === 0 || h === 0) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const bounds = overlay.getBounds();
    const boundsH = bounds.getNorth();
    const boundsW = bounds.getEast();

    // Draw infrastructure items
    positionsRef.current.forEach(pos => {
      const item = items.find(i => i.id === pos.item_id);
      if (!item) return;
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category_id)) return;

      const cat = categories.find(c => c.id === item.category_id);
      const isSelected = pos.item_id === selectedItemIdRef.current;
      const icon = makeMarkerIcon(item, cat, isSelected);

      const lat = boundsH * (1 - pos.y_frac);
      const lng = boundsW * pos.x_frac;
      const marker = L.marker([lat, lng], { icon, draggable: true, riseOnHover: true }).addTo(map);
      marker.__meta = { id: pos.id, item_id: pos.item_id };

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedItem(item);
        setSelectedPosition(pos);
        setPlacementMode(null);
        setCreateMode(false);
        map.setView([lat, lng], map.getZoom(), { animate: true });
      });

      marker.on("dragend", async () => {
        const ll = marker.getLatLng();
        const newX = clamp(ll.lng / boundsW, 0, 1);
        const newY = clamp(1 - ll.lat / boundsH, 0, 1);
        try {
          await api.infrastructure.maps.setPosition(pos.item_id, {
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
        direction: "top", offset: [0, -ICON_PX / 2], className: "infrastructure-tooltip"
      });

      markersRef.current.push(marker);
    });
  }, [items, categories, selectedCategories, selectedPlan, pageIndex, loadPositions, makeMarkerIcon]);

  // Update positions ref and redraw
  useEffect(() => {
    positionsRef.current = positions;
    if (mapRef.current) drawMarkers();
  }, [positions, drawMarkers]);

  // Handle item selection
  useEffect(() => {
    selectedItemIdRef.current = selectedItem?.id || null;
    if (mapRef.current && positions.length > 0) drawMarkers();
  }, [selectedItem, positions, drawMarkers]);

  // Handle map click for placement
  const handleMapClick = useCallback(async (e) => {
    if (!createModeRef.current && !placementModeRef.current) return;
    if (!mapRef.current || !overlayRef.current) return;

    const bounds = overlayRef.current.getBounds();
    const boundsH = bounds.getNorth();
    const boundsW = bounds.getEast();
    const x_frac = clamp(e.latlng.lng / boundsW, 0, 1);
    const y_frac = clamp(1 - e.latlng.lat / boundsH, 0, 1);

    if (createModeRef.current) {
      setPendingPosition({ x_frac, y_frac });
      setShowCreateModal(true);
      setCreateMode(false);
    } else if (placementModeRef.current) {
      try {
        await api.infrastructure.maps.setPosition(placementModeRef.current, {
          logical_name: selectedPlan.logical_name || selectedPlan.id,
          page_index: pageIndex, x_frac, y_frac
        });
        showToast("Element place sur le plan", "success");
        setPlacementMode(null);
        await loadPositions();
        await loadData();
      } catch (e) {
        console.error("Placement error:", e);
        showToast("Erreur de placement", "error");
      }
    }
  }, [selectedPlan, pageIndex, loadPositions, loadData, showToast]);

  // Create item from modal
  const handleCreateItem = async (itemData, position) => {
    try {
      const res = await api.infrastructure.create(itemData);
      const newItem = res?.item;
      if (newItem && position) {
        await api.infrastructure.maps.setPosition(newItem.id, {
          logical_name: selectedPlan.logical_name || selectedPlan.id,
          page_index: pageIndex,
          x_frac: position.x_frac,
          y_frac: position.y_frac
        });
      }
      showToast("Element cree et place", "success");
      await loadPositions();
      await loadData();
    } catch (e) {
      console.error("Create error:", e);
      showToast("Erreur de creation", "error");
    }
  };

  // Delete position
  const handleDeletePosition = async (positionId) => {
    if (!window.confirm("Retirer cet element du plan ?")) return;
    try {
      await api.infrastructure.maps.deletePosition(positionId);
      showToast("Element retire du plan", "success");
      setSelectedItem(null);
      setSelectedPosition(null);
      await loadPositions();
      await loadData();
    } catch (e) {
      console.error("Delete error:", e);
      showToast("Erreur de suppression", "error");
    }
  };

  // Filter items for sidebar
  const filteredItems = useMemo(() => {
    let filtered = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(i => i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q));
    }
    if (selectedCategories.length > 0) {
      filtered = filtered.filter(i => selectedCategories.includes(i.category_id));
    }
    return filtered;
  }, [items, searchQuery, selectedCategories]);

  const toggleCategory = (catId) => {
    setSelectedCategories(prev => prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b shadow-sm z-30 flex-shrink-0">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/app/infrastructure')} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
              <ArrowLeft size={20} />
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
              <Building2 size={20} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold text-gray-900">Infrastructure - Plans</h1>
              <p className="text-xs text-gray-500">{selectedPlan?.display_name || selectedPlan?.logical_name || 'Selection du plan'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isMobile && (
              <button onClick={() => setShowSidebar(!showSidebar)}
                className="p-2 hover:bg-gray-100 rounded-lg text-gray-600" title="Toggle sidebar">
                <Menu size={20} />
              </button>
            )}
            <button onClick={() => { setCreateMode(true); showToast("Cliquez sur le plan pour creer", "info"); }}
              className={`px-3 py-2 rounded-xl font-medium flex items-center gap-2 ${createMode ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}>
              <Plus size={18} /><span className="hidden sm:inline">Creer</span>
            </button>
          </div>
        </div>

        {/* Plan selector */}
        <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto">
          <select value={selectedPlan?.id || ''} onChange={e => {
            const plan = plans.find(p => p.id === e.target.value);
            if (plan) { setSelectedPlan(plan); setPageIndex(0); }
          }} className="px-3 py-2 border border-gray-300 rounded-xl bg-white text-sm font-medium min-w-[200px]">
            {plans.map(p => <option key={p.id} value={p.id}>{p.display_name || p.logical_name}</option>)}
          </select>
          {numPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPageIndex(p => Math.max(0, p - 1))} disabled={pageIndex === 0}
                className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"><ChevronLeft size={18} /></button>
              <span className="text-sm font-medium px-2">{pageIndex + 1}/{numPages}</span>
              <button onClick={() => setPageIndex(p => Math.min(numPages - 1, p + 1))} disabled={pageIndex >= numPages - 1}
                className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"><ChevronRight size={18} /></button>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        {showSidebar && !isMobile && (
          <div className="w-80 border-r bg-white flex flex-col z-20">
            <div className="p-4 border-b space-y-3">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm" />
              </div>
              <CategoryFilterChips categories={categories} selectedCategories={selectedCategories}
                onToggle={toggleCategory} onClearAll={() => setSelectedCategories([])} />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-1">
                {filteredItems.map(item => {
                  const cat = categories.find(c => c.id === item.category_id);
                  const IconComp = ICON_MAP[cat?.icon] || Circle;
                  const isPlaced = placedIds.has(String(item.id));
                  const isActive = selectedItem?.id === item.id;

                  return (
                    <div key={item.id}
                      className={`flex items-center gap-2 p-2 rounded-xl cursor-pointer transition-all ${isActive ? 'bg-violet-100 ring-2 ring-violet-400' : 'hover:bg-gray-50'}`}
                      onClick={() => {
                        setSelectedItem(item);
                        if (isPlaced) {
                          const pos = positions.find(p => p.item_id === item.id);
                          if (pos) setSelectedPosition(pos);
                        }
                      }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: cat?.color || '#8B5CF6' }}>
                        <IconComp size={14} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        <p className="text-xs text-gray-500 truncate">{cat?.name || 'Sans categorie'}</p>
                      </div>
                      {!isPlaced ? (
                        <button onClick={(e) => { e.stopPropagation(); setPlacementMode(item.id); showToast("Cliquez sur le plan", "info"); }}
                          className="p-1.5 bg-violet-100 text-violet-600 rounded-lg hover:bg-violet-200" title="Placer">
                          <MapPin size={14} />
                        </button>
                      ) : (
                        <Badge variant="success"><Check size={10} /></Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Map container */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-40">
              <RefreshCw size={32} className="animate-spin text-violet-500" />
            </div>
          )}

          {(createMode || placementMode) && (
            <div className="absolute top-4 left-4 z-40 bg-violet-600 text-white px-4 py-2 rounded-xl shadow-lg flex items-center gap-2">
              <Crosshair size={18} className="animate-pulse" />
              <span className="font-medium">{createMode ? 'Cliquez pour creer' : 'Cliquez pour placer'}</span>
              <button onClick={() => { setCreateMode(false); setPlacementMode(null); }} className="p-1 hover:bg-white/20 rounded">
                <X size={16} />
              </button>
            </div>
          )}

          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Detail Panel */}
          {selectedItem && selectedPosition && (
            <DetailPanel
              item={selectedItem}
              category={categories.find(c => c.id === selectedItem.category_id)}
              position={selectedPosition}
              onClose={() => { setSelectedItem(null); setSelectedPosition(null); }}
              onDelete={handleDeletePosition}
              onNavigate={(item) => navigate(`/app/infrastructure?item=${item.id}`)}
              isMobile={isMobile}
              currentPlan={selectedPlan}
            />
          )}
        </div>
      </div>

      {/* Create Modal */}
      <CreateItemModal isOpen={showCreateModal} onClose={() => { setShowCreateModal(false); setPendingPosition(null); }}
        categories={categories} onCreate={handleCreateItem} position={pendingPosition} />

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Mobile sidebar toggle */}
      {isMobile && (
        <button onClick={() => setShowSidebar(!showSidebar)}
          className="fixed bottom-4 left-4 z-50 p-3 bg-violet-600 text-white rounded-full shadow-lg">
          <Menu size={24} />
        </button>
      )}
    </div>
  );
}
