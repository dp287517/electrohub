// src/pages/Atex-map.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";

import "leaflet/dist/leaflet.css";
import "../styles/atex-map.css";
import { api } from "../lib/api.js";

// --- PDF.js worker + logs discrets
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/* ------------------------------- LOG UTILITIES ------------------------------- */
const DEBUG = () => {
  try { return String(localStorage.DEBUG_ATEX ?? "1") !== "0"; } catch { return true; }
};
function log(action, data = {}, level = "info") {
  if (!DEBUG()) return;
  const ts = new Date().toISOString();
  console[level](`[ATEX][${ts}] ${action}`, data); // eslint-disable-line no-console
}
function timeStart(label) {
  const id = `${label}#${Math.random().toString(36).slice(2, 7)}`;
  if (DEBUG()) {
    console.groupCollapsed(`⏱️ ${label} [start]`); // eslint-disable-line no-console
    console.time(id); // eslint-disable-line no-console
  }
  return () => {
    if (DEBUG()) {
      console.timeEnd(id); // eslint-disable-line no-console
      console.groupEnd(); // eslint-disable-line no-console
    }
  };
}
function safeJson(obj, max = 1500) {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + "…(truncated)" : s;
  } catch {
    return String(obj);
  }
}

/* ----------------------------- Identité / headers ---------------------------- */
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
  } catch {}
  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    if (base) name = base.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }
  email = email ? String(email).trim() : null;
  name = name ? String(name).trim() : null;
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
  // ⚠️ On garde un rendu très défini (polices standard pour réduire warnings)
  return { url, withCredentials: true, httpHeaders: userHeaders(), standardFontDataUrl: "/standard_fonts/" };
}

/* -------------------------------- UI helpers -------------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    ghost: "bg-white text-black border hover:bg-gray-50",
    subtle: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
  };
  return (
    <button
      className={`px-3 py-2 rounded-lg text-sm transition ${map[variant] || map.primary} ${className}`}
      {...p}
    >
      {children}
    </button>
  );
}
function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black placeholder-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}
function Select({ value, onChange, options = [], placeholder, className = "" }) {
  return (
    <select
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value))}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>{o}</option>
        ) : (
          <option key={o.value} value={o.value}>{o.label}</option>
        )
      )}
    </select>
  );
}

/* ----------------------------- Couleurs (Légende) ----------------------------- */
const GAS_STROKE = { 0: "#0ea5e9", 1: "#ef4444", 2: "#f59e0b", null: "#6b7280", undefined: "#6b7280" };
const DUST_FILL = { 20: "#84cc16", 21: "#8b5cf6", 22: "#06b6d4", null: "#e5e7eb", undefined: "#e5e7eb" };
const STATUS_COLOR = {
  a_faire:     { fill: "#059669", border: "#34d399" },
  en_cours_30: { fill: "#f59e0b", border: "#fbbf24" }, // ≤90j
  en_retard:   { fill: "#e11d48", border: "#fb7185" },
  fait:        { fill: "#2563eb", border: "#60a5fa" },
};
const ICON_PX = 22;

function makeEquipIcon(status, isUnsaved) {
  const s = ICON_PX;
  if (isUnsaved) {
    const html = `<div style="
      width:${s}px;height:${s}px;border-radius:9999px;
      background:#2563eb;border:2px solid #93c5fd;
      box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
    "></div>`;
    return L.divIcon({
      className: "atex-marker-inline",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
      popupAnchor: [0, -Math.round(s / 2)],
    });
  }
  const map = STATUS_COLOR[status] || STATUS_COLOR.fait;
  const html = `<div class="${status === "en_retard" ? "blink-red" : status === "en_cours_30" ? "blink-orange" : ""}" style="
    width:${s}px;height:${s}px;border-radius:9999px;
    background:${map.fill};border:2px solid ${map.border};
    box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
  "></div>`;
  return L.divIcon({
    className: "atex-marker-inline",
    html,
    iconSize: [s, s],
    iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
    popupAnchor: [0, -Math.round(s / 2)],
  });
}

/* ----------------------------- Dessin: modes ----------------------------- */
const DRAW_NONE = "none";
const DRAW_RECT = "rect";
const DRAW_CIRCLE = "circle";
const DRAW_POLY = "poly";

/* ----------------------------- Formulaire SubArea (inline) ----------------------------- */
function SubAreaEditor({ initial = {}, onSave, onCancel, onStartGeomEdit, allowDelete, onDelete }) {
  const [name, setName] = useState(initial.name || "");
  const [gas, setGas] = useState(
    initial.zoning_gas === 0 || initial.zoning_gas === 1 || initial.zoning_gas === 2 ? String(initial.zoning_gas) : ""
  );
  const [dust, setDust] = useState(
    initial.zoning_dust === 20 || initial.zoning_dust === 21 || initial.zoning_dust === 22 ? String(initial.zoning_dust) : ""
  );
  return (
    <div className="p-2 rounded-xl border bg-white shadow-lg w-[270px] space-y-2">
      <div className="font-semibold text-sm">Zone ATEX</div>
      <div className="text-[11px] text-gray-500">Remplissage = <b>Poussière</b> • Bordure = <b>Gaz</b></div>
      <div className="grid gap-2">
        <div>
          <div className="text-xs text-gray-600 mb-1">Nom</div>
          <Input value={name} onChange={setName} placeholder="Ex: Mélangeur A" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-gray-600 mb-1">Gaz (0/1/2)</div>
            <Select
              value={gas}
              onChange={setGas}
              options={[
                { value: "", label: "—" },
                { value: "0", label: "Zone 0" },
                { value: "1", label: "Zone 1" },
                { value: "2", label: "Zone 2" },
              ]}
            />
          </div>
          <div>
            <div className="text-xs text-gray-600 mb-1">Poussière (20/21/22)</div>
            <Select
              value={dust}
              onChange={setDust}
              options={[
                { value: "", label: "—" },
                { value: "20", label: "Zone 20" },
                { value: "21", label: "Zone 21" },
                { value: "22", label: "Zone 22" },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <Btn variant="ghost" onClick={onCancel}>Fermer</Btn>
        <div className="flex items-center gap-2">
          {!!onStartGeomEdit && <Btn variant="subtle" onClick={onStartGeomEdit}>Modifier la forme</Btn>}
          <Btn
            onClick={() =>
              onSave?.({
                name: name.trim(),
                zoning_gas: gas === "" ? null : Number(gas),
                zoning_dust: dust === "" ? null : Number(dust),
              })
            }
          >
            Enregistrer
          </Btn>
        </div>
      </div>
      {allowDelete && (
        <div className="flex items-center justify-end">
          <Btn variant="danger" onClick={onDelete}>Supprimer la zone</Btn>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- LÉGENDE --------------------------------- */
function addLegendControl(map) {
  const ctrl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const el = L.DomUtil.create("div", "leaflet-bar leaflet-control p-2 bg-white rounded-xl shadow atex-legend");
      el.style.maxWidth = "280px";
      el.innerHTML = `
        <div class="text-xs font-semibold mb-1">Légende ATEX</div>
        <div class="text-[11px] text-gray-600 mb-1">Remplissage = <b>Poussière</b> • Bordure = <b>Gaz</b></div>
        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div class="font-medium mb-1">Gaz</div>
            <div class="flex items-center gap-2 mb-1"><span class="w-4 h-4 rounded-full" style="background:transparent;border:2px solid ${GAS_STROKE[0]}"></span> Zone 0</div>
            <div class="flex items-center gap-2 mb-1"><span class="w-4 h-4 rounded-full" style="background:transparent;border:2px solid ${GAS_STROKE[1]}"></span> Zone 1</div>
            <div class="flex items-center gap-2"><span class="w-4 h-4 rounded-full" style="background:transparent;border:2px solid ${GAS_STROKE[2]}"></span> Zone 2</div>
          </div>
          <div>
            <div class="font-medium mb-1">Poussière</div>
            <div class="flex items-center gap-2 mb-1"><span class="w-4 h-4 rounded-sm" style="background:${DUST_FILL[20]}"></span> Zone 20</div>
            <div class="flex items-center gap-2 mb-1"><span class="w-4 h-4 rounded-sm" style="background:${DUST_FILL[21]}"></span> Zone 21</div>
            <div class="flex items-center gap-2"><span class="w-4 h-4 rounded-sm" style="background:${DUST_FILL[22]}"></span> Zone 22</div>
          </div>
        </div>
        <div class="mt-2 text-[10px] text-gray-500">
          Exemple: remplissage <span class="inline-block w-3 h-3 align-middle rounded-sm" style="background:${DUST_FILL[21]}"></span>
          &nbsp;bordure <span class="inline-block w-3 h-3 align-middle rounded-full" style="background:transparent;border:2px solid ${GAS_STROKE[1]}"></span>
        </div>
      `;
      L.DomEvent.disableScrollPropagation(el);
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  const inst = new ctrl();
  map.addControl(inst);
  return inst;
}

/* ------------------------------- Composant map ------------------------------- */
export default function AtexMap({ plan, pageIndex = 0, onOpenEquipment, onZonesApplied }) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const subareasLayerRef = useRef(null);
  const legendRef = useRef(null);
  const roRef = useRef(null); // ResizeObserver

  // Anti “double-run” / robustesse PDF
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastJob = useRef({ key: null });
  const aliveRef = useRef(true);

  // Eviter reload/polling avant carte prête
  const readyRef = useRef(false);
  // Déclenchement initial unique une fois imgSize prêt
  const firstPaintRef = useRef(false);

  // ✅ nouvel indicateur: indexation faite pour ce plan/page
  const indexedRef = useRef({ key: "", done: false });

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [positions, setPositions] = useState([]);
  const [unsavedIds, setUnsavedIds] = useState(() => new Set());
  const [drawing, setDrawing] = useState(DRAW_NONE);
  const [polyTemp, setPolyTemp] = useState([]);
  const [editorPos, setEditorPos] = useState(null);
  const [editorInit, setEditorInit] = useState({});
  const [loading, setLoading] = useState(false);

  const [drawMenu, setDrawMenu] = useState(false);
  const [legendVisible, setLegendVisible] = useState(true);

  const [zonesByEquip, setZonesByEquip] = useState(() => ({}));
  const [subareasById, setSubareasById] = useState(() => ({}));

  const editHandlesLayerRef = useRef(null);
  const [geomEdit, setGeomEdit] = useState({ active: false, kind: null, shapeId: null, layer: null });

  const [hud, setHud] = useState({ zoom: 0, mouse: { x: 0, y: 0, xf: 0, yf: 0 }, panes: {} });

  const planKey = useMemo(() => plan?.id || plan?.logical_name || "", [plan]);
  const planDisplayName = useMemo(
    () => (plan?.display_name || plan?.logical_name || plan?.id || "").toString(),
    [plan]
  );

  const fileUrl = useMemo(() => {
    if (!plan) return null;
    if (api?.atexMaps?.planFileUrlAuto) return api.atexMaps.planFileUrlAuto(plan, { bust: true });
    if (api?.atexMaps?.planFileUrl) return api.atexMaps.planFileUrl(plan);
    return null;
  }, [plan]);

  // Petite utilité pour forcer Leaflet à tout rafraîchir proprement
  const forceRedraw = () => {
    const m = mapRef.current;
    if (!m) return;
    try { m.invalidateSize(true); } catch {}
    try { baseLayerRef.current?.redraw?.(); } catch {}
    try { subareasLayerRef.current?.bringToFront?.(); } catch {}
    try { markersLayerRef.current?.bringToFront?.(); } catch {}
  };

  // --- Polling léger (protégé par readyRef)
  useEffect(() => {
    if (!planKey) return;
    const tick = async () => {
      if (!readyRef.current) return;
      const end = timeStart("reloadAll [poll]");
      try { await reloadAll(); } finally { end(); }
    };
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [planKey, pageIndex]);

  // --- Init map + render PDF (robuste, anti double-run)
  useEffect(() => {
    if (!fileUrl || !wrapRef.current) return;

    let cancelled = false;
    aliveRef.current = true;

    const jobKey = `${fileUrl}::${pageIndex}`;
    if (lastJob.current.key === jobKey) {
      // même job → ne pas ré-instancier, on redira juste redraw
      requestAnimationFrame(() => forceRedraw());
      return;
    }
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
      try { window.removeEventListener("orientationchange", onResize); } catch {}
      if (!m) return;
      try { m.off(); } catch {}
      try { m.stop?.(); } catch {}
      try { m.eachLayer((l) => { try { m.removeLayer(l); } catch {} }); } catch {}
      try { legendRef.current && m.removeControl(legendRef.current); } catch {}
      try { mapRef.current && m.remove(); } catch {}
      mapRef.current = null;
      baseLayerRef.current = null;
      markersLayerRef.current = null;
      subareasLayerRef.current = null;
      legendRef.current = null;
      editHandlesLayerRef.current = null;
      readyRef.current = false;
      firstPaintRef.current = false;
      indexedRef.current = { key: "", done: false };
    };

    let onResize = null;

    (async () => {
      const close = timeStart("init map + pdf render");
      try {
        log("init: fileUrl/pageIndex", { fileUrl, pageIndex });

        await cleanupPdf(); // 🧹 éviter toute fuite précédente

        // On garde un bitmap TRÈS fin (lecture détail à fort zoom)
        const containerW = Math.max(320, wrapRef.current.clientWidth || 1024);
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const qualityBoost = 3.5;
        const targetBitmapW = Math.min(12288, Math.max(1800, Math.floor(containerW * dpr * qualityBoost)));

        loadingTaskRef.current = pdfjsLib.getDocument(pdfDocOpts(fileUrl));
        const pdf = await loadingTaskRef.current.promise;
        if (cancelled) return;

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
        if (cancelled) return;

        const dataUrl = canvas.toDataURL("image/png");
        setImgSize({ w: canvas.width, h: canvas.height });
        log("pdf render done", { width: canvas.width, height: canvas.height, scale: safeScale });

        // Map init (une seule instance)
        if (!mapRef.current) {
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

          // Panes pour contrôle fin du z-index
          m.createPane("basePane");    m.getPane("basePane").style.zIndex = 200;
          m.createPane("zonesPane");   m.getPane("zonesPane").style.zIndex = 380;
          m.createPane("markersPane"); m.getPane("markersPane").style.zIndex = 400;
          m.createPane("editPane");    m.getPane("editPane").style.zIndex = 450;

          legendRef.current = addLegendControl(m);
          try {
            const el = legendRef.current?.getContainer?.();
            if (el) el.style.display = legendVisible ? "block" : "none";
          } catch {}

          markersLayerRef.current = L.layerGroup({ pane: "markersPane" }).addTo(m);
          subareasLayerRef.current = L.layerGroup({ pane: "zonesPane" }).addTo(m);
          editHandlesLayerRef.current = L.layerGroup({ pane: "editPane" }).addTo(m);

          m.on("zoomend", () => { if (DEBUG()) setHud((h) => ({ ...h, zoom: m.getZoom() })); });
        }

        const m = mapRef.current;
        // Base image
        const bounds = L.latLngBounds([[0, 0], [viewport.height, viewport.width]]);
        if (baseLayerRef.current) {
          try { m.removeLayer(baseLayerRef.current); } catch {}
          baseLayerRef.current = null;
        }
        const base = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1, pane: "basePane" }).addTo(m);
        baseLayerRef.current = base;

        // Fit initial (avec zoomSnap fin)
        await new Promise(requestAnimationFrame);
        m.invalidateSize(false);
        m.options.zoomSnap = 0.1;
        m.options.zoomDelta = 0.5;
        const fitZoom = m.getBoundsZoom(bounds, true);
        m.setMinZoom(fitZoom - 2);
        m.setMaxZoom(fitZoom + 8);
        m.setMaxBounds(bounds.pad(0.5));
        m.fitBounds(bounds, { padding: [10, 10] });

        // Resize observer + window
        onResize = () => {
          try {
            const keepCenter = m.getCenter();
            const keepZoom = m.getZoom();
            m.invalidateSize(false);
            // conserve la vue (pas de “sauts”)
            m.setView(keepCenter, keepZoom, { animate: false });
          } catch {}
        };
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onResize);
        try {
          roRef.current = new ResizeObserver(() => { onResize(); forceRedraw(); });
          roRef.current.observe(wrapRef.current);
        } catch {}

        // ready → charge données (zones puis positions)
        const kickstart = async () => {
          if (cancelled || readyRef.current) return;
          readyRef.current = true;
          forceRedraw();
          if (!firstPaintRef.current) {
            firstPaintRef.current = true;
            const end = timeStart("reloadAll [firstPaint]");
            try { await reloadAll(); } finally { end(); forceRedraw(); }
          }
        };
        base.once("load", kickstart);
        m.whenReady(() => setTimeout(kickstart, 0));

        try { await pdf.cleanup?.(); } catch {}
        log("init complete");
      } catch (e) {
        console.error("[AtexMap] init error", e); // eslint-disable-line no-console
      } finally {
        close();
      }
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      try { renderTaskRef.current?.cancel(); } catch {}
      try { loadingTaskRef.current?.destroy?.(); } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
      // nettoie la carte
      cleanupMap();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, pageIndex, legendVisible]);

  // 🔁 Première peinture de secours si l'image était déjà en cache
  useEffect(() => {
    if (!mapRef.current) return;
    if (!readyRef.current) return;
    if (!imgSize.w || !imgSize.h) return;
    if (firstPaintRef.current) return;
    firstPaintRef.current = true;
    (async () => {
      const end = timeStart("reloadAll [firstPaint-fallback]");
      try { await reloadAll(); } finally { end(); forceRedraw(); }
    })();
  }, [imgSize.w, imgSize.h, planKey, pageIndex]);

  /* ----------------------------- Chargements + INDEX ----------------------------- */
  async function ensureIndexedOnce() {
    const key = `${plan?.logical_name || ""}::${pageIndex}`;
    if (!key) return;
    if (indexedRef.current.key !== key) {
      indexedRef.current = { key, done: false };
    }
    if (indexedRef.current.done) return;

    try {
      log("reindexZones [once] start", { key });
      await api.atexMaps.reindexZones?.(plan?.logical_name, pageIndex);
      indexedRef.current.done = true;
      log("reindexZones [once] done", { key });
    } catch (e) {
      // on ne bloque pas l'affichage si l'API n'existe pas
      log("reindexZones [once] error (ignored)", { error: String(e) }, "warn");
      indexedRef.current.done = true; // éviter de spammer
    }
  }

  async function reloadAll() {
    const end = timeStart("reloadAll");
    try {
      await ensureIndexedOnce();
      // Important: subareas avant positions (les positions utilisent les zones renvoyées)
      await loadSubareas();
      await loadPositions();
      forceRedraw();
    } finally { end(); }
  }

  async function enrichStatuses(list) {
    if (!Array.isArray(list) || list.length === 0) return list;
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    let updated = false;

    try {
      const cal = await api.atex.calendar?.();
      const events = Array.isArray(cal?.events) ? cal.events : [];
      const now = Date.now();
      for (const ev of events) {
        const id = ev.equipment_id || ev.id;
        if (byId[id]) {
          if (ev.status && byId[id].status !== ev.status) {
            byId[id].status = ev.status; updated = true;
          } else if (ev.date) {
            const diffDays = Math.floor((new Date(ev.date).getTime() - now) / 86400000);
            const status = diffDays < 0 ? "en_retard" : diffDays <= 90 ? "en_cours_30" : "a_faire";
            if (byId[id].status !== status) { byId[id].status = status; updated = true; }
          }
        }
      }
    } catch (e) {
      log("calendar enrichment error", { error: String(e) }, "warn");
    }

    if (!updated) {
      try {
        const eq = await api.atex.listEquipments?.();
        const items = Array.isArray(eq?.items) ? eq.items : [];
        for (const it of items) {
          const id = it.id;
          if (byId[id] && it.status && byId[id].status !== it.status) {
            byId[id].status = it.status; updated = true;
          }
        }
      } catch (e) {
        log("equipments enrichment error", { error: String(e) }, "warn");
      }
    }
    return Object.values(byId);
  }

  async function loadPositions() {
    if (!planKey) return;
    const end = timeStart("loadPositions");
    try {
      const r = await api.atexMaps.positionsAuto(planKey, pageIndex).catch((err) => {
        log("positionsAuto error (caught, returning empty)", { error: String(err) }, "error");
        return { items: [] };
      });
      const baseList = Array.isArray(r?.items)
        ? r.items.map((it) => ({
            id: it.equipment_id || it.atex_id || it.id,
            name: it.name || it.equipment_name,
            x: Number(it.x_frac ?? it.x ?? 0),
            y: Number(it.y_frac ?? it.y ?? 0),
            status: it.status || "a_faire",
            zoning_gas: it.zoning_gas ?? null,
            zoning_dust: it.zoning_dust ?? null,
          }))
        : [];
      const list = await enrichStatuses(baseList);

      setPositions(list);
      setZonesByEquip((prev) => {
        const next = { ...prev };
        for (const it of list) {
          if (it?.id != null) {
            next[it.id] = {
              zoning_gas: it.zoning_gas ?? (prev[it.id]?.zoning_gas ?? null),
              zoning_dust: it.zoning_dust ?? (prev[it.id]?.zoning_dust ?? null),
            };
          }
        }
        return next;
      });

      if (typeof onZonesApplied === "function") {
        try {
          list.forEach((it) => {
            if (!it?.id) return;
            onZonesApplied(it.id, { zoning_gas: it.zoning_gas ?? null, zoning_dust: it.zoning_dust ?? null });
          });
        } catch (e) {
          log("onZonesApplied(list) error", { error: String(e) }, "warn");
        }
      }

      drawMarkers(list);
      log("positions loaded", { count: list.length });
    } catch (e) {
      console.error("[ATEX] loadPositions error", e); // eslint-disable-line no-console
      setPositions([]);
      drawMarkers([]);
    } finally { end(); }
  }

  async function loadSubareas() {
    if (!planKey) return;
    const end = timeStart("loadSubareas");
    try {
      const r = await api.atexMaps.listSubareas(planKey, pageIndex).catch((err) => {
        log("listSubareas error (caught, returning empty)", { error: String(err) }, "error");
        return { items: [] };
      });
      const items = Array.isArray(r?.items) ? r.items : [];

      const byId = {};
      for (const sa of items) if (sa?.id) byId[sa.id] = sa;
      setSubareasById(byId);

      drawSubareas(items);
      log("subareas drawn", { count: items.length });
    } catch (e) {
      console.error("[ATEX] loadSubareas error", e); // eslint-disable-line no-console
      setSubareasById({});
      drawSubareas([]); // clear
    } finally { end(); }
  }

  /* ----------------------- MAJ macro/sub sur l’équipement ----------------------- */
  async function updateEquipmentMacroAndSub(equipmentId, subareaId) {
    try {
      const subName = subareaId ? (subareasById[subareaId]?.name || "") : "";
      const patch = {
        equipment: planDisplayName || "",
        sub_equipment: subName || "",
      };
      log("updateEquipmentMacroAndSub", { equipmentId, ...patch });
      await api.atex.updateEquipment(equipmentId, patch);
    } catch (e) {
      log("updateEquipmentMacroAndSub error", { error: String(e) }, "warn");
    }
  }

  // Création au centre
  async function createEquipmentAtCenter() {
    if (!plan) return;
    const end = timeStart("createEquipmentAtCenter");
    setLoading(true);
    try {
      const created = await api.atex.createEquipment({ name: "", status: "a_faire" });
      const id = created?.id || created?.equipment?.id;
      if (!id) throw new Error("Création ATEX: ID manquant");

      const resp = await api.atexMaps.setPosition(id, {
        logical_name: plan.logical_name,
        plan_id: plan.id,
        page_index: pageIndex,
        x_frac: 0.5,
        y_frac: 0.5,
      });
      log("setPosition (new equip) response", { raw: safeJson(resp) });

      if (resp?.zones) {
        setZonesByEquip((prev) => ({
          ...prev,
          [id]: {
            zoning_gas: resp.zones?.zoning_gas ?? null,
            zoning_dust: resp.zones?.zoning_dust ?? null,
          },
        }));
        await updateEquipmentMacroAndSub(id, resp.zones?.subarea_id || null);

        if (typeof onZonesApplied === "function") {
          try { onZonesApplied(id, { zoning_gas: resp.zones?.zoning_gas ?? null, zoning_dust: resp.zones?.zoning_dust ?? null }); }
          catch (e) { log("onZonesApplied(new) error", { error: String(e) }, "warn"); }
        }
      }

      setUnsavedIds((prev) => new Set(prev).add(id));
      await reloadAll(); // recharge tout (positions + zones)
      onOpenEquipment?.({ id, name: created?.equipment?.name || created?.name || "Équipement" });
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      alert("Erreur création équipement");
    } finally {
      setLoading(false);
      end();
    }
  }

  /* ----------------------------- Markers équipements ----------------------------- */
  function drawMarkers(list) {
    const end = timeStart("drawMarkers");
    try {
      const m = mapRef.current;
      const layer = markersLayerRef.current;
      if (!m || !layer || !imgSize.w) return;
      layer.clearLayers();

      (list || []).forEach((p) => {
        const latlng = L.latLng(p.y * imgSize.h, p.x * imgSize.w);
        const icon = makeEquipIcon(p.status, unsavedIds.has(p.id));
        const mk = L.marker(latlng, {
          icon,
          draggable: true,
          autoPan: true,
          bubblingMouseEvents: false,
          keyboard: false,
          riseOnHover: true,
          pane: "markersPane",
        });
        mk.__meta = p;

        mk.on("dragstart", () => log("marker dragstart", { id: p.id, at: mk.getLatLng() }));
        mk.on("drag", () => DEBUG() && log("marker drag", { id: p.id, at: mk.getLatLng() }));
        mk.on("dragend", async () => {
          const ll = mk.getLatLng();
          const xFrac = Math.min(1, Math.max(0, ll.lng / imgSize.w));
          const yFrac = Math.min(1, Math.max(0, ll.lat / imgSize.h));
          log("marker dragend -> setPosition", { id: p.id, xFrac, yFrac });
          try {
            const resp = await api.atexMaps.setPosition(p.id, {
              logical_name: plan?.logical_name,
              plan_id: plan?.id,
              page_index: pageIndex,
              x_frac: Math.round(xFrac * 1e6) / 1e6,
              y_frac: Math.round(yFrac * 1e6) / 1e6,
            });
            log("setPosition response", { raw: safeJson(resp) });
            if (resp?.zones) {
              setZonesByEquip((prev) => ({
                ...prev,
                [p.id]: {
                  zoning_gas: resp.zones?.zoning_gas ?? null,
                  zoning_dust: resp.zones?.zoning_dust ?? null,
                },
              }));
              await updateEquipmentMacroAndSub(p.id, resp.zones?.subarea_id || null);
              if (typeof onZonesApplied === "function") {
                try { onZonesApplied(p.id, { zoning_gas: resp.zones?.zoning_gas ?? null, zoning_dust: resp.zones?.zoning_dust ?? null }); }
                catch (e) { log("onZonesApplied(dragend) error", { error: String(e) }, "warn"); }
              }
            }
            await reloadAll();
          } catch (e) {
            console.error("[ATEX] setPosition error", e); // eslint-disable-line no-console
          }
        });

        mk.on("click", () => {
          log("marker click -> openEquipment", { id: p.id, name: p.name, zones: zonesByEquip[p.id] });
          onOpenEquipment?.({
            id: p.id,
            name: p.name,
            zones: {
              zoning_gas: zonesByEquip[p.id]?.zoning_gas ?? null,
              zoning_dust: zonesByEquip[p.id]?.zoning_dust ?? null,
            },
          });
        });

        mk.addTo(layer);
      });

      layer.bringToFront?.();
      forceRedraw();
    } finally { end(); }
  }

  /* ----------------------------- Subareas (zones) ----------------------------- */
  function colorForSubarea(sa) {
    const stroke = GAS_STROKE[sa?.zoning_gas ?? null];
    const fill = DUST_FILL[sa?.zoning_dust ?? null];
    return { color: stroke, weight: 1, opacity: 0.9, fillColor: fill, fillOpacity: 0.12, pane: "zonesPane" };
  }

  function clearEditHandles() {
    const lay = editHandlesLayerRef.current;
    if (!lay) return;
    try { lay.clearLayers(); } catch {}
  }

  function mountRectHandles(layer) {
    const lay = editHandlesLayerRef.current;
    const m = mapRef.current;
    if (!lay || !m) return;
    const b = layer.getBounds();
    const corners = [b.getSouthWest(), b.getSouthEast(), b.getNorthEast(), b.getNorthWest()];

    const updateByCorners = (pts) => {
      const newBounds = L.latLngBounds(pts[0], pts[2]);
      layer.setBounds(newBounds);
    };

    corners.forEach((ll, idx) => {
      const h = L.circleMarker(ll, {
        radius: 5, color: "#111827", weight: 1, fillColor: "#ffffff", fillOpacity: 1, pane: "editPane", bubblingMouseEvents: false,
      });
      h.addTo(lay);

      h.on("mousedown", () => {
        m.dragging.disable();
        const onMove = (ev) => {
          const pos = ev.latlng;
          const pts = [...corners];
          pts[idx] = pos;
          updateByCorners(pts);
        };
        const onUp = () => {
          m.dragging.enable();
          m.off("mousemove", onMove);
          m.off("mouseup", onUp);
        };
        m.on("mousemove", onMove);
        m.on("mouseup", onUp);
      });
    });
  }

  function mountCircleHandles(layer) {
    const lay = editHandlesLayerRef.current;
    const m = mapRef.current;
    if (!lay || !m) return;
    const center = layer.getLatLng();
    const r = layer.getRadius();
    const east = L.latLng(center.lat, center.lng + r);

    const centerH = L.circleMarker(center, {
      radius: 5, color: "#111827", weight: 1, fillColor: "#ffffff", fillOpacity: 1, pane: "editPane", bubblingMouseEvents: false,
    }).addTo(lay);

    const radiusH = L.circleMarker(east, {
      radius: 5, color: "#111827", weight: 1, fillColor: "#ffffff", fillOpacity: 1, pane: "editPane", bubblingMouseEvents: false,
    }).addTo(lay);

    centerH.on("mousedown", () => {
      m.dragging.disable();
      const onMove = (ev) => {
        const c = ev.latlng;
        layer.setLatLng(c);
        radiusH.setLatLng(L.latLng(c.lat, c.lng + r));
      };
      const onUp = () => {
        m.dragging.enable();
        m.off("mousemove", onMove);
        m.off("mouseup", onUp);
      };
      m.on("mousemove", onMove);
      m.on("mouseup", onUp);
    });

    radiusH.on("mousedown", () => {
      m.dragging.disable();
      const onMove = (ev) => {
        const c = layer.getLatLng();
        const newR = Math.max(4, m.distance(c, ev.latlng));
        layer.setRadius(newR);
        radiusH.setLatLng(L.latLng(c.lat, c.lng + newR));
      };
      const onUp = () => {
        m.dragging.enable();
        m.off("mousemove", onMove);
        m.off("mouseup", onUp);
      };
      m.on("mousemove", onMove);
      m.on("mouseup", onUp);
    });
  }

  function mountPolyHandles(layer) {
    const lay = editHandlesLayerRef.current;
    const m = mapRef.current;
    if (!lay || !m) return;

    const latlngs = layer.getLatLngs()[0] || [];
    latlngs.forEach((ll, idx) => {
      const h = L.circleMarker(ll, {
        radius: 5, color: "#111827", weight: 1, fillColor: "#ffffff", fillOpacity: 1, pane: "editPane", bubblingMouseEvents: false,
      }).addTo(lay);

      h.on("mousedown", () => {
        m.dragging.disable();
        const onMove = (ev) => {
          const newLatLngs = layer.getLatLngs()[0].slice();
          newLatLngs[idx] = ev.latlng;
          layer.setLatLngs([newLatLngs]);
        };
        const onUp = () => {
          m.dragging.enable();
          m.off("mousemove", onMove);
          m.off("mouseup", onUp);
        };
        m.on("mousemove", onMove);
        m.on("mouseup", onUp);
      });
    });
  }

  function startGeomEdit(layer, sa) {
    log("startGeomEdit", { id: sa.id, kind: sa.kind });
    clearEditHandles();
    setGeomEdit({ active: true, kind: sa.kind, shapeId: sa.id, layer });
    if (sa.kind === "rect") mountRectHandles(layer, sa);
    if (sa.kind === "circle") mountCircleHandles(layer, sa);
    if (sa.kind === "poly") mountPolyHandles(layer, sa);
  }

  async function saveGeomEdit() {
    if (!geomEdit.active || !geomEdit.layer || !geomEdit.shapeId) return;
    const end = timeStart("saveGeomEdit");
    const ly = geomEdit.layer;

    try {
      if (geomEdit.kind === "rect") {
        const b = ly.getBounds();
        const payload = {
          kind: "rect",
          x1: Math.min(1, Math.max(0, b.getWest() / imgSize.w)),
          y1: Math.min(1, Math.max(0, b.getSouth() / imgSize.h)),
          x2: Math.min(1, Math.max(0, b.getEast() / imgSize.w)),
          y2: Math.min(1, Math.max(0, b.getNorth() / imgSize.h)),
        };
        log("updateSubarea(rect) payload", payload);
        await api.atexMaps.updateSubarea(geomEdit.shapeId, payload);
      } else if (geomEdit.kind === "circle") {
        const c = ly.getLatLng();
        const r = ly.getRadius();
        const payload = {
          kind: "circle",
          cx: c.lng / imgSize.w,
          cy: c.lat / imgSize.h,
          r: r / Math.min(imgSize.w, imgSize.h),
        };
        log("updateSubarea(circle) payload", payload);
        await api.atexMaps.updateSubarea(geomEdit.shapeId, payload);
      } else if (geomEdit.kind === "poly") {
        const latlngs = ly.getLatLngs()[0] || [];
        const points = latlngs.map((ll) => [ll.lng / imgSize.w, ll.lat / imgSize.h]);
        const payload = { kind: "poly", points };
        log("updateSubarea(poly) payload", { points: points.length });
        await api.atexMaps.updateSubarea(geomEdit.shapeId, payload);
      }

      setGeomEdit({ active: false, kind: null, shapeId: null, layer: null });
      clearEditHandles();
      await reloadAll();
    } catch (e) {
      console.error("[ATEX] saveGeomEdit error", e); // eslint-disable-line no-console
    } finally { end(); }
  }

  function drawSubareas(items) {
    const end = timeStart("drawSubareas");
    try {
      const m = mapRef.current;
      if (!m || !imgSize.w) return;
      if (!subareasLayerRef.current) subareasLayerRef.current = L.layerGroup({ pane: "zonesPane" }).addTo(m);
      const g = subareasLayerRef.current;
      g.clearLayers();
      clearEditHandles();
      setGeomEdit({ active: false, kind: null, shapeId: null, layer: null });

      (items || []).forEach((sa) => {
        let layer = null;
        const style = colorForSubarea(sa);

        if (sa.kind === "rect") {
          const x1 = (sa.x1 ?? 0) * imgSize.w, y1 = (sa.y1 ?? 0) * imgSize.h;
          const x2 = (sa.x2 ?? 0) * imgSize.w, y2 = (sa.y2 ?? 0) * imgSize.h;
          const b = L.latLngBounds(L.latLng(y1, x1), L.latLng(y2, x2));
          layer = L.rectangle(b, style);
        } else if (sa.kind === "circle") {
          const cx = (sa.cx ?? 0.5) * imgSize.w;
          const cy = (sa.cy ?? 0.5) * imgSize.h;
          const r = Math.max(4, (sa.r ?? 0.05) * Math.min(imgSize.w, imgSize.h));
          layer = L.circle(L.latLng(cy, cx), { radius: r, ...style });
        } else if (sa.kind === "poly") {
          const pts = (sa.points || []).map(([xf, yf]) => [yf * imgSize.h, xf * imgSize.w]);
          layer = L.polygon(pts, style);
        }
        if (!layer) return;

        layer.__meta = sa;
        layer.addTo(g);

        layer.on("click", (e) => {
          log("subarea click -> open editor", { id: sa.id, kind: sa.kind, zoning_gas: sa.zoning_gas, zoning_dust: sa.zoning_dust });
          setEditorInit({
            id: sa.id,
            name: sa.name || "",
            zoning_gas: sa.zoning_gas ?? null,
            zoning_dust: sa.zoning_dust ?? null,
          });
          setEditorPos({
            screen: e.originalEvent ? { x: e.originalEvent.clientX, y: e.originalEvent.clientY } : null,
            shapeId: sa.id,
            layer,
            kind: sa.kind,
          });
        });

        if (sa?.name) {
          const center = layer.getBounds?.().getCenter?.() || layer.getLatLng?.() || null;
          if (center) {
            L.marker(center, {
              interactive: false,
              pane: "zonesPane",
              icon: L.divIcon({
                className: "atex-subarea-label",
                html: `<div class="px-2 py-1 rounded bg-white/90 border shadow text-[11px]">${sa.name}</div>`,
              }),
            }).addTo(g);
          }
        }
      });

      g.bringToFront?.();
      markersLayerRef.current?.bringToFront?.();
      forceRedraw();
    } finally { end(); }
  }

  /* -------- Dessin zones (rect/polygone/cercle) -------- */
  function setDrawMode(mode) {
    log("setDrawMode", { mode });
    if (mode === "rect") setDrawing(DRAW_RECT);
    else if (mode === "circle") setDrawing(DRAW_CIRCLE);
    else if (mode === "poly") { setPolyTemp([]); setDrawing(DRAW_POLY); }
    else setDrawing(DRAW_NONE);
  }

  useEffect(() => {
    const m = mapRef.current;
    if (!m || drawing === DRAW_NONE || drawing === DRAW_POLY) return;

    let startPt = null;
    let tempLayer = null;
    const mode = drawing;

    const onDown = (e) => {
      startPt = e.latlng;
      log("draw onDown", { mode, start: startPt });
      if (mode === DRAW_CIRCLE) {
        tempLayer = L.circle(e.latlng, { radius: 1, ...colorForSubarea({}), fillOpacity: 0.12, pane: "zonesPane" });
        tempLayer.addTo(m);
      }
      if (mode === DRAW_RECT) {
        tempLayer = L.rectangle(L.latLngBounds(e.latlng, e.latlng), { ...colorForSubarea({}), fillOpacity: 0.12, pane: "zonesPane" });
        tempLayer.addTo(m);
      }
      m.dragging.disable();
    };
    const onMove = (e) => {
      if (!startPt || !tempLayer) return;
      if (mode === DRAW_CIRCLE) {
        const r = m.distance(startPt, e.latlng);
        tempLayer.setRadius(Math.max(4, r));
      } else if (mode === DRAW_RECT) {
        tempLayer.setBounds(L.latLngBounds(startPt, e.latlng));
      }
    };
    const onUp = () => {
      m.dragging.enable();
      if (!startPt || !tempLayer) {
        setDrawing(DRAW_NONE);
        return;
      }
      log("draw onUp -> open editor", { mode });
      openSubareaEditorAtCenter(
        async (meta) => {
          const end = timeStart("createSubarea (from tempLayer)");
          try {
            if (mode === DRAW_CIRCLE) {
              const ll = tempLayer.getLatLng();
              const r = tempLayer.getRadius();
              const payload = {
                kind: "circle",
                cx: ll.lng / imgSize.w,
                cy: ll.lat / imgSize.h,
                r: r / Math.min(imgSize.w, imgSize.h),
                name: meta.name,
                zoning_gas: meta.zoning_gas,
                zoning_dust: meta.zoning_dust,
                plan_id: plan?.id,
                logical_name: plan?.logical_name,
                page_index: pageIndex,
              };
              log("createSubarea(circle) payload", payload);
              await api.atexMaps.createSubarea(payload);
            } else if (mode === DRAW_RECT) {
              const b = tempLayer.getBounds();
              const payload = {
                kind: "rect",
                x1: Math.min(1, Math.max(0, b.getWest() / imgSize.w)),
                y1: Math.min(1, Math.max(0, b.getSouth() / imgSize.h)),
                x2: Math.min(1, Math.max(0, b.getEast() / imgSize.w)),
                y2: Math.min(1, Math.max(0, b.getNorth() / imgSize.h)),
                name: meta.name,
                zoning_gas: meta.zoning_gas,
                zoning_dust: meta.zoning_dust,
                plan_id: plan?.id,
                logical_name: plan?.logical_name,
                page_index: pageIndex,
              };
              log("createSubarea(rect) payload", payload);
              await api.atexMaps.createSubarea(payload);
            }
          } catch (e) {
            console.error("[ATEX] Subarea create failed", e); // eslint-disable-line no-console
            alert("Erreur création zone");
          } finally {
            try { tempLayer && m.removeLayer(tempLayer); } catch {}
            await reloadAll();
            end();
          }
        },
        () => {
          log("editor cancel -> remove tempLayer");
          try { tempLayer && m.removeLayer(tempLayer); } catch {}
        }
      );
      setDrawing(DRAW_NONE);
      m.off("mousedown", onDown);
      m.off("mousemove", onMove);
      m.off("mouseup", onUp);
    };

    m.on("mousedown", onDown);
    m.on("mousemove", onMove);
    m.on("mouseup", onUp);
    return () => {
      try {
        m.off("mousedown", onDown);
        m.off("mousemove", onMove);
        m.off("mouseup", onUp);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, imgSize, planKey, pageIndex]);

  function drawPolyTemp(arr = polyTemp) {
    const m = mapRef.current;
    if (!m || !subareasLayerRef.current) return;
    const group = subareasLayerRef.current;
    group.eachLayer((ly) => { if (ly.__tempPoly) { try { group.removeLayer(ly); } catch {} } });
    if (arr.length >= 1) {
      const pts = arr.map(([x, y]) => [y * imgSize.h, x * imgSize.w]);
      const poly = L.polyline(pts, { color: "#111827", dashArray: "4,2", pane: "zonesPane" });
      poly.__tempPoly = true;
      poly.addTo(group);
    }
  }

  async function savePolyTemp(meta) {
    if (polyTemp.length < 3) return;
    const end = timeStart("createSubarea(poly)");
    try {
      const payload = {
        kind: "poly",
        points: polyTemp,
        name: meta.name,
        zoning_gas: meta.zoning_gas,
        zoning_dust: meta.zoning_dust,
        plan_id: plan?.id,
        logical_name: plan?.logical_name,
        page_index: pageIndex,
      };
      log("createSubarea(poly) payload", { points: polyTemp.length });
      await api.atexMaps.createSubarea(payload);
      setPolyTemp([]);
      await reloadAll();
    } finally { end(); }
  }

  /* ----------------------------- Editeur popup ----------------------------- */
  function openSubareaEditorAtCenter(onSave, onCancelCleanup) {
    const m = mapRef.current;
    if (!m) return;
    const sz = m.getSize();
    setEditorInit({});
    setEditorPos({ screen: { x: sz.x / 2, y: sz.y / 2 }, shapeId: null, onSave, onCancel: onCancelCleanup });
  }
  async function onSaveSubarea(meta) {
    const end = timeStart("onSaveSubarea");
    try {
      if (editorPos?.onSave) {
        await editorPos.onSave(meta);
        setEditorPos(null);
        return;
      }
      if (editorPos?.shapeId) {
        const payload = { name: meta.name, zoning_gas: meta.zoning_gas, zoning_dust: meta.zoning_dust };
        log("updateSubarea(meta) payload", payload);
        await api.atexMaps.updateSubarea(editorPos.shapeId, payload);
        setEditorPos(null);
        await reloadAll();
      }
    } finally { end(); }
  }
  async function onDeleteSubarea() {
    const end = timeStart("onDeleteSubarea");
    try {
      if (!editorPos?.shapeId) return setEditorPos(null);
      const ok = window.confirm("Supprimer cette sous-zone ?");
      if (!ok) return;
      await api.atexMaps.deleteSubarea(editorPos.shapeId);
      setEditorPos(null);
      await reloadAll();
    } finally { end(); }
  }

  /* ----------------------------- RENDER ----------------------------- */
  const viewerHeight = Math.max(
    520,
    Math.min(imgSize.h || 1200, (typeof window !== "undefined" ? window.innerHeight : 1000) - 140)
  );

  const toggleLegend = () => {
    setLegendVisible((v) => {
      const next = !v;
      const el = legendRef.current?.getContainer?.();
      if (el) el.style.display = next ? "block" : "none";
      return next;
    });
  };

  return (
    <div className="relative">
      {/* viewer leaflet + toolbar intégrée */}
      <div
        ref={wrapRef}
        className="leaflet-wrapper relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
        style={{ height: viewerHeight }}
      >
        {/* Toolbar dans la carte (haut-gauche) */}
        <div className="atex-toolbar">
          {/* + au centre */}
          <button className="btn-plus" onClick={() => createEquipmentAtCenter()} title="Ajouter un équipement au centre">+</button>

          {/* Dessiner */}
          <div className="btn-pencil-wrap">
            <button className="btn-pencil" onClick={() => setDrawMenu((v) => !v)} title="Dessiner (zones ATEX)">✏️</button>
            {drawMenu && (
              <div className="draw-menu">
                <button onClick={() => { setDrawMode("rect"); setDrawMenu(false); }}>Rectangle</button>
                <button onClick={() => { setDrawMode("poly"); setDrawMenu(false); }}>Polygone</button>
                <button onClick={() => { setDrawMode("circle"); setDrawMenu(false); }}>Cercle</button>
                <button onClick={() => { setDrawMode("none"); setDrawMenu(false); }}>Annuler</button>
              </div>
            )}
          </div>

          {/* Ajuster */}
          <button
            className="btn-plus"
            title="Ajuster le plan (dézoome un peu)"
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
              log("adjust view", { fitZoom, finalZoom: m.getZoom() });
              forceRedraw();
            }}
          >
            🗺️
          </button>

          {/* Légende: repliable */}
          <button
            className="btn-pencil"
            title={legendVisible ? "Cacher la légende" : "Afficher la légende"}
            onClick={toggleLegend}
          >
            {legendVisible ? "⮜" : "⮞"}
          </button>

          {/* Sauvegarder géométrie */}
          {geomEdit.active && (
            <button className="btn-pencil" title="Sauvegarder la géométrie" onClick={saveGeomEdit}>
              💾
            </button>
          )}
        </div>

        {/* HUD debug (affiché si DEBUG_ATEX=1) */}
        {DEBUG() && (
          <div className="absolute top-2 right-2 bg-white/85 border rounded-lg px-3 py-2 text-[11px] shadow z-[9000] space-y-1">
            <div className="font-medium">DEBUG HUD</div>
            <div>zoom: {hud.zoom}</div>
            <div>img: {imgSize.w}×{imgSize.h}</div>
            <div>panes zIndex: base:{hud.panes.basePane} zones:{hud.panes.zonesPane} markers:{hud.panes.markersPane} edit:{hud.panes.editPane}</div>
          </div>
        )}
      </div>

      {/* éditeur inline (position absolue à l’écran) */}
      {editorPos?.screen && (
        <div
          className="fixed z-[7000]"
          style={{ left: Math.max(8, editorPos.screen.x - 150), top: Math.max(8, editorPos.screen.y - 10) }}
        >
          <SubAreaEditor
            initial={editorInit}
            onSave={onSaveSubarea}
            onCancel={() => { editorPos?.onCancel?.(); setEditorPos(null); }}
            onStartGeomEdit={
              editorPos?.layer && editorPos?.kind
                ? () => startGeomEdit(editorPos.layer, { id: editorPos.shapeId, kind: editorPos.kind })
                : undefined
            }
            allowDelete={!!editorPos?.shapeId}
            onDelete={onDeleteSubarea}
          />
        </div>
      )}

      {/* légende marqueurs (rappel) */}
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-600 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: "#059669" }} />
          À faire
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full blink-orange" style={{ background: "#f59e0b" }} />
          ≤90j
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full blink-red" style={{ background: "#e11d48" }} />
          En retard
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ background: "#2563eb" }} />
          Nouvelle (à enregistrer)
        </span>
        <span className="inline-flex items-center gap-1 text-gray-500">• Remplissage = Poussière • Bordure = Gaz</span>
      </div>
    </div>
  );
}
