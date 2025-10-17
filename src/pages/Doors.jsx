// src/pages/Doors.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dayjs from "dayjs";
import 'dayjs/locale/fr';
dayjs.locale('fr');
/* >>> PDF.js (local via pdfjs-dist, plus de CDN) */
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
/* ----------------------------- Utils ----------------------------- */
function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
// Identité robuste (cookies -> localStorage -> fallback email)
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
  // ✅ vérifie r.ok et remonte un message d'erreur lisible
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
/* ----------------------------- API (Doors Maps) ----------------------------- */
const MAPS = {
  uploadZip: async (file) => {
    const fd = new FormData();
    fd.append("zip", file);
    const r = await fetch(`/api/doors/maps/uploadZip`, {
      method: "POST", credentials: "include", headers: userHeaders(), body: fd
    });
    return r.json();
  },
  listPlans: async () => (await fetch(`/api/doors/maps/plans`, withHeaders())).json(),
  renamePlan: async (logical_name, display_name) =>
    (await fetch(`/api/doors/maps/plan/${encodeURIComponent(logical_name)}/rename`, {
      method: "PUT",
      ...withHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ display_name }),
    })).json(),
  planFileUrl: (logical) => `/api/doors/maps/plan/${encodeURIComponent(logical)}/file`,
  planFileUrlById: (id) => `/api/doors/maps/plan/${encodeURIComponent(id)}/file`,
  positions: async (idOrLogical, page_index = 0) => {
    const looksUuid = typeof idOrLogical === "string" && /^[0-9a-fA-F-]{36}$/.test(idOrLogical);
    const params = looksUuid
      ? { id: idOrLogical, page_index }
      : { logical_name: idOrLogical, page_index };
    const r = await fetch(`/api/doors/maps/positions?${new URLSearchParams(params)}`, withHeaders());
    return r.json();
  },
  pendingPositions: async (logical_name, page_index = 0) => {
    const params = { logical_name, page_index };
    const r = await fetch(`/api/doors/maps/pending-positions?${new URLSearchParams(params)}`, withHeaders());
    return r.json();
  },
  setPosition: async (doorId, payload) =>
    (await fetch(`/api/doors/maps/positions/${encodeURIComponent(doorId)}`, {
      method: "PUT",
      ...withHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    })).json(),
};
// helper pour charger les PDFs protégés avec cookies + X-User-*
function pdfDocOpts(url) {
  return { url, withCredentials: true, httpHeaders: userHeaders() };
}
function planFileUrlSafe(plan) {
  const looksLikeUuid = typeof plan?.id === "string" && /^[0-9a-fA-F-]{36}$/.test(plan.id);
  return looksLikeUuid
    ? `/api/doors/maps/plan/${encodeURIComponent(plan.id)}/file`
    : `/api/doors/maps/plan/${encodeURIComponent(plan?.logical_name || "")}/file`;
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
// ✅ champs fond blanc + écriture noire
function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100
                 bg-white text-black placeholder-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Textarea({ value, onChange, className = "", ...p }) {
  return (
    <textarea
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100
                 bg-white text-black placeholder-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Select({ value, onChange, options = [], className = "", placeholder }) {
  return (
    <select
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100
                  bg-white text-black ${className}`}
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
              className={`min-h-[96px] p-2 border-t border-l last:border-r text-left transition
                ${inMonth ? "bg-white" : "bg-gray-50"} ${clickable ? "hover:bg-blue-50" : ""}`}
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
  const isMobile = useIsMobile(); // 🔹 NOUVEAU
  useEffect(() => {
    const el = obsRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setVisible(true); });
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // 🔹 MOBILE: pas de rendu PDF dans la vignette (évite crash/perf) → tuile simple
  useEffect(() => {
    if (isMobile) return; // skip rendu canvas si mobile
    if (!visible) return;
    let cancelled = false;
    let pdf = null;
    let renderTask = null;
    let loadingTask = null;
    (async () => {
      try {
        setThumbErr("");
        const url = planFileUrlSafe(plan);
        loadingTask = pdfjsLib.getDocument(pdfDocOpts(url));
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
        {/* 🔸 MOBILE: icône PDF plutôt que canvas */}
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
              <Btn variant="ghost" onClick={() => setEdit(true)}>✏️</Btn>
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
// --- PlanViewerLeaflet.jsx (inline pour simplicité) ---
import L from 'leaflet';

function PlanViewerLeaflet({
  fileUrl,
  pageIndex = 0,
  points = [],
  onReady,
  onMovePoint,
  onClickPoint,
  placingDoorId,
  onPlaceAt,
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const imageLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [picker, setPicker] = useState(null); // {x,y, items:[{door_id, door_name}]}

  // Rendu PDF -> image HD (2.5x) puis Leaflet ImageOverlay
  useEffect(() => {
    let cancelled = false;
    let pdf, loadingTask;
    (async () => {
      try {
        if (!wrapRef.current) return;
        // charge PDF
        loadingTask = pdfjsLib.getDocument({ ...pdfDocOpts(fileUrl), standardFontDataUrl: "/standard_fonts/" });
        pdf = await loadingTask.promise;
        const page = await pdf.getPage(Number(pageIndex) + 1);

        // calcule l’échelle HD
        const viewportBase = page.getViewport({ scale: 1 });
        const targetScale = 2.5; // ← qualité
        const viewport = page.getViewport({ scale: targetScale });

        // rendu offscreen
        const canvas = document.createElement('canvas');
        canvas.width  = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d', { alpha: true });
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (cancelled) return;

        const dataUrl = canvas.toDataURL('image/png');
        setImgSize({ w: canvas.width, h: canvas.height });

        // init map si besoin
        if (!mapRef.current) {
          const m = L.map(wrapRef.current, {
            crs: L.CRS.Simple,
            zoomControl: false,
            zoomAnimation: true,
            // options pro mobile :
            tap: true,
            tapTolerance: 20,
            inertia: true,
            wheelDebounceTime: 35,
            wheelPxPerZoomLevel: 60,
            preferCanvas: true,
          });
          L.control.zoom({ position: 'topright' }).addTo(m);
          mapRef.current = m;

          m.on('click', (e) => {
            // Placement d’une porte (mode “placingDoorId”)
            if (placingDoorId && onPlaceAt) {
              const { w, h } = imgSizeRef.current || { w: 1, h: 1 };
              const p = m.latLngToLayerPoint(e.latlng);
              const x = Math.min(1, Math.max(0, p.x / w));
              const y = Math.min(1, Math.max(0, p.y / h));
              onPlaceAt({ x, y });
              return;
            }
            // Désambiguïsation clic proche de plusieurs marqueurs
            const clicked = e.containerPoint;
            const near = [];
            markersLayerRef.current?.eachLayer((mk) => {
              const mp = m.latLngToContainerPoint(mk.getLatLng());
              const dist = Math.hypot(mp.x - clicked.x, mp.y - clicked.y);
              if (dist <= 18) near.push(mk.__meta); // meta injectée plus bas
            });
            if (near.length === 1 && onClickPoint) {
              onClickPoint(near[0]);
            } else if (near.length > 1) {
              // Ouvre un petit sélecteur
              setPicker({ x: clicked.x, y: clicked.y, items: near });
            } else {
              setPicker(null);
            }
          });

          // Ferme le picker si on bouge/zoome
          m.on('zoomstart movestart', () => setPicker(null));
        }

        // dimensions & bounds
        const map = mapRef.current;
        const bounds = L.latLngBounds([ [0,0], [viewport.height, viewport.width] ]); // (y,x)
        if (imageLayerRef.current) {
          map.removeLayer(imageLayerRef.current);
        }
        const layer = L.imageOverlay(dataUrl, bounds, { interactive: false, opacity: 1 });
        imageLayerRef.current = layer;
        layer.addTo(map);
        map.fitBounds(bounds, { padding: [10,10] });

        // couche des marqueurs
        if (!markersLayerRef.current) {
          markersLayerRef.current = L.layerGroup().addTo(map);
        }
        // (re)dessine les marqueurs
        drawMarkers(points, viewport.width, viewport.height);

        onReady?.();
      } catch (e) {
        // noop: laisse Leaflet vide si erreur
        console.error('Leaflet viewer error', e);
      } finally {
        try { pdf?.destroy(); } catch {}
        try { loadingTask?.destroy?.(); } catch {}
      }
    })();

    return () => { cancelled = true; };
  }, [fileUrl, pageIndex]);

  // garde taille en ref pour click/place
  const imgSizeRef = useRef(imgSize);
  useEffect(() => { imgSizeRef.current = imgSize; }, [imgSize]);

  // (re)dessine marqueurs quand points changent
  useEffect(() => {
    if (!mapRef.current || !imgSize.w) return;
    drawMarkers(points, imgSize.w, imgSize.h);
  }, [points, imgSize]);

  function markerClass(status) {
    if (status === STATUS.EN_RETARD) return 'door-marker door-marker--red';
    if (status === STATUS.EN_COURS)  return 'door-marker door-marker--amber';
    if (status === STATUS.A_FAIRE)   return 'door-marker door-marker--green';
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
        draggable: true,          // ← drag natif (mobile ok)
        autoPan: true,
        bubblingMouseEvents: false,
        keyboard: false,
        riseOnHover: true,
      });

      // stocke métadonnées pour la désambig
      mk.__meta = {
        door_id: p.door_id,
        door_name: p.door_name || p.name,
        status: p.status,
        x_frac: p.x_frac, y_frac: p.y_frac,
      };

      mk.on('click', (e) => {
        // on laisse la désambig globale (map click) décider si plusieurs sont proches
        // mais si seul, Leaflet déclenche ce click et near.length === 1 → onClickPoint
        // rien à faire ici
      });

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

  // UI de sélection quand plusieurs portes sont collées
  const onPickDoor = (d) => {
    setPicker(null);
    onClickPoint?.(d);
  };

  const wrapperHeight = Math.max(320, imgSize.h ? Math.min(imgSize.h, 1200) : 520);

  return (
    <div className="mt-3 relative">
      <div
        ref={wrapRef}
        className="relative w-full border rounded-2xl bg-white shadow-sm overflow-hidden"
        style={{ height: wrapperHeight }}
      />
      {/* Picker flottant */}
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
}
/**
 * PlanViewer — FIX mobile scroll & placement PC
 * - Zoom wheel / pinch
 * - Pan drag / tactile
 * - Déplacement marqueur
 * - Placement = tap court (ignore scroll > 8px), bouton gauche uniquement
 * - touchAction DYNAMIQUE: 'pan-y' par défaut, 'none' pendant interaction/zoom/placement
 */
function PlanViewer({
  fileUrl,
  pageIndex = 0,
  points = [],
  onReady,
  onMovePoint,
  onClickPoint,
  placingDoorId,
  onPlaceAt,
  onCreateDoorAt,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const isMarkerDragging = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [isMounted, setIsMounted] = useState(false);
  const [err, setErr] = useState("");
  const [containerWidth, setContainerWidth] = useState(0);
  // Vue (pan/scale) avec raf
  const [scale, _setScale] = useState(1);
  const [pan, _setPan] = useState({ x: 0, y: 0 });
  const viewRef = useRef({ scale: 1, panX: 0, panY: 0 });
  const rafRef = useRef(0);
  const pendingRef = useRef(false);
  function setScale(next) {
    viewRef.current.scale = next;
    scheduleRaf();
  }
  function setPan(next) {
    viewRef.current.panX = next.x;
    viewRef.current.panY = next.y;
    scheduleRaf();
  }
  function scheduleRaf() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      pendingRef.current = false;
      _setScale(viewRef.current.scale);
      _setPan({ x: viewRef.current.panX, y: viewRef.current.panY });
    });
  }
  // Vérifier canvas & largeur conteneur
  useEffect(() => {
    setIsMounted(!!canvasRef.current);
    if (wrapRef.current) {
      const updateWidth = () => setContainerWidth(wrapRef.current.offsetWidth);
      updateWidth();
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
  }, []);
  // pdf.js render (fit-to-width)
  useEffect(() => {
    let cancelled = false;
    let pdf = null;
    let loadingTask = null;
    const renderPdf = async () => {
      if (!isMounted || !canvasRef.current) {
        setErr("Canvas non disponible. Essayez de recharger le plan.");
        setLoaded(false);
        onReady?.();
        return;
      }
      try {
        setErr("");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
        }
        loadingTask = pdfjsLib.getDocument({ ...pdfDocOpts(fileUrl), standardFontDataUrl: "/standard_fonts/" });
        pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(Number(pageIndex) + 1);
        const viewport = page.getViewport({ scale: 1 });
        const fitWidth = containerWidth > 0 ? containerWidth : viewport.width;
        const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
        const maxCssWidth = isMobile ? Math.min(fitWidth, 900) : fitWidth;
        const scaleFactor = maxCssWidth / viewport.width;
        const adjustedViewport = page.getViewport({ scale: scaleFactor });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          setErr("Canvas non disponible ou rendu annulé.");
          setLoaded(false);
          onReady?.();
          return;
        }
        const ctx = canvas.getContext("2d");
        canvas.width = Math.floor(adjustedViewport.width);
        canvas.height = Math.floor(adjustedViewport.height);
        setPageSize({ w: canvas.width, h: canvas.height });
        await page.render({ canvasContext: ctx, viewport: adjustedViewport }).promise;
        if (!cancelled) {
          setLoaded(true);
          setScale(1);
          setPan({ x: 0, y: 0 });
          onReady?.();
        }
      } catch (e) {
        if (!cancelled) {
          setErr(`Erreur de rendu du plan : ${e.message}`);
          setLoaded(false);
          onReady?.();
        }
      }
    };
    let attempts = 0;
    const maxAttempts = 20;
    const interval = setInterval(() => {
      if (cancelled) { clearInterval(interval); return; }
      if (canvasRef.current && isMounted) {
        clearInterval(interval);
        renderPdf();
      } else if (++attempts >= maxAttempts) {
        setErr("Échec du rendu : canvas non disponible après plusieurs tentatives.");
        setLoaded(false);
        onReady?.();
        clearInterval(interval);
      }
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
      cancelAnimationFrame(rafRef.current);
      try { pdf?.destroy(); } catch {}
      try { loadingTask?.destroy?.(); } catch {}
    };
  }, [fileUrl, pageIndex, onReady, isMounted, containerWidth]);
  // Wheel zoom (desktop)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!loaded) return;
      const isZoom = e.ctrlKey || e.metaKey;
      if (!isZoom && Math.abs(e.deltaY) < 40) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - viewRef.current.panX;
      const cy = e.clientY - rect.top - viewRef.current.panY;
      const prev = viewRef.current.scale;
      const next = Math.max(0.5, Math.min(4, prev * (e.deltaY > 0 ? 0.92 : 1.08)));
      const nx = cx - (cx * next) / prev;
      const ny = cy - (cy * next) / prev;
      setScale(next);
      setPan({ x: viewRef.current.panX + nx, y: viewRef.current.panY + ny });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loaded]);
  // Gestes tactiles (pas de setPointerCapture sur touch)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let pointers = new Map();
    let base = null;
    const onPointerDown = (e) => {
      if (e.pointerType === "mouse") {
        try { el.setPointerCapture(e.pointerId); } catch {}
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onPointerMove = (e) => {
      if (isMarkerDragging.current) return;
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        if (!base) { base = { panX: viewRef.current.panX, panY: viewRef.current.panY, x: p.x, y: p.y }; return; }
        const dx = p.x - base.x;
        const dy = p.y - base.y;
        setPan({ x: base.panX + dx, y: base.panY + dy });
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (!base || base.dist == null) {
          base = { panX: viewRef.current.panX, panY: viewRef.current.panY, scale: viewRef.current.scale, cx: midX, cy: midY, dist };
          return;
        }
        const factor = Math.max(0.5, Math.min(4, base.scale * (dist / base.dist)));
        const rect = el.getBoundingClientRect();
        const relX = base.cx - rect.left - base.panX;
        const relY = base.cy - rect.top - base.panY;
        const nx = relX - (relX * factor) / base.scale;
        const ny = relY - (relY * factor) / base.scale;
        setScale(factor);
        setPan({ x: base.panX + nx, y: base.panY + ny });
      }
    };
    const onPointerUp = (e) => {
      if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
      if (pointers.size < 2) base = null;
      try { el.releasePointerCapture(e.pointerId); } catch {}
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);
  // (A) Tap pour PLACER (ignore si scroll > 8px, bouton gauche seulement)
  const lastDown = useRef(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const handlePointerDown = (e) => {
      lastDown.current = { x: e.clientX, y: e.clientY, t: performance.now?.() || Date.now(), btn: e.button };
    };
    const handlePointerUp = (e) => {
      if (!placingDoorId) return;
      if (typeof e.button === "number" && e.button !== 0 && e.pointerType === "mouse") return;
      const d = lastDown.current;
      const moved = d ? Math.hypot((e.clientX || 0) - d.x, (e.clientY || 0) - d.y) > 8 : false;
      if (moved) return;
      const xy = relativeXY(e);
      onPlaceAt?.(xy);
    };
    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("pointercancel", handlePointerUp);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [placingDoorId, onPlaceAt]);
  // (B) Appui long pour CRÉER (optionnel)
  useEffect(() => {
    if (!onCreateDoorAt) return;
    const el = overlayRef.current;
    if (!el) return;
    let longPressTimer = null;
    const LONG_MS = 600;
    let downXY = null;
    const handlePointerDown = (e) => {
      if (e.target?.dataset?.marker === "1") return;
      downXY = { x: e.clientX, y: e.clientY };
      if (!placingDoorId) {
        longPressTimer = setTimeout(() => {
          const xy = relativeXY(e);
          onCreateDoorAt?.(xy);
          longPressTimer = null;
        }, LONG_MS);
      }
    };
    const clearLP = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
    const handlePointerMove = (e) => {
      if (downXY && Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 8) clearLP();
    };
    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointercancel", clearLP);
    el.addEventListener("pointerup", clearLP);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointercancel", clearLP);
      el.removeEventListener("pointerup", clearLP);
      clearLP();
    };
  }, [placingDoorId, onCreateDoorAt]);
  // Drag + clic fiable sur marker (cleanup global ajouté)
  const dragInfo = useRef(null);
  function onPointerDownPoint(e, p) {
    e.stopPropagation();
    e.preventDefault();
    isMarkerDragging.current = true;
    dragInfo.current = {
      id: p.door_id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      baseXFrac: Number(p.x_frac ?? p.x ?? 0),
      baseYFrac: Number(p.y_frac ?? p.y ?? 0),
      pageW: pageSize.w || 1,
      pageH: pageSize.h || 1,
      scale: viewRef.current.scale,
    };
    window.addEventListener("pointermove", onMoveMarker);
    window.addEventListener("pointerup", onUpMarker, { once: true });
    window.addEventListener("pointercancel", onUpMarker, { once: true });
  }
  function onMoveMarker(e) {
    const info = dragInfo.current;
    if (!info) return;
    const dxPx = e.clientX - info.startX;
    const dyPx = e.clientY - info.startY;
    if (!info.moved && Math.hypot(dxPx, dyPx) > 4) info.moved = true;
    const dx = dxPx / (info.pageW * info.scale);
    const dy = dyPx / (info.pageH * info.scale);
    const x = Math.min(1, Math.max(0, info.baseXFrac + dx));
    const y = Math.min(1, Math.max(0, info.baseYFrac + dy));
    const node = overlayRef.current?.querySelector(`[data-id="${info.id}"]`);
    if (node) {
      node.style.left = `${x * 100}%`;
      node.style.top = `${y * 100}%`;
      node.style.transform = `translate(-50%, -50%)`;
    }
  }
  function onUpMarker() {
    window.removeEventListener("pointermove", onMoveMarker);
    isMarkerDragging.current = false;
    const info = dragInfo.current;
    dragInfo.current = null;
    if (!info) return;
    if (!info.moved) {
      const p = points.find(pt => pt.door_id === info.id);
      if (p) onClickPoint?.(p);
      return;
    }
    const node = overlayRef.current?.querySelector(`[data-id="${info.id}"]`);
    if (!node) return;
    const leftPct = parseFloat(node.style.left || "0");
    const topPct = parseFloat(node.style.top || "0");
    const x = (isFinite(leftPct) ? leftPct : 0) / 100;
    const y = (isFinite(topPct) ? topPct : 0) / 100;
    try { onMovePoint?.(info.id, { x, y }); } catch {}
  }
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMoveMarker);
      window.removeEventListener("pointerup", onUpMarker);
      window.removeEventListener("pointercancel", onUpMarker);
    };
  }, []);
  function markerClass(s) {
    if (s === STATUS.EN_RETARD) return "bg-rose-600 ring-2 ring-rose-300 animate-pulse";
    if (s === STATUS.EN_COURS) return "bg-amber-500 ring-2 ring-amber-300 animate-pulse";
    if (s === STATUS.A_FAIRE) return "bg-emerald-600 ring-1 ring-emerald-300";
    return "bg-blue-600 ring-1 ring-blue-300";
  }
  // Coordonnées relatives (guard évitant NaN)
  function relativeXY(evt) {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const wrect = wrap.getBoundingClientRect();
    const cx = Number(evt.clientX ?? 0);
    const cy = Number(evt.clientY ?? 0);
    const localX = cx - wrect.left - viewRef.current.panX;
    const localY = cy - wrect.top - viewRef.current.panY;
    const w = pageSize.w || wrap.clientWidth || 1;
    const h = pageSize.h || wrap.clientHeight || 1;
    const x = Math.min(1, Math.max(0, localX / (w * viewRef.current.scale)));
    const y = Math.min(1, Math.max(0, localY / (h * viewRef.current.scale)));
    return { x, y };
  }
  function handleContextMenu(e) {
    if (!onCreateDoorAt) return;
    if (e.target?.dataset?.marker === "1") return;
    e.preventDefault();
    const xy = relativeXY(e);
    onCreateDoorAt?.(xy);
  }
  // Mode interaction → touchAction dynamique pour éviter le “crash scroll” mobile
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const start = () => setInteractive(true);
    const stop = () => setTimeout(() => setInteractive(false), 150);
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    return () => {
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
  }, []);
  /* 🔸 Forcer un re-render de l’overlay quand la liste des points change
     (utile si React “recycle” les nodes et que la classe couleur doit changer) */
  const pointsVersion = useMemo(() => {
    // hash léger sur ids + status
    try {
      return (points || []).map(p => `${p.door_id}:${p.status}`).join("|");
    } catch { return String(Math.random()); }
  }, [points]);
  const wrapperHeight = Math.max(320, pageSize.h || 520);
  const touchAction =
    (placingDoorId || isMarkerDragging.current || scale !== 1) ? "none" : "pan-y";
  const placingCursor = placingDoorId ? "crosshair" : "default";
  return (
    <div className="mt-3">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden border rounded-2xl bg-white shadow-sm"
        style={{
          height: wrapperHeight,
          touchAction: touchAction,
          overscrollBehavior: 'contain',
          cursor: placingCursor,
        }}
      >
        <div
          className={`relative inline-block mx-auto ${interactive ? 'will-change-transform' : ''}`}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
            transformOrigin: "0 0",
            width: pageSize.w || "100%",
            height: pageSize.h || 520,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: pageSize.w || "100%", height: pageSize.h || 520, display: loaded ? "block" : "none" }}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              Rendu en cours…
            </div>
          )}
          <div
            key={pointsVersion /* 🔸 clé pour rafraichir classes couleur */}
            ref={overlayRef}
            className="absolute inset-0 z-10"
            style={{
              width: pageSize.w || "100%",
              height: pageSize.h || 520,
              touchAction: touchAction,
              cursor: placingCursor,
            }}
            onContextMenu={onCreateDoorAt ? handleContextMenu : undefined}
          >
            {points.map((p) => {
              const x = Number(p.x_frac ?? p.x ?? 0);
              const y = Number(p.y_frac ?? p.y ?? 0);
              const placed = x >= 0 && x <= 1 && y >= 0 && y <= 1;
              if (!placed) return null;
              return (
                <div
                  key={p.door_id}
                  data-id={p.door_id}
                  className="absolute"
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: "translate(-50%, -50%)" }}
                >
                  <button
                    title={p.door_name || p.name || p.door_id}
                    data-marker="1"
                    onPointerDown={(e) => onPointerDownPoint(e, p)}
                    className={`w-4 h-4 rounded-full shadow ${markerClass(p.status)}`}
                    style={{ transform: `scale(${1 / (viewRef.current?.scale || 1)})`, transformOrigin: "center center" }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {!loaded && pageSize.w === 0 && (
          <div className="p-3 text-sm text-gray-600">
            {err || "Erreur de rendu du plan. Vérifiez la console pour plus de détails."}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-emerald-600" /> À faire (vert)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" /> ≤30j (orange clignotant)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-rose-600 animate-pulse" /> En retard (rouge clignotant)
        </span>
      </div>
    </div>
  );
}
/* ----------------------------- Page principale ----------------------------- */
export default function Doors() {
  const [tab, setTab] = useState("controls"); // controls | calendar | settings | maps
  /* ---- listing + filters ---- */
  const [doors, setDoors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(""); // a_faire | en_cours_30 | en_retard | fait
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [doorState, setDoorState] = useState(""); // conforme | non_conforme
  /* ---- drawer (edit / inspect) ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null); // door object with details
  /* ---- calendar ---- */
  const [calendar, setCalendar] = useState({ events: [] });
  /* ---- toast ---- */
  const [toast, setToast] = useState("");
  /* ---- settings ---- */
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
  /* ---- versionnement fichiers pour refresh instantané ---- */
  const [filesVersion, setFilesVersion] = useState(0);
  /* ---------- Deep-link helpers (QR) ---------- */
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
  // -------- data loaders
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
  // First load
  useEffect(() => {
    reload();
    reloadCalendar();
    loadSettings();
  }, []);
  // Auto-open door from ?door=<id> (QR deep link)
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
  // Live filter (debounce)
  useEffect(() => {
    const t = setTimeout(() => {
      reload();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, building, floor, doorState]);
  const filtered = doors; // filtré côté serveur
  /* ------------------ actions door ------------------ */
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
      await loadUnplacedDoors(selectedPlan, planPage);
    }
  }
  /* ------------------ checklist workflow ------------------ */
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
      // 🔄 si le plan est ouvert, rafraîchir les points immédiatement (couleur/état)
      if (tab === "maps" && selectedPlan) {
        await loadPositions(selectedPlan, planPage);
        await loadUnplacedDoors(selectedPlan, planPage);
      }
    } else {
      const full = await API.get(editing.id);
      setEditing(full?.door);
    }
  }
  /* ------------------ files ------------------ */
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
  /* ------------------ settings save ------------------ */
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
  /* ------------------ MAPS state / loaders ------------------ */
  const [plans, setPlans] = useState([]); // {id, logical_name, display_name, page_count, actions_next_30, overdue}
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null); // plan object
  const planPage = 0; // Fixé à la première page
  const [positions, setPositions] = useState([]); // [{door_id, x_frac, y_frac, status, name}]
  const [pdfReady, setPdfReady] = useState(false); // viewer ready / fallback ok
  const [unplacedDoors, setUnplacedDoors] = useState([]); // [{door_id, door_name}]
  const [pendingPlaceDoorId, setPendingPlaceDoorId] = useState(null);
  // Cache des portes déjà placées sur tous les plans (pour filtrer les "en attente")
  const placedCacheRef = useRef({ plansHash: "", ids: new Set() });
  const [placedLoading, setPlacedLoading] = useState(false);
  function hashPlans(list) {
    return (list || []).map(p => p.id || p.logical_name).join("|");
  }
  async function getAllPlacedDoorIdsCached(plansList) {
    const h = hashPlans(plansList);
    if (placedCacheRef.current.plansHash === h && placedCacheRef.current.ids.size) {
      return placedCacheRef.current.ids;
    }
    setPlacedLoading(true);
    try {
      const keys = (plansList || []).map(p => p.id || p.logical_name);
      const results = await Promise.all(
        keys.map(key => MAPS.positions(key, 0).catch(() => ({ items: [] })))
      );
      const set = new Set();
      results.forEach(r => (r.items || []).forEach(it => set.add(it.door_id)));
      placedCacheRef.current = { plansHash: h, ids: set };
      return set;
    } finally {
      setPlacedLoading(false);
    }
  }
  async function loadPlans() {
    setMapsLoading(true);
    try {
      const r = await MAPS.listPlans().catch(() => ({ plans: [] }));
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
    } finally {
      setMapsLoading(false);
    }
  }
  async function loadPositions(plan, pageIdx = 0) {
    if (!plan) return;
    const key = plan.id || plan.logical_name || "";
    try {
      const r = await MAPS.positions(key, pageIdx).catch(() => ({ items: [] }));
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
  async function loadUnplacedDoors(plan, pageIdx = 0) {
    if (!plan) return;
    const key = plan.logical_name || "";
    const r = await MAPS.pendingPositions(key, pageIdx).catch(() => ({ pending: [] }));
    if (!plans?.length) { setUnplacedDoors([]); return; }
    const placed = await getAllPlacedDoorIdsCached(plans);
    let pending = Array.isArray(r?.pending) ? r.pending.map(p => ({
      ...p,
      door_name: p.door_name,
      status: p.status,
      building: p.building,
      floor: p.floor,
      door_state: p.door_state,
    })) : [];
    pending = pending.filter(it => !placed.has(it.door_id));
    pending = pending.filter(it => matchFilters(it));
    setUnplacedDoors(pending);
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
  useEffect(() => {
    if (tab === "maps") loadPlans();
  }, [tab]);
  // Stabiliser selectedPlan
  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan?.id, selectedPlan?.logical_name]);
  useEffect(() => {
    if (stableSelectedPlan) {
      loadPositions(stableSelectedPlan, planPage);
      loadUnplacedDoors(stableSelectedPlan, planPage);
    }
  }, [stableSelectedPlan, planPage, q, status, building, floor, doorState, plans]);
  /* ------------------ MAPS handlers ------------------ */
  const handlePdfReady = useCallback(() => setPdfReady(true), []);
  const handleMovePoint = useCallback(async (doorId, xy) => {
    if (!stableSelectedPlan) return;
    await MAPS.setPosition(doorId, {
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
  const handlePlaceAt = useCallback(async (xy) => {
    if (!pendingPlaceDoorId || !stableSelectedPlan) return;
    try {
      await MAPS.setPosition(pendingPlaceDoorId, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: planPage,
        x_frac: xy.x,
        y_frac: xy.y,
      });
      setPendingPlaceDoorId(null);
      await loadPositions(stableSelectedPlan, planPage);
      await loadUnplacedDoors(stableSelectedPlan, planPage);
      setToast("Porte placée avec succès ✅");
    } catch (e) {
      setToast("Erreur lors du placement de la porte : " + e.message);
    }
  }, [pendingPlaceDoorId, stableSelectedPlan, planPage]);
  // Création directe à l’endroit cliqué (désactivée par défaut)
  const handleCreateDoorAt = useCallback(async (xy) => {
    if (!stableSelectedPlan) return;
    try {
      const created = await API.create({
        name: "Nouvelle porte",
        building: "",
        floor: "",
        location: "",
        status: STATUS.A_FAIRE,
      });
      const id = created?.door?.id;
      if (!id) throw new Error("Création de porte impossible");
      await MAPS.setPosition(id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: planPage,
        x_frac: xy.x,
        y_frac: xy.y,
      });
      await loadPositions(stableSelectedPlan, planPage);
      await loadUnplacedDoors(stableSelectedPlan, planPage);
      setPendingPlaceDoorId(null);
      openEdit({ id, name: created?.door?.name || "Nouvelle porte" });
      setToast("Porte créée et placée ✅");
    } catch (e) {
      setToast("Erreur lors de la création : " + (e?.message || e));
    }
  }, [stableSelectedPlan, planPage]);
  async function createDoorAtCenter() {
    if (!stableSelectedPlan) return;
    try {
      const created = await API.create({
        name: "Nouvelle porte",
        building: "",
        floor: "",
        location: "",
        status: STATUS.A_FAIRE,
      });
      const id = created?.door?.id;
      if (!id) throw new Error("Création de porte impossible");
      await MAPS.setPosition(id, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: planPage,
        x_frac: 0.5,
        y_frac: 0.5,
      });
      await loadPositions(stableSelectedPlan, planPage);
      await loadUnplacedDoors(stableSelectedPlan, planPage);
      setPendingPlaceDoorId(null);
      openEdit({ id, name: created?.door?.name || "Nouvelle porte" });
      setToast("Porte créée au centre du plan ✅");
    } catch (e) {
      setToast("Erreur lors de la création : " + (e?.message || e));
    }
  }
  /* 🔁 Auto-refresh des positions quand l’onglet Plans est ouvert */
  useEffect(() => {
    if (tab !== "maps" || !stableSelectedPlan) return;
    const tick = () => {
      loadPositions(stableSelectedPlan, planPage);
      loadUnplacedDoors(stableSelectedPlan, planPage);
    };
    const iv = setInterval(tick, 8000); // toutes les 8s
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [tab, stableSelectedPlan, planPage, q, status, building, floor, doorState]);
  /* ------------------ render helpers ------------------ */
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
          {/* ❌ Bouton “+ Nouvelle porte” retiré ici (on le garde dans l’interface des plans) */}
        </div>
      </header>
      <StickyTabs />
      {/* Filtres (toggle) */}
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
      {/* Onglet Contrôles : liste des portes */}
      {tab === "controls" && (
        <div className="bg-white rounded-2xl border shadow-sm">
          {/* Mobile cards */}
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
                        {d.building || "—"} • {d.floor || "—"} {d.location ? `• ${d.location}` : ""}
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
          {/* Desktop table */}
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
                          {/* ❌ Bouton "Placer sur plan" retiré dans l'onglet Contrôles */}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Onglet Calendrier */}
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
      {/* Onglet Plans */}
      {tab === "maps" && (
        <div className="space-y-4">
          <PlansHeader
            mapsLoading={mapsLoading}
            onUploadZip={async (file) => {
              const r = await MAPS.uploadZip(file).catch(() => null);
              if (r?.ok) setToast("Plans importés ✅");
              await loadPlans();
            }}
          />
          <PlanCards
            plans={plans}
            onRename={async (plan, name) => {
              await MAPS.renamePlan(plan.logical_name, name);
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
                  {/* ➕ NOUVELLE PORTE (conservé ici) */}
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
                      setPendingPlaceDoorId(null);
                    }}
                  >
                    Fermer le plan
                  </Btn>
                </div>
              </div>
              {/* Bandeau portes en attente de positionnement — supprimé */}
              {selectedPlan && (
  <div className="bg-white rounded-2xl border shadow-sm p-3">
    {/* ... header ... */}

    <PlanViewerLeaflet
      key={stableSelectedPlan?.id || stableSelectedPlan?.logical_name || ""}
      fileUrl={planFileUrlSafe(stableSelectedPlan)}
      pageIndex={planPage}
      points={positions}
      onReady={handlePdfReady}
      onMovePoint={handleMovePoint}
      onClickPoint={handleClickPoint}
      placingDoorId={pdfReady ? pendingPlaceDoorId : null}
      onPlaceAt={handlePlaceAt}
    />
    {!pdfReady && <div className="text-xs text-gray-500 px-1 pt-2">Chargement du plan…</div>}
  </div>
)}
              {!pdfReady && (
                <div className="text-xs text-gray-500 px-1 pt-2">
                  Chargement du plan… (canvas pdf.js)
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Onglet Paramètres */}
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
      {/* Drawer: fiche porte + checklist + fichiers + QR */}
      {drawerOpen && editing && (
        <Drawer
          title={`Porte • ${editing.name || "nouvelle"}`}
          onClose={closeDrawerAndClearParam}
        >
          <div className="space-y-4">
            {/* Base info */}
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
            {/* Photo */}
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
            {/* Checklist */}
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
            {/* Fichiers / Photos (door-level) */}
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
            {/* QR Codes */}
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
            {/* Historique */}
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
