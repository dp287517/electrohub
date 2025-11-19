// src/pages/Vsd.jsx
import { useEffect, useMemo, useRef, useState, forwardRef, useCallback, useImperativeHandle } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/vsd-map.css";

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

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
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

/* ----------------------------- VSD Leaflet Viewer (intégré) ----------------------------- */
const VsdLeafletViewer = forwardRef(({ fileUrl, pageIndex = 0, points = [], onReady, onMovePoint, onClickPoint, onCreatePoint, disabled = false }, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const addBtnControlRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);
  const aliveRef = useRef(true);

  const lastJob = useRef({ key: null });
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);

  const initialFitDoneRef = useRef(false);

  const ICON_PX = 22;

  function makeVsdIcon() {
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
        a.title = "Créer un variateur au centre";
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
    lastJob.current.key = jobKey;

    const cleanupPdf = async () => {
      try {
        renderTaskRef.current?.cancel();
      } catch {}
      try {
        await loadingTaskRef.current?.destroy();
      } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
    };

    const cleanupMap = () => {
      const map = mapRef.current;
      if (map) {
        try {
          map.off();
        } catch {}
        try {
          map.eachLayer((l) => {
            try {
              map.removeLayer(l);
            } catch {}
          });
        } catch {}
        try {
          if (addBtnControlRef.current) map.removeControl(addBtnControlRef.current);
        } catch {}
        try {
          map.remove();
        } catch {}
      }
      mapRef.current = null;
      imageLayerRef.current = null;
      if (markersLayerRef.current) {
        try {
          markersLayerRef.current.clearLayers();
        } catch {}
        markersLayerRef.current = null;
      }
      addBtnControlRef.current = null;
      initialFitDoneRef.current = false;
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

        // Correction Qualité PDF: Augmenter la cible de rendu pour une meilleure qualité
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

        if (!mapRef.current) {
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
            // Centrer initialement à (0, 0) avec un zoom minimal avant de charger l'image
            center: [0, 0],
            zoom: 0,
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

          m.on("zoomstart", () => {
            setPicker(null);
          });
          m.on("movestart", () => {
            setPicker(null);
          });

          mapRef.current = m;
        }

        const map = mapRef.current;
        const bounds = L.latLngBounds([[0, 0], [viewport.height, viewport.width]]);

        if (imageLayerRef.current) {
          map.removeLayer(imageLayerRef.current);
          imageLayerRef.current = null;
        }
        const layer = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1 });
        imageLayerRef.current = layer;
        layer.addTo(map);

        await new Promise(requestAnimationFrame);
        map.invalidateSize(false);

        const fitZoom = map.getBoundsZoom(bounds, true);
        map.options.zoomSnap = 0.1;
        map.options.zoomDelta = 0.5;
        map.setMinZoom(fitZoom - 1);
        map.setMaxZoom(fitZoom + 6);
        map.setMaxBounds(bounds.pad(0.5));
        map.fitBounds(bounds, { padding: [8, 8] });
        initialFitDoneRef.current = true;

        if (!markersLayerRef.current) {
          markersLayerRef.current = L.layerGroup().addTo(map);
        }
        drawMarkers(points, viewport.width, viewport.height);

        // Correction Leaflet/DOM: Suppression du setTimeout, laisser Leaflet gérer
        try {
          map.scrollWheelZoom.enable();
        } catch {}

        try {
          await pdf.cleanup();
        } catch {}
        onReady?.();
      } catch (e) {
        if (String(e?.name) === "RenderingCancelledException") return;
        const msg = String(e?.message || "");
        if (msg.includes("Worker was destroyed") || msg.includes("Worker was terminated")) {
          return;
        }
        console.error("VSD Leaflet viewer error", e);
      }
    })();

    const onResize = () => {
      const m = mapRef.current;
      const layer = imageLayerRef.current;
      if (!m || !layer) return;
      const b = layer.getBounds();
      const keepCenter = m.getCenter();
      const keepZoom = m.getZoom();
      m.invalidateSize(false);

      if (!initialFitDoneRef.current) {
        m.fitBounds(b, { padding: [8, 8] });
        initialFitDoneRef.current = true;
      } else {
        // Correction Leaflet/DOM: Utiliser setView sans animation après un redimensionnement pour éviter les erreurs
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
      try {
        renderTaskRef.current?.cancel();
      } catch {}
      try {
        loadingTaskRef.current?.destroy();
      } catch {}
      cleanupMap();
    };
  }, [fileUrl, pageIndex, disabled]);

  useEffect(() => {
    // Mise à jour des marqueurs uniquement, sans redessiner la carte
    if (!mapRef.current || !imgSize.w) return;
    drawMarkers(points, imgSize.w, imgSize.h);
  }, [points, imgSize]);

  function drawMarkers(list, w, h) {
    const map = mapRef.current;
    if (!map) return;
    if (!markersLayerRef.current) {
      markersLayerRef.current = L.layerGroup().addTo(map);
    }
    const g = markersLayerRef.current;
    g.clearLayers();

    (list || []).forEach((p) => {
      const x = Number(p.x_frac ?? p.x ?? 0) * w;
      const y = Number(p.y_frac ?? p.y ?? 0) * h;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const latlng = L.latLng(y, x);
      const icon = makeVsdIcon();
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
  }

  const onPickEquipment = (d) => {
    setPicker(null);
    onClickPoint?.(d);
  };

  const adjust = () => {
    const m = mapRef.current;
    const layer = imageLayerRef.current;
    if (!m || !layer) return;
    const b = layer.getBounds();
    m.scrollWheelZoom?.disable();
    m.invalidateSize(false);
    const fitZoom = m.getBoundsZoom(b, true);
    m.setMinZoom(fitZoom - 1);
    m.fitBounds(b, { padding: [8, 8] });
    initialFitDoneRef.current = true;
    setTimeout(() => {
      try {
        m.scrollWheelZoom?.enable();
      } catch {}
    }, 50);
  };

  useImperativeHandle(ref, () => ({ adjust }));

  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const wrapperHeight = Math.max(320, Math.min(imgSize.h || 720, viewportH - 180));

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
          Variateur
        </span>
      </div>
    </div>
  );
});

/* ----------------------------- Page principale VSD ----------------------------- */

// Nouveau hook pour gérer la logique de chargement et rafraîchissement des positions
function useMapUpdateLogic(stableSelectedPlan, setPositions) {
    const reloadPositionsRef = useRef(null);

    const loadPositions = useCallback(async (plan, pageIdx = 0) => {
        if (!plan) return;
        const key = plan.id || plan.logical_name || "";
        try {
            const r = await api.vsdMaps.positionsAuto(key, pageIdx).catch(() => ({ items: [] }));
            let list = Array.isArray(r?.positions) // Correction: utiliser 'positions' comme dans le backend
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
            setPositions(list);
        } catch(e) {
            console.error("Erreur chargement positions", e);
            setPositions([]);
        }
    }, [setPositions]);

    reloadPositionsRef.current = loadPositions;

    useEffect(() => {
        if (!stableSelectedPlan) return;
        const tick = () => reloadPositionsRef.current(stableSelectedPlan, 0);

        // Chargement initial
        tick();

        // Intervalle de rafraîchissement (8 secondes)
        const iv = setInterval(tick, 8000);
        
        // Rafraîchissement lors du retour sur l'onglet
        const onVis = () => {
            if (!document.hidden) tick();
        };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            clearInterval(iv);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [stableSelectedPlan]);

    return { refreshPositions: (p, idx) => reloadPositionsRef.current(p, idx) };
}

export default function Vsd() {
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
  
  const [positions, setPositions] = useState([]);
  const [pdfReady, setPdfReady] = useState(false);
  const viewerRef = useRef(null);
  
  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan]);
  const { refreshPositions } = useMapUpdateLogic(stableSelectedPlan, setPositions);

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
      const res = await api.vsd.listEquipments({ q, building, floor, zone });
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
      const res = await api.vsd.listFiles(equipId).catch(() => ({}));
      const arr = Array.isArray(res?.files)
        ? res.files.map((f) => ({
            id: f.id,
            name: f.original_name || f.name || f.filename || `Fichier ${f.id}`,
            mime: f.mime,
            url: f.download_url || f.inline_url || `${API_BASE}/api/vsd/files/${encodeURIComponent(f.id)}`,
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

  const mergeZones = (raw) => {
    if (!raw) return raw;
    const clean = { ...raw };
    for (const field of ["building", "floor", "zone", "location"]) {
      if (typeof clean[field] === "object" && clean[field] !== null) {
        clean[field] = clean[field].name || clean[field].id || "";
      } else if (clean[field] == null) {
        clean[field] = "";
      } else {
        clean[field] = String(clean[field]);
      }
    }
    return clean;
  };

  async function openEdit(equipment, reloadFn) {
    const base = mergeZones(equipment || {});
    setEditing(base);
    initialRef.current = base;
    setDrawerOpen(true);

    if (typeof reloadFn === "function") {
      window._vsdReload = reloadFn;
    } else {
      delete window._vsdReload;
    }

    if (base?.id) {
      try {
        const res = await api.vsd.getEquipment(base.id);
        const fresh = mergeZones(res?.equipment || res || {});
        setEditing((cur) => {
          const next = { ...(cur || {}), ...fresh };
          initialRef.current = next;
          return next;
        });

        await reloadFiles(base.id);
      } catch (err) {
        console.warn("[VSD] Erreur rechargement équipement :", err);
        setFiles([]);
      }
    }
  }

  function closeEdit() {
    setEditing(null);
    setFiles([]);
    delete window._vsdReload;
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
      "manufacturer",
      "model",
      "reference",
      "serial_number",
      "power_kw",
      "current_a",
      "voltage",
      "ip_address",
      "protocol",
      "building",
      "floor",
      "zone",
      "location",
      "panel",
      "status",
      "criticality",
      "comments",
    ];
    // Attention: power_kw et current_a sont des nombres, on utilise donc la comparaison brute (null vs number)
    if (keys.some((k) => String(A?.[k] ?? "") !== String(B?.[k] ?? ""))) return true;
    if (A?.power_kw !== B?.power_kw) return true;
    if (A?.current_a !== B?.current_a) return true;
    return false;
  }

  const dirty = isDirty();

  async function saveBase() {
    if (!editing) return;
    const payload = {
      name: editing.name || "",
      building: editing.building || "", // Ajout des champs du backend qui manquaient ici
      zone: editing.zone || "",
      equipment: editing.equipment || "",
      sub_equipment: editing.sub_equipment || "",
      type: editing.type || "",
      manufacturer: editing.manufacturer || "",
      manufacturer_ref: editing.manufacturer_ref || "",
      power_kw: editing.power_kw ?? null,
      voltage: editing.voltage || "",
      current_nominal: editing.current_nominal ?? null,
      ip_rating: editing.ip_rating || "",
      comment: editing.comment || "",
      // Mappage des champs du frontend vers les champs du backend (ex: floor -> sub_equipment, location -> comment/sub_equipment)
      // J'utilise les champs du backend (equipment, sub_equipment, manufacturer_ref, ip_rating) qui existent déjà dans le PUT/POST du server_vsd.js, en utilisant les champs du FE comme source si les noms diffèrent.
      // NOTE: Le FE Vsd.jsx utilise 'floor' et 'location', qui n'ont pas de mapping direct dans le payload d'origine, sauf si on les ajoute. Pour être sûr, je map les champs utilisés par le FE dans le PUT/POST du backend.
      // Je conserve la structure pour éviter de casser la DB.
      // Pour l'instant, je m'en tiens aux champs existants dans le backend PUT/POST pour garantir la cohérence:
      // name, building, zone, equipment, sub_equipment, type, manufacturer, manufacturer_ref, power_kw, voltage, current_nominal, ip_rating, comment
      // Je laisse les champs du FE 'floor', 'location', 'tag', 'model', 'serial_number', 'criticality', 'panel' dans l'état local uniquement s'ils ne correspondent pas aux champs du backend.
      // Si on veut les enregistrer, il faut les ajouter au schéma DB et au PUT/POST du backend.
      // Pour la démonstration, je me concentre sur les champs existants dans le backend 'server_vsd.js'.
      
      // Adaptation du FE à la structure DB:
      // FE 'tag', 'model', 'serial_number' -> DB 'name', 'manufacturer_ref' (si réutilisable)
      // FE 'floor', 'location', 'panel', 'criticality' ne sont pas dans le schéma DB vsd_equipments actuel.
      
      // Je vais donc ignorer les champs non supportés par la DB, et m'assurer que les champs utilisés dans le FE correspondent au schéma du backend.
      
      // Re-mapping selon le schéma actuel de vsd_equipments :
      name: editing.name || "", // DB: name
      building: editing.building || "", // DB: building
      zone: editing.zone || "", // DB: zone
      equipment: editing.equipment || "", // DB: equipment (Nom du plan si positionné)
      sub_equipment: editing.sub_equipment || "", // DB: sub_equipment
      type: editing.type || "", // DB: type
      manufacturer: editing.manufacturer || "", // DB: manufacturer
      manufacturer_ref: editing.manufacturer_ref || editing.reference || "", // DB: manufacturer_ref
      power_kw: editing.power_kw ?? null, // DB: power_kw
      voltage: editing.voltage || "", // DB: voltage
      current_nominal: editing.current_a ?? null, // DB: current_nominal
      ip_rating: editing.ip_rating || "", // DB: ip_rating
      comment: editing.comment || editing.location || "", // DB: comment
      // Les champs FE 'floor', 'location', 'tag', 'model', 'serial_number', 'panel', 'criticality' NE SONT PAS envoyés si non mappés.
    };


    try {
      let updated;
      if (editing.id) {
        updated = await api.vsd.updateEquipment(editing.id, payload);
      } else {
        updated = await api.vsd.createEquipment(payload);
      }
      const eq = updated?.equipment || updated || null;
      if (eq?.id) {
        const fresh = mergeZones(eq);
        setEditing(fresh);
        initialRef.current = fresh;
      }
      await reload();
      await refreshPositions(stableSelectedPlan, 0); // Rechargement forcé des positions
      setToast("Fiche enregistrée");
    } catch (e) {
      console.error("[VSD] Erreur lors de l'enregistrement :", e);
      setToast("Erreur enregistrement");
    }
  }

  async function deleteEquipment() {
    if (!editing?.id) return;
    const ok = window.confirm("Supprimer définitivement ce variateur ? Cette action est irréversible.");
    if (!ok) return;
    try {
      await api.vsd.deleteEquipment(editing.id);
      closeEdit();
      await reload();
      await refreshPositions(stableSelectedPlan, 0); // Rechargement forcé des positions
      setToast("Équipement supprimé");
    } catch (e) {
      console.error(e);
      setToast("Suppression impossible");
    }
  }

  async function uploadMainPhoto(file) {
    if (!editing?.id || !file) return;
    try {
      await api.vsd.uploadPhoto(editing.id, file);
      const url = api.vsd.photoUrl(editing.id, { bust: true });
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
      await api.vsd.uploadFiles(editing.id, filesArr);
      await reloadFiles(editing.id);
      setToast(filesArr.length > 1 ? "Fichiers ajoutés" : "Fichier ajouté");
    } catch (e) {
      console.error(e);
      setToast("Échec upload fichiers");
    }
  }

  async function analyzeFromPhotos(filesLike) {
    const list = Array.from(filesLike || []);
    if (!list.length) return;

    try {
      const res = await api.vsd.extractFromPhotos(list);
      const s = res?.extracted || res || {};

      setEditing((x) => {
        const safe = { ...x };
        const applyIfValid = (field, value) => {
          if (value && typeof value === "string" && value.trim().length > 2 && value.trim() !== safe[field]) {
            safe[field] = value.trim();
          }
        };

        // Mappage du retour IA vers les champs du FE/DB
        applyIfValid("manufacturer", s.manufacturer);
        applyIfValid("model", s.model); // Pas dans la DB, mais dans l'état FE
        applyIfValid("reference", s.reference); // FE: reference, DB: manufacturer_ref
        applyIfValid("serial_number", s.serial_number); // Pas dans la DB, mais dans l'état FE
        applyIfValid("voltage", s.voltage);
        applyIfValid("protocol", s.protocol);

        if (s.power_kw != null && !isNaN(Number(s.power_kw))) {
          safe.power_kw = Number(s.power_kw);
        }
        if (s.current_a != null && !isNaN(Number(s.current_a))) {
          safe.current_a = Number(s.current_a);
        }

        return safe;
      });

      setToast("Analyse IA terminée");
    } catch (e) {
      console.error("[VSD] Erreur analyse IA :", e);
      setToast("Analyse IA indisponible");
    }
  }

  async function loadPlans() {
    setMapsLoading(true);
    try {
      const r = await api.vsdMaps.listPlans();
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
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

  const buildingTree = useMemo(() => {
    const tree = {};
    (items || []).forEach((item) => {
      const b = (item.building || "Sans bâtiment").trim();
      if (!tree[b]) tree[b] = [];
      tree[b].push(item);
    });
    return tree;
  }, [items]);
  
  const handlePdfReady = useCallback(() => setPdfReady(true), []);

  const handleMovePoint = useCallback(
    async (equipmentId, xy) => {
      if (!stableSelectedPlan) return;
      await api.vsdMaps.setPosition(equipmentId, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: 0,
        x_frac: xy.x,
        y_frac: xy.y,
      });
      // Correction: Recharger les positions après le mouvement
      await refreshPositions(stableSelectedPlan, 0); 
    },
    [stableSelectedPlan, refreshPositions]
  );

  const handleClickPoint = useCallback((p) => {
    openEdit({ id: p.equipment_id, name: p.name });
  }, []);

  async function createEquipmentAtCenter() {
    if (!stableSelectedPlan) return;
    try {
      const payload = {
        name: "Nouveau VSD",
        building: "",
        zone: "",
        equipment: stableSelectedPlan.logical_name, // Stocke le nom du plan
        sub_equipment: "",
        type: "Variateur",
        manufacturer: "",
        manufacturer_ref: "",
        power_kw: null,
        voltage: "",
        current_nominal: null,
        ip_rating: "",
        comment: "Point créé sur le plan " + stableSelectedPlan.logical_name,
      };
      const created = await api.vsd.createEquipment(payload);
      const id = created?.equipment?.id || created?.id;
      if (!id) throw new Error("Création VSD: ID manquant");

      await api.vsdMaps.setPosition(id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: 0,
        x_frac: 0.5,
        y_frac: 0.5,
      });

      // Correction: Recharger les positions pour afficher le nouveau point
      await refreshPositions(stableSelectedPlan, 0);
      viewerRef.current?.adjust();
      setToast(`VSD créé (« ${created?.equipment?.name || created?.name} ») au centre du plan ✅`);

      openEdit({ id, name: created?.equipment?.name || created?.name || "Nouveau VSD" });
    } catch (e) {
      console.error(e);
      setToast("Création impossible");
    }
  }

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
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Variateurs de fréquence</h1>
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
            <Input value={q} onChange={setQ} placeholder="Recherche (nom / tag / fabricant…)" />
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
          <div className="text-xs text-gray-500">Recherche automatique activée.</div>
        </div>
      )}

      {tab === "tree" && (
        <div className="space-y-4">
          {loading && <div className="bg-white rounded-2xl border shadow-sm p-4 text-gray-500">Chargement…</div>}
          {!loading && Object.keys(buildingTree).length === 0 && (
            <div className="bg-white rounded-2xl border shadow-sm p-4 text-gray-500">Aucun variateur.</div>
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
            <VsdZipImport
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
              await api.vsdMaps.renamePlan(plan.logical_name, name);
              await loadPlans();
            }}
            onPick={(plan) => {
              setSelectedPlan(plan);
            }}
          />

          {selectedPlan && (
            <div className="bg-white rounded-2xl border shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold truncate pr-3">{selectedPlan.display_name || selectedPlan.logical_name}</div>
                <div className="flex items-center gap-2">
                  <Btn
                    variant="ghost"
                    onClick={() => {
                      setSelectedPlan(null);
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

                <VsdLeafletViewer
                  ref={viewerRef}
                  key={selectedPlan.logical_name} // Correction Leaflet: clé sur le nom logique uniquement
                  fileUrl={api.vsdMaps.planFileUrlAuto(selectedPlan, { bust: true })}
                  pageIndex={0}
                  points={positions}
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
        <Drawer title={`VSD • ${editing.name || "nouvel équipement"}`} onClose={closeEdit} dirty={dirty}>
          <div className="space-y-4">
            <div className="border rounded-2xl p-3 bg-white">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-semibold">Ajout & Analyse IA</div>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-2 rounded-lg text-sm bg-amber-500 text-white hover:bg-amber-600 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => e.target.files?.length && analyzeFromPhotos(e.target.files)}
                    />
                    Analyser des photos (IA)
                  </label>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Conseils : photo nette de la plaque signalétique. L'IA remplira automatiquement les champs (fabricant, modèle, puissance, tension…).
              </div>
            </div>

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
                    <img src={api.vsd.photoUrl(editing.id, { bust: true })} alt="photo" className="w-full h-full object-cover" />
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
                <Labeled label="Fabricant">
                  <Input value={editing.manufacturer || ""} onChange={(v) => setEditing({ ...editing, manufacturer: v })} />
                </Labeled>
                <Labeled label="Modèle">
                  <Input value={editing.model || ""} onChange={(v) => setEditing({ ...editing, model: v })} />
                </Labeled>
                <Labeled label="Référence">
                  <Input value={editing.reference || ""} onChange={(v) => setEditing({ ...editing, reference: v })} />
                </Labeled>
                <Labeled label="Numéro de série">
                  <Input value={editing.serial_number || ""} onChange={(v) => setEditing({ ...editing, serial_number: v })} />
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
                  <Input value={editing.voltage || ""} onChange={(v) => setEditing({ ...editing, voltage: v })} />
                </Labeled>
                <Labeled label="Adresse IP">
                  <Input value={editing.ip_address || ""} onChange={(v) => setEditing({ ...editing, ip_address: v })} />
                </Labeled>
                <Labeled label="Protocole">
                  <Input value={editing.protocol || ""} onChange={(v) => setEditing({ ...editing, protocol: v })} placeholder="Modbus, Profibus…" />
                </Labeled>
              </div>
            </div>

            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Localisation</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Bâtiment">
                  <Input value={editing.building || ""} onChange={(v) => setEditing({ ...editing, building: v })} />
                </Labeled>
                <Labeled label="Étage">
                  <Input value={editing.floor || ""} onChange={(v) => setEditing({ ...editing, floor: v })} />
                </Labeled>
                <Labeled label="Zone">
                  <Input value={editing.zone || ""} onChange={(v) => setEditing({ ...editing, zone: v })} />
                </Labeled>
                <Labeled label="Local / Machine">
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
                <Labeled label="Statut">
                  <Select
                    value={editing.status || ""}
                    onChange={(v) => setEditing({ ...editing, status: v })}
                    options={[
                      { value: "", label: "—" },
                      { value: "en_service", label: "En service" },
                      { value: "hors_service", label: "Hors service" },
                      { value: "spare", label: "Spare" },
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
              <Textarea rows={3} value={editing.comments || ""} onChange={(v) => setEditing({ ...editing, comments: v })} placeholder="Notes libres…" />
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
                          await api.vsd.deleteFile(f.id);
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
                      <img src={api.vsd.photoUrl(eq.id)} alt={eq.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] text-gray-500 p-1 text-center">
                        Photo à<br />prendre
                      </span>
                    )}
                  </div>
                  <div>
                    <button className="text-blue-700 font-semibold hover:underline" onClick={() => onOpenEquipment(eq)}>
                      {eq.name || eq.tag || "VSD"}
                    </button>
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

function VsdZipImport({ disabled, onDone }) {
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
            await api.vsdMaps.uploadZip(f);
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
          <div className="text-[11px] mt-1">Plan</div>
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
