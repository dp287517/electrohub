// src/pages/Datahub_map.jsx - Map view for Datahub using VSD plans
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Database, Search, ChevronLeft, ChevronRight, Building2, MapPin, X, RefreshCw, Trash2, ArrowLeft, Plus, Circle } from "lucide-react";

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
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const markersRef = useRef([]);
  const pdfDocRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
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

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return items.filter(i => !q || i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q));
  }, [items, searchQuery]);

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
      <div className="bg-white border-b shadow-sm z-20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/app/datahub")} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
              <Database size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Datahub - Plans</h1>
              <p className="text-xs text-gray-500">{selectedPlan?.display_name || selectedPlan?.logical_name || "Aucun plan"}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select value={selectedPlan?.logical_name || ""} onChange={e => {
            const p = plans.find(p => p.logical_name === e.target.value);
            if (p) { setSelectedPlan(p); setPageIndex(0); }
          }} className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm">
            {plans.map(p => <option key={p.logical_name || p.id} value={p.logical_name}>{p.display_name || p.logical_name}</option>)}
          </select>

          {numPages > 1 && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl px-2 py-1">
              <button onClick={() => setPageIndex(i => Math.max(0, i - 1))} disabled={pageIndex === 0} className="p-1 disabled:opacity-30"><ChevronLeft size={18} /></button>
              <span className="text-sm px-2">{pageIndex + 1} / {numPages}</span>
              <button onClick={() => setPageIndex(i => Math.min(numPages - 1, i + 1))} disabled={pageIndex >= numPages - 1} className="p-1 disabled:opacity-30"><ChevronRight size={18} /></button>
            </div>
          )}

          <button onClick={() => setShowSidebar(v => !v)} className="p-2 hover:bg-gray-100 rounded-lg lg:hidden">
            {showSidebar ? <X size={20} /> : <Building2 size={20} />}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Map */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
              <RefreshCw size={32} className="animate-spin text-indigo-500" />
            </div>
          )}
          {isPlacing && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-4 py-2 rounded-xl shadow-lg z-20 flex items-center gap-2">
              <MapPin size={18} />Cliquez pour placer "{selectedItem?.name}"
              <button onClick={() => setIsPlacing(false)} className="p-1 hover:bg-white/20 rounded"><X size={16} /></button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        {(showSidebar || !isMobile) && (
          <div className={`${isMobile ? 'absolute inset-y-0 right-0 z-30' : ''} w-80 bg-white border-l shadow-lg flex flex-col`}>
            <div className="p-4 border-b">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..." className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredItems.map(item => {
                const cat = categories.find(c => c.id === item.category_id);
                const placed = placedIds.has(String(item.id));
                const isSelected = selectedItem?.id === item.id;

                return (
                  <button key={item.id} onClick={() => { setSelectedItem(item); setIsPlacing(false); }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${isSelected ? 'bg-indigo-100 border-indigo-300' : 'bg-gray-50 hover:bg-gray-100'} border`}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: cat?.color || '#6366F1' }}>
                      <Circle size={14} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.building} • {item.floor}</p>
                    </div>
                    {placed ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] rounded-full">Placé</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded-full">-</span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedItem && (
              <div className="border-t p-4 space-y-2">
                <div className="text-sm font-medium text-gray-900 truncate">{selectedItem.name}</div>
                {placedIds.has(String(selectedItem.id)) ? (
                  <button onClick={() => {
                    const pos = positions.find(p => p.item_id === selectedItem.id);
                    if (pos) handleDeletePosition(pos.id);
                  }} className="w-full py-2 px-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium flex items-center justify-center gap-2">
                    <Trash2 size={16} />Supprimer position
                  </button>
                ) : (
                  <button onClick={() => setIsPlacing(true)}
                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-medium flex items-center justify-center gap-2">
                    <Plus size={16} />Placer sur le plan
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
