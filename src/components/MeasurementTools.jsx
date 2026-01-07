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
  Edit3,
  RotateCcw,
  Settings,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  Move,
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

  const updateMeasurement = useCallback(async (id, updates) => {
    try {
      const res = await fetch(`/api/measurements/${id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.ok) {
        setMeasurements((prev) =>
          prev.map((m) => (m.id === id ? data.measurement : m))
        );
        return data.measurement;
      }
      throw new Error(data.error);
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

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
    updateMeasurement,
    deleteMeasurement,
    deleteAllMeasurements,
    refresh: fetchMeasurements,
  };
};

const useScale = (planId, pageIndex) => {
  const [scale, setScale] = useState(null);
  const [loading, setLoading] = useState(true); // Start as true - assume loading until proven otherwise
  const [hasFetched, setHasFetched] = useState(false);

  const fetchScale = useCallback(async () => {
    if (!planId) {
      setLoading(false);
      setHasFetched(true);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/measurements/scale/${planId}?page=${pageIndex}`,
        { headers: getAuthHeaders() }
      );
      const data = await res.json();
      if (data.ok) {
        setScale(data.scale);
      }
    } catch (err) {
      console.error("Error fetching scale:", err);
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
  if (meters >= 1) return `${meters.toFixed(2)} m`;
  return `${(meters * 100).toFixed(1)} cm`;
};

const formatArea = (sqMeters) => {
  if (sqMeters === null || sqMeters === undefined) return "N/A";
  return `${sqMeters.toFixed(2)} m²`;
};

const COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
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
  // Detect if mobile - DON'T render on mobile at all
  // Use only screen width - touch capability check was flagging laptops with touchscreens
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const checkMobile = () => {
      // Only use screen width to detect mobile - not touch capability
      // This avoids false positives on laptops with touchscreens
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // State
  const [isExpanded, setIsExpanded] = useState(false);
  const [mode, setMode] = useState(null); // null | 'line' | 'polygon' | 'scale'
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);

  // Drawing layers ref
  const drawingLayerRef = useRef(null);
  const measurementLayersRef = useRef({});

  // API hooks
  const {
    measurements,
    loading: measurementsLoading,
    createMeasurement,
    updateMeasurement,
    deleteMeasurement,
    deleteAllMeasurements,
    refresh: refreshMeasurements,
  } = useMeasurements(planId, pageIndex);

  const { scale, loading: scaleLoading, hasFetched: scaleFetched, saveScale } = useScale(planId, pageIndex);

  // Scale calibration state
  const [scalePoints, setScalePoints] = useState([]);
  const [scaleDistance, setScaleDistance] = useState("");

  // Convert screen coords to fractional coords
  const screenToFrac = useCallback((latlng) => {
    if (!imageBounds || !imageWidth || !imageHeight) return null;
    const [[minY, minX], [maxY, maxX]] = imageBounds;
    const x = (latlng.lng - minX) / (maxX - minX);
    const y = (latlng.lat - minY) / (maxY - minY);
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }, [imageBounds, imageWidth, imageHeight]);

  // Convert fractional coords to screen coords
  const fracToLatLng = useCallback((point) => {
    if (!imageBounds) return null;
    const [[minY, minX], [maxY, maxX]] = imageBounds;
    const lat = minY + point.y * (maxY - minY);
    const lng = minX + point.x * (maxX - minX);
    return [lat, lng];
  }, [imageBounds]);

  // Calculate distance between points in fractional coords
  const calculateDistance = useCallback((points) => {
    if (!scale || points.length < 2) return null;
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = (points[i + 1].x - points[i].x) * (imageWidth || 1000);
      const dy = (points[i + 1].y - points[i].y) * (imageHeight || 1000);
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total * scale.scale_meters_per_pixel;
  }, [scale, imageWidth, imageHeight]);

  // Calculate area of polygon in fractional coords
  const calculateArea = useCallback((points) => {
    if (!scale || points.length < 3) return null;
    const s = scale.scale_meters_per_pixel;
    const w = imageWidth || 1000;
    const h = imageHeight || 1000;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const xi = points[i].x * w * s;
      const yi = points[i].y * h * s;
      const xj = points[j].x * w * s;
      const yj = points[j].y * h * s;
      area += xi * yj - xj * yi;
    }
    return Math.abs(area / 2);
  }, [scale, imageWidth, imageHeight]);

  // Draw measurements on map
  const drawMeasurements = useCallback(() => {
    const map = mapRef?.current;
    if (!map || !imageBounds) return;

    // Clear existing layers
    Object.values(measurementLayersRef.current).forEach((layer) => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    measurementLayersRef.current = {};

    // Draw each measurement
    measurements.forEach((m) => {
      const points = m.points || [];
      if (points.length < 2) return;

      const latLngs = points.map(fracToLatLng).filter(Boolean);
      if (latLngs.length < 2) return;

      const isSelected = m.id === selectedId;
      const color = isSelected ? "#a78bfa" : m.color || "#ef4444";
      const weight = isSelected ? 4 : 3;

      let layer;
      if (m.type === "line") {
        layer = L.polyline(latLngs, {
          color,
          weight,
          opacity: 0.8,
          dashArray: isSelected ? null : "5, 5",
        });

        // Add distance label at midpoint
        if (m.distance_meters !== null) {
          const mid = latLngs[Math.floor(latLngs.length / 2)];
          const label = L.divIcon({
            className: "measurement-label",
            html: `<div class="bg-white/90 px-2 py-1 rounded shadow text-xs font-medium" style="color: ${color}; border: 1px solid ${color}">
              ${formatDistance(m.distance_meters)}
            </div>`,
          });
          L.marker(mid, { icon: label, interactive: false }).addTo(map);
        }
      } else if (m.type === "polygon") {
        layer = L.polygon(latLngs, {
          color,
          weight,
          fillColor: color,
          fillOpacity: isSelected ? 0.3 : 0.15,
        });

        // Add area label at centroid
        if (m.area_square_meters !== null) {
          const centroid = latLngs.reduce(
            (acc, ll) => [acc[0] + ll[0] / latLngs.length, acc[1] + ll[1] / latLngs.length],
            [0, 0]
          );
          const label = L.divIcon({
            className: "measurement-label",
            html: `<div class="bg-white/90 px-2 py-1 rounded shadow text-xs font-medium" style="color: ${color}; border: 1px solid ${color}">
              ${formatArea(m.area_square_meters)}
            </div>`,
          });
          L.marker(centroid, { icon: label, interactive: false }).addTo(map);
        }
      }

      if (layer) {
        layer.on("click", () => {
          setSelectedId(m.id === selectedId ? null : m.id);
          onMeasurementClick?.(m);
        });
        layer.addTo(map);
        measurementLayersRef.current[m.id] = layer;
      }
    });
  }, [mapRef, imageBounds, measurements, selectedId, fracToLatLng, onMeasurementClick]);

  // Draw current drawing
  const drawCurrentDrawing = useCallback(() => {
    const map = mapRef?.current;
    if (!map || !imageBounds) return;

    // Remove previous drawing layer
    if (drawingLayerRef.current && map.hasLayer(drawingLayerRef.current)) {
      map.removeLayer(drawingLayerRef.current);
    }
    drawingLayerRef.current = null;

    if (!mode || drawingPoints.length === 0) return;

    const latLngs = drawingPoints.map(fracToLatLng).filter(Boolean);
    if (latLngs.length === 0) return;

    // Add hover point if exists
    const allLatLngs = hoverPoint
      ? [...latLngs, fracToLatLng(hoverPoint)]
      : latLngs;

    if (mode === "line" || mode === "scale") {
      drawingLayerRef.current = L.polyline(allLatLngs, {
        color: mode === "scale" ? "#f59e0b" : "#3b82f6",
        weight: 3,
        dashArray: "10, 5",
        opacity: 0.8,
      }).addTo(map);
    } else if (mode === "polygon" && allLatLngs.length >= 3) {
      drawingLayerRef.current = L.polygon(allLatLngs, {
        color: "#8b5cf6",
        weight: 2,
        fillColor: "#8b5cf6",
        fillOpacity: 0.2,
        dashArray: "5, 5",
      }).addTo(map);
    } else if (mode === "polygon") {
      drawingLayerRef.current = L.polyline(allLatLngs, {
        color: "#8b5cf6",
        weight: 2,
        dashArray: "5, 5",
      }).addTo(map);
    }

    // Draw points
    drawingPoints.forEach((pt, i) => {
      const ll = fracToLatLng(pt);
      if (!ll) return;
      const marker = L.circleMarker(ll, {
        radius: 6,
        color: "white",
        fillColor: mode === "scale" ? "#f59e0b" : "#3b82f6",
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
      measurementLayersRef.current[`drawing_${i}`] = marker;
    });
  }, [mapRef, imageBounds, mode, drawingPoints, hoverPoint, fracToLatLng]);

  // Handle map click during drawing
  const handleMapClick = useCallback((e) => {
    if (!mode) return;

    const point = screenToFrac(e.latlng);
    if (!point) return;

    if (mode === "scale") {
      if (scalePoints.length < 2) {
        setScalePoints((prev) => [...prev, point]);
      }
    } else {
      setDrawingPoints((prev) => [...prev, point]);
    }
  }, [mode, screenToFrac, scalePoints.length]);

  // Handle map mousemove during drawing
  const handleMapMouseMove = useCallback((e) => {
    if (!mode) return;
    const point = screenToFrac(e.latlng);
    setHoverPoint(point);
  }, [mode, screenToFrac]);

  // Setup map event listeners
  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;

    if (mode) {
      map.on("click", handleMapClick);
      map.on("mousemove", handleMapMouseMove);
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.off("click", handleMapClick);
      map.off("mousemove", handleMapMouseMove);
      map.getContainer().style.cursor = "";
    }

    return () => {
      map.off("click", handleMapClick);
      map.off("mousemove", handleMapMouseMove);
      map.getContainer().style.cursor = "";
    };
  }, [mapRef, mode, handleMapClick, handleMapMouseMove]);

  // Redraw when data changes
  useEffect(() => {
    drawMeasurements();
  }, [drawMeasurements]);

  useEffect(() => {
    drawCurrentDrawing();
  }, [drawCurrentDrawing]);

  // Finish drawing
  const finishDrawing = async () => {
    if (mode === "line" && drawingPoints.length >= 2) {
      const measurement = await createMeasurement({
        type: "line",
        points: drawingPoints,
        color: COLORS[measurements.length % COLORS.length],
      });
      if (measurement) {
        setSelectedId(measurement.id);
      }
    } else if (mode === "polygon" && drawingPoints.length >= 3) {
      const measurement = await createMeasurement({
        type: "polygon",
        points: drawingPoints,
        color: COLORS[measurements.length % COLORS.length],
      });
      if (measurement) {
        setSelectedId(measurement.id);
      }
    }

    cancelDrawing();
  };

  // Cancel drawing
  const cancelDrawing = () => {
    setMode(null);
    setDrawingPoints([]);
    setHoverPoint(null);
    setScalePoints([]);
    setScaleDistance("");
  };

  // Save scale
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

  // Delete selected measurement
  const handleDelete = async () => {
    if (!selectedId) return;
    await deleteMeasurement(selectedId);
    setSelectedId(null);
  };

  // Undo last point
  const handleUndo = () => {
    if (mode === "scale") {
      setScalePoints((prev) => prev.slice(0, -1));
    } else {
      setDrawingPoints((prev) => prev.slice(0, -1));
    }
  };

  // Export PDF
  const handleExport = () => {
    window.open(`/api/measurements/export/${planId}?page=${pageIndex}`, "_blank");
  };

  // Current drawing info
  const currentDistance = mode === "line" ? calculateDistance(drawingPoints) : null;
  const currentArea = mode === "polygon" ? calculateArea(drawingPoints) : null;
  const scalePixelDistance = scalePoints.length === 2
    ? Math.sqrt(
        Math.pow((scalePoints[1].x - scalePoints[0].x) * (imageWidth || 1000), 2) +
        Math.pow((scalePoints[1].y - scalePoints[0].y) * (imageHeight || 1000), 2)
      )
    : null;

  // Don't render on mobile - measurement tools are desktop only
  if (isMobile) {
    return null;
  }

  // Don't render if no scale configured (buttons should only appear when scale is set)
  // But wait until fetch is complete before deciding
  if (scaleFetched && !scale) {
    return null;
  }

  return (
    <div className={`absolute bottom-4 left-4 z-[1000] ${className}`}>
      {/* Main Panel */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden min-w-[280px]">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Ruler size={18} className="text-blue-600" />
            <span className="font-medium text-gray-900">Mesures</span>
            {measurements.length > 0 && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                {measurements.length}
              </span>
            )}
          </div>
          {isExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>

        {isExpanded && (
          <div className="p-4 space-y-4">
            {/* Scale Status */}
            <div className={`p-3 rounded-lg ${scale ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"}`}>
              <div className="flex items-center gap-2">
                {scale ? (
                  <>
                    <Check size={16} className="text-green-600" />
                    <span className="text-sm text-green-800">
                      Echelle: 1px = {(scale.scale_meters_per_pixel * 100).toFixed(3)} cm
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={16} className="text-amber-600" />
                    <span className="text-sm text-amber-800">Echelle non configuree</span>
                  </>
                )}
              </div>
              <button
                onClick={() => {
                  setMode("scale");
                  setScalePoints([]);
                  setScaleDistance("");
                }}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <Settings size={12} />
                {scale ? "Reconfigurer" : "Configurer l'echelle"}
              </button>
            </div>

            {/* Scale Configuration Mode */}
            {mode === "scale" && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                <p className="text-sm text-amber-800">
                  {scalePoints.length === 0
                    ? "Cliquez sur le 1er point de reference"
                    : scalePoints.length === 1
                    ? "Cliquez sur le 2eme point de reference"
                    : "Entrez la distance reelle entre les 2 points"}
                </p>

                {scalePoints.length === 2 && (
                  <>
                    <div className="text-xs text-gray-600">
                      Distance pixels: {scalePixelDistance?.toFixed(0)} px
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Distance (metres)"
                        value={scaleDistance}
                        onChange={(e) => setScaleDistance(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      />
                      <button
                        onClick={handleSaveScale}
                        disabled={!scaleDistance}
                        className="px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check size={16} />
                      </button>
                    </div>
                  </>
                )}

                <div className="flex gap-2">
                  {scalePoints.length > 0 && (
                    <button
                      onClick={handleUndo}
                      className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
                    >
                      <RotateCcw size={12} /> Annuler
                    </button>
                  )}
                  <button
                    onClick={cancelDrawing}
                    className="px-3 py-1.5 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded-lg flex items-center gap-1"
                  >
                    <X size={12} /> Fermer
                  </button>
                </div>
              </div>
            )}

            {/* Drawing Tools */}
            {!mode && scale && (
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("line")}
                  className="flex-1 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Ruler size={16} />
                  <span className="text-sm">Distance</span>
                </button>
                <button
                  onClick={() => setMode("polygon")}
                  className="flex-1 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Square size={16} />
                  <span className="text-sm">Surface</span>
                </button>
              </div>
            )}

            {/* Drawing Mode */}
            {(mode === "line" || mode === "polygon") && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                <p className="text-sm text-blue-800">
                  {mode === "line"
                    ? `Cliquez pour tracer (${drawingPoints.length} points)`
                    : `Cliquez pour definir la zone (${drawingPoints.length} points)`}
                </p>

                {currentDistance !== null && (
                  <div className="text-sm font-medium text-blue-900">
                    Distance: {formatDistance(currentDistance)}
                  </div>
                )}
                {currentArea !== null && (
                  <div className="text-sm font-medium text-violet-900">
                    Surface: {formatArea(currentArea)}
                  </div>
                )}

                <div className="flex gap-2">
                  {drawingPoints.length > 0 && (
                    <button
                      onClick={handleUndo}
                      className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
                    >
                      <RotateCcw size={12} /> Annuler
                    </button>
                  )}
                  <button
                    onClick={finishDrawing}
                    disabled={
                      (mode === "line" && drawingPoints.length < 2) ||
                      (mode === "polygon" && drawingPoints.length < 3)
                    }
                    className="px-3 py-1.5 text-xs bg-green-500 text-white hover:bg-green-600 rounded-lg flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check size={12} /> Terminer
                  </button>
                  <button
                    onClick={cancelDrawing}
                    className="px-3 py-1.5 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded-lg flex items-center gap-1"
                  >
                    <X size={12} /> Annuler
                  </button>
                </div>
              </div>
            )}

            {/* Measurements List */}
            {measurements.length > 0 && !mode && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Mes mesures</span>
                  <div className="flex gap-1">
                    <button
                      onClick={handleExport}
                      className="p-1.5 hover:bg-gray-100 rounded-lg"
                      title="Exporter en PDF"
                    >
                      <Download size={14} className="text-gray-500" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Supprimer toutes les mesures ?")) {
                          deleteAllMeasurements();
                        }
                      }}
                      className="p-1.5 hover:bg-red-50 rounded-lg"
                      title="Supprimer tout"
                    >
                      <Trash2 size={14} className="text-red-500" />
                    </button>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1">
                  {measurements.map((m, i) => (
                    <div
                      key={m.id}
                      onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}
                      className={`p-2 rounded-lg cursor-pointer flex items-center justify-between transition-colors ${
                        m.id === selectedId
                          ? "bg-violet-100 border border-violet-300"
                          : "bg-gray-50 hover:bg-gray-100 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: m.color }}
                        />
                        <span className="text-sm">
                          {m.type === "line"
                            ? formatDistance(m.distance_meters)
                            : formatArea(m.area_square_meters)}
                        </span>
                      </div>
                      {m.id === selectedId && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete();
                          }}
                          className="p-1 hover:bg-red-100 rounded"
                        >
                          <Trash2 size={14} className="text-red-500" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Loading */}
            {(measurementsLoading || scaleLoading) && (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="animate-spin text-blue-500" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SCALE CALIBRATION COMPONENT (for Admin page)
// ============================================================

export function ScaleCalibrationTool({
  planId,
  pageIndex = 0,
  pdfUrl,
  onSave,
  onClose,
}) {
  const [scale, setScale] = useState(null);
  const [points, setPoints] = useState([]);
  const [distance, setDistance] = useState("");
  const [imageSize, setImageSize] = useState({ width: 1000, height: 1000 });
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  // Load existing scale
  useEffect(() => {
    const fetchScale = async () => {
      try {
        const res = await fetch(
          `/api/measurements/scale/${planId}?page=${pageIndex}`,
          { headers: getAuthHeaders() }
        );
        const data = await res.json();
        if (data.ok && data.scale) {
          setScale(data.scale);
        }
      } catch (err) {
        console.error("Error fetching scale:", err);
      }
    };
    fetchScale();
  }, [planId, pageIndex]);

  // Handle canvas click
  const handleCanvasClick = (e) => {
    if (points.length >= 2) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setPoints((prev) => [...prev, { x, y }]);
  };

  // Draw points and line on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw points
    points.forEach((pt, i) => {
      const x = pt.x * canvas.width;
      const y = pt.y * canvas.height;

      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#f59e0b";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = "white";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(i === 0 ? "A" : "B", x, y + 4);
    });

    // Draw line between points
    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
      ctx.lineTo(points[1].x * canvas.width, points[1].y * canvas.height);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.stroke();
    }
  }, [points]);

  // Calculate pixel distance
  const pixelDistance = points.length === 2
    ? Math.sqrt(
        Math.pow((points[1].x - points[0].x) * imageSize.width, 2) +
        Math.pow((points[1].y - points[0].y) * imageSize.height, 2)
      )
    : null;

  // Save scale
  const handleSave = async () => {
    if (points.length !== 2 || !distance) return;

    setLoading(true);
    try {
      const res = await fetch("/api/measurements/scale", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          planId,
          pageIndex,
          point1: points[0],
          point2: points[1],
          realDistanceMeters: parseFloat(distance),
          imageWidth: imageSize.width,
          imageHeight: imageSize.height,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onSave?.(data.scale);
        onClose?.();
      }
    } catch (err) {
      console.error("Error saving scale:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white">
              <Ruler size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Configuration de l'echelle</h3>
              <p className="text-sm text-gray-500">
                Cliquez sur 2 points et entrez la distance reelle
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <div className="grid md:grid-cols-3 gap-4">
            {/* Canvas */}
            <div className="md:col-span-2 relative">
              <div className="relative aspect-[4/3] bg-gray-100 rounded-xl overflow-hidden">
                {pdfUrl && (
                  <iframe
                    ref={imageRef}
                    src={pdfUrl}
                    className="absolute inset-0 w-full h-full border-0"
                    onLoad={(e) => {
                      // Try to get dimensions
                      setImageSize({ width: 1000, height: 750 });
                    }}
                  />
                )}
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={600}
                  onClick={handleCanvasClick}
                  className="absolute inset-0 w-full h-full cursor-crosshair"
                />
              </div>

              {/* Instructions */}
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800">
                  {points.length === 0
                    ? "1. Cliquez sur le premier point de reference (ex: debut d'un mur)"
                    : points.length === 1
                    ? "2. Cliquez sur le deuxieme point de reference (ex: fin du mur)"
                    : "3. Entrez la distance reelle entre ces 2 points"}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-4">
              {/* Current scale info */}
              {scale && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm text-green-800 font-medium">Echelle actuelle</div>
                  <div className="text-xs text-green-700 mt-1">
                    1 px = {(scale.scale_meters_per_pixel * 100).toFixed(4)} cm
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    Configure le {new Date(scale.updated_at || scale.created_at).toLocaleDateString("fr-FR")}
                  </div>
                </div>
              )}

              {/* Points info */}
              <div className="space-y-2">
                <div className={`p-3 rounded-lg ${points.length >= 1 ? "bg-amber-100" : "bg-gray-100"}`}>
                  <div className="text-sm font-medium">Point A</div>
                  {points[0] ? (
                    <div className="text-xs text-gray-600">
                      x: {(points[0].x * 100).toFixed(1)}%, y: {(points[0].y * 100).toFixed(1)}%
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">Non defini</div>
                  )}
                </div>

                <div className={`p-3 rounded-lg ${points.length >= 2 ? "bg-amber-100" : "bg-gray-100"}`}>
                  <div className="text-sm font-medium">Point B</div>
                  {points[1] ? (
                    <div className="text-xs text-gray-600">
                      x: {(points[1].x * 100).toFixed(1)}%, y: {(points[1].y * 100).toFixed(1)}%
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">Non defini</div>
                  )}
                </div>
              </div>

              {/* Pixel distance */}
              {pixelDistance !== null && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="text-sm text-blue-800">Distance pixels</div>
                  <div className="text-lg font-semibold text-blue-900">
                    {pixelDistance.toFixed(0)} px
                  </div>
                </div>
              )}

              {/* Real distance input */}
              {points.length === 2 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Distance reelle (metres)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                    placeholder="Ex: 10.5"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                </div>
              )}

              {/* Calculated scale preview */}
              {pixelDistance && distance && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm text-green-800">Nouvelle echelle</div>
                  <div className="text-lg font-semibold text-green-900">
                    1 px = {((parseFloat(distance) / pixelDistance) * 100).toFixed(4)} cm
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => setPoints([])}
                  disabled={points.length === 0}
                  className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={16} />
                  Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={points.length !== 2 || !distance || loading}
                  className="flex-1 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
