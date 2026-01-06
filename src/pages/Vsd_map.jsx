// src/pages/Vsd_map.jsx - Redesigned following Switchboard_map pattern
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
  ArrowUp,
  ArrowDown,
  Gauge,
  Zap,
  Plus,
  Link2,
  Loader2,
} from "lucide-react";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/* ----------------------------- LocalStorage Keys ----------------------------- */
const STORAGE_KEY_PLAN = "vsd_map_selected_plan";
const STORAGE_KEY_PAGE = "vsd_map_page_index";

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
    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        if (!email && u?.email) email = String(u.email);
        if (!name && (u?.name || u?.displayName)) name = String(u.name || u.displayName);
      } catch {}
    }
    // Check "eh_user" localStorage (Bubble login stores user data here)
    if ((!email || !name) && localStorage.getItem("eh_user")) {
      try {
        const eu = JSON.parse(localStorage.getItem("eh_user"));
        const x = eu?.user || eu?.profile || eu;
        if (!email && x?.email) email = String(x.email);
        if (!name && (x?.name || x?.displayName)) name = String(x.name || x.displayName);
      } catch {}
    }
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

function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-green-100 bg-white text-black placeholder-gray-400 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}

function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-green-600 text-white hover:bg-green-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
    ghost: "bg-white text-black border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed",
    subtle: "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed",
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
        <div className={`px-4 py-3 ${danger ? "bg-gradient-to-r from-rose-500 to-red-600 text-white" : "bg-gradient-to-r from-green-500 to-emerald-600 text-white"}`}>
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
        Détacher du plan
      </button>
    </div>
  );
}

/* ----------------------------- Sidebar Card ----------------------------- */
const VsdCard = ({ equipment, isPlacedHere, isPlacedSomewhere, isPlacedElsewhere, isSelected, onClick, onPlace }) => {
  return (
    <div
      className={`p-3 rounded-xl border transition-all cursor-pointer group
        ${isSelected ? "bg-green-50 border-green-300 shadow-sm" : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold text-sm ${isSelected ? "text-green-700" : "text-gray-900"}`}>
              {equipment.name || equipment.tag || "VSD"}
            </span>
            {isPlacedElsewhere && <Badge variant="purple">Placé ailleurs</Badge>}
          </div>
          <p className={`text-xs truncate mt-0.5 ${isSelected ? "text-green-600" : "text-gray-500"}`}>
            {equipment.manufacturer} {equipment.power_kw ? `• ${equipment.power_kw} kW` : ""}
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
              Placé
            </span>
          ) : isPlacedSomewhere ? (
            <span className="flex items-center gap-1 text-purple-600 text-xs">
              <CheckCircle size={14} />
              Ailleurs
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 text-xs">
              <AlertCircle size={14} />
              Non placé
            </span>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onPlace(equipment); }}
            className="px-2 py-1 bg-green-500 text-white text-xs rounded-lg flex items-center gap-1 hover:bg-green-600 transition-colors"
            title={isPlacedSomewhere ? "Déplacer sur ce plan" : "Placer sur ce plan"}
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
const DetailPanel = ({ position, equipment, onClose, onNavigate, onDelete, links = [], linksLoading = false, onAddLink, onDeleteLink, onLinkClick, currentPlan, currentPageIndex = 0 }) => {
  const [showAddLink, setShowAddLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  if (!position) return null;

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await api.equipmentLinks.search(query, 'vsd', position.equipment_id);
      setSearchResults(res?.results || []);
    } catch (e) { console.error('Search error:', e); }
    finally { setSearching(false); }
  };

  const handleAddLinkClick = async (target, direction) => {
    try {
      const linkLabel = direction || 'connected';
      await onAddLink?.({ source_type: 'vsd', source_id: String(position.equipment_id), target_type: target.type, target_id: String(target.id), link_label: linkLabel });
      setShowAddLink(false); setSearchQuery(''); setSearchResults([]);
    } catch (e) { console.error('Add link error:', e); }
  };

  const isOnSamePlan = (link) => {
    const eq = link.linkedEquipment;
    return eq?.hasPosition && eq?.plan === currentPlan && (eq?.pageIndex || 0) === currentPageIndex;
  };

  return (
    <AnimatedCard className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white rounded-2xl shadow-2xl border overflow-hidden z-30 max-h-[80vh] flex flex-col">
      <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-4 text-white flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/20 rounded-lg"><Cpu size={20} /></div>
            <div>
              <h3 className="font-bold">{position.name || equipment?.name || "VSD"}</h3>
              <p className="text-green-100 text-sm">{position.tag || equipment?.tag || "-"}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"><X size={18} /></button>
        </div>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Bâtiment</span>
            <span className="font-semibold text-gray-900">{position.building || equipment?.building || "-"}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Puissance</span>
            <span className="font-semibold text-gray-900">{equipment?.power_kw || "-"} kW</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Fabricant</span>
            <span className="font-semibold text-gray-900">{equipment?.manufacturer || "-"}</span>
          </div>
        </div>

        {/* Equipment Links Section */}
        <div className="border-t pt-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Link2 size={14} />Équipements liés</span>
            <button onClick={() => setShowAddLink(!showAddLink)} className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-green-600" title="Ajouter un lien"><Plus size={16} /></button>
          </div>
          {showAddLink && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-2 mb-2">
              <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)} placeholder="Rechercher un équipement..." className="w-full px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-green-500 bg-white" autoFocus />
              {searching && <div className="flex items-center gap-2 text-sm text-gray-500 mt-2"><Loader2 size={14} className="animate-spin" />Recherche...</div>}
              {searchResults.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {searchResults.map((result) => (
                    <div key={`${result.type}-${result.id}`} className="bg-white rounded border p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-medium text-sm">{result.code || result.name}</span>
                        <span className="text-xs text-gray-500">{result.type}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => handleAddLinkClick(result, 'upstream')} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded border border-green-300" title="Amont"><ArrowDown size={12} /><span>Amont</span></button>
                        <button onClick={() => handleAddLinkClick(result, 'downstream')} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded border border-red-300" title="Aval"><ArrowUp size={12} /><span>Aval</span></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {linksLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2"><Loader2 size={14} className="animate-spin" />Chargement...</div>
          ) : links.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">Aucun équipement lié</p>
          ) : (
            <div className="space-y-1">
              {links.map((link, idx) => {
                const eq = link.linkedEquipment; const samePlan = isOnSamePlan(link);
                return (
                  <div key={link.id || idx} className={`flex items-center justify-between p-2 rounded-lg text-sm ${samePlan ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
                    <button onClick={() => onLinkClick?.(link)} className="flex items-center gap-2 flex-1 text-left hover:underline">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <div>
                        <span className="font-medium">{eq?.code || eq?.name}</span>
                        {link.relationship && link.relationship !== 'connected' && <span className="text-xs text-gray-500 ml-1">({link.relationship === 'feeds' ? 'alimente' : link.relationship === 'fed_by' ? 'alimenté par' : link.relationship})</span>}
                        {!samePlan && eq?.plan && <span className="text-xs text-orange-600 ml-1">(autre plan)</span>}
                        {link.type === 'hierarchical' && <span className="text-xs text-blue-600 ml-1">(auto)</span>}
                      </div>
                    </button>
                    {link.type === 'manual' && link.id && <button onClick={() => onDeleteLink?.(link.id)} className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600" title="Supprimer"><Trash2 size={14} /></button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-xs text-gray-400 flex items-center gap-2">
          <MapPin size={12} />Position: {(position.x_frac * 100).toFixed(1)}%, {(position.y_frac * 100).toFixed(1)}%
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={() => onNavigate(position.equipment_id)} className="flex-1 py-2.5 px-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transition-all flex items-center justify-center gap-2">
            <ExternalLink size={16} />Ouvrir la fiche
          </button>
          <button onClick={() => onDelete?.(position)} className="py-2.5 px-3 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all flex items-center justify-center" title="Détacher du plan"><Trash2 size={16} /></button>
        </div>
      </div>
    </AnimatedCard>
  );
};

/* ----------------------------- Placement Mode Indicator ----------------------------- */
const PlacementModeIndicator = ({ equipment, onCancel }) => (
  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30">
    <div className="bg-green-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-slideUp">
      <div className="p-2 bg-white/20 rounded-lg">
        <Crosshair size={20} className="animate-pulse" />
      </div>
      <div>
        <p className="font-semibold">Mode placement actif</p>
        <p className="text-green-200 text-sm">
          Cliquez sur le plan pour placer <span className="font-semibold">{equipment.name || equipment.tag || "VSD"}</span>
        </p>
      </div>
      <button onClick={onCancel} className="p-2 hover:bg-white/20 rounded-lg transition-colors ml-2">
        <X size={18} />
      </button>
    </div>
  </div>
);

/* ----------------------------- Leaflet Viewer ----------------------------- */
const VsdLeafletViewer = forwardRef(({
  fileUrl,
  pageIndex = 0,
  initialPoints = [],
  selectedId = null,
  controlStatuses = {}, // { equipment_id: { status: 'overdue'|'upcoming'|'done' } }
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

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);

  const pointsRef = useRef(initialPoints);
  const selectedIdRef = useRef(selectedId);
  const controlStatusesRef = useRef(controlStatuses);
  const placementActiveRef = useRef(placementActive);
  const aliveRef = useRef(true);

  const lastViewRef = useRef({ center: [0, 0], zoom: 0 });
  const initialFitDoneRef = useRef(false);
  const userViewTouchedRef = useRef(false);

  const lastJob = useRef({ key: null });
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);

  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const onCreatePointRef = useRef(onCreatePoint);

  const ICON_PX = 22;
  const ICON_PX_SELECTED = 30;
  const PICK_RADIUS = Math.max(18, Math.floor(ICON_PX / 2) + 6);

  useEffect(() => { placementActiveRef.current = placementActive; }, [placementActive]);
  useEffect(() => { onCreatePointRef.current = onCreatePoint; }, [onCreatePoint]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (mapRef.current && imgSize.w > 0) {
      drawMarkers(pointsRef.current, imgSize.w, imgSize.h);
    }
  }, [selectedId]);

  // Keep controlStatuses ref in sync and redraw markers when it changes
  useEffect(() => {
    controlStatusesRef.current = controlStatuses;
    if (mapRef.current && imgSize.w > 0) {
      drawMarkers(pointsRef.current, imgSize.w, imgSize.h);
    }
  }, [controlStatuses]);

  function makeVsdIcon(isSelected = false, equipmentId = null) {
    const s = isSelected ? ICON_PX_SELECTED : ICON_PX;
    const controlStatus = equipmentId ? controlStatusesRef.current[equipmentId] : null;
    const isOverdue = controlStatus?.status === 'overdue';
    const isUpcoming = controlStatus?.status === 'upcoming';

    // Colors aligned with UnifiedEquipmentMap STATUS_COLORS
    let bg;
    if (isSelected) {
      bg = "background: radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed);"; // Purple - selected
    } else if (isOverdue) {
      bg = "background: radial-gradient(circle at 30% 30%, #ef4444, #dc2626);"; // Red - overdue
    } else if (isUpcoming) {
      bg = "background: radial-gradient(circle at 30% 30%, #f59e0b, #d97706);"; // Amber - upcoming
    } else {
      bg = "background: radial-gradient(circle at 30% 30%, #10b981, #059669);"; // Emerald - VSD default
    }

    let animClass = "";
    if (isSelected) animClass = "vsd-marker-selected";
    else if (isOverdue) animClass = "vsd-marker-overdue";

    const html = `
      <div class="${animClass}" style="width:${s}px;height:${s}px;${bg}border:2px solid white;border-radius:9999px;box-shadow:0 4px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;">
        <svg viewBox="0 0 24 24" width="${s * 0.5}" height="${s * 0.5}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <rect x="9" y="9" width="6" height="6"/>
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>
        </svg>
      </div>`;
    return L.divIcon({
      className: "vsd-marker-inline",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
      popupAnchor: [0, -Math.round(s / 2)],
    });
  }

  const drawMarkers = useCallback((list, w, h) => {
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
      const isSelected = p.equipment_id === selectedIdRef.current;
      const icon = makeVsdIcon(isSelected, p.equipment_id);

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
        equipment_id: p.equipment_id,
        name: p.name || p.equipment_name,
        tag: p.tag,
        x_frac: p.x_frac,
        y_frac: p.y_frac,
        building: p.building,
      };

      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          return;
        }
        setPicker(null);
        onClickPoint?.(mk.__meta);
      });

      mk.on("dragend", () => {
        if (!onMovePoint) return;
        const ll = mk.getLatLng();
        const xFrac = clamp(ll.lng / w, 0, 1);
        const yFrac = clamp(ll.lat / h, 0, 1);
        onMovePoint(mk.__meta.equipment_id, { x: Math.round(xFrac * 1e6) / 1e6, y: Math.round(yFrac * 1e6) / 1e6 });
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
  }, [onClickPoint, onMovePoint, onContextMenu, disabled]);

  const highlightMarker = useCallback((equipmentId) => {
    // Try to find marker with the ID as-is first, then try with type conversion
    let mk = markersMapRef.current.get(equipmentId);
    if (!mk) mk = markersMapRef.current.get(String(equipmentId));
    if (!mk) mk = markersMapRef.current.get(Number(equipmentId));
    if (!mk || !mapRef.current) return;

    // Center on marker
    const ll = mk.getLatLng();
    mapRef.current.setView(ll, mapRef.current.getZoom(), { animate: true });

    // Flash animation
    const el = mk.getElement();
    if (el) {
      el.classList.add("vsd-marker-flash");
      setTimeout(() => el.classList.remove("vsd-marker-flash"), 2000);
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
        console.error("VSD Leaflet viewer error", e);
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
  }, [fileUrl, pageIndex, disabled]);

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

  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const wrapperHeight = Math.max(320, Math.min(imgSize.h || 720, viewportH - 180));

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
          {picker.items.length > 8 && <div className="text-xs text-gray-500 px-3 py-1">…</div>}
        </div>
      )}

      <div className="flex items-center gap-3 p-2 text-xs text-gray-600 border-t bg-white">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: "radial-gradient(circle at 30% 30%, #34d399, #059669)" }} />
          Variateur
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: "radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed)" }} />
          Sélectionné
        </span>
      </div>
    </div>
  );
});

/* ----------------------------- Hook de gestion des positions ----------------------------- */
function useMapUpdateLogic(stableSelectedPlan, pageIndex, viewerRef) {
  const reloadPositionsRef = useRef(null);
  const latestPositionsRef = useRef([]);

  const loadPositions = useCallback(async (plan, pageIdx = 0) => {
    if (!plan) return [];
    const key = plan.id || plan.logical_name || "";
    try {
      const r = await api.vsdMaps.positionsAuto(key, pageIdx).catch(() => ({}));
      const list = Array.isArray(r?.positions)
        ? r.positions.map((item) => ({
            id: item.id,
            equipment_id: item.equipment_id,
            name: item.name || item.equipment_name || `VSD #${item.equipment_id}`,
            tag: item.tag || "",
            x_frac: Number(item.x_frac ?? item.x ?? 0),
            y_frac: Number(item.y_frac ?? item.y ?? 0),
            x: Number(item.x_frac ?? item.x ?? 0),
            y: Number(item.y_frac ?? item.y ?? 0),
            building: item.building || "",
          }))
        : [];

      latestPositionsRef.current = list;
      viewerRef.current?.drawMarkers(list);
      return list;
    } catch (e) {
      console.error("Erreur chargement positions VSD", e);
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

/* ----------------------------- Main Page ----------------------------- */
export default function VsdMap() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [placedDetails, setPlacedDetails] = useState({}); // equipment_id -> { plans: [...] }

  // Control statuses for equipment markers { equipment_id: { status: 'overdue'|'upcoming'|'done' } }
  const [controlStatuses, setControlStatuses] = useState({});

  // Equipment links
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);

  // UI
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [placementMode, setPlacementMode] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Ref to prevent double creation
  const creatingRef = useRef(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState(null);

  // Confirm modal
  const [confirmState, setConfirmState] = useState({ open: false, position: null });

  const viewerRef = useRef(null);

  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan]);
  const stableFileUrl = useMemo(() => {
    if (!stableSelectedPlan) return null;
    return api.vsdMaps.planFileUrlAuto(stableSelectedPlan, { bust: true });
  }, [stableSelectedPlan]);

  const { refreshPositions, getLatestPositions } = useMapUpdateLogic(stableSelectedPlan, pageIndex, viewerRef);

  const selectedEquipmentId = useMemo(() => selectedPosition?.equipment_id || null, [selectedPosition]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) setShowSidebar(false);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    loadPlans();
    loadEquipments();
    loadControlStatuses();
  }, []);

  // Load control statuses from switchboardControls API
  const loadControlStatuses = async () => {
    try {
      const dashboardRes = await api.switchboardControls.dashboard();
      const statuses = {};

      // Process overdue items
      (dashboardRes?.overdue_list || []).forEach(item => {
        if (item.vsd_equipment_id) {
          statuses[item.vsd_equipment_id] = { status: 'overdue', template_name: item.template_name };
        }
      });

      // Process upcoming items
      (dashboardRes?.upcoming || []).forEach(item => {
        if (item.vsd_equipment_id && !statuses[item.vsd_equipment_id]) {
          statuses[item.vsd_equipment_id] = { status: 'upcoming', template_name: item.template_name };
        }
      });

      setControlStatuses(statuses);
    } catch (err) {
      console.error("Erreur chargement statuts contrôle:", err);
    }
  };

  // Load equipment links
  const loadEquipmentLinks = async (equipmentId) => {
    if (!equipmentId) { setLinks([]); return; }
    setLinksLoading(true);
    try {
      const res = await api.equipmentLinks.getLinks('vsd', equipmentId);
      setLinks(res?.links || []);
    } catch (err) { console.error("Error loading equipment links:", err); setLinks([]); }
    finally { setLinksLoading(false); }
  };

  const handleAddLink = async (linkData) => {
    try {
      await api.equipmentLinks.createLink(linkData);
      if (selectedPosition) loadEquipmentLinks(selectedPosition.equipment_id);
    } catch (err) { console.error("Error creating link:", err); }
  };

  const handleDeleteLink = async (linkId) => {
    try {
      await api.equipmentLinks.deleteLink(linkId);
      if (selectedPosition) loadEquipmentLinks(selectedPosition.equipment_id);
    } catch (err) { console.error("Error deleting link:", err); }
  };

  const handleLinkClick = (link) => {
    const eq = link.linkedEquipment;
    if (!eq) return;
    const currentPlanKey = stableSelectedPlan?.logical_name;
    if (eq.hasPosition && eq.plan === currentPlanKey && (eq.pageIndex || 0) === pageIndex) {
      const targetPos = initialPoints.find(p => String(p.equipment_id) === String(eq.id));
      if (targetPos) { setSelectedPosition(targetPos); loadEquipmentLinks(eq.id); viewerRef.current?.highlightMarker?.(eq.id); }
    } else if (eq.hasPosition && eq.plan) {
      const targetPlan = plans.find(p => p.logical_name === eq.plan);
      if (targetPlan) { setSelectedPlan(targetPlan); if (eq.pageIndex !== undefined) setPageIndex(eq.pageIndex); }
    } else { navigate(`/app/vsd?equipment=${eq.id}`); }
  };

  // Handle URL params for navigation from list page
  useEffect(() => {
    const urlVsdId = searchParams.get('vsd');
    const urlPlanKey = searchParams.get('plan');

    if (urlPlanKey && plans.length > 0) {
      const targetPlan = plans.find(p => p.logical_name === urlPlanKey);
      if (targetPlan) {
        if (urlVsdId) targetEquipmentIdRef.current = urlVsdId;

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
      const res = await api.vsdMaps.listPlans();
      setPlans(res?.plans || res || []);
    } catch (err) {
      console.error("Erreur chargement plans VSD:", err);
    } finally {
      setLoadingPlans(false);
    }
  };

  const refreshPlacedIds = async () => {
    try {
      const res = await api.vsdMaps.placedIds();
      // Keep IDs as-is (don't convert to Number - IDs might be UUIDs or strings)
      const ids = res?.placed_ids || res?.ids || [];
      const details = res?.placed_details || {};
      setPlacedIds(new Set(ids));
      setPlacedDetails(details);
    } catch (e) {
      console.error("Erreur chargement placements VSD:", e);
      setPlacedIds(new Set());
      setPlacedDetails({});
    }
  };

  const loadEquipments = async () => {
    setLoadingEquipments(true);
    try {
      const res = await api.vsd.listEquipments({});
      const list = res?.items || res?.equipments || res || [];
      setEquipments(list);
    } catch (err) {
      console.error("Erreur chargement VSD:", err);
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
      await api.vsdMaps.setPosition(equipment.id, {
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
      console.error("Erreur placement VSD:", err);
    }
  };

  // Create a new VSD equipment directly from the plan
  const createEquipmentAtFrac = async (xFrac, yFrac) => {
    if (creatingRef.current) return;
    if (!stableSelectedPlan) return;

    creatingRef.current = true;
    try {
      // Create equipment with auto-generated name
      const timestamp = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const created = await api.vsd.createEquipment({ name: `Nouveau VSD ${timestamp}`, status: "a_faire" });
      const id = created?.id || created?.equipment?.id;
      if (!id) throw new Error("Échec création équipement VSD");

      // Set position on the plan
      await api.vsdMaps.setPosition(id, {
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
      navigate(`/app/vsd?vsd=${id}`);
    } catch (err) {
      console.error("Erreur création équipement VSD:", err);
      alert("Erreur lors de la création de l'équipement VSD");
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
      await api.vsdMaps.deletePosition(position.id);
      const positions = await refreshPositions(stableSelectedPlan, pageIndex);
      setInitialPoints(positions || []);
      await refreshPlacedIds();
      setSelectedPosition(null);
      setConfirmState({ open: false, position: null });
    } catch (err) {
      console.error("Erreur suppression position:", err);
    }
  };

  // Filter equipments
  const filteredEquipments = useMemo(() => {
    let list = equipments;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(eq =>
        eq.name?.toLowerCase().includes(q) ||
        eq.tag?.toLowerCase().includes(q) ||
        eq.manufacturer?.toLowerCase().includes(q) ||
        eq.building?.toLowerCase().includes(q)
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

  // Smart navigation: navigate to the correct plan and highlight the equipment marker
  // Note: We only highlight the marker, we DON'T auto-open the detail panel
  // User must click on the marker to open the detail panel
  const handleEquipmentClick = useCallback(
    async (eq) => {
      setContextMenu(null);
      // Clear any existing selection - user must click marker to see details
      setSelectedPosition(null);
      setSelectedEquipment(null);

      // Check if this equipment is placed somewhere
      const details = placedDetails[eq.id];
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
              viewerRef.current?.highlightMarker(eq.id);
            }, 500);
          } else {
            // Same plan - just highlight (zoom + flash), no modal
            viewerRef.current?.highlightMarker(eq.id);
          }
        }
      } else {
        // Equipment is placed on current plan but placedDetails might not be populated
        // Try to highlight if on current plan
        const pos = initialPoints.find(p => p.equipment_id === eq.id);
        if (pos) {
          viewerRef.current?.highlightMarker(eq.id);
        }
      }
      // If not placed, do nothing - no modal to show

      // On mobile, close sidebar so user can see the map
      if (isMobile) setShowSidebar(false);
    },
    [plans, stableSelectedPlan, placedDetails, refreshPositions, isMobile, initialPoints]
  );

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
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
          }
          50% {
            transform: scale(1.15);
            box-shadow: 0 0 0 8px rgba(34, 197, 94, 0);
          }
        }
        @keyframes blink-overdue {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-slideUp { animation: slideUp .3s ease-out forwards; }
        .vsd-marker-flash > div {
          animation: flash-marker 2s ease-in-out;
        }
        .vsd-marker-selected > div {
          animation: pulse-selected 1.5s ease-in-out infinite;
        }
        .vsd-marker-overdue > div {
          animation: blink-overdue 1s ease-in-out infinite;
        }
        .vsd-marker-inline { background: transparent !important; border: none !important; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/app/vsd')} className="p-2 hover:bg-gray-100 rounded-lg">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-green-100 rounded-xl">
                <MapPin size={20} className="text-green-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Plans VSD</h1>
                <p className="text-xs text-gray-500">Localisation des variateurs</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs">
              <Badge variant="default">Total: {stats.total}</Badge>
              <Badge variant="success">Localisés: {stats.placed}</Badge>
              <Badge variant="warning">Non localisés: {stats.unplaced}</Badge>
            </div>

{!isMobile && (
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                {showSidebar ? "Masquer la liste" : "Afficher la liste"}
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
                const positions = await refreshPositions(plan, 0);
                setInitialPoints(positions || []);
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
        {/* Sidebar */}
        {showSidebar && !isMobile && (
          <div className="w-80 bg-white border-r shadow-sm flex flex-col z-10">
            <div className="p-3 border-b space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <Input
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Rechercher..."
                  className="pl-9"
                />
              </div>
              <div className="flex gap-1">
                <Btn variant={filterMode === "all" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("all")}>
                  Tous
                </Btn>
                <Btn variant={filterMode === "unplaced" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("unplaced")}>
                  Non placés
                </Btn>
                <Btn variant={filterMode === "placed" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("placed")}>
                  Placés
                </Btn>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingEquipments ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : filteredEquipments.length === 0 ? (
                <EmptyState icon={Cpu} title="Aucun variateur" description="Créez des variateurs pour les placer sur le plan" />
              ) : (
                filteredEquipments.map(eq => (
                  <VsdCard
                    key={eq.id}
                    equipment={eq}
                    isPlacedHere={isPlacedHere(eq.id)}
                    isPlacedSomewhere={placedIds.has(eq.id)}
                    isPlacedElsewhere={placedIds.has(eq.id) && !isPlacedHere(eq.id)}
                    isSelected={selectedEquipmentId === eq.id}
                    onClick={() => handleEquipmentClick(eq)}
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
              title="Aucun plan disponible"
              description="Importez des plans depuis la page Admin"
              action={
                <Btn onClick={() => navigate('/app/admin')}>
                  Gérer les plans
                </Btn>
              }
            />
          ) : (
            <>
              {!pdfReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20">
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw size={32} className="animate-spin text-green-500" />
                    <span className="text-sm text-gray-600">Chargement du plan...</span>
                  </div>
                </div>
              )}

              <VsdLeafletViewer
                ref={viewerRef}
                key={selectedPlan.logical_name}
                fileUrl={stableFileUrl}
                pageIndex={pageIndex}
                initialPoints={initialPoints}
                selectedId={selectedEquipmentId}
                controlStatuses={controlStatuses}
                onReady={() => setPdfReady(true)}
                onMovePoint={async (equipmentId, xy) => {
                  if (!stableSelectedPlan) return;
                  await api.vsdMaps.setPosition(equipmentId, {
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
                  loadEquipmentLinks(meta.equipment_id);
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
                  className="w-11 h-11 sm:w-10 sm:h-10 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-xl border-none bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg cursor-pointer text-lg flex items-center justify-center transition-all hover:from-green-400 hover:to-emerald-500 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ touchAction: 'manipulation' }}
                  title="Créer un nouvel équipement VSD"
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

          {/* Create mode indicator */}
          {createMode && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slideUp">
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-600 text-white rounded-2xl shadow-xl">
                <Crosshair size={20} className="animate-pulse" />
                <div>
                  <p className="font-semibold">Mode création actif</p>
                  <p className="text-xs text-blue-200">Cliquez sur le plan pour créer un nouvel équipement VSD</p>
                </div>
                <button onClick={() => setCreateMode(false)} className="p-2 hover:bg-white/20 rounded-lg transition-colors ml-2">
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
              onClose={() => { setSelectedPosition(null); setSelectedEquipment(null); setLinks([]); }}
              onNavigate={(id) => navigate(`/app/vsd?vsd=${id}`)}
              onDelete={askDeletePosition}
              links={links}
              linksLoading={linksLoading}
              onAddLink={handleAddLink}
              onDeleteLink={handleDeleteLink}
              onLinkClick={handleLinkClick}
              currentPlan={stableSelectedPlan?.logical_name}
              currentPageIndex={pageIndex}
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

      {/* Mobile sidebar button */}
      {isMobile && (
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="fixed bottom-4 right-4 z-30 w-14 h-14 bg-green-600 text-white rounded-full shadow-xl flex items-center justify-center"
        >
          <Cpu size={24} />
        </button>
      )}

      {/* Mobile sidebar drawer */}
      {isMobile && showSidebar && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col">
            <div className="p-4 border-b bg-gradient-to-r from-green-500 to-emerald-600 text-white flex items-center justify-between">
              <h2 className="font-bold">Variateurs</h2>
              <button onClick={() => setShowSidebar(false)} className="p-2 hover:bg-white/20 rounded-lg">
                <X size={20} />
              </button>
            </div>
            {/* Search and filters */}
            <div className="p-3 border-b space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <Input
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Rechercher..."
                  className="pl-9"
                />
              </div>
              <div className="flex gap-1">
                <Btn variant={filterMode === "all" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("all")}>
                  Tous
                </Btn>
                <Btn variant={filterMode === "unplaced" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("unplaced")}>
                  Non placés
                </Btn>
                <Btn variant={filterMode === "placed" ? "primary" : "ghost"} className="flex-1 text-xs" onClick={() => setFilterMode("placed")}>
                  Placés
                </Btn>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingEquipments ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : filteredEquipments.length === 0 ? (
                <EmptyState icon={Cpu} title="Aucun variateur" description="Créez des variateurs pour les placer sur le plan" />
              ) : (
                filteredEquipments.map(eq => (
                  <VsdCard
                    key={eq.id}
                    equipment={eq}
                    isPlacedHere={isPlacedHere(eq.id)}
                    isPlacedSomewhere={placedIds.has(eq.id)}
                    isPlacedElsewhere={placedIds.has(eq.id) && !isPlacedHere(eq.id)}
                    isSelected={selectedEquipmentId === eq.id}
                    onClick={() => handleEquipmentClick(eq)}
                    onPlace={(equipment) => { setPlacementMode(equipment); setShowSidebar(false); }}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      <ConfirmModal
        open={confirmState.open}
        title="Détacher du plan"
        message={`Voulez-vous retirer "${confirmState.position?.name || "ce variateur"}" du plan ?`}
        confirmText="Détacher"
        onConfirm={() => handleDeletePosition(confirmState.position)}
        onCancel={() => setConfirmState({ open: false, position: null })}
        danger
      />
    </div>
  );
}
