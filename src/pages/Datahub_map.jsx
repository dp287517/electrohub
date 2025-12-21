// src/pages/Datahub_map.jsx - Map view for Datahub using VSD plans (improved responsive)
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Database, Search, ChevronLeft, ChevronRight, Building2, MapPin, X, RefreshCw, Trash2, ArrowLeft, Plus, Circle, Menu, CheckCircle, AlertCircle } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const STORAGE_KEY_PLAN = "datahub_map_selected_plan";
const STORAGE_KEY_PAGE = "datahub_map_page_index";

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

// Badge component
const Badge = ({ children, variant = 'default' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]}`}>{children}</span>;
};

// Empty state component
const EmptyState = ({ icon: Icon, title, description }) => (
  <div className="flex-1 flex items-center justify-center p-8">
    <div className="text-center">
      <Icon size={48} className="mx-auto mb-4 text-gray-300" />
      <h3 className="text-lg font-medium text-gray-600 mb-2">{title}</h3>
      <p className="text-sm text-gray-400 max-w-xs mx-auto">{description}</p>
    </div>
  </div>
);

export default function DatahubMap() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusItemId = searchParams.get("item");

  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [positions, setPositions] = useState([]);
  const [placedIds, setPlacedIds] = useState(new Set());
  const [selectedItem, setSelectedItem] = useState(null);
  const [isPlacing, setIsPlacing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all"); // all | placed | unplaced
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const markersRef = useRef([]);
  const pdfDocRef = useRef(null);

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

  // Load data
  useEffect(() => {
    Promise.all([
      api.datahub.maps.listPlans().then(r => setPlans(r?.plans || [])),
      api.datahub.list({}).then(r => setItems(r?.items || [])),
      api.datahub.listCategories().then(r => setCategories(r?.categories || [])),
      api.datahub.maps.placedIds().then(r => setPlacedIds(new Set((r?.placed_ids || []).map(String))))
    ]);
  }, []);

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

  // Load PDF and positions
  useEffect(() => {
    if (!selectedPlan) return;
    loadPdf();
    loadPositions();
  }, [selectedPlan, pageIndex]);

  const loadPdf = async () => {
    if (!selectedPlan || !mapContainerRef.current) return;
    setIsLoading(true);
    try {
      const url = api.datahub.maps.planFileUrlAuto(selectedPlan);
      const doc = await pdfjsLib.getDocument(pdfDocOpts(url)).promise;
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
      const page = await doc.getPage(clamp(pageIndex + 1, 1, doc.numPages));
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const dataUrl = canvas.toDataURL("image/png");
      initMap(dataUrl, vp.width, vp.height);
    } catch (e) {
      console.error("PDF load error:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPositions = async () => {
    if (!selectedPlan) return;
    try {
      const res = await api.datahub.maps.positionsAuto(selectedPlan.logical_name || selectedPlan.id, pageIndex);
      setPositions(res?.positions || []);
    } catch { setPositions([]); }
  };

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

  const handleMapClick = async (e) => {
    if (!isPlacing || !selectedItem || !mapRef.current || !overlayRef.current) return;
    const bounds = overlayRef.current.getBounds();
    const h = bounds.getNorth();
    const w = bounds.getEast();
    const x_frac = clamp(e.latlng.lng / w, 0, 1);
    const y_frac = clamp(1 - e.latlng.lat / h, 0, 1);

    try {
      await api.datahub.maps.setPosition(selectedItem.id, {
        logical_name: selectedPlan.logical_name || selectedPlan.id,
        page_index: pageIndex, x_frac, y_frac
      });
      setPlacedIds(prev => new Set([...prev, String(selectedItem.id)]));
      await loadPositions();
      setIsPlacing(false);
    } catch (e) {
      console.error("Set position error:", e);
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
      const cat = categories.find(c => c.id === item?.category_id);
      const color = cat?.color || "#6366F1";
      const size = cat?.marker_size || 32;
      const isSelected = selectedItem?.id === pos.item_id;

      const html = `
        <div style="width:${size}px;height:${size}px;background:${color};border:2px solid white;border-radius:50%;
          box-shadow:0 4px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;
          ${isSelected ? 'transform:scale(1.3);z-index:1000;' : ''}">
          <svg viewBox="0 0 24 24" width="${size * 0.5}" height="${size * 0.5}" fill="none" stroke="white" stroke-width="2">
            <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
          </svg>
        </div>`;

      const icon = L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      const lat = h * (1 - pos.y_frac);
      const lng = w * pos.x_frac;
      const marker = L.marker([lat, lng], { icon }).addTo(mapRef.current);

      marker.on("click", () => {
        setSelectedItem(item);
        setIsPlacing(false);
      });

      marker.bindTooltip(item?.name || pos.item_id, { direction: "top", offset: [0, -size / 2] });
      markersRef.current.push(marker);
    });
  }, [positions, items, categories, selectedItem]);

  // Focus on item from URL
  useEffect(() => {
    if (focusItemId && items.length > 0) {
      const item = items.find(i => i.id === focusItemId);
      if (item) {
        setSelectedItem(item);
        const pos = positions.find(p => p.item_id === focusItemId);
        if (pos && mapRef.current && overlayRef.current) {
          const bounds = overlayRef.current.getBounds();
          const h = bounds.getNorth();
          const w = bounds.getEast();
          mapRef.current.setView([h * (1 - pos.y_frac), w * pos.x_frac], 0);
        }
      }
    }
  }, [focusItemId, items, positions]);

  // Filter items
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = items.filter(i => !q || i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q));

    if (filterMode === "placed") {
      list = list.filter(i => placedIds.has(String(i.id)));
    } else if (filterMode === "unplaced") {
      list = list.filter(i => !placedIds.has(String(i.id)));
    }

    return list;
  }, [items, searchQuery, filterMode, placedIds]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    placed: items.filter(i => placedIds.has(String(i.id))).length,
    unplaced: items.filter(i => !placedIds.has(String(i.id))).length,
  }), [items, placedIds]);

  const handleDeletePosition = async (posId) => {
    try {
      await api.datahub.maps.deletePosition(posId);
      await loadPositions();
      const pos = positions.find(p => p.id === posId);
      if (pos) setPlacedIds(prev => { const n = new Set(prev); n.delete(String(pos.item_id)); return n; });
    } catch {}
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        {/* Top row */}
        <div className="px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/app/datahub")} className="p-2 hover:bg-gray-100 rounded-lg">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
                <Database size={20} />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold text-gray-900">Datahub - Plans</h1>
                <p className="text-xs text-gray-500">{selectedPlan?.display_name || selectedPlan?.logical_name || "Aucun plan"}</p>
              </div>
            </div>
          </div>

          {/* Stats badges */}
          <div className="hidden md:flex items-center gap-2">
            <Badge variant="default">Total: {stats.total}</Badge>
            <Badge variant="success">Localisés: {stats.placed}</Badge>
            <Badge variant="warning">Non localisés: {stats.unplaced}</Badge>
          </div>

          {/* Toggle sidebar on mobile */}
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

        {/* Plan selector row */}
        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
          <select
            value={selectedPlan?.logical_name || ""}
            onChange={e => {
              const p = plans.find(p => p.logical_name === e.target.value);
              if (p) { setSelectedPlan(p); setPageIndex(0); }
            }}
            className="flex-1 min-w-[150px] px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
          >
            {plans.length === 0 && <option value="">Aucun plan disponible</option>}
            {plans.map(p => <option key={p.logical_name || p.id} value={p.logical_name}>{p.display_name || p.logical_name}</option>)}
          </select>

          {numPages > 1 && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl px-2 py-1">
              <button onClick={() => setPageIndex(i => Math.max(0, i - 1))} disabled={pageIndex === 0} className="p-1 disabled:opacity-30">
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm px-2">{pageIndex + 1}/{numPages}</span>
              <button onClick={() => setPageIndex(i => Math.min(numPages - 1, i + 1))} disabled={pageIndex >= numPages - 1} className="p-1 disabled:opacity-30">
                <ChevronRight size={18} />
              </button>
            </div>
          )}

          {!isMobile && (
            <button
              onClick={() => setShowSidebar(v => !v)}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              {showSidebar ? "Masquer la liste" : "Afficher la liste"}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        {showSidebar && (
          <>
            {/* Mobile backdrop */}
            {isMobile && (
              <div className="absolute inset-0 bg-black/50 z-20" onClick={() => setShowSidebar(false)} />
            )}

            <div className={`${isMobile ? 'absolute inset-y-0 right-0 z-30 w-[85vw] max-w-[320px]' : 'w-80'} bg-white border-l shadow-lg flex flex-col`}>
              {/* Search and filter */}
              <div className="p-3 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Items</span>
                  {isMobile && (
                    <button onClick={() => setShowSidebar(false)} className="p-1 hover:bg-gray-100 rounded">
                      <X size={18} />
                    </button>
                  )}
                </div>
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
                <div className="flex gap-1">
                  <button
                    onClick={() => setFilterMode("all")}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${filterMode === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    Tous
                  </button>
                  <button
                    onClick={() => setFilterMode("unplaced")}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${filterMode === 'unplaced' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    Non placés
                  </button>
                  <button
                    onClick={() => setFilterMode("placed")}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${filterMode === 'placed' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    Placés
                  </button>
                </div>
              </div>

              {/* Items list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filteredItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Database size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucun item</p>
                  </div>
                ) : filteredItems.map(item => {
                  const cat = categories.find(c => c.id === item.category_id);
                  const placed = placedIds.has(String(item.id));
                  const isSelected = selectedItem?.id === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => { setSelectedItem(item); setIsPlacing(false); }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${isSelected ? 'bg-indigo-100 border-indigo-300' : 'bg-gray-50 hover:bg-gray-100'} border`}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: cat?.color || '#6366F1' }}>
                        <Circle size={14} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm">{item.name}</p>
                        <p className="text-xs text-gray-500 truncate">{item.building || '-'} • {item.floor || '-'}</p>
                      </div>
                      {placed ? (
                        <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Selected item actions */}
              {selectedItem && (
                <div className="border-t p-3 space-y-2 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: categories.find(c => c.id === selectedItem.category_id)?.color || '#6366F1' }}>
                      <Circle size={12} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{selectedItem.name}</p>
                      <p className="text-xs text-gray-500">{selectedItem.code || '-'}</p>
                    </div>
                  </div>
                  {placedIds.has(String(selectedItem.id)) ? (
                    <button
                      onClick={() => {
                        const pos = positions.find(p => p.item_id === selectedItem.id);
                        if (pos) handleDeletePosition(pos.id);
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium flex items-center justify-center gap-2 hover:bg-red-100"
                    >
                      <Trash2 size={16} />Supprimer position
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsPlacing(true)}
                      className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-medium flex items-center justify-center gap-2 hover:from-indigo-600 hover:to-purple-700"
                    >
                      <Plus size={16} />Placer sur le plan
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Map */}
        <div className="flex-1 relative">
          {!selectedPlan || plans.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="Aucun plan disponible"
              description="Importez des plans PDF depuis la page VSD pour pouvoir localiser les items Datahub"
            />
          ) : (
            <>
              <div ref={mapContainerRef} className="absolute inset-0" />
              {isLoading && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw size={32} className="animate-spin text-indigo-500" />
                    <span className="text-sm text-gray-600">Chargement du plan...</span>
                  </div>
                </div>
              )}
              {isPlacing && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-4 py-2 rounded-xl shadow-lg z-20 flex items-center gap-2 max-w-[90vw]">
                  <MapPin size={18} className="flex-shrink-0" />
                  <span className="truncate">Cliquez pour placer "{selectedItem?.name}"</span>
                  <button onClick={() => setIsPlacing(false)} className="p-1 hover:bg-white/20 rounded flex-shrink-0">
                    <X size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile FAB to open sidebar */}
      {isMobile && !showSidebar && (
        <button
          onClick={() => setShowSidebar(true)}
          className="absolute bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-full shadow-lg flex items-center justify-center z-20"
        >
          <Database size={24} />
          {stats.unplaced > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
              {stats.unplaced}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
