// src/pages/MobileEquipments_map.jsx - Map view for Mobile Equipment using VSD plans
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

// Mobile optimization
import { getOptimalImageFormat } from "../config/mobile-optimization.js";

// Icons
import {
  Cpu,
  Search,
  ChevronLeft,
  ChevronRight,
  Building2,
  MapPin,
  CheckCircle,
  AlertCircle,
  X,
  RefreshCw,
  Trash2,
  ExternalLink,
  Crosshair,
  Target,
  ArrowLeft,
  Zap,
  Upload,
  Plus,
} from "lucide-react";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/* ----------------------------- LocalStorage Keys ----------------------------- */
const STORAGE_KEY_PLAN = "mobile_equip_map_selected_plan";
const STORAGE_KEY_PAGE = "mobile_equip_map_page_index";

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
  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    if (base) name = base.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }
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
    cyan: "bg-cyan-100 text-cyan-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
      <Icon size={32} className="text-gray-400" />
    </div>
    <h3 className="text-lg font-medium text-gray-700">{title}</h3>
    {description && <p className="text-gray-500 mt-1 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-cyan-600 text-white hover:bg-cyan-700 shadow-sm disabled:opacity-50",
    ghost: "bg-white text-black border hover:bg-gray-50 disabled:opacity-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50",
    subtle: "bg-cyan-50 text-cyan-700 border border-cyan-200 hover:bg-cyan-100 disabled:opacity-50",
  };
  return (
    <button className={`px-3 py-2 rounded-lg text-sm transition ${map[variant] || map.primary} ${className}`} {...p}>
      {children}
    </button>
  );
}

/* ----------------------------- Confirm Modal ----------------------------- */
function ConfirmModal({ open, title = "Confirmation", message, confirmText = "Confirmer", cancelText = "Annuler", onConfirm, onCancel, danger = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[7000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-[92vw] max-w-md bg-white rounded-2xl shadow-2xl border overflow-hidden animate-slideUp">
        <div className={`px-4 py-3 ${danger ? "bg-gradient-to-r from-rose-500 to-red-600 text-white" : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white"}`}>
          <h3 className="font-semibold">{title}</h3>
        </div>
        <div className="p-4 text-sm text-gray-700">{message}</div>
        <div className="px-4 pb-4 flex gap-2 justify-end">
          <Btn variant="ghost" onClick={onCancel}>{cancelText}</Btn>
          <Btn variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmText}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Context Menu ----------------------------- */
function ContextMenu({ x, y, onDelete, onClose }) {
  useEffect(() => {
    const handleClick = () => onClose();
    const handleScroll = () => onClose();
    window.addEventListener("click", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  return (
    <div
      className="fixed bg-white rounded-xl shadow-2xl border py-1 z-[6000] min-w-[160px] animate-slideUp"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <Trash2 size={16} />
        Detacher du plan
      </button>
    </div>
  );
}

/* ----------------------------- Sidebar Card ----------------------------- */
const EquipmentCard = ({ equipment, isPlacedHere, isPlacedSomewhere, isPlacedElsewhere, isSelected, onClick, onPlace }) => {
  return (
    <div
      className={`p-3 rounded-xl border transition-all cursor-pointer group
        ${isSelected ? "bg-cyan-50 border-cyan-300 shadow-sm" : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold text-sm ${isSelected ? "text-cyan-700" : "text-gray-900"}`}>
              {equipment.name || "Equipement"}
            </span>
            {isPlacedElsewhere && <Badge variant="purple">Place ailleurs</Badge>}
          </div>
          <p className={`text-xs truncate mt-0.5 ${isSelected ? "text-cyan-600" : "text-gray-500"}`}>
            {equipment.category || "-"} {equipment.serial_number ? `• ${equipment.serial_number}` : ""}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <span className="flex items-center gap-0.5">
              <Building2 size={10} />
              {equipment.building || "-"}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          {isPlacedHere ? (
            <span className="flex items-center gap-1 text-emerald-600 text-xs">
              <CheckCircle size={14} />
              Place
            </span>
          ) : isPlacedSomewhere ? (
            <span className="flex items-center gap-1 text-purple-600 text-xs">
              <CheckCircle size={14} />
              Ailleurs
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 text-xs">
              <AlertCircle size={14} />
              Non place
            </span>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onPlace(equipment); }}
            className="px-2 py-1 bg-cyan-500 text-white text-xs rounded-lg flex items-center gap-1 hover:bg-cyan-600 transition-colors"
            title={isPlacedSomewhere ? "Deplacer sur ce plan" : "Placer sur ce plan"}
          >
            <Target size={12} />
            {isPlacedSomewhere ? "Deplacer" : "Placer"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ----------------------------- Detail Panel ----------------------------- */
const DetailPanel = ({ position, equipment, onClose, onNavigate, onDelete }) => {
  if (!position) return null;
  return (
    <AnimatedCard className="absolute bottom-2 left-2 right-2 md:bottom-4 md:left-auto md:right-4 md:w-80 bg-white rounded-xl md:rounded-2xl shadow-2xl border overflow-hidden z-30">
      <div className="bg-gradient-to-r from-cyan-500 to-blue-600 p-3 md:p-4 text-white">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="p-1.5 md:p-2 bg-white/20 rounded-lg flex-shrink-0">
              <Zap size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-sm md:text-base truncate">{position.name || equipment?.name || "Équipement"}</h3>
              <p className="text-cyan-100 text-xs md:text-sm truncate">{equipment?.category || "-"}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="p-3 md:p-4 space-y-2 md:space-y-3">
        <div className="grid grid-cols-3 gap-1.5 md:gap-2 text-sm">
          <div className="bg-gray-50 rounded-lg p-1.5 md:p-2 text-center">
            <span className="text-gray-500 text-[10px] md:text-xs block">Bâtiment</span>
            <span className="font-semibold text-gray-900 text-xs md:text-sm truncate block">{position.building || equipment?.building || "-"}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-1.5 md:p-2 text-center">
            <span className="text-gray-500 text-[10px] md:text-xs block">Étage</span>
            <span className="font-semibold text-gray-900 text-xs md:text-sm">{equipment?.floor || "-"}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-1.5 md:p-2 text-center">
            <span className="text-gray-500 text-[10px] md:text-xs block">N/S</span>
            <span className="font-semibold text-gray-900 text-[10px] md:text-xs truncate block">{equipment?.serial_number || "-"}</span>
          </div>
        </div>

        <div className="flex gap-2 pt-1 md:pt-2">
          <button
            onClick={() => onNavigate(position.equipment_id)}
            className="flex-1 py-2 md:py-2.5 px-3 md:px-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-medium hover:from-cyan-600 hover:to-blue-700 transition-all flex items-center justify-center gap-2 text-sm"
          >
            <ExternalLink size={16} />
            <span className="hidden sm:inline">Ouvrir la fiche</span>
            <span className="sm:hidden">Fiche</span>
          </button>

          <button
            onClick={() => onDelete?.(position)}
            className="py-2 md:py-2.5 px-3 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all flex items-center justify-center"
            title="Détacher du plan"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </AnimatedCard>
  );
};

/* ----------------------------- Placement Mode Indicator ----------------------------- */
const PlacementModeIndicator = ({ equipment, onCancel }) => (
  <div className="absolute top-2 md:top-4 left-2 right-2 md:left-1/2 md:right-auto md:transform md:-translate-x-1/2 z-30">
    <div className="bg-cyan-600 text-white px-3 md:px-4 py-2 md:py-3 rounded-xl md:rounded-2xl shadow-xl flex items-center gap-2 md:gap-3 animate-slideUp">
      <div className="p-1.5 md:p-2 bg-white/20 rounded-lg flex-shrink-0">
        <Crosshair size={18} className="animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm md:text-base">Mode placement</p>
        <p className="text-cyan-200 text-xs md:text-sm truncate">
          Touchez pour placer <span className="font-semibold">{equipment.name || "l'équipement"}</span>
        </p>
      </div>
      <button onClick={onCancel} className="p-1.5 md:p-2 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
        <X size={18} />
      </button>
    </div>
  </div>
);

/* ----------------------------- Leaflet Viewer ----------------------------- */
const LeafletViewer = forwardRef(({
  fileUrl,
  pageIndex = 0,
  initialPoints = [],
  selectedId = null,
  controlStatuses = {},
  onReady,
  onMovePoint,
  onClickPoint,
  onCreatePoint,
  onContextMenu,
  disabled = false,
  placementActive = false,
}, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const markersMapRef = useRef(new Map());
  const controlStatusesRef = useRef(controlStatuses);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);

  const pointsRef = useRef(initialPoints);
  const selectedIdRef = useRef(selectedId);
  const placementActiveRef = useRef(placementActive);
  const aliveRef = useRef(true);

  const lastViewRef = useRef({ center: [0, 0], zoom: 0 });
  const initialFitDoneRef = useRef(false);
  const userViewTouchedRef = useRef(false);

  const lastJob = useRef({ key: null });
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);

  useEffect(() => { pointsRef.current = initialPoints; }, [initialPoints]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { placementActiveRef.current = placementActive; }, [placementActive]);

  useImperativeHandle(ref, () => ({
    flyTo: (x, y, zoom = 2) => {
      if (!mapRef.current || imgSize.w === 0) return;
      const lat = -y * imgSize.h;
      const lng = x * imgSize.w;
      mapRef.current.flyTo([lat, lng], zoom, { duration: 0.5 });
    },
    getMap: () => mapRef.current,
  }), [imgSize]);

  // Initialize map
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;

    const map = L.map(wrapRef.current, {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 4,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      attributionControl: false,
      preferCanvas: true,
      zoomControl: false, // Disable default zoom control
    });

    // Add zoom control on the right
    L.control.zoom({ position: "topright" }).addTo(map);

    map.on("moveend zoomend", () => {
      lastViewRef.current = { center: map.getCenter(), zoom: map.getZoom() };
      userViewTouchedRef.current = true;
    });

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      aliveRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Load PDF page
  useEffect(() => {
    if (!fileUrl || !mapRef.current) return;

    const jobKey = `${fileUrl}-${pageIndex}`;
    if (lastJob.current.key === jobKey) return;
    lastJob.current.key = jobKey;

    const map = mapRef.current;
    if (loadingTaskRef.current) loadingTaskRef.current.destroy?.();
    if (renderTaskRef.current) renderTaskRef.current.cancel?.();

    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfDocOpts(fileUrl));
        loadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;

        if (!aliveRef.current || lastJob.current.key !== jobKey) return;

        const page = await pdf.getPage(pageIndex + 1);
        if (!aliveRef.current || lastJob.current.key !== jobKey) return;

        const scale = 2;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d");

        const renderTask = page.render({ canvasContext: ctx, viewport: vp });
        renderTaskRef.current = renderTask;
        await renderTask.promise;

        if (!aliveRef.current || lastJob.current.key !== jobKey) return;

        // 🚀 JPEG compressé sur mobile, PNG sur desktop
        const dataUrl = getOptimalImageFormat(canvas);
        const bounds = [[0, 0], [-vp.height, vp.width]];

        if (imageLayerRef.current) map.removeLayer(imageLayerRef.current);
        imageLayerRef.current = L.imageOverlay(dataUrl, bounds).addTo(map);

        setImgSize({ w: vp.width, h: vp.height });

        if (!userViewTouchedRef.current || !initialFitDoneRef.current) {
          map.fitBounds(bounds, { padding: [20, 20] });
          initialFitDoneRef.current = true;
        }

        onReady?.();
      } catch (e) {
        if (e.name !== "RenderingCancelledException") {
          console.error("[LeafletViewer] PDF render error:", e);
        }
      }
    })();
  }, [fileUrl, pageIndex, onReady]);

  // Update controlStatusesRef when prop changes
  useEffect(() => {
    controlStatusesRef.current = controlStatuses;
  }, [controlStatuses]);

  // Update markers
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || imgSize.w === 0) return;

    const map = mapRef.current;
    const layer = markersLayerRef.current;

    layer.clearLayers();
    markersMapRef.current.clear();

    // Use initialPoints directly instead of pointsRef.current for proper reactivity
    initialPoints.forEach((pt) => {
      const lat = -pt.y_frac * imgSize.h;
      const lng = pt.x_frac * imgSize.w;
      const isSel = pt.equipment_id === selectedId;

      // Get control status for this equipment
      const controlStatus = controlStatusesRef.current[pt.equipment_id];
      const isOverdue = controlStatus?.status === 'overdue';
      const isUpcoming = controlStatus?.status === 'upcoming';

      // Colors aligned with UnifiedEquipmentMap STATUS_COLORS
      let bgColor;
      let animClass = "";
      if (isSel) {
        bgColor = "radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed)"; // Purple - selected
        animClass = "mobile-marker-selected";
      } else if (isOverdue) {
        bgColor = "radial-gradient(circle at 30% 30%, #ef4444, #dc2626)"; // Red - overdue
        animClass = "mobile-marker-overdue";
      } else if (isUpcoming) {
        bgColor = "radial-gradient(circle at 30% 30%, #f59e0b, #d97706)"; // Amber - upcoming
      } else {
        bgColor = "radial-gradient(circle at 30% 30%, #8b5cf6, #7c3aed)"; // Purple - Mobile default
      }

      // Truck icon (matching UnifiedEquipmentMap mobile icon)
      const icon = L.divIcon({
        className: "mobile-marker-inline",
        html: `
          <div class="${animClass}" style="width:24px;height:24px;background:${bgColor};border:2px solid white;border-radius:9999px;box-shadow:0 4px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="white" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="3" width="15" height="13" rx="2"/>
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
              <circle cx="5.5" cy="18.5" r="2.5"/>
              <circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([lat, lng], { icon, draggable: !disabled });

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onClickPoint?.(pt);
      });

      marker.on("contextmenu", (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        onContextMenu?.(pt, e.containerPoint);
      });

      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        const nx = clamp(pos.lng / imgSize.w, 0, 1);
        const ny = clamp(-pos.lat / imgSize.h, 0, 1);
        onMovePoint?.(pt.equipment_id, nx, ny);
      });

      marker.addTo(layer);
      markersMapRef.current.set(pt.equipment_id, marker);
    });
  }, [initialPoints, selectedId, controlStatuses, imgSize, disabled, onClickPoint, onMovePoint, onContextMenu]);

  // Map click for placement
  useEffect(() => {
    if (!mapRef.current || imgSize.w === 0) return;

    const map = mapRef.current;
    const handleClick = (e) => {
      if (!placementActiveRef.current) return;

      const { lat, lng } = e.latlng;
      const x = clamp(lng / imgSize.w, 0, 1);
      const y = clamp(-lat / imgSize.h, 0, 1);

      onCreatePoint?.(x, y);
    };

    map.on("click", handleClick);
    return () => map.off("click", handleClick);
  }, [imgSize, onCreatePoint]);

  // Picker cursor
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.getContainer().style.cursor = placementActive ? "crosshair" : "";
  }, [placementActive]);

  return (
    <div ref={wrapRef} className="w-full h-full bg-gray-100" style={{ minHeight: 400 }} />
  );
});

/* ----------------------------- Main Component ----------------------------- */
export default function MobileEquipmentsMap() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  const [equipments, setEquipments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [allPositions, setAllPositions] = useState([]);

  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);

  const [placementMode, setPlacementMode] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false); // Start closed on mobile
  const [filterMode, setFilterMode] = useState("all"); // all | placed | unplaced
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [controlStatuses, setControlStatuses] = useState({});

  const viewerRef = useRef(null);
  const creatingRef = useRef(false);

  // Handle resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // Auto-close sidebar on mobile
      if (mobile && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarOpen]);

  // Derived
  const placedIds = useMemo(() => new Set(allPositions.map(p => p.equipment_id)), [allPositions]);
  const placedHereIds = useMemo(() => new Set(positions.map(p => p.equipment_id)), [positions]);

  const filteredEquipments = useMemo(() => {
    let list = equipments;

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.name || "").toLowerCase().includes(q) ||
        (e.building || "").toLowerCase().includes(q) ||
        (e.category || "").toLowerCase().includes(q)
      );
    }

    // Filter by placement status
    if (filterMode === "placed") {
      list = list.filter(e => placedIds.has(e.id));
    } else if (filterMode === "unplaced") {
      list = list.filter(e => !placedIds.has(e.id));
    }

    return list;
  }, [equipments, search, filterMode, placedIds]);

  // Function to load equipments
  const loadEquipments = useCallback(async () => {
    try {
      const equipRes = await api.mobileEquipment.list();
      setEquipments(equipRes.items || equipRes.equipments || equipRes.data || []);
    } catch (e) {
      console.error("[MobileEquipmentsMap] Load equipments error:", e);
    }
  }, []);

  // Function to load all positions for "placed elsewhere" check
  const loadAllPositions = useCallback(async () => {
    if (!plans.length) return;
    try {
      const allPos = [];
      for (const plan of plans) {
        const res = await api.mobileEquipment.maps.positionsAuto(plan, 0);
        if (res.positions) {
          allPos.push(...res.positions.map(p => ({ ...p, planId: plan.id })));
        }
      }
      setAllPositions(allPos);
    } catch (e) {
      console.error("[MobileEquipmentsMap] Load all positions error:", e);
    }
  }, [plans]);

  // Load control statuses from dashboard API
  const loadControlStatuses = useCallback(async () => {
    try {
      const dashboardRes = await api.switchboardControls.dashboard();
      const statuses = {};

      (dashboardRes?.overdue_list || []).forEach(item => {
        if (item.mobile_equipment_id) {
          statuses[item.mobile_equipment_id] = { status: 'overdue', template_name: item.template_name };
        }
      });

      (dashboardRes?.upcoming || []).forEach(item => {
        if (item.mobile_equipment_id && !statuses[item.mobile_equipment_id]) {
          statuses[item.mobile_equipment_id] = { status: 'upcoming', template_name: item.template_name };
        }
      });

      setControlStatuses(statuses);
    } catch (err) {
      console.error("Erreur chargement statuts contrôle Mobile:", err);
    }
  }, []);

  // Load plans and equipments
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [plansRes, equipRes] = await Promise.all([
          api.mobileEquipment.maps.listPlans(),
          api.mobileEquipment.list(),
        ]);

        setPlans(plansRes.plans || []);
        setEquipments(equipRes.items || equipRes.equipments || equipRes.data || []);

        // Restore or select first plan
        const savedPlanKey = localStorage.getItem(STORAGE_KEY_PLAN);
        const savedPage = parseInt(localStorage.getItem(STORAGE_KEY_PAGE) || "0", 10);

        if (plansRes.plans?.length > 0) {
          const found = savedPlanKey && plansRes.plans.find(p => p.logical_name === savedPlanKey || String(p.id) === savedPlanKey);
          setSelectedPlan(found || plansRes.plans[0]);
          setPageIndex(found ? savedPage : 0);
        }

        // Load control statuses
        loadControlStatuses();
      } catch (e) {
        console.error("[MobileEquipmentsMap] Load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadControlStatuses]);

  // Load positions when plan changes
  useEffect(() => {
    if (!selectedPlan) return;

    (async () => {
      try {
        const res = await api.mobileEquipment.maps.positionsAuto(selectedPlan, pageIndex);
        setPositions(res.positions || []);
        setPageCount(res.page_count || 1);
      } catch (e) {
        console.error("[MobileEquipmentsMap] Load positions error:", e);
        setPositions([]);
      }
    })();

    // Save to localStorage
    localStorage.setItem(STORAGE_KEY_PLAN, selectedPlan.logical_name || String(selectedPlan.id));
    localStorage.setItem(STORAGE_KEY_PAGE, String(pageIndex));
  }, [selectedPlan, pageIndex]);

  // Load all positions when plans change
  useEffect(() => {
    loadAllPositions();
  }, [loadAllPositions]);

  // Handle URL parameter for equipment navigation from MobileEquipments page
  useEffect(() => {
    const equipmentIdParam = searchParams.get('equipment');
    if (!equipmentIdParam || !allPositions.length || !plans.length) return;

    // Find the equipment in allPositions
    const position = allPositions.find(p => String(p.equipment_id) === equipmentIdParam);
    if (position) {
      // Find the plan where this equipment is placed
      const planKey = position.planId || position.logical_name;
      const plan = plans.find(p => p.id === planKey || p.logical_name === planKey);

      if (plan && (!selectedPlan || selectedPlan.id !== plan.id)) {
        setSelectedPlan(plan);
        setPageIndex(position.page_index || 0);
      }

      // Find the equipment details
      const eq = equipments.find(e => String(e.id) === equipmentIdParam);
      if (eq) {
        setSelectedEquipment(eq);
        setSelectedPosition(position);

        // Fly to the equipment position after a short delay to let the map render
        setTimeout(() => {
          viewerRef.current?.flyTo(position.x_frac, position.y_frac, 2);
        }, 500);
      }
    } else {
      // Equipment not placed yet - just find it in equipments list
      const eq = equipments.find(e => String(e.id) === equipmentIdParam);
      if (eq) {
        setSelectedEquipment(eq);
        // Enter placement mode so user can place it
        setPlacementMode(eq);
      }
    }

    // Clear the URL param after handling
    setSearchParams({}, { replace: true });
  }, [searchParams, allPositions, plans, equipments, selectedPlan, setSearchParams]);

  // Handlers
  const handleSelectEquipment = useCallback((eq) => {
    setSelectedEquipment(eq);
    setSelectedPosition(null);
    setPlacementMode(null);
  }, []);

  const handleSelectPosition = useCallback((pos) => {
    setSelectedPosition(pos);
    const eq = equipments.find(e => e.id === pos.equipment_id);
    setSelectedEquipment(eq || null);
    setPlacementMode(null);
  }, [equipments]);

  const handleStartPlacement = useCallback((eq) => {
    setPlacementMode(eq);
    setSelectedEquipment(eq);
    setSelectedPosition(null);
  }, []);

  const handleCreatePosition = useCallback(async (x, y) => {
    if (!placementMode || !selectedPlan) return;

    try {
      await api.mobileEquipment.maps.setPosition(placementMode.id, {
        plan_id: selectedPlan.id,
        logical_name: selectedPlan.logical_name,
        page_index: pageIndex,
        x_frac: x,
        y_frac: y,
      });

      // Reload positions
      const res = await api.mobileEquipment.maps.positionsAuto(selectedPlan, pageIndex);
      setPositions(res.positions || []);

      setPlacementMode(null);
    } catch (e) {
      console.error("[MobileEquipmentsMap] Create position error:", e);
      alert("Erreur lors du placement");
    }
  }, [placementMode, selectedPlan, pageIndex]);

  // Create a new mobile equipment directly from the plan
  const createEquipmentAtFrac = useCallback(async (x, y) => {
    if (creatingRef.current) return;
    if (!selectedPlan) return;

    creatingRef.current = true;
    try {
      // Create equipment with auto-generated name
      const timestamp = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const created = await api.mobileEquipment.create({ name: `Nouvel équipement ${timestamp}` });
      const newEquipment = created?.equipment || created;
      const id = newEquipment?.id;
      if (!id) throw new Error("ID non retourné par le serveur");

      // Set position on the plan
      try {
        await api.mobileEquipment.maps.setPosition(id, {
          plan_id: selectedPlan.id,
          logical_name: selectedPlan.logical_name,
          page_index: pageIndex,
          x_frac: x,
          y_frac: y,
        });
      } catch (posErr) {
        console.warn("[MobileEquipmentsMap] Position error (equipment created):", posErr);
        // Equipment was created but position failed - still show it
      }

      // Add the new position immediately to show the marker
      const newPosition = {
        equipment_id: id,
        name: newEquipment.name || `Nouvel équipement ${timestamp}`,
        x_frac: x,
        y_frac: y,
        building: newEquipment.building || "",
        category: newEquipment.category || "",
      };
      setPositions(prev => [...prev, newPosition]);

      // Reload data in background (don't await to make it faster)
      loadEquipments();
      loadAllPositions();

      // Select the new equipment to show details panel
      setSelectedEquipment(newEquipment);
      setSelectedPosition(newPosition);
    } catch (err) {
      console.error("[MobileEquipmentsMap] Create equipment error:", err);
      alert("Erreur lors de la création de l'équipement mobile");
      // Reload to check if it was actually created
      loadEquipments();
      loadAllPositions();
    } finally {
      creatingRef.current = false;
      setCreateMode(false);
    }
  }, [selectedPlan, pageIndex, loadEquipments, loadAllPositions]);

  const handleMovePosition = useCallback(async (equipmentId, x, y) => {
    if (!selectedPlan) return;

    // Immediately update local state for responsive UI
    setPositions(prev => prev.map(p =>
      p.equipment_id === equipmentId ? { ...p, x_frac: x, y_frac: y } : p
    ));

    try {
      await api.mobileEquipment.maps.setPosition(equipmentId, {
        plan_id: selectedPlan.id,
        logical_name: selectedPlan.logical_name,
        page_index: pageIndex,
        x_frac: x,
        y_frac: y,
      });
    } catch (e) {
      console.error("[MobileEquipmentsMap] Move position error:", e);
      // Reload positions on error to restore correct state
      const res = await api.mobileEquipment.maps.positionsAuto(selectedPlan, pageIndex);
      setPositions(res.positions || []);
    }
  }, [selectedPlan, pageIndex]);

  const handleDeletePosition = useCallback(async (pos) => {
    try {
      await api.mobileEquipment.maps.setPosition(pos.equipment_id, {
        plan_id: null,
        logical_name: null,
        page_index: 0,
        x_frac: 0,
        y_frac: 0,
      });

      setPositions(prev => prev.filter(p => p.equipment_id !== pos.equipment_id));
      setSelectedPosition(null);
      setConfirmDelete(null);
    } catch (e) {
      console.error("[MobileEquipmentsMap] Delete position error:", e);
      alert("Erreur lors de la suppression");
    }
  }, []);

  const handleNavigateToEquipment = useCallback((equipmentId) => {
    navigate(`/app/mobile-equipments?equipment=${equipmentId}`);
  }, [navigate]);

  // File URL for viewer
  const fileUrl = useMemo(() => {
    if (!selectedPlan) return null;
    return api.mobileEquipment.maps.planFileUrlAuto(selectedPlan);
  }, [selectedPlan]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <RefreshCw size={32} className="animate-spin text-cyan-500" />
        <p className="text-gray-500">Chargement des plans...</p>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] md:h-[calc(100vh-120px)] flex flex-col bg-gray-50">
      {/* Inline styles for animations and safe areas */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-selected {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.7); }
          50% { transform: scale(1.15); box-shadow: 0 0 0 8px rgba(139, 92, 246, 0); }
        }
        @keyframes blink-overdue {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-slideUp { animation: slideUp 0.3s ease-out forwards; }
        .mobile-marker-inline { background: transparent !important; border: none !important; }
        .mobile-marker-selected > div { animation: pulse-selected 1.5s ease-in-out infinite; }
        .mobile-marker-overdue > div { animation: blink-overdue 1s ease-in-out infinite; }
        .safe-area-top { padding-top: env(safe-area-inset-top, 0); }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
        .overscroll-contain { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
      `}</style>
      {/* Header - Mobile optimized */}
      <div className="bg-white border-b px-3 md:px-4 py-2 md:py-3 flex items-center justify-between gap-2 md:gap-4 flex-shrink-0 safe-area-top">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button
            onClick={() => navigate("/app/mobile-equipments")}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-bold text-gray-900 flex items-center gap-2 text-sm md:text-base truncate">
              <Zap size={18} className="text-cyan-500 flex-shrink-0" />
              <span className="hidden sm:inline">Carte des Equipements Mobiles</span>
              <span className="sm:hidden">Carte</span>
            </h1>
            <p className="text-xs text-gray-500">
              {placedIds.size}/{equipments.length} placés
            </p>
          </div>
        </div>

        {/* Plan selector - Compact on mobile */}
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          <select
            value={selectedPlan?.logical_name || selectedPlan?.id || ""}
            onChange={(e) => {
              const plan = plans.find(p => p.logical_name === e.target.value || String(p.id) === e.target.value);
              setSelectedPlan(plan);
              setPageIndex(0);
            }}
            className="border rounded-lg px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm bg-white text-gray-900 max-w-[100px] md:max-w-none"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.logical_name || p.id}>
                {p.name || p.logical_name || `Plan ${p.id}`}
              </option>
            ))}
          </select>

          {pageCount > 1 && (
            <div className="flex items-center gap-0.5 md:gap-1">
              <button
                onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
                disabled={pageIndex === 0}
                className="p-1.5 md:p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs md:text-sm text-gray-600 min-w-[32px] text-center">
                {pageIndex + 1}/{pageCount}
              </span>
              <button
                onClick={() => setPageIndex(Math.min(pageCount - 1, pageIndex + 1))}
                disabled={pageIndex >= pageCount - 1}
                className="p-1.5 md:p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* Sidebar toggle - hidden on mobile, shown as FAB instead */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`hidden md:flex p-2 rounded-lg transition-colors ${sidebarOpen ? "bg-cyan-100 text-cyan-700" : "hover:bg-gray-100"}`}
          >
            <Cpu size={20} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Map viewer */}
        <div className="flex-1 relative">
          {fileUrl ? (
            <>
              <LeafletViewer
                ref={viewerRef}
                fileUrl={fileUrl}
                pageIndex={pageIndex}
                initialPoints={positions}
                selectedId={selectedEquipment?.id}
                controlStatuses={controlStatuses}
                placementActive={!!placementMode || createMode}
                onClickPoint={handleSelectPosition}
                onMovePoint={handleMovePosition}
                onCreatePoint={(x, y) => {
                  if (createMode) {
                    createEquipmentAtFrac(x, y);
                  } else {
                    handleCreatePosition(x, y);
                  }
                }}
                onContextMenu={(pt, point) => setContextMenu({ position: pt, x: point.x, y: point.y })}
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
                  className="w-11 h-11 sm:w-10 sm:h-10 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-xl border-none bg-gradient-to-br from-cyan-500 to-teal-600 text-white shadow-lg cursor-pointer text-lg flex items-center justify-center transition-all hover:from-cyan-400 hover:to-teal-500 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ touchAction: 'manipulation' }}
                  title="Créer un nouvel équipement mobile"
                >
                  <Plus size={20} />
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={MapPin}
              title="Aucun plan disponible"
              description="Uploadez des plans VSD pour commencer"
            />
          )}

          {/* Placement mode indicator */}
          {placementMode && (
            <PlacementModeIndicator
              equipment={placementMode}
              onCancel={() => setPlacementMode(null)}
            />
          )}

          {/* Create mode indicator - Mobile optimized */}
          {createMode && (
            <div className="absolute bottom-4 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-50 animate-slideUp">
              <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 bg-cyan-600 text-white rounded-xl md:rounded-2xl shadow-xl">
                <Crosshair size={18} className="animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm md:text-base">Mode création</p>
                  <p className="text-xs text-cyan-200 truncate">Touchez le plan pour créer</p>
                </div>
                <button onClick={() => setCreateMode(false)} className="p-1.5 md:p-2 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
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
              onNavigate={handleNavigateToEquipment}
              onDelete={(pos) => setConfirmDelete(pos)}
            />
          )}
        </div>

        {/* Desktop Sidebar */}
        {sidebarOpen && !isMobile && (
          <div className="w-80 bg-white border-l flex flex-col flex-shrink-0">
            <div className="p-3 border-b space-y-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm bg-white text-gray-900"
                />
              </div>
              <div className="flex gap-1">
                <Btn variant={filterMode === "all" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("all")}>
                  Tous ({equipments.length})
                </Btn>
                <Btn variant={filterMode === "unplaced" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("unplaced")}>
                  Non placés ({equipments.filter(e => !placedIds.has(e.id)).length})
                </Btn>
                <Btn variant={filterMode === "placed" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("placed")}>
                  Placés ({placedIds.size})
                </Btn>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredEquipments.length === 0 ? (
                <EmptyState
                  icon={Cpu}
                  title="Aucun equipement"
                  description="Creez des equipements mobiles pour les voir ici"
                />
              ) : (
                filteredEquipments.map((eq) => (
                  <EquipmentCard
                    key={eq.id}
                    equipment={eq}
                    isPlacedHere={placedHereIds.has(eq.id)}
                    isPlacedSomewhere={placedIds.has(eq.id)}
                    isPlacedElsewhere={placedIds.has(eq.id) && !placedHereIds.has(eq.id)}
                    isSelected={selectedEquipment?.id === eq.id}
                    onClick={() => handleSelectEquipment(eq)}
                    onPlace={handleStartPlacement}
                  />
                ))
              )}
            </div>

            <div className="p-3 border-t bg-gray-50 text-xs text-gray-500 text-center">
              {placedIds.size} / {equipments.length} équipements placés
            </div>
          </div>
        )}
      </div>

      {/* Mobile FAB - List toggle */}
      {isMobile && !sidebarOpen && !placementMode && !createMode && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed bottom-6 right-4 z-40 w-14 h-14 bg-gradient-to-br from-cyan-500 to-teal-600 text-white rounded-full shadow-xl flex items-center justify-center active:scale-95 transition-transform"
          style={{ touchAction: 'manipulation' }}
        >
          <Cpu size={24} />
          {equipments.filter(e => !placedIds.has(e.id)).length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
              {equipments.filter(e => !placedIds.has(e.id)).length}
            </span>
          )}
        </button>
      )}

      {/* Mobile Drawer */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />

          {/* Drawer from bottom */}
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col animate-slideUp safe-area-bottom">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="px-4 pb-3 flex items-center justify-between border-b">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Cpu size={20} className="text-cyan-500" />
                Équipements ({equipments.length})
              </h3>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {/* Search & Filters */}
            <div className="p-3 space-y-2 border-b">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm bg-white text-gray-900"
                />
              </div>
              <div className="flex gap-1">
                <Btn variant={filterMode === "all" ? "primary" : "ghost"} className="flex-1 text-xs py-2" onClick={() => setFilterMode("all")}>
                  Tous ({equipments.length})
                </Btn>
                <Btn variant={filterMode === "unplaced" ? "primary" : "ghost"} className="flex-1 text-xs py-2" onClick={() => setFilterMode("unplaced")}>
                  Non placés ({equipments.filter(e => !placedIds.has(e.id)).length})
                </Btn>
                <Btn variant={filterMode === "placed" ? "primary" : "ghost"} className="flex-1 text-xs py-2" onClick={() => setFilterMode("placed")}>
                  Placés ({placedIds.size})
                </Btn>
              </div>
            </div>

            {/* Equipment List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 overscroll-contain">
              {filteredEquipments.length === 0 ? (
                <EmptyState
                  icon={Cpu}
                  title="Aucun équipement"
                  description="Créez des équipements mobiles pour les voir ici"
                />
              ) : (
                filteredEquipments.map((eq) => (
                  <EquipmentCard
                    key={eq.id}
                    equipment={eq}
                    isPlacedHere={placedHereIds.has(eq.id)}
                    isPlacedSomewhere={placedIds.has(eq.id)}
                    isPlacedElsewhere={placedIds.has(eq.id) && !placedHereIds.has(eq.id)}
                    isSelected={selectedEquipment?.id === eq.id}
                    onClick={() => {
                      handleSelectEquipment(eq);
                      setSidebarOpen(false);
                    }}
                    onPlace={(e) => {
                      handleStartPlacement(e);
                      setSidebarOpen(false);
                    }}
                  />
                ))
              )}
            </div>

            {/* Footer stats */}
            <div className="p-3 border-t bg-gray-50 text-xs text-gray-500 text-center">
              {placedIds.size} / {equipments.length} équipements placés
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => { setConfirmDelete(contextMenu.position); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Confirm delete modal */}
      <ConfirmModal
        open={!!confirmDelete}
        title="Détacher l'équipement"
        message={`Voulez-vous détacher "${confirmDelete?.name || "cet équipement"}" du plan ?`}
        danger
        onConfirm={() => handleDeletePosition(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
