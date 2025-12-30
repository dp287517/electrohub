// src/components/AIAvatar/MiniSwitchboardPreview.jsx
// Mini preview of switchboard/equipment location for AI chat responses
// Uses Leaflet for interactive map display (like the main floor plan viewer)
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, Zap, Building2, Layers, ExternalLink,
  Maximize2, ChevronRight, X, Calendar, AlertTriangle,
  CheckCircle, Clock, ZoomIn, ZoomOut, Crosshair
} from 'lucide-react';
import { api, API_BASE } from '../../lib/api.js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// PDF.js config
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Get user identity for API calls
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

// Clamp utility
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * MiniLeafletMap - Internal component that renders the Leaflet map
 */
function MiniLeafletMap({
  planData,
  position,
  switchboard,
  controlStatus,
  isExpanded,
  onExpand,
  onNavigate
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const MARKER_SIZE = isExpanded ? 28 : 18;

  // Create switchboard marker icon
  const createMarkerIcon = useCallback((isOverdue) => {
    const s = MARKER_SIZE;
    let bg;
    let animClass = "";

    if (isOverdue) {
      bg = "background: radial-gradient(circle at 30% 30%, #ef4444, #dc2626);";
      animClass = "mini-marker-pulse";
    } else {
      bg = "background: radial-gradient(circle at 30% 30%, #f59e0b, #ea580c);";
    }

    const html = `
      <div class="${animClass}" style="width:${s}px;height:${s}px;${bg}border:2.5px solid white;border-radius:9999px;box-shadow:0 4px 12px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s ease;">
        <svg viewBox="0 0 24 24" width="${s * 0.55}" height="${s * 0.55}" fill="white" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
        </svg>
      </div>`;

    return L.divIcon({
      className: "mini-sb-marker",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
    });
  }, [MARKER_SIZE]);

  // Load and render the map
  useEffect(() => {
    if (!planData || !position || !containerRef.current) return;

    let cancelled = false;
    let map = null;
    let pdfDoc = null;

    const initMap = async () => {
      setLoading(true);
      setError(null);

      try {
        // Clean up previous map
        if (mapRef.current) {
          try {
            mapRef.current.remove();
          } catch {}
          mapRef.current = null;
        }

        const pdfUrl = `${API_BASE}/api/switchboard/maps/planFile?logical_name=${encodeURIComponent(planData.logical_name)}`;

        // Load PDF
        const loadingTask = pdfjsLib.getDocument(pdfDocOpts(pdfUrl));
        pdfDoc = await loadingTask.promise;

        if (cancelled) return;

        const page = await pdfDoc.getPage((planData.page_index || 0) + 1);
        const baseVp = page.getViewport({ scale: 1 });

        // Calculate render size based on container
        const containerWidth = containerRef.current.clientWidth || (isExpanded ? 580 : 260);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetWidth = Math.min(2048, containerWidth * dpr * 1.5);
        const scale = clamp(targetWidth / baseVp.width, 0.5, 2.5);
        const viewport = page.getViewport({ scale });

        // Render to canvas
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: true });

        await page.render({ canvasContext: ctx, viewport }).promise;

        if (cancelled) return;

        // Convert to image
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const imgW = canvas.width;
        const imgH = canvas.height;

        // Create Leaflet map
        map = L.map(containerRef.current, {
          crs: L.CRS.Simple,
          zoomControl: false,
          zoomAnimation: true,
          fadeAnimation: false,
          scrollWheelZoom: true,
          touchZoom: true,
          doubleClickZoom: true,
          dragging: true,
          attributionControl: false,
          preferCanvas: true,
        });

        mapRef.current = map;

        // Add zoom control in mini version only if expanded
        if (isExpanded) {
          L.control.zoom({ position: "topright" }).addTo(map);
        }

        // Set bounds
        const bounds = L.latLngBounds([
          [0, 0],
          [imgH, imgW],
        ]);

        // Add image layer
        L.imageOverlay(dataUrl, bounds, {
          interactive: true,
          opacity: 1,
        }).addTo(map);

        // Fit to bounds with padding
        const fitZoom = map.getBoundsZoom(bounds, true);
        map.setMinZoom(fitZoom - 1);
        map.setMaxZoom(fitZoom + 5);
        map.setMaxBounds(bounds.pad(0.3));

        // Calculate marker position and center the view on it
        const markerX = position.x_frac * imgW;
        const markerY = position.y_frac * imgH;
        const markerLatLng = L.latLng(markerY, markerX);

        // Center on marker with appropriate zoom
        const initialZoom = isExpanded ? fitZoom + 1.5 : fitZoom + 0.5;
        map.setView(markerLatLng, initialZoom);

        // Add marker
        const isOverdue = controlStatus?.hasOverdue;
        const marker = L.marker(markerLatLng, {
          icon: createMarkerIcon(isOverdue),
          interactive: true,
        });

        marker.addTo(map);
        markerRef.current = marker;

        // Add popup on click
        marker.on('click', () => {
          if (!isExpanded && onExpand) {
            onExpand();
          }
        });

        // Cleanup PDF
        try {
          await pdfDoc.cleanup();
        } catch {}

        setLoading(false);

      } catch (err) {
        console.error('[MiniLeaflet] Error:', err);
        if (!cancelled) {
          setError('render_error');
          setLoading(false);
        }
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {}
        mapRef.current = null;
      }
    };
  }, [planData, position, isExpanded, controlStatus, createMarkerIcon, onExpand]);

  // Update marker icon when controlStatus changes
  useEffect(() => {
    if (markerRef.current) {
      const isOverdue = controlStatus?.hasOverdue;
      markerRef.current.setIcon(createMarkerIcon(isOverdue));
    }
  }, [controlStatus, createMarkerIcon]);

  // Center on marker handler
  const handleCenterOnMarker = useCallback(() => {
    if (mapRef.current && markerRef.current) {
      const ll = markerRef.current.getLatLng();
      mapRef.current.setView(ll, mapRef.current.getZoom() + 0.5, { animate: true });
    }
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-red-50 rounded-lg">
        <div className="text-center p-4">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-600">Erreur de chargement du plan</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div
        ref={containerRef}
        className="w-full h-full rounded-lg"
        style={{
          minHeight: isExpanded ? 350 : 140,
          background: '#f8fafc'
        }}
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-500">Chargement du plan...</span>
          </div>
        </div>
      )}

      {/* Center button (expanded mode) */}
      {isExpanded && !loading && (
        <button
          onClick={handleCenterOnMarker}
          className="absolute bottom-3 right-3 p-2 bg-white rounded-lg shadow-lg hover:bg-slate-50 transition-colors z-[1000]"
          title="Centrer sur le tableau"
        >
          <Crosshair className="w-4 h-4 text-slate-600" />
        </button>
      )}

      {/* Expand hint (mini mode) */}
      {!isExpanded && !loading && (
        <div
          className="absolute inset-0 bg-transparent cursor-pointer group"
          onClick={onExpand}
        >
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <div className="px-3 py-1.5 bg-white/95 backdrop-blur-sm rounded-full shadow-lg flex items-center gap-2">
              <Maximize2 className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">Agrandir</span>
            </div>
          </div>
        </div>
      )}

      {/* Plan name badge */}
      {!loading && (
        <div className="absolute bottom-2 left-2 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-xs text-slate-600 shadow-sm z-[1000]">
          📍 {planData?.display_name || planData?.logical_name}
        </div>
      )}
    </div>
  );
}

/**
 * MiniSwitchboardPreview - Shows a mini floor plan preview with switchboard location
 *
 * @param {object} equipment - Equipment data with switchboard info
 * @param {number} switchboardId - Direct switchboard ID (optional)
 * @param {object} controlStatus - Control status info (optional)
 * @param {function} onNavigate - Callback when user wants to view full map
 */
export default function MiniSwitchboardPreview({
  equipment,
  switchboardId,
  controlStatus,
  onNavigate,
  className = ''
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [planData, setPlanData] = useState(null);
  const [position, setPosition] = useState(null);
  const [switchboard, setSwitchboard] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Get switchboard ID from props or equipment
  const sbId = switchboardId || equipment?.switchboard_id || equipment?.id;

  // Fetch switchboard position and plan data
  useEffect(() => {
    if (!sbId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1. Get switchboard details
        const sbResponse = await api.get(`/api/switchboard/boards/${sbId}`);
        if (sbResponse.data) {
          setSwitchboard(sbResponse.data);
        }

        // 2. Get placement info
        const placedResponse = await api.get('/api/switchboard-map/placed-ids');
        const placedDetails = placedResponse.data?.placed_details || {};
        const placement = placedDetails[sbId];

        if (!placement) {
          setError('not_placed');
          setLoading(false);
          return;
        }

        // 3. Get position data
        const posResponse = await api.get('/api/switchboard/maps/positions', {
          params: {
            logical_name: placement.logical_name,
            page_index: placement.page_index || 0
          }
        });

        const positions = posResponse.data || [];
        const myPosition = positions.find(p => p.switchboard_id === sbId);

        if (myPosition) {
          setPosition(myPosition);
          setPlanData({
            logical_name: placement.logical_name,
            display_name: placement.display_name || placement.logical_name,
            page_index: placement.page_index || 0
          });
        } else {
          setError('position_not_found');
        }
      } catch (err) {
        console.error('[MiniPreview] Error:', err);
        setError('fetch_error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sbId]);

  // Handle navigation to full map
  const handleViewFullMap = () => {
    if (onNavigate) {
      onNavigate(sbId, planData);
    } else {
      // Navigate to switchboard map with this switchboard selected
      navigate(`/switchboard-map?switchboard=${sbId}&plan=${encodeURIComponent(planData?.logical_name || '')}`);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className={`bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 overflow-hidden ${className}`}>
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-200 rounded-lg animate-pulse" />
          <div className="flex-1">
            <div className="h-4 bg-slate-200 rounded w-32 mb-2 animate-pulse" />
            <div className="h-3 bg-slate-200 rounded w-24 animate-pulse" />
          </div>
        </div>
        <div className="h-32 bg-slate-200 animate-pulse" />
      </div>
    );
  }

  // Not placed or error state
  if (error === 'not_placed' || !sbId) {
    return (
      <div className={`bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="p-2 bg-slate-200 rounded-lg">
            <MapPin className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Position non définie</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Cet équipement n'est pas encore placé sur un plan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render error
  if (error) {
    return (
      <div className={`bg-gradient-to-br from-red-50 to-red-100 rounded-xl border border-red-200 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-700">Erreur de chargement</p>
            <p className="text-xs text-red-500 mt-0.5">
              Impossible de charger le plan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Success - render mini map preview with Leaflet
  return (
    <>
      <div className={`bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow ${className}`}>
        {/* Header with location info */}
        <div className="p-3 border-b border-amber-200/50 bg-white/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg shadow-sm">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {switchboard?.name || switchboard?.code || `Tableau #${sbId}`}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {switchboard?.meta?.building_code && (
                    <span className="flex items-center gap-0.5">
                      <Building2 className="w-3 h-3" />
                      {switchboard.meta.building_code}
                    </span>
                  )}
                  {switchboard?.meta?.floor && (
                    <span className="flex items-center gap-0.5">
                      <Layers className="w-3 h-3" />
                      {switchboard.meta.floor}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Control status badge */}
            {controlStatus && (
              <div className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
                controlStatus.hasOverdue
                  ? 'bg-red-100 text-red-700'
                  : controlStatus.nextDueDate && new Date(controlStatus.nextDueDate) < new Date(Date.now() + 30*24*60*60*1000)
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-green-100 text-green-700'
              }`}>
                {controlStatus.hasOverdue ? (
                  <>
                    <AlertTriangle className="w-3 h-3" />
                    Retard
                  </>
                ) : controlStatus.nextDueDate ? (
                  <>
                    <Calendar className="w-3 h-3" />
                    {new Date(controlStatus.nextDueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    OK
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mini Leaflet map */}
        <div className="relative bg-white" style={{ height: 160 }}>
          <MiniLeafletMap
            planData={planData}
            position={position}
            switchboard={switchboard}
            controlStatus={controlStatus}
            isExpanded={false}
            onExpand={() => setIsExpanded(true)}
            onNavigate={handleViewFullMap}
          />
        </div>

        {/* Action footer */}
        <div className="p-2 border-t border-amber-200/50 bg-white/50">
          <button
            onClick={handleViewFullMap}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow"
          >
            <MapPin className="w-4 h-4" />
            Voir sur le plan complet
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Modal with full Leaflet map */}
      {isExpanded && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl shadow-sm">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">
                    {switchboard?.name || `Tableau #${sbId}`}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {planData?.display_name || planData?.logical_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Modal Content - Full Leaflet Map */}
            <div className="p-4 bg-slate-50">
              <div
                className="w-full rounded-xl border border-slate-200 shadow-inner overflow-hidden"
                style={{ height: '55vh', maxHeight: 500 }}
              >
                <MiniLeafletMap
                  planData={planData}
                  position={position}
                  switchboard={switchboard}
                  controlStatus={controlStatus}
                  isExpanded={true}
                  onExpand={() => {}}
                  onNavigate={handleViewFullMap}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-4 border-t bg-white">
              <div className="flex items-center gap-4 text-sm text-slate-500">
                {switchboard?.meta?.building_code && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    {switchboard.meta.building_code}
                  </span>
                )}
                {switchboard?.meta?.floor && (
                  <span className="flex items-center gap-1">
                    <Layers className="w-4 h-4" />
                    Étage {switchboard.meta.floor}
                  </span>
                )}
                {switchboard?.meta?.room && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {switchboard.meta.room}
                  </span>
                )}
              </div>
              <button
                onClick={handleViewFullMap}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-medium transition-all shadow-sm hover:shadow"
              >
                <ExternalLink className="w-4 h-4" />
                Ouvrir dans l'éditeur de plans
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS for marker animations */}
      <style>{`
        .mini-sb-marker {
          background: transparent !important;
          border: none !important;
        }
        .mini-marker-pulse {
          animation: mini-pulse 1.5s ease-in-out infinite;
        }
        @keyframes mini-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.9; }
        }
      `}</style>
    </>
  );
}
