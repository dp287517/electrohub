import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import dayjs from "dayjs";
import 'dayjs/locale/fr';
dayjs.locale('fr');
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from 'leaflet';
import '../styles/doors-map.css';
import { api } from '../lib/api.js';

/* >>> PDF.js (local via pdfjs-dist, plus de CDN) */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
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

  /* ✅ PATCH vignette PDF : scale “safe”, cleanup propre, pas de double destroy */
  useEffect(() => {
    if (isMobile) return;
    if (!visible) return;
    let cancelled = false;
    let loadingTask = null;
    let renderTask = null;

    (async () => {
      try {
        setThumbErr("");
        const url = api.doorsMaps.planFileUrlAuto(plan, { bust: true });
        loadingTask = pdfjsLib.getDocument(pdfDocOpts(url));
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        const vp1 = page.getViewport({ scale: 1 });
        const capCss = 320;                         // largeur CSS vignette
        const dpr = window.devicePixelRatio || 1;
        const targetBitmapW = capCss * dpr;
        const scale = Math.min(2, Math.max(0.5, targetBitmapW / vp1.width));
        const adjusted = page.getViewport({ scale });

        const c = canvasRef.current;
        if (!c || cancelled) return;
        c.width = Math.floor(adjusted.width);
        c.height = Math.floor(adjusted.height);
        const ctx = c.getContext("2d", { willReadFrequently: false, alpha: true });
        renderTask = page.render({ canvasContext: ctx, viewport: adjusted });
        await renderTask.promise;
      } catch (e) {
        if (e?.name !== "RenderingCancelledException") {
          setThumbErr("Aperçu indisponible.");
        }
      }
    })();

    return () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch {}
      try { loadingTask?.destroy(); } catch {}
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

/* --- PlanViewerLeaflet.jsx (inline) --- */
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

  /* ✅ PATCH principal : rendu PDF “safe”, fitBounds fiable, erreurs worker ignorées si annulées */
  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    let renderTask = null;
    let objectUrl = null; // pour revoke

    (async () => {
      try {
        if (!wrapRef.current) return;

        // 1) Charge le PDF
        loadingTask = pdfjsLib.getDocument({
          ...pdfDocOpts(fileUrl),
          standardFontDataUrl: "/standard_fonts/",
        });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        // 2) Choix du scale en fonction de la largeur réelle du conteneur
        const page = await pdf.getPage(Number(pageIndex) + 1);
        const baseVp = page.getViewport({ scale: 1 });
        const containerW = Math.max(320, wrapRef.current.clientWidth || 1024);
        const dpr = window.devicePixelRatio || 1;
        const targetBitmapW = containerW * dpr;
        const safeScale = Math.min(2.0, Math.max(0.5, targetBitmapW / baseVp.width));
        const viewport = page.getViewport({ scale: safeScale });

        // 3) Rendu bitmap
        const canvas = document.createElement("canvas");
        canvas.width  = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: false });
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (cancelled) return;

        // 4) toBlob -> ObjectURL (mémoire + facile à révoquer)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
        objectUrl = URL.createObjectURL(blob);

        // 5) MAJ taille image pour les marqueurs
        setImgSize({ w: canvas.width, h: canvas.height });

        // 6) Crée la carte si nécessaire
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

        // 7) Overlay image + bornes/zoom
        const map = mapRef.current;
        const bounds = L.latLngBounds([[0, 0], [viewport.height, viewport.width]]);

        if (imageLayerRef.current) {
          map.removeLayer(imageLayerRef.current);
          imageLayerRef.current = null;
        }
        const layer = L.imageOverlay(objectUrl, bounds, { interactive: false, opacity: 1 });
        imageLayerRef.current = layer;
        layer.addTo(map);

        // Laisse le layout se stabiliser avant fitBounds
        await new Promise(requestAnimationFrame);
        map.invalidateSize(false);

        const fitZoom = map.getBoundsZoom(bounds, true);
        map.options.zoomSnap = 0.1;
        map.options.zoomDelta = 0.5;
        map.setMinZoom(fitZoom - 1);
        map.setMaxZoom(fitZoom + 6);
        map.setMaxBounds(bounds.pad(0.5));
        map.fitBounds(bounds, { padding: [10, 10] }); // affiche l’intégralité du plan

        if (!markersLayerRef.current) {
          markersLayerRef.current = L.layerGroup().addTo(map);
        }
        drawMarkers(points, viewport.width, viewport.height);
        onReady?.();
      } catch (e) {
        if (e?.name === "RenderingCancelledException") return;
        const msg = String(e?.message || "");
        if (msg.includes("Worker was destroyed") || msg.includes("Worker was terminated")) return;
        console.error("Leaflet viewer error", e);
      }
    })();

    return () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch {}
      try { loadingTask?.destroy(); } catch {}
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      imageLayerRef.current = null;
      if (markersLayerRef.current) { markersLayerRef.current.clearLayers(); markersLayerRef.current = null; }
      if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch {} }
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
        const ll = map.latLngToLayerPoint(mk.getLatLng());
        const xFrac = Math.min(1, Math.max(0, ll.x / w));
        const yFrac = Math.min(1, Math.max(0, ll.y / h));
        onMovePoint(p.door_id, { x: xFrac, y: yFrac });
      });
      mk.addTo(g);
    });
  }

  const onPickDoor = (d) => {
    setPicker(null);
    onClickPoint?.(d);
  };

  /* ✅ PATCH bouton Ajuster : invalidateSize -> fitZoom -> fitBounds */
  const adjust = () => {
    const m = mapRef.current;
    const layer = imageLayerRef.current;
    if (!m || !layer) return;
    const b = layer.getBounds();
    m.invalidateSize(false);
    const fitZoom = m.getBoundsZoom(b, true);
    m.setMinZoom(fitZoom - 1);
    m.fitBounds(b, { padding: [10, 10] });
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
/* ----------------------------- Page principale ----------------------------- */
export default function Doors() {
  const [tab, setTab] = useState("controls");
  const [doors, setDoors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [doorState, setDoorState] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [calendar, setCalendar] = useState({ events: [] });
  const [toast, setToast] = useState("");

  const defaultTemplate = [
    "La porte est-elle en parfait état (fermeture correcte, non voilée) ?",
    "Joint de porte en bon état (propre, non abîmé) ?",
    "Aucune modification non tracée (perçages, changement nécessitant vérification) ?",
    "Plaquette d’identification (portes ≥ 2005) visible ?",
    "Porte à double battant bien synchronisée (un battant après l’autre, fermeture OK) ?",
  ];
  const [settings, setSettings] = useState({
    checklist_template: defaultTemplate,
    frequency: "1_an",
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const [filesVersion, setFilesVersion] = useState(0);

  // Plans / cartes
  const [plans, setPlans] = useState([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const planPage = 0;
  const [positions, setPositions] = useState([]);
  const [pdfReady, setPdfReady] = useState(false);
  const viewerRef = useRef(null);

  /* ----------------------------- URL helpers ----------------------------- */
  function getDoorParam() {
    try {
      return new URLSearchParams(window.location.search).get("door");
    } catch {
      return null;
    }
  }
  function setDoorParam(id) {
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("door", id);
      else url.searchParams.delete("door");
      window.history.replaceState({}, "", url);
    } catch {}
  }
  function closeDrawerAndClearParam() {
    setDrawerOpen(false);
    setEditing(null);
    setDoorParam(null);
  }

  /* ----------------------------- Chargements init ----------------------------- */
  async function reload() {
    setLoading(true);
    try {
      const data = await API.list({ q, status, building, floor, door_state: doorState });
      setDoors(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }
  async function reloadCalendar() {
    const data = await API.calendar().catch(() => ({ events: [] }));
    const events = (data?.events || []).map((e) => ({
      date: dayjs(e.date || e.next_check_date || e.due_date).format("YYYY-MM-DD"),
      door_id: e.door_id,
      door_name: e.door_name,
      status: e.status,
    }));
    setCalendar({ events });
  }
  async function loadSettings() {
    const s = await API.settingsGet().catch(() => null);
    if (s?.checklist_template?.length)
      setSettings((x) => ({ ...x, checklist_template: s.checklist_template }));
    if (s?.frequency) setSettings((x) => ({ ...x, frequency: s.frequency }));
  }
  useEffect(() => {
    reload();
    reloadCalendar();
    loadSettings();
  }, []);
  useEffect(() => {
    const targetId = getDoorParam();
    if (!targetId) return;
    (async () => {
      const full = await API.get(targetId).catch(() => null);
      if (full?.door?.id) {
        setEditing(full.door);
        setDrawerOpen(true);
      } else {
        setDoorParam(null);
      }
    })();
    const onPop = () => {
      const id = getDoorParam();
      if (!id) closeDrawerAndClearParam();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      reload();
    }, 350);
    return () => clearTimeout(t);
  }, [q, status, building, floor, doorState]);

  /* ----------------------------- CRUD portes ----------------------------- */
  const filtered = doors;
  function openCreate() {
    setEditing({
      id: null,
      name: "",
      building: "",
      floor: "",
      location: "",
      status: STATUS.A_FAIRE,
      next_check_date: null,
      photo_url: null,
      current_check: null,
      door_state: null,
    });
    setDrawerOpen(true);
  }
  async function openEdit(door) {
    const full = await API.get(door.id);
    setEditing(full?.door || door);
    setDrawerOpen(true);
    setDoorParam(door.id);
  }
  async function saveDoorBase() {
    if (!editing) return;
    const payload = {
      name: editing.name,
      building: editing.building || "",
      floor: editing.floor || "",
      location: editing.location || "",
    };
    if (editing.id) {
      await API.update(editing.id, payload);
      const full = await API.get(editing.id);
      setEditing(full?.door || editing);
    } else {
      const created = await API.create({
        ...payload,
        status: editing.status || STATUS.A_FAIRE,
      });
      if (created?.door?.id) {
        const full = await API.get(created.door.id);
        setEditing(full?.door || created.door);
      }
    }
    await reload();
    await reloadCalendar();
  }
  async function deleteDoor() {
    if (!editing?.id) return;
    const ok = window.confirm(
      "Supprimer définitivement cette porte ? Cette action est irréversible."
    );
    if (!ok) return;
    await API.remove(editing.id);
    setDrawerOpen(false);
    setEditing(null);
    await reload();
    await reloadCalendar();
    if (tab === "maps" && selectedPlan) {
      await loadPositions(selectedPlan, planPage);
    }
  }

  const baseOptions = [
    { value: "conforme", label: "Conforme" },
    { value: "non_conforme", label: "Non conforme" },
    { value: "na", label: "N/A" },
  ];

  async function ensureCurrentCheck() {
    if (!editing?.id) return;
    let check = editing.current_check;
    if (!check) {
      const s = await API.startCheck(editing.id);
      check = s?.check || null;
    }
    if (check) {
      const full = await API.get(editing.id);
      setEditing(full?.door);
    }
  }
  function allFiveAnswered(items = []) {
    const values = (items || []).slice(0, 5).map((i) => i?.value);
    if (values.length < 5) return false;
    return values.every((v) => v === "conforme" || v === "non_conforme" || v === "na");
    }
  async function saveChecklistItem(idx, field, value) {
    if (!editing?.id || !editing?.current_check) return;
    const items = [...(editing.current_check.items || [])];
    const prev = items[idx] || { index: idx };
    const next = { ...prev, index: idx };
    if (field === "value") next.value = value;
    if (field === "comment") next.comment = value;
    items[idx] = next;
    const payload = { items };
    if (allFiveAnswered(items)) payload.close = true;
    const res = await API.saveCheck(editing.id, editing.current_check.id, payload);
    if (res?.door) {
      setEditing(res.door);
      if (res?.notice) setToast(res.notice);
      await reload();
      await reloadCalendar();
      if (tab === "maps" && selectedPlan) {
        await loadPositions(selectedPlan, planPage);
      }
    } else {
      const full = await API.get(editing.id);
      setEditing(full?.door);
    }
  }

  /* ----------------------------- Uploads ----------------------------- */
  const [uploading, setUploading] = useState(false);
  function onDropFiles(e) {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length) handleUpload(Array.from(files));
  }
  async function handleUpload(files) {
    if (!editing?.id || !files?.length) return;
    setUploading(true);
    try {
      for (const f of files) await API.uploadFile(editing.id, f);
      const full = await API.get(editing.id);
      setEditing(full?.door);
      setFilesVersion((v) => v + 1);
      setToast(files.length > 1 ? "Fichiers ajoutés ✅" : "Fichier ajouté ✅");
    } finally {
      setUploading(false);
    }
  }
  async function handleUploadPhoto(e) {
    const f = e.target.files?.[0];
    if (!f || !editing?.id) return;
    await API.uploadPhoto(editing.id, f);
    const full = await API.get(editing.id);
    setEditing(full?.door);
    await reload();
    setToast("Photo mise à jour ✅");
  }

  /* ----------------------------- Settings ----------------------------- */
  async function saveSettings() {
    setSavingSettings(true);
    try {
      const cleaned = (settings.checklist_template || [])
        .map((s) => (s || "").trim())
        .filter(Boolean);
      await API.settingsSet({ checklist_template: cleaned, frequency: settings.frequency });
    } finally {
      setSavingSettings(false);
    }
  }

  /* ----------------------------- Plans ----------------------------- */
  async function loadPlans() {
    setMapsLoading(true);
    try {
      const r = await api.doorsMaps.listPlans().catch(() => ({ plans: [] }));
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
    } finally {
      setMapsLoading(false);
    }
  }
  function matchFilters(it) {
    const name = (it.door_name || "").toLowerCase().trim();
    const qNorm = (q || "").toLowerCase().trim();
    if (qNorm && !name.includes(qNorm)) return false;
    if (status && it.status !== status) return false;
    const eq = (a, b) => (a || "").toString().trim().toLowerCase() === (b || "").toString().trim().toLowerCase();
    if (building && !eq(it.building, building)) return false;
    if (floor && !eq(it.floor, floor)) return false;
    if (doorState && it.door_state !== doorState) return false;
    return true;
  }
  async function loadPositions(plan, pageIdx = 0) {
    if (!plan) return;
    const key = plan.id || plan.logical_name || "";
    try {
      const r = await api.doorsMaps.positionsAuto(key, pageIdx).catch(() => ({ items: [] }));
      let positions = Array.isArray(r?.items) ? r.items.map(item => ({
        door_id: item.door_id,
        door_name: item.name || item.door_name,
        x_frac: Number(item.x_frac ?? item.x ?? 0),
        y_frac: Number(item.y_frac ?? item.y ?? 0),
        x: Number(item.x_frac ?? item.x ?? 0),
        y: Number(item.y_frac ?? item.y ?? 0),
        status: item.status,
        building: item.building,
        floor: item.floor,
        door_state: item.door_state,
      })) : [];
      positions = positions.filter(it => matchFilters(it));
      setPositions(positions);
    } catch {
      setPositions([]);
    }
  }

  useEffect(() => {
    if (tab === "maps") loadPlans();
  }, [tab]);

  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan]);
  useEffect(() => {
    if (stableSelectedPlan) {
      loadPositions(stableSelectedPlan, planPage);
    }
  }, [stableSelectedPlan, planPage, q, status, building, floor, doorState, plans]);

  const handlePdfReady = useCallback(() => setPdfReady(true), []);
  const handleMovePoint = useCallback(async (doorId, xy) => {
    if (!stableSelectedPlan) return;
    await api.doorsMaps.setPosition(doorId, {
      logical_name: stableSelectedPlan.logical_name,
      plan_id: stableSelectedPlan.id,
      page_index: planPage,
      x_frac: xy.x,
      y_frac: xy.y,
    });
    await loadPositions(stableSelectedPlan, planPage);
  }, [stableSelectedPlan, planPage]);
  const handleClickPoint = useCallback((p) => {
    openEdit({ id: p.door_id, name: p.door_name || p.name });
  }, []);

  async function createDoorAtCenter() {
    if (!stableSelectedPlan) return;
    try {
      const created = await API.create({ name: "Nouvelle porte", building: "", floor: "", location: "", status: STATUS.A_FAIRE });
      const id = created?.door?.id;
      if (!id) throw new Error("Création de porte impossible");
      const xy = { x_frac: 0.5, y_frac: 0.5 };
      await api.doorsMaps.setPosition(id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: planPage,
        ...xy,
      });
      await loadPositions(stableSelectedPlan, planPage);
      viewerRef.current?.adjust();
      setToast("Porte créée au centre du plan ✅");
      openEdit({ id, name: created?.door?.name || "Nouvelle porte" });
    } catch (e) {
      setToast("Erreur lors de la création : " + (e?.message || e));
    }
  }

  // Refresh périodique quand un plan est ouvert
  useEffect(() => {
    if (tab !== "maps" || !stableSelectedPlan) return;
    const tick = () => {
      loadPositions(stableSelectedPlan, planPage);
    };
    const iv = setInterval(tick, 8000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [tab, stableSelectedPlan, planPage, q, status, building, floor, doorState]);

  const StickyTabs = () => (
    <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2">
      <div className="flex flex-wrap gap-2">
        <Btn variant={tab === "controls" ? "primary" : "ghost"} onClick={() => setTab("controls")}>
          📋 Contrôles
        </Btn>
        <Btn variant={tab === "calendar" ? "primary" : "ghost"} onClick={() => setTab("calendar")}>
          📅 Calendrier
        </Btn>
        <Btn variant={tab === "maps" ? "primary" : "ghost"} onClick={() => setTab("maps")}>
          🗺️ Plans
        </Btn>
        <Btn variant={tab === "settings" ? "primary" : "ghost"} onClick={() => setTab("settings")}>
          ⚙️ Paramètres
        </Btn>
      </div>
    </div>
  );

  /* ----------------------------- RENDER ----------------------------- */
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Portes coupe-feu</h1>
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
          <div className="grid md:grid-cols-5 gap-3">
            <Input value={q} onChange={setQ} placeholder="Recherche (nom / lieu…)" />
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: "Tous statuts" },
                { value: STATUS.A_FAIRE, label: "À faire (vert)" },
                { value: STATUS.EN_COURS, label: "En cours <30j (orange)" },
                { value: STATUS.EN_RETARD, label: "En retard (rouge)" },
                { value: STATUS.FAIT, label: "Fait (hist.)" },
              ]}
              placeholder="Tous statuts"
            />
            <Input value={building} onChange={setBuilding} placeholder="Bâtiment" />
            <Input value={floor} onChange={setFloor} placeholder="Étage / Zone" />
            <Select
              value={doorState}
              onChange={setDoorState}
              options={[
                { value: "", label: "Tous états (dernier contrôle)" },
                { value: "conforme", label: "Conforme" },
                { value: "non_conforme", label: "Non conforme" },
              ]}
              placeholder="Tous états"
            />
          </div>
          <div className="flex gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setQ("");
                setStatus("");
                setBuilding("");
                setFloor("");
                setDoorState("");
              }}
            >
              Réinitialiser
            </Btn>
          </div>
          <div className="text-xs text-gray-500">Recherche automatique activée.</div>
        </div>
      )}

      {tab === "controls" && (
        <div className="bg-white rounded-2xl border shadow-sm">
          <div className="sm:hidden divide-y">
            {loading && <div className="p-4 text-gray-500">Chargement…</div>}
            {!loading && filtered.length === 0 && <div className="p-4 text-gray-500">Aucune porte.</div>}
            {filtered.map((d) => (
              <div key={d.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center">
                      {d.photo_url ? (
                        <img src={d.photo_url} alt={d.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[11px] text-gray-500 p-1 text-center">Photo à<br/>prendre</span>
                      )}
                    </div>
                    <div>
                      <button className="text-blue-700 font-semibold hover:underline" onClick={() => openEdit(d)}>
                        {d.name}
                      </button>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {d.building || "—"} • {d.floor || "—"} {d.location ? ` • ${d.location}` : ""}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {doorStateBadge(d.door_state)}
                        <span className="text-xs text-gray-500">
                          Prochain contrôle: {d.next_check_date ? dayjs(d.next_check_date).format("DD/MM/YYYY") : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Badge color={statusColor(d.status)}>{statusLabel(d.status)}</Badge>
                </div>
                <div className="mt-3 flex gap-2">
                  <Btn variant="ghost" onClick={() => openEdit(d)}>Ouvrir</Btn>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-[12px] z-20 bg-gray-50/90 backdrop-blur supports-[backdrop-filter]:bg-gray-50/70">
                <tr className="text-left border-b">
                  <th className="px-4 py-3 font-semibold text-gray-700">Porte</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Localisation</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">État (dernier contrôle)</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Statut</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Prochain contrôle</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-gray-500">Chargement…</td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-gray-500">Aucune porte.</td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((d, idx) => (
                    <tr key={d.id} className={`border-b hover:bg-gray-50 ${idx % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}>
                      <td className="px-4 py-3 min-w-[260px]">
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
                            {d.photo_url ? (
                              <img src={d.photo_url} alt={d.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-gray-500 p-1 text-center">Photo à<br/>prendre</span>
                            )}
                          </div>
                          <button className="text-blue-700 font-medium hover:underline" onClick={() => openEdit(d)}>
                            {d.name}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(d.building || "—") + " • " + (d.floor || "—") + (d.location ? ` • ${d.location}` : "")}
                      </td>
                      <td className="px-4 py-3">
                        {doorStateBadge(d.door_state)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={statusColor(d.status)}>{statusLabel(d.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {d.next_check_date ? dayjs(d.next_check_date).format("DD/MM/YYYY") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Btn variant="ghost" onClick={() => openEdit(d)}>Ouvrir</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "calendar" && (
        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <MonthCalendar
            events={calendar.events}
            onDayClick={({ events }) => {
              const first = events?.[0];
              if (!first?.door_id) return;
              openEdit({ id: first.door_id, name: first.door_name });
            }}
          />
        </div>
      )}

      {tab === "maps" && (
        <div className="space-y-4">
          <PlansHeader
            mapsLoading={mapsLoading}
            onUploadZip={async (file) => {
              const r = await api.doorsMaps.uploadZip(file).catch(() => null);
              if (r?.ok) setToast("Plans importés ✅");
              await loadPlans();
            }}
          />
          <PlanCards
            plans={plans}
            onRename={async (plan, name) => {
              await api.doorsMaps.renamePlan(plan.logical_name, name);
              await loadPlans();
            }}
            onPick={(plan) => {
              setSelectedPlan(plan);
              setPdfReady(false);
            }}
          />
          {selectedPlan && (
            <div className="bg-white rounded-2xl border shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold">
                  {selectedPlan.display_name || selectedPlan.logical_name}
                </div>
                <div className="flex items-center gap-2">
                  <Btn
                    variant="subtle"
                    onClick={createDoorAtCenter}
                    title="Créer une nouvelle porte au centre du plan"
                  >
                    ➕ Nouvelle porte
                  </Btn>
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
              <PlanViewerLeaflet
                ref={viewerRef}
                key={selectedPlan?.id || selectedPlan?.logical_name || ""}
                fileUrl={api.doorsMaps.planFileUrlAuto(selectedPlan, { bust: true })}
                pageIndex={planPage}
                points={positions}
                onReady={handlePdfReady}
                onMovePoint={handleMovePoint}
                onClickPoint={handleClickPoint}
              />
              {!pdfReady && <div className="text-xs text-gray-500 px-1 pt-2">Chargement du plan…</div>}
            </div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="font-semibold mb-2">Modèle de checklist (futur)</div>
              <div className="text-sm text-gray-500 mb-2">
                Les inspections déjà effectuées restent figées. Modifie ici les intitulés pour les <b>prochaines</b> checklists.
              </div>
              <div className="space-y-2">
                {(settings.checklist_template || []).map((txt, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-sm text-gray-500 mt-2">{i + 1}.</span>
                    <Input
                      value={txt}
                      onChange={(v) => {
                        const arr = [...settings.checklist_template];
                        arr[i] = v;
                        setSettings({ ...settings, checklist_template: arr });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold mb-2">Fréquence</div>
              <Select
                value={settings.frequency}
                onChange={(v) => setSettings({ ...settings, frequency: v })}
                options={[
                  { value: "1_an", label: "1× par an" },
                  { value: "1_mois", label: "1× par mois" },
                  { value: "2_an", label: "2× par an (tous les 6 mois)" },
                  { value: "3_mois", label: "Tous les 3 mois" },
                  { value: "2_ans", label: "1× tous les 2 ans" },
                ]}
                placeholder="Choisir…"
              />
              <div className="text-xs text-gray-500 mt-2">La date de prochain contrôle s’affiche <b>sans heure</b>.</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={loadSettings}>Annuler</Btn>
            <Btn onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? "Enregistrement…" : "Enregistrer les paramètres"}
            </Btn>
          </div>
        </div>
      )}

      {/* Drawer Édition */}
      {drawerOpen && editing && (
        <Drawer
          title={`Porte • ${editing.name || "nouvelle"}`}
          onClose={closeDrawerAndClearParam}
        >
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Nom de la porte">
                <Input value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} />
              </Labeled>
              <Labeled label="Bâtiment">
                <Input value={editing.building || ""} onChange={(v) => setEditing({ ...editing, building: v })} />
              </Labeled>
              <Labeled label="Étage / Zone">
                <Input value={editing.floor || ""} onChange={(v) => setEditing({ ...editing, floor: v })} />
              </Labeled>
              <Labeled label="Localisation (complément)">
                <Input value={editing.location || ""} onChange={(v) => setEditing({ ...editing, location: v })} />
              </Labeled>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Statut</span>
                <Badge color={statusColor(editing.status)}>{statusLabel(editing.status)}</Badge>
                <span className="text-sm text-gray-600">• État</span>
                {doorStateBadge(editing.door_state)}
              </div>
              <div className="text-sm text-gray-600">
                Prochain contrôle : {editing.next_check_date ? dayjs(editing.next_check_date).format("DD/MM/YYYY") : "—"}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Btn variant="ghost" onClick={saveDoorBase}>Enregistrer la fiche</Btn>
              {editing?.id && <Btn variant="danger" onClick={deleteDoor}>Supprimer</Btn>}
            </div>

            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Photo de la porte</div>
                  <label className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={handleUploadPhoto} />
                    Mettre à jour la photo
                  </label>
                </div>
                <div className="w-40 h-40 rounded-xl border overflow-hidden bg-gray-50 flex items-center justify-center">
                  {editing.photo_url ? (
                    <img src={editing.photo_url} alt="photo porte" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-500 p-2 text-center">Aucune photo</span>
                  )}
                </div>
              </div>
            )}

            <div className="border rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Checklist</div>
                {!editing.current_check && <Btn onClick={ensureCurrentCheck}>Démarrer un contrôle</Btn>}
              </div>
              {!editing.current_check && (
                <div className="text-sm text-gray-500">
                  Lance un contrôle pour remplir les 5 points ci-dessous.
                </div>
              )}
              {!!editing.current_check && (
                <div className="space-y-3">
                  {(editing.current_check.itemsView || settings.checklist_template || defaultTemplate).slice(0, 5).map((label, i) => {
                    const val = editing.current_check.items?.[i]?.value || "";
                    const comment = editing.current_check.items?.[i]?.comment || "";
                    return (
                      <div key={i} className="grid gap-2">
                        <div className="grid md:grid-cols-[1fr,220px] gap-2 items-center">
                          <div className="text-sm">{label}</div>
                          <Select
                            value={val}
                            onChange={(v) => saveChecklistItem(i, "value", v)}
                            options={baseOptions}
                            placeholder="Sélectionner…"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Textarea
                            value={comment}
                            onChange={(v) => saveChecklistItem(i, "comment", v)}
                            placeholder="Commentaire (optionnel)"
                            rows={2}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div className="pt-2">
                    <a
                      href={API.nonConformPDF(editing.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 inline-flex items-center"
                    >
                      Export PDF des non-conformités (SAP)
                    </a>
                  </div>
                </div>
              )}
            </div>

            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Pièces jointes & photos</div>
                  <label className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => e.target.files?.length && handleUpload(Array.from(e.target.files))}
                      multiple
                    />
                    Ajouter
                  </label>
                </div>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropFiles}
                  className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition ${
                    uploading ? "bg-blue-50 border-blue-300" : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <div className="text-sm text-gray-600">
                    Glisser-déposer des fichiers ici, ou utiliser “Ajouter”.
                  </div>
                </div>
                <DoorFiles doorId={editing.id} version={filesVersion} />
              </div>
            )}

            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="font-semibold mb-2">QR code</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <a
                    href={API.qrcodesPdf(editing.id, "80,120,200")}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 inline-flex items-center"
                  >
                    Étiquettes PDF (HALEON)
                  </a>
                </div>
              </div>
            )}

            <DoorHistory doorId={editing.id} />
          </div>
        </Drawer>
      )}
    </section>
  );
}

/* ----------------------------- Sous-composants ----------------------------- */
function Labeled({ label, children }) {
  return (
    <label className="text-sm space-y-1">
      <div className="text-gray-600">{label}</div>
      {children}
    </label>
  );
}
function Drawer({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40" ref={ref}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[640px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <Btn variant="ghost" onClick={onClose}>Fermer</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}
function DoorFiles({ doorId, version = 0 }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const r = await API.listFiles(doorId);
      setFiles(r?.files || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (doorId) load(); }, [doorId, version]);
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {loading && <div className="text-gray-500">Chargement…</div>}
      {!loading && files.length === 0 && <div className="text-gray-500">Aucun fichier.</div>}
      {files.map((f) => (
        <FileCard key={f.id} f={f} onDelete={async () => { await API.deleteFile(f.id); await load(); }} />
      ))}
    </div>
  );
}
function FileCard({ f, onDelete }) {
  const isImage = (f.mime || "").startsWith("image/");
  const url = f.download_url || f.inline_url || f.url;
  return (
    <div className="border rounded-xl overflow-hidden bg-white shadow-sm hover:shadow transition">
      <div className="aspect-video bg-gray-50 flex items-center justify-center overflow-hidden">
        {isImage ? <img src={url} alt={f.original_name} className="w-full h-full object-cover" /> : <div className="text-4xl">📄</div>}
      </div>
      <div className="p-3">
        <div className="text-sm font-medium truncate" title={f.original_name}>{f.original_name}</div>
        <div className="text-xs text-gray-500 mt-0.5">{f.mime || "file"}</div>
        <div className="flex items-center gap-2 mt-2">
          <a href={url} className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition text-xs" download>
            Télécharger
          </a>
          <button onClick={onDelete} className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition text-xs">
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}
function DoorHistory({ doorId }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!doorId) return;
    (async () => {
      const r = await API.listHistory(doorId);
      setItems(r?.checks || []);
    })();
  }, [doorId]);
  if (!doorId) return null;
  return (
    <div className="border rounded-2xl p-3">
      <div className="font-semibold mb-2">Historique des contrôles</div>
      {!items?.length && <div className="text-sm text-gray-500">Aucun contrôle pour le moment.</div>}
      {!!items?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Résultat</th>
                <th className="px-3 py-2">Points (C / NC / N/A)</th>
                <th className="px-3 py-2">Effectué par</th>
                <th className="px-3 py-2">Pièces jointes</th>
                <th className="px-3 py-2">PDF NC</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id} className="border-b align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{h.date ? dayjs(h.date).format("DD/MM/YYYY") : "—"}</td>
                  <td className="px-3 py-2"><Badge color={statusColor(h.status)}>{statusLabel(h.status)}</Badge></td>
                  <td className="px-3 py-2">
                    {h.result === "conforme" ? <Badge color="green">Conforme</Badge> :
                     h.result === "non_conforme" ? <Badge color="red">Non conforme</Badge> : <Badge>—</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-xs text-gray-600">
                      {Number(h.counts?.conforme || 0)} / {Number(h.counts?.nc || 0)} / {Number(h.counts?.na || 0)}
                    </div>
                    <details className="text-xs mt-1">
                      <summary className="cursor-pointer text-blue-700">Voir le détail</summary>
                      <ul className="list-disc ml-4 mt-1 space-y-0.5">
                        {(h.items || []).slice(0, 5).map((it, i) => (
                          <li key={i}>
                            {it.label} —{" "}
                            <span className="font-medium">
                              {it.value === "conforme" ? "Conforme" : it.value === "non_conforme" ? "Non conforme" : "N/A"}
                            </span>
                            {it.comment ? <span className="text-gray-500"> — {it.comment}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="px-3 py-2">{(h.user || "").trim() || "—"}</td>
                  <td className="px-3 py-2">
                    {!h.files?.length && <span className="text-xs text-gray-500">—</span>}
                    {!!h.files?.length && (
                      <div className="flex flex-wrap gap-2">
                        {h.files.map((f) => (
                          <a key={f.id} href={f.url} target="_blank" rel="noreferrer"
                             className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs">
                            {f.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {h.nc_pdf_url ? (
                      <a href={h.nc_pdf_url} target="_blank" rel="noreferrer"
                         className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs">
                        Ouvrir
                      </a>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
