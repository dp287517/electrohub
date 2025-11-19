// ============================================================================
// Vsd-map.jsx — Carte VSD (positionnement des variateurs sur plans PDF)
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// PDF.js (silencieux)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

// ============================================================================
// CONFIG & HELPERS
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
    if (!email) email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    if (!name)  name  = localStorage.getItem("name")  || localStorage.getItem("user.name")  || null;
    if ((!email || !name) && localStorage.getItem("user")) {
      const u = JSON.parse(localStorage.getItem("user"));
      if (!email && u?.email) email = String(u.email);
      if (!name  && (u?.name || u?.displayName)) name = String(u.name || u.displayName);
    }
  } catch {}
  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    if (base) name = base.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }
  return { email: email || null, name: name || null };
}

function currentSite() {
  try {
    const u = JSON.parse(localStorage.getItem("eh_user") || "{}");
    return u?.site || "Default";
  } catch {
    return "Default";
  }
}

function userHeaders() {
  const { email, name } = getIdentity();
  const h = {};
  if (email) h["X-User-Email"] = email;
  if (name)  h["X-User-Name"]  = name;
  const site = currentSite();
  if (site)  h["X-Site"]       = site; // utile si ton infra segmente par site
  return h;
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}
function isNumericId(s) {
  return (typeof s === "string" && /^\d+$/.test(s)) || (typeof s === "number" && Number.isInteger(s));
}

/** URL du PDF d’un plan VSD (serveur: GET /api/vsd/maps/planFile) */
function buildVsdPlanFileUrl(keyOrLogical) {
  let url =
    isUuid(keyOrLogical) || isNumericId(keyOrLogical)
      ? `${API_BASE}/api/vsd/maps/planFile?id=${encodeURIComponent(keyOrLogical)}`
      : `${API_BASE}/api/vsd/maps/planFile?logical_name=${encodeURIComponent(keyOrLogical)}`;
  // (facultatif) router par site côté infra
  const site = currentSite();
  if (site) url += `${url.includes("?") ? "&" : "?"}site=${encodeURIComponent(site)}`;
  return url;
}

/** Options PDF.js (headers d’identité inclus) */
function pdfDocOpts(url) {
  return { url, withCredentials: true, httpHeaders: userHeaders(), standardFontDataUrl: "/standard_fonts/" };
}

// ============================================================================
// STATUTS & ICÔNES
// ============================================================================

const STATUS_COLOR = {
  a_faire:     { fill: "#059669", border: "#34d399" },
  en_cours_30: { fill: "#f59e0b", border: "#fbbf24" },
  en_retard:   { fill: "#e11d48", border: "#fb7185" },
  fait:        { fill: "#2563eb", border: "#60a5fa" },
};
const ICON_PX = 22;

function makeEquipIcon(status, isUnsaved = false) {
  const s = ICON_PX;
  if (isUnsaved) {
    const html = `<div style="
      width:${s}px;height:${s}px;border-radius:9999px;
      background:#2563eb;border:2px solid #93c5fd;
      box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
    "></div>`;
    return L.divIcon({
      className: "vsd-marker-inline",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s/2), Math.round(s/2)],
      popupAnchor: [0, -Math.round(s/2)],
    });
  }
  const map = STATUS_COLOR[status] || STATUS_COLOR.a_faire;
  const blink =
    status === "en_retard"   ? "blink-red" :
    status === "en_cours_30" ? "blink-orange" : "";
  const html = `<div class="${blink}" style="
    width:${s}px;height:${s}px;border-radius:9999px;
    background:${map.fill};border:2px solid ${map.border};
    box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
  "></div>`;
  return L.divIcon({
    className: "vsd-marker-inline",
    html,
    iconSize: [s, s],
    iconAnchor: [Math.round(s/2), Math.round(s/2)],
    popupAnchor: [0, -Math.round(s/2)],
  });
}

// ============================================================================
// GÉOMÉTRIE / CONVERSIONS
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
// STYLES
// ============================================================================

const injectedCss = `
@keyframes blink-red    { 0%,100%{opacity:1} 50%{opacity:.5} }
@keyframes blink-orange { 0%,100%{opacity:1} 50%{opacity:.7} }
.blink-red{animation:blink-red 1.5s ease-in-out infinite;}
.blink-orange{animation:blink-orange 2s ease-in-out infinite;}
.leaflet-wrapper{position:relative;}
.placement-mode-active{cursor:crosshair!important;}
.placement-mode-active *{cursor:crosshair!important;}
.vsd-marker-inline{background:transparent!important;border:none!important;}
`;
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = injectedCss;
  document.head.appendChild(style);
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * Props:
 * - plan: { id, logical_name, display_name, ... }
 * - pageIndex?: number (0 par défaut)
 * - pendingPlacement?: { equipment_id: string, logical_name?: string }
 * - onPlacementComplete?: () => void
 * - onOpenEquipment?: (equipBase: { id, name? }) => void
 * - inModal?: boolean
 * - focusEquipmentId?: string
 */
export default function VsdMap({
  plan,
  pageIndex = 0,
  pendingPlacement = null,
  onPlacementComplete,
  onOpenEquipment,
  inModal = false,
  focusEquipmentId = null,
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const markersByEquipRef = useRef(new Map());
  const roRef = useRef(null);

  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastJob = useRef({ key: null });

  const baseReadyRef = useRef(false);
  const draggingRef = useRef(false);
  const placementModeRef = useRef(false);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [error, setError] = useState(null);

  const planKey = useMemo(() => plan?.id || plan?.logical_name || "", [plan]);
  const logicalName = useMemo(() => plan?.logical_name || "", [plan]);
  const fileUrl = useMemo(() => {
    if (!planKey) return null;
    if (plan?.url_pdf) return plan.url_pdf;
    return buildVsdPlanFileUrl(planKey);
  }, [planKey, plan]);

  // Mode "clic pour placer"
  useEffect(() => {
    if (pendingPlacement) {
      placementModeRef.current = true;
      wrapRef.current?.classList.add("placement-mode-active");
    } else {
      placementModeRef.current = false;
      wrapRef.current?.classList.remove("placement-mode-active");
      // repasse les marqueurs en draggable
      loadPositions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlacement]);

  // Focus visuel d’un équipement si demandé
  function focusOnEquipment(id) {
    if (!id) return;
    const m = mapRef.current;
    const base = baseLayerRef.current;
    const mk = markersByEquipRef.current.get(id);
    if (!m || !base || !mk) return;
    const ll = mk.getLatLng();
    const maxZ = m.getMaxZoom?.() ?? m.getZoom();
    m.setView(ll, Math.min((m.getZoom() ?? 0) + 2, maxZ), { animate: true });
    mk.getElement?.()?.classList.add("blink-red");
    setTimeout(() => mk.getElement?.()?.classList.remove("blink-red"), 1800);
    mk.openPopup?.();
  }
  useEffect(() => {
    if (!focusEquipmentId) return;
    const t = setTimeout(() => focusOnEquipment(focusEquipmentId), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEquipmentId]);

  // ========================================================================
  // CHARGEMENT DES POSITIONS
  // ========================================================================
  async function loadPositions() {
    if (!planKey) return;
    try {
      const headers = new Headers(userHeaders());
      const site = currentSite();
      if (site) headers.set("X-Site", site);

      // GET /api/vsd/maps/positions?logical_name=...&page_index=...
      let url = `${API_BASE}/api/vsd/maps/positions?page_index=${Number(pageIndex)}`;
      if (isUuid(planKey) || isNumericId(planKey)) url += `&id=${encodeURIComponent(planKey)}`;
      else url += `&logical_name=${encodeURIComponent(logicalName || planKey)}`;

      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Serveur: renvoie { positions: [...] } avec equipment_id, x_frac, y_frac, name, status. :contentReference[oaicite:3]{index=3}
      const list = Array.isArray(data?.positions) ? data.positions : [];
      drawMarkers(
        list.map((p) => ({
          equipment_id: p.equipment_id,
          name: p.name || "Équipement",
          x: Number(p.x_frac ?? p.x ?? 0),
          y: Number(p.y_frac ?? p.y ?? 0),
          status: p.status || "a_faire",
        }))
      );
    } catch (e) {
      console.error("[VSD] loadPositions error:", e);
      drawMarkers([]);
    }
  }

  // ========================================================================
  // MARQUEURS
  // ========================================================================
  function drawMarkers(list) {
    const m = mapRef.current;
    const layer = markersLayerRef.current;
    const base = baseLayerRef.current;
    if (!m || !layer || !base) return;

    layer.clearLayers();
    markersByEquipRef.current.clear();

    (list || []).forEach((p) => {
      const latlng = toLatLngFrac(p.x, p.y, base);
      const icon = makeEquipIcon(p.status);

      const mk = L.marker(latlng, {
        icon,
        draggable: !placementModeRef.current,
        autoPan: true,
        bubblingMouseEvents: false,
        keyboard: false,
        riseOnHover: true,
        pane: "markersPane",
      });

      mk.__equip = p;
      markersByEquipRef.current.set(p.equipment_id, mk);

      mk.on("dragstart", () => { draggingRef.current = true; });
      mk.on("dragend", async () => {
        const ll = mk.getLatLng();
        const { xf, yf } = fromLatLngToFrac(ll, base);
        try {
          const headers = new Headers(userHeaders());
          headers.set("Content-Type", "application/json");

          // POST /api/vsd/maps/setPosition — body: equipment_id, logical_name, page_index, x_frac, y_frac
          const body = {
            equipment_id: p.equipment_id,
            logical_name: logicalName || plan?.logical_name, // requis serveur
            plan_id: plan?.id || null,
            page_index,
            x_frac: Math.round(xf * 1e6) / 1e6,
            y_frac: Math.round(yf * 1e6) / 1e6,
          };

          await fetch(`${API_BASE}/api/vsd/maps/setPosition`, {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify(body),
          });

          await loadPositions();
        } catch (err) {
          console.error("[VSD] setPosition drag error:", err);
        } finally {
          draggingRef.current = false;
        }
      });

      mk.on("click", () => {
        if (placementModeRef.current) return; // en mode placement, un clic place, pas d’ouverture
        onOpenEquipment?.({ id: p.equipment_id, name: p.name });
      });

      mk.addTo(layer);
    });

    layer.bringToFront?.();
  }

  // ========================================================================
  // INIT CARTE + RENDU PDF + GESTION DU CLIC DE PLACEMENT
  // ========================================================================
  useEffect(() => {
    if (!wrapRef.current) return;

    const jobKey = `${fileUrl || "no-pdf"}::${pageIndex}`;
    const mustForceReload = !baseReadyRef.current || !mapRef.current || !markersLayerRef.current;
    if (lastJob.current.key === jobKey && !mustForceReload) return;
    lastJob.current.key = jobKey;

    const cleanupPdf = async () => {
      try { renderTaskRef.current?.cancel(); } catch {}
      try { await loadingTaskRef.current?.destroy?.(); } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
    };

    const cleanupMap = () => {
      const m = mapRef.current;
      try { roRef.current?.disconnect?.(); } catch {}
      try { window.removeEventListener("resize", onResize); } catch {}
      if (!m) return;
      try { m.off(); } catch {}
      try { m.eachLayer((l) => { try { m.removeLayer(l); } catch {} }); } catch {}
      try { m.remove(); } catch {}
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

        // 1) Carte Leaflet
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

        m.createPane("basePane");    m.getPane("basePane").style.zIndex = 200;
        m.createPane("markersPane"); m.getPane("markersPane").style.zIndex = 400;

        markersLayerRef.current = L.layerGroup({ pane: "markersPane" }).addTo(m);

        const PROV_W = 2000, PROV_H = 1400;
        const provBounds = L.latLngBounds([[0,0],[PROV_H,PROV_W]]);
        await new Promise(requestAnimationFrame);
        m.invalidateSize(false);
        m.options.zoomSnap = 0.1;
        m.options.zoomDelta = 0.5;
        const fitZoom = m.getBoundsZoom(provBounds, true);
        m.setMinZoom(fitZoom - 2);
        m.setMaxZoom(fitZoom + 8);
        m.setMaxBounds(provBounds.pad(0.5));
        m.fitBounds(provBounds, { padding: [10,10] });

        // Resize
        onResize = () => {
          try {
            const keepCenter = m.getCenter();
            const keepZoom   = m.getZoom();
            m.invalidateSize(false);
            m.setView(keepCenter, keepZoom, { animate: false });
          } catch {}
        };
        window.addEventListener("resize", onResize);
        try {
          roRef.current = new ResizeObserver(() => onResize());
          roRef.current.observe(wrapRef.current);
        } catch {}

        // Clic de placement (mode actif uniquement si pendingPlacement)
        m.on("click", async (e) => {
          if (!placementModeRef.current || !pendingPlacement) return;
          const base = baseLayerRef.current;
          if (!base) return;

          const { xf, yf } = fromLatLngToFrac(e.latlng, base);

          try {
            const headers = new Headers(userHeaders());
            headers.set("Content-Type", "application/json");

            // POST /api/vsd/maps/setPosition
            const body = {
              equipment_id: pendingPlacement.equipment_id,
              logical_name: pendingPlacement.logical_name || logicalName || plan?.logical_name,
              plan_id: plan?.id || null,
              page_index,
              x_frac: Math.round(xf * 1e6) / 1e6,
              y_frac: Math.round(yf * 1e6) / 1e6,
            };

            await fetch(`${API_BASE}/api/vsd/maps/setPosition`, {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify(body),
            }); // champs requis confirmés côté serveur. :contentReference[oaicite:4]{index=4}

            placementModeRef.current = false;
            wrapRef.current?.classList.remove("placement-mode-active");
            await loadPositions();
            onPlacementComplete?.();

            // petit event pour rafraîchir la liste côté page, si branchée
            try { window.dispatchEvent(new CustomEvent("vsd-plan-meta-updated")); } catch {}
          } catch (err) {
            console.error("[VSD] setPosition click error:", err);
          }
        });

        // 2) Rendu PDF
        if (fileUrl) {
          const containerW = Math.max(320, wrapRef.current.clientWidth || 1024);
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          const qualityBoost = 3.5;
          const targetBitmapW = Math.min(12288, Math.max(1800, Math.floor(containerW * dpr * qualityBoost)));

          loadingTaskRef.current = pdfjsLib.getDocument(pdfDocOpts(fileUrl));
          const pdf = await loadingTaskRef.current.promise;
          const page = await pdf.getPage(Number(pageIndex) + 1);
          const baseVp = page.getViewport({ scale: 1 });
          const safeScale = Math.min(6.0, Math.max(0.75, targetBitmapW / baseVp.width));
          const viewport = page.getViewport({ scale: safeScale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d", { alpha: true });
          ctx.imageSmoothingEnabled = true;

          renderTaskRef.current = page.render({ canvasContext: ctx, viewport, intent: "display" });
          await renderTaskRef.current.promise;

          const dataUrl = canvas.toDataURL("image/png");
          setImgSize({ w: canvas.width, h: canvas.height });

          const bounds = L.latLngBounds([[0,0],[viewport.height, viewport.width]]);
          const base = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1, pane: "basePane" }).addTo(m);
          baseLayerRef.current = base;

          await new Promise(requestAnimationFrame);
          m.invalidateSize(false);
          const fitZoom2 = m.getBoundsZoom(bounds, true);
          m.setMinZoom(fitZoom2 - 2);
          m.setMaxZoom(fitZoom2 + 8);
          m.setMaxBounds(bounds.pad(0.5));
          m.fitBounds(bounds, { padding: [10,10] });

          baseReadyRef.current = true;
          await loadPositions();

          try { await pdf.cleanup?.(); } catch {}
        } else {
          setError("Aucun plan PDF disponible.");
        }
      } catch (e) {
        console.error("[VSD] init map error:", e);
        setError("Impossible de charger le plan.");
      }
    })();

    return () => {
      try { renderTaskRef.current?.cancel(); } catch {}
      try { loadingTaskRef.current?.destroy?.(); } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
      cleanupMap();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, pageIndex]);

  // ========================================================================
  // RENDER
  // ========================================================================
  const viewerHeight = Math.min(
    (typeof window !== "undefined" ? window.innerHeight : 900) - 140,
    imgSize.h || 900
  );

  return (
    <div
      ref={wrapRef}
      className="leaflet-wrapper relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
      style={{ height: inModal ? Math.max(420, viewerHeight) : Math.max(520, viewerHeight) }}
    >
      {error && (
        <div className="absolute inset-x-0 top-2 z-[10] mx-auto max-w-md px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-200 shadow">
          {error}
        </div>
      )}
      {/* La carte est initialisée directement dans le div via Leaflet */}
    </div>
  );
}
