// src/pages/Meca.jsx
import { useEffect, useMemo, useRef, useState, forwardRef, useCallback, useImperativeHandle } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/vsd-map.css"; // on réutilise le style VSD

import { api, API_BASE } from "../lib/api.js";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/* ----------------------------- Helpers ----------------------------- */
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
  return { url, withCredentials: true, httpHeaders: userHeaders(), standardFontDataUrl: "/standard_fonts/" };
}

/* ----------------------------- UI Components ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
    ghost: "bg-white text-black border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed",
    subtle: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed",
    warn: "bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed",
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

function Textarea({ value, onChange, className = "", ...p }) {
  return (
    <textarea
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}

function Select({ value, onChange, options = [], className = "", placeholder }) {
  return (
    <select
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
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

function Badge({ color = "gray", children, className = "" }) {
  const map = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-emerald-100 text-emerald-700",
    orange: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color] || map.gray} ${className}`}>
      {children}
    </span>
  );
}

function Labeled({ label, children }) {
  return (
    <label className="text-sm space-y-1">
      <div className="text-gray-600">{label}</div>
      {children}
    </label>
  );
}

function Drawer({ title, children, onClose, dirty = false }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") confirmClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useEffect(() => {
    const beforeUnload = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function confirmClose() {
    if (dirty) {
      const ok = window.confirm("Des modifications ne sont pas enregistrées. Fermer quand même ?");
      if (!ok) return;
    }
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-[6000]">
      <div className="absolute inset-0 bg-black/30" onClick={confirmClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[760px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold truncate pr-3">{title}</h3>
          <Btn variant="ghost" onClick={confirmClose}>Fermer</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({ text, onClose }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => onClose?.(), 4000);
    return () => clearTimeout(t);
  }, [text, onClose]);
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000]">
      <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">{text}</div>
    </div>
  );
}

/* ----------------------------- MECA Leaflet Viewer ----------------------------- */
const MecaLeafletViewer = forwardRef(({ fileUrl, pageIndex = 0, initialPoints = [], onReady, onMovePoint, onClickPoint, onCreatePoint, disabled = false }, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const addBtnControlRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);
  const aliveRef = useRef(true);
  const pointsRef = useRef(initialPoints); 
  
  // Zoom persistant
  const lastViewRef = useRef({ center: [0, 0], zoom: 0 });
  const initialFitDoneRef = useRef(false);
  const userViewTouchedRef = useRef(false);

  const lastJob = useRef({ key: null });
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);

  const ICON_PX = 22;

  function makeMecaIcon() {
    const s = ICON_PX;
    const html = `<div class="vsd-marker" style="width:${s}px;height:${s}px;"></div>`;
    return L.divIcon({
      className: "vsd-marker-inline",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
      popupAnchor: [0, -Math.round(s / 2)],
    });
  }

  function ensureAddButton(map) {
    if (addBtnControlRef.current) return;
    const AddCtrl = L.Control.extend({
      onAdd: function () {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-addvsd");
        const a = L.DomUtil.create("a", "", container);
        a.href = "#";
        a.title = "Créer un équipement au centre";
        a.textContent = "+";
        L.DomEvent.on(a, "click", (ev) => {
          L.DomEvent.stop(ev);
          onCreatePoint?.();
        });
        return container;
      },
      onRemove: function () {},
      options: { position: "topright" },
    });
    addBtnControlRef.current = new AddCtrl();
    map.addControl(addBtnControlRef.current);
  }

  const drawMarkers = useCallback((list, w, h) => {
    const map = mapRef.current;
    const g = markersLayerRef.current;
    if (!map || !g || w === 0 || h === 0) return;
    
    pointsRef.current = list; 
    g.clearLayers();

    (list || []).forEach((p) => {
      const x = Number(p.x_frac ?? p.x ?? 0) * w;
      const y = Number(p.y_frac ?? p.y ?? 0) * h;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const latlng = L.latLng(y, x);
      const icon = makeMecaIcon();
      const mk = L.marker(latlng, {
        icon,
        draggable: true,
        autoPan: true,
        bubblingMouseEvents: false,
        keyboard: false,
        riseOnHover: true,
      });
      mk.__meta = {
        equipment_id: p.equipment_id,
        name: p.name || p.equipment_name,
        x_frac: p.x_frac,
        y_frac: p.y_frac,
      };

      mk.on("click", () => {
        setPicker(null);
        onClickPoint?.(mk.__meta);
      });

      mk.on("dragend", () => {
        if (!onMovePoint) return;
        const ll = mk.getLatLng();
        const xFrac = Math.min(1, Math.max(0, ll.lng / w));
        const yFrac = Math.min(1, Math.max(0, ll.lat / h));
        const xf = Math.round(xFrac * 1e6) / 1e6;
        const yf = Math.round(yFrac * 1e6) / 1e6;
        onMovePoint(p.equipment_id, { x: xf, y: yf });
      });

      mk.addTo(g);
    });
  }, [onClickPoint, onMovePoint]);

  useEffect(() => {
    if (disabled) return;
    if (!fileUrl || !wrapRef.current) return;

    let cancelled = false;
    aliveRef.current = true;

    const jobKey = `${fileUrl}::${pageIndex}`;
    
    if (lastJob.current.key === jobKey) {
      onReady?.();
      return;
    }
    
    const cleanupMap = () => {
      const map = mapRef.current;
      if (map) {
        try { map.stop(); } catch {} 
        try { map.off(); } catch {}
        try {
          map.eachLayer((l) => {
            try { map.removeLayer(l); } catch {}
          });
        } catch {}
        try {
          if (addBtnControlRef.current) map.removeControl(addBtnControlRef.current);
        } catch {}
        try { map.remove(); } catch {}
      }
      mapRef.current = null;
      imageLayerRef.current = null;
      if (markersLayerRef.current) {
        try { markersLayerRef.current.clearLayers(); } catch {}
        markersLayerRef.current = null;
      }
      addBtnControlRef.current = null;
      initialFitDoneRef.current = false;
      userViewTouchedRef.current = false;
    };

    lastJob.current.key = jobKey;

    const cleanupPdf = async () => {
      try { renderTaskRef.current?.cancel(); } catch {}
      try { await loadingTaskRef.current?.destroy(); } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
    };
    
    (async () => {
      try {
        await cleanupPdf();
        const containerW = Math.max(320, wrapRef.current.clientWidth || 1024);
        const dpr = window.devicePixelRatio || 1;

        loadingTaskRef.current = pdfjsLib.getDocument({ ...pdfDocOpts(fileUrl) });
        const pdf = await loadingTaskRef.current.promise;
        if (cancelled) return;

        const page = await pdf.getPage(Number(pageIndex) + 1);
        const baseVp = page.getViewport({ scale: 1 });

        const targetBitmapW = Math.min(4096, Math.max(2048, Math.floor(containerW * dpr * 1.5))); 
        const safeScale = Math.min(3.0, Math.max(0.5, targetBitmapW / baseVp.width));
        const viewport = page.getViewport({ scale: safeScale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: true });

        renderTaskRef.current = page.render({ canvasContext: ctx, viewport });
        await renderTaskRef.current.promise;
        if (cancelled) return;

        const dataUrl = canvas.toDataURL("image/png");
        setImgSize({ w: canvas.width, h: canvas.height });

        const m = L.map(wrapRef.current, {
          crs: L.CRS.Simple,
          zoomControl: false,
          zoomAnimation: true,
          fadeAnimation: false,
          markerZoomAnimation: false,
          scrollWheelZoom: true,
          touchZoom: true,
          tap: true,
          preferCanvas: true,
          center: lastViewRef.current.center,
          zoom: lastViewRef.current.zoom,
        });
        L.control.zoom({ position: "topright" }).addTo(m);
        ensureAddButton(m);

        m.on("click", (e) => {
          if (!aliveRef.current) return;
          const clicked = e.containerPoint;
          const near = [];
          const pickRadius = Math.max(18, Math.floor(ICON_PX / 2) + 6);
          markersLayerRef.current?.eachLayer((mk) => {
            const mp = m.latLngToContainerPoint(mk.getLatLng());
            const dist = Math.hypot(mp.x - clicked.x, mp.y - clicked.y);
            if (dist <= pickRadius) near.push(mk.__meta);
          });
          if (near.length === 1 && onClickPoint) onClickPoint(near[0]);
          else if (near.length > 1) setPicker({ x: clicked.x, y: clicked.y, items: near });
          else setPicker(null);
        });

        m.on("zoomstart", () => { setPicker(null); userViewTouchedRef.current = true; });
        m.on("movestart", () => { setPicker(null); userViewTouchedRef.current = true; });
        m.on("zoomend", () => { lastViewRef.current.zoom = m.getZoom(); });
        m.on("moveend", () => { lastViewRef.current.center = m.getCenter(); });

        mapRef.current = m;
        const bounds = L.latLngBounds([[0, 0], [viewport.height, viewport.width]]);

        if (imageLayerRef.current) {
          try { m.removeLayer(imageLayerRef.current); } catch {}
          imageLayerRef.current = null;
        }

        const layer = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1 });
        imageLayerRef.current = layer;
        layer.addTo(m);

        await new Promise(requestAnimationFrame);
        if (cancelled) return;
        m.invalidateSize(false);

        const fitZoom = m.getBoundsZoom(bounds, true);
        m.options.zoomSnap = 0.1;
        m.options.zoomDelta = 0.5;
        m.setMinZoom(fitZoom - 1);

        if (!initialFitDoneRef.current || !userViewTouchedRef.current) {
          m.fitBounds(bounds, { padding: [8, 8] });
          lastViewRef.current.center = m.getCenter();
          lastViewRef.current.zoom = m.getZoom();
          initialFitDoneRef.current = true;
        } else {
          m.setView(lastViewRef.current.center, lastViewRef.current.zoom, { animate: false });
        }

        m.setMaxZoom(fitZoom + 6);
        m.setMaxBounds(bounds.pad(0.5));

        if (!markersLayerRef.current) {
          markersLayerRef.current = L.layerGroup().addTo(m);
        }
        
        drawMarkers(pointsRef.current, canvas.width, canvas.height);

        try { m.scrollWheelZoom.enable(); } catch {}
        try { await pdf.cleanup(); } catch {}
        onReady?.();
      } catch (e) {
        if (String(e?.name) === "RenderingCancelledException") return;
        const msg = String(e?.message || "");
        if (msg.includes("Worker was destroyed") || msg.includes("Worker was terminated")) return;
        console.error("MECA Leaflet viewer error", e);
      }
    })();

    const onResize = () => {
      const m = mapRef.current;
      const layer = imageLayerRef.current;
      if (!m || !layer) return;
      
      const keepCenter = lastViewRef.current.center;
      const keepZoom = lastViewRef.current.zoom;

      m.invalidateSize(false);

      if (!initialFitDoneRef.current) {
        const b = layer.getBounds();
        m.fitBounds(b, { padding: [8, 8] });
        initialFitDoneRef.current = true;
      } else {
        m.setView(keepCenter, keepZoom, { animate: false });
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    return () => {
      cancelled = true;
      aliveRef.current = false;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      try { renderTaskRef.current?.cancel(); } catch {}
      try { loadingTaskRef.current?.destroy(); } catch {}
      cleanupMap();
    };
  }, [fileUrl, pageIndex, disabled]);
  
  useEffect(() => {
    pointsRef.current = initialPoints;
    if (mapRef.current && imgSize.w > 0) {
      drawMarkers(initialPoints, imgSize.w, imgSize.h);
    }
  }, [initialPoints, drawMarkers, imgSize.w]);

  const adjust = () => {
    const m = mapRef.current;
    const layer = imageLayerRef.current;
    if (!m || !layer) return;
    const b = layer.getBounds();
    try { m.scrollWheelZoom?.disable(); } catch {}
    m.invalidateSize(false);
    const fitZoom = m.getBoundsZoom(b, true);
    m.setMinZoom(fitZoom - 1);
    m.fitBounds(b, { padding: [8, 8] });
    
    lastViewRef.current.center = m.getCenter();
    lastViewRef.current.zoom = m.getZoom();
    initialFitDoneRef.current = true;
    userViewTouchedRef.current = false;

    setTimeout(() => {
      try {
        m.scrollWheelZoom?.enable();
      } catch {}
    }, 50);
  };

  useImperativeHandle(ref, () => ({ 
    adjust,
    drawMarkers: (list) => drawMarkers(list, imgSize.w, imgSize.h),
  }));

  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const wrapperHeight = Math.max(320, Math.min(imgSize.h || 720, viewportH - 180));

  const onPickEquipment = useCallback((it) => {
    setPicker(null);
    onClickPoint?.(it);
  }, [onClickPoint]);

  return (
    <div className="mt-3 relative">
      <div className="flex items-center justify-end gap-2 mb-2">
        <Btn variant="ghost" aria-label="Ajuster le zoom au plan" onClick={adjust}>
          Ajuster
        </Btn>
      </div>
      <div
        ref={wrapRef}
        className="leaflet-wrapper relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
        style={{ height: wrapperHeight }}
      />
      {picker && (
        <div className="vsd-pick" style={{ left: Math.max(8, picker.x - 120), top: Math.max(8, picker.y - 8) }}>
          {picker.items.slice(0, 8).map((it) => (
            <button key={it.equipment_id} onClick={() => onPickEquipment(it)}>
              {it.name || it.equipment_id}
            </button>
          ))}
          {picker.items.length > 8 ? <div className="text-xs text-gray-500 px-1">…</div> : null}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full vsd-marker" />
          Équipement
        </span>
      </div>
    </div>
  );
});

/* ----------------------------- Map logic MECA ----------------------------- */

function useMecaMapUpdateLogic(stableSelectedPlan, viewerRef) {
  const reloadPositionsRef = useRef(null);
  const latestPositionsRef = useRef([]);

  const loadPositions = useCallback(async (plan, pageIdx = 0) => {
    if (!plan) return;
    const key = plan.id || plan.logical_name || "";
    try {
      const r = await api.mecaMaps.positionsAuto(key, pageIdx).catch(() => ({}));
      let list = Array.isArray(r?.positions)
        ? r.positions.map((item) => ({
            equipment_id: item.equipment_id,
            name: item.name || item.equipment_name,
            x_frac: Number(item.x_frac ?? item.x ?? 0),
            y_frac: Number(item.y_frac ?? item.y ?? 0),
            x: Number(item.x_frac ?? item.x ?? 0),
            y: Number(item.y_frac ?? item.y ?? 0),
            building: item.building,
            floor: item.floor,
            zone: item.zone,
          }))
        : [];

      latestPositionsRef.current = list;
      viewerRef.current?.drawMarkers(list);
    } catch (e) {
      console.error("Erreur chargement positions MECA", e);
      latestPositionsRef.current = [];
      viewerRef.current?.drawMarkers([]);
    }
  }, [viewerRef]);

  useEffect(() => {
    reloadPositionsRef.current = loadPositions;
  }, [loadPositions]);

  useEffect(() => {
    if (!stableSelectedPlan) return;
    const tick = () => reloadPositionsRef.current?.(stableSelectedPlan, 0);

    tick();

    const iv = setInterval(tick, 8000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [stableSelectedPlan]);

  const refreshPositions = useCallback((p, idx = 0) => {
    return reloadPositionsRef.current?.(p, idx);
  }, []);

  const getLatestPositions = useCallback(() => {
    return latestPositionsRef.current;
  }, []);

  return { refreshPositions, getLatestPositions };
}

/* ----------------------------- Normalisation équipement MECA ----------------------------- */

function getNormalizedEquipment(eq) {
  const base = {
    id: null,

    // Identification
    name: "",
    tag: "",
    equipment_type: "",
    category: "",
    function: "",

    // Localisation
    building: "",
    floor: "",
    zone: "",
    location: "",
    panel: "",

    // Électrique
    power_kw: null,
    voltage: "",
    current_a: null,
    speed_rpm: null,
    ip_rating: "",

    // Mécanique / process
    drive_type: "",
    coupling: "",
    mounting: "",
    fluid: "",
    flow_m3h: null,
    pressure_bar: null,

    // Fabricant
    manufacturer: "",
    model: "",
    serial_number: "",
    year: "",

    // Gestion
    status: "",
    criticality: "",
    comments: "",

    // Photo
    photo_url: eq?.photo_url || null,
  };

  const merged = { ...base, ...(eq || {}) };

  const stringFields = [
    "name",
    "tag",
    "equipment_type",
    "category",
    "function",
    "building",
    "floor",
    "zone",
    "location",
    "panel",
    "voltage",
    "ip_rating",
    "drive_type",
    "coupling",
    "mounting",
    "fluid",
    "manufacturer",
    "model",
    "serial_number",
    "year",
    "status",
    "criticality",
    "comments",
  ];

  for (const field of stringFields) {
    if (typeof merged[field] === "object" && merged[field] !== null) {
      merged[field] = merged[field].name || merged[field].id || "";
    } else if (merged[field] == null) {
      merged[field] = "";
    } else {
      merged[field] = String(merged[field]);
    }
  }

  const numericFields = ["power_kw", "current_a", "speed_rpm", "flow_m3h", "pressure_bar"];
  for (const field of numericFields) {
    if (merged[field] == null || merged[field] === "") {
      merged[field] = null;
    } else {
      const n = Number(merged[field]);
      merged[field] = Number.isNaN(n) ? null : n;
    }
  }

  return merged;
}

/* ----------------------------- Page principale MECA ----------------------------- */

export default function Meca() {
  const [tab, setTab] = useState("tree");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [zone, setZone] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const initialRef = useRef(null);

  const [files, setFiles] = useState([]);
  const [toast, setToast] = useState("");

  const [plans, setPlans] = useState([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  
  const [initialPoints, setInitialPoints] = useState([]); 
  const [pdfReady, setPdfReady] = useState(false);
  const viewerRef = useRef(null);

  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan]);

  const stableFileUrl = useMemo(() => {
    if (!stableSelectedPlan) return null;
    return api.mecaMaps.planFileUrlAuto(stableSelectedPlan, { bust: true });
  }, [stableSelectedPlan]);

  const { refreshPositions, getLatestPositions } = useMecaMapUpdateLogic(stableSelectedPlan, viewerRef);

  const debouncer = useRef(null);
  function triggerReloadDebounced() {
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(reload, 300);
  }

  function normalizeListResponse(res) {
    if (Array.isArray(res?.items)) return res.items;
    if (Array.isArray(res?.equipments)) return res.equipments;
    if (Array.isArray(res)) return res;
    return [];
  }

  async function reload() {
    setLoading(true);
    try {
      const res = await api.meca.listEquipments(); // backend simple, filtrage en front
      setItems(normalizeListResponse(res));
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function reloadFiles(equipId) {
    if (!equipId) return;
    try {
      const res = await api.meca.listFiles(equipId).catch(() => ({}));
      const arr = Array.isArray(res?.files)
        ? res.files.map((f) => ({
            id: f.id,
            name: f.original_name || f.name || f.filename || `Fichier ${f.id}`,
            mime: f.mime,
            url: f.download_url || f.inline_url || `/api/meca/files/${encodeURIComponent(f.id)}`,
          }))
        : [];
      setFiles(arr);
    } catch (e) {
      console.error(e);
      setFiles([]);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    triggerReloadDebounced();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, building, floor, zone]);

  const openEdit = useCallback(async (equipment, reloadFn) => {
    const base = getNormalizedEquipment(equipment || {});
    setEditing(base);
    initialRef.current = base;
    setDrawerOpen(true);

    if (typeof reloadFn === "function") {
      window._mecaReload = reloadFn;
    } else {
      delete window._mecaReload;
    }

    if (base?.id) {
      try {
        const res = await api.meca.getEquipment(base.id);
        const fresh = getNormalizedEquipment(res?.equipment || res || {});
        setEditing((cur) => {
          const next = { ...(cur || {}), ...fresh };
          initialRef.current = next;
          return next;
        });

        await reloadFiles(base.id);
      } catch (err) {
        console.warn("[MECA] Erreur rechargement équipement :", err);
        setFiles([]);
      }
    }
  }, []);

  function closeEdit() {
    setEditing(null);
    setFiles([]);
    delete window._mecaReload;
    setDrawerOpen(false);
    initialRef.current = null;
  }

  function isDirty() {
    if (!editing || !initialRef.current) return false;
    const A = editing;
    const B = initialRef.current;
    const keys = [
      "name",
      "tag",
      "equipment_type",
      "category",
      "function",
      "manufacturer",
      "model",
      "serial_number",
      "year",
      "voltage",
      "building",
      "floor",
      "zone",
      "location",
      "panel",
      "status",
      "criticality",
      "comments",
      "ip_rating",
      "drive_type",
      "coupling",
      "mounting",
      "fluid",
    ];

    if (keys.some((k) => String(A?.[k] ?? "") !== String(B?.[k] ?? ""))) return true;

    const numFields = ["power_kw", "current_a", "speed_rpm", "flow_m3h", "pressure_bar"];
    for (const f of numFields) {
      if (Number(A?.[f]) !== Number(B?.[f])) return true;
    }
    return false;
  }

  const dirty = isDirty();

  async function saveBase() {
    if (!editing) return;
    
    const payload = {
      name: editing.name || "",
      tag: editing.tag || "",
      equipment_type: editing.equipment_type || "",
      category: editing.category || "",
      function: editing.function || "",
      building: editing.building || "",
      floor: editing.floor || "",
      zone: editing.zone || "",
      location: editing.location || "",
      panel: editing.panel || "",
      power_kw: editing.power_kw ?? null,
      voltage: editing.voltage || "",
      current_a: editing.current_a ?? null,
      speed_rpm: editing.speed_rpm ?? null,
      ip_rating: editing.ip_rating || "",
      drive_type: editing.drive_type || "",
      coupling: editing.coupling || "",
      mounting: editing.mounting || "",
      fluid: editing.fluid || "",
      flow_m3h: editing.flow_m3h ?? null,
      pressure_bar: editing.pressure_bar ?? null,
      manufacturer: editing.manufacturer || "",
      model: editing.model || "",
      serial_number: editing.serial_number || "",
      year: editing.year || "",
      status: editing.status || "",
      criticality: editing.criticality || "",
      comments: editing.comments || "",
    };

    try {
      let updated;
      if (editing.id) {
        updated = await api.meca.updateEquipment(editing.id, payload);
      } else {
        updated = await api.meca.createEquipment(payload);
      }
      const eq = updated?.equipment || updated || null;
      if (eq?.id) {
        const fresh = getNormalizedEquipment(eq);
        setEditing((currentEditing) => {
          const merged = {
            ...(currentEditing || {}),
            ...fresh,
          };
          initialRef.current = merged;
          return merged;
        });
      }
      await reload();
      await refreshPositions(stableSelectedPlan, 0);
      setToast("Fiche enregistrée");
    } catch (e) {
      console.error("[MECA] Erreur lors de l'enregistrement :", e);
      setToast("Erreur enregistrement");
    }
  }

  async function deleteEquipment() {
    if (!editing?.id) return;
    const ok = window.confirm("Supprimer définitivement cet équipement ? Cette action est irréversible.");
    if (!ok) return;
    try {
      await api.meca.deleteEquipment(editing.id);
      closeEdit();
      await reload();
      await refreshPositions(stableSelectedPlan, 0);
      setToast("Équipement supprimé");
    } catch (e) {
      console.error(e);
      setToast("Suppression impossible");
    }
  }

  async function uploadMainPhoto(file) {
    if (!editing?.id || !file) return;
    try {
      await api.meca.uploadPhoto(editing.id, file);
      const url = api.meca.photoUrl(editing.id, { bust: true });
      setEditing((cur) => ({ ...(cur || {}), photo_url: url }));
      await reloadFiles(editing.id);
      await reload();
      setToast("Photo mise à jour");
    } catch (e) {
      console.error(e);
      setToast("Échec upload photo");
    }
  }

  async function uploadAttachments(filesArr) {
    if (!editing?.id || !filesArr?.length) return;
    try {
      await api.meca.uploadFiles(editing.id, filesArr);
      await reloadFiles(editing.id);
      setToast(filesArr.length > 1 ? "Fichiers ajoutés" : "Fichier ajouté");
    } catch (e) {
      console.error(e);
      setToast("Échec upload fichiers");
    }
  }

  async function loadPlans() {
    setMapsLoading(true);
    try {
      const r = await api.mecaMaps.listPlans();
      const planList = Array.isArray(r?.plans) ? r.plans : [];
      setPlans(planList);

      if (selectedPlan) {
        const current = planList.find((p) => p.logical_name === selectedPlan.logical_name);
        if (current) {
          setSelectedPlan(current);
          await refreshPositions(current, 0);
          setInitialPoints(getLatestPositions());
        }
      }
    } finally {
      setMapsLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "plans") loadPlans();
  }, [tab]);

  useEffect(() => {
    if (tab !== "plans" && selectedPlan) setSelectedPlan(null);
  }, [tab, selectedPlan]);

  useEffect(() => {
    if (!mapsLoading && selectedPlan && !plans.find((p) => p.logical_name === selectedPlan.logical_name)) {
      setSelectedPlan(null);
    }
  }, [plans, mapsLoading, selectedPlan]);

  // Filtrage côté front
  const filteredItems = useMemo(() => {
    const qLower = (q || "").toLowerCase();
    const b = (building || "").toLowerCase();
    const f = (floor || "").toLowerCase();
    const z = (zone || "").toLowerCase();

    return (items || []).filter((it) => {
      const matchesQ =
        !qLower ||
        [it.name, it.tag, it.manufacturer, it.model, it.equipment_type, it.category]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(qLower));

      const matchesB = !b || String(it.building || "").toLowerCase().includes(b);
      const matchesF = !f || String(it.floor || "").toLowerCase().includes(f);
      const matchesZ = !z || String(it.zone || "").toLowerCase().includes(z);

      return matchesQ && matchesB && matchesF && matchesZ;
    });
  }, [items, q, building, floor, zone]);

  const buildingTree = useMemo(() => {
    const tree = {};
    (filteredItems || []).forEach((item) => {
      const b = (item.building || "Sans bâtiment").trim();
      if (!tree[b]) tree[b] = [];
      tree[b].push(item);
    });
    return tree;
  }, [filteredItems]);
  
  const handlePdfReady = useCallback(() => setPdfReady(true), []);

  const handleMovePoint = useCallback(
    async (equipmentId, xy) => {
      if (!stableSelectedPlan) return;
      await api.mecaMaps.setPosition(equipmentId, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: 0,
        x_frac: xy.x,
        y_frac: xy.y,
      });
      await refreshPositions(stableSelectedPlan, 0);
    },
    [stableSelectedPlan, refreshPositions]
  );

  const handleClickPoint = useCallback(
    (p) => {
      openEdit({ id: p.equipment_id, name: p.name });
    },
    [openEdit]
  );

  const createEquipmentAtCenter = useCallback(async () => {
    if (!stableSelectedPlan) return;
    try {
      const payload = {
        name: "Nouvel équipement méca",
        equipment_type: "pompe",
        category: stableSelectedPlan.logical_name,
        function: "Équipement créé depuis le plan",
        comments: "Point créé sur le plan " + stableSelectedPlan.logical_name,
      };
      const created = await api.meca.createEquipment(payload);
      const id = created?.equipment?.id || created?.id;
      if (!id) throw new Error("Création MECA: ID manquant");

      await api.mecaMaps.setPosition(id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: 0,
        x_frac: 0.5,
        y_frac: 0.5,
      });

      await refreshPositions(stableSelectedPlan, 0);
      viewerRef.current?.adjust();
      setToast(`Équipement créé (« ${created?.equipment?.name || created?.name} ») au centre du plan ✅`);

      openEdit({ id, name: created?.equipment?.name || created?.name || "Nouvel équipement méca" });
    } catch (e) {
      console.error(e);
      setToast("Création impossible");
    }
  }, [stableSelectedPlan, refreshPositions, openEdit]);

  const StickyTabs = () => (
    <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2">
      <div className="flex flex-wrap gap-2">
        <Btn variant={tab === "tree" ? "primary" : "ghost"} onClick={() => setTab("tree")}>
          🏢 Arborescence
        </Btn>
        <Btn variant={tab === "plans" ? "primary" : "ghost"} onClick={() => setTab("plans")}>
          🗺️ Plans
        </Btn>
      </div>
    </div>
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      {loading && (
        <div className="fixed inset-0 bg-white/70 flex items-center justify-center z-[5000] backdrop-blur-sm">
          <div className="text-sm text-gray-600">Mise à jour en cours…</div>
        </div>
      )}

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Équipements électromécaniques</h1>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setFiltersOpen((v) => !v)}>
            {filtersOpen ? "Masquer les filtres" : "Filtres"}
          </Btn>
        </div>
      </header>

      <StickyTabs />

      {filtersOpen && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <Input value={q} onChange={setQ} placeholder="Recherche (nom / tag / type / fabricant…)" />
            <Input value={building} onChange={setBuilding} placeholder="Bâtiment" />
            <Input value={floor} onChange={setFloor} placeholder="Étage" />
            <Input value={zone} onChange={setZone} placeholder="Zone" />
          </div>
          <div className="flex gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setQ("");
                setBuilding("");
                setFloor("");
                setZone("");
              }}
            >
              Réinitialiser
            </Btn>
          </div>
          <div className="text-xs text-gray-500">Filtrage réalisé côté navigateur (aucune contrainte backend).</div>
        </div>
      )}

      {tab === "tree" && (
        <div className="space-y-4">
          {loading && <div className="bg-white rounded-2xl border shadow-sm p-4 text-gray-500">Chargement…</div>}
          {!loading && Object.keys(buildingTree).length === 0 && (
            <div className="bg-white rounded-2xl border shadow-sm p-4 text-gray-500">Aucun équipement.</div>
          )}
          {!loading &&
            Object.keys(buildingTree)
              .sort()
              .map((buildingName) => (
                <BuildingSection
                  key={buildingName}
                  buildingName={buildingName}
                  equipments={buildingTree[buildingName]}
                  onOpenEquipment={openEdit}
                />
              ))}
        </div>
      )}

      {tab === "plans" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold">Plans PDF</div>
            <MecaZipImport
              disabled={mapsLoading}
              onDone={async () => {
                setToast("Plans importés");
                await loadPlans();
              }}
            />
          </div>

          <PlanCards
            plans={plans}
            onRename={async (plan, name) => {
              await api.mecaMaps.renamePlan(plan.logical_name, name);
              await loadPlans();
            }}
            onPick={async (plan) => {
              setSelectedPlan(plan);
              setPdfReady(false);
              setInitialPoints([]);
              await refreshPositions(plan, 0);
              setInitialPoints(getLatestPositions());
            }}
          />

          {selectedPlan && (
            <div className="bg-white rounded-2xl border shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold truncate pr-3">
                  {selectedPlan.display_name || selectedPlan.logical_name}
                </div>
                <div className="flex items-center gap-2">
                  <Btn
                    variant="ghost"
                    onClick={() => {
                      setSelectedPlan(null);
                      setInitialPoints([]);
                    }}
                  >
                    Fermer le plan
                  </Btn>
                </div>
              </div>

              <div className="relative">
                {!pdfReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-[99999] pointer-events-none">
                    <div className="flex flex-col items-center gap-3 text-gray-700">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-600"></div>
                      <div className="text-sm font-medium">Chargement du plan…</div>
                    </div>
                  </div>
                )}

                <MecaLeafletViewer
                  ref={viewerRef}
                  key={selectedPlan.logical_name}
                  fileUrl={stableFileUrl}
                  pageIndex={0}
                  initialPoints={initialPoints}
                  onReady={handlePdfReady}
                  onMovePoint={handleMovePoint}
                  onClickPoint={handleClickPoint}
                  onCreatePoint={createEquipmentAtCenter}
                  disabled={false}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {drawerOpen && editing && (
        <Drawer title={`MÉCA • ${editing.name || "nouvel équipement"}`} onClose={closeEdit} dirty={dirty}>
          <div className="space-y-4">
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Photo principale</div>
                  <label className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadMainPhoto(e.target.files[0])}
                    />
                    Mettre à jour
                  </label>
                </div>
                <div className="w-40 h-40 rounded-xl border overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
                  {editing.photo_url ? (
                    <img src={api.meca.photoUrl(editing.id, { bust: true })} alt="photo" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-500 p-2 text-center">Aucune photo</span>
                  )}
                </div>
              </div>
            )}

            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Identification</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Nom">
                  <Input value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} />
                </Labeled>
                <Labeled label="Tag / Repère">
                  <Input value={editing.tag || ""} onChange={(v) => setEditing({ ...editing, tag: v })} />
                </Labeled>
                <Labeled label="Type d'équipement">
                  <Select
                    value={editing.equipment_type || ""}
                    onChange={(v) => setEditing({ ...editing, equipment_type: v })}
                    options={[
                      { value: "", label: "—" },
                      { value: "moteur", label: "Moteur" },
                      { value: "pompe", label: "Pompe" },
                      { value: "ventilateur", label: "Ventilateur" },
                      { value: "porte_auto", label: "Porte automatique" },
                      { value: "barriere", label: "Barrière d'entrée" },
                      { value: "portail", label: "Portail" },
                      { value: "autre", label: "Autre" },
                    ]}
                  />
                </Labeled>
                <Labeled label="Famille / Process">
                  <Input
                    value={editing.category || ""}
                    onChange={(v) => setEditing({ ...editing, category: v })}
                    placeholder="Pompage, Ventilation, Accès…"
                  />
                </Labeled>
                <Labeled label="Fonction (service rendu)">
                  <Input
                    value={editing.function || ""}
                    onChange={(v) => setEditing({ ...editing, function: v })}
                    placeholder="Refoulement STEP, extraction local, commande portail…"
                  />
                </Labeled>
              </div>
            </div>

            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Fabricant & plaque signalétique</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Fabricant">
                  <Input value={editing.manufacturer || ""} onChange={(v) => setEditing({ ...editing, manufacturer: v })} />
                </Labeled>
                <Labeled label="Modèle">
                  <Input value={editing.model || ""} onChange={(v) => setEditing({ ...editing, model: v })} />
                </Labeled>
                <Labeled label="Numéro de série">
                  <Input value={editing.serial_number || ""} onChange={(v) => setEditing({ ...editing, serial_number: v })} />
                </Labeled>
                <Labeled label="Année (fabrication / mise en service)">
                  <Input value={editing.year || ""} onChange={(v) => setEditing({ ...editing, year: v })} placeholder="2020…" />
                </Labeled>
              </div>
            </div>

            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Caractéristiques électriques</div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Labeled label="Puissance (kW)">
                  <Input
                    type="number"
                    step="0.1"
                    value={editing.power_kw ?? ""}
                    onChange={(v) => setEditing({ ...editing, power_kw: v === "" ? null : Number(v) })}
                  />
                </Labeled>
                <Labeled label="Courant (A)">
                  <Input
                    type="number"
                    step="0.1"
                    value={editing.current_a ?? ""}
                    onChange={(v) => setEditing({ ...editing, current_a: v === "" ? null : Number(v) })}
                  />
                </Labeled>
                <Labeled label="Tension">
                  <Input value={editing.voltage || ""} onChange={(v) => setEditing({ ...editing, voltage: v })} placeholder="400 V, 230 V…" />
                </Labeled>
                <Labeled label="Vitesse (tr/min)">
                  <Input
                    type="number"
                    step="1"
                    value={editing.speed_rpm ?? ""}
                    onChange={(v) => setEditing({ ...editing, speed_rpm: v === "" ? null : Number(v) })}
                  />
                </Labeled>
                <Labeled label="Indice IP">
                  <Input value={editing.ip_rating || ""} onChange={(v) => setEditing({ ...editing, ip_rating: v })} placeholder="IP55, IP65…" />
                </Labeled>
              </div>
            </div>

            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Caractéristiques mécaniques / process</div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Labeled label="Type d'entraînement">
                  <Input
                    value={editing.drive_type || ""}
                    onChange={(v) => setEditing({ ...editing, drive_type: v })}
                    placeholder="Direct, courroie, accouplement…"
                  />
                </Labeled>
                <Labeled label="Type d'accouplement">
                  <Input
                    value={editing.coupling || ""}
                    onChange={(v) => setEditing({ ...editing, coupling: v })}
                    placeholder="Flector, élastique…"
                  />
                </Labeled>
                <Labeled label="Montage">
                  <Input
                    value={editing.mounting || ""}
                    onChange={(v) => setEditing({ ...editing, mounting: v })}
                    placeholder="Horizontal, vertical, plafond…"
                  />
                </Labeled>
                <Labeled label="Fluide / milieu">
                  <Input
                    value={editing.fluid || ""}
                    onChange={(v) => setEditing({ ...editing, fluid: v })}
                    placeholder="Eau, air, boues, effluents…"
                  />
                </Labeled>
                <Labeled label="Débit (m³/h)">
                  <Input
                    type="number"
                    step="0.1"
                    value={editing.flow_m3h ?? ""}
                    onChange={(v) => setEditing({ ...editing, flow_m3h: v === "" ? null : Number(v) })}
                  />
                </Labeled>
                <Labeled label="Pression (bar)">
                  <Input
                    type="number"
                    step="0.01"
                    value={editing.pressure_bar ?? ""}
                    onChange={(v) => setEditing({ ...editing, pressure_bar: v === "" ? null : Number(v) })}
                  />
                </Labeled>
              </div>
            </div>

            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Localisation</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Bâtiment">
                  <Input value={editing.building || ""} onChange={(v) => setEditing({ ...editing, building: v })} />
                </Labeled>
                <Labeled label="Étage / Niveau">
                  <Input value={editing.floor || ""} onChange={(v) => setEditing({ ...editing, floor: v })} />
                </Labeled>
                <Labeled label="Zone">
                  <Input value={editing.zone || ""} onChange={(v) => setEditing({ ...editing, zone: v })} />
                </Labeled>
                <Labeled label="Local / Zone machine">
                  <Input value={editing.location || ""} onChange={(v) => setEditing({ ...editing, location: v })} />
                </Labeled>
                <Labeled label="Tableau / Coffret">
                  <Input value={editing.panel || ""} onChange={(v) => setEditing({ ...editing, panel: v })} />
                </Labeled>
              </div>
            </div>

            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Statut & Criticité</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Statut d'exploitation">
                  <Select
                    value={editing.status || ""}
                    onChange={(v) => setEditing({ ...editing, status: v })}
                    options={[
                      { value: "", label: "—" },
                      { value: "en_service", label: "En service" },
                      { value: "a_l_arret", label: "À l'arrêt" },
                      { value: "en_panne", label: "En panne" },
                      { value: "spare", label: "Spare / secours" },
                    ]}
                  />
                </Labeled>
                <Labeled label="Criticité">
                  <Select
                    value={editing.criticality || ""}
                    onChange={(v) => setEditing({ ...editing, criticality: v })}
                    options={[
                      { value: "", label: "—" },
                      { value: "critique", label: "Critique" },
                      { value: "important", label: "Important" },
                      { value: "standard", label: "Standard" },
                    ]}
                  />
                </Labeled>
              </div>
            </div>

            <div className="border rounded-2xl p-3">
              <div className="font-semibold mb-2">Commentaires</div>
              <Textarea
                rows={3}
                value={editing.comments || ""}
                onChange={(v) => setEditing({ ...editing, comments: v })}
                placeholder="Notes libres (points faibles, remarques de maintenance, accès difficiles…)"
              />
            </div>

            {editing?.id && (
              <div className="border rounded-2xl p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Pièces jointes</div>
                  <label className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => e.target.files?.length && uploadAttachments(Array.from(e.target.files))}
                    />
                    Ajouter
                  </label>
                </div>
                <div className="mt-3 space-y-2">
                  {files.length === 0 && <div className="text-xs text-gray-500">Aucune pièce jointe.</div>}
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-sm border rounded-lg px-2 py-1">
                      <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline truncate max-w-[70%]" title={f.name}>
                        {f.name}
                      </a>
                      <button
                        className="text-rose-600 hover:underline"
                        onClick={async () => {
                          await api.meca.deleteFile(f.id);
                          reloadFiles(editing.id);
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <Btn variant={dirty ? "warn" : "ghost"} className={dirty ? "animate-pulse" : ""} onClick={saveBase} disabled={!dirty}>
                {dirty ? "Enregistrer la fiche" : "Aucune modif"}
              </Btn>
              {editing?.id && (
                <Btn variant="danger" onClick={deleteEquipment}>
                  Supprimer
                </Btn>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </section>
  );
}

/* ----------------------------- Sous-composants ----------------------------- */

function BuildingSection({ buildingName, equipments = [], onOpenEquipment }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold">{buildingName}</span>
          <Badge color="blue">{equipments.length}</Badge>
        </div>
        <span className="text-gray-500">{collapsed ? "▼" : "▲"}</span>
      </button>

      {!collapsed && (
        <div className="divide-y">
          {equipments.map((eq) => (
            <div key={eq.id} className="p-4 hover:bg-gray-50 transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
                    {eq.photo_url ? (
                      <img src={api.meca.photoUrl(eq.id)} alt={eq.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] text-gray-500 p-1 text-center">
                        Photo à<br />prendre
                      </span>
                    )}
                  </div>
                  <div>
                    <button className="text-blue-700 font-semibold hover:underline" onClick={() => onOpenEquipment(eq)}>
                      {eq.name || eq.tag || "Équipement"}
                    </button>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {eq.equipment_type ? `${eq.equipment_type} • ` : ""}
                      {eq.category || ""}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {eq.floor ? `${eq.floor} • ` : ""}
                      {eq.zone ? `${eq.zone} • ` : ""}
                      {eq.location || "—"}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {eq.manufacturer || "—"} {eq.model ? `• ${eq.model}` : ""} {eq.power_kw ? `• ${eq.power_kw} kW` : ""}
                    </div>
                  </div>
                </div>
                <Btn variant="ghost" onClick={() => onOpenEquipment(eq)}>
                  Ouvrir
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MecaZipImport({ disabled, onDone }) {
  const inputRef = useRef(null);
  return (
    <div className="flex items-center gap-2">
      <Btn variant="ghost" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Import ZIP de plans
      </Btn>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            await api.mecaMaps.uploadZip(f);
            onDone?.();
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PlanCards({ plans = [], onRename, onPick }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {!plans.length && <div className="text-gray-500">Aucun plan importé.</div>}
      {plans.map((p) => (
        <PlanCard key={p.id || p.logical_name} plan={p} onRename={onRename} onPick={onPick} />
      ))}
    </div>
  );
}

function PlanCard({ plan, onRename, onPick }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(plan.display_name || plan.logical_name || "");

  return (
    <div className="border rounded-2xl bg-white shadow-sm hover:shadow transition overflow-hidden">
      <div className="relative aspect-video bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center justify-center text-gray-500">
          <div className="text-4xl leading-none">PDF</div>
          <div className="text-[11px] mt-1">Plan méca</div>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs px-2 py-1 truncate text-center">{name}</div>
      </div>
      <div className="p-3">
        {!edit ? (
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate" title={name}>
              {name || "—"}
            </div>
            <div className="flex items-center gap-1">
              <Btn variant="ghost" aria-label="Renommer le plan" onClick={() => setEdit(true)}>
                ✏️
              </Btn>
              <Btn variant="subtle" onClick={() => onPick(plan)}>
                Ouvrir
              </Btn>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input value={name} onChange={setName} />
            <Btn
              variant="subtle"
              onClick={async () => {
                await onRename(plan, (name || "").trim());
                setEdit(false);
              }}
            >
              OK
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                setName(plan.display_name || plan.logical_name || "");
                setEdit(false);
              }}
            >
              Annuler
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
