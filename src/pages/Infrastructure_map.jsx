// src/pages/Infrastructure_map.jsx
// Vue carte pour les plans d'infrastructure électrique
// Permet de placer les équipements ATEX sur les plans
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../lib/api.js";
import {
  isMobileDevice,
  getPDFConfig,
  getPlanCacheKey,
  getCachedPlan,
  cachePlan,
  getOptimalImageFormat,
} from "../config/mobile-optimization.js";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ============================================================
// DRAW MODES
// ============================================================
const DRAW_NONE = "none";
const DRAW_RECT = "rect";
const DRAW_CIRCLE = "circle";
const DRAW_POLY = "poly";

// Zone colors (legacy - used for zones without ATEX zoning)
const ZONE_COLORS = [
  "#6B7280", // Gray
  "#EF4444", // Red
  "#F59E0B", // Amber
  "#10B981", // Green
  "#3B82F6", // Blue
  "#8B5CF6", // Purple
  "#EC4899", // Pink
];

// ATEX zone colors (same as Atex-map.jsx)
const GAS_STROKE = { 0: "#0ea5e9", 1: "#ef4444", 2: "#f59e0b", null: "#6b7280", undefined: "#6b7280" };
const DUST_FILL = { 20: "#84cc16", 21: "#8b5cf6", 22: "#06b6d4", null: "#e5e7eb", undefined: "#e5e7eb" };

// Get colors for a zone based on ATEX zoning
function getAtexZoneColors(zone) {
  const hasAtex = zone.zoning_gas !== null || zone.zoning_dust !== null;
  if (!hasAtex) {
    // Use the zone's custom color or default
    const color = zone.color || "#6B7280";
    return { stroke: color, fill: color };
  }
  return {
    stroke: GAS_STROKE[zone.zoning_gas] || GAS_STROKE[null],
    fill: DUST_FILL[zone.zoning_dust] || DUST_FILL[null],
  };
}

// ============================================================
// EQUIPMENT MARKER DESIGN (same as Atex-map.jsx)
// ============================================================
const ICON_PX = 22;
const ICON_PX_SELECTED = 34;

// Gradients par statut pour un design moderne
const STATUS_GRADIENT = {
  a_faire: { from: "#34d399", to: "#059669" },      // Vert emeraude
  en_cours_30: { from: "#fbbf24", to: "#f59e0b" },  // Ambre/Orange
  en_retard: { from: "#fb7185", to: "#e11d48" },    // Rose/Rouge
  fait: { from: "#60a5fa", to: "#2563eb" },         // Bleu
  selected: { from: "#a78bfa", to: "#7c3aed" },     // Violet pour sélection
};

// Icône SVG flamme ATEX
const ATEX_FLAME_SVG = `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2C9.5 5 6 9 6 13c0 3.31 2.69 6 6 6s6-2.69 6-6c0-4-3.5-8-6-11zm0 15c-1.66 0-3-1.34-3-3 0-1.5 1-3 3-5 2 2 3 3.5 3 5 0 1.66-1.34 3-3 3z"/>
</svg>`;

function makeEquipIcon(status, isSelected = false) {
  const s = isSelected ? ICON_PX_SELECTED : ICON_PX;

  // Utilise le gradient violet si sélectionné, sinon le gradient du statut
  const grad = isSelected
    ? STATUS_GRADIENT.selected
    : (STATUS_GRADIENT[status] || STATUS_GRADIENT.fait);

  // Classes d'animation
  let animClass = "";
  if (isSelected) {
    animClass = "atex-marker-selected";
  } else if (status === "en_retard") {
    animClass = "atex-marker-pulse-red";
  } else if (status === "en_cours_30") {
    animClass = "atex-marker-pulse-orange";
  }

  // Bordure plus visible pour sélection
  const borderStyle = isSelected
    ? "border:3px solid #a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,0.4),0 6px 15px rgba(0,0,0,.35);"
    : "border:2px solid white;box-shadow:0 4px 10px rgba(0,0,0,.25);";

  const html = `
    <div class="${animClass}" style="
      width:${s}px;height:${s}px;border-radius:9999px;
      background: radial-gradient(circle at 30% 30%, ${grad.from}, ${grad.to});
      ${borderStyle}
      display:flex;align-items:center;justify-content:center;
      transition:all 0.2s ease;
      z-index:${isSelected ? 1000 : 1};
    ">
      ${ATEX_FLAME_SVG.replace('viewBox', `width="${s * 0.55}" height="${s * 0.55}" viewBox`)}
    </div>`;

  return L.divIcon({
    className: "atex-marker-inline",
    html,
    iconSize: [s, s],
    iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
    popupAnchor: [0, -Math.round(s / 2)],
  });
}

// ============================================================
// INFRASTRUCTURE MAP COMPONENT
// ============================================================

export default function InfrastructureMap({
  plan,
  positions = [],
  zones = [],
  atexEquipments = [],
  onPlaceEquipment,
  onUpdatePosition,
  onDeletePosition,
  onZoneCreate,
  onZoneUpdate,
  onZoneDelete,
  onEquipmentClick,
  refreshTick = 0,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const markersLayerRef = useRef(null);
  const zonesLayerRef = useRef(null);

  // PDF states
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [imgSrc, setImgSrc] = useState(null);

  // Interaction states
  const [placingEquipment, setPlacingEquipment] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");

  // Drawing states
  const [drawing, setDrawing] = useState(DRAW_NONE);
  const [polyTemp, setPolyTemp] = useState([]);
  const [drawMenu, setDrawMenu] = useState(false);
  const [selectedZoneColor, setSelectedZoneColor] = useState(ZONE_COLORS[0]);

  // Zone editor modal
  const [zoneEditor, setZoneEditor] = useState(null); // { tempLayer, kind, geometry } - for NEW zones

  // Editing existing zone
  const [editingZone, setEditingZone] = useState(null); // { id, name, zoning_gas, zoning_dust, color } - for EXISTING zones

  // Selected position for highlight
  const [selectedPositionId, setSelectedPositionId] = useState(null);

  // Filter for equipment selector - only show equipment not already placed on this plan
  const placedEquipmentIds = useMemo(() => {
    return new Set(positions.map(p => p.equipment_id));
  }, [positions]);

  const availableEquipments = useMemo(() => {
    return atexEquipments.filter(eq => !placedEquipmentIds.has(eq.id));
  }, [atexEquipments, placedEquipmentIds]);

  // ============================================================
  // Load PDF
  // ============================================================
  const loadPdf = useCallback(async () => {
    if (!plan) return;

    setPdfLoading(true);
    setPdfError(null);

    try {
      const config = getPDFConfig();
      const cacheKey = getPlanCacheKey(`infra_${plan.id || plan.logical_name}`, 0, config);

      // Check cache first
      const cached = getCachedPlan(cacheKey);
      if (cached) {
        setImgSrc(cached.dataUrl);
        setImgSize({ w: cached.width, h: cached.height });
        setPdfLoading(false);
        return;
      }

      // Fetch PDF
      const pdfUrl = api.infra.planFileUrl(plan, { bust: false });
      const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      // Calculate optimal scale
      const viewport = page.getViewport({ scale: 1 });
      const baseWidth = viewport.width;
      const targetWidth = Math.min(config.maxBitmapWidth, Math.max(config.minBitmapWidth, baseWidth * config.qualityBoost));
      const scale = Math.min(config.maxScale, Math.max(config.minScale, targetWidth / baseWidth));

      const scaledViewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      const ctx = canvas.getContext("2d", {
        alpha: false,           // Pas de canal alpha (opaque) - évite fond noir sur Chrome
        desynchronized: false,  // Synchrone pour cohérence
        willReadFrequently: false,
      });

      // IMPORTANT: Fond blanc AVANT le rendu PDF (sinon fond noir sur Chrome)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.imageSmoothingEnabled = config.enableImageSmoothing;
      ctx.imageSmoothingQuality = "high";

      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
        intent: config.intent,
      }).promise;

      // Get optimal format (JPEG on mobile, PNG on desktop)
      const dataUrl = getOptimalImageFormat(canvas);

      // Cache the result
      cachePlan(cacheKey, dataUrl, canvas.width, canvas.height);

      setImgSrc(dataUrl);
      setImgSize({ w: canvas.width, h: canvas.height });

      // Cleanup
      pdf.cleanup?.();
    } catch (err) {
      console.error("[InfraMap] PDF load error:", err);
      setPdfError(err.message || "Erreur de chargement du PDF");
    } finally {
      setPdfLoading(false);
    }
  }, [plan]);

  useEffect(() => {
    loadPdf();
  }, [loadPdf, refreshTick]);

  // ============================================================
  // Initialize Leaflet map
  // ============================================================
  useEffect(() => {
    if (!containerRef.current || !imgSrc || imgSize.w === 0) return;

    // Destroy existing map
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    // Create map
    const bounds = [
      [0, 0],
      [imgSize.h, imgSize.w],
    ];

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 4,
      zoomControl: true,
      attributionControl: false,
    });

    // Create custom panes with z-index ordering (like Atex-map)
    map.createPane("basePane");
    map.getPane("basePane").style.zIndex = 200;
    map.createPane("zonesPane");
    map.getPane("zonesPane").style.zIndex = 380;
    map.createPane("markersPane");
    map.getPane("markersPane").style.zIndex = 400;

    // Add image overlay to base pane
    const overlay = L.imageOverlay(imgSrc, bounds, { pane: "basePane" });
    overlay.addTo(map);
    map.fitBounds(bounds);

    // Create layers for zones and markers with proper panes
    const zonesLayer = L.layerGroup({ pane: "zonesPane" }).addTo(map);
    const markersLayer = L.layerGroup({ pane: "markersPane" }).addTo(map);

    mapRef.current = map;
    overlayRef.current = overlay;
    markersLayerRef.current = markersLayer;
    zonesLayerRef.current = zonesLayer;

    // Click handler for placing equipment
    map.on("click", (e) => {
      if (placingEquipment && selectedEquipmentId) {
        const { lat, lng } = e.latlng;
        const x_frac = lng / imgSize.w;
        const y_frac = 1 - lat / imgSize.h;

        onPlaceEquipment?.(selectedEquipmentId, x_frac, y_frac, 0);

        setPlacingEquipment(false);
        setSelectedEquipmentId("");
      }
    });

    return () => {
      map.remove();
    };
  }, [imgSrc, imgSize]);

  // ============================================================
  // Drawing Rectangle & Circle
  // ============================================================
  useEffect(() => {
    const m = mapRef.current;
    if (!m || drawing === DRAW_NONE || drawing === DRAW_POLY) return;
    if (imgSize.w === 0) return;

    let startPt = null;
    let tempLayer = null;
    const mode = drawing;
    const color = selectedZoneColor;

    const onDown = (e) => {
      startPt = e.latlng;
      if (mode === DRAW_CIRCLE) {
        tempLayer = L.circle(e.latlng, {
          radius: 1,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.2,
          pane: "zonesPane",
        }).addTo(m);
      }
      if (mode === DRAW_RECT) {
        tempLayer = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.2,
          pane: "zonesPane",
        }).addTo(m);
      }
      m.dragging.disable();
    };

    const onMove = (e) => {
      if (!startPt || !tempLayer) return;
      if (mode === DRAW_CIRCLE) {
        const r = m.distance(startPt, e.latlng);
        tempLayer.setRadius(Math.max(4, r));
      } else if (mode === DRAW_RECT) {
        tempLayer.setBounds(L.latLngBounds(startPt, e.latlng));
      }
    };

    const onUp = () => {
      m.dragging.enable();
      if (!startPt || !tempLayer) {
        setDrawing(DRAW_NONE);
        return;
      }

      // Calculate geometry in normalized coordinates (0-1)
      let geometry;
      if (mode === DRAW_CIRCLE) {
        const ll = tempLayer.getLatLng();
        const r = tempLayer.getRadius();
        geometry = {
          cx: ll.lng / imgSize.w,
          cy: 1 - ll.lat / imgSize.h,
          r: r / Math.min(imgSize.w, imgSize.h),
        };
      } else if (mode === DRAW_RECT) {
        const b = tempLayer.getBounds();
        geometry = {
          x1: b.getWest() / imgSize.w,
          y1: 1 - b.getNorth() / imgSize.h,
          x2: b.getEast() / imgSize.w,
          y2: 1 - b.getSouth() / imgSize.h,
        };
      }

      // Open zone editor modal
      setZoneEditor({ tempLayer, kind: mode, geometry, color });
      setDrawing(DRAW_NONE);
    };

    m.on("mousedown", onDown);
    m.on("mousemove", onMove);
    m.on("mouseup", onUp);

    return () => {
      m.off("mousedown", onDown);
      m.off("mousemove", onMove);
      m.off("mouseup", onUp);
    };
  }, [drawing, imgSize, selectedZoneColor]);

  // ============================================================
  // Drawing Polygon
  // ============================================================
  useEffect(() => {
    const m = mapRef.current;
    if (!m || drawing !== DRAW_POLY) return;
    if (imgSize.w === 0) return;

    let tempPoly = null;
    const color = selectedZoneColor;
    const style = { color, weight: 2, fillColor: color, fillOpacity: 0.2, dashArray: "5, 5", pane: "zonesPane" };

    const redraw = () => {
      if (tempPoly) {
        m.removeLayer(tempPoly);
        tempPoly = null;
      }
      if (polyTemp.length >= 1) {
        tempPoly = L.polygon(polyTemp, style).addTo(m);
      }
    };

    const onClick = (e) => {
      // Don't add points when placing equipment
      if (placingEquipment) return;
      setPolyTemp((old) => [...old, e.latlng]);
    };

    const onMove = () => redraw();

    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e);
      if (polyTemp.length < 3) return;

      // Calculate geometry
      const points = polyTemp.map((ll) => [
        ll.lng / imgSize.w,
        1 - ll.lat / imgSize.h,
      ]);

      // Create final polygon for visual
      const finalPoly = L.polygon(polyTemp, { ...style, dashArray: null, pane: "zonesPane" });

      setZoneEditor({ tempLayer: finalPoly, kind: "poly", geometry: { points }, color });
      setPolyTemp([]);
      setDrawing(DRAW_NONE);
      if (tempPoly) m.removeLayer(tempPoly);
    };

    m.on("click", onClick);
    m.on("mousemove", onMove);
    m.on("dblclick", onDblClick);

    return () => {
      m.off("click", onClick);
      m.off("mousemove", onMove);
      m.off("dblclick", onDblClick);
      if (tempPoly) m.removeLayer(tempPoly);
    };
  }, [drawing, polyTemp, imgSize, selectedZoneColor, placingEquipment]);

  // Handle zone editor save
  const handleSaveZone = (zoneData) => {
    if (!zoneEditor || !zoneData?.name) {
      // Cancel
      if (zoneEditor?.tempLayer && mapRef.current) {
        mapRef.current.removeLayer(zoneEditor.tempLayer);
      }
      setZoneEditor(null);
      return;
    }

    onZoneCreate?.({
      name: zoneData.name,
      kind: zoneEditor.kind,
      geometry: zoneEditor.geometry,
      color: zoneEditor.color,
      zoning_gas: zoneData.zoning_gas ?? null,
      zoning_dust: zoneData.zoning_dust ?? null,
      page_index: 0,
    });

    // Remove temp layer
    if (zoneEditor.tempLayer && mapRef.current) {
      mapRef.current.removeLayer(zoneEditor.tempLayer);
    }
    setZoneEditor(null);
  };

  // Re-render markers when positions change or when placing mode changes
  useEffect(() => {
    if (!markersLayerRef.current || !imgSize.w) return;

    markersLayerRef.current.clearLayers();

    positions.forEach((pos) => {
      if (pos.x_frac === undefined || pos.y_frac === undefined) return;

      const lat = (1 - pos.y_frac) * imgSize.h;
      const lng = pos.x_frac * imgSize.w;

      const isSelected = pos.id === selectedPositionId;

      // Use the same marker design as Atex-map with status-based gradient
      const icon = makeEquipIcon(pos.equipment_status, isSelected);

      const marker = L.marker([lat, lng], {
        icon,
        draggable: true,
      });

      // Tooltip with equipment name and status
      const equipmentName = pos.equipment_name || "Équipement";
      const statusLabel = {
        a_faire: "À faire",
        en_cours_30: "≤ 90 jours",
        en_retard: "En retard",
        fait: "Fait",
      }[pos.equipment_status] || "";
      marker.bindTooltip(`${equipmentName}${statusLabel ? ` (${statusLabel})` : ""}`, {
        permanent: false,
        direction: "top",
      });

      marker.on("click", () => {
        setSelectedPositionId(pos.id);
        // Open equipment drawer if callback provided
        if (onEquipmentClick && pos.equipment_id) {
          onEquipmentClick(pos.equipment_id);
        }
      });

      marker.on("dragend", (e) => {
        const { lat: newLat, lng: newLng } = e.target.getLatLng();
        const x_frac = newLng / imgSize.w;
        const y_frac = 1 - newLat / imgSize.h;
        onUpdatePosition?.(pos.id, { x_frac, y_frac });
      });

      markersLayerRef.current.addLayer(marker);
    });
  }, [positions, imgSize, selectedPositionId, onUpdatePosition, onEquipmentClick]);

  // ============================================================
  // Draw zones
  // ============================================================
  useEffect(() => {
    if (!zonesLayerRef.current || !imgSize.w) return;

    zonesLayerRef.current.clearLayers();

    zones.forEach((zone) => {
      if (!zone.geometry) return;

      // Use ATEX colors if zoning is defined, otherwise use zone's custom color
      const { stroke, fill } = getAtexZoneColors(zone);
      let shape;

      const geom = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;

      if (zone.kind === "rect" && geom.x1 !== undefined) {
        const { x1, y1, x2, y2 } = geom;
        const bounds = [
          [(1 - y2) * imgSize.h, x1 * imgSize.w],
          [(1 - y1) * imgSize.h, x2 * imgSize.w],
        ];
        shape = L.rectangle(bounds, {
          color: stroke,
          weight: 2,
          fillColor: fill,
          fillOpacity: 0.15,
          pane: "zonesPane",
        });
      } else if (zone.kind === "circle" && geom.cx !== undefined) {
        const { cx, cy, r } = geom;
        const lat = (1 - cy) * imgSize.h;
        const lng = cx * imgSize.w;
        const radius = r * Math.min(imgSize.w, imgSize.h);
        shape = L.circle([lat, lng], {
          radius,
          color: stroke,
          weight: 2,
          fillColor: fill,
          fillOpacity: 0.15,
          pane: "zonesPane",
        });
      } else if (zone.kind === "poly" && geom.points?.length) {
        const latLngs = geom.points.map((pt) => {
          const [x, y] = Array.isArray(pt) ? pt : [pt.x, pt.y];
          return [(1 - y) * imgSize.h, x * imgSize.w];
        });
        shape = L.polygon(latLngs, {
          color: stroke,
          weight: 2,
          fillColor: fill,
          fillOpacity: 0.15,
          pane: "zonesPane",
        });
      }

      if (shape) {
        // Tooltip with zone info
        const gasLabel = zone.zoning_gas !== null && zone.zoning_gas !== undefined ? `Gaz: Zone ${zone.zoning_gas}` : "";
        const dustLabel = zone.zoning_dust !== null && zone.zoning_dust !== undefined ? `Poussière: Zone ${zone.zoning_dust}` : "";
        const tooltipText = [zone.name || "Zone", gasLabel, dustLabel].filter(Boolean).join(" | ");
        shape.bindTooltip(tooltipText, { permanent: false, direction: "center" });

        // Click handler to edit zone
        shape.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          setEditingZone({
            id: zone.id,
            name: zone.name || "",
            zoning_gas: zone.zoning_gas ?? null,
            zoning_dust: zone.zoning_dust ?? null,
            color: zone.color || "#6B7280",
          });
        });

        // Cursor style on hover
        shape.on("mouseover", () => {
          shape.setStyle({ fillOpacity: 0.4, weight: 3 });
        });
        shape.on("mouseout", () => {
          shape.setStyle({ fillOpacity: 0.2, weight: 2 });
        });

        zonesLayerRef.current.addLayer(shape);
      }
    });
  }, [zones, imgSize]);

  // Set draw mode helper
  const setDrawMode = (mode) => {
    if (mode === DRAW_POLY) {
      setPolyTemp([]);
    }
    setDrawing(mode);
    setDrawMenu(false);
  };

  // Cancel drawing
  const cancelDrawing = () => {
    setDrawing(DRAW_NONE);
    setPolyTemp([]);
    if (zoneEditor?.tempLayer && mapRef.current) {
      mapRef.current.removeLayer(zoneEditor.tempLayer);
    }
    setZoneEditor(null);
  };

  // ============================================================
  // Render
  // ============================================================
  const isMobile = isMobileDevice();
  const windowH = typeof window !== "undefined" ? window.innerHeight : 900;
  const isLargeScreen = windowH > 800;
  const viewerHeight = isLargeScreen ? windowH - 200 : Math.min(windowH - 180, 700);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-200 bg-gray-50">
        <span className="text-sm font-medium text-gray-700">
          {plan?.display_name || plan?.logical_name}
        </span>

        <div className="flex-1" />

        {/* Normal mode - Draw menu */}
        {drawing === DRAW_NONE && !placingEquipment && (
          <div className="relative">
            <button
              onClick={() => setDrawMenu((v) => !v)}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center gap-2"
              title="Dessiner une zone"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Dessiner zone
            </button>

            {/* Draw menu dropdown */}
            {drawMenu && (
              <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]">
                <button
                  onClick={() => setDrawMode(DRAW_RECT)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                >
                  <span className="w-4 h-4 border-2 border-current" />
                  Rectangle
                </button>
                <button
                  onClick={() => setDrawMode(DRAW_CIRCLE)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                >
                  <span className="w-4 h-4 border-2 border-current rounded-full" />
                  Cercle
                </button>
                <button
                  onClick={() => setDrawMode(DRAW_POLY)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                  </svg>
                  Polygone
                </button>
                <hr className="my-1" />
                <div className="px-4 py-2">
                  <span className="text-xs text-gray-500 block mb-2">Couleur:</span>
                  <div className="flex gap-1 flex-wrap">
                    {ZONE_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setSelectedZoneColor(c)}
                        className={`w-6 h-6 rounded ${selectedZoneColor === c ? "ring-2 ring-offset-1 ring-gray-400" : ""}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Drawing mode indicator */}
        {drawing !== DRAW_NONE && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-green-600 font-medium">
              {drawing === DRAW_RECT && "Cliquez et glissez pour dessiner un rectangle"}
              {drawing === DRAW_CIRCLE && "Cliquez et glissez pour dessiner un cercle"}
              {drawing === DRAW_POLY && `Cliquez pour ajouter des points (${polyTemp.length}) - Double-clic pour terminer`}
            </span>
            {drawing === DRAW_POLY && polyTemp.length >= 3 && (
              <button
                onClick={() => {
                  const m = mapRef.current;
                  if (m) {
                    const ev = new MouseEvent("dblclick", { bubbles: true });
                    m.getContainer().dispatchEvent(ev);
                  }
                }}
                className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
              >
                Terminer
              </button>
            )}
            <button
              onClick={cancelDrawing}
              className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg"
            >
              Annuler
            </button>
          </div>
        )}

        {/* Placing mode indicator */}
        {placingEquipment && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-600 font-medium">
              Cliquez sur le plan pour placer l'équipement
            </span>
            <button
              onClick={() => {
                setPlacingEquipment(false);
                setSelectedEquipmentId("");
              }}
              className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg"
            >
              Annuler
            </button>
          </div>
        )}
      </div>

      {/* Map container */}
      <div style={{ height: viewerHeight }} className="relative">
        {pdfLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent mx-auto mb-4" />
              <p className="text-gray-600">Chargement du plan...</p>
            </div>
          </div>
        )}

        {pdfError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="text-center text-red-500">
              <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p>{pdfError}</p>
              <button
                onClick={loadPdf}
                className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg"
              >
                Réessayer
              </button>
            </div>
          </div>
        )}

        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* Legend */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-gray-500">
            {positions.length} équipement(s) placé(s) - {zones.length} zone(s)
          </span>
          {selectedPositionId && (
            <button
              onClick={() => {
                if (confirm("Retirer cet équipement du plan ?")) {
                  onDeletePosition?.(selectedPositionId);
                  setSelectedPositionId(null);
                }
              }}
              className="text-red-600 hover:text-red-700"
            >
              Retirer l'équipement sélectionné
            </button>
          )}
        </div>
      </div>

      {/* Zone editor modal */}
      {zoneEditor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Nouvelle zone
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const zoningGasVal = formData.get("zoning_gas");
                const zoningDustVal = formData.get("zoning_dust");
                handleSaveZone({
                  name: formData.get("zoneName"),
                  zoning_gas: zoningGasVal === "" ? null : Number(zoningGasVal),
                  zoning_dust: zoningDustVal === "" ? null : Number(zoningDustVal),
                });
              }}
            >
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom de la zone
                </label>
                <input
                  type="text"
                  name="zoneName"
                  autoFocus
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Ex: Zone de stockage, Bureau, Atelier..."
                />
              </div>

              {/* Zonage ATEX */}
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-sm font-medium text-amber-800 mb-3 flex items-center gap-2">
                  <span>⚠️</span> Zonage ATEX
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Zone Gaz
                    </label>
                    <select
                      name="zoning_gas"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    >
                      <option value="">Non classée</option>
                      <option value="0">Zone 0 (Gaz permanent)</option>
                      <option value="1">Zone 1 (Gaz occasionnel)</option>
                      <option value="2">Zone 2 (Gaz rare)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Zone Poussière
                    </label>
                    <select
                      name="zoning_dust"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    >
                      <option value="">Non classée</option>
                      <option value="20">Zone 20 (Poussière permanente)</option>
                      <option value="21">Zone 21 (Poussière occasionnelle)</option>
                      <option value="22">Zone 22 (Poussière rare)</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-amber-700 mt-2">
                  Définissez le classement ATEX selon la directive 1999/92/CE
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Couleur
                </label>
                <div className="flex gap-2 flex-wrap">
                  {ZONE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setZoneEditor({ ...zoneEditor, color: c });
                        setSelectedZoneColor(c);
                      }}
                      className={`w-8 h-8 rounded ${zoneEditor.color === c ? "ring-2 ring-offset-2 ring-gray-400" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => handleSaveZone(null)}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
                >
                  Créer la zone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit existing zone modal */}
      {editingZone && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Modifier la zone
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const zoningGasVal = formData.get("zoning_gas");
                const zoningDustVal = formData.get("zoning_dust");
                onZoneUpdate?.(editingZone.id, {
                  name: formData.get("zoneName"),
                  zoning_gas: zoningGasVal === "" ? null : Number(zoningGasVal),
                  zoning_dust: zoningDustVal === "" ? null : Number(zoningDustVal),
                  color: editingZone.color,
                });
                setEditingZone(null);
              }}
            >
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom de la zone
                </label>
                <input
                  type="text"
                  name="zoneName"
                  autoFocus
                  required
                  defaultValue={editingZone.name}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Ex: Zone de stockage, Bureau, Atelier..."
                />
              </div>

              {/* Zonage ATEX */}
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-sm font-medium text-amber-800 mb-3 flex items-center gap-2">
                  <span>⚠️</span> Zonage ATEX
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Zone Gaz
                    </label>
                    <select
                      name="zoning_gas"
                      defaultValue={editingZone.zoning_gas ?? ""}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    >
                      <option value="">Non classée</option>
                      <option value="0">Zone 0 (Gaz permanent)</option>
                      <option value="1">Zone 1 (Gaz occasionnel)</option>
                      <option value="2">Zone 2 (Gaz rare)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Zone Poussière
                    </label>
                    <select
                      name="zoning_dust"
                      defaultValue={editingZone.zoning_dust ?? ""}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    >
                      <option value="">Non classée</option>
                      <option value="20">Zone 20 (Poussière permanente)</option>
                      <option value="21">Zone 21 (Poussière occasionnelle)</option>
                      <option value="22">Zone 22 (Poussière rare)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Couleur
                </label>
                <div className="flex gap-2 flex-wrap">
                  {ZONE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditingZone({ ...editingZone, color: c })}
                      className={`w-8 h-8 rounded ${editingZone.color === c ? "ring-2 ring-offset-2 ring-gray-400" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3 justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Supprimer cette zone ?")) {
                      onZoneDelete?.(editingZone.id);
                      setEditingZone(null);
                    }
                  }}
                  className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
                >
                  🗑️ Supprimer
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingZone(null)}
                    className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
                  >
                    💾 Enregistrer
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSS for markers */}
      <style>{`
        .infra-marker {
          background: transparent !important;
          border: none !important;
        }
        .infra-marker-inner {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 14px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: transform 0.15s;
        }
        .infra-marker-inner:hover {
          transform: scale(1.15);
        }
        .infra-marker-inner.selected {
          box-shadow: 0 0 0 3px white, 0 0 0 6px #F59E0B;
        }
        .infra-marker-inner svg {
          width: 16px;
          height: 16px;
        }
      `}</style>
    </div>
  );
}
