// src/pages/Doors.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dayjs from "dayjs";
/* >>> PDF.js (local via pdfjs-dist) */
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ----------------------------- Utils ----------------------------- */
function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
// NEW: identité robuste (cookies -> localStorage -> fallback depuis l'email)
function getIdentity() {
  let email = getCookie("email") || null;
  let name = getCookie("name") || null;
  try {
    if (!email) email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    if (!name) {
      name =
        localStorage.getItem("name") ||
        localStorage.getItem("user.name") ||
        null;
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
      name = base
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
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
  create: async (payload) =>
    (
      await fetch(`/api/doors/doors`, {
        method: "POST",
        ...withHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      })
    ).json(),
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
  return {
    url,
    withCredentials: true,
    httpHeaders: userHeaders(),
  };
}
/* ---------- ✅ Helper d’URL PDF (ID prioritaire, fallback logical) ---------- */
function planFileUrlSafe(plan) {
  const looksLikeUuid = typeof plan?.id === "string" && /^[0-9a-fA-F-]{36}$/.test(plan.id);
  return looksLikeUuid
    ? `/api/doors/maps/plan/${encodeURIComponent(plan.id)}/file`
    : `/api/doors/maps/plan/${encodeURIComponent(plan?.logical_name || "")}/file`;
}

/* ----------------------------- UI helpers ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-200 shadow-sm",
    ghost: "bg-white text-gray-700 border hover:bg-gray-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
    success: "bg-emerald-600 text-white hover:emerald-700",
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
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Textarea({ value, onChange, className = "", ...p }) {
  return (
    <textarea
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      {...p}
    />
  );
}
function Select({ value, onChange, options = [], className = "", placeholder }) {
  return (
    <select
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
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

/**
 * PlanViewer — rendu pdf.js sérialisé, gestes fluides, overlay non-bloquant, HiDPI rerender
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
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const layerRef = useRef(null);

  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewerH, setViewerH] = useState(520);

  // état piloté via refs (rAF)
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  // qualité pdf courante
  const qualityForScaleRef = useRef(1);
  const rerenderTimerRef = useRef(null);

  // rAF transform
  const rafRef = useRef(null);
  const needsFrame = useRef(false);
  const scheduleFrame = () => {
    if (needsFrame.current) return;
    needsFrame.current = true;
    rafRef.current = requestAnimationFrame(() => {
      needsFrame.current = false;
      if (!layerRef.current) return;
      const { x, y } = panRef.current;
      const s = scaleRef.current;
      layerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    });
  };

  // --- pdf.js render guards ---
  const pdfDocRef = useRef(null);     // PDFDocumentProxy
  const pdfUrlRef = useRef(null);     // pour détecter changement d'URL
  const renderTaskRef = useRef(null); // PageRenderTask
  const renderSeqRef = useRef(0);     // numéro de séquence des renders

  // limites
  const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const MAX_ZOOM = 3;
  const MAX_QUALITY_SCALE = 3 * DPR;

  const clampPan = (pan) => {
    const cw = wrapRef.current?.clientWidth || containerWidth || 0;
    const ch = wrapRef.current?.clientHeight || viewerH || 0;
    const contentW = (pageSize.w || 0) * scaleRef.current;
    const contentH = (pageSize.h || 0) * scaleRef.current;
    if (cw === 0 || ch === 0 || contentW === 0 || contentH === 0) return pan;
    const margin = 20;
    const minX = Math.min(margin, cw - contentW - margin);
    const maxX = Math.max(-margin, margin);
    const minY = Math.min(margin, ch - contentH - margin);
    const maxY = Math.max(-margin, margin);
    return {
      x: Math.max(minX, Math.min(maxX, pan.x)),
      y: Math.max(minY, Math.min(maxY, pan.y)),
    };
  };

  // taille wrapper & hauteur responsive
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.style.touchAction = "none"; // bloque les gestes natifs (évite les "crans")
    const onResize = () => {
      setContainerWidth(wrap.offsetWidth || 0);
      const dvh = Math.max(window.innerHeight || 700, 700) * 0.85;
      setViewerH(Math.max(320, Math.floor(dvh)));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // rendu PDF (sérialisé + annulable)
  const renderPdfAtQuality = useCallback(async (requestedScaleForQuality = 1) => {
    const seq = ++renderSeqRef.current;
    console.log("[PLANVIEWER][renderPdfAtQuality] start", { requestedScaleForQuality, seq, fileUrl });

    // annule un render en cours (sinon erreur "same canvas")
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
        await renderTaskRef.current.promise.catch(() => {});
      } catch {}
      renderTaskRef.current = null;
    }

    // charge ou recharge le doc si nécessaire
    if (!pdfDocRef.current || pdfUrlRef.current !== fileUrl) {
      if (pdfDocRef.current) {
        try { await pdfDocRef.current.destroy(); } catch {}
        pdfDocRef.current = null;
      }
      const loadingTask = pdfjsLib.getDocument({ ...pdfDocOpts(fileUrl), standardFontDataUrl: "/standard_fonts/" });
      pdfDocRef.current = await loadingTask.promise;
      pdfUrlRef.current = fileUrl;
      console.log("[PLANVIEWER] pdf loaded", { numPages: pdfDocRef.current.numPages, url: pdfUrlRef.current });
    }

    const page = await pdfDocRef.current.getPage(Number(pageIndex) + 1);

    // viewport logique (fit-to-width)
    const native = page.getViewport({ scale: 1 });
    const fitWidth = containerWidth > 0 ? containerWidth : native.width;
    const scaleFactor = fitWidth / native.width;

    // HiDPI pour bitmap
    const qualityScale = Math.min(MAX_QUALITY_SCALE, Math.max(1, requestedScaleForQuality * DPR));
    const viewportHiDPI = page.getViewport({ scale: scaleFactor * qualityScale });

    const canvas = canvasRef.current;
    if (!canvas) throw new Error("canvas manquant");

    const logicalW = Math.floor(native.width * scaleFactor);
    const logicalH = Math.floor(native.height * scaleFactor);

    canvas.width = Math.floor(viewportHiDPI.width);
    canvas.height = Math.floor(viewportHiDPI.height);
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

    const task = page.render({ canvasContext: ctx, viewport: viewportHiDPI });
    renderTaskRef.current = task;

    await task.promise.finally(() => {
      if (renderTaskRef.current === task) renderTaskRef.current = null;
    });

    if (seq !== renderSeqRef.current) {
      console.log("[PLANVIEWER] render ignored (stale seq)", { seq, current: renderSeqRef.current });
      return;
    }

    setPageSize({ w: logicalW, h: logicalH });
    qualityForScaleRef.current = Math.max(1, requestedScaleForQuality);
    setLoaded(true);
    console.log("[PLANVIEWER][renderPdfAtQuality] done", { logicalW, logicalH, quality: qualityForScaleRef.current, seq });
  }, [fileUrl, pageIndex, containerWidth]);

  // rendu initial
  useEffect(() => {
    console.log("[PLANVIEWER] initial render…", { fileUrl, pageIndex, containerWidth });
    let cancelled = false;
    (async () => {
      try {
        setErr("");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
        }
        await renderPdfAtQuality(1);
        if (cancelled) return;
        scaleRef.current = 1;
        panRef.current = { x: 0, y: 0 };
        scheduleFrame();
        onReady?.();
      } catch (e) {
        if (!cancelled) {
          console.error("[PLANVIEWER] initial render FAIL:", e);
          setErr(`Erreur de rendu du plan : ${e.message}`);
          setLoaded(false);
          onReady?.();
        }
      }
    })();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
      }
    };
  }, [fileUrl, pageIndex, containerWidth, onReady, renderPdfAtQuality]);

  // (re)rendu HiDPI après zoom (debounce)
  const requestHiDpiRerender = useCallback(() => {
    if (!loaded) return;
    if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current);
    rerenderTimerRef.current = setTimeout(async () => {
      rerenderTimerRef.current = null;
      const need = Math.min(MAX_ZOOM, Math.max(1, scaleRef.current));
      if (need > qualityForScaleRef.current * 0.92) {
        try {
          await renderPdfAtQuality(need);
          scheduleFrame();
        } catch (e) {
          console.warn("[PLANVIEWER] HiDPI rerender failed:", e);
        }
      }
    }, 160);
  }, [loaded, renderPdfAtQuality]);

  // WHEEL zoom (desktop)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e) => {
      if (!loaded) return;
      console.log("[PLANVIEWER] wheel", { ctrl: e.ctrlKey || e.metaKey, deltaY: e.deltaY });
      const isZoom = e.ctrlKey || e.metaKey;
      if (!isZoom && Math.abs(e.deltaY) < 40) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const cx = e.clientX - rect.left - panRef.current.x;
      const cy = e.clientY - rect.top - panRef.current.y;
      const prev = scaleRef.current;
      const next = Math.max(0.5, Math.min(MAX_ZOOM, prev * (e.deltaY > 0 ? 0.9 : 1.1)));
      const nx = cx - (cx * next) / prev;
      const ny = cy - (cy * next) / prev;
      scaleRef.current = next;
      panRef.current = clampPan({ x: panRef.current.x + nx, y: panRef.current.y + ny });
      scheduleFrame();
      requestHiDpiRerender();
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [loaded, requestHiDpiRerender]);

  // Gestes pointer: pan + pinch + double-tap + inertie
  useEffect(() => {
    console.log("[PLANVIEWER] pointer handlers mounted");
    const wrap = wrapRef.current;
    if (!wrap) return;

    const pointers = new Map();
    let singlePanBase = null;
    let pinchBase = null;

    let velocity = { x: 0, y: 0 };
    let lastMoveT = 0, lastMoveX = 0, lastMoveY = 0;
    let inertiaId = null;

    const stopInertia = () => { if (inertiaId) cancelAnimationFrame(inertiaId); inertiaId = null; };
    const startInertia = () => {
      stopInertia();
      const FRICTION = 0.92;
      const MIN_SPEED = 0.15;
      const step = () => {
        velocity.x *= FRICTION;
        velocity.y *= FRICTION;
        if (Math.hypot(velocity.x, velocity.y) < MIN_SPEED) { inertiaId = null; return; }
        panRef.current = clampPan({ x: panRef.current.x + velocity.x, y: panRef.current.y + velocity.y });
        scheduleFrame();
        inertiaId = requestAnimationFrame(step);
      };
      inertiaId = requestAnimationFrame(step);
    };

    let lastTapTime = 0;
    let lastTapPos = { x: 0, y: 0 };

    const onPointerDown = (e) => {
      wrap.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stopInertia();

      if (e.pointerType === "touch" && pointers.size === 1) {
        const now = performance.now();
        const dt = now - lastTapTime;
        const dist = Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y);
        if (dt < 300 && dist < 24) {
          const rect = wrap.getBoundingClientRect();
          const cx = e.clientX - rect.left - panRef.current.x;
          const cy = e.clientY - rect.top - panRef.current.y;
          const prev = scaleRef.current;
          const next = prev < 1.2 ? 1.8 : 1;
          const nx = cx - (cx * next) / prev;
          const ny = cy - (cy * next) / prev;
          scaleRef.current = next;
          panRef.current = clampPan({ x: panRef.current.x + nx, y: panRef.current.y + ny });
          scheduleFrame();
          requestHiDpiRerender();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
        lastTapPos = { x: e.clientX, y: e.clientY };
      }
    };

    const onPointerMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prevP = pointers.get(e.pointerId);
      const curP = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, curP);

      const now = performance.now();

      if (pointers.size === 1) {
        const p = Array.from(pointers.values())[0];
        if (!singlePanBase) {
          singlePanBase = {
            startX: p.x, startY: p.y,
            baseX: panRef.current.x, baseY: panRef.current.y
          };
          lastMoveT = now; lastMoveX = p.x; lastMoveY = p.y;
          return;
        }
        const dx = p.x - singlePanBase.startX;
        const dy = p.y - singlePanBase.startY;
        panRef.current = clampPan({ x: singlePanBase.baseX + dx, y: singlePanBase.baseY + dy });
        scheduleFrame();
        const dt = Math.max(1, now - lastMoveT);
        velocity = { x: (p.x - lastMoveX) / (dt / (1000 / 60)), y: (p.y - lastMoveY) / (dt / (1000 / 60)) };
        lastMoveT = now; lastMoveX = p.x; lastMoveY = p.y;
      } else if (pointers.size === 2) {
        const [p1, p2] = Array.from(pointers.values());
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (!pinchBase) {
          pinchBase = { dist, scale: scaleRef.current, panX: panRef.current.x, panY: panRef.current.y, cx, cy };
          return;
        }
        const factor = Math.max(0.5, Math.min(MAX_ZOOM, (pinchBase.scale * dist) / pinchBase.dist));
        const rect = wrap.getBoundingClientRect();
        const localX = pinchBase.cx - rect.left - pinchBase.panX;
        const localY = pinchBase.cy - rect.top - pinchBase.panY;
        const nx = localX - (localX * factor) / pinchBase.scale;
        const ny = localY - (localY * factor) / pinchBase.scale;
        scaleRef.current = factor;
        panRef.current = clampPan({ x: pinchBase.panX + nx, y: pinchBase.panY + ny });
        scheduleFrame();
      }
    };

    const onPointerUp = (e) => {
      if (pointers.has(e.pointerId)) {
        wrap.releasePointerCapture(e.pointerId);
        pointers.delete(e.pointerId);
      }
      if (pointers.size < 2) pinchBase = null;

      if (pointers.size === 1) {
        const p = Array.from(pointers.values())[0];
        singlePanBase = { startX: p.x, startY: p.y, baseX: panRef.current.x, baseY: panRef.current.y };
      } else {
        if (Math.hypot(velocity.x, velocity.y) > 0.5) startInertia();
        singlePanBase = null;
        requestHiDpiRerender();
      }
    };

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);
    return () => {
      wrap.removeEventListener("pointerdown", onPointerDown);
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerup", onPointerUp);
      wrap.removeEventListener("pointercancel", onPointerUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current);
    };
  }, [requestHiDpiRerender]);

  // click/touch pour placer (actif seulement en mode placement)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const handlePointerDown = (e) => {
      if (!placingDoorId) return;
      if (e.target.dataset?.marker === "1") return;
      e.stopPropagation();
      const xy = relativeXY(e);
      console.log("[PLANVIEWER] place at", xy);
      onPlaceAt?.(xy);
    };
    el.addEventListener("pointerdown", handlePointerDown);
    return () => el.removeEventListener("pointerdown", handlePointerDown);
  }, [placingDoorId, onPlaceAt]);

  // drag marker
  const dragInfo = useRef(null);
  function onMouseDownPoint(e, p) {
    e.stopPropagation();
    if (!overlayRef.current) return;
    dragInfo.current = {
      id: p.door_id,
      startX: e.clientX,
      startY: e.clientY,
      baseXFrac: Number(p.x_frac ?? p.x ?? 0),
      baseYFrac: Number(p.y_frac ?? p.y ?? 0),
      pageW: pageSize.w || 1,
      pageH: pageSize.h || 1,
      scale: scaleRef.current,
    };
    window.addEventListener("mousemove", onMoveMarker);
    window.addEventListener("mouseup", onUpMarker);
  }
  function onMoveMarker(e) {
    const info = dragInfo.current;
    if (!info) return;
    const dx = (e.clientX - info.startX) / (info.pageW * info.scale);
    const dy = (e.clientY - info.startY) / (info.pageH * info.scale);
    const x = Math.min(1, Math.max(0, info.baseXFrac + dx));
    const y = Math.min(1, Math.max(0, info.baseYFrac + dy));
    const el = overlayRef.current?.querySelector(`[data-id="${info.id}"]`);
    if (el) {
      el.style.left = `${x * 100}%`;
      el.style.top = `${y * 100}%`;
      el.style.transform = `translate(-50%, -50%)`;
    }
  }
  function onUpMarker() {
    const info = dragInfo.current;
    window.removeEventListener("mousemove", onMoveMarker);
    window.removeEventListener("mouseup", onUpMarker);
    if (!info) return;
    const el = overlayRef.current?.querySelector(`[data-id="${info.id}"]`);
    if (!el) { dragInfo.current = null; return; }
    const x = (parseFloat(el.style.left || "0") || 0) / 100;
    const y = (parseFloat(el.style.top || "0") || 0) / 100;
    try { onMovePoint?.(info.id, { x, y }); } catch {}
    dragInfo.current = null;
  }

  function markerClass(s) {
    if (s === STATUS.EN_RETARD) return "bg-rose-600 ring-2 ring-rose-300 animate-pulse";
    if (s === STATUS.EN_COURS) return "bg-amber-500 ring-2 ring-amber-300 animate-pulse";
    if (s === STATUS.A_FAIRE) return "bg-emerald-600 ring-1 ring-emerald-300";
    return "bg-blue-600 ring-1 ring-blue-300";
  }

  function relativeXY(evt) {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const rect = wrap.getBoundingClientRect();
    const localX = evt.clientX - rect.left - panRef.current.x;
    const localY = evt.clientY - rect.top - panRef.current.y;
    const w = pageSize.w || wrap.clientWidth || 1;
    const h = pageSize.h || wrap.clientHeight || 1;
    const x = Math.min(1, Math.max(0, localX / (w * scaleRef.current)));
    const y = Math.min(1, Math.max(0, localY / (h * scaleRef.current)));
    return { x, y };
  }

  useEffect(() => {
    console.log("[PLANVIEWER] points update", points);
  }, [points]);

  const finalHeight = Math.min(viewerH, pageSize.h || viewerH);

  return (
    <div className="mt-3">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden border rounded-2xl bg-white shadow-sm"
        style={{ height: finalHeight }}
      >
        <div
          ref={layerRef}
          className="relative inline-block will-change-transform"
          style={{
            transformOrigin: "0 0",
            width: pageSize.w || "100%",
            height: pageSize.h || finalHeight,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: pageSize.w || "100%",
              height: pageSize.h || finalHeight,
              display: loaded ? "block" : "none",
            }}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              Rendu en cours…
            </div>
          )}
          <div
            ref={overlayRef}
            className="absolute inset-0 z-10"
            style={{
              width: pageSize.w || "100%",
              height: pageSize.h || finalHeight,
              // 🔑 laisse passer les gestes vers le wrap, sauf en mode placement
              pointerEvents: placingDoorId ? "auto" : "none",
            }}
          >
            {points.map((p) => {
              const x = Number(p.x_frac ?? p.x ?? 0);
              const y = Number(p.y_frac ?? p.y ?? 0);
              if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
              return (
                <div
                  key={p.door_id}
                  data-id={p.door_id}
                  className="absolute"
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    // le conteneur ne bloque pas les gestes
                    pointerEvents: "none",
                  }}
                >
                  <button
                    title={p.name || p.door_name || p.door_id}
                    data-marker="1"
                    onMouseDown={(e) => onMouseDownPoint(e, p)}
                    onClick={(e) => { e.stopPropagation(); onClickPoint?.(p); }}
                    className={`w-4 h-4 rounded-full shadow ${markerClass(p.status)}`}
                    // mais le bouton, oui
                    style={{ pointerEvents: "auto" }}
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
  const startDow = (startOfMonth.getDay() + 6) % 7; // lundi = 0
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
          <div key={l} className="px-2 py-2">{l}</div>
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
            if (f) {
              console.log("[PlansHeader] Upload ZIP…", f);
              onUploadZip(f);
            }
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

  // Miniature page 1 via pdf.js
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setThumbErr("");
        const url = planFileUrlSafe(plan);
        const loadingTask = pdfjsLib.getDocument(pdfDocOpts(url));
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.25 });
        const c = canvasRef.current;
        if (!c || cancelled) return;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        const ctx = c.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        console.log("[PlanCard] thumb rendered", { logical: plan.logical_name, id: plan.id });
      } catch (e) {
        if (!cancelled) {
          console.warn("[PlanCard] thumb error:", e);
          setThumbErr("Aperçu indisponible.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [plan.id, plan.logical_name]);

  return (
    <div className="border rounded-2xl bg-white shadow-sm hover:shadow transition overflow-hidden">
      <div className="aspect-video bg-gray-50 flex items-center justify-center">
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        {!!thumbErr && <div className="text-xs text-gray-500">{thumbErr}</div>}
      </div>
      <div className="p-3">
        {!edit ? (
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate" title={name}>{name || "—"}</div>
            <div className="flex items-center gap-1">
              <Btn variant="ghost" onClick={() => setEdit(true)}>✏️</Btn>
              <Btn
                variant="subtle"
                onClick={() => {
                  console.log("[PlansHeader] Picking plan:", plan);
                  onPick(plan);
                }}
              >
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
        <div className="flex items-center gap-2 mt-2 text-xs">
          <Badge color="orange">≤30j: {next30}</Badge>
          <Badge color="red">Retard: {overdue}</Badge>
        </div>
      </div>
    </div>
  );
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

/* ----------------------------- Page principale ----------------------------- */
export default function Doors() {
  console.log("[Doors] mount");
  const [tab, setTab] = useState("controls"); // controls | calendar | settings | maps

  /* ---- listing + filters ---- */
  const [doors, setDoors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [doorState, setDoorState] = useState("");

  /* ---- drawer (edit / inspect) ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);

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

  // Auto-open door from ?door=<id>
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

  const filtered = doors;

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
      const created = await API.create(payload);
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
  const [plans, setPlans] = useState([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const planPage = 0;
  const [positions, setPositions] = useState([]);
  const [pdfReady, setPdfReady] = useState(false);
  const [unplacedDoors, setUnplacedDoors] = useState([]);
  const [pendingPlaceDoorId, setPendingPlaceDoorId] = useState(null);

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
    console.log("[MAPS] Loading positions for plan:", { key, pageIdx });
    try {
      const r = await MAPS.positions(key, pageIdx).catch(() => ({ items: [] }));
      console.log("[MAPS] Raw positions response:", r);
      const positions = Array.isArray(r?.items)
        ? r.items.map((item) => ({
            door_id: item.door_id,
            door_name: item.name || item.door_name,
            x_frac: Number(item.x_frac ?? item.x ?? 0),
            y_frac: Number(item.y_frac ?? item.y ?? 0),
            x: Number(item.x_frac ?? item.x ?? 0),
            y: Number(item.y_frac ?? item.y ?? 0),
            status: item.status,
          }))
        : [];
      console.log("[MAPS] Processed positions:", positions);
      setPositions(positions);
    } catch (e) {
      console.error("[MAPS] Failed to load positions:", e.message);
      setPositions([]);
    }
  }

  async function loadUnplacedDoors(plan, pageIdx = 0) {
    if (!plan) return;
    const key = plan.logical_name || "";
    const r = await MAPS.pendingPositions(key, pageIdx).catch(() => ({ pending: [] }));
    setUnplacedDoors(Array.isArray(r?.pending) ? r.pending : []);
  }

  useEffect(() => {
    if (tab === "maps") loadPlans();
  }, [tab]);

  const stableSelectedPlan = useMemo(() => selectedPlan, [selectedPlan?.id]);

  useEffect(() => {
    console.log("[MAPS] selectedPlan changed:", stableSelectedPlan);
    if (stableSelectedPlan) {
      loadPositions(stableSelectedPlan, planPage);
      loadUnplacedDoors(stableSelectedPlan, planPage);
      setPendingPlaceDoorId(null);
    }
  }, [stableSelectedPlan, planPage]);

  /* ------------------ MAPS handlers ------------------ */
  const handlePdfReady = useCallback(() => {
    console.log("[MAPS] PlanViewer ready");
    setPdfReady(true);
  }, []);
  const handleMovePoint = useCallback(
    async (doorId, xy) => {
      console.log("[MAPS] Moving point:", { doorId, xy });
      if (!stableSelectedPlan) return;
      await MAPS.setPosition(doorId, {
        logical_name: stableSelectedPlan.logical_name,
        plan_id: stableSelectedPlan.id,
        page_index: planPage,
        x_frac: xy.x,
        y_frac: xy.y,
      });
      await loadPositions(stableSelectedPlan, planPage);
    },
    [stableSelectedPlan, planPage]
  );
  const handleClickPoint = useCallback((p) => {
    console.log("[MAPS] Clicking point:", p);
    openEdit({ id: p.door_id, name: p.name });
  }, []);
  const handlePlaceAt = useCallback(
    async (xy) => {
      console.log("[MAPS] Placing door at:", { doorId: pendingPlaceDoorId, xy });
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
        console.error("[MAPS] Failed to place door:", e.message);
        setToast("Erreur lors du placement de la porte : " + e.message);
      }
    },
    [pendingPlaceDoorId, stableSelectedPlan, planPage]
  );

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
          <Btn onClick={openCreate}>+ Nouvelle porte</Btn>
        </div>
      </header>

      <StickyTabs />

      {/* Filtres */}
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

      {/* Onglet Contrôles */}
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
                      <td className="px-4 py-3">{doorStateBadge(d.door_state)}</td>
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
              console.log("[MAPS] Picking plan:", plan);
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
                  <Btn variant="ghost" onClick={() => setSelectedPlan(null)}>
                    Fermer le plan
                  </Btn>
                </div>
              </div>

              {/* Bandeau portes en attente de positionnement */}
              <div className="mt-3 p-2 rounded-xl border bg-amber-50/60">
                <div className="text-sm text-amber-700 font-medium">
                  Portes en attente de positionnement ({unplacedDoors.length})
                </div>
                {!unplacedDoors.length && (
                  <div className="text-xs text-amber-700/80 mt-1">Aucune porte en attente pour cette page.</div>
                )}
                {!!unplacedDoors.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {unplacedDoors.map((p) => (
                      <button
                        key={p.door_id}
                        className={`px-2 py-1 rounded-md border text-xs transition ${
                          pendingPlaceDoorId === p.door_id
                            ? "bg-amber-600 text-white border-amber-700"
                            : "bg-white text-amber-800 border-amber-200 hover:bg-amber-100"
                        }`}
                        onClick={() => {
                          console.log("[MAPS] Selecting door for placement:", p.door_id);
                          setPendingPlaceDoorId((cur) => (cur === p.door_id ? null : p.door_id));
                        }}
                        title="Cliquer puis cliquer sur le plan pour placer"
                      >
                        Placer • {p.door_name}
                      </button>
                    ))}
                    {pendingPlaceDoorId && (
                      <button
                        className="px-2 py-1 rounded-md border text-xs bg-white text-gray-700 hover:bg-gray-50"
                        onClick={() => {
                          console.log("[MAPS] Cancelling placement");
                          setPendingPlaceDoorId(null);
                        }}
                      >
                        Annuler le placement
                      </button>
                    )}
                  </div>
                )}
                {!!pendingPlaceDoorId && (
                  <div className="text-xs text-amber-700/90 mt-2">
                    Astuce : cliquez/touchez l’endroit souhaité sur le plan pour déposer «{" "}
                    {unplacedDoors.find((u) => u.door_id === pendingPlaceDoorId)?.door_name || "porte"} ».
                  </div>
                )}
              </div>

              <PlanViewer
                key={stableSelectedPlan?.id || stableSelectedPlan?.logical_name || ""}
                fileUrl={planFileUrlSafe(stableSelectedPlan)}
                pageIndex={planPage}
                points={positions}
                onReady={handlePdfReady}
                onMovePoint={handleMovePoint}
                onClickPoint={handleClickPoint}
                placingDoorId={pendingPlaceDoorId}
                onPlaceAt={handlePlaceAt}
              />
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
        <Drawer title={`Porte • ${editing.name || "nouvelle"}`} onClose={closeDrawerAndClearParam}>
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
                <div className="text-sm text-gray-500">Lance un contrôle pour remplir les 5 points ci-dessous.</div>
              )}
              {!!editing.current_check && (
                <div className="space-y-3">
                  {(editing.current_check.itemsView || settings.checklist_template || defaultTemplate)
                    .slice(0, 5)
                    .map((label, i) => {
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

            {/* Fichiers / Photos */}
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
                  <div className="text-sm text-gray-600">Glisser-déposer des fichiers ici, ou utiliser “Ajouter”.</div>
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
                          <a
                            key={f.id}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs"
                          >
                            {f.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {h.nc_pdf_url ? (
                      <a
                        href={h.nc_pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs"
                      >
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
