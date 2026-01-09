// SharedMapPreview.jsx - Simplified map preview for public shared views
// Uses public API endpoints that validate share token
import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Maximize2, X, Loader2, AlertTriangle } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// PDF.js config
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Clamp utility
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Equipment type colors
const EQUIPMENT_COLORS = {
  switchboard: { gradient: ['#f59e0b', '#ea580c'], bg: 'from-amber-50 to-orange-50', border: 'border-amber-200' },
  vsd: { gradient: ['#10b981', '#059669'], bg: 'from-green-50 to-emerald-50', border: 'border-green-200' },
  meca: { gradient: ['#f97316', '#ea580c'], bg: 'from-orange-50 to-red-50', border: 'border-orange-200' },
  glo: { gradient: ['#10b981', '#14b8a6'], bg: 'from-emerald-50 to-teal-50', border: 'border-emerald-200' },
  hv: { gradient: ['#eab308', '#f59e0b'], bg: 'from-amber-50 to-yellow-50', border: 'border-amber-200' },
  mobile: { gradient: ['#06b6d4', '#0891b2'], bg: 'from-cyan-50 to-sky-50', border: 'border-cyan-200' },
  atex: { gradient: ['#a855f7', '#9333ea'], bg: 'from-purple-50 to-violet-50', border: 'border-purple-200' },
  datahub: { gradient: ['#8b5cf6', '#7c3aed'], bg: 'from-violet-50 to-purple-50', border: 'border-violet-200' },
  infrastructure: { gradient: ['#6366f1', '#4f46e5'], bg: 'from-indigo-50 to-blue-50', border: 'border-indigo-200' },
  doors: { gradient: ['#3b82f6', '#2563eb'], bg: 'from-blue-50 to-indigo-50', border: 'border-blue-200' },
  firecontrol: { gradient: ['#ef4444', '#dc2626'], bg: 'from-red-50 to-orange-50', border: 'border-red-200' }
};

/**
 * SharedMapPreview - Mini map preview for shared troubleshooting views
 * Uses public API endpoints with share token validation
 */
export default function SharedMapPreview({ shareToken, className = '' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapData, setMapData] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch map data from public API
  useEffect(() => {
    if (!shareToken) {
      setLoading(false);
      setError('no_token');
      return;
    }

    const fetchMapData = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sendgrid/shared/${shareToken}/map-data`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load map data');
        }

        if (!data.hasPosition) {
          setError('not_placed');
          setLoading(false);
          return;
        }

        setMapData(data);
      } catch (err) {
        console.error('[SharedMapPreview] Error:', err);
        setError('fetch_error');
      } finally {
        setLoading(false);
      }
    };

    fetchMapData();
  }, [shareToken]);

  // Initialize Leaflet map when data is available
  useEffect(() => {
    if (!mapData || !containerRef.current || loading) return;

    let cancelled = false;
    let pdfDoc = null;

    const initMap = async () => {
      try {
        // Clean up previous map
        if (mapRef.current) {
          try { mapRef.current.remove(); } catch {}
          mapRef.current = null;
        }

        // Use the proxy endpoint for PDF
        const pdfUrl = `/api/sendgrid/shared/${shareToken}/plan-file`;

        // Load PDF
        const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
        pdfDoc = await loadingTask.promise;

        if (cancelled) return;

        const pageIndex = mapData.position.page_index || 0;
        const page = await pdfDoc.getPage(pageIndex + 1);
        const baseVp = page.getViewport({ scale: 1 });

        // Render settings
        const containerWidth = containerRef.current.clientWidth || 280;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const targetWidth = Math.min(2048, containerWidth * dpr * 2);
        const scale = clamp(targetWidth / baseVp.width, 1, 4);
        const viewport = page.getViewport({ scale });

        // Render to canvas
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = false;

        await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;

        if (cancelled) return;

        // Create image from canvas
        const imageUrl = canvas.toDataURL('image/png');
        const imgW = canvas.width;
        const imgH = canvas.height;

        // Calculate bounds for Leaflet
        const bounds = [[0, 0], [imgH, imgW]];

        // Initialize Leaflet map
        const map = L.map(containerRef.current, {
          crs: L.CRS.Simple,
          minZoom: -3,
          maxZoom: 3,
          zoomControl: false,
          attributionControl: false,
          doubleClickZoom: true,
          scrollWheelZoom: true,
          dragging: true,
        });

        mapRef.current = map;

        // Add image overlay
        L.imageOverlay(imageUrl, bounds).addTo(map);

        // Calculate marker position
        const x = mapData.position.x_frac * imgW;
        const y = (1 - mapData.position.y_frac) * imgH;

        // Create marker
        const colors = EQUIPMENT_COLORS[mapData.equipmentType] || EQUIPMENT_COLORS.switchboard;
        const markerSize = isExpanded ? 32 : 24;

        const markerHtml = `
          <div style="
            width: ${markerSize}px;
            height: ${markerSize}px;
            background: linear-gradient(135deg, ${colors.gradient[0]} 0%, ${colors.gradient[1]} 100%);
            border: 2.5px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg viewBox="0 0 24 24" width="${markerSize * 0.5}" height="${markerSize * 0.5}" fill="white" stroke="white" stroke-width="0.5">
              <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
            </svg>
          </div>
        `;

        const icon = L.divIcon({
          className: 'shared-map-marker',
          html: markerHtml,
          iconSize: [markerSize, markerSize],
          iconAnchor: [markerSize / 2, markerSize],
        });

        L.marker([y, x], { icon }).addTo(map);

        // Fit to bounds with padding, then center on marker
        map.fitBounds(bounds, { padding: [20, 20] });

        // Zoom in and center on marker
        setTimeout(() => {
          if (map && !cancelled) {
            map.setView([y, x], 1, { animate: true });
          }
        }, 300);

      } catch (err) {
        console.error('[SharedMapPreview] Map init error:', err);
        if (!cancelled) setError('render_error');
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
  }, [mapData, loading, isExpanded, shareToken]);

  // Loading state
  if (loading) {
    return (
      <div className={`bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-6 ${className}`}>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        </div>
      </div>
    );
  }

  // Not placed state
  if (error === 'not_placed' || error === 'no_token') {
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

  // Error state
  if (error) {
    return (
      <div className={`bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-700">Chargement indisponible</p>
            <p className="text-xs text-amber-500 mt-0.5">
              Le plan n'a pas pu être récupéré.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const colors = EQUIPMENT_COLORS[mapData?.equipmentType] || EQUIPMENT_COLORS.switchboard;

  return (
    <>
      <div className={`bg-gradient-to-br ${colors.bg} rounded-xl border ${colors.border} overflow-hidden shadow-sm ${className}`}>
        {/* Header */}
        <div className="p-3 border-b bg-white/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-600" />
            <span className="text-sm font-medium text-slate-700">
              {mapData?.plan?.display_name || 'Plan'}
            </span>
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1.5 hover:bg-white rounded-lg transition-colors"
            title="Agrandir"
          >
            <Maximize2 className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Map container */}
        <div
          ref={containerRef}
          className="h-48 relative"
          style={{ background: '#f8fafc' }}
        />

        {/* Location info */}
        {mapData?.location && (
          <div className="p-2 bg-white/50 border-t text-xs text-slate-600 flex gap-3">
            {mapData.location.building_code && (
              <span>Bât. {mapData.location.building_code}</span>
            )}
            {mapData.location.floor && (
              <span>Étage {mapData.location.floor}</span>
            )}
          </div>
        )}
      </div>

      {/* Expanded modal */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setIsExpanded(false)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-orange-500" />
                <span className="font-semibold text-gray-900">
                  {mapData?.plan?.display_name || 'Localisation sur plan'}
                </span>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 min-h-[60vh]">
              <SharedMapPreview shareToken={shareToken} className="h-full rounded-none border-0" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
