// ============================================================================
// src/pages/Controls-map.jsx
// Visualisation des contrôles sur plan (PDF + Leaflet)
// Inspiré d'Atex-map.jsx — adapté pour les équipements de contrôle
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/controls.css";
import { api } from "../lib/api.js";
import { RefreshCw, Layers, Eye, EyeOff } from "lucide-react";

// ---------------------------------------------------------------------------
// Bouton intégré (remplace l'import "@/components/ui/button")
// ---------------------------------------------------------------------------
function Button({ children, variant = "primary", size = "md", ...props }) {
  const base =
    "inline-flex items-center justify-center font-semibold rounded-lg transition-all disabled:opacity-50";
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    ghost: "bg-transparent text-gray-600 hover:bg-gray-100",
  };
  const sizes = {
    sm: "px-2.5 py-1.5 text-sm",
    md: "px-3.5 py-2 text-sm",
  };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]}`} {...props}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PDF.js setup
// ---------------------------------------------------------------------------
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

// ---------------------------------------------------------------------------
// Icônes / couleurs
// ---------------------------------------------------------------------------
const STATUS_COLOR = {
  conforme: { fill: "#10b981", border: "#6ee7b7" },
  non_conforme: { fill: "#ef4444", border: "#fca5a5" },
  non_applicable: { fill: "#9ca3af", border: "#d1d5db" },
  overdue: { fill: "#f59e0b", border: "#fbbf24" },
  pending: { fill: "#3b82f6", border: "#93c5fd" },
};
const ICON_SIZE = 22;

function makeIcon(status = "pending") {
  const map = STATUS_COLOR[status] || STATUS_COLOR.pending;
  const html = `<div style="
    width:${ICON_SIZE}px;height:${ICON_SIZE}px;
    border-radius:9999px;background:${map.fill};
    border:2px solid ${map.border};
    box-shadow:0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12);
  "></div>`;
  return L.divIcon({
    className: "controls-marker-inline",
    html,
    iconSize: [ICON_SIZE, ICON_SIZE],
    iconAnchor: [ICON_SIZE / 2, ICON_SIZE / 2],
    popupAnchor: [0, -ICON_SIZE / 2],
  });
}

// ---------------------------------------------------------------------------
// Légende
// ---------------------------------------------------------------------------
function addLegend(map) {
  const ctrl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const el = L.DomUtil.create("div", "leaflet-bar leaflet-control bg-white rounded-xl border shadow p-2");
      el.innerHTML = `
        <div class="text-xs font-semibold mb-1">Statuts de contrôle</div>
        <div class="flex flex-col gap-1 text-[11px]">
          <div class="flex items-center gap-2"><span style="background:#10b981;width:12px;height:12px;border-radius:9999px"></span> Conforme</div>
          <div class="flex items-center gap-2"><span style="background:#ef4444;width:12px;height:12px;border-radius:9999px"></span> Non conforme</div>
          <div class="flex items-center gap-2"><span style="background:#f59e0b;width:12px;height:12px;border-radius:9999px"></span> En retard</div>
          <div class="flex items-center gap-2"><span style="background:#3b82f6;width:12px;height:12px;border-radius:9999px"></span> En attente</div>
        </div>`;
      L.DomEvent.disableScrollPropagation(el);
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  const inst = new ctrl();
  map.addControl(inst);
  return inst;
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
export default function ControlsMap({
  plan, // objet plan {id, display_name, url_pdf}
  onSelectTask,
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const markersRef = useRef(null);
  const legendRef = useRef(null);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [open, setOpen] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [equipments, setEquipments] = useState([]);

  const fileUrl = useMemo(() => plan?.url_pdf || null, [plan]);

  // -------------------------------------------------------------------------
  // Chargement du plan PDF + Leaflet init
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!wrapRef.current || !fileUrl) return;

    (async () => {
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
      }

      // Init carte
      const m = L.map(wrapRef.current, {
        crs: L.CRS.Simple,
        zoomControl: false,
        preferCanvas: true,
      });
      L.control.zoom({ position: "topright" }).addTo(m);
      mapRef.current = m;

      // Lecture PDF
      const task = pdfjsLib.getDocument({ url: fileUrl });
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const imgUrl = canvas.toDataURL("image/png");
      const bounds = L.latLngBounds([[0, 0], [vp.height, vp.width]]);
      const base = L.imageOverlay(imgUrl, bounds).addTo(m);
      baseLayerRef.current = base;
      setImgSize({ w: vp.width, h: vp.height });

      m.fitBounds(bounds);
      m.setMaxBounds(bounds.pad(0.5));

      // Groupe des marqueurs
      markersRef.current = L.layerGroup().addTo(m);

      // Légende
      legendRef.current = addLegend(m);

      // Chargement initial des équipements
      await loadEquipments();
    })();
  }, [fileUrl]);

  // -------------------------------------------------------------------------
  // Chargement des équipements et tâches associées
  // -------------------------------------------------------------------------
  async function loadEquipments() {
    try {
      const r = await api.controls.timeline(); // liste des tâches actives
      const items = Array.isArray(r.items) ? r.items : [];
      setEquipments(items);
      drawMarkers(items);
    } catch (e) {
      console.error("[ControlsMap] loadEquipments error", e);
    }
  }

  // -------------------------------------------------------------------------
  // Dessin des marqueurs
  // -------------------------------------------------------------------------
  function drawMarkers(list) {
    const m = mapRef.current;
    const base = baseLayerRef.current;
    if (!m || !base || !markersRef.current) return;
    const layer = markersRef.current;
    layer.clearLayers();

    // Projection simple : on répartit les équipements selon leur index
    // (dans un vrai cas, les coords x/y pourraient venir de la DB)
    const total = list.length || 1;
    const cols = Math.ceil(Math.sqrt(total));
    const rows = cols;
    let i = 0;

    for (const t of list) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const xf = col / (cols + 1);
      const yf = row / (rows + 1);

      const bounds = base.getBounds();
      const W = bounds.getEast() - bounds.getWest();
      const H = bounds.getNorth() - bounds.getSouth();
      const lat = bounds.getSouth() + yf * H;
      const lng = bounds.getWest() + xf * W;

      const mk = L.marker([lat, lng], {
        icon: makeIcon(t.status?.toLowerCase() || "pending"),
        title: t.label,
      });
      mk.on("click", () => {
        onSelectTask?.(t);
      });
      mk.addTo(layer);
      i++;
    }

    layer.bringToFront();
  }

  // -------------------------------------------------------------------------
  // Rendu principal
  // -------------------------------------------------------------------------
  const viewerHeight = Math.min(
    (typeof window !== "undefined" ? window.innerHeight : 900) - 140,
    imgSize.h || 900
  );

  return (
    <section className="p-4 fade-in-up">
      {!plan && (
        <div className="text-gray-500 text-sm">
          Aucun plan sélectionné. Veuillez choisir un bâtiment.
        </div>
      )}
      {plan && (
        <div className="relative">
          {/* Toolbar */}
          <div className="absolute top-2 left-2 z-[5000] flex gap-2">
            <Button
              variant="secondary"
              onClick={() => loadEquipments()}
              title="Recharger les tâches"
            >
              <RefreshCw size={16} className="mr-1" /> Refresh
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const el = legendRef.current?.getContainer?.();
                if (el) {
                  const next = !showLegend;
                  el.style.display = next ? "block" : "none";
                  setShowLegend(next);
                }
              }}
              title="Afficher / masquer la légende"
            >
              {showLegend ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>

          {/* Carte Leaflet */}
          <div
            ref={wrapRef}
            className="leaflet-wrapper"
            style={{
              height: Math.max(520, viewerHeight),
              borderRadius: "1rem",
              overflow: "hidden",
              background: "#fff",
            }}
          ></div>

          {/* Résumé */}
          <div className="mt-3 text-sm text-gray-600 flex items-center justify-between">
            <div>
              <b>{equipments.length}</b> tâches planifiées affichées sur{" "}
              <b>{plan.display_name}</b>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                mapRef.current?.fitBounds(baseLayerRef.current?.getBounds());
              }}
            >
              <Layers size={14} className="mr-1" /> Ajuster la vue
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
