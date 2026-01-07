// src/components/AIAvatar/MiniEquipmentPreview.jsx
// Generic mini preview of equipment location on floor plan for AI chat responses
// Uses Leaflet for interactive map display - supports all equipment types
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, Zap, Building2, Layers, ExternalLink,
  Maximize2, ChevronRight, X, Calendar, AlertTriangle,
  CheckCircle, Crosshair, Cpu, Cog, Battery, Shield
} from 'lucide-react';
import { api, API_BASE } from '../../lib/api.js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// PDF.js config
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Equipment type configurations
const EQUIPMENT_CONFIGS = {
  switchboard: {
    name: 'Tableau électrique',
    icon: Zap,
    color: 'amber',
    gradient: 'from-amber-400 to-orange-500',
    bgLight: 'from-amber-50 to-orange-50',
    borderColor: 'border-amber-200',
    markerColor: { normal: '#f59e0b', gradient: ['#f59e0b', '#ea580c'] },
    mapUrl: '/app/switchboards/map',
    api: {
      placedIds: () => api.switchboardMaps.placedIds(),
      positions: (logical_name, page_index) => api.switchboardMaps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.switchboardMaps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.switchboard.getBoard(id),
    },
    idField: 'switchboard_id',
  },
  vsd: {
    name: 'Variateur',
    icon: Cpu,
    color: 'green',
    gradient: 'from-green-400 to-emerald-500',
    bgLight: 'from-green-50 to-emerald-50',
    borderColor: 'border-green-200',
    markerColor: { normal: '#10b981', gradient: ['#10b981', '#059669'] },
    mapUrl: '/app/vsd/map',
    api: {
      placedIds: () => api.vsdMaps.placedIds(),
      positions: (logical_name, page_index) => api.vsdMaps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.vsdMaps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.vsd.getEquipment(id),
    },
    idField: 'equipment_id',
  },
  meca: {
    name: 'Équipement mécanique',
    icon: Cog,
    color: 'orange',
    gradient: 'from-orange-400 to-red-500',
    bgLight: 'from-orange-50 to-red-50',
    borderColor: 'border-orange-200',
    markerColor: { normal: '#f97316', gradient: ['#f97316', '#ea580c'] },
    mapUrl: '/app/meca/map',
    api: {
      placedIds: () => api.mecaMaps.placedIds(),
      positions: (logical_name, page_index) => api.mecaMaps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.mecaMaps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.meca.getEquipment(id),
    },
    idField: 'equipment_id',
  },
  glo: {
    name: 'Équipement GLO',
    icon: Battery,
    color: 'emerald',
    gradient: 'from-emerald-400 to-teal-500',
    bgLight: 'from-emerald-50 to-teal-50',
    borderColor: 'border-emerald-200',
    markerColor: { normal: '#10b981', gradient: ['#10b981', '#14b8a6'] },
    mapUrl: '/app/glo/map',
    api: {
      placedIds: () => api.gloMaps.placedIds(),
      positions: (logical_name, page_index) => api.gloMaps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.gloMaps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.glo.getEquipment(id),
    },
    idField: 'equipment_id',
  },
  hv: {
    name: 'Haute Tension',
    icon: Zap,
    color: 'amber',
    gradient: 'from-amber-400 to-yellow-500',
    bgLight: 'from-amber-50 to-yellow-50',
    borderColor: 'border-amber-200',
    markerColor: { normal: '#eab308', gradient: ['#eab308', '#f59e0b'] },
    mapUrl: '/app/hv/map',
    api: {
      placedIds: () => api.hvMaps.placedIds(),
      positions: (logical_name, page_index) => api.hvMaps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.hvMaps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.hv.getEquipment(id),
    },
    idField: 'equipment_id',
  },
  mobile: {
    name: 'Équipement mobile',
    icon: Cpu,
    color: 'blue',
    gradient: 'from-blue-400 to-indigo-500',
    bgLight: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    markerColor: { normal: '#3b82f6', gradient: ['#3b82f6', '#6366f1'] },
    mapUrl: '/app/mobile-equipments/map',
    api: {
      placedIds: () => api.mobileEquipment.maps.placedIds(),
      positions: (logical_name, page_index) => api.mobileEquipment.maps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.mobileEquipment.maps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.mobileEquipment.get(id),
    },
    idField: 'equipment_id',
  },
  atex: {
    name: 'Équipement ATEX',
    icon: Shield,
    color: 'purple',
    gradient: 'from-purple-400 to-pink-500',
    bgLight: 'from-purple-50 to-pink-50',
    borderColor: 'border-purple-200',
    markerColor: { normal: '#a855f7', gradient: ['#a855f7', '#ec4899'] },
    mapUrl: '/app/atex',
    api: {
      placedIds: () => api.atexMaps.placedIds(),
      positions: (logical_name, page_index) => api.atexMaps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.atexMaps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.atex.getEquipment(id),
    },
    idField: 'equipment_id',
  },
  datahub: {
    name: 'DataHub',
    icon: Cpu,
    color: 'cyan',
    gradient: 'from-cyan-400 to-teal-500',
    bgLight: 'from-cyan-50 to-teal-50',
    borderColor: 'border-cyan-200',
    markerColor: { normal: '#06b6d4', gradient: ['#06b6d4', '#14b8a6'] },
    mapUrl: '/app/datahub/map',
    api: {
      placedIds: () => api.datahub.maps.placedIds(),
      positions: (logical_name, page_index) => api.datahub.maps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.datahub.maps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.datahub.get(id),
    },
    idField: 'item_id', // dh_positions uses item_id, not equipment_id
  },
  infrastructure: {
    name: 'Infrastructure',
    icon: Cpu,
    color: 'violet',
    gradient: 'from-violet-400 to-purple-500',
    bgLight: 'from-violet-50 to-purple-50',
    borderColor: 'border-violet-200',
    markerColor: { normal: '#8b5cf6', gradient: ['#8b5cf6', '#a855f7'] },
    mapUrl: '/app/infrastructure/map',
    api: {
      placedIds: () => api.infrastructure.maps.placedIds(),
      positions: (logical_name, page_index) => api.infrastructure.maps.positionsAuto(logical_name, page_index),
      planFileUrl: (logical_name) => api.infrastructure.maps.planFileUrlAuto(logical_name, { bust: false }),
      getEquipment: (id) => api.infrastructure.get(id),
    },
    idField: 'equipment_id',
  },
};

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

// Icon paths for different equipment types
const EQUIPMENT_ICON_PATHS = {
  switchboard: '<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>', // Zap
  vsd: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>', // Cpu
  meca: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', // Cog
  glo: '<rect x="6" y="7" width="12" height="10" rx="1"/><path d="M10 7V4M14 7V4"/>', // Battery
  hv: '<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>', // Zap
  mobile: '<path d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/>', // Smartphone
  atex: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', // Shield
  datahub: '<path d="M12 2v20M2 12h20M12 2a10 10 0 0110 10M12 2a10 10 0 00-10 10M12 22a10 10 0 01-10-10M12 22a10 10 0 0010-10"/>', // Globe-like
  infrastructure: '<path d="M3 21h18M3 10h18M5 6l7-4 7 4M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>', // Building
};

// Get equipment type key for icon selection
// Use the equipment type directly (it's already the correct key)
function getEquipmentIconKey(equipmentType) {
  // Valid equipment types
  const validTypes = ['switchboard', 'vsd', 'meca', 'glo', 'hv', 'mobile', 'atex', 'datahub', 'infrastructure'];
  if (validTypes.includes(equipmentType)) {
    return equipmentType;
  }
  // Fallback mapping for display names (legacy support)
  const mapping = {
    'Tableau électrique': 'switchboard',
    'Variateur': 'vsd',
    'Équipement mécanique': 'meca',
    'Équipement GLO': 'glo',
    'Haute Tension': 'hv',
    'Équipement mobile': 'mobile',
    'Équipement ATEX': 'atex',
    'DataHub': 'datahub',
    'Infrastructure': 'infrastructure',
  };
  return mapping[equipmentType] || 'switchboard';
}

/**
 * MiniLeafletMap - Internal component that renders the Leaflet map
 * Supports single or multiple equipment markers on the same plan
 */
function MiniLeafletMap({
  planData,
  position,        // Single position (for backward compatibility)
  positions = [],  // Multiple positions for multi-marker support
  equipmentConfig,
  equipmentType,   // The equipment type key (switchboard, vsd, meca, etc.)
  controlStatus,
  isExpanded,
  onExpand,
  equipmentDetails,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const MARKER_SIZE = isExpanded ? 32 : 22;

  // Get all positions (combine single + multiple)
  const allPositions = positions.length > 0 ? positions : (position ? [{ ...position, isPrimary: true }] : []);

  // Create equipment marker icon with enhanced visuals
  const createMarkerIcon = useCallback((markerData = {}) => {
    const { isOverdue = false, isPrimary = true, index = 0, name = '' } = markerData;
    const s = isPrimary ? MARKER_SIZE : MARKER_SIZE * 0.85;
    const colors = equipmentConfig.markerColor;

    // Determine background based on status
    let bg, borderColor, animClass = "";
    if (isOverdue) {
      bg = "background: linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%);";
      borderColor = "#fecaca";
      animClass = "mini-marker-pulse-urgent";
    } else if (isPrimary) {
      bg = `background: linear-gradient(135deg, ${colors.gradient[0]} 0%, ${colors.gradient[1]} 100%);`;
      borderColor = "white";
      animClass = "mini-marker-glow";
    } else {
      bg = `background: linear-gradient(135deg, ${colors.gradient[0]}dd 0%, ${colors.gradient[1]}dd 100%);`;
      borderColor = "rgba(255,255,255,0.8)";
    }

    // Use the equipmentType directly for correct icon selection
    const iconKey = getEquipmentIconKey(equipmentType);
    const iconPath = EQUIPMENT_ICON_PATHS[iconKey] || EQUIPMENT_ICON_PATHS.switchboard;

    // Add number badge for multiple markers
    const numberBadge = index > 0 && !isPrimary ? `
      <div style="position:absolute;top:-4px;right:-4px;width:14px;height:14px;background:#1e40af;border:1.5px solid white;border-radius:50%;font-size:9px;font-weight:bold;color:white;display:flex;align-items:center;justify-content:center;">${index + 1}</div>
    ` : '';

    const html = `
      <div class="${animClass}" style="position:relative;width:${s}px;height:${s}px;${bg}border:2.5px solid ${borderColor};border-radius:9999px;box-shadow:0 4px 15px rgba(0,0,0,.4), 0 2px 4px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s ease;transform-origin:center bottom;" title="${name}">
        <svg viewBox="0 0 24 24" width="${s * 0.5}" height="${s * 0.5}" fill="white" stroke="white" stroke-width="0.5" xmlns="http://www.w3.org/2000/svg">
          ${iconPath}
        </svg>
        ${numberBadge}
      </div>`;

    return L.divIcon({
      className: "mini-eq-marker",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), s], // Anchor at bottom center for better positioning
    });
  }, [MARKER_SIZE, equipmentConfig, equipmentType]);

  // Load and render the map with high quality
  useEffect(() => {
    if (!planData || allPositions.length === 0 || !containerRef.current) return;

    let cancelled = false;
    let pdfDoc = null;

    const initMap = async () => {
      setLoading(true);
      setError(null);

      try {
        // Clean up previous map and markers
        if (mapRef.current) {
          try {
            mapRef.current.remove();
          } catch {}
          mapRef.current = null;
        }
        markersRef.current = [];

        const pdfUrl = planData.planFileUrl;

        // Load PDF
        const loadingTask = pdfjsLib.getDocument(pdfDocOpts(pdfUrl));
        pdfDoc = await loadingTask.promise;

        if (cancelled) return;

        const page = await pdfDoc.getPage((planData.page_index || 0) + 1);
        const baseVp = page.getViewport({ scale: 1 });

        // HIGH QUALITY RENDERING: Use higher DPI for crisp visuals
        const containerWidth = containerRef.current.clientWidth || (isExpanded ? 600 : 280);
        const dpr = Math.min(window.devicePixelRatio || 1, 4); // Allow up to 4x DPI for high-res screens
        // Higher resolution for expanded mode, more reasonable for mini mode
        const targetWidth = isExpanded
          ? Math.min(4096, containerWidth * dpr * 3) // Very high quality for expanded view
          : Math.min(2048, containerWidth * dpr * 2.5); // Good quality for mini view
        const scale = clamp(targetWidth / baseVp.width, 1, 6); // Higher min/max scale
        const viewport = page.getViewport({ scale });

        // Render to canvas with high quality settings
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: false });

        // Disable image smoothing for sharper technical drawings
        ctx.imageSmoothingEnabled = false;

        // Use 'print' intent for highest quality PDF rendering
        await page.render({
          canvasContext: ctx,
          viewport,
          intent: 'print' // Higher quality rendering
        }).promise;

        if (cancelled) return;

        // Use PNG for better quality (especially for technical drawings)
        const dataUrl = canvas.toDataURL("image/png");
        const imgW = canvas.width;
        const imgH = canvas.height;

        // Create Leaflet map with smooth animations
        const map = L.map(containerRef.current, {
          crs: L.CRS.Simple,
          zoomControl: false,
          zoomAnimation: true,
          fadeAnimation: true,
          scrollWheelZoom: true,
          touchZoom: true,
          doubleClickZoom: true,
          dragging: true,
          attributionControl: false,
          preferCanvas: true,
          zoomSnap: 0.25, // Smoother zoom levels
          zoomDelta: 0.5,
        });

        mapRef.current = map;

        // Add custom zoom control in expanded mode
        if (isExpanded) {
          L.control.zoom({ position: "topright" }).addTo(map);
        }

        // Set bounds
        const bounds = L.latLngBounds([
          [0, 0],
          [imgH, imgW],
        ]);

        // Add image layer with better quality
        L.imageOverlay(dataUrl, bounds, {
          interactive: true,
          opacity: 1,
          className: 'leaflet-image-layer-crisp',
        }).addTo(map);

        // Configure zoom levels
        const fitZoom = map.getBoundsZoom(bounds, true);
        map.setMinZoom(fitZoom - 0.5);
        map.setMaxZoom(fitZoom + 6);
        map.setMaxBounds(bounds.pad(0.4));

        // Calculate view based on all markers
        const markerLatLngs = allPositions.map(pos => {
          const x = (pos.x_frac || 0) * imgW;
          const y = (pos.y_frac || 0) * imgH;
          return L.latLng(y, x);
        });

        // Smart zoom: if multiple markers, fit them all; if single, zoom closer
        let initialView;
        if (markerLatLngs.length > 1) {
          const markerBounds = L.latLngBounds(markerLatLngs);
          map.fitBounds(markerBounds.pad(0.3), { animate: false });
        } else if (markerLatLngs.length === 1) {
          const initialZoom = isExpanded ? fitZoom + 2 : fitZoom + 1;
          map.setView(markerLatLngs[0], initialZoom, { animate: false });
        }

        // Add markers for all positions
        const isOverdue = controlStatus?.hasOverdue;
        const markers = [];

        allPositions.forEach((pos, index) => {
          const x = (pos.x_frac || 0) * imgW;
          const y = (pos.y_frac || 0) * imgH;
          const latLng = L.latLng(y, x);

          const markerIcon = createMarkerIcon({
            isOverdue: pos.isOverdue ?? isOverdue,
            isPrimary: index === 0 || pos.isPrimary,
            index,
            name: pos.name || equipmentDetails?.name || '',
          });

          const marker = L.marker(latLng, {
            icon: markerIcon,
            interactive: true,
            zIndexOffset: index === 0 ? 1000 : 0, // Primary marker on top
          });

          // Add tooltip for equipment name
          if (pos.name || equipmentDetails?.name) {
            marker.bindTooltip(pos.name || equipmentDetails?.name, {
              permanent: false,
              direction: 'top',
              className: 'mini-eq-tooltip',
              offset: [0, -10],
            });
          }

          marker.addTo(map);
          markers.push(marker);

          // Click handler
          marker.on('click', () => {
            if (!isExpanded && onExpand) {
              onExpand();
            }
          });
        });

        markersRef.current = markers;

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
      markersRef.current = [];
    };
  }, [planData, allPositions.length, isExpanded, controlStatus, createMarkerIcon, onExpand, equipmentDetails]);

  // Update marker icons when controlStatus changes
  useEffect(() => {
    if (markersRef.current.length > 0) {
      const isOverdue = controlStatus?.hasOverdue;
      markersRef.current.forEach((marker, index) => {
        marker.setIcon(createMarkerIcon({
          isOverdue,
          isPrimary: index === 0,
          index,
          name: equipmentDetails?.name || '',
        }));
      });
    }
  }, [controlStatus, createMarkerIcon, equipmentDetails]);

  // Center on markers handler - fits all markers or centers on primary
  const handleCenterOnMarker = useCallback(() => {
    if (mapRef.current && markersRef.current.length > 0) {
      if (markersRef.current.length === 1) {
        const ll = markersRef.current[0].getLatLng();
        mapRef.current.setView(ll, mapRef.current.getZoom() + 0.5, { animate: true });
      } else {
        const bounds = L.latLngBounds(markersRef.current.map(m => m.getLatLng()));
        mapRef.current.fitBounds(bounds.pad(0.2), { animate: true });
      }
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
            <div className={`w-8 h-8 border-3 border-${equipmentConfig.color}-500 border-t-transparent rounded-full animate-spin`} />
            <span className="text-xs text-slate-500">Chargement du plan...</span>
          </div>
        </div>
      )}

      {/* Center button (expanded mode) */}
      {isExpanded && !loading && (
        <button
          onClick={handleCenterOnMarker}
          className="absolute bottom-3 right-3 p-2 bg-white rounded-lg shadow-lg hover:bg-slate-50 transition-colors z-[1000]"
          title="Centrer sur l'équipement"
        >
          <Crosshair className="w-4 h-4 text-slate-600" />
        </button>
      )}

      {/* Expand button (mini mode) - positioned in corner to not block map interactions */}
      {!isExpanded && !loading && (
        <button
          onClick={onExpand}
          className="absolute top-2 right-2 p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-md hover:bg-white hover:shadow-lg transition-all z-[1000] group"
          title="Agrandir le plan"
        >
          <Maximize2 className="w-4 h-4 text-slate-500 group-hover:text-slate-700" />
        </button>
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
 * MiniEquipmentPreview - Shows a mini floor plan preview with equipment location
 * Supports all equipment types: switchboard, vsd, meca, glo, hv, mobile, atex
 *
 * @param {object} equipment - Equipment data
 * @param {string} equipmentType - Type of equipment (switchboard, vsd, meca, glo, hv, mobile, atex)
 * @param {object} controlStatus - Control status info (optional)
 * @param {function} onNavigate - Callback when user wants to view full map
 * @param {function} onClose - Callback to close the chat (for navigation)
 */
export default function MiniEquipmentPreview({
  equipment,
  equipmentType = 'switchboard',
  controlStatus,
  onNavigate,
  onClose,
  className = ''
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [planData, setPlanData] = useState(null);
  const [position, setPosition] = useState(null);
  const [equipmentDetails, setEquipmentDetails] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Get equipment config
  const config = EQUIPMENT_CONFIGS[equipmentType] || EQUIPMENT_CONFIGS.switchboard;
  const EquipmentIcon = config.icon;

  // Get equipment ID
  const equipmentId = equipment?.id || equipment?.[config.idField];

  // Fetch equipment position and plan data
  useEffect(() => {
    console.log('[MiniEquipmentPreview] Props received:', { equipmentId, equipmentType, equipment, config: config?.name });

    if (!equipmentId) {
      console.log('[MiniEquipmentPreview] No equipmentId, stopping');
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1. Get placed IDs to find placement info
        console.log('[MiniEquipmentPreview] Fetching placed-ids for type:', equipmentType);
        const placedResponse = await config.api.placedIds();
        console.log('[MiniEquipmentPreview] Placed response:', placedResponse);
        const placedDetails = placedResponse?.data?.placed_details || placedResponse?.placed_details || {};

        // Try to find placement - handle type mismatches (string vs number IDs)
        let placement = placedDetails[equipmentId];
        if (!placement && equipmentId != null) {
          // Try with string key if numeric lookup failed
          placement = placedDetails[String(equipmentId)];
          // Try with numeric key if string lookup failed
          if (!placement && !isNaN(equipmentId)) {
            placement = placedDetails[Number(equipmentId)];
          }
        }
        console.log('[MiniEquipmentPreview] Looking for ID:', equipmentId, '(type:', typeof equipmentId, ') Found placement:', placement);

        if (!placement) {
          console.log('[MiniEquipmentPreview] Equipment not placed on map. Available keys:', Object.keys(placedDetails).slice(0, 10), 'Key types:', Object.keys(placedDetails).slice(0, 3).map(k => typeof k));
          setError('not_placed');
          setLoading(false);
          return;
        }

        // Extract logical_name - handle both formats:
        // - New format: { logical_name, page_index, display_name }
        // - Legacy format: { plans: [logical_name1, logical_name2, ...] }
        const logicalName = placement.logical_name || placement.plans?.[0];
        const pageIndex = placement.page_index ?? 0;

        if (!logicalName) {
          console.log('[MiniEquipmentPreview] No logical_name found in placement:', placement);
          setError('not_placed');
          setLoading(false);
          return;
        }

        console.log('[MiniEquipmentPreview] Using logicalName:', logicalName, 'pageIndex:', pageIndex);

        // 2. Get position data
        const positionsData = await config.api.positions(logicalName, pageIndex);
        const positions = positionsData?.data || positionsData?.positions || positionsData || [];
        console.log('[MiniEquipmentPreview] Positions loaded:', positions?.length || 0);

        // Helper to compare IDs with type coercion
        const idsMatch = (a, b) => {
          if (a == null || b == null) return false;
          return String(a) === String(b);
        };

        const myPosition = positions.find(p =>
          idsMatch(p[config.idField], equipmentId) ||
          idsMatch(p.equipment_id, equipmentId) ||
          idsMatch(p.item_id, equipmentId) ||  // datahub uses item_id
          idsMatch(p.id, equipmentId)
        );

        if (!myPosition && positions.length > 0) {
          console.log('[MiniEquipmentPreview] Position not found. Looking for:', equipmentId, 'Available IDs:', positions.slice(0, 5).map(p => p.item_id || p.equipment_id || p[config.idField] || p.id));
        }

        if (myPosition) {
          setPosition(myPosition);

          // Get plan file URL using resolved logicalName
          const planFileUrl = config.api.planFileUrl(logicalName);

          setPlanData({
            logical_name: logicalName,
            display_name: placement.display_name || logicalName,
            page_index: pageIndex,
            planFileUrl: typeof planFileUrl === 'string' ? planFileUrl : planFileUrl
          });

          // Set equipment details from position data or original equipment
          setEquipmentDetails({
            name: myPosition.name || equipment?.name || equipment?.tag,
            code: myPosition.code || equipment?.code,
            building: myPosition.building || myPosition.building_code || equipment?.building || equipment?.building_code,
            floor: myPosition.floor || equipment?.floor,
            room: myPosition.room || equipment?.room,
          });
        } else {
          setError('position_not_found');
        }
      } catch (err) {
        console.error('[MiniEquipmentPreview] Error:', err);
        setError('fetch_error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [equipmentId, equipmentType]);

  // Handle navigation to full map
  const handleViewFullMap = () => {
    console.log('[MiniEquipmentPreview] handleViewFullMap called:', {
      equipmentType,
      equipmentId,
      configMapUrl: config.mapUrl,
      planData,
      hasOnNavigate: !!onNavigate,
    });

    if (onNavigate) {
      onNavigate(equipmentId, planData);
    } else {
      // Close chat if handler provided
      onClose?.();
      // Navigate to equipment map with this equipment selected
      const mapUrl = `${config.mapUrl}?equipment=${equipmentId}&plan=${encodeURIComponent(planData?.logical_name || '')}`;
      console.log('[MiniEquipmentPreview] Navigating to:', mapUrl);
      navigate(mapUrl);
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

  // Not placed or position error state
  if (error === 'not_placed' || error === 'position_not_found' || !equipmentId) {
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

  // Render fetch error
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

  // Success - render mini map preview with Leaflet
  return (
    <>
      <div className={`bg-gradient-to-br ${config.bgLight} rounded-xl border ${config.borderColor} overflow-hidden shadow-sm hover:shadow-md transition-shadow ${className}`}>
        {/* Header with location info */}
        <div className="p-3 border-b border-opacity-50 bg-white/50" style={{ borderColor: 'inherit' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 bg-gradient-to-br ${config.gradient} rounded-lg shadow-sm`}>
                <EquipmentIcon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {equipmentDetails?.name || `${config.name} #${equipmentId}`}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {equipmentDetails?.building && (
                    <span className="flex items-center gap-0.5">
                      <Building2 className="w-3 h-3" />
                      {equipmentDetails.building}
                    </span>
                  )}
                  {equipmentDetails?.floor && (
                    <span className="flex items-center gap-0.5">
                      <Layers className="w-3 h-3" />
                      {equipmentDetails.floor}
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
        <div className="relative bg-white" style={{ height: 180 }}>
          <MiniLeafletMap
            planData={planData}
            position={position}
            equipmentConfig={config}
            equipmentType={equipmentType}
            controlStatus={controlStatus}
            equipmentDetails={equipmentDetails}
            isExpanded={false}
            onExpand={() => setIsExpanded(true)}
          />
        </div>

        {/* Action footer */}
        <div className="p-2 border-t border-opacity-50 bg-white/50" style={{ borderColor: 'inherit' }}>
          <button
            onClick={handleViewFullMap}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r ${config.gradient} hover:opacity-90 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow`}
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
            <div className={`flex items-center justify-between p-4 border-b bg-gradient-to-r ${config.bgLight}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 bg-gradient-to-br ${config.gradient} rounded-xl shadow-sm`}>
                  <EquipmentIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">
                    {equipmentDetails?.name || `${config.name} #${equipmentId}`}
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
                  equipmentConfig={config}
                  equipmentType={equipmentType}
                  controlStatus={controlStatus}
                  equipmentDetails={equipmentDetails}
                  isExpanded={true}
                  onExpand={() => {}}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-4 border-t bg-white">
              <div className="flex items-center gap-4 text-sm text-slate-500">
                {equipmentDetails?.building && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    {equipmentDetails.building}
                  </span>
                )}
                {equipmentDetails?.floor && (
                  <span className="flex items-center gap-1">
                    <Layers className="w-4 h-4" />
                    Étage {equipmentDetails.floor}
                  </span>
                )}
                {equipmentDetails?.room && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {equipmentDetails.room}
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

      {/* Enhanced CSS for marker animations and map quality */}
      <style>{`
        /* Base marker styles */
        .mini-eq-marker {
          background: transparent !important;
          border: none !important;
        }

        /* Crisp image rendering for plans */
        .leaflet-image-layer-crisp {
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }

        /* Subtle glow effect for primary markers */
        .mini-marker-glow {
          animation: mini-glow 2s ease-in-out infinite;
        }
        @keyframes mini-glow {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 3px rgba(59, 130, 246, 0.5));
          }
          50% {
            transform: scale(1.05);
            filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.7));
          }
        }

        /* Urgent pulse for overdue equipment */
        .mini-marker-pulse-urgent {
          animation: mini-pulse-urgent 1s ease-in-out infinite;
        }
        @keyframes mini-pulse-urgent {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.6));
          }
          50% {
            transform: scale(1.15);
            filter: drop-shadow(0 0 12px rgba(239, 68, 68, 0.9));
          }
        }

        /* Legacy pulse animation */
        .mini-marker-pulse {
          animation: mini-pulse 1.5s ease-in-out infinite;
        }
        @keyframes mini-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.9; }
        }

        /* Tooltip styling */
        .mini-eq-tooltip {
          background: rgba(15, 23, 42, 0.95) !important;
          border: none !important;
          border-radius: 6px !important;
          padding: 4px 10px !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          color: white !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25) !important;
        }
        .mini-eq-tooltip::before {
          border-top-color: rgba(15, 23, 42, 0.95) !important;
        }

        /* Hover effects for markers */
        .mini-eq-marker > div:hover {
          transform: scale(1.1) !important;
          z-index: 10000 !important;
        }

        /* Leaflet container improvements */
        .leaflet-container {
          background: #f1f5f9 !important;
          font-family: inherit !important;
        }

        /* Smooth tile transitions */
        .leaflet-tile {
          transition: opacity 0.2s ease-in-out;
        }
      `}</style>
    </>
  );
}
