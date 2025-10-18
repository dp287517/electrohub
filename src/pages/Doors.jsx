import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import dayjs from "dayjs";
import 'dayjs/locale/fr';
dayjs.locale('fr');
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from 'leaflet';
import '../styles/doors-map.css';
import { api } from '../lib/api.js';
/* >>> PDF.js (local via pdfjs-dist, plus de CDN) */
// >>> worker unique, partagé par toute l’app :
const _sharedPdfWorker = new pdfjsLib.PDFWorker({ name: "doors-pdf-worker", port: null, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerPort = _sharedPdfWorker.port;
// (ne plus utiliser workerSrc ici)
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);
/* ----------------------------- Utils ----------------------------- */
function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function getIdentity() {
  let email = getCookie("email") || null;
  let name = getCookie("name") || null;
  try {
    if (!email) email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    if (!name) {
      name = localStorage.getItem("name") || localStorage.getItem("user.name") || null;
    }
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
    if (base) {
      name = base.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    }
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
function withHeaders(extra = {}) {
  return { credentials: "include", headers: { ...userHeaders(), ...extra } };
}
/* 🔸 Hook utilitaire mobile */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 640;
  });
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}
/* ----------------------------- API (Doors) ----------------------------- */
const API = {
  list: async (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    const r = await fetch(`/api/doors/doors${qs ? `?${qs}` : ""}`, withHeaders());
    return r.json();
  },
  get: async (id) => (await fetch(`/api/doors/doors/${id}`, withHeaders())).json(),
  create: async (payload) => {
    const r = await fetch(`/api/doors/doors`, {
      method: "POST",
      ...withHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const msg = data?.error || data?.message || `HTTP ${r.status}`;
      throw new Error(`Création de porte: ${msg}`);
    }
    return data;
  },
  update: async (id, payload) =>
    (
      await fetch(`/api/doors/doors/${id}`, {
        method: "PUT",
        ...withHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      })
    ).json(),
  remove: async (id) =>
    (await fetch(`/api/doors/doors/${id}`, { method: "DELETE", ...withHeaders() })).json(),
  startCheck: async (doorId) => {
    const id = getIdentity();
    return (
      await fetch(`/api/doors/doors/${doorId}/checks`, {
        method: "POST",
        ...withHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ _user: id }),
      })
    ).json();
  },
  saveCheck: async (doorId, checkId, payload) => {
    const id = getIdentity();
    if (payload?.files?.length) {
      const fd = new FormData();
      fd.append("items", JSON.stringify(payload.items || []));
      if (payload.close) fd.append("close", "true");
      if (id.email) fd.append("user_email", id.email);
      if (id.name) fd.append("user_name", id.name);
      for (const f of payload.files) fd.append("files", f);
      const r = await fetch(`/api/doors/doors/${doorId}/checks/${checkId}`, {
        method: "PUT",
        credentials: "include",
        headers: userHeaders(),
        body: fd,
      });
      return r.json();
    }
    return (
      await fetch(`/api/doors/doors/${doorId}/checks/${checkId}`, {
        method: "PUT",
        ...withHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ ...payload, _user: id }),
      })
    ).json();
  },
  listHistory: async (doorId) =>
    (await fetch(`/api/doors/doors/${doorId}/history`, withHeaders())).json(),
  listFiles: async (doorId) =>
    (await fetch(`/api/doors/doors/${doorId}/files`, withHeaders())).json(),
  uploadFile: async (doorId, file) => {
    const id = getIdentity();
    const fd = new FormData();
    fd.append("file", file);
    if (id.email) fd.append("user_email", id.email);
    if (id.name) fd.append("user_name", id.name);
    const r = await fetch(`/api/doors/doors/${doorId}/files`, {
      method: "POST",
      credentials: "include",
      headers: userHeaders(),
      body: fd,
    });
    return r.json();
  },
  deleteFile: async (fileId) =>
    (await fetch(`/api/doors/files/${fileId}`, { method: "DELETE", ...withHeaders() })).json(),
  uploadPhoto: async (doorId, file) => {
    const id = getIdentity();
    const fd = new FormData();
    fd.append("photo", file);
    if (id.email) fd.append("user_email", id.email);
    if (id.name) fd.append("user_name", id.name);
    const r = await fetch(`/api/doors/doors/${doorId}/photo`, {
      method: "POST",
      credentials: "include",
      headers: userHeaders(),
      body: fd,
    });
    return r.json();
  },
  photoUrl: (doorId) => `/api/doors/doors/${doorId}/photo`,
  qrUrl: (doorId, size = 256) => `/api/doors/doors/${doorId}/qrcode?size=${size}`,
  qrcodesPdf: (doorId, sizes = "80,120,200", force = false) =>
    `/api/doors/doors/${doorId}/qrcodes.pdf?sizes=${encodeURIComponent(sizes)}${force ? "&force=1" : ""}`,
  calendar: async () => (await fetch(`/api/doors/calendar`, withHeaders())).json(),
  settingsGet: async () => (await fetch(`/api/doors/settings`, withHeaders())).json(),
  settingsSet: async (payload) =>
    (
      await fetch(`/api/doors/settings`, {
        method: "PUT",
        ...withHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      })
    ).json(),
  nonConformPDF: (doorId) => `/api/doors/doors/${doorId}/nonconformities.pdf`,
};
function pdfDocOpts(url) {
  return { url, withCredentials: true, httpHeaders: userHeaders() };
}
/* ----------------------------- UI helpers ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-200 shadow-sm",
    ghost: "bg-white text-black border hover:bg-gray-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    warn: "bg-amber-500 text-white hover:bg-amber-600",
    subtle: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
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
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Textarea({ value, onChange, className = "", ...p }) {
  return (
    <textarea
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black placeholder-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Select({ value, onChange, options = [], className = "", placeholder }) {
  return (
    <select
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
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
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color]} ${className}`}>
      {children}
    </span>
  );
}
const STATUS = {
  A_FAIRE: "a_faire",
  EN_COURS: "en_cours_30",
  EN_RETARD: "en_retard",
  FAIT: "fait",
};
function statusColor(s) {
  if (s === STATUS.A_FAIRE) return "green";
  if (s === STATUS.EN_COURS) return "orange";
  if (s === STATUS.EN_RETARD) return "red";
  if (s === STATUS.FAIT) return "blue";
  return "gray";
}
function statusLabel(s) {
  if (s === STATUS.A_FAIRE) return "À faire";
  if (s === STATUS.EN_COURS) return "En cours (<30j)";
  if (s === STATUS.EN_RETARD) return "En retard";
  if (s === STATUS.FAIT) return "Fait";
  return s || "—";
}
function doorStateBadge(state) {
  if (state === "conforme") return <Badge color="green">Conforme</Badge>;
  if (state === "non_conforme") return <Badge color="red">Non conforme</Badge>;
  return <Badge>—</Badge>;
}
/* ----------------------------- Toast ----------------------------- */
function Toast({ text, onClose }) {
  useEffect(() => {
    const t = setTimeout(() => onClose && onClose(), 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">
        {text}
      </div>
    </div>
  );
}
/* ----------------------------- Calendrier (mois) ----------------------------- */
function MonthCalendar({ events = [], onDayClick }) {
  const [month, setMonth] = useState(dayjs());
  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) {
      const key = e.date || e.next_check_date || e.due_date;
      if (!key) continue;
      const iso = dayjs(key).format("YYYY-MM-DD");
      (map[iso] ||= []).push(e);
    }
    return map;
  }, [events]);
  const startOfMonth = month.startOf("month").toDate();
  const endOfMonth = month.endOf("month").toDate();
  const startDow = (startOfMonth.getDay() + 6) % 7; // lundi=0
  const gridStart = new Date(startOfMonth);
  gridStart.setDate(gridStart.getDate() - startDow);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = dayjs(d).format("YYYY-MM-DD");
    days.push({ d, iso, inMonth: d >= startOfMonth && d <= endOfMonth });
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-lg font-semibold">{month.format("MMMM YYYY")}</div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setMonth((m) => m.subtract(1, "month"))}>← Préc.</Btn>
          <Btn variant="ghost" onClick={() => setMonth(dayjs())}>Aujourd'hui</Btn>
          <Btn variant="ghost" onClick={() => setMonth((m) => m.add(1, "month"))}>Suiv. →</Btn>
        </div>
      </div>
      <div className="grid grid-cols-7 text-xs font-medium text-gray-500">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((l) => (
          <div key={l} className="px-2 py-2">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border rounded-2xl overflow-hidden">
        {days.map(({ d, iso, inMonth }) => {
          const list = eventsByDate[iso] || [];
          const clickable = list.length > 0;
          return (
            <button
              key={iso}
              onClick={() => clickable && onDayClick && onDayClick({ date: iso, events: list })}
              className={`min-h-[96px] p-2 border-t border-l last:border-r text-left transition ${
                inMonth ? "bg-white" : "bg-gray-50"
              } ${clickable ? "hover:bg-blue-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className={`text-xs ${inMonth ? "text-gray-700" : "text-gray-400"}`}>{dayjs(d).format("D")}</div>
                {!!list.length && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    {list.length}
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {list.slice(0, 3).map((e, i) => (
                  <div
                    key={i}
                    className={`truncate text-[11px] px-1.5 py-0.5 rounded ${
                      e.status === STATUS.EN_RETARD
                        ? "bg-rose-50 text-rose-700"
                        : e.status === STATUS.EN_COURS
                        ? "bg-amber-50 text-amber-700"
                        : e.status === STATUS.A_FAIRE
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {e.door_name}
                  </div>
                ))}
                {list.length > 3 && (
                  <div className="text-[11px] text-gray-500">+{list.length - 3} de plus…</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
/* ----------------------------- MAPS components ----------------------------- */
function PlansHeader({ mapsLoading, onUploadZip }) {
  const inputRef = useRef(null);
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between flex-wrap gap-2">
      <div className="font-semibold">Plans PDF</div>
      <div className="flex items-center gap-2">
        <Btn variant="ghost" onClick={() => inputRef.current?.click()} disabled={mapsLoading}>
          📦 Import ZIP de plans
        </Btn>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadZip(f);
            e.target.value = "";
          }}
        />
      </div>
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
  const next30 = Number(plan?.actions_next_30 || 0);
  const overdue = Number(plan?.overdue || 0);
  const canvasRef = useRef(null);
  const [thumbErr, setThumbErr] = useState("");
  const [visible, setVisible] = useState(false);
  const obsRef = useRef(null);
  const isMobile = useIsMobile();
  useEffect(() => {
    const el = obsRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setVisible(true); });
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (isMobile) return;
    if (!visible) return;
    let cancelled = false;
    let pdf = null;
    let renderTask = null;
    let loadingTask = null;
    (async () => {
      try {
        setThumbErr("");
        const url = api.doorsMaps.planFileUrlAuto(plan, { bust: true });
        loadingTask = pdfjsLib.getDocument({
          ...pdfDocOpts(url),
          standardFontDataUrl: "/standard_fonts/",
          disableFontFace: false
        });
        pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const cap = 320;
        const baseScale = cap / viewport.width;
        const adjusted = page.getViewport({ scale: baseScale });
        const c = canvasRef.current;
        if (!c || cancelled) return;
        c.width = Math.floor(adjusted.width);
        c.height = Math.floor(adjusted.height);
        const ctx = c.getContext("2d", { willReadFrequently: false, alpha: true });
        renderTask = page.render({ canvasContext: ctx, viewport: adjusted });
        await renderTask.promise;
        page.cleanup?.();
      } catch (e) {
        if (!cancelled) setThumbErr("Aperçu indisponible.");
      }
    })();
    return () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch {}
      if (pdf) { try { pdf.destroy(); } catch {} }
      else if (loadingTask) { try { loadingTask.destroy(); } catch {} }
    };
  }, [plan.id, plan.logical_name, visible, isMobile]);
  return (
    <div className="border rounded-2xl bg-white shadow-sm hover:shadow transition overflow-hidden">
      <div ref={obsRef} className="relative aspect-video bg-gray-50 flex items-center justify-center">
        {isMobile ? (
          <div className="flex flex-col items-center justify-center text-gray-500">
            <div className="text-4xl leading-none">📄</div>
            <div className="text-[11px] mt-1">PDF</div>
          </div>
        ) : (
          <>
            {visible && <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
            {!visible && <div className="text-xs text-gray-400">…</div>}
            {!!thumbErr && <div className="text-xs text-gray-500">{thumbErr}</div>}
          </>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs px-2 py-1 truncate text-center">
          {name}
        </div>
      </div>
      <div className="p-3">
        {!edit ? (
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate" title={name}>{name || "—"}</div>
            <div className="flex items-center gap-1">
              <Btn variant="ghost" aria-label="Renommer le plan" onClick={() => setEdit(true)}>✏️</Btn>
              <Btn variant="subtle" onClick={() => { onPick(plan); }}>
                Ouvrir
              </Btn>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input value={name} onChange={setName} />
            <Btn
              variant="subtle"
              onClick={async () => { await onRename(plan, (name || "").trim()); setEdit(false); }}
            >
              OK
            </Btn>
            <Btn variant="ghost" onClick={() => { setName(plan.display_name || plan.logical_name || ""); setEdit(false); }}>
              Annuler
            </Btn>
          </div>
        )}
        <div className="flex items-center gap-2 mt-2 text-xs">
          <Badge color="orange">≤30j: {next30}</Badge>
          <Badge color="red">Retard: {overdue}</Badge>
        </div>
      </div>
    </div>
  );
}
/* --- PlanViewerLeaflet.jsx (inline pour simplicité) --- */
const PlanViewerLeaflet = forwardRef(({
  fileUrl,
  pageIndex = 0,
  points = [],
  onReady,
  onMovePoint,
  onClickPoint,
}, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null); // {x,y, items:[{door_id, door_name}]}
  useEffect(() => {
    let cancelled = false;
    let pdf, loadingTask, renderTask;
    const token = Symbol();
    const currentToken = token;
    (async () => {
      try {
        if (!wrapRef.current) return;
        loadingTask = pdfjsLib.getDocument({
          ...pdfDocOpts(fileUrl),
          standardFontDataUrl: "/standard_fonts/",
          disableFontFace: false
        });
        pdf = await loadingTask.promise;
        if (cancelled || currentToken !== token) return;
        const page = await pdf.getPage(Number(pageIndex) + 1);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: true });
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (cancelled || currentToken !== token) return;
        const dataUrl = canvas.toDataURL("image/png");
        setImgSize({ w: canvas.width, h: canvas.height });
        // ... (init Leaflet si besoin)
        if (!mapRef.current) {
          const m = L.map(wrapRef.current, {
            crs: L.CRS.Simple,
            zoomControl: false,
            zoomAnimation: true,
            scrollWheelZoom: true,
            touchZoom: true,
            tap: true,
            tapTolerance: 20,
            inertia: true,
            wheelDebounceTime: 35,
            wheelPxPerZoomLevel: 60,
            preferCanvas: true,
          });
          L.control.zoom({ position: "topright" }).addTo(m);
          mapRef.current = m;
          m.on("click", (e) => {
            const clicked = e.containerPoint;
            const near = [];
            markersLayerRef.current?.eachLayer((mk) => {
              const mp = m.latLngToContainerPoint(mk.getLatLng());
              const dist = Math.hypot(mp.x - clicked.x, mp.y - clicked.y);
              if (dist <= 18) near.push(mk.__meta);
            });
            if (near.length === 1 && onClickPoint) onClickPoint(near[0]);
            else if (near.length > 1) setPicker({ x: clicked.x, y: clicked.y, items: near });
            else setPicker(null);
          });
          m.on("zoomstart movestart", () => setPicker(null));
        }
        const map = mapRef.current;
        const bounds = L.latLngBounds([[0, 0], [viewport.height, viewport.width]]);
        if (imageLayerRef.current) map.removeLayer(imageLayerRef.current);
        const layer = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1 });
        imageLayerRef.current = layer;
        layer.addTo(map);
        if (!markersLayerRef.current) {
          markersLayerRef.current = L.layerGroup().addTo(map);
        }
        drawMarkers(points, viewport.width, viewport.height);
        // >>> fit robuste (voir section 2 ci-dessous)
        fitToOverlay(map, layer);
        onReady?.();
      } catch (e) {
        if (e?.name !== "RenderingCancelledException") {
          console.error("Leaflet viewer error", e);
        }
      }
    })();
    return () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch {}
      try { pdf?.destroy(); } catch {}
      // Ne pas forcer loadingTask.destroy() si pdf a été chargé — ça peut flinguer le worker partagé.
      try { if (!pdf) loadingTask?.destroy?.(); } catch {}
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      imageLayerRef.current = null;
      if (markersLayerRef.current) { markersLayerRef.current.clearLayers(); markersLayerRef.current = null; }
    };
  }, [fileUrl, pageIndex, onReady]);
  const imgSizeRef = useRef(imgSize);
  useEffect(() => { imgSizeRef.current = imgSize; }, [imgSize]);
  useEffect(() => {
    if (!mapRef.current || !imgSize.w) return;
    drawMarkers(points, imgSize.w, imgSize.h);
  }, [points, imgSize]);
  function markerClass(status) {
    if (status === STATUS.EN_RETARD) return 'door-marker door-marker--red';
    if (status === STATUS.EN_COURS) return 'door-marker door-marker--amber';
    if (status === STATUS.A_FAIRE) return 'door-marker door-marker--green';
    return 'door-marker door-marker--blue';
  }
  function drawMarkers(list, w, h) {
    const map = mapRef.current;
    if (!map) return;
    const g = markersLayerRef.current;
    g?.clearLayers();
    (list || []).forEach((p) => {
      const x = Number(p.x_frac ?? p.x ?? 0) * w;
      const y = Number(p.y_frac ?? p.y ?? 0) * h;
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      const latlng = L.latLng(y, x);
      const icon = L.divIcon({
        className: markerClass(p.status),
        iconSize: [28, 28],
      });
      const mk = L.marker(latlng, {
        icon,
        draggable: true,
        autoPan: true,
        bubblingMouseEvents: false,
        keyboard: false,
        riseOnHover: true,
      });
      mk.__meta = {
        door_id: p.door_id,
        door_name: p.door_name || p.name,
        status: p.status,
        x_frac: p.x_frac,
        y_frac: p.y_frac,
      };
      mk.on('dragend', () => {
        if (!onMovePoint) return;
        const ll = mk.getLatLng();
        const pxy = map.latLngToLayerPoint(ll);
        const xFrac = Math.min(1, Math.max(0, pxy.x / w));
        const yFrac = Math.min(1, Math.max(0, pxy.y / h));
        onMovePoint(p.door_id, { x: xFrac, y: yFrac });
      });
      mk.addTo(g);
    });
  }
  function fitToOverlay(map, layer) {
    const doFit = () => {
      try {
        const b = layer.getBounds();
        const fitZoom = map.getBoundsZoom(b, true);
        map.setMinZoom(fitZoom - 1);
        map.setMaxZoom(fitZoom + 6);
        map.setMaxBounds(b.pad(0.5));
        map.fitBounds(b, { padding: [10, 10] });
      } catch {}
    };
    // 1) quand l’image est réellement chargée
    layer.once("load", () => {
      requestAnimationFrame(() => {
        map.invalidateSize(false);
        requestAnimationFrame(doFit); // 2 rAF pour laisser le layout se stabiliser
      });
    });
    // 2) fallback (au cas où 'load' arrive très vite)
    setTimeout(() => {
      map.invalidateSize(false);
      requestAnimationFrame(doFit);
    }, 0);
    // 3) sur le 1er resize de la map (ex: conteneur flex qui s’étire un chouïa)
    const onceResize = () => { map.off("resize", onceResize); doFit(); };
    map.on("resize", onceResize);
  }
  const onPickDoor = (d) => {
    setPicker(null);
    onClickPoint?.(d);
  };
  const adjust = () => {
    const m = mapRef.current;
    const layer = imageLayerRef.current;
    if (!m || !layer) return;
    fitToOverlay(m, layer);
  };
  useImperativeHandle(ref, () => ({ adjust }));
  const wrapperHeight = Math.max(320, imgSize.h ? Math.min(imgSize.h, 1200) : 520);
  return (
    <div className="mt-3 relative">
      <div className="flex items-center justify-end gap-2 mb-2">
        <Btn
          variant="ghost"
          aria-label="Ajuster le zoom au plan"
          onClick={adjust}
        >
          Ajuster
        </Btn>
      </div>
      <div
        ref={wrapRef}
        className="relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
        style={{ height: wrapperHeight }}
      />
      {picker && (
        <div
          className="door-pick"
          style={{
            left: Math.max(8, picker.x - 120),
            top: Math.max(8, picker.y - 8),
          }}
        >
          {picker.items.slice(0, 8).map((it) => (
            <button key={it.door_id} onClick={() => onPickDoor(it)}>
              {it.door_name || it.door_id}
            </button>
          ))}
          {picker.items.length > 8 ? <div className="text-xs text-gray-500 px-1">…</div> : null}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-600"/> À faire</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500"/> ≤30j</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-rose-600"/> En retard</span>
      </div>
    </div>
  );
});
