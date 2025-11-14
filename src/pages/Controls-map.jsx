// ============================================================================
// Controls-map.jsx - Carte interactive avec positionnement (CORRIGÉ v2)
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Configuration PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

// ============================================================================
// CONFIGURATION & HELPERS
// ============================================================================

const API_BASE = import.meta.env.VITE_API_BASE || "";

function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
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
      const u = JSON.parse(localStorage.getItem("user"));
      if (!email && u?.email) email = String(u.email);
      if (!name && (u?.name || u?.displayName))
        name = String(u.name || u.displayName);
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
  return { email: email || null, name: name || null };
}

function userHeaders() {
  const { email, name } = getIdentity();
  const h = {};
  if (email) h["X-User-Email"] = email;
  if (name) h["X-User-Name"] = name;
  return h;
}

function currentSite() {
  try {
    const u = JSON.parse(localStorage.getItem("eh_user") || "{}");
    return u?.site || "Default";
  } catch {
    return "Default";
  }
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

function isNumericId(s) {
  return (
    (typeof s === "string" && /^\d+$/.test(s)) ||
    (typeof s === "number" && Number.isInteger(s))
  );
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    ghost: "bg-white text-black border hover:bg-gray-50",
    subtle:
      "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
    danger:
      "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
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

function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black placeholder-gray-400 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}

// ============================================================================
// STATUTS & COULEURS
// ============================================================================

const STATUS_COLOR = {
  Planned: { fill: "#059669", border: "#34d399" },
  Pending: { fill: "#f59e0b", border: "#fbbf24" },
  Overdue: { fill: "#e11d48", border: "#fb7185" },
  Done: { fill: "#2563eb", border: "#60a5fa" },
};

const ICON_PX = 24;

function makeTaskIcon(status) {
  const s = ICON_PX;
  const map = STATUS_COLOR[status] || STATUS_COLOR.Planned;
  const blink =
    status === "Overdue"
      ? "blink-red"
      : status === "Pending"
      ? "blink-orange"
      : "";

  const html = `<div class="${blink}" style="
    width:${s}px;height:${s}px;border-radius:9999px;
    background:${map.fill};border:2px solid ${map.border};
    box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
  "></div>`;

  return L.divIcon({
    className: "task-marker-inline",
    html,
    iconSize: [s, s],
    iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
    popupAnchor: [0, -Math.round(s / 2)],
  });
}

// ============================================================================
// HELPERS GÉOMÉTRIQUES
// ============================================================================

function getPlanDims(baseLayer) {
  if (!baseLayer?.getBounds) return null;
  const b = baseLayer.getBounds();
  const W = Math.max(1, b.getEast() - b.getWest());
  const H = Math.max(1, b.getNorth() - b.getSouth());
  return { W, H, bounds: b };
}

function toLatLngFrac(xf, yf, baseLayer) {
  const dims = getPlanDims(baseLayer);
  if (!dims) return L.latLng(0, 0);
  const { W, H, bounds: b } = dims;
  const lat = b.getSouth() + yf * H;
  const lng = b.getWest() + xf * W;
  return L.latLng(lat, lng);
}

function fromLatLngToFrac(latlng, baseLayer) {
  const dims = getPlanDims(baseLayer);
  if (!dims) return { xf: 0, yf: 0 };
  const { W, H, bounds: b } = dims;
  const xf = (latlng.lng - b.getWest()) / W;
  const yf = (latlng.lat - b.getSouth()) / H;
  return { xf: Math.min(1, Math.max(0, xf)), yf: Math.min(1, Math.max(0, yf)) };
}

// ============================================================================
// STYLES CSS POUR ANIMATIONS
// ============================================================================

const styles = `
@keyframes blink-red {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes blink-orange {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.blink-red {
  animation: blink-red 1.5s ease-in-out infinite;
}

.blink-orange {
  animation: blink-orange 2s ease-in-out infinite;
}

.task-marker-inline {
  background: transparent !important;
  border: none !important;
}

.leaflet-wrapper {
  position: relative;
}

.placement-mode-active {
  cursor: crosshair !important;
}

.placement-mode-active * {
  cursor: crosshair !important;
}
`;

// Injecter les styles
if (typeof document !== "undefined") {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

// ============================================================================
// COMPOSANT PRINCIPAL : CONTROLS MAP
// ============================================================================

export default function ControlsMap({
  plan,
  building,
  pageIndex = 0,
  onSelectTask,
  inModal = false,
  pendingPlacement = null, // { entity_id, entity_type, label }
  onPlacementComplete,
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const roRef = useRef(null);

  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastJob = useRef({ key: null });

  const baseReadyRef = useRef(false);
  const draggingRef = useRef(false);
  const placementModeRef = useRef(false);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [positions, setPositions] = useState([]);
  const [error, setError] = useState(null);

  const planKey = useMemo(
    () => plan?.id || plan?.logical_name || "",
    [plan]
  );
  const planDisplayName = useMemo(
    () =>
      (
        plan?.display_name ||
        plan?.logical_name ||
        plan?.id ||
        building ||
        ""
      ).toString(),
    [plan, building]
  );

  const fileUrl = useMemo(() => {
    if (!plan && !planKey && !building) return null;
    if (plan?.url_pdf) return plan.url_pdf;
    if (planKey) {
      const key = planKey;
      const url =
        isUuid(key) || isNumericId(key)
          ? `${API_BASE}/api/controls/maps/planFile?id=${encodeURIComponent(
              key
            )}`
          : `${API_BASE}/api/controls/maps/planFile?logical_name=${encodeURIComponent(
              key
            )}`;
      return url;
    }
    if (building) {
      // Fallback : on suppose un logical_name = code bâtiment
      return `${API_BASE}/api/controls/maps/planFile?logical_name=${encodeURIComponent(
        building
      )}`;
    }
    return null;
  }, [plan, planKey, building]);

  // Mode placement activé
  useEffect(() => {
    if (pendingPlacement) {
      placementModeRef.current = true;
      if (wrapRef.current) {
        wrapRef.current.classList.add("placement-mode-active");
      }
    } else {
      placementModeRef.current = false;
      if (wrapRef.current) {
        wrapRef.current.classList.remove("placement-mode-active");
      }
    }
  }, [pendingPlacement]);

  // ========================================================================
  // CHARGEMENT DES POSITIONS
  // ========================================================================
  async function loadPositions() {
    if (!planKey && !building) {
      setPositions([]);
      drawMarkers([]);
      return;
    }

    try {
      const site = currentSite();
      const headers = new Headers(userHeaders());
      headers.set("X-Site", site);

      let url = `${API_BASE}/api/controls/maps/positions?page_index=${pageIndex}`;

      if (planKey) {
        if (isUuid(planKey) || isNumericId(planKey)) {
          url += `&id=${encodeURIComponent(planKey)}`;
        } else {
          url += `&logical_name=${encodeURIComponent(planKey)}`;
        }
      } else if (building) {
        url += `&building=${encodeURIComponent(building)}`;
      }

      const res = await fetch(url, {
        credentials: "include",
        headers,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];

      const mapped = items.map((it) => ({
        id: it.task_id || it.id,
        entity_id: it.entity_id,
        entity_type: it.entity_type,
        name: it.task_name || it.name,
        x: Number(it.x_frac ?? it.x ?? 0),
        y: Number(it.y_frac ?? it.y ?? 0),
        status: it.status || "Planned",
      }));

      setPositions(mapped);
      drawMarkers(mapped);
    } catch (e) {
      console.error("[ControlsMap] loadPositions error:", e);
      setPositions([]);
      drawMarkers([]);
    }
  }

  // ========================================================================
  // DESSIN DES MARQUEURS
  // ========================================================================
  function drawMarkers(list) {
    const m = mapRef.current;
    const layer = markersLayerRef.current;
    const base = baseLayerRef.current;
    if (!m || !layer || !base) return;

    layer.clearLayers();

    (list || []).forEach((p) => {
      const latlng = toLatLngFrac(p.x, p.y, base);
      const icon = makeTaskIcon(p.status);

      const mk = L.marker(latlng, {
        icon,
        draggable: !placementModeRef.current,
        autoPan: true,
        bubblingMouseEvents: false,
        keyboard: false,
        riseOnHover: true,
        pane: "markersPane",
      });

      mk.__meta = p;

      mk.on("dragstart", () => {
        draggingRef.current = true;
      });

      mk.on("dragend", async () => {
        const ll = mk.getLatLng();
        const { xf, yf } = fromLatLngToFrac(ll, base);

        try {
          const site = currentSite();
          const headers = new Headers(userHeaders());
          headers.set("X-Site", site);
          headers.set("Content-Type", "application/json");

          const body = {
            entity_id: p.entity_id,
            entity_type: p.entity_type,
            task_id: p.id,
            page_index: pageIndex,
            x_frac: Math.round(xf * 1e6) / 1e6,
            y_frac: Math.round(yf * 1e6) / 1e6,
          };

          if (planKey) {
            body.logical_name = planKey;
          } else if (building) {
            body.building = building;
          }

          await fetch(`${API_BASE}/api/controls/maps/setPosition`, {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify(body),
          });

          await loadPositions();
        } catch (e) {
          console.error("[ControlsMap] setPosition error", e);
        } finally {
          draggingRef.current = false;
        }
      });

      mk.on("click", () => {
        if (placementModeRef.current) return;

        onSelectTask?.({
          id: p.id,
          entity_id: p.entity_id,
          entity_type: p.entity_type,
          task_name: p.name,
          status: p.status,
        });
      });

      mk.addTo(layer);
    });

    layer.bringToFront?.();
  }

  // ========================================================================
  // INIT CARTE + RENDU PDF
  // ========================================================================
  useEffect(() => {
    if (!wrapRef.current) return;

    const jobKey = `${fileUrl || "no-pdf"}::${pageIndex}`;
    const mustForceReload =
      !baseReadyRef.current || !mapRef.current || !markersLayerRef.current;

    if (lastJob.current.key === jobKey && !mustForceReload) return;
    lastJob.current.key = jobKey;

    const cleanupPdf = async () => {
      try {
        renderTaskRef.current?.cancel();
      } catch {}
      try {
        await loadingTaskRef.current?.destroy?.();
      } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
    };

    const cleanupMap = () => {
      const m = mapRef.current;
      try {
        roRef.current?.disconnect?.();
      } catch {}
      try {
        window.removeEventListener("resize", onResize);
      } catch {}
      if (!m) return;
      try {
        m.off();
      } catch {}
      try {
        m.eachLayer((l) => {
          try {
            m.removeLayer(l);
          } catch {}
        });
      } catch {}
      try {
        mapRef.current && m.remove();
      } catch {}
      mapRef.current = null;
      baseLayerRef.current = null;
      markersLayerRef.current = null;
      baseReadyRef.current = false;
    };

    let onResize = null;

    (async () => {
      setError(null);
      try {
        await cleanupPdf();

        // 1️⃣ Création carte Leaflet
        const m = L.map(wrapRef.current, {
          crs: L.CRS.Simple,
          zoomControl: false,
          preferCanvas: true,
          zoomAnimation: true,
          markerZoomAnimation: false,
          scrollWheelZoom: true,
          touchZoom: true,
          tap: true,
        });
        L.control.zoom({ position: "topright" }).addTo(m);
        mapRef.current = m;

        m.createPane("basePane");
        m.getPane("basePane").style.zIndex = 200;
        m.createPane("markersPane");
        m.getPane("markersPane").style.zIndex = 400;

        markersLayerRef.current = L.layerGroup({ pane: "markersPane" }).addTo(
          m
        );

        // Bounds provisoires
        const PROV_W = 2000,
          PROV_H = 1400;
        const provBounds = L.latLngBounds([
          [0, 0],
          [PROV_H, PROV_W],
        ]);
        await new Promise(requestAnimationFrame);
        m.invalidateSize(false);
        m.options.zoomSnap = 0.1;
        m.options.zoomDelta = 0.5;
        const fitZoom = m.getBoundsZoom(provBounds, true);
        m.setMinZoom(fitZoom - 2);
        m.setMaxZoom(fitZoom + 8);
        m.setMaxBounds(provBounds.pad(0.5));
        m.fitBounds(provBounds, { padding: [10, 10] });

        // Resize listeners
        onResize = () => {
          try {
            const keepCenter = m.getCenter();
            const keepZoom = m.getZoom();
            m.invalidateSize(false);
            m.setView(keepCenter, keepZoom, { animate: false });
          } catch {}
        };
        window.addEventListener("resize", onResize);
        try {
          roRef.current = new ResizeObserver(() => {
            onResize();
          });
          roRef.current.observe(wrapRef.current);
        } catch {}

        // Click handler pour placement
        m.on("click", async (e) => {
          if (!placementModeRef.current || !pendingPlacement) return;

          const latlng = e.latlng;
          const { xf, yf } = fromLatLngToFrac(latlng, baseLayerRef.current);

          try {
            const site = currentSite();
            const headers = new Headers(userHeaders());
            headers.set("X-Site", site);
            headers.set("Content-Type", "application/json");

            const body = {
              entity_id: pendingPlacement.entity_id,
              entity_type: pendingPlacement.entity_type,
              page_index: pageIndex,
              x_frac: Math.round(xf * 1e6) / 1e6,
              y_frac: Math.round(yf * 1e6) / 1e6,
            };

            if (planKey) {
              body.logical_name = planKey;
            } else if (building) {
              body.building = building;
            }

            await fetch(`${API_BASE}/api/controls/maps/setPosition`, {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify(body),
            });

            // On recharge immédiatement les positions
            await loadPositions();
            onPlacementComplete?.();
          } catch (e) {
            console.error("[ControlsMap] setPosition error", e);
            alert("Erreur lors du placement");
          }
        });

        // 2️⃣ Rendu PDF
        if (fileUrl) {
          const containerW = Math.max(
            320,
            wrapRef.current.clientWidth || 1024
          );
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          const qualityBoost = 3.5;
          const targetBitmapW = Math.min(
            12288,
            Math.max(1800, Math.floor(containerW * dpr * qualityBoost))
          );

          loadingTaskRef.current = pdfjsLib.getDocument({
            url: fileUrl,
            withCredentials: true,
            httpHeaders: userHeaders(),
          });

          const pdf = await loadingTaskRef.current.promise;
          const page = await pdf.getPage(Number(pageIndex) + 1);
          const baseVp = page.getViewport({ scale: 1 });
          const safeScale = Math.min(
            6.0,
            Math.max(0.75, targetBitmapW / baseVp.width)
          );
          const viewport = page.getViewport({ scale: safeScale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d", { alpha: true });
          ctx.imageSmoothingEnabled = true;

          renderTaskRef.current = page.render({
            canvasContext: ctx,
            viewport,
            intent: "display",
          });
          await renderTaskRef.current.promise;

          const dataUrl = canvas.toDataURL("image/png");
          setImgSize({ w: canvas.width, h: canvas.height });

          const bounds = L.latLngBounds([
            [0, 0],
            [viewport.height, viewport.width],
          ]);
          const base = L.imageOverlay(dataUrl, bounds, {
            interactive: false,
            opacity: 1,
            pane: "basePane",
          }).addTo(m);
          baseLayerRef.current = base;

          await new Promise(requestAnimationFrame);
          m.invalidateSize(false);
          const fitZoom2 = m.getBoundsZoom(bounds, true);
          m.setMinZoom(fitZoom2 - 2);
          m.setMaxZoom(fitZoom2 + 8);
          m.setMaxBounds(bounds.pad(0.5));
          m.fitBounds(bounds, { padding: [10, 10] });

          baseReadyRef.current = true;
          await loadPositions();

          try {
            await pdf.cleanup?.();
          } catch {}
        } else {
          // Pas de PDF associé
          setError("Aucun plan PDF disponible pour cet élément.");
        }
      } catch (e) {
        console.error("[ControlsMap] init error", e);
        setError(
          "Impossible de charger le plan (erreur PDF ou plan introuvable)."
        );
      }
    })();

    return () => {
      try {
        renderTaskRef.current?.cancel();
      } catch {}
      try {
        loadingTaskRef.current?.destroy?.();
      } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
      cleanupMap();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, pageIndex]);

  // ========================================================================
  // RENDER UI
  // ========================================================================
  const viewerHeight = Math.min(
    (typeof window !== "undefined" ? window.innerHeight : 900) - 140,
    imgSize.h || 900
  );

  return (
    <div
      ref={wrapRef}
      className="leaflet-wrapper relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
      style={{ height: inModal ? "100%" : Math.max(520, viewerHeight) }}
    >
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-2">
        <div className="bg-white/90 px-3 py-1 rounded-lg shadow-sm text-xs font-medium max-w-xs truncate">
          {planDisplayName || "Plan"}
        </div>
        {pendingPlacement ? (
          <div className="bg-amber-500 text-white px-4 py-2 rounded-lg shadow-lg font-semibold animate-pulse">
            🎯 Cliquez sur le plan pour placer : {pendingPlacement.label}
          </div>
        ) : (
          <button
            className="bg-white px-3 py-2 rounded-lg shadow-sm text-sm font-semibold hover:bg-gray-50 border w-max"
            onClick={() => {
              const m = mapRef.current;
              const base = baseLayerRef.current;
              if (!m || !base) return;
              const b = base.getBounds();
              m.scrollWheelZoom?.disable();
              m.invalidateSize(false);
              const fitZoom = m.getBoundsZoom(b, true);
              m.setMinZoom(fitZoom - 2);
              m.setMaxZoom(fitZoom + 8);
              m.fitBounds(b, { padding: [12, 12] });
              m.setZoom(m.getZoom() - 1);
              setTimeout(() => m.scrollWheelZoom?.enable(), 60);
            }}
          >
            🗺️ Ajuster la vue
          </button>
        )}
      </div>

      {/* Erreur plan */}
      {error && (
        <div className="absolute inset-0 z-[900] flex items-center justify-center bg-white/80 pointer-events-none">
          <div className="bg-white border border-amber-300 text-amber-800 px-4 py-3 rounded-xl shadow-md text-sm max-w-md text-center">
            {error}
          </div>
        </div>
      )}

      {/* Légende statuts */}
      <div className="absolute bottom-3 right-3 z-[1000] bg-white p-3 rounded-xl shadow-lg border text-xs max-w-[220px]">
        <div className="font-semibold mb-2">Statuts contrôles</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: STATUS_COLOR.Planned.fill }}
            />
            <span className="text-xs">Planifié</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full blink-orange"
              style={{ background: STATUS_COLOR.Pending.fill }}
            />
            <span className="text-xs">≤ 30 jours</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full blink-red"
              style={{ background: STATUS_COLOR.Overdue.fill }}
            />
            <span className="text-xs">En retard</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: STATUS_COLOR.Done.fill }}
            />
            <span className="text-xs">Terminé</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT GESTION DES PLANS (Import ZIP)
// ============================================================================

export function ControlsMapManager({ onPlanSelect }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPlans() {
    setLoading(true);
    setErr(null);
    try {
      const site = currentSite();
      const headers = new Headers(userHeaders());
      headers.set("X-Site", site);

      const res = await fetch(`${API_BASE}/api/controls/maps/listPlans`, {
        credentials: "include",
        headers,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setPlans(
        Array.isArray(data?.plans)
          ? data.plans
          : Array.isArray(data?.items)
          ? data.items
          : []
      );
    } catch (e) {
      console.error("[ControlsMapManager] loadPlans error:", e);
      setPlans([]);
      setErr("Impossible de charger la liste des plans.");
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadZip(file) {
    if (!file) return;

    setLoading(true);
    setErr(null);
    try {
      const site = currentSite();
      const headers = new Headers(userHeaders());
      headers.set("X-Site", site);

      const formData = new FormData();
      formData.append("zip", file);

      const res = await fetch(`${API_BASE}/api/controls/maps/uploadZip`, {
        method: "POST",
        credentials: "include",
        headers,
        body: formData,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await loadPlans();
    } catch (e) {
      console.error("[ControlsMapManager] uploadZip error:", e);
      setErr("Erreur lors de l'import du ZIP.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between">
        <div className="font-semibold">Plans PDF (Contrôles)</div>
        <div className="flex items-center gap-2">
          <Btn
            variant="ghost"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
          >
            📁 Importer ZIP
          </Btn>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadZip(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {err && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {loading && (
          <div className="col-span-full text-gray-500 text-sm">
            Chargement des plans...
          </div>
        )}
        {!loading && plans.length === 0 && (
          <div className="col-span-full text-gray-500 text-sm">
            Aucun plan importé pour le moment.
          </div>
        )}
        {!loading &&
          plans.map((p) => (
            <PlanCard
              key={p.id || p.logical_name}
              plan={p}
              onSelect={onPlanSelect}
              onReload={loadPlans}
            />
          ))}
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT VIGNETTE PLAN
// ============================================================================

function PlanCard({ plan, onSelect, onReload }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(
    plan.display_name || plan.logical_name || ""
  );
  const [thumbnail, setThumbnail] = useState(null);
  const [thumbError, setThumbError] = useState(false);

  useEffect(() => {
    generateThumbnail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, plan.logical_name]);

  async function generateThumbnail() {
    setThumbError(false);
    setThumbnail(null);
    try {
      const key = plan.id || plan.logical_name;
      const url =
        isUuid(key) || isNumericId(key)
          ? `${API_BASE}/api/controls/maps/planFile?id=${encodeURIComponent(
              key
            )}`
          : `${API_BASE}/api/controls/maps/planFile?logical_name=${encodeURIComponent(
              key
            )}`;

      const loadingTask = pdfjsLib.getDocument({
        url,
        withCredentials: true,
        httpHeaders: userHeaders(),
      });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.25 });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");

      await page.render({ canvasContext: ctx, viewport }).promise;
      setThumbnail(canvas.toDataURL());

      await pdf.cleanup?.();
    } catch (e) {
      console.error("[PlanCard] thumbnail error:", e);
      setThumbError(true);
    }
  }

  async function handleRename() {
    try {
      const site = currentSite();
      const headers = new Headers(userHeaders());
      headers.set("X-Site", site);
      headers.set("Content-Type", "application/json");

      await fetch(`${API_BASE}/api/controls/maps/renamePlan`, {
        method: "PUT",
        credentials: "include",
        headers,
        body: JSON.stringify({
          logical_name: plan.logical_name,
          display_name: name.trim(),
        }),
      });

      setEdit(false);
      onReload?.();
    } catch (e) {
      console.error("[PlanCard] rename error:", e);
    }
  }

  return (
    <div className="border rounded-2xl bg-white shadow-sm hover:shadow transition overflow-hidden">
      <div className="relative aspect-video bg-gray-50 flex items-center justify-center">
        {thumbnail && !thumbError ? (
          <img
            src={thumbnail}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-gray-500">
            <div className="text-4xl leading-none">📄</div>
            <div className="text-[11px] mt-1">
              {thumbError ? "Plan indisponible" : "PDF"}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs px-2 py-1 truncate text-center">
          {name}
        </div>
      </div>
      <div className="p-3">
        {!edit ? (
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate" title={name}>
              {name || "—"}
            </div>
            <div className="flex items-center gap-1">
              <button
                className="text-xs text-gray-600 hover:text-gray-900"
                onClick={() => setEdit(true)}
              >
                ✏️
              </button>
              <Btn variant="subtle" onClick={() => onSelect(plan)}>
                Ouvrir
              </Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input value={name} onChange={setName} />
            <div className="flex gap-2">
              <Btn variant="subtle" onClick={handleRename} className="flex-1">
                ✓
              </Btn>
              <Btn
                variant="ghost"
                onClick={() => {
                  setName(plan.display_name || plan.logical_name || "");
                  setEdit(false);
                }}
                className="flex-1"
              >
                ✕
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export {
  Btn,
  Input,
  makeTaskIcon,
  getPlanDims,
  toLatLngFrac,
  fromLatLngToFrac,
  API_BASE,
  userHeaders,
  currentSite,
};
