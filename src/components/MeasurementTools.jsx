// src/components/MeasurementTools.jsx
// Outils de mesure pour les plans Leaflet - distances et surfaces
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Ruler,
  Square,
  Trash2,
  Download,
  X,
  Check,
  RotateCcw,
  Settings,
  Loader2,
  AlertTriangle,
  MousePointer2,
  List,
} from "lucide-react";

// ============================================================
// HOOKS - API calls
// ============================================================

const getAuthHeaders = () => {
  const headers = { "Content-Type": "application/json" };
  const token = document.cookie.match(/(?:^|; )token=([^;]+)/)?.[1];
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

const useMeasurements = (planId, pageIndex) => {
  const [measurements, setMeasurements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchMeasurements = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/measurements/${planId}?page=${pageIndex}`,
        { headers: getAuthHeaders() }
      );
      const data = await res.json();
      if (data.ok) {
        setMeasurements(data.measurements || []);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [planId, pageIndex]);

  const createMeasurement = useCallback(async (measurement) => {
    try {
      const res = await fetch("/api/measurements", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          planId,
          pageIndex,
          ...measurement,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMeasurements((prev) => [data.measurement, ...prev]);
        return data.measurement;
      }
      throw new Error(data.error);
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [planId, pageIndex]);

  const deleteMeasurement = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/measurements/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        setMeasurements((prev) => prev.filter((m) => m.id !== id));
        return true;
      }
      throw new Error(data.error);
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  const deleteAllMeasurements = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/measurements/plan/${planId}/all?page=${pageIndex}`,
        { method: "DELETE", headers: getAuthHeaders() }
      );
      const data = await res.json();
      if (data.ok) {
        setMeasurements([]);
        return true;
      }
      throw new Error(data.error);
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, [planId, pageIndex]);

  useEffect(() => {
    fetchMeasurements();
  }, [fetchMeasurements]);

  return {
    measurements,
    loading,
    error,
    createMeasurement,
    deleteMeasurement,
    deleteAllMeasurements,
    refresh: fetchMeasurements,
  };
};

const useScale = (planId, pageIndex) => {
  const [scale, setScale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchScale = useCallback(async () => {
    if (!planId) {
      setLoading(false);
      setHasFetched(true);
      return;
    }
    setLoading(true);
    try {
      const url = `/api/measurements/scale/${planId}?page=${pageIndex}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.ok) {
        setScale(data.scale);
      }
    } catch (err) {
      console.error("[useScale] Error fetching scale:", err);
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  }, [planId, pageIndex]);

  const saveScale = useCallback(async (scaleData) => {
    try {
      const res = await fetch("/api/measurements/scale", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          planId,
          pageIndex,
          ...scaleData,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setScale(data.scale);
        return data.scale;
      }
      throw new Error(data.error);
    } catch (err) {
      console.error("Error saving scale:", err);
      return null;
    }
  }, [planId, pageIndex]);

  useEffect(() => {
    fetchScale();
  }, [fetchScale]);

  return { scale, loading, hasFetched, saveScale, refresh: fetchScale };
};

// ============================================================
// HELPERS
// ============================================================

const formatDistance = (meters) => {
  if (meters === null || meters === undefined) return "N/A";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  if (meters >= 1) return `${meters.toFixed(2)} m`;
  return `${(meters * 100).toFixed(1)} cm`;
};

const formatArea = (sqMeters) => {
  if (sqMeters === null || sqMeters === undefined) return "N/A";
  if (sqMeters >= 10000) return `${(sqMeters / 10000).toFixed(2)} ha`;
  return `${sqMeters.toFixed(2)} m²`;
};

const formatScale = (metersPerPixel) => {
  if (!metersPerPixel) return "N/A";
  const cmPerPixel = metersPerPixel * 100;
  if (cmPerPixel >= 100) return `1px = ${(cmPerPixel / 100).toFixed(2)}m`;
  if (cmPerPixel >= 1) return `1px = ${cmPerPixel.toFixed(2)}cm`;
  return `1px = ${(cmPerPixel * 10).toFixed(2)}mm`;
};

const COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4",
];

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function MeasurementTools({
  planId,
  pageIndex = 0,
  mapRef,
  imageBounds,
  imageWidth,
  imageHeight,
  onMeasurementClick,
  className = "",
}) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // UI State
  const [menuOpen, setMenuOpen] = useState(false);
  const [showList, setShowList] = useState(false);
  const [mode, setMode] = useState(null); // null | 'line' | 'polygon' | 'scale'
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);

  // Refs to track current values (avoid stale closures)
  const modeRef = useRef(mode);
  const drawingPointsRef = useRef(drawingPoints);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);

  // Layers
  const allLayersRef = useRef([]);
  const drawingLayerRef = useRef(null);

  // Click timing to distinguish single vs double click
  const lastClickTimeRef = useRef(0);

  // API hooks
  const {
    measurements,
    loading: measurementsLoading,
    createMeasurement,
    deleteMeasurement,
    deleteAllMeasurements,
    refresh: refreshMeasurements,
  } = useMeasurements(planId, pageIndex);

  const { scale, loading: scaleLoading, hasFetched: scaleFetched, saveScale } = useScale(planId, pageIndex);

  // Scale calibration state
  const [scalePoints, setScalePoints] = useState([]);
  const [scaleDistance, setScaleDistance] = useState("");

  // Coordinate conversions
  const screenToFrac = useCallback((latlng) => {
    if (!imageBounds || !imageWidth || !imageHeight) return null;
    const [[minY, minX], [maxY, maxX]] = imageBounds;
    const x = (latlng.lng - minX) / (maxX - minX);
    const y = (latlng.lat - minY) / (maxY - minY);
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }, [imageBounds, imageWidth, imageHeight]);

  const fracToLatLng = useCallback((point) => {
    if (!imageBounds) return null;
    const [[minY, minX], [maxY, maxX]] = imageBounds;
    return [minY + point.y * (maxY - minY), minX + point.x * (maxX - minX)];
  }, [imageBounds]);

  // Calculations
  // The scale stores meters_per_pixel based on the image dimensions when calibrated.
  // We must use the SAME dimensions for consistent calculations.
  const calculateDistance = useCallback((points) => {
    if (!scale || points.length < 2) return null;
    // Use calibration dimensions, NOT current view dimensions
    const calibW = scale.image_width || 1000;
    const calibH = scale.image_height || 1000;
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = (points[i + 1].x - points[i].x) * calibW;
      const dy = (points[i + 1].y - points[i].y) * calibH;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total * scale.scale_meters_per_pixel;
  }, [scale]);

  const calculateArea = useCallback((points) => {
    if (!scale || points.length < 3) return null;
    const s = scale.scale_meters_per_pixel;
    // Use calibration dimensions, NOT current view dimensions
    const calibW = scale.image_width || 1000;
    const calibH = scale.image_height || 1000;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * calibW * s * points[j].y * calibH * s - points[j].x * calibW * s * points[i].y * calibH * s;
    }
    return Math.abs(area / 2);
  }, [scale]);

  // Clear all layers
  const clearAllLayers = useCallback(() => {
    const map = mapRef?.current;
    if (!map) return;
    allLayersRef.current.forEach((layer) => {
      try { if (map.hasLayer(layer)) map.removeLayer(layer); } catch (e) {}
    });
    allLayersRef.current = [];
    if (drawingLayerRef.current) {
      try { if (map.hasLayer(drawingLayerRef.current)) map.removeLayer(drawingLayerRef.current); } catch (e) {}
      drawingLayerRef.current = null;
    }
  }, [mapRef]);

  // Draw saved measurements
  const drawMeasurements = useCallback(() => {
    const map = mapRef?.current;
    if (!map || !imageBounds) return;
    clearAllLayers();

    measurements.forEach((m) => {
      const points = m.points || [];
      if (points.length < 2) return;
      const latLngs = points.map(fracToLatLng).filter(Boolean);
      if (latLngs.length < 2) return;

      const isSelected = m.id === selectedId;
      const color = isSelected ? "#a78bfa" : m.color || "#ef4444";
      const weight = isSelected ? 4 : 3;

      let shapeLayer;
      if (m.type === "line") {
        shapeLayer = L.polyline(latLngs, { color, weight, opacity: 0.9 });
        shapeLayer.addTo(map);
        allLayersRef.current.push(shapeLayer);

        if (m.distance_meters !== null) {
          const mid = latLngs[Math.floor(latLngs.length / 2)];
          const label = L.divIcon({
            className: "measurement-label",
            html: `<div style="background:white;padding:3px 6px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.2);font-size:11px;font-weight:600;color:${color};border:2px solid ${color};white-space:nowrap">${formatDistance(m.distance_meters)}</div>`,
          });
          const labelMarker = L.marker(mid, { icon: label, interactive: false });
          labelMarker.addTo(map);
          allLayersRef.current.push(labelMarker);
        }

        latLngs.forEach((ll) => {
          const marker = L.circleMarker(ll, { radius: 5, color: "white", fillColor: color, fillOpacity: 1, weight: 2 });
          marker.addTo(map);
          allLayersRef.current.push(marker);
        });
      } else if (m.type === "polygon") {
        shapeLayer = L.polygon(latLngs, { color, weight, fillColor: color, fillOpacity: isSelected ? 0.3 : 0.2 });
        shapeLayer.addTo(map);
        allLayersRef.current.push(shapeLayer);

        if (m.area_square_meters !== null) {
          const centroid = latLngs.reduce((acc, ll) => [acc[0] + ll[0] / latLngs.length, acc[1] + ll[1] / latLngs.length], [0, 0]);
          const label = L.divIcon({
            className: "measurement-label",
            html: `<div style="background:white;padding:3px 6px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.2);font-size:11px;font-weight:600;color:${color};border:2px solid ${color};white-space:nowrap">${formatArea(m.area_square_meters)}</div>`,
          });
          const labelMarker = L.marker(centroid, { icon: label, interactive: false });
          labelMarker.addTo(map);
          allLayersRef.current.push(labelMarker);
        }

        latLngs.forEach((ll) => {
          const marker = L.circleMarker(ll, { radius: 5, color: "white", fillColor: color, fillOpacity: 1, weight: 2 });
          marker.addTo(map);
          allLayersRef.current.push(marker);
        });
      }

      if (shapeLayer) {
        shapeLayer.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedId(m.id === selectedId ? null : m.id);
          setShowList(true);
          onMeasurementClick?.(m);
        });
      }
    });
  }, [mapRef, imageBounds, measurements, selectedId, fracToLatLng, onMeasurementClick, clearAllLayers]);

  // Draw current drawing
  const drawCurrentDrawing = useCallback(() => {
    const map = mapRef?.current;
    if (!map || !imageBounds) return;

    if (drawingLayerRef.current && map.hasLayer(drawingLayerRef.current)) {
      map.removeLayer(drawingLayerRef.current);
    }
    drawingLayerRef.current = null;

    allLayersRef.current = allLayersRef.current.filter((layer) => {
      if (layer._isDrawingMarker) {
        try { map.removeLayer(layer); } catch (e) {}
        return false;
      }
      return true;
    });

    const pointsToUse = mode === "scale" ? scalePoints : drawingPoints;
    if (!mode || pointsToUse.length === 0) return;

    const latLngs = pointsToUse.map(fracToLatLng).filter(Boolean);
    if (latLngs.length === 0) return;

    const allLatLngs = hoverPoint ? [...latLngs, fracToLatLng(hoverPoint)] : latLngs;
    const drawColor = mode === "scale" ? "#f59e0b" : mode === "polygon" ? "#8b5cf6" : "#3b82f6";

    if (mode === "line" || mode === "scale") {
      drawingLayerRef.current = L.polyline(allLatLngs, { color: drawColor, weight: 3, dashArray: "8, 8", opacity: 0.9 }).addTo(map);
    } else if (mode === "polygon" && allLatLngs.length >= 3) {
      drawingLayerRef.current = L.polygon(allLatLngs, { color: drawColor, weight: 3, fillColor: drawColor, fillOpacity: 0.15, dashArray: "8, 8" }).addTo(map);
    } else if (mode === "polygon") {
      drawingLayerRef.current = L.polyline(allLatLngs, { color: drawColor, weight: 3, dashArray: "8, 8" }).addTo(map);
    }

    pointsToUse.forEach((pt) => {
      const ll = fracToLatLng(pt);
      if (!ll) return;
      const marker = L.circleMarker(ll, { radius: 7, color: "white", fillColor: drawColor, fillOpacity: 1, weight: 2 });
      marker._isDrawingMarker = true;
      marker.addTo(map);
      allLayersRef.current.push(marker);
    });
  }, [mapRef, imageBounds, mode, drawingPoints, scalePoints, hoverPoint, fracToLatLng]);

  // Map event handlers
  // Strategy: Add points immediately, detect double-click by timing
  const handleMapClick = useCallback((e) => {
    if (!mode) return;
    const point = screenToFrac(e.latlng);
    if (!point) return;

    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;
    lastClickTimeRef.current = now;

    // If this click is part of a double-click (< 300ms), ignore it for adding points
    // The dblclick handler will handle finishing
    if (timeSinceLastClick < 300) {
      return;
    }

    // Add point immediately
    if (mode === "scale") {
      if (scalePoints.length < 2) setScalePoints((prev) => [...prev, point]);
    } else {
      setDrawingPoints((prev) => [...prev, point]);
    }
  }, [mode, screenToFrac, scalePoints.length]);

  const handleMapDblClick = useCallback((e) => {
    // Use refs to get current values (avoid stale closures)
    const currentMode = modeRef.current;
    const currentPoints = drawingPointsRef.current;

    if (!currentMode || currentMode === "scale") return;
    L.DomEvent.stopPropagation(e);
    L.DomEvent.preventDefault(e);

    // Finish if we have enough points
    if ((currentMode === "line" && currentPoints.length >= 2) || (currentMode === "polygon" && currentPoints.length >= 3)) {
      finishDrawingRef.current();
    }
  }, []); // No dependencies - uses refs

  const handleMapMouseMove = useCallback((e) => {
    if (!mode) return;
    setHoverPoint(screenToFrac(e.latlng));
  }, [mode, screenToFrac]);

  // Finish drawing - uses refs to get current values
  const finishDrawingRef = useRef(null);
  finishDrawingRef.current = async () => {
    // Use refs to get current values
    const currentMode = modeRef.current;
    const currentPoints = [...drawingPointsRef.current]; // Copy to avoid mutation issues

    console.log("[finishDrawing] mode:", currentMode, "points:", currentPoints.length);

    if (currentMode === "line" && currentPoints.length >= 2) {
      const measurement = await createMeasurement({ type: "line", points: currentPoints, color: COLORS[measurements.length % COLORS.length] });
      console.log("[finishDrawing] line measurement created:", measurement);
      if (measurement) setSelectedId(measurement.id);
    } else if (currentMode === "polygon" && currentPoints.length >= 3) {
      const measurement = await createMeasurement({ type: "polygon", points: currentPoints, color: COLORS[measurements.length % COLORS.length] });
      console.log("[finishDrawing] polygon measurement created:", measurement);
      if (measurement) setSelectedId(measurement.id);
    }
    setMode(null);
    setDrawingPoints([]);
    setHoverPoint(null);
    setShowList(true);
  };

  const cancelDrawing = () => {
    setMode(null);
    setDrawingPoints([]);
    setHoverPoint(null);
    setScalePoints([]);
    setScaleDistance("");
  };

  const handleSaveScale = async () => {
    if (scalePoints.length !== 2 || !scaleDistance) return;
    const result = await saveScale({
      point1: scalePoints[0],
      point2: scalePoints[1],
      realDistanceMeters: parseFloat(scaleDistance),
      imageWidth,
      imageHeight,
    });
    if (result) {
      cancelDrawing();
      refreshMeasurements();
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    await deleteMeasurement(selectedId);
    setSelectedId(null);
  };

  const handleUndo = () => {
    if (mode === "scale") setScalePoints((prev) => prev.slice(0, -1));
    else setDrawingPoints((prev) => prev.slice(0, -1));
  };

  const handleExport = () => {
    window.open(`/api/measurements/export/${planId}?page=${pageIndex}`, "_blank");
  };

  // Start a mode
  const startMode = (newMode) => {
    setMode(newMode);
    setMenuOpen(false);
    setShowList(false);
    if (newMode === "scale") {
      setScalePoints([]);
      setScaleDistance("");
    }
  };

  // Setup map events
  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;

    if (mode) {
      map.on("click", handleMapClick);
      map.on("dblclick", handleMapDblClick);
      map.on("mousemove", handleMapMouseMove);
      map.doubleClickZoom.disable();
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.off("click", handleMapClick);
      map.off("dblclick", handleMapDblClick);
      map.off("mousemove", handleMapMouseMove);
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = "";
    }

    return () => {
      map.off("click", handleMapClick);
      map.off("dblclick", handleMapDblClick);
      map.off("mousemove", handleMapMouseMove);
      try { map.doubleClickZoom.enable(); } catch (e) {}
      map.getContainer().style.cursor = "";
      // Clear any pending click timeout
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
    };
  }, [mapRef, mode, handleMapClick, handleMapDblClick, handleMapMouseMove]);

  useEffect(() => { drawMeasurements(); }, [drawMeasurements]);
  useEffect(() => { drawCurrentDrawing(); }, [drawCurrentDrawing]);

  // Computed values
  const currentDistance = mode === "line" ? calculateDistance(drawingPoints) : null;
  const currentArea = mode === "polygon" ? calculateArea(drawingPoints) : null;
  const scalePixelDistance = scalePoints.length === 2
    ? Math.sqrt(Math.pow((scalePoints[1].x - scalePoints[0].x) * (imageWidth || 1000), 2) + Math.pow((scalePoints[1].y - scalePoints[0].y) * (imageHeight || 1000), 2))
    : null;

  if (isMobile) return null;
  if (scaleFetched && !scale) return null;

  return (
    <>
      {/* Main button */}
      <div className={`absolute bottom-4 left-4 z-[1000] ${className}`}>
        <button
          onClick={() => { setMenuOpen(!menuOpen); setShowList(false); }}
          className={`w-11 h-11 rounded-xl shadow-lg flex items-center justify-center transition-all ${
            mode ? "bg-blue-600 text-white" : menuOpen ? "bg-blue-100 text-blue-700" : "bg-white text-blue-600 hover:bg-blue-50"
          } border-2 ${mode || menuOpen ? "border-blue-400" : "border-gray-200"}`}
          title="Outils de mesure"
        >
          <Ruler size={20} />
          {measurements.length > 0 && !mode && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
              {measurements.length}
            </span>
          )}
        </button>

        {/* Dropdown menu */}
        {menuOpen && !mode && (
          <div className="absolute bottom-14 left-0 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden min-w-[180px]">
            {scale && (
              <div className="px-3 py-2 bg-green-50 border-b text-xs text-green-700 flex items-center gap-1.5">
                <Check size={12} />
                {formatScale(scale.scale_meters_per_pixel)}
              </div>
            )}
            <button
              onClick={() => startMode("line")}
              className="w-full px-3 py-2.5 text-left hover:bg-blue-50 flex items-center gap-2 text-sm"
            >
              <Ruler size={16} className="text-blue-600" />
              Mesurer distance
            </button>
            <button
              onClick={() => startMode("polygon")}
              className="w-full px-3 py-2.5 text-left hover:bg-violet-50 flex items-center gap-2 text-sm"
            >
              <Square size={16} className="text-violet-600" />
              Mesurer surface
            </button>
            <div className="border-t" />
            <button
              onClick={() => startMode("scale")}
              className="w-full px-3 py-2.5 text-left hover:bg-amber-50 flex items-center gap-2 text-sm"
            >
              <Settings size={16} className="text-amber-600" />
              {scale ? "Reconfigurer echelle" : "Configurer echelle"}
            </button>
            {measurements.length > 0 && (
              <>
                <div className="border-t" />
                <button
                  onClick={() => { setShowList(true); setMenuOpen(false); }}
                  className="w-full px-3 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2 text-sm"
                >
                  <List size={16} className="text-gray-600" />
                  Voir mes mesures ({measurements.length})
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Drawing mode panel */}
      {mode && (
        <div className="absolute bottom-4 left-16 z-[1000]">
          <div className={`rounded-xl shadow-xl border-2 overflow-hidden min-w-[240px] ${
            mode === "scale" ? "bg-amber-50 border-amber-300" : mode === "polygon" ? "bg-violet-50 border-violet-300" : "bg-blue-50 border-blue-300"
          }`}>
            <div className="p-3 space-y-2">
              {/* Mode header */}
              <div className="flex items-center gap-2">
                <MousePointer2 size={16} className={mode === "scale" ? "text-amber-600" : mode === "polygon" ? "text-violet-600" : "text-blue-600"} />
                <span className={`text-sm font-medium ${mode === "scale" ? "text-amber-800" : mode === "polygon" ? "text-violet-800" : "text-blue-800"}`}>
                  {mode === "scale" && (scalePoints.length === 0 ? "1. Cliquez 1er point" : scalePoints.length === 1 ? "2. Cliquez 2eme point" : "3. Entrez la distance")}
                  {mode === "line" && "Tracez une distance"}
                  {mode === "polygon" && "Definissez une zone"}
                </span>
              </div>

              {/* Instructions */}
              {mode !== "scale" && (
                <p className="text-xs text-gray-600">
                  Cliquez pour ajouter • Double-cliquez pour finir
                </p>
              )}

              {/* Scale input */}
              {mode === "scale" && scalePoints.length === 2 && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Distance (m)"
                    value={scaleDistance}
                    onChange={(e) => setScaleDistance(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-sm border rounded-lg"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveScale}
                    disabled={!scaleDistance}
                    className="px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                  >
                    <Check size={14} />
                  </button>
                </div>
              )}

              {/* Current measurement */}
              {drawingPoints.length > 0 && (
                <div className={`text-sm font-semibold px-2 py-1 rounded ${mode === "polygon" ? "bg-violet-100 text-violet-900" : "bg-blue-100 text-blue-900"}`}>
                  {mode === "line" && currentDistance !== null && `Distance: ${formatDistance(currentDistance)}`}
                  {mode === "polygon" && (currentArea !== null ? `Surface: ${formatArea(currentArea)}` : `${drawingPoints.length} points`)}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {(drawingPoints.length > 0 || scalePoints.length > 0) && (
                  <button onClick={handleUndo} className="px-2 py-1 text-xs bg-white hover:bg-gray-100 border rounded-lg flex items-center gap-1">
                    <RotateCcw size={12} /> Retour
                  </button>
                )}
                {mode !== "scale" && (
                  <button
                    onClick={() => finishDrawingRef.current?.()}
                    disabled={(mode === "line" && drawingPoints.length < 2) || (mode === "polygon" && drawingPoints.length < 3)}
                    className="px-2 py-1 text-xs bg-green-500 text-white hover:bg-green-600 rounded-lg flex items-center gap-1 disabled:opacity-50"
                  >
                    <Check size={12} /> Valider
                  </button>
                )}
                <button onClick={cancelDrawing} className="px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded-lg flex items-center gap-1">
                  <X size={12} /> Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Measurements list panel */}
      {showList && !mode && measurements.length > 0 && (
        <div className="absolute bottom-4 left-16 z-[1000]">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden min-w-[220px] max-w-[280px]">
            <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Mes mesures</span>
              <div className="flex gap-1">
                <button onClick={handleExport} className="p-1 hover:bg-gray-200 rounded" title="Exporter PDF">
                  <Download size={14} className="text-gray-500" />
                </button>
                <button onClick={() => confirm("Supprimer tout ?") && deleteAllMeasurements()} className="p-1 hover:bg-red-100 rounded" title="Tout supprimer">
                  <Trash2 size={14} className="text-red-500" />
                </button>
                <button onClick={() => setShowList(false)} className="p-1 hover:bg-gray-200 rounded">
                  <X size={14} className="text-gray-500" />
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {measurements.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}
                  className={`px-3 py-2 cursor-pointer flex items-center justify-between border-b last:border-0 ${
                    m.id === selectedId ? "bg-violet-50" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                    <span className="text-sm font-medium">
                      {m.type === "line" ? formatDistance(m.distance_meters) : formatArea(m.area_square_meters)}
                    </span>
                  </div>
                  {m.id === selectedId && (
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(); }} className="p-1 bg-red-100 hover:bg-red-200 rounded">
                      <Trash2 size={12} className="text-red-600" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {(measurementsLoading || scaleLoading) && (
        <div className="absolute bottom-4 left-16 z-[1000]">
          <div className="bg-white rounded-xl shadow-lg p-3">
            <Loader2 size={20} className="animate-spin text-blue-500" />
          </div>
        </div>
      )}
    </>
  );
}

export function ScaleCalibrationTool() {
  return null;
}
