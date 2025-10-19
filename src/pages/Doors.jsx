// src/pages/Doors.jsx — PARTIE 1/2 (DESKTOP MODAL-READY + MOBILE NO-JUMP v6 — fixes anti-flash/anti-recenter)

import { useEffect, useMemo, useRef, useState, forwardRef, useCallback, useImperativeHandle } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";

import "leaflet/dist/leaflet.css";
import "../styles/doors-map.css";

import { api } from "../lib/api.js";

/* >>> PDF.js setup */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/* --- Styles spécifiques : anti-flash & UI marqueurs --- */
const InlineMapStyles = () => (
  <style>{`
  @keyframes blinkPulse { 0%{opacity:1} 50%{opacity:.35} 100%{opacity:1} }
  .blink-orange { animation: blinkPulse 1.2s ease-in-out infinite; }
  .blink-red { animation: blinkPulse .9s ease-in-out infinite; }

  /* Fond blanc pour éviter le "flash" gris/transparent */
  .leaflet-container { background:#fff; }
  .leaflet-pane, .leaflet-map-pane { will-change: transform; }

  .door-pick {
    position:absolute; z-index:1300;
    background:#fff; border:1px solid #e5e7eb; box-shadow:0 10px 20px rgba(0,0,0,.08);
    border-radius:12px; padding:6px; display:flex; gap:4px; flex-wrap:wrap;
  }
  .door-pick > button {
    font-size:12px; line-height:1; padding:6px 8px; border-radius:999px; border:1px solid #e5e7eb;
    background:#fff; color:#111827;
  }
  .door-pick > button:hover { background:#f3f4f6; }

  .leaflet-control-adddoor button {
    display:inline-flex; align-items:center; justify-content:center;
    width:32px; height:32px; border-radius:8px;
    background:#2563eb; color:#fff; font-weight:bold; border:none; cursor:pointer;
    box-shadow:0 1px 2px rgba(0,0,0,.15);
  }
  .leaflet-control-adddoor button:hover { background:#1d4ed8; }

  .door-marker--blue { background:#2563eb; color:#2563eb; }
`}</style>
);

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
function withHeaders(extra = {}) {
  return { credentials: "include", headers: { ...userHeaders(), ...extra } };
}
function pdfDocOpts(url) {
  return { url, withCredentials: true, httpHeaders: userHeaders(), standardFontDataUrl: "/standard_fonts/" };
}

/* ----------------------------- API Doors ----------------------------- */
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

/* ----------------------------- UI helpers ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    ghost: "bg-white text-black border hover:bg-gray-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    warn: "bg-amber-500 text-white hover:bg-amber-600",
    subtle: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
  };
  return (
    <button className={`px-3 py-2 rounded-lg text-sm transition ${map[variant] || map.primary} ${className}`} {...p}>
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
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`}
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
        typeof o === "string" ? <option key={o} value={o}>{o}</option>
                             : <option key={o.value} value={o.value}>{o.label}</option>
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
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color]} ${className}`}>{children}</span>;
}

/* ----------------------------- Plans grid ----------------------------- */
function PlansHeader({ mapsLoading, onUploadZip }) {
  const inputRef = useRef(null);
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between flex-wrap gap-2">
      <InlineMapStyles />
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

// ✅ Détecteur mobile
function useIsMobile() {
  const get = () => {
    if (typeof window === "undefined") return false;
    const mm = window.matchMedia?.("(pointer:coarse)")?.matches;
    return (window.innerWidth < 640) || !!mm;
  };
  const [isMobile, setIsMobile] = useState(get);
  useEffect(() => {
    const onResize = () => setIsMobile(get());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return isMobile;
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
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setVisible(true); }),
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (isMobile || !visible) return;
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
        const capCss = 320;
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
        try { await pdf.cleanup(); } catch {}
        try { await loadingTask.destroy(); } catch {}
      } catch (e) {
        if (e?.name !== "RenderingCancelledException") setThumbErr("Aperçu indisponible.");
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
              <Btn variant="subtle" onClick={() => onPick(plan)}>Ouvrir</Btn>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input value={name} onChange={setName} />
            <Btn variant="subtle" onClick={async () => { await onRename(plan, (name || "").trim()); setEdit(false); }}>OK</Btn>
            <Btn variant="ghost" onClick={() => { setName(plan.display_name || plan.logical_name || ""); setEdit(false); }}>Annuler</Btn>
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

/* --- PlanViewerLeaflet --- */
const PlanViewerLeaflet = forwardRef(({
  fileUrl,
  pageIndex = 0,
  points = [],
  onReady,
  onMovePoint,
  onClickPoint,
  onCreatePoint,
  unsavedIds,
  disabled = false,
  /** "once" = fit une fois (défaut) | "never" = jamais fit (tu gères via ref.adjust) */
  fitStrategy = "once",
}, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const addBtnControlRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null);
  const aliveRef = useRef(true);

  const isInteractingRef = useRef(false);
  const interactionTimeoutRef = useRef(null);

  const lastJob = useRef({ key: null });
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);

  const rafDrawRef = useRef(0);
  const rafInitRef = useRef(0);
  const rafInit2Ref = useRef(0);
  const resizeRafRef = useRef(0);

  const ICON_PX = 22;

  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    const mm = window.matchMedia?.("(pointer:coarse)")?.matches;
    return (window.innerWidth < 640) || !!mm;
  }, []);

  const didInitialFitRef = useRef(false);

  function makeDoorIcon(status, isUnsaved) {
    if (isUnsaved) {
      const s = ICON_PX;
      const html = `<div class="door-marker--blue" style="
        width:${s}px;height:${s}px;border-radius:9999px;
        background:#2563eb;border:2px solid #93c5fd;
        box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
      "></div>`;
      return L.divIcon({
        className: "door-marker-inline",
        html, iconSize: [s, s],
        iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
        popupAnchor: [0, -Math.round(s / 2)],
      });
    }

    const fill =
      status === STATUS.EN_RETARD ? "#e11d48" :
      status === STATUS.EN_COURS ? "#f59e0b" :
      status === STATUS.A_FAIRE ? "#059669" :
      "#2563eb";
    const border =
      status === STATUS.EN_RETARD ? "#fb7185" :
      status === STATUS.EN_COURS ? "#fbbf24" :
      status === STATUS.A_FAIRE ? "#34d399" :
      "#60a5fa";
    const blinkClass =
      status === STATUS.EN_RETARD ? "blink-red" :
      status === STATUS.EN_COURS ? "blink-orange" : "";
    const s = ICON_PX;
    const html = `<div class="${blinkClass}" style="
      width:${s}px;height:${s}px;border-radius:9999px;
      background:${fill};border:2px solid ${border};
      box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
    "></div>`;
    return L.divIcon({
      className: "door-marker-inline",
      html,
      iconSize: [s, s],
      iconAnchor: [Math.round(s / 2), Math.round(s / 2)],
      popupAnchor: [0, -Math.round(s / 2)],
    });
  }

  function ensureAddButton(map) {
    if (addBtnControlRef.current) return;
    const AddCtrl = L.Control.extend({
      onAdd: function() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-adddoor");
        const btn = L.DomUtil.create("button", "", container);
        btn.type = "button";
        btn.title = "Créer une porte au centre";
        btn.textContent = "+";
        L.DomEvent.on(btn, "click", (ev) => {
          L.DomEvent.stop(ev);
          onCreatePoint?.();
        });
        return container;
      },
      onRemove: function() {},
      options: { position: "topright" },
    });
    addBtnControlRef.current = new AddCtrl();
    map.addControl(addBtnControlRef.current);
  }

  // >>> INITIALISATION / RENDU PDF
  useEffect(() => {
    if (disabled) return;
    if (!fileUrl) return;

    let cancelled = false;
    aliveRef.current = true;

    const keyNow = `${fileUrl}::${pageIndex}`;
    if (lastJob.current.key === keyNow && mapRef.current && imageLayerRef.current) {
      onReady?.();
      return;
    }
    lastJob.current.key = keyNow;

    const clearTimers = () => {
      if (interactionTimeoutRef.current) { clearTimeout(interactionTimeoutRef.current); interactionTimeoutRef.current = null; }
      if (rafDrawRef.current) { cancelAnimationFrame(rafDrawRef.current); rafDrawRef.current = 0; }
      if (rafInitRef.current) { cancelAnimationFrame(rafInitRef.current); rafInitRef.current = 0; }
      if (rafInit2Ref.current) { cancelAnimationFrame(rafInit2Ref.current); rafInit2Ref.current = 0; }
      if (resizeRafRef.current) { cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = 0; }
    };

    const cleanupPdf = async () => {
      try { renderTaskRef.current?.cancel(); } catch {}
      try { await loadingTaskRef.current?.destroy(); } catch {}
      renderTaskRef.current = null;
      loadingTaskRef.current = null;
    };
    const cleanupMap = () => {
      const m = mapRef.current;
      if (m) {
        try { m.off(); } catch {}
        try { m._stop?.(); } catch {}
        try { m.stop?.(); } catch {}
        try { m.eachLayer((l) => { try { m.removeLayer(l); } catch {} }); } catch {}
        try { addBtnControlRef.current && m.removeControl(addBtnControlRef.current); } catch {}
        try { m.remove(); } catch {}
      }
      mapRef.current = null;
      imageLayerRef.current = null;
      if (markersLayerRef.current) { try { markersLayerRef.current.clearLayers(); } catch {} markersLayerRef.current = null; }
      addBtnControlRef.current = null;
      didInitialFitRef.current = false;
    };

    (async () => {
      try {
        clearTimers();
        await cleanupPdf();
        cleanupMap();

        // ⛔️ S’assure que le conteneur existe et est mesurable
        const ensureWrap = () => wrapRef.current && wrapRef.current.clientWidth > 0 && wrapRef.current.clientHeight > 0;
        await new Promise((ok) => rafInitRef.current = requestAnimationFrame(ok));
        if (!ensureWrap() || cancelled) return;
        await new Promise((ok) => rafInit2Ref.current = requestAnimationFrame(ok));
        if (!ensureWrap() || cancelled) return;

        const dpr = window.devicePixelRatio || 1;

        loadingTaskRef.current = pdfjsLib.getDocument({ ...pdfDocOpts(fileUrl) });
        const pdf = await loadingTaskRef.current.promise;
        if (cancelled) return;

        const page = await pdf.getPage(Number(pageIndex) + 1);
        const baseVp = page.getViewport({ scale: 1 });

        // rendu bitmap stable (pas surdimensionné → évite scroll jank)
        const cssW = Math.max(640, wrapRef.current?.clientWidth || 1024);
        const targetBitmapW = Math.min(4096, Math.max(1536, Math.floor(cssW * dpr)));
        const scale = Math.min(2.0, Math.max(0.5, targetBitmapW / baseVp.width));
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width  = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: true });
        const renderTask = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;

        const dataUrl = canvas.toDataURL("image/png");
        const width = canvas.width, height = canvas.height;
        setImgSize({ w: width, h: height });

        // ——— MAP sans animation (anti-flash / anti-race)
        const m = L.map(wrapRef.current, {
          crs: L.CRS.Simple,
          zoomControl: false,
          zoomAnimation: false,
          fadeAnimation: false,
          markerZoomAnimation: false,
          tap: false,
          touchZoom: "center",
          scrollWheelZoom: "center",
          dragging: true,
          preferCanvas: true,
          updateWhenIdle: true,
          updateWhenZooming: false,
          inertia: true,
          wheelPxPerZoomLevel: 120,
          wheelDebounceTime: 60,
          bounceAtZoomLimits: false,
          keyboard: false,
        });

        // limites et zooms
        const bounds = L.latLngBounds([[0, 0], [height, width]]);
        const layer = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1 });
        imageLayerRef.current = layer;
        layer.addTo(m);

        // Min/Max zoom calculés AVANT tout move
        const fitZoom = m.getBoundsZoom(bounds, true);
        m.options.zoomSnap = 0;
        m.options.zoomDelta = 0.5;
        m.setMinZoom(fitZoom);
        m.setMaxZoom(fitZoom + 6);
        m.setMaxBounds(bounds.pad(0.0)); // pas de pad → pas de “rebond” visuel

        // UI
        L.control.zoom({ position: "topright" }).addTo(m);
        ensureAddButton(m);

        const startInteraction = () => {
          isInteractingRef.current = true;
          if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
        };
        const stopInteractionSoon = () => {
          if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
          interactionTimeoutRef.current = setTimeout(() => { isInteractingRef.current = false; }, 250);
        };
        m.on("zoomstart", startInteraction);
        m.on("movestart", startInteraction);
        m.on("zoomend", stopInteractionSoon);
        m.on("moveend", stopInteractionSoon);

        // Sélection
        const handlePickAt = (containerPt) => {
          if (!aliveRef.current || !mapRef.current?._loaded) return;
          const clicked = containerPt;
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
        };
        m.on("click", (e) => handlePickAt(e.containerPoint));
        m.on("zoomstart movestart", () => setPicker(null));
        m.on("pointerup", (e) => handlePickAt(e.containerPoint));
        m.on("touchend", (e) => {
          const t = e?.originalEvent?.changedTouches?.[0];
          if (!t) return;
          const pt = m.mouseEventToContainerPoint(t);
          handlePickAt(pt);
        });

        mapRef.current = m;

        // Premier paint, on fixe la vue **sans animation**
        await new Promise(requestAnimationFrame);
        if (!aliveRef.current) return;
        m.invalidateSize(false);
        if (fitStrategy === "once" && !didInitialFitRef.current) {
          didInitialFitRef.current = true;
          const center = bounds.getCenter();
          m.setView(center, fitZoom, { animate: false });
        }

        if (!markersLayerRef.current) {
          markersLayerRef.current = L.layerGroup().addTo(m);
        }
        drawMarkers(points, width, height);

        try { await pdf.cleanup(); } catch {}
        onReady?.();
      } catch (e) {
        if (String(e?.name) === "RenderingCancelledException") return;
        if (String(e?.message || "").includes("Worker was")) return;
        console.error("Leaflet viewer error", e);
      }
    })();

    // 👉 Resize/orientation : **jamais** pendant interaction, debounce
    const onResize = () => {
      if (!mapRef.current || !imageLayerRef.current) return;
      if (isInteractingRef.current) return;
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        const m = mapRef.current; if (!m) return;
        m.invalidateSize(false);
      });
    };

    const onOrientation = onResize;

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientation);

    return () => {
      aliveRef.current = false;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
      clearTimers();
      try { renderTaskRef.current?.cancel(); } catch {}
      try { loadingTaskRef.current?.destroy(); } catch {}
      const m = mapRef.current;
      if (m) {
        try { m.off(); } catch {}
        try { m._stop?.(); } catch {}
        try { m.stop?.(); } catch {}
        try { m.eachLayer((l) => { try { m.removeLayer(l); } catch {} }); } catch {}
        try { addBtnControlRef.current && m.removeControl(addBtnControlRef.current); } catch {}
        try { m.remove(); } catch {}
      }
      mapRef.current = null;
      imageLayerRef.current = null;
      if (markersLayerRef.current) { try { markersLayerRef.current.clearLayers(); } catch {} markersLayerRef.current = null; }
      addBtnControlRef.current = null;
      didInitialFitRef.current = false;
    };
  }, [fileUrl, pageIndex, disabled, fitStrategy]);

  // Redessiner les marqueurs (batch rAF)
  useEffect(() => {
    if (!mapRef.current || !imgSize.w) return;
    if (rafDrawRef.current) cancelAnimationFrame(rafDrawRef.current);
    rafDrawRef.current = requestAnimationFrame(() => {
      drawMarkers(points, imgSize.w, imgSize.h);
    });
  }, [points, imgSize, unsavedIds]);

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

      const isUnsaved = !!unsavedIds?.has?.(p.door_id);
      const latlng = L.latLng(y, x);
      const icon = makeDoorIcon(p.status, isUnsaved);
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

      const fireClick = () => { setPicker(null); onClickPoint?.(mk.__meta); };
      mk.on("click", fireClick);
      mk.on("pointerup", fireClick);
      mk.on("touchend", fireClick);

      mk.on("dragstart", () => {
        isInteractingRef.current = true;
        if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
      });

      mk.on("dragend", () => {
        if (!onMovePoint) return;
        const ll = mk.getLatLng(); // CRS.Simple → lat=y, lng=x
        const xFrac = Math.min(1, Math.max(0, ll.lng / w));
        const yFrac = Math.min(1, Math.max(0, ll.lat / h));
        const xf = Math.round(xFrac * 1e6) / 1e6;
        const yf = Math.round(yFrac * 1e6) / 1e6;
        onMovePoint(p.door_id, { x: xf, y: yf });

        if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
        interactionTimeoutRef.current = setTimeout(() => { isInteractingRef.current = false; }, 250);
      });

      mk.addTo(g);
    });
  }

  const onPickDoor = (d) => { setPicker(null); onClickPoint?.(d); };

  const adjust = () => {
    const m = mapRef.current;
    const layer = imageLayerRef.current;
    if (!m || !layer) return;
    const b = layer.getBounds();
    if (!m._loaded) return;
    isInteractingRef.current = true;
    m.invalidateSize(false);
    const fitZoom = m.getBoundsZoom(b, true);
    m.setMinZoom(fitZoom);
    m.setMaxZoom(fitZoom + 6);
    m.setView(b.getCenter(), fitZoom, { animate: false });
    if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
    interactionTimeoutRef.current = setTimeout(() => { isInteractingRef.current = false; }, 200);
  };
  useImperativeHandle(ref, () => ({ adjust }));

  // Hauteur STABLE
  const wrapperStyle = useMemo(() => {
    return {
      height: isMobile ? "calc(100dvh - 160px)" : "min(82vh, 900px)",
      touchAction: isMobile ? "none" : undefined,
      WebkitUserSelect: "none",
      userSelect: "none",
    };
  }, [isMobile]);

  return (
    <div className="mt-3 relative">
      <div className="flex items-center justify-end gap-2 mb-2">
        <Btn variant="ghost" aria-label="Ajuster le zoom au plan" onClick={adjust}>Ajuster</Btn>
      </div>
      <div
        ref={wrapRef}
        className="leaflet-wrapper relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
        style={wrapperStyle}
      />
      {picker && (
        <div
          className="door-pick"
          style={{
            left: Math.max(8, Math.min((picker.x ?? 8) - 120, (wrapRef.current?.clientWidth || 320) - 180)),
            top: Math.max(8, Math.min((picker.y ?? 8) - 8, (wrapRef.current?.clientHeight || 320) - 48)),
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
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{background:"#059669"}}/> À faire</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full blink-orange" style={{background:"#f59e0b"}}/> ≤30j</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full blink-red" style={{background:"#e11d48"}}/> En retard</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full door-marker--blue" style={{background:"#2563eb"}}/> Nouvelle (à enregistrer)</span>
      </div>
    </div>
  );
});

/* ----- Toast ----- */
function Toast({ text, onClose }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => onClose?.(), 4000);
    return () => clearTimeout(t);
  }, [text, onClose]);
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000]">
      <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">
        {text}
      </div>
    </div>
  );
}

/* ----- Mini calendrier mensuel ----- */
function MonthCalendar({ events = [], onDayClick }) {
  const [cursor, setCursor] = useState(() => dayjs().startOf('month'));
  const start = cursor.startOf('week');
  const end = cursor.endOf('month').endOf('week');
  const days = [];
  let d = start;
  while (d.isBefore(end)) {
    days.push(d);
    d = d.add(1, 'day');
  }
  const map = new Map();
  for (const e of events) {
    const k = dayjs(e.date).format('YYYY-MM-DD');
    const arr = map.get(k) || [];
    arr.push(e);
    map.set(k, arr);
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{cursor.format('MMMM YYYY')}</div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setCursor(cursor.subtract(1, 'month'))}>◀</Btn>
          <Btn variant="ghost" onClick={() => setCursor(dayjs().startOf('month'))}>Aujourd’hui</Btn>
          <Btn variant="ghost" onClick={() => setCursor(cursor.add(1, 'month'))}>▶</Btn>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs text-gray-600 mb-1">
        {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((l)=>(
          <div key={l} className="px-2 py-1">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day)=> {
          const key = day.format('YYYY-MM-DD');
          const es = map.get(key) || [];
          const isCurMonth = day.month() === cursor.month();
          return (
            <button
              key={key}
              onClick={() => onDayClick?.({ date: key, events: es })}
              className={`border rounded-lg p-2 text-left min-h-[64px] ${isCurMonth ? 'bg-white' : 'bg-gray-50 text-gray-500'}`}
            >
              <div className="text-[11px] mb-1">{day.format('D')}</div>
              <div className="flex flex-wrap gap-1">
                {es.slice(0,3).map((ev, i)=>(
                  <span key={i} className="px-1 rounded bg-blue-100 text-blue-700 text-[10px]">{ev.door_name || ev.door_id}</span>
                ))}
                {es.length>3 && <span className="text-[10px] text-gray-500">+{es.length-3}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
// (fin PARTIE 1/2)

// ----------------------------- Page principale ----------------------------- //
function Doors() {
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
  const [planFileUrl, setPlanFileUrl] = useState(null);
  const planPage = 0;
  const [positions, setPositions] = useState([]);
  const [pdfReady, setPdfReady] = useState(false);
  const viewerRef = useRef(null);

  // ➕ Liste locale des nouvelles portes (non “enregistrées” via le bouton Enregistrer la fiche)
  const [unsavedDoorIds, setUnsavedDoorIds] = useState(() => new Set());

  const isMobile = useIsMobile();

  /* ----------------------------- URL helpers ----------------------------- */
  function getDoorParam() {
    try { return new URLSearchParams(window.location.search).get("door"); }
    catch { return null; }
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
    const onPop = () => { if (!getDoorParam()) closeDrawerAndClearParam(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 350);
    return () => clearTimeout(t);
  }, [q, status, building, floor, doorState]);

  /* ----------------------------- Helpers création / noms uniques ----------------------------- */
  function formatDoorNumber(n) { return String(n).padStart(3, "0"); }
  function baseDoorName() { return "Porte"; }
  async function suggestUniqueDoorName() {
    return `${baseDoorName()} ${formatDoorNumber(1)}`;
  }
  async function createDoorWithUniqueName(payloadBase, { maxTries = 60 } = {}) {
    let n = 1;
    let lastErr = null;
    while (n <= maxTries) {
      const candidate = `${baseDoorName()} ${formatDoorNumber(n)}`;
      try {
        const res = await API.create({ ...payloadBase, name: candidate });
        return res;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || "");
        if (msg.toLowerCase().includes("duplicate key") || msg.toLowerCase().includes("unique constraint")) {
          n += 1;
          continue;
        }
        throw e;
      }
    }
    throw new Error(lastErr?.message || "Impossible de générer un nom unique");
  }

  /* ----------------------------- CRUD portes ----------------------------- */
  const filtered = doors;
  async function openEdit(door) {
    const full = await API.get(door.id);
    setEditing(full?.door || door);
    setDrawerOpen(true);
    setDoorParam(door.id);
    // ⚠️ Le plan reste ouvert : le Drawer passe au-dessus (z-60).
  }

  async function saveDoorBase() {
    if (!editing) return;
    const payload = {
      name: editing.name, building: editing.building || "",
      floor: editing.floor || "", location: editing.location || "",
    };
    if (editing.id) {
      await API.update(editing.id, payload);
      const full = await API.get(editing.id);
      setEditing(full?.door || editing);

      if (unsavedDoorIds.has(editing.id)) {
        const next = new Set(unsavedDoorIds);
        next.delete(editing.id);
        setUnsavedDoorIds(next);
        if (tab === "maps" && selectedPlan) await loadPositions(selectedPlan, planPage);
      }
    } else {
      try {
        let nameToUse = (payload.name || "").trim();
        let created = null;
        if (!nameToUse) {
          created = await createDoorWithUniqueName({
            building: payload.building,
            floor: payload.floor,
            location: payload.location,
            status: editing.status || STATUS.A_FAIRE,
          });
        } else {
          try {
            created = await API.create({
              building: payload.building,
              floor: payload.floor,
              location: payload.location,
              status: editing.status || STATUS.A_FAIRE,
              name: nameToUse,
            });
          } catch (e) {
            const msg = String(e?.message || "");
            if (msg.toLowerCase().includes("duplicate key") || msg.toLowerCase().includes("unique constraint")) {
              created = await createDoorWithUniqueName({
                building: payload.building,
                floor: payload.floor,
                location: payload.location,
                status: editing.status || STATUS.A_FAIRE,
              });
              setToast(`Nom déjà pris. Créé comme « ${created?.door?.name} » ✅`);
            } else {
              throw e;
            }
          }
        }
        if (created?.door?.id) {
          const full = await API.get(created.door.id);
          setEditing(full?.door || created.door);
          setDoorParam(created?.door?.id);
        }
      } catch (e) {
        setToast("Erreur création : " + (e?.message || e));
      }
    }
    await reload();
    await reloadCalendar();
  }
  async function deleteDoor() {
    if (!editing?.id) return;
    const ok = window.confirm("Supprimer définitivement cette porte ? Cette action est irréversible.");
    if (!ok) return;
    await API.remove(editing.id);
    setDrawerOpen(false);
    setEditing(null);
    await reload();
    await reloadCalendar();
    if (tab === "maps" && selectedPlan) await loadPositions(selectedPlan, planPage);
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
    return values.length === 5 &&
      values.every((v) => v === "conforme" || v === "non_conforme" || v === "na");
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
      if (tab === "maps" && selectedPlan) await loadPositions(selectedPlan, planPage);
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
      const cleaned = (settings.checklist_template || []).map((s) => (s || "").trim()).filter(Boolean);
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
      let list = Array.isArray(r?.items) ? r.items.map(item => ({
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
      list = list.filter(it => matchFilters(it));
      setPositions(list);
    } catch {
      setPositions([]);
    }
  }
  useEffect(() => { if (tab === "maps") loadPlans(); }, [tab]);

  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan]);
  useEffect(() => {
    if (stableSelectedPlan) loadPositions(stableSelectedPlan, planPage);
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

  // ✅ Création de porte au centre via le bouton ➕ de Leaflet (dans la carte uniquement)
  async function createDoorAtCenter() {
    if (!stableSelectedPlan) return;
    try {
      const basePayload = { building: "", floor: "", location: "", status: STATUS.A_FAIRE };
      const created = await createDoorWithUniqueName(basePayload);
      const id = created?.door?.id;
      if (!id) throw new Error("Réponse inattendue de l'API (pas d'ID).");

      await api.doorsMaps.setPosition(id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: planPage,
        x_frac: 0.5,
        y_frac: 0.5,
      });

      setUnsavedDoorIds((prev) => { const next = new Set(prev); next.add(id); return next; });

      await loadPositions(stableSelectedPlan, planPage);
      viewerRef.current?.adjust();
      setToast(`Porte créée (« ${created?.door?.name} ») au centre du plan ✅`);

      // Ouvre la fiche (le Drawer est au-dessus du plan)
      openEdit({ id, name: created?.door?.name || "Nouvelle porte" });
    } catch (e) {
      const msg = e?.message || "Erreur inconnue";
      console.error("createDoorAtCenter error:", e);
      setToast("Erreur lors de la création : " + msg);
    }
  }

  // Refresh périodique positions quand un plan est ouvert
  useEffect(() => {
    if (tab !== "maps" || !stableSelectedPlan) return;
    const tick = () => { loadPositions(stableSelectedPlan, planPage); };
    const iv = setInterval(tick, 8000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [tab, stableSelectedPlan, planPage, q, status, building, floor, doorState]);

  // Ouvrir/fermer plan
  function openPlan(plan) {
    if (!plan) return;
    setSelectedPlan(plan);
    setPdfReady(false);
    const stableUrl = api.doorsMaps.planFileUrlAuto(plan, { bust: true });
    setPlanFileUrl(stableUrl || null);
  }
  function closePlan() {
    setSelectedPlan(null);
    setPlanFileUrl(null);
    setPdfReady(false);
  }

  // Modal plein écran (desktop + smartphone) — montage stable
  function PlanModal({ open, onClose, children, title }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      if (!open) return setMounted(false);
      let raf = requestAnimationFrame(() => setMounted(true));
      return () => { try { cancelAnimationFrame(raf); } catch {} setMounted(false); };
    }, [open]);

    useEffect(() => {
      const handler = (e) => { if (e.key === "Escape") onClose?.(); };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="absolute inset-0 bg-white shadow-2xl flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-semibold truncate pr-3">{title}</div>
            <div className="flex items-center gap-2">
              <Btn variant="ghost" onClick={onClose}>Fermer</Btn>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden p-2">
            {/* On ne monte les enfants qu’après un paint pour laisser le conteneur prendre ses dimensions */}
            {mounted ? children : <div className="text-xs text-gray-500 px-1 pt-2">Ouverture…</div>}
          </div>
        </div>
      </div>
    );
  }

  const StickyTabs = () => (
    <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2">
      <div className="flex flex-wrap gap-2">
        <Btn variant={tab === "controls" ? "primary" : "ghost"} onClick={() => setTab("controls")}>📋 Contrôles</Btn>
        <Btn variant={tab === "calendar" ? "primary" : "ghost"} onClick={() => setTab("calendar")}>📅 Calendrier</Btn>
        <Btn variant={tab === "maps" ? "primary" : "ghost"} onClick={() => setTab("maps")}>🗺️ Plans</Btn>
        <Btn variant={tab === "settings" ? "primary" : "ghost"} onClick={() => setTab("settings")}>⚙️ Paramètres</Btn>
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
          {/* ❌ Bouton “➕ Nouvelle porte” retiré (création via + dans la carte uniquement) */}
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
              onClick={() => { setQ(""); setStatus(""); setBuilding(""); setFloor(""); setDoorState(""); }}
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
                {!loading && filtered.map((d, idx) => (
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
                    <td className="px-4 py-3">{doorStateBadge(d.door_state)}</td>
                    <td className="px-4 py-3"><Badge color={statusColor(d.status)}>{statusLabel(d.status)}</Badge></td>
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
            onPick={openPlan}
          />

          {/* 🟦 PC + Mobile : Viewer en MODAL plein écran */}
          <PlanModal
            open={!!selectedPlan}
            onClose={closePlan}
            title={selectedPlan ? (selectedPlan.display_name || selectedPlan.logical_name) : ""}
          >
            {selectedPlan && (
              <PlanViewerLeaflet
                ref={viewerRef}
                key={(selectedPlan?.id || selectedPlan?.logical_name || "") + "::modal"}
                fileUrl={planFileUrl}
                pageIndex={planPage}
                points={positions}
                onReady={handlePdfReady}
                onMovePoint={handleMovePoint}
                onClickPoint={handleClickPoint}
                onCreatePoint={createDoorAtCenter}
                unsavedIds={unsavedDoorIds}
                disabled={false}
                fitStrategy="once"
              />
            )}
            {!pdfReady && <div className="text-xs text-gray-500 px-1 pt-2">Chargement du plan…</div>}
          </PlanModal>
        </div>
      )}

      {/* Paramètres */}
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

      {/* Drawer Édition — z-index > modal */}
      {drawerOpen && editing && (
        <Drawer title={`Porte • ${editing.name || "nouvelle"}`} onClose={closeDrawerAndClearParam}>
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
                <div className="text-sm text-gray-500">Lance un contrôle pour remplir les 5 points ci-dessous.</div>
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
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60]" ref={ref}>
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

export default Doors;
