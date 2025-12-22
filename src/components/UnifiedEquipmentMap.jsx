// src/components/UnifiedEquipmentMap.jsx
// Unified floor plan viewer with multi-equipment markers colored by control status
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useNavigate } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";

// PDF.js
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

// Leaflet
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Mobile optimization
import { getOptimalImageFormat } from "../config/mobile-optimization.js";

// Icons
import {
  Search,
  ChevronLeft,
  ChevronRight,
  MapPin,
  X,
  RefreshCw,
  ExternalLink,
  ArrowLeft,
  Filter,
  Zap,
  Cpu,
  Wrench,
  Battery,
  AlertTriangle,
  Clock,
  CheckCircle,
  Calendar,
} from "lucide-react";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ----------------------------- Constants ----------------------------- */
const STORAGE_KEY_PLAN = "unified_map_selected_plan";
const STORAGE_KEY_PAGE = "unified_map_page_index";

// Equipment type configuration
const EQUIPMENT_TYPES = {
  switchboard: {
    label: "Tableaux",
    icon: Zap,
    color: "#f59e0b", // amber
    gradient: "radial-gradient(circle at 30% 30%, #facc15, #f59e0b)", // amber gradient like Switchboard_map
    api: api.switchboardMaps,
    link: (id) => `/app/switchboards?board=${id}`,
    mapLink: (id, plan) => `/app/switchboards/map?board=${id}&plan=${plan}`,
  },
  vsd: {
    label: "Variateurs",
    icon: Cpu,
    color: "#10b981", // emerald
    gradient: "radial-gradient(circle at 30% 30%, #34d399, #059669)", // emerald gradient like Vsd_map
    api: api.vsdMaps,
    link: (id) => `/app/vsd?vsd=${id}`,
    mapLink: (id, plan) => `/app/vsd/map?vsd=${id}&plan=${plan}`,
  },
  meca: {
    label: "Méca",
    icon: Wrench,
    color: "#3b82f6", // blue
    gradient: "radial-gradient(circle at 30% 30%, #3b82f6, #2563eb)", // blue gradient like Meca_map
    api: api.mecaMaps,
    link: (id) => `/app/meca?meca=${id}`,
    mapLink: (id, plan) => `/app/meca/map?meca=${id}&plan=${plan}`,
  },
  mobile: {
    label: "Mobiles",
    icon: Cpu,
    color: "#06b6d4", // cyan (like MobileEquipments_map from-cyan-400 to-blue-600)
    gradient: "linear-gradient(to bottom right, #22d3ee, #2563eb)", // cyan-to-blue like MobileEquipments_map
    api: api.mobileEquipment?.maps,
    link: (id) => `/app/mobile-equipments?equipment=${id}`,
    mapLink: (id, plan) => `/app/mobile-equipments/map?equipment=${id}&plan=${plan}`,
  },
  hv: {
    label: "Haute Tension",
    icon: Zap,
    color: "#f59e0b", // amber (same as HV map default)
    gradient: "radial-gradient(circle at 30% 30%, #f59e0b, #ea580c)", // amber/orange like High_voltage_map
    api: api.hvMaps,
    link: (id) => `/app/hv?equipment=${id}`,
    mapLink: (id, plan) => `/app/hv/map?equipment=${id}&plan=${plan}`,
  },
  glo: {
    label: "GLO",
    icon: Battery,
    color: "#34d399", // emerald (like Glo_map)
    gradient: "radial-gradient(circle at 30% 30%, #34d399, #059669)", // emerald gradient like Glo_map
    api: api.gloMaps,
    link: (id) => `/app/glo?glo=${id}`,
    mapLink: (id, plan) => `/app/glo/map?glo=${id}&plan=${plan}`,
  },
};

// Control status colors with gradients matching individual map pages
const STATUS_COLORS = {
  overdue: {
    bg: "radial-gradient(circle at 30% 30%, #ef4444, #dc2626)",
    border: "#dc2626",
    pulse: true
  }, // Red - en retard
  upcoming: {
    bg: "radial-gradient(circle at 30% 30%, #f59e0b, #d97706)",
    border: "#d97706",
    pulse: false
  }, // Amber - à venir (30 days)
  pending: {
    bg: "radial-gradient(circle at 30% 30%, #3b82f6, #2563eb)",
    border: "#2563eb",
    pulse: false
  }, // Blue - planifié
  done: {
    bg: "radial-gradient(circle at 30% 30%, #10b981, #059669)",
    border: "#059669",
    pulse: false
  }, // Green - fait
  none: {
    bg: "radial-gradient(circle at 30% 30%, #6b7280, #4b5563)",
    border: "#4b5563",
    pulse: false
  }, // Gray - pas de contrôle
  selected: {
    bg: "radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed)",
    border: "white",
    pulse: false
  }, // Purple - sélectionné
};

/* ----------------------------- Helpers ----------------------------- */
function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function getIdentity() {
  let email = getCookie("email") || null;
  let name = getCookie("name") || null;
  try {
    if (!email) email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    if (!name) name = localStorage.getItem("name") || localStorage.getItem("user.name") || null;
  } catch {}
  return { email, name };
}

function userHeaders() {
  const { email, name } = getIdentity();
  const h = {};
  if (email) h["X-User-Email"] = email;
  if (name) h["X-User-Name"] = name;
  return h;
}

function pdfDocOpts(url) {
  return {
    url,
    withCredentials: true,
    httpHeaders: userHeaders(),
    standardFontDataUrl: "/standard_fonts/",
  };
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ----------------------------- UI Components ----------------------------- */
const AnimatedCard = ({ children, delay = 0, className = "" }) => (
  <div
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards" }}
  >
    {children}
  </div>
);

const Badge = ({ children, variant = "default", className = "" }) => {
  const variants = {
    default: "bg-gray-100 text-gray-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
    purple: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

const EmptyState = ({ icon: Icon, title, description }) => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
      <Icon size={32} className="text-gray-400" />
    </div>
    <h3 className="text-lg font-medium text-gray-700">{title}</h3>
    {description && <p className="text-gray-500 mt-1 max-w-sm">{description}</p>}
  </div>
);

function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-orange-600 text-white hover:bg-orange-700 shadow-sm disabled:opacity-50",
    ghost: "bg-white text-black border hover:bg-gray-50 disabled:opacity-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50",
  };
  return (
    <button className={`px-3 py-2 rounded-lg text-sm transition ${map[variant] || map.primary} ${className}`} {...p}>
      {children}
    </button>
  );
}

/* ----------------------------- Control Status Badge ----------------------------- */
const ControlStatusBadge = ({ status }) => {
  const config = {
    overdue: { label: "En retard", variant: "danger", icon: AlertTriangle },
    upcoming: { label: "À venir", variant: "warning", icon: Clock },
    pending: { label: "Planifié", variant: "info", icon: Calendar },
    done: { label: "Fait", variant: "success", icon: CheckCircle },
    none: { label: "Non planifié", variant: "default", icon: null },
  };
  const { label, variant, icon: Icon } = config[status] || config.none;
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {Icon && <Icon size={12} />}
      {label}
    </Badge>
  );
};

/* ----------------------------- Detail Panel ----------------------------- */
const DetailPanel = ({ position, onClose, onNavigate }) => {
  if (!position) return null;

  const typeConfig = EQUIPMENT_TYPES[position.equipment_type] || {};
  const TypeIcon = typeConfig.icon || MapPin;

  return (
    <AnimatedCard className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white rounded-2xl shadow-2xl border overflow-hidden z-30">
      <div
        className="p-4 text-white"
        style={{ background: `linear-gradient(135deg, ${typeConfig.color || '#6b7280'}, ${typeConfig.color || '#6b7280'}dd)` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <TypeIcon size={20} />
            </div>
            <div>
              <h3 className="font-bold">{position.name || position.code || `Équipement #${position.equipment_id}`}</h3>
              <p className="text-white/80 text-sm">{typeConfig.label}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Statut contrôle</span>
          <ControlStatusBadge status={position.control_status || "none"} />
        </div>

        {position.next_due_date && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Prochaine échéance</span>
            <span className="font-medium">{new Date(position.next_due_date).toLocaleDateString('fr-FR')}</span>
          </div>
        )}

        {position.building && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Bâtiment</span>
            <span className="font-medium">{position.building}</span>
          </div>
        )}

        <div className="text-xs text-gray-400 flex items-center gap-2">
          <MapPin size={12} />
          Position: {(position.x_frac * 100).toFixed(1)}%, {(position.y_frac * 100).toFixed(1)}%
        </div>

        <button
          onClick={() => onNavigate(position)}
          className="w-full py-2.5 px-4 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-xl font-medium hover:from-orange-600 hover:to-amber-700 transition-all flex items-center justify-center gap-2"
        >
          <ExternalLink size={16} />
          Ouvrir l'équipement
        </button>
      </div>
    </AnimatedCard>
  );
};

/* ----------------------------- Leaflet Viewer ----------------------------- */
const UnifiedLeafletViewer = forwardRef(({
  fileUrl,
  pageIndex = 0,
  allPositions = [],
  selectedId = null,
  selectedType = null,
  controlStatuses = {},
  visibleTypes = [],
  onReady,
  onClickPoint,
  disabled = false,
}, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const markersMapRef = useRef(new Map());

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);

  const positionsRef = useRef(allPositions);
  const selectedIdRef = useRef(selectedId);
  const selectedTypeRef = useRef(selectedType);
  const controlStatusesRef = useRef(controlStatuses);
  const visibleTypesRef = useRef(visibleTypes);
  const aliveRef = useRef(true);

  const lastViewRef = useRef({ center: [0, 0], zoom: 0 });
  const initialFitDoneRef = useRef(false);
  const userViewTouchedRef = useRef(false);
  const lastJob = useRef({ key: null });

  const ICON_PX = 22;
  const ICON_PX_SELECTED = 30;

  useEffect(() => { selectedIdRef.current = selectedId; selectedTypeRef.current = selectedType; }, [selectedId, selectedType]);
  useEffect(() => { controlStatusesRef.current = controlStatuses; }, [controlStatuses]);
  useEffect(() => { visibleTypesRef.current = visibleTypes; }, [visibleTypes]);

  useEffect(() => {
    if (mapRef.current && imgSize.w > 0) {
      drawMarkers(positionsRef.current, imgSize.w, imgSize.h);
    }
  }, [selectedId, selectedType, controlStatuses, visibleTypes]);

  function makeIcon(equipmentType, isSelected = false, controlStatus = "none") {
    const s = isSelected ? ICON_PX_SELECTED : ICON_PX;
    const typeConfig = EQUIPMENT_TYPES[equipmentType] || {};
    const statusConfig = STATUS_COLORS[controlStatus] || STATUS_COLORS.none;

    // Determine background: selected > control status > equipment type default
    let bgGradient;
    let borderColor;
    let shouldPulse = false;
    let animClass = "";

    if (isSelected) {
      bgGradient = STATUS_COLORS.selected.bg;
      borderColor = "white";
      animClass = "unified-marker-selected";
    } else if (controlStatus !== "none" && STATUS_COLORS[controlStatus]) {
      bgGradient = statusConfig.bg;
      borderColor = statusConfig.border;
      shouldPulse = statusConfig.pulse;
      if (shouldPulse) animClass = "unified-marker-overdue";
    } else {
      bgGradient = typeConfig.gradient || `radial-gradient(circle at 30% 30%, ${typeConfig.color}, ${typeConfig.color})`;
      borderColor = "white";
    }

    // Get icon SVG based on equipment type
    const iconSvg = getIconSvg(equipmentType);
    // Switchboard uses 0.55 size, others use 0.5
    const iconSize = equipmentType === "switchboard" ? s * 0.55 : s * 0.5;

    const html = `
      <div class="${animClass}" style="width:${s}px;height:${s}px;background:${bgGradient};border:2px solid ${borderColor};border-radius:9999px;box-shadow:0 4px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;">
        ${iconSvg(iconSize)}
      </div>`;

    return L.divIcon({
      className: "unified-marker-inline",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
      popupAnchor: [0, -Math.round(s / 2)],
    });
  }

  function getIconSvg(equipmentType) {
    const svgs = {
      // Switchboard: filled lightning bolt (h7)
      switchboard: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>`,
      // VSD: CPU/chip icon (electronic component - same as mobile)
      vsd: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>`,
      // Meca: sun/gear with radiating lines
      meca: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="white" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3" fill="white"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`,
      // Mobile: CPU/chip icon (electronic component)
      mobile: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>`,
      // HV: outlined lightning polygon
      hv: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
      // GLO: battery icon
      glo: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="6" width="18" height="12" rx="2"/><path d="M23 10v4"/><path d="M7 10v4M11 10v4"/></svg>`,
    };
    return svgs[equipmentType] || svgs.switchboard;
  }

  const drawMarkers = useCallback((list, w, h) => {
    const map = mapRef.current;
    const g = markersLayerRef.current;
    if (!map || !g || w === 0 || h === 0) return;

    positionsRef.current = list;
    g.clearLayers();
    markersMapRef.current.clear();

    (list || []).forEach((p) => {
      // Filter by visible types
      if (!visibleTypesRef.current.includes(p.equipment_type)) return;

      const x = Number(p.x_frac ?? 0) * w;
      const y = Number(p.y_frac ?? 0) * h;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const latlng = L.latLng(y, x);
      const isSelected = p.equipment_id === selectedIdRef.current && p.equipment_type === selectedTypeRef.current;
      const controlStatus = controlStatusesRef.current[`${p.equipment_type}_${p.equipment_id}`] || "none";
      const icon = makeIcon(p.equipment_type, isSelected, controlStatus);

      const mk = L.marker(latlng, {
        icon,
        draggable: false,
        autoPan: true,
        bubblingMouseEvents: false,
        riseOnHover: true,
      });

      mk.__meta = {
        id: p.id,
        equipment_id: p.equipment_id,
        equipment_type: p.equipment_type,
        name: p.name || p.code,
        code: p.code,
        x_frac: p.x_frac,
        y_frac: p.y_frac,
        building: p.building,
        control_status: controlStatus,
        next_due_date: p.next_due_date,
      };

      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setPicker(null);
        // Get fresh control status at click time (not stale from marker creation)
        const freshStatus = controlStatusesRef.current[`${p.equipment_type}_${p.equipment_id}`] || "none";
        onClickPoint?.({
          ...mk.__meta,
          control_status: freshStatus
        });
      });

      mk.addTo(g);
      markersMapRef.current.set(`${p.equipment_type}_${p.equipment_id}`, mk);
    });
  }, [onClickPoint]);

  const highlightMarker = useCallback((equipmentId, equipmentType) => {
    const key = `${equipmentType}_${equipmentId}`;
    const mk = markersMapRef.current.get(key);
    if (!mk || !mapRef.current) return;

    const ll = mk.getLatLng();
    mapRef.current.setView(ll, mapRef.current.getZoom(), { animate: true });

    const el = mk.getElement();
    if (el) {
      el.classList.add("unified-marker-flash");
      setTimeout(() => el.classList.remove("unified-marker-flash"), 2000);
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

    (async () => {
      try {
        const containerW = Math.max(320, wrapRef.current.clientWidth || 1024);
        const dpr = window.devicePixelRatio || 1;

        const pdf = await pdfjsLib.getDocument(pdfDocOpts(fileUrl)).promise;
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

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        const dataUrl = getOptimalImageFormat(canvas);
        setImgSize({ w: canvas.width, h: canvas.height });

        const m = L.map(wrapRef.current, {
          crs: L.CRS.Simple,
          zoomControl: false,
          zoomAnimation: true,
          fadeAnimation: false,
          scrollWheelZoom: true,
          touchZoom: true,
          tap: false,
          preferCanvas: true,
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
        m.fitBounds(bounds, { padding: [8, 8] });
        m.setMaxZoom(fitZoom + 6);
        m.setMaxBounds(bounds.pad(0.5));
        initialFitDoneRef.current = true;

        markersLayerRef.current = L.layerGroup().addTo(m);

        m.on("click", () => setPicker(null));
        m.on("zoomstart", () => { setPicker(null); userViewTouchedRef.current = true; });
        m.on("movestart", () => { setPicker(null); userViewTouchedRef.current = true; });
        m.on("zoomend", () => { lastViewRef.current.zoom = m.getZoom(); });
        m.on("moveend", () => { lastViewRef.current.center = m.getCenter(); });

        drawMarkers(positionsRef.current, canvas.width, canvas.height);
        try { await pdf.cleanup(); } catch {}
        onReady?.();
      } catch (e) {
        if (String(e?.name) === "RenderingCancelledException") return;
        console.error("Unified map viewer error", e);
      }
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      cleanupMap();
    };
  }, [fileUrl, pageIndex, disabled]);

  useEffect(() => {
    positionsRef.current = allPositions;
    if (mapRef.current && imgSize.w > 0) {
      drawMarkers(allPositions, imgSize.w, imgSize.h);
    }
  }, [allPositions, drawMarkers, imgSize.w, imgSize.h]);

  const adjust = () => {
    const m = mapRef.current;
    const layer = imageLayerRef.current;
    if (!m || !layer) return;
    const b = layer.getBounds();
    m.invalidateSize(false);
    m.fitBounds(b, { padding: [8, 8] });
    lastViewRef.current.center = m.getCenter();
    lastViewRef.current.zoom = m.getZoom();
    initialFitDoneRef.current = true;
    userViewTouchedRef.current = false;
  };

  useImperativeHandle(ref, () => ({
    adjust,
    drawMarkers: (list) => drawMarkers(list, imgSize.w, imgSize.h),
    highlightMarker,
  }));

  return (
    <div className="relative flex-1 flex flex-col">
      <div className="flex items-center justify-end gap-2 p-2 border-b bg-white">
        <Btn variant="ghost" onClick={adjust}>Ajuster</Btn>
      </div>

      <div ref={wrapRef} className="flex-1 w-full bg-gray-100" style={{ minHeight: 400 }} />

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 p-2 text-xs text-gray-600 border-t bg-white">
        <span className="font-medium text-gray-700">Statuts:</span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS.overdue.bg }} />
          En retard
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS.upcoming.bg }} />
          À venir
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS.done.bg }} />
          Fait
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS.none.bg }} />
          Non planifié
        </span>
      </div>
    </div>
  );
});

/* ----------------------------- Main Component ----------------------------- */
export default function UnifiedEquipmentMap({
  title = "Plan Centralisé",
  subtitle = "Vue unifiée des équipements",
  backLink = "/app/switchboard-controls",
  initialVisibleTypes = ["switchboard", "vsd", "meca", "mobile", "hv", "glo"],
  showTypeFilters = true,
}) {
  const navigate = useNavigate();

  // Plans
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Positions from all equipment types
  const [allPositions, setAllPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);

  // Control statuses for all equipment
  const [controlStatuses, setControlStatuses] = useState({});

  // Filters
  const [visibleTypes, setVisibleTypes] = useState(initialVisibleTypes);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all, overdue, upcoming

  // UI
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const viewerRef = useRef(null);

  // Get file URL for selected plan
  const stableFileUrl = useMemo(() => {
    if (!selectedPlan) return null;
    // Use VSD maps API as the primary source since VSD has the most complete plan set
    return api.vsdMaps.planFileUrlAuto(selectedPlan, { bust: true });
  }, [selectedPlan]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) setShowSidebar(false);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Load plans from VSD (primary source)
  useEffect(() => {
    loadPlans();
    loadControlStatuses();
  }, []);

  const loadPlans = async () => {
    setLoadingPlans(true);
    try {
      const res = await api.vsdMaps.listPlans();
      const planList = res?.plans || res || [];
      setPlans(planList);

      // Restore from localStorage or select first
      const savedPlanKey = localStorage.getItem(STORAGE_KEY_PLAN);
      const savedPageIndex = localStorage.getItem(STORAGE_KEY_PAGE);

      let planToSelect = planList.find(p => p.logical_name === savedPlanKey) || planList[0];
      if (planToSelect) {
        setSelectedPlan(planToSelect);
        setPageIndex(savedPageIndex ? Number(savedPageIndex) : 0);
      }
    } catch (err) {
      console.error("Error loading plans:", err);
    } finally {
      setLoadingPlans(false);
    }
  };

  // Load control statuses from API - fetch all schedules to get accurate statuses
  const loadControlStatuses = async () => {
    try {
      // Fetch all schedules to get complete control status for all equipment
      const schedulesRes = await api.switchboardControls.listSchedules();
      const schedules = schedulesRes?.schedules || [];
      const statuses = {};
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      schedules.forEach(item => {
        const key = getEquipmentKey(item);
        if (!key) return;

        const nextDue = item.next_due_date ? new Date(item.next_due_date) : null;
        if (!nextDue) return;

        // Determine status based on due date
        let status;
        if (nextDue < now) {
          status = "overdue";
        } else if (nextDue <= thirtyDaysFromNow) {
          status = "upcoming";
        } else {
          status = "pending";
        }

        // Keep the most urgent status (overdue > upcoming > pending)
        if (!statuses[key] ||
            (status === "overdue") ||
            (status === "upcoming" && statuses[key] !== "overdue")) {
          statuses[key] = status;
        }
      });

      setControlStatuses(statuses);
    } catch (err) {
      console.error("Error loading control statuses:", err);
    }
  };

  function getEquipmentKey(item) {
    if (item.switchboard_id) return `switchboard_${item.switchboard_id}`;
    if (item.vsd_equipment_id) return `vsd_${item.vsd_equipment_id}`;
    if (item.meca_equipment_id) return `meca_${item.meca_equipment_id}`;
    if (item.mobile_equipment_id) return `mobile_${item.mobile_equipment_id}`;
    if (item.hv_equipment_id) return `hv_${item.hv_equipment_id}`;
    if (item.glo_equipment_id) return `glo_${item.glo_equipment_id}`;
    return null;
  }

  // Load positions for current plan from all equipment types
  useEffect(() => {
    if (!selectedPlan) return;
    loadAllPositions(selectedPlan, pageIndex);
    localStorage.setItem(STORAGE_KEY_PLAN, selectedPlan.logical_name);
    localStorage.setItem(STORAGE_KEY_PAGE, String(pageIndex));
  }, [selectedPlan, pageIndex]);

  const loadAllPositions = async (plan, page) => {
    setLoadingPositions(true);
    const allPos = [];
    const key = plan.logical_name || plan.id;

    // Load positions from each equipment type in parallel
    const loaders = [
      { type: "switchboard", api: api.switchboardMaps },
      { type: "vsd", api: api.vsdMaps },
      { type: "meca", api: api.mecaMaps },
      { type: "glo", api: api.gloMaps },
      { type: "hv", api: api.hvMaps },
      { type: "mobile", api: api.mobileEquipment?.maps },
    ];

    // Map type to the correct ID field name from API
    // Switchboard uses switchboard_id, all other types use equipment_id
    const getEquipmentIdFromPosition = (type, p) => {
      if (type === "switchboard") return p.switchboard_id;
      return p.equipment_id || p.id;
    };

    const results = await Promise.allSettled(
      loaders.map(async ({ type, api: mapApi }) => {
        if (!mapApi?.positionsAuto && !mapApi?.positions) return [];
        try {
          const fetcher = mapApi.positionsAuto || mapApi.positions;
          const res = await fetcher(key, page);
          return (res?.positions || []).map(p => ({
            ...p,
            equipment_type: type,
            equipment_id: getEquipmentIdFromPosition(type, p),
          }));
        } catch {
          return [];
        }
      })
    );

    results.forEach(result => {
      if (result.status === "fulfilled") {
        allPos.push(...result.value);
      }
    });

    setAllPositions(allPos);
    setLoadingPositions(false);
  };

  // Filter positions based on search and status
  const filteredPositions = useMemo(() => {
    let filtered = allPositions.filter(p => visibleTypes.includes(p.equipment_type));

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.building || "").toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter(p => {
        const status = controlStatuses[`${p.equipment_type}_${p.equipment_id}`] || "none";
        if (statusFilter === "overdue") return status === "overdue";
        if (statusFilter === "upcoming") return status === "upcoming" || status === "overdue";
        return true;
      });
    }

    return filtered;
  }, [allPositions, visibleTypes, searchQuery, statusFilter, controlStatuses]);

  // Stats
  const stats = useMemo(() => {
    const overdueCount = allPositions.filter(p =>
      controlStatuses[`${p.equipment_type}_${p.equipment_id}`] === "overdue"
    ).length;
    const upcomingCount = allPositions.filter(p =>
      controlStatuses[`${p.equipment_type}_${p.equipment_id}`] === "upcoming"
    ).length;

    return {
      total: allPositions.length,
      overdue: overdueCount,
      upcoming: upcomingCount,
      byType: Object.keys(EQUIPMENT_TYPES).reduce((acc, type) => {
        acc[type] = allPositions.filter(p => p.equipment_type === type).length;
        return acc;
      }, {}),
    };
  }, [allPositions, controlStatuses]);

  const handleNavigate = (position) => {
    if (!position) {
      console.warn('Cannot navigate: position is null/undefined');
      return;
    }

    const typeConfig = EQUIPMENT_TYPES[position.equipment_type];

    // Guard against undefined equipment_id to prevent navigation to /undefined pages
    if (typeConfig?.link && position.equipment_id != null) {
      const url = typeConfig.link(position.equipment_id);
      console.log('Navigating to:', url, 'position:', position);
      navigate(url);
    } else {
      console.warn('Cannot navigate: missing equipment_id or type config', {
        equipment_type: position.equipment_type,
        equipment_id: position.equipment_id,
        hasTypeConfig: !!typeConfig,
        hasLink: !!typeConfig?.link,
        position
      });
      // Fallback: try to navigate based on available data
      if (position.equipment_type && position.equipment_id) {
        const fallbackUrls = {
          switchboard: `/app/switchboards?board=${position.equipment_id}`,
          vsd: `/app/vsd?vsd=${position.equipment_id}`,
          meca: `/app/meca?meca=${position.equipment_id}`,
          mobile: `/app/mobile-equipments?equipment=${position.equipment_id}`,
          hv: `/app/hv?equipment=${position.equipment_id}`,
          glo: `/app/glo?glo=${position.equipment_id}`,
        };
        const fallbackUrl = fallbackUrls[position.equipment_type];
        if (fallbackUrl) {
          console.log('Using fallback navigation:', fallbackUrl);
          navigate(fallbackUrl);
        }
      }
    }
  };

  const toggleType = (type) => {
    setVisibleTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes flash-marker {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          25% { transform: scale(1.3); filter: brightness(1.3); }
          50% { transform: scale(1); filter: brightness(1); }
          75% { transform: scale(1.3); filter: brightness(1.3); }
        }
        @keyframes pulse-selected {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.7); }
          50% { transform: scale(1.15); box-shadow: 0 0 0 8px rgba(249, 115, 22, 0); }
        }
        @keyframes blink-overdue {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-slideUp { animation: slideUp .3s ease-out forwards; }
        .unified-marker-flash > div { animation: flash-marker 2s ease-in-out; }
        .unified-marker-selected > div { animation: pulse-selected 1.5s ease-in-out infinite; }
        .unified-marker-overdue > div { animation: blink-overdue 1s ease-in-out infinite; }
        .unified-marker-inline { background: transparent !important; border: none !important; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(backLink)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-orange-100 rounded-xl">
                <MapPin size={20} className="text-orange-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">{title}</h1>
                <p className="text-xs text-gray-500">{subtitle}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs">
              <Badge variant="default">Total: {stats.total}</Badge>
              {stats.overdue > 0 && <Badge variant="danger">En retard: {stats.overdue}</Badge>}
              {stats.upcoming > 0 && <Badge variant="warning">À venir: {stats.upcoming}</Badge>}
            </div>

            {!isMobile && (
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                {showSidebar ? "Masquer filtres" : "Afficher filtres"}
              </button>
            )}
          </div>
        </div>

        {/* Plan selector */}
        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
          <select
            value={selectedPlan?.logical_name || ""}
            onChange={async (e) => {
              const plan = plans.find(p => p.logical_name === e.target.value);
              if (plan) {
                setSelectedPlan(plan);
                setPageIndex(0);
                setPdfReady(false);
              }
            }}
            className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg text-sm bg-white"
          >
            {plans.length === 0 && <option value="">Aucun plan disponible</option>}
            {plans.map(p => (
              <option key={p.logical_name} value={p.logical_name}>
                {p.display_name || p.logical_name}
              </option>
            ))}
          </select>

          {numPages > 1 && (
            <div className="flex items-center gap-1">
              <Btn variant="ghost" disabled={pageIndex === 0} onClick={() => setPageIndex(i => i - 1)}>
                <ChevronLeft size={16} />
              </Btn>
              <span className="text-sm text-gray-600">Page {pageIndex + 1}/{numPages}</span>
              <Btn variant="ghost" disabled={pageIndex >= numPages - 1} onClick={() => setPageIndex(i => i + 1)}>
                <ChevronRight size={16} />
              </Btn>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar - Filters */}
        {showSidebar && !isMobile && (
          <div className="w-72 bg-white border-r shadow-sm flex flex-col z-10">
            <div className="p-3 border-b space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm bg-white text-gray-900"
                />
              </div>

              {/* Status filter */}
              <div className="flex gap-1">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-lg ${statusFilter === "all" ? "bg-orange-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  Tous
                </button>
                <button
                  onClick={() => setStatusFilter("overdue")}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-lg flex items-center justify-center gap-1 ${statusFilter === "overdue" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  <AlertTriangle size={12} />
                  Retard
                </button>
                <button
                  onClick={() => setStatusFilter("upcoming")}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-lg flex items-center justify-center gap-1 ${statusFilter === "upcoming" ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  <Clock size={12} />
                  À venir
                </button>
              </div>
            </div>

            {/* Type filters */}
            {showTypeFilters && (
              <div className="p-3 border-b">
                <h3 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                  <Filter size={12} />
                  Types d'équipements
                </h3>
                <div className="space-y-1">
                  {Object.entries(EQUIPMENT_TYPES).map(([type, config]) => {
                    const Icon = config.icon;
                    const count = stats.byType[type] || 0;
                    const isActive = visibleTypes.includes(type);
                    return (
                      <button
                        key={type}
                        onClick={() => toggleType(type)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                          isActive ? "bg-gray-100" : "opacity-50"
                        }`}
                      >
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: config.color }}
                        >
                          <Icon size={12} className="text-white" />
                        </div>
                        <span className="flex-1 text-left">{config.label}</span>
                        <span className="text-xs text-gray-500">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Equipment list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingPositions ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : filteredPositions.length === 0 ? (
                <EmptyState icon={MapPin} title="Aucun équipement" description="Aucun équipement sur ce plan" />
              ) : (
                filteredPositions.slice(0, 100).map(pos => {
                  const typeConfig = EQUIPMENT_TYPES[pos.equipment_type] || {};
                  const Icon = typeConfig.icon || MapPin;
                  const status = controlStatuses[`${pos.equipment_type}_${pos.equipment_id}`] || "none";
                  const isSelected = selectedPosition?.equipment_id === pos.equipment_id &&
                                    selectedPosition?.equipment_type === pos.equipment_type;

                  return (
                    <div
                      key={`${pos.equipment_type}_${pos.equipment_id}`}
                      onClick={() => {
                        setSelectedPosition({ ...pos, control_status: status });
                        viewerRef.current?.highlightMarker(pos.equipment_id, pos.equipment_type);
                      }}
                      className={`p-2 rounded-xl border cursor-pointer transition-all ${
                        isSelected ? "bg-orange-50 border-orange-300" : "bg-white border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-white shadow-md"
                          style={{ background: typeConfig.gradient || typeConfig.color }}
                        >
                          <Icon size={12} className="text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{pos.name || pos.code || `#${pos.equipment_id}`}</p>
                          <p className="text-xs text-gray-500">{typeConfig.label}</p>
                        </div>
                        <ControlStatusBadge status={status} />
                      </div>
                    </div>
                  );
                })
              )}
              {filteredPositions.length > 100 && (
                <p className="text-xs text-center text-gray-500 py-2">
                  +{filteredPositions.length - 100} autres équipements
                </p>
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
              description="Sélectionnez un plan pour afficher les équipements"
            />
          ) : (
            <>
              {!pdfReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20">
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw size={32} className="animate-spin text-orange-500" />
                    <span className="text-sm text-gray-600">Chargement du plan...</span>
                  </div>
                </div>
              )}

              <UnifiedLeafletViewer
                ref={viewerRef}
                key={selectedPlan.logical_name}
                fileUrl={stableFileUrl}
                pageIndex={pageIndex}
                allPositions={filteredPositions}
                selectedId={selectedPosition?.equipment_id}
                selectedType={selectedPosition?.equipment_type}
                controlStatuses={controlStatuses}
                visibleTypes={visibleTypes}
                onReady={() => setPdfReady(true)}
                onClickPoint={(meta) => {
                  setSelectedPosition(meta);
                }}
              />
            </>
          )}

          {/* Detail panel */}
          {selectedPosition && (
            <DetailPanel
              position={selectedPosition}
              onClose={() => setSelectedPosition(null)}
              onNavigate={handleNavigate}
            />
          )}
        </div>
      </div>

      {/* Mobile sidebar button */}
      {isMobile && (
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="fixed bottom-4 right-4 z-30 w-14 h-14 bg-orange-600 text-white rounded-full shadow-xl flex items-center justify-center"
        >
          <Filter size={24} />
        </button>
      )}

      {/* Mobile sidebar drawer */}
      {isMobile && showSidebar && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col">
            <div className="p-4 border-b bg-gradient-to-r from-orange-500 to-amber-600 text-white flex items-center justify-between">
              <h2 className="font-bold">Filtres</h2>
              <button onClick={() => setShowSidebar(false)} className="p-2 hover:bg-white/20 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-3 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm bg-white text-gray-900"
                />
              </div>

              <div className="flex gap-1">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-lg ${statusFilter === "all" ? "bg-orange-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  Tous
                </button>
                <button
                  onClick={() => setStatusFilter("overdue")}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-lg ${statusFilter === "overdue" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  Retard
                </button>
                <button
                  onClick={() => setStatusFilter("upcoming")}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-lg ${statusFilter === "upcoming" ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  À venir
                </button>
              </div>

              {showTypeFilters && (
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-gray-500">Types d'équipements</h3>
                  {Object.entries(EQUIPMENT_TYPES).map(([type, config]) => {
                    const Icon = config.icon;
                    const count = stats.byType[type] || 0;
                    const isActive = visibleTypes.includes(type);
                    return (
                      <button
                        key={type}
                        onClick={() => toggleType(type)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100" : "opacity-50"}`}
                      >
                        <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: config.color }}>
                          <Icon size={12} className="text-white" />
                        </div>
                        <span className="flex-1 text-left">{config.label}</span>
                        <span className="text-xs text-gray-500">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredPositions.slice(0, 50).map(pos => {
                const typeConfig = EQUIPMENT_TYPES[pos.equipment_type] || {};
                const Icon = typeConfig.icon || MapPin;
                const status = controlStatuses[`${pos.equipment_type}_${pos.equipment_id}`] || "none";

                return (
                  <div
                    key={`${pos.equipment_type}_${pos.equipment_id}`}
                    onClick={() => {
                      setSelectedPosition({ ...pos, control_status: status });
                      viewerRef.current?.highlightMarker(pos.equipment_id, pos.equipment_type);
                      setShowSidebar(false);
                    }}
                    className="p-2 rounded-xl border bg-white border-gray-200 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-md" style={{ background: typeConfig.gradient || typeConfig.color }}>
                        <Icon size={12} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pos.name || pos.code || `#${pos.equipment_id}`}</p>
                      </div>
                      <ControlStatusBadge status={status} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
