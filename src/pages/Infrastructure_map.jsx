// src/pages/Infrastructure_map.jsx
// Vue carte pour les plans d'infrastructure électrique
// Permet de placer les équipements ATEX sur les plans
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../lib/api.js";
import {
  isMobileDevice,
  getPDFConfig,
  getPlanCacheKey,
  getCachedPlan,
  cachePlan,
  getOptimalImageFormat,
} from "../config/mobile-optimization.js";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ============================================================
// INFRASTRUCTURE MAP COMPONENT
// ============================================================

export default function InfrastructureMap({
  plan,
  positions = [],
  zones = [],
  atexEquipments = [],
  onPlaceEquipment,
  onUpdatePosition,
  onDeletePosition,
  onZoneCreate,
  onZoneUpdate,
  onZoneDelete,
  refreshTick = 0,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const markersLayerRef = useRef(null);
  const zonesLayerRef = useRef(null);

  // PDF states
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [imgSrc, setImgSrc] = useState(null);

  // Interaction states
  const [placingEquipment, setPlacingEquipment] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [drawingZone, setDrawingZone] = useState(false);
  const [zonePoints, setZonePoints] = useState([]);

  // Selected position for highlight
  const [selectedPositionId, setSelectedPositionId] = useState(null);

  // Filter for equipment selector - only show equipment not already placed on this plan
  const placedEquipmentIds = useMemo(() => {
    return new Set(positions.map(p => p.equipment_id));
  }, [positions]);

  const availableEquipments = useMemo(() => {
    return atexEquipments.filter(eq => !placedEquipmentIds.has(eq.id));
  }, [atexEquipments, placedEquipmentIds]);

  // ============================================================
  // Load PDF
  // ============================================================
  const loadPdf = useCallback(async () => {
    if (!plan) return;

    setPdfLoading(true);
    setPdfError(null);

    try {
      const config = getPDFConfig();
      const cacheKey = getPlanCacheKey(`infra_${plan.id || plan.logical_name}`, 0, config);

      // Check cache first
      const cached = getCachedPlan(cacheKey);
      if (cached) {
        setImgSrc(cached.dataUrl);
        setImgSize({ w: cached.width, h: cached.height });
        setPdfLoading(false);
        return;
      }

      // Fetch PDF
      const pdfUrl = api.infra.planFileUrl(plan, { bust: false });
      const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      // Calculate optimal scale
      const viewport = page.getViewport({ scale: 1 });
      const baseWidth = viewport.width;
      const targetWidth = Math.min(config.maxBitmapWidth, Math.max(config.minBitmapWidth, baseWidth * config.qualityBoost));
      const scale = Math.min(config.maxScale, Math.max(config.minScale, targetWidth / baseWidth));

      const scaledViewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      const ctx = canvas.getContext("2d", {
        alpha: false,           // Pas de canal alpha (opaque) - évite fond noir sur Chrome
        desynchronized: false,  // Synchrone pour cohérence
        willReadFrequently: false,
      });

      // IMPORTANT: Fond blanc AVANT le rendu PDF (sinon fond noir sur Chrome)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.imageSmoothingEnabled = config.enableImageSmoothing;
      ctx.imageSmoothingQuality = "high";

      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
        intent: config.intent,
      }).promise;

      // Get optimal format (JPEG on mobile, PNG on desktop)
      const dataUrl = getOptimalImageFormat(canvas);

      // Cache the result
      cachePlan(cacheKey, dataUrl, canvas.width, canvas.height);

      setImgSrc(dataUrl);
      setImgSize({ w: canvas.width, h: canvas.height });

      // Cleanup
      pdf.cleanup?.();
    } catch (err) {
      console.error("[InfraMap] PDF load error:", err);
      setPdfError(err.message || "Erreur de chargement du PDF");
    } finally {
      setPdfLoading(false);
    }
  }, [plan]);

  useEffect(() => {
    loadPdf();
  }, [loadPdf, refreshTick]);

  // ============================================================
  // Initialize Leaflet map
  // ============================================================
  useEffect(() => {
    if (!containerRef.current || !imgSrc || imgSize.w === 0) return;

    // Destroy existing map
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    // Create map
    const bounds = [
      [0, 0],
      [imgSize.h, imgSize.w],
    ];

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 4,
      zoomControl: true,
      attributionControl: false,
    });

    // Add image overlay
    const overlay = L.imageOverlay(imgSrc, bounds);
    overlay.addTo(map);
    map.fitBounds(bounds);

    // Create layers for zones and markers
    const zonesLayer = L.layerGroup().addTo(map);
    const markersLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    overlayRef.current = overlay;
    markersLayerRef.current = markersLayer;
    zonesLayerRef.current = zonesLayer;

    // Click handler for placing equipment
    map.on("click", (e) => {
      if (placingEquipment && selectedEquipmentId) {
        const { lat, lng } = e.latlng;
        const x_frac = lng / imgSize.w;
        const y_frac = 1 - lat / imgSize.h;

        onPlaceEquipment?.(selectedEquipmentId, x_frac, y_frac, 0);

        setPlacingEquipment(false);
        setSelectedEquipmentId("");
      }

      if (drawingZone) {
        const { lat, lng } = e.latlng;
        setZonePoints((prev) => [...prev, { lat, lng }]);
      }
    });

    return () => {
      map.remove();
    };
  }, [imgSrc, imgSize]);

  // Re-render markers when positions change or when placing mode changes
  useEffect(() => {
    if (!markersLayerRef.current || !imgSize.w) return;

    markersLayerRef.current.clearLayers();

    positions.forEach((pos) => {
      if (pos.x_frac === undefined || pos.y_frac === undefined) return;

      const lat = (1 - pos.y_frac) * imgSize.h;
      const lng = pos.x_frac * imgSize.w;

      const isSelected = pos.id === selectedPositionId;

      const icon = L.divIcon({
        className: "infra-marker",
        html: `
          <div class="infra-marker-inner ${isSelected ? "selected" : ""}" style="background: #F59E0B">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([lat, lng], {
        icon,
        draggable: true,
      });

      const equipmentName = pos.equipment_name || "Équipement";
      marker.bindTooltip(`${equipmentName}`, {
        permanent: false,
        direction: "top",
      });

      marker.on("click", () => {
        setSelectedPositionId(pos.id);
      });

      marker.on("dragend", (e) => {
        const { lat: newLat, lng: newLng } = e.target.getLatLng();
        const x_frac = newLng / imgSize.w;
        const y_frac = 1 - newLat / imgSize.h;
        onUpdatePosition?.(pos.id, { x_frac, y_frac });
      });

      markersLayerRef.current.addLayer(marker);
    });
  }, [positions, imgSize, selectedPositionId, onUpdatePosition]);

  // ============================================================
  // Draw zones
  // ============================================================
  useEffect(() => {
    if (!zonesLayerRef.current || !imgSize.w) return;

    zonesLayerRef.current.clearLayers();

    zones.forEach((zone) => {
      if (!zone.geometry) return;

      const color = zone.color || "#6B7280";
      let shape;

      const geom = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;

      if (zone.kind === "rect" && geom.x1 !== undefined) {
        const { x1, y1, x2, y2 } = geom;
        const bounds = [
          [(1 - y2) * imgSize.h, x1 * imgSize.w],
          [(1 - y1) * imgSize.h, x2 * imgSize.w],
        ];
        shape = L.rectangle(bounds, {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.2,
        });
      } else if (zone.kind === "circle" && geom.cx !== undefined) {
        const { cx, cy, r } = geom;
        const lat = (1 - cy) * imgSize.h;
        const lng = cx * imgSize.w;
        const radius = r * Math.min(imgSize.w, imgSize.h);
        shape = L.circle([lat, lng], {
          radius,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.2,
        });
      } else if (zone.kind === "poly" && geom.points?.length) {
        const latLngs = geom.points.map((pt) => {
          const [x, y] = Array.isArray(pt) ? pt : [pt.x, pt.y];
          return [(1 - y) * imgSize.h, x * imgSize.w];
        });
        shape = L.polygon(latLngs, {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.2,
        });
      }

      if (shape) {
        shape.bindTooltip(zone.name || "Zone", { permanent: false, direction: "center" });
        zonesLayerRef.current.addLayer(shape);
      }
    });
  }, [zones, imgSize]);

  // ============================================================
  // Drawing zone polygon
  // ============================================================
  useEffect(() => {
    if (!mapRef.current || !drawingZone || zonePoints.length < 2) return;

    const latLngs = zonePoints.map((p) => [p.lat, p.lng]);
    const tempPoly = L.polygon(latLngs, {
      color: "#10B981",
      weight: 2,
      dashArray: "5, 5",
      fillColor: "#10B981",
      fillOpacity: 0.1,
    });
    tempPoly.addTo(mapRef.current);

    return () => {
      mapRef.current?.removeLayer(tempPoly);
    };
  }, [zonePoints, drawingZone]);

  // Finish zone drawing
  const finishZoneDrawing = () => {
    if (zonePoints.length < 3) {
      alert("Une zone doit avoir au moins 3 points");
      return;
    }

    const points = zonePoints.map((p) => [p.lng / imgSize.w, 1 - p.lat / imgSize.h]);

    const zoneName = prompt("Nom de la zone:");
    if (!zoneName) {
      setDrawingZone(false);
      setZonePoints([]);
      return;
    }

    onZoneCreate?.({
      name: zoneName,
      kind: "poly",
      geometry: { points },
      color: "#6B7280",
      page_index: 0,
    });

    setDrawingZone(false);
    setZonePoints([]);
  };

  // Cancel zone drawing
  const cancelZoneDrawing = () => {
    setDrawingZone(false);
    setZonePoints([]);
  };

  // ============================================================
  // Render
  // ============================================================
  const isMobile = isMobileDevice();
  const windowH = typeof window !== "undefined" ? window.innerHeight : 900;
  const isLargeScreen = windowH > 800;
  const viewerHeight = isLargeScreen ? windowH - 200 : Math.min(windowH - 180, 700);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-200 bg-gray-50">
        <span className="text-sm font-medium text-gray-700">
          {plan?.display_name || plan?.logical_name}
        </span>

        <div className="flex-1" />

        {/* Add equipment button */}
        {!placingEquipment && !drawingZone && (
          <>
            <div className="flex items-center gap-2">
              <select
                value={selectedEquipmentId}
                onChange={(e) => setSelectedEquipmentId(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 max-w-[200px]"
              >
                <option value="">Sélectionner équipement...</option>
                {availableEquipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name} ({eq.building || "?"})
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (selectedEquipmentId) {
                    setPlacingEquipment(true);
                  }
                }}
                disabled={!selectedEquipmentId}
                className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Placer
              </button>
            </div>

            <button
              onClick={() => setDrawingZone(true)}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
            >
              Dessiner zone
            </button>
          </>
        )}

        {/* Placing mode indicator */}
        {placingEquipment && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-600 font-medium">
              Cliquez sur le plan pour placer l'équipement
            </span>
            <button
              onClick={() => {
                setPlacingEquipment(false);
                setSelectedEquipmentId("");
              }}
              className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg"
            >
              Annuler
            </button>
          </div>
        )}

        {/* Drawing zone mode */}
        {drawingZone && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-green-600 font-medium">
              Cliquez pour ajouter des points ({zonePoints.length} points)
            </span>
            <button
              onClick={finishZoneDrawing}
              disabled={zonePoints.length < 3}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50"
            >
              Terminer
            </button>
            <button
              onClick={cancelZoneDrawing}
              className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg"
            >
              Annuler
            </button>
          </div>
        )}
      </div>

      {/* Map container */}
      <div style={{ height: viewerHeight }} className="relative">
        {pdfLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent mx-auto mb-4" />
              <p className="text-gray-600">Chargement du plan...</p>
            </div>
          </div>
        )}

        {pdfError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="text-center text-red-500">
              <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p>{pdfError}</p>
              <button
                onClick={loadPdf}
                className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg"
              >
                Réessayer
              </button>
            </div>
          </div>
        )}

        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* Legend */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-gray-500">
            {positions.length} équipement(s) placé(s) - {zones.length} zone(s)
          </span>
          {selectedPositionId && (
            <button
              onClick={() => {
                if (confirm("Retirer cet équipement du plan ?")) {
                  onDeletePosition?.(selectedPositionId);
                  setSelectedPositionId(null);
                }
              }}
              className="text-red-600 hover:text-red-700"
            >
              Retirer l'équipement sélectionné
            </button>
          )}
        </div>
      </div>

      {/* CSS for markers */}
      <style>{`
        .infra-marker {
          background: transparent !important;
          border: none !important;
        }
        .infra-marker-inner {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 14px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: transform 0.15s;
        }
        .infra-marker-inner:hover {
          transform: scale(1.15);
        }
        .infra-marker-inner.selected {
          box-shadow: 0 0 0 3px white, 0 0 0 6px #F59E0B;
        }
        .infra-marker-inner svg {
          width: 16px;
          height: 16px;
        }
      `}</style>
    </div>
  );
}
