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
import "../styles/atex-map.css"; // Styles de netteté pour les plans

// Mobile optimization
import { getOptimalImageFormat } from "../config/mobile-optimization.js";
import { getMarkerDraggableOption } from "../utils/mobile-marker-drag.js";

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
  ArrowUp,
  ArrowDown,
  Calendar,
  Clock,
  Upload,
  Plus,
  Link2,
  Loader2,
} from "lucide-react";

// Measurement tools for floor plans
import MeasurementTools from "../components/MeasurementTools";

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
    // Check "eh_user" localStorage (Bubble login stores user data here)
    if ((!email || !name) && localStorage.getItem("eh_user")) {
      try {
        const eu = JSON.parse(localStorage.getItem("eh_user"));
        const x = eu?.user || eu?.profile || eu;
        if (!email && x?.email) email = String(x.email);
        if (!name && (x?.name || x?.displayName))
          name = String(x.name || x.displayName);
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
  const cardRef = useRef(null);
  const isOverdue = controlStatus?.status === 'overdue';

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <div
      ref={cardRef}
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

/* ----------------------------- Detail Panel with Equipment Links ----------------------------- */
const DetailPanel = ({ position, board, onClose, onNavigate, onDelete, links = [], linksLoading = false, onAddLink, onDeleteLink, onLinkClick, currentPlan, currentPageIndex = 0, mapContainerRef }) => {
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

  // Search for equipment to link
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      console.log('[SWITCHBOARD_DETAIL] Searching for:', query, 'excluding switchboard:', position.switchboard_id);
      const res = await api.equipmentLinks.search(query, 'switchboard', position.switchboard_id);
      console.log('[SWITCHBOARD_DETAIL] Search results:', res);
      setSearchResults(res?.results || []);
    } catch (e) {
      console.error('[SWITCHBOARD_DETAIL] Search error:', e);
    } finally {
      setSearching(false);
    }
  };

  // Add a link with direction (upstream = target feeds this, downstream = this feeds target)
  const handleAddLinkClick = async (target, direction) => {
    try {
      // direction: 'upstream' means target is upstream (feeds this equipment)
      // direction: 'downstream' means target is downstream (this equipment feeds it)
      const linkLabel = direction || 'connected';
      await onAddLink?.({
        source_type: 'switchboard',
        source_id: String(position.switchboard_id),
        target_type: target.type,
        target_id: String(target.id),
        link_label: linkLabel
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
      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-2 text-white flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Zap size={16} />
            <span className="font-medium text-sm truncate font-mono">{position.code || board?.code || position.name || board?.name || "Tableau"}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0"><X size={16} /></button>
        </div>
      </div>
      <div className="p-2 overflow-y-auto flex-1">
        {/* Equipment Links Section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-700 flex items-center gap-1"><Link2 size={12} />Équipements liés</span>
            <button onClick={() => setShowAddLink(!showAddLink)} className="p-0.5 hover:bg-gray-100 rounded text-gray-500 hover:text-blue-600" title="Ajouter un lien"><Plus size={14} /></button>
          </div>
          {showAddLink && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-1.5 mb-1.5">
              <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)} placeholder="Rechercher..." className="w-full px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-500 bg-white" autoFocus />
              {searching && <div className="flex items-center gap-1 text-xs text-gray-500 mt-1"><Loader2 size={12} className="animate-spin" />Recherche...</div>}
              {searchResults.length > 0 && (
                <div className="mt-1.5 max-h-32 overflow-y-auto space-y-1">
                  {searchResults.map((result) => (
                    <div key={`${result.type}-${result.id}`} className="bg-white rounded border p-1.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs">{result.code || result.name}</span>
                        <span className="text-xs text-gray-500">{result.type}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => handleAddLinkClick(result, 'upstream')} className="flex-1 flex items-center justify-center gap-0.5 px-1.5 py-0.5 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded border border-green-300"><ArrowDown size={10} />Amont</button>
                        <button onClick={() => handleAddLinkClick(result, 'downstream')} className="flex-1 flex items-center justify-center gap-0.5 px-1.5 py-0.5 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded border border-red-300"><ArrowUp size={10} />Aval</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {linksLoading ? (
            <div className="flex items-center gap-1 text-xs text-gray-500 py-1"><Loader2 size={12} className="animate-spin" />Chargement...</div>
          ) : links.length === 0 ? (
            <p className="text-xs text-gray-400 py-0.5">Aucun équipement lié</p>
          ) : (
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {links.map((link, idx) => {
                const eq = link.linkedEquipment; const samePlan = isOnSamePlan(link);
                return (
                  <div key={link.id || idx} className={`flex items-center justify-between p-1.5 rounded text-xs ${samePlan ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}>
                    <button onClick={() => onLinkClick?.(link)} className="flex items-center gap-1.5 flex-1 text-left hover:underline min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      <span className="font-medium truncate">{eq?.code || eq?.name}</span>
                      {!samePlan && eq?.plan && <span className="text-blue-600 flex-shrink-0">(autre plan)</span>}
                    </button>
                    {link.type === 'manual' && link.id && <button onClick={() => onDeleteLink?.(link.id)} className="p-0.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-600 flex-shrink-0" title="Supprimer"><Trash2 size={12} /></button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button onClick={() => onNavigate(position.switchboard_id)} className="w-full py-2 px-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5">
          <ExternalLink size={14} />Voir détails
        </button>
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
      links = [], // Equipment links for polyline drawing
      currentPlan = null, // Current plan for link filtering
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
    const connectionsLayerRef = useRef(null); // Layer for equipment link polylines
    const svgRendererRef = useRef(null); // SVG renderer for polylines (CSS animations need SVG, not Canvas)
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

    // Debug: Log when links prop changes
    useEffect(() => {
      console.log('[VIEWER] Received links prop:', links);
      console.log('[VIEWER] links.length:', links.length);
      console.log('[VIEWER] currentPlan:', currentPlan);
      console.log('[VIEWER] selectedId:', selectedId);
    }, [links, currentPlan, selectedId]);

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

    // Draw connection lines between linked equipment
    const drawConnections = useCallback(() => {
      console.log('[POLYLINES] drawConnections called');
      console.log('[POLYLINES] links:', links);
      console.log('[POLYLINES] links.length:', links.length);
      console.log('[POLYLINES] currentPlan:', currentPlan);
      console.log('[POLYLINES] pageIndex:', pageIndex);

      const map = mapRef.current;
      const g = connectionsLayerRef.current;
      console.log('[POLYLINES] map exists:', !!map);
      console.log('[POLYLINES] connectionsLayer exists:', !!g);

      if (!map || !g) {
        console.log('[POLYLINES] ABORT: no map or connections layer');
        return;
      }

      // Clear existing connections
      g.clearLayers();

      // If no selected equipment or no links, nothing to draw
      console.log('[POLYLINES] selectedIdRef.current:', selectedIdRef.current);
      if (!selectedIdRef.current || !links.length) {
        console.log('[POLYLINES] ABORT: no selectedId or no links');
        return;
      }

      // Debug: list all markers in the map
      console.log('[POLYLINES] markersMapRef keys:', Array.from(markersMapRef.current.keys()));

      // Get selected marker position
      const selectedMarker = markersMapRef.current.get(String(selectedIdRef.current));
      console.log('[POLYLINES] selectedMarker found:', !!selectedMarker, 'for key:', String(selectedIdRef.current));

      if (!selectedMarker) {
        console.log('[POLYLINES] ABORT: selected marker not found');
        return;
      }

      const sourceLatLng = selectedMarker.getLatLng();
      console.log('[POLYLINES] source position:', sourceLatLng);

      // Draw lines to linked equipment on the same plan
      let linesDrawn = 0;
      links.forEach((link, idx) => {
        console.log(`[POLYLINES] Processing link ${idx}:`, link);
        const eq = link.linkedEquipment;
        if (!eq) {
          console.log(`[POLYLINES] Link ${idx}: no linkedEquipment`);
          return;
        }

        // Check if on same plan and page
        const eqPlan = eq.plan_key || eq.plan;
        const eqPage = eq.page_index ?? eq.pageIndex ?? 0;
        const currentPlanKey = currentPlan?.logical_name || currentPlan?.id;

        console.log(`[POLYLINES] Link ${idx}: eq.hasPosition=${eq.hasPosition}, eqPlan=${eqPlan}, currentPlanKey=${currentPlanKey}, eqPage=${eqPage}, pageIndex=${pageIndex}`);

        if (!eq.hasPosition) {
          console.log(`[POLYLINES] Link ${idx}: SKIP - no position`);
          return;
        }
        if (eqPlan !== currentPlanKey) {
          console.log(`[POLYLINES] Link ${idx}: SKIP - different plan`);
          return;
        }
        if (eqPage !== pageIndex) {
          console.log(`[POLYLINES] Link ${idx}: SKIP - different page`);
          return;
        }

        // Find the target marker - could be switchboard_id or equipment_id
        const targetId = eq.equipment_id || eq.id;
        console.log(`[POLYLINES] Link ${idx}: looking for marker with targetId=${targetId}`);

        let targetMarker = markersMapRef.current.get(String(targetId));
        if (!targetMarker) {
          targetMarker = markersMapRef.current.get(targetId);
        }
        if (!targetMarker) {
          targetMarker = markersMapRef.current.get(Number(targetId));
        }

        console.log(`[POLYLINES] Link ${idx}: targetMarker found:`, !!targetMarker);
        if (!targetMarker) {
          console.log(`[POLYLINES] Link ${idx}: SKIP - target marker not found`);
          return;
        }

        const targetLatLng = targetMarker.getLatLng();
        console.log(`[POLYLINES] Link ${idx}: target position:`, targetLatLng);

        // Determine line style based on relationship/link_label
        let color = '#3b82f6'; // Blue default
        let hasDirection = false;
        let swapDirection = false; // If true, swap source/target to draw from upstream to downstream

        // Check relationship for direction (upstream/downstream)
        // Backend now correctly flips relationship based on whether we're source or target
        const linkLabel = link.relationship;

        if (linkLabel === 'upstream') {
          // Target is upstream = feeds this equipment
          // Line should go FROM target (upstream) TO source (downstream)
          color = '#10b981'; // Green
          hasDirection = true;
          swapDirection = true; // Swap to draw from upstream to downstream
        } else if (linkLabel === 'downstream') {
          // Target is downstream = this feeds target
          // Line should go FROM source (upstream) TO target (downstream)
          color = '#ef4444'; // Red
          hasDirection = true;
          swapDirection = false;
        } else if (link.relationship === 'feeds') {
          color = '#10b981'; // Green for feeds
          hasDirection = true;
          swapDirection = false;
        } else if (link.relationship === 'fed_by') {
          color = '#ef4444'; // Red for fed by
          hasDirection = true;
          swapDirection = true;
        } else if (link.type === 'hierarchical') {
          color = '#f59e0b'; // Amber for auto hierarchical
        }

        // Determine polyline points - always draw from upstream to downstream
        const lineStart = swapDirection ? targetLatLng : sourceLatLng;
        const lineEnd = swapDirection ? sourceLatLng : targetLatLng;

        // Create dashed polyline with animation class
        // Always use flow-to-target since line is always drawn upstream → downstream
        const animClass = hasDirection ? 'equipment-link-line flow-to-target' : 'equipment-link-line';

        const polyline = L.polyline([lineStart, lineEnd], {
          color,
          weight: 3,
          opacity: 0.8,
          dashArray: '10, 5',
          className: animClass,
          pane: 'connectionsPane',
          renderer: svgRendererRef.current
        });

        polyline.addTo(g);

        linesDrawn++;
      });

      console.log(`[POLYLINES] Total lines drawn: ${linesDrawn}`);
    }, [links, currentPlan, pageIndex]);

    // Redraw connections when links or selection changes
    useEffect(() => {
      console.log('[POLYLINES] useEffect triggered - calling drawConnections');
      drawConnections();
    }, [links, selectedId, drawConnections]);

    function makeSwitchboardIcon(isPrincipal = false, isSelected = false, switchboardId = null, categoryColor = null) {
      // Debug: log category color usage
      if (categoryColor) {
        console.log('[SB-MAP] Making icon with categoryColor:', switchboardId, categoryColor);
      }

      const s = isSelected ? ICON_PX_SELECTED : ICON_PX;

      // Check control status for this switchboard
      const controlStatus = switchboardId ? controlStatusesRef.current[switchboardId] : null;
      const isOverdue = controlStatus?.status === 'overdue';
      const isUpcoming = controlStatus?.status === 'upcoming';

      // Colors aligned with UnifiedEquipmentMap STATUS_COLORS
      let bg;
      let animClass = "";

      if (isSelected) {
        bg = "background: radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed);"; // Purple - selected
        animClass = "sb-marker-selected";
      } else if (isOverdue) {
        bg = "background: radial-gradient(circle at 30% 30%, #ef4444, #dc2626);"; // Red - overdue
        animClass = "sb-marker-overdue";
      } else if (isUpcoming) {
        bg = "background: radial-gradient(circle at 30% 30%, #f59e0b, #d97706);"; // Amber - upcoming
      } else if (categoryColor) {
        // Use category color with darker shade for gradient
        const darkerColor = categoryColor.replace(/^#/, '');
        bg = `background: radial-gradient(circle at 30% 30%, ${categoryColor}cc, ${categoryColor});`; // Category color
      } else if (isPrincipal) {
        bg = "background: radial-gradient(circle at 30% 30%, #10b981, #059669);"; // Emerald - principal
      } else {
        bg = "background: radial-gradient(circle at 30% 30%, #f59e0b, #ea580c);"; // Amber - Switchboard default
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
          const icon = makeSwitchboardIcon(!!p.is_principal, isSelected, p.switchboard_id, p.category_color);

          const wantsDraggable = !disabled && !placementActiveRef.current;
          const mk = L.marker(latlng, {
            icon,
            draggable: getMarkerDraggableOption(wantsDraggable),
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
            category_id: p.category_id,
            category_name: p.category_name,
            category_color: p.category_color,
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

            onClickPoint?.({ ...mk.__meta, markerScreenPos });
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
            // Ne pas afficher le menu si le drag mobile est actif
            if (mk._mobileDragActive) return;
            const containerPoint = map.latLngToContainerPoint(e.latlng);
            const rect = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
            onContextMenu?.(mk.__meta, {
              x: rect.left + containerPoint.x,
              y: rect.top + containerPoint.y,
            });
          });

          mk.addTo(g);
          // Store marker with string key for consistent lookup
          const markerKey = String(p.switchboard_id);
          markersMapRef.current.set(markerKey, mk);
          console.log('[MARKERS] Registered marker with key:', markerKey, 'type:', typeof markerKey);

          // 📱 Mobile: activer le drag par long-press uniquement
          if (wantsDraggable) {
          }

          // Setup long press after marker is added
          setTimeout(() => {
            const el = mk.getElement();
            if (!el) return;

            const startLongPress = (clientX, clientY) => {
              longPressTriggeredRef.current = false;
              longPressTimerRef.current = setTimeout(() => {
                // Ne pas afficher le menu si le drag mobile est actif
                if (mk._mobileDragActive) return;
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
      // Try to find marker with the ID as-is first, then try with type conversion
      let mk = markersMapRef.current.get(switchboardId);
      if (!mk) mk = markersMapRef.current.get(String(switchboardId));
      if (!mk) mk = markersMapRef.current.get(Number(switchboardId));
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

          // Créer un pane personnalisé pour les connexions avec z-index élevé
          const connectionsPane = m.createPane('connectionsPane');
          connectionsPane.style.zIndex = 450; // Au-dessus de overlayPane (400) mais sous markerPane (600)
          // SVG renderer pour les polylines (CSS animations ne fonctionnent qu'avec SVG, pas Canvas)
          svgRendererRef.current = L.svg({ pane: 'connectionsPane' });

          // Créer le layer group pour les connexions (polylines) - au-dessus des markers
          connectionsLayerRef.current = L.layerGroup().addTo(m);

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
      getMapRef: () => mapRef.current,
      getImageBounds: () => imgSize.w > 0 ? [[0, 0], [imgSize.h, imgSize.w]] : null,
      getImageSize: () => imgSize,
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
        // Debug: log raw API response
        console.log('[SB-MAP] Raw API response:', {
          hasPositions: Array.isArray(r?.positions),
          count: r?.positions?.length || 0,
          samplePosition: r?.positions?.[0] ? {
            switchboard_id: r.positions[0].switchboard_id,
            category_id: r.positions[0].category_id,
            category_color: r.positions[0].category_color
          } : null
        });

        const list = Array.isArray(r?.positions)
          ? r.positions.map((item) => {
              return {
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
                category_id: item.category_id,
                category_name: item.category_name || "",
                category_color: item.category_color || "",
              };
            })
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
  const [createMode, setCreateMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showSidebar, setShowSidebar] = useState(true);

  // Ref to prevent double creation
  const creatingRef = useRef(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null); // { position, x, y }

  // Control status for each switchboard { id: { status: 'ok'|'pending'|'overdue'|'upcoming' } }
  const [controlStatuses, setControlStatuses] = useState({});
  // Upcoming controls in next 30 days
  const [upcomingControls, setUpcomingControls] = useState([]);
  const [showUpcomingPanel, setShowUpcomingPanel] = useState(false);

  // Equipment links
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);

  // confirm modal state
  const [confirmState, setConfirmState] = useState({
    open: false,
    position: null,
  });

  const viewerRef = useRef(null);
  const mapContainerRef = useRef(null);

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

  // Handle URL params for navigation from list page
  useEffect(() => {
    const urlSwitchboardId = searchParams.get('switchboard');
    const urlPlanKey = searchParams.get('plan');

    if (urlPlanKey && plans.length > 0) {
      const targetPlan = plans.find(p => p.logical_name === urlPlanKey);
      if (targetPlan) {
        if (urlSwitchboardId) targetSwitchboardIdRef.current = Number(urlSwitchboardId);

        if (!selectedPlan || selectedPlan.logical_name !== targetPlan.logical_name) {
          setPdfReady(false);
          setSelectedPlan(targetPlan);
          setPageIndex(0);
          refreshPositions(targetPlan, 0).then(positions => setInitialPoints(positions || []));
        } else {
          setPdfReady(false);
          setTimeout(() => setPdfReady(true), 100);
        }
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, plans, selectedPlan, setSearchParams, refreshPositions]);

  // Initial plan selection from localStorage
  useEffect(() => {
    if (plans.length > 0 && !selectedPlan) {
      const urlPlanKey = searchParams.get('plan');
      if (urlPlanKey) return;

      let planToSelect = null;
      let pageIdx = 0;

      const savedPlanKey = localStorage.getItem(STORAGE_KEY_PLAN);
      const savedPageIndex = localStorage.getItem(STORAGE_KEY_PAGE);
      if (savedPlanKey) planToSelect = plans.find(p => p.logical_name === savedPlanKey);
      if (planToSelect && savedPageIndex) pageIdx = Number(savedPageIndex) || 0;

      if (!planToSelect) planToSelect = plans[0];

      setSelectedPlan(planToSelect);
      setPageIndex(pageIdx);

      if (planToSelect) {
        refreshPositions(planToSelect, pageIdx).then(positions => setInitialPoints(positions || []));
      }
    }
  }, [plans, selectedPlan, searchParams, refreshPositions]);

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
  // Only highlight the marker, don't open detail panel to avoid hiding the plan
  useEffect(() => {
    if (!pdfReady || !targetSwitchboardIdRef.current) return;

    const targetId = targetSwitchboardIdRef.current;
    targetSwitchboardIdRef.current = null; // Clear after use

    // Small delay to ensure markers are rendered
    setTimeout(async () => {
      // Highlight the marker on the map (zoom + visual highlight)
      viewerRef.current?.highlightMarker(targetId);

      // Don't auto-open the detail panel - let user click on marker if they want details
      // This keeps the plan visible and unobstructed
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
  // Also tracks upcoming controls in next 30 days
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
      const upcoming30Days = [];
      // Use date-only comparison to fix "today" items being marked as overdue
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      schedules.forEach(s => {
        const boardId = s.switchboard_id;
        if (!boardId) return;
        const nextDue = s.next_due ? new Date(s.next_due) : null;
        if (!nextDue) return;
        nextDue.setHours(0, 0, 0, 0);

        const isOverdue = nextDue < now;
        const isUpcoming = !isOverdue && nextDue <= in30Days;

        // Track upcoming in next 30 days
        if (isUpcoming || isOverdue) {
          upcoming30Days.push({
            ...s,
            isOverdue,
            daysUntil: isOverdue
              ? -Math.ceil((now - nextDue) / (1000 * 60 * 60 * 24))
              : Math.ceil((nextDue - now) / (1000 * 60 * 60 * 24))
          });
        }

        const existing = statuses[boardId];
        // Prioritize overdue status
        if (!existing || (isOverdue && existing.status !== 'overdue')) {
          statuses[boardId] = {
            status: isOverdue ? 'overdue' : (isUpcoming ? 'upcoming' : 'pending'),
            next_due: nextDue,
            template_name: s.template_name
          };
        }
      });

      // Sort by date
      upcoming30Days.sort((a, b) => (a.next_due || 0) - (b.next_due || 0));
      setControlStatuses(statuses);
      setUpcomingControls(upcoming30Days);
    } catch (e) {
      console.warn('Load control statuses error:', e);
    }
  };

  // Load equipment links
  const loadEquipmentLinks = async (switchboardId) => {
    console.log('[SWITCHBOARD_MAP] loadEquipmentLinks called with id:', switchboardId);
    if (!switchboardId) {
      console.log('[SWITCHBOARD_MAP] No switchboardId, clearing links');
      setLinks([]);
      return;
    }
    setLinksLoading(true);
    try {
      console.log('[SWITCHBOARD_MAP] Fetching links for switchboard:', switchboardId);
      const res = await api.equipmentLinks.getLinks('switchboard', switchboardId);
      console.log('[SWITCHBOARD_MAP] Links response:', res);
      setLinks(res?.links || []);
    } catch (err) {
      console.error("[SWITCHBOARD_MAP] Error loading equipment links:", err);
      setLinks([]);
    } finally {
      setLinksLoading(false);
    }
  };

  // Add a new link
  const handleAddLink = async (linkData) => {
    try {
      await api.equipmentLinks.createLink(linkData);
      if (selectedPosition) {
        loadEquipmentLinks(selectedPosition.switchboard_id);
      }
    } catch (err) {
      console.error("Error creating link:", err);
    }
  };

  // Delete a link
  const handleDeleteLink = async (linkId) => {
    try {
      await api.equipmentLinks.deleteLink(linkId);
      if (selectedPosition) {
        loadEquipmentLinks(selectedPosition.switchboard_id);
      }
    } catch (err) {
      console.error("Error deleting link:", err);
    }
  };

  // Handle click on a linked equipment
  const handleLinkClick = async (link) => {
    const eq = link.linkedEquipment;
    if (!eq) return;

    const currentPlanKey = stableSelectedPlan?.logical_name;

    // If on same plan, find and select the marker
    if (eq.hasPosition && eq.plan === currentPlanKey && (eq.pageIndex || 0) === pageIndex) {
      const targetPos = initialPoints.find(
        p => String(p.switchboard_id) === String(eq.id)
      );
      if (targetPos) {
        setSelectedPosition(targetPos);
        loadEquipmentLinks(eq.id);
        viewerRef.current?.highlightMarker?.(eq.id);
      }
    } else if (eq.hasPosition && eq.plan) {
      // Navigate to the other plan and highlight the target equipment
      const targetPlan = plans.find(p => p.logical_name === eq.plan);
      if (targetPlan) {
        const targetPageIndex = eq.pageIndex !== undefined ? eq.pageIndex : 0;

        // Reset state and switch to target plan
        setSelectedPlan(targetPlan);
        setPageIndex(targetPageIndex);
        setPdfReady(false);
        setInitialPoints([]);

        // Close current detail panel during transition
        setSelectedPosition(null);
        setLinks([]);

        // Wait for positions to load
        const positions = await refreshPositions(targetPlan, targetPageIndex);
        setInitialPoints(positions || []);

        // Find and select the target equipment after positions are loaded
        const targetPos = (positions || []).find(
          p => String(p.switchboard_id) === String(eq.id)
        );

        // Small delay to let viewer render markers, then highlight and select
        setTimeout(() => {
          if (targetPos) {
            setSelectedPosition(targetPos);
            loadEquipmentLinks(eq.id);
          }
          // Always highlight to show the user which equipment it is (flash animation)
          viewerRef.current?.highlightMarker?.(eq.id);
        }, 500);
      }
    } else {
      // No position - navigate to equipment detail page
      navigate(`/app/switchboard/${eq.id}`);
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

  // Create a new switchboard directly from the plan
  const createBoardAtFrac = async (xFrac, yFrac) => {
    if (creatingRef.current) return;
    if (!stableSelectedPlan) return;

    creatingRef.current = true;
    try {
      // Create switchboard with auto-generated name and code
      const now = new Date();
      const timestamp = now.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const code = `NEW-${now.getTime().toString(36).toUpperCase()}`;
      const created = await api.switchboard.createBoard({
        name: `Nouveau tableau ${timestamp}`,
        code: code
      });
      const id = created?.id || created?.switchboard?.id || created?.board?.id;
      if (!id) throw new Error("Échec création tableau électrique");

      // Set position on the plan
      await api.switchboardMaps.setPosition({
        switchboard_id: id,
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id || null,
        page_index: pageIndex,
        x_frac: xFrac,
        y_frac: yFrac,
      });

      // Reload data
      await loadSwitchboards();
      const positions = await refreshPositions(stableSelectedPlan, pageIndex);
      setInitialPoints(positions || []);
      await refreshPlacedIds();

      // Open the switchboard detail page
      navigate(`/app/switchboards?board=${id}`);
    } catch (err) {
      console.error("Erreur création tableau électrique:", err);
      alert("Erreur lors de la création du tableau électrique");
    } finally {
      creatingRef.current = false;
      setCreateMode(false);
    }
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

      // Preserve markerScreenPos for panel positioning beside marker
      setSelectedPosition({ ...pos, markerScreenPos: positionMeta.markerScreenPos });
      loadEquipmentLinks(pos.switchboard_id);

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

  // Callback stable pour création de point (mode placement ou création)
  const handleCreatePoint = useCallback(
    async (xFrac, yFrac) => {
      if (createMode) {
        await createBoardAtFrac(xFrac, yFrac);
      } else if (placementMode && stableSelectedPlan) {
        await handleSetPosition(placementMode, xFrac, yFrac);
      }
    },
    [placementMode, createMode, stableSelectedPlan, pageIndex]
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
  // Smart navigation: navigate to the correct plan and highlight the marker
  // Note: We only highlight the marker, we DON'T auto-open the detail panel
  // User must click on the marker to open the detail panel
  const handleSwitchboardClick = useCallback(
    async (board) => {
      setContextMenu(null);
      // Clear any existing selection - user must click marker to see details
      setSelectedPosition(null);
      setSelectedBoard(null);

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

            // Wait for plan to load, then highlight (zoom + flash only, no modal)
            const positions = await refreshPositions(targetPlan, 0);
            setInitialPoints(positions || []);

            // Small delay to let viewer render, then just highlight
            setTimeout(() => {
              viewerRef.current?.highlightMarker(board.id);
            }, 500);
          } else {
            // Same plan - just highlight (zoom + flash), no modal
            viewerRef.current?.highlightMarker(board.id);
          }
        }
      }
      // If not placed, do nothing - no modal to show

      // On mobile, close sidebar so user can see the map
      if (isMobile) setShowSidebar(false);
    },
    [plans, stableSelectedPlan, placedDetails, refreshPositions, isMobile]
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

            {/* Upcoming Controls Button */}
            <button
              onClick={() => setShowUpcomingPanel(!showUpcomingPanel)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
                showUpcomingPanel
                  ? 'bg-amber-500 text-white'
                  : upcomingControls.length > 0
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Controles a venir (30 jours)"
            >
              <Calendar size={14} />
              <span className="hidden md:inline">30j</span>
              {upcomingControls.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  showUpcomingPanel ? 'bg-white text-amber-600' : 'bg-amber-500 text-white'
                }`}>
                  {upcomingControls.length}
                </span>
              )}
            </button>

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

            {/* Create mode indicator */}
            {createMode && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slideUp">
                <div className="flex items-center gap-3 px-4 py-3 bg-yellow-600 text-white rounded-2xl shadow-xl">
                  <Crosshair size={20} className="animate-pulse" />
                  <div>
                    <p className="font-semibold">Mode création actif</p>
                    <p className="text-xs text-yellow-200">Cliquez sur le plan pour créer un nouveau tableau électrique</p>
                  </div>
                  <button onClick={() => setCreateMode(false)} className="p-2 hover:bg-white/20 rounded-lg transition-colors ml-2">
                    <X size={18} />
                  </button>
                </div>
              </div>
            )}

            {loadingPlans || !selectedPlan ? (
              <EmptyState
                icon={MapIcon}
                title="Aucun plan"
                description="Aucun plan disponible."
              />
            ) : (
              <div ref={mapContainerRef} className="relative h-full">
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
                  links={links}
                  currentPlan={stableSelectedPlan}
                  placementActive={!!placementMode || createMode}
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

                {/* Floating toolbar inside Leaflet */}
                <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-[5000] flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setCreateMode(true);
                      setPlacementMode(null);
                      setSelectedPosition(null);
                      setSelectedBoard(null);
                    }}
                    disabled={createMode}
                    className="w-11 h-11 sm:w-10 sm:h-10 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-xl border-none bg-gradient-to-br from-yellow-500 to-amber-600 text-white shadow-lg cursor-pointer text-lg flex items-center justify-center transition-all hover:from-yellow-400 hover:to-amber-500 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ touchAction: 'manipulation' }}
                    title="Créer un nouveau tableau électrique"
                  >
                    <Plus size={20} />
                  </button>
                </div>

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
            {!placementMode && !createMode && (
              <DetailPanel
                position={selectedPosition}
                board={selectedBoard}
                onClose={() => {
                  setSelectedPosition(null);
                  setSelectedBoard(null);
                  setLinks([]);
                }}
                onNavigate={handleNavigateToBoard}
                onDelete={(pos) => askDeletePosition(pos)}
                links={links}
                linksLoading={linksLoading}
                onAddLink={handleAddLink}
                onDeleteLink={handleDeleteLink}
                onLinkClick={handleLinkClick}
                currentPlan={stableSelectedPlan?.logical_name}
                currentPageIndex={pageIndex}
                mapContainerRef={mapContainerRef}
              />
            )}

            {/* Upcoming Controls Panel */}
            {showUpcomingPanel && (
              <div className="absolute top-4 right-4 w-80 max-h-[60vh] bg-white rounded-2xl shadow-2xl border overflow-hidden z-40 animate-slideUp">
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar size={18} />
                    <span className="font-semibold">Contrôles à venir (30j)</span>
                  </div>
                  <button
                    onClick={() => setShowUpcomingPanel(false)}
                    className="p-1 hover:bg-white/20 rounded-lg transition"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="overflow-y-auto max-h-[calc(60vh-52px)]">
                  {upcomingControls.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                      <Calendar size={32} className="mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">Aucun contrôle prévu dans les 30 prochains jours</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {upcomingControls.map((ctrl, idx) => {
                        const isOverdue = ctrl.isOverdue;
                        const board = switchboards.find(b => b.id === ctrl.switchboard_id);

                        return (
                          <div
                            key={`${ctrl.id}-${idx}`}
                            className={`p-3 hover:bg-gray-50 cursor-pointer transition ${
                              isOverdue ? 'bg-red-50' : ''
                            }`}
                            onClick={() => {
                              if (board) {
                                handleSwitchboardClick(board);
                              }
                              setShowUpcomingPanel(false);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`font-mono font-semibold text-sm ${
                                    isOverdue ? 'text-red-700' : 'text-gray-900'
                                  }`}>
                                    {ctrl.switchboard_code || board?.code || `#${ctrl.switchboard_id}`}
                                  </span>
                                  {isOverdue && (
                                    <Badge variant="danger">En retard</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 truncate mt-0.5">
                                  {ctrl.template_name || 'Contrôle'}
                                </p>
                                {board && (
                                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                                    <span className="flex items-center gap-0.5">
                                      <Building2 size={10} />
                                      {board.meta?.building_code || '-'}
                                    </span>
                                    <span className="flex items-center gap-0.5">
                                      <Layers size={10} />
                                      {board.meta?.floor || '-'}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
                                isOverdue
                                  ? 'bg-red-100 text-red-700'
                                  : ctrl.daysUntil <= 7
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                <div className="flex items-center gap-1">
                                  <Clock size={12} />
                                  {isOverdue
                                    ? `${Math.abs(ctrl.daysUntil)}j en retard`
                                    : ctrl.daysUntil === 0
                                    ? "Aujourd'hui"
                                    : ctrl.daysUntil === 1
                                    ? 'Demain'
                                    : `${ctrl.daysUntil}j`
                                  }
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {upcomingControls.length > 0 && (
                  <div className="border-t px-4 py-2 bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
                    <span>
                      {upcomingControls.filter(c => c.isOverdue).length} en retard •{' '}
                      {upcomingControls.filter(c => !c.isOverdue).length} à venir
                    </span>
                    <button
                      onClick={() => navigate('/app/switchboard-controls')}
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      Voir tous <ExternalLink size={10} />
                    </button>
                  </div>
                )}
              </div>
            )}
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
