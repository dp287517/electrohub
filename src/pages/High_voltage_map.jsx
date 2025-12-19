// src/pages/High_voltage_map.jsx - HV Equipment Map Page (following VSD pattern)
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getOptimalImageFormat } from "../config/mobile-optimization.js";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  Zap,
  Eye,
  ExternalLink,
  Info,
  Star,
  Shield,
  Activity,
  Factory,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, get } from "../lib/api";

// ─────────────────────────────────────────────────────────────────────
// PDF.js worker (bundlé localement pour éviter les problèmes CSP)
// ─────────────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const STORAGE_KEY_PLAN = "hv_map_selectedPlan";
const STORAGE_KEY_PAGE = "hv_map_pageIndex";
const PICK_RADIUS = 22;

function getCookie(name) {
  const m = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return m ? m[2] : null;
}

function getIdentity() {
  try {
    return JSON.parse(localStorage.getItem("eh_user") || "{}");
  } catch {
    return {};
  }
}

function userHeaders() {
  const u = getIdentity();
  return {
    "X-Site": u.site || "",
    "X-User-Role": u.role || "site",
    "X-User-Email": u.email || "",
  };
}

function pdfDocOpts(url) {
  return {
    url,
    httpHeaders: {
      Authorization: `Bearer ${getCookie("token") || localStorage.getItem("eh_token") || ""}`,
      ...userHeaders(),
    },
    withCredentials: true,
  };
}

// ─────────────────────────────────────────────────────────────────────
// UI Primitives
// ─────────────────────────────────────────────────────────────────────
const AnimatedCard = ({ children, delay = 0, className = "" }) => (
  <div className={`animate-slideUp ${className}`} style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards" }}>
    {children}
  </div>
);

const Badge = ({ children, variant = "default", size = "md", className = "" }) => {
  const variants = {
    default: "bg-gray-100 text-gray-700 border-gray-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };
  const sizes = { sm: "px-2 py-0.5 text-[10px]", md: "px-2.5 py-1 text-xs" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold border ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
};

const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
    <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
      <Icon size={40} className="text-gray-400" />
    </div>
    <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-500 mb-6 max-w-sm">{description}</p>
    {action}
  </div>
);

const Input = ({ value, onChange, placeholder, className = "" }) => (
  <input
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className={`w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 transition-all ${className}`}
  />
);

const Btn = ({ children, variant = "primary", className = "", ...props }) => {
  const base = "px-4 py-2 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50";
  const variants = {
    primary: "bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-600 hover:to-orange-700",
    subtle: "bg-amber-100 text-amber-700 hover:bg-amber-200",
    ghost: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    danger: "bg-red-500 text-white hover:bg-red-600",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Confirm Modal
// ─────────────────────────────────────────────────────────────────────
const ConfirmModal = ({ open, title, message, confirmText = "Confirmer", onConfirm, onCancel, danger = false }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-scaleIn">
        <div className={`p-6 ${danger ? "bg-red-50" : "bg-amber-50"}`}>
          <h3 className={`text-xl font-bold ${danger ? "text-red-900" : "text-amber-900"}`}>{title}</h3>
        </div>
        <div className="p-6">
          <p className="text-gray-700">{message}</p>
        </div>
        <div className="flex gap-3 p-4 border-t bg-gray-50">
          <button onClick={onCancel} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-100">
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 px-4 rounded-xl font-medium text-white ${danger ? "bg-red-500 hover:bg-red-600" : "bg-amber-500 hover:bg-amber-600"}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Context Menu
// ─────────────────────────────────────────────────────────────────────
const ContextMenu = ({ x, y, onDelete, onClose }) => {
  useEffect(() => {
    const handleClick = () => onClose();
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [onClose]);

  return (
    <div
      className="absolute bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-[6000] min-w-[160px]"
      style={{ left: Math.max(8, x - 80), top: Math.max(8, y - 8) }}
    >
      <button onClick={onDelete} className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2">
        <Trash2 size={16} />
        Détacher du plan
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// HV Equipment Card (Sidebar)
// ─────────────────────────────────────────────────────────────────────
const HvCard = ({ equipment, isPlacedHere, isPlacedSomewhere, isPlacedElsewhere, isSelected, onClick, onPlace }) => {
  const canPlace = !isPlacedSomewhere;

  return (
    <div
      className={`group relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
        isSelected
          ? "border-amber-400 bg-amber-50 shadow-lg"
          : isPlacedHere
          ? "border-emerald-300 bg-emerald-50"
          : isPlacedElsewhere
          ? "border-blue-200 bg-blue-50/50 opacity-60"
          : "border-gray-100 bg-white hover:border-amber-200 hover:shadow-md"
      }`}
      onClick={isPlacedHere ? onClick : undefined}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            isSelected
              ? "bg-amber-500 text-white"
              : isPlacedHere
              ? "bg-emerald-500 text-white"
              : equipment.is_principal
              ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white"
              : "bg-amber-100 text-amber-600"
          }`}
        >
          <Zap size={20} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-gray-900 truncate text-sm">{equipment.name}</h4>
            {equipment.is_principal && (
              <Badge variant="warning" size="sm">
                <Star size={8} />
                Principal
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1 flex-wrap">
            {equipment.code && <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{equipment.code}</span>}
            {equipment.voltage_kv && (
              <span className="flex items-center gap-0.5">
                <Zap size={10} />
                {equipment.voltage_kv} kV
              </span>
            )}
            {equipment.regime_neutral && (
              <span className="flex items-center gap-0.5">
                <Shield size={10} />
                {equipment.regime_neutral}
              </span>
            )}
          </div>

          {equipment.building_code && (
            <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <MapPin size={10} />
              {equipment.building_code}
              {equipment.floor && ` / ${equipment.floor}`}
              {equipment.room && ` / ${equipment.room}`}
            </div>
          )}

          {/* Status badges */}
          <div className="flex items-center gap-1 mt-2">
            {isPlacedHere && (
              <Badge variant="success" size="sm">
                <MapPin size={10} />
                Sur ce plan
              </Badge>
            )}
            {isPlacedElsewhere && (
              <Badge variant="info" size="sm">
                <MapPin size={10} />
                Autre plan
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Place button */}
      {canPlace && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlace(equipment);
          }}
          className="absolute top-2 right-2 p-2 bg-amber-100 text-amber-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-200"
          title="Placer sur le plan"
        >
          <MapPin size={16} />
        </button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Detail Panel (Bottom sheet) - Mobile optimized
// ─────────────────────────────────────────────────────────────────────
const DetailPanel = ({ position, equipment, onClose, onNavigate, onDelete }) => {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 animate-slideUp safe-area-inset-bottom">
      <div className="bg-white rounded-t-3xl shadow-2xl border-t border-gray-200 max-h-[50vh] sm:max-h-[40vh] overflow-y-auto">
        {/* Drag handle for mobile */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 sm:w-12 sm:h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <Zap size={22} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 truncate">{position?.name || equipment?.name || "Équipement HV"}</h3>
              <p className="text-sm text-gray-500 truncate">
                {equipment?.code || position?.code || "—"} {equipment?.regime_neutral ? `• ${equipment.regime_neutral}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 hover:bg-gray-100 rounded-xl flex-shrink-0 active:scale-95 transition-transform"
            style={{ touchAction: 'manipulation' }}
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Equipment info - responsive grid */}
          {equipment && (
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <span className="text-[10px] sm:text-xs text-gray-500 uppercase">Localisation</span>
                <p className="font-medium text-gray-900 text-sm sm:text-base truncate">
                  {equipment.building_code || "—"} / {equipment.floor || "—"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <span className="text-[10px] sm:text-xs text-gray-500 uppercase">Régime</span>
                <p className="font-medium text-gray-900 text-sm sm:text-base">{equipment.regime_neutral || "—"}</p>
              </div>
            </div>
          )}

          {/* Actions - touch optimized */}
          <div className="flex gap-3">
            <button
              onClick={() => onNavigate(position?.equipment_id || equipment?.id)}
              className="flex-1 py-3.5 px-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              style={{ touchAction: 'manipulation' }}
            >
              <Eye size={18} />
              Voir détails
            </button>
            <button
              onClick={() => onDelete(position)}
              className="py-3.5 px-4 bg-red-100 text-red-600 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-red-200 active:scale-95 transition-transform"
              style={{ touchAction: 'manipulation' }}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Placement Mode Indicator - Mobile optimized
// ─────────────────────────────────────────────────────────────────────
const PlacementModeIndicator = ({ equipment, onCancel }) => (
  <div className="absolute bottom-4 sm:bottom-6 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 animate-slideUp">
    <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-amber-600 text-white rounded-2xl shadow-xl">
      <Crosshair size={20} className="animate-pulse flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm sm:text-base">Mode placement</p>
        <p className="text-xs text-amber-200">Cliquez sur le plan pour placer "{equipment?.name}"</p>
      </div>
      <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-lg transition-colors ml-2">
        <X size={18} />
      </button>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────
// Leaflet Viewer Component
// ─────────────────────────────────────────────────────────────────────
const HvLeafletViewer = forwardRef(function HvLeafletViewer(
  { fileUrl, pageIndex = 0, initialPoints = [], selectedId, onReady, onClickPoint, onMovePoint, onCreatePoint, onContextMenu, placementActive = false, disabled = false },
  ref
) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const markersMapRef = useRef(new Map());
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);
  const initialFitDoneRef = useRef(false);
  const userViewTouchedRef = useRef(false);
  const lastViewRef = useRef({ center: [0, 0], zoom: 0 });
  const lastJob = useRef({ key: "" });
  const pointsRef = useRef(initialPoints);
  const aliveRef = useRef(true);
  const placementActiveRef = useRef(placementActive);
  const onCreatePointRef = useRef(onCreatePoint);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);

  useEffect(() => {
    placementActiveRef.current = placementActive;
  }, [placementActive]);
  useEffect(() => {
    onCreatePointRef.current = onCreatePoint;
  }, [onCreatePoint]);

  const drawMarkers = useCallback((list, canvasW, canvasH) => {
    const g = markersLayerRef.current;
    if (!g) return;
    g.clearLayers();
    markersMapRef.current.clear();

    const map = mapRef.current;
    if (!map || canvasW <= 0 || canvasH <= 0) return;

    (list || []).forEach((p) => {
      const lat = (p.y_frac ?? p.y ?? 0) * canvasH;
      const lng = (p.x_frac ?? p.x ?? 0) * canvasW;
      const isSelected = p.equipment_id === selectedId;

      const html = `
        <div style="
          width:28px;height:28px;border-radius:50%;
          background:${isSelected ? "radial-gradient(circle at 30% 30%, #fbbf24, #d97706)" : "radial-gradient(circle at 30% 30%, #f59e0b, #ea580c)"};
          border:3px solid ${isSelected ? "#fef3c7" : "#fff"};
          box-shadow:0 3px 8px rgba(0,0,0,0.35);
          display:flex;align-items:center;justify-content:center;
          font-size:12px;font-weight:700;color:#fff;
          cursor:pointer;transition:transform .15s;
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
        </div>`;

      const icon = L.divIcon({ html, className: `hv-marker-inline ${isSelected ? "hv-marker-selected" : ""}`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const mk = L.marker([lat, lng], { icon, draggable: !disabled });
      mk.__meta = { ...p, equipment_id: p.equipment_id };

      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          return;
        }
        onClickPoint?.(mk.__meta);
      });

      mk.on("dragend", () => {
        const ll = mk.getLatLng();
        const xFrac = clamp(ll.lng / canvasW, 0, 1);
        const yFrac = clamp(ll.lat / canvasH, 0, 1);
        onMovePoint?.(mk.__meta.equipment_id, { x: xFrac, y: yFrac });
      });

      mk.on("contextmenu", (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        const containerPoint = map.latLngToContainerPoint(e.latlng);
        const rect = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
        onContextMenu?.(mk.__meta, { x: rect.left + containerPoint.x, y: rect.top + containerPoint.y });
      });

      mk.addTo(g);
      markersMapRef.current.set(p.equipment_id, mk);

      // Long press for mobile
      setTimeout(() => {
        const el = mk.getElement();
        if (!el) return;

        const startLongPress = (clientX, clientY) => {
          longPressTriggeredRef.current = false;
          longPressTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            onContextMenu?.(mk.__meta, { x: clientX, y: clientY });
          }, 600);
        };

        const cancelLongPress = () => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        };

        el.addEventListener("touchstart", (e) => {
          const touch = e.touches[0];
          startLongPress(touch.clientX, touch.clientY);
        }, { passive: true });

        el.addEventListener("touchend", cancelLongPress, { passive: true });
        el.addEventListener("touchcancel", cancelLongPress, { passive: true });
        el.addEventListener("touchmove", cancelLongPress, { passive: true });
      }, 50);
    });
  }, [onClickPoint, onMovePoint, onContextMenu, disabled, selectedId]);

  const highlightMarker = useCallback((equipmentId) => {
    const mk = markersMapRef.current.get(equipmentId);
    if (!mk || !mapRef.current) return;

    const ll = mk.getLatLng();
    mapRef.current.setView(ll, mapRef.current.getZoom(), { animate: true });

    const el = mk.getElement();
    if (el) {
      el.classList.add("hv-marker-flash");
      setTimeout(() => el.classList.remove("hv-marker-flash"), 2000);
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    if (!fileUrl || !wrapRef.current) return;

    let cancelled = false;
    aliveRef.current = true;

    const jobKey = `${fileUrl}::${pageIndex}`;
    if (lastJob.current.key === jobKey) {
      onReady?.();
      return;
    }
    lastJob.current.key = jobKey;

    const cleanupMap = () => {
      const map = mapRef.current;
      if (map) {
        try { map.stop(); map.off(); map.eachLayer((l) => map.removeLayer(l)); map.remove(); } catch {}
      }
      mapRef.current = null;
      imageLayerRef.current = null;
      if (markersLayerRef.current) { try { markersLayerRef.current.clearLayers(); } catch {} markersLayerRef.current = null; }
      markersMapRef.current.clear();
      initialFitDoneRef.current = false;
      userViewTouchedRef.current = false;
    };

    const cleanupPdf = async () => {
      try { renderTaskRef.current?.cancel(); } catch {}
      try { await loadingTaskRef.current?.destroy(); } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
    };

    (async () => {
      try {
        await cleanupPdf();
        const containerW = Math.max(320, wrapRef.current.clientWidth || 1024);
        const dpr = window.devicePixelRatio || 1;

        loadingTaskRef.current = pdfjsLib.getDocument(pdfDocOpts(fileUrl));
        const pdf = await loadingTaskRef.current.promise;
        if (cancelled) return;

        const page = await pdf.getPage(Number(pageIndex) + 1);
        const baseVp = page.getViewport({ scale: 1 });

        const targetBitmapW = Math.min(4096, Math.max(2048, Math.floor(containerW * dpr * 1.5)));
        const safeScale = clamp(targetBitmapW / baseVp.width, 0.5, 3.0);
        const viewport = page.getViewport({ scale: safeScale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: true });

        renderTaskRef.current = page.render({ canvasContext: ctx, viewport });
        await renderTaskRef.current.promise;
        if (cancelled) return;

        // 🚀 JPEG compressé sur mobile, PNG sur desktop
        const dataUrl = getOptimalImageFormat(canvas);
        setImgSize({ w: canvas.width, h: canvas.height });

        const m = L.map(wrapRef.current, {
          crs: L.CRS.Simple,
          zoomControl: false,
          zoomAnimation: true,
          fadeAnimation: false,
          markerZoomAnimation: false,
          scrollWheelZoom: true,
          touchZoom: true,
          tap: false,
          preferCanvas: true,
          center: lastViewRef.current.center,
          zoom: lastViewRef.current.zoom,
        });

        L.control.zoom({ position: "topright" }).addTo(m);
        mapRef.current = m;

        const bounds = L.latLngBounds([[0, 0], [viewport.height, viewport.width]]);
        const layer = L.imageOverlay(dataUrl, bounds, { interactive: true, opacity: 1 });
        imageLayerRef.current = layer;
        layer.addTo(m);

        await new Promise(requestAnimationFrame);
        if (cancelled) return;
        m.invalidateSize(false);

        const fitZoom = m.getBoundsZoom(bounds, true);
        m.options.zoomSnap = 0.1;
        m.options.zoomDelta = 0.5;
        m.setMinZoom(fitZoom - 1);

        if (!initialFitDoneRef.current || !userViewTouchedRef.current) {
          m.fitBounds(bounds, { padding: [8, 8] });
          lastViewRef.current.center = m.getCenter();
          lastViewRef.current.zoom = m.getZoom();
          initialFitDoneRef.current = true;
        } else {
          m.setView(lastViewRef.current.center, lastViewRef.current.zoom, { animate: false });
        }

        m.setMaxZoom(fitZoom + 6);
        m.setMaxBounds(bounds.pad(0.5));

        markersLayerRef.current = L.layerGroup().addTo(m);

        m.on("click", (e) => {
          if (!aliveRef.current) return;
          if (placementActiveRef.current && onCreatePointRef.current) {
            const ll = e.latlng;
            const xFrac = clamp(ll.lng / canvas.width, 0, 1);
            const yFrac = clamp(ll.lat / canvas.height, 0, 1);
            onCreatePointRef.current(xFrac, yFrac);
            return;
          }

          const clicked = e.containerPoint;
          const near = [];
          markersLayerRef.current?.eachLayer((mk) => {
            const mp = m.latLngToContainerPoint(mk.getLatLng());
            const dist = Math.hypot(mp.x - clicked.x, mp.y - clicked.y);
            if (dist <= PICK_RADIUS) near.push(mk.__meta);
          });

          if (near.length === 1 && onClickPoint) onClickPoint(near[0]);
          else if (near.length > 1) setPicker({ x: clicked.x, y: clicked.y, items: near });
          else setPicker(null);
        });

        m.on("contextmenu", (e) => L.DomEvent.preventDefault(e));
        m.on("zoomstart", () => { setPicker(null); userViewTouchedRef.current = true; });
        m.on("movestart", () => { setPicker(null); userViewTouchedRef.current = true; });
        m.on("zoomend", () => { lastViewRef.current.zoom = m.getZoom(); });
        m.on("moveend", () => { lastViewRef.current.center = m.getCenter(); });

        drawMarkers(pointsRef.current, canvas.width, canvas.height);
        try { await pdf.cleanup(); } catch {}
        onReady?.();
      } catch (e) {
        if (String(e?.name) === "RenderingCancelledException") return;
        const msg = String(e?.message || "");
        if (msg.includes("Worker was destroyed") || msg.includes("Worker was terminated")) return;
        console.error("HV Leaflet viewer error", e);
      }
    })();

    const onResize = () => {
      const m = mapRef.current;
      const layer = imageLayerRef.current;
      if (!m || !layer) return;
      const keepCenter = lastViewRef.current.center;
      const keepZoom = lastViewRef.current.zoom;
      m.invalidateSize(false);
      if (!initialFitDoneRef.current) {
        m.fitBounds(layer.getBounds(), { padding: [8, 8] });
        initialFitDoneRef.current = true;
      } else {
        m.setView(keepCenter, keepZoom, { animate: false });
      }
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    return () => {
      cancelled = true;
      aliveRef.current = false;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      cleanupMap();
      cleanupPdf();
    };
  }, [fileUrl, pageIndex, disabled, drawMarkers, onReady]);

  useEffect(() => {
    pointsRef.current = initialPoints;
    if (mapRef.current && imgSize.w > 0) {
      drawMarkers(initialPoints, imgSize.w, imgSize.h);
    }
  }, [initialPoints, drawMarkers, imgSize.w, imgSize.h]);

  const adjust = () => {
    const m = mapRef.current;
    const layer = imageLayerRef.current;
    if (!m || !layer) return;
    const b = layer.getBounds();
    try { m.scrollWheelZoom?.disable(); } catch {}
    m.invalidateSize(false);
    const fitZoom = m.getBoundsZoom(b, true);
    m.setMinZoom(fitZoom - 1);
    m.fitBounds(b, { padding: [8, 8] });
    lastViewRef.current.center = m.getCenter();
    lastViewRef.current.zoom = m.getZoom();
    initialFitDoneRef.current = true;
    userViewTouchedRef.current = false;
    setTimeout(() => { try { m.scrollWheelZoom?.enable(); } catch {} }, 50);
  };

  useImperativeHandle(ref, () => ({
    adjust,
    drawMarkers: (list) => drawMarkers(list, imgSize.w, imgSize.h),
    highlightMarker,
  }));

  const onPickEquipment = useCallback((it) => {
    setPicker(null);
    onClickPoint?.(it);
  }, [onClickPoint]);

  return (
    <div className="relative flex-1 flex flex-col">
      <div className="flex items-center justify-end gap-2 p-2 border-b bg-white">
        <Btn variant="ghost" onClick={adjust}>Ajuster</Btn>
      </div>

      <div ref={wrapRef} className="flex-1 w-full bg-gray-100" style={{ minHeight: 400 }} />

      {picker && (
        <div
          className="absolute bg-white border rounded-xl shadow-xl p-2 z-50"
          style={{ left: Math.max(8, picker.x - 120), top: Math.max(8, picker.y - 8) }}
        >
          {picker.items.slice(0, 8).map((it) => (
            <button
              key={it.equipment_id || it.id}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded-lg truncate"
              onClick={() => onPickEquipment(it)}
            >
              {it.name || it.equipment_id}
            </button>
          ))}
          {picker.items.length > 8 && <div className="text-xs text-gray-500 px-3 py-1">...</div>}
        </div>
      )}

      <div className="flex items-center gap-3 p-2 text-xs text-gray-600 border-t bg-white">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: "radial-gradient(circle at 30% 30%, #f59e0b, #ea580c)" }} />
          Équipement HV
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: "radial-gradient(circle at 30% 30%, #fbbf24, #d97706)" }} />
          Sélectionné
        </span>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────
// Hook for map position management
// ─────────────────────────────────────────────────────────────────────
function useMapUpdateLogic(stableSelectedPlan, pageIndex, viewerRef) {
  const reloadPositionsRef = useRef(null);
  const latestPositionsRef = useRef([]);

  const loadPositions = useCallback(async (plan, pageIdx = 0) => {
    if (!plan) return [];
    // Always use logical_name for positions lookup (positions are stored by logical_name, not by UUID)
    const key = plan.logical_name || plan.id || "";
    try {
      const r = await api.hvMaps.positions(key, pageIdx).catch(() => ({}));
      const list = Array.isArray(r?.positions)
        ? r.positions.map((item) => ({
            id: item.id,
            equipment_id: item.equipment_id,
            name: item.name || item.equipment_name || `HV #${item.equipment_id}`,
            code: item.code || "",
            x_frac: Number(item.x_frac ?? item.x ?? 0),
            y_frac: Number(item.y_frac ?? item.y ?? 0),
            x: Number(item.x_frac ?? item.x ?? 0),
            y: Number(item.y_frac ?? item.y ?? 0),
            building_code: item.building_code || "",
          }))
        : [];

      latestPositionsRef.current = list;
      viewerRef.current?.drawMarkers(list);
      return list;
    } catch (e) {
      console.error("Erreur chargement positions HV", e);
      latestPositionsRef.current = [];
      viewerRef.current?.drawMarkers([]);
      return [];
    }
  }, [viewerRef]);

  useEffect(() => { reloadPositionsRef.current = loadPositions; }, [loadPositions]);

  useEffect(() => {
    if (!stableSelectedPlan) return;
    const tick = () => reloadPositionsRef.current?.(stableSelectedPlan, pageIndex);
    tick();
    const iv = setInterval(tick, 8000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [stableSelectedPlan, pageIndex]);

  const refreshPositions = useCallback((p, idx = 0) => reloadPositionsRef.current?.(p, idx), []);
  const getLatestPositions = useCallback(() => latestPositionsRef.current, []);

  return { refreshPositions, getLatestPositions };
}

// ─────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────
export default function HighVoltageMap() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlParamsHandledRef = useRef(false);
  const targetEquipmentIdRef = useRef(null);

  // Plans
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Positions
  const [initialPoints, setInitialPoints] = useState([]);
  const [pdfReady, setPdfReady] = useState(false);

  // Equipments
  const [equipments, setEquipments] = useState([]);
  const [loadingEquipments, setLoadingEquipments] = useState(false);
  const [placedIds, setPlacedIds] = useState(new Set());

  // UI
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [placementMode, setPlacementMode] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [showSidebar, setShowSidebar] = useState(true);

  // Ref to prevent double creation
  const creatingRef = useRef(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState(null);

  // Confirm modal
  const [confirmState, setConfirmState] = useState({ open: false, position: null });

  const viewerRef = useRef(null);
  const zipInputRef = useRef(null);

  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan]);
  const stableFileUrl = useMemo(() => {
    if (!stableSelectedPlan) return null;
    return api.hvMaps.planFileUrl(stableSelectedPlan, { bust: true });
  }, [stableSelectedPlan]);

  const { refreshPositions, getLatestPositions } = useMapUpdateLogic(stableSelectedPlan, pageIndex, viewerRef);

  const selectedEquipmentId = useMemo(() => selectedPosition?.equipment_id || null, [selectedPosition]);

  useEffect(() => {
    loadPlans();
    loadEquipments();
  }, []);

  // Restore plan from URL params or localStorage
  useEffect(() => {
    if (plans.length > 0 && !selectedPlan) {
      const urlHvId = searchParams.get('hv');
      const urlPlanKey = searchParams.get('plan');

      let planToSelect = null;
      let pageIdx = 0;

      if (urlPlanKey && !urlParamsHandledRef.current) {
        planToSelect = plans.find(p => p.logical_name === urlPlanKey);
        if (urlHvId) targetEquipmentIdRef.current = Number(urlHvId);
        urlParamsHandledRef.current = true;
        setSearchParams({}, { replace: true });
      }

      if (!planToSelect) {
        const savedPlanKey = localStorage.getItem(STORAGE_KEY_PLAN);
        const savedPageIndex = localStorage.getItem(STORAGE_KEY_PAGE);
        if (savedPlanKey) planToSelect = plans.find(p => p.logical_name === savedPlanKey);
        if (planToSelect && savedPageIndex) pageIdx = Number(savedPageIndex) || 0;
      }

      if (!planToSelect) planToSelect = plans[0];

      setSelectedPlan(planToSelect);
      setPageIndex(pageIdx);

      if (planToSelect) {
        refreshPositions(planToSelect, pageIdx).then(positions => setInitialPoints(positions || []));
      }
    }
  }, [plans, searchParams, setSearchParams, refreshPositions]);

  useEffect(() => {
    if (selectedPlan?.logical_name) localStorage.setItem(STORAGE_KEY_PLAN, selectedPlan.logical_name);
  }, [selectedPlan]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PAGE, String(pageIndex));
  }, [pageIndex]);

  useEffect(() => {
    if (!pdfReady || !targetEquipmentIdRef.current) return;
    const targetId = targetEquipmentIdRef.current;
    targetEquipmentIdRef.current = null;
    setTimeout(() => viewerRef.current?.highlightMarker(targetId), 300);
  }, [pdfReady]);

  const loadPlans = async () => {
    setLoadingPlans(true);
    try {
      const res = await api.hvMaps.listPlans();
      setPlans(res?.plans || res || []);
    } catch (err) {
      console.error("Erreur chargement plans HV:", err);
    } finally {
      setLoadingPlans(false);
    }
  };

  const refreshPlacedIds = async () => {
    try {
      const res = await api.hvMaps.placedIds();
      const ids = res?.placed_ids || res?.ids || [];
      setPlacedIds(new Set(ids));
    } catch (e) {
      console.error("Erreur chargement placements HV:", e);
    }
  };

  const loadEquipments = async () => {
    setLoadingEquipments(true);
    try {
      const res = await api.hv.list({});
      const list = res?.data || res?.equipments || res || [];
      setEquipments(list);
    } catch (err) {
      console.error("Erreur chargement HV:", err);
    } finally {
      setLoadingEquipments(false);
    }
  };

  useEffect(() => {
    if (plans.length > 0 && equipments.length > 0) {
      refreshPlacedIds();
    }
  }, [plans, equipments]);

  const handleSetPosition = async (equipment, xFrac, yFrac) => {
    if (!stableSelectedPlan || !equipment) return;
    try {
      await api.hvMaps.setPosition(equipment.id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id || null,
        page_index: pageIndex,
        x_frac: xFrac,
        y_frac: yFrac,
      });
      const positions = await refreshPositions(stableSelectedPlan, pageIndex);
      setInitialPoints(positions || []);
      await refreshPlacedIds();
      setPlacementMode(null);
    } catch (err) {
      console.error("Erreur placement HV:", err);
    }
  };

  // Create a new HV equipment directly from the plan
  const createEquipmentAtFrac = async (xFrac, yFrac) => {
    if (creatingRef.current) return;
    if (!stableSelectedPlan) return;

    creatingRef.current = true;
    try {
      // Create equipment with auto-generated name
      const timestamp = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const created = await api.hv.createEquipment({ name: `Nouvel équipement HV ${timestamp}`, voltage_kv: 20, regime_neutral: 'TN-S' });
      const id = created?.id || created?.equipment?.id;
      if (!id) throw new Error("Échec création équipement HV");

      // Set position on the plan
      await api.hvMaps.setPosition(id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id || null,
        page_index: pageIndex,
        x_frac: xFrac,
        y_frac: yFrac,
      });

      // Reload data
      await loadEquipments();
      const positions = await refreshPositions(stableSelectedPlan, pageIndex);
      setInitialPoints(positions || []);
      await refreshPlacedIds();

      // Open the equipment detail page
      navigate(`/app/hv?equipment=${id}`);
    } catch (err) {
      console.error("Erreur création équipement HV:", err);
      alert("Erreur lors de la création de l'équipement HV");
    } finally {
      creatingRef.current = false;
      setCreateMode(false);
    }
  };

  const askDeletePosition = (position) => {
    setContextMenu(null);
    setConfirmState({ open: true, position });
  };

  const handleDeletePosition = async (position) => {
    try {
      await api.hvMaps.deletePosition(position.id);
      const positions = await refreshPositions(stableSelectedPlan, pageIndex);
      setInitialPoints(positions || []);
      await refreshPlacedIds();
      setSelectedPosition(null);
      setConfirmState({ open: false, position: null });
    } catch (err) {
      console.error("Erreur suppression position:", err);
    }
  };

  const handleZipUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.hvMaps.uploadZip(file);
      await loadPlans();
    } catch (err) {
      console.error("Erreur upload ZIP:", err);
    }
    e.target.value = "";
  };

  // Filter equipments
  const filteredEquipments = useMemo(() => {
    let list = equipments;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(eq =>
        eq.name?.toLowerCase().includes(q) ||
        eq.code?.toLowerCase().includes(q) ||
        eq.building_code?.toLowerCase().includes(q) ||
        eq.room?.toLowerCase().includes(q)
      );
    }

    if (filterMode === "placed") {
      list = list.filter(eq => placedIds.has(eq.id));
    } else if (filterMode === "unplaced") {
      list = list.filter(eq => !placedIds.has(eq.id));
    }

    return list;
  }, [equipments, searchQuery, filterMode, placedIds]);

  // Check if equipment is placed on current plan
  const isPlacedHere = (equipmentId) => {
    return initialPoints.some(p => p.equipment_id === equipmentId);
  };

  const stats = useMemo(() => ({
    total: equipments.length,
    placed: equipments.filter(e => placedIds.has(e.id)).length,
    unplaced: equipments.filter(e => !placedIds.has(e.id)).length,
  }), [equipments, placedIds]);

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-100%); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes flash-marker {
          0%, 100% {
            transform: scale(1);
            filter: brightness(1);
          }
          25% {
            transform: scale(1.3);
            filter: brightness(1.3);
          }
          50% {
            transform: scale(1);
            filter: brightness(1);
          }
          75% {
            transform: scale(1.3);
            filter: brightness(1.3);
          }
        }
        @keyframes pulse-selected {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
          }
          50% {
            transform: scale(1.15);
            box-shadow: 0 0 0 8px rgba(245, 158, 11, 0);
          }
        }
        .animate-slideUp { animation: slideUp .3s ease-out forwards; }
        .animate-scaleIn { animation: scaleIn .3s ease-out forwards; }
        .animate-slideRight { animation: slideRight .25s ease-out forwards; }
        .animate-fadeIn { animation: fadeIn .2s ease-out forwards; }
        .hv-marker-flash > div {
          animation: flash-marker 2s ease-in-out;
        }
        .hv-marker-selected > div {
          animation: pulse-selected 1.5s ease-in-out infinite;
        }
        .hv-marker-inline { background: transparent !important; border: none !important; }

        /* Mobile safe area support */
        .safe-area-inset-top { padding-top: env(safe-area-inset-top, 0); }
        .safe-area-inset-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }

        /* Smooth scrolling for equipment list */
        .overscroll-contain { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/app/hv')}
              className="p-2 rounded-lg hover:bg-gray-100 transition"
              title="Retour HV"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-100 rounded-xl">
                <MapPin size={18} className="text-amber-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Localisation HV</h1>
                <p className="text-xs text-gray-500">Placez / déplacez les équipements sur les plans</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Stats badges */}
            <div className="flex items-center gap-1 text-xs">
              <Badge variant="default">Total: {stats.total}</Badge>
              <Badge variant="success">Localisés: {stats.placed}</Badge>
              <Badge variant="warning">Non localisés: {stats.unplaced}</Badge>
            </div>

            {/* Import button */}
            <button
              onClick={() => zipInputRef.current?.click()}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
              title="Importer un ZIP"
            >
              <Upload size={14} />
              <span className="hidden sm:inline">Import</span>
            </button>
            <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleZipUpload} />

            {/* Toggle sidebar */}
            <Btn
              variant="ghost"
              onClick={() => setShowSidebar(!showSidebar)}
              className="flex items-center gap-2"
            >
              <Zap size={16} />
              {showSidebar ? "Masquer" : "Afficher"} liste
            </Btn>
          </div>
        </div>

        {/* Plan selector */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <select
            value={selectedPlan?.logical_name || ""}
            onChange={async (e) => {
              const plan = plans.find(p => p.logical_name === e.target.value);
              if (plan) {
                setSelectedPlan(plan);
                setPageIndex(0);
                setPdfReady(false);
                const positions = await refreshPositions(plan, 0);
                setInitialPoints(positions || []);
              }
            }}
            className="flex-1 min-w-0 px-3 py-2 border rounded-xl text-sm bg-white focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          >
            {plans.length === 0 && <option value="">Aucun plan disponible</option>}
            {plans.map(p => (
              <option key={p.logical_name} value={p.logical_name}>
                {p.display_name || p.logical_name}
              </option>
            ))}
          </select>

          {numPages > 1 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Btn variant="ghost" disabled={pageIndex === 0} onClick={() => setPageIndex(i => i - 1)} className="p-2">
                <ChevronLeft size={16} />
              </Btn>
              <span className="text-sm text-gray-600 min-w-[3rem] text-center">{pageIndex + 1}/{numPages}</span>
              <Btn variant="ghost" disabled={pageIndex >= numPages - 1} onClick={() => setPageIndex(i => i + 1)} className="p-2">
                <ChevronRight size={16} />
              </Btn>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        {showSidebar && (
          <div className="w-full max-w-[360px] bg-white border-r shadow-sm flex flex-col animate-slideRight z-10">
            <div className="p-3 border-b space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <Input
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Rechercher un équipement..."
                  className="pl-8"
                />
              </div>
              <div className="flex gap-2">
                <Btn variant={filterMode === "all" ? "subtle" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("all")}>
                  Tous
                </Btn>
                <Btn variant={filterMode === "placed" ? "subtle" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("placed")}>
                  Placés
                </Btn>
                <Btn variant={filterMode === "unplaced" ? "subtle" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("unplaced")}>
                  Non placés
                </Btn>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingEquipments ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-amber-500" />
                </div>
              ) : filteredEquipments.length === 0 ? (
                <EmptyState icon={Zap} title="Aucun équipement" description="Créez des équipements HV pour les placer sur le plan" />
              ) : (
                filteredEquipments.map(eq => (
                  <HvCard
                    key={eq.id}
                    equipment={eq}
                    isPlacedHere={isPlacedHere(eq.id)}
                    isPlacedSomewhere={placedIds.has(eq.id)}
                    isPlacedElsewhere={placedIds.has(eq.id) && !isPlacedHere(eq.id)}
                    isSelected={selectedEquipmentId === eq.id}
                    onClick={() => {
                      const pos = initialPoints.find(p => p.equipment_id === eq.id);
                      if (pos) {
                        setSelectedPosition(pos);
                        setSelectedEquipment(eq);
                        viewerRef.current?.highlightMarker(eq.id);
                      }
                    }}
                    onPlace={(equipment) => setPlacementMode(equipment)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Map */}
        <div className="flex-1 flex flex-col relative">
          {!selectedPlan ? (
            <EmptyState
              icon={MapPin}
              title="Aucun plan sélectionné"
              description="Importez un fichier ZIP contenant des plans PDF"
              action={
                <Btn onClick={() => zipInputRef.current?.click()}>
                  <Upload size={16} className="mr-2" />
                  Importer des plans
                </Btn>
              }
            />
          ) : (
            <>
              {!pdfReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20">
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw size={32} className="animate-spin text-amber-500" />
                    <span className="text-sm text-gray-600">Chargement du plan...</span>
                  </div>
                </div>
              )}

              <HvLeafletViewer
                ref={viewerRef}
                key={selectedPlan.logical_name}
                fileUrl={stableFileUrl}
                pageIndex={pageIndex}
                initialPoints={initialPoints}
                selectedId={selectedEquipmentId}
                onReady={() => setPdfReady(true)}
                onMovePoint={async (equipmentId, xy) => {
                  if (!stableSelectedPlan) return;
                  await api.hvMaps.setPosition(equipmentId, {
                    logical_name: stableSelectedPlan.logical_name,
                    plan_id: stableSelectedPlan.id,
                    page_index: pageIndex,
                    x_frac: xy.x,
                    y_frac: xy.y,
                  });
                  const positions = await refreshPositions(stableSelectedPlan, pageIndex);
                  setInitialPoints(positions || []);
                }}
                onClickPoint={(meta) => {
                  const eq = equipments.find(e => e.id === meta.equipment_id);
                  setSelectedPosition(meta);
                  setSelectedEquipment(eq || null);
                }}
                onCreatePoint={(xFrac, yFrac) => {
                  if (createMode) {
                    createEquipmentAtFrac(xFrac, yFrac);
                  } else if (placementMode) {
                    handleSetPosition(placementMode, xFrac, yFrac);
                  }
                }}
                onContextMenu={(meta, pos) => setContextMenu({ position: meta, x: pos.x, y: pos.y })}
                placementActive={!!placementMode || createMode}
              />

              {/* Floating toolbar inside Leaflet */}
              <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-[5000] flex flex-col gap-2">
                <button
                  onClick={() => {
                    setCreateMode(true);
                    setPlacementMode(null);
                    setSelectedPosition(null);
                    setSelectedEquipment(null);
                  }}
                  disabled={createMode}
                  className="w-11 h-11 sm:w-10 sm:h-10 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-xl border-none bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg cursor-pointer text-lg flex items-center justify-center transition-all hover:from-amber-400 hover:to-orange-500 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ touchAction: 'manipulation' }}
                  title="Créer un nouvel équipement HV"
                >
                  <Plus size={20} />
                </button>
              </div>
            </>
          )}

          {/* Placement mode indicator */}
          {placementMode && (
            <PlacementModeIndicator equipment={placementMode} onCancel={() => setPlacementMode(null)} />
          )}

          {/* Create mode indicator - Mobile optimized */}
          {createMode && (
            <div className="absolute bottom-4 sm:bottom-6 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 animate-slideUp">
              <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-blue-600 text-white rounded-2xl shadow-xl">
                <Crosshair size={20} className="animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm sm:text-base">Mode création</p>
                  <p className="text-xs text-blue-200 truncate">Touchez le plan pour créer un équipement</p>
                </div>
                <button
                  onClick={() => setCreateMode(false)}
                  className="p-2.5 hover:bg-white/20 rounded-lg transition-colors active:scale-95"
                  style={{ touchAction: 'manipulation' }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Detail panel */}
          {selectedPosition && !placementMode && !createMode && (
            <DetailPanel
              position={selectedPosition}
              equipment={selectedEquipment}
              onClose={() => { setSelectedPosition(null); setSelectedEquipment(null); }}
              onNavigate={(id) => navigate(`/app/hv?equipment=${id}`)}
              onDelete={askDeletePosition}
            />
          )}

          {/* Context menu */}
          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onDelete={() => askDeletePosition(contextMenu.position)}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>
      </div>

      {/* Confirm modal */}
      <ConfirmModal
        open={confirmState.open}
        title="Détacher du plan"
        message={`Voulez-vous retirer "${confirmState.position?.name || "cet équipement"}" du plan ?`}
        confirmText="Détacher"
        onConfirm={() => handleDeletePosition(confirmState.position)}
        onCancel={() => setConfirmState({ open: false, position: null })}
        danger
      />
    </div>
  );
}
