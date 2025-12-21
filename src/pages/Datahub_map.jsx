// src/pages/Datahub_map.jsx - Map view for Datahub with category filtering and item creation
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Database, Search, ChevronLeft, ChevronRight, Building2, MapPin, X, RefreshCw,
  Trash2, ArrowLeft, Plus, Circle, Square, Triangle, Star, Heart, Target, Menu,
  CheckCircle, AlertCircle, Crosshair, Tag, Filter, Layers, Eye, EyeOff, Zap,
  Power, Battery, Plug, Gauge, Wrench, Factory, Server, Cpu, Wifi, Shield, Flag,
  Home, Building, Box, Clock, Calendar, Bell, Navigation, Compass, Pin, Bookmark,
  Award, User, Users, Folder, File, Info, Lock, Check, Flame, Thermometer,
  HardDrive, Monitor, Cable, Droplet, Wind, Sun, Cloud, Package
} from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const STORAGE_KEY_PLAN = "datahub_map_selected_plan";
const STORAGE_KEY_PAGE = "datahub_map_page_index";

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

// Create Item Modal
const CreateItemModal = ({ isOpen, onClose, categories, onCreate, position }) => {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (isOpen) { setName(''); setCategoryId(categories[0]?.id || ''); }
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
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-5 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl"><Plus size={24} /></div>
            <div>
              <h2 className="text-xl font-bold">Nouvel item</h2>
              <p className="text-indigo-100 text-sm">Sera place sur le plan</p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
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

        <div className="border-t p-4 flex gap-3">
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

// Detail Panel for selected item
const DetailPanel = ({ item, category, position, onClose, onDelete, onNavigate, isMobile }) => {
  if (!item) return null;
  const IconComp = ICON_MAP[category?.icon] || Circle;

  return (
    <div className={`${isMobile ? 'fixed inset-x-2 bottom-2 z-30' : 'absolute bottom-4 right-4 w-80 z-30'} bg-white rounded-2xl shadow-2xl border overflow-hidden animate-slideUp`}>
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-4 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2 bg-white/20 rounded-xl flex-shrink-0">
              <IconComp size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold truncate">{item.name}</h3>
              <p className="text-indigo-100 text-sm truncate">{category?.name || 'Sans categorie'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg flex-shrink-0">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
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

        <div className="flex gap-2">
          <button
            onClick={() => onNavigate(item)}
            className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-100 text-indigo-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-indigo-200"
          >
            <Eye size={16} />Voir details
          </button>
          {position && (
            <button
              onClick={() => onDelete(position.id)}
              className="py-2.5 px-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium flex items-center justify-center gap-2 hover:bg-red-100"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default function DatahubMap() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusItemId = searchParams.get("item");

  // Core data
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [positions, setPositions] = useState([]);
  const [placedIds, setPlacedIds] = useState(new Set());

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

  // Keep refs in sync
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
        api.datahub.maps.listPlans(),
        api.datahub.list({}),
        api.datahub.listCategories(),
        api.datahub.maps.placedIds()
      ]);
      setPlans(plansRes?.plans || []);
      setItems(itemsRes?.items || []);
      setCategories(catsRes?.categories || []);
      setPlacedIds(new Set((placedRes?.placed_ids || []).map(String)));
    } catch (e) {
      console.error("Load error:", e);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Restore last plan
  useEffect(() => {
    if (plans.length > 0 && !selectedPlan) {
      const saved = localStorage.getItem(STORAGE_KEY_PLAN);
      const found = plans.find(p => p.logical_name === saved || p.id === saved);
      setSelectedPlan(found || plans[0]);
      const savedPage = parseInt(localStorage.getItem(STORAGE_KEY_PAGE) || "0", 10);
      setPageIndex(savedPage);
    }
  }, [plans, selectedPlan]);

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

  useEffect(() => {
    if (selectedPlan) {
      loadPdf();
      loadPositions();
    }
  }, [selectedPlan, pageIndex, loadPdf, loadPositions]);

  // Initialize map
  const initMap = (imageUrl, w, h) => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    markersRef.current = [];

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
  };

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
  const handleCreateItem = async (formData, position) => {
    try {
      const res = await api.datahub.create(formData);
      const newItem = res?.item;
      if (!newItem?.id) throw new Error("Creation failed");

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

  // Render markers
  useEffect(() => {
    if (!mapRef.current || !overlayRef.current) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const bounds = overlayRef.current.getBounds();
    const h = bounds.getNorth();
    const w = bounds.getEast();

    positions.forEach(pos => {
      const item = items.find(i => i.id === pos.item_id);
      if (!item) return;

      // Filter by selected categories
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category_id)) return;

      const cat = categories.find(c => c.id === item.category_id);
      const color = cat?.color || "#6366F1";
      const size = cat?.marker_size || 32;
      const isSelected = selectedItem?.id === pos.item_id;
      const iconId = cat?.icon || 'circle';

      // Get SVG path for the icon
      const svgPaths = {
        circle: '<circle cx="12" cy="12" r="8"/>',
        square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
        star: '<polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/>',
        zap: '<polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>',
        database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
        target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        default: '<circle cx="12" cy="12" r="8"/>'
      };
      const svgPath = svgPaths[iconId] || svgPaths.default;

      const html = `
        <div style="width:${size}px;height:${size}px;background:radial-gradient(circle at 30% 30%, ${color}cc, ${color});border:2px solid white;border-radius:50%;
          box-shadow:0 4px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;
          transition:all 0.2s ease;${isSelected ? 'transform:scale(1.3);box-shadow:0 6px 20px rgba(0,0,0,.4);' : ''}">
          <svg viewBox="0 0 24 24" width="${size * 0.45}" height="${size * 0.45}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${svgPath}
          </svg>
        </div>`;

      const icon = L.divIcon({ html, className: "datahub-marker", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      const lat = h * (1 - pos.y_frac);
      const lng = w * pos.x_frac;
      const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(mapRef.current);

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedItem(item);
        setSelectedPosition(pos);
        setPlacementMode(null);
        setCreateMode(false);
      });

      marker.on("dragend", async () => {
        const ll = marker.getLatLng();
        const newX = clamp(ll.lng / w, 0, 1);
        const newY = clamp(1 - ll.lat / h, 0, 1);
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
        direction: "top", offset: [0, -size / 2], className: "datahub-tooltip"
      });
      markersRef.current.push(marker);
    });
  }, [positions, items, categories, selectedItem, selectedCategories, selectedPlan, pageIndex, loadPositions]);

  // Focus on item from URL
  useEffect(() => {
    if (focusItemId && items.length > 0) {
      const item = items.find(i => i.id === focusItemId);
      if (item) {
        setSelectedItem(item);
        const pos = positions.find(p => p.item_id === focusItemId);
        if (pos) {
          setSelectedPosition(pos);
          if (mapRef.current && overlayRef.current) {
            const bounds = overlayRef.current.getBounds();
            const h = bounds.getNorth();
            const w = bounds.getEast();
            mapRef.current.setView([h * (1 - pos.y_frac), w * pos.x_frac], 0);
          }
        }
      }
    }
  }, [focusItemId, items, positions]);

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
        .animate-slideUp { animation: slideUp 0.3s ease-out forwards; }
        .datahub-marker { z-index: 500 !important; }
        .datahub-tooltip { font-size: 12px; padding: 8px 12px; border-radius: 8px; }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
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
                  const isSelected = selectedItem?.id === item.id;
                  const isPlacing = placementMode?.id === item.id;
                  const IconComp = ICON_MAP[cat?.icon] || Circle;

                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border transition-all ${
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
                          <p className="font-medium text-gray-900 truncate text-sm">{item.name}</p>
                          <p className="text-xs text-gray-500 truncate">{cat?.name || 'Sans categorie'}</p>
                          <p className="text-xs text-gray-400 truncate">{item.building || '-'} • {item.floor || '-'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {placed ? (
                            <Badge variant="success"><CheckCircle size={10} className="mr-1" />Place</Badge>
                          ) : (
                            <Badge variant="warning"><AlertCircle size={10} className="mr-1" />Non place</Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => { setSelectedItem(item); const pos = positions.find(p => p.item_id === item.id); setSelectedPosition(pos || null); }}
                          className="flex-1 py-1.5 px-2 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 flex items-center justify-center gap-1"
                        >
                          <Eye size={12} />Details
                        </button>
                        {placed ? (
                          <button
                            onClick={() => setPlacementMode(item)}
                            className="flex-1 py-1.5 px-2 rounded-lg bg-purple-100 text-purple-700 text-xs font-medium hover:bg-purple-200 flex items-center justify-center gap-1"
                          >
                            <MapPin size={12} />Deplacer
                          </button>
                        ) : (
                          <button
                            onClick={() => setPlacementMode(item)}
                            className="flex-1 py-1.5 px-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 flex items-center justify-center gap-1"
                          >
                            <Target size={12} />Placer
                          </button>
                        )}
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
              <div ref={mapContainerRef} className="absolute inset-0" />

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
                onClick={() => { setCreateMode(true); setPlacementMode(null); setSelectedItem(null); }}
                disabled={createMode || isLoading}
                className="absolute top-3 left-3 z-10 w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg flex items-center justify-center hover:from-green-400 hover:to-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Creer un nouvel item"
              >
                <Plus size={24} />
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
                  onClose={() => { setSelectedItem(null); setSelectedPosition(null); }}
                  onDelete={handleDeletePosition}
                  onNavigate={(item) => navigate(`/app/datahub?item=${item.id}`)}
                  isMobile={isMobile}
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
