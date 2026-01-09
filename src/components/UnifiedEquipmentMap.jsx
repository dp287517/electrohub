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
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";

// PDF.js
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

// Leaflet
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/atex-map.css"; // Styles de netteté pour les plans

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
  Database,
  AlertTriangle,
  Clock,
  CheckCircle,
  Calendar,
  Link2,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";

// Permissions
import { getAllowedEquipmentTypes, canSeeEquipmentType } from "../lib/permissions";

// Measurement tools
import MeasurementTools from "./MeasurementTools";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ----------------------------- Constants ----------------------------- */
const STORAGE_KEY_PLAN = "unified_map_selected_plan";
const STORAGE_KEY_PAGE = "unified_map_page_index";

// Base equipment type configuration (static types only - datahub categories are loaded dynamically)
const BASE_EQUIPMENT_TYPES = {
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
  infrastructure: {
    label: "Infrastructure",
    icon: Database,
    color: "#8b5cf6", // violet
    gradient: "radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed)", // violet gradient like Infrastructure_map
    api: api.infrastructure?.maps,
    link: (id) => `/app/infrastructure?item=${id}`,
    mapLink: (id, plan) => `/app/infrastructure/map?item=${id}&plan=${plan}`,
  },
};

// Helper to create datahub category type config
const createDatahubCategoryType = (category) => ({
  label: category.name,
  icon: Database,
  color: category.color || "#8b5cf6",
  gradient: `radial-gradient(circle at 30% 30%, ${category.color || "#a78bfa"}, ${category.color || "#7c3aed"})`,
  api: api.datahub?.maps,
  link: (id) => `/app/datahub?item=${id}`,
  mapLink: (id, plan) => `/app/datahub?item=${id}&plan=${plan}`,
  isDatahubCategory: true,
  categoryId: category.id,
});

// Control status colors with gradients matching individual map pages
const STATUS_COLORS = {
  overdue: {
    bg: "radial-gradient(circle at 30% 30%, #ef4444, #dc2626)",
    border: "#dc2626",
    pulse: true
  }, // Red - en retard (past due)
  upcoming: {
    bg: "radial-gradient(circle at 30% 30%, #f59e0b, #d97706)",
    border: "#d97706",
    pulse: false
  }, // Amber - legacy, not used in new system
  pending: {
    bg: "radial-gradient(circle at 30% 30%, #3b82f6, #2563eb)",
    border: "#2563eb",
    pulse: false
  }, // Blue - à venir (control due within 60 days)
  done: {
    bg: "radial-gradient(circle at 30% 30%, #10b981, #059669)",
    border: "#059669",
    pulse: false
  }, // Green - contrôlé (next control > 60 days away)
  none: {
    bg: "radial-gradient(circle at 30% 30%, #6b7280, #4b5563)",
    border: "#4b5563",
    pulse: false
  }, // Gray - pas de contrôle planifié
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
const AnimatedCard = React.forwardRef(({ children, delay = 0, className = "", style = {} }, ref) => (
  <div
    ref={ref}
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards", ...style }}
  >
    {children}
  </div>
));

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
    pending: { label: "À venir (60j)", variant: "info", icon: Clock },
    done: { label: "Contrôlé", variant: "success", icon: CheckCircle },
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

/* ----------------------------- Detail Panel with Links ----------------------------- */
const DetailPanel = ({
  position,
  onClose,
  onNavigate,
  equipmentTypes = {},
  links = [],
  linksLoading = false,
  onAddLink,
  onDeleteLink,
  onLinkClick,
  currentPlan,
  currentPageIndex,
  mapContainerRef
}) => {
  const [showAddLink, setShowAddLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef(null);

  // Detect mobile screen
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (!position) return null;

  const typeConfig = equipmentTypes[position.equipment_type] || BASE_EQUIPMENT_TYPES[position.equipment_type] || {};
  const TypeIcon = typeConfig.icon || MapPin;

  // Search for equipment to link
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api.equipmentLinks.search(query, position.equipment_type, position.equipment_id);
      setSearchResults(res?.results || []);
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setSearching(false);
    }
  };

  // Add a link
  const handleAddLink = async (target) => {
    try {
      await onAddLink?.({
        source_type: position.equipment_type,
        source_id: String(position.equipment_id),
        target_type: target.type,
        target_id: String(target.id),
        link_label: 'connected'
      });
      setShowAddLink(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (e) {
      console.error('Add link error:', e);
    }
  };

  // Check if link is on same plan
  const isOnSamePlan = (link) => {
    const eq = link.linkedEquipment;
    return eq?.hasPosition && eq?.plan === currentPlan && (eq?.pageIndex || 0) === currentPageIndex;
  };

  // Calculate panel position beside marker (desktop only)
  const getPanelStyle = () => {
    if (isMobile) return {};
    const markerPos = position?.markerScreenPos;
    if (!markerPos) return {};

    const mapWidth = markerPos.containerWidth;
    const mapHeight = markerPos.containerHeight;
    const mapLeft = markerPos.mapLeft;
    const mapTop = markerPos.mapTop;

    const panelWidth = 280;
    const panelMaxHeight = Math.min(400, mapHeight * 0.8);
    const offset = 20;

    const markerRelativeX = markerPos.x - mapLeft;
    const spaceOnRight = mapWidth - markerRelativeX - offset;
    const spaceOnLeft = markerRelativeX - offset;

    let left;
    if (spaceOnRight >= panelWidth) {
      left = markerPos.x + offset;
    } else if (spaceOnLeft >= panelWidth) {
      left = markerPos.x - panelWidth - offset;
    } else {
      left = mapLeft + Math.max(8, (mapWidth - panelWidth) / 2);
    }

    let top = markerPos.y - panelMaxHeight / 2;
    if (top < mapTop + 8) top = mapTop + 8;
    else if (top + panelMaxHeight > mapTop + mapHeight - 8) top = Math.max(mapTop + 8, mapTop + mapHeight - panelMaxHeight - 8);

    return { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${panelWidth}px`, maxHeight: `${panelMaxHeight}px`, zIndex: 9999 };
  };

  const desktopStyle = getPanelStyle();
  const hasCustomPosition = !isMobile && Object.keys(desktopStyle).length > 0;

  return (
    <AnimatedCard ref={panelRef} className={`bg-white rounded-xl shadow-xl border overflow-hidden flex flex-col ${hasCustomPosition ? '' : 'absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-72 z-30'}`} style={hasCustomPosition ? desktopStyle : {}}>
      <div className="px-3 py-2 text-white flex-shrink-0" style={{ background: `linear-gradient(135deg, ${typeConfig.color || '#6b7280'}, ${typeConfig.color || '#6b7280'}dd)` }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <TypeIcon size={16} />
            <span className="font-medium text-sm truncate">{position.name || position.code || `#${position.equipment_id}`}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0"><X size={16} /></button>
        </div>
      </div>
      <div className="p-2">
        <button onClick={() => onNavigate(position)} className="w-full py-2 px-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5">
          <ExternalLink size={14} />Voir détails
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
  equipmentTypes = {},
  onReady,
  onClickPoint,
  disabled = false,
  links = [],
  selectedPlan = null,
  currentPageIndex = 0,
}, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const connectionsLayerRef = useRef(null);
  const markersMapRef = useRef(new Map());

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);

  const positionsRef = useRef(allPositions);
  const selectedIdRef = useRef(selectedId);
  const selectedTypeRef = useRef(selectedType);
  const controlStatusesRef = useRef(controlStatuses);
  const visibleTypesRef = useRef(visibleTypes);
  const equipmentTypesRef = useRef(equipmentTypes);
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
  useEffect(() => { equipmentTypesRef.current = equipmentTypes; }, [equipmentTypes]);

  useEffect(() => {
    if (mapRef.current && imgSize.w > 0) {
      drawMarkers(positionsRef.current, imgSize.w, imgSize.h);
    }
  }, [selectedId, selectedType, controlStatuses, visibleTypes, equipmentTypes]);

  function makeIcon(equipmentType, isSelected = false, controlStatus = "none", categoryColor = null) {
    const s = isSelected ? ICON_PX_SELECTED : ICON_PX;
    const typeConfig = equipmentTypes[equipmentType] || BASE_EQUIPMENT_TYPES[equipmentType] || {};
    const statusConfig = STATUS_COLORS[controlStatus] || STATUS_COLORS.none;

    // Determine background: selected > control status > category color > equipment type default
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
    } else if (categoryColor) {
      // Use category color for switchboards with categories
      bgGradient = `radial-gradient(circle at 30% 30%, ${categoryColor}cc, ${categoryColor})`;
      borderColor = "white";
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
      // Datahub: database icon
      datahub: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
      // Infrastructure: building icon
      infrastructure: (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 21h18M3 10h18M5 6l7-4 7 4M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>`,
    };
    // Handle dynamic datahub/infrastructure category types (datahub_cat_<uuid>, infrastructure_cat_<uuid>)
    if (equipmentType?.startsWith("datahub_cat_")) {
      return svgs.datahub;
    }
    if (equipmentType?.startsWith("infrastructure_cat_")) {
      return svgs.infrastructure;
    }
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
      // Pass category_color for switchboards with category
      const categoryColor = p.equipment_type === "switchboard" ? p.category_color : null;
      const icon = makeIcon(p.equipment_type, isSelected, controlStatus, categoryColor);

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
        category_id: p.category_id,
        category_name: p.category_name,
        category_color: p.category_color,
      };

      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setPicker(null);
        // Get fresh control status at click time (not stale from marker creation)
        const freshStatus = controlStatusesRef.current[`${p.equipment_type}_${p.equipment_id}`] || "none";

        // Get marker screen position for positioning the detail panel beside it
        const map = mapRef.current;
        let markerScreenPos = null;
        if (map) {
          const containerPoint = map.latLngToContainerPoint(mk.getLatLng());
          const mapContainer = map.getContainer();
          const mapRect = mapContainer.getBoundingClientRect();
          markerScreenPos = {
            x: mapRect.left + containerPoint.x,
            y: mapRect.top + containerPoint.y,
            containerWidth: mapRect.width,
            containerHeight: mapRect.height,
            mapLeft: mapRect.left,
            mapTop: mapRect.top
          };
        }

        onClickPoint?.({
          ...mk.__meta,
          control_status: freshStatus,
          markerScreenPos
        });
      });

      mk.addTo(g);
      markersMapRef.current.set(`${p.equipment_type}_${p.equipment_id}`, mk);
    });
  }, [onClickPoint]);

  // Draw connection lines between linked equipment
  const drawConnections = useCallback(() => {
    const map = mapRef.current;
    const g = connectionsLayerRef.current;
    if (!map || !g) return;

    // Clear existing connections
    g.clearLayers();

    // If no selected equipment or no links, nothing to draw
    if (!selectedIdRef.current || !selectedTypeRef.current || !links.length) return;

    // Get selected marker position
    const selectedKey = `${selectedTypeRef.current}_${selectedIdRef.current}`;
    const selectedMarker = markersMapRef.current.get(selectedKey);
    if (!selectedMarker) return;

    const sourceLatLng = selectedMarker.getLatLng();

    // Draw lines to linked equipment on the same plan
    links.forEach((link) => {
      const eq = link.linkedEquipment;
      if (!eq?.hasPosition) return;

      // Check if on same plan and page
      if (eq.plan !== selectedPlan || (eq.pageIndex || 0) !== currentPageIndex) return;

      // Find the target marker
      const targetKey = `${eq.type}_${eq.id}`;
      const targetMarker = markersMapRef.current.get(targetKey);
      if (!targetMarker) return;

      const targetLatLng = targetMarker.getLatLng();

      // Determine line style based on relationship
      let color = '#3b82f6'; // Blue default
      let dashArray = '8, 6';

      if (link.relationship === 'feeds') {
        color = '#ef4444'; // Red for feeds
        dashArray = '12, 4';
      } else if (link.relationship === 'fed_by') {
        color = '#10b981'; // Green for fed by
        dashArray = '12, 4';
      } else if (link.type === 'hierarchical') {
        color = '#f59e0b'; // Amber for auto hierarchical
        dashArray = '4, 4';
      }

      // Create animated dashed polyline
      const polyline = L.polyline([sourceLatLng, targetLatLng], {
        color,
        weight: 3,
        opacity: 0.8,
        dashArray,
        className: 'equipment-link-line'
      });

      polyline.addTo(g);
    });
  }, [links, selectedPlan, currentPageIndex]);

  // Redraw connections when links or selection changes
  useEffect(() => {
    drawConnections();
  }, [links, selectedId, selectedType, drawConnections]);

  const highlightMarker = useCallback((equipmentId, equipmentType) => {
    // Try to find marker with the ID as-is first, then try with type conversion
    let key = `${equipmentType}_${equipmentId}`;
    let mk = markersMapRef.current.get(key);
    if (!mk) {
      key = `${equipmentType}_${String(equipmentId)}`;
      mk = markersMapRef.current.get(key);
    }
    if (!mk) {
      key = `${equipmentType}_${Number(equipmentId)}`;
      mk = markersMapRef.current.get(key);
    }
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
        connectionsLayerRef.current = L.layerGroup().addTo(m);

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
    // Expose map info for MeasurementTools
    getMapRef: () => mapRef.current,
    getImageBounds: () => imgSize.w > 0 ? [[0, 0], [imgSize.h, imgSize.w]] : null,
    getImageSize: () => imgSize,
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
          <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS.pending.bg }} />
          À venir (60j)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS.done.bg }} />
          Contrôlé
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS.none.bg }} />
          Non planifié
        </span>
      </div>
    </div>
  );
});

// Mapping from equipment types to app IDs for permission checking
const EQUIPMENT_TYPE_TO_APP_ID = {
  'switchboard': 'switchboards',
  'vsd': 'vsd',
  'meca': 'meca',
  'mobile': 'mobile-equipments',
  'hv': 'hv',
  'glo': 'glo',
  'datahub': 'datahub',
  'infrastructure': 'infrastructure',
};

/* ----------------------------- Main Component ----------------------------- */
export default function UnifiedEquipmentMap({
  title = "Plan Centralisé",
  subtitle = "Vue unifiée des équipements",
  backLink = "/app/switchboard-controls",
  initialVisibleTypes = ["switchboard", "vsd", "meca", "mobile", "hv", "glo"],
  showTypeFilters = true,
  userEmail, // User email for permission filtering
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Target equipment to highlight from URL params
  const targetEquipmentRef = useRef(null); // { type, id, plan }

  // Get user's allowed equipment types
  const allowedEquipmentTypes = useMemo(() => {
    const types = getAllowedEquipmentTypes(userEmail);
    // If no email provided or user has no restrictions, allow all
    if (!userEmail || types.length === 0) {
      return Object.keys(BASE_EQUIPMENT_TYPES);
    }
    return types;
  }, [userEmail]);

  // Filter initial visible types based on user permissions
  const permittedInitialTypes = useMemo(() => {
    return initialVisibleTypes.filter(type => allowedEquipmentTypes.includes(type));
  }, [initialVisibleTypes, allowedEquipmentTypes]);

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

  // Datahub categories (for dynamic type filters)
  const [datahubCategories, setDatahubCategories] = useState([]);

  // Build equipment types dynamically (base types + datahub categories)
  const equipmentTypes = useMemo(() => {
    const types = { ...BASE_EQUIPMENT_TYPES };
    // Add datahub categories as individual types
    datahubCategories.forEach(cat => {
      types[`datahub_cat_${cat.id}`] = createDatahubCategoryType(cat);
    });
    return types;
  }, [datahubCategories]);

  // Filters - use permitted types based on user permissions
  const [visibleTypes, setVisibleTypes] = useState(permittedInitialTypes);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all, overdue, upcoming

  // Add datahub categories to visible types when they are loaded (visible by default like other types)
  useEffect(() => {
    if (datahubCategories.length > 0) {
      const newCategoryTypes = datahubCategories.map(cat => `datahub_cat_${cat.id}`);
      setVisibleTypes(prev => {
        // Add only new category types that aren't already in the list
        const toAdd = newCategoryTypes.filter(t => !prev.includes(t));
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
    }
  }, [datahubCategories]);

  // UI
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Equipment links
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);

  const viewerRef = useRef(null);
  const mapContainerRef = useRef(null);

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

  // Load plans from VSD (primary source) and datahub categories
  useEffect(() => {
    loadPlans();
    loadControlStatuses();
    loadDatahubCategories();
  }, []);

  // Auto-highlight equipment from URL params after PDF is ready
  useEffect(() => {
    if (!pdfReady || !targetEquipmentRef.current) return;

    const target = targetEquipmentRef.current;
    targetEquipmentRef.current = null; // Clear to prevent re-triggering

    // Small delay to ensure all markers are rendered
    setTimeout(() => {
      viewerRef.current?.highlightMarker?.(target.id, target.type);
    }, 400);
  }, [pdfReady, allPositions]);

  // Load datahub categories with assign_to_controls enabled
  const loadDatahubCategories = async () => {
    try {
      const res = await api.datahub.listCategories();
      const categories = (res?.categories || []).filter(c => c.assign_to_controls);
      setDatahubCategories(categories);
    } catch (err) {
      console.error("Error loading datahub categories:", err);
    }
  };

  const loadPlans = async () => {
    setLoadingPlans(true);
    try {
      const res = await api.vsdMaps.listPlans();
      const planList = res?.plans || res || [];
      setPlans(planList);

      // Check for URL params to highlight specific equipment
      const urlType = searchParams.get('type');
      const urlId = searchParams.get('id');
      const urlPlan = searchParams.get('plan');
      const urlPage = searchParams.get('page');

      if (urlType && urlId) {
        // Store target equipment for highlighting after PDF loads
        targetEquipmentRef.current = { type: urlType, id: urlId };

        // Clear URL params to avoid re-triggering
        setSearchParams({}, { replace: true });

        if (urlPlan) {
          // Navigate to specified plan
          const targetPlan = planList.find(p => p.logical_name === urlPlan);
          if (targetPlan) {
            setSelectedPlan(targetPlan);
            setPageIndex(urlPage ? Number(urlPage) : 0);
            return;
          }
        }

        // No plan specified - try to find which plan has this equipment
        const placementInfo = await findEquipmentPlacement(urlType, urlId);
        if (placementInfo?.plan) {
          const targetPlan = planList.find(p => p.logical_name === placementInfo.plan);
          if (targetPlan) {
            setSelectedPlan(targetPlan);
            setPageIndex(placementInfo.pageIndex || 0);
            return;
          }
        }
      }

      // Default behavior: restore from localStorage or select first
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

  // Find which plan an equipment is placed on
  const findEquipmentPlacement = async (type, id) => {
    try {
      // Map equipment type to the correct API
      const apiMap = {
        switchboard: api.switchboardMaps,
        vsd: api.vsdMaps,
        meca: api.mecaMaps,
        mobile: api.mobileEquipment?.maps,
        hv: api.hvMaps,
        glo: api.gloMaps,
        datahub: api.datahub?.maps,
      };

      const mapApi = apiMap[type];
      if (!mapApi?.placedIds) return null;

      const res = await mapApi.placedIds();
      const details = res?.placed_details || res || {};

      // Find placement for this equipment ID
      const placement = details[id] || details[String(id)] || details[Number(id)];
      if (placement?.plans?.length > 0) {
        return { plan: placement.plans[0], pageIndex: placement.page_index || 0 };
      }
      if (placement?.logical_name) {
        return { plan: placement.logical_name, pageIndex: placement.page_index || 0 };
      }
      return null;
    } catch (err) {
      console.error("Error finding equipment placement:", err);
      return null;
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
      const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

      schedules.forEach(item => {
        const key = getEquipmentKey(item);
        if (!key) return;

        const nextDue = item.next_due_date ? new Date(item.next_due_date) : null;
        if (!nextDue) return;

        // Determine status based on due date
        // Green (done): next control > 60 days away
        // Blue (pending): next control <= 60 days away
        // Red (overdue): past due
        let status;
        if (nextDue < now) {
          status = "overdue";
        } else if (nextDue <= sixtyDaysFromNow) {
          status = "pending"; // Blue - control coming up within 60 days
        } else {
          status = "done"; // Green - recently controlled, next due > 60 days
        }

        // Keep the most urgent status (overdue > pending > done)
        if (!statuses[key] ||
            (status === "overdue") ||
            (status === "pending" && statuses[key] === "done")) {
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
    if (item.datahub_equipment_id) return `datahub_${item.datahub_equipment_id}`;
    return null;
  }

  // Load equipment links
  const loadEquipmentLinks = async (type, id) => {
    if (!type || !id) {
      setLinks([]);
      return;
    }
    setLinksLoading(true);
    try {
      const res = await api.equipmentLinks.getLinks(type, id);
      setLinks(res?.links || []);
    } catch (err) {
      console.error("Error loading equipment links:", err);
      setLinks([]);
    } finally {
      setLinksLoading(false);
    }
  };

  // Add a new link
  const handleAddLink = async (linkData) => {
    try {
      await api.equipmentLinks.createLink(linkData);
      // Reload links
      if (selectedPosition) {
        loadEquipmentLinks(selectedPosition.equipment_type, selectedPosition.equipment_id);
      }
    } catch (err) {
      console.error("Error creating link:", err);
    }
  };

  // Delete a link
  const handleDeleteLink = async (linkId) => {
    try {
      await api.equipmentLinks.deleteLink(linkId);
      // Reload links
      if (selectedPosition) {
        loadEquipmentLinks(selectedPosition.equipment_type, selectedPosition.equipment_id);
      }
    } catch (err) {
      console.error("Error deleting link:", err);
    }
  };

  // Handle click on a linked equipment
  const handleLinkClick = async (link) => {
    const eq = link.linkedEquipment;
    if (!eq) return;

    const currentPlanKey = selectedPlan?.logical_name || selectedPlan?.id;

    // If on same plan, find and select the marker
    if (eq.hasPosition && eq.plan === currentPlanKey && (eq.pageIndex || 0) === pageIndex) {
      // Find the position in allPositions
      const targetPos = allPositions.find(
        p => p.equipment_type === eq.type && String(p.equipment_id) === String(eq.id)
      );
      if (targetPos) {
        setSelectedPosition({ ...targetPos, control_status: controlStatuses[`${eq.type}_${eq.id}`] || 'none' });
        loadEquipmentLinks(eq.type, eq.id);
        // Highlight marker
        viewerRef.current?.highlightMarker?.(eq.id, eq.type);
      }
    } else if (eq.hasPosition && eq.plan) {
      // Navigate to the other plan and highlight the target equipment
      const targetPlan = plans.find(p => p.logical_name === eq.plan || p.id === eq.plan);
      if (targetPlan) {
        const targetPageIndex = eq.pageIndex !== undefined ? eq.pageIndex : 0;

        // Reset state and switch to target plan
        setSelectedPlan(targetPlan);
        setPageIndex(targetPageIndex);
        setPdfReady(false);

        // Close current detail panel during transition
        setSelectedPosition(null);
        setLinks([]);

        // Wait for positions to load
        const positions = await loadAllPositions(targetPlan, targetPageIndex);

        // Find the target equipment after positions are loaded
        const targetPos = (positions || []).find(
          p => p.equipment_type === eq.type && String(p.equipment_id) === String(eq.id)
        );

        // Small delay to let viewer render markers, then highlight and select
        setTimeout(() => {
          if (targetPos) {
            setSelectedPosition({ ...targetPos, control_status: controlStatuses[`${eq.type}_${eq.id}`] || 'none' });
            loadEquipmentLinks(eq.type, eq.id);
          }
          // Always highlight to show the user which equipment it is (flash animation)
          viewerRef.current?.highlightMarker?.(eq.id, eq.type);
        }, 500);
      }
    } else {
      // No position - could navigate to equipment detail page
      handleNavigate({ equipment_type: eq.type, equipment_id: eq.id });
    }
  };

  // Get control status key for a position (handles datahub/infrastructure category types)
  function getPositionStatusKey(pos) {
    // For datahub category types (datahub_cat_<uuid>), use datahub_<equipment_id>
    if (pos.equipment_type?.startsWith("datahub_cat_")) {
      return `datahub_${pos.equipment_id}`;
    }
    // For infrastructure category types (infrastructure_cat_<uuid>), use infrastructure_<equipment_id>
    if (pos.equipment_type?.startsWith("infrastructure_cat_")) {
      return `infrastructure_${pos.equipment_id}`;
    }
    return `${pos.equipment_type}_${pos.equipment_id}`;
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
      { type: "datahub", api: api.datahub?.maps },
      { type: "infrastructure", api: api.infrastructure?.maps },
    ];

    // Map type to the correct ID field name from API
    // Switchboard uses switchboard_id, datahub/infrastructure uses item_id, all other types use equipment_id
    const getEquipmentIdFromPosition = (type, p) => {
      if (type === "switchboard") return p.switchboard_id;
      if (type === "datahub" || type === "infrastructure") return p.item_id || p.id;
      return p.equipment_id || p.id;
    };

    const results = await Promise.allSettled(
      loaders.map(async ({ type, api: mapApi }) => {
        if (!mapApi?.positionsAuto && !mapApi?.positions) return [];
        try {
          const fetcher = mapApi.positionsAuto || mapApi.positions;
          const res = await fetcher(key, page);
          return (res?.positions || []).map(p => {
            // For datahub, use category-based type if category_id is available
            let equipmentType = type;
            if (type === "datahub" && p.category_id) {
              equipmentType = `datahub_cat_${p.category_id}`;
            }
            if (type === "infrastructure" && p.category_id) {
              equipmentType = `infrastructure_cat_${p.category_id}`;
            }
            // Datahub/Infrastructure uses inverted Y coordinates (y_frac = 1 - lat/h),
            // while other equipment types use direct coordinates (y_frac = lat/h)
            // Convert datahub/infrastructure to match the standard convention
            const y_frac = (type === "datahub" || type === "infrastructure") ? (1 - (p.y_frac || 0)) : p.y_frac;
            return {
              ...p,
              y_frac,
              equipment_type: equipmentType,
              equipment_id: getEquipmentIdFromPosition(type, p),
            };
          });
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
    return allPos;
  };

  // Filter positions based on search, status, and user permissions
  const filteredPositions = useMemo(() => {
    // First filter by allowed equipment types (user permissions)
    let filtered = allPositions.filter(p => {
      // Check if user has permission for this equipment type
      const baseType = p.equipment_type?.startsWith('datahub_cat_') ? 'datahub' : p.equipment_type;
      return allowedEquipmentTypes.includes(baseType) || allowedEquipmentTypes.includes(p.equipment_type);
    });

    // Then filter by currently visible types (user selection)
    filtered = filtered.filter(p => visibleTypes.includes(p.equipment_type));

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
        const status = controlStatuses[getPositionStatusKey(p)] || "none";
        if (statusFilter === "overdue") return status === "overdue";
        if (statusFilter === "upcoming") return status === "upcoming" || status === "overdue";
        return true;
      });
    }

    return filtered;
  }, [allPositions, visibleTypes, searchQuery, statusFilter, controlStatuses, allowedEquipmentTypes]);

  // Stats
  const stats = useMemo(() => {
    const overdueCount = allPositions.filter(p =>
      controlStatuses[getPositionStatusKey(p)] === "overdue"
    ).length;
    const upcomingCount = allPositions.filter(p =>
      controlStatuses[getPositionStatusKey(p)] === "upcoming"
    ).length;

    return {
      total: allPositions.length,
      overdue: overdueCount,
      upcoming: upcomingCount,
      byType: Object.keys(equipmentTypes).reduce((acc, type) => {
        acc[type] = allPositions.filter(p => p.equipment_type === type).length;
        return acc;
      }, {}),
    };
  }, [allPositions, controlStatuses, equipmentTypes]);

  const handleNavigate = (position) => {
    if (!position) {
      console.warn('Cannot navigate: position is null/undefined');
      return;
    }

    const typeConfig = equipmentTypes[position.equipment_type];

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
                  {/* Base equipment types - filtered by user permissions */}
                  {Object.entries(BASE_EQUIPMENT_TYPES)
                    .filter(([type]) => allowedEquipmentTypes.includes(type))
                    .map(([type, config]) => {
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
                  {/* Datahub categories */}
                  {datahubCategories.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-gray-400 mt-3 mb-1 flex items-center gap-1">
                        <Database size={10} />
                        Datahub
                      </div>
                      {datahubCategories.map(cat => {
                        const type = `datahub_cat_${cat.id}`;
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
                              style={{ background: cat.color || "#8b5cf6" }}
                            >
                              <Database size={12} className="text-white" />
                            </div>
                            <span className="flex-1 text-left">{cat.name}</span>
                            <span className="text-xs text-gray-500">{count}</span>
                          </button>
                        );
                      })}
                    </>
                  )}
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
                  const typeConfig = equipmentTypes[pos.equipment_type] || {};
                  const Icon = typeConfig.icon || MapPin;
                  const status = controlStatuses[getPositionStatusKey(pos)] || "none";
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
        <div ref={mapContainerRef} className="flex-1 flex flex-col relative">
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
                equipmentTypes={equipmentTypes}
                onReady={() => setPdfReady(true)}
                onClickPoint={(meta) => {
                  setSelectedPosition(meta);
                  // Load links for this equipment
                  loadEquipmentLinks(meta.equipment_type, meta.equipment_id);
                }}
                // Pass links for polyline drawing
                links={links}
                selectedPlan={selectedPlan?.logical_name || selectedPlan?.id}
                currentPageIndex={pageIndex}
              />

              {/* Measurement Tools */}
              {pdfReady && selectedPlan && (
                <MeasurementTools
                  planId={selectedPlan.id}
                  pageIndex={pageIndex}
                  mapRef={{ current: viewerRef.current?.getMapRef?.() }}
                  imageBounds={viewerRef.current?.getImageBounds?.()}
                  imageWidth={viewerRef.current?.getImageSize?.()?.w}
                  imageHeight={viewerRef.current?.getImageSize?.()?.h}
                />
              )}
            </>
          )}

          {/* Detail panel */}
          {selectedPosition && (
            <DetailPanel
              position={selectedPosition}
              onClose={() => { setSelectedPosition(null); setLinks([]); }}
              onNavigate={handleNavigate}
              equipmentTypes={equipmentTypes}
              links={links}
              linksLoading={linksLoading}
              onAddLink={handleAddLink}
              onDeleteLink={handleDeleteLink}
              onLinkClick={handleLinkClick}
              currentPlan={selectedPlan?.logical_name || selectedPlan?.id}
              currentPageIndex={pageIndex}
              mapContainerRef={mapContainerRef}
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
                  {Object.entries(BASE_EQUIPMENT_TYPES)
                    .filter(([type]) => allowedEquipmentTypes.includes(type))
                    .map(([type, config]) => {
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
                  {/* Datahub categories (mobile) */}
                  {datahubCategories.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-gray-400 mt-2 mb-1">Datahub</div>
                      {datahubCategories.map(cat => {
                        const type = `datahub_cat_${cat.id}`;
                        const count = stats.byType[type] || 0;
                        const isActive = visibleTypes.includes(type);
                        return (
                          <button
                            key={type}
                            onClick={() => toggleType(type)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100" : "opacity-50"}`}
                          >
                            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: cat.color || "#8b5cf6" }}>
                              <Database size={12} className="text-white" />
                            </div>
                            <span className="flex-1 text-left">{cat.name}</span>
                            <span className="text-xs text-gray-500">{count}</span>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredPositions.slice(0, 50).map(pos => {
                const typeConfig = equipmentTypes[pos.equipment_type] || {};
                const Icon = typeConfig.icon || MapPin;
                const status = controlStatuses[getPositionStatusKey(pos)] || "none";

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
