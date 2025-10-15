// src/pages/DoorsMaps.jsx
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import { api } from "@/lib/api";
// worker (obligatoire en front)
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function Btn({ children, className = "", variant = "primary", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    ghost: "bg-white text-gray-700 border hover:bg-gray-50",
  };
  return (
    <button
      className={`px-3 py-2 rounded-lg text-sm ${map[variant] || map.primary} ${className}`}
      {...p}
    >
      {children}
    </button>
  );
}

function PlanCard({ plan, onOpen, onRename }) {
  const canvasRef = useRef(null);
  const [thumbDone, setThumbDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = api.doorsMaps.planFileUrl(plan.id);
        const pdf = await pdfjsLib.getDocument(url).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.2 }); // petite vignette
        const c = canvasRef.current;
        if (!c) return;
        c.width = viewport.width;
        c.height = viewport.height;
        const ctx = c.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setThumbDone(true);
      } catch {
        // ignore pour la vignette
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  const [name, setName] = useState(plan.display_name || plan.logical_name);
  useEffect(() => {
    setName(plan.display_name || plan.logical_name);
  }, [plan.display_name, plan.logical_name]);

  async function commitName() {
    const clean = (name || "").trim();
    if (!clean || clean === (plan.display_name || plan.logical_name)) return;
    await onRename(plan.logical_name, clean);
  }

  return (
    <div className="border rounded-2xl bg-white overflow-hidden shadow-sm hover:shadow transition">
      <div className="aspect-video bg-gray-50 flex items-center justify-center">
        <canvas ref={canvasRef} className={thumbDone ? "" : "opacity-60"} />
      </div>
      <div className="p-3 space-y-2">
        <input
          className="w-full border rounded-lg px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
          }}
        />
        <div className="flex items-center justify-between text-xs">
          <div className="text-gray-500">Pages: {plan.page_count}</div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              ≤30j: {plan.actions_next_30}
            </span>
            {plan.overdue > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                Retard: {plan.overdue}
              </span>
            )}
          </div>
        </div>
        <Btn variant="ghost" onClick={() => onOpen(plan)}>
          Ouvrir
        </Btn>
      </div>
    </div>
  );
}

function Marker({ item, onDragEnd }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);

  const left = item.x_frac * item.canvasW;
  const top = item.y_frac * item.canvasH;

  // couleurs & blink — fallback si status manquant
  const s = item.status || "a_faire";
  const cls = "absolute w-[14px] h-[14px] rounded-full border-2 border-white shadow";
  let color = "bg-emerald-500"; // a_faire
  if (s === "en_cours_30") color = "bg-amber-500 animate-pulse";
  if (s === "en_retard") color = "bg-rose-500 animate-pulse";

  function onMouseDown(e) {
    e.preventDefault();
    setDrag(true);
  }
  function onMouseMove(e) {
    if (!drag) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const box = parent.getBoundingClientRect();
    const x = (e.clientX - box.left) / item.canvasW;
    const y = (e.clientY - box.top) / item.canvasH;
    if (!ref.current) return;
    ref.current.style.left = `${Math.max(0, Math.min(1, x)) * item.canvasW}px`;
    ref.current.style.top = `${Math.max(0, Math.min(1, y)) * item.canvasH}px`;
  }
  async function onMouseUp(e) {
    if (!drag) return;
    setDrag(false);
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const box = parent.getBoundingClientRect();
    const x = (e.clientX - box.left) / item.canvasW;
    const y = (e.clientY - box.top) / item.canvasH;
    onDragEnd(item, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
  }

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    parent.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      parent.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, item.canvasW, item.canvasH]);

  return (
    <div
      ref={ref}
      className={`${cls} ${color} cursor-move`}
      style={{ left, top, transform: "translate(-50%, -50%)" }}
      onMouseDown={onMouseDown}
      title={item.name}
    />
  );
}

function PlanViewer({ plan, onClose }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pdf, setPdf] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [items, setItems] = useState([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [error, setError] = useState("");

  async function loadPdf() {
    try {
      setLoadingPdf(true);
      setError("");
      const url = api.doorsMaps.planFileUrl(plan.id);
      const doc = await pdfjsLib.getDocument(url).promise;
      setPdf(doc);
    } catch (e) {
      setError("Impossible de charger le PDF.");
    } finally {
      setLoadingPdf(false);
    }
  }

  async function renderPage(idx) {
    if (!pdf) return;
    const page = await pdf.getPage(idx + 1);
    const viewport = page.getViewport({ scale: 1 });
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    // fit-to-width
    const maxW = Math.min(1200, wrapRef.current?.clientWidth || viewport.width);
    const scale = maxW / viewport.width;
    const v = page.getViewport({ scale });
    c.width = v.width;
    c.height = v.height;
    setSize({ w: v.width, h: v.height });
    await page.render({ canvasContext: ctx, viewport: v }).promise;
  }

  async function loadMarkers() {
    const r = await api.doorsMaps.positions(plan.logical_name, pageIndex);
    const list = (r?.items || []).map((it) => ({
      ...it,
      canvasW: size.w,
      canvasH: size.h,
    }));
    setItems(list);
  }

  useEffect(() => {
    loadPdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  useEffect(() => {
    if (pdf) renderPage(pageIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageIndex]);

  useEffect(() => {
    if (size.w > 0) loadMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, pageIndex]);

  async function onDragEnd(item, x, y) {
    await api.doorsMaps.setPosition(item.door_id, {
      logical_name: plan.logical_name,
      page_index: pageIndex,
      x_frac: x,
      y_frac: y,
    });
    await loadMarkers();
  }

  const pageCount = Number(plan.page_count || 1);

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="font-semibold truncate">{plan.display_name || plan.logical_name}</div>
        <div className="flex gap-2">
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={pageIndex}
            onChange={(e) => setPageIndex(Math.max(0, Math.min(pageCount - 1, Number(e.target.value))))}
          >
            {Array.from({ length: pageCount }).map((_, i) => (
              <option key={i} value={i}>
                Page {i + 1}
              </option>
            ))}
          </select>
          <Btn variant="ghost" onClick={onClose}>
            Fermer
          </Btn>
        </div>
      </div>
      <div ref={wrapRef} className="p-3 overflow-auto h-[calc(100%-48px)]">
        {loadingPdf && <div className="text-gray-500 p-2">Chargement du plan…</div>}
        {error && <div className="text-rose-600 p-2">{error}</div>}
        <div className="relative inline-block">
          <canvas ref={canvasRef} />
          <div className="absolute inset-0">
            {items.map((it, i) => (
              <Marker key={i} item={it} onDragEnd={onDragEnd} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DoorsMaps() {
  const [plans, setPlans] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function reload() {
    try {
      setLoading(true);
      setErr("");
      const r = await api.doorsMaps.listPlans();
      setPlans(r?.plans || []);
    } catch (e) {
      setErr("Impossible de charger la liste des plans.");
    } finally {
      setLoading(false);
    }
  }

  async function onRename(logical, display) {
    await api.doorsMaps.renamePlan(logical, display);
    await reload();
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl md:text-3xl font-extrabold">Plans (Maps)</h1>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
          <input
            type="file"
            accept=".zip"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              try {
                if (!f) return;
                await api.doorsMaps.uploadZip(f);
                await reload();
              } finally {
                // permet de ré-importer le même ZIP immédiatement
                e.target.value = "";
              }
            }}
          />
          Importer plans (ZIP)
        </label>
      </header>

      {err && <div className="text-rose-600">{err}</div>}

      {loading && <div className="text-gray-500">Chargement…</div>}

      {!loading && plans.length === 0 && (
        <div className="text-gray-500">Aucun plan pour le moment. Importez un ZIP pour commencer.</div>
      )}

      {/* Cards responsive */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} onOpen={setViewer} onRename={onRename} />
        ))}
      </div>

      {viewer && <PlanViewer plan={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}
