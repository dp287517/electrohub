// src/pages/Switchboard_map.jsx
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

// PDF.js (comme VSD)
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

// Leaflet (comme VSD)
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// icons
import {
  Zap,
  Search,
  ChevronLeft,
  ChevronRight,
  Building2,
  Layers,
  MapPin,
  CheckCircle,
  AlertCircle,
  X,
  RefreshCw,
  Trash2,
  ExternalLink,
  Crosshair,
  Target,
  Map as MapIcon,
  List,
  ArrowLeft,
} from "lucide-react";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/* ----------------------------- LocalStorage Keys ----------------------------- */
const STORAGE_KEY_PLAN = "switchboard_map_selected_plan";
const STORAGE_KEY_PAGE = "switchboard_map_page_index";

/* ----------------------------- Helpers EXACT VSD ----------------------------- */
function getCookie(name) {
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + name + "=([^;]+)")
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function getIdentity() {
  let email = getCookie("email") || null;
  let name = getCookie("name") || null;
  try {
    if (!email)
      email =
        localStorage.getItem("email") ||
        localStorage.getItem("user.email") ||
        null;
    if (!name)
      name =
        localStorage.getItem("name") ||
        localStorage.getItem("user.name") ||
        null;
    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        if (!email && u?.email) email = String(u.email);
        if (!name && (u?.name || u?.displayName))
          name = String(u.name || u.displayName);
      } catch {}
    }
  } catch {}
  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    if (base)
      name = base
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
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

/* ----------------------------- UI Helpers ----------------------------- */
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

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
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        variants[variant]
      } ${className}`}
    >
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
    {description && (
      <p className="text-gray-500 mt-1 max-w-sm">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black placeholder-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}

function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
    ghost:
      "bg-white text-black border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
    danger:
      "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed",
    success:
      "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed",
    subtle:
      "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed",
  };
  return (
    <button
      className={`px-3 py-2 rounded-lg text-sm transition ${
        map[variant] || map.primary
      } ${className}`}
      {...p}
    >
      {children}
    </button>
  );
}

/* ----------------------------- Confirm Modal UI ----------------------------- */
function ConfirmModal({
  open,
  title = "Confirmation",
  message,
  confirmText = "Confirmer",
  cancelText = "Annuler",
  onConfirm,
  onCancel,
  danger = false,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[7000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-[92vw] max-w-md bg-white rounded-2xl shadow-2xl border overflow-hidden animate-slideUp">
        <div
          className={`px-4 py-3 ${
            danger
              ? "bg-gradient-to-r from-rose-500 to-red-600 text-white"
              : "bg-gradient-to-r from-blue-500 to-indigo-600 text-white"
          }`}
        >
          <h3 className="font-semibold">{title}</h3>
        </div>
        <div className="p-4 text-sm text-gray-700">{message}</div>
        <div className="px-4 pb-4 flex gap-2 justify-end">
          <Btn variant="ghost" onClick={onCancel}>
            {cancelText}
          </Btn>
          <Btn variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmText}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Context Menu (Mobile + Desktop) ----------------------------- */
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
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 size={16} />
        Détacher du plan
      </button>
    </div>
  );
}

/* ----------------------------- Sidebar Card ----------------------------- */
const SwitchboardCard = ({
  board,
  isPlacedHere,
  isPlacedSomewhere,
  isPlacedElsewhere,
  isSelected,
  controlStatus, // { status: 'ok'|'pending'|'overdue', template_name }
  onClick,
  onPlace,
}) => {
  const isOverdue = controlStatus?.status === 'overdue';

  return (
    <div
      className={`p-3 rounded-xl border transition-all cursor-pointer group
        ${isOverdue ? "bg-red-50 border-red-300 ring-2 ring-red-200 animate-pulse" :
          isSelected
            ? "bg-blue-50 border-blue-300 shadow-sm"
            : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"
        }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-mono font-semibold text-sm ${
                isOverdue ? "text-red-700" :
                isSelected ? "text-blue-700" : "text-gray-900"
              }`}
            >
              {board.code}
            </span>
            {board.is_principal && <Badge variant="success">Principal</Badge>}
            {isPlacedElsewhere && (
              <Badge variant="purple">Placé ailleurs</Badge>
            )}
            {isOverdue && (
              <Badge variant="danger">⚠️ Contrôle en retard</Badge>
            )}
          </div>
          <p
            className={`text-xs truncate mt-0.5 ${
              isOverdue ? "text-red-600" :
              isSelected ? "text-blue-600" : "text-gray-500"
            }`}
          >
            {board.name}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <span className="flex items-center gap-0.5">
              <Building2 size={10} />
              {board.meta?.building_code || "-"}
            </span>
            <span className="flex items-center gap-0.5">
              <Layers size={10} />
              {board.meta?.floor || "-"}
            </span>
          </div>
          {isOverdue && controlStatus?.template_name && (
            <div className="mt-1 text-xs text-red-600 font-medium">
              📋 {controlStatus.template_name}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          {isPlacedHere ? (
            <span className="flex items-center gap-1 text-emerald-600 text-xs">
              <CheckCircle size={14} />
              Placé
            </span>
          ) : isPlacedSomewhere ? (
            <span className="flex items-center gap-1 text-purple-600 text-xs">
              <CheckCircle size={14} />
              Placé ailleurs
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 text-xs">
              <AlertCircle size={14} />
              Non placé
            </span>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlace(board);
            }}
            className="px-2 py-1 bg-blue-500 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
            title={
              isPlacedSomewhere ? "Déplacer sur ce plan" : "Placer sur ce plan"
            }
          >
            <Target size={12} />
            {isPlacedSomewhere ? "Déplacer" : "Placer"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ----------------------------- Detail Panel ----------------------------- */
const DetailPanel = ({ position, board, onClose, onNavigate, onDelete }) => {
  if (!position) return null;
  return (
    <AnimatedCard className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-white rounded-2xl shadow-2xl border overflow-hidden z-30">
      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-4 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/20 rounded-lg">
              <Zap size={20} />
            </div>
            <div>
              <h3 className="font-bold font-mono">
                {position.code || board?.code}
              </h3>
              <p className="text-blue-100 text-sm">
                {position.name || board?.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Bâtiment</span>
            <span className="font-semibold text-gray-900">
              {position.building || board?.meta?.building_code || "-"}
            </span>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Étage</span>
            <span className="font-semibold text-gray-900">
              {position.floor || board?.meta?.floor || "-"}
            </span>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Local</span>
            <span className="font-semibold text-gray-900">
              {position.room || board?.meta?.room || "-"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(position.is_principal || board?.is_principal) && (
            <Badge variant="success">Tableau Principal</Badge>
          )}
          {(position.regime_neutral || board?.regime_neutral) && (
            <Badge variant="info">
              {position.regime_neutral || board?.regime_neutral}
            </Badge>
          )}
        </div>

        <div className="text-xs text-gray-400 flex items-center gap-2">
          <MapPin size={12} />
          Position: {(position.x_frac * 100).toFixed(1)}%,{" "}
          {(position.y_frac * 100).toFixed(1)}%
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onNavigate(position.switchboard_id)}
            className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 transition-all flex items-center justify-center gap-2"
          >
            <ExternalLink size={16} />
            Ouvrir le tableau
          </button>

          <button
            onClick={() => onDelete?.(position)}
            className="py-2.5 px-3 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all flex items-center justify-center"
            title="Détacher du plan"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </AnimatedCard>
  );
};

const PlacementModeIndicator = ({ board, onCancel }) => (
  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30">
    <div className="bg-blue-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-slideUp">
      <div className="p-2 bg-white/20 rounded-lg">
        <Crosshair size={20} className="animate-pulse" />
      </div>
      <div>
        <p className="font-semibold">Mode placement actif</p>
        <p className="text-blue-200 text-sm">
          Cliquez sur le plan pour placer{" "}
          <span className="font-mono">{board.code}</span>
        </p>
      </div>
      <button
        onClick={onCancel}
        className="p-2 hover:bg-white/20 rounded-lg transition-colors ml-2"
      >
        <X size={18} />
      </button>
    </div>
  </div>
);

/* ----------------------------- Leaflet Viewer (ENHANCED) ----------------------------- */
const SwitchboardLeafletViewer = forwardRef(
  (
    {
      fileUrl,
      pageIndex = 0,
      initialPoints = [],
      selectedId = null,
      controlStatuses = {}, // { switchboard_id: { status: 'ok'|'pending'|'overdue' } }
      onReady,
      onMovePoint,
      onClickPoint,
      onCreatePoint,
      onContextMenu,
      disabled = false,
      placementActive = false,
    },
    ref
  ) => {
    const wrapRef = useRef(null);
    const mapRef = useRef(null);
    const imageLayerRef = useRef(null);
    const markersLayerRef = useRef(null);
    const markersMapRef = useRef(new Map()); // switchboard_id -> marker

    const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
    const [picker, setPicker] = useState(null);

    const pointsRef = useRef(initialPoints);
    const selectedIdRef = useRef(selectedId);
    const placementActiveRef = useRef(placementActive);
    const aliveRef = useRef(true);

    // Zoom persistant (exact VSD)
    const lastViewRef = useRef({ center: [0, 0], zoom: 0 });
    const initialFitDoneRef = useRef(false);
    const userViewTouchedRef = useRef(false);

    const lastJob = useRef({ key: null });
    const loadingTaskRef = useRef(null);
    const renderTaskRef = useRef(null);

    // Long press pour mobile
    const longPressTimerRef = useRef(null);
    const longPressTriggeredRef = useRef(false);

    // Ref pour onCreatePoint (éviter rechargement du PDF quand le callback change)
    const onCreatePointRef = useRef(onCreatePoint);

    // Ref for control statuses
    const controlStatusesRef = useRef(controlStatuses);

    const ICON_PX = 22;
    const ICON_PX_SELECTED = 30;
    const PICK_RADIUS = Math.max(18, Math.floor(ICON_PX / 2) + 6);

    // Keep refs in sync
    useEffect(() => {
      placementActiveRef.current = placementActive;
    }, [placementActive]);

    // Keep onCreatePoint ref in sync
    useEffect(() => {
      onCreatePointRef.current = onCreatePoint;
    }, [onCreatePoint]);

    // Keep controlStatuses ref in sync and redraw markers when it changes
    useEffect(() => {
      controlStatusesRef.current = controlStatuses;
      // Redraw markers to update overdue status
      if (mapRef.current && imgSize.w > 0) {
        drawMarkers(pointsRef.current, imgSize.w, imgSize.h);
      }
    }, [controlStatuses]);

    // Update selectedIdRef when prop changes
    useEffect(() => {
      selectedIdRef.current = selectedId;
      // Re-draw markers to update selection state
      if (mapRef.current && imgSize.w > 0) {
        drawMarkers(pointsRef.current, imgSize.w, imgSize.h);
      }
    }, [selectedId]);

    function makeSwitchboardIcon(isPrincipal = false, isSelected = false, switchboardId = null) {
      const s = isSelected ? ICON_PX_SELECTED : ICON_PX;

      // Check control status for this switchboard
      const controlStatus = switchboardId ? controlStatusesRef.current[switchboardId] : null;
      const isOverdue = controlStatus?.status === 'overdue';

      let bg;
      let animClass = "";

      if (isSelected) {
        // Violet/bleu pulsant pour la sélection
        bg = "background: radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed);";
        animClass = "sb-marker-selected";
      } else if (isOverdue) {
        // ROUGE CLIGNOTANT pour contrôle en retard
        bg = "background: radial-gradient(circle at 30% 30%, #f87171, #dc2626);";
        animClass = "sb-marker-overdue";
      } else if (isPrincipal) {
        bg = "background: radial-gradient(circle at 30% 30%, #34d399, #0ea5a4);";
      } else {
        bg = "background: radial-gradient(circle at 30% 30%, #facc15, #f59e0b);";
      }

      const html = `
        <div class="${animClass}" style="width:${s}px;height:${s}px;${bg}border:2px solid white;border-radius:9999px;box-shadow:0 4px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;">
          <svg viewBox="0 0 24 24" width="${s * 0.55}" height="${s * 0.55}" fill="white" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
          </svg>
        </div>`;
      return L.divIcon({
        className: "sb-marker-inline",
        html,
        iconSize: [s, s],
        iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
        popupAnchor: [0, -Math.round(s / 2)],
      });
    }

    const drawMarkers = useCallback(
      (list, w, h) => {
        const map = mapRef.current;
        const g = markersLayerRef.current;
        if (!map || !g || w === 0 || h === 0) return;

        pointsRef.current = list;
        g.clearLayers();
        markersMapRef.current.clear();

        (list || []).forEach((p) => {
          const x = Number(p.x_frac ?? p.x ?? 0) * w;
          const y = Number(p.y_frac ?? p.y ?? 0) * h;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;

          const latlng = L.latLng(y, x);
          const isSelected = p.switchboard_id === selectedIdRef.current;
          const icon = makeSwitchboardIcon(!!p.is_principal, isSelected, p.switchboard_id);

          const mk = L.marker(latlng, {
            icon,
            draggable: !disabled && !placementActiveRef.current,
            autoPan: true,
            bubblingMouseEvents: false,
            keyboard: false,
            riseOnHover: true,
          });

          mk.__meta = {
            id: p.id,
            switchboard_id: p.switchboard_id,
            code: p.code,
            name: p.name,
            x_frac: p.x_frac,
            y_frac: p.y_frac,
            is_principal: p.is_principal,
            building: p.building,
            floor: p.floor,
            room: p.room,
            regime_neutral: p.regime_neutral,
          };

          // Click handler
          mk.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            if (longPressTriggeredRef.current) {
              longPressTriggeredRef.current = false;
              return;
            }
            setPicker(null);
            onClickPoint?.(mk.__meta);
          });

          // Drag handler
          mk.on("dragend", () => {
            if (!onMovePoint) return;
            const ll = mk.getLatLng();
            const xFrac = clamp(ll.lng / w, 0, 1);
            const yFrac = clamp(ll.lat / h, 0, 1);
            const xf = Math.round(xFrac * 1e6) / 1e6;
            const yf = Math.round(yFrac * 1e6) / 1e6;
            onMovePoint(mk.__meta.switchboard_id, { x: xf, y: yf });
          });

          // Context menu (right click - desktop)
          mk.on("contextmenu", (e) => {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            const containerPoint = map.latLngToContainerPoint(e.latlng);
            const rect = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
            onContextMenu?.(mk.__meta, {
              x: rect.left + containerPoint.x,
              y: rect.top + containerPoint.y,
            });
          });

          mk.addTo(g);
          markersMapRef.current.set(p.switchboard_id, mk);

          // Setup long press after marker is added
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
      },
      [onClickPoint, onMovePoint, onContextMenu, disabled]
    );

    // Highlight a specific marker (for navigation from sidebar)
    const highlightMarker = useCallback((switchboardId) => {
      const mk = markersMapRef.current.get(switchboardId);
      if (!mk || !mapRef.current) return;

      // Center on marker
      const ll = mk.getLatLng();
      mapRef.current.setView(ll, mapRef.current.getZoom(), { animate: true });

      // Flash animation
      const el = mk.getElement();
      if (el) {
        el.classList.add("sb-marker-flash");
        setTimeout(() => el.classList.remove("sb-marker-flash"), 2000);
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
          try {
            map.stop();
            map.off();
            map.eachLayer((l) => map.removeLayer(l));
            map.remove();
          } catch {}
        }
        mapRef.current = null;
        imageLayerRef.current = null;
        if (markersLayerRef.current) {
          try {
            markersLayerRef.current.clearLayers();
          } catch {}
          markersLayerRef.current = null;
        }
        markersMapRef.current.clear();
        initialFitDoneRef.current = false;
        userViewTouchedRef.current = false;
      };

      const cleanupPdf = async () => {
        try {
          renderTaskRef.current?.cancel();
        } catch {}
        try {
          await loadingTaskRef.current?.destroy();
        } catch {}
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

          const targetBitmapW = Math.min(
            4096,
            Math.max(2048, Math.floor(containerW * dpr * 1.5))
          );
          const safeScale = clamp(targetBitmapW / baseVp.width, 0.5, 3.0);
          const viewport = page.getViewport({ scale: safeScale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d", { alpha: true });

          renderTaskRef.current = page.render({ canvasContext: ctx, viewport });
          await renderTaskRef.current.promise;
          if (cancelled) return;

          const dataUrl = canvas.toDataURL("image/png");
          setImgSize({ w: canvas.width, h: canvas.height });

          const m = L.map(wrapRef.current, {
            crs: L.CRS.Simple,
            zoomControl: false,
            zoomAnimation: true,
            fadeAnimation: false,
            markerZoomAnimation: false,
            scrollWheelZoom: true,
            touchZoom: true,
            tap: false, // Disable tap to prevent issues with long press
            preferCanvas: true,
            center: lastViewRef.current.center,
            zoom: lastViewRef.current.zoom,
          });

          L.control.zoom({ position: "topright" }).addTo(m);
          mapRef.current = m;

          const bounds = L.latLngBounds([
            [0, 0],
            [viewport.height, viewport.width],
          ]);

          const layer = L.imageOverlay(dataUrl, bounds, {
            interactive: true,
            opacity: 1,
          });
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
            m.setView(lastViewRef.current.center, lastViewRef.current.zoom, {
              animate: false,
            });
          }

          m.setMaxZoom(fitZoom + 6);
          m.setMaxBounds(bounds.pad(0.5));

          // Créer le layer group pour les markers
          markersLayerRef.current = L.layerGroup().addTo(m);

          // Handler de clic sur la carte - utilise la ref pour onCreatePoint
          m.on("click", (e) => {
            if (!aliveRef.current) return;

            // Mode placement : créer un point (utilise la ref!)
            if (placementActiveRef.current && onCreatePointRef.current) {
              const ll = e.latlng;
              const xFrac = clamp(ll.lng / canvas.width, 0, 1);
              const yFrac = clamp(ll.lat / canvas.height, 0, 1);
              onCreatePointRef.current(xFrac, yFrac);
              return;
            }

            // Mode normal : chercher un marker proche
            const clicked = e.containerPoint;
            const near = [];

            markersLayerRef.current?.eachLayer((mk) => {
              const mp = m.latLngToContainerPoint(mk.getLatLng());
              const dist = Math.hypot(mp.x - clicked.x, mp.y - clicked.y);
              if (dist <= PICK_RADIUS) near.push(mk.__meta);
            });

            if (near.length === 1 && onClickPoint) {
              onClickPoint(near[0]);
            } else if (near.length > 1) {
              setPicker({ x: clicked.x, y: clicked.y, items: near });
            } else {
              setPicker(null);
            }
          });

          // Disable context menu on map (to allow marker context menu)
          m.on("contextmenu", (e) => {
            L.DomEvent.preventDefault(e);
          });

          m.on("zoomstart", () => {
            setPicker(null);
            userViewTouchedRef.current = true;
          });
          m.on("movestart", () => {
            setPicker(null);
            userViewTouchedRef.current = true;
          });
          m.on("zoomend", () => {
            lastViewRef.current.zoom = m.getZoom();
          });
          m.on("moveend", () => {
            lastViewRef.current.center = m.getCenter();
          });

          // Dessiner les markers avec les points initiaux
          drawMarkers(pointsRef.current, canvas.width, canvas.height);

          try {
            await pdf.cleanup();
          } catch {}
          onReady?.();
        } catch (e) {
          if (String(e?.name) === "RenderingCancelledException") return;
          const msg = String(e?.message || "");
          if (
            msg.includes("Worker was destroyed") ||
            msg.includes("Worker was terminated")
          )
            return;
          console.error("Switchboard Leaflet viewer error", e);
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
          const b = layer.getBounds();
          m.fitBounds(b, { padding: [8, 8] });
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
    }, [fileUrl, pageIndex, disabled]); // <-- onCreatePoint retiré des dépendances!

    // Synchroniser les points quand initialPoints change
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
      try {
        m.scrollWheelZoom?.disable();
      } catch {}
      m.invalidateSize(false);

      const fitZoom = m.getBoundsZoom(b, true);
      m.setMinZoom(fitZoom - 1);
      m.fitBounds(b, { padding: [8, 8] });

      lastViewRef.current.center = m.getCenter();
      lastViewRef.current.zoom = m.getZoom();
      initialFitDoneRef.current = true;
      userViewTouchedRef.current = false;

      setTimeout(() => {
        try {
          m.scrollWheelZoom?.enable();
        } catch {}
      }, 50);
    };

    useImperativeHandle(ref, () => ({
      adjust,
      drawMarkers: (list) => drawMarkers(list, imgSize.w, imgSize.h),
      highlightMarker,
    }));

    const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
    const wrapperHeight = Math.max(
      320,
      Math.min(imgSize.h || 720, viewportH - 180)
    );

    const onPickEquipment = useCallback(
      (it) => {
        setPicker(null);
        onClickPoint?.(it);
      },
      [onClickPoint]
    );

    return (
      <div className="mt-3 relative">
        <div className="flex items-center justify-end gap-2 mb-2">
          <Btn
            variant="ghost"
            aria-label="Ajuster le zoom au plan"
            onClick={adjust}
          >
            Ajuster
          </Btn>
        </div>

        <div
          ref={wrapRef}
          className="leaflet-wrapper relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
          style={{ height: wrapperHeight }}
        />

        {/* Picker pour sélection multiple */}
        {picker && (
          <div
            className="absolute bg-white border rounded-xl shadow-xl p-2 z-50"
            style={{
              left: Math.max(8, picker.x - 120),
              top: Math.max(8, picker.y - 8),
            }}
          >
            {picker.items.slice(0, 8).map((it) => (
              <button
                key={it.switchboard_id || it.id}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded-lg truncate"
                onClick={() => onPickEquipment(it)}
              >
                {it.code || it.name || it.switchboard_id}
              </button>
            ))}
            {picker.items.length > 8 && (
              <div className="text-xs text-gray-500 px-3 py-1">…</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1">
            <span
              className="w-3 h-3 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, #facc15, #f59e0b)",
              }}
            />
            Tableau
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="w-3 h-3 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, #34d399, #0ea5a4)",
              }}
            />
            Principal
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="w-3 h-3 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed)",
              }}
            />
            Sélectionné
          </span>
        </div>
      </div>
    );
  }
);

/* ----------------------------- Hook de gestion des positions ----------------------------- */
function useMapUpdateLogic(stableSelectedPlan, pageIndex, viewerRef) {
  const reloadPositionsRef = useRef(null);
  const latestPositionsRef = useRef([]);

  const loadPositions = useCallback(
    async (plan, pageIdx = 0) => {
      if (!plan) return [];
      const key = plan.id || plan.logical_name || "";
      try {
        const r = await api.switchboardMaps
          .positionsAuto(key, pageIdx)
          .catch(() => ({}));
        const list = Array.isArray(r?.positions)
          ? r.positions.map((item) => ({
              id: item.id,
              switchboard_id: item.switchboard_id,
              name: item.name || `Tableau #${item.switchboard_id}`,
              code: item.code || "",
              x_frac: Number(item.x_frac ?? item.x ?? 0),
              y_frac: Number(item.y_frac ?? item.y ?? 0),
              x: Number(item.x_frac ?? item.x ?? 0),
              y: Number(item.y_frac ?? item.y ?? 0),
              building: item.building || "",
              floor: item.floor || "",
              room: item.room || "",
              is_principal: item.is_principal || false,
              regime_neutral: item.regime_neutral || "",
            }))
          : [];

        latestPositionsRef.current = list;
        viewerRef.current?.drawMarkers(list);
        return list;
      } catch (e) {
        console.error("Erreur chargement positions", e);
        latestPositionsRef.current = [];
        viewerRef.current?.drawMarkers([]);
        return [];
      }
    },
    [viewerRef]
  );

  useEffect(() => {
    reloadPositionsRef.current = loadPositions;
  }, [loadPositions]);

  // Rafraîchissement périodique
  useEffect(() => {
    if (!stableSelectedPlan) return;

    const tick = () =>
      reloadPositionsRef.current?.(stableSelectedPlan, pageIndex);

    tick();

    const iv = setInterval(tick, 8000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [stableSelectedPlan, pageIndex]);

  const refreshPositions = useCallback((p, idx = 0) => {
    return reloadPositionsRef.current?.(p, idx);
  }, []);

  const getLatestPositions = useCallback(() => {
    return latestPositionsRef.current;
  }, []);

  return { refreshPositions, getLatestPositions };
}

/* ----------------------------- Main Page ----------------------------- */
export default function SwitchboardMap() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Track if we've handled URL params on initial load
  const urlParamsHandledRef = useRef(false);
  const targetSwitchboardIdRef = useRef(null);

  // Plans
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Positions (state initial pour le viewer)
  const [initialPoints, setInitialPoints] = useState([]);
  const [pdfReady, setPdfReady] = useState(false);

  // Switchboards
  const [switchboards, setSwitchboards] = useState([]);
  const [loadingSwitchboards, setLoadingSwitchboards] = useState(false);
  const [placedIds, setPlacedIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({}); // switchboard_id -> { plans: [...] }

  // UI
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [placementMode, setPlacementMode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null); // { position, x, y }

  // Control status for each switchboard { id: { status: 'ok'|'pending'|'overdue' } }
  const [controlStatuses, setControlStatuses] = useState({});

  // confirm modal state
  const [confirmState, setConfirmState] = useState({
    open: false,
    position: null,
  });

  const viewerRef = useRef(null);

  // Stabiliser le plan sélectionné
  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan]);

  // Stable plan URL
  const stableFileUrl = useMemo(() => {
    if (!stableSelectedPlan) return null;
    return api.switchboardMaps.planFileUrlAuto(stableSelectedPlan, {
      bust: true,
    });
  }, [stableSelectedPlan]);

  // Hook de gestion des positions
  const { refreshPositions, getLatestPositions } = useMapUpdateLogic(
    stableSelectedPlan,
    pageIndex,
    viewerRef
  );

  // Selected switchboard ID for highlighting
  const selectedSwitchboardId = useMemo(() => {
    return selectedPosition?.switchboard_id || null;
  }, [selectedPosition]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) setShowSidebar(false);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Load initial data
  useEffect(() => {
    loadPlans();
    loadSwitchboards();
    loadControlStatuses();
  }, []);

  // Restore plan from URL params or localStorage after plans loaded
  useEffect(() => {
    if (plans.length > 0 && !selectedPlan) {
      // Priority 1: URL params (navigation from Switchboards page)
      const urlSwitchboardId = searchParams.get('switchboard');
      const urlPlanKey = searchParams.get('plan');

      let planToSelect = null;
      let pageIdx = 0;

      if (urlPlanKey && !urlParamsHandledRef.current) {
        // Use URL param for plan
        planToSelect = plans.find(p => p.logical_name === urlPlanKey);
        if (urlSwitchboardId) {
          targetSwitchboardIdRef.current = Number(urlSwitchboardId);
        }
        urlParamsHandledRef.current = true;
        // Clear URL params after reading
        setSearchParams({}, { replace: true });
      }

      // Priority 2: localStorage (returning to page)
      if (!planToSelect) {
        const savedPlanKey = localStorage.getItem(STORAGE_KEY_PLAN);
        const savedPageIndex = localStorage.getItem(STORAGE_KEY_PAGE);

        if (savedPlanKey) {
          planToSelect = plans.find(p => p.logical_name === savedPlanKey);
        }
        if (planToSelect && savedPageIndex) {
          pageIdx = Number(savedPageIndex) || 0;
        }
      }

      // Fallback: first plan
      if (!planToSelect) {
        planToSelect = plans[0];
      }

      setSelectedPlan(planToSelect);
      setPageIndex(pageIdx);

      // Load positions
      if (planToSelect) {
        refreshPositions(planToSelect, pageIdx).then(positions => {
          setInitialPoints(positions || []);
        });
      }
    }
  }, [plans, searchParams, setSearchParams]);

  // Save plan to localStorage
  useEffect(() => {
    if (selectedPlan?.logical_name) {
      localStorage.setItem(STORAGE_KEY_PLAN, selectedPlan.logical_name);
    }
  }, [selectedPlan]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PAGE, String(pageIndex));
  }, [pageIndex]);

  // ✅ Auto-highlight switchboard from URL params after PDF is ready
  useEffect(() => {
    if (!pdfReady || !targetSwitchboardIdRef.current) return;

    const targetId = targetSwitchboardIdRef.current;
    targetSwitchboardIdRef.current = null; // Clear after use

    // Small delay to ensure markers are rendered
    setTimeout(async () => {
      // Highlight the marker on the map
      viewerRef.current?.highlightMarker(targetId);

      // Find and select the position
      const positions = getLatestPositions();
      const pos = positions.find(p => Number(p.switchboard_id) === targetId);

      if (pos) {
        setSelectedPosition(pos);
        try {
          const board = await api.switchboard.getBoard(targetId);
          setSelectedBoard(board);
        } catch (err) {
          console.error("Erreur chargement détails:", err);
        }
      }
    }, 300);
  }, [pdfReady, getLatestPositions]);

  const loadPlans = async () => {
    setLoadingPlans(true);
    try {
      const res = await api.switchboardMaps.listPlans();
      const plansArr = res?.plans || res || [];
      setPlans(plansArr);
    } catch (err) {
      console.error("Erreur chargement plans:", err);
    } finally {
      setLoadingPlans(false);
    }
  };

  const refreshPlacedIds = async () => {
    try {
      const placedRes = await api.switchboardMaps.placedIds();
      const ids = (placedRes?.placed_ids || placedRes || []).map((id) => Number(id));
      const details = placedRes?.placed_details || {};
      setPlacedIds(new Set(ids));
      setPlacedDetails(details);
    } catch (e) {
      console.error("Erreur chargement placements:", e);
      setPlacedIds(new Set());
      setPlacedDetails({});
    }
  };

  const loadSwitchboards = async () => {
    setLoadingSwitchboards(true);
    try {
      const res = await api.switchboard.listBoards({ pageSize: 500 });
      const list = res?.data || [];
      setSwitchboards(list);
      await refreshPlacedIds();
    } catch (err) {
      console.error("Erreur chargement switchboards:", err);
    } finally {
      setLoadingSwitchboards(false);
    }
  };

  // Load control statuses to show overdue switchboards in red
  const loadControlStatuses = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/switchboard/controls/schedules`, {
        headers: { 'X-Site': api.site, ...userHeaders() },
        credentials: 'include'
      });
      if (!res.ok) return;
      const data = await res.json();
      const schedules = data.schedules || [];

      const statuses = {};
      const now = new Date();
      schedules.forEach(s => {
        const boardId = s.switchboard_id;
        if (!boardId) return;
        const nextDue = s.next_due ? new Date(s.next_due) : null;
        if (!nextDue) return;

        const isOverdue = nextDue < now;
        const existing = statuses[boardId];
        // Prioritize overdue status
        if (!existing || (isOverdue && existing.status !== 'overdue')) {
          statuses[boardId] = {
            status: isOverdue ? 'overdue' : 'pending',
            next_due: nextDue,
            template_name: s.template_name
          };
        }
      });
      setControlStatuses(statuses);
    } catch (e) {
      console.warn('Load control statuses error:', e);
    }
  };

  const handleSetPositionById = async (switchboardId, xFrac, yFrac) => {
    if (!stableSelectedPlan || !switchboardId) return;
    try {
      await api.switchboardMaps.setPosition({
        switchboard_id: switchboardId,
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
      console.error("Erreur placement:", err);
    }
  };

  const handleSetPosition = async (board, xFrac, yFrac) => {
    if (!stableSelectedPlan || !board) return;
    return handleSetPositionById(board.id, xFrac, yFrac);
  };

  const askDeletePosition = (position) => {
    setContextMenu(null);
    setConfirmState({ open: true, position });
  };

  // REMPLACER handleDeletePosition:
  const handleDeletePosition = async (position) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/switchboard/maps/positions/${position.id}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "X-Site": api.site,
            ...userHeaders(),
          },
          credentials: "include",
        }
      );
      if (!response.ok) throw new Error("Delete failed");

      // Clear selection first to avoid stale state
      if (selectedPosition?.id === position.id) {
        setSelectedPosition(null);
        setSelectedBoard(null);
      }

      // Refresh in parallel, not sequentially
      const [positions] = await Promise.all([
        refreshPositions(stableSelectedPlan, pageIndex),
        refreshPlacedIds()
      ]);
      
      setInitialPoints(positions || []);
    } catch (err) {
      console.error("Erreur suppression:", err);
    }
  };

  const handlePositionClick = useCallback(
    async (positionMeta) => {
      setContextMenu(null);
      const positions = getLatestPositions();
      const pos =
        positions.find(
          (p) => p.switchboard_id === positionMeta.switchboard_id
        ) || positionMeta;

      setSelectedPosition(pos);

      try {
        const board = await api.switchboard.getBoard(pos.switchboard_id);
        setSelectedBoard(board);
      } catch (err) {
        console.error("Erreur chargement détails:", err);
        setSelectedBoard(null);
      }
    },
    [getLatestPositions]
  );

  const handleContextMenu = useCallback((positionMeta, coords) => {
    setContextMenu({
      position: positionMeta,
      x: coords.x,
      y: coords.y,
    });
  }, []);

  const handlePlaceBoard = (board) => {
    setPlacementMode(board);
    setSelectedPosition(null);
    setSelectedBoard(null);
    setContextMenu(null);
    if (isMobile) setShowSidebar(false);
  };

  const handleNavigateToBoard = (boardId) => {
    navigate(`/app/switchboards?board=${boardId}`);
  };

  // Callback stable pour déplacement de marker
  const handleMovePoint = useCallback(
    async (switchboardId, xy) => {
      if (!stableSelectedPlan) return;
      await handleSetPositionById(switchboardId, xy.x, xy.y);
    },
    [stableSelectedPlan, pageIndex]
  );

  // Callback stable pour création de point (mode placement)
  const handleCreatePoint = useCallback(
    async (xFrac, yFrac) => {
      if (!placementMode || !stableSelectedPlan) return;
      await handleSetPosition(placementMode, xFrac, yFrac);
    },
    [placementMode, stableSelectedPlan, pageIndex]
  );

  const currentPlanIds = useMemo(() => {
    const positions = getLatestPositions();
    return new Set(positions.map((p) => p.switchboard_id));
  }, [getLatestPositions, initialPoints]);

  const filteredSwitchboards = useMemo(() => {
    let filtered = switchboards;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.code?.toLowerCase().includes(q) ||
          b.name?.toLowerCase().includes(q) ||
          b.meta?.building_code?.toLowerCase().includes(q)
      );
    }

    if (filterMode === "placed") {
      filtered = filtered.filter((b) => placedIds.has(b.id));
    } else if (filterMode === "unplaced") {
      filtered = filtered.filter((b) => !placedIds.has(b.id));
    }

    return filtered;
  }, [switchboards, searchQuery, filterMode, placedIds]);

  const stats = useMemo(
    () => ({
      total: switchboards.length,
      placed: switchboards.filter((b) => placedIds.has(b.id)).length,
      unplaced: switchboards.filter((b) => !placedIds.has(b.id)).length,
    }),
    [switchboards, placedIds]
  );

  // Gestion du changement de plan
  const handlePlanChange = useCallback(
    async (plan) => {
      setSelectedPlan(plan);
      setPageIndex(0);
      setSelectedPosition(null);
      setSelectedBoard(null);
      setContextMenu(null);
      setPdfReady(false);
      setInitialPoints([]);
      if (plan) {
        const positions = await refreshPositions(plan, 0);
        setInitialPoints(positions || []);
      }
    },
    [refreshPositions]
  );

  // Navigate to switchboard's plan (from sidebar click)
  const handleSwitchboardClick = useCallback(
    async (board) => {
      setContextMenu(null);
      setSelectedBoard(board);
      
      // Check if this switchboard is placed somewhere
      const details = placedDetails[board.id];
      if (details?.plans?.length > 0) {
        const targetPlanKey = details.plans[0]; // First plan where it's placed
        
        // Find the plan
        const targetPlan = plans.find(p => p.logical_name === targetPlanKey);
        if (targetPlan) {
          // If we're not on that plan, switch to it
          if (stableSelectedPlan?.logical_name !== targetPlanKey) {
            setSelectedPlan(targetPlan);
            setPageIndex(0);
            setPdfReady(false);
            setInitialPoints([]);
            
            // Wait for plan to load, then highlight
            const positions = await refreshPositions(targetPlan, 0);
            setInitialPoints(positions || []);
            
            // Small delay to let viewer render
            setTimeout(() => {
              viewerRef.current?.highlightMarker(board.id);
              // Also set as selected
              const pos = positions?.find(p => Number(p.switchboard_id) === Number(board.id));
              if (pos) {
                setSelectedPosition(pos);
                api.switchboard.getBoard(board.id).then(setSelectedBoard).catch(() => {});
              }
            }, 500);
          } else {
            // Same plan - just highlight and select
            viewerRef.current?.highlightMarker(board.id);
            const positions = getLatestPositions();
            const pos = positions.find(p => Number(p.switchboard_id) === Number(board.id));
            if (pos) {
              handlePositionClick(pos);
            }
          }
        }
      } else {
        // Not placed - just show board info
        setSelectedPosition(null);
        setSelectedBoard(board);
      }
      
      if (isMobile) setShowSidebar(false);
    },
    [plans, stableSelectedPlan, placedDetails, refreshPositions, getLatestPositions, handlePositionClick, isMobile]
  );

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes pulse-selected {
          0%, 100% { 
            transform: scale(1); 
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.7);
          }
          50% { 
            transform: scale(1.15); 
            box-shadow: 0 0 0 8px rgba(139, 92, 246, 0);
          }
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
        .animate-slideUp { animation: slideUp .3s ease-out forwards; }
        .animate-slideRight { animation: slideRight .3s ease-out forwards; }
        .sb-marker-selected > div {
          animation: pulse-selected 1.5s ease-in-out infinite;
        }
        .sb-marker-flash > div {
          animation: flash-marker 2s ease-in-out;
        }
        @keyframes blink-overdue {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.7);
            opacity: 1;
          }
          50% {
            transform: scale(1.15);
            box-shadow: 0 0 12px 4px rgba(220, 38, 38, 0.5);
            opacity: 0.85;
          }
        }
        .sb-marker-overdue > div {
          animation: blink-overdue 1s ease-in-out infinite;
        }
        .sb-marker-inline { background: transparent !important; border: none !important; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/app/switchboards")}
              className="p-2 rounded-lg hover:bg-gray-100 transition"
              title="Retour Switchboards"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-yellow-100 rounded-xl">
                <MapIcon size={18} className="text-yellow-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">
                  Localisation des Switchboards
                </h1>
                <p className="text-xs text-gray-500">
                  Placez / déplacez les tableaux sur les plans
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs">
              <Badge variant="default">Total: {stats.total}</Badge>
              <Badge variant="success">Placés: {stats.placed}</Badge>
              <Badge variant="warning">Non placés: {stats.unplaced}</Badge>
            </div>

            {/* Légende des couleurs */}
            <div className="hidden sm:flex items-center gap-2 text-xs border-l pl-2 ml-1">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500" title="Principal"></span>
                <span className="text-gray-500">Principal</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500" title="Standard"></span>
                <span className="text-gray-500">Standard</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-gradient-to-br from-red-400 to-red-600 animate-pulse" title="Contrôle en retard"></span>
                <span className="text-red-600 font-medium">En retard</span>
              </span>
            </div>

            <Btn
              variant="ghost"
              onClick={() => setShowSidebar((v) => !v)}
              className="flex items-center gap-2"
            >
              <List size={16} />
              {showSidebar ? "Masquer" : "Afficher"} liste
            </Btn>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {showSidebar && (
          <div className="w-full max-w-[360px] bg-white border-r shadow-sm flex flex-col animate-slideRight">
            <div className="p-3 border-b space-y-2">
              <div className="relative">
                <Search
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                  size={16}
                />
                <Input
                  className="pl-8"
                  placeholder="Rechercher un tableau..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              </div>

              <div className="flex gap-2">
                <Btn
                  variant={filterMode === "all" ? "subtle" : "ghost"}
                  onClick={() => setFilterMode("all")}
                  className="flex-1 text-xs"
                >
                  Tous
                </Btn>
                <Btn
                  variant={filterMode === "placed" ? "subtle" : "ghost"}
                  onClick={() => setFilterMode("placed")}
                  className="flex-1 text-xs"
                >
                  Placés
                </Btn>
                <Btn
                  variant={filterMode === "unplaced" ? "subtle" : "ghost"}
                  onClick={() => setFilterMode("unplaced")}
                  className="flex-1 text-xs"
                >
                  Non placés
                </Btn>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingSwitchboards ? (
                <EmptyState
                  icon={RefreshCw}
                  title="Chargement..."
                  description="Récupération des tableaux"
                />
              ) : filteredSwitchboards.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="Aucun tableau"
                  description="Aucun switchboard ne correspond."
                />
              ) : (
                filteredSwitchboards.map((b) => {
                  const isPlacedHere = currentPlanIds.has(b.id);
                  const isPlacedSomewhere = placedIds.has(b.id);
                  const isPlacedElsewhere = isPlacedSomewhere && !isPlacedHere;
                  const isSelected =
                    selectedPosition?.switchboard_id === b.id ||
                    selectedBoard?.id === b.id;

                  return (
                    <SwitchboardCard
                      key={b.id}
                      board={b}
                      isPlacedHere={isPlacedHere}
                      isPlacedSomewhere={isPlacedSomewhere}
                      isPlacedElsewhere={isPlacedElsewhere}
                      isSelected={isSelected}
                      controlStatus={controlStatuses[b.id]}
                      onClick={() => handleSwitchboardClick(b)}
                      onPlace={handlePlaceBoard}
                    />
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Map Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Plan selector */}
          <div className="bg-white border-b px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <select
                className="border rounded-lg px-3 py-2 text-sm bg-white text-black"
                value={selectedPlan?.logical_name || ""}
                onChange={(e) => {
                  const p = plans.find(
                    (x) => x.logical_name === e.target.value
                  );
                  handlePlanChange(p || null);
                }}
              >
                {plans.map((p) => (
                  <option key={p.logical_name} value={p.logical_name}>
                    {p.display_name || p.logical_name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <Btn
                  variant="ghost"
                  onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                  disabled={pageIndex <= 0}
                  title="Page précédente"
                >
                  <ChevronLeft size={16} />
                </Btn>
                <span className="text-xs text-gray-600">
                  Page {pageIndex + 1} / {numPages}
                </span>
                <Btn
                  variant="ghost"
                  onClick={() =>
                    setPageIndex((i) => Math.min(numPages - 1, i + 1))
                  }
                  disabled={pageIndex >= numPages - 1}
                  title="Page suivante"
                >
                  <ChevronRight size={16} />
                </Btn>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Btn
                variant="ghost"
                onClick={async () => {
                  await loadPlans();
                  const positions = await refreshPositions(stableSelectedPlan, pageIndex);
                  setInitialPoints(positions || []);
                  await refreshPlacedIds();
                }}
                title="Rafraîchir"
              >
                <RefreshCw size={16} />
              </Btn>
            </div>
          </div>

          {/* Leaflet viewer */}
          <div className="relative flex-1 p-3 overflow-hidden">
            {placementMode && (
              <PlacementModeIndicator
                board={placementMode}
                onCancel={() => setPlacementMode(null)}
              />
            )}

            {loadingPlans || !selectedPlan ? (
              <EmptyState
                icon={MapIcon}
                title="Aucun plan"
                description="Aucun plan disponible."
              />
            ) : (
              <div className="relative h-full">
                {/* Loading overlay */}
                {!pdfReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-[99999] pointer-events-none rounded-2xl">
                    <div className="flex flex-col items-center gap-3 text-gray-700">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-600"></div>
                      <div className="text-sm font-medium">
                        Chargement du plan…
                      </div>
                    </div>
                  </div>
                )}

                <SwitchboardLeafletViewer
                  ref={viewerRef}
                  key={stableSelectedPlan?.logical_name || "none"}
                  fileUrl={stableFileUrl}
                  pageIndex={pageIndex}
                  initialPoints={initialPoints}
                  selectedId={selectedSwitchboardId}
                  controlStatuses={controlStatuses}
                  placementActive={!!placementMode}
                  onReady={() => {
                    setPdfReady(true);
                    // Charger le nombre de pages
                    (async () => {
                      try {
                        const t = pdfjsLib.getDocument(
                          pdfDocOpts(stableFileUrl)
                        );
                        const pdf = await t.promise;
                        setNumPages(pdf.numPages || 1);
                        await t.destroy();
                      } catch {}
                    })();
                  }}
                  onClickPoint={handlePositionClick}
                  onMovePoint={handleMovePoint}
                  onCreatePoint={handleCreatePoint}
                  onContextMenu={handleContextMenu}
                />
              </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
              <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                onDelete={() => askDeletePosition(contextMenu.position)}
                onClose={() => setContextMenu(null)}
              />
            )}

            {/* detail panel */}
            <DetailPanel
              position={selectedPosition}
              board={selectedBoard}
              onClose={() => {
                setSelectedPosition(null);
                setSelectedBoard(null);
              }}
              onNavigate={handleNavigateToBoard}
              onDelete={(pos) => askDeletePosition(pos)}
            />
          </div>
        </div>
      </div>

      {/* Confirm Detach Modal */}
      <ConfirmModal
        open={confirmState.open}
        title="Détacher du plan"
        message={
          confirmState.position
            ? `Supprimer le placement de ${
                confirmState.position.code || confirmState.position.name
              } ?`
            : ""
        }
        confirmText="Détacher"
        cancelText="Annuler"
        danger
        onCancel={() => setConfirmState({ open: false, position: null })}
        onConfirm={async () => {
          const pos = confirmState.position;
          setConfirmState({ open: false, position: null });
          if (pos) await handleDeletePosition(pos);
        }}
      />
    </div>
  );
}
