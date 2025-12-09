import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

import {
  Map, Zap, Search, ChevronLeft, ChevronRight,
  Building2, Layers, MapPin, CheckCircle, AlertCircle, X, Eye,
  RefreshCw, List, Trash2, ExternalLink,
  ZoomIn, ZoomOut, RotateCcw,
  ArrowLeft, Target, Crosshair
} from "lucide-react";

// Configuration du worker PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ==================== COMPONENTS ====================

// Animated Card
const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

// Loading Spinner
const LoadingSpinner = ({ size = 24, className = '' }) => (
  <RefreshCw size={size} className={`animate-spin ${className}`} />
);

// Badge Component
const Badge = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

// Empty State
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

// Switchboard Card (for sidebar)
const SwitchboardCard = ({
  board,
  isPlacedHere,
  isPlacedSomewhere,
  isPlacedElsewhere,
  isSelected,
  onClick,
  onPlace
}) => {
  return (
    <div
      className={`p-3 rounded-xl border transition-all cursor-pointer group
        ${isSelected
          ? 'bg-blue-50 border-blue-300 shadow-sm'
          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-mono font-semibold text-sm ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
              {board.code}
            </span>
            {board.is_principal && (
              <Badge variant="success">Principal</Badge>
            )}
            {/* NEW: placé ailleurs */}
            {isPlacedElsewhere && (
              <Badge variant="purple">Placé ailleurs</Badge>
            )}
          </div>
          <p className={`text-xs truncate mt-0.5 ${isSelected ? 'text-blue-600' : 'text-gray-500'}`}>
            {board.name}
          </p>
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

          {/* NEW: bouton toujours dispo pour replacer/déplacer */}
          <button
            onClick={(e) => { e.stopPropagation(); onPlace(board); }}
            className="px-2 py-1 bg-blue-500 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
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

// Position Marker on Map
const PositionMarker = ({
  position,
  isSelected,
  isFocused,
  isDragging,
  draggingFrac,
  onClick,
  onDelete,
  onStartDrag,
  scale = 1
}) => {
  const [showMenu, setShowMenu] = useState(false);

  const markerSize = isFocused ? 24 : isSelected ? 20 : 16;

  const xFrac = isDragging ? draggingFrac.xFrac : position.x_frac;
  const yFrac = isDragging ? draggingFrac.yFrac : position.y_frac;

  return (
    <div
      className="absolute transform -translate-x-1/2 -translate-y-1/2 z-10"
      style={{
        left: `${xFrac * 100}%`,
        top: `${yFrac * 100}%`,
      }}
    >
      {/* Marker */}
      <div
        onClick={(e) => { e.stopPropagation(); onClick(position); }}
        onMouseDown={(e) => onStartDrag?.(position, e)}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(!showMenu); }}
        className={`relative cursor-move transition-all duration-200 group
          ${isFocused ? 'z-20' : 'z-10'}`}
        style={{ width: markerSize, height: markerSize }}
      >
        {/* Pulse animation for focused */}
        {isFocused && (
          <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-50" />
        )}

        {/* Main marker */}
        <div
          className={`absolute inset-0 rounded-full border-2 border-white shadow-lg transition-all
            ${position.is_principal
              ? 'bg-gradient-to-br from-emerald-400 to-teal-500'
              : isFocused
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                : isSelected
                  ? 'bg-gradient-to-br from-blue-400 to-blue-600'
                  // NEW: default yellow electricity (gris -> jaune)
                  : 'bg-gradient-to-br from-yellow-400 to-amber-500'
            }`}
        />

        {/* Icon */}
        <Zap
          size={markerSize * 0.5}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white"
        />

        {/* Tooltip on hover */}
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
            <span className="font-mono font-semibold">{position.code}</span>
            {position.name && <span className="text-gray-300 ml-1">- {position.name}</span>}
          </div>
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      </div>

      {/* Context Menu */}
      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-white rounded-xl shadow-xl border z-40 overflow-hidden min-w-[140px]">
            <button
              onClick={(e) => { e.stopPropagation(); onClick(position); setShowMenu(false); }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <Eye size={14} />
              Voir détails
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(position); setShowMenu(false); }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 size={14} />
              Supprimer
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// Detail Panel for selected switchboard
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
              <h3 className="font-bold font-mono">{position.code || board?.code}</h3>
              <p className="text-blue-100 text-sm">{position.name || board?.name}</p>
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
        {/* Location Info */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Bâtiment</span>
            <span className="font-semibold text-gray-900">{position.building || board?.meta?.building_code || '-'}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Étage</span>
            <span className="font-semibold text-gray-900">{position.floor || board?.meta?.floor || '-'}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <span className="text-gray-500 text-xs block">Local</span>
            <span className="font-semibold text-gray-900">{position.room || board?.meta?.room || '-'}</span>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {(position.is_principal || board?.is_principal) && (
            <Badge variant="success">Tableau Principal</Badge>
          )}
          {(position.regime_neutral || board?.regime_neutral) && (
            <Badge variant="info">{position.regime_neutral || board?.regime_neutral}</Badge>
          )}
        </div>

        {/* Coordinates */}
        <div className="text-xs text-gray-400 flex items-center gap-2">
          <MapPin size={12} />
          Position: {(position.x_frac * 100).toFixed(1)}%, {(position.y_frac * 100).toFixed(1)}%
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onNavigate(position.switchboard_id)}
            className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 transition-all flex items-center justify-center gap-2"
          >
            <ExternalLink size={16} />
            Ouvrir le tableau
          </button>

          {/* NEW: détacher du plan */}
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

// Placement Mode Indicator
const PlacementModeIndicator = ({ board, onCancel }) => (
  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30">
    <div className="bg-blue-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-slideUp">
      <div className="p-2 bg-white/20 rounded-lg">
        <Crosshair size={20} className="animate-pulse" />
      </div>
      <div>
        <p className="font-semibold">Mode placement actif</p>
        <p className="text-blue-200 text-sm">Cliquez sur le plan pour placer <span className="font-mono">{board.code}</span></p>
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

// ==================== MAIN COMPONENT ====================

export default function SwitchboardMap() {
  const navigate = useNavigate();

  // Plans state
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Positions state
  const [positions, setPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);

  // Switchboards state
  const [switchboards, setSwitchboards] = useState([]);
  const [loadingSwitchboards, setLoadingSwitchboards] = useState(false);
  const [placedIds, setPlacedIds] = useState(new Set());

  // UI state
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [placementMode, setPlacementMode] = useState(null); // board to place
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all', 'placed', 'unplaced'
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // PDF state
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [pageSize, setPageSize] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);

  // Drag state
  const [draggingPos, setDraggingPos] = useState(null); // { position, xFrac, yFrac }
  const dragMoveRef = useRef(null);

  // Refs
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);

  // Zoom focus / pinch refs
  const zoomFocusRef = useRef(null); // { xFrac, yFrac, prevZoom }
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, mid: { xFrac: 0.5, yFrac: 0.5 } });

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  // ==================== EFFECTS ====================

  // Responsive
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) {
        setShowSidebar(false);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load plans
  useEffect(() => {
    loadPlans();
  }, []);

  // Load switchboards
  useEffect(() => {
    loadSwitchboards();
  }, []);

  // Load positions when plan/page changes
  useEffect(() => {
    if (selectedPlan) {
      loadPositions();
    }
  }, [selectedPlan, pageIndex]);

  // Render PDF when plan/page/zoom changes
  useEffect(() => {
    if (selectedPlan) {
      renderPdfPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan, pageIndex, zoom]);

  // ==================== API CALLS ====================

  const loadPlans = async () => {
    setLoadingPlans(true);
    try {
      const res = await api.switchboardMaps.listPlans();
      const plansArr = res?.plans || res || [];
      setPlans(plansArr);
      if (plansArr.length > 0 && !selectedPlan) {
        setSelectedPlan(plansArr[0]);
      }
    } catch (err) {
      console.error("Erreur chargement plans:", err);
    } finally {
      setLoadingPlans(false);
    }
  };

  const refreshPlacedIds = async () => {
    try {
      const placedRes = await api.switchboardMaps.placedIds();
      const ids = placedRes?.placed_ids || placedRes || [];
      setPlacedIds(new Set(ids));
    } catch (e) {
      console.error("Erreur chargement placements:", e);
      setPlacedIds(new Set());
    }
  };

  const loadSwitchboards = async () => {
    setLoadingSwitchboards(true);
    try {
      const res = await api.switchboard.listBoards({ pageSize: 500 });
      const list = res?.data || [];
      setSwitchboards(list);

      // Global placed IDs only (reliable)
      await refreshPlacedIds();
    } catch (err) {
      console.error("Erreur chargement switchboards:", err);
    } finally {
      setLoadingSwitchboards(false);
    }
  };

  const loadPositions = async () => {
    if (!selectedPlan) return;
    setLoadingPositions(true);
    try {
      const res = await api.switchboardMaps.positionsAuto(selectedPlan, pageIndex);
      const posList = res?.positions || [];
      setPositions(posList);

      // IMPORTANT: ne pas toucher placedIds ici (sinon faux "non placé")
    } catch (err) {
      console.error("Erreur chargement positions:", err);
    } finally {
      setLoadingPositions(false);
    }
  };

  const handleSetPositionById = async (switchboardId, xFrac, yFrac) => {
    if (!selectedPlan || !switchboardId) return;

    try {
      await api.switchboardMaps.setPosition({
        switchboard_id: switchboardId,
        logical_name: selectedPlan.logical_name,
        plan_id: selectedPlan.id || null,
        page_index: pageIndex,
        x_frac: xFrac,
        y_frac: yFrac,
      });

      await loadPositions();
      await refreshPlacedIds();

      setPlacementMode(null);

    } catch (err) {
      console.error("Erreur placement:", err);
      alert("Erreur lors du placement: " + err.message);
    }
  };

  const handleSetPosition = async (board, xFrac, yFrac) => {
    if (!selectedPlan || !board) return;
    return handleSetPositionById(board.id, xFrac, yFrac);
  };

  const handleDeletePosition = async (position) => {
    if (!confirm(`Supprimer le placement de ${position.code || position.name} ?`)) return;

    try {
      const response = await fetch(`${api.baseURL}/api/switchboard/maps/positions/${position.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Site': api.site,
        },
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Delete failed');

      await loadPositions();
      await refreshPlacedIds();

      if (selectedPosition?.id === position.id) {
        setSelectedPosition(null);
        setSelectedBoard(null);
      }

    } catch (err) {
      console.error("Erreur suppression:", err);
      alert("Erreur lors de la suppression");
    }
  };

  // ==================== PDF RENDERING ====================

  const renderPdfPage = async () => {
    if (!selectedPlan || !canvasRef.current) return;

    setIsRenderingPdf(true);

    try {
      const pdfUrl = api.switchboardMaps.planFileUrlAuto(selectedPlan, { bust: false });

      const loadingTask = pdfjsLib.getDocument({
        url: pdfUrl,
        withCredentials: true
      });
      const pdf = await loadingTask.promise;
      pdfDocRef.current = pdf;

      setNumPages(pdf.numPages || 1);

      const safePageNum = Math.min(Math.max(1, pageIndex + 1), pdf.numPages);
      const page = await pdf.getPage(safePageNum);

      const container = containerRef.current;
      const containerWidth = container?.clientWidth || 800;
      const containerHeight = container?.clientHeight || 600;

      const baseViewport = page.getViewport({ scale: 1 });
      const scaleX = (containerWidth - 40) / baseViewport.width;
      const scaleY = (containerHeight - 40) / baseViewport.height;
      const baseScale = Math.min(scaleX, scaleY);
      const finalScale = baseScale * zoom;

      const viewport = page.getViewport({ scale: finalScale });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;

      // NEW: netteté parfaite
      ctx.imageSmoothingEnabled = true;
      canvas.style.imageRendering = "auto";

      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      setPageSize({ w: viewport.width, h: viewport.height });

      await page.render({ canvasContext: ctx, viewport }).promise;

      // NEW: zoom focus recenter (sur pointeur)
      const focus = zoomFocusRef.current;
      if (focus && containerRef.current) {
        const { xFrac, yFrac } = focus;
        const cont = containerRef.current;

        const targetX = viewport.width * xFrac;
        const targetY = viewport.height * yFrac;

        cont.scrollLeft = targetX - (cont.clientWidth / 2);
        cont.scrollTop = targetY - (cont.clientHeight / 2);

        zoomFocusRef.current = null;
      }

      await loadingTask.destroy();

    } catch (err) {
      console.error("Erreur rendu PDF:", err);
    } finally {
      setIsRenderingPdf(false);
    }
  };

  // ==================== ZOOM HANDLERS (PC + Mobile) ====================

  const handleWheelZoom = useCallback((e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const xFrac = clamp(mouseX / rect.width, 0, 1);
    const yFrac = clamp(mouseY / rect.height, 0, 1);

    const prevZoom = zoom;
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const nextZoom = clamp(prevZoom + delta, 0.5, 5);

    zoomFocusRef.current = { xFrac, yFrac, prevZoom };
    setZoom(nextZoom);
  }, [zoom]);

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const t1 = e.touches[0];
      const t2 = e.touches[1];

      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy);

      const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const midY = (t1.clientY + t2.clientY) / 2 - rect.top;

      pinchRef.current = {
        active: true,
        startDist: dist,
        startZoom: zoom,
        mid: {
          xFrac: clamp(midX / rect.width, 0, 1),
          yFrac: clamp(midY / rect.height, 0, 1),
        },
      };
    }
  };

  const handleTouchMove = (e) => {
    if (!pinchRef.current.active || e.touches.length !== 2) return;

    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];

    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    const dist = Math.hypot(dx, dy);

    const ratio = dist / pinchRef.current.startDist;
    const nextZoom = clamp(pinchRef.current.startZoom * ratio, 0.5, 5);

    zoomFocusRef.current = {
      xFrac: pinchRef.current.mid.xFrac,
      yFrac: pinchRef.current.mid.yFrac,
      prevZoom: zoom
    };

    setZoom(nextZoom);
  };

  const handleTouchEnd = () => {
    pinchRef.current.active = false;
  };

  // ==================== DRAG MARKERS ====================

  const startDragMarker = (position, e) => {
    if (placementMode) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDraggingPos({
      position,
      xFrac: position.x_frac,
      yFrac: position.y_frac
    });

    dragMoveRef.current = (evt) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;

      const x = clamp((evt.clientX - r.left) / r.width, 0, 1);
      const y = clamp((evt.clientY - r.top) / r.height, 0, 1);

      setDraggingPos((cur) => cur ? ({ ...cur, xFrac: x, yFrac: y }) : cur);
    };

    const stop = async () => {
      window.removeEventListener("mousemove", dragMoveRef.current);
      window.removeEventListener("mouseup", stop);

      setDraggingPos((cur) => {
        if (!cur) return null;
        handleSetPositionById(cur.position.switchboard_id, cur.xFrac, cur.yFrac);
        return null;
      });
    };

    window.addEventListener("mousemove", dragMoveRef.current);
    window.addEventListener("mouseup", stop);
  };

  // ==================== EVENT HANDLERS ====================

  const handleCanvasClick = (e) => {
    if (!placementMode) {
      if (selectedPosition) {
        setSelectedPosition(null);
        setSelectedBoard(null);
      }
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const xFrac = clickX / rect.width;
    const yFrac = clickY / rect.height;

    if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) return;

    handleSetPosition(placementMode, xFrac, yFrac);
  };

  const handlePositionClick = async (position) => {
    setSelectedPosition(position);

    try {
      const board = await api.switchboard.getBoard(position.switchboard_id);
      setSelectedBoard(board);
    } catch (err) {
      console.error("Erreur chargement détails:", err);
      setSelectedBoard(null);
    }
  };

  const handlePlaceBoard = (board) => {
    setPlacementMode(board);
    setSelectedPosition(null);
    setSelectedBoard(null);
    if (isMobile) {
      setShowSidebar(false);
    }
  };

  const handleNavigateToBoard = (boardId) => {
    navigate(`/app/switchboards?board=${boardId}`);
  };

  // ==================== FILTERED DATA ====================

  const currentPlanIds = useMemo(
    () => new Set(positions.map(p => p.switchboard_id)),
    [positions]
  );

  const filteredSwitchboards = useMemo(() => {
    let filtered = switchboards;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(b =>
        b.code?.toLowerCase().includes(query) ||
        b.name?.toLowerCase().includes(query) ||
        b.meta?.building_code?.toLowerCase().includes(query)
      );
    }

    if (filterMode === 'placed') {
      filtered = filtered.filter(b => placedIds.has(b.id));
    } else if (filterMode === 'unplaced') {
      filtered = filtered.filter(b => !placedIds.has(b.id));
    }

    return filtered;
  }, [switchboards, searchQuery, filterMode, placedIds]);

  const stats = useMemo(() => ({
    total: switchboards.length,
    placed: switchboards.filter(b => placedIds.has(b.id)).length,
    unplaced: switchboards.filter(b => !placedIds.has(b.id)).length,
  }), [switchboards, placedIds]);

  // ==================== RENDER ====================

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* CSS Animations */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-slideUp {
          animation: slideUp 0.3s ease-out forwards;
        }
        .animate-slideRight {
          animation: slideRight 0.3s ease-out forwards;
        }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b shadow-sm z-20">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Back + Title */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/app/switchboards')}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl text-white">
                <Map size={20} />
              </div>
              <div className="hidden sm:block">
                <h1 className="font-bold text-gray-900">Plans des tableaux</h1>
                <p className="text-xs text-gray-500">
                  {stats.placed}/{stats.total} tableaux placés
                </p>
              </div>
            </div>

            {/* Center: Plan selector */}
            <div className="flex-1 max-w-md">
              <select
                value={selectedPlan?.id || ''}
                onChange={(e) => {
                  const plan = plans.find(p => p.id === e.target.value);
                  setSelectedPlan(plan || null);
                  setPageIndex(0);
                  setSelectedPosition(null);
                }}
                disabled={loadingPlans}
                className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
              >
                {plans.length === 0 && <option value="">Aucun plan disponible</option>}
                {plans.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.display_name || p.logical_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              {/* Page navigation */}
              {numPages > 1 && (
                <div className="hidden sm:flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                  <button
                    onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
                    disabled={pageIndex === 0}
                    className="p-1.5 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="px-2 text-sm font-medium text-gray-700">
                    {pageIndex + 1} / {numPages}
                  </span>
                  <button
                    onClick={() => setPageIndex(Math.min(numPages - 1, pageIndex + 1))}
                    disabled={pageIndex >= numPages - 1}
                    className="p-1.5 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}

              {/* Zoom controls (desktop) */}
              <div className="hidden md:flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                  className="p-1.5 rounded-lg hover:bg-white transition-colors"
                  title="Zoom -"
                >
                  <ZoomOut size={18} />
                </button>
                <span className="px-2 text-sm font-medium text-gray-700 min-w-[3rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(Math.min(5, zoom + 0.25))}
                  className="p-1.5 rounded-lg hover:bg-white transition-colors"
                  title="Zoom +"
                >
                  <ZoomIn size={18} />
                </button>
                <button
                  onClick={() => setZoom(1)}
                  className="p-1.5 rounded-lg hover:bg-white transition-colors"
                  title="Reset zoom"
                >
                  <RotateCcw size={18} />
                </button>
              </div>

              {/* Toggle sidebar */}
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className={`p-2.5 rounded-xl transition-colors ${
                  showSidebar
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <List size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map Area */}
        <div
          ref={containerRef}
          onWheel={handleWheelZoom}
          className="flex-1 relative overflow-auto bg-gray-200"
        >
          {/* Loading overlay */}
          {(isRenderingPdf || loadingPositions) && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-20">
              <div className="flex flex-col items-center gap-3">
                <LoadingSpinner size={32} className="text-blue-500" />
                <p className="text-gray-600 text-sm">
                  {isRenderingPdf ? 'Chargement du plan...' : 'Chargement des positions...'}
                </p>
              </div>
            </div>
          )}

          {/* No plan selected */}
          {!selectedPlan && !loadingPlans && (
            <EmptyState
              icon={MapPin}
              title="Aucun plan sélectionné"
              description="Sélectionnez un plan dans la liste ci-dessus pour commencer"
            />
          )}

          {/* PDF Canvas Container */}
          {selectedPlan && (
            <div className="min-h-full flex items-center justify-center p-4">
              <div
                className="relative bg-white shadow-xl rounded-lg overflow-hidden"
                style={{ width: pageSize.w, height: pageSize.h }}
              >
                {/* Canvas */}
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className={`block ${placementMode ? 'cursor-crosshair' : 'cursor-default'}`}
                />

                {/* Position Markers */}
                {positions.map(position => {
                  const isDragging = draggingPos?.position?.id === position.id;
                  return (
                    <PositionMarker
                      key={position.id}
                      position={position}
                      isSelected={selectedPosition?.switchboard_id === position.switchboard_id}
                      isFocused={selectedPosition?.id === position.id}
                      isDragging={isDragging}
                      draggingFrac={isDragging ? { xFrac: draggingPos.xFrac, yFrac: draggingPos.yFrac } : null}
                      onClick={handlePositionClick}
                      onDelete={handleDeletePosition}
                      onStartDrag={startDragMarker}
                      scale={zoom}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Placement Mode Indicator */}
          {placementMode && (
            <PlacementModeIndicator
              board={placementMode}
              onCancel={() => setPlacementMode(null)}
            />
          )}

          {/* Detail Panel */}
          {selectedPosition && !placementMode && (
            <DetailPanel
              position={selectedPosition}
              board={selectedBoard}
              onClose={() => { setSelectedPosition(null); setSelectedBoard(null); }}
              onDelete={handleDeletePosition}
              onNavigate={handleNavigateToBoard}
            />
          )}

          {/* Mobile Page Navigation */}
          {isMobile && numPages > 1 && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-white rounded-full shadow-lg px-4 py-2 z-20">
              <button
                onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
                disabled={pageIndex === 0}
                className="p-1 disabled:opacity-50"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm font-medium">
                {pageIndex + 1} / {numPages}
              </span>
              <button
                onClick={() => setPageIndex(Math.min(numPages - 1, pageIndex + 1))}
                disabled={pageIndex >= numPages - 1}
                className="p-1 disabled:opacity-50"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div className={`bg-white border-l shadow-lg flex flex-col overflow-hidden
            ${isMobile
              ? 'absolute inset-y-0 right-0 w-80 max-w-[85vw] z-30 animate-slideRight'
              : 'w-80'
            }`}
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900">Tableaux électriques</h2>
                {isMobile && (
                  <button
                    onClick={() => setShowSidebar(false)}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Filter tabs */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                {[
                  { key: 'all', label: 'Tous', count: stats.total },
                  { key: 'unplaced', label: 'Non placés', count: stats.unplaced },
                  { key: 'placed', label: 'Placés', count: stats.placed },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setFilterMode(tab.key)}
                    className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-lg transition-colors
                      ${filterMode === tab.key
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>
            </div>

            {/* Switchboard List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingSwitchboards ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner className="text-gray-400" />
                </div>
              ) : filteredSwitchboards.length === 0 ? (
                <EmptyState
                  icon={Zap}
                  title="Aucun tableau"
                  description={searchQuery ? "Essayez une autre recherche" : "Aucun tableau disponible"}
                />
              ) : (
                filteredSwitchboards.map((board, index) => {
                  const isPlacedSomewhere = placedIds.has(board.id);
                  const isPlacedHere = currentPlanIds.has(board.id);
                  const isPlacedElsewhere = isPlacedSomewhere && !isPlacedHere;

                  return (
                    <AnimatedCard key={board.id} delay={index * 30}>
                      <SwitchboardCard
                        board={board}
                        isPlacedHere={isPlacedHere}
                        isPlacedSomewhere={isPlacedSomewhere}
                        isPlacedElsewhere={isPlacedElsewhere}
                        isSelected={selectedPosition?.switchboard_id === board.id}
                        onClick={() => {
                          const pos = positions.find(p => p.switchboard_id === board.id);
                          if (pos) handlePositionClick(pos);
                        }}
                        onPlace={handlePlaceBoard}
                      />
                    </AnimatedCard>
                  );
                })
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="p-3 border-t bg-gray-50">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{filteredSwitchboards.length} tableaux affichés</span>
                <button
                  onClick={loadSwitchboards}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                >
                  <RefreshCw size={12} />
                  Actualiser
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Sidebar Backdrop */}
        {isMobile && showSidebar && (
          <div
            className="absolute inset-0 bg-black/30 z-20"
            onClick={() => setShowSidebar(false)}
          />
        )}
      </div>
    </div>
  );
}
